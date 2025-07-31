import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import { createLogger } from '@/utils/logger.js';
import Handlebars from 'handlebars';

const logger = createLogger('prompt-loader');

export interface AgentPromptMetadata {
  agent_type: string;
  name: string;
  version: string;
  persistence: 'ephemeral' | 'session' | 'persistent' | 'permanent';
  capabilities: string[];
  color: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

export interface AgentPrompt {
  metadata: AgentPromptMetadata;
  content: string;
  template: HandlebarsTemplateDelegate<any>;
}

export class PromptLoader {
  private prompts: Map<string, AgentPrompt> = new Map();
  private promptsPath: string;
  private fileWatchers: Map<string, fs.FSWatcher> = new Map();

  constructor(promptsPath?: string) {
    this.promptsPath = promptsPath || path.join(process.cwd(), 'agent-prompts');
  }

  async initialize(): Promise<void> {
    logger.info('Initializing prompt loader');
    
    // Load all prompts
    await this.loadAllPrompts();
    
    // Watch for changes in development
    if (process.env.NODE_ENV !== 'production') {
      await this.setupFileWatchers();
    }
  }

  private async loadAllPrompts(): Promise<void> {
    const directories = ['meta', 'templates', 'custom'];
    
    for (const dir of directories) {
      const dirPath = path.join(this.promptsPath, dir);
      
      try {
        const files = await fs.readdir(dirPath);
        
        for (const file of files) {
          if (file.endsWith('.md')) {
            await this.loadPrompt(path.join(dirPath, file));
          }
        }
      } catch (error) {
        logger.warn({ error, dir }, 'Failed to read prompt directory');
      }
    }
    
    logger.info({ count: this.prompts.size }, 'Loaded agent prompts');
  }

  private async loadPrompt(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const { data, content: promptContent } = matter(content);
      
      const metadata = data as AgentPromptMetadata;
      const template = Handlebars.compile(promptContent);
      
      const prompt: AgentPrompt = {
        metadata,
        content: promptContent,
        template
      };
      
      this.prompts.set(metadata.agent_type, prompt);
      
      logger.info({ 
        agent_type: metadata.agent_type,
        name: metadata.name,
        version: metadata.version
      }, 'Loaded agent prompt');
      
    } catch (error) {
      logger.error({ error, filePath }, 'Failed to load prompt');
    }
  }

  private async setupFileWatchers(): Promise<void> {
    const directories = ['meta', 'templates', 'custom'];
    
    for (const dir of directories) {
      const dirPath = path.join(this.promptsPath, dir);
      
      try {
        const watcher = fs.watch(dirPath);
        
        watcher.on('change', async (eventType, filename) => {
          if (filename && filename.endsWith('.md')) {
            logger.info({ filename, eventType }, 'Prompt file changed');
            await this.loadPrompt(path.join(dirPath, filename));
          }
        });
        
        this.fileWatchers.set(dir, watcher);
      } catch (error) {
        logger.warn({ error, dir }, 'Failed to setup file watcher');
      }
    }
  }

  /**
   * Get a prompt by agent type
   */
  getPrompt(agentType: string): AgentPrompt | undefined {
    return this.prompts.get(agentType);
  }

  /**
   * Get all available prompts
   */
  getAllPrompts(): Map<string, AgentPrompt> {
    return new Map(this.prompts);
  }

  /**
   * Render a prompt with context variables
   */
  renderPrompt(agentType: string, context: Record<string, any>): string {
    const prompt = this.prompts.get(agentType);
    
    if (!prompt) {
      throw new Error(`No prompt found for agent type: ${agentType}`);
    }
    
    // Add default context
    const fullContext = {
      timestamp: new Date().toISOString(),
      ...context
    };
    
    return prompt.template(fullContext);
  }

  /**
   * Create or update a custom prompt
   */
  async saveCustomPrompt(
    agentType: string, 
    metadata: AgentPromptMetadata, 
    content: string
  ): Promise<void> {
    const customPath = path.join(this.promptsPath, 'custom', `${agentType}.md`);
    
    // Create frontmatter
    const frontmatter = matter.stringify(content, metadata);
    
    // Ensure directory exists
    await fs.mkdir(path.dirname(customPath), { recursive: true });
    
    // Write file
    await fs.writeFile(customPath, frontmatter);
    
    // Reload prompt
    await this.loadPrompt(customPath);
    
    logger.info({ agentType }, 'Saved custom prompt');
  }

  /**
   * Get prompt metadata for UI
   */
  getPromptMetadata(): AgentPromptMetadata[] {
    return Array.from(this.prompts.values()).map(p => p.metadata);
  }

  /**
   * Cleanup watchers
   */
  async cleanup(): Promise<void> {
    for (const [, watcher] of this.fileWatchers) {
      watcher.close();
    }
    this.fileWatchers.clear();
  }
}

// Singleton instance
let promptLoader: PromptLoader | null = null;

export async function getPromptLoader(): Promise<PromptLoader> {
  if (!promptLoader) {
    promptLoader = new PromptLoader();
    await promptLoader.initialize();
  }
  return promptLoader;
}