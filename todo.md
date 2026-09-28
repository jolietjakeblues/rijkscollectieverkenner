# Todo — ideeën uit Sampo-UI, vertaald naar onze verkenner

Zes punten uit de Sampo-UI-verkenning, elk als los plan. Volgorde is niet per se prioriteit — dat bepalen we samen. Aannames die nog tegen de live data gecheckt moeten worden staan expliciet gemarkeerd.

**Status (2026-09-23):** punten 2, 4, 3 en 5 geïmplementeerd én gedeployed (branch `laatsteuitbreiding`, via `npm run deploy`/Wrangler — niet gecommit/gepusht). Punt 1 en 6 liggen nog, in lijn met de afgesproken prioriteit.

---

## 1. Echte kaart voor de Locatie-facet (Leaflet)

**Doel:** de huidige zelfgetekende SVG-coördinatenraster vervangen door een echte interactieve kaart (OpenStreetMap-tegels via Leaflet). Was eerder bewust vermeden omdat ik dacht dat een Claude Artifact geen tegelafbeeldingen mag laden — maar dit is geen Artifact, het is onze eigen Cloudflare Worker, dus die beperking geldt niet.

**✅ Geverifieerd tegen live data (2026-09-23):** Place-nodes hebben geen coördinaten (alleen `schema:name` en soms `schema:sameAs`) — geocoding is dus nodig, aanname bevestigd. Wel bruikbaar: 37 van de ~1060 plaatsen hebben een `sameAs`-link naar **GeoNames** (`sws.geonames.org/{id}`), dat zelf coördinaten teruggeeft — geen losse geocoding-stap nodig voor die subset, wél voor de rest.

**Aanpak:**
1. Voor plaatsen mét GeoNames-`sameAs`: coördinaten rechtstreeks bij GeoNames ophalen (aparte HTTP-call na de SPARQL-query, zoals eerder ook bij PDOK-fallback-patronen in deze dataset-familie).
2. Voor plaatsen zónder GeoNames-link: losse geocoding nodig (bv. Nominatim/OpenStreetMap) — moet nog bepaald worden hoe groot die restgroep in de praktijk is (nog niet gemeten hoeveel wérken onder de 37 GeoNames-plaatsen vallen versus de rest).
3. Leaflet laden via CDN, kaarttab toevoegen naast Tabel/Galerij, of de kaart alleen tonen bij een geselecteerde locatie.

**Geschatte impact:** middel — de GeoNames-subset is een relatief goedkope eerste stap; volledige dekking (stap 2) is groter werk.

---

## 2. Hierarchische facet via AAT (Getty) en RKDartists

**✅ Geïmplementeerd (2026-09-23):** stap 1 (makerpagina-upgrade) is gedaan — makers met een RKDartists-`sameAs` groeperen nu op de RKDartists-URI i.p.v. de naamstring, met geboorte-/sterftejaar + beroep op de makerpagina en een doorlink naar het RKDartists-record; makers zonder link vallen terug op de oude naamgroepering. Stap 2/3 (AAT-boomstructuur voor genre/materiaal) is **niet** gedaan — blijft open, zie hieronder.

**Correctie t.o.v. eerdere aanname:** dit is **niet** CHT/ABR (dat is de thesaurus van de rijksmonumenten-dataset, een ander RCE-dataset dan waar wij op zitten). De Rijkscollectie haalt concepten uit **AAT (Getty Art & Architecture Thesaurus)** voor genre/materiaal-achtige begrippen en **RKDartists** voor makers.

**Doel:** broader/narrower-navigatie op genre/materiaal via AAT, en — belangrijker — **makers-disambiguatie via RKDartists**. Dat laatste lost rechtstreeks de bekende beperking op dat makers nu alleen op letterlijke naam gegroepeerd worden (zie "Bekende beperkingen" in de README).

**✅ Geverifieerd tegen live data (2026-09-23):**
- **Makers:** 61% (84.569 van 138.081) heeft `schema:sameAs → https://rkd.nl/artists/{id}`. Cruciaal: **meerdere losse Person-URI's in onze dataset wijzen naar dezelfde RKDartists-ID**, met identieke geboortedatum/beroep — dit is dus een echte, bruikbare deduplicatiesleutel, niet alleen een linkje. Bonus: Person-nodes hebben ook `schema:hasOccupation` (92.354×), `schema:birthDate` (88.330×) en `schema:deathDate` (56.679×) — rijker dan gedacht, los van RKDartists.
- **Genre:** maar 20 termen totaal in gebruik (kleine, gesloten vocabulaire), waarvan 5 een AAT-link hebben (25%).
- **Materiaal:** AAT-links breder aanwezig (334 van 1687 materiaalconcepten, ~20%), inclusief de meestgebruikte materialen.

