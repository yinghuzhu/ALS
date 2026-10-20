/**
 * 共享的 JSONL 会话日志解析实现
 * CodeBuddy 与 WorkBuddy 使用同一套记录格式（codebuddy.ai/* 元数据），
 * 只有存档目录和 source 标识不同，因此解析逻辑集中在这里。
 *
 * 输入布局: <root>/<encoded-cwd>/<sessionId>.jsonl
 *            <root>/<encoded-cwd>/<sessionId>/subagents/agent-*.jsonl
 *
 * 记录类型：
 *   session-meta         会话元数据（agent / 标题），一个文件可能有多条，后者更新
 *   message              user / assistant 文本消息（input_text | output_text | input_image | image_blob_ref）
 *   function_call        工具调用 → tool_use block
 *   function_call_result 工具返回 → tool_result block（按 callId 与调用关联）
 *   reasoning            模型思考过程（v0.1 丢弃，仅计数）
 *   summary / ai-title   首条请求与 AI 生成的标题
 *   turn-metrics / model-usage / credit-usage 轮次时延、token 与额度统计
 *   file-history-snapshot 文件快照，忽略
 */

import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { basename, dirname } from 'path';
import { PARSER_VERSION } from '../core/types.js';
import { filterCliNoise } from '../core/utils.js';

const MESSAGE_RECORD_TYPES = new Set(['message', 'function_call', 'function_call_result']);

/**
 * @param {string} filePath
 * @param {{ source: string, idPrefix: string }} options
 * @returns {import('../core/types.js').StandardSession[]}
 */
export function parseSessionLogFile(filePath, options) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(line => line.trim());

  if (lines.length === 0) {
    return [];
  }

  const parseWarnings = [];
  const records = [];
  let badLines = 0;

  for (const line of lines) {
    try {
      records.push(JSON.parse(line));
    } catch (e) {
      badLines++;
    }
  }

  if (badLines > 0) {
    parseWarnings.push(`${badLines} line(s) failed to parse`);
    console.warn(`Failed to parse ${badLines} line(s) in ${filePath}`);
  }

  if (records.length === 0) {
    return [];
  }

  const sessionMetas = records.filter(r => r.type === 'session-meta');
  const sessionId =
    lastDefined(sessionMetas, r => r.sessionId) ||
    records.find(r => r.sessionId)?.sessionId ||
    basename(filePath, '.jsonl');

  // 目录名把 "/" 编码成 "-"（如 Users-yhzhu-workgroup-yzhu-AISessionLog），
  // 原路径本身含 "-" 时无法还原，因此优先使用记录里的 cwd
  const cwd = records.find(r => r.cwd)?.cwd || fallbackCwd(filePath);
  const project = basename(cwd);

  const messageRecords = collectMessageRecords(records);
  const messages = filterCliNoise(messageRecords.map(toStandardMessage));

  // 只有 CLI 噪音的会话（例如仅切换过 /model）不产生记录
  if (messages.length === 0) {
    return [];
  }

  const timestamps = records.map(r => toDate(r.timestamp)).filter(t => t !== null);
  const createdAt = timestamps.length > 0 ? new Date(Math.min(...timestamps)) : new Date();
  const updatedAt = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : createdAt;

  const contentHash = createHash('sha256').update(content).digest('hex').substring(0, 16);
  const pathHash = createHash('sha256').update(filePath).digest('hex').substring(0, 8);

  const titleRecord = records.find(r => r.type === 'ai-title');
  const turnMetrics = records.filter(r => r.type === 'turn-metrics');

  const rawMeta = {
    agent: lastDefined(sessionMetas, r => r.meta?.['codebuddy.ai/mainAgent'])
      || records.find(r => r.providerData?.agent)?.providerData.agent,
    hostKind: lastDefined(sessionMetas, r => r.meta?.['codebuddy.ai/hostKind']),
    aiTitle: titleRecord?.aiTitle
      || lastDefined(sessionMetas, r => r.meta?.['codebuddy.ai/sessionTitle']?.[0]?.aiTitle),
    summary: records.find(r => r.type === 'summary')?.summary,
    model: records.find(r => r.providerData?.model)?.providerData.model,
    turns: turnMetrics.length,
    durationMs: turnMetrics.reduce((sum, r) => sum + (r.durationMs || 0), 0),
    tokens: sumUsage(records),
    credits: sumCredits(records),
    reasoningRecords: records.filter(r => r.type === 'reasoning').length,
  };

  const session = {
    id: `${options.idPrefix}_${sessionId}_${pathHash}`,
    sourceId: sessionId,
    source: options.source,
    status: 'complete',
    project,
    projectPath: cwd,
    workingDir: cwd,
    model: rawMeta.model,
    createdAt,
    updatedAt,
    ingestedAt: new Date(),
    messages,
    sourcePath: filePath,
    parserVersion: PARSER_VERSION,
    contentHash,
    parseWarnings,
    rawMeta,
  };

  return [session];
}

/**
 * 取最后一个非空值（同一文件里 session-meta 可能有多条，后者为更新后的值）
 * @param {any[]} records
 * @param {(record: any) => unknown} pick
 */
