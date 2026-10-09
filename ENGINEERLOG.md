# Engineering Log — FaultLab

Dit is het technische dagboek van FaultLab. Het legt vast **wat** er gebouwd is, **waarom** het zo gebouwd is, en **wat je ervan kunt leren**. Het is geschreven voor een eerstejaars HBO Software Engineering-student: begrippen worden uitgelegd bij hun eerste gebruik, en elke keuze krijgt een reden.

**Leeswijzer**

- Entries staan op volgorde van tijd, gegroepeerd per checkpoint (CP).
- ✅ **Geverifieerd** betekent: gemeten of door een test bewezen, met het echte resultaat erbij.
- 💭 **Aanname** betekent: een redelijke verwachting die (nog) niet gemeten is.
- Bestandsverwijzingen zijn relatief aan de root van de repository. De meeste code staat in `packages/engine/src/`, de tests in `packages/engine/test/`.
- Elke grote entry eindigt met **"Dit moet ik zelf kunnen uitleggen"**: vragen die je zonder hulp van AI moet kunnen beantwoorden.

---

## CP0 — Deterministische simulatiekern

**Datum:** 2026-10-08 · **Status:** afgerond en goedgekeurd · **Engine-versie:** `0.1.0-cp0`

CP0 legt het fundament: een simulator die een netwerk van virtuele computers kan laten draaien, waarbij **dezelfde invoer altijd exact dezelfde uitvoer geeft**. Er is nog geen gebruikersinterface. Dat is bewust: eerst moeten de regels van de simulatie kloppen en getest zijn, pas daarna komt de visualisatie.

### CP0.1 — Determinisme en virtuele tijd

**1. Wat hebben we gebouwd?**
Een simulatie die volledig *deterministisch* is: met dezelfde configuratie (seed, nodes, protocol, netwerk, limieten) levert ze altijd dezelfde *trace* op, tot op de byte. De tijd in de simulatie is *virtueel*: een geheel getal ("ticks") dat alleen verandert als de simulatie het volgende event verwerkt. Zie `time.ts` en `docs/DETERMINISM.md`.

**2. Waarom hebben we dit nodig?**
Bugs in gedistribueerde systemen zijn berucht omdat ze vaak maar één keer gebeuren: een bericht komt net iets te laat, twee servers crashen tegelijk. Als je zo'n bug niet kunt herhalen, kun je hem ook niet onderzoeken. Een deterministische simulator maakt elke bug herhaalbaar: geef dezelfde seed mee en je ziet exact hetzelfde gebeuren. Replay, tijdreizen door de geschiedenis en het delen van experimenten zijn allemaal alleen mogelijk dankzij determinisme.

**3. Hoe werkt het?**
Een programma is deterministisch als elke waarde die het berekent alléén afhangt van zijn invoer. De aanpak is daarom: zoek elke plek waar informatie van "buitenaf" het programma in kan lekken, en sluit die af.

| Lek | Oplossing |
|---|---|
| Echte tijd (`Date.now()`) | Virtuele klok: een teller die alleen de scheduler ophoogt |
| Echte timers (`setTimeout`) | Een synchrone `while`-lus die events één voor één verwerkt |
| Toeval (`Math.random()`) | Een eigen generator die vanuit een seed werkt (zie CP0.3) |
| Volgorde van gelijktijdige events | Een vaste, totale ordening (zie CP0.2) |
| Gedeelde objecten die later veranderen | Kopiëren en bevriezen (zie CP0.4) |

Als elke stap een pure functie is van de huidige toestand, en de begintoestand een pure functie van de configuratie, dan is de hele trace een pure functie van de configuratie. Dat is een bewijs met *inductie* over het aantal stappen.

Waarom gehele getallen voor tijd? Omdat kommagetallen (floating point) niet exact zijn:

```ts
0.1 + 0.2 === 0.3 // false! (0.30000000000000004)
```

Bij duizenden opgetelde vertragingen lopen zulke afrondingsfouten op, en twee events die "tegelijk" zouden moeten zijn, zijn het dan net niet. Met integers is optellen en vergelijken altijd exact.

**4. Welke keuzes hebben we gemaakt?**
- *Integer ticks* in plaats van floats (exact) of `BigInt` (exact maar traag en niet in JSON op te slaan). Afspraak: 1 tick = 1 milliseconde. Zie ADR-0002.
- De engine wordt gecompileerd **zonder** browser- en Node-bibliotheken (`lib: ["ES2023"]`, `types: []` in `packages/engine/tsconfig.json`). Daardoor zijn `setTimeout`, `performance` en `console` in de engine letterlijk compileerfouten. De compiler bewaakt het determinisme dus mee. Zie ADR-0007.

**5. Welke problemen kwamen we tegen?**
`Math.random` en `Date` horen bij standaard JavaScript en kun je dus niet via de compiler verbieden. Daarom is er een extra *architecture fitness test* (`architecture.test.ts`) die de broncode doorzoekt op verboden woorden.

**6. Hoe hebben we het getest?**
✅ Twee runs met identieke invoer geven identieke traces. ✅ Een property-test met willekeurige seeds, latencies en aantallen nodes (100 runs) vindt geen enkel verschil. ✅ Een test vervangt `Math.random`, `Date.now` en `performance.now` door functies die meteen een fout gooien: de simulatie draait gewoon door, dus de engine gebruikt ze niet. ✅ Een tijdelijk testbestand met `setTimeout`/`console`/`performance` gaf drie compileerfouten.

**7. Wat heb ik hiervan geleerd?**
Determinisme bereik je niet door hard je best te doen. Je bereikt het door elke bron van non-determinisme te benoemen, af te sluiten, en het afsluiten automatisch te laten controleren.

**8. Belangrijkste begrippen**
- **Determinisme:** dezelfde invoer geeft altijd dezelfde uitvoer.
- **Virtuele klok:** een gesimuleerde tijd die losstaat van de echte tijd.
- **Discrete-event simulatie:** een simulatie die van gebeurtenis naar gebeurtenis springt in plaats van in vaste tijdstappen te lopen.
- **Trace:** het volledige logboek van alles wat er in een run gebeurd is.

**Dit moet ik zelf kunnen uitleggen**
1. Noem vijf bronnen van non-determinisme en hoe FaultLab elk ervan afsluit.
2. Waarom is integer-tijd beter dan float-tijd? Geef een concreet voorbeeld van wat er misgaat met floats.
3. Wat betekent "de trace is een pure functie van de configuratie", en waarom is dat bewijsbaar met inductie?

### CP0.2 — De event-queue: een prioriteitswachtrij met een binaire heap

**1. Wat hebben we gebouwd?**
Een *scheduler* die toekomstige events bewaart en steeds het eerstvolgende teruggeeft (`scheduler.ts`), gebouwd op een *binaire min-heap* (`priority-queue.ts`).

**2. Waarom hebben we dit nodig?**
De simulatie moet steeds weten "wat gebeurt er hierna?". Er komen ondertussen voortdurend nieuwe events bij: elk verstuurd bericht levert een toekomstige aflevering op. Je hebt dus een datastructuur nodig die snel kan *toevoegen* én snel het *kleinste* element kan *uithalen*.

**3. Hoe werkt het?**
Een binaire heap is een boom die in een gewone array is opgeslagen:

```
index:    0   1   2   3   4
waarde:  [1,  3,  8,  5,  4]
kinderen van i staan op 2i+1 en 2i+2; de ouder van i staat op ⌊(i−1)/2⌋

        1
      /   \
     3     8
    / \
   5   4
```

De regel is dat elke ouder kleiner of gelijk is aan zijn kinderen, dus het kleinste element staat altijd op index 0. Bij *toevoegen* zet je het element achteraan en laat je het omhoog "bubbelen" zolang het kleiner is dan zijn ouder (*sift-up*). Bij *uithalen* zet je het laatste element op de top en laat je het omlaag zakken naar het kleinste kind (*sift-down*). Beide kosten O(log n) stappen, omdat de boom log₂(n) niveaus hoog is.

De belangrijkste regel van de hele simulatie is de **ordening**:

```ts
// scheduler.ts
return a.time - b.time || a.seq - b.seq;
```

Eerst op virtuele tijd. Bij gelijke tijd wint het event dat het eerst is ingepland (`seq` is een oplopend volgnummer).

**4. Welke keuzes hebben we gemaakt?**
- *Heap* in plaats van een gesorteerde array: invoegen kost dan O(log n) in plaats van O(n).
- *FIFO bij gelijke tijd* (wie eerst ingepland is, gaat eerst). Alternatieven waren "eerst berichten, dan timers" (verstopt beleid in de scheduler) of willekeurig met een seed (interessant om bugs te vinden, maar lastiger uit te leggen). Die laatste staat op de roadmap als optie. Zie ADR-0003.
- *Lazy cancellation:* een geannuleerde timer blijft in de heap staan en wordt overgeslagen zodra hij bovenaan komt. Annuleren kost zo O(1), maar dode entries kosten geheugen. In CP1 bleek dat bij lange timers echt een probleem te zijn, en is het opgelost met compactie (zie CP1.5).

**5. Welke problemen kwamen we tegen?**
Een heap is **niet stabiel**: twee elementen die "gelijk" zijn, kunnen in willekeurige volgorde uit de heap komen. Sorteer je alleen op tijd, dan is de volgorde van gelijktijdige events dus níét gegarandeerd, terwijl kleine tests toevallig wel goed lijken te gaan. De oplossing is het unieke `seq`-nummer: twee verschillende events zijn daardoor nooit "gelijk". Zo'n vergelijking heet een *strikte totale orde*. Met een strikte totale orde bestaat er maar één mogelijke uitvoervolgorde, ongeacht stabiliteit.

**6. Hoe hebben we het getest?**
✅ Een *model-based property test* voert willekeurige reeksen push/pop uit op de heap én op een simpel gesorteerd array ("het model") en eist dat ze altijd hetzelfde antwoord geven. ✅ De scheduler wordt vergeleken met een stabiele sortering op tijd. ✅ Mutatietest: met de tie-break omgedraaid (LIFO) faalden 10 tests.

**7. Wat heb ik hiervan geleerd?**
Een correcte datastructuur is niet genoeg. Je moet ook nadenken over wat er gebeurt bij gelijke sleutels. "Werkt in mijn test" bewijst weinig als de test toevallig geen gelijke tijden bevat.

**8. Belangrijkste begrippen**
- **Prioriteitswachtrij:** een wachtrij waaruit je steeds het element met de hoogste prioriteit (hier: de kleinste tijd) haalt.
- **Binaire heap:** een boom in een array waarin elke ouder ≤ zijn kinderen is.
- **Stabiliteit:** gelijke elementen behouden hun oorspronkelijke volgorde.
- **Strikte totale orde:** een vergelijking waarbij voor elk paar verschillende elementen precies één de kleinste is.
- **Big-O-notatie:** hoe de rekentijd groeit met de invoergrootte.

**Dit moet ik zelf kunnen uitleggen**
1. Teken de heap na het toevoegen van 5, 3, 8, 1, 4 en leg sift-up uit.
2. Waarom is een heap niet stabiel, en waarom geeft FaultLab toch altijd dezelfde volgorde?
3. Wat kost lazy cancellation, en wat levert het op?

### CP0.3 — Gezaaid toeval: xoshiro128\*\* en onafhankelijke streams

**1. Wat hebben we gebouwd?**
Een eigen *pseudo-random number generator* (PRNG): `xoshiro128**` in `random.ts`. Elke node en het netwerk krijgen een eigen, onafhankelijke *stream* met willekeurige getallen.

**2. Waarom hebben we dit nodig?**
Netwerkvertraging, timeouts en (later) pakketverlies moeten willekeurig *lijken*, maar wel herhaalbaar zijn. `Math.random()` kun je geen seed geven, dus elke run zou anders zijn.

**3. Hoe werkt het?**
Een PRNG is een functie die een interne toestand (hier vier 32-bits getallen) steeds door elkaar husselt met bitoperaties (schuiven, roteren, XOR) en daar een getal uit afleidt. Dezelfde begintoestand geeft altijd dezelfde reeks. De seed (één 32-bits getal) wordt met *SplitMix32* uitgebreid tot de vier toestandswoorden.

Een getal tussen `min` en `max` maken lijkt simpel (`x % bereik`), maar dat is **scheef** als 2³² niet deelbaar is door het bereik. Sommige uitkomsten komen dan vaker voor. De oplossing heet *rejection sampling*: gooi de bovenste "restwaarden" weg en trek opnieuw.

```ts
const limit = 2 ** 32 - (2 ** 32 % range); // grootste veelvoud van range
let x = this.nextUint32();
while (x >= limit) x = this.nextUint32();   // scheve staart weggooien
return min + (x % range);
```

**Onafhankelijke streams:** elke node krijgt een generator afgeleid van `hash("<seed>/node:n1")`. Als node n1 één extra getal trekt, verandert er niets aan de getallen van n2 of van het netwerk. Kleine wijzigingen blijven zo lokaal.

**4. Welke keuzes hebben we gemaakt?**
xoshiro128\*\* gebruikt alleen 32-bits operaties, en dat is precies wat JavaScript betrouwbaar kan (`Math.imul`, `>>>`). PCG32 heeft 64-bits vermenigvuldiging nodig (traag in JS). mulberry32 heeft maar 32 bits toestand. De bibliotheek `seedrandom` was een extra dependency voor ±40 regels code. Zie ADR-0004.

**5. Welke problemen kwamen we tegen?**
De interessantste vondst kwam uit de mutatietest: toen we rejection sampling expres weghaalden, **faalde geen enkele test**. Bij kleine bereiken (zoals 0–9) is de scheefheid ongeveer één op een miljard, statistisch onzichtbaar. We hebben twee tests toegevoegd: één die exact controleert dat waarden boven de limiet worden overgeslagen, en één met een bereik van 3·2³⁰, waarbij naïeve modulo de onderste derde dubbel zo vaak zou kiezen (50% in plaats van 33%). Beide tests falen nu op die mutatie.

Daarnaast hebben we bewezen dat de verboden "alles-nul"-toestand (waarna de generator alleen nog nullen geeft) nooit kan ontstaan: de mengfunctie van SplitMix32 is een *bijectie* (één-op-één), en de vier invoerwaarden zijn verschillend, dus hooguit één van de vier woorden kan nul zijn.

**6. Hoe hebben we het getest?**
✅ De uitvoer is bit-voor-bit gelijk aan de originele C-implementatie (`test/reference/xoshiro128.c`), inclusief de bekende testwaarden 11520, 0, 5927040, …. ✅ Grenzen van `nextInt` via property tests. ✅ Een chi-kwadraattoets (statistische gelijkverdeling) met een vaste seed, zodat de test nooit "toevallig" faalt. ✅ Test dat extra trekkingen op n1 de waarden van n2 en n3 niet veranderen.

**7. Wat heb ik hiervan geleerd?**
"Random" in software is bijna nooit echt willekeurig, en dat is juist handig. En: een test die niet kan falen, is geen test. Mutatietesten laat zien welke tests echt iets bewaken.

**8. Belangrijkste begrippen**
- **PRNG:** een algoritme dat willekeurig ogende getallen maakt uit een seed.
- **Seed:** het startgetal van een PRNG.
- **Modulo bias:** de scheefheid die ontstaat door `x % n`.
- **Rejection sampling:** ongewenste trekkingen weggooien en opnieuw trekken.
- **Stream:** een eigen, onafhankelijke reeks willekeurige getallen.

**Dit moet ik zelf kunnen uitleggen**
1. Wat is modulo bias? Reken de limiet uit voor `nextInt(0, 9)`.
2. Waarom faalde geen test toen rejection sampling werd weggehaald, en hoe hebben we dat opgelost?
3. Waarom krijgt elke node een eigen stream, terwijl één stream ook deterministisch zou zijn?

### CP0.4 — Protocolstate, atomaire stappen en causaliteit in de trace

**1. Wat hebben we gebouwd?**
- Een **protocol-API** (`protocol.ts`): een protocol bestaat uit drie functies, `init`, `onMessage` en `onTimer`, die de oude state krijgen en een nieuwe state teruggeven.
- Een **trace** (`trace.ts`): een logboek waarin je alleen kunt toevoegen. Elke entry wijst naar de entry die hem veroorzaakte (`cause`).

**2. Waarom hebben we dit nodig?**
De engine moet kunnen zien wat er verandert, snapshots kunnen maken, en garanderen dat een stap nooit "half" wordt uitgevoerd. En een debugger moet kunnen uitleggen *waarom* iets gebeurde.

**3. Hoe werkt het?**
- **Onveranderlijke state:** de state die een handler krijgt is diep bevroren (`Object.freeze`). Wie iets wil veranderen, geeft een nieuw object terug: `return { ...state, count: state.count + 1 }`. Of de state veranderd is, check je dan simpelweg met `===`.
- **Gebufferde effecten:** `ctx.send()` verstuurt nog niets. Het zet het bericht in een buffer. Pas als de handler zonder fout klaar is, worden alle effecten toegepast. Gooit de handler een fout, dan gebeurt er niets. Een stap is zo **atomair**: alles of niets.
- **Validatie aan de grens** (`json.ts`): alles wat een protocol de engine in stuurt, wordt gecontroleerd op geldige JSON, gekopieerd en bevroren. Een zender kan een bericht na het versturen dus niet meer stiekem aanpassen.
- **Causaliteit:** een `message.deliver` wijst naar zijn `message.send`, die weer naar de entry die de handler startte. Door die pijlen terug te volgen reconstrueer je de *happens-before*-relatie: wat kon wat beïnvloeden.

**4. Welke keuzes hebben we gemaakt?**
Alternatieven waren een klasse met veranderbare `this.state` (vertrouwd, maar de engine ziet niet wat er veranderde en een fout halverwege laat rommel achter) en async handlers (lezen prettig, maar brengen de vraag "wanneer draait de rest?" terug, en dat ondermijnt het determinisme). Zie ADR-0005 en ADR-0006. Een slimme optimalisatie: al gevalideerde, bevroren objecten worden in een `WeakSet` onthouden en hergebruikt. Een state-update kost dan alleen werk voor het gedeelte dat echt veranderde (*structural sharing*).

**5. Welke problemen kwamen we tegen?**
- Een JSON-sleutel `"__proto__"` kan bij een gewone toewijzing (`out[key] = ...`) het *prototype* van het object veranderen in plaats van een eigenschap aan te maken. Daarom gebruiken we `Object.defineProperty`.
- `-0` bestaat in JavaScript maar niet in JSON. Het wordt genormaliseerd naar `0`.
- Foutmeldingen bevatten bewust geen stacktrace, want daarin staan bestandspaden van jouw computer, en dan zou de trace per machine verschillen.

**6. Hoe hebben we het getest?**
✅ Een handler die eerst berichten verstuurt en dan een fout gooit, laat geen enkel bericht of timer achter in de trace. ✅ Proberen bevroren state te wijzigen geeft een `TypeError`. ✅ Een `ctx` gebruiken nadat de handler klaar is, wordt geweigerd. ✅ 15 soorten ongeldige JSON worden afgewezen, met het pad naar de fout (`payload.a[1].b`).

**7. Wat heb ik hiervan geleerd?**
Onveranderlijkheid maakt dingen *goedkoper*: wijzigingen detecteren, snapshots maken en geschiedenis bewaren worden allemaal triviaal. En een "trust boundary" (de grens waar data van buiten binnenkomt) is de plek om streng te valideren.

**8. Belangrijkste begrippen**
- **Immutability:** data die na aanmaak niet meer verandert.
- **Atomiciteit:** een operatie gebeurt helemaal of helemaal niet.
- **Trust boundary:** de grens waar je data van een minder betrouwbare bron binnenlaat.
- **Happens-before:** de relatie "gebeurtenis A kon gebeurtenis B beïnvloeden".
- **Structural sharing:** onveranderde delen van oude en nieuwe data worden gedeeld in plaats van gekopieerd.

**Dit moet ik zelf kunnen uitleggen**
1. Wat gebeurt er als een handler een fout gooit nadat hij `ctx.send()` heeft aangeroepen, en waarom is dat het juiste gedrag?
2. Hoe volg je met `cause`-links terug waarom een bericht verstuurd werd?
3. Waarom is de `WeakSet`-optimalisatie veilig voor het determinisme?

### CP0.5 — Resource-limieten en terminatie

**1. Wat hebben we gebouwd?**
Drie limieten: `maxEvents` (maximaal aantal verwerkte events), `maxTime` (maximale virtuele tijd) en `maxPendingEvents` (maximaal aantal events in de wachtrij). Daarnaast een limiet op het aantal effecten per handler.

**2. Waarom hebben we dit nodig?**
Een protocol kan oneindig doorgaan (twee nodes die elkaar eeuwig berichten terugsturen), of *exponentieel* groeien (elk bericht veroorzaakt twee nieuwe). Zonder limieten loopt de browser dan vast of raakt het geheugen op.

**3. Hoe werkt het?**
Vóór elke stap controleert `step()` in een vaste volgorde: (1) is de wachtrij leeg → `quiescent` (alles is stil), (2) is `maxEvents` bereikt → `event-limit`, (3) ligt het volgende event na `maxTime` → `time-limit`. Na de stap volgen nog de controles op protocolfouten en `maxPendingEvents`.

**4. Welke keuzes hebben we gemaakt?**
De volgorde van de controles is een *specificatie*. Een run die precies op zijn laatste toegestane event leeg raakt, heet `quiescent`, niet `event-limit`. Events die precies óp `maxTime` vallen, worden nog uitgevoerd.

**5. Welke problemen kwamen we tegen?**
Een handler met een oneindige lus (`while (true) {}`) keert nooit terug, en dat kun je in dezelfde thread niet onderbreken. Dat wordt later opgelost met een "waakhond" rond de Web Worker. Het is dus een bekende, gedocumenteerde beperking.

**6. Hoe hebben we het getest?**
✅ Het `echoForever`-protocol stopt na precies 10 events met `maxEvents: 10`. ✅ De ping-run met precies 15 toegestane events is `quiescent`, met 14 is het `event-limit`. ✅ Een "flood"-protocol stopt op `pending-limit`.

**7. Wat heb ik hiervan geleerd?**
Grensgevallen ("off-by-one") moet je expliciet specificeren en aan beide kanten testen, anders verschilt het gedrag stilletjes tussen versies.

**8. Belangrijkste begrippen**
- **Terminatie:** de garantie dat een programma stopt.
- **Quiescence:** de toestand waarin niets meer gebeurt.
- **Off-by-one:** een fout van precies één, bijvoorbeeld `>` in plaats van `>=`.

### CP0.6 — Teststrategie: property-based testen, golden fingerprints en mutatietesten

**1. Wat hebben we gebouwd?**
Een testsuite van ✅ 125 tests in 9 bestanden (Vitest + fast-check). ✅ Dekking: 97,3% van de regels, 95,0% van de branches.

**2. Waarom hebben we dit nodig?**
Een simulator die "ongeveer" klopt, is waardeloos: een debugger die zelf bugs heeft, misleidt je. De tests moeten de *specificatie* bewaken (`docs/SEMANTICS.md`), niet alleen de huidige code.

**3. Hoe werkt het?**
- **Property-based testing** (fast-check): je beschrijft een eigenschap ("de heap geeft altijd gesorteerde uitvoer") en de tool genereert honderden willekeurige invoeren. Bij een fout zoekt hij automatisch het *kleinste* voorbeeld dat nog faalt (*shrinking*).
- **Referentievectoren:** de PRNG is vergeleken met de officiële C-code, en de hashfunctie met gepubliceerde testwaarden.
- **Golden fingerprint:** één referentie-experiment heeft een vaste "vingerafdruk" (`62159051`): een hash van de complete trace. Verandert het gedrag van de engine, dan verandert de hash en faalt de test. Bedoelde wijziging? Dan ophogen we `ENGINE_VERSION` en passen we de hash aan. Onbedoeld? Dan heb je een regressie gevonden.
- **Mutatietesten:** expres een bug in de code zetten en kijken of de tests falen.

**4. Welke keuzes hebben we gemaakt?**
Statistische tests gebruiken altijd een vaste seed, zodat ze nooit willekeurig falen (*flaky tests*). Dekking is een signaal, geen doel: 100% dekking zegt niets als de tests niets controleren.

**5. Welke problemen kwamen we tegen?**
✅ Van de acht expres ingebouwde bugs werden er zeven gevangen. De achtste (rejection sampling weghalen) niet. Dat leidde tot twee nieuwe tests (zie CP0.3). Dit is het hele punt van mutatietesten: het laat gaten zien die dekking niet laat zien.

