# MANUAL TÉCNICO E DE IMPLANTAÇÃO — CHECKMED
**Versão do Documento:** atualizada em 9 de novembro de 2026

**Linguagens e Frameworks:** HTML5/CSS3/JavaScript (ES6+), Python 3.12+, Flask 3.x, PostgreSQL
**Público-alvo:** Desenvolvedores, mantenedores de software e avaliadores acadêmicos.

---

## 1. Visão Geral da Arquitetura

O **CheckMed** é projetado sob o modelo desacoplado de duas camadas principais:

```
+-------------------------------------------------------------------+
|                        CAMADA CLIENTE (PWA)                       |
| - index.html / styles.css: Interface responsiva e acessível       |
| - core.js: Regras de negócio puras (cálculos, validações, fuso)    |
| - api.js: Cliente HTTP com controle de autenticação e concorrência|
| - app.js: Orquestração de DOM, modais e link ao Bulário Anvisa   |
| - sw.js: Service Worker para cache de arquivos estáticos com tentativa de rede e fallback local |
+-------------------------------------------------------------------+
                                  │
                                  │ HTTPS (JSON + Bearer Token)
                                  ▼
+-------------------------------------------------------------------+
|                        CAMADA SERVIDOR (API)                      |
| - backend.server: Aplicação Flask e middleware CORS restritivo    |
| - backend.auth: Autenticação scrypt, sessões e rate-limiting       |
| - backend.sync: Sincronização versionada com concorrência otimista|
| - backend.payload: Sanitização e whitelisting estrito de esquemas |
| - backend.db: Pool de conexões PostgreSQL com reconexão resiliente|
+-------------------------------------------------------------------+
                                  │
                                  │ SSL / TLS (Conexão Pooler)
                                  ▼
+-------------------------------------------------------------------+
|                     BANCO DE DADOS RELACIONAL                     |
| - PostgreSQL no Neon Serverless                                |
| - Migrations idempotentes rastreadas em schema_migrations         |
+-------------------------------------------------------------------+
```

---

## 2. Requisitos de Ambiente

Para executar, testar e compilar o projeto em ambiente de desenvolvimento local, são necessárias as seguintes ferramentas:

| Ferramenta | Versão Recomendada | Finalidade |
| :--- | :--- | :--- |
| **Node.js** | v20 LTS ou superior | Executar o test runner nativo (`node --test`) para validação do núcleo do front-end. |
| **Python** | v3.12 ou superior | Executar a API Flask, rotinas de migração de banco e testes em Pytest. |
| **Git** | v2.40 ou superior | Controle de versão e publicação no GitHub. |
| **Navegador Moderno** | Chrome, Edge, Firefox, Safari | Testes de PWA, Service Workers, Web Crypto API e renderização responsiva. |
| **Instância PostgreSQL**| PostgreSQL (Neon na publicação atual) | Armazenamento de usuários, sessões e snapshots de sincronização. |

---

## 3. Estrutura de Diretórios do Projeto

