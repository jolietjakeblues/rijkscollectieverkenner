# Van Rijkscollectie Verkenner naar een generiek raamwerk — analyse

Doel van dit document: **nog niet bouwen**, eerst het ontwerp vastleggen — welke keuzes we maken, wat robuust genoeg moet zijn voor een niet-programmerende functioneel beheerder, en wat de handleiding moet bevatten. Pas als dit staat, gaan we (in een apart, generiek benoemde testmap — geen "rijkscollectie"/"rce" in de naam) iets bouwen.

---

## 1. Wat blijft vast, wat wordt config

Ik heb het hele huidige `index.html` doorgelicht (script, ~1150 regels JS). Grofweg drie categorieën:

### A. Blijft vast (de "engine", generiek voor elk schema.org-achtig object-dataset)
- Cloudflare Worker + Static Assets-architectuur, Basic Auth-gate, `/api/sparql`-proxy met lengte-/vorm-check (`worker.js` blijft vrijwel ongewijzigd).
- UI-chrome: facet-sidebar, tabel/galerij/analyse-tabs, pager, filter-chips, entity-pagina's (`#/entity/<dim>/<id>`), reset-knop. Dit is de "Sampo-UI-achtige schil" — precies het herbruikbare deel.
- Styling/thema (CSS-variabelen, licht/donker). Niet in scope om per dataset te configureren — dat is een stap te ver voor "een functioneel beheerder vult een config in"; kleurtjes zijn iets voor een developer die het bestand zelf aanpast.
- Het correlatie-/pack-pattern voor SPARQL `SAMPLE()` (de `packedPair`/`unpackPair`-truc) — een generieke, dataset-onafhankelijke oplossing voor een SPARQL-valkuil, blijft in de engine.

### B. Wordt config (het datamodel van dít dataset)
Dit is het echte werk: SPARQL-predicaten, facetten, periodelogica, tabelkolommen, branding-tekst. Zie schema hieronder.

### C. Optionele "hooks" (dataset-specifieke extra's, mogen ontbreken)
Dingen die bij de Rijkscollectie mooi zijn maar niet bij elk schema.org-dataset horen:
- **RKDartists-makerdedup + biografie** (geboorte/sterfte/beroep, doorlink naar extern persoonsregister). Wordt een optioneel blok per facet (`identityLink`). Ontbreekt het in de config → facet valt terug op gewone literal-groepering, precies zoals nu al de fallback is voor makers zónder RKD-link.
- **Beeldbank-only detailvelden** (documentnummer, afmetingen/`schema:size`). Worden een generieke `detailFields`-lijst in config; leeg = die rijen verschijnen simpelweg niet in de detailweergave.
- **Analyse-tab (dimensie × periode)**: alleen actief als zowel een facet als de periodeconfig aanwezig zijn.

Deze aanpak (kern + optionele hooks die netjes uitschakelen als een veld ontbreekt) is denk ik de juiste balans: echt generiek waar het kan, zonder de Rijkscollectie-specifieke functionaliteit weg te gooien.

---

## 2. Config-schema (concept-ontwerp)

Eén bestand, `config.js`, dat vóór de engine geladen wordt (`<script src="config.js"></script>` boven de hoofd-`<script>`). Rijk becommentarieerd — het bestand zelf IS grotendeels de handleiding (zie §4).

