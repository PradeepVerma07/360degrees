import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

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

  await query('INSERT IGNORE INTO settings (id, json) VALUES (1, ?)', [JSON.stringify(defaultSettings)]);
  const row = await one('SELECT COUNT(*) AS count FROM clients');
  if (Number(row.count) === 0 && process.env.SEED_DEMO_DATA !== 'false') await seed();
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

export async function audit(actorId, action, entityType, entityId, details = {}, connection = pool) {
  await query('INSERT INTO audit_logs (actor_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)',
    [actorId, action, entityType, entityId, JSON.stringify(details)], connection);
}
