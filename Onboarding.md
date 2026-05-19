# Peek Social - Developer Onboarding and Architecture Reference

## Welcome

This repository is a social platform with:

- a React SPA frontend
- an Express + MongoDB + Redis backend
- Socket.IO for real-time updates
- background workers for async and cache-heavy workloads
- Dockerized deployment, proxying, and monitoring

The codebase is intentionally more architectural than a simple CRUD app. It mixes classic service-layer code with a custom CQRS stack, Redis-backed caching, an outbox worker, and several feed/read optimizations.

## What the system is trying to optimize

The hot paths in this project are not just "save a post" and "load a page". The implementation is designed around:

1. keeping writes transactional when multiple collections change together
2. keeping reads fast through Redis caches and precomputed structures
3. moving slow or bursty work out of the request path
4. keeping horizontally scaled backend nodes consistent enough through Redis

That is why you will see **CQRS, Unit of Work, outbox, Redis sorted sets, streams, pub/sub, tag-based invalidation, cursor pagination, adaptive TTLs, and bloom filters** all in the same repository.

---

## Runtime topology

### End-to-end request flow

```text
Browser
  |
  +--> Static SPA assets
  |      served by frontend Nginx
  |
  +--> /api/*
  |      proxied by frontend Nginx to backend
  |      (this includes `/api/telemetry`)
  |
  +--> /socket.io/*
         proxied by frontend Nginx with WebSocket upgrade

frontend/nginx.conf
  |
  +--> backend Express app
  |      - auth
  |      - CQRS / legacy services
  |      - metrics
  |      - telemetry ingestion
  |
  +--> Socket.IO server
         - Redis adapter for multi-node fanout

backend
  |
  +--> MongoDB replica set
  +--> Redis
         - sessions
         - rate limiting
         - caches
         - sorted sets
         - streams
         - pub/sub
         - activity metrics

workers
  |
  +--> Redis streams / pub-sub / cache updates
  +--> MongoDB reads
```

### Actual deployment surfaces in this repo

| Surface             | What it does                                                  | Main files                                                                                  |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Root monorepo       | npm workspaces for `backend` and `frontend`                   | `package.json`                                                                              |
| Backend HTTP/API    | Express server, metrics, auth, routes, WebSocket bootstrap    | `backend/src/main.ts`, `backend/src/server/server.ts`, `backend/src/server/socketServer.ts` |
| Frontend SPA        | React 18 app with React Query and Socket.IO client            | `frontend/src/main.tsx`, `frontend/src/App.tsx`                                             |
| Frontend edge proxy | SPA routing, static asset caching, API and WebSocket proxying | `frontend/nginx.conf`                                                                       |
| Background workers  | Trending, profile sync, new-feed warming, IP monitor, outbox  | `backend/src/workers/*`                                                                     |
| Database            | MongoDB replica set required for transactions                 | `docker-compose*.yml`, `mongo-rs-init.sh`                                                   |
| Cache/broker        | Redis for cache, sessions, streams, pub/sub, rate limiting    | `backend/src/services/redis.service.ts`                                                     |
| Monitoring          | Prometheus scrapes backend metrics; Grafana visualizes them   | `monitoring/prometheus.yml`, `docker-compose*.yml`                                          |

### Important runtime nuance

The two compose files represent **different topologies**, not a clean dev/prod split:

- `docker-compose.yml` uses prebuilt GHCR images, a passworded Redis, and adds a **Caddy** layer in front of the app.
- `docker-compose-prod.yml` builds backend/frontend locally, exposes Mongo/Redis ports directly, and serves the frontend on port 80 through the frontend container itself.

Also note that `docker-compose.yml` references a `Caddyfile`, but **no `Caddyfile` exists in the repo right now**.

---

## Project structure

