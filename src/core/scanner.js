/**
 * ASL 扫描与同步模块
 * 整合五个 Adapter 和 Obsidian Sink
 */

import { readdirSync, readFileSync, existsSync, renameSync } from 'fs';
import { join } from 'path';
import { expandTilde, log, hashFile } from './utils.js';
import { parseClaudeCodeFile } from '../adapters/claude.js';
import { parseCodexSessionFile } from '../adapters/codex.js';
import { parseCodeBuddyFile } from '../adapters/codebuddy.js';
import { parseWorkBuddyFile } from '../adapters/workbuddy.js';
import { parseOpenCodeFromSqlite } from '../adapters/opencode.js';
import { exportToObsidian } from '../sink/obsidian.js';
import { initDb, needsSyncByHash, getSyncState, updateSyncState, updateSyncStateByHash, resetSyncState, recordSession, recordError } from '../db/state.js';

/**
 * 基于 JSONL 文件的数据源
 */
const JSONL_SOURCES = [
  { key: 'claude_code', label: 'Claude', defaultPath: '~/.claude/projects', parse: parseClaudeCodeFile },
  { key: 'codex', label: 'Codex', defaultPath: '~/.codex/sessions', parse: parseCodexSessionFile },
  { key: 'codebuddy', label: 'CodeBuddy', defaultPath: '~/.codebuddy/projects', parse: parseCodeBuddyFile },
  { key: 'workbuddy', label: 'WorkBuddy', defaultPath: '~/.workbuddy/projects', parse: parseWorkBuddyFile },
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
 * 全量重建：清空输出目录与同步状态后重新导入所有数据源
 * @param {any} config
 */
export async function rebuildAll(config) {
  if (!config?.vaultPath) {
    throw new Error('rebuild 需要 vaultPath');
  }

  const outputDir = join(config.vaultPath, 'AISessionLog');

  // 先改名备份而不是直接删除：源文件已被清理的会话无法重新生成，
  // 留一份旧笔记可以人工恢复（本次重建就有 571 篇 Claude 笔记需要这样恢复）
  if (existsSync(outputDir)) {
    const backupDir = `${outputDir}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    renameSync(outputDir, backupDir);
    log(`📦 旧笔记已备份到 ${backupDir}`);
  }

  await initDb();
  await resetSyncState();

  log(`♻️  已清空 ${outputDir} 与同步状态，开始全量重建`);
  return scanAndSync(config);
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
    } else if (entry.isFile() && (entry.name.endsWith('.jsonl') || entry.name.endsWith('.jsonl.zst'))) {
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
      const synced = await syncJsonlFile(source, filePath, config);
      result.count += synced.sessions;
      if (synced.sessions > 0) {
        log(`  ✅ ${source.label}: ${synced.sessions} sessions from ${filePath}`);
      }
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
 * 同步单个 JSONL 文件（内容未变化时跳过）
 * @param {{ key: string, label: string, defaultPath: string, parse: (filePath: string) => any[] }} source
 * @param {string} filePath
 * @param {{ vaultPath: string }} config
 * @returns {Promise<{ sessions: number, skipped: boolean }>}
 */
async function syncJsonlFile(source, filePath, config) {
  // 流式 hash：Codex 归档的 .jsonl.zst 解压后可能有上 GB，不能整file读成字符串
  const hash = await hashFile(filePath);
  const syncCheck = await needsSyncByHash(filePath, hash);

  if (!syncCheck.needsSync) {
    return { sessions: 0, skipped: true };
  }

  const sessions = await source.parse(filePath);

  for (const session of sessions) {
    await recordSession(session);
    await exportToObsidian(session, config.vaultPath);
  }

  await updateSyncStateByHash(filePath, hash, sessions.length);
  return { sessions: sessions.length, skipped: false };
}

/**
 * 扫描 OpenCode 会话
 */
async function scanOpenCode(config) {
  const dbPath = expandTilde('~/.local/share/opencode/opencode.db');
  const result = { count: 0, errors: [] };

  if (existsSync(dbPath)) {
    try {
      const lastSync = await getSyncState(dbPath);
      // 留 5 分钟缓冲，避免上次同步进行中才写入的 session 被漏掉
      const since = lastSync ? Math.max(0, Date.parse(lastSync.lastSynced) - 5 * 60 * 1000) : 0;

      const sessions = await parseOpenCodeFromSqlite(dbPath, { since });

      for (const session of sessions) {
        await recordSession(session);
        await exportToObsidian(session, config.vaultPath);
      }

      // SQLite 没有可哈希的文件内容，用同步时间戳作为增量标记
      await updateSyncState(dbPath, String(Date.now()), sessions.length);

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
 * 未显式传入配置时（watch 模式）使用的默认配置
 */
function defaultConfig() {
  return {
    vaultPath: expandTilde('~/Documents/ObsidianVault'),
    sources: Object.fromEntries(
      JSONL_SOURCES.map(source => [source.key, { enabled: true, path: source.defaultPath }])
    ),
  };
}

/**
 * 处理文件变更（watch 模式回调）
 * 文件被删除时不处理，其它事件直接增量同步单个文件
 * @param {string} sourceKey
 * @param {'add' | 'change' | 'unlink'} event
 * @param {string} filePath
 * @param {any} [config]
 */
export async function processFileChange(sourceKey, event, filePath, config = defaultConfig()) {
  if (event === 'unlink') return { sessions: 0, skipped: true };

  const source = JSONL_SOURCES.find(item => item.key === sourceKey);
  if (!source) return { sessions: 0, skipped: true };

  await initDb();

  const synced = await syncJsonlFile(source, filePath, config);
  if (synced.sessions > 0) {
    log(`  ✅ ${source.label} [${event}]: ${synced.sessions} sessions from ${filePath}`);
  }

  return synced;
}
