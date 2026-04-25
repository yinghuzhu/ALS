# ASL 项目开发任务

**任务编号**: ASL-001
**创建时间**: 2026-03-29 09:03
**执行人**: Claude Code
**指挥**: 墨斗 (Modou)

---

## 📋 项目背景

**ASL (AISessionLog)** 是一个本地 AI 会话日志同步管道，将分散在 Claude Code、Codex CLI、OpenCode 中的会话记录转换为标准化格式，输出到 Obsidian。

**当前状态**:
- ✅ 数据格式已验证（三种工具）
- ✅ 样本数据已准备（samples/ 目录）
- ✅ 设计文档已完成（prd.md, tech.md）
- ⏳ **待实现**: 三个 Adapter 解析逻辑

---

## 🎯 开发任务

### 第一阶段：项目初始化

```bash
cd /Users/yhzhu/workgroup/yzhu/AISessionLog

# 1. 初始化 Node.js 项目
npm init -y

# 2. 安装依赖
npm install chokidar better-sqlite3 commander
npm install -D vitest @types/node

# 3. 创建项目结构
mkdir -p src/{adapters,core,db,sink} tests samples
```

**package.json 配置**:
```json
{
  "name": "asl",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "asl": "./src/cli.js"
  },
  "scripts": {
    "test": "vitest"
  }
}
```

---

### 第二阶段：实现 Adapter（核心）

#### 2.1 ClaudeCodeAdapter (优先级：高)

**输入**: `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`
**输出**: `StandardSession[]`

**解析逻辑**:
1. 读取 JSONL 文件
2. 过滤 `type === "user" or "assistant"` 的记录
3. 提取字段：sessionId, cwd, uuid, message, timestamp
4. 映射到 StandardSession 模型

**测试样本**: `samples/claude_code/*.jsonl` (4 个文件)

---

#### 2.2 CodexAdapter (优先级：中)

**输入**: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
**输出**: `StandardSession[]`

**解析逻辑**:
1. 读取 JSONL 文件
2. 提取 `session_meta` 获取会话级元数据（cwd, model）
3. 过滤 `response_item` 且 `payload.role === "user"/"assistant"`
4. 映射到 StandardSession 模型

**测试样本**: `samples/codex/*.jsonl` (3 个文件)

---

#### 2.3 OpenCodeAdapter (优先级：低)

**输入**: `~/.local/share/opencode/opencode.db` (SQLite)
**输出**: `StandardSession[]`

**解析逻辑**:
1. 连接 SQLite 数据库
2. 查询 `session` 和 `message` 表（JOIN）
3. 解析 `data` 字段的 JSON
4. 映射到 StandardSession 模型

**测试样本**: `samples/opencode/*.json`

---

### 第三阶段：测试验证

```bash
# 运行单元测试
npm test

# 验证解析结果
node tests/verify-adapters.js
```

**验收标准**:
- 每个 Adapter 至少 3 个测试用例
- 样本数据 100% 可解析
- 无数据遗漏（user/assistant 消息完整）

---

### 第四阶段：完整流程（可选）

时间允许可实现：
1. SQLite 状态存储（db/state.js）
2. ObsidianSink（sink/obsidian.js）
3. CLI 命令（cli.js）

---

## 📁 交付物

```
AISessionLog/
├── src/
│   ├── adapters/
│   │   ├── claude.js
│   │   ├── codex.js
│   │   └── opencode.js
│   ├── core/
│   │   └── types.js
│   ├── db/
│   │   └── state.js
│   ├── sink/
│   │   └── obsidian.js
│   └── cli.js
├── tests/
│   ├── claude.test.js
│   ├── codex.test.js
│   └── opencode.test.js
├── samples/           # 已有
├── prd.md             # 已有
├── tech.md            # 已有
└── package.json
```

---

## 📊 进度报告

每完成一个阶段，向墨斗报告：
1. 完成内容
2. 测试结果
3. 遇到的问题
4. 下一步计划

---

## 🚀 开始命令

```bash
cd /Users/yhzhu/workgroup/yzhu/AISessionLog
claude
```

然后告诉 Claude Code："请按照 TASK.md 完成 ASL 项目开发，从第一阶段开始"

---

**记录时间**: 2026-03-29 09:03
**记录人**: 墨斗
