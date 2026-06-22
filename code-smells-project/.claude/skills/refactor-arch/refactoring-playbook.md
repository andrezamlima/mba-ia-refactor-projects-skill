# Refactoring Playbook

Transformation patterns referenced by `antipatterns-catalog.md` and `audit-report-template.md`. Each entry provides ready-to-apply Before/After code in **Python** and **JavaScript**.

---

## PT-01: SQL Injection → Parameterized Queries

**Fixes:** AP-01

### Python — Before
```python
# VULNERABLE: string concatenation
def get_user(username):
    query = "SELECT * FROM users WHERE username = '" + username + "'"
    cursor.execute(query)
    return cursor.fetchone()
```

### Python — After
```python
# SAFE: parameterized query with ? placeholder
def get_user(username):
    query = "SELECT * FROM users WHERE username = ?"
    cursor.execute(query, (username,))   # tuple even for a single value
    return cursor.fetchone()
```

### JavaScript — Before
```javascript
// VULNERABLE
function getUser(username) {
  const query = `SELECT * FROM users WHERE username = '${username}'`;
  return db.prepare(query).get();
}
```

### JavaScript — After
```javascript
// SAFE: better-sqlite3 named placeholder
function getUser(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}
```

> Apply to every `execute()` / `prepare().run()` / `prepare().get()` / `prepare().all()` call that incorporates a variable.

---

## PT-02: Hardcoded Secrets → Environment Variables

**Fixes:** AP-02

### Python — Before
```python
# VULNERABLE
SECRET_KEY = "super-secret-key-1234"
DB_PASSWORD = "admin123"
JWT_SECRET  = "jwt-secret-token"
```

### Python — After
```python
# SAFE: load from environment with python-dotenv
import os
from dotenv import load_dotenv

load_dotenv()   # reads .env file when present

SECRET_KEY  = os.environ['SECRET_KEY']    # raises KeyError if missing — fail fast
DB_PASSWORD = os.environ['DB_PASSWORD']
JWT_SECRET  = os.environ['JWT_SECRET']
```

`.env` (never commit — add to `.gitignore`):
```
SECRET_KEY=<generated-random-64-chars>
DB_PASSWORD=<strong-password>
JWT_SECRET=<generated-random-64-chars>
```

### JavaScript — Before
```javascript
// VULNERABLE
const SECRET_KEY = "super-secret-key-1234";
const DB_PASSWORD = "admin123";
```

### JavaScript — After
```javascript
// SAFE: dotenv npm package
require('dotenv').config();

const SECRET_KEY  = process.env.SECRET_KEY;
const DB_PASSWORD = process.env.DB_PASSWORD;

if (!SECRET_KEY || !DB_PASSWORD) {
  throw new Error('Missing required environment variables');
}
```

---

## PT-03: God File → Separate by Domain Entity

**Fixes:** AP-03

### Python — Before
```python
# VULNERABLE: app.py — 400+ lines mixing everything
import sqlite3, smtplib, jwt
from flask import Flask, request, jsonify

app = Flask(__name__)
db_connection = sqlite3.connect('app.db')

@app.route('/users', methods=['GET'])
def list_users():
    rows = db_connection.execute("SELECT * FROM users").fetchall()
    return jsonify([dict(r) for r in rows])

@app.route('/users', methods=['POST'])
def create_user():
    # ... 30 more lines of logic, email sending, etc.
    pass
# ... 300 more lines
```

### Python — After
```python
# models/user.py
from .db import get_db

def find_all():
    return [dict(r) for r in get_db().execute("SELECT id, username, email FROM users").fetchall()]

def create(username, email, password_hash):
    db = get_db()
    cur = db.execute(
        "INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
        (username, email, password_hash)
    )
    db.commit()
    return cur.lastrowid
```

```python
# controllers/user_controller.py
from flask import request, jsonify
from models.user import find_all, create
from middleware.auth import require_admin
from werkzeug.security import generate_password_hash

def list_users():
    return jsonify(find_all()), 200

def create_user():
    data = request.get_json()
    hashed = generate_password_hash(data['password'])
    user_id = create(data['username'], data['email'], hashed)
    return jsonify({'id': user_id}), 201
```

