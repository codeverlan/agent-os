import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { createAgentLogger } from '@/utils/logger.js';
import { streams } from '@/db/redis.js';
import { query } from '@/db/client.js';
import {
  AgentMessage,
  AgentTask,
  AgentStatus,
  TaskStatus,
  MessageType,
  AgentMetrics,
  Priority,
} from './types.js';
import { RedisMessenger, createRedisMessenger } from './messaging/redis-messenger.js';

export interface BaseAgentConfig {
  agentId: string;
  name: string;
  color: string;
  capabilities: string[];
  parentAgentId?: string;
  configuration?: Record<string, unknown>;
}

export abstract class BaseAgent extends EventEmitter {
  protected readonly agentId: string;
  protected readonly name: string;
  protected readonly color: string;
  protected readonly capabilities: string[];
  protected readonly parentAgentId?: string;
  protected readonly configuration: Record<string, unknown>;
  protected readonly logger;
  protected status: AgentStatus = AgentStatus.INACTIVE;
  protected healthCheckInterval?: NodeJS.Timeout;
  protected messageConsumerInterval?: NodeJS.Timeout;
  protected messenger?: RedisMessenger;

  constructor(config: BaseAgentConfig) {
    super();
    
    this.agentId = config.agentId;
    this.name = config.name;
    this.color = config.color;
    this.capabilities = config.capabilities;
    this.parentAgentId = config.parentAgentId;
    this.configuration = config.configuration || {};
    this.logger = createAgentLogger(this.agentId, this.name);
  }

  // Abstract methods that must be implemented by subclasses
  abstract processTask(task: AgentTask): Promise<void>;
  abstract handleMessage(message: AgentMessage): Promise<void>;
  abstract getHealthMetrics(): Promise<Partial<AgentMetrics>>;

