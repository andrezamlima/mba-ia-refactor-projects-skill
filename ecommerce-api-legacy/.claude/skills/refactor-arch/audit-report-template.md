# Audit Report Template

Reference template for Phase 2 of the `/refactor-arch` skill. Fill in every field; do not omit line numbers or code quotes.

---

## Template

```
## Audit Report — [Project Name]

**Date:** YYYY-MM-DD
**Stack:** [e.g., Python 3.x / Flask / SQLite]
**Files analyzed:** [list of files, comma-separated]

### Summary

| Severity  | Count |
|-----------|-------|
| CRITICAL  | X     |
| HIGH      | Y     |
| MEDIUM    | Z     |
| LOW       | W     |
| **TOTAL** | **N** |

---

### Findings

---

#### [SEVERITY] AP-XX: [Anti-Pattern Name]

- **File:** `path/to/file.py`
- **Lines:** L–L
- **Description:** [What the code does wrong. Quote the relevant line(s).]
- **Impact:** [Concrete risk: data breach, account takeover, performance degradation, etc.]
- **Fix:** PT-XX — [one-line summary of the fix]
- **Recommendation:** [Specific action to take, including what to replace and with what.]

---
```

### Formatting Rules

1. **Exact line numbers are required.** Use `L10–L14` format. If a pattern spans the whole file, use `L1–LEOF`.
2. **Order findings CRITICAL → HIGH → MEDIUM → LOW.** Within a severity group, order by line number ascending.
3. **Quote the vulnerable code** in the Description field using a fenced code block or backtick inline quote. Do not paraphrase—copy the literal lines.
4. **Every Finding must reference an AP-ID** from `antipatterns-catalog.md` and a **PT-ID** from `refactoring-playbook.md`.
5. **Impact must name the attack vector or failure mode**, not just say "security risk."
6. **Recommendation must be actionable**: name the function, decorator, library, or pattern to use.

---

## Filled-In Example: code-smells-project

### Audit Report — code-smells-project

**Date:** 2026-06-22
**Stack:** Python 3.11 / Flask 2.x / SQLite 3 (via `sqlite3` stdlib)
**Files analyzed:** `app.py`, `models.py`, `routes.py`, `config.py`

#### Summary

| Severity  | Count |
|-----------|-------|
| CRITICAL  | 5     |
| HIGH      | 3     |
| MEDIUM    | 2     |
| LOW       | 2     |
| **TOTAL** | **12** |

---

#### Findings

---

#### [CRITICAL] AP-01: SQL Injection

- **File:** `app.py`
- **Lines:** L47–L49
- **Description:** User input from `request.args.get('username')` is concatenated directly into the SQL string before execution.
  ```python
  username = request.args.get('username')
  query = "SELECT * FROM users WHERE username = '" + username + "'"
  cursor.execute(query)
  ```
- **Impact:** An attacker can inject `' OR '1'='1` to dump all users, or `'; DROP TABLE users; --` to destroy data. Full database compromise with no credentials required.
- **Fix:** PT-01 — replace string concatenation with a parameterized query using `?` placeholders.
- **Recommendation:** Change to `cursor.execute("SELECT * FROM users WHERE username = ?", (username,))`. Apply this pattern to every `execute()` call that incorporates a variable.

---

#### [CRITICAL] AP-02: Hardcoded Secrets

- **File:** `config.py`
- **Lines:** L3–L5
- **Description:** The Flask secret key and database password are assigned as string literals.
  ```python
  SECRET_KEY = "super-secret-key-1234"
  DB_PASSWORD = "admin123"
  JWT_SECRET = "jwt-secret-token"
  ```
- **Impact:** Any developer with read access to the repository (including CI logs, container images, or GitHub history) can extract these credentials and forge session cookies or JWT tokens.
- **Fix:** PT-02 — load secrets from environment variables via `python-dotenv`.
- **Recommendation:** Create a `.env` file (added to `.gitignore`), set `SECRET_KEY`, `DB_PASSWORD`, `JWT_SECRET` there, and read them with `os.environ.get('SECRET_KEY')` or `os.getenv`. Rotate the current secrets immediately after removal from source.