### JavaScript — Before
```javascript
// VULNERABLE: server.js — 400+ lines
const express = require('express');
const Database = require('better-sqlite3');
const app = express();
const db = new Database('app.db');

app.get('/users', (req, res) => {
  const users = db.prepare('SELECT * FROM users').all();
  res.json(users);
});
// ... 350 more lines
```

### JavaScript — After
```javascript
// models/userModel.js
const db = require('../db');

function findAll() {
  return db.prepare('SELECT id, username, email FROM users').all();
}
function create(username, email, passwordHash) {
  const stmt = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)');
  const result = stmt.run(username, email, passwordHash);
  return result.lastInsertRowid;
}
module.exports = { findAll, create };
```

```javascript
// controllers/userController.js
const UserModel = require('../models/userModel');
const bcrypt = require('bcrypt');

async function listUsers(req, res) {
  res.json(UserModel.findAll());
}
async function createUser(req, res) {
  const { username, email, password } = req.body;
  const hash = await bcrypt.hash(password, 12);
  const id = UserModel.create(username, email, hash);
  res.status(201).json({ id });
}
module.exports = { listUsers, createUser };
```

---

## PT-04: Plain-Text Passwords → bcrypt / werkzeug Hashing

**Fixes:** AP-05

### Python — Before
```python
# VULNERABLE
def register(username, password):
    db.execute(
        "INSERT INTO users (username, password) VALUES (?, ?)",
        (username, password)   # plain text
    )
```

```python
# VULNERABLE login check
def login(username, password):
    user = db.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    if user['password'] == password:   # plain text comparison
        return generate_token(user)
```

### Python — After
```python
from werkzeug.security import generate_password_hash, check_password_hash

def register(username, password):
    hashed = generate_password_hash(password, method='pbkdf2:sha256', salt_length=16)
    db.execute(
        "INSERT INTO users (username, password) VALUES (?, ?)",
        (username, hashed)
    )

def login(username, password):
    user = db.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    if user and check_password_hash(user['password'], password):
        return generate_token(user)
    return None
```

### JavaScript — Before
```javascript
// VULNERABLE
function register(username, password) {
  db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, password);
}
function login(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (user && user.password === password) return generateToken(user);
}
```

### JavaScript — After
```javascript
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 12;

async function register(username, password) {
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hash);
}

async function login(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (user && await bcrypt.compare(password, user.password)) {
    return generateToken(user);
  }
  return null;
}
```

---

## PT-05: Global DB → Per-Request Connection

**Fixes:** AP-07

### Python — Before
```python
# VULNERABLE: module-level global
import sqlite3
db_connection = sqlite3.connect('app.db')
db_connection.row_factory = sqlite3.Row

@app.route('/users')
def list_users():
    return jsonify(db_connection.execute("SELECT * FROM users").fetchall())
```

### Python — After
```python
# models/db.py — per-request connection via Flask g
import sqlite3
from flask import g, current_app

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(
            current_app.config['DATABASE'],
            detect_types=sqlite3.PARSE_DECLTYPES
        )
        g.db.row_factory = sqlite3.Row
    return g.db

def init_db(app):
    @app.teardown_appcontext
    def close_db(error):
        db = g.pop('db', None)
        if db is not None:
            db.close()
```

```python
# usage in any model
from models.db import get_db

def find_all_users():
    return get_db().execute("SELECT id, username, email FROM users").fetchall()
```

### JavaScript — Before
```javascript
// VULNERABLE: module-level singleton opened once
const Database = require('better-sqlite3');
const db = new Database('app.db');  // global mutable state
```

### JavaScript — After
```javascript
// db.js — better-sqlite3 is synchronous and safe to use as a module singleton
// but the connection is created once per process and not per-request
const Database = require('better-sqlite3');

let _db = null;

function getDb() {
  if (!_db) {
    _db = new Database(process.env.DATABASE_PATH || 'app.db');
    _db.pragma('journal_mode = WAL');   // safe for concurrent reads
  }
  return _db;
}

module.exports = { getDb };
```

```javascript
// models/userModel.js — inject via getDb()
const { getDb } = require('../db');

function findAll() {
  return getDb().prepare('SELECT id, username, email FROM users').all();
}
module.exports = { findAll };
```

---

## PT-06: N+1 Queries → JOIN SQL

**Fixes:** AP-10

