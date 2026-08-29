# CAPI

CAPI is a control-plane API and service backend for managing user accounts, plan metadata, attack orchestration, Discord verification, and operational monitoring. It is designed to sit behind a lightweight request router and expose a clean JSON API for both public consumers and privileged admin flows.

This project is tailored for a service that needs:

- user authentication and plan verification
- Discord account linking and verification
- attack launch and ongoing status tracking
- admin control of users, methods, and plan policy
- rate limiting, maintenance mode, and operational monitoring

In short: it is the API layer that powers the live service experience and exposes the runtime data needed by bots, dashboards, and admin tooling.

---

## What this project does

CAPI is not just a static docs repo or a mock server. It is a working API that can:

- validate users and manage access to protected endpoints
- inspect and return user plan information such as cooldowns, limits, expiry, and ranking
- expose public operational stats like current attack load and system health
- support Discord-based verification and account linking flows
- manage attack lifecycle data and method metadata
- provide admin tools for users, plans, warnings, logs, and maintenance
- serve lookup endpoints for IP/domain/FiveM/Minecraft metadata

The runtime is structured around a request router in `src/orchestrator.js`, with the API logic split into route handlers in `src/api.js`, `src/admin.js`, and `src/lookup.js`.

---

## Why it exists

This service exists to centralize all operational logic behind one public API contract instead of spreading logic across multiple disconnected scripts. By doing so, it gives the project these advantages:

- a single response contract across endpoints
- consistent auth and rate-limiting behavior
- easier bot integration via Discord or bearer-token authentication
- cleaner admin controls and user policy handling
- predictable monitoring and error reporting

---

## Architecture at a glance

```text
HTTP request
   ↓
src/orchestrator.js
   ↓
  /api/*     -> src/api.js
  /admin/*   -> src/admin.js
  /lookup/*  -> src/lookup.js
   ↓
shared helpers / DB / settings / policy layers
   ↓
JSON response + metadata + logging
```

### Core files

- `src/orchestrator.js` — top-level request router and route dispatch
- `src/api.js` — public API endpoints and user-facing flows
- `src/admin.js` — admin-only management and verification flows
- `src/lookup.js` — lookup and metadata enrichment endpoints
- `src/response.js` — shared JSON formatting and error construction
- `src/vault-db.js` — database access and persisted user/method/plan state
- `src/helpers.js` — rate limiting, cache, request validation, cooldowns, auth tracking
- `src/config.js` — service metadata, default config, ads, messages, hints
- `payload.js` — method payload definitions and public method catalog
- `test/` — regression tests for response shape and API behavior

---

## Deployment

This project is designed to run as a backend service behind a lightweight server or worker runtime.

### Typical deployment shapes

1. Cloudflare-style worker environment
   - request entrypoint lives at a worker/edge boundary
   - `src/orchestrator.js` handles routing and delegates to handlers

2. Node-based server runtime
   - run behind a lightweight HTTP server or reverse proxy
   - pass requests into the same request dispatcher

3. Internal/private control-plane deployment
   - deploy behind a private domain or internal gateway
   - use bearer-token bot auth and user/password flows for trusted automation

### Requirements

- Node.js runtime
- SQLite-backed storage or equivalent database layer used by the Vault layer
- environment variables for service name, bot auth, API config, and DB access
- a request router or custom web entrypoint that passes incoming requests into the orchestrator

### Local development

```bash
cd /var/www/CAPI
npm install
npm test
npm run dev
```

---

## Route groups

### Root route

```http
GET /
```

Returns service metadata, health/status information, and the list of supported action groups.

### Public API routes

Common endpoints include:

- `/api/network_statistics`
- `/api/graph`
- `/api/methods`
- `/api/discord_profile`
- `/api/verify`
- `/api/link`
- `/api/unlink`
- `/api/view_plan`
- `/api/view_ongoing`
- `/api/my_attacks`
- `/api/attack`
- `/api/stop`

These routes are used for operational checks, plan inspection, auth, Discord claims, and attack tracking.

### Methods response shape

```json
{
  "error": false,
  "message": "public methods loaded",
  "data": [
    {
      "id": 1,
      "name": "udp",
      "description": "UDP flood attack",
      "target_type": "ip",
      "default_port": 80,
      "min_time": 10,
      "max_time": 600,
      "max_concurrents": 3,
      "max_slots": 10
    }
  ],
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

### Admin routes

Admin routes live under `/admin/...` and require valid admin-level auth. They cover:

- user creation and editing
- password management
- plan and method editing
- log viewing
- user suspension actions
- maintenance and service settings

### Lookup routes

Lookup endpoints under `/lookup/...` are used for:

- IP lookup and enrichment
- domain lookup
- FiveM server info
- Minecraft profile-related metadata

---

## Response contract

The project follows one consistent JSON contract across most routes:

```json
{
  "error": false,
  "message": "User plan retrieved successfully.",
  "data": {
    "username": "alice",
    "admin": false,
    "vip": true,
    "holder": false
  },
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

### Response ordering rules

The API keeps a strict order for readability and consistency:

1. `error`
2. `message`
3. `hint` (when present)
4. any custom data fields
5. metadata fields such as `timestamp`, `service`, `version`, `ads`

This means the client can reliably parse JSON without dealing with mislabeled nested wrappers or noisy extra auth counters.

### Important behavior

- `attempts` and `limit` are intentionally omitted from auth failures in the final response payload
- nested wrappers such as `data.profile` are flattened when they are redundant
- `view_plan` is the canonical plan response and is kept direct and compact

---

## Authentication and authorization

The API supports multiple auth patterns depending on the route:

### Username/password auth

```text
?username=alice&password=secret123
```

### Bot auth via bearer token

```text
Authorization: Bearer <BOT_API_KEY>
```

### Discord-linked impersonation

Some flows allow a bot or trusted client to act on behalf of a verified Discord-linked user, providing a smoother integration path for chat or automation tools.

---

## Example endpoint usage

### Get service status

```bash
curl "https://your-capi-host/"
```

### View user plan

```bash
curl "https://your-capi-host/api/view_plan?username=alice&password=secret123"
```

### Get public stats

```bash
curl "https://your-capi-host/api/network_statistics"
```

### Verify Discord account link

```bash
curl "https://your-capi-host/api/verify?username=alice&password=secret123&client=discord"
```

---

## Developer notes

- All response helpers are centralized for consistent payload ordering and metadata injection.
- The system keeps rate limiting and cooldown logic in the shared helpers so routes behave similarly.
- The codebase was written to keep the API contract stable for both frontend and Discord bot consumers.
- For live API examples, see [API_ENDPOINTS.md](API_ENDPOINTS.md) and [API_RESPONSE.md](API_RESPONSE.md).

---

## License

This repository is intended for internal/project use and is not a public package release unless explicitly stated otherwise.
