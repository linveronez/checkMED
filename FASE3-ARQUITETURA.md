# CheckMed — Preparação da Fase 3

## Recursos de conta já implementados nesta versão

- Conta opcional via API: cadastro, login, troca de senha, redefinição com código, logout, exclusão e sincronização versionada; detalhes em [docs/api.md](docs/api.md).
- Dados sem conta permanecem no aparelho. O snapshot remoto exclui PIN, permissões/estado de notificações e metadados locais de backup, conforme a lista permitida em `docs/api.md`. A primeira substituição por dados da nuvem cria um backup local.
- Conflitos entre versões são mostrados para decisão explícita; o app nunca mescla ou sobrescreve em segundo plano diante de conflito.
- A sincronização automática é opcional, em lote após mudanças, com intervalo mínimo e aviso de conflito. API usa `no-store`; Service Worker ignora caminhos `/api` e atualiza o shell para cache `v07`.
- `config.js` injeta uma CSP restrita à origem local e à origem configurada em `apiBase`. Na hospedagem final, configure também o cabeçalho CSP do servidor e confirme a política com a origem da API.
- [privacidade.html](privacidade.html) e [termos.html](termos.html) são rascunhos não revisados; identificações, provedores, localidades e canais ainda devem ser preenchidos.

## O que esta versão prepara

- Instalação como PWA: manifesto com identificador e escopo, apresentação standalone, PNGs 180/192/512, botão de instalação e shell offline com consulta à rede antes do cache.
- Lembrete local enquanto o app está aberto: consulta os horários cadastrados, tolera até 30 minutos de atraso e reavalia ao voltar à aba.
- Recepção de Web Push no service worker: o evento `push` já mostra notificações comuns e alarmes a partir de um payload JSON.
- Clique na notificação: reabre ou traz o CheckMed para frente.
- Trava local opcional por PIN: PBKDF2 e salt aleatório no aparelho. É somente uma barreira de privacidade; os dados permanecem legíveis no armazenamento do navegador.
- Perfil explica requisitos de biometria e push remoto.
- API Flask com conta/sincronização, CORS por origens permitidas e ponto de entrada para Vercel.

## Contrato de Web Push preparado

Payload enviado pelo servidor ao endpoint push assinado pelo aparelho:

```json
{
  "title": "Hora do seu medicamento",
  "body": "1 comprimido · horário cadastrado 08:00",
  "type": "alarm",
  "tag": "dose-<id>-<data>",
  "url": "/"
}
```

`type: "alarm"` pede interação visível e vibração quando o sistema operacional permitir. `showNotification` e Web Push são entregues como melhor esforço: economia de bateria, foco, permissões e políticas do aparelho podem atrasar ou suprimir alertas. Um alarme médico com garantia de horário exige um app nativo e uma análise específica de plataforma; o navegador não deve ser apresentado como substituto de um alarme confiável.

## Serviços necessários antes de ativar push em produção

1. Publicar o app em HTTPS e configurar chaves VAPID no servidor, mantendo a chave privada fora do navegador e do repositório.
2. Criar endpoints autenticados para obter a chave pública, registrar e remover a assinatura (`PushSubscription`).
3. Associar assinatura e horários à conta, com consentimento explícito, revogação, rotação e limpeza de dispositivos inválidos.
4. Criar uma fila de envios com fuso horário do perfil, deduplicação por dose/data e regras para cancelamento quando uma tomada já tiver sido registrada.
5. Enviar apenas o mínimo de informação de saúde no push. Preferir texto genérico na tela bloqueada e mostrar o detalhe depois do desbloqueio.
6. Configurar privacidade, retenção, recuperação de conta, monitoramento e proteção contra abuso do envio.

## PIN e biometria

- O PIN local do protótipo não é autenticação de conta. Para evoluir, implementar limite de tentativas, atraso progressivo, recuperação segura e sessão curta; não reutilizar o hash local como credencial de servidor.
- Biometria no navegador deve usar WebAuthn/passkeys. O servidor cria e valida desafios únicos; o aparelho guarda a chave privada e não entrega impressão digital ou rosto ao CheckMed.
- A conta, a sessão e o fluxo de recuperação já permitem sincronização por snapshot. A biometria será uma forma de desbloqueio, não uma identidade paralela.
- Para dados de saúde, projetar criptografia em trânsito e repouso, controle de acesso e registro de consentimentos antes de ativar sincronização ou compartilhamento familiar.

## Limites atuais

O uso de conta só funciona quando a API Flask/PostgreSQL está implantada, `apiBase` está configurado e CORS aceita a origem do site. A notificação local depende de o CheckMed permanecer aberto. O service worker sabe exibir uma mensagem push recebida, mas não há inscrição push nem serviço que envie mensagens. O PIN local é uma trava de privacidade, não autenticação forte. Biometria e alarmes remotos ainda não estão ativos e não devem ser tratados como recurso de produção.
