import { ItemView, WorkspaceLeaf, Notice, TFile, normalizePath, MarkdownRenderer } from "obsidian";
import GenWikiPlugin from "./main";
import { parseSkillMarkdown, fillTemplate } from "./skills";
import { LLMClient } from "./llm";

export const VIEW_TYPE_CHAT = "genwiki-chat-view";

export class GenWikiChatView extends ItemView {
	plugin: GenWikiPlugin;
	historyContainer!: HTMLDivElement;
	inputArea!: HTMLTextAreaElement;
	sendButton!: HTMLButtonElement;

	constructor(leaf: WorkspaceLeaf, plugin: GenWikiPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_CHAT;
	}

	getDisplayText(): string {
		return "GenWiki 智能问答";
	}

	getIcon(): string {
		return "cpu";
	}

	async onOpen() {
		const container = this.containerEl.children[1] as HTMLDivElement;
		container.empty();
		container.addClass("genwiki-chat-view");

		// Header row with Ingest button
		const headerRow = container.createDiv({ cls: "genwiki-header-row" });
		headerRow.createEl("h3", { text: "💬 GenWiki 智能问答" });
		
		const startIngestBtn = headerRow.createEl("button", {
			cls: "genwiki-top-ingest-btn mod-cta",
			text: "📥 开始处理剪藏"
		});
		startIngestBtn.addEventListener("click", () => {
			void (async () => {
				startIngestBtn.disabled = true;
				startIngestBtn.setText("正在整理中...");
				new Notice("正在开始扫描并整理剪藏资料...");
				try {
					// Access plugin directly to run ingest
					await this.plugin.runIngest();
					new Notice("🎉 剪藏整理完成！");
				} catch (e) {
					new Notice(`Ingest 失败: ${(e as Error).message}`);
					console.error(e);
				} finally {
					startIngestBtn.disabled = false;
					startIngestBtn.setText("📥 开始处理剪藏");
				}
			})();
		});

		// Chat History Area
		this.historyContainer = container.createDiv({ cls: "genwiki-chat-history" });

		// Event delegation for internal wikilinks
		this.historyContainer.addEventListener("click", (e) => {
			const target = e.target as HTMLElement;
			if (target && target.tagName === "A" && target.hasClass("internal-link")) {
				e.preventDefault();
				const href = target.getAttribute("href");
				if (href) {
					// Open the clicked wikilink note in Obsidian workspace
					void this.plugin.app.workspace.openLinkText(href, "", true);
				}
			}
		});

		// Welcome Message
		this.appendMessage("assistant", "你好！我是你的 GenWiki 助手。我可以基于你当前 Wiki 知识库内的概念和实体回答你的问题。问答产生的洞察支持一键保存为正式知识文件。");

		// Input Section
		const inputContainer = container.createDiv({ cls: "genwiki-chat-input-container" });
		
		this.inputArea = inputContainer.createEl("textarea", {
			cls: "genwiki-chat-input",
			placeholder: "向 Wiki 提问..."
		});

		this.sendButton = inputContainer.createEl("button", { text: "发送" });

		// Event Listeners
		this.sendButton.addEventListener("click", () => { void this.handleSend(); });
		this.inputArea.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				void this.handleSend();
			}
		});
	}

	async onClose() {
		// Nothing to clean up
	}

	appendMessage(sender: "user" | "assistant", text: string): HTMLDivElement {
		const msgDiv = this.historyContainer.createDiv({
			cls: `genwiki-chat-message genwiki-chat-message-${sender}`
		});
		msgDiv.setText(text);
		this.historyContainer.scrollTop = this.historyContainer.scrollHeight;
		return msgDiv;
	}

	async handleSend() {
		const query = this.inputArea.value.trim();
		if (!query) return;

		// Append user message
		this.appendMessage("user", query);
		this.inputArea.value = "";

		// Append placeholder for assistant
		const assistantMsgDiv = this.appendMessage("assistant", "正在思考检索中...");
		this.sendButton.disabled = true;
		this.inputArea.disabled = true;

		try {
			const answer = await this.plugin.executeQuery(query);
			assistantMsgDiv.empty();
			
			// Render markdown formatted response
			const renderDiv = assistantMsgDiv.createDiv();
			await MarkdownRenderer.render(this.app, answer, renderDiv, "", this);

			// Create actions container
			const actionsDiv = assistantMsgDiv.createDiv({ cls: "genwiki-msg-actions" });

			// Copy button
			const copyBtn = actionsDiv.createEl("button", {
				cls: "genwiki-copy-btn",
				text: "📋 复制"
			});
			copyBtn.addEventListener("click", () => {
				navigator.clipboard.writeText(answer);
				new Notice("已复制到剪贴板！");
			});

			const isNoRecord = answer.includes("暂无相关记录") || answer.includes("暂无相关") || answer.includes("暂无相关Wiki");
			if (!isNoRecord) {
				// Append "Save to Wiki" button for this response
				const saveBtn = actionsDiv.createEl("button", {
					cls: "genwiki-save-btn mod-cta",
					text: "💾 保存为 Wiki 页面"
				});

				saveBtn.addEventListener("click", () => {
					void (async () => {
						saveBtn.disabled = true;
						saveBtn.setText("正在提炼归纳...");
						try {
							await this.saveResponseToWiki(query, answer);
							saveBtn.setText("✅ 已成功保存");
						} catch (err) {
							new Notice(`保存失败: ${(err as Error).message}`);
							saveBtn.disabled = false;
							saveBtn.setText("💾 保存为 Wiki 页面");
						}
					})();
				});
			}

		} catch (err) {
			assistantMsgDiv.setText(`错误: ${(err as Error).message}`);
			console.error(err);
		} finally {
			this.sendButton.disabled = false;
			this.inputArea.disabled = false;
			this.historyContainer.scrollTop = this.historyContainer.scrollHeight;
		}
	}

	// P2: Save to Wiki orchestration
	async saveResponseToWiki(question: string, answer: string) {
		// 1. Fetch SavePage Skill
		const skillFile = this.plugin.app.vault.getAbstractFileByPath(normalizePath(`${this.plugin.settings.wikiDir}/_skills/SavePage.md`));
		if (!(skillFile instanceof TFile)) {
			throw new Error("SavePage skill template missing.");
		}
		const skillRaw = await this.plugin.app.vault.read(skillFile);
		const skill = parseSkillMarkdown(skillRaw);

		// 2. Fill prompt variables
		const userPrompt = fillTemplate(skill.userPromptTemplate, {
			user_question: question,
			assistant_answer: answer
		});

		// 3. Ask LLM to refine into formal wiki page
		new Notice("正在进行格式整理与去话语化...");
		const response = await this.plugin.llmClient.complete(userPrompt, skill.systemPrompt);
		const cleanResponse = LLMClient.cleanJsonString(response);

		const parsed = (() => {
			try {
				return JSON.parse(cleanResponse) as unknown;
			} catch (e) {
				console.error("Failed to parse SavePage response JSON", cleanResponse, e);
				throw new Error("模型生成的 JSON 格式不规范，请重新尝试。");
			}
		})();

		if (typeof parsed !== "object" || parsed === null) {
			throw new Error("模型生成的 JSON 不是对象类型，无法保存。");
		}

		const result = parsed as Record<string, unknown>;
		const title = typeof result.title === "string" ? result.title : undefined;
		const content = typeof result.content === "string" ? result.content : undefined;
		const frontmatter = typeof result.frontmatter === "object" && result.frontmatter !== null ? result.frontmatter as Record<string, unknown> : undefined;

		if (!title || !content) {
			throw new Error("保存的数据中缺少必要的文件标题(title)或内容(content)。");
		}

		// 4. Determine save path
		const fileName = title.replace(/[\\/:*?"<>|]/g, "_"); // sanitize file name
		const destPath = normalizePath(`${this.plugin.settings.wikiDir}/${fileName}.md`);

		const fileExists = this.plugin.app.vault.getAbstractFileByPath(destPath);
		if (fileExists) {
			throw new Error(`文件 ${destPath} 已存在，无法覆盖。请在侧边栏手动改名重试。`);
		}

		// 5. Build Frontmatter and Write Markdown File
		const fm = frontmatter || {} as Record<string, unknown>;
		const aliasesRaw = fm["aliases"];
		const aliasesArr = Array.isArray(aliasesRaw) ? aliasesRaw.map(a => String(a)) : [];
		const aliasesStr = aliasesArr.length > 0 ? JSON.stringify(aliasesArr) : "[]";
		const summaryStr = typeof fm["summary"] === "string" ? fm["summary"] as string : "";

		const fullContent = `---
	aliases: ${aliasesStr}
	summary: "${summaryStr.replace(/"/g, '\\"')}"
	last_updated: ${new Date().toISOString()}
	status: active
	---

	${content}`;

		await this.plugin.app.vault.create(destPath, fullContent);

		// 6. Update Database JSON Index
		const db = await this.plugin.loadDatabase();
		const fileHash = await this.plugin.calculateHash(fullContent);
		const linksTo = this.plugin.extractLinks(fullContent);

		db.wiki_pages[destPath] = {
			path: destPath,
			title: title,
			aliases: aliasesArr || [],
			type: "general",
			summary: summaryStr,
			status: "active",
			last_updated: new Date().toISOString(),
			sha256: fileHash,
			links_to: linksTo,
			links_from: [],
			claims: [
				{
					clipping_path: "ChatInteraction",
					line_range: "all",
					paragraph_summary: summaryStr
				}
			],
			audit: {
				created_at: new Date().toISOString(),
				last_compiled_cost_usd: 0.01,
				history: [
					{
						timestamp: new Date().toISOString(),
						action: "create",
						trigger: "chat_save",
						source: "ChatInteraction"
					}
				]
			}
		};

		// Update backlinks
		for (const outgoing of linksTo) {
			const targetPage = db.wiki_pages[outgoing];
			if (targetPage && !targetPage.links_from.includes(destPath)) {
				targetPage.links_from.push(destPath);
			}
		}

		await this.plugin.saveDatabase(db);

		// 7. Update index.md
		await this.plugin.rebuildIndexMd(db);

		// 8. Log and notice
		await this.plugin.logAction("chat_save", title);
		new Notice(`🎉 知识点 [[${title}]] 已成功录入 Wiki！`);

		// Open the newly created page
		const newFile = this.plugin.app.vault.getAbstractFileByPath(destPath);
		if (newFile instanceof TFile) {
			const leaf = this.plugin.app.workspace.getLeaf(false);
		if (leaf) await leaf.openFile(newFile);
		}
	}
}
