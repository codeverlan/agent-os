import { createLogger } from '@/utils/logger.js';
import { PromptLoader } from './prompt-loader.js';
import { AgentDetector } from './agent-detector.js';
import path from 'path';

export interface CommandContext {
  command: string;
  args: string;
  workingDirectory: string;
  projectName: string;
  sessionId: string;
  userId?: string;
}

export interface ParsedCommand {
  command: string;
  subagentType: string;
  promptTemplate: string;
  variables: Record<string, any>;
}

export class CommandRouter {
  private logger = createLogger('command-router');
  private promptLoader: PromptLoader;
  private commandCache = new Map<string, any>();

  constructor(promptLoader: PromptLoader) {
    this.promptLoader = promptLoader;
    this.loadSlashCommands();
  }

  private async loadSlashCommands() {
    try {
      // Load both slash commands and specialized agents
      const commands = await this.promptLoader.loadPrompts();
      
      for (const [_, command] of commands) {
        if (command.metadata?.command) {
          this.commandCache.set(command.metadata.command, command);
          this.logger.info(`Loaded command: ${command.metadata.command} (${command.metadata.subagent_type || 'general-purpose'})`);
        }
      }
      
      // Also load specialized agents from Agent OS patterns
      await this.loadSpecializedAgents();
    } catch (error) {
      this.logger.error({ error }, 'Failed to load commands');
    }
  }

  private async loadSpecializedAgents() {
    try {
      const specializedPath = path.join(process.cwd(), 'agent-prompts', 'specialized');
      const loader = new PromptLoader(specializedPath);
      const agents = await loader.loadPrompts();
      
      for (const [_, agent] of agents) {
        if (agent.metadata?.command) {
          this.commandCache.set(agent.metadata.command, agent);
          this.logger.info(`Loaded specialized agent: ${agent.metadata.command}`);
        }
      }
    } catch (error) {
      this.logger.warn({ error }, 'No specialized agents found');
    }
  }

  async parseCommand(input: string, context: CommandContext): Promise<ParsedCommand | null> {
    // Extract command and arguments
    const match = input.match(/^(\/\w+)\s*(.*)?$/);
    if (!match) {
      return null;
    }

    const [, command, args = ''] = match;
    
    // Look up command in cache
    const commandPrompt = this.commandCache.get(command);
    if (!commandPrompt) {
      this.logger.warn(`Unknown command: ${command}`);
      return null;
    }

    // Prepare variables for template rendering
    const variables = this.prepareVariables(command || '', args, context, commandPrompt);

    // Render the prompt template
    const renderedPrompt = await this.promptLoader.renderPrompt(
      commandPrompt.content || '',
      variables
    );

    return {
      command: command || '',
      subagentType: this.determineSubagentType(commandPrompt),
      promptTemplate: renderedPrompt,
      variables
    };
  }

  private prepareVariables(
    command: string, 
    args: string, 
    context: CommandContext,
    _commandPrompt: any
  ): Record<string, any> {
    const baseVariables = {
      command,
      args,
      working_directory: context.workingDirectory,
      project_name: context.projectName,
      session_id: context.sessionId,
      user_id: context.userId,
      timestamp: new Date().toISOString()
    };

    // Command-specific variable preparation
    switch (command) {
      case '/add':
        return {
          ...baseVariables,
          file_paths: args.split(/\s+/).filter(Boolean)
        };
      
      case '/test':
        return {
          ...baseVariables,
          test_args: args,
          detail_level: args.includes('--verbose') ? 'verbose' : 'normal'
        };
      
      case '/architect':
        return {
          ...baseVariables,
          requirements: args,
          tech_stack: this.detectTechStack(context.workingDirectory),
          project_type: this.detectProjectType(context.workingDirectory)
        };
      
      case '/lint':
      case '/fix':
        return {
          ...baseVariables,
          target_files: args || '.',
          coding_standards: this.loadCodingStandards(context.workingDirectory)
        };
      
      case '/run':
        const [runCommand, ...runArgs] = args.split(/\s+/);
        return {
          ...baseVariables,
          command: runCommand,
          args: runArgs.join(' '),
          execution_context: 'user-requested'
        };
      
      case '/ask':
        return {
          ...baseVariables,
          question: args,
          detail_level: 'comprehensive',
          focus_area: this.inferFocusArea(args)
        };
      
      case '/diff':
        return {
          ...baseVariables,
          scope: args || 'all',
          time_range: 'current-session'
        };
      
      case '/undo':
        return {
          ...baseVariables,
          target: args || 'last',
          scope: this.parseUndoScope(args)
        };
      
      case '/meta':
        return {
          ...baseVariables,
          user_request: args,
          project_context: this.gatherProjectContext(context),
          available_subagents: ['general-purpose', 'quality-control-engineer', 'mcp-resource-manager']
        };
      
      default:
        return baseVariables;
    }
  }

