---
name: Awesome Mcp Reference
description: >
  Operational guidelines for awesome-mcp-reference
category: Engineering Craftsmanship
author: GitHub / punkpeye
version: 1.0.0
triggers:
  - "awesome mcp reference"
  - "awesome-mcp-reference"
---

# Awesome Mcp Reference

> **Category:** Engineering Craftsmanship
> **Source Repository:** https://github.com/punkpeye/awesome-mcp-servers.git

## Operational Guidelines & Workflow Instructions

# Awesome MCP Servers

[![ไทย](https://img.shields.io/badge/Thai-Click-blue)](README-th.md)
[![English](https://img.shields.io/badge/English-Click-yellow)](README.md)
[![繁體中文](https://img.shields.io/badge/繁體中文-點擊查看-orange)](README-zh_TW.md)
[![简体中文](https://img.shields.io/badge/简体中文-点击查看-orange)](README-zh.md)
[![日本語](https://img.shields.io/badge/日本語-クリック-青)](README-ja.md)
[![한국어](https://img.shields.io/badge/한국어-클릭-yellow)](README-ko.md)
[![Português Brasileiro](https://img.shields.io/badge/Português_Brasileiro-Clique-green)](README-pt_BR.md)
[![Discord](https://img.shields.io/discord/1312302100125843476?logo=discord&label=discord)](https://glama.ai/mcp/discord)
[![Subreddit subscribers](https://img.shields.io/reddit/subreddit-subscribers/mcp?style=flat&logo=reddit&label=subreddit)](https://www.reddit.com/r/mcp/)

> [!IMPORTANT]
> [ray.run](https://ray.run/) – from idea to a production-grade MCP server in under a minute! 🦜

<sup><a href="https://glama.ai/advertise">Ad</a></sup>

A curated list of awesome Model Context Protocol (MCP) servers.

* [What is MCP?](#what-is-mcp)
* [Clients](#clients)
* [Remote Servers](#remote-servers)
* [Tutorials](#tutorials)
* [Community](#community)
* [Legend](#legend)
* [Server Implementations](#server-implementations) 
* [Frameworks](#frameworks)
* [Tips & Tricks](#tips-and-tricks)

## What is MCP?

[MCP](https://modelcontextprotocol.io/) is an open protocol that enables AI models to securely interact with local and remote resources through standardized server implementations. This list focuses on production-ready and experimental MCP servers that extend AI capabilities through file access, database connections, API integrations, and other contextual services.

## Clients

Checkout [awesome-mcp-clients](https://github.com/punkpeye/awesome-mcp-clients/) and [glama.ai/mcp/clients](https://glama.ai/mcp/clients).

## Remote Servers

This list is for servers with a GitHub repo you install and run yourself. Looking for a hosted server you just connect to over a URL? See [awesome-remote-mcp-servers](https://github.com/punkpeye/awesome-remote-mcp-servers).

## Tutorials

* [Tool Definition Quality Score (TDQS)](https://github.com/glama-ai/tool-definition-quality-score)
* [Model Context Protocol (MCP) Quickstart](https://glama.ai/blog/2024-11-25-model-context-protocol-quickstart)
* [Setup Claude Desktop App to Use a SQLite Database](https://youtu.be/wxCCzo9dGj0)

## Community

* [r/mcp Reddit](https://www.reddit.com/r/mcp)
* [Discord Server](https://glama.ai/mcp/discord)

## Legend

* 🎖️ – official implementation
* programming language
  * 🐍 – Python codebase
  * 📇 – TypeScript (or JavaScript) codebase
  * 🏎️ – Go codebase
  * 🦀 – Rust codebase
  * #️⃣ - C# Codebase
  * ☕ - Java codebase
  * 🌊 – C/C++ codebase
  * 💎 - Ruby codebase

* scope
  * ☁️ - Cloud Service
  * 🏠 - Local Service
  * 📟 - Embedded Systems
* operating system
  * 🍎 – For macOS
  * 🪟 – For Windows
  * 🐧 - For Linux

> [!NOTE]
> Confused about Local 🏠 vs Cloud ☁️?
> * Use local when MCP server is talking to a locally installed software, e.g. taking control over Chrome browser.
> * Use cloud when MCP server is talking to remote APIs, e.g. weather API.

## Server Implementations

> [!NOTE]
> We now have a [web-based directory](https://glama.ai/mcp/servers) that is synced with the repository.

* 🔗 - [Aggregators](#aggregators)
* 🤝 - [Agreements & Coordination](#agreements--coordination)
* 🎨 - [Art & Culture](#art-and-culture)
* 📐 - [Architecture & Design](#architecture-and-design)
* 📂 - [Browser Automation](#browser-automation)
* 🧬 - [Biology Medicine and Bioinformatics](#bio)
* ☁️ - [Cloud Platforms](#cloud-platforms)
* 👨‍💻 - [Code Execution](#code-execution)
* 🤖 - [Coding Agents](#coding-agents)
* 🖥️ - [Command Line](#command-line)
* 💬 - [Communication](#communication)
* 🗣️ - [Conversational AI](#conversational-ai)
* 🔑 - [Cryptography](#cryptography)
* 👤 - [Customer Data Platforms](#customer-data-platforms)
* 🗄️ - [Databases](#databases)
* 📊 - [Data Platforms](#data-platforms)
* 🚚 - [Delivery](#delivery)
* 🛠️ - [Developer Tools](#developer-tools)
* 🧮 - [Data Science Tools](#data-science-tools)
* 📊 - [Data Visualization](#data-visualization)
* 📟 - [Embedded system](#embedded-system)
* 🎓 - [Education](#education)
* 🛒 - [E-Commerce](#e-commerce)
* 🌳 - [Environment & Nature](#environment-and-nature)
* 📂 - [File Systems](#file-systems)
* 💰 - [Finance & Fintech](#finance--fintech)
* 🎮 - [Gaming](#gaming)
* 🏠 - [Home Automation](#home-automation)
* 🪪 - [Identity](#identity)
* 🏭 - [Industrial & IoT](#industrial--iot)
* 🧠 - [Knowledge & Memory](#knowledge--memory)
* ⚖️ - [Legal](#legal)
* 🗺️ - [Location Services](#location-services)
* 🎯 - [Marketing](#marketing)
* 📊 - [Monitoring](#monitoring)
* 🎥 - [Multimedia Process](#multimedia-process)
* 🖥️ - [OS Automation](#os-automation)
* 🎙️ - [Podcasts](#podcasts)
* 📋 - [Product Management](#product-management)
* 🏠 - [Real Estate](#real-estate)
* 🔬 - [Research](#research)
* 🔎 - [Search & Data Extraction](#search)
* 🔒 - [Security](#security)
* 🌐 - [Social Media](#social-media)
* 🔮 - [Spirituality & Esoterica](#spirituality-and-esoterica)
* 🏃 - [Sports](#sports)
* 🎧 - [Support & Service Management](#support-and-service-management)
* 🌎 - [Translation Services](#translation-services)
* 🎧 - [Text-to-Speech](#text-to-speech)
* 🎙️ - [Speech-to-Text](#speech-to-text)
* 🚆 - [Travel & Transportation](#travel-and-transportation)
* 🔄 - [Version Control](#version-control)
* 🏢 - [Workplace & Productivity](#workplace-and-productivity)
* 🛠️ - [Other Tools and Integrations](#other-tools-and-integrations)

### 🔗 <a name="aggregators"></a>Aggregators

Servers for accessing many apps and tools through a single MCP server.
- [actimod/onaa-protocol](https://github.com/actimod/onaa-protocol) [![actimod/onaa-protocol MCP server](https://glama.ai/mcp/servers/actimod/onaa-protocol/badges/score.svg)](https://glama.ai/mcp/servers/actimod/onaa-protocol) 🐍 ☁️ - Find stores where AI agents reach checkout (payment not tested), with tested checkout steps; hosted at api.onaa.net/mcp or run locally.
- [inth3shadows/terse](https://github.com/inth3shadows/terse) [![inth3shadows/terse MCP server](https://glama.ai/mcp/servers/inth3shadows/terse/badges/score.svg)](https://glama.ai/mcp/servers/inth3shadows/terse) 🐍 🏠 🍎 🪟 🐧 - Transparent proxy that sits in front of any other MCP server and shrinks its tool output before it reaches the model. Lossless by default — a denser encoding of the same bytes, with a round-trip gate asserting an exact inverse, so nothing is dropped or summarised. Repeated calls to the same tool emit a delta against the prior result instead of the whole payload. Per-tool opt-in, no decode step, no model in the loop. `uv tool install terse-mcp` then `terse proxy -- <server>`
- [402signalhq/402signal](https://github.com/402signalhq/402signal) [![402Signal MCP server](https://glama.ai/mcp/servers/402signalhq/402signal/badges/score.svg)](https://glama.ai/mcp/servers/402signalhq/402signal) 🐍 ☁️ - Checks and validates live x402 payment routes across Base, Solana and Algorand.
- [benjaminsamson0210/nexusgrid-mcp](https://github.com/benjaminsamson0210/nexusgrid-mcp) [![benjaminsamson0210/nexusgrid-mcp MCP server](https://glama.ai/mcp/servers/benjaminsamson0210/nexusgrid-mcp/badges/score.svg)](https://glama.ai/mcp/servers/benjaminsamson0210/nexusgrid-mcp) 📇 ☁️ - Official MCP server providing edge-native AI agent tools: Web-to-Markdown scraper (NexusScrape), email deliverability & RFC 7208 auditor (MailAuthGuard), and disposable email fraud detector (FraudShield).
- [GarphenGate/moltline-mcp](https://github.com/GarphenGate/moltline-mcp) [![GarphenGate/moltline-mcp MCP server](https://glama.ai/mcp/servers/GarphenGate/moltline-mcp/badges/score.svg)](https://glama.ai/mcp/servers/GarphenGate/moltline-mcp) 🐍 ☁️ 🍎 🪟 🐧 - Bridge to Moltline Studio's hosted MCP servers: code review, agent governance, business math, regulatory deadlines, crypto tax lots, routing and optimization.
- [team886/findagent-mcp](https://github.com/team886/findagent-mcp) [![team886/findagent-mcp MCP server](https://glama.ai/mcp/servers/team886/findagent-mcp/badges/score.svg)](https://glama.ai/mcp/servers/team886/findagent-mcp) 📇 ☁️ - Marketplace of vetted agents with automated security scans plus human review, credential-to-host binding and sandboxed hosted code with default-deny egress.
- [BotHireAgent/BotHireMCPServer](https://github.com/BotHireAgent/BotHireMCPServer) [![BotHireAgent/BotHireMCPServer MCP server](https://glama.ai/mcp/servers/BotHireAgent/BotHireMCPServer/badges/score.svg)](https://glama.ai/mcp/servers/BotHireAgent/BotHireMCPServer) 📇 🏠 - BotHire agent-to-agent hiring marketplace: search agents and skills by capability and trust score, read live demand, and settle in USDT or USDC across chains.
- [@neoninnovationlab/neon-mcp-gateway](https://github.com/neoninnovationlab/neon-mcp-gateway) [![neoninnovationlab/neon-mcp-gateway MCP server](https://glama.ai/mcp/servers/neoninnovationlab/neon-mcp-gateway/badges/score.svg)](https://glama.ai/mcp/servers/neoninnovationlab/neon-mcp-gateway) 📇 ☁️ 🏠 - Edge firewall for exposing internal PostgreSQL databases and APIs to AI agents with strict validation.
- [daedalusdevelopmentgroup/ddg-agent-payable-services](https://github.com/daedalusdevelopmentgroup/ddg-agent-payable-services) [![daedalusdevelopmentgroup/ddg-agent-payable-services MCP server](https://glama.ai/mcp/servers/daedalusdevelopmentgroup/ddg-agent-payable-services/badges/score.svg)](https://glama.ai/mcp/servers/daedalusdevelopmentgroup/ddg-agent-payable-services) 🐍 ☁️ - Pay-per-call x402 tools (utilities, DNS/WHOIS, blockchain RPC, market and DEX data, prediction markets, security audits) plus an OpenAI-compatible LLM gateway.
- [forgemeshlabs/coinopai-mcp](https://github.com/forgemeshlabs/coinopai-mcp) [![forgemeshlabs/coinopai-mcp MCP server](https://glama.ai/mcp/servers/forgemeshlabs/coinopai-mcp/badges/score.svg)](https://glama.ai/mcp/servers/forgemeshlabs/coinopai-mcp) 📇 - Paid crypto intelligence via x402 on Base: preflight checks, trade decisions audited against real prices, risk state, signal history and automation search.
- [forgemeshlabs/anomaly-mcp](https://github.com/forgemeshlabs/anomaly-mcp) [![forgemeshlabs/anomaly-mcp MCP server](https://glama.ai/mcp/servers/forgemeshlabs/anomaly-mcp/badges/score.svg)](https://glama.ai/mcp/servers/forgemeshlabs/anomaly-mcp) 📇 ☁️ - Real-time anomaly detection with NASA-derived sequence mining across blockchain, mempool, stablecoin depeg, aviation and GitHub signals, paid via x402 on Base.
- [1mcp/agent](https://github.com/1mcp-app/agent) 📇 ☁️ 🏠 🍎 🪟 🐧 - Aggregates multiple MCP servers into one unified server.
- [2s-io/sdk](https://github.com/2s-io/sdk) [![2s-io/sdk MCP server](https://glama.ai/mcp/servers/2s-io/sdk/badges/score.svg)](https://glama.ai/mcp/servers/2s-io/sdk) 📇 ☁️ 🍎 🪟 🐧 - Pay-per-call x402 API: geocoding, weather, earthquakes, patents, US case law, Federal Register, scientific papers, DNS/WHOIS, OFAC screening and Census data.
- [8randonpickart5/alderpost-mcp](https://github.com/8randonpickart5/alderpost-mcp) [![alderpost-mcp MCP server](https://glama.ai/mcp/servers/8randonpickart5/alderpost-mcp/badges/score.svg)](https://glama.ai/mcp/servers/8randonpickart5/alderpost-mcp) 📇 ☁️ - Intelligence endpoints for security, company, threat, compliance, sales, sports, property and health data, paid via x402 micropayments on Base.
- [forgemeshlabs/utility-grid-mcp](https://github.com/forgemeshlabs/utility-grid-mcp) [![forgemeshlabs/utility-grid-mcp MCP server](https://glama.ai/mcp/servers/forgemeshlabs/utility-grid-mcp/badges/score.svg)](https://glama.ai/mcp/servers/forgemeshlabs/utility-grid-mcp) 📇 ☁️ - Search and call utility APIs for OCR, image, audio, web, math, conversion and geodata, paid per call with x402 USDC on Base.
- [giorgio44/gateonai-mcp-server](https://github.com/giorgio44/gateonai-mcp-server) [![giorgio44/gateonai-mcp-server MCP server](https://glama.ai/mcp/servers/giorgio44/gateonai-mcp-server/badges/score.svg)](https://glama.ai/mcp/servers/giorgio44/gateonai-mcp-server) 🐍 ☁️ - Search and compare thousands of AI tools, generate step-by-step AI workflows and AI tool stacks by profession from GateOnAI's curated catalog. Free, no API key.
- [GTCC777/pulsenetwork-mcp](https://github.com/GTCC777/pulsenetwork-mcp) [![GTCC777/pulsenetwork-mcp MCP server](https://glama.ai/mcp/servers/GTCC777/pulsenetwork-mcp/badges/score.svg)](https://glama.ai/mcp/servers/GTCC777/pulsenetwork-mcp) 📇 - Pay-per-call x402 intelligence APIs on Base and Solana: finance, crypto, legal, immigration, healthcare costs, real estate, tax, climate, sports and science.
- [mcpqueen/mcpqueen](https://github.com/mcpqueen/mcpqueen) [![mcpqueen/mcpqueen MCP server](https://glama.ai/mcp/servers/mcpqueen/mcpqueen/badges/score.svg)](https://glama.ai/mcp/servers/mcpqueen/mcpqueen) 🎖️ 📇 ☁️ - Graded MCP registry: live-probes remote servers from the MCP Registry (initialization, tool listing, schema quality, latency, provenance) and publishes grades.
- [minia2auk/minia2a-mcp](https://github.com/minia2auk/minia2a-mcp) [![minia2auk/minia2a-mcp MCP server](https://glama.ai/mcp/servers/minia2auk/minia2a-mcp/badges/score.svg)](https://glama.ai/mcp/servers/minia2auk/minia2a-mcp) 📇 ☁️ - Pay-per-call x402 gateway for agent tools: crypto and DeFi data, web scraping, AI inference, CAPTCHA solving, token security, DNS/WHOIS and gas monitoring.
- [Nutshell2000/agent-data-tools](https://github.com/Nutshell2000/agent-data-tools) [![Nutshell2000/agent-data-tools MCP server](https://glama.ai/mcp/servers/Nutshell2000/agent-data-tools/badges/score.svg)](https://glama.ai/mcp/servers/Nutshell2000/agent-data-tools) 📇 ☁️ 🏠 🍎 🪟 🐧 - Glyphcall: one MCP server for 650+ pay-per-call agent tools: EU company registers and VAT (VIES) checks, sanctions screening, e-invoice validation, speech to text, web and PDF extraction, token prices and chain reads. 25 free calls, then pay per call in USDC (x402) or with a prepaid card key. `npx -y agent-data-tools setup <client>`
- [szp2005/llm-prices-cn](https://github.com/szp2005/llm-prices-cn) [![szp2005/llm-prices-cn MCP server](https://glama.ai/mcp/servers/szp2005/llm-prices-cn/badges/score.svg)](https://glama.ai/mcp/servers/szp2005/llm-prices-cn) 🐍 ☁️ - Daily-verified dataset of LLM API prices for Chinese and global models, with live price queries and token cost estimation.
- [tadas-github/a2asearch-mcp](https://github.com/tadas-github/a2asearch-mcp) [![tadas-github/a2asearch-mcp MCP server](https://glama.ai/mcp/servers/tadas-github/a2asearch-mcp/badges/score.svg)](https://glama.ai/mcp/servers/tadas-github/a2asearch-mcp) 📇 ☁️ - Sear
