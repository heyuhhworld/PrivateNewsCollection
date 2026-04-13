const DEFAULT_BASE = "http://127.0.0.1:3000";

function normBase(s) {
  return String(s || "")
    .trim()
    .replace(/\/$/, "");
}

async function getBase() {
  const { ipmsBaseUrl } = await chrome.storage.sync.get({ ipmsBaseUrl: DEFAULT_BASE });
  return normBase(ipmsBaseUrl) || normBase(DEFAULT_BASE);
}

async function cookieHeaderFor(base) {
  const url = base.startsWith("http") ? base : `http://${base}`;
  const cookies = await chrome.cookies.getAll({ url });
  if (!cookies.length) return "";
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

function setMsg(text, cls) {
  const el = document.getElementById("msg");
  el.textContent = text;
  el.className = cls || "";
}

async function refreshCropCount() {
  const { ipmsScreenshots = [] } = await chrome.storage.local.get("ipmsScreenshots");
  const countEl = document.getElementById("crop-count");
  const clearEl = document.getElementById("crop-clear");
  if (ipmsScreenshots.length > 0) {
    countEl.textContent = `已截图 ${ipmsScreenshots.length} 张`;
    clearEl.style.display = "";
  } else {
    countEl.textContent = "";
    clearEl.style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const baseInput = document.getElementById("base");
  baseInput.value = await getBase();
  await refreshCropCount();

  document.getElementById("save").addEventListener("click", async () => {
    const v = normBase(baseInput.value);
    if (!v) {
      setMsg("请填写有效地址", "err");
      return;
    }
    await chrome.storage.sync.set({ ipmsBaseUrl: v });
    setMsg("已保存：" + v, "ok");
  });

  document.getElementById("crop").addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setMsg("无法获取当前标签页", "err");
      return;
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["crop.js"],
      });
      window.close();
    } catch (e) {
      setMsg("无法在此页面截图：" + (e.message || e), "err");
    }
  });

  document.getElementById("crop-clear").addEventListener("click", async () => {
    await chrome.storage.local.set({ ipmsScreenshots: [] });
    await refreshCropCount();
    setMsg("截图已清除", "ok");
  });

  document.getElementById("tab").addEventListener("click", async () => {
    setMsg("导入中…", "");
    const base = await getBase();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setMsg("无法获取当前标签页", "err");
      return;
    }
    chrome.runtime.sendMessage({ type: "IPMS_IMPORT_TAB", tabId: tab.id, base }, (res) => {
      if (chrome.runtime.lastError) {
        setMsg(chrome.runtime.lastError.message, "err");
        return;
      }
      if (!res?.ok) setMsg(res?.error || "失败", "err");
      else if (res.duplicate) setMsg("该 URL 已在库中（未重复写入）", "ok");
      else {
        const shotInfo = res.screenshotsUploaded
          ? `（含 ${res.screenshotsUploaded} 张截图）`
          : "";
        setMsg(`导入成功${shotInfo}，ID ${res.articleId ?? ""}：${res.title || ""}`, "ok");
      }
      refreshCropCount();
    });
  });

  document.getElementById("file").addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    setMsg("上传中…", "");
    const base = await getBase();
    const ck = await cookieHeaderFor(base);
    const fd = new FormData();
    fd.append("file", file, file.name);
    try {
      const res = await fetch(`${base}/api/news/upload-document`, {
        method: "POST",
        headers: {
          "X-IPMS-Import-Channel": "chrome-extension",
          ...(ck ? { Cookie: ck } : {}),
        },
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || res.statusText);
      if (j.duplicate) setMsg("检测到重复文档，已跳过。ID " + (j.articleId ?? ""), "ok");
      else setMsg("上传成功，ID " + (j.articleId ?? "") + "：" + (j.title || ""), "ok");
    } catch (e) {
      setMsg(String(e.message || e), "err");
    }
  });
});
