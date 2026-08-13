# Implementation Guide: Using Optimization Framework

**Purpose:** Show developers how to use the new optimization helpers in existing endpoints

---

## Quick Start Examples

### Pattern 1: Success Response with Helpers

**Use this pattern for success responses:**

```javascript
import { successResponse } from './response.js';
import { buildMessage, buildMetadata } from './helpers.js';

// Standard success response
return successResponse(
  buildMessage('created', 'User', totalUsers),
  userData,
  201,
  buildMetadata()
);

// Output:
// {
//   "error": false,
//   "message": "User created successfully (42 total).",
//   "data": userData,
//   "metadata": {
//     "timestamp": "2024-12-20T10:30:45.123Z",
//     "timezone": "UTC",
//     "version": "1.0.0"
//   }
// }
```

### Pattern 2: Error Response with Hints

**Use this pattern for error responses:**

```javascript
import { errorResponse } from './response.js';

// Error with helpful hint and error code
return errorResponse(
  'Target is blacklisted',
  403,
  {
    hint: 'This target has been blocked by policy. Contact admin to appeal.',
    error_code: 'BLACKLIST_BLOCKED',
    target_info: { ip: targetIP, reason: 'government server' }
  }
);

// Output:
// {
//   "error": true,
//   "message": "Target is blacklisted",
//   "hint": "This target has been blocked by policy. Contact admin to appeal.",
//   "error_code": "BLACKLIST_BLOCKED",
//   "target_info": { ... }
// }
```

### Pattern 3: Structured Data Response

**Use this pattern for data with consistent field ordering:**

```javascript
import { buildStructuredData } from './helpers.js';
import { successResponse } from './response.js';
import { buildMessage } from './helpers.js';

// For user responses
const userData = buildStructuredData({
  username: user.username,
  admin: user.admin,
  vip: user.vip,
  // ... all user fields
}, 'user');

return successResponse(
  buildMessage('retrieved', 'User profile'),
  { user: userData }
);

// For attack responses
const attackData = buildStructuredData({
  attack_id: attackId,
  target: target,
  // ... all attack fields
}, 'attack');

return successResponse(
  buildMessage('accepted', 'Attack'),
  attackData
);
```

### Pattern 4: Auto-Create Missing Data

**Use this pattern to auto-create missing database entities:**

```javascript
import { autoCreateIfMissing } from './helpers.js';

// Auto-create method if missing
const methodCreated = await autoCreateIfMissing('method', {
  name: 'udp-flood',
  description: 'UDP flood attack method'
}, env);

if (methodCreated.created) {
  console.log(`Method auto-created: ${methodCreated.name}`);
}

// Auto-create blacklist entry if missing
const blacklistCreated = await autoCreateIfMissing('blacklist', {
  target: '127.0.0.1',
  reason: 'localhost - private range'
}, env);
```

---

## Endpoint Refactoring Templates

### Template 1: List Endpoint Refactor

**Before:**
```javascript
if (endpoint === 'list_methods') {
  const methods = await Vault.listMethods(env);
  return jsonResponse({ 
    error: false, 
    message: `Methods retrieved (${methods.length} found).`,
    data: { methods }
  }, 200, { service: serviceName });
}
```

**After:**
```javascript
if (endpoint === 'list_methods') {
  const methods = await Vault.listMethods(env);
  
  // Auto-create any missing methods from payload
  for (const payloadMethod of getPayloadMethods()) {
    await autoCreateIfMissing('method', payloadMethod, env);
  }
  
  return successResponse(
    buildMessage('listed', 'Attack methods', methods.length),
    { methods },
    200,
    buildMetadata({ count: methods.length })
  );
}
```

**Improvements:**
- ✅ Better message with count
- ✅ Auto-syncs payload methods
- ✅ Consistent response structure
- ✅ Metadata included

### Template 2: Create Endpoint Refactor

**Before:**
```javascript
if (endpoint === 'add_user') {
  const password = generatePassword(12);
  await Vault.saveUser(env, { username: q.username, password });
  return jsonResponse({
    error: false,
    message: `User created`,
    password
  }, 200);
}
```

**After:**
```javascript
if (endpoint === 'add_user') {
  const password = generatePassword(12);
  await Vault.saveUser(env, { username: q.username, password });
  
  const totalUsers = await Vault.listUsers(env);
  return successResponse(
    buildMessage('created', 'User', totalUsers.length),
    { 
      username: q.username, 
      password,
      password_generated: true 
    },
    201,
    buildMetadata({ action: 'user_created' })
  );
}
```

**Improvements:**
- ✅ Better status code (201)
- ✅ Message includes total count
- ✅ Structured response
- ✅ Metadata for audit trail

### Template 3: Retrieve Endpoint Refactor

**Before:**
```javascript
if (endpoint === 'view_profile') {
  const user = await Vault.getUser(env, username);
  if (!user) return jsonResponse({ error: true, message: 'User not found' }, 404);
  
  return jsonResponse({
    error: false,
    message: 'Profile loaded',
    data: { 
      username: user.username,
      vip: user.vip,
      admin: user.admin
      // ... unordered fields
    }
  }, 200);
}
```

**After:**
```javascript
if (endpoint === 'view_profile') {
  const user = await Vault.getUser(env, username);
  if (!user) {
    return errorResponse(
      'User not found',
      404,
      { 
        hint: 'Verify the username and try again.',
        error_code: 'USER_NOT_FOUND'
      }
    );
  }
  
  const profileData = buildStructuredData({
    username: user.username,
    admin: user.admin,
    vip: user.vip,
    // ... all fields
  }, 'user');
  
  return successResponse(
    buildMessage('retrieved', 'User profile'),
    { profile: profileData },
    200,
    buildMetadata({ username })
  );
}
```

