import type { Express, NextFunction, Request, Response } from "express";

/**
 * Chrome 扩展从 chrome-extension:// 发起 fetch 时需带 Cookie，浏览器会做 CORS 预检。
 * 仅对扩展来源反射 ACAO，避免对任意网站放开。
 */
export function registerExtensionCors(app: Express) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin.startsWith("chrome-extension://")) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, X-IPMS-Import-Channel, Cookie"
      );
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
}
