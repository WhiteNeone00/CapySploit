# API Response Reference

This document contains the real response contract for the CAPI service, including success and error payloads in pretty-printed JSON. The examples are written to match the live runtime behavior of the project and to be easy to inspect in documentation or debugging tools.

---

## Response conventions

Every JSON response follows the same base contract:

```json
{
  "error": false,
  "message": "Operation completed successfully.",
  "hint": "Optional guidance if the request needs clarification.",
  "data": {
    "example_field": "value"
  },
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

### Important rules

- `error` is always first.
- `message` is always second.
- `hint` appears after `message` when relevant.
- `data` is a direct object, not a nested `data.profile` or `data.user` wrapper unless the endpoint specifically requires it.
- metadata such as `timestamp`, `service`, `version`, and `ads` are appended after the payload itself.
- `attempts` and `limit` are intentionally omitted from the final auth error payload.

---

## Root response

### GET /

Success (200):

```json
{
  "name": "CAPI",
  "version": "1.0.0",
  "status": "ok",
  "uptime": "0d 0h 0m 14s",
  "uptime_started_at": "2026-08-29T16:13:55.223Z",
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "description": "CAPI / CapySploit control plane with attack routing, admin controls, and lookup helpers.",
  "endpoints": {
    "api": "/api/<action>",
    "admin": "/admin/<action>",
    "lookup": "/lookup/<type>"
  },
  "available_actions": [
    "view_plan",
    "attack",
    "view_ongoing",
    "my_attacks",
    "network_statistics",
    "list_methods",
    "syntax_check"
  ]
}
```

Error (maintenance mode):

```json
{
  "error": true,
  "message": "API routes are temporarily disabled while maintenance mode is active.",
  "status": "maintenance",
  "maintenance_mode": true,
  "service": "CAPI",
  "hint": "Only administrative routes remain available during maintenance.",
  "timestamp": "2026-08-29T16:13:55.223Z",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

---

## Public API responses

### GET /api/network_statistics

Success (200):

```json
{
  "error": false,
  "message": "Network statistics retrieved successfully.",
  "data": {
    "online_users_count": 23,
    "total_users_count": 142,
    "active_users_count": 23,
    "vip_users_count": 8,
    "holder_users_count": 12,
    "reseller_users_count": 4,
    "suspended_users_count": 2,
    "expired_users_count": 0,
    "attacks_are_enabled": true,
    "total_ongoing_attacks": 3,
    "total_attacks_today": 102,
    "total_warning_count": 0,
    "verified_discord_users_count": 41,
    "max_attack_api_slots": 30,
    "health_status": "stable",
    "maintenance_mode": false,
    "src_name": "CAPI",
    "src_uptime": "0d 0h 0m 14s"
  },
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

---

### GET /api/methods

Success (200):

```json
{
  "error": false,
  "message": "public methods loaded",
  "data": {
    "methods": [
      {
        "id": 1,
        "name": "udp",
        "description": "UDP flood attack",
        "target_type": "ip",
        "default_port": 80,
        "max_time": 600,
        "max_concurrents": 5,
        "max_slots": 10
      },
      {
        "id": 2,
        "name": "tcp",
        "description": "TCP connection attack",
        "target_type": "ip",
        "default_port": 80,
        "max_time": 300,
        "max_concurrents": 3,
        "max_slots": 8
      }
    ]
  },
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

---

### GET /api/discord_profile?discord_user_id=<id>

Success (200):

```json
{
  "error": false,
  "message": "discord profile loaded",
  "data": {
    "username": "alice",
    "admin": false,
    "vip": true,
    "holder": false,
    "reseller": false,
    "max_time": 600,
    "cooldown": 10,
    "max_concurrents": 4,
    "max_daily_attacks": 100,
    "suspended": false,
    "suspend_reason": null,
    "suspended_by": null,
    "service_name": "CAPI",
    "resellers_service": false,
    "expiry_unix": 1828897873,
    "is_banned": false,
    "powered_saving": true,
    "anti_spam": true,
    "bypass_blacklist": false,
    "api": true,
    "mfa_enabled": false,
    "account_status": "active",
    "warnings": 0,
    "discord_link": {
      "discord_user_id": "123456789012345678",
      "discord_username": "alice#1234",
      "verified_at": "2026-08-29T16:13:55.223Z"
    }
  },
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

Error (not linked):

```json
{
  "error": true,
  "message": "Discord account not linked. Use /link to verify your account first; /plan is only available for linked users.",
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

Error (missing discord_user_id):

```json
{
  "error": true,
  "message": "missing discord_user_id",
  "hint": "Provide discord_user_id to lookup your linked profile.",
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

---

### GET /api/verify?username=&password=&client=discord

Success (200):

```json
{
  "error": false,
  "message": "verification code generated",
  "client": "discord",
  "code": "A1B2C3",
  "expires_at": "2026-08-29T16:23:55.223Z",
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

Error (wrong password):

```json
{
  "error": true,
  "message": "wrong password",
  "client": "discord",
  "code": null,
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

---

### GET /api/link?code=&discord_user_id=&discord_username=

Success (200):

```json
{
  "error": false,
  "message": "discord account verified",
  "client": "discord",
  "code": "A1B2C3",
  "discord_user_id": "123456789012345678",
  "username": "alice",
  "roles": [
    "vip",
    "member"
  ],
  "plan_role": "vip",
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

Error (already linked):

```json
{
  "error": true,
  "message": "This Discord account is already linked. Use /unlink first, then run /link again with a new code.",
  "client": "discord",
  "code": null,
  "discord_link": {
    "username": "alice",
    "discord_user_id": "123456789012345678",
    "discord_username": "alice#1234"
  },
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

---

### GET /api/unlink?discord_user_id=<id>

Success (200):

```json
{
  "error": false,
  "message": "Discord account unlinked successfully.",
  "discord_user_id": "123456789012345678",
  "discord_username": "alice#1234",
  "username": "alice",
  "unlinked_at": "2026-08-29T16:13:55.223Z",
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

Error (not linked):

```json
{
  "error": true,
  "message": "Discord account is not currently linked. Use /link to verify first.",
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

---

### GET /api/view_plan?username=&password=

Success (200):

```json
{
  "error": false,
  "message": "User plan retrieved successfully.",
  "data": {
    "username": "alice",
    "admin": false,
    "vip": true,
    "holder": false,
    "reseller": false,
    "owner": false,
    "api": true,
    "max_time": 600,
    "min_time": 30,
    "cooldown": 10,
    "concurrents": 4,
    "max_daily_attacks": 100,
    "attacks_remaining": 78,
    "powersaving": true,
    "bypass_anti_spam": true,
    "bypass_blacklist": false,
    "suspended": false,
    "created_by": "root",
    "creation_date": "2026-08-02 19:11:13",
    "expiry_unix": 1828897873,
    "formatted_expiry": "15-12-2027 19:11:13",
    "service_name": "CAPI",
    "warnings": 0,
    "plan_type": "VIP",
    "rank": "VIP",
    "discord_linked": "123456789012345678"
  },
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

Error (invalid credentials):

```json
{
  "error": true,
  "message": "invalid credentials",
  "hint": "4 attempts remaining before account lock.",
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

---

### GET /api/view_ongoing?username=&password=

Success (200):

```json
{
  "error": false,
  "message": "Ongoing attacks retrieved successfully.",
  "data": [
    {
      "target": "203.0.113.7",
      "method": "udp",
      "port": 80,
      "length": 60,
      "finish": "14 secs"
    },
    {
      "target": "203.0.113.9",
      "method": "tcp",
      "port": 8080,
      "length": 120,
      "finish": "55 secs"
    }
  ],
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

Empty state:

```json
{
  "error": false,
  "message": "No ongoing attacks found",
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

---

### GET /api/my_attacks?username=&password=

Success (200):

```json
{
  "error": false,
  "message": "Attack history retrieved",
  "data": {
    "username": "alice",
    "total_attacks": 12,
    "page_size": 100,
    "page_offset": 0,
    "attacks": [
      {
        "index": 1,
        "target": "203.0.113.7",
        "method": "udp",
        "port": 80,
        "duration": 60,
        "status": "completed",
        "created_at": "2026-08-29T16:13:55.223Z"
      }
    ]
  },
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

---

### POST /api/attack

Success (200):

```json
{
  "error": false,
  "message": "Attack launched successfully.",
  "data": {
    "attack_id": "atk_12345",
    "target": "203.0.113.7",
    "port": 80,
    "method": "udp",
    "duration": 60,
    "status": "launched"
  },
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

Error (invalid target):

```json
{
  "error": true,
  "message": "invalid target",
  "hint": "The target host or IP address is not valid for this attack route.",
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

---

## Admin responses

### /admin/view_user_plan?username=&password=&user_to_view=

Success (200):

```json
{
  "error": false,
  "message": "User plan retrieved successfully.",
  "data": {
    "username": "alice",
    "admin": false,
    "vip": true,
    "holder": false,
    "reseller": false,
    "owner": false,
    "api": true,
    "max_time": 600,
    "min_time": 30,
    "cooldown": 10,
    "concurrents": 4,
    "max_daily_attacks": 100,
    "attacks_remaining": 78,
    "powersaving": true,
    "bypass_anti_spam": true,
    "bypass_blacklist": false,
    "suspended": false,
    "created_by": "root",
    "creation_date": "2026-08-02 19:11:13",
    "expiry_unix": 1828897873,
    "formatted_expiry": "15-12-2027 19:11:13",
    "service_name": "CAPI",
    "warnings": 0,
    "plan_type": "VIP",
    "rank": "VIP",
    "discord_linked": "123456789012345678"
  },
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

Error (missing credentials):

```json
{
  "error": true,
  "message": "missing credentials",
  "hint": "Provide username and password for this API route.",
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

---

## Lookup responses

### /lookup/lookup_ip?ip=1.1.1.1

Success (200):

```json
{
  "error": false,
  "message": "IP lookup successful.",
  "data": {
    "ip": "1.1.1.1",
    "country": "United States",
    "region": "California",
    "city": "Los Angeles",
    "asn": "AS13335",
    "org": "Cloudflare, Inc."
  },
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

Error (bad IP input):

```json
{
  "error": true,
  "message": "invalid IP address",
  "hint": "Provide a valid IPv4 or IPv6 address to lookup.",
  "timestamp": "2026-08-29T16:13:55.223Z",
  "service": "CAPI",
  "version": "1.0.0",
  "ads": "This spot is open for sponsors."
}
```

---

## Notes

- This reference intentionally documents the live payload styles used by the project, not an idealized version.
- When a route returns an error, the object usually starts with `error`, then `message`, then `hint` if needed.
- For the plan route, the payload is intentionally flattened to the direct field list instead of nested under `user` or `profile`.
- Client code should treat `service`, `version`, and `ads` as metadata and not as part of the primary business data.
