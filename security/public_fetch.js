'use strict';

const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

const blocked = new net.BlockList();
for (const [range, prefix, type] of [
  ['0.0.0.0', 8, 'ipv4'], ['10.0.0.0', 8, 'ipv4'], ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'], ['169.254.0.0', 16, 'ipv4'], ['172.16.0.0', 12, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'], ['192.0.2.0', 24, 'ipv4'], ['192.88.99.0', 24, 'ipv4'], ['192.168.0.0', 16, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'], ['198.51.100.0', 24, 'ipv4'], ['203.0.113.0', 24, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'], ['240.0.0.0', 4, 'ipv4'],
  ['::', 128, 'ipv6'], ['::1', 128, 'ipv6'],
  ['64:ff9b::', 96, 'ipv6'], ['100::', 64, 'ipv6'], ['2001::', 23, 'ipv6'], ['2001:db8::', 32, 'ipv6'], ['2002::', 16, 'ipv6'],
  ['fc00::', 7, 'ipv6'], ['fe80::', 10, 'ipv6'], ['ff00::', 8, 'ipv6']
]) blocked.addSubnet(range, prefix, type);

function isPublicAddress(address) {
  const family = net.isIP(address);
  if (!family) return false;
  if (family === 6 && address.toLowerCase().startsWith('::ffff:')) {
    const mapped = address.slice(7);
    if (net.isIP(mapped) === 4) return isPublicAddress(mapped);
  }
  return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

async function resolvePublicHost(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!normalized || normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) {
    throw new Error('Local network targets are not allowed');
  }
  const literalFamily = net.isIP(normalized);
  const addresses = literalFamily
    ? [{ address: normalized, family: literalFamily }]
    : await dns.lookup(normalized, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
    throw new Error('Host resolves to a non-public network address');
  }
  return addresses;
}

function requestPinned(url, addresses, { timeoutMs = 15000, maxBytes = 8 * 1024 * 1024, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const chosen = addresses[0];
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const req = transport.request(url, {
      method: 'GET',
      headers: { 'User-Agent': 'ABYX/1.0', Accept: '*/*', ...headers },
      lookup: (_hostname, options, callback) => {
        if (options?.all) callback(null, addresses.map(a => ({ address: a.address, family: a.family })));
        else callback(null, chosen.address, chosen.family);
      },
      ...(net.isIP(hostname) ? {} : { servername: hostname })
    }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(new Error('Remote response exceeds size limit'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({
        status: res.statusCode || 502,
        headers: res.headers,
        body: Buffer.concat(chunks),
        url: url.toString()
      }));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Remote request timed out')));
    req.on('error', reject);
    req.end();
  });
}

async function fetchPublicUrl(input, options = {}) {
  const maxRedirects = Math.min(Math.max(options.maxRedirects ?? 4, 0), 8);
  let url = new URL(input);
  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Only public HTTP and HTTPS URLs without credentials are allowed');
    }
    const addresses = await resolvePublicHost(url.hostname);
    const response = await requestPinned(url, addresses, options);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.location;
    if (!location) return response;
    if (redirects === maxRedirects) throw new Error('Too many redirects');
    url = new URL(location, url);
  }
  throw new Error('Too many redirects');
}

async function fetchPublicResponse(input, options = {}) {
  const result = await fetchPublicUrl(input, options);
  const response = new Response([204, 205, 304].includes(result.status) ? null : result.body, { status: result.status, headers: result.headers });
  Object.defineProperty(response, 'url', { value: result.url });
  return response;
}

module.exports = { fetchPublicUrl, fetchPublicResponse, isPublicAddress, resolvePublicHost };
