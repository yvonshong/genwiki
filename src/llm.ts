import { requestUrl, RequestUrlParam } from "obsidian";
import { GenWikiSettings } from "./types";

export class LLMClient {
	private settings: GenWikiSettings;

	private extractString(obj: unknown, path: Array<string | number>): string | undefined {
		let cur: unknown = obj;
		for (const key of path) {
			if (cur === null || cur === undefined) return undefined;
			if (typeof key === "number") {
				if (Array.isArray(cur)) cur = cur[key]; else return undefined;
			} else {
				if (typeof cur === "object") {
					const asObj = cur as Record<string, unknown>;
					cur = asObj[key];
				} else return undefined;
			}
		}
		return typeof cur === "string" ? cur : undefined;
	}

	constructor(settings: GenWikiSettings) {
		this.settings = settings;
	}

	async complete(prompt: string, systemPrompt?: string): Promise<string> {
		const provider = this.settings.provider;
		switch (provider) {
			case "gemini":
				return this.completeGemini(prompt, systemPrompt);
			case "anthropic":
				return this.completeAnthropic(prompt, systemPrompt);
			case "openai":
				return this.completeOpenAI(prompt, systemPrompt);
			case "deepseek":
				return this.completeDeepSeek(prompt, systemPrompt);
			case "kimi":
				return this.completeKimi(prompt, systemPrompt);
			case "openrouter":
				return this.completeOpenRouter(prompt, systemPrompt);
			default:
				throw new Error(`Unsupported LLM provider: ${provider}`);
		}
	}

	async embed(text: string): Promise<number[]> {
		const provider = this.settings.provider;
		if (provider === "gemini") {
			return this.embedGemini(text);
		} else if (provider === "openai") {
			return this.embedOpenAI(text);
		} else {
			throw new Error(`Embedding is currently only supported for 'gemini' and 'openai' providers. Your provider is ${provider}. Please switch to Gemini/OpenAI or continue using keyword search.`);
		}
	}

	private cleanUrl(baseUrl: string, path: string): string {
		const cleanBase = baseUrl.trim().replace(/\/+$/, "");
		const cleanPath = path.trim().replace(/^\/+/, "");
		return `${cleanBase}/${cleanPath}`;
	}

	private async completeGemini(prompt: string, systemPrompt?: string): Promise<string> {
		const key = this.settings.geminiApiKey;
		const model = this.settings.geminiModel;
		if (!key) throw new Error("Gemini API key is not configured.");

		const baseUrl = this.settings.geminiBaseUrl || "https://generativelanguage.googleapis.com";
		if (baseUrl.includes("/openai")) {
			return this.completeChatCompletions(
				this.cleanUrl(baseUrl, "chat/completions"),
				key,
				model,
				prompt,
				systemPrompt
			);
		}

		const url = `${baseUrl.replace(/\/+$/, "")}/v1beta/models/${model}:generateContent?key=${key}`;
		
		const body: Record<string, unknown> = {
			contents: [{ parts: [{ text: prompt }] }]
		};

		if (systemPrompt) {
			body.systemInstruction = {
				parts: [{ text: systemPrompt }]
			};
		}

		const params: RequestUrlParam = {
			url: url,
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			body: JSON.stringify(body)
		};

		const response = await requestUrl(params);
		if (response.status !== 200) {
			throw new Error(`Gemini API Error (${response.status}): ${response.text}`);
		}

		const json = response.json as unknown;
		const text = this.extractString(json, ["candidates", 0, "content", "parts", 0, "text"]);
		if (!text) {
			throw new Error("Empty response received from Gemini API.");
		}
		return text;
	}

	private async completeAnthropic(prompt: string, systemPrompt?: string): Promise<string> {
		const key = this.settings.anthropicApiKey;
		const model = this.settings.anthropicModel;
		if (!key) throw new Error("Anthropic API key is not configured.");

		const baseUrl = this.settings.anthropicBaseUrl || "https://api.anthropic.com";
		const url = this.cleanUrl(baseUrl, "v1/messages");
		const body: Record<string, unknown> = {
			model: model,
			max_tokens: 4096,
			messages: [{ role: "user", content: prompt }]
		};

		if (systemPrompt) {
			body.system = systemPrompt;
		}

		const params: RequestUrlParam = {
			url: url,
			method: "POST",
			headers: {
				"x-api-key": key,
				"anthropic-version": "2023-06-01",
				"Content-Type": "application/json"
			},
			body: JSON.stringify(body)
		};

		const response = await requestUrl(params);
		if (response.status !== 200) {
			throw new Error(`Anthropic API Error (${response.status}): ${response.text}`);
		}

		const json = response.json as unknown;
		const text = this.extractString(json, ["content", 0, "text"]);
		if (!text) {
			throw new Error("Empty response received from Anthropic API.");
		}
		return text;
	}

	private async completeOpenAI(prompt: string, systemPrompt?: string): Promise<string> {
		const key = this.settings.openaiApiKey;
		const model = this.settings.openaiModel;
		if (!key) throw new Error("OpenAI API key is not configured.");

		const baseUrl = this.settings.openaiBaseUrl || "https://api.openai.com/v1";
		return this.completeChatCompletions(
			this.cleanUrl(baseUrl, "chat/completions"),
			key,
			model,
			prompt,
			systemPrompt
		);
	}

