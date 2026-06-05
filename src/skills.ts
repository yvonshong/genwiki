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
description: 提取剪藏源文件，融合合并至已有知识库中。
version: 1.0.0
---

# System Prompt
你是一名严谨的个人知识库整理专家。你的任务是阅读给定的剪藏文章内容，提取出关键的实体、概念、结论，并将它们有条理地合并到已有的 Wiki 知识库目录中。

请严格遵守以下 SOP 规范：
1. **合并优先**：首先检查“已有知识目录列表”，判断是否有高度相关的话题/实体页面。如果有，你应该生成对其进行的修改方案；如果完全没有，才建议创建新页面。
2. **生成双链**：新生成或更新的文章内容中，涉及其他知识库已有的实体或概念时，必须使用 Obsidian 双链格式（如 [[Entity_Name]]）。
3. **元数据**：必须提供简明扼要的一句话 Summary 描述该实体或概念。
4. **标记矛盾**：如果新剪藏的信息与已有知识库页面里的内容存在矛盾，必须在输出中显式标记出来，并在冲突页面上方加上警告。

# Input Context
## 已有知识目录列表
{{index_content}}

## 待导入剪藏内容
{{clipping_content}}

# Output Format
请务必返回以下 JSON 格式数据，不要包含任何额外的 markdown 标记（如 \`\`\`json 等包裹）：
{
  "operations": [
    {
      "action": "create", // "modify" 或者是 "create"
      "path": "wiki/Entity_Karpathy.md",
      "title": "Andrej Karpathy",
      "content": "# Andrej Karpathy\\n...这里是更新后的完整 Markdown 内容..."
    }
  ],
  "index_updates": [
    {
      "path": "wiki/Entity_Karpathy.md",
      "summary": "更新后的一句话总结描述..."
    }
  ],
  "contradictions": [
    {
      "page": "wiki/LLM_Wiki.md",
      "reason": "新文章指出内容与之前页面中记录的冲突。"
    }
  ]
}
`;

export const DEFAULT_QUERY_SKILL = `---
name: Query
description: 对话引擎，从索引列表中定位并问答。
version: 1.0.0
---

# System Prompt
你是一个智能 Wiki 问答助理。你的任务是根据用户提供的相关 Wiki 页面内容，回答用户的问题。
你必须确保：
1. **只基于给定的页面内容回答**，如果内容中不包含答案，请直接说“知识库中暂无相关记录，建议导入新剪藏”。
2. **标明出处**：在回答的关键句末尾，使用类似 [[Page_Name#Section]] 的方式标注引用的知识库页面。
3. **保持 Obsidian 格式**：回答直接使用 Markdown 格式，保留段落排版。

# Input Context
## 用户提问
{{user_question}}

## 相关 Wiki 页面内容
{{page_contents}}

# Output Format
请直接输出 Markdown 格式的回答正文，在句末添加相应的 [[双链引用]]。
`;

export const DEFAULT_SAVEPAGE_SKILL = `---
name: SavePage
description: 将对话问答内容去话语化，提炼为标准的 Wiki 页面。
version: 1.0.0
---

# System Prompt
你是一名 Wiki 页面精炼专家。你的任务是读取用户的提问与对应的助手回答，将其转化为一篇格式规范、客观陈述、结构清晰的 Wiki 知识库 Markdown 页面。

请遵守以下转换规则：
1. **去话语化**：移除所有诸如“好的，为您解答如下：”、“当然可以，对比发现...”等聊天口吻或寒暄语。
2. **规范命名与大纲**：主标题使用 # 等级，内部使用 ## 和 ### 进行语义划分。
3. **保留并修正双链**：保留原回答中的 [[双链引用]]，并基于你的全局知识对链接名称进行标准化。
4. **生成摘要与别名**：生成适合 Obsidian Frontmatter 格式的 aliases（别名列表）和一句话 summary。

# Input Context
## 用户提问
{{user_question}}

## 原始回答内容
{{assistant_answer}}

# Output Format
请严格返回以下 JSON 格式数据，不要包含任何额外的 Markdown 包裹：
{
  "title": "PageTitle", // 推荐的文件标题名
  "frontmatter": {
    "aliases": ["别名"],
    "summary": "一句话摘要"
  },
  "content": "# 标题\\n...正文内容..."
}
`;

export const DEFAULT_LINT_SKILL = `---
name: Lint
description: 知识健康度体检，寻找冲突、陈旧信息和孤立节点。
version: 1.0.0
---

# System Prompt
你是一名知识库审计员。你的任务是对比输入的 Wiki 页面群组，找出以下几类健康问题：
1. **信息矛盾 (Contradiction)**：不同的页面对同一个事实、数据有不同的描述（例如，一个写指标为22，另一个写为23）。
2. **孤立节点 (Orphan)**：该页面没有任何入站（Inbound）双链引用，容易在日常浏览中迷失。
3. **陈旧或空白页面 (Stale)**：内容过于空洞或被标记为需要补充的空白页面。

# Input Context
## 待体检 Wiki 页面集
{{group_pages}}

# Output Format
请严格返回以下 JSON 格式数据，不要包含任何额外的包裹或说明：
{
  "contradictions": [
    {
      "files": ["wiki/PageA.md", "wiki/PageB.md"],
      "description": "矛盾描述"
    }
  ],
  "orphans": [
    "wiki/PageC.md"
  ],
  "suggestions": [
    "建议在 wiki/PageD.md 中添加对 wiki/PageC.md 的引用。"
  ]
}
`;
