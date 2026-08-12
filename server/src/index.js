import './env.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { z } from 'zod';
import {
    pool,
    query,
    one,
    transaction,
    initialiseDatabase,
    audit,
    ensureEnvironmentSuperAdmin,
    environmentSuperAdminCredentials,
    seedDemoUsers,
    shouldRepairDemoLogin
} from './db.js';
import { requireAuth, signToken } from './auth.js';
import { hasPermission, hasAnyPermission, isSuperAdmin, loadUserContext, requirePermission, requireModuleAccess } from './permissions.js';
import {
    deleteModuleAccessRule,
    evaluateModuleAccess,
    getModuleRuleById,
    getModuleRules,
    moduleAccessOverview,
    normalizeModuleAccessInput,
    saveModuleAccessRule,
    validateModuleAccessRule
} from './moduleAccessService.js';
import {
    createOrUpdateProductivityJob,
    deleteProductivityJob,
    getAccounts,
    getAllJobs,
    getAnalysis,
    getByClient,
    getByPerson,
    getDailyLog,
    getDashboard,
    getReports,
    getTargets,
    loadProductivityJobs,
    productivityMeta,
    productivityResponsibilities,
    reassignRosterAccounts,
    resolveProductivityPeriod,
    salaryGradesForOwner,
    saveRoster,
    saveTarget,
    validateProductivityDates
} from './productivityService.js';
import { calculateHours } from './tat.js';
const app = express();
app.set('trust proxy', 1);
const httpServer = createServer(app);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const io = new Server(httpServer, { cors: { origin } });
let databaseReady = false;
let databaseInitError = null;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const loginAttempts = new Map();
const loginRateLimit = { windowMs: 15 * 60 * 1000, maxAttempts: 8 };
const initialiseDatabaseWithRetry = async () => {
    let attempt = 0;
    while (!databaseReady) {
        attempt += 1;
        try {
            await initialiseDatabase();
            databaseReady = true;
            databaseInitError = null;
            console.log('CI360 database ready');
        }
        catch (error) {
            databaseInitError = error;
            const delayMs = Math.min(30000, attempt * 5000);
            console.error(`CI360 database initialization failed; retrying in ${delayMs / 1000}s`, error);
            await wait(delayMs);
        }
    }
};
void initialiseDatabaseWithRetry();
const databaseHealthDetails = () => {
    if (databaseReady || !databaseInitError)
        return {};
    const code = databaseInitError.code || 'UNKNOWN';
    const hints = {
        ER_ACCESS_DENIED_ERROR: 'Check DB_USER and DB_PASSWORD, and confirm the MySQL user is assigned to this database.',
        ER_BAD_DB_ERROR: 'Check DB_NAME.',
        ENOENT: 'Check DB_SOCKET_PATH, or remove it and use DB_HOST/DB_PORT.',
        ECONNREFUSED: 'Check DB_HOST and DB_PORT.',
        ETIMEDOUT: 'Check DB_HOST, DB_PORT and hosting firewall settings.'
    };
    return {
        code,
        hint: hints[code] || 'Check Hostinger runtime logs for the full database error.'
    };
};
app.use(helmet());
app.use(cors({ origin }));
app.use(express.json({ limit: '20mb' }));
const emitRefresh = () => io.emit('data:changed', { at: new Date().toISOString() });
const emitPermissionsUpdated = () => io.emit('permissions:updated', { at: new Date().toISOString() });
const emitProductivityChanged = (payload = {}) => io.emit('productivity:changed', { at: new Date().toISOString(), ...payload });
const loginRateKey = req => `${req.ip || req.socket.remoteAddress || 'unknown'}:${String(req.body?.id || '').trim().toLowerCase().slice(0, 120)}`;
const checkLoginRateLimit = (req, res, next) => {
    const key = loginRateKey(req);
    const now = Date.now();
    const current = loginAttempts.get(key);
    if (current?.blockedUntil && current.blockedUntil > now) {
        const retryAfter = Math.ceil((current.blockedUntil - now) / 1000);
        res.setHeader('Retry-After', String(retryAfter));
        return res.status(429).json({ error: `Too many login attempts. Try again in ${retryAfter} seconds.` });
    }
    if (current && current.resetAt <= now)
        loginAttempts.delete(key);
    next();
};
const recordLoginFailure = req => {
    const key = loginRateKey(req);
    const now = Date.now();
    const current = loginAttempts.get(key);
    const attempts = current && current.resetAt > now ? current.attempts + 1 : 1;
    loginAttempts.set(key, {
        attempts,
        resetAt: now + loginRateLimit.windowMs,
        blockedUntil: attempts >= loginRateLimit.maxAttempts ? now + loginRateLimit.windowMs : 0
    });
};
const recordLoginSuccess = req => loginAttempts.delete(loginRateKey(req));
const settings = async () => JSON.parse((await one('SELECT json FROM settings WHERE id=1')).json);
const categoryLoad = async () => {
    const rows = await query("SELECT category,COUNT(*) count FROM jobs WHERE status!='completed' AND status!='cancelled' GROUP BY category");
    return Object.fromEntries(rows.map(row => [row.category, row.count]));
};
const jobSelect = `SELECT j.*,
    assigned.name assigned_to_name,
    assigned_by.name assigned_by_name,
    preferred.name preferred_assignee_name,
    creator.name created_by_name,
    department.name department_name,
    client.account_owner_user_id client_owner_user_id,
    client.created_by client_created_by
  FROM jobs j
  LEFT JOIN users assigned ON assigned.id=j.assigned_to_user_id
  LEFT JOIN users assigned_by ON assigned_by.id=j.assigned_by_user_id
  LEFT JOIN users preferred ON preferred.id=j.preferred_assignee_user_id
  LEFT JOIN users creator ON creator.id=j.created_by_user_id
  LEFT JOIN departments department ON department.id=j.department_id
  LEFT JOIN clients client ON client.id=j.client_id`;
