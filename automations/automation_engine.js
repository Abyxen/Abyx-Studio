/**
 * ABYX Automations Subsystem — Master Automation & Scheduler Engine
 * 
 * Provides:
 * - Structured automation CRUD & persistence in data/automations.json
 * - Reliable interval & cron timer scheduling
 * - Manual test-run & trigger controls (runNow, pause, resume)
 * - Step-by-step execution visibility with live event emissions
 * - Detailed runHistory tracking duration, status, and logs
 * - Graceful failure & interruption containment
 */

const fs = require('node:fs');
const path = require('node:path');
const { dataDir } = require('../data_paths');
const { EventEmitter } = require('node:events');
const { AutomationStatus, TriggerType, createAutomationRecord } = require('./types');

const DEFAULT_AUTOMATIONS_FILE = path.join(dataDir, 'automations.json');

class AutomationEngine extends EventEmitter {
  constructor({ storageFile = DEFAULT_AUTOMATIONS_FILE, policyEngine = null, agentEngine = null, checkIntervalMs = 15000 } = {}) {
    super();
    this.storageFile = storageFile;
    this.policyEngine = policyEngine;
    this.agentEngine = agentEngine;
    this.checkIntervalMs = checkIntervalMs;
    this.timer = null;
    this.automations = new Map();

    this.load();
    this.startScheduler();
  }

