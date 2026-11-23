import React, { useState, useEffect, useRef } from "react";
import {
  BookOpen,
  Plus,
  Trash2,
  FileText,
  Globe,
  Upload,
  Send,
  Sparkles,
  HelpCircle,
  Layers,
  CheckCircle,
  RotateCcw,
  RefreshCw,
  FileUp,
  Search,
  ExternalLink,
  ChevronRight,
  BookMarked,
  GraduationCap,
  Award
} from "lucide-react";
import {
  listStudybooks,
  createStudybook,
  getStudybook,
  updateStudybook,
  deleteStudybook,
  getStudybookProgress,
  listStudybookSources,
  addStudybookSource,
  removeStudybookSource,
  getStudybookMessages,
  clearStudybookMessages,
  chatStudybook,
  listStudyMaterials,
  generateStudyMaterial,
  deleteStudyMaterial,
  recordQuizScore,
  recordFlashcardMastery
} from "../services/api";

export default function StudybooksManager() {
  const [studybooks, setStudybooks] = useState([]);
  const [activeStudybookId, setActiveStudybookId] = useState(null);
  const [sources, setSources] = useState([]);
  const [messages, setMessages] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [chatLoading, setChatLoading] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [error, setError] = useState(null);
  const [chatInput, setChatInput] = useState("");
  const [activeTab, setActiveTab] = useState("chat"); // 'chat', 'flashcards', 'quiz', 'guide'

  // Modal & Input States
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newEmoji, setNewEmoji] = useState("📘");

  const [addSourceModalOpen, setAddSourceModalOpen] = useState(false);
  const [sourceType, setSourceType] = useState("text"); // 'text', 'url', 'file'
  const [sourceText, setSourceText] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceFilePath, setSourceFilePath] = useState("");

  // Flashcards state
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [masteredCards, setMasteredCards] = useState(new Set());

  // Quiz state
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizScore, setQuizScore] = useState(null);

  const chatEndRef = useRef(null);

  // Load studybooks on mount
  useEffect(() => {
    loadStudybooks();
  }, []);

  // When active studybook changes, load its details
  useEffect(() => {
    if (activeStudybookId) {
      loadStudybookData(activeStudybookId);
    }
  }, [activeStudybookId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatLoading]);

  const loadStudybooks = async () => {
    setLoading(true);
    try {
      const res = await listStudybooks();
      if (res?.ok && Array.isArray(res.studybooks)) {
        setStudybooks(res.studybooks);
        if (res.studybooks.length > 0 && !activeStudybookId) {
          setActiveStudybookId(res.studybooks[0].id);
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadStudybookData = async (id) => {
    try {
      const [srcRes, msgRes, matRes, progRes] = await Promise.all([
        listStudybookSources(id).catch(() => ({ sources: [] })),
        getStudybookMessages(id).catch(() => ({ messages: [] })),
        listStudyMaterials(id).catch(() => ({ materials: [] })),
        getStudybookProgress(id).catch(() => ({ progress: null }))
      ]);

      if (srcRes?.ok) setSources(srcRes.sources || []);
      if (msgRes?.ok) setMessages(msgRes.messages || []);
      if (matRes?.ok) setMaterials(matRes.materials || []);
      if (progRes?.ok) setProgress(progRes.progress || null);
    } catch (err) {
      console.warn("Error loading studybook details:", err);
    }
  };

  const handleCreateStudybook = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      const res = await createStudybook({
        title: newTitle.trim(),
        description: newDesc.trim(),
        emoji: newEmoji || "📘"
      });
      if (res?.ok && res.studybook) {
        setStudybooks(prev => [res.studybook, ...prev]);
        setActiveStudybookId(res.studybook.id);
        setCreateModalOpen(false);
        setNewTitle("");
        setNewDesc("");
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteStudybook = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this studybook?")) return;
    try {
      await deleteStudybook(id);
      setStudybooks(prev => prev.filter(s => s.id !== id));
      if (activeStudybookId === id) {
        const remaining = studybooks.filter(s => s.id !== id);
        setActiveStudybookId(remaining.length > 0 ? remaining[0].id : null);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAddSource = async (e) => {
    e.preventDefault();
    if (!activeStudybookId) return;
    try {
      let payload;
      if (sourceType === "text") {
        if (!sourceText.trim()) return;
        payload = { type: "text", text: sourceText, title: sourceTitle.trim() || "Lecture Notes" };
      } else if (sourceType === "url") {
        if (!sourceUrl.trim()) return;
        payload = { type: "url", url: sourceUrl.trim(), title: sourceTitle.trim() };
      } else if (sourceType === "file") {
        if (!sourceFilePath.trim()) return;
        payload = { type: "file", filePath: sourceFilePath.trim() };
      }

      await addStudybookSource(activeStudybookId, payload);
      setAddSourceModalOpen(false);
      setSourceText("");
      setSourceTitle("");
      setSourceUrl("");
      setSourceFilePath("");
      loadStudybookData(activeStudybookId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRemoveSource = async (sourceId) => {
    if (!activeStudybookId) return;
    try {
      await removeStudybookSource(activeStudybookId, sourceId);
      setSources(prev => prev.filter(s => s.id !== sourceId));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !activeStudybookId || chatLoading) return;
    const prompt = chatInput.trim();
    setChatInput("");
    setChatLoading(true);

    // Optimistically append user message
    const tempMsg = { role: "user", content: prompt, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, tempMsg]);

    try {
      const res = await chatStudybook(activeStudybookId, prompt);
      if (res?.ok) {
        setMessages(prev => [
          ...prev,
          {
            role: "assistant",
            content: res.answer,
            citations: res.citations || [],
            created_at: new Date().toISOString()
          }
        ]);
      } else {
        setError(res?.error || "Failed to get grounded answer");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setChatLoading(false);
    }
  };

  const handleGenerateMaterial = async (type) => {
    if (!activeStudybookId || genLoading) return;
    setGenLoading(true);
    try {
      const res = await generateStudyMaterial(activeStudybookId, type);
      if (res?.ok && res.material) {
        setMaterials(prev => [res.material, ...prev]);
        setActiveTab(type);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setGenLoading(false);
    }
  };

  const handleClearMessages = async () => {
    if (!activeStudybookId || !window.confirm("Clear study chat conversation history?")) return;
    try {
      await clearStudybookMessages(activeStudybookId);
      setMessages([]);
    } catch (err) {
      setError(err.message);
    }
  };

  const activeStudybook = studybooks.find(s => s.id === activeStudybookId);
  const flashcardMaterials = materials.filter(m => m.type === "flashcards");
  const activeDeck = flashcardMaterials.length > 0 ? flashcardMaterials[0] : null;
  const currentCard = activeDeck?.content?.cards?.[cardIndex] || null;

  const quizMaterials = materials.filter(m => m.type === "quiz");
  const activeQuiz = quizMaterials.length > 0 ? quizMaterials[0] : null;
  const guideMaterials = materials.filter(m => m.type === "guide" || m.type === "summary");

  return (
    <div className="abyx-page-container">
      {/* Header */}
      <div className="abyx-page-header">
        <div className="abyx-page-title-row">
          <div className="abyx-page-title-wrap">
            <BookOpen className="abyx-header-icon" size={26} />
            <div>
              <h1 className="abyx-page-title">ABYX LM — Grounded Study & Notebook</h1>
              <p className="abyx-page-subtitle">
                NotebookLM-style grounded AI workspace. Ingest PDFs, Markdown, URLs, or notes and study with verified source citations, interactive flashcards, and quizzes.
              </p>
            </div>
          </div>
          <div className="abyx-header-actions">
            <button
              type="button"
              className="abyx-btn abyx-btn-primary"
              onClick={() => setCreateModalOpen(true)}
            >
              <Plus size={16} />
              <span>New Studybook</span>
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="abyx-banner error" style={{ marginBottom: 16 }}>
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }}>×</button>
        </div>
      )}

      {/* Main Study Workspace Layout */}
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20, height: "calc(100vh - 210px)", minHeight: 520 }}>
        {/* Left Column: Studybooks & Sources */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
          {/* Studybooks Selector Card */}
          <div className="abyx-card" style={{ padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--md-sys-color-outline)", textTransform: "uppercase" }}>
                Your Studybooks ({studybooks.length})
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto" }}>
              {studybooks.map(sb => (
                <div
                  key={sb.id}
                  onClick={() => setActiveStudybookId(sb.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 10px",
                    borderRadius: 6,
                    cursor: "pointer",
                    backgroundColor: sb.id === activeStudybookId ? "var(--md-sys-color-surface-variant, #2a2a30)" : "transparent",
                    border: `1px solid ${sb.id === activeStudybookId ? "var(--accent-color, #ff6a3d)" : "transparent"}`
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
                    <span style={{ fontSize: "1.1rem" }}>{sb.emoji || "📘"}</span>
                    <span style={{ fontSize: "0.88rem", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {sb.title}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteStudybook(sb.id, e)}
                    style={{ background: "none", border: "none", color: "var(--md-sys-color-outline)", cursor: "pointer", opacity: 0.6 }}
                    title="Delete studybook"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Source Documents Card */}
          <div className="abyx-card" style={{ padding: 14, flex: 1, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--md-sys-color-outline)", textTransform: "uppercase" }}>
                Sources & Documents ({sources.length})
              </span>
              <button
                type="button"
                className="abyx-btn abyx-btn-secondary"
                style={{ padding: "4px 8px", fontSize: "0.78rem" }}
                onClick={() => setAddSourceModalOpen(true)}
                disabled={!activeStudybookId}
              >
                <Plus size={12} />
                <span>Add Source</span>
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
              {sources.length === 0 ? (
                <div style={{ textAlign: "center", color: "var(--md-sys-color-outline)", fontSize: "0.82rem", padding: "20px 10px" }}>
                  No sources attached yet. Click "Add Source" to upload a PDF, add a URL, or paste lecture notes.
                </div>
              ) : (
                sources.map(src => (
                  <div
                    key={src.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 10px",
                      borderRadius: 6,
                      backgroundColor: "var(--md-sys-color-surface-container, rgba(255,255,255,0.03))",
                      border: "1px solid var(--border-color, #333)"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
                      <FileText size={15} style={{ flexShrink: 0, color: "var(--accent-color, #ff6a3d)" }} />
                      <div style={{ overflow: "hidden" }}>
                        <div style={{ fontSize: "0.82rem", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {src.name || src.title}
                        </div>
                        <div style={{ fontSize: "0.72rem", color: "var(--md-sys-color-outline)" }}>
                          {src.chunk_count || 1} chunks • {src.total_chars || 0} chars
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveSource(src.id)}
                      style={{ background: "none", border: "none", color: "var(--md-sys-color-outline)", cursor: "pointer", opacity: 0.6 }}
                      title="Unlink source"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Grounded Study Center & Materials */}
        <div className="abyx-card" style={{ display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
          {/* Workspace Tabs Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--border-color, #333)" }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className={`abyx-btn ${activeTab === "chat" ? "abyx-btn-primary" : "abyx-btn-secondary"}`}
                style={{ padding: "6px 12px", fontSize: "0.85rem" }}
                onClick={() => setActiveTab("chat")}
              >
                <BookMarked size={14} />
                <span>Grounded Study Chat</span>
              </button>
              <button
                type="button"
                className={`abyx-btn ${activeTab === "flashcards" ? "abyx-btn-primary" : "abyx-btn-secondary"}`}
                style={{ padding: "6px 12px", fontSize: "0.85rem" }}
                onClick={() => setActiveTab("flashcards")}
              >
                <Layers size={14} />
                <span>Flashcards ({flashcardMaterials.length})</span>
              </button>
              <button
                type="button"
                className={`abyx-btn ${activeTab === "quiz" ? "abyx-btn-primary" : "abyx-btn-secondary"}`}
                style={{ padding: "6px 12px", fontSize: "0.85rem" }}
                onClick={() => setActiveTab("quiz")}
              >
                <HelpCircle size={14} />
                <span>Quizzes ({quizMaterials.length})</span>
              </button>
              <button
                type="button"
                className={`abyx-btn ${activeTab === "guide" ? "abyx-btn-primary" : "abyx-btn-secondary"}`}
                style={{ padding: "6px 12px", fontSize: "0.85rem" }}
                onClick={() => setActiveTab("guide")}
              >
                <GraduationCap size={14} />
                <span>Study Guides ({guideMaterials.length})</span>
              </button>
            </div>

            {/* Quick Generator Actions */}
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                className="abyx-btn abyx-btn-secondary"
                style={{ padding: "5px 10px", fontSize: "0.8rem" }}
                onClick={() => handleGenerateMaterial("flashcards")}
                disabled={genLoading || sources.length === 0}
                title="Synthesize 12 active recall flashcards from sources"
              >
                <Sparkles size={13} />
                <span>Gen Flashcards</span>
              </button>
              <button
                type="button"
                className="abyx-btn abyx-btn-secondary"
                style={{ padding: "5px 10px", fontSize: "0.8rem" }}
                onClick={() => handleGenerateMaterial("quiz")}
                disabled={genLoading || sources.length === 0}
                title="Generate grounded multiple-choice quiz"
              >
                <Award size={13} />
                <span>Gen Quiz</span>
              </button>
            </div>
          </div>

          {/* TAB CONTENT: Grounded Study Chat */}
          {activeTab === "chat" && (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
              <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
                {messages.length === 0 ? (
                  <div style={{ textAlign: "center", margin: "auto", maxWidth: 440, color: "var(--md-sys-color-outline)" }}>
                    <BookOpen size={36} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
                    <h3 style={{ margin: "0 0 6px", fontSize: "1.1rem", color: "var(--md-sys-color-on-background)" }}>
                      Study Grounded in Verified Sources
                    </h3>
                    <p style={{ fontSize: "0.88rem", margin: 0, lineHeight: 1.5 }}>
                      Ask questions, request summaries, or explore concepts. Every response is strictly grounded in the sources attached to this studybook.
                    </p>
                  </div>
                ) : (
                  messages.map((m, idx) => (
                    <div
                      key={idx}
                      style={{
                        alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                        maxWidth: "85%",
                        padding: "12px 16px",
                        borderRadius: 10,
                        backgroundColor: m.role === "user" ? "var(--accent-color, #ff6a3d)" : "var(--md-sys-color-surface-variant, #2a2a30)",
                        color: m.role === "user" ? "#fff" : "var(--md-sys-color-on-surface, #eee)",
                        fontSize: "0.92rem",
                        lineHeight: 1.5
                      }}
                    >
                      <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
                      {Array.isArray(m.citations) && m.citations.length > 0 && (
                        <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.1)", fontSize: "0.78rem" }}>
                          <span style={{ fontWeight: 600, opacity: 0.8 }}>Sources Cited:</span>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                            {m.citations.map((c, cIdx) => (
                              <span
                                key={cIdx}
                                style={{
                                  backgroundColor: "rgba(0,0,0,0.25)",
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  fontSize: "0.72rem"
                                }}
                              >
                                [Source {c.index}: {c.sourceName || "Document"}]
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
                {chatLoading && (
                  <div style={{ alignSelf: "flex-start", padding: "10px 14px", borderRadius: 8, backgroundColor: "var(--md-sys-color-surface-variant, #2a2a30)", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: 8 }}>
                    <RefreshCw size={14} className="spin" />
                    <span>Searching sources and synthesizing grounded response...</span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat Input Bar */}
              <form onSubmit={handleSendMessage} style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--border-color, #333)", backgroundColor: "var(--md-sys-color-surface)" }}>
                <input
                  type="text"
                  placeholder={sources.length === 0 ? "Add a source to begin grounded study chat..." : "Ask questions grounded in attached sources..."}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  style={{
                    flex: 1,
                    padding: "10px 14px",
                    borderRadius: 6,
                    border: "1px solid var(--border-color, #444)",
                    backgroundColor: "var(--md-sys-color-background)",
                    color: "inherit",
                    fontSize: "0.9rem"
                  }}
                  disabled={chatLoading}
                />
                <button
                  type="submit"
                  className="abyx-btn abyx-btn-primary"
                  disabled={chatLoading || !chatInput.trim()}
                >
                  <Send size={15} />
                  <span>Ask</span>
                </button>
                {messages.length > 0 && (
                  <button
                    type="button"
                    className="abyx-btn abyx-btn-secondary"
                    onClick={handleClearMessages}
                    title="Clear conversation"
                  >
                    <RotateCcw size={15} />
                  </button>
                )}
              </form>
            </div>
          )}

          {/* TAB CONTENT: Interactive Flashcards */}
          {activeTab === "flashcards" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, overflowY: "auto" }}>
              {currentCard ? (
                <div style={{ width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", gap: 16 }}>
                  {/* Progress Header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.85rem", color: "var(--md-sys-color-outline)" }}>
                    <span>Card {cardIndex + 1} of {activeDeck.content.cards.length}</span>
                    <span>{masteredCards.size} Mastered</span>
                  </div>

                  {/* Flippable Card */}
                  <div
                    onClick={() => setFlipped(!flipped)}
                    style={{
                      minHeight: 220,
                      backgroundColor: "var(--md-sys-color-surface-variant, #222)",
                      borderRadius: 12,
                      border: "1px solid var(--border-color, #444)",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                      alignItems: "center",
                      padding: 32,
                      textAlign: "center",
                      cursor: "pointer",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.3)"
                    }}
                  >
                    <span style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: 1, color: "var(--accent-color, #ff6a3d)", marginBottom: 12 }}>
                      {flipped ? "Answer" : "Question (Click to flip)"}
                    </span>
                    <div style={{ fontSize: "1.15rem", fontWeight: 500, lineHeight: 1.5 }}>
                      {flipped ? currentCard.back : currentCard.front}
                    </div>
                    {currentCard.hint && !flipped && (
                      <span style={{ fontSize: "0.8rem", color: "var(--md-sys-color-outline)", marginTop: 16 }}>
                        Hint: {currentCard.hint}
                      </span>
                    )}
                  </div>

                  {/* Controls */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <button
                      type="button"
                      className="abyx-btn abyx-btn-secondary"
                      onClick={() => {
                        setFlipped(false);
                        setCardIndex(prev => Math.max(0, prev - 1));
                      }}
                      disabled={cardIndex === 0}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className={`abyx-btn ${masteredCards.has(currentCard.id) ? "abyx-btn-primary" : "abyx-btn-secondary"}`}
                      onClick={() => {
                        const next = new Set(masteredCards);
                        if (next.has(currentCard.id)) next.delete(currentCard.id);
                        else next.add(currentCard.id);
                        setMasteredCards(next);
                        if (activeDeck?.id) recordFlashcardMastery(activeDeck.id, Array.from(next));
                      }}
                    >
                      <CheckCircle size={15} />
                      <span>{masteredCards.has(currentCard.id) ? "Mastered" : "Mark Mastered"}</span>
                    </button>
                    <button
                      type="button"
                      className="abyx-btn abyx-btn-secondary"
                      onClick={() => {
                        setFlipped(false);
                        setCardIndex(prev => Math.min(activeDeck.content.cards.length - 1, prev + 1));
                      }}
                      disabled={cardIndex >= activeDeck.content.cards.length - 1}
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: "center", color: "var(--md-sys-color-outline)" }}>
                  <Layers size={40} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
                  <h3>No Flashcards Deck Generated Yet</h3>
                  <p style={{ maxWidth: 400, fontSize: "0.88rem", margin: "0 auto 16px" }}>
                    Click "Gen Flashcards" in the top bar to synthesize an active-recall deck from your sources.
                  </p>
                  <button
                    type="button"
                    className="abyx-btn abyx-btn-primary"
                    onClick={() => handleGenerateMaterial("flashcards")}
                    disabled={genLoading || sources.length === 0}
                  >
                    Generate Flashcards Deck
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB CONTENT: Interactive Quizzes */}
          {activeTab === "quiz" && (
            <div style={{ flex: 1, padding: 24, overflowY: "auto" }}>
              {activeQuiz && Array.isArray(activeQuiz.content?.questions) ? (
                <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h2 style={{ fontSize: "1.2rem", margin: 0 }}>{activeQuiz.title || "Study Quiz"}</h2>
                    {quizSubmitted && quizScore && (
                      <span style={{ fontSize: "1rem", fontWeight: 600, color: "#22c55e" }}>
                        Score: {quizScore.correctCount} / {quizScore.totalCount} ({quizScore.percentage}%)
                      </span>
                    )}
                  </div>

                  {activeQuiz.content.questions.map((q, qIdx) => (
                    <div
                      key={q.id || qIdx}
                      style={{
                        padding: 16,
                        borderRadius: 8,
                        backgroundColor: "var(--md-sys-color-surface-variant, #222)",
                        border: "1px solid var(--border-color, #444)"
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: "0.95rem", marginBottom: 12 }}>
                        {qIdx + 1}. {q.question}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {Array.isArray(q.options) && q.options.map((opt, oIdx) => {
                          const optKey = typeof opt === "string" ? opt.charAt(0) : opt.key;
                          const optText = typeof opt === "string" ? opt : opt.text;
                          const isSelected = quizAnswers[q.id || `q_${qIdx}`] === optKey;
                          const isCorrect = q.correctAnswer === optKey;

                          let bg = "transparent";
                          if (quizSubmitted) {
                            if (isCorrect) bg = "rgba(34, 197, 94, 0.2)";
                            else if (isSelected && !isCorrect) bg = "rgba(239, 68, 68, 0.2)";
                          } else if (isSelected) {
                            bg = "rgba(255, 106, 61, 0.2)";
                          }

                          return (
                            <label
                              key={oIdx}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                padding: "8px 12px",
                                borderRadius: 6,
                                cursor: "pointer",
                                backgroundColor: bg,
                                border: "1px solid var(--border-color, #333)"
                              }}
                            >
                              <input
                                type="radio"
                                name={`q_${q.id || qIdx}`}
                                checked={isSelected}
                                onChange={() => setQuizAnswers(prev => ({ ...prev, [q.id || `q_${qIdx}`]: optKey }))}
                                disabled={quizSubmitted}
                              />
                              <span style={{ fontSize: "0.88rem" }}>{optText}</span>
                            </label>
                          );
                        })}
                      </div>
                      {quizSubmitted && q.explanation && (
                        <div style={{ marginTop: 10, fontSize: "0.8rem", color: "var(--md-sys-color-outline)" }}>
                          <strong>Explanation:</strong> {q.explanation}
                        </div>
                      )}
                    </div>
                  ))}

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                    {!quizSubmitted ? (
                      <button
                        type="button"
                        className="abyx-btn abyx-btn-primary"
                        onClick={async () => {
                          setQuizSubmitted(true);
                          if (activeQuiz?.id) {
                            const res = await recordQuizScore(activeQuiz.id, quizAnswers);
                            if (res?.ok) setQuizScore(res);
                          }
                        }}
                      >
                        Submit Quiz Answers
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="abyx-btn abyx-btn-secondary"
                        onClick={() => {
                          setQuizSubmitted(false);
                          setQuizAnswers({});
                          setQuizScore(null);
                        }}
                      >
                        Retake Quiz
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: "center", color: "var(--md-sys-color-outline)", marginTop: 60 }}>
                  <HelpCircle size={40} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
                  <h3>No Quizzes Available</h3>
                  <p style={{ maxWidth: 400, fontSize: "0.88rem", margin: "0 auto 16px" }}>
                    Click "Gen Quiz" in the top bar to synthesize an interactive multiple choice quiz from your sources.
                  </p>
                  <button
                    type="button"
                    className="abyx-btn abyx-btn-primary"
                    onClick={() => handleGenerateMaterial("quiz")}
                    disabled={genLoading || sources.length === 0}
                  >
                    Generate Quiz
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB CONTENT: Study Guides & Summaries */}
          {activeTab === "guide" && (
            <div style={{ flex: 1, padding: 24, overflowY: "auto" }}>
              {guideMaterials.length > 0 ? (
                <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
                  {guideMaterials.map(g => (
                    <div
                      key={g.id}
                      style={{
                        padding: 20,
                        borderRadius: 8,
                        backgroundColor: "var(--md-sys-color-surface-variant, #222)",
                        border: "1px solid var(--border-color, #444)"
                      }}
                    >
                      <h3 style={{ margin: "0 0 12px", fontSize: "1.15rem" }}>{g.title || "Comprehensive Study Guide"}</h3>
                      <div style={{ whiteSpace: "pre-wrap", fontSize: "0.9rem", lineHeight: 1.6 }}>
                        {typeof g.content === "string" ? g.content : JSON.stringify(g.content, null, 2)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: "center", color: "var(--md-sys-color-outline)", marginTop: 60 }}>
                  <GraduationCap size={40} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
                  <h3>No Study Guides Generated Yet</h3>
                  <button
                    type="button"
                    className="abyx-btn abyx-btn-primary"
                    style={{ marginTop: 16 }}
                    onClick={() => handleGenerateMaterial("guide")}
                    disabled={genLoading || sources.length === 0}
                  >
                    Generate Comprehensive Guide
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal: New Studybook */}
      {createModalOpen && (
        <div className="abyx-modal-backdrop" onClick={() => setCreateModalOpen(false)}>
          <div className="abyx-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h3 style={{ margin: "0 0 16px" }}>Create New Studybook</h3>
            <form onSubmit={handleCreateStudybook} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: 6 }}>Title</label>
                <input
                  type="text"
                  placeholder="e.g. Advanced Neuroscience"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border-color, #444)", backgroundColor: "var(--md-sys-color-background)", color: "inherit" }}
                  required
                />
              </div>
              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: 6 }}>Description</label>
                <input
                  type="text"
                  placeholder="Brief topic summary"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border-color, #444)", backgroundColor: "var(--md-sys-color-background)", color: "inherit" }}
                />
              </div>
              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: 6 }}>Icon / Emoji</label>
                <input
                  type="text"
                  value={newEmoji}
                  onChange={(e) => setNewEmoji(e.target.value)}
                  style={{ width: 60, padding: "8px 12px", textAlign: "center", borderRadius: 6, border: "1px solid var(--border-color, #444)", backgroundColor: "var(--md-sys-color-background)", color: "inherit" }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                <button type="button" className="abyx-btn abyx-btn-secondary" onClick={() => setCreateModalOpen(false)}>Cancel</button>
                <button type="submit" className="abyx-btn abyx-btn-primary" disabled={!newTitle.trim()}>Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Source */}
      {addSourceModalOpen && (
        <div className="abyx-modal-backdrop" onClick={() => setAddSourceModalOpen(false)}>
          <div className="abyx-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <h3 style={{ margin: "0 0 16px" }}>Add Knowledge Source</h3>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <button
                type="button"
                className={`abyx-btn ${sourceType === "text" ? "abyx-btn-primary" : "abyx-btn-secondary"}`}
                style={{ flex: 1, padding: "6px" }}
                onClick={() => setSourceType("text")}
              >
                Notes Text
              </button>
              <button
                type="button"
                className={`abyx-btn ${sourceType === "url" ? "abyx-btn-primary" : "abyx-btn-secondary"}`}
                style={{ flex: 1, padding: "6px" }}
                onClick={() => setSourceType("url")}
              >
                Web URL
              </button>
              <button
                type="button"
                className={`abyx-btn ${sourceType === "file" ? "abyx-btn-primary" : "abyx-btn-secondary"}`}
                style={{ flex: 1, padding: "6px" }}
                onClick={() => setSourceType("file")}
              >
                Local File
              </button>
            </div>

            <form onSubmit={handleAddSource} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: 6 }}>Source Title</label>
                <input
                  type="text"
                  placeholder="e.g. Chapter 4 Cellular Respiration"
                  value={sourceTitle}
                  onChange={(e) => setSourceTitle(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border-color, #444)", backgroundColor: "var(--md-sys-color-background)", color: "inherit" }}
                />
              </div>

              {sourceType === "text" && (
                <div>
                  <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: 6 }}>Lecture Notes / Document Content</label>
                  <textarea
                    rows={6}
                    placeholder="Paste textbook excerpts, lecture transcripts, or study notes..."
                    value={sourceText}
                    onChange={(e) => setSourceText(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border-color, #444)", backgroundColor: "var(--md-sys-color-background)", color: "inherit", resize: "vertical" }}
                    required
                  />
                </div>
              )}

              {sourceType === "url" && (
                <div>
                  <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: 6 }}>Article / Documentation URL</label>
                  <input
                    type="url"
                    placeholder="https://en.wikipedia.org/wiki/Photosynthesis"
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border-color, #444)", backgroundColor: "var(--md-sys-color-background)", color: "inherit" }}
                    required
                  />
                </div>
              )}

              {sourceType === "file" && (
                <div>
                  <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: 6 }}>Local File Path (PDF, DOCX, TXT, MD)</label>
                  <input
                    type="text"
                    placeholder="C:\Users\username\Documents\notes.pdf"
                    value={sourceFilePath}
                    onChange={(e) => setSourceFilePath(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border-color, #444)", backgroundColor: "var(--md-sys-color-background)", color: "inherit" }}
                    required
                  />
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                <button type="button" className="abyx-btn abyx-btn-secondary" onClick={() => setAddSourceModalOpen(false)}>Cancel</button>
                <button type="submit" className="abyx-btn abyx-btn-primary">Add Source</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
