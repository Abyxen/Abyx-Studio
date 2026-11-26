'use strict';

const PathGuard = require('./path_guard');
const PolicyEngine = require('./policy_engine');
const GitAdapter = require('./git_adapter');
const ToolGateway = require('./tool_gateway');
const ToolRegistry = require('./tool_registry');
const AgentExecutionLoop = require('./execution_loop');
const Orchestrator = require('./orchestrator');
const TaskScheduler = require('./scheduler');
const TaskStore = require('./task_store');
const EventStore = require('./event_store');
const AgentSharedMemory = require('./shared_memory');
const MessageBus = require('./message_bus');
const AgentRegistry = require('./agent_registry');
const ExecutionLogger = require('./execution_logger');
const ModelRouter = require('./model_router');
const ProviderRegistry = require('./provider_registry');
const ModelAdapter = require('./model_adapter');
const EventNormalizer = require('./event_normalizer');
const CancellationManager = require('./cancellation_manager');
const SessionManager = require('./session_manager');
const RuntimeController = require('./runtime_controller');
const ContextManager = require('./context_manager');
const SecurityEngine = require('./security/security_engine');
const WorkspaceIsolation = require('./security/workspace_isolation');
const SandboxManager = require('./security/sandbox_manager');

/**
 * createAgentEngine - Master Factory Function for ABYX Agent Subsystem
 * Wires together ModelRouter, ProviderRegistry, ModelAdapter, SessionManager,
 * RuntimeController, PathGuard, PolicyEngine, GitAdapter, ToolGateway,
 * AgentExecutionLoop, and Orchestrator into one cohesive runtime.
 */
function createAgentEngine(options = {}) {
  const workspaceRoot = options.workspaceRoot || options.approvedRoots?.[0] || process.cwd();
  const approvedRoots = options.approvedRoots || [workspaceRoot];
  
  const pathGuard = new PathGuard({ approvedRoots });
  const gitAdapter = new GitAdapter(pathGuard);
  const logger = new ExecutionLogger();
  
  const policyEngine = new PolicyEngine({
    mode: options.mode || 'build',
    approvalTimeoutMs: options.approvalTimeoutMs || 180000
  });

  const securityEngine = new SecurityEngine({
    workspaceRoot,
    mode: options.mode || 'build',
    approvalTimeoutMs: options.approvalTimeoutMs || 180000
  });

  const workspaceIsolation = new WorkspaceIsolation(workspaceRoot, gitAdapter, options);
  const sandboxManager = new SandboxManager({
    workspaceRoot,
    preferredMode: options.sandboxMode || 'auto'
  });

  const toolGateway = new ToolGateway({
    pathGuard,
    policyEngine,
    gitAdapter,
    logger,
    securityEngine,
    workspaceIsolation,
    sandboxManager
  });

  // Model Router & Adapter (Preserving model_router.js)
  const modelRouter = options.modelRouter || options.aiProviders?.defaultModelRouter || new ModelRouter();
  const providerRegistry = new ProviderRegistry();
  const modelAdapter = new ModelAdapter({ modelRouter, providerRegistry });

  // Pi-style Session Manager & Runtime Controller
  const sessionManager = new SessionManager(options);
  const cancellationManager = new CancellationManager();

  const runtimeController = new RuntimeController({
    modelRouter,
    toolGateway,
    policyEngine,
    logger,
    options: {
      maxSteps: options.maxSteps || 15
    }
  });

  const executionLoop = new AgentExecutionLoop({
    modelRouter,
    toolGateway,
    policyEngine,
    logger,
    options: {
      maxSteps: options.maxSteps || 15
    }
  });

  const orchestrator = new Orchestrator({
    modelRouter,
    toolGateway,
    policyEngine,
    logger,
    options: {
      concurrency: options.concurrency || 4
    }
  });

  return {
    workspaceRoot,
    pathGuard,
    gitAdapter,
    policyEngine,
    securityEngine,
    workspaceIsolation,
    sandboxManager,
    toolGateway,
    toolRegistry: toolGateway.registry,
    sessionManager,
    runtimeController,
    contextManager: runtimeController.contextManager,
    providerRegistry,
    modelAdapter,
    cancellationManager,
    executionLoop,
    orchestrator,
    logger,
    modelRouter
  };
}

module.exports = {
  createAgentEngine,
  PathGuard,
  PolicyEngine,
  GitAdapter,
  ToolGateway,
  ToolRegistry,
  AgentExecutionLoop,
  Orchestrator,
  TaskScheduler,
  TaskStore,
  EventStore,
  AgentSharedMemory,
  MessageBus,
  AgentRegistry,
  ExecutionLogger,
  ModelRouter,
  ProviderRegistry,
  ModelAdapter,
  EventNormalizer,
  CancellationManager,
  SessionManager,
  RuntimeController,
  ContextManager,
  SecurityEngine,
  WorkspaceIsolation,
  SandboxManager
};
