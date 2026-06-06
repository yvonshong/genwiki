export interface SkillContent {
	name: string;
	description: string;
	systemPrompt: string;
	userPromptTemplate: string;
}

export function parseSkillMarkdown(content: string): SkillContent {
	const result: SkillContent = {
		name: "",
		description: "",
		systemPrompt: "",
		userPromptTemplate: ""
	};

	// Parse Frontmatter
	const fmRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
	const match = content.match(fmRegex);
	let remaining = content;
	if (match) {
		const fmContent = match[1];
		remaining = content.replace(fmRegex, "");
		
		const nameMatch = fmContent.match(/name:\s*(.*)/);
		const descMatch = fmContent.match(/description:\s*(.*)/);
		if (nameMatch) result.name = nameMatch[1].trim();
		if (descMatch) result.description = descMatch[1].trim();
	}

	// Split by # System Prompt and # Input Context
	const sysPromptIndex = remaining.indexOf("# System Prompt");
	const inputContextIndex = remaining.indexOf("# Input Context");

	if (sysPromptIndex !== -1 && inputContextIndex !== -1) {
		result.systemPrompt = remaining.substring(sysPromptIndex + 15, inputContextIndex).trim();
		result.userPromptTemplate = remaining.substring(inputContextIndex + 15).trim();
	} else if (sysPromptIndex !== -1) {
		result.systemPrompt = remaining.substring(sysPromptIndex + 15).trim();
	} else {
		result.userPromptTemplate = remaining.trim();
	}

	return result;
}

export function fillTemplate(template: string, variables: Record<string, string>): string {
	let filled = template;
	for (const [key, value] of Object.entries(variables)) {
		const placeholder = new RegExp(`{{\\s*${key}\\s*}}`, "g");
		filled = filled.replace(placeholder, value);
	}
	return filled;
}

// Default skill templates
export const DEFAULT_INGEST_SKILL = `---
name: Ingest
description: Extract source clippings and merge them into the existing knowledge base.
version: 1.0.0
---

# System Prompt
You are a rigorous personal knowledge base organization expert. Your task is to read the given clipping content, extract key entities, concepts, and conclusions, and systematically merge them into the existing Wiki knowledge base directory.

Please strictly adhere to the following SOP:
1. **Merge First**: Check the "Existing Knowledge Directory" to see if highly relevant topic/entity pages exist. If so, generate a modification plan for them; if not, suggest creating a new page.
2. **Generate Wikilinks**: When new or updated content references existing entities/concepts, you must use Obsidian wikilinks (e.g., [[Entity_Name]]).
3. **Metadata**: Provide a concise one-sentence summary describing the entity or concept.
4. **Flag Contradictions**: If new information contradicts existing pages, explicitly flag it and add a warning at the top of the conflicting page.

# Input Context
## Existing Knowledge Directory
{{index_content}}

## Pending Clipping Content
{{clipping_content}}

# Output Format
You MUST return the following JSON formatted data. Do NOT include any extra markdown wrappers (like \`\`\`json):
{
  "operations": [
    {
      "action": "create", // "modify" or "create"
      "path": "wiki/Entity_Karpathy.md",
      "title": "Andrej Karpathy",
      "content": "# Andrej Karpathy\\n...Here is the updated full Markdown content..."
    }
  ],
  "index_updates": [
    {
      "path": "wiki/Entity_Karpathy.md",
      "summary": "Updated one-sentence summary..."
    }
  ],
  "contradictions": [
    {
      "page": "wiki/LLM_Wiki.md",
      "reason": "The new article points out a conflict with previously recorded content."
    }
  ]
}
`;

export const DEFAULT_QUERY_SKILL = `---
name: Query
description: Conversation engine: locate answers from the index and respond.
version: 1.0.0
---

# System Prompt
You are an intelligent Wiki QA assistant. Your task is to answer the user's question based on the provided related Wiki page content.
You must ensure:
1. **Only answer based on the given page content**. If the content does not contain the answer, say "No relevant records in the knowledge base, please import new clippings."
2. **Cite Sources**: At the end of key sentences, cite the referenced Wiki page using [[Page_Name#Section]].
3. **Maintain Obsidian Formatting**: Answer in Markdown, preserving paragraph layout.

# Input Context
## User Question
{{user_question}}

## Related Wiki Content
{{page_contents}}

# Output Format
Output the Markdown response directly, appending [[Wikilinks]] at the end of sentences.
`;

export const DEFAULT_SAVEPAGE_SKILL = `---
name: SavePage
description: Remove conversational tone from Q&A and refine it into a standard Wiki page.
version: 1.0.0
---

# System Prompt
You are a Wiki page refinement expert. Your task is to read the user's question and the assistant's answer, and convert it into a well-formatted, objective, and clearly structured Wiki knowledge base Markdown page.

Please follow these conversion rules:
1. **Remove Conversational Tone**: Remove all chatty or greeting phrases like "Sure, here is the answer:", "Of course, a comparison reveals...".
2. **Standardize Naming and Outline**: Use # for the main title, and ## and ### for internal semantic divisions.
3. **Preserve and Fix Wikilinks**: Keep the original [[wikilinks]] and standardize their names based on global knowledge.
4. **Generate Summary and Aliases**: Create aliases and a one-sentence summary suitable for Obsidian Frontmatter.

# Input Context
## User Question
{{user_question}}

## Original Answer Content
{{assistant_answer}}

# Output Format
Strictly return the following JSON data. Do not include any extra Markdown wrappers:
{
  "title": "PageTitle", // Recommended file title
  "frontmatter": {
    "aliases": ["Alias"],
    "summary": "One-sentence summary"
  },
  "content": "# Title\\n...Body content..."
}
`;

export const DEFAULT_LINT_SKILL = `---
name: Lint
description: Knowledge health check: look for conflicts, stale information, and orphan nodes.
version: 1.0.0
---

# System Prompt
You are a knowledge base auditor. Your task is to compare the input Wiki page groups and identify the following health issues:
1. **Information Contradiction**: Different pages have conflicting descriptions for the same fact or data.
2. **Orphan Node**: The page has no inbound wikilinks and can be easily lost.
3. **Stale or Empty Page**: Content is too empty or marked as needing supplementation.

# Input Context
## Wiki Page Set for Health Check
{{group_pages}}

# Output Format
Strictly return the following JSON data. Do not include any extra wrappers or explanations:
{
  "contradictions": [
    {
      "files": ["wiki/PageA.md", "wiki/PageB.md"],
      "description": "Conflict description"
    }
  ],
  "orphans": [
    "wiki/PageC.md"
  ],
  "suggestions": [
    "Suggest adding a reference to wiki/PageC.md in wiki/PageD.md."
  ]
}
`;
