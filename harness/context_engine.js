/**
 * Progressive Context Assembly, Output Paginator, and Token Compaction.
 */

class ProgressiveContextAssembler {
  constructor() {
    this.tiers = new Map();
    this.conversationTurns = [];
  }

  setTier(name, content, priority = 5) {
    this.tiers.set(name, { name, content, priority });
  }

  setSystemInstruction(content) {
    this.setTier('system', content, 1);
  }

  setTaskContext(content) {
    this.setTier('task', content, 2);
  }

  setRepositoryContext(content) {
    const text = typeof content === 'object' ? JSON.stringify(content, null, 2) : String(content);
    this.setTier('repo', text, 3);
  }

  addTurn(role, content) {
    this.conversationTurns.push({ role, content });
    const convoText = this.conversationTurns.map(t => `[${t.role.toUpperCase()}]: ${t.content}`).join('\n');
    this.setTier('conversation', convoText, 4);
  }

  estimateTokens() {
    return Math.max(1, Math.floor(this.assemble().length / 4));
  }

  assemble() {
    const sorted = Array.from(this.tiers.values()).sort((a, b) => a.priority - b.priority);
    return sorted
      .filter(t => t.content && t.content.trim().length > 0)
      .map(t => `<!-- Tier: ${t.name} (Priority ${t.priority}) -->\n${t.content}`)
      .join('\n\n');
  }
}

class OutputPaginator {
  constructor(maxBytes = 40960, maxLines = 500, headLines = 50, tailLines = 50) {
    this.maxBytes = maxBytes;
    this.maxLines = maxLines;
    this.headLines = headLines;
    this.tailLines = tailLines;
  }

  smartTruncate(content) {
    const res = this.truncateSmart(content);
    return {
      output: res.content,
      truncated: res.truncated
    };
  }

  paginateOutput(content, startLine = 1, pageSize = 200) {
    const lines = content.split('\n');
    const totalLines = lines.length;
    const startIdx = Math.max(0, startLine - 1);
    const endIdx = Math.min(totalLines, startIdx + pageSize);

    const pageSlice = lines.slice(startIdx, endIdx);
    const hasMore = endIdx < totalLines;

    return {
      totalLines,
      startLine: startIdx + 1,
      endLine: endIdx,
      hasMore,
      nextStartLine: hasMore ? endIdx + 1 : null,
      content: pageSlice.join('\n')
    };
  }

  truncateSmart(content) {
    if (typeof content !== 'string') return { content: String(content), truncated: false };
    const lines = content.split('\n');
    if (lines.length <= this.maxLines && Buffer.byteLength(content, 'utf-8') <= this.maxBytes) {
      return { content, truncated: false };
    }

    const head = lines.slice(0, this.headLines);
    const tail = this.tailLines > 0 ? lines.slice(-this.tailLines) : [];
    const omitted = lines.length - (head.length + tail.length);

    const truncated = [
      ...head,
      `\n... [TRUNCATED ${omitted} lines (${Buffer.byteLength(content, 'utf-8')} bytes total) to protect context window] ...\n`,
      ...tail
    ].join('\n');

    return { content: truncated, truncated: true };
  }
}

class CompactionEngine {
  constructor(maxTokens = 128000, triggerPct = 75.0, keepFirst = 2, keepRecent = 8) {
    this.maxTokens = maxTokens;
    this.triggerPct = triggerPct;
    this.keepFirst = keepFirst;
    this.keepRecent = keepRecent;
  }

  estimateTokens(text) {
    return Math.max(1, Math.floor((text || '').length / 4));
  }

  shouldCompact(currentTokens) {
    const util = (currentTokens / this.maxTokens) * 100.0;
    return util >= this.triggerPct;
  }

  compactEvents(events) {
    if (events.length <= (this.keepFirst + this.keepRecent)) {
      return { compactedEvents: events, summaryEvent: null };
    }

    const firstSlice = events.slice(0, this.keepFirst);
    const middleSlice = events.slice(this.keepFirst, -this.keepRecent);
    const recentSlice = events.slice(-this.keepRecent);

    const summaryEvent = {
      eventId: `evt_cond_${Date.now()}`,
      timestamp: new Date().toISOString(),
      kind: 'Condensation',
      payload: {
        omittedEvents: middleSlice.length,
        summary: `Compacted ${middleSlice.length} intermediate events.`
      }
    };

    return {
      compactedEvents: [...firstSlice, summaryEvent, ...recentSlice],
      summaryEvent
    };
  }

  compactTurns(turns) {
    if (turns.length <= 3) return turns;
    const first = turns.slice(0, 1);
    const recent = turns.slice(-2);
    return [
      ...first,
      { role: 'system', content: `[Compacted ${turns.length - 3} previous turns]` },
      ...recent
    ];
  }
}

module.exports = {
  ProgressiveContextAssembler,
  OutputPaginator,
  CompactionEngine
};
