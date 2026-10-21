/**
 * CodexAdapter - Parses Codex CLI JSONL session files
 * @see tech.md section "CodexAdapter ✅ 已验证"
 * 
 * Input: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 * Output: StandardSession[]
 */

import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { basename, dirname } from 'path';
import { PARSER_VERSION } from '../core/types.js';
import { filterCliNoise, readJsonlRecords, hashFile } from '../core/utils.js';

const CODEX_VERSION = '0.1.0';

/**
 * Parse a Codex CLI JSONL file
 * @param {string} filePath - Absolute path to the JSONL file
 * @returns {import('../core/types.js').StandardSession[]}
 */
export function parseCodexFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const records = parseLines(content, filePath);

  return buildSessions(records, filePath, createHash('sha256').update(content).digest('hex').substring(0, 16));
}

/**
 * 解析归档的 .jsonl.zst：流式解压逐行读取，内存占用与文件大小无关
 * @param {string} filePath
 * @returns {Promise<import('../core/types.js').StandardSession[]>}
 */
export async function parseCodexFileAsync(filePath) {
  const records = [];
  for await (const record of readJsonlRecords(filePath)) {
    records.push(record);
  }

  return buildSessions(records, filePath, await hashFile(filePath));
}

/**
 * 按后缀选择解析方式（.jsonl / .jsonl.zst）
 * @param {string} filePath
 */
export function parseCodexSessionFile(filePath) {
  return filePath.endsWith('.zst') ? parseCodexFileAsync(filePath) : parseCodexFile(filePath);
}

/**
 * 逐行解析 JSONL 文本
 */
function parseLines(content, filePath) {
  const records = [];

  for (const line of content.trim().split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch (e) {
      console.warn(`Failed to parse line in ${filePath}: ${e.message}`);
    }
  }

  return records;
}

/**
 * 由记录构建 StandardSession
 */
function buildSessions(records, filePath, contentHash) {
  if (records.length === 0) {
    return [];
  }

  // Extract session metadata from session_meta record
  const sessionMeta = records.find(r => r.type === 'session_meta');
  const payload = sessionMeta?.payload || {};
  
  const sessionId = payload.id || 'unknown';
  const cwd = payload.cwd || dirname(dirname(dirname(dirname(filePath)))); // Navigate up from YYYY/MM/DD
  const project = basename(cwd);
  
  // Filter to response_item with user/assistant role
  const messageRecords = records.filter(r => 
    r.type === 'response_item' && 
    (r.payload?.role === 'user' || r.payload?.role === 'assistant' || r.payload?.role === 'developer')
  );

  // Extract timestamps
  const sessionTimestamp = sessionMeta?.timestamp || payload.timestamp;
  const messageTimestamps = messageRecords.map(r => new Date(r.timestamp).getTime()).filter(t => !isNaN(t));
  
  const createdAt = sessionTimestamp ? new Date(sessionTimestamp) : 
                    (messageTimestamps.length > 0 ? new Date(Math.min(...messageTimestamps)) : new Date());
  const updatedAt = messageTimestamps.length > 0 ? new Date(Math.max(...messageTimestamps)) : createdAt;

  // Parse messages
  const messages = filterCliNoise(messageRecords.map(record => {
    const payload = record.payload || {};
    const role = payload.role === 'developer' ? 'user' : (payload.role || 'user');
    const uuid = payload.id || generateId();
    const timestamp = record.timestamp ? new Date(record.timestamp) : new Date();

    // Extract content from payload
    const contentItems = payload.content || [];
    const contentBlocks = parseCodexContent(contentItems);
    const renderedText = generateRenderedText(contentBlocks);

    return {
      id: uuid,
      role,
      eventType: 'message',
      renderedText,
      contentBlocks,
      rawContent: payload,
      timestamp,
    };
  }));

  // Extract metadata
  const rawMeta = {
    model: payload.model,
    originator: payload.originator,
    cliVersion: payload.cli_version,
    modelProvider: payload.model_provider,
  };

  const session = {
    id: `codex_${sessionId}`,
    sourceId: sessionId,
    source: 'codex_cli',
    status: 'complete',
    project,
    projectPath: cwd,
    workingDir: cwd,
    model: payload.model,
    createdAt,
    updatedAt,
    ingestedAt: new Date(),
    messages,
    sourcePath: filePath,
    parserVersion: PARSER_VERSION,
    contentHash,
    parseWarnings: [],
    rawMeta,
  };

  return [session];
}

/**
 * Parse content items from Codex message
 * @param {any[]} contentItems
 * @returns {import('../core/types.js').ContentBlock[]}
 */
function parseCodexContent(contentItems) {
  if (!contentItems || !Array.isArray(contentItems)) {
    return [];
  }
  
  return contentItems.map(item => {
    const type = item.type;
    
    if (type === 'input_text' || type === 'output_text') {
      return {
        type: 'text',
        content: item.text || '',
      };
    }
    
    if (type === 'tool_call' || type === 'tool_use') {
      return {
        type: 'tool_use',
        content: JSON.stringify(item.args || item.input || {}),
        toolName: item.name || item.tool_name,
        toolUseId: item.id || item.tool_call_id,
      };
    }
    
    if (type === 'tool_result' || type === 'tool_output') {
      return {
        type: 'tool_result',
        content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output),
        toolUseId: item.tool_call_id,
      };
    }
    
    if (type === 'image') {
      return {
        type: 'image',
        content: item.data || item.url || '',
      };
    }
    
    // Default to text
    return {
      type: 'text',
      content: item.text || JSON.stringify(item),
    };
  });
}

/**
 * Generate rendered text for search and display
 * @param {import('../core/types.js').ContentBlock[]} contentBlocks
 * @returns {string}
 */
function generateRenderedText(contentBlocks) {
  return contentBlocks.map(block => {
    if (block.type === 'text') {
      return block.content;
    }
    if (block.type === 'tool_use') {
      return `[调用工具：${block.toolName || 'unknown'}]`;
    }
    if (block.type === 'tool_result') {
      const content = block.content || '';
      if (content.length > 500) {
        return `[工具返回：${content.substring(0, 500)}...]`;
      }
      return `[工具返回：${content}]`;
    }
    if (block.type === 'image') {
      return '[图片]';
    }
    return '';
  }).join('\n');
}

/**
 * Generate a unique ID
 * @returns {string}
 */
function generateId() {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Check if a file path belongs to Codex CLI
 * @param {string} filePath
 * @returns {boolean}
 */
export function canHandleCodex(filePath) {
  return filePath.endsWith('.jsonl') && filePath.includes('.codex/sessions');
}

/**
 * Adapter interface
 */
export const CodexAdapter = {
  source: 'codex_cli',
  version: CODEX_VERSION,
  
  canHandle(filePath) {
    return canHandleCodex(filePath);
  },
  
  async parse(filePath) {
    return parseCodexFile(filePath);
  },
};

export default CodexAdapter;
