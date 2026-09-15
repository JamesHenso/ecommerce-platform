# Sneaker E-Commerce Backend — Production-Ready Refactoring Design

**Date:** 2026-09-16
**Author:** AI-assisted design
**Status:** Approved
**Branch:** `feat/scale`

## 1. Overview

Refactor the existing basic CRUD backend (Express 5 + Prisma 7 + PostgreSQL) into a production-ready sneaker e-commerce platform. The refactoring introduces a Product-Variant-SKU data model, access/refresh token authentication with Redis blacklisting, PostgreSQL row-level locking for oversell prevention, an order state machine, Redis caching and rate limiting, Nginx reverse proxy, Docker Compose orchestration, and a Jest test suite.

### Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | Stay with Express 5 | Existing module structure is clean; migration to NestJS adds cost without business value |
| Architecture | Enhanced Modular (Approach A) | Evolves existing routes/controller/service/schema pattern; adds `common/` and `config/` layers |
| Inventory locking | PostgreSQL `SELECT ... FOR UPDATE` | Stronger ACID guarantees than Redis distributed locks; simpler for single-instance deployment |
| Refresh token storage | PostgreSQL (`RefreshToken` table) | Enables session management (view devices, revoke all); TTL checked on read |
| Access token blacklist | Redis | Short-lived keys with TTL matching token expiry; self-cleaning |

## 2. Data Model (Prisma Schema)

### 2.1 Product-Variant-SKU Hierarchy

```
Product (Nike Air Max 90)
  └── Variant (White colorway)
        └── SKU (Size 42, stock: 15, price: 189.99)
        └── SKU (Size 43, stock: 8,  price: 189.99)
  └── Variant (Black colorway)
        └── SKU (Size 41, stock: 3,  price: 199.99)
```

**Product:** `id`, `name`, `slug` (unique, SEO), `brand`, `description`, `basePrice` (display), `isActive`, `categoryId`. Relations: `category`, `variants[]`.

**Variant:** `id`, `productId`, `colorName`, `colorCode?`, `images` (String[]). Unique constraint: `[productId, colorName]`. Relations: `product`, `skus[]`.

**Sku:** `id`, `variantId`, `sku` (unique code, e.g. "NAM90-WHT-42"), `size` (Decimal 3,1 — supports half sizes), `price` (Decimal 10,2), `stock` (Int). Unique constraint: `[variantId, size]`. Relations: `variant`, `cartItems[]`, `orderItems[]`.

**Category:** Adds `slug` (unique) field.

### 2.2 CartItem & OrderItem — Re-pointed to SKU

**CartItem:** `skuId` replaces `productId`. Unique constraint: `[cartId, skuId]`.

**OrderItem:** `skuId` replaces `productId`. Adds denormalized snapshot fields: `size` (Decimal 3,1), `productName` (String), `colorName` (String). `price` remains as snapshot of SKU price at order time.

### 2.3 OrderStatus Enum (Expanded)

```
PENDING → PAID → PROCESSING → SHIPPED → COMPLETED
   ↓        ↓        ↓
CANCELLED  CANCELLED  CANCELLED
```

Values: `PENDING`, `PAID`, `PROCESSING`, `SHIPPED`, `COMPLETED`, `CANCELLED`.

### 2.4 RefreshToken Model

Fields: `id`, `userId`, `token` (unique, hashed), `userAgent?`, `ipAddress?`, `expiresAt`, `createdAt`. Indexes on `userId` and `expiresAt`. Cascade delete on User.

### 2.5 Full Prisma Schema

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum Role {
  CUSTOMER
  ADMIN
}

enum OrderStatus {
  PENDING
  PAID
  PROCESSING
  SHIPPED
  COMPLETED
  CANCELLED
}

enum PaymentStatus {
  PENDING
  SUCCESS
  FAILED
}

model User {
  id            String         @id @default(uuid())
  email         String         @unique
  password      String
  name          String?
  role          Role           @default(CUSTOMER)
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt

  cart          Cart?
  orders        Order[]
  refreshTokens RefreshToken[]

  @@map("users")
}

model RefreshToken {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  token     String   @unique
  userAgent String?
  ipAddress String?
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([userId])
  @@index([expiresAt])
  @@map("refresh_tokens")
}

