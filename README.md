# Ascendance

> A full-stack social platform built to explore the problems that show up beyond CRUD.

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev/)
[![MongoDB](https://img.shields.io/badge/MongoDB-13AA52?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Redis](https://img.shields.io/badge/Redis-D92C20?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![Prometheus](https://img.shields.io/badge/Prometheus-E6522C?style=for-the-badge&logo=prometheus&logoColor=white)](https://prometheus.io/)
[![Grafana](https://img.shields.io/badge/Grafana-F46800?style=for-the-badge&logo=grafana&logoColor=white)](https://grafana.com/)

Ascendance is the product name in the UI. `image-app` is the repository name.

## About The Project

This is not a landing page portfolio project and it's not a wrapper around a database. Ascendance is a social product with real-time messaging, notifications, communities, favorites, profile management, admin tooling, multilingual UI, background processing, and production-style monitoring.

The repo is intentionally opinionated where it matters:

- CQRS on the backend for clearer read/write flows.
- Transaction-aware side effects through an outbox worker.
- Redis used for more than caching: sessions, fan-out support, notification state, and hot-path protection.
- Frontend instrumentation, lazy route loading, and i18n built into the app shell.
- Dockerized local and production-oriented deployment flows.

## What Changed Recently

The README was falling behind the codebase. The current project shape is:

- No dedicated API gateway anymore. The frontend container serves the built React app and proxies API, upload, WebSocket, and telemetry traffic directly to the backend.
- The monorepo now centers on two workspaces: `backend` and `frontend`.
- Workers can run in-process during app startup, or as a dedicated `backend-worker` container in Docker deployments.
- Backend internals have been moving toward specialized read/write repositories instead of broader generic repository abstractions.
- Request correlation IDs, telemetry ingestion, and stronger async workflow observability were added to improve debugging and operations.
- The frontend has expanded with communities, messaging, notifications, admin views, richer profile UX, and browser-language-aware internationalization.

## Architecture At A Glance

```mermaid
flowchart LR
  U[User Browser] --> F[Frontend Container\nNginx serving the built React app]
  F -->|proxies /api, /api/uploads, /socket.io, /telemetry| B[Backend API\nExpress + TypeScript + Socket.IO]
  B --> M[(MongoDB Replica Set)]
  B --> R[(Redis)]
  W[Worker Runtime\nOutbox + Trending + Profile Sync + Feed Warm Cache + IP Monitor] --> M
  W --> R
  P[Prometheus] -. scrapes /metrics .-> B
  G[Grafana] -. queries .-> P
```

This is the containerized runtime view. In local development, the Vite dev server replaces the frontend container and proxies to the dynamically selected backend port. In production compose, an outer edge/TLS layer can sit in front of the frontend container, but it is omitted here so the primary application runtime stays readable.

### Production Edge View

```mermaid
flowchart LR
  U[User Browser] --> CF[Cloudflare]
  CF --> C[Caddy Edge\nTLS termination + trusted proxy handling]
  C -->|main app domain| F[Frontend Container\nNginx]
  F -->|/api, /api/uploads, /socket.io, /telemetry| B[Backend API]
  C -->|prometheus subdomain| P[Prometheus]
  C -->|grafana subdomain| G[Grafana]
  P -. scrapes /metrics .-> B
```

The production edge is more specific than the runtime view above: Caddy terminates TLS, trusts Cloudflare proxy headers, forwards the real client IP downstream, sends app traffic to the frontend container, and exposes Prometheus and Grafana on separate subdomains.

### Current Runtime Shape

| Layer       | What runs now                                | Why it matters                                                                        |
| ----------- | -------------------------------------------- | ------------------------------------------------------------------------------------- |
| Edge (prod) | Cloudflare-aware Caddy ingress               | TLS termination, trusted proxy handling, and subdomain routing for app and monitoring |
| Frontend    | Nginx serving the built React app            | Handles static delivery and same-origin proxying without a separate gateway           |
| API         | Express + Socket.IO backend                  | HTTP API, auth, uploads, read/write flows, real-time events, telemetry                |
| Workers     | Same backend codebase, separate runtime mode | Isolates async processing and lets the API stay focused on request handling           |
| Data        | MongoDB replica set + Redis                  | Transactions, caching, session state, queue-like coordination                         |
| Monitoring  | Prometheus + Grafana                         | Prometheus scrapes backend metrics and Grafana queries them for dashboards            |

## Product Surface

Ascendance currently includes:

- Personalized home feed and discovery flows.
- Communities and community membership views.
- Post creation, favorites, comments, and post detail pages.
- Real-time messaging and notifications.
- Rich profile editing, follow graphs, avatar and cover updates.
- Admin dashboard and per-user admin detail screens.
- English and Bulgarian UI localization.

## Engineering Highlights

### Backend

- TypeScript + Express with `tsyringe`-based dependency injection.
- CQRS-style application layer with commands, queries, handlers, and bus wiring.
- Transaction-aware Unit of Work patterns on MongoDB.
- Outbox processing with correlation IDs and resumable handler progress.
- Redis-backed session management, cache coordination, and real-time support.
- Health, metrics, telemetry, and request logging surfaces for debugging and operations.

### Frontend

- React 18 + Vite + TypeScript.
- Route-level lazy loading and error boundaries in the app shell.
- TanStack Query for server-state orchestration.
- Material UI plus TailwindCSS for UI composition.
- Socket.IO client integration for live features.
- i18next-based language detection and translation resources.

### Infra And Operations

- Docker Compose for local full-stack startup.
- Separate production-oriented Compose file.
- Production ingress uses Caddy for TLS termination, trusted proxy handling, and routing to the app plus monitoring subdomains.
- Prometheus and Grafana included in-repo.
- Nginx serving the built frontend and proxying API, uploads, telemetry, and WebSocket traffic directly to the backend.

## Trade-Offs, On Purpose

This codebase deliberately explores patterns that are more advanced than the smallest version of the product would need. That is part of the point.

- CQRS improves clarity in several hot paths, but it also raises the maintenance bar.
- The outbox protects consistency for async work, but it adds operational surface area.
- Redis-heavy optimizations only justify themselves when measured.
- Dedicated workers simplify scaling and isolation, but they make deployment shape more explicit.

The value here is not "more architecture." The value is demonstrating where that architecture helps, where it costs, and how to keep the tradeoffs visible.

## Tech Stack

| Area     | Stack                                                                                        |
| -------- | -------------------------------------------------------------------------------------------- |
| Frontend | React, Vite, TypeScript, TanStack Query, Material UI, TailwindCSS, Socket.IO client, i18next |
| Backend  | Node.js, Express, TypeScript, TSyringe, Mongoose, Redis, Socket.IO, Zod, Winston             |
| Testing  | Mocha, Chai, Sinon, Supertest, Cypress                                                       |
| Infra    | Docker, Docker Compose, Nginx, Prometheus, Grafana                                           |
| Storage  | MongoDB, Redis, Cloudinary in production, local uploads in development                       |

## Running The Project

### Prerequisites

- Node.js 20+ recommended.
- Docker and Docker Compose for containerized startup.
- MongoDB and Redis access if you are running locally without Docker.

### Quick Start With Docker

```bash
git clone https://github.com/sunsetstack/ascendance-social.git
cd ascendance-social
docker compose up --build
```

After startup:

- App: `http://localhost`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3001`

The backend health endpoint is available internally to the stack at `/health` and is exposed directly during local non-Docker development.

### Local Development

Create a root `.env` with the values your backend needs.

```env
MONGODB_URI=mongodb://...
REDIS_URL=redis://localhost:6379
JWT_SECRET=replace-me
PORT=8000
FRONTEND_URL=http://localhost:5173
MONGO_INITDB_ROOT_USERNAME=replace-me
MONGO_INITDB_ROOT_PASSWORD=replace-me

GF_SECURITY_ADMIN_PASSWORD=replace-me
GF_SECURITY_ADMIN_USER=replace-me
REDIS_PASSWORD=replace-me
ADMIN_EMAILS=replace-me
VITE_API_URL=http://localhost:8000
VITE_SOCKET_URL=http://localhost:8000
DNS_SERVERS=1.1.1.1,8.8.8.8

```

Then install dependencies and start the workspace:

```bash
npm install
npm run dev
```

What `npm run dev` does now:

- Picks the first available backend port from a small candidate list.
- Writes that port to root `.env.local` and `frontend/.env.local`.
- Starts the backend API.
- Starts the trending, profile sync, and feed warm-cache workers.
- Starts the Vite frontend.

That means local dev no longer depends on a dedicated gateway process. The frontend proxies to whichever backend port was selected.

### Useful Scripts

```bash
# build everything
npm run build

# backend tests
npm run test-backend

# backend integration suite
npm run test-integration

# frontend production build
npm run build:frontend
```

## Security And Reliability Notes

- Hybrid JWT + Redis session model with refresh-token rotation.
- Rate limiting, secure cookies, and hardened proxy headers.
- Input sanitization and validation layers on the backend.
- Health endpoints and metrics endpoints for runtime checks.
- Correlation ID propagation through requests, logs, and async outbox work.

## Repository Structure

```text
.
├── backend/      # API, CQRS application layer, workers, data access, tests
├── frontend/     # React client, screens, shared UI, i18n, telemetry
├── monitoring/   # Prometheus configuration
├── scripts/      # local-dev helpers such as dynamic port selection
├── docker-compose.yml
└── docker-compose-prod.yml
```
