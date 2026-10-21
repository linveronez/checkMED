# Decisões de implementação

| Etapa | Decisão | Motivo |
| --- | --- | --- |
| 1 | Baseline: suíte Python e suíte core Node executadas antes das mudanças; os resultados estão no relatório desta etapa. | Registrar o ponto inicial verificável antes de construir a API. |
| 1 | O SOS fica no cabeçalho fixo, em vez de botão flutuante. | Evita cobrir conteúdo e mantém o acesso disponível durante a rolagem. |
| 1 | O perfil usa um SVG de traço com `currentColor`; SOS e perfil têm alvo mínimo de 44 × 44 px. | Mantém aparência consistente e áreas de toque acessíveis. |
| 1 | SAMU 192 e CVV 188 ficam disponíveis por links `tel:` na tela bloqueada. | Permite iniciar uma ligação de emergência sem desbloquear o app; nenhum dado pessoal é mostrado ali. |
| 1 | O contato de confiança só recebe a ação “Ligar” se todo o campo parecer um telefone, com 10 a 13 dígitos e pontuação comum. | O campo também aceita nomes e texto livre; não extraímos números de texto misto para evitar ligar para um número incorreto. |

## Backend de conta e sincronização

| ID | Decisão | Motivo |
| --- | --- | --- |
| D1 | O servidor armazena um snapshot completo por conta e não mescla automaticamente snapshots. | O estoque varia após cada dose; uma mesclagem pode sobrescrever alterações clínicas. O conflito é devolvido para decisão do usuário. |
| D2 | O primeiro snapshot exige `baseVersion: 0`; versões seguintes usam atualização condicional e incrementam em 1. | A escrita atômica detecta concorrência sem transação distribuída nem estado local no servidor. |
| D3 | Senhas usam scrypt; tokens de sessão e códigos de recuperação só são persistidos como SHA-256. | Segredos em texto puro não devem permanecer no banco; scrypt aumenta o custo de tentativa de senha. |
| D4 | O código de recuperação tem 20 caracteres Base32 em blocos, é apresentado no cadastro/recuperação, vale 30 minutos por padrão e é rotacionado ao redefinir a senha. | Não existe provedor de e-mail no escopo desta fase; mostrar o código uma vez permite guardá-lo sem adicioná-lo a logs ou banco em texto claro. |
| D5 | Excluir conta exige a senha atual e a confirmação literal `EXCLUIR`; relações usam `ON DELETE CASCADE`. | Reduz exclusão acidental e centraliza a remoção dos dados relacionais. O `user_id` nas tentativas associa tentativas de conta para cascata. |
| D6 | Conexões PostgreSQL são abertas por requisição, com `connect_timeout=10` e uma tentativa adicional após falha operacional; migrations SQL ordenadas ficam rastreadas em `schema_migrations`. | Funções serverless não mantêm conexão ou arquivo durável de forma confiável; a repetição acomoda a retomada da compute Neon, e migrations são repetíveis e auditáveis. |
| Extra | O schema inclui `users.recovery_code_expires_at` e `auth_attempts.user_id` além das colunas descritas inicialmente. | Permite impor validade ao código e apagar tentativas associadas ao usuário na exclusão. Tentativas anônimas de IP sem uma conta associada continuam sendo retidas por até 24 horas. |
| Extra | O endpoint de recuperação devolve um código novo em JSON e não envia e-mail. | Nenhum provedor de mensagens ou verificação de posse do e-mail foi incluído nesta entrega; a aplicação cliente deve orientar o usuário a guardar o código. |
| Extra | Chaves do payload fora da lista permitida são descartadas, e a API grava `payload_schema=1`. | Impede sincronizar preferências locais ou futuras chaves não revisadas e identifica a forma atual do snapshot no banco. |
| Extra | Textos do snapshot recebem limites por campo entre 5 e 4.000 caracteres. | O `validateBackup` do frontend não centraliza limites de texto; a API escolhe limites explícitos para conter payloads excessivos e documenta esses valores no contrato. |
| Extra | O `accountId` retornado é o UUID da conta e a confirmação de exclusão usa a palavra `EXCLUIR`. | Mantém identificador estável entre aparelhos e confirmação independente da localização. |

## Interface de conta, segurança e privacidade

| Etapa | Decisão | Motivo |
| --- | --- | --- |
| 3 | Conta e nuvem são opcionais; o navegador continua sendo a fonte local de uso sem cadastro. | Mantém o fluxo atual disponível mesmo sem backend, conexão ou autorização de nuvem. |
| 3 | Restaurar um snapshot cria uma cópia local antes de substituir dados. Conflitos só são resolvidos após escolha explícita; não há mesclagem de registros. | O estoque e os registros de doses podem divergir entre aparelhos e não são seguros para mesclagem automática. |
| 3 | Sincronização automática é opt-in, espera após mudanças e respeita intervalo entre envios. Erros preservam o estado local; `409` pausa o fluxo e abre a escolha de conflito. | Reduz envios em excesso sem transformar uma cópia remota antiga em sobrescrita silenciosa. |
| 3 | CSP é criada por `config.js` com `script-src 'self'` e `connect-src` limitado à origem de `apiBase`. | O front-end estático pode usar uma API separada sem abrir conexões para qualquer origem. A hospedagem final também deve publicar a mesma política em cabeçalho HTTP. |
| 3 | Service Worker atualiza o shell para cache `v07`, inclui os arquivos de conta e páginas legais e nunca trata caminho `/api` como recurso offline. | Usuário recebe a nova interface após a ativação do worker e respostas de API não entram no cache do PWA. |
| 3 | Termos e privacidade são publicados como rascunhos com campos operacionais explícitos a confirmar. | Provedor, jurisdição, retenção, responsável e canal de direitos dependem da implantação e do responsável do projeto. |
| 3 | Alteração de senha mantém a sessão atual; redefinição por código mostra e exige guardar o código rotacionado, conforme contrato da API. | Evita bloquear uma sessão válida por erro de senha atual e preserva o fluxo de recuperação sem provedor de e-mail. |

## Roteiro manual antes da documentação final

Consulte [docs/teste-manual.md](teste-manual.md) para os fluxos de ponta a ponta que dependem de uma API implantada e de dois navegadores/dispositivos.