```text
root/
├── backend/
│   ├── src/
│   │   ├── application/         # CQRS commands, queries, events, handlers
│   │   ├── config/              # db, cache, cors, cookie, bloom, rate limit
│   │   ├── controllers/         # HTTP controllers
│   │   ├── database/            # UnitOfWork and session propagation
│   │   ├── di/                  # TSyringe registration and CQRS wiring
│   │   ├── metrics/             # Prometheus metrics service
│   │   ├── middleware/          # auth, request logging, admin guards
│   │   ├── models/              # Mongoose schemas
│   │   ├── repositories/        # MongoDB data access and aggregations
│   │   ├── routes/              # Express routers
│   │   ├── server/              # Express + Socket.IO bootstrap
│   │   ├── services/            # legacy services and Redis facade
│   │   ├── utils/               # helpers, cache key builders, cursor codec
│   │   └── workers/             # worker entrypoints and implementations
│   ├── backend.Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── api/                 # axios-based API clients
│   │   ├── components/          # reusable UI
│   │   ├── context/             # auth and socket providers
│   │   ├── hooks/               # React Query and UI hooks
│   │   ├── lib/                 # telemetry, SEO, media helpers
│   │   ├── screens/             # route-level pages
│   │   ├── theme/               # MUI theme
│   │   └── i18n.ts              # English/Bulgarian translations
│   ├── nginx.conf
│   ├── frontend.Dockerfile
│   └── package.json
├── monitoring/
│   └── prometheus.yml
├── docker-compose.yml
├── docker-compose-prod.yml
└── mongo-rs-init.sh
```

---

## Backend architecture

### 1. Bootstrap and process model

The backend starts in `backend/src/main.ts`.

Startup order:

1. register core DI
2. connect MongoDB
3. initialize CQRS handlers and subscriptions
4. optionally start workers
5. optionally start Express + Socket.IO

The backend supports **two execution modes**:

- **single process mode**: one Node.js process runs the API and in-process workers
- **split process mode**: one process/container runs the API and another runs workers

This is controlled by `ENABLE_API` and `ENABLE_WORKERS`.

### 2. Dependency injection

The project uses **TSyringe** and central registration under `backend/src/di/`.

Key registration files:

- `container.ts` - overall bootstrap
- `core.di.ts` - models, core infrastructure
- `repositories.di.ts` - repository bindings
- `services.di.ts` - service bindings
- `routes.di.ts` - route/controller wiring
- `handlers.di.ts` - command, query, and event handler registration

This makes the CQRS buses, repositories, services, and routes resolve through a common container.

### 3. HTTP layer and middleware

`backend/src/server/server.ts` builds the Express app.

Key middleware responsibilities:

- `helmet` security headers
- CORS with environment-driven allowlist
- Redis-backed global rate limiting
- Prometheus HTTP metrics
- cookie parsing
- JSON / urlencoded parsing
- request logging and request-log persistence

Main non-API endpoints:

- `/health`
- `/metrics`
- `/uploads/*`

Main API namespaces:

| Route prefix         | Responsibility                                           |
| -------------------- | -------------------------------------------------------- |
| `/api/users`         | auth, profile, who-to-follow, account management         |
| `/api/posts`         | post CRUD, feed-adjacent post actions                    |
| `/api/images`        | legacy image endpoints                                   |
| `/api/search`        | search                                                   |
| `/api/admin`         | admin operations                                         |
| `/api/notifications` | notification reads and state changes                     |
| `/api/feed`          | personalized, for-you, trending, new feed, trending tags |
| `/api/favorites`     | saved/favorited posts                                    |
| `/api/messaging`     | conversations and messages                               |
| `/api/communities`   | communities and membership                               |
| `/api/telemetry`     | frontend telemetry ingest and admin summary              |

### 3.5 Error handling model

Error handling is centralized around `backend/src/utils/errors.ts`.

Core ideas:

- domain/application code throws `AppError` subclasses rather than ad-hoc errors
- errors can carry:
  - HTTP status
  - machine-readable `ErrorCode`
  - structured context
  - original `cause`
- `wrapError(...)` preserves known app errors and wraps unknown failures safely
- `handleMongoError(...)` translates Mongo/Mongoose failures like duplicate keys and cast errors into app-level errors

The global Express error boundary is `ErrorHandler.handleError`.

It:

1. normalizes unknown errors into `AppError`
2. emits error metrics through the metrics callback
3. logs rich diagnostic context
4. returns a consistent JSON error shape

Important response behavior:

- in non-production, stack traces, cause details, and extra context can be included
- in production, responses are reduced to the public error payload

The frontend then does a second pass in `frontend/src/api/axiosClient.ts` to sanitize some backend/internal wording before it reaches the user-facing UI.

### 4. CQRS, but not everywhere

The repo has a **custom CQRS implementation**, not a framework-provided one.

Core pieces:

- `application/common/buses/command.bus.ts`
- `application/common/buses/query.bus.ts`
- `application/common/buses/event.bus.ts`

Current state:

- many reads and writes already go through **command/query handlers**
- some controllers still call **legacy services directly**
- the feed controller is a good example of mixed mode:
  - personalized / for-you / trending use the **query bus**
  - new feed still goes through the legacy `FeedService`

