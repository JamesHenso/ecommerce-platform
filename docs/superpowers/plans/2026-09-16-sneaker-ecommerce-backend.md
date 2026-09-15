# Sneaker E-Commerce Backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the existing Express 5 + Prisma 7 backend into a production-ready sneaker e-commerce platform with a Product-Variant-SKU model, access/refresh JWT auth, PostgreSQL row-level locking, order state machine, Redis caching/rate-limiting, Nginx reverse proxy, Docker Compose orchestration, and a Jest test suite.

**Architecture:** Enhanced Modular (Approach A) — evolves the existing routes/controller/service/schema pattern. Adds `src/common/` for cross-cutting concerns, `src/config/env.ts` as the single Zod-validated env source, and a new `src/modules/admin/` module. The critical write path (inventory locking) is PostgreSQL-only; Redis is for reads and short-lived keys.

**Tech Stack:** Express 5, TypeScript 7, Prisma 7.10 + PrismaPg adapter, PostgreSQL 16, Redis 7 (ioredis), Stripe, Nginx 1.27, Docker Compose, Jest + ts-jest + supertest, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-16-sneaker-ecommerce-backend-design.md`

## Global Constraints

- Node.js 22, pnpm 11.25.0, TypeScript 7, Prisma 7.10, Express 5
- ESM throughout — all imports use `.js` extension
- Absolute no `process.env.X` outside `src/config/env.ts`
- `FOR UPDATE` queries always use `ORDER BY id` to prevent deadlocks
- No `Serializable` isolation — use `RepeatableRead` + explicit locks
- All tests run against the test stack (`docker-compose.test.yml`): postgres-test port 5433, redis-test port 6380
- Integration tests run with `--runInBand` (sequential — shared test DB)
- Commit after every task using `feat:`, `chore:`, or `test:` prefix

---

## Phase 1 — Infrastructure, Prisma Schema & Docker

### Task 1: Directory Restructure & Env Config

**Files:**
- Create: `apps/backend/src/config/env.ts`
- Create: `apps/backend/src/common/middleware/` (directory)
- Create: `apps/backend/src/common/utils/` (directory)
- Create: `apps/backend/src/common/types/` (directory)
- Move: `src/middlewares/auth.middleware.ts` → `src/common/middleware/auth.middleware.ts`
- Move: `src/middlewares/error.middleware.ts` → `src/common/middleware/error.middleware.ts`
- Move: `src/middlewares/validate.middleware.ts` → `src/common/middleware/validate.middleware.ts`
- Move: `src/utils/appError.ts` → `src/common/utils/appError.ts`
- Move: `src/utils/jwt.ts` → `src/common/utils/jwt.ts`
- Move: `src/types/express.d.ts` → `src/common/types/express.d.ts`
- Modify: all files that import from `../../utils/`, `../../middlewares/`, `../types/`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `env` object exported from `src/config/env.ts` — `{ PORT: number, DATABASE_URL: string, REDIS_URL: string, JWT_ACCESS_SECRET: string, JWT_ACCESS_EXPIRES_IN: string, JWT_REFRESH_EXPIRES_IN: string, STRIPE_SECRET_KEY: string, STRIPE_WEBHOOK_SECRET: string, CLIENT_URL: string, NODE_ENV: string }`
- Produces: `AppError` class from `src/common/utils/appError.ts`
- Produces: `signToken(payload): string` from `src/common/utils/jwt.ts` (old signature, rewritten in Task 4)
- Produces: `verifyToken(token): JwtPayloadUser` from `src/common/utils/jwt.ts` (old signature, rewritten in Task 4)

- [ ] **Step 1: Create `src/config/env.ts` with Zod-validated environment variables**

```typescript
// apps/backend/src/config/env.ts
import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  CLIENT_URL: z.string().url(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
```

- [ ] **Step 2: Create directory structure and move files**

```bash
mkdir -p apps/backend/src/common/middleware
mkdir -p apps/backend/src/common/utils
mkdir -p apps/backend/src/common/types

cp apps/backend/src/middlewares/auth.middleware.ts apps/backend/src/common/middleware/auth.middleware.ts
cp apps/backend/src/middlewares/error.middleware.ts apps/backend/src/common/middleware/error.middleware.ts
cp apps/backend/src/middlewares/validate.middleware.ts apps/backend/src/common/middleware/validate.middleware.ts
cp apps/backend/src/utils/appError.ts apps/backend/src/common/utils/appError.ts
cp apps/backend/src/utils/jwt.ts apps/backend/src/common/utils/jwt.ts
cp apps/backend/src/types/express.d.ts apps/backend/src/common/types/express.d.ts
```

- [ ] **Step 3: Update all import paths across all modules and config files**

In every file under `src/modules/`, replace:
- `../../utils/appError.js` → `../../common/utils/appError.js`
- `../../utils/jwt.js` → `../../common/utils/jwt.js`
- `../../middlewares/auth.middleware.js` → `../../common/middleware/auth.middleware.js`
- `../../middlewares/validate.middleware.js` → `../../common/middleware/validate.middleware.js`

In `src/common/middleware/auth.middleware.ts`, replace:
- `../utils/appError.js` → `../utils/appError.js` (stays the same — now relative within common)
- `../utils/jwt.js` → `../utils/jwt.js` (stays the same)

In `src/common/middleware/error.middleware.ts`, replace:
- `../utils/appError.js` → `../utils/appError.js` (stays the same)

In `src/server.ts`, replace:
- `./middlewares/error.middleware.js` → `./common/middleware/error.middleware.js`

Remove `import "dotenv/config"` from `src/server.ts` (now handled in `env.ts`).

Update `src/config/stripe.ts` to import `env`:
```typescript
import Stripe from "stripe";
import { env } from "./env.js";

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: "2026-08-26.dahlia",
  typescript: true,
});
```

Update `src/config/prisma.ts` to import `env`:
```typescript
import { env } from "./env.js";
// Use env.DATABASE_URL instead of process.env.DATABASE_URL
```

Update `src/server.ts` port:
```typescript
import { env } from "./config/env.js";
const port = env.PORT;
```

- [ ] **Step 4: Update `.env` and `.env.example` with new variable names**

Add to `apps/backend/.env`:
```
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=<generate-random-64-char-string>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
```

Remove old `JWT_SECRET` and `JWT_EXPIRES_IN` entries from `.env`.

Update `apps/backend/.env.example` to match all new variable names.

- [ ] **Step 5: Delete old directories (now empty)**

```bash
rm -rf apps/backend/src/middlewares
rm -rf apps/backend/src/utils
rm -rf apps/backend/src/types
```

- [ ] **Step 6: Verify the app starts without errors**

```bash
cd apps/backend && pnpm dev
# Expect: "API listening on http://localhost:3000" (no crash)
# Ctrl+C to stop
```

- [ ] **Step 7: Run typecheck to catch broken imports**

```bash
cd apps/backend && pnpm typecheck
# Expect: 0 errors
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: restructure to common/ layout, add Zod-validated env.ts"
```

---

### Task 2: Prisma Schema Rewrite

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`
- Create: `apps/backend/prisma/seed.ts`
- Modify: `apps/backend/package.json` (add seed config)

**Interfaces:**
- Consumes: `env.DATABASE_URL` from `src/config/env.ts`
- Produces: Prisma models: `User`, `RefreshToken`, `Category`, `Product`, `Variant`, `Sku`, `Cart`, `CartItem`, `Order`, `OrderItem`, `Payment`
- Produces: Enums: `Role` (CUSTOMER, ADMIN), `OrderStatus` (PENDING, PAID, PROCESSING, SHIPPED, COMPLETED, CANCELLED), `PaymentStatus` (PENDING, SUCCESS, FAILED)
- Produces: Seed data: 1 category, 1 product, 2 variants, 16 SKUs (sizes 38-45 per variant)

- [ ] **Step 1: Rewrite `prisma/schema.prisma` with full new schema**

Replace the entire contents of `apps/backend/prisma/schema.prisma` with:

```prisma
datasource db {
  provider = "postgresql"
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

- [ ] **Step 2: Reset database and generate fresh migration**

```bash
cd apps/backend
pnpm prisma migrate reset --force
pnpm prisma migrate dev --name init_v2
pnpm prisma generate
```

- [ ] **Step 3: Create seed script `prisma/seed.ts`**

```typescript
// apps/backend/prisma/seed.ts
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/common/utils/password.js";

const prisma = new PrismaClient();

