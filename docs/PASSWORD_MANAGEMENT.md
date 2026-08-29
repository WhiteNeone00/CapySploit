# CAPI Admin Password Management & User Features

## Overview
Enhanced password management for user accounts with auto-generation, validation, and multiple change methods.

---

## Password Auto-Generation

### When Creating Users
When a new user is created **without specifying a password**, one is automatically generated.

```bash
# Create user WITHOUT password → auto-generates secure password
curl "http://localhost:8787/admin/add_user?username=root&password=root&username_to_add=alice"

# Response includes the generated password
{
  "error": false,
  "message": "User 'alice' created with auto-generated password (shown below). Save this password securely.",
  "user": {
    "username": "alice",
    "password": "K9mP2xQ8nR$Z",
    "password_generated": true,
    "created_by": "root",
    "created_at": "2026-08-12T17:50:34.123Z"
  }
}
```

### Password Generation Features
- **12 characters** by default
- **Guaranteed mix**: 1 uppercase, 1 lowercase, 1 number, 1 symbol
- **Secure randomization**: Uses Math.random() with shuffling
- **Returns in response**: Admin can immediately provide to user

---

## Password Validation

All passwords (auto-generated or user-provided) must meet these requirements:

| Requirement | Details |
|-------------|---------|
| Length | Minimum 8 characters |
| Uppercase | At least 1 uppercase letter (A-Z) |
| Lowercase | At least 1 lowercase letter (a-z) |
| Numbers | At least 1 digit (0-9) |
| Symbols | Optional but encouraged |

### Invalid Password Examples
```
❌ "Password1"     → Too simple, no symbols
❌ "pass"          → Too short
❌ "ALLUPPERCASE1" → No lowercase letters
❌ "alllowercase1" → No uppercase letters
```

### Valid Password Examples
```
✅ "Secure123!"
✅ "P@ssw0rd"
✅ "MyC0mpl3xPass"
✅ "K9mP2xQ8nR$Z"
```

---

## Admin Password Management Endpoints

### 1. **Add User (with auto-generation)**
Creates a new user. Password is auto-generated if not provided.

**Endpoint:** `/admin/add_user`

**Parameters:**
```
username=ADMIN_USER
password=ADMIN_PASS
username_to_add=NEWUSER
password_to_add=OPTIONAL_PASSWORD
```

**Examples:**

Auto-generate password:
```bash
curl "http://localhost:8787/admin/add_user?\
username=root&\
password=root&\
username_to_add=alice"
```

Specify password:
```bash
curl "http://localhost:8787/admin/add_user?\
username=root&\
password=root&\
username_to_add=alice&\
password_to_add=MySecurePass123!"
```

**Response:**
```json
{
  "error": false,
  "message": "User 'alice' created with auto-generated password (shown below). Save this password securely.",
  "user": {
    "username": "alice",
    "password": "K9mP2xQ8nR$Z",
    "password_generated": true,
    "created_by": "root",
    "created_at": "2026-08-12T17:50:34.123Z"
  }
}
```

---

### 2. **Change Password (with validation)**
Change a user's password with strong validation.

**Endpoint:** `/admin/change_password`

**Parameters:**
```
username=ADMIN_USER
password=ADMIN_PASS
user_to_change=TARGET_USER
new_password=NEW_PASSWORD
```

**Example:**
```bash
curl "http://localhost:8787/admin/change_password?\
username=root&\
password=root&\
user_to_change=alice&\
new_password=NewSecurePass123!"
```

**Response:**
```json
{
  "error": false,
  "message": "Password for user 'alice' changed successfully.",
  "user": "alice",
  "changed_at": "2026-08-12T17:52:10.456Z",
  "hint": "Notify the user of their new password securely (e.g., via private message)."
}
```

**Error Responses:**
```json
// Weak password
{
  "error": true,
  "message": "weak password",
  "hint": "Password must be at least 8 characters long."
}

// User not found
{
  "error": true,
  "message": "user not found",
  "hint": "The user does not exist."
}
```

---

### 3. **Generate Random Password (Password Reset)**
Generate a new random password for a user (useful for password resets).

**Endpoint:** `/admin/generate_password`

**Parameters:**
```
username=ADMIN_USER
password=ADMIN_PASS
user_to_reset=TARGET_USER
```

**Example:**
```bash
curl "http://localhost:8787/admin/generate_password?\
username=root&\
password=root&\
user_to_reset=alice"
```

**Response:**
```json
{
  "error": false,
  "message": "New password generated for user 'alice'. Show it to the user securely.",
  "user": "alice",
  "new_password": "M7jN3pQ9tV#X",
  "reset_at": "2026-08-12T17:55:20.789Z",
  "hint": "Share this password securely (never in chat, email only if using HTTPS)."
}
```

---

### 4. **Edit User (other fields)**
Edit user profile without changing password.

**Endpoint:** `/admin/edit_user`

