import crypto from "crypto";

const SCRYPT_N = 16384;
const KEYLEN = 64;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto
    .scryptSync(password, salt, KEYLEN, { N: SCRYPT_N })
    .toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, passwordHash: string): boolean {
  const [algo, salt, storedHex] = passwordHash.split("$");
  if (algo !== "scrypt" || !salt || !storedHex) return false;
  const computed = crypto
    .scryptSync(password, salt, KEYLEN, { N: SCRYPT_N })
    .toString("hex");
  const a = Buffer.from(storedHex, "hex");
  const b = Buffer.from(computed, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
