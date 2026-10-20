/**
 * ASL 扫描与同步模块
 * 整合四个 Adapter 和 Obsidian Sink
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { expandTilde, log } from './utils.js';
import { parseClaudeCodeFile } from '../adapters/claude.js';
import { parseCodexFile } from '../adapters/codex.js';
import { parseCodeBuddyFile } from '../adapters/codebuddy.js';
import { parseOpenCodeFromSqlite } from '../adapters/opencode.js';
import { exportToObsidian } from '../sink/obsidian.js';
import { initDb, needsSync, updateSyncState, recordSession, recordError } from '../db/state.js';

/**
 * 基于 JSONL 文件的数据源
 */
const JSONL_SOURCES = [
  { key: 'claude_code', label: 'Claude', defaultPath: '~/.claude/projects', parse: parseClaudeCodeFile },
  { key: 'codex', label: 'Codex', defaultPath: '~/.codex/sessions', parse: parseCodexFile },
  { key: 'codebuddy', label: 'CodeBuddy', defaultPath: '~/.codebuddy/projects', parse: parseCodeBuddyFile },
];

/**
 * 扫描并同步所有数据源
 */
export async function scanAndSync(config) {
  await initDb();

  const result = {
    sessionsProcessed: 0,
    bySource: {},
    errors: []
  };

  for (const source of JSONL_SOURCES) {
    if (!config.sources[source.key]?.enabled) continue;

    const sourceResult = await scanJsonlSource(source, config);
    result.sessionsProcessed += sourceResult.count;
    result.bySource[source.key] = sourceResult.count;
    result.errors.push(...sourceResult.errors);
  }

  // OpenCode
  if (config.sources.opencode?.enabled) {
    const opencodeResult = await scanOpenCode(config);
    result.sessionsProcessed += opencodeResult.count;
    result.bySource.opencode = opencodeResult.count;
    result.errors.push(...opencodeResult.errors);
  }

  return result;
}

/**
 * 递归查找 JSONL 文件
 */
function findJsonlFiles(dir) {
  let files = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(findJsonlFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * 扫描单个 JSONL 数据源
 * @param {{ key: string, label: string, defaultPath: string, parse: (filePath: string) => any[] }} source
 * @param {any} config
 */
async function scanJsonlSource(source, config) {
  const basePath = expandTilde(config.sources[source.key]?.path || source.defaultPath);
  const result = { count: 0, errors: [] };

  if (!existsSync(basePath)) {
    log(`⚠️  ${source.label} directory not found: ` + basePath);
    return result;
  }

  for (const filePath of findJsonlFiles(basePath)) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const syncCheck = await needsSync(filePath, content);

      if (!syncCheck.needsSync) continue;

      const sessions = source.parse(filePath);

      for (const session of sessions) {
        await recordSession(session);
        await exportToObsidian(session, config.vaultPath);
      }

      await updateSyncState(filePath, content, sessions.length);
      result.count += sessions.length;
      log(`  ✅ ${source.label}: ${sessions.length} sessions from ${filePath}`);
    } catch (error) {
      const errorMsg = `${source.label} parse error: ${error.message}`;
      await recordError(filePath, errorMsg);
      result.errors.push({ filePath, error: errorMsg });
      console.error(`  ❌ ${source.label} error: ${error.message}`);
    }
  }

  return result;
}

/**
 * 扫描 OpenCode 会话
 */
async function scanOpenCode(config) {
  const dbPath = expandTilde('~/.local/share/opencode/opencode.db');
  const result = { count: 0, errors: [] };

  if (existsSync(dbPath)) {
    try {
      const sessions = await parseOpenCodeFromSqlite(dbPath);

      for (const session of sessions) {
        await recordSession(session);
        await exportToObsidian(session, config.vaultPath);
      }

      result.count = sessions.length;
      log(`  ✅ OpenCode: ${sessions.length} sessions from SQLite database`);
    } catch (error) {
      const errorMsg = `OpenCode parse error: ${error.message}`;
      result.errors.push({ filePath: dbPath, error: errorMsg });
      console.error(`  ❌ OpenCode error: ${error.message}`);
    }
  } else {
    log('⚠️  OpenCode database not found, skipping');
  }

  return result;
}

/**
 * 处理文件变更（watch 模式回调）
 */
export async function processFileChange(source, event, filePath) {
  log(`Processing ${event} event for ${source}: ${filePath}`);

  // TODO: 实现增量同步逻辑
  // 目前 watch 模式只记录事件，实际同步在 pull/sync 命令中执行
}
