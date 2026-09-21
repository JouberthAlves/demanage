# Self-host do deManage

Guia de produção para hospedar o deManage em um servidor próprio e publicar o app com Cloudflare Tunnel.

## Arquitetura

```text
Internet
  -> Cloudflare
  -> Cloudflare Tunnel (cloudflared no host)
  -> http://127.0.0.1:8080
  -> frontend Nginx
     -> /api/* -> backend:8888 (rede Docker interna)
                 -> db:5432 (rede Docker interna)
```

O host publica somente `127.0.0.1:8080`. PostgreSQL e API não possuem `ports:` no Compose de produção.

O self-host usa PostgreSQL 18 para ficar alinhado ao banco de origem. Na imagem oficial do PostgreSQL 18, o volume persistente deve ser montado em `/var/lib/postgresql`; o `PGDATA` interno é versionado (`/var/lib/postgresql/18/docker`).

## 1. Pré-requisitos no servidor

- Git
- Docker com Docker Compose v2 (`docker compose version`)
- Acesso ao domínio no Cloudflare
- `cloudflared` para o Cloudflare Tunnel

No Windows, Docker Desktop deve estar configurado para iniciar com o sistema se o servidor depender dele para manter os containers ativos.

## 2. Baixar o projeto

```powershell
git clone https://github.com/bielxdh3/demanage.git
cd demanage
```

Em uma instalação já clonada:

```powershell
git pull
```

## 3. Criar o `.env` de produção

```powershell
Copy-Item selfhost.env.example .env
notepad .env
```

Preencha `POSTGRES_PASSWORD` e `JWT_SECRET` com valores aleatórios fortes. Para `POSTGRES_PASSWORD`, prefira hexadecimal porque o valor também faz parte da `DATABASE_URL`.

Exemplo de gerador compatível com PowerShell:

```powershell
function New-HexSecret([int]$Bytes = 32) {
  $buffer = New-Object byte[] $Bytes
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($buffer)
  $rng.Dispose()
  ([BitConverter]::ToString($buffer)).Replace('-', '').ToLowerInvariant()
}

New-HexSecret 32
New-HexSecret 64
```

Use o primeiro valor em `POSTGRES_PASSWORD` e o segundo em `JWT_SECRET`. Nunca commite o `.env`.

## 4. Validar e subir

Valide o Compose sem imprimir os segredos:

```powershell
docker compose -f docker-compose.prod.yml config --quiet
```

Suba tudo:

```powershell
docker compose -f docker-compose.prod.yml up -d --build
```

Confira:

```powershell
docker compose -f docker-compose.prod.yml ps
```

Teste no próprio servidor:

```powershell
curl.exe http://127.0.0.1:8080/
curl.exe http://127.0.0.1:8080/api/health
```

O segundo comando deve chegar ao backend através do Nginx. Não abra as portas 5432 ou 8888 no firewall/roteador.

Logs úteis:

```powershell
docker compose -f docker-compose.prod.yml logs -f --tail=100 frontend backend db
```

### Se você chegou a inicializar o volume com PostgreSQL 16

Não tente reutilizar diretamente um volume de dados inicializado por PostgreSQL 16 com a imagem 18. Se esse volume era apenas de teste e não contém dados importantes, remova os containers e o volume antes de subir a versão 18:

```powershell
docker compose -f docker-compose.prod.yml down
docker volume rm demanage_pgdata
```

Só faça isso se o volume ainda não contiver dados reais. Depois rode novamente `up -d --build`.

## 5. Cloudflare Tunnel

Para o primeiro teste, prefira um hostname temporário, por exemplo `demanage-test.biel.dev.br`. Depois da migração do banco, troque para `demanage.biel.dev.br`.

**Importante:** `APP_URL` precisa ser exatamente a origem aberta no navegador em production. Antes de testar pelo hostname temporário, altere no `.env`:

```env
APP_URL=https://demanage-test.biel.dev.br
```

Recrie o backend para aplicar:

```powershell
docker compose -f docker-compose.prod.yml up -d --force-recreate backend
```

No painel Cloudflare:

1. Abra **Networking -> Tunnels**.
2. Crie um Tunnel, por exemplo `demanage-server`.
3. Selecione Windows e copie o comando de instalação exibido pelo painel.
4. Abra o Prompt/PowerShell como Administrador e instale o serviço. Para um tunnel gerenciado pelo painel, o comando tem o formato:

