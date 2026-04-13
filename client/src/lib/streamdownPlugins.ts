import { defaultRehypePlugins } from "streamdown";

/**
 * rehype-harden 默认 defaultOrigin 为 undefined，导致所有相对路径
 * 链接（如 /news/123）和图片（如 /guide/xxx.png）被判为非法而显示 [blocked]。
 * 这里把 defaultOrigin 设为当前页面 origin，使相对路径能正确解析。
 */
export function getRehypePluginsWithOrigin() {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  const plugins = Object.entries(defaultRehypePlugins).map(([key, val]) => {
    if (key === "harden" && Array.isArray(val)) {
      const [fn, opts] = val as [unknown, Record<string, unknown>];
      return [fn, { ...opts, defaultOrigin: origin }];
    }
    return val;
  });
  return plugins;
}
