# første konstruksjonsrunde: brakett med tre feste

målet var å utvide modelleringsverktøya og bruke dei på éi krevjande form frå referansebileta. dette er ein visuell konstruksjonsstudie; dimensjonane er valde for studien.

## arbeidsflyten som er bygd

start med **blank construction** i filmenyen. legg inn **sweep** i insert-panelet. teikn og flytt kontrollpunkt i xy, xz eller yz, og still kvar koordinat og radius presist. bruk merge og blend for samanføying, og vanlege former med cut for opningar. spegling lagar ein separat redigerbar kopi rundt verdsorigo. flytting i objektlista endrar rekkjefølgja til operasjonane.

**truss bracket** under worked study er resultatet av desse same handlingane. oppskrifta er i `lib/truss-study.ts`; ho startar med eit tomt dokument og legg til kvar operasjon. studien inneheld tre ulikt orienterte feste, ti kurver, tre gjennomgåande opningar og åtte festehol. ingen importert overflatemesh definerer forma.

## det forsøket allereie avdekte

- kurver med varierande radius gjer forgreina former mykje enklare å byggje enn kjeder av roterte kapslar. alle kontrollpunkt er framleis redigerbare.
- lokale kurvekoordinatar og verdskoordinatar for plassering treng tydelege merkelappar. elles blir det lett å endre feil akse.
- den første meshen ved 134 hadde éin samanhengande komponent og ingen trekantkantar med feil tal naboflater. dette er ein geometrikontroll, ikkje ein kontroll av styrke eller produksjon.
- to motsette kameravinklar viste at opningane og bakre ribber faktisk finst. ein pen frontvinkel er ikkje tilstrekkeleg kvalitetskontroll.
- runde tverrsnitt gav for mykje preg av røyr. flata tverrsnitt er nødvendig for dei breiare, organiske greinene i referansen.
- flensar og små hol fekk tydeleg taggete kantar ved den første, grovare meshoppløysinga. dette avdekte ein svakheit i nullkryssinga i mesheren.
- første evaluering ved 134 tok 27,7 sekund på denne maskina. avgrensa evaluering av csg og førebudde kurvefelt reduserte same geometri til 7,5 sekund. dette er målingar frå utviklingsmiljøet; telefonfart må målast på ein telefon.
- vidare kontroll fann ein feil i nullkryssinga ved harde møte mellom flater: enkelte eksportpunkt låg opptil 0,417 mm frå feltet si nullflate. ein adaptiv, avgrensa rotløysar rettar dette utan å endre delte meshkantar. største feltavvik i kontrollen ved 134 vart 0,0000131 mm. dette er solverpresisjon; det fjernar ikkje sjølve trekantapproksimasjonen.
- endeleg eksport ved 220 tok 20,0 sekund og gav 349 700 trekantar. vinklane viser meir varierande opningar, flata greiner og reinare overgangar til flensane. skarpe kanter og små hol har framleis synleg diskretisering.
- den endelege stl-fila har éin samanhengande komponent, ingen opne kantar, ingen kantar med fleire enn to naboflater og konsekvent orientering. alle koordinatar er endelege. nokre svært små trekantar står att ved nullkryssingane; lokal meshing bør òg forbetre dette.
- den same studien er bygd i arbeidsflata gjennom 28 handlingar: eitt tomt dokument og 27 former. numerisk punktredigering, dragging i skissa, innsetjing av punkt og spegling er testa. angre gjenoppretta nøyaktig same dokument. escape avbraut namneendring, og modellen og det lagra alternativet overlevde gjenopning. nettlesaren i testmiljøet har webgl avslått; 3d-geometrien er difor inspisert gjennom meshen, medan grensesnittet vert testa direkte.

## neste programmeringsrunde

1. feste kurveendepunkt til namngjevne referansepunkt på eit feste. no er sambandet basert på manuelt valde koordinatar og kan gli frå kvarandre etter redigering.
2. mål og juster orientering med retning og akse, i tillegg til tre eulervinklar. særleg skrå rektangulære feste er tungvinte å stille inn.
3. kurver med roterande tverrsnittsramme, bandprofil og meir målretta blending ved forgreiningar. ei flating langs lokal z dekkjer ikkje alle romlege ribber.
4. lokal, adaptiv meshoppløysing ved små hol og skarpe flenskantar, og raskare førehandsvising av store konstruksjonar.
5. direkte kontrollpunkt i 3d, fleirval og snapping. dei plane skissene er nyttige, men romlege møtepunkt krev framleis fleire steg.

studien er eit kontrollert første forsøk. form og overflate må vurderast vidare mot referansen; lastvegar, toleransar og materialåtferd er ikkje rekna ut.
