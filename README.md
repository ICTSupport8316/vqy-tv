# VQY Hal-TV

Diavoorstelling voor de TV in de hal: een weerslide en intern nieuws met eigen foto's, titels
en teksten. Elke slide is los op te maken: kleuren, lettertype, groottes, indeling, logo,
hoe lang hij in beeld blijft en tussen welke datums hij getoond wordt.

| Adres | Wat |
|---|---|
| `http://hall-tv:8800/` | De TV-weergave (schermvullend openen op de TV) |
| `http://hall-tv:8800/beheer` | Beheerpagina met wachtwoord |

`hall-tv` is een DNS-alias (CNAME) voor de dashboardserver **VQY-WS-003**, zie
[Netwerknaam](#netwerknaam-hall-tv). Werkt de naam (nog) niet, gebruik dan
`http://vqy-ws-003:8800/`.

- `server.js`: Node/Express-server (API, uploads, weer via Open-Meteo, geen API-key nodig)
- `public/`: TV-weergave (`tv.html`, `tv.js`), beheerpagina (`admin.*`) en de gedeelde
  slide-opmaak (`render.js`, `render.css`), zodat het voorbeeld in de beheerpagina precies
  gelijk is aan de TV
- `data/` (niet in git): `content.json` (slides en instellingen), `auth.json`
  (wachtwoord-hash), `uploads/` (foto's en logo)
- `deploy/`: script voor automatische deploy

## Gebruik

1. Open `/beheer`. De eerste keer kies je daar het beheerwachtwoord (doe dit direct na de
   eerste deploy; tot dan kan iedereen op het netwerk het instellen).
2. **Instellingen**: plaats voor het weer, logo (PNG met transparante achtergrond),
   overgang (schuiven/vervagen), klok aan/uit.
3. Slides toevoegen, slepen om de volgorde te wijzigen, oogje om aan/uit te zetten.
   Alles wordt automatisch opgeslagen; de TV neemt het binnen ±20 seconden over.
4. Tekstopmaak: `**vet**`, `*schuin*`, regels die beginnen met `- ` worden een opsomming,
   `{plaats}` wordt de plaatsnaam van het weer (Instellingen).
   Past de tekst niet, dan wordt hij automatisch kleiner gemaakt (de beheerpagina waarschuwt).

De TV herlaadt zichzelf na een nieuwe deploy en blijft de laatste slides tonen als de
server even weg is. Pijltjestoetsen links/rechts op de TV-pagina: vorige/volgende slide.

## Lokaal draaien

```powershell
npm install
npm start          # http://localhost:8800 en http://localhost:8800/beheer
```

## Hoe deployen werkt

Elke push naar `main` wordt automatisch live gezet:

1. GitHub Actions start `.github/workflows/deploy.yml` op de **self-hosted runner** met label
   `hall-tv` op de dashboardserver.
2. `deploy/deploy.ps1` kopieert de nieuwe versie naar `C:\HallTV` (`data\`, `.env` en `logs\`
   blijven staan), installeert dependencies als `package-lock.json` veranderd is en herstart
   de geplande taak **VQY Hal-TV**.
   De eerste keer maakt het script die taak zelf aan (start bij opstarten, draait als SYSTEM,
   herstart na een crash) en een firewallregel **VQY Hal-TV** voor TCP 8800 (domein/privé).
3. Het script controleert of de hal-TV weer reageert; zo niet, dan wordt de run rood en staan
   de laatste logregels in de uitvoer.

Handmatig opnieuw deployen: GitHub → **Actions** → *Deploy hal-TV* → **Run workflow**.
Logs: `C:\HallTV\logs\server.log`.

Herstarten zonder deploy (bijv. na een wijziging in `.env`): dubbelklik op
`C:\HallTV\deploy\restart-hall-tv.cmd` op de server (vraagt zelf om administratorrechten).
Handig als snelkoppeling op het bureaublad.

## Eenmalige installatie op de server

Node.js staat er al (voor het support dashboard). Alleen een runner voor deze repository is
nodig: een runner hoort bij één repository, dus die van het support dashboard kan dit niet doen.

1. GitHub → deze repository → **Settings** → **Actions** → **Runners** → **New self-hosted
   runner** → **Windows**. Voer de download-commando's uit in een **nieuwe** map
   `C:\actions-runner-hall-tv` (PowerShell als administrator; niet in `C:\actions-runner`,
   die is van het support dashboard). Configureren met:
   ```powershell
   .\config.cmd --url <repo-url> --token <token-uit-github> --labels hall-tv `
       --name hall-tv --runasservice --windowslogonaccount "NT AUTHORITY\SYSTEM"
   ```
2. GitHub → **Actions** → *Deploy hal-TV* → **Run workflow**. Groen = klaar.
3. Netwerknaam `hall-tv` aanmaken (zie hieronder).
4. Open `http://hall-tv:8800/beheer` en kies direct het beheerwachtwoord.
5. Zet op de TV `http://hall-tv:8800/` schermvullend open (kiosk-modus of de browser van de TV).

## Netwerknaam hall-tv

Eén DNS-record in de interne zone `vanquish-yachts.com` (AD-DNS, servers 10.0.0.4 en 10.0.0.5):
een **CNAME** `hall-tv` → `vqy-ws-003.vanquish-yachts.com`. Een CNAME volgt de server mee als
zijn IP-adres verandert. Via DNS-beheer (**DNS Manager** → Forward Lookup Zones →
`vanquish-yachts.com` → New Alias (CNAME)) of in PowerShell op een domeincontroller:

```powershell
Add-DnsServerResourceRecordCName -ZoneName 'vanquish-yachts.com' -Name 'hall-tv' `
    -HostNameAlias 'vqy-ws-003.vanquish-yachts.com'
```

Apparaten krijgen via DHCP het achtervoegsel `vanquish-yachts.com`, dus `http://hall-tv:8800`
werkt dan overal op het bedrijfsnetwerk. Op een apparaat zonder dat achtervoegsel (bijv. een
TV op het gastnetwerk of met handmatig ingestelde DNS) werkt alleen het volledige adres
`http://hall-tv.vanquish-yachts.com:8800`, en dan alleen als het apparaat de interne
DNS-servers gebruikt. Na elke deploy controleert `deploy.ps1` of `hall-tv` naar deze server wijst.

## Back-up

De inhoud staat alleen in `C:\HallTV\data`. Neem die map mee in de back-up van de server.

## Beveiliging

- De beheerpagina zit achter een wachtwoord (scrypt-hash, sessiecookie 30 dagen, na 8 foute
  pogingen 5 minuten geblokkeerd). Wachtwoord wijzigen kan bij Instellingen; dat logt andere
  apparaten uit.
- De server serveert alleen `public/` en de uploads; `data/auth.json`, `.env` en de broncode
  zijn niet via de browser op te vragen.
- De runner draait alleen workflows uit deze (private) repository. Houd de repo privé.
