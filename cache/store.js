// Simple in-memory TTL cache
const store = new Map();

export function set(key, value, ttlMs) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function del(key) {
  store.delete(key);
}

export function keys() {
  return Array.from(store.keys());
}

export function size() {
  return store.size;
}
