
# Desafio 03 — Skill `/refactor-arch`

Skill para Claude Code que automatiza análise, auditoria e refatoração arquitetural de projetos legados para o padrão MVC. Agnóstica de tecnologia — funciona com Python/Flask e Node.js/Express.

---

## A) Análise Manual

### Projeto 1 — code-smells-project (Python/Flask E-commerce)

| Severidade | Arquivo | Linha(s) | Problema |
|---|---|---|---|
| CRITICAL | `models.py` | 17, 30, 37, 45, 70, 84, 106, 116, 145, 172, 206, 232, 275–285 | SQL Injection — todas as queries usam concatenação de string |
| CRITICAL | `app.py` | 8 | Hardcoded Secret Key — `"minha-chave-super-secreta-123"` no código |
| CRITICAL | `app.py` | 48–57, 60–79 | Endpoints `/admin/reset-db` e `/admin/query` sem autenticação |
| CRITICAL | `database.py` | 46–53 | Senhas em texto plano nos seeds e na query de login |
| HIGH | `controllers.py` | 114–120 | Secret key e `debug: True` expostos no response do `/health` |
| HIGH | `database.py` | 4–5 | Conexão de banco global mutável — não é thread-safe |
| HIGH | `controllers.py` | 83–90 | Side effects de notificação (`print ENVIANDO EMAIL/SMS`) dentro do controller |
| MEDIUM | `models.py` | 175–245 | N+1 queries em listagens de pedidos (cursor aninhado em loop) |
| MEDIUM | `models.py` | 175–245 | Duplicação de código — as duas funções de listagem de pedidos são ~95% idênticas |
| LOW | Todos | Vários | `print()` usado como logging operacional em vez de `logging` |
| LOW | `controllers.py` | 53–65, 77–95 | Validação inconsistente — `criar_produto` valida categoria, `atualizar_produto` não |
| LOW | `models.py` | 257–263 | Magic numbers na lógica de desconto (`10000`, `5000`, `0.1` sem constantes) |

**Por que são relevantes:**
- **SQL Injection** afeta 13+ locais e permite bypass total de autenticação com `' OR '1'='1`.
- **Endpoints admin sem auth** permitem que qualquer HTTP client apague o banco ou execute SQL arbitrário.
- **Senhas em texto plano** garantem que uma única violação do banco exponha 100% das credenciais.

---

### Projeto 2 — ecommerce-api-legacy (Node.js/Express LMS)

| Severidade | Arquivo | Linha(s) | Problema |
|---|---|---|---|
| CRITICAL | `src/utils.js` | 2–7 | Credenciais hardcoded — `dbPass`, `paymentGatewayKey`, `smtpUser` em texto plano |
| CRITICAL | `src/AppManager.js` | 1–120 | God Class — DB, rotas, pagamento, auditoria e cache misturados em uma classe |
| CRITICAL | `src/utils.js`, `AppManager.js` | `utils.js:15–21`, `AppManager.js:55` | `badCrypto()` — hash customizado trivialmente reversível usado para senhas |
| CRITICAL | `src/AppManager.js` | 68–100 | Endpoint `/api/admin/financial-report` público sem autenticação |
| HIGH | `src/AppManager.js` | 68–100 | N+1 queries com callback hell de 4 níveis no relatório financeiro |
| HIGH | `src/AppManager.js` | 20–65 | Lógica de pagamento embutida na rota — 50 linhas com callbacks aninhados |
| HIGH | `src/utils.js` | 9–10 | Cache global mutável sem TTL ou limite de tamanho |
| HIGH | `src/AppManager.js` | 101–105 | DELETE sem cascade — orphaned records documentados no próprio código |
| MEDIUM | `src/AppManager.js` | 42 | Magic string para aprovação de pagamento — `cc.startsWith("4")` hardcoded |
| MEDIUM | `src/AppManager.js` | Vários | Sem error handling centralizado — strings genéricas em vez de JSON |
| LOW | `src/AppManager.js`, `utils.js` | 42, 13 | `console.log` com número de cartão — dados sensíveis nos logs |
| LOW | `src/AppManager.js` | 13–17 | Parâmetros crípticos na API — `usr`, `eml`, `c_id` sem documentação |