### Python — Before
```python
# VULNERABLE: N+1
orders = db.execute("SELECT * FROM orders").fetchall()
result = []
for order in orders:
    items = db.execute(
        "SELECT * FROM items WHERE order_id=?", (order['id'],)
    ).fetchall()
    result.append({**dict(order), 'items': [dict(i) for i in items]})
```

### Python — After
```python
# SAFE: single JOIN query, group in Python
rows = db.execute("""
    SELECT o.id AS order_id, o.user_id, o.status,
           i.id AS item_id, i.product_id, i.quantity, i.price
    FROM orders o
    LEFT JOIN items i ON i.order_id = o.id
    ORDER BY o.id
""").fetchall()

orders_map = {}
for row in rows:
    oid = row['order_id']
    if oid not in orders_map:
        orders_map[oid] = {
            'id': oid, 'user_id': row['user_id'],
            'status': row['status'], 'items': []
        }
    if row['item_id']:
        orders_map[oid]['items'].append({
            'id': row['item_id'], 'product_id': row['product_id'],
            'quantity': row['quantity'], 'price': row['price']
        })
result = list(orders_map.values())
```

### JavaScript — Before
```javascript
// VULNERABLE: N+1
const orders = db.prepare('SELECT * FROM orders').all();
for (const order of orders) {
  order.items = db.prepare('SELECT * FROM items WHERE order_id=?').all(order.id);
}
```

### JavaScript — After
```javascript
// SAFE: single JOIN, group in JS
const rows = db.prepare(`
  SELECT o.id AS order_id, o.user_id, o.status,
         i.id AS item_id, i.product_id, i.quantity, i.price
  FROM orders o
  LEFT JOIN items i ON i.order_id = o.id
  ORDER BY o.id
`).all();

const ordersMap = new Map();
for (const row of rows) {
  if (!ordersMap.has(row.order_id)) {
    ordersMap.set(row.order_id, {
      id: row.order_id, userId: row.user_id,
      status: row.status, items: []
    });
  }
  if (row.item_id) {
    ordersMap.get(row.order_id).items.push({
      id: row.item_id, productId: row.product_id,
      quantity: row.quantity, price: row.price
    });
  }
}
const result = Array.from(ordersMap.values());
```

---

## PT-07: Duplicated Code → Extract Shared Helper Function

**Fixes:** AP-11, AP-12

### Python — Before
```python
# VULNERABLE: near-identical validation in create and update
def validate_create_user(data):
    errors = []
    if not data.get('email'):    errors.append('email required')
    if not data.get('username'): errors.append('username required')
    if data.get('username') and len(data['username']) < 3:
        errors.append('username must be at least 3 characters')
    return errors

def validate_update_user(data):
    errors = []
    if not data.get('email'):    errors.append('email required')
    if not data.get('username'): errors.append('username required')
    if data.get('username') and len(data['username']) < 3:
        errors.append('username must be at least 3 characters')
    if not data.get('id'):       errors.append('id required')  # only difference
    return errors
```

### Python — After
```python
# SAFE: single parameterized helper
def validate_user_fields(data, *, require_id=False):
    errors = []
    if not data.get('email'):    errors.append('email required')
    if not data.get('username'): errors.append('username required')
    if data.get('username') and len(data['username']) < 3:
        errors.append('username must be at least 3 characters')
    if require_id and not data.get('id'):
        errors.append('id required')
    return errors

# Usage:
errors = validate_user_fields(data)               # create
errors = validate_user_fields(data, require_id=True)  # update
```

### JavaScript — Before
```javascript
// VULNERABLE
function validateCreateUser(data) {
  const errors = [];
  if (!data.email)    errors.push('email required');
  if (!data.username) errors.push('username required');
  if (data.username && data.username.length < 3) errors.push('username too short');
  return errors;
}
function validateUpdateUser(data) {
  const errors = [];
  if (!data.email)    errors.push('email required');
  if (!data.username) errors.push('username required');
  if (data.username && data.username.length < 3) errors.push('username too short');
  if (!data.id)       errors.push('id required');
  return errors;
}
```

### JavaScript — After
```javascript
// SAFE
function validateUserFields(data, { requireId = false } = {}) {
  const errors = [];
  if (!data.email)    errors.push('email required');
  if (!data.username) errors.push('username required');
  if (data.username && data.username.length < 3) errors.push('username too short');
  if (requireId && !data.id) errors.push('id required');
  return errors;
}

// Usage:
validateUserFields(data);                  // create
validateUserFields(data, { requireId: true }); // update
```

