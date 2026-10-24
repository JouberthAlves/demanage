# deManage: ensaio de CI local (publicação suspensa)

Este canal conserva a validação local e o ensaio de migrações. **A opção `--publish` está bloqueada**: um commit direto na branch `production` não fornece a prova de aprovação do ambiente GitHub `production` exigida pelo agente Debian. Para uma promoção real, use o workflow hospedado `Approve production release`. Ele continua responsável pela publicação do manifesto, enquanto o agente Debian cuida de **backup, journal, pull por digest, health e rollback de backend/frontend**.

## Limites e aprovações

- Somente uma identidade `gh auth` que devolva `bielxdh3` pode aprovar.
- O ensaio exige **SHA completo e confirmação exata**. `--publish` falha fechado, mesmo com `--acknowledge-no-codeql`.
- A revisão alvo deve ser **a atual `origin/master`** e a revisão anterior deve coincidir com o estado do agente Debian e o manifesto vigente. Nunca reescrever `master`, checks, ou state.json.
- O CI precisa rodar **os 24 gates** (incluindo builds Docker) no SHA exato, sem mudanças Git rastreadas. `local-ci-evidence.json` registra SHA, hashes de todos os logs, timestamp e número de gates; a aprovação revalida o conteúdo. Logs são locais e auditáveis.
- Mudanças em Prisma exigem um **ensaio fresco sobre um dump real restaurado num Postgres 18 descartável, sem porta pública**, SHA256 do dump, imagem por digest e confirmação explícita do dono. Migrações existentes alteradas/removidas, SQL destrutivo ou mudanças em entrypoint/Compose-base são proibidas neste canal.
- O ensaio não publica `production.json`. O workflow hospedado gera o atestado vinculado aos bytes exatos do manifesto antes de publicá-lo.
- O agente Debian faz o restante. O **rollback é somente da aplicação**; o schema aditivo continua. Se a migração ou o rollback falhar, investigar a journal/estado sem forçar manualmente o manifesto nem restaurar o banco às cegas.

## Procedimento completo

1. Integrar alterações na `master`. Num checkout **limpo desse SHA**, executar:

   ```powershell
   $sha = (git rev-parse HEAD).Trim()
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ci-local.ps1 -BuildImages
   ```

   Anotar o caminho de `local-ci-evidence.json` exibido. Nenhum CI hospedado é disparado por esse comando.

2. Publicar **ambas** as imagens Linux/amd64 do mesmo commit no GHCR, com labels `org.opencontainers.image.revision=$sha`, e confirmar acesso externo por digest. Use `docker login ghcr.io` na estação do proprietário, **não no Debian**. Nunca usar tag mutável como identidade final.

3. Para uma revisão com migrações novas, instalar a ferramenta aprovada no Debian, conservando o agente atual:

   ```powershell
   scp .\ops\cd\local_migration_rehearsal.py servidor:/opt/demanage/cd/
   ```

   Rodar a ferramenta com o digest imutável do **backend**:

   ```bash
   python3 /opt/demanage/cd/local_migration_rehearsal.py \
     --config /opt/demanage/cd/config.json \
     --source-commit SHA_COMPLETO \
     --backend-ref ghcr.io/bielxdh3/demanage-backend@sha256:DIGEST_REAL
   ```

   Ela cria **outro** dump privado antes da revisão, restaura-o em Postgres temporário, executa somente nesse banco `prisma migrate deploy` e grava `local-migration-rehearsal.json` na pasta privada do backup; a produção fica intocada. Revisar os arquivos SQL, os registros da restauração e o SHA256 do dump. O projeto mantém os bancos temporários separados e os remove ao final.

4. Na estação autenticada como dono, validar primeiro sem publicação:

   ```powershell
   python .\ops\cd\local_release_approval.py `
     --source-commit SHA_COMPLETO `
     --confirm-sha SHA_COMPLETO `
     --log-directory 'CAMINHO_ABSOLUTO_DOS_LOGS_CI' `
     --migration-proof '/opt/demanage/backups/cd-.../local-migration-rehearsal.json' `
     --confirm-migration-backup-sha256 'SHA256_REAL_DO_DUMP'
   ```

   Para revisões **sem mudanças Prisma** omitir as duas últimas opções. `RELEASE_GATE=PASS` comprova somente os gates locais; para publicação, executar o workflow hospedado e aprovar o ambiente protegido no GitHub.

5. Após o workflow hospedado concluir com sucesso, verificar no GitHub que `production.json` aponta o novo SHA, anterior correto e duas imagens por digest. Aguardar o timer do agente ou executá-lo normalmente com `python3 /opt/demanage/cd/deploy_agent.py --config /opt/demanage/cd/config.json`. Ele verifica também a proveniência da aprovação, Compose, backend, banco, versão e faz novo dump antes de alterar a aplicação.

6. Conferir depois: `/api/health` HTTPS, frontend carregando, revisão real dos dois containers, PostgreSQL saudável, **mesmo volume e identidade do banco**, Cloudflare Tunnel intacto, journal ausente, estado do agente no novo SHA e `prisma migrate status` sem pendências. MCP só pode ser ativado com segredo OAuth apropriado e novo consentimento.

## Não fazer

- Não fingir que o CodeQL hospedado executou. A ausência é registrada e exige aceite explícito.
- Não publicar uma revisão testada em outro SHA ou quando `master` avançou.
- Não rodar `migrate deploy` contra a produção antes de aprovar as evidências, nem executar `docker compose down -v`, `docker volume rm` ou alterar o Tunnel.
- Não deixar dumps, segredos, tokens ou logs privados em commits ou PRs.

Para migrações destrutivas, use um runbook independente aprovado por revisão e plano de recuperação real, não esta via automática.
