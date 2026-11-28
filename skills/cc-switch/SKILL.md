---
name: Cc Switch
description: >
  <div align="center">
category: Agent Workflow
author: GitHub / farion1231
version: 1.0.0
triggers:
  - "cc switch"
  - "cc-switch"
---

# Cc Switch

> **Category:** Agent Workflow
> **Source Repository:** https://github.com/farion1231/cc-switch.git

## Operational Guidelines & Workflow Instructions

<div align="center">

# CC Switch

### The All-in-One Manager for Claude Code, Claude Desktop, Codex, Gemini CLI, Grok Build, OpenCode, OpenClaw, Hermes Agent, Pi, MiniMax Code, Kimi Code & Oh My Pi

**Switch API providers in one click and manage MCP, Skills, and Prompts in one place — no more hand-editing JSON / TOML / YAML config files.**

[![Version](https://img.shields.io/github/v/release/farion1231/cc-switch?color=blue&label=version)](https://github.com/farion1231/cc-switch/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/farion1231/cc-switch/releases)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-orange.svg)](https://tauri.app/)
[![Downloads](https://img.shields.io/github/downloads/farion1231/cc-switch/total)](https://github.com/farion1231/cc-switch/releases/latest)

<a href="https://trendshift.io/repositories/15372" target="_blank"><img src="https://trendshift.io/api/badge/repositories/15372" alt="farion1231%2Fcc-switch | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
<a href="https://www.star-history.com/#farion1231/cc-switch&Date"><picture><source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/badge?repo=farion1231/cc-switch&theme=dark" /><img alt="Star History Rank" src="https://api.star-history.com/badge?repo=farion1231/cc-switch" width="196" height="55" /></picture></a>

<a href="https://trendshift.io/repositories/15372?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-15372" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/15372/daily?language=Rust" alt="farion1231%2Fcc-switch | Trendshift" width="250" height="55"/></a>
<a href="https://trendshift.io/repositories/15372?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-15372" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/15372/weekly?language=Rust" alt="farion1231%2Fcc-switch | Trendshift" width="250" height="55"/></a>
<a href="https://trendshift.io/repositories/15372?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-15372" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/15372/monthly?language=Rust" alt="farion1231%2Fcc-switch | Trendshift" width="250" height="55"/></a>

### 🌐 The Only Official Website: **[ccswitch.io](https://ccswitch.io)**

English | [简体中文](README_ZH.md) | [繁體中文](README_ZH-TW.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Türkçe](README_TR.md) | [Русский](README_RU.md) | [Deutsch](README_DE.md) | [Changelog](CHANGELOG.md)

**[Download](#download--installation) · [Quick Start](#quick-start) · [Features](#features) · [FAQ](#faq) · [User Manual](docs/user-manual/en/README.md)**

</div>

## ❤️Sponsor

> [Want to appear here?](mailto:support@ccswitch.io)

<details open>
<summary>Click to collapse</summary>

[![Kimi K3.1 Pro](assets/partners/banners/kimi-banner-en.png)](https://platform.kimi.ai?track_id=track-674ed6e2af924a5682a87421f7cf753a&aff=cc-switch)

Kimi K3.1 Pro is Moonshot AI's most capable 3T-class open-weight model to date, with a 1-million-token context window. Built on Kimi K3 with substantially larger post-training compute, it delivers consistent gains across coding, agentic workflows, 3D creation, and reasoning. CC Switch makes it easy to configure and switch to Kimi K3.1 Pro across agentic tools.

Try a **Kimi Code plan** ([中文站](https://www.kimi.com/code?aff=cc-switch) | [Global](https://www.kimi.ai/code?aff=cc-switch)), or use the **API** through the Kimi Open Platform ([中文站](https://platform.kimi.com?track_id=track-7cf2b91dcde043eda6ef9a95951a042c&aff=cc-switch) | [Global](https://platform.kimi.ai?track_id=track-674ed6e2af924a5682a87421f7cf753a&aff=cc-switch)).

**New user top-up bonus**: register and complete your first top-up via the API links above to receive 10% of the amount as bonus API credit, up to CNY ¥1,000.

---

<table>
<tr>
<td width="180"><a href="https://www.aicodemirror.ai/register?invitecode=9915W3"><img src="assets/partners/logos/aicodemirror.jpg" alt="AICodeMirror" width="150"></a></td>
<td>Thanks to AICodeMirror for sponsoring this project! AICodeMirror provides official high-stability relay services for Claude Code / Codex / Gemini CLI, with enterprise-grade concurrency, fast invoicing, and 24/7 dedicated technical support.
Claude Code / Codex / Gemini official channels at 38% / 2% / 9% of original price, with extra discounts on top-ups! AICodeMirror offers special benefits for CC Switch users: register via <a href="https://www.aicodemirror.ai/register?invitecode=9915W3">this link</a> to enjoy 20% off your first top-up, and enterprise customers can get up to 25% off!</td>
</tr>

<tr>
<td width="180"><a href="https://www.packyapi.ai/register?aff=cc-switch"><img src="assets/partners/logos/packycode.png" alt="PackyCode" width="150"></a></td>
<td>Thanks to PackyCode for sponsoring this project! PackyCode is a reliable and efficient API relay service provider, offering relay services for Claude Code, Codex, Gemini, and more. PackyCode provides special discounts for our software users: register using <a href="https://www.packyapi.ai/register?aff=cc-switch">this link</a> and enter the "cc-switch" promo code during first recharge to get 10% off.</td>
</tr>

<tr>
<td width="180"><a href="https://apinebula.ai/VjM74M"><img src="assets/partners/logos/apinebula_banner.png" alt="APINebula" width="150"></a></td>
<td>Thanks to APINEBULA for sponsoring this project! APINEBULA, an enterprise-grade AI aggregation platform under Galaxy Video Bureau, leverages extensive platform resources to provide developers, teams, and enterprises with stable, cost-effective access to large language model APIs. The platform integrates leading, full-powered models like Claude, GPT, and Gemini, allowing you to connect to the world's top AI models through a single API, with prices starting as low as 10% of the original cost. Designed for AI programming, Agent development, and business system integration, APINEBULA supports enterprise-grade high concurrency, formal contracts, corporate bank transfers, and invoicing services. APINEBULA provides special discounts for our software users: register using <a href="https://apinebula.ai/VjM74M">this link</a> and enter the <strong>"ccswitch"</strong> promo code during your first recharge to get <strong>10% off</strong>.</td>
</tr>

<tr>
<td width="180"><a href="https://pateway.ai/?ch=etzpm8&aff=WB6M6F67#/"><img src="assets/partners/logos/pateway.png" alt="PatewayAI" width="150"></a></td>
<td>Thanks to PatewayAI for sponsoring this project! PatewayAI is an API relay service provider for experienced AI developers, with full support for Claude, the GPT series, and a wide range of mainstream Chinese models. All models come from official high-quality channels — never diluted, never faked — with transparent, verifiable billing details.
The economy mode goes as low as 5% of the original price. Register via <a href="https://pateway.ai/?ch=etzpm8&aff=WB6M6F67#/">this link</a> to get a free $1 trial credit, and join occasional promotions for more free credit.
The platform also supports enterprise-grade concurrency, a dedicated admin console, formal contracts and invoices, and offers a two-way referral top-up bonus of up to $150.</td>
</tr>

<tr>
<td width="180"><a href="https://modelflare.dev/sign-up?utm_source=github&utm_campaign=ccswitch"><img src="assets/partners/logos/modelflare-banner.png" alt="Modelflare" width="150"></a></td>
<td>Thanks to Modelflare for sponsoring this project! Modelflare: full-strength, stable, never watered down, with the world's SOTA models at low cost. The site is operated by Havenbyte LLC, a US limited liability company, and supports GPT, Claude, Gemini, Grok, and other leading models over common compatible protocols, plus 40+ image and video models. Formal business partnerships in mainland China are supported.
<b>Cache compensation is a highlight:</b> some of the OpenAI price-first, stable, and premium groups guarantee a daily cache hit rate of 65%, 75%, and 85% respectively. When eligible requests fall short of the target, the platform compensates the difference, which you can see on the usage dashboard after settlement.
<b>Special offer:</b> a single top-up of US$20 unlocks the GPT discount group at a 0.015× price multiplier, and a single top-up of US$50 unlocks the Claude discount group at a 0.03× price multiplier. <a href="https://modelflare.dev/sign-up?utm_source=github&utm_campaign=ccswitch">Sign up via the exclusive link</a> to take part.</td>
</tr>

<tr>
<td width="180"><a href="https://hao.ai/invite/DTBZS3OR"><img src="assets/partners/logos/haoai-banner.png" alt="hao.ai" width="150"></a></td>
<td>Thanks to hao.ai for sponsoring this project! hao.ai is a fast, stable unified LLM API gateway for developers and teams. With one API key and a unified interface, you can access GPT, Claude, xAI Grok, and other leading models, compatible with common protocols and SDKs such as OpenAI and Anthropic. The platform offers model routing, failover, team management, and complete request logs, with model prices as low as 15% of official reference prices, making it simpler, more stable, and cheaper to build AI applications. hao.ai offers CC Switch users a special perk: register via <a href="https://hao.ai/invite/DTBZS3OR">this link</a> to get 5% bonus credit on your first order!</td>
</tr>

<tr>
<td width="180"><a href="https://api.fenno.ai/register?redirect=/purchase?tab=subscription%26group=16&aff=P9MR3D3PLCNL"><img src="assets/partners/logos/fenno-banner.png" alt="Fenno.ai" width="150"></a></td>
<td>Thanks to Fenno.ai for sponsoring this project! Fenno.ai is a stable and efficient API relay service provider, currently focused on Codex relay. It is compatible with the OpenAI and Anthropic protocols and can be flexibly used from Codex, Claude Code, OpenCode, and other mainstream coding tools. It reliably supports enterprise-grade workloads of hundreds of billions of tokens per day, with corporate (B2B) settlement and invoicing for both domestic and overseas entities. Fenno.ai offers an exclusive benefit for CC Switch users: subscribe via <a href="https://api.fenno.ai/register?redirect=/purchase?tab=subscription%26group=16&aff=P9MR3D3PLCNL">this link</a> to the $1.99 Trial Plan worth $50 in credits (valid for 7 days), and earn up to 20% in referral rewards — invite more, earn more!</td>
</tr>

<tr>
<td width="180"><a href="https://www.openmodel.ai?ref=cc-switch"><img src="assets/partners/logos/openmodel-banner.jpg" alt="OpenModel" width="150"></a></td>
<td>Thanks to OpenModel for sponsoring this project! OpenModel offers client-specific discounts of up to 90% for Codex and 60% for Claude Code across supported models, helping developers cut API costs without changing how they work. Just connect your OpenModel API key and keep using Codex or Claude Code as usual — supported clients are detected automatically and discounted routes are applied with no extra parameters or manual routing required. You can also configure fallback behavior per API key, choosing whether to continue at standard pricing or stop when a discounted route is temporarily unavailable. CC Switch users can register via <a href="https://www.openmodel.ai?ref=cc-switch">this link</a> and use promo code <strong>"cc-switch"</strong> to get 10% off their first top-up.</td>
</tr>

<tr>
<td width="180"><a href="https://grooroute.pro/sign-up?aff=qqm9"><img src="assets/partners/logos/grooroute-banner.jpg" alt="GrooRoute Pro" width="150"></a></td>
<td>Thanks to GrooRoute Pro for sponsoring this project! GrooRoute Pro is a reliable, smooth AI API relay platform with access to OpenAI, Claude, DeepSeek, and other mainstream models. Deployed on overseas servers, it lets you choose your own pricing-multiplier tier and offers both pay-as-you-go billing and subscription plans, so you can use it however suits you best — with stable routes and fast responses that make calling all kinds of AI capabilities easier. Exclusive benefit for CC Switch users: register via <a href="https://grooroute.pro/sign-up?aff=qqm9">this link</a> to get ¥5 in free trial credit!</td>
</tr>

<tr>
<td width="180"><a href="https://buytoken.work/sign-up?aff=cc-switch"><img src="assets/partners/logos/buytoken-banner.png" alt="BuyToken" width="150"></a></td>
<td>Thanks to BuyToken for sponsoring this project! BuyToken offers relay services for Claude Code, Codex, DeepSeek, and more, with enterprise-grade concurrency and fast invoicing — built to be a stable, long-running service. BuyToken also offers CC Switch users a special deal: register via <a href="https://buytoken.work/sign-up?aff=cc-switch">this link</a> to get ¥3 in trial credit, plus 10% off your first top-up!</td>
</tr>

<tr>
<td width="180"><a href="https://gpt.ge/signup?aff=URNP"><img src="assets/partners/logos/vapi-banner.jpg" alt="V-API" width="150"></a></td>
<td>Thanks to V-API for sponsoring this project! V-API is a three-year-old brand dedicated to providing individuals, developers, and businesses with a stable, fast, and secure platform for high-quality LLM API services, with support for formal contracts and official invoices (general / special VAT). V-API offers CC Switch users a special deal: register via <a href="https://gpt.ge/signup?aff=URNP">this link</a> to get ¥2 off plus 10% off your first order!</td>
</tr>

<tr>
<td width="180"><a href="https://agentmarket.fluxapay.xyz/marketplace/tokenplans"><img src="assets/partners/logos/fluxa-banner.png" alt="FluxA TokenPlan" width="150"></a></td>
<td>Thanks to FluxA &amp; Baidu AI Cloud for sponsoring this project! FluxA and Baidu AI Cloud jointly launched AgenticPlan, which gives AI agents the ability to buy, manage and use models, APIs and tools on their own. It includes Baidu Qianfan TokenPlan at up to 40% off, with access to flagship models such as DeepSeek V4, GLM 5.2 and Kimi, plus bonus FluxA AgentMarket API credits that unlock 13,000+ paid APIs for search, data scraping, social media, finance, crypto, image generation, video and more.<br>With the user's authorization, an AI agent can also pay with the official Visa card to procure resources on its own, manage API keys, monitor usage and plan renewals — taking agents from "completing tasks autonomously" to genuinely "planning their own budget and completing tasks". Buy via <a href="https://agentmarket.fluxapay.xyz/marketplace/tokenplans">this link</a>!</td>
</tr>

<tr>
<td width="180"><a href="https://aigocode.net/invite/CC-SWITCH"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/partners/logos/aigocode-dark.png"><img src="assets/partners/logos/aigocode-light.png" alt="AIGoCode" width="150"></picture></a></td>
<td>Thanks to AIGoC
