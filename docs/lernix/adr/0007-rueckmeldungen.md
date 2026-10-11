# ADR 0007 — Rückmeldungen: gemeinsames Zielbild mit Hamster Lernix

Datum: 2026-10-11
Status: **angenommen** (Entscheidungen Marc, 2026-10-11) – ändert aus ADR 0006 den Punkt „erneutes
Senden bei `completed` ändert die bestehende Rückmeldung“.

## Kontext

Trinket Lernix und Hamster Lernix gaben Rückmeldungen verschieden: hier genau eine, änderbare
Rückmeldung je Abgabe mit Entwurf und Überarbeitung; im Hamster Text nur zusammen mit „Zurückgeben“.
Marc will in beiden Apps regelmäßig Rückmeldungen geben – selbst, durch eine KI über die Token-API,
oder von der KI vorbereitet und von ihm geprüft und ergänzt. Dasselbe Zielbild steht in Hamster
Lernix als ADR 0007.

## Zielbild (gilt für beide Apps)

1. **Eine Rückmeldung** ist ein Markdown-Text mit Autor und Zeitpunkt an einer Abgabe.
2. **Verlauf statt Ändern.** Gesendete Rückmeldungen bleiben stehen; eine Korrektur ist ein neuer
   Eintrag.
3. **„Noch einmal bearbeiten lassen“** ist ein Haken beim Senden. In Trinket ist das
   `allowResubmit`, im Hamster wird die Abgabe `returned`.
4. **Ein Entwurf je Abgabe**, nur für Lehrkräfte sichtbar. Er füllt das Formular vor und wird beim
   Senden gelöscht. Ein leerer Entwurf löscht ihn.
5. **Drei Wege:** Lehrkraft schreibt und sendet · Token sendet direkt · Token legt den Entwurf an,
   die Lehrkraft prüft, ergänzt und sendet.
6. **Herkunft** wird gespeichert und nur Lehrkräften gezeigt: `manual` (in der Oberfläche
   geschrieben), `token` (per Token gesendet), `token_draft` (Entwurf per Token, von der
   Lehrkraft gesendet). SuS sehen nur den Namen der Lehrkraft.
7. **Gleiche Routen und Begriffe:** `POST …/feedback`, `PUT …/feedback-draft`; in der Oberfläche
   „Rückmeldung senden“, „Noch einmal bearbeiten lassen“, „Entwurf“. Feldnamen folgen der
   jeweiligen API (Trinket `allowResubmit`, Hamster `allow_resubmit`).
8. **Übersicht:** Das Dashboard zeigt, wo ein Entwurf wartet.

Bewusst verschieden bleiben: Trinket hat keine automatische Prüfung, deshalb schließt die erste
Rückmeldung eine Abgabe ab (`submitted` → `completed`) und ist nur zu abgegebenen Arbeiten möglich;
verspätete Abgaben werden zuerst angenommen. Die Überarbeitung des Programms durch die Lehrkraft
gibt es nur hier. Der Text darf hier 20 000 Zeichen lang sein, im Hamster 4000.

## Entscheidungen für Trinket

1. **Datenmodell** (ohne Migration, nur zusätzliche Felder im eingebetteten Kommentar):
   `comments[].source` bei `feedback` (`manual` | `token` | `token_draft`; fehlt bei Bestand und
   gilt dann als `manual`), `comments[].viaToken` bei `feedback-draft`.
2. **Senden hängt an** (`lib/services/rueckmeldung.js`): Jede Rückmeldung ist ein eigener Kommentar
   vom Typ `feedback`. Der Entwurf wird dabei entfernt. `submissionOpts` gelten weiter für die
   Abgabe als Ganzes (letzter Stand).
3. **Überarbeitung:** Sie gehört zur jeweiligen Rückmeldung. Ohne neue `revision` verweist die
   neue Rückmeldung auf die bisherige Überarbeitung; eine geänderte wird als neues Trinket
   abgelegt, die alte bleibt unverändert. Oberfläche und SuS-Ansicht zeigen die Überarbeitung der
   letzten Rückmeldung.
4. **Entwurf:** `saveFeedbackDraft` speichert Autor und Zeit; ein leerer Text löscht den Entwurf.
   Ein per Token angelegter Entwurf behält `viaToken`, wenn ihn die Lehrkraft in der Oberfläche
   bearbeitet. Aktualisieren SuS ihre Abgabe, bleiben Entwurf und Rückmeldungen erhalten.
5. **SuS bekommen weder Entwurf noch Herkunft.** Bisher lieferte
   `GET /api/submissions/{materialId}` alle Kommentare einschließlich `feedback-draft` aus; die
   Oberfläche zeigte ihn nur nicht an. Jetzt filtert `rueckmeldung.commentsForStudent` alle
   Antworten an SuS.
6. **Oberfläche:** „Bearbeiten“ einer gesendeten Rückmeldung entfällt, stattdessen „Weitere
   Rückmeldung“. Das Formular beginnt mit dem Entwurf oder leer und speichert den Entwurf in
   beiden Zuständen. Alle Rückmeldungen einer Abgabe werden angezeigt (Lehrkraft mit Herkunft,
   SuS ohne). Das Dashboard der Aufgabe markiert Abgaben mit wartendem Entwurf.
7. **Token-API:** Routen und Eingaben bleiben. Antworten zusätzlich: `feedbackCount` zählt nur
   gesendete Rückmeldungen (vorher alle Kommentare), `hasFeedbackDraft`, `feedback.source`,
   `feedback.history` (alle Rückmeldungen in Reihenfolge), `feedback.draftViaToken`,
   `comments[].source` und `comments[].viaToken`.
8. **Export:** `info.txt` listet alle Rückmeldungen mit Herkunft; Entwürfe werden nicht exportiert.

## Verworfene Alternativen

| Alternative | Warum nicht |
|---|---|
| Ändern beibehalten, im Hamster nachrüsten | Im Lernverlauf wäre nicht mehr sichtbar, was SuS ursprünglich gelesen haben. |
| Herkunft auch SuS zeigen | Marc verantwortet jede gesendete Rückmeldung; die Kennzeichnung dient seiner Kontrolle. |
| Überarbeitung beim erneuten Senden überschreiben | Frühere Rückmeldungen zeigten dann ein Programm, das es beim Senden nicht gab. |
| Eigene Sammlung für Rückmeldungen | Die eingebetteten Kommentare reichen; Dashboard und Export lesen sie schon. |

## Konsequenzen

- Der SchulAssistent kann beide Apps mit denselben zwei Routen ansprechen. Wer bisher mit erneutem
  Senden eine Rückmeldung korrigiert hat, erzeugt jetzt eine weitere.
- Neue Abhängigkeiten: keine. Bestehende Daten bleiben gültig.
- Tests: `test/lib/api/apiv1-write.js` (Verlauf, Entwurf, Herkunft, Sicht der SuS),
  `test/lib/api/kursexport.js` (Herkunft in `info.txt`). Die Oberfläche ist noch in der
  Testinstanz zu prüfen.