```powershell
cloudflared.exe service install <TUNNEL_TOKEN>
```

O token é secreto. Não salve no repositório e não envie em chat.

No Tunnel, adicione uma rota **Published application**:

```text
Hostname: demanage-test.biel.dev.br
Service URL: http://localhost:8080
```

Depois teste o endereço HTTPS pelo navegador fora da rede local.

Quando o banco definitivo estiver migrado, altere o hostname para:

```text
demanage.biel.dev.br
```

No mesmo corte, altere também o `.env` de volta para:

```env
APP_URL=https://demanage.biel.dev.br
```

E recrie o backend:

```powershell
docker compose -f docker-compose.prod.yml up -d --force-recreate backend
```

Se já existir um registro DNS `demanage` apontando para a hospedagem antiga, faça a troca apenas no momento do corte. Uma rota criada pelo painel do Tunnel normalmente cria o CNAME do tunnel automaticamente.

## 6. Migrar o PostgreSQL antigo

Faça esta etapa somente depois que o novo ambiente estiver funcionando com um banco de teste/vazio.

### 6.1 Congelar escritas no ambiente antigo

Pare de usar o app antigo durante o dump final. Se possível, desligue temporariamente o frontend/API antigos para impedir novas alterações durante a cópia.

### 6.2 Gerar dump

Pegue a `DATABASE_URL` do PostgreSQL no provedor antigo. Não envie essa URL para terceiros.

Como o banco de origem é PostgreSQL 18, use `pg_dump` 18.

Com uma instalação local de PostgreSQL 18:

```powershell
pg_dump "SUA_DATABASE_URL_ANTIGA" --format=custom --no-owner --no-privileges --file=demanage-old.dump
```

Ou, preferencialmente, usando Docker:

```powershell
docker run --rm -v "${PWD}:/backup" postgres:18-alpine `
  pg_dump "SUA_DATABASE_URL_ANTIGA" `
  --format=custom `
  --no-owner `
  --no-privileges `
  --file=/backup/demanage-old.dump
```

### 6.3 Restaurar no servidor

Pare frontend e backend, mantendo o banco ativo:

```powershell
docker compose -f docker-compose.prod.yml stop frontend backend
```

Copie o dump:

```powershell
docker cp .\demanage-old.dump demanage-db:/tmp/demanage-old.dump
```

Restaure:

```powershell
docker exec demanage-db pg_restore `
  -U demanage `
  -d demanage `
  --clean `
  --if-exists `
  --no-owner `
  --no-privileges `
  /tmp/demanage-old.dump
```

Apague a cópia temporária do container:

```powershell
docker exec demanage-db rm -f /tmp/demanage-old.dump
```

Suba API e frontend de novo:

```powershell
docker compose -f docker-compose.prod.yml up -d backend frontend
```

O entrypoint do backend executa `prisma migrate deploy` antes de iniciar a API.

### 6.4 Conferência antes do corte

Confira no novo endereço:

- login;
- entradas e despesas;
- cartões/faturas;
- cofrinhos;
- patrimônio;
- BTC/USD e históricos;
- valores e gráficos principais.

Só depois mude o hostname definitivo e desligue a hospedagem antiga.

## 7. Backup local

Há um helper em `scripts/backup-db.ps1`:

```powershell
.\scripts\backup-db.ps1
```

Por padrão ele mantém os dumps em `backups/` e remove arquivos com mais de 30 dias. Para alterar a retenção:

```powershell
.\scripts\backup-db.ps1 -RetentionDays 60
```

A pasta `backups/` deve ser copiada periodicamente para outro dispositivo/serviço. Backup no mesmo SSD não protege contra falha do disco.

## 8. Atualizar o deManage depois

Antes de atualizar, faça um backup. Depois:

```powershell
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

O volume PostgreSQL persiste entre rebuilds dos containers.

## 9. Parar ou reiniciar

```powershell
docker compose -f docker-compose.prod.yml restart
```

Para parar sem apagar os dados:

```powershell
docker compose -f docker-compose.prod.yml down
```

Não use `down -v` em produção: `-v` remove o volume do PostgreSQL.
