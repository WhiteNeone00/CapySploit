function randomChunk() {
  const array = new Uint8Array(2);
  crypto.getRandomValues(array);
  return Array.from(array).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function generateVerificationCode() {
  return `${randomChunk()}-${randomChunk()}`;
}

export function buildDiscordRoleNames(user, env) {
  const defaultVerified = env.DISCORD_VERIFIED_ROLE_NAME || 'Verified';
  const defaultCustomer = env.DISCORD_CUSTOMER_ROLE_NAME || 'Customer';
  const roles = [defaultVerified];
  if (user.vip) roles.push('VIP');
  if (user.holder) roles.push('Holder');
  if (user.reseller) roles.push('Reseller');
  if (user.api_access || user.max_daily_attacks > 0) roles.push(defaultCustomer);
  if (user.service_name) roles.push(`${user.service_name} Plan`);
  return [...new Set(roles)];
}

export function userPlanRole(user, env) {
  if (user.vip) return env.DISCORD_VIP_ROLE_NAME || 'VIP';
  if (user.holder) return env.DISCORD_HOLDER_ROLE_NAME || 'Holder';
  if (user.reseller) return env.DISCORD_RESELLER_ROLE_NAME || 'Reseller';
  return env.DISCORD_CUSTOMER_ROLE_NAME || 'Customer';
}
