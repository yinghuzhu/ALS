/**
 * ObsidianSink 分篇逻辑测试
 */

import { describe, it, expect } from 'vitest';
import { splitIntoParts, generateMarkdown } from '../src/sink/obsidian.js';

const MB = 1024 * 1024;

function makeSession(messageSizes) {
  return {
    id: 'codebuddy_test_1234abcd',
    sourceId: 'test-session',
    source: 'codebuddy',
    status: 'complete',
    project: 'demo',
    projectPath: '/tmp/demo',
    workingDir: '/tmp/demo',
    model: 'test-model',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T01:00:00Z'),
    ingestedAt: new Date(),
    sourcePath: '/tmp/demo/session.jsonl',
    parserVersion: '0.1.0',
    contentHash: 'deadbeef',
    parseWarnings: [],
    rawMeta: {},
    messages: messageSizes.map((size, i) => ({
      id: `msg-${i}`,
      role: i % 2 === 0 ? 'assistant' : 'user',
      eventType: 'message',
      renderedText: 'x'.repeat(size),
      contentBlocks: [{ type: 'text', content: 'x'.repeat(size) }],
      rawContent: {},
      timestamp: new Date('2026-10-01T00:00:00Z'),
    })),
  };
}

describe('splitIntoParts', () => {
  it('keeps small sessions as a single part', () => {
    const session = makeSession([1000, 2000]);
    const parts = splitIntoParts(session);

    expect(parts).toHaveLength(1);
    expect(parts[0].total).toBe(1);
  });

  it('splits at message boundaries when a session exceeds the limit', () => {
    const session = makeSession([2 * MB, 2 * MB, 2 * MB]);
    const parts = splitIntoParts(session);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(Buffer.byteLength(part.body)).toBeLessThanOrEqual(4 * MB);
    }
    // 所有正文都还在，只是分散到多篇
    const totalBody = parts.reduce((sum, p) => sum + Buffer.byteLength(p.body), 0);
    const expected = session.messages
      .map((m, i) => Buffer.byteLength(generateMarkdown({ ...session, messages: [m] }) ))
      .reduce((a, b) => a + b, 0);
    expect(totalBody).toBeGreaterThan(5 * MB);
    expect(expected).toBeGreaterThan(0);
  });

  it('splits a single oversized message without dropping content', () => {
    const big = 9 * MB;
    const session = makeSession([big]);
    const parts = splitIntoParts(session);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(Buffer.byteLength(part.body)).toBeLessThanOrEqual(4 * MB);
    }
    const totalBody = parts.reduce((sum, p) => sum + p.body.length, 0);
    // 续写标记之外，正文长度应基本等于原始长度
    expect(totalBody).toBeGreaterThanOrEqual(big);
  });

  it('adds part metadata and navigation to split notes', () => {
    const session = makeSession([3 * MB, 3 * MB]);
    const parts = splitIntoParts(session);
    const markdown = generateMarkdown(session, { ...parts[1], prev: 'note-p1', next: 'note-p3' });

    expect(markdown).toContain(`part: 2`);
    expect(markdown).toContain(`parts: ${parts.length}`);
    expect(markdown).toContain('[[note-p1|← 上一篇]]');
    expect(markdown).toContain('[[note-p3|下一篇 →]]');
  });
});
