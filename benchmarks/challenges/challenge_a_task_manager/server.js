const http = require('http');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

class TaskManagerApp {
  constructor(dbPath = ':memory:') {
    this.db = new DatabaseSync(dbPath);
    this.initDb();
  }

  initDb() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'pending',
        priority TEXT DEFAULT 'medium',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  createTask(title, description = '', priority = 'medium') {
    const stmt = this.db.prepare('INSERT INTO tasks (title, description, priority) VALUES (?, ?, ?)');
    const result = stmt.run(title, description, priority);
    return this.getTask(result.lastInsertRowid);
  }

  getTask(id) {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    return stmt.get(id);
  }

  listTasks(status = null) {
    if (status) {
      const stmt = this.db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY id DESC');
      return stmt.all(status);
    }
    const stmt = this.db.prepare('SELECT * FROM tasks ORDER BY id DESC');
    return stmt.all();
  }

  updateTask(id, updates) {
    const existing = this.getTask(id);
    if (!existing) return null;
    const title = updates.title ?? existing.title;
    const description = updates.description ?? existing.description;
    const status = updates.status ?? existing.status;
    const priority = updates.priority ?? existing.priority;

    const stmt = this.db.prepare('UPDATE tasks SET title = ?, description = ?, status = ?, priority = ? WHERE id = ?');
    stmt.run(title, description, status, priority, id);
    return this.getTask(id);
  }

  deleteTask(id) {
    const existing = this.getTask(id);
    if (!existing) return false;
    const stmt = this.db.prepare('DELETE FROM tasks WHERE id = ?');
    stmt.run(id);
    return true;
  }
}

function createServer(appInstance) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = url.pathname;

    const sendJson = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    if (req.method === 'GET' && pathname === '/api/tasks') {
      const status = url.searchParams.get('status');
      return sendJson(200, { ok: true, tasks: appInstance.listTasks(status) });
    }

    if (req.method === 'POST' && pathname === '/api/tasks') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          if (!parsed.title) return sendJson(400, { ok: false, error: 'Title required' });
          const task = appInstance.createTask(parsed.title, parsed.description, parsed.priority);
          sendJson(201, { ok: true, task });
        } catch (e) {
          sendJson(400, { ok: false, error: e.message });
        }
      });
      return;
    }

    if (req.method === 'PATCH' && pathname.startsWith('/api/tasks/')) {
      const id = parseInt(pathname.split('/')[3], 10);
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const updated = appInstance.updateTask(id, parsed);
          if (!updated) return sendJson(404, { ok: false, error: 'Task not found' });
          sendJson(200, { ok: true, task: updated });
        } catch (e) {
          sendJson(400, { ok: false, error: e.message });
        }
      });
      return;
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/tasks/')) {
      const id = parseInt(pathname.split('/')[3], 10);
      const deleted = appInstance.deleteTask(id);
      if (!deleted) return sendJson(404, { ok: false, error: 'Task not found' });
      return sendJson(200, { ok: true, deleted: true });
    }

    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      const htmlPath = path.join(__dirname, 'public', 'index.html');
      if (fs.existsSync(htmlPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return fs.createReadStream(htmlPath).pipe(res);
      }
    }

    sendJson(404, { ok: false, error: 'Not found' });
  });
}

if (require.main === module) {
  const dbFile = path.join(__dirname, 'tasks.db');
  const appInstance = new TaskManagerApp(dbFile);
  const server = createServer(appInstance);
  server.listen(3333, '127.0.0.1', () => {
    console.log('Task Manager App running on http://127.0.0.1:3333');
  });
}

module.exports = { TaskManagerApp, createServer };
