/**
 * ASL Obsidian 输出模块
 * 将 StandardSession 渲染为 Markdown 文件
 */

import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync, rmSync } from 'fs';
import { join, dirname, basename } from 'path';

/**
 * 单篇笔记的体积上限
 * Obsidian 索引线程在大 Markdown 文件上会崩掉（实测崩溃线约 5MB），留出余量
 */
const MAX_NOTE_BYTES = 4 * 1024 * 1024;

/** 单个渲染单元的预算（留给 frontmatter、标题与分片导航） */
const UNIT_BYTES = MAX_NOTE_BYTES - 8 * 1024;

/**
 * 生成 Obsidian 目录路径
 */
export function getObsidianPath(vaultPath, session, part = 1) {
  const date = new Date(session.createdAt);
  const yearMonth = date.toISOString().substring(0, 7); // YYYY-MM
  
  // Extract path hash from session.id (format: claude_{sessionId}_{pathHash})
  const pathHash = session.id.includes('_') ? session.id.split('_').pop() : session.sourceId.substring(0, 8);
  const suffix = part > 1 ? `-p${part}` : '';
  const fileName = `${date.toISOString().substring(0, 10).replace(/-/g, '')}_${pathHash}${suffix}.md`;
  
  return join(vaultPath, 'AISessionLog', session.project, session.source, yearMonth, fileName);
}

/**
 * 生成 Frontmatter
 */
function generateFrontmatter(session, part) {
  const tags = [
    'ai-session',
    session.source.replace('_', '-'),
    session.project.replace(/[^a-zA-Z0-9]/g, '-')
  ];

  return `---
id: "${session.id}"
source: "${session.source}"
source_id: "${session.sourceId}"
project: "${session.project}"
project_path: "${session.projectPath}"
model: "${session.model || 'unknown'}"
created_at: ${session.createdAt?.toISOString() || 'unknown'}
updated_at: ${session.updatedAt?.toISOString() || 'unknown'}
ingested_at: ${new Date().toISOString()}
message_count: ${session.messages.length}
has_code: ${session.messages.some(m => m.contentBlocks?.some(b => b.type === 'code'))}
has_tool_calls: ${session.messages.some(m => m.contentBlocks?.some(b => b.type === 'tool_use' || b.type === 'tool_result'))}
status: "${session.status}"
tags: [${tags.map(t => `"${t}"`).join(', ')}]
source_missing: false
${part && part.total > 1 ? `part: ${part.index}\nparts: ${part.total}\n` : ''}---
`;
}

/**
 * 生成消息标题
 */
function generateHeader(session, part) {
  const modelInfo = session.model ? ` · ${session.model}` : '';
  const messageCount = session.messages.length;
  
  const partLabel = part && part.total > 1 ? ` (${part.index}/${part.total})` : '';
  const nav = part && part.total > 1 ? generateNav(part) : '';

  return `# ${session.project} · ${new Date(session.createdAt).toLocaleDateString('zh-CN')}${partLabel}

> ${session.source.replace('_', ' ')}${modelInfo} · ${messageCount} 条消息

${nav}---
`;
}

/**
 * 生成分片导航（上下篇链接）
 */
function generateNav(part) {
  const links = [];
  if (part.prev) links.push(`[[${part.prev}|← 上一篇]]`);
  links.push(`**${part.index} / ${part.total}**`);
  if (part.next) links.push(`[[${part.next}|下一篇 →]]`);

  return `${links.join(' · ')}

`;
}

/**
 * 渲染单个消息
 */
