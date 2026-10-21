# Decisões de implementação

| Etapa | Decisão | Motivo |
| --- | --- | --- |
| 1 | O SOS fica no cabeçalho fixo, em vez de botão flutuante. | Evita cobrir conteúdo e mantém o acesso disponível durante a rolagem. |
| 1 | O perfil usa um SVG de traço com `currentColor`; SOS e perfil têm alvo mínimo de 44 × 44 px. | Mantém aparência consistente e áreas de toque acessíveis. |
| 1 | SAMU 192 e CVV 188 ficam disponíveis por links `tel:` na tela bloqueada. | Permite iniciar uma ligação de emergência sem desbloquear o app; nenhum dado pessoal é mostrado ali. |
| 1 | O contato de confiança só recebe a ação “Ligar” se todo o campo parecer um telefone, com 10 a 13 dígitos e pontuação comum. | O campo também aceita nomes e texto livre; não extraímos números de texto misto para evitar ligar para um número incorreto. |