Treat the backend as **CQRS-first but not CQRS-only**.

### 4.5 Repository layer and read/write boundaries

The repository layer sits underneath both CQRS handlers and legacy services.

Important characteristics:

- repositories live in `backend/src/repositories/*`
- many capabilities are split into **read** and **write** interfaces or implementations
- the container binds these through explicit DI tokens
- repositories are where most Mongo query logic, aggregation pipelines, and session-aware persistence live

Representative separations:

- `PostReadRepository` vs `PostWriteRepository`
- `UserReadRepository` vs `UserWriteRepository`
- `FeedReadDao` for aggregation-heavy feed reads
- `OutboxRepository` for transactional event persistence

Repositories are also coupled to the Unit of Work through session propagation, so transaction-aware writes do not have to pass the Mongo session manually through every call.

### 5. Unit of Work and transaction model

`backend/src/database/UnitOfWork.ts` is one of the most important files in the repository.

What it does:

- wraps MongoDB `withTransaction`
- uses **AsyncLocalStorage** to propagate the current Mongo session to repositories
- limits concurrent writes with a semaphore
- limits concurrent reads with a separate semaphore
- retries transient transaction failures with exponential backoff + jitter
- exposes internal transaction metrics

Important transaction settings:

- `readPreference: primary`
- `readConcern: snapshot`
- `writeConcern: majority`
- bounded commit time

This is more than a convenience wrapper. It is the repository's main **consistency boundary**.

### 6. Eventing and the outbox

The backend has **two event dispatch modes**:

1. **Immediate publish** with `EventBus.publish(...)`
2. **Transactional outbox** with `EventBus.queueTransactional(...)`

Use the outbox path when side effects must happen **only after the Mongo transaction commits**.

Outbox pieces:

- model: `backend/src/models/outbox.model.ts`
- repository: `backend/src/repositories/outbox.repository.ts`
- worker: `backend/src/workers/outbox.worker.ts`

The outbox record stores:

- `eventType`
- `payload`
- `traceId`
- `processed`
- `retries`
- `processedAt`

The outbox worker polls pending events, replays them through `publishByType`, tracks success/failure metrics, and increments retry counts on failure.

### 6.5 This is not event sourcing

The project uses **event-driven side effects** and a **transactional outbox**, but it is **not an event-sourced system**.

What exists:

- domain/application events trigger follow-up work
- some events are persisted in the outbox to survive crashes and only dispatch after commit
- Redis streams and pub/sub move async work through the system

What does **not** exist:

- aggregates rebuilt from an append-only event log
- an event store as the primary source of truth
- replay-based state reconstruction for core domain entities

The source of truth is still MongoDB documents and collections, not an event stream.

### 7. WebSocket and horizontal real-time fanout

`backend/src/server/socketServer.ts` attaches Socket.IO to the HTTP server.

Important details:

- auth is reused from the HTTP bearer-token middleware
- cookies are parsed on socket requests
- handshake auth token is supported as a fallback
- each authenticated user joins a private room named after their public ID
- active conversation IDs are tracked on the socket to support messaging UX
- Socket.IO uses the **Redis adapter**, so multiple backend nodes can emit coherently

The bridge between Redis pub/sub and Socket.IO lives in `services/feed/real-time-feed.service.ts`.

### 8. Worker model

Workers are long-running background loops over Redis or timed refresh logic.

| Worker                     | What it does                                                                                                   | Main file                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Trending worker            | consumes `stream:interactions`, batches post interaction deltas, recomputes scores, writes trending sorted set | `workers/_impl/trending.worker.impl.ts`         |
| Profile sync worker        | propagates profile snapshot changes into denormalized content                                                  | `workers/_impl/profile-sync.worker.impl.ts`     |
| New feed warm-cache worker | prewarms first pages of the chronological feed                                                                 | `workers/_impl/newFeedWarmCache.worker.impl.ts` |
| IP monitor worker          | monitors suspicious IP activity / operational signals                                                          | `workers/_impl/ip-monitor.worker.impl.ts`       |
| Outbox worker              | dispatches persisted transactional events                                                                      | `workers/outbox.worker.ts`                      |

Important behavioral detail: `main.ts` logs worker startup failures but does **not** crash the API if they fail to start.

### 9. Redis usage by concern

Redis is not one thing in this repo. It plays several different roles.

