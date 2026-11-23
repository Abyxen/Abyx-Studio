const path = require('node:path');

const dataDir = path.resolve(process.env.ABYX_DATA_DIR || path.join(__dirname, 'app', 'data'));
const defaultWorkspaceDir = process.env.ABYX_DATA_DIR
  ? path.join(dataDir, 'workspace')
  : path.join(__dirname, 'app', 'workspace');
const workspaceDir = path.resolve(process.env.ABYX_WORKSPACE_DIR || defaultWorkspaceDir);

module.exports = { dataDir, workspaceDir };
