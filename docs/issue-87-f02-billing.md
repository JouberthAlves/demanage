# Issue #87 — F02: competências históricas de despesas no cartão

## Contrato de segurança implementado

- O fechamento de cartão usa versões de obrigação por competência (`ExpenseObligationVersion`), preservando valor e divisões em centavos. Alterações financeiras recorrentes geram uma versão com vigência no mês da alteração; o backfill não pode projetar valores novos sobre competências anteriores com snapshots existentes.
- Para linhas legadas sem prova histórica suficiente, alterações potencialmente destrutivas permanecem bloqueadas até executar `POST /cards/process-billing`. Faturas liquidadas não podem ser reescritas; alterações de frequência/agenda com pagamentos confirmados continuam bloqueadas.
- Um cadastro **novo** de despesa recorrente com cartão que possua ocorrências já cobertas por `card.lastInvoicedOn` recebe **409** antes de qualquer INSERT. Isso evita perder silenciosamente competências anteriores. Exemplo: cartão fechou 05/09; em 10/09, mensal R$100 com início 01/09 e dia 1 é recusada, porque setembro já foi fechado. Uma recorrência com início 07/09 e vencimento no dia 10 segue permitida.
- A verificação considera a criação e a última fatura de cada cartão envolvido, com contagem semanal e ajuste do dia 31 idênticos aos cálculos do planejador. Split com dois cartões também precisa passar em ambos. A guarda roda sob o lock transacional do usuário.

## Verificação e limites

`backend/src/lib/billing/retroactive-recurring.test.ts` cobre os limites dos ciclos; `retroactive-recurring.itest.ts` cobre 409 atômico e um cadastro permitido no PostgreSQL. A integração real exige PostgreSQL descartável e deve passar no CI antes de liberação.

O contrato **não** recupera valores históricos que tenham sido sobrescritos antes da implantação da versão por competência, nem edita automaticamente faturas já fechadas. Para efetivar um débito retroativo desse tipo, é necessário um fluxo contábil separado com ajuste auditável, autorizado e idempotente — não um POST recorrente que altera o passado. Nenhuma migração deve imputar valores passados sem evidência.

Sem merge ou deploy de produção antes de CI, revisão e aprovação.
