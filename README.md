# Rijkscollectie Verkenner

Klein facetzoek-prototype op de kunst- en objectencollectie van de Rijksdienst voor het Cultureel Erfgoed (RCE), qua patroon geïnspireerd op [Sampo-UI](https://github.com/SemanticComputing/sampo-ui). Filtert op maker, genre, materiaal, periode en locatie; toont resultaten als tabel of galerij, met rechtenvermelding per werk en per afbeelding.

Cloudflare Worker met Static Assets: `public/` bevat de statische pagina, `worker.js` proxyt SPARQL-queries naar de RCE-endpoint en plakt het API-token er server-side bij (`Authorization: Bearer <token>`) zodat het nooit in de broncode staat.

```
public/index.html          -- de hele app (HTML/CSS/JS, geen build)
public/images/banner.webp
worker.js                  -- proxy-route /api/sparql
wrangler.jsonc
```

## Eenmalig instellen

```bash
npm install
npx wrangler login
npx wrangler secret put RCE_TOKEN
npx wrangler secret put SITE_USER
npx wrangler secret put SITE_PASSWORD
```
(plak de waarde als er om gevraagd wordt — komt nergens in een bestand terecht)

`SITE_USER`/`SITE_PASSWORD` zetten een simpele HTTP Basic Auth-login voor de hele site (zowel de pagina als `/api/sparql`) — geen account- of sessiesysteem, gewoon één gebruikersnaam/wachtwoord dat de browser opvraagt. Geen echte beveiliging (Basic Auth is niet versleuteld, geen rate-limiting), maar houdt het prototype uit toevallig zoekverkeer.

## Lokaal draaien

```bash
npm run dev
```

Dit start `wrangler dev`, dat zowel `public/` serveert als de `/api/sparql`-proxy draait (met het token uit `wrangler secret put`, of lokaal override via een `.dev.vars`-bestand met `RCE_TOKEN=...` — nooit committen, staat al in `.gitignore`).

Let op: `public/index.html` los openen (dubbelklikken) of via `python -m http.server` werkt niet meer voor live data, want `/api/sparql` bestaat dan niet — dat pad wordt alleen door de Worker bediend.

## Deployen

```bash
npm run deploy
```

## Architectuur / waarom een proxy

De Rijkscollectie-endpoint stond aanvankelijk open, maar gaat achter een API-token. Een los HTML-bestand kan geen secret veilig bewaren (zichtbaar via "bekijk paginabron"), dus loopt elke SPARQL-call van de frontend via `runQuery()` in `index.html` naar het same-origin pad `/api/sparql`, dat de Worker (`worker.js`) doorstuurt naar de echte endpoint met het token.
