/**
 * ABYX Agentic Engine — Controlled Web & Browser Tool
 * 
 * Enforces:
 * - Network permissions check
 * - SSRF protection blocking loopback (127.0.0.1, localhost), intranet, and cloud metadata
 * - Explicit domain visibility & URL reporting
 * - HTML-to-Markdown text extraction with size limits
 */

const browserService = require('../../services/browser_service');
const { fetchPublicResponse } = require('../../security/public_fetch');

const PROHIBITED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '169.254.169.254'
];

class ControlledBrowserTool {
  constructor(options = {}) {
    this.options = {
      defaultTimeoutMs: options.defaultTimeoutMs || 8000,
      maxPageBytes: options.maxPageBytes || 50000,
      ...options
    };
  }

  /**
   * Validates target URL against SSRF and non-HTTP protocols
   */
  validateUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
      throw new Error('URL must be a non-empty string');
    }

    let parsed;
    try {
      parsed = new URL(rawUrl.trim());
    } catch (e) {
      throw new Error(`Invalid URL format: "${rawUrl}"`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Security Violation: Protocol "${parsed.protocol}" not permitted. Only HTTP and HTTPS are allowed.`);
    }

    const host = parsed.hostname.toLowerCase();
    if (PROHIBITED_HOSTS.includes(host)) {
      throw new Error(`SSRF Violation: Target host "${host}" is prohibited.`);
    }

    // Check private RFC 1918 IPv4 ranges
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) {
      throw new Error(`SSRF Violation: Private intranet destination "${host}" is prohibited.`);
    }

    return parsed.href;
  }

  /**
   * Search real-time web news and facts
   */
  async searchWeb({ query, maxResults = 5 } = {}) {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return { success: false, error: 'Query must be a non-empty string' };
    }

    const cleanQuery = query.trim();
    const results = await browserService.searchWeb(cleanQuery);

    return {
      success: true,
      query: cleanQuery,
      source: 'web_search',
      resultsCount: (results.results || []).length,
      results: (results.results || []).slice(0, maxResults)
    };
  }

  /**
   * Fetch and extract readable content from a public web page
   */
  async fetchPage({ url, signal = null } = {}) {
    let validUrl;
    try {
      validUrl = this.validateUrl(url);
    } catch (err) {
      return { success: false, error: err.message };
    }

    const domain = new URL(validUrl).hostname;
    const timeout = AbortSignal.timeout(this.options.defaultTimeoutMs);
    const reqSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

    try {
      const res = await fetchPublicResponse(validUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ABYX/1.0 WebInspector'
        }, timeoutMs: this.options.defaultTimeoutMs, maxBytes: this.options.maxPageBytes
      });

      if (!res.ok) {
        return {
          success: false,
          url: validUrl,
          domain,
          status: res.status,
          error: `HTTP error ${res.status}: ${res.statusText}`
        };
      }

      const html = await res.text();
      const readableMarkdown = browserService.extractReadableText(html, this.options.maxPageBytes);

      return {
        success: true,
        url: validUrl,
        domain,
        status: res.status,
        content: readableMarkdown
      };
    } catch (err) {
      return {
        success: false,
        url: validUrl,
        domain,
        error: `Failed to fetch web page: ${err.message}`
      };
    }
  }
}

module.exports = ControlledBrowserTool;
