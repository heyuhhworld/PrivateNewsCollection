import path from "node:path";
import fs from "node:fs";
import { nanoid } from "nanoid";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

const MAX_EXTRACT_CHARS = 120_000;

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
/** Windows 保留设备名（仅校验主文件名，不含扩展名） */
const WIN_RESERVED_STEM = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export function normalizeExtension(filename: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? `.${m[1]}` : "";
}

/**
 * 保留用户上传的原始文件名（去路径、去非法字符），若重名则在扩展名前追加短 id。
 */
export function buildUniqueStoredUploadFilename(
  originalName: string,
  uploadDir: string
): string {
  const ext = normalizeExtension(originalName) || ".bin";
  const stemRaw = path.parse(originalName).name;
  let stem = stemRaw
    .replace(INVALID_FILENAME_CHARS, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  if (!stem) stem = "document";
  if (WIN_RESERVED_STEM.test(stem)) stem = `_${stem}`;

  let candidate = `${stem}${ext}`;
  let full = path.join(uploadDir, candidate);
  let n = 0;
  while (fs.existsSync(full) && n < 80) {
    n++;
    candidate = `${stem}_${nanoid(6)}${ext}`;
    full = path.join(uploadDir, candidate);
  }
  return candidate;
}

export async function extractTextFromFile(
  buffer: Buffer,
  mime: string,
  ext: string
): Promise<string> {
  let raw = "";
  const m = mime.toLowerCase();
  if (m.includes("pdf") || ext === ".pdf") {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    raw = result.text ?? "";
  } else if (
    m.includes("wordprocessingml") ||
    m.includes("msword") ||
    ext === ".docx"
  ) {
    const r = await mammoth.extractRawText({ buffer });
    raw = r.value ?? "";
  } else if (ext === ".doc") {
    throw new Error("暂不支持旧版 .doc，请另存为 .docx 后上传");
  } else {
    throw new Error("仅支持 PDF 与 Word（.docx）");
  }
  raw = raw.replace(/\0/g, "").trim();
  if (!raw) {
    throw new Error("未能从文件中提取到文本，请确认文件未加密或损坏");
  }
  if (raw.length > MAX_EXTRACT_CHARS) {
    return raw.slice(0, MAX_EXTRACT_CHARS);
  }
  return raw;
}
