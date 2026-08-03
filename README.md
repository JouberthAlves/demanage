# deManage

Gestão de despesas mensais.

## Estrutura

```
deManage/
  frontend/   # React + Vite + TypeScript
  backend/    # Express + TypeScript
```

## Desenvolvimento

### Frontend

```bash
cd frontend
pnpm install
pnpm dev
```

App em `http://localhost:5180`

### Backend

```bash
cd backend
pnpm install
cp .env.example .env
pnpm dev
```

API em `http://localhost:8888` (`GET /health`)

## Fase 1

- UI dark neon (Dashboard, Perfil, Despesas, Entradas)
- Dados locais via Zustand + localStorage
- Sem login/auth (fase 2)
