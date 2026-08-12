import { moduleCatalog } from './permissionCatalog.js';
import { one, query } from './db.js';

export const clientModuleAllowlist = new Set(['overview', 'submit', 'jobs', 'support', 'notifications', 'profile']);
export const protectedModuleKeys = new Set(['overview', 'users', 'audit', 'app_settings']);

const accountTypes = new Set(['super_admin', 'admin', 'employee', 'client', 'junior_employee']);
const conditionTypes = new Set(['account_type', 'role', 'department', 'designation', 'user', 'manager', 'client']);
const triggerTypes = new Set(['on_login', 'job_assigned', 'client_assigned', 'support_ticket_assigned', 'date_range', 'day_of_week', 'manual_activation']);
const advancedRuleTypes = new Set(['active_users_only', 'department', 'designation_level', 'reporting_hierarchy', 'client_ownership', 'job_scope', 'client_scope', 'time_window']);
const operators = new Set(['equals', 'not_equals', 'in', 'not_in', 'less_or_equal', 'greater_or_equal']);

const moduleDescriptions = {
  overview: 'Dashboard overview and KPIs',
  submit: 'Create and submit job requests',
  jobs: 'Job board and job management',
  dispatch: 'Job dispatch queue and assignment offers',
  settings: 'TAT standards and turnaround rules',
  clients: 'Client account management',
  employees: 'Internal employee directory',
  users: 'Users, roles, permissions and hierarchy',
  productivity: 'Productivity analytics, targets, account rosters and salary-private efficiency',
  support: 'Support tickets and conversations',
  chat: 'Internal employee team chat',
  notifications: 'Workflow notifications and assignment alerts',
  profile: 'Personal account details',
  audit: 'Security and activity history',
  app_settings: 'Platform settings and controls'
};

const moduleIcons = {
  overview: 'overview',
  submit: 'submit',
  jobs: 'jobs',
  dispatch: 'briefcase',
  settings: 'clock',
  clients: 'users',
  employees: 'users',
  users: 'shield',
  productivity: 'total',
  support: 'support',
  chat: 'chat',
  notifications: 'bell',
  profile: 'users',
  audit: 'document',
  app_settings: 'settings'
};

const moduleByKey = new Map(moduleCatalog.map(module => [module.id, module]));
const normalize = value => String(value ?? '').trim();
const lower = value => normalize(value).toLowerCase();
const toBoolean = value => value === true || value === 1 || value === '1' || lower(value) === 'true';
const hasAnyPermission = (user, permissions = []) => permissions.some(permission => user?.permissions?.includes(permission));
const isSuperAdminContext = user => user?.accountType === 'super_admin' || user?.roleSlug === 'super_admin';
const placeholders = values => values.map(() => '?').join(',');

export function moduleMeta(module) {
  return {
    id: module.id,
    key: module.id,
    label: module.label,
    icon: moduleIcons[module.id] || 'overview',
    description: moduleDescriptions[module.id] || `${module.label} module access`,
    permissionAny: module.permissionAny || [],
    status: 'active',
    protected: protectedModuleKeys.has(module.id),
    clientAllowed: clientModuleAllowlist.has(module.id)
  };
}

export function getAllModules() {
  return moduleCatalog.map(moduleMeta);
}

const groupRows = (rows, key = 'ruleId') => rows.reduce((groups, row) => {
  const id = String(row[key]);
  groups[id] = [...(groups[id] || []), row];
  return groups;
}, {});

const mapRuleRow = (row, groupedConditions, groupedTriggers, groupedAdvanced) => {
  const id = String(row.id);
  return {
    id,
    moduleKey: row.moduleKey,
    name: row.name,
    description: row.description || '',
    matchMode: row.matchMode || 'all',
    isActive: Boolean(row.isActive),
    createdByUserId: row.createdByUserId || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    conditions: groupedConditions[id] || [],
    triggers: groupedTriggers[id] || [],
    advancedRules: groupedAdvanced[id] || []
  };
};

