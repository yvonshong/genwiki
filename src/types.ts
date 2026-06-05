export interface GenWikiSettings {
	provider: string;
	geminiApiKey: string;
	geminiModel: string;
	geminiBaseUrl: string;
	anthropicApiKey: string;
	anthropicModel: string;
	anthropicBaseUrl: string;
	openaiApiKey: string;
	openaiModel: string;
	openaiBaseUrl: string;
	deepseekApiKey: string;
	deepseekModel: string;
	deepseekBaseUrl: string;
	kimiApiKey: string;
	kimiModel: string;
	kimiBaseUrl: string;
	openrouterApiKey: string;
	openrouterModel: string;
	openrouterBaseUrl: string;
	clippingsDir: string;
	wikiDir: string;
}

export const DEFAULT_SETTINGS: GenWikiSettings = {
	provider: "gemini",
	geminiApiKey: "",
	geminiModel: "gemini-3.5-flash",
	geminiBaseUrl: "https://generativelanguage.googleapis.com",
	anthropicApiKey: "",
	anthropicModel: "claude-sonnet-4-6",
	anthropicBaseUrl: "https://api.anthropic.com",
	openaiApiKey: "",
	openaiModel: "gpt-5.4-mini",
	openaiBaseUrl: "https://api.openai.com/v1",
	deepseekApiKey: "",
	deepseekModel: "deepseek-v4-flash",
	deepseekBaseUrl: "https://api.deepseek.com",
	kimiApiKey: "",
	kimiModel: "kimi-k2.6",
	kimiBaseUrl: "https://api.moonshot.cn/v1",
	openrouterApiKey: "",
	openrouterModel: "google/gemini-3.5-flash",
	openrouterBaseUrl: "https://openrouter.ai/api/v1",
	clippingsDir: "Clippings",
	wikiDir: "wiki",
};

export interface ClippingMetadata {
	path: string;
	sha256: string;
	ingest_date: string;
	status: "unprocessed" | "processed" | "failed";
	destinations: string[];
}

export interface Claim {
	clipping_path: string;
	line_range: string;
	paragraph_summary: string;
}

export interface AuditHistory {
	timestamp: string;
	action: string;
	trigger: string;
	source: string;
}

export interface WikiPageMetadata {
	path: string;
	title: string;
	aliases: string[];
	type: "concept" | "entity" | "general";
	summary: string;
	status: "draft" | "active" | "stale" | "contradicted" | "archived";
	last_updated: string;
	sha256: string;
	links_to: string[];
	links_from: string[];
	claims: Claim[];
	audit: {
		created_at: string;
		last_compiled_cost_usd: number;
		history: AuditHistory[];
	};
}

export interface DatabaseIndex {
	version: string;
	last_indexed: string;
	clippings: Record<string, ClippingMetadata>;
	wiki_pages: Record<string, WikiPageMetadata>;
}
