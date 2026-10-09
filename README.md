# Trinket Lernix

Browser-Programmierumgebung für den Informatikunterricht: Python (Skulpt), HTML/CSS/JS, Blöcke
und Web VPython laufen direkt im Browser. Anmeldung über IServ, Kurse aus IServ-Gruppen,
Aufgaben mit Abgabe und Rückmeldung, Lernstand im Dashboard und per API.

Fork von [trinketapp/trinket-oss](https://github.com/trinketapp/trinket-oss) (CC0 1.0), der
nach der Abschaltung von trinket.io freigegeben wurde. Betrieb unter `https://trinket.lernix.site`
hinter dem Nginx Proxy Manager, Konfiguration ausschließlich per `.env`.

## Schnellstart (Produktion)

```bash
git clone https://github.com/mrckch/trinket-lernix.git /opt/trinket
cd /opt/trinket
cp .env.example .env && nano .env
docker compose up -d --build
```

Alles Weitere – IServ-Client, NPM-Proxy-Host, erster Admin, Backup, Aufbewahrung – steht in
[docs/lernix/BETRIEB.md](docs/lernix/BETRIEB.md).

## Entwicklung

```bash
cp .env.example .env   # NODE_ENV=development, AUTH_MODE=dev, APP_BIND=127.0.0.1
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

Test-Anmeldung ohne IServ unter `/auth/dev`. Tests, Vendor-Bibliotheken und Stolpersteine:
[docs/lernix/ENTWICKLUNG.md](docs/lernix/ENTWICKLUNG.md).

## Dokumentation

| Datei | Inhalt |
|---|---|
| [docs/lernix/PLAN.md](docs/lernix/PLAN.md) | Umbauplan, Entscheidungen, Stand der Phasen |
| [docs/lernix/adr/](docs/lernix/adr/) | Architekturentscheidungen (Konfiguration, Anmeldung, Gruppen und Aufbewahrung, Lernstand-API, Login-Pflicht/Deutsch/Vendor) |
| [docs/lernix/openapi.yaml](docs/lernix/openapi.yaml) | Lernstand-API (`/api/v1`, Bearer-Token) |
| [docs/lernix/BETRIEB.md](docs/lernix/BETRIEB.md) | Betrieb auf der Docker-VM |
| [deploy/npm/](deploy/npm/) | Proxy-Host und Advanced-Snippet für den NPM |

## Was anders ist als bei trinket-oss

- Anmeldung nur über IServ (OIDC), Rollen Schüler:in / Lehrkraft / Admin, Notfall-Admin
- Kurse mit IServ-Gruppen verknüpft, SuS werden beim Login eingetragen
- Lernstand-API mit Token, Aufbewahrung je Schuljahr, Interaktions-Log ohne IP-Adressen
- Login-Pflicht, deutsche Oberfläche, keine externen CDNs oder Google Fonts
- Nur Browser-Sprachen (Skulpt); der `serverside/`-Stack von trinket-oss wird nicht benutzt

Lizenz: CC0 1.0 wie das Original ([LICENSE](LICENSE)).