| Concern                  | Pattern                                  | Example keys / channels                                                 |
| ------------------------ | ---------------------------------------- | ----------------------------------------------------------------------- |
| Auth sessions            | server-backed session store              | `session:{sid}`, `user:sessions:{publicId}`                             |
| Rate limiting            | Redis-backed `express-rate-limit` store  | `rate-limit:global:*`                                                   |
| General cache            | JSON values with TTL                     | `user_data:*`, `post_meta:*`, `new_feed:*`, `trending_feed:*`           |
| Tag invalidation         | reverse index from tag to cache keys     | `tag:{tag}`, `key_tags:{cacheKey}`                                      |
| Per-user feed structures | sorted sets for fanout-on-write feed IDs | `feed:for_you:{userId}`                                                 |
| Trending feed structure  | sorted set of post IDs by score          | `trending:global`                                                       |
| Notifications            | list + hash structure                    | `notifications:user:{userId}`, `notification:{id}`                      |
| Pub/sub                  | ephemeral cross-node events              | `feed_updates`, `messaging_updates`, `profile_snapshot_updates`         |
| Streams                  | durable interaction pipeline             | `stream:interactions`, consumer group `trendingGroup`                   |
| Bloom filters            | probabilistic membership checks          | `bf:usernames:v1`, `bf:global-post-views:v1:{date}`                     |
| Activity metrics         | adaptive TTL inputs and recent activity  | `who_to_follow:activity_metrics`, `who_to_follow:recently_active_users` |

### 10. Redis design patterns in use

#### Cache-aside

Read path:

1. try Redis
2. on miss, run MongoDB query/aggregation
3. store result back in Redis
4. return response

This is used heavily in feed reads and tag/user metadata caching.

#### Tag-based invalidation

`RedisService.setWithTags()` writes the cache entry and also stores reverse links from tags to keys.

This allows targeted invalidation like:

- all feed caches for one user
- all trending-feed caches
- all caches affected by a profile or avatar change

#### Fan-out on write

For for-you feeds, Redis sorted sets are used as a **prebuilt feed index**. When a post is created, the system can push that post ID into follower feed ZSETs instead of reconstructing every follower feed at read time.

#### Streams for durable async work

Interaction events are appended to `stream:interactions` and consumed by the trending worker using a consumer group. This gives replayability and stalled-message reclaim that pub/sub alone would not provide.

#### Pub/sub for ephemeral real-time updates

Pub/sub is used for live notifications and cross-node real-time signals where persistence is not required.

#### Bloom filters

Bloom filters are implemented in `services/redis/bloom-filter.service.ts` and are actually used in production code:

- registration: fast username existence pre-check
- post views: fast probabilistic duplicate-view suppression before hitting the DB uniqueness path

### 11. Feed architecture

The feed system is the most architecture-heavy part of the backend.

Main pieces:

- `services/feed/feed-read.service.ts`
- `services/feed/feed-core.service.ts`
- `services/feed/feed-enrichment.service.ts`
- `services/feed/feed-interaction.service.ts`
- `repositories/read/FeedReadDao.ts`

#### Core / enrichment split

The system separates:

- **core feed**: IDs, ordering, scores, cursor state
- **enrichment**: fresh user/profile/post meta data

That allows longer-lived core caches without forcing stale avatars, usernames, or counters.

#### Personalized feed

The personalized feed is a **two-phase** read:

1. personalized phase: followed users and favorite tags
2. backfill phase: recent global posts once personalized supply dries up

The cursor stores the phase, so the frontend stays stateless.

#### New feed

The new feed supports both:

- skip-based pagination
- cursor pagination using `createdAt + _id`

Cursor mode is the preferred deep-pagination path.

#### Trending feed

Trending can be served through:

- cached page reads
- cursor pagination over computed trend score
- Redis sorted-set structures maintained by the trending worker

#### Read-time streaming

The feed controller can stream larger feed payloads using `streamCursorResponse` / `streamPaginatedResponse` when the result crosses `STREAM_THRESHOLD`.

### 12. MongoDB read model and aggregation patterns

MongoDB aggregations are concentrated mostly in repositories, especially `FeedReadDao`.

#### Aggregation-heavy areas

