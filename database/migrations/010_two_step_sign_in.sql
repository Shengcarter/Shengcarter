-- Two-step sign-in (TOTP authenticator codes) and recovery codes.
--
-- The authenticator secret is stored encrypted (AES-256-GCM, utils/crypto.js);
-- recovery codes only as SHA-256 hashes. totp_last_step remembers the last
-- 30-second step a code was accepted for, so the same code is never accepted
-- twice. Whether it is required (nobody / administrators / everyone) is the
-- setting security.two_factor_required.

ALTER TABLE users
  ADD COLUMN totp_secret         VARCHAR(255)    NULL COMMENT 'Encrypted authenticator secret (two-step sign-in on)' AFTER password_changed_at,
  ADD COLUMN totp_pending_secret VARCHAR(255)    NULL COMMENT 'Encrypted secret while two-step sign-in is being set up' AFTER totp_secret,
  ADD COLUMN totp_enabled_at     DATETIME        NULL AFTER totp_pending_secret,
  ADD COLUMN totp_last_step      BIGINT UNSIGNED NULL COMMENT 'Last time step a code was accepted for' AFTER totp_enabled_at;

CREATE TABLE IF NOT EXISTS user_recovery_codes (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL,
  code_hash  CHAR(64)     NOT NULL,
  used_at    DATETIME     NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_recovery_codes_hash (code_hash),
  KEY idx_user_recovery_codes_user (user_id),
  CONSTRAINT fk_user_recovery_codes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sessions ended because two-step sign-in was turned on, off or reset.
ALTER TABLE refresh_tokens
  MODIFY revoked_reason ENUM('rotated','logout','reuse','password','admin','expired','two_factor') NULL;

-- Optional by default; an administrator can require it (Settings → Security).
INSERT IGNORE INTO settings (setting_key, setting_value, group_name, is_secret)
VALUES ('security.two_factor_required', CAST('"none"' AS JSON), 'security', 0);
