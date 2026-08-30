# Changelog

## 0.7.2 — Active-cycle safety fix
- Block `WMWakeup` while the washer is running, rinsing, spinning, drying or otherwise active.
- Ignore a second Start command while an active cycle is already in progress.
- Prevent an accidental Flow/wakeup action from powering off an active LG washer.
- Sanitize logged HTTP errors so diagnostics do not include full Axios request headers or bearer tokens.
- Fixed washer-error Flow tokens to report the current LG error instead of the previous error value.



## 0.7.1 — Repository and support
- Added the public GitHub repository as the app homepage/source reference.
- Added GitHub Issues as the support and bug-reporting channel.
- Added npm repository/bugs metadata for development.



## 0.7.0 — App Store Release Candidate
- Renamed the app to LG ThinQ for future multi-device support.
- Added concise English and Dutch App Store readmes.
- Updated App Store descriptions.
- Added reviewer notes explaining the limited use of `homey:manager:api`.
- Preserved all washer control, Smart Washing, Homey Energy scheduling and plan persistence from v0.6.19.

## 0.6.19
- Het actieve planningvlak toont nu altijd het **geplande programma**, ook na het verversen van de widget.
- Geplande instellingen worden erbij getoond: temperatuur, centrifugeren, spoelen, drogen, wasintensiteit en actieve opties zoals TurboWash/Voorwas/Stoom.
- Ook programmaduur en deadline staan nu in het planningvlak.
- De gegevens komen uit `smart_wash_plan.config`, zodat ze niet worden overschreven door de actuele/default machine-instellingen na een widget-refresh.

## 0.6.18
- Homey Energy gebruikerskostenformule parser gecorrigeerd voor Homey's echte template-opmaak, bijvoorbeeld `{{([[price]]*1.21)+0.0248+0.1108}}`.
- Ondersteuning toegevoegd voor dubbele `[[price]]` placeholders en omringende `{{ ... }}` template-braces.
- De all-in prijs wordt nu per kwartier correct berekend uit de kale marktprijs.
- Extra compacte logregel toegevoegd met een voorbeeld van marktprijs -> all-in prijs ter controle.

## 0.6.17
- Slim Wassen haalt nu ook Homey's ingestelde **dynamische gebruikerskosten** op via de Energy API.
- De Homey `mathExpression` wordt veilig toegepast op elk kwartierprijs-punt, zodat planner en widget met de **all-in prijs** rekenen in plaats van alleen de kale marktprijs.
- Ondersteuning voor Homey-formules met `[Price]`, `[Prijs]`, `P`, `price`, `prijs` en `spotprice`.
- Compatibiliteitsfallback toegevoegd voor Homey-versies die aangepaste prijsreeksen of alleen gemiddelde waarden teruggeven.
- Logs vermelden voortaan expliciet `incl. gebruikerskosten` of `kale marktprijs`.
- Automatisch herplannen vergelijkt nu het bestaande tijdvak én het beste nieuwe tijdvak opnieuw met dezelfde actuele all-in prijsdata.
- De weergegeven gemiddelde prijs van een bestaande planning wordt bij hercontrole bijgewerkt, ook wanneer de starttijd niet verandert.
- Diagnostische prijspunten bewaren zowel de all-in prijs als de oorspronkelijke marktprijs.

## 0.6.16
- Actieknoppen blijven tijdens een actief programma zichtbaar.
- **Zoek goedkoopste tijdvak**, **Plan wassen**, **Nu starten** en **Wakker maken** worden dan duidelijk grijs/disabled weergegeven.
- Na afloop worden de knoppen automatisch weer actief.
- Expliciete disabled-opmaak toegevoegd zodat Homey de niet-actieve status visueel duidelijk toont.

## 0.6.15
- Tijdens een actief programma worden **Plan wassen**, **Nu starten** en **Wakker maken** nu volledig verborgen in plaats van alleen uitgeschakeld.
- Ook **Zoek goedkoopste tijdvak** wordt tijdens het actieve programma verborgen.
- Zodra de machine weer inactief is verschijnen de knoppen automatisch opnieuw.
- Widgethoogte wordt na verbergen/tonen opnieuw aangepast.