export async function getModuleRules(moduleKey = '') {
  const params = [];
  const where = moduleKey ? 'WHERE module_key=?' : '';
  if (moduleKey)
    params.push(moduleKey);
  const rules = await query(`SELECT id,module_key moduleKey,name,description,match_mode matchMode,is_active isActive,
      created_by_user_id createdByUserId,created_at createdAt,updated_at updatedAt
    FROM module_access_rules ${where}
    ORDER BY module_key,name,id`, params);
  if (!rules.length)
    return [];
  const ids = rules.map(row => row.id);
  const [conditions, triggers, advancedRules] = await Promise.all([
    query(`SELECT id,rule_id ruleId,effect,condition_type conditionType,operator,value,created_at createdAt
      FROM module_access_conditions WHERE rule_id IN (${placeholders(ids)}) ORDER BY id`, ids),
    query(`SELECT id,rule_id ruleId,trigger_type triggerType,operator,value,is_active isActive,created_at createdAt
      FROM module_access_triggers WHERE rule_id IN (${placeholders(ids)}) ORDER BY id`, ids),
    query(`SELECT id,rule_id ruleId,rule_type ruleType,operator,value,created_at createdAt
      FROM module_access_advanced_rules WHERE rule_id IN (${placeholders(ids)}) ORDER BY id`, ids)
  ]);
  return rules.map(rule => mapRuleRow(rule, groupRows(conditions), groupRows(triggers), groupRows(advancedRules)));
}

export async function getModuleRuleById(id, connection) {
  const row = await one(`SELECT id,module_key moduleKey,name,description,match_mode matchMode,is_active isActive,
      created_by_user_id createdByUserId,created_at createdAt,updated_at updatedAt
    FROM module_access_rules WHERE id=?`, [id], connection);
  if (!row)
    return null;
  const conditions = await query('SELECT id,rule_id ruleId,effect,condition_type conditionType,operator,value,created_at createdAt FROM module_access_conditions WHERE rule_id=? ORDER BY id', [id], connection);
  const triggers = await query('SELECT id,rule_id ruleId,trigger_type triggerType,operator,value,is_active isActive,created_at createdAt FROM module_access_triggers WHERE rule_id=? ORDER BY id', [id], connection);
  const advancedRules = await query('SELECT id,rule_id ruleId,rule_type ruleType,operator,value,created_at createdAt FROM module_access_advanced_rules WHERE rule_id=? ORDER BY id', [id], connection);
  return mapRuleRow(row, groupRows(conditions), groupRows(triggers), groupRows(advancedRules));
}

const normalizeList = (items, mapper) => (Array.isArray(items) ? items : [])
  .map(mapper)
  .filter(Boolean);

export function normalizeModuleAccessInput(input = {}) {
  const rule = {
    id: input.id ? String(input.id) : '',
    moduleKey: normalize(input.moduleKey),
    name: normalize(input.name),
    description: normalize(input.description),
    matchMode: input.matchMode === 'any' ? 'any' : 'all',
    isActive: input.isActive === undefined ? true : Boolean(input.isActive),
    conditions: normalizeList(input.conditions, condition => {
      const effect = condition?.effect === 'exclude' ? 'exclude' : 'include';
      const conditionType = normalize(condition?.conditionType || condition?.type);
      const operator = operators.has(condition?.operator) ? condition.operator : 'equals';
      const value = normalize(condition?.value);
      return conditionType && value ? { effect, conditionType, operator, value } : null;
    }),
    triggers: normalizeList(input.triggers, trigger => {
      const triggerType = normalize(trigger?.triggerType || trigger?.type);
      const operator = operators.has(trigger?.operator) ? trigger.operator : 'equals';
      const value = normalize(trigger?.value);
      const isActive = trigger?.isActive === undefined ? true : Boolean(trigger.isActive);
      return triggerType ? { triggerType, operator, value, isActive } : null;
    }),
    advancedRules: normalizeList(input.advancedRules || input.advanced, rule => {
      const ruleType = normalize(rule?.ruleType || rule?.type);
      const operator = operators.has(rule?.operator) ? rule.operator : 'equals';
      const value = normalize(rule?.value);
      return ruleType ? { ruleType, operator, value } : null;
    })
  };
  if (!rule.name) {
    const module = moduleByKey.get(rule.moduleKey);
    rule.name = `${module?.label || rule.moduleKey || 'Module'} access rule`;
  }
  return rule;
}

