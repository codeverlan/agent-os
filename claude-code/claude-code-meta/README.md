# Claude Code META Integration

This directory contains the Claude Code META implementation that extends Agent OS patterns for healthcare operations.

## Overview

Claude Code META is a HIPAA-compliant agent orchestration platform that uses Agent OS patterns to provide intelligent workflow automation for healthcare organizations.

## Key Components

### Agent Router System
- `command-router.ts` - Routes slash commands to appropriate Claude Code sub-agents
- `prompt-loader.ts` - Loads and manages agent prompt templates
- `agent-detector.ts` - Detects which specialized agent should handle requests

### Specialized Agents
Following Agent OS patterns, we've created specialized agents with minimal tool sets:

1. **Test Runner Agent** (`/test`)
   - Tools: Bash, Read, Grep, Glob
   - Executes and analyzes test results

2. **Context Fetcher Agent** (`/context`)
   - Tools: Read, Glob, Grep, LS
   - Gathers project context and information

3. **Git Workflow Agent** (`/git`)
   - Tools: Bash, Read, Grep, Glob
   - Handles version control operations

4. **File Creator Agent** (`/create`)
   - Tools: Write, Read, LS, Bash
   - Creates files and directory structures

## Integration with Claude Code

This system integrates with Claude Code's native sub-agents:
- `general-purpose` - Handles specialized agent requests
- `quality-control-engineer` - Testing and code quality
- `mcp-resource-manager` - External resource management

## Usage

```typescript
// Initialize the command router
const promptLoader = new PromptLoader('./agent-prompts');
const router = getCommandRouter(promptLoader);

// Parse a slash command
const parsed = await router.parseCommand('/test unit', {
  command: '/test',
  args: 'unit',
  workingDirectory: process.cwd(),
  projectName: 'My Project',
  sessionId: 'session-123'
});

// Execute via Claude Code Task tool
if (parsed) {
  // Use Claude Code's Task tool with the parsed command
  await executeWithClaudeCode(parsed);
}
```

## Contributing

When adding new specialized agents:
1. Follow Agent OS pattern of minimal tool sets (≤4 tools)
2. Create focused agents with single responsibilities
3. Add agent detection patterns to `agent-detector.ts`
4. Document the agent's purpose and tools