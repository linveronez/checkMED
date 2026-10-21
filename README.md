# CheckMed v0.1

Protótipo mobile-first para organizar medicamentos, registros pessoais e compromissos de saúde. O app armazena os dados no navegador deste aparelho; não há conta ou sincronização. Use um backup para preservar seus dados.

## Direção visual

O app Só por Hoje inspira a interface escura e acolhedora, os cartões arredondados, o azul/ciano como acento, a navegação fixa inferior e o acesso SOS. CheckMed mantém linguagem gentil e sem culpa, com um comprimido e um check azul na marca.

## Funcionalidades

- **Hoje:** doses agrupadas por horário, quantidade variável por dose, registro com hora real, ação “Tomei tudo”, opção de pular, desfazer e aviso de dose pendente.
- **Medicamentos:** rotinas diárias e medicamentos de uso eventual, edição, exclusão confirmada, estoque contado manualmente, previsão simples de reposição e validade da receita.
- **Histórico:** calendário mensal com registros reais, cores de adesão calculadas como tomadas sobre esperadas, registro de dose em data anterior e anotação diária somente leitura no Histórico. O registro fictício de demonstração foi removido.
- **Meu dia:** humor, anotação e perguntas para a próxima consulta; resumo textual exportável para levar à consulta. O cartão na tela Hoje abre esse registro.
- **Agenda:** compromissos, lista dos próximos 30 dias, sugestão de renovação de receita e exportação de evento `.ics`.
- **SOS:** ligação para SAMU 192 e CVV 188, buscas por farmácia/UPA/UBS/CAPS e contatos salvos neste aparelho. Os serviços de localização são pesquisas externas; confirme o resultado antes de se deslocar.
- **Perfil:** lembretes locais e segundo aviso após 30 minutos enquanto o app está aberto, opção de ocultar nomes nas notificações, instalação PWA, PIN local com limite progressivo de tentativas e bloqueio ao voltar ao app, exportação/importação com cópia automática antes de substituir dados.
- **PWA:** manifesto, ícones PNG, shell offline com busca à rede antes do cache e suporte a notificações recebidas por push quando houver servidor configurado.

## Dados e limites

O navegador pode apagar dados locais. Exporte backups com frequência e guarde-os em local protegido. Na importação, o CheckMed valida as listas e mantém apenas campos reconhecidos. Se o JSON local estiver corrompido, o texto bruto é preservado em outra chave local antes de abrir um estado vazio.

O PIN usa PBKDF2 para verificar o código e funciona como trava de privacidade local; ele não criptografa os dados e não impede acesso técnico ao navegador. Se o PIN for esquecido, o fluxo de recuperação apaga os dados locais e permite importar um backup ou começar um perfil novo. Guarde o backup. A biometria, contas e sincronização dependem de um backend de autenticação e são trabalho futuro.

Lembretes locais verificam horários apenas com o app aberto e podem chegar atrasados se o navegador suspender a página. Mantenha também o alarme do celular. Push em segundo plano exige HTTPS, VAPID, serviço de envio e armazenamento no servidor.

A previsão de estoque assume o consumo programado todos os dias. Ela não altera nem recomenda doses. O CheckMed ajuda a organizar registros; siga a orientação da sua equipe de saúde e ligue para o serviço de emergência em uma urgência.

## Rodar localmente

Para testar o PWA e as notificações em ambiente seguro, sirva esta pasta por HTTP local. Abrir `index.html` diretamente permite o protótipo, mas service worker, instalação e notificações têm limitações em `file://`.

### API Flask inicial

O backend oferece somente `GET /api/health` e não recebe dados de saúde. Para rodar no Windows:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
py -m pip install -r requirements.txt
py -m flask --app backend.server run --debug
```

O front-end pode ser hospedado no GitHub Pages e a API em um serviço com execução persistente. SQLite em função serverless não deve ser tratado como armazenamento durável compartilhado; defina banco e retenção antes de adicionar contas ou sincronização. Configure `CHECKMED_FRONTEND_ORIGINS` com a origem exata do site. Nunca publique `.env` ou segredos.

## Testes

```powershell
node --test tests/core.test.js
py -m pip install -e ".[test]"
py -m pytest
```

## Escopo futuro (Fase 3)

Contas, sincronização, WebAuthn/passkeys, recuperação, compartilhamento familiar com consentimento, push remoto, fila de lembretes e alarmes em segundo plano. A arquitetura proposta e seus limites estão em [FASE3-ARQUITETURA.md](FASE3-ARQUITETURA.md).
