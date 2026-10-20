// Optional AI provider client (OpenAI-compatible chat completions).
// Used only by the nonclinical planner and review endpoints. Every failure is reported as
// { ok: false, reason } so callers can fall back to deterministic output.
'use strict';

const TIMEOUT_MS = 8000;
const MAX_RESPONSE_CHARS = 20000;

function config(env) {
  const key = env.AI_API_KEY;
  const url = env.AI_API_URL;
  if (!key || !url) return { ok: false, reason: 'AI not configured' };
  let parsed;
  try { parsed = new URL(url); } catch (e) { return { ok: false, reason: 'AI endpoint misconfigured' }; }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'AI endpoint must use HTTPS' };
  const t = Number(env.AI_TIMEOUT_MS);
  const timeoutMs = t >= 100 && t <= 30000 ? t : TIMEOUT_MS;
  return { ok: true, key, url, model: env.AI_MODEL || 'gpt-4o-mini', timeoutMs };
}

async function chat(env, system, user, temperature) {
  const cfg = config(env);
  if (!cfg.ok) return cfg;
  let res;
  try {
    res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
      body: JSON.stringify({
        model: cfg.model,
        temperature,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
      }),
      signal: AbortSignal.timeout(cfg.timeoutMs)
    });
  } catch (e) {
    return { ok: false, reason: e && e.name === 'TimeoutError' ? 'AI provider timed out' : 'AI provider unreachable' };
  }
  if (!res.ok) return { ok: false, reason: 'AI provider returned HTTP ' + res.status };
  let text;
  try { text = await res.text(); } catch (e) { return { ok: false, reason: 'AI provider response unreadable' }; }
  if (text.length > MAX_RESPONSE_CHARS) return { ok: false, reason: 'AI provider response too large' };
  let data;
  try { data = JSON.parse(text); } catch (e) { return { ok: false, reason: 'AI provider response was not JSON' }; }
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (typeof content !== 'string' || !content.trim()) return { ok: false, reason: 'AI provider returned no content' };
  return { ok: true, content: content.trim() };
}

module.exports = { chat, config, TIMEOUT_MS };