```js
window.APP_CONFIG = {

  // ---------- branding / teksten ----------
  branding: {
    siteTitle: 'Rijkscollectie Verkenner',
    eyebrow: 'Prototype · faceted search',
    bannerImage: 'images/banner.webp',
    bannerAlt: '...',
    introHtml: '...',                    // mag simpele <strong>/<a> bevatten, wordt niet ge-esc'apet
    footerDataLine: 'Data: RCE Rijkscollectie (schema.org-model) via TriplyDB · ververst live, geen cache.',
    endpointLabel: 'RCE Rijkscollectie',
    endpointInfoUrl: 'https://linkeddata.cultureelerfgoed.nl/rce/rijkscollectie-rce/'
  },

  // ---------- SPARQL basis ----------
  sparql: {
    prefixes: 'PREFIX schema: <https://schema.org/>\nPREFIX xsd: <http://www.w3.org/2001/XMLSchema#>',
    rootClass: 'schema:CreativeWork',    // elk item in de dataset is "?s a <rootClass>"
    titlePredicate: 'schema:name',
    urlPredicate: 'schema:url',          // link terug naar het bronrecord
    descriptionPredicate: 'schema:description'
  },

  // ---------- facetten (0..N, willekeurige lengte i.p.v. vaste 4) ----------
  facets: [
    {
      id: 'maker',
      label: 'Maker',
      predicate: 'schema:creator',
      kind: 'nodeLiteral',               // waarde = het label van een gekoppeld node (niet de node-URI zelf)
      nodeLabelPredicate: 'schema:name',
      searchable: true,                  // top-N lijst + live zoeken (grote, open vocabulaire)
      hasEntityPage: true,
      breakdownFacetId: 'genre',         // welke andere facet toont de entity-pagina als "chips"-uitsplitsing
      identityLink: {                    // optioneel — laat weg voor een dataset zonder zo'n koppeling
        sameAsPrefix: 'https://rkd.nl/artists/',
        label: 'RKDartists',
        extraFields: [
          { key: 'birthDate', predicate: 'schema:birthDate', label: 'Geboren' },
          { key: 'deathDate', predicate: 'schema:deathDate', label: 'Overleden' },
          { key: 'occupation', predicate: 'schema:hasOccupation', label: 'Beroep', nodeLabelPredicate: 'schema:name', multivalued: true }
        ]
      }
    },
    { id: 'genre', label: 'Genre', predicate: 'schema:genre', kind: 'uriNode', nodeLabelPredicate: 'schema:name', searchable: false, hasEntityPage: true, breakdownFacetId: 'maker' },
    { id: 'material', label: 'Materiaal', predicate: 'schema:material', kind: 'uriNode', nodeLabelPredicate: 'schema:name', searchable: true, hasEntityPage: true, breakdownFacetId: 'genre' },
    { id: 'location', label: 'Locatie', predicate: 'schema:locationCreated', kind: 'uriNode', nodeLabelPredicate: 'schema:name', searchable: true, hasEntityPage: true, breakdownFacetId: 'maker' }
  ],

  // ---------- periode (optioneel blok — laat weg om periodefacet + analyse-tab uit te schakelen) ----------
  temporal: {
    predicate: 'schema:temporal',
    yearExtractRegex: '^([0-9]{4}).*$',   // hoe een jaartal uit de ruwe waarde te halen
    buckets: [
      { id: '1', label: '≤1799', max: 1799 },
      { id: '2', label: '1800–1899', min: 1800, max: 1899 },
      { id: '3', label: '1900–1949', min: 1900, max: 1949 },
      { id: '4', label: '1950–1979', min: 1950, max: 1979 },
      { id: '5', label: '1980–1999', min: 1980, max: 1999 },
      { id: '6', label: '2000–heden', min: 2000 }
    ]
  },

  // ---------- eenvoudige aan/uit-toggle (optioneel, bv. "heeft afbeelding") ----------
  booleanToggle: {
    label: 'Alleen werken met afbeelding',
    existsPredicate: 'schema:associatedMedia'
  },

  // ---------- media / rechten (optioneel — laat weg om galerij/thumbnails uit te schakelen) ----------
  media: {
    predicate: 'schema:associatedMedia',
    thumbPredicate: 'schema:thumbnailUrl',
    licensePredicate: 'schema:license',
    workLicensePredicate: 'schema:license',
    copyrightHolderPredicate: 'schema:copyrightHolder',
    copyrightHolderLabelPredicate: 'schema:name'
  },

  // ---------- extra detailvelden (optioneel, vrije lijst) ----------
  detailFields: [
    { label: 'Wat', predicate: 'schema:additionalType', nodeLabelPredicate: 'schema:name', multivalued: true },
    { label: 'Afmetingen', predicate: 'schema:size', literalOnly: true },
    { label: 'Documentnummer', predicate: 'schema:identifier', valuePredicate: 'schema:value' }
  ],

  // ---------- tabelkolommen ----------
  tableColumns: [
    { label: 'Titel', field: 'title' },
    { label: 'Maker', field: 'maker' },     // 'field' verwijst naar een facet-id of 'title'/'year'
    { label: 'Genre', field: 'genre' },
    { label: 'Jaar', field: 'year' }
  ],

  // ---------- analyse-tab (optioneel; vereist 'temporal' + een facet-id) ----------
  analysis: { facetId: 'genre', maxSegments: 8 }
};
```

**Rijkscollectie zelf wordt de referentie-config** — dat bestand vullen we als eerste, exact overeenkomend met het huidige gedrag. Zo verandert er functioneel niets aan de live tool op het moment dat we omzetten, en dient het meteen als volledig ingevuld voorbeeld voor de handleiding.

---

## 3. Robuustheid — waar dit misgaat voor een niet-programmeur, en de tegenmaatregel

Een functioneel beheerder die dit invult typt SPARQL-predicaten over uit een dataset die ze zelf niet gebouwd hebben. Typfouten en verkeerde aannames zijn de norm, niet de uitzondering. Drie lagen bescherming:

