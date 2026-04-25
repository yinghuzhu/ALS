/**
 * ASL 文件监听模块
 * 使用 chokidar 监听三个数据源的文件变更
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
  opencode: expandTilde('~/.local/share/opencode/') // SQLite 文件，不需要监听
};

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
  
  // Claude Code 监听
  const claudeWatcher = chokidar.watch(SOURCE_PATHS.claude_code, {
    ignored: /(^|[\/\\])\../, // 忽略隐藏文件
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: DEBOUNCE_MS,
      pollInterval: 100
    }
  });
  
  claudeWatcher
    .on('add', debounce(handleFileChange('claude_code', 'add'), DEBOUNCE_MS))
    .on('change', debounce(handleFileChange('claude_code', 'change'), DEBOUNCE_MS))
    .on('unlink', debounce(handleFileChange('claude_code', 'unlink'), DEBOUNCE_MS));
  
  watchers.set('claude_code', claudeWatcher);
  
  // Codex CLI 监听
  const codexWatcher = chokidar.watch(SOURCE_PATHS.codex, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: DEBOUNCE_MS,
      pollInterval: 100
    }
  });
  
  codexWatcher
    .on('add', debounce(handleFileChange('codex', 'add'), DEBOUNCE_MS))
    .on('change', debounce(handleFileChange('codex', 'change'), DEBOUNCE_MS))
    .on('unlink', debounce(handleFileChange('codex', 'unlink'), DEBOUNCE_MS));
  
  watchers.set('codex', codexWatcher);
  
  console.log('✅ 文件监听已启动');
  console.log('  - Claude Code: ~/.claude/projects/');
  console.log('  - Codex CLI: ~/.codex/sessions/');
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
