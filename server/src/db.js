import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
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

  await initialiseRbacSchema();
  await seedRbacDefaults();

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

  await addColumnIfMissing('jobs', 'created_by_user_id', 'VARCHAR(100) NULL AFTER posted_by');
  await addColumnIfMissing('jobs', 'assigned_to_user_id', 'VARCHAR(100) NULL AFTER created_by_user_id');
  await addColumnIfMissing('jobs', 'assigned_by_user_id', 'VARCHAR(100) NULL AFTER assigned_to_user_id');
  await addColumnIfMissing('jobs', 'department_id', 'BIGINT UNSIGNED NULL AFTER assigned_by_user_id');
  await addColumnIfMissing('jobs', 'assignment_date', 'VARCHAR(40) NULL AFTER department_id');
  await addColumnIfMissing('jobs', 'assignment_note', 'TEXT NULL AFTER assignment_date');

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

  await addIndexIfMissing('users', 'idx_users_role_id', '(role_id)');
  await addIndexIfMissing('users', 'idx_users_account_type', '(account_type)');
  await addIndexIfMissing('users', 'idx_users_client_id', '(client_id)');
  await addIndexIfMissing('clients', 'idx_clients_owner', '(account_owner_user_id)');
  await addIndexIfMissing('clients', 'idx_clients_created_by', '(created_by)');
  await addIndexIfMissing('jobs', 'idx_jobs_assigned_to', '(assigned_to_user_id)');
  await addIndexIfMissing('jobs', 'idx_jobs_created_by', '(created_by_user_id)');
  await addIndexIfMissing('jobs', 'idx_jobs_department', '(department_id)');
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

  await query(`INSERT IGNORE INTO departments (name,code,description,status)
    VALUES ('Operations','OPS','Default operations department','active')`);
  await query(`INSERT IGNORE INTO designations (name,code,description,hierarchy_level,status)
    VALUES ('Team Member','TEAM_MEMBER','Default internal team designation',10,'active')`);
}

async function mapExistingUsersToRbac() {
  await query("UPDATE users SET account_type='admin', role_id='admin' WHERE role='admin' AND (role_id IS NULL OR role_id='')");
  await query("UPDATE users SET account_type='client', role_id='client' WHERE role='client' AND (role_id IS NULL OR role_id='')");
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
