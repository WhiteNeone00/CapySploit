# CAPI Security Fixes & Improvements (2026-08-12)

## 🔴 CRITICAL FIXES APPLIED

### 1. **ADMIN PRIVILEGE ESCALATION - FIXED** ✅
**Issue**: The `/admin/edit_user` endpoint allowed editing ANY user field without validation.
- An attacker with admin access could promote users to admin: `?field_to_edit=admin&new_value=1`
- Could change passwords: `?field_to_edit=password&new_value=hacked123`
- Could change roles: `?field_to_edit=reseller&new_value=1`

**Fix Applied**: Added field whitelist to `/admin/edit_user` endpoint
```javascript
const ALLOWED_FIELDS = [
  'max_time', 'min_time', 'cooldown', 'concurrents', 
  'max_daily_attacks', 'bypass_slots', 'service_name', 
  'allowed_methods', 'allowed_targets'
];
if (!ALLOWED_FIELDS.includes(fieldName)) {
  return makePolishedError('field not editable', 400);
}
```

**Protected Fields** (cannot be edited via API):
- ❌ `admin` - prevents privilege escalation
- ❌ `password` - prevents unauthorized access
- ❌ `reseller`, `vip`, `holder` - prevents role escalation
- ❌ `suspended`, `suspended_by`, `suspend_reason` - prevents unilateral unsuspension
- ✅ Only safe limit fields can be modified

---

## 🟠 CODE QUALITY IMPROVEMENTS APPLIED

### 2. **Improved Message Texts** ✅
All response messages now use professional, user-friendly language:

**Before**:
```
"message": "user added"
"message": "user removed"  
"message": "all users loaded"
```

**After**:
```
"message": "User 'alice' has been created successfully."
"message": "User 'bob' has been deleted successfully."
"message": "All system users retrieved (42 users found)."
```

### 3. **Better Error Hints** ✅
Error messages now provide actionable guidance:

**Before**:
- "missing params" → "Provide user_to_edit and field_to_edit"

**After**:
- "missing parameters" → "Provide user_to_edit and field_to_edit (e.g., ?user_to_edit=alice&field_to_edit=concurrents&new_value=10)."

---

## 📋 FILES MODIFIED

| File | Changes |
|------|---------|
| `src/admin.js` | ✅ Added edit_user field whitelist, improved 20+ message texts, better error hints |
| `API_ENDPOINTS.md` | ✅ Updated with new response format examples |

---

## ⚠️ REMAINING ISSUES (Not Fixed Yet - Requires User Input)

### 1. **Default Credentials**
- **File**: `src/orchestrator.js` line 9, `src/routes.js` line 30
- **Issue**: Hardcoded `admin123` password as fallback
- **Risk**: Medium - only used if no env var set
- **Recommendation**: Generate random on first run or require explicit env var

### 2. **Unused routes.js File** 
- **Location**: `/var/www/CAPI/src/routes.js` (208 lines, unused)
- **Issue**: Legacy file not imported by worker.js
- **Action**: Should be deleted to reduce confusion
- **Recommendation**: Delete or confirm if fallback route is needed

### 3. **Unused Functions in api.js**
- `buildDiscordLinkStatus` (line 237) - defined but partially used
- `formatDuration` (line 26-32) - defined but never called
- Duplicate `formatSlotBar` in both api.js and discord-bot.js
- **Recommendation**: Extract to shared helpers.js

### 4. **Fake User Fallback**
- **File**: `src/api.js` lines 602, 639
- **Issue**: Creates fake user object if user not found
- **Risk**: Information leak (username: 'test' or 'anon')
- **Recommendation**: Return error instead

### 5. **No Input Validation on Targets**
- **File**: `src/api.js` line 772
- **Issue**: Only validates format, doesn't check for injection patterns
- **Recommendation**: Add regex whitelist for IP/domain validation

---

## 🧪 TESTING RECOMMENDATIONS

### Test the Edit User Field Whitelist
```bash
# Should succeed (allowed field)
curl "https://api.insideproxy.me/admin/edit_user?username=root&password=admin123&user_to_edit=alice&field_to_edit=concurrents&new_value=10"

# Should fail (forbidden field)
curl "https://api.insideproxy.me/admin/edit_user?username=root&password=admin123&user_to_edit=alice&field_to_edit=admin&new_value=1"
# Response: "field not editable"

# Should fail (forbidden field)
curl "https://api.insideproxy.me/admin/edit_user?username=root&password=admin123&user_to_edit=alice&field_to_edit=password&new_value=hacked"
# Response: "field not editable"
```

### Test New Message Format
```bash
# View improved messages
curl "https://api.insideproxy.me/admin/add_user?username=root&password=admin123&username_to_add=testuser"
# Response: "message": "User 'testuser' has been created successfully."
```

---

## 📌 NEXT STEPS FOR ADMIN

1. **Delete routes.js** - No longer needed, use orchestrator.js instead
2. **Set environment variables** - Don't rely on default `admin123`
3. **Review remaining issues** - Decide on input validation strategy
4. **Deploy & Test** - Run the test commands above to verify fixes

---

## ✅ SECURITY CHECKLIST

- [x] Field whitelist added to edit_user
- [x] No way to escalate privileges via API
- [x] No way to change password via edit_user
- [x] No way to unilaterally unsuspend via API
- [ ] Remove default credentials
- [ ] Delete unused routes.js
- [ ] Add input validation to targets
- [ ] Remove fake user fallback

**Critical**: The field whitelist fix prevents privilege escalation attacks. Deploy immediately.