**6. Hoe hebben we het getest?**
✅ Alle 125 tests slagen; de suite draait in ±0,3 seconde. ✅ Gemeten doorvoer met volledige tracing: 200.000 events (600.001 trace-entries) in 449–454 ms bij twee runs, en 702 ms bij een derde run (waarschijnlijk ruis door bijvoorbeeld garbage collection 💭). Dat is ongeveer 440.000 events per seconde, op een Apple-silicon laptop met Node 24.

**7. Wat heb ik hiervan geleerd?**
Testen is meer dan "werkt het?". Het is bewijzen dat de code doet wat de specificatie zegt, ook in de randgevallen, en controleren of je tests zelf wel iets bewaken.

**8. Belangrijkste begrippen**
- **Property-based testing:** testen met automatisch gegenereerde invoer en algemene eigenschappen.
- **Shrinking:** een falend voorbeeld automatisch verkleinen tot de kern.
- **Golden test:** de uitvoer vergelijken met een eerder vastgelegde "gouden" waarde.
- **Mutatietesten:** controleren of tests falen als je bewust een bug introduceert.
- **Regressie:** iets dat eerst werkte en nu kapot is.

**Dit moet ik zelf kunnen uitleggen**
1. Wat is het verschil tussen een gewone unit test en een property-based test?
2. Wat doe je als de golden fingerprint-test faalt?
3. Waarom zegt 97% dekking minder dan de resultaten van de mutatietest?

---

## CP1 — Foutinjectie en de levenscyclus van nodes

**Datum:** 2026-10-08 · **Status:** afgerond en goedgekeurd · **Engine-versie:** `0.2.0-cp1`

In CP0 werkte alles altijd. In CP1 gaat het met opzet mis: nodes crashen en herstarten, het netwerk raakt in partities uiteen, berichten gaan verloren of komen te laat aan. Het doel is niet "chaos", maar **precies gedefinieerde, reproduceerbare chaos**. Elke fout is een geplande invoer, elke gevolg staat in de trace, en dezelfde invoer geeft nog steeds exact dezelfde trace.

Ontwerp vooraf: ADR-0008 t/m ADR-0011 in `docs/adr/`, en de acceptatiecriteria in `docs/ROADMAP.md`.

### CP1.1 — Crash, herstel en incarnaties

**1. Wat hebben we gebouwd?**
Nodes hebben nu een levenscyclus: `idle → running → crashed → running → …` (`node.ts`). Een crash en een herstel (*recovery*) zijn geplande gebeurtenissen. Bij elke herstart krijgt de node een nieuw **incarnatienummer**: 1 bij de eerste start, 2 na de eerste recovery, enzovoort.

**2. Waarom hebben we dit nodig?**
Gedistribueerde algoritmes zoals Raft bestaan juist om crashes te overleven. Een simulator zonder crashes kan dus niets interessants testen. Een crash is alleen een zinvol model van een echte computer als precies vastligt wat er verloren gaat en wat blijft.

**3. Hoe werkt het?**
Alles wat een node heeft, valt in één van vier categorieën:

| Categorie | Voorbeeld | Bij crash |
|---|---|---|
| Vluchtige protocolstate | `state` (zoals RAM) | weg; `init` bouwt hem opnieuw op |
| Persistente protocolstate | `ctx.storage` (zoals een schijf) | blijft |
| Runtime-state van de node | status, incarnatie, lopende timers | status → crashed, alle timers geannuleerd |
| Simulatie-infrastructuur | scheduler, klok, netwerk, random streams | onaangetast |

Het lastigste probleem is de **oude timer**. Stel: een node zet om t=0 een timer voor t=100, crasht om t=50 en herstart om t=60. Die oude timer mag om t=100 níét afgaan in de nieuwe incarnatie: die "nieuwe" node heeft hem nooit gezet. FaultLab beschermt daar dubbel tegen:

1. Een crash annuleert **meteen** alle lopende timers van de node (*eager cancellation*).
2. Elke timer onthoudt de incarnatie die hem zette. Bij het afgaan controleert de engine dat die nog klopt (een *assertion*). Faalt die controle, dan is er een bug in de engine en stopt alles luid in plaats van stilletjes een verkeerde trace te maken.

```ts
// simulation.ts — tweede verdedigingslinie
if (node.status !== 'running' || event.incarnation !== node.incarnation) {
  throw new EngineInvariantError(`timer ... reached ${node.id} ...`);
}
```

**4. Welke keuzes hebben we gemaakt?**
- Het protocol krijgt het incarnatienummer **niet** te zien. Een echte computer krijgt ook geen "bootnummer" van het universum. Een protocol dat dat wil weten, slaat zelf een teller op in storage (de heartbeat-fixture doet precies dat).
- De random stream van een node loopt na een crash **door**. Anders zou een herstarte node dezelfde "willekeurige" keuzes herhalen, en dat is onrealistisch.
- Crashen van een al gecrashte node, of herstellen van een draaiende node, is geen fout: het wordt vastgelegd als `fault.skipped`. Daardoor is élk willekeurig gegenereerd faultplan geldig, en dat hebben de property tests nodig.

**5. Welke problemen kwamen we tegen?**
"Wat gebeurt er als een crash en een timer op hetzelfde tijdstip vallen?" Zonder expliciete regel is het antwoord toeval. De regel staat in CP1.3.

**6. Hoe hebben we het getest?**
✅ 27 tests in `lifecycle.test.ts`, waaronder: een gecrashte node voert niets meer uit; berichten naar hem worden gedropt met reden `node-down`; na recovery is de state vers maar de storage intact; en de randgevallen "crash + timer op dezelfde tick" en "crash + recovery + oude timer op dezelfde tick". ✅ Een mutatie die de eager cancellation weghaalt, laat 8 tests falen. Haal je óók de assertion weg, dan vangt het trace-orakel (CP1.6) het alsnog met 13 falende tests.

**7. Wat heb ik hiervan geleerd?**
"Crash" is geen feature maar een **definitie**: je moet per stukje data beslissen of het overleeft. Defence in depth (twee onafhankelijke beschermingen) maakt bugs luid in plaats van stil.

**8. Belangrijkste begrippen**
- **Crash-recovery-model:** nodes kunnen stoppen en later herstarten met hun persistente data.
- **Incarnatie:** één "leven" van een node tussen twee crashes.
- **Vluchtig vs. persistent:** verdwijnt bij een crash vs. blijft bewaard.
- **Defence in depth:** meerdere onafhankelijke beveiligingen voor hetzelfde risico.

**Dit moet ik zelf kunnen uitleggen**
1. Welke vier categorieën state onderscheidt FaultLab, en wat doet een crash met elk ervan?
2. Waarom kan een timer van een vorige incarnatie nooit afgaan? Noem beide mechanismen.
3. Waarom krijgt het protocol het incarnatienummer niet te zien?

### CP1.2 — Persistentie: wat overleeft een crash?

**1. Wat hebben we gebouwd?**
Persistente opslag per node: `ctx.storage.get / set / delete / keys` (`context.ts`, `protocol.ts`), met het persistentiemodel **sync-on-commit**.

**2. Waarom hebben we dit nodig?**
Raft móét bepaalde gegevens (de huidige *term*, op wie gestemd is) op schijf hebben voordat het antwoordt. Anders kan een node na een crash twee keer stemmen in dezelfde verkiezing, en dan kunnen er twee leiders ontstaan. Een simulator moet dit gedrag kunnen modelleren.

**3. Hoe werkt het?**
Schrijfacties worden, net als berichten, eerst **gebufferd**. Lezen binnen dezelfde handler ziet de eigen buffer (*read-your-writes*): eerst wordt in de buffer gekeken, dan in de opgeslagen data. Als de handler succesvol eindigt, worden alle schrijfacties tegelijk duurzaam en als één `storage.write` in de trace gezet, **vóór** de berichten van die stap (*persist-before-send*). Gooit de handler een fout, dan wordt er niets opgeslagen.

Omdat een crash alleen *tussen* twee stappen kan vallen, nooit halverwege, geldt: een vastgelegde (*committed*) schrijfactie gaat nooit verloren, en een half uitgevoerde wordt nooit opgeslagen.

**4. Welke keuzes hebben we gemaakt?**
Een realistischer alternatief is een expliciete `sync()`: writes zijn pas veilig na een sync, en een crash daarvoor gooit ze weg. Echte bugs in databases ontstaan vaak juist daar. Dat hebben we bewust uitgesteld. De trace legt wel al `persistence: 'sync-on-commit'` vast, zodat een tweede model later zonder verwarring kan worden toegevoegd (ADR-0008).

**5. Welke problemen kwamen we tegen?**
In mijn eerste test voor "verwijderen overleeft een crash" maakte het protocol bij elke herstart de sleutel opnieuw aan en verwijderde hem daarna weer. De engine gaf dus terecht `{}` terug, en de test zat fout. Les: bij een falende test eerst de *test* wantrouwen, dan pas de code.

**6. Hoe hebben we het getest?**
✅ Read-your-writes, gesorteerde keys en delete. ✅ De volgorde `storage.write` vóór `message.send`. ✅ Niets opgeslagen bij een fout. ✅ Ongeldige keys en waarden worden geweigerd. ✅ Property test: de opslag na elke willekeurige reeks crashes is gelijk aan wat je uit de trace kunt afleiden, en `boots` = 1 + het aantal recoveries. ✅ Mutaties "crash wist de opslag" (5 tests falen) en "mislukte handler slaat toch op" (1 test faalt) worden gevangen.

**7. Wat heb ik hiervan geleerd?**
Persistentie is een **contract over tijd**: wát is wanneer veilig. Atomaire stappen maken dat contract eenvoudig en controleerbaar.

**8. Belangrijkste begrippen**
- **Durability (duurzaamheid):** data overleeft een crash.
- **Commit:** het moment waarop wijzigingen definitief worden.
- **Read-your-writes:** je ziet je eigen nog niet vastgelegde wijzigingen.
- **fsync:** het besturingssysteem dwingen data echt naar de schijf te schrijven.

**Dit moet ik zelf kunnen uitleggen**
1. Wat betekent `sync-on-commit`, en waarom is het correct dat een crash nooit halverwege een handler valt?
2. Waarom komt `storage.write` in de trace vóór de berichten van dezelfde stap, en welk Raft-probleem modelleert dat?
3. Hoe ziet een handler zijn eigen nog niet opgeslagen writes (read-your-writes)?

### CP1.3 — Het faultplan: fouten als reproduceerbare invoer

**1. Wat hebben we gebouwd?**
Een **faultplan** in de configuratie (`faults.ts`): een lijst als `{ at: 100, type: 'crash', node: 'n2' }`. Ondersteund worden `crash`, `recover`, `partition`, `heal`, `link` (verlies/vertraging op één richting) en `link-restore`.

**2. Waarom hebben we dit nodig?**
Een fout die op een willekeurig moment "van buitenaf" komt, maakt de simulatie onreproduceerbaar. Als fouten gewone invoerdata zijn, blijft de trace een pure functie van de configuratie, en kun je een gevonden bug altijd opnieuw afspelen.

**3. Hoe werkt het?**
Het plan wordt bij de grens streng gevalideerd (onbekende velden worden geweigerd, zodat een typfout als `nodes` in plaats van `node` niet stilletjes wordt genegeerd), krijgt ids `f1, f2, …`, en wordt in zijn geheel in `run.start` opgeslagen. Daarna worden alle faults als gewone events in de scheduler gezet, direct na de node-starts.

Dat levert gratis een heldere regel op voor gelijktijdige events. Faults krijgen een laag volgnummer (`seq`), omdat ze vóór de run worden ingepland. Alles wat tijdens de run ontstaat (berichten, timers) krijgt een hoger nummer. Dus:

> Op hetzelfde tijdstip gaan geplande faults altijd vóór berichten en timers, en onderling in de volgorde van het plan.

**4. Welke keuzes hebben we gemaakt?**
We hebben géén extra "prioriteitsklasse" aan de scheduler toegevoegd. De bestaande regel (tijd, seq) geeft het gewenste gedrag al. Faults die tijdens een run interactief worden toegevoegd (later, via de UI) zouden deze regel breken; dat is genoteerd voor wanneer die functie komt (ADR-0009).

**5. Welke problemen kwamen we tegen?**
Een plan met meer faults dan `maxPendingEvents` zou de run direct na de eerste stap stoppen. Dat wordt nu al bij de validatie afgewezen, met een duidelijke foutmelding.

**6. Hoe hebben we het getest?**
✅ 42 negatieve tests met ongeldige plannen en configvelden, elk met het exacte foutpad (zoals `faults[0].groups[1][0]`). ✅ Tests voor alle tijdstip-randgevallen. ✅ Property test: willekeurige faultplannen geven bij herhaling exact dezelfde trace.

**7. Wat heb ik hiervan geleerd?**
Door fouten als *data* te behandelen in plaats van als *gebeurtenissen van buitenaf*, erven ze automatisch alle determinisme-garanties van CP0.

**8. Belangrijkste begrippen**
- **Fault injection:** bewust fouten veroorzaken om robuustheid te testen.
- **Idempotent:** twee keer uitvoeren heeft hetzelfde effect als één keer.
- **Validatie aan de grens:** invoer controleren op de plek waar hij binnenkomt.

### CP1.4 — Netwerkfouten en berichten onderweg

**1. Wat hebben we gebouwd?**
Het netwerk (`network.ts`) kent nu **partities** (groepen nodes die elkaar niet meer kunnen bereiken) en **linkfouten** per richting: kans op verlies, en extra vertraging.

**2. Waarom hebben we dit nodig?**
Partities zijn de klassieke oorzaak van *split brain*: twee helften van een cluster die elk denken de baas te zijn. Eenrichtingsverlies veroorzaakt notoir lastige bugs. Het belangrijkste deel van dit onderwerp is: wat gebeurt er met berichten die al **onderweg** zijn als een fout begint of eindigt?

**3. Hoe werkt het?**
Bij **verzenden** wordt het lot van een bericht één keer bepaald, in deze volgorde: (1) partitie tussen zender en ontvanger → gedropt; (2) verlies op deze link → misschien gedropt; (3) anders: aankomsttijd = basislatency + eventuele extra vertraging.
Bij **aankomst** wordt opnieuw gecontroleerd: (1) is er nú een partitie → gedropt (`partitioned-in-flight`); (2) is de ontvanger gecrasht → gedropt (`node-down`).

Een nieuwe partitie snijdt dus ook berichten af die al onderweg zijn, net als een doorgeknipte kabel. Een linkwijziging doet dat níét, want het bericht "zat al op de lijn" onder de oude condities.

Elke drop heeft twee verwijzingen: `cause` (het bericht zelf: *waar kwam dit vandaan?*) en `conditionIndex` (de fout die het veroorzaakte: *waarom ging het mis?*). Zo kan de toekomstige UI precies uitleggen waarom een bericht verdween.

**4. Welke keuzes hebben we gemaakt?**
- Links zijn **gericht** (van → naar), omdat echte netwerkfouten vaak asymmetrisch zijn. Symmetrisch = twee faults.
- Extra random getallen worden alleen getrokken als er een fout actief is. Een run zonder fouten trekt daardoor precies dezelfde getallen als in CP0.

**5. Welke problemen kwamen we tegen?**
De eerste A/B-meting liet zien dat CP1 merkbaar trager was, ook zónder fouten. Elk bericht bouwde een string-sleutel (`"n1>n2"`) en deed een map-lookup, ook als er geen enkele linkfout bestond. Een simpele check (`links.size === 0`) haalde het grootste deel van die kosten weg. Zie CP1.6 voor de cijfers.

**6. Hoe hebben we het getest?**
✅ 13 tests in `network-faults.test.ts`: partitie tijdens vlucht, partitie bij verzenden, herstel vóór aankomst, vervanging van partities, gericht verlies, statistisch verlies (25% ingesteld → gemeten tussen 22% en 28%, vaste seed), vertraging, en restore zonder effect op berichten onderweg. ✅ Mutaties "geen partitiecheck bij aankomst" (5 falen), "geen partitiecheck bij verzenden" (3) en "linkfout in de verkeerde richting" (5) worden gevangen.

**7. Wat heb ik hiervan geleerd?**
De interessantste vragen zitten in de *overgangen*: wat gebeurt er met dingen die "onderweg" zijn op het moment dat de wereld verandert?

**8. Belangrijkste begrippen**
- **Netwerkpartitie:** het netwerk valt uiteen in groepen die elkaar niet bereiken.
- **Split brain:** twee delen van een systeem nemen elk tegelijk beslissingen.
- **In-flight message:** een bericht dat verstuurd maar nog niet aangekomen is.
- **Asymmetrische fout:** een fout die maar in één richting optreedt.

**Dit moet ik zelf kunnen uitleggen**
1. In welke volgorde wordt het lot van een bericht bepaald bij verzenden, en bij aankomst?
2. Waarom raakt een nieuwe partitie berichten onderweg wel, en een linkwijziging niet?
3. Wat is het verschil tussen `cause` en `conditionIndex` bij een gedropt bericht?

### CP1.5 — Onderzoek: een geheugenlek in de scheduler, opgelost met Floyd's heapify

**1. Wat hebben we gebouwd?**
**Compactie** van de heap in de scheduler (`scheduler.ts`), met een nieuwe methode `BinaryHeap.retain()` (`priority-queue.ts`).

**2. Waarom hebben we dit nodig?**
In CP0 werd lazy cancellation al genoemd als mogelijk probleem. Een crash annuleert nu in één keer alle timers van een node, en Raft zet zijn verkiezingstimer bij elk bericht opnieuw. Eerst meten, dan pas oplossen.

**3. Hoe werkt het?**
✅ **De meting.** Een simulatie van "elke tick een bericht, en bij elk bericht een timer van D ticks resetten", 200.000 stappen, met steeds maar 2 *levende* events:

| Timerduur D | Grootste heap |
|---|---|
| 300 | 301 entries |
| 10.000 | 10.001 entries |
| 1.000.000 | **200.002 entries** |

Een dode entry verdwijnt pas als zijn geplande tijd aanbreekt. Bij lange timers die vaak gereset worden, groeit de heap dus mee met de looptijd: 100.000 keer meer entries dan nodig.

**De oplossing.** Zodra er minstens 1024 dode entries zijn én dat er meer zijn dan levende, filteren we de array tot alleen de levende events en bouwen we de heap opnieuw op met **Floyd's algoritme**: laat elk knooppunt, van de laatste ouder terug tot de wortel, naar beneden zakken.

```ts
for (let i = (write >> 1) - 1; i >= 0; i--) this.#siftDown(i);
```

Waarom is dat O(n) en niet O(n log n)? De helft van de knopen zijn bladeren (geen werk), een kwart zit één niveau hoger (maximaal 1 stap), een achtste twee niveaus (maximaal 2 stappen), enzovoort. De som n/4·1 + n/8·2 + n/16·3 + … blijft onder n.

**4. Welke keuzes hebben we gemaakt?**
Een alternatief was een *indexed heap*: van elk event de positie bijhouden, zodat je het meteen kunt verwijderen. Dat vraagt extra boekhouding bij élke verwisseling in de heap, de drukst gebruikte code van de engine. Compactie is eenvoudiger. Omdat elke compactie minstens de helft van de array opruimt, kost het gemiddeld (*geamortiseerd*) O(1) per annulering. Zie ADR-0011.

**Waarom verandert dit de simulatie niet?** Uit CP0: de ordening (tijd, seq) is een strikte totale orde. Elke geldige heap met dezelfde events geeft ze dus in exact dezelfde volgorde terug. Compactie is onzichtbaar voor de trace.

**5. Welke problemen kwamen we tegen?**
Geen bugs, maar wel een les: zonder meting hadden we niet geweten dat het probleem alleen bij *lange* timers speelt. Bij korte timers lost het zichzelf op.

**6. Hoe hebben we het getest?**
✅ Een model-based property test vergelijkt de scheduler met agressieve drempels (1, 2, 8) met een simpel referentiemodel, en controleert na elke stap dat `heapEntries ≤ 2·levend + drempel`. ✅ De meetopzet van hierboven is nu een regressietest: de heap blijft onder 1.029 entries (was 200.002). ✅ In een heartbeat-run met timeouts van 10⁶ ticks blijft de heap onder 1.200 entries. ✅ De mutatie "retain zonder heapify" laat 2 tests falen.

**7. Wat heb ik hiervan geleerd?**
Meet eerst. En een sterke invariant uit een eerder checkpoint (de strikte totale orde) maakt een latere optimalisatie veilig zonder extra werk.

**8. Belangrijkste begrippen**
- **Geheugenlek:** geheugen dat niet vrijkomt terwijl het niet meer nodig is.
- **Compactie:** opruimen en opnieuw opbouwen van een datastructuur.
- **Floyd's heapify:** een heap bouwen in O(n) door van onder naar boven te laten zakken.
- **Geamortiseerde complexiteit:** de gemiddelde kosten per operatie over een lange reeks.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom groeide de heap bij D = 1.000.000 wel en bij D = 300 niet?
2. Waarom is Floyd's heapify O(n)?
3. Waarom kan compactie de trace niet veranderen?

### CP1.6 — Testen: een onafhankelijk trace-orakel, willekeurige faultplannen en mutaties

**1. Wat hebben we gebouwd?**
- Een **trace-orakel** (`test/invariants.ts`): een volledig losse implementatie van de regels die alleen naar de trace kijkt. Het houdt per node de status en incarnatie bij, per timer of hij nog loopt, per bericht of het al afgeleverd of gedropt is, en de actieve partitie. Daarna meldt het elke overtreden regel.
- **Property tests** (`faults.property.test.ts`) die honderden willekeurige faultplannen genereren en het orakel erop loslaten.

**2. Waarom hebben we dit nodig?**
Met handgeschreven tests check je alleen de gevallen die je zelf bedenkt. Bij fouten zijn de gevaarlijke gevallen juist de combinaties waar je níét aan denkt: crash + recovery + timer op één tick, tijdens een partitie, met verlies op een link.

**3. Hoe werkt het?**
fast-check genereert configuraties met een seed, latency en tot 20 fault-groepen. Per plan draait de simulatie, waarna het orakel de trace controleert. Eén orakelregel is bijvoorbeeld: "een `timer.fire` moet dezelfde incarnatie hebben als de `timer.set`". Omdat het orakel geen code deelt met de engine, moet een bug twee keer op dezelfde manier gemaakt worden om erdoor te glippen.

**4. Welke keuzes hebben we gemaakt?**
Het orakel staat bewust in de tests, niet in de engine. In CP2 wordt het de basis voor een echt invariant-systeem in de engine.

**5. Welke problemen kwamen we tegen?**
Twee leerzame:
- **De generator was te braaf.** Alle property tests slaagden meteen. Dat was verdacht, dus hebben we gemeten wat de generator eigenlijk maakte: ✅ maar in 19 van de 150 plannen herstartte er ooit een node. Een losse `recover` op een willekeurig moment raakt meestal een node die nog draait. Een "outage"-generator (crash, en daarna recovery van dezelfde node, soms op dezelfde tick) bracht dat naar ✅ 119 van 150, met 85 keer crash + recovery op dezelfde tick. Les: een property test is zo goed als zijn generator, dus meet die.
- **Een bug in onze eigen mutatie-tooling.** Een eerste shell-script pijpte één mutant naar `| true`. Daardoor werd het proces afgebroken vóórdat het bestand werd hersteld, en de volgende meting (31 falende tests) was dus nep. We merkten het omdat de normale testsuite daarna faalde. Opgelost met een Python-script dat altijd herstelt (`finally`), een controle met checksums tegen een bekende goede kopie, en het opnieuw draaien van de betreffende mutanten. Les: ook je testgereedschap kan liegen, dus verifieer het.

**6. Hoe hebben we het getest?** (De resultaten)
✅ 224 tests in 13 bestanden, allemaal geslaagd. De suite draait in ±1,8 s, inclusief 480 willekeurige fault-experimenten (150 + 150 + 75 + 30 + 75 over de vijf property tests). ✅ Dekking: 98,2% van de regels en 96,2% van de branches (CP0: 97,3% en 95,0%). ✅ Alle 15 mutanten (M1–M14 plus M1b) gevangen; zie `docs/TEST_STRATEGY.md`. ✅ Een CP1-trace zonder fouten, teruggebracht naar het CP0-formaat, geeft exact de CP0-vingerafdruk `62159051`. Dat bewijst dat ordening en random trekkingen voor foutloze runs niet veranderd zijn. ✅ Nieuwe golden fingerprints: `d13876e0` (CP0-referentie in het CP1-formaat) en `17b2dde2` (fault-referentie).

