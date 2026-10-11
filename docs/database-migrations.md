# Migrations do banco (Prisma + PostgreSQL)

Este documento descreve as regras para criar e aplicar migrations do deManage e
os riscos conhecidos do histórico atual.

## Regras

1. **Nunca renomeie ou edite migrations já aplicadas em produção.** O Prisma guarda o
   nome e o checksum de cada uma em `_prisma_migrations`. Renomear faz o Prisma tratar a
   migration como nova e tentar reaplicá-la.
2. Crie migrations com `pnpm exec prisma migrate dev --name <nome>` em um banco local
   descartável. Revise o SQL gerado antes de commitar.
3. Regras que o Prisma não modela (índice parcial, `CHECK`) são escritas em SQL manual na
   mesma migration, e documentadas como comentário em `backend/prisma/schema.prisma`.
4. Timestamps devem ser **únicos**. A CI (`backend`) falha se houver prefixo duplicado,
   exceto o registro histórico abaixo.
5. A CI roda o **drift gate**: `prisma migrate diff --from-migrations prisma/migrations
   --to-schema prisma/schema.prisma --exit-code`. Ele falha (exit 2) se o schema e as
   migrations divergirem. Ele usa `SHADOW_DATABASE_URL` (banco separado, recriado a cada
   execução) definido em `backend/prisma.config.ts`.

## Histórico: timestamp duplicado `20260821120000`

Dois diretórios de migration compartilham o prefixo `20260821120000`:

- `20260821120000_patrimony_assets_cdi`
- `20260821120000_piggy_optional_goal`

Ambos já foram aplicados em produção. **Não renomeie nenhum dos dois.** O Prisma ordena
pelo nome completo (`patrimony_…` antes de `piggy_…`), e essa ordem já está gravada no banco.
A CI permite apenas esse prefixo (`.github/workflows/ci.yml`, etapa
"Check migration timestamps"). Qualquer outro prefixo duplicado falha o build.

## Migration `20261010120000_ledger_integrity_constraints`

Adiciona integridade no banco (SQL escrito à mão, sem banco disponível quando foi criada):

- Remove índices redundantes que são prefixo de um índice composto ou único existente:
  `Expense_userId_idx`, `Entry_userId_idx`, `PiggyBank_userId_idx`,
  `PiggyTransaction_piggyBankId_idx`, `ExpenseSplit_expenseId_idx`,
  `CustomTag_userId_scope_idx`, `MarketDataCache_provider_key_at_idx`.
- `PiggyTransaction.userId` passa a ter FK para `User` com `ON DELETE CASCADE`.
  **Falha** se houver linhas sem usuário (o bloco `DO` aborta com mensagem clara).
- `PiggyTransaction.expenseId` e `entryId` passam a ter FK com `ON DELETE SET NULL`.
  Referências já pendentes (linha de origem apagada) são zeradas antes, sem apagar a
  transação de cofrinho.
- Índice único parcial `ExpenseSplit (expenseId, kind) WHERE "cardId" IS NULL`, porque
  `UNIQUE (expenseId, kind, cardId)` ignora `NULL`s e não protege linhas `pix`.
  **Falha** se já houver duplicatas.
- `CHECK` de dia entre 1 e 31: `Card.closingDay`, `Card.pendingClosingDay`,
  `Entry.receiveDay` e `PiggyBank.autoDebitDay`. A API já valida esse intervalo.

### Verificações antes de aplicar em produção

Rode no banco de produção (somatórios devem ser `0`; se não forem, corrija manualmente
antes de executar a migration):

```sql
SELECT count(*) FROM "PiggyTransaction" t
WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = t."userId");

SELECT count(*) FROM "PiggyTransaction" t
WHERE t."expenseId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Expense" e WHERE e."id" = t."expenseId");

SELECT count(*) FROM "PiggyTransaction" t
WHERE t."entryId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Entry" e WHERE e."id" = t."entryId");

SELECT "expenseId", "kind", count(*) FROM "ExpenseSplit"
WHERE "cardId" IS NULL
GROUP BY "expenseId", "kind" HAVING count(*) > 1;

SELECT count(*) FROM "Card"
WHERE "closingDay" NOT BETWEEN 1 AND 31
   OR ("pendingClosingDay" IS NOT NULL AND "pendingClosingDay" NOT BETWEEN 1 AND 31);

SELECT count(*) FROM "Entry"
WHERE "receiveDay" IS NOT NULL AND "receiveDay" NOT BETWEEN 1 AND 31;

SELECT count(*) FROM "PiggyBank" WHERE "autoDebitDay" NOT BETWEEN 1 AND 31;
```

Antes da migration, faça um dump com `pg_dump --format=custom` (o agente também faz um
dump antes de cada deploy). Se a migration falhar, `prisma migrate deploy` encerra com
erro e a API não sobe. Confira a linha em `_prisma_migrations` (`finished_at`,
`rolled_back_at`, `logs`) antes de qualquer nova tentativa.

### Verificação feita no repositório

Sem Docker e sem PostgreSQL nativo, a migration foi testada contra o PostgreSQL
compatível do PGlite (WASM), servido por protocolo de rede:

- `prisma migrate deploy` aplicou as 25 migrations em sequência, incluindo a nova.
- `prisma migrate diff --from-migrations … --to-schema … --exit-code` retornou
  `No difference detected` (exit 0). Contra o `schema.prisma` anterior, o mesmo comando
  retornou exit 2, então o gate detecta divergências.
- Catálogo confirmado: FKs, `CHECK`s, índice parcial e novos índices existem, e os índices
  removidos não existem mais.

O PGlite não é o PostgreSQL 18 de produção. Os testes de integração (`*.itest.ts`) e a
execução real em PostgreSQL 18 continuam pendentes até a próxima execução da CI.

## Comandos de referência

```bash
cd backend
pnpm exec prisma validate                   # sem DATABASE_URL
pnpm exec prisma generate                   # sem DATABASE_URL
pnpm exec prisma migrate deploy             # precisa de DATABASE_URL
SHADOW_DATABASE_URL=postgresql://…/demanage_shadow \
  pnpm exec prisma migrate diff --from-migrations prisma/migrations \
  --to-schema prisma/schema.prisma --exit-code
```

No Prisma 7 o destino é `--to-schema` (não `--to-schema-datamodel`), e o banco
sombra vem de `prisma.config.ts` (`datasource.shadowDatabaseUrl`), não de uma flag.

Ao atualizar o Prisma, rode de novo o drift gate: o `migrate diff` ignora índices
parciais e `CHECK`s que o schema não modela, e uma versão futura pode mudar isso.