**Aanpak:**
1. **Makerpagina upgraden** (hoogste prioriteit binnen dit punt): waar een werk se maker een RKDartists-`sameAs` heeft, groepeer op die RKDartists-URI i.p.v. op de naamstring; toon geboorte-/sterftejaar en beroep op de makerpagina; link door naar het RKDartists-record. Makers zonder RKDartists-link vallen terug op de huidige naamgroepering (geen regressie).
2. **Genre/materiaal:** met maar 20 genres is een boomstructuur beperkt nuttig (weinig termen om in te browsen); materiaal (1687 concepten, 20% AAT) is een kansrijkere kandidaat voor broader/narrower via Getty's SPARQL-endpoint (vocab.getty.edu) — CORS/latentie nog te checken.
3. UI voor de boomstructuur: Sampo-UI's `HierarchicalFacet.js`-patroon.

**Geschatte impact:** middel voor de makerpagina-upgrade (stap 1 — duidelijk stuk werk, maar het pad is nu concreet); stap 2/3 blijft groter en onzekerder (afhankelijk van Getty AAT-endpoint-gedrag).

---

## 3. Periode: van/tot-invoerveld ALS AANVULLING (niet als vervanging)

**✅ Geïmplementeerd (2026-09-23):** van/tot-invoerveld + "Toepassen"-knop (ook op Enter) naast de bestaande 6-emmers-histogram, combineerbaar met een bucket-keuze (AND, zelfde `?yearF`-binding). Eigen filter-chip en meegenomen in "Filters wissen".

**Doel:** de bestaande 6-emmers-histogram blijft staan (die vind je goed) — er komt een **extra**, fijnmaziger van/tot-jaartal-filter naast, geïnspireerd op Sampo-UI's `RangeFacet.js` (twee tekstvelden + "toepassen"-knop).

**Aanpak:**
1. Bepalen hoe beide naast elkaar werken: sluiten bucket-keuze en handmatig bereik elkaar uit, of zijn het twee onafhankelijke, te combineren filters?
2. Nieuw state-veld (bv. `state.yearFrom`/`state.yearTo`) naast het bestaande `state.periodBucket`, met eigen SPARQL-filterfragment.
3. Klein UI-blokje onder de histogram.

**Geschatte impact:** klein.

---

## 4. Verwijderbare filter-chips i.p.v. platte tekstregel

**✅ Geïmplementeerd (2026-09-23):** `renderResultCount()` bouwt nu een rij pill-chips (maker, genre, materiaal, locatie, periode, jaartalbereik, "met afbeelding", zoekterm), elk met een eigen ×-knop via `clearFilterChip(key)`.