const assertReference = async (sql, params, error) => {
  if (!(await one(sql, params)))
    return error;
  return '';
};

async function validateConditionReference(condition, moduleKey) {
  if (!conditionTypes.has(condition.conditionType))
    return `Unsupported condition type: ${condition.conditionType}`;
  if (condition.conditionType === 'account_type' && !accountTypes.has(condition.value))
    return 'Account type is invalid';
  if (condition.conditionType === 'role') {
    const role = await one('SELECT id,role_type roleType FROM roles WHERE id=? AND status=?', [condition.value, 'active']);
    if (!role)
      return 'Active role not found';
    if (!clientModuleAllowlist.has(moduleKey) && role.roleType === 'client')
      return 'Client roles cannot be granted internal modules';
  }
  if (condition.conditionType === 'department')
    return assertReference('SELECT id FROM departments WHERE id=? AND status=?', [condition.value, 'active'], 'Active department not found');
  if (condition.conditionType === 'designation')
    return assertReference('SELECT id FROM designations WHERE id=? AND status=?', [condition.value, 'active'], 'Active designation not found');
  if (condition.conditionType === 'user') {
    const user = await one('SELECT id,COALESCE(account_type,role) accountType FROM users WHERE id=? AND status=?', [condition.value, 'active']);
    if (!user)
      return 'Active user not found';
    if (!clientModuleAllowlist.has(moduleKey) && user.accountType === 'client')
      return 'Client users cannot be granted internal modules';
  }
  if (condition.conditionType === 'manager') {
    const manager = await one("SELECT id,COALESCE(account_type,role) accountType FROM users WHERE id=? AND status='active'", [condition.value]);
    if (!manager || manager.accountType === 'client')
      return 'Active internal reporting manager not found';
  }
  if (condition.conditionType === 'client')
    return !clientModuleAllowlist.has(moduleKey) && condition.effect === 'include'
      ? 'Client-scoped conditions are only allowed on client-facing modules'
      : assertReference('SELECT id FROM clients WHERE id=? AND status=?', [condition.value, 'active'], 'Active client not found');
  return '';
}

async function validateAdvancedReference(rule) {
  if (!advancedRuleTypes.has(rule.ruleType))
    return `Unsupported advanced rule: ${rule.ruleType}`;
  if (rule.ruleType === 'department')
    return assertReference('SELECT id FROM departments WHERE id=? AND status=?', [rule.value, 'active'], 'Active department not found');
  if (rule.ruleType === 'designation_level' && Number.isNaN(Number(rule.value)))
    return 'Designation level must be numeric';
  if (rule.ruleType === 'reporting_hierarchy')
    return assertReference("SELECT id FROM users WHERE id=? AND status='active' AND COALESCE(account_type,role)<>'client'", [rule.value], 'Active internal manager not found');
  return '';
}