## 0.6.14
- ThinQ2 is nu de leidende bron voor de zichtbare machinestatus zodra ThinQ2 een geldige status heeft geleverd.
- ThinQ Connect kan daardoor niet meer kort `Slaapstand` over `Gereed` heen schrijven.
- Status-Flowtriggers volgen dezelfde leidende ThinQ2-status, zodat een tijdelijke Connect-status geen valse statuswisseling veroorzaakt.
- ThinQ Connect blijft beschikbaar als fallback bij opstarten of wanneer ThinQ2 nog geen status heeft geleverd.
- Extra logregel `STATUS bron ThinQ2:` toegevoegd voor diagnose.

## 0.6.13
- Tijdens een actief wasprogramma zijn **Plan wassen**, **Nu starten** en **Wakker maken** uitgeschakeld.
- Ook **Zoek goedkoopste tijdvak** is tijdens een actief programma uitgeschakeld.
- De knoppen worden automatisch weer beschikbaar zodra de live machinestatus niet meer actief is.
- Extra widget-guards voorkomen opdrachten vanuit een verouderde schermstatus.

## 0.6.12
- Widget toont tijdens een actief programma de **werkelijke instellingen die LG terugmeldt** in plaats van de standaardwaarden van het programma.
- Actueel programma, temperatuur, centrifugetoerental, spoelen, drogen, vervuilingsniveau en opties worden live uit ThinQ2 teruggezet in de widget.
- Runtime-waarden die LG rapporteert maar niet in de normale keuzelijst staan worden tijdelijk zichtbaar gemaakt.
- `SPIN_1400` blijft correct als `SPIN_Max` weergegeven.
- De laatst gekozen widgetconfiguratie wordt bij laden ook correct teruggezet in plaats van opnieuw alleen de programmastandaarden te tonen.

## 0.6.11
- Automatische Slim Wassen-start gebruikt nu dezelfde single-flight start-lock als **Nu starten**.
- **Nu starten** geeft direct een foutmelding als Remote Start niet actief is.
- Een planning mag met Remote Start uit worden opgeslagen; de widget toont dan een duidelijke waarschuwing.
- Vlak voor automatische start wordt Remote Start opnieuw gecontroleerd. Bij Remote uit blijft Homey proberen zolang de ingestelde deadline nog haalbaar is; daarna wordt de planning als mislukt gemarkeerd.
- Nieuwe Flow-triggers voor CallMeBot/Telegram: Slim wassen gepland, automatisch verplaatst, automatisch gestart, start mislukt en Remote Start ontbreekt.
- Flow-tokens bevatten o.a. programma, start/eindtijd, prijs, besparing en een kant-en-klaar `bericht`-token.
- Bestaande triggers **Wasprogramma klaar** en **Wasmachine storing** hebben nu ook bericht/program/fout-tokens.
- Verwachte duur van Speed 14 aangepast naar **16 minuten**, overeenkomstig de door LG gerapporteerde tijd in de praktijktest.

## 0.6.10
- Dubbele **Nu starten**-opdrachten worden nu op twee niveaus geblokkeerd.
- De widget schakelt de startknop direct tijdelijk uit.
- De device-driver heeft een single-flight lock: er kan maar één wake/download/start-sequence tegelijk lopen.
- Extra 10 seconden debounce vangt dubbele Homey-widgetevents af.
- Configuratie wordt voor **Nu starten** nog maar één keer geladen.
- Hiermee worden dubbele WMWakeup- en WMDownload-opdrachten voorkomen.

## 0.6.9
- Geplande was wordt maximaal iedere 15 minuten opnieuw vergeleken met de actuele Homey Energy-kwartierprijzen.
- Ook een planning die 's avonds voor de volgende dag wordt gemaakt blijft daardoor dynamisch.
- Alleen bij minimaal €0,01/kWh lagere gemiddelde prijs wordt de starttijd verschoven.
- **Uiterlijk klaar** blijft altijd de harde eindgrens.
- Vanaf 15 minuten vóór de geplande start wordt de planning vastgezet.
- Widget toont `Automatisch herplannen actief`, `Planning vastgezet` en het aantal automatische aanpassingen.
- **Verwachte duur** wordt nu automatisch ingevuld bij het gekozen wasprogramma.
- Turbo Wash 59 = 59 min, Snel 14 = 14 min, centrifugeren = 15 min; overige programma's krijgen een modelspecifieke startschatting.
- Bij Alleen drogen en Wassen + drogen wordt een gekozen tijdsdroogstand automatisch in de verwachte duur verwerkt.
- De duur blijft handmatig aanpasbaar omdat LG de echte programmaduur na beladingsdetectie nog kan wijzigen.

