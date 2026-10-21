(function (root) {
  const config = {
    apiBase: '',
    policyVersion: '2026-10-v1',
    sessionDays: 30,
  };
  if (root?.document) {
    let apiOrigin = '';
    if (config.apiBase) {
      try {
        const parsed = new URL(config.apiBase, root.location.href);
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') apiOrigin = parsed.origin;
        else config.apiBase = '';
      } catch { config.apiBase = ''; }
    }
    const policy = [
      "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:", `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''}`,
      "font-src 'self' data:", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
    ].join('; ');
    const meta = root.document.createElement('meta');
    meta.httpEquiv = 'Content-Security-Policy'; meta.content = policy;
    root.document.head.append(meta);
  }
  if (typeof module === 'object' && module.exports) module.exports = config;
  if (root) root.CHECKMED_CONFIG = config;
})(typeof globalThis !== 'undefined' ? globalThis : this);