export async function validateModuleAccessRule(rule) {
  const module = moduleByKey.get(rule.moduleKey);
  if (!module)
    return { error: 'Module not found' };
  for (const condition of rule.conditions) {
    const referenceError = await validateConditionReference(condition, rule.moduleKey);
    if (referenceError)
      return { error: referenceError };
    if (!clientModuleAllowlist.has(rule.moduleKey)
      && condition.effect === 'include'
      && condition.conditionType === 'account_type'
      && condition.value === 'client')
      return { error: 'Client accounts cannot receive internal modules' };
    if (protectedModuleKeys.has(rule.moduleKey)
      && condition.effect === 'exclude'
      && condition.conditionType === 'account_type'
      && condition.value === 'super_admin')
      return { error: 'Super Admin access cannot be excluded from protected modules' };
    if (protectedModuleKeys.has(rule.moduleKey)
      && condition.effect === 'exclude'
      && condition.conditionType === 'user') {
      const target = await one("SELECT id FROM users WHERE id=? AND COALESCE(account_type,role)='super_admin'", [condition.value]);
      if (target)
        return { error: 'Super Admin users cannot be excluded from protected modules' };
    }
  }
  for (const trigger of rule.triggers) {
    if (!triggerTypes.has(trigger.triggerType))
      return { error: `Unsupported trigger type: ${trigger.triggerType}` };
  }
  for (const advancedRule of rule.advancedRules) {
    const referenceError = await validateAdvancedReference(advancedRule);
    if (referenceError)
      return { error: referenceError };
  }
  return { rule };
}

export async function saveModuleAccessRule(rule, actorId, connection) {
  let ruleId = rule.id ? Number(rule.id) : 0;
  if (ruleId) {
    await query(`UPDATE module_access_rules
      SET module_key=?,name=?,description=?,match_mode=?,is_active=?
      WHERE id=?`, [rule.moduleKey, rule.name, rule.description, rule.matchMode, rule.isActive ? 1 : 0, ruleId], connection);
    await query('DELETE FROM module_access_conditions WHERE rule_id=?', [ruleId], connection);
    await query('DELETE FROM module_access_triggers WHERE rule_id=?', [ruleId], connection);
    await query('DELETE FROM module_access_advanced_rules WHERE rule_id=?', [ruleId], connection);
  } else {
    const result = await query(`INSERT INTO module_access_rules
      (module_key,name,description,match_mode,is_active,created_by_user_id)
      VALUES (?,?,?,?,?,?)`, [rule.moduleKey, rule.name, rule.description, rule.matchMode, rule.isActive ? 1 : 0, actorId], connection);
    ruleId = Number(result.insertId);
  }
  for (const condition of rule.conditions) {
    await query(`INSERT INTO module_access_conditions (rule_id,effect,condition_type,operator,value)
      VALUES (?,?,?,?,?)`, [ruleId, condition.effect, condition.conditionType, condition.operator, condition.value], connection);
  }
  for (const trigger of rule.triggers) {
    await query(`INSERT INTO module_access_triggers (rule_id,trigger_type,operator,value,is_active)
      VALUES (?,?,?,?,?)`, [ruleId, trigger.triggerType, trigger.operator, trigger.value, trigger.isActive ? 1 : 0], connection);
  }
  for (const advancedRule of rule.advancedRules) {
    await query(`INSERT INTO module_access_advanced_rules (rule_id,rule_type,operator,value)
      VALUES (?,?,?,?)`, [ruleId, advancedRule.ruleType, advancedRule.operator, advancedRule.value], connection);
  }
  return getModuleRuleById(ruleId, connection);
}

export async function deleteModuleAccessRule(id, connection) {
  await query('DELETE FROM module_access_rules WHERE id=?', [id], connection);
}

const splitValues = value => lower(value).split(',').map(item => item.trim()).filter(Boolean);

function compareValue(actualValue, expectedValue, operator = 'equals') {
  const actual = lower(actualValue);
  const expected = lower(expectedValue);
  const expectedList = splitValues(expectedValue);
  if (operator === 'not_equals')
    return actual !== expected;
  if (operator === 'in')
    return expectedList.includes(actual);
  if (operator === 'not_in')
    return !expectedList.includes(actual);
  if (operator === 'less_or_equal')
    return Number(actualValue) <= Number(expectedValue);
  if (operator === 'greater_or_equal')
    return Number(actualValue) >= Number(expectedValue);
  return actual === expected;
}