async function main() {
  // Seed admin user
  const adminPassword = await hashPassword("admin123");
  await prisma.user.create({
    data: {
      email: "admin@sneakers.com",
      password: adminPassword,
      name: "Admin",
      role: "ADMIN",
    },
  });

  // Seed categories
  const running = await prisma.category.create({
    data: { name: "Running", slug: "running", description: "Running shoes" },
  });

  const lifestyle = await prisma.category.create({
    data: { name: "Lifestyle", slug: "lifestyle", description: "Lifestyle sneakers" },
  });

  // Seed products with variants and SKUs
  await prisma.product.create({
    data: {
      name: "Nike Air Max 90",
      slug: "nike-air-max-90",
      brand: "Nike",
      description: "The Nike Air Max 90 stays true to its OG running roots with the iconic Waffle sole, stitched overlays and classic TPU details.",
      basePrice: 189.99,
      categoryId: running.id,
      variants: {
        create: [
          {
            colorName: "Triple White",
            colorCode: "#FFFFFF",
            images: ["https://example.com/am90-white-1.jpg", "https://example.com/am90-white-2.jpg"],
            skus: {
              create: [38, 39, 40, 41, 42, 43, 44, 45].map((size) => ({
                sku: `NAM90-WHT-${size}`,
                size,
                price: 189.99,
                stock: 10,
              })),
            },
          },
          {
            colorName: "Triple Black",
            colorCode: "#000000",
            images: ["https://example.com/am90-black-1.jpg"],
            skus: {
              create: [38, 39, 40, 41, 42, 43, 44, 45].map((size) => ({
                sku: `NAM90-BLK-${size}`,
                size,
                price: 199.99,
                stock: 8,
              })),
            },
          },
        ],
      },
    },
  });

  await prisma.product.create({
    data: {
      name: "Adidas Ultraboost 5",
      slug: "adidas-ultraboost-5",
      brand: "Adidas",
      description: "Responsive Boost midsole cushioning delivers an energized ride.",
      basePrice: 179.99,
      categoryId: running.id,
      variants: {
        create: [
          {
            colorName: "Core Black",
            colorCode: "#1A1A1A",
            images: ["https://example.com/ub5-black-1.jpg"],
            skus: {
              create: [39, 40, 41, 42, 43, 44].map((size) => ({
                sku: `AUB5-BLK-${size}`,
                size,
                price: 179.99,
                stock: 12,
              })),
            },
          },
        ],
      },
    },
  });

  await prisma.product.create({
    data: {
      name: "New Balance 550",
      slug: "new-balance-550",
      brand: "New Balance",
      description: "A heritage basketball silhouette revived for today's streetwear scene.",
      basePrice: 109.99,
      categoryId: lifestyle.id,
      variants: {
        create: [
          {
            colorName: "White Green",
            colorCode: "#FFFFFF",
            images: ["https://example.com/nb550-wg-1.jpg"],
            skus: {
              create: [38, 39, 40, 41, 42, 43, 44, 45].map((size) => ({
                sku: `NB550-WGN-${size}`,
                size,
                price: 109.99,
                stock: 15,
              })),
            },
          },
          {
            colorName: "White Navy",
            colorCode: "#FFFFFF",
            images: ["https://example.com/nb550-wn-1.jpg"],
            skus: {
              create: [39, 40, 41, 42, 43, 44].map((size) => ({
                sku: `NB550-WNV-${size}`,
                size,
                price: 109.99,
                stock: 6,
              })),
            },
          },
        ],
      },
    },
  });

  console.log("Seed complete: 1 admin, 2 categories, 3 products, 5 variants, 34 SKUs");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 4: Add seed config to `apps/backend/package.json`**

Add this top-level key to `package.json`:
```json
"prisma": {
  "seed": "tsx prisma/seed.ts"
}
```

- [ ] **Step 5: Run seed and verify**

```bash
cd apps/backend && pnpm prisma db seed
# Expect: "Seed complete: 1 admin, 2 categories, 3 products, 5 variants, 34 SKUs"
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: prisma schema v2 — Product/Variant/SKU, RefreshToken, expanded OrderStatus, seed data"
```

---

### Task 3: Docker Compose, Dockerfile & Nginx

**Files:**
- Modify: `docker-compose.yml`
- Create: `docker-compose.test.yml`
- Create: `apps/backend/Dockerfile`
- Create: `nginx/nginx.conf`
- Create: `nginx/conf.d/default.conf`
- Create: `nginx/ssl/.gitkeep`
- Create: `.env` (root level, for docker-compose variables)

**Interfaces:**
- Consumes: Backend app on port 3000
- Produces: Full Docker stack accessible at `http://localhost` (Nginx → backend:3000)
- Produces: Test stack: postgres-test on port 5433, redis-test on port 6380

- [ ] **Step 1: Rewrite `docker-compose.yml` with all 4 services**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: ecom_postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ${DB_NAME}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: ecom_redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build:
      context: .
      dockerfile: apps/backend/Dockerfile
    container_name: ecom_backend
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file:
      - apps/backend/.env
    environment:
      DATABASE_URL: postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}
      REDIS_URL: redis://redis:6379
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  nginx:
    image: nginx:1.27-alpine
    container_name: ecom_nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
    depends_on:
      - backend

volumes:
  postgres_data:
  redis_data:
```

- [ ] **Step 2: Create `docker-compose.test.yml`**

```yaml
services:
  postgres-test:
    image: postgres:16-alpine
    container_name: ecom_postgres_test
    environment:
      POSTGRES_USER: test_user
      POSTGRES_PASSWORD: test_password
      POSTGRES_DB: ecom_test
    ports:
      - "5433:5432"
    tmpfs:
      - /var/lib/postgresql/data

  redis-test:
    image: redis:7-alpine
    container_name: ecom_redis_test
    ports:
      - "6380:6379"
```

- [ ] **Step 3: Create `apps/backend/Dockerfile` (multi-stage)**

```dockerfile
# Stage 1: Install dependencies
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/
RUN pnpm install --frozen-lockfile --filter backend

# Stage 2: Build (generate Prisma client)
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY apps/backend/ apps/backend/
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm --filter backend exec prisma generate

# Stage 3: Production image
FROM node:22-alpine AS production
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/backend ./apps/backend
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "backend", "start"]
```

- [ ] **Step 4: Create `nginx/nginx.conf`**

```nginx
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';
    access_log /var/log/nginx/access.log main;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_min_length 1000;
    gzip_types
        text/plain
        text/css
        text/javascript
        application/json
        application/javascript
        application/xml;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    limit_req_zone $binary_remote_addr zone=api_general:10m rate=30r/s;
    limit_req_zone $binary_remote_addr zone=api_auth:10m rate=5r/m;

    client_max_body_size 10m;

    include /etc/nginx/conf.d/*.conf;
}
```

- [ ] **Step 5: Create `nginx/conf.d/default.conf`**

```nginx
upstream backend {
    server backend:3000;
}

server {
    listen 80;
    server_name _;

    # Stripe webhook — no rate limiting (Stripe handles its own)
    location /api/payment/webhook {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Stricter rate limit on auth endpoints
    location /api/auth/ {
        limit_req zone=api_auth burst=3 nodelay;

        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # General API rate limit
    location /api/ {
        limit_req zone=api_general burst=20 nodelay;

        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 30s;
        proxy_read_timeout 60s;
        proxy_send_timeout 30s;
    }

    # Health check
    location /health {
        proxy_pass http://backend;
    }
}

# HTTPS server (uncomment when SSL certs are available)
# server {
#     listen 443 ssl http2;
#     server_name your-domain.com;
#
#     ssl_certificate /etc/nginx/ssl/fullchain.pem;
#     ssl_certificate_key /etc/nginx/ssl/privkey.pem;
#     ssl_protocols TLSv1.2 TLSv1.3;
#     ssl_ciphers HIGH:!aNULL:!MD5;
#     ssl_prefer_server_ciphers on;
#
#     # Same location blocks as above
# }
```

- [ ] **Step 6: Create `nginx/ssl/.gitkeep`**

```bash
mkdir -p nginx/ssl
touch nginx/ssl/.gitkeep
```

- [ ] **Step 7: Create root `.env` for docker-compose**

```
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=ecom_db
```

- [ ] **Step 8: Update `.gitignore` to include `nginx/ssl/*.pem`**

Add to root `.gitignore`:
```
nginx/ssl/*.pem
nginx/ssl/*.key
nginx/ssl/*.crt
```

- [ ] **Step 9: Verify `docker compose config` parses without errors**

```bash
docker compose config
# Expect: valid YAML output, no errors
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: docker-compose (postgres, redis, backend, nginx), Dockerfile, nginx config"
```

---

## Phase 2 — Core API Refactoring & Authentication

### Task 4: JWT & Password Utilities

**Files:**
- Modify: `apps/backend/src/common/utils/jwt.ts`
- Create: `apps/backend/src/common/utils/password.ts`
- Create: `apps/backend/src/__tests__/unit/jwt.test.ts`
- Modify: `apps/backend/package.json` (add jest, ts-jest, supertest)
- Create: `apps/backend/jest.config.ts`

**Interfaces:**
- Consumes: `env.JWT_ACCESS_SECRET`, `env.JWT_ACCESS_EXPIRES_IN` from `src/config/env.ts`
- Produces: `signAccessToken(payload: { id: string; role: Role }): string`
- Produces: `verifyAccessToken(token: string): JwtPayload` where `JwtPayload = { id: string; role: Role; jti: string; exp: number; iat: number }`
- Produces: `generateRefreshToken(): string` — returns `crypto.randomUUID()`
- Produces: `hashRefreshToken(token: string): string` — returns SHA-256 hex digest
- Produces: `hashPassword(plain: string): Promise<string>` — bcrypt, 12 rounds
- Produces: `comparePassword(plain: string, hash: string): Promise<boolean>`

- [ ] **Step 1: Install test dependencies**

```bash
cd apps/backend
pnpm add -D jest ts-jest @types/jest supertest @types/supertest
```

- [ ] **Step 2: Create `jest.config.ts`**

```typescript
// apps/backend/jest.config.ts
import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  setupFilesAfterSetup: ["<rootDir>/src/__tests__/setup.ts"],
  coverageDirectory: "coverage",
  collectCoverageFrom: ["src/modules/**/*.ts", "src/common/**/*.ts"],
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { useESM: true }],
  },
};