---

## PT-08: Controller Side-Effects → Notification Service Module

**Fixes:** AP-08

### Python — Before
```python
# VULNERABLE: email logic inside route handler
import smtplib
from email.mime.text import MIMEText

@app.route('/orders', methods=['POST'])
def create_order():
    data = request.get_json()
    order_id = order_model.create(data)

    # side-effect in controller
    msg = MIMEText(f"Your order #{order_id} is confirmed.")
    msg['Subject'] = 'Order Confirmation'
    msg['From'] = 'no-reply@shop.com'
    msg['To'] = data['email']
    with smtplib.SMTP('smtp.gmail.com', 587) as smtp:
        smtp.starttls()
        smtp.login('user', 'pass')
        smtp.send_message(msg)

    return jsonify({'order_id': order_id}), 201
```

### Python — After
```python
# services/notification_service.py
import smtplib
from email.mime.text import MIMEText
import os

class NotificationService:
    def __init__(self):
        self.smtp_host   = os.environ['SMTP_HOST']
        self.smtp_port   = int(os.environ.get('SMTP_PORT', 587))
        self.smtp_user   = os.environ['SMTP_USER']
        self.smtp_pass   = os.environ['SMTP_PASS']
        self.from_addr   = os.environ.get('EMAIL_FROM', 'no-reply@shop.com')

    def send_order_confirmation(self, order_id: int, recipient_email: str) -> None:
        msg = MIMEText(f"Your order #{order_id} is confirmed.")
        msg['Subject'] = 'Order Confirmation'
        msg['From']    = self.from_addr
        msg['To']      = recipient_email
        with smtplib.SMTP(self.smtp_host, self.smtp_port) as smtp:
            smtp.starttls()
            smtp.login(self.smtp_user, self.smtp_pass)
            smtp.send_message(msg)

notification_service = NotificationService()
```

```python
# controllers/order_controller.py
from models import order_model
from services.notification_service import notification_service
from flask import request, jsonify

def create_order():
    data = request.get_json()
    order_id = order_model.create(data)
    notification_service.send_order_confirmation(order_id, data['email'])
    return jsonify({'order_id': order_id}), 201
```

### JavaScript — Before
```javascript
// VULNERABLE
const nodemailer = require('nodemailer');
app.post('/orders', async (req, res) => {
  const orderId = await OrderModel.create(req.body);
  const transporter = nodemailer.createTransport({ /* inline config */ });
  await transporter.sendMail({
    to: req.body.email,
    subject: 'Order Confirmation',
    text: `Your order #${orderId} is confirmed.`
  });
  res.status(201).json({ orderId });
});
```

### JavaScript — After
```javascript
// services/notificationService.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

async function sendOrderConfirmation(orderId, recipientEmail) {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'no-reply@shop.com',
    to: recipientEmail,
    subject: 'Order Confirmation',
    text: `Your order #${orderId} is confirmed.`
  });
}

module.exports = { sendOrderConfirmation };
```

```javascript
// controllers/orderController.js
const OrderModel = require('../models/orderModel');
const { sendOrderConfirmation } = require('../services/notificationService');

async function createOrder(req, res) {
  const orderId = await OrderModel.create(req.body);
  await sendOrderConfirmation(orderId, req.body.email);
  res.status(201).json({ orderId });
}
module.exports = { createOrder };
```

---

## PT-09: Admin Endpoints → Auth Middleware

**Fixes:** AP-04, AP-09

### Python — Before
```python
# VULNERABLE: no auth on admin route
@app.route('/admin/users')
def admin_list_users():
    users = db.execute("SELECT * FROM users").fetchall()
    return jsonify([dict(u) for u in users])
```

### Python — After
```python
# middleware/auth.py
import jwt
import os
from functools import wraps
from flask import request, jsonify, g

SECRET_KEY = os.environ['SECRET_KEY']

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Missing token'}), 401
        token = auth_header.split(' ', 1)[1]
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
            g.current_user = payload
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Token expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Invalid token'}), 401
        return f(*args, **kwargs)
    return decorated

def require_admin(f):
    @wraps(f)
    @require_auth
    def decorated(*args, **kwargs):
        if g.current_user.get('role') != 'admin':
            return jsonify({'error': 'Admin access required'}), 403
        return f(*args, **kwargs)
    return decorated
