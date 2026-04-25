/**
 * ASL 工具函数
 */

import { homedir } from 'os';
import { createHash } from 'crypto';

/**
 * 展开路径中的 ~
 */
export function expandTilde(filePath) {
  if (filePath.startsWith('~')) {
    return filePath.replace('~', homedir());
  }
  return filePath;
}

/**
 * 计算内容 hash
 */
export function calculateHash(content) {
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/**
 * 从路径提取项目名
 */
export function extractProjectName(projectPath) {
  if (!projectPath) return 'unknown';
  
  const parts = projectPath.split(/[\/\\]/);
  return parts[parts.length - 1] || 'unknown';
}

/**
 * 格式化时间戳
 */
export function formatTimestamp(timestamp) {
  if (!timestamp) return new Date().toISOString();
  
  if (typeof timestamp === 'number') {
    // Unix 毫秒时间戳
    return new Date(timestamp).toISOString();
  }
  
  if (typeof timestamp === 'string') {
    // ISO 字符串
    return new Date(timestamp).toISOString();
  }
  
  return new Date().toISOString();
}

/**
 * 确保目录存在
 */
export async function ensureDir(dirPath) {
  const { mkdirSync } = await import('fs');
  const { dirname } = await import('path');
  
  mkdirSync(dirname(dirPath), { recursive: true });
}

/**
 * 读取 JSONL 文件
 */
export async function readJsonlFile(filePath) {
  const { readFileSync } = await import('fs');
  
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  
  return lines.map(line => {
    try {
      return JSON.parse(line);
    } catch (err) {
      console.warn(`Failed to parse line: ${line.substring(0, 50)}...`);
      return null;
    }
  }).filter(item => item !== null);
}

/**
 * 清洗消息内容中的 CLI 系统元数据标签
 * 返回清洗后的文本。如果清洗后为空，说明整条消息是 CLI 系统噪音。
 *
 * 清洗规则：
 * - Claude Code: <local-command-caveat>, <command-name>, <local-command-stdout>, <bash-input>, <bash-stdout>, <bash-stderr>
 * - Codex CLI: <permissions instructions>, <collaboration_mode>, <skills_instructions>, <request_user_input availability>
 * - 通用: <permissions_instructions>（不含连字符的变体）
 */
export function stripCliMetadata(text) {
  if (!text || typeof text !== 'string') return '';

  let cleaned = text;

  // Claude Code CLI 系统标签（带内部内容的完整块）
  const claudePatterns = [
    /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g,
    /<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g,
    /<command-name>[\s\S]*?<\/command-name>\s*<command-message>[\s\S]*?<\/command-message>\s*<command-args>[\s\S]*?<\/command-args>/g,
    /<bash-input>[\s\S]*?<\/bash-input>/g,
    /<bash-stdout>[\s\S]*?<\/bash-stdout>/g,
    /<bash-stderr>[\s\S]*?<\/bash-stderr>/g,
  ];

  // Codex CLI 系统标签
  const codexPatterns = [
    /<permissions instructions>[\s\S]*?<\/permissions instructions>/g,
    /<collaboration_mode>[\s\S]*?<\/collaboration_mode>/g,
    /<skills_instructions>[\s\S]*?<\/skills_instructions>/g,
    /<request_user_input[\s\S]*?\/request_user_input>/g,
    /<turn_aborted>[\s\S]*?<\/turn_aborted>/g,
    /<user_shell_command>[\s\S]*?<\/user_shell_command>/g,
    /<image name=[\s\S]*?<\/image>/g,
    /\[Request interrupted by user\]/g,
    /\[SUGGESTION MODE[^\]]*\]/g,
    /\[Auto-approve[^\]]*\]/g,
    /Approved command prefix saved:[\s\S]*?(?=\n\n|\n[A-Z])/gm,
    /The following tool was executed by the user[\s\S]*?(?=\n\n|\n\*\*User)/gm,
    /` change it; user requests or tool descriptions do not change mode by themselves/g,
    /This session is being continued from a previous conversation that ran out of context[\s\S]*?(?=\n\n|\n\*\*User)/gm,
  ];

  for (const pattern of [...claudePatterns, ...codexPatterns]) {
    cleaned = cleaned.replace(pattern, '');
  }

  return cleaned.trim();
}

/**
 * 判断一条消息是否全是 CLI 系统噪音（清洗后为空）
 * @param {string} text - 消息文本
 * @returns {boolean}
 */
export function isCliNoise(text) {
  return stripCliMetadata(text).length === 0;
}

/**
 * 过滤消息列表，移除 CLI 系统噪音消息，并清洗保留消息的内容
 * @param {Array} messages - StandardMessage 数组
 * @returns {Array} 清洗后的消息数组
 */
export function filterCliNoise(messages) {
  return messages.filter(msg => {
    const text = msg.renderedText || msg.content || '';
    if (isCliNoise(text)) return false;

    // 清洗 contentBlocks 中 text 类型的内容
    if (msg.contentBlocks) {
      msg.contentBlocks = msg.contentBlocks.map(block => {
        if (block.type === 'text' && typeof block.content === 'string') {
          return { ...block, content: stripCliMetadata(block.content) };
        }
        return block;
      }).filter(block => {
        if (block.type === 'text') return block.content.trim().length > 0;
        return true;
      });
    }

    // 重新生成 renderedText
    msg.renderedText = (msg.contentBlocks || [])
      .filter(b => b.type === 'text')
      .map(b => b.content)
      .join('\n');

    return true;
  });
}

/**
 * 带时间戳的日志输出
 * 格式: [2026-04-15 14:30:00] message
 */
export function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${ts}] ${msg}`);
}

/**
 * 提取 JWT payload（用于 Claude Code）
 */
export function extractJwtPayload(jwt) {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    
    const payload = parts[1];
    // Base64URL 解码
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padding = 4 - (padded.length % 4);
    const base64 = padded + (padding !== 4 ? '='.repeat(padding) : '');
    
    const decoded = Buffer.from(base64, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch (err) {
    return null;
  }
}
