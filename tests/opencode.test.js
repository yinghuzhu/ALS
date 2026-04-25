/**
 * OpenCodeAdapter Tests
 */

import { describe, it, expect } from 'vitest';
import { parseOpenCodeFromJson, canHandleOpenCode, OpenCodeAdapter } from '../src/adapters/opencode.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(__dirname, '..', 'samples', 'opencode');

describe('OpenCodeAdapter', () => {
  describe('canHandle', () => {
    it('should return true for OpenCode database files', () => {
      expect(canHandleOpenCode('/Users/test/.local/share/opencode/opencode.db')).toBe(true);
    });
    
    it('should return true for OpenCode JSON files', () => {
      expect(canHandleOpenCode('/Users/test/samples/opencode/sessions_list.json')).toBe(true);
    });
    
    it('should return false for non-OpenCode files', () => {
      expect(canHandleOpenCode('/Users/test/.claude/projects/abc.jsonl')).toBe(false);
    });
  });
  
  describe('parseOpenCodeFromJson', () => {
    it('should parse OpenCode session list', () => {
      const sessionsPath = join(SAMPLES_DIR, 'sessions_list.json');
      const sessions = parseOpenCodeFromJson(sessionsPath);
      
      expect(sessions.length).toBeGreaterThan(0);
      const firstSession = sessions[0];
      
      expect(firstSession.source).toBe('opencode');
      expect(firstSession.sourceId).toBeDefined();
      expect(firstSession.project).toBeDefined();
      expect(firstSession.projectPath).toBeDefined();
      expect(firstSession.status).toBe('complete');
    });
    
    it('should parse sessions with messages', () => {
      const sessionsPath = join(SAMPLES_DIR, 'sessions_list.json');
      const messagesPath = join(SAMPLES_DIR, 'messages_sample.json');
      const sessions = parseOpenCodeFromJson(sessionsPath, messagesPath);
      
      expect(sessions.length).toBeGreaterThan(0);
      
      // Find the session with messages
      const sessionWithMessages = sessions.find(s => s.messages.length > 0);
      expect(sessionWithMessages).toBeDefined();
      
      // Verify message structure
      sessionWithMessages.messages.forEach(msg => {
        expect(['user', 'assistant']).toContain(msg.role);
        expect(msg.id).toBeDefined();
        expect(msg.timestamp).toBeDefined();
      });
    });
    
    it('should extract session metadata', () => {
      const sessionsPath = join(SAMPLES_DIR, 'sessions_list.json');
      const sessions = parseOpenCodeFromJson(sessionsPath);
      
      const firstSession = sessions[0];
      expect(firstSession.rawMeta).toBeDefined();
      expect(firstSession.rawMeta.slug).toBeDefined();
      expect(firstSession.rawMeta.title).toBeDefined();
    });
    
    it('should generate content hash', () => {
      const sessionsPath = join(SAMPLES_DIR, 'sessions_list.json');
      const sessions = parseOpenCodeFromJson(sessionsPath);
      
      const firstSession = sessions[0];
      expect(firstSession.contentHash).toBeDefined();
      expect(firstSession.contentHash.length).toBe(16);
    });
    
    it('should extract project from directory path', () => {
      const sessionsPath = join(SAMPLES_DIR, 'sessions_list.json');
      const sessions = parseOpenCodeFromJson(sessionsPath);
      
      const firstSession = sessions[0];
      expect(firstSession.project).toBe('espocrm'); // From /Users/yhzhu/workgroup/connexustravel/espocrm/espocrm
    });
  });
  
  describe('adapter interface', () => {
    it('should implement adapter interface', () => {
      expect(OpenCodeAdapter.source).toBe('opencode');
      expect(OpenCodeAdapter.version).toBeDefined();
      expect(typeof OpenCodeAdapter.canHandle).toBe('function');
      expect(typeof OpenCodeAdapter.parse).toBe('function');
    });
  });
});
