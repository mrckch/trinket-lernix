# Betrieb — Trinket Lernix auf der Docker-VM

> **Wo läuft alles?** Auf der DockerVM2 (`192.168.1.41`, Tailscale `dockervm2-zuhause`) im
> Ordner `/opt/trinket`, neben den anderen Schul-Apps. TLS endet im Nginx Proxy Manager
> (`192.168.1.20`), die App läuft dahinter ohne TLS.

| | |
|---|---|
| Öffentlich | `https://trinket.lernix.site` → NPM-Proxy-Host auf `http://192.168.1.41:8090` |
| Direkt im Heimnetz | `http://192.168.1.41:8090` |
| NPM-VM | `192.168.1.20` (= `TRUSTED_PROXIES`) |
| Anmeldung | `AUTH_MODE=iserv` — SuS und Lehrkräfte über IServ (`rsstu.de`), sonst nur der Notfall-Admin |
| Admin-Bereich `/admin` | nur mit Admin-Rolle; IP-Sperre per `ADMIN_IP_ALLOWLIST` – im Betrieb `*` (keine IP-Beschränkung, Entscheidung Marc 2026-10-09) |
| Container | `trinket-app`, `trinket-db`, `trinket-redis`, `trinket-backup`, `trinket-maintenance` |
| Volumes | `trinket_mongo-data` (alle Daten), `trinket_redis-data` (Cache, verzichtbar), `trinket_backups` (tägliche Dumps, 30 Tage) |

## 1. Erstinstallation auf der Docker-VM

```bash
ssh root@dockervm2-zuhause
git clone https://github.com/mrckch/trinket-lernix.git /opt/trinket
cd /opt/trinket
cp .env.example .env
nano .env        # siehe Abschnitt 2
docker compose up -d --build   # erster Bau: ~5 Minuten (npm, Komponenten, Vendor-Bibliotheken)
docker compose logs -f app     # bis "Server started on port: 3000"
curl -s http://127.0.0.1:8090/healthz   # → ok
```

Beim ersten Start legt MongoDB den App-Benutzer an und die App den Notfall-Admin. Das Image
braucht beim Bau Internet (GitHub-Release mit Ace/Skulpt/Blockly, cdnjs, npm).

## 2. `.env` ausfüllen

| Variable | Wert |
|---|---|
| `APP_PORT` | `8090` (8070 ist das Glossar) |
| `TRUSTED_PROXIES` | `192.168.1.20` |
| `ADMIN_IP_ALLOWLIST` | Im Betrieb `*` (Admin-Bereich und Notfallzugang von überall, geschützt durch Admin-Rolle bzw. 24-stelliges Zufallspasswort). Alternative: CIDR-Liste, z. B. `192.168.1.0/24` – aus dem Heimnetz kommt die App über den NPM mit **`192.168.1.1`** an (Hairpin-NAT des Routers), nicht mit der PC-Adresse |
| `PUBLIC_BASE_URL` | `https://trinket.lernix.site` – daraus entsteht die IServ-Redirect-URI |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `AUTH_MODE` | `iserv` |
| `REQUIRE_LOGIN` | `true` |
| `ISERV_ISSUER` | `https://rsstu.de` |
| `ISERV_CLIENT_ID` / `ISERV_CLIENT_SECRET` | aus dem IServ-Client (Abschnitt 3) |
| `ISERV_TEACHER_MARKERS` | `lehrer,teacher,kollegium` – Teilstrings in IServ-Rollen oder -Gruppen |
| `BREAKGLASS_EMAIL` / `BREAKGLASS_PASSWORD` | lokaler Notfall-Admin, **keine** IServ-Adresse verwenden (z. B. `notfall@trinket.lernix.site`) |
| `RETENTION_*` | Schuljahresende `07-31`, Papierkorb `30` Tage (ADR 0003) |
| `MONGO_PASSWORD` / `MONGO_ROOT_PASSWORD` | `openssl rand -hex 16` je |

Die `.env` ist nur für root lesbar; sie enthält alle Geheimnisse.

## 3. IServ-Client anlegen (IServ-Admin)

In IServ unter *Verwaltung → System → Single-Sign-On* einen neuen OAuth/OIDC-Client anlegen:

