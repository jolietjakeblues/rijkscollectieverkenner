// Proxies SPARQL queries to the RCE Rijkscollectie endpoint, attaching the API token
// server-side. The token lives only in the RCE_TOKEN secret (wrangler secret put) --
// never in the static frontend, which only ever talks to same-origin /api/sparql.
const UPSTREAM = 'https://api.linkeddata.cultureelerfgoed.nl/datasets/rce/rijkscollectie-rce/sparql';

// Single-user HTTP Basic Auth gate in front of the whole site (assets + API), driven by
// the SITE_USER / SITE_PASSWORD secrets -- not hardcoded here, so a plain `wrangler secret
// put` change rotates the login without touching or redeploying code.
//
// Over HTTPS the whole request (URL, headers, including Authorization) is TLS-encrypted,
// so Basic Auth credentials are NOT sent "in the clear" here -- that was wrong in an
// earlier version of this comment (see RFC 7617). What Basic Auth genuinely lacks: no
// lockout/backoff after repeated failed attempts, no session expiry or revocation short
// of rotating the secret, and the browser resends the same credentials on every request
// for as long as the tab believes it's logged in. It's a "keep this prototype out of
// casual/crawl traffic" gate, not a substitute for real access control.
function checkAuth(request, env) {
  // If either secret was never set, env.SITE_USER/env.SITE_PASSWORD are `undefined` --
  // and a request with no ':' in its decoded credentials also destructures its `pass` to
  // `undefined` (single-element array from .split(':')). Comparing undefined === undefined
  // would then grant access to anyone who simply omits a password. Fail closed instead.
  if (!env.SITE_USER || !env.SITE_PASSWORD) return false;

  const header = request.headers.get('Authorization');
  if (!header || !header.startsWith('Basic ')) return false;

  let decoded;
  try {
    decoded = atob(header.slice(6));
  } catch (e) {
    return false; // malformed base64
  }

  // Split on the FIRST ':' only, so a password containing ':' isn't truncated.
  const sep = decoded.indexOf(':');
  if (sep === -1) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);

  return user === env.SITE_USER && pass === env.SITE_PASSWORD;
}

function unauthorized() {
  return new Response('Authenticatie vereist', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Rijkscollectie Verkenner"' }
  });
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
    if (!checkAuth(request, env)) return unauthorized();

    const url = new URL(request.url);

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
