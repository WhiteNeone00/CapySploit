# CAPI Database Initialization & Auto-Seeding

## Overview
CAPI now features comprehensive database auto-initialization and seeding. On first deployment, all required tables and default data are automatically created without manual SQL or environment setup.

## What Gets Created Automatically

### 1. **Ranks Table** (3 default entries)
```
- Admin: Full control, manages users/methods/settings
- Reseller: Can create sub-users and manage their own services  
- User: Standard API access with inherited limits
```

### 2. **Plans Table** (5 default tiers)
```
Default:  max_time=60s,   concurrents=1,  daily_attacks=100
VIP:      max_time=300s,  concurrents=3,  daily_attacks=500
Holder:   max_time=500s,  concurrents=5,  daily_attacks=1000
Raw:      max_time=9999s, concurrents=99, daily_attacks=99999
Star:     max_time=600s,  concurrents=4,  daily_attacks=800
```

### 3. **Presets Table** (6 auto-generated combinations)
```
- admin-raw:        Admin rank + Raw plan (unlimited)
- reseller-vip:     Reseller rank + VIP plan
- reseller-default: Reseller rank + Default plan
- user-vip:         User rank + VIP plan
- user-default:     User rank + Default plan
- user-holder:      User rank + Holder plan
```

### 4. **Methods Table**
Auto-seeded from `payload.js` DEFAULT_PAYLOAD.methods array
- UDP, TCP, HTTP, HTTPS, CF-bypass, HTTP-Raw, HTTPS-Raw, Slowloris, TCP-Flood, UDP-Flood
- Full method metadata preserved (role restrictions, plan restrictions, API links, etc.)

### 5. **Blacklist Table**
Auto-seeded from `payload.js` DEFAULT_PAYLOAD.blacklists array
- Blocks private IPs (0.0.0, 127.0.0, 8.8.8, etc.)
- Blocks government domains (.gov, .edu, .gouv)
- Blocks internal services (localhost, bash, sudo, mysql, etc.)
- Blocks command characters and encoding attacks

### 6. **Root User** (If Environment Variables Set)
Auto-created on first deployment IF these env vars are provided:
- `ROOT_USER` (or `CAPI_ROOT_USER`)
- `ROOT_PASS` (or `CAPI_ROOT_PASS`)

**Important:** Root user is NOT created if env vars are missing. This prevents default credentials from being active.

## Initialization Flow

### On Application Startup
```
1. First HTTP request arrives
2. orchestrator.js checks if DB initialized (dbInitialized flag)
3. If not, calls Vault.initializeDatabase(env)
4. initializeDatabase() executes:
   - ensureTables() → creates all schema
   - seedRanks() → creates 3 ranks (if empty)
   - seedPlans() → creates 5 plans (if empty)
   - seedPresets() → creates 6 presets (if empty)
   - seedMethods() → seeds methods from payload.js (if empty)
   - seedBlacklist() → seeds blacklist targets (if empty)
   - seedRootUser() → creates root user (if env vars set and table empty)
5. All subsequent requests use dbInitialized = true (skips re-seeding)
```

### Idempotent Design
All seed functions use:
```sql
INSERT OR IGNORE INTO table_name ...
SELECT COUNT(*) AS c FROM table_name
```
This means:
- Safe to run multiple times
- Duplicate entries prevented
- No data loss on restart
- Can manually re-add defaults if deleted

## Environment Variables Required

### Required (for root user creation)
```
ROOT_USER=admin          (or CAPI_ROOT_USER)
ROOT_PASS=SecurePass123  (or CAPI_ROOT_PASS)
```

### Optional (already set in wrangler.toml likely)
```
API_NAME=CAPI
API_VERSION=1.0.0
DISCORD_TOKEN=xxx
DISCORD_CLIENT_ID=xxx
etc.
```

## Testing the Auto-Init

### Test 1: Fresh Database
```bash
# Delete database (or use fresh CF D1)
wrangler deploy

# Check logs for seed messages:
# ✓ Root user 'admin' created automatically
# ✓ 10 default methods seeded
# ✓ [N] blacklist entries seeded
```

### Test 2: Verify Ranks Created
```bash
curl http://localhost:8787/admin/view_all_users?username=root&password=root
# Should show users with rank-based permissions
```

### Test 3: Verify Methods Seeded
```bash
curl http://localhost:8787/api/methods
# Should return all 10+ methods from payload.js
```

### Test 4: Verify Presets Created
```bash
# Query DB directly to see presets
SELECT * FROM presets;
# Should show 6 rows with rank_id + plan_id combinations
```

## Migration Path (For Existing Databases)

For databases that already exist with old schema:
1. Old boolean fields still work (admin, vip, reseller, holder)
2. Ranks/Plans/Presets tables are additive - no data loss
3. Can optionally migrate existing users to new system (TODO)
4. Backward compatibility maintained

## Troubleshooting

### Root user not created
**Problem:** Ran deployment but no root user
**Solution:** Set ROOT_USER and ROOT_PASS env vars in wrangler.toml, redeploy

### Methods not seeding
**Problem:** No methods in database
**Solution:** Verify payload.js DEFAULT_PAYLOAD.methods array exists and has content

### Duplicate entries in tables
**Problem:** Re-ran initialization, got duplicates
**Solution:** This shouldn't happen (using INSERT OR IGNORE) - if it did, manually DELETE duplicates

### Schema error on deploy
**Problem:** "ALTER TABLE failed" error
**Solution:** This is normal - happens when column already exists. It's caught and ignored by try/catch

## Files Modified

- [vault-db.js](vault-db.js) - Added schema tables, seed functions, initializeDatabase()
- [orchestrator.js](orchestrator.js) - Calls initializeDatabase() on first request
- [payload.js](payload.js) - No changes, used as source for defaults

## Security Notes

1. **No Hardcoded Credentials**
   - 'admin123' fallback removed
   - Requires explicit ROOT_PASS env var
   - Root user only created if password provided

2. **Default Limits**
   - Plans have conservative default limits
   - Can be customized per user via /admin/edit_user
   - Raw plan allows 99999 attacks/day (admin only)

3. **Blacklist Defaults**
   - Auto-seeds from payload.js
   - Blocks common attack vectors
   - Admins can add/remove via /admin/add_blacklist

## Next Steps (Optional Improvements)

- [ ] Add UI to manage Ranks/Plans/Presets
- [ ] Migrate old users from boolean flags to rank+plan system
- [ ] Add plan upgrade/downgrade endpoints
- [ ] Auto-archive old attack logs after 30 days
- [ ] Add rate limiting on admin endpoints

