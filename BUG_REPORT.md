# Bug Report - Critical & Important Issues Found

## CRITICAL ISSUES

### 1. **Plaintext Passwords in Database** 🔴
**Location:** [src/api.js](src/api.js#L795), [src/vault-db.js](src/vault-db.js)
**Severity:** CRITICAL - Security Vulnerability
**Issue:** User passwords are stored in plaintext in the database. This is a major security risk.
- Line 795 in api.js compares `String(user.password || '') !== providedPassword` directly
- No password hashing (bcrypt, argon2, etc.) appears to be used
- Comment on line 793 acknowledges this: "Note: Vault stores the password in the `password` field. Adjust if passwords are hashed."

**Impact:** Anyone with database access can read all user passwords in plaintext.

**Solution:** Implement proper password hashing:
1. Use `bcrypt` or `argon2` for hashing
2. Update `saveUser()` to hash passwords before storing
3. Update authentication checks to use `.compare()` instead of string equality
4. Migrate existing plaintext passwords (one-time)

**Status:** ❌ Not Fixed (requires schema migration)
**Location:** [src/api.js](src/api.js#L850-865)
**Severity:** HIGH - Security Vulnerability
**Issue:** After validating IP/URL format, there's no check for:
- Private IP ranges (10.x.x.x, 192.168.x.x, 172.16-31.x.x, 127.x.x.x)
- Reserved IPs (0.0.0.0, 255.255.255.255, multicast ranges, etc.)
- The validator module has `isPrivateIPRange()` and `isReservedDomain()` defined but they're not being called in the attack handler

**Code Gap:**
```javascript
if (targetType === 'ip' && !isIPv4(targetProvided)) {
  return makePolishedError(`method ${record.method} requires an IP target`, 400, ...);
}
// MISSING: if (isPrivateIPRange(targetProvided)) return makePolishedError(...)
// MISSING: if (isReservedDomain(targetProvided)) return makePolishedError(...)
```

**Impact:** Users could potentially attack internal infrastructure or reserved ranges.

**Solution:** Add checks before the attack is launched:
```javascript
if (targetType === 'ip' && isPrivateIPRange(targetProvided)) {
  return makePolishedError('cannot attack private IP ranges', 400, {...});
}
if (targetType === 'url' && isReservedDomain(targetProvided)) {
  return makePolishedError('cannot attack reserved domains', 400, {...});
}
if (isBlacklistedTarget(targetProvided, {...})) {
  return makePolishedError('target is blacklisted', 403, {...});
}
```

---

### 3. **Missing Blacklist Check in Attack Handler** 🔴
**Location:** [src/api.js](src/api.js#L850-900)
**Severity:** HIGH - Policy Violation
**Issue:** The attack handler validates target format but doesn't check if the target is blacklisted.
- `isBlacklistedTarget()` function exists in validator.js but is never called in attack endpoint
- Blacklist enforcement is missing entirely from the attack launch path

**Impact:** Blacklisted targets could still be attacked, bypassing security policy.

**Solution:** Add blacklist validation:
```javascript
const isBlacklisted = await isBlacklistedTarget(
  targetProvided, 
  getPayloadBlacklists(), 
  targetType === 'ip'
);
if (isBlacklisted) {
  await Vault.recordUserWarning(env, user.username, 'attempted blacklisted target');
  return makePolishedError('target is blacklisted', 403, {...});
}
```

---

## HIGH-PRIORITY ISSUES

### 4. **Missing Cooldown Check in Attack Handler** 🟠
**Location:** [src/api.js](src/api.js#L760+)
**Severity:** HIGH - Policy Enforcement
**Issue:** Rate limiting is applied to protected endpoints (line 222), but the attack endpoint has NO cooldown enforcement.
- `checkUserCooldown()` is defined in helpers.js but never called for attack requests
- Users can potentially spam attack requests without rate limiting
- Comment on line 226 explicitly says cooldown is "enforced in the attack handler" but it's not there

**Impact:** Attack endpoint is not rate-limited, allowing spam/abuse.

**Solution:** Add cooldown check before launching attack:
```javascript
const cooldownCheck = checkUserCooldown(
  user.last_request_time,
  COOLDOWN_SECONDS,
  Boolean(user.bypass_anti_spam)
);
if (!cooldownCheck.allowed) {
  return makePolishedError(
    `Please wait ${cooldownCheck.secondsUntilAvailable}s before launching another attack`,
    429,
    {...}
  );
}
```

---

### 5. **Missing Slot Acquisition Error Handling** 🟠
**Location:** [src/api.js](src/api.js#L900+)
**Severity:** HIGH - Resource Management
**Issue:** Attack slot acquisition happens but the failure case is not handled:
- `acquireAttackSlots()` is called but if it fails, the attack launches anyway without slots
- No check for slot availability before executing attack
- Slot release might not happen if attack fails midway (missing try-finally)

**Impact:** Concurrent attack limits could be exceeded.

**Solution:** Add proper slot management:
```javascript
const slotsAcquired = await acquireAttackSlots(1, GLOBAL_API_SLOTS);
if (!slotsAcquired) {
  return makePolishedError('all attack slots are in use', 503, {...});
}

try {
  // Execute attack...
} finally {
  releaseAttackSlots(1);
}
```

---

### 6. **Missing Null Checks After User Lookup** 🟠
**Location:** [src/api.js](src/api.js#L793-795)
**Severity:** MEDIUM - Potential Crash
**Issue:** After fetching user, there's one check `if (!user || ...)` but potential null pointer dereference later:
- Line 805: `user.suspended` accessed without null guard
- Line 810: `user.expiry_unix` accessed without null guard
- Multiple other places access user properties

**Impact:** Could crash if user lookup returns null but somehow passes the first check.

**Solution:** Ensure null check covers all subsequent accesses or use optional chaining consistently.

---

## MEDIUM-PRIORITY ISSUES

### 7. **Incomplete Error Response on Unlink** 🟡
**Location:** [src/api.js](src/api.js#L577)
**Severity:** MEDIUM - Logic Error
**Issue:** Error response has duplicate `service` field (in both payload and options):
```javascript
if (!unlinked) return jsonResponse({ 
  error: true, 
  message: '...', 
  service: env.API_NAME || APP_DEFAULTS.DEFAULT_SERVICE_NAME  // ← DUPLICATE
}, 500, { service: serviceName, version: apiVersion });
```

**Impact:** Response payload has redundant data.

**Solution:** Remove `service` from payload, let options parameter handle it.

---

### 8. **Unused Configuration Values** 🟡
**Location:** [src/config.js](src/config.js)
**Severity:** LOW - Code Quality
**Issue:** Several config values defined but never used:
- `USER_LIMITS.MIN_PASSWORD_LENGTH` - no password validation
- `USER_LIMITS.MAX_CONCURRENT_ATTACKS` - not checked before launching
- `TIMEOUT_CONFIG.VERIFICATION_CODE_EXPIRATION_MS` - calculated inline instead of using config

**Impact:** Dead code, inconsistent configuration.

**Solution:** Use config values consistently throughout codebase.

---

### 9. **Missing Discord Link Validity Check** 🟡
**Location:** [src/api.js](src/api.js#L450)
**Severity:** MEDIUM - Data Integrity
**Issue:** After getting user from Discord link, no check that the link is actually verified:
```javascript
const link = await Vault.getVerifiedDiscordLinkByDiscordId(env, discordUserId);
if (!link) return jsonResponse(...404...);
const user = await Vault.getUser(env, link.username);
if (!user) return jsonResponse(...500...);
// Missing: if (!link.verified) return error
```

**Impact:** Could serve data for unverified Discord links.

**Solution:** Add verification check if needed.

---

### 10. **Missing Error Handling in Method Sync** 🟡
**Location:** [src/api.js](src/api.js#L828-830)
**Severity:** MEDIUM - Error Handling
**Issue:** Method sync could fail silently:
```javascript
if (!methodNames.includes(record.method)) {
  await Vault.syncMethodsFromPayload(env);  // ← No error check
}
```

**Impact:** If sync fails, attack proceeds with stale method list.

**Solution:** Check sync result and handle errors appropriately.

---

## SUMMARY TABLE

| ID | Issue | Severity | Type | Status |
|---|---|---|---|---|
| 1 | Plaintext passwords | CRITICAL | Security | ❌ Not Fixed |
| 2 | Missing target validation | HIGH | Security | ❌ Not Fixed |
| 3 | Missing blacklist check | HIGH | Security | ❌ Not Fixed |
| 4 | Missing cooldown enforcement | HIGH | Policy | ❌ Not Fixed |
| 5 | Slot management error handling | HIGH | Resource | ❌ Not Fixed |
| 6 | Missing null checks | MEDIUM | Stability | ❌ Not Fixed |
| 7 | Duplicate service field | MEDIUM | Response | ❌ Not Fixed |
| 8 | Unused config values | LOW | Quality | ❌ Not Fixed |
| 9 | Discord link validation | MEDIUM | Data | ❌ Not Fixed |
| 10 | Method sync error handling | MEDIUM | Error | ❌ Not Fixed |

---

## Recommended Priority for Fixes

1. **IMMEDIATE (CRITICAL):** Issue #1 - Implement password hashing
2. **URGENT (HIGH):** Issues #2, #3, #4 - Security/Policy fixes
3. **SOON (HIGH):** Issue #5 - Resource management
4. **THIS WEEK (MEDIUM):** Issues #6, #7, #9, #10
5. **REFACTORING (LOW):** Issue #8