✅ **Prestaties** (A/B: de CP0-commit en CP1 naast elkaar op dezelfde laptop, 21 runs per versie, 200.000 events zonder fouten): mediaan **459 ms (CP0) tegenover 477 ms (CP1)**, ongeveer 4% overhead. CP1 heeft soms een trage uitschieter (547–660 ms); de oorzaak is nog niet geprofileerd (💭 mogelijk garbage collection door grotere trace-entries). Een fault-zware run (8 nodes, 1.360 faults, 200.000 events, ±899.000 trace-entries) duurt ±1,4 s.

**7. Wat heb ik hiervan geleerd?**
Vertrouw niet op "alle tests groen". Controleer of de tests de juiste gevallen raken (generator-diversiteit), of ze falen als de code fout is (mutaties), en of je meetgereedschap zelf klopt.

**8. Belangrijkste begrippen**
- **Test-orakel:** een onafhankelijke manier om te bepalen of uitvoer correct is.
- **Invariant:** een eigenschap die altijd waar moet zijn.
- **Generator:** de code die willekeurige testinvoer maakt.
- **A/B-meting:** twee versies onder gelijke omstandigheden vergelijken.
- **Mediaan:** de middelste waarde; minder gevoelig voor uitschieters dan het gemiddelde.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom vangt een onafhankelijk orakel bugs die de assertions in de engine missen?
2. Hoe ontdekten we dat de generator te weinig recoveries maakte, en waarom was dat erg?
3. Waarom vergelijk je prestaties met een A/B-meting op dezelfde machine, en waarom met de mediaan?

### CP1 — Bekende beperkingen

- Faults liggen vooraf vast. Er is nog geen tegenstander die reageert op de toestand ("crash de huidige leider"), en ook nog geen interactieve injectie vanuit de UI.
- Eén persistentiemodel (sync-on-commit). Verlies van niet-gesyncte writes kan nog niet worden gemodelleerd.
- Geen duplicatie van berichten, geen optionele FIFO-links, geen basislatency per link.
- Een handler met een oneindige lus kan nog steeds niet worden onderbroken (komt met de Web Worker in CP5).
- De trage uitschieters in de prestatiemeting zijn nog niet verklaard (zie hieronder).

### CP1 — Open onderzoek PERF-1: trage uitschieters

**Wat zagen we?** ✅ In de A/B-meting (21 runs per versie, 200.000 events zonder fouten) was de mediaan van CP1 477 ms. Toch duurden losse runs 547–660 ms, en dat kwam vaker voor dan bij CP0.

**Is het een correctheidsprobleem?** Nee. ✅ De determinisme-tests laten zien dat de trace bij elke run byte-voor-byte gelijk is. Alleen de *wandkloktijd* (hoe lang het echt duurt) varieert, niet *wat* er berekend wordt. Daarom hebben we besloten de commit hier niet voor uit te stellen en niet blind te optimaliseren.

**Mogelijke oorzaken** (💭 allemaal nog niet geverifieerd):
1. **Garbage collection (GC):** JavaScript ruimt ongebruikt geheugen automatisch op, en dat kost af en toe een pauze. CP1 maakt per stap iets meer objecten aan (extra `incarnation`-velden, een `storage`-object per handler), dus er valt mogelijk vaker een GC-pauze.
2. **JIT-deoptimalisatie:** de JavaScript-engine optimaliseert code op basis van de vormen van objecten die hij ziet. Meer soorten trace-entries kan die optimalisatie soms ongedaan maken.
3. **Ruis:** andere processen op de laptop.

**Plan (CP9):** meten met `node --trace-gc` en `--cpu-prof`, het geheugengebruik per event vergelijken tussen CP0 en CP1, en meer runs doen in een rustigere omgeving. Pas daarna beslissen of en hoe we optimaliseren.

**Wat leer ik hiervan?** Een mediaan vertelt het "normale" verhaal, maar uitschieters kunnen een eigen oorzaak hebben. Benoem ze eerlijk, scheid "is het fout?" van "is het traag?", en optimaliseer pas na meten.

**Begrippen**
- **Wandkloktijd:** de echte tijd die een berekening kost (in tegenstelling tot virtuele tijd).
- **Garbage collection:** het automatisch vrijgeven van geheugen dat niet meer gebruikt wordt.
- **JIT-compiler:** compileert JavaScript tijdens het uitvoeren naar snelle machinecode, op basis van wat hij ziet.
- **Profileren:** meten waar een programma zijn tijd en geheugen aan besteedt.

---

## CP2 — Invarianten, verklaarbare overtredingen en fault-exploratie

**Datum:** 2026-10-08 · **Status:** afgerond en goedgekeurd · **Engine-versie:** `0.3.0-cp2`

CP1 kon fouten veroorzaken. CP2 laat de engine zelf zien wanneer een protocol daardoor een regel breekt die altijd zou moeten gelden, en zoekt daarna automatisch het *kleinste* scenario dat die fout veroorzaakt. Het einddoel is een complete keten: willekeurige faultplannen → overtreding → verkleinen → opslaan → exact opnieuw afspelen.

Ontwerp vooraf: ADR-0012 (invariantmodel), ADR-0013 (beleid en verklaarbare overtredingen), ADR-0014 (exploratie en shrinking), en de acceptatiecriteria in `docs/ROADMAP.md`.

### CP2.1 — Safety properties en invarianten als uitvoerbare specificaties

**1. Wat hebben we gebouwd?**
Een **invariant** is een stuk code dat na elke stap van de simulatie controleert of een regel nog geldt (`invariants.ts`). Bijvoorbeeld: "er is hooguit één leider". De engine roept alle invarianten aan, in een vaste volgorde, met een alleen-lezen beeld (*view*) van het hele systeem.

**2. Waarom is dit nodig?**
Een specificatie in een Word-document kun je niet testen. Een invariant is een specificatie die de computer kan *uitvoeren*. Zo weet je niet alleen dát een protocol "raar doet", maar precies welke regel wanneer brak.

**3. Hoe werkt het?**
Er zijn twee soorten eigenschappen:
- Een **safety property** zegt "er gebeurt nooit iets slechts" (nooit twee leiders). Die kun je controleren door na elke stap te kijken.
- Een **liveness property** zegt "uiteindelijk gebeurt er iets goeds" (er komt ooit een leider). In een eindige run kun je dat alleen tot een deadline controleren. Dat komt in CP4.

En er zijn twee soorten invarianten:
- **State-invariant:** kijkt alleen naar *nu*. Voorbeeld: `single-leader`, "op dit moment hooguit één leider".
- **Historische invariant:** onthoudt iets uit het verleden in een expliciete `history`. Voorbeeld: `unique-leader-per-epoch`, "per epoch ooit maar één leider". Twee leiders van dezelfde epoch op *verschillende* momenten ziet een state-invariant niet, een historische wel.

```ts
// Historische invariant: history is gewone JSON die de engine bewaart.
check: ({ view, history }) => {
  // … vergelijk de huidige leiders met wat in history staat …
  return { ok: true, history: next };
}
```

**4. Welke keuzes zijn gemaakt?**
- Invarianten draaien **online** (tijdens de run), niet pas achteraf over de trace. Zo kan een run stoppen bij de eerste overtreding.
- De history is **expliciete, geversioneerde JSON** die de engine beheert, en geen verborgen variabele in de invariant. Daardoor is ze deterministisch, controleerbaar (`sim.invariantHistory(id)`) en later op te nemen in snapshots (CP3).

**5. Welke problemen kwamen we tegen?**
Invarianten zijn *trusted code*: we vertrouwen erop dat ze geen `Math.random()` gebruiken. Een sandbox voor onbetrouwbare code komt pas in CP10.

**6. Hoe hebben we het getest?**
✅ Een test telt dat elke stap precies één keer gecontroleerd wordt (ook fault-stappen en stappen met alleen een drop). ✅ Een run met en zonder een onschuldige invariant geeft exact dezelfde trace, op de `run.start`-metadata na. ✅ Omdat invarianten pure functies zijn, kunnen we ze ook los testen met zelfgemaakte views.

**7. Wat heb ik hiervan geleerd?**
Een goede specificatie is *uitvoerbaar*. En "nu" en "ooit" zijn verschillende soorten regels die verschillende hulpmiddelen nodig hebben.

**8. Belangrijkste begrippen**
- **Invariant:** een eigenschap die altijd waar moet zijn.
- **Safety vs. liveness:** "nooit iets slechts" vs. "uiteindelijk iets goeds".
- **State- vs. historische invariant:** alleen het heden vs. ook het verleden.
- **Runtime verification:** eigenschappen controleren terwijl het programma draait.

**Dit moet ik zelf kunnen uitleggen**
1. Wat is het verschil tussen safety en liveness, en waarom controleert FaultLab (nog) alleen safety?
2. Bedenk een scenario waarin twee nodes leider zijn van dezelfde epoch, maar nooit tegelijk. Waarom ziet `single-leader` dit niet, en wat moet `unique-leader-per-epoch` in zijn history bijhouden om het wél te zien?
3. Waarom moet de history van een invariant expliciete JSON zijn?

### CP2.2 — Een controle mag niets veranderen: runtime-onveranderlijkheid

**1. Wat hebben we gebouwd?**
Een alleen-lezen `SimulationView` waarin **alles diep bevroren is** (`Object.freeze` op elk niveau), plus een test die dat bewijst door het hele objectnetwerk af te lopen (*graph walk*).

**2. Waarom is dit nodig?**
Een controle die de simulatie beïnvloedt, meet zichzelf. Stel dat een invariant per ongeluk `state.role = 'follower'` doet: dan zou de "gecontroleerde" run anders verlopen dan de echte.

**3. Hoe werkt het?**
TypeScript's `readonly` bestaat alleen tijdens het compileren. Tijdens het draaien is het verdwenen, dus het is **geen** echte bescherming. Daarom bevriezen we de data echt. Schrijven naar bevroren data geeft in strict mode een `TypeError`; die wordt netjes vastgelegd als `invariant.error`. De graph-walk-test volgt elke eigenschap (ook getters) en controleert dat elk bereikbaar object bevroren is en geen engine-object is (geen `Map`, geen `NodeRuntime`).

**4. Welke keuzes zijn gemaakt?**
Opslag, berichten onderweg en netwerkcondities worden per stap pas gekopieerd en bevroren als een invariant ze opvraagt (*lazy*). Wat niet gebruikt wordt, kost niets.

**5. Welke problemen kwamen we tegen?**
✅ **Een echte bug uit CP0/CP1.** De graph-walk-test vond dat trace-entries maar *oppervlakkig* bevroren waren: de entry zelf wel, maar de lijst `cancelledTimers` in een `node.crash`-entry (en `run.start.protocol`) niet. Iedereen met toegang tot de trace kon die dus aanpassen. De oude test controleerde alleen `Object.isFrozen(entry)`, één niveau diep. De oplossing: `EventTrace.append` bevriest nu alles diep. Een nieuwe regressietest faalt op de oude code en slaagt op de nieuwe.

**6. Hoe hebben we het getest?**
✅ 11 verschillende pogingen tot aanpassing (state, opslag, lijsten, de view zelf, trace-entries, …). Elke poging gaf een echte schrijfweigering, zoals "Cannot assign to read only property", en de trace tot aan de fout was identiek aan die van een onschuldige run. ✅ Stille pogingen via `Reflect.set` geven `false` en veranderen niets.

**7. Wat heb ik hiervan geleerd?**
Types beschermen tijdens het programmeren, maar niet tijdens het draaien. En een test die maar één niveau diep kijkt, kan een fout jarenlang missen.

**8. Belangrijkste begrippen**
- **Immutability (onveranderlijkheid):** data die na het maken niet meer kan veranderen.
- **Shallow vs. deep freeze:** alleen het buitenste object, of alles erin.
- **Side effect:** een verandering buiten de functie zelf.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom is `readonly` in TypeScript geen runtime-bescherming?
2. Stel dat een invariant `view.nodes[0].state.lastHeard.n2 = 0` uitvoert. Wat gebeurt er nu precies? En wat zou er misgaan in de simulatie en in de trace als de state maar *oppervlakkig* bevroren was?

### CP2.3 — Verklaarbare overtredingen en beleid

**1. Wat hebben we gebouwd?**
Een gestructureerde **overtredingsrecord** (`invariant.violation`) en twee beleidsvormen: `stop-on-first` (standaard) en `record-and-continue`.

**2. Waarom is dit nodig?**
"Test faalt" is niet genoeg om een gedistribueerde bug te begrijpen. De toekomstige UI moet de betrokken nodes kunnen oplichten, naar het veroorzakende event kunnen springen, de causale keten kunnen tonen, verwacht en waargenomen naast elkaar kunnen zetten, en de fout exact opnieuw kunnen afspelen.

**3. Hoe werkt het?**
Het record bestaat uit twee delen:
- Wat de **invariant beweert**: betrokken nodes, `expected`, `observed`, gestructureerd bewijs (`evidence`) en verwijzingen naar eerdere trace-entries.
- Wat de **engine waarnam** (feiten): het event dat de stap startte (`trigger`), de reeks entries van die stap, per node waar zijn huidige state vandaan kwam (`stateEntry`), welke faults op dat moment actief waren, en het eventnummer om tot precies dat punt te kunnen herhalen.

De engine schrijft **nooit** "veroorzaakt door de partitie". Dat is een conclusie, geen feit. Hij schrijft wel: "deze partitie was op dat moment actief". De UI mag later kandidaat-oorzaken voorstellen, maar dan duidelijk als vermoeden.

Bij `record-and-continue` is één aanhoudende fout één **episode**: één entry bij het begin, en een `invariant.cleared` als de regel weer geldt. Zo voorkom je duizenden dubbele meldingen. Falen er meerdere invarianten in dezelfde stap, dan worden ze vastgelegd in de volgorde van de configuratie. Een crashende invariant stopt de run altijd, want een kapotte controle is niet te vertrouwen.

**4. Welke keuzes zijn gemaakt?**
Ontdubbelen per invariant, niet per combinatie van nodes. Een fout die van nodes wisselt, blijft zo één incident (ADR-0013).

**5. Welke problemen kwamen we tegen?**
In één test nam ik aan dat er een event op precies t=100 zou zijn. Dat was niet zo; de eerste stap ná 100 was op t=103. De test zat fout, niet de engine.

**6. Hoe hebben we het getest?**
✅ Tests voor stop-on-first, episodes, `invariant.cleared`, de limiet `maxViolations`, de volgorde bij meerdere fouten, crashende controles en 10 soorten ongeldige uitkomsten (onbekende node, te lange tekst, verwijzing naar de toekomst, …). ✅ Op het split-brain-scenario wijzen alle feitvelden naar de juiste entries.

**7. Wat heb ik hiervan geleerd?**
Een goede foutmelding scheidt **feiten** van **conclusies**, en bevat alles wat nodig is om de fout opnieuw te zien.

**8. Belangrijkste begrippen**
- **Explainability (uitlegbaarheid):** een resultaat kunnen onderbouwen.
- **Provenance (herkomst):** waar een stuk data vandaan kwam.
- **Episode:** de periode waarin een fout aanhoudt.

**Dit moet ik zelf kunnen uitleggen**
1. Een UI toont bij een overtreding: "Oorzaak: partitie f2". Welke velden van het record rechtvaardigen die tekst, welke niet, en hoe zou jij het formuleren zodat feit en vermoeden gescheiden blijven?
2. Waarom zegt de engine niet "veroorzaakt door de partitie"?
3. Wat gebeurt er bij `record-and-continue` als een fout 50 stappen aanhoudt?

### CP2.4 — Split brain: een opzettelijk onveilig leider-algoritme

**1. Wat hebben we gebouwd?**
`createNaiveLeaderProtocol` (`fixtures/naive-leader.ts`): een node wordt leider als hij de hoogste node is die hij nog hoort. Daarbij horen vijf invarianten.

**2. Waarom is dit nodig?**
We willen laten zien dat de keten *echte* bugs vindt. Dit protocol is expres zo gemaakt dat het goed werkt op een gezond netwerk maar faalt bij een partitie: **split brain**.

**3. Hoe werkt het?**
Elke node stuurt elke ~20 ticks een heartbeat. Een node die minstens `timeout` (60) ticks draait en geen hogere node meer hoort, wordt leider met epoch = (hoogst geziene epoch) + 1. Hoort een leider een hogere node, dan treedt hij meteen af.

- **Geen vals alarm bij het opstarten.** Direct na de start denkt elke node "ik hoor niemand", en zou dus leider worden. Daarom mag niemand claimen vóór `timeout`; tegen die tijd heeft iedereen de hogere nodes gehoord. We losten dit op in het *protocol*, niet door de invariant soepeler te maken.
- **De demonstratie.** Eerst wordt n4 stabiel leider. Daarna isoleert een partitie n4 (t=300). n3 hoort n4 niet meer en wordt om t=347 ook leider: ✅ `single-leader` faalt, met n3 (epoch 2) en n4 (epoch 1).

**4. Welke keuzes zijn gemaakt?**
De leider-epoch staat los van de "hoogst geziene" epoch, zodat de historische invariant het juiste meet.

**5. Welke problemen kwamen we tegen?**
Dit is het leerzaamste deel van CP2. De property tests vonden **twee echte zwaktes** die we vooraf niet bedacht hadden:
1. ✅ **Vluchtige epochs.** In de eerste versie stond de epoch alleen in het geheugen. Als alle nodes crashten, wist niemand meer dat epoch 1 al gebruikt was, en een nieuwe leider nam opnieuw epoch 1. Oplossing: de epoch opslaan in persistente storage, precies zoals Raft `currentTerm` opslaat. Het gevonden scenario is nu een vaste regressietest.
2. ✅ **Opslaan is niet genoeg zonder quorum.** Een stresstest met 3.000 plannen vond daarna dat het nog steeds mis kan gaan, zónder enige netwerkfout. Als de enige node die de nieuwste epoch kent net gecrasht is, weet niemand anders ervan en wordt dezelfde epoch opnieuw gebruikt. Alleen een **meerderheid (quorum)** lost dit op: twee meerderheden overlappen altijd in minstens één node, die het dan weet. Dat is precies het idee achter Raft (CP4). Deze zwakte staat bewust gedocumenteerd, met een eigen test.

✅ `single-leader` bleef wél gelden in 4.000 willekeurige plannen met alleen crashes en herstarts.

**6. Hoe hebben we het getest?**
✅ 50 seeds × 2 clustergroottes zonder faults: niemand claimt vóór t=60, alleen de hoogste node wordt ooit leider, en geen enkele invariant faalt. ✅ Property test met 150 crash/recover-plannen: `single-leader` en drie andere invarianten blijven gelden. ✅ Split brain na stabilisatie, met alle verklarende velden gecontroleerd. ✅ Een scenario waarin alleen de historische invariant faalt.

**7. Wat heb ik hiervan geleerd?**
"Wie zwijgt, is dood" is in een netwerk een gevaarlijke aanname. En property tests vinden fouten waar je zelf niet aan denkt: twee keer, in één checkpoint.

**8. Belangrijkste begrippen**
- **Split brain:** twee delen van een systeem nemen tegelijk de leiding.
- **Epoch / term:** een oplopend nummer dat "regeerperiodes" onderscheidt.
- **Quorum:** een meerderheid. Twee meerderheden overlappen altijd.
- **Failure detector:** iets dat probeert te raden welke nodes kapot zijn.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom geeft het protocol geen vals alarm tijdens het opstarten?
2. Waarom loste het opslaan van de epoch het eerste probleem op, maar niet het tweede?
3. Leg uit waarom twee meerderheden altijd overlappen, en waarom dat split brain voorkomt.

### CP2.5 — Property-based exploratie en het verkleinen van tegenvoorbeelden

**1. Wat hebben we gebouwd?**
Een exploratiehulp (`test/explore.ts`) die met fast-check willekeurige faultplannen genereert, een overtreding zoekt, die verkleint (*shrinking*) en het resultaat controleert.

**2. Waarom is dit nodig?**
Een tegenvoorbeeld met 10 faults is moeilijk te begrijpen. Hetzelfde probleem met 1 of 2 faults is meteen duidelijk.

**3. Hoe werkt het?**
1. fast-check genereert plannen en draait de simulatie tot een invariant faalt.
2. **Shrinking:** fast-check probeert steeds kleinere varianten (minder faults, eerdere tijden, eenvoudigere waarden) en houdt de kleinste die nog faalt.
3. Een extra **greedy stap** probeert daarna elke fault één voor één weg te laten.
4. Het resultaat is **1-minimaal**: haal je één willekeurige fault weg, dan verdwijnt de overtreding. Dat is niet per se het *allerkleinste* plan, maar wel een precieze, controleerbare definitie.

Faults beginnen in deze exploratie pas vanaf t=150, als er al een stabiele leider is. Zo laat elk tegenvoorbeeld zien hoe een fault een *gevestigde* leider breekt.

**4. Welke keuzes zijn gemaakt?**
De exploratie staat in de testcode, zodat fast-check geen dependency van de engine wordt. We gingen er niet van uit dat het kleinste voorbeeld precies één partitie bevat, en dat bleek terecht (zie hieronder).

**5. Welke problemen kwamen we tegen?**
✅ Gemeten resultaten (fast-check-seed 424242):

| Invariant | Eerste fout na | Origineel | Shrink-stappen | Verkleind tot |
|---|---|---|---|---|
| `single-leader` | 1 run | 3 faults | 2 | 1 partitie (n3 geïsoleerd, t=150) |
| `unique-leader-per-epoch` | 19 runs | 10 faults | 28 | **2 partities** (t=150 en t=196) |

Het tweede geval laat zien waarom "precies één partitie" geen goede verwachting was: de fout heeft twee opeenvolgende netwerksplitsingen nodig.

**6. Hoe hebben we het getest?**
✅ Gevonden, geldig (gecontroleerd met `resolveFaults`), 1-minimaal (onafhankelijk gecontroleerd), deterministisch opnieuw af te spelen, en de leider was stabiel vóór de eerste fault.

**7. Wat heb ik hiervan geleerd?**
Een computer kan een kleine, begrijpelijke reproductie van een bug vinden, zolang je precies definieert wat "klein" betekent.

**8. Belangrijkste begrippen**
- **Property-based testing:** testen met automatisch gegenereerde invoer.
- **Shrinking:** een falend voorbeeld automatisch verkleinen.
- **Counterexample (tegenvoorbeeld):** concrete invoer waarvoor een eigenschap niet geldt.
- **1-minimaal:** elke afzonderlijke fault is nodig.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom is een tegenvoorbeeld met 1 fault waardevoller dan hetzelfde probleem met 10 faults? En waarom kan shrinking nooit een ongeldig plan opleveren, zoals een link van n1 naar n1?
2. Verzin een faultplan dat 1-minimaal is, maar niet het kleinst mogelijke plan voor dezelfde fout. Wat zegt dat over de garantie die onze exploratie geeft?

### CP2.6 — Deterministische reproductie

**1. Wat hebben we gebouwd?**
- Opgeslagen tegenvoorbeelden als JSON-fixtures (`test/counterexamples/`), formaat `faultlab-counterexample/1`.
- Een vaste seed voor alle property tests.
- *Legacy projections*: oude golden fingerprints blijven controleerbaar.

**2. Waarom is dit nodig?**
Een gevonden bug moet voor altijd een test blijven. En een testsuite die vandaag slaagt en morgen faalt zonder codewijziging, is onbetrouwbaar.

**3. Hoe werkt het?**
- Een fixture bevat de engineversie, het protocol met zijn opties, het faultplan, de invariant, hoe het voorbeeld gevonden is, en de verwachte uitkomst (tijd, nodes, eventnummer, trace-fingerprint). De replaytest moet exact dezelfde uitkomst geven.
- Klopt de engineversie van een fixture niet, dan faalt de test met een duidelijke melding, in plaats van de oude data stilletjes anders te interpreteren.
- fast-check koos eerst bij elke run een nieuwe willekeurige seed. Nu staat er één vaste seed in `test/setup.ts`; met `npm run test:explore` kun je bewust willekeurig zoeken.
- `test/legacy.ts` haalt de velden weg die latere versies *toevoegden*. Een CP2-trace zonder invarianten geeft dan exact de CP1- en CP0-vingerafdrukken (`d13876e0`, `17b2dde2`, `62159051`).

