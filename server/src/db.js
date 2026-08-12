import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { permissions, rolePermissions, roles } from './permissionCatalog.js';

const configuredDbHost = (process.env.DB_HOST || '127.0.0.1').trim();
const dbHost = configuredDbHost === 'localhost' ? '127.0.0.1' : configuredDbHost;
const dbSocketPath = (process.env.DB_SOCKET_PATH || (configuredDbHost === 'localhost' ? '/var/lib/mysql/mysql.sock' : '')).trim();
const dbConnectionTarget = dbSocketPath
  ? { socketPath: dbSocketPath }
  : { host: dbHost, port: Number(process.env.DB_PORT || 3306) };

export const pool = mysql.createPool({
  ...dbConnectionTarget,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'ci360_realtime',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: 'Z',
  dateStrings: true,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

export const defaultSettings = {
  categories: [
    { name: 'Website Changes', baseHours: 24 },
    { name: 'Social Media', baseHours: 24 },
    { name: 'Media Uploads', baseHours: 6 },
    { name: 'Graphic Design', baseHours: 48 },
    { name: 'Copywriting', baseHours: 48 },
    { name: 'Video Editing', baseHours: 72 },
    { name: 'SEO / Web Content', baseHours: 48 },
    { name: 'Other', baseHours: 48 }
  ],
  capacityPerCategory: 2,
  bufferHoursPerExtraJob: 8,
  startHour: 10.5,
  endHour: 19,
  workDays: [1, 2, 3, 4, 5],
  assignmentAcceptanceMinutes: 240,
  assignmentReminderMinutes: 60,
  enableAutoAssignment: true,
  skipOverworked: true,
  maxAutoAssignmentUtilization: 115,
  allowDepartmentClaim: true,
  allowClientPreferredEmployee: true
};

const productivityServiceSeedRows = [
  ['Website full build', 80],
  ['Connector Apps / Small Web Additions', 18],
  ['Social Media Optimisation', 16],
  ['Design', 10],
  ['Standees / Backdrops / Advertisements', 12],
  ['Films & Edits', 30],
  ['Animation / Motion Graphics', 36],
  ['Reels & Shorts', 8],
  ['Podcasts', 14],
  ['Strategy & Presentations', 16],
  ['Business Development', 10],
  ['Paper Advertisement Design', 10],
  ['Other Design Interventions', 12],
  ['Photography / Filming', 24]
];

const productivityPersonnelSeeds = [
  { name: 'Pramit', duties: 'Founder, Strategy, Business Development, Content Management', capacity: 48, status: 'active' },
  { name: 'Aashit', duties: 'Founder, Business Development, Finance', capacity: 48, status: 'active' },
  { name: 'Urna', duties: 'COO, CS, Content, Operations, Billing, Overall Supervision', capacity: 48, status: 'active' },
  { name: 'Mansi', duties: 'Strategy, BD, Content, Backup to Pramit, CS', capacity: 48, status: 'active' },
  { name: 'Chitra', duties: 'CS, SMO', capacity: 48, status: 'active' },
  { name: 'Arushi', duties: 'SMO', capacity: 48, status: 'active' },
  { name: 'Manan', duties: 'CS, Creative Lead', capacity: 48, status: 'active' },
  { name: 'Mary', duties: 'Creatives, Animations, AI, Editing of Reels etc, Storytelling', capacity: 48, status: 'active' },
  { name: 'Ajay', duties: 'Editing', capacity: 48, status: 'active' },
  { name: 'Aarya', duties: 'Graphics, Creative', capacity: 48, status: 'active' },
  { name: 'Aadya', duties: 'Graphics, Creative', capacity: 48, status: 'active' },
  { name: 'John', duties: 'Websites - All of them, Quality Control', capacity: 48, status: 'active' },
  { name: 'Meshwa', duties: 'Website Support', capacity: 48, status: 'active' },
  { name: 'Dhawal', duties: 'Not currently functioning - part of the team', capacity: 48, status: 'inactive' },
  { name: 'Ekta', duties: 'Accounts', capacity: 48, status: 'active' },
  { name: 'Khushi', duties: 'Operations (intern, just joined)', capacity: 48, status: 'intern' },
  { name: 'Reehan', duties: 'Websites - part of (intern)', capacity: 48, status: 'intern' },
  { name: 'Pradeep', duties: 'Websites', capacity: 48, status: 'active' },
  { name: 'Harshada', duties: 'SEO', capacity: 48, status: 'active' },
  { name: 'Arjun', duties: 'Business Development, Prospect Pitching', capacity: 48, status: 'active' },
  { name: 'Shalini', duties: 'Business Development, Prospect Pitching', capacity: 48, status: 'active' },
  { name: 'External', duties: 'SEO and other requirements, as needed', capacity: 48, status: 'vendor' }
];

const productivityClientRosterSeeds = [
  { clientName: 'Vardan', nature: 'Existing', difficulty: 5, comments: 'Maintenance', roles: { strategy: 'Urna', cs: 'Urna', website: 'John', design: 'Mary', copy: 'Urna', edit: 'Manan', shoot: '', seo: 'Harshada', smo: 'Arushi', qc: 'John' } },
  { clientName: 'Shatayu', nature: 'Existing', difficulty: 4, comments: 'Maintenance', roles: { strategy: 'Urna', cs: 'Chitra', website: 'John', design: 'Mary', copy: 'Chitra, Urna', edit: 'Mary', shoot: '', seo: '', smo: 'Chitra', qc: 'John' } },
  { clientName: 'Crave', nature: 'Existing', difficulty: 4, comments: 'Maintenance', roles: { strategy: 'Urna', cs: 'Chitra', website: '', design: 'Aadya', copy: 'Chitra, Urna', edit: 'Mary', shoot: '', seo: '', smo: 'Chitra', qc: 'John' } },
  { clientName: 'VNA', nature: 'Existing', difficulty: 8, comments: 'Website work needs a lot of work as does Reels and content', roles: { strategy: 'Pramit', cs: 'Mansi', website: 'John', design: 'Aarya', copy: 'Pramit, Mansi', edit: 'Ajay', shoot: 'External', seo: 'Harshada', smo: 'Arushi', qc: 'John' } },
  { clientName: 'Shree Sawa', nature: 'Existing', difficulty: 6, comments: 'Website needs to be completed in 3 weeks', roles: { strategy: 'Mansi', cs: 'Mansi', website: 'John', design: 'Aadya', copy: 'Mansi, Chitra', edit: 'External', shoot: 'External', seo: '', smo: 'Arushi', qc: 'John' } },
  { clientName: 'Thehrav', nature: 'Existing', difficulty: 4, comments: 'Occasional', roles: { strategy: 'Mansi', cs: 'Mansi', website: '', design: '', copy: 'Pramit', edit: 'Manan', shoot: 'External', seo: '', smo: 'Arushi', qc: 'John' } },
  { clientName: 'LEOZ', nature: 'Existing', difficulty: 6, comments: 'Need to change the website for payment to be made', roles: { strategy: 'Pramit, Mansi', cs: 'Pramit', website: 'John', design: '', copy: '', edit: '', shoot: '', seo: '', smo: '', qc: 'John' } },
  { clientName: 'PIV', nature: 'Existing', difficulty: 9, comments: 'This will bring in huge pressures with time - loads of shoots, strategy and event', roles: { strategy: 'Pramit', cs: 'Mansi', website: 'John, External', design: 'Aarya, Manan', copy: 'Pramit, Mansi', edit: 'Ajay', shoot: 'External', seo: 'Harshada', smo: 'Arushi', qc: 'John' } },
  { clientName: 'Chaitanya', nature: 'Existing', difficulty: 7, comments: 'This is also a high pressure time consuming account', roles: { strategy: 'Mansi', cs: 'Chitra', website: 'John', design: 'Aarya', copy: 'Chitra', edit: 'Ajay', shoot: 'External', seo: 'Harshada', smo: 'Arushi', qc: 'John' } },
  { clientName: 'Media Buzz', nature: 'Existing', difficulty: 6, comments: 'This is for our sister company', roles: { strategy: 'Chitra', cs: 'Chitra', website: 'John', design: 'Mary', copy: 'Chitra', edit: 'Mary', shoot: 'External', seo: '', smo: 'Chitra', qc: 'John' } },
  { clientName: 'Times Abroad', nature: 'Existing', difficulty: 3, comments: 'Ongoing', roles: { strategy: 'Mansi, Pramit', cs: 'Mansi', website: '', design: 'Aadya', copy: 'Pramit, Mansi', edit: '', shoot: '', seo: '', smo: 'Arushi', qc: 'John' } },
  { clientName: 'Times Property', nature: 'Existing', difficulty: 4, comments: 'Ongoing', roles: { strategy: 'Mansi', cs: 'Mansi', website: '', design: 'Manan', copy: 'Mansi', edit: '', shoot: '', seo: '', smo: 'Arushi', qc: 'John' } },
  { clientName: 'Times MSME', nature: 'Existing', difficulty: 8, comments: 'Yet to launch', roles: { strategy: 'Mansi', cs: 'Mansi', website: '', design: 'Manan', copy: 'Mansi', edit: '', shoot: '', seo: '', smo: 'Arushi', qc: 'John' } },
  { clientName: 'Times Mike Drop', nature: 'Existing', difficulty: 8, comments: 'Yet to launch', roles: { strategy: 'Mansi', cs: 'Mansi', website: '', design: 'Manan', copy: 'Pramit, Mansi', edit: '', shoot: '', seo: '', smo: 'Arushi', qc: 'John' } },
  { clientName: 'Ananta', nature: 'Existing', difficulty: 7, comments: 'Website just launched - high pressure', roles: { strategy: 'Urna', cs: 'Urna', website: 'John', design: 'Manan', copy: 'Urna', edit: 'Ajay', shoot: '', seo: '', smo: 'Arushi', qc: 'John' } },
  { clientName: 'Ananta Aspen', nature: 'Existing', difficulty: 7, comments: 'Website just launched - high pressure', roles: { strategy: 'Urna', cs: 'Urna', website: 'John', design: 'Manan', copy: 'Urna', edit: 'Ajay', shoot: '', seo: '', smo: 'Arushi', qc: 'John' } },
  { clientName: 'IUF', nature: 'Existing', difficulty: 2, comments: 'Website launched', roles: { strategy: 'Urna', cs: 'Urna', website: 'John', design: '', copy: 'Urna, John', edit: '', shoot: '', seo: '', smo: '', qc: 'John' } },
  { clientName: 'Gaudiya', nature: 'Existing', difficulty: 9, comments: 'In Bengali, English, 3 websites - yet to be made - high pressure and high frequency', roles: { strategy: 'Urna', cs: 'Urna', website: 'John', design: 'Aarya', copy: 'Pramit, Urna', edit: 'Ajay', shoot: '', seo: 'External', smo: 'Arushi', qc: 'John' } },
  { clientName: 'Brinzz', nature: 'Existing', difficulty: 6, comments: 'Brand approvals delayed due to government regulations. Will come back in full - SMO, website, brand book - by end of June', roles: { strategy: 'Pramit, Mansi, Urna', cs: 'Pramit', website: 'TBD', design: 'TBD', copy: 'Pramit', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'John' } },
  { clientName: 'Station Satcom', nature: 'Existing', difficulty: 8, comments: 'New website to be delivered by 10th of July - rest in maintenance mode. E-Retail strategy etc to be submitted', roles: { strategy: 'Mansi, Pramit', cs: 'Mansi, Manan', website: 'John', design: 'Manan', copy: 'Mansi, Urna', edit: 'Ajay', shoot: '', seo: 'Harshada', smo: 'Arushi', qc: 'John' } },
  { clientName: 'Gharenu', nature: 'Prospect', difficulty: 8, comments: 'Yet to launch', roles: { strategy: 'Pramit, Mansi, Urna', cs: 'Mansi', website: 'John, External', design: 'Manan', copy: 'Pramit, Mansi, Urna', edit: '', shoot: 'External', seo: 'External', smo: 'Arushi', qc: 'John' } },
  { clientName: 'Goa', nature: 'Prospect', difficulty: 10, comments: 'In the pitching stage', roles: { strategy: 'Pramit, Arjun', cs: 'Mansi', website: '', design: 'TBD', copy: 'TBD', edit: 'External', shoot: 'External', seo: '', smo: 'TBD', qc: 'TBD' } },
  { clientName: 'The Bottle Shop', nature: 'Prospect', difficulty: 8, comments: '6000 SKU website to be developed on Shopify by John - will take time. SMO as well', roles: { strategy: 'Pramit', cs: 'Mansi', website: 'John', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' } },
  { clientName: 'Kumbh Mela', nature: 'Prospect', difficulty: 8, comments: 'Pre-pitch stage', roles: { strategy: 'Pramit, Arjun', cs: 'TBD', website: 'TBD', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' } },
  { clientName: 'Haryana Projects', nature: 'Prospect', difficulty: 8, comments: 'Pre-pitch stage', roles: { strategy: 'Pramit, Arjun', cs: 'TBD', website: 'TBD', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' } },
  { clientName: 'MMCF', nature: 'Prospect', difficulty: 10, comments: 'Discussion stage. When it comes there will be 3 websites and SMO', roles: { strategy: 'Pramit, Aashit', cs: 'TBD', website: 'TBD', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' } },
  { clientName: 'Dhanda.ai', nature: 'Prospect', difficulty: 6, comments: 'Discussion stage', roles: { strategy: 'Pramit, Shalini', cs: 'TBD', website: 'TBD', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' } },
  { clientName: 'Signo', nature: 'Prospect', difficulty: 8, comments: 'Pre-pitch stage', roles: { strategy: 'Pramit, Shalini', cs: 'TBD', website: 'TBD', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' } },
  { clientName: 'Tolvv Sign', nature: 'Prospect', difficulty: 7, comments: 'Pre-pitch stage', roles: { strategy: 'Mansi', cs: 'TBD', website: 'TBD', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' } },
  { clientName: 'Matrix Book Cover', nature: 'Prospect', difficulty: 6, comments: 'Pre-pitch stage', roles: { strategy: 'Mansi', cs: 'TBD', website: 'TBD', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' } },
  { clientName: 'Samunnati', nature: 'Prospect', difficulty: 6, comments: 'Follow up stage', roles: { strategy: 'Urna, Pramit', cs: 'TBD', website: 'TBD', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' } },
  { clientName: 'Interview Box', nature: 'Prospect', difficulty: 6, comments: 'Follow up stage', roles: { strategy: 'Pramit, Mansi', cs: 'TBD', website: 'TBD', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' } },
  { clientName: 'Katrankari', nature: 'Prospect', difficulty: 6, comments: 'Pre-pitch stage', roles: { strategy: 'Pramit, Mansi', cs: 'TBD', website: 'TBD', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' } },
  { clientName: 'IFB', nature: 'Prospect', difficulty: 10, comments: 'Pre-pitch stage', roles: { strategy: 'Pramit, Manan', cs: 'Manan', website: '', design: '', copy: '', edit: '', shoot: '', seo: 'TBD', smo: '', qc: 'TBD' } },
  { clientName: 'Network 18', nature: 'Prospect', difficulty: 10, comments: 'Quotation submitted', roles: { strategy: 'Pramit', cs: 'TBD', website: 'TBD', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' } }
];

export async function query(sql, params = [], connection = pool) {
  const [rows] = await connection.execute(sql, params);
  return rows;
}

export async function one(sql, params = [], connection = pool) {
  const rows = await query(sql, params, connection);
  return rows[0] || null;
}

export async function transaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

const cleanEnvValue = value => {
  const trimmed = (value || '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
    return trimmed.slice(1, -1);
  return trimmed;
};

const envFlagEnabled = value => ['1', 'true', 'yes', 'on'].includes(cleanEnvValue(value).toLowerCase());
const demoClientIds = Array.from({ length: 12 }, (_, index) => `client${index + 1}`);
const demoInternalIds = ['ci360admin', 'superdemo', 'admindemo', 'employeedemo'];
const demoLoginIds = new Set([
  ...demoInternalIds,
  ...demoInternalIds.map(id => `${id}@ci360demo.local`),
  ...demoClientIds,
  ...demoClientIds.map(id => `${id}@ci360demo.local`)
]);

export const environmentSuperAdminCredentials = () => ({
  id: cleanEnvValue(process.env.SUPER_ADMIN_ID),
  password: cleanEnvValue(process.env.SUPER_ADMIN_PASSWORD),
  name: cleanEnvValue(process.env.SUPER_ADMIN_NAME) || 'Super Admin',
  email: cleanEnvValue(process.env.SUPER_ADMIN_EMAIL) || null
});

export const demoUserCredentials = () => ({
  enabled: envFlagEnabled(process.env.SEED_DEMO_USERS),
  password: cleanEnvValue(process.env.DEMO_USER_PASSWORD) || 'CI360Demo#2026',
  loginIds: demoLoginIds
});

export const shouldRepairDemoLogin = (loginId, password) => {
  const demo = demoUserCredentials();
  return demo.enabled && demo.password === password && demo.loginIds.has(cleanEnvValue(loginId).toLowerCase());
};

const mergePlainSettings = (current, defaults) => {
  if (!current || typeof current !== 'object' || Array.isArray(current))
    return defaults;
  const merged = { ...current };
  for (const [key, value] of Object.entries(defaults)) {
    if (merged[key] === undefined)
      merged[key] = value;
  }
  return merged;
};

async function mergeDefaultSettings() {
  const row = await one('SELECT json FROM settings WHERE id=1');
  if (!row)
    return;
  let parsed = {};
  try {
    parsed = JSON.parse(row.json || '{}');
  } catch {
    parsed = {};
  }
  const merged = mergePlainSettings(parsed, defaultSettings);
  if (JSON.stringify(merged) !== JSON.stringify(parsed))
    await query('UPDATE settings SET json=? WHERE id=1', [JSON.stringify(merged)]);
}

async function columnExists(tableName, columnName) {
  const row = await one(
    `SELECT COUNT(*) AS count
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [tableName, columnName]
  );
  return Number(row?.count || 0) > 0;
}

async function addColumnIfMissing(tableName, columnName, definition) {
  if (await columnExists(tableName, columnName))
    return;
  try {
    await query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  } catch (error) {
    if (error?.code === 'ER_DUP_FIELDNAME' || /Duplicate column name/i.test(String(error?.message || '')))
      return;
    throw error;
  }
}

async function indexExists(tableName, indexName) {
  const row = await one(
    `SELECT COUNT(*) AS count
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?`,
    [tableName, indexName]
  );
  return Number(row?.count || 0) > 0;
}

async function addIndexIfMissing(tableName, indexName, definition) {
  if (await indexExists(tableName, indexName))
    return;
  try {
    await query(`CREATE INDEX ${indexName} ON ${tableName} ${definition}`);
  } catch (error) {
    if (error?.code === 'ER_DUP_KEYNAME' || /Duplicate key name/i.test(String(error?.message || '')))
      return;
    throw error;
  }
}

export async function initialiseDatabase() {
  await query(`CREATE TABLE IF NOT EXISTS clients (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin','client') NOT NULL,
    client_id VARCHAR(100) NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_users_client FOREIGN KEY (client_id) REFERENCES clients(id)
      ON UPDATE CASCADE ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS jobs (
    id VARCHAR(100) PRIMARY KEY,
    client_id VARCHAR(100) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description LONGTEXT NOT NULL,
    category VARCHAR(150) NOT NULL,
    priority VARCHAR(30) NOT NULL,
    posted_by VARCHAR(255) NOT NULL,
    asset_link TEXT NOT NULL,
    calculated_hours DECIMAL(10,2) NOT NULL,
    team_override_hours DECIMAL(10,2) NULL,
    team_override_note TEXT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'submitted',
    date_posted VARCHAR(40) NOT NULL,
    date_completed VARCHAR(40) NULL,
    updated_at VARCHAR(40) NOT NULL,
    INDEX idx_jobs_client (client_id),
    INDEX idx_jobs_status_category (status, category),
    CONSTRAINT fk_jobs_client FOREIGN KEY (client_id) REFERENCES clients(id)
      ON UPDATE CASCADE ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS settings (
    id TINYINT PRIMARY KEY,
    json LONGTEXT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    actor_id VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(150) NOT NULL,
    details LONGTEXT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_audit_entity (entity_type, entity_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS support_tickets (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ticket_number VARCHAR(30) UNIQUE NULL,
    user_id VARCHAR(100) NOT NULL,
    user_name VARCHAR(255) NOT NULL,
    client_id VARCHAR(100) NULL,
    job_id VARCHAR(100) NULL,
    department_id BIGINT UNSIGNED NULL,
    assigned_to_user_id VARCHAR(100) NULL,
    assigned_by_user_id VARCHAR(100) NULL,
    assignment_note TEXT NULL,
    assigned_at VARCHAR(40) NULL,
    subject VARCHAR(500) NOT NULL,
    category ENUM('Technical Issue','Account Issue','Job Posting Issue','Candidate Issue','Client Issue','Billing Issue','Feature Request','General Support') NOT NULL,
    priority ENUM('Low','Medium','High','Urgent') NOT NULL,
    status ENUM('Open','In Progress','Waiting for User','Resolved','Closed') NOT NULL DEFAULT 'Open',
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    closed_at VARCHAR(40) NULL,
    INDEX idx_tickets_user (user_id),
    INDEX idx_tickets_job (job_id),
    INDEX idx_tickets_department (department_id),
    INDEX idx_tickets_assigned_to (assigned_to_user_id),
    INDEX idx_tickets_updated (updated_at),
    CONSTRAINT fk_tickets_user FOREIGN KEY (user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS support_ticket_messages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ticket_id BIGINT UNSIGNED NOT NULL,
    author_id VARCHAR(100) NOT NULL,
    author_name VARCHAR(255) NOT NULL,
    author_role ENUM('admin','client') NOT NULL,
    body LONGTEXT NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    INDEX idx_messages_ticket (ticket_id),
    CONSTRAINT fk_messages_ticket FOREIGN KEY (ticket_id) REFERENCES support_tickets(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS support_ticket_attachments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ticket_id BIGINT UNSIGNED NOT NULL,
    message_id BIGINT UNSIGNED NULL,
    file_name VARCHAR(500) NOT NULL,
    mime_type VARCHAR(255) NOT NULL,
    size_bytes INT UNSIGNED NOT NULL,
    data_base64 LONGTEXT NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    INDEX idx_attachments_ticket (ticket_id),
    CONSTRAINT fk_attachments_ticket FOREIGN KEY (ticket_id) REFERENCES support_tickets(id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_attachments_message FOREIGN KEY (message_id) REFERENCES support_ticket_messages(id)
      ON UPDATE CASCADE ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS internal_chat_threads (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    subject VARCHAR(500) NOT NULL,
    department_id BIGINT UNSIGNED NULL,
    participant_user_id VARCHAR(100) NULL,
    created_by_user_id VARCHAR(100) NOT NULL,
    last_message_at VARCHAR(40) NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    INDEX idx_internal_chat_department (department_id),
    INDEX idx_internal_chat_participant (participant_user_id),
    INDEX idx_internal_chat_created_by (created_by_user_id),
    INDEX idx_internal_chat_last_message (last_message_at),
    CONSTRAINT fk_internal_chat_participant FOREIGN KEY (participant_user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_internal_chat_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS internal_chat_messages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    thread_id BIGINT UNSIGNED NOT NULL,
    author_id VARCHAR(100) NOT NULL,
    author_name VARCHAR(255) NOT NULL,
    body LONGTEXT NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    INDEX idx_internal_chat_messages_thread (thread_id,created_at),
    CONSTRAINT fk_internal_chat_messages_thread FOREIGN KEY (thread_id) REFERENCES internal_chat_threads(id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_internal_chat_messages_author FOREIGN KEY (author_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await initialiseRbacSchema();
  await seedRbacDefaults();

  await query('INSERT IGNORE INTO settings (id, json) VALUES (1, ?)', [JSON.stringify(defaultSettings)]);
  await mergeDefaultSettings();
  await ensureEnvironmentSuperAdmin();
  const row = await one('SELECT COUNT(*) AS count FROM clients');
  if (envFlagEnabled(process.env.SEED_DEMO_DATA) && Number(row.count) === 0)
    await seed();
  if (envFlagEnabled(process.env.SEED_DEMO_USERS))
    await seedDemoUsers();
  await mapExistingUsersToRbac();
  await seedProductivityClientsAndEmployees();
  await seedInitialJobCoordinators();
}

async function initialiseRbacSchema() {
  await query(`CREATE TABLE IF NOT EXISTS roles (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    slug VARCHAR(80) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    level INT NOT NULL DEFAULT 0,
    role_type ENUM('internal','client') NOT NULL DEFAULT 'internal',
    is_system TINYINT(1) NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_roles_status (status),
    INDEX idx_roles_type (role_type)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS permissions (
    id VARCHAR(100) PRIMARY KEY,
    module VARCHAR(80) NOT NULL,
    action VARCHAR(80) NOT NULL,
    label VARCHAR(160) NOT NULL,
    description TEXT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_permissions_module (module)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS role_permissions (
    role_id VARCHAR(50) NOT NULL,
    permission_id VARCHAR(100) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (role_id, permission_id),
    CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles(id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS user_permission_overrides (
    user_id VARCHAR(100) NOT NULL,
    permission_id VARCHAR(100) NOT NULL,
    effect ENUM('grant','revoke') NOT NULL,
    created_by VARCHAR(100) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (user_id, permission_id),
    INDEX idx_user_permission_effect (effect),
    CONSTRAINT fk_user_overrides_user FOREIGN KEY (user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_user_overrides_permission FOREIGN KEY (permission_id) REFERENCES permissions(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS departments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(160) NOT NULL UNIQUE,
    code VARCHAR(60) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    created_by VARCHAR(100) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS designations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(160) NOT NULL UNIQUE,
    code VARCHAR(60) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    hierarchy_level INT NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    created_by VARCHAR(100) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_designations_level (hierarchy_level)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS employee_profiles (
    user_id VARCHAR(100) PRIMARY KEY,
    employee_id VARCHAR(80) NULL UNIQUE,
    joining_date DATE NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_employee_profiles_user FOREIGN KEY (user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS module_access_rules (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    module_key VARCHAR(80) NOT NULL,
    name VARCHAR(160) NOT NULL,
    description TEXT NOT NULL,
    match_mode ENUM('all','any') NOT NULL DEFAULT 'all',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by_user_id VARCHAR(100) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_module_rules_module (module_key),
    INDEX idx_module_rules_active (is_active),
    CONSTRAINT fk_module_rules_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS module_access_conditions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    rule_id BIGINT UNSIGNED NOT NULL,
    effect ENUM('include','exclude') NOT NULL DEFAULT 'include',
    condition_type ENUM('account_type','role','department','designation','user','manager','client') NOT NULL,
    operator VARCHAR(40) NOT NULL DEFAULT 'equals',
    value VARCHAR(255) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_module_conditions_rule (rule_id),
    CONSTRAINT fk_module_conditions_rule FOREIGN KEY (rule_id) REFERENCES module_access_rules(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS module_access_triggers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    rule_id BIGINT UNSIGNED NOT NULL,
    trigger_type VARCHAR(80) NOT NULL,
    operator VARCHAR(40) NOT NULL DEFAULT 'equals',
    value VARCHAR(255) NOT NULL DEFAULT '',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_module_triggers_rule (rule_id),
    CONSTRAINT fk_module_triggers_rule FOREIGN KEY (rule_id) REFERENCES module_access_rules(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS module_access_advanced_rules (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    rule_id BIGINT UNSIGNED NOT NULL,
    rule_type VARCHAR(80) NOT NULL,
    operator VARCHAR(40) NOT NULL DEFAULT 'equals',
    value VARCHAR(255) NOT NULL DEFAULT '',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_module_advanced_rule (rule_id),
    CONSTRAINT fk_module_advanced_rule FOREIGN KEY (rule_id) REFERENCES module_access_rules(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query("ALTER TABLE users MODIFY role ENUM('super_admin','admin','employee','client') NOT NULL DEFAULT 'client'");
  await query('ALTER TABLE support_ticket_messages MODIFY author_role VARCHAR(50) NOT NULL');
  await query('ALTER TABLE jobs MODIFY team_override_note TEXT NULL');

  await addColumnIfMissing('users', 'account_type', "ENUM('super_admin','admin','employee','client') NULL AFTER role");
  await addColumnIfMissing('users', 'role_id', 'VARCHAR(50) NULL AFTER account_type');
  await addColumnIfMissing('users', 'email', 'VARCHAR(255) NULL AFTER name');
  await addColumnIfMissing('users', 'phone', 'VARCHAR(60) NULL AFTER email');
  await addColumnIfMissing('users', 'department_id', 'BIGINT UNSIGNED NULL AFTER client_id');
  await addColumnIfMissing('users', 'designation_id', 'BIGINT UNSIGNED NULL AFTER department_id');
  await addColumnIfMissing('users', 'manager_user_id', 'VARCHAR(100) NULL AFTER designation_id');
  await addColumnIfMissing('users', 'created_by', 'VARCHAR(100) NULL AFTER manager_user_id');
  await addColumnIfMissing('users', 'last_login', 'DATETIME(3) NULL AFTER created_at');
  await addColumnIfMissing('users', 'updated_at', 'DATETIME(3) NULL AFTER last_login');

  await addColumnIfMissing('clients', 'contact_name', 'VARCHAR(255) NULL AFTER name');
  await addColumnIfMissing('clients', 'email', 'VARCHAR(255) NULL AFTER contact_name');
  await addColumnIfMissing('clients', 'phone', 'VARCHAR(60) NULL AFTER email');
  await addColumnIfMissing('clients', 'industry', 'VARCHAR(160) NULL AFTER phone');
  await addColumnIfMissing('clients', 'account_owner_user_id', 'VARCHAR(100) NULL AFTER industry');
  await addColumnIfMissing('clients', 'created_by', 'VARCHAR(100) NULL AFTER account_owner_user_id');
  await addColumnIfMissing('clients', 'updated_at', 'DATETIME(3) NULL AFTER created_at');

  await addColumnIfMissing('support_tickets', 'job_id', 'VARCHAR(100) NULL AFTER client_id');
  await addColumnIfMissing('support_tickets', 'department_id', 'BIGINT UNSIGNED NULL AFTER job_id');
  await addColumnIfMissing('support_tickets', 'assigned_to_user_id', 'VARCHAR(100) NULL AFTER department_id');
  await addColumnIfMissing('support_tickets', 'assigned_by_user_id', 'VARCHAR(100) NULL AFTER assigned_to_user_id');
  await addColumnIfMissing('support_tickets', 'assignment_note', 'TEXT NULL AFTER assigned_by_user_id');
  await addColumnIfMissing('support_tickets', 'assigned_at', 'VARCHAR(40) NULL AFTER assignment_note');
  await addColumnIfMissing('internal_chat_threads', 'participant_user_id', 'VARCHAR(100) NULL AFTER department_id');

  await addColumnIfMissing('jobs', 'created_by_user_id', 'VARCHAR(100) NULL AFTER posted_by');
  await addColumnIfMissing('jobs', 'assigned_to_user_id', 'VARCHAR(100) NULL AFTER created_by_user_id');
  await addColumnIfMissing('jobs', 'assigned_by_user_id', 'VARCHAR(100) NULL AFTER assigned_to_user_id');
  await addColumnIfMissing('jobs', 'preferred_assignee_user_id', 'VARCHAR(100) NULL AFTER assigned_by_user_id');
  await addColumnIfMissing('jobs', 'department_id', 'BIGINT UNSIGNED NULL AFTER assigned_by_user_id');
  await addColumnIfMissing('jobs', 'assignment_date', 'VARCHAR(40) NULL AFTER department_id');
  await addColumnIfMissing('jobs', 'assignment_note', 'TEXT NULL AFTER assignment_date');
  await addColumnIfMissing('jobs', 'assignment_state', "VARCHAR(50) NOT NULL DEFAULT 'unassigned' AFTER status");
  await addColumnIfMissing('jobs', 'submitted_at', 'VARCHAR(40) NULL AFTER date_posted');
  await addColumnIfMissing('jobs', 'acceptance_deadline_at', 'VARCHAR(40) NULL AFTER submitted_at');
  await addColumnIfMissing('jobs', 'accepted_at', 'VARCHAR(40) NULL AFTER acceptance_deadline_at');
  await addColumnIfMissing('jobs', 'assignment_method', 'VARCHAR(50) NULL AFTER accepted_at');
  await addColumnIfMissing('jobs', 'assignment_source_user_id', 'VARCHAR(100) NULL AFTER assignment_method');
  await addColumnIfMissing('jobs', 'auto_assignment_attempted_at', 'VARCHAR(40) NULL AFTER assignment_source_user_id');
  await addColumnIfMissing('jobs', 'requires_client_action', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER auto_assignment_attempted_at');
  await addColumnIfMissing('jobs', 'progress_percent', 'INT NOT NULL DEFAULT 0 AFTER requires_client_action');
  await addColumnIfMissing('jobs', 'desired_delivery_at', 'VARCHAR(40) NULL AFTER progress_percent');
  await addColumnIfMissing('jobs', 'reference_links', 'LONGTEXT NULL AFTER desired_delivery_at');
  await addColumnIfMissing('jobs', 'special_instructions', 'TEXT NULL AFTER reference_links');

  await query(`CREATE TABLE IF NOT EXISTS job_assignments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    job_id VARCHAR(100) NOT NULL,
    previous_assignee_user_id VARCHAR(100) NULL,
    assigned_to_user_id VARCHAR(100) NULL,
    assigned_by_user_id VARCHAR(100) NULL,
    previous_department_id BIGINT UNSIGNED NULL,
    department_id BIGINT UNSIGNED NULL,
    note TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_job_assignments_job (job_id),
    INDEX idx_job_assignments_assignee (assigned_to_user_id),
    CONSTRAINT fk_job_assignments_job FOREIGN KEY (job_id) REFERENCES jobs(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS job_coordinators (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,
    department_id BIGINT UNSIGNED NULL,
    receive_all_client_jobs TINYINT(1) NOT NULL DEFAULT 1,
    priority_order INT NOT NULL DEFAULT 100,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by_user_id VARCHAR(100) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_job_coordinators_user (user_id),
    INDEX idx_job_coordinators_department (department_id),
    INDEX idx_job_coordinators_active (is_active),
    CONSTRAINT fk_job_coordinators_user FOREIGN KEY (user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_job_coordinators_department FOREIGN KEY (department_id) REFERENCES departments(id)
      ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_job_coordinators_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS job_assignment_offers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    job_id VARCHAR(100) NOT NULL,
    offered_to_user_id VARCHAR(100) NOT NULL,
    offered_by_user_id VARCHAR(100) NULL,
    offer_type VARCHAR(40) NOT NULL DEFAULT 'preferred',
    status VARCHAR(40) NOT NULL DEFAULT 'pending',
    offered_at VARCHAR(40) NOT NULL,
    expires_at VARCHAR(40) NULL,
    accepted_at VARCHAR(40) NULL,
    declined_at VARCHAR(40) NULL,
    decline_reason TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_assignment_offers_job (job_id),
    INDEX idx_assignment_offers_user_status (offered_to_user_id,status),
    INDEX idx_assignment_offers_expires (status,expires_at),
    CONSTRAINT fk_assignment_offers_job FOREIGN KEY (job_id) REFERENCES jobs(id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_assignment_offers_user FOREIGN KEY (offered_to_user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_assignment_offers_actor FOREIGN KEY (offered_by_user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS notifications (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    type VARCHAR(80) NOT NULL DEFAULT 'info',
    job_id VARCHAR(100) NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    created_at VARCHAR(40) NOT NULL,
    read_at VARCHAR(40) NULL,
    INDEX idx_notifications_user_read (user_id,is_read,created_at),
    INDEX idx_notifications_job (job_id),
    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_notifications_job FOREIGN KEY (job_id) REFERENCES jobs(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS job_events (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    job_id VARCHAR(100) NOT NULL,
    event_type VARCHAR(80) NOT NULL,
    actor_user_id VARCHAR(100) NULL,
    visibility VARCHAR(30) NOT NULL DEFAULT 'client',
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    metadata_json LONGTEXT NULL,
    created_at VARCHAR(40) NOT NULL,
    INDEX idx_job_events_job_created (job_id,created_at),
    INDEX idx_job_events_visibility (visibility),
    CONSTRAINT fk_job_events_job FOREIGN KEY (job_id) REFERENCES jobs(id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_job_events_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS job_service_departments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    service_name VARCHAR(180) NOT NULL,
    department_id BIGINT UNSIGNED NOT NULL,
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_service_department (service_name,department_id),
    INDEX idx_service_department_department (department_id),
    CONSTRAINT fk_service_departments_department FOREIGN KEY (department_id) REFERENCES departments(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS employee_job_capabilities (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,
    service_name VARCHAR(180) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_employee_capability (user_id,service_name),
    INDEX idx_employee_capability_service (service_name,is_active),
    CONSTRAINT fk_employee_capabilities_user FOREIGN KEY (user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS productivity_employee_settings (
    user_id VARCHAR(100) PRIMARY KEY,
    weekly_capacity_hours DECIMAL(10,2) NOT NULL DEFAULT 40,
    productivity_status ENUM('active','intern','vendor','inactive') NOT NULL DEFAULT 'active',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_productivity_employee_user FOREIGN KEY (user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS productivity_services (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(180) NOT NULL UNIQUE,
    reference_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by_user_id VARCHAR(100) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_productivity_services_active (is_active),
    CONSTRAINT fk_productivity_services_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS productivity_jobs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    core_job_id VARCHAR(100) NULL,
    client_id VARCHAR(100) NOT NULL,
    start_date DATE NOT NULL,
    completion_date DATE NULL,
    value_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    description TEXT NOT NULL,
    created_by_user_id VARCHAR(100) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_productivity_jobs_client (client_id),
    INDEX idx_productivity_jobs_start (start_date),
    INDEX idx_productivity_jobs_completion (completion_date),
    CONSTRAINT fk_productivity_jobs_core FOREIGN KEY (core_job_id) REFERENCES jobs(id)
      ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_productivity_jobs_client FOREIGN KEY (client_id) REFERENCES clients(id)
      ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_productivity_jobs_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS productivity_job_services (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    productivity_job_id BIGINT UNSIGNED NOT NULL,
    service_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_productivity_job_service (productivity_job_id,service_id),
    INDEX idx_productivity_job_services_job (productivity_job_id),
    INDEX idx_productivity_job_services_service (service_id),
    CONSTRAINT fk_productivity_job_services_job FOREIGN KEY (productivity_job_id) REFERENCES productivity_jobs(id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_productivity_job_services_service FOREIGN KEY (service_id) REFERENCES productivity_services(id)
      ON UPDATE CASCADE ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS productivity_job_assignments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    productivity_job_id BIGINT UNSIGNED NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    revenue_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
    hours_spent DECIMAL(10,2) NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_productivity_assignments_job (productivity_job_id),
    INDEX idx_productivity_assignments_user (user_id),
    CONSTRAINT fk_productivity_assignments_job FOREIGN KEY (productivity_job_id) REFERENCES productivity_jobs(id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_productivity_assignments_user FOREIGN KEY (user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS productivity_account_rosters (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_id VARCHAR(100) NOT NULL,
    nature ENUM('Existing','Prospect') NOT NULL DEFAULT 'Existing',
    difficulty INT NOT NULL DEFAULT 5,
    comments TEXT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_productivity_rosters_client (client_id),
    CONSTRAINT fk_productivity_rosters_client FOREIGN KEY (client_id) REFERENCES clients(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS productivity_account_roster_assignments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    roster_id BIGINT UNSIGNED NOT NULL,
    responsibility_key VARCHAR(40) NOT NULL,
    assignee_type ENUM('employee','external','tbd') NOT NULL DEFAULT 'tbd',
    user_id VARCHAR(100) NULL,
    external_name VARCHAR(180) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_productivity_roster_assignments_roster (roster_id),
    INDEX idx_productivity_roster_assignments_user (user_id),
    CONSTRAINT fk_productivity_roster_assignments_roster FOREIGN KEY (roster_id) REFERENCES productivity_account_rosters(id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_productivity_roster_assignments_user FOREIGN KEY (user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS productivity_targets (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,
    service_id BIGINT UNSIGNED NOT NULL,
    quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
    unit ENUM('count','hours') NOT NULL DEFAULT 'count',
    period ENUM('day','week','month') NOT NULL DEFAULT 'week',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by_user_id VARCHAR(100) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_productivity_targets_user (user_id),
    INDEX idx_productivity_targets_service (service_id),
    CONSTRAINT fk_productivity_targets_user FOREIGN KEY (user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_productivity_targets_service FOREIGN KEY (service_id) REFERENCES productivity_services(id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_productivity_targets_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS productivity_salary_grades (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    owner_user_id VARCHAR(100) NOT NULL,
    label VARCHAR(80) NOT NULL,
    min_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    max_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_productivity_salary_grades_owner (owner_user_id),
    CONSTRAINT fk_productivity_salary_grades_owner FOREIGN KEY (owner_user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS productivity_salary_assignments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    owner_user_id VARCHAR(100) NOT NULL,
    employee_user_id VARCHAR(100) NOT NULL,
    grade_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_productivity_salary_owner_employee (owner_user_id,employee_user_id),
    INDEX idx_productivity_salary_assignment_grade (grade_id),
    CONSTRAINT fk_productivity_salary_assignment_owner FOREIGN KEY (owner_user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_productivity_salary_assignment_employee FOREIGN KEY (employee_user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_productivity_salary_assignment_grade FOREIGN KEY (grade_id) REFERENCES productivity_salary_grades(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  const productivityServiceCount = await one('SELECT COUNT(*) count FROM productivity_services');
  if (!Number(productivityServiceCount?.count || 0)) {
    for (const [name, referenceHours] of productivityServiceSeedRows)
      await query('INSERT INTO productivity_services (name,reference_hours,is_active) VALUES (?,?,1)', [name, referenceHours]);
  }

  await addIndexIfMissing('users', 'idx_users_role_id', '(role_id)');
  await addIndexIfMissing('users', 'idx_users_account_type', '(account_type)');
  await addIndexIfMissing('users', 'idx_users_client_id', '(client_id)');
  await addIndexIfMissing('clients', 'idx_clients_owner', '(account_owner_user_id)');
  await addIndexIfMissing('clients', 'idx_clients_created_by', '(created_by)');
  await addIndexIfMissing('support_tickets', 'idx_tickets_job', '(job_id)');
  await addIndexIfMissing('support_tickets', 'idx_tickets_department', '(department_id)');
  await addIndexIfMissing('support_tickets', 'idx_tickets_assigned_to', '(assigned_to_user_id)');
  await addIndexIfMissing('internal_chat_threads', 'idx_internal_chat_participant', '(participant_user_id)');
  await addIndexIfMissing('jobs', 'idx_jobs_assigned_to', '(assigned_to_user_id)');
  await addIndexIfMissing('jobs', 'idx_jobs_preferred_assignee', '(preferred_assignee_user_id)');
  await addIndexIfMissing('jobs', 'idx_jobs_created_by', '(created_by_user_id)');
  await addIndexIfMissing('jobs', 'idx_jobs_department', '(department_id)');
  await addIndexIfMissing('jobs', 'idx_jobs_assignment_state', '(assignment_state)');
  await addIndexIfMissing('jobs', 'idx_jobs_acceptance_deadline', '(assignment_state,acceptance_deadline_at)');
  await addIndexIfMissing('jobs', 'idx_jobs_updated', '(updated_at)');
}

async function seedRbacDefaults() {
  for (const [id, name, description, level, roleType] of roles) {
    await query(
      `INSERT INTO roles (id,name,slug,description,level,role_type,is_system,status)
        VALUES (?,?,?,?,?,?,1,'active')
        ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),level=VALUES(level),role_type=VALUES(role_type),is_system=1,status='active'`,
      [id, name, id, description, level, roleType]
    );
  }

  for (const [id, module, action, label] of permissions) {
    await query(
      `INSERT INTO permissions (id,module,action,label,description)
        VALUES (?,?,?,?,?)
        ON DUPLICATE KEY UPDATE module=VALUES(module),action=VALUES(action),label=VALUES(label)`,
      [id, module, action, label, label]
    );
  }

  for (const [roleId, permissionIds] of Object.entries(rolePermissions)) {
    for (const permissionId of permissionIds) {
      await query('INSERT IGNORE INTO role_permissions (role_id,permission_id) VALUES (?,?)', [roleId, permissionId]);
    }
  }
  await query(
    `DELETE FROM role_permissions
      WHERE role_id='client'
        AND permission_id IN ('jobs.assign','jobs.reassign','jobs.dispatch.view','jobs.dispatch.assign','jobs.dispatch.reassign','jobs.dispatch.claim','jobs.dispatch.override','jobs.dispatch.manage_coordinators')`
  );
  await query(
    `DELETE FROM role_permissions
      WHERE role_id IN ('team_leader','employee','junior_employee')
        AND permission_id IN ('support.create','support.view_all','support.manage')`
  );

  await query(`INSERT IGNORE INTO departments (name,code,description,status)
    VALUES ('Operations','OPS','Default operations department','active')`);
  await query(`INSERT IGNORE INTO designations (name,code,description,hierarchy_level,status)
    VALUES
      ('Team Leader','TEAM_LEADER','Leads internal team members and juniors',60,'active'),
      ('Team Member','TEAM_MEMBER','Default internal team designation',40,'active'),
      ('Junior Employee','JUNIOR_EMPLOYEE','Junior internal team designation',20,'active')`);
}

async function mapExistingUsersToRbac() {
  await query("UPDATE users SET account_type='admin', role_id='admin' WHERE role='admin' AND (role_id IS NULL OR role_id='')");
  await query("UPDATE users SET account_type='client', role_id='client' WHERE role='client' AND (role_id IS NULL OR role_id='')");
  await query("UPDATE users SET account_type=role WHERE account_type IS NULL");
}

const seedSlug = value => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/&/g, 'and')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 80);

const seedPasswordHashFor = async value => bcrypt.hash(crypto.createHash('sha256').update(`ci360:${value}`).digest('hex').slice(0, 20), 12);

async function getDefaultDepartmentAndDesignation(connection) {
  const department = await one("SELECT id FROM departments WHERE code='OPS'", [], connection);
  const teamMember = await one("SELECT id FROM designations WHERE code='TEAM_MEMBER'", [], connection);
  const teamLeader = await one("SELECT id FROM designations WHERE code='TEAM_LEADER'", [], connection);
  const junior = await one("SELECT id FROM designations WHERE code='JUNIOR_EMPLOYEE'", [], connection);
  return { department, teamMember, teamLeader, junior };
}

function roleForSeedPerson(person) {
  const text = `${person.name} ${person.duties}`.toLowerCase();
  if (text.includes('founder') || text.includes('coo') || ['urna', 'mansi'].includes(person.name.toLowerCase()))
    return 'team_leader';
  if (person.status === 'intern')
    return 'junior_employee';
  return 'employee';
}

function designationForSeedPerson(person, designations) {
  const role = roleForSeedPerson(person);
  if (role === 'team_leader')
    return designations.teamLeader?.id || designations.teamMember?.id || null;
  if (role === 'junior_employee')
    return designations.junior?.id || designations.teamMember?.id || null;
  return designations.teamMember?.id || null;
}

function productivityStatusForSeed(status) {
  if (['inactive', 'intern', 'vendor'].includes(status))
    return status;
  return 'active';
}

function rosterAssignmentsForSeed(roster, userByName) {
  const assignments = [];
  for (const [responsibilityKey, rawNames] of Object.entries(roster.roles || {})) {
    const names = String(rawNames || '').split(',').map(name => name.trim()).filter(Boolean);
    for (const name of names) {
      const normalized = name.toLowerCase();
      if (!name || normalized === 'tbd') {
        assignments.push({ responsibilityKey, assigneeType: 'tbd', userId: null, externalName: null });
        continue;
      }
      const userId = userByName.get(normalized);
      if (userId)
        assignments.push({ responsibilityKey, assigneeType: 'employee', userId, externalName: null });
      else
        assignments.push({ responsibilityKey, assigneeType: 'external', userId: null, externalName: name });
    }
  }
  return assignments;
}

async function seedProductivityClientsAndEmployees() {
  const now = new Date();
  await transaction(async connection => {
    const designations = await getDefaultDepartmentAndDesignation(connection);
    const userByName = new Map();

    for (const person of productivityPersonnelSeeds) {
      const id = seedSlug(person.name);
      const existing = await one(
        `SELECT id FROM users
          WHERE (id=? OR LOWER(name)=LOWER(?))
            AND COALESCE(account_type,role) <> 'client'
          LIMIT 1`,
        [id, person.name],
        connection
      );
      const roleId = roleForSeedPerson(person);
      let userId = existing?.id || id;
      if (!existing) {
        const idCollision = await one('SELECT id FROM users WHERE id=? LIMIT 1', [userId], connection);
        if (idCollision)
          userId = `employee_${id}`;
        const passwordHash = await seedPasswordHashFor(userId);
        await query(
          `INSERT INTO users
            (id,name,email,phone,password_hash,role,account_type,role_id,client_id,department_id,designation_id,manager_user_id,status,created_by,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            userId,
            person.name,
            `${userId}@ci360.local`,
            null,
            passwordHash,
            'employee',
            'employee',
            roleId,
            null,
            designations.department?.id || null,
            designationForSeedPerson(person, designations),
            null,
            person.status === 'inactive' ? 'inactive' : 'active',
            null,
            now
          ],
          connection
        );
        await query(
          `INSERT INTO employee_profiles (user_id,employee_id,joining_date)
            VALUES (?,?,NULL)
            ON DUPLICATE KEY UPDATE employee_id=employee_id`,
          [userId, `CI-${userId.toUpperCase().slice(0, 32)}`],
          connection
        );
      }
      await query(
        `INSERT INTO productivity_employee_settings (user_id,weekly_capacity_hours,productivity_status)
          VALUES (?,?,?)
          ON DUPLICATE KEY UPDATE weekly_capacity_hours=weekly_capacity_hours,productivity_status=productivity_status`,
        [userId, person.capacity || 48, productivityStatusForSeed(person.status)],
        connection
      );
      userByName.set(person.name.toLowerCase(), userId);
    }

    for (const roster of productivityClientRosterSeeds) {
      const clientId = seedSlug(roster.clientName);
      const existingClient = await one('SELECT id FROM clients WHERE id=?', [clientId], connection);
      if (!existingClient) {
        const passwordHash = await seedPasswordHashFor(`client:${clientId}`);
        await query(
          `INSERT INTO clients
            (id,name,contact_name,email,phone,industry,password_hash,status,account_owner_user_id,created_by,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [
            clientId,
            roster.clientName,
            roster.clientName,
            null,
            null,
            roster.nature === 'Prospect' ? 'Prospect Account' : 'Existing Account',
            passwordHash,
            'active',
            null,
            null,
            now
          ],
          connection
        );
      }
      const existingRoster = await one('SELECT id FROM productivity_account_rosters WHERE client_id=?', [clientId], connection);
      if (existingRoster)
        continue;
      const result = await query(
        'INSERT INTO productivity_account_rosters (client_id,nature,difficulty,comments) VALUES (?,?,?,?)',
        [clientId, roster.nature, roster.difficulty, roster.comments || ''],
        connection
      );
      const rosterId = result.insertId;
      for (const assignment of rosterAssignmentsForSeed(roster, userByName)) {
        await query(
          `INSERT INTO productivity_account_roster_assignments
            (roster_id,responsibility_key,assignee_type,user_id,external_name)
            VALUES (?,?,?,?,?)`,
          [rosterId, assignment.responsibilityKey, assignment.assigneeType, assignment.userId, assignment.externalName],
          connection
        );
      }
    }
  });
}

async function seedInitialJobCoordinators() {
  const coordinators = await query(
    `SELECT id FROM users
      WHERE status='active'
        AND COALESCE(account_type,role)<>'client'
        AND LOWER(name) IN ('urna','mansi')`
  );
  const dispatchPermissions = [
    'jobs.dispatch.view',
    'jobs.dispatch.assign',
    'jobs.dispatch.reassign',
    'jobs.dispatch.claim',
    'notifications.view',
    'profile.view'
  ];
  for (const coordinator of coordinators) {
    const existing = await one(
      'SELECT id FROM job_coordinators WHERE user_id=? AND department_id IS NULL LIMIT 1',
      [coordinator.id]
    );
    if (!existing) {
      await query(
        `INSERT INTO job_coordinators
          (user_id,department_id,receive_all_client_jobs,priority_order,is_active,created_by_user_id)
          VALUES (?,NULL,1,50,1,NULL)`,
        [coordinator.id]
      );
    }
    for (const permissionId of dispatchPermissions) {
      await query(
        `INSERT INTO user_permission_overrides (user_id,permission_id,effect,created_by)
          VALUES (?,?,'grant',NULL)
          ON DUPLICATE KEY UPDATE effect='grant'`,
        [coordinator.id, permissionId]
      );
    }
  }
}

export async function ensureEnvironmentSuperAdmin() {
  const { id, password, name, email } = environmentSuperAdminCredentials();
  if (!id)
    return;
  const existing = await one('SELECT id FROM users WHERE id=?', [id]);
  if (existing) {
    if (password) {
      const passwordHash = await bcrypt.hash(password, 12);
      await query("UPDATE users SET role='super_admin',account_type='super_admin',role_id='super_admin',client_id=NULL,email=COALESCE(?,email),password_hash=?,status='active',updated_at=? WHERE id=?", [email, passwordHash, new Date(), id]);
    }
    else {
      await query("UPDATE users SET role='super_admin',account_type='super_admin',role_id='super_admin',client_id=NULL,email=COALESCE(?,email),status='active',updated_at=? WHERE id=?", [email, new Date(), id]);
    }
    return;
  }
  if (!password)
    return;
  const hash = await bcrypt.hash(password, 12);
  await query(`INSERT INTO users (id,name,email,password_hash,role,account_type,role_id,client_id,status,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, [id, name, email, hash, 'super_admin', 'super_admin', 'super_admin', null, 'active', new Date()]);
}

async function seed() {
  const hash = value => bcrypt.hash(value, 12);
  const [acmeHash, betaHash, adminHash] = await Promise.all([
    hash('acme123'), hash('beta123'), hash('CI360Demo#2026')
  ]);
  await transaction(async connection => {
    await query('INSERT INTO clients (id,name,password_hash) VALUES (?,?,?)', ['acme', 'Acme Corp', acmeHash], connection);
    await query('INSERT INTO clients (id,name,password_hash) VALUES (?,?,?)', ['beta', 'Beta Industries', betaHash], connection);
    await query('INSERT INTO users (id,name,password_hash,role,client_id) VALUES (?,?,?,?,?)', ['ci360admin', 'CI360 Team', adminHash, 'admin', null], connection);
    await query('INSERT INTO users (id,name,password_hash,role,client_id) VALUES (?,?,?,?,?)', ['acme', 'Acme Corp', acmeHash, 'client', 'acme'], connection);
    await query('INSERT INTO users (id,name,password_hash,role,client_id) VALUES (?,?,?,?,?)', ['beta', 'Beta Industries', betaHash, 'client', 'beta'], connection);
    const now = new Date();
    const ago = (days, hour) => { const d = new Date(now); d.setDate(d.getDate() - days); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
    const jobs = [
      ['j1','acme','Update homepage banner for monsoon sale','Swap hero image and headline copy on the homepage.','Website Changes','High','Rina (Acme)','',18,null,'','in_progress',ago(2,15),null,new Date().toISOString()],
      ['j2','acme','Instagram carousel - new product launch','5-slide carousel announcing the new product line.','Social Media','Urgent','Rina (Acme)','',12,8,'Client needs it by tomorrow morning - prioritised.','submitted',ago(1,10),null,new Date().toISOString()],
      ['j3','acme','Upload Q3 catalogue PDFs to site','','Media Uploads','Low','Karan (Acme)','https://drive.google.com/',9,null,'','completed',ago(35,12),ago(33,17),new Date().toISOString()],
      ['j4','beta','Redesign pricing page','New pricing tiers, needs a fresh layout.','Website Changes','Medium','Neha (Beta)','',24,null,'','submitted',ago(6,11),null,new Date().toISOString()]
    ];
    for (const job of jobs) {
      await query(`INSERT INTO jobs
        (id,client_id,title,description,category,priority,posted_by,asset_link,calculated_hours,team_override_hours,team_override_note,status,date_posted,date_completed,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, job, connection);
    }
  });
}

export async function seedDemoUsers() {
  const now = new Date();
  const passwordHash = await bcrypt.hash(demoUserCredentials().password, 12);
  const demoClients = demoClientIds.map((id, index) => {
    const number = index + 1;
    return {
      id,
      name: `Demo Client ${number}`,
      contactName: `Demo Client ${number}`,
      email: `client${number}@ci360demo.local`,
      phone: `90000000${String(number).padStart(2, '0')}`,
      industry: 'Demo Workspace'
    };
  });

  await transaction(async connection => {
    const department = await one("SELECT id FROM departments WHERE code='OPS'", [], connection);
    const designation = await one("SELECT id FROM designations WHERE code='TEAM_MEMBER'", [], connection);
    const demoUsers = [
      {
        id: 'ci360admin',
        name: 'CI360 Team',
        email: 'ci360admin@ci360demo.local',
        phone: '9000000000',
        role: 'super_admin',
        accountType: 'super_admin',
        roleId: 'super_admin',
        clientId: null,
        departmentId: department?.id || null,
        designationId: designation?.id || null,
        managerUserId: null,
        createdBy: null
      },
      {
        id: 'superdemo',
        name: 'Demo Super Admin',
        email: 'superdemo@ci360demo.local',
        phone: '9000000001',
        role: 'super_admin',
        accountType: 'super_admin',
        roleId: 'super_admin',
        clientId: null,
        departmentId: department?.id || null,
        designationId: designation?.id || null,
        managerUserId: null,
        createdBy: null
      },
      {
        id: 'admindemo',
        name: 'Demo Admin',
        email: 'admindemo@ci360demo.local',
        phone: '9000000002',
        role: 'admin',
        accountType: 'admin',
        roleId: 'admin',
        clientId: null,
        departmentId: department?.id || null,
        designationId: designation?.id || null,
        managerUserId: 'superdemo',
        createdBy: 'superdemo'
      },
      {
        id: 'employeedemo',
        name: 'Demo Employee',
        email: 'employeedemo@ci360demo.local',
        phone: '9000000003',
        role: 'employee',
        accountType: 'employee',
        roleId: 'employee',
        clientId: null,
        departmentId: department?.id || null,
        designationId: designation?.id || null,
        managerUserId: 'admindemo',
        createdBy: 'superdemo'
      },
      ...demoClients.map(client => ({
        id: client.id,
        name: client.name,
        email: client.email,
        phone: client.phone,
        role: 'client',
        accountType: 'client',
        roleId: 'client',
        clientId: client.id,
        departmentId: null,
        designationId: null,
        managerUserId: null,
        createdBy: 'admindemo'
      }))
    ];

    for (const client of demoClients) {
      await query(
        `INSERT INTO clients (id,name,contact_name,email,phone,industry,password_hash,status,account_owner_user_id,created_by,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE
            name=VALUES(name),
            contact_name=VALUES(contact_name),
            email=VALUES(email),
            phone=VALUES(phone),
            industry=VALUES(industry),
            password_hash=VALUES(password_hash),
            status='active',
            account_owner_user_id=VALUES(account_owner_user_id),
            updated_at=VALUES(updated_at)`,
        [client.id, client.name, client.contactName, client.email, client.phone, client.industry, passwordHash, 'active', 'admindemo', 'superdemo', now],
        connection
      );
    }

    for (const user of demoUsers) {
      await query(
        `INSERT INTO users
          (id,name,email,phone,password_hash,role,account_type,role_id,client_id,department_id,designation_id,manager_user_id,status,created_by,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE
            name=VALUES(name),
            email=VALUES(email),
            phone=VALUES(phone),
            password_hash=VALUES(password_hash),
            role=VALUES(role),
            account_type=VALUES(account_type),
            role_id=VALUES(role_id),
            client_id=VALUES(client_id),
            department_id=VALUES(department_id),
            designation_id=VALUES(designation_id),
            manager_user_id=VALUES(manager_user_id),
            status='active',
            created_by=COALESCE(created_by,VALUES(created_by)),
            updated_at=VALUES(updated_at)`,
        [
          user.id,
          user.name,
          user.email,
          user.phone,
          passwordHash,
          user.role,
          user.accountType,
          user.roleId,
          user.clientId,
          user.departmentId,
          user.designationId,
          user.managerUserId,
          'active',
          user.createdBy,
          now
        ],
        connection
      );
    }

    await query(
      `INSERT INTO employee_profiles (user_id,employee_id,joining_date)
        VALUES ('employeedemo','DEMO-EMP-001',CURDATE())
        ON DUPLICATE KEY UPDATE employee_id=VALUES(employee_id),updated_at=?`,
      [now],
      connection
    );
  });
}

export async function audit(actorId, action, entityType, entityId, details = {}, connection = pool) {
  await query('INSERT INTO audit_logs (actor_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)',
    [actorId, action, entityType, entityId, JSON.stringify(details)], connection);
}
