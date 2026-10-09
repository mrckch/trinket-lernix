# Trinket Lernix im Nginx Proxy Manager einrichten

Der NPM terminiert TLS; die App läuft dahinter ohne TLS auf der Docker-VM (ADR 0002 in LeFo,
gleiches Muster).

## 1. Proxy Host anlegen

| Feld | Wert |
|---|---|
| Domain Names | `trinket.lernix.site` |
| Scheme | `http` |
| Forward Hostname / IP | `192.168.1.41` (Docker-VM) |
| Forward Port | `8090` (`APP_PORT` aus der `.env`) |
| Block Common Exploits | an |
| Websockets Support | aus (nicht nötig, Skulpt läuft im Browser) |

Reiter **SSL**: Let's Encrypt, **Force SSL** an, **HTTP/2** an, HSTS an (Let's-Encrypt-Zertifikat
ist überall vertrauenswürdig).

## 2. Admin-Bereich zusätzlich absichern

Optional, nur wenn `ADMIN_IP_ALLOWLIST` ein Netz einschränkt (im Betrieb ist sie `*`, dann
diesen Schritt weglassen): Inhalt von [`advanced.conf`](advanced.conf) in den Reiter **Advanced**
kopieren und die `allow`-Zeilen anpassen. Maßgeblich bleibt die App; der NPM weist nur früher ab.
Achtung: Clients aus dem Heimnetz kommen per Hairpin-NAT mit der Router-Adresse `192.168.1.1` an.

## 3. `.env` auf der Docker-VM

- `TRUSTED_PROXIES=192.168.1.20` – nur von dort übernimmt die App `X-Forwarded-For`.
- `ADMIN_IP_ALLOWLIST` – Verwaltungsnetz (CIDR, kommagetrennt).
- `PUBLIC_BASE_URL=https://trinket.lernix.site` – muss zum Proxy Host und zur IServ-Redirect-URI passen.

## 4. DNS und Port

- Namecheap: **CNAME** Host `trinket` → `lernix.site.` (Host-Feld ist relativ). Erst wenn der Name
  auflöst, das Zertifikat anfordern.
- Port 8090: Auf dockervm2 gibt es kein `ufw`, Docker-Ports umgehen es ohnehin. Entschieden
  (2026-10-09): Port bleibt im Heimnetz offen wie bei den anderen Apps. Variante „nur NPM“ siehe
  BETRIEB.md Abschnitt 4 (`DOCKER-USER`-Regel).

## 5. Prüfen

- `https://trinket.lernix.site/healthz` liefert `ok`.
- `https://trinket.lernix.site/admin` von außerhalb des Verwaltungsnetzes → 403.
- Einbettungen (`/embed/python/<id>`) laden auch ohne Anmeldung, z. B. in einer IServ-Seite.
