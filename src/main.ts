import { App, Plugin, PluginSettingTab, Setting, Modal, Notice, TFile, TFolder, normalizePath, WorkspaceLeaf, addIcon } from "obsidian";
import { GenWikiSettings, DEFAULT_SETTINGS, DatabaseIndex, WikiPageMetadata, ClippingMetadata } from "./types";
import { LLMClient } from "./llm";
import { parseSkillMarkdown, fillTemplate, DEFAULT_INGEST_SKILL, DEFAULT_QUERY_SKILL, DEFAULT_LINT_SKILL, DEFAULT_SAVEPAGE_SKILL } from "./skills";
import { GenWikiChatView, VIEW_TYPE_CHAT } from "./chat_view";

export default class GenWikiPlugin extends Plugin {
	settings!: GenWikiSettings;
	llmClient!: LLMClient;

	async onload() {
		await this.loadSettings();
		this.llmClient = new LLMClient(this.settings);

		// Register Chat View
		this.registerView(
			VIEW_TYPE_CHAT,
			(leaf) => new GenWikiChatView(leaf, this)
		);

		// Initialize folder structures and default templates
		await this.initFolders();
		await this.initDefaultTemplates();

		// Add settings tab
		this.addSettingTab(new GenWikiSettingTab(this.app, this));

		// Add ribbon icon for GenWiki Chat Panel (only ONE ribbon button)
		this.addRibbonIcon("cpu", "GenWiki: Open Chat Panel", () => {
			this.activateView();
		});

		// Register commands
		this.addCommand({
			id: "ingest-clippings",
			name: "Ingest Clippings (增量导入剪藏)",
			callback: async () => {
				new Notice("开始整理剪藏资料...");
				try {
					await this.runIngest();
				} catch (e) {
					new Notice(`Ingest 失败: ${(e as Error).message}`);
					console.error(e);
				}
			}
		});

		this.addCommand({
			id: "query-wiki",
			name: "Query Wiki (智能知识检索与对话)",
			callback: () => {
				new QueryModal(this.app, this).open();
			}
		});

		this.addCommand({
			id: "lint-wiki",
			name: "Lint Wiki (健康度体检)",
			callback: async () => {
				new Notice("正在开始知识库健康审计...");
				try {
					await this.runLint();
				} catch (e) {
					new Notice(`Lint 失败: ${(e as Error).message}`);
					console.error(e);
				}
			}
		});

		this.addCommand({
			id: "open-chat-view",
			name: "Open Chat Panel (打开智能问答侧边栏)",
			callback: () => this.activateView()
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.llmClient = new LLMClient(this.settings);
	}

	async activateView() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_CHAT);
		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
			}
		}
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	// Helper to calculate SHA256 in a pure client environment
	async calculateHash(text: string): Promise<string> {
		const msgBuffer = new TextEncoder().encode(text);
		const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
	}

	async initFolders() {
		const folders = [
			this.settings.clippingsDir,
			`${this.settings.clippingsDir}/Archived`,
			this.settings.wikiDir,
			`${this.settings.wikiDir}/_skills`,
			`${this.settings.wikiDir}/_agents`,
			`${this.settings.wikiDir}/_database`
		];

		for (const folder of folders) {
			const normalized = normalizePath(folder);
			const exists = this.app.vault.getAbstractFileByPath(normalized);
			if (!exists) {
				await this.app.vault.createFolder(normalized);
			}
		}
	}

	async initDefaultTemplates() {
		const templates = [
			{ path: `${this.settings.wikiDir}/_skills/Ingest.md`, content: DEFAULT_INGEST_SKILL },
			{ path: `${this.settings.wikiDir}/_skills/Query.md`, content: DEFAULT_QUERY_SKILL },
			{ path: `${this.settings.wikiDir}/_skills/SavePage.md`, content: DEFAULT_SAVEPAGE_SKILL },
			{ path: `${this.settings.wikiDir}/_skills/Lint.md`, content: DEFAULT_LINT_SKILL }
		];

		for (const t of templates) {
			const normalized = normalizePath(t.path);
			const file = this.app.vault.getAbstractFileByPath(normalized);
			if (!file) {
				await this.app.vault.create(normalized, t.content);
			}
		}

		// Init CLAUDE.md behavioral guide
		const claudePath = normalizePath(`${this.settings.wikiDir}/_agents/CLAUDE.md`);
		const file = this.app.vault.getAbstractFileByPath(claudePath);
		if (!file) {
			await this.app.vault.create(claudePath, `# CLAUDE.md\n\n本协议约束 GenWiki 处理知识的规范。`);
		}

		// Init log.md and index.md
		const indexPath = normalizePath(`${this.settings.wikiDir}/index.md`);
		if (!this.app.vault.getAbstractFileByPath(indexPath)) {
			await this.app.vault.create(indexPath, `# Knowledge Index\n\n本文件是自动生成的索引。`);
		}

		const logPath = normalizePath(`${this.settings.wikiDir}/log.md`);
		if (!this.app.vault.getAbstractFileByPath(logPath)) {
			await this.app.vault.create(logPath, `# Action Audit Logs\n\n记录每次知识整理和查询。`);
		}
	}

	async loadDatabase(): Promise<DatabaseIndex> {
		const dbPath = normalizePath(`${this.settings.wikiDir}/_database/index.json`);
		const file = this.app.vault.getAbstractFileByPath(dbPath);
		if (file instanceof TFile) {
			const text = await this.app.vault.read(file);
			try {
				return JSON.parse(text);
			} catch (e) {
				console.error("Failed to parse database file, resetting", e);
			}
		}

		// Return default structure if missing or corrupt
		return {
			version: "1.0.0",
			last_indexed: new Date().toISOString(),
			clippings: {},
			wiki_pages: {}
		};
	}

	async saveDatabase(db: DatabaseIndex) {
		const dbPath = normalizePath(`${this.settings.wikiDir}/_database/index.json`);
		const file = this.app.vault.getAbstractFileByPath(dbPath);
		const content = JSON.stringify(db, null, 2);
		if (file instanceof TFile) {
			await this.app.vault.modify(file, content);
		} else {
			await this.app.vault.create(dbPath, content);
		}
	}

	async logAction(action: string, title: string) {
		const logPath = normalizePath(`${this.settings.wikiDir}/log.md`);
		const file = this.app.vault.getAbstractFileByPath(logPath);
		if (file instanceof TFile) {
			const dateStr = new Date().toISOString().substring(0, 10);
			const entry = `\n## [${dateStr}] ${action} | ${title}\n`;
			await this.app.vault.append(file, entry);
		}
	}

	// Extract outgoing double links from text
	extractLinks(text: string): string[] {
		const links: string[] = [];
		const regex = /\[\[(.*?)\]\]/g;
		let match;
		while ((match = regex.exec(text)) !== null) {
			let link = match[1];
			// Handle aliases like [[PageName|Alias]]
			if (link.includes("|")) {
				link = link.split("|")[0];
			}
			// Handle headers like [[PageName#Header]]
			if (link.includes("#")) {
				link = link.split("#")[0];
			}
			const normalizedLink = normalizePath(`${this.settings.wikiDir}/${link.trim()}.md`);
			if (!links.includes(normalizedLink)) {
				links.push(normalizedLink);
			}
		}
		return links;
	}

	// Regenerate the main index.md file based on database contents
	async rebuildIndexMd(db: DatabaseIndex) {
		const indexPath = normalizePath(`${this.settings.wikiDir}/index.md`);
		const file = this.app.vault.getAbstractFileByPath(indexPath);
		if (!(file instanceof TFile)) return;

		let content = `# Knowledge Index\n\n此页面由 GenWiki 自动更新，展示全部归档知识点的索引图谱。\n\n## 概念 (Concepts)\n`;
		
		const concepts = Object.values(db.wiki_pages).filter(p => p.type === "concept" && p.status !== "archived");
		const entities = Object.values(db.wiki_pages).filter(p => p.type === "entity" && p.status !== "archived");
		const generals = Object.values(db.wiki_pages).filter(p => p.type === "general" && p.status !== "archived");

		for (const p of concepts) {
			content += `* [[${p.title}]] - *${p.summary}*\n`;
		}

		content += `\n## 实体 (Entities)\n`;
		for (const p of entities) {
			content += `* [[${p.title}]] - *${p.summary}*\n`;
		}

		content += `\n## 其他页面 (General Pages)\n`;
		for (const p of generals) {
			content += `* [[${p.title}]] - *${p.summary}*\n`;
		}

		await this.app.vault.modify(file, content);
	}

	// P1: Ingest Process
	async runIngest() {
		const clippingsFolder = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.clippingsDir));
		if (!(clippingsFolder instanceof TFolder)) {
			throw new Error(`Clippings directory ${this.settings.clippingsDir} does not exist.`);
		}

		// Load db
		const db = await this.loadDatabase();
		const files = clippingsFolder.children;
		const mdFiles = files.filter(f => f instanceof TFile && f.extension === "md") as TFile[];

		let processedAny = false;

		for (const mdFile of mdFiles) {
			const relativePath = mdFile.path;
			// Skip files already in Archived folder or marked as processed
			if (relativePath.includes("/Archived/")) continue;
			const clippingMeta = db.clippings[relativePath];
			if (clippingMeta && clippingMeta.status === "processed") continue;

			// Ingest file
			const content = await this.app.vault.read(mdFile);
			const hash = await this.calculateHash(content);

			// Read index.md
			const indexFile = this.app.vault.getAbstractFileByPath(normalizePath(`${this.settings.wikiDir}/index.md`));
			const indexContent = indexFile instanceof TFile ? await this.app.vault.read(indexFile) : "";

			// Read Ingest Skill
			const skillFile = this.app.vault.getAbstractFileByPath(normalizePath(`${this.settings.wikiDir}/_skills/Ingest.md`));
			if (!(skillFile instanceof TFile)) {
				throw new Error("Ingest skill template missing.");
			}
			const skillRaw = await this.app.vault.read(skillFile);
			const skill = parseSkillMarkdown(skillRaw);

			// Fill variables
			const userPrompt = fillTemplate(skill.userPromptTemplate, {
				index_content: indexContent,
				clipping_content: content
			});

			new Notice(`正在通过 AI 分析 ${mdFile.name}...`);
			const response = await this.llmClient.complete(userPrompt, skill.systemPrompt);
			const cleanResponse = LLMClient.cleanJsonString(response);

			let result;
			try {
				result = JSON.parse(cleanResponse);
			} catch (e) {
				console.error("Failed to parse LLM Response JSON", cleanResponse, e);
				new Notice(`模型返回的 JSON 格式不规范，请重试！`);
				db.clippings[relativePath] = {
					path: relativePath,
					sha256: hash,
					ingest_date: new Date().toISOString(),
					status: "failed",
					destinations: []
				};
				await this.saveDatabase(db);
				continue;
			}

			const destinations: string[] = [];

			// Apply operations (create or modify files)
			if (result.operations && Array.isArray(result.operations)) {
				for (const op of result.operations) {
					const destPath = normalizePath(op.path);
					destinations.push(destPath);
					const opFile = this.app.vault.getAbstractFileByPath(destPath);

					if (op.action === "create" || !opFile) {
						// Ensure directory structure
						const parts = destPath.split("/");
						if (parts.length > 1) {
							const parentDir = parts.slice(0, parts.length - 1).join("/");
							if (!this.app.vault.getAbstractFileByPath(normalizePath(parentDir))) {
								await this.app.vault.createFolder(normalizePath(parentDir));
							}
						}
						await this.app.vault.create(destPath, op.content);
					} else if (opFile instanceof TFile) {
						await this.app.vault.modify(opFile, op.content);
					}

					// Update database metadata for this page
					const fileContent = op.content;
					const fileHash = await this.calculateHash(fileContent);
					const linksTo = this.extractLinks(fileContent);

					// Index updates
					const idxUpdate = result.index_updates?.find((iu: any) => iu.path === op.path) || {};

					const existingPage = db.wiki_pages[destPath];
					const auditHistory = existingPage?.audit.history || [];
					auditHistory.push({
						timestamp: new Date().toISOString(),
						action: op.action,
						trigger: "ingest",
						source: relativePath
					});

					db.wiki_pages[destPath] = {
						path: destPath,
						title: op.title || opFile?.name.replace(".md", "") || "Untitled",
						aliases: idxUpdate.aliases || existingPage?.aliases || [],
						type: idxUpdate.type || existingPage?.type || "general",
						summary: idxUpdate.summary || existingPage?.summary || "自动生成的信息条目。",
						status: "active",
						last_updated: new Date().toISOString(),
						sha256: fileHash,
						links_to: linksTo,
						links_from: existingPage?.links_from || [],
						claims: [
							{
								clipping_path: relativePath,
								line_range: "all",
								paragraph_summary: idxUpdate.summary || "源自剪藏的总结"
							}
						],
						audit: {
							created_at: existingPage?.audit.created_at || new Date().toISOString(),
							last_compiled_cost_usd: 0.01,
							history: auditHistory
						}
					};
				}
			}

			// Update link_from backreferences
			for (const pagePath of destinations) {
				const page = db.wiki_pages[pagePath];
				if (page) {
					for (const outgoing of page.links_to) {
						const targetPage = db.wiki_pages[outgoing];
						if (targetPage && !targetPage.links_from.includes(pagePath)) {
							targetPage.links_from.push(pagePath);
						}
					}
				}
			}

			// Save clipping status
			db.clippings[relativePath] = {
				path: relativePath,
				sha256: hash,
				ingest_date: new Date().toISOString(),
				status: "processed",
				destinations: destinations
			};

			// Log Ingest
			await this.logAction("ingest", mdFile.name);

			// Move file to Archived
			const archivedPath = normalizePath(`${this.settings.clippingsDir}/Archived/${mdFile.name}`);
			await this.app.vault.rename(mdFile, archivedPath);
			processedAny = true;
		}

		if (processedAny) {
			await this.saveDatabase(db);
			await this.rebuildIndexMd(db);
			new Notice("🎉 剪藏整理合并完成！索引已刷新。");
		} else {
			new Notice("没有找到未处理的剪藏文件！");
		}
	}

	// P1: Query core execution
	async executeQuery(question: string): Promise<string> {
		const db = await this.loadDatabase();

		// Step 1: Read Query Skill
		const querySkillFile = this.app.vault.getAbstractFileByPath(normalizePath(`${this.settings.wikiDir}/_skills/Query.md`));
		if (!(querySkillFile instanceof TFile)) {
			throw new Error("Query skill template missing.");
		}
		const skillRaw = await this.app.vault.read(querySkillFile);
		const skill = parseSkillMarkdown(skillRaw);

		// Simple search algorithm: Find files from index.json matching keywords
		const keywords = question.toLowerCase().split(/\s+/);
		const matchingPages: WikiPageMetadata[] = [];
		for (const page of Object.values(db.wiki_pages)) {
			const matches = keywords.some(kw => 
				page.title.toLowerCase().includes(kw) || 
				page.summary.toLowerCase().includes(kw) ||
				page.aliases.some(alias => alias.toLowerCase().includes(kw))
			);
			if (matches) {
				matchingPages.push(page);
			}
		}

		// If no matches, fall back to reading top 5 pages or index
		const pagesToRead = matchingPages.length > 0 ? matchingPages.slice(0, 5) : Object.values(db.wiki_pages).slice(0, 5);
		let combinedContents = "";

		for (const p of pagesToRead) {
			const file = this.app.vault.getAbstractFileByPath(p.path);
			if (file instanceof TFile) {
				const content = await this.app.vault.read(file);
				combinedContents += `\n=== FILE: ${p.path} ===\n${content}\n`;
			}
		}

		if (!combinedContents.trim()) {
			combinedContents = "（暂无相关Wiki知识内容，请先Ingest导入剪藏）";
		}

		// Fill prompt
		const userPrompt = fillTemplate(skill.userPromptTemplate, {
			user_question: question,
			page_contents: combinedContents
		});

		// Call LLM
		const response = await this.llmClient.complete(userPrompt, skill.systemPrompt);
		await this.logAction("query", question);
		return response;
	}

	// P1: Lint Process
	async runLint() {
		const db = await this.loadDatabase();
		const activePages = Object.values(db.wiki_pages).filter(p => p.status !== "archived");

		if (activePages.length === 0) {
			new Notice("Wiki中没有任何页面，请先执行 Ingest 导入！");
			return;
		}

		// Read Lint skill
		const lintSkillFile = this.app.vault.getAbstractFileByPath(normalizePath(`${this.settings.wikiDir}/_skills/Lint.md`));
		if (!(lintSkillFile instanceof TFile)) {
			throw new Error("Lint skill template missing.");
		}
		const skillRaw = await this.app.vault.read(lintSkillFile);
		const skill = parseSkillMarkdown(skillRaw);

		// Group pages (batch of 5)
		const batchSize = 5;
		const contradictions: any[] = [];
		const orphans: string[] = [];
		const suggestions: string[] = [];

		for (let i = 0; i < activePages.length; i += batchSize) {
			const batch = activePages.slice(i, i + batchSize);
			let groupPagesContent = "";

			for (const page of batch) {
				const file = this.app.vault.getAbstractFileByPath(page.path);
				if (file instanceof TFile) {
					const content = await this.app.vault.read(file);
					groupPagesContent += `\n=== FILE: ${page.path} ===\n${content}\n`;
				}
			}

			const userPrompt = fillTemplate(skill.userPromptTemplate, {
				group_pages: groupPagesContent
			});

			new Notice(`正在审计第 ${Math.floor(i / batchSize) + 1} 组知识节点...`);
			const response = await this.llmClient.complete(userPrompt, skill.systemPrompt);
			const cleanResponse = LLMClient.cleanJsonString(response);

			try {
				const resObj = JSON.parse(cleanResponse);
				if (resObj.contradictions) contradictions.push(...resObj.contradictions);
				if (resObj.orphans) orphans.push(...resObj.orphans);
				if (resObj.suggestions) suggestions.push(...resObj.suggestions);
			} catch (e) {
				console.error("Failed to parse Lint Response JSON", cleanResponse, e);
			}
		}

		// Post processing for orphans (check backlinks)
		const finalOrphans = orphans.filter(path => {
			const page = db.wiki_pages[path];
			return !page || page.links_from.length === 0;
		});

		// Write Lint Report
		const reportPath = normalizePath(`${this.settings.wikiDir}/Lint_Report.md`);
		let reportContent = `# GenWiki 知识库健康体检审计报告\n\n报告生成时间: ${new Date().toLocaleString()}\n\n`;

		reportContent += `## 1. 信息冲突与矛盾警告 (Contradictions)\n`;
		if (contradictions.length > 0) {
			for (const c of contradictions) {
				reportContent += `* **涉及文件**: ${c.files.map((f: string) => `[[${f.replace(this.settings.wikiDir + "/", "").replace(".md", "")}]]`).join(", ")}\n  * **矛盾描述**: ${c.description}\n`;
			}
		} else {
			reportContent += `✅ 未检测到明显的逻辑冲突或数据矛盾。\n`;
		}

		reportContent += `\n## 2. 孤立节点列表 (Orphan Pages)\n`;
		if (finalOrphans.length > 0) {
			for (const path of finalOrphans) {
				const title = path.replace(this.settings.wikiDir + "/", "").replace(".md", "");
				reportContent += `* [[${title}]] - *无其他页面引用*\n`;
			}
		} else {
			reportContent += `✅ 所有 Wiki 页面均有入站链接关联。\n`;
		}

		reportContent += `\n## 3. 关联构建与补全建议 (Suggestions)\n`;
		if (suggestions.length > 0) {
			for (const s of suggestions) {
				reportContent += `* ${s}\n`;
			}
		} else {
			reportContent += `✅ 目前连接图谱完整性良好。\n`;
		}

		const reportFile = this.app.vault.getAbstractFileByPath(reportPath);
		if (reportFile instanceof TFile) {
			await this.app.vault.modify(reportFile, reportContent);
		} else {
			await this.app.vault.create(reportPath, reportContent);
		}

		// Log and Open report
		await this.logAction("lint", "Lint健康审计报告");
		new Notice("🎉 知识健康体检完成！报告已生成。");
		this.app.workspace.getLeaf().openFile(this.app.vault.getAbstractFileByPath(reportPath) as TFile);
	}
}

