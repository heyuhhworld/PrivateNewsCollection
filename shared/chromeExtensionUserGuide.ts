/** Chrome 内置「扩展程序」管理页（用于从助手说明中跳转；部分环境需用程序化打开或复制） */
export const CHROME_MANAGE_EXTENSIONS_URL = "chrome://extensions/";

/**
 * Chrome 资讯插件 · 终端用户说明（与 AI 助手、服务端回复共用，避免口径不一致）
 */
export function chromeExtensionZipUrl(siteOrigin: string): string {
  const base = siteOrigin?.trim().replace(/\/+$/, "") || "";
  if (!base) return "/api/chrome-extension/bundle.zip";
  return `${base}/api/chrome-extension/bundle.zip`;
}

/** 面向业务用户的 Markdown 正文（不出现命令行、数据库、pnpm 等管理员术语） */
export function getChromeExtensionUserGuideMarkdown(siteOrigin: string): string {
  const trimmed = siteOrigin?.trim().replace(/\/+$/, "") ?? "";
  const zip = chromeExtensionZipUrl(trimmed);
  const siteHint = trimmed || "（请填写与浏览器地址栏一致的网站根地址，不要末尾 `/`）";

  return [
    "## 这个插件能做什么",
    "",
    "- **导入网页内容**：在您正在看的资讯页上点一下，把标题、链接和正文保存进 IPMS，方便以后在系统里检索、做笔记。",
    "- **上传报告文件**：把电脑里的 **PDF** 或 **Word** 选进插件，会走和网页里「上传文件」类似的整理流程，方便归档。",
    "",
    "## 第一步：下载",
    "",
    `- 在本页点击 **「插件 ZIP」**，或复制到浏览器打开：${zip}`,
    "- 得到的是一个压缩包，请先**解压**到一个固定位置（例如「下载」文件夹里）。",
    "",
    "## 第二步：装进 Chrome",
    "",
    "1. 解压后应看到一个名为 **ipms-news-importer** 的文件夹，里面能看到 **manifest.json** 文件。",
    "2. 打开 Chrome 的 **扩展程序** 管理页：点击上方 **chrome://extensions/** 链接（可直接打开）；若被浏览器拦截无反应，请点旁边「复制」后粘贴到地址栏。",
    "3. 打开右上角的 **「开发者模式」** 开关。",
    "4. 点击 **「加载已解压的扩展程序」**。",
    "",
    "![打开开发者模式，点击「加载已解压的扩展程序」](/guide/step2-load-unpacked.png)",
    "",
    "5. 在弹窗里选中 **整个 ipms-news-importer 文件夹**（不要选外面的 `.zip` 压缩包）。",
    "6. 装好后，可点浏览器右上角的 **拼图图标**，找到 **「IPMS 资讯导入」**，点 **图钉** 固定到工具栏，以后更好找。",
    "",
    "![点击拼图图标，将 IPMS 资讯导入固定到工具栏](/guide/step2-pin-extension.png)",
    "",
    "## 第三步：第一次使用前",
    "",
    "![插件弹窗：填写 IPMS 根地址并保存](/guide/step3-plugin-popup.png)",
    "",
    `1. 请先用 **Chrome** 打开本系统 **${siteHint}** 并完成 **登录**（插件里填的地址要与这里一致）。`,
    "2. 再点工具栏里的 **插件图标**，在弹出窗口里填写 **网站根地址**（与地址栏里一致，**不要**末尾多一个 `/`），点 **保存**。",
    "",
    "## 日常使用",
    "",
    "- **保存当前网页**：打开要保存的页面 → 点插件 → 按界面上的说明执行「导入当前页」类操作。",
    "- **上传文件**：点插件 → 选择本地的 PDF 或 Word → 按提示上传。",
    "",
    "## 若无法保存或一直报错",
    "",
    "请先确认已登录、插件里填的网站地址正确。若仍不行，请把**具体提示截图**发给 **本单位 IPMS 管理员**，由管理员在后台排查即可（您无需自行改服务器或数据库）。",
  ].join("\n");
}
