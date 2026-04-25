/**
 * ClaudeCodeAdapter - Parses Claude Code JSONL session files
 * @see tech.md section "ClaudeCodeAdapter ✅ 已验证"
 * 
 * Input: ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 * Output: StandardSession[]
 */

import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { basename, dirname } from 'path';
import { PARSER_VERSION } from '../core/types.js';
import { filterCliNoise } from '../core/utils.js';

const CLAUDE_CODE_VERSION = '0.1.0';

/**
 * Parse a Claude Code JSONL file
 * @param {string} filePath - Absolute path to the JSONL file
 * @returns {import('../core/types.js').StandardSession[]}
 */
export function parseClaudeCodeFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(line => line.trim());
  
  if (lines.length === 0) {
    return [];
  }

  // Parse all lines
  const records = lines.map(line => {
    try {
      return JSON.parse(line);
    } catch (e) {
      console.warn(`Failed to parse line in ${filePath}: ${e.message}`);
      return null;
    }
  }).filter(Boolean);

  if (records.length === 0) {
    return [];
  }

  // Extract session metadata from first record with sessionId
  const sessionRecord = records.find(r => r.sessionId) || records[0];
  const sessionId = sessionRecord.sessionId || 'unknown';
  const cwd = sessionRecord.cwd || dirname(filePath);
  const project = basename(cwd);
  
  // Filter to user and assistant messages only
  const messageRecords = records.filter(r => 
    r.type === 'user' || r.type === 'assistant'
  );

  // Extract timestamps for session timing
  const timestamps = messageRecords.map(r => new Date(r.timestamp).getTime()).filter(t => !isNaN(t));
  const createdAt = timestamps.length > 0 ? new Date(Math.min(...timestamps)) : new Date();
  const updatedAt = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : new Date();

  // Parse messages
  const messages = filterCliNoise(messageRecords.map(record => {
    const role = record.type === 'user' ? 'user' : 'assistant';
    const uuid = record.uuid || record.messageId || generateId();
    const timestamp = record.timestamp ? new Date(record.timestamp) : new Date();

    // Extract content from message
    const messageContent = record.message?.content;
    const contentBlocks = parseContentBlocks(messageContent);
    const renderedText = generateRenderedText(contentBlocks);

    return {
      id: uuid,
      role,
      eventType: 'message',
      renderedText,
      contentBlocks,
      rawContent: record.message,
      timestamp,
    };
  }));

  // Generate content hash
  const contentHash = createHash('sha256').update(content).digest('hex').substring(0, 16);

  // Extract metadata
  const rawMeta = {
    claudeVersion: sessionRecord.version,
    gitBranch: sessionRecord.gitBranch,
  };

  // Use full path hash to ensure unique IDs across subdirectories
  const pathHash = createHash('sha256').update(filePath).digest('hex').substring(0, 8);
  const session = {
    id: `claude_${sessionId}_${pathHash}`,
    sourceId: sessionId,
    source: 'claude_code',
    status: 'complete',
    project,
    projectPath: cwd,
    workingDir: cwd,
    model: messages.find(m => m.rawContent?.model)?.rawContent?.model,
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
 * Parse content blocks from Claude Code message content
 * @param {string | any[]} content - Content string or array
 * @returns {import('../core/types.js').ContentBlock[]}
 */
function parseContentBlocks(content) {
  if (!content) return [];
  
  if (typeof content === 'string') {
    return [{
      type: 'text',
      content,
    }];
  }
  
  if (Array.isArray(content)) {
    return content.map(block => {
      const type = block.type || 'text';
      const text = block.text || block.content || '';
      
      if (type === 'tool_use') {
        return {
          type: 'tool_use',
          content: JSON.stringify(block.input || {}),
          toolName: block.name,
          toolUseId: block.id,
        };
      }
      
      if (type === 'tool_result') {
        return {
          type: 'tool_result',
          content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
          toolUseId: block.tool_use_id,
        };
      }
      
      if (type === 'image') {
        return {
          type: 'image',
          content: block.source?.data || '',
        };
      }
      
      return {
        type: 'text',
        content: text,
      };
    });
  }
  
  return [];
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
 * Check if a file path belongs to Claude Code
 * @param {string} filePath
 * @returns {boolean}
 */
export function canHandleClaudeCode(filePath) {
  return filePath.endsWith('.jsonl') && filePath.includes('.claude/projects');
}

/**
 * Adapter interface
 */
export const ClaudeCodeAdapter = {
  source: 'claude_code',
  version: CLAUDE_CODE_VERSION,
  
  canHandle(filePath) {
    return canHandleClaudeCode(filePath);
  },
  
  async parse(filePath) {
    return parseClaudeCodeFile(filePath);
  },
};

export default ClaudeCodeAdapter;
