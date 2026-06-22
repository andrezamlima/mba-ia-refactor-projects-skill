# Audit Report — Projeto 1: code-smells-project

## Phase 1 — Static Analysis

**Project:** code-smells-project  
**Language/Stack:** Python  
**Analysis date:** 2026-06-22  
**Total findings:** 13 (5 CRITICAL · 3 HIGH · 2 MEDIUM · 3 LOW)

---

### CRITICAL Findings

---

#### AP-01 — SQL Injection (string concatenation in queries)

| Field | Detail |
|---|---|
| **ID** | AP-01 |
| **File** | `models.py` |
| **Lines** | 17, 30, 37, 45, 70, 84, 106, 116, 145, 172, 206, 232, 275–285 |
| **Description** | Raw user input is concatenated directly into SQL strings using f-strings or `%` formatting, e.g. `f"SELECT * FROM orders WHERE id = {order_id}"`. No parameterised queries or ORM query builders are used. |
| **Impact** | Any authenticated (or unauthenticated) caller can inject arbitrary SQL — extract the full database, drop tables, or escalate privileges. This is OWASP A03 (Injection), the most commonly exploited web vulnerability class. |
| **Fix** | Replace every raw query with parameterised statements: `db.execute("SELECT * FROM orders WHERE id = ?", (order_id,))` or use the ORM: `Order.query.filter_by(id=order_id).first()`. |
| **Recommendation** | Adopt an ORM (SQLAlchemy) across the entire codebase and add a linting rule (e.g. `bandit -t B608`) to CI to prevent regressions. |

---

#### AP-02 — Hardcoded Secret Key

| Field | Detail |
|---|---|
| **ID** | AP-02 |
| **File** | `app.py` |
| **Lines** | 8 |
| **Description** | `app.secret_key = 'super-secret-key-123'` is committed in plain text. Anyone with read access to the repository can forge session cookies. |
| **Impact** | Full session forgery — an attacker can craft a valid signed cookie for any user, including admins, without knowing any password. |
| **Fix** | Load from an environment variable: `app.secret_key = os.environ['SECRET_KEY']`. Rotate the key immediately after removing the hardcoded value. |
| **Recommendation** | Enforce secret scanning in CI (e.g. `detect-secrets`, GitHub Advanced Security). Never commit secrets, even in example files. |

---

#### AP-04 — Unauthenticated Admin Endpoints

| Field | Detail |
|---|---|
| **ID** | AP-04 |
| **File** | `app.py` |
| **Lines** | 48–57, 60–79 |
| **Description** | Admin routes (`/admin/users`, `/admin/orders`) have no authentication or authorisation guard — no session check, no token validation, no role check. |
| **Impact** | Any anonymous HTTP client can list all users, modify records, or delete data. Combined with AP-01, this gives full database control without credentials. |
| **Fix** | Add a decorator that verifies a valid session and `role == 'admin'` before executing any admin handler. Return `403 Forbidden` on failure. |
| **Recommendation** | Centralise authorisation in a single decorator or middleware so it cannot be accidentally omitted on new routes. Add integration tests that assert unauthenticated requests receive `401`/`403`. |

---

#### AP-05 — Plain-Text Passwords

| Field | Detail |
|---|---|
| **ID** | AP-05 |
| **File** | `database.py` (lines 46–53) · `models.py` (lines 106–116) |
| **Lines** | 46–53 (database.py), 106–116 (models.py) |
| **Description** | Passwords are stored and compared as plain text. The `save_user` function inserts `password` directly into the `users` table with no hashing. |
| **Impact** | A single database breach exposes every user's password in cleartext. Credential stuffing attacks become trivial across all services where users reuse passwords. |
| **Fix** | Hash passwords with `werkzeug.security.generate_password_hash` (bcrypt/scrypt) on write and verify with `check_password_hash` on login. Never store or log the raw value. |
| **Recommendation** | Migrate existing rows by forcing a password reset flow. Add a database-level `CHECK` or application-level invariant that no unhashed value (lacking the `pbkdf2:` prefix) can be inserted. |

