# AGENTS.md — deManage

Guia rápido para agents (e humanos) se situarem neste repositório.

## Obrigatório: planos (`plans.md`)

**Antes de qualquer implementação**, leia [`plans.md`](./plans.md).

1. Consulte o roadmap e as prioridades (P0 → P1 → P2+).
2. **Pergunte / confirme** qual etapa o usuário quer fazer agora — não avance sozinho para outra feature.
3. Se o item tiver prefixo **`[HUMAN]`**: **não implemente**; apenas oriente o usuário e pare.
4. Ao concluir a etapa pedida, atualize `plans.md`: marque `- [x]` (não apague o histórico).
5. Não implemente itens de backlog (P2+) sem pedido explícito do usuário.

## O que é

**deManage** é um app pessoal de gestão de despesas mensais (pt-BR, moeda BRL).

Fase atual: **UI completa + dados locais**. Sem login/auth e sem API de domínio ainda. Próximos passos estão em [`plans.md`](./plans.md).

## Estrutura

```
deManage/
  frontend/     # React 19 + Vite + TypeScript + Tailwind 4 + shadcn + Zustand
  backend/      # Express + TypeScript (esqueleto; GET /health)
  AGENTS.md     # este arquivo
  plans.md      # roadmap de features (consultar sempre)
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

Express 5 + TypeScript. Por enquanto só `GET /health`. Pronto para receber auth/API conforme `plans.md`.

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
  data/labels.ts
  lib/format.ts
  router.tsx
  global.css             # tema dark preto + neon
```

## Dados (fase atual)

- Store: `useFinanceStore` em `stores/finance-store.ts`
- Persistência: `localStorage` chave `demanage-finance`
- Labels: `data/labels.ts` (estado inicial vazio no finance-store)
- Sem chamadas de API de domínio ainda (ver `plans.md` para DB/API)

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

## Checklist antes de entregar

- [ ] `plans.md` consultado; etapa alinhada com o pedido do usuário
- [ ] Se a feature foi concluída, `plans.md` atualizado (`- [x]`)
- [ ] Código no estilo de `CODING_STYLE.md` (aspas simples + `;`)
- [ ] Tipagem TypeScript ok (`pnpm exec tsc -b` no frontend)
- [ ] Sem segredos / pacotes corporativos
- [ ] Mudanças focadas; sem refatoração oportunista
