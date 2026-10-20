/**
 * WorkBuddyAdapter Tests
 */

import { describe, it, expect } from 'vitest';
import { parseWorkBuddyFile, canHandleWorkBuddy, WorkBuddyAdapter } from '../src/adapters/workbuddy.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_FILE = join(
  __dirname,
  '..',
  'samples',
  'workbuddy',
  '0f3c9a21-7b4d-4e58-9c33-1a2b3c4d5e6f.jsonl'
);

describe('WorkBuddyAdapter', () => {
  describe('canHandle', () => {
    it('should return true for WorkBuddy JSONL files', () => {
      expect(canHandleWorkBuddy('/Users/test/.workbuddy/projects/demo/abc.jsonl')).toBe(true);
    });

    it('should return false for CodeBuddy files', () => {
      expect(canHandleWorkBuddy('/Users/test/.codebuddy/projects/demo/abc.jsonl')).toBe(false);
    });

    it('should return false for non-JSONL files', () => {
      expect(canHandleWorkBuddy('/Users/test/.workbuddy/projects/demo/abc.txt')).toBe(false);
    });
  });

  describe('parse', () => {
    it('should parse a WorkBuddy session file', () => {
      const sessions = parseWorkBuddyFile(SAMPLE_FILE);

      expect(sessions).toHaveLength(1);
      const session = sessions[0];

      expect(session.source).toBe('workbuddy');
      expect(session.sourceId).toBe('0f3c9a21-7b4d-4e58-9c33-1a2b3c4d5e6f');
      expect(session.project).toBe('2026-10-02-10-15-00');
      expect(session.projectPath).toBe('/Users/test/WorkBuddy/2026-10-02-10-15-00');
      expect(session.model).toBe('glm-5.3');
    });

    it('should drop CLI noise messages', () => {
      const session = parseWorkBuddyFile(SAMPLE_FILE)[0];

      expect(session.messages.length).toBeGreaterThan(0);
      for (const message of session.messages) {
        expect(message.renderedText).not.toContain('system-reminder');
      }
    });

    it('should map input_image blocks to image blocks', () => {
      const session = parseWorkBuddyFile(SAMPLE_FILE)[0];
      const withImage = session.messages.find(
        m => m.contentBlocks.some(b => b.type === 'image')
      );

      const imageBlock = withImage.contentBlocks.find(b => b.type === 'image');
      expect(imageBlock.content).toContain('blobs/26/');
      // 文本块仍然保留，且不会把 image 的 JSON 当作正文
      expect(withImage.renderedText).toContain('这张截图里的报错怎么修');
      expect(withImage.renderedText).not.toContain('blob_id');
    });

    it('should extract session metadata including credits', () => {
      const session = parseWorkBuddyFile(SAMPLE_FILE)[0];

      expect(session.rawMeta.hostKind).toBe('unopted');
      expect(session.rawMeta.aiTitle).toBe('修复端口占用并说明启动方式');
      expect(session.rawMeta.summary).toContain('截图');
      expect(session.rawMeta.credits).toBeCloseTo(5.71);
      expect(session.rawMeta.reasoningRecords).toBe(1);
      expect(session.rawMeta.tokens).toEqual({
        promptTokens: 4700,
        completionTokens: 420,
        totalTokens: 5120,
      });
    });

    it('should keep tool call and result linked by callId', () => {
      const session = parseWorkBuddyFile(SAMPLE_FILE)[0];
      const toolCall = session.messages.find(m => m.eventType === 'tool_call');
      const toolResult = session.messages.find(m => m.eventType === 'tool_result');

      expect(toolCall.contentBlocks[0].toolName).toBe('Read');
      expect(toolCall.contentBlocks[0].toolUseId).toBe('call_wb_001');
      expect(toolResult.contentBlocks[0].toolUseId).toBe('call_wb_001');
      expect(toolResult.contentBlocks[0].content).toContain('npm run dev');
    });

    it('should generate content hash and stable id', () => {
      const session = parseWorkBuddyFile(SAMPLE_FILE)[0];

      expect(session.contentHash).toHaveLength(16);
      expect(session.id).toMatch(/^workbuddy_0f3c9a21-.*_[0-9a-f]{8}$/);
      expect(session.parseWarnings).toEqual([]);
    });
  });

  describe('adapter interface', () => {
    it('should implement adapter interface', () => {
      expect(WorkBuddyAdapter.source).toBe('workbuddy');
      expect(WorkBuddyAdapter.version).toBeDefined();
      expect(typeof WorkBuddyAdapter.canHandle).toBe('function');
      expect(typeof WorkBuddyAdapter.parse).toBe('function');
    });
  });
});
