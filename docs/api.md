# API do CheckMed

API Flask para cadastro de contas e cópia versionada dos dados do CheckMed no PostgreSQL/Neon. Todas as rotas ficam sob `/api`; respostas de erro usam `{ "error": "codigo_curto", "message": "mensagem em português" }`. A API envia `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` e `Referrer-Policy: no-referrer`.

## Autenticação

As rotas protegidas recebem `Authorization: Bearer <token>`. O token é aleatório, exibido apenas na criação da sessão e armazenado no servidor somente como SHA-256. Sessões expiram após `SESSION_DAYS` (padrão 30 dias). Token inválido ou expirado responde `401 session_expired` com “Sua sessão expirou. Entre de novo.”

### Rotas

| Método e rota | Acesso | Descrição | Respostas principais |
| --- | --- | --- | --- |
| `GET /api/health` | Público | Verifica se a aplicação está ativa. | `200` |
| `POST /api/auth/register` | Público | Cria conta, consentimento e sessão. | `201`, `409 email_in_use`, `422` validação/consentimento, `429` limite |
| `POST /api/auth/login` | Público | Inicia sessão. | `200`, `401 invalid_credentials`, `429` limite |
| `POST /api/auth/logout` | Sessão | Revoga a sessão atual. | `204`, `401` |
| `GET /api/auth/me` | Sessão | Retorna dados básicos da conta. | `200`, `401` |
| `POST /api/auth/change-password` | Sessão | Troca a senha, mantém a sessão atual e revoga as demais. | `200`, `401`, `422` |
| `POST /api/auth/reset-with-code` | Público | Redefine a senha com o código de recuperação e emite código novo. Revoga todas as sessões. | `200`, `401`, `422`, `429` limite |
| `GET /api/sync` | Sessão | Lê o snapshot da conta. | `200`, `404 snapshot_not_found`, `401` |
| `PUT /api/sync` | Sessão | Cria ou atualiza o snapshot se a versão base coincidir. | `200`, `409 sync_conflict`, `413`, `422`, `401` |
| `DELETE /api/sync` | Sessão | Remove o snapshot, mantendo a conta. | `204`, `401` |
| `DELETE /api/account` | Sessão | Exclui a conta e os dados relacionados. | `204`, `401`, `422` |

## Exemplos

### Cadastro

```http
POST /api/auth/register
Content-Type: application/json
```

```json
{
  "email": "pessoa@example.com",
  "password": "uma-senha-segura",
  "displayName": "Pessoa",
  "deviceLabel": "Meu celular",
  "consent": { "type": "cloud_sync", "policyVersion": "2026-10" }
}
```

`201 Created` (o código de recuperação aparece uma única vez; guarde-o fora do aparelho):

```json
{
  "accountId": "uuid-da-conta",
  "email": "pessoa@example.com",
  "displayName": "Pessoa",
  "token": "token-de-sessao",
  "recoveryCode": "ABCD-EFGH-JKLM-NPQR-STUV"
}
```

E-mail é normalizado com `strip().lower()`, deve ter até 254 caracteres e formato simples. A senha deve ter de 8 a 128 caracteres e ser diferente do e-mail. O consentimento `cloud_sync` com `policyVersion` é obrigatório.

### Login e sessão

```json
{ "email": "pessoa@example.com", "password": "uma-senha-segura", "deviceLabel": "Meu celular" }
```

Login retorna `accountId`, `email`, `displayName` e `token`. E-mail inexistente e senha incorreta retornam o mesmo status e mensagem (`401 invalid_credentials`). `GET /api/auth/me` retorna `accountId`, `email`, `displayName`, `createdAt` e `lastLoginAt`.

Troca de senha:

```json
{ "currentPassword": "senha-atual", "newPassword": "senha-nova-segura" }
```

Recuperação (o código tem 100 bits e validade configurável por `RECOVERY_CODE_TTL_MINUTES`, padrão 30 minutos):

