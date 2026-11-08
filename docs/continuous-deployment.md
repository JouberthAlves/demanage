# deManage — GitHub Actions → GHCR → Debian (aprovação manual)

**Estado inicial:** esta funcionalidade somente fica ativa depois de configurar o ambiente
GitHub `production`, publicar imagens válidas e instalar o agente no Debian.
Um merge na `master` **não** aprova uma versão para produção e **não** altera o servidor.

## Fluxo e limites de confiança

1. O CI existente executa auditoria, lint, testes e build; o CodeQL executa a varredura.
2. Somente um **push aprovado na `master` com CI verde** dispara
   `.github/workflows/publish-ghcr.yml`. Builds de PRs nunca recebem token
   `packages:write`.
3. O GHCR recebe `ghcr.io/bielxdh3/demanage-backend:sha-<40-char-commit>` e
   `...-frontend:sha-<40-char-commit>`, para `linux/amd64`.
4. Para promover, o proprietário inicia **manualmente** `Approve production release`,
   com o SHA completo, e aprova o job do ambiente protegido **production**.
   O workflow verifica CI **e CodeQL** para o SHA exato, imagens disponíveis e
   bloqueia alterações no schema/migrations/entrypoint/Compose-base.
5. Após aprovação, o workflow produz um artefato imutável cujo nome vincula
   o ID/tentativa da execução e SHA256 dos bytes de `production.json`, e só então
   publica o documento na branch `production`. As imagens são referenciadas
   **por digest**. Nenhuma credencial SSH fica no GitHub.
6. O Debian consulta **de saída** a branch `production` a cada
   aproximadamente 10 minutos. O agente compara o conteúdo ao Git blob do
   commit remoto, exige execução concluída com sucesso do workflow de promoção,
   aprovação explícita do reviewer do ambiente e o artefato exato antes de
   conferir o SHA anterior, a identidade do Compose e do banco, criar
   **backup custom do PostgreSQL** e baixar imagens
   por digest e recria **somente backend e frontend** com `--no-deps --no-build`.
7. Caso as imagens novas não fiquem saudáveis, tenta restaurar as imagens anteriores
   do backend/frontend. PostgreSQL, seu volume e Cloudflare Tunnel não são alvos.

**Nenhum runner self-hosted no servidor.** Não há SSH público nem webhooks de
entrada. O serviço de polling NÃO roda Git ou código arbitrário das imagens, além
do processo normal do app publicado, e NÃO executa `down`, `down -v`,
`docker volume rm`, `prune` ou `git reset --hard`.

**Limites da prova C01:** `approved_by` é apenas um campo informativo; não
autoriza um deploy isoladamente. A branch `production` continua sem proteção
própria, portanto um escritor ainda pode alterá-la ou causar negação de serviço,
mas conteúdo novo sem artefato da execução aprovada é rejeitado. Há exceção
fixa somente para o commit/blob histórico de `2026-10-19`, anterior ao formato
v2. Artefatos expiram após até 90 dias; uma promoção não consumida até então
precisa de nova execução aprovada. Falhas, limite de requisições ou mudanças
na API pública do GitHub bloqueiam o agente. A política de branch com escritor
exclusivo continua recomendada como segunda barreira. O atestado de uma
promoção v2 ainda precisa de validação em execução hospedada após integrar o PR.

**Limite importante:** o entrypoint normal do backend executa `prisma migrate
deploy`. Por isso qualquer mudança nas migrations, schema, entrypoint ou Compose
é **bloqueada** pela promoção e exige um plano/manual de migração separado.
Rollback de código não é rollback de schema. Não permitir mudanças DB silenciosas.

### DEM-01 — compatibilidade do rollback depois de uma migração

O gate de SQL aditivo, a prova de ensaio em PostgreSQL isolado, os checks do SHA
exato e a aprovação separada do proprietário continuam obrigatórios. **DDL
aditivo não prova, sozinho, que o backend antigo é compatível com todo o schema
novo**: constraints e novos comportamentos de escrita também precisam ser
revisados. O endpoint `/health`, mesmo quando retorna sucesso, não exercita
todas as consultas e operações financeiras antigas.

Antes de qualquer migração manual ou promoção que altere o schema, o operador
precisa demonstrar num **PostgreSQL 18 descartável**, criado a partir de uma
cópia aprovada, que a imagem anterior continua executando as operações de
leitura e escrita afetadas **após** a migração, e que a imagem candidata executa
o fluxo pretendido. Registrar quais operações e versões foram verificadas,
junto à prova de migração e ao hash do backup. Se não houver essa evidência,
**NO-GO para migração/promoção** até revisão manual. O ensaio existente que
executa apenas `prisma migrate deploy` na cópia isolada não constitui essa prova
de compatibilidade reversa.

