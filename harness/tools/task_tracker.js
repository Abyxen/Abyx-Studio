/**
 * Task Tracker Tool
 * Manages discrete task decomposition items, status tracking, and dependency completion checks.
 */

class TaskTrackerTool {
  constructor() {
    this.name = 'task_tracker';
    this.description = 'Creates, updates, tracks, and lists structured tasks during agent execution.';
    this.tasks = new Map();
  }

  getSchema() {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create_task', 'update_status', 'list_tasks', 'get_summary'],
          description: 'Task tracker action'
        },
        taskId: { type: 'string', description: 'Unique ID for the task' },
        title: { type: 'string', description: 'Title or short summary of the task' },
        status: {
          type: 'string',
          enum: ['todo', 'in_progress', 'completed', 'blocked', 'skipped'],
          description: 'Status of the task'
        },
        dependencies: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of task IDs that must complete first'
        }
      },
      required: ['action']
    };
  }

  async execute(args) {
    const { action, taskId, title, status, dependencies } = args;

    switch (action) {
      case 'create_task': {
        if (!taskId) return { error: 'taskId is required for create_task' };
        const task = {
          id: taskId,
          title: title || taskId,
          status: status || 'todo',
          dependencies: dependencies || [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        this.tasks.set(taskId, task);
        return { message: `Task ${taskId} created`, task };
      }

      case 'update_status': {
        if (!taskId) return { error: 'taskId is required for update_status' };
        if (!this.tasks.has(taskId)) return { error: `Task ${taskId} not found` };
        const task = this.tasks.get(taskId);
        if (status) task.status = status;
        task.updatedAt = new Date().toISOString();
        return { message: `Task ${taskId} updated to ${status}`, task };
      }

      case 'list_tasks': {
        return {
          total: this.tasks.size,
          tasks: Array.from(this.tasks.values())
        };
      }

      case 'get_summary': {
        const all = Array.from(this.tasks.values());
        const total = all.length;
        const completed = all.filter(t => t.status === 'completed').length;
        const inProgress = all.filter(t => t.status === 'in_progress').length;
        const blocked = all.filter(t => t.status === 'blocked').length;
        const todo = all.filter(t => t.status === 'todo').length;
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
        return {
          total,
          completed,
          inProgress,
          blocked,
          todo,
          percentComplete: `${percent}%`
        };
      }

      default:
        return { error: `Unknown task_tracker action: ${action}` };
    }
  }
}

module.exports = { TaskTrackerTool };
