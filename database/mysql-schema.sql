SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS=0;

CREATE TABLE IF NOT EXISTS clients (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    contact_name VARCHAR(255) NULL,
    email VARCHAR(255) NULL,
    phone VARCHAR(60) NULL,
    industry VARCHAR(160) NULL,
    account_owner_user_id VARCHAR(100) NULL,
    created_by VARCHAR(100) NULL,
    password_hash VARCHAR(255) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NULL,
    INDEX idx_clients_owner (account_owner_user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NULL,
    phone VARCHAR(60) NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('super_admin','admin','employee','client') NOT NULL DEFAULT 'client',
    account_type ENUM('super_admin','admin','employee','client') NULL,
    role_id VARCHAR(50) NULL,
    client_id VARCHAR(100) NULL,
    department_id BIGINT UNSIGNED NULL,
    designation_id BIGINT UNSIGNED NULL,
    manager_user_id VARCHAR(100) NULL,
    created_by VARCHAR(100) NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_login DATETIME(3) NULL,
    updated_at DATETIME(3) NULL,
    INDEX idx_users_role_id (role_id),
    INDEX idx_users_account_type (account_type),
    INDEX idx_users_client_id (client_id),
    CONSTRAINT fk_users_client FOREIGN KEY (client_id) REFERENCES clients(id)
      ON UPDATE CASCADE ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roles (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permissions (
    id VARCHAR(100) PRIMARY KEY,
    module VARCHAR(80) NOT NULL,
    action VARCHAR(80) NOT NULL,
    label VARCHAR(160) NOT NULL,
    description TEXT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_permissions_module (module)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id VARCHAR(50) NOT NULL,
    permission_id VARCHAR(100) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (role_id, permission_id),
    CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles(id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_permission_overrides (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS departments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(160) NOT NULL UNIQUE,
    code VARCHAR(60) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    created_by VARCHAR(100) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS designations (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_profiles (
    user_id VARCHAR(100) PRIMARY KEY,
    employee_id VARCHAR(80) NULL UNIQUE,
    joining_date DATE NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_employee_profiles_user FOREIGN KEY (user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS module_access_rules (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS module_access_conditions (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS module_access_triggers (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS module_access_advanced_rules (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    rule_id BIGINT UNSIGNED NOT NULL,
    rule_type VARCHAR(80) NOT NULL,
    operator VARCHAR(40) NOT NULL DEFAULT 'equals',
    value VARCHAR(255) NOT NULL DEFAULT '',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_module_advanced_rule (rule_id),
    CONSTRAINT fk_module_advanced_rule FOREIGN KEY (rule_id) REFERENCES module_access_rules(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS jobs (
    id VARCHAR(100) PRIMARY KEY,
    client_id VARCHAR(100) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description LONGTEXT NOT NULL,
    category VARCHAR(150) NOT NULL,
    priority VARCHAR(30) NOT NULL,
    posted_by VARCHAR(255) NOT NULL,
    created_by_user_id VARCHAR(100) NULL,
    assigned_to_user_id VARCHAR(100) NULL,
    assigned_by_user_id VARCHAR(100) NULL,
    department_id BIGINT UNSIGNED NULL,
    assignment_date VARCHAR(40) NULL,
    assignment_note TEXT NULL,
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
    INDEX idx_jobs_assigned_to (assigned_to_user_id),
    INDEX idx_jobs_created_by (created_by_user_id),
    CONSTRAINT fk_jobs_client FOREIGN KEY (client_id) REFERENCES clients(id)
      ON UPDATE CASCADE ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS productivity_employee_settings (
    user_id VARCHAR(100) PRIMARY KEY,
    weekly_capacity_hours DECIMAL(10,2) NOT NULL DEFAULT 40,
    productivity_status ENUM('active','intern','vendor','inactive') NOT NULL DEFAULT 'active',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_productivity_employee_user FOREIGN KEY (user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS productivity_services (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS productivity_responsibilities (
    `key` VARCHAR(40) PRIMARY KEY,
    label VARCHAR(160) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO productivity_responsibilities (`key`, label, description) VALUES
  ('owner','Owner','Primary owner of the job or client account'),
  ('producer','Producer','Primary producer responsible for delivery'),
  ('reviewer','Reviewer','Quality or content reviewer'),
  ('support','Support','Support or operations contributor');

CREATE TABLE IF NOT EXISTS productivity_jobs (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS productivity_job_services (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS productivity_job_assignments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    productivity_job_id BIGINT UNSIGNED NOT NULL,
    responsibility_key VARCHAR(40) NULL,
    user_id VARCHAR(100) NOT NULL,
    revenue_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
    hours_spent DECIMAL(10,2) NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_productivity_assignments_job (productivity_job_id),
    INDEX idx_productivity_assignments_responsibility (responsibility_key),
    INDEX idx_productivity_assignments_user (user_id),
    CONSTRAINT fk_productivity_assignments_job FOREIGN KEY (productivity_job_id) REFERENCES productivity_jobs(id)
      ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_productivity_assignments_user FOREIGN KEY (user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS productivity_account_rosters (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS productivity_account_roster_assignments (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS productivity_targets (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS productivity_salary_grades (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS productivity_salary_assignments (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
    id TINYINT PRIMARY KEY,
    json LONGTEXT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    actor_id VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(150) NOT NULL,
    details LONGTEXT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_audit_entity (entity_type, entity_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS support_tickets (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS support_ticket_messages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ticket_id BIGINT UNSIGNED NOT NULL,
    author_id VARCHAR(100) NOT NULL,
    author_name VARCHAR(255) NOT NULL,
    author_role VARCHAR(50) NOT NULL,
    body LONGTEXT NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    INDEX idx_messages_ticket (ticket_id),
    CONSTRAINT fk_messages_ticket FOREIGN KEY (ticket_id) REFERENCES support_tickets(id)
      ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS support_ticket_attachments (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS=1;
