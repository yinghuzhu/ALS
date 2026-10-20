/**
 * CodeBuddyAdapter - Parses CodeBuddy Code JSONL session files
 * 记录格式与解析细节见 src/adapters/sessionLog.js
 *
 * Input: ~/.codebuddy/projects/<encoded-cwd>/<sessionId>.jsonl
 * Output: StandardSession[]
 */

import { parseSessionLogFile } from './sessionLog.js';

const CODEBUDDY_VERSION = '0.1.0';

/**
 * Parse a CodeBuddy JSONL file
 * @param {string} filePath - Absolute path to the JSONL file
 * @returns {import('../core/types.js').StandardSession[]}
 */
export function parseCodeBuddyFile(filePath) {
  return parseSessionLogFile(filePath, { source: 'codebuddy', idPrefix: 'codebuddy' });
}

/**
 * Check if a file path belongs to CodeBuddy
 * @param {string} filePath
 * @returns {boolean}
 */
export function canHandleCodeBuddy(filePath) {
  return filePath.endsWith('.jsonl') && filePath.includes('.codebuddy/projects');
}

/**
 * Adapter interface
 */
export const CodeBuddyAdapter = {
  source: 'codebuddy',
  version: CODEBUDDY_VERSION,

  canHandle(filePath) {
    return canHandleCodeBuddy(filePath);
  },

  async parse(filePath) {
    return parseCodeBuddyFile(filePath);
  },
};

export default CodeBuddyAdapter;