model Category {
  id          String    @id @default(uuid())
  name        String    @unique
  slug        String    @unique
  description String?
  products    Product[]

  @@map("categories")
}

model Product {
  id          String    @id @default(uuid())
  name        String
  slug        String    @unique
  brand       String
  description String
  basePrice   Decimal   @db.Decimal(10, 2)
  isActive    Boolean   @default(true)
  categoryId  String
  category    Category  @relation(fields: [categoryId], references: [id])
  variants    Variant[]
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@map("products")
}

model Variant {
  id        String   @id @default(uuid())
  productId String
  product   Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  colorName String
  colorCode String?
  images    String[]
  skus      Sku[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([productId, colorName])
  @@map("variants")
}

model Sku {
  id         String      @id @default(uuid())
  variantId  String
  variant    Variant     @relation(fields: [variantId], references: [id], onDelete: Cascade)
  sku        String      @unique
  size       Decimal     @db.Decimal(3, 1)
  price      Decimal     @db.Decimal(10, 2)
  stock      Int         @default(0)
  createdAt  DateTime    @default(now())
  updatedAt  DateTime    @updatedAt
  cartItems  CartItem[]
  orderItems OrderItem[]

  @@unique([variantId, size])
  @@map("skus")
}

model Cart {
  id        String     @id @default(uuid())
  userId    String     @unique
  user      User       @relation(fields: [userId], references: [id])
  cartItems CartItem[]
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt

  @@map("carts")
}

model CartItem {
  id        String   @id @default(uuid())
  cartId    String
  cart      Cart     @relation(fields: [cartId], references: [id], onDelete: Cascade)
  skuId     String
  sku       Sku      @relation(fields: [skuId], references: [id])
  quantity  Int      @default(1)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([cartId, skuId])
  @@map("cart_items")
}

model Order {
  id          String      @id @default(uuid())
  userId      String
  user        User        @relation(fields: [userId], references: [id])
  totalAmount Decimal     @db.Decimal(10, 2)
  status      OrderStatus @default(PENDING)
  address     String?
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
  orderItems  OrderItem[]
  payment     Payment?

  @@map("orders")
}

model OrderItem {
  id          String  @id @default(uuid())
  orderId     String
  order       Order   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  skuId       String
  sku         Sku     @relation(fields: [skuId], references: [id])
  quantity    Int
  price       Decimal @db.Decimal(10, 2)
  size        Decimal @db.Decimal(3, 1)
  productName String
  colorName   String

  @@map("order_items")
}

model Payment {
  id            String        @id @default(uuid())
  orderId       String        @unique
  order         Order         @relation(fields: [orderId], references: [id], onDelete: Cascade)
  provider      String        @default("STRIPE")
  transactionId String?       @unique
  amount        Decimal       @db.Decimal(10, 2)
  status        PaymentStatus @default(PENDING)
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt

  @@map("payments")
}
```

### 2.6 Migration Strategy

Pre-production: `prisma migrate reset` + fresh migration + seed script with sample sneaker data.

## 3. Folder Structure

```
apps/backend/
├── Dockerfile                              # NEW — multi-stage build
├── prisma/
│   ├── schema.prisma                       # REWRITE
│   └── seed.ts                             # NEW
├── jest.config.ts                          # NEW
├── src/
│   ├── server.ts                           # REFACTOR (Redis init, graceful shutdown, health check)
│   ├── config/
│   │   ├── env.ts                          # NEW — Zod-validated env (single source of truth)
│   │   ├── prisma.ts                       # EXISTING — minor refactor
│   │   ├── redis.ts                        # NEW — ioredis singleton
│   │   └── stripe.ts                       # EXISTING
│   ├── common/
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts           # MOVED+ENHANCED (Redis blacklist check)
│   │   │   ├── error.middleware.ts          # MOVED
│   │   │   ├── validate.middleware.ts       # MOVED
│   │   │   └── rateLimiter.middleware.ts    # NEW
│   │   ├── utils/
│   │   │   ├── appError.ts                 # MOVED
│   │   │   ├── jwt.ts                      # MOVED+REWRITE (access+refresh, jti)
│   │   │   ├── password.ts                 # NEW (extracted from auth service)
│   │   │   ├── tokenBlacklist.ts           # NEW
│   │   │   └── pagination.ts              # NEW
│   │   └── types/
│   │       └── express.d.ts                # MOVED
│   ├── modules/
│   │   ├── auth/                           # ENHANCED (refresh, logout, change-password)
│   │   │   ├── auth.routes.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   └── auth.schema.ts
│   │   ├── catalog/                        # REWRITE (Product/Variant/SKU, caching)
│   │   │   ├── catalog.routes.ts
│   │   │   ├── catalog.controller.ts
│   │   │   ├── catalog.service.ts
│   │   │   └── catalog.schema.ts
│   │   ├── cart/                           # MODIFY (SKU refs, PG locking)
│   │   │   ├── cart.routes.ts
│   │   │   ├── cart.controller.ts
│   │   │   ├── cart.service.ts
│   │   │   └── cart.schema.ts
│   │   ├── order/                          # ENHANCE (state machine, admin routes)
│   │   │   ├── order.routes.ts
│   │   │   ├── order.controller.ts
│   │   │   ├── order.service.ts
│   │   │   ├── order.schema.ts
│   │   │   └── order.statemachine.ts       # NEW
│   │   ├── payment/                        # MINOR CHANGES (state machine integration)
│   │   │   ├── payment.routes.ts
│   │   │   ├── payment.controller.ts
│   │   │   └── payment.service.ts
│   │   └── admin/                          # NEW MODULE (dashboard, inventory)
│   │       ├── admin.routes.ts
│   │       ├── admin.controller.ts
│   │       ├── admin.service.ts
│   │       └── admin.schema.ts
│   └── __tests__/
│       ├── setup.ts                        # NEW
│       ├── helpers/
│       │   ├── db.ts                       # NEW
│       │   └── auth.ts                     # NEW
│       ├── integration/
│       │   ├── auth.test.ts               # NEW
│       │   ├── catalog.test.ts            # NEW
│       │   ├── cart.test.ts               # NEW
│       │   ├── order.test.ts              # NEW
│       │   └── payment.test.ts            # NEW
│       └── unit/
│           ├── order.statemachine.test.ts  # NEW
│           ├── jwt.test.ts                # NEW
│           └── pagination.test.ts         # NEW

# Root level:
├── docker-compose.yml                      # EXPAND (add Redis, Backend, Nginx)
├── docker-compose.test.yml                 # NEW
├── nginx/
│   ├── nginx.conf                          # NEW
│   ├── conf.d/default.conf                 # NEW
│   └── ssl/.gitkeep                        # NEW
└── .env                                    # NEW (root env for docker-compose)
```

### Summary of File Counts

| Category | Count |
|----------|-------|
| New files | ~28 |
| Modified existing files | ~18 |
| Moved files (middlewares/, utils/, types/) | 6 |
| Deleted files | 0 (old locations become empty dirs, removed) |

## 4. Authentication & Authorization

### 4.1 Token Flow

- **Access token:** JWT, 15-min expiry, contains `{ id, role, jti }`, sent in Authorization header.
- **Refresh token:** Opaque UUID, 7-day expiry, SHA-256 hashed before DB storage, sent in httpOnly cookie (`path=/api/auth`, `secure`, `sameSite=strict`).
- **Token rotation:** Each refresh issues a new refresh token and invalidates the old one.

### 4.2 Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | Public | Register + issue token pair |
| POST | `/api/auth/login` | Public | Login + issue token pair |
| POST | `/api/auth/refresh` | Cookie | Rotate refresh, issue new access |
| POST | `/api/auth/logout` | Authenticated | Blacklist access + delete refresh |
| POST | `/api/auth/logout-all` | Authenticated | Revoke all sessions |
| GET | `/api/auth/me` | Authenticated | Current user profile |
| PATCH | `/api/auth/change-password` | Authenticated | Change password + revoke other sessions |

### 4.3 Middleware

`authenticate`: Extract Bearer token, verify JWT, check Redis blacklist (`bl:<jti>`), attach user to request. ~0.5ms overhead from Redis check.

`authorize(roles)`: Check `req.user.role` against allowed roles.

### 4.4 Refresh Token Cookie Configuration

```typescript
res.cookie('refreshToken', rawToken, {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/api/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000
});
```

### 4.5 Security Properties

| Threat | Mitigation |
|--------|-----------|
| XSS steals tokens | Access token in memory (not localStorage), refresh token in httpOnly cookie |
| CSRF | `sameSite: strict` + cookie scoped to `/api/auth` path only |
| Refresh token theft | Token rotation — stolen token is invalidated on next legitimate refresh |
| Session hijacking | Short access token TTL (15 min), blacklist on logout |
| Password change | All other sessions revoked (delete all refresh tokens + blacklist current) |
| Brute force login | Redis-backed rate limiter on `/api/auth/login` |

### 4.6 Env Variables

```
JWT_ACCESS_SECRET=<random-64-char>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
```

Replaces old `JWT_SECRET` and `JWT_EXPIRES_IN`.

## 5. Cart & Checkout with PostgreSQL Row-Level Locking

### 5.1 Add to Cart

`RepeatableRead` transaction + `SELECT ... FOR UPDATE` on the specific SKU row. Validates `newQuantity <= sku.stock`. No stock decrement — stock is only decremented at checkout.

```typescript
// addItemToCart(userId, { skuId, quantity })
return prisma.$transaction(async (tx) => {
  const [sku] = await tx.$queryRaw<Sku[]>`
    SELECT * FROM skus WHERE id = ${skuId} FOR UPDATE
  `;

  if (!sku) throw new AppError("SKU not found", 404);
  if (!sku.stock) throw new AppError("Out of stock", 400);

  const cart = await tx.cart.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });

  const existingItem = await tx.cartItem.findUnique({
    where: { cartId_skuId: { cartId: cart.id, skuId } },
  });

  const newQuantity = (existingItem?.quantity ?? 0) + quantity;

  if (newQuantity > sku.stock) {
    throw new AppError(`Only ${sku.stock} units available`, 400);
  }

  return tx.cartItem.upsert({
    where: { cartId_skuId: { cartId: cart.id, skuId } },
    update: { quantity: newQuantity },
    create: { cartId: cart.id, skuId, quantity },
  });
}, {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
});
```

### 5.2 Checkout (Critical Path)

1. Fetch cart with items + SKU + Variant + Product data.
2. `BEGIN TRANSACTION (RepeatableRead)`.
3. `SELECT * FROM skus WHERE id = ANY($skuIds) ORDER BY id FOR UPDATE` — locks all SKU rows, consistent ordering prevents deadlocks.
4. Validate stock for every SKU.
5. Decrement stock for every SKU.
6. Create Order + OrderItems (with denormalized `size`, `productName`, `colorName` snapshots).
7. Create Payment record (PENDING).
8. Clear cart items.
9. `COMMIT` — locks released.

### 5.3 Oversell Prevention

`FOR UPDATE` forces concurrent transactions to serialize on the same SKU rows. Transaction B waits for A to commit, then reads the updated (decremented) stock.

```
Transaction A                          Transaction B
─────────────                          ─────────────
BEGIN                                  BEGIN
SELECT ... FOR UPDATE (sku_42)
  → acquires lock, reads stock=1       SELECT ... FOR UPDATE (sku_42)
                                         → BLOCKS (waiting for A's lock)
Validate: 1 >= 1 ✓
Decrement: stock = 0
Create order
COMMIT → lock released                → lock acquired, reads stock=0
                                       Validate: 0 >= 1 ✗
                                       THROW "Insufficient stock"
                                       ROLLBACK
```

### 5.4 Deadlock Prevention

The `ORDER BY id` in the `SELECT ... FOR UPDATE` query is deliberate. If Transaction A locks SKU-1 then SKU-2, while Transaction B locks SKU-2 then SKU-1, you get a deadlock. By always locking in `id` order, both transactions acquire locks in the same sequence — deadlocks become impossible.

## 6. Order State Machine

### 6.1 State Diagram

```
  ┌──────────┐
  │ PENDING  │──────────────────────────────────┐
  └────┬─────┘                                  │
       │ Stripe webhook: payment_intent.succeeded│
       ▼                                        ▼
  ┌──────────┐                            ┌───────────┐
  │   PAID   │                            │ CANCELLED │
  └────┬─────┘                            └───────────┘
       │ Admin action                           ▲
       ▼                                        │
  ┌──────────────┐                              │
  │  PROCESSING  │──────────────────────────────┘
  └──────┬───────┘
         │ Admin action
         ▼
  ┌──────────┐
  │ SHIPPED  │
  └────┬─────┘
       │ Admin action / delivery confirmation
       ▼
  ┌───────────┐
  │ COMPLETED │
  └───────────┘
```

### 6.2 Transition Table

| From | To | Allowed Roles | Stock Restore | Refund |
|------|----|--------------|---------------|--------|
| PENDING | PAID | SYSTEM | No | No |
| PAID | PROCESSING | ADMIN | No | No |
| PROCESSING | SHIPPED | ADMIN | No | No |
| SHIPPED | COMPLETED | ADMIN | No | No |
| PENDING | CANCELLED | CUSTOMER, ADMIN | Yes | No |
| PAID | CANCELLED | ADMIN | Yes | Yes (Stripe) |
| PROCESSING | CANCELLED | ADMIN | Yes | Yes (Stripe) |

### 6.3 Implementation

`order.statemachine.ts`: Pure function `validateTransition(current, next, role)` returns the transition rule or throws. No I/O, trivially unit-testable.

`order.service.ts`: `updateOrderStatus()` locks the order row with `FOR UPDATE`, calls `validateTransition`, executes side effects (stock restore, refund) within the transaction, updates status.

### 6.4 Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/orders/checkout` | Customer | Create order (PENDING) |
| GET | `/api/orders` | Customer | List my orders |
| GET | `/api/orders/:id` | Customer | Order detail |
| PATCH | `/api/orders/:id/cancel` | Customer | Cancel own PENDING order |
| GET | `/api/admin/orders` | Admin | List all orders (filterable) |
| GET | `/api/admin/orders/:id` | Admin | Any order detail |
| PATCH | `/api/admin/orders/:id/status` | Admin | Transition order status |

### 6.5 Cancellation & Refund Policy

- **PENDING → CANCELLED**: Stock restored. No refund needed (payment hasn't been collected).
- **PAID → CANCELLED**: Stock restored. Triggers Stripe refund via `stripe.refunds.create()`.
- **PROCESSING → CANCELLED**: Stock restored. Triggers Stripe refund. Admin-only action.
- **SHIPPED / COMPLETED**: Cannot be cancelled.

## 7. Redis Integration

### 7.1 Client

`ioredis` with retry strategy (exponential backoff, max 3s). Env: `REDIS_URL=redis://localhost:6379`.

### 7.2 Access Token Blacklist

Key: `bl:<jti>`, Value: `"1"`, TTL: remaining access token lifetime. Self-cleaning via Redis TTL.

```typescript
export async function blacklistToken(jti: string, expiresAt: number): Promise<void> {
  const ttl = expiresAt - Math.floor(Date.now() / 1000);
  if (ttl > 0) {
    await redis.set(`bl:${jti}`, "1", "EX", ttl);
  }
}

export async function isTokenBlacklisted(jti: string): Promise<boolean> {
  const result = await redis.get(`bl:${jti}`);
  return result !== null;
}
```

### 7.3 Catalog Caching (Cache-Aside)

| Key | TTL | Invalidation |
|-----|-----|-------------|
| `catalog:products:<queryHash>` | 5 min | On product/variant/SKU write |
| `catalog:product:<slug>` | 10 min | On that product's write |
| `catalog:categories` | 30 min | On category write |

### 7.4 Rate Limiting

Sliding window counter (`INCR` + `EXPIRE`). Key pattern: `rl:<prefix>:<ip>`.

| Endpoint | Window | Max |
|----------|--------|-----|
| POST `/api/auth/login` | 15 min | 10 |
| POST `/api/auth/register` | 1 hour | 5 |
| POST `/api/auth/refresh` | 1 min | 10 |
| POST `/api/orders/checkout` | 1 min | 3 |
| Global | 1 min | 100 |

### 7.5 Redis Key Namespace

| Prefix | Purpose | Example Key | TTL |
|--------|---------|-------------|-----|
| `bl:` | Access token blacklist | `bl:abc123-jti` | Remaining token life (~15 min max) |
| `catalog:` | Catalog cache | `catalog:products:a1b2c3` | 5-30 min |
| `rl:` | Rate limiting | `rl:login:192.168.1.1` | Window size (1-60 min) |

### 7.6 Graceful Degradation

Redis is not in the critical write path. If Redis goes down:

| Feature | Behavior when Redis is down |
|---------|---------------------------|
| Token blacklist | Fall back to accept tokens (log warning). Short access token TTL (15 min) limits exposure. |
| Catalog cache | Cache misses — all reads go to PostgreSQL. Higher DB load but fully functional. |
| Rate limiting | Skip rate limiting (log warning). Nginx rate limiting provides a secondary layer. |

## 8. Infrastructure

### 8.1 Docker Compose

4 services: `postgres` (16-alpine, healthcheck), `redis` (7-alpine, appendonly, 256MB, healthcheck), `backend` (multi-stage Dockerfile, depends on healthy postgres+redis), `nginx` (1.27-alpine, ports 80/443).

Test compose (`docker-compose.test.yml`): `postgres-test` (port 5433, tmpfs for speed), `redis-test` (port 6380).

### 8.2 Backend Dockerfile

Multi-stage build:
- **Stage 1 (deps):** Install dependencies with `pnpm install --frozen-lockfile`
- **Stage 2 (build):** Copy source, run `prisma generate`
- **Stage 3 (production):** Minimal image with `node:22-alpine`, `USER node`, `EXPOSE 3000`

### 8.3 Nginx

`nginx.conf`: gzip compression, security headers (X-Frame-Options, X-Content-Type-Options, X-XSS-Protection, Referrer-Policy), rate limit zones (`api_general`: 30r/s, `api_auth`: 5r/m), 10MB request size limit.

`conf.d/default.conf`: Upstream proxy to `backend:3000`. Location blocks for `/api/`, `/api/auth/` (stricter rate limit), `/api/payment/webhook` (no rate limit), `/health`. HTTPS block commented out (uncomment when SSL certs available).

### 8.4 Testing

Jest with `ts-jest`. Unit tests (state machine, JWT, pagination) run without DB. Integration tests (auth, catalog, cart, order, payment) use test DB and test Redis via `docker-compose.test.yml`. Test setup: migrate test DB, truncate between tests, flush Redis between tests. `supertest` for HTTP assertions. `--runInBand` for integration tests.

### 8.5 Server Enhancements

- Health check endpoint: `GET /health` → `{ status: "ok", timestamp }`
- Graceful shutdown on SIGTERM/SIGINT: close HTTP server, disconnect Prisma, disconnect Redis, force-kill after 10s
- `cookie-parser` middleware for refresh token cookies
- Global rate limiter middleware

## 9. Phased Execution Plan

| Phase | Focus | Duration (3-4 hrs/day) |
|-------|-------|----------------------|
| 1 | Infrastructure: restructure dirs, Prisma schema rewrite, Docker Compose, Nginx, seed script | 4-5 days |
| 2 | Core API: auth rewrite (access+refresh), catalog (Product/Variant/SKU), cart (SKU+locking), order (state machine+locking), payment integration, integration tests | 7-8 days |
| 3 | Redis: client setup, token blacklist, catalog caching, rate limiting, graceful degradation | 3-4 days |
| 4 | Admin module, security hardening, remaining tests, production readiness | 3-4 days |
| **Total** | | **17-21 days (~4-5 weeks)** |

### Risk Factors

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Prisma `$queryRaw` for `FOR UPDATE` — type safety gaps | +1 day | Write raw SQL carefully, test early |
| Stripe webhook integration with new order state machine | +1 day | Test with Stripe CLI's `stripe listen --forward-to` |
| Docker networking issues (first-time setup) | +0.5 day | Use healthchecks, test incrementally |
| Test infrastructure setup (test DB, cleanup) | +1 day | Set up in Phase 1, refine as needed |

## 10. Dependencies Added

| Package | Purpose |
|---------|---------|
| `ioredis` | Redis client |
| `cookie-parser` | Parse httpOnly refresh token cookie |
| `jest` + `ts-jest` + `@types/jest` | Testing framework |
| `supertest` + `@types/supertest` | HTTP integration testing |
