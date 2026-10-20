/**
 * ASL 文件监听模块
 * 使用 chokidar 监听 JSONL 数据源的文件变更
 */

import chokidar from 'chokidar';
import { expandTilde } from './utils.js';

const DEBOUNCE_MS = 300;

/**
 * 数据源路径配置
 */
const SOURCE_PATHS = {
  claude_code: expandTilde('~/.claude/projects/**/*'),
  codex: expandTilde('~/.codex/sessions/**/*.jsonl'),
  codebuddy: expandTilde('~/.codebuddy/projects/**/*.jsonl'),
  workbuddy: expandTilde('~/.workbuddy/projects/**/*.jsonl'),
  opencode: expandTilde('~/.local/share/opencode/') // SQLite 文件，不需要监听
};

/** 需要监听的数据源（OpenCode 走手动同步） */
const WATCHED_SOURCES = ['claude_code', 'codex', 'codebuddy', 'workbuddy'];

let watchers = new Map();
let onFileChangeCallback = null;

/**
 * 设置文件变更回调
 */
export function onFileChange(callback) {
  onFileChangeCallback = callback;
}

/**
 * 防抖函数
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * 启动文件监听
 */
export async function startWatching() {
  console.log('🔍 启动文件监听...');
  
  for (const source of WATCHED_SOURCES) {
    const watcher = chokidar.watch(SOURCE_PATHS[source], {
      // 不能按 "隐藏文件" 过滤：数据源目录本身就在 ~/.codex、~/.claude 这类点目录下，
      // /(^|[\/\\])\./ 会把整个目录都排除掉。glob 已限定 *.jsonl，无需额外 ignored
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: DEBOUNCE_MS,
        pollInterval: 100
      }
    });

    watcher
      .on('add', debounce(handleFileChange(source, 'add'), DEBOUNCE_MS))
      .on('change', debounce(handleFileChange(source, 'change'), DEBOUNCE_MS))
      .on('unlink', debounce(handleFileChange(source, 'unlink'), DEBOUNCE_MS));

    watchers.set(source, watcher);
  }

  console.log('✅ 文件监听已启动');
  for (const source of WATCHED_SOURCES) {
    console.log(`  - ${source}: ${SOURCE_PATHS[source]}`);
  }
  console.log('  - OpenCode: 手动同步（SQLite）');
}

/**
 * 处理文件变更
 */
function handleFileChange(source, event) {
  return async (filePath) => {
    console.log(`📁 [${source}] ${event}: ${filePath}`);
    
    if (onFileChangeCallback) {
      try {
        await onFileChangeCallback(source, event, filePath);
      } catch (error) {
        console.error(`❌ 处理文件变更失败: ${error.message}`);
      }
    }
  };
}

/**
 * 停止文件监听
 */
export async function stopWatching() {
  console.log('⏹️ 停止文件监听...');
  
  for (const [source, watcher] of watchers.entries()) {
    await watcher.close();
    console.log(`  - ${source} 已停止`);
  }
  
  watchers.clear();
  onFileChangeCallback = null;
  
  console.log('✅ 文件监听已停止');
}

/**
 * 获取监听状态
 */
export function getWatcherStatus() {
  const status = {};
  
  for (const [source, watcher] of watchers.entries()) {
    status[source] = {
      watching: true,
      path: SOURCE_PATHS[source]
    };
  }
  
  return status;
}