**Improvements:**
- ✅ Better error with hint and code
- ✅ Consistent field ordering
- ✅ Descriptive message
- ✅ Audit metadata

### Template 4: Delete Endpoint Refactor

**Before:**
```javascript
if (endpoint === 'delete_user') {
  await Vault.deleteUser(env, q.target_user);
  return jsonResponse({ error: false, message: 'User deleted' }, 200);
}
```

**After:**
```javascript
if (endpoint === 'delete_user') {
  const user = await Vault.getUser(env, q.target_user);
  if (!user) {
    return errorResponse('User not found', 404);
  }
  
  await Vault.deleteUser(env, q.target_user);
  const remaining = await Vault.listUsers(env);
  
  return successResponse(
    buildMessage('deleted', 'User', remaining.length),
    { 
      username: q.target_user,
      remaining_users: remaining.length
    },
    200,
    buildMetadata({ action: 'user_deleted', deleted_by: admin })
  );
}
```

**Improvements:**
- ✅ Validates user exists
- ✅ Returns remaining count
- ✅ Audit trail in metadata
- ✅ Better message

---

## Response Message Patterns

### For List Operations
```javascript
buildMessage('listed', 'Users', 42)
// "Users list retrieved (42 items)."

buildMessage('listed', 'Attack methods', 12)
// "Attack methods list retrieved (12 items)."
```

### For Creation
```javascript
buildMessage('created', 'User', 42)
// "User created successfully (42 total)."

buildMessage('created', 'Blacklist entry', 156)
// "Blacklist entry created successfully (156 total)."
```

### For Modification
```javascript
buildMessage('updated', 'User plan')
// "User plan updated successfully."

buildMessage('suspended', 'User account')
// "User account has been suspended."
```

### For Retrieval
```javascript
buildMessage('retrieved', 'User profile', 1)
// "User profile retrieved successfully (1 found)."

buildMessage('retrieved', 'Attack status', 1)
// "Attack status retrieved successfully (1 found)."
```

---

## Field Ordering by Response Type

### User Type (`'user'`)
```
username → admin → reseller → vip → holder → api_access 
→ max_time → min_time → cooldown → concurrents → max_daily_attacks 
→ attacks_remaining → power_saving → bypass_power → bypass_slots 
→ method_max_slots → suspended → created_by → plan_type → rank 
→ discord_linked → warnings
```

### Plan Type (`'plan'`)
```
Same as User, plus plan-specific fields
```

### Attack Type (`'attack'`)
```
attack_id → target → port → method → time_used → len → threads → rps → geo 
→ target_asn → target_city → target_country → target_country_code 
→ target_isp → target_org → target_region → target_timezone → target_zip 
→ username → max_time → min_time → max_concurrents 
→ method_max_slots → method_active_slots → cooldown → attacks_remaining 
→ bypass_slots → holder_status → vip_status → api_status → admin_status 
→ power_saving → bypass_power → time_to_send
```

---

## Error Response Patterns

### Validation Errors
```javascript
return errorResponse(
  'Invalid input parameter',
  400,
  {
    hint: 'Check parameter format and constraints.',
    error_code: 'INVALID_INPUT',
    parameter: 'port',
    received: 'abc',
    expected: 'number (1-65535)'
  }
);
```

### Authorization Errors
```javascript
return errorResponse(
  'Insufficient permissions',
  403,
  {
    hint: 'This operation requires admin or reseller privileges.',
    error_code: 'PERMISSION_DENIED',
    required_role: 'admin',
    current_role: 'user'
  }
);
```

### Resource Not Found
```javascript
return errorResponse(
  'Target not found',
  404,
  {
    hint: 'Verify the target ID/name and try again.',
    error_code: 'NOT_FOUND',
    resource: 'user',
    identifier: username
  }
);
```

### Rate Limit Errors
```javascript
return errorResponse(
  'Rate limit exceeded',
  429,
  {
    hint: 'Wait before making more requests.',
    error_code: 'RATE_LIMITED',
    retry_after: 60,
    limit: 100,
    window_ms: 60000
  }
);
```

### Internal Errors
```javascript
return errorResponse(
  'Operation failed',
  500,
  {
    hint: 'An unexpected error occurred. Try again later.',
    error_code: 'INTERNAL_ERROR',
    trace_id: 'abc123def456',
    support_contact: 'support@example.com'
  }
);
```

---

## Performance Tips

1. **Use buildStructuredData() for consistent ordering**
   - Enables response caching by structure
   - Better for client parsing
   - Reduces parsing overhead

2. **Auto-create on first request**
   - Eliminates seeding complexity
   - Self-healing on redeployment
   - Keeps database in sync with code

3. **Include metadata for debugging**
   - Helps with request tracing
   - Better for monitoring
   - Easier to debug issues

4. **Use appropriate HTTP status codes**
   - 201 for creation (not 200)
   - 204 for deletion (no content)
   - 400 for validation errors
   - 401 for auth errors
   - 403 for permission errors
   - 404 for not found

---

## Checklist for Refactoring an Endpoint

- [ ] Replace jsonResponse() with successResponse() or errorResponse()
- [ ] Use buildMessage() for operation messages
- [ ] Add buildMetadata() to responses
- [ ] Use buildStructuredData() for data ordering
- [ ] Add error_code to all error responses
- [ ] Add hints to all error responses
- [ ] Consider auto-creating missing entities
- [ ] Use appropriate HTTP status codes
- [ ] Test response structure and messages
- [ ] Verify performance improvement
- [ ] Update API documentation