const parseReferenceLinks = raw => {
    if (!raw)
        return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    }
    catch {
        return [raw].filter(Boolean);
    }
};
const mapJob = (row, includeInternal = true) => ({
    id: row.id, clientId: row.client_id, title: row.title, description: row.description, category: row.category,
    priority: row.priority, postedBy: row.posted_by, assetLink: row.asset_link, calculatedHours: row.calculated_hours,
    teamOverrideHours: row.team_override_hours, teamOverrideNote: row.team_override_note, status: row.status,
    datePosted: row.date_posted, dateCompleted: row.date_completed, updatedAt: row.updated_at,
    assignedToUserId: row.assigned_to_user_id,
    assignedToName: row.assigned_to_name,
    preferredAssigneeUserId: row.preferred_assignee_user_id,
    preferredAssigneeName: row.preferred_assignee_name,
    departmentId: row.department_id,
    departmentName: row.department_name,
    assignmentState: row.assignment_state || (row.assigned_to_user_id ? 'assigned' : 'unassigned'),
    submittedAt: row.submitted_at,
    acceptanceDeadlineAt: row.acceptance_deadline_at,
    acceptedAt: row.accepted_at,
    desiredDeliveryAt: row.desired_delivery_at,
    referenceLinks: parseReferenceLinks(row.reference_links),
    specialInstructions: row.special_instructions || '',
    progressPercent: Number(row.progress_percent || 0),
    requiresClientAction: Boolean(row.requires_client_action),
    ...(includeInternal ? {
        createdByUserId: row.created_by_user_id,
        createdByName: row.created_by_name,
        assignedByUserId: row.assigned_by_user_id,
        assignedByName: row.assigned_by_name,
        assignmentDate: row.assignment_date,
        assignmentNote: row.assignment_note,
        assignmentMethod: row.assignment_method,
        assignmentSourceUserId: row.assignment_source_user_id,
        autoAssignmentAttemptedAt: row.auto_assignment_attempted_at
    } : {})
});
const ticketCategories = ['Technical Issue', 'Account Issue', 'Job Posting Issue', 'Candidate Issue', 'Client Issue', 'Billing Issue', 'Feature Request', 'General Support'];
const ticketPriorities = ['Low', 'Medium', 'High', 'Urgent'];
const ticketStatuses = ['Open', 'In Progress', 'Waiting for User', 'Resolved', 'Closed'];
const allowedAttachmentExtensions = new Set(['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'zip']);
const maxAttachmentBytes = 10 * 1024 * 1024;
const ticketNumberFor = (id) => `CI360-${String(id).padStart(6, '0')}`;
const mapTicket = (row) => ({
    ticketNumber: row.ticket_number, userId: row.user_id, userName: row.user_name, clientId: row.client_id,
    subject: row.subject, category: row.category, priority: row.priority, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at, closedAt: row.closed_at
});
const canViewAllJobs = user => hasPermission(user, 'jobs.view_all');
const canViewDepartmentJobs = user => hasPermission(user, 'jobs.view_department');
const canAssignJobs = user => hasAnyPermission(user, ['jobs.assign', 'jobs.reassign']);
const canViewDispatch = user => hasPermission(user, 'jobs.dispatch.view');
const canDispatchAssign = user => hasAnyPermission(user, ['jobs.dispatch.assign', 'jobs.dispatch.reassign']);
const canDispatchClaim = user => hasPermission(user, 'jobs.dispatch.claim');
const canDispatchOverride = user => hasPermission(user, 'jobs.dispatch.override');
const canManageCoordinators = user => hasPermission(user, 'jobs.dispatch.manage_coordinators');
const canViewAllClients = user => hasPermission(user, 'clients.view_all');
const canViewOwnedClients = user => hasAnyPermission(user, ['clients.view', 'clients.create', 'clients.edit', 'clients.delete', 'clients.assign_owner']);
const canManageSupport = user => hasPermission(user, 'support.manage') || hasPermission(user, 'support.view_all');
const clientSelectFields = 'id,name,status,contact_name contactName,email,phone,industry,account_owner_user_id accountOwnerUserId,created_by createdBy,created_at createdAt';
const cleanCode = value => value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
const cleanSlug = value => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
const optionalId = value => {
    if (value === '' || value == null)
        return null;
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : NaN;
};
const entityStatus = ['active', 'inactive'];
const roleTypes = ['internal', 'client'];
const accessConditionSchema = z.object({
    effect: z.enum(['include', 'exclude']).default('include'),
    conditionType: z.string().trim().min(1),
    operator: z.string().trim().default('equals'),
    value: z.string().trim().min(1)
});
const accessTriggerSchema = z.object({
    triggerType: z.string().trim().min(1),
    operator: z.string().trim().default('equals'),
    value: z.string().trim().optional().default(''),
    isActive: z.boolean().optional().default(true)
});
const accessAdvancedRuleSchema = z.object({
    ruleType: z.string().trim().min(1),
    operator: z.string().trim().default('equals'),
    value: z.string().trim().optional().default('')
});
const moduleAccessPayloadSchema = z.object({
    id: z.union([z.string(), z.number()]).optional(),
    moduleKey: z.string().trim().min(1),
    name: z.string().trim().optional().default(''),
    description: z.string().trim().optional().default(''),
    matchMode: z.enum(['all', 'any']).optional().default('all'),
    isActive: z.boolean().optional().default(true),
    conditions: z.array(accessConditionSchema).optional().default([]),
    triggers: z.array(accessTriggerSchema).optional().default([]),
    advancedRules: z.array(accessAdvancedRuleSchema).optional().default([])
});
const numericId = z.union([z.string(), z.number()]).transform(value => Number(value)).pipe(z.number().int().positive());
const productivityJobPayloadSchema = z.object({
    id: z.union([z.string(), z.number()]).optional(),
    coreJobId: z.string().trim().optional().nullable().default(''),
    clientId: z.string().trim().min(1),
    startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
    completionDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal('')).default(''),
    valueAmount: z.coerce.number().nonnegative(),
    description: z.string().trim().max(5000).optional().default(''),
    serviceIds: z.array(numericId).min(1),
    assignments: z.array(z.object({
        userId: z.string().trim().min(1),
        revenuePercent: z.coerce.number().min(0).max(100),
        hoursSpent: z.coerce.number().min(0)
    })).min(1)
});
const productivityRosterPayloadSchema = z.object({
    id: z.union([z.string(), z.number()]).optional(),
    clientId: z.string().trim().min(1),
    nature: z.enum(['Existing', 'Prospect']).default('Existing'),
    difficulty: z.coerce.number().int().min(1).max(10),
    comments: z.string().trim().max(5000).optional().default(''),
    assignments: z.array(z.object({
        responsibilityKey: z.string().trim().min(1),
        assigneeType: z.enum(['employee', 'external', 'tbd']).default('tbd'),
        userId: z.string().trim().optional().nullable().default(''),
        externalName: z.string().trim().optional().nullable().default('')
    })).default([])
});
const productivityTargetPayloadSchema = z.object({
    id: z.union([z.string(), z.number()]).optional(),
    userId: z.string().trim().min(1),
    serviceId: numericId,
    quantity: z.coerce.number().positive(),
    unit: z.enum(['count', 'hours']).default('count'),
    period: z.enum(['day', 'week', 'month']).default('week'),
    isActive: z.boolean().optional().default(true)
});
const productivityServicePayloadSchema = z.object({
    name: z.string().trim().min(2).max(180),
    referenceHours: z.coerce.number().min(0).default(0),
    isActive: z.boolean().optional().default(true)
});
const productivityEmployeeSettingsSchema = z.object({
    userId: z.string().trim().min(1),
    weeklyCapacityHours: z.coerce.number().positive().max(168),
    productivityStatus: z.enum(['active', 'intern', 'vendor', 'inactive']).default('active')
});
const productivitySalaryGradeSchema = z.object({
    label: z.string().trim().min(1).max(80),
    minAmount: z.coerce.number().min(0),
    maxAmount: z.coerce.number().min(0)
});
const clientSafePermissions = new Set(['dashboard.view', 'jobs.view_own', 'jobs.create', 'support.view_own', 'support.create', 'support.reply', 'notifications.view', 'profile.view']);
const mapAttachment = (row) => ({
    id: String(row.id), ticketNumber: row.ticket_number, fileName: row.file_name,
    mimeType: row.mime_type, sizeBytes: row.size_bytes, messageId: row.message_id ? String(row.message_id) : null, createdAt: row.created_at
});
const mapMessage = (row) => ({
    id: String(row.id), authorId: row.author_id, authorName: row.author_name, authorRole: row.author_role,
    body: row.body, createdAt: row.created_at, attachments: []
});
const attachmentSchema = z.object({
    name: z.string().min(1),
    type: z.string().optional().default('application/octet-stream'),
    size: z.number().int().positive().max(maxAttachmentBytes),
    data: z.string().min(1)
}).optional().nullable();
const cleanFileName = (name) => {
    const base = path.basename(name).replace(/[^a-zA-Z0-9._ -]/g, '_').trim();
    return base || 'attachment';
};
const prepareAttachment = (attachment) => {
    if (!attachment)
        return null;
    const fileName = cleanFileName(attachment.name);
    const extension = path.extname(fileName).slice(1).toLowerCase();
    if (!allowedAttachmentExtensions.has(extension))
        throw new Error('Attachment must be PDF, DOC, DOCX, JPG, JPEG, PNG or ZIP');
    const rawBase64 = attachment.data.includes(',') ? attachment.data.split(',').pop() : attachment.data;
    const bytes = Buffer.from(rawBase64, 'base64');
    if (!bytes.length || bytes.length > maxAttachmentBytes)
        throw new Error('Attachment must be 10 MB or smaller');
    return { fileName, mimeType: attachment.type || 'application/octet-stream', sizeBytes: bytes.length, dataBase64: bytes.toString('base64') };
};
const getTicketRow = ticketNumber => one('SELECT * FROM support_tickets WHERE ticket_number=?', [ticketNumber]);
const canAccessTicket = (user, ticket) => canManageSupport(user) || ticket.user_id === user.id || (user.clientId && ticket.client_id === user.clientId);
const canAccessJob = (user, job) => canViewAllJobs(user)
    || (user.clientId && job.client_id === user.clientId)
    || job.created_by_user_id === user.id
    || job.assigned_to_user_id === user.id
    || job.preferred_assignee_user_id === user.id
    || (canViewOwnedClients(user) && (job.client_owner_user_id === user.id || job.client_created_by === user.id))
    || (canViewDepartmentJobs(user) && user.departmentId && job.department_id === user.departmentId);
const canAccessClientRecord = (user, client) => canViewAllClients(user)
    || (user.clientId && client.id === user.clientId)
    || (canViewOwnedClients(user) && (client.account_owner_user_id === user.id || client.created_by === user.id));
const loadVisibleClients = user => {
    if (canViewAllClients(user))
        return query(`SELECT ${clientSelectFields} FROM clients ORDER BY name`);
    if (user.clientId)
        return query(`SELECT ${clientSelectFields} FROM clients WHERE id=?`, [user.clientId]);
    if (canViewOwnedClients(user))
        return query(`SELECT ${clientSelectFields} FROM clients WHERE account_owner_user_id=? OR created_by=? ORDER BY name`, [user.id, user.id]);
    return [];
};
const canUseClientForJob = async (user, clientId) => {
    if (!clientId)
        return false;
    const client = await one('SELECT * FROM clients WHERE id=? AND status=?', [clientId, 'active']);
    return Boolean(client && canAccessClientRecord(user, client));
};
const hasGlobalAssignmentScope = user => isSuperAdmin(user) || canViewAllJobs(user) || canDispatchOverride(user);
const internalAssignableUserSelect = `SELECT u.id,u.name,COALESCE(u.account_type,u.role) accountType,
    u.department_id departmentId,u.designation_id designationId,u.manager_user_id managerUserId,
    d.name departmentName,ds.name designationName,ds.hierarchy_level designationLevel,
    r.name roleName,r.level roleLevel
  FROM users u
  LEFT JOIN departments d ON d.id=u.department_id
  LEFT JOIN designations ds ON ds.id=u.designation_id
  LEFT JOIN roles r ON r.id=u.role_id
  WHERE u.status='active'
    AND COALESCE(u.account_type,u.role)<>'client'
    AND COALESCE(u.account_type,u.role)<>'super_admin'`;
const assignmentScopeAllowsUser = (actor, target) => {
    if (hasGlobalAssignmentScope(actor))
        return true;
    if (target.id === actor.id || target.managerUserId === actor.id)
        return true;
    const sameDepartment = actor.departmentId && Number(target.departmentId || 0) === Number(actor.departmentId);
    if (!sameDepartment)
        return false;
    const targetRoleLevel = Number(target.roleLevel || 0);
    const actorRoleLevel = Number(actor.roleLevel || 0);
    if (targetRoleLevel < actorRoleLevel)
        return true;
    if (targetRoleLevel > actorRoleLevel)
        return false;
    const actorDesignationLevel = actor.designationLevel == null ? Number.POSITIVE_INFINITY : Number(actor.designationLevel || 0);
    const targetDesignationLevel = Number(target.designationLevel || 0);
    return targetDesignationLevel <= actorDesignationLevel;
};
const loadAssignableUsers = async user => {
    const rows = await query(`${internalAssignableUserSelect} ORDER BY r.level DESC,ds.hierarchy_level DESC,d.name IS NULL,d.name,u.name`);
    return rows.filter(candidate => assignmentScopeAllowsUser(user, candidate));
};
const loadAssignableDepartments = async user => {
    const departments = await query("SELECT id,name,code FROM departments WHERE status='active' ORDER BY name");
    if (user.accountType === 'client')
        return departments;
    if (hasGlobalAssignmentScope(user))
        return departments;
    if (!user.departmentId)
        return [];
    return departments.filter(department => Number(department.id) === Number(user.departmentId));
};
const loadClientTeamMembers = async (departmentId, category = '') => {
    if (!departmentId)
        return [];
    const rows = await query(`${internalAssignableUserSelect}
      AND u.department_id=?
      AND (
        NOT EXISTS (
          SELECT 1 FROM employee_job_capabilities ec
          WHERE ec.user_id=u.id AND ec.is_active=1
        )
        OR u.id IN (
          SELECT ec.user_id FROM employee_job_capabilities ec
          WHERE ec.is_active=1 AND LOWER(ec.service_name)=LOWER(?)
        )
      )
      ORDER BY r.level DESC,ds.hierarchy_level DESC,u.name`, [departmentId, category || '']);
    return rows
        .filter(row => Number(row.departmentId || 0) === Number(departmentId))
        .map(row => ({
            id: row.id,
            name: row.name,
            departmentId: row.departmentId,
            departmentName: row.departmentName,
            designationName: row.designationName,
            roleName: row.roleName
        }));
};
const validateAssigneeForUser = async (user, assignedToUserId) => {
    if (!assignedToUserId)
        return { assignee: null };
    const assignee = await one(`${internalAssignableUserSelect} AND u.id=?`, [assignedToUserId]);
    if (!assignee)
        return { status: 400, error: 'Active internal assignee not found' };
    if (!assignmentScopeAllowsUser(user, assignee))
        return { status: 403, error: 'You can only assign jobs to employees in your assignment scope' };
    return { assignee };
};
const validateDepartmentForUser = async (user, departmentId) => {
    if (!departmentId)
        return { departmentId: null };
    const department = await one("SELECT id FROM departments WHERE id=? AND status='active'", [departmentId]);
    if (!department)
        return { status: 400, error: 'Active department not found' };
    if (user.accountType !== 'client' && !hasGlobalAssignmentScope(user) && Number(department.id) !== Number(user.departmentId || 0))
        return { status: 403, error: 'You can only assign jobs within your department' };
    return { departmentId: department.id };
};
const loadVisibleJobs = user => {
    if (canViewAllJobs(user))
        return query(`${jobSelect} ORDER BY j.date_posted DESC`);
    const clauses = [
        'j.created_by_user_id=?',
        'j.assigned_to_user_id=?',
        'j.preferred_assignee_user_id=?',
        `EXISTS (SELECT 1 FROM job_assignment_offers offer WHERE offer.job_id=j.id AND offer.offered_to_user_id=? AND offer.status='pending')`
    ];
    const params = [user.id, user.id, user.id, user.id];
    if (user.clientId) {
        clauses.push('j.client_id=?');
        params.push(user.clientId);
    }
    if (canViewOwnedClients(user)) {
        clauses.push('client.account_owner_user_id=?', 'client.created_by=?');
        params.push(user.id, user.id);
    }
    if (canViewDepartmentJobs(user) && user.departmentId) {
        clauses.push('j.department_id=?');
        params.push(user.departmentId);
    }
    return query(`${jobSelect} WHERE ${clauses.join(' OR ')} ORDER BY j.date_posted DESC`, params);
};
const categoryLoadForUser = async user => {
    if (canViewAllJobs(user))
        return categoryLoad();
    const clauses = [
        'j.created_by_user_id=?',
        'j.assigned_to_user_id=?',
        'j.preferred_assignee_user_id=?',
        `EXISTS (SELECT 1 FROM job_assignment_offers offer WHERE offer.job_id=j.id AND offer.offered_to_user_id=? AND offer.status='pending')`
    ];
    const params = [user.id, user.id, user.id, user.id];
    if (user.clientId) {
        clauses.push('j.client_id=?');
        params.push(user.clientId);
    }
    if (canViewOwnedClients(user)) {
        clauses.push('client.account_owner_user_id=?', 'client.created_by=?');
        params.push(user.id, user.id);
    }
    if (canViewDepartmentJobs(user) && user.departmentId) {
        clauses.push('j.department_id=?');
        params.push(user.departmentId);
    }
    const rows = await query(`SELECT j.category,COUNT(*) count FROM jobs j
      LEFT JOIN clients client ON client.id=j.client_id
      WHERE j.status!='completed' AND j.status!='cancelled' AND (${clauses.join(' OR ')})
      GROUP BY j.category`, params);
    return Object.fromEntries(rows.map(row => [row.category, row.count]));
};
const isoNow = () => new Date().toISOString();
const addMinutesIso = minutes => {
    const date = new Date();
    date.setMinutes(date.getMinutes() + Number(minutes || 0));
    return date.toISOString();
};
const normalizeReferenceLinks = value => {
    const list = Array.isArray(value) ? value : [value];
    return list.map(item => String(item || '').trim()).filter(Boolean);
};
const readAssignmentSettings = async () => {
    const current = await settings();
    return {
        acceptanceMinutes: Number(current.assignmentAcceptanceMinutes || 240),
        enableAutoAssignment: current.enableAutoAssignment !== false,
        skipOverworked: current.skipOverworked !== false,
        maxAutoAssignmentUtilization: Number(current.maxAutoAssignmentUtilization || 115),
        allowClientPreferredEmployee: current.allowClientPreferredEmployee !== false
    };
};
const mapNotification = row => ({
    id: String(row.id),
    userId: row.user_id,
    title: row.title,
    body: row.body,
    type: row.type,
    jobId: row.job_id,
    isRead: Boolean(row.is_read),
    createdAt: row.created_at,
    readAt: row.read_at
});
const loadNotifications = async user => {
    const rows = await query(`SELECT * FROM notifications
      WHERE user_id=?
      ORDER BY is_read ASC,created_at DESC,id DESC
      LIMIT 50`, [user.id]);
    return rows.map(mapNotification);
};
const notifyUser = async (userId, payload, connection = pool) => {
    if (!userId)
        return;
    await query(`INSERT INTO notifications (user_id,title,body,type,job_id,created_at)
      VALUES (?,?,?,?,?,?)`, [
        userId,
        payload.title || 'Notification',
        payload.body || '',
        payload.type || 'info',
        payload.jobId || null,
        payload.createdAt || isoNow()
    ], connection);
};
const notifyUsers = async (userIds, payload, connection = pool) => {
    const uniqueIds = [...new Set((userIds || []).filter(Boolean))];
    for (const userId of uniqueIds)
        await notifyUser(userId, payload, connection);
};
const notifyClientUsers = async (clientId, payload, connection = pool) => {
    if (!clientId)
        return;
    const rows = await query("SELECT id FROM users WHERE status='active' AND (client_id=? OR id=?)", [clientId, clientId], connection);
    await notifyUsers(rows.map(row => row.id).filter(id => id !== 'system'), payload, connection);
};
const notifyDepartmentUsers = async (departmentId, payload, connection = pool) => {
    if (!departmentId)
        return;
    const rows = await query(
        `SELECT id FROM users
          WHERE status='active'
            AND department_id=?
            AND COALESCE(account_type,role)<>'client'
            AND COALESCE(account_type,role)<>'super_admin'`,
        [departmentId],
        connection
    );
    await notifyUsers(rows.map(row => row.id), payload, connection);
};
const notifyCoordinatorsForJob = async (job, payload, connection = pool) => {
    const rows = await query(
        `SELECT DISTINCT jc.user_id id
          FROM job_coordinators jc
          JOIN users u ON u.id=jc.user_id AND u.status='active'
          WHERE jc.is_active=1
            AND (jc.receive_all_client_jobs=1 OR jc.department_id IS NULL OR jc.department_id=?)`,
        [job.department_id || null],
        connection
    );
    await notifyUsers(rows.map(row => row.id), payload, connection);
};
const createJobEvent = async ({ jobId, eventType, actorUserId = null, visibility = 'client', title, body = '', metadata = {} }, connection = pool) => {
    await query(`INSERT INTO job_events
      (job_id,event_type,actor_user_id,visibility,title,body,metadata_json,created_at)
      VALUES (?,?,?,?,?,?,?,?)`, [
        jobId,
        eventType,
        actorUserId,
        visibility,
        title,
        body,
        JSON.stringify(metadata || {}),
        isoNow()
    ], connection);
};
const mapAssignmentOffer = row => ({
    id: String(row.id),
    jobId: row.job_id || row.jobId,
    offeredToUserId: row.offered_to_user_id || row.offeredToUserId,
    offeredToName: row.offered_to_name || row.offeredToName,
    offeredByUserId: row.offered_by_user_id || row.offeredByUserId,
    offeredByName: row.offered_by_name || row.offeredByName,
    offerType: row.offer_type || row.offerType,
    status: row.status,
    offeredAt: row.offered_at || row.offeredAt,
    expiresAt: row.expires_at || row.expiresAt,
    acceptedAt: row.accepted_at || row.acceptedAt,
    declinedAt: row.declined_at || row.declinedAt,
    declineReason: row.decline_reason || row.declineReason || '',
    jobTitle: row.job_title || row.jobTitle,
    clientId: row.client_id || row.clientId,
    category: row.category,
    priority: row.priority,
    departmentName: row.department_name || row.departmentName
});
const loadAssignmentRequests = async user => {
    if (user.accountType === 'client')
        return [];
    const rows = await query(`SELECT offer.id,offer.job_id,offer.offered_to_user_id,offer.offered_by_user_id,
        offer.offer_type,offer.status,offer.offered_at,offer.expires_at,offer.accepted_at,offer.declined_at,offer.decline_reason,
        offered_to.name offered_to_name,offered_by.name offered_by_name,
        j.title job_title,j.client_id,j.category,j.priority,department.name department_name
      FROM job_assignment_offers offer
      JOIN jobs j ON j.id=offer.job_id
      LEFT JOIN users offered_to ON offered_to.id=offer.offered_to_user_id
      LEFT JOIN users offered_by ON offered_by.id=offer.offered_by_user_id
      LEFT JOIN departments department ON department.id=j.department_id
      WHERE offer.offered_to_user_id=?
        AND offer.status='pending'
        AND j.status NOT IN ('completed','cancelled')
      ORDER BY offer.expires_at IS NULL,offer.expires_at,offer.id DESC`, [user.id]);
    return rows.map(mapAssignmentOffer);
};
const loadJobEvents = async (jobId, includeInternal = true) => {
    const visibilityClause = includeInternal ? '' : "AND visibility='client'";
    const rows = await query(`SELECT e.id,e.job_id jobId,e.event_type eventType,e.actor_user_id actorUserId,
        actor.name actorName,e.visibility,e.title,e.body,e.metadata_json metadataJson,e.created_at createdAt
      FROM job_events e
      LEFT JOIN users actor ON actor.id=e.actor_user_id
      WHERE e.job_id=? ${visibilityClause}
      ORDER BY e.created_at DESC,e.id DESC`, [jobId]);
    return rows.map(row => {
        let metadata = {};
        try {
            metadata = JSON.parse(row.metadataJson || '{}');
        }
        catch {
            metadata = {};
        }
        return { ...row, id: String(row.id), metadata };
    });
};
const createAssignmentOffer = async ({ jobId, offeredToUserId, offeredByUserId = null, offerType = 'preferred', expiresAt = null }, connection = pool) => {
    const existing = await one(
        "SELECT id FROM job_assignment_offers WHERE job_id=? AND offered_to_user_id=? AND status='pending' LIMIT 1",
        [jobId, offeredToUserId],
        connection
    );
    if (existing)
        return existing.id;
    const result = await query(`INSERT INTO job_assignment_offers
      (job_id,offered_to_user_id,offered_by_user_id,offer_type,status,offered_at,expires_at)
      VALUES (?,?,?,?,?,?,?)`, [jobId, offeredToUserId, offeredByUserId, offerType, 'pending', isoNow(), expiresAt], connection);
    return result.insertId;
};
const assignmentQueueWhere = `j.status NOT IN ('completed','cancelled')
  AND (j.assigned_to_user_id IS NULL OR j.assignment_state IN ('pending_acceptance','needs_assignment','declined'))
  AND (j.assignment_state IN ('unassigned','pending_acceptance','needs_assignment','declined') OR j.status IN ('submitted','pending_acceptance','needs_assignment'))`;
const loadDispatchQueue = async user => {
    if (!canViewDispatch(user))
        return [];
    const params = [];
    const scopeClauses = [];
    if (hasGlobalAssignmentScope(user)) {
        scopeClauses.push('1=1');
    }
    else {
        const coordinatorRows = await query('SELECT department_id departmentId,receive_all_client_jobs receiveAllClientJobs FROM job_coordinators WHERE user_id=? AND is_active=1', [user.id]);
        if (coordinatorRows.some(row => Boolean(row.receiveAllClientJobs) || row.departmentId == null)) {
            scopeClauses.push('1=1');
        }
        else {
            const departments = [...new Set([
                user.departmentId,
                ...coordinatorRows.map(row => row.departmentId)
            ].filter(Boolean).map(Number))];
            if (departments.length) {
                scopeClauses.push(`j.department_id IN (${departments.map(() => '?').join(',')})`);
                params.push(...departments);
            }
        }
    }
    if (!scopeClauses.length)
        return [];
    const rows = await query(`${jobSelect}
      WHERE ${assignmentQueueWhere} AND (${scopeClauses.join(' OR ')})
      ORDER BY j.acceptance_deadline_at IS NULL,j.acceptance_deadline_at,j.date_posted DESC
      LIMIT 120`, params);
    return rows.map(row => mapJob(row, true));
};
const dispatchScopeAllowsJob = async (user, job) => {
    if (!canViewDispatch(user))
        return false;
    if (hasGlobalAssignmentScope(user))
        return true;
    if (user.departmentId && Number(user.departmentId) === Number(job.department_id || 0))
        return true;
    const rows = await query('SELECT department_id departmentId,receive_all_client_jobs receiveAllClientJobs FROM job_coordinators WHERE user_id=? AND is_active=1', [user.id]);
    return rows.some(row => Boolean(row.receiveAllClientJobs) || row.departmentId == null || Number(row.departmentId) === Number(job.department_id || 0));
};
const validateClientPreferredAssignee = async ({ preferredAssigneeUserId, departmentId, category }) => {
    if (!preferredAssigneeUserId)
        return { assignee: null };
    const candidates = await loadClientTeamMembers(departmentId, category);
    const assignee = candidates.find(candidate => candidate.id === preferredAssigneeUserId);
    if (!assignee)
        return { status: 400, error: 'Preferred employee is not available for the selected department' };
    return { assignee };
};
const loadRankedAssignmentCandidates = async (job, options = {}) => {
    const settingsForAssignment = options.settings || await readAssignmentSettings();
    const params = [];
    let departmentFilter = '';
    if (job.department_id) {
        departmentFilter = 'AND u.department_id=?';
        params.push(job.department_id);
    }
    const candidates = await query(`${internalAssignableUserSelect}
      ${departmentFilter}
      ORDER BY r.level DESC,ds.hierarchy_level DESC,u.name`, params);
    const enriched = [];
    for (const candidate of candidates) {
        const active = await one(
            `SELECT COUNT(*) count FROM jobs
              WHERE assigned_to_user_id=?
                AND status NOT IN ('completed','cancelled')`,
            [candidate.id]
        );
        const capacity = await one('SELECT weekly_capacity_hours weeklyCapacityHours FROM productivity_employee_settings WHERE user_id=?', [candidate.id]);
        const weeklyCapacityHours = Number(capacity?.weeklyCapacityHours || 40);
        const activeJobCount = Number(active?.count || 0);
        const estimatedHours = activeJobCount * 8;
        const utilization = weeklyCapacityHours ? Math.round((estimatedHours / weeklyCapacityHours) * 100) : 0;
        enriched.push({ ...candidate, activeJobCount, weeklyCapacityHours, utilization });
    }
    const filtered = settingsForAssignment.skipOverworked
        ? enriched.filter(candidate => candidate.utilization <= settingsForAssignment.maxAutoAssignmentUtilization)
        : enriched;
    return (filtered.length ? filtered : enriched)
        .sort((a, b) => a.activeJobCount - b.activeJobCount
            || a.utilization - b.utilization
            || Number(b.roleLevel || 0) - Number(a.roleLevel || 0)
            || String(a.name).localeCompare(String(b.name)));
};
const assignJobToUser = async ({ jobId, assigneeUserId, actorUserId = null, note = '', method = 'manual', allowReassign = false }, connection = pool) => {
    const job = await one(`${jobSelect} WHERE j.id=? FOR UPDATE`, [jobId], connection);
    if (!job)
        return { status: 404, error: 'Job not found' };
    if (['completed', 'cancelled'].includes(job.status))
        return { status: 409, error: 'Completed or cancelled jobs cannot be assigned' };
    if (job.assigned_to_user_id && !allowReassign)
        return { status: 409, error: 'Job is already assigned' };
    const assignee = await one(`${internalAssignableUserSelect} AND u.id=?`, [assigneeUserId], connection);
    if (!assignee)
        return { status: 400, error: 'Active internal assignee not found' };
    const now = isoNow();
    const nextDepartmentId = assignee.departmentId || job.department_id || null;
    await query(`UPDATE jobs
      SET assigned_to_user_id=?,assigned_by_user_id=?,department_id=?,assignment_date=?,
        assignment_note=?,assignment_state='assigned',status=?,
        accepted_at=?,assignment_method=?,assignment_source_user_id=?,updated_at=?
      WHERE id=?`, [
        assignee.id,
        actorUserId,
        nextDepartmentId,
        now,
        note || '',
        ['submitted', 'pending_acceptance', 'needs_assignment'].includes(job.status) ? 'assigned' : job.status,
        now,
        method,
        actorUserId || assignee.id,
        now,
        jobId
    ], connection);
    await query(`INSERT INTO job_assignments
      (job_id,previous_assignee_user_id,assigned_to_user_id,assigned_by_user_id,previous_department_id,department_id,note)
      VALUES (?,?,?,?,?,?,?)`, [
        jobId,
        job.assigned_to_user_id || null,
        assignee.id,
        actorUserId,
        job.department_id || null,
        nextDepartmentId,
        note || ''
    ], connection);
    await query("UPDATE job_assignment_offers SET status='cancelled' WHERE job_id=? AND status='pending' AND offered_to_user_id<>?", [jobId, assignee.id], connection);
    await createJobEvent({
        jobId,
        eventType: 'job_assigned',
        actorUserId,
        visibility: 'client',
        title: 'Job assigned',
        body: `${assignee.name} has been assigned to this job.`,
        metadata: { assigneeUserId: assignee.id, method }
    }, connection);
    await notifyUser(assignee.id, {
        title: 'New job assigned',
        body: `${job.title} is now assigned to you.`,
        type: 'job_assigned',
        jobId
    }, connection);
    await notifyClientUsers(job.client_id, {
        title: 'Your job is assigned',
        body: `${job.title} is assigned to ${assignee.name}.`,
        type: 'job_assigned',
        jobId
    }, connection);
    return { jobId, assignee };
};
let autoAssignmentRunning = false;
const processExpiredAssignmentOffers = async () => {
    if (!databaseReady || autoAssignmentRunning)
        return;
    autoAssignmentRunning = true;
    try {
        const assignmentSettings = await readAssignmentSettings();
        if (!assignmentSettings.enableAutoAssignment)
            return;
        const now = isoNow();
        const rows = await query(`${jobSelect}
          WHERE j.assigned_to_user_id IS NULL
            AND j.assignment_state='pending_acceptance'
            AND j.acceptance_deadline_at IS NOT NULL
            AND j.acceptance_deadline_at<=?
            AND j.status NOT IN ('completed','cancelled')
          ORDER BY j.acceptance_deadline_at
          LIMIT 20`, [now]);
        for (const job of rows) {
            await transaction(async connection => {
                const lockedJob = await one(`${jobSelect} WHERE j.id=? FOR UPDATE`, [job.id], connection);
                if (!lockedJob || lockedJob.assigned_to_user_id || lockedJob.assignment_state !== 'pending_acceptance')
                    return;
                await query("UPDATE job_assignment_offers SET status='expired' WHERE job_id=? AND status='pending' AND (expires_at IS NULL OR expires_at<=?)", [lockedJob.id, now], connection);
                const candidates = await loadRankedAssignmentCandidates(lockedJob, { settings: assignmentSettings });
                const declinedRows = await query("SELECT offered_to_user_id id FROM job_assignment_offers WHERE job_id=? AND status IN ('declined','expired')", [lockedJob.id], connection);
                const declined = new Set(declinedRows.map(row => row.id));
                const candidate = candidates.find(item => !declined.has(item.id)) || candidates[0];
                if (!candidate) {
                    await query(`UPDATE jobs
                      SET assignment_state='needs_assignment',status='needs_assignment',auto_assignment_attempted_at=?,updated_at=?
                      WHERE id=?`, [now, now, lockedJob.id], connection);
                    await notifyCoordinatorsForJob(lockedJob, {
                        title: 'Auto assignment needs review',
                        body: `${lockedJob.title} has no eligible employee available.`,
                        type: 'auto_assignment_failed',
                        jobId: lockedJob.id
                    }, connection);
                    await createJobEvent({
                        jobId: lockedJob.id,
                        eventType: 'auto_assignment_failed',
                        visibility: 'internal',
                        title: 'Auto assignment needs review',
                        body: 'No eligible employee was available for automatic assignment.'
                    }, connection);
                    return;
                }
                await assignJobToUser({
                    jobId: lockedJob.id,
                    assigneeUserId: candidate.id,
                    actorUserId: null,
                    note: 'Automatically assigned after acceptance deadline',
                    method: 'auto_assignment',
                    allowReassign: false
                }, connection);
                await query('UPDATE jobs SET auto_assignment_attempted_at=? WHERE id=?', [now, lockedJob.id], connection);
                await notifyCoordinatorsForJob(lockedJob, {
                    title: 'Job auto assigned',
                    body: `${lockedJob.title} was auto assigned to ${candidate.name}.`,
                    type: 'auto_assignment',
                    jobId: lockedJob.id
                }, connection);
                await audit('system', 'job_auto_assigned', 'job', lockedJob.id, { assignedToUserId: candidate.id }, connection);
            });
        }
        if (rows.length)
            emitRefresh();
    }
    catch (error) {
        console.error('Auto assignment worker failed', error);
    }
    finally {
        autoAssignmentRunning = false;
    }
};
const managerCreatesCycle = async (userId, managerUserId) => {
    if (!managerUserId)
        return false;
    let current = managerUserId;
    let depth = 0;
    while (current && depth < 100) {
        if (current === userId)
            return true;
        const row = await one('SELECT manager_user_id FROM users WHERE id=?', [current]);
        current = row?.manager_user_id;
        depth += 1;
    }
    return false;
};
const validateOrgReferences = async ({ departmentId, designationId, managerUserId, userId }) => {
    if (Number.isNaN(departmentId))
        return 'Department is invalid';
    if (Number.isNaN(designationId))
        return 'Designation is invalid';
    if (departmentId) {
        const department = await one("SELECT id FROM departments WHERE id=? AND status='active'", [departmentId]);
        if (!department)
            return 'Active department not found';
    }
    if (designationId) {
        const designation = await one("SELECT id FROM designations WHERE id=? AND status='active'", [designationId]);
        if (!designation)
            return 'Active designation not found';
    }
    if (managerUserId) {
        if (managerUserId === userId)
            return 'A user cannot report to themselves';
        const manager = await one("SELECT id,account_type FROM users WHERE id=? AND status='active'", [managerUserId]);
        if (!manager || manager.account_type === 'client')
            return 'Active internal reporting manager not found';
        if (await managerCreatesCycle(userId, managerUserId))
            return 'Reporting manager would create a circular hierarchy';
    }
    return '';
};
const validatePermissionIds = async (permissionIds, roleType) => {
    const uniqueIds = [...new Set(permissionIds || [])];
    if (!uniqueIds.length)
        return { permissionIds: uniqueIds };
    const existing = await query(`SELECT id FROM permissions WHERE id IN (${uniqueIds.map(() => '?').join(',')})`, uniqueIds);
    if (existing.length !== uniqueIds.length)
        return { error: 'One or more permissions are invalid' };
    if (roleType === 'client') {
        const unsafe = uniqueIds.find(permission => !clientSafePermissions.has(permission));
        if (unsafe)
            return { error: 'Client roles cannot receive internal administrative permissions' };
    }
    return { permissionIds: uniqueIds };
};
const productivityInternal = (req, res, next) => {
    if (req.user.accountType === 'client')
        return res.status(403).json({ error: 'Productivity Intelligence is internal only' });
    next();
};
const productivityRange = req => resolveProductivityPeriod(req.query);
const emitProductivityMutation = (entity, id) => {
    emitProductivityChanged({ entity, id });
    emitRefresh();
};
const validateProductivityReferences = async payload => {
    const client = await one("SELECT id FROM clients WHERE id=? AND status='active'", [payload.clientId]);
    if (!client)
        return 'Active client not found';
    const serviceIds = [...new Set(payload.serviceIds || [])];
    const services = await query(`SELECT id FROM productivity_services WHERE id IN (${serviceIds.map(() => '?').join(',')}) AND is_active=1`, serviceIds);
    if (services.length !== serviceIds.length)
        return 'One or more active productivity services were not found';
    const userIds = [...new Set((payload.assignments || []).map(assignment => assignment.userId))];
    const users = await query(`SELECT id FROM users WHERE id IN (${userIds.map(() => '?').join(',')}) AND status='active' AND COALESCE(account_type,role)<>'client'`, userIds);
    if (users.length !== userIds.length)
        return 'One or more active internal assignees were not found';
    const dateError = validateProductivityDates(payload);
    if (dateError)
        return dateError;
    const totalPercent = payload.assignments.reduce((sum, assignment) => sum + Number(assignment.revenuePercent || 0), 0);
    if (Math.abs(totalPercent - 100) > 0.01)
        return 'Revenue allocation must total exactly 100%';
    return '';
};
const normalizeRosterAssignments = assignments => assignments.flatMap(assignment => {
    if (!productivityResponsibilities.some(([key]) => key === assignment.responsibilityKey))
        return [];
    if (assignment.assigneeType === 'employee' && assignment.userId)
        return [{ ...assignment, externalName: '' }];
    if (assignment.assigneeType === 'external' && assignment.externalName)
        return [{ ...assignment, userId: '' }];
    return [{ responsibilityKey: assignment.responsibilityKey, assigneeType: 'tbd', userId: '', externalName: '' }];
});
const validateRosterReferences = async payload => {
    const client = await one("SELECT id FROM clients WHERE id=? AND status='active'", [payload.clientId]);
    if (!client)
        return 'Active client not found';
    const userIds = [...new Set(payload.assignments.filter(item => item.assigneeType === 'employee' && item.userId).map(item => item.userId))];
    if (userIds.length) {
        const users = await query(`SELECT id FROM users WHERE id IN (${userIds.map(() => '?').join(',')}) AND status='active' AND COALESCE(account_type,role)<>'client'`, userIds);
        if (users.length !== userIds.length)
            return 'One or more roster employees were not found';
    }
    return '';
};
const ticketDetail = async ticket => {
    const messages = (await query('SELECT * FROM support_ticket_messages WHERE ticket_id=? ORDER BY created_at ASC,id ASC', [ticket.id])).map(mapMessage);
    const attachments = (await query('SELECT a.*,t.ticket_number FROM support_ticket_attachments a JOIN support_tickets t ON t.id=a.ticket_id WHERE a.ticket_id=? ORDER BY a.created_at ASC,a.id ASC', [ticket.id])).map(mapAttachment);
    const byMessage = new Map(messages.map(message => [Number(message.id), message]));
    for (const attachment of attachments) {
        const messageId = attachment.messageId ? Number(attachment.messageId) : null;
        if (messageId && byMessage.has(messageId))
            byMessage.get(messageId).attachments.push(attachment);
    }
    return { ...mapTicket(ticket), messages, attachments };
};
app.get('/api/health', async (_req, res) => res.status(databaseReady ? 200 : 503).json({
    ok: databaseReady,
    database: databaseReady ? 'ready' : (databaseInitError ? 'error' : 'starting'),
    ...databaseHealthDetails(),
    error: databaseReady || process.env.NODE_ENV === 'production' ? undefined : databaseInitError?.message
}));
app.use('/api', (_req, res, next) => {
    if (databaseReady)
        return next();
    res.status(503).json({ error: 'Database is not ready' });
});
app.post('/api/auth/login', checkLoginRateLimit, async (req, res) => {
    const parsed = z.object({ id: z.string().min(1), password: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
        recordLoginFailure(req);
        return res.status(400).json({ error: 'ID and password are required' });
    }
    const loginId = parsed.data.id.trim();
    const envSuperAdmin = environmentSuperAdminCredentials();
    if (envSuperAdmin.id
        && envSuperAdmin.password
        && [envSuperAdmin.id, envSuperAdmin.email].filter(Boolean).includes(loginId)
        && parsed.data.password === envSuperAdmin.password) {
        await ensureEnvironmentSuperAdmin();
    }
    if (shouldRepairDemoLogin(loginId, parsed.data.password)) {
        await seedDemoUsers();
    }
    const user = await one("SELECT * FROM users WHERE (id=? OR email=?) AND status='active' ORDER BY id=? DESC LIMIT 1", [loginId, loginId, loginId]);
    if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) {
        recordLoginFailure(req);
        return res.status(401).json({ error: 'Incorrect ID or password' });
    }
    recordLoginSuccess(req);
    await query('UPDATE users SET last_login=?,updated_at=? WHERE id=?', [new Date(), new Date(), user.id]);
    const authUser = await loadUserContext(user.id);
    res.json({ token: signToken({ id: authUser.id }), user: authUser, permissions: authUser.permissions, modules: authUser.modules });
});
app.get('/api/bootstrap', requireAuth, async (req, res) => {
    const user = req.user;
    const visibleModuleIds = new Set((user.modules || []).map(module => module.id));
    const includeInternalJobFields = user.accountType !== 'client';
    const canReadJobs = visibleModuleIds.has('jobs') && hasAnyPermission(user, ['jobs.view_all', 'jobs.view_own', 'jobs.view_department']);
    const canReadSupport = visibleModuleIds.has('support') && hasAnyPermission(user, ['support.view_all', 'support.view_own', 'support.manage']);
    const canReadSettings = (visibleModuleIds.has('settings') || visibleModuleIds.has('app_settings')) && hasAnyPermission(user, ['settings.view', 'settings.edit']);
    const canClientCreateJobs = user.accountType === 'client' && visibleModuleIds.has('submit') && hasPermission(user, 'jobs.create');
    const canReadDispatchQueue = visibleModuleIds.has('dispatch') && canViewDispatch(user);
    const jobRows = canReadJobs ? await loadVisibleJobs(user) : [];
    const clients = (user.accountType === 'client' || visibleModuleIds.has('clients') || visibleModuleIds.has('submit')) ? await loadVisibleClients(user) : [];
    const ticketRows = !canReadSupport
        ? []
        : canManageSupport(user)
            ? await query('SELECT * FROM support_tickets ORDER BY updated_at DESC,id DESC')
            : await query('SELECT * FROM support_tickets WHERE user_id=? OR client_id=? ORDER BY updated_at DESC,id DESC', [user.id, user.clientId || '']);
    const assignees = user.accountType !== 'client' && (canAssignJobs(user) || canDispatchAssign(user) || canDispatchClaim(user))
        ? await loadAssignableUsers(user)
        : [];
    const departments = canClientCreateJobs || canAssignJobs(user) || canViewDepartmentJobs(user) || canViewDispatch(user)
        ? await loadAssignableDepartments(user)
        : [];
    const clientOwners = hasPermission(user, 'clients.assign_owner')
        ? await query(`SELECT id,name,COALESCE(account_type,role) accountType,department_id departmentId FROM users
            WHERE status='active' AND COALESCE(account_type,role)<>'client' ORDER BY name`)
        : [];
    const currentSettings = await settings();
    const bootstrapSettings = !canReadSettings
        ? {
            categories: currentSettings.categories.map(category => ({ name: category.name })),
            startHour: currentSettings.startHour,
            endHour: currentSettings.endHour,
            workDays: currentSettings.workDays,
            capacityPerCategory: 1,
            bufferHoursPerExtraJob: 0
        }
        : currentSettings;
    res.json({
        user,
        permissions: user.permissions,
        modules: user.modules,
        jobs: jobRows.map(row => mapJob(row, includeInternalJobFields)),
        clients: user.accountType === 'client' ? clients.map(client => ({ id: client.id, name: client.name, status: client.status })) : clients,
        supportTickets: ticketRows.map(mapTicket),
        settings: bootstrapSettings,
        categoryLoad: !canReadJobs || user.accountType === 'client' ? {} : await categoryLoadForUser(user),
        assignees,
        departments,
        clientOwners,
        notifications: hasPermission(user, 'notifications.view') ? await loadNotifications(user) : [],
        assignmentRequests: await loadAssignmentRequests(user),
        dispatchQueue: canReadDispatchQueue ? await loadDispatchQueue(user) : []
    });
});
app.get('/api/job-options', requireAuth, requirePermission('jobs.create'), requireModuleAccess('submit'), async (req, res) => {
    const departmentId = optionalId(req.query.departmentId);
    if (Number.isNaN(departmentId))
        return res.status(400).json({ error: 'Department is invalid' });
    const currentSettings = await settings();
    const departments = req.user.accountType === 'client'
        ? await query("SELECT id,name,code FROM departments WHERE status='active' ORDER BY name")
        : await loadAssignableDepartments(req.user);
    const teamMembers = req.user.accountType === 'client'
        ? await loadClientTeamMembers(departmentId, String(req.query.category || ''))
        : departmentId
            ? (await loadAssignableUsers(req.user)).filter(user => Number(user.departmentId || 0) === Number(departmentId))
            : [];
    res.json({
        categories: (currentSettings.categories || []).map(category => ({ name: category.name })),
        departments,
        teamMembers
    });
});
app.get('/api/notifications', requireAuth, requirePermission('notifications.view'), requireModuleAccess('notifications'), async (req, res) => {
    res.json({ notifications: await loadNotifications(req.user) });
});
app.post('/api/notifications/:id/read', requireAuth, requirePermission('notifications.view'), requireModuleAccess('notifications'), async (req, res) => {
    await query('UPDATE notifications SET is_read=1,read_at=? WHERE id=? AND user_id=?', [isoNow(), req.params.id, req.user.id]);
    res.json({ ok: true });
});
app.post('/api/notifications/read-all', requireAuth, requirePermission('notifications.view'), requireModuleAccess('notifications'), async (req, res) => {
    await query('UPDATE notifications SET is_read=1,read_at=? WHERE user_id=? AND is_read=0', [isoNow(), req.user.id]);
    res.json({ ok: true });
});
app.get('/api/jobs/assignment-requests', requireAuth, requirePermission('jobs.view_own'), requireModuleAccess('jobs'), async (req, res) => {
    res.json({ assignmentRequests: await loadAssignmentRequests(req.user) });
});
app.get('/api/jobs/dispatch-queue', requireAuth, requirePermission('jobs.dispatch.view'), requireModuleAccess('dispatch'), async (req, res) => {
    res.json({ dispatchQueue: await loadDispatchQueue(req.user) });
});
app.post('/api/jobs/:id/accept', requireAuth, requirePermission('jobs.view_own'), requireModuleAccess('jobs'), async (req, res) => {
    const offer = await one(
        `SELECT offer.*,j.title job_title,j.assigned_to_user_id
          FROM job_assignment_offers offer
          JOIN jobs j ON j.id=offer.job_id
          WHERE offer.job_id=? AND offer.offered_to_user_id=? AND offer.status='pending'
          ORDER BY offer.id DESC LIMIT 1`,
        [req.params.id, req.user.id]
    );
    if (!offer)
        return res.status(404).json({ error: 'Pending assignment request not found' });
    if (offer.expires_at && new Date(offer.expires_at).getTime() < Date.now())
        return res.status(409).json({ error: 'This assignment request has expired' });
    const result = await transaction(async connection => {
        const assignResult = await assignJobToUser({
            jobId: req.params.id,
            assigneeUserId: req.user.id,
            actorUserId: req.user.id,
            note: 'Accepted assignment request',
            method: 'employee_accept',
            allowReassign: offer.offer_type === 'reassignment'
        }, connection);
        if (assignResult.error)
            return assignResult;
        await query("UPDATE job_assignment_offers SET status='accepted',accepted_at=? WHERE id=?", [isoNow(), offer.id], connection);
        await createJobEvent({
            jobId: req.params.id,
            eventType: 'assignment_accepted',
            actorUserId: req.user.id,
            visibility: 'client',
            title: 'Assignment accepted',
            body: `${req.user.name} accepted the job assignment.`
        }, connection);
        await audit(req.user.id, 'assignment_accepted', 'job', req.params.id, {}, connection);
        return assignResult;
    });
    if (result.error)
        return res.status(result.status || 409).json({ error: result.error });
    emitRefresh();
    res.json({ job: mapJob(await one(`${jobSelect} WHERE j.id=?`, [req.params.id]), true) });
});
app.post('/api/jobs/:id/decline', requireAuth, requirePermission('jobs.view_own'), requireModuleAccess('jobs'), async (req, res) => {
    const parsed = z.object({ reason: z.string().trim().max(1000).optional().default('') }).safeParse(req.body || {});
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const offer = await one(
        `SELECT offer.*,j.title job_title,j.client_id,j.department_id
          FROM job_assignment_offers offer
          JOIN jobs j ON j.id=offer.job_id
          WHERE offer.job_id=? AND offer.offered_to_user_id=? AND offer.status='pending'
          ORDER BY offer.id DESC LIMIT 1`,
        [req.params.id, req.user.id]
    );
    if (!offer)
        return res.status(404).json({ error: 'Pending assignment request not found' });
    await transaction(async connection => {
        await query("UPDATE job_assignment_offers SET status='declined',declined_at=?,decline_reason=? WHERE id=?", [isoNow(), parsed.data.reason, offer.id], connection);
        const pending = await one("SELECT COUNT(*) count FROM job_assignment_offers WHERE job_id=? AND status='pending'", [req.params.id], connection);
        if (!Number(pending?.count || 0)) {
            await query(`UPDATE jobs SET assignment_state='needs_assignment',status='needs_assignment',updated_at=? WHERE id=? AND assigned_to_user_id IS NULL`, [isoNow(), req.params.id], connection);
        }
        await createJobEvent({
            jobId: req.params.id,
            eventType: 'assignment_declined',
            actorUserId: req.user.id,
            visibility: 'internal',
            title: 'Assignment declined',
            body: parsed.data.reason || `${req.user.name} declined the assignment.`
        }, connection);
        await notifyCoordinatorsForJob(offer, {
            title: 'Assignment declined',
            body: `${req.user.name} declined ${offer.job_title}.`,
            type: 'assignment_declined',
            jobId: req.params.id
        }, connection);
        await audit(req.user.id, 'assignment_declined', 'job', req.params.id, { reason: parsed.data.reason }, connection);
    });
    emitRefresh();
    res.json({ ok: true });
});
app.post('/api/jobs/:id/dispatch-offer', requireAuth, requirePermission('jobs.dispatch.assign', 'jobs.dispatch.reassign'), requireModuleAccess('dispatch'), async (req, res) => {
    const parsed = z.object({
        userId: z.string().trim().min(1),
        note: z.string().trim().max(1000).optional().default(''),
        departmentId: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable()
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const row = await one(`${jobSelect} WHERE j.id=?`, [req.params.id]);
    if (!row)
        return res.status(404).json({ error: 'Job not found' });
    if (!(await dispatchScopeAllowsJob(req.user, row)))
        return res.status(403).json({ error: 'Dispatch scope denied' });
    if (row.assigned_to_user_id && !hasPermission(req.user, 'jobs.dispatch.reassign'))
        return res.status(403).json({ error: 'Dispatch reassignment permission required' });
    const assigneeValidation = await validateAssigneeForUser(req.user, parsed.data.userId);
    if (assigneeValidation.error)
        return res.status(assigneeValidation.status).json({ error: assigneeValidation.error });
    const departmentId = parsed.data.departmentId === undefined ? row.department_id || assigneeValidation.assignee?.departmentId || null : optionalId(parsed.data.departmentId);
    if (Number.isNaN(departmentId))
        return res.status(400).json({ error: 'Department is invalid' });
    const departmentValidation = await validateDepartmentForUser(req.user, departmentId);
    if (departmentValidation.error)
        return res.status(departmentValidation.status).json({ error: departmentValidation.error });
    const assignmentSettings = await readAssignmentSettings();
    const expiresAt = addMinutesIso(assignmentSettings.acceptanceMinutes);
    await transaction(async connection => {
        await createAssignmentOffer({
            jobId: req.params.id,
            offeredToUserId: parsed.data.userId,
            offeredByUserId: req.user.id,
            offerType: row.assigned_to_user_id ? 'reassignment' : 'coordinator',
            expiresAt
        }, connection);
        await query(`UPDATE jobs
          SET preferred_assignee_user_id=?,department_id=?,assignment_state='pending_acceptance',
            status='pending_acceptance',acceptance_deadline_at=?,assignment_method='coordinator_offer',
            assignment_source_user_id=?,assignment_note=?,updated_at=?
          WHERE id=?`, [parsed.data.userId, departmentValidation.departmentId, expiresAt, req.user.id, parsed.data.note, isoNow(), req.params.id], connection);
        await createJobEvent({
            jobId: req.params.id,
            eventType: 'assignment_offer_sent',
            actorUserId: req.user.id,
            visibility: 'client',
            title: 'Assignment request sent',
            body: `The job was sent to ${assigneeValidation.assignee.name} for acceptance.`
        }, connection);
        await notifyUser(parsed.data.userId, {
            title: 'Job assignment request',
            body: `${row.title} is waiting for your acceptance.`,
            type: 'assignment_request',
            jobId: req.params.id
        }, connection);
        await audit(req.user.id, 'dispatch_offer_created', 'job', req.params.id, parsed.data, connection);
    });
    emitRefresh();
    res.json({ job: mapJob(await one(`${jobSelect} WHERE j.id=?`, [req.params.id]), true) });
});
app.post('/api/jobs/:id/assign-to-me', requireAuth, requirePermission('jobs.dispatch.claim'), requireModuleAccess('dispatch'), async (req, res) => {
    const row = await one(`${jobSelect} WHERE j.id=?`, [req.params.id]);
    if (!row)
        return res.status(404).json({ error: 'Job not found' });
    if (!(await dispatchScopeAllowsJob(req.user, row)))
        return res.status(403).json({ error: 'Dispatch scope denied' });
    const result = await transaction(async connection => {
        const assignResult = await assignJobToUser({
            jobId: req.params.id,
            assigneeUserId: req.user.id,
            actorUserId: req.user.id,
            note: 'Claimed from dispatch queue',
            method: 'coordinator_claim',
            allowReassign: false
        }, connection);
        if (!assignResult.error)
            await audit(req.user.id, 'dispatch_job_claimed', 'job', req.params.id, {}, connection);
        return assignResult;
    });
    if (result.error)
        return res.status(result.status || 409).json({ error: result.error });
    emitRefresh();
    res.json({ job: mapJob(await one(`${jobSelect} WHERE j.id=?`, [req.params.id]), true) });
});
app.get('/api/job-coordinators', requireAuth, requirePermission('jobs.dispatch.view'), requireModuleAccess('dispatch'), async (_req, res) => {
    const coordinators = await query(`SELECT jc.id,jc.user_id userId,u.name userName,jc.department_id departmentId,
        d.name departmentName,jc.receive_all_client_jobs receiveAllClientJobs,jc.priority_order priorityOrder,
        jc.is_active isActive,jc.created_at createdAt,jc.updated_at updatedAt
      FROM job_coordinators jc
      JOIN users u ON u.id=jc.user_id
      LEFT JOIN departments d ON d.id=jc.department_id
      ORDER BY jc.is_active DESC,jc.priority_order,u.name`);
    res.json({ coordinators: coordinators.map(row => ({ ...row, id: String(row.id), isActive: Boolean(row.isActive), receiveAllClientJobs: Boolean(row.receiveAllClientJobs) })) });
});
app.post('/api/job-coordinators', requireAuth, requirePermission('jobs.dispatch.manage_coordinators'), requireModuleAccess('dispatch'), async (req, res) => {
    const parsed = z.object({
        userId: z.string().trim().min(1),
        departmentId: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
        receiveAllClientJobs: z.boolean().optional().default(true),
        priorityOrder: z.coerce.number().int().min(1).max(999).optional().default(100),
        isActive: z.boolean().optional().default(true)
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const userRow = await one(`${internalAssignableUserSelect} AND u.id=?`, [parsed.data.userId]);
    if (!userRow)
        return res.status(400).json({ error: 'Active internal coordinator user not found' });
    const departmentId = parsed.data.departmentId === undefined || parsed.data.departmentId === null || parsed.data.departmentId === ''
        ? null
        : optionalId(parsed.data.departmentId);
    if (Number.isNaN(departmentId))
        return res.status(400).json({ error: 'Department is invalid' });
    if (departmentId && !(await one("SELECT id FROM departments WHERE id=? AND status='active'", [departmentId])))
        return res.status(400).json({ error: 'Active department not found' });
    const existing = await one('SELECT id FROM job_coordinators WHERE user_id=? AND (department_id <=> ?) LIMIT 1', [parsed.data.userId, departmentId]);
    if (existing)
        return res.status(409).json({ error: 'Coordinator already exists for this scope' });
    const result = await query(`INSERT INTO job_coordinators
      (user_id,department_id,receive_all_client_jobs,priority_order,is_active,created_by_user_id)
      VALUES (?,?,?,?,?,?)`, [parsed.data.userId, departmentId, parsed.data.receiveAllClientJobs ? 1 : 0, parsed.data.priorityOrder, parsed.data.isActive ? 1 : 0, req.user.id]);
    const coordinatorPermissions = ['jobs.dispatch.view', 'jobs.dispatch.assign', 'jobs.dispatch.reassign', 'jobs.dispatch.claim', 'notifications.view', 'profile.view'];
    for (const permissionId of coordinatorPermissions) {
        await query(
            "INSERT INTO user_permission_overrides (user_id,permission_id,effect,created_by) VALUES (?,?, 'grant', ?) ON DUPLICATE KEY UPDATE effect='grant',created_by=VALUES(created_by)",
            [parsed.data.userId, permissionId, req.user.id]
        );
    }
    await audit(req.user.id, 'job_coordinator_created', 'job_coordinator', String(result.insertId), parsed.data);
    emitPermissionsUpdated();
    res.status(201).json({ id: String(result.insertId) });
});
app.patch('/api/job-coordinators/:id', requireAuth, requirePermission('jobs.dispatch.manage_coordinators'), requireModuleAccess('dispatch'), async (req, res) => {
    const parsed = z.object({
        receiveAllClientJobs: z.boolean().optional(),
        priorityOrder: z.coerce.number().int().min(1).max(999).optional(),
        isActive: z.boolean().optional()
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const sets = [];
    const params = [];
    if (parsed.data.receiveAllClientJobs !== undefined) {
        sets.push('receive_all_client_jobs=?');
        params.push(parsed.data.receiveAllClientJobs ? 1 : 0);
    }
    if (parsed.data.priorityOrder !== undefined) {
        sets.push('priority_order=?');
        params.push(parsed.data.priorityOrder);
    }
    if (parsed.data.isActive !== undefined) {
        sets.push('is_active=?');
        params.push(parsed.data.isActive ? 1 : 0);
    }
    if (!sets.length)
        return res.json({ ok: true });
    params.push(req.params.id);
    await query(`UPDATE job_coordinators SET ${sets.join(',')} WHERE id=?`, params);
    await audit(req.user.id, 'job_coordinator_updated', 'job_coordinator', req.params.id, parsed.data);
    emitPermissionsUpdated();
    res.json({ ok: true });
});
app.get('/api/jobs', requireAuth, requirePermission('jobs.view_own', 'jobs.view_all', 'jobs.view_department'), requireModuleAccess('jobs'), async (req, res) => {
    const schema = z.object({
        search: z.string().trim().optional().default(''),
        clientId: z.string().trim().optional().default(''),
        assignedToUserId: z.string().trim().optional().default(''),
        departmentId: z.string().trim().optional().default(''),
        category: z.string().trim().optional().default(''),
        priority: z.string().trim().optional().default(''),
        status: z.string().trim().optional().default(''),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
        sort: z.enum(['newest', 'oldest', 'updated']).optional().default('newest')
    }).safeParse(req.query);
    if (!schema.success)
        return res.status(400).json({ error: schema.error.issues[0].message });
    const filters = schema.data;
    const includeInternalJobFields = req.user.accountType !== 'client';
    let jobs = (await loadVisibleJobs(req.user)).map(row => mapJob(row, includeInternalJobFields));
    if (filters.search) {
        const needle = filters.search.toLowerCase();
        jobs = jobs.filter(job => [job.id, job.title, job.description, job.postedBy].some(value => String(value || '').toLowerCase().includes(needle)));
    }
    if (filters.clientId)
        jobs = jobs.filter(job => job.clientId === filters.clientId);
    if (filters.assignedToUserId)
        jobs = jobs.filter(job => job.assignedToUserId === filters.assignedToUserId);
    if (filters.departmentId)
        jobs = jobs.filter(job => String(job.departmentId || '') === filters.departmentId);
    if (filters.category)
        jobs = jobs.filter(job => job.category === filters.category);
    if (filters.priority)
        jobs = jobs.filter(job => job.priority === filters.priority);
    if (filters.status)
        jobs = jobs.filter(job => job.status === filters.status);
    const sortDate = job => new Date(filters.sort === 'updated' ? job.updatedAt : job.datePosted).getTime() || 0;
    jobs.sort((a, b) => filters.sort === 'oldest' ? sortDate(a) - sortDate(b) : sortDate(b) - sortDate(a));
    const total = jobs.length;
    const start = (filters.page - 1) * filters.pageSize;
    res.json({
        jobs: jobs.slice(start, start + filters.pageSize),
        pagination: { total, page: filters.page, pageSize: filters.pageSize, pages: Math.max(1, Math.ceil(total / filters.pageSize)) }
    });
});
app.get('/api/jobs/:id', requireAuth, requirePermission('jobs.view_own', 'jobs.view_all', 'jobs.view_department'), requireModuleAccess('jobs'), async (req, res) => {
    const row = await one(`${jobSelect} WHERE j.id=?`, [req.params.id]);
    if (!row)
        return res.status(404).json({ error: 'Job not found' });
    if (!canAccessJob(req.user, row))
        return res.status(403).json({ error: 'Job access denied' });
    const includeInternalJobFields = req.user.accountType !== 'client';
    const job = mapJob(row, includeInternalJobFields);
    const assignmentHistory = includeInternalJobFields
        ? await query(`SELECT ja.id,ja.job_id jobId,ja.previous_assignee_user_id previousAssigneeUserId,
            previous_user.name previousAssigneeName,
            ja.assigned_to_user_id assignedToUserId,
            assigned_user.name assignedToName,
            ja.assigned_by_user_id assignedByUserId,
            assigned_by.name assignedByName,
            ja.previous_department_id previousDepartmentId,
            previous_department.name previousDepartmentName,
            ja.department_id departmentId,
            department.name departmentName,
            ja.note,ja.created_at createdAt
          FROM job_assignments ja
          LEFT JOIN users previous_user ON previous_user.id=ja.previous_assignee_user_id
          LEFT JOIN users assigned_user ON assigned_user.id=ja.assigned_to_user_id
          LEFT JOIN users assigned_by ON assigned_by.id=ja.assigned_by_user_id
          LEFT JOIN departments previous_department ON previous_department.id=ja.previous_department_id
          LEFT JOIN departments department ON department.id=ja.department_id
          WHERE ja.job_id=?
          ORDER BY ja.created_at DESC,ja.id DESC`, [req.params.id])
        : [];
    const events = await loadJobEvents(req.params.id, includeInternalJobFields);
    res.json({ job, assignmentHistory, events });
});
app.post('/api/jobs', requireAuth, requirePermission('jobs.create'), requireModuleAccess('submit'), async (req, res) => {
    const schema = z.object({
        clientId: z.string().optional(),
        title: z.string().min(2),
        description: z.string().default(''),
        category: z.string().min(1),
        priority: z.enum(['Low', 'Medium', 'High', 'Urgent']),
        postedBy: z.string().min(2),
        assetLink: z.string().default(''),
        assignedToUserId: z.string().trim().optional().or(z.literal('')),
        preferredAssigneeUserId: z.string().trim().optional().or(z.literal('')),
        departmentId: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
        assignmentNote: z.string().trim().max(1000).optional().or(z.literal('')),
        desiredDeliveryAt: z.string().trim().optional().or(z.literal('')),
        referenceLinks: z.union([z.array(z.string()), z.string()]).optional(),
        specialInstructions: z.string().trim().max(5000).optional().or(z.literal(''))
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const user = req.user;
    const clientId = user.accountType === 'client' ? user.clientId : parsed.data.clientId;
    if (!clientId)
        return res.status(400).json({ error: 'Client is required' });
    if (!(await canUseClientForJob(user, clientId)))
        return res.status(403).json({ error: 'You are not allowed to create jobs for this client' });
    const isClientSubmission = user.accountType === 'client';
    const assignmentFields = ['assignedToUserId', 'departmentId', 'assignmentNote'];
    const assignmentRequested = assignmentFields.some(key => parsed.data[key] !== undefined);
    if (!isClientSubmission && assignmentRequested && !canAssignJobs(user))
        return res.status(403).json({ error: 'Job assignment permission required' });
    const assignedToUserId = isClientSubmission ? null : parsed.data.assignedToUserId || null;
    const requestedDepartmentId = parsed.data.departmentId === undefined ? null : optionalId(parsed.data.departmentId);
    if (Number.isNaN(requestedDepartmentId))
        return res.status(400).json({ error: 'Department is invalid' });
    if (isClientSubmission && !requestedDepartmentId)
        return res.status(400).json({ error: 'Department is required for client jobs' });
    const assigneeValidation = isClientSubmission ? { assignee: null } : await validateAssigneeForUser(user, assignedToUserId);
    if (assigneeValidation.error)
        return res.status(assigneeValidation.status).json({ error: assigneeValidation.error });
    const departmentId = requestedDepartmentId || assigneeValidation.assignee?.departmentId || null;
    const departmentValidation = await validateDepartmentForUser(user, departmentId);
    if (departmentValidation.error)
        return res.status(departmentValidation.status).json({ error: departmentValidation.error });
    const assignmentSettings = await readAssignmentSettings();
    const preferredAssigneeUserId = isClientSubmission && assignmentSettings.allowClientPreferredEmployee
        ? parsed.data.preferredAssigneeUserId || parsed.data.assignedToUserId || null
        : null;
    const preferredValidation = isClientSubmission
        ? await validateClientPreferredAssignee({ preferredAssigneeUserId, departmentId: departmentValidation.departmentId, category: parsed.data.category })
        : { assignee: null };
    if (preferredValidation.error)
        return res.status(preferredValidation.status).json({ error: preferredValidation.error });
    const assignmentNote = !isClientSubmission && assignmentRequested ? (parsed.data.assignmentNote || '') : null;
    const assignmentActivity = !isClientSubmission && assignmentRequested && Boolean(assignedToUserId || departmentValidation.departmentId || assignmentNote);
    const id = 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const now = isoNow();
    const acceptanceDeadlineAt = isClientSubmission ? addMinutesIso(assignmentSettings.acceptanceMinutes) : null;
    const referenceLinks = normalizeReferenceLinks(parsed.data.referenceLinks !== undefined ? parsed.data.referenceLinks : parsed.data.assetLink);
    const assignmentState = isClientSubmission
        ? (preferredAssigneeUserId ? 'pending_acceptance' : 'needs_assignment')
        : assignedToUserId ? 'assigned' : departmentValidation.departmentId ? 'unassigned' : 'unassigned';
    const status = isClientSubmission
        ? (preferredAssigneeUserId ? 'pending_acceptance' : 'needs_assignment')
        : assignedToUserId ? 'assigned' : 'submitted';
    const calculatedHours = calculateHours(await settings(), await categoryLoad(), parsed.data.category, parsed.data.priority);
    await transaction(async connection => {
        await query(`INSERT INTO jobs
            (id,client_id,title,description,category,priority,posted_by,created_by_user_id,
              assigned_to_user_id,assigned_by_user_id,preferred_assignee_user_id,department_id,assignment_date,assignment_note,
              asset_link,calculated_hours,team_override_hours,team_override_note,status,assignment_state,date_posted,submitted_at,
              acceptance_deadline_at,accepted_at,assignment_method,assignment_source_user_id,desired_delivery_at,reference_links,special_instructions,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
                id,
                clientId,
                parsed.data.title,
                parsed.data.description,
                parsed.data.category,
                parsed.data.priority,
                parsed.data.postedBy,
                user.id,
                assignedToUserId,
                assignmentActivity ? user.id : null,
                preferredAssigneeUserId,
                departmentValidation.departmentId,
                assignmentActivity ? now : null,
                assignmentNote,
                parsed.data.assetLink,
                calculatedHours,
                null,
                '',
                status,
                assignmentState,
                now,
                now,
                acceptanceDeadlineAt,
                assignedToUserId ? now : null,
                assignedToUserId ? 'direct' : (preferredAssigneeUserId ? 'client_preference' : null),
                user.id,
                parsed.data.desiredDeliveryAt || null,
                JSON.stringify(referenceLinks),
                parsed.data.specialInstructions || '',
                now
            ],
            connection);
        if (assignmentActivity) {
            await query(`INSERT INTO job_assignments
                (job_id,previous_assignee_user_id,assigned_to_user_id,assigned_by_user_id,previous_department_id,department_id,note,created_at)
                VALUES (?,?,?,?,?,?,?,?)`,
                [id, null, assignedToUserId, user.id, null, departmentValidation.departmentId, assignmentNote || '', new Date()],
                connection);
        }
        if (preferredAssigneeUserId) {
            await createAssignmentOffer({
                jobId: id,
                offeredToUserId: preferredAssigneeUserId,
                offeredByUserId: user.id,
                offerType: 'client_preferred',
                expiresAt: acceptanceDeadlineAt
            }, connection);
            await notifyUser(preferredAssigneeUserId, {
                title: 'New job assignment request',
                body: `${parsed.data.title} was requested by ${parsed.data.postedBy}.`,
                type: 'assignment_request',
                jobId: id
            }, connection);
        }
        if (isClientSubmission) {
            const jobForNotify = { id, department_id: departmentValidation.departmentId, client_id: clientId, title: parsed.data.title };
            await notifyDepartmentUsers(departmentValidation.departmentId, {
                title: 'New client job',
                body: `${parsed.data.title} is waiting in your department queue.`,
                type: 'client_job_submitted',
                jobId: id
            }, connection);
            await notifyCoordinatorsForJob(jobForNotify, {
                title: 'New job in dispatch queue',
                body: `${parsed.data.title} needs dispatch review.`,
                type: 'dispatch_queue',
                jobId: id
            }, connection);
            await notifyClientUsers(clientId, {
                title: preferredAssigneeUserId ? 'Job submitted for acceptance' : 'Job submitted for dispatch',
                body: preferredAssigneeUserId
                    ? 'Your preferred employee request has been sent for acceptance.'
                    : 'Your job has been sent to the dispatch team.',
                type: 'job_submitted',
                jobId: id
            }, connection);
        }
        await createJobEvent({
            jobId: id,
            eventType: 'job_submitted',
            actorUserId: user.id,
            visibility: 'client',
            title: 'Job submitted',
            body: isClientSubmission ? 'The job request has been received.' : 'The job was created internally.',
            metadata: { departmentId: departmentValidation.departmentId, preferredAssigneeUserId }
        }, connection);
        await audit(user.id, 'create', 'job', id, parsed.data, connection);
    });
    emitRefresh();
    res.status(201).json({ job: mapJob(await one(`${jobSelect} WHERE j.id=?`, [id]), user.accountType !== 'client') });
});
app.patch('/api/jobs/:id', requireAuth, requirePermission('jobs.edit', 'jobs.update_status', 'jobs.override_tat', 'jobs.assign', 'jobs.reassign'), requireModuleAccess('jobs'), async (req, res) => {
    const schema = z.object({
        title: z.string().min(2).optional(),
        description: z.string().optional(),
        category: z.string().optional(),
        priority: z.enum(['Low', 'Medium', 'High', 'Urgent']).optional(),
        status: z.enum(['submitted', 'pending_acceptance', 'needs_assignment', 'assigned', 'under_review', 'in_progress', 'waiting_client', 'revision_requested', 'review', 'on_hold', 'completed', 'cancelled']).optional(),
        assetLink: z.string().optional(),
        teamOverrideHours: z.number().positive().nullable().optional(),
        teamOverrideNote: z.string().optional(),
        assignedToUserId: z.string().trim().optional().or(z.literal('')),
        departmentId: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
        assignmentNote: z.string().trim().max(1000).optional().or(z.literal(''))
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const current = await one(`${jobSelect} WHERE j.id=?`, [req.params.id]);
    if (!current)
        return res.status(404).json({ error: 'Job not found' });
    if (!canAccessJob(req.user, current))
        return res.status(403).json({ error: 'Job access denied' });
    const editRequested = ['title', 'description', 'category', 'priority', 'assetLink'].some(key => parsed.data[key] !== undefined);
    if (editRequested && !hasPermission(req.user, 'jobs.edit'))
        return res.status(403).json({ error: 'Job edit permission required' });
    if (parsed.data.status !== undefined && !hasAnyPermission(req.user, ['jobs.update_status', 'jobs.edit']))
        return res.status(403).json({ error: 'Job status permission required' });
    const tatRequested = parsed.data.teamOverrideHours !== undefined || parsed.data.teamOverrideNote !== undefined;
    if (tatRequested && !hasPermission(req.user, 'jobs.override_tat'))
        return res.status(403).json({ error: 'Job TAT override permission required' });
    const assignmentFields = ['assignedToUserId', 'departmentId', 'assignmentNote'];
    const assignmentRequested = assignmentFields.some(key => parsed.data[key] !== undefined);
    if (assignmentRequested) {
        const assigneeChanged = parsed.data.assignedToUserId !== undefined && (parsed.data.assignedToUserId || null) !== current.assigned_to_user_id;
        if (assigneeChanged && current.assigned_to_user_id && !hasPermission(req.user, 'jobs.reassign'))
            return res.status(403).json({ error: 'Job reassignment permission required' });
        if (!hasAnyPermission(req.user, ['jobs.assign', 'jobs.reassign']))
            return res.status(403).json({ error: 'Job assignment permission required' });
    }
    const assignedToUserId = parsed.data.assignedToUserId === undefined ? current.assigned_to_user_id : (parsed.data.assignedToUserId || null);
    const departmentId = parsed.data.departmentId === undefined ? current.department_id : optionalId(parsed.data.departmentId);
    const assignmentChanged = assignmentRequested
        && ((assignedToUserId || null) !== (current.assigned_to_user_id || null)
            || Number(departmentId || 0) !== Number(current.department_id || 0)
            || parsed.data.assignmentNote !== undefined);
    if (Number.isNaN(departmentId))
        return res.status(400).json({ error: 'Department is invalid' });
    const assigneeValidation = await validateAssigneeForUser(req.user, assignedToUserId);
    if (assigneeValidation.error)
        return res.status(assigneeValidation.status).json({ error: assigneeValidation.error });
    const departmentValidation = await validateDepartmentForUser(req.user, departmentId);
    if (departmentValidation.error)
        return res.status(departmentValidation.status).json({ error: departmentValidation.error });
    const normalizedData = { ...parsed.data };
    if (parsed.data.assignedToUserId !== undefined)
        normalizedData.assignedToUserId = assignedToUserId;
    if (parsed.data.departmentId !== undefined)
        normalizedData.departmentId = departmentValidation.departmentId;
    const map = { title: 'title', description: 'description', category: 'category', priority: 'priority', status: 'status', assetLink: 'asset_link', teamOverrideHours: 'team_override_hours', teamOverrideNote: 'team_override_note', assignedToUserId: 'assigned_to_user_id', departmentId: 'department_id', assignmentNote: 'assignment_note' };
    const entries = Object.entries(normalizedData);
    if (!entries.length)
        return res.status(400).json({ error: 'No changes supplied' });
    const sets = entries.map(([key]) => `${map[key]}=?`);
    const values = entries.map(([, value]) => value);
    const now = new Date().toISOString();
    sets.push('updated_at=?');
    values.push(now);
    if (parsed.data.status === 'completed') {
        sets.push('date_completed=?');
        values.push(now);
    }
    if (parsed.data.status && parsed.data.status !== 'completed') {
        sets.push('date_completed=NULL');
    }
    if (assignmentRequested) {
        sets.push('assigned_by_user_id=?', 'assignment_date=?');
        values.push(req.user.id, now);
        if (assignedToUserId) {
            sets.push("assignment_state='assigned'", "status=IF(status IN ('submitted','pending_acceptance','needs_assignment'), 'assigned', status)", 'accepted_at=?', "assignment_method='direct'", 'assignment_source_user_id=?');
            values.push(now, req.user.id);
        }
    }
    await transaction(async connection => {
        await query(`UPDATE jobs SET ${sets.join(',')} WHERE id=?`, [...values, req.params.id], connection);
        if (assignmentChanged) {
            await query(`INSERT INTO job_assignments
                (job_id,previous_assignee_user_id,assigned_to_user_id,assigned_by_user_id,previous_department_id,department_id,note,created_at)
                VALUES (?,?,?,?,?,?,?,?)`,
                [
                    req.params.id,
                    current.assigned_to_user_id || null,
                    assignedToUserId || null,
                    req.user.id,
                    current.department_id || null,
                    departmentValidation.departmentId || null,
                    parsed.data.assignmentNote || '',
                    new Date()
                ],
                connection
            );
            if (assignedToUserId)
                await query("UPDATE job_assignment_offers SET status='cancelled' WHERE job_id=? AND status='pending' AND offered_to_user_id<>?", [req.params.id, assignedToUserId], connection);
            await createJobEvent({
                jobId: req.params.id,
                eventType: 'job_updated',
                actorUserId: req.user.id,
                visibility: assignmentChanged ? 'client' : 'internal',
                title: assignmentChanged && assignedToUserId ? 'Job assigned' : 'Job updated',
                body: assignmentChanged && assigneeValidation.assignee ? `${assigneeValidation.assignee.name} has been assigned to this job.` : 'The job details were updated.'
            }, connection);
        }
        await audit(req.user.id, 'update', 'job', req.params.id, parsed.data, connection);
    });
    emitRefresh();
    res.json({ job: mapJob(await one(`${jobSelect} WHERE j.id=?`, [req.params.id]), req.user.accountType !== 'client') });
});
app.put('/api/settings', requireAuth, requirePermission('settings.edit'), requireModuleAccess('settings', 'app_settings'), async (req, res) => {
    const schema = z.object({
        categories: z.array(z.object({ name: z.string().min(1), baseHours: z.number().positive() })).min(1),
        capacityPerCategory: z.number().int().positive(),
        bufferHoursPerExtraJob: z.number().nonnegative(),
        startHour: z.number().min(0).max(24),
        endHour: z.number().min(0).max(24),
        workDays: z.array(z.number().int().min(0).max(6)).min(1),
        assignmentAcceptanceMinutes: z.coerce.number().int().positive().optional(),
        assignmentReminderMinutes: z.coerce.number().int().positive().optional(),
        enableAutoAssignment: z.boolean().optional(),
        skipOverworked: z.boolean().optional(),
        maxAutoAssignmentUtilization: z.coerce.number().int().positive().optional(),
        allowDepartmentClaim: z.boolean().optional(),
        allowClientPreferredEmployee: z.boolean().optional()
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const currentSettings = await settings();
    const nextSettings = { ...currentSettings, ...parsed.data };
    await query('UPDATE settings SET json=? WHERE id=1', [JSON.stringify(nextSettings)]);
    await audit(req.user.id, 'update', 'settings', '1', parsed.data);
    emitRefresh();
    res.json({ settings: nextSettings });
});
app.post('/api/clients', requireAuth, requirePermission('clients.create'), requireModuleAccess('clients'), async (req, res) => {
    const parsed = z.object({ id: z.string().regex(/^[a-z0-9_-]+$/), name: z.string().min(2), password: z.string().min(6) }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    if (await one('SELECT id FROM clients WHERE id=?', [parsed.data.id]))
        return res.status(409).json({ error: 'Client ID already exists' });
    if (await one('SELECT id FROM users WHERE id=?', [parsed.data.id]))
        return res.status(409).json({ error: 'A user with this Client ID already exists' });
    const hash = await bcrypt.hash(parsed.data.password, 12);
    await transaction(async connection => {
        await query('INSERT INTO clients (id,name,password_hash,created_by,account_owner_user_id) VALUES (?,?,?,?,?)', [parsed.data.id, parsed.data.name, hash, req.user.id, req.user.id], connection);
        await query("INSERT INTO users (id,name,password_hash,role,account_type,role_id,client_id,created_by) VALUES (?,?,?,'client','client','client',?,?)", [parsed.data.id, parsed.data.name, hash, parsed.data.id, req.user.id], connection);
    });
    await audit(req.user.id, 'create', 'client', parsed.data.id, { name: parsed.data.name });
    emitRefresh();
    res.status(201).json({ ok: true });
});
app.patch('/api/clients/:id', requireAuth, requirePermission('clients.edit'), requireModuleAccess('clients'), async (req, res) => {
    const parsed = z.object({ name: z.string().min(2).optional(), password: z.string().min(6).optional(), status: z.enum(['active', 'archived']).optional() }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const client = await one('SELECT * FROM clients WHERE id=?', [req.params.id]);
    if (!client)
        return res.status(404).json({ error: 'Client not found' });
    if (!canAccessClientRecord(req.user, client))
        return res.status(403).json({ error: 'Client access denied' });
    if (parsed.data.name) {
        await query('UPDATE clients SET name=? WHERE id=?', [parsed.data.name, req.params.id]);
        await query('UPDATE users SET name=? WHERE client_id=?', [parsed.data.name, req.params.id]);
    }
    if (parsed.data.status) {
        await query('UPDATE clients SET status=? WHERE id=?', [parsed.data.status, req.params.id]);
        await query('UPDATE users SET status=? WHERE client_id=?', [parsed.data.status === 'active' ? 'active' : 'archived', req.params.id]);
    }
    if (parsed.data.password) {
        const hash = await bcrypt.hash(parsed.data.password, 12);
        await query('UPDATE clients SET password_hash=? WHERE id=?', [hash, req.params.id]);
        await query('UPDATE users SET password_hash=? WHERE client_id=?', [hash, req.params.id]);
    }
    await audit(req.user.id, 'update', 'client', req.params.id, { ...parsed.data, password: parsed.data.password ? '[changed]' : undefined });
    emitRefresh();
    res.json({ ok: true });
});
app.delete('/api/clients/:id', requireAuth, requirePermission('clients.delete'), requireModuleAccess('clients'), async (req, res) => {
    const client = await one('SELECT * FROM clients WHERE id=?', [req.params.id]);
    if (!client)
        return res.status(404).json({ error: 'Client not found' });
    if (!canAccessClientRecord(req.user, client))
        return res.status(403).json({ error: 'Client access denied' });
    const jobs = await one('SELECT COUNT(*) AS count FROM jobs WHERE client_id=?', [req.params.id]);
    if (Number(jobs.count) > 0)
        return res.status(409).json({ error: 'This client has job history. Archive the client instead, or remove/reassign jobs before deleting.' });
    await transaction(async connection => {
        const tickets = await query('SELECT ticket_number FROM support_tickets WHERE client_id=? OR user_id IN (SELECT id FROM users WHERE client_id=?)', [req.params.id, req.params.id], connection);
        await query('DELETE FROM support_tickets WHERE client_id=? OR user_id IN (SELECT id FROM users WHERE client_id=?)', [req.params.id, req.params.id], connection);
        await query('DELETE FROM users WHERE client_id=?', [req.params.id], connection);
        await query('DELETE FROM clients WHERE id=?', [req.params.id], connection);
        await audit(req.user.id, 'delete', 'client', req.params.id, { name: client.name, removedTickets: tickets.length }, connection);
    });
    emitRefresh();
    res.json({ ok: true });
});
app.post('/api/support-tickets', requireAuth, requirePermission('support.create'), requireModuleAccess('support'), async (req, res) => {
    const schema = z.object({
        subject: z.string().trim().min(3),
        category: z.enum(ticketCategories),
        priority: z.enum(ticketPriorities),
        description: z.string().trim().min(3),
        attachment: attachmentSchema
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    let attachment = null;
    try {
        attachment = prepareAttachment(parsed.data.attachment);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
    const user = req.user;
    const now = new Date().toISOString();
    const ticketNumber = await transaction(async connection => {
        const ticketInfo = await query(`INSERT INTO support_tickets (ticket_number,user_id,user_name,client_id,subject,category,priority,status,created_at,updated_at) VALUES (NULL,?,?,?,?,?,?,?,?,?)`,
            [user.id, user.name, user.clientId, parsed.data.subject, parsed.data.category, parsed.data.priority, 'Open', now, now], connection);
        const ticketId = Number(ticketInfo.insertId);
        const number = ticketNumberFor(ticketId);
        await query('UPDATE support_tickets SET ticket_number=? WHERE id=?', [number, ticketId], connection);
        const messageInfo = await query('INSERT INTO support_ticket_messages (ticket_id,author_id,author_name,author_role,body,created_at) VALUES (?,?,?,?,?,?)',
            [ticketId, user.id, user.name, user.accountType, parsed.data.description, now], connection);
        if (attachment) {
            await query('INSERT INTO support_ticket_attachments (ticket_id,message_id,file_name,mime_type,size_bytes,data_base64,created_at) VALUES (?,?,?,?,?,?,?)',
                [ticketId, Number(messageInfo.insertId), attachment.fileName, attachment.mimeType, attachment.sizeBytes, attachment.dataBase64, now], connection);
        }
        await audit(user.id, 'create', 'support_ticket', number,
            { subject: parsed.data.subject, category: parsed.data.category, priority: parsed.data.priority, attachment: attachment?.fileName }, connection);
        return number;
    });
    emitRefresh();
    res.status(201).json({ ticket: mapTicket(await getTicketRow(ticketNumber)) });
});
app.post('/api/support-tickets/bulk-delete', requireAuth, requirePermission('support.view_own', 'support.manage'), requireModuleAccess('support'), async (req, res) => {
    const parsed = z.object({ ticketNumbers: z.array(z.string().min(1)).min(1).max(100) }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const ticketNumbers = [...new Set(parsed.data.ticketNumbers)];
    const placeholders = ticketNumbers.map(() => '?').join(',');
    const rows = await query(`SELECT id,ticket_number,user_id FROM support_tickets WHERE ticket_number IN (${placeholders})`, ticketNumbers);
    const accessible = rows.filter(ticket => canAccessTicket(req.user, ticket));
    if (!accessible.length)
        return res.status(404).json({ error: 'No accessible tickets found' });
    await transaction(async connection => {
        const ids = accessible.map(ticket => ticket.id);
        await query(`DELETE FROM support_tickets WHERE id IN (${ids.map(() => '?').join(',')})`, ids, connection);
        for (const ticket of accessible)
            await audit(req.user.id, 'delete', 'support_ticket', ticket.ticket_number, { bulk: true }, connection);
    });
    emitRefresh();
    res.json({ ok: true, deleted: accessible.length });
});
app.get('/api/support-tickets/:ticketNumber', requireAuth, requirePermission('support.view_own', 'support.view_all'), requireModuleAccess('support'), async (req, res) => {
    const ticket = await getTicketRow(req.params.ticketNumber);
    if (!ticket)
        return res.status(404).json({ error: 'Ticket not found' });
    if (!canAccessTicket(req.user, ticket))
        return res.status(403).json({ error: 'Ticket access denied' });
    res.json({ ticket: await ticketDetail(ticket) });
});
app.delete('/api/support-tickets/:ticketNumber/messages', requireAuth, requirePermission('support.manage'), requireModuleAccess('support'), async (req, res) => {
    const ticket = await getTicketRow(req.params.ticketNumber);
    if (!ticket)
        return res.status(404).json({ error: 'Ticket not found' });
    if (!canAccessTicket(req.user, ticket))
        return res.status(403).json({ error: 'Ticket access denied' });
    const now = new Date().toISOString();
    await transaction(async connection => {
        await query('DELETE FROM support_ticket_attachments WHERE ticket_id=?', [ticket.id], connection);
        await query('DELETE FROM support_ticket_messages WHERE ticket_id=?', [ticket.id], connection);
        await query('UPDATE support_tickets SET updated_at=? WHERE id=?', [now, ticket.id], connection);
        await audit(req.user.id, 'clear', 'support_ticket', ticket.ticket_number, {}, connection);
    });
    emitRefresh();
    res.json({ ticket: await ticketDetail(await getTicketRow(ticket.ticket_number)) });
});
app.post('/api/support-tickets/:ticketNumber/replies', requireAuth, requirePermission('support.reply'), requireModuleAccess('support'), async (req, res) => {
    const parsed = z.object({ body: z.string().trim().min(1).max(5000) }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const ticket = await getTicketRow(req.params.ticketNumber);
    if (!ticket)
        return res.status(404).json({ error: 'Ticket not found' });
    if (!canAccessTicket(req.user, ticket))
        return res.status(403).json({ error: 'Ticket access denied' });
    if (ticket.status === 'Closed')
        return res.status(400).json({ error: 'This ticket has been closed.' });
    const user = req.user;
    const now = new Date().toISOString();
    const nextStatus = canManageSupport(user)
        ? (ticket.status === 'Open' ? 'In Progress' : ticket.status)
        : (ticket.status === 'Waiting for User' || ticket.status === 'Resolved' ? 'Open' : ticket.status);
    await transaction(async connection => {
        await query('INSERT INTO support_ticket_messages (ticket_id,author_id,author_name,author_role,body,created_at) VALUES (?,?,?,?,?,?)',
            [ticket.id, user.id, user.name, user.accountType, parsed.data.body, now], connection);
        await query('UPDATE support_tickets SET status=?,updated_at=? WHERE id=?', [nextStatus, now, ticket.id], connection);
        await audit(user.id, 'reply', 'support_ticket', ticket.ticket_number, { status: nextStatus }, connection);
    });
    emitRefresh();
    res.status(201).json({ ticket: await ticketDetail(await getTicketRow(ticket.ticket_number)) });
});
app.patch('/api/support-tickets/:ticketNumber', requireAuth, requirePermission('support.manage'), requireModuleAccess('support'), async (req, res) => {
    const parsed = z.object({ status: z.enum(ticketStatuses).optional(), priority: z.enum(ticketPriorities).optional() }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const entries = Object.entries(parsed.data);
    if (!entries.length)
        return res.status(400).json({ error: 'No changes supplied' });
    const ticket = await getTicketRow(req.params.ticketNumber);
    if (!ticket)
        return res.status(404).json({ error: 'Ticket not found' });
    const sets = [];
    const values = [];
    if (parsed.data.status) {
        sets.push('status=?');
        values.push(parsed.data.status);
        sets.push('closed_at=?');
        values.push(parsed.data.status === 'Closed' ? new Date().toISOString() : null);
    }
    if (parsed.data.priority) {
        sets.push('priority=?');
        values.push(parsed.data.priority);
    }
    sets.push('updated_at=?');
    values.push(new Date().toISOString());
    await query(`UPDATE support_tickets SET ${sets.join(',')} WHERE id=?`, [...values, ticket.id]);
    await audit(req.user.id, 'update', 'support_ticket', ticket.ticket_number, parsed.data);
    emitRefresh();
    res.json({ ticket: await ticketDetail(await getTicketRow(ticket.ticket_number)) });
});
app.delete('/api/support-tickets/:ticketNumber', requireAuth, requirePermission('support.view_own', 'support.manage'), requireModuleAccess('support'), async (req, res) => {
    const ticket = await getTicketRow(req.params.ticketNumber);
    if (!ticket)
        return res.status(404).json({ error: 'Ticket not found' });
    if (!canAccessTicket(req.user, ticket))
        return res.status(403).json({ error: 'Ticket access denied' });
    await transaction(async connection => {
        await query('DELETE FROM support_tickets WHERE id=?', [ticket.id], connection);
        await audit(req.user.id, 'delete', 'support_ticket', ticket.ticket_number, {}, connection);
    });
    emitRefresh();
    res.json({ ok: true });
});
app.get('/api/support-tickets/:ticketNumber/attachments/:attachmentId', requireAuth, requirePermission('support.view_own', 'support.view_all'), requireModuleAccess('support'), async (req, res) => {
    const row = await one(`SELECT a.*,t.ticket_number,t.user_id FROM support_ticket_attachments a JOIN support_tickets t ON t.id=a.ticket_id WHERE t.ticket_number=? AND a.id=?`,
        [req.params.ticketNumber, req.params.attachmentId]);
    if (!row)
        return res.status(404).json({ error: 'Attachment not found' });
    if (!canAccessTicket(req.user, row))
        return res.status(403).json({ error: 'Attachment access denied' });
    const bytes = Buffer.from(row.data_base64, 'base64');
    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Content-Disposition', `attachment; filename="${String(row.file_name).replace(/"/g, '')}"`);
    res.send(bytes);
});

app.get('/api/users', requireAuth, requirePermission('users.view', 'employees.view'), requireModuleAccess('users', 'employees'), async (req, res) => {
    const scopeWhere = hasPermission(req.user, 'users.view') ? '' : "WHERE COALESCE(u.account_type,u.role)<>'client'";
    const rows = await query(`SELECT u.id,u.name,u.email,u.phone,u.account_type accountType,u.role_id roleId,u.client_id clientId,
        u.department_id departmentId,u.designation_id designationId,u.manager_user_id managerUserId,
        u.status,u.created_at createdAt,u.created_by createdBy,u.last_login lastLogin,
        r.name roleName,r.level roleLevel,d.name departmentName,ds.name designationName,ds.hierarchy_level designationLevel,m.name managerName,c.name clientName,
        ep.employee_id employeeId,ep.joining_date joiningDate
      FROM users u
      LEFT JOIN roles r ON r.id=u.role_id
      LEFT JOIN departments d ON d.id=u.department_id
      LEFT JOIN designations ds ON ds.id=u.designation_id
      LEFT JOIN users m ON m.id=u.manager_user_id
      LEFT JOIN clients c ON c.id=u.client_id
      LEFT JOIN employee_profiles ep ON ep.user_id=u.id
      ${scopeWhere}
      ORDER BY FIELD(u.account_type,'super_admin','admin','employee','client'),u.name`);
    res.json({ users: rows });
});

app.post('/api/users', requireAuth, requirePermission('users.create', 'employees.create'), requireModuleAccess('users', 'employees'), async (req, res) => {
    const parsed = z.object({
        id: z.string().trim().regex(/^[a-zA-Z0-9._-]+$/),
        name: z.string().trim().min(2),
        email: z.string().trim().email().optional().or(z.literal('')),
        phone: z.string().trim().max(60).optional().or(z.literal('')),
        password: z.string().min(8),
        accountType: z.enum(['super_admin', 'admin', 'employee', 'client']),
        roleId: z.string().trim().min(1),
        status: z.enum(['active', 'archived']).optional().default('active'),
        clientId: z.string().trim().optional().or(z.literal('')),
        departmentId: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
        designationId: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
        managerUserId: z.string().trim().optional().or(z.literal('')),
        employeeId: z.string().trim().max(80).optional().or(z.literal('')),
        joiningDate: z.string().trim().optional().or(z.literal(''))
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const input = parsed.data;
    if (!hasPermission(req.user, 'users.create') && input.accountType !== 'employee')
        return res.status(403).json({ error: 'Employee managers can only create employee accounts' });
    if (input.accountType === 'super_admin' && !isSuperAdmin(req.user))
        return res.status(403).json({ error: 'Only Super Admin can create another Super Admin' });
    if (input.accountType === 'admin' && !isSuperAdmin(req.user))
        return res.status(403).json({ error: 'Only Super Admin can create Admin accounts' });
    if (await one('SELECT id FROM users WHERE id=?', [input.id]))
        return res.status(409).json({ error: 'User ID already exists' });
    if (input.email && await one('SELECT id FROM users WHERE email=?', [input.email]))
        return res.status(409).json({ error: 'Email already exists' });
    if (input.accountType !== 'client' && input.employeeId && await one('SELECT user_id FROM employee_profiles WHERE employee_id=?', [input.employeeId]))
        return res.status(409).json({ error: 'Employee ID already exists' });
    const role = await one("SELECT * FROM roles WHERE id=? AND status='active'", [input.roleId]);
    if (!role)
        return res.status(400).json({ error: 'Active role not found' });
    if (role.id === 'super_admin' && input.accountType !== 'super_admin')
        return res.status(400).json({ error: 'Super Admin role requires a Super Admin account' });
    if (input.accountType === 'super_admin' && role.id !== 'super_admin')
        return res.status(400).json({ error: 'Super Admin accounts must use the Super Admin role' });
    if (!isSuperAdmin(req.user) && Number(role.level || 0) >= 80)
        return res.status(403).json({ error: 'Only Super Admin can assign high-level admin roles' });
    if (input.accountType === 'client' && role.role_type !== 'client')
        return res.status(400).json({ error: 'Client users must use a client role' });
    if (input.accountType !== 'client' && role.role_type === 'client')
        return res.status(400).json({ error: 'Internal users cannot use a client role' });
    if (input.accountType === 'client' && !input.clientId)
        return res.status(400).json({ error: 'Client organization is required for client users' });
    if (input.clientId) {
        const client = await one("SELECT id FROM clients WHERE id=? AND status='active'", [input.clientId]);
        if (!client)
            return res.status(400).json({ error: 'Active client not found' });
    }
    const departmentId = input.accountType === 'client' ? null : optionalId(input.departmentId);
    const designationId = input.accountType === 'client' ? null : optionalId(input.designationId);
    const managerUserId = input.accountType === 'client' ? null : input.managerUserId || null;
    const orgError = await validateOrgReferences({ departmentId, designationId, managerUserId, userId: input.id });
    if (orgError)
        return res.status(400).json({ error: orgError });
    const hash = await bcrypt.hash(input.password, 12);
    await transaction(async connection => {
        await query(`INSERT INTO users
            (id,name,email,phone,password_hash,role,account_type,role_id,client_id,department_id,designation_id,manager_user_id,status,created_by,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
                input.id,
                input.name,
                input.email || null,
                input.phone || null,
                hash,
                input.accountType,
                input.accountType,
                input.roleId,
                input.accountType === 'client' ? input.clientId : null,
                departmentId,
                designationId,
                managerUserId,
                input.status,
                req.user.id,
                new Date()
            ],
            connection
        );
        if (input.accountType !== 'client') {
            await query('INSERT INTO employee_profiles (user_id,employee_id,joining_date) VALUES (?,?,?)',
                [input.id, input.employeeId || null, input.joiningDate || null], connection);
        }
        await audit(req.user.id, 'create', 'user', input.id,
            { accountType: input.accountType, roleId: input.roleId, clientId: input.clientId || null }, connection);
    });
    emitRefresh();
    res.status(201).json({ user: await loadUserContext(input.id) });
});

app.patch('/api/users/:id', requireAuth, requirePermission('users.edit', 'employees.edit'), requireModuleAccess('users', 'employees'), async (req, res) => {
    const parsed = z.object({
        name: z.string().trim().min(2).optional(),
        email: z.string().trim().email().optional().or(z.literal('')),
        phone: z.string().trim().max(60).optional().or(z.literal('')),
        roleId: z.string().trim().min(1).optional(),
        departmentId: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
        designationId: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
        managerUserId: z.string().trim().optional().or(z.literal('')),
        status: z.enum(['active', 'archived']).optional(),
        password: z.string().min(8).optional().or(z.literal(''))
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const current = await one('SELECT * FROM users WHERE id=?', [req.params.id]);
    if (!current)
        return res.status(404).json({ error: 'User not found' });
    if (current.account_type === 'super_admin' && !isSuperAdmin(req.user))
        return res.status(403).json({ error: 'Only Super Admin can modify Super Admin accounts' });
    if (parsed.data.email && parsed.data.email !== current.email && await one('SELECT id FROM users WHERE email=? AND id<>?', [parsed.data.email, current.id]))
        return res.status(409).json({ error: 'Email already exists' });
    if (current.id === req.user.id && parsed.data.status && parsed.data.status !== 'active')
        return res.status(403).json({ error: 'You cannot deactivate your own account' });
    if (current.account_type === 'super_admin' && parsed.data.status && parsed.data.status !== 'active') {
        const remaining = await one("SELECT COUNT(*) count FROM users WHERE id<>? AND status='active' AND COALESCE(account_type,role)='super_admin'", [current.id]);
        if (Number(remaining?.count || 0) === 0)
            return res.status(403).json({ error: 'At least one active Super Admin is required' });
    }
    if (parsed.data.roleId && !hasPermission(req.user, 'users.assign_role'))
        return res.status(403).json({ error: 'Role assignment permission required' });
    if (parsed.data.roleId) {
        const role = await one("SELECT * FROM roles WHERE id=? AND status='active'", [parsed.data.roleId]);
        if (!role)
            return res.status(400).json({ error: 'Active role not found' });
        if (current.id === req.user.id && role.id !== current.role_id)
            return res.status(403).json({ error: 'You cannot change your own role' });
        if (role.id === 'super_admin' && current.account_type !== 'super_admin')
            return res.status(400).json({ error: 'Super Admin role requires a Super Admin account' });
        if (current.account_type === 'super_admin' && role.id !== 'super_admin')
            return res.status(400).json({ error: 'Super Admin accounts must keep the Super Admin role' });
        if (!isSuperAdmin(req.user) && Number(role.level || 0) >= 80)
            return res.status(403).json({ error: 'Only Super Admin can assign high-level admin roles' });
        if ((current.account_type || current.role) === 'client' && role.role_type !== 'client')
            return res.status(400).json({ error: 'Client users must use a client role' });
        if ((current.account_type || current.role) !== 'client' && role.role_type === 'client')
            return res.status(400).json({ error: 'Internal users cannot use a client role' });
    }
    const departmentId = parsed.data.departmentId === undefined ? current.department_id : optionalId(parsed.data.departmentId);
    const designationId = parsed.data.designationId === undefined ? current.designation_id : optionalId(parsed.data.designationId);
    const managerUserId = parsed.data.managerUserId === undefined ? current.manager_user_id : (parsed.data.managerUserId || null);
    const orgError = await validateOrgReferences({ departmentId, designationId, managerUserId, userId: current.id });
    if (orgError)
        return res.status(400).json({ error: orgError });
    const sets = [];
    const values = [];
    const assign = (column, value) => { sets.push(`${column}=?`); values.push(value); };
    if (parsed.data.name !== undefined) assign('name', parsed.data.name);
    if (parsed.data.email !== undefined) assign('email', parsed.data.email || null);
    if (parsed.data.phone !== undefined) assign('phone', parsed.data.phone || null);
    if (parsed.data.roleId !== undefined) assign('role_id', parsed.data.roleId);
    if (parsed.data.departmentId !== undefined) assign('department_id', departmentId);
    if (parsed.data.designationId !== undefined) assign('designation_id', designationId);
    if (parsed.data.managerUserId !== undefined) assign('manager_user_id', managerUserId);
    if (parsed.data.status !== undefined) assign('status', parsed.data.status);
    if (parsed.data.password) assign('password_hash', await bcrypt.hash(parsed.data.password, 12));
    if (!sets.length)
        return res.status(400).json({ error: 'No changes supplied' });
    assign('updated_at', new Date());
    await transaction(async connection => {
        await query(`UPDATE users SET ${sets.join(',')} WHERE id=?`, [...values, current.id], connection);
        await audit(req.user.id, 'update', 'user', current.id,
            { ...parsed.data, password: parsed.data.password ? '[changed]' : undefined }, connection);
    });
    emitRefresh();
    res.json({ user: await loadUserContext(current.id) });
});

app.get('/api/users/:id/permission-overrides', requireAuth, requirePermission('roles.manage_permissions'), requireModuleAccess('users'), async (req, res) => {
    const target = await one('SELECT id,account_type,role_id FROM users WHERE id=?', [req.params.id]);
    if (!target)
        return res.status(404).json({ error: 'User not found' });
    if (target.account_type === 'super_admin' && !isSuperAdmin(req.user))
        return res.status(403).json({ error: 'Only Super Admin can view Super Admin overrides' });
    const overrides = await query('SELECT permission_id permissionId,effect FROM user_permission_overrides WHERE user_id=? ORDER BY permission_id', [target.id]);
    res.json({ overrides });
});

app.put('/api/users/:id/permission-overrides', requireAuth, requirePermission('roles.manage_permissions'), requireModuleAccess('users'), async (req, res) => {
    const parsed = z.object({
        grants: z.array(z.string().trim().min(1)).default([]),
        revokes: z.array(z.string().trim().min(1)).default([])
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const target = await one('SELECT id,account_type,role_id FROM users WHERE id=?', [req.params.id]);
    if (!target)
        return res.status(404).json({ error: 'User not found' });
    if (target.id === req.user.id)
        return res.status(403).json({ error: 'You cannot change your own permission overrides' });
    if (target.account_type === 'super_admin')
        return res.status(403).json({ error: 'Super Admin overrides are protected' });
    const grants = [...new Set(parsed.data.grants)];
    const revokes = [...new Set(parsed.data.revokes)].filter(permission => !grants.includes(permission));
    const grantValidation = await validatePermissionIds(grants, target.account_type === 'client' ? 'client' : 'internal');
    if (grantValidation.error)
        return res.status(400).json({ error: grantValidation.error });
    const revokeValidation = await validatePermissionIds(revokes, 'internal');
    if (revokeValidation.error)
        return res.status(400).json({ error: revokeValidation.error });
    await transaction(async connection => {
        await query('DELETE FROM user_permission_overrides WHERE user_id=?', [target.id], connection);
        for (const permissionId of grantValidation.permissionIds)
            await query("INSERT INTO user_permission_overrides (user_id,permission_id,effect,created_by) VALUES (?,?, 'grant', ?)", [target.id, permissionId, req.user.id], connection);
        for (const permissionId of revokeValidation.permissionIds)
            await query("INSERT INTO user_permission_overrides (user_id,permission_id,effect,created_by) VALUES (?,?, 'revoke', ?)", [target.id, permissionId, req.user.id], connection);
        await audit(req.user.id, 'update_permission_overrides', 'user', target.id,
            { grants: grantValidation.permissionIds, revokes: revokeValidation.permissionIds }, connection);
    });
    emitRefresh();
    res.json({ ok: true });
});

app.get('/api/departments', requireAuth, requirePermission('departments.manage', 'employees.view', 'employees.create', 'employees.edit', 'users.view', 'users.create', 'users.edit'), requireModuleAccess('users', 'employees'), async (_req, res) => {
    const departments = await query('SELECT id,name,code,description,status,created_by createdBy,created_at createdAt,updated_at updatedAt FROM departments ORDER BY status,name');
    res.json({ departments });
});

app.post('/api/departments', requireAuth, requirePermission('departments.manage'), requireModuleAccess('users'), async (req, res) => {
    const parsed = z.object({
        name: z.string().trim().min(2),
        code: z.string().trim().optional().or(z.literal('')),
        description: z.string().trim().optional().or(z.literal(''))
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const code = cleanCode(parsed.data.code || parsed.data.name);
    if (!code)
        return res.status(400).json({ error: 'Department code is required' });
    if (await one('SELECT id FROM departments WHERE name=? OR code=?', [parsed.data.name, code]))
        return res.status(409).json({ error: 'Department name or code already exists' });
    const info = await query('INSERT INTO departments (name,code,description,status,created_by) VALUES (?,?,?,?,?)',
        [parsed.data.name, code, parsed.data.description || '', 'active', req.user.id]);
    await audit(req.user.id, 'create', 'department', String(info.insertId), { name: parsed.data.name, code });
    emitRefresh();
    res.status(201).json({ ok: true });
});

app.patch('/api/departments/:id', requireAuth, requirePermission('departments.manage'), requireModuleAccess('users'), async (req, res) => {
    const parsed = z.object({
        name: z.string().trim().min(2).optional(),
        code: z.string().trim().optional().or(z.literal('')),
        description: z.string().trim().optional(),
        status: z.enum(entityStatus).optional()
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const department = await one('SELECT * FROM departments WHERE id=?', [req.params.id]);
    if (!department)
        return res.status(404).json({ error: 'Department not found' });
    const entries = Object.entries(parsed.data).filter(([, value]) => value !== undefined);
    if (!entries.length)
        return res.status(400).json({ error: 'No changes supplied' });
    const nextName = parsed.data.name || department.name;
    const nextCode = parsed.data.code !== undefined ? cleanCode(parsed.data.code || department.code) : department.code;
    if (await one('SELECT id FROM departments WHERE id<>? AND (name=? OR code=?)', [req.params.id, nextName, nextCode]))
        return res.status(409).json({ error: 'Department name or code already exists' });
    const sets = [];
    const values = [];
    for (const [key, value] of entries) {
        if (key === 'code') {
            sets.push('code=?');
            values.push(cleanCode(value || department.code));
        }
        else {
            sets.push(`${key}=?`);
            values.push(value);
        }
    }
    await query(`UPDATE departments SET ${sets.join(',')} WHERE id=?`, [...values, req.params.id]);
    await audit(req.user.id, 'update', 'department', req.params.id, parsed.data);
    emitRefresh();
    res.json({ ok: true });
});

app.get('/api/designations', requireAuth, requirePermission('designations.manage', 'employees.view', 'employees.create', 'employees.edit', 'users.view', 'users.create', 'users.edit'), requireModuleAccess('users', 'employees'), async (_req, res) => {
    const designations = await query('SELECT id,name,code,description,hierarchy_level hierarchyLevel,status,created_by createdBy,created_at createdAt,updated_at updatedAt FROM designations ORDER BY hierarchy_level DESC,name');
    res.json({ designations });
});

app.post('/api/designations', requireAuth, requirePermission('designations.manage'), requireModuleAccess('users'), async (req, res) => {
    const parsed = z.object({
        name: z.string().trim().min(2),
        code: z.string().trim().optional().or(z.literal('')),
        description: z.string().trim().optional().or(z.literal('')),
        hierarchyLevel: z.number().int().min(0).max(999).default(10)
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const code = cleanCode(parsed.data.code || parsed.data.name);
    if (!code)
        return res.status(400).json({ error: 'Designation code is required' });
    if (await one('SELECT id FROM designations WHERE name=? OR code=?', [parsed.data.name, code]))
        return res.status(409).json({ error: 'Designation name or code already exists' });
    const info = await query('INSERT INTO designations (name,code,description,hierarchy_level,status,created_by) VALUES (?,?,?,?,?,?)',
        [parsed.data.name, code, parsed.data.description || '', parsed.data.hierarchyLevel, 'active', req.user.id]);
    await audit(req.user.id, 'create', 'designation', String(info.insertId), { name: parsed.data.name, code });
    emitRefresh();
    res.status(201).json({ ok: true });
});

app.patch('/api/designations/:id', requireAuth, requirePermission('designations.manage'), requireModuleAccess('users'), async (req, res) => {
    const parsed = z.object({
        name: z.string().trim().min(2).optional(),
        code: z.string().trim().optional().or(z.literal('')),
        description: z.string().trim().optional(),
        hierarchyLevel: z.number().int().min(0).max(999).optional(),
        status: z.enum(entityStatus).optional()
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const designation = await one('SELECT * FROM designations WHERE id=?', [req.params.id]);
    if (!designation)
        return res.status(404).json({ error: 'Designation not found' });
    const columnMap = { hierarchyLevel: 'hierarchy_level' };
    const entries = Object.entries(parsed.data).filter(([, value]) => value !== undefined);
    if (!entries.length)
        return res.status(400).json({ error: 'No changes supplied' });
    const nextName = parsed.data.name || designation.name;
    const nextCode = parsed.data.code !== undefined ? cleanCode(parsed.data.code || designation.code) : designation.code;
    if (await one('SELECT id FROM designations WHERE id<>? AND (name=? OR code=?)', [req.params.id, nextName, nextCode]))
        return res.status(409).json({ error: 'Designation name or code already exists' });
    const sets = [];
    const values = [];
    for (const [key, value] of entries) {
        if (key === 'code') {
            sets.push('code=?');
            values.push(cleanCode(value || designation.code));
        }
        else {
            sets.push(`${columnMap[key] || key}=?`);
            values.push(value);
        }
    }
    await query(`UPDATE designations SET ${sets.join(',')} WHERE id=?`, [...values, req.params.id]);
    await audit(req.user.id, 'update', 'designation', req.params.id, parsed.data);
    emitRefresh();
    res.json({ ok: true });
});

app.post('/api/rbac/roles', requireAuth, requirePermission('roles.create'), requireModuleAccess('users'), async (req, res) => {
    const parsed = z.object({
        id: z.string().trim().optional().or(z.literal('')),
        name: z.string().trim().min(2),
        description: z.string().trim().optional().or(z.literal('')),
        level: z.number().int().min(0).max(100).default(10),
        roleType: z.enum(roleTypes).default('internal'),
        permissions: z.array(z.string().trim().min(1)).default([])
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const id = cleanSlug(parsed.data.id || parsed.data.name);
    if (!id)
        return res.status(400).json({ error: 'Role code is required' });
    if (!isSuperAdmin(req.user) && Number(parsed.data.level || 0) >= 80)
        return res.status(403).json({ error: 'Only Super Admin can create high-level roles' });
    if (['super_admin', 'admin', 'employee', 'client'].includes(id))
        return res.status(409).json({ error: 'Protected system role already exists' });
    if (await one('SELECT id FROM roles WHERE id=? OR slug=?', [id, id]))
        return res.status(409).json({ error: 'Role already exists' });
    const validation = await validatePermissionIds(parsed.data.permissions, parsed.data.roleType);
    if (validation.error)
        return res.status(400).json({ error: validation.error });
    await transaction(async connection => {
        await query(`INSERT INTO roles (id,name,slug,description,level,role_type,is_system,status)
            VALUES (?,?,?,?,?,?,0,'active')`,
            [id, parsed.data.name, id, parsed.data.description || '', parsed.data.level, parsed.data.roleType], connection);
        for (const permissionId of validation.permissionIds)
            await query('INSERT INTO role_permissions (role_id,permission_id) VALUES (?,?)', [id, permissionId], connection);
        await audit(req.user.id, 'create', 'role', id,
            { name: parsed.data.name, roleType: parsed.data.roleType, permissions: validation.permissionIds }, connection);
    });
    emitRefresh();
    res.status(201).json({ ok: true });
});

app.patch('/api/rbac/roles/:id', requireAuth, requirePermission('roles.edit'), requireModuleAccess('users'), async (req, res) => {
    const parsed = z.object({
        name: z.string().trim().min(2).optional(),
        description: z.string().trim().optional(),
        level: z.number().int().min(0).max(100).optional(),
        roleType: z.enum(roleTypes).optional(),
        status: z.enum(entityStatus).optional()
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const role = await one('SELECT * FROM roles WHERE id=?', [req.params.id]);
    if (!role)
        return res.status(404).json({ error: 'Role not found' });
    if (role.id === 'super_admin')
        return res.status(403).json({ error: 'Super Admin role is protected' });
    if (role.is_system && !isSuperAdmin(req.user))
        return res.status(403).json({ error: 'Only Super Admin can edit protected system roles' });
    if (!isSuperAdmin(req.user) && Number(role.level || 0) >= 80)
        return res.status(403).json({ error: 'Only Super Admin can edit high-level roles' });
    if (!isSuperAdmin(req.user) && parsed.data.level !== undefined && Number(parsed.data.level || 0) >= 80)
        return res.status(403).json({ error: 'Only Super Admin can assign high role levels' });
    if (role.is_system && (parsed.data.roleType || parsed.data.status === 'inactive'))
        return res.status(403).json({ error: 'System role type and active status are protected' });
    const nextRoleType = parsed.data.roleType || role.role_type;
    if (nextRoleType === 'client') {
        const currentPermissions = await query('SELECT permission_id FROM role_permissions WHERE role_id=?', [role.id]);
        const validation = await validatePermissionIds(currentPermissions.map(item => item.permission_id), 'client');
        if (validation.error)
            return res.status(400).json({ error: validation.error });
    }
    const entries = Object.entries(parsed.data).filter(([, value]) => value !== undefined);
    if (!entries.length)
        return res.status(400).json({ error: 'No changes supplied' });
    const columnMap = { roleType: 'role_type' };
    const sets = [];
    const values = [];
    for (const [key, value] of entries) {
        sets.push(`${columnMap[key] || key}=?`);
        values.push(value);
    }
    await query(`UPDATE roles SET ${sets.join(',')} WHERE id=?`, [...values, role.id]);
    await audit(req.user.id, 'update', 'role', role.id, parsed.data);
    emitRefresh();
    res.json({ ok: true });
});

app.get('/api/rbac/roles', requireAuth, requirePermission('roles.view', 'users.create', 'users.edit', 'users.assign_role', 'employees.create', 'employees.edit'), requireModuleAccess('users', 'employees'), async (_req, res) => {
    const roles = await query(`SELECT id,name,slug,description,level,role_type roleType,is_system isSystem,status,created_at createdAt,updated_at updatedAt
      FROM roles ORDER BY level DESC,name`);
    const rolePermissionRows = await query('SELECT role_id roleId,permission_id permissionId FROM role_permissions');
    const grouped = rolePermissionRows.reduce((map, row) => {
        map[row.roleId] = [...(map[row.roleId] || []), row.permissionId];
        return map;
    }, {});
    res.json({ roles: roles.map(role => ({ ...role, permissions: grouped[role.id] || [] })) });
});

app.get('/api/rbac/permissions', requireAuth, requirePermission('roles.view', 'roles.manage_permissions'), requireModuleAccess('users'), async (_req, res) => {
    const permissions = await query('SELECT id,module,action,label,description FROM permissions ORDER BY module,action');
    res.json({ permissions });
});

app.put('/api/rbac/roles/:id/permissions', requireAuth, requirePermission('roles.manage_permissions'), requireModuleAccess('users'), async (req, res) => {
    const parsed = z.object({ permissions: z.array(z.string().min(1)).default([]) }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const role = await one('SELECT * FROM roles WHERE id=?', [req.params.id]);
    if (!role)
        return res.status(404).json({ error: 'Role not found' });
    if (role.id === 'super_admin')
        return res.status(403).json({ error: 'Super Admin permissions are protected' });
    if (!isSuperAdmin(req.user) && role.id === req.user.roleId)
        return res.status(403).json({ error: 'You cannot modify permissions for your own role' });
    if (role.is_system && !isSuperAdmin(req.user))
        return res.status(403).json({ error: 'Only Super Admin can edit protected system role permissions' });
    if (!isSuperAdmin(req.user) && Number(role.level || 0) >= 80)
        return res.status(403).json({ error: 'Only Super Admin can edit high-level role permissions' });
    const validation = await validatePermissionIds(parsed.data.permissions, role.role_type);
    if (validation.error)
        return res.status(400).json({ error: validation.error });
    const permissionIds = validation.permissionIds;
    await transaction(async connection => {
        await query('DELETE FROM role_permissions WHERE role_id=?', [role.id], connection);
        for (const permissionId of permissionIds)
            await query('INSERT INTO role_permissions (role_id,permission_id) VALUES (?,?)', [role.id, permissionId], connection);
        await audit(req.user.id, 'update_permissions', 'role', role.id, { permissions: permissionIds }, connection);
    });
    emitRefresh();
    res.json({ ok: true });
});

app.get('/api/modules', requireAuth, requirePermission('modules.view_access_rules', 'modules.manage_access'), requireModuleAccess('users'), async (_req, res) => {
    res.json({ modules: await moduleAccessOverview() });
});

app.get('/api/module-access', requireAuth, requirePermission('modules.view_access_rules', 'modules.manage_access'), requireModuleAccess('users'), async (_req, res) => {
    res.json({ rules: await getModuleRules() });
});

app.get('/api/module-access/:moduleKey', requireAuth, requirePermission('modules.view_access_rules', 'modules.manage_access'), requireModuleAccess('users'), async (req, res) => {
    const modules = await moduleAccessOverview();
    const module = modules.find(item => item.id === req.params.moduleKey);
    if (!module)
        return res.status(404).json({ error: 'Module not found' });
    res.json({ module, rules: await getModuleRules(req.params.moduleKey) });
});

app.post('/api/module-access', requireAuth, requirePermission('modules.manage_access'), requireModuleAccess('users'), async (req, res) => {
    const parsed = moduleAccessPayloadSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const rule = normalizeModuleAccessInput({ ...parsed.data, id: '' });
    const validation = await validateModuleAccessRule(rule);
    if (validation.error)
        return res.status(400).json({ error: validation.error });
    const saved = await transaction(async connection => {
        const persisted = await saveModuleAccessRule(validation.rule, req.user.id, connection);
        await audit(req.user.id, validation.rule.id ? 'module_access_updated' : 'module_access_created', 'module_access_rule', persisted.id,
            { moduleKey: persisted.moduleKey, previousRuleId: validation.rule.id || null, rule: persisted }, connection);
        return persisted;
    });
    emitPermissionsUpdated();
    res.status(201).json({ rule: saved });
});

app.put('/api/module-access/:id', requireAuth, requirePermission('modules.manage_access'), requireModuleAccess('users'), async (req, res) => {
    const existing = await getModuleRuleById(req.params.id);
    if (!existing)
        return res.status(404).json({ error: 'Module access rule not found' });
    const parsed = moduleAccessPayloadSchema.safeParse({ ...req.body, id: req.params.id, moduleKey: req.body.moduleKey || existing.moduleKey });
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const rule = normalizeModuleAccessInput(parsed.data);
    const validation = await validateModuleAccessRule(rule);
    if (validation.error)
        return res.status(400).json({ error: validation.error });
    const saved = await transaction(async connection => {
        const persisted = await saveModuleAccessRule(validation.rule, req.user.id, connection);
        const action = !existing.isActive && persisted.isActive
            ? 'module_access_activated'
            : existing.isActive && !persisted.isActive
                ? 'module_access_disabled'
                : 'module_access_updated';
        await audit(req.user.id, action, 'module_access_rule', persisted.id,
            { moduleKey: persisted.moduleKey, previous: existing, next: persisted }, connection);
        return persisted;
    });
    emitPermissionsUpdated();
    res.json({ rule: saved });
});

app.delete('/api/module-access/:id', requireAuth, requirePermission('modules.manage_access'), requireModuleAccess('users'), async (req, res) => {
    const existing = await getModuleRuleById(req.params.id);
    if (!existing)
        return res.status(404).json({ error: 'Module access rule not found' });
    await transaction(async connection => {
        await deleteModuleAccessRule(req.params.id, connection);
        await audit(req.user.id, 'module_access_deleted', 'module_access_rule', req.params.id,
            { moduleKey: existing.moduleKey, previous: existing }, connection);
    });
    emitPermissionsUpdated();
    res.json({ ok: true });
});

app.post('/api/module-access/:moduleKey/evaluate', requireAuth, requirePermission('modules.view_access_rules', 'modules.manage_access'), requireModuleAccess('users'), async (req, res) => {
    const parsed = z.object({ userId: z.string().trim().min(1) }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const target = await loadUserContext(parsed.data.userId);
    if (!target)
        return res.status(404).json({ error: 'Active user not found' });
    const result = await evaluateModuleAccess(target, req.params.moduleKey);
    res.json({
        user: {
            id: target.id,
            name: target.name,
            accountType: target.accountType,
            roleName: target.roleName,
            departmentName: target.departmentName,
            designationName: target.designationName
        },
        moduleKey: req.params.moduleKey,
        result
    });
});

const productivityAccess = [requireAuth, productivityInternal, requirePermission('productivity.view'), requireModuleAccess('productivity')];
app.get('/api/productivity/meta', ...productivityAccess, async (req, res) => {
    res.json(await productivityMeta(req.user));
});
app.get('/api/productivity/dashboard', ...productivityAccess, async (req, res) => {
    res.json(await getDashboard({ range: productivityRange(req) }));
});
app.get('/api/productivity/analysis', ...productivityAccess, async (_req, res) => {
    res.json(await getAnalysis({}));
});
app.get('/api/productivity/jobs', ...productivityAccess, async (req, res) => {
    res.json(await getAllJobs({ range: productivityRange(req) }));
});
app.post('/api/productivity/jobs', ...productivityAccess, requirePermission('productivity.jobs.create', 'productivity.jobs.manage'), async (req, res) => {
    const parsed = productivityJobPayloadSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const payload = { ...parsed.data, completionDate: parsed.data.completionDate || null };
    const validationError = await validateProductivityReferences(payload);
    if (validationError)
        return res.status(400).json({ error: validationError });
    const job = await transaction(async connection => {
        const saved = await createOrUpdateProductivityJob(payload, req.user.id, connection);
        await audit(req.user.id, payload.id ? 'productivity_job_updated' : 'productivity_job_created', 'productivity_job', saved.id,
            { clientId: saved.clientId, valueAmount: saved.valueAmount, services: saved.services.map(service => service.id) }, connection);
        return saved;
    });
    emitProductivityMutation('job', job.id);
    res.status(201).json({ job });
});
app.get('/api/productivity/jobs/:id', ...productivityAccess, async (req, res) => {
    const jobs = await loadProductivityJobs(resolveProductivityPeriod({ period: 'all' }));
    const job = jobs.find(item => item.id === String(req.params.id));
    if (!job)
        return res.status(404).json({ error: 'Productivity job not found' });
    res.json({ job });
});
app.put('/api/productivity/jobs/:id', ...productivityAccess, requirePermission('productivity.jobs.manage'), async (req, res) => {
    const parsed = productivityJobPayloadSchema.safeParse({ ...req.body, id: req.params.id });
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const payload = { ...parsed.data, completionDate: parsed.data.completionDate || null };
    const validationError = await validateProductivityReferences(payload);
    if (validationError)
        return res.status(400).json({ error: validationError });
    const job = await transaction(async connection => {
        const saved = await createOrUpdateProductivityJob(payload, req.user.id, connection);
        await audit(req.user.id, 'productivity_job_updated', 'productivity_job', saved.id, { clientId: saved.clientId }, connection);
        return saved;
    });
    emitProductivityMutation('job', job.id);
    res.json({ job });
});
app.delete('/api/productivity/jobs/:id', ...productivityAccess, requirePermission('productivity.jobs.manage'), async (req, res) => {
    await transaction(async connection => {
        await deleteProductivityJob(req.params.id, connection);
        await audit(req.user.id, 'productivity_job_deleted', 'productivity_job', req.params.id, {}, connection);
    });
    emitProductivityMutation('job', req.params.id);
    res.json({ ok: true });
});
app.get('/api/productivity/daily-log', ...productivityAccess, async (req, res) => {
    res.json(await getDailyLog({ range: productivityRange(req) }));
});
app.get('/api/productivity/by-client', ...productivityAccess, async (req, res) => {
    res.json(await getByClient({ range: productivityRange(req) }));
});
app.get('/api/productivity/by-person', ...productivityAccess, async (req, res) => {
    const includeSalary = hasPermission(req.user, 'productivity.salaries.view');
    res.json(await getByPerson({ range: productivityRange(req), ownerId: req.user.id, includeSalary }));
});
app.get('/api/productivity/accounts', ...productivityAccess, async (req, res) => {
    res.json(await getAccounts({ range: productivityRange(req) }));
});
app.post('/api/productivity/accounts', ...productivityAccess, requirePermission('productivity.accounts.manage'), async (req, res) => {
    const parsed = productivityRosterPayloadSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const payload = { ...parsed.data, assignments: normalizeRosterAssignments(parsed.data.assignments) };
    const validationError = await validateRosterReferences(payload);
    if (validationError)
        return res.status(400).json({ error: validationError });
    const id = await transaction(async connection => {
        const roster = await saveRoster(payload, connection);
        await audit(req.user.id, roster.wasUpdate ? 'productivity_roster_updated' : 'productivity_roster_created', 'productivity_roster', String(roster.id),
            { clientId: payload.clientId, difficulty: payload.difficulty }, connection);
        return roster.id;
    });
    emitProductivityMutation('roster', String(id));
    res.status(201).json({ id: String(id) });
});
app.put('/api/productivity/accounts/:id', ...productivityAccess, requirePermission('productivity.accounts.manage'), async (req, res) => {
    const parsed = productivityRosterPayloadSchema.safeParse({ ...req.body, id: req.params.id });
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const payload = { ...parsed.data, assignments: normalizeRosterAssignments(parsed.data.assignments) };
    const validationError = await validateRosterReferences(payload);
    if (validationError)
        return res.status(400).json({ error: validationError });
    const id = await transaction(async connection => {
        const roster = await saveRoster(payload, connection);
        await audit(req.user.id, 'productivity_roster_updated', 'productivity_roster', String(roster.id), { clientId: payload.clientId }, connection);
        return roster.id;
    });
    emitProductivityMutation('roster', String(id));
    res.json({ id: String(id) });
});
app.delete('/api/productivity/accounts/:id', ...productivityAccess, requirePermission('productivity.accounts.manage'), async (req, res) => {
    await transaction(async connection => {
        await query('DELETE FROM productivity_account_rosters WHERE id=?', [req.params.id], connection);
        await audit(req.user.id, 'productivity_roster_deleted', 'productivity_roster', req.params.id, {}, connection);
    });
    emitProductivityMutation('roster', req.params.id);
    res.json({ ok: true });
});
app.post('/api/productivity/accounts/reassign', ...productivityAccess, requirePermission('productivity.accounts.manage'), async (req, res) => {
    const parsed = z.object({ fromUserId: z.string().min(1), toUserId: z.string().min(1), markInactive: z.boolean().optional().default(false) }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const rows = await transaction(async connection => {
        const affected = await reassignRosterAccounts(parsed.data, connection);
        await audit(req.user.id, 'productivity_roster_bulk_reassigned', 'productivity_roster', parsed.data.fromUserId,
            { fromUserId: parsed.data.fromUserId, toUserId: parsed.data.toUserId, affectedAccounts: affected }, connection);
        return affected;
    });
    emitProductivityMutation('roster', 'bulk');
    res.json({ affected: rows });
});
app.get('/api/productivity/targets', ...productivityAccess, async (_req, res) => {
    res.json(await getTargets({}));
});
app.post('/api/productivity/targets', ...productivityAccess, requirePermission('productivity.targets.manage'), async (req, res) => {
    const parsed = productivityTargetPayloadSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const id = await transaction(async connection => {
        const targetId = await saveTarget(parsed.data, req.user.id, connection);
        await audit(req.user.id, 'productivity_target_created', 'productivity_target', String(targetId), parsed.data, connection);
        return targetId;
    });
    emitProductivityMutation('target', String(id));
    res.status(201).json({ id: String(id) });
});
app.put('/api/productivity/targets/:id', ...productivityAccess, requirePermission('productivity.targets.manage'), async (req, res) => {
    const parsed = productivityTargetPayloadSchema.safeParse({ ...req.body, id: req.params.id });
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    await transaction(async connection => {
        await saveTarget(parsed.data, req.user.id, connection);
        await audit(req.user.id, 'productivity_target_updated', 'productivity_target', req.params.id, parsed.data, connection);
    });
    emitProductivityMutation('target', req.params.id);
    res.json({ ok: true });
});
app.delete('/api/productivity/targets/:id', ...productivityAccess, requirePermission('productivity.targets.manage'), async (req, res) => {
    await transaction(async connection => {
        await query('DELETE FROM productivity_targets WHERE id=?', [req.params.id], connection);
        await audit(req.user.id, 'productivity_target_deleted', 'productivity_target', req.params.id, {}, connection);
    });
    emitProductivityMutation('target', req.params.id);
    res.json({ ok: true });
});
app.get('/api/productivity/reports', ...productivityAccess, async (req, res) => {
    res.json(await getReports({ serviceId: req.query.serviceId || '' }));
});
app.get('/api/productivity/services', ...productivityAccess, async (_req, res) => {
    const services = await query('SELECT id,name,reference_hours referenceHours,is_active isActive FROM productivity_services ORDER BY is_active DESC,name');
    res.json({ services: services.map(service => ({ ...service, id: String(service.id), referenceHours: Number(service.referenceHours || 0), isActive: Boolean(service.isActive) })) });
});
app.post('/api/productivity/services', ...productivityAccess, requirePermission('productivity.services.manage'), async (req, res) => {
    const parsed = productivityServicePayloadSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await query('INSERT INTO productivity_services (name,reference_hours,is_active,created_by_user_id) VALUES (?,?,?,?)',
        [parsed.data.name, parsed.data.referenceHours, parsed.data.isActive ? 1 : 0, req.user.id]);
    await audit(req.user.id, 'productivity_service_created', 'productivity_service', String(result.insertId), { name: parsed.data.name });
    emitProductivityMutation('service', String(result.insertId));
    res.status(201).json({ id: String(result.insertId) });
});
app.put('/api/productivity/services/:id', ...productivityAccess, requirePermission('productivity.services.manage'), async (req, res) => {
    const parsed = productivityServicePayloadSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    await query('UPDATE productivity_services SET name=?,reference_hours=?,is_active=? WHERE id=?',
        [parsed.data.name, parsed.data.referenceHours, parsed.data.isActive ? 1 : 0, req.params.id]);
    await audit(req.user.id, 'productivity_service_updated', 'productivity_service', req.params.id, { name: parsed.data.name });
    emitProductivityMutation('service', req.params.id);
    res.json({ ok: true });
});
app.delete('/api/productivity/services/:id', ...productivityAccess, requirePermission('productivity.services.manage'), async (req, res) => {
    await query('UPDATE productivity_services SET is_active=0 WHERE id=?', [req.params.id]);
    await audit(req.user.id, 'productivity_service_updated', 'productivity_service', req.params.id, { isActive: false });
    emitProductivityMutation('service', req.params.id);
    res.json({ ok: true });
});
app.put('/api/productivity/employee-settings/:userId', ...productivityAccess, requirePermission('productivity.settings.manage'), async (req, res) => {
    const parsed = productivityEmployeeSettingsSchema.safeParse({ ...req.body, userId: req.params.userId });
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    await query(`INSERT INTO productivity_employee_settings (user_id,weekly_capacity_hours,productivity_status)
      VALUES (?,?,?)
      ON DUPLICATE KEY UPDATE weekly_capacity_hours=VALUES(weekly_capacity_hours),productivity_status=VALUES(productivity_status)`,
        [parsed.data.userId, parsed.data.weeklyCapacityHours, parsed.data.productivityStatus]);
    await audit(req.user.id, 'productivity_employee_setting_updated', 'user', parsed.data.userId,
        { weeklyCapacityHours: parsed.data.weeklyCapacityHours, productivityStatus: parsed.data.productivityStatus });
    emitProductivityMutation('employee-setting', parsed.data.userId);
    res.json({ ok: true });
});
app.get('/api/productivity/salary-grades', ...productivityAccess, requirePermission('productivity.salaries.view'), async (req, res) => {
    res.json(await salaryGradesForOwner(req.user.id));
});
app.post('/api/productivity/salary-grades', ...productivityAccess, requirePermission('productivity.salaries.manage'), async (req, res) => {
    const parsed = productivitySalaryGradeSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    if (parsed.data.maxAmount < parsed.data.minAmount)
        return res.status(400).json({ error: 'Max amount must be greater than min amount' });
    const result = await query('INSERT INTO productivity_salary_grades (owner_user_id,label,min_amount,max_amount) VALUES (?,?,?,?)',
        [req.user.id, parsed.data.label, parsed.data.minAmount, parsed.data.maxAmount]);
    await audit(req.user.id, 'productivity_salary_grade_created', 'productivity_salary_grade', String(result.insertId), { label: parsed.data.label });
    res.status(201).json({ id: String(result.insertId) });
});
app.put('/api/productivity/salary-grades/:id', ...productivityAccess, requirePermission('productivity.salaries.manage'), async (req, res) => {
    const parsed = productivitySalaryGradeSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    await query('UPDATE productivity_salary_grades SET label=?,min_amount=?,max_amount=? WHERE id=? AND owner_user_id=?',
        [parsed.data.label, parsed.data.minAmount, parsed.data.maxAmount, req.params.id, req.user.id]);
    await audit(req.user.id, 'productivity_salary_grade_updated', 'productivity_salary_grade', req.params.id, { label: parsed.data.label });
    res.json({ ok: true });
});
app.delete('/api/productivity/salary-grades/:id', ...productivityAccess, requirePermission('productivity.salaries.manage'), async (req, res) => {
    await query('DELETE FROM productivity_salary_grades WHERE id=? AND owner_user_id=?', [req.params.id, req.user.id]);
    await audit(req.user.id, 'productivity_salary_grade_deleted', 'productivity_salary_grade', req.params.id, {});
    res.json({ ok: true });
});
app.put('/api/productivity/salary-assignments/:employeeId', ...productivityAccess, requirePermission('productivity.salaries.manage'), async (req, res) => {
    const parsed = z.object({ gradeId: z.union([z.string(), z.number()]).optional().nullable() }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    if (!parsed.data.gradeId) {
        await query('DELETE FROM productivity_salary_assignments WHERE owner_user_id=? AND employee_user_id=?', [req.user.id, req.params.employeeId]);
    } else {
        const grade = await one('SELECT id FROM productivity_salary_grades WHERE id=? AND owner_user_id=?', [parsed.data.gradeId, req.user.id]);
        if (!grade)
            return res.status(404).json({ error: 'Private salary grade not found' });
        await query(`INSERT INTO productivity_salary_assignments (owner_user_id,employee_user_id,grade_id)
          VALUES (?,?,?)
          ON DUPLICATE KEY UPDATE grade_id=VALUES(grade_id)`, [req.user.id, req.params.employeeId, parsed.data.gradeId]);
    }
    await audit(req.user.id, 'productivity_salary_assignment_updated', 'user', req.params.employeeId, { changed: true });
    res.json({ ok: true });
});
app.get('/api/productivity/export', ...productivityAccess, requirePermission('productivity.export'), async (req, res) => {
    const range = productivityRange(req);
    const [dashboard, jobs] = await Promise.all([getDashboard({ range }), getAllJobs({ range })]);
    await audit(req.user.id, 'productivity_export_generated', 'productivity_export', range.key, { from: range.from, to: range.to });
    res.json({ range, dashboard, jobs: jobs.jobs });
});

app.get('/api/audit-logs', requireAuth, requirePermission('audit.view'), requireModuleAccess('audit'), async (_req, res) => {
    const rows = await query(`SELECT id,actor_id actorId,action,entity_type entityType,entity_id entityId,details,created_at createdAt
      FROM audit_logs ORDER BY created_at DESC,id DESC LIMIT 150`);
    res.json({
        logs: rows.map(row => {
            let details = {};
            try {
                details = JSON.parse(row.details || '{}');
            }
            catch {
                details = {};
            }
            return { ...row, details };
        })
    });
});
const publicDir = [
    path.resolve(__dirname, 'public'),
    path.resolve(process.cwd(), 'client/dist')
].find(candidate => fs.existsSync(path.join(candidate, 'index.html')));
if (publicDir) {
    app.use(express.static(publicDir));
    app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/socket.io'))
            return next();
        res.sendFile(path.join(publicDir, 'index.html'));
    });
}
io.on('connection', socket => { socket.emit('connected', { at: new Date().toISOString() }); });
setInterval(() => {
    void processExpiredAssignmentOffers();
}, 60 * 1000);
app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message });
});
const port = Number(process.env.PORT || 4000);
httpServer.listen(port, () => console.log(`CI360 API running on port ${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, async () => {
        await pool.end();
        httpServer.close(() => process.exit(0));
    });
}
