# deManage: promoção por CI local (sem minutos de GitHub Actions)

Este é um **canal alternativo explícito**, autorizado pelo dono `bielxdh3`; não simula GitHub CI nem CodeQL. O workflow hospedado e a proteção da `master` continuam inalterados. O manifesto publicado conserva o mesmo formato que o agente Debian já valida, e o agente existente continua responsável por **backup, journal, pull por digest, health e rollback de backend/frontend**.

## Limites e aprovações

- Somente uma identidade `gh auth` que devolva `bielxdh3` pode aprovar.
- Aprovar exige **SHA completo e confirmação exata**; publicar exige `--publish --acknowledge-no-codeql`, sem os quais somente há simulação.
- A revisão alvo deve ser **a atual `origin/master`** e a revisão anterior deve coincidir com o estado do agente Debian e o manifesto vigente. Nunca reescrever `master`, checks, ou state.json.
- O CI precisa rodar **os 24 gates** (incluindo builds Docker) no SHA exato, sem mudanças Git rastreadas. `local-ci-evidence.json` registra SHA, hashes de todos os logs, timestamp e número de gates; a aprovação revalida o conteúdo. Logs são locais e auditáveis.
- Mudanças em Prisma exigem um **ensaio fresco sobre um dump real restaurado num Postgres 18 descartável, sem porta pública**, SHA256 do dump, imagem por digest e confirmação explícita do dono. Migrações existentes alteradas/removidas, SQL destrutivo ou mudanças em entrypoint/Compose-base são proibidas neste canal.
- Aprovação publica apenas `production.json` na branch `production` via API do GitHub com `sha` de concorrência e commit auditável. Não instala runner no servidor nem manda credenciais SSH para GitHub.
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

   Para revisões **sem mudanças Prisma** omitir as duas últimas opções. Com resultado `RELEASE_GATE=PASS` e evidências revisadas, repetir o comando acrescentando **`--publish --acknowledge-no-codeql`**.

5. Verificar no GitHub que `production.json` aponta o novo SHA, anterior correto e duas imagens por digest. Aguardar o timer do agente ou executá-lo normalmente com `python3 /opt/demanage/cd/deploy_agent.py --config /opt/demanage/cd/config.json`. Ele verifica Compose, backend, banco, versão e faz novo dump antes de alterar a aplicação.

6. Conferir depois: `/api/health` HTTPS, frontend carregando, revisão real dos dois containers, PostgreSQL saudável, **mesmo volume e identidade do banco**, Cloudflare Tunnel intacto, journal ausente, estado do agente no novo SHA e `prisma migrate status` sem pendências. MCP só pode ser ativado com segredo OAuth apropriado e novo consentimento.

## Não fazer

- Não fingir que o CodeQL hospedado executou. A ausência é registrada e exige aceite explícito.
- Não publicar uma revisão testada em outro SHA ou quando `master` avançou.
- Não rodar `migrate deploy` contra a produção antes de aprovar as evidências, nem executar `docker compose down -v`, `docker volume rm` ou alterar o Tunnel.
- Não deixar dumps, segredos, tokens ou logs privados em commits ou PRs.

Para migrações destrutivas, use um runbook independente aprovado por revisão e plano de recuperação real, não esta via automática.
