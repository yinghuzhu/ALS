# AISessionLog PRD

版本：v0.1 "Spark" · 2026-03-29（数据格式已验证）

## 一、产品背景

### 用户是谁

AISessionLog 的目标用户是重度 AI 编程工具使用者，具体画像如下：每天使用 Claude Code、OpenAI Codex CLI、CodeBuddy、OpenCode 等终端 AI 工具超过 1 小时；同时使用 2 个及以上工具；已经在使用 Obsidian 或类似本地知识库工具；对"本地优先、数据可控、可迁移"有明确偏好；习惯把工程过程文档化。

这不是大众产品，是一个高密度、窄人群、强自用驱动的开发者基础设施工具。

### 核心痛点

开发者每天在 AI 编程工具中产生大量高价值对话——架构决策的推理过程、复杂 Bug 的根因链路、有效的 Prompt 模式、某次重构的完整上下文。这些内容分散在各工具的本地隐藏目录里，格式不统一，无法跨工具检索，部分工具（如 Claude Code）还会在 30 天后自动清理。

会话结束即"半丢失"。用户要回溯时，只能去翻隐藏的 JSONL 文件，体验极度不友好。

真正的需求不是"备份聊天记录"，而是四层叠加：复盘（为什么这样改架构）、检索（跨工具找同类问题）、沉淀（哪种 Prompt 模式重复奏效）、分析（项目维度的 AI 使用统计）。

### 产品定位

把分散在不同 AI 编程工具里的会话，变成可检索、可复盘、可沉淀的本地知识资产。

AISessionLog 是一个本地数据管道：持续、自动地将各工具的会话记录转换为标准化格式，输出到指定渲染层。v0.1 的渲染层是 Obsidian，但管道本身与展示层解耦，未来可对接任意工具。

## 二、v0.1 目标与成功指标

### 目标

验证核心假设：开发者愿意持续查看、搜索和复用这些会话输出。

### 成功指标

内测用户在安装后 2 周内，Obsidian 中的 AISessionLog 目录累计被打开超过 20 次；至少 3 位用户反馈"找到了之前找不到的信息"；没有用户因数据错误或文件损坏提出投诉。

### 非目标（v0.1 明确不做）

团队共享与协作功能；语义搜索与 AI 分析；隐私过滤与脱敏（在产品声明中告知风险，由用户自行管理）；删除同步（永不主动删除已同步内容）；Windows 平台支持（macOS 优先，Linux 次之）；图片附件的本地存储处理。

## 三、核心功能描述

### 3.1 数据采集

支持四个数据源的本地文件读取。工具会在首次运行时执行全量历史扫描，此后通过文件监听实现增量同步。

重要声明：AISessionLog 读取的是各工具在本地磁盘的落盘文件，属于实现细节而非公开稳定协议。各工具版本升级可能导致格式变化，工具会尽力兼容，但不承诺对所有历史版本的完整支持。部分场景（如远程执行、云端会话）的记录可能未落盘到本地，属于正常的数据缺失，不视为 Bug。

### 3.2 数据转换

将各工具的原始格式解析为内部标准数据模型，保留完整信息包括工具调用（tool_use / tool_result）的原始内容，不做截断。解析失败时记录警告并保留原始文件路径，不静默丢弃。

### 3.3 Obsidian 输出

将标准数据模型渲染为 Markdown 文件，写入用户指定的 Obsidian Vault 目录。

同步策略：单向同步，AISessionLog 对其管理目录拥有绝对控制权。用户在该目录下的手动修改在下次同步时会被覆盖。如需保留个人笔记，应在 Obsidian 中创建独立文件并通过双向链接引用，而不是直接修改生成文件。

删除策略：永不删除。即使源工具的原始文件已被清理，Obsidian 中的对应 Markdown 文件会保留，并在 frontmatter 中标记 source_missing: true。