| Feld | Wert |
|---|---|
| Name | Trinket |
| Redirect-URI | `https://trinket.lernix.site/auth/iserv/callback` – exakt |
| Vertrauenswürdig | ja (kein Einwilligungsdialog bei jeder Anmeldung) |
| Beschränkungen → Auf Scopes einschränken | `openid profile email iserv:uuid iserv:groups iserv:roles` |

**`iserv:uuid` muss von Anfang an dabei sein.** Fehlt er, fällt die App auf `sub` zurück; wird er
später ergänzt, ändern sich alle Kennungen und jedes Konto wird neu angelegt. Client-ID und Secret
in die `.env`, dann `docker compose up -d`.

Die Lehrkraft-Erkennung sucht in IServ-Rollen **und** -Gruppen nach den Markern. Abgewiesene
oder falsch eingestufte Anmeldungen stehen im Log mit den gelieferten Claim-*Namen*
(`docker compose logs app | grep IServ`).

## 4. NPM-Proxy-Host

Siehe [deploy/npm/README.md](../../deploy/npm/README.md): Proxy Host `trinket.lernix.site` →
`http://192.168.1.41:8090`, Block Common Exploits, Force SSL, HTTP/2, Websockets **aus**.
DNS bei Namecheap: **CNAME** Host `trinket` → `lernix.site.` wie `glossar` und `lefo` (folgt der
dynamischen Heim-IP). Das Host-Feld ist relativ – `trinket.lernix.site` als Host ergäbe
`trinket.lernix.site.lernix.site`. Das Let's-Encrypt-Zertifikat erst anfordern, wenn der Name auflöst.

**Port 8090 / Firewall:** Auf dockervm2 ist kein `ufw` installiert, und von Docker veröffentlichte
Ports umgehen `ufw` ohnehin. Entscheidung (Marc, 2026-10-09): Port 8090 bleibt im Heimnetz
erreichbar wie bei Glossar (8070) und Learning-Apps (8060); die App schützt sich selbst
(Login-Pflicht, Rollen). Wer ihn doch nur für den NPM öffnen will, braucht eine Regel in der
Docker-Kette `DOCKER-USER` (betrifft nur diesen Port, muss persistent gemacht werden):

```bash
iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 8090 --ctdir ORIGINAL ! -s 192.168.1.20 -j DROP
```

## 5. Erster Admin

1. Marc meldet sich einmal über IServ an (bekommt Rolle Lehrkraft).
2. Auf der VM: `docker compose exec app npm run make-admin <marcs-iserv-mail>` – oder als
   Notfall-Admin unter `/admin` die Rolle vergeben.
3. Ab dann verwaltet Marc alles über IServ; der Notfall-Admin bleibt für Notfälle (nur aus
   `ADMIN_IP_ALLOWLIST`, Link „Notfallzugang“ auf der Login-Seite).

## 6. Prüfen

- `https://trinket.lernix.site/healthz` → `ok`
- Löst der Name im Heimnetz nicht auf, obwohl er öffentlich existiert: Der Pi-hole (`192.168.1.10`)
  hat die frühere NXDOMAIN-Antwort bis zu 1 h im Cache → *Settings → System → Restart DNS resolver*
  (oder `pihole restartdns`), danach am PC `ipconfig /flushdns`.
- `https://trinket.lernix.site/` zeigt „Mit IServ anmelden“; Anmeldung als Lehrkraft und als
  Schüler:in testen (Rolle unter `/admin` sichtbar).
- Ohne Anmeldung ist `/python` nicht erreichbar (Umleitung zum Login), eine Einbettung
  `/embed/python/<id>` eines vorhandenen Trinkets schon.
- `/admin` von außerhalb der Allowlist → 403 (entfällt bei `ADMIN_IP_ALLOWLIST=*`).
- Keine Verbindungen zu fremden Hosts: Browser-Netzwerkansicht zeigt nur `trinket.lernix.site`.

## 7. Update

```bash
cd /opt/trinket
git pull --ff-only
docker compose up -d --build
```

Upstream-Änderungen von `trinketapp/trinket-oss` kommen über `git fetch upstream` +
`git merge upstream/main` (Konflikte vor allem in Templates; siehe ADR 0005).

## 8. Backup und Wiederherstellung

Täglich schreibt `trinket-backup` einen komprimierten Dump nach `/backups` im Volume
`trinket_backups` (30 Tage). Vom Host kopieren:

