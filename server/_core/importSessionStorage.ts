import fs from "node:fs";
import path from "node:path";

const DEFAULT_DIR = path.join(process.cwd(), "data", "import-sessions");

export function getImportSessionDir(): string {
  const d = process.env.IMPORT_SESSION_DIR?.trim();
  return d ? path.resolve(process.cwd(), d) : DEFAULT_DIR;
}

export function getPitchbookSessionPath(): string {
  const custom = process.env.IMPORT_SESSION_PITCHBOOK_PATH?.trim();
  return custom
    ? path.resolve(process.cwd(), custom)
    : path.join(getImportSessionDir(), "pitchbook.json");
}

export function getPreqinSessionPath(): string {
  const custom = process.env.IMPORT_SESSION_PREQIN_PATH?.trim();
  return custom
    ? path.resolve(process.cwd(), custom)
    : path.join(getImportSessionDir(), "preqin.json");
}

/** 若 URL 属于 Pitchbook/Preqin 且已保存过 storageState，则返回绝对路径 */
export function resolveStorageStatePathForUrl(
  pageUrl: string,
  options?: { skipIfCookieHeader?: boolean; hasCookieHeader?: boolean }
): string | undefined {
  if (options?.skipIfCookieHeader && options?.hasCookieHeader) {
    return undefined;
  }
  let host: string;
  try {
    host = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }

  if (host === "pitchbook.com" || host.endsWith(".pitchbook.com")) {
    const p = getPitchbookSessionPath();
    return fs.existsSync(p) ? p : undefined;
  }
  if (host === "preqin.com" || host.endsWith(".preqin.com")) {
    const p = getPreqinSessionPath();
    return fs.existsSync(p) ? p : undefined;
  }
  return undefined;
}

export function getImportSessionStatus(): {
  pitchbook: boolean;
  preqin: boolean;
  pitchbookPath: string;
  preqinPath: string;
} {
  const pitchbookPath = getPitchbookSessionPath();
  const preqinPath = getPreqinSessionPath();
  return {
    pitchbook: fs.existsSync(pitchbookPath),
    preqin: fs.existsSync(preqinPath),
    pitchbookPath,
    preqinPath,
  };
}
