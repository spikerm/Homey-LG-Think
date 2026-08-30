# LG ThinQ

Homey Pro app voor LG ThinQ wasmachines.

## Versie
**0.7.0 App Store Release Candidate**

## Ondersteunde machine tijdens ontwikkeling
LG ThinQ washer / washer-dryer  
Modelprofiel: `F_V7_F___W.B_2QEUK`

De app gebruikt twee LG interfaces:

- **ThinQ Connect** voor betrouwbare statusdata.
- **ThinQ2** voor uitgebreide bediening, programma's en modelinformatie.

## Belangrijkste functies

### Apparaat
- Status
- Huidig programma
- Resterende tijd
- Totale tijd
- Temperatuur
- Centrifugeren
- Spoelen
- Droogniveau
- Remote Start status
- Bedieningsmodus
- Aantal cycli
- ThinQ2 status
- Programmakeuze vanuit het apparaatscherm
- Temperatuur instellen
- Centrifugetoerental instellen
- Spoelen instellen

### Flow — acties
- Compleet wasprogramma instellen in één kaart
- Programma kiezen
- Temperatuur instellen
- Centrifugeren instellen
- Spoelen instellen
- Droogniveau instellen
- Wasintensiteit instellen
- Voorwas aan/uit
- TurboWash aan/uit
- Stoom aan/uit
- Hygiënisch spoelen aan/uit
- Eco Hybrid aan/uit
- Was toevoegen instellen
- Uitgestelde eindtijd instellen
- Extra SmartCourse downloaden
- Start
- Pauze
- Uitschakelen
- Wakker maken
- Status verversen
- Diagnostiek loggen

### Flow — triggers
- Wassen gestart
- Programma klaar
- Storing
- Status gewijzigd
- Programma gewijzigd
- Spoelen gestart
- Centrifugeren gestart
- Drogen gestart
- Remote Start aan/uit
- Deur vergrendeld/ontgrendeld
- Kinderslot aan/uit

### Flow — voorwaarden
- Wasmachine is actief
- Remote Start actief
- Deur vergrendeld
- Kinderslot actief
- Storing aanwezig
- Status is ...
- Programma is ...
- ThinQ2 online

## Koppelen

Tijdens pairing vul je op één scherm in:

1. ThinQ Connect Personal Access Token
2. LG-account e-mail
3. LG-account wachtwoord
4. Landcode, standaard `NL`
5. Taalcode, standaard `nl-NL`

Het LG-accountwachtwoord wordt niet permanent opgeslagen. De ThinQ2 refresh-token wordt per apparaat opgeslagen.

## Installeren voor ontwikkeling

```powershell
npm install
homey app validate
homey app run
```

## Test / Publish assets

Deze versie bevat de vereiste Homey assets:

- `assets/icon.svg`
- `assets/images/small.png`
- `assets/images/large.png`
- `assets/images/xlarge.png`
- `drivers/washer/assets/icon.svg`
- `drivers/washer/assets/images/small.png`
- `drivers/washer/assets/images/large.png`
- `drivers/washer/assets/images/xlarge.png`

De app- en drivericons zijn hierdoor zichtbaar in apparaatselectie en geschikt voor Homey Test/Publish-validatie.

## Opmerking

Niet iedere instelling is bij ieder wasprogramma geldig. De app gebruikt het LG modelprofiel om waar mogelijk alleen toegestane waarden aan te bieden.


## Publish fix 0.4.2
Homey vereist naast driver-afbeeldingen ook app-level `images` in het manifest.
Deze verwijzen nu naar:
- `/assets/images/small.png`
- `/assets/images/large.png`
- `/assets/images/xlarge.png`


## Publish fix 0.4.3
- App publish-afbeeldingen aangepast aan Homey's vereiste formaten:
  - small: 250×175
  - large: 500×350
  - xlarge: 1000×700
- `titleFormatted` toegevoegd aan alle Flow-kaarten waarvoor Homey een waarschuwing gaf.


