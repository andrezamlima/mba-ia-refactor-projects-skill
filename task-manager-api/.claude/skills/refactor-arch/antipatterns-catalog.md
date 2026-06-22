# Anti-Patterns Catalog

Reference catalog for the `/refactor-arch` skill. Each entry maps to a detection signal and a fix pattern in `refactoring-playbook.md`.

---

## AP-01: SQL Injection

**Severity:** CRITICAL

**Description:** User-supplied input is concatenated directly into a SQL string before execution. An attacker can terminate the intended query and inject arbitrary SQL, leading to unauthorized data read, modification, or deletion, and in some configurations remote code execution.

**Detection signals:**
- String formatting (`%s %`, `.format()`, f-strings, `+` concatenation) used to build a SQL string that is then passed to `cursor.execute()`, `db.execute()`, `connection.query()`, or equivalent.
- Variable names such as `query`, `sql`, `stmt` whose value includes `{user_input}` or `+ variable`.

**Example (Python — vulnerable):**
```python
# VULNERABLE
def get_user(username):
    query = "SELECT * FROM users WHERE username = '" + username + "'"
    cursor.execute(query)
```

**Example (JavaScript — vulnerable):**
```javascript
// VULNERABLE
function getUser(username) {
  const query = `SELECT * FROM users WHERE username = '${username}'`;
  db.query(query);
}
```

**Fix:** PT-01 — use parameterized queries / prepared statements.

---

## AP-02: Hardcoded Secrets

**Severity:** CRITICAL

**Description:** Credentials, API keys, secret tokens, or cryptographic keys appear as string literals in source code. Any person with read access to the repository (including public forks, CI logs, or container images) can extract the secret.

**Detection signals:**
- Assignments such as `SECRET_KEY = "..."`, `API_KEY = "..."`, `password = "..."`, `token = "..."` with a literal string value.
- Values that look like random hex, base64, JWT, or a password string assigned at module level or in a config dict.

**Example (Python — vulnerable):**
```python
# VULNERABLE
SECRET_KEY = "super-secret-key-1234"
DB_PASSWORD = "admin123"
```

**Example (JavaScript — vulnerable):**
```javascript
// VULNERABLE
const SECRET_KEY = "super-secret-key-1234";
const DB_PASSWORD = "admin123";
```

**Fix:** PT-02 — move secrets to environment variables loaded via `python-dotenv` / `dotenv` npm package.

---

## AP-03: God Class / God File

**Severity:** CRITICAL

**Description:** A single file exceeds 200 lines and mixes multiple unrelated concerns: database access, business logic, HTTP route definitions, email sending, authentication checks, etc. This makes the file impossible to test in isolation, creates merge conflicts, and hides bugs.

**Detection signals:**
- A single `.py` or `.js` file longer than 200 lines.
- The same file contains `@app.route` / `app.get` calls AND raw SQL / ORM queries AND non-trivial business calculations.
- Imports from `flask`, `sqlite3`, `smtplib`, `jwt`, `bcrypt` all present in one file.

**Example (Python — vulnerable):**
```python
# VULNERABLE — app.py is 400+ lines mixing routes, DB, and email
@app.route('/users', methods=['POST'])
def create_user():
    # ... 30 lines of validation, DB insert, email sending
```

**Example (JavaScript — vulnerable):**
```javascript
// VULNERABLE — server.js with 400+ lines
app.post('/users', (req, res) => {
  // ... DB query, bcrypt, nodemailer, JWT all inline
});
```

**Fix:** PT-03 — split file by domain entity (models, controllers, routes, services).

---

## AP-04: Unauthenticated Admin Endpoints

**Severity:** CRITICAL

**Description:** Routes intended only for administrators (e.g., `/admin/`, `/admin/users`, `/admin/stats`) are reachable by any unauthenticated HTTP client. No token validation, session check, or role verification is applied before the handler executes.

**Detection signals:**
- Route path contains `/admin` but the handler function body has no call to an auth guard function, no `@require_admin` decorator, and no early return on missing/invalid token.
- Auth middleware is defined but is not applied to the admin Blueprint or router.

**Example (Python — vulnerable):**
```python
# VULNERABLE
@app.route('/admin/users')
def admin_list_users():
    users = db.execute("SELECT * FROM users").fetchall()
    return jsonify(users)
```