---

#### AP-01 (search variant) — SQL Injection in Search Query Builder

| Field | Detail |
|---|---|
| **ID** | AP-01 |
| **File** | `models.py` |
| **Lines** | 275–285 |
| **Description** | The `search_orders` function dynamically builds a `WHERE` clause by appending unescaped filter parameters to a string buffer before executing the query. Each filter key and value is inserted verbatim. |
| **Impact** | Attacker controls both the column name and the comparison value, enabling blind SQL injection, `UNION`-based data exfiltration, and `; DROP TABLE` attacks in a single request. |
| **Fix** | Use an ORM filter chain (`query.filter(Order.status == status)`) or a whitelist of allowed column names combined with parameterised values. |
| **Recommendation** | Treat this as a separate finding from AP-01 because the dynamic key injection (not just value injection) makes it particularly dangerous and requires a different mitigation pattern. |

---

### HIGH Findings

---

#### AP-06 — Secret Key Exposed in Health Check Response

| Field | Detail |
|---|---|
| **ID** | AP-06 |
| **File** | `controllers.py` |
| **Lines** | 114–120 |
| **Description** | The `/health` endpoint returns `app.config` as part of its JSON response, which includes `SECRET_KEY` and database connection strings in plaintext. |
| **Impact** | Any client — including unauthenticated ones — can retrieve the application secret and forge session tokens without touching AP-02. |
| **Fix** | Return only safe fields from the health endpoint: `{'status': 'ok', 'timestamp': ...}`. Never serialize `app.config` to a response. |
| **Recommendation** | Add an automated test that asserts the health endpoint response does not contain any key whose name matches `SECRET`, `PASSWORD`, `KEY`, or `TOKEN`. |

---

#### AP-07 — Global Mutable DB Connection

| Field | Detail |
|---|---|
| **ID** | AP-07 |
| **File** | `database.py` |
| **Lines** | 4–5 |
| **Description** | A single `connection` object is created at module import time and shared across all requests. There is no connection pooling, no thread safety, and no error recovery. |
| **Impact** | Under concurrent load, multiple threads share the same connection object, causing race conditions, data corruption, and intermittent `OperationalError` crashes. A single failed query can break all subsequent requests until restart. |
| **Fix** | Use SQLAlchemy's `db.session` (scoped per request) or `flask_sqlalchemy` which manages connection pooling and thread-local sessions automatically. |
| **Recommendation** | Remove the global `connection` variable entirely. Configure pool size via `SQLALCHEMY_POOL_SIZE` environment variable so it can be tuned per deployment environment. |

---

#### AP-08 — Notification Side-Effects Inside Controller

| Field | Detail |
|---|---|
| **ID** | AP-08 |
| **File** | `controllers.py` |
| **Lines** | 83–90 |
| **Description** | The order-creation controller calls `smtplib.SMTP` directly and blocks the HTTP response thread while sending an email. If the SMTP server is slow or unreachable, the request times out for the user. |
| **Impact** | Any SMTP failure causes the HTTP request to fail with a 500 error, even though the order was successfully saved. Users cannot place orders during email outages. Response time spikes degrade the entire server under load. |
| **Fix** | Move email sending to an async worker (Celery task, RQ job, or at minimum a background thread). The controller should enqueue the notification and return `201` immediately. |
| **Recommendation** | Extract all notification logic into a `NotificationService` that accepts a task queue. This decouples the write path from the notification path and makes both independently testable. |

---

### MEDIUM Findings

---

#### AP-10 — N+1 Queries in Order Listing

| Field | Detail |
|---|---|
| **ID** | AP-10 |
| **File** | `models.py` |
| **Lines** | 175–245 |
| **Description** | `list_orders` fetches all orders with one query, then executes a separate `SELECT` per order to load the associated user and line items, resulting in `1 + N + N` queries for N orders. |
| **Impact** | Listing 100 orders executes 201+ queries. Response time grows linearly with record count. At production scale this saturates the database connection pool. |
| **Fix** | Use `joinedload` or `subqueryload`: `Order.query.options(joinedload(Order.user), joinedload(Order.items)).all()`. |
| **Recommendation** | Add query count assertions to integration tests using SQLAlchemy's event system to catch regressions before they reach production. |