## Icon fix 0.4.4
- `assets/icon.svg` opnieuw opgebouwd als expliciet wit monochroom wasmachine-icoon.
- Homey toont `assets/icon.svg` bovenop `brandColor`; het eerdere zwarte artwork verdween daardoor visueel in de app-lijst.
- Driver `icon.svg` gelijkgetrokken.
- Apart `pair.svg` toegevoegd voor het koppelvenster.


## Fix v0.4.6 — Diagnostics 400/416
- Startactie gebruikt nu het daadwerkelijk gekozen programma-payload uit Homey in plaats van opnieuw de LG-standaardwaarden te genereren.
- Hierdoor blijven bijvoorbeeld `TEMP_60` en `SPIN_Max` behouden bij Start.
- WMDownload-only velden worden verwijderd voordat WMStart wordt verstuurd.
- ThinQ2 HTTP 400-fouten loggen voortaan endpoint, HTTP-status en LG response-body.
- ThinQ Connect `416 Not connected device` wordt als tijdelijke Connect-fout behandeld; ThinQ2 blijft de status verversen.
- ThinQ Connect profile wordt gecachet en niet meer elke 30 seconden opnieuw opgevraagd.

## Ontwikkelomgeving v0.4.7
De Homey CLI staat niet meer als lokale npm dependency in dit project. Installeer deze éénmalig globaal:

```powershell
npm install -g homey
```

Installeer daarna in de app-map alleen de runtime dependencies:

```powershell
npm install
npm audit
homey app validate
```

Gebruik geen `npm audit fix --force` voor Homey CLI-afhankelijkheden.

## Fix v0.4.8 — NOT_SELECTED
LG ThinQ2 kan tijdelijk `NOT_SELECTED` teruggeven voor het huidige programma. Dat is geen geldige Homey enumwaarde. De app slaat deze tijdelijke waarde daarom over en houdt de laatst geldige programmakeuze vast. Ook worden de antwoorden op `WMDownload` en `WMStart` gelogd voor verdere diagnose.

## Diagnose v0.4.10
Alle WMDownload- en WMStart-writes lopen door één centrale ThinQ2 write-wrapper. Daardoor verschijnen nu altijd de verzonden payload en de LG-response of HTTP-fout in de Homey debuglog. Interne SmartCourse-labels zoals `temp`, `spin`, `rinse` en `dry` worden vóór verzending verwijderd.

## ThinQ2 startvolgorde v0.4.11
De app gebruikt nu de modelgedefinieerde volgorde voor de wasmachine: wanneer de machine in `SLEEP` staat wordt eerst `WMWakeup` gestuurd. Daarna wordt het gekozen programma met opties via `WMDownload` overgebracht en pas daarna wordt `WMStart` uitgevoerd. De twee WMDownload-only velden worden vóór WMStart verwijderd.

## ThinQ2 ControlWifi envelope v0.4.12
Washercommando's worden nu als afzonderlijke `ControlWifi` acties naar `/control-sync` gestuurd. De actie staat in `dataKey` en de washerdata in `dataValue.washerDryer`. Dit volgt de structuur die het LG model-JSON voor `WMWakeup`, `WMDownload`, `WMStart`, `WMStop` en `WMOff` definieert.

## ThinQ2 washer format v0.4.13
De control-aanroep volgt nu de werkende ioBroker LG ThinQ-implementatie: `ctrlKey` is de washeractie zelf (`WMWakeup`, `WMDownload`, `WMStart`) en de modeldata wordt verzonden via `dataSetList.washerDryer`. `WMStop` en `WMOff` gebruiken `WMControl`. Voor normale programma's wordt `SmartCourse` expliciet op `NOT_SELECTED` gezet.


## Support & issues

Project repository: https://github.com/spikerm/Homey-LG-Think

Please report bugs, unsupported models and feature requests through GitHub Issues:
https://github.com/spikerm/Homey-LG-Think/issues