**4. Welke keuzes zijn gemaakt?**
We leggen de *replay* vast, niet het zoekproces: de shrink-route kan veranderen bij een nieuwe fast-check-versie, de replay hangt alleen van FaultLab af.

**5. Welke problemen kwamen we tegen?**
✅ Eén testbestand importeerde hulpfuncties uit een ánder testbestand. Daardoor draaiden 10 tests stilletjes dubbel en was het aantal tests opgeblazen (322 in plaats van 312). De gedeelde code staat nu in een gewoon module-bestand (`test/arbitraries.ts`).

**6. Hoe hebben we het getest?**
✅ Beide fixtures spelen exact opnieuw af (vingerafdrukken `c5be175f` en `9e7ae94a`). ✅ Een fixture met een aangepaste engineversie faalt zoals bedoeld. ✅ De suite gaf drie keer achter elkaar hetzelfde resultaat.

**7. Wat heb ik hiervan geleerd?**
Reproduceerbaarheid geldt niet alleen voor de simulatie, maar ook voor de tests zelf.

**8. Belangrijkste begrippen**
- **Fixture:** vastgelegde testdata.
- **Regressietest:** een test die een eerder gevonden fout bewaakt.
- **Flaky test:** een test die zonder codewijziging soms faalt.
- **Backward compatibility:** oude data blijft bruikbaar of wordt expliciet afgewezen.

**Dit moet ik zelf kunnen uitleggen**
1. Een collega verandert hoe `network.ts` latency trekt, en de fixture-test faalt. Wat betekent dat? En waarom zou het fout zijn om alleen de verwachte fingerprint bij te werken?
2. Waarom maakt een vaste fast-check-seed de suite betrouwbaarder, en wat verlies je daarmee?

### CP2.7 — De index van berichten onderweg

**1. Wat hebben we gebouwd?**
Een index van alle berichten die verstuurd maar nog niet afgeleverd of gedropt zijn, in verzendvolgorde (`sim.inFlight()`, `view.inFlight`).

**2. Waarom is dit nodig?**
Invarianten (en later de UI) moeten "wat is er onderweg?" snel kunnen beantwoorden, zonder de scheduler te doorzoeken.

**3. Hoe werkt het?**
Een bericht komt in de index als zijn aflevering wordt ingepland, en gaat eruit zodra dat afleverings-event wordt afgehandeld: afgeleverd, of gedropt door partitie of crash. Berichten die al bij het verzenden gedropt worden, komen er nooit in.

**4. Welke keuzes zijn gemaakt?**
Een `Map` op bericht-id: snel toevoegen en verwijderen, en de volgorde van invoegen is deterministisch.

**5. Welke problemen kwamen we tegen?**
Mijn eerste testscenario bereikte de reden `node-down` nooit, omdat alle berichten naar de gecrashte node al eerder gedropt werden. Het scenario is aangepast zodat alle vier de drop-redenen voorkomen.

**6. Hoe hebben we het getest?**
✅ Property test over willekeurige faultplannen: na *elke* stap is de index gelijk aan (a) de afleveringen in de scheduler, (b) wat je uit de trace kunt afleiden, en (c) wat een invariant ziet. Elk veld komt overeen met de bijbehorende `message.send`.

**7. Wat heb ik hiervan geleerd?**
Een extra datastructuur is alleen veilig als je kunt bewijzen dat hij gelijk blijft aan de bron van waarheid.

**8. Belangrijkste begrippen**
- **Index:** een hulpstructuur om iets snel op te zoeken.
- **Single source of truth:** één gezaghebbende bron; al het andere moet ermee kloppen.

### CP2.8 — Wat kost runtime-verificatie?

**1. Wat hebben we gebouwd?**
Metingen met 0, 1 en 5 invarianten.

**2. Waarom is dit nodig?**
Als controleren te duur is, zet niemand het aan. Dan moet je weten waar de kosten zitten.

**3. Hoe werkt het?**
Workload: naive leader met 8 nodes, 100.000 events, gezond netwerk, geen overtredingen. De drie configuraties draaiden om en om, 15 keer elk, in twee losse rondes.

✅ Resultaten (mediaan ronde 1 / ronde 2):
- 0 invarianten: 525 / 504 ms
- 1 invariant: 1.137 / 1.127 ms
- 5 invarianten: 2.637 / 2.677 ms

✅ Uitsplitsing: zonder invarianten 528 ms, met één invariant die *niets* doet 1.026 ms, met `single-leader` 1.166 ms. Ongeveer **5 µs per stap gaat dus naar het opbouwen van de bevroren view**, niet naar de controles zelf (`single-leader` kost ±1,4 µs per stap).

**4. Welke keuzes zijn gemaakt?**
Bewust **niet** geoptimaliseerd ("eerst meten, dan pas optimaliseren"). Het is vastgelegd als onderzoek **PERF-2**, met kandidaten: views hergebruiken voor nodes die niet veranderd zijn (veilig dankzij onveranderlijkheid), minder closures per stap, en invarianten alleen draaien bij relevante events. Harde voorwaarde voor elke toekomstige optimalisatie: **determinisme en runtime-onveranderlijkheid gaan altijd voor snelheid**. De bestaande tests (graph walk, aanvalspogingen, golden fingerprints) moeten ongewijzigd blijven slagen.

**5. Welke problemen kwamen we tegen?**
Mijn eerste meting liep tegen een timeout van 2 minuten aan; ik heb hem opnieuw op de achtergrond gedraaid. De gezonde-convergentie-test zat onder coverage-instrumentatie tegen de standaard testtimeout van 5 s aan; die test draait nu 50 seeds in plaats van 100, en de timeout is ruimer gezet.

**6. Hoe hebben we het getest?**
Herhaalde, afgewisselde runs met mediaan en spreiding. 💭 Het effect van CP2 op runs *zonder* invarianten is niet apart A/B-gemeten; zonder invarianten wordt de view niet eens gebouwd.

**7. Wat heb ik hiervan geleerd?**
Een "dure" functie is vaak duur door het klaarzetten van de invoer, niet door het rekenwerk zelf. Uitsplitsen laat zien waar je moet kijken.

**8. Belangrijkste begrippen**
- **Overhead:** extra kosten bovenop het eigenlijke werk.
- **Mediaan en spreiding:** het typische resultaat, en hoeveel het varieert.
- **Premature optimization:** optimaliseren voordat je weet waar het probleem zit.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom maak je een "doe-niets"-invariant om overhead te meten?
2. Waarom is het hergebruiken van views veilig in FaultLab?
3. Bedenk één manier om PERF-2 te versnellen. Hoe bewijs je dat determinisme en runtime-onveranderlijkheid daarbij intact blijven?

### CP2 — Kwaliteitscontrole en resultaten

✅ 313 tests (+2 die alleen fixtures schrijven) in 18 bestanden, allemaal geslaagd, in ±4,3 s. ✅ Dekking: 98,6% van de regels en 96,1% van de branches. ✅ 17 van 17 mutanten gevangen, waaronder "geen ontdubbeling", "view niet bevroren", "geen startvertraging in het protocol" (18 falende tests) en "epoch niet opgeslagen". ✅ De TypeScript-controles slagen.

### CP2 — Bekende beperkingen

- Liveness wordt nog niet gecontroleerd (CP4).
- Invarianten zijn trusted code, zonder sandbox.
- De zwaktes van het naive leader-protocol (split brain en hergebruik van epochs zonder quorum) zijn bewust niet opgelost; dat is de taak van Raft in CP4.
- PERF-1 (uitschieters) en PERF-2 (kosten van de view) staan open voor CP9.
- Exploratie is gericht zoeken, geen bewijs: niets vinden betekent niet dat er niets is.

---

## CP2.5 — Eerste realiteitscheck: FaultLab in de browser

**Datum:** 2026-10-08 · **Status:** afgerond en goedgekeurd · **Engine-versie:** `0.3.0-cp2` (ongewijzigd)

Tot nu toe bestond FaultLab alleen in tests. In CP2.5 draait de échte engine voor het eerst in een browser. Een kleine, tijdelijke viewer laat nodes, berichten, crashes, partities en invarianten-overtredingen zien. Het doel is niet de definitieve interface, maar controleren of de engine en een frontend goed samenwerken.

### CP2.5.1 — Uitvoeren versus afspelen

**1. Wat hebben we gebouwd?**
Een prototype in `apps/demo` (Vite + gewone TypeScript + SVG) met vijf experimenten: een gezond netwerk, crash/herstel/partitie, een partitie na convergentie (split brain), en de twee opgeslagen tegenvoorbeelden uit CP2.

**2. Waarom is dit nodig?**
Tests bewijzen dat de engine klopt. Ze laten niet zien of je de output ook kúnt begrijpen en tonen. Een visualisatie die zelf gebeurtenissen "verzint", zou bovendien alles ondermijnen wat we tot nu toe gebouwd hebben.

**3. Hoe werkt het?**
De viewer heeft twee strikt gescheiden fases:
1. **Uitvoeren (execute):** de echte `@faultlab/engine` draait het experiment helemaal af, in de browser, en levert een trace op. De experimenten zijn klein en begrensd, dus dit duurt maar een paar milliseconden.
2. **Afspelen (replay):** alles op het scherm is een *pure functie* van (trace, cursor, weergavetijd). Afspelen roept de engine nooit aan en kan dus niets veranderen aan wat er gebeurd is.

Berichten bewegen *lineair* in virtuele tijd tussen verzenden en aankomst. Een "versnellende" animatie zou de latency verkeerd weergeven.

**4. Welke keuzes zijn gemaakt?**
- Geen React en geen Three.js: dit is een wegwerp-prototype. Het herbruikbare deel is `derive.ts`, dat geen framework en geen DOM nodig heeft.
- De engine is **niet aangepast** voor de visualisatie (gecontroleerd: nul wijzigingen in `packages/`).
- Geist en Geist Mono worden lokaal meegeleverd (Fontsource, OFL-licentie), dus er is geen externe fontserver nodig.

**5. Welke problemen kwamen we tegen?**
Zie CP2.5.3.

**6. Hoe hebben we het getest?**
Zie CP2.5.2.

**7. Wat heb ik hiervan geleerd?**
"Live uitvoeren" en "terugkijken" zijn verschillende dingen. Als je ze scheidt, kan een visualisatie nooit de simulatie beïnvloeden.

**8. Belangrijkste begrippen**
- **Replay:** een vastgelegde uitvoering opnieuw bekijken.
- **Pure functie:** dezelfde invoer geeft altijd dezelfde uitvoer, zonder bijwerkingen.
- **Interpolatie:** een tussenpositie berekenen tussen twee bekende momenten.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom kan de afspeelsnelheid de uitkomst van de simulatie nooit veranderen?
2. Een bericht staat op het scherm halverwege een verbinding. Is dat engine-state of een afgeleide weergave? Hoe wordt die positie berekend?

### CP2.5.2 — Alleen tonen wat de trace kan bewijzen

**1. Wat hebben we gebouwd?**
`derive.ts` bouwt de toestand op elk punt van de trace opnieuw op: per node de status, incarnatie, state (en uit welke entry die komt) en opslag, plus de berichten onderweg, de actieve partitie en de linkfouten.

**2. Waarom is dit nodig?**
De opdracht was: toon alleen wat betrouwbaar uit de engine-output volgt. Dat moet je *bewijzen*, niet aannemen.

**3. Hoe werkt het?**
Een test laat de engine draaien met een "observator-invariant". Die krijgt na elke stap het gezaghebbende beeld van de engine zelf (de bevroren view uit CP2). Daarna moet `frameAt()` precies hetzelfde reconstrueren uit **alleen de trace**. We gebruiken dus de publieke invariant-API als meetinstrument.

**4. Welke keuzes zijn gemaakt?**
Waar een protocol samengevat wordt ("leader · epoch 2", "suspects n2"), komt dat rechtstreeks uit velden in de state. Er wordt niets geraden.

**5. Welke problemen kwamen we tegen?**
`frameAt()` loopt bij elk beeld de trace vanaf het begin door. Dat kost O(n) per frame: prima voor ±1.700 entries, niet voor een miljoen. Een geïndexeerde afleiding valt samen met de state-index die voor CP3 voorgesteld is.

**6. Hoe hebben we het getest?**
✅ De afleiding klopt na **elke stap** van alle vijf experimenten en van 40 willekeurige faultplannen. ✅ De opgeslagen tegenvoorbeelden geven ook in deze code dezelfde overtreding en vingerafdruk.

**7. Wat heb ik hiervan geleerd?**
"Toon alleen wat je kunt afleiden" is een eis die je kunt testen, door de afleiding na elke stap te vergelijken met de bron van waarheid.

**8. Belangrijkste begrippen**
- **Afgeleide toestand (derived state):** iets wat je uitrekent uit andere data, in plaats van het apart op te slaan.
- **Oracle:** de gezaghebbende bron waarmee je vergelijkt.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom gebruikt de test een invariant om de toestand van de engine vast te leggen?
2. Waarom schaalt `frameAt()` slecht, en welke CP3-functionaliteit zou dat oplossen?

### CP2.5.3 — Integratiebevindingen

**1. Wat hebben we gebouwd?**
Playwright-tests die in de lokaal geïnstalleerde Chrome het échte gedrag controleren, plus headless screenshots om zelf mee te kijken.

**2. Waarom is dit nodig?**
Een screenshot laat zien dát er iets staat. Een assertion bewijst dat het klopt: "n4 is leider", "drie verbindingen doorgesneden", "vingerafdruk komt overeen".

**3. Hoe werkt het?**
Elk belangrijk element heeft een `data-testid`. De tests klikken door de trace en controleren de getoonde toestand. Elke test faalt ook bij een onopgevangen JavaScript-fout in de pagina.

**4. Welke keuzes zijn gemaakt?**
Playwright gebruikt de Chrome die al op de laptop staat (`channel: 'chrome'`), zodat er geen browser gedownload hoeft te worden.

**5. Welke problemen kwamen we tegen?** (de eigenlijke opbrengst van deze check)
1. ✅ **De engine draaide meteen in de browser**, zonder één aanpassing. De CP0-keuze om de engine te compileren zónder browser- en Node-bibliotheken betaalde zich hier uit: er was niets te repareren. De gebundelde JavaScript is 52 kB (17 kB gzip), inclusief engine.
2. ✅ **Een gat in de publieke API:** de engine exporteert het type `TraceEntry`, maar niet de losse entry-types (zoals de overtreding). Eerst voegde ik die exports toe, maar dat draaide ik terug, want de afspraak was: de engine niet aanpassen voor de visualisatie. De viewer gebruikt nu `Extract<TraceEntry, { kind: … }>`. Advies voor CP5: de types netjes exporteren.
3. ✅ **Eerste browserrun: lege pagina.** Een fout in mijn viewer-code (elementen zonder `id`), niet in de engine. De console-uitvoer via Playwright wees het meteen aan.
4. ✅ **Een leerzame "fout" in mijn eigen test.** Ik verwachtte bij de `node.recover`-entry al `boots: 2` te zien. Maar op dat punt heeft `init` nog niets vastgelegd: de `storage.write` is de entry erná, omdat opslag binnen een stap als eerste wordt vastgelegd. De viewer had dus gelijk. Les voor de UI: een cursor per *entry* is iets anders dan een cursor per *stap*.
5. Twee kleine weergavefouten: het scrollen in het log scrolde de hele pagina mee, en het partitielabel werd afgeknipt. Beide verholpen, verder niet gepolijst.
6. De opgeslagen tegenvoorbeelden staan in de `test/`-map van de engine. De demo importeert ze direct, zodat er één bron van waarheid blijft, maar voor CP5 horen gedeelde experimenten op een eigen plek.
7. Het log is uitgebreid: 1.168 entries voor 421 events in het gezonde experiment. Een echte UI moet entries per stap kunnen groeperen en filteren.

**6. Hoe hebben we het getest?**
✅ 6 Playwright-tests geslaagd, 10 afleidingstests geslaagd, 313 engine-tests geslaagd, beide typechecks en de productie-build slagen. ✅ De split-brain-fixture geeft in Chrome dezelfde vingerafdruk (`c5be175f`) als in Node, en dezelfde vingerafdrukken na herladen en opnieuw uitvoeren. 💭 Chrome en Node gebruiken allebei de V8-engine; echte cross-browser-determinisme (Firefox en WebKit) staat nog gepland voor CP5.

**7. Wat heb ik hiervan geleerd?**
De eerste keer "echt draaien" levert andere informatie op dan tests: API-gaten, verwachtingen over volgorde, en hoe uitgebreid de data is.

**8. Belangrijkste begrippen**
- **End-to-end test:** het hele systeem testen zoals een gebruiker het ziet.
- **Headless browser:** een browser zonder zichtbaar venster, bestuurd door code.
- **Integratie:** de samenwerking tussen losse onderdelen.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom draaide de engine zonder aanpassingen in de browser, en welke CP0-beslissing maakte dat mogelijk?
2. Leg uit waarom `boots` bij de `node.recover`-entry nog 1 is, en wat dat betekent voor een tijdlijn in de UI.
3. Waarom is een Playwright-assertion sterker bewijs dan een screenshot?

### Starten

```bash
npm install
npm run dev        # open http://127.0.0.1:5173/
npm run test:e2e   # Playwright-controles in de lokale Chrome
```

### CP2.5 — Terugblik

**Wat is handmatig getest?** Het scenario "Crash, recovery and partition" is in de browser met de hand doorlopen en visueel gecontroleerd (2026-10-08):
- n2 crasht op t=150 en is duidelijk als gecrasht te herkennen;
- berichten naar n2 worden gedropt en staan in het log;
- n2 herstelt op t=300 met incarnatie 2, en de persistente opslag laat het herstel zien (`boots: 2`);
- de partitie begint op t=400, de doorgesneden verbindingen zijn duidelijk zichtbaar, en op t=520 heelt het netwerk.

Deze handmatige observaties komen bovenop de automatische tests (313 engine-tests, 10 afleidingstests en 6 Playwright-tests).

**Wat werkte goed?** De échte engine stuurt een browserinterface aan zonder één aanpassing. Alles wat op het scherm staat, komt aantoonbaar uit de trace. Dezelfde invoer gaf in de browser dezelfde vingerafdruk als in Node.

**Wat liet de integratie zien?** De scheiding "uitvoeren → afspelen" werkt. Een frontend kan de engine gebruiken zonder in zijn binnenkant te kijken. De zwakke plekken zitten in de *ervaring* en in de *schaal*, niet in de correctheid.

**UX-bevindingen** (vastgelegd in `docs/UI_REQUIREMENTS.md`, voor CP5/CP6; het prototype wordt bewust níét aangepast):
- **UX-001 — Verwarrende begintoestand.** Je kiest een experiment en de beschrijving praat al over de crash, maar alle nodes staan op "not started", omdat het afspelen bij entry #0 begint. Technisch klopt dat, maar het is verwarrend. De echte interface moet configuratie en huidige toestand duidelijk scheiden, altijd laten zien of een run *klaar*, *bezig*, *gepauzeerd* of *afgerond* is, en een eventuele "geïnitialiseerde" startpositie eerlijk benoemen als een echte positie in de trace.
- **UX-002 — Bediening onder het zichtbare deel.** De netwerkweergave is te hoog, dus je moet scrollen om bij de knoppen en de tijdlijn te komen, en dan verdwijnen de bovenste nodes uit beeld. De echte interface krijgt een vaste tijdlijn met altijd zichtbare bediening en klikbare markeringen (crash, herstel, partitie, heal, overtreding) die naar de exacte trace-entry springen.

**Wat betekent dit voor de verdere ontwikkeling?**
1. Snel zoeken in een trace en de toestand op elk moment correct tonen moet efficiënt worden. Dat wordt een centraal onderdeel van CP3.
2. Een tijdlijn moet bewust kiezen tussen stappen per *entry* en per *simulatiestap*.
3. Interfacebeslissingen moeten getest worden met echte gebruikers, niet alleen met assertions: twee bruikbaarheidsproblemen vielen pas op toen een mens het gebruikte.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom is "alle nodes not started bij entry #0" correct, en waarom is het tóch een probleem? Hoe los je dat op zonder te liegen over de toestand?
2. Waarom moet een klik op een tijdlijnmarkering naar een *entry* springen en niet naar een *tijdstip*?
3. Welke drie dingen bewees CP2.5 over de engine, en welke twee dingen kon geen enkele automatische test ons vertellen?

---

## CP3 — Snapshots, replay en tijdreizen

**Datum:** 2026-10-09 · **Status:** afgerond en goedgekeurd · **Engine-versie:** `0.3.0-cp2` (bewust ongewijzigd: geen enkele trace is veranderd)

Tot CP2.5 kon je een run alleen vanaf het begin opnieuw afspelen. In CP3 kan de engine zijn complete toestand vastleggen en later precies daar verdergaan, kun je via "keyframes" snel naar elk moment springen, en zoekt een losse `TraceIndex` voor elke trace-entry uit hoe de wereld er op dat moment uitzag. Het ontwerp staat in ADR-0015 t/m ADR-0017 en in SEMANTICS §13–15.

### CP3.1 — Eerst de woorden: stap, event, entry en tijd

**1. Wat hebben we gebouwd?**
Vaste definities, met eigen types en namen in de code (`StepCount`, `EntryIndex`, `VirtualTime`):
- een **scheduled event** is één item in de wachtrij;
- een **simulatiestap** is één aanroep van `step()` die precies één event afhandelt, met alles wat daaruit volgt;
- een **trace-entry** is één regel in het logboek; één stap kan er duizenden opleveren;
- **virtuele tijd** is de klok. Veel stappen kunnen op hetzelfde tijdstip vallen.

**2. Waarom is dit nodig?**
Als je deze begrippen door elkaar gebruikt, beloof je dingen die niet kunnen. Bijvoorbeeld "ga verder vanaf entry #386", terwijl die entry midden in een stap zit.

**3. Hoe werkt het?**
Snapshots bestaan alleen op een stapgrens ("na 129 stappen"). De TraceIndex kan elke entry *bekijken*, maar nooit vanaf een entry verder *uitvoeren*. De twee intervallen hebben ook verschillende eenheden: `keyframeSteps` telt stappen, `checkpointEntries` telt entries.

**4. Welke keuzes zijn gemaakt?**
Twee aparte namen in plaats van één generieke "K", zodat de eenheid altijd in de naam zelf staat.

**5. Welke problemen kwamen we tegen?**
De vraag "hoort `run.end` bij een stap?" had twee antwoorden. Stopt de run *tijdens* een stap (bijvoorbeeld door een overtreding), dan hoort `run.end` bij die stap. Stopt hij *voordat* er een event is (tijdslimiet), dan hoort `run.end` bij geen enkele stap. Dat staat nu in de documentatie en is getest tegen de echte `step()`-aanroepen.

**6. Hoe hebben we het getest?**
✅ De stapgrenzen van de TraceIndex zijn gelijk aan de echte `step()`-aanroepen van de engine, voor 60 willekeurige experimenten.

**7. Wat heb ik hiervan geleerd?**
Precieze woorden voorkomen beloftes die de code niet kan waarmaken.

**8. Belangrijkste begrippen**
- **Stapgrens:** het moment tussen twee stappen, het enige punt waarop je kunt pauzeren.
- **Granulariteit:** hoe fijn je iets kunt opdelen.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom kan de engine niet "verder vanaf entry #386", terwijl de TraceIndex die entry wél kan tonen?
2. Een stap levert 600 entries op. Wat betekent dat voor de grens "minder dan K stappen opnieuw uitvoeren"?

### CP3.2 — Snapshots: event sourcing met tussenstanden

**1. Wat hebben we gebouwd?**
`sim.snapshot()` legt de complete uitvoeringstoestand vast als bevroren, geversioneerde JSON (`faultlab-snapshot/1`). `Simulation.restore()` bouwt daaruit een simulatie op die precies zo verdergaat.

**2. Waarom is dit nodig?**
FaultLab is eigenlijk **event sourcing**: de trace is de reeks gebeurtenissen, en de toestand is het resultaat van al die gebeurtenissen na elkaar. Zonder tussenstanden moet je voor "stap 90.000" alles vanaf stap 0 opnieuw doen. Een snapshot is zo'n tussenstand.

**3. Hoe werkt het?**
De snapshot bevat alles wat de toekomst beïnvloedt:
- de volledige `run.start` (alle invoer);
- de klok en de wachtrij: elk event met zijn **originele volgnummer**, en het volgende volgnummer;
- alle random-stream-toestanden;
- het netwerk: partitie en linkfouten;
- per node: status, incarnatie, state, opslag, timers en tellers;
- de invariant-monitor.