| Area                  | What the aggregation does                                                                | Main file                                 |
| --------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------- |
| Personalized feed     | matches followed users and favorite tags, joins denormalized data, handles phase changes | `repositories/read/FeedReadDao.ts`        |
| New feed              | chronological aggregation, optionally with `$facet` for count + page in one round trip   | `repositories/read/FeedReadDao.ts`        |
| Trending feed         | computes recency, popularity, comment-based scores                                       | `repositories/read/FeedReadDao.ts`        |
| Ranked feed           | computes weighted ranking using recency + popularity + tag overlap                       | `repositories/read/FeedReadDao.ts`        |
| Trending tags         | unwinds tags, joins `tags`, groups by tag name, computes engagement-weighted trend score | `repositories/read/FeedReadDao.ts`        |
| Conversations         | joins last message and sender and supports cursor pagination                             | `repositories/conversation.repository.ts` |
| Who to follow         | multiple aggregation strategies based on traffic level                                   | `repositories/user.repository.ts`         |
| Request-log analytics | simple operational aggregation like average response time                                | `repositories/requestLog.repository.ts`   |

#### Feed aggregation strategy details

The feed DAO is doing several things that matter operationally:

- deterministic cursor pagination using compound sort keys
- `$lookup` only after the page window is narrowed
- weighted score computation inside the pipeline
- limited use of `$facet` where total counts are worth the memory tradeoff
- explicit fallback from personalized to backfill rather than attempting one huge monolithic query

### 13. Adaptive TTL and recommendation heuristics

The repo uses **activity-based caching** instead of fixed TTLs everywhere.

Relevant files:

- `config/cacheConfig.ts`
- `services/user-activity.service.ts`
- `application/queries/tags/getTrendingTags/getTrendingTags.handler.ts`

Examples:

- trending tags widen the lookback window when the site is quiet, then choose a TTL based on recent tag activity
- who-to-follow recommendations use tracked posting activity and recent active users to switch strategy and TTL

### 14. Authentication and session model

Authentication is a hybrid of **JWT + Redis session state**.

Key ideas:

- access token is short-lived
- refresh token is opaque and server-validated
- refresh token hash is stored in Redis
- every session has a stable `sid`
- sessions can be revoked individually or per user
- rotation has a grace window to handle concurrent refreshes safely

Important file: `services/auth-session.service.ts`

This means auth is **not purely stateless JWT auth**. Redis is part of the trust boundary.

### 15. Observability

There are **two separate observability layers**:

1. **Operational metrics** via Prometheus
2. **Product telemetry** via custom frontend events

Operational metrics are exposed from `metrics.service.ts` and include:

- HTTP request count and latency
- worker state / restarts
- Redis connection state
- optional-auth failure counts
- outbox queue size, batch size, and processing duration

Frontend product telemetry is sent to `/api/telemetry`, validated, aggregated in-memory in 5-minute buckets, and exposed to admins through `/api/telemetry/summary`.

### 16. TypeScript patterns, branded types, and type boundaries

The backend uses TypeScript as more than a compile-to-JavaScript convenience layer. Several files make the intended type boundaries explicit.

#### Branded ID and auth types

`backend/src/types/branded.ts` defines nominal-style branded types so the code does not casually mix structurally identical strings.

Examples:

- `UserPublicId`
- `PostPublicId`
- `MongoId`
- `SessionId`
- `RefreshTokenHash`

Why this matters:

- external IDs and internal IDs are both strings at runtime
- branding helps prevent passing a `publicId` where an internal Mongo ID is expected
- auth/session values get similar protection

The `as*` helpers in that file are intentionally limited to **trusted boundaries** like validated request params, JWT payloads, DB results, and ID-generation sites.

#### Typed HTTP contracts

`backend/src/types/customCore/http.types.ts` defines `TypedRequest` and related helper types for controller signatures.

Important caveat documented in the code itself:

- `TypedRequest` is still a contract layered on top of Express, not a magically complete end-to-end type guarantee
- it is only safe when the validation and middleware chain actually enforces the expected shape

So the codebase uses TypeScript for stronger contracts, but it also documents where those contracts are only as strong as runtime validation.

#### API-layer type-safety boundary

At the HTTP boundary, the repo is closest to a **parse, don't validate** style.

The main mechanism is `backend/src/middleware/validation.middleware.ts`, which calls Zod `parseAsync(...)` on:

- `req.body`
- `req.query`
- `req.params`

That means route handlers receive **parsed / transformed values**, not just unchecked raw strings.

Examples of parsing/transformation at the API layer:

- `z.coerce.number()` turns query strings into numbers
- `.default(...)` supplies canonical defaults
- `.transform(...)` applies normalization and sanitization
- `.strict()` rejects unexpected keys
- schemas such as `registrationSchema`, `loginSchema`, `handleSuggestionsSchema`, and feed query schemas normalize data before controllers use it