```text
Projeto integrador - CheckMed/
├── .env.example                 # Modelo de variáveis de ambiente do back-end
├── .gitignore                   # Exclusão de arquivos voláteis (.venv, pycache, etc.)
├── api.js                       # Cliente de comunicação assíncrona com a API REST
├── app.js                       # Controladores de tela, manipulação de DOM e link dinâmico à Anvisa
├── config.js                    # Configuração de origem da API e Content Security Policy
├── core.js                      # Lógica de domínio clínica isolada e determinística
├── FASE3-ARQUITETURA.md         # Documento de especificações arquiteturais e roadmap
├── icon-180.png / icon-192.png  # Ícones em alta resolução para instalação PWA
├── icon-512.png / icon.svg      # Ícones vetoriais e manifestos para dispositivos
├── index.html                   # Casca única da aplicação (Single Page Application/PWA)
├── manifest.json                # Manifesto PWA com escopo, cores e ícones de atalho
├── privacidade.html             # Política de privacidade conforme a LGPD (rascunho)
├── pyproject.toml               # Metadados do projeto Python e declaração de entrypoint
├── requirements.txt             # Dependências Python travadas para produção
├── styles.css                   # Folha de estilo completa com tema escuro e responsivo
├── sw.js                        # Service Worker de ciclo de vida e cache offline
├── termos.html                  # Termos de uso da plataforma (rascunho)
├── backend/                     # Código-fonte da API Python Flask
│   ├── __init__.py              # Factory da aplicação Flask e rotas registradas
│   ├── account.py               # Exclusão de conta com cascata e confirmação literal
│   ├── auth.py                  # Endpoints de cadastro, login, tokens e recuperação
│   ├── db.py                    # Gerenciador de conexão PostgreSQL com tratamento de queda
│   ├── migrate.py               # Executável de migrações automáticas de esquema
│   ├── payload.py               # Validador e normalizador de snapshots de dados
│   ├── security.py              # Funções de hashing scrypt, SHA-256 e rate limit
│   ├── server.py                # Ponto de entrada padrão para Gunicorn / Vercel
│   ├── sync.py                  # Endpoints de sincronização com concorrência otimista
│   └── migrations/
│       └── 001_init.sql         # Script SQL de criação das tabelas e índices
├── docs/                        # Documentação técnica e manuais acadêmicos
│   ├── api.md                   # Contrato detalhado da API RESTful
│   ├── decisoes.md              # Registro de decisões arquiteturais (ADRs)
│   ├── deploy.md                # Guia de implantação em provedores de nuvem
│   └── teste-manual.md          # Roteiro manual de testes de concorrência e PWA
└── tests/                       # Suítes de testes automatizados
    ├── core.test.js             # 20 testes unitários do núcleo JavaScript
    ├── test_auth_unit.py        # Testes de autenticação e validação de senhas
    ├── test_backend.py          # Testes básicos da API Flask
    ├── test_backend_integration.py # Testes de integração direta com PostgreSQL Neon
    ├── test_backend_units.py    # Testes unitários de serviços e sanitização
    └── test_security.py         # Testes de derivação de senhas e proteção contra brute-force
```

---

## 4. Configuração e Execução Local

### 4.1. Execução do Front-end (Cliente PWA)
Para testar a experiência PWA (Service Worker e LocalStorage), o projeto não deve ser executado pelo protocolo `file://`, mas sim servido por um servidor HTTP local:

**Opção 1: Usando o servidor embutido do Python:**
```powershell
python -m http.server 8080
```
Abra o navegador no endereço: `http://localhost:8080`.

**Opção 2: Usando a extensão Live Server do VS Code:**
- Clique com o botão direito no arquivo `index.html` e selecione **"Open with Live Server"**.

---

### 4.2. Configuração e Execução do Back-end Flask

#### Passo 1: Criar e ativar o ambiente virtual (Virtualenv)
No terminal PowerShell, dentro da raiz do projeto:
```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
```

#### Passo 2: Instalar as dependências
```powershell
python -m pip install --upgrade pip
pip install -r requirements.txt
pip install -e ".[test]"
```

#### Passo 3: Configurar as variáveis de ambiente

O backend lê as variáveis do ambiente do processo; criar um arquivo `.env` sozinho não as carrega automaticamente. No PowerShell, configure-as na sessão antes de executar a migração e a API. Não publique nem compartilhe valores secretos.

```powershell
$env:DATABASE_URL = Read-Host "String de conexão do Neon"
$env:SECRET_KEY = Read-Host "Chave secreta da API"
$env:CHECKMED_FRONTEND_ORIGINS = "http://localhost:8080,http://127.0.0.1:8080,https://linveronez.github.io"
$env:SESSION_DAYS = "30"
```

Aplique a migração com `python -m backend.migrate` e, depois, inicie a API local conforme o comando descrito nesta seção. Ao encerrar, limpe as variáveis sensíveis da sessão com `Remove-Item Env:DATABASE_URL,Env:SECRET_KEY`.

#### Passo 4: Executar as migrações no banco de dados
Com a variável `DATABASE_URL` preenchida com a connection string do Neon:
```powershell
python -m backend.migrate
```
*Saída esperada:* `Migrações aplicadas com sucesso: 001_init.sql`.

