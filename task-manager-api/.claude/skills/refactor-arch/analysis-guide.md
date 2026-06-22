# Analysis Guide — /refactor-arch

This guide provides the heuristics for Phase 1: detecting language, framework, database, domain, and current architecture of any project.

---

## Step 1 — Detect Language

Read all files in the project directory. Determine language based on file extensions:

| Extension | Language |
|---|---|
| `.py` | Python |
| `.js`, `.mjs`, `.cjs` | JavaScript / Node.js |
| `.ts` | TypeScript |
| `.java` | Java |
| `.go` | Go |
| `.rb` | Ruby |
| `.php` | PHP |

If a project has both `.js` and `.ts`, report **TypeScript** (TS projects always transpile from `.ts`).

---

## Step 2 — Detect Framework

### Python
- Read `requirements.txt`, `pyproject.toml`, or `Pipfile`
- `flask` → **Flask**
- `django` → **Django**
- `fastapi` → **FastAPI**
- Verify version: `flask==3.1.1` → Flask 3.1.1
- Also check import statements: `from flask import Flask`, `import django`

### Node.js
- Read `package.json` → `dependencies` section
- `express` → **Express**
- `fastify` → **Fastify**
- `koa` → **Koa**
- `@nestjs/core` → **NestJS**
- Verify version from `package.json`

### PHP
- Read `composer.json` → `require` section
- `laravel/framework` → **Laravel** (check `"laravel/framework": "^10.x"` for version)
- `symfony/http-kernel` → **Symfony**
- `codeigniter4/framework` → **CodeIgniter 4**
- Also check: presence of `artisan` file at project root → confirms Laravel
- Check `config/app.php` → `'version'` key for Laravel version

---

## Step 3 — Detect Database

### Signals
- File extensions: `.db`, `.sqlite`, `.sqlite3` present in the directory → **SQLite** (file-based)
- Import/require: `import sqlite3`, `require('better-sqlite3')`, `require('sqlite3')` → **SQLite**
- `DATABASE_URL` in env: `postgres://...` → **PostgreSQL**, `mysql://...` → **MySQL**
- `pymongo`, `mongoose` → **MongoDB**
- `:memory:` in database connection → **SQLite in-memory**
- `psycopg2`, `asyncpg` → **PostgreSQL**
- PHP/Laravel: `DB_CONNECTION=mysql` in `.env` → **MySQL**; `DB_CONNECTION=pgsql` → **PostgreSQL**; `DB_CONNECTION=sqlite` → **SQLite**
- Laravel Eloquent models in `app/Models/` — class names map to table names (e.g., `User` → `users`, `Product` → `products`)

### Extract DB tables
Look for `CREATE TABLE` statements in any `.py`, `.js`, `.php`, or `.sql` file. For Laravel projects, list all Eloquent model class names found in `app/Models/` — each maps to a pluralized snake_case table.

---

## Step 4 — Detect Domain

Read function names, route paths, table names, and variable names to infer what the application does:

| Indicators | Domain |
|---|---|
| Routes: `/produtos`, `/pedidos`, `/usuarios`; Tables: `produtos`, `pedidos` | **E-commerce API** |
| Routes: `/tasks`, `/categories`; Tables: `tasks`, `tags` | **Task Manager API** |
| Routes: `/courses`, `/enrollments`, `/checkout`; Tables: `users`, `courses` | **LMS (Learning Management System)** |
| Routes: `/auth`, `/users`, `/roles` | **Auth / User Management API** |
| Routes: `/posts`, `/comments` | **Blog / CMS API** |

---

## Step 5 — Detect Current Architecture

Analyze the project's file structure and classify:

### Architecture Patterns

**Monolith — All in One File**
- Signal: Only 1-2 source files (`app.py`, `app.js`) containing all routes, DB queries, and business logic
- Example: Single `app.py` with `@app.route` AND `cursor.execute()` in the same file

