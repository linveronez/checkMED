# Roteiro manual — conta e sincronização

Use uma base de testes isolada, HTTPS para o site/API e dados fictícios. Configure `apiBase` e a origem CORS antes de começar. Não use dados reais de saúde.

## Fluxo principal

- [ ] Sem API configurada, criar medicamento, registrar dose, humor e compromisso funciona localmente; o perfil informa que conta está indisponível.
- [ ] Com API configurada, criar conta e aceitar consentimento. O código de recuperação aparece uma vez; testar copiar/baixar e confirmar que continuar exige marcar “Guardei meu código”.
- [ ] Cadastrar dados fictícios no primeiro aparelho e verificar sincronização inicial.
- [ ] Em outro navegador/dispositivo, entrar na mesma conta vazia e confirmar que a cópia da nuvem é apresentada antes de substituir os dados locais.
- [ ] Com os dois aparelhos sincronizados, alterar dados nos dois; verificar resumo dos lados e contagens, escolher nuvem, adiar e escolher este aparelho.
- [ ] Alterar os dados no segundo aparelho entre abrir o conflito e escolher “usar os dados deste aparelho”; confirmar que `409` reabre o conflito atualizado.
- [ ] Ativar sincronização automática; fazer mudança, verificar envio após breve espera e testar reconexão depois de ficar offline. Confirmar que erro de rede mantém os dados locais.
- [ ] Apagar apenas a cópia da nuvem; verificar que os dados locais permanecem. Entrar em outro aparelho e conferir que snapshot removido não restaura conteúdo antigo.
- [ ] Exportar backup, redefinir senha com código, guardar o novo código, confirmar que sessão anterior é encerrada e entrar com a nova senha/código rotacionado.
- [ ] Trocar senha com senha atual correta/incorreta e verificar que a sessão atual permanece, enquanto as outras sessões são encerradas.
- [ ] Sair mantendo dados e sair removendo dados locais; confirmar que a nuvem permanece em ambos.
- [ ] Excluir conta com senha e palavra `EXCLUIR`, uma vez mantendo dados locais e outra em conta de teste removendo dados locais. Confirmar que a conta deixa de autenticar.

## Segurança e PWA

- [ ] DevTools → Network: chamadas à API usam HTTPS e não aparecem em Cache Storage. Confirmar `Cache-Control: no-store` da API e preflight CORS apenas para origens autorizadas.
- [ ] DevTools → Console: CSP sem violações com o domínio final. Tentar origem API não permitida e conferir que `connect-src` bloqueia.
- [ ] Instalar o PWA, atualizar uma versão, confirmar o shell novo (`checkmed-shell-v07`) e reabrir offline.
- [ ] Com a API indisponível/offline, navegar e consultar dados locais sem perder alterações; ao voltar online, revisar conflitos antes de enviar.

## Pendências de publicação

Revisar os rascunhos de [privacidade](../privacidade.html) e [termos](../termos.html), substituir todos os campos a confirmar, identificar o responsável, provedores/regiões, retenção, contato e processo de direitos/incidentes. Testes automatizados não substituem esse fluxo manual nem revisão jurídica.