```

```python
# controllers/admin_controller.py
from middleware.auth import require_admin
from flask import jsonify
from models.user import find_all

@require_admin
def admin_list_users():
    return jsonify(find_all()), 200
```

### JavaScript — Before
```javascript
// VULNERABLE
app.get('/admin/users', (req, res) => {
  const users = db.prepare('SELECT * FROM users').all();
  res.json(users);
});
```

### JavaScript — After
```javascript
// middleware/auth.js
const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, process.env.SECRET_KEY);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  authenticateToken(req, res, () => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}

module.exports = { authenticateToken, requireAdmin };
```

```javascript
// routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const { listUsers } = require('../controllers/userController');

router.get('/users', requireAdmin, listUsers);

module.exports = router;
```

---

## PT-10: Print Logging → Structured Logger

**Fixes:** AP-13

### Python — Before
```python
# VULNERABLE
def create_user(data):
    print(f"Creating user: {data['username']}")
    # ...
    print("User created successfully")
    print(f"DB error: {e}")
```

### Python — After
```python
import logging

logger = logging.getLogger(__name__)   # one logger per module

# In app factory (app.py):
# logging.basicConfig(level=logging.INFO,
#     format='%(asctime)s %(name)s %(levelname)s %(message)s')

def create_user(data):
    logger.info("Creating user", extra={"username": data['username']})
    try:
        # ...
        logger.info("User created successfully", extra={"username": data['username']})
    except Exception as e:
        logger.error("Failed to create user", exc_info=True,
                     extra={"username": data['username']})
        raise
```

### JavaScript — Before
```javascript
// VULNERABLE
function createUser(data) {
  console.log('Creating user:', data.username);
  // ...
  console.log('User created successfully');
  console.log('DB error:', err);
}
```

### JavaScript — After
```javascript
// Use a simple structured logger (no external deps required)
// For production, replace with winston or pino.

const logger = {
  info:  (msg, meta = {}) => console.log(JSON.stringify({ level: 'info',  msg, ...meta, ts: new Date().toISOString() })),
  warn:  (msg, meta = {}) => console.warn(JSON.stringify({ level: 'warn',  msg, ...meta, ts: new Date().toISOString() })),
  error: (msg, meta = {}) => console.error(JSON.stringify({ level: 'error', msg, ...meta, ts: new Date().toISOString() })),
};

function createUser(data) {
  logger.info('Creating user', { username: data.username });
  try {
    // ...
    logger.info('User created successfully', { username: data.username });
  } catch (err) {
    logger.error('Failed to create user', { username: data.username, error: err.message });
    throw err;
  }
}
```

---

## PT-11: Sensitive Data Exposure → Sanitize Responses

**Fixes:** AP-06

### Python — Before
```python
# VULNERABLE: raw row dict includes password, secret_key
@app.route('/users/<int:user_id>')
def get_user(user_id):
    user = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    return jsonify(dict(user))   # leaks 'password', 'secret_key', etc.
```

### Python — After
```python
# Option A: explicit denylist (remove sensitive fields)
SENSITIVE_FIELDS = {'password', 'secret_key', 'token', 'ssn', 'card_number'}

def sanitize(row: dict) -> dict:
    return {k: v for k, v in row.items() if k not in SENSITIVE_FIELDS}

@app.route('/users/<int:user_id>')
def get_user(user_id):
    user = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if not user:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(sanitize(dict(user))), 200

# Option B (preferred): SELECT only safe columns
@app.route('/users/<int:user_id>')
def get_user(user_id):
    user = db.execute(
        "SELECT id, username, email, role FROM users WHERE id=?", (user_id,)
    ).fetchone()
    if not user:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(dict(user)), 200
```

### JavaScript — Before
```javascript
// VULNERABLE
app.get('/users/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  res.json(user);  // leaks password hash and secret columns
});
```

### JavaScript — After
```javascript
// Option A: explicit denylist
const SENSITIVE_FIELDS = new Set(['password', 'secret_key', 'token', 'ssn']);

function sanitize(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => !SENSITIVE_FIELDS.has(k))
  );
}

app.get('/users/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(sanitize(user));
});