**Por que são relevantes:**
- **God Class** torna impossível testar qualquer componente de forma isolada.
- **`badCrypto()`** dá falsa sensação de segurança — o hash é reversível por qualquer atacante.
- **N+1 com callbacks aninhados** em 4 níveis é impossível de manter e escala O(n×m).

---

### Projeto 3 — task-manager-api (Python/Flask + SQLAlchemy)

| Severidade | Arquivo | Linha(s) | Problema |
|---|---|---|---|
| CRITICAL | `models/user.py` | 27–32 | MD5 para senhas — sem salt, reversível por rainbow table em segundos |
| CRITICAL | `services/notification_service.py` | 8–11 | Credenciais SMTP hardcoded — `email_user` e `email_password` no código |
| HIGH | `models/user.py` | 16–25 | `to_dict()` inclui campo `password` em todos os responses de usuário |
| HIGH | `routes/task_routes.py`, `report_routes.py` | Múltiplos | Lógica de overdue duplicada 4+ vezes — modelo já tem `is_overdue()` ignorado |
| HIGH | `routes/report_routes.py` | 53–68 | N+1 — `Task.query.filter_by(user_id=...)` dentro de loop Python por usuário |
| MEDIUM | `services/notification_service.py` | Completo | Serviço de notificação definido mas nunca chamado — dead code |
| MEDIUM | `routes/user_routes.py`, `utils/helpers.py` | Vários | Validação de email duplicada — inline ignora `validate_email()` em helpers |
| MEDIUM | `routes/user_routes.py` | Login handler | Token JWT falso — string não assinada sem validação em nenhuma rota |
| MEDIUM | `utils/helpers.py` | 1–8 | Imports não utilizados — `sys`, `json`, `hashlib`, `os`, `math` |
| LOW | `utils/helpers.py` | `log_action()` | `print()` em `log_action()` em vez de logger estruturado |
| LOW | `routes/task_routes.py`, `user_routes.py` | Vários | Listas hardcoded em vez de `VALID_STATUSES` e `VALID_ROLES` de `helpers.py` |
| LOW | `app.py` | Última linha | `debug=True` hardcoded em vez de variável de ambiente |

**Por que são relevantes:**
- **MD5 para senhas** parece seguro mas é quebrado em segundos com rainbow tables públicas.
- **Password no `to_dict()`** vaza o hash em literalmente todo endpoint que retorna usuários.
- **N+1 no relatório** carrega todos os objetos Task em memória Python para contar por usuário.

---

## B) Construção da Skill

### Estrutura do SKILL.md

O `SKILL.md` foi estruturado como um **prompt de agente especialista** com 3 fases sequenciais, cada uma com responsabilidades estritamente separadas:

- **Fase 1 — somente leitura:** detecta stack, mapeia arquitetura, imprime resumo padronizado. Não toca em nenhum arquivo.
- **Fase 2 — somente leitura + relatório:** cruza o código contra o `antipatterns-catalog.md`, produz relatório formatado pelo `audit-report-template.md`, e **pausa obrigatoriamente** antes de qualquer modificação.
- **Fase 3 — escrita:** aplica transformações do `refactoring-playbook.md` seguindo a estrutura do `mvc-guidelines.md`, valida com boot da aplicação.

A regra central: **fases 1 e 2 são read-only**. O agente só pode modificar arquivos após confirmação explícita na transição para a Fase 3.

### Arquivos de referência e decisões de design

