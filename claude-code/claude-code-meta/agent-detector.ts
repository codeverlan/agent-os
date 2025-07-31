import { createLogger } from '@/utils/logger.js';

export interface AgentCapability {
  name: string;
  patterns: string[];
  requiredTools: string[];
  optionalTools?: string[];
}

export class AgentDetector {
  private logger = createLogger('agent-detector');
  
  // Agent OS pattern: Specialized agents with minimal tool sets
  private capabilities: AgentCapability[] = [
    {
      name: 'test-runner',
      patterns: ['test', 'testing', 'unit test', 'integration test', 'coverage'],
      requiredTools: ['Bash', 'Read'],
      optionalTools: ['Grep', 'Glob']
    },
    {
      name: 'context-fetcher',
      patterns: ['search', 'find', 'locate', 'gather', 'context', 'information'],
      requiredTools: ['Read', 'Glob', 'Grep'],
      optionalTools: ['LS']
    },
    {
      name: 'git-workflow',
      patterns: ['git', 'commit', 'branch', 'merge', 'pull request', 'repository'],
      requiredTools: ['Bash', 'Read'],
      optionalTools: ['Grep', 'Glob']
    },
    {
      name: 'file-creator',
      patterns: ['create', 'new file', 'scaffold', 'template', 'generate'],
      requiredTools: ['Write', 'Read'],
      optionalTools: ['LS', 'Bash']
    }
  ];

  constructor() {
    // Set agent detection flag as per Agent OS pattern
    if (typeof process !== 'undefined') {
      process.env.IS_AGENT_OS = 'true';
    }
  }

  /**
   * Detect which specialized agent should handle a given request
   */
  detectAgent(request: string): string | null {
    const normalizedRequest = request.toLowerCase();
    
    for (const capability of this.capabilities) {
      const matchesPattern = capability.patterns.some(pattern => 
        normalizedRequest.includes(pattern)
      );
      
      if (matchesPattern) {
        this.logger.info(`Detected agent: ${capability.name} for request: "${request}"`);
        return capability.name;
      }
    }
    
    return null;
  }

  /**
   * Check if current process is running as an agent (Agent OS pattern)
   */
  isAgentProcess(): boolean {
    return process.env.IS_AGENT_OS === 'true';
  }

  /**
   * Get required tools for a specific agent
   */
  getAgentTools(agentName: string): string[] {
    const capability = this.capabilities.find(c => c.name === agentName);
    if (!capability) return [];
    
    return [
      ...capability.requiredTools,
      ...(capability.optionalTools || [])
    ];
  }

  /**
   * Validate if an agent has the correct minimal tool set
   */
  validateAgentTools(agentName: string, providedTools: string[]): boolean {
    const capability = this.capabilities.find(c => c.name === agentName);
    if (!capability) return false;
    
    // Check all required tools are present
    const hasRequiredTools = capability.requiredTools.every(tool => 
      providedTools.includes(tool)
    );
    
    // Check that tool set is minimal (no more than 4 tools as per Agent OS)
    const isMinimal = providedTools.length <= 4;
    
    return hasRequiredTools && isMinimal;
  }

  /**
   * Get all available agent capabilities
   */
  getCapabilities(): AgentCapability[] {
    return [...this.capabilities];
  }
}

// Singleton instance
let detectorInstance: AgentDetector | null = null;

export function getAgentDetector(): AgentDetector {
  if (!detectorInstance) {
    detectorInstance = new AgentDetector();
  }
  return detectorInstance;
}