function userValueForCondition(user, condition) {
  if (condition.conditionType === 'account_type')
    return user.accountType;
  if (condition.conditionType === 'role')
    return user.roleId || user.roleSlug;
  if (condition.conditionType === 'department')
    return user.departmentId;
  if (condition.conditionType === 'designation')
    return user.designationId;
  if (condition.conditionType === 'user')
    return user.id;
  if (condition.conditionType === 'manager')
    return user.managerUserId;
  if (condition.conditionType === 'client')
    return user.clientId;
  return '';
}

function conditionMatches(user, condition) {
  return compareValue(userValueForCondition(user, condition), condition.value, condition.operator);
}

export function evaluateConditions(user, conditions = [], matchMode = 'all') {
  const include = conditions.filter(condition => condition.effect !== 'exclude');
  const exclude = conditions.filter(condition => condition.effect === 'exclude');
  const exclusion = exclude.find(condition => conditionMatches(user, condition));
  if (exclusion) {
    return {
      passed: false,
      excluded: true,
      reason: `${exclusion.conditionType.replace(/_/g, ' ')} excluded this user`,
      matched: [],
      failed: []
    };
  }
  if (!include.length)
    return { passed: true, excluded: false, reason: 'No include conditions, RBAC decides access', matched: [], failed: [] };
  const results = include.map(condition => ({
    condition,
    matched: conditionMatches(user, condition)
  }));
  const passed = matchMode === 'any' ? results.some(result => result.matched) : results.every(result => result.matched);
  return {
    passed,
    excluded: false,
    reason: passed ? 'Include conditions matched' : 'Include conditions did not match',
    matched: results.filter(result => result.matched).map(result => result.condition),
    failed: results.filter(result => !result.matched).map(result => result.condition)
  };
}

function dateRangeMatches(value, now = new Date()) {
  const text = normalize(value);
  let start = '';
  let end = '';
  try {
    const parsed = JSON.parse(text || '{}');
    start = parsed.start || '';
    end = parsed.end || '';
  } catch {
    [start, end] = text.split('..');
  }
  const current = now.getTime();
  const startTime = start ? new Date(start).getTime() : 0;
  const endTime = end ? new Date(end).getTime() : Number.POSITIVE_INFINITY;
  return (!start || current >= startTime) && (!end || current <= endTime);
}

async function triggerMatches(user, trigger) {
  if (!trigger.isActive)
    return true;
  if (trigger.triggerType === 'on_login')
    return true;
  if (trigger.triggerType === 'manual_activation')
    return !['false', 'disabled', 'inactive', 'off'].includes(lower(trigger.value || 'active'));
  if (trigger.triggerType === 'date_range')
    return dateRangeMatches(trigger.value);
  if (trigger.triggerType === 'day_of_week') {
    const today = new Date().getDay();
    const todayName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][today];
    const values = splitValues(trigger.value);
    return values.includes(String(today)) || values.includes(todayName);
  }
  if (trigger.triggerType === 'job_assigned') {
    const row = await one("SELECT COUNT(*) count FROM jobs WHERE assigned_to_user_id=? AND status NOT IN ('completed','cancelled')", [user.id]);
    return Number(row?.count || 0) > 0;
  }
  if (trigger.triggerType === 'client_assigned') {
    if (user.clientId)
      return true;
    const row = await one("SELECT COUNT(*) count FROM clients WHERE status='active' AND (account_owner_user_id=? OR created_by=?)", [user.id, user.id]);
    return Number(row?.count || 0) > 0;
  }
  if (trigger.triggerType === 'support_ticket_assigned') {
    const row = await one("SELECT COUNT(*) count FROM support_tickets WHERE status NOT IN ('Resolved','Closed') AND (user_id=? OR assigned_to_user_id=? OR client_id=?)", [user.id, user.id, user.clientId || '']);
    return Number(row?.count || 0) > 0;
  }
  return false;
}

