# Urlaubsplaner 5.9 – Mein Reiseassistent

Neu in 5.9:
- „Mach meinen Tag“: lokale Tagesideen aus Reise, POI-Merkliste und Reisegeschmack
- „Plan B“: Alternativen bei schlechtem Wetter, zu langen Fahrtagen oder Ausfällen, ohne Plan A automatisch zu überschreiben
- Persönlicher Reisegeschmack mit Gewichtung für Natur, Aussicht, Geschichte, Museen, Kunst, Architektur, Altstädte und Stellplätze
- POIs können nach dem persönlichen Profil sortiert werden
- Das Profil liegt in den bestehenden Zusatzdaten und wird mit der normalen Cloud-Sicherung mitgenommen

Alle Funktionen aus 5.8 bleiben erhalten.

# Urlaubsplaner 5.1 – Gemeinsame Reisen

Zusätzlich zu Benutzerkonto und Cloud-Sicherung aus 5.0 können Reisen jetzt geteilt werden.

## Rollen
- Besitzer: Reise veröffentlichen, bearbeiten und Personen einladen
- Bearbeiten: gemeinsame Reise ansehen und Änderungen zurück in die Cloud speichern
- Nur ansehen: gemeinsame Reise laden, aber nicht in der Cloud verändern

## Einrichtung
1. Supabase-Projekt erstellen.
2. Die vollständige `supabase_schema.sql` im SQL Editor ausführen.
3. Servervariablen setzen:
   SUPABASE_URL
   SUPABASE_PUBLISHABLE_KEY
   OPENAI_API_KEY
4. npm install
5. npm start

## Teilen
Beide Personen benötigen zunächst ein Urlaubsplaner-Konto.
Der Besitzer veröffentlicht seine aktuelle Reise. Danach wird die Cloud-Reise-ID angezeigt.
E-Mail der zweiten Person eingeben, Rolle auswählen und einladen.
Die eingeladene Person meldet sich an und wählt „Gemeinsame Reisen laden“.

## Sicherheit
Row Level Security schützt die Tabellen.
Die Einladungsfunktion prüft serverseitig in Supabase, ob der Aufrufer Besitzer der Reise ist.
Editoren dürfen aktualisieren, Viewer nur lesen.
Der Supabase Secret-/Service-Role-Key wird nicht im Browser verwendet.


## Version 5.8
- Tagesplanung mit Plausibilitätscheck für Etappen, Kilometer, Ruhetage und Übernachtungen
- Etappen können optional ab dem Reise-Startdatum fortlaufend datiert werden
- erweitertes Reise-Cockpit
- feste mobile Schnellnavigation (Übersicht, Reisen, Route, KI, Kosten)
- verständlicher Hinweis bei fehlendem OpenAI-API-Guthaben statt technischer 429-Meldung
- bestehende 5.3-Daten-, Cloud- und Freigabefunktionen bleiben kompatibel
