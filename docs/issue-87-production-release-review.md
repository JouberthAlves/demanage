# deManage — revisão formal de liberação em produção (issue #87 / PR #88)

**Situação:** pacote de autorização para revisão humana. **Não constitui aprovação do ambiente `production`, publicação do ponteiro nem execução de migrações.**

## Identidade imutável de liberação

| Evidência | Valor imutável |
| --- | --- |
| Revisão executando em produção, anterior | `ec2a3d40a6c8218ab0550258305e1745ee3b1fbc` |
| `master` de destino (PR #88 mergeado) | `62e98ccea16dd0d3164ab1689c11fe770b983393` |
| GHCR backend (digest OCI) | `ghcr.io/bielxdh3/demanage-backend@sha256:5d39a9d37c5b476641c42eebb487d2ea2183eb1f1f83b6c1b140a0ed8e9d6837` |
| GHCR frontend (digest OCI) | `ghcr.io/bielxdh3/demanage-frontend@sha256:e44c023e7fbcefa55e1e8a9421e10777691121bb2534d7297333d1c45684294a` |
| Dump privado de produção (SHA-256) | `be5d1dd8432507f8f23fca55fe3ae4261cf1a2a58efbf18a7a179e2e792fc84c` |
| Manifesto privado do ensaio (SHA-256) | `b0e07420cb4102daeafffb7efa53f528e5c55ca410dd4d5da13be065dd153495` |
| Ensaio PostgreSQL 18 | `31 → 35` migrações em restauração isolada, encerrado 2026-10-24 12:32:45 UTC |

Dump e manifesto estão **somente no Debian**, sob `/opt/demanage/backups/cd-20261024T123238Z-62e98ccea16d/`; não anexar conteúdo, dados de usuários nem credenciais ao GitHub. O dump foi re-hasheado após ensaio e corresponde ao checksum acima. O registro de backup é uma fotografia; o agente ainda fará **novo dump validado do banco em produção antes de mudar containers**.

### Revisão dos quatro scripts PostgreSQL

| Migração nova | SHA-256 dos bytes SQL revisados | Consequência e ressalvas |
| --- | --- | --- |
| `20261023210000_piggy_correction_origin` | `ea23be8728984dd689ebeed2b180846da85367af9e6e2d0ee1f891de60f3b468` | Enum e coluna nullable para proveniência de correção; CHECK e trigger impedem alteração da origem; registros legados permanecem `NULL`, sem inventar histórico. |
| `20261023210100_oauth_token_connection_status` | `3bb58025e8e191696e774df29d54578356b9f903d9ffe5f9c8a0ca8bad820b2b` | `connectedAt` nullable; backfill apenas quando existe artefato de access token retido, vinculado a grant, usuário e cliente não revogados. Consentimento isolado não basta. |
| `20261023211000_c04_owner_composite_fks` | `09767182912349193394712d9ef6bceda51638fc32ad5d531325c2dfbf079bdb` | Impede referências financeiras entre donos com FKs compostas. Faz preflight sem reatribuir dados; locks `SHARE ROW EXCLUSIVE`, índices e validação de FKs em transação; pode interromper escritas concorrentes durante a janela. Se houver linha de propriedade inconsistente, a transação falha e exige investigação humana. |
| `20261023213000_expense_obligation_versions` | `01a359d263051d5745325ec099b5e12e633171c0ec64146e3bd7cc9a33f8915e` | Tabela nova de versões financeiras com checks, índices e trigger anti-UPDATE. Não faz backfill histórico fictício; versões futuras são append-only. |

Também mudou `backend/prisma/schema.prisma` (modelo alinhado às quatro migrações); `docker-compose.prod.yml` apenas acrescentou `TRUST_CF_INGRESS_VERIFIED` e `TRUSTED_TUNNEL_PROXY_IP`, com padrões restritivos `0` e vazio. **O deploy agent conserva sua Compose base local e faz overlay de imagens**; esta autorização não ativa confiança em headers vindos do público.

Todos os seis caminhos sensíveis, seus tipos de mudança e IDs de blob Git estão fixados no `ops/cd/issue87_release_gate.py`. O verificador rejeita qualquer caminho sensível adicional, modificação de byte, imagem ou prova divergente, origem/destino diferente ou ensaio expirado (janela de 48 horas). O caso legado da PR #47 e o bloqueio genérico continuam intactos.

## Compatibilidade, integridade e recuperação

- O `backend/entrypoint.sh` executa `prisma migrate deploy` **antes** de iniciar a API; o agente Debian cria backup, journal e confere imagem, banco, Compose, health e `/api/ready`. PostgreSQL 18 e o volume atual devem permanecer idênticos. Um erro nas migrações impede a aplicação nova de declarar disponibilidade.
- As quatro alterações são aditivas do ponto de vista dos dados existentes; o C04 substitui duas FKs simples por FKs compostas equivalentes mais estritas. O ensaio real 31→35 em banco restaurado passou. **Isso não garante ausência de contenção de locks durante tráfego real**; executar em janela curta de menor escrita e acompanhar logs.
- Falha anterior à troca: manter versão anterior, prova e dump. Falha ao iniciar a nova aplicação: agente tenta restaurar **apenas** backend/frontend anteriores, mantém journal se não conseguir. **Não reverter automaticamente as migrações**: Prisma DDL já aplicada pode permanecer. Conferir compatibilidade da aplicação anterior com schema evoluído; em caso de incompatibilidade ou suspeita de corrupção, parar escritas, preservar dump/journal e decidir restauração do banco somente por procedimento específico que trate perda de alterações posteriores.
- Nenhuma exclusão de dump ou volume, `docker compose down -v`, alteração no Cloudflare Tunnel ou operação nos containers de Virki é autorizada. O dump privado deve continuar disponível e acessível. Cópia off-site não está comprovada por este documento.

## Evidências e etapas obrigatórias

1. **Já concluído para o SHA alvo:** GitHub `CI` run `40093703855` SUCCESS; `CodeQL` run `40093703852` SUCCESS; GHCR publish `40094144953` SUCCESS. Os testes e ensaio acima não devem ser repetidos sem nova evidência. Validar separadamente os checks hospedados desta **alteração do gate** quando o PR de autorização for publicado.
2. Validar as suítes de gate e o workflow desta alteração. Solicitar revisão independente P1/P2 do escopo **gate de liberação**, não reabrir auditorias funcionais encerradas.
3. Proprietário revisa e mergeia **o PR deste runbook**. O workflow de aprovação passa a estar disponível no `master`; não confundir merge com aprovação do ambiente.
4. Executar `Approve production release` pelo GitHub Actions, a partir de `master`, como `bielxdh3`, com `commit_sha=62e98ccea16dd0d3164ab1689c11fe770b983393` e os dois checksums exatos acima. **Aprovação humana de `production` continua indispensável.** O workflow confere CI/CodeQL do SHA de destino **e do novo SHA do workflow em `master`**, ancestralidade, diferença sensível e digests no GHCR antes de escrever o ponteiro v2 com artefato testemunha vinculado à execução. Não disparar enquanto qualquer desses checks estiver pendente.
5. Após a aprovação legítima e workflow concluído, aguardar o `demanage-cd.timer` ou executar o agente pelo procedimento oficial, sem mutação manual do ponteiro. Confirmar `production.json` v2, `state.json`, novo SHA nas labels dos dois serviços, container PostgreSQL e volume inalterados, quatro migrações aplicadas, journal ausente, dump novo e íntegro, logs de readiness, endpoints HTTP/HTTPS, fluxos de login/autorização e que serviços compartilhados permanecem saudáveis.

**Expiração:** o ensaio fixado expira 2026-10-26 12:32:45 UTC. Se a aprovação protegida não ocorrer a tempo, executar **novo ensaio sobre dump atualizado** e emitir nova revisão/política/checksums, sem ignorar o bloqueio ou ampliar silenciosamente a validade.