Wat je kúnt afleiden, wordt níét opgeslagen maar bij het herstellen opnieuw berekend. Voorbeelden zijn de index van berichten onderweg en de indeling van de heap. Zo kunnen twee kopieën van dezelfde informatie nooit uit elkaar lopen.

```ts
const snap = sim.snapshot();                        // na N stappen
const kopie = Simulation.restore(config, snap);     // controleert eerst alles
kopie.run();                                         // exact dezelfde rest van de trace
```

**4. Welke keuzes zijn gemaakt?**
- JSON in plaats van een binair formaat: leesbaar, en de metingen gaven geen reden voor iets anders (±10 kB per snapshot).
- Volgorde telt. De volgorde van timers bepaalt de lijst `cancelledTimers` bij een crash, dus maps worden als **geordende lijsten** opgeslagen.
- De engineversie bleef `0.3.0-cp2`. CP3 verandert geen enkele trace, en alle oude golden fingerprints slagen ongewijzigd.

**5. Welke problemen kwamen we tegen?**
- ✅ Mutatietest S13 (opslag in omgekeerde volgorde herstellen) **overleefde** eerst. Elk testprotocol gebruikte maar één opslagsleutel per node, en een lijst van één kun je niet omdraaien. Een nieuwe test met meerdere sleutels vangt hem nu. Daarbij ontdekte ik dat writes binnen één stap op alfabetische volgorde worden vastgelegd. Mijn verwachting was dus eerst fout, niet de engine.
- In twee tests nam ik aan dat een run "stap 400" haalt; hij stopte al na 298. Weer een aanname in de test, niet in de engine.

**6. Hoe hebben we het getest?**
✅ **Metamorfisch testen:** "N stappen in één keer" moet gelijk zijn aan "k stappen, snapshot, herstellen, rest". Dat is getest voor willekeurige k, protocollen, faultplannen en beide policies, met en zonder trace-prefix, en via een JSON-ronde (120 runs). ✅ Een snapshot van een herstelde run is identiek aan het origineel. ✅ Na elke stap een snapshot nemen verandert de trace niet. ✅ De originele run en de kopie zijn onafhankelijk. ✅ De opgeslagen tegenvoorbeelden spelen ook vanaf een snapshot halverwege exact af.

**7. Wat heb ik hiervan geleerd?**
De zekerste manier om te bewijzen dat een snapshot compleet is: elk veld één voor één weghalen en controleren dat er dan een test faalt.

**8. Belangrijkste begrippen**
- **Event sourcing:** toestand opslaan als een reeks gebeurtenissen.
- **Snapshot / checkpoint:** een opgeslagen tussenstand.
- **Metamorfisch testen:** twee verschillende wegen naar hetzelfde antwoord moeten gelijk uitkomen.
- **Deterministische replay:** dezelfde invoer, vanaf hetzelfde punt, geeft exact dezelfde vervolgtrace, ook na een snapshot en herstel.
- **Afgeleide data:** data die je opnieuw kunt berekenen, en dus niet opslaat.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom slaat de snapshot de index van berichten onderweg niet op, maar wel de wachtrij?
2. Wat zou er misgaan als het volgende volgnummer (`nextSeq`) niet hersteld wordt? Gebruik de regel "op hetzelfde tijdstip gaat wie eerst ingepland is".
3. Waarom bewijst "N stappen = k stappen + herstellen + rest" meer dan één losse voorbeeldtest?

### CP3.3 — Een snapshot is onbetrouwbare invoer

**1. Wat hebben we gebouwd?**
`validateSnapshot`: een strenge controle voordat iets hersteld wordt.

**2. Waarom is dit nodig?**
Later komen snapshots uit opslag en uit gedeelde links (CP7). Een kapotte of verkeerde snapshot mag nooit een simulatie opleveren die stilletjes iets anders doet.

**3. Hoe werkt het?**
De controle gaat in deze volgorde:
1. Eerst de grootte en de diepte, zonder recursie, zodat een kwaadaardig diep genest object de controle zelf niet kan laten crashen.
2. Dan JSON, formaat en engineversie.
3. Dan of de invoer **exact** gelijk is aan de configuratie. Dat is een volledige vergelijking, geen hash.
4. Dan de interne samenhang: elke timer heeft precies één wachtend event (en andersom), events staan in de juiste volgorde, bericht-ids passen bij de tellers, enzovoort.
5. Met een trace-prefix: wijst elke verwijzing naar een entry van het juiste soort?

**4. Welke keuzes zijn gemaakt?**
Eerlijk zijn over de grenzen. Een fingerprint vangt ongelukken en verwisselingen, maar is **geen beveiliging**: wie een snapshot vervalst, kan hem ook consistent maken. Dat staat in de ADR.

**5. Welke problemen kwamen we tegen?**
✅ Twee mutanten overleefden eerst:
- **S16** ("sla de timer↔event-controle over"): mijn negatieve test raakte een andere controle eerder.
- **S23** ("bij het vrijgeven van trace-entries ook de nieuwste weggooien"): `TimeTravel` maakt snapshots altijd *vóór* het vrijgeven.

Voor beide kwam er een gerichte test bij.

**6. Hoe hebben we het getest?**
✅ 34 afwijzingstests, zoals verkeerde versie, andere seed, ontbrekende node, timer van een andere node, alles-nul random-toestand, events in de verkeerde volgorde, een vervalst bericht, te diepe nesting, en een prefix van een andere run. Elke test controleert ook het exacte foutpad.

**7. Wat heb ik hiervan geleerd?**
Validatie gaat over *samenhang*, niet alleen over vorm. En een beveiligingsclaim moet je precies afbakenen.

**8. Belangrijkste begrippen**
- **Untrusted input:** invoer waarvan je niet zeker weet of hij klopt.
- **Consistentiecontrole:** nagaan of losse delen van data bij elkaar passen.
- **Integriteit vs. authenticiteit:** "klopt het intern?" is iets anders dan "komt het echt van de bron?".

**Dit moet ik zelf kunnen uitleggen**
1. Waarom controleren we de diepte van een object *zonder* recursie?
2. Waarom is een fingerprint geen bescherming tegen een vervalste snapshot?

### CP3.4 — Keyframes, binair zoeken en de trace als cache

**1. Wat hebben we gebouwd?**
`TimeTravel` maakt elke K stappen een snapshot (een **keyframe**, net als bij video). `seek(n)` springt naar stap n. `regenerate(a, b)` bouwt elk stuk trace opnieuw op, met de originele entry-nummers.

**2. Waarom is dit nodig?**
Een tijdlijn moet snel kunnen springen, en lange runs passen niet volledig in het geheugen.

**3. Hoe werkt het?**
`seek(n)` zoekt met **binair zoeken** het laatste keyframe ≤ n. Dat kost log₂(aantal keyframes) stappen: bij 1.563 keyframes ±11 vergelijkingen. Daarna herstelt het dat keyframe en voert het **minder dan K stappen** opnieuw uit.

Omdat de simulatie deterministisch is, hoef je de trace niet te bewaren: je kunt hem uit keyframes **exact opnieuw berekenen**. De trace wordt zo een *cache*.

**4. Welke keuzes zijn gemaakt?**
K telt stappen, want alleen stappen zijn hervatbaar. Een trace die midden in een run begint (een *segment*), houdt absolute nummers aan, zodat `cause`-verwijzingen blijven kloppen.

**5. Welke problemen kwamen we tegen?**
✅ Mijn eerste "burst"-test (één stap = honderden entries) maakte ±25.000 stappen en sprong daarna naar *elke* stap. Dat is kwadratisch werk, en hij draaide minutenlang. Een kleinere variant (12 stappen van elk ≥ 300 entries) bewijst hetzelfde in milliseconden.

**6. Hoe hebben we het getest?**
✅ `seek(n)` geeft exact dezelfde snapshot als een ononderbroken run tot stap n, voor K = 1, 2, 7 en 64. ✅ De antwoorden zijn gelijk voor elk interval. ✅ Er worden nooit meer dan K−1 stappen opnieuw uitgevoerd, ook als één stap honderden entries oplevert. ✅ Opnieuw berekende stukken trace zijn byte-identiek, met dezelfde nummers.

**7. Wat heb ik hiervan geleerd?**
Determinisme maakt opslaan optioneel: wat je exact opnieuw kunt berekenen, hoef je niet te bewaren.

**8. Belangrijkste begrippen**
- **Keyframe:** een volledig opgeslagen tussenstand, waartussen je opnieuw berekent.
- **Binair zoeken:** zoeken in een gesorteerde lijst door steeds te halveren (O(log n)).
- **Tijd-geheugen-afweging:** meer opslaan maakt sneller, maar kost geheugen.
- **Time-travel debugging:** terug in de tijd kunnen kijken in een programma.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom moet K in stappen geteld worden en niet in entries?
2. Hoe weet `regenerate` welke nummers de nieuwe entries moeten krijgen?
3. Kies met de benchmarktabel een K voor een interface die binnen 5 ms moet springen en hooguit 10 MB aan keyframes mag gebruiken.

### CP3.5 — TraceIndex: elke entry inspecteren

**1. Wat hebben we gebouwd?**
Het losse pakket `@faultlab/trace` met `TraceIndex`. Voor elke entry geeft het: de toestand van alle nodes (inclusief de entry waar die vandaan komt en de lopende timers), de berichten onderweg, de partitie en linkfouten, open overtredingen, en bij welke stap de entry hoort. Daarnaast markeringen en oorzaak-gevolgketens, vooruit en achteruit.

**2. Waarom is dit nodig?**
De CP2.5-viewer begon voor elk beeld opnieuw bij entry #0. De echte interface heeft snelle, exacte inspectie nodig, en een eigen pakket houdt het lezen van traces gescheiden van het uitvoeren.

**3. Hoe werkt het?**
Elke C entries wordt de toestand gekopieerd (een *checkpoint*). Voor entry i neem je het dichtstbijzijnde checkpoint ≤ i en pas je hooguit C−1 entries toe. Gevolgen vind je door de `cause`-pijlen om te keren.

**4. Welke keuzes zijn gemaakt?**
Het pakket importeert alleen *types* van de engine (afgedwongen door een architectuurtest). Wat niet in de trace staat (random-toestanden, volgnummers, invariant-history), wordt **niet** gereconstrueerd. Daarvoor heb je een engine-snapshot nodig. Onvolledige traces worden geweigerd in plaats van geraden.

**5. Welke problemen kwamen we tegen?**
✅ De test "frames zijn diep bevroren" faalde: drie soorten records binnen een frame waren niet bevroren. Opgelost.

✅ Mutant S22 (checkpoint ná de entry in plaats van ervóór) overleeft. Eindstand van de mutatietests: **22 van 23 gevangen, S22 is equivalent.** Wat "equivalent" hier precies betekent, moet je zorgvuldig zeggen:
- *Definitie:* equivalent ten opzichte van het **publieke gedrag** van de TraceIndex, dus wat de methodes teruggeven (`frameAt`, `lastFrameCost`, stappen, markeringen, oorzaken) voor elke geldige trace.
- *Waarom:* in de mutant wordt de entry op de checkpointpositie twee keer toegepast. Dat maakt niets uit, omdat elke update **idempotent** is: `apply(apply(W, e), e) = apply(W, e)`. Het gaat telkens om "zet deze waarde" of "voeg toe aan / haal uit een map", en dat nog eens doen verandert niets.
- *Wat hem wél zou kunnen vangen:* een test die naar de *interne* checkpoints, het geheugen of de tijd kijkt, of een toekomstige update die niet idempotent is (bijvoorbeeld een teller). Daarom staat "apply is idempotent" nu als expliciete aanname in de code.

Het is dus níét zo dat "geen enkele denkbare test" hem kan vangen. Alleen geen test van het *afgesproken observeerbare gedrag*.

**6. Hoe hebben we het getest?**
✅ Na **elke** stap is de reconstructie gelijk aan de gezaghebbende snapshot van de engine, voor 60 willekeurige experimenten × vier intervallen. ✅ Elk interval geeft hetzelfde als volledig opnieuw scannen. ✅ Er worden nooit meer dan C−1 entries toegepast. ✅ "Gevolgen" is precies het omgekeerde van "oorzaak". ✅ De CP2.5-demo gebruikt nu de TraceIndex, en zijn 10 unit- en 6 Playwright-tests slagen ongewijzigd.

**7. Wat heb ik hiervan geleerd?**
"Bekijken" en "uitvoeren" zijn verschillende verantwoordelijkheden, en verdienen elk hun eigen pakket.

**8. Belangrijkste begrippen**
- **Checkpointing:** af en toe de volledige toestand opslaan, en daartussen bijwerken.
- **Reverse index:** een index die "wie verwijst naar mij?" beantwoordt.
- **Equivalente mutant:** een codewijziging die het gedrag niet verandert.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom kan de TraceIndex de random-toestanden niet reconstrueren?
2. Leg precies uit ten opzichte van wélk gedrag mutant S22 equivalent is, waarom idempotentie daarvoor nodig is, en noem een test die hem tóch zou vangen.

### CP3.6 — Geheugen en prestaties meten (en een meetfout)

**1. Wat hebben we gebouwd?**
Metingen van de tijd voor vastleggen en herstellen, de snapshotgrootte, keyframes, springen, opnieuw berekenen en de TraceIndex. De volledige tabellen staan in `docs/TEST_STRATEGY.md` (CP3).

**2. Waarom is dit nodig?**
Je kunt pas een goede K kiezen als je de afweging tussen tijd en geheugen kent. En de opdracht was: structural sharing *meten*, niet aannemen.

**3. Hoe werkt het?**
✅ Belangrijkste resultaten (100.000 stappen, 287.533 entries):
- een snapshot vastleggen kost 0,17 ms en levert ±10 kB JSON op;
- herstellen kost 0,09–0,45 ms;
- de volledige trace kost 78 MB, terwijl keyframes elke 1.024 stappen maar 2,1 MB kosten;
- springen duurt in de mediaan 0,3–9 ms, afhankelijk van K.

**4. Welke keuzes zijn gemaakt?**
Nog niets geoptimaliseerd. De TraceIndex blijkt ±64–83 MB extra te kosten, ongeveer evenveel als de trace zelf. Dat is te veel voor een browser-app, dus **PERF-3** wordt onderzocht *vóórdat* de prestatiegevoelige frontend gebouwd wordt (niet pas in CP9). De sprongen van soms meer dan 100 ms zijn vastgelegd als **PERF-4**. Vóór de echte tijdlijn moeten we begrijpen: het geheugen van de TraceIndex en van keyframes, de springtijden en uitschieters, de responsiviteit van de browser, het gedrag van de garbage collector, en herhaald scrubben. Eerst meten, dan pas veranderen. PERF-1 en PERF-2 blijven apart open.

**5. Welke problemen kwamen we tegen?**
✅ **Mijn eerste geheugenmeting was fout.** Die gaf *negatieve* waarden, omdat ik "geheugen na − geheugen vóór" mat terwijl er ondertussen ander afval werd opgeruimd. De nieuwe methode: bouw het object, meet met het object nog in leven, laat het los, ruim op, en meet opnieuw. Het verschil is wat dat object vasthoudt (mediaan van 3). ✅ Daarmee bleek dat keyframes **geen** oude trace vasthouden (2,1 MB tegenover 78 MB). 💭 Structural sharing gaf in deze test geen meetbaar verschil (0,03 MB in beide gevallen), omdat de states van dit protocol heel klein zijn. Dat het voordeel bij grote states echt optreedt, is dus nog niet bewezen. 💭 Sommige sprongen duurden soms meer dan 100 ms; de oorzaak is niet gemeten (mogelijk garbage collection).

**6. Hoe hebben we het getest?**
Herhaalde metingen met mediaan, minimum en maximum, en geforceerde garbage collection voor het geheugen.

**7. Wat heb ik hiervan geleerd?**
Een meetmethode kan zelf een bug hebben. Onlogische uitkomsten, zoals negatief geheugengebruik, zijn een signaal om de *methode* te controleren, niet om de cijfers te geloven.

**8. Belangrijkste begrippen**
- **Retained memory:** geheugen dat een object vasthoudt zolang het bestaat.
- **Structural sharing:** onveranderde delen delen in plaats van kopiëren.
- **Mediaan:** het middelste meetresultaat, minder gevoelig voor uitschieters.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom gaf "na − vóór" negatieve geheugenwaarden, en waarom werkt "levend − losgelaten" wél?
2. Waarom bewijst deze meting niet dat structural sharing geheugen bespaart?

### CP3.7 — Drie soorten versies

**1. Wat hebben we gebouwd?** Een heldere scheiding (SEMANTICS §16) tussen:
- de **engineversie** (`0.3.0-cp2`), die bepaalt welke trace een configuratie oplevert;
- het **traceformaat**, de vorm van de entries, die nu nog aan de engineversie vastzit;
- het **snapshotformaat** (`faultlab-snapshot/1`), de vorm van een snapshot.

**2. Waarom is dit nodig?** CP3 voegde veel toe, maar veranderde geen enkele trace. Zou de engineversie omhoog gaan, dan moesten alle golden fingerprints opnieuw, zonder dat er gedrag veranderd is. Dan zeggen die tests niets meer.

**3. Hoe werkt het?** De engineversie verandert alleen als dezelfde invoer een andere trace kan opleveren. Een nieuw soort bestand (de snapshot) krijgt zijn eigen versie.

**4. Welke keuzes zijn gemaakt?** De naam `-cp2` is verwarrend: hij betekent "gedrag voor het laatst veranderd in CP2", niet "gebouwd in CP2". Een betere naamgeving staat op de lijst voor een latere architectuurreview, en is bewust nu niet aangepast.

**5. Welke problemen kwamen we tegen?** Geen bug, wel een inzicht: versienummers zijn óók een contract, net als een API.

**6. Hoe hebben we het getest?** ✅ Alle golden fingerprints en beide opgeslagen tegenvoorbeelden slagen ongewijzigd met `0.3.0-cp2`.

**7. Wat heb ik hiervan geleerd?** Verhoog een versie omdat de *betekenis* verandert, niet omdat er nieuwe code bij komt.

**8. Belangrijkste begrippen**
- **Semantische versie:** een versie die aangeeft of gedrag of een formaat veranderd is.
- **Schemaversie:** de versie van een dataformaat.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom bleef de engineversie in CP3 gelijk, terwijl er een nieuw snapshotformaat bij kwam?
2. Wat zou er misgaan met de golden fingerprints als je bij elk checkpoint de engineversie verhoogt?

### CP3 — Bekende beperkingen

- Vertakken (verdergaan met een *ander* faultplan) kan nog niet: dat zou de regel "faults gaan vóór op hetzelfde tijdstip" breken. Dit is uitgesteld, samen met interactieve fault-injectie.
- Snapshot-validatie is geen beveiliging tegen vervalsing (gedocumenteerd).
- De TraceIndex verdubbelt ongeveer het geheugen (PERF-3), en sommige sprongen hebben trage uitschieters (PERF-4, oorzaak niet gemeten). Beide moeten begrepen zijn vóór de echte tijdlijn.
- De TraceIndex werkt alleen op volledige traces, niet op segmenten.
- npm 11 meldt dat het installatiescript van `fsevents` (een optionele macOS-dependency van Playwright) niet is goedgekeurd. Het is ook niet nodig, dus bewust niet goedgekeurd.

---

## CP4 — Raft: leiderverkiezing

**Datum:** 2026-10-09 · **Status:** geïmplementeerd, wacht op review · **Engine-versie:** `0.4.0-cp4`

In CP2 bouwden we een opzettelijk onveilig leider-algoritme en zagen we het falen. In CP4 komt het echte werk: de **leiderverkiezing van Raft**, rechtstreeks volgens Figure 2 en §5 van het artikel van Ongaro en Ousterhout. Daarbij hoort een nieuw soort controle (begrensde liveness), een grote zoektocht door 10 000 foutscenario's, vijf opzettelijk kapotte Raft-varianten en een eerlijke vergelijking met het naïeve algoritme. **Log-replicatie zit hier níét in**; dat is CP8. Ontwerp: ADR-0018 t/m ADR-0020, `docs/RAFT.md`, SEMANTICS §17–18.

### CP4.1 — Waarom consensus, en waarom een leider?

**1. Wat hebben we gebouwd?**
Een nieuw pakket `@faultlab/protocols` met `createRaftElection()`. Vijf (of drie, of vier) nodes kiezen samen precies één leider, ook als er nodes crashen en het netwerk in stukken valt.

**2. Waarom is dit nodig?**
*Gedistribueerde consensus* betekent: meerdere computers worden het eens over één waarde, terwijl sommige crashen of elkaar niet kunnen bereiken. Een database met drie kopieën moet bijvoorbeeld weten welke kopie de schrijfopdrachten aanneemt. Raft lost dat op door eerst een **leider** te kiezen; die beslist, de rest volgt. Is de leiderverkiezing onveilig, dan krijg je twee leiders die elk iets anders beslissen: *split brain*. Dat zagen we in CP2.

**3. Hoe werkt het?**
Het naïeve protocol uit CP2 dacht: "ik hoor niemand met een hoger nummer, dus ík ben de leider". Stilte werd als bewijs gezien. Raft vraagt om echt bewijs: **stemmen van een meerderheid**. Wie die niet krijgt, wordt geen leider.

**4. Welke keuzes zijn gemaakt?**
- Een apart pakket, zodat de engine niets van Raft weet. Het pakket mag alleen *types* uit de engine importeren; een architectuurtest dwingt dat af.
- Het artikel is de bron van waarheid. In `docs/RAFT.md` staat elke regel uit Figure 2 met het citaat erbij, en hoe FaultLab hem uitvoert.
- De velden voor de log (`lastLogIndex`, `entries: []` …) zitten al in de berichten, met waarde 0. CP8 kan ze dan uitbreiden zonder alles om te gooien.

**5. Welke problemen kwamen we tegen?**
De verleiding om "Raft" te zeggen terwijl het alleen de verkiezing is. Overal staat daarom expliciet wat níét geclaimd wordt: geen log-replicatie, geen veiligheid van vastgelegde entries.

**6. Hoe hebben we het getest?**
✅ 24 transitietests: per regel uit Figure 2 een test met een "opnemende" context die precies laat zien welke berichten, timers en schrijfacties een stap oplevert.

**7. Wat heb ik hiervan geleerd?**
Een algoritme uit een artikel implementeren betekent eerst de regels letterlijk opschrijven, en pas dán coderen.

**8. Belangrijkste begrippen**
- **Consensus:** overeenstemming tussen computers die kunnen falen.
- **Leiderverkiezing:** het kiezen van één node die beslissingen neemt.
- **Split brain:** twee nodes die tegelijk denken dat zij de baas zijn, en elk iets anders beslissen.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom is "ik hoor niemand met een hoger nummer" geen betrouwbaar bewijs dat jij de leider mag zijn? Geef een scenario.
2. Waarom is het verstandig dat de engine niets van Raft weet?

### CP4.2 — Drie rollen en termijnen

**1. Wat hebben we gebouwd?**
Elke node is **follower**, **candidate** of **leader**, en houdt een **term** bij: een termijnnummer dat alleen maar stijgt.

**2. Waarom is dit nodig?**
De term is een logische klok voor verkiezingen. Elke verkiezing krijgt een nieuw nummer. Zo weet iedereen welke informatie oud is.

**3. Hoe werkt het?**
- Een follower die te lang niets van een leider hoort (zijn *election timeout* verloopt), wordt candidate: term + 1, stemt op zichzelf, vraagt de anderen om een stem (`RequestVote`).
- Met stemmen van een meerderheid wordt hij leader en stuurt hij meteen *heartbeats* (lege `AppendEntries`) om de anderen rustig te houden.
- **Ziet een node ooit een hogere term, dan wordt hij meteen follower in die term.** Ook een leader. Dit is de belangrijkste regel van Figure 2 ("All Servers").
- Verzoeken met een lagere term worden geweigerd; oude antwoorden worden genegeerd.

**4. Welke keuzes zijn gemaakt?**
Gedrag dat het artikel niet letterlijk beschrijft, is vastgelegd in RAFT.md. Een voorbeeld: een leader die een `AppendEntries` met **dezelfde** term krijgt. Dat zou betekenen dat er twee leiders in één term zijn. Hij stapt dan af, en de invariant meldt de fout; we verbergen hem niet.

**5. Welke problemen kwamen we tegen?**
Welke timer reset je wanneer? Een geweigerde stem reset de timer níét; een toegekende wel. Anders kan een stoorzender een node eindeloos stilhouden.