#### Passo 5: Iniciar o servidor da API
```powershell
python -m flask --app backend.server run --debug --port 5000
```
O serviço estará operando em `http://127.0.0.1:5000`. Teste acessando no navegador: `http://127.0.0.1:5000/api/health` (deve retornar `{"status": "ok"}`).

#### Passo 6: Conectar o Front-end ao Back-end Local
No arquivo `config.js`, defina:
```javascript
window.CHECKMED_CONFIG = {
  apiBase: "http://127.0.0.1:5000"
};
```

---

## 5. Execução dos Testes Automatizados

O CheckMed possui cobertura de testes dividida em duas baterias independentes.

### 5.1. Testes do Front-end (JavaScript / Node.js)
Valida normalização de horários, cálculo de estoque com doses fracionadas, razão de adesão terapêutica, agrupamento cronológico, serialização e sanitização de dados:

```powershell
node --test tests/core.test.js
```
*Resultado esperado:* **20 tests passados (0 falhas).**

### 5.2. Testes do Back-end (Python / Pytest)
Valida endpoints da API Flask, criptografia scrypt, códigos de recuperação, sessões e integridade de esquemas:

```powershell
.\.venv\Scripts\python.exe -m pytest
```
*Resultado esperado:* **21 passed, 2 skipped** (os 2 testes pulados são de integração ao vivo que exigem a variável `TEST_DATABASE_URL`).

---

## 6. Procedimento de Implantação em Produção (Deploy)

A arquitetura do CheckMed foi desenhada para operar com custo zero em planos gratuitos consolidados:

### 6.1. Banco de Dados (Neon PostgreSQL)
1. Crie uma conta gratuita em [neon.tech](https://neon.tech);
2. Crie um novo projeto chamado `checkmed`;
3. Copie a string de conexão com pooler ativado (`-pooler` no host) e parâmetro `sslmode=require`;
4. Execute o script de migração localmente apontando para essa URL:
   ```powershell
   $env:DATABASE_URL="sua_string_neon"
   python -m backend.migrate
   ```

### 6.2. Back-end Flask (Vercel)
- **Na Vercel:** a API está publicada em `https://checkmed-tau.vercel.app`. Para um novo deploy, conecte o repositório, selecione o runtime Python e configure `DATABASE_URL`, `SECRET_KEY` e `CHECKMED_FRONTEND_ORIGINS`. A raiz do domínio retorna JSON; as rotas da API ficam sob `/api`.

### 6.3. Front-end PWA (GitHub Pages)
1. Suba o projeto para o repositório no GitHub;
2. Vá em **Settings → Pages** e escolha a branch `main` (pasta root);
3. No arquivo `config.js`, configure `apiBase` com `https://checkmed-tau.vercel.app` (somente o domínio, sem `/api` no final).
4. Configure `https://linveronez.github.io` em `CHECKMED_FRONTEND_ORIGINS`; a origem não inclui o caminho `/checkMED/`.

---

## 7. Recurso Técnico: Consulta ao Bulário Eletrônico da Anvisa

Na camada de apresentação dos medicamentos (`app.js`), o CheckMed integra uma chamada direta de pesquisa pública:

```javascript
const bulaUrl = `https://consultas.anvisa.gov.br/#/bulario/q/?nomeProduto=${encodeURIComponent(m.name)}`;
```

- **Isolamento de Segurança:** O link é montado com a tag `<a>` utilizando `target="_blank"` e `rel="noopener noreferrer"`, assegurando que a página aberta da Anvisa não possua referência `window.opener` ao CheckMed e não execute scripts em nosso contexto.
- **Armazenamento Zero de Bulas:** O sistema não salva, não baixa e não processa arquivos PDF ou textos de bulas no banco de dados ou no cache local. Isso evita sobrecarga de armazenamento, cumpre o requisito de gratuidade em discos efêmeros e previne obsolescência de informações regulatórias.
- **Isenção Legal e Técnica:** O recurso atua exclusivamente como ponte de consulta ao órgão sanitário oficial. O software destaca expressamente que a consulta não substitui a bula fornecida pelo fabricante e nem a prescrição e acompanhamento individualizado realizado por médicos ou farmacêuticos.
