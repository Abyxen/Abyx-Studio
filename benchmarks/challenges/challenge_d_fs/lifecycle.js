const fs = require('fs');
const path = require('path');

// Challenge D: Filesystem Lifecycle Automation
const workspace = path.join(__dirname, 'workspace');
if (fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true });
fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
fs.mkdirSync(path.join(workspace, 'dist'), { recursive: true });

fs.writeFileSync(path.join(workspace, 'src', 'index.js'), 'console.log("Challenge D Active");');
fs.writeFileSync(path.join(workspace, 'README.md'), '# Challenge D Workspace');

console.log('Challenge D lifecycle complete: initialized directory structure and staged manifests.');
