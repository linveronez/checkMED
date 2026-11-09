# CheckMed — Cuidado em Rotina

[![PWA](https://img.shields.io/badge/PWA-Offline--first-blue.svg)](manifest.json)

Aplicativo web progressivo (PWA) e *mobile-first* para organização de medicamentos, adesão a tratamentos de saúde, controle de estoque e acompanhamento de consultas.

O CheckMed foi concebido com foco em usabilidade humanizada, linguagem gentil e armazenamento local por padrão. O cache do PWA permite reabrir arquivos já carregados sem conexão; funções de conta e sincronização dependem da internet. Os textos de privacidade e termos estão em versão básica; uma revisão para ampliar as informações é cabível antes de uma divulgação mais ampla.

---

## 📱 Funcionalidades Principais

- **Hoje (Rotina Diária):** Doses agrupadas cronologicamente por horários, suporte a doses fracionadas (ex.: 0,25 ou 0,5 comprimido), ação rápida "Tomei tudo", registro com horário real, opção instantânea de desfazer e alertas visuais de doses pendentes.
- **Medicamentos:** Cadastro de rotinas diárias e de uso eventual (*SOS/se necessário*), edição de posologia, confirmação de exclusão, controle de estoque contado manualmente, projeção matemática do término dos comprimidos e controle de validade de receitas médicas.
- **Bula na Anvisa:** Cada cartão de medicamento possui o botão **"Bula na Anvisa ↗"**, que abre o Bulário Eletrônico oficial da Anvisa com o nome cadastrado no parâmetro da consulta; a apresentação dos resultados depende do serviço da Anvisa. A consulta acontece exclusivamente no site oficial da Anvisa; o CheckMed não baixa, não armazena e não substitui a bula do fabricante nem a orientação de um profissional de saúde.
- **Agenda:** Gestão de consultas médicas, retornos psicológicos e renovação de receitas. Apresenta calendário interativo, visão antecipada dos próximos 30 dias e exportação de eventos no formato padrão `.ics` (iCalendar) para integração com Google Agenda e Apple Calendar.
- **Histórico:** Calendário mensal com registros reais de tomadas e cores intuitivas de adesão terapêutica (proporção de doses tomadas sobre programadas). Permite o registro retrospectivo de doses em datas anteriores (com escolha de abater ou não do estoque).
- **Meu Dia (Diário de Saúde):** Registro do estado de humor através de emojis, sintomas, efeitos colaterais e dúvidas para a consulta médica. Gera um resumo formatado exportável com um clique para compartilhamento via WhatsApp ou impressão.
- **Central SOS:** Acesso emergencial com 1 toque para discagem imediata ao **SAMU (192)** e ao **CVV (188)**, busca de Farmácias, UPAs/UBSs e CAPS no Google Maps usando o bairro ou a cidade informados, além de discagem para contatos e farmácias de confiança salvas no aparelho.
- **Privacidade e Trava por PIN:** Trava de privacidade local com PIN de 4 a 8 dígitos, derivado com PBKDF2-HMAC-SHA-256 (210.000 iterações e salt aleatório). O PIN não é enviado à nuvem nem criptografa os dados armazenados no navegador.
- **Backup e Restauração:** Exportação e importação manual de cópias de segurança em formato `.json` estruturado, com higienização estrita de dados contra injeção de esquemas.
- **Conta e Sincronização em Nuvem (Opcional):** Sincronização assíncrona baseada em *snapshots* versionados. Se ocorrerem edições concorrentes em múltiplos aparelhos, a API detecta conflitos (`HTTP 409 Conflict`) e apresenta um modal para decisão consciente do usuário, sem sobrescritas silenciosas.

---

## 🛠️ Arquitetura e Tecnologias

- **Front-end:** HTML5 semântico, CSS3 responsivo (design system com tema escuro e áreas de toque acessíveis), JavaScript puro (ES6+ modular).
- **PWA:** Service Worker (`sw.js`) com estratégia *Network-first com fallback para Cache Storage*, manifesto de aplicação e ícones de alta resolução para instalação na tela inicial.
- **Back-end:** Python 3.12+ com microframework Flask, publicada na Vercel para conta e sincronização; localmente pode ser executada com o servidor de desenvolvimento do Flask.
- **Banco de Dados:** PostgreSQL hospedado no Neon, com conexão TLS e migrações versionadas.
- **Criptografia e Segurança:** *scrypt* para hashing de senhas, SHA-256 para tokens de sessão, códigos de recuperação Base32 (100 bits) e Content Security Policy (CSP) restritiva.

---

## 🚀 Como Executar Localmente

### 1. Front-end PWA (Cliente)
Para usufruir de todas as capacidades de Service Worker, instalação PWA e notificações, sirva a pasta por HTTP (não execute via `file://`):

```powershell
python -m http.server 8080
```
Abra o navegador em `http://localhost:8080`.

### 2. Back-end Flask (Opcional - para Conta e Nuvem)
```powershell
# 1. Ativar o ambiente virtual
py -m venv .venv
.\.venv\Scripts\Activate.ps1

# 2. Instalar dependências
pip install -r requirements.txt
pip install -e ".[test]"

# 3. Aplicar migrações no PostgreSQL Neon
python -m backend.migrate

# 4. Iniciar a API Flask
python -m flask --app backend.server run --debug --port 5000
```

---

## 🧪 Suíte de Testes Automatizados

O último relatório disponível registra 20 testes do núcleo JavaScript aprovados e 21 testes da API aprovados; dois testes de integração foram ignorados por dependerem de banco configurado. Esses números não foram reexecutados nesta revisão:

```powershell
# 1. Executar os 20 testes do núcleo front-end (Node.js)
node --test tests/core.test.js

# 2. Executar os testes da API Flask e segurança (Pytest)
.\.venv\Scripts\python.exe -m pytest
```

---

## 📚 Documentação do Projeto

- [Manual do Usuário](docs/MANUAL_DO_USUARIO.md)
- [Manual Técnico e de Implantação](docs/MANUAL_TECNICO.md)
- [Documentação Técnica da API e Arquitetura](docs/DOCUMENTACAO_TECNICA.md)
- [Decisões Arquiteturais (ADRs)](docs/decisoes.md)
- [Roteiro de Testes Manuais](docs/teste-manual.md)
- [Guia de Deploy em Nuvem](docs/deploy.md)
