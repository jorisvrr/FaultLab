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
- *Lazy cancellation:* een geannuleerde timer blijft in de heap staan en wordt overgeslagen zodra hij bovenaan komt. Annuleren kost zo O(1), maar dode entries kosten geheugen. Dat wordt in CP1 onderzocht.

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