// Option B (preferred): SELECT only safe columns
app.get('/users/:id', (req, res) => {
  const user = db.prepare(
    'SELECT id, username, email, role FROM users WHERE id=?'
  ).get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(user);
});
```

---

## PT-12: Magic Numbers / Strings → Named Constants

**Fixes:** AP-14

### Python — Before
```python
# VULNERABLE: inline magic values
def apply_discount(price, card_prefix):
    if card_prefix in ['4111', '4242', '5555']:
        return price * 0.85   # 15% discount for approved cards
    if price > 1000:
        return price * 0.90   # 10% discount for large orders
    return price

def validate_password(password):
    if len(password) < 8:
        raise ValueError("too short")
```

### Python — After
```python
# constants.py
MIN_PASSWORD_LENGTH = 8
MIN_PASSWORD_LENGTH_ADMIN = 12

STANDARD_DISCOUNT_RATE    = 0.15   # 15% off for approved cards
LARGE_ORDER_DISCOUNT_RATE = 0.10   # 10% off orders above threshold
LARGE_ORDER_THRESHOLD     = 1000

APPROVED_CARD_PREFIXES = frozenset(['4111', '4242', '5555'])

DISCOUNT_TIERS = {
    'standard': STANDARD_DISCOUNT_RATE,
    'large':    LARGE_ORDER_DISCOUNT_RATE,
}

ROLE_ADMIN = 'admin'
ROLE_USER  = 'user'

STATUS_PENDING   = 'pending'
STATUS_APPROVED  = 'approved'
STATUS_REJECTED  = 'rejected'
```

```python
# usage
from constants import (
    MIN_PASSWORD_LENGTH,
    APPROVED_CARD_PREFIXES,
    STANDARD_DISCOUNT_RATE,
    LARGE_ORDER_DISCOUNT_RATE,
    LARGE_ORDER_THRESHOLD,
)

def apply_discount(price, card_prefix):
    if card_prefix in APPROVED_CARD_PREFIXES:
        return price * (1 - STANDARD_DISCOUNT_RATE)
    if price > LARGE_ORDER_THRESHOLD:
        return price * (1 - LARGE_ORDER_DISCOUNT_RATE)
    return price

def validate_password(password):
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
```

### JavaScript — Before
```javascript
// VULNERABLE
function applyDiscount(price, cardPrefix) {
  if (['4111', '4242', '5555'].includes(cardPrefix)) return price * 0.85;
  if (price > 1000) return price * 0.90;
  return price;
}
function validatePassword(password) {
  if (password.length < 8) throw new Error('too short');
}
```

### JavaScript — After
```javascript
// constants.js
const MIN_PASSWORD_LENGTH    = 8;
const MIN_PASSWORD_LENGTH_ADMIN = 12;

const STANDARD_DISCOUNT_RATE    = 0.15;
const LARGE_ORDER_DISCOUNT_RATE = 0.10;
const LARGE_ORDER_THRESHOLD     = 1000;

const APPROVED_CARD_PREFIXES = Object.freeze(['4111', '4242', '5555']);

const DISCOUNT_TIERS = Object.freeze({
  standard: STANDARD_DISCOUNT_RATE,
  large:    LARGE_ORDER_DISCOUNT_RATE,
});

const ROLES  = Object.freeze({ ADMIN: 'admin', USER: 'user' });
const STATUS = Object.freeze({ PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' });

module.exports = {
  MIN_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH_ADMIN,
  STANDARD_DISCOUNT_RATE, LARGE_ORDER_DISCOUNT_RATE, LARGE_ORDER_THRESHOLD,
  APPROVED_CARD_PREFIXES, DISCOUNT_TIERS, ROLES, STATUS,
};
```

```javascript
// usage
const { APPROVED_CARD_PREFIXES, STANDARD_DISCOUNT_RATE,
        LARGE_ORDER_DISCOUNT_RATE, LARGE_ORDER_THRESHOLD,
        MIN_PASSWORD_LENGTH } = require('./constants');

function applyDiscount(price, cardPrefix) {
  if (APPROVED_CARD_PREFIXES.includes(cardPrefix))
    return price * (1 - STANDARD_DISCOUNT_RATE);
  if (price > LARGE_ORDER_THRESHOLD)
    return price * (1 - LARGE_ORDER_DISCOUNT_RATE);
  return price;
}

function validatePassword(password) {
  if (password.length < MIN_PASSWORD_LENGTH)
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
}
```