已知局限：Obsidian 擅长全文检索和笔记间的双向链接，但对于动辄 50-200 条消息、穿插大量工具调用的 AI 会话，阅读体验不理想——长对话在 Markdown 中呈现为一堵文字墙，缺乏折叠、语法高亮、diff 视图等结构化展示能力。这是 v0.1 的已知取舍，数据管道与渲染层已解耦，后续 Web UI（v0.2）将从根本上解决长对话的阅读和交互体验问题。

### 3.4 CLI 操作

提供命令行界面，支持初始化配置、全量导入、实时监听、状态查看、手动同步五个核心命令。

## 四、风险与假设

### 已知风险

- **数据源格式不稳定**：四个工具均未公开稳定的本地存储协议，任何版本升级都可能导致 Adapter 失效。缓解措施是将每个工具的解析逻辑封装为独立模块，快速响应格式变化。
- **写缓冲区问题**：AI 工具在输出时可能高频追加 JSONL，频繁触发文件变更事件会导致 CPU 占用过高并频繁刷新 Obsidian 索引。需要在采集层实现防抖延迟写入机制。

### 已验证的数据格式（2026-03-29 详细核对）

**数据量统计**:

| 工具 | 会话数 | 总记录数 | 磁盘占用 | 平均每会话 |
|------|--------|----------|----------|-----------|
| **Claude Code** | 148 个文件 | 2,755 行 | 8.7 MB | ~19 行/会话 |
| **Codex CLI** | 47 个文件 | 42,571 行 | 91 MB | ~906 行/会话 |
| **OpenCode** | 332 个会话 | 36,238 条消息 | 768 MB | ~109 消息/会话 |
| **CodeBuddy** | 139 个文件（99 会话） | 21,321 行 | 84 MB | ~26 行/会话 |

**记录类型分布**:

| 工具 | 主要类型（必须保留） | 次要类型（可跳过/元数据） |
|------|---------------------|-------------------------|
| **Claude Code** | `user` (47%), `assistant` (32%) | `file-history-snapshot` (12%), `system` (7%), `progress`, `queue-operation`, `last-prompt` |
| **Codex CLI** | `response_item` (52%), `event_msg` (38%) | `session_meta` (1 条/会话), `turn_context` |
| **OpenCode** | `user`, `assistant` | `compaction` (自动摘要) |
| **CodeBuddy** | `message` (user/assistant), `function_call`, `function_call_result` | `reasoning`, `file-history-snapshot` (6%), `session-meta`, `ai-title`, `summary`, `turn-metrics`, `model-usage` |

**存储路径**:

| 工具 | 路径 | 样本文件 |
|------|------|----------|
| **Claude Code** | `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` | `samples/claude_code/*.jsonl` (4 个文件) |
| **Codex CLI** | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `samples/codex/*.jsonl` (3 个文件) |
| **OpenCode** | `~/.local/share/opencode/opencode.db` | `samples/opencode/sessions_list.json` (20 个会话) |
| **CodeBuddy** | `~/.codebuddy/projects/<encoded-cwd>/<sessionId>.jsonl` | `samples/codebuddy/*.jsonl` (2 个文件) |

### 隐私声明（产品层面告知）

AISessionLog 是纯本地工具，不上传任何数据。但用户的 AI 编程会话中可能包含 API Key、环境变量、私有代码、内网地址等敏感信息。若用户的 Obsidian Vault 开启了 iCloud、Obsidian Sync 或 Git 同步，这些内容会随之上传到云端。v0.1 不提供自动脱敏功能，用户需自行评估风险。建议用户为 AISessionLog 目录单独配置同步排除规则。

## 五、版本规划

v0.1 Spark 完成后，v0.2 Recall 计划引入本地 Web UI（基于 SQLiteSink，提供结构化搜索、对话阅读器、使用统计面板，解决 Obsidian 渲染长对话的体验局限）、语义搜索（本地 Embedding）、自动摘要、标签系统、重复问题检测，以及对 Codex 和 OpenCode Adapter 的稳定化。v1.0 Atlas 计划引入团队共享库、权限管理、使用分析面板。