**Flat Files — No Layer Separation**
- Signal: Multiple files but with no clear MVC structure (e.g., `app.py`, `controllers.py`, `models.py`, `database.py` — flat, no subdirectories)
- All concerns are at the same level, files are not organized by architectural layer or domain

**Partial MVC — Some Separation**
- Signal: Directories like `models/`, `routes/`, `services/`, `utils/` exist BUT:
  - Models still do business logic
  - Routes contain DB queries
  - No consistent pattern across all modules
- Example: `task-manager-api/` with `models/`, `routes/`, `services/` but still has code smells

**Full MVC — Well Structured**
- Signal: Clean `models/`, `views/` (or `routes/`), `controllers/` directories, config extracted, no direct DB calls in controllers

---

## Step 6 — Count Source Files

Count all source files analyzed (only code files, not config/data files):
- Python: count `.py` files (exclude `__pycache__`, `.pyc`, migrations)
- Node.js: count `.js` and `.ts` files (exclude `node_modules/`, `dist/`, `build/`)
- PHP/Laravel: count `.php` files (exclude `vendor/`, `bootstrap/cache/`, compiled views in `storage/`)

---

## Summary Format Reference

After completing Steps 1–6, print this block:

```
================================
PHASE 1: PROJECT ANALYSIS
================================
Language:      Python
Framework:     Flask 3.1.1
Database:      SQLite (file: loja.db)
Domain:        E-commerce API (produtos, pedidos, usuários)
Architecture:  Flat Files — 4 files, no MVC separation, all concerns mixed
Source files:  4 files analyzed
DB tables:     produtos, usuarios, pedidos, itens_pedido
================================
```

---

## Technology-Specific Notes

### Flask Projects
- Entry point is typically `app.py`
- Look for `app = Flask(__name__)` to confirm
- Routes defined with `@app.route(...)` or `app.add_url_rule(...)`
- Check for `flask_cors`, `flask_jwt_extended` in requirements
- DB init often in a `database.py` file

### Express Projects
- Entry point is typically `app.js`, `server.js`, or `index.js`
- Look for `const app = express()` or `const express = require('express')`
- Routes defined with `app.get(...)`, `app.post(...)`, or `router.get(...)`
- Check `package.json` for `start` script
- DB init often inline in the main file or a `database.js`/`db.js` file

### Django Projects
- Entry point is `manage.py`
- `settings.py` configures the app
- Models defined in `models.py` within each app directory
- URLs defined in `urls.py`

### NestJS Projects
- Entry point is `main.ts`
- Controllers decorated with `@Controller`
- Services decorated with `@Injectable`
- Modules decorated with `@Module`

### Laravel Projects
- Entry point: `public/index.php` (HTTP) + `artisan` (CLI)
- Routes: `routes/web.php` (HTML), `routes/api.php` (JSON API)
- Controllers: `app/Http/Controllers/`
- Models: `app/Models/` (Eloquent ORM)
- Views: `resources/views/` (Blade templates — `.blade.php`)
- Config: `config/` + `.env` (never `config/database.php` directly)
- Middleware: `app/Http/Middleware/`
- Services: `app/Services/` (if present)
- Migrations: `database/migrations/` — read these to list DB tables
- Validation: `app/Http/Requests/` (Form Requests) OR inline `$request->validate([...])`
- Architecture assessment signals:
  - Fat Controller (HIGH): controller method >50 lines with DB queries, business logic, and HTTP response all mixed
  - Missing Form Requests (MEDIUM): validation inline in controller instead of dedicated `FormRequest` class
  - Logic in Blade views (HIGH): `@php` blocks with business calculations in `.blade.php` files
  - Direct `DB::` in controllers (CRITICAL): raw SQL or `DB::select(...)` in controller instead of model/repository
  - Missing API Resources (MEDIUM): `$model->toArray()` or `$model` returned directly instead of `Resource` class
