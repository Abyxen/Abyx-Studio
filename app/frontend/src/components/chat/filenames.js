export function inferFilenameFromPrompt(prompt, defaultExt = "html") {
  if (!prompt || typeof prompt !== "string") return `site.${defaultExt}`;

  // 1. Explicit filename with extension mentioned by user: e.g. "about.html", "contact_us.html", "calc.py"
  const explicitMatch = prompt.match(/\b([a-zA-Z0-9_-]+\.(?:html?|css|js|py|json|svg))\b/i);
  if (explicitMatch && explicitMatch[1]) {
    return explicitMatch[1].toLowerCase();
  }

  // 2. Specific named page request: e.g. "named weather_app", "called bar"
  const namedMatch = prompt.match(/(?:named|called|filename)\s*[:=]?\s*["']?([a-zA-Z0-9_-]+)["']?/i);
  if (namedMatch && namedMatch[1] && !/^(an?|the|this|my|a|it|file|named|called)$/i.test(namedMatch[1])) {
    const rawName = namedMatch[1].toLowerCase();
    return rawName.includes(".") ? rawName : `${rawName}.${defaultExt}`;
  }

  // 3. Self/Profile detection
  if (/\b(yourself|about you|about yourself|who are you|your bio|profile)\b/i.test(prompt)) {
    return `abyx_profile.${defaultExt}`;
  }

  // 4. Clean prompt words
  const clean = prompt
    .replace(/<[^>]+>/g, "")
    .replace(/\b(can you|please|could you|i want you to|i want|help me|make|create|build|generate|code|develop|design|write|an?|the|website|webpage|web page|site|app|application|page|in|using|with|html5?|css|javascript|js|named|called|filename|file)\b/gi, " ")
    .replace(/[^a-zA-Z0-9\s_-]/g, " ")
    .trim();

  const stopwords = new Set([
    "for", "about", "of", "to", "and", "on", "at", "by", "from", "my", "me", "your",
    "this", "that", "it", "is", "a", "an", "the", "some", "any", "all", "new", "one",
    "like", "just", "well", "rn", "now"
  ]);

  const words = clean.split(/\s+/)
    .map(w => w.toLowerCase())
    .filter(w => w.length > 1 && !stopwords.has(w));

  if (words.length > 0) {
    const slug = words.slice(0, 3).join("_");
    if (slug.length >= 2) {
      return `${slug}.${defaultExt}`;
    }
  }

  return `site.${defaultExt}`;
}

export function formatBytesShort(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function triggerDownload(href, filename) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
