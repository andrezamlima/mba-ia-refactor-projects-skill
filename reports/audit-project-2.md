# Audit Report — Projeto 2: ecommerce-api-legacy

## Phase 1 — Static Analysis

**Project:** ecommerce-api-legacy (Node.js / Express — LMS)  
**Language/Stack:** Node.js · Express · SQLite (better-sqlite3)  
**Analysis date:** 2026-06-22  
**Total findings:** 12 (4 CRITICAL · 4 HIGH · 2 MEDIUM · 2 LOW)

---

### CRITICAL Findings

---

#### AP-02 — Hardcoded Credentials

| Field | Detail |
|---|---|
| **ID** | AP-02 |
| **File** | `src/utils.js` |
| **Lines** | 2–7 |
| **Description** | Database path, admin username, admin password, and JWT secret are hardcoded as string literals at the top of `utils.js`. These values are committed to version control in plain text. |
| **Impact** | Any developer, contractor, or attacker with repository read access obtains full admin credentials and can forge JWT tokens. Rotating the secret requires a code change, redeploy, and invalidates all existing sessions simultaneously. |
| **Fix** | Load every secret from environment variables: `const JWT_SECRET = process.env.JWT_SECRET`. Fail fast at startup if required variables are missing (`if (!JWT_SECRET) throw new Error('JWT_SECRET not set')`). |
| **Recommendation** | Add `detect-secrets` or `truffleHog` to CI. Store secrets in a vault (AWS Secrets Manager, HashiCorp Vault, or at minimum `.env` files excluded from git). |

---

#### AP-03 — God Class: AppManager

| Field | Detail |
|---|---|
| **ID** | AP-03 |
| **File** | `src/AppManager.js` |
| **Lines** | 1–120 |
| **Description** | `AppManager` is a single class (120 lines) that owns: Express route registration, database connection management, user authentication, payment processing, course enrollment, and cache invalidation. It has at least 8 distinct responsibilities. |
| **Impact** | Any change to one responsibility risks breaking all others. The class cannot be unit-tested in isolation — instantiating it requires a live database, a live payment gateway, and a live cache. Onboarding new developers takes significantly longer because there is no clear separation of concerns. |
| **Fix** | Decompose into single-responsibility modules: `AuthService`, `PaymentService`, `EnrollmentService`, `CourseRepository`, and an Express router that wires them together. Each module should be independently testable. |
| **Recommendation** | Apply the Single Responsibility Principle strictly. Target a maximum of 50–80 lines per class/module as a team convention enforced via code review. |

---

#### AP-05 — Weak Password Hashing (MD5 / badCrypto)

| Field | Detail |
|---|---|
| **ID** | AP-05 |
| **File** | `src/utils.js` (lines 15–21) · `src/AppManager.js` (line 55) |
| **Lines** | 15–21 (utils.js), 55 (AppManager.js) |
| **Description** | The `hashPassword` function in `utils.js` uses Node's built-in `crypto.createHash('md5')` — a fast, unsalted hash completely unsuitable for passwords. `AppManager.js` calls this function when registering users. |
| **Impact** | MD5 hashes are broken in seconds with rainbow tables or GPU brute force. A database breach exposes every user's real password. The LMS likely stores payment and personal data, raising GDPR/PCI compliance risk. |
| **Fix** | Replace with `bcrypt` (`bcryptjs`) or `argon2` with a minimum work factor of 12 rounds. Re-hash on next successful login for existing users. |
| **Recommendation** | Add an automated test that asserts the stored hash does NOT begin with a known MD5 pattern. Include password-hashing strength in the security checklist for every auth-related PR. |

---

#### AP-04 — Unauthenticated Admin Endpoint

| Field | Detail |
|---|---|
| **ID** | AP-04 |
| **File** | `src/AppManager.js` |
| **Lines** | 68–100 |
| **Description** | The admin route block (`/admin/*`) registers handlers that call `listAllUsers`, `deleteUser`, and `resetPayments` with no authentication middleware. No JWT verification, no session check, no IP allowlist. |
| **Impact** | Any anonymous HTTP request to `/admin/users` returns the full user list including hashed passwords and emails. `/admin/reset-payments` can wipe payment records. Combined with AP-02, an attacker can reconstruct plaintext passwords from MD5 hashes and take over any account. |
| **Fix** | Add `requireAdmin` middleware before every admin route: verify JWT signature, decode the payload, and assert `role === 'admin'`. Mount it as `router.use('/admin', requireAdmin)` so it applies to all sub-routes. |
| **Recommendation** | Write integration tests using `supertest` that assert every `/admin/*` route returns `401` for unauthenticated requests and `403` for non-admin tokens. |

