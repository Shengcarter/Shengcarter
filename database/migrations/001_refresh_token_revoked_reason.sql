-- Why a refresh token was revoked. The short grace period for parallel
-- requests applies only to normal rotation, never to a session family that
-- was revoked because a stolen token was replayed.
ALTER TABLE refresh_tokens
  ADD COLUMN revoked_reason ENUM('rotated','logout','reuse','password','admin') NULL AFTER revoked_at;
