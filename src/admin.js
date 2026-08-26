// Admin route handlers for user, method, blacklist, and misc controls.
import { jsonResponse, structuredResponse, parseQuery, routeNotFound, resolveServiceName, makePolishedError, checkJavaScriptSyntax } from './response.js';
import * as Vault from './vault-db.js';
import { initializeAll, getInitializationStatus } from './initialize.js';
import { getPayloadMethods } from '../payload.js';
import { sanitizeUserForResponse, paginate, validatePaginationParams, applyGlobalRateLimit, trackFailedAuthAttempt, getFailedAuthAttempts, clearFailedAuthAttempts, isUserIpAllowed } from './helpers.js';
import { PASSWORD_CONFIG, ADMIN_PROTECTED_FIELDS, ADMIN_EDITABLE_FIELDS, APP_DEFAULTS, USER_LIMITS } from './config.js';

// ==================== UTILITY FUNCTIONS ====================

/**
 * Generate a secure random password meeting complexity requirements
 * - Minimum 12 characters by default
 * - Includes uppercase, lowercase, numbers, symbols
 * - Shuffled to prevent patterns
 * @param {number} length - Length of password to generate (default 12)
 * @returns {string} Random secure password
 * @example
 *   const pwd = generatePassword(16);  // 16-char password with mixed charset
 *   const pwd2 = generatePassword();   // 12-char password (default)
 */