**Example (JavaScript — vulnerable):**
```javascript
// VULNERABLE
app.get('/admin/users', (req, res) => {
  const users = db.prepare('SELECT * FROM users').all();
  res.json(users);
});
```

**Fix:** PT-09 — apply `@require_admin` decorator / `requireAdmin` middleware.

---

## AP-05: Plain-Text Passwords

**Severity:** CRITICAL

**Description:** User passwords are stored in the database as plain text (or with a trivially reversible encoding such as base64). A single database breach exposes every user's password, which is typically reused across other services.

**Detection signals:**
- `INSERT INTO users` with a `password` column that receives the raw request value without a hash function call.
- No import of `bcrypt`, `werkzeug.security`, `argon2`, `hashlib` (or similar) before the INSERT.
- `SELECT` followed by a direct string comparison `user['password'] == request_password`.

**Example (Python — vulnerable):**
```python
# VULNERABLE
def register(username, password):
    db.execute(
        "INSERT INTO users (username, password) VALUES (?, ?)",
        (username, password)  # raw plain-text password
    )
```

**Example (JavaScript — vulnerable):**
```javascript
// VULNERABLE
function register(username, password) {
  db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, password);
}
```

**Fix:** PT-04 — hash with bcrypt / werkzeug `generate_password_hash` before storing.

---

## AP-06: Sensitive Data Exposure in Responses

**Severity:** HIGH

**Description:** API responses include fields that should never leave the server: `secret_key`, `password` (even hashed), internal tokens, credit card numbers, SSNs, or other secrets. Clients, logs, CDN caches, and monitoring tools can all capture these values.

**Detection signals:**
- `jsonify(user)` or `res.json(user)` where `user` is a raw database row dict that contains `password`, `secret_key`, `token`, `ssn`, or `card_number` columns.
- No explicit field whitelist or `.pop('password')` / `delete obj.password` before serialization.

**Example (Python — vulnerable):**
```python
# VULNERABLE
@app.route('/users/<int:user_id>')
def get_user(user_id):
    user = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    return jsonify(dict(user))  # exposes 'password', 'secret_key'
```

**Example (JavaScript — vulnerable):**
```javascript
// VULNERABLE
app.get('/users/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  res.json(user); // exposes password hash and any secret columns
});
```

**Fix:** PT-11 — sanitize response dicts/objects before serialization.

---

## AP-07: Global Mutable State

**Severity:** HIGH

**Description:** A database connection, connection pool, or other stateful resource is stored as a module-level global variable and mutated across requests. In threaded or async servers this causes race conditions; it also makes unit testing require monkey-patching globals.

**Detection signals:**
- `db_connection = sqlite3.connect(...)` or `conn = psycopg2.connect(...)` at module top level, outside any function.
- The global variable is then used directly inside route handlers without passing it as a parameter.

**Example (Python — vulnerable):**
```python
# VULNERABLE
import sqlite3
db_connection = sqlite3.connect('app.db')  # module-level global

@app.route('/users')
def list_users():
    return jsonify(db_connection.execute("SELECT * FROM users").fetchall())
```

**Example (JavaScript — vulnerable):**
```javascript
// VULNERABLE
const db = new sqlite3.Database('app.db'); // module-level global, shared state

app.get('/users', (req, res) => {
  db.all('SELECT * FROM users', (err, rows) => res.json(rows));
});
```

**Fix:** PT-05 — use Flask `g` / per-request connection factory, or inject dependency.

---

## AP-08: Business Logic / Side Effects in Controller

**Severity:** HIGH

**Description:** Route handler functions directly invoke external services (email, SMS, push notifications, payment processing) instead of delegating to a service layer. This makes handlers impossible to unit-test without live external connections and couples transport logic to the HTTP layer.

**Detection signals:**
- `import smtplib`, `import boto3`, `import twilio` (or similar) at the top of a routes/controllers file.
- Email construction (`MIMEText`, `smtplib.SMTP`) or SMS/push API calls inside a route handler function body.

**Example (Python — vulnerable):**
```python
# VULNERABLE
@app.route('/orders', methods=['POST'])
def create_order():
    # ... save order to DB ...
    smtp = smtplib.SMTP('smtp.gmail.com', 587)
    smtp.sendmail(FROM, user_email, message)  # side-effect in controller
```

**Example (JavaScript — vulnerable):**
```javascript
// VULNERABLE
app.post('/orders', async (req, res) => {
  // ... save order ...
  await transporter.sendMail({ to: userEmail, subject: 'Order confirmed', text: body });
});
```

