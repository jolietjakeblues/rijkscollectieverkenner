// Proxies SPARQL queries to the RCE Rijkscollectie endpoint, attaching the API token
// server-side. The token lives only in the RCE_TOKEN secret (wrangler secret put) --
// never in the static frontend, which only ever talks to same-origin /api/sparql.
const UPSTREAM = 'https://api.linkeddata.cultureelerfgoed.nl/datasets/rce/rijkscollectie-rce/sparql';

// Single-user gate in front of the whole site (assets + API), driven by the SITE_USER /
// SITE_PASSWORD secrets -- not hardcoded here, so a plain `wrangler secret put` change
// rotates the login without touching or redeploying code.
//
// This used to be HTTP Basic Auth (the browser's own native credentials prompt). Switched
// to a self-rendered login form + signed session cookie because that native prompt turned
// out to be unreliable in practice: on at least two separate work laptops, a browser/device
// policy silently swallowed the prompt, leaving the visitor stuck on a bare "Authenticatie
// vereist" page with nothing to fill in and no way for them (or us) to make the browser
// show it. A same-origin HTML form has no such dependency -- it always renders.
//
// Session model: a cookie holding "<expiresAtMs>.<hmac>", HMAC-SHA256'd with SITE_PASSWORD
// as the key (reusing the existing secret instead of provisioning a second one -- means
// rotating SITE_PASSWORD also invalidates every existing session, which is a feature here,
// not a bug). No server-side session store: the cookie's signature IS the proof, so this
// stays a stateless Worker with no KV/Durable Object dependency. What this still lacks,
// same as Basic Auth before it: lockout/backoff after repeated failed attempts, and
// per-session revocation short of rotating the secret (which invalidates ALL sessions, not
// just one). Still a "keep this prototype out of casual/crawl traffic" gate, not a
// substitute for real access control.
const SESSION_COOKIE = 'rcv_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 dagen

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const eq = part.indexOf('=');
    if (eq === -1) return;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  });
  return out;
}

// `Secure` is skipped over plain HTTP (only `wrangler dev` on localhost hits this) --
// browsers vary in whether they'll store a Secure cookie for http://localhost at all, and
// production is always HTTPS via Cloudflare, so this never weakens the deployed site.
async function makeSessionCookie(env, isHttps) {
  const expires = Date.now() + SESSION_MAX_AGE * 1000;
  const sig = await hmacHex(env.SITE_PASSWORD, String(expires));
  return SESSION_COOKIE + '=' + expires + '.' + sig + '; Path=/; HttpOnly;' + (isHttps ? ' Secure;' : '') + ' SameSite=Lax; Max-Age=' + SESSION_MAX_AGE;
}

async function hasValidSession(request, env) {
  if (!env.SITE_USER || !env.SITE_PASSWORD) return false; // fail closed if secrets were never set
  const raw = parseCookies(request.headers.get('Cookie'))[SESSION_COOKIE];
  if (!raw) return false;
  const dot = raw.indexOf('.');
  if (dot === -1) return false;
  const expires = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!/^\d+$/.test(expires) || Number(expires) < Date.now()) return false;
  const expected = await hmacHex(env.SITE_PASSWORD, expires);
  return timingSafeEqual(sig, expected);
}

function loginPageHtml(showError) {
  return '<!doctype html>\n' +
'<html lang="nl" data-theme="dark">\n' +
'<head>\n' +
'<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'<title>Inloggen &mdash; Rijkscollectie Verkenner</title>\n' +
'<style>\n' +
'  :root { --paper:#17130d; --ink:#ece4d4; --muted:#ab9d84; --border:#362c1e; --gold:#f0c14e; --surface:#201a12; }\n' +
'  * { box-sizing: border-box; }\n' +
'  body { background: var(--paper); color: var(--ink); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }\n' +
'  form { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 28px 26px; width: 100%; max-width: 320px; }\n' +
'  h1 { font-size: 17px; margin: 0 0 18px; }\n' +
'  label { display: block; font-size: 12px; color: var(--muted); margin: 14px 0 4px; }\n' +
'  input { width: 100%; padding: 9px 10px; border: 1px solid var(--border); border-radius: 4px; background: var(--paper); color: var(--ink); font-size: 14px; }\n' +
'  button { width: 100%; margin-top: 20px; padding: 10px; border: none; border-radius: 4px; background: var(--gold); color: #241d14; font-weight: 600; cursor: pointer; font-size: 14px; }\n' +
'  button:hover { opacity: 0.9; }\n' +
'  .err { background: #3a1d17; border: 1px solid #7a3226; color: #f3b4a4; padding: 8px 10px; border-radius: 4px; font-size: 12.5px; margin-bottom: 4px; }\n' +
'</style>\n' +
'</head>\n' +
'<body>\n' +
'<form method="post" action="/login">\n' +
'  <h1>Rijkscollectie Verkenner</h1>\n' +
(showError ? '  <p class="err">Onjuiste gebruikersnaam of wachtwoord.</p>\n' : '') +
'  <label for="u">Gebruikersnaam</label>\n' +
'  <input id="u" name="username" type="text" autocomplete="username" required autofocus>\n' +
'  <label for="p">Wachtwoord</label>\n' +
'  <input id="p" name="password" type="password" autocomplete="current-password" required>\n' +
'  <button type="submit">Inloggen</button>\n' +
'</form>\n' +
'</body>\n' +
'</html>';
}

