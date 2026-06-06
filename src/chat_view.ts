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
		return "GenWiki Chat";
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
		headerRow.createEl("h3", { text: "💬 GenWiki Chat" });
		
		const startIngestBtn = headerRow.createEl("button", {
			cls: "genwiki-top-ingest-btn mod-cta",
			text: "📥 Process Clippings"
		});
		startIngestBtn.addEventListener("click", () => {
			void (async () => {
				startIngestBtn.disabled = true;
				startIngestBtn.setText("Processing...");
				new Notice("Scanning and organizing clippings...");
				try {
					// Access plugin directly to run ingest
					await this.plugin.runIngest();
					new Notice("🎉 Clippings processed successfully!");
				} catch (e) {
					new Notice(`Ingest failed: ${(e as Error).message}`);
					console.error(e);
				} finally {
					startIngestBtn.disabled = false;
					startIngestBtn.setText("📥 Process Clippings");
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
		this.appendMessage("assistant", "Hello! I am your GenWiki assistant. I can answer questions based on concepts and entities in your current Wiki knowledge base. Insights generated from our Q&A can be saved as formal knowledge pages with one click.");

		// Input Section
		const inputContainer = container.createDiv({ cls: "genwiki-chat-input-container" });
		
		this.inputArea = inputContainer.createEl("textarea", {
			cls: "genwiki-chat-input",
			placeholder: "Ask Wiki..."
		});

		this.sendButton = inputContainer.createEl("button", { text: "Send" });

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
		const assistantMsgDiv = this.appendMessage("assistant", "Thinking and searching...");
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
				text: "📋 Copy"
			});
			copyBtn.addEventListener("click", () => {
				void navigator.clipboard.writeText(answer);
				new Notice("Copied to clipboard!");
			});

			const isNoRecord = answer.includes("No relevant records") || answer.includes("No relevant") || answer.includes("No relevantWiki");
			if (!isNoRecord) {
				// Append "Save to Wiki" button for this response
				const saveBtn = actionsDiv.createEl("button", {
					cls: "genwiki-save-btn mod-cta",
					text: "💾 Save as Wiki Page"
				});

				saveBtn.addEventListener("click", () => {
					void (async () => {
						saveBtn.disabled = true;
						saveBtn.setText("Summarizing...");
						try {
							await this.saveResponseToWiki(query, answer);
							saveBtn.setText("✅ Saved successfully");
						} catch (err) {
							new Notice(`Save failed: ${(err as Error).message}`);
							saveBtn.disabled = false;
							saveBtn.setText("💾 Save as Wiki Page");
						}
					})();
				});
			}

		} catch (err) {
			assistantMsgDiv.setText(`Error: ${(err as Error).message}`);
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
		new Notice("Formatting and formalizing...");
		const response = await this.plugin.llmClient.complete(userPrompt, skill.systemPrompt);
		const cleanResponse = LLMClient.cleanJsonString(response);

		const parsed = (() => {
			try {
				return JSON.parse(cleanResponse) as unknown;
			} catch (e) {
				console.error("Failed to parse SavePage response JSON", cleanResponse, e);
				throw new Error("Invalid JSON format generated by the model. Please try again.");
			}
		})();

		if (typeof parsed !== "object" || parsed === null) {
			throw new Error("The JSON generated by the model is not an object and cannot be saved.");
		}

		const result = parsed as Record<string, unknown>;
		const title = typeof result.title === "string" ? result.title : undefined;
		const content = typeof result.content === "string" ? result.content : undefined;
		const frontmatter = typeof result.frontmatter === "object" && result.frontmatter !== null ? result.frontmatter as Record<string, unknown> : undefined;

		if (!title || !content) {
			throw new Error("The saved data is missing the required title or content.");
		}

		// 4. Determine save path
		const fileName = title.replace(/[\\/:*?"<>|]/g, "_"); // sanitize file name
		const destPath = normalizePath(`${this.plugin.settings.wikiDir}/${fileName}.md`);

		const fileExists = this.plugin.app.vault.getAbstractFileByPath(destPath);
		if (fileExists) {
			throw new Error(`File ${destPath}  already exists and cannot be overwritten. Please rename it manually in the sidebar and try again.`);
		}

		// 5. Build Frontmatter and Write Markdown File
		const fm = frontmatter || {};
		const aliasesRaw = fm["aliases"];
		const aliasesArr = Array.isArray(aliasesRaw) ? aliasesRaw.map(a => String(a)) : [];
		const aliasesStr = aliasesArr.length > 0 ? JSON.stringify(aliasesArr) : "[]";
		const summaryStr = typeof fm["summary"] === "string" ? fm["summary"] : "";

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
		new Notice(`🎉 Knowledge node [[${title}]] has been successfully added to the Wiki!`);

		// Open the newly created page
		const newFile = this.plugin.app.vault.getAbstractFileByPath(destPath);
		if (newFile instanceof TFile) {
			const leaf = this.plugin.app.workspace.getLeaf(false);
		if (leaf) await leaf.openFile(newFile);
		}
	}
}
