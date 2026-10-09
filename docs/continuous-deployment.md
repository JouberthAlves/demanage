# deManage — GitHub Actions → GHCR → Debian (aprovação manual)

**Estado inicial:** esta funcionalidade somente fica ativa depois de configurar o ambiente
GitHub \`production\`, publicar imagens válidas e instalar o agente no Debian.
Um merge na \`master\` **não** aprova uma versão para produção e **não** altera o servidor.

## Fluxo e limites de confiança

1. O CI existente executa auditoria, lint, testes e build; o CodeQL executa a varredura.
2. Somente um **push aprovado na \`master\` com CI verde** dispara
   \`.github/workflows/publish-ghcr.yml\`. Builds de PRs nunca recebem token
   \`packages:write\`.
3. O GHCR recebe \`ghcr.io/bielxdh3/demanage-backend:sha-<40-char-commit>\` e
   \`...-frontend:sha-<40-char-commit>\`, para \`linux/amd64\`.
4. Para promover, o proprietário inicia **manualmente** \`Approve production release\`,
   com o SHA completo, e aprova o job do ambiente protegido **production**.
   O workflow verifica CI **e CodeQL** para o SHA exato, imagens disponíveis e
   bloqueia alterações no schema/migrations/entrypoint/Compose-base.
5. Após aprovação, o GitHub grava **um único documento**
   \`production.json\` na branch \`production\`, com as referências imutáveis
   **por digest** de ambas as imagens. Nenhuma credencial SSH fica no GitHub.
6. O Debian faz uma consulta **de saída** à branch \`production\` a cada
   aproximadamente 10 minutos. O agente confere o SHA anterior, a identidade
   do Compose e do banco, cria **backup custom do PostgreSQL**, baixa imagens
   por digest e recria **somente backend e frontend** com \`--no-deps --no-build\`.
7. Caso as imagens novas não fiquem saudáveis, tenta restaurar as imagens anteriores
   do backend/frontend. PostgreSQL, seu volume e Cloudflare Tunnel não são alvos.

**Nenhum runner self-hosted no servidor.** Não há SSH público nem webhooks de
entrada. O serviço de polling NÃO roda Git ou código arbitrário das imagens, além
do processo normal do app publicado, e NÃO executa \`down\`, \`down -v\`,
\`docker volume rm\`, \`prune\` ou \`git reset --hard\`.

**Limite importante:** o entrypoint normal do backend executa \`prisma migrate
deploy\`. Por isso qualquer mudança nas migrations, schema, entrypoint ou Compose
é **bloqueada** pela promoção e exige um plano/manual de migração separado.
Rollback de código não é rollback de schema. Não permitir mudanças DB silenciosas.

## 1. Configuração obrigatória no GitHub (uma vez)

No repositório \`bielxdh3/demanage\`:

1. Em **Settings → Environments**, criar o ambiente **production**.
2. Em **Deployment protection rules**, habilitar **Required reviewers** e
   escolher um aprovador autorizado (ex.: o proprietário \`bielxdh3\`).
   Se o proprietário inicia o workflow e também aprova, a opção
   **Prevent self-review** deve estar desabilitada; caso a política exija
   independência, selecionar outra pessoa autorizada e habilitar essa opção.
3. Restringir o ambiente para branches selecionadas, permitindo somente
   \`master\`. O workflow também checa essa branch e o ator.
4. No mesmo ambiente, adicionar **Environment variable**:
   \`PRODUCTION_GATE_CONFIGURED\` = \`true\`. Sem isso, o workflow
   **falha antes de promover** (mesmo que alguém crie o ambiente implicitamente).
5. Conferir que GitHub Actions pode publicar pacotes no GHCR com
   \`GITHUB_TOKEN\`, permissão \`packages: write\`. Os pacotes normalmente
   aparecem depois do primeiro publish; nas configurações de cada pacote,
   conceder acesso ao repositório quando necessário.
6. Para um servidor sem token GitHub, ajustar a visibilidade **dos dois pacotes**
   para **Public**. Alternativamente usar \`docker login ghcr.io\` no servidor
   com credencial privada de leitura de pacotes; nunca colocar PAT, senhas
   nem \`.env\` no repositório, nos logs ou no manifesto.

**Não** aprovar a primeira promoção até concluir o bootstrap do Debian abaixo.

## 2. Bootstrap no Debian (uma vez; revisão humana/Codex via SSH)

O deploy validado anteriormente mantém a versão do app \`b70d556e28832400d1ae07ee7f2d94218736195f\`
e foi instalado via checkout limpo sob \`/opt/demanage/.codex-releases/\`.
O checkout legado tem histórico Git divergente; **não o reparar por merge/reset**.

**Passo A — inventário sem alterações:** confirmar via SSH o SHA do app
efetivamente ativo; conferir \`docker inspect\`/labels dos três containers,
configuração e projeto Compose exatos que os criaram, a lista de arquivos
\`-f\` usada no rollout, o caminho \`--env-file\` real, as redes, volume
\`demanage_pgdata\`, imagens, saúde e conexão do Cloudflare Tunnel.

**CRÍTICO:** o Compose real do servidor foi personalizado e o último rollout
não publicou nenhuma porta. NÃO copiar cegamente
\`docker-compose.prod.yml\` do repositório: ele publica
\`127.0.0.1:8080\` por padrão, o que pode alterar a topologia. A
configuração do agente precisa usar a **composição de arquivos já existente
na produção** (inclusive overrides customizados), não um substituto.
Se a configuração exata não for conhecida, **BLOCKED**, pedir evidências.

**Passo B — arquivos do agente:** baixar a partir de um SHA revisado e
confiável da \`master\` apenas \`ops/cd/deploy_agent.py\` e
\`ops/cd/config.example.json\`; revisar e copiar para
\`/opt/demanage/cd/\` sob usuário \`biel\`. Criar
\`/opt/demanage/cd/config.json\`, substituindo placeholders por caminhos
absolutos confirmados do servidor. Exemplo:

\`\`\`json
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
\`\`\`

Não usar os caminhos acima se eles não corresponderem à instalação atual.
O \`config.json\` é específico do servidor e NÃO deve ser commitado.
Permissões recomendadas: diretório \`0700\` e arquivo \`0600\`, ambos
legíveis pelo usuário \`biel\`. A pasta \`backups\` também deve ser \`0700\`.
\`biel\` precisa de acesso ao Docker e às imagens GHCR via pull.

**Passo C — bootstrap da versão instalada (sem containers modificados):**

\`\`\`bash
python3 /opt/demanage/cd/deploy_agent.py \
  --config /opt/demanage/cd/config.json \
  --init-current-sha b70d556e28832400d1ae07ee7f2d94218736195f
\`\`\`

Esse comando **não pode** ser usado se o SHA em produção tiver mudado:
substituir somente após verificar novamente o SHA real. Ele confere
Compose + container PostgreSQL + saúde HTTPS e cria apenas
\`state.json\` do agente. Sem esse estado inicial não existe deploy automático.

**Passo D — systemd:** após o check acima, instalar
\`ops/cd/demanage-cd.service\` e \`ops/cd/demanage-cd.timer\`
em \`/etc/systemd/system/\`, revisar ambos e habilitar apenas o timer.
O usuário \`biel\` não dispõe de \`sudo -n\`; caso precise de privilégios para
copiar unidades a \`/etc/systemd/system\`, executar o passo interativo
autorizado com \`sudo\`. Não conceder sudo sem senha genericamente.

\`\`\`bash
sudo systemctl daemon-reload
sudo systemctl enable --now demanage-cd.timer
systemctl status demanage-cd.timer --no-pager
\`\`\`

O timer sem manifesto aprovado apenas registra
\`No approved production release has been published\`. O timer usa a
identidade Docker atual do usuário \`biel\` e não requer SSH do GitHub.

É **fortemente recomendado copiar o backup existente para outro dispositivo**,
pois os dumps locais não substituem backup externo.

## 3. Primeiro publish e primeira promoção

1. Integrar o PR com estes workflows à \`master\`; esperar o CI e o CodeQL
   ficarem verdes. O job \`Publish verified GHCR images\` publica imagens.
2. Confirmar no GitHub Packages a presença dos dois pacotes com a mesma
   tag \`sha-<SHA COMPLETO>\`. Verificar visibilidade/autorização de pull.
3. Em **Actions → Approve production release → Run workflow**,
   selecionar \`master\`, informar o SHA completo do último CI validado.
   Na primeira execução, informar também o SHA **atualmente ativo em produção**
   (no estado anterior, \`b70d556e...\`) em \`initial_live_sha\`.
4. Aprovar o job pendente no ambiente **production**. Sem aprovação, não
   é publicada qualquer versão de produção.
5. Aguardar até ~10 minutos; o timer verifica \`production.json\`,
   valida a continuidade dos SHAs, faz backup e promove **os dois digests**.
6. Verificar \`journalctl -u demanage-cd.service --no-pager -n 100\`, saúde
   dos containers e UI pública. O agente emite \`DEPLOYED_AND_VERIFIED\`
   somente após confirmar o novo backend/frontend e o banco intacto.

**Atenção:** se a promoção for aprovada antes da instalação do agente, ela
apenas deixa o manifesto pendente na branch. O servidor não muda até o
agente ser habilitado. Nunca usar \`docker compose up\` no projeto inteiro
para implementar esta automação.

## 4. Atualizações futuras e rollback

- **Merge aprovado:** só CI + publicação das imagens, produção inalterada.
- **Aprovação manual:** promover um SHA específico após CI, CodeQL, revisão
  de risco e confirmação de que schema/migrations não mudaram.
- **Server:** quando detecta versão aprovada e \`previous_commit\` coincide
  com \`state.json\`, faz backup e rollout somente da aplicação.
- **Falha:** tenta restaurar as imagens antigas mantendo o dump, volume e
  Tunnel. Se o rollback também falhar, interrompe e avisa explicitamente.
- **Rollback manual controlado:** usar o mesmo workflow de promoção apontando
  para um SHA anterior que tenha CI/CodeQL verde; o manifesto registra
  o SHA atualmente ativo em \`previous_commit\`. Revisar compatibilidade
  com o banco antes de liberar.
- **Sem backup offsite:** não afirmar cobertura completa contra falha física
  até existir cópia externa e teste real de restore.

## 5. Limitações e cuidados

- O GitHub workflow não faz SSH nem conhece \`POSTGRES_PASSWORD\`, \`JWT_SECRET\`
  ou token do Cloudflare.
- GHCR pode exigir \`docker login\` caso os pacotes estejam privados.
- Mudanças de migrations/Compose requerem **outra execução manual** fora deste
  caminho, com revisão/backup específico; jamais contornar o bloqueio.
- O verificador confere saúde da API, containers e identidade do banco, mas
  não substitui teste funcional A→B sem F5, nem mede latência das APIs
  autenticadas. Falhas do Cofrinho devem ser investigadas com seus HTTP
  statuses e logs reais.
- Para pausar deploys: \`sudo systemctl disable --now demanage-cd.timer\`.
  Isso não para os containers existentes.