## 0.6.8
- Widgethoogte wordt nu dynamisch aangepast met `Homey.setHeight()`.
- Een `ResizeObserver` volgt zichtbare inhoud zoals prijsresultaat, actieve planning en annuleren-knop.
- Na **Plan wassen** wordt het eerdere zoekresultaat verborgen omdat de actieve planning dezelfde informatie overneemt.
- Hierdoor groeit de HTML niet meer buiten het Homey-widgetkader.
- Horizontale overflow is geblokkeerd en de widget blijft binnen 100% van de beschikbare breedte.
- Bevat de plan-fix en dynamische machinestatus uit v0.6.7.

## 0.6.7
- Vastlopen van de widget na **Plan wassen** opgelost zonder extra ThinQ2-refresh.
- Planning en **Planning annuleren** worden direct uit het `/plan` antwoord gerenderd.
- Realtime plan-event is fire-and-forget en houdt de widget-API niet meer op.
- Dynamische machinestatus toegevoegd rechtsboven in de widget.
- Tijdens een cyclus bijvoorbeeld `Wassen · nog 0u 58m`, plus Spoelen, Centrifugeren en Drogen.
- Bij stilstand blijft `Gereed · Remote ✓/✕` zichtbaar.
- LG-foutcode krijgt voorrang als `⚠ Fout · <code>`.
- Status komt realtime mee met de normale 30-seconden devicepoll.
- Daarnaast leest de widget iedere 5 seconden alleen de gecachte Homey-status, zonder extra LG-cloudverkeer.

## 0.6.6
- Na **Plan wassen** wordt de volledige widgetstatus automatisch opnieuw opgehaald en gerenderd.
- Dit geeft hetzelfde resultaat als een handmatige widget-refresh, maar nu direct na plannen.
- De knop **Planning annuleren** verschijnt hierdoor meteen betrouwbaar.
- Na annuleren wordt de widget eveneens volledig opnieuw geladen.
- Overige Slim Wassen- en LG-functionaliteit blijft ongewijzigd.

## 0.6.5
- Widget werkt de planning direct bij na **Plan wassen**; handmatig refreshen is niet meer nodig.
- Knop **Planning annuleren** verschijnt direct na succesvol plannen.
- Na annuleren verdwijnt de knop direct.
- Realtime planupdates synchroniseren nu ook de lokale widgetstatus.
- Bevat tevens de asynchrone startoplossing uit v0.6.4.

## 0.6.4
- Timeout van de widgetknop **Nu starten** opgelost.
- De widget wacht niet langer op de volledige LG ThinQ-sequentie (refresh → WMDownload → WMStart).
- Programma-instellingen worden eerst opgeslagen; daarna start de LG-sequentie asynchroon op Homey.
- De widget krijgt direct bevestiging dat de opdracht is geaccepteerd.
- Via realtime event krijgt de widget daarna alsnog **Wasmachine gestart** of de echte foutmelding terug.
- Homey Energy-planning en LG-besturing verder ongewijzigd.

## 0.6.3
- Homey Pro 13.4.1 Energy-response correct verwerkt.
- Parser ondersteunt nu expliciet `pricesPerInterval`.
- Ondersteunt Homey's `periodStart`, `periodEnd` en `value` velden.
- Detecteert de ingestelde prijsinterval (bij deze Homey 15 minuten).
- Grote volledige Energy-response wordt bij fouten niet meer naar de log geschreven.
- LG/ThinQ2-besturing en plannerlogica verder ongewijzigd.

## 0.6.2
- Homey Energy-koppeling opnieuw aangepast op basis van de officiële Apps SDK ManagerApi.
- Gebruikt `this.homey.api.getOwnerApiToken()` om een owner Web API-sessie te starten.
- Gebruikt `this.homey.api.getLocalUrl()` voor lokale toegang tot Homey.
- Dynamische elektriciteitsprijzen worden opgehaald via de officiële Energy-route `/api/manager/energy/price/electricity/dynamic`.
- Automatische eenmalige token-vernieuwing bij HTTP 401/403.
- Extra logging toegevoegd voor het aanmaken van de Homey Energy-sessie en het aantal ontvangen prijspunten.
- LG/ThinQ2-besturing en Slim Wassen-widget verder ongewijzigd.

## 0.6.1
- Homey Energy-authenticatie gecorrigeerd.
- Dynamische stroomprijzen worden nu via de geauthenticeerde Homey Web API (`homey.getApi()`) en de Energy-manager opgehaald.
- Verwijdert de fout `Missing Session` die ontstond doordat v0.6.0 de app-API-router gebruikte voor een Homey manager-endpoint.
- Extra logging toegevoegd met het aantal ontvangen prijspunten per datum.
- Slim Wassen-widget en LG-planner uit v0.6.0 blijven verder ongewijzigd.

