-- Safe additive migration for enterprise RBAC/job-board upgrade.
-- Back up the database before applying in production.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS job_assignments (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The runtime initializer also adds the following indexes idempotently.
-- If applying manually, add an index only when it does not already exist:
-- users(department_id), users(designation_id), users(manager_user_id),
-- jobs(department_id), jobs(status).