export async function evaluateTriggers(user, triggers = []) {
  const active = triggers.filter(trigger => trigger.isActive !== false);
  if (!active.length)
    return { passed: true, reason: 'Always available after conditions pass', matched: [], failed: [] };
  const matched = [];
  const failed = [];
  for (const trigger of active) {
    if (await triggerMatches(user, trigger))
      matched.push(trigger);
    else
      failed.push(trigger);
  }
  return {
    passed: failed.length === 0,
    reason: failed.length ? 'One or more triggers are not active' : 'Triggers passed',
    matched,
    failed
  };
}

async function advancedRuleMatches(user, rule) {
  if (rule.ruleType === 'active_users_only')
    return true;
  if (rule.ruleType === 'department')
    return compareValue(user.departmentId, rule.value, rule.operator);
  if (rule.ruleType === 'designation_level')
    return compareValue(Number(user.designationLevel ?? 9999), Number(rule.value), rule.operator || 'less_or_equal');
  if (rule.ruleType === 'reporting_hierarchy')
    return compareValue(user.managerUserId, rule.value, rule.operator);
  if (rule.ruleType === 'client_ownership') {
    if (user.clientId)
      return true;
    const row = await one("SELECT COUNT(*) count FROM clients WHERE status='active' AND (account_owner_user_id=? OR created_by=?)", [user.id, user.id]);
    return Number(row?.count || 0) > 0;
  }
  if (rule.ruleType === 'job_scope') {
    if (rule.value === 'all')
      return user.permissions?.includes('jobs.view_all');
    if (rule.value === 'department')
      return user.permissions?.includes('jobs.view_department');
    if (rule.value === 'own')
      return user.permissions?.includes('jobs.view_own');
    if (rule.value === 'assigned') {
      const row = await one("SELECT COUNT(*) count FROM jobs WHERE assigned_to_user_id=? AND status NOT IN ('completed','cancelled')", [user.id]);
      return Number(row?.count || 0) > 0;
    }
  }
  if (rule.ruleType === 'client_scope') {
    if (rule.value === 'all')
      return user.permissions?.includes('clients.view_all');
    if (['owned', 'assigned'].includes(rule.value))
      return user.permissions?.includes('clients.view');
  }
  if (rule.ruleType === 'time_window')
    return dateRangeMatches(rule.value);
  return true;
}

export async function evaluateAdvancedRules(user, rules = []) {
  if (!rules.length)
    return { passed: true, reason: 'No additional restrictions', matched: [], failed: [] };
  const matched = [];
  const failed = [];
  for (const rule of rules) {
    if (await advancedRuleMatches(user, rule))
      matched.push(rule);
    else
      failed.push(rule);
  }
  return {
    passed: failed.length === 0,
    reason: failed.length ? 'Advanced restrictions did not pass' : 'Advanced restrictions passed',
    matched,
    failed
  };
}

function evaluationDetail(label, passed, reason) {
  return { label, passed, reason };
}

