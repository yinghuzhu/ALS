# ASL (AISessionLog)

**Version:** v0.1.0 "Spark"  
**Status:** v0.1 "Spark" Complete ✅

Local AI session log sync pipeline that transforms session records from Claude Code, Codex CLI, and OpenCode into standardized format for Obsidian output.

---

## 🎯 What It Does

ASL continuously monitors your local AI tool session files and converts them into:
- **Standardized format** - Unified data model across all tools
- **Searchable** - Full-text search ready
- **Observable** - Structured Markdown for Obsidian
- **Persistent** - Never deletes, even if source files are cleaned

---

## 📦 Project Structure

```
AISessionLog/
├── src/
│   ├── adapters/
│   │   ├── claude.js      # Claude Code JSONL parser ✅
│   │   ├── codex.js       # Codex CLI JSONL parser ✅
│   │   └── opencode.js    # OpenCode SQLite/JSON parser ✅
│   ├── core/
│   │   ├── types.js       # Standard data models ✅
│   │   ├── utils.js       # Utility functions ✅
│   │   ├── watcher.js     # File watcher (chokidar) ✅
│   │   └── scanner.js     # Scan & sync orchestrator ✅
│   ├── db/
│   │   └── state.js       # SQLite state storage (sql.js) ✅
│   ├── sink/
│   │   └── obsidian.js    # Obsidian Markdown output ✅
│   └── cli.js             # CLI entry point ✅
├── tests/
│   ├── claude.test.js     # Claude adapter tests ✅
│   ├── codex.test.js      # Codex adapter tests ✅
│   ├── opencode.test.js   # OpenCode adapter tests ✅
│   └── verify-adapters.js # Sample data verification ✅
├── samples/               # Test data
├── prd.md                 # Product requirements
├── tech.md                # Technical design
└── package.json
```

---

## 🚀 Quick Start

### Installation

```bash
cd /Users/yhzhu/workgroup/yzhu/AISessionLog
npm install
```

### Run Tests

```bash
# Run all tests
npm test

# Run tests once (no watch)
npm test -- --run

# Verify sample data parsing
node tests/verify-adapters.js
```

### Use CLI

```bash
# Make CLI executable
chmod +x src/cli.js

# Link globally (optional)
npm link

# Use CLI
asl status
asl --help
```

---

## ✅ Implementation Status

### Phase 1: Project Initialization ✅

- [x] npm init & dependency installation
- [x] Project structure created
- [x] Vitest configured

### Phase 2: Adapter Implementation ✅

- [x] **ClaudeCodeAdapter** - Parses `~/.claude/projects/*.jsonl`
  - Filters user/assistant messages
  - Extracts metadata (version, gitBranch)
  - Generates content hash
  - 4 sample files tested

- [x] **CodexAdapter** - Parses `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
  - Extracts session_meta for context
  - Filters response_item with user/assistant roles
  - Maps developer role to user
  - 3 sample files tested

- [x] **OpenCodeAdapter** - Parses SQLite (message + part 双表 JOIN) / JSON samples
  - SQLite 原生读取（逐 session prepared statement，避免全量加载）
  - part 表按 type 分类处理（text/reasoning/tool 保留，step-*/patch/file/compaction 跳过）
  - 20 sessions with 100+ messages tested

### Phase 3: Test Validation ✅

- [x] 27 unit tests (9 per adapter)
- [x] Sample data verification script
- [x] 100% sample data parse success rate

**Test Results:**
```
Test Files  3 passed (3)
Tests       27 passed (27)

Total Sessions:  27
Total Messages:  510
Errors:          0
```

### Phase 4: Integration ✅

- [x] **SQLite state storage** (`db/state.js`) - sql.js, sync_state/sessions/parse_errors 三张表
- [x] **Obsidian sink** (`sink/obsidian.js`) - Markdown 渲染、frontmatter、工具调用折叠、增量水位线
- [x] **File watcher** (`core/watcher.js`) - chokidar + 300ms 防抖
- [x] **Scanner** (`core/scanner.js`) - 统一扫描接口、增量同步、错误处理
- [x] **CLI commands** - pull, watch, sync, status, logs --errors

---

## 📊 Data Models

### StandardSession

```javascript
{
  id: string,              // Internal unique ID
  sourceId: string,        // Original tool session ID
  source: 'claude_code' | 'codex_cli' | 'opencode',
  status: 'complete' | 'partial' | 'corrupted',
  project: string,         // Project name from path
  projectPath: string,     // Full project path
  messages: StandardMessage[],
  createdAt: Date,
  updatedAt: Date,
  ingestedAt: Date,
  rawMeta: Object,         // Tool-specific metadata
  contentHash: string,     // For incremental sync
}
```

### StandardMessage

```javascript
{
  id: string,
  role: 'user' | 'assistant',
  eventType: 'message' | 'tool_call' | 'tool_result',
  renderedText: string,    // For search/display
  contentBlocks: ContentBlock[],
  rawContent: Object,      // Original format
  timestamp: Date,
}
```

---

## 🧪 Testing

### Unit Tests

Each adapter has comprehensive tests:
- `canHandle()` - Path validation
- `parse()` - File parsing
- Metadata extraction
- Message filtering
- Content block parsing

### Sample Data Verification

```bash
node tests/verify-adapters.js
```

Output:
```
✅ Claude Code: 4 sessions, 94 messages
✅ Codex CLI:   3 sessions, 316 messages
✅ OpenCode:    20 sessions, 100 messages (sampled)
```

---

## 📝 Usage Examples

### Parse Claude Code Session

```javascript
import { parseClaudeCodeFile } from './src/adapters/claude.js';

const sessions = parseClaudeCodeFile(
  '/Users/yzh/.claude/projects/-Users-work/project/abc123.jsonl'
);

console.log(sessions[0].messages.length); // Number of messages
```

### Parse Codex Session

```javascript
import { parseCodexFile } from './src/adapters/codex.js';

const sessions = parseCodexFile(
  '/Users/yzh/.codex/sessions/2026/03/03/rollout-abc.jsonl'
);

console.log(sessions[0].rawMeta.cliVersion); // "0.107.0-alpha.5"
```

### Parse OpenCode Sessions

```javascript
import { parseOpenCodeFromJson } from './src/adapters/opencode.js';

const sessions = parseOpenCodeFromJson(
  'samples/opencode/sessions_list.json',
  'samples/opencode/messages_sample.json'
);

console.log(sessions.length); // 20 sessions
```

---

## 🔧 Dependencies

- **chokidar** ^3.6.0 - File watching (for watch mode)
- **sql.js** ^1.10.3 - SQLite for OpenCode & state storage
- **commander** ^12.0.0 - CLI framework
- **vitest** ^1.3.0 - Testing framework

---

## 📋 Next Steps (v0.2 Recall)

1. **Local Web UI** - 基于 SQLiteSink，提供结构化搜索、对话阅读器、使用统计面板
2. **Semantic Search** - 本地 Embedding 实现语义检索
3. **Auto Summary** - 自动生成会话摘要
4. **Tag System** - 智能标签与重复问题检测
5. **OpenCode Native SQLite** - 替代 JSON 样本方案

---

## 📄 Documentation

- [`prd.md`](./prd.md) - Product Requirements Document
- [`tech.md`](./tech.md) - Technical Design Document
- [`TASK.md`](./TASK.md) - Development Task List

---

## 🎯 v0.1 Success Criteria

- ✅ Core adapters implemented and tested
- ✅ Sample data 100% parsable
- ✅ SQLite state storage
- ✅ Obsidian output
- ✅ Watch mode operational

---

**Built with ❤️ by yzh**  
**License:** ISC
