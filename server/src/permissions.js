import { permissions as permissionCatalog, rolePermissions } from './permissionCatalog.js';
import { one, query } from './db.js';
import { evaluateModuleAccess, getVisibleModules } from './moduleAccessService.js';

const legacyPermissionFallback = {
  admin: new Set([
    'dashboard.view',
    'jobs.view_all',
    'jobs.create',
    'jobs.edit',
    'jobs.assign',
    'jobs.reassign',
    'jobs.view_department',
    'jobs.update_status',
    'jobs.override_tat',
    'clients.view',
    'clients.view_all',
    'clients.create',
    'clients.edit',
    'clients.delete',
    'clients.assign_owner',
    'employees.view',
    'employees.create',
    'employees.edit',
    'users.view',
    'users.create',
    'users.edit',
    'users.assign_role',
    'roles.view',
    'roles.create',
    'roles.edit',
    'roles.manage_permissions',
    'departments.manage',
    'designations.manage',
    'support.view_all',
    'support.create',
    'support.reply',
    'support.assign',
    'support.manage',
    'settings.view',
    'settings.edit',
    'audit.view'
  ]),
  client: new Set([
    'dashboard.view',
    'jobs.view_own',
    'jobs.create',
    'jobs.assign',
    'support.view_own',
    'support.create',
    'support.reply'
  ])
};

export const hasPermission = (user, permission) => user?.permissions?.includes(permission);
export const hasAnyPermission = (user, permissions) => permissions.some(permission => hasPermission(user, permission));
export const isInternalUser = user => user?.accountType !== 'client';
export const isSuperAdmin = user => user?.accountType === 'super_admin' || user?.roleSlug === 'super_admin';

export async function visibleModulesFor(user) {
  return getVisibleModules(user);
}

export async function loadUserContext(userId) {
  const row = await one(
    `SELECT u.*,
      r.name role_name,r.slug role_slug,r.level role_level,r.role_type,
      r.status role_status,
      d.name department_name,
      ds.name designation_name,ds.hierarchy_level designation_level
    FROM users u
    LEFT JOIN roles r ON r.id=u.role_id
    LEFT JOIN departments d ON d.id=u.department_id
    LEFT JOIN designations ds ON ds.id=u.designation_id
    WHERE u.id=? AND u.status='active'`,
    [userId]
  );
  if (!row)
    return null;

  const fallbackType = row.account_type || row.role || 'client';
  const roleId = row.role_id || fallbackType;
  const roleActive = !row.role_id || row.role_status === 'active';
  const permissionRows = roleActive ? await query(
    `SELECT permission_id FROM role_permissions WHERE role_id=?`,
    [roleId]
  ) : [];
  const permissions = new Set(permissionRows.map(item => item.permission_id));

  if (!permissions.size && !row.role_id) {
    for (const permission of legacyPermissionFallback[fallbackType] || [])
      permissions.add(permission);
  }

  const protectedSuperAdmin = fallbackType === 'super_admin' || row.role_slug === 'super_admin';
  if (protectedSuperAdmin) {
    for (const [permissionId] of permissionCatalog)
      permissions.add(permissionId);
  } else {
    const overrides = await query(
      'SELECT permission_id,effect FROM user_permission_overrides WHERE user_id=?',
      [row.id]
    );
    for (const override of overrides) {
      if (override.effect === 'grant')
        permissions.add(override.permission_id);
      else
        permissions.delete(override.permission_id);
    }
  }

  const accountType = row.account_type || (row.role === 'admin' ? 'admin' : row.role);
  if (accountType === 'client') {
    const clientSafePermissions = new Set(rolePermissions.client || []);
    for (const permissionId of [...permissions]) {
      if (!clientSafePermissions.has(permissionId))
        permissions.delete(permissionId);
    }
  }
  const user = {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: accountType,
    legacyRole: row.role,
    accountType,
    roleId,
    roleName: row.role_name || (accountType === 'client' ? 'Client' : 'Admin'),
    roleSlug: row.role_slug || roleId,
    roleLevel: Number(row.role_level || 0),
    roleType: row.role_type || (accountType === 'client' ? 'client' : 'internal'),
    status: row.status,
    clientId: row.client_id,
    departmentId: row.department_id,
    departmentName: row.department_name,
    designationId: row.designation_id,
    designationName: row.designation_name,
    designationLevel: row.designation_level,
    managerUserId: row.manager_user_id,
    permissions: [...permissions].sort()
  };
  user.modules = await visibleModulesFor(user);
  return user;
}

export function requirePermission(...permissions) {
  return (req, res, next) => {
    if (!req.user)
      return res.status(401).json({ error: 'Authentication required' });
    if (!hasAnyPermission(req.user, permissions))
      return res.status(403).json({ error: 'Permission denied' });
    next();
  };
}

export function requireModuleAccess(...moduleKeys) {
  return async (req, res, next) => {
    if (!req.user)
      return res.status(401).json({ error: 'Authentication required' });
    try {
      for (const moduleKey of moduleKeys) {
        const result = await evaluateModuleAccess(req.user, moduleKey);
        if (result.allowed)
          return next();
      }
      return res.status(403).json({ error: 'Module access denied' });
    }
    catch (error) {
      next(error);
    }
  };
}

export function requireInternalUser(req, res, next) {
  if (!isInternalUser(req.user))
    return res.status(403).json({ error: 'Internal user access required' });
  next();
}

export function requireSuperAdmin(req, res, next) {
  if (!isSuperAdmin(req.user))
    return res.status(403).json({ error: 'Super Admin access required' });
  next();
}
