"""Fail-closed PostgreSQL AST gate for the restricted additive release channel.

The parser understands PostgreSQL grammar, including quoted identifiers,
comments, string literals and dollar-quoted function bodies. This is a narrow
structural allowlist, not a SQL keyword blacklist. Reviewed data migrations and
trigger bodies are bound to their exact path and SHA256; modifying either
requires an explicit code review of this gate.
"""

from __future__ import annotations

import hashlib
import json

try:
    from pglast.parser import parse_sql_json as pg_parse_sql
except ImportError:  # The approval channel must never fall back to regexes.
    pg_parse_sql = None


# Individually reviewed SQL blobs. Each SHA-256 covers the complete Git blob,
# including leading/trailing whitespace. Any byte or path change needs review.
# This is only the SQL-shape gate; production still requires owner approval,
# a disposable PostgreSQL rehearsal, and verified backup evidence.
REVIEWED_SQL = {
    "backend/prisma/migrations/20261023210000_piggy_correction_origin/migration.sql": (
        "ea23be8728984dd689ebeed2b180846da85367af9e6e2d0ee1f891de60f3b468"
    ),
    "backend/prisma/migrations/20261023210100_oauth_token_connection_status/migration.sql": (
        "3bb58025e8e191696e774df29d54578356b9f903d9ffe5f9c8a0ca8bad820b2b"
    ),
    "backend/prisma/migrations/20261023211000_c04_owner_composite_fks/migration.sql": (
        "09767182912349193394712d9ef6bceda51638fc32ad5d531325c2dfbf079bdb"
    ),
    "backend/prisma/migrations/20261023213000_expense_obligation_versions/migration.sql": (
        "01a359d263051d5745325ec099b5e12e633171c0ec64146e3bd7cc9a33f8915e"
    ),
}


def _deny(detail: str) -> None:
    raise RuntimeError("Unsupported or unsafe migration; manual audited runbook required: " + detail)


def _node(value: object) -> tuple[str, dict]:
    if not isinstance(value, dict) or len(value) != 1:
        _deny("unexpected PostgreSQL AST node")
    kind, body = next(iter(value.items()))
    if not isinstance(body, dict):
        _deny("unexpected PostgreSQL AST shape")
    return kind, body


def _only(body: dict, allowed: set[str]) -> None:
    unknown = set(body) - allowed
    if unknown:
        _deny("unreviewed PostgreSQL AST fields: " + ", ".join(sorted(unknown)))


def _names(items: object) -> list[str]:
    if not isinstance(items, list) or not items:
        _deny("missing SQL identifier")
    values = []
    for item in items:
        kind, body = _node(item)
        if kind != "String" or set(body) != {"sval"} or not isinstance(body["sval"], str):
            _deny("nonliteral SQL identifier")
        values.append(body["sval"])
    return values


def _public_object_name(items: object) -> None:
    names = _names(items)
    if len(names) > 2 or (len(names) == 2 and names[0] != "public"):
        _deny("object outside the application schema")


def _relation(value: dict) -> None:
    _only(value, {"catalogname", "schemaname", "relname", "inh", "relpersistence", "location"})
    if not isinstance(value.get("relname"), str) or value.get("catalogname"):
        _deny("nonlocal relation")
    if value.get("schemaname") not in (None, "public") or value.get("relpersistence", "p") != "p":
        _deny("system, temporary or nonpublic relation")


def _typename(value: dict) -> None:
    _only(value, {"names", "typmods", "typemod", "location", "arrayBounds"})
    if value.get("arrayBounds"):
        _deny("unreviewed array type")
    names = _names(value.get("names"))
    if len(names) > 2 or (len(names) == 2 and names[0] not in ("pg_catalog", "public")):
        _deny("unreviewed type schema")
    for modifier in value.get("typmods", []):
        kind, data = _node(modifier)
        if kind != "A_Const" or not isinstance(data.get("ival", {}).get("ival"), int):
            _deny("nonliteral type modifier")


def _column_reference(value: object) -> None:
    kind, body = _node(value)
    if kind != "ColumnRef":
        _deny("expected column reference")
    _only(body, {"fields", "location"})
    if len(_names(body.get("fields"))) != 1:
        _deny("qualified or wildcard column reference")