| Arquivo | Decisão de design | Por quê |
|---|---|---|
| `analysis-guide.md` | Heurísticas baseadas em extensões de arquivo e dependências declaradas | Nomes de arquivo variam; `package.json`/`requirements.txt` são confiáveis |
| `antipatterns-catalog.md` | 15 anti-patterns com sinais concretos (`cursor.execute("..." + str(id))`) | "Código ruim" não é acionável; o padrão exato é o que o agente precisa procurar |
| `audit-report-template.md` | Template com exemplo preenchido completo do Projeto 1 | O agente precisa ver o nível de detalhe esperado, não apenas o esqueleto |
| `mvc-guidelines.md` | Duas árvores de diretório: Flask e Express, com regras de responsabilidade por camada | A estrutura MVC difere entre stacks; definir as duas evita ambiguidade |
| `refactoring-playbook.md` | 12 padrões com código antes/depois em Python e JavaScript | Exemplos concretos evitam que o agente invente soluções |

### Como a skill é agnóstica de tecnologia

1. `analysis-guide.md` tem seções separadas por linguagem para detecção de framework e banco.
2. `antipatterns-catalog.md` tem sinais de detecção para Python E JavaScript onde o padrão difere.
3. `mvc-guidelines.md` define a estrutura MVC alvo para **Flask** e **Express** separadamente.
4. `refactoring-playbook.md` inclui exemplos nas duas linguagens.
5. O SKILL.md instrui o agente a detectar a tecnologia na Fase 1 e usar os guias correspondentes.

### Desafios encontrados

**Conflito de namespace Python (Projeto 1):** criar o pacote `database/` conflitou com o arquivo `database.py` legado — Python não pode ter módulo e pacote com o mesmo nome. Solução: renomear arquivos legados para `*_legacy.py`.

**N+1 com callbacks em Node.js (Projeto 2):** o driver `sqlite3` assíncrono torna a correção de N+1 verbosa. Solução: migrar para `better-sqlite3` (síncrono), que permite JOINs diretos com código limpo.

**Mudança de algoritmo de senha (Projeto 3):** trocar MD5 por werkzeug invalida hashes existentes. Solução: o `seed.py` já usa `u.set_password()` — ao re-rodar o seed após a mudança, todos os hashes são recriados automaticamente.

---

## C) Resultados

### Resumo dos relatórios de auditoria

| Projeto | Stack | CRITICAL | HIGH | MEDIUM | LOW | Total |
|---|---|---|---|---|---|---|
| code-smells-project | Python + Flask 3.1.1 | 5 | 3 | 2 | 3 | **13** |
| ecommerce-api-legacy | Node.js + Express 4.18 | 4 | 4 | 2 | 2 | **12** |
| task-manager-api | Python + Flask 3.0 + SQLAlchemy | 2 | 3 | 4 | 3 | **12** |

### Comparação de estrutura antes/depois

#### Projeto 1 — code-smells-project

```
ANTES (4 arquivos planos)          DEPOIS (MVC completo)
──────────────────────────         ──────────────────────────────────
app.py                             config/settings.py
controllers.py                     config/logging_config.py
models.py                          database/connection.py
database.py                        models/produto_model.py
                                   models/usuario_model.py
                                   models/pedido_model.py
                                   models/relatorio_model.py
                                   controllers/produto_controller.py
                                   controllers/usuario_controller.py
                                   controllers/pedido_controller.py
                                   routes/api_routes.py
                                   middlewares/auth.py
                                   middlewares/error_handler.py
                                   services/notification_service.py
                                   app.py  ← composition root
```

#### Projeto 2 — ecommerce-api-legacy

```
ANTES (God Class)                  DEPOIS (MVC Express)
──────────────────────             ──────────────────────────────────
src/app.js                         src/config/settings.js
src/AppManager.js  ← 120 linhas    src/database/connection.js
src/utils.js                       src/models/userModel.js
                                   src/models/courseModel.js
                                   src/models/enrollmentModel.js
                                   src/controllers/checkoutController.js
                                   src/controllers/reportController.js
                                   src/controllers/userController.js
                                   src/routes/checkoutRoutes.js
                                   src/routes/reportRoutes.js
                                   src/routes/userRoutes.js
                                   src/middlewares/auth.js
                                   src/middlewares/errorHandler.js
                                   src/services/paymentService.js
                                   src/app.js  ← composition root
```

