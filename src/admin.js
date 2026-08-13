// Admin route handlers for user, method, blacklist, and misc controls.
import { jsonResponse, structuredResponse, parseQuery, routeNotFound, resolveServiceName, makePolishedError, checkJavaScriptSyntax } from './response.js';
import * as Vault from './vault-db.js';
import { getPayloadMethods } from '../payload.js';
import { sanitizeUserForResponse, sanitizeUsersForResponse, paginate, validatePaginationParams, buildMessage, buildMetadata, checkApiRateLimit, applyGlobalRateLimit } from './helpers.js';
import { PASSWORD_CONFIG, ADMIN_PROTECTED_FIELDS, ADMIN_EDITABLE_FIELDS } from './config.js';

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
  // Password should be at least 8 chars, have uppercase, lowercase, number
  if (!password || password.length < PASSWORD_CONFIG.REQUIREMENT.minLength) {
    return { valid: false, reason: `Password must be at least ${PASSWORD_CONFIG.REQUIREMENT.minLength} characters long.` };
  }
  if (PASSWORD_CONFIG.REQUIREMENT.hasUppercase && !/[A-Z]/.test(password)) {
    return { valid: false, reason: 'Password must contain at least one uppercase letter.' };
  }
  if (PASSWORD_CONFIG.REQUIREMENT.hasLowercase && !/[a-z]/.test(password)) {
    return { valid: false, reason: 'Password must contain at least one lowercase letter.' };
  }
  if (PASSWORD_CONFIG.REQUIREMENT.hasNumbers && !/[0-9]/.test(password)) {
    return { valid: false, reason: 'Password must contain at least one number.' };
  }
  return { valid: true, reason: 'OK' };
}

async function requireAdminCredentials(q, env) {
  const username = String(q.username || '').trim();
  const password = String(q.password || '').trim();

  if (!username || !password) {
    return { ok: false, response: makePolishedError('admin authentication required', 401, { hint: 'Provide username and password as query parameters for the admin route.' }) };
  }

  const admin = await Vault.getUser(env, username);
  if (!admin || admin.password !== password || !admin.admin) {
    return { ok: false, response: makePolishedError('invalid admin credentials', 401, { hint: 'Use a valid administrator account and its matching password.' }) };
  }

  return { ok: true, admin };
}

