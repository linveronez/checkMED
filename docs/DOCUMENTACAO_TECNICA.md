# Documentação técnica do CheckMed


**Atualizada em:** 9 de novembro de 2026
**Aplicação:** [GitHub Pages](https://linveronez.github.io/checkMED/)
**Repositório:** [github.com/linveronez/checkMED](https://github.com/linveronez/checkMED)

## 1. Visão geral

O CheckMed é um aplicativo web progressivo para organizar rotinas de medicamentos, estoque, agenda e registros pessoais de saúde. O uso local não exige conta. A sincronização entre aparelhos é opcional e depende da API e do banco de dados externos.

A interface estática é publicada no GitHub Pages. A API Flask está hospedada na Vercel e usa PostgreSQL no Neon. O endereço da API configurado no cliente é `https://checkmed-tau.vercel.app`; a raiz da API responde informações do serviço, e as rotas funcionais ficam sob `/api`.

## 2. Componentes

| Componente | Arquivos | Responsabilidade |
| --- | --- | --- |
| Interface e experiência | `index.html`, `styles.css`, `app.js` | Telas, formulários, navegação e interação. |
| Regras do domínio | `core.js` | Cálculos e validações reutilizáveis. |
| Cliente de API | `api.js`, `config.js` | Sessão, chamadas HTTP, configuração de origem e CSP. |
| PWA | `manifest.json`, `sw.js`, ícones | Instalação e cache de arquivos estáticos para reabertura offline após visita prévia. |
| API | `backend/` | Cadastro, autenticação, conta, sincronização e validação do conteúdo. |
| Persistência | `backend/migrations/` | Esquema PostgreSQL aplicado por migrações. |
| Testes | `tests/` | Testes do núcleo JavaScript e da API Flask. |

## 3. Dados e armazenamento

No uso sem conta, os dados da rotina são mantidos no armazenamento local do navegador. O PIN local é derivado por PBKDF2-HMAC-SHA-256 (210.000 iterações e salt aleatório), mas serve apenas para restringir a interface: não criptografa os dados armazenados pelo navegador. Backups são exportados e importados manualmente.

Na nuvem, a migração `backend/migrations/001_init.sql` cria `users`, `sessions`, `snapshots`, `consents` e `auth_attempts`. O controle de migrações cria também `schema_migrations`. Senhas são derivadas com `scrypt`; tokens de sessão e códigos de recuperação são armazenados como hashes. O payload de sincronização é validado por lista de campos permitidos antes de ser persistido em `JSONB`.

| Tabela | Conteúdo |
| --- | --- |
| `users` | E-mail normalizado, hash de senha, hash e validade do código de recuperação, nome e datas. |
| `sessions` | Hash de token, aparelho e validade da sessão. |
| `snapshots` | Cópia sincronizada, versão, esquema, aparelho e data de atualização. |
| `consents` | Consentimento para sincronização e versão do texto aceito. |
| `auth_attempts` | Tentativas de cadastro, login e recuperação usadas para limitar abusos. |
| `schema_migrations` | Migrações SQL já aplicadas. |

## 4. API

A referência completa de rotas, formatos e erros está em [`api.md`](api.md). Os fluxos principais são:

- cadastro, login, logout, consulta de conta e troca de senha;
- recuperação de senha por código, sem envio por e-mail; o prazo padrão do código é 30 minutos;
- leitura, gravação versionada e exclusão do snapshot;
- exclusão da conta autenticada.

O cliente envia tokens de sessão em `Authorization: Bearer`. Conflitos de sincronização respondem HTTP 409 e exigem decisão explícita da pessoa; não há mesclagem automática.

## 5. Segurança e limites conhecidos

- CORS da API usa a lista `CHECKMED_FRONTEND_ORIGINS`, com origens exatas e sem caminho.
- A CSP do cliente permite conexões à origem configurada em `apiBase`.
- O backend aplica limite de tentativas para cadastro, login e recuperação e não guarda senhas nem tokens de sessão em texto puro.
- O PIN não é criptografia de dados. O armazenamento local depende das proteções do navegador e do aparelho.
- Notificações dependem de permissão e suporte do navegador; a página pode ser suspensa pelo sistema. O serviço não deve ser o único alarme de medicamento.
- Os documentos de privacidade e termos de uso ainda precisam de revisão antes de divulgação ampla. Não se declara conformidade legal certificada.
- O CheckMed organiza informações e não substitui a prescrição, bula ou orientação de profissional de saúde.

## 6. Execução e testes

As instruções de instalação, variáveis de ambiente e publicação estão no [`MANUAL_TECNICO.md`](MANUAL_TECNICO.md) e em [`deploy.md`](deploy.md). A API requer `DATABASE_URL` configurada antes da aplicação das migrações.

O último relatório do repositório registra 20 testes aprovados em `tests/core.test.js`, 21 testes aprovados da API e dois testes de integração ignorados por dependerem de banco configurado. Esses resultados não foram reexecutados na atualização documental de 8 de novembro de 2026.