#### Projeto 3 — task-manager-api

Estrutura preservada (já tinha `models/`, `routes/`, `services/`, `utils/`). Correções aplicadas:

| Arquivo | O que mudou |
|---|---|
| `models/user.py` | MD5 → `werkzeug.security`, campo `password` removido de `to_dict()` |
| `services/notification_service.py` | Credenciais SMTP → `os.environ`, `print()` → `logging` |
| `utils/helpers.py` | Imports desnecessários removidos, `log_action()` usa `logging` |
| `routes/report_routes.py` | N+1 → `func.count()` + `group_by()` do SQLAlchemy |
| `app.py` | `SECRET_KEY` e `DEBUG` → `os.environ`, versão `2.0.0` |

### Output de validação (testes automatizados)

**Projeto 1 — 20 PASS / 0 FAIL:**
```
[PASS] GET /                           versao: 2.0.0
[PASS] GET /health - status ok
[PASS] GET /health - secret_key NAO exposta
[PASS] GET /produtos - lista produtos (minimo 10)
[PASS] GET /produtos/busca?q=Notebook
[PASS] GET /produtos/1 - produto existe
[PASS] GET /produtos/9999 - 404
[PASS] POST /produtos - cria produto
[PASS] POST /produtos - categoria invalida -> 400
[PASS] GET /usuarios
[PASS] GET /usuarios/1
[PASS] POST /login - senha correta -> 200
[PASS] POST /login - senha errada -> 401
[PASS] POST /login - campos ausentes -> 400
[PASS] POST /pedidos - cria pedido
[PASS] GET /pedidos
[PASS] GET /pedidos/usuario/2
[PASS] PUT /pedidos/1/status - aprovado
[PASS] PUT /pedidos/1/status - status invalido -> 400
[PASS] GET /relatorios/vendas
```

**Projeto 2 — 10 PASS / 0 FAIL:**
```
[PASS] GET /
[PASS] POST /api/checkout - cartao Visa -> 200
[PASS] POST /api/checkout - cartao Master -> 400 (recusado)
[PASS] POST /api/checkout - campos ausentes -> 400
[PASS] POST /api/checkout - curso inexistente -> 404
[PASS] GET /api/admin/financial-report - sem token -> 401
[PASS] GET /api/admin/financial-report - token invalido -> 401
[PASS] POST /api/users/login - credenciais corretas -> 200
[PASS] POST /api/users/login - senha errada -> 401
[PASS] DELETE /api/users/1 - sem token -> 401
```

**Projeto 3 — 20 PASS / 0 FAIL:**
```
[PASS] GET /                           version: 2.0.0
[PASS] GET /health
[PASS] GET /tasks - 10 tasks retornadas
[PASS] GET /tasks/1
[PASS] GET /tasks/9999 - 404
[PASS] POST /tasks - cria task
[PASS] POST /tasks - status invalido -> 400
[PASS] GET /users - retorna 200
[PASS] GET /users - campo 'password' NAO exposto
[PASS] GET /users/1
[PASS] GET /users/9999 - 404
[PASS] POST /login - senha correta -> 200
[PASS] POST /login - senha errada -> 401
[PASS] POST /login - campos ausentes -> 400
[PASS] GET /reports/summary
[PASS] GET /reports/summary - total_tasks=11
[PASS] GET /reports/user/1
[PASS] GET /reports/user/9999 - 404
[PASS] GET /categories
[PASS] POST /categories - cria categoria
```

### Checklist de validação

#### Projeto 1 — code-smells-project

