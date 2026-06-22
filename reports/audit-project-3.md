# Audit Report — Projeto 3: task-manager-api

## Phase 1 — Static Analysis

**Project:** task-manager-api (Python / Flask + SQLAlchemy)  
**Language/Stack:** Python · Flask · SQLAlchemy · SQLite  
**Analysis date:** 2026-06-22  
**Total findings:** 12 (2 CRITICAL · 3 HIGH · 4 MEDIUM · 3 LOW)

---

### CRITICAL Findings

---

#### AP-05 — MD5 Password Hashing

| Field | Detail |
|---|---|
| **ID** | AP-05 |
| **File** | `models/user.py` |
| **Lines** | 27–32 |
| **Description** | `set_password` stores `hashlib.md5(pwd.encode()).hexdigest()` and `check_password` compares with the same. MD5 is a general-purpose hash with no salt and no work factor — it is fundamentally unsuitable for password storage. |
| **Impact** | Any database breach exposes all user passwords instantly via precomputed rainbow tables or GPU brute force (billions of hashes per second on commodity hardware). GDPR Article 32 and OWASP ASVS L1 both require adaptive hashing. This is a compliance violation in addition to a security risk. |
| **Fix** | Replace both methods with `werkzeug.security`: `self.password = generate_password_hash(pwd)` and `return check_password_hash(self.password, pwd)`. The default algorithm (PBKDF2-HMAC-SHA256 with a random salt) is safe for production. |
| **Recommendation** | Force a password reset for all existing users after migrating, since MD5 hashes cannot be converted. Add a CI linting rule that fails on any import of `hashlib` in auth-related modules. |

---

#### AP-02 — Hardcoded SMTP Credentials

| Field | Detail |
|---|---|
| **ID** | AP-02 |
| **File** | `services/notification_service.py` |
| **Lines** | 8–11 |
| **Description** | `self.email_user = 'taskmanager@gmail.com'` and `self.email_password = 'senha123'` are hardcoded string literals in the class constructor. These credentials are committed to version control. |
| **Impact** | Anyone with repository access can send email as the application account, consume the email quota, or use the account to send phishing messages. Google will eventually lock the account for suspicious activity, breaking all notifications silently. |
| **Fix** | Read from environment variables: `self.email_user = os.environ.get('SMTP_USER', '')`. Guard `send_email` to return early with a warning log when credentials are absent, instead of attempting a connection that will fail. |
| **Recommendation** | Rotate the Gmail credentials immediately. Use an app-specific password or a transactional email provider (SendGrid, Mailgun) whose API key is stored in a secrets manager, not in source code. |

---

### HIGH Findings

---

#### AP-06 — Password Exposed in to_dict()

| Field | Detail |
|---|---|
| **ID** | AP-06 |
| **File** | `models/user.py` |
| **Lines** | 16–25 |
| **Description** | `User.to_dict()` includes `'password': self.password` in its return value. This method is called by every user-related API endpoint, so the hashed password is serialised into every GET /users and GET /users/:id response. |
| **Impact** | Although the stored value is an MD5 hash (itself a critical issue), exposing it leaks the hash to any API client, enabling offline cracking without any further database access. If the hash algorithm is ever upgraded, the new hashes are still leaked. |
| **Fix** | Remove `'password'` from the `to_dict` return dict. If an admin view genuinely needs to confirm password existence, expose a boolean `'has_password': bool(self.password)` instead. |
| **Recommendation** | Add an automated API test that asserts the key `password` is absent from every user-related response body. Run this test in CI on every commit. |

---

#### AP-11 — Overdue Task Logic Duplicated 4+ Times

| Field | Detail |
|---|---|
| **ID** | AP-11 |
| **File** | `routes/task_routes.py` · `routes/report_routes.py` |
| **Lines** | Multiple locations |
| **Description** | The pattern `if t.due_date and t.due_date < datetime.utcnow() and t.status not in ('done', 'cancelled')` appears at least four times across two route files, with minor inconsistencies between copies (one uses `!=` chained conditions, another uses `not in`). |
| **Impact** | A business rule change (e.g. adding a `'archived'` status that should also exclude tasks from overdue counts) requires finding and updating every copy. The inconsistency between copies means the summary report and the user report may return different overdue counts for the same data. |
| **Fix** | Extract a single helper: `def is_overdue(task): return bool(task.due_date and task.due_date < datetime.utcnow() and task.status not in ('done', 'cancelled'))`. Use it in every location. |
| **Recommendation** | Add a unit test for `is_overdue` covering all edge cases (no due date, future date, done status, cancelled status). This makes the business rule explicit and testable. |

