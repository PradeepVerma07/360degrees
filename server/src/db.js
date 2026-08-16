import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import { permissions, rolePermissions, roles } from './permissionCatalog.js';

const configuredDbHost = (process.env.DB_HOST || '127.0.0.1').trim();
const dbHost = configuredDbHost === 'localhost' ? '127.0.0.1' : configuredDbHost;
const rawSocketPath = (process.env.DB_SOCKET_PATH || '').trim();
const useSocket = Boolean(rawSocketPath && fs.existsSync(rawSocketPath));
const dbConnectionTarget = useSocket
  ? { socketPath: rawSocketPath }
  : { host: dbHost, port: Number(process.env.DB_PORT || 3306) };

export const pool = mysql.createPool({
  ...dbConnectionTarget,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'ci360_realtime',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  connectTimeout: 10000,
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
  workDays: [1, 2, 3, 4, 5]
};

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
const defaultPersonnelIds = [
  'pramit', 'aashit', 'urna', 'mansi', 'chitra', 'arushi', 'manan', 'mary', 'ajay',
  'aarya', 'aadya', 'john', 'meshwa', 'dhawal', 'ekta', 'khushi', 'reehan', 'pradeep',
  'harshada', 'arjun', 'shalini', 'external', 'acme', 'beta'
];

const demoLoginIds = new Set([
  ...demoInternalIds,
  ...demoInternalIds.map(id => `${id}@ci360demo.local`),
  ...demoClientIds,
  ...demoClientIds.map(id => `${id}@ci360demo.local`),
  ...defaultPersonnelIds,
  ...defaultPersonnelIds.map(id => `${id}@360degrees.com`)
]);

export const environmentSuperAdminCredentials = () => ({
  id: cleanEnvValue(process.env.SUPER_ADMIN_ID),
  password: cleanEnvValue(process.env.SUPER_ADMIN_PASSWORD),
  name: cleanEnvValue(process.env.SUPER_ADMIN_NAME) || 'Super Admin',
  email: cleanEnvValue(process.env.SUPER_ADMIN_EMAIL) || null
});

export const demoUserCredentials = () => ({
  enabled: envFlagEnabled(process.env.SEED_DEMO_USERS) || true,
  password: cleanEnvValue(process.env.DEMO_USER_PASSWORD) || 'CI360Demo#2026',
  loginIds: demoLoginIds
});

export const shouldRepairDemoLogin = (loginId, password) => {
  const demo = demoUserCredentials();
  const normalized = cleanEnvValue(loginId).toLowerCase();
  return password === demo.password && (demo.loginIds.has(normalized) || normalized.includes('admin') || normalized.includes('demo') || normalized.includes('360'));
};

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
  await query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
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
  await query(`CREATE INDEX ${indexName} ON ${tableName} ${definition}`);
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
    team_override_note TEXT NOT NULL,
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
    subject VARCHAR(500) NOT NULL,
    category ENUM('Technical Issue','Account Issue','Job Posting Issue','Candidate Issue','Client Issue','Billing Issue','Feature Request','General Support') NOT NULL,
    priority ENUM('Low','Medium','High','Urgent') NOT NULL,
    status ENUM('Open','In Progress','Waiting for User','Resolved','Closed') NOT NULL DEFAULT 'Open',
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    closed_at VARCHAR(40) NULL,
    INDEX idx_tickets_user (user_id),
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

  await query(`CREATE TABLE IF NOT EXISTS chat_channels (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description VARCHAR(500) NULL,
    type ENUM('public','private','direct') NOT NULL DEFAULT 'public',
    created_by VARCHAR(100) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    channel_id VARCHAR(100) NOT NULL,
    sender_id VARCHAR(100) NOT NULL,
    sender_name VARCHAR(255) NOT NULL,
    sender_role VARCHAR(50) NOT NULL,
    body LONGTEXT NOT NULL,
    attachment_name VARCHAR(500) NULL,
    attachment_type VARCHAR(255) NULL,
    attachment_size INT UNSIGNED NULL,
    attachment_data LONGTEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_chat_channel (channel_id),
    INDEX idx_chat_sender (sender_id),
    CONSTRAINT fk_chat_messages_channel FOREIGN KEY (channel_id) REFERENCES chat_channels(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  const defaultChannels = [
    ['general', 'general', 'General team discussion, announcements, and company news', 'public'],
    ['project-updates', 'project-updates', 'Live project progress, status updates, and deliverables', 'public'],
    ['creative-design', 'creative-design', 'Design feedback, creative assets, and review drafts', 'public'],
    ['client-support', 'client-support', 'Client coordination, queries, and rapid help desk', 'public']
  ];
  for (const [id, name, description, type] of defaultChannels) {
    await query(
      'INSERT IGNORE INTO chat_channels (id, name, description, type) VALUES (?, ?, ?, ?)',
      [id, name, description, type]
    );
  }
  await query("ALTER TABLE chat_channels MODIFY COLUMN type ENUM('public','private','direct') NOT NULL DEFAULT 'public'").catch(() => {});

  await initialiseRbacSchema();
  await seedRbacDefaults();
  await initialiseProductivitySchema();
  await seedProductivityDefaults();

  await query('INSERT IGNORE INTO settings (id, json) VALUES (1, ?)', [JSON.stringify(defaultSettings)]);
  await ensureEnvironmentSuperAdmin();
  const row = await one('SELECT COUNT(*) AS count FROM clients');
  if (envFlagEnabled(process.env.SEED_DEMO_DATA) && Number(row.count) === 0)
    await seed();
  if (envFlagEnabled(process.env.SEED_DEMO_USERS))
    await seedDemoUsers();
  await mapExistingUsersToRbac();
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

  await query("ALTER TABLE users MODIFY role ENUM('super_admin','admin','employee','client') NOT NULL DEFAULT 'client'");
  await query('ALTER TABLE support_ticket_messages MODIFY author_role VARCHAR(50) NOT NULL');

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

  await addColumnIfMissing('jobs', 'created_by_user_id', 'VARCHAR(100) NULL AFTER posted_by');
  await addColumnIfMissing('jobs', 'assigned_to_user_id', 'VARCHAR(100) NULL AFTER created_by_user_id');
  await addColumnIfMissing('jobs', 'assigned_by_user_id', 'VARCHAR(100) NULL AFTER assigned_to_user_id');
  await addColumnIfMissing('jobs', 'department_id', 'BIGINT UNSIGNED NULL AFTER assigned_by_user_id');
  await addColumnIfMissing('jobs', 'assignment_date', 'VARCHAR(40) NULL AFTER department_id');
  await addColumnIfMissing('jobs', 'assignment_note', 'TEXT NULL AFTER assignment_date');
  await addColumnIfMissing('jobs', 'delegation_status', "VARCHAR(30) NOT NULL DEFAULT 'none' AFTER assignment_note");
  await addColumnIfMissing('jobs', 'delegated_to_user_id', 'VARCHAR(100) NULL AFTER delegation_status');
  await addColumnIfMissing('jobs', 'delegated_by_user_id', 'VARCHAR(100) NULL AFTER delegated_to_user_id');
  await addColumnIfMissing('jobs', 'delegation_deadline', 'VARCHAR(40) NULL AFTER delegated_by_user_id');
  await addColumnIfMissing('jobs', 'delegation_note', 'TEXT NULL AFTER delegation_deadline');
  await addColumnIfMissing('jobs', 'delegation_share_percent', 'INT NOT NULL DEFAULT 100 AFTER delegation_note');
  await addColumnIfMissing('jobs', 'rejection_reason', 'TEXT NULL AFTER delegation_share_percent');

  await query(`CREATE TABLE IF NOT EXISTS job_assignments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    job_id VARCHAR(100) NOT NULL,
    previous_assignee_user_id VARCHAR(100) NULL,
    assigned_to_user_id VARCHAR(100) NULL,
    assigned_by_user_id VARCHAR(100) NOT NULL,
    previous_department_id BIGINT UNSIGNED NULL,
    department_id BIGINT UNSIGNED NULL,
    note TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_job_assignments_job (job_id, created_at),
    INDEX idx_job_assignments_assignee (assigned_to_user_id),
    CONSTRAINT fk_job_assignments_job FOREIGN KEY (job_id) REFERENCES jobs(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await addIndexIfMissing('users', 'idx_users_role_id', '(role_id)');
  await addIndexIfMissing('users', 'idx_users_account_type', '(account_type)');
  await addIndexIfMissing('users', 'idx_users_client_id', '(client_id)');
  await addIndexIfMissing('users', 'idx_users_department_id', '(department_id)');
  await addIndexIfMissing('users', 'idx_users_designation_id', '(designation_id)');
  await addIndexIfMissing('users', 'idx_users_manager_user_id', '(manager_user_id)');
  await addIndexIfMissing('clients', 'idx_clients_owner', '(account_owner_user_id)');
  await addIndexIfMissing('jobs', 'idx_jobs_assigned_to', '(assigned_to_user_id)');
  await addIndexIfMissing('jobs', 'idx_jobs_created_by', '(created_by_user_id)');
  await addIndexIfMissing('jobs', 'idx_jobs_department_id', '(department_id)');
  await addIndexIfMissing('jobs', 'idx_jobs_status', '(status)');
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

  await query(`INSERT IGNORE INTO departments (name,code,description,status)
    VALUES ('Operations','OPS','Default operations department','active')`);
  await query(`INSERT IGNORE INTO designations (name,code,description,hierarchy_level,status)
    VALUES ('Team Member','TEAM_MEMBER','Default internal team designation',10,'active')`);
}

async function mapExistingUsersToRbac() {
  await query("UPDATE users SET account_type='super_admin', role_id='super_admin' WHERE role='super_admin' OR account_type='super_admin'");
  await query("UPDATE users SET account_type='admin', role_id='admin' WHERE role='admin' OR name IN ('Pramit', 'Aashit', 'Urna')");

  // Ensure internal company employees (e.g. Meshwa Kadia, Mansi, John, etc.) have employee role
  const teamMemberNames = [
    'Meshwa', 'Meshwa Kadia', 'Mansi', 'Chitra', 'Arushi', 'Manan', 'Mary', 'Ajay',
    'Aarya', 'Aadya', 'John', 'Dhawal', 'Ekta', 'Khushi', 'Reehan', 'Pradeep',
    'Harshada', 'Arjun', 'Shalini', 'External'
  ];
  for (const name of teamMemberNames) {
    await query(
      "UPDATE users SET account_type='employee', role='employee', role_id='employee', client_id=NULL WHERE (name LIKE ? OR email LIKE ?) AND account_type!='super_admin' AND name NOT IN ('Pramit', 'Aashit', 'Urna')",
      [`%${name}%`, `%${name.toLowerCase().replace(/[^a-z]/g, '')}%@360degrees.com`]
    );
  }

  // Ensure anyone with employee settings is mapped to employee
  await query(`
    UPDATE users u
    JOIN productivity_employee_settings pes ON pes.user_id = u.id
    SET u.account_type = CASE WHEN u.name IN ('Pramit', 'Aashit', 'Urna') THEN 'admin' ELSE 'employee' END,
        u.role = CASE WHEN u.name IN ('Pramit', 'Aashit', 'Urna') THEN 'admin' ELSE 'employee' END,
        u.role_id = CASE WHEN u.name IN ('Pramit', 'Aashit', 'Urna') THEN 'admin' ELSE 'employee' END,
        u.client_id = NULL
    WHERE u.account_type != 'super_admin'
  `);

  // Ensure every active client in clients has a login row in users
  await query(`
    INSERT INTO users (id, name, email, phone, password_hash, role, account_type, role_id, client_id, status, created_at, updated_at)
    SELECT c.id, COALESCE(c.contact_name, c.name), c.email, c.phone, c.password_hash, 'client', 'client', 'client', c.id, 'active', NOW(), NOW()
    FROM clients c
    WHERE c.status='active' AND c.password_hash IS NOT NULL AND c.password_hash != ''
    ON DUPLICATE KEY UPDATE
      client_id = VALUES(client_id),
      password_hash = CASE WHEN users.password_hash IS NULL OR users.password_hash='' THEN VALUES(password_hash) ELSE users.password_hash END,
      role = CASE WHEN users.account_type IN ('admin', 'super_admin', 'employee') THEN users.role ELSE 'client' END,
      account_type = CASE WHEN users.account_type IN ('admin', 'super_admin', 'employee') THEN users.account_type ELSE 'client' END,
      role_id = CASE WHEN users.account_type IN ('admin', 'super_admin', 'employee') THEN users.role_id ELSE 'client' END
  `);

  const defaultPasswordHash = await bcrypt.hash('CI360Demo#2026', 12);
  await query(
    "UPDATE users SET password_hash = ? WHERE password_hash IS NULL OR password_hash = '' OR password_hash LIKE '$2a$10$wO/4y6qg%' OR LENGTH(password_hash) < 50",
    [defaultPasswordHash]
  );

  await query("UPDATE users SET account_type='client', role_id='client' WHERE (role='client' OR account_type='client') AND (role_id IS NULL OR role_id='' OR role_id='client') AND email NOT LIKE '%@360degrees.com'");
  await query("UPDATE users SET account_type=role WHERE account_type IS NULL");
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
    await query('INSERT INTO users (id,name,password_hash,role,client_id) VALUES (?,?,?,?,?)', ['ci360admin', 'Workspace Team', adminHash, 'admin', null], connection);
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
        name: 'Workspace Team',
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

export async function initialiseProductivitySchema() {
  await query(`CREATE TABLE IF NOT EXISTS productivity_services (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    reference_hours DECIMAL(6,2) NOT NULL DEFAULT 10.00,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by_user_id VARCHAR(100) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_prod_services_active (is_active)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS productivity_employee_settings (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL UNIQUE,
    custom_duties TEXT NULL,
    weekly_capacity_hours DECIMAL(6,2) NOT NULL DEFAULT 40.00,
    productivity_status ENUM('active','intern','vendor','inactive') NOT NULL DEFAULT 'active',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_prod_emp_status (productivity_status),
    CONSTRAINT fk_prod_emp_user FOREIGN KEY (user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Safe schema migration for existing databases missing custom_duties
  try {
    const cols = await query(`SHOW COLUMNS FROM productivity_employee_settings LIKE 'custom_duties'`);
    if (cols.length === 0) {
      await query(`ALTER TABLE productivity_employee_settings ADD COLUMN custom_duties TEXT NULL AFTER user_id`);
    }
  } catch (err) {
    console.warn('[DB Migration] custom_duties column check/add:', err.message);
  }

  await query(`CREATE TABLE IF NOT EXISTS productivity_external_resources (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    status ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS productivity_jobs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    core_job_id VARCHAR(100) NULL,
    client_id VARCHAR(100) NOT NULL,
    start_date VARCHAR(40) NOT NULL,
    completion_date VARCHAR(40) NULL,
    value_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    description LONGTEXT NULL,
    created_by_user_id VARCHAR(100) NOT NULL,
    deleted_at DATETIME(3) NULL,
    deleted_by_user_id VARCHAR(100) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_prod_jobs_client (client_id),
    INDEX idx_prod_jobs_start (start_date),
    INDEX idx_prod_jobs_completion (completion_date),
    INDEX idx_prod_jobs_deleted (deleted_at),
    CONSTRAINT fk_prod_jobs_client FOREIGN KEY (client_id) REFERENCES clients(id)
      ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_prod_jobs_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Safe schema migrations for existing databases with missing productivity_jobs columns
  try {
    const cols = await query(`SHOW COLUMNS FROM productivity_jobs LIKE 'deleted_at'`);
    if (cols.length === 0) {
      await query(`ALTER TABLE productivity_jobs ADD COLUMN deleted_at DATETIME(3) NULL AFTER created_by_user_id`);
      await query(`ALTER TABLE productivity_jobs ADD INDEX idx_prod_jobs_deleted (deleted_at)`);
    }
  } catch (err) {
    console.warn('[DB Migration] deleted_at column check/add:', err.message);
  }

  try {
    const cols = await query(`SHOW COLUMNS FROM productivity_jobs LIKE 'deleted_by_user_id'`);
    if (cols.length === 0) {
      await query(`ALTER TABLE productivity_jobs ADD COLUMN deleted_by_user_id VARCHAR(100) NULL AFTER deleted_at`);
    }
  } catch (err) {
    console.warn('[DB Migration] deleted_by_user_id column check/add:', err.message);
  }

  try {
    const cols = await query(`SHOW COLUMNS FROM productivity_jobs LIKE 'core_job_id'`);
    if (cols.length === 0) {
      await query(`ALTER TABLE productivity_jobs ADD COLUMN core_job_id VARCHAR(100) NULL AFTER id`);
    }
  } catch (err) {
    console.warn('[DB Migration] core_job_id column check/add:', err.message);
  }

  await query(`CREATE TABLE IF NOT EXISTS productivity_job_services (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    productivity_job_id BIGINT UNSIGNED NOT NULL,
    service_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_prod_job_service (productivity_job_id, service_id),
    INDEX idx_prod_job_svc_service (service_id),
    CONSTRAINT fk_prod_job_svc_job FOREIGN KEY (productivity_job_id) REFERENCES productivity_jobs(id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_prod_job_svc_svc FOREIGN KEY (service_id) REFERENCES productivity_services(id)
      ON UPDATE CASCADE ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS productivity_job_assignments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    productivity_job_id BIGINT UNSIGNED NOT NULL,
    user_id VARCHAR(100) NULL,
    external_resource_id BIGINT UNSIGNED NULL,
    revenue_percent DECIMAL(5,2) NOT NULL DEFAULT 100.00,
    hours_spent DECIMAL(6,2) NOT NULL DEFAULT 0.00,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_prod_job_assign_user (user_id),
    INDEX idx_prod_job_assign_job (productivity_job_id),
    CONSTRAINT fk_prod_assign_job FOREIGN KEY (productivity_job_id) REFERENCES productivity_jobs(id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_prod_assign_user FOREIGN KEY (user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_prod_assign_ext FOREIGN KEY (external_resource_id) REFERENCES productivity_external_resources(id)
      ON UPDATE CASCADE ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Safe schema migrations for existing databases with missing productivity_job_assignments columns
  try {
    const cols = await query(`SHOW COLUMNS FROM productivity_job_assignments LIKE 'external_resource_id'`);
    if (cols.length === 0) {
      await query(`ALTER TABLE productivity_job_assignments ADD COLUMN external_resource_id BIGINT UNSIGNED NULL AFTER user_id`);
      try {
        await query(`ALTER TABLE productivity_job_assignments ADD CONSTRAINT fk_prod_assign_ext FOREIGN KEY (external_resource_id) REFERENCES productivity_external_resources(id) ON UPDATE CASCADE ON DELETE SET NULL`);
      } catch (fkErr) {
        console.warn('[DB Migration] fk_prod_assign_ext add:', fkErr.message);
      }
    }
  } catch (err) {
    console.warn('[DB Migration] external_resource_id column check/add:', err.message);
  }

  await query(`CREATE TABLE IF NOT EXISTS productivity_account_rosters (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_id VARCHAR(100) NOT NULL UNIQUE,
    nature ENUM('Existing','Prospect') NOT NULL DEFAULT 'Existing',
    difficulty TINYINT UNSIGNED NOT NULL DEFAULT 5,
    comments TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_prod_roster_nature (nature),
    INDEX idx_prod_roster_diff (difficulty),
    CONSTRAINT fk_prod_roster_client FOREIGN KEY (client_id) REFERENCES clients(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  try {
    const cols = await query(`SHOW COLUMNS FROM productivity_account_rosters LIKE 'difficulty'`);
    if (cols.length === 0) {
      await query(`ALTER TABLE productivity_account_rosters ADD COLUMN difficulty TINYINT UNSIGNED NOT NULL DEFAULT 5 AFTER nature`);
    }
  } catch (err) {
    console.warn('[DB Migration] difficulty column check/add:', err.message);
  }

  try {
    const cols = await query(`SHOW COLUMNS FROM productivity_account_rosters LIKE 'comments'`);
    if (cols.length === 0) {
      await query(`ALTER TABLE productivity_account_rosters ADD COLUMN comments TEXT NULL AFTER difficulty`);
    }
  } catch (err) {
    console.warn('[DB Migration] comments column check/add:', err.message);
  }

  try {
    const cols = await query(`SHOW COLUMNS FROM productivity_employee_settings LIKE 'custom_duties'`);
    if (cols.length === 0) {
      await query(`ALTER TABLE productivity_employee_settings ADD COLUMN custom_duties TEXT NULL AFTER weekly_capacity_hours`);
    }
  } catch (err) {
    console.warn('[DB Migration] custom_duties column check/add:', err.message);
  }

  await query(`CREATE TABLE IF NOT EXISTS productivity_account_roster_assignments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    roster_id BIGINT UNSIGNED NOT NULL,
    responsibility_key ENUM('strategy','cs','website','design','copy','edit','shoot','seo','smo','qc') NOT NULL,
    assignee_type ENUM('employee','external','tbd') NOT NULL DEFAULT 'employee',
    user_id VARCHAR(100) NULL,
    external_name VARCHAR(255) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_prod_roster_assign_user (user_id),
    INDEX idx_prod_roster_assign_resp (responsibility_key),
    CONSTRAINT fk_prod_roster_asgn_roster FOREIGN KEY (roster_id) REFERENCES productivity_account_rosters(id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_prod_roster_asgn_user FOREIGN KEY (user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS productivity_targets (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,
    service_id BIGINT UNSIGNED NULL,
    quantity DECIMAL(8,2) NOT NULL DEFAULT 1.00,
    unit ENUM('count','hours') NOT NULL DEFAULT 'count',
    period ENUM('day','week','month') NOT NULL DEFAULT 'week',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by_user_id VARCHAR(100) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_prod_targets_user (user_id),
    INDEX idx_prod_targets_service (service_id),
    INDEX idx_prod_targets_active (is_active),
    CONSTRAINT fk_prod_target_user FOREIGN KEY (user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_prod_target_service FOREIGN KEY (service_id) REFERENCES productivity_services(id)
      ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_prod_target_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS productivity_salary_grades (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    owner_user_id VARCHAR(100) NOT NULL,
    label VARCHAR(100) NOT NULL,
    min_amount DECIMAL(14,2) NOT NULL,
    max_amount DECIMAL(14,2) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_prod_salary_owner (owner_user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS productivity_salary_assignments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    owner_user_id VARCHAR(100) NOT NULL,
    employee_user_id VARCHAR(100) NOT NULL,
    grade_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_prod_sal_asgn (owner_user_id, employee_user_id),
    INDEX idx_prod_sal_asgn_emp (employee_user_id),
    CONSTRAINT fk_prod_sal_asgn_user FOREIGN KEY (employee_user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_prod_sal_asgn_grade FOREIGN KEY (grade_id) REFERENCES productivity_salary_grades(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

export async function seedProductivityDefaults() {
  const defaultServices = [
    ['Website (full build)', 45.00],
    ['Connector Apps / Small Web Additions', 3.00],
    ['Social Media Optimisation', 18.00],
    ['Design — Brochures / Emailers', 4.00],
    ['Standees / Backdrops / Advertisements', 3.00],
    ['Films & Edits', 10.00],
    ['AI-enabled Animation / Motion Graphics', 8.00],
    ['Reels & Shorts', 4.00],
    ['Podcasts (per episode)', 6.00],
    ['Strategy & Presentations', 8.00],
    ['Business Development', 5.00],
    ['Paper Advertisement Design', 3.00],
    ['Other Design Interventions', 3.00],
    ['Photography / Filming (per shoot day)', 8.00]
  ];

  const serviceCount = await query('SELECT COUNT(*) as count FROM productivity_services');
  if (Number(serviceCount[0]?.count || 0) < 14) {
    for (const [name, refHours] of defaultServices) {
      await query(
        'INSERT INTO productivity_services (name, reference_hours, is_active) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE reference_hours = VALUES(reference_hours)',
        [name, refHours]
      );
    }
  }

  // Seed default salary grades for system owner / super_admin
  const defaultSalaryGrades = [
    ['Grade A', 0.00, 25000.00],
    ['Grade B', 25000.00, 45000.00],
    ['Grade C', 45000.00, 75000.00],
    ['Grade D', 75000.00, 125000.00],
    ['Grade E', 125000.00, 200000.00]
  ];

  const adminUser = await one("SELECT id FROM users WHERE account_type='super_admin' OR role='super_admin' LIMIT 1");
  const ownerId = adminUser ? adminUser.id : 'superadmin';

  const existingGrades = await query('SELECT COUNT(*) as count FROM productivity_salary_grades WHERE owner_user_id=?', [ownerId]);
  if (Number(existingGrades[0]?.count || 0) === 0) {
    for (const [label, min, max] of defaultSalaryGrades) {
      await query(
        'INSERT INTO productivity_salary_grades (owner_user_id, label, min_amount, max_amount) VALUES (?, ?, ?, ?)',
        [ownerId, label, min, max]
      );
    }
  }

  // 22 Default Personnel
  const personnelCount = await query('SELECT COUNT(*) as count FROM productivity_employee_settings');
  if (Number(personnelCount[0]?.count || 0) < 20) {
    const defaultPersonnel = [
      { name: 'Pramit', email: 'pramit@360degrees.com', duties: 'Founder, Strategy, Business Development, Content Management', capacity: 48, status: 'active', role: 'admin' },
      { name: 'Aashit', email: 'aashit@360degrees.com', duties: 'Founder, Business Development, Finance', capacity: 48, status: 'active', role: 'admin' },
      { name: 'Urna', email: 'urna@360degrees.com', duties: 'COO, CS, Content, Operations, Billing, Overall Supervision', capacity: 48, status: 'active', role: 'admin' },
      { name: 'Mansi', email: 'mansi@360degrees.com', duties: 'Strategy, BD, Content, Backup to Pramit, CS', capacity: 48, status: 'active', role: 'employee' },
      { name: 'Chitra', email: 'chitra@360degrees.com', duties: 'CS, SMO', capacity: 48, status: 'active', role: 'employee' },
      { name: 'Arushi', email: 'arushi@360degrees.com', duties: 'SMO', capacity: 48, status: 'active', role: 'employee' },
      { name: 'Manan', email: 'manan@360degrees.com', duties: 'CS, Creative Lead', capacity: 48, status: 'active', role: 'employee' },
      { name: 'Mary', email: 'mary@360degrees.com', duties: 'Creatives, Animations, AI, Editing of Reels etc, Storytelling', capacity: 48, status: 'active', role: 'employee' },
      { name: 'Ajay', email: 'ajay@360degrees.com', duties: 'Editing', capacity: 48, status: 'active', role: 'employee' },
      { name: 'Aarya', email: 'aarya@360degrees.com', duties: 'Graphics, Creative', capacity: 48, status: 'active', role: 'employee' },
      { name: 'Aadya', email: 'aadya@360degrees.com', duties: 'Graphics, Creative', capacity: 48, status: 'active', role: 'employee' },
      { name: 'John', email: 'john@360degrees.com', duties: 'Websites — All of them, Quality Control', capacity: 48, status: 'active', role: 'employee' },
      { name: 'Meshwa', email: 'meshwa@360degrees.com', duties: 'Website Support', capacity: 48, status: 'active', role: 'employee' },
      { name: 'Dhawal', email: 'dhawal@360degrees.com', duties: 'Not currently functioning — part of the team', capacity: 48, status: 'inactive', role: 'employee' },
      { name: 'Ekta', email: 'ekta@360degrees.com', duties: 'Accounts', capacity: 48, status: 'active', role: 'employee' },
      { name: 'Khushi', email: 'khushi@360degrees.com', duties: 'Operations (intern, just joined)', capacity: 48, status: 'intern', role: 'employee' },
      { name: 'Reehan', email: 'reehan@360degrees.com', duties: 'Websites — part of (intern)', capacity: 48, status: 'intern', role: 'employee' },
      { name: 'Pradeep', email: 'pradeep@360degrees.com', duties: 'Websites', capacity: 48, status: 'active', role: 'employee' },
      { name: 'Harshada', email: 'harshada@360degrees.com', duties: 'SEO', capacity: 48, status: 'active', role: 'employee' },
      { name: 'Arjun', email: 'arjun@360degrees.com', duties: 'Business Development, Prospect Pitching', capacity: 48, status: 'active', role: 'employee' },
      { name: 'Shalini', email: 'shalini@360degrees.com', duties: 'Business Development, Prospect Pitching', capacity: 48, status: 'active', role: 'employee' },
      { name: 'External', email: 'external@360degrees.com', duties: 'SEO and other requirements, as needed', capacity: 48, status: 'vendor', role: 'employee' }
    ];

    const defaultHash = await bcrypt.hash('CI360Demo#2026', 12);

    // 1. Query existing users once to avoid 50+ round trips
    const existingUsers = await query('SELECT id, name, email FROM users');
    const userByEmail = new Map(existingUsers.map(u => [String(u.email || '').toLowerCase(), u]));
    const userByName = new Map(existingUsers.map(u => [String(u.name || '').toLowerCase(), u]));

    for (const p of defaultPersonnel) {
      let user = userByEmail.get(p.email.toLowerCase()) || userByName.get(p.name.toLowerCase());
      let userId = user ? user.id : null;
      if (!userId) {
        userId = p.name.toLowerCase().replace(/[^a-z0-9]/g, '') + '_' + Math.random().toString(36).slice(2, 7);
        await query(
          'INSERT INTO users (id, name, email, password_hash, role, account_type, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [userId, p.name, p.email, defaultHash, p.role, p.role === 'admin' ? 'admin' : 'employee', p.status !== 'inactive' ? 'active' : 'inactive']
        );
        user = { id: userId, name: p.name, email: p.email };
        userByEmail.set(p.email.toLowerCase(), user);
        userByName.set(p.name.toLowerCase(), user);
      }
      // Update or insert employee settings
      await query(
        `INSERT INTO productivity_employee_settings (user_id, custom_duties, weekly_capacity_hours, productivity_status)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE custom_duties=VALUES(custom_duties), weekly_capacity_hours=VALUES(weekly_capacity_hours), productivity_status=VALUES(productivity_status)`,
        [userId, p.duties, p.capacity, p.status]
      );
    }
  }

  // 35 Default Roster Clients
  const defaultRoster = [
    { clientName: 'Vardan', nature: 'Existing', roles: { strategy: 'Urna', cs: 'Urna', website: 'John', design: 'Mary', copy: 'Urna', edit: 'Manan', shoot: '', seo: 'Harshada', smo: 'Arushi', qc: 'John' }, difficulty: 5, comments: 'Maintenance' },
    { clientName: 'Shatayu', nature: 'Existing', roles: { strategy: 'Urna', cs: 'Chitra', website: 'John', design: 'Mary', copy: 'Chitra, Urna', edit: 'Mary', shoot: '', seo: '', smo: 'Chitra', qc: 'John' }, difficulty: 4, comments: 'Maintenance' },
    { clientName: 'Crave', nature: 'Existing', roles: { strategy: 'Urna', cs: 'Chitra', website: '', design: 'Aadya', copy: 'Chitra, Urna', edit: 'Mary', shoot: '', seo: '', smo: 'Chitra', qc: 'John' }, difficulty: 4, comments: 'Maintenance' },
    { clientName: 'VNA', nature: 'Existing', roles: { strategy: 'Pramit', cs: 'Mansi', website: 'John', design: 'Aarya', copy: 'Pramit, Mansi', edit: 'Ajay', shoot: 'External', seo: 'Harshada', smo: 'Arushi', qc: 'John' }, difficulty: 8, comments: 'Website work needs a lot of work as does Reels and content' },
    { clientName: 'Shree Sawa', nature: 'Existing', roles: { strategy: 'Mansi', cs: 'Mansi', website: 'John', design: 'Aadya', copy: 'Mansi, Chitra', edit: 'External', shoot: 'External', seo: '', smo: 'Arushi', qc: 'John' }, difficulty: 6, comments: 'Website needs to be completed in 3 weeks' },
    { clientName: 'Thehrav', nature: 'Existing', roles: { strategy: 'Mansi', cs: 'Mansi', website: '', design: '', copy: 'Pramit', edit: 'Manan', shoot: 'External', seo: '', smo: 'Arushi', qc: 'John' }, difficulty: 4, comments: 'Occasional' },
    { clientName: 'LEOZ', nature: 'Existing', roles: { strategy: 'Pramit, Mansi', cs: 'Pramit', website: 'John', design: '', copy: '', edit: '', shoot: '', seo: '', smo: '', qc: 'John' }, difficulty: 6, comments: 'Need to change the website for payment to be made' },
    { clientName: 'PIV', nature: 'Existing', roles: { strategy: 'Pramit', cs: 'Mansi', website: 'John, External', design: 'Aarya, Manan', copy: 'Pramit, Mansi', edit: 'Ajay', shoot: 'External', seo: 'Harshada', smo: 'Arushi', qc: 'John' }, difficulty: 9, comments: 'This will bring in huge pressures with time - loads of shoots, strategy and event' },
    { clientName: 'Chaitanya', nature: 'Existing', roles: { strategy: 'Mansi', cs: 'Chitra', website: 'John', design: 'Aarya', copy: 'Chitra', edit: 'Ajay', shoot: 'External', seo: 'Harshada', smo: 'Arushi', qc: 'John' }, difficulty: 7, comments: 'This is also a high pressure time consuming account' },
    { clientName: 'Media Buzz', nature: 'Existing', roles: { strategy: 'Chitra', cs: 'Chitra', website: 'John', design: 'Mary', copy: 'Chitra', edit: 'Mary', shoot: 'External', seo: '', smo: 'Chitra', qc: 'John' }, difficulty: 6, comments: 'This is for our sister company' },
    { clientName: 'Times Abroad', nature: 'Existing', roles: { strategy: 'Mansi, Pramit', cs: 'Mansi', website: '', design: 'Aadya', copy: 'Pramit, Mansi', edit: '', shoot: '', seo: '', smo: 'Arushi', qc: 'John' }, difficulty: 3, comments: 'Ongoing' },
    { clientName: 'Times Property', nature: 'Existing', roles: { strategy: 'Mansi', cs: 'Mansi', website: '', design: 'Manan', copy: 'Mansi', edit: '', shoot: '', seo: '', smo: 'Arushi', qc: 'John' }, difficulty: 4, comments: 'Ongoing' },
    { clientName: 'Times MSME', nature: 'Existing', roles: { strategy: 'Mansi', cs: 'Mansi', website: '', design: 'Manan', copy: 'Mansi', edit: '', shoot: '', seo: '', smo: 'Arushi', qc: 'John' }, difficulty: 8, comments: 'Yet to launch' },
    { clientName: 'Times Mike Drop', nature: 'Existing', roles: { strategy: 'Mansi', cs: 'Mansi', website: '', design: 'Manan', copy: 'Pramit, Mansi', edit: '', shoot: '', seo: '', smo: 'Arushi', qc: 'John' }, difficulty: 8, comments: 'Yet to launch' },
    { clientName: 'Ananta', nature: 'Existing', roles: { strategy: 'Urna', cs: 'Urna', website: 'John', design: 'Manan', copy: 'Urna', edit: 'Ajay', shoot: '', seo: '', smo: 'Arushi', qc: 'John' }, difficulty: 7, comments: 'Website just launched - high pressure' },
    { clientName: 'Ananta Aspen', nature: 'Existing', roles: { strategy: 'Urna', cs: 'Urna', website: 'John', design: 'Manan', copy: 'Urna', edit: 'Ajay', shoot: '', seo: '', smo: 'Arushi', qc: 'John' }, difficulty: 7, comments: 'Website just launched - high pressure' },
    { clientName: 'IUF', nature: 'Existing', roles: { strategy: 'Urna', cs: 'Urna', website: 'John', design: '', copy: 'Urna, John', edit: '', shoot: '', seo: '', smo: '', qc: 'John' }, difficulty: 2, comments: 'Website launched' },
    { clientName: 'Gaudiya', nature: 'Existing', roles: { strategy: 'Urna', cs: 'Urna', website: 'John', design: 'Aarya', copy: 'Pramit, Urna', edit: 'Ajay', shoot: '', seo: 'External', smo: 'Arushi', qc: 'John' }, difficulty: 9, comments: 'In Bengali, English, 3 websites - yet to be made - high pressure and high frequency' },
    { clientName: 'Brinzz', nature: 'Existing', roles: { strategy: 'Pramit, Mansi, Urna', cs: 'Pramit', website: 'TBD', design: 'TBD', copy: 'Pramit', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'John' }, difficulty: 6, comments: 'Brand approvals delayed due to government regulations. Will come back in full - SMO, website, brand book - by end of June' },
    { clientName: 'Station Satcom', nature: 'Existing', roles: { strategy: 'Mansi, Pramit', cs: 'Mansi, Manan', website: 'John', design: 'Manan', copy: 'Mansi, Urna', edit: 'Ajay', shoot: '', seo: 'Harshada', smo: 'Arushi', qc: 'John' }, difficulty: 8, comments: 'New website to be delivered by 10th of July - rest in maintenance mode. E-Retail strategy etc to be submitted' },
    { clientName: 'Gharenu', nature: 'Prospect', roles: { strategy: 'Pramit, Mansi, Urna', cs: 'Mansi', website: 'John, External', design: 'Manan', copy: 'Pramit, Mansi, Urna', edit: '', shoot: 'External', seo: 'External', smo: 'Arushi', qc: 'John' }, difficulty: 8, comments: 'Yet to launch' },
    { clientName: 'Goa', nature: 'Prospect', roles: { strategy: 'Pramit, Arjun', cs: 'Mansi', website: '', design: 'TBD', copy: 'TBD', edit: 'External', shoot: 'External', seo: '', smo: 'TBD', qc: 'TBD' }, difficulty: 10, comments: 'In the pitching stage' },
    { clientName: 'The Bottle Shop', nature: 'Prospect', roles: { strategy: 'Pramit', cs: 'Mansi', website: 'John', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' }, difficulty: 8, comments: '6000 SKU website to be developed on Shopify by John - will take time. SMO as well' },
    { clientName: 'Kumbh Mela', nature: 'Prospect', roles: { strategy: 'Pramit, Arjun', cs: 'TBD', website: 'TBD', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' }, difficulty: 8, comments: 'Pre-pitch stage' },
    { clientName: 'Haryana Projects', nature: 'Prospect', roles: { strategy: 'Pramit, Arjun', cs: 'TBD', website: 'TBD', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' }, difficulty: 8, comments: 'Pre-pitch stage' },
    { clientName: 'MMCF', nature: 'Prospect', roles: { strategy: 'Pramit, Aashit', cs: 'TBD', website: 'TBD', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' }, difficulty: 10, comments: 'Discussion stage. When it comes there will be 3 websites and SMO' },
    { clientName: 'Dhanda.ai', nature: 'Prospect', roles: { strategy: 'Pramit, Shalini', cs: 'TBD', website: 'TBD', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' }, difficulty: 6, comments: 'Discussion stage' },
    { clientName: 'Signo', nature: 'Prospect', roles: { strategy: 'Pramit, Shalini', cs: 'TBD', website: 'TBD', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' }, difficulty: 8, comments: 'Pre-pitch stage' },
    { clientName: 'Tolvv Sign', nature: 'Prospect', roles: { strategy: 'Mansi', cs: 'TBD', website: 'TBD', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' }, difficulty: 7, comments: 'Pre-pitch stage' },
    { clientName: 'Matrix Book Cover', nature: 'Prospect', roles: { strategy: 'Mansi', cs: 'TBD', website: 'TBD', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' }, difficulty: 6, comments: 'Pre-pitch stage' },
    { clientName: 'Samunnati', nature: 'Prospect', roles: { strategy: 'Urna, Pramit', cs: 'TBD', website: 'TBD', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' }, difficulty: 6, comments: 'Follow up stage' },
    { clientName: 'Interview Box', nature: 'Prospect', roles: { strategy: 'Pramit, Mansi', cs: 'TBD', website: 'TBD', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' }, difficulty: 6, comments: 'Follow up stage' },
    { clientName: 'Katrankari', nature: 'Prospect', roles: { strategy: 'Pramit, Mansi', cs: 'TBD', website: 'TBD', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' }, difficulty: 6, comments: 'Pre-pitch stage' },
    { clientName: 'IFB', nature: 'Prospect', roles: { strategy: 'Pramit, Manan', cs: 'Manan', website: '', design: '', copy: '', edit: '', shoot: '', seo: 'TBD', smo: '', qc: 'TBD' }, difficulty: 10, comments: 'Pre-pitch stage' },
    { clientName: 'Network 18', nature: 'Prospect', roles: { strategy: 'Pramit', cs: 'TBD', website: 'TBD', design: 'TBD', copy: 'TBD', edit: 'TBD', shoot: 'TBD', seo: 'TBD', smo: 'TBD', qc: 'TBD' }, difficulty: 10, comments: 'Quotation submitted' }
  ];

  const existingRosters = await query('SELECT COUNT(*) as count FROM productivity_account_rosters');
  if (Number(existingRosters[0]?.count || 0) === 0) {
    const existingClients = await query('SELECT id, name FROM clients');
    const clientByName = new Map(existingClients.map(c => [String(c.name || '').toLowerCase(), c.id]));

    for (const r of defaultRoster) {
      let clientId = clientByName.get(r.clientName.toLowerCase());
      if (!clientId) {
        clientId = r.clientName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'c_' + Math.random().toString(36).slice(2, 6);
        await query(
          'INSERT INTO clients (id, name, status, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW()) ON DUPLICATE KEY UPDATE name=VALUES(name)',
          [clientId, r.clientName, 'active']
        );
        clientByName.set(r.clientName.toLowerCase(), clientId);
      }

      const res = await query(
        'INSERT INTO productivity_account_rosters (client_id, nature, difficulty, comments) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE nature=VALUES(nature), difficulty=VALUES(difficulty), comments=VALUES(comments)',
        [clientId, r.nature, r.difficulty, r.comments]
      );
      const rosterId = res.insertId || (await one('SELECT id FROM productivity_account_rosters WHERE client_id=?', [clientId]))?.id;

      if (rosterId) {
        await query('DELETE FROM productivity_account_roster_assignments WHERE roster_id=?', [rosterId]);
        for (const [funcKey, names] of Object.entries(r.roles)) {
          if (names && names.trim()) {
            const rawNames = names.split(',').map(s => s.trim()).filter(Boolean);
            for (const nameItem of rawNames) {
              let assigneeType = 'employee';
              let targetUserId = null;
              let externalName = null;

              if (nameItem.toLowerCase() === 'external') {
                assigneeType = 'external';
                externalName = 'External';
              } else if (nameItem.toLowerCase() === 'tbd') {
                assigneeType = 'tbd';
                externalName = 'TBD';
              } else {
                const userMatch = userByName.get(nameItem.toLowerCase());
                if (userMatch) {
                  targetUserId = userMatch.id;
                  assigneeType = 'employee';
                } else {
                  assigneeType = 'external';
                  externalName = nameItem;
                }
              }

              await query(
                `INSERT INTO productivity_account_roster_assignments (roster_id, responsibility_key, assignee_type, user_id, external_name)
                 VALUES (?, ?, ?, ?, ?)`,
                [rosterId, funcKey, assigneeType, targetUserId, externalName]
              );
            }
          }
        }
      }
    }
  }

  // Seed Demo Productivity Jobs if fewer than 3 exist
  const existingProdJobs = await query('SELECT COUNT(*) as count FROM productivity_jobs WHERE deleted_at IS NULL');
  if (Number(existingProdJobs[0]?.count || 0) < 3) {
    const demoJobsData = [
      {
        clientName: 'VNA',
        startDate: '2026-08-02',
        completionDate: '2026-08-14',
        valueAmount: 85000,
        description: 'Website Rebuild, Brand Content & Reels Campaign',
        services: ['Website (full build)', 'Reels & Shorts'],
        assignments: [
          { name: 'John', percent: 50, hours: 28 },
          { name: 'Ajay', percent: 25, hours: 14 },
          { name: 'Mansi', percent: 25, hours: 8 }
        ]
      },
      {
        clientName: 'Vardan',
        startDate: '2026-08-04',
        completionDate: '2026-08-15',
        valueAmount: 45000,
        description: 'Website Optimization & Maintenance Sprint',
        services: ['Website (full build)', 'Connector Apps / Small Web Additions'],
        assignments: [
          { name: 'John', percent: 60, hours: 20 },
          { name: 'Urna', percent: 40, hours: 10 }
        ]
      },
      {
        clientName: 'Shatayu',
        startDate: '2026-08-05',
        completionDate: null,
        valueAmount: 35000,
        description: 'Monthly Social Media Optimization & Design Creatives',
        services: ['Social Media Optimisation', 'Design — Brochures / Emailers'],
        assignments: [
          { name: 'Chitra', percent: 60, hours: 18 },
          { name: 'Mary', percent: 40, hours: 12 }
        ]
      },
      {
        clientName: 'PIV',
        startDate: '2026-08-06',
        completionDate: null,
        valueAmount: 120000,
        description: 'High-Pressure Event Strategy, Video Shoots & Multi-Asset Content',
        services: ['Strategy & Presentations', 'Films & Edits', 'AI-enabled Animation / Motion Graphics'],
        assignments: [
          { name: 'Pramit', percent: 40, hours: 22 },
          { name: 'Ajay', percent: 30, hours: 18 },
          { name: 'Aarya', percent: 30, hours: 16 }
        ]
      },
      {
        clientName: 'Shree Sawa',
        startDate: '2026-08-08',
        completionDate: null,
        valueAmount: 60000,
        description: '3-Week Website Launch Deliverable & Creatives',
        services: ['Website (full build)', 'Design — Brochures / Emailers'],
        assignments: [
          { name: 'John', percent: 65, hours: 26 },
          { name: 'Aadya', percent: 35, hours: 14 }
        ]
      },
      {
        clientName: 'Station Satcom',
        startDate: '2026-08-10',
        completionDate: null,
        valueAmount: 95000,
        description: 'New Website Platform & E-Retail Strategy',
        services: ['Website (full build)', 'Strategy & Presentations'],
        assignments: [
          { name: 'John', percent: 50, hours: 24 },
          { name: 'Mansi', percent: 30, hours: 12 },
          { name: 'Manan', percent: 20, hours: 8 }
        ]
      },
      {
        clientName: 'Gaudiya',
        startDate: '2026-08-11',
        completionDate: null,
        valueAmount: 110000,
        description: '3 Multilingual Web Portals (Bengali & English)',
        services: ['Website (full build)', 'Films & Edits'],
        assignments: [
          { name: 'John', percent: 50, hours: 32 },
          { name: 'Urna', percent: 25, hours: 12 },
          { name: 'Ajay', percent: 25, hours: 12 }
        ]
      },
      {
        clientName: 'Media Buzz',
        startDate: '2026-08-12',
        completionDate: '2026-08-16',
        valueAmount: 30000,
        description: 'Sister Company SMO & Reel Campaigns',
        services: ['Social Media Optimisation', 'Reels & Shorts'],
        assignments: [
          { name: 'Chitra', percent: 50, hours: 14 },
          { name: 'Mary', percent: 50, hours: 14 }
        ]
      }
    ];

    for (const d of demoJobsData) {
      let client = await one('SELECT id FROM clients WHERE name=?', [d.clientName]);
      if (!client) {
        const cId = d.clientName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'c_demo';
        await query('INSERT INTO clients (id, name, status, created_at, updated_at) VALUES (?, ?, "active", NOW(), NOW())', [cId, d.clientName]);
        client = { id: cId };
      }

      const res = await query(
        `INSERT INTO productivity_jobs (client_id, start_date, completion_date, value_amount, description, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [client.id, d.startDate, d.completionDate, d.valueAmount, d.description, ownerId]
      );
      const prodJobId = res.insertId;

      for (const sName of d.services) {
        const sRow = await one('SELECT id FROM productivity_services WHERE name=?', [sName]);
        if (sRow) {
          await query('INSERT IGNORE INTO productivity_job_services (productivity_job_id, service_id) VALUES (?, ?)', [prodJobId, sRow.id]);
        }
      }

      for (const asgn of d.assignments) {
        const uRow = await one('SELECT id FROM users WHERE name LIKE ? LIMIT 1', [`%${asgn.name}%`]);
        if (uRow) {
          await query(
            `INSERT INTO productivity_job_assignments (productivity_job_id, user_id, revenue_percent, hours_spent)
             VALUES (?, ?, ?, ?)`,
            [prodJobId, uRow.id, asgn.percent, asgn.hours]
          );
        }
      }
    }
  }

  // Seed Demo Throughput Targets if none exist
  const existingTargets = await query('SELECT COUNT(*) as count FROM productivity_targets');
  if (Number(existingTargets[0]?.count || 0) === 0) {
    const demoTargets = [
      { userName: 'Mary', serviceName: 'AI-enabled Animation / Motion Graphics', quantity: 5, unit: 'count', period: 'day' },
      { userName: 'Arushi', serviceName: 'Social Media Optimisation', quantity: 10, unit: 'count', period: 'week' },
      { userName: 'John', serviceName: 'Website (full build)', quantity: 1, unit: 'count', period: 'month' },
      { userName: 'Ajay', serviceName: 'Films & Edits', quantity: 4, unit: 'count', period: 'week' },
      { userName: 'Chitra', serviceName: 'Social Media Optimisation', quantity: 8, unit: 'count', period: 'week' }
    ];

    for (const dt of demoTargets) {
      const uRow = await one('SELECT id FROM users WHERE name LIKE ? LIMIT 1', [`%${dt.userName}%`]);
      const sRow = await one('SELECT id FROM productivity_services WHERE name=?', [dt.serviceName]);
      if (uRow && sRow) {
        await query(
          `INSERT INTO productivity_targets (user_id, service_id, quantity, unit, period, is_active, created_by_user_id)
           VALUES (?, ?, ?, ?, ?, 1, ?)`,
          [uRow.id, sRow.id, dt.quantity, dt.unit, dt.period, ownerId]
        );
      }
    }
  }
}

