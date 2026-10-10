-- Optional: app.py creates all of this automatically on first start.
-- Run manually only if you prefer:  mysql -u root -p < schema.sql
CREATE DATABASE IF NOT EXISTS classmate CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE classmate;

CREATE TABLE IF NOT EXISTS feedback (
  id INT AUTO_INCREMENT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  name VARCHAR(60) NOT NULL,
  grade VARCHAR(30) NOT NULL,
  subject VARCHAR(60) NOT NULL,
  tutor VARCHAR(60) NOT NULL,
  duration VARCHAR(40) DEFAULT '',
  email VARCHAR(100) DEFAULT '',
  show_name TINYINT(1) NOT NULL DEFAULT 1,
  r_overall TINYINT NOT NULL,
  r_clarity TINYINT NOT NULL,
  r_personalisation TINYINT NOT NULL,
  r_doubts TINYINT NOT NULL,
  r_assessments TINYINT NOT NULL,
  marks_before VARCHAR(40) DEFAULT '',
  marks_after VARCHAR(40) DEFAULT '',
  liked TEXT,
  improve TEXT,
  message TEXT NOT NULL,
  recommend ENUM('yes','no') NOT NULL DEFAULT 'yes',
  approved TINYINT(1) NOT NULL DEFAULT 1,
  is_seen TINYINT(1) NOT NULL DEFAULT 0
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS enquiries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  name VARCHAR(60) NOT NULL,
  contact VARCHAR(100) NOT NULL,
  grade VARCHAR(30) DEFAULT '',
  subject VARCHAR(60) DEFAULT '',
  message TEXT,
  is_read TINYINT(1) NOT NULL DEFAULT 0
) CHARACTER SET utf8mb4;