function renderMessage(message, index) {
  const timestamp = message.timestamp ? new Date(message.timestamp).toLocaleTimeString('zh-CN') : '';
  const role = message.role === 'user' ? '**User**' : '**Assistant**';
  
  let content = '';
  
  // 添加结构化内容块（优先使用）
  if (message.contentBlocks && message.contentBlocks.length > 0) {
    for (const block of message.contentBlocks) {
      if (block.type === 'code' && block.content) {
        const lang = block.language || '';
        content += `\n\`\`\`${lang}\n${block.content}\n\`\`\`\n`;
      } else if (block.type === 'tool_use') {
        const toolName = block.toolName || 'unknown';
        const toolUseId = block.toolUseId || '';
        content += `\n<details>\n<summary>🔧 工具调用：${toolName}${toolUseId ? ` · ${toolUseId}` : ''}</summary>\n\n`;
        if (block.content) {
          content += `\`\`\`json\n${block.content}\n\`\`\`\n`;
        }
        content += `\n</details>\n`;
      } else if (block.type === 'tool_result') {
        const preview = block.content.length > 500 
          ? block.content.substring(0, 500) + '...'
          : block.content;
        content += `\n<details>\n<summary>📤 工具返回${block.content.length > 500 ? ' (前 500 字符)' : ''}</summary>\n\n`;
        content += `\`\`\`\n${preview}\n\`\`\`\n`;
        content += `\n</details>\n`;
      } else if (block.type === 'image' && block.content) {
        content += `\n> 图片：${block.content}\n`;
      } else if (block.type === 'text' && block.content) {
        // 普通文本块
        content += `${block.content}\n`;
      }
    }
  } else if (message.renderedText) {
    // 降级使用 renderedText
    content += `${message.renderedText}\n`;
  }
  
  return `${role}${timestamp ? ` \`${timestamp}\`` : ''}\n\n${content}\n---\n`;
}

/**
 * 生成完整 Markdown 内容
 */
export function generateMarkdown(session, part) {
  let content = '';
  const body = part?.body !== undefined
    ? part.body
    : session.messages.map((message, i) => renderMessage(message, i)).join('');
  
  // Frontmatter
  content += generateFrontmatter(session, part);
  content += '\n';
  
  // Header
  content += generateHeader(session, part);
  
  // Messages
  content += body;
  
  // Footer
  content += `\n*AISessionLog v0.1 · 原始 ID: ${session.sourceId} · [查看原始文件](file://${session.sourcePath})*\n`;
  
  // 水位线注释（用于增量更新），只写在最后一篇
  const lastMessageId = session.messages[session.messages.length - 1]?.id || 'none';
  content += `\n<!-- aisessionlog:last_message_id:${lastMessageId} -->\n`;
  
  return content;
}

/**
 * 写入文件（支持增量更新）
 */
export function writeToFile(filePath, content, session) {
  // 确保目录存在
  mkdirSync(dirname(filePath), { recursive: true });
  
  // 检查文件是否已存在
  if (existsSync(filePath)) {
    const existingContent = readFileSync(filePath, 'utf-8');
    
    // 查找水位线
    const watermarkMatch = existingContent.match(/<!-- aisessionlog:last_message_id:([a-zA-Z0-9-]+) -->/);
    
    if (watermarkMatch) {
      const lastMessageId = watermarkMatch[1];
      
      // 找到水位线位置
      const watermarkIndex = existingContent.indexOf(watermarkMatch[0]);
      
      if (watermarkIndex !== -1) {
        // 保留水位线以上的内容（包括用户添加的笔记）
        const contentAboveWatermark = existingContent.substring(0, watermarkIndex);
        
        // 找到新会话中水位线之后的消息
        const lastProcessedIndex = session.messages.findIndex(m => m.id === lastMessageId);
        
        if (lastProcessedIndex !== -1 && lastProcessedIndex < session.messages.length - 1) {
          // 只追加新消息
          const newMessages = session.messages.slice(lastProcessedIndex + 1);
          let newContent = contentAboveWatermark;
          
          for (const message of newMessages) {
            newContent += renderMessage(message, session.messages.indexOf(message));
          }
          
          // 添加新的水位线
          const finalMessageId = session.messages[session.messages.length - 1]?.id || 'none';
          newContent += `\n<!-- aisessionlog:last_message_id:${finalMessageId} -->\n`;
          newContent += `\n*AISessionLog v0.1 · 原始 ID: ${session.sourceId} · [查看原始文件](file://${session.sourcePath})*\n`;
          
          writeFileSync(filePath, newContent);
          return { updated: true, addedMessages: newMessages.length };
        }
      }
    }
  }
  
  // 新文件或无法增量更新，直接写入
  writeFileSync(filePath, content);
  return { updated: true, addedMessages: session.messages.length };
}