---

#### AP-10 — N+1 Queries in User Stats Report

| Field | Detail |
|---|---|
| **ID** | AP-10 |
| **File** | `routes/report_routes.py` |
| **Lines** | 53–68 |
| **Description** | `summary_report` fetches all users (`User.query.all()`), then for each user executes `Task.query.filter_by(user_id=u.id).all()` inside a Python loop. For N users this produces N+1 database queries. |
| **Impact** | With 100 users the endpoint executes 101 queries. Response time grows linearly. Under concurrent reporting load, this exhausts the SQLAlchemy connection pool and causes request queuing. |
| **Fix** | Use a single aggregation query with `GROUP BY`: `db.session.query(Task.user_id, func.count(Task.id)).group_by(Task.user_id).all()`. Build the per-user stats from the aggregated result in Python with a dictionary lookup — O(1) per user. |
| **Recommendation** | Add a `SQLALCHEMY_ECHO = True` flag in the test environment and assert that the summary endpoint executes fewer than 10 queries total, regardless of user count. |

---

### MEDIUM Findings

---

#### AP-11 (dead code) — NotificationService Never Called

| Field | Detail |
|---|---|
| **ID** | AP-11 |
| **File** | `services/notification_service.py` |
| **Lines** | Entire file |
| **Description** | `NotificationService` is defined with `notify_task_assigned` and `notify_task_overdue` methods, but grep across all route and model files finds zero import or instantiation of this class. It is entirely dead code. |
| **Impact** | The hardcoded SMTP credentials in this file (AP-02) are a critical security risk for a service that is never even executed. The dead code creates maintenance confusion — developers may assume notifications are working when they are not. |
| **Fix** | Either wire `NotificationService` into the task assignment flow (the intended design), or delete the file. If wiring it in, fix AP-02 first by loading credentials from environment variables. |
| **Recommendation** | Add a coverage gate to CI: any module with 0% test coverage that is also unreferenced by any import should be flagged for deletion or activation. |

---

#### AP-12 — Email Validation Duplicated

| Field | Detail |
|---|---|
| **ID** | AP-12 |
| **File** | `routes/user_routes.py` · `utils/helpers.py` |
| **Lines** | Multiple locations |
| **Description** | Email format validation using a regex appears in both `user_routes.py` (inline in the route handler) and `utils/helpers.py` (as the `validate_email` function). The two regexes are slightly different. |
| **Impact** | An email address accepted at registration may be rejected at profile update, or vice versa, depending on which code path is hit. Users experience inconsistent behaviour with no clear error message. |
| **Fix** | Remove the inline regex from `user_routes.py` and use `validate_email` from `utils/helpers.py` exclusively. Ensure a single source of truth for all validation rules. |
| **Recommendation** | Adopt a schema validation library (marshmallow or pydantic) so email validation is declared once in a schema class and applied at every entry point automatically. |

---

#### AP-15 — Fake JWT Token Returned from Login

| Field | Detail |
|---|---|
| **ID** | AP-15 |
| **File** | `routes/user_routes.py` |
| **Lines** | Login endpoint |
| **Description** | The login endpoint returns `{'token': 'fake-jwt-token'}` as a hardcoded string. No real JWT is generated, no expiry is set, and no route verifies the token. The application has authentication UI but no functional authentication enforcement. |
| **Impact** | Any client that stores this fake token and sends it in subsequent requests will find that all protected routes accept it (since no verification exists). The appearance of authentication gives false security assurance. |
| **Fix** | Use `PyJWT` to generate a real token: `jwt.encode({'user_id': user.id, 'exp': datetime.utcnow() + timedelta(hours=24)}, SECRET_KEY, algorithm='HS256')`. Add a `require_auth` decorator that verifies the token on protected routes. |
| **Recommendation** | Consider `flask-jwt-extended` which provides ready-made decorators, token refresh, and revocation support with minimal boilerplate. |

---