**6. Hoe hebben we het getest?**
✅ Transitietests voor elke overgang, ✅ mutatietests: elke regel één voor één kapotmaken (17 mutanten op de regels, zie CP4.9).

**7. Wat heb ik hiervan geleerd?**
Een toestandsmachine (*state machine*) maakt een protocol testbaar: per toestand en per bericht is er precies één juiste reactie.

**8. Belangrijkste begrippen**
- **Term:** oplopend verkiezingsnummer, werkt als logische klok.
- **Heartbeat:** periodiek bericht van de leider: "ik leef nog".
- **Step down:** afstappen naar follower bij een hogere term.

**Dit moet ik zelf kunnen uitleggen**
1. Een oude leader komt terug na een partitie en stuurt heartbeats met term 2, terwijl de anderen in term 5 zitten. Wat gebeurt er, stap voor stap?
2. Waarom reset een *geweigerde* stem de election timer niet?

### CP4.3 — Stemmen die een crash overleven

**1. Wat hebben we gebouwd?**
`currentTerm` en `votedFor` staan in de duurzame opslag van de node. Na een crash leest `init` ze terug.

**2. Waarom is dit nodig?**
Stel dat een node in term 3 op A stemt, crasht, en zijn stem vergeet. Na herstel stemt hij in term 3 op B. Nu kunnen A én B allebei een meerderheid halen: twee leiders in één term. De variant `volatile-voted-for` doet precies dit, en de verkenning vond het (CP4.8).

**3. Hoe werkt het?**
Raft eist "eerst opslaan, dan antwoorden". In FaultLab is dat gratis: de engine legt de opslag van een stap vast **voordat** de berichten van die stap vertrekken (`sync-on-commit`, sinds CP1). Een stem en het antwoord erop zitten dus in dezelfde stap, in de goede volgorde, zichtbaar in de trace (`storage.write` vóór `message.send`).

**4. Welke keuzes zijn gemaakt?**
De rol, de ontvangen stemmen en de timers zijn bewust *vluchtig*: na een crash begint een node altijd als follower.

**5. Welke problemen kwamen we tegen?**
Geen bug, wel een inzicht: de engine-keuze uit CP1 (eerst opslag, dan berichten) blijkt precies de regel te zijn die Raft nodig heeft.

**6. Hoe hebben we het getest?**
✅ Hersteltests (term en stem worden teruggelezen), ✅ de varianten `volatile-voted-for` en `volatile-term` worden gevangen, met opgeslagen tegenvoorbeelden.

**7. Wat heb ik hiervan geleerd?**
"Wat moet een crash overleven?" is een ontwerpvraag die je per variabele moet beantwoorden.

**8. Belangrijkste begrippen**
- **Duurzame (persistente) toestand:** overleeft een crash.
- **Vluchtige toestand:** gaat verloren bij een crash.
- **Crash recovery:** herstarten met alleen de duurzame toestand.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom moet de stem *vóór* het antwoord opgeslagen zijn? Wat kan er misgaan als het andersom gebeurt?
2. Waarom hoeft de lijst met ontvangen stemmen níét duurzaam te zijn?

### CP4.4 — Meerderheid en quorum-intersectie

**1. Wat hebben we gebouwd?**
`majorityOf(n) = ⌊n/2⌋ + 1`: 2 van 3, 3 van 4, 3 van 5. Altijd van het **hele** cluster, ook als een deel onbereikbaar is.

**2. Waarom is dit nodig?**
Twee meerderheden van hetzelfde cluster hebben altijd **minstens één node gemeen** (*quorum-intersectie*). Die node stemt maar één keer per term. Dus kunnen er nooit twee winnaars in dezelfde term zijn. Dat is het hele veiligheidsargument, in één zin.

**3. Hoe werkt het?**
Bij 4 nodes is ⌈4/2⌉ = 2 géén meerderheid: {n1, n2} en {n3, n4} hebben niets gemeen. De variant `ceil-half-majority` gebruikt precies die fout. Met een 2|2-partitie kozen beide helften een leider in term 1 (opgeslagen tegenvoorbeeld).

**4. Welke keuzes zijn gemaakt?**
Stemmen worden geteld als een **verzameling**: een dubbel afgeleverd antwoord telt één keer.

**5. Welke problemen kwamen we tegen?**
✅ Gemeten: clusters met 4 nodes hebben de langste verkiezingen (3 stemmen nodig, net als bij 5, maar met minder kandidaten).

**6. Hoe hebben we het getest?**
✅ Unit-tests per clustergrootte, ✅ exploratie met 3, 4 en 5 nodes, ✅ de ceil-variant gevonden en opgeslagen.

**7. Wat heb ik hiervan geleerd?**
Een off-by-one in "de helft" is geen klein foutje maar breekt de hele veiligheid, en alleen bij een even aantal nodes.

**8. Belangrijkste begrippen**
- **Quorum:** de minimale groep die samen mag beslissen.
- **Quorum-intersectie:** elke twee quorums overlappen.

**Dit moet ik zelf kunnen uitleggen**
1. Bewijs in eigen woorden dat twee meerderheden van 5 nodes altijd een node delen.
2. Waarom is ⌈n/2⌉ veilig voor n = 5, maar niet voor n = 4?
3. Een 4-node cluster wordt 2|2 gesplitst. Waarom is "geen leider" hier het *juiste* gedrag?

### CP4.5 — Partities, split votes en willekeurige timeouts

**1. Wat hebben we gebouwd?**
Election timeouts worden per reset willekeurig gekozen uit [150, 300] ticks, uit de eigen random-stream van de node.

**2. Waarom is dit nodig?**
Als twee nodes tegelijk kandidaat worden, kan de stemming gelijk opgaan (*split vote*): niemand haalt een meerderheid. Met gelijke timeouts gebeurt dat elke ronde opnieuw. Met willekeurige timeouts is er bijna altijd één node net iets eerder.

**3. Hoe werkt het?**
✅ Gemeten in de exploratie: met de normale timeouts haalt elke run waarin het kon binnen de grens een leider. Met een bewust smalle range ([150, 155]) zijn er veel herhaalde split votes, en gaat de liveness-grens in 282 van de 3 312 runs mis. Het artikel (§9.3) beschrijft hetzelfde.

**4. Welke keuzes zijn gemaakt?**
De smalle timeouts zitten bewust in de exploratie, juist om split votes en gelijktijdige timeouts uit te lokken. Hun liveness-missers worden gerapporteerd, niet als fout geteld.

**5. Welke problemen kwamen we tegen?**
✅ Een onverwacht, maar correct gedrag: een geïsoleerde *follower* blijft timeouts krijgen en zijn term ophogen. Na het herstel van de partitie dwingt zijn hoge term de gezonde leider om af te stappen (scenario B2). Dit heet een *disruptive server*; Raft zonder "PreVote" doet dit echt. Het staat in RAFT.md §7.

**6. Hoe hebben we het getest?**
✅ Exploratie met partities in maximaal drie groepen, herstel, en vertraagde of verloren berichten.

**7. Wat heb ik hiervan geleerd?**
Toeval kan een algoritme *betrouwbaarder* maken: het breekt de symmetrie.

**8. Belangrijkste begrippen**
- **Split vote:** een stemronde zonder winnaar.
- **Symmetrie breken:** zorgen dat gelijke deelnemers zich toch verschillend gedragen.
- **Partitie:** het netwerk valt in groepen die elkaar niet bereiken.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom helpt een willekeurige timeout tegen split votes? Waarom garandeert het niets?
2. Leg scenario B2 uit: waarom stapt een gezonde leider af door een node die net terugkomt?

### CP4.6 — Veiligheidsinvarianten uit echte gebeurtenissen

**1. Wat hebben we gebouwd?**
Vijf historische invarianten: Election Safety (hoogstens één leider **per term**, over de hele run), termen dalen nooit, één stem per term, *leader-has-quorum*, en "hogere term wordt overgenomen".

**2. Waarom is dit nodig?**
Een invariant moet het protocol controleren, niet het protocol geloven. Daarom kijken ze naar echte gebeurtenissen in de trace: verzonden en **afgeleverde** stemmen, en de **duurzame** opslag. De teller `votesGranted` van de leider zelf wordt genegeerd.

**3. Hoe werkt het?**
Belangrijkste onderscheid: Raft belooft **niet** "hoogstens één node denkt nu leider te zijn". Na een partitie kan een oude leader in de minderheid nog denken dat hij leider is, in een **oudere** term. Dat is toegestaan. De belofte is: nooit twee leiders in **dezelfde** term.

**4. Welke keuzes zijn gemaakt?**
*leader-has-quorum* eist: de duurzame opslag zegt "term T, ik stemde op mezelf", plus genoeg afgeleverde ja-stemmen in term T van verschillende nodes, en geen van die stemmers heeft in T óók iemand anders gesteund.

**5. Welke problemen kwamen we tegen?**
✅ **Een vals alarm in mijn eigen invariant.** De eerste versie zocht naar een schrijfactie `votedFor = zelf` in de verkiezingsstap. Een proefrun (leider isoleren, daarna herstellen) gaf een overtreding bij het *correcte* protocol. Oorzaak: bij een tweede poging na een split vote staat `votedFor` al op "zelf", dus wordt alleen de term opnieuw geschreven. De invariant had het mis, niet Raft. Nu is het bewijs de duurzame toestand op het moment van de verkiezing. Er is een regressietest voor.

**6. Hoe hebben we het getest?**
✅ 20 unit-tests met zelfgemaakte views (ook: twee leiders tegelijk in verschillende termen → géén fout), ✅ elk kapotte variant wordt door de juiste invariant gevangen, ✅ 8 mutanten op de invarianten, allemaal gevangen.

**7. Wat heb ik hiervan geleerd?**
Een test die je schrijft vanuit dezelfde aanname als de code, vindt die aanname nooit. De fout kwam pas boven door het systeem echt te laten draaien.

**8. Belangrijkste begrippen**
- **Election Safety:** hoogstens één leider per term, over de hele geschiedenis.
- **Historische invariant:** een controle die onthoudt wat eerder gebeurde.
- **Vals positief:** een alarm terwijl er niets mis is.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom is "twee nodes zijn nu leider" bij Raft niet altijd een fout? Wanneer wél?
2. Waarom telt *leader-has-quorum* afgeleverde stemmen, en niet verzonden stemmen?
3. Leg het valse alarm uit: welke aanname was fout, en waarom vonden de unit-tests het niet?

### CP4.7 — Safety versus liveness: begrensde liveness

**1. Wat hebben we gebouwd?**
Een nieuw soort controle in de engine: `LivenessCheck`. Hij zegt: "als deze **aannames** gelden en er nog geen voortgang is, moet die er binnen **D** ticks komen."

**2. Waarom is dit nodig?**
- **Safety:** er gebeurt nooit iets slechts. Dat kun je na elke stap controleren.
- **Liveness:** er gebeurt uiteindelijk iets goeds. Dat kun je in een eindige run nooit bewijzen; "uiteindelijk" kan altijd nog komen.

Raft garandeert géén tijdslimiet voor een verkiezing. D is daarom een **gemeten testverwachting onder vastgelegde aannames**, géén universele garantie dat Raft binnen D een leider kiest. De aannames staan in de trace.

**3. Hoe werkt het?**
- Gaan de aannames gelden, dan plant de engine een **echt event** op tijdstip nu + D (`liveness.deadline`). Komt de voortgang eerder, dan wordt het event geannuleerd. Zo niet, dan verschijnt `liveness.missed` op precies dat tijdstip, ook als er verder niets gebeurt.
- Vallen de aannames weg (bijvoorbeeld een 2|2-partitie: geen meerderheid), dan wordt de controle uitgezet (`liveness.disarmed`): geen verwachting, dus ook geen valse misser.
- Liveness-resultaten zijn nooit `invariant.violation` en stoppen de run nooit.

**4. Welke keuzes zijn gemaakt?**
✅ D = 1500 ticks, gekozen uit 6 000 gemeten verkiezingen (3/4/5/7 nodes): het slechtste geval was 885 ticks, p99 ≤ 656. D is vijf keer de maximale timeout.

**5. Welke problemen kwamen we tegen?**
✅ **Een fout in mijn eigen liveness-controle.** De eerste versie bepaalde de "gezonde groep" door bij elke slechte link één van de twee nodes weg te laten. In 13 van 1 000 runs was dat toevallig de leider. Daardoor zag de controle "geen leider in de groep", terwijl alle gezonde nodes die leider gewoon volgden: 13 valse missers. De oplossing is beide uiteinden van een slechte link uit te sluiten; de leider zelf mag wél op een slechte link zitten. Daarna: 0 missers in alle 6 688 runs met normale timeouts (van de 10 000 met vaste seed).

**6. Hoe hebben we het getest?**
✅ 37 engine-tests (configuratiecontrole, exacte deadline-tijden, een stille scheduler, uitzetten en opnieuw aanzetten, voortgang die verloren gaat, kapotte controles, snapshots met een openstaande deadline), ✅ 17 Raft-livenesstests (ook: een echte misser op een Raft-run, opnieuw wachten na een gecrashte leider, en het gezondheidsfilter bij één slechte link), ✅ 8 mutanten op liveness, allemaal gevangen.

✅ **Werd de controle eigenlijk wel gebruikt?** "Geen missers" zegt niets als de controle nooit actief was. Elke run begint gezond, dus "minstens één keer actief" (100 %) bewijst niets. Daarom is gemeten hoe vaak de aanname echt gold (CI-subset van 1 000 runs): 60,8 % van alle virtuele tijd; in runs met fouten was de controle ná de eerste fout actief in 78,9 % van de runs, gedurende 43,9 % van die tijd. Er waren 1 488 wachtperiodes, waarvan 1 166 gehaald. De test eist ondergrenzen op deze cijfers, zodat de controle niet ongemerkt stil kan vallen. Eerlijke kanttekening: het gezondheidsfilter is voorzichtig. In een cluster van 3 nodes zet één slechte link de controle al uit (getest en gedocumenteerd).

**7. Wat heb ik hiervan geleerd?**
Als een controle faalt, controleer dan óók de controle. En als een controle níét faalt: controleer of hij wel aan stond. 13 "missers" met een werkende leider waren een bug in de meetlat, niet in Raft.

**8. Belangrijkste begrippen**
- **Safety-eigenschap:** iets slechts gebeurt nooit.
- **Liveness-eigenschap:** iets goeds gebeurt uiteindelijk.
- **Aanname (assumption):** de voorwaarde waaronder voortgang verwacht wordt.
- **Testgrens:** een gekozen maximum om te testen, geen garantie.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom kun je liveness niet bewijzen met één eindige run?
2. Waarom moet de deadline een echt event in de scheduler zijn? Wat gaat er mis als je alleen bij andere events controleert?
3. Waarom levert een permanente 2|2-partitie géén liveness-misser op? Is dat valsspelen?

### CP4.8 — Exploratie en zes kapotte varianten

**1. Wat hebben we gebouwd?**
- Een generator voor experimenten: 3/4/5 nodes, normale of smalle timeouts, meer of minder vertraging, en tot 8 foutgroepen (crash + herstel, partities, herstel van het netwerk, verloren en vertraagde berichten).
- ✅ **2 × 10 000 experimenten met correct Raft (vaste seed 20261008 en een willekeurige seed −2125180925): nul safety-overtredingen.** In CI draait elke keer een vaste subset van 1 000. Ook geteld: 6 542 runs met concurrerende kandidaten, 6 195 met een mislukte verkiezing, 1 679 waarin een oude leader een hogere term tegenkwam, 602 waarin twee nodes tegelijk dachten leider te zijn (in verschillende termen, dus toegestaan).
- Zes varianten met elk precies één fout: `volatile-voted-for`, `volatile-term`, `double-vote`, `ceil-half-majority`, `no-step-down` en `ignore-higher-term`. (Gepland waren er vijf; waarom het er zes werden, staat in CP4.12.)

**2. Waarom is dit nodig?**
Slagen bewijst alleen iets als de tests óók kunnen falen. De kapotte varianten laten zien dat elke regel ertoe doet, én dat de invarianten de fouten echt vinden.

**3. Hoe werkt het?**
Per variant zoekt fast-check een experiment dat de bijbehorende invariant breekt. Daarna wordt het verkleind tot een minimaal faultplan, opnieuw afgespeeld (ook vanaf een snapshot halverwege), en met **correct** Raft onder exact hetzelfde experiment gedraaid: daar 0 overtredingen. Negen tegenvoorbeelden zijn opgeslagen.

**4. Welke keuzes zijn gemaakt?**
Geen enkel tegenvoorbeeld is met de hand geschreven. Vindt de zoektocht niets, dan faalt de test. Zo bewijzen de voorbeelden wat het systeem doet, niet wat ik verwachtte.

**5. Welke problemen kwamen we tegen?**
✅ Eerlijk resultaat: `ignore-higher-term` kiest **nooit** een leider (iedereen weigert hogere termen), dus breekt Election Safety ook niet. Wel "hogere term overnemen" en liveness. Dat staat zo in de docs; ik heb er geen Election-Safety-fout bij verzonnen.
✅ Bijvangst: beide persistentiebugs kunnen óók twee leiders in één term veroorzaken. Dat vond de zoektocht na 951 experimenten, met een plan van 5 fouten.

**6. Hoe hebben we het getest?**
✅ Elke variant: gevonden, 1-minimaal, deterministisch afgespeeld, correct Raft schoon. ✅ Opgeslagen fixtures worden bij elke testrun opnieuw gecontroleerd.

**7. Wat heb ik hiervan geleerd?**
"10 000 keer geslaagd" is bewijs, geen wiskundig bewijs. Het zegt alleen iets over de scenario's die de generator kan maken. Daarom tel ik ook wélke scenario's echt voorkwamen (split votes, oude leiders die een hogere term zien, verloren berichten …).

**8. Belangrijkste begrippen**
- **Exploratie:** automatisch zoeken in de ruimte van foutscenario's.
- **Shrinking / 1-minimaal:** verkleinen tot elke fout nodig is.
- **Mutant:** een opzettelijk kapotte versie, om te zien of de tests hem vangen.

**Dit moet ik zelf kunnen uitleggen**
1. Neem het opgeslagen tegenvoorbeeld van `volatile-voted-for` en leg elke fout uit het plan uit: waarom is elke fout nodig?
2. Waarom is "correct Raft onder hetzelfde experiment" een belangrijk onderdeel van het bewijs?
3. Wat kun je wél en níét concluderen uit 10 000 geslaagde experimenten?

### CP4.9 — Naïef versus Raft, eerlijk vergeleken

**1. Wat hebben we gebouwd?**
Zeven scenario's (A–F, plus B2). Beide protocollen draaien met hetzelfde cluster, dezelfde seed, dezelfde vertraging en hetzelfde faultplan. Alle meetwaarden komen uit de trace en zijn vastgepind.

**2. Waarom is dit nodig?**
Om te laten zien wát Raft oplost, zonder de vergelijking te sturen.

**3. Hoe werkt het?**
- **C en D** zijn de opgeslagen tegenvoorbeelden uit CP2. Het naïeve protocol maakt daar twee leiders in dezelfde epoch. Raft kiest daar níémand, omdat er geen meerderheid bestaat: onbeschikbaar, maar veilig.
- **E4** (2|2): naïef kiest aan beide kanten een leider; Raft kiest er geen enkele tot het herstel.
- **B**: tijdens de isolatie heeft de meerderheidskant met Raft 72,8 % van de tijd een leider, naïef 88 %. Raft is trager (timeouts van 150–300 tegen 60), maar maakt geen fouten.
- **F**: Raft zonder duurzame `votedFor` kiest twee leiders in term 1; correct Raft niet.

**4. Welke keuzes zijn gemaakt?**
De interne werking wordt níét gelijk getrokken. Alleen de buitenwereld is gelijk.

**5. Welke problemen kwamen we tegen?**
✅ **Een eigen aanname die niet klopte.** Voor scenario B ("isoleer de gevestigde leider n5") schreef ik dat Raft met seed 3 ook n5 als leider had. Een test liet zien dat het n3 was. Nu gebruikt B seed 1 (beide protocollen kiezen n5, en dat wordt getest), en seed 3 is scenario B2 geworden, omdat het iets echts laat zien (de disruptive server).
✅ Het CP2-tegenvoorbeeld "alleen crashes" bestond alleen als inline test, niet als fixture. Het is opnieuw gevonden met een zoektocht met alleen crashes en herstel, en opgeslagen met echte zoekgegevens.

**6. Hoe hebben we het getest?**
✅ 14 tests: per scenario de kwalitatieve uitkomst, plus alle cijfers en fingerprints vastgepind in `results.json`.

**7. Wat heb ik hiervan geleerd?**
Raft ruilt beschikbaarheid in voor veiligheid. Zonder meerderheid doet het liever niets dan iets fouts. Dat is precies wat het CAP-theorema voorspelt.

**8. Belangrijkste begrippen**
- **Beschikbaarheid:** het systeem kan beslissingen nemen.
- **CAP:** bij een partitie moet je kiezen tussen consistentie en beschikbaarheid.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom is het eerlijk om de buitenwereld gelijk te houden en de interne werking niet?
2. In scenario D kiest Raft nooit een leider. Waarom is dat beter dan wat het naïeve protocol doet?

### CP4.10 — Versies en oude bewijsstukken

**1. Wat hebben we gebouwd?**
Engineversie `0.4.0-cp4` (nieuwe trace-entries `liveness.*` en het veld `run.start.liveness`), snapshotformaat `/2`, en tegenvoorbeeldformaat `/2` (met een protocolvariant en het resultaat van correct Raft).

**2. Waarom is dit nodig?**
De trace verandert, dus de versie moet omhoog. Maar oude bewijsstukken mogen niet verloren gaan.

**3. Hoe werkt het?**
`projectTrace` (nu in de engine zelf) zet een nieuwe trace om naar een ouder formaat. Zo worden de oude golden fingerprints van CP0 t/m CP3 nog steeds exact gehaald, en spelen de CP2-fixtures (opgenomen met `0.3.0-cp2`) nog exact af. **Geen enkele oude fixture is aangepast.** Een fixture-schrijver overschrijft nooit een bestaand bestand.

**4. Welke keuzes zijn gemaakt?**
Een CP3-snapshot (`/1`) wordt met een duidelijke foutmelding geweigerd, omdat hij geen liveness-toestand kan beschrijven.

**5. Welke problemen kwamen we tegen?**
✅ De README beloofde nog fingerprint `09f7b23f` voor het voorbeeld. Met `0.4.0-cp4` is dat `7fda34b3`; de oude waarde geldt alleen via de projectie. Aangepast.

**6. Hoe hebben we het getest?**
✅ Projectietests voor CP0, CP1 en CP2/CP3, ✅ oude fixtures via projectie, ✅ een CP3-snapshot wordt geweigerd.

**7. Wat heb ik hiervan geleerd?**
Een versiebump is pas veilig als je kunt aantonen dat het oude gedrag nog precies te reproduceren is.

**8. Belangrijkste begrippen**
- **Projectie:** een nieuw formaat terugvertalen naar een oud.
- **Regressiefixture:** een opgeslagen voorbeeld dat nooit meer mag veranderen.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom mocht de engineversie in CP3 gelijk blijven, maar moest hij in CP4 omhoog?
2. Waarom is het overschrijven van een oude fixture "om de test te laten slagen" gevaarlijk?

### CP4.11 — Prestaties meten

**1. Wat hebben we gemeten?** ✅ (Apple-silicon laptop, Node 24; zie TEST_STRATEGY)
- **Verkiezingen:** de eerste leider komt bij 3 tot 25 nodes na een mediaan van 192 → 165 ticks. Grotere clusters zijn iets sneller: er is altijd wel één node met een korte timeout.
- **Trace-volume door heartbeats:** ongeveer 0,12 entries per tick per node; 2,4 MB JSON per 20 000 ticks bij 5 nodes. Elke heartbeat levert per follower vijf entries op, ook een `state.update`, omdat de nieuwe timer-id in de state zit.
- **Timers:** 16 000 geannuleerde timers in 200 000 ticks, maar de heap blijft klein (max 29 entries) en compaction is nooit nodig. Dode timers verlopen vanzelf binnen 300 ticks.
- **Kosten van controles:** 5 nodes, 20 000 ticks: 13 ms zonder, 36 ms met de vijf invarianten, 34 ms met alleen liveness, 49 ms met allebei. Het meeste is het bouwen van de bevroren view (PERF-2).
- **Groei van de geschiedenis:** bij één stabiele leider blijft die constant. Bij een nieuwe term elke ~350 ticks groeit hij lineair met het aantal termen (≈ 72 KB na 465 termen).

