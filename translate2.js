const fs = require('fs');
const files = ['src/chat_view.ts', 'src/main.ts', 'src/skills.ts'];

const dictionary = {
  // chat_view.ts
  '文件 ': 'File ',

  // main.ts
  '此页面由 GenWiki 自动更新，展示全部归档知识点的索引图谱。': 'This page is auto-updated by GenWiki, showing an index graph of all archived knowledge points.',
  '## 概念 (Concepts)': '## Concepts',
  '## 实体 (Entities)': '## Entities',
  '## 其他页面 (General Pages)': '## General Pages',
  '模型返回的 JSON 格式不规范（非对象），请重试！': 'Invalid JSON format (not an object) returned by the model, please try again!',
  '自动生成的信息条目。': 'Auto-generated information entry.',
  '源自剪藏的总结': 'Summary from clippings',
  '🎉 剪藏整理合并完成！索引已刷新。': '🎉 Clippings merged and indexed successfully!',
  '没有找到未处理的剪藏文件！': 'No unprocessed clippings found!',
  '（No relevantWiki知识内容，请先Ingest导入剪藏）': '(No relevant Wiki knowledge content, please ingest clippings first)',
  'Wiki中没有任何页面，请先执行 Ingest 导入！': 'There are no pages in the Wiki. Please run Ingest first!',
  '正在审计第 ': 'Auditing batch ',
  ' 组知识节点...': ' of knowledge nodes...',
  '# GenWiki 知识库健康体检审计报告': '# GenWiki Knowledge Base Health Audit Report',
  '报告生成时间: ': 'Report generation time: ',
  '## 1. 信息冲突与矛盾警告 (Contradictions)': '## 1. Information Conflicts and Contradictions',
  '* **涉及文件**: ': '* **Files involved**: ',
  '  * **矛盾描述**: ': '  * **Conflict description**: ',
  '✅ 未检测到明显的逻辑冲突或数据矛盾。': '✅ No obvious logical conflicts or data contradictions detected.',
  '## 2. 孤立节点列表 (Orphan Pages)': '## 2. Orphan Pages List',
  ' - *无其他页面引用*': ' - *No inbound references*',
  '✅ 所有 Wiki 页面均有入站链接关联。': '✅ All Wiki pages have inbound links.',
  '## 3. 关联构建与补全建议 (Suggestions)': '## 3. Association Building and Completion Suggestions',
  '✅ 目前连接图谱完整性良好。': '✅ The connection graph is currently complete and healthy.',
  '🔍 智能 Wiki 问答检索': '🔍 Smart Wiki QA Search',
  '请输入您对 Wiki 的疑问（支持模糊语义检索）...': 'Please enter your question about the Wiki (supports fuzzy semantic search)...',
  '提交问答': 'Submit Question',
  '正在分析检索，请稍候...': 'Analyzing and searching, please wait...',
  '查询Error: ': 'Query Error: ',
  '自定义 ': 'Custom ',
  ' Model ID': ' Model ID',
  '大模型设置': 'Model Settings',

  // skills.ts
  '请务必返回以下 JSON 格式数据，不要包含任何额外的 markdown 标记（如 \\`\\`\\`json 等包裹）：': 'You MUST return the following JSON formatted data. Do NOT include any extra markdown wrappers (like ```json):',
  '1. **只基于给定的页面内容回答**，如果内容中不包含答案，请直接说“知识库中No relevant records，建议导入新剪藏”。': '1. **Only answer based on the given page content**. If the content does not contain the answer, say "No relevant records in the knowledge base, please import new clippings."',
  '将对话问答内容去话语化，提炼为标准的 Wiki 页面。': 'Remove conversational tone from Q&A and refine it into a standard Wiki page.',
  '你是一名 Wiki 页面精炼专家。你的任务是读取用户的提问与对应的助手回答，将其转化为一篇格式规范、客观陈述、结构清晰的 Wiki 知识库 Markdown 页面。': 'You are a Wiki page refinement expert. Your task is to read the user\'s question and the assistant\'s answer, and convert it into a well-formatted, objective, and clearly structured Wiki knowledge base Markdown page.',
  '请遵守以下转换规则：': 'Please follow these conversion rules:',
  '1. **去话语化**：移除所有诸如“好的，为您解答如下：”、“当然可以，对比发现...”等聊天口吻或寒暄语。': '1. **Remove Conversational Tone**: Remove all chatty or greeting phrases like "Sure, here is the answer:", "Of course, a comparison reveals...".',
  '2. **规范命名与大纲**：主标题使用 # 等级，内部使用 ## 和 ### 进行语义划分。': '2. **Standardize Naming and Outline**: Use # for the main title, and ## and ### for internal semantic divisions.',
  '3. **保留并修正双链**：保留原回答中的 [[双链引用]]，并基于你的全局知识对链接名称进行标准化。': '3. **Preserve and Fix Wikilinks**: Keep the original [[wikilinks]] and standardize their names based on global knowledge.',
  '4. **生成摘要与别名**：生成适合 Obsidian Frontmatter 格式的 aliases（别名列表）和一句话 summary。': '4. **Generate Summary and Aliases**: Create aliases and a one-sentence summary suitable for Obsidian Frontmatter.',
  '## 原始回答内容': '## Original Answer Content',
  '请严格返回以下 JSON 格式数据，不要包含任何额外的 Markdown 包裹：': 'Strictly return the following JSON data. Do not include any extra Markdown wrappers:',
  '  "title": "PageTitle", // 推荐的文件标题名': '  "title": "PageTitle", // Recommended file title',
  '    "aliases": ["别名"],': '    "aliases": ["Alias"],',
  '    "summary": "一句话摘要"': '    "summary": "One-sentence summary"',
  '  "content": "# 标题\\\\n...正文内容..."': '  "content": "# Title\\\\n...Body content..."',
  '知识健康度体检，寻找冲突、陈旧信息和孤立节点。': 'Knowledge health check: look for conflicts, stale information, and orphan nodes.',
  '你是一名知识库审计员。你的任务是对比输入的 Wiki 页面群组，找出以下几类健康问题：': 'You are a knowledge base auditor. Your task is to compare the input Wiki page groups and identify the following health issues:',
  '1. **信息矛盾 (Contradiction)**：不同的页面对同一个事实、数据有不同的描述（例如，一个写指标为22，另一个写为23）。': '1. **Information Contradiction**: Different pages have conflicting descriptions for the same fact or data.',
  '2. **孤立节点 (Orphan)**：该页面没有任何入站（Inbound）双链引用，容易在日常浏览中迷失。': '2. **Orphan Node**: The page has no inbound wikilinks and can be easily lost.',
  '3. **陈旧或空白页面 (Stale)**：内容过于空洞或被标记为需要补充的空白页面。': '3. **Stale or Empty Page**: Content is too empty or marked as needing supplementation.',
  '## 待体检 Wiki 页面集': '## Wiki Page Set for Health Check',
  '请严格返回以下 JSON 格式数据，不要包含任何额外的包裹或说明：': 'Strictly return the following JSON data. Do not include any extra wrappers or explanations:'
};

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  for (const [zh, en] of Object.entries(dictionary)) {
    content = content.split(zh).join(en);
  }
  fs.writeFileSync(file, content, 'utf8');
});

console.log('Translation applied 2.');
