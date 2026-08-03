# AGENTS.md — deManage

Guia rápido para agents (e humanos) se situarem neste repositório.

## O que é

**deManage** é um app pessoal de gestão de despesas mensais (pt-BR, moeda BRL).

Fase atual: **UI completa + dados locais**. Sem login/auth e sem API de domínio ainda.

## Estrutura

```
deManage/
  frontend/     # React 19 + Vite + TypeScript + Tailwind 4 + shadcn + Zustand
  backend/      # Express + TypeScript (esqueleto; GET /health)
  AGENTS.md     # este arquivo
  CODING_STYLE.md
  .cursor/rules/
```

Espelha o padrão `frontend/` + `backend/` usado em outros apps do autor (ex.: ranking), **sem** pacotes corporativos (`@crediari`, `accounts-client`, SSO, etc.).

## Stack (frontend)

| Camada | Escolha |
|--------|---------|
| UI | React 19 + TypeScript |
| Bundler | Vite 7 |
| Estilo | Tailwind 4 + shadcn/Radix |
| Rotas | React Router 7 |
| Estado local | Zustand + `persist` (localStorage) |
| Gráficos | Recharts (tema dark neon) |
| Toasts | sonner |
| Pacotes | pnpm |

## Stack (backend)

Express 5 + TypeScript. Por enquanto só `GET /health`. Pronto para receber auth/API na fase 2.

## Rotas da UI

| Rota | Página | Função |
|------|--------|--------|
| `/` | Dashboard | KPIs + gráficos neon |
| `/perfil` | Perfil | Nome, salário, cartões |
| `/despesas` | Despesas | CRUD despesas recorrentes |
| `/entradas` | Entradas | CRUD entradas |

## Onde mexer

```
frontend/src/
  pages/                 # páginas finas (*-page.tsx)
  pages/layout/          # AppLayout
  components/
    layout/              # sidebar, topbar, page-header
    dashboard/           # KPI + charts
    expenses/ income/ profile/
    ui/                  # shadcn (gerado; evitar editar sem necessidade)
  stores/finance-store.ts
  types/finance.ts
  data/seed.ts
  lib/format.ts
  router.tsx
  global.css             # tema dark preto + neon
```

## Dados (fase 1)

- Store: `useFinanceStore` em `stores/finance-store.ts`
- Persistência: `localStorage` chave `demanage-finance`
- Seed: `data/seed.ts`
- Sem chamadas de API de domínio ainda

## Como rodar

```bash
# Frontend
cd frontend && pnpm install && pnpm dev
# http://localhost:5180

# Backend
cd backend && pnpm install && pnpm dev
# http://localhost:8888/health
```

## Convenções importantes

1. Leia e siga [`CODING_STYLE.md`](./CODING_STYLE.md).
2. Arquivos em **kebab-case**; componentes com **named exports** (`export function X`).
3. Alias `@/` → `frontend/src/`.
4. UI em **pt-BR**; valores em **BRL**.
5. Visual: dark `#0b0b0b`, CTA branco, gráficos neon âmbar (`#FFB800`) e verde (`#34D399`).
6. Preferir componentes **shadcn** já no projeto; deps alinhadas ao stack existente.
7. **Nunca** reintroduzir `@crediari`, `accounts-client`, SSO ou auth corporativa.

## Fora do escopo (ainda)

Auth/login, Prisma/DB, sync multi-device, notificações, exportação.

## Checklist antes de entregar

- [ ] Código no estilo de `CODING_STYLE.md` (aspas simples + `;`)
- [ ] Tipagem TypeScript ok (`pnpm exec tsc -b` no frontend)
- [ ] Sem segredos / pacotes corporativos
- [ ] Mudanças focadas; sem refatoração oportunista
