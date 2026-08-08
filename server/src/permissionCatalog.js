export const permissions = [
  ['dashboard.view', 'dashboard', 'view', 'View dashboard'],
  ['jobs.view_own', 'jobs', 'view_own', 'View own jobs'],
  ['jobs.view_all', 'jobs', 'view_all', 'View all jobs'],
  ['jobs.create', 'jobs', 'create', 'Create jobs'],
  ['jobs.edit', 'jobs', 'edit', 'Edit jobs'],
  ['jobs.update_status', 'jobs', 'update_status', 'Update job status'],
  ['jobs.override_tat', 'jobs', 'override_tat', 'Override job TAT'],
  ['clients.view', 'clients', 'view', 'View clients'],
  ['clients.view_all', 'clients', 'view_all', 'View all clients'],
  ['clients.create', 'clients', 'create', 'Create clients'],
  ['clients.edit', 'clients', 'edit', 'Edit clients'],
  ['clients.delete', 'clients', 'delete', 'Delete clients'],
  ['employees.view', 'employees', 'view', 'View employees'],
  ['employees.create', 'employees', 'create', 'Create employees'],
  ['employees.edit', 'employees', 'edit', 'Edit employees'],
  ['users.view', 'users', 'view', 'View users'],
  ['users.create', 'users', 'create', 'Create users'],
  ['users.edit', 'users', 'edit', 'Edit users'],
  ['users.assign_role', 'users', 'assign_role', 'Assign roles'],
  ['roles.view', 'roles', 'view', 'View roles'],
  ['roles.create', 'roles', 'create', 'Create roles'],
  ['roles.edit', 'roles', 'edit', 'Edit roles'],
  ['roles.manage_permissions', 'roles', 'manage_permissions', 'Manage role permissions'],
  ['departments.manage', 'departments', 'manage', 'Manage departments'],
  ['designations.manage', 'designations', 'manage', 'Manage designations'],
  ['support.view_own', 'support', 'view_own', 'View own support tickets'],
  ['support.view_all', 'support', 'view_all', 'View all support tickets'],
  ['support.create', 'support', 'create', 'Create support tickets'],
  ['support.reply', 'support', 'reply', 'Reply to support tickets'],
  ['support.manage', 'support', 'manage', 'Manage support tickets'],
  ['settings.view', 'settings', 'view', 'View settings'],
  ['settings.edit', 'settings', 'edit', 'Edit settings'],
  ['audit.view', 'audit', 'view', 'View audit logs']
];

export const roles = [
  ['super_admin', 'Super Admin', 'Highest-level system owner', 100, 'internal'],
  ['admin', 'Admin', 'Internal administrator with current dashboard access', 80, 'internal'],
  ['employee', 'Employee', 'Internal employee with assigned work access', 40, 'internal'],
  ['client', 'Client', 'Client workspace access', 10, 'client']
];

const allPermissions = permissions.map(([id]) => id);

export const rolePermissions = {
  super_admin: allPermissions,
  admin: [
    'dashboard.view',
    'jobs.view_all',
    'jobs.create',
    'jobs.edit',
    'jobs.update_status',
    'jobs.override_tat',
    'clients.view',
    'clients.view_all',
    'clients.create',
    'clients.edit',
    'clients.delete',
    'support.view_all',
    'support.create',
    'support.reply',
    'support.manage',
    'settings.view',
    'settings.edit'
  ],
  employee: [
    'dashboard.view',
    'jobs.view_own',
    'jobs.create',
    'clients.view',
    'support.view_own',
    'support.create',
    'support.reply'
  ],
  client: [
    'dashboard.view',
    'jobs.view_own',
    'jobs.create',
    'support.view_own',
    'support.create',
    'support.reply'
  ]
};

export const moduleCatalog = [
  { id: 'overview', label: 'Overview', permissionAny: ['dashboard.view'] },
  { id: 'submit', label: 'Submit a Job', permissionAny: ['jobs.create'] },
  { id: 'jobs', label: 'By Category', permissionAny: ['jobs.view_all', 'jobs.view_own'] },
  { id: 'settings', label: 'TAT Standards', permissionAny: ['settings.view', 'settings.edit'] },
  { id: 'clients', label: 'Manage Clients', permissionAny: ['clients.view_all', 'clients.view', 'clients.create'] },
  { id: 'employees', label: 'Employees', permissionAny: ['employees.view'] },
  { id: 'users', label: 'Users & Roles', permissionAny: ['users.view', 'roles.view'] },
  { id: 'support', label: 'Support Tickets', permissionAny: ['support.view_all', 'support.view_own', 'support.create'] },
  { id: 'audit', label: 'Audit Logs', permissionAny: ['audit.view'] }
];