function lastDefined(records, pick) {
  for (let i = records.length - 1; i >= 0; i--) {
    const value = pick(records[i]);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

/**
 * 收集需要转换的对话记录
 * 同一 id 可能因流式输出被重复写入（function_call 增量更新），保留最后一条
 * @param {any[]} records
 * @returns {any[]}
 */
function collectMessageRecords(records) {
  const byId = new Map();
  let anonymous = 0;

  for (const record of records) {
    if (!MESSAGE_RECORD_TYPES.has(record.type)) continue;
    const key = record.id || `anon_${anonymous++}`;
    byId.set(key, record);
  }

  return [...byId.values()];
}

/**
 * 单条记录 → StandardMessage
 * @param {any} record
 * @returns {import('../core/types.js').StandardMessage}
 */
function toStandardMessage(record) {
  const timestamp = toDate(record.timestamp) || new Date();

  if (record.type === 'function_call') {
    const contentBlocks = [{
      type: 'tool_use',
      content: stringifyArguments(record.arguments),
      toolName: record.name,
      toolUseId: record.callId,
    }];

    return {
      id: record.id,
      role: 'assistant',
      eventType: 'tool_call',
      renderedText: generateRenderedText(contentBlocks),
      contentBlocks,
      rawContent: record,
      timestamp,
    };
  }

  if (record.type === 'function_call_result') {
    const contentBlocks = [{
      type: 'tool_result',
      content: toolResultText(record.output),
      toolUseId: record.callId,
    }];

    return {
      id: record.id,
      role: 'system',
      eventType: 'tool_result',
      renderedText: generateRenderedText(contentBlocks),
      contentBlocks,
      rawContent: record,
      timestamp,
    };
  }

  const contentBlocks = parseContentBlocks(record.content);

  return {
    id: record.id || generateId(),
    role: record.role === 'assistant' ? 'assistant' : 'user',
    eventType: 'message',
    renderedText: generateRenderedText(contentBlocks),
    contentBlocks,
    rawContent: record.content,
    timestamp,
  };
}

/**
 * 解析 message.content 中的内容块
 * @param {any[] | string} content
 * @returns {import('../core/types.js').ContentBlock[]}
 */
function parseContentBlocks(content) {
  if (!content) return [];

  if (typeof content === 'string') {
    return [{ type: 'text', content }];
  }

  if (!Array.isArray(content)) return [];

  return content.map(block => {
    const type = block.type || 'text';

    // input_text / output_text / text
    if (typeof block.text === 'string') {
      return { type: 'text', content: block.text };
    }

    // WorkBuddy 的 input_image 把引用再包一层：{ type: 'input_image', image: { type: 'image_blob_ref', ... } }
    if (type === 'image_blob_ref' || type === 'input_image') {
      const ref = block.image || block;
      return {
        type: 'image',
        content: ref.blob_path || ref.blob_id || '',
      };
    }

    return { type: 'text', content: JSON.stringify(block) };
  });
}

/**
 * 工具参数在记录里已是 JSON 字符串，按原样保留
 * @param {unknown} args
 * @returns {string}
 */
function stringifyArguments(args) {
  if (typeof args === 'string') return args;
  if (args === undefined || args === null) return '{}';
  return JSON.stringify(args);
}

/**
 * 工具返回内容
 * @param {unknown} output
 * @returns {string}
 */
function toolResultText(output) {
  if (!output) return '';
  if (typeof output === 'string') return output;
  if (typeof output.text === 'string') return output.text;
  return JSON.stringify(output);
}

/**
 * 生成 renderedText
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
 * 汇总 token 用量
 * 用量挂在大部分记录的 providerData.rawUsage 上，按 (messageId, stepSeq) 去重，
 * 避免同一步骤的 reasoning / function_call / message 重复计数
 * @param {any[]} records
 * @returns {{ promptTokens: number, completionTokens: number, totalTokens: number }}
 */
function sumUsage(records) {
  const seen = new Set();
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  for (const record of records) {
    const provider = record.providerData;
    const raw = provider?.rawUsage;
    if (!raw) continue;

    const key = `${provider.messageId || record.id}:${provider.stepSeq ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    usage.promptTokens += raw.prompt_tokens || 0;
    usage.completionTokens += raw.completion_tokens || 0;
    usage.totalTokens += raw.total_tokens || 0;
  }

  return usage;
}

/**
 * 汇总额度消耗（图片生成等按 credit 计费的调用）
 * @param {any[]} records
 * @returns {number}
 */
function sumCredits(records) {
  return records
    .filter(record => record.type === 'credit-usage')
    .reduce((sum, record) => sum + (record.providerData?.credit || 0), 0);
}

/**
 * 记录里没有 cwd 时的兜底路径
 * 子 Agent 转录位于 <encoded-cwd>/<sessionId>/subagents/agent-*.jsonl
 * @param {string} filePath
 * @returns {string}
 */
function fallbackCwd(filePath) {
  const dir = dirname(filePath);
  return basename(dir) === 'subagents' ? dirname(dirname(dir)) : dir;
}

/**
 * 时间戳是毫秒整数（1792491547840），也兼容 ISO 字符串
 * @param {unknown} value
 * @returns {Date | null}
 */
function toDate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return isNaN(ms) ? null : new Date(ms);
  }

  return null;
}

/**
 * Generate a unique ID
 * @returns {string}
 */
function generateId() {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