There is also security-aware parsing at this boundary:

- `sanitizeForMongo(...)` removes dangerous Mongo-style operator keys
- `sanitizeTextInput(...)` trims and sanitizes text inputs
- auth middleware parses JWT payloads into a typed `DecodedUser` and brands `publicId` / `sid`

So for the API layer, the philosophy is not just "check if the input looks okay"; it is often "parse it into the shape the app wants, or fail".

#### Repository-layer type-safety boundary

The repository layer is type-aware, but it is **not a pure parse-don't-validate system**.

What it does well:

- repository interfaces use branded identifiers like `UserPublicId`, `PostPublicId`, and `MongoId`
- read/write repository splits make call sites more explicit
- CQRS handlers often convert external IDs to safer internal forms before deeper persistence work

What is still mixed:

- some repository methods still accept raw `string` or `mongoose.Types.ObjectId`
- some command handlers perform manual guards such as `isValidPublicId(...)`
- some JWT and request payload checks are still written as explicit runtime conditionals

So the repo-level boundary is better described as:

- **stronger nominal typing and explicit interfaces where practical**
- **plus runtime validation/guards where Mongoose, Express, and legacy code still force it**

That is a meaningful safety layer, but not a perfectly uniform nominal-type system from edge to storage.

#### Parse, don't validate: accurate characterization

The codebase **partially follows** the parse-don't-validate philosophy.

Where it clearly does:

- Zod-powered route schemas that parse/coerce/transform request data
- auth middleware that constructs a typed `DecodedUser` only after payload shape checks
- branded cast helpers used at trusted boundaries after parsing/verification
- factory-style normalization such as `UserFactory.createFromRegistration(...)`

Where it does not fully follow the philosophy:

- some command handlers still do classic guard-style checks after data enters the application layer
- repository signatures are not fully branded end-to-end because of Mongoose/ObjectId interoperability
- some sanitization/validation utilities still operate as explicit runtime validators rather than typed parsers

So the best summary is:

- **API boundary:** relatively close to parse-don't-validate
- **application/repository boundary:** mixed, improving, but not pure

#### DI token typing

`backend/src/types/tokens.ts` centralizes the token registry for controllers, repositories, services, CQRS handlers, routes, and models.

This reduces stringly-typed container wiring drift and makes DI registration more maintainable.

#### DTOs and exported type surface

`backend/src/types/index.ts` re-exports the application type surface, including DTOs, pagination contracts, auth types, core HTTP types, and branded types.

That lets controllers, handlers, services, and repositories share a common vocabulary for:

- input contracts
- DTO output shapes
- pagination/result envelopes
- decoded auth payloads
- branded identifiers

---

## Frontend architecture

### 1. Boot sequence and provider tree

Frontend entrypoints:

- `frontend/src/main.tsx`
- `frontend/src/App.tsx`

Provider tree:

```text
HelmetProvider
  -> ThemeProvider
  -> CssBaseline
  -> BrowserRouter
  -> QueryClientProvider
  -> AuthProvider
  -> SocketProvider
  -> FeedSocketManager
  -> Suspense
  -> Routes
```

This tells you where global behavior lives:

- SEO metadata: `HelmetProvider`
- look and feel: `ThemeProvider`
- server state: React Query
- auth mutation helpers: `AuthProvider`
- sockets: `SocketProvider`
- cache invalidation on live events: `FeedSocketManager`

### 2. Routing

All routes are declared in `frontend/src/App.tsx`.

There is one shared shell route using `Layout`, with a mix of:

- public routes
- protected routes
- admin-only routes

Representative pages:

- home, discover, communities
- login/register/forgot/reset/verify-email
- profile and follow lists
- post view and comment thread view
- favorites, messages, notifications, settings
- admin dashboard and admin user detail

### 3. Auth model on the frontend

The frontend does **not** own auth state in a separate Redux slice.

Instead:

- current user is primarily treated as **React Query server state**
- `useAuth()` derives auth state from `["currentUser"]`
- `AuthProvider` just exposes login/logout helpers around that cache
- `axiosClient` performs centralized refresh-on-401 logic

Important detail: the axios interceptor also sanitizes some backend error wording before surfacing it to the UI.

### 4. API layer

The frontend API layer is organized by feature under `frontend/src/api/`.

