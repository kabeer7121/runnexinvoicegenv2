-- Run once on existing databases (already imported from an older database-import.sql).
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS payment_accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  label VARCHAR(255) NOT NULL,
  details TEXT NOT NULL,
  display_order INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE invoice_drafts
  ADD COLUMN payment_account_id INT NULL AFTER client_id,
  ADD CONSTRAINT fk_invoice_drafts_payment_account
    FOREIGN KEY (payment_account_id) REFERENCES payment_accounts(id) ON DELETE SET NULL;
