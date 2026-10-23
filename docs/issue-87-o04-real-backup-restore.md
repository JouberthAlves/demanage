# Issue #87 / O04 — regressão real de backup e restauração

O teste `scripts/tests/backup-db.tests.ps1` cobre seis condições com um Docker
simulado, **mas não prova a validade física de um dump PostgreSQL**.

O job `backup-restore` de `.github/workflows/ci.yml` executa a nova regressão
`scripts/tests/backup-db.e2e.ps1` em um runner Linux descartável:

1. Inicia um **PostgreSQL 18 real**, imagem fixada por SHA256, num container
   temporário `demanage-db`, sem publicação de portas e sem rede, com label
   `org.demanage.o04.owner=<run_id>-<run_attempt>`.
2. Confere esse label antes de **qualquer** acesso ao container. Falha sem
   `GITHUB_ACTIONS=true`, `CI=true` e `RUNNER_TEMP`.
3. Insere quatro linhas na base descartável `demanage`, cobrindo `numeric`,
   NULL, Unicode, aspas e quebras de linha.
4. Copia **sem modificar** o arquivo `backup-db.ps1` para uma pasta privada de
   `RUNNER_TEMP`. O script real executa `docker exec pg_dump --format=custom`
   e `docker cp`; o arquivo produzido deve ser não vazio.
5. Executa `pg_restore --list` sobre o dump, restaura-o com
   `pg_restore --exit-on-error` em **outro banco** criado exclusivamente para
   esse teste e compara SHA256 de linhas ordenadas e serializadas sem ambiguidade
   entre origem e destino. O dump também recebe SHA256 próprio para auditoria.
6. Remove apenas o banco temporário de restore, o dump intermediário e a pasta
   privada; o job remove seu container **somente se o label conferir**, incluindo
   o volume anônimo criado pelo Docker.

O job `backend`, obrigatório no ruleset de `master`, depende de `backup-restore`
e falha explicitamente se a regressão não concluir com sucesso. Assim, não se
obtém um `backend` verde com O04 quebrado, mesmo que `backup-restore` não seja
um check obrigatório separado nas configurações do GitHub.

## Limites

- Este ensaio verifica um dump e uma restauração **reais**, mas de **dados
  sintéticos**; não é prova de restauração de snapshot da produção, criptografia,
  retenção remota, backup offsite ou recuperação operacional de um desastre.
- O contrato é baseado no nome `demanage-db` que `backup-db.ps1` já exige;
  por segurança, o ensaio recusa um container sem o label exato da execução.
- Para execução end-to-end, o job precisa rodar no **GitHub Actions Ubuntu**,
  onde estão instalados Docker e PowerShell 7. Os testes com mock e análise
  sintática locais não substituem um run verde do novo job.
- Não usar esse teste para se conectar ao Debian, reaproveitar uma base de
  desenvolvimento ou alterar configurações de produção.
