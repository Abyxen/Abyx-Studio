import React, { useState, useEffect, useRef } from "react";
import {
  Play, Square, RefreshCw, Layers, Cpu, Shield, Search, Terminal, Code2,
  Users, Sliders, ChevronRight, FileCode, Check, X, CheckCircle, AlertTriangle,
  Clock, Plus, Filter, ArrowRight, Eye, Sparkles, AlertCircle, Network
} from "lucide-react";
import {
  getSpecializedAgents, registerCustomAgent, streamOrchestration, cancelOrchestration
} from "../services/api";

const STATUS_COLORS = {
  pending: "text-neutral-400 bg-neutral-800/40 border-neutral-700/50",
  ready: "text-blue-400 bg-blue-950/30 border-blue-800/50",
  running: "text-cyan-400 bg-cyan-950/40 border-cyan-500/50 animate-pulse",
  verifying: "text-amber-400 bg-amber-950/40 border-amber-500/50",
  completed: "text-emerald-400 bg-emerald-950/30 border-emerald-500/50",
  failed: "text-rose-400 bg-rose-950/30 border-rose-500/50",
  cancelled: "text-neutral-500 bg-neutral-900 border-neutral-800"
};

export default function MultiAgentWorkspace({ activeProject, onOpenFile }) {
  const [goal, setGoal] = useState("");
  const [concurrency, setConcurrency] = useState(4);
  const [model, setModel] = useState("auto");
  const [agents, setAgents] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [isOrchestrating, setIsOrchestrating] = useState(false);
  const [activeRun, setActiveRun] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [events, setEvents] = useState([]);
  const [findings, setFindings] = useState([]);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customForm, setCustomForm] = useState({ id: "", name: "", role: "", description: "", systemPrompt: "" });
  const [activeTab, setActiveTab] = useState("dag"); // 'dag' | 'fleet' | 'bus'

  const abortRef = useRef(null);
  const timelineEndRef = useRef(null);

  useEffect(() => {
    loadAgents();
  }, []);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  const loadAgents = async () => {
    try {
      const res = await getSpecializedAgents();
      if (res && res.ok) {
        setAgents(res.agents || []);
      }
    } catch (err) {
      console.warn("Failed to load specialized agents:", err);
    }
  };

  const handleStartOrchestration = async () => {
    if (!goal.trim() || isOrchestrating) return;

    setIsOrchestrating(true);
    setTasks([]);
    setEvents([]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      await streamOrchestration({
        goal: goal.trim(),
        model,
        concurrency,
        signal: ctrl.signal,
        onEvent: (type, data) => {
          setEvents(prev => [...prev.slice(-300), { type, data, time: new Date().toLocaleTimeString() }]);

          if (type === "orchestration:dag_formed" && Array.isArray(data.tasks)) {
            setTasks(data.tasks.map(t => ({ ...t, status: "pending" })));
          } else if (type === "task:started") {
            setTasks(prev => prev.map(t => t.id === data.taskId ? { ...t, status: "running", startedAt: data.timestamp } : t));
          } else if (type === "task:completed") {
            setTasks(prev => prev.map(t => t.id === data.taskId ? { ...t, status: "completed", result: data.result } : t));
            if (data.result?.finding) {
              setFindings(prev => [...prev, data.result.finding]);
            }
          } else if (type === "finding:published") {
            setFindings(prev => [...prev, data]);
          } else if (type === "task:failed") {
            setTasks(prev => prev.map(t => t.id === data.taskId ? { ...t, status: "failed", error: data.error } : t));
          } else if (type === "orchestration:done" || type === "orchestration:finished") {
            setIsOrchestrating(false);
            if (Array.isArray(data.tasks)) {
              setTasks(data.tasks);
            }
          } else if (type === "orchestration:error") {
            setIsOrchestrating(false);
          }
        }
      });
    } catch (err) {
      if (!ctrl.signal.aborted) {
        setEvents(prev => [...prev, { type: "error", data: { error: err.message }, time: new Date().toLocaleTimeString() }]);
      }
    } finally {
      setIsOrchestrating(false);
    }
  };

  const handleCancel = async () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setIsOrchestrating(false);
  };

  const handleSaveCustomAgent = async (e) => {
    e.preventDefault();
    if (!customForm.id || !customForm.name) return;
    try {
      const res = await registerCustomAgent(customForm);
      if (res && res.ok) {
        loadAgents();
        setShowCustomModal(false);
        setCustomForm({ id: "", name: "", role: "", description: "", systemPrompt: "" });
      }
    } catch (err) {
      console.error("Failed to register custom agent:", err);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#0d0f14] text-neutral-200 overflow-hidden font-sans">
      {/* Top Header & Mission Dispatch Bar */}
      <div className="p-4 border-b border-white/[0.08] bg-[#12151d] flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-600/15 border border-blue-500/25 text-blue-400">
              <Network className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-wide text-white">Multi-Agent Swarm Orchestrator</h1>
              <p className="text-[11px] text-neutral-400">DAG task dependency scheduling with 12 specialized agents and independent verification</p>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex items-center gap-1 bg-white/[0.04] p-1 rounded-lg border border-white/5 text-xs">
            <button
              onClick={() => setActiveTab("dag")}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${activeTab === "dag" ? "bg-blue-600 text-white shadow-sm" : "text-neutral-400 hover:text-white"}`}
            >
              Task DAG ({tasks.length})
            </button>
            <button
              onClick={() => setActiveTab("fleet")}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${activeTab === "fleet" ? "bg-blue-600 text-white shadow-sm" : "text-neutral-400 hover:text-white"}`}
            >
              Agent Fleet ({agents.length})
            </button>
            <button
              onClick={() => setActiveTab("findings")}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${activeTab === "findings" ? "bg-blue-600 text-white shadow-sm" : "text-neutral-400 hover:text-white"}`}
            >
              Findings &amp; Artifacts ({findings.length})
            </button>
            <button
              onClick={() => setActiveTab("bus")}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${activeTab === "bus" ? "bg-blue-600 text-white shadow-sm" : "text-neutral-400 hover:text-white"}`}
            >
              Message Bus ({events.length})
            </button>
          </div>
        </div>

        {/* Goal Input & Control Parameters */}
        <div className="flex items-center gap-2 pt-1">
          <input
            type="text"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !isOrchestrating && handleStartOrchestration()}
            placeholder="Describe high-level objective (e.g. Build an authenticated REST API with SQLite database, unit tests, and API documentation)..."
            className="flex-1 px-4 py-2 text-xs rounded-lg bg-black/40 border border-white/10 text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500 transition-colors"
          />

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 text-xs">
              <span className="text-[11px] text-neutral-400">Workers:</span>
              <select
                value={concurrency}
                onChange={(e) => setConcurrency(parseInt(e.target.value, 10))}
                className="bg-transparent text-white font-mono text-xs focus:outline-none cursor-pointer"
              >
                {[1, 2, 4, 6, 8].map(n => <option key={n} value={n} className="bg-neutral-900">{n} Parallel</option>)}
              </select>
            </div>

            {isOrchestrating ? (
              <button
                onClick={handleCancel}
                className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-rose-600 hover:bg-rose-500 rounded-lg shadow-lg shadow-rose-600/20 transition-colors"
              >
                <Square className="w-3.5 h-3.5 fill-current" /> Stop Swarm
              </button>
            ) : (
              <button
                onClick={handleStartOrchestration}
                disabled={!goal.trim()}
                className="flex items-center gap-2 px-5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg shadow-lg shadow-blue-600/20 transition-colors"
              >
                <Play className="w-3.5 h-3.5 fill-current" /> Launch Swarm
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Section: Active DAG View */}
        {activeTab === "dag" && (
          <div className="flex-1 flex flex-col p-4 overflow-y-auto space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-400 tracking-wider uppercase">Directed Acyclic Task Graph (DAG)</span>
              <span className="text-xs text-neutral-500">
                Completed: {tasks.filter(t => t.status === "completed").length} / {tasks.length}
              </span>
            </div>

            {tasks.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-white/10 rounded-xl p-8 text-center text-neutral-500 space-y-2">
                <Network className="w-10 h-10 opacity-40 text-neutral-400" />
                <p className="text-xs">No active orchestration. Enter an objective above and click Launch Swarm.</p>
                <p className="text-[11px] text-neutral-600">The orchestrator will automatically decompose your goal, generate DAG dependencies, and dispatch specialized agents.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className={`p-4 rounded-xl border flex flex-col justify-between transition-all ${STATUS_COLORS[task.status] || "border-white/10 bg-white/[0.02]"}`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-black/40 border border-white/10 font-bold">
                          {task.agentRole}
                        </span>
                        <span className="text-[10px] font-semibold capitalize tracking-wide px-2 py-0.5 rounded-full border">
                          {task.status}
                        </span>
                      </div>
                      <h3 className="text-xs font-semibold text-white mb-1">{task.title}</h3>
                      <p className="text-[11px] text-neutral-400 line-clamp-3 mb-2">{task.description}</p>
                    </div>

                    <div className="pt-2 border-t border-white/5 space-y-1.5 text-[10px] text-neutral-400 font-mono">
                      {task.dependsOn && task.dependsOn.length > 0 && (
                        <div className="flex items-center gap-1 truncate">
                          <span className="text-neutral-500">Depends on:</span>
                          <span className="text-neutral-300">{task.dependsOn.join(", ")}</span>
                        </div>
                      )}
                      {task.ownedFiles && task.ownedFiles.length > 0 && (
                        <div className="flex items-center gap-1 truncate">
                          <span className="text-neutral-500">Owned Files:</span>
                          <span className="text-neutral-300">{task.ownedFiles.join(", ")}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Fleet Section: 12 Specialized Agents */}
        {activeTab === "fleet" && (
          <div className="flex-1 flex flex-col p-4 overflow-y-auto space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-400 tracking-wider uppercase">Specialized Agent Fleet</span>
              <button
                onClick={() => setShowCustomModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/30 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Custom Agent
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className="p-4 rounded-xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition-colors flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-white tracking-wide">{agent.name}</span>
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        {agent.category}
                      </span>
                    </div>
                    <p className="text-[11px] font-medium text-neutral-300 mb-1">{agent.role}</p>
                    <p className="text-[11px] text-neutral-400 line-clamp-2 mb-3">{agent.description}</p>
                  </div>

                  <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[10px] text-neutral-400 font-mono">
                    <span>Temp: {agent.temperature}</span>
                    <span>Tools: {agent.allowedTools?.length || 0}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Findings & Artifacts View */}
        {activeTab === "findings" && (
          <div className="flex-1 flex flex-col p-4 overflow-y-auto space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-400 tracking-wider uppercase">
                Shared Memory Findings &amp; Deliverables ({findings.length})
              </span>
              <span className="text-xs text-neutral-500 font-mono">
                Decisions &amp; Artifacts Published
              </span>
            </div>

            {findings.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-white/10 rounded-xl p-8 text-center text-neutral-500 space-y-2">
                <FileCode className="w-8 h-8 opacity-40 text-neutral-400" />
                <p className="text-xs">No findings recorded in shared memory yet.</p>
                <p className="text-[11px] text-neutral-600">As specialized agents complete tasks, their architectural decisions, code contracts, and deliverables will appear here.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {findings.map((f, idx) => (
                  <div key={idx} className="p-4 rounded-xl border border-white/10 bg-white/[0.02] flex flex-col justify-between space-y-2">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                          {f.agentId || "Agent"}
                        </span>
                        <span className="text-[10px] text-neutral-500 font-mono">
                          {f.timestamp ? new Date(f.timestamp).toLocaleTimeString() : ""}
                        </span>
                      </div>
                      <h4 className="text-xs font-semibold text-white mb-1">{f.topic}</h4>
                      <p className="text-[11px] text-neutral-300 leading-relaxed font-sans">{f.conclusion}</p>
                    </div>
                    {f.taskId && (
                      <div className="pt-2 border-t border-white/5 text-[10px] font-mono text-neutral-500">
                        Task Source: {f.taskId}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Message Bus Stream */}
        {activeTab === "bus" && (
          <div className="flex-1 flex flex-col p-4 overflow-y-auto space-y-2 font-mono text-[11px]">
            <span className="text-xs font-semibold text-neutral-400 tracking-wider uppercase mb-2 font-sans">
              Inter-Agent Message Bus Log ({events.length} Events)
            </span>
            {events.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-neutral-500">
                No bus events recorded yet.
              </div>
            ) : (
              <div className="space-y-1.5">
                {events.map((ev, i) => (
                  <div key={i} className="p-2 rounded bg-white/[0.02] border border-white/5 flex items-start gap-2">
                    <span className="text-neutral-500 shrink-0">{ev.time}</span>
                    <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-bold shrink-0">{ev.type}</span>
                    <span className="text-neutral-300 break-all">{JSON.stringify(ev.data)}</span>
                  </div>
                ))}
                <div ref={timelineEndRef} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Custom Agent Modal */}
      {showCustomModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-[#141720] border border-white/10 rounded-xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h2 className="text-sm font-semibold text-white">Create Custom Specialized Agent</h2>
              <button onClick={() => setShowCustomModal(false)} className="text-neutral-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveCustomAgent} className="space-y-3 text-xs">
              <div>
                <label className="block text-neutral-400 mb-1">Agent ID (lowercase slug)</label>
                <input
                  type="text"
                  required
                  value={customForm.id}
                  onChange={(e) => setCustomForm({ ...customForm, id: e.target.value })}
                  placeholder="e.g. sql_optimizer"
                  className="w-full px-3 py-1.5 bg-black/40 border border-white/10 rounded text-white"
                />
              </div>
              <div>
                <label className="block text-neutral-400 mb-1">Agent Name</label>
                <input
                  type="text"
                  required
                  value={customForm.name}
                  onChange={(e) => setCustomForm({ ...customForm, name: e.target.value })}
                  placeholder="e.g. SQL Performance Optimizer"
                  className="w-full px-3 py-1.5 bg-black/40 border border-white/10 rounded text-white"
                />
              </div>
              <div>
                <label className="block text-neutral-400 mb-1">Role Title</label>
                <input
                  type="text"
                  value={customForm.role}
                  onChange={(e) => setCustomForm({ ...customForm, role: e.target.value })}
                  placeholder="e.g. Database Index & Query Specialist"
                  className="w-full px-3 py-1.5 bg-black/40 border border-white/10 rounded text-white"
                />
              </div>
              <div>
                <label className="block text-neutral-400 mb-1">System Instructions</label>
                <textarea
                  rows={4}
                  value={customForm.systemPrompt}
                  onChange={(e) => setCustomForm({ ...customForm, systemPrompt: e.target.value })}
                  placeholder="Define role instructions, constraints, and operational guidelines..."
                  className="w-full px-3 py-1.5 bg-black/40 border border-white/10 rounded text-white"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowCustomModal(false)}
                  className="px-3 py-1.5 rounded text-neutral-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded bg-blue-600 text-white font-medium hover:bg-blue-500"
                >
                  Create Agent
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