---

#### [CRITICAL] AP-04: Unauthenticated Admin Endpoints

- **File:** `app.py`
- **Lines:** L112–L118
- **Description:** The `/admin/users` route is accessible without any authentication or role check.
  ```python
  @app.route('/admin/users')
  def admin_list_users():
      users = db.execute("SELECT * FROM users").fetchall()
      return jsonify([dict(u) for u in users])
  ```
- **Impact:** Any anonymous HTTP client can call `GET /admin/users` and retrieve the full user table, including password hashes and email addresses.
- **Fix:** PT-09 — apply `@require_admin` decorator before the route handler.
- **Recommendation:** Implement a `require_admin` decorator that validates the `Authorization` header JWT, verifies the `role == 'admin'` claim, and returns HTTP 401/403 otherwise. Apply it to every route under `/admin/`.

---

#### [CRITICAL] AP-05: Plain-Text Passwords

- **File:** `app.py`
- **Lines:** L58–L62
- **Description:** Passwords are stored as-is in the database with no hashing.
  ```python
  db.execute(
      "INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
      (username, email, password)   # raw plain-text password
  )
  ```
- **Impact:** A single SQL injection, database backup leak, or insider threat exposes every user's real password. Because passwords are reused, this leads to credential-stuffing attacks on other services.
- **Fix:** PT-04 — hash with `werkzeug.security.generate_password_hash` before storing; verify with `check_password_hash`.
- **Recommendation:** Replace `password` with `generate_password_hash(password, method='pbkdf2:sha256')` in the INSERT. Update the login handler to use `check_password_hash(stored_hash, provided_password)`.

---

#### [CRITICAL] AP-07: Global Mutable State (DB Connection)

- **File:** `app.py`
- **Lines:** L12–L14
- **Description:** A single SQLite connection is opened at module load time and shared across all requests.
  ```python
  db_connection = sqlite3.connect('app.db')
  db_connection.row_factory = sqlite3.Row
  ```
- **Impact:** SQLite connections are not thread-safe by default. Under concurrent requests, multiple threads writing through the same connection object produce data corruption or `ProgrammingError: Cannot operate on a closed database`. Unit tests that import the module carry this side effect.
- **Fix:** PT-05 — use the Flask `g` object to open a per-request connection and close it in `teardown_appcontext`.
- **Recommendation:**
  ```python
  def get_db():
      if 'db' not in g:
          g.db = sqlite3.connect(current_app.config['DATABASE'])
          g.db.row_factory = sqlite3.Row
      return g.db

  @app.teardown_appcontext
  def close_db(error):
      db = g.pop('db', None)
      if db is not None:
          db.close()
  ```

---

#### [HIGH] AP-06: Sensitive Data Exposure in Responses

- **File:** `app.py`
- **Lines:** L88–L92
- **Description:** The user object is serialized without removing the `password` and `secret_key` fields.
  ```python
  user = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
  return jsonify(dict(user))   # includes 'password', 'secret_key'
  ```
- **Impact:** The password hash is transmitted to the client and logged by any HTTP proxy or monitoring tool. Even a bcrypt hash enables offline cracking attempts.
- **Fix:** PT-11 — sanitize the response dict before serialization.
- **Recommendation:** Build an explicit allowlist: `safe = {k: v for k, v in dict(user).items() if k not in ('password', 'secret_key')}; return jsonify(safe)`.

---

#### [HIGH] AP-08: Business Logic / Side Effects in Controller

- **File:** `app.py`
- **Lines:** L134–L148
- **Description:** Email sending logic using `smtplib` is embedded directly inside the `create_order` route handler.
  ```python
  @app.route('/orders', methods=['POST'])
  def create_order():
      # ... DB insert ...
      smtp = smtplib.SMTP('smtp.gmail.com', 587)
      smtp.sendmail(FROM, user['email'], message)
  ```
