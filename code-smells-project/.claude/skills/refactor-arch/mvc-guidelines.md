# MVC Architecture Guidelines

Reference for the `/refactor-arch` skill — Phase 3 (Refactor).

---

## Layer Responsibility Table

| Layer | Responsibility | What it MUST NOT do |
|---|---|---|
| **Model** | Represent a domain entity; own all DB read/write for that entity; define relationships | Contain HTTP logic (`request`, `response`); send emails/SMS; define routes |
| **Controller** | Receive validated input from route; call model/service; return formatted response | Open raw DB connections; send emails/notifications directly; contain complex business rules |
| **View / Routes** | Map HTTP verbs + URL paths to controllers; apply middleware in the right order | Contain business logic; access the DB directly; perform data transformation |
| **Config** | Load environment variables; expose typed configuration values | Contain business logic; import application modules (circular import risk) |
| **Service** | Implement cross-cutting business operations (email, payment, notifications, etc.) | Access the HTTP request/response context directly; define DB schema |
| **Middleware** | Inspect/modify request before it reaches the controller (auth, rate-limit, logging) | Contain business logic; write to the database except for audit/session purposes |

---

## Python / Flask — Target Directory Structure

```
project/
├── app.py                  # Composition root — factory, blueprint registration
├── config.py               # Environment-based configuration class
├── .env                    # Secrets (git-ignored)
├── requirements.txt
│
├── models/
│   ├── __init__.py
│   ├── user.py             # User DB access (CRUD)
│   ├── product.py          # Product DB access
│   └── order.py            # Order DB access
│
├── controllers/
│   ├── __init__.py
│   ├── user_controller.py
│   ├── product_controller.py
│   └── order_controller.py
│
├── routes/
│   ├── __init__.py
│   └── api_routes.py       # Blueprint wiring all resource routers
│
├── services/
│   ├── __init__.py
│   └── notification_service.py
│
├── middleware/
│   ├── __init__.py
│   └── auth.py             # @require_auth, @require_admin decorators
│
└── constants.py            # Named constants (no logic)
```

### `app.py` — Composition Root

```python
from flask import Flask
from config import Config
from routes.api_routes import api_blueprint
from models import init_db          # sets up get_db / teardown

def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    init_db(app)                     # register get_db + teardown_appcontext
    app.register_blueprint(api_blueprint, url_prefix='/api')

    return app

if __name__ == '__main__':
    app = create_app()
    app.run(debug=app.config['DEBUG'])
```

### `routes/api_routes.py` — Blueprint

```python
from flask import Blueprint
from controllers.user_controller import (
    list_users, get_user, create_user, update_user, delete_user
)
from controllers.product_controller import (
    list_products, get_product, create_product, update_product, delete_product
)
from controllers.order_controller import list_orders, create_order
from middleware.auth import require_auth, require_admin

api_blueprint = Blueprint('api', __name__)

# --- Users ---
api_blueprint.add_url_rule('/users',          view_func=list_users,   methods=['GET'])
api_blueprint.add_url_rule('/users',          view_func=create_user,  methods=['POST'])
api_blueprint.add_url_rule('/users/<int:id>', view_func=get_user,     methods=['GET'],    endpoint='get_user')
api_blueprint.add_url_rule('/users/<int:id>', view_func=update_user,  methods=['PUT'],    endpoint='update_user')
api_blueprint.add_url_rule('/users/<int:id>', view_func=delete_user,  methods=['DELETE'], endpoint='delete_user')

# --- Products ---
api_blueprint.add_url_rule('/products',          view_func=list_products,   methods=['GET'])
api_blueprint.add_url_rule('/products',          view_func=create_product,  methods=['POST'])
api_blueprint.add_url_rule('/products/<int:id>', view_func=get_product,     methods=['GET'],    endpoint='get_product')
api_blueprint.add_url_rule('/products/<int:id>', view_func=update_product,  methods=['PUT'],    endpoint='update_product')
api_blueprint.add_url_rule('/products/<int:id>', view_func=delete_product,  methods=['DELETE'], endpoint='delete_product')

# --- Orders (authenticated) ---
api_blueprint.add_url_rule('/orders', view_func=require_auth(list_orders),  methods=['GET'])
api_blueprint.add_url_rule('/orders', view_func=require_auth(create_order), methods=['POST'], endpoint='create_order')

# --- Admin (admin-only) ---
api_blueprint.add_url_rule('/admin/users', view_func=require_admin(list_users), methods=['GET'], endpoint='admin_list_users')
```

---

## Node.js / Express — Target Directory Structure

```
project/
├── app.js                  # Composition root — express factory, router mounting
├── config.js               # dotenv-based configuration
├── .env                    # Secrets (git-ignored)
├── package.json
│
├── models/
│   ├── userModel.js
│   ├── productModel.js
│   └── orderModel.js
│
├── controllers/
│   ├── userController.js
│   ├── productController.js
│   └── orderController.js
│
├── routes/
│   ├── userRoutes.js
│   ├── productRoutes.js
│   └── orderRoutes.js
│
├── services/
│   └── notificationService.js
│
├── middleware/
│   └── auth.js             # authenticateToken, requireAdmin
│
└── constants.js            # Named constants (no logic)
```

### `app.js` — Composition Root

```javascript
require('dotenv').config();
const express = require('express');
const userRoutes    = require('./routes/userRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes   = require('./routes/orderRoutes');

function createApp() {
  const app = express();
  app.use(express.json());

  app.use('/api/users',    userRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/orders',   orderRoutes);

  // Global error handler
  app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = { createApp };
```

