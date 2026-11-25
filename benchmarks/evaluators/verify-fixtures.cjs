'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const expected = JSON.parse(fs.readFileSync(path.join(root, 'config', 'expected-fixtures.json'), 'utf8'));

function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') { field += '"'; index++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { fields.push(field); field = ''; }
    else field += char;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  fields.push(field);
  return fields;
}

function readCsv(filePath) {
  const [headerLine, ...rows] = fs.readFileSync(filePath, 'utf8').trimEnd().split(/\r?\n/);
  const headers = parseCsvLine(headerLine);
  return rows.map(line => Object.fromEntries(parseCsvLine(line).map((value, index) => [headers[index], value])));
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function verify() {
  const sales = readCsv(path.join(root, 'datasets', 'csv', 'sales.csv'));
  const validSales = sales.filter(row => row.qty !== '');
  const revenueByRegion = {};
  let units = 0;
  for (const row of validSales) {
    const quantity = Number(row.qty);
    const revenue = quantity * Number(row.unit_price);
    units += quantity;
    revenueByRegion[row.region] = (revenueByRegion[row.region] || 0) + revenue;
  }
  const events = JSON.parse(fs.readFileSync(path.join(root, 'datasets', 'json', 'events.json'), 'utf8')).events;
  const xml = fs.readFileSync(path.join(root, 'datasets', 'xml', 'orders.xml'), 'utf8');
  const amounts = [...xml.matchAll(/<amount>(\d+)<\/amount>/g)].map(match => Number(match[1]));
  const result = {
    sales: {
      validRows: validSales.length,
      units,
      revenue: Object.values(revenueByRegion).reduce((sum, value) => sum + value, 0),
      revenueByRegion: Object.fromEntries(Object.entries(revenueByRegion).sort(([left], [right]) => left.localeCompare(right)))
    },
    events: {
      eventCount: events.length,
      numericDurationCount: events.filter(event => Number.isFinite(event.durationMs)).length,
      durationSumMs: events.reduce((sum, event) => sum + (Number.isFinite(event.durationMs) ? event.durationMs : 0), 0),
      successfulCount: events.filter(event => event.ok === true).length,
      failedCount: events.filter(event => event.ok === false).length
    },
    xml: { orderCount: amounts.length, amountTotal: amounts.reduce((sum, amount) => sum + amount, 0) },
    fixtureHashes: {
      filesystem: Object.fromEntries(Object.keys(expected.filesystem).map(relative => [relative, sha256(path.join(root, 'datasets', 'filesystem', 'small-tree', relative))])),
      archives: Object.fromEntries(Object.keys(expected.archives).map(relative => [relative, sha256(path.join(root, 'datasets', 'archives', 'source', relative))]))
    }
  };
  const checks = [
    ['sales', result.sales, expected.sales],
    ['events', result.events, expected.events],
    ['xml', result.xml, expected.xml],
    ['filesystem hashes', result.fixtureHashes.filesystem, expected.filesystem],
    ['archive hashes', result.fixtureHashes.archives, expected.archives]
  ];
  const failures = checks.filter(([, actual, target]) => JSON.stringify(actual) !== JSON.stringify(target));
  return { ok: failures.length === 0, result, failures: failures.map(([name, actual, target]) => ({ name, actual, expected: target })) };
}

if (require.main === module) process.stdout.write(`${JSON.stringify(verify(), null, 2)}\n`);

module.exports = { verify };
