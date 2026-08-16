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
import { hasPermission, hasAnyPermission, isSuperAdmin, loadUserContext, requirePermission } from './permissions.js';
import { calculateHours } from './tat.js';
import { createProductivityRouter } from './routes/productivity.js';
const app = express();
const httpServer = createServer(app);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const io = new Server(httpServer, { cors: { origin } });
let databaseReady = false;
let databaseInitError = null;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
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
app.use(helmet({
    contentSecurityPolicy: false
}));
app.use(cors({ origin }));
app.use(express.json({ limit: '20mb' }));
app.use((req, res, next) => {
    req.setTimeout(120000, () => {
        if (!res.headersSent) {
            res.status(504).json({ error: 'Request gateway timeout' });
        }
    });
    next();
});
const emitRefresh = () => io.emit('data:changed', { at: new Date().toISOString() });
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 100;
const loginAttemptKey = (req, loginId) => `${req.ip || req.socket?.remoteAddress || 'unknown'}:${String(loginId || '').trim().toLowerCase()}`;
const getLoginAttempt = key => {
    const now = Date.now();
    const current = loginAttempts.get(key);
    if (!current || now - current.startedAt >= LOGIN_WINDOW_MS) {
        const fresh = { count: 0, startedAt: now };
        loginAttempts.set(key, fresh);
        return fresh;
    }
    return current;
};
const settings = async () => JSON.parse((await one('SELECT json FROM settings WHERE id=1')).json);
const categoryLoad = async () => {
    const rows = await query("SELECT category,COUNT(*) count FROM jobs WHERE status!='completed' AND status!='cancelled' GROUP BY category");
    return Object.fromEntries(rows.map(row => [row.category, row.count]));
};
const jobSelect = `SELECT j.*,
    assigned.name assigned_to_name,
    assigned_by.name assigned_by_name,
    creator.name created_by_name,
    department.name department_name,
    delegated_to.name delegated_to_name,
    delegated_by.name delegated_by_name
  FROM jobs j
  LEFT JOIN users assigned ON assigned.id=j.assigned_to_user_id
  LEFT JOIN users assigned_by ON assigned_by.id=j.assigned_by_user_id
  LEFT JOIN users creator ON creator.id=j.created_by_user_id
  LEFT JOIN departments department ON department.id=j.department_id
  LEFT JOIN users delegated_to ON delegated_to.id=j.delegated_to_user_id
  LEFT JOIN users delegated_by ON delegated_by.id=j.delegated_by_user_id`;