O deploy-agent agora registra, no diário de intenção, o estado de
`_prisma_migrations` (incluindo migrações iniciadas, concluídas e revertidas)
antes de trocar os containers. Quando a nova versão falha, compara esse estado
**antes** de iniciar a imagem antiga e novamente **após** restaurá-la:

- Se não houve alteração no histórico, pode restaurar as imagens anteriores,
  verificar saúde/identidade do banco e limpar o diário.
- Se houve alteração, a consulta falha ou o snapshot está ausente, **não há
  confirmação automática de rollback seguro**. O agente preserva o diário em
  `rollback-failed` e exige intervenção do operador; não inicia a imagem antiga
  quando detecta a mudança antes do rollback. Após um reinício inesperado,
  também recusa limpar o diário quando encontra imagens antigas e histórico
  diferente/desconhecido.

O snapshot detecta alterações **durante a tentativa de deploy**. Se uma migração
foi aplicada manualmente **antes** de o agente iniciar, seu snapshot já refletirá
o schema novo; por isso o ensaio de compatibilidade com a imagem anterior é
obrigatório previamente. Nenhum desses checks demonstra compatibilidade de
SQL alterado fora do histórico do Prisma.

Em bloqueio: suspender novas promoções, preservar diário e backup, conferir
`_prisma_migrations` e verificar a compatibilidade da versão anterior com o
schema efetivo em ambiente isolado. Planejar recuperação manual somente após
essa prova e autorização. **Jamais restaurar automaticamente o dump de antes da
migração**: isso pode apagar transações realizadas desde o backup. O processo
não muda volume PostgreSQL nem Cloudflare Tunnel.

### Exceção única revisada do PR #105 (02/11/2026)

A migration aditiva `20261102192000_expense_voided_at` foi executada **fora do
workflow de promoção**, somente após um dump do banco de produção com SHA-256
`4f7da3b0904e60b08325988bcb5d2a35b2992ffa62c7b3e717ddd109a86e4126`,
restauração integral em PostgreSQL 18 isolado e ensaio com a imagem imutável
do novo backend. O ensaio conferiu 104 despesas e 79 pagamentos inalterados
e produziu a prova com hash
`3eb7cde251046cb54cae0b1eace5b7d34e841f4983974cf5cb3023f855c34bfa`.
A execução manual do Prisma no banco real manteve as mesmas contagens, sem
substituir os containers, e produziu a prova com hash
`0e15e76f78b84e170f3578ce43a0a0eff8b9f08c89fcaa2fd9b5a1f63bcfc488`.

Somente o par exato de commits (`4bda79d` → `faa174f`) pode utilizar esses
três hashes, **por até 48 horas** a partir do ensaio, e apenas com os mesmos
blobs de schema/migration e digests de backend/frontend que foram revisados.
`ops/cd/issue105_release_gate.py` executa esses checks novamente depois de
resolver os digests GHCR e antes de publicar o manifesto, sem dispensar a
aprovação exigida do ambiente `production`. Qualquer outra migration segue
bloqueada, inclusive releases posteriores ou imagens recompiladas com digest
diferente. Nenhuma correção de saldo é embutida na migration; a reparação
pontual dos dois IDs de R$ 85,00 e R$ 95,00 exige uma transação separada
com condições estritas e backup verificado.

## 1. Configuração obrigatória no GitHub (uma vez)

No repositório `bielxdh3/demanage`:

1. Em **Settings → Environments**, criar o ambiente **production**.
2. Em **Deployment protection rules**, habilitar **Required reviewers** e
   escolher um aprovador autorizado (ex.: o proprietário `bielxdh3`).
   Se o proprietário inicia o workflow e também aprova, a opção
   **Prevent self-review** deve estar desabilitada; caso a política exija
   independência, selecionar outra pessoa autorizada e habilitar essa opção.
3. Restringir o ambiente para branches selecionadas, permitindo somente
   `master`. O workflow também checa essa branch e o ator.
4. No mesmo ambiente, adicionar **Environment variable**:
   `PRODUCTION_GATE_CONFIGURED` = `true`. Sem isso, o workflow
   **falha antes de promover** (mesmo que alguém crie o ambiente implicitamente).
5. Conferir que GitHub Actions pode publicar pacotes no GHCR com
   `GITHUB_TOKEN`, permissão `packages: write`. Os pacotes normalmente
   aparecem depois do primeiro publish; nas configurações de cada pacote,
   conceder acesso ao repositório quando necessário.
6. Para um servidor sem token GitHub, ajustar a visibilidade **dos dois pacotes**
   para **Public**. Alternativamente usar `docker login ghcr.io` no servidor
   com credencial privada de leitura de pacotes; nunca colocar PAT, senhas
   nem `.env` no repositório, nos logs ou no manifesto.