1. **Config-validatie bij het opstarten van de pagina.** Vóór er ook maar één SPARQL-query de deur uitgaat: controleren dat verplichte velden aanwezig zijn (elke facet heeft `id`/`label`/`predicate`; als `temporal` er is, heeft-ie `predicate` en minstens 1 bucket; etc.). Bij een fout: geen witte pagina of stille console-error, maar een duidelijke Nederlandse melding bovenin (hergebruik van het bestaande `.boot-notice`-patroon) die zegt: *welk* configveld het probleem is.
2. **Een losse "config testen"-modus.** Een klein hulpschermpje (bv. `config-test.html`, of `?configtest=1` op de hoofdpagina) dat voor elk ingevuld onderdeel één gerichte smoke-test-query stuurt (aantal instanties van `rootClass`, aantal per facet, of het periodeveld iets teruggeeft) en per onderdeel groen/rood laat zien — inclusief de ruwe SPARQL-tekst, zodat je 'm desnoods los in een SPARQL-testomgeving kan proberen. Dit is exact wat ik zelf handmatig deed tijdens het bouwen van de Rijkscollectie-versie (live queries proberen, kijken wat er terugkomt) — dat proces verdient een knop, niet alleen een developer die het toevallig kan.
3. **Voorbeeld + duidelijke "hoe vind ik de juiste property"-stap in de handleiding** (zie §4) — de meeste fouten ontstaan niet bij het invullen van de config zelf, maar bij het niet weten welke schema.org-property een dataset gebruikt. Een korte "ontdek-query" (`SELECT DISTINCT ?p WHERE { ?s a <rootClass> ; ?p ?o } LIMIT 50`) hoort in de handleiding, niet alleen in mijn hoofd.

Beveiligingsgrens die expliciet benoemd moet worden in de handleiding: de config is **vertrouwde, door de beheerder geschreven code** (net als `worker.js`), geen gebruikersinvoer — de predicaten worden rechtstreeks in SPARQL-tekst geplakt zonder escaping. Dat mag, zolang alleen de beheerder de config bewerkt. Vrije-tekst zoekvelden van bezoekers blijven wél door `sparqlEsc()` gaan, precies zoals nu.

---

## 4. De handleiding — opzet

Voorstel voor structuur (apart bestand, bv. `CONFIG-GIDS.md`, naast het project):

1. **Wat is dit / voor wie.** Eén A4: een config-gedreven faceted-search verkenner voor schema.org-achtige linked-data datasets, draait als één Cloudflare Worker (geen server te beheren), geen build-stap.
2. **Wat je nodig hebt.** Een SPARQL-eindpunt met schema.org(-achtige) data, een Cloudflare-account, evt. een API-token voor dat eindpunt.
3. **Stap 1 — ontdek je datamodel.** De "ontdek-query" hierboven; hoe je een rootClass, facet-predicaten en een periodeveld herkent in een onbekende dataset.
4. **Stap 2 — vul `config.js` in**, veld voor veld, met de Rijkscollectie-config ernaast als volledig ingevuld voorbeeld.
5. **Stap 3 — test** via de config-testmodus (§3.2) vóórdat je live gaat.
6. **Stap 4 — deployen.** `wrangler secret put` voor token/Basic Auth, eigen `wrangler.jsonc`, `npm run deploy`.
7. **Grenzen — wanneer dit NIET meer met config alleen kan.** Bijvoorbeeld: een compleet ander soort entity-relatie dan "facet → item", een tweede rootClass, of styling-wensen. Dan pas je `index.html` zelf aan (het blijft één leesbaar bestand, geen build-tool) — dit is een raamwerk met een klein, expliciet aantal instelbare knoppen, geen alles-kan-generator.

---

## 5. Naam

Nu we dit los willen trekken van "Rijkscollectie": een werknaam voor het raamwerk zelf, en voor de latere testmap. Suggestie: **Facetverkenner** (of **Linked Data Verkenner**) — Nederlands, beschrijft precies wat het is (een generieke, config-gedreven faceted-search verkenner), draagt geen organisatienaam. Zeg het als je een andere richting op wil; dit is puur een werktitel om nu al ergens naar te kunnen verwijzen.

---

## 6. Open ontwerpvragen voor jou

- [ ] **Config-testmodus**: los HTML-bestand (`config-test.html`) of een querystring-modus op dezelfde pagina (`?configtest=1`)? Eerste is simpeler te bouwen en te negeren voor eindgebruikers; tweede is één bestand minder om te onderhouden.
- [ ] **Naam** — Facetverkenner, Linked Data Verkenner, of iets anders?
- [ ] **Rootclass-aanname**: momenteel gaat de engine ervan uit dat élk item van hetzelfde type is (`?s a <rootClass>`). Is dat voor de datasets die je voor ogen hebt (andere schema.org-collecties) altijd zo, of moet dat ook een keer flexibeler (meerdere types, of geen type-restrictie)?
- [ ] Wil je dat ik, zodra dit ontwerp staat, met de **Rijkscollectie-config als eerste, volledig werkende referentie-invulling** begin (dus geen nieuw dataset erbij testen totdat de engine zelf bewezen werkt), of heb je al een tweede, écht ander dataset in gedachten om meteen tegenaan te testen zodra de "config testen"-modus er is?

---

**Status:** ontwerp, niets gebouwd. Wacht op jouw reactie op §6 voordat ik een (generiek benoemde) testmap aanmaak.