**5. Welke problemen kwamen we tegen?**
✅ **Nieuw: PERF-5.** Met een groeiende geschiedenis worden de stappen zelf trager: van 14 naar 36 µs per stap. De engine kopieert en bevriest de hele geschiedenis na élke stap, ook als die niet veranderd is. Vastgelegd als open onderzoek, bewust niet nu opgelost (geen ongevraagde optimalisaties).

**7. Wat heb ik hiervan geleerd?**
Een veiligheidsmaatregel (alles kopiëren en bevriezen) heeft een prijs die pas zichtbaar wordt bij lange runs.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom zou het overslaan van de kopie bij een *ongewijzigde* geschiedenis geen enkele garantie verzwakken?
2. Waarom levert elke heartbeat een `state.update` op, en wat betekent dat voor de grootte van de trace?

### CP4.12 — Review: toonde `no-step-down` wel wat de naam belooft?

**1. Wat hebben we gebouwd?**
De oude variant `no-step-down` is gesplitst in twee varianten met elk precies één fout:
- `ignore-higher-term`: negeert elk bericht met een hogere term (het oude gedrag, nu met een eerlijke naam);
- `no-step-down`: neemt de hogere term wél over (en slaat hem op), maar wordt **geen follower**. Een leider blijft dus leider, nu in de nieuwe term.

**2. Waarom is dit nodig?**
Bij de review kwam de vraag: test deze variant wel het ontbrekende *afstappen*? Het antwoord was nee. Als niemand een hogere term overneemt, krijgt geen kandidaat ooit een tweede stem en wordt er **nooit een leider gekozen** (0 van 300 runs). Dan bestaat er ook geen leider die zou moeten afstappen. Alleen één unit-test met een zelfgemaakte leider-toestand raakte die code. De variant "faalde" wel een invariant (term-adoptie), en dat leek op succes, maar het bedoelde defect werd nooit getoond.

**3. Hoe werkt het?**
Een gerichte regressietest laat de hele keten zien (5 nodes, seed 1):
1. n5 wordt onder gezonde omstandigheden leider (t=202), zonder enige overtreding;
2. n5 wordt geïsoleerd (t=400); de meerderheid kiest n4 in term 2;
3. na het herstel (t=900) krijgt n5 een bericht met term 2, slaat term 2 op, maar blijft leider (t=909);
4. `raft-election-safety` meldt: "Term 2 was led by n4 and also by n5", met verwijzingen naar beide leiderschappen.

Correct Raft met exact hetzelfde plan: n5 wordt follower in term 2, nul overtredingen. De exploratie vindt het defect ook zelfstandig (run 25, 2 fouten).

**4. Welke keuzes zijn gemaakt?**
Geen invariant afgezwakt, geen overtreding verzonnen. Het oude, nog niet gecommitte fixture is verwijderd en onder de nieuwe naam opnieuw gegenereerd. Dat staat expliciet in TEST_STRATEGY, zodat niemand denkt dat er stilletjes een fixture is aangepast.

**5. Welke problemen kwamen we tegen?**
De verleiding om het oude resultaat te laten staan: "de variant wordt gevangen". Dat was waar, maar door de verkeerde invariant en om de verkeerde reden.

**6. Hoe hebben we het getest?**
✅ Unit-test per variant, ✅ de gerichte regressietest, ✅ exploratie + opgeslagen tegenvoorbeeld, ✅ correct Raft schoon onder hetzelfde experiment.

**7. Wat heb ik hiervan geleerd?**
Een kapotte variant moet het pad bereiken dat hij zegt te breken. "De test faalt" is pas bewijs als hij faalt om de juiste reden.

**8. Belangrijkste begrippen**
- **Stale leader:** een oude leider die nog niet weet dat er een nieuwere term is.
- **Afstappen (step down):** terug naar follower bij een hogere term.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom kiest `ignore-higher-term` nooit een leider? Loop een verkiezing met drie nodes stap voor stap door.
2. Waarom kan `no-step-down` wél twee leiders in één term veroorzaken? Gebruik het opgeslagen tegenvoorbeeld (n4 geeft zelfs zijn stem aan n1).
3. Waarom is "de variant wordt door een invariant gevangen" niet hetzelfde als "het bedoelde defect is aangetoond"?

### CP4 — Kwaliteitscontrole

- ✅ Mutatietesten (opnieuw gedraaid op de definitieve code): 33 mutanten op de Raft-regels, de invarianten, de liveness-controle en de engine-liveness. **32 gevangen.** R15 ("leader start verkiezingen") is *equivalent* binnen de bereikbare toestanden: een leader heeft nooit een election timer (die wordt bij het leiderschap geannuleerd en op `null` gezet, en alleen afstappen maakt een nieuwe), dus de extra rolcontrole is overbodig. Een test over 300 runs bevestigt dat: in meer dan 1 000 leider-toestanden is `electionTimer` steeds `null`.
- De zwakste vangsten (door maar één test): stemmen voor oude termen toekennen (R4), een stemmer dubbel tellen (R8), off-by-one in de term-monotonie (I2) en in term-adoptie (I8), en conflicterende stemmers (I5).
- Het harnas herstelt elk bestand in `finally` en controleert daarna checksums.

### CP4 — Bekende beperkingen

- Alleen leiderverkiezing: geen log, geen commit, geen veiligheid van de state machine (CP8). De "up-to-date log"-regel (§5.4.1) is met een lege log altijd waar en dus níét getest.
- Geen PreVote: een teruggekeerde node kan een gezonde leider afzetten (B2).
- Het netwerk dupliceert nooit berichten; dubbele aflevering is alleen in unit-tests gecontroleerd.
- De liveness-aanname "vertraging ≪ timeout" is tekst, geen controle per stap.
- D = 1500 is een testgrens bij deze timing, geen eigenschap van Raft.
- Open prestatieonderzoek: PERF-1 t/m PERF-5.

---

## CP5 — Web Workers, streaming en de basis van de applicatie

**Datum:** 2026-10-09 · **Status:** geïmplementeerd, wacht op review · **Engine-versie:** `0.4.0-cp4` (bewust ongewijzigd: geen enkele trace is veranderd)

Tot nu toe draaide de simulatie in tests of, in het CP2.5-prototype, gewoon op de hoofdthread van de browser. In CP5 krijgt elke run zijn eigen **Web Worker**. De trace wordt in stukken (*chunks*) naar de hoofdthread gestuurd, daar stap voor stap geïndexeerd, en getoond in een functionele React-applicatie met drie modi: **Configure**, **Simulate** en **Investigate**. Het definitieve visuele ontwerp volgt in CP6. Ontwerp: ADR-0021 t/m ADR-0024, SEMANTICS §19.

### CP5.1 — De event loop en waarom de hoofdthread vrij moet blijven

**1. Wat hebben we gebouwd?**
Eerst een meting (Phase 0): hoe erg is het als de engine op de hoofdthread draait?

**2. Waarom is dit nodig?**
Een browser heeft per tabblad één **hoofdthread**. Die doet alles: JavaScript uitvoeren, de pagina tekenen, op klikken reageren. Dat gaat via de **event loop**: een rij taken die één voor één wordt afgewerkt. Duurt één taak lang, dan wacht al het andere. Voor 60 beelden per seconde heb je ongeveer 16 ms per beeld.

**3. Hoe werkt het?**
✅ Gemeten: een Raft-run met 124 000 entries op de hoofdthread blokkeert die 345–476 ms aan één stuk (Chrome meldt een *long task* van 374 ms). In die tijd tekent de pagina niets en reageert ze op niets. In een Worker is de langste pauze tussen twee beelden 14–29 ms.

**5. Welke problemen kwamen we tegen?**
✅ **Mijn eerste meting was fout.** Die zei dat een blokkade van 351 ms maar 7 ms "haperen" gaf. Twee fouten: de tijd die `requestAnimationFrame` meegeeft is het *geplande* tijdstip van het beeld, niet het moment waarop de code draait; en long-task-meldingen komen pas later binnen, terwijl ik de observer al had afgesloten. Nu meet ik met `performance.now()` in de callback en haal ik openstaande meldingen op met `takeRecords()`. De test eist zelfs dat de basismeting haar eigen blokkade laat zien, zodat zo'n meetfout niet ongemerkt terugkomt.

**8. Belangrijkste begrippen**
- **Event loop:** de lus die taken één voor één uitvoert.
- **Main thread / hoofdthread:** de thread die de pagina tekent en op invoer reageert.
- **Long task:** een taak van meer dan 50 ms.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom hapert een pagina als één JavaScript-taak 350 ms duurt, ook al gebruikt de computer meerdere cores?
2. Waarom is de tijdstempel die `requestAnimationFrame` meegeeft niet geschikt om een blokkade te meten?

### CP5.2 — Web Workers en berichten

**1. Wat hebben we gebouwd?**
Het pakket `@faultlab/runtime`: een `WorkerCore` die in de Worker de simulatie draait, een `RuntimeClient` op de hoofdthread, en een vast **berichtenprotocol** (`faultlab-worker/1`) daartussen.

**2. Waarom is dit nodig?**
Een **Web Worker** is een aparte thread met een eigen event loop. Hij deelt geen variabelen met de hoofdthread: alles gaat via **berichten** (`postMessage`). Daardoor kan de simulatie rekenen terwijl de pagina soepel blijft.

**3. Hoe werkt het?**
- De hoofdthread stuurt commando's: `load`, `run`, `pause`, `step`, `stop`, `credit` en `snapshot`.
- De Worker stuurt gebeurtenissen terug: `loaded`, `chunk`, `status`, `finished` en `error`.
- Elk bericht heeft een protocolversie en een **runId**. Beide kanten controleren elk bericht. Een onbekend of fout bericht wordt een fout, het wordt nooit "geraden".
- Een functie kan niet als bericht worden verstuurd. Daarom gaat een experiment als **JSON-specificatie** naar de Worker (`@faultlab/experiments`): het protocol staat erin als naam en versie, en de Worker zoekt de code op in een register.

**4. Welke keuzes zijn gemaakt?**
Eén nieuwe Worker per run. Zo kan een oude run een nieuwe nooit beïnvloeden, ook niet met berichten die nog onderweg zijn.

**5. Welke problemen kwamen we tegen?**
✅ **Een volgordefout bij het wisselen van experiment.** De client meldde eerst "nieuwe run, laden…" en wiste pas daarna de oude trace. Een fractie van een seconde zag de UI dus de nieuwe status met de oude gegevens. De Session-test vond het; nu wordt eerst gewist en dan pas gemeld.

**8. Belangrijkste begrippen**
- **Message passing:** samenwerken door berichten te sturen in plaats van geheugen te delen.
- **Contract / protocolversie:** de afgesproken vorm van berichten, met een versienummer.
- **runId:** een unieke naam per run, zodat berichten van een oude run herkenbaar zijn.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom kun je een protocol-object met functies niet naar een Worker sturen, en wat doen we in plaats daarvan?
2. Run A loopt nog, je kiest run B. Noem twee mechanismen die voorkomen dat een bericht van A de toestand van B verandert.

### CP5.3 — Structured clone of een buffer? Eerst meten

**1. Wat hebben we gebouwd?**
Twee manieren om trace-entries te versturen. **Structured clone**: de browser kopieert de objecten zelf. **JSON in een transferable buffer**: de Worker maakt van de entries tekst en dan bytes (`ArrayBuffer`), en *verplaatst* die buffer zonder te kopiëren.

**2. Waarom is dit nodig?**
Er gaan per run tienduizenden entries over de grens. Hoe dat gebeurt, bepaalt hoeveel werk de hoofdthread heeft.

**3. Hoe werkt het?**
✅ Gemeten in alle drie de browsers (124 000 entries). Het werk in de Worker is ongeveer gelijk. Op de hoofdthread is clone goedkoper: Chrome 61 tegen 103 ms, Firefox 136 tegen 215 ms, WebKit 74 tegen 127 ms. Bij JSON moet de hoofdthread de tekst nog terug omzetten.

**4. Welke keuzes zijn gemaakt?**
Clone is de standaard: het is het eenvoudigst en het is gemeten het snelst. JSON blijft beschikbaar en getest.

**8. Belangrijkste begrippen**
- **Structured clone:** de browser maakt een diepe kopie van data die een bericht ingaat.
- **Transferable:** een buffer die wordt *overgedragen* in plaats van gekopieerd. Daarna is hij bij de afzender leeg.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom is "zero-copy" met een transferable buffer hier toch niet sneller op de hoofdthread?
2. Wat gebeurt er met een `ArrayBuffer` in de Worker nadat je hem als transferable hebt verstuurd?

### CP5.4 — Time slicing: pauzeren zonder iets te veranderen

**1. Wat hebben we gebouwd?**
De Worker rekent in **slices**: hele simulatiestappen, tot 8 ms op is. Dan stuurt hij wat hij gemaakt heeft en geeft hij de event loop terug, zodat `pause` en `stop` kunnen binnenkomen.

**2. Waarom is dit nodig?**
Een Worker die in één keer doorrekent, kan niet gepauzeerd worden: hij leest zijn berichten pas als hij klaar is.

**3. Hoe werkt het?**
Een slice stopt alleen tussen twee stappen, nooit midden in een stap. Daarom maakt het voor de uitkomst niets uit hoe groot een slice is, of hoe vaak je pauzeert. De volgende slice wordt ingepland met een `MessageChannel`: `setTimeout` wordt na een paar keer nesten minstens 4 ms vertraagd.

**4. Welke keuzes zijn gemaakt?**
- **Coöperatief pauzeren:** de Worker pauzeert zelf, bij de volgende stapgrens, en bevestigt dat.
- **Normaal stoppen:** ook bij een stapgrens. Alles wat al gemaakt was, komt nog aan, en de run heet "stopped".
- **Geforceerd beëindigen:** de Worker wordt direct afgesloten. De run heet "aborted": onvolledig en niet reproduceerbaar.

**6. Hoe hebben we het getest?**
✅ Property tests: willekeurige slice-groottes, tijdsbudgetten, chunk-groottes, credits en encodings, en willekeurige reeksen van pause, step en run. Steeds exact dezelfde trace als een directe run. ✅ In de browser: 40 pauze-hervat-cycli midden in een lange run, met dezelfde fingerprint.

**8. Belangrijkste begrippen**
- **Time slicing:** werk in kleine porties opdelen, met tussendoor ruimte voor iets anders.
- **Coöperatieve annulering:** de code stopt zelf op een veilig punt, omdat iemand dat vroeg.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom verandert pauzeren de simulatie niet? Gebruik het begrip stapgrens.
2. Wat is het verschil tussen "stopped" en "aborted", en waarom is alleen het eerste reproduceerbaar?

### CP5.5 — Backpressure: de Worker mag niet te ver vooruit lopen

**1. Wat hebben we gebouwd?**
**Credit-based flow control.** De Worker mag maximaal 4 chunks versturen die nog niet verwerkt zijn. Voor elke chunk die de hoofdthread *verwerkt* heeft, krijgt de Worker één credit terug.

**2. Waarom is dit nodig?**
De Worker maakt meer dan 100 000 entries per seconde. Als de hoofdthread het niet bijhoudt, groeien de berichtenrijen en het geheugen zonder grens.

**3. Hoe werkt het?**
Zonder credit en met een volle chunk klaar stopt de Worker met rekenen (*throttled*), tot er credit komt. Verstuurde entries gooit hij weg (`releaseTraceBefore`), zodat de Worker nooit de hele trace vasthoudt.

**5. Welke problemen kwamen we tegen?**
✅ **Een busy-wait.** Terwijl de Worker op credit wachtte, plande hij toch steeds een nieuwe slice in. Die deed niets en plande weer een nieuwe in. Dat kost CPU en stuurt een stroom statusberichten naar de hoofdthread. De test met een "trage consument" vond het. Nu wekt alleen een credit-bericht de Worker weer. De test controleert dat er niet veel meer slices zijn dan stappen, zodat de fout niet terug kan komen.
✅ Die test faalde eerst ook om een andere reden: met een opgewarmde JIT draaide de hele run in één slice, vóór de consument kon achterlopen. Nu zijn de slices bewust klein, zodat de test altijd hetzelfde meet.

**8. Belangrijkste begrippen**
- **Backpressure:** de ontvanger remt de zender af.
- **Busy waiting:** wachten door steeds opnieuw te kijken, in plaats van te wachten op een signaal.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom geeft de client de credit pas terug *nadat* een chunk verwerkt is, en niet bij ontvangst?
2. Hoeveel entries kan de Worker hooguit voorlopen op de hoofdthread? Leid de grens af.

### CP5.6 — Een oneindige lus stoppen

**1. Wat hebben we gebouwd?**
Een **watchdog** op de hoofdthread. Zegt de Worker te lang niets terwijl hij zou moeten werken, dan wordt hij beëindigd met `terminate()`. De run heet dan "aborted".

**2. Waarom is dit nodig?**
Een functie die nooit terugkeert (`for(;;){}`) kun je niet van binnenuit onderbreken: de thread komt nooit meer bij zijn event loop. Je kunt alleen de hele thread afsluiten.

**3. Hoe werkt het?**
✅ Getest met een echte oneindige lus (het diagnostische protocol `diagnostic-spin`) in drie browsers. De pagina blijft reageren: meer dan 20 beelden per seconde en navigatie werkt. Na de wachttijd volgt "aborted", met de melding dat de uitkomst niet reproduceerbaar is.

**4. Welke keuzes zijn gemaakt?**
De watchdog let alleen op als de Worker *zou moeten* werken: bij laden, tijdens een run, of bij een openstaande pauze of stop. Een gepauzeerde run zegt terecht niets.

**8. Belangrijkste begrippen**
- **Watchdog:** een bewaker die ingrijpt als iets te lang niet reageert.
- **Geforceerde beëindiging:** de thread wordt van buitenaf gestopt.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom kan de simulatie zelf een oneindige lus niet stoppen, ook niet met een timer?
2. Waarom mag een "aborted" run nooit als "completed" getoond worden?

### CP5.7 — Determinismebewaking, en wat dat kost

**1. Wat hebben we gebouwd?**
Tijdens het rekenen gooien `Math.random`, `Date`, `performance.now`, timers en `crypto` een fout. Een protocol dat ze per ongeluk gebruikt, krijgt dan een nette `protocol.error`, op precies hetzelfde punt in elke run.

**2. Waarom is dit nodig?**
Eén `Math.random()` in een protocol en de run is niet meer reproduceerbaar.

**3. Hoe werkt het?**
De functies worden tijdelijk vervangen. `performance.now` zit op het prototype: daarvoor maken we een eigen eigenschap (*own property*) die het prototype overschaduwt, en die halen we daarna weer weg.

**5. Welke problemen kwamen we tegen?**
✅ **Te duur.** Eerst deed ik dit rond elke handler-aanroep. De simulatie werd daardoor 2,6× trager (gemeten: 487 tegen 1258 ms). Nu gebeurt het één keer per slice, en kost het vrijwel niets.
✅ **De bewaking blokkeerde de runtime zelf.** De testopstelling vroeg de klok op met `performance.now()` binnen een slice, en dat gaf nu een fout. Runs bleven hangen. Daarom wordt de klok van de runtime vastgelegd bij het laden van de module (`wallClock`). Een architectuurtest zorgt ervoor dat alleen `host.ts` die functies direct gebruikt.

**7. Wat heb ik hiervan geleerd?**
Dit is bescherming tegen *ongelukken*, geen beveiliging. Code die echt kwaad wil, vindt een omweg. Echte isolatie van onbetrouwbare protocollen is CP10.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom is de bewaking per slice net zo veilig als per handler, en veel goedkoper?
2. Waarom maakt de Worker toch geen sandbox van onbetrouwbare code?

### CP5.8 — De trace stap voor stap indexeren

**1. Wat hebben we gebouwd?**
`TraceIndex.append(chunk)`: de index groeit mee met elke chunk. Het resultaat is precies hetzelfde als wanneer je achteraf de hele trace indexeert.

**3. Hoe werkt het?**
✅ **Een subtiele valkuil.** Een checkpoint van vóór de aflevering van een bericht bewaarde het bericht met de status "onderweg". Een volledig gebouwde index kent op dat moment de uiteindelijke status al. Dan zou `append` iets anders opleveren dan `build`. Daarom bewaren checkpoints nu alleen *id's*, en wordt de actuele status pas opgezocht als een frame gebouwd wordt.

**4. Welke keuzes zijn gemaakt?**
"Wie werd door deze entry veroorzaakt?" wordt nu opgeslagen in drie `Int32Array`'s: eerste kind, laatste kind en volgende broer of zus. Dat zijn gelinkte lijsten in getypeerde arrays: 12 bytes per entry in plaats van een array per entry.

**6. Hoe hebben we het getest?**
✅ Elk mogelijk splitpunt van een trace van ruim 150 entries. ✅ Willekeurige splitsingen in veel stukken, met verschillende checkpoint-intervallen en protocollen. ✅ Na elke `append` is de index gelijk aan een index van het deel dat tot dan toe binnen was.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom zou een checkpoint met hele berichtrecords `append` en `build` laten verschillen?
2. Hoe vind je met `firstChild` en `nextSibling` alle kinderen van een entry, in volgorde?

### CP5.9 — Geheugen meten (PERF-3) en vertragingen verklaren (PERF-4)

**1. Wat hebben we gebouwd?**
Meetscripts (`tools/perf`) die gebundeld en met de profilers van V8 gedraaid worden (`--cpu-prof`, `--expose-gc`, `--trace-gc`).

**3. Hoe werkt het?**
- ✅ **PERF-3:** de index kostte ongeveer even veel geheugen als de trace zelf. 64 % daarvan waren de lijsten met kinderen per entry (41,9 MB). Na de omzetting naar getypeerde arrays: 38,1 MB in plaats van 70,4 MB. Dat is 49 % van de trace.
- ✅ **PERF-4:** de trage sprongen van meer dan 100 ms kwamen *niet* door GC-pauzes: die verklaarden 0–4 % van de tijd. Dezelfde sprong opnieuw doen was snel (201 → 22 ms). Met een vooraf vergrote heap verdwenen de uitschieters. De oorzaak is dus het laten groeien van de heap terwijl een trace van ongeveer 300 MB in het geheugen staat. De Worker bewaart nu alleen keyframes, niet de hele trace.

**5. Welke problemen kwamen we tegen?**
✅ Mijn eerste geheugenscript mat overal 0. Een lokale variabele die nergens meer gebruikt werd, ruimde V8 al op vóór de meting. Getypeerde arrays tellen bovendien buiten `heapUsed`. In de browser bleek geheugen per structuur meten onbetrouwbaar: Chrome rondt `performance.memory` af tenzij je een vlag zet, en ook daarna gaf het onzin. Daar meet ik nu alleen of het geheugen na herhaalde runs terugkomt (lektest: 44 → 51 MB, daarna stabiel).

**7. Wat heb ik hiervan geleerd?**
Een hypothese ("het is vast GC") is geen bevinding. Herhaal, varieer één ding tegelijk, en kijk wat verandert.

**Dit moet ik zelf kunnen uitleggen**
1. Welke drie proeven samen lieten zien dat de uitschieters niet door GC-pauzes kwamen?
2. Waarom kan een lokale variabele een geheugenmeting laten mislukken, in beide richtingen?

### CP5.10 — PERF-5: mijn eigen hypothese was fout

**1. Wat hebben we gebouwd?**
Een profiel van de traagheid bij veel leiderwissels. In CP4 had ik opgeschreven: "de engine kopieert elke stap de hele geschiedenis". Dat klopte niet. De engine hergebruikt ongewijzigde, al gecontroleerde data al (via een `WeakSet`).

**3. Hoe werkt het?**
✅ De echte oorzaak: de Raft-geschiedenissen zijn platte objecten die per term groeien. Elke *wijziging* kopieert het hele object twee keer: één keer in de invariant zelf, en één keer in de engine, met `defineProperty` per sleutel. Dat laatste was 57 % van de rekentijd. Met `Object.fromEntries` is het resultaat precies hetzelfde maar ongeveer 1,6× sneller: 38 → 22,6 µs per stap bij 465 termen.

