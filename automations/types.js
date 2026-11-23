/**
 * ABYX Automations Subsystem — Data Contracts & Types
 */

const AutomationStatus = {
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  SUCCESS: 'success',
  FAILED: 'failed'
};

const TriggerType = {
  MANUAL: 'manual',
  INTERVAL: 'interval',
  CRON: 'cron'
};

/**
 * Creates a structured automation record
 */
function createAutomationRecord({
  id,
  name,
  description,
  triggerType = TriggerType.INTERVAL,
  intervalMinutes = 60,
  cronExpression = null,
  steps = [],
  requiredPermissions = [],
  enabled = true
}) {
  const autoId = id || `auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  let nextRun = null;
  if (triggerType === TriggerType.INTERVAL && intervalMinutes > 0 && enabled) {
    nextRun = new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString();
  }

  return {
    id: autoId,
    name: name || 'Untitled Automation',
    description: description || '',
    trigger: {
      type: triggerType,
      intervalMinutes: Number(intervalMinutes) || 0,
      cronExpression: cronExpression || null,
      summary: triggerType === TriggerType.MANUAL ? 'Manual execution' : `Every ${intervalMinutes} minutes`
    },
    steps: steps.map((s, idx) => ({
      id: s.id || `step_${idx + 1}`,
      stepNumber: idx + 1,
      name: s.name || `Step ${idx + 1}`,
      tool: s.tool || 'custom_task',
      args: s.args || {},
      description: s.description || '',
      timeoutMs: s.timeoutMs || 15000
    })),
    requiredPermissions: Array.isArray(requiredPermissions) ? requiredPermissions : [],
    enabled: enabled !== false,
    status: enabled ? AutomationStatus.IDLE : AutomationStatus.PAUSED,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastRun: null,
    nextRun,
    lastStatus: 'pending',
    lastLog: 'Configured and ready.',
    durationMs: 0,
    runHistory: []
  };
}

module.exports = {
  AutomationStatus,
  TriggerType,
  createAutomationRecord
};
