-- Invoice Pilot — MySQL schema for Hostinger (shared hosting) PHP API
-- Import via phpMyAdmin after creating an empty database.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS uploads;
DROP TABLE IF EXISTS invoice_rows;
DROP TABLE IF EXISTS invoice_drafts;
DROP TABLE IF EXISTS payment_accounts;
DROP TABLE IF EXISTS column_templates;
DROP TABLE IF EXISTS table_templates;
DROP TABLE IF EXISTS agent_client_assignments;
DROP TABLE IF EXISTS clients;
DROP TABLE IF EXISTS company_settings;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','agent') NOT NULL,
  full_name VARCHAR(255) NULL,
  email VARCHAR(255) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_active TINYINT(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE company_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_name VARCHAR(255) DEFAULT 'Runnex Logistics',
  email VARCHAR(255) NULL,
  phone VARCHAR(255) NULL,
  address TEXT NULL,
  currency VARCHAR(8) DEFAULT 'USD',
  logo_path VARCHAR(512) NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE clients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  contact_name VARCHAR(255) NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(255) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_active TINYINT(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE agent_client_assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agent_id INT NOT NULL,
  client_id INT NOT NULL,
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_agent_client (agent_id, client_id),
  FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE table_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  display_order INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE column_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  table_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  label VARCHAR(255) NOT NULL,
  col_type VARCHAR(32) DEFAULT 'text',
  display_order INT DEFAULT 0,
  is_required TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (table_id) REFERENCES table_templates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE payment_accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  label VARCHAR(255) NOT NULL,
  details TEXT NOT NULL,
  display_order INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE invoice_drafts (
  id VARCHAR(36) PRIMARY KEY,
  agent_id INT NOT NULL,
  client_id INT NULL,
  payment_account_id INT NULL,
  invoice_number VARCHAR(255) NULL,
  invoice_date VARCHAR(32) NULL,
  status ENUM('draft','finalized') DEFAULT 'draft',
  notes TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES users(id),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (payment_account_id) REFERENCES payment_accounts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE invoice_rows (
  id INT AUTO_INCREMENT PRIMARY KEY,
  draft_id VARCHAR(36) NOT NULL,
  table_id INT NULL,
  row_order INT DEFAULT 0,
  row_data TEXT NOT NULL DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (draft_id) REFERENCES invoice_drafts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE uploads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  draft_id VARCHAR(36) NULL,
  agent_id INT NULL,
  original_name VARCHAR(512) NULL,
  file_path VARCHAR(1024) NULL,
  extracted_data TEXT NULL,
  confidence_scores TEXT NULL,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Initial admin only (password: admin123). Change password after first login. Add agents from the admin panel.
INSERT INTO users (username, password_hash, role, full_name, email) VALUES
('admin', '$2a$12$uKnsVPhjZj4arnCU2UhNRucArGQI2XJhSma3rbCIZhoq7nQFIjvcq', 'admin', 'System Admin', 'admin@invoicepilot.com');

INSERT INTO company_settings (company_name, email, phone, address, currency) VALUES
('Runnex Logistics', 'billing@runnexlogistics.com', '(555) 000-1234', '123 Freight Lane, Dallas, TX 75201', 'USD');

INSERT INTO clients (contact_name, company_name, email, phone) VALUES
('Mike Johnson', 'Apex Logistics Inc', 'mjohnson@apexlogistics.com', '(555) 100-2000'),
('Sarah Thompson', 'BlueLine Freight', 'sarah@bluelinefreight.com', '(555) 200-3000'),
('David Park', 'CrossCountry Carriers', 'dpark@crosscountry.com', '(555) 300-4000');

INSERT INTO table_templates (name, display_order) VALUES ('Load Details', 0);
SET @tid = LAST_INSERT_ID();

INSERT INTO column_templates (table_id, name, label, col_type, display_order) VALUES
(@tid, 'origin', 'Origin', 'text', 0),
(@tid, 'destination', 'Destination', 'text', 1),
(@tid, 'miles', 'Miles', 'number', 2),
(@tid, 'rate', 'Rate', 'text', 3),
(@tid, 'dispatcher_fee', 'Dispatcher Fee', 'text', 4);
