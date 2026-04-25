/**
 * ASL Obsidian 输出模块
 * 将 StandardSession 渲染为 Markdown 文件
 */

import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';

/**
 * 生成 Obsidian 目录路径
 */
export function getObsidianPath(vaultPath, session) {
  const date = new Date(session.createdAt);
  const yearMonth = date.toISOString().substring(0, 7); // YYYY-MM
  
  // Extract path hash from session.id (format: claude_{sessionId}_{pathHash})
  const pathHash = session.id.includes('_') ? session.id.split('_').pop() : session.sourceId.substring(0, 8);
  const fileName = `${date.toISOString().substring(0, 10).replace(/-/g, '')}_${pathHash}.md`;
  
  return join(vaultPath, 'AISessionLog', session.project, session.source, yearMonth, fileName);
}

/**
 * 生成 Frontmatter
 */
function generateFrontmatter(session) {
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
---
`;
}

/**
 * 生成消息标题
 */
function generateHeader(session) {
  const modelInfo = session.model ? ` · ${session.model}` : '';
  const messageCount = session.messages.length;
  
  return `# ${session.project} · ${new Date(session.createdAt).toLocaleDateString('zh-CN')}

> ${session.source.replace('_', ' ')}${modelInfo} · ${messageCount} 条消息

---
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
export function generateMarkdown(session) {
  let content = '';
  
  // Frontmatter
  content += generateFrontmatter(session);
  content += '\n';
  
  // Header
  content += generateHeader(session);
  
  // Messages
  for (let i = 0; i < session.messages.length; i++) {
    const message = session.messages[i];
    content += renderMessage(message, i);
  }
  
  // Footer
  content += `\n*AISessionLog v0.1 · 原始 ID: ${session.sourceId} · [查看原始文件](file://${session.sourcePath})*\n`;
  
  // 水位线注释（用于增量更新）
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
  const filePath = getObsidianPath(vaultPath, session);
  const content = generateMarkdown(session);
  const result = writeToFile(filePath, content, session);
  
  return {
    filePath,
    ...result
  };
}
