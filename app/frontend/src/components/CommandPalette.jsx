import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Command, MessageSquare, SquarePen, Image, Mic, Volume2, Cpu, Bot, Settings, FolderKanban, Plug, X, ArrowUp, ArrowDown, CornerDownLeft, Sliders, Palette, BarChart3, PanelLeft } from "lucide-react";

const COMMANDS = [
  { id: "new-chat", label: "New Chat", group: "Actions", icon: SquarePen, action: "new_chat", keywords: "new conversation start fresh" },
  { id: "toggle-sidebar", label: "Toggle Sidebar", group: "Actions", icon: PanelLeft, action: "toggle_sidebar", keywords: "sidebar panel collapse expand" },
  { id: "chat", label: "Open Chat", group: "Navigate", icon: MessageSquare, tab: "chat", keywords: "conversation assistant" },
  { id: "images", label: "Open Image Generator", group: "Navigate", icon: Image, tab: "generator", keywords: "image art generate" },
  { id: "speech", label: "Open Transcription", group: "Navigate", icon: Mic, tab: "speech", keywords: "audio speech transcribe" },
  { id: "voice", label: "Open Text to Speech", group: "Navigate", icon: Volume2, tab: "tts", keywords: "voice audio" },
  { id: "models", label: "Open Models", group: "Navigate", icon: Cpu, tab: "models", keywords: "providers llm" },
  { id: "harness", label: "Open Agent Harness", group: "Navigate", icon: Bot, tab: "harness", keywords: "agents tools orchestration git sandbox trace" },
  { id: "settings", label: "Open Settings", group: "Settings", icon: Settings, tab: "settings", keywords: "preferences" },
  { id: "agent-studio", label: "Agent & Studio Settings", group: "Settings", icon: Sliders, tab: "settings", section: "agent", keywords: "autonomous permission mode performance profile backend" },
  { id: "appearance", label: "Appearance & Themes", group: "Settings", icon: Palette, tab: "settings", section: "appearance", keywords: "theme dark light colors" },
  { id: "projects", label: "Project Workspaces", group: "Settings", icon: FolderKanban, tab: "settings", section: "projects", keywords: "workspace folder" },
  { id: "providers", label: "AI Providers & API Keys", group: "Settings", icon: Plug, tab: "settings", section: "providers", keywords: "api keys connections openai anthropic gemini" },
  { id: "usage", label: "Usage & Budgets", group: "Settings", icon: BarChart3, tab: "settings", section: "usage", keywords: "tokens cost analytics" },
];

export default function CommandPalette({ open, onClose, onNavigate }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const filtered = useMemo(() => COMMANDS.filter((item) => `${item.label} ${item.group} ${item.keywords}`.toLowerCase().includes(query.toLowerCase().trim())), [query]);

  useEffect(() => {
    if (!open) return;
    setQuery(""); setActive(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => { if (active >= filtered.length) setActive(Math.max(0, filtered.length - 1)); }, [active, filtered.length]);
  if (!open) return null;

  const run = (item) => { onNavigate(item); onClose(); };
  return (
    <div className="abyx-command-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="abyx-command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="abyx-command-search"><Search size={18}/><input ref={inputRef} value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }} placeholder="Search pages and commands…" onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((v) => Math.min(v + 1, filtered.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((v) => Math.max(0, v - 1)); }
          if (e.key === "Enter" && filtered[active]) run(filtered[active]);
        }}/><kbd>ESC</kbd><button className="abyx-command-close" onClick={onClose} aria-label="Close command palette"><X size={16}/></button></div>
        <div className="abyx-command-results">
          {filtered.length ? filtered.map((item, index) => { const Icon = item.icon; return <button key={item.id} className={`abyx-command-item ${index === active ? "is-active" : ""}`} onMouseEnter={() => setActive(index)} onClick={() => run(item)}><Icon size={16}/><span>{item.label}</span><small>{item.group}</small>{index === active && <CornerDownLeft size={14}/>}</button>; }) : <div className="abyx-command-empty">No matching commands.</div>}
        </div>
        <footer className="abyx-command-footer"><span><kbd><ArrowUp size={10}/></kbd><kbd><ArrowDown size={10}/></kbd> Navigate</span><span><kbd>↵</kbd> Open</span><span><kbd>Esc</kbd> Close</span></footer>
      </section>
    </div>
  );
}
