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
| Admin-Bereich `/admin` | nur aus `ADMIN_IP_ALLOWLIST` (Default `192.168.1.0/24`) |
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
| `ADMIN_IP_ALLOWLIST` | `192.168.1.0/24` – Heimnetz; für Zugriff aus der Schule die öffentliche Schul-IP ergänzen |
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
DNS: A-Record `trinket` → `93.205.103.135` wie die anderen lernix-Subdomains.

Den App-Port nur für den NPM öffnen:

```bash
ufw allow from 192.168.1.20 to any port 8090 proto tcp
ufw deny 8090/tcp
```

## 5. Erster Admin

1. Marc meldet sich einmal über IServ an (bekommt Rolle Lehrkraft).
2. Auf der VM: `docker compose exec app npm run make-admin <marcs-iserv-mail>` – oder als
   Notfall-Admin unter `/admin` die Rolle vergeben.
3. Ab dann verwaltet Marc alles über IServ; der Notfall-Admin bleibt für Notfälle (nur aus
   `ADMIN_IP_ALLOWLIST`, Link „Notfallzugang“ auf der Login-Seite).

## 6. Prüfen

- `https://trinket.lernix.site/healthz` → `ok`
- `https://trinket.lernix.site/` zeigt „Mit IServ anmelden“; Anmeldung als Lehrkraft und als
  Schüler:in testen (Rolle unter `/admin` sichtbar).
- Ohne Anmeldung ist `/python` nicht erreichbar (Umleitung zum Login), eine Einbettung
  `/embed/python/<id>` eines vorhandenen Trinkets schon.
- `/admin` von außerhalb der Allowlist → 403.
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