  // Lifecycle methods
  async start(): Promise<void> {
    try {
      this.logger.info('Starting agent');
      
      // Register agent in database
      await this.register();
      
      // Initialize Redis messenger
      this.messenger = createRedisMessenger(this.agentId);
      await this.messenger.connect();
      
      // Register message handler
      this.messenger.onMessage(async (message) => {
        await this.handleMessage(message);
      });
      
      // Create message streams (for backward compatibility)
      await this.createMessageStreams();
      
      // Start health checks
      this.startHealthChecks();
      
      // Start message consumer
      this.startMessageConsumer();
      
      // Update status
      this.status = AgentStatus.ACTIVE;
      await this.updateStatus(AgentStatus.ACTIVE);
      
      // Emit started event
      this.emitEvent('started');
      
      this.logger.info('Agent started successfully');
    } catch (error) {
      this.logger.error({ error }, 'Failed to start agent');
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      this.logger.info('Stopping agent');
      
      // Stop intervals
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }
      if (this.messageConsumerInterval) {
        clearInterval(this.messageConsumerInterval);
      }
      
      // Disconnect messenger
      if (this.messenger) {
        await this.messenger.disconnect();
      }
      
      // Update status
      this.status = AgentStatus.INACTIVE;
      await this.updateStatus(AgentStatus.INACTIVE);
      
      // Emit stopped event
      this.emitEvent('stopped');
      
      this.logger.info('Agent stopped successfully');
    } catch (error) {
      this.logger.error({ error }, 'Failed to stop agent');
      throw error;
    }
  }

  // Registration and status management
  protected async register(): Promise<void> {
    const registrationQuery = `
      INSERT INTO agents.agent_registry (
        agent_id, name, type, parent_agent_id, color,
        capabilities, required_resources, configuration, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (agent_id) DO UPDATE SET
        status = $9,
        configuration = $8
    `;
    
    await query(registrationQuery, [
      this.agentId,
      this.name,
      this.parentAgentId ? 'sub' : 'meta',
      this.parentAgentId,
      this.color,
      this.capabilities,
      [], // required resources
      JSON.stringify(this.configuration),
      AgentStatus.ACTIVE,
    ]);
  }

  protected async updateStatus(status: AgentStatus): Promise<void> {
    const updateQuery = `
      UPDATE agents.agent_registry
      SET status = $1
      WHERE agent_id = $2
    `;
    
    await query(updateQuery, [status, this.agentId]);
  }

  // Message handling
  protected async createMessageStreams(): Promise<void> {
    const streamKey = `agent:${this.agentId}:messages`;
    const groupName = `${this.agentId}-group`;
    
    await streams.createConsumerGroup(streamKey, groupName);
  }

  protected startMessageConsumer(): void {
    const streamKey = `agent:${this.agentId}:messages`;
    const groupName = `${this.agentId}-group`;
    const consumerName = `${this.agentId}-consumer`;
    
    this.messageConsumerInterval = setInterval(async () => {
      try {
        const messages = await streams.readAsConsumer(
          streamKey,
          groupName,
          consumerName,
          10,
          1000
        );
        
        for (const { id, data } of messages) {
          try {
            const message: AgentMessage = {
              id: data.id || id,
              from: data.from as string,
              to: data.to as string,
              type: data.type as MessageType,
              timestamp: new Date(data.timestamp as string),
              payload: JSON.parse(data.payload as string),
              correlationId: data.correlationId as string | undefined,
              priority: data.priority as any,
              timeout: data.timeout ? Number(data.timeout) : undefined,
              metadata: data.metadata ? JSON.parse(data.metadata as string) : undefined,
            };
            
            await this.handleMessage(message);
            await streams.acknowledgeMessage(streamKey, groupName, id);
          } catch (error) {
            this.logger.error({ messageId: id, error }, 'Failed to process message');
          }
        }
      } catch (error) {
        this.logger.error({ error }, 'Error in message consumer');
      }
    }, 1000);
  }

  // Send message to another agent
  protected async sendMessage(
    toAgentId: string,
    type: MessageType,
    payload: Record<string, unknown>,
    options: Partial<AgentMessage> = {}
  ): Promise<void> {
    // Use messenger if available, otherwise fall back to direct Redis streams
    if (this.messenger) {
      await this.messenger.sendMessage(toAgentId, {
        type,
        payload,
        priority: options.priority || Priority.MEDIUM,
        ...options,
      });
      
      // Store in database for audit
      const message: AgentMessage = {
        id: uuidv4(),
        from: this.agentId,
        to: toAgentId,
        type,
        timestamp: new Date(),
        priority: Priority.MEDIUM,
        payload,
        ...options,
      };
      await this.storeMessage(message);
      
      return;
    }
    
    // Fallback to direct Redis streams
    const message: AgentMessage = {
      id: uuidv4(),
      from: this.agentId,
      to: toAgentId,
      type,
      timestamp: new Date(),
      priority: Priority.MEDIUM,
      payload,
      ...options,
    };
    
    const streamKey = `agent:${toAgentId}:messages`;
    const streamData = {
      id: message.id,
      from: message.from,
      to: message.to,
      type: message.type,
      timestamp: message.timestamp.toISOString(),
      payload: JSON.stringify(message.payload),
      ...(message.correlationId && { correlationId: message.correlationId }),
      ...(message.priority && { priority: message.priority }),
      ...(message.timeout && { timeout: message.timeout.toString() }),
      ...(message.metadata && { metadata: JSON.stringify(message.metadata) }),
    };
    
    await streams.addMessage(streamKey, streamData);
    
    // Store in database for audit
    await this.storeMessage(message);
  }

  protected async storeMessage(message: AgentMessage): Promise<void> {
    const storeQuery = `
      INSERT INTO agents.agent_messages (
        message_id, from_agent, to_agent, message_type,
        payload, correlation_id, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;
    
    await query(storeQuery, [
      message.id,
      message.from,
      message.to,
      message.type,
      JSON.stringify(message.payload),
      message.correlationId,
      'sent',
      message.timestamp,
    ]);
  }

  // Task management
  protected async createTask(
    type: string,
    payload: Record<string, unknown>,
    options: Partial<AgentTask> = {}
  ): Promise<AgentTask> {
    const task: AgentTask = {
      taskId: uuidv4(),
      agentId: this.agentId,
      type,
      priority: 5,
      payload,
      status: TaskStatus.PENDING,
      retryCount: 0,
      maxRetries: 3,
      timeoutMs: 30000,
      createdAt: new Date(),
      ...options,
    };
    
    const createQuery = `
      INSERT INTO agents.agent_tasks (
        task_id, agent_id, parent_task_id, type, priority,
        payload, status, retry_count, max_retries, timeout_ms, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
    
    await query(createQuery, [
      task.taskId,
      task.agentId,
      task.parentTaskId,
      task.type,
      task.priority || 5,
      JSON.stringify(task.payload),
      task.status,
      task.retryCount,
      task.maxRetries,
      task.timeoutMs,
      task.createdAt,
    ]);
    
    return task;
  }

  protected async updateTask(
    taskId: string,
    updates: Partial<AgentTask>
  ): Promise<void> {
    const updateFields: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;
    
    if (updates.status !== undefined) {
      updateFields.push(`status = $${paramCount++}`);
      values.push(updates.status);
    }
    
    if (updates.result !== undefined) {
      updateFields.push(`result = $${paramCount++}`);
      values.push(JSON.stringify(updates.result));
    }
    
    if (updates.error !== undefined) {
      updateFields.push(`error_details = $${paramCount++}`);
      values.push(JSON.stringify(updates.error));
    }
    
    if (updates.completedAt !== undefined) {
      updateFields.push(`completed_at = $${paramCount++}`);
      values.push(updates.completedAt);
    }
    
    values.push(taskId);
    
    const updateQuery = `
      UPDATE agents.agent_tasks
      SET ${updateFields.join(', ')}
      WHERE task_id = $${paramCount}
    `;
    
    await query(updateQuery, values);
  }

  // Health monitoring
  protected startHealthChecks(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        this.logger.error({ error }, 'Health check failed');
      }
    }, 30000); // 30 seconds
  }

  protected async performHealthCheck(): Promise<void> {
    const metrics = await this.getHealthMetrics();
    
    // Store metrics
    const metricsQuery = `
      INSERT INTO agents.agent_metrics (
        agent_id, metric_type, metric_value, tags, recorded_at
      ) VALUES ($1, $2, $3, $4, $5)
    `;
    
    for (const [metricType, metricValue] of Object.entries(metrics.metrics || {})) {
      await query(metricsQuery, [
        this.agentId,
        metricType,
        metricValue,
        JSON.stringify({}),
        new Date(),
      ]);
    }
    
    // Send heartbeat
    await this.sendHeartbeat();
  }

  protected async sendHeartbeat(): Promise<void> {
    // Use messenger's heartbeat if available
    if (this.messenger) {
      await this.messenger.sendHeartbeat();
    } else if (this.parentAgentId) {
      // Fallback to parent heartbeat
      await this.sendMessage(
        this.parentAgentId,
        MessageType.HEARTBEAT,
        {
          agentId: this.agentId,
          status: this.status,
          timestamp: new Date().toISOString(),
        }
      );
    }
  }

  // Utility methods
  protected emitEvent(event: string, ...args: unknown[]): boolean {
    this.logger.debug({ event, args }, 'Emitting event');
    return super.emit(event, ...args);
  }

  // Public methods
  getStatus(): AgentStatus {
    return this.status;
  }

  getAgentId(): string {
    return this.agentId;
  }

  getName(): string {
    return this.name;
  }

  getCapabilities(): string[] {
    return this.capabilities;
  }
}