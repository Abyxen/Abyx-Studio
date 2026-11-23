/**
 * ABYX Automations Subsystem — Master Entrypoint
 */

const AutomationEngine = require('./automation_engine');
const WorkflowGenerator = require('./workflow_generator');
const types = require('./types');

function createAutomationEngine(options = {}) {
  return new AutomationEngine(options);
}

module.exports = {
  createAutomationEngine,
  AutomationEngine,
  WorkflowGenerator,
  ...types
};
