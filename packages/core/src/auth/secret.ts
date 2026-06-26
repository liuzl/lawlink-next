/**
 * JWT secret resolution. There is deliberately NO fallback value: a guessable
 * default (e.g. "dev-secret-change-me") would let anyone forge an admin token
 * and bypass login + requireRole. Callers must supply a real secret via env.
 */
const PLACEHOLDER = "dev-secret-change-me";

export function requireJwtSecret(raw: string | undefined): string {
  const secret = (raw ?? "").trim();
  if (!secret) {
    throw new Error("LAWLINK_JWT_SECRET 未设置（签发/校验登录态需要强随机密钥）");
  }
  if (secret === PLACEHOLDER) {
    throw new Error("LAWLINK_JWT_SECRET 仍为占位值，请改为强随机密钥");
  }
  return secret;
}
