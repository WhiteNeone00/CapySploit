# CAPI API Endpoints

This document lists the HTTP endpoints implemented by CAPI, grouped by route. It shows expected method (mostly GET), query parameters, auth requirements, and example response shapes.

> Note: avoid sending credentials in URLs for production. The project currently accepts admin credentials in query params (legacy). Prefer POST or Authorization headers.

---

## Base routes
- `/api/<action>` - Public API actions
- `/admin/<action>` - Admin actions (requires admin `username` and `password` query params)
- `/lookup/<type>` - External lookup helpers
- `/discord` or `/interactions` - Discord interaction handlers (Discord signatures required)

---

## /api endpoints
All endpoints under `/api` generally respond with JSON and include `error`, `message`, and data where applicable.

### `GET /api/view_profile`
- Query params: `username` (optional)
- Returns: profile object for the user. Example data shape:

```json
{
  "error": false,
  "message": "profile loaded",
  "data": {
    "profile": {
      "username": "alice",
      "admin": false,
      "vip": true,
      "holder": false,
      "api_access": true,
      "max_time": 60,
      "min_time": 30,
      "concurrents": 1,
      "max_concurrents": 1,
      "max_daily_attacks": 100,
      "suspended": false,
      "warnings": 1,
      "discord_link": { /* minimal link status */ }
    }
  }
}
```

### `GET /api/view_plan`
- Query params: `username`
- Returns plan info for the user (similar to `view_profile`) with numeric `warnings` field.

### `GET /api/discord_profile`
- Query params: `discord_user_id` (required)
- Returns the linked profile for the Discord user. If not linked: 404 with `message`.

### `GET /api/link`
- Query params: `code`, `discord_user_id`, `discord_username`, `client=discord`
- Purpose: create a verification link binding a CAPI user to a Discord ID.
- Response: `{ error: false, message: 'verification code generated', client, code, expires_at }` or errors.

### `GET /api/unlink`
- Query params: `discord_user_id` (or `discord_id`, `user_id`)
- Unlinks a Discord account. Returns success message and `discord_username`.

### `GET /api/verify`
- Query params: `username`, `password`, `client` (e.g., `discord`)
- Auth endpoint used during linking flow. Returns verification/status data.

### `GET /api/attack`
- Query params (either bot-auth or credentials):
  - `username` (optional; may be set via bot auth)
  - `password` or `pass` (required if not using bot auth)
  - `host` or `ip` (target)
  - `port`
  - `time`
  - `method`
  - `discord_user_id` (when using `BOT_API_KEY` bearer token to impersonate linked user)
- Auth:
  - Normal users: provide `username` + `password` (query currently)
  - Bot: provide `Authorization: Bearer <BOT_API_KEY>` header and `discord_user_id` to act on behalf of a linked user
- Response (success): `error: false, message: 'attack accepted', data: { ... attack details ... }`
- On blacklist: returns `makePolishedError('blacklisted target', 403, {...})` and increments warnings.

### `GET /api/stop`
- Query params: `id` or `host` and `username`
- Stops an ongoing attack (simulated). Returns `{ error: false, kill_id: <id> }`.

### `GET /api/view_ongoing`
- Returns current running attacks; usage internal.

### `GET /api/network_statistics`
- Returns service statistics (slot counts, user counts, etc.)

---

## /admin endpoints
Admin routes require `username` and `password` query params for admin authentication.

### `GET /admin/add_user`
- Params: `username_to_add`, `password_to_add` (optional), flags like `vip`, `reseller`, `max_time`, etc.
- Response: `{ error: false, message: 'user added', user: { username } }`

### `GET /admin/edit_user`
- Params: `user_to_edit`, `field_to_edit`, `new_value`
- Response: `{ error: false, message: 'user updated' }`

### `GET /admin/delete_user`
- Params: `user_to_delete`
- Response: `{ error: false, message: 'user removed' }`

### `GET /admin/view_user_logs`
- Params: `user_to_view`
- Response: `{ error: false, data: { user, logs } }`

### `GET /admin/view_user_plan`
- Params: `user_to_view` (admin credentials required)
- Returns detailed user object with booleans properly serialized (true/false). Example excerpt:

```json
{
  "error": false,
  "message": "user plan loaded",
  "data": {
    "user": {
      "username": "root",
      "admin": true,
      "reseller": false,
      "vip": false,
      "holder": false,
      "api_access": true,
      "suspended": false,
      "warnings": 0
    }
  }
}
```

### `GET /admin/unlink_discord`
- Params: `user_to_unlink` (admin auth)
- Response: success message and `discord_user_id`/`discord_username` info.

### `GET /admin/view_all_logs`, `GET /admin/view_all_users`
- Returns lists of logs and users.

### `GET /admin/suspend_user` and `GET /admin/unsuspend_user`
- Suspend or unsuspend a user. `unsuspend_user` clears warnings and clears suspension.

Additional admin endpoints: `add_api`, `list_apis`, `delete_api`, `add_method`, `list_methods`, `add_blacklist`, `list_blacklist`, `remove_blacklist`, `syntax_check`, `key_info`.

---

## /lookup endpoints
### `GET /lookup/lookup_fivem` (or `lookup_cfx`)
- Params: `cfx_code` (or `code`)
- Returns JSON from FiveM servers API.

### `GET /lookup/lookup_mc` (or `lookup_minecraft`)
- Params: `server_address` (or `address`, `host`)
- Returns Minecraft server status and optional IP info.

### `GET /lookup/lookup_ip`
- Params: `server_address` or `host` or `ip`
- Returns IP location and ASN info from ip-api or equivalent.

---

## Discord integration
- `/discord/register` - registers slash commands (requires `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`)
- Discord interactions are validated via `DISCORD_PUBLIC_KEY` signature checking.
- The bot uses `BOT_API_KEY` environment variable for server-authorized actions; keep it secret (not in query strings).

---

## Auth and security notes
- Current code stores passwords in plain `users.password` and compares strings. This is insecure; migrate to hashed passwords (bcrypt/argon2).
- Admin and verify flows accept credentials in query params. Consider switching to POST and using headers.
- `BOT_API_KEY` allows impersonation of linked users—protect this key carefully.

---

## How this file was generated
- Extracted from `src/api.js`, `src/admin.js`, `src/lookup.js`, and related helpers.

---

If you'd like, I can:
- Expand each endpoint with full example requests and full sample responses,
- Move admin auth to header-based authentication,
- Create OpenAPI spec (swagger) from these handlers.

