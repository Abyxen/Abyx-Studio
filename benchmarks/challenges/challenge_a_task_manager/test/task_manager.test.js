const test = require('node:test');
const assert = require('node:assert/strict');
const { TaskManagerApp } = require('../server.js');

test('TaskManagerApp CRUD operations', () => {
  const app = new TaskManagerApp(':memory:');

  // Create
  const task1 = app.createTask('Implement Benchmark Suite', '100 tests', 'high');
  assert.equal(task1.title, 'Implement Benchmark Suite');
  assert.equal(task1.status, 'pending');
  assert.equal(task1.priority, 'high');

  const task2 = app.createTask('Verify Local GPU', 'Check CUDA', 'medium');
  assert.equal(task2.id, 2);

  // List
  const allTasks = app.listTasks();
  assert.equal(allTasks.length, 2);

  // Update
  const updated = app.updateTask(task1.id, { status: 'completed' });
  assert.equal(updated.status, 'completed');

  const completedTasks = app.listTasks('completed');
  assert.equal(completedTasks.length, 1);
  assert.equal(completedTasks[0].id, task1.id);

  // Delete
  const deleted = app.deleteTask(task2.id);
  assert.equal(deleted, true);
  assert.equal(app.listTasks().length, 1);
});
