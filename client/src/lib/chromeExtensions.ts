import { CHROME_MANAGE_EXTENSIONS_URL } from "@shared/chromeExtensionUserGuide";
import { toast } from "sonner";

/**
 * 从网页尝试打开 Chrome 内置扩展管理页。多数浏览器会拦截 chrome:// 新窗口，失败时自动复制地址。
 */
export function tryOpenChromeExtensionsPage(): void {
  const url = CHROME_MANAGE_EXTENSIONS_URL;
  try {
    const w = window.open(url, "_blank", "noopener,noreferrer");
    if (w == null) {
      void copyChromeExtensionsUrl();
      return;
    }
    try {
      w.focus();
    } catch {
      /* ignore */
    }
  } catch {
    void copyChromeExtensionsUrl();
  }
}

export async function copyChromeExtensionsUrl(): Promise<void> {
  const url = CHROME_MANAGE_EXTENSIONS_URL;
  try {
    await navigator.clipboard.writeText(url);
    toast.success("已复制到剪贴板，请粘贴到地址栏后回车打开");
  } catch {
    toast.error(`请手动在地址栏输入：${url}`);
  }
}
