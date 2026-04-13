import fs from "node:fs";
import path from "node:path";
import type { Express, Request, Response } from "express";

const LOG_DIR = path.join(process.cwd(), ".manus-logs");
const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024;
const TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6);

type LogSource = "browserConsole" | "networkRequests" | "sessionReplay";

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function trimLogFile(logPath: string, maxSize: number) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }

    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines: string[] = [];
    let keptBytes = 0;

    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}\n`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }

    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
    /* ignore */
  }
}

function writeToLogFile(source: LogSource, entries: unknown[]) {
  if (entries.length === 0) return;

  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);

  const lines = entries.map((entry) => {
    const ts = new Date().toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });

  fs.appendFileSync(logPath, `${lines.join("\n")}\n`, "utf-8");
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}

function handleLogPayload(payload: Record<string, unknown>) {
  const cl = payload.consoleLogs;
  if (Array.isArray(cl) && cl.length > 0) {
    writeToLogFile("browserConsole", cl);
  }
  const nr = payload.networkRequests;
  if (Array.isArray(nr) && nr.length > 0) {
    writeToLogFile("networkRequests", nr);
  }
  const se = payload.sessionEvents;
  if (Array.isArray(se) && se.length > 0) {
    writeToLogFile("sessionReplay", se);
  }
}

/**
 * Manus 调试采集脚本 POST /__manus__/logs。
 * 必须挂在 Express 上：`createViteServer({ middlewareMode })` 时 Vite 的 configureServer
 * 中间件不会稳定接到该路径，会导致 Network 里反复 ERR_CONNECTION_REFUSED（整站 dev 未跑时仍会红）。
 */
export function registerManusDebugLogsRoute(app: Express): void {
  app.post("/__manus__/logs", (req: Request, res: Response) => {
    try {
      const body = req.body;
      if (!body || typeof body !== "object") {
        res.status(400).json({ success: false, error: "Expected JSON body" });
        return;
      }
      handleLogPayload(body as Record<string, unknown>);
      res.status(200).json({ success: true });
    } catch (e) {
      res.status(400).json({ success: false, error: String(e) });
    }
  });
}
