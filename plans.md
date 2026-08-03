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

- [ ] **`[HUMAN]` Renovar o frontend** — Redesign / polish visual do app. **IA NÃO conclui esta tarefa.** Orientar o usuário com:
  - Arquivos-chave: `frontend/src/global.css`, `components/layout/`, `pages/`
  - Estilo alvo: dark `#0b0b0b`, CTA branco, gráficos neon âmbar/verde
  - Seguir `CODING_STYLE.md`
  - Entregar checklist e parar — o humano faz as mudanças

---

## P2+ — Backlog (não fazer sem pedido explícito)

- [x] ~~Auth / login real~~ — JWT em cookie httpOnly; `POST /auth/register|login|logout`, `GET /auth/me`; telas `/login` e `/register` (shadcn Field/Card); rotas do app protegidas. Financeiro ainda no Zustand/localStorage.
- [ ] API CRUD Express + Prisma (`User`, `Card`, `Expense`, `Entry`)
- [ ] Frontend: trocar Zustand/localStorage pela API
- [ ] Seed / histórico mensal no DB (gráficos do dashboard)
