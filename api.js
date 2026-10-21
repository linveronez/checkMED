(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CheckMedApi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const AUTH_KEY = 'checkmed.auth';
  const SESSION_MESSAGE = 'Sua sessão expirou. Entre de novo; seus dados deste aparelho continuam aqui.';

  function createClient({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    storage = globalThis.localStorage,
    apiBase = globalThis.CHECKMED_CONFIG?.apiBase || '',
    timeoutMs = 15000,
    onUnauthorized = () => {},
  } = {}) {
    function authRecord() {
      try { return JSON.parse(storage?.getItem(AUTH_KEY) || 'null'); }
      catch { return null; }
    }

    async function request(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
      if (!apiBase) throw { status: 0, error: 'api_not_configured', message: 'A conta estará disponível quando o servidor estiver configurado.' };
      if (typeof fetchImpl !== 'function') throw { status: 0, error: 'network_error', message: 'Não foi possível conectar agora. Seus dados continuam neste aparelho.' };
      const requestHeaders = { Accept: 'application/json', ...headers };
      if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
      const session = auth ? authRecord() : null;
      if (auth && session?.token) requestHeaders.Authorization = `Bearer ${session.token}`;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller?.abort();
          reject({ status: 0, error: 'timeout', message: 'A conexão demorou mais que o esperado. Tente novamente.' });
        }, timeoutMs);
      });
      try {
        const response = await Promise.race([fetchImpl(`${apiBase.replace(/\/$/, '')}/api${path.startsWith('/') ? path : `/${path}`}`, {
          method,
          headers: requestHeaders,
          body: body === undefined ? undefined : JSON.stringify(body),
          cache: 'no-store',
          signal: controller?.signal,
        }), timeout]);
        let data = null;
        if (response.status !== 204) {
          try { data = await response.json(); }
          catch { data = null; }
        }
        if (response.status === 401) {
          storage?.removeItem(AUTH_KEY);
          onUnauthorized(SESSION_MESSAGE);
        }
        if (!response.ok) {
          throw {
            status: response.status,
            error: data?.error || 'request_failed',
            message: response.status === 401 ? SESSION_MESSAGE : data?.message || 'Não foi possível concluir agora. Tente novamente.',
            ...(Number.isInteger(data?.serverVersion) ? { serverVersion: data.serverVersion } : {}),
          };
        }
        return data;
      } catch (error) {
        if (error && typeof error === 'object' && Number.isInteger(error.status)) throw error;
        if (error?.name === 'AbortError') throw { status: 0, error: 'timeout', message: 'A conexão demorou mais que o esperado. Tente novamente.' };
        throw { status: 0, error: 'network_error', message: 'Sem conexão. Seus dados continuam salvos neste aparelho.' };
      } finally {
        clearTimeout(timer);
      }
    }

    return { request, authRecord };
  }

  return { createClient, AUTH_KEY, SESSION_MESSAGE };
});
