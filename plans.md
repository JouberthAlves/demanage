# plans.md — Roadmap deManage

Checklist vivo das features. Agents devem **sempre** ler este arquivo e seguir a etapa que o usuário pedir.

## Como usar (agents)

1. Ler este arquivo no início da conversa / tarefa.
2. Confirmar com o usuário **qual etapa** ele quer fazer agora (não pular prioridades sem combinar).
3. Prefixo **`[HUMAN]`**: a IA **não implementa** — só orienta o usuário.
4. Ao concluir uma feature (implementada ou confirmada pelo humano):
   - Marcar `- [x]` (não apagar o item).
   - Pode riscar o título se ajudar a leitura: `~~texto~~`.
5. Não implementar backlog P2+ sem o usuário pedir explicitamente.

### Status

| Marcação | Significado |
|----------|-------------|
| `- [ ]` | Pendente |
| `- [x]` | Concluída |
| `[HUMAN]` | Só orientação; humano executa |

---

## P0 — Dados (maior prioridade)

### Schema e banco

- [x] **Prisma schema** — Criar `backend/prisma/schema.prisma` com models `User`, `Card`, `Expense`, `Entry` + `DATABASE_URL` no `backend/.env.example`. PostgreSQL; IDs `cuid()`; timestamps; relações com `userId`.

  Detalhe dos models:
  - **User**: `id`, `name`, `email` (unique), `passwordHash`, `salary`, `notes?`, relations
  - **Card**: `id`, `userId`, `name`, `limit?`, `closingDay?`, `dueDay?`
  - **Expense**: `id`, `userId`, `cardId?`, `name`, `amount`, `category` (assinatura\|parcela\|divida\|outro), `frequency` (mensal), `dueDay?`, `notes?`
  - **Entry**: `id`, `userId`, `name`, `amount`, `type` (salario\|freelance\|outro), `frequency` (mensal\|unica), `date?`

- [x] **`[HUMAN]` Docker / DB** — Subir PostgreSQL (Docker Compose ou outro), configurar `DATABASE_URL`, rodar `prisma migrate` / `generate` quando quiser. **IA só orienta**; não sobe o DB sozinha.

---

## P1 — Frontend

- [x] ~~**Renovar o frontend**~~ — Polish visual (pedido explícito): hero/panels, dashboard, despesas, entradas, perfil, layout e auth. Cores de cartão estáveis (`lib/card-tone.ts`) compartilhadas entre perfil e gráfico radial.

---

## P2+ — Backlog (não fazer sem pedido explícito)

- [x] ~~Auth / login real~~ — JWT em cookie httpOnly; `POST /auth/register|login|logout`, `GET /auth/me`; telas `/login` e `/register` (shadcn Field/Card); rotas do app protegidas.
- [x] ~~Recuperação de senha por código offline~~ — Código local de alta entropia exibido uma única vez, hash no banco, geração/rotação pelo Perfil, fluxo `Esqueci minha senha`, rotação após uso e invalidação de sessões antigas.
- [x] ~~Compatibilidade do código offline em navegador mobile~~ — Corrige resolução de API `localhost` para o host da LAN em development, CORS LAN somente em development, envio explícito do POST e fallback de clipboard fora de secure context.
- [x] ~~API CRUD Express + Prisma~~ — `Entry`, `Expense`, `Card` (GET/POST/PATCH/DELETE). Perfil via `PATCH /auth/me` (salva `salary` e sincroniza entrada mensal "Salário").
- [x] ~~Frontend: trocar Zustand/localStorage pela API~~ — Entradas, Despesas, Cartões e perfil na API; finance store sem persist.
- [x] ~~Inputs monetários BRL~~ — máscara `R$ 1.234,56` em perfil, despesas, entradas e cartões.
- [x] ~~Fatura de cartão + validade~~ — fechamento gera `Fatura do cartão {nome}`; validade MM/AA com renovar; botão Pago; aviso ao remover cartão.
- [x] ~~Tipos personalizados + frequência semanal~~ — Em Entradas/Despesas, "Outro…" abre modal para criar tag com cor; frequência inclui Semanal (mensal ≈ valor × 4).
- [x] ~~Quando recebe + data de término~~ — Entradas mensais/semanais com dia de recebimento e término; salário só com dia; saldo do mês conta após o dia.
- [x] ~~Despesa frequência Única~~ — ExpenseFrequency inclui `unica` (não entra no total mensal recorrente).
- [x] ~~Despesa: quando desconta + término~~ — Mensal/semanal com dia de desconto e data de término; saldo conta após o dia (como entradas).
- [x] ~~Despesa: mês do desconto~~ — “Quando será descontado” com dia + mês (startsAt); primeiro desconto naquele mês.
- [x] ~~Revisão agenda entradas/despesas~~ — Únicas contam no mês; entradas com dia+mês; validação término ≥ início; preview da 1ª data.
- [x] ~~Passagem pré-deploy~~ — Fatura respeita agenda + fuso SP; env/cookies prod; dashboard/copy honestos; empty states nos gráficos stub; confirmação Pago/Excluir; `closingDay` obrigatório; delete de cartão remove cobranças; validação API amount/enums/unica; polish forms/tabelas.

  Checklist de deploy:
  1. `prisma migrate deploy` (ou `migrate dev` local) + `generate`
  2. Backend prod: `DATABASE_URL`, `JWT_SECRET`, `APP_URL` (sem fallback fraco)
  3. Se FE e API em origens diferentes: cookie `sameSite=none` + `secure` (auto ou `COOKIE_SAME_SITE`)
  4. Frontend build: `VITE_API_URL` apontando para a API
  5. Docker/Railway: `PORT` (ou `API_PORT`); entrypoint roda migrate + `node dist/server.js`

