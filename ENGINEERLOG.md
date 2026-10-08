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
