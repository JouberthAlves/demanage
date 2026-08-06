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

- [ ] Seed / histórico mensal no DB (gráficos do dashboard)