/**
 * 导出会话到 Obsidian
 */
export async function exportToObsidian(session, vaultPath) {
  const parts = splitIntoParts(session);
  const paths = parts.map(part => getObsidianPath(vaultPath, session, part.index));
  const names = paths.map(path => basename(path, '.md'));

  // 分片数量变少时清掉上次遗留的多余文件
  for (let index = parts.length + 1; ; index++) {
    const stalePath = getObsidianPath(vaultPath, session, index);
    if (!existsSync(stalePath)) break;
    rmSync(stalePath, { force: true });
  }

  // 单篇：保持原有的增量追加逻辑（保留用户写在水位线以上的笔记）
  if (parts.length === 1) {
    const content = generateMarkdown(session, { ...parts[0], index: 1, total: 1 });
    return {
      filePath: paths[0],
      ...writeToFile(paths[0], content, session)
    };
  }

  // 多篇：结构会随消息增长变化，整体重写每一篇
  const addedMessages = session.messages.length;
  parts.forEach((part, i) => {
    const content = generateMarkdown(session, {
      ...part,
      prev: names[i - 1],
      next: names[i + 1],
    });
    mkdirSync(dirname(paths[i]), { recursive: true });
    writeFileSync(paths[i], content);
  });

  return {
    filePath: paths[0],
    updated: true,
    addedMessages,
  };
}

/**
 * 按单篇体积上限把会话切成多篇
 * 优先在消息边界切分；单条消息自身超限时按行续写，内容不删
 * @param {import('../core/types.js').StandardSession} session
 * @returns {{ index: number, total: number, body: string }[]}
 */
export function splitIntoParts(session) {
  const units = [];

  session.messages.forEach((message, i) => {
    const text = renderMessage(message, i);

    if (Buffer.byteLength(text) <= UNIT_BYTES) {
      units.push(text);
      return;
    }

    // 单条消息本身就超过上限：按行切开跨篇续写，内容一个字节都不删
    splitText(text, UNIT_BYTES).forEach((chunk, index) => {
      units.push(index === 0 ? chunk : `> （接上条消息）\n\n${chunk}`);
    });
  });

  const bodies = [];
  let current = '';
  let bytes = 0;

  for (const unit of units) {
    const cost = Buffer.byteLength(unit);

    if (current && bytes + cost > MAX_NOTE_BYTES) {
      bodies.push(current);
      current = '';
      bytes = 0;
    }

    current += unit;
    bytes += cost;
  }

  if (current) bodies.push(current);
  if (bodies.length === 0) bodies.push('');

  return bodies.map((body, i) => ({
    index: i + 1,
    total: bodies.length,
    body,
  }));
}

/**
 * 把超长文本按字节上限切开，优先在行边界断开
 * @param {string} text
 * @param {number} maxBytes
 * @returns {string[]}
 */
function splitText(text, maxBytes) {
  const chunks = [];
  let current = '';
  let bytes = 0;

  for (const line of text.split('\n')) {
    let rest = line;

    // 单行本身超限：硬切（极端情况，JSON 单行输出）
    while (Buffer.byteLength(rest) > maxBytes) {
      const [head, tail] = hardCut(rest, maxBytes);
      if (current) {
        chunks.push(current);
        current = '';
        bytes = 0;
      }
      chunks.push(head);
      rest = tail;
    }

    const piece = current ? `\n${rest}` : rest;
    const pieceBytes = Buffer.byteLength(piece);

    if (current && bytes + pieceBytes > maxBytes) {
      chunks.push(current);
      current = rest;
      bytes = Buffer.byteLength(rest);
    } else {
      current += piece;
      bytes += pieceBytes;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

/**
 * 按字节上限切一段文本，且不切断多字节字符
 * @param {string} text
 * @param {number} maxBytes
 * @returns {[string, string]}
 */
function hardCut(text, maxBytes) {
  let low = 0;
  let high = text.length;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, mid)) <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return [text.slice(0, low), text.slice(low)];
}
