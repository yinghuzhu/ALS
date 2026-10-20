#!/usr/bin/env node
/**
 * Verify all adapters can parse sample data
 * Run: node tests/verify-adapters.js
 */

import { parseClaudeCodeFile } from '../src/adapters/claude.js';
import { parseCodexFile } from '../src/adapters/codex.js';
import { parseCodeBuddyFile } from '../src/adapters/codebuddy.js';
import { parseOpenCodeFromJson } from '../src/adapters/opencode.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const SAMPLES_DIR = join(ROOT_DIR, 'samples');

console.log('🔍 ASL Adapter Verification\n');
console.log('=' .repeat(50));

let totalSessions = 0;
let totalMessages = 0;
let errors = [];

// Test Claude Code samples
console.log('\n📁 Claude Code Samples:');
console.log('-'.repeat(50));
const claudeDir = join(SAMPLES_DIR, 'claude_code');
const claudeFiles = readdirSync(claudeDir).filter(f => f.endsWith('.jsonl'));

for (const file of claudeFiles) {
  try {
    const filePath = join(claudeDir, file);
    const sessions = parseClaudeCodeFile(filePath);
    
    if (sessions.length > 0) {
      const session = sessions[0];
      console.log(`  ✅ ${file}`);
      console.log(`     Session: ${session.sourceId.substring(0, 8)}...`);
      console.log(`     Project: ${session.project}`);
      console.log(`     Messages: ${session.messages.length}`);
      totalSessions++;
      totalMessages += session.messages.length;
    } else {
      console.log(`  ⚠️  ${file} - No sessions parsed`);
    }
  } catch (e) {
    console.log(`  ❌ ${file} - ${e.message}`);
    errors.push({ file, error: e.message });
  }
}

// Test Codex samples
console.log('\n📁 Codex Samples:');
console.log('-'.repeat(50));
const codexDir = join(SAMPLES_DIR, 'codex');
const codexFiles = readdirSync(codexDir).filter(f => f.endsWith('.jsonl'));

for (const file of codexFiles) {
  try {
    const filePath = join(codexDir, file);
    const sessions = parseCodexFile(filePath);
    
    if (sessions.length > 0) {
      const session = sessions[0];
      console.log(`  ✅ ${file.substring(0, 40)}...`);
      console.log(`     Session: ${session.sourceId.substring(0, 8)}...`);
      console.log(`     Project: ${session.project}`);
      console.log(`     Messages: ${session.messages.length}`);
      totalSessions++;
      totalMessages += session.messages.length;
    } else {
      console.log(`  ⚠️  ${file} - No sessions parsed`);
    }
  } catch (e) {
    console.log(`  ❌ ${file} - ${e.message}`);
    errors.push({ file, error: e.message });
  }
}

// Test CodeBuddy samples
console.log('\n📁 CodeBuddy Samples:');
console.log('-'.repeat(50));
const codebuddyDir = join(SAMPLES_DIR, 'codebuddy');
const codebuddyFiles = readdirSync(codebuddyDir).filter(f => f.endsWith('.jsonl'));

for (const file of codebuddyFiles) {
  try {
    const filePath = join(codebuddyDir, file);
    const sessions = parseCodeBuddyFile(filePath);

    if (sessions.length > 0) {
      const session = sessions[0];
      console.log(`  ✅ ${file.substring(0, 40)}...`);
      console.log(`     Session: ${session.sourceId.substring(0, 8)}...`);
      console.log(`     Project: ${session.project}`);
      console.log(`     Messages: ${session.messages.length}`);
      totalSessions++;
      totalMessages += session.messages.length;
    } else {
      // 只有 CLI 噪音（/model 切换等）的会话，解析为 0 个会话是预期行为
      console.log(`  ⏭️  ${file.substring(0, 40)}... - noise-only session, skipped`);
    }
  } catch (e) {
    console.log(`  ❌ ${file} - ${e.message}`);
    errors.push({ file, error: e.message });
  }
}

// Test OpenCode samples
console.log('\n📁 OpenCode Samples:');
console.log('-'.repeat(50));
const opencodeDir = join(SAMPLES_DIR, 'opencode');
const sessionsPath = join(opencodeDir, 'sessions_list.json');
const messagesPath = join(opencodeDir, 'messages_sample.json');

try {
  const sessions = parseOpenCodeFromJson(sessionsPath, messagesPath);
  console.log(`  ✅ sessions_list.json + messages_sample.json`);
  console.log(`     Sessions: ${sessions.length}`);
  
  let messagesWithSample = 0;
  sessions.forEach(session => {
    if (session.messages.length > 0) {
      messagesWithSample += session.messages.length;
    }
  });
  
  totalSessions += sessions.length;
  totalMessages += messagesWithSample;
  
  console.log(`     Messages (sampled): ${messagesWithSample}`);
} catch (e) {
  console.log(`  ❌ ${e.message}`);
  errors.push({ file: 'opencode', error: e.message });
}

// Summary
console.log('\n' + '='.repeat(50));
console.log('📊 Summary:');
console.log('-'.repeat(50));
console.log(`  Total Sessions: ${totalSessions}`);
console.log(`  Total Messages: ${totalMessages}`);
console.log(`  Errors: ${errors.length}`);

if (errors.length > 0) {
  console.log('\n❌ Errors:');
  errors.forEach(({ file, error }) => {
    console.log(`  - ${file}: ${error}`);
  });
  process.exit(1);
} else {
  console.log('\n✅ All sample data parsed successfully!');
  process.exit(0);
}
