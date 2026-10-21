# Publicação do backend CheckMed

O frontend estático pode continuar no GitHub Pages. A API Flask precisa de um serviço Python (Vercel ou outro) e de PostgreSQL persistente; não armazene dados de usuário no disco efêmero da função.

## Neon

1. Crie um projeto PostgreSQL no Neon e escolha uma região próxima do serviço da API.
2. Crie uma branch de banco separada para testes de integração; use essa branch apenas em `TEST_DATABASE_URL`.
3. Na tela de conexão, copie a connection string com pooler (`-pooler` no hostname, quando disponível) e SSL. Não publique a URL nem a inclua em commits.
4. Configure `DATABASE_URL` para produção e, localmente, `TEST_DATABASE_URL` para a base de testes isolada.
5. Rode `python -m backend.migrate` após definir `DATABASE_URL`. A migration é rastreada em `schema_migrations` e pode ser executada novamente com segurança.

## Variáveis de ambiente

Configure no serviço da API, sem aspas e sem adicionar o arquivo `.env` ao Git:

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | String PostgreSQL/Neon de produção. |
| `TEST_DATABASE_URL` | String de uma base/branch de testes isolada. |
| `SECRET_KEY` | Segredo aleatório longo, usado na derivação das chaves de limite. |
| `CHECKMED_FRONTEND_ORIGINS` | Origens exatas do frontend e, quando necessário, localhost, separadas por vírgula. |
| `SESSION_DAYS` | Duração de sessão em dias (padrão 30). |
| `MAX_PAYLOAD_BYTES` | Limite do snapshot (padrão 1048576 bytes). |
| `RECOVERY_CODE_TTL_MINUTES` | Validade do código de recuperação (padrão 30 minutos). |

`.env.example` contém apenas placeholders. Para gerar segredo local, use um gerador criptográfico e mantenha o valor somente no gerenciador de variáveis do serviço.

## Publicar a API

1. Instale as dependências por `pip install -r requirements.txt` ou pelo `pyproject.toml`.
2. Configure as variáveis de produção listadas acima e adicione a origem do GitHub Pages a `CHECKMED_FRONTEND_ORIGINS` (por exemplo `https://usuario.github.io`; inclua o caminho do projeto apenas na URL do site, nunca na origem).
3. Execute `python -m backend.migrate` contra o Neon de produção antes de liberar tráfego.
4. Publique `backend.server:app` no serviço Python. O `pyproject.toml` já declara esse entrypoint para Vercel; em outro serviço, configure o comando/entrypoint Flask equivalente.
5. Confirme `GET /api/health`, depois faça um cadastro controlado e um ciclo de sincronização com dados fictícios. Verifique o preflight CORS partindo do domínio real do frontend.
6. Mantenha `TEST_DATABASE_URL` fora do ambiente de produção e nunca rode migrations/testes destrutivos sobre a base de usuários por engano.

O Neon pode suspender a compute por inatividade nos planos gratuitos; a primeira conexão depois da pausa pode demorar. A API define timeout de conexão de 10 segundos e faz uma tentativa adicional após falha operacional. Se o banco continuar indisponível, responde `503` sem revelar detalhes internos. Confirme nas regras atuais do plano do provedor por quanto tempo backups podem reter dados após a exclusão de uma conta; exclusão na aplicação não controla a retenção de cópias de backup do provedor.
