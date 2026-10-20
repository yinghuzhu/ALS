/**
 * CodeBuddyAdapter Tests
 */

import { describe, it, expect } from 'vitest';
import { parseCodeBuddyFile, canHandleCodeBuddy, CodeBuddyAdapter } from '../src/adapters/codebuddy.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(__dirname, '..', 'samples', 'codebuddy');
const SAMPLE_FILE = join(SAMPLES_DIR, '01a1f2b3-4c5d-6e7f-8a9b-0c1d2e3f4a5b.jsonl');
// 只包含 CLI 噪音（/model 切换、本地命令回显）的会话
const NOISE_ONLY_FILE = join(SAMPLES_DIR, '01a1f2b3-5d6e-7f80-9a0b-1c2d3e4f5a6b.jsonl');

describe('CodeBuddyAdapter', () => {
  describe('canHandle', () => {
    it('should return true for CodeBuddy JSONL files', () => {
      expect(canHandleCodeBuddy('/Users/test/.codebuddy/projects/demo/abc.jsonl')).toBe(true);
    });

    it('should return false for non-JSONL files', () => {
      expect(canHandleCodeBuddy('/Users/test/.codebuddy/projects/demo/abc.txt')).toBe(false);
    });

    it('should return false for other tools', () => {
      expect(canHandleCodeBuddy('/Users/test/.claude/projects/abc.jsonl')).toBe(false);
    });
  });

  describe('parse', () => {
    it('should parse a CodeBuddy session file', () => {
      const sessions = parseCodeBuddyFile(SAMPLE_FILE);

      expect(sessions).toHaveLength(1);
      const session = sessions[0];

      expect(session.source).toBe('codebuddy');
      expect(session.sourceId).toBe('01a1f2b3-4c5d-6e7f-8a9b-0c1d2e3f4a5b');
      expect(session.project).toBe('demo-notes');
      expect(session.projectPath).toBe('/Users/test/projects/demo-notes');
      expect(session.status).toBe('complete');
      expect(session.model).toBe('deepseek-v4.1-flash');
    });

    it('should drop CLI noise messages', () => {
      const session = parseCodeBuddyFile(SAMPLE_FILE)[0];

      for (const message of session.messages) {
        expect(message.renderedText).not.toContain('system-reminder');
        expect(message.renderedText).not.toContain('<command-name>');
      }

      // 第一条保留的消息应是真实用户输入
      const firstUser = session.messages.find(m => m.role === 'user');
      expect(firstUser.renderedText).toContain('补一个 README');
    });

    it('should extract session metadata', () => {
      const session = parseCodeBuddyFile(SAMPLE_FILE)[0];

      expect(session.rawMeta.agent).toBe('ptc');
      expect(session.rawMeta.aiTitle).toBe('为 demo-notes 补 README');
      expect(session.rawMeta.summary).toContain('补一个 README');
      expect(session.rawMeta.turns).toBe(1);
      expect(session.rawMeta.durationMs).toBe(8500);
      expect(session.rawMeta.reasoningRecords).toBe(1);
      expect(session.rawMeta.tokens).toEqual({
        promptTokens: 3000,
        completionTokens: 500,
        totalTokens: 3500,
      });
    });

    it('should convert function_call into tool_use blocks', () => {
      const session = parseCodeBuddyFile(SAMPLE_FILE)[0];
      const toolCall = session.messages.find(m => m.eventType === 'tool_call');

      expect(toolCall.role).toBe('assistant');
      expect(toolCall.contentBlocks[0].type).toBe('tool_use');
      expect(toolCall.contentBlocks[0].toolName).toBe('Read');
      expect(toolCall.contentBlocks[0].toolUseId).toBe('call_001');
      expect(toolCall.contentBlocks[0].content).toContain('package.json');
    });

    it('should convert function_call_result into tool_result blocks', () => {
      const session = parseCodeBuddyFile(SAMPLE_FILE)[0];
      const toolResult = session.messages.find(
        m => m.eventType === 'tool_result' && m.contentBlocks[0].toolUseId === 'call_001'
      );

      expect(toolResult.contentBlocks[0].type).toBe('tool_result');
      expect(toolResult.contentBlocks[0].content).toContain('demo-notes');
    });

    it('should keep the last record when a function_call is written incrementally', () => {
      const session = parseCodeBuddyFile(SAMPLE_FILE)[0];
      const calls = session.messages.filter(
        m => m.eventType === 'tool_call' && m.contentBlocks[0].toolUseId === 'call_002'
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].contentBlocks[0].content).toBe('{"command":"npm test"}');
    });

    it('should derive timestamps from millisecond values', () => {
      const session = parseCodeBuddyFile(SAMPLE_FILE)[0];

      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.createdAt.getTime()).toBe(1792491547840);
      expect(session.updatedAt.getTime()).toBeGreaterThan(session.createdAt.getTime());
    });

    it('should skip sessions that contain only CLI noise', () => {
      expect(parseCodeBuddyFile(NOISE_ONLY_FILE)).toEqual([]);
    });

    it('should generate content hash and stable id', () => {
      const session = parseCodeBuddyFile(SAMPLE_FILE)[0];

      expect(session.contentHash).toHaveLength(16);
      expect(session.id).toMatch(/^codebuddy_01a1f2b3-.*_[0-9a-f]{8}$/);
      expect(session.parserVersion).toBeDefined();
      expect(session.parseWarnings).toEqual([]);
    });
  });

  describe('adapter interface', () => {
    it('should implement adapter interface', () => {
      expect(CodeBuddyAdapter.source).toBe('codebuddy');
      expect(CodeBuddyAdapter.version).toBeDefined();
      expect(typeof CodeBuddyAdapter.canHandle).toBe('function');
      expect(typeof CodeBuddyAdapter.parse).toBe('function');
    });
  });
});