| Item | Status |
|---|---|
| Linguagem detectada (Python) | ✅ |
| Framework detectado (Flask 3.1.1) | ✅ |
| Domínio descrito (E-commerce API) | ✅ |
| ≥5 findings com arquivo e linha exatos | ✅ 13 findings |
| Findings ordenados CRITICAL → LOW | ✅ |
| Skill pausa para confirmação antes da Fase 3 | ✅ |
| Estrutura MVC criada | ✅ |
| Configuração extraída para `config/` | ✅ |
| Senhas com hash (werkzeug) | ✅ |
| SQL Injection corrigido (queries parametrizadas) | ✅ |
| Endpoints admin protegidos | ✅ |
| Error handling centralizado | ✅ |
| Aplicação inicia sem erros | ✅ |
| Todos os endpoints respondem | ✅ |

#### Projeto 2 — ecommerce-api-legacy

| Item | Status |
|---|---|
| Linguagem detectada (JavaScript/Node.js) | ✅ |
| Framework detectado (Express 4.18) | ✅ |
| Domínio descrito (LMS com checkout) | ✅ |
| ≥5 findings com arquivo e linha exatos | ✅ 12 findings |
| Skill pausa para confirmação | ✅ |
| God Class desmembrada em MVC | ✅ |
| `badCrypto` substituído por bcrypt | ✅ |
| Credenciais movidas para `.env` | ✅ |
| N+1 corrigido com JOIN único | ✅ |
| Endpoint admin protegido por `requireAdmin` | ✅ |
| Aplicação inicia sem erros | ✅ |
| Checkout e relatório financeiro funcionando | ✅ |

#### Projeto 3 — task-manager-api

| Item | Status |
|---|---|
| Linguagem detectada (Python) | ✅ |
| Framework detectado (Flask 3.0 + SQLAlchemy) | ✅ |
| Domínio descrito (Task Manager) | ✅ |
| ≥5 findings mesmo em projeto parcialmente organizado | ✅ 12 findings |
| Skill pausa para confirmação | ✅ |
| MD5 → werkzeug | ✅ |
| Password removido do `to_dict()` | ✅ |
| Credenciais SMTP → env vars | ✅ |
| N+1 → `func.count()` + `group_by()` | ✅ |
| Aplicação inicia sem erros | ✅ |
| Todos os endpoints respondem | ✅ |

---

## D) Como Executar

### Pré-requisitos

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) com API key da Anthropic configurada
- Python 3.10+ com `pip`
- Node.js 18+ com `npm`

### Executar a skill

```bash
# Projeto 1 — Python/Flask E-commerce
cd code-smells-project
pip install -r requirements.txt
claude "/refactor-arch"

# Projeto 2 — Node.js/Express LMS
cd ../ecommerce-api-legacy
npm install
claude "/refactor-arch"

# Projeto 3 — Python/Flask Task Manager
cd ../task-manager-api
pip install -r requirements.txt
python seed.py
claude "/refactor-arch"
```

### Rodar os testes de validação

```bash
# Projeto 1
cd code-smells-project
python test_app.py

# Projeto 2
cd ../ecommerce-api-legacy
node test_app.js

# Projeto 3
cd ../task-manager-api
python test_app.py
```

### Iniciar os servidores manualmente

```bash
# Projeto 1 — http://localhost:5000
cd code-smells-project && python app.py

# Projeto 2 — http://localhost:3000
cd ecommerce-api-legacy && npm start

# Projeto 3 — http://localhost:5000
cd task-manager-api
python seed.py   # necessário antes do primeiro boot
python app.py
```

### Relatórios de auditoria

```
reports/
├── audit-project-1.md   ← code-smells-project  (13 findings: 5C/3H/2M/3L)
├── audit-project-2.md   ← ecommerce-api-legacy (12 findings: 4C/4H/2M/2L)
└── audit-project-3.md   ← task-manager-api     (12 findings: 2C/3H/4M/3L)
``
