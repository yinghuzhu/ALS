/**
 * CodexAdapter Tests
 */

import { describe, it, expect } from 'vitest';
import { parseCodexFile, canHandleCodex, CodexAdapter } from '../src/adapters/codex.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(__dirname, '..', 'samples', 'codex');

describe('CodexAdapter', () => {
  describe('canHandle', () => {
    it('should return true for Codex JSONL files', () => {
      expect(canHandleCodex('/Users/test/.codex/sessions/2026/03/03/rollout-abc123.jsonl')).toBe(true);
    });
    
    it('should return false for non-JSONL files', () => {
      expect(canHandleCodex('/Users/test/.codex/sessions/test.txt')).toBe(false);
    });
    
    it('should return false for non-Codex paths', () => {
      expect(canHandleCodex('/Users/test/.claude/projects/abc.jsonl')).toBe(false);
    });
  });
  
  describe('parse', () => {
    it('should parse a Codex session file', () => {
      const sessions = parseCodexFile(join(SAMPLES_DIR, 'rollout-2026-03-03T02-10-29-019cafbe-98d7-7b71-9589-fda8fe862123.jsonl'));
      
      expect(sessions).toHaveLength(1);
      const session = sessions[0];
      
      expect(session.source).toBe('codex_cli');
      expect(session.sourceId).toBe('019cafbe-98d7-7b71-9589-fda8fe862123');
      expect(session.project).toBe('New project');
      expect(session.projectPath).toContain('Documents/New project');
      expect(session.status).toBe('complete');
      expect(session.messages.length).toBeGreaterThan(0);
    });
    
    it('should extract session metadata', () => {
      const sessions = parseCodexFile(join(SAMPLES_DIR, 'rollout-2026-03-03T02-10-29-019cafbe-98d7-7b71-9589-fda8fe862123.jsonl'));
      const session = sessions[0];
      
      expect(session.rawMeta).toBeDefined();
      expect(session.rawMeta.cliVersion).toBe('0.107.0-alpha.5');
      expect(session.rawMeta.originator).toBe('Codex Desktop');
      expect(session.rawMeta.modelProvider).toBe('openai');
    });
    
    it('should extract user and assistant messages', () => {
      const sessions = parseCodexFile(join(SAMPLES_DIR, 'rollout-2026-03-03T02-10-29-019cafbe-98d7-7b71-9589-fda8fe862123.jsonl'));
      const session = sessions[0];
      
      // All messages should be user or assistant (developer mapped to user)
      session.messages.forEach(msg => {
        expect(['user', 'assistant']).toContain(msg.role);
      });
    });
    
    it('should generate content hash', () => {
      const sessions = parseCodexFile(join(SAMPLES_DIR, 'rollout-2026-03-03T02-10-29-019cafbe-98d7-7b71-9589-fda8fe862123.jsonl'));
      const session = sessions[0];
      
      expect(session.contentHash).toBeDefined();
      expect(session.contentHash.length).toBe(16);
    });
    
    it('should parse message content blocks', () => {
      const sessions = parseCodexFile(join(SAMPLES_DIR, 'rollout-2026-03-03T02-10-29-019cafbe-98d7-7b71-9589-fda8fe862123.jsonl'));
      const session = sessions[0];
      
      const firstMessage = session.messages[0];
      expect(firstMessage).toBeDefined();
      expect(firstMessage.contentBlocks).toBeDefined();
      expect(firstMessage.renderedText).toBeDefined();
    });
  });
  
  describe('adapter interface', () => {
    it('should implement adapter interface', () => {
      expect(CodexAdapter.source).toBe('codex_cli');
      expect(CodexAdapter.version).toBeDefined();
      expect(typeof CodexAdapter.canHandle).toBe('function');
      expect(typeof CodexAdapter.parse).toBe('function');
    });
  });
});
