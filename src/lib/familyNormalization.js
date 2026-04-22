function normalizeFamilyName(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }

  const computeFamilyMatch = trimmed.match(/^(standard|basic)(?:[_\s-]?)(.+?)family$/i);
  if (!computeFamilyMatch) {
    return trimmed;
  }

  const prefix = String(computeFamilyMatch[1] || '').toLowerCase();
  const rawSuffix = String(computeFamilyMatch[2] || '').replace(/[\s_-]/g, '');
  if (!rawSuffix) {
    return `${prefix}Family`;
  }

  return `${prefix}${rawSuffix.charAt(0).toUpperCase()}${rawSuffix.slice(1)}Family`;
}

module.exports = {
  normalizeFamilyName
};