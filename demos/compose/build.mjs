// ============================================================
//  Compose — baut die 9:16-HyperFrames-Komposition (index.html):
//  schwebendes Browser-Fenster mit der Capture, Kamera-Zooms pro
//  Beat (origin-basiert, geclamped — KEIN translate), kinetische
//  Untertitel, Callouts, Intro/Outro, optional VO + Musik.
//  Deterministisch & re-render-bar.
// ============================================================
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const W = 1080, H = 1920;
const INTRO = 1.2;   // kurzer, knackiger Hook statt langem Logo-Intro
const OUTRO = 2.0;

// Brand-Tokens (Quelle: compose/design.md / public/style.css)
const C = {
  ink: '#122530', brand1: '#14c2da', brand2: '#2f6bff',
  accent: '#0e93a8', ok: '#16a34a', gold: '#FFCB3A', pink: '#d4537e',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * buildComposition({ lang, flow })
 *  - liest out/<flow>/action-timeline.json, features/<flow>.json
 *  - optional: tts/cache/<flow>-<lang>.json  (VO-Manifest: [{label,file,dur}])
 *  - schreibt out/<flow>/comp-<lang>/index.html (+ kopiert capture.mp4, VO)
 */
export async function buildComposition({ lang = 'de', flow = 'buy' } = {}) {
  const outDir = join(ROOT, 'out', flow);
  const timeline = JSON.parse(await fs.readFile(join(outDir, 'action-timeline.json'), 'utf8'));
  const feature = JSON.parse(await fs.readFile(join(ROOT, 'features', `${flow}.json`), 'utf8'));

  // Optionales VO-Manifest
  let vo = null;
  const voPath = join(ROOT, 'tts', 'cache', `${flow}-${lang}.json`);
  try { vo = JSON.parse(await fs.readFile(voPath, 'utf8')); } catch { vo = null; }
  const voByLabel = {};
  if (vo) for (const v of vo) voByLabel[v.label] = v;

  // Beats aus Capture-Timeline mit Inhalt aus features anreichern
  const featByLabel = {};
  for (const b of feature.beats) featByLabel[b.label] = b;

  const captureDur = timeline.duration;
  const compDir = join(outDir, `comp-${lang}`);
  await fs.mkdir(compDir, { recursive: true });

  // capture.mp4 in den Comp-Ordner kopieren (relative src für deterministischen Render)
  await fs.copyFile(join(outDir, 'capture.mp4'), join(compDir, 'capture.mp4'));

  // VO-Dateien kopieren (falls vorhanden)
  if (vo) {
    for (const v of vo) {
      await fs.copyFile(join(ROOT, 'tts', 'cache', v.file), join(compDir, v.file)).catch(() => {});
    }
  }

  // --- Beat-Zeiten in Kompositionszeit ---
  const beats = timeline.beats.map((b, i) => {
    const next = timeline.beats[i + 1];
    const compStart = +(INTRO + b.t).toFixed(3);
    const visualGap = (next ? next.t : captureDur) - b.t;
    const voDur = voByLabel[b.label]?.dur || null;
    return {
      ...b,
      compStart,
      visualGap,
      voDur,
      feat: featByLabel[b.label] || {},
      voFile: voByLabel[b.label]?.file || null,
    };
  });

  const stageStart = INTRO;
  const stageEnd = +(INTRO + captureDur).toFixed(3);
  const outroStart = stageEnd;
  const total = +(stageEnd + OUTRO).toFixed(3);

  // Hochformat-Capture (Mobil) -> Phone-Screen quasi voll im 9:16-Frame.
  // Querformat-Capture (Desktop) -> schwebendes Browser-Fenster.
  const portrait = timeline.cssHeight > timeline.cssWidth;
  let CARD_W, CARD_X, CHROME, VIDEO_W, VIDEO_H, CARD_H, CARD_Y;
  if (portrait) {
    CARD_W = W; CARD_X = 0; CHROME = 0;
    VIDEO_W = W; VIDEO_H = H; CARD_H = H; CARD_Y = 0;
  } else {
    CARD_W = 1004; CARD_X = (W - CARD_W) / 2; CHROME = 56;
    VIDEO_W = CARD_W;
    VIDEO_H = Math.round(VIDEO_W * (timeline.cssHeight / timeline.cssWidth)); // 16:10
    CARD_H = VIDEO_H + CHROME;
    CARD_Y = 470; // obere-Mitte; Untertitel darunter
  }

  // --- HTML zusammensetzen ---
  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${W}px; height: ${H}px; background: #03101a; overflow: hidden;
    font-family: "Inter", system-ui, sans-serif; }
  #root { position: relative; width: ${W}px; height: ${H}px; }

  /* Bühnen-Hintergrund */
  .bg { position: absolute; inset: 0;
    background: radial-gradient(120% 80% at 50% 0%, #0b3a52 0%, #061826 58%, #03101a 100%); }
  .bg-pixel { position: absolute; width: 26px; height: 26px; border-radius: 6px; opacity: .14; }
  .vignette { position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(130% 100% at 50% 42%, rgba(0,0,0,0) 52%, rgba(0,0,0,.55) 100%); }
  .grain { position: absolute; inset: 0; pointer-events: none; opacity: .06; mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml;utf8,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/></filter><rect width="160" height="160" filter="url(%23n)"/></svg>'
    )}"); }

  /* Kopf-Brand */
  .brandbar { position: absolute; top: 96px; left: 0; right: 0; text-align: center;
    color: #fff; font-weight: 800; font-size: 40px; letter-spacing: -.02em; opacity: 0; z-index: 20; }
  .brandbar .dot { color: ${C.brand1}; }

  /* Browser-Fenster */
  .stage { position: absolute; left: ${CARD_X}px; top: ${CARD_Y}px; width: ${CARD_W}px;
    height: ${CARD_H}px; opacity: 0; will-change: transform; z-index: 10; }
  .card { width: 100%; height: 100%; border-radius: ${portrait ? 0 : 22}px; overflow: hidden;
    background: #fff; box-shadow: ${portrait ? 'none' : '0 40px 120px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.06)'}; }
  .chrome { height: ${CHROME}px; background: #eef3f5; display: flex; align-items: center;
    padding: 0 20px; gap: 9px; border-bottom: 1px solid #dde6ea; }
  .tl { width: 15px; height: 15px; border-radius: 50%; }
  .urlbar { margin-left: 16px; flex: 1; height: 32px; background: #fff; border-radius: 8px;
    border: 1px solid #dde6ea; display: flex; align-items: center; padding: 0 14px;
    color: #5b6b75; font-size: 19px; font-weight: 600; }
  .urlbar b { color: ${C.ink}; }
  .viewport { width: 100%; height: ${VIDEO_H}px; overflow: hidden; }
  #cap { display: block; width: 100%; height: ${VIDEO_H}px; object-fit: cover; object-position: top center; }

  /* Callout-Pille */
  .callout { position: absolute; padding: 14px 26px; border-radius: 999px; color: #fff;
    font-weight: 800; font-size: 38px; letter-spacing: -.01em; opacity: 0;
    background: linear-gradient(135deg, ${C.brand1}, ${C.brand2});
    box-shadow: 0 14px 40px rgba(20,194,218,.45); white-space: nowrap; }

  /* Dunkler Scrim unten, damit Untertitel IMMER lesbar über dem Video sitzen */
  .caps-scrim { position: absolute; left: 0; right: 0; bottom: 0; height: 600px; z-index: 40;
    pointer-events: none;
    background: linear-gradient(to top, rgba(3,16,26,.94) 0%, rgba(3,16,26,.8) 32%, rgba(3,16,26,0) 100%); }

  /* Untertitel (kinetisch) — feste Safe-Zone unten, umbrechend, nie am Rand abgeschnitten */
  .caps { position: absolute; left: 90px; right: 90px; bottom: 210px;
    text-align: center; z-index: 50; }
  .cap { position: absolute; left: 0; right: 0; }
  .cap .w { display: inline-block; color: #fff; font-weight: 800; font-size: 48px;
    line-height: 1.32; letter-spacing: -.01em; opacity: 0; margin: 3px 6px;
    text-shadow: 0 3px 14px rgba(0,0,0,.9), 0 1px 3px rgba(0,0,0,.95); }
  .cap .w.hl { color: ${C.gold}; }

  /* Intro / Outro */
  .card-screen { position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center; color: #fff; opacity: 0; z-index: 60; }
  .outro-kicker { font-size: 38px; font-weight: 800; color: ${C.brand1}; letter-spacing: -.01em;
    margin-bottom: 6px; text-transform: uppercase; }
  .card-screen img { width: 168px; height: 168px; filter: drop-shadow(0 16px 40px rgba(0,0,0,.5)); }
  .intro-title { font-size: 92px; font-weight: 900; letter-spacing: -.03em; margin-top: 22px; }
  .intro-title .a { background: linear-gradient(135deg,${C.brand1},${C.brand2});
    -webkit-background-clip: text; background-clip: text; color: transparent; }
  .intro-sub { font-size: 40px; color: #b8c6cf; margin-top: 14px; font-weight: 600; }
  .outro-h { font-size: 84px; font-weight: 900; letter-spacing: -.03em; margin-top: 22px; line-height: 1.1; }
  .outro-url { margin-top: 30px; font-size: 46px; font-weight: 800; color: ${C.brand1}; }
  .outro-pill { margin-top: 40px; padding: 22px 54px; border-radius: 999px; font-size: 42px;
    font-weight: 800; color: #fff; background: linear-gradient(135deg,${C.brand1},${C.brand2});
    box-shadow: 0 18px 50px rgba(47,107,255,.5); }
</style>
</head>
<body>
<div id="root" data-composition-id="root" data-start="0" data-width="${W}" data-height="${H}">
  <div class="bg"></div>
  ${bgPixels()}
  ${portrait ? '' : '<div class="brandbar" id="brandbar">Pixel<span class="dot">€</span>uro</div>'}

  <!-- Capture: Mobil = Phone-Screen voll, Desktop = schwebendes Browser-Fenster -->
  <div class="stage" id="stage">
    <div class="card">
      ${portrait ? '' : `<div class="chrome">
        <span class="tl" style="background:#ff5f57"></span>
        <span class="tl" style="background:#febc2e"></span>
        <span class="tl" style="background:#28c840"></span>
        <span class="urlbar">🔒 <b>&nbsp;pixeleuro.de</b></span>
      </div>`}
      <div class="viewport">
        <video id="cap" class="clip" muted playsinline
          data-start="${stageStart}" data-duration="${captureDur}"
          data-track-index="0" data-has-audio="false" src="capture.mp4"></video>
      </div>
    </div>
  </div>

  ${calloutEls(beats, lang)}

  <!-- Untertitel + Scrim (immer lesbar über dem Video) -->
  <div class="caps-scrim"></div>
  <div class="caps">${capEls(beats, lang)}</div>

  <!-- Intro -->
  <div class="card-screen" id="intro">
    <img src="logo.svg" alt="" />
    <div class="intro-title">Pixel<span class="a">€</span>uro</div>
    <div class="intro-sub">${esc(lang === 'de' ? '1 Pixel. 1 Euro. Für immer.' : '1 pixel. 1 euro. Forever.')}</div>
  </div>

  <!-- Outro -->
  <div class="card-screen" id="outro">
    <img src="logo.svg" alt="" />
    ${feature.outro.kicker ? `<div class="outro-kicker">${esc(feature.outro.kicker[lang])}</div>` : ''}
    <div class="outro-h">${esc(feature.outro.headline[lang])}</div>
    <div class="outro-url">${esc(feature.outro.url)}</div>
    <div class="outro-pill">${esc(lang === 'de' ? 'Sichere dir deinen Pixel →' : 'Claim your pixel →')}</div>
  </div>

  ${voEls(beats)}
</div>

<script>
${timelineScript({ beats, total, stageStart, stageEnd, outroStart, INTRO, OUTRO, CARD_W, CARD_H, VIDEO_H, CHROME, cssW: timeline.cssWidth, cssH: timeline.cssHeight, portrait })}
</script>
</body>
</html>`;

  await fs.writeFile(join(compDir, 'index.html'), html);

  // logo.svg für Intro/Outro mitkopieren
  await fs.copyFile(join(ROOT, '..', 'public', 'logo.svg'), join(compDir, 'logo.svg')).catch(() => {});

  console.log(`✅ Komposition (${lang}): ${compDir}/index.html  — total ${total}s  (VO: ${vo ? 'ja' : 'nein'})`);
  return { compDir, total, hasVO: !!vo };
}

// --- deterministische Hintergrund-Pixel ---
function bgPixels() {
  const cols = [C.brand1, C.brand2, C.gold, C.pink, C.ok];
  const pts = [
    [80, 300], [980, 360], [140, 1500], [930, 1560], [60, 980],
    [1000, 1080], [200, 1750], [880, 240], [40, 1300], [1010, 1700],
  ];
  return pts.map((p, i) =>
    `<div class="bg-pixel" id="bgp${i}" style="left:${p[0]}px;top:${p[1]}px;background:${cols[i % cols.length]}"></div>`
  ).join('\n  ');
}

// --- Callout-Elemente (über dem Fenster positioniert) ---
function calloutEls(beats, lang) {
  return beats.filter((b) => b.feat.callout).map((b, i) =>
    `<div class="callout" id="callout-${b.label}" style="left:${i % 2 ? 120 : 560}px;top:${390}px">${esc(b.feat.callout[lang] || '')}</div>`
  ).join('\n  ');
}

// --- Untertitel-Elemente (Wort-Spans) ---
function capEls(beats, lang) {
  return beats.map((b) => {
    const txt = (b.feat.narration && b.feat.narration[lang]) || '';
    const words = txt.split(/\s+/).filter(Boolean);
    const spans = words.map((w) => `<span class="w">${esc(w)}</span>`).join(' ');
    return `<div class="cap" id="cap-${b.label}">${spans}</div>`;
  }).join('\n  ');
}

// --- VO-Audio-Elemente ---
function voEls(beats) {
  return beats.filter((b) => b.voFile).map((b) =>
    `<audio id="vo-${b.label}" class="clip" data-start="${b.compStart}" data-duration="${(b.voDur || 2).toFixed(3)}" data-volume="1" data-has-audio="true" src="${b.voFile}"></audio>`
  ).join('\n  ');
}

// --- GSAP-Timeline ---
function timelineScript(ctx) {
  const { beats, total, stageStart, outroStart, INTRO, OUTRO, CARD_W, CARD_H, VIDEO_H, CHROME, cssW, cssH, portrait } = ctx;
  // Daten als JSON ins Script
  const beatData = beats.map((b) => ({
    label: b.label, compStart: b.compStart,
    end: 0, // wird unten gefüllt
    x: b.x, y: b.y, zoom: (b.feat.zoom || 1.15),
    hasCallout: !!b.feat.callout, voDur: b.voDur,
    visualGap: b.visualGap,
  }));
  for (let i = 0; i < beatData.length; i++) {
    const next = beatData[i + 1];
    beatData[i].end = next ? next.compStart : (INTRO + (beats[i].t + beats[i].visualGap));
  }
  return `
const BEATS = ${JSON.stringify(beatData)};
const TOTAL = ${total}, STAGE_START = ${stageStart}, OUTRO_START = ${outroStart}, OUTRO_LEN = ${OUTRO};
const CARD_W = ${CARD_W}, CARD_H = ${CARD_H}, VIDEO_H = ${VIDEO_H}, CHROME = ${CHROME};
const CSS_W = ${cssW}, CSS_H = ${cssH};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Fokus-Punkt (Beat-Cursor in Capture-CSS) -> transform-origin % der Karte (inkl. Chrome)
function origin(b) {
  const fx = clamp(b.x / CSS_W, 0, 1);
  const fy = clamp(b.y / CSS_H, 0, 1);
  const ox = clamp(fx * 100, 14, 86);
  const cardY = (CHROME + fy * VIDEO_H) / CARD_H * 100;
  const oy = clamp(cardY, 12, 88);
  return { ox, oy };
}

const tl = gsap.timeline({ paused: true });

// Intro — schneller, knackiger Hook (Logo snappt, Hook-Zeile knallt rein)
tl.set('#intro', { opacity: 1 }, 0);
tl.fromTo('#intro img', { scale: 0.4, opacity: 0 }, { scale: 1.05, opacity: 1, duration: 0.40, ease: 'back.out(2.4)' }, 0.0);
tl.fromTo('#intro .intro-title', { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.30, ease: 'power3.out' }, 0.16);
tl.fromTo('#intro .intro-sub', { y: 22, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.32, ease: 'back.out(2)' }, 0.30);
tl.to('#intro', { opacity: 0, scale: 1.08, duration: 0.28, ease: 'power2.in' }, ${INTRO - 0.26});
tl.set('#intro', { opacity: 0 }, ${INTRO}); // hard kill: stabiles Seeking an der Clip-Grenze

// Bühne / Fenster rein (snappy whoosh, leicht überlappend)
tl.fromTo('#stage', { opacity: 0, scale: 0.9, y: 26 }, { opacity: 1, scale: 1, y: 0, duration: 0.45, ease: 'power3.out' }, STAGE_START - 0.18);
${portrait ? '' : "tl.to('#brandbar', { opacity: 0.9, duration: 0.5 }, STAGE_START);"}

// Hintergrund-Pixel sanft driften (finit, kein repeat:-1)
${[0,1,2,3,4,5,6,7,8,9].map(i => `tl.to('#bgp${i}', { y: '+=${(i%2?-1:1)*40}', x: '+=${(i%3-1)*24}', duration: TOTAL, ease: 'sine.inOut' }, 0);`).join('\n')}

// Kamera-Zooms + Untertitel + Callouts pro Beat
BEATS.forEach((b) => {
  const o = origin(b);
  gsap.set('#stage', { transformOrigin: o.ox + '% ' + o.oy + '%' });
  tl.to('#stage', { scale: b.zoom, transformOrigin: o.ox + '% ' + o.oy + '%', duration: 0.42, ease: 'power2.inOut' }, b.compStart);

  // Untertitel Wort-für-Wort rein, am Ende raus
  const cap = '#cap-' + b.label;
  const words = document.querySelectorAll(cap + ' .w');
  const span = Math.max(0.4, (b.end - b.compStart));
  const per = Math.min(0.12, (span * 0.45) / Math.max(1, words.length));
  words.forEach((w, wi) => {
    tl.fromTo(w, { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.32, ease: 'power2.out' }, b.compStart + 0.05 + wi * per);
  });
  tl.to(cap + ' .w', { opacity: 0, duration: 0.25, ease: 'power1.in' }, b.end - 0.22);

  // Callout
  if (b.hasCallout) {
    const co = '#callout-' + b.label;
    tl.fromTo(co, { opacity: 0, scale: 0.6, y: 14 }, { opacity: 1, scale: 1, y: 0, duration: 0.4, ease: 'back.out(2)' }, b.compStart + 0.15);
    tl.to(co, { opacity: 0, scale: 0.9, duration: 0.3, ease: 'power1.in' }, b.end - 0.2);
  }
});

// Fenster raus, Outro rein
tl.to('#stage', { opacity: 0, scale: 1.04, duration: 0.45, ease: 'power2.in' }, OUTRO_START - 0.2);
${portrait ? '' : "tl.to('#brandbar', { opacity: 0, duration: 0.3 }, OUTRO_START - 0.2);"}
tl.fromTo('#outro', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.55, ease: 'power3.out' }, OUTRO_START + 0.05);
tl.fromTo('#outro img', { scale: 0.7 }, { scale: 1, duration: 0.6, ease: 'back.out(1.7)' }, OUTRO_START + 0.1);
tl.fromTo('#outro .outro-pill', { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(2)' }, OUTRO_START + 0.6);

window.__timelines = window.__timelines || {};
window.__timelines["root"] = tl;
`;
}

// CLI: node compose/build.mjs [de|en] [flow]
if (import.meta.url === `file://${process.argv[1]}`) {
  const lang = process.argv[2] || 'de';
  const flow = process.argv[3] || 'buy';
  buildComposition({ lang, flow }).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
