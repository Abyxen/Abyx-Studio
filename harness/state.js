/**
 * Core States, Action Types, and Event Data Models for ABYX.
 */

const crypto = require('node:crypto');

const AgentState = {
  INIT: 'init',
  IDLE: 'idle',
  RUNNING: 'running',
  AWAITING_USER_INPUT: 'awaiting_user_input',
  AWAITING_CONFIRMATION: 'awaiting_user_confirmation',
  PAUSED: 'paused',
  STOPPED: 'stopped',
  FINISHED: 'finished',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
  ERROR: 'error'
};

const ConversationStatus = {
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  STOPPED: 'STOPPED',
  PAUSED: 'PAUSED',
  AWAITING_USER_INPUT: 'AWAITING_USER_INPUT',
  FINISHED: 'FINISHED',
  ERROR: 'ERROR'
};

const ActionType = {
  INITIALIZE: 'initialize',
  MESSAGE: 'message',
  SYSTEM: 'system',
  RUN_COMMAND: 'run',
  READ_FILE: 'read',
  WRITE_FILE: 'write',
  BROWSE: 'browse',
  THINK: 'think',
  TASK_TRACK: 'task_tracking',
  PLAN: 'plan',
  GENERATE_DOC: 'generate_doc',
  FINISH: 'finish',
  COMPLETE: 'complete',
  REJECT: 'reject',
  ASK_USER: 'ask_user',
  DELEGATE: 'delegate'
};

const TaskStatus = {
  TODO: 'todo',
  IN_PROGRESS: 'in_progress',
  DONE: 'done'
};

class Event {
  constructor(kind = 'generic', source = 'system', payload = {}, parentId = null) {
    this.eventId = `evt_${crypto.randomBytes(6).toString('hex')}`;
    this.timestamp = new Date().toISOString();
    this.kind = kind;
    this.source = source;
    this.payload = payload;
    this.parentId = parentId;
  }
}

class ActionEvent extends Event {
  constructor(actionType = ActionType.MESSAGE, args = {}, thought = null, parentId = null) {
    super('ActionEvent', 'agent', { actionType, args, thought }, parentId);
    this.actionType = actionType;
    this.args = args;
    this.thought = thought;
  }
}

class ObservationEvent extends Event {
  constructor(actionEventId, content = '', exitCode = 0, metadata = {}) {
    super('ObservationEvent', 'environment', { actionEventId, content, exitCode, metadata }, actionEventId);
    this.actionEventId = actionEventId;
    this.content = content;
    this.exitCode = exitCode;
    this.metadata = metadata;
  }
}

class MessageEvent extends Event {
  constructor(role = 'user', content = '', activatedSkills = []) {
    super('MessageEvent', role, { role, content, activatedSkills });
    this.role = role;
    this.content = content;
    this.activatedSkills = activatedSkills;
  }
}

module.exports = {
  AgentState,
  ConversationStatus,
  ActionType,
  TaskStatus,
  Event,
  ActionEvent,
  ObservationEvent,
  MessageEvent
};
