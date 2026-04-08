(function (global) {
  const TOKEN_KEY = "avs_token";
  const USER_KEY = "avs_user";

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setSession(token, user) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || "null");
    } catch {
      return null;
    }
  }

  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    if (opts.body && typeof opts.body === "object" && !(opts.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      opts = Object.assign({}, opts, { body: JSON.stringify(opts.body) });
    }
    const t = getToken();
    if (t) headers["Authorization"] = "Bearer " + t;
    const r = await fetch(path, Object.assign({}, opts, { headers }));
    const text = await r.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!r.ok) {
      const err = new Error((data && data.error) || r.statusText || "Error");
      err.status = r.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  global.AVS = { getToken, setSession, getUser, api };
})(typeof window !== "undefined" ? window : globalThis);
