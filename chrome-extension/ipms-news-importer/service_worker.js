async function cookieHeaderFor(base) {
  const url = base.startsWith("http") ? base : `http://${base}`;
  const cookies = await chrome.cookies.getAll({ url });
  if (!cookies.length) return "";
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "IPMS_IMPORT_TAB") return;
  const tabId = msg.tabId != null ? msg.tabId : sender.tab?.id;
  const base = String(msg.base || "")
    .trim()
    .replace(/\/$/, "");
  if (!tabId) {
    sendResponse({ ok: false, error: "无法确定当前标签页" });
    return;
  }
  if (!base) {
    sendResponse({ ok: false, error: "请在插件弹窗中填写 IPMS 根地址" });
    return;
  }

  (async () => {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({
          title: document.title || "",
          url: location.href,
          text: (document.body && document.body.innerText ? document.body.innerText : "")
            .trim()
            .slice(0, 400000),
        }),
      });
      if (!result || !result.text || result.text.length < 80) {
        sendResponse({ ok: false, error: "正文过短：请确保页面已加载，或改用「上传文件」。" });
        return;
      }
      const ck = await cookieHeaderFor(base);
      const res = await fetch(`${base}/api/news/import-page`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(ck ? { Cookie: ck } : {}),
        },
        body: JSON.stringify({
          title: result.title,
          url: result.url,
          text: result.text,
          recordCategory: "news",
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        sendResponse({ ok: false, error: j.error || res.statusText || String(res.status) });
        return;
      }
      sendResponse({
        ok: true,
        duplicate: Boolean(j.duplicate),
        articleId: j.articleId,
        title: j.title,
      });
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  })();

  return true;
});
