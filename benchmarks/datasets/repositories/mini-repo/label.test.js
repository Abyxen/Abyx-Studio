const test = require('node:test');
const assert = require('node:assert/strict');
const { formatLabel } = require('./label');

test('trims outer whitespace', () => assert.equal(formatLabel('  Alpha  '), 'alpha'));
test('uses unknown for empty input', () => assert.equal(formatLabel('   '), 'unknown'));
test('preserves interior spacing', () => assert.equal(formatLabel('Alpha Beta'), 'alpha beta'));
