const ROLE_PERMS = {
  super_admin: ['*'],
  manager: [
    'products.read', 'products.write',
    'orders.read', 'orders.write',
    'stock.read', 'stock.write',
    'users.read',
    'announcements.read', 'announcements.write',
    'messages.read',
    'categories.read', 'categories.write',
  ],
  admin: [
    'products.read', 'products.write',
    'orders.read', 'orders.write',
    'stock.read', 'stock.write',
    'dashboard.read',
    'users.read', 'users.write',
    'announcements.read', 'announcements.write',
    'messages.read', 'messages.write',
    'settings.read', 'settings.write',
    'categories.read', 'categories.write',
    'topups.read', 'topups.write',
  ],
};

function resolvePerms(admin) {
  if (!admin) return [];
  if (admin.permissions) {
    try { return JSON.parse(admin.permissions); } catch { return ROLE_PERMS[admin.role] || []; }
  }
  return ROLE_PERMS[admin.role] || [];
}

function has(admin, perm) {
  const perms = resolvePerms(admin);
  return perms.includes('*') || perms.includes(perm);
}

module.exports = { ROLE_PERMS, resolvePerms, has };