---

### HIGH Findings

---

#### AP-10 — N+1 Queries with 4-Level Callback Hell

| Field | Detail |
|---|---|
| **ID** | AP-10 |
| **File** | `src/AppManager.js` |
| **Lines** | 68–100 |
| **Description** | The enrollment listing handler fetches all enrollments in one query, then — inside a `for` loop — fires a separate database query for the course details, then another for the instructor, then another for the user, nesting four levels of callbacks (callback hell). |
| **Impact** | Listing 50 enrollments executes 150+ sequential database queries. Each inner callback waits for the previous to complete, so latency is additive. The deeply nested structure makes error handling inconsistent and the code nearly unmaintainable. |
| **Fix** | Use a single SQL `JOIN` or Sequelize `include` to load all related data in one query. Rewrite callbacks as `async/await` with `Promise.all` where parallel fetches are possible. |
| **Recommendation** | Enable the `no-await-in-loop` ESLint rule and add a query-count assertion in integration tests to catch N+1 regressions automatically. |

---

#### AP-08 — Payment Logic Inside Route Handler

| Field | Detail |
|---|---|
| **ID** | AP-08 |
| **File** | `src/AppManager.js` |
| **Lines** | 20–65 |
| **Description** | The Express route handler for `POST /enroll` contains the full payment processing flow: gateway API call, charge validation, receipt generation, enrollment record creation, and email notification — all inline, with no abstraction layer. |
| **Impact** | Payment logic cannot be unit tested without a live gateway. Any change to enrollment logic requires modifying payment code and vice versa. A failure in email notification rolls back the charge acknowledgement, potentially double-charging users. |
| **Fix** | Extract payment processing into a `PaymentService` class with a clear interface: `PaymentService.charge(userId, amount, metadata)`. The route handler should call the service and handle only HTTP concerns (status codes, response shaping). |
| **Recommendation** | Use a transactional outbox pattern: persist a `payment_intents` record first, then process asynchronously, so gateway failures do not affect the user-facing response. |

---

#### AP-07 — Global Mutable Cache