**Editable Fields:**
- `max_time` - Max attack duration (seconds)
- `min_time` - Min attack duration (seconds)
- `cooldown` - Cooldown between attacks (seconds)
- `concurrents` - Concurrent attacks allowed
- `max_daily_attacks` - Daily attack limit
- `bypass_slots` - Bypass slot count
- `service_name` - User's service/brand name
- `allowed_methods` - Comma-separated list of methods
- `allowed_targets` - Comma-separated list of targets
- `api_access` - Enable/disable API access (0 or 1)

**NOTE:** Password is NOT editable via this endpoint. Use `/admin/change_password` instead.

**Example:**
```bash
curl "http://localhost:8787/admin/edit_user?\
username=root&\
password=root&\
user_to_edit=alice&\
field_to_edit=concurrents&\
new_value=5"
```

**Response:**
```json
{
  "error": false,
  "message": "User 'alice' field 'concurrents' updated successfully.",
  "field": "concurrents",
  "new_value": 5,
  "user": "alice"
}
```

---

### 5. **Admin Stats**
Get system-wide statistics.

**Endpoint:** `/admin/stats`

**Parameters:**
```
username=ADMIN_USER
password=ADMIN_PASS
```

**Example:**
```bash
curl "http://localhost:8787/admin/stats?\
username=root&\
password=root"
```

**Response:**
```json
{
  "error": false,
  "message": "Admin statistics loaded",
  "stats": {
    "total_users": 42,
    "suspended_users": 3,
    "admin_users": 2,
    "reseller_users": 5,
    "vip_users": 12,
    "total_methods": 10,
    "blacklist_entries": 89,
    "ongoing_attacks": 7,
    "timestamp": "2026-08-12T17:57:30.123Z"
  }
}
```

---

## Security Best Practices

### For Admins

1. **Never share passwords in chat**
   - Use secure direct messages
   - Or email (if using HTTPS/TLS)
   - Or encrypted password manager

2. **Store admin credentials securely**
   - Use environment variables
   - Never hardcode in application
   - Use different passwords for different environments

3. **Regularly rotate admin passwords**
   - Change every 30 days
   - After staff changes
   - After security incidents

4. **Monitor suspicious activity**
   - Check `/admin/view_all_logs` for unusual access patterns
   - Review `/admin/stats` regularly
   - Suspend accounts with high warning counts

### For Users

1. **Protect your password**
   - Don't share with others
   - Use a password manager
   - Don't reuse across services

2. **Change password if compromised**
   - Ask admin to reset immediately
   - Create a new strong password

3. **Enable 2FA if available**
   - Link Discord for extra verification
   - Use `/api/link` endpoint

---

## Migration from Legacy 'changeme' Password

For existing users created with default `changeme` password:

```bash
# Reset their password to a secure one
curl "http://localhost:8787/admin/generate_password?\
username=root&\
password=root&\
user_to_reset=legacyuser"

# Response shows the new password
# Share with user via secure channel
```

---

## Workflow Examples

### Scenario 1: Create New User for Reseller

```bash
# Step 1: Create user with auto-generated password
curl "http://localhost:8787/admin/add_user?\
username=root&\
password=root&\
username_to_add=newreseller&\
api_access=1"

# Response: { password: "K9mP2xQ8nR$Z", ... }

# Step 2: Send password to reseller via encrypted email/PM
# "Your new account has been created. Password: K9mP2xQ8nR$Z"

# Step 3: Reseller logs in and can change password themselves
```

### Scenario 2: Reset Compromised Account

```bash
# Step 1: Generate new password
curl "http://localhost:8787/admin/generate_password?\
username=root&\
password=root&\
user_to_reset=compromised_user"

# Step 2: Suspend the account immediately
curl "http://localhost:8787/suspend_user?\
username=root&\
password=root&\
user_to_suspend=compromised_user&\
reason=account+compromised"

# Step 3: Contact user to verify they requested reset
# Step 4: Unsuspend and send new password when confirmed
```

### Scenario 3: Enforce Password Change

```bash
# Admin-generated password reset (user hasn't changed default yet)
curl "http://localhost:8787/admin/generate_password?\
username=root&\
password=root&\
user_to_reset=alice"

# Share new password with alice
# Ask alice to log in and use /admin/change_password or change_password endpoint
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "weak password" error | Password must be 8+ chars with uppercase, lowercase, numbers |
| "user not found" error | Check username spelling and capitalization |
| Password displayed in response | Copy immediately, it won't be shown again |
| User can't reset own password | Users can only change via API if they have credentials |

---

## Unused Functions (For Cleanup)

The following database functions are defined but NOT used. Can be removed:
- `Vault.countVerifiedDiscordLinks()` - No calls found
- `Vault.countPendingDiscordLinks()` - No calls found
- `Vault.countLogsToday()` - No calls found
- `Vault.countUsersByFlag()` - No calls found

These can be removed in a future cleanup phase if they're not planned for future use.

