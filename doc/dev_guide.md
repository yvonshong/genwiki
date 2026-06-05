# GenWiki 插件开发与本地调试指南 (Developer Guide)

本指南介绍如何在本地搭建 Obsidian 插件开发环境，并将编译好的插件加载到本地 Obsidian 中进行开发、调试以及真机 (iOS) 调试。

---

## 1. 本地目录与构建流程

开发 Obsidian 插件需要将编译好的产物放入 Obsidian 库的特定位置。

### 1.1 产物文件要求
Obsidian 加载一个社区插件需要以下三个核心文件，存放在 `[YourVault]/.obsidian/plugins/genwiki/` 目录下：
* **`manifest.json`**: 插件元数据（包含 ID、版本、最低 Obsidian 版本要求等）。
* **`main.js`**: TypeScript/ES6 源码经 `esbuild` 编译打包后的单文件产物。
* **`styles.css`**: 样式表（如果包含自定义样式）。

### 1.2 推荐的本地开发目录结构
为了方便自动构建并直接输出到测试库，建议结构如下：
```text
genwiki/              # 您的开发项目根目录 (即当前 workspace)
├── package.json
├── tsconfig.json
├── esbuild.config.mjs # 编译脚本
├── src/              # TS 源代码
│   ├── main.ts
│   └── views/
├── manifest.json
└── styles.css
```

---

## 2. 调试第一步：Obsidian 桌面端调试

### Step 2.1: 创建测试库 (Vault)
1. 打开 Obsidian，新建一个空库，命名为 `GenWikiDevVault`。
2. 在 `GenWikiDevVault` 的根目录下创建 `wiki/` 目录。

### Step 2.2: 软链接或重定向编译输出
为了避免每次构建后手动复制文件，可以通过以下两种方式之一让编译产物直接输出到测试库：
* **方式 A（软链接 - 推荐）**：
  在系统终端中，将开发项目的产物目录直接软链接到测试库中：
  ```bash
  ln -s /path/to/genwiki /path/to/GenWikiDevVault/.obsidian/plugins/genwiki
  ```
* **方式 B（构建脚本重定向）**：
  修改 `esbuild.config.mjs` 中的 `outfile` 路径，直接指向 `GenWikiDevVault/.obsidian/plugins/genwiki/main.js`。

### Step 2.3: 启动热重载构建
在项目根目录运行以下命令进行开发模式自动构建：
```bash
# 安装依赖
npm install

# 启动热重载监视（源码改变时自动增量编译）
npm run dev
```

### Step 2.4: 激活插件
1. 打开 Obsidian 中的 `GenWikiDevVault`。
2. 进入 **设置 (Settings) $\rightarrow$ 第三方插件 (Community Plugins)**：
   * 开启“启用第三方插件 (Enable community plugins)”。
   * 在“已安装插件 (Installed plugins)”列表中找到 **GenWiki**。
   * 打开开关激活它。
3. **推荐安装 Hot Reload 插件**：在 Obsidian 社区插件中搜索并安装 `Hot Reload`，这样当 `main.js` 被重新编译时，Obsidian 会在后台自动刷新重新载入插件，无需频繁手动重启 Obsidian。

### Step 2.5: 打开开发者工具
Obsidian 是基于 Electron 构建的，你可以使用标准的 Chrome 开发者工具进行调试：
* **快捷键**：按下 `Ctrl + Shift + I` (Windows/Linux) 或 `Cmd + Option + I` (macOS)。
* **调试范围**：
  * **Console 控制台**：查看 API 调用日志、报错堆栈。
  * **Network 网络**：拦截和检查向大模型（Gemini、Anthropic 等）发起的 HTTP Fetch 请求和 Response 数据。
  * **Elements 元素**：调试侧边栏 Chat Panel 的 DOM 结构和 CSS 样式。

---

## 3. 调试第二步：iOS 真机调试 (移动端)

当桌面端核心功能稳定后，需要验证在 iOS 沙盒下的运行情况。

### Step 3.1: 同步代码至 iOS 设备
1. 将测试库 `GenWikiDevVault` 通过 iCloud Drive、Obsidian Sync 等方式同步到 iOS 设备上。
2. 在 iOS 设备上打开该库。
3. 进入设置，启用第三方插件，并激活 **GenWiki**。