	private async embedGemini(text: string): Promise<number[]> {
		const key = this.settings.geminiApiKey;
		if (!key) throw new Error("Gemini API key is not configured.");

		const baseUrl = this.settings.geminiBaseUrl || "https://generativelanguage.googleapis.com";
		const url = `${baseUrl.replace(/\/+$/, "")}/v1beta/models/text-embedding-004:embedContent?key=${key}`;
		
		const body: Record<string, unknown> = {
			model: "models/text-embedding-004",
			content: { parts: [{ text: text }] }
		};

		const params: RequestUrlParam = {
			url: url,
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			body: JSON.stringify(body)
		};

		const response = await requestUrl(params);
		if (response.status !== 200) {
			throw new Error(`Gemini Embedding Error (${response.status}): ${response.text}`);
		}

		// Explicit cast to any for nested property access safely
		const json = response.json as any;
		const values = json?.embedding?.values;
		if (!Array.isArray(values)) {
			throw new Error("Invalid embedding response from Gemini API.");
		}
		return values as number[];
	}

	private async embedOpenAI(text: string): Promise<number[]> {
		const key = this.settings.openaiApiKey;
		if (!key) throw new Error("OpenAI API key is not configured.");

		const baseUrl = this.settings.openaiBaseUrl || "https://api.openai.com/v1";
		const url = this.cleanUrl(baseUrl, "embeddings");
		
		const body: Record<string, unknown> = {
			model: "text-embedding-3-small",
			input: text
		};

		const params: RequestUrlParam = {
			url: url,
			method: "POST",
			headers: {
				"Authorization": `Bearer ${key}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify(body)
		};

		const response = await requestUrl(params);
		if (response.status !== 200) {
			throw new Error(`OpenAI Embedding Error (${response.status}): ${response.text}`);
		}

		const json = response.json as any;
		const values = json?.data?.[0]?.embedding;
		if (!Array.isArray(values)) {
			throw new Error("Invalid embedding response from OpenAI API.");
		}
		return values as number[];
	}

	private async completeDeepSeek(prompt: string, systemPrompt?: string): Promise<string> {
		const key = this.settings.deepseekApiKey;
		const model = this.settings.deepseekModel;
		if (!key) throw new Error("DeepSeek API key is not configured.");

		const baseUrl = this.settings.deepseekBaseUrl || "https://api.deepseek.com";

		// DeepSeek Anthropic-compatible mode support
		if (baseUrl.trim().replace(/\/+$/, "").endsWith("/anthropic")) {
			const url = this.cleanUrl(baseUrl, "v1/messages");
			const body: Record<string, unknown> = {
				model: model,
				max_tokens: 4096,
				messages: [{ role: "user", content: prompt }]
			};
			if (systemPrompt) {
				body.system = systemPrompt;
			}
			const params: RequestUrlParam = {
				url: url,
				method: "POST",
				headers: {
					"x-api-key": key,
					"Content-Type": "application/json"
				},
				body: JSON.stringify(body)
			};
			const response = await requestUrl(params);
			if (response.status !== 200) {
				throw new Error(`DeepSeek Anthropic-compatible Error (${response.status}): ${response.text}`);
			}
			const json = response.json as unknown;
			const text = this.extractString(json, ["content", 0, "text"]);
			if (!text) {
				throw new Error("Empty response received from DeepSeek Anthropic-compatible API.");
			}
			return text;
		}

		return this.completeChatCompletions(
			this.cleanUrl(baseUrl, "chat/completions"),
			key,
			model,
			prompt,
			systemPrompt
		);
	}

	private async completeKimi(prompt: string, systemPrompt?: string): Promise<string> {
		const key = this.settings.kimiApiKey;
		const model = this.settings.kimiModel;
		if (!key) throw new Error("Kimi API key is not configured.");

		const baseUrl = this.settings.kimiBaseUrl || "https://api.moonshot.cn/v1";
		return this.completeChatCompletions(
			this.cleanUrl(baseUrl, "chat/completions"),
			key,
			model,
			prompt,
			systemPrompt
		);
	}

	private async completeOpenRouter(prompt: string, systemPrompt?: string): Promise<string> {
		const key = this.settings.openrouterApiKey;
		const model = this.settings.openrouterModel;
		if (!key) throw new Error("OpenRouter API key is not configured.");

		const baseUrl = this.settings.openrouterBaseUrl || "https://openrouter.ai/api/v1";
		return this.completeChatCompletions(
			this.cleanUrl(baseUrl, "chat/completions"),
			key,
			model,
			prompt,
			systemPrompt
		);
	}

	private async completeChatCompletions(
		url: string,
		key: string,
		model: string,
		prompt: string,
		systemPrompt?: string
	): Promise<string> {
		const messages: { role: string; content: string }[] = [];
		if (systemPrompt) {
			messages.push({ role: "system", content: systemPrompt });
		}
		messages.push({ role: "user", content: prompt });

		const params: RequestUrlParam = {
			url: url,
			method: "POST",
			headers: {
				"Authorization": `Bearer ${key}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				model: model,
				messages: messages
			})
		};

		const response = await requestUrl(params);
		if (response.status !== 200) {
			throw new Error(`API Error (${response.status}): ${response.text}`);
		}

		const json = response.json as unknown;
		const text = this.extractString(json, ["choices", 0, "message", "content"]);
		if (!text) {
			throw new Error("Empty response received from Chat Completion API.");
		}
		return text;
	}

	// Helper to extract JSON from LLM output block
	static cleanJsonString(input: string): string {
		let clean = input.trim();
		if (clean.startsWith("```json")) {
			clean = clean.substring(7);
		} else if (clean.startsWith("```")) {
			clean = clean.substring(3);
		}
		if (clean.endsWith("```")) {
			clean = clean.substring(0, clean.length - 3);
		}
		return clean.trim();
	}
}
