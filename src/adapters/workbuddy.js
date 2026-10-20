/**
 * WorkBuddyAdapter - Parses WorkBuddy desktop JSONL session files
 * 与 CodeBuddy 结构相同（同一套 codebuddy.ai/* 元数据），差异仅在存档目录与 source 标识
 *
 * Input: ~/.workbuddy/projects/<encoded-cwd>/<sessionId>.jsonl
 *        ~/.workbuddy/projects/<encoded-cwd>/<sessionId>/subagents/agent-*.jsonl
 * Output: StandardSession[]
 */

import { parseSessionLogFile } from './sessionLog.js';

const WORKBUDDY_VERSION = '0.1.0';

/**
 * Parse a WorkBuddy JSONL file
 * @param {string} filePath - Absolute path to the JSONL file
 * @returns {import('../core/types.js').StandardSession[]}
 */
export function parseWorkBuddyFile(filePath) {
  return parseSessionLogFile(filePath, { source: 'workbuddy', idPrefix: 'workbuddy' });
}

/**
 * Check if a file path belongs to WorkBuddy
 * @param {string} filePath
 * @returns {boolean}
 */
export function canHandleWorkBuddy(filePath) {
  return filePath.endsWith('.jsonl') && filePath.includes('.workbuddy/projects');
}

/**
 * Adapter interface
 */
export const WorkBuddyAdapter = {
  source: 'workbuddy',
  version: WORKBUDDY_VERSION,

  canHandle(filePath) {
    return canHandleWorkBuddy(filePath);
  },

  async parse(filePath) {
    return parseWorkBuddyFile(filePath);
  },
};

export default WorkBuddyAdapter;
