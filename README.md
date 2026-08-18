<p align="center">
  <img src="./docs/img/demanage-brand.png" alt="deManage" width="280" />
</p>

<p align="center"><em>Suas finanças, no controle.</em></p>

# deManage

App pessoal de gestão financeira mensal em **pt-BR** e **BRL**. Dashboard com saldo do mês, despesas e entradas com agenda, cartões com fatura, cofrinho de metas e auth real — tudo no tema dark neon.

Não é um ERP nem um open banking. É o controle do mês: o que entra, o que sai, o que está no cartão e o que você está guardando.

## O que tem

| Área | Rota | O que faz |
| --- | --- | --- |
| Dashboard | `/` | KPIs do mês, saldo até hoje, gráficos e total no cofre |
| Despesas | `/despesas` | CRUD com frequência, cartão/PIX (split), categorias e término |
| Cofrinho | `/cofrinho` | Metas de poupança, depósito/saque, auto-débito e arquivar |
| Entradas | `/entradas` | Salário, freela e outras; dia de recebimento e término |
| Perfil | `/perfil` | Nome, salário, cartões, código de recuperação |
| Auth | `/login` · `/register` · `/recuperar-senha` | JWT em cookie httpOnly |

Faturas de cartão fecham no dia configurado (fuso America/Sao_Paulo). Recuperação de senha usa código de alta entropia gerado no Perfil — sem e-mail.

## Como é feito

Monorepo `frontend/` + `backend/`, no mesmo espírito de outros apps do autor — **sem** pacotes corporativos (`@crediari`, SSO, etc.).

- **Frontend** — React 19, Vite 7, TypeScript, Tailwind 4, shadcn/Radix, React Router 7, Zustand (cache sem `persist`), TanStack Query, Recharts, sonner. Visual dark `#0b0b0b` com neon âmbar (`#FFB800`) e verde (`#34D399`).
- **Backend** — Express 5, Prisma 6, PostgreSQL, JWT em cookie httpOnly, rate limit em auth, Helmet/CORS.
- **Domínio** — `User`, `Card`, `Expense`, `Entry`, `PiggyBank` / `PiggyTransaction`, tags customizadas. Entradas e despesas respeitam dia/mês de início e data de término no saldo do mês.
- **Deploy** — Dockerfiles + `entrypoint` que roda `prisma migrate deploy` antes de subir a API. Frontend com `VITE_API_URL`.

```
frontend/   UI (Vite :5180)
backend/    API Express (:8888) + Prisma
docker-compose.yml   Postgres 16 (+ pgAdmin opcional)
```

## Layout do repo

```
frontend/src/
  pages/              páginas finas (*-page.tsx) + auth
  components/         dashboard, expenses, income, piggy, profile, layout, ui
  stores/             auth + finance (cache da API)
  lib/                format BRL, card-tone, billing helpers
  router.tsx

backend/src/
  routes/             /auth/* + /entries|/expenses|/cards|/piggy-banks|…
  prisma/             schema + migrations
  lib/                auth, cookies, fuso SP

AGENTS.md             visão para agents
plans.md              roadmap (fonte de verdade de prioridade)
CODING_STYLE.md       aspas simples + ;
```

Detalhe de features e checklist de deploy ficam em [`plans.md`](./plans.md). Este README não duplica o schema Prisma.

## Como rodar

Node **20+**, **pnpm**, PostgreSQL (Compose incluso).

```bash
# Banco
docker compose up -d db

# Backend
cd backend
pnpm install
cp .env.example .env
pnpm exec prisma migrate dev
pnpm dev
# http://localhost:8888/health
```

```bash
# Frontend
cd frontend
pnpm install
cp .env.example .env
pnpm dev
# http://localhost:5180
```

Variáveis mínimas:

| Onde | Variável | Exemplo |
| --- | --- | --- |
| Backend | `DATABASE_URL` | `postgresql://demanage:demanage@localhost:5432/demanage?schema=public` |
| Backend | `JWT_SECRET` | obrigatório em production |
| Backend | `APP_URL` | `http://localhost:5180` (CORS + cookie) |
| Frontend | `VITE_API_URL` | `http://localhost:8888` |

```bash
cd frontend && pnpm format && pnpm exec tsc -b
cd backend && pnpm format && pnpm build
```

## Docs internas

- [`AGENTS.md`](./AGENTS.md) — contexto rápido para agents
- [`plans.md`](./plans.md) — roadmap P0 → P2+
- [`CODING_STYLE.md`](./CODING_STYLE.md) — estilo de código

## Licença

Uso pessoal. Sem garantia de que o comportamento financeiro (faturas, saldo do mês, auto-débito do cofrinho) cubra todos os casos da sua vida real — revise os números antes de confiar neles.
