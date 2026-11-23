import React, { useState, useEffect, useCallback } from "react";
import { BarChart3, RefreshCw, AlertTriangle, CheckCircle2, XCircle, ArrowUpRight, ArrowDownLeft, Shield, Sliders, Trash2 } from "lucide-react";
import { getUsageOverview, getUsageDetails, saveUsageBudget, resetUsageTracking, getAnalyticsDashboard } from "../services/api";
import "../styles/abyx.css";

export default function UsageDashboard({ showAlert, showConfirm }) {
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState(null);
  const [details, setDetails] = useState(null);
  const [dashboardStats, setDashboardStats] = useState(null);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [showBudgetForm, setShowBudgetForm] = useState(false);
  const [budgetInput, setBudgetInput] = useState({
    scopeType: "global",
    period: "daily",
    tokenLimit: 50000,
    costLimitUsd: 1.0,
    warningPercent: 80,
  });
  const [savingBudget, setSavingBudget] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, dt, dbStats] = await Promise.all([
        getUsageOverview().catch(() => null),
        getUsageDetails({ provider: selectedProvider || undefined, limit: 50 }).catch(() => null),
        getAnalyticsDashboard().catch(() => null),
      ]);
      setOverview(ov);
      setDetails(dt);
      setDashboardStats(dbStats);
    } catch (err) {
      console.error("Failed to load usage data:", err);
      showAlert?.({ title: "Error", message: "Failed to load usage statistics: " + err.message, danger: true });
    } finally {
      setLoading(false);
    }
  }, [selectedProvider, showAlert]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSaveBudget = async (e) => {
    e.preventDefault();
    setSavingBudget(true);
    try {
      const res = await saveUsageBudget({
        scopeType: budgetInput.scopeType,
        period: budgetInput.period,
        tokenLimit: Number(budgetInput.tokenLimit),
        costLimitUsd: Number(budgetInput.costLimitUsd),
        warningPercent: Number(budgetInput.warningPercent),
      });
      if (res.ok) {
        showAlert?.({ title: "Budget Saved", message: "Usage budget updated successfully." });
        setShowBudgetForm(false);
        await loadData();
      }
    } catch (err) {
      showAlert?.({ title: "Budget Error", message: err.message, danger: true });
    } finally {
      setSavingBudget(false);
    }
  };

  const handleReset = async () => {
    const confirmed = await showConfirm?.({
      title: "Reset Usage Tracking",
      message: "Are you sure you want to reset today's tracked usage counts? Historical audit logs remain preserved in SQLite.",
      confirmLabel: "Reset",
      danger: true,
    });
    if (!confirmed) return;

    try {
      await resetUsageTracking();
      showAlert?.({ title: "Reset Complete", message: "Today's usage counters have been reset." });
      await loadData();
    } catch (err) {
      showAlert?.({ title: "Reset Failed", message: err.message, danger: true });
    }
  };

  const summary = details?.summary || overview?.monitoring?.summary || {
    requests: overview?.totalRequestsToday || 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: overview?.totalTokensToday || 0,
    rate_limit_events: 0,
  };

  const budgets = details?.budgets || [];
  const primaryBudget = budgets[0];

  const totalTokens = summary.total_tokens || overview?.totalTokensToday || 0;
  const tokenLimit = primaryBudget?.token_limit || 0;
  const percentUsed = tokenLimit > 0 ? Math.min(100, Math.round((totalTokens / tokenLimit) * 100)) : 0;
  const isBudgetWarning = percentUsed >= (primaryBudget?.warning_percent || 80);

  const events = details?.events || [];
  const providerRows = overview?.providers ? Object.values(overview.providers) : [];

  return (
    <div className="abyx-page-container">
      <div className="abyx-page-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 className="abyx-page-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <BarChart3 size={24} /> AI Usage & Analytics Dashboard
            </h1>
            <p className="abyx-page-subtitle">
              Comprehensive telemetry, real-time token tracking, rate-limit warnings, provider quota visibility, and budget governance for local and cloud models.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="abyx-btn" onClick={handleReset} title="Reset daily usage counters">
              <Trash2 size={14} /> Reset Today
            </button>
            <button className="abyx-btn" onClick={loadData} disabled={loading}>
              <RefreshCw size={14} className={loading ? "status-pill-spin" : ""} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Overview Stat Cards */}
      <div className="abyx-stats-grid">
        <div className="abyx-stat-card">
          <span className="abyx-stat-label">Total Requests Today</span>
          <span className="abyx-stat-value">{summary.requests || 0}</span>
          <span className="abyx-stat-meta">
            {summary.rate_limit_events > 0 ? (
              <span style={{ color: "var(--md-sys-color-error)", display: "flex", alignItems: "center", gap: 4 }}>
                <AlertTriangle size={12} /> {summary.rate_limit_events} rate limit events
              </span>
            ) : (
              "Normal operations"
            )}
          </span>
        </div>

        <div className="abyx-stat-card">
          <span className="abyx-stat-label">Total Tokens Today</span>
          <span className="abyx-stat-value">{Number(totalTokens).toLocaleString()}</span>
          <span className="abyx-stat-meta">
            In: {Number(summary.input_tokens || 0).toLocaleString()} · Out: {Number(summary.output_tokens || 0).toLocaleString()}
          </span>
        </div>

        <div className="abyx-stat-card">
          <span className="abyx-stat-label">Active Budget Status</span>
          <span className="abyx-stat-value">
            {tokenLimit > 0 ? `${percentUsed}%` : "No Limit"}
          </span>
          <span className="abyx-stat-meta">
            {tokenLimit > 0 ? `${Number(totalTokens).toLocaleString()} / ${Number(tokenLimit).toLocaleString()} tokens` : "Unlimited tracking"}
          </span>
        </div>

        <div className="abyx-stat-card">
          <span className="abyx-stat-label">Active Providers</span>
          <span className="abyx-stat-value">{providerRows.length}</span>
          <span className="abyx-stat-meta">
            {dashboardStats?.activity?.conversations ? `${dashboardStats.activity.conversations} chat sessions recorded` : "Self-hosted & Cloud"}
          </span>
        </div>
      </div>

      {/* Budget Progress & Management */}
      <div className="abyx-section-card">
        <div className="abyx-section-header">
          <h2 className="abyx-section-title">
            <Sliders size={18} /> Usage Budget & Consumption Policy
          </h2>
          <button className="abyx-btn abyx-btn-sm" onClick={() => setShowBudgetForm((v) => !v)}>
            {showBudgetForm ? "Cancel" : primaryBudget ? "Adjust Budget" : "Set New Budget"}
          </button>
        </div>

        {primaryBudget && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: 4 }}>
              <span>
                <strong>{primaryBudget.period.toUpperCase()}</strong> token budget ({primaryBudget.scope_type} scope)
              </span>
              <span>
                {percentUsed}% consumed ({Number(totalTokens).toLocaleString()} / {Number(primaryBudget.token_limit).toLocaleString()})
              </span>
            </div>
            <div className="abyx-progress-bar">
              <div
                className={`abyx-progress-fill ${percentUsed >= 100 ? "danger" : isBudgetWarning ? "warning" : ""}`}
                style={{ width: `${percentUsed}%` }}
              />
            </div>
          </div>
        )}

        {!primaryBudget && !showBudgetForm && (
          <p style={{ fontSize: "0.85rem", color: "var(--md-sys-color-outline)", margin: 0 }}>
            No active budget defined. Click "Set New Budget" to configure daily or monthly token limits with threshold warnings.
          </p>
        )}

        {showBudgetForm && (
          <form onSubmit={handleSaveBudget} style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", marginBottom: 4, color: "var(--md-sys-color-outline)" }}>
                Period
              </label>
              <select
                className="abyx-input"
                value={budgetInput.period}
                onChange={(e) => setBudgetInput((prev) => ({ ...prev, period: e.target.value }))}
              >
                <option value="daily">Daily</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.75rem", marginBottom: 4, color: "var(--md-sys-color-outline)" }}>
                Token Limit
              </label>
              <input
                type="number"
                className="abyx-input"
                value={budgetInput.tokenLimit}
                onChange={(e) => setBudgetInput((prev) => ({ ...prev, tokenLimit: e.target.value }))}
                min="1000"
                step="5000"
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.75rem", marginBottom: 4, color: "var(--md-sys-color-outline)" }}>
                Warning Threshold (%)
              </label>
              <input
                type="number"
                className="abyx-input"
                value={budgetInput.warningPercent}
                onChange={(e) => setBudgetInput((prev) => ({ ...prev, warningPercent: e.target.value }))}
                min="10"
                max="100"
              />
            </div>

            <button type="submit" className="abyx-btn abyx-btn-primary" disabled={savingBudget}>
              Save Budget
            </button>
          </form>
        )}
      </div>

      {/* Provider Quota Breakdown */}
      <div className="abyx-section-card">
        <div className="abyx-section-header">
          <h2 className="abyx-section-title">Provider Quota & Daily Utilization</h2>
        </div>
        {providerRows.length === 0 ? (
          <p style={{ fontSize: "0.85rem", color: "var(--md-sys-color-outline)", margin: 0 }}>
            No provider requests recorded yet today. Start chatting or test a provider connection to view real-time quota telemetry.
          </p>
        ) : (
          <div className="abyx-table-container">
            <table className="abyx-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Requests Today</th>
                  <th>Tokens Today</th>
                  <th>Remaining Quota</th>
                  <th>Utilization</th>
                  <th>Telemetry Source</th>
                </tr>
              </thead>
              <tbody>
                {providerRows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.id.toUpperCase()}</strong>
                    </td>
                    <td>{p.requestsToday || 0}</td>
                    <td>{Number(p.tokensToday || 0).toLocaleString()}</td>
                    <td>{p.remaining || "Unlimited"}</td>
                    <td>
                      {p.percentUsed !== null ? (
                        <span>{p.percentUsed}%</span>
                      ) : (
                        <span style={{ color: "var(--md-sys-color-outline)" }}>—</span>
                      )}
                    </td>
                    <td>
                      <span className="abyx-pill">{p.source}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Usage Events Table */}
      <div className="abyx-section-card">
        <div className="abyx-section-header">
          <h2 className="abyx-section-title">Recent Request Audit Trail</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--md-sys-color-outline)" }}>Filter Provider:</span>
            <select
              className="abyx-input"
              style={{ padding: "4px 8px", fontSize: "0.8rem" }}
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
            >
              <option value="">All Providers</option>
              <option value="groq">Groq</option>
              <option value="gemini">Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="deepseek">DeepSeek</option>
              <option value="openrouter">OpenRouter</option>
              <option value="pollinations">Pollinations</option>
              <option value="local">Local</option>
            </select>
          </div>
        </div>

        {events.length === 0 ? (
          <p style={{ fontSize: "0.85rem", color: "var(--md-sys-color-outline)", margin: 0 }}>
            No recent events match the criteria.
          </p>
        ) : (
          <div className="abyx-table-container">
            <table className="abyx-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Provider</th>
                  <th>Model</th>
                  <th>Prompt Tokens</th>
                  <th>Completion Tokens</th>
                  <th>Total Tokens</th>
                  <th>Latency</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {events.slice(0, 30).map((ev) => (
                  <tr key={ev.id || ev.request_id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {ev.created_at ? new Date(ev.created_at).toLocaleTimeString() : "Just now"}
                    </td>
                    <td>
                      <span className="abyx-pill">{ev.provider_id}</span>
                    </td>
                    <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ev.model}
                    </td>
                    <td>{ev.input_tokens || 0}</td>
                    <td>{ev.output_tokens || 0}</td>
                    <td>
                      <strong>{(ev.input_tokens || 0) + (ev.output_tokens || 0)}</strong>
                    </td>
                    <td>{ev.duration_ms ? `${ev.duration_ms}ms` : "—"}</td>
                    <td>
                      {ev.status === "success" ? (
                        <span style={{ color: "var(--md-sys-color-success)", display: "flex", alignItems: "center", gap: 4 }}>
                          <CheckCircle2 size={13} /> OK
                        </span>
                      ) : (
                        <span style={{ color: "var(--md-sys-color-error)", display: "flex", alignItems: "center", gap: 4 }}>
                          <XCircle size={13} /> {ev.error_code || "FAIL"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
