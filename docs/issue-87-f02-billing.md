# Issue #87 · F02 — fechamento atrasado de despesas de cartão

O schema atual guarda apenas o valor, a agenda e os splits **atuais** da
despesa. O fechamento percorre competências anteriores e aplica esses campos
atuais a todas elas. Portanto, editar em outubro uma obrigação de agosto e
setembro ainda não faturada pode alterar silenciosamente os valores passados.

## Política segura implementada (sem migração)

- `PATCH /expenses/:id` que altera valor, frequência, agenda ou splits/cartão
  recebe **409** enquanto qualquer cartão afetado tiver fechamento pendente.
- `DELETE /expenses/:id` (arquivamento) obedece à mesma regra para preservar
  cobranças passadas. Edições apenas de nome/notas/categoria não recalculam
  cobranças e continuam disponíveis.
- O usuário deve executar `POST /cards/process-billing` e então repetir a
  operação. O bloqueio e o fechamento usam o mesmo lock por usuário.
- Exemplo: cartão fecha dia 31; obrigação de R$ 100 com cartão 60% em agosto e
  setembro; tentativa de editar em outubro para R$ 200/cartão 75% é bloqueada
  até emitir agosto e setembro (R$ 60 cada). Depois, outubro em aberto emite
  R$ 150 no cartão após a edição.

## Limites

Esta política **não reconstrói** versões históricas já perdidas, nem corrige
faturas produzidas anteriormente com valores incorretos. Ela impede nova
reescrita decorrente de edições pelo serviço. Caso o fechamento do próprio mês
da edição já esteja vencido, ele também precisa ser emitido com o valor anterior;
o novo valor passará a valer nos ciclos abertos seguintes. Editar diretamente o
PostgreSQL ou por outros escritores fora do serviço não é coberto pela trava.

Para permitir edição retroativa por competência sem fechamento prévio seria
necessário persistir revisões atômicas e imutáveis de valor, splits e agenda,
com vigência explícita por competência, adaptar o planejador e definir o
tratamento de dados legados sem histórico. Uma migração que atribua um valor
histórico presumido aos ciclos anteriores não é segura.
