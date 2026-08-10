<<<<<<< HEAD
# DOS_API
=======
# CAPI

CAPI is a Cloudflare Workers API scaffold inspired by the Royal SRC documentation exposed in the workspace.

## Features

- Worker router for admin, lookup, network and user-facing API paths.
- Method-level slot controls plus user API concurrency limits.
- JSON-only responses with the same conceptual route names as the API contract.
- Wrangler-ready package configuration for local development and deployment.

## New slot feature

- Methods can now define `max_slots` in the payload configuration.
- `max_slots` limits how many active attacks can run concurrently for that method overall.
- User-specific `max_concurrents` still limits how many attacks each user may launch at the same time.
- Example: if a user has 2 active concurrents and the method has `max_slots: 5`, the user cannot send more than 2 without waiting because their own limit is reached.
- Once a running attack expires, the user may launch new attacks on the same method or other methods as long as limits allow.

## Discord bot

The Discord bot runs separately from the Cloudflare Worker and must be started on a machine that has network access and valid bot credentials.

Environment variables:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID` (optional for guild-scoped slash commands)
- `API_BASE_URL` (optional; defaults to `https://capi.insideproxy.me`)

Start the bot with:

```bash
npm run bot
```

If you prefer a `.env` file, create one from `.env.example` and store the same variables.

## Discord interactions on Cloudflare

This project now supports a Cloudflare Worker-based Discord interaction endpoint for slash command verification and role assignment.

Environment variables for Cloudflare:

- `DISCORD_PUBLIC_KEY` - App public key from Discord Developer Portal
- `DISCORD_BOT_TOKEN` - Bot token for role assignment requests
- `DISCORD_GUILD_ID` - Target guild/server ID for role assignment

The Worker route is available at:

- `POST /interactions`
- `POST /discord`

This means you do not need a persistent gateway bot on a VPS to handle Discord slash command callbacks.

If you still want gateway behavior or live presence, use `CAPI/src/discord-bot.js` separately.

## Routes

- GET /api/network_statistics
- GET /api/view_plan
- GET /api/view_ongoing
- GET /api/attack
- GET /api/stop
- GET /admin/add_user
- GET /admin/edit_user
- GET /admin/delete_user
- GET /admin/view_user_logs
- GET /admin/view_user_plan
- GET /admin/view_all_logs
- GET /admin/view_all_users
- GET /admin/key_info
- GET /lookup/lookup_fivem
- GET /lookup/lookup_mc

## Local development

npm install
npm run dev

## Deployment

npm run deploy

## Cloudflare services setup (optional but recommended)

1. Create a D1 database for users/logs:

```bash
wrangler d1 create capi_db
# then bind it by name in wrangler.toml (already present)
```

2. Create an R2 bucket for user assets:

```bash
wrangler r2 bucket create capi-assets
```

3. Create a KV namespace for small key-values:

```bash
wrangler kv:namespace create CAPI_KV
```

4. Add or paste the created KV id into `wrangler.toml` under `[[kv_namespaces]]` `id`.

After creating D1/R2/KV, run `npm run dev` to test locally with `wrangler dev`.
>>>>>>> f3a8ea9 (Initial commit)
