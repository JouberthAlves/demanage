# Registro de auditoria e correções — 29/09/2026

## Estado inicial

- Repositório: `bielxdh3/demanage`; checkout Git em `E:\deManage\demanage-work`.
- Branch de entrega: `codex/security-ci-roadmap-remediation`.
- SHA inicial e `origin/master` no começo da revisão: `cf872de0fd6d44c96abb04a0009dd69187f9b727`.
- Após `git fetch origin`, o HEAD de trabalho continua em `cf872de0fd6d44c96abb04a0009dd69187f9b727`; `origin/master` avançou para `721023eb90942b07a1cb777443a0dc4e4daf3a13` (merge do PR #32, `Cache-Control: no-store`). A cópia local inclui essa alteração e ainda precisa integrar o commit de merge na branch de entrega antes da publicação.
- O diretório pai `E:\deManage` não é um checkout Git. Nenhum arquivo fora do clone foi alterado.
- GitHub autenticado: Issues/Discussions estão desativadas (`has_issues=false`); o endpoint de issues retorna zero itens acessíveis, então não é possível afirmar que não havia itens históricos. No estado verificado não há PR aberto. PR #32 foi mergeado; seu job `frontend` falhou no lint, enquanto backend, CodeQL e Dependency Review passaram. PRs Dependabot #28 e #30 foram fechados sem merge e substituídos por #29 e #31; os demais PRs verificados estão mergeados.
- Secret scanning: zero alertas abertos; secret scanning e push protection estão habilitados.
- CI mais recente do `master` (`721023eb90942b07a1cb777443a0dc4e4daf3a13`, run `36590980205`): backend passou; frontend falhou em `expense-form-dialog.tsx:254` por `no-useless-assignment`. A cópia local corrigida passa no lint. CodeQL do mesmo estado passou.
- Produção: inspeção somente de leitura por SSH confirmou o app e endpoints de saúde ativos. A configuração Compose de produção no servidor tem alteração local intencional e há backup local no host; ambos devem ser preservados. Não houve escrita no servidor, migration ou deploy.

## Dependabot — 17 alertas abertos no SHA inicial

As versões abaixo são as versões corrigidas mínimas revalidadas no snapshot do Dependabot. Os lockfiles locais foram atualizados; todos os alertas ainda precisam de um novo scan no GitHub.

| Alerta | Dependência afetada | Resolução vulnerável no lock inicial | Correção local | Situação |
|---|---|---:|---:|---|
| #1, #9, #11, #14, #19 | `js-yaml` — backend | 4.1.0 | 4.3.2 | Lock atualizado; aguardando scanner |
| #5 | `minimatch` — backend | 3.1.2 | 3.1.4 | Atualizado para cobrir também o advisory #4 (auto-dismissed); instância 10.x preservada |
| #7 | `flatted` — backend | 3.3.3 | 3.4.2 | Lock atualizado; aguardando scanner |
| #10 | `brace-expansion` — backend | 1.1.12 | 1.1.21 | Override limitado ao major 1; a instância 5.x foi preservada |
| #15 | `deepmerge-ts` via `@prisma/config` — backend | 7.1.5 | 8.0.2 | Override limitado ao pai; validar Prisma antes de considerar concluído |
| #16, #18 | `mysql2` — backend | 3.15.3 | 3.23.1 | Lock atualizado; aguardando scanner |
| #17 | `@humanfs/node` — backend | 0.16.7 | 0.16.8 | Lock atualizado; aguardando scanner |
| #21 | Rollup — frontend | 4.52.5 | Ausente na árvore atual | Vite 8 usa Rolldown; `pnpm why rollup` não encontra instância e o build Vite/SVGR passou |
| #22, #23 | `picomatch` 2.x — frontend | 2.3.1 | 2.3.2 | Lock atualizado; as instâncias 4.x foram preservadas |
| #53, #54 | `browserslist` — frontend | 4.26.3 | 4.28.7 | Lock atualizado; aguardando scanner |

O backend usa overrides compatíveis com os majors atuais para `ajv@6` 6.14.0 (alerta #2, auto-dismissed), `minimatch@3` 3.1.4, `brace-expansion@1` 1.1.21 e os demais pacotes da tabela. `pnpm audit --audit-level=moderate` retorna “No known vulnerabilities found” nos dois workspaces após as atualizações locais. `pnpm install --frozen-lockfile` passou no backend e frontend. Os 17 alertas do snapshot ainda aguardam atualização do scanner.

## Code Scanning — 13 alertas no SHA inicial

| Alerta | Regra/local | Triagem | Ação e situação |
|---|---|---|---|
| #1 | `js/missing-token-validation`, `backend/src/server.ts:113` | CSRF confirmado: CORS não bloqueia envio de formulários e mutações autenticadas podem ser bodyless com cookie cross-site. | Middleware central valida Origin/Referer em métodos inseguros quando há cookie; testes unitários adicionados. Aguardar CodeQL no novo SHA. |
| #2 | `js/log-injection`, `backend/src/middlewares/request-logger.ts:41` | O logger anterior aceitava dados de request sem sanitização suficiente. | Logger atual remove caracteres de controle, limita comprimento e usa o IP derivado de `req.ip`; teste unitário cobre entrada forjada. A disposição remota aguarda novo CodeQL. A confiança do proxy permanece condicionada a ingress somente por Cloudflare Tunnel. |
| #3 | `js/user-controlled-bypass`, `require-auth.ts:18` | Falso positivo: assinatura e expiração JWT, lookup do usuário e comparação de `sessionVersion` ocorrem antes de autorizar. | Disposição individual registrada; não dispensar manualmente. |
| #4 | `auth.ts:36`, nome obrigatório | Falso positivo: validação de cadastro, sem decisão de permissão. | Disposição individual registrada. |
| #5 | `auth.ts:36`, e-mail obrigatório | Falso positivo: validação de cadastro, seguida por normalização e unicidade. | Disposição individual registrada. |
| #6 | `auth.ts:36`, senha obrigatória | Falso positivo: validação de entrada, seguida por formato e hash. | Disposição individual registrada. |
| #7 | `auth.ts:42`, formato de senha | Falso positivo: filtro de entrada antes do hash. | Disposição individual registrada. |
| #8 | `auth.ts:94`, e-mail de login | Falso positivo: campo obrigatório; depois há lookup e comparação do hash da senha. | Disposição individual registrada. |
| #9 | `auth.ts:94`, senha de login | Falso positivo: campo obrigatório; não contorna a comparação do hash. | Disposição individual registrada. |
| #10 | `auth.ts:159`, campos de recuperação | Falso positivo: validação de forma; o código é verificado antes da alteração de senha. | Disposição individual registrada. |
| #11 | `auth.ts:159`, código de recuperação | Falso positivo: comparação com hash armazenado antes da alteração. | Disposição individual registrada. |
| #12 | `auth.ts:159`, nova senha | Falso positivo: conteúdo validado e hasheado, sem autorização por valor controlado pelo usuário. | Disposição individual registrada. |
| #13 | `auth.ts:166`, formato da nova senha | Falso positivo: validação de conteúdo antes do hash e da rotação de sessão. | Disposição individual registrada. |

## Outros achados confirmados

| Achado | Correção em andamento | Validação pendente |
|---|---|---|
| Saques/depositos do cofrinho, saldo de ativos e confirmação de eventos podiam correr em paralelo | Escritas financeiras serializadas por `SELECT ... FOR UPDATE` na linha do usuário; pagamento/recebimento também grava os eventos no mesmo lock. Validações e leituras de saldo ficam dentro da transação. | Teste de integração PostgreSQL da exclusão mútua adicionado; precisa rodar no CI com PostgreSQL. |
| Reprocessamento concorrente podia duplicar fatura de cartão ou calcular juros CDI com saldo desatualizado | Cobrança, watermark de CDI e novos eventos são serializados e atômicos; o catch-up de CDI recarrega transações sob lock antes de calcular. | Testes de unidade/build passaram; teste de concorrência com PostgreSQL precisa do CI. |
| Logs aceitavam caracteres de controle e liam XFF bruto | Sanitização/bound aplicados no logger; IP usa `req.ip`. | Teste unitário passou; topologia final do proxy ainda depende de confirmar Cloudflare Tunnel como único ingresso. |
| Logout limpava apenas cookie local | JWT verificado incrementa `sessionVersion`; falha de banco não impede limpar cookie local. A ação encerra sessões em todos os dispositivos e a interface informa isso. | Testes backend e build frontend. |
| Datas de consulta financeira permitiam intervalos ilimitados/inválidos; base patrimonial antiga podia deixar histórico ilegível | Market-data limita consultas a cerca de dez anos, rejeita futuro e valida calendário. Bases salvas antigas são preservadas; o cálculo aplica uma janela visível limitada sem rejeitar o saldo-base existente. | Teste unitário da base antiga e validações de market-data passaram. |

## Produto e roadmap

- Por decisão do usuário, o histórico mensal conta somente eventos efetivos. A migration adiciona `ExpensePayment` e `EntryReceipt`; despesas mensais entram após confirmação do pagamento, salários após confirmação manual e entradas avulsas após a ação `Já recebi`. O valor fica preservado por ciclo/evento mesmo se o cadastro mudar. Uma recorrência apenas vencida/agendada não conta.
- Despesas avulsas contam pela data de ocorrência. Entradas avulsas não contam pela data prevista: a rota de confirmação cria um registro único de recebimento, e somente essa data/quantia entra no histórico. Recorrências semanais sem confirmação por ocorrência e outras entradas recorrentes sem confirmação não aparecem. Faturas de cartão sem baixa permanecem fora e agora aparecem como `Fatura pendente`, sem serem rotuladas `Pago`.
- A migration recupera apenas o último mês confirmado que o schema antigo mantinha. Ela usa o valor atual do cadastro, pois a versão anterior não guardava o valor pago/recebido na confirmação; se o cadastro foi editado depois do evento, a quantia histórica original não pode ser garantida. Ciclos anteriores sobrescritos não podem ser reconstruídos.
- O lint apontado foi corrigido. A revisão de interface associou labels aos selects, erros de autenticação ao campo/formulário correspondente, e nomes acessíveis às ações de editar/excluir. Validações do formulário de despesa apontam e focam o campo inválido.

## Validações locais e pendências

- Backend: Prisma format/generate/validate e build passaram; lint passou com 46 warnings (principalmente import-sort); 32 testes unitários sem dependência do banco passaram. O teste PostgreSQL `user-write-transaction.test.ts` não foi executado porque o Docker daemon está indisponível. Os testes de handler de logout, CSRF, logs, origem, mercado, patrimônio e CDI estão incluídos.
- Frontend: `pnpm install --frozen-lockfile`, lint, teste, build (`tsc -b` incluído) e `pnpm audit --audit-level moderate` passaram após adicionar `tsx` como ferramenta de teste. O lint tem 54 warnings de import-sort/fast-refresh; o build informa os avisos de Vite sobre `__dirname`, chunk >500 kB e import dinâmico sem code-splitting.
- Histórico mensal: `pnpm test` executou 5/5 testes; datas previstas, passadas ou futuras de uma entrada avulsa não entram sem recibo com data/valor. O job de CI frontend agora também executa `pnpm test`.
- Backend: `pnpm lint` e `pnpm build` passaram após expandir a rota de recebimento para entradas avulsas; o teste local disponível passou 32/32. `user-write-transaction.test.ts` foi excluído localmente por exigir PostgreSQL; a CI tem serviço PostgreSQL e executa migrations antes dos testes.
- `git diff --check` passou depois de normalizar `frontend/src/stores/auth-store.ts` para LF.
- Auditoria local de dependências passou nos dois workspaces, sem vulnerabilidades moderadas conhecidas.
- Compose: as configurações local e de produção já haviam passado em `docker compose ... config --quiet`; isso não valida execução dos containers. O Docker daemon está indisponível neste momento.
- GitHub ainda mostra 17 alertas Dependabot e 13 Code Scanning abertos, todos associados ao `master` SHA `721023eb90942b07a1cb777443a0dc4e4daf3a13`; ainda não há scan no candidato. Dependabot: #1, #5, #7, #9–#11, #14–#19, #21–#23 e #53–#54. CodeQL: #1–#13. Não foram dispensados alertas manualmente.
- A CI remota mais recente do `master` falhou somente no lint de frontend conhecido; o candidato ainda precisa ser integrado à base atual, publicado em PR e validado pela CI/CodeQL/Dependency Review no SHA exato.
- O deploy continua pendente; além de revalidar o estado/configuração no servidor e preparar rollback sem sobrescrever a customização local intencional, falta validar com PostgreSQL a nova ramificação de confirmação de entrada avulsa e confirmar todos os gates no SHA candidato.
- Nenhuma transação financeira real, migration de produção ou mudança no servidor foi executada.

## Revisão visual de UI/UX

- Com autorização do usuário, o navegador interno exibiu e foram inspecionadas as telas de login, cadastro e recuperação de senha em largura de 510 px. Os rótulos e ações principais estavam visíveis, sem overflow horizontal observado; cadastro e recuperação exigiam rolagem vertical.
- O dashboard protegido e o histórico não foram inspecionados visualmente: não havia conta/banco de teste isolados e o Docker estava indisponível. Os screenshots foram inspecionados na sessão do navegador, mas não puderam ser salvos no workspace; a política do navegador recusou a URL de dados usada pela operação de salvamento e não há API de gravação direta disponível. Não foi feita tentativa alternativa.

## Revisões independentes

- Integridade financeira confirmou que os eventos permanecem após alterar a frequência e que o lookback patrimonial respeita o limite inclusivo de 3.663 dias.
- Segurança/supply chain não confirmou risco adicional na rodada final. A revisão direcionada da nova rota de entrada avulsa confirmou lookup por `{ id, userId }`, transação com lock por usuário e proteção contra duplicação entre meses.
- Product/QA identificou contagem automática de entrada avulsa prevista, lacunas de confirmação para recorrências semanais/outras entradas recorrentes, faturas chamadas de pagas sem baixa, botões sem nomes acessíveis e limite de precisão da backfill. Foram corrigidos contagem/fluxo de entrada avulsa, rótulo de fatura e nomes acessíveis; o limite da migration foi documentado. Confirmações semanais, confirmação de outras entradas recorrentes e baixa de fatura seguem limitações declaradas.

## Atualização do PR #41 — 29/09/2026 (horário GitHub: 30/09 UTC)

- PR: [JouberthAlves/demanage#41](https://github.com/JouberthAlves/demanage/pull/41), base `master` (`b5fc8af94d45416e8ecab27e4f433f40fda800fb`), head `codex/security-ci-roadmap-remediation` (`50d836b70b0066d8f1cf764d51cd5322c9283329`). O PR está aberto e não foi mergeado.
- CI do candidato passou nos jobs `backend` e `frontend`; o backend aplicou as migrations com PostgreSQL no CI. O workflow CodeQL terminou com sucesso, mas o check de segurança do PR falhou porque relatou 12 achados como novos na diff (11 altos e 1 médio). A validação abaixo não encontrou bypass nesses fluxos e nenhum alerta foi dispensado manualmente.

| Alertas do PR | Local atual | Validação | Disposição |
|---|---|---|---|
| #3–#5 | `backend/src/routes/auth.ts:41` | Campos obrigatórios de cadastro: nome/e-mail são normalizados; senha ainda passa pela lista de caracteres e tamanho mínimo antes do hash. Cadastro é público por definição e não autoriza acesso a conta existente. | Falsos positivos de `js/user-controlled-bypass`; sem bypass de permissão. |
| #6 | `backend/src/routes/auth.ts:47` | Rejeita senha vazia ou diferente da saída da lista de caracteres permitidos; também há tamanho mínimo antes do hash. | Falso positivo de `js/user-controlled-bypass`; validação de entrada. |
| #7–#8 | `backend/src/routes/auth.ts:99` | Presença de e-mail/senha só evita entrada incompleta. Login compara a senha com o hash armazenado e devolve 401 se não coincidir. | Falsos positivos de `js/user-controlled-bypass`; a decisão de login usa o resultado da comparação, não a presença do campo. |
| #9–#11 | `backend/src/routes/auth.ts:164` | Presença dos campos não autoriza a recuperação. O código informado é comparado com o hash armazenado em `auth.ts:189–196` antes da atualização. | Falsos positivos de `js/user-controlled-bypass`; a alteração exige código válido. |
| #12 | `backend/src/routes/auth.ts:171` | Lista de caracteres e tamanho mínimo validam a nova senha. A senha só é gravada depois da verificação do código de recuperação; a atualização também incrementa `sessionVersion`. | Falso positivo de `js/user-controlled-bypass`; validação de entrada. |
| #13 | `backend/src/middlewares/request-logger.ts:48` | IP, método e URL passam por `sanitizeLogValue`, que substitui controles C0/C1 e separadores de linha e limita o tamanho. O teste cobre CRLF, escape ANSI e truncamento. | Falso positivo de `js/log-injection`; controles removidos antes do log. |
| #14 | `backend/src/server.ts:69` | `cookieParser()` é seguido imediatamente por `csrfProtection` global na linha 70. Em métodos inseguros com cookie, o middleware exige Origin/Referer permitido. Testes de unidade cobrem origem externa/ausente e origem confiável. | Falso positivo de `js/missing-token-validation`; o CodeQL não reconheceu o middleware customizado. |

- Validação de interface para CSRF, executada localmente em modo de produção com `APP_URL` de teste e URL de banco fictícia: preflight `OPTIONS` de `https://attacker.example` para `POST application/json` não recebeu `Access-Control-Allow-Origin`; `POST` com cookie de sessão e origem externa recebeu 403 sem `Set-Cookie`; formulário `text/plain` sem cookie recebeu 500 sem `Set-Cookie`, pois `express.json()` não parseou o corpo e o handler terminou antes de consultar o banco. Nenhuma requisição acessou produção.
- O CodeQL do PR apresenta os mesmos padrões de alertas de entrada já existentes na base; as novas localizações nas linhas alteradas são cobertas pelas verificações de formato e pelas comparações de credencial descritas acima. As linhas exatas, caminhos de dados e resultados da reprodução estão registrados no artefato de validação associado a esta revisão.
- `Dependency Review` falhou antes de analisar dependências: `JouberthAlves/demanage` tem Dependency Graph desativado. O endpoint de alertas Dependabot do repositório-alvo confirma que alertas estão desativados. O fork `bielxdh3/demanage` ainda mostra 17 alertas abertos no SHA de `master` `721023eb90942b07a1cb777443a0dc4e4daf3a13`; as correções locais de lockfile aguardam novo scan após atualização/merge.
- Issues continuam desativadas. A implantação segue bloqueada enquanto os checks `CodeQL` e `Dependency Review` do PR estiverem vermelhos. Nenhuma dispensa manual, merge, migration de produção ou alteração SSH foi feita.

**Correção de escopo:** o parágrafo acima registra somente o estado histórico do PR #41 no repositório upstream `JouberthAlves/demanage`. O PR #41 não é gate de entrega. O alvo desta missão é o fork `bielxdh3/demanage`, pelo PR #33.

## Atualização do PR correto e advisories recentes — 30/09/2026

- PR de entrega: [bielxdh3/demanage#33](https://github.com/bielxdh3/demanage/pull/33), base `master` no SHA `721023eb90942b07a1cb777443a0dc4e4daf3a13`. Antes da correção de dependência, o head era `084e1e8bb3c93446d84efa1728bab93e4c3383ed`.
- `Dependency Review` nesse head identificou `brace-expansion@1.1.18`. Duas advisories altas recentes exigem `1.1.20`; a auditoria local encontrou também a advisory moderada GHSA-q2hr-2g5m-vwhr, que exige `1.1.21`. As três foram confirmadas na GitHub Advisory Database.
- A correção local altera somente o override `brace-expansion@1` para `1.1.21` e sua resolução no lockfile. `minimatch@3.1.4` aceita essa versão pela faixa `^1.1.7`; `brace-expansion@5.0.12` permanece separado.
- Validação local dessa mudança: instalação congelada e audit backend passaram; os quatro inputs de reprodução publicados para recursão, lista de argumentos, nesting e reescrita quadrática terminaram sem exceção ou demora relevante; lint e build do backend passaram. `pnpm test` teve 8 testes aprovados e 7 arquivos não inicializados porque o ambiente local não definiu `DATABASE_URL`; a CI do backend com PostgreSQL ainda deve validar o novo SHA.
- Os checks remotos do PR #33 precisam ser atualizados no head com `1.1.21`. O CodeQL alert gate também requer reconciliação dos 12 achados já validados no próprio fork, com justificativas individuais. Até esses resultados serem confirmados, o merge e o deploy continuam pendentes.
- O upstream #41 não bloqueia a entrega do fork. Não houve merge, migration de produção nem escrita no servidor nesta atualização.
