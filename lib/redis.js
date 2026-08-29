import { Redis } from '@upstash/redis';

// Works with either the Vercel <-> Upstash integration env var names
// (KV_REST_API_URL / KV_REST_API_TOKEN) or plain Upstash env var names
// (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN) — whichever exists.
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  console.warn(
    '[harf-ism] Redis env vars are missing. Add an Upstash Redis (or Vercel KV) ' +
    'integration to your Vercel project — see README.md.'
  );
}

export const redis = new Redis({ url, token });

// --- helpers: some Upstash SDK versions auto-parse JSON, some don't. ---
// These wrappers normalize everything so the rest of the app never has to think about it.

function toStorable(val) {
  return JSON.stringify(val);
}

function fromStorable(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'object') return val; // already parsed by the SDK
  try { return JSON.parse(val); } catch (e) { return null; }
}

export async function getJSON(key) {
  const val = await redis.get(key);
  return fromStorable(val);
}

export async function setJSON(key, val, ttlSeconds) {
  if (ttlSeconds) {
    await redis.set(key, toStorable(val), { ex: ttlSeconds });
  } else {
    await redis.set(key, toStorable(val));
  }
}

// Atomic "set only if not already present" — used for first-to-finish round winner claims.
export async function setJSONIfAbsent(key, val, ttlSeconds) {
  const opts = { nx: true };
  if (ttlSeconds) opts.ex = ttlSeconds;
  const res = await redis.set(key, toStorable(val), opts);
  return res === 'OK' || res === true; // true = we won the race and set it
}

export async function hsetJSON(key, field, val, ttlSeconds) {
  await redis.hset(key, { [field]: toStorable(val) });
  if (ttlSeconds) await redis.expire(key, ttlSeconds);
}

export async function hgetJSON(key, field) {
  const val = await redis.hget(key, field);
  return fromStorable(val);
}

export async function hgetAllJSON(key) {
  const raw = await redis.hgetall(key);
  if (!raw) return {};
  const out = {};
  for (const [field, val] of Object.entries(raw)) {
    out[field] = fromStorable(val);
  }
  return out;
}
