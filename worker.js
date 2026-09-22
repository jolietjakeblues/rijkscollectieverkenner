// Proxies SPARQL queries to the RCE Rijkscollectie endpoint, attaching the API token
// server-side. The token lives only in the RCE_TOKEN secret (wrangler secret put) --
// never in the static frontend, which only ever talks to same-origin /api/sparql.
const UPSTREAM = 'https://api.linkeddata.cultureelerfgoed.nl/datasets/rce/rijkscollectie-rce/sparql';

// Single-user HTTP Basic Auth gate in front of the whole site (assets + API), driven by
// the SITE_USER / SITE_PASSWORD secrets -- not hardcoded here, so a plain `wrangler secret
// put` change rotates the login without touching or redeploying code. Not meant as real
// access control (Basic Auth sends credentials in the clear on every request, base64 is
// not encryption, and there's no rate limiting), just a simple "don't show up in casual
// search/crawl traffic" gate on an otherwise public prototype.
function checkAuth(request, env) {
  const header = request.headers.get('Authorization');
  if (!header || !header.startsWith('Basic ')) return false;
  const [user, pass] = atob(header.slice(6)).split(':');
  return user === env.SITE_USER && pass === env.SITE_PASSWORD;
}

function unauthorized() {
  return new Response('Authenticatie vereist', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Rijkscollectie Verkenner"' }
  });
}

// The proxy forwards the caller's raw query text with the token attached -- without a
// check here, anyone who can reach /api/sparql (which, behind Basic Auth, is any logged-
// in user) could use the app's own token for arbitrary SPARQL, not just what this app
// needs. This restricts it to the two query forms and general shape the frontend
// actually sends; it does NOT rate-limit -- that needs a Cloudflare Rate Limiting rule
// (dashboard, Security > WAF) or a Durable-Object-backed counter, since a stateless
// Worker invocation can't reliably count requests across Cloudflare's edge on its own.
const MAX_QUERY_LENGTH = 4000; // generous headroom over this app's own queries (well under 2KB)
const MUTATION_KEYWORDS = /\b(INSERT|DELETE|LOAD|CLEAR|DROP|CREATE|COPY|MOVE|ADD)\b/i;

function isAllowedQuery(query) {
  if (typeof query !== 'string' || !query.trim()) return false;
  if (query.length > MAX_QUERY_LENGTH) return false;
  if (MUTATION_KEYWORDS.test(query)) return false;
  const stripped = query
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