**Não** aprovar a primeira promoção até concluir o bootstrap do Debian abaixo.

## 2. Bootstrap no Debian (uma vez; revisão humana/Codex via SSH)

O deploy validado anteriormente mantém a versão do app `b70d556e28832400d1ae07ee7f2d94218736195f`
e foi instalado via checkout limpo sob `/opt/demanage/.codex-releases/`.
O checkout legado tem histórico Git divergente; **não o reparar por merge/reset**.

**Passo A — inventário sem alterações:** confirmar via SSH o SHA do app
efetivamente ativo; conferir `docker inspect`/labels dos três containers,
configuração e projeto Compose exatos que os criaram, a lista de arquivos
`-f` usada no rollout, o caminho `--env-file` real, as redes, volume
`demanage_pgdata`, imagens, saúde e conexão do Cloudflare Tunnel.

**CRÍTICO:** o Compose real do servidor foi personalizado e o último rollout
não publicou nenhuma porta. NÃO copiar cegamente
`docker-compose.prod.yml` do repositório: ele publica
`127.0.0.1:8080` por padrão, o que pode alterar a topologia. A
configuração do agente precisa usar a **composição de arquivos já existente
na produção** (inclusive overrides customizados), não um substituto.
Se a configuração exata não for conhecida, **BLOCKED**, pedir evidências.

**Mudança de Compose desta versão (ação manual obrigatória):** o `docker-compose.prod.yml`
agora referencia imagens do GHCR por digest, via `DEMANAGE_BACKEND_IMAGE` e
`DEMANAGE_FRONTEND_IMAGE`. Antes do próximo deploy, o `.env` de produção deve
definir essas duas variáveis com os digests atuais de `production.json`. Sem elas, o
`docker compose config` falha e o agente para com `BLOCKED` (comportamento fail-closed).
Como a alteração em `docker-compose.prod.yml` bloqueia a promoção automática, ela é
aplicada por este procedimento manual, não pelo agente.

**Passo B — arquivos do agente:** baixar a partir de um SHA revisado e
confiável da `master` o diretório `ops/cd/` inteiro (`deploy_agent.py`,
o pacote `demanage_cd/` ao lado dele e `config.example.json`). O systemd executa
`deploy_agent.py`, que importa o pacote; copiar os dois juntos. Revisar e copiar
para `/opt/demanage/cd/` sob usuário `biel`. Os testes ficam em `ops/cd/tests/`
e não precisam ser instalados. Criar
`/opt/demanage/cd/config.json`, substituindo placeholders por caminhos
absolutos confirmados do servidor. Exemplo:

```json
{
  "compose_files": [
    "/opt/demanage/.codex-releases/REVISAO_ATIVA/docker-compose.prod.yml",
    "/opt/demanage/CAMINHO_DO_OVERRIDE_ATIVO_SE_HOUVER.yml"
  ],
  "env_file": "/opt/demanage/.env",
  "project_name": "demanage",
  "backup_root": "/opt/demanage/backups",
  "state_file": "/opt/demanage/cd/state.json",
  "lock_file": "/opt/demanage/cd/release.lock",
  "public_health_url": "https://demanage.biel.dev.br/api/health"
}
```

Não usar os caminhos acima se eles não corresponderem à instalação atual.
O `config.json` é específico do servidor e NÃO deve ser commitado.
Permissões recomendadas: diretório `0700` e arquivo `0600`, ambos
legíveis pelo usuário `biel`. A pasta `backups` também deve ser `0700`.
`biel` precisa de acesso ao Docker e às imagens GHCR via pull.

**Passo C — bootstrap da versão instalada (sem containers modificados):**

```bash
python3 /opt/demanage/cd/deploy_agent.py \
  --config /opt/demanage/cd/config.json \
  --init-current-sha b70d556e28832400d1ae07ee7f2d94218736195f
```

Esse comando **não pode** ser usado se o SHA em produção tiver mudado:
substituir somente após verificar novamente o SHA real. Ele confere
Compose + container PostgreSQL + saúde HTTPS, confirma que o label
`org.opencontainers.image.revision` das imagens em execução é exatamente esse
SHA, e cria apenas `state.json` do agente. Sem esse estado inicial não existe
deploy automático. Se o label não existir ou divergir, o comando recusa e nada é gravado.

**Diário de intenção (`deploy-journal.json`, ao lado de `state.json`):** antes de
qualquer mutação de container, o agente grava o alvo, as imagens anteriores e
novas, o dump e as tags de rollback. Se o processo morrer no meio, a próxima
execução reconcilia com os containers: se as imagens novas estão saudáveis, grava
o estado novo; se as antigas estão, apaga o diário e tenta de novo; qualquer outra
combinação **bloqueia** e exige o operador. Se o rollback falhar, o diário fica com
`phase: rollback-failed` e nenhuma execução futura age até intervenção manual.

