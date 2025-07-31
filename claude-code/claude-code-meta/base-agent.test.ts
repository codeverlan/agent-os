import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BaseAgent } from './base-agent';
import { AgentConfig, AgentMessage, AgentState } from '../types.js';
import { 
  TestAgent, 
  createTestAgentConfig,
  waitForAgentEvent,
  simulateAgentLifecycle,
  cleanupAgents
} from '@/test/utils/agent-test-utils';
import { mockRedis, resetRedisMocks } from '@/test/mocks/redis.mock';
import { mockDatabase, resetDatabaseMocks } from '@/test/mocks/database.mock';
import { TEST_PROJECT_ID } from '@/test/setup';

describe('BaseAgent', () => {
  let agent: TestAgent;
  let config: AgentConfig;
  
  beforeEach(() => {
    resetRedisMocks();
    resetDatabaseMocks();
    
    config = createTestAgentConfig({
      agentId: 'test-agent-001',
      name: 'Test Agent',
      projectId: TEST_PROJECT_ID,
    });
    
    agent = new TestAgent(config);
  });
  
  afterEach(async () => {
    await cleanupAgents([agent]);
    vi.clearAllMocks();
  });
  
  describe('constructor', () => {
    it('should initialize with correct config', () => {
      expect(agent.getConfig()).toEqual(config);
      expect(agent.getState()).toBe('idle');
    });
    
    it('should validate required config fields', () => {
      expect(() => new TestAgent({} as AgentConfig)).toThrow();
      expect(() => new TestAgent({ agentId: 'test' } as AgentConfig)).toThrow();
    });
  });
  
  describe('lifecycle management', () => {
    it('should start successfully', async () => {
      const startedEvent = waitForAgentEvent(agent, 'started');
      
      await agent.start();
      
      expect(agent.getState()).toBe('running');
      await expect(startedEvent).resolves.toBeDefined();
      expect(mockDatabase.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE agents.agent_registry'),
        expect.arrayContaining(['running', 'test-agent-001'])
      );
    });
    
    it('should not start if already running', async () => {
      await agent.start();
      
      await expect(agent.start()).rejects.toThrow('Agent is already running');
    });
    
    it('should pause and resume correctly', async () => {
      await agent.start();
      
      const pausedEvent = waitForAgentEvent(agent, 'paused');
      await agent.pause();
      
      expect(agent.getState()).toBe('paused');
      await expect(pausedEvent).resolves.toBeDefined();
      
      const resumedEvent = waitForAgentEvent(agent, 'resumed');
      await agent.resume();
      
      expect(agent.getState()).toBe('running');
      await expect(resumedEvent).resolves.toBeDefined();
    });
    
    it('should stop correctly', async () => {
      await agent.start();
      
      const stoppedEvent = waitForAgentEvent(agent, 'stopped');
      await agent.stop();
      
      expect(agent.getState()).toBe('stopped');
      await expect(stoppedEvent).resolves.toBeDefined();
      expect(mockDatabase.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE agents.agent_registry'),
        expect.arrayContaining(['stopped', 'test-agent-001'])
      );
    });
    
    it('should handle full lifecycle', async () => {
      await simulateAgentLifecycle(agent);
    });
  });
  
  describe('message handling', () => {
    beforeEach(async () => {
      await agent.start();
    });
    
    it('should receive and process messages', async () => {
      const message: AgentMessage = {
        id: 'msg-001',
        timestamp: new Date(),
        from: 'sender-001',
        to: 'test-agent-001',
        type: 'request',
        payload: { action: 'test' },
        metadata: {
          priority: 'medium',
          requiresAck: false,
        },
      };
      
      // Simulate message receipt
      agent.exposedEmit('message', message);
      
      // Wait for processing
      await vi.waitFor(() => {
        expect(mockRedis.xadd).toHaveBeenCalled();
      });
    });
    
    it('should ignore messages when paused', async () => {
      await agent.pause();
      
      const message: AgentMessage = {
        id: 'msg-002',
        timestamp: new Date(),
        from: 'sender-001',
        to: 'test-agent-001',
        type: 'request',
        payload: { action: 'test' },
        metadata: {
          priority: 'medium',
          requiresAck: false,
        },
      };
      
      const handleSpy = vi.spyOn(agent, 'exposedHandleMessage');
      agent.exposedEmit('message', message);
      
      // Give time for any processing
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(handleSpy).not.toHaveBeenCalled();
    });
    
    it('should send acknowledgment when required', async () => {
      const message: AgentMessage = {
        id: 'msg-003',
        timestamp: new Date(),
        from: 'sender-001',
        to: 'test-agent-001',
        type: 'request',
        payload: { action: 'test' },
        metadata: {
          priority: 'high',
          requiresAck: true,
        },
      };
      
      agent.exposedEmit('message', message);
      
      await vi.waitFor(() => {
        expect(mockRedis.xadd).toHaveBeenCalledWith(
          expect.stringContaining('agent:messages:sender-001'),
          '*',
          'message',
          expect.stringContaining('"type":"ack"')
        );
      });
    });
  });
  
  describe('error handling', () => {
    beforeEach(async () => {
      await agent.start();
    });
    
    it('should emit error events', async () => {
      const errorEvent = waitForAgentEvent(agent, 'error');
      const testError = new Error('Test error');
      
      // Trigger error through protected method
      agent.exposedEmit('error', testError);
      
      const error = await errorEvent;
      expect(error).toBe(testError);
    });
    
    it('should handle message processing errors', async () => {
      // Override handleMessage to throw error
      vi.spyOn(agent as any, 'handleMessage').mockRejectedValueOnce(
        new Error('Processing error')
      );
      
      const errorSpy = vi.fn();
      agent.on('error', errorSpy);
      
      const message: AgentMessage = {
        id: 'msg-004',
        timestamp: new Date(),
        from: 'sender-001',
        to: 'test-agent-001',
        type: 'request',
        payload: { action: 'fail' },
        metadata: {
          priority: 'medium',
          requiresAck: false,
        },
      };
      
      agent.exposedEmit('message', message);
      
      await vi.waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('Processing error'),
          })
        );
      });
    });
  });
  
  describe('metrics and monitoring', () => {
    beforeEach(async () => {
      await agent.start();
    });
    
    it('should track message count', async () => {
      const metrics1 = agent.getMetrics();
      expect(metrics1.messagesReceived).toBe(0);
      expect(metrics1.messagesSent).toBe(0);
      
      // Process a message
      const message: AgentMessage = {
        id: 'msg-005',
        timestamp: new Date(),
        from: 'sender-001',
        to: 'test-agent-001',
        type: 'request',
        payload: { action: 'test' },
        metadata: {
          priority: 'medium',
          requiresAck: false,
        },
      };
      
      agent.exposedEmit('message', message);
      
      await vi.waitFor(() => {
        const metrics2 = agent.getMetrics();
        expect(metrics2.messagesReceived).toBe(1);
      });
    });
    
    it('should calculate uptime correctly', async () => {
      const metrics1 = agent.getMetrics();
      expect(metrics1.uptime).toBeGreaterThan(0);
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const metrics2 = agent.getMetrics();
      expect(metrics2.uptime).toBeGreaterThan(metrics1.uptime);
    });
    
    it('should emit metrics events', async () => {
      const metricsSpy = vi.fn();
      agent.on('metrics', metricsSpy);
      
      // Trigger metrics emission
      await agent.performTestAction('emit-metrics');
      
      expect(metricsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'running',
          messagesReceived: expect.any(Number),
          messagesSent: expect.any(Number),
          uptime: expect.any(Number),
          lastActivity: expect.any(Date),
        })
      );
    });
  });
  
  describe('persistence', () => {
    it('should save state to database', async () => {
      await agent.start();
      
      // Trigger state save
      await agent.performTestAction('save-state');
      
      expect(mockDatabase.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO agents.agent_state'),
        expect.arrayContaining([
          'test-agent-001',
          TEST_PROJECT_ID,
          expect.any(String), // state JSON
        ])
      );
    });
    
    it('should restore state from database', async () => {
      const savedState = {
        customData: 'test',
        counter: 42,
      };
      
      mockDatabase.query.mockResolvedValueOnce({
        rows: [{
          state: savedState,
          created_at: new Date(),
        }],
      });
      
      // Create new agent instance
      const restoredAgent = new TestAgent(config);
      await restoredAgent.start();
      
      expect(mockDatabase.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT state FROM agents.agent_state'),
        ['test-agent-001', TEST_PROJECT_ID]
      );
    });
  });
  
  describe('HIPAA compliance', () => {
    it('should check HIPAA authorization', () => {
      expect(agent.isHipaaAuthorized()).toBe(false);
      
      const authorizedConfig = createTestAgentConfig({
        hipaaAuthorized: true,
      });
      const authorizedAgent = new TestAgent(authorizedConfig);
      
      expect(authorizedAgent.isHipaaAuthorized()).toBe(true);
    });
    
    it('should log PHI access when authorized', async () => {
      const authorizedConfig = createTestAgentConfig({
        hipaaAuthorized: true,
      });
      const authorizedAgent = new TestAgent(authorizedConfig);
      await authorizedAgent.start();
      
      // Simulate PHI access
      await authorizedAgent.performTestAction('access-phi', {
        patientId: 'patient-123',
        action: 'view',
      });
      
      expect(mockDatabase.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit.phi_access_log'),
        expect.arrayContaining(['test-agent-001'])
      );
      
      await cleanupAgents([authorizedAgent]);
    });
    
    it('should block PHI access when not authorized', async () => {
      await agent.start();
      
      await expect(
        agent.performTestAction('access-phi', {
          patientId: 'patient-123',
          action: 'view',
        })
      ).rejects.toThrow('not authorized to access PHI');
    });
  });
});