def _expression(value: object, *, context: str) -> None:
    kind, body = _node(value)
    if kind == "A_Const":
        _only(body, {"ival", "fval", "sval", "boolval", "isnull", "location"})
        if not any(field in body for field in ("ival", "fval", "sval", "boolval", "isnull")):
            _deny("unknown literal")
    elif kind == "ColumnRef" and context in ("check", "index"):
        _column_reference(value)
    elif kind == "SQLValueFunction" and context == "default":
        _only(body, {"op", "typmod", "location"})
        if body.get("op") not in ("SVFOP_CURRENT_TIMESTAMP", "SVFOP_CURRENT_DATE"):
            _deny("unreviewed SQL value function")
    elif kind == "FuncCall":
        _only(body, {"funcname", "args", "funcformat", "location"})
        names = _names(body.get("funcname"))
        if len(names) == 2 and names[0] == "pg_catalog":
            names = names[1:]
        permitted = {"default": {"gen_random_uuid", "now"}, "index": {"lower", "btrim"}}
        if len(names) != 1 or names[0].lower() not in permitted.get(context, set()):
            _deny("unreviewed function call")
        args = body.get("args", [])
        if context == "default" and args:
            _deny("default function arguments")
        if context == "index" and len(args) != 1:
            _deny("index function arguments")
        for arg in args:
            _expression(arg, context="index")
    elif kind == "TypeCast":
        _only(body, {"arg", "typeName", "location"})
        _typename(body["typeName"])
        _expression(body["arg"], context=context)
    elif kind == "NullTest" and context in ("check", "index"):
        _only(body, {"arg", "nulltesttype", "argisrow", "location"})
        if body.get("nulltesttype") not in ("IS_NULL", "IS_NOT_NULL") or body.get("argisrow"):
            _deny("non-scalar null test")
        _expression(body["arg"], context=context)
    elif kind == "A_Expr" and context in ("check", "index"):
        _only(body, {"kind", "name", "lexpr", "rexpr", "location"})
        operators = _names(body.get("name"))
        if body.get("kind") not in (None, "AEXPR_OP") or operators not in (
            ["="], ["<>"], ["<"], [">"], ["<="], [">="], ["+"], ["-"],
        ):
            _deny("non-whitelisted expression operator")
        for operand in (body.get("lexpr"), body.get("rexpr")):
            if operand is not None:
                _expression(operand, context=context)
    elif kind == "BoolExpr" and context in ("check", "index"):
        _only(body, {"boolop", "args", "location"})
        if body.get("boolop") not in ("AND_EXPR", "OR_EXPR", "NOT_EXPR") or not body.get("args"):
            _deny("unsupported boolean expression")
        for arg in body["args"]:
            _expression(arg, context=context)
    else:
        _deny("unreviewed expression " + kind)


def _constraint(value: dict) -> None:
    _only(value, {
        "contype", "conname", "deferrable", "initdeferred", "location",
        "is_enforced", "initially_valid", "skip_validation", "keys", "including",
        "raw_expr", "pktable", "fk_attrs", "pk_attrs", "fk_matchtype",
        "fk_upd_action", "fk_del_action", "fk_del_set_cols", "indexname",
        "options", "access_method", "where_clause", "nulls_not_distinct",
    })
    kind = value.get("contype")
    if kind in ("CONSTR_NOTNULL", "CONSTR_NULL"):
        return
    if kind == "CONSTR_DEFAULT":
        _expression(value.get("raw_expr"), context="default")
    elif kind == "CONSTR_CHECK":
        _expression(value.get("raw_expr"), context="check")
    elif kind in ("CONSTR_PRIMARY", "CONSTR_UNIQUE"):
        _names(value.get("keys"))
        if value.get("including") or value.get("where_clause") or value.get("options"):
            _deny("advanced index constraint")
    elif kind == "CONSTR_FOREIGN":
        _relation(value.get("pktable", {}))
        _names(value.get("fk_attrs"))
        if value.get("pk_attrs"):
            _names(value["pk_attrs"])
        if value.get("fk_del_set_cols") or value.get("options"):
            _deny("unreviewed foreign key options")
        if value.get("fk_matchtype", "s") not in ("s", "f"):
            _deny("foreign key match policy")
        if value.get("fk_upd_action", "a") not in "arcnd" or value.get("fk_del_action", "a") not in "arcnd":
            _deny("foreign key action")
    else:
        _deny("constraint type " + str(kind))


def _column(value: dict) -> None:
    _only(value, {"colname", "typeName", "is_local", "constraints", "location", "is_not_null"})
    if not isinstance(value.get("colname"), str) or "typeName" not in value:
        _deny("incomplete column definition")
    _typename(value["typeName"])
    for element in value.get("constraints", []):
        kind, body = _node(element)
        if kind != "Constraint":
            _deny("non-constraint column element")
        _constraint(body)


