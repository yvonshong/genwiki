import { App, Plugin, PluginSettingTab, Setting, Modal, Notice, TFile, TFolder, normalizePath, WorkspaceLeaf } from "obsidian";
import { GenWikiSettings, DEFAULT_SETTINGS, DatabaseIndex, WikiPageMetadata } from "./types";
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
			void this.activateView();
		});

		// Register commands
		this.addCommand({
			id: "ingest-clippings",
			name: "Ingest Clippings",
			callback: async () => {
				new Notice("Starting to organize clippings...");
				try {
					await this.runIngest();
				} catch (e) {
					new Notice(`Ingest failed: ${(e as Error).message}`);
					console.error(e);
				}
			}
		});

		this.addCommand({
			id: "query-wiki",
			name: "Query Wiki",
			callback: () => {
				new QueryModal(this.app, this).open();
			}
		});

		this.addCommand({
			id: "lint-wiki",
			name: "Lint Wiki (Health Check)",
			callback: async () => {
				new Notice("Starting knowledge base health audit...");
				try {
					await this.runLint();
				} catch (e) {
					new Notice(`Lint failed: ${(e as Error).message}`);
					console.error(e);
				}
			}
		});

		this.addCommand({
			id: "open-chat-view",
			name: "Open Chat Panel",
			callback: () => this.activateView()
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData() as Partial<GenWikiSettings>) || {});
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
			workspace.setActiveLeaf(leaf, { focus: true });
		}
	}

	// Helper to calculate SHA256 in a pure client environment, with mobile fallback
	async calculateHash(text: string): Promise<string> {
		if (typeof crypto !== "undefined" && crypto.subtle) {
			const msgBuffer = new TextEncoder().encode(text);
			const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
			const hashArray = Array.from(new Uint8Array(hashBuffer));
			return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
		} else {
			// Fallback for older iOS / Obsidian mobile where crypto.subtle is undefined
			let hash = 0;
			for (let i = 0; i < text.length; i++) {
				const char = text.charCodeAt(i);
				hash = ((hash << 5) - hash) + char;
				hash = hash & hash; // Convert to 32bit integer
			}
			return Math.abs(hash).toString(16).padStart(8, "0");
		}
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
			await this.app.vault.create(claudePath, `# CLAUDE.md\n\nThis protocol governs how GenWiki processes knowledge.`);
		}

		// Init log.md and index.md
		const indexPath = normalizePath(`${this.settings.wikiDir}/index.md`);
		if (!this.app.vault.getAbstractFileByPath(indexPath)) {
			await this.app.vault.create(indexPath, `# Knowledge Index\n\nThis file is an auto-generated index.`);
		}

		const logPath = normalizePath(`${this.settings.wikiDir}/log.md`);
		if (!this.app.vault.getAbstractFileByPath(logPath)) {
			await this.app.vault.create(logPath, `# Action Audit Logs\n\nRecords every knowledge organization and query action.`);
		}
	}

	async loadDatabase(): Promise<DatabaseIndex> {
		const dbPath = normalizePath(`${this.settings.wikiDir}/_database/index.json`);
		const file = this.app.vault.getAbstractFileByPath(dbPath);
		if (file instanceof TFile) {
			const text = await this.app.vault.read(file);
			try {
				const parsed = JSON.parse(text) as unknown;
				if (typeof parsed === "object" && parsed !== null && "wiki_pages" in (parsed as Record<string, unknown>)) {
					return parsed as DatabaseIndex;
				}
				console.error("Database file has unexpected shape, resetting");
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

		let content = `# Knowledge Index\n\nThis page is auto-updated by GenWiki, showing an index graph of all archived knowledge points.\n\n## Concepts\n`;
		
		const concepts = Object.values(db.wiki_pages).filter(p => p.type === "concept" && p.status !== "archived");
		const entities = Object.values(db.wiki_pages).filter(p => p.type === "entity" && p.status !== "archived");
		const generals = Object.values(db.wiki_pages).filter(p => p.type === "general" && p.status !== "archived");

		for (const p of concepts) {
			content += `* [[${p.title}]] - *${p.summary}*\n`;
		}

		content += `\n## Entities\n`;
		for (const p of entities) {
			content += `* [[${p.title}]] - *${p.summary}*\n`;
		}

		content += `\n## General Pages\n`;
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
		const mdFiles = files.filter((f): f is TFile => f instanceof TFile && f.extension === "md");

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

			new Notice(`Analyzing with AI: ${mdFile.name}...`);
			const response = await this.llmClient.complete(userPrompt, skill.systemPrompt);
			const cleanResponse = LLMClient.cleanJsonString(response);

			let resultParsed: unknown;
			try {
				resultParsed = JSON.parse(cleanResponse) as unknown;
			} catch (e) {
				console.error("Failed to parse LLM Response JSON", cleanResponse, e);
				new Notice(`Invalid JSON returned by the model. Please try again!`);
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

			if (typeof resultParsed !== "object" || resultParsed === null) {
				new Notice(`Invalid JSON format (not an object) returned by the model, please try again!`);
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

			const result = resultParsed as Record<string, unknown>;

			const destinations: string[] = [];

			// Apply operations (create or modify files)
			const operations = Array.isArray(result.operations) ? result.operations as unknown[] : [];
			for (const opRaw of operations) {
				if (typeof opRaw !== "object" || opRaw === null) continue;
				const op = opRaw as Record<string, unknown>;
				const action = typeof op.action === "string" ? op.action : "unknown";
				const opPath = typeof op.path === "string" ? op.path : undefined;
				const opContent = typeof op.content === "string" ? op.content : undefined;
				const opTitle = typeof op.title === "string" ? op.title : undefined;
				if (!opPath) continue;
				const destPath = normalizePath(opPath);
				destinations.push(destPath);
				const opFile = this.app.vault.getAbstractFileByPath(destPath);

				if (action === "create" || !opFile) {
					// Ensure directory structure
					const parts = destPath.split("/");
					if (parts.length > 1) {
						const parentDir = parts.slice(0, parts.length - 1).join("/");
						if (!this.app.vault.getAbstractFileByPath(normalizePath(parentDir))) {
							await this.app.vault.createFolder(normalizePath(parentDir));
						}
					}
					await this.app.vault.create(destPath, opContent || "");
				} else if (opFile instanceof TFile) {
					await this.app.vault.modify(opFile, opContent || "");
				}

				// Update database metadata for this page
				const fileContent = opContent || "";
				const fileHash = await this.calculateHash(fileContent);
				const linksTo = this.extractLinks(fileContent);

				// Index updates
				const indexUpdates = Array.isArray(result.index_updates) ? result.index_updates as unknown[] : [];
				const idxUpdateRaw = indexUpdates.find(iu => typeof iu === "object" && iu !== null && (iu as Record<string, unknown>).path === opPath);
				const idxUpdate = (typeof idxUpdateRaw === "object" && idxUpdateRaw !== null) ? idxUpdateRaw as Record<string, unknown> : {} as Record<string, unknown>;

				const existingPage = db.wiki_pages[destPath];
				const auditHistory = existingPage?.audit.history || [];
				auditHistory.push({
					timestamp: new Date().toISOString(),
					action: action,
					trigger: "ingest",
					source: relativePath
				});

				const idxAliasesRaw = idxUpdate["aliases"];
				const idxAliases = Array.isArray(idxAliasesRaw) ? idxAliasesRaw.map(a => String(a)) : existingPage?.aliases || [];
				const idxTypeRaw = typeof idxUpdate["type"] === "string" ? idxUpdate["type"] : existingPage?.type;
				const idxType = idxTypeRaw === "concept" || idxTypeRaw === "entity" || idxTypeRaw === "general" ? idxTypeRaw : "general";
				const idxSummary = typeof idxUpdate["summary"] === "string" ? idxUpdate["summary"] : existingPage?.summary || "Auto-generated information entry.";

				db.wiki_pages[destPath] = {
					path: destPath,
					title: opTitle || (opFile instanceof TFile ? opFile.name.replace(".md", "") : "Untitled"),
					aliases: idxAliases,
					type: idxType,
					summary: idxSummary,
					status: "active",
					last_updated: new Date().toISOString(),
					sha256: fileHash,
					links_to: linksTo,
					links_from: existingPage?.links_from || [],
					claims: [
						{
							clipping_path: relativePath,
							line_range: "all",
							paragraph_summary: idxSummary || "Summary from clippings"
						}
					],
					audit: {
						created_at: existingPage?.audit.created_at || new Date().toISOString(),
						last_compiled_cost_usd: 0.01,
						history: auditHistory
					}
				};
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
			new Notice("🎉 Clippings merged and indexed successfully!");
		} else {
			new Notice("No unprocessed clippings found!");
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
			combinedContents = "(No relevant Wiki knowledge content, please ingest clippings first)";
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
			new Notice("There are no pages in the Wiki. Please run Ingest first!");
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
		const contradictions: unknown[] = [];
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

			new Notice(`Auditing batch ${Math.floor(i / batchSize) + 1} of knowledge nodes...`);
			const response = await this.llmClient.complete(userPrompt, skill.systemPrompt);
			const cleanResponse = LLMClient.cleanJsonString(response);

			try {
				const parsed = JSON.parse(cleanResponse) as unknown;
				if (typeof parsed === "object" && parsed !== null) {
					const resObj = parsed as Record<string, unknown>;
					if (Array.isArray(resObj.contradictions)) {
						const validContradictions = resObj.contradictions.filter(item => typeof item === "object" && item !== null);
						contradictions.push(...validContradictions as unknown[]);
					}
					if (Array.isArray(resObj.orphans)) {
						const validOrphans = resObj.orphans.filter(item => typeof item === "string").map(String);
						orphans.push(...validOrphans);
					}
					if (Array.isArray(resObj.suggestions)) {
						const validSuggestions = resObj.suggestions.filter(item => typeof item === "string").map(String);
						suggestions.push(...validSuggestions);
					}
				}
			} catch (e) {
				console.error("Failed to parse Lint Response JSON", cleanResponse, e);
			}
		}

		// Post processing for orphans (check backlinks)
		const finalOrphans = orphans.filter(path => {
			const page = db.wiki_pages[path];
			return !page || !Array.isArray(page.links_from) || page.links_from.length === 0;
		});

		// Write Lint Report
		const reportPath = normalizePath(`${this.settings.wikiDir}/Lint_Report.md`);
		let reportContent = `# GenWiki Knowledge Base Health Audit Report\n\nReport generation time: ${new Date().toLocaleString()}\n\n`;

		reportContent += `## 1. Information Conflicts and Contradictions\n`;
		if (contradictions.length > 0) {
			for (const cRaw of contradictions) {
				if (typeof cRaw !== "object" || cRaw === null) continue;
				const c = cRaw as Record<string, unknown>;
				const filesRaw = c["files"];
				const filesArr = Array.isArray(filesRaw) ? filesRaw.map(f => String(f)) : [];
				const desc = typeof c["description"] === "string" ? c["description"] : "";
				reportContent += `* **Files involved**: ${filesArr.map((f: string) => `[[${f.replace(this.settings.wikiDir + "/", "").replace(".md", "")}]]`).join(", ")}\n  * **Conflict description**: ${desc}\n`;
			}
		} else {
			reportContent += `✅ No obvious logical conflicts or data contradictions detected.\n`;
		}

		reportContent += `\n## 2. Orphan Pages List\n`;
		if (finalOrphans.length > 0) {
			for (const path of finalOrphans) {
				const title = path.replace(this.settings.wikiDir + "/", "").replace(".md", "");
				reportContent += `* [[${title}]] - *No inbound references*\n`;
			}
		} else {
			reportContent += `✅ All Wiki pages have inbound links.\n`;
		}

		reportContent += `\n## 3. Association Building and Completion Suggestions\n`;
		if (suggestions.length > 0) {
			for (const s of suggestions) {
				reportContent += `* ${s}\n`;
			}
		} else {
			reportContent += `✅ The connection graph is currently complete and healthy.\n`;
		}

		const reportFile = this.app.vault.getAbstractFileByPath(reportPath);
		if (reportFile instanceof TFile) {
			await this.app.vault.modify(reportFile, reportContent);
		} else {
			await this.app.vault.create(reportPath, reportContent);
		}

		// Log and Open report
		await this.logAction("lint", "Lint Health Audit Report");
		new Notice("🎉 Knowledge health check complete! Report generated.");
		const leaf = this.app.workspace.getLeaf(false);
		const reportFileObj = this.app.vault.getAbstractFileByPath(reportPath);
		if (leaf && reportFileObj instanceof TFile) await leaf.openFile(reportFileObj);
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
		contentEl.createEl("h2", { text: "🔍 Smart Wiki QA Search" });

		const inputEl = contentEl.createEl("input", {
			type: "text",
			placeholder: "Please enter your question about the Wiki (supports fuzzy semantic search)..."
		});
			inputEl.addClass("genwiki-query-input");

			const submitBtn = contentEl.createEl("button", { text: "Submit Question" });
			const resultContainer = contentEl.createDiv({ cls: "genwiki-query-result" });

		submitBtn.addEventListener("click", () => {
			void (async () => {
				const query = inputEl.value.trim();
			if (!query) return;

			resultContainer.setText("Analyzing and searching, please wait...");
			submitBtn.disabled = true;

			try {
				const ans = await this.plugin.executeQuery(query);
				resultContainer.empty();
				// Render simple markdown response
					const preEl = resultContainer.createEl("pre", { cls: "genwiki-query-pre" });
					preEl.setText(ans);
			} catch (e) {
				resultContainer.setText(`Query Error: ${(e as Error).message}`);
				console.error(e);
			} finally {
				submitBtn.disabled = false;
			}
			})();
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
			.setDesc("Select a preset model or customize")
			.addDropdown(dropdown => {
				for (const m of presetsModel) {
					dropdown.addOption(m, m);
				}
				dropdown.addOption("customized", "Custom");
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
				.setName(`Custom ${providerName} Model ID`)
				.setDesc("Enter your custom model identifier")
				.addText(text => text
					.setPlaceholder("e.g., gpt-4-custom")
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

			new Setting(containerEl).setName("Model Configuration").setHeading();

		new Setting(containerEl)
			.setName("Default Model Provider")
			.setDesc("Select the model provider to use")
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

		new Setting(containerEl).setName("Directory Paths").setHeading();

		new Setting(containerEl)
			.setName("Clippings Directory")
			.setDesc("Path for storing web clippings")
			.addText(text => text
				.setValue(this.plugin.settings.clippingsDir)
				.onChange(async (value) => {
					this.plugin.settings.clippingsDir = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Wiki Directory")
			.setDesc("Path for structured knowledge files")
			.addText(text => text
				.setValue(this.plugin.settings.wikiDir)
				.onChange(async (value) => {
					this.plugin.settings.wikiDir = value;
					await this.plugin.saveSettings();
				}));
	}

	getSettingDefinitions(): import("obsidian").SettingDefinitionItem<string>[] {
		// Return empty array - `display()` still used for full rendering.
		return [];
	}
}
