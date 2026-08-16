// Policy helpers for method access and user-specific limits.
export function isMethodPermittedForUser(user, methodMeta) {
  if (!methodMeta) return { allowed: true, reason: 'default' };

  const roleFlags = {
    holder: Boolean(user?.holder),
    vip: Boolean(user?.vip),
    admin: Boolean(user?.admin),
    reseller: Boolean(user?.reseller),
    owner: Boolean(user?.owner),
    private: Boolean(user?.private)
  };
  const planFlags = {
    vip: Boolean(user?.vip),
    holder: Boolean(user?.holder)
  };

  const roleRules = methodMeta.roles || {};
  const planRules = methodMeta.plan_restrictions || {};
  const isPrivileged = Boolean(user?.admin || user?.owner || user?.reseller);

  for (const [roleName, required] of Object.entries(roleRules)) {
    if (required && !isPrivileged && !roleFlags[roleName]) {
      return { allowed: false, reason: `requires role ${roleName}` };
    }
  }

  for (const [planName, required] of Object.entries(planRules)) {
    if (required && !isPrivileged && !planFlags[planName]) {
      return { allowed: false, reason: `requires plan ${planName}` };
    }
  }

  return { allowed: true, reason: 'ok' };
}

export function getUserLimits(user) {
  return {
    maxTime: Number(user?.max_time || 60),
    maxConcurrents: Number(user?.max_concurrents || 1)
  };
}
