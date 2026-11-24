// fetch with timeout + JSON parsing + tiny in-memory TTL cache.
const cache = new Map();

export async function getJson(url, { ttlMs = 0, timeoutMs = 10000, headers = {} } = {}) {
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.data;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json', ...headers } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
    const data = await res.json();
    if (ttlMs) cache.set(url, { data, expires: Date.now() + ttlMs });
    return data;
  } finally {
    clearTimeout(t);
  }
}

// Same as getJson, for plain-text responses (CSV).
export async function getText(url, { ttlMs = 0, timeoutMs = 15000, headers = {} } = {}) {
  const k = `text:${url}`;
  const hit = cache.get(k);
  if (hit && hit.expires > Date.now()) return hit.data;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
    const data = await res.text();
    if (ttlMs) cache.set(k, { data, expires: Date.now() + ttlMs });
    return data;
  } finally {
    clearTimeout(t);
  }
}
