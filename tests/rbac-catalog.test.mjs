import test from 'node:test';
import assert from 'node:assert/strict';
import { permissions, rolePermissions, moduleCatalog } from '../server/src/permissionCatalog.js';

const permissionIds = permissions.map(([id]) => id);
const clientAllowed = new Set(['dashboard.view', 'jobs.view_own', 'jobs.create', 'support.view_own', 'support.create', 'support.reply', 'chat.view', 'chat.send']);

test('Super Admin receives every catalog permission', () => {
  assert.deepEqual(new Set(rolePermissions.super_admin), new Set(permissionIds));
});

test('Client defaults contain only client-safe permissions', () => {
  for (const permission of rolePermissions.client) assert.ok(clientAllowed.has(permission), `unsafe client permission: ${permission}`);
  assert.ok(!rolePermissions.client.some(permission => permission.startsWith('users.')));
  assert.ok(!rolePermissions.client.some(permission => permission.startsWith('roles.')));
  assert.ok(!rolePermissions.client.some(permission => permission.startsWith('employees.')));
  assert.ok(!rolePermissions.client.includes('audit.view'));
  assert.ok(!rolePermissions.client.includes('settings.edit'));
});

test('Employee defaults do not inherit internal administration', () => {
  assert.ok(rolePermissions.employee.includes('jobs.view_own'));
  assert.ok(rolePermissions.employee.includes('clients.view'));
  assert.ok(rolePermissions.employee.includes('chat.view'));
  assert.ok(!rolePermissions.employee.includes('users.view'));
  assert.ok(!rolePermissions.employee.includes('roles.manage_permissions'));
  assert.ok(!rolePermissions.employee.includes('audit.view'));
});

test('Dynamic module catalog exposes enterprise management modules only through permissions', () => {
  const byId = Object.fromEntries(moduleCatalog.map(module => [module.id, module]));
  assert.ok(byId.employees.permissionAny.includes('employees.create'));
  assert.ok(byId.users.permissionAny.includes('roles.manage_permissions'));
  assert.ok(byId.jobs.permissionAny.includes('jobs.view_department'));
  assert.ok(byId.chat.permissionAny.includes('chat.view'));
});
