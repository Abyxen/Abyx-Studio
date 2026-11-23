const path = require('node:path');
const fs = require('node:fs');
const { dataDir } = require('../data_paths');
const { createAutomationEngine, WorkflowGenerator } = require('../automations/index');

const engines = new Map();
const profileSegment = profileId => String(profileId || 'prof_default').replace(/[^a-zA-Z0-9_-]/g, '_');

function getEngine(profileId = 'prof_default') {
  const pid = profileSegment(profileId);
  if (!engines.has(pid)) {
    const root = path.join(dataDir, 'profiles', pid, 'automations');
    const storageFile = path.join(root, 'automations.json');
    if (pid === 'prof_default' && !fs.existsSync(storageFile)) {
      const legacy = path.join(dataDir, 'automations.json');
      if (fs.existsSync(legacy)) {
        fs.mkdirSync(root, { recursive: true });
        fs.copyFileSync(legacy, storageFile);
      }
    }
    engines.set(pid, createAutomationEngine({ storageFile }));
  }
  return engines.get(pid);
}

function loadTasks(profileId = 'prof_default') { return getEngine(profileId).listAutomations(); }
function saveTasks(tasks, profileId = 'prof_default') {
  if (!Array.isArray(tasks)) return;
  const engine = getEngine(profileId);
  engine.automations.clear();
  for (const task of tasks) engine.automations.set(task.id, task);
  engine.save();
}
async function runTask(id, profileId = 'prof_default') {
  return getEngine(profileId).runAutomation(id, 'manual');
}
function createTask(data, profileId = 'prof_default') { return getEngine(profileId).createAutomation(data); }
function deleteTask(id, profileId = 'prof_default') { return getEngine(profileId).deleteAutomation(id); }
function pauseTask(id, profileId = 'prof_default') { return getEngine(profileId).pauseAutomation(id); }
function resumeTask(id, profileId = 'prof_default') { return getEngine(profileId).resumeAutomation(id); }
function proposeWorkflow(prompt) { return WorkflowGenerator.proposeWorkflow(prompt); }

module.exports = { getEngine, loadTasks, saveTasks, runTask, createTask, deleteTask, pauseTask, resumeTask, proposeWorkflow };