  // Helper methods for context detection
  private detectTechStack(_workingDirectory: string): string {
    // In a real implementation, this would analyze package.json, requirements.txt, etc.
    return 'Node.js, TypeScript, React, PostgreSQL';
  }

  private detectProjectType(_workingDirectory: string): string {
    // Detect project type from file structure and config files
    return 'web-application';
  }

  private loadCodingStandards(_workingDirectory: string): string {
    // Load from .eslintrc, .prettierrc, etc.
    return 'ESLint + Prettier with TypeScript strict mode';
  }

  private inferFocusArea(question: string): string {
    const lowerQuestion = question.toLowerCase();
    if (lowerQuestion.includes('auth') || lowerQuestion.includes('security')) {
      return 'authentication-security';
    }
    if (lowerQuestion.includes('database') || lowerQuestion.includes('query')) {
      return 'database-data';
    }
    if (lowerQuestion.includes('api') || lowerQuestion.includes('endpoint')) {
      return 'api-integration';
    }
    return 'general';
  }

  private parseUndoScope(args: string): string {
    if (!args) return 'last-change';
    if (args.match(/^\d+$/)) return `last-${args}-changes`;
    if (args.includes('all')) return 'all-session-changes';
    return 'specific-files';
  }

  private gatherProjectContext(context: CommandContext): Record<string, any> {
    return {
      name: context.projectName,
      directory: context.workingDirectory,
      session: context.sessionId,
      // Additional context would be gathered from project files
    };
  }

  // Get list of available commands
  getAvailableCommands(): Array<{ command: string; description: string }> {
    const commands: Array<{ command: string; description: string }> = [];
    
    for (const [command, prompt] of this.commandCache) {
      commands.push({
        command,
        description: prompt.metadata?.description || 'No description'
      });
    }
    
    return commands.sort((a, b) => a.command.localeCompare(b.command));
  }

  // Check if a command exists
  hasCommand(command: string): boolean {
    return this.commandCache.has(command);
  }

  // Get command metadata
  getCommandMetadata(command: string): any {
    return this.commandCache.get(command)?.metadata || null;
  }

  // Determine appropriate subagent type based on Agent OS patterns
  private determineSubagentType(commandPrompt: any): string {
    // Check if this is a specialized agent with minimal tools
    const tools = commandPrompt.metadata?.tools || [];
    const isSpecialized = tools.length > 0 && tools.length <= 4;
    
    if (isSpecialized) {
      // Use general-purpose for specialized agents (they handle their own logic)
      return 'general-purpose';
    }
    
    // Otherwise use the metadata-specified type
    return commandPrompt.metadata?.subagent_type || 'general-purpose';
  }

  // Reload commands (useful for development)
  async reloadCommands() {
    this.commandCache.clear();
    await this.loadSlashCommands();
    this.logger.info('Commands reloaded');
  }
}

// Create singleton instance
let commandRouterInstance: CommandRouter | null = null;

export function getCommandRouter(promptLoader?: PromptLoader): CommandRouter {
  if (!commandRouterInstance && promptLoader) {
    commandRouterInstance = new CommandRouter(promptLoader);
  }
  
  if (!commandRouterInstance) {
    throw new Error('CommandRouter not initialized. Provide PromptLoader on first call.');
  }
  
  return commandRouterInstance;
}