## 0.6.0
- Nieuwe Dashboard-widget **Slim Wassen**.
- Programma, temperatuur, centrifugeren, spoelen, drogen, wasintensiteit en extra opties direct in de widget instelbaar.
- Widget kan de wasmachine direct starten of wakker maken.
- Homey Energy dynamische stroomprijzen worden rechtstreeks uit Homey gelezen.
- Planner zoekt het goedkoopste aaneengesloten tijdvak vóór een opgegeven eindtijd.
- Verwachte programmaduur is instelbaar zodat het volledige programma binnen het goedkope tijdvak past.
- Planning wordt op het apparaat opgeslagen en blijft na een app-herstart bestaan.
- Wasmachine start automatisch zodra het geplande goedkope tijdvak begint.
- Planning kan vanuit de widget worden geannuleerd.
- Vereist Homey Pro >= 12.3.0 en de Homey Web API-permissie voor het uitlezen van Energy-prijzen.

## 0.5.0
- App hernoemd van **LG ThinQ Washer Lab** naar **LG ThinQ Washer / LG ThinQ Wasmachine**.
- Directe apparaatbediening uitgebreid met:
  - Starten
  - Pauzeren
  - Uit slaapstand halen
  - Uitschakelen
  - Handmatig verversen
  - Droogniveau
  - Wasintensiteit
  - Voorwas
  - TurboWash
  - Stoom
  - Hygiënisch spoelen
  - Eco Hybrid
  - Was toevoegen
  - Uitgestelde eindtijd
- Directe instellingen gebruiken dezelfde staging/start-routine als de werkende Flow-kaarten.
- Live ThinQ2-status vult de nieuwe bedieningstegels terug.
- Model-specifieke programmaselectie uit v0.4.20 blijft behouden.

## 0.4.21
- Directe Homey-deviceknop `Wasmachine starten` toegevoegd.
- Directe Homey-deviceknop `Uit slaapstand halen` toegevoegd.
- De startknop gebruikt dezelfde werkende programmaselectie en start-routine als de Flow-kaart.
- De wake-knop gebruikt dezelfde WMWakeup-routine als de Flow-kaart.
- Fix voor model-specifieke programmavelden uit v0.4.20 blijft behouden.

## 0.4.20
- Belangrijke programmaselectie-fix: gebruikt nu het model-specifieke `Config.courseType` in plaats van altijd het veld `course`.
- Gebruikt ook model-specifieke `Config.smartCourseType`.
- Dit volgt de werkende ioBroker ThinQ2-opbouw en voorkomt dat LG de programmanaam negeert en het draaiknopprogramma (zoals Katoen) start.
- Extra logregel `LG COURSE FIELD MAP` toegevoegd voor controle.
- Inkomend `SPIN_1400` wordt vertaald naar Homey `SPIN_Max`.
- Oude/staged `SPIN_1400` wordt bij starten automatisch omgezet naar `SPIN_Max`.
- `INITIAL_BIT` en `REMOTE_START` blijven OFF, omdat deze combinatie eerder door LG correct werd geaccepteerd.

## 0.4.19
- Aparte centrifugeerkeuze `1400 rpm` verwijderd; op deze LG is dit dezelfde stand als `Max`.
- Gebruik voortaan LG-waarde `SPIN_Max` / Homey-weergave `Max`.
- Remote-start payload hersteld naar `INITIAL_BIT_OFF` en `REMOTE_START_OFF` na LG resultCode 0111.
- Flow staging uit v0.4.17/v0.4.18 blijft behouden.
- `SPINONLY` blijft beschikbaar als programma `Alleen centrifugeren`.

## 0.4.18
- LG-programma `SPINONLY` toegevoegd aan de Homey programmakeuze.
- Nederlandse naam: `Alleen centrifugeren`.
- `SPINONLY` wordt nu als geldige actuele programmastatus geaccepteerd.