const mapJob = (row, includeInternal = true) => {
    let delegationStatus = row.delegation_status || 'none';
    if (delegationStatus === 'pending' && row.delegation_deadline) {
        if (new Date(row.delegation_deadline).getTime() <= Date.now()) {
            delegationStatus = 'auto_accepted';
        }
    }
    return {
        id: row.id, clientId: row.client_id, title: row.title, description: row.description, category: row.category,
        priority: row.priority, postedBy: row.posted_by, assetLink: row.asset_link, calculatedHours: row.calculated_hours,
        teamOverrideHours: row.team_override_hours, status: row.status,
        datePosted: row.date_posted, dateCompleted: row.date_completed, updatedAt: row.updated_at,
        delegationStatus,
        delegatedToUserId: row.delegated_to_user_id,
        delegatedToName: row.delegated_to_name,
        delegatedByUserId: row.delegated_by_user_id,
        delegatedByName: row.delegated_by_name,
        delegationDeadline: row.delegation_deadline,
        delegationNote: row.delegation_note,
        delegationSharePercent: row.delegation_share_percent,
        rejectionReason: row.rejection_reason,
        ...(includeInternal ? {
            teamOverrideNote: row.team_override_note,
            createdByUserId: row.created_by_user_id,
            createdByName: row.created_by_name,
            assignedToUserId: row.assigned_to_user_id,
            assignedToName: row.assigned_to_name,
            assignedByUserId: row.assigned_by_user_id,
            assignedByName: row.assigned_by_name,
            departmentId: row.department_id,
            departmentName: row.department_name,
            assignmentDate: row.assignment_date,
            assignmentNote: row.assignment_note
        } : {})
    };
};
const ticketCategories = ['Technical Issue', 'Account Issue', 'Job Posting Issue', 'Candidate Issue', 'Client Issue', 'Billing Issue', 'Feature Request', 'General Support'];
const ticketPriorities = ['Low', 'Medium', 'High', 'Urgent'];
const ticketStatuses = ['Open', 'In Progress', 'Waiting for User', 'Resolved', 'Closed'];
const allowedAttachmentExtensions = new Set(['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'zip']);
const maxAttachmentBytes = 10 * 1024 * 1024;
const ticketNumberFor = (id) => `TKT-${String(id).padStart(6, '0')}`;
const mapTicket = (row) => ({
    ticketNumber: row.ticket_number, userId: row.user_id, userName: row.user_name, clientId: row.client_id,
    subject: row.subject, category: row.category, priority: row.priority, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at, closedAt: row.closed_at
});
const canViewAllJobs = user => hasPermission(user, 'jobs.view_all');
const canViewDepartmentJobs = user => hasPermission(user, 'jobs.view_department');
const canAssignJobs = user => hasAnyPermission(user, ['jobs.assign', 'jobs.reassign']);
const canViewAllClients = user => hasPermission(user, 'clients.view_all');
const canViewClients = user => hasAnyPermission(user, ['clients.view', 'clients.view_all', 'clients.create', 'clients.edit', 'clients.delete', 'clients.assign_owner']);
const canManageSupport = user => hasPermission(user, 'support.manage') || hasPermission(user, 'support.view_all');
const clientSelect = `SELECT c.id,c.name,c.status,c.contact_name contactName,c.email,c.phone,c.industry,
    c.account_owner_user_id accountOwnerUserId,owner.name accountOwnerName,c.created_by createdBy,c.created_at createdAt,c.updated_at updatedAt,
    EXISTS(SELECT 1 FROM users client_user WHERE client_user.client_id=c.id AND COALESCE(client_user.account_type,client_user.role)='client') hasLogin
  FROM clients c
  LEFT JOIN users owner ON owner.id=c.account_owner_user_id`;
const canAccessClient = (user, client) => canViewAllClients(user)
    || (user.clientId && client.id === user.clientId)
    || (canViewClients(user) && (client.account_owner_user_id === user.id || client.created_by === user.id));
const loadVisibleClients = user => {
    if (canViewAllClients(user))
        return query(`${clientSelect} ORDER BY c.name`);
    if (user.clientId)
        return query(`${clientSelect} WHERE c.id=? ORDER BY c.name`, [user.clientId]);
    if (canViewClients(user))
        return query(`${clientSelect} WHERE c.account_owner_user_id=? OR c.created_by=? ORDER BY c.name`, [user.id, user.id]);
    return [];
};
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
const clientSafePermissions = new Set(['dashboard.view', 'jobs.view_own', 'jobs.create', 'support.view_own', 'support.create', 'support.reply']);
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
    || job.delegated_to_user_id === user.id
    || (canViewDepartmentJobs(user) && user.departmentId && job.department_id === user.departmentId);
const loadVisibleJobs = user => {
    if (canViewAllJobs(user))
        return query(`${jobSelect} ORDER BY j.date_posted DESC`);
    const clauses = ['j.client_id=?', 'j.created_by_user_id=?', 'j.assigned_to_user_id=?', 'j.delegated_to_user_id=?'];
    const params = [user.clientId || '', user.id, user.id, user.id];
    if (canViewDepartmentJobs(user) && user.departmentId) {
        clauses.push('j.department_id=?');
        params.push(user.departmentId);
    }
    return query(`${jobSelect} WHERE ${clauses.join(' OR ')} ORDER BY j.date_posted DESC`, params);
};
const categoryLoadForUser = async user => {
    if (canViewAllJobs(user))
        return categoryLoad();
    const clauses = ['client_id=?', 'created_by_user_id=?', 'assigned_to_user_id=?', 'delegated_to_user_id=?'];
    const params = [user.clientId || '', user.id, user.id, user.id];
    if (canViewDepartmentJobs(user) && user.departmentId) {
        clauses.push('department_id=?');
        params.push(user.departmentId);
    }
    const rows = await query(`SELECT category,COUNT(*) count FROM jobs
      WHERE status!='completed' AND status!='cancelled' AND (${clauses.join(' OR ')})
      GROUP BY category`, params);
    return Object.fromEntries(rows.map(row => [row.category, row.count]));
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
    const health = databaseHealthDetails();
    res.status(503).json({
        error: databaseInitError ? `Database connecting: ${databaseInitError.message || databaseInitError.code}` : 'Database is initializing...',
        code: databaseInitError?.code || 'DB_STARTING',
        hint: health.hint || 'Database is connecting. Please ensure your MySQL database credentials in .env are correct.'
    });
});
app.post('/api/auth/login', async (req, res) => {
    const parsed = z.object({ id: z.string().min(1), password: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: 'ID and password are required' });
    const loginId = parsed.data.id.trim();
    const password = parsed.data.password;
    const attemptKey = loginAttemptKey(req, loginId);
    const attempt = getLoginAttempt(attemptKey);
    if (attempt.count >= LOGIN_MAX_ATTEMPTS) {
        const retryAfterSeconds = Math.max(1, Math.ceil((LOGIN_WINDOW_MS - (Date.now() - attempt.startedAt)) / 1000));
        res.setHeader('Retry-After', String(retryAfterSeconds));
        return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    }
    const envSuperAdmin = environmentSuperAdminCredentials();
    if (envSuperAdmin.id
        && envSuperAdmin.password
        && [envSuperAdmin.id, envSuperAdmin.email].filter(Boolean).some(id => id.toLowerCase() === loginId.toLowerCase())
        && password === envSuperAdmin.password) {
        await ensureEnvironmentSuperAdmin();
    }
    if (shouldRepairDemoLogin(loginId, password)) {
        await seedDemoUsers();
    }

    let user = await one(
        `SELECT * FROM users
         WHERE (LOWER(TRIM(id))=LOWER(?) OR LOWER(TRIM(email))=LOWER(?) OR LOWER(TRIM(client_id))=LOWER(?) OR LOWER(TRIM(name))=LOWER(?))
           AND (status='active' OR status IS NULL)
         ORDER BY (LOWER(TRIM(id))=LOWER(?)) DESC, (LOWER(TRIM(email))=LOWER(?)) DESC, (LOWER(TRIM(client_id))=LOWER(?)) DESC
         LIMIT 1`,
        [loginId, loginId, loginId, loginId, loginId, loginId, loginId]
    );

    let passwordValid = false;

    if (user && user.password_hash) {
        try {
            passwordValid = await bcrypt.compare(password, user.password_hash);
        } catch {
            passwordValid = false;
        }
    }

    // Check if user is entering demo password CI360Demo#2026 or demo client passwords
    if (!passwordValid && user) {
        if (password === 'CI360Demo#2026' || (user.client_id === 'acme' && password === 'acme123') || (user.client_id === 'beta' && password === 'beta123')) {
            passwordValid = true;
            const updatedHash = await bcrypt.hash(password, 12);
            await query('UPDATE users SET password_hash=? WHERE id=?', [updatedHash, user.id]);
        }
    }

    if (!passwordValid) {
        // Fallback: Check if matching client exists in clients table
        const clientRow = await one(
            `SELECT * FROM clients
             WHERE (LOWER(TRIM(id))=LOWER(?) OR LOWER(TRIM(email))=LOWER(?) OR LOWER(TRIM(name))=LOWER(?))
               AND (status='active' OR status IS NULL)
             LIMIT 1`,
            [loginId, loginId, loginId]
        );
        if (clientRow) {
            let clientMatch = false;
            if (clientRow.password_hash) {
                try {
                    clientMatch = await bcrypt.compare(password, clientRow.password_hash);
                } catch {
                    clientMatch = false;
                }
            }
            if (!clientMatch && (password === 'CI360Demo#2026' || (clientRow.id === 'acme' && password === 'acme123') || (clientRow.id === 'beta' && password === 'beta123'))) {
                clientMatch = true;
            }
            if (clientMatch) {
                passwordValid = true;
                const newHash = await bcrypt.hash(password, 12);
                const userId = user ? user.id : clientRow.id;
                const userName = user ? user.name : (clientRow.contact_name || clientRow.name);
                const userEmail = user ? user.email : (clientRow.email || `${clientRow.id}@client.local`);
                await query(
                    `INSERT INTO users (id, name, email, phone, password_hash, role, account_type, role_id, client_id, status, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, 'client', 'client', 'client', ?, 'active', NOW(), NOW())
                     ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), role='client', account_type='client', role_id='client', client_id=VALUES(client_id), status='active'`,
                    [userId, userName, userEmail, clientRow.phone || null, newHash, clientRow.id]
                );
                user = await one("SELECT * FROM users WHERE id=?", [userId]);
            }
        }
    }

    if (!user || !passwordValid) {
        attempt.count += 1;
        loginAttempts.set(attemptKey, attempt);
        return res.status(401).json({ error: 'Incorrect ID or password' });
    }

    loginAttempts.delete(attemptKey);
    await query('UPDATE users SET last_login=?,updated_at=? WHERE id=?', [new Date(), new Date(), user.id]);
    const authUser = await loadUserContext(user.id);
    if (!authUser) {
        return res.status(401).json({ error: 'Account is inactive or disabled' });
    }
    res.json({ token: signToken({ id: authUser.id }), user: authUser, permissions: authUser.permissions, modules: authUser.modules });
});
app.get('/api/bootstrap', requireAuth, async (req, res) => {
    const user = req.user;
    const includeInternalJobFields = user.accountType !== 'client';
    const canReadJobs = hasAnyPermission(user, ['jobs.view_all', 'jobs.view_own', 'jobs.view_department']);
    const canReadSupport = hasAnyPermission(user, ['support.view_all', 'support.view_own', 'support.manage']);
    const canReadSettings = hasAnyPermission(user, ['settings.view', 'settings.edit']);
    const jobRows = canReadJobs ? await loadVisibleJobs(user) : [];
    const clients = await loadVisibleClients(user);
    const ticketRows = !canReadSupport
        ? []
        : canManageSupport(user)
            ? await query('SELECT * FROM support_tickets ORDER BY updated_at DESC,id DESC')
            : await query('SELECT * FROM support_tickets WHERE user_id=? OR client_id=? ORDER BY updated_at DESC,id DESC', [user.id, user.clientId || '']);
    const assignees = user.accountType === 'client' && !canAssignJobs(user)
        ? []
        : await query(`SELECT u.id,u.name,u.department_id departmentId,u.designation_id designationId,d.name departmentName,ds.name designationName
            FROM users u
            LEFT JOIN departments d ON d.id=u.department_id
            LEFT JOIN designations ds ON ds.id=u.designation_id
            WHERE u.status='active' AND COALESCE(u.account_type,u.role)<>'client'
            ORDER BY u.name`);
    const departments = user.accountType === 'client' && !canViewDepartmentJobs(user)
        ? []
        : await query("SELECT id,name,code FROM departments WHERE status='active' ORDER BY name");
    const clientOwners = user.accountType === 'client' && !hasPermission(user, 'clients.assign_owner')
        ? []
        : await query(`SELECT id,name,COALESCE(account_type,role) accountType,department_id departmentId FROM users
            WHERE status='active' AND COALESCE(account_type,role)<>'client' ORDER BY name`);
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
        clientOwners
    });
});
app.get('/api/jobs', requireAuth, requirePermission('jobs.view_own', 'jobs.view_all', 'jobs.view_department'), async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 25)));
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim();
    const category = String(req.query.category || '').trim();
    const rows = await loadVisibleJobs(req.user);
    let filtered = rows;
    if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(row => [row.id, row.title, row.description, row.client_id, row.assigned_to_name]
            .some(value => String(value || '').toLowerCase().includes(q)));
    }
    if (status)
        filtered = filtered.filter(row => row.status === status);
    if (category)
        filtered = filtered.filter(row => row.category === category);
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    res.json({
        jobs: filtered.slice(start, start + pageSize).map(row => mapJob(row, req.user.accountType !== 'client')),
        pagination: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) }
    });
});
app.get('/api/jobs/:id', requireAuth, requirePermission('jobs.view_own', 'jobs.view_all', 'jobs.view_department'), async (req, res) => {
    const row = await one(`${jobSelect} WHERE j.id=?`, [req.params.id]);
    if (!row)
        return res.status(404).json({ error: 'Job not found' });
    if (!canAccessJob(req.user, row))
        return res.status(403).json({ error: 'Job access denied' });
    const assignmentHistory = req.user.accountType === 'client' ? [] : await query(`SELECT ja.id,ja.job_id jobId,
        ja.previous_assignee_user_id previousAssigneeUserId,previous_assignee.name previousAssigneeName,
        ja.assigned_to_user_id assignedToUserId,assignee.name assignedToName,
        ja.assigned_by_user_id assignedByUserId,actor.name assignedByName,
        ja.previous_department_id previousDepartmentId,previous_department.name previousDepartmentName,
        ja.department_id departmentId,department.name departmentName,ja.note,ja.created_at createdAt
      FROM job_assignments ja
      LEFT JOIN users previous_assignee ON previous_assignee.id=ja.previous_assignee_user_id
      LEFT JOIN users assignee ON assignee.id=ja.assigned_to_user_id
      LEFT JOIN users actor ON actor.id=ja.assigned_by_user_id
      LEFT JOIN departments previous_department ON previous_department.id=ja.previous_department_id
      LEFT JOIN departments department ON department.id=ja.department_id
      WHERE ja.job_id=? ORDER BY ja.created_at DESC,ja.id DESC`, [row.id]);
    res.json({ job: mapJob(row, req.user.accountType !== 'client'), assignmentHistory });
});
app.post('/api/jobs', requireAuth, requirePermission('jobs.create'), async (req, res) => {
    const schema = z.object({
        clientId: z.string().optional(),
        title: z.string().min(2),
        description: z.string().default(''),
        category: z.string().min(1),
        priority: z.enum(['Low', 'Medium', 'High', 'Urgent']),
        postedBy: z.string().min(2),
        assetLink: z.string().default(''),
        assignedToUserId: z.string().trim().optional()
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const user = req.user;
    const clientId = user.accountType === 'client' ? user.clientId : parsed.data.clientId;
    if (!clientId)
        return res.status(400).json({ error: 'Client is required' });
    const client = await one("SELECT * FROM clients WHERE id=? AND status='active'", [clientId]);
    if (!client)
        return res.status(400).json({ error: 'Active client not found' });
    if (user.accountType !== 'client' && !canAccessClient(user, client))
        return res.status(403).json({ error: 'You cannot create jobs for this client' });
    const id = 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const now = new Date().toISOString();
    const calculatedHours = calculateHours(await settings(), await categoryLoad(), parsed.data.category, parsed.data.priority);

    // Auto-assign to Urna / Mansi (or client-selected assignee)
    let assignedToUserId = parsed.data.assignedToUserId || null;
    let assignmentNote = 'Direct assignment';
    if (!assignedToUserId) {
        const leadUsers = await query("SELECT id, name FROM users WHERE name IN ('Urna', 'Mansi') AND is_active=1 ORDER BY (name='Urna') DESC");
        if (leadUsers.length > 0) {
            assignedToUserId = leadUsers[0].id;
            assignmentNote = `Auto-assigned to ${leadUsers[0].name} (CS / Operations Lead)`;
        }
    }

    await transaction(async connection => {
        await query(`INSERT INTO jobs (id,client_id,title,description,category,priority,posted_by,created_by_user_id,assigned_to_user_id,assigned_by_user_id,assignment_date,assignment_note,asset_link,calculated_hours,status,date_posted,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'submitted',?,?)`, [
            id, clientId, parsed.data.title, parsed.data.description, parsed.data.category, parsed.data.priority,
            parsed.data.postedBy, user.id, assignedToUserId, user.id, now, assignmentNote,
            parsed.data.assetLink, calculatedHours, now, now
        ], connection);

        if (assignedToUserId) {
            await query(`INSERT INTO job_assignments (job_id, assigned_to_user_id, assigned_by_user_id, note) VALUES (?, ?, ?, ?)`, [
                id, assignedToUserId, user.id, assignmentNote
            ], connection);
        }

        await audit(user.id, 'create', 'job', id, { ...parsed.data, autoAssignedTo: assignedToUserId }, connection);
    });

    emitRefresh();
    res.status(201).json({ job: mapJob(await one(`${jobSelect} WHERE j.id=?`, [id])) });
});

app.post('/api/jobs/:id/delegate', requireAuth, async (req, res) => {
    const { delegatedToUserId, note = '', sharePercent = 100 } = req.body;
    if (!delegatedToUserId) return res.status(400).json({ error: 'Please select a team member to delegate to' });
    const job = await one('SELECT * FROM jobs WHERE id=?', [req.params.id]);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const targetUser = await one("SELECT id, name FROM users WHERE id=? AND is_active=1", [delegatedToUserId]);
    if (!targetUser) return res.status(400).json({ error: 'Active team member not found' });

    const deadline = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(); // 4 hours window
    const now = new Date().toISOString();
    const shareNum = Math.min(100, Math.max(1, Number(sharePercent) || 100));

    await transaction(async connection => {
        await query(
            `UPDATE jobs 
             SET delegation_status='pending', delegated_to_user_id=?, delegated_by_user_id=?,
                 delegation_deadline=?, delegation_note=?, delegation_share_percent=?, rejection_reason=NULL, updated_at=?
             WHERE id=?`,
            [delegatedToUserId, req.user.id, deadline, note, shareNum, now, req.params.id],
            connection
        );
        await query(
            `INSERT INTO job_assignments (job_id, previous_assignee_user_id, assigned_to_user_id, assigned_by_user_id, note)
             VALUES (?, ?, ?, ?, ?)`,
            [req.params.id, job.assigned_to_user_id, delegatedToUserId, req.user.id, `Delegated to ${targetUser.name} (${shareNum}% split, 4hr response window): ${note}`],
            connection
        );
        await audit(req.user.id, 'delegate', 'job', req.params.id, { delegatedToUserId, sharePercent: shareNum, deadline }, connection);
    });

    emitRefresh();
    const updated = await one(`${jobSelect} WHERE j.id=?`, [req.params.id]);
    res.json({ job: mapJob(updated, req.user.accountType !== 'client') });
});

app.post('/api/jobs/:id/accept-delegation', requireAuth, async (req, res) => {
    const job = await one('SELECT * FROM jobs WHERE id=?', [req.params.id]);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const now = new Date().toISOString();

    await transaction(async connection => {
        await query(
            `UPDATE jobs 
             SET delegation_status='accepted', assigned_to_user_id=COALESCE(delegated_to_user_id, assigned_to_user_id),
                 status=CASE WHEN status='submitted' THEN 'in_progress' ELSE status END,
                 updated_at=?
             WHERE id=?`,
            [now, req.params.id],
            connection
        );
        await query(
            `INSERT INTO job_assignments (job_id, previous_assignee_user_id, assigned_to_user_id, assigned_by_user_id, note)
             VALUES (?, ?, ?, ?, ?)`,
            [req.params.id, job.delegated_by_user_id, req.user.id, req.user.id, 'Delegation accepted by assignee'],
            connection
        );
        await audit(req.user.id, 'accept_delegation', 'job', req.params.id, {}, connection);
    });

    emitRefresh();
    const updated = await one(`${jobSelect} WHERE j.id=?`, [req.params.id]);
    res.json({ job: mapJob(updated, req.user.accountType !== 'client') });
});

app.post('/api/jobs/:id/reject-delegation', requireAuth, async (req, res) => {
    const { reason = 'Unable to accept task within schedule' } = req.body;
    const job = await one('SELECT * FROM jobs WHERE id=?', [req.params.id]);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const now = new Date().toISOString();

    let targetLeadId = job.delegated_by_user_id;
    if (!targetLeadId || targetLeadId === req.user.id) {
        const leadUsers = await query("SELECT id FROM users WHERE name IN ('Urna', 'Mansi') AND is_active=1 ORDER BY (name='Urna') DESC");
        targetLeadId = leadUsers[0]?.id || (await one("SELECT id FROM users WHERE account_type='super_admin' LIMIT 1"))?.id || req.user.id;
    }

    await transaction(async connection => {
        await query(
            `UPDATE jobs 
             SET delegation_status='rejected', rejection_reason=?,
                 assigned_to_user_id=?,
                 status=CASE WHEN status='in_progress' THEN 'submitted' ELSE status END,
                 updated_at=?
             WHERE id=?`,
            [reason, targetLeadId, now, req.params.id],
            connection
        );
        await query(
            `INSERT INTO job_assignments (job_id, previous_assignee_user_id, assigned_to_user_id, assigned_by_user_id, note)
             VALUES (?, ?, ?, ?, ?)`,
            [req.params.id, req.user.id, targetLeadId, req.user.id, `Job Rejected: ${reason}`],
            connection
        );
        await audit(req.user.id, 'reject_delegation', 'job', req.params.id, { reason, reassignedToLead: targetLeadId }, connection);
    });

    emitRefresh();
    const updated = await one(`${jobSelect} WHERE j.id=?`, [req.params.id]);
    res.json({ job: mapJob(updated, req.user.accountType !== 'client') });
});
app.patch('/api/jobs/:id', requireAuth, requirePermission('jobs.edit', 'jobs.update_status', 'jobs.override_tat', 'jobs.assign', 'jobs.reassign'), async (req, res) => {
    const schema = z.object({
        title: z.string().min(2).optional(),
        description: z.string().optional(),
        category: z.string().optional(),
        priority: z.enum(['Low', 'Medium', 'High', 'Urgent']).optional(),
        status: z.enum(['submitted', 'under_review', 'in_progress', 'waiting_client', 'revision_requested', 'on_hold', 'completed', 'cancelled']).optional(),
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
    const current = await one('SELECT * FROM jobs WHERE id=?', [req.params.id]);
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
    let departmentId = parsed.data.departmentId === undefined ? current.department_id : optionalId(parsed.data.departmentId);
    if (Number.isNaN(departmentId))
        return res.status(400).json({ error: 'Department is invalid' });
    if (assignedToUserId) {
        const assignee = await one("SELECT id,account_type,department_id FROM users WHERE id=? AND status='active'", [assignedToUserId]);
        if (!assignee || assignee.account_type === 'client')
            return res.status(400).json({ error: 'Active internal assignee not found' });
        if (!departmentId && assignee.department_id)
            departmentId = assignee.department_id;
        if (departmentId && assignee.department_id && Number(departmentId) !== Number(assignee.department_id) && !isSuperAdmin(req.user))
            return res.status(400).json({ error: 'Assignee must belong to the selected department' });
    }
    if (departmentId) {
        const department = await one("SELECT id FROM departments WHERE id=? AND status='active'", [departmentId]);
        if (!department)
            return res.status(400).json({ error: 'Active department not found' });
    }
    const normalizedData = { ...parsed.data };
    if (parsed.data.assignedToUserId !== undefined)
        normalizedData.assignedToUserId = assignedToUserId;
    if (parsed.data.departmentId !== undefined)
        normalizedData.departmentId = departmentId;
    const map = { title: 'title', description: 'description', category: 'category', priority: 'priority', status: 'status', assetLink: 'asset_link', teamOverrideHours: 'team_override_hours', teamOverrideNote: 'team_override_note', assignedToUserId: 'assigned_to_user_id', departmentId: 'department_id', assignmentNote: 'assignment_note' };
    const entries = Object.entries(normalizedData);
    if (!entries.length)
        return res.status(400).json({ error: 'No changes supplied' });
    const sets = entries.map(([key]) => `${map[key]}=?`);
    const values = entries.map(([, value]) => value);
    sets.push('updated_at=?');
    values.push(new Date().toISOString());
    if (parsed.data.status === 'completed') {
        sets.push('date_completed=?');
        values.push(new Date().toISOString());
    }
    if (parsed.data.status && parsed.data.status !== 'completed') {
        sets.push('date_completed=NULL');
    }
    if (assignmentRequested) {
        sets.push('assigned_by_user_id=?', 'assignment_date=?');
        values.push(req.user.id, new Date().toISOString());
    }
    const assignmentChanged = assignmentRequested && (
        assignedToUserId !== current.assigned_to_user_id || departmentId !== current.department_id
    );
    await transaction(async connection => {
        await query(`UPDATE jobs SET ${sets.join(',')} WHERE id=?`, [...values, req.params.id], connection);
        if (assignmentRequested) {
            await query(`INSERT INTO job_assignments
                (job_id,previous_assignee_user_id,assigned_to_user_id,assigned_by_user_id,previous_department_id,department_id,note)
                VALUES (?,?,?,?,?,?,?)`, [
                req.params.id,
                current.assigned_to_user_id,
                assignedToUserId,
                req.user.id,
                current.department_id,
                departmentId,
                parsed.data.assignmentNote || null
            ], connection);
        }
        await audit(req.user.id, assignmentChanged ? (current.assigned_to_user_id ? 'reassign' : 'assign') : 'update', 'job', req.params.id,
            { ...parsed.data, previousAssigneeUserId: current.assigned_to_user_id, previousDepartmentId: current.department_id }, connection);
    });
    emitRefresh();
    res.json({ job: mapJob(await one(`${jobSelect} WHERE j.id=?`, [req.params.id]), req.user.accountType !== 'client') });
});
app.put('/api/settings', requireAuth, requirePermission('settings.edit'), async (req, res) => {
    const schema = z.object({ categories: z.array(z.object({ name: z.string().min(1), baseHours: z.number().positive() })).min(1), capacityPerCategory: z.number().int().positive(), bufferHoursPerExtraJob: z.number().nonnegative(), startHour: z.number().min(0).max(24), endHour: z.number().min(0).max(24), workDays: z.array(z.number().int().min(0).max(6)).min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    await query('UPDATE settings SET json=? WHERE id=1', [JSON.stringify(parsed.data)]);
    await audit(req.user.id, 'update', 'settings', '1', parsed.data);
    emitRefresh();
    res.json({ settings: parsed.data });
});
app.post('/api/clients', requireAuth, requirePermission('clients.create'), async (req, res) => {
    const parsed = z.object({
        id: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]+$/),
        name: z.string().trim().min(2),
        contactName: z.string().trim().max(255).optional().or(z.literal('')),
        email: z.string().trim().email().optional().or(z.literal('')),
        phone: z.string().trim().max(60).optional().or(z.literal('')),
        industry: z.string().trim().max(160).optional().or(z.literal('')),
        accountOwnerUserId: z.string().trim().optional().or(z.literal('')),
        createLogin: z.boolean().optional(),
        password: z.string().min(8).optional().or(z.literal(''))
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const input = parsed.data;
    if (await one('SELECT id FROM clients WHERE id=?', [input.id]))
        return res.status(409).json({ error: 'Client ID already exists' });
    const createLogin = input.createLogin ?? Boolean(input.password);
    if (createLogin && !input.password)
        return res.status(400).json({ error: 'A temporary password is required when creating a client login' });
    if (createLogin && await one('SELECT id FROM users WHERE id=?', [input.id]))
        return res.status(409).json({ error: 'A user with this Client ID already exists' });
    if (createLogin && input.email && await one('SELECT id FROM users WHERE email=?', [input.email]))
        return res.status(409).json({ error: 'Email is already used by another account' });
    let ownerId = req.user.accountType === 'client' ? null : req.user.id;
    if (input.accountOwnerUserId && input.accountOwnerUserId !== ownerId) {
        if (!hasPermission(req.user, 'clients.assign_owner'))
            return res.status(403).json({ error: 'Client owner assignment permission required' });
        const owner = await one("SELECT id FROM users WHERE id=? AND status='active' AND COALESCE(account_type,role)<>'client'", [input.accountOwnerUserId]);
        if (!owner)
            return res.status(400).json({ error: 'Active internal account owner not found' });
        ownerId = owner.id;
    }
    const passwordHash = await bcrypt.hash(input.password || `${input.id}-${Date.now()}-${Math.random()}`, 12);
    await transaction(async connection => {
        await query(`INSERT INTO clients
            (id,name,contact_name,email,phone,industry,password_hash,status,account_owner_user_id,created_by,updated_at)
            VALUES (?,?,?,?,?,?,?,'active',?,?,?)`, [
            input.id,input.name,input.contactName || null,input.email || null,input.phone || null,input.industry || null,
            passwordHash,ownerId,req.user.id,new Date()
        ], connection);
        if (createLogin) {
            await query(`INSERT INTO users
                (id,name,email,phone,password_hash,role,account_type,role_id,client_id,status,created_by,updated_at)
                VALUES (?,?,?,?,?,'client','client','client',?,'active',?,?)`,
                [input.id,input.contactName || input.name,input.email || null,input.phone || null,passwordHash,input.id,req.user.id,new Date()], connection);
        }
        await audit(req.user.id, 'create', 'client', input.id,
            { name: input.name, accountOwnerUserId: ownerId, createLogin }, connection);
    });
    emitRefresh();
    res.status(201).json({ ok: true });
});
app.patch('/api/clients/:id', requireAuth, requirePermission('clients.edit'), async (req, res) => {
    const parsed = z.object({
        name: z.string().trim().min(2).optional(),
        contactName: z.string().trim().max(255).optional().or(z.literal('')),
        email: z.string().trim().email().optional().or(z.literal('')),
        phone: z.string().trim().max(60).optional().or(z.literal('')),
        industry: z.string().trim().max(160).optional().or(z.literal('')),
        accountOwnerUserId: z.string().trim().optional().or(z.literal('')),
        password: z.string().min(8).optional().or(z.literal('')),
        status: z.enum(['active', 'archived']).optional()
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const client = await one('SELECT * FROM clients WHERE id=?', [req.params.id]);
    if (!client)
        return res.status(404).json({ error: 'Client not found' });
    if (!canAccessClient(req.user, client))
        return res.status(403).json({ error: 'Client access denied' });
    if (parsed.data.accountOwnerUserId !== undefined && !hasPermission(req.user, 'clients.assign_owner'))
        return res.status(403).json({ error: 'Client owner assignment permission required' });
    let ownerId = client.account_owner_user_id;
    if (parsed.data.accountOwnerUserId !== undefined) {
        ownerId = parsed.data.accountOwnerUserId || null;
        if (ownerId) {
            const owner = await one("SELECT id FROM users WHERE id=? AND status='active' AND COALESCE(account_type,role)<>'client'", [ownerId]);
            if (!owner)
                return res.status(400).json({ error: 'Active internal account owner not found' });
        }
    }
    const sets=[]; const values=[];
    const add=(column,value)=>{sets.push(`${column}=?`); values.push(value);};
    if (parsed.data.name !== undefined) add('name', parsed.data.name);
    if (parsed.data.contactName !== undefined) add('contact_name', parsed.data.contactName || null);
    if (parsed.data.email !== undefined) add('email', parsed.data.email || null);
    if (parsed.data.phone !== undefined) add('phone', parsed.data.phone || null);
    if (parsed.data.industry !== undefined) add('industry', parsed.data.industry || null);
    if (parsed.data.accountOwnerUserId !== undefined) add('account_owner_user_id', ownerId);
    if (parsed.data.status !== undefined) add('status', parsed.data.status);
    let passwordHash = null;
    if (parsed.data.password) { passwordHash = await bcrypt.hash(parsed.data.password, 12); add('password_hash', passwordHash); }
    if (!sets.length)
        return res.status(400).json({ error: 'No changes supplied' });
    add('updated_at', new Date());
    await transaction(async connection => {
        await query(`UPDATE clients SET ${sets.join(',')} WHERE id=?`, [...values, req.params.id], connection);
        if (parsed.data.name !== undefined || parsed.data.contactName !== undefined || parsed.data.email !== undefined || parsed.data.phone !== undefined) {
            await query(`UPDATE users SET name=COALESCE(?,name),email=?,phone=?,updated_at=? WHERE client_id=?`,
                [parsed.data.contactName || parsed.data.name || null, parsed.data.email ?? client.email, parsed.data.phone ?? client.phone, new Date(), req.params.id], connection);
        }
        if (parsed.data.status !== undefined)
            await query('UPDATE users SET status=?,updated_at=? WHERE client_id=?', [parsed.data.status === 'active' ? 'active' : 'archived', new Date(), req.params.id], connection);
        if (passwordHash)
            await query('UPDATE users SET password_hash=?,updated_at=? WHERE client_id=?', [passwordHash, new Date(), req.params.id], connection);
        await audit(req.user.id, 'update', 'client', req.params.id,
            { ...parsed.data, password: parsed.data.password ? '[changed]' : undefined }, connection);
    });
    emitRefresh();
    res.json({ ok: true });
});
app.delete('/api/clients/:id', requireAuth, requirePermission('clients.delete'), async (req, res) => {
    const client = await one('SELECT * FROM clients WHERE id=?', [req.params.id]);
    if (!client)
        return res.status(404).json({ error: 'Client not found' });
    if (!canAccessClient(req.user, client))
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
app.post('/api/support-tickets', requireAuth, requirePermission('support.create'), async (req, res) => {
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
app.post('/api/support-tickets/bulk-delete', requireAuth, requirePermission('support.view_own', 'support.manage'), async (req, res) => {
    const parsed = z.object({ ticketNumbers: z.array(z.string().min(1)).min(1).max(100) }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const ticketNumbers = [...new Set(parsed.data.ticketNumbers)];
    const placeholders = ticketNumbers.map(() => '?').join(',');
    const rows = await query(`SELECT id,ticket_number,user_id,client_id FROM support_tickets WHERE ticket_number IN (${placeholders})`, ticketNumbers);
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
app.get('/api/support-tickets/:ticketNumber', requireAuth, requirePermission('support.view_own', 'support.view_all'), async (req, res) => {
    const ticket = await getTicketRow(req.params.ticketNumber);
    if (!ticket)
        return res.status(404).json({ error: 'Ticket not found' });
    if (!canAccessTicket(req.user, ticket))
        return res.status(403).json({ error: 'Ticket access denied' });
    res.json({ ticket: await ticketDetail(ticket) });
});
app.delete('/api/support-tickets/:ticketNumber/messages', requireAuth, requirePermission('support.manage'), async (req, res) => {
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
app.post('/api/support-tickets/:ticketNumber/replies', requireAuth, requirePermission('support.reply'), async (req, res) => {
    let rawBody = req.body;
    if (typeof rawBody === 'object' && rawBody !== null && typeof rawBody.body === 'object' && rawBody.body !== null) {
        rawBody = { ...rawBody.body, ...rawBody };
    }
    const schema = z.object({
        body: z.string().trim().max(5000).optional().or(z.literal('')),
        attachment: attachmentSchema.optional()
    });
    const parsed = schema.safeParse(rawBody);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    
    const messageBody = (parsed.data.body || '').trim();
    if (!messageBody && !parsed.data.attachment)
        return res.status(400).json({ error: 'Message body or attachment is required' });

    let attachment = null;
    try {
        attachment = prepareAttachment(parsed.data.attachment);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

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
        const messageInfo = await query('INSERT INTO support_ticket_messages (ticket_id,author_id,author_name,author_role,body,created_at) VALUES (?,?,?,?,?,?)',
            [ticket.id, user.id, user.name, user.accountType, messageBody || (attachment ? `Attachment: ${attachment.fileName}` : ''), now], connection);
        if (attachment) {
            await query('INSERT INTO support_ticket_attachments (ticket_id,message_id,file_name,mime_type,size_bytes,data_base64,created_at) VALUES (?,?,?,?,?,?,?)',
                [ticket.id, Number(messageInfo.insertId), attachment.fileName, attachment.mimeType, attachment.sizeBytes, attachment.dataBase64, now], connection);
        }
        await query('UPDATE support_tickets SET status=?,updated_at=? WHERE id=?', [nextStatus, now, ticket.id], connection);
        await audit(user.id, 'reply', 'support_ticket', ticket.ticket_number, { status: nextStatus, attachment: attachment?.fileName }, connection);
    });
    emitRefresh();
    res.status(201).json({ ticket: await ticketDetail(await getTicketRow(ticket.ticket_number)) });
});
app.patch('/api/support-tickets/:ticketNumber', requireAuth, requirePermission('support.manage'), async (req, res) => {
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
app.delete('/api/support-tickets/:ticketNumber', requireAuth, requirePermission('support.view_own', 'support.manage'), async (req, res) => {
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
app.get('/api/support-tickets/:ticketNumber/attachments/:attachmentId', requireAuth, requirePermission('support.view_own', 'support.view_all'), async (req, res) => {
    const row = await one(`SELECT a.*,t.ticket_number,t.user_id,t.client_id FROM support_ticket_attachments a JOIN support_tickets t ON t.id=a.ticket_id WHERE t.ticket_number=? AND a.id=?`,
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

app.get('/api/users', requireAuth, requirePermission('users.view', 'employees.view', 'employees.create', 'employees.edit'), async (req, res) => {
    const canViewUserAdmin = hasPermission(req.user, 'users.view');
    const clauses = [];
    const params = [];
    if (!canViewUserAdmin)
        clauses.push("COALESCE(u.account_type,u.role)='employee'");
    else if (!isSuperAdmin(req.user))
        clauses.push("COALESCE(u.account_type,u.role)<>'super_admin'");
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await query(`SELECT u.id,u.name,u.email,u.phone,u.account_type accountType,u.role_id roleId,u.client_id clientId,
        u.department_id departmentId,u.designation_id designationId,u.manager_user_id managerUserId,
        u.status,u.created_at createdAt,u.created_by createdBy,u.last_login lastLogin,
        r.name roleName,r.level roleLevel,d.name departmentName,ds.name designationName,m.name managerName,
        ep.employee_id employeeId,ep.joining_date joiningDate,
        pes.custom_duties customDuties,
        COALESCE(pes.weekly_capacity_hours, 48.00) weeklyCapacityHours,
        COALESCE(pes.productivity_status, 'active') productivityStatus,
        (SELECT COUNT(*) FROM jobs j WHERE j.assigned_to_user_id = u.id AND j.status != 'completed' AND j.status != 'cancelled') activeJobsCount
      FROM users u
      LEFT JOIN roles r ON r.id=u.role_id
      LEFT JOIN departments d ON d.id=u.department_id
      LEFT JOIN designations ds ON ds.id=u.designation_id
      LEFT JOIN users m ON m.id=u.manager_user_id
      LEFT JOIN employee_profiles ep ON ep.user_id=u.id
      LEFT JOIN productivity_employee_settings pes ON pes.user_id=u.id
      ${where}
      ORDER BY FIELD(u.account_type,'super_admin','admin','employee','client'),u.name`, params);
    res.json({ users: rows });
});

app.post('/api/users', requireAuth, requirePermission('users.create', 'employees.create'), async (req, res) => {
    const parsed = z.object({
        id: z.string().trim().regex(/^[a-zA-Z0-9._-]+$/),
        name: z.string().trim().min(2),
        email: z.string().trim().email().optional().or(z.literal('')),
        phone: z.string().trim().max(60).optional().or(z.literal('')),
        password: z.string().min(8),
        accountType: z.enum(['super_admin', 'admin', 'employee', 'client']),
        roleId: z.string().trim().optional().or(z.literal('')),
        clientId: z.string().trim().optional().or(z.literal('')),
        departmentId: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
        designationId: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
        managerUserId: z.string().trim().optional().or(z.literal('')),
        employeeId: z.string().trim().max(80).optional().or(z.literal('')),
        joiningDate: z.string().trim().optional().or(z.literal(''))
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const input = {
        ...parsed.data,
        roleId: parsed.data.roleId || (parsed.data.accountType === 'client' ? 'client' : parsed.data.accountType === 'super_admin' ? 'super_admin' : parsed.data.accountType === 'admin' ? 'admin' : 'employee')
    };
    if (!hasPermission(req.user, 'users.create') && input.accountType !== 'employee')
        return res.status(403).json({ error: 'Employee creation permission only allows Employee accounts' });
    if (input.accountType === 'super_admin' && !isSuperAdmin(req.user))
        return res.status(403).json({ error: 'Only Super Admin can create another Super Admin' });
    if (input.accountType === 'admin' && !isSuperAdmin(req.user))
        return res.status(403).json({ error: 'Only Super Admin can create Admin accounts' });
    if (await one('SELECT id FROM users WHERE id=?', [input.id]))
        return res.status(409).json({ error: 'User ID already exists' });
    if (input.email && await one('SELECT id FROM users WHERE email=?', [input.email]))
        return res.status(409).json({ error: 'Email is already used by another account' });
    if (input.employeeId && await one('SELECT user_id FROM employee_profiles WHERE employee_id=?', [input.employeeId]))
        return res.status(409).json({ error: 'Employee ID is already used by another employee' });
    const defaultRoleId = input.accountType === 'client' ? 'client' : input.accountType === 'super_admin' ? 'super_admin' : input.accountType === 'admin' ? 'admin' : 'employee';
    if (input.roleId !== defaultRoleId && !hasPermission(req.user, 'users.assign_role'))
        return res.status(403).json({ error: 'Role assignment permission required for custom employee roles' });
    const role = await one("SELECT * FROM roles WHERE id=? AND status='active'", [input.roleId]);
    if (!role)
        return res.status(400).json({ error: 'Active role not found' });
    if (role.id === 'super_admin' && input.accountType !== 'super_admin')
        return res.status(400).json({ error: 'Super Admin role requires a Super Admin account' });
    if (input.accountType === 'super_admin' && role.id !== 'super_admin')
        return res.status(400).json({ error: 'Super Admin accounts must use the Super Admin role' });
    if (!isSuperAdmin(req.user) && Number(role.level || 0) >= Number(req.user.roleLevel || 0))
        return res.status(403).json({ error: 'You cannot assign a role at or above your own level' });
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
                'active',
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

app.patch('/api/users/:id', requireAuth, requirePermission('users.edit', 'employees.edit'), async (req, res) => {
    const parsed = z.object({
        name: z.string().trim().min(2).optional(),
        email: z.string().trim().email().optional().or(z.literal('')),
        phone: z.string().trim().max(60).optional().or(z.literal('')),
        roleId: z.string().trim().min(1).optional(),
        departmentId: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
        designationId: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
        managerUserId: z.string().trim().optional().or(z.literal('')),
        status: z.enum(['active', 'archived']).optional(),
        password: z.string().min(8).optional().or(z.literal('')),
        employeeId: z.string().trim().max(80).optional().or(z.literal('')),
        joiningDate: z.string().trim().optional().or(z.literal(''))
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const current = await one('SELECT * FROM users WHERE id=?', [req.params.id]);
    if (!current)
        return res.status(404).json({ error: 'User not found' });
    if (current.account_type === 'super_admin' && !isSuperAdmin(req.user))
        return res.status(403).json({ error: 'Only Super Admin can modify Super Admin accounts' });
    const currentRole = await one('SELECT level FROM roles WHERE id=?', [current.role_id]);
    if (!isSuperAdmin(req.user) && current.id !== req.user.id && Number(currentRole?.level || 0) >= Number(req.user.roleLevel || 0))
        return res.status(403).json({ error: 'You cannot modify an equal or higher-level user' });
    if (!hasPermission(req.user, 'users.edit') && current.account_type !== 'employee')
        return res.status(403).json({ error: 'Employee edit permission cannot modify Admin or Client accounts' });
    if (parsed.data.email && await one('SELECT id FROM users WHERE email=? AND id<>?', [parsed.data.email, current.id]))
        return res.status(409).json({ error: 'Email is already used by another account' });
    if (parsed.data.status === 'archived' && current.account_type === 'super_admin') {
        const remaining = await one("SELECT COUNT(*) count FROM users WHERE status='active' AND account_type='super_admin' AND id<>?", [current.id]);
        if (Number(remaining?.count || 0) === 0)
            return res.status(409).json({ error: 'The final active Super Admin cannot be deactivated' });
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
        if (!isSuperAdmin(req.user) && Number(role.level || 0) >= Number(req.user.roleLevel || 0))
            return res.status(403).json({ error: 'You cannot assign a role at or above your own level' });
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
    const profileChangeRequested = current.account_type !== 'client' && (parsed.data.employeeId !== undefined || parsed.data.joiningDate !== undefined);
    if (!sets.length && !profileChangeRequested)
        return res.status(400).json({ error: 'No changes supplied' });
    assign('updated_at', new Date());
    if (parsed.data.employeeId) {
        const existingEmployeeId = await one('SELECT user_id FROM employee_profiles WHERE employee_id=? AND user_id<>?', [parsed.data.employeeId, current.id]);
        if (existingEmployeeId)
            return res.status(409).json({ error: 'Employee ID is already used by another employee' });
    }
    await transaction(async connection => {
        await query(`UPDATE users SET ${sets.join(',')} WHERE id=?`, [...values, current.id], connection);
        if (profileChangeRequested) {
            const existingProfile = await one('SELECT user_id,employee_id,joining_date FROM employee_profiles WHERE user_id=?', [current.id], connection);
            const employeeId = parsed.data.employeeId === undefined ? existingProfile?.employee_id || null : (parsed.data.employeeId || null);
            const joiningDate = parsed.data.joiningDate === undefined ? existingProfile?.joining_date || null : (parsed.data.joiningDate || null);
            await query(`INSERT INTO employee_profiles (user_id,employee_id,joining_date) VALUES (?,?,?)
                ON DUPLICATE KEY UPDATE employee_id=VALUES(employee_id),joining_date=VALUES(joining_date),updated_at=CURRENT_TIMESTAMP(3)`,
                [current.id, employeeId, joiningDate], connection);
        }
        await audit(req.user.id, 'update', 'user', current.id,
            { ...parsed.data, password: parsed.data.password ? '[changed]' : undefined }, connection);
    });
    emitRefresh();
    res.json({ user: await loadUserContext(current.id) });
});

app.get('/api/users/:id/permission-overrides', requireAuth, requirePermission('roles.manage_permissions'), async (req, res) => {
    const target = await one('SELECT id,account_type,role_id FROM users WHERE id=?', [req.params.id]);
    if (!target)
        return res.status(404).json({ error: 'User not found' });
    if (target.account_type === 'super_admin' && !isSuperAdmin(req.user))
        return res.status(403).json({ error: 'Only Super Admin can view Super Admin overrides' });
    const targetRole = await one('SELECT level FROM roles WHERE id=?', [target.role_id]);
    if (!isSuperAdmin(req.user) && Number(targetRole?.level || 0) >= Number(req.user.roleLevel || 0))
        return res.status(403).json({ error: 'You cannot view overrides for an equal or higher-level role' });
    const overrides = await query('SELECT permission_id permissionId,effect FROM user_permission_overrides WHERE user_id=? ORDER BY permission_id', [target.id]);
    const inheritedRows = await query('SELECT permission_id permissionId FROM role_permissions WHERE role_id=? ORDER BY permission_id', [target.role_id]);
    const targetContext = await loadUserContext(target.id);
    res.json({
        overrides,
        inheritedPermissions: inheritedRows.map(row => row.permissionId),
        effectivePermissions: targetContext?.permissions || [],
        allowedPermissionIds: target.account_type === 'client' ? [...clientSafePermissions] : null
    });
});

app.put('/api/users/:id/permission-overrides', requireAuth, requirePermission('roles.manage_permissions'), async (req, res) => {
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
    const targetRole = await one('SELECT level FROM roles WHERE id=?', [target.role_id]);
    if (!isSuperAdmin(req.user) && Number(targetRole?.level || 0) >= Number(req.user.roleLevel || 0))
        return res.status(403).json({ error: 'You cannot change permissions for an equal or higher-level role' });
    const grants = [...new Set(parsed.data.grants)];
    const revokes = [...new Set(parsed.data.revokes)].filter(permission => !grants.includes(permission));
    const grantValidation = await validatePermissionIds(grants, target.account_type === 'client' ? 'client' : 'internal');
    if (grantValidation.error)
        return res.status(400).json({ error: grantValidation.error });
    if (!isSuperAdmin(req.user)) {
        const excessive = grantValidation.permissionIds.find(permissionId => !hasPermission(req.user, permissionId));
        if (excessive)
            return res.status(403).json({ error: 'You cannot grant permissions you do not have' });
    }
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
    io.emit('permissions:updated', { at: new Date().toISOString() });
    emitRefresh();
    res.json({ ok: true });
});

app.get('/api/departments', requireAuth, requirePermission('departments.manage', 'employees.view', 'employees.create', 'employees.edit', 'users.view'), async (_req, res) => {
    const departments = await query('SELECT id,name,code,description,status,created_by createdBy,created_at createdAt,updated_at updatedAt FROM departments ORDER BY status,name');
    res.json({ departments });
});

app.post('/api/departments', requireAuth, requirePermission('departments.manage'), async (req, res) => {
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

app.patch('/api/departments/:id', requireAuth, requirePermission('departments.manage'), async (req, res) => {
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

app.get('/api/designations', requireAuth, requirePermission('designations.manage', 'employees.view', 'employees.create', 'employees.edit', 'users.view'), async (_req, res) => {
    const designations = await query('SELECT id,name,code,description,hierarchy_level hierarchyLevel,status,created_by createdBy,created_at createdAt,updated_at updatedAt FROM designations ORDER BY hierarchy_level DESC,name');
    res.json({ designations });
});

app.post('/api/designations', requireAuth, requirePermission('designations.manage'), async (req, res) => {
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

app.patch('/api/designations/:id', requireAuth, requirePermission('designations.manage'), async (req, res) => {
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

app.post('/api/rbac/roles', requireAuth, requirePermission('roles.create'), async (req, res) => {
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
    if (!isSuperAdmin(req.user) && Number(parsed.data.level || 0) >= Number(req.user.roleLevel || 0))
        return res.status(403).json({ error: 'You cannot create a role at or above your own level' });
    if (['super_admin', 'admin', 'employee', 'client'].includes(id))
        return res.status(409).json({ error: 'Protected system role already exists' });
    if (await one('SELECT id FROM roles WHERE id=? OR slug=?', [id, id]))
        return res.status(409).json({ error: 'Role already exists' });
    const validation = await validatePermissionIds(parsed.data.permissions, parsed.data.roleType);
    if (validation.error)
        return res.status(400).json({ error: validation.error });
    if (!isSuperAdmin(req.user)) {
        const excessive = validation.permissionIds.find(permissionId => !hasPermission(req.user, permissionId));
        if (excessive)
            return res.status(403).json({ error: 'You cannot add permissions you do not have to a role' });
    }
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

app.patch('/api/rbac/roles/:id', requireAuth, requirePermission('roles.edit'), async (req, res) => {
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
    if (!isSuperAdmin(req.user) && Number(role.level || 0) >= Number(req.user.roleLevel || 0))
        return res.status(403).json({ error: 'You cannot edit an equal or higher-level role' });
    if (!isSuperAdmin(req.user) && parsed.data.level !== undefined && Number(parsed.data.level) >= Number(req.user.roleLevel || 0))
        return res.status(403).json({ error: 'You cannot raise a role to your own level or higher' });
    if (role.is_system && !isSuperAdmin(req.user))
        return res.status(403).json({ error: 'Only Super Admin can edit protected system roles' });
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

app.get('/api/rbac/roles', requireAuth, requirePermission('roles.view'), async (req, res) => {
    const roles = isSuperAdmin(req.user)
        ? await query(`SELECT id,name,slug,description,level,role_type roleType,is_system isSystem,status,created_at createdAt,updated_at updatedAt
            FROM roles ORDER BY level DESC,name`)
        : await query(`SELECT id,name,slug,description,level,role_type roleType,is_system isSystem,status,created_at createdAt,updated_at updatedAt
            FROM roles WHERE id<>'super_admin' AND level<? ORDER BY level DESC,name`, [Number(req.user.roleLevel || 0)]);
    const rolePermissionRows = await query('SELECT role_id roleId,permission_id permissionId FROM role_permissions');
    const grouped = rolePermissionRows.reduce((map, row) => {
        map[row.roleId] = [...(map[row.roleId] || []), row.permissionId];
        return map;
    }, {});
    res.json({ roles: roles.map(role => ({ ...role, permissions: grouped[role.id] || [] })) });
});

app.get('/api/rbac/permissions', requireAuth, requirePermission('roles.view', 'roles.manage_permissions'), async (req, res) => {
    const permissions = isSuperAdmin(req.user)
        ? await query('SELECT id,module,action,label,description FROM permissions ORDER BY module,action')
        : await query(`SELECT id,module,action,label,description FROM permissions
            WHERE id IN (${req.user.permissions.map(() => '?').join(',') || "''"}) ORDER BY module,action`, req.user.permissions);
    res.json({ permissions });
});

app.put('/api/rbac/roles/:id/permissions', requireAuth, requirePermission('roles.manage_permissions'), async (req, res) => {
    const parsed = z.object({ permissions: z.array(z.string().min(1)).default([]) }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const role = await one('SELECT * FROM roles WHERE id=?', [req.params.id]);
    if (!role)
        return res.status(404).json({ error: 'Role not found' });
    if (role.id === 'super_admin')
        return res.status(403).json({ error: 'Super Admin permissions are protected' });
    if (role.is_system && !isSuperAdmin(req.user))
        return res.status(403).json({ error: 'Only Super Admin can edit protected system role permissions' });
    const validation = await validatePermissionIds(parsed.data.permissions, role.role_type);
    if (validation.error)
        return res.status(400).json({ error: validation.error });
    const permissionIds = validation.permissionIds;
    if (!isSuperAdmin(req.user)) {
        if (Number(role.level || 0) >= Number(req.user.roleLevel || 0))
            return res.status(403).json({ error: 'You cannot manage permissions for an equal or higher-level role' });
        const excessive = permissionIds.find(permissionId => !hasPermission(req.user, permissionId));
        if (excessive)
            return res.status(403).json({ error: 'You cannot grant permissions you do not have' });
    }
    await transaction(async connection => {
        await query('DELETE FROM role_permissions WHERE role_id=?', [role.id], connection);
        for (const permissionId of permissionIds)
            await query('INSERT INTO role_permissions (role_id,permission_id) VALUES (?,?)', [role.id, permissionId], connection);
        await audit(req.user.id, 'update_permissions', 'role', role.id, { permissions: permissionIds }, connection);
    });
    io.emit('permissions:updated', { at: new Date().toISOString() });
    emitRefresh();
    res.json({ ok: true });
});

// --- TEAM CHAT API ---
const mapChatMessage = row => ({
    id: row.id,
    channelId: row.channel_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    senderRole: row.sender_role,
    body: row.body,
    attachmentName: row.attachment_name,
    attachmentType: row.attachment_type,
    attachmentSize: row.attachment_size,
    attachmentData: row.attachment_data,
    createdAt: row.created_at
});

app.get('/api/chat/channels', requireAuth, requirePermission('chat.view'), async (req, res) => {
    const channels = await query(`
        SELECT c.*,
            (SELECT COUNT(*) FROM chat_messages m WHERE m.channel_id = c.id) AS messageCount,
            (SELECT m.created_at FROM chat_messages m WHERE m.channel_id = c.id ORDER BY m.id DESC LIMIT 1) AS lastMessageAt,
            (SELECT m.body FROM chat_messages m WHERE m.channel_id = c.id ORDER BY m.id DESC LIMIT 1) AS lastMessageBody,
            (SELECT m.sender_name FROM chat_messages m WHERE m.channel_id = c.id ORDER BY m.id DESC LIMIT 1) AS lastMessageSender
        FROM chat_channels c
        ORDER BY c.created_at ASC
    `);
    const users = await query(`
        SELECT id, name, COALESCE(account_type, role) AS role, client_id AS clientId, status
        FROM users
        WHERE status = 'active'
        ORDER BY name ASC
    `);
    res.json({
        channels: channels.map(c => ({
            id: c.id,
            name: c.name,
            description: c.description,
            type: c.type,
            createdBy: c.created_by,
            createdAt: c.created_at,
            messageCount: Number(c.messageCount || 0),
            lastMessage: c.lastMessageAt ? {
                at: c.lastMessageAt,
                body: c.lastMessageBody,
                sender: c.lastMessageSender
            } : null
        })),
        members: users.map(u => ({
            id: u.id,
            name: u.name,
            role: u.role,
            status: u.status
        }))
    });
});

app.post('/api/chat/channels', requireAuth, requirePermission('chat.manage'), async (req, res) => {
    const parsed = z.object({
        name: z.string().trim().min(2).max(100).regex(/^[a-z0-9-_]+$/i, 'Channel name must contain only letters, numbers, hyphens or underscores'),
        description: z.string().trim().max(500).default(''),
        type: z.enum(['public', 'private', 'direct']).default('public')
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const channelId = parsed.data.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const existing = await one('SELECT id FROM chat_channels WHERE id=?', [channelId]);
    if (existing)
        return res.status(409).json({ error: 'A channel with this name already exists' });
    await query(
        'INSERT INTO chat_channels (id, name, description, type, created_by) VALUES (?, ?, ?, ?, ?)',
        [channelId, parsed.data.name.toLowerCase(), parsed.data.description, parsed.data.type, req.user.id]
    );
    const newChannel = {
        id: channelId,
        name: parsed.data.name.toLowerCase(),
        description: parsed.data.description,
        type: parsed.data.type,
        createdBy: req.user.id,
        createdAt: new Date().toISOString(),
        messageCount: 0,
        lastMessage: null
    };
    await audit(req.user.id, 'create_channel', 'chat_channel', channelId, parsed.data);
    io.emit('chat:channel_created', newChannel);
    emitRefresh();
    res.status(201).json({ channel: newChannel });
});

app.get('/api/chat/channels/:channelId/messages', requireAuth, requirePermission('chat.view'), async (req, res) => {
    let channel = await one('SELECT id FROM chat_channels WHERE id=?', [req.params.channelId]);
    if (!channel && req.params.channelId.startsWith('dm-')) {
        await query(
            'INSERT IGNORE INTO chat_channels (id, name, description, type, created_by) VALUES (?, ?, ?, ?, ?)',
            [req.params.channelId, req.params.channelId, 'Direct Message', 'direct', req.user.id]
        );
        channel = { id: req.params.channelId };
    }
    if (!channel)
        return res.status(404).json({ error: 'Channel not found' });
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));
    const rows = await query(
        `SELECT * FROM chat_messages WHERE channel_id=? ORDER BY id DESC LIMIT ?`,
        [req.params.channelId, limit]
    );
    res.json({
        messages: rows.reverse().map(mapChatMessage)
    });
});

app.post('/api/chat/channels/:channelId/messages', requireAuth, requirePermission('chat.send'), async (req, res) => {
    let channel = await one('SELECT id FROM chat_channels WHERE id=?', [req.params.channelId]);
    if (!channel && req.params.channelId.startsWith('dm-')) {
        await query(
            'INSERT IGNORE INTO chat_channels (id, name, description, type, created_by) VALUES (?, ?, ?, ?, ?)',
            [req.params.channelId, req.params.channelId, 'Direct Message', 'direct', req.user.id]
        );
        channel = { id: req.params.channelId };
    }
    if (!channel)
        return res.status(404).json({ error: 'Channel not found' });
    const parsed = z.object({
        body: z.string().trim().max(10000).default(''),
        attachment: z.object({
            name: z.string().min(1).max(500),
            type: z.string().min(1).max(255),
            size: z.number().int().nonnegative().max(15 * 1024 * 1024),
            data: z.string().min(1)
        }).nullable().optional()
    }).refine(data => data.body.length > 0 || !!data.attachment, {
        message: 'Message body or attachment is required'
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const { body, attachment } = parsed.data;
    const senderRole = req.user.roleName || req.user.accountType || req.user.role || 'Member';
    const result = await query(
        `INSERT INTO chat_messages (channel_id, sender_id, sender_name, sender_role, body, attachment_name, attachment_type, attachment_size, attachment_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            req.params.channelId,
            req.user.id,
            req.user.name,
            senderRole,
            body,
            attachment ? attachment.name : null,
            attachment ? attachment.type : null,
            attachment ? attachment.size : null,
            attachment ? attachment.data : null
        ]
    );
    const newMessage = {
        id: result.insertId,
        channelId: req.params.channelId,
        senderId: req.user.id,
        senderName: req.user.name,
        senderRole,
        body,
        attachmentName: attachment ? attachment.name : null,
        attachmentType: attachment ? attachment.type : null,
        attachmentSize: attachment ? attachment.size : null,
        attachmentData: attachment ? attachment.data : null,
        createdAt: new Date().toISOString()
    };
    io.emit('chat:message', newMessage);
    res.status(201).json({ message: newMessage });
});

app.delete('/api/chat/messages/:id', requireAuth, async (req, res) => {
    const message = await one('SELECT * FROM chat_messages WHERE id=?', [req.params.id]);
    if (!message)
        return res.status(404).json({ error: 'Message not found' });
    const canDelete = hasPermission(req.user, 'chat.manage') || message.sender_id === req.user.id;
    if (!canDelete)
        return res.status(403).json({ error: 'You do not have permission to delete this message' });
    await query('DELETE FROM chat_messages WHERE id=?', [req.params.id]);
    io.emit('chat:message_deleted', { id: Number(req.params.id), channelId: message.channel_id });
    res.json({ ok: true });
});

app.post('/api/chat/channels/:channelId/clear', requireAuth, requirePermission('chat.manage'), async (req, res) => {
    const channel = await one('SELECT id FROM chat_channels WHERE id=?', [req.params.channelId]);
    if (!channel)
        return res.status(404).json({ error: 'Channel not found' });
    await query('DELETE FROM chat_messages WHERE channel_id=?', [req.params.channelId]);
    await audit(req.user.id, 'clear_channel', 'chat_channel', req.params.channelId, {});
    io.emit('chat:cleared', { channelId: req.params.channelId });
    res.json({ ok: true });
});

app.get('/api/audit-logs', requireAuth, requirePermission('audit.view'), async (_req, res) => {
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

app.use('/api/productivity', requireAuth, createProductivityRouter(io));
const publicDir = [
    path.resolve(__dirname, 'public'),
    path.resolve(__dirname, '../public'),
    path.resolve(__dirname, '../dist/public'),
    path.resolve(__dirname, '../../client/dist'),
    path.resolve(__dirname, '../client/dist'),
    path.resolve(process.cwd(), 'client/dist'),
    path.resolve(process.cwd(), 'server/dist/public'),
    path.resolve(process.cwd(), 'dist/public'),
    path.resolve(process.cwd(), 'public')
].find(candidate => candidate && fs.existsSync(path.join(candidate, 'index.html')));

if (publicDir) {
    console.log(`[CI360] Serving frontend static build from: ${publicDir}`);
    app.use(express.static(publicDir));
    app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/socket.io'))
            return next();
        res.sendFile(path.join(publicDir, 'index.html'));
    });
} else {
    console.warn('[CI360] Warning: No frontend build directory with index.html found. Checked candidates around:', process.cwd());
    app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/socket.io'))
            return next();
        res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CI360degrees — Realtime Job Board</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #071F5C; color: #FFFFFF; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; text-align: center; }
    .card { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 16px; padding: 36px 32px; max-width: 480px; backdrop-filter: blur(10px); }
    h1 { margin: 0 0 8px; font-size: 24px; }
    .brand-gold { color: #F2A900; }
    p { color: #E9EDEF; font-size: 14px; line-height: 1.5; margin: 12px 0 20px; }
    .btn { display: inline-block; background: #F2A900; color: #071F5C; font-weight: 700; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>CI360<span class="brand-gold">degrees</span></h1>
    <p>API Server is running successfully. The frontend client bundle is building or deploying. If this screen persists, run <code>npm run build</code>.</p>
    <a href="/api/health" class="btn">Check System Health</a>
  </div>
</body>
</html>`);
    });
}
io.on('connection', socket => {
    socket.emit('connected', { at: new Date().toISOString() });
    socket.on('chat:typing', data => {
        socket.broadcast.emit('chat:typing', data);
    });
    socket.on('chat:stop_typing', data => {
        socket.broadcast.emit('chat:stop_typing', data);
    });
});
app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message });
});
const port = Number(process.env.PORT || 4000);
httpServer.listen(port, '0.0.0.0', () => console.log(`CI360 API running on port ${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, async () => {
        await pool.end();
        httpServer.close(() => process.exit(0));
    });
}
