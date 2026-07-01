# PixelEuro — Umbau auf Million-Dollar-Homepage-Modell (Block-Platzierung)

**Datum:** 2026-07-01
**Status:** Design – zur Freigabe

---

## 1. Ziel in einem Satz

Die Seite wird zur **einen sichtbaren Wand** (500×250 = 125.000 Pixel): Der Kunde lädt sein
Bild hoch, **zieht es frei** an die gewünschte Stelle, es rastet aufs Raster, belegte Pixel
blockieren (kein Überlappen), dann kauft er den **ganzen Rechteck-Block** — echtes
Million-Dollar-Homepage-Modell. Jeder Kauf erzeugt einen **teilbaren Permalink + Share-Card**,
damit Käufer selbst zu Werbeträgern werden.

## 2. Warum (Kontext)

Der Hype des Originals (MDH, 2005) lebte von: presse-tauglicher Story, sichtbarer Knappheit
und **Käufern, die freiwillig teilen**. Das aktuelle Produkt ist ein r/place-artiges
*Mal-Werkzeug* in einem kleinen Fenster — das trifft weder das „ganze Seite = Wand"-Gefühl
noch den Verstärker-Loop. Dieser Umbau richtet das Produkt auf die drei steuerbaren Hype-Hebel
aus (siehe `CONCEPT.md` §5).

## 3. Entscheidungen (bereits bestätigt)

