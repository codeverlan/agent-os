import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '@/utils/logger.js';
import { getPromptLoader } from '@/agents/prompt-loader.js';
import type { AgentPromptMetadata } from '@/agents/prompt-loader.js';

const logger = createLogger('agent-factory');

export interface AgentConfig {
  agent_id?: string;
  project_id: string;
  name?: string;
  type: 'meta' | 'sub' | 'specialist';
  blueprint_type: string;
  parent_agent_id?: string;
  feature_id?: string;
  persistence_level?: 'ephemeral' | 'session' | 'persistent' | 'permanent';
  capabilities?: string[];
  color?: string;
  context?: Record<string, any>;
}

export interface Agent {
  agent_id: string;
  project_id: string;
  name: string;
  type: string;
  blueprint_type: string;
  status: 'initializing' | 'active' | 'idle' | 'working' | 'terminated';
  capabilities: string[];
  persistence_level: string;
  color: string;
  prompt: string;
  created_at: Date;
  parent_agent_id?: string;
  feature_id?: string;
}

export class AgentFactory {
  private promptLoader: any;

  async initialize(): Promise<void> {
    this.promptLoader = await getPromptLoader();
  }

  /**
   * Create an agent based on blueprint type
   */
  async createAgent(config: AgentConfig): Promise<Agent> {
    const agentId = config.agent_id || `${config.blueprint_type}-${uuidv4().slice(0, 8)}`;
    
    // Load prompt template
    const promptTemplate = this.promptLoader.getPrompt(config.blueprint_type);
    
    if (!promptTemplate) {
      throw new Error(`No prompt template found for blueprint type: ${config.blueprint_type}`);
    }
    
    // Use metadata from prompt if not provided
    const metadata = promptTemplate.metadata;
    
    // Render prompt with context
    const promptContext = {
      agent_id: agentId,
      project_name: 'Claude Code META',
      parent_agent: config.parent_agent_id || 'META Orchestrator',
      user_request: config.context?.user_request || '',
      feature_id: config.feature_id || '',
      ...config.context
    };
    
    const renderedPrompt = this.promptLoader.renderPrompt(
      config.blueprint_type, 
      promptContext
    );
    
    const agent: Agent = {
      agent_id: agentId,
      project_id: config.project_id,
      name: config.name || metadata.name,
      type: config.type,
      blueprint_type: config.blueprint_type,
      status: 'initializing',
      capabilities: config.capabilities || metadata.capabilities,
      persistence_level: config.persistence_level || metadata.persistence,
      color: config.color || metadata.color,
      prompt: renderedPrompt,
      created_at: new Date(),
      parent_agent_id: config.parent_agent_id,
      feature_id: config.feature_id
    };
    
    logger.info({
      agent_id: agent.agent_id,
      name: agent.name,
      type: agent.type,
      blueprint_type: agent.blueprint_type,
      persistence_level: agent.persistence_level
    }, 'Created agent from markdown prompt');
    
    return agent;
  }

  /**
   * Get available agent types from loaded prompts
   */
  getAvailableAgentTypes(): AgentPromptMetadata[] {
    return this.promptLoader.getPromptMetadata();
  }

  /**
   * Create custom agent type
   */
  async createCustomAgentType(
    agentType: string,
    metadata: Partial<AgentPromptMetadata>,
    promptContent: string
  ): Promise<void> {
    const fullMetadata: AgentPromptMetadata = {
      agent_type: agentType,
      name: metadata.name || agentType,
      version: metadata.version || '1.0.0',
      persistence: metadata.persistence || 'session',
      capabilities: metadata.capabilities || [],
      color: metadata.color || '#6B7280',
      priority: metadata.priority
    };
    
    await this.promptLoader.saveCustomPrompt(agentType, fullMetadata, promptContent);
  }

  /**
   * Update agent persistence level
   */
  async updateAgentPersistence(
    agentId: string, 
    persistence: 'ephemeral' | 'session' | 'persistent' | 'permanent'
  ): Promise<void> {
    // This would update the database
    logger.info({ agentId, persistence }, 'Updated agent persistence level');
  }

  /**
   * Check if agent should persist based on its configuration
   */
  shouldAgentPersist(agent: Agent, context: { sessionEnding?: boolean }): boolean {
    switch (agent.persistence_level) {
      case 'ephemeral':
        return false; // Always terminate
      
      case 'session':
        return !context.sessionEnding; // Terminate at session end
      
      case 'persistent':
        return true; // Survive restarts
      
      case 'permanent':
        return true; // Never terminate (like META)
      
      default:
        return false;
    }
  }
}

// Singleton instance
let agentFactory: AgentFactory | null = null;

export async function getAgentFactory(): Promise<AgentFactory> {
  if (!agentFactory) {
    agentFactory = new AgentFactory();
    await agentFactory.initialize();
  }
  return agentFactory;
}