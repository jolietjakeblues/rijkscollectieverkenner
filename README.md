# Rijkscollectie Verkenner

Klein facetzoek-prototype op de kunst- en objectencollectie van de Rijksdienst voor het Cultureel Erfgoed (RCE), qua patroon geïnspireerd op [Sampo-UI](https://github.com/SemanticComputing/sampo-ui). Filtert op maker, genre, materiaal, periode (zowel de 6-emmers-histogram als een los, combineerbaar van/tot-jaartalveld) en locatie; actieve filters staan als verwijderbare chips boven de resultaten. Toont resultaten als tabel of galerij, met rechtenvermelding per werk en per afbeelding, plus een Analyse-tab met een gestapelde genre×periode-grafiek over de hele collectie.

Maker, genre, materiaal en locatie zijn niet alleen filters maar ook eigen, klikbare/deelbare pagina's (`#/entity/<dim>/<id>`) met alle werken binnen die waarde — een klein stapje richting "elke entiteit is een eigen dereferenceerbare resource" in plaats van alleen een facetzoek-UI over een platte tabel. Makers met een `schema:sameAs`-link naar RKDartists groeperen op die RKDartists-identiteit (met geboorte-/sterftejaar en beroep op de makerpagina) in plaats van op de letterlijke naamstring; makers zonder die link vallen terug op naamgroepering.

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

`SITE_USER`/`SITE_PASSWORD` zetten een simpele HTTP Basic Auth-login voor de hele site (zowel de pagina als `/api/sparql`) — geen account- of sessiesysteem, gewoon één gebruikersnaam/wachtwoord dat de browser opvraagt. Over HTTPS is dat verkeer gewoon TLS-versleuteld (Basic Auth is *geen* onversleuteld protocol — zie [RFC 7617](https://www.rfc-editor.org/rfc/rfc7617.html)); wat er wél ontbreekt is lockout/backoff na foutieve pogingen, sessieverval en per-gebruiker herroepbaarheid. Het is een "houd dit prototype uit toevallig zoek-/crawlverkeer"-gate, geen vervanging voor echte toegangscontrole.

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

De Rijkscollectie-endpoint stond aanvankelijk open, maar gaat achter een API-token. Een los HTML-bestand kan geen secret veilig bewaren (zichtbaar via "bekijk paginabron"), dus loopt elke SPARQL-call van de frontend via `runQuery()` in `index.html` naar het same-origin pad `/api/sparql`, dat de Worker (`worker.js`) doorstuurt naar de echte endpoint met het token. De proxy accepteert alleen `SELECT`/`ASK`-queries tot 4000 tekens en weigert SPARQL Update-keywords (INSERT/DELETE/DROP/...) als echte syntax — geciteerde zoektermen die zo'n woord toevallig bevatten worden niet geblokkeerd.

## Bekende beperkingen

- **Geen begrenzing op querykosten of frequentie.** Een ingelogde gebruiker kan nog steeds een willekeurige, duur uit te voeren `SELECT` sturen (bv. een brede ongeïndexeerde `CONTAINS`-scan) — de lengte-/vormcontrole in `worker.js` beperkt niet hoeveel werk een geldige query veroorzaakt. De robuuste oplossing is vaste querysjablonen server-side (de Worker bouwt zelf de SPARQL uit een beperkte set bekende parameters, neemt nooit ruwe querytekst van de client aan) — een grotere herschrijving dan een losse fix. Rate-limiting zelf vraagt een Cloudflare Rate Limiting-regel (dashboard, Security → WAF) of een Durable-Object-teller; een stateless Worker kan dat niet betrouwbaar zelf bijhouden.
- **Makers zijn slechts gedeeltelijk gededupliceerd tot één persoonsidentiteit.** `schema:creator`-nodes krijgen een eigen URI per werk, ook voor dezelfde echte persoon. Voor makers met een `schema:sameAs`-link naar RKDartists (ca. 61% van de makers, live gemeten) groepeert de makerpagina op die RKDartists-URI — een echte, betrouwbare persoons-ID. Voor de resterende ~39% zonder RKDartists-link valt de pagina terug op de letterlijke naamstring: naamgenoten vallen daar nog samen, schrijfvarianten blijven gescheiden.
- **Facetaantallen en de Analyse-tab zijn collectiebreed**, niet herberekend binnen de huidige filterselectie (staat ook zo in de UI vermeld) — sommige facetcombinaties kunnen dus 0 resultaten opleveren ondanks een aantal > 0, en de genre×periode-grafiek verandert niet mee met actieve filters.
