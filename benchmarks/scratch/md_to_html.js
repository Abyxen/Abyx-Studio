#!/usr/bin/env node
// md_to_html.js — Markdown to HTML converter (stdlib only)
'use strict';
const fs = require('fs');
const path = require('path');

function convertMarkdown(md) {
  let html = md
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/```[\s\S]*?```/g, (m) => '<pre><code>' + m.slice(3, -3).replace(/^[a-z]+\n/, '') + '</code></pre>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
    .replace(/^---$/gm, '<hr>')
    .replace(/<\/h[1-4]>\n<li>/g, '</h4>\n<ul><li>')
    .split('\n\n').map(p => {
      p = p.trim();
      if (!p) return '';
      if (/^<(h[1-4]|pre|ul|hr)/.test(p)) return p;
      if (p.includes('<li>')) return '<ul>' + p + '</ul>';
      return '<p>' + p + '</p>';
    }).join('\n');
  return html;
}

const filePath = process.argv[2];
if (!filePath) { console.error('Usage: node md_to_html.js <file.md>'); process.exit(1); }
if (!fs.existsSync(filePath)) { console.error('File not found: ' + filePath); process.exit(1); }
const md = fs.readFileSync(filePath, 'utf8');
const body = convertMarkdown(md);
const title = (md.match(/^# (.+)$/m) || ['', path.basename(filePath)])[1];
const full = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${title}</title></head><body>\n${body}\n</body></html>`;
const outPath = filePath.replace(/\.md$/, '.html');
fs.writeFileSync(outPath, full);
console.log('Written: ' + outPath);
