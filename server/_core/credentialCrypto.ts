import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const SALT = "ipms-crawl-auth-v1";

function getKey(): Buffer {
  const secret =
    process.env.JWT_SECRET?.trim() ||
    (process.env.NODE_ENV === "development"
      ? "__dev_only_crawl_cred_key__"
      : "");
  if (!secret) {
    throw new Error(
      "请配置 JWT_SECRET 环境变量后再保存 Preqin 登录密码（用于加密存储）"
    );
  }
  return scryptSync(secret, SALT, 32);
}

/** 加密后 base64，用于存入 DB */
export function encryptCredential(plain: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptCredential(encB64: string): string {
  const key = getKey();
  const buf = Buffer.from(encB64, "base64");
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error("Invalid encrypted credential");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8"
  );
}

export function isCredentialCryptoAvailable(): boolean {
  return (
    Boolean(process.env.JWT_SECRET?.trim()) ||
    process.env.NODE_ENV === "development"
  );
}
