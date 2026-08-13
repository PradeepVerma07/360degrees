-- Migration: add responsibility_key to productivity_job_assignments and responsibilities lookup

ALTER TABLE productivity_job_assignments
  ADD COLUMN responsibility_key VARCHAR(40) NULL,
  ADD INDEX idx_productivity_assignments_responsibility (responsibility_key);

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
