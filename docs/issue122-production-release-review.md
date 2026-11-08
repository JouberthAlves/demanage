# deManage Issue122 — revisão de liberação única para produção

## Escopo e decisão

Esta liberação **não** relaxa o bloqueio geral de migrations/Compose. O
workflow protegido `Approve production release` aceita exclusivamente:

- Versão atualmente executada: `15237faaf0bbd380d27494a1bfd87993ca8e28ca`
- Versão de aplicação validada: `13f860b851d1e2a8ae8789bfe2aeb99909d73be4`
- Backend OCI: `sha256:94a18c18b5aec3c58a254bd3092f1cef8fbc58eea7164f58e3ec89ace3ab55dd`
- Frontend OCI: `sha256:f9436c6899b7f94ba15025593b3b1e300723b7ac7be78b416a35000c958f9025`
- Diferença sensível exata: uma nova migration, `backend/prisma/schema.prisma`
  e `docker-compose.prod.yml`. Não houve alteração de `backend/entrypoint.sh`.

A migration `20261105183000_trusted_login_device` é **aditiva**:
colunas com defaults, novas tabelas e índices para login opt-in por
dispositivo. A alteração do Compose do *repositório* acrescenta uma rede
`demanage_db` interna; não publica nova porta. O agente de produção usa os
cinco arquivos Compose personalizados já instalados no host e só troca as
imagens de backend/frontend. Ele não instala automaticamente o novo Compose
do repositório, nem reinicia PostgreSQL ou Cloudflare Tunnel.

## Evidências verificadas em 08/11/2026 (UTC)

| Prova privada no Debian | SHA-256 exato |
| --- | --- |
| Dump de produção imediatamente anterior à migration (`/opt/demanage/backups/cd-20261108T225237Z-13f860b851d1/demanage.dump`) | `8caaf77f0e81ec82c5fac8f7649ee8eab9d1a3a7c6d27e81e1e0b93f0fb668c7` |
| Ensaio PostgreSQL 18 isolado (`/opt/demanage/backups/cd-20261108T224759Z-13f860b851d1/local-migration-rehearsal.json`) | `26845259b842d489c4fb7d94d37aed3298097cdaede64526d2637fd574497de1` |
| Teste HTTP de compatibilidade das imagens antiga e nova contra **cópia já migrada** (`/opt/demanage/backups/cd-20261108T224759Z-13f860b851d1/issue122-rollback-proof.json`) | `a40e7367685850c2e1f5cd8ef2682e04d15b687a00d2f0e2894f9ed0af80dc9a` |
| Migração viva controlada após backup (`/opt/demanage/backups/cd-20261108T225237Z-13f860b851d1/issue122-live-migration-proof.json`) | `4ca93ce733539133016e0c3bed55d1f5f030ec0ed338c883f98200ba1faa8d60` |

As provas **não** incluem tokens nem dumps no repositório. Os arquivos
ficam no servidor sob o diretório privado de backups. O ensaio isolado
confirmou o backend anterior e o novo com conta descartável, leituras de
`/auth/me`, despesas, entradas, cartões, cofrinhos e uma escrita de cofrinho.
A migration na cópia evoluiu de 37 para 38 entradas Prisma. A mesma mudança
foi aplicada separadamente no PostgreSQL real e verificada: 38 migrations,
alvo aplicado uma única vez; contagens de usuários, despesas, entradas,
cofrinhos e transações de cofrinho inalteradas. A aplicação antiga continuou
saudável, e o estado do agente/CD permaneceu na revisão anterior.

A elegibilidade expira **10/11/2026 22:47:59 UTC**. Evidência vencida, novo
SHA de app, diferença de blob sensível, alteração na versão executada, drift
dos hashes ou qualquer saúde/CI incorreta = **NO-GO**.

## Fluxo final obrigatório

1. Conferir a árvore do PR, os checks CI/CodeQL, o controle de acesso ao
   ambiente `production` e as quatro evidências privadas no host.
2. Integrar **apenas** o PR do gate após CI aprovado, mantendo os checks e
   proteção da branch `master`.
3. Aguardar CI **e CodeQL do novo SHA da master**. A promoção verifica o
   SHA antigo da aplicação e também o novo SHA que hospeda o gate.
4. Iniciar `Approve production release` em `master` com
   `commit_sha=13f860b851d1e2a8ae8789bfe2aeb99909d73be4` e os
   quatro hashes acima nos respectivos campos `reviewed_issue122_*`.
5. Aprovar explicitamente o job do ambiente GitHub **production**. O gate
   `issue122_release_gate.py` compara os blobs exatos, o tempo das provas,
   ambos os digests OCI e o par anterior/alvo antes de publicar o manifesto.
6. O timer Debian verifica proveniência, manifestos, digests, estado/volume,
   cria novo backup e realiza **somente** a troca de imagens. Conferir
   `DEPLOYED_AND_VERIFIED`, saúde HTTPS, identidades das imagens, migrações,
   volume PostgreSQL e Cloudflare Tunnel.

**Nunca** publicar `production.json` diretamente, forçar `master`,
rodar `docker compose down -v`, apagar o banco ou alterar regras de
aprovação para acelerar. A migration viva **não** é revertida em rollback
de imagens: a compatibilidade do backend anterior com o schema novo foi
observada explicitamente no ensaio isolado.

O ensaio garante os caminhos testados, não toda possível operação financeira.
Se houver desvio após promoção, interromper novas alterações e preservar
backup, diário do agente e evidência para intervenção controlada.