**Fix:** PT-08 — extract a `NotificationService` (or `EmailService`) module.

---

## AP-09: Missing Authentication Middleware

**Severity:** HIGH

**Description:** The application implements a login endpoint and issues tokens/sessions, but the remaining routes that require authentication are not protected by any middleware or decorator. Any request, authenticated or not, reaches the handler.

**Detection signals:**
- A `login` route exists that returns a JWT or sets a session cookie.
- Other routes that logically require login (e.g., `/profile`, `/orders`, `/settings`) have no `@login_required`, `@jwt_required`, or equivalent guard, and no manual token check at the start of the handler.

**Example (Python — vulnerable):**
```python
# VULNERABLE — login exists but profile is unprotected
@app.route('/login', methods=['POST'])
def login():
    # ... validate credentials, return JWT

@app.route('/profile')  # no auth guard!
def profile():
    return jsonify(current_user_data())
```

**Example (JavaScript — vulnerable):**
```javascript
// VULNERABLE
app.post('/login', loginHandler);
app.get('/profile', profileHandler); // no authenticateToken middleware applied
```

**Fix:** PT-09 — apply auth middleware to protected routes.

---

## AP-10: N+1 Query Problem

**Severity:** MEDIUM

**Description:** The code issues one SQL query to retrieve a list of N records and then executes an additional query for each record inside a loop, resulting in N+1 total queries. This degrades performance super-linearly as data grows.

**Detection signals:**
- A `for` loop (or `.forEach`, `.map`) iterates over a query result set.
- Inside the loop body, another `db.execute(...)` or `db.query(...)` call references the loop variable.

**Example (Python — vulnerable):**
```python
# VULNERABLE
orders = db.execute("SELECT * FROM orders").fetchall()
for order in orders:
    # one extra query per order — N+1
    items = db.execute("SELECT * FROM items WHERE order_id=?", (order['id'],)).fetchall()
```

**Example (JavaScript — vulnerable):**
```javascript
// VULNERABLE
const orders = db.prepare('SELECT * FROM orders').all();
for (const order of orders) {
  const items = db.prepare('SELECT * FROM items WHERE order_id=?').get(order.id);
}
```

**Fix:** PT-06 — rewrite as a single JOIN query.

---

## AP-11: Duplicated Code

**Severity:** MEDIUM

**Description:** Two or more functions share more than 80% of their logic, differing only in minor details (a column name, a table name, a parameter). Any bug fix or enhancement must be applied in multiple places, and divergence over time is inevitable.

**Detection signals:**
- Two functions with nearly identical bodies; the diff is fewer than 3-4 lines.
- Copy-paste comments, identical variable names, identical SQL templates with only one identifier changed.

**Example (Python — vulnerable):**
```python
# VULNERABLE
def validate_create_user(data):
    if not data.get('email'): raise ValueError('email required')
    if not data.get('username'): raise ValueError('username required')
    if len(data['username']) < 3: raise ValueError('username too short')

def validate_update_user(data):
    if not data.get('email'): raise ValueError('email required')
    if not data.get('username'): raise ValueError('username required')
    if len(data['username']) < 3: raise ValueError('username too short')
    # only difference: also checks 'id'
    if not data.get('id'): raise ValueError('id required')
```

**Example (JavaScript — vulnerable):**
```javascript
// VULNERABLE
function validateCreateUser(data) { /* 10 lines */ }
function validateUpdateUser(data) { /* 10 identical lines + 1 extra check */ }
```

**Fix:** PT-07 — extract shared helper function parameterized by the varying elements.

---

## AP-12: Missing / Inconsistent Input Validation

**Severity:** MEDIUM

**Description:** Some endpoints validate incoming fields (required fields, type, length, format) but sibling endpoints that modify the same resource skip validation entirely. Attackers can use the unvalidated endpoint to inject malformed data.

**Detection signals:**
- A `create` endpoint validates fields; the corresponding `update` endpoint does not.
- Validation logic exists only in POST handlers but not in PUT/PATCH handlers for the same resource.
- No schema library (Pydantic, Marshmallow, Joi, Zod) is used and validation is done ad-hoc, making gaps easy to miss.

