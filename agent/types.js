/**
 * ABYX Agentic Engine — Type Definitions & Data Contracts
 * 
 * Formal interfaces for:
 * - AgentRun, Plan, Step, ToolCall, ToolResult
 * - Human Approval Requests & Decisions
 * - Live Activity Timeline Events
 * - Cancellation & Execution Telemetry
 */

const AgentRunStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  WAITING_APPROVAL: 'waiting_approval',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

const StepStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  WAITING_APPROVAL: 'waiting_approval',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped'
};

const RiskLevel = {
  SAFE: 'SAFE',
  REQUIRES_APPROVAL: 'REQUIRES_APPROVAL',
  DENIED: 'DENIED'
};

const ApprovalStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  DENIED: 'denied',
  TIMED_OUT: 'timed_out'
};

/**
 * Creates a structured execution plan
 */
function createPlan(goal, rawSteps = []) {
  const steps = rawSteps.map((s, idx) => ({
    id: `step_${idx + 1}_${Math.random().toString(36).slice(2, 7)}`,
    stepNumber: idx + 1,
    description: typeof s === 'string' ? s : (s.description || `Step ${idx + 1}`),
    tool: typeof s === 'object' ? s.tool : null,
    status: StepStatus.PENDING,
    toolCalls: [],
    startTime: null,
    endTime: null,
    error: null
  }));

  return {
    id: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    goal: goal || 'Untitled Task',
    steps,
    totalSteps: steps.length,
    currentStepIndex: 0,
    createdAt: new Date().toISOString()
  };
}

/**
 * Creates an agent execution run record
 */
function createAgentRun({ id, sessionId, profileId, goal, model, plan, maxSteps = 8 }) {
  const runId = id || `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: runId,
    sessionId: sessionId || `session_${Date.now()}`,
    profileId: profileId || 'prof_default',
    goal: goal || 'Autonomous execution',
    model: model || 'abyx:1.1',
    status: AgentRunStatus.PENDING,
    plan: plan || createPlan(goal),
    currentStepIndex: 0,
    maxSteps,
    stepsExecuted: 0,
    toolsExecuted: 0,
    approvalsRequested: 0,
    approvalsGranted: 0,
    approvalsDenied: 0,
    startTime: new Date().toISOString(),
    endTime: null,
    error: null,
    output: null,
    timeline: []
  };
}

/**
 * Creates a normalized tool call object
 */
function createToolCall({ id, name, args = {}, riskLevel = RiskLevel.SAFE, stepNumber = 1 }) {
  return {
    id: id || `tc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    args: typeof args === 'object' && args !== null ? args : {},
    riskLevel,
    stepNumber,
    status: 'pending',
    approvalId: null,
    requestedAt: new Date().toISOString(),
    executedAt: null,
    completedAt: null,
    durationMs: null,
    result: null,
    error: null
  };
}

/**
 * Creates an approval request for dangerous / high-impact operations
 */
function createApprovalRequest({ id, runId, stepNumber, toolCallId, toolName, args, riskLevel, reason, preview }) {
  return {
    id: id || `appr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    runId,
    stepNumber: stepNumber || 1,
    toolCallId,
    toolName,
    args: args || {},
    riskLevel: riskLevel || RiskLevel.REQUIRES_APPROVAL,
    reason: reason || 'Operation modifies system or external state',
    preview: preview || null,
    status: ApprovalStatus.PENDING,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    decision: null // 'approve' | 'deny'
  };
}

/**
 * Formats a live timeline event
 */
function createTimelineEvent(type, payload = {}) {
  return {
    type,
    timestamp: new Date().toISOString(),
    ...payload
  };
}

module.exports = {
  AgentRunStatus,
  StepStatus,
  RiskLevel,
  ApprovalStatus,
  createPlan,
  createAgentRun,
  createToolCall,
  createApprovalRequest,
  createTimelineEvent
};