  /**
   * Loads and normalizes automations from disk
   */
  load() {
    this.automations.clear();
    if (!fs.existsSync(this.storageFile)) {
      return;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(this.storageFile, 'utf8'));
      if (Array.isArray(raw)) {
        for (const item of raw) {
          // Normalize legacy tasks into structured format if needed
          const record = item.trigger && item.steps
            ? item
            : this.normalizeLegacyTask(item);

          this.automations.set(record.id, record);
        }
      }
    } catch (err) {
      console.warn('[AutomationEngine] Error reading automations file:', err.message);
    }
  }

  /**
   * Converts legacy automation task structure to modern structured format
   */
  normalizeLegacyTask(legacy) {
    const interval = Number(legacy.intervalMinutes || legacy.interval) || 0;
    const triggerType = interval > 0 ? TriggerType.INTERVAL : TriggerType.MANUAL;
    const steps = [];

    if (legacy.action === 'vault_sync') {
      steps.push({ id: 'step_1', name: 'Vault Sync', tool: 'vault_sync', description: 'Sync Obsidian Vault' });
    } else if (legacy.action === 'memory_synth') {
      steps.push({ id: 'step_1', name: 'Memory Review', tool: 'memory_synth', description: 'Synthesize Chat Memory' });
    } else {
      steps.push({
        id: 'step_1',
        name: legacy.name || 'Custom Step',
        tool: legacy.action || 'custom_task',
        description: legacy.task || legacy.prompt || legacy.description || ''
      });
    }

    return createAutomationRecord({
      id: legacy.id,
      name: legacy.name,
      description: legacy.task || legacy.prompt || legacy.description || legacy.name,
      triggerType,
      intervalMinutes: interval,
      steps,
      enabled: legacy.enabled !== false
    });
  }

  /**
   * Persists automations to disk
   */
  save() {
    try {
      const dir = path.dirname(this.storageFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const list = Array.from(this.automations.values());
      fs.writeFileSync(this.storageFile, JSON.stringify(list, null, 2), 'utf8');
    } catch (err) {
      console.error('[AutomationEngine] Error saving automations:', err.message);
    }
  }

  /**
   * Starts the background scheduler loop
   */
  startScheduler() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.checkScheduledAutomations();
    }, this.checkIntervalMs);
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  /**
   * Stops the background scheduler loop
   */
  stopScheduler() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Checks due automations and triggers execution
   */
  async checkScheduledAutomations() {
    const now = Date.now();
    for (const auto of this.automations.values()) {
      if (
        auto.enabled &&
        auto.status !== AutomationStatus.RUNNING &&
        auto.trigger.type === TriggerType.INTERVAL &&
        auto.nextRun &&
        now >= new Date(auto.nextRun).getTime()
      ) {
        // Calculate next run immediately
        const intervalMs = (auto.trigger.intervalMinutes || 60) * 60 * 1000;
        auto.nextRun = new Date(now + intervalMs).toISOString();
        this.save();

        this.runAutomation(auto.id, 'scheduled').catch(err => {
          console.warn(`[AutomationEngine] Scheduled task "${auto.name}" failed:`, err.message);
        });
      }
    }
  }

  /**
   * Lists all automations
   */
  listAutomations() {
    return Array.from(this.automations.values());
  }

  /**
   * Retrieves a single automation by ID
   */
  getAutomation(id) {
    return this.automations.get(id) || null;
  }

  /**
   * Creates a new structured automation
   */
  createAutomation(data) {
    const record = createAutomationRecord(data);
    this.automations.set(record.id, record);
    this.save();
    this.emit('automation:created', record);
    return record;
  }

  /**
   * Updates an existing automation
   */
  updateAutomation(id, updates = {}) {
    const existing = this.automations.get(id);
    if (!existing) throw new Error(`Automation "${id}" not found`);

    if (updates.name) existing.name = updates.name;
    if (updates.description) existing.description = updates.description;
    if (updates.steps && Array.isArray(updates.steps)) existing.steps = updates.steps;
    if (updates.trigger) {
      existing.trigger = { ...existing.trigger, ...updates.trigger };
      if (existing.trigger.intervalMinutes > 0 && existing.enabled) {
        existing.nextRun = new Date(Date.now() + existing.trigger.intervalMinutes * 60000).toISOString();
      }
    }
    if (typeof updates.enabled === 'boolean') {
      existing.enabled = updates.enabled;
      existing.status = updates.enabled ? AutomationStatus.IDLE : AutomationStatus.PAUSED;
      if (updates.enabled && existing.trigger.intervalMinutes > 0) {
        existing.nextRun = new Date(Date.now() + existing.trigger.intervalMinutes * 60000).toISOString();
      } else {
        existing.nextRun = null;
      }
    }

    existing.updatedAt = new Date().toISOString();
    this.save();
    this.emit('automation:updated', existing);
    return existing;
  }

  /**
   * Pauses an automation
   */
  pauseAutomation(id) {
    return this.updateAutomation(id, { enabled: false });
  }

  /**
   * Resumes a paused automation
   */
  resumeAutomation(id) {
    return this.updateAutomation(id, { enabled: true });
  }

  /**
   * Deletes an automation
   */
  deleteAutomation(id) {
    const exists = this.automations.has(id);
    if (!exists) return false;
    this.automations.delete(id);
    this.save();
    this.emit('automation:deleted', id);
    return true;
  }

  /**
   * Executes an automation workflow (manual test-run or scheduled)
   */
  async runAutomation(id, triggerSource = 'manual') {
    const auto = this.automations.get(id);
    if (!auto) throw new Error(`Automation "${id}" not found`);

    auto.status = AutomationStatus.RUNNING;
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const startTime = Date.now();

    this.emit('automation:started', { id: auto.id, name: auto.name, runId, triggerSource });

    let runStatus = 'success';
    let runLog = '';
    const executedSteps = [];

    try {
      for (const step of auto.steps) {
        this.emit('automation:step', { id: auto.id, runId, stepNumber: step.stepNumber, stepName: step.name });

        let stepOutput;
        // 1. Built-in actions
        if (step.tool === 'vault_sync') {
          const obsidianVault = require('../services/obsidian_vault');
          const syncRes = await obsidianVault.syncAll();
          stepOutput = `Vault sync: ${syncRes?.updated || 0} files updated.`;
        } else if (step.tool === 'memory_synth') {
          throw new Error('Memory synthesis is not connected to an execution service.');
        } else if (this.agentEngine) {
          // 2. Dispatch through Agent Execution Engine
          const toolRes = await this.agentEngine.executeToolInternal(step.tool, step.args || {}, null);
          if (!toolRes.success) {
            throw new Error(`Step ${step.stepNumber} (${step.name}) failed: ${toolRes.output?.error || 'Execution error'}`);
          }
          stepOutput = toolRes.output?.message || 'Completed';
        } else {
          throw new Error(`No executor is configured for automation step "${step.tool || step.name}".`);
        }

        executedSteps.push({
          stepNumber: step.stepNumber,
          name: step.name,
          tool: step.tool,
          output: stepOutput
        });
      }

      runLog = `Workflow completed ${executedSteps.length} steps successfully.`;
    } catch (err) {
      runStatus = 'failed';
      runLog = `Workflow interrupted: ${err.message}`;
    }

    const durationMs = Date.now() - startTime;
    auto.status = auto.enabled ? AutomationStatus.IDLE : AutomationStatus.PAUSED;
    auto.lastRun = new Date().toISOString();
    auto.lastStatus = runStatus;
    auto.lastLog = runLog;
    auto.durationMs = durationMs;

    // Append to Run History (capped at 30 entries)
    if (!Array.isArray(auto.runHistory)) auto.runHistory = [];
    auto.runHistory.unshift({
      runId,
      triggerSource,
      startedAt: new Date(startTime).toISOString(),
      finishedAt: auto.lastRun,
      status: runStatus,
      durationMs,
      log: runLog,
      stepsExecuted: executedSteps.length
    });
    if (auto.runHistory.length > 30) {
      auto.runHistory = auto.runHistory.slice(0, 30);
    }

    this.save();

    const eventPayload = {
      id: auto.id,
      name: auto.name,
      runId,
      status: runStatus,
      durationMs,
      log: runLog
    };

    if (runStatus === 'success') {
      this.emit('automation:completed', eventPayload);
    } else {
      this.emit('automation:failed', eventPayload);
    }

    return {
      success: runStatus === 'success',
      runId,
      status: runStatus,
      durationMs,
      log: runLog,
      automation: auto
    };
  }
}

module.exports = AutomationEngine;
