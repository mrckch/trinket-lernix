# ADR 0002 — Anmeldung über IServ, Rollen Schüler/Lehrkraft/Admin, Notfall-Admin

Datum: 2026-10-09
Status: **angenommen** (Entscheidungen Marc, 2026-10-09)

## Kontext

Alle Schülerinnen, Schüler und Lehrkräfte haben ein IServ-Konto (`https://rsstu.de`).
Trinket Lernix soll keine zweiten Zugangsdaten einführen. Mehrere Schul-Apps
(HTML_Share, Learning-Apps, LeFo, Glossar) binden IServ bereits per OIDC an; die
Anbindung aus Learning-Apps meldet wie hier Lehrkräfte **und** SuS an.

trinket-oss bringt lokalen Login, Selbstregistrierung und Google-OAuth mit sowie ein
Rollen-Plugin mit Abo-Laufzeiten (`thru`, `limits`) und einer Rolle `user`, die alles darf.

## Entscheidung

### Anmeldewege (`AUTH_MODE`)

| Wert | Verhalten |
|---|---|
| `iserv` | Produktion. SuS und Lehrkräfte ausschließlich per IServ-OIDC. Lokal nur der Notfall-Admin, und der nur aus `ADMIN_IP_ALLOWLIST`. `/signup` und `POST /users` leiten auf `/login` um. Google entfällt. |
| `dev` | Nur Entwicklung und Tests. Zusätzlich Test-Login `/auth/dev` (E-Mail, Name, Rolle) und die alte Registrierung. Der Entrypoint verweigert `dev` mit `NODE_ENV=production`. |

### Eigener IServ-Client, Protokoll wie in den Schwester-Apps

- Eigener OAuth2/OIDC-Client „Trinket“ in IServ, Redirect-URI
  `<PUBLIC_BASE_URL>/auth/iserv/callback`, Scopes
  `openid profile email iserv:uuid iserv:groups iserv:roles`.
- Bibliothek `openid-client` 5 (CommonJS): Discovery, PKCE (S256), `state` in der
  Session, Prüfung des `id_token` gegen JWKS, UserInfo-Abfrage für Rollen/Gruppen,
  Client-Zugangsdaten im Body (`client_secret_post`, wie in den Python-Anbindungen).
- Claim-Aliase `groups` / `iserv:groups` / `iserv_groups` (entsprechend `roles`, `uuid`).
- Stabile Kennung ist `iserv:uuid` (Feld `user.iserv.uuid`, sparse-Index), Rückfall `sub`.
- Die Redirect-URI entsteht aus `PUBLIC_BASE_URL`, nie aus dem `Host`-Header.

### Rollen

| Site-Rolle | Woher | Rechte |
|---|---|---|
| `student` | IServ, kein Lehrkraft-Marker (Default) | Python-, HTML-, Blocks-, GlowScript-Trinkets; Kursen beitreten; Aufgaben bearbeiten |
| `teacher` | IServ, Marker (`ISERV_TEACHER_MARKERS`, Default `lehrer,teacher,kollegium`) in Rollen **oder** Gruppen | zusätzlich Kurse anlegen, Aufgaben, Dashboard, Tests, Inline-Kommentare |
| `admin` | nur in der App vergeben, nie aus IServ | zusätzlich `/admin`; geprüft per `hasRole('admin')` |

- Die Grundrolle wird bei **jedem** Login neu gesetzt (Wechsel in IServ greift sofort),
  `admin` bleibt erhalten. Kursrollen bleiben unberührt.
- Der Site-Kontext wird dabei komplett neu geschrieben (`accounts.setSiteRoles`),
  statt `grant`/`revoke` des Plugins zu nutzen: Die sind auf Abo-Laufzeiten ausgelegt und
  entfernen bei fehlenden Rechten falsche Einträge (`splice(-1)`).
- Altbestand: `user` und die trinket.io-Abo-Rollen bleiben als Alias der Lehrkraft gültig.
- IServ-Gruppen werden **nicht** gespeichert, nur für die Dauer der Session gehalten
  (`iservGroups`), damit Phase 2 Kurse zuordnen kann.

### Notfall-Admin (Break-Glass)

- `BREAKGLASS_EMAIL` + `BREAKGLASS_PASSWORD` in der `.env`; beim Start wird das Konto angelegt
  oder aktualisiert (`source: breakglass`, Rollen `admin` + `teacher`). Ohne beide Werte gibt es
  kein lokales Konto.
- Anmeldung über das normale Login-Formular (hinter „Notfallzugang“), nur im IServ-Modus für
  dieses eine Konto, nur aus `ADMIN_IP_ALLOWLIST`.

### Admin-Bereich und Proxy-Bewusstsein

- `onPreAuth`-Erweiterung: `/admin`, `/api/admin` liefern `403` außerhalb von
  `ADMIN_IP_ALLOWLIST` (fail closed, Default `127.0.0.1/32`). Die App ist maßgeblich, ein
  `allow/deny` im NPM nur zusätzlich (LeFo ADR 0002).
- `X-Forwarded-For` wird nur übernommen, wenn der direkte Absender in `TRUSTED_PROXIES`
  steht (`lib/util/clientIp.js`).

## Abweichungen von den Standards

| Standard | Vorgabe | Trinket Lernix |
|---|---|---|
| 14.10 | kein externer Identity-Provider | IServ ist der schuleigene Server, kein Cloud-Dienst; Notfallzugang bleibt |
| 2.1 | Frontend nur über JSON-API | `/auth/iserv/*` arbeitet mit Weiterleitungen, weil OIDC aus Top-Level-Navigationen besteht |

## Konsequenzen

- Vor dem Go-live legt die IServ-Administration den SSO-Client an (Redirect-URI aus
  `PUBLIC_BASE_URL`); `iserv:uuid` muss von Anfang an freigegeben sein, sonst ändern sich
  später alle Kennungen.
- Bestehende Konten (Dev, Import) werden beim ersten IServ-Login über die E-Mail
  einmalig verknüpft.
- Mail bleibt aus (Entscheidung Marc): keine Einladungs- oder Reset-Mails; Kurse werden
  über IServ-Gruppen (Phase 2) oder Access-Codes befüllt.
- Tests: `test/lib/api/auth.js` (Dev-Login, Sperren im IServ-Modus, Notfall-Admin,
  Admin-Allowlist), `test/lib/util/iserv.js` (Claim-Auswertung, CIDR-Prüfung).
