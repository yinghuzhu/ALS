/**
 * ClaudeCodeAdapter Tests
 */

import { describe, it, expect } from 'vitest';
import { parseClaudeCodeFile, canHandleClaudeCode, ClaudeCodeAdapter } from '../src/adapters/claude.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(__dirname, '..', 'samples', 'claude_code');

describe('ClaudeCodeAdapter', () => {
  describe('canHandle', () => {
    it('should return true for Claude Code JSONL files', () => {
      expect(canHandleClaudeCode('/Users/test/.claude/projects/-Users-test-project/abc123.jsonl')).toBe(true);
    });
    
    it('should return false for non-JSONL files', () => {
      expect(canHandleClaudeCode('/Users/test/.claude/projects/test.txt')).toBe(false);
    });
    
    it('should return false for non-Claude paths', () => {
      expect(canHandleClaudeCode('/Users/test/.codex/sessions/abc.jsonl')).toBe(false);
    });
  });
  
  describe('parse', () => {
    it('should parse a Claude Code session file', () => {
      const sessions = parseClaudeCodeFile(join(SAMPLES_DIR, '04ad8c8f-963d-4b85-8210-2c7ad70d697a.jsonl'));
      
      expect(sessions).toHaveLength(1);
      const session = sessions[0];
      
      expect(session.source).toBe('claude_code');
      expect(session.sourceId).toBe('04ad8c8f-963d-4b85-8210-2c7ad70d697a');
      expect(session.project).toBe('IAM');
      expect(session.projectPath).toContain('connexustravel/IAM');
      expect(session.status).toBe('complete');
      expect(session.messages.length).toBeGreaterThan(0);
    });
    
    it('should extract user and assistant messages only', () => {
      const sessions = parseClaudeCodeFile(join(SAMPLES_DIR, '04ad8c8f-963d-4b85-8210-2c7ad70d697a.jsonl'));
      const session = sessions[0];
      
      // All messages should be user or assistant
      session.messages.forEach(msg => {
        expect(['user', 'assistant']).toContain(msg.role);
      });
      
      // Should have filtered out file-history-snapshot, system, progress, etc.
      expect(session.messages.length).toBeLessThan(10); // Original file has more records
    });
    
    it('should extract metadata correctly', () => {
      const sessions = parseClaudeCodeFile(join(SAMPLES_DIR, '04ad8c8f-963d-4b85-8210-2c7ad70d697a.jsonl'));
      const session = sessions[0];
      
      expect(session.rawMeta).toBeDefined();
      expect(session.rawMeta.claudeVersion).toBe('2.1.63');
      expect(session.rawMeta.gitBranch).toBe('master');
    });
    
    it('should generate content hash', () => {
      const sessions = parseClaudeCodeFile(join(SAMPLES_DIR, '04ad8c8f-963d-4b85-8210-2c7ad70d697a.jsonl'));
      const session = sessions[0];
      
      expect(session.contentHash).toBeDefined();
      expect(session.contentHash.length).toBe(16);
    });
    
    it('should parse message content blocks', () => {
      const sessions = parseClaudeCodeFile(join(SAMPLES_DIR, '04ad8c8f-963d-4b85-8210-2c7ad70d697a.jsonl'));
      const session = sessions[0];
      
      const firstMessage = session.messages[0];
      expect(firstMessage).toBeDefined();
      expect(firstMessage.contentBlocks).toBeDefined();
      expect(firstMessage.renderedText).toBeDefined();
    });
  });
  
  describe('adapter interface', () => {
    it('should implement adapter interface', () => {
      expect(ClaudeCodeAdapter.source).toBe('claude_code');
      expect(ClaudeCodeAdapter.version).toBeDefined();
      expect(typeof ClaudeCodeAdapter.canHandle).toBe('function');
      expect(typeof ClaudeCodeAdapter.parse).toBe('function');
    });
  });
});