export default config;
```

- [ ] **Step 3: Add test scripts to `apps/backend/package.json`**

```json
"test": "NODE_OPTIONS='--experimental-vm-modules' jest --runInBand --forceExit",
"test:unit": "NODE_OPTIONS='--experimental-vm-modules' jest --testPathPattern=unit --forceExit",
"test:integration": "NODE_OPTIONS='--experimental-vm-modules' jest --testPathPattern=integration --runInBand --forceExit",
"test:coverage": "NODE_OPTIONS='--experimental-vm-modules' jest --coverage --runInBand --forceExit"
```

- [ ] **Step 4: Write failing unit tests for JWT utilities**

```typescript
// apps/backend/src/__tests__/unit/jwt.test.ts
import { describe, it, expect } from "@jest/globals";

// Set env before importing modules that read env
process.env.JWT_ACCESS_SECRET = "test-secret-that-is-at-least-32-characters-long-for-testing";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "7d";
process.env.DATABASE_URL = "postgresql://fake:fake@localhost:5432/fake";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_fake";
process.env.CLIENT_URL = "http://localhost:3000";

import { signAccessToken, verifyAccessToken, generateRefreshToken, hashRefreshToken } from "../../common/utils/jwt.js";

describe("JWT utilities", () => {
  it("signAccessToken returns a JWT that verifyAccessToken can decode", () => {
    const token = signAccessToken({ id: "user-123", role: "CUSTOMER" });
    const decoded = verifyAccessToken(token);
    expect(decoded.id).toBe("user-123");
    expect(decoded.role).toBe("CUSTOMER");
    expect(decoded.jti).toBeTruthy();
    expect(typeof decoded.exp).toBe("number");
  });

  it("verifyAccessToken throws on tampered token", () => {
    const token = signAccessToken({ id: "user-123", role: "CUSTOMER" });
    expect(() => verifyAccessToken(token + "tampered")).toThrow();
  });

  it("verifyAccessToken throws on wrong secret", () => {
    const jwt = await import("jsonwebtoken");
    const token = jwt.default.sign({ id: "user-123", role: "CUSTOMER" }, "wrong-secret");
    expect(() => verifyAccessToken(token)).toThrow();
  });

  it("generateRefreshToken returns a UUID v4 string", () => {
    const token = generateRefreshToken();
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("hashRefreshToken returns a consistent SHA-256 hex digest", () => {
    const token = "test-token-123";
    const hash1 = hashRefreshToken(token);
    const hash2 = hashRefreshToken(token);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex = 64 chars
  });

  it("hashRefreshToken produces different hashes for different tokens", () => {
    expect(hashRefreshToken("token-a")).not.toBe(hashRefreshToken("token-b"));
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

```bash
cd apps/backend && pnpm test:unit -- --testPathPattern=jwt
# Expect: FAIL — module not found or function not defined
```

- [ ] **Step 6: Rewrite `src/common/utils/jwt.ts`**

```typescript
// apps/backend/src/common/utils/jwt.ts
import jwt from "jsonwebtoken";
import crypto from "crypto";
import type { Role } from "@prisma/client";
import { env } from "../../config/env.js";

export interface JwtPayload {
  id: string;
  role: Role;
  jti: string;
  exp: number;
  iat: number;
}

export const signAccessToken = (payload: { id: string; role: Role }): string => {
  return jwt.sign(
    { id: payload.id, role: payload.role, jti: crypto.randomUUID() },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions["expiresIn"] }
  );
};

export const verifyAccessToken = (token: string): JwtPayload => {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
};

export const generateRefreshToken = (): string => {
  return crypto.randomUUID();
};

export const hashRefreshToken = (token: string): string => {
  return crypto.createHash("sha256").update(token).digest("hex");
};
```

- [ ] **Step 7: Create `src/common/utils/password.ts`**

```typescript
// apps/backend/src/common/utils/password.ts
import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

export const hashPassword = (plain: string): Promise<string> => {
  return bcrypt.hash(plain, SALT_ROUNDS);
};

export const comparePassword = (plain: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(plain, hash);
};
```

- [ ] **Step 8: Run test to verify it passes**

```bash
cd apps/backend && pnpm test:unit -- --testPathPattern=jwt
# Expect: PASS — all 6 tests green
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: jwt access/refresh token utilities, password hashing utility, unit tests"
```

---

### Task 5: Auth Module Rewrite (Access + Refresh Tokens)

**Files:**
- Modify: `apps/backend/src/modules/auth/auth.service.ts`
- Modify: `apps/backend/src/modules/auth/auth.controller.ts`
- Modify: `apps/backend/src/modules/auth/auth.routes.ts`
- Modify: `apps/backend/src/modules/auth/auth.schema.ts`
- Modify: `apps/backend/src/common/middleware/auth.middleware.ts`
- Modify: `apps/backend/src/common/types/express.d.ts`
- Modify: `apps/backend/src/server.ts`
- Create: `apps/backend/src/__tests__/setup.ts`
- Create: `apps/backend/src/__tests__/helpers/db.ts`
- Create: `apps/backend/src/__tests__/helpers/auth.ts`
- Create: `apps/backend/src/__tests__/integration/auth.test.ts`

**Interfaces:**
- Consumes: `signAccessToken`, `verifyAccessToken`, `generateRefreshToken`, `hashRefreshToken` from `common/utils/jwt.ts`
- Consumes: `hashPassword`, `comparePassword` from `common/utils/password.ts`
- Consumes: `env` from `config/env.ts`
- Consumes: `prisma` from `config/prisma.ts`
- Produces: `registerUser(data, meta): Promise<{ user, accessToken, rawRefreshToken }>`
- Produces: `loginUser(data, meta): Promise<{ user, accessToken, rawRefreshToken }>`
- Produces: `refreshTokens(rawToken, meta): Promise<{ accessToken, rawRefreshToken }>`
- Produces: `logoutUser(rawToken): Promise<void>`
- Produces: `logoutAll(userId): Promise<void>`
- Produces: `getMe(userId): Promise<User>`
- Produces: `authenticate` middleware that checks JWT + placeholder for Redis blacklist (wired in Task 9)

- [ ] **Step 1: Install `cookie-parser` and `ioredis`**

```bash
cd apps/backend
pnpm add cookie-parser ioredis
pnpm add -D @types/cookie-parser
```

- [ ] **Step 2: Update `src/common/types/express.d.ts`**

```typescript
// apps/backend/src/common/types/express.d.ts
import type { JwtPayload } from "../utils/jwt.js";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}
```

- [ ] **Step 3: Rewrite `auth.schema.ts`**

```typescript
// apps/backend/src/modules/auth/auth.schema.ts
import { z } from "zod";

export const registerSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(6),
    name: z.string().optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(6),
  }),
});

export type RegisterInput = z.infer<typeof registerSchema>["body"];
export type LoginInput = z.infer<typeof loginSchema>["body"];
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>["body"];
```

- [ ] **Step 4: Rewrite `auth.service.ts`**

Full implementation per spec Section 4: `registerUser`, `loginUser`, `refreshTokens`, `logoutUser`, `logoutAll`, `getMe`, `changePassword`. Each function that issues tokens creates a `RefreshToken` row with hashed token, userAgent, ipAddress, and expiresAt. Refresh rotates token. Logout deletes refresh token row. LogoutAll deletes all refresh tokens for userId.

- [ ] **Step 5: Rewrite `auth.controller.ts`**

Controllers read `req.cookies.refreshToken`, call service functions, set httpOnly cookie via:
```typescript
const setRefreshCookie = (res: Response, token: string) => {
  res.cookie("refreshToken", token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/auth",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
};
```

Handlers: `handleRegister` (201), `handleLogin` (200), `handleRefresh` (200), `handleLogout` (204), `handleLogoutAll` (204), `handleGetMe` (200), `handleChangePassword` (200).

- [ ] **Step 6: Rewrite `auth.routes.ts`**

```typescript
import { Router } from "express";
import { authenticate } from "../../common/middleware/auth.middleware.js";
import { validate } from "../../common/middleware/validate.middleware.js";
import { registerSchema, loginSchema, changePasswordSchema } from "./auth.schema.js";
import * as ctrl from "./auth.controller.js";

export const authRouter = Router();

authRouter.post("/register", validate(registerSchema), ctrl.handleRegister);
authRouter.post("/login", validate(loginSchema), ctrl.handleLogin);
authRouter.post("/refresh", ctrl.handleRefresh);
authRouter.post("/logout", authenticate, ctrl.handleLogout);
authRouter.post("/logout-all", authenticate, ctrl.handleLogoutAll);
authRouter.get("/me", authenticate, ctrl.handleGetMe);
authRouter.patch("/change-password", authenticate, validate(changePasswordSchema), ctrl.handleChangePassword);
```

- [ ] **Step 7: Update `auth.middleware.ts` (placeholder for Redis blacklist)**

```typescript
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/appError.js";
import { verifyAccessToken } from "../utils/jwt.js";

export const authenticate = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AppError("Authentication required", 401);
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = verifyAccessToken(token);
    // TODO: Redis blacklist check will be wired in Task 9
    req.user = decoded;
    next();
  } catch {
    throw new AppError("Invalid or expired token", 401);
  }
};

export const authorize = (allowedRoles: string[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new AppError("Not authenticated", 401);
    if (!allowedRoles.includes(req.user.role)) throw new AppError("Forbidden", 403);
    next();
  };
};
```

- [ ] **Step 8: Add `cookie-parser` to `server.ts`**

```typescript
import cookieParser from "cookie-parser";
// After express.json():
app.use(cookieParser());
```

- [ ] **Step 9: Create test infrastructure — `setup.ts`, `helpers/db.ts`, `helpers/auth.ts`**

`setup.ts`: Connect to test DB (port 5433), truncate all tables before each test, disconnect after all tests.

`helpers/db.ts`: Factory functions: `seedTestUser(role)`, `seedTestCategory()`, `seedTestProduct(categoryId)`, `seedTestVariant(productId)`, `seedTestSku(variantId, overrides)`.

`helpers/auth.ts`: `getAuthTokens(role)` — registers a user via supertest and returns `{ accessToken, cookie }`.

- [ ] **Step 10: Write integration tests for auth**

```typescript
// auth.test.ts
// - POST /api/auth/register → 201, body has accessToken, set-cookie has refreshToken
// - POST /api/auth/register with existing email → 409
// - POST /api/auth/login → 200, body has accessToken
// - POST /api/auth/login with wrong password → 401
// - POST /api/auth/refresh with valid cookie → 200, new accessToken
// - POST /api/auth/refresh with invalid cookie → 401
// - POST /api/auth/logout → 204
// - GET /api/auth/me → 200, returns user
// - GET /api/auth/me without token → 401
```

- [ ] **Step 11: Start test DB and run integration tests**

```bash
docker compose -f docker-compose.test.yml up -d
# Wait for postgres-test to be ready
cd apps/backend
DATABASE_URL=postgresql://test_user:test_password@localhost:5433/ecom_test pnpm prisma migrate deploy
pnpm test:integration -- --testPathPattern=auth
# Expect: all tests PASS
```

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: auth module — access+refresh tokens, rotation, logout, change-password, integration tests"
```

---

### Task 6: Catalog Module Rewrite (Product/Variant/SKU)

**Files:**
- Modify: `apps/backend/src/modules/catalog/catalog.service.ts`
- Modify: `apps/backend/src/modules/catalog/catalog.controller.ts`
- Modify: `apps/backend/src/modules/catalog/catalog.routes.ts`
- Modify: `apps/backend/src/modules/catalog/catalog.schema.ts`
- Create: `apps/backend/src/__tests__/integration/catalog.test.ts`

**Interfaces:**
- Consumes: `authenticate`, `authorize` from `common/middleware/auth.middleware.ts`
- Consumes: `validate` from `common/middleware/validate.middleware.ts`
- Consumes: `prisma` from `config/prisma.ts`
- Produces: `createCategory(data: { name, slug, description? }): Promise<Category>`
- Produces: `getAllCategories(): Promise<Category[]>`
- Produces: `getProducts(filters: GetProductsQuery): Promise<{ meta, data }>`
- Produces: `getProductBySlug(slug: string): Promise<Product>` (includes variants + SKUs)
- Produces: `createProduct(data: CreateProductInput): Promise<Product>` (nested create with variants + SKUs)
- Produces: `updateProduct(id: string, data: UpdateProductInput): Promise<Product>`
- Produces: `deleteProduct(id: string): Promise<Product>` (soft-delete: sets `isActive = false`)

- [ ] **Step 1: Rewrite `catalog.schema.ts` with Product/Variant/SKU validation**

Full Zod schemas for: `createCategorySchema`, `createProductSchema` (nested variants+SKUs), `updateProductSchema`, `getProductsQuerySchema` (page, limit, search, categoryId, brand). Export types.

- [ ] **Step 2: Rewrite `catalog.service.ts`**

- `createCategory`: check unique name, create with slug
- `getAllCategories`: findMany
- `getProducts`: filter on `isActive: true`, search by name/description, filter by categoryId/brand, paginate, include `variants.skus`, return `{ meta: { page, limit, total, totalPages }, data: products }`
- `getProductBySlug`: findUnique by slug, include `category`, `variants.skus`, throw 404 if not found or `isActive === false`
- `createProduct`: validate categoryId exists, nested create with variants and SKUs
- `updateProduct`: findUnique, update fields
- `deleteProduct`: set `isActive = false` (soft delete)
- No Redis caching yet — added in Task 10

- [ ] **Step 3: Rewrite `catalog.controller.ts`**

Handlers: `handleGetCategories`, `handleCreateCategory`, `handleGetProducts`, `handleGetProductBySlug`, `handleCreateProduct`, `handleUpdateProduct`, `handleDeleteProduct`. All use `try/catch` + `next(error)` pattern.

- [ ] **Step 4: Rewrite `catalog.routes.ts`**

```typescript
import { Router } from "express";
import { authenticate } from "../../common/middleware/auth.middleware.js";
import { authorize } from "../../common/middleware/auth.middleware.js";
import { validate } from "../../common/middleware/validate.middleware.js";
import { createCategorySchema, createProductSchema, updateProductSchema, getProductsQuerySchema } from "./catalog.schema.js";
import * as ctrl from "./catalog.controller.js";

export const catalogRouter = Router();

// Public
catalogRouter.get("/categories", ctrl.handleGetCategories);
catalogRouter.get("/products", validate(getProductsQuerySchema), ctrl.handleGetProducts);
catalogRouter.get("/products/:slug", ctrl.handleGetProductBySlug);

// Admin
catalogRouter.post("/categories", authenticate, authorize(["ADMIN"]), validate(createCategorySchema), ctrl.handleCreateCategory);
catalogRouter.post("/products", authenticate, authorize(["ADMIN"]), validate(createProductSchema), ctrl.handleCreateProduct);
catalogRouter.patch("/products/:id", authenticate, authorize(["ADMIN"]), validate(updateProductSchema), ctrl.handleUpdateProduct);
catalogRouter.delete("/products/:id", authenticate, authorize(["ADMIN"]), ctrl.handleDeleteProduct);
```

- [ ] **Step 5: Write integration tests**

```typescript
// catalog.test.ts — key test cases:
// - Admin creates category → 201
// - GET /categories → returns seeded categories
// - Admin creates product with nested variants+SKUs → 201, response includes variants+SKUs
// - GET /products → paginated list with variants+SKUs, only isActive=true
// - GET /products?search=Nike → filters correctly
// - GET /products/:slug → full product detail
// - GET /products/:slug for non-existent slug → 404
// - Admin updates product → 200
// - Admin deletes product → isActive becomes false, disappears from listings
// - Non-admin POST /products → 403
```

- [ ] **Step 6: Run integration tests**

```bash
pnpm test:integration -- --testPathPattern=catalog
# Expect: all PASS
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: catalog module — Product/Variant/SKU CRUD, search/filter/pagination, integration tests"
```

---

### Task 7: Cart Module Rewrite (SKU refs + PG locking)

**Files:**
- Modify: `apps/backend/src/modules/cart/cart.service.ts`
- Modify: `apps/backend/src/modules/cart/cart.controller.ts`
- Modify: `apps/backend/src/modules/cart/cart.routes.ts`
- Modify: `apps/backend/src/modules/cart/cart.schema.ts`
- Create: `apps/backend/src/__tests__/integration/cart.test.ts`

**Interfaces:**
- Consumes: `Sku` model with `stock`, `price`, `size` fields
- Consumes: `authenticate` middleware
- Produces: `getCart(userId): Promise<{ id, items, totalAmount }>`
- Produces: `addItemToCart(userId, { skuId, quantity }): Promise<CartItem>` — uses `SELECT ... FOR UPDATE` within `RepeatableRead` transaction
- Produces: `updateCartItem(userId, cartItemId, { quantity }): Promise<CartItem>`
- Produces: `removeCartItem(userId, cartItemId): Promise<void>`

- [ ] **Step 1: Rewrite `cart.schema.ts` — replace `productId` with `skuId`**

```typescript
import { z } from "zod";

export const addToCartSchema = z.object({
  body: z.object({
    skuId: z.string().uuid(),
    quantity: z.number().int().positive().default(1),
  }),
});

export const updateCartItemSchema = z.object({
  body: z.object({
    quantity: z.number().int().positive(),
  }),
});

export const deleteCartItemSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export type AddToCartInput = z.infer<typeof addToCartSchema>["body"];
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>["body"];
```

- [ ] **Step 2: Rewrite `cart.service.ts` with FOR UPDATE locking**

- `getCart`: include `cartItems.sku.variant.product`, compute `totalAmount` from `sku.price * quantity`
- `addItemToCart`: `RepeatableRead` transaction, `SELECT * FROM skus WHERE id = ${skuId} FOR UPDATE`, validate stock, upsert cart item
- `updateCartItem`: find cart item, check `sku.stock >= newQuantity`, update
- `removeCartItem`: find cart item, verify ownership, delete

- [ ] **Step 3: Update `cart.controller.ts` — adjust to new schema types**

- [ ] **Step 4: Write integration tests**

```typescript
// cart.test.ts — key test cases:
// - Add SKU to cart → 201, cart item created
// - Add same SKU again → quantity merged (not duplicate row)
// - Add more than stock → 400 "Only X units available"
// - GET /cart → returns items with sku.variant.product data, correct totalAmount
// - Update quantity to valid value → 200
// - Update quantity exceeding stock → 400
// - Delete cart item → 200
// - Unauthenticated request → 401
```

- [ ] **Step 5: Run integration tests**

```bash
pnpm test:integration -- --testPathPattern=cart
# Expect: all PASS
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: cart module — SKU references, FOR UPDATE locking, integration tests"
```

---

### Task 8: Order State Machine + Checkout Rewrite

**Files:**
- Create: `apps/backend/src/modules/order/order.statemachine.ts`
- Modify: `apps/backend/src/modules/order/order.service.ts`
- Modify: `apps/backend/src/modules/order/order.controller.ts`
- Modify: `apps/backend/src/modules/order/order.routes.ts`
- Modify: `apps/backend/src/modules/order/order.schema.ts`
- Modify: `apps/backend/src/modules/payment/payment.service.ts`
- Create: `apps/backend/src/__tests__/unit/order.statemachine.test.ts`
- Create: `apps/backend/src/__tests__/integration/order.test.ts`

**Interfaces:**
- Consumes: `Sku` model, `OrderStatus` enum, `prisma` client
- Consumes: `authenticate`, `authorize` middleware
- Produces: `validateTransition(current: OrderStatus, next: OrderStatus, role: "SYSTEM" | "ADMIN" | "CUSTOMER"): TransitionRule` — throws `AppError` if invalid
- Produces: `TransitionRule = { from: OrderStatus, to: OrderStatus, allowedRoles, requiresStockRestore: boolean, requiresRefund: boolean }`
- Produces: `checkoutOrder(userId, { address }): Promise<Order>` — `FOR UPDATE` on all SKU rows, creates Order + OrderItems + Payment
- Produces: `updateOrderStatus(orderId, newStatus, role, userId?): Promise<Order>`
- Produces: `getUserOrders(userId): Promise<Order[]>`
- Produces: `getOrderDetail(userId, orderId): Promise<Order>`

- [ ] **Step 1: Write failing unit tests for state machine**

```typescript
// apps/backend/src/__tests__/unit/order.statemachine.test.ts
import { describe, it, expect } from "@jest/globals";
import { validateTransition } from "../../modules/order/order.statemachine.js";

describe("Order State Machine", () => {
  // Valid transitions
  it("allows PENDING → PAID for SYSTEM", () => {
    const rule = validateTransition("PENDING", "PAID", "SYSTEM");
    expect(rule.requiresStockRestore).toBe(false);
    expect(rule.requiresRefund).toBe(false);
  });

  it("allows PAID → PROCESSING for ADMIN", () => {
    const rule = validateTransition("PAID", "PROCESSING", "ADMIN");
    expect(rule.requiresStockRestore).toBe(false);
  });

  it("allows PROCESSING → SHIPPED for ADMIN", () => {
    const rule = validateTransition("PROCESSING", "SHIPPED", "ADMIN");
    expect(rule.requiresStockRestore).toBe(false);
  });

  it("allows SHIPPED → COMPLETED for ADMIN", () => {
    const rule = validateTransition("SHIPPED", "COMPLETED", "ADMIN");
    expect(rule.requiresStockRestore).toBe(false);
  });

  it("allows PENDING → CANCELLED for CUSTOMER with stock restore", () => {
    const rule = validateTransition("PENDING", "CANCELLED", "CUSTOMER");
    expect(rule.requiresStockRestore).toBe(true);
    expect(rule.requiresRefund).toBe(false);
  });

  it("allows PAID → CANCELLED for ADMIN with stock restore + refund", () => {
    const rule = validateTransition("PAID", "CANCELLED", "ADMIN");
    expect(rule.requiresStockRestore).toBe(true);
    expect(rule.requiresRefund).toBe(true);
  });

  it("allows PROCESSING → CANCELLED for ADMIN with stock restore + refund", () => {
    const rule = validateTransition("PROCESSING", "CANCELLED", "ADMIN");
    expect(rule.requiresStockRestore).toBe(true);
    expect(rule.requiresRefund).toBe(true);
  });

  // Invalid transitions
  it("rejects SHIPPED → CANCELLED", () => {
    expect(() => validateTransition("SHIPPED", "CANCELLED", "ADMIN")).toThrow("Invalid transition");
  });

  it("rejects COMPLETED → CANCELLED", () => {
    expect(() => validateTransition("COMPLETED", "CANCELLED", "ADMIN")).toThrow("Invalid transition");
  });

  it("rejects CANCELLED → PENDING", () => {
    expect(() => validateTransition("CANCELLED", "PENDING", "ADMIN")).toThrow("Invalid transition");
  });

  // Role restrictions
  it("rejects PAID → PROCESSING for CUSTOMER", () => {
    expect(() => validateTransition("PAID", "PROCESSING", "CUSTOMER")).toThrow("cannot perform");
  });

  it("rejects PENDING → PAID for CUSTOMER", () => {
    expect(() => validateTransition("PENDING", "PAID", "CUSTOMER")).toThrow("cannot perform");
  });

  it("rejects PAID → CANCELLED for CUSTOMER", () => {
    expect(() => validateTransition("PAID", "CANCELLED", "CUSTOMER")).toThrow("cannot perform");
  });
});
```

- [ ] **Step 2: Run unit tests — verify they fail**

```bash
cd apps/backend && pnpm test:unit -- --testPathPattern=statemachine
# Expect: FAIL — module not found
```

- [ ] **Step 3: Implement `order.statemachine.ts`**

```typescript
// apps/backend/src/modules/order/order.statemachine.ts
import type { OrderStatus } from "@prisma/client";
import { AppError } from "../../common/utils/appError.js";

type Actor = "SYSTEM" | "ADMIN" | "CUSTOMER";

export interface TransitionRule {
  from: OrderStatus;
  to: OrderStatus;
  allowedRoles: Actor[];
  requiresStockRestore: boolean;
  requiresRefund: boolean;
}

const TRANSITIONS: TransitionRule[] = [
  { from: "PENDING",    to: "PAID",       allowedRoles: ["SYSTEM"],            requiresStockRestore: false, requiresRefund: false },
  { from: "PAID",       to: "PROCESSING", allowedRoles: ["ADMIN"],             requiresStockRestore: false, requiresRefund: false },
  { from: "PROCESSING", to: "SHIPPED",    allowedRoles: ["ADMIN"],             requiresStockRestore: false, requiresRefund: false },
  { from: "SHIPPED",    to: "COMPLETED",  allowedRoles: ["ADMIN"],             requiresStockRestore: false, requiresRefund: false },
  { from: "PENDING",    to: "CANCELLED",  allowedRoles: ["CUSTOMER", "ADMIN"], requiresStockRestore: true,  requiresRefund: false },
  { from: "PAID",       to: "CANCELLED",  allowedRoles: ["ADMIN"],             requiresStockRestore: true,  requiresRefund: true  },
  { from: "PROCESSING", to: "CANCELLED",  allowedRoles: ["ADMIN"],             requiresStockRestore: true,  requiresRefund: true  },
];

export function validateTransition(
  current: OrderStatus,
  next: OrderStatus,
  role: Actor
): TransitionRule {
  const rule = TRANSITIONS.find((t) => t.from === current && t.to === next);

  if (!rule) {
    throw new AppError(`Invalid transition: ${current} → ${next}`, 400);
  }

  if (!rule.allowedRoles.includes(role)) {
    throw new AppError(
      `Role ${role} cannot perform this transition: ${current} → ${next}`,
      403
    );
  }

  return rule;
}
```

- [ ] **Step 4: Run unit tests — verify they pass**

```bash
cd apps/backend && pnpm test:unit -- --testPathPattern=statemachine
# Expect: PASS — all 13 tests green
```

- [ ] **Step 5: Rewrite `order.service.ts`**

- `checkoutOrder(userId, { address })`: `RepeatableRead` transaction, `SELECT * FROM skus WHERE id = ANY($ids::uuid[]) ORDER BY id FOR UPDATE`, validate stock, decrement stock, create Order with snapshot OrderItems (`productName`, `colorName`, `size`, `price`), create Payment (PENDING), clear cart
- `updateOrderStatus(orderId, newStatus, role, userId?)`: `FOR UPDATE` on order row, call `validateTransition`, if `requiresStockRestore` then increment SKU stocks, update order status
- `getUserOrders(userId)`: findMany with orderItems + payment
- `getOrderDetail(userId, orderId)`: findFirst with ownership check

- [ ] **Step 6: Rewrite `order.schema.ts`**

```typescript
import { z } from "zod";

export const checkoutSchema = z.object({
  body: z.object({
    address: z.string().min(1),
  }),
});

export const updateOrderStatusSchema = z.object({
  body: z.object({
    status: z.enum(["PAID", "PROCESSING", "SHIPPED", "COMPLETED", "CANCELLED"]),
  }),
});

export const getOrderByIdSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>["body"];
```

- [ ] **Step 7: Rewrite `order.controller.ts` and `order.routes.ts`**

Routes:
```
POST /checkout       → authenticate, validate(checkoutSchema), handleCheckout
GET  /               → authenticate, handleGetMyOrders
GET  /:id            → authenticate, handleGetOrderDetail
PATCH /:id/cancel    → authenticate, handleCancelOrder
```

`handleCancelOrder` calls `updateOrderStatus(orderId, "CANCELLED", "CUSTOMER", req.user.id)`.

- [ ] **Step 8: Update `payment.service.ts` to use state machine**

- `createCheckoutSession`: update to use `skuId` references, read `productName` from OrderItem snapshot
- `handlePaymentSuccess`: call `updateOrderStatus(orderId, "PAID", "SYSTEM")` instead of direct `prisma.order.update`
- `handlePaymentCancelled`: call `updateOrderStatus(orderId, "CANCELLED", "SYSTEM")` — state machine handles stock restore

- [ ] **Step 9: Write integration tests**

```typescript
// order.test.ts — key test cases:
// - Checkout with items in cart → 201, order created (PENDING), stock decremented, cart cleared
// - Checkout with empty cart → 400
// - Checkout when stock insufficient → 400, stock NOT decremented (transaction rolled back)
// - GET /orders → list of user's orders
// - GET /orders/:id → order detail with items
// - PATCH /orders/:id/cancel on PENDING order → 200, stock restored
// - PATCH /orders/:id/cancel on non-PENDING → 400 or 403
// - Cannot cancel another user's order → 403
```

- [ ] **Step 10: Run all tests (unit + integration)**

```bash
pnpm test:unit -- --testPathPattern=statemachine
pnpm test:integration -- --testPathPattern=order
# Expect: all PASS
```

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: order state machine, checkout with FOR UPDATE locking, payment integration, tests"
```

---

## Phase 3 — Redis Integration

### Task 9: Redis Client, Token Blacklist & Auth Middleware Hardening

**Files:**
- Create: `apps/backend/src/config/redis.ts`
- Create: `apps/backend/src/common/utils/tokenBlacklist.ts`
- Modify: `apps/backend/src/common/middleware/auth.middleware.ts`
- Modify: `apps/backend/src/modules/auth/auth.service.ts`
- Modify: `apps/backend/src/modules/auth/auth.controller.ts`
- Modify: `apps/backend/src/server.ts`

**Interfaces:**
- Consumes: `env.REDIS_URL` from `config/env.ts`
- Consumes: `JwtPayload.jti` and `JwtPayload.exp` from `common/utils/jwt.ts`
- Produces: `redis` — ioredis client instance from `config/redis.ts`
- Produces: `blacklistToken(jti: string, exp: number): Promise<void>`
- Produces: `isTokenBlacklisted(jti: string): Promise<boolean>`
- Produces: Updated `authenticate` middleware that checks Redis blacklist with graceful degradation

- [ ] **Step 1: Create `src/config/redis.ts`**

```typescript
// apps/backend/src/config/redis.ts
import Redis from "ioredis";
import { env } from "./env.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 100, 3000),
  enableReadyCheck: true,
  lazyConnect: true,
});

redis.on("error", (err) => console.error("[Redis] connection error:", err.message));
redis.on("connect", () => console.log("[Redis] connected"));
```

- [ ] **Step 2: Create `src/common/utils/tokenBlacklist.ts`**

```typescript
// apps/backend/src/common/utils/tokenBlacklist.ts
import { redis } from "../../config/redis.js";

export const blacklistToken = async (jti: string, exp: number): Promise<void> => {
  try {
    const ttl = exp - Math.floor(Date.now() / 1000);
    if (ttl > 0) {
      await redis.set(`bl:${jti}`, "1", "EX", ttl);
    }
  } catch (err) {
    console.error("[Redis] Failed to blacklist token — degraded mode:", (err as Error).message);
  }
};

export const isTokenBlacklisted = async (jti: string): Promise<boolean> => {
  try {
    return (await redis.get(`bl:${jti}`)) !== null;
  } catch (err) {
    console.error("[Redis] Blacklist check failed — allowing token:", (err as Error).message);
    return false;
  }
};
```

- [ ] **Step 3: Update `auth.middleware.ts` — add Redis blacklist check**

Replace the placeholder comment with:
```typescript
import { isTokenBlacklisted } from "../utils/tokenBlacklist.js";

// Inside authenticate, after verifyAccessToken:
if (await isTokenBlacklisted(decoded.jti)) {
  throw new AppError("Token has been revoked", 401);
}
```

- [ ] **Step 4: Update `auth.service.ts` — wire blacklist into logout**

Update `logoutUser` signature to `(rawRefreshToken: string, jti: string, exp: number)`:
```typescript
export const logoutUser = async (rawRefreshToken: string, jti: string, exp: number) => {
  await blacklistToken(jti, exp);
  const hashed = hashRefreshToken(rawRefreshToken);
  await prisma.refreshToken.deleteMany({ where: { token: hashed } });
};
```

Update `logoutAll` to also blacklist current token:
```typescript
export const logoutAll = async (userId: string, jti: string, exp: number) => {
  await blacklistToken(jti, exp);
  await prisma.refreshToken.deleteMany({ where: { userId } });
};
```

- [ ] **Step 5: Update `auth.controller.ts` — pass jti/exp to logout functions**

```typescript
// In handleLogout:
await logoutUser(req.cookies.refreshToken, req.user!.jti, req.user!.exp);

// In handleLogoutAll:
await logoutAll(req.user!.id, req.user!.jti, req.user!.exp);
```

- [ ] **Step 6: Connect Redis in `server.ts`**

```typescript
import { redis } from "./config/redis.js";

// Before app.listen:
await redis.connect();

// In shutdown handler:
redis.disconnect();
```

Make the server startup async if not already:
```typescript
const start = async () => {
  await redis.connect();
  const server = app.listen(env.PORT, () => {
    console.log(`Server on port ${env.PORT}`);
  });
  // ... shutdown handlers
};
start();
```

- [ ] **Step 7: Run auth integration tests to verify blacklist works**

```bash
pnpm test:integration -- --testPathPattern=auth
# Expect: all PASS — including logout test where token is rejected after logout
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: redis client, token blacklist, auth middleware hardening with graceful degradation"
```

---

### Task 10: Catalog Caching & Rate Limiting

**Files:**
- Modify: `apps/backend/src/modules/catalog/catalog.service.ts`
- Create: `apps/backend/src/common/middleware/rateLimiter.middleware.ts`
- Modify: `apps/backend/src/modules/auth/auth.routes.ts`
- Modify: `apps/backend/src/modules/order/order.routes.ts`
- Modify: `apps/backend/src/server.ts`

**Interfaces:**
- Consumes: `redis` from `config/redis.ts`
- Produces: `rateLimiter(opts: { windowMs: number, max: number, keyPrefix: string }): RequestHandler`
- Produces: Catalog service functions with Redis cache-aside (transparent to callers)
- Produces: `invalidateProductCache(slug?: string): Promise<void>`

- [ ] **Step 1: Add cache-aside to `catalog.service.ts`**

Wrap `getProducts`, `getProductBySlug`, `getAllCategories` with Redis cache-aside pattern:

```typescript
import { redis } from "../../config/redis.js";
import crypto from "crypto";

const hashQuery = (query: Record<string, unknown>): string => {
  return crypto.createHash("md5").update(JSON.stringify(query)).digest("hex");
};

// In getProducts:
const cacheKey = `catalog:products:${hashQuery(filters)}`;
try {
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);
} catch { /* degraded mode */ }

// ... normal Prisma query ...

try {
  await redis.set(cacheKey, JSON.stringify(result), "EX", 300); // 5 min
} catch { /* degraded mode */ }

return result;
```

Similar pattern for `getProductBySlug` (key: `catalog:product:${slug}`, TTL: 600) and `getAllCategories` (key: `catalog:categories`, TTL: 1800).

Add `invalidateProductCache`:
```typescript
export const invalidateProductCache = async (slug?: string): Promise<void> => {
  try {
    const listKeys = await redis.keys("catalog:products:*");
    if (listKeys.length > 0) await redis.del(...listKeys);
    if (slug) await redis.del(`catalog:product:${slug}`);
    await redis.del("catalog:categories");
  } catch (err) {
    console.error("[Redis] Cache invalidation failed:", (err as Error).message);
  }
};
```

Call `invalidateProductCache` after `createCategory`, `createProduct`, `updateProduct`, `deleteProduct`.

- [ ] **Step 2: Create `src/common/middleware/rateLimiter.middleware.ts`**

```typescript
// apps/backend/src/common/middleware/rateLimiter.middleware.ts
import type { Request, Response, NextFunction } from "express";
import { redis } from "../../config/redis.js";
import { AppError } from "../utils/appError.js";

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
}

export const rateLimiter = (opts: RateLimitOptions) => {
  const windowSec = Math.ceil(opts.windowMs / 1000);

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const identifier = req.ip || "unknown";
      const key = `rl:${opts.keyPrefix}:${identifier}`;

      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, windowSec);
      }

      res.set("X-RateLimit-Limit", String(opts.max));
      res.set("X-RateLimit-Remaining", String(Math.max(0, opts.max - current)));

      if (current > opts.max) {
        throw new AppError("Too many requests, please try again later", 429);
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      console.error("[Redis] Rate limiter failed — skipping:", (err as Error).message);
    }
    next();
  };
};
```

- [ ] **Step 3: Apply rate limiters to routes**

In `auth.routes.ts`:
```typescript
import { rateLimiter } from "../../common/middleware/rateLimiter.middleware.js";

authRouter.post("/login",
  rateLimiter({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: "login" }),
  validate(loginSchema), ctrl.handleLogin
);
authRouter.post("/register",
  rateLimiter({ windowMs: 60 * 60 * 1000, max: 5, keyPrefix: "register" }),
  validate(registerSchema), ctrl.handleRegister
);
authRouter.post("/refresh",
  rateLimiter({ windowMs: 60 * 1000, max: 10, keyPrefix: "refresh" }),
  ctrl.handleRefresh
);
```

In `order.routes.ts`:
```typescript
import { rateLimiter } from "../../common/middleware/rateLimiter.middleware.js";

orderRouter.post("/checkout",
  authenticate,
  rateLimiter({ windowMs: 60 * 1000, max: 3, keyPrefix: "checkout" }),
  validate(checkoutSchema), ctrl.handleCheckout
);
```

In `server.ts` (global rate limit, after `express.json()`):
```typescript
import { rateLimiter } from "./common/middleware/rateLimiter.middleware.js";
app.use(rateLimiter({ windowMs: 60 * 1000, max: 100, keyPrefix: "global" }));
```

- [ ] **Step 4: Run all integration tests**

```bash
pnpm test
# Expect: all unit + integration tests PASS
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: catalog redis caching (cache-aside), rate limiting middleware"
```

---

## Phase 4 — Admin Module, Security & Production Readiness

### Task 11: Admin Module

**Files:**
- Create: `apps/backend/src/modules/admin/admin.routes.ts`
- Create: `apps/backend/src/modules/admin/admin.controller.ts`
- Create: `apps/backend/src/modules/admin/admin.service.ts`
- Create: `apps/backend/src/modules/admin/admin.schema.ts`
- Modify: `apps/backend/src/server.ts`

**Interfaces:**
- Consumes: `authenticate`, `authorize(["ADMIN"])` middleware
- Consumes: `validate` middleware
- Consumes: `updateOrderStatus` from `order.service.ts`
- Consumes: `prisma` client
- Produces: `getDashboardStats(): Promise<{ totalRevenue, ordersByStatus, lowStockSkus }>`
- Produces: `getAdminOrders(filters): Promise<{ meta, data }>` — paginated, filterable by status
- Produces: `getAdminOrderDetail(orderId): Promise<Order>`
- Produces: `updateSkuStock(skuId, stock): Promise<Sku>`

- [ ] **Step 1: Create `admin.schema.ts`**

```typescript
// apps/backend/src/modules/admin/admin.schema.ts
import { z } from "zod";

export const getAdminOrdersSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    status: z.enum(["PENDING", "PAID", "PROCESSING", "SHIPPED", "COMPLETED", "CANCELLED"]).optional(),
  }),
});

export const updateOrderStatusSchema = z.object({
  body: z.object({
    status: z.enum(["PROCESSING", "SHIPPED", "COMPLETED", "CANCELLED"]),
  }),
});

export const updateSkuStockSchema = z.object({
  body: z.object({
    stock: z.number().int().min(0),
  }),
});

export type AdminOrdersQuery = z.infer<typeof getAdminOrdersSchema>["query"];
```

- [ ] **Step 2: Create `admin.service.ts`**

```typescript
// apps/backend/src/modules/admin/admin.service.ts
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/utils/appError.js";
import type { AdminOrdersQuery } from "./admin.schema.js";

export const getDashboardStats = async () => {
  const [totalRevenue, ordersByStatus, lowStockSkus] = await Promise.all([
    prisma.order.aggregate({
      _sum: { totalAmount: true },
      where: { status: { in: ["PAID", "PROCESSING", "SHIPPED", "COMPLETED"] } },
    }),
    prisma.order.groupBy({
      by: ["status"],
      _count: { id: true },
    }),
    prisma.sku.findMany({
      where: { stock: { lt: 5 } },
      include: { variant: { include: { product: { select: { name: true, slug: true } } } } },
      orderBy: { stock: "asc" },
      take: 20,
    }),
  ]);

  return {
    totalRevenue: totalRevenue._sum.totalAmount ?? 0,
    ordersByStatus: Object.fromEntries(
      ordersByStatus.map((g) => [g.status, g._count.id])
    ),
    lowStockSkus,
  };
};

export const getAdminOrders = async (filters: AdminOrdersQuery) => {
  const { page, limit, status } = filters;
  const where = status ? { status } : {};

  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      include: {
        user: { select: { id: true, email: true, name: true } },
        orderItems: true,
        payment: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    data: orders,
  };
};

export const getAdminOrderDetail = async (orderId: string) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { id: true, email: true, name: true } },
      orderItems: { include: { sku: { include: { variant: { include: { product: true } } } } } },
      payment: true,
    },
  });

  if (!order) throw new AppError("Order not found", 404);
  return order;
};

export const updateSkuStock = async (skuId: string, stock: number) => {
  const sku = await prisma.sku.findUnique({ where: { id: skuId } });
  if (!sku) throw new AppError("SKU not found", 404);

  return prisma.sku.update({
    where: { id: skuId },
    data: { stock },
    include: { variant: { include: { product: { select: { name: true } } } } },
  });
};
```

- [ ] **Step 3: Create `admin.controller.ts`**

Handlers: `handleGetDashboardStats` (200), `handleGetAdminOrders` (200), `handleGetAdminOrderDetail` (200), `handleUpdateOrderStatus` (200), `handleUpdateSkuStock` (200).

`handleUpdateOrderStatus` calls `updateOrderStatus` from `order.service.ts` with role `"ADMIN"`.

- [ ] **Step 4: Create `admin.routes.ts`**

```typescript
import { Router } from "express";
import { authenticate, authorize } from "../../common/middleware/auth.middleware.js";
import { validate } from "../../common/middleware/validate.middleware.js";
import { getAdminOrdersSchema, updateOrderStatusSchema, updateSkuStockSchema } from "./admin.schema.js";
import * as ctrl from "./admin.controller.js";

export const adminRouter = Router();

adminRouter.use(authenticate, authorize(["ADMIN"]));

adminRouter.get("/stats", ctrl.handleGetDashboardStats);
adminRouter.get("/orders", validate(getAdminOrdersSchema), ctrl.handleGetAdminOrders);
adminRouter.get("/orders/:id", ctrl.handleGetAdminOrderDetail);
adminRouter.patch("/orders/:id/status", validate(updateOrderStatusSchema), ctrl.handleUpdateOrderStatus);
adminRouter.patch("/skus/:id/stock", validate(updateSkuStockSchema), ctrl.handleUpdateSkuStock);
```

- [ ] **Step 5: Mount admin router in `server.ts`**

```typescript
import { adminRouter } from "./modules/admin/admin.routes.js";
app.use("/api/admin", adminRouter);
```

- [ ] **Step 6: Run all tests to verify nothing broken**

```bash
pnpm test
# Expect: all PASS
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: admin module — dashboard stats, order management, SKU stock update"
```

---

### Task 12: Server Hardening, Pagination Helper & Final Polish

**Files:**
- Modify: `apps/backend/src/server.ts`
- Create: `apps/backend/src/common/utils/pagination.ts`
- Create: `apps/backend/src/__tests__/unit/pagination.test.ts`
- Modify: `apps/backend/.env.example`

**Interfaces:**
- Consumes: `redis` from `config/redis.ts`, `prisma` from `config/prisma.ts`, `env` from `config/env.ts`
- Produces: `buildPaginationMeta(page: number, limit: number, total: number): { page: number, limit: number, total: number, totalPages: number }`
- Produces: `GET /health` endpoint → `{ status: "ok", timestamp: string }`
- Produces: Graceful shutdown on SIGTERM/SIGINT

- [ ] **Step 1: Write failing pagination unit tests**

```typescript
// apps/backend/src/__tests__/unit/pagination.test.ts
import { describe, it, expect } from "@jest/globals";

process.env.JWT_ACCESS_SECRET = "test-secret-that-is-at-least-32-characters-long-for-testing";
process.env.DATABASE_URL = "postgresql://fake:fake@localhost:5432/fake";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_fake";
process.env.CLIENT_URL = "http://localhost:3000";

import { buildPaginationMeta } from "../../common/utils/pagination.js";

describe("buildPaginationMeta", () => {
  it("calculates totalPages correctly for exact division", () => {
    const meta = buildPaginationMeta(1, 20, 60);
    expect(meta).toEqual({ page: 1, limit: 20, total: 60, totalPages: 3 });
  });

  it("rounds up totalPages for partial last page", () => {
    const meta = buildPaginationMeta(1, 20, 45);
    expect(meta.totalPages).toBe(3);
  });

  it("handles zero total", () => {
    const meta = buildPaginationMeta(1, 20, 0);
    expect(meta).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
  });

  it("preserves page and limit values", () => {
    const meta = buildPaginationMeta(3, 10, 100);
    expect(meta.page).toBe(3);
    expect(meta.limit).toBe(10);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd apps/backend && pnpm test:unit -- --testPathPattern=pagination
# Expect: FAIL — module not found
```

- [ ] **Step 3: Implement `src/common/utils/pagination.ts`**

```typescript
// apps/backend/src/common/utils/pagination.ts
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const buildPaginationMeta = (page: number, limit: number, total: number): PaginationMeta => ({
  page,
  limit,
  total,
  totalPages: total === 0 ? 0 : Math.ceil(total / limit),
});
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd apps/backend && pnpm test:unit -- --testPathPattern=pagination
# Expect: PASS — all 4 tests green
```

- [ ] **Step 5: Apply `buildPaginationMeta` in catalog.service.ts and admin.service.ts**

Replace inline `Math.ceil(total / limit)` with `buildPaginationMeta(page, limit, total)`:

In `catalog.service.ts` `getProducts`:
```typescript
import { buildPaginationMeta } from "../../common/utils/pagination.js";
// Replace: meta: { page, limit, total, totalPages: Math.ceil(total / limit) }
// With:    meta: buildPaginationMeta(page, limit, total)
```

In `admin.service.ts` `getAdminOrders`:
```typescript
import { buildPaginationMeta } from "../../common/utils/pagination.js";
// Replace: meta: { page, limit, total, totalPages: Math.ceil(total / limit) }
// With:    meta: buildPaginationMeta(page, limit, total)
```

- [ ] **Step 6: Harden `server.ts` — health check + graceful shutdown**

```typescript
// apps/backend/src/server.ts
import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { redis } from "./config/redis.js";
import { errorHandler } from "./common/middleware/error.middleware.js";
import { rateLimiter } from "./common/middleware/rateLimiter.middleware.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { catalogRouter } from "./modules/catalog/catalog.routes.js";
import { cartRouter } from "./modules/cart/cart.routes.js";
import { orderRouter } from "./modules/order/order.routes.js";
import { paymentRouter } from "./modules/payment/payment.routes.js";
import { adminRouter } from "./modules/admin/admin.routes.js";
import * as paymentController from "./modules/payment/payment.controller.js";

const app = express();

// Health check (before any middleware)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Stripe webhook (needs raw body — must be before express.json)
app.post(
  "/api/payment/webhook",
  express.raw({ type: "application/json" }),
  paymentController.handleStripeWebHook
);

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(rateLimiter({ windowMs: 60_000, max: 100, keyPrefix: "global" }));

// Routes
app.use("/api/auth", authRouter);
app.use("/api/catalog", catalogRouter);
app.use("/api/cart", cartRouter);
app.use("/api/orders", orderRouter);
app.use("/api/payment", paymentRouter);
app.use("/api/admin", adminRouter);

// Error handler (must be last)
app.use(errorHandler);

// Start server
const start = async () => {
  await redis.connect();

  const server = app.listen(env.PORT, () => {
    console.log(`Server running on port ${env.PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received — shutting down gracefully`);
    server.close(async () => {
      await prisma.$disconnect();
      redis.disconnect();
      console.log("Shutdown complete");
      process.exit(0);
    });
    setTimeout(() => {
      console.error("Forced shutdown after 10s timeout");
      process.exit(1);
    }, 10_000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};

start();

// Export app for testing with supertest
export default app;
```

- [ ] **Step 7: Update `.env.example` with all required variables**

```
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ecom_db
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=your-random-64-character-secret-here
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
STRIPE_SECRET_KEY=sk_test_your_stripe_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
CLIENT_URL=http://localhost:3000
```

- [ ] **Step 8: Run full test suite**

```bash
cd apps/backend
pnpm test
# Expect: all unit + integration tests PASS

pnpm typecheck
# Expect: 0 errors
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: pagination helper, server hardening (health check, graceful shutdown), final polish"
```
