(function (root) {
  const config = {
    apiBase: '',
    policyVersion: '2026-10-v1',
    sessionDays: 30,
  };
  if (typeof module === 'object' && module.exports) module.exports = config;
  if (root) root.CHECKMED_CONFIG = config;
})(typeof globalThis !== 'undefined' ? globalThis : this);
