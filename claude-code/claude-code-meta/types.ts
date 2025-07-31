import { z } from 'zod';

// Agent types
export enum AgentType {
  META = 'meta',
  SUB = 'sub',
  TASK = 'task',
}

// Agent status
export enum AgentStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  FAILED = 'failed',
  TERMINATED = 'terminated',
}

// Task status
export enum TaskStatus {
  PENDING = 'pending',
  ASSIGNED = 'assigned',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

// Message types
export enum MessageType {
  REQUEST = 'request',
  RESPONSE = 'response',
  EVENT = 'event',
  HEARTBEAT = 'heartbeat',
}

// Priority levels
export enum Priority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

// Agent capabilities
export type AgentCapability = 
  | 'code-generation'
  | 'file-management'
  | 'pattern-matching'
  | 'test-generation'
  | 'coverage-analysis'
  | 'mocking'
  | 'code-analysis'
  | 'pattern-recognition'
  | 'optimization'
  | 'api-integration'
  | 'data-mapping'
  | 'auth-handling'
  | 'workflow-management'
  | 'task-decomposition'
  | 'agent-creation'
  | 'doc-generation'
  | 'markdown-formatting'
  | 'diagram-creation'
  | 'metric-collection'
  | 'anomaly-detection'
  | 'reporting'
  | 'team-management'
  | 'task-delegation'
  | 'coordination'
  | 'form-generation'
  | 'validation-rules'
  | 'hipaa-compliance'
  | 'data-validation'
  | 'error-handling'
  | 'data-analysis'
  | 'schedule-optimization'
  | 'conflict-resolution'
  | 'notification-sending'
  | 'status-tracking'
  | 'communication-routing'
  | 'document-generation'
  | 'template-management'
  | 'compliance-checking'
  | 'real-time-processing'
  | 'encryption-verification'
  | 'priority-handling';

// Agent configuration
export interface AgentConfig {
  agentId: string;
  name: string;
  type: AgentType;
  parentAgentId?: string;
  capabilities: AgentCapability[];
  hipaaAuthorized: boolean;
  color: string;
  systemPrompt?: string;
  tools?: string[];
}

// Agent registration schema
export const AgentRegistrationSchema = z.object({
  agentId: z.string().min(1),
  name: z.string().min(1),
  type: z.nativeEnum(AgentType),
  parentAgentId: z.string().optional(),
  color: z.string().regex(/^#[0-9A-F]{6}$/i),
  capabilities: z.array(z.string()),
  requiredResources: z.array(z.string()),
  configuration: z.record(z.unknown()).default({}),
  hipaaAuthorized: z.boolean().default(false),
  healthEndpoint: z.string().optional(),
});

export type AgentRegistration = z.infer<typeof AgentRegistrationSchema>;

// Agent instance schema
export const AgentInstanceSchema = AgentRegistrationSchema.extend({
  status: z.nativeEnum(AgentStatus),
  createdAt: z.date(),
  lastHeartbeat: z.date().optional(),
  terminatedAt: z.date().optional(),
});

export type AgentInstance = z.infer<typeof AgentInstanceSchema>;

// Agent metrics schema
export const AgentMetricsSchema = z.object({
  agentId: z.string(),
  timestamp: z.date(),
  metrics: z.object({
    tasksCompleted: z.number().default(0),
    tasksFailed: z.number().default(0),
    averageResponseTime: z.number().default(0),
    currentLoad: z.number().min(0).max(1).default(0),
    memoryUsage: z.number().default(0),
    errorRate: z.number().min(0).max(1).default(0),
  }),
});

export type AgentMetrics = z.infer<typeof AgentMetricsSchema>;

// Agent message schema
export const AgentMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  type: z.nativeEnum(MessageType),
  timestamp: z.date(),
  correlationId: z.string().optional(),
  priority: z.nativeEnum(Priority).default(Priority.MEDIUM),
  timeout: z.number().optional(),
  payload: z.record(z.unknown()),
  metadata: z.record(z.unknown()).optional(),
});

export type AgentMessage = z.infer<typeof AgentMessageSchema>;

// Agent task schema
export const AgentTaskSchema = z.object({
  taskId: z.string(),
  agentId: z.string(),
  parentTaskId: z.string().optional(),
  type: z.string(),
  priority: z.number().min(1).max(10).default(5),
  payload: z.record(z.unknown()),
  status: z.nativeEnum(TaskStatus),
  result: z.record(z.unknown()).optional(),
  error: z.object({
    message: z.string(),
    code: z.string().optional(),
    details: z.record(z.unknown()).optional(),
  }).optional(),
  retryCount: z.number().default(0),
  maxRetries: z.number().default(3),
  timeoutMs: z.number().default(30000),
  createdAt: z.date(),
  assignedAt: z.date().optional(),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
});

export type AgentTask = z.infer<typeof AgentTaskSchema>;

// Agent performance criteria
export const PerformanceCriteriaSchema = z.object({
  successRate: z.number().min(0).max(1),
  responseTime: z.number(),
  resourceUtilization: z.number().min(0).max(1),
  tasksCompleted: z.number(),
  userSatisfaction: z.number().min(0).max(1).optional(),
  costEfficiency: z.number().min(0).max(1).optional(),
  errorRate: z.number().min(0).max(1),
  uptime: z.number().min(0).max(1),
  memoryUsage: z.number(),
});

export type PerformanceCriteria = z.infer<typeof PerformanceCriteriaSchema>;

// Agent evaluation result
export const EvaluationResultSchema = z.object({
  agentId: z.string(),
  timestamp: z.date(),
  recommendation: z.enum(['maintain', 'modify', 'terminate']),
  reason: z.string(),
  score: z.number().min(0).max(100),
  metrics: PerformanceCriteriaSchema,
  suggestedModifications: z.array(z.string()).optional(),
});

export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

// Agent creation request
export const AgentCreationRequestSchema = z.object({
  name: z.string(),
  type: z.nativeEnum(AgentType),
  capabilities: z.array(z.string()),
  configuration: z.record(z.unknown()).default({}),
  hipaaAuthorized: z.boolean().default(false),
  color: z.string().regex(/^#[0-9A-F]{6}$/i).optional(),
});

export type AgentCreationRequest = z.infer<typeof AgentCreationRequestSchema>;

// Agent health status
export const AgentHealthSchema = z.object({
  agentId: z.string(),
  status: z.enum(['healthy', 'degraded', 'failed']),
  lastHeartbeat: z.date(),
  metrics: z.object({
    requestsPerMinute: z.number(),
    averageResponseTime: z.number(),
    errorRate: z.number(),
    queueDepth: z.number(),
  }),
  alerts: z.array(z.object({
    level: z.enum(['info', 'warning', 'error', 'critical']),
    message: z.string(),
    timestamp: z.date(),
  })).default([]),
});

export type AgentHealth = z.infer<typeof AgentHealthSchema>;

// Agent lifecycle event
export const AgentLifecycleEventSchema = z.object({
  eventId: z.string(),
  agentId: z.string(),
  type: z.enum(['created', 'started', 'stopped', 'modified', 'terminated']),
  timestamp: z.date(),
  reason: z.string().optional(),
  details: z.record(z.unknown()).optional(),
  performedBy: z.string(),
});

export type AgentLifecycleEvent = z.infer<typeof AgentLifecycleEventSchema>;