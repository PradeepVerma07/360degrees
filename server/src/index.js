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
import { pool, query, one, transaction, initialiseDatabase, audit } from './db.js';
import { requireAdmin, requireAuth, signToken } from './auth.js';
import { calculateHours } from './tat.js';
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
app.use(helmet());
app.use(cors({ origin }));
app.use(express.json({ limit: '20mb' }));
const emitRefresh = () => io.emit('data:changed', { at: new Date().toISOString() });
const settings = async () => JSON.parse((await one('SELECT json FROM settings WHERE id=1')).json);
const categoryLoad = async () => {
    const rows = await query("SELECT category,COUNT(*) count FROM jobs WHERE status!='completed' AND status!='cancelled' GROUP BY category");
    return Object.fromEntries(rows.map(row => [row.category, row.count]));
};
const mapJob = (row) => ({
    id: row.id, clientId: row.client_id, title: row.title, description: row.description, category: row.category,
    priority: row.priority, postedBy: row.posted_by, assetLink: row.asset_link, calculatedHours: row.calculated_hours,
    teamOverrideHours: row.team_override_hours, teamOverrideNote: row.team_override_note, status: row.status,
    datePosted: row.date_posted, dateCompleted: row.date_completed, updatedAt: row.updated_at
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
const canAccessTicket = (user, ticket) => user.role === 'admin' || ticket.user_id === user.id;
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
app.post('/api/auth/login', async (req, res) => {
    const parsed = z.object({ id: z.string().min(1), password: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: 'ID and password are required' });
    const user = await one("SELECT * FROM users WHERE id=? AND status='active'", [parsed.data.id]);
    if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash)))
        return res.status(401).json({ error: 'Incorrect ID or password' });
    const authUser = { id: user.id, name: user.name, role: user.role, clientId: user.client_id };
    res.json({ token: signToken(authUser), user: authUser });
});
app.get('/api/bootstrap', requireAuth, async (req, res) => {
    const user = req.user;
    const jobRows = user.role === 'admin'
        ? await query('SELECT * FROM jobs ORDER BY date_posted DESC')
        : await query('SELECT * FROM jobs WHERE client_id=? ORDER BY date_posted DESC', [user.clientId]);
    const clients = user.role === 'admin' ? await query("SELECT id,name,status,created_at createdAt FROM clients ORDER BY name") : [];
    const ticketRows = user.role === 'admin'
        ? await query('SELECT * FROM support_tickets ORDER BY updated_at DESC,id DESC')
        : await query('SELECT * FROM support_tickets WHERE user_id=? ORDER BY updated_at DESC,id DESC', [user.id]);
    res.json({ user, jobs: jobRows.map(mapJob), clients, supportTickets: ticketRows.map(mapTicket), settings: await settings(), categoryLoad: await categoryLoad() });
});
app.post('/api/jobs', requireAuth, async (req, res) => {
    const schema = z.object({ clientId: z.string().optional(), title: z.string().min(2), description: z.string().default(''), category: z.string().min(1), priority: z.enum(['Low', 'Medium', 'High', 'Urgent']), postedBy: z.string().min(2), assetLink: z.string().default('') });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const user = req.user;
    const clientId = user.role === 'admin' ? parsed.data.clientId : user.clientId;
    if (!clientId)
        return res.status(400).json({ error: 'Client is required' });
    const client = await one("SELECT id FROM clients WHERE id=? AND status='active'", [clientId]);
    if (!client)
        return res.status(400).json({ error: 'Active client not found' });
    const id = 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const now = new Date().toISOString();
    const calculatedHours = calculateHours(await settings(), await categoryLoad(), parsed.data.category, parsed.data.priority);
    await query(`INSERT INTO jobs (id,client_id,title,description,category,priority,posted_by,asset_link,calculated_hours,status,date_posted,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'submitted',?,?)`, [id, clientId, parsed.data.title, parsed.data.description, parsed.data.category, parsed.data.priority, parsed.data.postedBy, parsed.data.assetLink, calculatedHours, now, now]);
    await audit(user.id, 'create', 'job', id, parsed.data);
    emitRefresh();
    res.status(201).json({ job: mapJob(await one('SELECT * FROM jobs WHERE id=?', [id])) });
});
app.patch('/api/jobs/:id', requireAuth, requireAdmin, async (req, res) => {
    const schema = z.object({ title: z.string().min(2).optional(), description: z.string().optional(), category: z.string().optional(), priority: z.enum(['Low', 'Medium', 'High', 'Urgent']).optional(), status: z.enum(['submitted', 'under_review', 'in_progress', 'waiting_client', 'revision_requested', 'on_hold', 'completed', 'cancelled']).optional(), assetLink: z.string().optional(), teamOverrideHours: z.number().positive().nullable().optional(), teamOverrideNote: z.string().optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const current = await one('SELECT * FROM jobs WHERE id=?', [req.params.id]);
    if (!current)
        return res.status(404).json({ error: 'Job not found' });
    const map = { title: 'title', description: 'description', category: 'category', priority: 'priority', status: 'status', assetLink: 'asset_link', teamOverrideHours: 'team_override_hours', teamOverrideNote: 'team_override_note' };
    const entries = Object.entries(parsed.data);
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
    await query(`UPDATE jobs SET ${sets.join(',')} WHERE id=?`, [...values, req.params.id]);
    await audit(req.user.id, 'update', 'job', req.params.id, parsed.data);
    emitRefresh();
    res.json({ job: mapJob(await one('SELECT * FROM jobs WHERE id=?', [req.params.id])) });
});
app.put('/api/settings', requireAuth, requireAdmin, async (req, res) => {
    const schema = z.object({ categories: z.array(z.object({ name: z.string().min(1), baseHours: z.number().positive() })).min(1), capacityPerCategory: z.number().int().positive(), bufferHoursPerExtraJob: z.number().nonnegative(), startHour: z.number().min(0).max(24), endHour: z.number().min(0).max(24), workDays: z.array(z.number().int().min(0).max(6)).min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    await query('UPDATE settings SET json=? WHERE id=1', [JSON.stringify(parsed.data)]);
    await audit(req.user.id, 'update', 'settings', '1', parsed.data);
    emitRefresh();
    res.json({ settings: parsed.data });
});
app.post('/api/clients', requireAuth, requireAdmin, async (req, res) => {
    const parsed = z.object({ id: z.string().regex(/^[a-z0-9_-]+$/), name: z.string().min(2), password: z.string().min(6) }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    if (await one('SELECT id FROM clients WHERE id=?', [parsed.data.id]))
        return res.status(409).json({ error: 'Client ID already exists' });
    const hash = await bcrypt.hash(parsed.data.password, 12);
    await transaction(async connection => {
        await query('INSERT INTO clients (id,name,password_hash) VALUES (?,?,?)', [parsed.data.id, parsed.data.name, hash], connection);
        await query("INSERT INTO users (id,name,password_hash,role,client_id) VALUES (?,?,?,'client',?)", [parsed.data.id, parsed.data.name, hash, parsed.data.id], connection);
    });
    await audit(req.user.id, 'create', 'client', parsed.data.id, { name: parsed.data.name });
    emitRefresh();
    res.status(201).json({ ok: true });
});
app.patch('/api/clients/:id', requireAuth, requireAdmin, async (req, res) => {
    const parsed = z.object({ name: z.string().min(2).optional(), password: z.string().min(6).optional(), status: z.enum(['active', 'archived']).optional() }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.issues[0].message });
    const client = await one('SELECT * FROM clients WHERE id=?', [req.params.id]);
    if (!client)
        return res.status(404).json({ error: 'Client not found' });
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
app.delete('/api/clients/:id', requireAuth, requireAdmin, async (req, res) => {
    const client = await one('SELECT * FROM clients WHERE id=?', [req.params.id]);
    if (!client)
        return res.status(404).json({ error: 'Client not found' });
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
app.post('/api/support-tickets', requireAuth, async (req, res) => {
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
            [ticketId, user.id, user.name, user.role, parsed.data.description, now], connection);
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
app.post('/api/support-tickets/bulk-delete', requireAuth, async (req, res) => {
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
app.get('/api/support-tickets/:ticketNumber', requireAuth, async (req, res) => {
    const ticket = await getTicketRow(req.params.ticketNumber);
    if (!ticket)
        return res.status(404).json({ error: 'Ticket not found' });
    if (!canAccessTicket(req.user, ticket))
        return res.status(403).json({ error: 'Ticket access denied' });
    res.json({ ticket: await ticketDetail(ticket) });
});
app.delete('/api/support-tickets/:ticketNumber/messages', requireAuth, async (req, res) => {
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
app.post('/api/support-tickets/:ticketNumber/replies', requireAuth, async (req, res) => {
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
    const nextStatus = user.role === 'admin'
        ? (ticket.status === 'Open' ? 'In Progress' : ticket.status)
        : (ticket.status === 'Waiting for User' || ticket.status === 'Resolved' ? 'Open' : ticket.status);
    await transaction(async connection => {
        await query('INSERT INTO support_ticket_messages (ticket_id,author_id,author_name,author_role,body,created_at) VALUES (?,?,?,?,?,?)',
            [ticket.id, user.id, user.name, user.role, parsed.data.body, now], connection);
        await query('UPDATE support_tickets SET status=?,updated_at=? WHERE id=?', [nextStatus, now, ticket.id], connection);
        await audit(user.id, 'reply', 'support_ticket', ticket.ticket_number, { status: nextStatus }, connection);
    });
    emitRefresh();
    res.status(201).json({ ticket: await ticketDetail(await getTicketRow(ticket.ticket_number)) });
});
app.patch('/api/support-tickets/:ticketNumber', requireAuth, requireAdmin, async (req, res) => {
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
app.delete('/api/support-tickets/:ticketNumber', requireAuth, async (req, res) => {
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
app.get('/api/support-tickets/:ticketNumber/attachments/:attachmentId', requireAuth, async (req, res) => {
    const row = await one(`SELECT a.*,t.ticket_number,t.user_id FROM support_ticket_attachments a JOIN support_tickets t ON t.id=a.ticket_id WHERE t.ticket_number=? AND a.id=?`,
        [req.params.ticketNumber, req.params.attachmentId]);
    if (!row)
        return res.status(404).json({ error: 'Attachment not found' });
    if (req.user.role !== 'admin' && row.user_id !== req.user.id)
        return res.status(403).json({ error: 'Attachment access denied' });
    const bytes = Buffer.from(row.data_base64, 'base64');
    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Content-Disposition', `attachment; filename="${String(row.file_name).replace(/"/g, '')}"`);
    res.send(bytes);
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
