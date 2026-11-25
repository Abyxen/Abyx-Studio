'use strict';

function isLoopbackHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function validateLocalRequest(req, port) {
  const rawHost = req.headers.host;
  if (!rawHost) return { ok: false, status: 400, error: 'Host header required' };
  let hostUrl;
  try { hostUrl = new URL(`http://${rawHost}`); } catch (_) { return { ok: false, status: 400, error: 'Invalid Host header' }; }
  if (!isLoopbackHost(hostUrl.hostname) || (hostUrl.port && Number(hostUrl.port) !== Number(port))) {
    return { ok: false, status: 403, error: 'Host is not permitted' };
  }

  const origin = req.headers.origin;
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') return { ok: false, status: 403, error: 'Cross-site request blocked' };
  if (origin) {
    let originUrl;
    try { originUrl = new URL(origin); } catch (_) { return { ok: false, status: 403, error: 'Origin is not permitted' }; }
    const originPort = Number(originUrl.port || (originUrl.protocol === 'https:' ? 443 : 80));
    const localHttp = ['http:', 'https:'].includes(originUrl.protocol) && isLoopbackHost(originUrl.hostname) && originPort === Number(port);
    const tauriWebview = !originUrl.port &&
      ((originUrl.protocol === 'tauri:' && originUrl.hostname === 'localhost') ||
       (['http:', 'https:'].includes(originUrl.protocol) && originUrl.hostname === 'tauri.localhost'));
    if (!localHttp && !tauriWebview) return { ok: false, status: 403, error: 'Cross-origin request blocked' };
  } else if (req.headers.referer) {
    let refererUrl;
    try { refererUrl = new URL(req.headers.referer); } catch (_) { return { ok: false, status: 403, error: 'Referer is not permitted' }; }
    const refererPort = Number(refererUrl.port || (refererUrl.protocol === 'https:' ? 443 : 80));
    const sameLocalPage = ['http:', 'https:'].includes(refererUrl.protocol) && isLoopbackHost(refererUrl.hostname) && refererPort === Number(port);
    const tauriPage = !refererUrl.port && refererUrl.protocol === 'tauri:' && refererUrl.hostname === 'localhost';
    if (!sameLocalPage && !tauriPage) return { ok: false, status: 403, error: 'Cross-origin request blocked' };
  }
  return { ok: true };
}

function redactError(error) {
  const message = typeof error?.message === 'string' ? error.message : 'Request failed';
  if (/api.?key|token|secret|password|credential|authorization/i.test(message)) return 'Request failed';
  return message
    .replace(/(?:api.?key|token|secret|password|credential|authorization)\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|AKIA[A-Z0-9]{16}|Bearer\s+[^\s,;]+|eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/gi, '[redacted]')
    .replace(/[A-Z]:\\[^\s"']+/g, '[path]')
    .replace(/(?:\/[^\s"']+){2,}/g, '[path]');
}

module.exports = { isLoopbackHost, validateLocalRequest, redactError };
