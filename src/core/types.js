/**
 * AISessionLog - Standard Data Models
 * @see tech.md for full specification
 */

/**
 * @typedef {'claude_code' | 'codex_cli' | 'opencode' | 'codebuddy'} SourceType
 */

/**
 * @typedef {'complete' | 'partial' | 'corrupted' | 'source_missing'} SessionStatus
 */

/**
 * @typedef {'text' | 'code' | 'tool_use' | 'tool_result' | 'image'} ContentBlockType
 */

/**
 * @typedef {Object} ContentBlock
 * @property {ContentBlockType} type
 * @property {string} content - Full content, not truncated
 * @property {string} [language] - Language identifier for code blocks
 * @property {string} [toolName] - Tool name for tool_use blocks
 * @property {string} [toolUseId] - Call ID for matching tool_use with tool_result
 */

/**
 * @typedef {'user' | 'assistant' | 'system'} MessageRole
 */

/**
 * @typedef {'message' | 'tool_call' | 'tool_result' | 'summary'} EventType
 */

/**
 * @typedef {Object} StandardMessage
 * @property {string} id - Unique message ID
 * @property {MessageRole} role
 * @property {EventType} eventType
 * @property {string} renderedText - Plain text for search and Markdown display
 * @property {ContentBlock[]} contentBlocks - Structured content blocks
 * @property {unknown} rawContent - Original content in source format
 * @property {Date} timestamp
 * @property {number} [promptTokens]
 * @property {number} [completionTokens]
 */

/**
 * @typedef {Object} StandardSession
 * @property {string} id - Internal unique ID
 * @property {string} sourceId - Original tool session ID
 * @property {SourceType} source
 * @property {SessionStatus} status
 * @property {string} project - Project name extracted from path
 * @property {string} projectPath - Original project path
 * @property {string} [workingDir]
 * @property {string} [model] - Model name from rawMeta
 * @property {Date} createdAt
 * @property {Date} updatedAt
 * @property {Date} ingestedAt - AISessionLog write time
 * @property {StandardMessage[]} messages
 * @property {string} sourcePath - Original file absolute path
 * @property {string} parserVersion - Parser version
 * @property {string} contentHash - Original file content hash for incremental check
 * @property {string[]} parseWarnings - Parse warnings
 * @property {Record<string, unknown>} [rawMeta] - Original tool-specific metadata
 */

/**
 * @typedef {Object} AdapterInterface
 * @property {(filePath: string) => boolean} canHandle
 * @property {(filePath: string) => Promise<StandardSession[]>} parse
 * @property {SourceType} source
 * @property {string} version
 */

export const PARSER_VERSION = '0.1.0';