**Example (Python — vulnerable):**
```python
# VULNERABLE
@app.route('/products', methods=['POST'])
def create_product():
    data = request.json
    if not data.get('name'): return jsonify({'error': 'name required'}), 400
    if not data.get('price'): return jsonify({'error': 'price required'}), 400
    # ... insert

@app.route('/products/<int:id>', methods=['PUT'])
def update_product(id):
    data = request.json
    # no validation — any data accepted
    db.execute("UPDATE products SET name=?, price=? WHERE id=?",
               (data.get('name'), data.get('price'), id))
```

**Example (JavaScript — vulnerable):**
```javascript
// VULNERABLE
app.post('/products', (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: 'name required' });
  // ... insert
});
app.put('/products/:id', (req, res) => {
  // no validation
  db.prepare('UPDATE products SET name=?, price=? WHERE id=?')
    .run(req.body.name, req.body.price, req.params.id);
});
```

**Fix:** PT-07 (extract shared validator) and apply consistently to all mutating endpoints.

---

## AP-13: Print-as-Logging

**Severity:** LOW

**Description:** `print()` statements (Python) or ad-hoc `console.log()` calls (JavaScript) are used instead of a structured logging framework. Print output cannot be filtered by level, routed to log aggregators, enriched with timestamps/correlation IDs, or silenced in production without code changes.

**Detection signals:**
- `print(` appears in application code outside of CLI scripts or REPL helpers.
- `console.log(` used for operational events (errors, request processing, DB queries) rather than debug-only development output.
- No `import logging` / `const winston = require('winston')` (or similar) in the file.

**Example (Python — vulnerable):**
```python
# VULNERABLE
def create_user(data):
    print(f"Creating user: {data['username']}")
    # ...
    print("User created successfully")
```

**Example (JavaScript — vulnerable):**
```javascript
// VULNERABLE
function createUser(data) {
  console.log('Creating user:', data.username);
  // ...
  console.log('User created successfully');
}
```

**Fix:** PT-10 — replace with `logging.getLogger(__name__)` / structured logger.

---

## AP-14: Magic Numbers / Strings

**Severity:** LOW

**Description:** Numeric or string literals appear inline in logic without explanation or a named constant. Their meaning is unclear to future readers, and changing the value requires hunting through every occurrence rather than updating one definition.

**Detection signals:**
- Numeric literals other than 0 and 1 used in comparisons, arithmetic, or slice operations without a nearby comment or constant definition.
- String literals like `"admin"`, `"pending"`, `"4111"`, or HTTP status codes embedded directly in conditions.

**Example (Python — vulnerable):**
```python
# VULNERABLE
if len(password) < 8:  # what is 8?
    return error
if user['role'] == 'admin':  # magic string
    grant_access()
discount = price * 0.15  # where does 0.15 come from?
```

**Example (JavaScript — vulnerable):**
```javascript
// VULNERABLE
if (password.length < 8) { /* what is 8? */ }
if (user.role === 'admin') { /* magic string */ }
const discount = price * 0.15;
```

**Fix:** PT-12 — define named constants (`MIN_PASSWORD_LENGTH`, `ROLE_ADMIN`, `DISCOUNT_RATE`).

---

## AP-15: Deprecated / Obsolete API Usage

**Severity:** LOW

**Description:** The code uses framework APIs, library functions, or patterns that have been officially deprecated or removed. These may still work on the current installed version but will break on upgrade and may have known security issues.

**Detection signals:**
- `flask.ext.*` imports (removed in Flask 1.0+).
- `@app.before_first_request` decorator (deprecated in Flask 2.3, removed in Flask 3.0).
- Custom cryptographic hash implementations (`badCrypto`, hand-rolled MD5/SHA1 for passwords).
- `werkzeug.contrib` imports (removed in Werkzeug 1.0).
- Node.js: `crypto.createCipher` (deprecated), `new Buffer()` (deprecated in favor of `Buffer.from()`).

**Example (Python — vulnerable):**
```python
# VULNERABLE
from flask.ext.sqlalchemy import SQLAlchemy  # removed API
@app.before_first_request  # deprecated/removed decorator
def setup():
    init_db()

import hashlib
def hash_password(password):
    return hashlib.md5(password.encode()).hexdigest()  # MD5 for passwords — broken
```

**Example (JavaScript — vulnerable):**
```javascript
// VULNERABLE
const cipher = crypto.createCipher('aes192', password); // deprecated
const buf = new Buffer(data); // deprecated
```

**Fix:** Update to current stable APIs; use `bcrypt` for password hashing; use `Buffer.from()`.
