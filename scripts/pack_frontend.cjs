const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const zipPath = path.join(rootDir, 'abyx_frontend_design.zip');
const tempDir = path.join(rootDir, '.frontend_pkg_temp');

if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}
if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

fs.mkdirSync(tempDir, { recursive: true });

const srcDir = path.join(rootDir, 'app', 'frontend');
const distDir = path.join(rootDir, 'app', 'dist');

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const file of fs.readdirSync(src)) {
      if (file === 'node_modules' || file === '.vite' || file === '.vite-temp') continue;
      copyRecursive(path.join(src, file), path.join(dest, file));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

console.log('Staging frontend files for package...');
copyRecursive(path.join(srcDir, 'src'), path.join(tempDir, 'src'));
copyRecursive(path.join(srcDir, 'public'), path.join(tempDir, 'public'));
fs.copyFileSync(path.join(srcDir, 'index.html'), path.join(tempDir, 'index.html'));
fs.copyFileSync(path.join(srcDir, 'package.json'), path.join(tempDir, 'package.json'));
fs.copyFileSync(path.join(srcDir, 'vite.config.js'), path.join(tempDir, 'vite.config.js'));
copyRecursive(distDir, path.join(tempDir, 'dist'));

const readme = `# ABYX AI UI & Harness Frontend Design Package

This package contains the complete frontend source code, styles, themes, and production build for the ABYX Unified AI Studio.

## Directory Structure
- \`src/\`: React 19 source code
  - \`components/\`: UI components (TextChat, ModelManager, HarnessManager, MultiAgentWorkspace, Sidebar, Settings, etc.)
  - \`styles/\`: CSS stylesheet tokens, theme styling, glassmorphism layouts (\`abyx.css\`, \`models.css\`, \`images.css\`, \`voice.css\`, etc.)
  - \`services/\`: API adapters (\`api.js\`, \`harness_service.js\`)
- \`public/\`: Static web assets and icons
- \`dist/\`: Production Vite compiled bundle
- \`package.json\`: Dependencies and build scripts
- \`vite.config.js\`: Vite bundling configuration

## Quick Start for Customizing
1. Open this folder in your code editor.
2. Run \`npm install\` to install dependencies.
3. Run \`npm run dev\` to start the hot-reloading dev server.
4. Run \`npm run build\` to compile the production bundle into \`dist/\`.
`;

fs.writeFileSync(path.join(tempDir, 'README.md'), readme, 'utf8');

console.log('Compressing into zip archive...');
// Use python zipfile for fast standard zip creation
const pythonScript = `
import zipfile, os

zip_path = r"${zipPath}"
source_dir = r"${tempDir}"

with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
    for root, dirs, files in os.walk(source_dir):
        for file in files:
            file_path = os.path.join(root, file)
            arcname = os.path.relpath(file_path, source_dir)
            zipf.write(file_path, arcname)

print("ZIP created successfully. Size:", os.path.getsize(zip_path), "bytes")
`;

const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf8' });
if (res.error || res.status !== 0) {
  console.error('Python zip error:', res.stderr || res.error);
} else {
  console.log(res.stdout);
}

fs.rmSync(tempDir, { recursive: true, force: true });
console.log('Packaging complete:', zipPath);
