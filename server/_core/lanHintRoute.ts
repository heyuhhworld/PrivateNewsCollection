import os from "node:os";
import type { Express, Request, Response } from "express";

function parsePort(): number {
  const p = parseInt(process.env.PORT || "3000", 10);
  if (Number.isNaN(p) || p < 1 || p > 65535) return 3000;
  return p;
}

/** 服务是否可能接受来自局域网的 TCP 连接（与 server listen 的 BIND_HOST 一致） */
function isLanListenLikely(bindHost: string): boolean {
  const h = bindHost.trim().toLowerCase();
  return h === "" || h === "0.0.0.0" || h === "::" || h === "[::]";
}

/**
 * GET /api/lan-hint
 * 返回本机非回环 IPv4 及建议的 http://IP:PORT，供插件、手机在同一局域网填写根地址。
 */
export function registerLanHintRoute(app: Express) {
  app.get("/api/lan-hint", (_req: Request, res: Response) => {
    const port = parsePort();
    const bindHost = (process.env.BIND_HOST ?? "").trim() || "0.0.0.0";
    const loopback = `http://127.0.0.1:${port}`;

    const ifaces = os.networkInterfaces();
    const hosts: string[] = [];
    for (const list of Object.values(ifaces)) {
      if (!list) continue;
      for (const iface of list) {
        if (iface.family !== "IPv4" || iface.internal) continue;
        const a = iface.address;
        if (!a || a === "127.0.0.1") continue;
        if (a.startsWith("169.254.")) continue;
        hosts.push(a);
      }
    }
    const uniqueHosts = Array.from(new Set(hosts));
    const suggestions = uniqueHosts.map((ip) => `http://${ip}:${port}`);

    let warning: string | undefined;
    if (!isLanListenLikely(bindHost)) {
      warning =
        "当前进程可能只监听本机回环地址（BIND_HOST 未为 0.0.0.0），局域网其它设备可能无法访问。请在 .env 中设置 BIND_HOST=0.0.0.0 或不设置后重启服务。";
    }

    res.setHeader("cache-control", "no-store");
    res.status(200).json({
      port,
      bindHost,
      loopback,
      lanHosts: uniqueHosts,
      suggestions,
      lanListenOpen: isLanListenLikely(bindHost),
      warning,
      note: "其它电脑或手机须与运行 IPMS 的机器在同一 Wi‑Fi/网段；若仍打不开，请检查本机防火墙是否放行该端口。",
    });
  });
}