---

## PHP / Laravel — Target Directory Structure

Laravel already enforces MVC. The goal of Phase 3 is to fix violations **within** this structure, not to rebuild it from scratch.

```
project/
├── app/
│   ├── Http/
│   │   ├── Controllers/
│   │   │   ├── Api/
│   │   │   │   ├── UserController.php       # Thin: validate → service → Resource
│   │   │   │   ├── ProductController.php
│   │   │   │   └── OrderController.php
│   │   ├── Middleware/
│   │   │   ├── Authenticate.php             # Built-in auth guard
│   │   │   └── EnsureUserIsAdmin.php        # Custom role guard
│   │   └── Requests/
│   │       ├── StoreUserRequest.php         # FormRequest with validation rules
│   │       ├── UpdateUserRequest.php
│   │       └── StoreOrderRequest.php
│   │
│   ├── Models/
│   │   ├── User.php                         # Eloquent model — $fillable, $hidden, relationships
│   │   ├── Product.php
│   │   └── Order.php
│   │
│   ├── Services/
│   │   ├── OrderService.php                 # Business logic extracted from controller
│   │   ├── PaymentService.php
│   │   └── NotificationService.php
│   │
│   └── Http/Resources/
│       ├── UserResource.php                 # API response whitelist (no password)
│       ├── ProductResource.php
│       └── OrderResource.php
│
├── routes/
│   ├── api.php                              # API routes with middleware groups
│   └── web.php                             # Web routes (if applicable)
│
├── database/
│   ├── migrations/                          # Schema versioned via migrations
│   └── seeders/                             # Test data
│
├── config/
│   ├── app.php                              # References env() — no hardcoded values
│   └── services.php                         # External services config via env()
│
├── .env                                     # Secrets — always in .gitignore
├── .env.example                             # Template — safe to commit
└── composer.json
```

### Key Laravel MVC Rules

**Controller (thin):**
```php
// CORRECT — controller delegates to service, returns Resource
class OrderController extends Controller
{
    public function __construct(private OrderService $orderService) {
        $this->middleware('auth:sanctum');
    }

    public function store(StoreOrderRequest $request): JsonResponse {
        $order = $this->orderService->createOrder(
            $request->user(),
            $request->validated()
        );
        return new OrderResource($order);
    }
}
```

**FormRequest (validation layer):**
```php
// app/Http/Requests/StoreOrderRequest.php
class StoreOrderRequest extends FormRequest
{
    public function rules(): array {
        return [
            'product_id' => ['required', 'integer', 'exists:products,id'],
            'quantity'   => ['required', 'integer', 'min:1'],
        ];
    }
}
```

**Eloquent Model (data layer):**
```php
// app/Models/User.php
class User extends Model
{
    protected $fillable = ['name', 'email', 'password'];
    protected $hidden   = ['password', 'remember_token'];  // NEVER expose these

    public function orders(): HasMany {
        return $this->hasMany(Order::class);
    }
}
```

**API Resource (response whitelist):**
```php
// app/Http/Resources/UserResource.php
class UserResource extends JsonResource
{
    public function toArray($request): array {
        return [
            'id'         => $this->id,
            'name'       => $this->name,
            'email'      => $this->email,
            'created_at' => $this->created_at,
            // 'password' deliberately omitted
        ];
    }
}
```

**Routes (wiring only):**
```php
// routes/api.php
Route::middleware('auth:sanctum')->group(function () {
    Route::apiResource('orders', OrderController::class);
    Route::apiResource('products', ProductController::class);

    Route::middleware('role:admin')->prefix('admin')->group(function () {
        Route::get('/users', [AdminController::class, 'index']);
    });
});
```

---

## Layer Responsibilities — Quick Reference

### Model Rules
- One model file per domain entity (`user.py`, `product.py`, `order.py`).
- All SQL for that entity lives in its model file.
- Functions return plain dicts or domain objects — never Flask `Response` objects.
- No `request` / `g` imports (use dependency injection: pass `db` as a parameter, or call `get_db()` from the model if using Flask context).

### Controller Rules
- Controllers are thin: validate input → call model/service → format response.
- No raw SQL. No `smtplib`, `boto3`, or other side-effecting imports.
- Return `jsonify(data), status_code` for JSON APIs.
- Handle exceptions from the model layer and map them to HTTP status codes.

### Route Rules
- Route files are wiring only: import controller functions, map HTTP verbs, attach middleware.
- Zero business logic. Zero SQL. Zero email/SMS.
- Middleware is applied at the route-registration step, not inside the controller.

### Config Rules
- All values come from `os.environ.get(...)` / `process.env.*`.
- Provide sensible defaults only for non-secret values (port, debug flag).
- Never import from models, controllers, or services (prevents circular imports).
- The `.env` file is always in `.gitignore`.

### Service Rules
- A service encapsulates one cross-cutting concern (notifications, payments, search).
- Services are injected into controllers or called by name — never imported inside models.
- Services must be mockable: accept dependencies via constructor or function parameter.
- No HTTP context (no `request`, `req`, `res` imports).

### Middleware Rules
- Authentication middleware: verify token → attach `user` to `g` / `req.user` → `next()` or abort.
- Authorization middleware: check `g.user.role` / `req.user.role` → `next()` or 403.
- Middleware must call `next()` (Express) or allow the request to continue (Flask) on success.
- Never raise HTTP errors inside a model or service — raise domain exceptions and let middleware or the controller map them.
