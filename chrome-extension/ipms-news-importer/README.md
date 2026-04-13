# IPMS 资讯导入（Chrome 扩展）

独立子目录，不在根 `package.json` 工作区内打包；直接在 Chrome **扩展程序 → 开发者模式 → 加载已解压的扩展程序**，选择本文件夹即可。

## 功能

1. **导入当前标签页**：抓取 `document.title`、URL、`body.innerText`，调用站点 `POST /api/news/import-page`，入库为 `source = ChromeExtension`、`recordCategory = news`，并由 LLM 生成与手工上传同一风格的标题/摘要/章节等。
2. **上传 PDF / Word**：调用 `POST /api/news/upload-document`，请求头带 `X-IPMS-Import-Channel: chrome-extension`，与系统管理手工上传**同一解析与 LLM 分析链路**，入库为 `source = ChromeExtension`、`recordCategory = report`，并写入 `uploaderUserId`（当前登录用户）。

## 使用前准备

1. 启动 IPMS 后端（如 `pnpm dev`），在浏览器 **正常打开 IPMS 并完成登录**（与插件里填写的根地址一致，例如 `http://127.0.0.1:3000`）。
2. 点击扩展图标，在弹窗中 **保存根地址**（不要末尾 `/`）。
3. 数据库需已执行枚举扩展（含 `ChromeExtension`）：在项目根运行 `pnpm run db:ensure-schema` 或应用迁移 `0015_news_source_chrome_extension.sql`。

## 权限说明

- `cookies` + 宽 `host_permissions`：用于在扩展内为配置的 IPMS 根地址组装 `Cookie` 请求头（等同已登录浏览器会话）。
- `scripting` + `activeTab`：读取当前页正文用于剪藏导入。

## 与站内展示的关系

- 列表与详情中 **Chrome 插件** 来源使用 **紫色拼图** 图标，与手工上传（上传图标）、站点抓取（地球图标）区分。
- 详情页展示 **导入人**（与手工上传一致，来自 `uploaderUserId` / `news.detail` 的 `uploader`）。

## 隐私

剪藏与上传仅发往你在弹窗中配置的 IPMS 实例；不向第三方发送数据。