## 0.4.17
- Flow-configuratie volledig volgorde-onafhankelijk gemaakt via `pending_flow_config`.
- Programma-, temperatuur-, centrifuge-, spoel- en overige kaarten vullen alleen staging-data.
- Start wacht kort op parallelle Homey-kaarten en bouwt daarna één definitieve payload.
- `initialBit` wordt bij remote start op `INITIAL_BIT_ON` gezet.
- `remoteStart` wordt bij remote start op `REMOTE_START_ON` gezet.
- Hiermee voorkomen we dat LG wel `0000` retourneert maar toch het fysieke draaiknopprogramma (zoals Katoen) start.
- Onbekende LG-programma's zoals `SPINONLY` worden niet meer naar de vaste Homey enum geschreven.

## 0.4.16
- Losse Flow-kaarten voor programma/temperatuur/centrifugeren/spoelen/drogen wijzigen alleen nog de lokale gewenste configuratie.
- Deze kaarten sturen niet meer direct een WMDownload naar LG.
- De kaart `Start wasmachine` verstuurt één complete samengestelde WMDownload gevolgd door WMStart.
- Voorkomt dat parallelle Flow-kaarten elkaar overschrijven met standaardwaarden.
- Wachttijden tussen de losse instelkaarten zijn daardoor niet meer nodig.

## 0.4.15
- Homey-validatiefout in `select_program` opgelost.
- Oude `titleFormatted` verwijzingen naar temperature/spin/rinse/dry/prewash/turbo/steam verwijderd.
- `select_program` gebruikt nu uitsluitend `[[program]]`, passend bij de opgesplitste Flow-kaarten.
- Hinttekst aangepast aan de nieuwe losse Flow-kaarten.

## 0.4.14
- Flow-kaarten opgesplitst per instelling.
- `Selecteer wasprogramma` kiest nu alleen het programma.
- Temperatuur, centrifugetoerental, spoelen en droogniveau blijven afzonderlijke dynamische Flow-kaarten.
- Voorwas, TurboWash, stoom, wasintensiteit, Medic Rinse, Eco Hybrid, was toevoegen en uitgestelde eindtijd blijven afzonderlijke kaarten.
- Start/Pauze/Uitschakelen/Wakeup blijven afzonderlijke bedieningskaarten.
- Werkende ThinQ2 control-sync implementatie uit v0.4.13 behouden.

## 0.4.13
- ThinQ2 washer control-sync aangepast naar de werkende ioBroker-structuur.
- Washeracties gebruiken nu `ctrlKey: WMWakeup/WMDownload/WMStart` met `dataSetList.washerDryer`.
- `WMStop` en `WMOff` gebruiken `ctrlKey: WMControl`.
- `dataKey`/`dataValue` envelope uit v0.4.12 verwijderd.
- `SmartCourse` wordt voor standaardprogramma's `NOT_SELECTED` in plaats van verwijderd.
- WMStart behoudt `courseDownloadType` en `courseDownloadDataLength`, overeenkomstig ioBroker `createCourse()`.
- Home Assistant dev-integratie onderzocht: deze gebruikt de officiële `thinqconnect` library en exposeert `WASHER_OPERATION_MODE` als schrijfbare select waar beschikbaar.

## 0.4.12
- ThinQ2 washer control-sync envelope gecorrigeerd.
- `ctrlKey` is nu `ControlWifi` in plaats van `basicCtrl`.
- `dataKey` bevat nu de echte washeractie (`WMWakeup`, `WMDownload`, `WMStart`, `WMStop`, `WMOff`).
- Washergegevens worden nu onder `dataValue.washerDryer` verstuurd.
- Volledige CONTROL-SYNC BODY wordt gelogd voor diagnose van LG resultCode 9006.
- v0.4.11 wake → download → start-volgorde behouden.

## 0.4.11
- WMDownload-routes worden niet meer foutief als WMStart behandeld.
- Automatische WMWakeup toegevoegd wanneer ThinQ Connect `SLEEP` meldt.
- Na WMWakeup wordt de status kort gevolgd voordat een control-write wordt uitgevoerd.
- Startvolgorde gewijzigd naar WMWakeup (indien nodig) → WMDownload → WMStart.
- WMStart krijgt geen WMDownload-only velden.
- Dubbele WMDownload sanitizer-call verwijderd.
- WMOff, WMStop en WMWakeup lopen nu ook via de centrale ThinQ2 logging.

## 0.4.10
- Centrale ThinQ2 write-wrapper toegevoegd voor WMDownload en WMStart.
- Iedere write logt nu request payload, response of HTTP-fout met LG response body.
- `SmartCourse` interne labels (`temp`, `spin`, `rinse`, `dry`, etc.) worden gegarandeerd verwijderd vóór verzending.
- Reassignment-fout rond `const payload` opgelost.
- v0.4.8/v0.4.9 fixes behouden.