**4. Welke keuzes zijn gemaakt?**
Ik stop bij deze verbetering, met een onderbouwing. De kosten vallen nu in de Worker: dat raakt de doorvoer, niet de vloeiendheid van de pagina (gemeten). Realistische runs hebben tientallen termen. En de echte oplossing (geschiedenis opslaan als boom per term) verandert de vorm van drie CP4-invarianten, met versie 2 en het opnieuw vastleggen van CP4-resultaten als gevolg. Die oplossing ligt klaar voor als een echte situatie erom vraagt.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom groeit de kostprijs per wijziging met het aantal termen?
2. Waarom is `Object.fromEntries` veilig waar gewone toewijzing (`out[key] = …`) dat niet is? Denk aan `__proto__`.

### CP5.11 — Verschillende browsers, dezelfde uitkomst

**3. Hoe werkt het?**
✅ 23 referentie-experimenten: de twee engine-goldens (`7fda34b3`, `6a1dfe65`), alle presets en alle 13 opgeslagen tegenvoorbeelden. Ze geven in Node, Chromium (Chrome 154), Firefox 157 en WebKit 27.2, met beide encodings, precies dezelfde fingerprint. De referenties worden in Node berekend en vastgelegd; de browsers moeten ze reproduceren.

**7. Wat heb ik hiervan geleerd?**
Dit lukt omdat de engine alleen gehele getallen, `Math.imul`, strings en JSON gebruikt: geen sinus, geen tijd, geen landinstellingen. Determinisme over browsers heen is een ontwerpkeuze, geen geluk.

**Dit moet ik zelf kunnen uitleggen**
1. Welke soorten JavaScript-functies zouden in verschillende browsers net een ander antwoord kunnen geven?
2. Waarom worden de referentie-fingerprints in Node berekend en niet in een van de browsers?

### CP5.12 — De applicatie: React zonder dat React iets beslist

**1. Wat hebben we gebouwd?**
`apps/web` met React 19 en drie modi. Een framework-onafhankelijke `Session` bevat de run, de trace, de cursor, het "live volgen" en de selectie. React leest die via `useSyncExternalStore`.

**2. Waarom is dit nodig?**
React mag nooit bepalen wát er gebeurt, alleen hoe het eruitziet. De UI beïnvloedt een run alleen door een specificatie te laden en commando's te sturen.

**3. Hoe werkt het?**
- Meldingen worden samengevoegd tot hooguit één per beeld (`requestAnimationFrame`), zodat een snelle Worker React niet kan overspoelen.
- ✅ **De integriteitscontrole lag in de weg.** Bij elke chunk een fingerprint berekenen was ongeveer 60 % van het werk op de hoofdthread. Volgorde, gaten en dubbele stukken worden al per chunk goedkoop gecontroleerd. De fingerprint volgt daarom ná de run, in kleine porties. Het werk op de hoofdthread ging van ongeveer 575 naar 61–136 ms per 124 000 entries, en het 95e percentiel van de beeldpauzes van 45–51 naar 19–48 ms.
- UX-001 (duidelijke levensfase) en UX-002 (vaste bedieningsbalk) werken, net als bediening met het toetsenbord.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom zit de toestand in een `Session`-klas en niet in React-state?
2. Waarom is het goed om een controle te verplaatsen in plaats van te schrappen, en wat blijft er per chunk nog over?

### CP5 — Kwaliteitscontrole

- ✅ Mutatietesten: 25 mutanten op de client, de Worker, de bewaking, de incrementele index, het contract, het register en de engine. De eerste ronde ving er 23. **W7** (Worker houdt de hele trace vast) overleefde, omdat niets het geheugen van de Worker zag. De Worker meldt nu `maxRetainedEntries` en een test begrenst dat. **C7** (verificatie genegeerd) overleefde twee keer: eerst omdat geen test een verkeerde fingerprint aanbood, daarna omdat de mutant zelf fout was opgeschreven (de echte verificatie liep nog en overschreef hem). Na beide reparaties: 25 van 25 gevangen.
- Alle tests van CP0 t/m CP4 slagen ongewijzigd; geen golden fingerprint of fixture is aangepast.

### CP5 — Bekende beperkingen

- De Worker is een uitvoeringsgrens, geen sandbox; protocollen blijven vertrouwde code (CP10).
- Geheugen per structuur is alleen in Node gemeten; in browsers alleen een lektest (Chromium).
- PERF-5 is verzacht, niet opgelost: bij honderden termen groeit de kostprijs per stap nog.
- De integriteitscontrole van de ontvangen trace volgt ná de run; tijdens de run garanderen volgorde- en bereikcontroles de volledigheid.
- Het CP2.5-prototype (`apps/demo`) bestaat nog en is niet aangepast, behalve de versiecompatibiliteit uit CP4.

## CP6 — Ontwerp naar applicatie

### CP6.0 — Fase 0: eerst kijken, dan bouwen

**1. Wat hebben we gedaan?**
De drie goedgekeurde ontwerpen (Configure, Simulate, Investigate) zijn opgemeten: posities, kleuren, lettertypes en materialen. Daarnaast staat er een inventaris van wat al werkt sinds CP5, wat nieuw moet, welke toestanden de ontwerpen niet tonen en welke pagina's de specificatie noemt. Alles staat in `docs/CP6_DESIGN_AUDIT.md`. In ADR-0025 staat de beslissing om 3D-knopen (Three.js / React Three Fiber) toch in het kerninstrument te gebruiken, met voorwaarden.

**2. Waarom is dit nodig?**
Een ontwerp bevat voorbeelddata. Zonder inventaris bouw je die voorbeelddata na in plaats van de echte. Een voorbeeld: "ALL INVARIANTS SATISFIED" belooft meer dan een simulatie kan bewijzen. Een ander voorbeeld: in de inspector staat `currentTerm` onder "volatile", terwijl Raft die waarde duurzaam opslaat.

**3. Wat vonden we?**
- ✅ **De "WebKit-staart" is geen WebKit-probleem.** Gecontroleerd gemeten blijkt het streamen zelf in alle browsers vloeiend (maximaal 25 ms per beeld). De lange beelden komen van Investigate. Die toont bij "live volgen" de volledige oorzakenketen van de nieuwste entry, en bij Raft-heartbeats groeit die keten mee met de run: 8 001 voorgangers bij entry 123 930. Chromium vertraagt ook (tot 94 ms); WebKit blokkeert één keer ongeveer 44 seconden. De CP5-test zag dit niet, omdat hij maar één beeld lang in Investigate bleef.
- ✅ **Een tweede fout:** het vinkje "live volgen" springt na een klik even terug. Een gecontroleerd React-veld wacht niet op de melding van de `Session`, want die komt pas bij het volgende beeld.
- De ontwerpen gebruiken amber voor storingen, niet het eerder gekozen rood-oranje. Dat staat als open vraag (Q1).

**Dit moet ik zelf kunnen uitleggen**
1. Waarom is "het is traag in Safari" een hypothese en geen diagnose, en hoe heb ik de oorzaak geïsoleerd?
2. Waarom moeten meldingen van gebruikersinvoer meteen komen, terwijl meldingen van de Worker mogen wachten tot het volgende beeld?
3. Waarom mag de 3D-weergave nooit bepalen hoe snel of wat er gesimuleerd wordt?

### CP6.1 — Twee fouten repareren voordat we mooi gaan doen

**1. Wat hebben we gedaan?**
De twee fouten uit fase 0 zijn verholpen. Investigate toont de oorzakenketen nu in een venster: alleen de zichtbare regels staan in de pagina. De lijst zelf wordt niet ingekort; het aantal staat erbij, je kunt scrollen en met één klik naar de eerste oorzaak of naar de wortel (`run.start`) springen. En de `Session` meldt veranderingen van de gebruiker meteen, terwijl gegevens van de Worker gebundeld blijven tot het volgende beeld.

**2. Waarom is dit nodig?**
Een bevroren venster van 8,9 seconden tijdens gewoon rondkijken is geen traagheid meer, dat is kapot. En een vinkje dat terugspringt leert de gebruiker dat hij de applicatie niet kan vertrouwen.

**3. Hoe werkt het?**
- ✅ **Het lag niet aan Safari.** Een kleine meting laat zien waarom het daar het eerst misging: vijf regels vooraan een bestaande lijst van 8 000 zetten kost in een `<ol>` 191 ms in Chromium, 160 ms in Firefox en 334 ms in WebKit. Een `<ol>` hernummert bij elke wijziging al zijn items; een `<ul>` doet dat niet en kost in Chromium 8 ms. Alle browsers liepen vast, WebKit alleen het hardst.
- ✅ **De berekening was nooit het probleem.** De keten van 8 001 voorgangers opzoeken kost 0,20 ms. Het tekenen van 8 001 regels kostte alles. Ik heb eerst gemeten en daarna pas iets veranderd.
- De regressietest blijft de hele run in Investigate staan, zet "live volgen" uit en weer aan, klikt naar een eerdere gebeurtenis en speelt daarna het diepste stuk van de trace af, zodat de keten van ~8 000 echt getoond wordt. Beide tests zijn eerst tegen de oude code gedraaid: ze faalden.
- Het langste geblokkeerde moment ging van 508 ms (WebKit) naar 13 ms; het langste beeld van 8 853 ms naar 20 ms.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom is een `<ol>` duurder dan een `<ul>`, en wat zegt dat over "het ligt aan de browser"?
2. Waarom mag een venster-lijst geen gegevens weglaten, en hoe blijft de hele keten bereikbaar?
3. Waarom moeten meldingen van de gebruiker meteen komen en die van de Worker niet?

### CP6.2 — Eén bol, maar dan precies die bol

**1. Wat hebben we gebouwd?**
Een prototype (`node-lab.html`) met de gebeeldhouwde knoop in Three.js en React Three Fiber: één WebGL-context, twee tekenopdrachten, ongeacht het aantal knopen. Daarnaast een statenblad met alle toestanden (leider, kandidaat, gecrasht, afgesneden, herstellend, geselecteerd, zweven) en hun combinaties, en een terugvalweergave zonder WebGL.

**2. Waarom is dit nodig?**
Als deze bol het hart van de hele interface wordt, moet eerst vaststaan dat hij er goed uitziet, snel is, herbruikbaar is en toegankelijk blijft. Pas daarna mag hij overal verschijnen.

**3. Hoe werkt het?**
- De bol is een echte bol (één gedeelde geometrie); alles wát op en rond de rand gebeurt — de lichtrand, de gloed, de ringen — wordt analytisch in een schild ervoor getekend. Daardoor blijven lijnen scherp bij elke grootte.
- ✅ **Gemeten in plaats van gegokt.** Middelpunten en stralen zijn met een cirkelfit uit de PNG's gehaald, en de helderheid van de rand is per hoek opgemeten (linksboven 1,0, rechtsboven 0,52). Het gemiddelde verschil met de referentie is 7,4 van 255 voor de grote bol.
- Toestanden verschillen in vórm, niet alleen in kleur: gecrasht is een gebroken rand, afgesneden een stippellijn, kandidaat een onderbroken rand. Ze zitten in losse kanalen, zodat "leider én geselecteerd" geen conflict geeft.
- Elke knoop heeft een echte knop in de DOM met een naam, dus toetsenbord en schermlezer werken in alle drie de weergaven.
- Kosten: 0,3–1 ms processortijd per beeld bij 20 knopen, 1,2–2,2 ms op de grafische kaart, en nul beelden als er niets verandert.
- ⚠️ **De prijs:** het 3D-bestand is 244 kB ingepakt. Dat wil ik kleiner maken voordat dit in de applicatie zelf komt.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom tekenen we de rand en de ringen in een schild ervoor, in plaats van in de bol zelf?
2. Waarom mag een toestand nooit alleen met kleur worden aangegeven?
3. Waarom blijft het aantal tekenopdrachten twee, of er nu één of twintig knopen staan?
4. Wat betekent "op aanvraag tekenen", en waarom is dat belangrijk voor een simulator?

### CP6.3 — Waarom de bol plat leek: de normaal, niet de spiegeling

**1. Wat was er mis?**
De eerste versie van de knoop zag eruit als een donkere schijf met een lichtrand eromheen. De referentie is een massief voorwerp met een brede weerspiegeling over de hele linkerbovenkant. Mijn licht zat alleen op de rand.

**2. Waarom gebeurde dat?**
Ik berekende de weerspiegeling met de *spiegelrichting* (`reflect`). Op een bol verdubbelt dat de hoeksnelheid: het verlichte gebied krimpt tot een sikkel tegen de rand. De referentie volgt de **normaal** van het oppervlak. Dat is geen detail maar het verschil tussen plat en rond.

**3. Hoe heb ik het gevonden?**
✅ **Meten in plaats van schuiven aan knoppen.** Ik heb van alle zes referentieknopen de binnenkant uitgelezen (ongeveer 80 000 punten per bol) en met kleinste kwadraten een model gepast:
helderheid = basis + A · exp(k · (n·L − 1)) · (1 + F · (1 − n·V)^p).
Alle zes gaven dezelfde lichtrichting (−0,61 / 0,67 / −0,40) en vergelijkbare vormparameters. De amplitude A verschilde per knoop — en dat bleek betekenis te hebben: de knoop die je inspecteert is in het ontwerp lichter, de andere donkerder.

**4. Nog twee lessen**
- ✅ **Dubbeltellen.** Ik telde de randgloed óók op bij de verlichte kant, terwijl het gepaste model die kant al volledig beschrijft. Daardoor brandde de rand uit naar wit. De gloed vult nu alleen de onverlichte kant aan.
- ✅ **Warm licht komt van de rand.** Het verschil rood-min-blauw is bovenaan +36, maar in de richting van het hoofdlicht juist licht koel (−9). De warmte is dus geen eigenschap van het hoofdlicht maar van de lichtrand die het oppervlak ernaast aanstraalt. Het is een kleurverschuiving zonder extra helderheid, dus een tint, geen extra lamp.
- ✅ **Aders als richels, niet als strepen.** Eerst tekende ik de aders als donkere lijnen: dat leest als scheuren. Nu buigt de normaal langs de flanken van de ader, zodat het licht de richel zélf vangt. De breedte zakt nooit onder twee beeldpunten (`fwidth`), anders fonkelt het.
- ⚠️ **De prijs:** de grafische kaart ging van 1,4 naar 4,3 ms bij twintig knopen. Binnen de begroting van 8 ms, en de zuinige weergave is onveranderd.

**5. Over meten**
⚠️ **Het gemiddelde verschil is een slechte scheidsrechter.** Een bol is grotendeels donker, dus een gemiddelde blijft laag terwijl precies het belangrijkste — de weerspiegeling — fout is. Voor Simulate en Configure ging het gemiddelde zelfs iets omhoog terwijl het resultaat duidelijk beter werd. Ik heb daarom per gebied gemeten: de helling van het licht, de kleur per hoek, het contrast van de textuur, en het blauwe veld om een geselecteerde knoop.

**6. Wat ik heb afgewezen**
- Een ingebakken textuur: de knopen worden van 29 tot 95 beeldpunten getekend, dus één plaatje wordt óf wazig óf korrelig; het kost bovendien een bestand en geheugen in elke weergave.
- Volledige schermgloed (bloom): eerst gemeten. Het verre veld rond de grote bol komt tot op 2 van 255 overeen met de referentie. Een extra schermbewerking zou dus niets opleveren.
- Een smallere lichtval voor kleine bollen: hielp de kleine knoop een beetje en maakte de middelgrote duidelijk slechter. Afgevoerd.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom geeft rekenen met de spiegelrichting een smallere lichtvlek dan rekenen met de normaal?
2. Wat betekent "dubbeltellen" hier, en waarom zag je dat pas aan een uitgebrande rand?
3. Waarom is een gemiddeld pixelverschil een misleidende maat voor een grotendeels donker voorwerp?
4. Waarom buigen we de normaal voor een ader in plaats van de ader donkerder te maken?

### CP6.4 — De kleine bollen: waar het gemiddelde loog

**1. Wat ging er mis?**
Na alle metingen aan de grote bol leken de kleine knopen in de zijbalk van Investigate goed volgens het cijfer: een gemiddeld verschil van 11,8 — beter dan de versie die ik er daarna van maakte. Toen ik ze naast elkaar op ware grootte zette, bleek het tegendeel: de referentie is helder zilverachtig, de mijne was donker en oranje.

**2. Waarom loog het cijfer?**
Het gemiddelde verschil over een gebied wordt gedomineerd door de smalle randzone, waar een halve beeldpunt verschuiving al grote waarden geeft. Het lichaam van een kleine bol beslaat weinig beeldpunten, dus een forse fout dáár verdwijnt in het gemiddelde. Gemeten in de lichte band: de referentie haalt 179, ik haalde 107. Na correctie: 173 — maar het "cijfer" ging omhoog naar 13,3.

**3. Wat was de echte oorzaak?**
Een kleine bol heeft in de referentie een stéilere lichtval naar de rand toe dan een grote. Dat zit in de term die het licht bij scherende invalshoek versterkt, niet in de breedte van de lichtvlek. ⚠️ Mijn eerste poging was precies andersom: ik maakte de lichtvlek smaller. Dat maakte de kleine knoop drie keer te donker (52 in plaats van 179) en de middelgrote knopen ook slechter. Teruggedraaid.

**4. En de kleur?**
De kleine knopen zijn in de referentie vrijwel neutraal (+1 tot +4 rood-min-blauw), terwijl de grote bol bovenaan +36 is. Ik had ze allemaal op "warm" staan.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom kan een gemiddeld verschil over een gebied beter worden terwijl het beeld slechter wordt?
2. Wat is het verschil tussen "de lichtvlek smaller maken" en "het licht bij scherende invalshoek versterken"?
3. Waarom is naast elkaar kijken op ware grootte een noodzakelijke controle, en geen luxe?

### CP6.5 — De laatste slijpslag: vorm in plaats van sterkte

**1. Wat was de opdracht?**
Het oppervlak oogde nog te ruw, "als donkere steen in plaats van gepolijst glas". De vraag was om de aders ongeveer 25 tot 35 procent zwakker te maken.

**2. Wat bleek?**
✅ **Ik heb het eerst letterlijk gedaan** en gemeten: het contrast van de textuur ging van 25,9 naar 18,6. Het hielp niet. Het oppervlak bleef als steen lezen. De oorzaak zat niet in de *sterkte* maar in de *vorm*: mijn richels waren brede, zachte bulten, terwijl die van de referentie dunne, scherpe gegraveerde lijnen zijn. Na het versmallen van de aderdoorsnede leest het wél als gepolijst materiaal, bij een contrast van 24,0.
⚠️ **En de referentie is juist sterker getextureerd dan mijn versie** (25,9 tegen 24,0). Verder verzwakken loopt dus wég van het origineel. Ik heb de gevraagde verzwakking daarom niet doorgevoerd en dat met cijfers onderbouwd in plaats van stilletjes de instructie te volgen.

**3. Nog twee keer de verkeerde kant op**
- ⚠️ **"De lichtvlek moet verder naar binnen."** Mijn eerste poging maakte hem overal helderder dan de referentie. Toen ik de hoekverdeling opmat, bleek de referentie juist *geconcentreerder* dan mijn versie. Teruggedraaid. Het echte probleem was de **uitgebrande piek**: mijn afvlakking had geen plafond, dus lichaam plus de naar binnen uitlopende rand liepen vast op 253, waar de referentie op 242 zit. Nu een zachte begrenzing met een vast plafond.
- ⚠️ **Kleine knopen smaller belichten** gaf een betere hoekvorm én een beter gemiddeld verschil, maar kostte precies wat gevraagd was: bereik over het oppervlak. Afgewezen op het doel, niet op het cijfer.

**4. Over meten, nog een keer**
⚠️ De grafische meting via de tijdklok van de videokaart is op een laptop onbetrouwbaar in de staart: één meting van één knoop in de zuinige weergave gaf 4,78 ms p95. Ik rapporteerde eerder 3 ms extra kosten op basis van zo'n staartwaarde. **Dat was fout.** De mediaan over drie metingen zegt ongeveer 1 ms extra bij twintig knopen. Gecorrigeerd in de documentatie.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom verandert het versmallen van een ader de waarneming meer dan het verzwakken ervan?
2. Waarom heb ik een expliciete instructie niet uitgevoerd, en hoe onderbouw ik dat?
3. Wat is het verschil tussen een afvlakking zonder plafond en een zachte begrenzing mét plafond, en hoe zag je dat terug in de meting?
4. Waarom is de mediaan hier een eerlijker maat dan het 95e percentiel?

### CP6.6 — Een wankele test ontdekt (en niet stilletjes aangepast)

**1. Wat gebeurde er?**
Tijdens de eindcontrole faalde de geheugentest uit CP5 in twee van de vijf volledige testruns: "groei na drie afgesloten runs" van 16 tot 20 MB, tegen een grens van 10 MB.

**2. Is het een lek?**
Nee. De reeks metingen is 32,7 → 46,9 → 50,6 → 49,1. Vanaf de tweede meting ligt het geheugen stil rond 50 MB. De test vergelijkt echter de laatste meting met de **eerste**, en die wordt genomen terwijl de pagina nog koud is. Wat er gemeten wordt is dus opwarming (code die pas tijdens het draaien wordt vertaald, de Worker die wordt geladen), niet groei. Begint de eerste meting toevallig warm (51 MB), dan rapporteert dezelfde test 1,8 MB.

**3. Is het mijn schuld?**
Nee, en dat heb ik gecontroleerd in plaats van aangenomen: met de ingecheckte CP5-versie van `session.ts` gedraagt het zich precies hetzelfde. Bovendien draait deze test op de meetpagina, die de 3D-weergave nooit laadt.

**4. Waarom heb ik het niet gerepareerd?**
⚠️ Omdat een test aanpassen die faalt verdacht dicht bij "de test zwakker maken" ligt. De juiste reparatie is de vergelijking veranderen (laatste twee metingen in plaats van koude start tot eind), niet de grens. Dat is een beslissing van de begeleider, niet van mij. Ik heb het gemeten, onderbouwd en voorgelegd.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom is "het geheugen groeide van 33 naar 50 MB" hier géén bewijs van een lek?
2. Wat is het verschil tussen een test repareren en een test zwakker maken?
3. Waarom controleerde ik eerst of mijn eigen wijziging de oorzaak was?

### CP6.7 — De geheugentest repareren zonder hem te verzwakken

**1. Het probleem**
De CP5-geheugentest vergeleek het geheugen ná drie runs met een meting die *vóór* de eerste run werd genomen, dus op een koude pagina. Dat verschil bestaat vooral uit opwarming: code die V8 pas bij de eerste uitvoering vertaalt, en de Worker-module die geladen wordt. De uitslag hing daardoor alleen af van hoe koud die eerste meting toevallig was: drie keer dezelfde code gaf 16,4 — 19,8 — 1,8 MB "groei".

**2. De reparatie**
Twee runs vooraf om op te warmen (metingen weggegooid), dan vijf gemeten runs. De groei is nu de **helling van een kleinste-kwadratenlijn** door die vijf punten, niet het verschil tussen twee uiteinden. Daarnaast een grens op de spreiding van de hele reeks, en een telling die bewijst dat elke run zijn Worker heeft afgesloten (7 gemaakt, 0 blijven hangen). De tolerantie van 10 MB is ongewijzigd.

**3. Nog een echte vondst**
✅ **Eén keer `gc()` aanroepen is niet genoeg.** Objecten die via finalisatie vrijkomen — een beëindigde Worker hoort daarbij — hebben een ronde van de gebeurtenislus en een tweede opruiming nodig. Dát verklaarde de laatste uitschieter van 5 MB. De meting ruimt nu drie keer op met 25 ms ertussen. Daarna: negen metingen achter elkaar, groei 0 MB en spreiding hooguit 0,1 MB.

**4. Hoe weet ik dat de test nog iets kan vinden?**
⚠️ **Een test die niet kan falen is waardeloos.** Daarom zit er een foutinjectie in: met `retain: true` houdt elke afgesloten run expres zijn Session vast. De reeks wordt dan 47 → 69 → 91 → 104 → 126 MB, oftewel 19 à 20 MB per run. De test eist dat de controle daar faalt. Zo weet ik dat "groen" ook echt iets betekent.

**5. Conclusie**
Er was nooit een lek. Het geheugen loopt na het opwarmen vlak op ongeveer 47,5 MB. De oude test mat opwarming en noemde dat groei.

**Dit moet ik zelf kunnen uitleggen**
1. Waarom is de helling door vijf punten eerlijker dan het verschil tussen de eerste en de laatste?
2. Waarom kan één keer opruimen te weinig zijn, en wat heeft een Worker daarmee te maken?
3. Wat is foutinjectie, en waarom is het nodig bij een test die anders altijd groen is?
4. Wat is het verschil tussen een test repareren en een test zwakker maken — en aan welke kant valt deze wijziging?
