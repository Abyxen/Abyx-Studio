/**
 * Project ABYX — Phase 14: AbyxStudy / NotebookLM Experience
 * Comprehensive Study Service: Multi-Studybook Workspace, Multi-Format Source Ingestion,
 * Grounded RAG Q&A with Citations, AI Flashcards, Quizzes, Practice Exams,
 * Audio Overviews (Podcasts), Study Guides, and Progress Mastery Tracking.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('../db');
const { dataDir } = require('../data_paths');
const DocumentParser = require('../rag/document_parser');
const aiProviders = require('./ai_providers');
const { fetchPublicResponse } = require('../security/public_fetch');

class StudyService {
  constructor(knowledgeService, options = {}) {
    this.knowledgeService = knowledgeService;
    this.dataDir = dataDir;
    this.sourcesDir = path.join(this.dataDir, 'study_sources');
    if (!fs.existsSync(this.sourcesDir)) {
      fs.mkdirSync(this.sourcesDir, { recursive: true });
    }
  }

  _getProfileSourcesDir(profileId = 'prof_default') {
    const dir = path.join(this.sourcesDir, profileId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  // ==========================================
  // 1. STUDYBOOK WORKSPACE MANAGEMENT
  // ==========================================

  createStudybook(profileId = 'prof_default', data = {}) {
    return db.createStudybook({
      profileId,
      title: data.title || 'Untitled Studybook',
      description: data.description || '',
      emoji: data.emoji || '',
      metadata: data.metadata || {}
    });
  }

  getStudybook(studybookId, profileId = 'prof_default') {
    return db.getStudybook(studybookId, profileId);
  }

  listStudybooks(profileId = 'prof_default') {
    return db.listStudybooks(profileId);
  }

  updateStudybook(studybookId, profileId = 'prof_default', updates = {}) {
    return db.updateStudybook(studybookId, profileId, updates);
  }

  deleteStudybook(studybookId, profileId = 'prof_default') {
    return db.deleteStudybook(studybookId, profileId);
  }

  // ==========================================
  // 2. MULTI-FORMAT SOURCE INGESTION
  // ==========================================

  /**
   * Add a local file (PDF, DOCX, TXT, MD, etc.) to a studybook
   */
  async addSourceFile(studybookId, filePath, profileId = 'prof_default', options = {}) {
    const studybook = db.getStudybook(studybookId, profileId);
    if (!studybook) {
      throw new Error(`Studybook "${studybookId}" not found for this profile.`);
    }

    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`File does not exist: ${resolved}`);
    }

    // Ingest into unified Knowledge Base
    const result = await this.knowledgeService.importFile(resolved, {
      profileId,
      category: options.category || 'studybook_source',
      tags: [studybook.title, 'studybook']
    });

    const sourceId = result.sourceId;
    if (!sourceId || !['success', 'duplicate'].includes(result.status)) {
      throw new Error(result.message || 'Failed to ingest document');
    }

    // Link source to studybook
    db.addSourceToStudybook(studybookId, sourceId, profileId);

    return {
      ok: true,
      sourceId,
      name: result.name,
      chunkCount: result.chunkCount,
      totalChars: result.totalChars,
      status: result.status
    };
  }

  /**
   * Add a Web URL (article, blog, documentation) to a studybook
   */
  async addSourceUrl(studybookId, urlString, profileId = 'prof_default', options = {}) {
    const studybook = db.getStudybook(studybookId, profileId);
    if (!studybook) {
      throw new Error(`Studybook "${studybookId}" not found for this profile.`);
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(urlString);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Only HTTP and HTTPS URLs are supported.');
      }
    } catch (e) {
      throw new Error(`Invalid URL: ${urlString}`);
    }

    // Fetch URL with browser headers and timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    let html = '';
    try {
      const resp = await fetchPublicResponse(urlString, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 AbyxStudy/1.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeoutMs: 12000,
        maxBytes: 12 * 1024 * 1024
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        throw new Error(`Failed to fetch URL: HTTP ${resp.status} ${resp.statusText}`);
      }
      html = await resp.text();
    } catch (fetchErr) {
      clearTimeout(timeout);
      throw new Error(`Network error fetching URL: ${fetchErr.message}`);
    }

    // Extract title & transform HTML to readable markdown
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const pageTitle = (titleMatch ? titleMatch[1] : parsedUrl.hostname).trim().replace(/[\r\n\t]+/g, ' ');

    const cleanMarkdown = this._htmlToMarkdown(html, pageTitle, urlString);

    // Save to local sources directory
    const hash = crypto.createHash('md5').update(urlString).digest('hex').slice(0, 10);
    const sanitizedTitle = (options.title || pageTitle).replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40);
    const fileName = `${sanitizedTitle}_${hash}.md`;
    const targetPath = path.join(this._getProfileSourcesDir(profileId), fileName);

    fs.writeFileSync(targetPath, cleanMarkdown, 'utf8');

    // Ingest into unified Knowledge Base
    const result = await this.knowledgeService.importFile(targetPath, {
      profileId,
      category: 'web_article',
      tags: [studybook.title, parsedUrl.hostname]
    });

    const sourceId = result.sourceId;
    if (!sourceId || !['success', 'duplicate'].includes(result.status)) {
      throw new Error(result.message || 'Failed to index web source');
    }

    db.addSourceToStudybook(studybookId, sourceId, profileId);

    return {
      ok: true,
      sourceId,
      name: fileName,
      title: pageTitle,
      url: urlString,
      chunkCount: result.chunkCount,
      totalChars: cleanMarkdown.length
    };
  }

  /**
   * Add pasted text / manual notes to a studybook
   */
  async addSourceText(studybookId, text, title = 'Lecture Notes', profileId = 'prof_default', options = {}) {
    const studybook = db.getStudybook(studybookId, profileId);
    if (!studybook) {
      throw new Error(`Studybook "${studybookId}" not found for this profile.`);
    }

    if (!text || !text.trim()) {
      throw new Error('Content text cannot be empty.');
    }

    const cleanTitle = (title || 'Lecture Notes').trim();
    const sanitizedTitle = cleanTitle.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40);
    const timestamp = Date.now();
    const fileName = `${sanitizedTitle}_${timestamp}.md`;
    const targetPath = path.join(this._getProfileSourcesDir(profileId), fileName);

    const docContent = `# ${cleanTitle}\n\n*Created on ${new Date().toLocaleString()}*\n\n---\n\n${text.trim()}\n`;
    fs.writeFileSync(targetPath, docContent, 'utf8');

    // Ingest into unified Knowledge Base
    const result = await this.knowledgeService.importFile(targetPath, {
      profileId,
      category: 'pasted_notes',
      tags: [studybook.title, 'notes']
    });

    const sourceId = result.sourceId;
    if (!sourceId || !['success', 'duplicate'].includes(result.status)) {
      throw new Error(result.message || 'Failed to index notes');
    }

    db.addSourceToStudybook(studybookId, sourceId, profileId);

    return {
      ok: true,
      sourceId,
      name: fileName,
      title: cleanTitle,
      chunkCount: result.chunkCount,
      totalChars: docContent.length
    };
  }

  /**
   * Remove a source from a studybook (unlinks it, retains KB source)
   */
  removeSource(studybookId, sourceId, profileId = 'prof_default') {
    return db.removeSourceFromStudybook(studybookId, sourceId, profileId);
  }

  /**
   * List all sources linked to a studybook
   */
  listSources(studybookId, profileId = 'prof_default') {
    return db.listStudybookSources(studybookId, profileId);
  }

  // ==========================================
  // 3. GROUNDED CHAT & CITATIONS ENGINE
  // ==========================================

  /**
   * Ask questions strictly scoped to the studybook's sources with verified citations
   */
  async chat(studybookId, question, profileId = 'prof_default', options = {}) {
    if (typeof question !== 'string' || !question.trim()) {
      throw new Error('A study question is required.');
    }
    const studybook = db.getStudybook(studybookId, profileId);
    if (!studybook) {
      throw new Error(`Studybook "${studybookId}" not found.`);
    }

    const linkedSources = db.listStudybookSources(studybookId, profileId);
    if (linkedSources.length === 0) {
      return {
        ok: true,
        answer: "This studybook doesn't have any sources attached yet. Please upload a PDF, Word document, website URL, or paste study notes in the left panel to begin asking questions.",
        citations: [],
        sourcesCount: 0
      };
    }

    const sourceIds = linkedSources.map(s => s.id);

    // Retrieve scoped chunks via hybrid BM25 + Vector
    const searchRes = await this.knowledgeService.query(question, {
      profileId,
      sourceIds,
      topK: options.topK || 6,
      alpha: 0.5
    });

    if (!searchRes.results || searchRes.results.length === 0) {
      const answer = 'I could not find relevant evidence for that question in this studybook’s sources. Try rephrasing the question or adding a source that covers the topic.';
      db.addStudybookMessage(studybookId, profileId, 'user', question, []);
      db.addStudybookMessage(studybookId, profileId, 'assistant', answer, []);
      return { ok: true, answer, citations: [], sourcesCount: linkedSources.length, retrievedChunks: 0 };
    }

    const citations = (searchRes.results || []).map((r, idx) => ({
      index: idx + 1,
      sourceId: r.sourceId,
      sourceName: r.sourceName,
      sectionTitle: r.sectionTitle,
      pageNumber: r.pageNumber,
      score: r.score,
      excerpt: r.content.slice(0, 300)
    }));

    const citationContext = this.knowledgeService.formatCitationContext(searchRes);

    // Fetch recent studybook conversation history
    const history = db.listStudybookMessages(studybookId, profileId, 10);
    const messages = [
      {
        role: 'system',
        content: [
          `You are AbyxStudy, an elite AI tutor, academic researcher, and study partner for the studybook: "${studybook.title}".`,
          'STRICT INSTRUCTIONS:',
          '1. Answer the user question accurately, clearly, and thoroughly based ONLY on the verified sources provided below.',
          '2. GROUNDING & CITATIONS: Cite key claims using the exact [Source N: ...] bracket tags shown in the excerpts. Never create a source name, section, page, or citation tag that is not present there.',
          '3. If a fact cannot be supported or answered by the provided documents, explicitly and politely state that the current sources do not contain that information.',
          '4. Formatting: Use structured markdown, clean bullet points, bold concept headers, and clear formulas/equations.',
          '5. Strictly NO decorative emojis. Maintain a clean, professional, academic tone.',
          '',
          citationContext
        ].join('\n')
      }
    ];

    for (const msg of history) {
      messages.push({ role: msg.role, content: msg.content });
    }

    messages.push({ role: 'user', content: question });

    // Call LLM
    let answer = await this._callLlm({
      messages,
      model: options.model || 'auto',
      profileId,
      fallbackGenerator: () => this._generateFallbackAnswer(question, searchRes.results)
    });

    const verifiedCitationTags = new Set((searchRes.results || []).map((result, index) => {
      const section = result.sectionTitle ? `, Section: "${result.sectionTitle}"` : '';
      const page = result.pageNumber ? `, Page ${result.pageNumber}` : '';
      return `[Source ${index + 1}: ${result.sourceName}${section}${page}]`;
    }));
    const answerCitationTags = answer.match(/\[Source[^\]]*\]/gi) || [];
    if (answerCitationTags.length === 0 || answerCitationTags.some(tag => !verifiedCitationTags.has(tag))) {
      answer = this._generateFallbackAnswer(question, searchRes.results);
    }

    // Save user & assistant messages
    db.addStudybookMessage(studybookId, profileId, 'user', question, []);
    db.addStudybookMessage(studybookId, profileId, 'assistant', answer, citations);

    return {
      ok: true,
      answer,
      citations,
      sourcesCount: linkedSources.length,
      retrievedChunks: searchRes.results.length
    };
  }

  listMessages(studybookId, profileId = 'prof_default') {
    return db.listStudybookMessages(studybookId, profileId, 100);
  }

  clearMessages(studybookId, profileId = 'prof_default') {
    return db.clearStudybookMessages(studybookId, profileId);
  }

  // ==========================================
  // 4. AI STUDY MATERIALS GENERATION
  // ==========================================

  /**
   * Generate study materials: 'guide', 'flashcards', 'quiz', 'exam', 'podcast', 'summary'
   */
  async generateMaterial(studybookId, type, profileId = 'prof_default', options = {}) {
    const studybook = db.getStudybook(studybookId, profileId);
    if (!studybook) {
      throw new Error(`Studybook "${studybookId}" not found.`);
    }

    const linkedSources = db.listStudybookSources(studybookId, profileId);
    if (linkedSources.length === 0) {
      throw new Error('Please add at least one source document to this studybook before generating materials.');
    }

    // Gather text from linked sources chunks
    const allChunks = [];
    for (const src of linkedSources) {
      const srcData = this.knowledgeService.getSource(src.id, profileId);
      if (srcData && srcData.chunks) {
        for (const c of srcData.chunks) {
          allChunks.push({
            sourceName: src.name,
            sectionTitle: c.sectionTitle,
            pageNumber: c.pageNumber,
            content: c.content
          });
        }
      }
    }

    if (allChunks.length === 0) {
      throw new Error('The attached sources contain no text to generate study materials from.');
    }

    // Limit chunk excerpt size to fit context window safely
    const contextText = allChunks.slice(0, 30).map((c, i) => 
      `--- [Doc ${i + 1}: ${c.sourceName}${c.sectionTitle ? ' | ' + c.sectionTitle : ''}${c.pageNumber ? ' | P.' + c.pageNumber : ''}] ---\n${c.content}`
    ).join('\n\n');

    switch (type) {
      case 'flashcards':
        return await this._generateFlashcardsMaterial(studybook, contextText, profileId, options);
      case 'quiz':
        return await this._generateQuizMaterial(studybook, contextText, profileId, options);
      case 'exam':
        return await this._generatePracticeExamMaterial(studybook, contextText, profileId, options);
      case 'guide':
        return await this._generateStudyGuideMaterial(studybook, contextText, profileId, options);
      case 'podcast':
        return await this._generateAudioOverviewMaterial(studybook, contextText, profileId, options);
      case 'summary':
      default:
        return await this._generateSummaryMaterial(studybook, contextText, profileId, options);
    }
  }

  async _generateFlashcardsMaterial(studybook, contextText, profileId, options) {
    const prompt = [
      'Generate a deck of 12 high-yield, comprehensive flashcards for active recall study based on the following source material.',
      'Output MUST be a valid JSON array of objects with NO markdown fences, NO preamble, and NO extra text.',
      'Each object must adhere strictly to this schema:',
      '[',
      '  {',
      '    "id": "fc_1",',
      '    "front": "Front question or prompt testing a specific concept, formula, or term",',
      '    "back": "Clear, precise, and authoritative answer",',
      '    "hint": "Brief memory trigger hint",',
      '    "source": "Document or section title reference",',
      '    "mastered": false',
      '  }',
      ']',
      'Use only facts stated in the excerpts. Do not add outside facts. Set each source field to the exact Doc label shown in the source block.',
      '',
      'SOURCE MATERIAL:',
      contextText
    ].join('\n');

    const raw = await this._callLlm({
      messages: [{ role: 'user', content: prompt }],
      model: options.model || 'auto',
      profileId,
      temperature: 0.2,
      fallbackGenerator: () => this._fallbackFlashcards(contextText)
    });

    let cards = [];
    try {
      cards = this._extractJsonArray(raw);
    } catch (e) {
      cards = this._fallbackFlashcards(contextText);
    }

    if (!Array.isArray(cards) || cards.length === 0) {
      cards = this._fallbackFlashcards(contextText);
    }

    cards = cards.filter(card => card && typeof (card.front || card.question) === 'string'
      && (card.front || card.question).trim() && typeof (card.back || card.answer) === 'string'
      && (card.back || card.answer).trim());
    if (cards.length === 0) cards = this._fallbackFlashcards(contextText);

    // Ensure valid structure
    cards = cards.map((c, idx) => ({
      id: c.id || `fc_${idx + 1}`,
      front: (c.front || c.question).trim(),
      back: (c.back || c.answer).trim(),
      hint: c.hint || '',
      source: c.source || studybook.title,
      mastered: false
    }));

    const title = options.title || `${studybook.title} Flashcard Deck (${cards.length} cards)`;
    return db.createStudyMaterial({
      studybookId: studybook.id,
      profileId,
      type: 'flashcards',
      title,
      content: cards,
      score: 0,
      totalItems: cards.length,
      metadata: { generatedAt: new Date().toISOString(), model: options.model || 'auto' }
    });
  }

  async _generateQuizMaterial(studybook, contextText, profileId, options) {
    const prompt = [
      'Generate a rigorous 8-question practice quiz based on the following source material.',
      'Include 6 multiple-choice questions (4 options each) and 2 concept-check short answer questions.',
      'Output MUST be a valid JSON array of objects with NO markdown fences, NO preamble, and NO extra text.',
      'Each object must adhere strictly to this schema:',
      '[',
      '  {',
      '    "id": "q_1",',
      '    "type": "multiple_choice",',
      '    "question": "Question text testing core comprehension",',
      '    "options": ["Option A", "Option B", "Option C", "Option D"],',
      '    "answer": "Option A",',
      '    "explanation": "Detailed explanation of why this is correct and why other options are incorrect",',
      '    "citation": "Document / Section Reference"',
      '  }',
      ']',
      'Use only facts stated in the excerpts. Do not invent answer options or citations. Cite the exact Doc label shown in the source block.',
      '',
      'SOURCE MATERIAL:',
      contextText
    ].join('\n');

    const raw = await this._callLlm({
      messages: [{ role: 'user', content: prompt }],
      model: options.model || 'auto',
      profileId,
      temperature: 0.2,
      fallbackGenerator: () => this._fallbackQuiz(contextText)
    });

    let questions = [];
    try {
      questions = this._extractJsonArray(raw);
    } catch (e) {
      questions = this._fallbackQuiz(contextText);
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      questions = this._fallbackQuiz(contextText);
    }

    questions = questions.filter(question => question && typeof question.question === 'string'
      && question.question.trim() && typeof question.answer === 'string' && question.answer.trim());
    if (questions.length === 0) questions = this._fallbackQuiz(contextText);

    questions = questions.map((q, idx) => ({
      id: q.id || `q_${idx + 1}`,
      type: q.type || 'multiple_choice',
      question: q.question.trim(),
      options: Array.isArray(q.options) && q.options.length >= 2 ? q.options : [q.answer, 'This detail is not stated in the provided source.'],
      answer: q.answer.trim(),
      explanation: q.explanation || 'Refer to the source document for detailed context.',
      citation: q.citation || studybook.title
    }));

    const title = options.title || `${studybook.title} Practice Quiz (${questions.length} questions)`;
    return db.createStudyMaterial({
      studybookId: studybook.id,
      profileId,
      type: 'quiz',
      title,
      content: questions,
      score: null,
      totalItems: questions.length,
      metadata: { generatedAt: new Date().toISOString(), model: options.model || 'auto', attempts: 0 }
    });
  }

  async _generatePracticeExamMaterial(studybook, contextText, profileId, options) {
    const prompt = [
      `You are an academic examination designer. Create a comprehensive, formal Practice Exam for "${studybook.title}" based on the verified source material below.`,
      '',
      'Format the exam with clear Markdown sections:',
      '# PRACTICE EXAMINATION: ' + studybook.title,
      '**Time Allowed:** 45 Minutes | **Total Points:** 100 Points',
      '',
      '## SECTION 1: Foundational Comprehension (30 Points)',
      '(5 Multiple-Choice Questions with 4 options each, clearly numbered 1 to 5)',
      '',
      '## SECTION 2: Applied Analysis & Problem Solving (40 Points)',
      '(3 Scenario-based structured questions requiring multi-step reasoning)',
      '',
      '## SECTION 3: Synthesis & Deep-Dive Essay (30 Points)',
      '(2 In-depth essay/proof prompts evaluating mastery)',
      '',
      '---',
      '## OFFICIAL SCORING GUIDE & ANSWER KEY',
      '(Complete answers, grading rubrics, and source citations for all sections)',
      'Ground every question and answer only in the excerpts. Cite the exact Doc label. If the sources do not support a detail, omit it.',
      '',
      'SOURCE MATERIAL:',
      contextText
    ].join('\n');

    const content = await this._callLlm({
      messages: [{ role: 'user', content: prompt }],
      model: options.model || 'auto',
      profileId,
      temperature: 0.3,
      fallbackGenerator: () => this._fallbackPracticeExam(studybook.title, contextText)
    });

    const title = options.title || `${studybook.title} Comprehensive Practice Exam`;
    return db.createStudyMaterial({
      studybookId: studybook.id,
      profileId,
      type: 'exam',
      title,
      content,
      score: null,
      totalItems: 10,
      metadata: { timeLimitMinutes: 45, generatedAt: new Date().toISOString() }
    });
  }

  async _generateStudyGuideMaterial(studybook, contextText, profileId, options) {
    const prompt = [
      `You are an elite academic tutor. Create a comprehensive, well-structured Study Guide and Revision Manual for "${studybook.title}" based on the verified sources below.`,
      '',
      'Structure the guide cleanly in Markdown:',
      `# ${studybook.title}: Master Study Guide`,
      '',
      '## 1. Executive Summary & Core Thesis',
      'High-level synthesis of what this subject covers and why it matters.',
      '',
      '## 2. Key Concepts & Fundamental Principles',
      'Bulleted deep dives into each core concept with citations.',
      '',
      '## 3. Essential Terminology & Definitions Glossary',
      'Clean Markdown table or definition list of key terms.',
      '',
      '## 4. Deep-Dive Section Analysis & Methodologies',
      'Step-by-step walkthroughs of processes, formulas, workflows, or historical developments.',
      '',
      '## 5. High-Yield Review Takeaways & Common Pitfalls',
      'What students typically get wrong, memory anchors, and checklist for revision.',
      'Ground every factual statement only in the excerpts. Cite the exact Doc label. Do not add outside facts or unsupported pitfalls.',
      '',
      'SOURCE MATERIAL:',
      contextText
    ].join('\n');

    const content = await this._callLlm({
      messages: [{ role: 'user', content: prompt }],
      model: options.model || 'auto',
      profileId,
      temperature: 0.3,
      fallbackGenerator: () => this._fallbackStudyGuide(studybook.title, contextText)
    });

    const title = options.title || `${studybook.title} Master Study Guide`;
    return db.createStudyMaterial({
      studybookId: studybook.id,
      profileId,
      type: 'guide',
      title,
      content,
      score: null,
      totalItems: 5,
      metadata: { generatedAt: new Date().toISOString() }
    });
  }

  async _generateAudioOverviewMaterial(studybook, contextText, profileId, options) {
    const prompt = [
      `You are the creator of NotebookLM's Audio Overview experience.`,
      `Generate a lively, deeply insightful, two-host podcast conversation ("Audio Overview") dissecting the materials in "${studybook.title}".`,
      '',
      'HOSTS:',
      '- Alex: Inquisitive, analytical, asks the sharp questions, frames the big picture.',
      '- Sam: Synthesizes complex ideas, uses relatable metaphors, highlights the surprising nuances.',
      '',
      'GUIDELINES:',
      '- Make the dialogue feel natural, engaging, and spontaneous, like two sharp researchers unpacking exciting discoveries.',
      '- Format each line as: "Alex: ..." or "Sam: ...".',
      '- Include deep technical details grounded strictly in the source text.',
      '- Cite the exact Doc label for every factual claim. Do not add outside facts or invented source details.',
      '- Avoid emojis.',
      '',
      'SOURCE MATERIAL:',
      contextText
    ].join('\n');

    const content = await this._callLlm({
      messages: [{ role: 'user', content: prompt }],
      model: options.model || 'auto',
      profileId,
      temperature: 0.4,
      fallbackGenerator: () => this._fallbackPodcast(studybook.title, contextText)
    });

    const title = options.title || `${studybook.title} Audio Overview Podcast Dialogue`;
    return db.createStudyMaterial({
      studybookId: studybook.id,
      profileId,
      type: 'podcast',
      title,
      content,
      score: null,
      totalItems: 2,
      metadata: { hosts: ['Alex', 'Sam'], generatedAt: new Date().toISOString() }
    });
  }

  async _generateSummaryMaterial(studybook, contextText, profileId, options) {
    const prompt = [
      `Create an Executive Briefing Summary for "${studybook.title}" based on the verified source material.`,
      'Include: Key Findings, Critical Data Points, Core Arguments, and Actionable Conclusions.',
      'Ground every factual statement only in the excerpts and cite the exact Doc label. Do not infer unsupported conclusions.',
      'Zero emojis. Clean Markdown.',
      '',
      'SOURCE MATERIAL:',
      contextText
    ].join('\n');

    const content = await this._callLlm({
      messages: [{ role: 'user', content: prompt }],
      model: options.model || 'auto',
      profileId,
      temperature: 0.3,
      fallbackGenerator: () => `# ${studybook.title}: Executive Summary\n\n${contextText.slice(0, 1500)}`
    });

    const title = options.title || `${studybook.title} Executive Summary`;
    return db.createStudyMaterial({
      studybookId: studybook.id,
      profileId,
      type: 'summary',
      title,
      content,
      score: null,
      totalItems: 1,
      metadata: { generatedAt: new Date().toISOString() }
    });
  }

  // ==========================================
  // 5. PROGRESS & INTERACTION TRACKING
  // ==========================================

  /**
   * Submit quiz answers, evaluate score, and record progress
   */
  recordQuizScore(materialId, userAnswers = {}, profileId = 'prof_default') {
    const material = db.getStudyMaterial(materialId, profileId);
    if (!material || material.type !== 'quiz') {
      throw new Error('Valid quiz material not found');
    }

    const questions = material.content || [];
    let correctCount = 0;
    const gradedResults = [];

    questions.forEach((q, idx) => {
      const userSelected = userAnswers[q.id] || userAnswers[idx];
      const isCorrect = userSelected !== undefined && String(userSelected).trim().toLowerCase() === String(q.answer).trim().toLowerCase();
      if (isCorrect) correctCount++;

      gradedResults.push({
        id: q.id,
        question: q.question,
        userSelected: userSelected || null,
        correctAnswer: q.answer,
        isCorrect,
        explanation: q.explanation,
        citation: q.citation
      });
    });

    const percentage = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0;
    const attempts = (material.metadata?.attempts || 0) + 1;

    const updated = db.updateStudyMaterial(materialId, profileId, {
      score: percentage,
      metadata: {
        ...material.metadata,
        attempts,
        lastAttemptAt: new Date().toISOString(),
        lastScorePercentage: percentage,
        lastCorrectCount: correctCount,
        gradedResults
      }
    });

    return {
      ok: true,
      percentage,
      correctCount,
      totalQuestions: questions.length,
      gradedResults,
      attempts
    };
  }

  /**
   * Update flashcard mastery states
   */
  recordFlashcardMastery(materialId, masteredCardIds = [], profileId = 'prof_default') {
    const material = db.getStudyMaterial(materialId, profileId);
    if (!material || material.type !== 'flashcards') {
      throw new Error('Valid flashcard material not found');
    }

    const cards = Array.isArray(material.content) ? material.content : [];
    const masteredSet = new Set(masteredCardIds);

    let masteredCount = 0;
    const updatedCards = cards.map(c => {
      const isMastered = masteredSet.has(c.id);
      if (isMastered) masteredCount++;
      return { ...c, mastered: isMastered };
    });

    const updated = db.updateStudyMaterial(materialId, profileId, {
      content: updatedCards,
      score: masteredCount,
      metadata: {
        ...material.metadata,
        lastMasteryUpdate: new Date().toISOString(),
        masteredCount,
        totalCards: cards.length
      }
    });

    return {
      ok: true,
      masteredCount,
      totalCards: cards.length,
      percentage: cards.length > 0 ? Math.round((masteredCount / cards.length) * 100) : 0,
      material: updated
    };
  }

  listMaterials(studybookId, profileId = 'prof_default', type = null) {
    return db.listStudyMaterials(studybookId, profileId, type);
  }

  getMaterial(materialId, profileId = 'prof_default') {
    return db.getStudyMaterial(materialId, profileId);
  }

  updateMaterial(materialId, profileId = 'prof_default', updates = {}) {
    return db.updateStudyMaterial(materialId, profileId, updates);
  }

  deleteMaterial(materialId, profileId = 'prof_default') {
    return db.deleteStudyMaterial(materialId, profileId);
  }

  /**
   * Get overarching progress statistics for a studybook
   */
  getStudybookProgress(studybookId, profileId = 'prof_default') {
    const materials = db.listStudyMaterials(studybookId, profileId);
    const sources = db.listStudybookSources(studybookId, profileId);

    const quizzes = materials.filter(m => m.type === 'quiz');
    const flashcards = materials.filter(m => m.type === 'flashcards');
    const guides = materials.filter(m => ['guide', 'exam', 'summary', 'podcast'].includes(m.type));

    let totalFlashcards = 0;
    let masteredFlashcards = 0;
    flashcards.forEach(f => {
      totalFlashcards += (f.total_items || 0);
      masteredFlashcards += (f.score || 0);
    });

    let totalQuizScore = 0;
    let quizAttempts = 0;
    quizzes.forEach(q => {
      if (q.score !== null && q.score !== undefined) {
        totalQuizScore += q.score;
        quizAttempts++;
      }
    });

    return {
      totalSources: sources.length,
      totalMaterials: materials.length,
      flashcardStats: {
        total: totalFlashcards,
        mastered: masteredFlashcards,
        percentage: totalFlashcards > 0 ? Math.round((masteredFlashcards / totalFlashcards) * 100) : 0
      },
      quizStats: {
        count: quizzes.length,
        attempts: quizAttempts,
        averageScore: quizAttempts > 0 ? Math.round(totalQuizScore / quizAttempts) : null
      },
      guidesCount: guides.length
    };
  }

  // ==========================================
  // 6. INTERNAL LLM CALLING & FALLBACK HELPERS
  // ==========================================

  async _callLlm({ messages, model = 'auto', profileId = 'prof_default', temperature = 0.3, fallbackGenerator = null }) {
    let output = '';
    let targetModel = model || 'auto';
    if (targetModel === 'auto') {
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      const route = aiProviders.selectBestModelForTask(lastUser?.content || 'Study question', { isRag: true, profileId });
      if (!route.selectedModel) {
        if (fallbackGenerator) return fallbackGenerator();
        throw new Error('No verified provider model is available for study generation.');
      }
      targetModel = route.selectedModel;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      await aiProviders.streamProviderChat({
        model: targetModel,
        messages,
        temperature,
        max_tokens: 4096,
        profileId,
        signal: controller.signal,
        onChunk: (chunk) => {
          output += chunk;
        }
      });
      clearTimeout(timeoutId);
      if (output && output.trim().length > 10) {
        return output.trim();
      }
    } catch (llmErr) {
      console.warn('[STUDY SERVICE] AI Provider call warning:', llmErr.message);
    }

    // If external LLM is unconfigured or failed, use deterministic academic synthesizer fallback
    if (fallbackGenerator) {
      return fallbackGenerator();
    }
    return output.trim() || 'No response generated from study sources.';
  }

  _htmlToMarkdown(html, title, url) {
    let clean = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    // Headings
    clean = clean.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
      .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
      .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
      .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');

    // Paragraphs and breaks
    clean = clean.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n')
      .replace(/<br\s*[\/]?>/gi, '\n')
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');

    // Strip remaining tags
    clean = clean.replace(/<[^>]+>/g, ' ');

    // Decode entities
    clean = clean
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');

    // Clean whitespace
    clean = clean.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();

    return `# ${title}\n\n**Source URL:** [${url}](${url})\n*Extracted on: ${new Date().toLocaleString()}*\n\n---\n\n${clean}`;
  }

  _extractJsonArray(text) {
    if (!text) return [];
    let trimmed = text.trim();
    // Strip markdown code fences if present
    if (trimmed.startsWith('```json')) trimmed = trimmed.replace(/^```json/, '').replace(/```$/, '').trim();
    else if (trimmed.startsWith('```')) trimmed = trimmed.replace(/^```/, '').replace(/```$/, '').trim();

    const startIdx = trimmed.indexOf('[');
    const endIdx = trimmed.lastIndexOf(']');
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const jsonStr = trimmed.slice(startIdx, endIdx + 1);
      return JSON.parse(jsonStr);
    }
    return JSON.parse(trimmed);
  }

  _generateFallbackAnswer(question, results) {
    if (!results || results.length === 0) {
      return "Based on the attached study sources, there is no direct evidence to answer this question.";
    }
    const lines = [
      `### Study Synthesis for: "${question}"\n`,
      'Based on the verified excerpts retrieved from your studybook sources:\n'
    ];
    results.slice(0, 3).forEach((r, idx) => {
      lines.push(`**Source Excerpt ${idx + 1}** [Source: ${r.sourceName}${r.sectionTitle ? ', Section: "' + r.sectionTitle + '"' : ''}${r.pageNumber ? ', Page ' + r.pageNumber : ''}]:`);
      lines.push(`> ${r.content.slice(0, 260)}...\n`);
    });
    return lines.join('\n');
  }

  _fallbackFlashcards(contextText) {
    const excerpts = this._extractContextExcerpts(contextText);
    const sentences = excerpts.flatMap(excerpt => excerpt.content.split(/(?<=[.?!])\s+/)
      .filter(sentence => sentence.length > 30 && sentence.length < 200)
      .map(sentence => ({ sentence, source: excerpt.source }))
    ).slice(0, 10);
    return sentences.map(({ sentence, source }, idx) => ({
      id: `fc_${idx + 1}`,
      front: `What does this source state? "${sentence.slice(0, 45)}..."`,
      back: sentence.trim(),
      hint: `Refer to excerpt ${idx + 1}`,
      source,
      mastered: false
    }));
  }

  _fallbackQuiz(contextText) {
    const excerpts = this._extractContextExcerpts(contextText);
    const sentences = excerpts.flatMap(excerpt => excerpt.content.split(/(?<=[.?!])\s+/)
      .filter(sentence => sentence.length > 40 && sentence.length < 180)
      .map(sentence => ({ sentence, source: excerpt.source }))
    ).slice(0, 6);
    return sentences.map(({ sentence, source }, idx) => ({
      id: `q_${idx + 1}`,
      type: 'multiple_choice',
      question: `Which statement is supported by ${source}?`,
      options: [
        sentence.trim(),
        'This detail is not stated in the provided source.',
        'The provided source does not establish this claim.',
        'This information is unavailable in the provided excerpt.'
      ],
      answer: sentence.trim(),
      explanation: `Supported by the cited excerpt: "${sentence.trim()}"`,
      citation: source
    }));
  }

  _fallbackPracticeExam(title, contextText) {
    const excerpts = this._extractContextExcerpts(contextText).slice(0, 8);
    if (excerpts.length === 0) return `# ${title}: Practice Questions\n\nNo source excerpts were available to create grounded questions.`;
    return [
      `# PRACTICE EXAMINATION: ${title}`,
      '',
      'Answer using only the cited source excerpts.',
      ...excerpts.map((excerpt, index) => `${index + 1}. Explain the significance of this statement from ${excerpt.source}:\n\n> ${excerpt.content.slice(0, 450)}`)
    ].join('\n');
  }

  _fallbackStudyGuide(title, contextText) {
    return [
      `# ${title}: Master Study Guide & Revision Manual`,
      '',
      '## 1. Executive Summary',
      'This study guide compiles the essential concepts, definitions, and workflows extracted from your verified studybook sources.',
      '',
      '## 2. Key Concepts & Principles',
      contextText.slice(0, 1200),
      '',
      '## 3. High-Yield Review Takeaways',
      '- Review core definitions before attempting practice examinations.',
      '- Pay attention to specific section citations and referenced page numbers.',
      '- Re-test comprehension using the interactive Flashcard deck and Practice Quizzes.'
    ].join('\n');
  }

  _fallbackPodcast(title, contextText) {
    const excerpts = this._extractContextExcerpts(contextText).slice(0, 3);
    return [
      `Alex: This overview is based on the sources in "${title}".`,
      ...excerpts.flatMap(excerpt => [
        `Sam: ${excerpt.source} states: “${excerpt.content.slice(0, 450)}”`,
        'Alex: That is the source passage. We should keep any further interpretation tied to its wording.'
      ])
    ].join('\n\n');
  }

  _extractContextExcerpts(contextText) {
    const excerpts = [];
    const pattern = /--- \[(Doc \d+: [^\]]+)\] ---\n([\s\S]*?)(?=\n\n--- \[Doc \d+:|$)/g;
    let match;
    while ((match = pattern.exec(contextText)) !== null) {
      const content = match[2].trim();
      if (content) excerpts.push({ source: match[1], content });
    }
    return excerpts;
  }
}

module.exports = StudyService;
