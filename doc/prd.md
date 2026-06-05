# GenWiki PRD (Product Requirement Document)

## 1. 产品定义 (Product Definition)
GenWiki 是一款基于 Obsidian 插件的个人 AI 知识库增量构建系统。它能够自动读取、归纳用户收集的网页剪藏（Clippings），并利用 LLM 按照特定工作流自动将其整理合并到结构化的 Wiki 文件夹中，实现个人知识的增量复利与健康度维护。

## 2. 目标平台 (Target Platforms)
* **Desktop**: macOS, Windows, Linux 上的 Obsidian 客户端。
* **Mobile (iOS)**: 手机端 iOS Obsidian 客户端。
  * *注意*: iOS 端运行环境受限（无法使用 Node.js 子进程、无法运行本地 CLI 工具），所有 LLM 交互与文本处理需通过 HTTPS Fetch 请求直接调用大模型 API。

## 3. 核心功能需求 (Key Features)

### 3.1 剪藏数据源管理 (Clippings Ingest)
* 插件需监控或一键读取指定的 `Clippings/` 目录。
* 支持扫描未处理的网页剪藏 Markdown。

### 3.2 触发机制与入口
* **触发方式**：
  * Obsidian 首页提供一个显眼的快捷按钮（如通过 Ribbon Icon 或首页 Canvas/Dashboard 嵌入按钮）。
  * 支持命令面板（Command Palette）触发 Ingest、Query 与 Lint。

### 3.3 核心交互三大流程 (三位一体)
系统必须支持以下三大核心操作：

#### 1. Ingest (增量导入工作流)
1. 扫描未处理的 `Clippings` 列表。
2. 读取并向 LLM 提供 `wiki/index.md`（作为知识库上下文元数据）。
3. 调用 `.skills/Ingest.md` 中的 Prompt 模板，让 LLM 抽取关键信息、实体与概念。
4. LLM 决定是**修改/合并现有 Wiki 页面**还是**新建 Wiki 页面**，同时生成/修改 Wikilinks 双链。
5. 自动更新 `wiki/index.md` 并追加日志到 `wiki/log.md`。
6. 处理完毕后，归档原始剪藏文件。

#### 2. Query (对话与固化复利)
* 插件提供一个对话侧边栏（Chat Panel）。
* 用户向 Wiki 提问时，LLM 先检索 `wiki/index.md` 确定关联页面，读取这些页面后生成带引用的回答。
* 提供 **“保存为新页面” (Save as Wiki Page)** 按钮：一键将本次对话产生的有价值总结或对比，固化为 Wiki 的正式页面，使探索过程沉淀下来。

#### 3. Lint (健康检查)
* 用户可一键运行 Wiki 检查。
* 调用 `.skills/Lint.md`，检查 Wiki 页面之间的**信息冲突/矛盾**、**陈旧的 claims**、**孤立页面（Orphans）**以及**缺失的交叉引用双链**，生成检查报告。

### 3.4 Wiki 目录结构规范
Wiki 目标目录中需包含以下核心构件：
```text
wiki/
├── .skills/          # 存放具体的 Agent Skill Markdown 模板（如 Ingest.md, Lint.md）
├── .agents/          # 存放行为协议（如 CLAUDE.md），约束 Agent 的全局工作流与 SOP 规范
├── .database/         # 存放轻量级结构化数据（JSON 格式索引，规避二进制数据库同步问题）
├── index.md          # 整个 Wiki 知识库的目录和卡片式元数据索引
└── log.md            # 追加式的操作审计日志，格式如 `## [YYYY-MM-DD] ingest | Title`
```

## 4. 技术决策 (Technical Decisions)

### 4.1 大模型调用架构
* **直接直连 API**：插件内置 API Key 设置，无需中转服务器。
* **支持的多模型供应商**：Gemini, Anthropic, OpenAI, DeepSeek, Kimi, OpenRouter。
* **调用方式**：使用 Obsidian 内置网络请求 API（如 `requestUrl` 或 `fetch`），确保在 Desktop 及 iOS 移动端皆可顺畅发送请求。

### 4.2 数据同步
* **插件职责**：插件**不提供**任何内置的同步功能。
* **用户职责**：用户自行通过第三方同步方式（如 Obsidian Sync、iCloud、Git 等）同步整个 Vault 文件夹。

### 4.3 数据库选择 (Database)
* 选用 **JSON 纯文本文件** 形式存储在 `wiki/.database/` 下，便于 Git 跟踪、冲突合并以及跨端同步。

### 4.5 Skills 与系统架构设计 (Agent Skill Markdown 驱动)
* **无代码模板化**：为兼容 iOS 且保持易读性，`.skills/` 下的 Skill 均定义为包含特定的 Frontmatter（描述、参数输入说明）与 System Prompt 内容的 **Markdown 文件**。
* **插拔与更新**：插件解析这些 Markdown 文件的 Frontmatter 和正文 Prompt，进行变量替换后向 LLM 发起请求。用户可直接在 Obsidian 中编辑 Prompt，实现自定义扩展。