// Modal for P1 Query Console Command
class QueryModal extends Modal {
	plugin: GenWikiPlugin;

	constructor(app: App, plugin: GenWikiPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "🔍 智能 Wiki 问答检索" });

		const inputEl = contentEl.createEl("input", {
			type: "text",
			placeholder: "请输入您对 Wiki 的疑问（支持模糊语义检索）..."
		});
		inputEl.style.width = "100%";
		inputEl.style.marginBottom = "15px";

		const submitBtn = contentEl.createEl("button", { text: "提交问答" });
		const resultContainer = contentEl.createDiv();
		resultContainer.style.marginTop = "15px";
		resultContainer.style.maxHeight = "300px";
		resultContainer.style.overflowY = "auto";
		resultContainer.style.borderTop = "1px solid var(--border-color)";
		resultContainer.style.paddingTop = "15px";

		submitBtn.addEventListener("click", async () => {
			const query = inputEl.value.trim();
			if (!query) return;

			resultContainer.setText("正在分析检索，请稍候...");
			submitBtn.disabled = true;

			try {
				const ans = await this.plugin.executeQuery(query);
				resultContainer.empty();
				// Render simple markdown response
				const preEl = resultContainer.createEl("pre");
				preEl.style.whiteSpace = "pre-wrap";
				preEl.setText(ans);
			} catch (e) {
				resultContainer.setText(`查询错误: ${(e as Error).message}`);
				console.error(e);
			} finally {
				submitBtn.disabled = false;
			}
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// Settings tab implementation
class GenWikiSettingTab extends PluginSettingTab {
	plugin: GenWikiPlugin;

	constructor(app: App, plugin: GenWikiPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	addModelSetting(
		containerEl: HTMLElement,
		providerName: string,
		presetsModel: string[],
		currentModel: string,
		onModelChange: (val: string) => Promise<void>
	) {
		const isPreset = presetsModel.includes(currentModel);
		const dropdownValue = isPreset ? currentModel : "customized";

		new Setting(containerEl)
			.setName(`${providerName} Model`)
			.setDesc("选择预设模型或自定义")
			.addDropdown(dropdown => {
				for (const m of presetsModel) {
					dropdown.addOption(m, m);
				}
				dropdown.addOption("customized", "自定义 (Custom)");
				dropdown.setValue(dropdownValue);
				dropdown.onChange(async (val) => {
					if (val === "customized") {
						await onModelChange("");
					} else {
						await onModelChange(val);
					}
					this.display();
				});
			});

		if (dropdownValue === "customized") {
			new Setting(containerEl)
				.setName(`自定义 ${providerName} Model ID`)
				.setDesc("请输入您想要使用的自定义模型标识符")
				.addText(text => text
					.setPlaceholder("例如: gpt-4-custom")
					.setValue(currentModel)
					.onChange(async (val) => {
						await onModelChange(val);
					})
				);
		}
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "GenWiki Settings (大模型设置)" });

		new Setting(containerEl)
			.setName("默认大模型供应商 (Provider)")
			.setDesc("选择使用的模型通道")
			.addDropdown(dropdown => dropdown
				.addOption("gemini", "Google Gemini")
				.addOption("anthropic", "Anthropic Claude")
				.addOption("openai", "OpenAI")
				.addOption("deepseek", "DeepSeek")
				.addOption("kimi", "Moonshot Kimi")
				.addOption("openrouter", "OpenRouter")
				.setValue(this.plugin.settings.provider)
				.onChange(async (value) => {
					this.plugin.settings.provider = value;
					await this.plugin.saveSettings();
					this.display();
				}));

		// Conditionally render options for each provider
		const prov = this.plugin.settings.provider;

		if (prov === "gemini") {
			new Setting(containerEl)
				.setName("Gemini API Key")
				.addText(text => text
					.setPlaceholder("Enter Gemini API Key")
					.setValue(this.plugin.settings.geminiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.geminiApiKey = value;
						await this.plugin.saveSettings();
					}));

			this.addModelSetting(
				containerEl,
				"Gemini",
				[
					"gemini-3.5-flash",
					"gemini-3.1-pro-preview",
					"gemini-3.1-flash-lite",
					"gemini-2.5-pro",
					"gemini-2.5-flash",
					"gemini-2.5-flash-lite",
					"gemini-flash-latest"
				],
				this.plugin.settings.geminiModel,
				async (val) => {
					this.plugin.settings.geminiModel = val;
					await this.plugin.saveSettings();
				}
			);
		}

		if (prov === "anthropic") {
			new Setting(containerEl)
				.setName("Anthropic API Key")
				.addText(text => text
					.setPlaceholder("Enter Anthropic API Key")
					.setValue(this.plugin.settings.anthropicApiKey)
					.onChange(async (value) => {
						this.plugin.settings.anthropicApiKey = value;
						await this.plugin.saveSettings();
					}));

			this.addModelSetting(
				containerEl,
				"Anthropic",
				[
					"claude-opus-4-8",
					"claude-sonnet-4-6",
					"claude-haiku-4-5",
					"claude-haiku-4-5-20251001"
				],
				this.plugin.settings.anthropicModel,
				async (val) => {
					this.plugin.settings.anthropicModel = val;
					await this.plugin.saveSettings();
				}
			);
		}

		if (prov === "openai") {
			new Setting(containerEl)
				.setName("OpenAI API Key")
				.addText(text => text
					.setPlaceholder("Enter OpenAI API Key")
					.setValue(this.plugin.settings.openaiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openaiApiKey = value;
						await this.plugin.saveSettings();
					}));

			this.addModelSetting(
				containerEl,
				"OpenAI",
				[
					"gpt-5.5",
					"gpt-5.5-pro",
					"gpt-5.4",
					"gpt-5.4-mini",
					"gpt-5.4-nano",
					"chat-latest"
				],
				this.plugin.settings.openaiModel,
				async (val) => {
					this.plugin.settings.openaiModel = val;
					await this.plugin.saveSettings();
				}
			);
		}

		if (prov === "deepseek") {
			new Setting(containerEl)
				.setName("DeepSeek API Key")
				.addText(text => text
					.setPlaceholder("Enter DeepSeek API Key")
					.setValue(this.plugin.settings.deepseekApiKey)
					.onChange(async (value) => {
						this.plugin.settings.deepseekApiKey = value;
						await this.plugin.saveSettings();
					}));

			this.addModelSetting(
				containerEl,
				"DeepSeek",
				[
					"deepseek-v4-pro",
					"deepseek-v4-flash",
					"deepseek-chat",
					"deepseek-reasoner"
				],
				this.plugin.settings.deepseekModel,
				async (val) => {
					this.plugin.settings.deepseekModel = val;
					await this.plugin.saveSettings();
				}
			);
		}

		if (prov === "kimi") {
			new Setting(containerEl)
				.setName("Kimi API Key")
				.addText(text => text
					.setPlaceholder("Enter Moonshot API Key")
					.setValue(this.plugin.settings.kimiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.kimiApiKey = value;
						await this.plugin.saveSettings();
					}));

			this.addModelSetting(
				containerEl,
				"Kimi",
				[
					"kimi-k2.6",
					"kimi-k2.5",
					"moonshot-v1-8k",
					"moonshot-v1-32k",
					"moonshot-v1-128k",
					"moonshot-v1-8k-vision-preview",
					"moonshot-v1-32k-vision-preview",
					"moonshot-v1-128k-vision-preview"
				],
				this.plugin.settings.kimiModel,
				async (val) => {
					this.plugin.settings.kimiModel = val;
					await this.plugin.saveSettings();
				}
			);
		}

		if (prov === "openrouter") {
			new Setting(containerEl)
				.setName("OpenRouter API Key")
				.addText(text => text
					.setPlaceholder("Enter OpenRouter API Key")
					.setValue(this.plugin.settings.openrouterApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openrouterApiKey = value;
						await this.plugin.saveSettings();
					}));

			this.addModelSetting(
				containerEl,
				"OpenRouter",
				[
					"openai/gpt-5.5",
					"openai/gpt-5.5-pro",
					"openai/gpt-chat-latest",
					"anthropic/claude-opus-4.8",
					"anthropic/claude-sonnet-4.6",
					"anthropic/claude-sonnet-4.5",
					"google/gemini-3.5-flash",
					"google/gemini-3.1-flash-lite",
					"google/gemini-3.1-pro-preview",
					"deepseek/deepseek-v4-pro",
					"deepseek/deepseek-v4-flash",
					"moonshotai/kimi-k2.6",
					"moonshotai/kimi-k2.6:free",
					"qwen/qwen3.7-max",
					"qwen/qwen3.7-plus",
					"x-ai/grok-4.3",
					"mistralai/mistral-medium-3-5",
					"openrouter/free"
				],
				this.plugin.settings.openrouterModel,
				async (val) => {
					this.plugin.settings.openrouterModel = val;
					await this.plugin.saveSettings();
				}
			);
		}

		containerEl.createEl("h2", { text: "目录路径配置 (Paths)" });

		new Setting(containerEl)
			.setName("Clippings 目录")
			.setDesc("网页剪藏存放路径")
			.addText(text => text
				.setValue(this.plugin.settings.clippingsDir)
				.onChange(async (value) => {
					this.plugin.settings.clippingsDir = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Wiki 目录")
			.setDesc("结构化知识文件存放路径")
			.addText(text => text
				.setValue(this.plugin.settings.wikiDir)
				.onChange(async (value) => {
					this.plugin.settings.wikiDir = value;
					await this.plugin.saveSettings();
				}));
	}
}
