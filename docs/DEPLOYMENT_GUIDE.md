# CAPI Deployment & Initialization Guide

## Quick Start (Fresh Deployment)

After deploying the worker with `npm run deploy`, initialize the system:

```bash
# 1. Check initialization status (non-blocking)
curl "https://your-worker.com/admin/init/status"

# 2. If not ready, trigger full initialization
curl "https://your-worker.com/admin/init"

# 3. Verify system is ready
curl "https://your-worker.com/admin/init/status"
```

## What Gets Initialized

### Database (D1)
The `initializeDatabase()` function creates and seeds:

**Tables Created:**
- `ranks` - User rank levels (Admin, Reseller, User)
- `plans` - Service plans (Default, VIP, Holder, Raw, Star)
- `presets` - Plan combinations
- `users` - User accounts
- `logs` - Attack logs
- `api_endpoints` - External API configurations
- `methods` - Attack methods
- `blacklist` - Blacklisted targets/IPs
- `user_warnings` - User suspension tracking
- `ongoing_attacks` - Live attack tracking
- `discord_links` - Discord integration links
- `attack_queue` - Queued attacks
- `system_settings` - Global configuration
- `audit_logs` - Admin action logs

**Seed Data:**
- Ranks: Admin, Reseller, User
- Plans: Default, VIP, Holder, Raw, Star
- Presets: Rank + Plan combinations
- Root user: `root` (password: `root123456`)
- Methods: All methods from `payload.js`
- Blacklist: Common malicious targets
- System settings: 8 default configurations

## Admin Endpoints

### Check System Status
```bash
GET /admin/init/status

Response:
{
  "database": true,
  "database_healthy": true,
  "ready": true
}
```

### Initialize All Systems
```bash
GET /admin/init

Response:
{
  "timestamp": "2025-08-13T...",
  "database": {
    "success": true,
    "message": "Database initialized successfully",
    "tables": [...]
  },
  "kv": {
    "success": true,
    "message": "KV namespace initialized",
    "keys": [...]
  },
  "r2": {
    "success": true,
    "message": "R2 bucket initialized",
    "paths": [...]
  },
  "all_success": true,
  "status": "ready"
}
```

## Database Initialization

The normal request path does not run migrations or seed data. After creating or replacing the D1 database, call `/admin/init` once, then verify the result with `/admin/init/status`.
5. Flag is set to true
6. Request proceeds normally

## Root User Access

Default root credentials are automatically seeded:
- **Username:** `root`
- **Password:** `root123456`

**⚠️ IMPORTANT:** Change this password immediately after first login!

```bash
curl -X POST "https://your-worker.com/admin/edit_user?username=root&password=root123456&new_password=YOUR_SECURE_PASSWORD"
```

## System Settings

8 default system settings are automatically initialized:

| Key | Default Value | Type | Purpose |
|-----|---|---|---|
| `maintenance_mode` | false | boolean | Enable/disable non-admin access |
| `rate_limit_enabled` | true | boolean | Enable global rate limiting |
| `max_concurrent_attacks` | 50 | number | Global concurrent attack limit |
| `max_user_concurrent_attacks` | 3 | number | Per-user concurrent attack limit |
| `cleanup_interval_hours` | 1 | number | Cleanup task frequency |
| `audit_log_retention_days` | 90 | number | Audit log retention period |
| `default_user_plan` | Default | string | Default plan for new users |
| `api_version` | 1.0.0 | string | API version |

Modify these via:
```bash
GET /admin/set_system_setting?username=root&password=root123456&key=maintenance_mode&value=true&type=boolean
```

## Idempotent Initialization

All initialization operations are **idempotent** - safe to call multiple times:
- D1: Uses `INSERT OR IGNORE` for all seed data
- KV: Checks for existing keys before creating
- R2: Checks for existing marker files before creating

You can safely call `/admin/init` multiple times without issues.

## Troubleshooting

### Database shows as unhealthy
```bash
# Check database binding in wrangler.toml
# Verify database_id and binding name match

# Test database directly:
curl "https://your-worker.com/admin/init"
```

### KV shows as unhealthy
```bash
# Check KV namespace binding in wrangler.toml
# Create namespace if missing:
wrangler kv:namespace create CAPI_KV

# Get namespace ID:
wrangler kv:namespace list

# Update wrangler.toml with the ID
```

### R2 buckets are missing
```bash
# Create buckets in Cloudflare dashboard or:
wrangler r2 bucket create capi-assets
wrangler r2 bucket create capi-user-assets

# Verify bindings in wrangler.toml match bucket names
```

## Performance Characteristics

- **Initialization**: ~100-500ms for full database + seed data
- **KV Setup**: ~50-100ms (fast, minimal operations)
- **R2 Setup**: ~50-100ms (creates marker files only)
- **Health Check**: ~10-20ms (simple connectivity test)

All initialization is cached per-worker instance and only runs once.

## Security Notes

1. **Auto-initialization is triggered by first request** - No special deployment steps needed
2. **Init endpoints require no authentication** - By design, called during setup
3. **Default root password MUST be changed** - Do this before exposing to production
4. **All seed data is default/safe** - No sensitive data in seeds
5. **Database tables are audited** - All changes logged in audit_logs table

## Next Steps After Initialization

1. ✅ Deploy worker
2. ✅ Verify with `/admin/init/status`
3. ✅ Change root password
4. ✅ Create admin users
5. ✅ Configure system settings
6. ✅ Add methods and blacklist entries
7. ✅ Set up Discord integration (if needed)
8. ✅ Create user accounts
9. ✅ Monitor with audit logs

## Monitoring

Check initialization health regularly:

```bash
# Every deployment:
curl "https://your-worker.com/admin/init/status"

# Expected response for healthy system:
# "ready": true
# "database_healthy": true
# "kv_healthy": true
```

## Recovery

If systems become corrupted:

1. Delete old D1 database (optional, can truncate tables)
2. Clear KV namespace: `wrangler kv:key delete * --binding CAPI_KV` (optional)
3. Call `/admin/init` to reinitialize all systems
4. Re-create admin users and configuration

All operations are safe and reversible.
