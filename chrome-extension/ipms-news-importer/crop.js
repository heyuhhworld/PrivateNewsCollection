(() => {
  if (document.getElementById("ipms-crop-overlay")) return;

  let cropOverlay = null;
  let cropRect = null;
  let startX = 0, startY = 0;
  let dragging = false;

  function removeCropUI() {
    if (cropOverlay) {
      cropOverlay.remove();
      cropOverlay = null;
    }
    cropRect = null;
    document.removeEventListener("keydown", onCropKeyDown);
  }

  function onCropMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    cropRect.style.display = "block";
    cropRect.style.left = startX + "px";
    cropRect.style.top = startY + "px";
    cropRect.style.width = "0";
    cropRect.style.height = "0";
  }

  function onCropMouseMove(e) {
    if (!dragging) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    cropRect.style.left = x + "px";
    cropRect.style.top = y + "px";
    cropRect.style.width = w + "px";
    cropRect.style.height = h + "px";
  }

  function onCropMouseUp(e) {
    if (!dragging) return;
    dragging = false;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);

    removeCropUI();

    if (w < 10 || h < 10) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = {
      x: Math.round(x * dpr),
      y: Math.round(y * dpr),
      w: Math.round(w * dpr),
      h: Math.round(h * dpr),
      dpr,
    };

    chrome.runtime.sendMessage({ type: "IPMS_CROP_CAPTURE", rect }, (res) => {
      if (chrome.runtime.lastError) {
        showToast("截图失败：" + chrome.runtime.lastError.message, true);
        return;
      }
      if (res?.ok) {
        showToast("截图已保存（共 " + res.total + " 张）");
      } else {
        showToast("截图失败：" + (res?.error || "未知错误"), true);
      }
    });
  }

  function onCropKeyDown(e) {
    if (e.key === "Escape") {
      removeCropUI();
    }
  }

  function showToast(text, isError) {
    const t = document.createElement("div");
    t.textContent = text;
    t.style.cssText = [
      "position:fixed",
      "top:20px",
      "left:50%",
      "transform:translateX(-50%)",
      "padding:10px 24px",
      "border-radius:8px",
      "background:" + (isError ? "#b42318" : "#0a7a2e"),
      "color:#fff",
      "font-size:14px",
      "font-weight:600",
      "z-index:2147483647",
      "pointer-events:none",
      "font-family:system-ui,sans-serif",
      "box-shadow:0 4px 16px rgba(0,0,0,0.2)",
      "transition:opacity 0.3s",
    ].join(";");
    document.documentElement.appendChild(t);
    setTimeout(() => {
      t.style.opacity = "0";
      setTimeout(() => t.remove(), 400);
    }, 2000);
  }

  cropOverlay = document.createElement("div");
  cropOverlay.id = "ipms-crop-overlay";
  cropOverlay.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483647",
    "background:rgba(0,0,0,0.3)",
    "cursor:crosshair",
    "font-family:system-ui,sans-serif",
  ].join(";");

  const hint = document.createElement("div");
  hint.textContent = "拖拽选择截图区域 · ESC 取消";
  hint.style.cssText = [
    "position:fixed",
    "top:16px",
    "left:50%",
    "transform:translateX(-50%)",
    "padding:8px 20px",
    "border-radius:8px",
    "background:rgba(0,0,0,0.75)",
    "color:#fff",
    "font-size:14px",
    "font-weight:600",
    "pointer-events:none",
    "z-index:2147483647",
  ].join(";");
  cropOverlay.appendChild(hint);

  cropRect = document.createElement("div");
  cropRect.style.cssText = [
    "position:fixed",
    "border:2px dashed #7c3aed",
    "background:rgba(124,58,237,0.08)",
    "display:none",
    "pointer-events:none",
    "z-index:2147483647",
  ].join(";");
  cropOverlay.appendChild(cropRect);

  cropOverlay.addEventListener("mousedown", onCropMouseDown);
  cropOverlay.addEventListener("mousemove", onCropMouseMove);
  cropOverlay.addEventListener("mouseup", onCropMouseUp);
  document.addEventListener("keydown", onCropKeyDown);

  document.documentElement.appendChild(cropOverlay);
})();