```bash
docker run --rm -v trinket_backups:/backups -v /root:/out alpine \
  sh -c 'cp /backups/$(ls -t /backups | head -1) /out/'
```

Der erste automatische Dump direkt nach der Erstinstallation ist leer (DB noch ohne Daten).
Einen frischen Dump ins Volume auslösen: `docker compose restart db-backup` (dumpt beim Start,
dann alle 24 h).

Manuell vor Updates:

```bash
docker compose exec -T mongodb sh -c 'mongodump --db trinket -u "$MONGO_USER" -p "$MONGO_PASSWORD" --archive --gzip' > /root/trinket-$(date +%F).archive.gz
```

Wiederherstellen (ersetzt den Datenbestand):

```bash
docker compose exec -T mongodb sh -c 'mongorestore --db trinket -u "$MONGO_USER" -p "$MONGO_PASSWORD" --archive --gzip --drop' < /root/trinket-YYYY-MM-DD.archive.gz
```

Die `.env` gehört mit ins Backup (Session-Secret, Zugangsdaten); nie zusammen mit einem Dump
weitergeben.

## 9. Aufbewahrung

`trinket-maintenance` läuft täglich (ADR 0003): nach dem 31.07. werden IServ-Kurse archiviert
und Trinkets/Abgaben von SuS in den Papierkorb gelegt, nach 30 Tagen endgültig gelöscht.
Vorher ansehen, was passieren würde:

```bash
docker compose exec app node scripts/maintenance.js --dry-run
```

## 10. Logs und Fehlersuche

```bash
docker compose ps
docker compose logs -f app
docker compose logs app | grep -i "iserv\|fehler\|error" | tail -50
```

| Symptom | Ursache / Abhilfe |
|---|---|
| Login-Seite sagt „IServ-Anmeldung ist noch nicht eingerichtet“ | `ISERV_CLIENT_ID`/`SECRET` fehlen in der `.env` |
| IServ meldet `invalid_request` | Redirect-URI im IServ-Client weicht von `PUBLIC_BASE_URL + /auth/iserv/callback` ab |
| Lehrkraft landet als Schüler:in | Marker fehlen in Rollen/Gruppen; Claim-Namen im Log prüfen, ggf. `ISERV_TEACHER_MARKERS` erweitern |
| `/admin` → 403 | Absender nicht in `ADMIN_IP_ALLOWLIST`, oder `TRUSTED_PROXIES` ≠ NPM-IP (dann zählt die NPM-IP als Client) |
| Seite ohne Styles | CSS-Build fehlt im Image → `docker compose build --no-cache app` |
| Python läuft nicht | `public/components/skulpt` fehlt → Komponenten-Tarball im Bau prüfen (`COMPONENTS_URL`) |
| Editor-Feld bleibt leer, Konsole: `$.widget is not a function` | jQuery UI nicht geladen → `docker compose exec app node scripts/vendor-fetch.js --check`; Pfade in `config/default.yaml` → `components` |
| Image-Bau bricht mit „externe CDN-Verweise“ ab | neuer CDN-Link im Code → Datei in `config/vendor.json` aufnehmen, Verweis auf `/vendor/…` ändern (ADR 0005) |
| `trinket.lernix.site` im Heimnetz „nicht gefunden“ | Pi-hole-Cache (siehe Abschnitt 6) |
| Kein Reiter *Einstellungen → Daten*, kein Kamera-Knopf, kein Profilbild-Upload | Gewollt (Marc 09.10.2026): Alles, was Amazon S3 braucht, ist mit `features.assets: false` abgeschaltet – Export eigener Trinkets, Vorschaubilder, Datei- und Bild-Uploads. Import alter trinket.io-Exporte geht weiter (ohne Bilder) |

## 11. Inbetriebnahme 2026-10-09 – Protokoll

