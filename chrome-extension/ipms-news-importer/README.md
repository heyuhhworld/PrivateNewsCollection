# IPMS 资讯导入（Chrome 扩展）

独立子目录，不在根 `package.json` 工作区内打包。

## 获取方式（终端用户）

1. 在 IPMS 里打开 **AI 资讯助手**，点击 **「插件 ZIP」**：会先弹出**分步安装说明**，再点其中的 **「下载 ZIP 文件」** 即可。
2. 也可在浏览器直接访问：`{你的站点根地址}/api/chrome-extension/bundle.zip` 下载后按弹窗/助手内说明解压并加载。
3. **从源码目录加载**（开发者）：在 Chrome **加载已解压的扩展程序**，直接选择本仓库文件夹 `chrome-extension/ipms-news-importer`。

## 功能

1. **导入当前标签页**：抓取 `document.title`、URL、`body.innerText`，调用站点 `POST /api/news/import-page`，入库为 `source = ChromeExtension`、`recordCategory = news`，并由 LLM 生成与手工上传同一风格的标题/摘要/章节等。
2. **上传 PDF / Word**：调用 `POST /api/news/upload-document`，请求头带 `X-IPMS-Import-Channel: chrome-extension`，与系统管理手工上传**同一解析与 LLM 分析链路**，入库为 `source = ChromeExtension`、`recordCategory = report`，并写入 `uploaderUserId`（当前登录用户）。

## 使用前准备（终端用户）

1. 在浏览器 **正常打开 IPMS 并完成登录**（地址需与插件里填写的一致）。
2. 点击扩展图标，在弹窗中 **保存网站根地址**（不要末尾 `/`）。

## 管理员 / 部署说明

若用户已按说明安装仍**无法保存资讯**，请在服务器项目根执行 `pnpm run db:ensure-schema`（或应用迁移 `0015_news_source_chrome_extension.sql`），确保 `news_articles.source` 枚举包含 `ChromeExtension`。终端用户无需执行此步骤。

## 权限说明

- `cookies` + 宽 `host_permissions`：用于在扩展内为配置的 IPMS 根地址组装 `Cookie` 请求头（等同已登录浏览器会话）。
- `scripting` + `activeTab`：读取当前页正文用于剪藏导入。

## 与站内展示的关系

- 列表与详情中 **Chrome 插件** 来源使用 **紫色拼图** 图标，与手工上传（上传图标）、站点抓取（地球图标）区分。
- 详情页展示 **导入人**（与手工上传一致，来自 `uploaderUserId` / `news.detail` 的 `uploader`）。

## 隐私

剪藏与上传仅发往你在弹窗中配置的 IPMS 实例；不向第三方发送数据。
