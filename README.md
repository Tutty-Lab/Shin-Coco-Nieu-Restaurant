# Dienstplan & Stundenzettel — Shin, Coco & Nieu 37

Eine App für drei Restaurants desselben Betreibers in Baden-Württemberg. Die
Oberfläche ist auf Vietnamesisch. Es gibt KEIN Umschalten zwischen den Filialen:
jeder Tab zeigt alle Läden untereinander, jeder mit eigener Überschrift. Monat
und Jahr stehen oben in der Kopfzeile und gelten für alle. Jede Filiale hat
eigene Mitarbeiter, eigene Pläne, ein eigenes Passwort und eine eigene Zeile in
Supabase; „Tạo lịch làm việc" erzeugt alle Pläne, und die Bảng chấm công gibt
EINE PDF mit den Seiten aller Läden aus.

| Filiale | `store_id` | Anschrift | Starke Tage |
|---|---|---|---|
| Shin Restaurant | `shin` | Hans-Thoma-Str. 2, 76448 Durmersheim | Do–So |
| Coco Restaurant | `coco` | Bernhäuser Hauptstraße 17, 70794 Filderstadt | Do–So |
| Nieu 37 Restaurant | `nieu` | Radgasse 9, 73430 Aalen | Fr–So |

## Öffnungszeiten (für alle gleich)

- **Montag Ruhetag**, auch an einem Feiertag. Nur eine Datumsausnahme mit
  eigenen Zeiten öffnet den Tag.
- **Dienstag–Sonntag und Feiertage:** 11:30–15:00 und 17:00–22:00. Die Zeit
  dazwischen ist **geschlossen** – keine bezahlte Pause, sondern zu.
- Feiertage nach **Baden-Württemberg** (`src/lib/holidays.ts`).

## Vorgaben des Betriebs

- **Immer jemand bis 15:00 und bis 22:00 im Dienst** – zwei harte Regeln in
  jeder Filiale (`Chốt ca trưa`, `Đóng cửa`).
- **Eine Schicht besetzt etwa 4–5 Leute.** Shin/Coco: mittags 3–7, abends 4–7.
  Nieu 37 hat ein kleineres Team und schwächere Umsätze: mittags 2–6, abends 3–6.
- **Starke Tage** tragen das 1,5-fache Gewicht: Shin und Coco ab Donnerstag,
  Nieu 37 erst ab Freitag. Feiertage zählen wie Sonntag.
- **Schichtlängen 3–8 Stunden**, höchstens **8 bezahlte Stunden am Tag** und
  höchstens 6 Tage am Stück. Alle Zeiten liegen auf dem 30-Minuten-Raster.
- **Shin: an Feiertagen ist Bá Việt Nguyen im Dienst** (`requiredOnHolidays`).
- **Zwei Jobs, eine Person:** Bá Việt Nguyen arbeitet Vollzeit im Shin und als
  Minijob im Nieu 37 (`personKey`). Die Läden werden nacheinander geplant; an
  einem Tag, an dem er schon im Shin steht, plant Nieu ihn nicht ein – die Orte
  liegen zu weit auseinander. Damit überhaupt Tage frei bleiben, ist er im Shin
  auf 5 Tage je Woche begrenzt.
- **Wer in mehreren Läden arbeitet, wird im Tab „Nhân viên" verbunden:** unter
  „Nâng cao" → „Cũng làm ở quán khác" je anderem Laden die Person wählen
  (`src/lib/sharedPerson.ts`). Beide bekommen denselben `personKey`; „không"
  löst die Verbindung auf beiden Seiten.
- **Nieu 37 hat montags geöffnet** (Einstellung im Laden, `closedWeekdays`).

## Belegschaft (Angabe des Betriebs, Stunden je MONAT)

**Shin:** Ba Viet Nguyen 169 (Feiertagsdienst, zweiter Job im Nieu), Quoc Tu
Tran 173, Quoc Minh Tran 169, Van Dang Tran 160, Tuyet Trinh Tran 180, Ba Nhat
Nguyen 86, Nhu Manh Cao 169, Minh Vuong Vu 40,2 (603 h ÷ 15 Monate).

**Coco:** Nguyen Thu Van 173, Nguyen Thi Minh Tam 173, Duy Phuong Do 173, Dinh
Trong Huy 156, Ba Anh Nguyen 130, Viet Trung Nguyen 152, Thi Huong Nguyen 39,
Viet An Bui 43.

**Nieu 37:** Cong Danh Bui 151,8, Ngoc So Nguyen 169, Van Hai Nguyen 130, Ba Nam
Nguyen 169, Xuan Linh Trinh 169, Ba Viet Nguyen 35 (Minijob, siehe oben).

Die Verträge laufen über **Monatsstunden**; im Tab „Nhân viên" lässt sich je
Person zwischen Monats- und Wochenvertrag umschalten.

## Planung

`src/lib/weeklyScheduler.ts` verteilt das Monats-Soll auf die ISO-Wochen, dann
auf die Tage (Tagesgewicht × Öffnungsdauer) und sucht je Woche die Kombination
aus Arbeitstagen und Schichtlängen, die das Soll exakt trifft und der
Nachfragekurve am nächsten kommt. Tagesgewichte, Besetzungsregeln und die schon
belegten Tage kommen je Filiale aus `src/lib/stores.ts`. Danach:

- **Feiertagsdienst** wird vor allem anderen gehalten.
- **Nachschlag (`topUpShortfalls`)**: Reste aus der 30-Minuten-Rundung hängen
  sich an den Dienst, der der Besetzung am wenigsten schadet.
- Ein Wochenrest unter 3 h wandert in die Nachbarwoche, statt einen
  1–2-Stunden-Dienst zu erzeugen.
- **Feinschliff je Tag**: Lage der Dienste und der Pausen nach der echten
  Besetzung.

## PDF

Stundenzettel und Dienstplan werden als **Vektor-PDF** gezeichnet (jsPDF, Text
und Linien) – kein html2canvas, kein Screenshot. Eine A4-Seite je Mitarbeiter,
identisch auf jedem Gerät, wenige Kilobyte je Seite.

## Entwicklung

```bash
npm install
npm run dev
npm run test
npm run build
```

Persistenz über LocalStorage (Schlüssel je Filiale) und optional Supabase
(`store_data`, eine Zeile je `store_id`), konfiguriert mit `VITE_SUPABASE_URL`
und `VITE_SUPABASE_ANON_KEY`. `VITE_STORE_ID_PREFIX` (z. B. `test-`) lenkt lokal
auf Testzeilen um. Die Passwortsperre im Client ersetzt keine Zugriffskontrolle.