export async function evaluateModuleAccess(user, moduleKey, options = {}) {
  const module = moduleByKey.get(moduleKey);
  if (!user)
    return { allowed: false, reason: 'Authentication required', details: [] };
  if (!module)
    return { allowed: false, reason: 'Module not found', details: [] };
  // Precedence: active account, Super Admin recovery, client safety, RBAC, explicit denies, conditions, triggers, advanced rules.
  if (user.status && user.status !== 'active') {
    return {
      allowed: false,
      reason: 'Account is inactive',
      details: [evaluationDetail('Active account', false, 'Inactive accounts cannot access modules')]
    };
  }
  if (isSuperAdminContext(user)) {
    return {
      allowed: true,
      reason: 'Protected Super Admin recovery access',
      details: [evaluationDetail('Super Admin protection', true, 'Super Admin cannot be locked out')]
    };
  }
  if (user.accountType === 'client' && !clientModuleAllowlist.has(moduleKey)) {
    return {
      allowed: false,
      reason: 'Client accounts cannot access internal modules',
      details: [evaluationDetail('Client safety', false, 'Internal module blocked for client account')]
    };
  }
  const baseAllowed = hasAnyPermission(user, module.permissionAny);
  if (!baseAllowed) {
    return {
      allowed: false,
      reason: 'Base RBAC permission missing',
      details: [evaluationDetail('Base permission', false, 'Role and overrides do not grant this module')]
    };
  }
  const rules = options.rules || await getModuleRules(moduleKey);
  const activeRules = rules.filter(rule => rule.isActive);
  if (rules.length && !activeRules.length) {
    return {
      allowed: false,
      reason: 'Module is disabled',
      details: [evaluationDetail('Module status', false, 'All module access rules are disabled')]
    };
  }
  if (!activeRules.length) {
    return {
      allowed: true,
      reason: 'Allowed by RBAC default',
      details: [evaluationDetail('Base permission', true, 'No active module access rules exist')]
    };
  }
  const details = [evaluationDetail('Base permission', true, 'RBAC permission matched')];
  for (const rule of activeRules) {
    const conditionResult = evaluateConditions(user, rule.conditions, rule.matchMode);
    if (conditionResult.excluded) {
      return {
        allowed: false,
        reason: conditionResult.reason,
        rule,
        details: [...details, evaluationDetail(`Explicit deny: ${rule.name}`, false, conditionResult.reason)]
      };
    }
  }
  let passingRule = null;
  for (const rule of activeRules) {
    const conditionResult = evaluateConditions(user, rule.conditions, rule.matchMode);
    const triggerResult = conditionResult.passed ? await evaluateTriggers(user, rule.triggers) : { passed: false, reason: 'Skipped because conditions failed' };
    const advancedResult = conditionResult.passed && triggerResult.passed
      ? await evaluateAdvancedRules(user, rule.advancedRules)
      : { passed: false, reason: 'Skipped because prior checks failed' };
    details.push(evaluationDetail(`Rule: ${rule.name}`, conditionResult.passed && triggerResult.passed && advancedResult.passed,
      [conditionResult.reason, triggerResult.reason, advancedResult.reason].filter(Boolean).join(' | ')));
    if (conditionResult.passed && triggerResult.passed && advancedResult.passed) {
      passingRule = rule;
      break;
    }
  }
  if (passingRule)
    return { allowed: true, reason: `Allowed by ${passingRule.name}`, rule: passingRule, details };
  return { allowed: false, reason: 'No module access rule matched', details };
}

export async function getVisibleModules(user) {
  const visible = [];
  for (const module of moduleCatalog) {
    const result = await evaluateModuleAccess(user, module.id);
    if (result.allowed)
      visible.push({ id: module.id, label: module.label });
  }
  return visible;
}

export function summarizeRulesForModule(rules = []) {
  if (!rules.length)
    return 'RBAC defaults apply';
  const active = rules.filter(rule => rule.isActive);
  const conditions = rules.reduce((count, rule) => count + rule.conditions.length, 0);
  const triggers = rules.reduce((count, rule) => count + rule.triggers.length, 0);
  const advanced = rules.reduce((count, rule) => count + rule.advancedRules.length, 0);
  return `${active.length} active rule${active.length === 1 ? '' : 's'} - ${conditions} condition${conditions === 1 ? '' : 's'}, ${triggers} trigger${triggers === 1 ? '' : 's'}, ${advanced} advanced`;
}

export async function moduleAccessOverview() {
  const rules = await getModuleRules();
  const grouped = rules.reduce((map, rule) => {
    map[rule.moduleKey] = [...(map[rule.moduleKey] || []), rule];
    return map;
  }, {});
  return getAllModules().map(module => ({
    ...module,
    ruleCount: (grouped[module.id] || []).length,
    activeRuleCount: (grouped[module.id] || []).filter(rule => rule.isActive).length,
    status: (grouped[module.id] || []).length && !(grouped[module.id] || []).some(rule => rule.isActive) ? 'disabled' : 'active',
    accessSummary: summarizeRulesForModule(grouped[module.id] || [])
  }));
}