| | |
|---|---|
| Stand | `/opt/trinket`, Branch `main`, `COMPOSE_PROJECT_NAME=trinket`, `APP_PORT=8090`, `APP_BIND=0.0.0.0` |
| DNS | CNAME `trinket` → `lernix.site` (→ dynamische Heim-IP, am 09.10. `217.249.90.124`) |
| NPM | Proxy-Host `trinket.lernix.site` → `http://192.168.1.41:8090`, Let's Encrypt, Force SSL, HSTS |
| IServ-Client | „trinket.lernix.site“, vertrauenswürdig, Scopes `openid profile email iserv:uuid iserv:groups iserv:roles`, beschränkt auf Gruppen/Rollen Lehrer + Schüler |
| Client-IP hinter NPM | aus dem Heimnetz `192.168.1.1` (Hairpin-NAT), `TRUSTED_PROXIES=192.168.1.20` greift |
| `ADMIN_IP_ALLOWLIST` | `*` (Entscheidung Marc) |
| Firewall | keine Änderung, Port 8090 im LAN offen wie die anderen Apps |
| Notfall-Admin | Adresse und Passwort nur in der `.env` (`grep BREAKGLASS /opt/trinket/.env`); keine IServ-Adresse. Nach Änderung `docker compose up -d` – die App legt das Konto beim Start an bzw. setzt das Passwort neu |
| Erster Admin | `marc.hoetten-loens@rsstu.de` (IServ, als Lehrkraft erkannt, per `make-admin`) |
| Anleitung Lehrkräfte | [`schnellanleitung-lehrkraefte.html`](schnellanleitung-lehrkraefte.html), veröffentlicht unter https://pages.lernix.site/p/trinket-lehrkraefte (HTML-Share, Seite 451). Aktualisieren: `python docs/lernix/build_anleitung.py` (bettet `anleitung-bilder/` ein) und `dist/…` als neue Version hochladen, Link bleibt |

Live geprüft: Startseite/Login/Hilfe offen, `/python` → Login, `HEAD /` 200, Schriften unter
`/assets/` ohne Anmeldung, IServ-Login mit Rolle Lehrkraft und 42 IServ-Gruppen in der Session,
`/admin`, Kurs mit IServ-Gruppe `6aIF_06`, Lektion + Aufgabe (leeres Python-Trinket), Python im
Editor (Skulpt), keine Anfragen an fremde Hosts (auch nicht im Editor-iframe), Einbettung eines
vorhandenen Trinkets ohne Anmeldung, Token-Seite (Anlegen, Widerrufen), `/api/v1/me`,
`/api/v1/courses`, `/api/v1/courses/<id>/lernstand` (auch über den NPM), 401 ohne/mit
widerrufenem Token, Wartungs-Probelauf, Backup-Dump im Volume.

Beim Deploy behoben (Commits auf `main`): Login-Rücksprung auf eine Schriftdatei nach dem
IServ-Login, 500er auf `/login` für Angemeldete, Editor ohne jQuery UI, Dropzone-CSS vom CDN.

Offen: Anmeldung mit einem Schülerkonto (Rolle Schüler:in, automatische Aufnahme in den Kurs der
IServ-Gruppe) – es gab kein Test-Konto. Die Admin-Oberfläche (`/admin`) und einige
Editor-Beschriftungen („[Blank Python Trinket]“) sind noch englisch.

### Nachtrag 2026-10-09/10 – Schreib-API, Export, iPad, TurtleCoder

- Live: Schreib-API (ADR 0006), Kurs-Export (`abgaben.zip` / `export.zip`), S3 aus, iPad-Korrekturen,
  Blöcke „schaue nach …“/„setze Stiftdicke auf“. Vor dem Deploy: Sicherung
  `/root/trinket-vor-api-2026-10-09-2323.archive.gz`.
- Lehrkräfte müssen sich nach dem Deploy einmal neu per IServ anmelden, damit die Token-API ihre
  IServ-Gruppen kennt.
- Testinstanz `trinkete2e` (nur `127.0.0.1:8091`, Test-Login) läuft auf der VM; Aufbau und Abbau in
  ENTWICKLUNG.md. Sie berührt Produktion nicht (eigenes Projekt, eigene Volumes, Image-Tag `:e2e`).
- Kurs „TurtleCoder-Reihe Klasse 6 (Blöcke) – Vorlage“ (12 Lektionen, 105 Materialien) per API in Marcs
  Konto importiert; Quelle und Generator: `C:\Coding\TurtleCoder_Reihe	ools	rinket_export.py`,
  Anleitung `TRINKET.md` dort.
- SchulAssistent: Werkzeuge `trinket_*` (Rückmeldung als Entwurf, Senden nur nach Bestätigung);
  Token einmalig mit `python -m apps_konnektor token trinket` hinterlegen.

