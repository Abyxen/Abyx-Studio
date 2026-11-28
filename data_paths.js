const path = require('node:path');
const os = require('node:os');

const docsAbyx = path.join(os.homedir(), 'Documents', '.abyx');
const dataDir = path.resolve(process.env.ABYX_DATA_DIR || path.join(docsAbyx, 'data'));
const defaultWorkspaceDir = path.join(docsAbyx, 'workspace');
const workspaceDir = path.resolve(process.env.ABYX_WORKSPACE_DIR || defaultWorkspaceDir);
const outputsDir = path.resolve(process.env.ABYX_OUTPUTS_DIR || path.join(docsAbyx, 'outputs'));

module.exports = { dataDir, workspaceDir, outputsDir, docsAbyx };