#### AP-15 (imports) — Unused Imports in helpers.py

| Field | Detail |
|---|---|
| **ID** | AP-15 |
| **File** | `utils/helpers.py` |
| **Lines** | 1–8 |
| **Description** | `import os`, `import json`, `import sys`, `import math`, and `import hashlib` are present at the top of `helpers.py` but none of these modules are referenced anywhere in the file. |
| **Impact** | Unused imports are noise that slows reader comprehension, can cause name shadowing, and — in the case of `hashlib` — suggest the file once contained insecure password hashing that was partially removed. |
| **Fix** | Remove all five unused imports. Run `flake8 --select=F401` or `autoflake --remove-all-unused-imports` to detect and clean up automatically. |
| **Recommendation** | Add `flake8` with `F401` (unused imports) to the CI pipeline. The check takes under one second and prevents accumulation of dead imports. |

---

### LOW Findings

---

#### AP-13 — print() in log_action()

| Field | Detail |
|---|---|
| **ID** | AP-13 |
| **File** | `utils/helpers.py` |
| **Lines** | `log_action` function |
| **Description** | `log_action` uses `print(f"[{timestamp}] ACTION: {action}")` instead of the standard `logging` module. A function named `log_action` that does not use the logging framework is misleading. |
| **Impact** | Print output cannot be filtered by log level, redirected to a log aggregator, or suppressed during testing. Any sensitive detail passed as `details` is written to stdout unconditionally. |
| **Fix** | Replace with `logger = logging.getLogger(__name__)` at module level and `logger.info('ACTION: %s', action)` / `logger.debug('DETAILS: %s', details)` inside the function. |
| **Recommendation** | The fix for this finding can be batched with the broader logging standardisation across the project. All `print()` calls should be replaced in a single commit to keep the diff reviewable. |

---

#### AP-14 — Hardcoded Status/Role Lists Instead of Constants

| Field | Detail |
|---|---|
| **ID** | AP-14 |
| **File** | Multiple route files |
| **Lines** | Various |
| **Description** | Status values (`'pending'`, `'in_progress'`, `'done'`, `'cancelled'`) and role values (`'user'`, `'admin'`, `'manager'`) are hardcoded as string literals in route handlers and model methods, despite `VALID_STATUSES` and `VALID_ROLES` constants being defined in `utils/helpers.py`. |
| **Impact** | Adding a new status (e.g. `'on_hold'`) requires updating every location where the literal string appears, including places the developer may not find with a simple search. The constants in `helpers.py` become misleading because they are not actually used as the authoritative source. |
| **Fix** | Import `VALID_STATUSES` and `VALID_ROLES` from `utils.helpers` in every file that performs status/role checks. Replace all inline string literals with references to the constants. |
| **Recommendation** | Consider using Python `Enum` (`class TaskStatus(str, Enum): PENDING = 'pending'`) so the values are type-safe and IDE-navigable, and the database column can validate against the enum automatically. |

---

#### AP-02 (debug flag) — debug=True Hardcoded in app.py

| Field | Detail |
|---|---|
| **ID** | AP-02 |
| **File** | `app.py` |
| **Lines** | Last line |
| **Description** | `app.run(debug=True, host='0.0.0.0', port=5000)` hardcodes debug mode. Flask's debug mode enables the interactive Werkzeug debugger, which executes arbitrary Python code on the server when an exception occurs, and is accessible to any client that can reach the server. |
| **Impact** | If this application is accidentally deployed with debug mode on (which is easy when the flag is hardcoded), any unhandled exception exposes a web-based Python REPL to anyone on the network. This is a remote code execution vulnerability. |
| **Fix** | Read from an environment variable: `debug = os.environ.get('DEBUG', 'false').lower() == 'true'` then `app.run(debug=debug, ...)`. Default to `false` so production deployments are safe without explicit configuration. |
| **Recommendation** | Add a startup assertion that logs a prominent warning if `DEBUG=true` and `FLASK_ENV` is not `development`. Consider using a process manager (gunicorn, uvicorn) in production, which ignores the `debug` flag entirely. |

---

## Phase 2 — Confirmation

```
The analysis above identified 12 findings across task-manager-api.

Proceed with generating the refactored files? [y/n]: y
```

Confirmed. Proceeding to Phase 2 — code generation.
