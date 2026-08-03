# CODING_STYLE.md — Regras de digitação de código

Padrão obrigatório para TypeScript/JavaScript neste projeto (frontend e backend).

## Aspas

- Preferir **aspas simples** (`'...'`) sempre que possível.
- Usar aspas duplas só quando necessário (ex.: string com apóstrofo: `"don't"`), ou em JSX attributes quando a convenção do arquivo exigir — no restante do TS/TSX, strings de valor usam simples.
- Em imports, paths e props string: aspas simples.

```ts
// ❌
import { Button } from "@/components/ui/button"
const label = "Despesas"

// ✅
import { Button } from '@/components/ui/button';
const label = 'Despesas';
```

## Ponto e vírgula

- **Sempre** terminar statements com `;`.
- Inclui: imports, declarações, assigns, returns, expressão de chamada, etc.

```ts
// ❌
const total = 10
export function sum(a: number, b: number) {
  return a + b
}

// ✅
const total = 10;
export function sum(a: number, b: number) {
  return a + b;
}
```

## Outras regras alinhadas

- Arquivos: **kebab-case** (`expense-form-dialog.tsx`).
- Componentes/páginas: `export function NomePascalCase`.
- Tipos: `export type` preferível a `interface`, salvo necessidade.
- `import type { ... }` para tipos (`verbatimModuleSyntax`).
- Sem default exports em páginas/componentes de app.
- Indentação: 2 espaços.
- Trailing comma em multilinha quando fizer sentido (objetos/arrays/params).

## JSX

```tsx
// ✅
<Button variant='outline' onClick={handleSave}>
  Salvar
</Button>
```

ClassNames longos do Tailwind podem permanecer em uma string com aspas simples.

## O que não formatar à mão sem necessidade

- Arquivos gerados de `components/ui/*` (shadcn): ao adicionar/atualizar via CLI, rode o formatador do projeto em seguida.
- `node_modules/`, `dist/`.

## Formatador

Configuração em `frontend/.prettierrc` e `backend/.prettierrc`:

- `singleQuote: true`
- `semi: true`
- `trailingComma: "all"`

```bash
cd frontend && pnpm format
cd backend && pnpm format
```

Agents devem escrever código novo já neste estilo e, se editarem um arquivo antigo fora do padrão, alinhar o arquivo editado.