| Module                      | Responsibility                                          |
| --------------------------- | ------------------------------------------------------- |
| `axiosClient.ts`            | shared axios instance, `withCredentials`, refresh retry |
| `userApi.ts`                | auth, profile, account, follow actions                  |
| `postApi.ts` / `feedApi.ts` | feed and post retrieval                                 |
| `messagingApi.ts`           | messaging                                               |
| `notificationApi.ts`        | notifications                                           |
| `communityApi.ts`           | communities                                             |
| `adminApi.ts`               | admin dashboards, request logs, telemetry               |
| `imageApi.ts`               | uploads and media endpoints                             |

### 5. React Query usage

React Query is the main server-state layer across the app.

Patterns used throughout hooks:

- `useInfiniteQuery` for feeds and notifications
- targeted invalidation after mutations
- optimistic cache updates for selected live counters
- shared query-key namespaces such as:
  - `["currentUser"]`
  - `["user", ...]`
  - `["notifications"]`
  - `["messaging", ...]`
  - feed keys like `["personalizedFeed"]`, `["forYouFeed"]`, `["trendingFeed"]`, `["newFeed"]`

### 6. Socket integration

The socket client lives in `context/Socket/SocketProvider.tsx`.

Behavior:

- only connects when a user is logged in
- defaults to same-origin socket URL in proxied deployments
- uses `/socket.io`
- supports websocket and polling transports
- reconnects automatically

Live event wiring is split by domain:

- feed events -> `hooks/feeds/useFeedSocketIntegration.ts`
- messaging events -> `hooks/messaging/useMessagingSocketIntegration.ts`
- notification live updates -> `hooks/notifications/useNotification.ts`

Most socket events invalidate or mutate React Query cache entries rather than storing a parallel socket-only state tree.

### 7. Layout and responsive behavior

`components/Layout.tsx` is the top-level shell.

Behavior split:

- mobile uses `MobileLayout`
- desktop uses sidebars and a central content column
- unverified users are locked into the verification flow
- messages/admin/settings intentionally alter shell layout width and scrolling behavior

The mobile UI has its own dedicated structure:

- `MobileLayout`
- `MobileDrawer`
- `MobileHeader`
- `MobileFAB`
- `BottomNav`

This is not just CSS shrinking; it is a separate composition path.

### 8. UI stack

The frontend uses a blended UI approach:

- **MUI** for theme, layout primitives, dialogs, forms, tabs, cards
- **TailwindCSS** utility support and general styling infrastructure
- **Framer Motion** for selected animated interactions

The theme lives in `theme/theme.ts` and is currently a dark theme with app-wide MUI overrides.

### 9. i18n, SEO, and telemetry

#### i18n

`frontend/src/i18n.ts` defines translations and currently supports **English and Bulgarian**.

#### SEO

`frontend/src/lib/seo.tsx` builds page-level metadata. Route screens call `PageSeo` helpers for profile, discovery, community, post, home, and search pages.

#### Product telemetry

`frontend/src/lib/telemetry.ts` tracks:

- time to first interaction
- flow starts / completions / abandons
- feed scroll depth

Telemetry is batched client-side and sent with `fetch` or `navigator.sendBeacon`.

The admin dashboard exposes the aggregated summary via the telemetry tab.

---

## Infrastructure and deployment

### 1. Dockerfiles

#### Backend image

`backend/backend.Dockerfile`:

- installs workspace dependencies at the repo root
- builds the backend workspace
- copies compiled output into a production Node image
- runs as a non-root user
- exposes port 3000

#### Frontend image

`frontend/frontend.Dockerfile`:

- builds the frontend with Vite
- injects `VITE_API_URL` and `VITE_SOCKET_URL` at build time
- serves the built SPA from `nginx:alpine`
- installs `frontend/nginx.conf` as the runtime config

### 2. MongoDB topology

Transactions require a replica set, so the Docker topology bootstraps Mongo in several steps:

1. generate keyfile
2. start Mongo with `--replSet rs0`
3. run `mongo-rs-init.sh`
4. wait for PRIMARY before letting dependents continue

This is why Docker is the easiest way to get a working backend setup.

### 3. Redis deployment differences

Be aware of environment differences:

- `docker-compose.yml` uses passworded Redis and persistent storage
- `docker-compose-prod.yml` exposes Redis directly and does not mirror the same auth setup
- local non-Docker fallback in code uses `redis://127.0.0.1:6379`

### 4. Proxying and edge behavior

#### Frontend Nginx

`frontend/nginx.conf` is responsible for:

