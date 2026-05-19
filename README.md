# 📸 Image App (Distributed Social Platform)

[![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node.js-6DA55F?style=flat&logo=node.js&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/react-%2320232a.svg?style=flat&logo=react&logoColor=%2361DAFB)](https://reactjs.org/)
[![Redis](https://img.shields.io/badge/redis-%23DD0031.svg?style=flat&logo=redis&logoColor=white)](https://redis.io/)
[![MongoDB](https://img.shields.io/badge/MongoDB-%234ea94b.svg?style=flat&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=flat&logo=docker&logoColor=white)](https://www.docker.com/)
[![Prometheus](https://img.shields.io/badge/Prometheus-E6522C?style=flat&logo=Prometheus&logoColor=white)](https://prometheus.io/)
[![Grafana](https://img.shields.io/badge/Grafana-F46800?style=flat&logo=Grafana&logoColor=white)](https://grafana.com/)

## 🚀 Overview

**Image App** is a full-stack social platform that explores scalability and performance patterns beyond a typical CRUD app. The backend currently uses **CQRS** (Command Query Responsibility Segregation), a **transactional outbox** for async side effects, and **multi-layered caching**.

The architecture is designed to handle high-concurrency scenarios (e.g., viral posts) by decoupling write-heavy operations from read-critical views using background workers and Redis streams.

---

## 🏗 System Architecture

The application transitions from a monolithic structure to a microservices-ready architecture, featuring:

* **API Gateway:** A dedicated entry point handling rate-limiting, CORS, and request routing.
* **Backend Core:** Node.js/Express service implementing **CQRS** via `tsyringe` for dependency injection.
* **Worker Nodes:**
    * `Trending Worker`: Calculates viral content scores in the background.
    * `Profile Sync Worker`: Handles eventual consistency updates across denormalized data (e.g., updating user avatars across thousands of historical posts).
* **Persistence Layer:** MongoDB Replica Set (supporting multi-document transactions) and Redis (Caching, Pub/Sub, Streams).

## 📚 Project Review

The long-form architecture and project review is documented in [docs/project-review.md](docs/project-review.md). It covers the backend/runtime bootstrap, CQRS wiring, Unit of Work and outbox patterns, Redis cache and pub/sub usage, worker topology, frontend data flow, deployment shape, and the major tradeoffs in the current design.

## 📈⚡Performance & Scalability 

The repository includes targeted stress testing, but the figures below should be treated as directional until more scenario-specific load suites are checked in:
* **Concurrency:** Successfully handles 200+ concurrent users performing complex write workflows (Register → Post → Like → Follow) simultaneously.
* **Throughput:** Sustains hundreds of requests per second (RPS) with sub-second P99 latency.
* **Background Processing:** The worker nodes independently scale to process thousands of viral interactions without blocking the main API.

### 📐 Key Engineering Decisions

#### 1. Partitioned Feed Architecture & Caching
Instead of simple database queries, the Feed Service implements a **"Push-Pull" hybrid model**:
* **Fan-out on Write:** When a post is created, post IDs are pushed to followers' feeds (Redis Sorted Sets) asynchronously.
* **Two-Layer Caching:**
    * **Core Feed:** Caches the *structure* (IDs and order) with long TTLs.
    * **Enrichment Layer:** Caches mutable data (User profiles, Like counts) separately.
    * *Result:* Changing an avatar doesn't invalidate the entire feed cache, significantly reducing database load.

#### 2. Advanced Redis Patterns
The `RedisService` goes beyond basic key-value storage:
* **Tag-Based Invalidation:** Uses Sets to map logical tags to cache keys, allowing precise O(1) invalidation of complex dependency trees.
* **Write-Behind Caching:** High-velocity counters (likes/views) are buffered in Redis and flushed to MongoDB in batches.
* **Pub/Sub & Streams:** Handles real-time notifications (Socket.io) and decoupling of background jobs.

#### 3. CQRS & Event-Driven Design
* **Command Bus:** Handles writes (e.g., `CreatePostCommand`) ensuring data integrity via Unit of Work transactions.
* **Event Bus:** Triggers side effects (Notifications, Analytics) *after* successful transaction commits to prevent ghost data.
* **Separation of Concerns:** Read models (DTOs) are optimized for specific UI views, distinct from Domain Models.
  
#### 4. Resilient Transaction Orchestration
* To ensure data integrity under high concurrency, the system implements a custom Resiliency Layer on top of MongoDB transactions:
* **Transaction Queueing:** TransactionQueueService serializes conflicting write operations to prevent race conditions during "thundering herd" scenarios.
* **Smart Retries:** A RetryService with exponential backoff handles transient database failures (like WriteConflict exceptions), ensuring user requests succeed even when the database is under stress.
* **ACID Compliance:** All side effects (notifications, feed updates) are strictly coupled to transaction commits via the UnitOfWork pattern.

#### 5. Observability & Monitoring
* The system is instrumented for real-time production monitoring:
* **Prometheus:** Scrapes application metrics (HTTP latency, database connection pool status, worker queue depth).
* **Grafana:** Provides visual dashboards for tracking system health and identifying bottlenecks during load spikes.
* **Async workflow visibility:** Outbox events now carry event-level trace IDs and worker outcome metrics, so failed background dispatches can be tied back to a concrete outbox record and log entry.
---

## ⚖️ Architecture Trade-offs & Lessons Learned

Some of the backend patterns here are intentionally more ambitious than the current product size strictly requires. That has been useful for learning and for preparing hot paths, but it also adds real maintenance cost.

* **CQRS is helping, but not every flow needed it yet.** The split has made controllers thinner and write paths easier to reason about, but some handlers still own too much orchestration. In a few places, a simpler application service would still be easier to maintain until the read/write paths diverge more.
* **The outbox is intentional, not full event sourcing.** The backend persists side effects after a successful transaction commit, which protects consistency for async work. It does **not** rebuild aggregates from an event store, so calling the current design "event sourcing" would be overstating it.
* **Redis-heavy optimization only pays off when it is measured.** Feed caching, dynamic TTLs, and Bloom-filter-style protections reduce hot-path load, but they only justify their complexity when backed by repeatable load tests rather than intuition.
* **Current tracing is targeted, not distributed tracing.** The repo now records outbox event trace IDs and Prometheus metrics for async dispatch outcomes, which helps debug worker failures. That is still lighter-weight than a full OpenTelemetry-style end-to-end trace pipeline.
* **Operational simplicity still matters.** Several patterns in this codebase exist because the goal is to practice taming complexity, not because every deployment would need them on day one. The long-term bar is not "more patterns"; it is proving which ones are worth their ongoing cost.

---

## 🛠 Tech Stack

### Backend
* **Runtime:** Node.js (v20+), TypeScript
* **Framework:** Express.js
* **Database:** MongoDB (Mongoose with schema validation & sanitization)
* **Caching/Message Broker:** Redis (node-redis)
* **Architecture:** DI (TSyringe), Repository Pattern, CQRS
* **Testing:** Mocha, Chai, Sinon

### Frontend
* **Framework:** React (Vite)
* **Styling:** TailwindCSS, Material UI (MUI)
* **State Management:** React Query (TanStack Query)
* **Real-time:** Socket.io Client
* **Testing:** Cypress (E2E)

### Infrastructure
* **Containerization:** Docker & Docker Compose
* **Proxy:** Nginx
* **Storage:** Cloudinary (Production) / Local Filesystem (Dev)
* **Monitoring:** Prometheus & Grafana
---

## ⚡ Getting Started

### Prerequisites
* Docker & Docker Compose installed
* Node.js v18+ (for local dev)

  
### Quick Start (Docker)
The easiest way to run the full stack (Database, Redis, API, Workers, Frontend):

```bash
# 1. Clone the repository
git clone [https://github.com/danzin/image-app.git](https://github.com/danzin/image-app.git)
cd image-app

# 2. Start the services
docker-compose up --build
```

### Access the application:

* Frontend: http://localhost:80
* API Gateway: http://localhost:8000
* Direct Backend: http://localhost:3000
* Grafana Dashboards: http://localhost:3001 
* Prometheus: http://localhost:9090
  
## Local Development (Monorepo)
The project uses `concurrently` to run the Backend, API Gateway, Frontend, and Workers simultaneously from the root.
1. Setup Environment
* Create a .env file in the root directory:
```
MONGODB_URI=your://local@or@remote:mongodb.connectionString
JWT_SECRET=your_jwt_secret_here
# CLOUDINARY_... (Optional)
PORT=3000
FRONTEND_URL=http://localhost:5173
VITE_API_URL=http://localhost:8000
```
2. Install & Run
```
# Install dependencies for all workspaces (backend, frontend, gateway)
npm install

# Start the development environment
# This launches Backend, Gateway, Frontend, Trending Worker, and Profile Worker
npm run dev
```

## 🛡 Security Features

* **JWT Authentication:** Secure, HTTP-only cookie-based auth strategy.
* **Rate Limiting:** IP-based throttling at the API Gateway level.
* **Secure Recovery:** Token-based Password Reset flow with short-lived expiry (via Resend). 
* **Input Sanitization:** Custom sanitizers for NoSQL injection and XSS prevention.
* **Role-Based Access Control (RBAC):** Middleware-enforced Admin and User roles.

