import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GitBranch, GitCommit, RefreshCw, Plus, Minus, History, RotateCcw, Save, ShieldCheck,
  ShieldAlert, Lock, Globe, FolderLock, Box, Brain, Wrench, FileText, Gauge, Activity,
  AlertTriangle, CheckCircle2, XCircle, Clock, Pause, Play, Info,
} from "lucide-react";
import DiffViewer from "./DiffViewer";
import {
  executeTerminalCommand, getSecurityStatus, setSecurityMode, getSecurityWorkspaces,
  getHarnessRuntimeConfig, getAgentMemory, getAgentTools, getSkillsCatalog, getMcpServers,
  listAgentRuns, getAgentRun, getOrchestratorHistory, getOrchestratorEvents, getActiveOrchestrations,
} from "../services/api";
import "../styles/harness-insights.css";

/* ----------------------------- shared helpers ----------------------------- */

function quoteArg(value) {
  return `"${String(value).replace(/(["\\$`])/g, "\\$1")}"`;
}

async function runCommand(command, cwd) {
  let res = await executeTerminalCommand(command, cwd, 20000);
  if (res.requiresApproval) {
    const approved = window.confirm(`Allow this command to run with your account permissions?\n\n${command}\n\nWorking directory: ${cwd}`);
    res = await executeTerminalCommand(command, cwd, 20000, res.approvalId, approved);
  }
  return res;
}

