(() => {
  if (window.top !== window.self) return;
  if (document.getElementById("ipms-import-fab")) return;

  const wrap = document.createElement("div");
  wrap.id = "ipms-import-fab";
  wrap.style.cssText = [
    "position:fixed",
    "right:16px",
    "bottom:88px",
    "z-index:2147483646",
    "font-family:system-ui,sans-serif",
  ].join(";");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "导入 IPMS";
  btn.style.cssText = [
    "padding:8px 12px",
    "border-radius:999px",
    "border:none",
    "cursor:pointer",
    "font-size:12px",
    "font-weight:600",
    "color:#fff",
    "background:linear-gradient(135deg,#7c3aed,#1677ff)",
    "box-shadow:0 4px 14px rgba(22,119,255,.35)",
  ].join(";");
  btn.title = "将当前页剪藏到 IPMS（弹窗内配置根地址；需已在 IPMS 登录）";

  btn.addEventListener("click", () => {
    chrome.storage.sync.get({ ipmsBaseUrl: "http://127.0.0.1:3000" }, (cfg) => {
      const base = String(cfg.ipmsBaseUrl || "")
        .trim()
        .replace(/\/$/, "");
      chrome.runtime.sendMessage({ type: "IPMS_IMPORT_TAB", base }, (res) => {
        if (chrome.runtime.lastError) {
          alert(chrome.runtime.lastError.message);
          return;
        }
        if (!res?.ok) alert(res?.error || "导入失败");
        else if (res.duplicate) alert("该页面已在库中");
        else alert("导入成功：" + (res.title || ""));
      });
    });
  });

  wrap.appendChild(btn);
  document.documentElement.appendChild(wrap);
})();