- SPA fallback routing
- long-lived caching for hashed static assets
- no-cache behavior for `index.html`
- reverse proxy for `/api/*`
- reverse proxy for `/socket.io/*`
- direct proxy rules also exist for `/telemetry` and `/telemetry/*`
- upload path rewriting for `/api/uploads/*`
- least-connection upstream balancing to the `backend` service

#### Caddy

`docker-compose.yml` adds a Caddy container on ports 80/443, but the referenced `Caddyfile` is currently missing from the repo. If you are debugging the compose topology, treat that as an incomplete edge layer.

### 5. Monitoring

Prometheus currently scrapes only:

- `backend:3000/metrics`

Grafana is wired on top of that.

This means the monitoring stack is currently **backend-centric**. There is no Redis exporter or Mongo exporter configured here.

---

## Design patterns used in the repo

| Pattern                  | Where it shows up                                       |
| ------------------------ | ------------------------------------------------------- |
| Dependency Injection     | TSyringe registrations under `backend/src/di`           |
| Repository Pattern       | `backend/src/repositories/*`                            |
| CQRS                     | `backend/src/application/commands`, `queries`, `events` |
| Unit of Work             | `backend/src/database/UnitOfWork.ts`                    |
| Transactional Outbox     | `EventBus.queueTransactional`, outbox worker            |
| Cache-aside              | feed reads, trending tags, who-to-follow                |
| Fan-out on write         | Redis per-user feed sorted sets                         |
| Read-time hydration      | core feed + enrichment split                            |
| Cursor pagination        | feeds and conversations                                 |
| Consumer-group streaming | trending worker over Redis streams                      |
| Pub/sub fanout           | live feed/messaging/profile updates                     |
| Adaptive TTL             | trending tags and who-to-follow                         |
| Bloom filters            | username and post-view checks                           |

---

## Important identifiers and conventions

| Identifier  | Meaning                                                        |
| ----------- | -------------------------------------------------------------- |
| Mongo `_id` | internal database identifier                                   |
| `publicId`  | external stable ID used across DTOs, URLs, and socket payloads |
| `handle`    | user-facing stable handle                                      |
| `sid`       | Redis-backed auth session ID                                   |

Other important conventions:

- feeds and many other reads are cursor-capable even when legacy page/limit variants still exist
- Redis caches usually store JSON, not hashes, unless the structure is intentionally list/hash based
- events can be immediate or transactional; do not assume every event uses the outbox

---

## Known caveats and mismatches

1. **Docs vs code:** `README.md` still talks about an API gateway, but the current codebase routes through frontend Nginx and, in one compose topology, Caddy.
2. **Worker duplication risk in local dev:** `backend/src/main.ts` starts in-process workers by default, while the root `npm run dev` script also launches separate worker processes. Unless env flags disable one side, local dev can double-run worker responsibilities.
3. **Caddy config gap:** `docker-compose.yml` references a `Caddyfile` that is not present.
4. **Mixed architecture:** some controllers and services still use legacy service-layer orchestration rather than going through command/query handlers.
5. **Telemetry storage is in-memory:** backend telemetry summaries are not persisted to a long-term analytics store.
6. **Monitoring is partial:** only backend Prometheus metrics are configured out of the box.

---

## Useful commands

From the repo root:

```bash
npm install
npm run dev
npm run build
npm run build:backend
npm run build:frontend
npm run test-backend
npm run test-integration
docker-compose up --build
```

Backend-only:

```bash
npm run start-backend
npm run start-trending-worker
npm run start-profile-sync-worker
npm run start-newFeed-worker
```

---

## Recommended onboarding read order

If you want to understand the system quickly, read in this order:

1. `backend/src/main.ts`
2. `backend/src/server/server.ts`
3. `backend/src/server/socketServer.ts`
4. `backend/src/database/UnitOfWork.ts`
5. `backend/src/application/common/buses/event.bus.ts`
6. `backend/src/repositories/read/FeedReadDao.ts`
7. `backend/src/services/redis.service.ts`
8. `backend/src/workers/_impl/trending.worker.impl.ts`
9. `frontend/src/main.tsx`
10. `frontend/src/App.tsx`
11. `frontend/src/api/axiosClient.ts`
12. `frontend/src/components/Layout.tsx`
13. `frontend/src/hooks/feeds/useFeedSocketIntegration.ts`
14. `frontend/nginx.conf`
15. `docker-compose.yml`
16. `docker-compose-prod.yml`

That path gives you the process model, the request path, the consistency model, the caching model, the real-time model, and the deployment model in roughly the right order.
