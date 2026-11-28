const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '../app/frontend/src');
const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

function walk(dir) {
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    if (fs.statSync(full).isDirectory()) {
      walk(full);
    } else if (/\.(jsx?|css)$/.test(item)) {
      const text = fs.readFileSync(full, 'utf8');
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (emojiRegex.test(line)) {
          console.log(`${path.relative(srcDir, full)}:${i + 1} -> ${line.trim()}`);
        }
      });
    }
  }
}

walk(srcDir);