- [x] ~~Pente fino pré-deploy~~ — Docker/entrypoint/`PORT`; billing day-key SP; cookie TTL = JWT; rate limit auth; `closingDay` NOT NULL; confirm delete entradas; polish auth/dashboard/tabelas.

- [x] ~~**Cofrinho**~~ — Aba de metas de poupança com depósito/saque, impacto no saldo, histórico e dashboard.

  ### Regras de negócio
  - Vários cofres por usuário.
  - Campos: `name`, `goalAmount` (meta final), `targetDate`, `monthlyGoal` (calculada), `autoDebit`, `isEmergency`, `archivedAt?`.
  - **Meta mensal** = `goalAmount / meses` até `targetDate` (meses de calendário; mínimo 1). Recalcula ao mudar meta/data.
  - **Guardar** (só na aba Cofrinho): cria `PiggyTransaction` deposit + `Expense` `unica` categoria `cofrinho` → saldo do mês ↓.
  - **Sacar**: withdraw; valor volta ao saldo no dia/mês do saque como **Entry** `unica` tipo `outro` nome “Resgate · {cofre}” (visível). Se `isEmergency`, aviso extra no modal.
  - **Auto-débito** (opt-in): no **dia escolhido** de cada mês (`autoDebitDay`, 1–31; meses curtos usam o último dia), se ativo e cofre não arquivado/não concluído, debita `monthlyGoal` (ou o que falta pra meta) via mesmo fluxo de guardar. Idempotente por mês (`autoDebitMonth` ou unique deposit tag).
  - **Meta atingida** (depósito que faz balance ≥ goal): confetes + parabéns + libera **Arquivar** (`archivedAt`). Arquivar some da lista ativa (não hard-delete).
  - **Excluir** com saldo > 0: modal de confirmação (não bloqueia). Cascade apaga txs; despesas/entradas ligadas ficam ou são removidas junto — **default: soft orphan ok, apaga só txs + cofre**; despesa “Cofrinho” permanece no histórico financeiro.

  ### Schema
  - Enum `ExpenseCategory` += `cofrinho`
  - `PiggyBank` + `PiggyTransaction` (`deposit` | `withdraw`, `amount`, `date`, `expenseId?`, `entryId?`, `note?`)
  - Saldo do cofre = soma deposits − withdraws (derivado)

  ### API
  - `GET/POST /piggy-banks`, `PATCH/DELETE /piggy-banks/:id`
  - `POST /piggy-banks/:id/deposit`, `POST /piggy-banks/:id/withdraw`
  - `POST /piggy-banks/:id/archive`
  - `GET /piggy-banks/:id/transactions`
  - Hook de auto-débito: junto do bootstrap do app (como `process-billing`) ou endpoint dedicado chamado no load

  ### Frontend
  - Rota `/cofrinho`, sidebar (ícone PiggyBank), entre Despesas e Entradas
  - Página: lista de cofres, CRUD, guardar/sacar, histórico, toggle auto-débito / emergência
  - Dashboard hero: card **Total no cofre** entre “Saldo até hoje” e “Saídas/entradas”
  - Labels/cores: categoria Cofrinho (ex. `#A78BFA` ou verde poupança)
  - Confetti na conclusão (lib leve ou CSS/canvas simples)

  ### Ordem de implementação
  1. Prisma migrate (enum + models)
  2. Lib meta mensal + saldo derivado
  3. API CRUD + deposit/withdraw/archive (+ auto-debit no load)
  4. FE página Cofrinho + hooks
  5. Dashboard KPI + categoria nas despesas
  6. Confetti / arquivar / modais

- [x] ~~**Responsividade**~~ — Bottom nav no mobile; sidebar só em `md+`; Despesas/Entradas em cards no mobile (tabela no desktop); grids/padding notebook; scroll em form dialogs.

- [x] ~~**Split cartão / PIX**~~ — Despesa em 2 cartões ou cartão+PIX por %; valida limite disponível; parte PIX no saldo; billing/comprometimento por split.

- [ ] Seed / histórico mensal no DB (gráficos do dashboard)

