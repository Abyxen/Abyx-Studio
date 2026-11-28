// Maps the many fence names models emit to a highlight.js grammar, a display label,
// a download extension and a MIME type.
const LANGUAGE_TABLE = [
  { id: "javascript", label: "JavaScript", ext: "js", mime: "text/javascript", aliases: ["js", "javascript", "node", "mjs", "cjs", "jsx"] },
  { id: "typescript", label: "TypeScript", ext: "ts", mime: "text/typescript", aliases: ["ts", "typescript", "tsx", "mts", "cts"] },
  { id: "python", label: "Python", ext: "py", mime: "text/x-python", aliases: ["py", "python", "python3", "py3", "ipython"] },
  { id: "xml", label: "HTML", ext: "html", mime: "text/html;charset=utf-8", aliases: ["html", "htm", "xhtml", "vue", "svelte"] },
  { id: "xml", label: "XML", ext: "xml", mime: "application/xml", aliases: ["xml", "plist", "xaml", "csproj"] },
  { id: "xml", label: "SVG", ext: "svg", mime: "image/svg+xml", aliases: ["svg"] },
  { id: "css", label: "CSS", ext: "css", mime: "text/css", aliases: ["css"] },
  { id: "scss", label: "SCSS", ext: "scss", mime: "text/x-scss", aliases: ["scss", "sass", "less"] },
  { id: "json", label: "JSON", ext: "json", mime: "application/json", aliases: ["json", "jsonc", "json5", "geojson"] },
  { id: "sql", label: "SQL", ext: "sql", mime: "application/sql", aliases: ["sql", "sqlite", "postgres", "postgresql", "mysql", "plsql", "tsql"] },
  { id: "csharp", label: "C#", ext: "cs", mime: "text/x-csharp", aliases: ["cs", "csharp", "c#"] },
  { id: "java", label: "Java", ext: "java", mime: "text/x-java", aliases: ["java"] },
  { id: "cpp", label: "C++", ext: "cpp", mime: "text/x-c++src", aliases: ["cpp", "c++", "cc", "cxx", "hpp", "hxx"] },
  { id: "c", label: "C", ext: "c", mime: "text/x-csrc", aliases: ["c", "h"] },
  { id: "bash", label: "Bash", ext: "sh", mime: "text/x-sh", aliases: ["bash", "sh", "zsh", "shell", "console", "terminal"] },
  { id: "powershell", label: "PowerShell", ext: "ps1", mime: "text/plain", aliases: ["powershell", "ps1", "pwsh", "ps"] },
  { id: "dos", label: "Batch", ext: "bat", mime: "text/plain", aliases: ["bat", "cmd", "batch", "dos"] },
  { id: "go", label: "Go", ext: "go", mime: "text/x-go", aliases: ["go", "golang"] },
  { id: "rust", label: "Rust", ext: "rs", mime: "text/x-rust", aliases: ["rust", "rs"] },
  { id: "php", label: "PHP", ext: "php", mime: "text/x-php", aliases: ["php"] },
  { id: "ruby", label: "Ruby", ext: "rb", mime: "text/x-ruby", aliases: ["ruby", "rb"] },
  { id: "kotlin", label: "Kotlin", ext: "kt", mime: "text/x-kotlin", aliases: ["kotlin", "kt", "kts"] },
  { id: "swift", label: "Swift", ext: "swift", mime: "text/x-swift", aliases: ["swift"] },
  { id: "yaml", label: "YAML", ext: "yaml", mime: "text/yaml", aliases: ["yaml", "yml"] },
  { id: "ini", label: "TOML", ext: "toml", mime: "text/plain", aliases: ["toml", "ini", "cfg", "conf", "env", "dotenv"] },
  { id: "markdown", label: "Markdown", ext: "md", mime: "text/markdown", aliases: ["md", "markdown", "mdx"] },
  { id: "diff", label: "Diff", ext: "diff", mime: "text/x-diff", aliases: ["diff", "patch"] },
  { id: "dockerfile", label: "Dockerfile", ext: "dockerfile", mime: "text/plain", aliases: ["dockerfile", "docker"] },
  { id: "plaintext", label: "Text", ext: "txt", mime: "text/plain", aliases: ["text", "txt", "plaintext", "plain", "output", "log"] },
];

const ALIAS_INDEX = new Map();
for (const entry of LANGUAGE_TABLE) {
  for (const alias of entry.aliases) {
    if (!ALIAS_INDEX.has(alias)) ALIAS_INDEX.set(alias, entry);
  }
}

const BY_HLJS_ID = new Map();
for (const entry of LANGUAGE_TABLE) {
  if (!BY_HLJS_ID.has(entry.id)) BY_HLJS_ID.set(entry.id, entry);
}

export function resolveLanguage(rawLang) {
  const key = String(rawLang || "").trim().toLowerCase().split(/[\s{:]/)[0];
  if (!key) return null;
  return ALIAS_INDEX.get(key) || null;
}

export function languageFromHljsId(id) {
  return BY_HLJS_ID.get(id) || null;
}

// Content sniffing for unlabeled fences, run before the more expensive auto-detection.
export function sniffLanguage(code) {
  const head = code.trimStart().slice(0, 400);
  if (/^<!DOCTYPE html|^<html[\s>]/i.test(head)) return ALIAS_INDEX.get("html");
  if (/^<svg[\s>]/i.test(head)) return ALIAS_INDEX.get("svg");
  if (/^#!.*\b(?:bash|sh|zsh)\b/.test(head)) return ALIAS_INDEX.get("bash");
  if (/^#!.*\bpython/.test(head)) return ALIAS_INDEX.get("python");
  if (/^\s*[{[][\s\S]*[}\]]\s*$/.test(code.trim()) && isJson(code)) return ALIAS_INDEX.get("json");
  if (/^(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|WITH)\s/i.test(head)) return ALIAS_INDEX.get("sql");
  if (/^(?:diff --git|--- a\/|\+\+\+ b\/|@@ )/m.test(head)) return ALIAS_INDEX.get("diff");
  return null;
}

function isJson(code) {
  try {
    JSON.parse(code);
    return true;
  } catch (_) {
    return false;
  }
}

export const MEDIA_EXTENSIONS = /\.(?:png|jpe?g|webp|gif|ico|bmp|tiff|avif|wav|mp3|ogg|flac|m4a|aac|mp4|webm|mov|m4v)$/i;
export const AUDIO_URL = /\.(?:wav|mp3|ogg|flac|m4a|aac)(?:[?#].*)?$/i;
export const VIDEO_URL = /\.(?:mp4|webm|mov|m4v|ogv)(?:[?#].*)?$/i;