**Doel:** de huidige samenvatting ("· Chabot, Wim + moderne kunst") vervangen door individueel verwijderbare pill-chips (Sampo-UI's `ActiveFilters.js`/`ChipsArray.js`-patroon).

**Aanpak:** `renderResultCount()`'s filter-samenvatting herbouwen tot een rij chips, elk met een eigen ×-knop die precies dát ene filter wist (en de rest laat staan).

**Geschatte impact:** klein.

---

## 5. Analyse-tab: genre × periode (en evt. later netwerkweergave)

**✅ Geïmplementeerd (2026-09-23):** nieuwe "Analyse"-tab naast Tabel/Galerij met een gestapelde genre×periode-balkgrafiek (top 8 genres + "Overig" voor de rest, met legenda), lazy geladen bij eerste bezoek. Collectiebreed, net als de bestaande facetaantallen — niet herberekend binnen de huidige filterselectie. Cytoscape/netwerkweergave (stap 3) blijft open.

**Doel:** aparte tab naast Tabel/Galerij met een verdelings-/trendgrafiek — eerder al besproken als "grootste sprong qua analyse".

**Aanpak:**
1. Nieuwe aggregatiequery: GROUP BY genre + periode-emmer.
2. Visualisatie: geen aparte library nodig, kan als inline SVG in dezelfde stijl als de huidige periode-histogram (gestapelde balken).
3. Cytoscape.js/netwerkweergave (bv. maker-genre-netwerk) is een mogelijke latere uitbreiding, geen onderdeel van deze eerste stap.

**Geschatte impact:** middel.

---

## 6. Proxy hardenen: server-side querysjablonen

**Doel:** de bekende, nog openstaande beperking uit de laatste code-review oplossen: de Worker accepteert nu nog elke geldige SELECT/ASK-query van ingelogde gebruikers. Sampo-UI's eigen architectuur (server bouwt de SPARQL zelf uit config + parameters, client stuurt nooit ruwe querytekst) is hier het navolgenswaardige voorbeeld.

**Aanpak:**
1. Elke huidige client-side querybouwer (`buildIdsQuery`, `buildCountQuery`, `buildFacetQuery`, `buildEntityIdsQuery`, `buildEntityCountQuery`, `buildEntityBreakdownQuery`, `buildDetailQuery`, `buildAllMediaQuery`) krijgt een servertegenhanger in `worker.js`.
2. Frontend stuurt alleen nog parameters (facetwaarden, paginatie, dimensie) naar named routes/acties; `worker.js` valideert die parameters en bouwt zelf de SPARQL.
3. Dit raakt vrijwel de hele client/server-communicatie — grootste, meest ingrijpende punt van de zes.

**Geschatte impact:** groot.

---

## 7. ✅ Linked-data-paneel en herkenbare time-outs (2026-09-28)

**Geïmplementeerd** (ideeën overgenomen van [kvistgaard/opsis](https://github.com/kvistgaard/opsis), zelfde wijziging als in de Rijksmonumentenverkenner): de uitgeklapte werkregel en elke facetpagina met een eigen URI (genre, materiaal, locatie, maker met RKD-link) tonen de bron-URI met kopieerknop en een inklapbaar blok "Alle gegevens als linked data": alle uitgaande triples en inkomende links, pas opgehaald bij openklikken, geneste URI's zelf weer uitklapbaar (max. 4 niveaus). Het losse CHO-URI-veld in het detailraster is daardoor vervangen. Labels via `schema:name|rdfs:label|skos:prefLabel`, Nederlands eerst.

Time-outs (TriplyDB: HTTP 504 na ~1 minuut) krijgen een eigen melding i.p.v. de kale foutcode; een afgekapt antwoord (HTTP 206) toont een waarschuwing dat aantallen onvolledig kunnen zijn.

**Nog te doen:** live controleren tegen het echte endpoint met token — in de ontwikkelsessie was er geen `RCE_TOKEN`, dus alleen getest met nagebootste antwoorden (paneel, geneste knooppunten, 206, 504).

---

## 8. ✅ Deelbare zoek-URL en queries als form-POST (2026-09-28)

**Geïmplementeerd** (idee van [kvistgaard/opsis](https://github.com/kvistgaard/opsis)' `syncUrl`, zelfde aanpak als in de Rijksmonumentenverkenner): route `#/zoek?q=…&maker=…&genre=…&materiaal=…&locatie=…&periode=…&van=…&tot=…&afbeelding=1&pagina=N&weergave=galerij|analyse&analyse=…`. Elke wijziging wordt met `history.replaceState` in de URL geschreven (geen extra stap in de terugknop per klik); een makerpagina e.d. openen pusht nog wel. Een kale eerste bezoek houdt een schone URL. Waarden uit een link worden gecontroleerd (URI's alleen als geldige http(s)-IRI, jaartallen 1–4 cijfers, periode/weergave/analyse alleen bekende waarden); ongeldige waarden vallen weg. Labels van genre/materiaal/locatie worden los opgehaald, zodat de chip de echte naam toont.

Queries gaan nu als form-POST naar de proxy en van daar (met token) naar RCE: geen URL-lengtegrens, geen CORS-preflight. De proxy accepteert GET `?query=` nog steeds; de limiet van 4000 tekens is ongewijzigd.

**Nog te doen:** net als #7 alleen getest met nagebootste antwoorden; de proxy is getest tot aan RCE (met een neptoken), maar live met het echte token nog controleren.

---

## 9. ✅ Horizontale overflow op mobiel (2026-09-28)

**Opgelost**, zelfde aanpak als in de Rijksmonumentenverkenner (#12 daar). Gemeten op 390 px (vóór → na): linked-data-blok open 299 → 0 px, Analyse genre × materiaal 373 → 0 px (ook 63 → 0 op 700 px), facetpagina 237 → 0 px; binnen de resultatentabel viel de uitgeklapte rij rechts buiten het kader (390 én 700 px), nu niet meer. Oorzaken:
- `.layout` gebruikte `1fr`, dat niet krimpt onder de inhoud; nu `minmax(0, 1fr)`, zodat brede tabellen (resultaten, de matrix) binnen hun eigen scrollkader blijven.
- linked-data-tabel: `table-layout: fixed` + afbreken van lange URI's (die fix kwam in de monumentenverkenner pas na het overnemen van het paneel).
- inhoud van een uitgeklapte rij begrensd tot de zichtbare breedte van `.table-scroll` (`100cqw`) en sticky links; tabelkop erboven (`z-index`).
- paginatitel van een facetpagina breekt af, want die valt terug op de kale URI als een label ontbreekt.

Gemeten met nagebootste (bewust lange) data op 390/700/1200 px: tabel, uitgeklapte rij, open linked-data-blok, galerij, alle vijf analyse-subtabs en facetpagina, overal 0 px overflow.

---

## Openstaande vragen voor volgende sessie

- [x] Hebben Place-nodes (`schema:locationCreated`) coördinaten, of alleen een naam? → **Nee, geen coördinaten**; 37/1060 plaatsen hebben wel een GeoNames-`sameAs`. (punt 1)
- [x] Bevatten genre/materiaal en/of makers een `sameAs`-link naar AAT resp. RKDartists in de live data? → **Ja**: makers 61% naar RKDartists (met bruikbare dedup-sleutel), genre 5/20 naar AAT, materiaal 334/1687 naar AAT. (punt 2)
- [x] Sluiten periode-buckets en een handmatig jaartal-bereik elkaar uit, of zijn ze combineerbaar? → **Combineerbaar** (AND): beide zijn losse, tegelijk toepasbare filters op dezelfde `?yearF`-binding. Geïmplementeerd. (punt 3)
- [ ] Hoeveel wérken (niet plaatsen) vallen onder de 37 GeoNames-gekoppelde plaatsen versus de rest zonder link? (punt 1, bepaalt hoe ver de "goedkope eerste stap" komt)