export async function adminHandler(parts, request, env) {
  const q = parseQuery(request);
  const endpoint = parts[0] || '';
  const adminUsername = String(q.username || '').trim();

  // Validate admin credentials first
  const guard = await requireAdminCredentials(q, env);
  if (!guard.ok) return guard.response;
  
  const admin = await Vault.getUser(env, adminUsername);
  
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
    //   - password_to_add (optional): Password for new user (auto-generated if not provided)
    //   - allowed_methods, allowed_targets: Attack restrictions
    //   - service_name: Service/plan identifier
    //   - suspended, bypass_slots: Account flags
    // Returns: User object with password if auto-generated
    
    const adminUser = q.username;
    const adminPass = q.password;
    const admin = adminUser ? await Vault.getUser(env, adminUser) : null;
    if (admin && admin.password !== adminPass) return makePolishedError('invalid admin credentials', 401, { hint: 'Use the correct admin username and password.' });
    if (!q.username_to_add) return makePolishedError('missing username_to_add', 400, { hint: 'Provide username_to_add in the request.' });
    
    // Prevent duplicate users - check if username already exists
    const existingUser = await Vault.getUser(env, q.username_to_add);
    if (existingUser) return makePolishedError('username already exists', 409, { hint: `User '${q.username_to_add}' already exists. Choose a different username or use /admin/edit_user to modify.` });
    
    // Auto-generate password if not provided (ensures strength compliance)
    let userPassword = q.password_to_add || null;
    let passwordGenerated = false;
    if (!userPassword) {
      userPassword = generatePassword(12);
      passwordGenerated = true;
    } else {
      // Validate provided password
      const validation = validatePassword(userPassword);
      if (!validation.valid) {
        return makePolishedError('weak password', 400, { hint: validation.reason });
      }
    }
    
    const inheritedServiceName = admin?.service_name || (admin?.reseller ? q.service_name || admin?.service_name : null) || null;
    let user = {
      username: q.username_to_add,
      password: userPassword,
      admin: 0,
      reseller: 0,
      vip: 0,
      holder: 0,
      api_access: 0,
      max_time: 60,
      min_time: 30,
      cooldown: 45,
      max_concurrents: 1,
      max_daily_attacks: 100,
      created_by: adminUser || 'root',
      expiry_unix: 0,
      allowed_methods: q.allowed_methods || null,
      allowed_targets: q.allowed_targets || null,
      bypass_slots: Number(q.bypass_slots || 0),
      suspended: Number(q.suspended || 0),
      service_name: q.service_name || inheritedServiceName || null
    };
    
    await Vault.saveUser(env, user);
    
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
      created_by: adminUser || 'root',
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
    
    const newPassword = generatePassword(12);
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
    // Editable Fields: max_time, min_time, cooldown, concurrents, max_concurrents,
    //   max_daily_attacks, bypass_slots, service_name, allowed_methods, allowed_targets,
    //   api_access, power_saving, suspended, vip, holder, reseller, discord_linked
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

  if (endpoint === 'delete_user') {
    if (!q.user_to_delete) return makePolishedError('missing user_to_delete', 400, { hint: 'Provide user_to_delete in the request.' });
    if (q.user_to_delete === 'root') return makePolishedError('cannot remove root user', 403, { hint: 'Use a different target than the root account.' });
    await Vault.deleteUser(env, q.user_to_delete);
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

    const warnings = await Vault.getUserWarnings(env, u.username);
    const serviceName = await resolveServiceName(u, env, env.API_NAME || 'CAPI');
    const discordLink = await Vault.getVerifiedDiscordLinkByUsername(env, u.username);
    const lastAttackTime = await Vault.getLastAttackTime(env, u.username);
    const attacksToday = await Vault.countUserDailyAttacks(env, u.username);
    const attacksRemaining = Math.max(0, Number(u.max_daily_attacks || 0) - Number(attacksToday || 0));
    const ongoingAttacks = await Vault.countUserOngoing(env, u.username);
    
    // Determine plan type and rank
    let planType = 'Free';
    let rank = 'User';
    if (u.admin) { planType = 'Admin'; rank = 'Administrator'; }
    else if (u.reseller) { planType = 'Reseller'; rank = 'Reseller'; }
    else if (u.holder) { planType = 'Holder'; rank = 'Holder'; }
    else if (u.vip) { planType = 'VIP'; rank = 'VIP'; }
    
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
        admin: Boolean(u.admin),
        vip: Boolean(u.vip),
        holder: Boolean(u.holder),
        reseller: Boolean(u.reseller),
        owner: Boolean(u.owner || false),
        api: Boolean(u.api_access),
        max_time: Number(u.max_time || 60),
        min_time: Number(u.min_time || 30),
        cooldown: Number(u.cooldown || 45),
        max_concurrents: Number(u.max_concurrents || 1),
        max_daily_attacks: Number(u.max_daily_attacks || 100),
        attacks_today: Number(attacksToday || 0),
        attacks_remaining: attacksRemaining,
        ongoing_attacks: ongoingAttacks,
        power_saving: Boolean(u.power_saving !== 0),
        bypass_power: Boolean(u.power_saving === 0),
        bypass_anti_spam: Boolean(u.bypass_anti_spam || false),
        bypass_blacklist: Boolean(u.bypass_blacklist || false),
        suspended: Boolean(u.suspended),
        created_by: u.created_by || null,
        created_at: createdAt,
        expiry_date: expiryDate,
        service_name: serviceName,
        warnings: Number(warnings.count || 0),
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
    const adminUser = q.username;
    const adminPass = q.password;
    const admin = adminUser ? await Vault.getUser(env, adminUser) : null;
    if (!admin || admin.password !== adminPass || !admin.admin) return makePolishedError('invalid admin credentials', 401, { hint: 'Use a valid admin account to unlink Discord verification.' });
    if (!q.user_to_unlink) return makePolishedError('missing user_to_unlink', 400, { hint: 'Provide user_to_unlink in the request.' });
    const result = await Vault.unlinkDiscordLinkByUsername(env, q.user_to_unlink, adminUser);
    if (!result) return makePolishedError('Discord link not found', 404, { hint: 'This user does not have an active Discord verification to unlink.' });
    return jsonResponse({ error: false, message: `Discord account has been unlinked from user '${q.user_to_unlink}'.`, user: q.user_to_unlink, discord_user_id: result.discord_user_id, discord_username: result.discord_username, unlinked_at: result.unlinked_at });
  }

  if (endpoint === 'view_all_logs') {
    const DBref = Vault.getDB(env);
    if (!DBref) return structuredResponse({ error: false, message: 'Log database is unavailable.', data: { logs: [], pagination: null } });
    const limit = q.limit || 50;
    const offset = q.offset || 0;
    const { limit: validLimit, offset: validOffset } = validatePaginationParams(limit, offset);
    
    const countRes = await DBref.prepare('SELECT COUNT(*) AS total FROM logs').all();
    const total = countRes?.results?.[0]?.total || 0;
    const res = await DBref.prepare(`SELECT * FROM logs ORDER BY id DESC LIMIT ? OFFSET ?`).bind(validLimit, validOffset).all();
    const logs = res.results || [];
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

  if (endpoint === 'add_api') {
    const adminUser = q.username;
    const adminPass = q.password;
    const admin = adminUser ? await Vault.getUser(env, adminUser) : null;
    if (admin && admin.password !== adminPass) return jsonResponse({ error: true, message: 'invalid admin credentials' }, 401);
    if (!q.url) return makePolishedError('missing url', 400, { hint: 'Provide the target URL for the new API endpoint.' });
    await Vault.addAPI(env, { name: q.name || 'api', url: q.url, method: q.method || 'GET', active: q.active ? 1 : 1 });
    return jsonResponse({ error: false, message: `API endpoint '${q.name || 'api'}' has been registered.` });
  }

  if (endpoint === 'list_apis') {
    const adminUser = q.username;
    const adminPass = q.password;
    const admin = adminUser ? await Vault.getUser(env, adminUser) : null;
    if (admin && admin.password !== adminPass) return jsonResponse({ error: true, message: 'invalid admin credentials' }, 401);
    const apis = await Vault.listAPIs(env);
    return jsonResponse({ error: false, message: `API endpoints retrieved (${(apis || []).length} endpoints registered).`, apis });
  }

  if (endpoint === 'delete_api') {
    const adminUser = q.username;
    const adminPass = q.password;
    const admin = adminUser ? await Vault.getUser(env, adminUser) : null;
    if (admin && admin.password !== adminPass) return jsonResponse({ error: true, message: 'invalid admin credentials' }, 401);
    if (!q.id) return makePolishedError('missing id', 400, { hint: 'Provide the numeric id of the API endpoint to remove.' });
    await Vault.deleteAPI(env, q.id);
    return jsonResponse({ error: false, message: 'API endpoint has been deleted successfully.' });
  }

  if (endpoint === 'add_method') {
    const adminUser = q.username;
    const adminPass = q.password;
    const admin = adminUser ? await Vault.getUser(env, adminUser) : null;
    if (admin && admin.password !== adminPass) return jsonResponse({ error: true, message: 'invalid admin credentials' }, 401);
    if (!q.name) return makePolishedError('missing name', 400, { hint: 'Provide a method name for the new method.' });
    await Vault.addMethod(env, { name: q.name, description: q.description || `${q.name} method` });
    return jsonResponse({ error: false, message: `Attack method '${q.name}' has been registered successfully.` });
  }

  if (endpoint === 'list_methods') {
    const dbMethods = await Vault.listMethods(env);
    const limit = q.limit || 50;
    const offset = q.offset || 0;
    const payloadMethods = getPayloadMethods();
    const methodMap = new Map((payloadMethods || []).map((item) => [String(item?.name || '').toLowerCase(), item]));

    const methods = (dbMethods || []).map((method) => {
      const meta = methodMap.get(String(method?.name || '').toLowerCase()) || null;
      return {
        id: method?.id || null,
        name: method?.name || null,
        description: method?.description || meta?.description || `${method?.name || 'method'} method`,
        created_at: method?.created_at || null,
        enabled: Boolean(meta?.enabled ?? true),
        target_type: meta?.target_type || null,
        default_port: meta?.default_port || null,
        min_time: meta?.min_time || null,
        max_time: meta?.max_time || null,
        max_concurrents: meta?.max_concurrents || null,
        max_slots: meta?.max_slots || null,
        api_links: Array.isArray(meta?.api_links) ? meta.api_links : []
      };
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
    const adminUser = q.username;
    const adminPass = q.password;
    const admin = adminUser ? await Vault.getUser(env, adminUser) : null;
    if (admin && admin.password !== adminPass) return jsonResponse({ error: true, message: 'invalid admin credentials' }, 401);
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
    const adminUser = q.username;
    const adminPass = q.password;
    const admin = adminUser ? await Vault.getUser(env, adminUser) : null;
    if (admin && admin.password !== adminPass) return jsonResponse({ error: true, message: 'invalid admin credentials' }, 401);
    if (!q.target && !q.id) return makePolishedError('missing target or id', 400, { hint: 'Provide either the blacklist target or its id.' });
    await Vault.removeBlacklistTarget(env, q.target || q.id);
    return jsonResponse({ error: false, message: 'Blacklist entry has been removed.' });
  }

  if (endpoint === 'suspend_user') {
    const adminUser = q.username;
    const adminPass = q.password;
    const admin = adminUser ? await Vault.getUser(env, adminUser) : null;
    if (admin && admin.password !== adminPass) return jsonResponse({ error: true, message: 'invalid admin credentials' }, 401);
    if (!q.user_to_suspend) return makePolishedError('missing user_to_suspend', 400, { hint: 'Provide the target username to suspend.' });
    const reason = q.reason || 'Suspended by admin action.';
    const actor = adminUser || 'admin';
    await Vault.setUserSuspension(env, q.user_to_suspend, true, reason, actor);
    return jsonResponse({ error: false, message: `User '${q.user_to_suspend}' has been suspended.`, user: q.user_to_suspend, suspended_by: actor, suspend_reason: reason });
  }

  if (endpoint === 'unsuspend_user') {
    const adminUser = q.username;
    const adminPass = q.password;
    const admin = adminUser ? await Vault.getUser(env, adminUser) : null;
    if (admin && admin.password !== adminPass) return jsonResponse({ error: true, message: 'invalid admin credentials' }, 401);
    if (!q.user_to_unsuspend) return makePolishedError('missing user_to_unsuspend', 400, { hint: 'Provide the target username to unsuspend.' });
    await Vault.clearUserWarnings(env, q.user_to_unsuspend);
    await Vault.setUserSuspension(env, q.user_to_unsuspend, false, null, null);
    return jsonResponse({ error: false, message: `User '${q.user_to_unsuspend}' has been unsuspended and all warnings cleared.`, user: q.user_to_unsuspend });
  }

  if (endpoint === 'stats') {
    // Admin statistics endpoint
    const users = await Vault.listUsers(env);
    const methods = await Vault.listMethods(env);
    const blacklist = await Vault.listBlacklist(env);
    const ongoing = await Vault.listOngoing(env);
    
    const suspendedCount = (users || []).filter(u => u.suspended).length;
    const adminCount = (users || []).filter(u => u.admin).length;
    const resellerCount = (users || []).filter(u => u.reseller).length;
    const vipCount = (users || []).filter(u => u.vip).length;
    
    return jsonResponse({
      error: false,
      message: 'Admin statistics loaded',
      stats: {
        total_users: users?.length || 0,
        suspended_users: suspendedCount,
        admin_users: adminCount,
        reseller_users: resellerCount,
        vip_users: vipCount,
        total_methods: methods?.length || 0,
        blacklist_entries: blacklist?.length || 0,
        ongoing_attacks: ongoing?.length || 0,
        timestamp: new Date().toISOString()
      }
    });
  }

  if (endpoint === 'key_info') {
    return structuredResponse({ error: false, message: 'license info loaded', data: { created_by: 'root', days_remaining: '973.69', dev_infos: 'capi.dev', dlc_status: 'true', ip_address: 'IP ADDRESS', license_key: 'License Key', product_name: 'CAPI / CapySploit', royal_src_version: '1.8.7.2' } });
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

  // Add warning to user
  if (endpoint === 'warn_user' || endpoint === 'add_warn') {
    // ENDPOINT: /admin/warn_user - Add violation warning to user
    // Auth: Requires valid admin credentials
    // Parameters: user_to_warn (required), reason (optional)
    // Returns: Updated user with new warn count
    // Auto-suspend: If warn_count >= 5, user is suspended
    
    if (!q.user_to_warn) {
      return makePolishedError('missing user_to_warn', 400, { hint: 'Provide user_to_warn parameter.' });
    }
    
    const reason = q.reason || 'violation';
    const updatedUser = await Vault.addUserWarning(env, q.user_to_warn, reason);
    
    if (!updatedUser) {
      return makePolishedError('user not found', 404, { hint: 'The user does not exist.' });
    }
    
    const message = updatedUser.warn_count >= 5 
      ? `⚠️ User '${q.user_to_warn}' warned (${updatedUser.warn_count} total). AUTO-SUSPENDED due to repeated violations.`
      : `⚠️ User '${q.user_to_warn}' warned (${updatedUser.warn_count} total).`;
    
    return jsonResponse({
      error: false,
      message: message,
      user: q.user_to_warn,
      warn_count: updatedUser.warn_count,
      reason: reason,
      suspended: updatedUser.suspended ? true : false,
      warning_threshold: 5
    });
  }

  // Edit rank properties (access levels)
  if (endpoint === 'edit_rank') {
    // ENDPOINT: /admin/edit_rank - Modify rank properties
    // Auth: Requires valid admin credentials
    // Parameters: rank_name (required), access_level (0=basic, 1=elevated)
    // Returns: Updated rank details
    
    if (!q.rank_name) {
      return makePolishedError('missing rank_name', 400, { hint: 'Provide rank_name parameter (Admin, Reseller, User).' });
    }
    
    const accessLevel = q.access_level !== undefined ? Number(q.access_level) : null;
    if (accessLevel !== null && (accessLevel < 0 || accessLevel > 1)) {
      return makePolishedError('invalid access_level', 400, { hint: 'access_level must be 0 (basic) or 1 (elevated).' });
    }
    
    try {
      if (accessLevel !== null) {
        await Vault.updateRank(env, q.rank_name, { access_level: accessLevel });
      }
      const rank = await Vault.getRank(env, q.rank_name);
      if (!rank) {
        return makePolishedError('rank not found', 404, { hint: 'The rank does not exist.' });
      }
      
      return jsonResponse({
        error: false,
        message: `Rank '${q.rank_name}' updated successfully.`,
        rank: rank
      });
    } catch (e) {
      return makePolishedError(`Failed to update rank: ${e.message}`, 500);
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
    // Parameters: method_name (required), default_user/vip_user/reseller/admin (0 or 1)
    // Returns: Updated method details with access config
    
    if (!q.method_name) {
      return makePolishedError('missing method_name', 400, { hint: 'Provide method_name parameter.' });
    }
    
    const updates = {};
    if (q.default_user !== undefined) updates.default_user = Number(q.default_user) ? 1 : 0;
    if (q.vip_user !== undefined) updates.vip_user = Number(q.vip_user) ? 1 : 0;
    if (q.reseller !== undefined) updates.reseller = Number(q.reseller) ? 1 : 0;
    if (q.admin !== undefined) updates.admin = Number(q.admin) ? 1 : 0;
    
    if (Object.keys(updates).length === 0) {
      return makePolishedError('no updates provided', 400, { hint: 'Provide at least one access level (default_user, vip_user, reseller, admin) set to 0 or 1.' });
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
          default_user: method.default_user,
          vip_user: method.vip_user,
          reseller: method.reseller,
          admin: method.admin
        }
      });
    } catch (e) {
      return makePolishedError(`Failed to update method: ${e.message}`, 500);
    }
  }

  return routeNotFound();
}