```json
{ "email": "pessoa@example.com", "recoveryCode": "ABCD-EFGH-JKLM-NPQR-STUV", "newPassword": "senha-nova-segura" }
```

Resposta `200` inclui `message` e um `recoveryCode` novo, que substitui o anterior. O servidor não envia e-mail: o fluxo depende de o usuário ter guardado o código apresentado no cadastro ou na recuperação anterior.

### Sincronização versionada

Primeiro envio:

```json
{
  "baseVersion": 0,
  "deviceId": "instalacao-local",
  "payload": {
    "meds": [], "events": [], "logs": [], "dailyEntries": {},
    "name": "Pessoa", "contact": "", "pharmacyName": "", "pharmacyPhone": "",
    "hideMedicationNameInNotification": true
  }
}
```

Resposta: `{ "version": 1 }`. Próximos envios usam a versão que foi lida (`baseVersion`) e incrementam em um. Se outro aparelho já tiver gravado, a resposta é `409`:

```json
{ "error": "sync_conflict", "message": "Os dados desta conta mudaram em outro aparelho. Atualize e escolha como continuar.", "serverVersion": 3 }
```

O cliente deve buscar o snapshot e pedir ao usuário que decida como prosseguir; não há mesclagem automática porque o estoque muda a cada dose. `GET /api/sync` retorna `version`, `payload`, `payloadSchema`, `deviceId` e `updatedAt`.

O payload aceita apenas `meds`, `events`, `logs`, `dailyEntries`, `name`, `contact`, `pharmacyName`, `pharmacyPhone` e `hideMedicationNameInNotification`. Chaves locais como PIN, notificações e preferências do aparelho são descartadas. Datas usam `YYYY-MM-DD`, horários `HH:MM`; status de log: `taken`, `taken_late` ou `skipped`. Quantidades de dose devem ser numéricas e positivas; estoque, numérico e não negativo. `MAX_PAYLOAD_BYTES` limita o JSON da sincronização (padrão 1 MiB).

### Exclusão de conta

```http
DELETE /api/account
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{ "password": "senha-atual", "confirm": "EXCLUIR" }
```

A senha errada responde `401 invalid_credentials`; confirmação diferente de `EXCLUIR` responde `422 confirmation_required`. Sucesso responde `204` e apaga conta, sessões, snapshot, consentimentos e tentativas associadas à conta via `ON DELETE CASCADE`.

## Erros, limites e CORS

| Código HTTP | Erro | Significado |
| --- | --- | --- |
| `400` | `invalid_request` | Corpo JSON ausente ou inválido. |
| `401` | `invalid_credentials` / `session_expired` | Credenciais incorretas ou sessão encerrada. |
| `404` | `snapshot_not_found` | A conta ainda não tem cópia sincronizada. |
| `409` | `email_in_use` / `sync_conflict` | E-mail já usado ou versão desatualizada. |
| `413` | `payload_too_large` | Limite de sincronização excedido. |
| `422` | `invalid_*` / `consent_required` | Dados inválidos ou consentimento ausente. |
| `429` | `rate_limited` | Muitas tentativas; inclui `Retry-After` em segundos. |
| `503` | `service_unavailable` | Banco indisponível; sem detalhes internos. |
| `500` | `internal_error` | Falha inesperada; sem detalhes internos. |

Login e recuperação permitem 5 falhas em 15 minutos por combinação de e-mail normalizado e IP. Cadastro permite 10 requisições por hora por IP. O IP considera o primeiro item de `X-Forwarded-For`, então a API deve ficar atrás de um proxy confiável que reescreva esse cabeçalho. Falhas antigas (mais de 24h) são removidas oportunisticamente.

`CHECKMED_FRONTEND_ORIGINS` contém origens completas e exatas, separadas por vírgulas e sem caminho. CORS aceita `GET, POST, PUT, DELETE, OPTIONS`, os cabeçalhos `Content-Type, Authorization`, e preflight tem cache de 600 segundos. Origem não configurada não recebe `Access-Control-Allow-Origin`.