**Passo D — systemd:** após o check acima, instalar
`ops/cd/demanage-cd.service` e `ops/cd/demanage-cd.timer`
em `/etc/systemd/system/`, revisar ambos e habilitar apenas o timer.
O usuário `biel` não dispõe de `sudo -n`; caso precise de privilégios para
copiar unidades a `/etc/systemd/system`, executar o passo interativo
autorizado com `sudo`. Não conceder sudo sem senha genericamente.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now demanage-cd.timer
systemctl status demanage-cd.timer --no-pager
```

O timer sem manifesto aprovado apenas registra
`No approved production release has been published`. O timer usa a
identidade Docker atual do usuário `biel` e não requer SSH do GitHub.

É **fortemente recomendado copiar o backup existente para outro dispositivo**,
pois os dumps locais não substituem backup externo.

## 3. Primeiro publish e primeira promoção

1. Integrar o PR com estes workflows à `master`; esperar o CI e o CodeQL
   ficarem verdes. O job `Publish verified GHCR images` publica imagens.
2. Confirmar no GitHub Packages a presença dos dois pacotes com a mesma
   tag `sha-<SHA COMPLETO>`. Verificar visibilidade/autorização de pull.
3. Em **Actions → Approve production release → Run workflow**,
   selecionar `master`, informar o SHA completo do último CI validado.
   Na primeira execução, informar também o SHA **atualmente ativo em produção**
   (no estado anterior, `b70d556e...`) em `initial_live_sha`.
4. Aprovar o job pendente no ambiente **production**. Sem aprovação, não
   é publicada qualquer versão de produção.
5. Aguardar até ~10 minutos; o timer verifica `production.json`,
   valida a continuidade dos SHAs, faz backup e promove **os dois digests**.
6. Verificar `journalctl -u demanage-cd.service --no-pager -n 100`, saúde
   dos containers e UI pública. O agente emite `DEPLOYED_AND_VERIFIED`
   somente após confirmar o novo backend/frontend e o banco intacto.

**Atenção:** se a promoção for aprovada antes da instalação do agente, ela
apenas deixa o manifesto pendente na branch. O servidor não muda até o
agente ser habilitado. Nunca usar `docker compose up` no projeto inteiro
para implementar esta automação.

## 4. Atualizações futuras e rollback

- **Merge aprovado:** só CI + publicação das imagens, produção inalterada.
- **Aprovação manual:** promover um SHA específico após CI, CodeQL, revisão
  de risco e confirmação de que schema/migrations não mudaram.
- **Server:** quando detecta versão aprovada e `previous_commit` coincide
  com `state.json`, faz backup e rollout somente da aplicação.
- **Falha:** tenta restaurar as imagens antigas mantendo o dump, volume e
  Tunnel. Se o rollback também falhar, interrompe e avisa explicitamente.
- **Rollback manual controlado:** usar o mesmo workflow de promoção apontando
  para um SHA anterior que tenha CI/CodeQL verde; o manifesto registra
  o SHA atualmente ativo em `previous_commit`. Revisar compatibilidade
  com o banco antes de liberar.
- **Sem backup offsite:** não afirmar cobertura completa contra falha física
  até existir cópia externa e teste real de restore.

## 5. Limitações e cuidados

- O GitHub workflow não faz SSH nem conhece `POSTGRES_PASSWORD`, `JWT_SECRET`
  ou token do Cloudflare.
- GHCR pode exigir `docker login` caso os pacotes estejam privados.
- Mudanças de migrations/Compose requerem **outra execução manual** fora deste
  caminho, com revisão/backup específico; jamais contornar o bloqueio.
- A versão que introduz `20261010120000_ledger_integrity_constraints` altera
  `backend/prisma`, `backend/entrypoint.sh` e `docker-compose.prod.yml`, então a
  promoção automática fica bloqueada. Antes de promover: backup manual com
  `scripts/backup-db.ps1` (ou equivalente), verificação de órfãos e duplicatas
  descritas em [`database-migrations.md`](./database-migrations.md) e aplicação em
  janela controlada. O `entrypoint.sh` do backend executa `prisma migrate deploy`
  ao subir o container, então a migration roda assim que a nova imagem iniciar.
- O verificador confere saúde da API, containers e identidade do banco, mas
  não substitui teste funcional A→B sem F5, nem mede latência das APIs
  autenticadas. Falhas do Cofrinho devem ser investigadas com seus HTTP
  statuses e logs reais.
- Para pausar deploys: `sudo systemctl disable --now demanage-cd.timer`.
  Isso não para os containers existentes.
