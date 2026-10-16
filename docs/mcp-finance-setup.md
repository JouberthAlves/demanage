# Integração MCP financeira do deManage

> Status: implementação em branch de desenvolvimento, **desligada por padrão**. Não habilitar em produção sem revisão e autorização de deploy.

## O que o MCP faz

O ChatGPT (ou outro cliente MCP compatível) pode ler dados autorizados do deManage e propor lançamentos financeiros. A operação é pré-visualizada antes de executar. Uma instrução com duas interpretações possíveis **exige esclarecimento**.

Exemplo: “Ganhei R$ 20 da vó e coloquei no cofrinho Porco” cria uma entrada recebida com **tag** `Presente`, **descrição** `Presente da minha vó`, depois debita R$ 20 do saldo principal e deposita R$ 20 no cofrinho. O lançamento é atômico: se falhar um passo, todos voltam ao estado anterior. A assinatura da prévia vence, e um identificador único de intenção mais uma chave de idempotência evitam duplicações.

Exemplo ambíguo: “Coloca R$ 20 no Porco”. O cliente **precisa perguntar** se deve descontar o saldo principal. Nunca pode escolher a origem do dinheiro sozinho.

## Ferramentas disponíveis

- Leitura: `get_financial_overview`, `list_piggy_banks`, `list_income_tags`.
- Prévia: `preview_financial_operation` (sem efeitos financeiros).
- Escrita controlada: `execute_financial_operation` (token de prévia + chave UUID estável).
- Confirmação após perda de resposta: `get_operation_status` (sempre reutilizar a chave original; **não** gerar nova chave para repetir).

O cliente não envia `userId`: toda identidade vem de um token OAuth verificado, vinculado ao recurso e a permissões `finance:read` e `finance:write`. O usuário pode desconectar o cliente pela área **Integrações**. Não há ferramentas de exclusão de registros ou saques nesta primeira versão.

## Configuração de um ambiente isolado

1. Use um domínio HTTPS de homologação e um PostgreSQL isolado (nunca a base real). O Nginx do projeto publica `/api/mcp` e `/api/oauth/*` e encaminha a descoberta OAuth pela raiz `/.well-known/oauth-*`.
2. Configure `APP_URL=https://<domínio-da-homologação>` e ajuste explicitamente `MCP_RESOURCE_URL=<APP_URL>/api/mcp` e `MCP_ISSUER_URL=<APP_URL>/api/oauth`. Esses valores precisam bater **exatamente** com os anunciados nos metadados OAuth e com os tokens.
3. Configure **segredos privados**, fora do Git: `MCP_INTENT_SECRET` (pelo menos 32 bytes aleatórios), `MCP_OAUTH_COOKIE_KEYS` (segredo(s) aleatórios independentes, pelo menos 32 bytes por chave) e `MCP_OAUTH_JWKS` (JWKS contendo chave privada de assinatura gerada em ambiente confiável). Nunca imprima, comite nem envie esses valores pelo chat.
4. Defina `MCP_OAUTH_CLIENT_HOSTS` com os **hosts exatos** de documentos CIMD aceitos. Não habilite hosts arbitrários, redes privadas ou IPs. Para um cliente OpenAI que utilize o documento oficial, valide as URLs atuais na documentação da plataforma e inclua somente os hosts necessários.
5. Mantenha `MCP_ENABLED=false` enquanto prepara o ambiente. Mude para `true` somente no ambiente de homologação depois de conferir rotas, autenticação, HTTPS, escopos, metadados, proteção contra replay e revogação.
6. Teste com **contas descartáveis** e verifique diretamente os IDs e os totais no PostgreSQL. A configuração de homologação não deve publicar o banco na Internet.

URLs públicas esperadas para uma instalação sob a mesma origem:

| Rota | Uso |
| --- | --- |
| `/api/mcp` | endpoint MCP Streamable HTTP |
| `/.well-known/oauth-protected-resource` | descoberta do recurso protegido |
| `/.well-known/oauth-authorization-server` | descoberta do emissor OAuth |
| `/.well-known/oauth-authorization-server/api/oauth` | descoberta RFC 8414 do emissor com caminho |
| `/api/oauth/auth`, `/api/oauth/token` | autorização PKCE e troca por token |
| `/oauth/consent` | interface de consentimento do próprio usuário |
| `/integracoes` | consulta e revogação de conexões |

## CI 100% local

Dentro de uma worktree isolada na raiz real do projeto, com Node 24+, Corepack, Docker e Python disponíveis:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ci-local.ps1
```

O script cria **somente** seu próprio PostgreSQL 18 temporário, aplica migrations, valida drift, roda auditorias de dependências, lint, typecheck, testes unitários/de integração, builds e testes do mecanismo de deploy. Não executa GitHub Actions, publica imagens, faz merge ou deploy. Nunca informe `DATABASE_URL` de produção; a proteção do runner recusa URLs herdadas.

## Compatibilidade com ChatGPT

O servidor MCP pode ser usado por **clientes que oferecem suporte de leitura e escrita** com OAuth. A disponibilidade de conectar um MCP personalizado e permitir escrita no **ChatGPT** depende do plano, das permissões e da interface disponibilizada na conta. A implementação local **não** garante que uma conta pessoal ChatGPT Plus consiga executar ferramentas de escrita atualmente. Valide isso na própria interface antes de anunciar a integração como utilizável no chat.

Quando a conta oferecer esse recurso, o cliente deve conectar a URL pública do servidor, completar o fluxo OAuth e ter permissões explícitas. Não execute um teste com valores reais sem a confirmação do proprietário da conta.

## Pendências antes do deploy real

- Aprovação explícita do usuário para merge/deploy.
- Configuração segura de segredos, URLs e clientes OAuth permitidos no Debian.
- Testes reais de caminho HTTPS/Cloudflare/Nginx, descoberta OAuth e conexão do cliente escolhido, sem usar registros financeiros reais.
- Revisão dos logs e da auditoria de consentimento/revogação; confirmar preservação das permissões por conta.
- Confirmar que a conta do ChatGPT oferece ferramentas MCP de **escrita**, não apenas consulta.
