function formatLabel(value) {
  if (typeof value !== 'string') return String(value).toLowerCase();
  return value.toLowerCase();
}

module.exports = { formatLabel };
