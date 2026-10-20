/**
 * ASL 状态存储模块
 * 使用 sql.js (纯 JS SQLite 实现) 记录同步状态
 */

import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

const DB_PATH = join(process.env.HOME, '.config', 'aisessionlog', 'state.db');

let db = null;

/**
 * 初始化数据库
 */
export async function initDb() {
  if (db) return db;

  const SQL = await initSqlJs();
  
  // 确保目录存在
  const dbDir = join(process.env.HOME, '.config', 'aisessionlog');
  if (!existsSync(dbDir)) {
    const { mkdirSync } = await import('fs');
    mkdirSync(dbDir, { recursive: true });
  }

  // 尝试加载现有数据库
  try {
    if (existsSync(DB_PATH)) {
      const fileBuffer = readFileSync(DB_PATH);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }
  } catch (err) {
    console.error('Failed to load database, creating new one:', err);
    db = new SQL.Database();
  }

  // 创建表结构
  db.run(`
    CREATE TABLE IF NOT EXISTS sync_state (
      file_path     TEXT PRIMARY KEY,
      content_hash  TEXT NOT NULL,
      last_synced   DATETIME NOT NULL,
      session_count INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT PRIMARY KEY,
      source_id     TEXT NOT NULL,
      source        TEXT NOT NULL,
      project       TEXT,
      status        TEXT NOT NULL,
      created_at    DATETIME,
      updated_at    DATETIME,
      ingested_at   DATETIME NOT NULL,
      source_path   TEXT,
      has_warnings  INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS parse_errors (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path   TEXT NOT NULL,
      error_msg   TEXT NOT NULL,
      occurred_at DATETIME NOT NULL
    )
  `);

  saveDb();
  return db;
}

/**
 * 保存数据库到磁盘
 */
export function saveDb() {
  if (!db) return;
  
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(DB_PATH, buffer);
}

/**
 * 计算文件内容的 hash
 */
export function calculateFileHash(content) {
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/**
 * 检查文件是否需要同步
 */
export async function needsSync(filePath, content) {
  const db = await initDb();
  const currentHash = calculateFileHash(content);

  const stmt = db.prepare('SELECT content_hash, last_synced FROM sync_state WHERE file_path = ?');
  stmt.bind([filePath]);

  if (!stmt.step()) {
    stmt.free();
    return { needsSync: true, reason: 'new_file', hash: currentHash };
  }

  const row = stmt.getAsObject();
  stmt.free();

  const storedHash = row.content_hash;
  const lastSynced = row.last_synced;

  if (currentHash !== storedHash) {
    return { needsSync: true, reason: 'content_changed', hash: currentHash, lastSynced };
  }

  return { needsSync: false, reason: 'up_to_date', hash: currentHash, lastSynced };
}

/**
 * 更新同步状态
 */
/**
 * 读取单个文件的同步状态
 * @param {string} filePath
 * @returns {Promise<{ hash: string, lastSynced: string, sessionCount: number } | null>}
 */
export async function getSyncState(filePath) {
  const db = await initDb();

  const stmt = db.prepare('SELECT content_hash, last_synced, session_count FROM sync_state WHERE file_path = ?');
  stmt.bind([filePath]);

  if (!stmt.step()) {
    stmt.free();
    return null;
  }

  const row = stmt.getAsObject();
  stmt.free();

  return {
    hash: row.content_hash,
    lastSynced: row.last_synced,
    sessionCount: row.session_count,
  };
}

export async function updateSyncState(filePath, content, sessionCount) {
  const db = await initDb();
  const hash = calculateFileHash(content);
  const now = new Date().toISOString();
  
  db.run(`
    INSERT OR REPLACE INTO sync_state (file_path, content_hash, last_synced, session_count)
    VALUES (?, ?, ?, ?)
  `, [filePath, hash, now, sessionCount]);
  
  saveDb();
}

/**
 * 记录会话
 */
export async function recordSession(session) {
  const db = await initDb();
  const now = new Date().toISOString();
  
  db.run(`
    INSERT OR REPLACE INTO sessions 
    (id, source_id, source, project, status, created_at, updated_at, ingested_at, source_path, has_warnings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    session.id,
    session.sourceId,
    session.source,
    session.project,
    session.status,
    session.createdAt?.toISOString() || now,
    session.updatedAt?.toISOString() || now,
    now,
    session.sourcePath,
    session.parseWarnings?.length > 0 ? 1 : 0
  ]);
  
  saveDb();
}

/**
 * 记录解析错误
 */
export async function recordError(filePath, errorMsg) {
  const db = await initDb();
  const now = new Date().toISOString();
  
  db.run(`
    INSERT INTO parse_errors (file_path, error_msg, occurred_at)
    VALUES (?, ?, ?)
  `, [filePath, errorMsg, now]);
  
  saveDb();
}

/**
 * 获取同步统计
 */
export async function getStats() {
  const db = await initDb();
  
  const filesResult = db.exec('SELECT COUNT(*) as count FROM sync_state');
  const sessionsResult = db.exec('SELECT COUNT(*) as count FROM sessions');
  const errorsResult = db.exec('SELECT COUNT(*) as count FROM parse_errors');
  
  const filesCount = filesResult[0]?.values[0]?.[0] || 0;
  const sessionsCount = sessionsResult[0]?.values[0]?.[0] || 0;
  const errorsCount = errorsResult[0]?.values[0]?.[0] || 0;
  
  // 按来源统计会话
  const bySourceResult = db.exec(`
    SELECT source, COUNT(*) as count 
    FROM sessions 
    GROUP BY source
  `);
  
  const bySource = {};
  if (bySourceResult[0]) {
    for (const row of bySourceResult[0].values) {
      bySource[row[0]] = row[1];
    }
  }
  
  return {
    files: filesCount,
    sessions: sessionsCount,
    errors: errorsCount,
    bySource
  };
}

/**
 * 获取最近的错误
 */
export async function getRecentErrors(limit = 10) {
  const db = await initDb();
  const stmt = db.prepare('SELECT file_path, error_msg, occurred_at FROM parse_errors ORDER BY occurred_at DESC LIMIT ?');
  stmt.bind([limit]);

  const errors = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    errors.push({
      filePath: row.file_path,
      errorMsg: row.error_msg,
      occurredAt: row.occurred_at
    });
  }
  stmt.free();

  return errors;
}