function generatePassword(length = PASSWORD_CONFIG.DEFAULT_LENGTH) {
  // Generate a secure random password with uppercase, lowercase, numbers, symbols
  const uppercase = PASSWORD_CONFIG.UPPERCASE;
  const lowercase = PASSWORD_CONFIG.LOWERCASE;
  const numbers = PASSWORD_CONFIG.NUMBERS;
  const symbols = PASSWORD_CONFIG.SYMBOLS;
  const all = uppercase + lowercase + numbers + symbols;
  
  let password = '';
  // Ensure at least one of each type (complexity requirement)
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += symbols[Math.floor(Math.random() * symbols.length)];
  
  // Fill the rest randomly from combined charset
  for (let i = password.length; i < length; i++) {
    password += all[Math.floor(Math.random() * all.length)];
  }
  
  // Shuffle characters to remove predictable patterns
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

/**
 * Validate password meets complexity requirements
 * - Minimum 8 characters
 * - Must have uppercase letter (A-Z)
 * - Must have lowercase letter (a-z)
 * - Must have number (0-9)
 * @param {string} password - Password to validate
 * @returns {Object} {valid: boolean, reason: string} Validation result with explanation
 * @example
 *   const check = validatePassword('weak');
 *   if (!check.valid) return error(check.reason);
 */
function validatePassword(password) {
  return {
    valid: typeof password === 'string' && password.length > 0,
    reason: 'Password cannot be empty.'
  };
}

export async function logAuditAction(env, adminUsername, action, targetUser, details = {}, sourceIp = 'unknown', status = 'success') {
  const DB = env && (env.capi_db || env.CAPI_DB || env.DB || env.CAPI_db);
  if (!DB) return { ok: false, status: 'skipped', reason: 'no_database' };

  try {
    const setupStatement = DB.prepare(`CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_username TEXT,
      action TEXT,
      target_user TEXT,
      details TEXT,
      source_ip TEXT,
      status TEXT,
      created_at TEXT
    )`);
    if (setupStatement && typeof setupStatement.run === 'function') {
      await setupStatement.run();
    }

    const record = {
      admin_username: adminUsername || 'system',
      action: String(action || 'unknown'),
      target_user: targetUser || null,
      details: typeof details === 'string' ? details : JSON.stringify(details || {}),
      source_ip: sourceIp || 'unknown',
      status: String(status || 'success'),
      created_at: new Date().toISOString()
    };

    const insertSql = `INSERT INTO audit_logs (admin_username, action, target_user, details, source_ip, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const insertStatement = DB.prepare(insertSql);
    const executeInsert = typeof insertStatement.run === 'function'
      ? insertStatement
      : (typeof insertStatement.bind === 'function' ? insertStatement.bind(
          record.admin_username,
          record.action,
          record.target_user,
          record.details,
          record.source_ip,
          record.status,
          record.created_at
        ) : null);

    if (executeInsert && typeof executeInsert.run === 'function') {
      await executeInsert.run();
    } else if (typeof insertStatement.bind === 'function') {
      const bound = insertStatement.bind(
        record.admin_username,
        record.action,
        record.target_user,
        record.details,
        record.source_ip,
        record.status,
        record.created_at
      );
      if (bound && typeof bound.run === 'function') {
        await bound.run();
      }
    }

    return { ok: true, status: record.status, created_at: record.created_at };
  } catch (error) {
    console.error('Failed to log audit action:', error);
    return { ok: false, status: 'failed', reason: error.message || 'unknown_error' };
  }
}

export async function getAuditLogs(env, options = {}) {
  const DB = env && (env.capi_db || env.CAPI_DB || env.DB || env.CAPI_db);
  if (!DB) return { logs: [], total: 0, limit: Number(options.limit || 50), offset: Number(options.offset || 0) };

  try {
    const limit = Math.max(1, Number(options.limit || 50));
    const offset = Math.max(0, Number(options.offset || 0));
    const statement = DB.prepare(`CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_username TEXT,
      action TEXT,
      target_user TEXT,
      details TEXT,
      source_ip TEXT,
      status TEXT,
      created_at TEXT
    )`);
    if (statement && typeof statement.run === 'function') {
      await statement.run();
    }

    const countResult = await DB.prepare('SELECT COUNT(*) AS total FROM audit_logs').all();
    const total = Number(countResult?.results?.[0]?.total || 0);
    const rowsResult = await DB.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ? OFFSET ?').bind(limit, offset).all();
    const logs = rowsResult?.results || [];

    return { logs, total, limit, offset };
  } catch (error) {
    console.error('Failed to fetch audit logs:', error);
    return { logs: [], total: 0, limit: Number(options.limit || 50), offset: Number(options.offset || 0), error: error.message || 'unknown_error' };
  }
}

async function requireAdminCredentials(q, env, requestContext = {}) {
  const username = String(q.username || '').trim();
  const password = String(q.password || '').trim();

  if (!username || !password) {
    return { ok: false, response: makePolishedError('admin authentication required', 401, { hint: 'Provide username and password as query parameters for the admin route.' }) };
  }

  // Check if account is locked due to failed auth attempts
  const authStatus = getFailedAuthAttempts(username);
  if (authStatus.isLocked) {
    return { 
      ok: false, 
      response: makePolishedError(
        `Account temporarily locked after ${authStatus.limit} failed attempts. Wait ${authStatus.nextAttemptAvailable} seconds before trying again.`, 
        429, 
        { 
          hint: `Your account is locked for security. Try again in ${authStatus.nextAttemptAvailable} seconds.`,
          locked: true,
          attempts: authStatus.attempts,
          limit: authStatus.limit
        }
      ) 
    };
  }

  const admin = await Vault.getUser(env, username, { fresh: true });
  if (!admin || !(await Vault.verifyUserPassword(env, admin, password)) || !admin.admin) {
    // Track failed attempt
    const newAttemptCount = trackFailedAuthAttempt(username);
    const remainingAttempts = authStatus.limit - newAttemptCount;
    
    return { 
      ok: false, 
      response: makePolishedError(
        `Invalid admin credentials (${newAttemptCount}/${authStatus.limit} attempts)`, 
        401, 
        { 
          hint: remainingAttempts > 0 
            ? `${remainingAttempts} attempt${remainingAttempts !== 1 ? 's' : ''} remaining before account lock.`
            : 'Account is now locked. Wait 15 minutes before trying again.',
          attempts: newAttemptCount,
          limit: authStatus.limit
        }
      ) 
    };
  }

  // Clear failed auth attempts on successful login
  clearFailedAuthAttempts(username);
  const clientIp = requestContext.sourceIp || 'unknown';
  if (!isUserIpAllowed(admin, clientIp)) {
    return { ok: false, response: makePolishedError('access denied from this IP address', 403, { ip: clientIp, whitelisted_ip: admin.whitelisted_ip, hint: 'This account is restricted to a specific IP address. Contact an administrator to change the whitelist.' }) };
  }
  await Vault.updateUserLastIp(env, username, clientIp);
  return { ok: true, admin };
}

export async function adminHandler(parts, request, env, requestId, logger, requestContext = {}) {
  const q = parseQuery(request);
  const endpoint = parts[0] || '';
  const adminUsername = String(q.username || '').trim();

  // Handle initialization endpoints (no auth required, called once at setup)
  if (endpoint === 'init' && parts[1] !== 'status') {
    // ENDPOINT: /admin/init - Initialize the D1 database
    // Usage: Called once after deployment or when systems need reset
    // Returns: Initialization status for all bindings
    const initResult = await initializeAll(env);
    return jsonResponse({
      error: false,
      message: 'System initialization completed',
      data: initResult,
      status: 'success'
    }, initResult.all_success ? 200 : 207);
  }

  if (endpoint === 'init' && parts[1] === 'status') {
    // ENDPOINT: /admin/init/status - Check initialization status without auth
    // Usage: Called to verify system readiness
    // Returns: D1 database health check
    const status = await getInitializationStatus(env);
    return jsonResponse({
      error: false,
      message: 'System status check',
      data: status,
      status: status.ready ? 'ready' : 'initializing'
    }, status.ready ? 200 : 503);
  }

  // All other admin endpoints require authentication
  const guard = await requireAdminCredentials(q, env, requestContext);
  if (!guard.ok) return guard.response;
  
  const admin = guard.admin || (requestContext?.user?.username === adminUsername
    ? requestContext.user
    : await Vault.getUser(env, adminUsername));
  
  // Apply rate limiting with bypass support
  if (adminUsername && admin) {
    const rateLimitCheck = applyGlobalRateLimit(`admin:${adminUsername}`, Boolean(admin.bypass_anti_spam), 1);
    if (!rateLimitCheck.allowed) {
      return makePolishedError(
        `Rate limited. Please wait ${rateLimitCheck.secondsUntilAvailable} second${rateLimitCheck.secondsUntilAvailable !== 1 ? 's' : ''} before trying again.`,
        429,
        { hint: 'You are making requests too quickly. Upgrade to bypass rate limits or wait before retrying.' }
      );
    }
  }

  if (endpoint === 'add_user') {
    // ENDPOINT: /admin/add_user - Create new user account with optional auto-generated password
    // Auth: Requires valid admin username/password via query params
    // Parameters:
    //   - username, password: Admin credentials for authentication
    //   - username_to_add (required): New username to create
    //   - password_to_add / username_password (optional): Password for new user
    //   - suspended, bypass_slots: Account flags
    // Returns: User object with password if auto-generated
    if (!q.username_to_add) return makePolishedError('missing username_to_add', 400, { hint: 'Provide username_to_add in the request.' });
    
    // Prevent duplicate users - check if username already exists
    const existingUser = await Vault.getUser(env, q.username_to_add);
    if (existingUser) return makePolishedError('username already exists', 409, { hint: `User '${q.username_to_add}' already exists. Choose a different username or use /admin/edit_user to modify.` });
    
    // Auto-generate password if not provided (ensures strength compliance)
    let userPassword = q.password_to_add || q.username_password || null;
    let passwordGenerated = false;
    if (!userPassword) {
      userPassword = generatePassword(PASSWORD_CONFIG.DEFAULT_LENGTH);
      passwordGenerated = true;
    } else {
      // Validate provided password
      const validation = validatePassword(userPassword);
      if (!validation.valid) {
        return makePolishedError('weak password', 400, { hint: validation.reason });
      }
    }
    
    let user = {
      username: q.username_to_add,
      password: userPassword,
      admin: 0,
      reseller: 0,
      vip: 0,
      holder: 0,
      api: 1,
      max_time: USER_LIMITS.DEFAULT_MAX_TIME,
      cooldown: USER_LIMITS.DEFAULT_COOLDOWN,
      max_concurrents: USER_LIMITS.DEFAULT_MAX_CONCURRENTS,
      max_daily_attacks: USER_LIMITS.DEFAULT_MAX_DAILY_ATTACKS,
      created_by: adminUsername || 'root',
      expiry_unix: 0,
      bypass_slots: Number(q.bypass_slots || 0),
      suspended: Number(q.suspended || 0)
    };

    const requestedPlan = q.plan_name || q.plan || null;
    if (requestedPlan && !(await Vault.getPlan(env, requestedPlan))) {
      return makePolishedError('plan not found', 404, { hint: `The plan '${requestedPlan}' does not exist.` });
    }
    
    await Vault.saveUser(env, user);
    if (requestedPlan) user = await Vault.applyPlanToUser(env, user.username, requestedPlan);
    
    // Log audit trail for user creation
    const sourceIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
    await logAuditAction(env, adminUsername, 'add_user', user.username, { 
      reason: `User created with password ${passwordGenerated ? '(auto-generated)' : '(provided)'}` 
    }, sourceIp, 'success');
    
    const responseMsg = passwordGenerated 
      ? `User '${user.username}' created with auto-generated password (shown below). Save this password securely.`
      : `User '${user.username}' created successfully.`;
    
    // Flattened response
    return jsonResponse({ 
      error: false, 
      message: responseMsg,
      username: user.username,
      password: passwordGenerated ? userPassword : undefined,
      password_generated: passwordGenerated,
      created_by: adminUsername || 'root',
      created_at: new Date().toISOString()
    });
  }

  if (endpoint === 'change_password') {
    // Dedicated endpoint for password changes with stronger validation
    if (!q.user_to_change) return makePolishedError('missing user_to_change', 400, { hint: 'Provide user_to_change in the request.' });
    if (!q.new_password) return makePolishedError('missing new_password', 400, { hint: 'Provide new_password for the target user.' });
    
    const u = await Vault.getUser(env, q.user_to_change);
    if (!u) return makePolishedError('user not found', 404, { hint: 'The user does not exist.' });
    
    const validation = validatePassword(q.new_password);
    if (!validation.valid) {
      return makePolishedError('weak password', 400, { hint: validation.reason });
    }
    
    u.password = q.new_password;
    await Vault.saveUser(env, u);
    return jsonResponse({ 
      error: false, 
      message: `Password for user '${q.user_to_change}' changed successfully.`,
      user: q.user_to_change,
      changed_at: new Date().toISOString(),
      hint: 'Notify the user of their new password securely (e.g., via private message).'
    });
  }

  if (endpoint === 'generate_password') {
    // Generate a new random password for an existing user (password reset)
    if (!q.user_to_reset) return makePolishedError('missing user_to_reset', 400, { hint: 'Provide user_to_reset in the request.' });
    
    const u = await Vault.getUser(env, q.user_to_reset);
    if (!u) return makePolishedError('user not found', 404, { hint: 'The user does not exist.' });
    
    const newPassword = generatePassword(PASSWORD_CONFIG.DEFAULT_LENGTH);
    u.password = newPassword;
    await Vault.saveUser(env, u);
    return jsonResponse({ 
      error: false, 
      message: `New password generated for user '${q.user_to_reset}'. Show it to the user securely.`,
      user: q.user_to_reset,
      new_password: newPassword,
      reset_at: new Date().toISOString(),
      hint: 'Share this password securely (never in chat, email only if using HTTPS).'
    });
  }

  if (endpoint === 'edit_user') {
    // ENDPOINT: /admin/edit_user - Modify specific user account field
    // Auth: Requires valid admin credentials
    // Editable Fields: max_time, cooldown, concurrents, max_concurrents,
    //   max_daily_attacks, bypass_slots, api_access, power_saving, suspended, vip, holder, reseller, discord_linked
    // Format: ?user_to_edit=alice&field_to_edit=concurrents&new_value=10
    // Returns: Confirmation with field name and new value
    
    // Use config for allowed fields (prevents accidental privilege escalation)
    const ALLOWED_FIELDS = ADMIN_EDITABLE_FIELDS;
    
    if (!q.user_to_edit || !q.field_to_edit) return makePolishedError('missing parameters', 400, { hint: 'Provide user_to_edit and field_to_edit (e.g., ?user_to_edit=alice&field_to_edit=max_concurrents&new_value=10).' });
    const u = await Vault.getUser(env, q.user_to_edit);
    if (!u) return makePolishedError('user not found', 404, { hint: 'The user does not exist. Verify the username and try again.' });
    
    let fieldName = q.field_to_edit;
    let fieldValue = q.new_value;
    
    // Support field_to_edit=fieldName=value format
    if (!fieldValue && q.field_to_edit.includes('=')) {
      const parts = q.field_to_edit.split('=');
      fieldName = parts[0];
      fieldValue = parts.slice(1).join('=');
    }
    
    if (!fieldName || fieldValue === undefined) return makePolishedError('incomplete field update', 400, { hint: 'Provide both field name and value.' });
    
    // CRITICAL: Verify field is in whitelist (prevents privilege escalation)
    if (!ALLOWED_FIELDS.includes(fieldName)) {
      if (ADMIN_PROTECTED_FIELDS.includes(fieldName)) {
        return makePolishedError('field not editable for security', 403, { hint: `The field '${fieldName}' cannot be edited via this endpoint for security reasons.` });
      }
      return makePolishedError('field not editable', 400, { hint: `Editable fields: ${ALLOWED_FIELDS.join(', ')}. For password changes, use /admin/change_password.` });
    }
    
    // Convert to appropriate type
    u[fieldName] = isNaN(Number(fieldValue)) ? fieldValue : Number(fieldValue);
    await Vault.saveUser(env, u);
    return jsonResponse({ error: false, message: `User '${q.user_to_edit}' field '${fieldName}' updated successfully.`, field: fieldName, new_value: u[fieldName] });
  }

  if (endpoint === 'assign_plan' || endpoint === 'set_plan' || endpoint === 'give_plan') {
    const targetUsername = q.user_to_edit || q.username_to_assign || q.user || '';
    const planName = q.plan_name || q.plan || '';
    if (!targetUsername || !planName) {
      return makePolishedError('missing user or plan', 400, { hint: 'Provide user_to_edit and plan_name.' });
    }

    const user = await Vault.getUser(env, targetUsername);
    if (!user) return makePolishedError('user not found', 404, { hint: 'The user does not exist.' });
    const plan = await Vault.getPlan(env, planName);
    if (!plan) return makePolishedError('plan not found', 404, { hint: `The plan '${planName}' does not exist.` });

    const updatedUser = await Vault.applyPlanToUser(env, targetUsername, plan.name);
    return jsonResponse({
      error: false,
      message: `Plan '${plan.name}' assigned to user '${targetUsername}'.`,
      user: updatedUser
    });
  }

  if (endpoint === 'delete_user') {
    if (!q.user_to_delete) return makePolishedError('missing user_to_delete', 400, { hint: 'Provide user_to_delete in the request.' });
    if (q.user_to_delete === 'root') return makePolishedError('cannot remove root user', 403, { hint: 'Use a different target than the root account.' });
    
    await Vault.deleteUser(env, q.user_to_delete);
    
    // Log audit trail for user deletion
    const sourceIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
    await logAuditAction(env, adminUsername, 'delete_user', q.user_to_delete, { reason: 'User account deleted' }, sourceIp, 'success');
    
    return jsonResponse({ error: false, message: `User '${q.user_to_delete}' has been deleted successfully.` });
  }

  if (endpoint === 'view_user_logs') {
    if (!q.user_to_view) return makePolishedError('missing user_to_view', 400, { hint: 'Provide user_to_view in the request.' });
    const logs = await Vault.getLogs(env, q.user_to_view);
    return structuredResponse({ error: false, message: `Attack logs for user '${q.user_to_view}' have been retrieved.`, data: { user: q.user_to_view, logs } });
  }

  if (endpoint === 'view_user_plan') {
    const targetUsername = q.user_to_view || '';
    if (!targetUsername) {
      return makePolishedError('missing user_to_view parameter', 400, { hint: 'Provide user_to_view=username in the request.' });
    }

    const u = await Vault.getUser(env, targetUsername) || null;
    if (!u) {
      return makePolishedError('user not found', 404, { hint: 'Verify the username before trying again.' });
    }

    const serviceName = requestContext?.serviceName || await resolveServiceName(u, env, env.API_NAME || APP_DEFAULTS.DEFAULT_SERVICE_NAME);
    const [discordLink, lastAttackTime, attacksToday, ongoingAttacks, planSettings] = await Promise.all([
      Vault.getVerifiedDiscordLinkByUsername(env, u.username),
      Vault.getLastAttackTime(env, u.username),
      Vault.countUserDailyAttacks(env, u.username),
      Vault.countUserOngoing(env, u.username),
      Vault.resolveUserPlanSettings(env, u)
    ]);
    const attacksRemaining = Math.max(0, Number(u.max_daily_attacks || 0) - Number(attacksToday || 0));
    
    // Determine plan type and rank
    const planType = planSettings?.plan_name || 'Default';
    let rank = 'User';
    if (u.admin) rank = 'Admin';
    else if (u.reseller) rank = 'Reseller';
    else if (u.holder) rank = 'Holder';
    else if (u.vip) rank = 'VIP';
    
    // Format dates
    const createdAt = u.created_at ? new Date(u.created_at).toISOString() : new Date().toISOString();
    const expiryDate = u.expiry_unix && u.expiry_unix > 0 ? new Date(u.expiry_unix * 1000).toISOString() : null;
    const discordLinkTime = discordLink?.verified_at ? new Date(discordLink.verified_at).toISOString() : null;
    const lastAttackIso = lastAttackTime ? new Date(lastAttackTime).toISOString() : null;
    
    // Flattened response (no nested "user" object)
    return jsonResponse({
      error: false,
      message: 'User plan retrieved successfully.',
      data: {
        username: u.username,
        password: u.password || null,
        admin: Boolean(u.admin),
        vip: Boolean(u.vip),
        holder: Boolean(u.holder),
        reseller: Boolean(u.reseller),
        owner: Boolean(u.owner || false),
        api: Boolean(u.api ?? u.api_access),
        plan_id: planSettings?.plan_id ?? u.plan_id ?? null,
        max_time: Number(u.max_time || 60),
        cooldown: Number(u.cooldown || 10),
        max_concurrents: Number(u.max_concurrents || 1),
        max_daily_attacks: Number(u.max_daily_attacks || 100),
        attacks_today: Number(attacksToday || 0),
        attacks_remaining: attacksRemaining,
        ongoing_attacks: ongoingAttacks,
        power_saving: u.power_saving === undefined || u.power_saving === null || u.power_saving === '' ? true : Boolean(u.power_saving !== 0 && u.power_saving !== false && u.power_saving !== 'false' && u.power_saving !== '0'),
        bypass_power: u.power_saving === undefined || u.power_saving === null || u.power_saving === '' ? false : !Boolean(u.power_saving !== 0 && u.power_saving !== false && u.power_saving !== 'false' && u.power_saving !== '0'),
        bypass_anti_spam: Boolean(u.bypass_anti_spam || false),
        bypass_blacklist: Boolean(u.bypass_blacklist || false),
        raw_access: Boolean(planSettings?.raw_access ?? u.raw_access),
        star_access: Boolean(planSettings?.star_access ?? u.star_access),
        botnet_access: Boolean(planSettings?.botnet_access ?? u.botnet_access),
        private_access: Boolean(planSettings?.private_access ?? u.private_access),
        suspended: Boolean(u.suspended),
        created_by: u.created_by || null,
        created_at: createdAt,
        expiry_date: expiryDate,
        plan_type: planType,
        rank: rank,
        discord_linked: discordLink ? discordLink.discord_user_id : null,
        discord_username: discordLink?.discord_username || null,
        discord_linked_at: discordLinkTime,
        last_attack_time: lastAttackIso,
        last_request_time: u.last_request_time ? new Date(u.last_request_time).toISOString() : new Date().toISOString(),
        last_ip: u.last_ip || null
      }
    }, 200, { service: serviceName });
  }

  if (endpoint === 'unlink_discord') {
    if (!q.user_to_unlink) return makePolishedError('missing user_to_unlink', 400, { hint: 'Provide user_to_unlink in the request.' });
    const result = await Vault.unlinkDiscordLinkByUsername(env, q.user_to_unlink, adminUsername);
    if (!result) return makePolishedError('Discord link not found', 404, { hint: 'This user does not have an active Discord verification to unlink.' });
    return jsonResponse({ error: false, message: `Discord account has been unlinked from user '${q.user_to_unlink}'.`, user: q.user_to_unlink, discord_user_id: result.discord_user_id, discord_username: result.discord_username, unlinked_at: result.unlinked_at });
  }

  if (endpoint === 'view_all_logs') {
    const DBref = Vault.getDB(env);
    if (!DBref) return structuredResponse({ error: false, message: 'Log database is unavailable.', data: { logs: [], pagination: null } });
    const limit = q.limit || 50;
    const offset = q.offset || 0;
    const { limit: validLimit, offset: validOffset } = validatePaginationParams(limit, offset);
    
    const [countRes, logsRes] = await Promise.all([
      DBref.prepare('SELECT COUNT(*) AS total FROM logs').all(),
      DBref.prepare(`SELECT * FROM logs ORDER BY id DESC LIMIT ? OFFSET ?`).bind(validLimit, validOffset).all()
    ]);
    const total = countRes?.results?.[0]?.total || 0;
    const logs = logsRes.results || [];
    const totalPages = Math.ceil(total / validLimit);
    const page = Math.floor(validOffset / validLimit) + 1;
    
    return structuredResponse({ 
      error: false, 
      message: `System logs retrieved (${logs.length} of ${total} entries).`, 
      data: { 
        logs,
        pagination: {
          total, limit: validLimit, offset: validOffset, page, pages: totalPages,
          has_next: page < totalPages, has_prev: page > 1
        }
      } 
    });
  }

  if (endpoint === 'view_audit_logs') {
    const limit = Number(q.limit || 50);
    const offset = Number(q.offset || 0);
    const auditData = await getAuditLogs(env, { limit, offset });
    const validLimit = Math.max(1, Number.isFinite(limit) ? limit : 50);
    const validOffset = Math.max(0, Number.isFinite(offset) ? offset : 0);
    const totalPages = Math.max(1, Math.ceil((auditData.total || 0) / validLimit));
    const page = Math.floor(validOffset / validLimit) + 1;

    return structuredResponse({
      error: false,
      message: `Audit logs retrieved (${(auditData.logs || []).length} of ${auditData.total || 0} entries).`,
      data: {
        logs: auditData.logs || [],
        pagination: {
          total: auditData.total || 0,
          limit: validLimit,
          offset: validOffset,
          page,
          pages: totalPages,
          has_next: page < totalPages,
          has_prev: page > 1
        }
      }
    });
  }

  if (endpoint === 'view_all_users') {
    const users = await Vault.listUsers(env);
    const limit = q.limit || 50;
    const offset = q.offset || 0;
    const paginatedResult = paginate(users || [], limit, offset);
    // Sanitize passwords from user list
    const sanitizedUsers = paginatedResult.items.map(u => sanitizeUserForResponse(u));
    
    // Flattened response structure
    return jsonResponse({ 
      error: false, 
      message: `System users retrieved (${sanitizedUsers.length} of ${paginatedResult.total} users).`, 
      data: sanitizedUsers,
      pagination: {
        total: paginatedResult.total, 
        limit: paginatedResult.limit, 
        offset: paginatedResult.offset,
        page: paginatedResult.page, 
        pages: paginatedResult.pages,
        has_next: paginatedResult.has_next, 
        has_prev: paginatedResult.has_prev
      }
    }, 200);
  }

  if (endpoint === 'syntax_check') {
    const source = q.source || q.code || '';
    if (!source) return makePolishedError('missing source', 400, { hint: 'Provide the source code to validate.' });
    const result = checkJavaScriptSyntax(source, q.file_name || q.file || 'inline.js');
    if (!result.valid) {
      return structuredResponse({ error: true, message: 'Code syntax validation failed.', status: 400, extra: { debug: result } });
    }
    return structuredResponse({ error: false, message: 'Code syntax is valid and error-free.', data: { valid: true, file: q.file_name || q.file || 'inline.js' } });
  }

  if (endpoint === 'list_methods') {
    const dbMethods = await Vault.listMethods(env);
    const limit = q.limit || 50;
    const offset = q.offset || 0;
    const payloadMethods = getPayloadMethods();
    const methodMap = new Map((payloadMethods || []).map((item) => [String(item?.name || '').toLowerCase(), item]));

    const methods = (dbMethods || [])
      .map((method) => {
        const meta = methodMap.get(String(method?.name || '').toLowerCase()) || null;
        const enabledValue = method?.enabled ?? meta?.enabled ?? true;
        return {
          id: method?.id || null,
          name: method?.name || null,
          description: method?.description || meta?.description || `${method?.name || 'method'} method`,
          created_at: method?.created_at || null,
          enabled: Boolean(Number(enabledValue)),
          target_type: meta?.target_type || method?.target_type || null,
          default_port: meta?.default_port ?? method?.default_port ?? null,
          max_time: meta?.max_time ?? method?.max_time ?? null,
          max_concurrents: meta?.max_concurrents ?? method?.max_concurrents ?? null,
          max_slots: meta?.max_slots ?? method?.max_slots ?? null,
          api_links: Array.isArray(meta?.api_links) ? meta.api_links : []
        };
      })
      .sort((a, b) => {
        const aId = Number(a?.id ?? Number.MAX_SAFE_INTEGER);
        const bId = Number(b?.id ?? Number.MAX_SAFE_INTEGER);
        return aId - bId;
      });
    
    const paginatedResult = paginate(methods, limit, offset);

    return structuredResponse({ 
      error: false, 
      message: `Attack methods retrieved (${paginatedResult.items.length} of ${paginatedResult.total} methods).`, 
      data: { 
        methods: paginatedResult.items,
        pagination: {
          total: paginatedResult.total, limit: paginatedResult.limit, offset: paginatedResult.offset,
          page: paginatedResult.page, pages: paginatedResult.pages,
          has_next: paginatedResult.has_next, has_prev: paginatedResult.has_prev
        }
      } 
    });
  }

  if (endpoint === 'add_blacklist') {
    if (!q.target) return makePolishedError('missing target', 400, { hint: 'Provide the target to blacklist.' });
    await Vault.addBlacklistTarget(env, q.target, q.reason || 'manual');
    return jsonResponse({ error: false, message: `Target '${q.target}' has been added to the blacklist.` });
  }

  if (endpoint === 'list_blacklist') {
    const data = await Vault.listBlacklist(env);
    const limit = q.limit || 50;
    const offset = q.offset || 0;
    const paginatedResult = paginate(data || [], limit, offset);
    
    return structuredResponse({ 
      error: false, 
      message: `Blacklist entries retrieved (${paginatedResult.items.length} of ${paginatedResult.total} entries).`, 
      data: { 
        blacklist: paginatedResult.items,
        pagination: {
          total: paginatedResult.total, limit: paginatedResult.limit, offset: paginatedResult.offset,
          page: paginatedResult.page, pages: paginatedResult.pages,
          has_next: paginatedResult.has_next, has_prev: paginatedResult.has_prev
        }
      } 
    });
  }

  if (endpoint === 'remove_blacklist') {
    if (!q.target && !q.id) return makePolishedError('missing target or id', 400, { hint: 'Provide either the blacklist target or its id.' });
    await Vault.removeBlacklistTarget(env, q.target || q.id);
    return jsonResponse({ error: false, message: 'Blacklist entry has been removed.' });
  }

  if (endpoint === 'suspend_user') {
    if (!q.user_to_suspend) return makePolishedError('missing user_to_suspend', 400, { hint: 'Provide the target username to suspend.' });
    const reason = q.reason || 'Suspended by admin action.';
    const actor = adminUsername || 'admin';
    await Vault.setUserSuspension(env, q.user_to_suspend, true, reason, actor);
    
    const sourceIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
    await logAuditAction(env, adminUsername, 'suspend_user', q.user_to_suspend, { reason }, sourceIp, 'success');
    
    return jsonResponse({ error: false, message: `User '${q.user_to_suspend}' has been suspended.`, user: q.user_to_suspend, suspended_by: actor, suspend_reason: reason });
  }

  if (endpoint === 'unsuspend_user') {
    if (!q.user_to_unsuspend) return makePolishedError('missing user_to_unsuspend', 400, { hint: 'Provide the target username to unsuspend.' });
    await Vault.setUserSuspension(env, q.user_to_unsuspend, false, null, null);
    return jsonResponse({ error: false, message: `User '${q.user_to_unsuspend}' has been unsuspended.`, user: q.user_to_unsuspend });
  }

  if (endpoint === 'stats') {
    // Admin statistics endpoint
    const statistics = await Vault.getAdminStatistics(env);
    const users = statistics.users || {};
    
    return jsonResponse({
      error: false,
      message: 'Admin statistics loaded',
      stats: {
        total_users: users.total || 0,
        suspended_users: users.suspended || 0,
        admin_users: users.admin || 0,
        reseller_users: users.reseller || 0,
        vip_users: users.vip || 0,
        total_methods: statistics.methods,
        blacklist_entries: statistics.blacklist,
        ongoing_attacks: statistics.ongoing,
        timestamp: new Date().toISOString()
      }
    });
  }

  // Maintenance mode toggle endpoint
  if (endpoint === 'maintenance' || endpoint === 'maintenance_mode') {
    const action = String(q.action || 'toggle').toLowerCase();
    const enabled = action === 'enable' ? true : action === 'disable' ? false : null;
    
    if (enabled === null) {
      // Return current status
      const isEnabled = await Vault.getMaintenanceMode(env);
      return jsonResponse({
        error: false,
        message: 'Maintenance mode status retrieved',
        maintenance_mode: isEnabled,
        status: isEnabled ? 'ENABLED - API is in maintenance' : 'DISABLED - API is operational'
      });
    }
    
    // Set maintenance mode
    await Vault.setMaintenanceMode(env, enabled);
    return jsonResponse({
      error: false,
      message: `Maintenance mode ${enabled ? 'enabled' : 'disabled'}`,
      maintenance_mode: enabled,
      status: enabled ? '🔴 API is now in maintenance mode' : '🟢 API is operational'
    });
  }

  // Database cleanup endpoint
  if (endpoint === 'cleanup' || endpoint === 'db_cleanup') {
    const retentionDays = Number(q.retention_days || 30);
    if (retentionDays < 1 || retentionDays > 365) {
      return makePolishedError('retention_days must be between 1 and 365', 400);
    }
    
    const result = await Vault.cleanupOldLogs(env, retentionDays);
    if (result.error) {
      return makePolishedError(`Cleanup failed: ${result.error}`, 500);
    }
    
    // Also get database stats
    const stats = await Vault.getDatabaseStats(env);
    
    return jsonResponse({
      error: false,
      message: `Database cleanup completed - removed ${result.deleted} old records`,
      cleanup_result: {
        deleted_records: result.deleted,
        retention_days: retentionDays,
        timestamp: new Date().toISOString()
      },
      database_stats: stats
    });
  }

  // Database stats endpoint
  if (endpoint === 'db_stats' || endpoint === 'stats_db') {
    const stats = await Vault.getDatabaseStats(env);
    if (stats.error) {
      return makePolishedError(`Failed to get stats: ${stats.error}`, 500);
    }
    
    return jsonResponse({
      error: false,
      message: 'Database statistics retrieved',
      data: stats
    });
  }

  // Sync methods from payload.js to database
  if (endpoint === 'sync_methods' || endpoint === 'methods_sync') {
    const result = await Vault.syncMethodsFromPayload(env);
    if (result.error) {
      return makePolishedError(`Sync failed: ${result.error}`, 500);
    }
    
    return jsonResponse({
      error: false,
      message: `Methods synced from payload.js - ${result.added} added, ${result.updated} updated`,
      sync_result: {
        methods_added: result.added,
        methods_updated: result.updated,
        timestamp: new Date().toISOString()
      }
    });
  }

  // Disable/enable attacks globally
  if (endpoint === 'disable_attacks' || endpoint === 'attacks_disable') {
    // ENDPOINT: /admin/disable_attacks - Toggle attacks globally on/off
    // Auth: Requires valid admin credentials
    // Parameters: action=enable|disable|toggle (or ?mode=true/false)
    // Returns: Current attacks status
    // Use Case: Disable all attacks when doing maintenance, testing, or security lockdown
    
    const action = (q.action || q.mode || 'status').toString().toLowerCase();
    let disabled = null;
    
    if (action === 'enable' || action === 'false') {
      disabled = false;
    } else if (action === 'disable' || action === 'true') {
      disabled = true;
    }
    
    if (disabled !== null) {
      await Vault.setAttacksDisabled(env, disabled);
      return jsonResponse({
        error: false,
        message: `Attacks ${disabled ? 'disabled' : 'enabled'} globally`,
        attacks_disabled: disabled,
        status: disabled ? '🔴 All attacks are currently disabled' : '🟢 Attacks are enabled'
      });
    } else {
      // Return current status
      const currentStatus = await Vault.getAttacksDisabled(env);
      return jsonResponse({
        error: false,
        message: 'Attacks status retrieved',
        attacks_disabled: currentStatus,
        status: currentStatus ? '🔴 All attacks are currently disabled' : '🟢 Attacks are enabled'
      });
    }
  }

  // Edit plan properties (attack limits)
  if (endpoint === 'edit_plan') {
    // ENDPOINT: /admin/edit_plan - Modify plan attack limits
    // Auth: Requires valid admin credentials
    // Parameters: plan_name (required), max_time/max_concurrents/max_daily_attacks (optional)
    // Returns: Updated plan details
    
    if (!q.plan_name) {
      return makePolishedError('missing plan_name', 400, { hint: 'Provide plan_name parameter.' });
    }
    
    const updates = {};
    if (q.max_time !== undefined) updates.max_time = Number(q.max_time);
    if (q.max_concurrents !== undefined) updates.max_concurrents = Number(q.max_concurrents);
    if (q.max_daily_attacks !== undefined) updates.max_daily_attacks = Number(q.max_daily_attacks);
    
    if (Object.keys(updates).length === 0) {
      return makePolishedError('no updates provided', 400, { hint: 'Provide at least one parameter to update (max_time, max_concurrents, max_daily_attacks).' });
    }
    
    try {
      await Vault.updatePlan(env, q.plan_name, updates);
      const plan = await Vault.getPlan(env, q.plan_name);
      if (!plan) {
        return makePolishedError('plan not found', 404, { hint: 'The plan does not exist.' });
      }
      
      return jsonResponse({
        error: false,
        message: `Plan '${q.plan_name}' updated successfully.`,
        plan: plan
      });
    } catch (e) {
      return makePolishedError(`Failed to update plan: ${e.message}`, 500);
    }
  }

  // Edit method access levels
  if (endpoint === 'edit_method') {
    // ENDPOINT: /admin/edit_method - Configure which ranks/plans can use a method
    // Auth: Requires valid admin credentials
    // Parameters: method_name (required), default_access/vip/reseller/admin/max_time/raw_access/star_access/botnet_access/private_access (0 or 1 / integer)
    // Returns: Updated method details with access config
    
    if (!q.method_name) {
      return makePolishedError('missing method_name', 400, { hint: 'Provide method_name parameter.' });
    }
    
    const updates = {};
    if (q.default_access !== undefined || q.default_user !== undefined) {
      updates.default_access = Number(q.default_access ?? q.default_user) ? 1 : 0;
    }
    if (q.vip !== undefined || q.vip_user !== undefined) {
      updates.vip = Number(q.vip ?? q.vip_user) ? 1 : 0;
    }
    if (q.reseller !== undefined) updates.reseller = Number(q.reseller) ? 1 : 0;
    if (q.admin !== undefined) updates.admin = Number(q.admin) ? 1 : 0;
    if (q.max_time !== undefined) updates.max_time = q.max_time === null || q.max_time === '' ? null : Number(q.max_time);
    if (q.raw_access !== undefined) updates.raw_access = Number(q.raw_access) ? 1 : 0;
    if (q.star_access !== undefined) updates.star_access = Number(q.star_access) ? 1 : 0;
    if (q.botnet_access !== undefined) updates.botnet_access = Number(q.botnet_access) ? 1 : 0;
    if (q.private_access !== undefined) updates.private_access = Number(q.private_access) ? 1 : 0;
    
    if (Object.keys(updates).length === 0) {
      return makePolishedError('no updates provided', 400, { hint: 'Provide at least one access level or time value (default_access, vip, reseller, admin, max_time, raw_access, star_access, botnet_access, private_access) set appropriately.' });
    }
    
    try {
      await Vault.updateMethod(env, q.method_name, updates);
      const method = await Vault.getMethod(env, q.method_name);
      if (!method) {
        return makePolishedError('method not found', 404, { hint: 'The method does not exist.' });
      }
      
      return jsonResponse({
        error: false,
        message: `Method '${q.method_name}' access levels updated successfully.`,
        method: method,
        access_config: {
          default_access: method.default_access,
          vip: method.vip,
          reseller: method.reseller,
          admin: method.admin,
          max_time: method.max_time ?? null,
          raw_access: method.raw_access,
          star_access: method.star_access,
          botnet_access: method.botnet_access,
          private_access: method.private_access
        }
      });
    } catch (e) {
      return makePolishedError(`Failed to update method: ${e.message}`, 500);
    }
  }

  // Service settings endpoint (get/set service name and version)
  if (endpoint === 'service_settings' || endpoint === 'config_settings') {
    const action = String(q.action || 'get').toLowerCase();
    
    if (action === 'get') {
      const serviceName = await Vault.getServiceName(env);
      const apiVersion = await Vault.getApiVersion(env);
      return jsonResponse({
        error: false,
        message: 'Service settings retrieved',
        settings: {
          service_name: serviceName,
          api_version: apiVersion
        }
      });
    }
    
    if (action === 'set') {
      if (!q.service_name && !q.api_version) {
        return makePolishedError('provide at least one of: service_name, api_version', 400, { hint: 'Example: ?action=set&service_name=MyAPI&api_version=2.0.0' });
      }
      
      if (q.service_name) {
        await Vault.setServiceName(env, q.service_name);
      }
      if (q.api_version) {
        await Vault.setApiVersion(env, q.api_version);
      }
      
      const updatedName = await Vault.getServiceName(env);
      const updatedVersion = await Vault.getApiVersion(env);
      
      await logAuditAction(env, adminUsername, 'update_service_settings', null, { 
        service_name: q.service_name || null,
        api_version: q.api_version || null
      }, sourceIp, 'success');
      
      return jsonResponse({
        error: false,
        message: 'Service settings updated successfully',
        settings: {
          service_name: updatedName,
          api_version: updatedVersion
        }
      });
    }
    
    return makePolishedError('unknown action', 400, { hint: 'Use ?action=get or ?action=set' });
  }

  return routeNotFound();
}