| Field | Detail |
|---|---|
| **ID** | AP-07 |
| **File** | `src/utils.js` |
| **Lines** | 9–10 |
| **Description** | `const cache = {}` is declared at module scope and mutated by every request handler. There is no TTL, no max-size, no eviction policy, and no synchronisation. |
| **Impact** | The cache grows unboundedly until the process runs out of memory and crashes. Stale data is served indefinitely. Under concurrent requests, simultaneous reads and writes to the same key produce race conditions (though JavaScript's event loop reduces — but does not eliminate — the risk in async contexts). |
| **Fix** | Replace with a proper cache library (`node-cache` with TTL, or Redis for multi-instance deployments). Define cache keys and TTLs as named constants. |
| **Recommendation** | Add a cache-size metric and alert when it exceeds a configurable threshold. Document the caching strategy (what is cached, for how long, and under what invalidation conditions) in a comment block. |

---

#### AP-12 — DELETE Without Cascade

| Field | Detail |
|---|---|
| **ID** | AP-12 |
| **File** | `src/AppManager.js` |
| **Lines** | 101–105 |
| **Description** | `DELETE FROM users WHERE id = ?` is executed without first deleting or reassigning the user's enrollments, payments, and progress records. The database has no `ON DELETE CASCADE` constraint defined. |
| **Impact** | Deleting a user leaves orphaned rows in `enrollments`, `payments`, and `progress` tables. Orphaned enrollment rows reference a non-existent user, causing `JOIN` queries to silently drop rows and analytics reports to undercount. Orphaned payment rows may trigger refund-processing errors. |
| **Fix** | Either add `ON DELETE CASCADE` to the foreign key constraints in the schema migration, or perform a manual multi-table delete inside a transaction: delete child records first, then the parent user row. |
| **Recommendation** | Enable foreign key enforcement in SQLite (`PRAGMA foreign_keys = ON`) at connection time — SQLite disables FK checks by default, which is why this bug has gone undetected. |

---

### MEDIUM Findings

---

#### AP-14 — Magic String for Payment Approval

| Field | Detail |
|---|---|
| **ID** | AP-14 |
| **File** | `src/AppManager.js` |
| **Lines** | 42 |
| **Description** | Payment status is compared with the string literal `'approved'` inline: `if (paymentResult.status === 'approved')`. The same literal appears elsewhere as `'APPROVED'` (uppercase), creating a silent mismatch that causes valid payments to be rejected. |
| **Impact** | Case mismatch means some payments are silently not processed even though the gateway returned success. Users are charged but not enrolled. |
| **Fix** | Define `const PAYMENT_STATUS_APPROVED = 'approved'` and normalise gateway responses with `.toLowerCase()` before comparison. |
| **Recommendation** | Use a TypeScript enum or a frozen object (`Object.freeze({ APPROVED: 'approved' })`) to prevent typo-driven bugs across all payment status comparisons. |

---

#### AP-12 (error handling) — No Centralised Error Handling

| Field | Detail |
|---|---|
| **ID** | AP-12 |
| **File** | `src/AppManager.js` |
| **Lines** | Various |
| **Description** | Each route handler has its own `try/catch` block with different error response shapes: some return `{ error: message }`, some return `{ message }`, some call `next(err)`, and some swallow the error entirely. |
| **Impact** | Clients cannot reliably parse error responses. Swallowed errors are invisible in logs, making debugging production issues extremely difficult. Inconsistent shapes break frontend error-handling logic. |
| **Fix** | Add a single Express error-handling middleware `(err, req, res, next) => { ... }` that formats all errors into a consistent shape and logs them. Have every route call `next(err)` on failure. |
| **Recommendation** | Define an `AppError` class with `statusCode` and `code` fields. Use it throughout the application so error type, HTTP status, and user-facing message are always co-located. |

---

### LOW Findings

---

#### AP-13 — console.log with Card Data

| Field | Detail |
|---|---|
| **ID** | AP-13 |
| **File** | `src/AppManager.js` (line 42) · `src/utils.js` (line 13) |
| **Lines** | 42 (AppManager.js), 13 (utils.js) |
| **Description** | `console.log(paymentResult)` logs the full payment gateway response object, which includes masked card numbers, billing addresses, and transaction tokens. `utils.js` logs the raw request body before sanitisation. |
| **Impact** | PCI-DSS prohibits storing or logging cardholder data in application logs. Violation can result in fines, loss of payment processing privileges, and mandatory forensic audits after a breach. |
| **Fix** | Remove all `console.log` from payment-related code paths. Replace with structured logging (`winston`, `pino`) that can be configured to redact sensitive fields via a `redact` option. |
| **Recommendation** | Add a static analysis rule (custom ESLint rule or `eslint-plugin-no-console`) that flags `console.log` in `src/` and fails CI. |

---

#### AP-14 (naming) — Cryptic Parameter Names

| Field | Detail |
|---|---|
| **ID** | AP-14 |
| **File** | `src/AppManager.js` |
| **Lines** | 13–17 |
| **Description** | Function parameters are named `d`, `u`, `cb`, `r`, and `x` throughout the routing and handler setup code. There are no JSDoc comments explaining expected shapes. |
| **Impact** | New contributors cannot understand the code without running it and inspecting values at runtime. Refactoring is error-prone because parameter purpose is ambiguous. IDE autocompletion provides no type information. |
| **Fix** | Rename to meaningful identifiers: `data`, `user`, `callback`, `result`, `courseId`. Add JSDoc `@param` tags or migrate to TypeScript for structural type safety. |
| **Recommendation** | Enforce a naming convention via ESLint `id-length` rule (minimum 2 characters) and require JSDoc on all exported functions as part of the PR checklist. |

---

## Phase 2 — Confirmation

```
The analysis above identified 12 findings across ecommerce-api-legacy.

Proceed with generating the refactored files? [y/n]: y
```

Confirmed. Proceeding to Phase 2 — code generation.
