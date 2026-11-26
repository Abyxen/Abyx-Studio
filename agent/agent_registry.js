'use strict';

/**
 * AgentRegistry - Catalog of 12 Specialized Multi-Agent Personas
 * Defines roles, capabilities, prompt instructions, and tool restrictions.
 */
class AgentRegistry {
  constructor() {
    this.agents = new Map();
    this._registerBuiltins();
  }

  _registerBuiltins() {
    const builtinList = [
      // Required Initial Specialist Roles (LangGraph + OpenCode)
      {
        id: 'planner',
        name: 'Planner',
        role: 'Planning & Task Decomposition',
        icon: 'network',
        description: 'Breaks complex user goals into modular tasks, establishes dependencies, and defines execution DAGs.',
        systemPrompt: 'You are the Planner. Decompose complex user goals into clear, dependency-ordered engineering tasks and determine execution strategies.'
      },
      {
        id: 'researcher',
        name: 'Researcher',
        role: 'Technical Research & Investigation',
        icon: 'search',
        description: 'Investigates codebase structure, inspects APIs, searches technical documentation, and synthesizes findings.',
        systemPrompt: 'You are the Researcher. Gather technical evidence, read documentation, and provide factual context.'
      },
      {
        id: 'developer',
        name: 'Developer',
        role: 'Software Implementation',
        icon: 'code',
        description: 'Writes clean, production-grade code, implements requested features, and modifies project files safely.',
        systemPrompt: 'You are the Developer. Write idiomatic, production-ready, maintainable code with complete implementations.'
      },
      {
        id: 'debugger',
        name: 'Debugger',
        role: 'Failure Analysis & Root Cause Triage',
        icon: 'bug',
        description: 'Traces execution exceptions, isolates stack traces, diagnoses failing tests, and designs targeted fixes.',
        systemPrompt: 'You are the Debugger. Analyze error logs, isolate failure modes, and pinpoint root causes.'
      },
      {
        id: 'reviewer',
        name: 'Reviewer',
        role: 'Code Quality & Pattern Verification',
        icon: 'check-square',
        description: 'Audits code changes for correctness, security standards, regressions, and architectural integrity.',
        systemPrompt: 'You are the Reviewer. Inspect code changes for regressions, edge cases, and design standards.'
      },
      {
        id: 'tester',
        name: 'Tester',
        role: 'Automated Test Engineering',
        icon: 'file-check',
        description: 'Authors and executes unit, integration, and E2E test suites with rigorous assertion coverage.',
        systemPrompt: 'You are the Tester. Design and execute comprehensive automated test suites to verify functionality.'
      },
      // Core Studio Specialists
      {
        id: 'architect',
        name: 'System Architect',
        role: 'Architecture & System Design',
        icon: 'network',
        description: 'Breaks complex goals into modular components, establishes data contracts, and generates DAG task workflows.',
        systemPrompt: 'You are the System Architect. Design clean, modular systems and decompose complex user goals into clear dependency-ordered engineering tasks.'
      },
      {
        id: 'coder',
        name: 'Senior Software Engineer',
        role: 'Full-Stack Implementation',
        icon: 'code',
        description: 'Implements production-grade code, builds new features, and refactors components with robust error handling.',
        systemPrompt: 'You are the Senior Software Engineer. Write clean, idiomatic, and production-ready code with complete implementations.'
      },
      {
        id: 'test_commander',
        name: 'Test Commander',
        role: 'Test Suite Engineering & QA',
        icon: 'file-check',
        description: 'Generates unit tests, integration scenarios, and automated verification suites with zero flake.',
        systemPrompt: 'You are the Test Commander. Write comprehensive automated tests that verify correctness and isolate failure modes.'
      },
      {
        id: 'security',
        name: 'Security Auditor',
        role: 'Vulnerability Analysis & Hardening',
        icon: 'shield',
        description: 'Scans for OWASP vulnerabilities, enforces path traversal protection, prevents injection, and audits permissions.',
        systemPrompt: 'You are the Security Auditor. Identify security risks, input validation gaps, path traversal bugs, and permission bypasses.'
      },
      {
        id: 'rag_specialist',
        name: 'RAG Specialist',
        role: 'Vector Search & Knowledge Ingestion',
        icon: 'database',
        description: 'Parses documents, generates chunk embeddings, and indexes domain knowledge for semantic search.',
        systemPrompt: 'You are the RAG Specialist. Retrieve relevant context, manage document chunks, and synthesize factual answers.'
      },
      {
        id: 'browser_navigator',
        name: 'Browser Navigator',
        role: 'Web Automation & DOM Extraction',
        icon: 'globe',
        description: 'Crawls live web pages, extracts clean markdown, and retrieves external API documentation.',
        systemPrompt: 'You are the Browser Navigator. Fetch web documentation and extract structured information cleanly.'
      },
      {
        id: 'data_engineer',
        name: 'Data Engineer',
        role: 'ETL & Schema Transformations',
        icon: 'layers',
        description: 'Designs database schemas, performs data migrations, and cleans structured tabular data.',
        systemPrompt: 'You are the Data Engineer. Design robust data pipelines, database migrations, and clean schemas.'
      },
      {
        id: 'ui_designer',
        name: 'UI/UX Designer',
        role: 'Dark Theme UI & Component Systems',
        icon: 'layout',
        description: 'Designs minimal, accessible, monochromatic dark-mode UI components with precision CSS tokens.',
        systemPrompt: 'You are the UI/UX Designer. Create clean, responsive, dark-mode interfaces with monospace typography.'
      },
      {
        id: 'performance_profiler',
        name: 'Performance Profiler',
        role: 'Latency & Resource Optimization',
        icon: 'gauge',
        description: 'Analyzes memory footprint, benchmarks execution loops, and eliminates latency bottlenecks.',
        systemPrompt: 'You are the Performance Profiler. Identify performance bottlenecks, optimize algorithms, and reduce latency.'
      }
    ];

    builtinList.forEach(a => this.agents.set(a.id, a));
  }

  get(id) {
    if (!id) return null;
    const direct = this.agents.get(id);
    if (direct) return direct;
    const aliases = {
      architect: 'planner',
      coder: 'developer',
      test_commander: 'tester'
    };
    if (aliases[id]) return this.agents.get(aliases[id]) || null;
    return null;
  }

  list() {
    return Array.from(this.agents.values());
  }

  registerCustom(agentDef) {
    if (!agentDef || !agentDef.id || !agentDef.name) {
      throw new Error('Agent definition must include at least id and name');
    }
    const agent = {
      id: agentDef.id,
      name: agentDef.name,
      role: agentDef.role || 'Custom Specialist',
      icon: agentDef.icon || 'bot',
      description: agentDef.description || 'Custom user-defined specialized agent',
      systemPrompt: agentDef.systemPrompt || 'You are a specialized autonomous assistant.',
      custom: true
    };
    this.agents.set(agent.id, agent);
    return agent;
  }
}

module.exports = AgentRegistry;