- **Impact:** The route handler cannot be unit-tested without a live SMTP connection. SMTP failures cause HTTP 500 responses on order creation. Adding a second notification channel (SMS) requires modifying the controller.
- **Fix:** PT-08 — extract a `NotificationService` class.
- **Recommendation:** Create `services/notification_service.py` with a `send_order_confirmation(order, user)` method. The controller calls the service; the service handles SMTP details. Mock the service in tests.

---

#### [HIGH] AP-09: Missing Authentication Middleware

- **File:** `app.py`
- **Lines:** L74–L80
- **Description:** The `/profile` and `/orders` routes have no authentication guard despite the application issuing JWTs at login.
  ```python
  @app.route('/profile')
  def get_profile():
      user_id = request.args.get('user_id')
      ...
  ```
- **Impact:** Any unauthenticated client can access any user's profile by supplying an arbitrary `user_id` query parameter — broken object-level authorization (BOLA/IDOR).
- **Fix:** PT-09 — apply `@require_auth` decorator and derive `user_id` from the validated token, not from the request.
- **Recommendation:** Implement `require_auth` decorator that reads the `Authorization: Bearer <token>` header, validates the JWT signature, and stores `user_id` in `flask.g`. Remove `user_id` from the query parameter entirely.

---

#### [MEDIUM] AP-10: N+1 Query Problem

- **File:** `app.py`
- **Lines:** L155–L161
- **Description:** After fetching all orders, the code issues a separate query per order to retrieve its items.
  ```python
  orders = db.execute("SELECT * FROM orders").fetchall()
  for order in orders:
      items = db.execute("SELECT * FROM items WHERE order_id=?", (order['id'],)).fetchall()
  ```
- **Impact:** With 100 orders, 101 queries execute. Response time scales linearly with order count. At production scale this causes timeout errors and database CPU spikes.
- **Fix:** PT-06 — rewrite as a single JOIN query.
- **Recommendation:** `SELECT o.*, i.* FROM orders o LEFT JOIN items i ON i.order_id = o.id` and group items by order in Python.

---

#### [MEDIUM] AP-11: Duplicated Code

- **File:** `app.py`
- **Lines:** L30–L45 and L95–L110
- **Description:** `validate_create_user` and `validate_update_user` share identical field-checking logic, differing only in that the update version also checks for `id`.
- **Impact:** A bug fix in one validator is routinely not applied to the other. The functions have diverged twice already (per git blame).
- **Fix:** PT-07 — extract `validate_user_fields(data, require_id=False)`.
- **Recommendation:** Merge both functions into a single `validate_user_fields(data, *, require_id=False)` helper. Call it from both routes with the appropriate flag.

---

#### [LOW] AP-13: Print-as-Logging

- **File:** `app.py`
- **Lines:** L18, L63, L89, L140
- **Description:** Four `print()` calls are used for operational logging.
  ```python
  print(f"User {username} created successfully")
  print(f"DB error: {e}")
  ```
- **Impact:** Log output cannot be filtered by severity, routed to a log aggregator (CloudWatch, Datadog), enriched with request IDs, or silenced in production without code changes.
- **Fix:** PT-10 — replace with `logging.getLogger(__name__)`.
- **Recommendation:** Add `logger = logging.getLogger(__name__)` at module top and replace `print(...)` with `logger.info(...)` / `logger.error(...)` as appropriate.

---

#### [LOW] AP-14: Magic Numbers / Strings

- **File:** `app.py`
- **Lines:** L170, L182, L195
- **Description:** Discount rates, minimum password length, and role identifiers appear as inline literals.
  ```python
  if len(password) < 8:
  discount = price * 0.15
  if user['role'] == 'admin':
  ```
- **Impact:** Changing business rules (e.g., minimum password to 12 characters) requires grep-hunting every literal rather than updating one constant definition.
- **Fix:** PT-12 — define named constants.
- **Recommendation:** Create a `constants.py` module with `MIN_PASSWORD_LENGTH = 8`, `STANDARD_DISCOUNT_RATE = 0.15`, `ROLE_ADMIN = 'admin'`.

---

Phase 2 complete. Total findings: 12 (5C / 3H / 2M / 2L). Proceed with Phase 3? [y/n]