---

#### AP-11 — Duplicated Order Fetch Logic

| Field | Detail |
|---|---|
| **ID** | AP-11 |
| **File** | `models.py` |
| **Lines** | 175–245 |
| **Description** | The pattern `order = db.execute(f"SELECT * FROM orders WHERE id = {id}").fetchone()` followed by a `None` check appears at least four times across different functions with no shared helper. |
| **Impact** | Any fix to the fetch logic (e.g. adding eager loading, changing the null check, fixing the SQL injection) must be applied manually in every copy. Inconsistency between copies has already introduced at least one place where the `None` check is missing. |
| **Fix** | Extract a single `get_order_or_404(order_id)` helper that raises `NotFound` if the record does not exist, and use it everywhere. |
| **Recommendation** | Enforce DRY via code review checklist: any pattern appearing more than twice must be extracted into a shared function before merging. |

---

### LOW Findings

---

#### AP-13 — Print-as-Logging

| Field | Detail |
|---|---|
| **ID** | AP-13 |
| **File** | All files |
| **Lines** | Throughout |
| **Description** | `print()` is used for all diagnostic output across the entire codebase. There is no structured logging, no log levels, and no way to suppress output in tests. |
| **Impact** | Diagnostic output cannot be filtered, redirected, or aggregated by log management systems (Datadog, CloudWatch, etc.). Sensitive data printed during debugging (e.g. order details, user emails) appears in terminal output with no way to disable it in production. |
| **Fix** | Replace every `print()` call with `logger = logging.getLogger(__name__)` and appropriate level calls (`logger.info`, `logger.error`). Configure `basicConfig` once in `app.py`. |
| **Recommendation** | Add a linting rule (`pylint: W1505` or a custom `flake8` plugin) that fails CI on any `print()` call outside of `__main__` blocks. |

---

#### AP-14 — Magic Numbers in Discount Logic

| Field | Detail |
|---|---|
| **ID** | AP-14 |
| **File** | `models.py` |
| **Lines** | 257–263 |
| **Description** | Discount thresholds and rates appear as bare numeric literals (`0.10`, `0.15`, `500`, `1000`) with no explanation of their business meaning. |
| **Impact** | Changing a discount rate requires hunting through the code for every occurrence. The values are easy to misread — `0.10` as a percentage vs. a fraction — and impossible to test in isolation. |
| **Fix** | Define named constants at the module top: `DISCOUNT_TIER_1_THRESHOLD = 500`, `DISCOUNT_TIER_1_RATE = Decimal('0.10')`. Reference only the constants in logic. |
| **Recommendation** | Move business rule constants to a dedicated `constants.py` or a configuration file so non-engineers can adjust rates without touching logic code. |

---

#### AP-12 — Inconsistent Validation

| Field | Detail |
|---|---|
| **ID** | AP-12 |
| **File** | `controllers.py` |
| **Lines** | 53–65 (user creation), 77–95 (order creation) |
| **Description** | The user creation endpoint validates email format and password length before saving; the order creation endpoint performs no input validation at all before executing database writes. |
| **Impact** | Malformed order data (null totals, negative quantities, overlong strings) is written directly to the database, causing data integrity failures and downstream processing errors. |
| **Fix** | Apply the same validation pattern to every write endpoint. Extract a `validate_order(data)` function that mirrors `validate_user(data)` and raises `ValidationError` on failure. |
| **Recommendation** | Adopt a schema validation library (marshmallow, pydantic) so validation rules are declared once per model and applied consistently at every entry point. |

---

## Phase 2 — Confirmation

```
The analysis above identified 13 findings across code-smells-project.

Proceed with generating the refactored files? [y/n]: y
```

Confirmed. Proceeding to Phase 2 — code generation.
