import path from "node:path";
import fs from "node:fs";
import { nanoid } from "nanoid";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

const MAX_EXTRACT_CHARS = 120_000;

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
/** Windows 保留设备名（仅校验主文件名，不含扩展名） */
const WIN_RESERVED_STEM = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export type ExtractTextResult = {
  text: string;
  /** 与 text 按「非空行」对齐的 PDF 真实页码；非 PDF 时为 undefined */
  linePageMap?: number[];
};

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

function truncateLinesToMaxChars(
  lineTexts: string[],
  linePageMap: number[],
  maxChars: number
): { text: string; linePageMap: number[] } {
  let total = 0;
  const outLines: string[] = [];
  const outMap: number[] = [];
  for (let i = 0; i < lineTexts.length; i++) {
    const add = lineTexts[i].length + (outLines.length > 0 ? 1 : 0);
    if (total + add > maxChars) break;
    outLines.push(lineTexts[i]);
    outMap.push(linePageMap[i]!);
    total += add;
  }
  return { text: outLines.join("\n"), linePageMap: outMap };
}

export async function extractTextFromFile(
  buffer: Buffer,
  mime: string,
  ext: string
): Promise<ExtractTextResult> {
  const m = mime.toLowerCase();
  if (m.includes("pdf") || ext === ".pdf") {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      const pages = [...result.pages].sort((a, b) => a.num - b.num);
      const linePageMap: number[] = [];
      const lineTexts: string[] = [];
      for (const p of pages) {
        const lines = p.text.split(/\r?\n/);
        for (const line of lines) {
          const t = line.trim();
          if (t.length > 0) {
            lineTexts.push(t);
            linePageMap.push(Math.max(1, p.num));
          }
        }
      }
      let text = lineTexts.join("\n");
      if (!text.replace(/\0/g, "").trim() || lineTexts.length === 0) {
        throw new Error("未能从文件中提取到文本，请确认文件未加密或损坏");
      }
      text = text.replace(/\0/g, "").trim();
      if (text.length > MAX_EXTRACT_CHARS) {
        const truncated = truncateLinesToMaxChars(
          lineTexts,
          linePageMap,
          MAX_EXTRACT_CHARS
        );
        text = truncated.text;
        return { text, linePageMap: truncated.linePageMap };
      }
      return { text, linePageMap };
    } finally {
      await parser.destroy().catch(() => {});
    }
  }

  let raw = "";
  if (
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
    return { text: raw.slice(0, MAX_EXTRACT_CHARS) };
  }
  return { text: raw };
}