1. **Modell:** echtes MDH-Block-Modell (Bild hochladen → frei platzieren → kaufen).
2. **Darstellung:** ganze Seite = die Wand; Standardansicht zeigt die **komplette** Wand
   („fit-to-width"), Zoom/Pan nur zum Reinschauen/Feinplatzieren.
3. **Mal-Werkzeug:** **entfällt komplett** (Palette, Pinsel, Radierer, Undo, Fadenkreuz,
   Mal-Gesten).
4. **Abrechnung:** der **ganze rechteckige Block** (`w×h`) wird gekauft & bezahlt; transparente
   Bildstellen werden mit **Weiß** gefüllt (sauberer Block).
5. **Verstärker-Features:** Permalink + Deep-Zoom zum eigenen Block, Share-Card nach Kauf.
6. **Größe ändern:** per **Slider** (nutzt vorhandene Logik; Zieh-Ecken sind späteres Upgrade).

## 4. Umsetzungs-Ansatz

**Interaktions-Schicht von `public/app.js` neu bauen, bewährten Rest behalten.** Erhalten
bleiben: Canvas-Rendering (Pixel-für-Pixel), Koordinaten-Transformation, Zoom/Pan, `loadAds()`
und die komplette Bestell-/Stripe-Pipeline. Ersetzt wird nur der Mal-first-Teil durch **ein frei
ziehbares Bild-Block-Placement** mit Live-Overlap-Check. Layout in `index.html` + `style.css`
so umbauen, dass die Wand die Seite füllt.

Verworfen: Framework-Rewrite (Over-Engineering/YAGNI); DOM-Bilder statt Canvas (skaliert nicht
auf 125.000 Zellen).

## 5. Design im Detail

### 5.1 Darstellung — „ganze Seite = Wand"
- Wand-Seitenverhältnis 2:1 füllt die volle Breite des Wand-Bereichs; Standard-Zoom =
  **ganze Wand sichtbar**.
- Zoom/Pan (Pinch, Scroll, +/−) bleibt zum genauen Reinschauen und präzisen Platzieren am Handy.
- Palette/Mal-Toolbar verschwindet; die Toolbar zeigt nur noch: Bild hochladen, Größen-Slider,
  Zoom, „Kaufen".

### 5.2 Kern-Ablauf des Kunden
1. **Bild hochladen** → erscheint als schwebender rechteckiger **Block** auf der Wand
   (client-seitig aufs Pixelraster heruntergerechnet, Seitenverhältnis erhalten).
2. **Frei ziehen** → beim Loslassen rastet der Block aufs Raster (ganzzahlige Zellkoordinaten).
3. **Größe** per Slider skalieren (Seitenverhältnis gesperrt; Grenzen: min sinnvoll lesbar,
   max = Wandgröße).
4. Der **ganze Rechteck-Bereich** wird gekauft; transparente Stellen → Weiß.
5. **Overlap-Feedback:** liegt der Block ganz/teilweise auf belegten Zellen, leuchten diese
   **rot**, „Kaufen" ist gesperrt bis der Block frei liegt.
6. **Kauf** → bestehende Pipeline: Bounding-Box (= Rechteck), alle Zellen, gerastertes PNG → Stripe.

### 5.3 Kein-Überlappung (bleibt hart, zwei Ebenen)
- **Client:** Live-Prüfung gegen `occMask` beim Ziehen — neue Funktion `rectFree(gx,gy,w,h)`;
  rote Markierung + Kauf-Sperre.
- **DB:** `pixels.PRIMARY KEY(x,y)` verhindert Doppelverkauf endgültig bei Race-Bedingungen
  (unverändert).

### 5.4 Verstärker-Features (Käufer als Werbeträger)
- **Permalink + Deep-Zoom:** URL-Schema `/?ad=<id>`. Beim Laden liest `app.js` den Parameter,
  zoomt/zentriert auf den Block und hebt ihn kurz hervor („dein Fleck").
- **Share-Card nach Kauf:** Erfolgs-Overlay (Confetti bleibt) zeigt Block-Vorschau + Text
  „Ich bin auf der Wand 🟦 — Pixel-Position X,Y / 125.000" und Buttons: **Teilen** (Web-Share
  API / Clipboard-Fallback) mit dem Permalink, sowie „Zur Wand".
- **Live-Zähler/Meilensteine:** verkauft/frei + Fortschrittsbalken bleiben (bereits vorhanden);
  keine neue Backend-Arbeit nötig.

### 5.5 Server (`src/server.js`)
Fast unverändert — `/api/orders` erhält bereits `x,y,w,h,cells,image`. Anpassungen:
- Preis/`pixel_count` = **volles `w×h`** (ganzes Rechteck), `cells` = alle Rechteck-Zellen.
- Min-Bestellwert bleibt per Env (`MIN_ORDER_CENTS`, aktuell 10 €). Optionaler echter
  Mindest-Block (z. B. 10×10 = 100 €) = reine Env-Änderung, kein Code.
- `/api/ads` liefert weiterhin Bounding-Boxen inkl. `id` → Grundlage für den Permalink.

### 5.6 Datenschutz (DSGVO)
- **Datensparsam:** nur das **heruntergerechnete Pixel-PNG** wird hochgeladen, nie das Original.
- **Speicherung in der DB als `BYTEA`** (kein Dateisystem, kein `localStorage`).
- Hinweis: Upload-Bilder können personenbezogene Daten enthalten (z. B. Gesichter) → bewusst
  minimal halten; **keine E-Mails/personenbezogenen Daten in Logs oder Share-Texten**. Der
  Share-Text nennt nur Position + Gesamtzahl, keine Käuferdaten.

## 6. Was wegfällt
`PALETTE`, `painted`-Mal-Map, Pinsel/Radierer/Undo, Mal-Gesten, Fadenkreuz-`brush`, Farbwähler,
zugehörige Toolbar-Buttons und CSS. Der `imgSize`-Slider und die Rasterungs-/Bestell-Logik
bleiben (angepasst auf Voll-Rechteck).

## 7. Isolierte, testbare Einheiten
- `screenToCell` / Koordinaten-Transform (unverändert).
- `rectFree(gx,gy,w,h)` — Overlap-Check gegen `occMask` (rein, gut testbar).
- Block-Rasterung (Bild → w×h Zellen, transparent → Weiß).
- Bestell-Payload (Bounding-Box + Zellen).
- Permalink-Parser (`?ad=` → Ziel-Block/Zoom).

## 8. Offene / spätere Punkte (nicht in diesem Umbau)
- Zieh-Ecken statt Slider (Upgrade).
- Serverseitige OG-Image-Generierung für schönere Link-Vorschauen (Stretch; erst mal
  Client-Share-Text/Permalink).
- Mindest-Block-Größe als Produktentscheidung (per Env lösbar).

## 9. Explizit außerhalb dieses Specs (separater Deliverable)
Story-Hook & **Pressemitteilung** (Strategie A) sowie Posting-Kadenz sind **Content, kein Code** —
werden getrennt entworfen, nachdem die Spec steht.
