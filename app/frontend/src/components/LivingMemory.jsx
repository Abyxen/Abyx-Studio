import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Brain, Search, Plus, Trash2, RefreshCw, Sparkles, Check, AlertCircle, ShieldCheck, Tag } from "lucide-react";
import { getMemories, saveMemoryActions } from "../services/api";
import "../styles/abyx.css";

export default function LivingMemory({ showAlert, showConfirm }) {
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [newMemory, setNewMemory] = useState({
    key: "",
    value: "",
    category: "preference",
    confidence: 1.0,
  });
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getMemories();
      setMemories(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load living memories:", err);
      showAlert?.({ title: "Error", message: "Failed to load profile memories: " + err.message, danger: true });
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddMemory = async (e) => {
    e.preventDefault();
    if (!newMemory.key.trim() || !newMemory.value.trim()) {
      showAlert?.({ title: "Validation", message: "Key and Value are required.", danger: true });
      return;
    }
    setSaving(true);
    try {
      const action = {
        type: "upsert",
        key: newMemory.key.trim(),
        value: newMemory.value.trim(),
        category: newMemory.category || "preference",
        confidence_score: Number(newMemory.confidence) || 1.0,
        reasoning: "User manual memory entry",
      };
      const res = await saveMemoryActions([action]);
      if (res.success || res.ok) {
        showAlert?.({ title: "Memory Stored", message: "Knowledge fact added to your persistent AI profile." });
        setShowAddModal(false);
        setNewMemory({ key: "", value: "", category: "preference", confidence: 1.0 });
        await loadData();
      }
    } catch (err) {
      showAlert?.({ title: "Save Error", message: err.message, danger: true });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMemory = async (memory) => {
    const confirmed = await showConfirm?.({
      title: "Delete Memory Item",
      message: `Are you sure you want to delete "${memory.key}: ${memory.value}" from persistent memory?`,
      confirmLabel: "Delete Fact",
      danger: true,
    });
    if (!confirmed) return;

    try {
      const action = {
        type: "delete",
        key: memory.key,
      };
      await saveMemoryActions([action]);
      showAlert?.({ title: "Deleted", message: "Memory fact removed from profile." });
      await loadData();
    } catch (err) {
      showAlert?.({ title: "Delete Error", message: err.message, danger: true });
    }
  };

  const categories = useMemo(() => {
    const cats = new Set(memories.map((m) => m.category || "general"));
    return ["all", ...Array.from(cats)];
  }, [memories]);

  const filteredMemories = useMemo(() => {
    return memories.filter((m) => {
      if (selectedCategory !== "all" && (m.category || "general") !== selectedCategory) return false;
      if (!search.trim()) return true;
      const s = search.toLowerCase();
      return (
        (m.key || "").toLowerCase().includes(s) ||
        (m.value || "").toLowerCase().includes(s) ||
        (m.category || "").toLowerCase().includes(s) ||
        (m.reasoning || "").toLowerCase().includes(s)
      );
    });
  }, [memories, selectedCategory, search]);

  return (
    <div className="abyx-page-container">
      {/* Header */}
      <div className="abyx-page-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 className="abyx-page-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Brain size={24} /> Living Memory &amp; Profile Knowledge
            </h1>
            <p className="abyx-page-subtitle">
              Persistent long-term memory engine. Automatically tracks user preferences, project context, coding habits, and domain knowledge across sessions in encrypted SQLite storage.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="abyx-btn abyx-btn-primary" onClick={() => setShowAddModal(true)}>
              <Plus size={14} /> Add Memory Fact
            </button>
            <button className="abyx-btn" onClick={loadData} disabled={loading}>
              <RefreshCw size={14} className={loading ? "status-pill-spin" : ""} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Filter and Stats Card */}
      <div className="abyx-section-card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <input
              type="text"
              className="abyx-input"
              placeholder="Search facts, keys, or preferences in living memory..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div style={{ fontSize: "0.85rem", color: "var(--md-sys-color-outline)", display: "flex", alignItems: "center", gap: 6 }}>
            <ShieldCheck size={16} color="var(--md-sys-color-success)" />
            <span>SQLite v8 Memory Schema · Profile: prof_default</span>
          </div>
        </div>

        {/* Category Pills */}
        <div className="abyx-filter-tabs">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`abyx-filter-tab ${selectedCategory === cat ? "active" : ""}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat === "all" ? `All Facts (${memories.length})` : `${cat.charAt(0).toUpperCase() + cat.slice(1)}`}
            </button>
          ))}
        </div>
      </div>

      {/* Memories List */}
      {filteredMemories.length === 0 ? (
        <div className="abyx-section-card" style={{ textAlign: "center", padding: "48px 24px", color: "var(--md-sys-color-outline)" }}>
          <Brain size={42} style={{ opacity: 0.4, marginBottom: 12 }} />
          <h3 style={{ margin: "0 0 6px", color: "var(--md-sys-color-on-surface)" }}>No Memory Facts Found</h3>
          <p style={{ margin: 0, fontSize: "0.85rem" }}>
            {search ? "No facts match your search term." : "Living memory learns facts from your conversations automatically, or you can add custom facts manually."}
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {filteredMemories.map((m) => (
            <div key={m.id || m.key} className="abyx-section-card" style={{ margin: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 10 }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
                  <span className="abyx-pill" style={{ textTransform: "uppercase", fontWeight: 600 }}>
                    <Tag size={10} style={{ marginRight: 4 }} />
                    {m.category || "general"}
                  </span>
                  <button
                    type="button"
                    className="abyx-btn abyx-btn-sm"
                    style={{ color: "var(--md-sys-color-error)", borderColor: "transparent", padding: "2px 6px" }}
                    onClick={() => handleDeleteMemory(m)}
                    title="Remove this memory fact"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                <div style={{ fontWeight: 600, fontSize: "0.95rem", color: "var(--md-sys-color-on-surface)", marginBottom: 4 }}>
                  {m.key}
                </div>
                <div style={{ fontSize: "0.85rem", color: "var(--md-sys-color-on-surface)", lineHeight: 1.4, wordBreak: "break-word" }}>
                  {m.value}
                </div>
              </div>

              <div style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)", borderTop: "1px solid var(--border-color-muted)", paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Confidence: {Math.round((m.confidence ?? 1.0) * 100)}%</span>
                {m.reasoning && <span style={{ fontStyle: "italic", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.reasoning}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Memory Modal */}
      {showAddModal && (
        <div className="abyx-modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="abyx-modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="abyx-modal-header">
              <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                <Brain size={18} /> Add Living Memory Fact
              </h2>
            </div>
            <form onSubmit={handleAddMemory}>
              <div className="abyx-modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: 4 }}>
                    Fact Key / Subject
                  </label>
                  <input
                    type="text"
                    className="abyx-input"
                    placeholder="e.g. Preferred Language, Project Framework"
                    value={newMemory.key}
                    onChange={(e) => setNewMemory((prev) => ({ ...prev, key: e.target.value }))}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: 4 }}>
                    Fact Value / Knowledge
                  </label>
                  <textarea
                    className="abyx-input"
                    rows={3}
                    placeholder="e.g. Always write code with TypeScript and strict null checks"
                    value={newMemory.value}
                    onChange={(e) => setNewMemory((prev) => ({ ...prev, value: e.target.value }))}
                    required
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: 4 }}>
                      Category
                    </label>
                    <select
                      className="abyx-input"
                      value={newMemory.category}
                      onChange={(e) => setNewMemory((prev) => ({ ...prev, category: e.target.value }))}
                    >
                      <option value="preference">Preference</option>
                      <option value="project">Project Context</option>
                      <option value="knowledge">Domain Knowledge</option>
                      <option value="workflow">Workflow</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: 4 }}>
                      Confidence Score
                    </label>
                    <input
                      type="number"
                      step="0.05"
                      min="0.1"
                      max="1.0"
                      className="abyx-input"
                      value={newMemory.confidence}
                      onChange={(e) => setNewMemory((prev) => ({ ...prev, confidence: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <div className="abyx-modal-footer">
                <button type="button" className="abyx-btn" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="abyx-btn abyx-btn-primary" disabled={saving}>
                  {saving ? "Saving..." : "Save to Memory"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
