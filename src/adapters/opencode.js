/**
 * OpenCodeAdapter - Unified parser for OpenCode sessions
 * @see tech.md section "OpenCodeAdapter"
 *
 * Supports two input formats:
 * 1. SQLite database (production): ~/.local/share/opencode/opencode.db
 * 2. JSON sample files (testing): sessions_list.json + messages_sample.jsonl
 */

import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { basename } from 'path';
import initSqlJs from 'sql.js';
import { PARSER_VERSION } from '../core/types.js';
import { filterCliNoise } from '../core/utils.js';

const OPENCODE_VERSION = '0.1.0';

// ── Shared helpers ──────────────────────────────────────────

function generateId() {
  return `opencode_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function calculateHash(content) {
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

// ── SQLite parsing (production) ─────────────────────────────

// Part types that carry no user-visible content
const SKIP_PART_TYPES = new Set(['step-start', 'step-finish', 'patch', 'file', 'compaction']);

/**
 * Parse one message's parts into content blocks.
 * Skips internal metadata (step-start/finish, patch) and extracts
 * actual text, reasoning, and tool calls from the `part` table.
 */
function parsePartsIntoBlocks(parts) {
  const contentBlocks = [];

  for (const pd of parts) {
    const t = pd.type;
    if (SKIP_PART_TYPES.has(t)) continue;

    if (t === 'text') {
      const text = pd.text || '';
      if (text.trim()) {
        contentBlocks.push({ type: 'text', content: text });
      }
    } else if (t === 'reasoning') {
      const text = pd.text || '';
      if (text.trim()) {
        contentBlocks.push({ type: 'text', content: `💭 Reasoning: ${text}` });
      }
    } else if (t === 'tool') {
      const toolName = pd.tool || 'unknown';
      const callId = pd.callID || '';
      const input = pd.state?.input;
      const output = pd.state?.output;
      const status = pd.state?.status || '';

      contentBlocks.push({
        type: 'tool_use',
        content: input ? (typeof input === 'string' ? input : JSON.stringify(input, null, 2)) : '',
        toolName,
        toolUseId: callId,
      });

      if (output !== undefined && output !== null) {
        const outputStr = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
        if (outputStr.trim()) {
          contentBlocks.push({
            type: 'tool_result',
            content: outputStr,
            toolUseId: callId,
          });
        }
      }
    }
  }

  return contentBlocks;
}

/**
 * Parse OpenCode sessions from SQLite database (message + part tables).
 *
 * The `message` table only holds metadata (role, tokens, finish status).
 * The actual conversation content lives in the `part` table:
 *   - text:      assistant/user text responses
 *   - reasoning: model chain-of-thought
 *   - tool:      tool calls with full input/output
 *   - step-start / step-finish / patch / file / compaction: internal metadata (skipped)
 *
 * @param {string} dbPath - Path to opencode.db
 * @returns {Promise<import('../core/types.js').StandardSession[]>}
 */
export async function parseOpenCodeFromSqlite(dbPath) {
  const fileBuffer = readFileSync(dbPath);
  const SQL = await initSqlJs();
  const db = new SQL.Database(fileBuffer);

  try {
    const sessions = [];

    // 1. Iterate sessions via prepared statement (memory-friendly)
    const sessStmt = db.prepare(`
      SELECT id, slug, title, directory, time_created, time_updated
      FROM session
      ORDER BY time_created DESC
    `);

    while (sessStmt.step()) {
      const [sessionId, slug, title, directory, sessCreated, sessUpdated] = sessStmt.get();

      // 2. For each session, join message + part
      const msgStmt = db.prepare(`
        SELECT
          m.id          AS mid,
          m.time_created AS mtime,
          m.data         AS mdata,
          p.id           AS pid,
          p.data         AS pdata
        FROM message m
        LEFT JOIN part p ON m.id = p.message_id
        WHERE m.session_id = ?
        ORDER BY m.time_created ASC, p.time_created ASC
      `);
      msgStmt.bind([sessionId]);

      // Accumulate parts per message
      const msgMap = new Map();

      while (msgStmt.step()) {
        const [mid, mtime, mdataStr, pid, pdataStr] = msgStmt.get();

        if (!msgMap.has(mid)) {
          let msgData = {};
          try { msgData = typeof mdataStr === 'string' ? JSON.parse(mdataStr) : {}; } catch (_) { /* empty */ }
          msgMap.set(mid, { timeCreated: mtime, data: msgData, parts: [] });
        }

        if (pid) {
          let pd = {};
          try { pd = typeof pdataStr === 'string' ? JSON.parse(pdataStr) : {}; } catch (_) { /* empty */ }
          msgMap.get(mid).parts.push(pd);
        }
      }
      msgStmt.free();

      // 3. Build StandardMessages
      const parsedMessages = [];

      for (const [mid, { timeCreated, data, parts }] of msgMap) {
        const contentBlocks = parsePartsIntoBlocks(parts);
        if (contentBlocks.length === 0) continue;

        const role = data.role || 'user';
        const timestamp = new Date(data.time?.created || timeCreated);

        const renderedText = contentBlocks
          .filter(b => b.type === 'text')
          .map(b => b.content)
          .join('\n');

        parsedMessages.push({
          id: mid,
          role,
          eventType: 'message',
          renderedText: renderedText || `${role} message`,
          contentBlocks,
          rawContent: data,
          timestamp,
          promptTokens: data.tokens?.input,
          completionTokens: data.tokens?.output,
        });
      }

      if (parsedMessages.length === 0) continue;

      const projectName = directory ? directory.split('/').pop() : (slug || 'unknown');
      const filteredMessages = filterCliNoise(parsedMessages);

      if (filteredMessages.length === 0) continue;

      sessions.push({
        id: `opencode_${sessionId}`,
        sourceId: sessionId,
        source: 'opencode',
        status: 'complete',
        project: projectName,
        projectPath: directory || 'unknown',
        model: filteredMessages[0]?.rawContent?.model?.modelID
            || filteredMessages[0]?.rawContent?.modelID
            || 'unknown',
        createdAt: new Date(sessCreated),
        updatedAt: new Date(sessUpdated),
        ingestedAt: new Date(),
        messages: filteredMessages,
        sourcePath: dbPath,
        parserVersion: PARSER_VERSION,
        contentHash: calculateHash(JSON.stringify({ id: sessionId, slug, title })),
        parseWarnings: [],
        rawMeta: { slug, title },
      });
    }

    sessStmt.free();
    return sessions;
  } finally {
    db.close();
  }
}

// ── JSON sample parsing (testing) ───────────────────────────

/**
 * Parse OpenCode sessions from JSON sample files (for testing)
 * @param {string} sessionsPath - Path to sessions_list.json
 * @param {string} [messagesPath] - Optional path to messages_sample.jsonl
 * @returns {import('../core/types.js').StandardSession[]}
 */
export function parseOpenCodeFromJson(sessionsPath, messagesPath) {
  const sessionsContent = readFileSync(sessionsPath, 'utf-8');
  const sessions = JSON.parse(sessionsContent);

  let messagesData = [];
  if (messagesPath) {
    const messagesContent = readFileSync(messagesPath, 'utf-8');
    const lines = messagesContent.trim().split('\n').filter(line => line.trim());
    messagesData = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch (e) {
        console.warn(`Failed to parse message line: ${e.message}`);
        return null;
      }
    }).filter(Boolean);
  }

  // Group messages by session_id
  const messagesBySession = {};
  for (const msg of messagesData) {
    const sid = msg.session_id;
    if (!messagesBySession[sid]) messagesBySession[sid] = [];
    messagesBySession[sid].push(msg);
  }

  const result = [];

  for (const session of sessions) {
    const sessionMessages = messagesBySession[session.id] || [];
    sessionMessages.sort((a, b) => a.time_created - b.time_created);

    const createdAt = new Date(session.time_created);
    const updatedAt = new Date(session.time_updated);

    const messages = sessionMessages.map(msg => {
      const role = msg.role || 'user';
      const uuid = msg.message_id || generateId();
      const timestamp = new Date(msg.time_created);

      const contentBlocks = [{ type: 'text', content: msg.content || '' }];

      return {
        id: uuid,
        role,
        eventType: 'message',
        renderedText: msg.content || '',
        contentBlocks,
        rawContent: msg,
        timestamp,
      };
    });

    const contentHash = createHash('sha256')
      .update(JSON.stringify(session))
      .digest('hex')
      .substring(0, 16);

    result.push({
      id: `opencode_${session.id}`,
      sourceId: session.id,
      source: 'opencode',
      status: 'complete',
      project: basename(session.directory),
      projectPath: session.directory,
      workingDir: session.directory,
      model: undefined,
      createdAt,
      updatedAt,
      ingestedAt: new Date(),
      messages,
      sourcePath: sessionsPath,
      parserVersion: PARSER_VERSION,
      contentHash,
      parseWarnings: [],
      rawMeta: {
        slug: session.slug,
        title: session.title,
      },
    });
  }

  return result;
}

// ── Adapter interface ───────────────────────────────────────

/**
 * Check if a path belongs to OpenCode
 * @param {string} filePath
 * @returns {boolean}
 */
export function canHandleOpenCode(filePath) {
  return filePath.endsWith('.db') ||
         (filePath.endsWith('.json') && filePath.includes('opencode'));
}

export const OpenCodeAdapter = {
  source: 'opencode',
  version: OPENCODE_VERSION,

  canHandle(filePath) {
    return canHandleOpenCode(filePath);
  },

  async parse(filePath) {
    if (filePath.endsWith('.json')) {
      if (filePath.includes('sessions') || filePath.includes('sample')) {
        const messagesPath = filePath.replace('sessions_list.json', 'messages_sample.json')
                                     .replace('sample_sessions.json', 'messages_sample.json');
        return parseOpenCodeFromJson(filePath, messagesPath);
      }
    }
    return parseOpenCodeFromSqlite(filePath);
  },
};

export default OpenCodeAdapter;
