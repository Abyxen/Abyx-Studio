import React, { memo, useMemo } from "react";
import katex from "katex";
import CodeBlock from "./CodeBlock";
import { AudioPlayer, ImageCard, ImageGallery, VideoPlayer } from "./MediaBlocks";
import { MEDIA_EXTENSIONS, AUDIO_URL, VIDEO_URL } from "./languages";
import "./chat-render.css";

/* ─── Normalisation: detect unfenced code and raw JSON ────────── */

const MEDIA_EXT_LIST = ["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff", "wav", "mp3", "ogg", "flac", "m4a"];

export function ensureFencedCode(content) {
  if (typeof content !== "string") return "";
  if (content.includes("```") || content.includes("~~~")) return content;
  const text = content.trim();

  // A path comment followed by code, e.g. <!-- path: index.html --> or # path: main.py
  const fileCommentRegex = /(?:^|\n)((?:<!--|\/\/|#|\/\*)\s*(?:path|filename|file|name):\s*([a-zA-Z0-9_./-]+)\s*(?:-->|\*\/)?[\s\S]*)$/i;
  const commentMatch = text.match(fileCommentRegex);
  if (commentMatch && commentMatch[1]) {
    const ext = commentMatch[2].split(".").pop().toLowerCase();
    if (MEDIA_EXT_LIST.includes(ext)) {
      return text.replace(/(?:^|\n)(?:<!--|\/\/|#|\/\*)\s*(?:path|filename|file|name):\s*[a-zA-Z0-9_./-]+\.(?:png|jpe?g|gif|webp|ico|bmp|tiff|wav|mp3|ogg|flac|m4a)\s*(?:-->|\*\/)?/gi, "").trim();
    }
    const intro = text.slice(0, text.length - commentMatch[1].length).trim();
    const lang = ext === "html" || ext === "htm" ? "html" : ext === "js" ? "javascript" : ext === "py" ? "python" : ext;
    const fenced = `\`\`\`${lang}\n${commentMatch[1].trim()}\n\`\`\``;
    return intro ? `${intro}\n\n${fenced}` : fenced;
  }

  const htmlStart = text.search(/<!DOCTYPE html|<html[\s>]/i);
  if (htmlStart !== -1) {
    const intro = text.slice(0, htmlStart).trim();
    const fenced = `\`\`\`html\n${text.slice(htmlStart).trim()}\n\`\`\``;
    return intro ? `${intro}\n\n${fenced}` : fenced;
  }

  if (text.startsWith("<svg") && text.includes("</svg>")) return `\`\`\`svg\n${text}\n\`\`\``;

  // A reply that is entirely a JSON document reads better as highlighted JSON
  if (text.length > 20 && /^[{[]/.test(text) && /[}\]]$/.test(text)) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") return `\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
    } catch (_) { /* not JSON */ }
  }
  return content;
}

/* ─── Media tag extraction ([AUDIO: …], [IMAGE: …], <img>, <video>) ─ */

const fileBase = (value, fallback) => (value ? value.split("/").pop().split("\\").pop() : fallback);
const attr = (source, name) => {
  const m = source.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return m ? m[1] : "";
};

function extractMedia(text, intent) {
  const media = [];
  const seen = new Set();
  const push = (item) => {
    const key = `${item.type}:${item.filename || item.src}`;
    if (seen.has(key)) return "";
    seen.add(key);
    media.push(item);
    return `\n\n\u0000M${media.length - 1}\u0000\n\n`;
  };

  let out = text.replace(/\[AUDIO:\s*([\s\S]*?)\]/gi, (_, inner) => {
    if (intent.imageOnly) return "";
    const filename = fileBase(attr(inner, "(?:filename|name)"), "speech.wav");
    return push({
      type: "audio",
      src: attr(inner, "src") || `/tts-outputs/${encodeURIComponent(filename)}`,
      filename,
      duration: attr(inner, "duration"),
      text: attr(inner, "text"),
    });
  });

  out = out.replace(/\[IMAGE:\s*([\s\S]*?)\]/gi, (_, inner) => {
    if (intent.audioOnly) return "";
    const filename = fileBase(attr(inner, "(?:filename|name)"), "image.png");
    return push({ type: "image", src: `/api/output-file?filename=${encodeURIComponent(filename)}`, alt: attr(inner, "prompt"), filename });
  });

  out = out.replace(/<img\s+[^>]*src=["'](?:assets\/)?([^"']+)["'][^>]*>/gi, (tag, src) => {
    if (intent.audioOnly) return "";
    const filename = fileBase(src, "image.png");
    const external = /^(?:https?:|data:)/.test(src);
    return push({
      type: "image",
      src: external ? src : `/api/output-file?filename=${encodeURIComponent(filename)}`,
      alt: attr(tag, "alt") || attr(tag, "data-generate") || "Generated image",
      filename,
    });
  });

  out = out.replace(/<video\s+[^>]*src=["']([^"']+)["'][^>]*>(?:\s*<\/video>)?/gi, (tag, src) => (
    push({ type: "video", src, title: attr(tag, "title"), poster: attr(tag, "poster") })
  ));
  out = out.replace(/\[VIDEO:\s*([\s\S]*?)\]/gi, (_, inner) => {
    const src = attr(inner, "src") || (attr(inner, "(?:filename|name)") ? `/api/output-file?filename=${encodeURIComponent(fileBase(attr(inner, "(?:filename|name)")))}` : "");
    return src ? push({ type: "video", src, title: attr(inner, "(?:title|prompt)") }) : "";
  });

  return { text: out, media };
}

/* ─── Block parser ────────────────────────────────────────────── */

const FENCE_OPEN = /^(\s{0,3})(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const MEDIA_LINE = /^\u0000M(\d+)\u0000$/;
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/;
const PATH_COMMENT = /^<!--\s*path:\s*[^>]+\s*-->$/i;

const splitRow = (line) => {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  let inCode = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "`") inCode = !inCode;
    if (ch === "\\" && trimmed[i + 1] === "|") { current += "|"; i += 1; continue; }
    if (ch === "|" && !inCode) { cells.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
};

const startsBlock = (line) => (
  FENCE_OPEN.test(line) || HEADING.test(line) || HR.test(line) || LIST_ITEM.test(line) ||
  /^\s*>/.test(line) || /^\s*(?:\$\$|\\\[)/.test(line) || MEDIA_LINE.test(line.trim())
);

const indentOf = (line) => {
  const m = line.match(/^(\s*)/);
  return m ? m[1].replace(/\t/g, "    ").length : 0;
};

function parseBlocks(input, streaming) {
  const lines = input.split(/\r?\n/);
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || PATH_COMMENT.test(trimmed)) { i += 1; continue; }

    const media = trimmed.match(MEDIA_LINE);
    if (media) { blocks.push({ type: "media", index: Number(media[1]), raw: trimmed }); i += 1; continue; }

    const fence = line.match(FENCE_OPEN);
    if (fence) {
      const marker = fence[2];
      const body = [];
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        const closing = lines[j].trim();
        if (closing.startsWith(marker[0].repeat(marker.length)) && /^(`{3,}|~{3,})\s*$/.test(closing)) { closed = true; break; }
        body.push(lines[j]);
        j += 1;
      }
      const code = body.join("\n");
      blocks.push({ type: "code", lang: fence[3] || "", code, open: !closed, raw: `${fence[3]}\n${code}${closed}` });
      i = closed ? j + 1 : j;
      continue;
    }

    if (/^(?:\$\$|\\\[)/.test(trimmed)) {
      const close = trimmed.startsWith("$$") ? "$$" : "\\]";
      const openLen = 2;
      const single = trimmed.length > openLen + 1 && trimmed.endsWith(close) && trimmed.slice(openLen).trim() !== "";
      if (single && trimmed.length > 4) {
        blocks.push({ type: "math", tex: trimmed.slice(openLen, -2).trim(), raw: trimmed });
        i += 1;
        continue;
      }
      const body = [trimmed.slice(openLen)];
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        const l = lines[j];
        if (l.trim().endsWith(close)) { body.push(l.trim().slice(0, -2)); closed = true; break; }
        body.push(l);
        j += 1;
      }
      const tex = body.join("\n").trim();
      blocks.push({ type: closed ? "math" : "math-pending", tex, raw: tex + closed });
      i = j + 1;
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ type: "heading", level: Math.min(heading[1].length + 1, 6), text: heading[2], raw: line });
      i += 1;
      continue;
    }

    if (HR.test(line) && !LIST_ITEM.test(line.replace(/^(\s*)([-*])\s+(?=[-*])/, "$1x"))) {
      blocks.push({ type: "hr", raw: "hr" });
      i += 1;
      continue;
    }

    if (trimmed.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]).map((cell) => (
        cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : undefined
      ));
      const rows = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim() && lines[j].includes("|")) {
        rows.push(splitRow(lines[j]));
        j += 1;
      }
      blocks.push({ type: "table", header, align, rows, raw: lines.slice(i, j).join("\n") });
      i = j;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const body = [];
      let j = i;
      while (j < lines.length && (/^\s*>/.test(lines[j]) || (lines[j].trim() && !startsBlock(lines[j]) && body.length))) {
        body.push(lines[j].replace(/^\s*>\s?/, ""));
        j += 1;
      }
      const inner = body.join("\n");
      const callout = inner.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/i);
      blocks.push({
        type: "quote",
        callout: callout ? callout[1].toLowerCase() : "",
        children: parseBlocks(callout ? inner.slice(callout[0].length) : inner, streaming),
        raw: inner,
      });
      i = j;
      continue;
    }

    const listMatch = line.match(LIST_ITEM);
    if (listMatch) {
      const result = parseList(lines, i, streaming);
      blocks.push(result.block);
      i = result.next;
      continue;
    }

    const imageLine = trimmed.match(IMAGE_LINE);
    if (imageLine) {
      const src = imageLine[2];
      if (VIDEO_URL.test(src)) blocks.push({ type: "video", src, title: imageLine[1], raw: trimmed });
      else if (AUDIO_URL.test(src)) blocks.push({ type: "audio", src, filename: fileBase(src), raw: trimmed });
      else blocks.push({ type: "image", src, alt: imageLine[1], filename: fileBase(src.split("?")[0], "image.png"), raw: trimmed });
      i += 1;
      continue;
    }

    // Bare media URL on its own line becomes a real player
    if (/^https?:\/\/\S+$/.test(trimmed) && (VIDEO_URL.test(trimmed) || AUDIO_URL.test(trimmed))) {
      blocks.push(VIDEO_URL.test(trimmed)
        ? { type: "video", src: trimmed, raw: trimmed }
        : { type: "audio", src: trimmed, filename: fileBase(trimmed.split("?")[0]), raw: trimmed });
      i += 1;
      continue;
    }

    const para = [];
    let j = i;
    while (j < lines.length && lines[j].trim() && (j === i || !startsBlock(lines[j])) && !(lines[j].includes("|") && j + 1 < lines.length && TABLE_SEP.test(lines[j + 1]))) {
      para.push(lines[j]);
      j += 1;
    }
    if (!para.length) { para.push(line); j = i + 1; }
    blocks.push({ type: "paragraph", lines: para, raw: para.join("\n") });
    i = j;
  }

  return blocks;
}

function parseList(lines, start, streaming) {
  const first = lines[start].match(LIST_ITEM);
  const baseIndent = indentOf(lines[start]);
  const ordered = /\d/.test(first[2]);
  const startNumber = ordered ? Number.parseInt(first[2], 10) : 1;
  const items = [];
  let i = start;
  let loose = false;

  while (i < lines.length) {
    const m = lines[i].match(LIST_ITEM);
    if (!m || indentOf(lines[i]) !== baseIndent || /\d/.test(m[2]) !== ordered) break;
    const contentIndent = baseIndent + m[2].length + 1;
    const body = [m[3]];
    let j = i + 1;
    let sawBlank = false;
    while (j < lines.length) {
      const l = lines[j];
      if (!l.trim()) { sawBlank = true; body.push(""); j += 1; continue; }
      const ind = indentOf(l);
      if (ind >= Math.min(contentIndent, baseIndent + 2)) {
        body.push(l.replace(new RegExp(`^\\s{0,${contentIndent}}`), ""));
        sawBlank = false;
        j += 1;
        continue;
      }
      if (!sawBlank && !startsBlock(l) && !LIST_ITEM.test(l)) {
        body.push(l.trim());
        j += 1;
        continue;
      }
      break;
    }
    while (body.length && body[body.length - 1] === "") { body.pop(); loose = loose || sawBlank; }
    if (body.includes("")) loose = true;

    let text = body.join("\n");
    let task = null;
    const taskMatch = text.match(/^\[([ xX])\]\s+/);
    if (taskMatch) {
      task = taskMatch[1].toLowerCase() === "x";
      text = text.slice(taskMatch[0].length);
    }
    items.push({ task, children: parseBlocks(text, streaming) });
    i = j;
    // A blank line between items only continues the list if another item follows
    if (i < lines.length && !lines[i].trim()) {
      let k = i;
      while (k < lines.length && !lines[k].trim()) k += 1;
      const next = lines[k] && lines[k].match(LIST_ITEM);
      if (next && indentOf(lines[k]) === baseIndent && /\d/.test(next[2]) === ordered) { loose = true; i = k; } else break;
    }
  }

  return {
    block: { type: "list", ordered, start: startNumber, loose, items, raw: lines.slice(start, i).join("\n") },
    next: i,
  };
}

/* ─── Inline parser ───────────────────────────────────────────── */

const SAFE_URL = /^(?:https?:|mailto:|tel:|#|\/|\.{0,2}\/|local:\/\/|action:)/i;
const INLINE_TOKEN = new RegExp([
  "(`+)([\\s\\S]*?[^`])\\1(?!`)",                              // 1,2 code span
  "\\\\\\((.+?)\\\\\\)",                                         // 3 \( math \)
  "\\$(?!\\s)([^$\\n]*?[^\\s$\\\\])\\$(?!\\d)",                  // 4 $math$
  "!\\[([^\\]]*)\\]\\(([^)\\s]+)(?:\\s+\"[^\"]*\")?\\)",          // 5,6 image
  "\\[((?:[^\\[\\]]|\\[[^\\]]*\\])+)\\]\\(([^)\\s]*)(?:\\s+\"([^\"]*)\")?\\)", // 7,8,9 link
  "<(https?:\\/\\/[^>\\s]+)>",                                   // 10 autolink
  "(https?:\\/\\/[^\\s<>()]+(?:\\([^\\s<>()]*\\)[^\\s<>()]*)*)",  // 11 bare URL
  "(\\*\\*|__)(?=\\S)([\\s\\S]+?\\S)\\12",                        // 12,13 bold
  "~~(?=\\S)([\\s\\S]+?\\S)~~",                                   // 14 strike
  "(\\*|_)(?=[^\\s*_])([\\s\\S]*?[^\\s*_\\\\])\\15(?![\\w*])",    // 15,16 italic
  "==(?=\\S)([^=]+?\\S)==",                                       // 17 highlight
  "\\\\([\\\\`*_{}\\[\\]()#+\\-.!|~$<>])",                        // 18 escape
].join("|"), "g");

function MathFormula({ tex, display = false }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html", strict: "ignore" });
    } catch (_) {
      return null;
    }
  }, [tex, display]);
  if (!html) return <code className="markdown-inline-code">{tex}</code>;
  return display
    ? <div className="chat-math-block" role="math" aria-label={tex} dangerouslySetInnerHTML={{ __html: html }} />
    : <span className="chat-math-inline" role="math" aria-label={tex} dangerouslySetInnerHTML={{ __html: html }} />;
}

function renderLink(href, children, key, title) {
  const isPreviewAction = href.startsWith("action:preview") || href.startsWith("local://") || href.includes("openInsideBrowser");
  if (isPreviewAction) {
    const fileMatch = href.match(/(?:file=|local:\/\/)([^'")\s&]+)/);
    const target = fileMatch ? fileMatch[1] : "index.html";
    return (
      <button key={key} type="button" className="chat-action-link" onClick={() => window.openInsideBrowser?.(`local://${target}`)}>
        {children}
      </button>
    );
  }
  if (!SAFE_URL.test(href)) return <span key={key}>{children}</span>;
  const external = /^https?:/i.test(href);
  return (
    <a key={key} className="markdown-link" href={href} title={title || undefined} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {children}
    </a>
  );
}

export function parseInline(text, keyPrefix = "i") {
  if (!text) return null;
  const out = [];
  let last = 0;
  let n = 0;
  INLINE_TOKEN.lastIndex = 0;
  const regex = new RegExp(INLINE_TOKEN.source, "g");
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyPrefix}-${n++}`;
    if (m[1]) out.push(<code key={key} className="markdown-inline-code">{m[2].replace(/^ (.*) $/, "$1")}</code>);
    else if (m[3] !== undefined) out.push(<MathFormula key={key} tex={m[3]} />);
    else if (m[4] !== undefined) out.push(<MathFormula key={key} tex={m[4]} />);
    else if (m[6] !== undefined) {
      out.push(SAFE_URL.test(m[6]) || m[6].startsWith("data:image/")
        ? <img key={key} className="markdown-inline-img" src={m[6]} alt={m[5]} loading="lazy" decoding="async" />
        : m[5]);
    } else if (m[8] !== undefined) out.push(renderLink(m[8], parseInline(m[7], key), key, m[9]));
    else if (m[10]) out.push(renderLink(m[10], m[10], key));
    else if (m[11]) {
      const url = m[11].replace(/[.,;:!?'"]+$/, "");
      out.push(renderLink(url, url, key));
      if (url.length < m[11].length) out.push(m[11].slice(url.length));
    } else if (m[13] !== undefined) out.push(<strong key={key}>{parseInline(m[13], key)}</strong>);
    else if (m[14] !== undefined) out.push(<del key={key}>{parseInline(m[14], key)}</del>);
    else if (m[16] !== undefined) out.push(<em key={key}>{parseInline(m[16], key)}</em>);
    else if (m[17] !== undefined) out.push(<mark key={key} className="markdown-mark">{parseInline(m[17], key)}</mark>);
    else if (m[18] !== undefined) out.push(m[18]);
    last = regex.lastIndex;
    if (m[0].length === 0) regex.lastIndex += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// While streaming, temporarily close dangling markers so half-written bold or code renders cleanly
function healStreamingInline(text) {
  let healed = text;
  const ticks = (healed.match(/`/g) || []).length;
  if (ticks % 2 === 1) healed += "`";
  const bold = (healed.replace(/`[^`]*`/g, "").match(/\*\*/g) || []).length;
  if (bold % 2 === 1) healed = /\*\*\s*$/.test(healed) ? healed.replace(/\*\*\s*$/, "") : `${healed}**`;
  const strike = (healed.match(/~~/g) || []).length;
  if (strike % 2 === 1) healed += "~~";
  // Hide a link whose URL hasn't arrived yet
  healed = healed.replace(/\[([^\]]*)\]\([^)]*$/, "$1").replace(/\[([^\]]*)$/, "$1");
  return healed;
}

/* ─── Block rendering ─────────────────────────────────────────── */

function InlineLines({ lines, streaming, prefix }) {
  return lines.map((line, idx) => {
    const isLast = idx === lines.length - 1;
    const hardBreak = / {2,}$/.test(line) || /\\$/.test(line);
    const content = line.trim().replace(/\\$/, "");
    return (
      <React.Fragment key={idx}>
        {idx > 0 && <br />}
        {parseInline(streaming && isLast ? healStreamingInline(content) : content, `${prefix}-${idx}`)}
        {hardBreak && !isLast ? null : null}
      </React.Fragment>
    );
  });
}

function Blocks({ blocks, ctx, streamingTail, tight = false }) {
  const grouped = useMemo(() => groupImages(blocks), [blocks]);
  return grouped.map((block, idx) => (
    <Block
      key={`${block.type}-${idx}`}
      block={block}
      ctx={ctx}
      tight={tight}
      streaming={streamingTail && idx === grouped.length - 1}
    />
  ));
}

function groupImages(blocks) {
  const result = [];
  for (const block of blocks) {
    const prev = result[result.length - 1];
    const isImage = block.type === "image" || (block.type === "media" && block.mediaType === "image");
    if (isImage && prev && (prev.type === "image" || prev.type === "gallery")) {
      if (prev.type === "gallery") prev.images.push(block);
      else result[result.length - 1] = { type: "gallery", images: [prev, block], raw: prev.raw + block.raw };
      continue;
    }
    result.push(block);
  }
  return result;
}

const Block = memo(function Block({ block, ctx, streaming, tight }) {
  switch (block.type) {
    case "paragraph": {
      if (tight) return <InlineLines lines={block.lines} streaming={streaming} prefix="p" />;
      const isSectionLabel = block.lines.length === 1 && /^[^\w*]*\*\*[^*]+\*\*:?$/u.test(block.lines[0].trim());
      return (
        <p className={isSectionLabel ? "md-section-label" : undefined}>
          <InlineLines lines={block.lines} streaming={streaming} prefix="p" />
        </p>
      );
    }
    case "heading": {
      const Tag = `h${block.level}`;
      return <Tag>{parseInline(streaming ? healStreamingInline(block.text) : block.text, "h")}</Tag>;
    }
    case "hr":
      return <hr />;
    case "code": {
      const isMediaFence = MEDIA_EXTENSIONS.test(`.${block.lang}`) || MEDIA_EXT_LIST.includes(block.lang.toLowerCase()) ||
        /<img|\[IMAGE:|\[AUDIO:|data-generate=|data-prompt=/.test(block.code);
      if (isMediaFence || (!block.code.trim() && !block.open)) return null;
      return (
        <CodeBlock
          code={block.code}
          lang={block.lang}
          isStreaming={block.open && ctx.streaming}
          isComplete={ctx.isComplete && !block.open}
          onOpenBrowser={ctx.onOpenBrowser}
          userPrompt={ctx.userPrompt}
        />
      );
    }
    case "math":
      return <MathFormula tex={block.tex} display />;
    case "math-pending":
      return <div className="chat-math-pending" aria-busy="true">{block.tex}</div>;
    case "table":
      return (
        <div className="chat-table-wrap" tabIndex={0} role="region" aria-label="Table">
          <table className="chat-table">
            <thead>
              <tr>{block.header.map((cell, c) => <th key={c} style={{ textAlign: block.align[c] }}>{parseInline(cell, `th${c}`)}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {block.header.map((_, c) => <td key={c} style={{ textAlign: block.align[c] }}>{parseInline(row[c] || "", `td${r}-${c}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "quote":
      return (
        <blockquote className={block.callout ? `md-callout md-callout-${block.callout}` : undefined}>
          {block.callout && <span className="md-callout-title">{block.callout}</span>}
          <Blocks blocks={block.children} ctx={ctx} streamingTail={streaming} />
        </blockquote>
      );
    case "list": {
      const ListTag = block.ordered ? "ol" : "ul";
      const hasTasks = block.items.some((item) => item.task !== null);
      return (
        <ListTag start={block.ordered && block.start !== 1 ? block.start : undefined} className={hasTasks ? "md-task-list" : undefined}>
          {block.items.map((item, idx) => {
            const onlyParagraph = !block.loose && item.children[0]?.type === "paragraph";
            return (
              <li key={idx} className={item.task !== null ? "md-task" : undefined}>
                {item.task !== null && (
                  <span className={`md-task-box${item.task ? " is-done" : ""}`} role="img" aria-label={item.task ? "Done" : "Not done"} />
                )}
                <Blocks
                  blocks={item.children}
                  ctx={ctx}
                  tight={onlyParagraph}
                  streamingTail={streaming && idx === block.items.length - 1}
                />
              </li>
            );
          })}
        </ListTag>
      );
    }
    case "image":
      return <ImageCard src={block.src} alt={block.alt} filename={block.filename} />;
    case "gallery":
      return <ImageGallery images={block.images.map((b) => ({ src: b.src, alt: b.alt, filename: b.filename }))} />;
    case "audio":
      return <AudioPlayer src={block.src} filename={block.filename} duration={block.duration} text={block.text} />;
    case "video":
      return <VideoPlayer src={block.src} title={block.title} poster={block.poster} />;
    default:
      return null;
  }
}, (prev, next) => prev.block.raw === next.block.raw && prev.streaming === next.streaming && prev.tight === next.tight && prev.ctx === next.ctx && prev.block.type === next.block.type);

function detectMediaIntent(userPrompt) {
  const p = (userPrompt || "").toLowerCase();
  const hasAudio = /\b(?:audio|speech|voice|podcast|voiceover|narration|sound\s*clip|recording|spoken\s*word|speak|read\s*aloud|narrate|tts|text\s*to\s*speech)\b/i.test(p);
  const hasImage = /\b(?:image|photo|picture|drawing|illustration|artwork|wallpaper|portrait|graphic|banner|logo|avatar|visual|draw|paint|sketch)\b/i.test(p);
  const both = (hasAudio && hasImage) || /\b(?:image\s+and\s+audio|audio\s+and\s+image|picture\s+and\s+voice)\b/i.test(p);
  return { audioOnly: hasAudio && !hasImage && !both, imageOnly: hasImage && !hasAudio && !both };
}

export function MarkdownRenderer({ content, onOpenBrowser, isComplete = true, userPrompt = "" }) {
  const intent = useMemo(() => detectMediaIntent(userPrompt), [userPrompt]);

  const { blocks, media } = useMemo(() => {
    if (typeof content !== "string" || !content) return { blocks: [], media: [] };
    const normalized = ensureFencedCode(content);
    const extracted = extractMedia(normalized, intent);
    const parsed = parseBlocks(extracted.text, !isComplete).map((block) => {
      if (block.type !== "media") return block;
      const item = extracted.media[block.index];
      if (!item) return block;
      return { ...item, mediaType: item.type, raw: `${item.type}:${item.src}` };
    });
    return { blocks: parsed, media: extracted.media };
  }, [content, intent, isComplete]);

  const ctx = useMemo(() => ({ onOpenBrowser, isComplete, streaming: !isComplete, userPrompt }), [onOpenBrowser, isComplete, userPrompt]);

  if (!blocks.length && !media.length) return null;
  return (
    <div className={`markdown-body${!isComplete ? " is-streaming" : ""}`}>
      <Blocks blocks={blocks} ctx={ctx} streamingTail={!isComplete} />
    </div>
  );
}