function loginPageResponse(showError) {
  return new Response(loginPageHtml(showError), { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// The proxy forwards the caller's query text with the token attached -- without a check
// here, any logged-in user could use the app's own token for arbitrary SPARQL, not just
// what this app needs. This restricts it to the query FORM (SELECT/ASK, length-capped)
// and rejects SPARQL Update keywords used as actual syntax -- but NOT as substrings of a
// quoted search term (an earlier version matched "drop" inside FILTER(CONTAINS(...,
// "drop")) and rejected a legitimate title search; string literals are stripped before
// the keyword check now). It still does NOT limit how much work an accepted SELECT can
// cause (a broad, unindexed CONTAINS scan is still a valid SELECT), and it does NOT
// rate-limit -- both would need either hand-written query templates on the server (the
// proxy builds the SPARQL itself from a small set of known parameters, never taking raw
// query text from the client -- the robust fix, but a bigger rewrite than this pass) or,
// for rate-limiting specifically, a Cloudflare Rate Limiting rule (dashboard, Security >
// WAF) or a Durable-Object-backed counter, since a stateless Worker invocation can't
// reliably count requests across Cloudflare's edge on its own.
const MAX_QUERY_LENGTH = 4000; // generous headroom over this app's own queries (well under 2KB)
const MUTATION_KEYWORDS = /\b(INSERT|DELETE|LOAD|CLEAR|DROP|CREATE|COPY|MOVE|ADD)\b/i;

function stripStringLiterals(query) {
  // This app only ever generates plain single/double-quoted literals (no triple-quoted
  // or long-form strings), so a simple non-greedy match covering both is enough to keep
  // user-typed search text out of the keyword check below.
  return query.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

function isAllowedQuery(query) {
  if (typeof query !== 'string' || !query.trim()) return false;
  if (query.length > MAX_QUERY_LENGTH) return false;
  const withoutStrings = stripStringLiterals(query);
  if (MUTATION_KEYWORDS.test(withoutStrings)) return false;
  const stripped = withoutStrings
    .replace(/PREFIX\s+[^:]*:\s*<[^>]*>/gi, '')
    .replace(/BASE\s*<[^>]*>/gi, '')
    .trim();
  return /^(SELECT|ASK)\b/i.test(stripped);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/login' && request.method === 'POST') {
      const form = await request.formData();
      const user = form.get('username') || '';
      const pass = form.get('password') || '';
      if (env.SITE_USER && env.SITE_PASSWORD && user === env.SITE_USER && pass === env.SITE_PASSWORD) {
        return new Response(null, { status: 303, headers: { 'Location': '/', 'Set-Cookie': await makeSessionCookie(env, url.protocol === 'https:') } });
      }
      return loginPageResponse(true);
    }

    if (!(await hasValidSession(request, env))) return loginPageResponse(false);

    if (url.pathname === '/api/sparql') {
      const query = url.searchParams.get('query');
      if (!isAllowedQuery(query)) {
        return new Response('Query not allowed: only SELECT/ASK queries up to ' + MAX_QUERY_LENGTH + ' characters are proxied.', { status: 400 });
      }

      const upstream = new URL(UPSTREAM);
      upstream.searchParams.set('query', query);

      const upstreamResponse = await fetch(upstream, {
        headers: {
          'Accept': 'application/sparql-results+json',
          'Authorization': 'Bearer ' + env.RCE_TOKEN
        }
      });

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: {
          'Content-Type': upstreamResponse.headers.get('Content-Type') || 'application/sparql-results+json'
        }
      });
    }

    return env.ASSETS.fetch(request);
  }
};
