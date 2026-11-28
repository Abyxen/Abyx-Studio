/**
 * Browser and Runtime Visual Inspection Tool
 * Provides sandbox-safe inspection of web pages, local HTML artifacts, and runtime DOM trees.
 */

const fs = require('node:fs');
const path = require('node:path');

class BrowserInspectorTool {
  constructor(allowlist = null) {
    this.name = 'browser_tool';
    this.description = 'Navigates, queries DOM, takes visual captures, and inspects web / local HTML applications.';
    this.allowlist = allowlist;
    this.currentUrl = 'about:blank';
    this.domState = {
      title: 'Blank Page',
      body: '',
      elements: []
    };
  }

  getSchema() {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['navigate', 'get_dom', 'query_selector', 'capture_screenshot', 'evaluate_js'],
          description: 'Browser action to execute'
        },
        url: { type: 'string', description: 'URL or local file path to load' },
        selector: { type: 'string', description: 'CSS/DOM selector to query' },
        script: { type: 'string', description: 'JavaScript expression to evaluate' }
      },
      required: ['action']
    };
  }

  async execute(args) {
    const { action, url, selector, script } = args;

    switch (action) {
      case 'navigate': {
        if (!url) return { error: 'url is required for navigate action' };
        if (this.allowlist && !this.allowlist.isDomainAllowed(url)) {
          return { error: `Navigation blocked by BoundaryAllowlist: domain of ${url} is not permitted.` };
        }
        this.currentUrl = url;

        // If local HTML file
        if (url.startsWith('file://') || url.endsWith('.html') || url.endsWith('.htm')) {
          const filePath = url.replace('file://', '');
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            this.domState.title = (content.match(/<title>([^<]+)<\/title>/i) || [])[1] || 'Local HTML';
            this.domState.body = content;
            this.domState.elements = this._extractElements(content);
            return {
              status: 'loaded',
              url: this.currentUrl,
              title: this.domState.title,
              byteLength: content.length,
              elementCount: this.domState.elements.length
            };
          } catch (err) {
            return { error: `Failed to load local HTML file: ${err.message}` };
          }
        }

        // Simulated web rendering for HTTP/HTTPS targets
        this.domState.title = `Simulated Page: ${url}`;
        this.domState.body = `<html><head><title>${this.domState.title}</title></head><body><h1>Loaded ${url}</h1><main id="app"><p>Mock render output</p></main></body></html>`;
        this.domState.elements = this._extractElements(this.domState.body);
        return {
          status: 'loaded',
          url: this.currentUrl,
          title: this.domState.title,
          rendered: true
        };
      }

      case 'get_dom': {
        return {
          url: this.currentUrl,
          title: this.domState.title,
          domTreeSnippet: this.domState.body.slice(0, 1000),
          totalLength: this.domState.body.length
        };
      }

      case 'query_selector': {
        if (!selector) return { error: 'selector is required for query_selector' };
        const matches = this.domState.elements.filter(el =>
          (selector.startsWith('#') && el.id === selector.slice(1)) ||
          (selector.startsWith('.') && el.classes.includes(selector.slice(1))) ||
          el.tag.toLowerCase() === selector.toLowerCase()
        );
        return {
          selector,
          matchCount: matches.length,
          matches: matches.slice(0, 10)
        };
      }

      case 'capture_screenshot': {
        return {
          url: this.currentUrl,
          viewport: { width: 1280, height: 800 },
          format: 'png',
          syntheticCapture: true,
          status: 'captured',
          timestamp: new Date().toISOString()
        };
      }

      case 'evaluate_js': {
        return {
          result: `Evaluated "${script || ''}" on ${this.currentUrl}`,
          url: this.currentUrl,
          ok: true
        };
      }

      default:
        return { error: `Unknown browser action: ${action}` };
    }
  }

  _extractElements(html) {
    const elements = [];
    const tagRegex = /<([a-zA-Z0-9]+)([^>]*)>([^<]*)<\/\1>/g;
    let match;
    while ((match = tagRegex.exec(html)) !== null) {
      const tag = match[1];
      const attrs = match[2];
      const text = match[3].trim();
      const idMatch = attrs.match(/id=["']([^"']+)["']/);
      const classMatch = attrs.match(/class=["']([^"']+)["']/);
      elements.push({
        tag,
        id: idMatch ? idMatch[1] : null,
        classes: classMatch ? classMatch[1].split(/\s+/) : [],
        text: text.slice(0, 50)
      });
    }
    return elements;
  }
}

module.exports = { BrowserInspectorTool };