def _create_table(value: dict) -> None:
    _only(value, {"relation", "tableElts", "if_not_exists", "oncommit", "constraints"})
    _relation(value["relation"])
    if value.get("oncommit", "ONCOMMIT_NOOP") != "ONCOMMIT_NOOP" or not value.get("tableElts"):
        _deny("unreviewed CREATE TABLE form")
    for element in value["tableElts"]:
        kind, body = _node(element)
        if kind == "ColumnDef":
            _column(body)
        elif kind == "Constraint":
            _constraint(body)
        else:
            _deny("CREATE TABLE contains " + kind)
    for element in value.get("constraints", []):
        kind, body = _node(element)
        if kind != "Constraint":
            _deny("CREATE TABLE secondary element")
        _constraint(body)


def _alter_table(value: dict) -> None:
    _only(value, {"relation", "cmds", "objtype", "missing_ok"})
    _relation(value["relation"])
    if value.get("objtype", "OBJECT_TABLE") != "OBJECT_TABLE" or not value.get("cmds"):
        _deny("non-table ALTER statement")
    for element in value["cmds"]:
        kind, cmd = _node(element)
        if kind != "AlterTableCmd":
            _deny("unreviewed ALTER command")
        _only(cmd, {"subtype", "name", "def", "behavior", "missing_ok"})
        if cmd.get("behavior", "DROP_RESTRICT") != "DROP_RESTRICT":
            _deny("cascading ALTER command")
        subtype = cmd.get("subtype")
        if subtype == "AT_AddColumn":
            node, body = _node(cmd.get("def"))
            if node != "ColumnDef":
                _deny("ALTER ADD COLUMN without column definition")
            _column(body)
        elif subtype == "AT_AddConstraint":
            node, body = _node(cmd.get("def"))
            if node != "Constraint":
                _deny("ALTER ADD CONSTRAINT without constraint")
            _constraint(body)
        else:
            _deny("non-additive ALTER TABLE command " + str(subtype))


def _create_index(value: dict) -> None:
    _only(value, {
        "idxname", "relation", "accessMethod", "indexParams", "whereClause",
        "unique", "concurrent", "if_not_exists", "nulls_not_distinct",
    })
    _relation(value["relation"])
    if value.get("accessMethod", "btree") != "btree" or not value.get("indexParams"):
        _deny("non-btree or empty index")
    for element in value["indexParams"]:
        kind, body = _node(element)
        if kind != "IndexElem":
            _deny("unreviewed index element")
        _only(body, {"name", "expr", "ordering", "nulls_ordering"})
        if ("name" in body) == ("expr" in body):
            _deny("non-column index key")
        if "expr" in body:
            _expression(body["expr"], context="index")
        if body.get("ordering", "SORTBY_DEFAULT") not in ("SORTBY_DEFAULT", "SORTBY_ASC", "SORTBY_DESC"):
            _deny("unreviewed index order")
    if value.get("whereClause"):
        _expression(value["whereClause"], context="index")


def validate_additive_sql(sql: str, path: str) -> None:
    """Permit reviewed SQL or narrow, structurally additive PostgreSQL DDL.

    A successful isolated migration rehearsal is still required independently;
    this validator does not claim data/schema integrity just from the AST.
    """
    if pg_parse_sql is None:
        raise RuntimeError("PostgreSQL parser unavailable; install pinned approval dependencies")
    if not isinstance(sql, str) or not sql.strip() or len(sql.encode("utf-8")) > 1_000_000:
        _deny("empty or oversized SQL")
    try:
        statements = json.loads(pg_parse_sql(sql))["stmts"]
    except Exception as error:
        # pglast's C-extension ParseError is not a ValueError; fail closed on
        # malformed SQL or parser failures, never let them reach approval.
        raise RuntimeError("Invalid PostgreSQL migration SQL") from error
    if not statements:
        _deny("no executable statements")
    digest = hashlib.sha256(sql.encode("utf-8")).hexdigest()
    reviewed_digest = REVIEWED_SQL.get(path)
    if reviewed_digest is not None:
        if digest != reviewed_digest:
            _deny("reviewed migration SQL bytes changed")
        return
    for statement in statements:
        kind, body = _node(statement["stmt"])
        if kind == "CreateStmt":
            _create_table(body)
        elif kind == "AlterTableStmt":
            _alter_table(body)
        elif kind == "IndexStmt":
            _create_index(body)
        elif kind == "CreateEnumStmt":
            _only(body, {"typeName", "vals"})
            _public_object_name(body.get("typeName"))
            if not body.get("vals"):
                _deny("empty enum")
            _names(body["vals"])
        elif kind == "AlterEnumStmt":
            _only(body, {"typeName", "newVal", "newValNeighbor", "newValIsAfter", "skipIfNewValExists"})
            _public_object_name(body.get("typeName"))
            if not isinstance(body.get("newVal"), str):
                _deny("non-additive enum change")
        else:
            _deny("statement type " + kind)