### Step 3.2: 远程调试 iOS Obsidian
如果要在 iOS 真机上查看 Console 日志或调试网络请求，可以使用 Safari 的远程调试工具：
1. **iOS 设备设置**：在 iPhone/iPad 上前往 **设置 $\rightarrow$ Safari 浏览器 $\rightarrow$ 高级**，开启 **“网页检查器 (Web Inspector)”**。
2. **连接电脑**：使用数据线将 iOS 设备连接至 macOS 电脑。
3. **在 Mac 上调试**：
   * 在 Mac 上打开 Safari 浏览器。
   * 点击顶部菜单栏的 **开发 (Develop)**。
   * 在设备列表中找到您的 iPhone/iPad，并在二级菜单中选择 `Obsidian`。
   * 此时将弹出一个全功能的 Safari Web Inspector 调试面板，您可以在此实时查看 iOS 设备上的 Console 报错和 Network 请求。

---

## 4. 发布插件到 Obsidian 官方社区市场

当插件测试完毕，准备向 Obsidian 官方申请上架社区插件商店时，需要遵循以下规范流程：

### Step 4.1: 自动化构建与发布 (GitHub Action)
为了免去手动编译与上传附件的繁琐步骤，本项目已配置好 GitHub Action 自动化工作流。

1. 本项目的工作流文件位于 [.github/workflows/release.yml](file:///home/song/Code/Personal/genwiki/.github/workflows/release.yml)。
2. 当您向 GitHub 推送任何版本 Tag（例如 `1.0.0`）时，该 GitHub Action 会自动触发：
   * 自动拉取代码并配置 Node.js 环境。
   * 运行 `npm run build` 进行生产环境编译，生成 `main.js`。
   * 自动在 GitHub 上以该 Tag 创建一个 Release，并将 `main.js`、`manifest.json`、`styles.css` 编译产物自动打包作为 **Release Assets** 上传。

> [!TIP]
> 触发工作流非常简单，只需在本地运行以下命令即可：
> ```bash
> git tag 1.0.0
> git push origin 1.0.0
> ```

### Step 4.2: 校验 Release 附件
1. 推送后，在您的 GitHub 仓库 `Releases` 页面中，检查新创建的 Release。
2. 确保 `Assets` 列表中包含了以下三个文件：
   - `main.js`
   - `manifest.json`
   - `styles.css`
   > [!IMPORTANT]
   > Obsidian 官方分发系统会自动拉取对应 Tag Release 下的这三个 Release Assets 文件来进行分发。缺失任何一个都将导致安装失败。

### Step 4.3: 提交 Pull Request 至官方仓库
1. Fork 官方社区仓库：[obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases)。
2. 将您 Fork 的项目 Clone 到本地，并编辑 `community-plugins.json` 文件。
3. 在 `community-plugins.json` 数组中，按**插件 ID 的字母顺序**插入您插件的申报信息：
   ```json
   {
     "id": "genwiki",
     "name": "GenWiki",
     "author": "yvonshong",
     "description": "Incremental personal knowledge base using LLMs for Obsidian",
     "repo": "yvonshong/genwiki"
   }
   ```
4. 将更改推送至您的 GitHub Fork 库，并向 `obsidianmd/obsidian-releases` 的 `master` 分支发起一个 **Pull Request (PR)**。

### Step 4.4: 代码审计与上架
1. **官方审查**：Obsidian 的官方维护人员会对您的 PR 进行人工审查。他们会评估插件是否包含恶意代码、使用不安全的 `eval` 执行、是否存在明显的桌面/移动端适配崩溃，以及性能影响。
2. **合并发布**：审核通过后，维护人员会将您的 PR 合并到主分支。合并后，全球用户即可直接在 Obsidian 的 **设置 $\rightarrow$ 第三方插件 $\rightarrow$ 社区插件市场** 中搜索到 `GenWiki` 并一键安装。

```
npm version patch   # 自动生成 tag 1.0.3（无 v 前缀）
git push origin main --follow-tags

```