function PanelState({ icon: Icon = Info, tone = "muted", title, children, action }) {
  return (
    <div className={`hi-state hi-state-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon size={18} aria-hidden="true" />
      <div className="hi-state-body">
        <strong>{title}</strong>
        {children && <p>{children}</p>}
      </div>
      {action}
    </div>
  );
}

function Section({ title, icon: Icon, actions, children, className = "" }) {
  return (
    <section className={`hi-card ${className}`}>
      <header className="hi-card-header">
        <h3>{Icon && <Icon size={15} aria-hidden="true" />} {title}</h3>
        {actions && <div className="hi-card-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

function BackendGap({ children }) {
  return (
    <div className="hi-gap">
      <AlertTriangle size={14} aria-hidden="true" />
      <span><strong>Backend needed:</strong> {children}</span>
    </div>
  );
}

function formatDuration(ms) {
  if (ms == null || Number.isNaN(Number(ms))) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleTimeString();
}

/* ---------------------------- Git & Checkpoints ---------------------------- */

const STATUS_LABELS = { M: "Modified", A: "Added", D: "Deleted", R: "Renamed", C: "Copied", "?": "Untracked", U: "Conflict" };

function parsePorcelain(output) {
  return output.split("\n").filter(Boolean).map((line) => {
    const x = line[0];
    const y = line[1];
    let path = line.slice(3);
    if (path.includes(" -> ")) path = path.split(" -> ")[1];
    path = path.replace(/^"|"$/g, "");
    return { path, staged: x !== " " && x !== "?", unstaged: y !== " " || x === "?", code: x === "?" ? "?" : (x !== " " ? x : y) };
  });
}

export function GitCheckpointsPanel({ cwd = ".", showAlert }) {
  const [state, setState] = useState({ loading: true, error: null, isRepo: true });
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState([]);
  const [changes, setChanges] = useState([]);
  const [commits, setCommits] = useState([]);
  const [checkpoints, setCheckpoints] = useState([]);
  const [selected, setSelected] = useState(null);
  const [diffText, setDiffText] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const git = useCallback((args) => runCommand(`git ${args}`, cwd), [cwd]);

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const head = await git("rev-parse --abbrev-ref HEAD");
      if (!head.ok || head.exitCode) {
        const message = head.stderr || head.error || "";
        setState({ loading: false, error: null, isRepo: !/not a git repository/i.test(message), detail: message });
        if (/not a git repository/i.test(message)) return;
        throw new Error(message || "git is unavailable");
      }
      const [br, st, log, stash] = await Promise.all([
        git("branch --list --format=%(refname:short)"),
        git("status --porcelain"),
        git('log -n 25 --pretty=format:%h%x1f%an%x1f%ar%x1f%s'),
        git('stash list --pretty=format:%gd%x1f%ar%x1f%s'),
      ]);
      setBranch((head.stdout || "").trim());
      setBranches((br.stdout || "").split("\n").map((b) => b.trim()).filter(Boolean));
      setChanges(parsePorcelain(st.stdout || ""));
      setCommits((log.stdout || "").split("\n").filter(Boolean).map((l) => {
        const [hash, author, when, subject] = l.split("\x1f");
        return { hash, author, when, subject };
      }));
      setCheckpoints((stash.stdout || "").split("\n").filter(Boolean).map((l) => {
        const [ref, when, subject] = l.split("\x1f");
        return { ref, when, subject };
      }));
      setState({ loading: false, error: null, isRepo: true });
    } catch (err) {
      setState({ loading: false, error: err.message || String(err), isRepo: true });
    }
  }, [git]);

  useEffect(() => { refresh(); }, [refresh]);

  const openDiff = async (change) => {
    setSelected(change);
    setDiffText("");
    if (change.code === "?") {
      setDiffText("+ (untracked file — stage it with + to review it as a new file)");
      return;
    }
    const res = await git(`diff ${change.staged && !change.unstaged ? "--cached " : ""}-- ${quoteArg(change.path)}`).catch((e) => ({ stderr: e.message }));
    setDiffText(res.stdout || res.stderr || "No textual diff available.");
  };

  const mutate = async (args, successTitle) => {
    setBusy(true);
    try {
      const res = await git(args);
      if (!res.ok || res.exitCode) throw new Error(res.stderr || res.error || `git ${args} failed`);
      if (successTitle) showAlert?.({ title: successTitle, message: (res.stdout || "").trim().slice(0, 400) || "Done." });
      await refresh();
      return true;
    } catch (err) {
      showAlert?.({ title: "Git command failed", message: err.message, danger: true });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const createCheckpoint = async () => {
    setBusy(true);
    try {
      const created = await git("stash create");
      const sha = (created.stdout || "").trim();
      if (!sha) {
        showAlert?.({ title: "Nothing to checkpoint", message: "There are no tracked changes to snapshot. Untracked files are not included in checkpoints." });
        return;
      }
      const label = `abyx-checkpoint ${new Date().toLocaleString()}`;
      const stored = await git(`stash store -m ${quoteArg(label)} ${sha}`);
      if (!stored.ok || stored.exitCode) throw new Error(stored.stderr || "Could not store checkpoint");
      await refresh();
    } catch (err) {
      showAlert?.({ title: "Checkpoint failed", message: err.message, danger: true });
    } finally {
      setBusy(false);
    }
  };

  const restoreCheckpoint = (cp) => {
    if (!window.confirm(`Restore checkpoint ${cp.ref}?\n\n${cp.subject}\n\nThis applies the saved changes on top of your working tree. Conflicting edits will be reported by git.`)) return;
    mutate(`stash apply ${cp.ref}`, "Checkpoint restored");
  };

  const diffLines = useMemo(() => diffText.split("\n").map((line, idx) => ({
    id: idx,
    type: line.startsWith("+") && !line.startsWith("+++") ? "added" : line.startsWith("-") && !line.startsWith("---") ? "deleted" : "unchanged",
    text: /^[+-](?![+-]{2})/.test(line) ? line.slice(1) : line,
  })), [diffText]);

  const staged = changes.filter((c) => c.staged);
  const unstaged = changes.filter((c) => c.unstaged);

  if (state.loading && !branch) return <PanelState icon={RefreshCw} title="Reading repository…">Running git in {cwd}</PanelState>;
  if (!state.isRepo) {
    return (
      <PanelState icon={GitBranch} title="This workspace is not a git repository" action={
        <button className="abyx-btn abyx-btn-sm" disabled={busy} onClick={() => mutate("init", "Repository initialized")}>Initialize git</button>
      }>Checkpoints and change review require git. Working directory: {cwd}</PanelState>
    );
  }
  if (state.error) {
    return (
      <PanelState icon={XCircle} tone="error" title="Couldn't read git state" action={<button className="abyx-btn abyx-btn-sm" onClick={refresh}>Retry</button>}>
        {state.error}. Git commands run through the local terminal API (/api/terminal/execute); make sure the Abyx server is running and git is on PATH.
      </PanelState>
    );
  }

  const ChangeRow = ({ change, stagedList }) => (
    <li className={`hi-change ${selected?.path === change.path ? "is-selected" : ""}`}>
      <button className="hi-change-main" onClick={() => openDiff(change)} title="View diff">
        <span className={`hi-badge hi-badge-${change.code === "?" ? "info" : change.code === "D" ? "danger" : "warn"}`}>{change.code}</span>
        <span className="hi-mono hi-truncate">{change.path}</span>
        <span className="hi-muted hi-small">{STATUS_LABELS[change.code] || "Changed"}</span>
      </button>
      <button
        className="abyx-btn abyx-btn-sm hi-icon-btn"
        disabled={busy}
        aria-label={stagedList ? `Unstage ${change.path}` : `Stage ${change.path}`}
        onClick={() => mutate(stagedList ? `restore --staged -- ${quoteArg(change.path)}` : `add -- ${quoteArg(change.path)}`)}
      >
        {stagedList ? <Minus size={13} /> : <Plus size={13} />}
      </button>
    </li>
  );

  return (
    <div className="hi-grid hi-grid-git">
      <div className="hi-col">
        <Section title="Branch" icon={GitBranch} actions={
          <button className="abyx-btn abyx-btn-sm" onClick={refresh} disabled={state.loading} aria-label="Refresh git state">
            <RefreshCw size={13} className={state.loading ? "abyx-spin" : ""} />
          </button>
        }>
          <label className="hi-field">
            <span className="hi-sr">Current branch</span>
            <select
              className="abyx-input"
              value={branch}
              disabled={busy}
              onChange={(e) => {
                const next = e.target.value;
                if (next !== branch && window.confirm(`Switch to branch "${next}"? Uncommitted changes may block the switch.`)) mutate(`switch ${quoteArg(next)}`);
              }}
            >
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <p className="hi-muted hi-small">{changes.length} changed file{changes.length === 1 ? "" : "s"} · {cwd}</p>
        </Section>

        <Section title={`Staged (${staged.length})`} icon={CheckCircle2}>
          {staged.length === 0 ? <p className="hi-empty">No staged changes. Use + to stage files.</p> : (
            <ul className="hi-list">{staged.map((c) => <ChangeRow key={`s-${c.path}`} change={c} stagedList />)}</ul>
          )}
          <form className="hi-commit" onSubmit={(e) => {
            e.preventDefault();
            if (!commitMessage.trim()) return;
            mutate(`commit -m ${quoteArg(commitMessage.trim())}`, "Committed").then((ok) => ok && setCommitMessage(""));
          }}>
            <label className="hi-sr" htmlFor="hi-commit-msg">Commit message</label>
            <input id="hi-commit-msg" className="abyx-input" placeholder="Commit message" value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} />
            <button className="abyx-btn abyx-btn-primary abyx-btn-sm" type="submit" disabled={busy || !staged.length || !commitMessage.trim()}>
              <GitCommit size={13} /> Commit
            </button>
          </form>
        </Section>

        <Section title={`Unstaged (${unstaged.length})`} icon={FileText} actions={
          unstaged.length > 0 && <button className="abyx-btn abyx-btn-sm" disabled={busy} onClick={() => mutate("add -A")}>Stage all</button>
        }>
          {unstaged.length === 0 ? <p className="hi-empty">Working tree clean.</p> : (
            <ul className="hi-list">{unstaged.map((c) => <ChangeRow key={`u-${c.path}`} change={c} />)}</ul>
          )}
        </Section>
      </div>

      <div className="hi-col hi-col-wide">
        <Section title={selected ? `Review: ${selected.path}` : "Change review"} icon={FileText}>
          {selected ? (
            diffText ? <DiffViewer filePath={selected.path} diffLines={diffLines} title="Working tree diff" onClose={() => setSelected(null)} />
              : <p className="hi-empty">Loading diff…</p>
          ) : <p className="hi-empty">Select a changed file to review its diff before staging or committing.</p>}
        </Section>

        <div className="hi-grid hi-grid-2">
          <Section title={`Checkpoints (${checkpoints.length})`} icon={Save} actions={
            <button className="abyx-btn abyx-btn-sm" disabled={busy} onClick={createCheckpoint}><Plus size={13} /> Checkpoint</button>
          }>
            <p className="hi-muted hi-small">Snapshots of tracked changes stored as git stash entries. Your working tree is left untouched.</p>
            {checkpoints.length === 0 ? <p className="hi-empty">No checkpoints yet.</p> : (
              <ul className="hi-list">
                {checkpoints.map((cp) => (
                  <li key={cp.ref} className="hi-row">
                    <div className="hi-row-main">
                      <span className="hi-mono hi-small">{cp.ref}</span>
                      <span className="hi-truncate">{cp.subject}</span>
                      <span className="hi-muted hi-small">{cp.when}</span>
                    </div>
                    <button className="abyx-btn abyx-btn-sm" disabled={busy} onClick={() => restoreCheckpoint(cp)}><RotateCcw size={13} /> Restore</button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Recent commits" icon={History}>
            {commits.length === 0 ? <p className="hi-empty">No commits on this branch yet.</p> : (
              <ol className="hi-list hi-timeline">
                {commits.map((c) => (
                  <li key={c.hash} className="hi-row">
                    <div className="hi-row-main">
                      <span className="hi-mono hi-small hi-accent">{c.hash}</span>
                      <span className="hi-truncate">{c.subject}</span>
                      <span className="hi-muted hi-small">{c.author} · {c.when}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- Sandbox Management --------------------------- */

const SECURITY_MODES = [
  { id: "strict", label: "Strict", desc: "Every write, command and network call needs approval." },
  { id: "balanced", label: "Balanced", desc: "Workspace reads are free; writes and commands ask first." },
  { id: "permissive", label: "Permissive", desc: "Runs inside the workspace without prompts." },
];

function flag(value) {
  if (value === true) return <span className="hi-badge hi-badge-ok">On</span>;
  if (value === false) return <span className="hi-badge hi-badge-muted">Off</span>;
  return <span className="hi-badge hi-badge-muted">Unknown</span>;
}

export function SandboxPanel({ showAlert }) {
  const [security, setSecurity] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sec, ws] = await Promise.all([
        getSecurityStatus(),
        getSecurityWorkspaces().catch(() => ({ workspaces: [] })),
      ]);
      setSecurity(sec.security || sec.status || sec);
      setWorkspaces(ws.workspaces || ws.roots || []);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const currentMode = security?.mode || security?.securityMode;
  const changeMode = async (mode) => {
    setSaving(true);
    try {
      await setSecurityMode({ mode, permissionMode: security?.permissionMode });
      await load();
    } catch (err) {
      showAlert?.({ title: "Couldn't change sandbox mode", message: err.message, danger: true });
    } finally {
      setSaving(false);
    }
  };

  if (loading && !security) return <PanelState icon={RefreshCw} title="Loading sandbox status…" />;
  if (error) {
    return (
      <PanelState icon={ShieldAlert} tone="error" title="Sandbox status unavailable" action={<button className="abyx-btn abyx-btn-sm" onClick={load}>Retry</button>}>
        {error}. This panel reads /api/security/status and /api/security/workspaces from the local Abyx server.
      </PanelState>
    );
  }

  const network = security?.network ?? security?.networkPolicy;
  const allowedHosts = security?.allowedHosts || network?.allowedHosts || [];

  return (
    <div className="hi-col">
      <Section title="Isolation mode" icon={ShieldCheck} actions={
        <button className="abyx-btn abyx-btn-sm" onClick={load} aria-label="Refresh sandbox status"><RefreshCw size={13} className={loading ? "abyx-spin" : ""} /></button>
      }>
        <div className="hi-mode-grid" role="radiogroup" aria-label="Sandbox security mode">
          {SECURITY_MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={currentMode === m.id}
              className={`hi-mode ${currentMode === m.id ? "is-active" : ""}`}
              disabled={saving}
              onClick={() => changeMode(m.id)}
            >
              <strong>{m.label}</strong>
              <span>{m.desc}</span>
            </button>
          ))}
        </div>
        {currentMode && !SECURITY_MODES.some((m) => m.id === currentMode) && (
          <p className="hi-muted hi-small">Server reports mode “{currentMode}”.</p>
        )}
      </Section>

      <div className="hi-grid hi-grid-3">
        <Section title="Filesystem" icon={FolderLock}>
          <dl className="hi-kv">
            <dt>Workspace jail</dt><dd>{flag(security?.workspaceJail ?? security?.sandboxed ?? security?.fsRestricted)}</dd>
            <dt>Permission mode</dt><dd>{security?.permissionMode || "—"}</dd>
            <dt>Write approval</dt><dd>{flag(security?.requireWriteApproval ?? security?.approvals?.write)}</dd>
          </dl>
          {workspaces.length > 0 ? (
            <ul className="hi-list hi-small">
              {workspaces.map((w, i) => (
                <li key={w.id || w.path || i} className="hi-row"><span className="hi-mono hi-truncate">{w.path || w.root || w.name || String(w)}</span>{w.access && <span className="hi-badge hi-badge-muted">{w.access}</span>}</li>
              ))}
            </ul>
          ) : <p className="hi-empty">No sandboxed workspace roots reported.</p>}
        </Section>

        <Section title="Network" icon={Globe}>
          <dl className="hi-kv">
            <dt>Outbound access</dt><dd>{flag(typeof network === "boolean" ? network : network?.enabled)}</dd>
            <dt>Allow-list</dt><dd>{allowedHosts.length ? `${allowedHosts.length} hosts` : "—"}</dd>
          </dl>
          {allowedHosts.length > 0 && <ul className="hi-chips">{allowedHosts.map((h) => <li key={h} className="hi-mono">{h}</li>)}</ul>}
        </Section>

        <Section title="Containers" icon={Box}>
          {Array.isArray(security?.containers) && security.containers.length ? (
            <ul className="hi-list hi-small">
              {security.containers.map((c, i) => <li key={c.id || i} className="hi-row"><span className="hi-truncate">{c.name || c.id}</span><span className="hi-badge hi-badge-muted">{c.status || "unknown"}</span></li>)}
            </ul>
          ) : (
            <BackendGap>the server does not expose container lifecycle endpoints yet. Add e.g. <code>GET/POST /api/sandbox/containers</code> to create, list and stop isolated environments.</BackendGap>
          )}
        </Section>
      </div>

      <Section title="Raw policy" icon={Lock}>
        <pre className="hi-pre">{JSON.stringify(security, null, 2)}</pre>
      </Section>
    </div>
  );
}

/* ------------------------- Context & Prompt Inspector ---------------------- */

export function ContextInspectorPanel({ activeProject }) {
  const [data, setData] = useState({ config: null, memory: [], tools: [], skills: [], mcpTools: [] });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const next = {};
    const errs = {};
    const tasks = {
      config: getHarnessRuntimeConfig().then((r) => r.config || r.runtimeConfig || r),
      memory: getAgentMemory({ projectId: activeProject?.id }).then((r) => r.memories || r.items || []),
      tools: getAgentTools().then((r) => r.tools || []),
      skills: getSkillsCatalog().then((r) => r.skills || []),
      mcpTools: getMcpServers().then((r) => r.tools || []),
    };
    await Promise.all(Object.entries(tasks).map(async ([key, p]) => {
      try { next[key] = await p; } catch (err) { errs[key] = err.message || String(err); next[key] = key === "config" ? null : []; }
    }));
    setData(next);
    setErrors(errs);
    setLoading(false);
  }, [activeProject?.id]);

  useEffect(() => { load(); }, [load]);

  const config = data.config || {};
  const systemPrompt = config.systemPrompt || config.system_prompt || config.agentSystemPrompt;
  const contextWindow = Number(config.contextWindow || config.ctxSize || config.maxContext || 0);
  const enabledTools = data.tools.filter((t) => t.enabled !== false);
  const enabledSkills = data.skills.filter((s) => s.enabled !== false);
  const estimate = (text) => Math.ceil(String(text || "").length / 4);
  const promptTokens = estimate(systemPrompt);
  const toolTokens = estimate(JSON.stringify(enabledTools.map((t) => ({ n: t.id || t.name, d: t.description }))));
  const memoryTokens = estimate(data.memory.map((m) => m.content || m.text || "").join("\n"));
  const total = promptTokens + toolTokens + memoryTokens;

  const budget = [
    { label: "System prompt", value: promptTokens, cls: "a" },
    { label: "Tool schemas", value: toolTokens, cls: "b" },
    { label: "Memory", value: memoryTokens, cls: "c" },
  ];

  return (
    <div className="hi-col">
      <Section title="Token usage (baseline context)" icon={Gauge} actions={
        <button className="abyx-btn abyx-btn-sm" onClick={load} aria-label="Refresh context"><RefreshCw size={13} className={loading ? "abyx-spin" : ""} /></button>
      }>
        <div className="hi-budget" role="img" aria-label={`Approximately ${total} tokens of ${contextWindow || "unknown"} used before any conversation`}>
          {budget.filter((b) => b.value > 0).map((b) => (
            <span key={b.label} className={`hi-budget-seg hi-budget-${b.cls}`} style={{ flexGrow: b.value }} />
          ))}
          {(contextWindow > total || total === 0) && <span className="hi-budget-seg hi-budget-free" style={{ flexGrow: Math.max(contextWindow - total, 1) }} />}
        </div>
        <ul className="hi-legend">
          {budget.map((b) => <li key={b.label}><span className={`hi-dot hi-budget-${b.cls}`} />{b.label}: ~{b.value.toLocaleString()} tok</li>)}
          <li><span className="hi-dot hi-budget-free" />Window: {contextWindow ? contextWindow.toLocaleString() : "unknown"}</li>
        </ul>
        <p className="hi-muted hi-small">Estimates use ~4 characters per token. Per-conversation usage is shown in chat via /api/context/telemetry.</p>
      </Section>

      <div className="hi-grid hi-grid-2">
        <Section title="System prompt" icon={FileText}>
          {errors.config ? <PanelState tone="error" icon={XCircle} title="Runtime config unavailable">{errors.config}</PanelState>
            : systemPrompt ? <pre className="hi-pre hi-pre-tall">{systemPrompt}</pre>
              : <BackendGap><code>/api/harness/runtime-config</code> does not include the assembled system prompt. Expose it (e.g. <code>systemPrompt</code>) to inspect it here.</BackendGap>}
        </Section>

        <Section title="Runtime parameters" icon={Activity}>
          {data.config ? (
            <dl className="hi-kv">
              {Object.entries(config).filter(([, v]) => typeof v !== "object" && String(v).length < 80).slice(0, 18).map(([k, v]) => (
                <React.Fragment key={k}><dt>{k}</dt><dd className="hi-mono">{String(v)}</dd></React.Fragment>
              ))}
            </dl>
          ) : <p className="hi-empty">No runtime parameters reported.</p>}
        </Section>
      </div>

      <div className="hi-grid hi-grid-3">
        <Section title={`Active tools (${enabledTools.length + data.mcpTools.length})`} icon={Wrench}>
          {errors.tools && <p className="hi-error hi-small">{errors.tools}</p>}
          <ul className="hi-chips">
            {enabledTools.map((t) => <li key={t.id || t.name}>{t.name || t.id}</li>)}
            {data.mcpTools.map((t, i) => <li key={`mcp-${t.name || i}`} className="hi-chip-mcp">{t.server ? `${t.server}:` : "mcp:"}{t.name}</li>)}
          </ul>
          {!enabledTools.length && !data.mcpTools.length && <p className="hi-empty">No tools enabled.</p>}
        </Section>

        <Section title={`Skills (${enabledSkills.length})`} icon={Brain}>
          {errors.skills && <p className="hi-error hi-small">{errors.skills}</p>}
          {enabledSkills.length ? <ul className="hi-chips">{enabledSkills.map((s) => <li key={s.id || s.name}>{s.name || s.id}</li>)}</ul> : <p className="hi-empty">No skills loaded.</p>}
        </Section>

        <Section title={`Memory (${data.memory.length})`} icon={Brain}>
          {errors.memory && <p className="hi-error hi-small">{errors.memory}</p>}
          {data.memory.length ? (
            <ul className="hi-list hi-small">
              {data.memory.slice(0, 20).map((m, i) => (
                <li key={m.id || i} className="hi-row"><div className="hi-row-main"><span className="hi-clamp">{m.content || m.text || m.summary}</span>{(m.level || m.category) && <span className="hi-muted">{[m.level, m.category].filter(Boolean).join(" · ")}</span>}</div></li>
              ))}
            </ul>
          ) : <p className="hi-empty">No stored memories{activeProject?.name ? ` for ${activeProject.name}` : ""}.</p>}
        </Section>
      </div>

      <Section title="Retrieved sources" icon={Globe}>
        <BackendGap>retrieval results are not persisted per run. Return the sources used for each agent step (e.g. a <code>sources</code> array on <code>/api/agent/runs/:id</code> steps) to list them here and in Execution Trace.</BackendGap>
      </Section>
    </div>
  );
}

/* ----------------------------- Execution Tracing --------------------------- */

function normalizeSteps(run) {
  const steps = run?.steps || run?.events || run?.trace || [];
  return steps.map((s, i) => ({
    id: s.id || `${i}`,
    type: s.type || s.kind || (s.tool ? "tool" : "step"),
    agent: s.agent || s.agentId || s.role || run?.agent || "",
    tool: s.tool || s.toolName || s.name || "",
    input: s.input ?? s.args ?? s.arguments ?? s.prompt,
    output: s.output ?? s.result ?? s.observation ?? s.content,
    error: s.error,
    durationMs: s.durationMs ?? s.duration ?? (s.endedAt && s.startedAt ? new Date(s.endedAt) - new Date(s.startedAt) : null),
    at: s.timestamp || s.startedAt || s.createdAt || s.time,
    status: s.status || (s.error ? "failed" : "completed"),
  }));
}

function Payload({ label, value }) {
  if (value == null || value === "") return null;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <details className="hi-payload">
      <summary>{label} <span className="hi-muted">({text.length.toLocaleString()} chars)</span></summary>
      <pre className="hi-pre">{text.length > 6000 ? `${text.slice(0, 6000)}\n… truncated` : text}</pre>
    </details>
  );
}

export function ExecutionTracePanel() {
  const [runs, setRuns] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [live, setLive] = useState(true);
  const [filter, setFilter] = useState("all");
  const selectedRef = useRef(null);
  selectedRef.current = selectedId;

  const loadRuns = useCallback(async () => {
    try {
      const [agentRes, orchRes, activeRes] = await Promise.all([
        listAgentRuns().catch(() => ({ activeRuns: [], history: [] })),
        getOrchestratorHistory().catch(() => ({ history: [] })),
        getActiveOrchestrations().catch(() => ({ orchestrations: [] })),
      ]);
      const toRun = (r, source, active = false) => ({
        id: r.id || r.runId,
        source,
        active: active || r.status === "running",
        title: r.task || r.goal || r.prompt || r.title || r.id || r.runId,
        status: r.status || (active ? "running" : "completed"),
        at: r.startedAt || r.createdAt || r.timestamp,
      });
      const all = [
        ...(agentRes.activeRuns || []).map((r) => toRun(r, "agent", true)),
        ...(agentRes.history || []).map((r) => toRun(r, "agent")),
        ...(activeRes.orchestrations || activeRes.active || []).map((r) => toRun(r, "swarm", true)),
        ...(orchRes.history || orchRes.runs || []).map((r) => toRun(r, "swarm")),
      ].filter((r) => r.id);
      const seen = new Set();
      const unique = all.filter((r) => (seen.has(`${r.source}:${r.id}`) ? false : seen.add(`${r.source}:${r.id}`)));
      setRuns(unique);
      setError(null);
      if (!selectedRef.current && unique[0]) setSelectedId(`${unique[0].source}:${unique[0].id}`);
    } catch (err) {
      setError(err.message || String(err));
    }
  }, []);

  const loadDetail = useCallback(async (key) => {
    if (!key) return;
    const [source, ...rest] = key.split(":");
    const id = rest.join(":");
    try {
      if (source === "agent") {
        const res = await getAgentRun(id);
        setDetail({ source, run: res.run || res });
      } else {
        const res = await getOrchestratorEvents(id);
        setDetail({ source, run: { id, steps: res.events || res.items || [] } });
      }
    } catch (err) {
      setDetail({ source, error: err.message || String(err) });
    }
  }, []);

  useEffect(() => { loadRuns(); }, [loadRuns]);
  useEffect(() => { loadDetail(selectedId); }, [selectedId, loadDetail]);
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => { loadRuns(); loadDetail(selectedRef.current); }, 2500);
    return () => clearInterval(t);
  }, [live, loadRuns, loadDetail]);

  const steps = useMemo(() => normalizeSteps(detail?.run), [detail]);
  const visible = steps.filter((s) => filter === "all" || (filter === "errors" ? s.error || s.status === "failed" : filter === "tools" ? s.tool : s.type === "message" || s.type === "handoff"));
  const totalMs = steps.reduce((acc, s) => acc + (Number(s.durationMs) || 0), 0);
  const errorCount = steps.filter((s) => s.error || s.status === "failed").length;

  return (
    <div className="hi-grid hi-grid-trace">
      <Section title={`Runs (${runs.length})`} icon={History} actions={
        <button className={`abyx-btn abyx-btn-sm ${live ? "hi-live" : ""}`} onClick={() => setLive((v) => !v)} aria-pressed={live}>
          {live ? <Pause size={13} /> : <Play size={13} />} {live ? "Live" : "Paused"}
        </button>
      }>
        {error && <p className="hi-error hi-small">{error}</p>}
        {runs.length === 0 ? (
          <p className="hi-empty">No agent or swarm runs yet. Start one from Agent Tasks or Multi-Agent Swarm and it will stream here.</p>
        ) : (
          <ul className="hi-list">
            {runs.map((r) => {
              const key = `${r.source}:${r.id}`;
              return (
                <li key={key}>
                  <button className={`hi-run ${selectedId === key ? "is-selected" : ""}`} onClick={() => setSelectedId(key)}>
                    <span className={`hi-status hi-status-${r.active ? "running" : r.status === "failed" ? "failed" : "done"}`} aria-hidden="true" />
                    <span className="hi-row-main">
                      <span className="hi-truncate">{r.title}</span>
                      <span className="hi-muted hi-small">{r.source === "swarm" ? "Swarm" : "Agent"} · {r.status}{r.at ? ` · ${formatTime(r.at)}` : ""}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Trace" icon={Activity} actions={
        <div className="hi-seg" role="tablist" aria-label="Filter trace">
          {[["all", "All"], ["tools", "Tool calls"], ["comms", "Agent comms"], ["errors", `Errors${errorCount ? ` (${errorCount})` : ""}`]].map(([id, label]) => (
            <button key={id} role="tab" aria-selected={filter === id} className={filter === id ? "is-active" : ""} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
      }>
        {!selectedId ? <p className="hi-empty">Select a run to inspect its trace.</p>
          : detail?.error ? <PanelState tone="error" icon={XCircle} title="Couldn't load trace">{detail.error}</PanelState>
            : (
              <>
                <div className="hi-stats">
                  <span><strong>{steps.length}</strong> steps</span>
                  <span><strong>{steps.filter((s) => s.tool).length}</strong> tool calls</span>
                  <span><strong>{formatDuration(totalMs)}</strong> total</span>
                  <span className={errorCount ? "hi-error" : ""}><strong>{errorCount}</strong> errors</span>
                </div>
                {visible.length === 0 ? <p className="hi-empty">{steps.length ? "No steps match this filter." : "This run has no recorded steps yet."}</p> : (
                  <ol className="hi-trace">
                    {visible.map((s) => (
                      <li key={s.id} className={`hi-step ${s.error || s.status === "failed" ? "is-error" : ""}`}>
                        <div className="hi-step-head">
                          {s.error || s.status === "failed" ? <XCircle size={14} className="hi-error" /> : s.status === "running" ? <Clock size={14} className="hi-accent" /> : <CheckCircle2 size={14} className="hi-ok" />}
                          <span className="hi-badge hi-badge-muted">{s.type}</span>
                          {s.agent && <span className="hi-small">{s.agent}</span>}
                          {s.tool && <span className="hi-mono hi-small hi-accent">{s.tool}</span>}
                          <span className="hi-spacer" />
                          <span className="hi-muted hi-small">{formatDuration(s.durationMs)}{s.at ? ` · ${formatTime(s.at)}` : ""}</span>
                        </div>
                        <Payload label="Input" value={s.input} />
                        <Payload label="Output" value={s.output} />
                        {s.error && <pre className="hi-pre hi-pre-error">{typeof s.error === "string" ? s.error : JSON.stringify(s.error, null, 2)}</pre>}
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
      </Section>
    </div>
  );
}
