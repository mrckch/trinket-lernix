# ADR 0001 — Konfiguration per `.env`, kein Einrichtungsassistent

Datum: 2026-10-09
Status: **angenommen** (Entscheidung Marc, 2026-10-09)

## Kontext

Standard 3 der Homelab-Standards (`C:\Coding\ADR-homelab-Apps\STANDARDS\03-setup-wizard.md`)
verlangt einen Einrichtungsassistenten in der Oberfläche. Trinket Lernix ist aber
kein Neubau, sondern ein Fork von `trinketapp/trinket-oss` mit eigener
Konfigurationsschicht: Die App liest ausschließlich YAML-Dateien über
`node-config` 0.4, das keine Umgebungsvariablen kennt. Ein Assistent müsste
diese Schicht ersetzen und zusätzlich einen Speicherort für Einstellungen in
MongoDB einführen – für eine App mit genau einer Installation unverhältnismäßig.

## Entscheidung

- Alle Einstellungen stehen in der `.env` (Vorlage `.env.example`, jede Variable
  kommentiert). Keine Secrets im Repo.
- `docker/entrypoint.sh` erzeugt beim Containerstart `config/local.yaml` aus den
  Umgebungsvariablen und bricht mit verständlicher Meldung ab, wenn Pflichtwerte
  fehlen oder unsicher sind (Session-Secret zu kurz, `AUTH_MODE=dev` in
  Produktion, `PUBLIC_BASE_URL` ohne `https`).
- Die bestehende Seite `/admin` bleibt für die laufende Verwaltung
  (Nutzer, Rollen). Hostname, IServ-Client und Secrets werden dort **nicht**
  bearbeitet.
- Die Redirect-URI für IServ wird aus `PUBLIC_BASE_URL` gebildet, nie aus dem
  `Host`-Header.

## Abweichung vom Standard

| Standard | Vorgabe | Trinket Lernix |
|---|---|---|
| 3 | Einrichtungsassistent in der UI | `.env` + Entrypoint-Prüfungen; Anleitung in `docs/lernix/BETRIEB.md` |

## Konsequenzen

- Eine Änderung von Adresse oder IServ-Zugangsdaten braucht `docker compose up -d`
  nach dem Bearbeiten der `.env`.
- `config/local.yaml` ist gitignored und wird bei jedem Start überschrieben;
  manuelle Änderungen darin gehen verloren.
- Upstream-Updates von `trinket-oss` bleiben leicht einzuspielen, weil die
  YAML-Konfiguration unangetastet bleibt.
