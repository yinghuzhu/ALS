/**
 * ASL 扫描与同步模块
 * 整合三个 Adapter 和 Obsidian Sink
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { expandTilde, calculateHash, extractProjectName, log } from './utils.js';
import { parseClaudeCodeFile } from '../adapters/claude.js';
import { parseCodexFile } from '../adapters/codex.js';
import { parseOpenCodeFromSqlite } from '../adapters/opencode.js';
import { exportToObsidian } from '../sink/obsidian.js';
import { initDb, needsSync, updateSyncState, recordSession, recordError } from '../db/state.js';

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
  
  // Claude Code
  if (config.sources.claude_code?.enabled) {
    const claudeResult = await scanClaudeCode(config);
    result.sessionsProcessed += claudeResult.count;
    result.bySource.claude_code = claudeResult.count;
    result.errors.push(...claudeResult.errors);
  }
  
  // Codex CLI
  if (config.sources.codex?.enabled) {
    const codexResult = await scanCodex(config);
    result.sessionsProcessed += codexResult.count;
    result.bySource.codex = codexResult.count;
    result.errors.push(...codexResult.errors);
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
 * 扫描 Claude Code 会话
 */
async function scanClaudeCode(config) {
  const basePath = config.sources.claude_code.path || expandTilde('~/.claude/projects');
  const result = { count: 0, errors: [] };
  
  if (!existsSync(basePath)) {
    log('⚠️  Claude Code directory not found: ' + basePath);
    return result;
  }
  
  // 递归查找所有 JSONL 文件
  const jsonlFiles = findJsonlFiles(basePath);
  
  for (const filePath of jsonlFiles) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const syncCheck = await needsSync(filePath, content);
      
      if (syncCheck.needsSync) {
        const sessions = parseClaudeCodeFile(filePath);
        
        for (const session of sessions) {
          await recordSession(session);
          await exportToObsidian(session, config.vaultPath);
        }
        
        await updateSyncState(filePath, content, sessions.length);
        result.count += sessions.length;
        log(`  ✅ Claude: ${sessions.length} sessions from ${filePath}`);
      }
    } catch (error) {
      const errorMsg = `Claude Code parse error: ${error.message}`;
      await recordError(filePath, errorMsg);
      result.errors.push({ filePath, error: errorMsg });
      console.error(`  ❌ Claude error: ${error.message}`);
    }
  }
  
  return result;
}

/**
 * 扫描 Codex CLI 会话
 */
async function scanCodex(config) {
  const basePath = config.sources.codex.path || expandTilde('~/.codex/sessions');
  const result = { count: 0, errors: [] };
  
  if (!existsSync(basePath)) {
    log('⚠️  Codex CLI directory not found: ' + basePath);
    return result;
  }
  
  // 递归查找所有 JSONL 文件
  const findJsonlFiles = (dir) => {
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
  };
  
  const jsonlFiles = findJsonlFiles(basePath);
  
  for (const filePath of jsonlFiles) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const syncCheck = await needsSync(filePath, content);
      
      if (syncCheck.needsSync) {
        const sessions = parseCodexFile(filePath);
        
        for (const session of sessions) {
          await recordSession(session);
          await exportToObsidian(session, config.vaultPath);
        }
        
        await updateSyncState(filePath, content, sessions.length);
        result.count += sessions.length;
        log(`  ✅ Codex: ${sessions.length} sessions from ${filePath}`);
      }
    } catch (error) {
      const errorMsg = `Codex parse error: ${error.message}`;
      await recordError(filePath, errorMsg);
      result.errors.push({ filePath, error: errorMsg });
      console.error(`  ❌ Codex error: ${error.message}`);
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
