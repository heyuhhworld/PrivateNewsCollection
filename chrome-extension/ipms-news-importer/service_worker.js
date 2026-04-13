async function cookieHeaderFor(base) {
  const url = base.startsWith("http") ? base : `http://${base}`;
  const cookies = await chrome.cookies.getAll({ url });
  if (!cookies.length) return "";
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function captureTabScreenshot(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.windowId) return null;
    return await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png",
      quality: 92,
    });
  } catch {
    return null;
  }
}

async function cropDataUrl(fullDataUrl, rect) {
  const resp = await fetch(fullDataUrl);
  const blob = await resp.blob();
  const bmp = await createImageBitmap(blob, rect.x, rect.y, rect.w, rect.h);
  const canvas = new OffscreenCanvas(rect.w, rect.h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const outBlob = await canvas.convertToBlob({ type: "image/png" });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(outBlob);
  });
}

async function uploadScreenshot(base, ck, articleId, dataUrl, caption) {
  if (!dataUrl || !articleId) return false;
  try {
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    const fd = new FormData();
    fd.append("file", blob, "screenshot.png");
    fd.append("articleId", String(articleId));
    fd.append("caption", caption || "插件截图");
    const r = await fetch(`${base}/api/news/reading-image`, {
      method: "POST",
      headers: ck ? { Cookie: ck } : {},
      body: fd,
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function uploadAllScreenshots(base, ck, articleId) {
  const { ipmsScreenshots = [] } = await chrome.storage.local.get("ipmsScreenshots");
  if (!ipmsScreenshots.length) return 0;
  let uploaded = 0;
  for (let i = 0; i < ipmsScreenshots.length; i++) {
    const ok = await uploadScreenshot(
      base, ck, articleId, ipmsScreenshots[i],
      `插件区域截图 ${i + 1}`
    );
    if (ok) uploaded++;
  }
  await chrome.storage.local.set({ ipmsScreenshots: [] });
  return uploaded;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  /* ── 区域截图：捕获 + 裁剪 + 存储 ── */
  if (msg.type === "IPMS_CROP_CAPTURE") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "无法确定标签页" });
      return;
    }
    (async () => {
      try {
        const fullShot = await captureTabScreenshot(tabId);
        if (!fullShot) {
          sendResponse({ ok: false, error: "截取页面失败" });
          return;
        }
        const cropped = await cropDataUrl(fullShot, msg.rect);
        const { ipmsScreenshots = [] } = await chrome.storage.local.get("ipmsScreenshots");
        ipmsScreenshots.push(cropped);
        await chrome.storage.local.set({ ipmsScreenshots });
        sendResponse({ ok: true, total: ipmsScreenshots.length });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
  }

  /* ── 导入当前标签页 ── */
  if (msg.type === "IPMS_IMPORT_TAB") {
    const tabId = msg.tabId != null ? msg.tabId : sender.tab?.id;
    const base = String(msg.base || "").trim().replace(/\/$/, "");
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
        const autoScreenshot = captureTabScreenshot(tabId);

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

        let screenshotsUploaded = 0;
        if (j.articleId && !j.duplicate) {
          screenshotsUploaded = await uploadAllScreenshots(base, ck, j.articleId);

          const autoShot = await autoScreenshot;
          if (autoShot) {
            const ok = await uploadScreenshot(base, ck, j.articleId, autoShot, "导入时自动页面截图");
            if (ok) screenshotsUploaded++;
          }
        }

        sendResponse({
          ok: true,
          duplicate: Boolean(j.duplicate),
          articleId: j.articleId,
          title: j.title,
          screenshotsUploaded,
        });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    })();

    return true;
  }
});