## 0.4.9
- Extra ThinQ2 `/control-sync` diagnose logging toegevoegd: command, URL, request body, HTTP status en response body.
- `SmartCourse` interne waarden zoals `temp`, `spin`, `rinse` en `dry` worden niet meer naar LG gestuurd.
- Washer payloads worden vóór WMDownload/WMStart geschoond om resultCode 9006 beter te isoleren.
- Bestaande v0.4.8 `NOT_SELECTED` Homey-enum fix behouden.

## 0.4.8
- Homey 400 opgelost wanneer LG ThinQ2 tijdelijk `NOT_SELECTED` als programma rapporteert.
- `lg_program_select` bewaart de laatst geldige programmakeuze.
- Extra logging toegevoegd voor de response van `WMDownload` en `WMStart`.

## 0.4.7
- Lokale `homey` npm dependency verwijderd uit dependencies en devDependencies.
- Homey CLI wordt voortaan globaal gebruikt (`npm install -g homey`).
- Runtime dependencies beperkt tot axios, qs en luxon.
- Voorkomt dat Homey CLI dependencies de projectmap vullen met bekende npm audit meldingen.

# Changelog

Alle belangrijke wijzigingen van LG ThinQ Washer Lab.

## 0.4.6
- Start gebruikt geselecteerde programma-instellingen in plaats van defaults.
- 400 response-body logging toegevoegd.
- ThinQ Connect 416 fallback naar ThinQ2 toegevoegd.
- Device profile caching toegevoegd.

## 0.4.5
- Verplichte Homey App Store `README.txt` toegevoegd.
- README.txt bevat de publieke Nederlandstalige App Store-beschrijving.

## 0.4.4
- App selector icon fixed: white monochrome washer SVG on brand color.
- Driver icon updated.
- Pair logo added.

## 0.4.3
- App publish images corrected to 250×175, 500×350 and 1000×700.
- Flow `titleFormatted` warnings resolved.

## 0.4.2
- App-level `images` toegevoegd aan het Homey manifest voor publish-validatie.

## 0.4.1
- App-icoon voor Homey Test/Publish vernieuwd.
- Driver-icoon vernieuwd.
- PNG-afbeeldingen toegevoegd in 75×75, 500×500 en 1000×1000.
- App- en driverassets compleet gemaakt voor apparaatselectie.
- README volledig bijgewerkt.
- Changelog toegevoegd.

## 0.4.0
- Uitgebreide Flow-set toegevoegd.
- 21 actiekaarten.
- 14 triggerkaarten.
- 8 voorwaardekaarten.
- Start, pauze, uitschakelen en wakker maken toegevoegd.
- Individuele kaarten voor temperatuur, centrifugeren, spoelen en drogen.
- Voorwas, TurboWash, stoom, medic rinse en Eco Hybrid toegevoegd.
- Uitgestelde eindtijd toegevoegd.
- SmartCourse download toegevoegd.
- Status-, programma-, Remote Start-, deur- en kinderslottriggers toegevoegd.

## 0.3.6
- 1400 rpm expliciet toegevoegd.
- Maximum blijft als aparte centrifugeoptie aanwezig.

## 0.3.5
- Homey Flow-validatie van de gecombineerde programmakaart hersteld.

## 0.3.4
- Eén complete Flow-kaart toegevoegd voor programma, temperatuur, spin, spoelen, drogen, voorwas, TurboWash en stoom.

## 0.3.3
- Geselecteerde temperatuur/spin/spoelen blijft zichtbaar wanneer LG tijdens een programmastap `NO_TEMP` of vergelijkbare waarden rapporteert.

## 0.3.2
- Directe bediening vanuit het Homey apparaat toegevoegd.
- Eigen capability-iconen toegevoegd.

## 0.3.1
- Statusparser hersteld.
- Flow autocomplete voor programma's hersteld.

## 0.3.0
- Dynamische programma's uit LG model-JSON.
- Status, programma, temperatuur, spin, spoelen en drogen toegevoegd.
- Basis Flowacties en triggers toegevoegd.

## 0.2.x
- ThinQ2 authenticatie toegevoegd.
- OAuth URL-normalisatie en uitgebreide diagnostiek toegevoegd.
- ThinQ2 model- en Course-data beschikbaar gemaakt.

## 0.1.x
- Eerste ThinQ Connect integratie.
- Pairing en apparaatdetectie.
- Status- en profieldiagnostiek.
