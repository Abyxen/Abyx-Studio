/**
 * Genuine Playwright Browser Automation Tool
 * Controls headless Chromium: navigates, clicks, types, scrolls, submits forms,
 * captures full-page screenshots, inspects DOM trees, and manages browser sessions.
 */

const path = require('node:path');
const fs = require('node:fs');

class PlaywrightBrowserTool {
  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.name = 'playwright_browser';
    this.description = 'Authentic browser automation: navigates real websites, clicks elements, fills forms, captures screenshots, and inspects live DOM.';
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  getSchema() {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['navigate', 'click', 'type', 'scroll', 'screenshot', 'inspect_dom', 'close'],
          description: 'Browser action to execute'
        },
        url: { type: 'string', description: 'URL or local file path to load' },
        selector: { type: 'string', description: 'CSS / text selector for elements' },
        text: { type: 'string', description: 'Text to type into input fields' },
        outputPath: { type: 'string', description: 'File path for screenshot' },
        direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction' }
      },
      required: ['action']
    };
  }

  async _ensureBrowser() {
    if (!this.browser) {
      const { chromium } = require('playwright');
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 }
      });
      this.page = await this.context.newPage();
    }
    return this.page;
  }

  async execute(args) {
    const { action, url, selector, text, outputPath, direction } = args;

    try {
      const page = await this._ensureBrowser();

      switch (action) {
        case 'navigate': {
          if (!url) return { error: 'url is required for navigate' };
          let targetUrl = url;
          if (fs.existsSync(path.resolve(this.workspaceRoot, url))) {
            targetUrl = `file://${path.resolve(this.workspaceRoot, url).replace(/\\/g, '/')}`;
          }
          const response = await page.goto(targetUrl, { waitUntil: 'load', timeout: 30000 });
          const title = await page.title();
          const currentUrl = page.url();
          return {
            status: 'loaded',
            url: currentUrl,
            title,
            httpStatus: response ? response.status() : 200
          };
        }

        case 'click': {
          if (!selector) return { error: 'selector is required for click' };
          await page.click(selector, { timeout: 10000 });
          return { status: 'clicked', selector, currentUrl: page.url() };
        }

        case 'type': {
          if (!selector || text === undefined) return { error: 'selector and text are required for type' };
          await page.fill(selector, text, { timeout: 10000 });
          return { status: 'typed', selector, charactersTyped: text.length };
        }

        case 'scroll': {
          const delta = direction === 'up' ? -500 : 500;
          await page.evaluate((y) => window.scrollBy(0, y), delta);
          return { status: 'scrolled', direction: direction || 'down' };
        }

        case 'screenshot': {
          const shotRelPath = outputPath || 'screenshot.png';
          const shotAbsPath = path.resolve(this.workspaceRoot, shotRelPath);
          fs.mkdirSync(path.dirname(shotAbsPath), { recursive: true });
          await page.screenshot({ path: shotAbsPath, fullPage: true });
          return {
            status: 'captured',
            path: shotRelPath,
            bytes: fs.statSync(shotAbsPath).size
          };
        }

        case 'inspect_dom': {
          const sel = selector || 'body';
          const element = await page.$(sel);
          if (!element) return { found: false, selector: sel };
          const innerText = await element.innerText();
          const html = await element.innerHTML();
          return {
            found: true,
            selector: sel,
            textSnippet: innerText.slice(0, 500),
            htmlLength: html.length
          };
        }

        case 'close': {
          await this.close();
          return { status: 'closed' };
        }

        default:
          return { error: `Unknown browser action: ${action}` };
      }
    } catch (err) {
      return { error: `Playwright error: ${err.message}` };
    }
  }

  async close() {
    if (this.browser) {
      try { await this.browser.close(); } catch (_) {}
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }
}

module.exports = { PlaywrightBrowserTool };
