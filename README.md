<p align="center">
  <img src="./frontend/src/assets/images/logos/logo.svg" alt="deManage" width="280" />
</p>

<p align="center"><em>Suas finanças, no controle.</em></p>

<p align="center">
  <a href="https://github.com/bielxdh3/demanage/actions/workflows/ci.yml"><img src="https://github.com/bielxdh3/demanage/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/bielxdh3/demanage/actions/workflows/codeql.yml"><img src="https://github.com/bielxdh3/demanage/actions/workflows/codeql.yml/badge.svg" alt="CodeQL" /></a>
</p>

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

- **Frontend** — React 19, Vite 8, TypeScript 6, Tailwind 4, shadcn/Radix, React Router 8, Zustand (cache sem `persist`), TanStack Query, Recharts, sonner. Visual dark `#0b0b0b` com neon âmbar (`#FFB800`) e verde (`#34D399`).
- **Backend** — Express 5, Prisma 7, PostgreSQL, JWT em cookie httpOnly, rate limit em auth, Helmet/CORS.
- **Domínio** — `User`, `Card`, `Expense`, `Entry`, `PiggyBank` / `PiggyTransaction`, tags customizadas. Entradas e despesas respeitam dia/mês de início e data de término no saldo do mês.
- **Deploy** — Dockerfiles + `entrypoint` que roda `prisma migrate deploy` antes de subir a API. Frontend com `VITE_API_URL`.

```
frontend/   UI (Vite :5180)
backend/    API Express (:8888) + Prisma (schema e migrations em backend/prisma/)
ops/cd/     agente de deploy de produção (pull-only, ver docs/continuous-deployment.md)
docker-compose.yml   PostgreSQL 18.6 (+ pgAdmin opcional)
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
  lib/                auth, cookies, fuso SP

backend/prisma/       schema.prisma + migrations (SQL versionado)

AGENTS.md             visão para agents
plans.md              roadmap (fonte de verdade de prioridade)
CODING_STYLE.md       aspas simples + ;
```

Detalhe de features e checklist de deploy ficam em [`plans.md`](./plans.md). Este README não duplica o schema Prisma.

## Como rodar

Node **24+** (o `engines` do backend exige 24; a CI e as imagens usam Node 26), **pnpm 10.17.1**, PostgreSQL 18 (Compose incluso).

```bash
# Banco
docker compose up -d db

# Backend
cd backend
pnpm install --frozen-lockfile
cp .env.example .env
pnpm exec prisma migrate dev
pnpm dev
# http://localhost:8888/health
```

Atalhos a partir da raiz (cada pacote mantém o próprio lockfile):

```bash
pnpm bootstrap        # instala backend e frontend com lockfiles congelados
pnpm typecheck        # tsc nos dois pacotes
pnpm lint             # eslint nos dois pacotes (--max-warnings 0)
pnpm test             # testes unitários e de frontend
pnpm test:integration # testes do backend que usam banco (*.itest.ts)
```

Sem `DATABASE_URL`, `pnpm exec prisma generate` e `pnpm exec prisma validate` funcionam normalmente.
Migrations e o drift gate estão em [`docs/database-migrations.md`](./docs/database-migrations.md).

```bash
# Frontend
cd frontend
pnpm install --frozen-lockfile
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
cd frontend && pnpm format && pnpm typecheck
cd backend && pnpm format && pnpm typecheck && pnpm build
```

## Docs internas

- [`AGENTS.md`](./AGENTS.md) — contexto rápido para agents
- [`plans.md`](./plans.md) — roadmap P0 → P2+
- [`CODING_STYLE.md`](./CODING_STYLE.md) — estilo de código
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — como contribuir
- [`SECURITY.md`](./SECURITY.md) — reporte responsável de vulnerabilidades
- [`SUPPORT.md`](./SUPPORT.md) — suporte e triagem
- [`GOVERNANCE.md`](./GOVERNANCE.md) — governança deste fork

## Licenciamento e origem

Este repositório é um fork de [JouberthAlves/demanage](https://github.com/JouberthAlves/demanage). O upstream atualmente não publica uma licença de repositório, portanto este fork **não declara Apache-2.0 nem outra licença ampla sobre o código herdado**.

Consulte [NOTICE](NOTICE) para atribuição e proveniência. Se o upstream adotar uma licença compatível no futuro, o licenciamento deste fork poderá ser alinhado explicitamente.

Sem garantia de que o comportamento financeiro (faturas, saldo do mês, auto-débito do cofrinho) cubra todos os casos da sua vida real — revise os números antes de confiar neles.
