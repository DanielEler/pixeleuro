// ============================================================
//  Teaser — zeigt die ECHTE Seite (Mobil, leere Wand) als scharfen
//  Vollbild-Hintergrund + großen abstrakten Hook-Text drüber (auf
//  dunklem Scrim, damit's über der hellen Seite lesbar ist) + Liam-VO.
//  Fällt auf abstraktes CSS-Grid zurück, falls kein Capture vorliegt.
//  Render: 60 fps / high, kein Re-Encode -> scharf.
// ============================================================
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const W = 1080, H = 1920;
const INTRO = 0.6, GAP = 0.22, TAIL = 1.6;

const C = { brand1: '#14c2da', brand2: '#2f6bff', gold: '#FFCB3A', pink: '#d4537e', ok: '#16a34a' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function buildTeaser({ lang = 'en', flow = 'teaser' } = {}) {
  const feature = JSON.parse(await fs.readFile(join(ROOT, 'features', `${flow}.json`), 'utf8'));
  let vo = null;
  try { vo = JSON.parse(await fs.readFile(join(ROOT, 'tts', 'cache', `${flow}-${lang}.json`), 'utf8')); } catch {}
  const voDur = {}; if (vo) for (const v of vo) voDur[v.label] = v.dur;

  const compDir = join(ROOT, 'out', flow, `comp-${lang}`);
  await fs.mkdir(compDir, { recursive: true });
  if (vo) for (const v of vo) await fs.copyFile(join(ROOT, 'tts', 'cache', v.file), join(compDir, v.file)).catch(() => {});

  // Echtes Capture als Hintergrund?
  let hasVideo = false, videoDur = 0;
  try {
    const ct = JSON.parse(await fs.readFile(join(ROOT, 'out', flow, 'action-timeline.json'), 'utf8'));
    videoDur = ct.duration;
    await fs.copyFile(join(ROOT, 'out', flow, 'capture.mp4'), join(compDir, 'capture.mp4'));
    hasVideo = true;
  } catch { hasVideo = false; }
  if (!hasVideo) await fs.copyFile(join(ROOT, '..', 'public', 'logo.svg'), join(compDir, 'logo.svg')).catch(() => {});

  // Sequenzielle Beat-Zeiten aus VO-Längen
  const fb = { day1: 1.2, empty: 3.2, price: 2.6, cta: 2.6 };
  let t = INTRO;
  const beats = feature.beats.map((b) => {
    const dur = voDur[b.label] || fb[b.label] || 2.2;
    const start = +t.toFixed(3);
    t += dur + GAP;
    return { ...b, start, dur: +dur.toFixed(3), voFile: vo?.find((v) => v.label === b.label)?.file || null };
  });
  const voEnd = +(t - GAP + TAIL).toFixed(3);
  // Gesamtlänge = VO-Ende (kein Leerlauf). Video wird darauf zugeschnitten.
  const total = hasVideo ? +Math.min(videoDur, voEnd).toFixed(3) : voEnd;
  const lastLabel = beats[beats.length - 1].label;

  const textBlocks = beats.map((b) => {
    const big = (b.big && b.big[lang]) || '';
    const sub = (b.sub && b.sub[lang]) || '';
    return `<div class="tblk" id="t-${b.label}"><div class="big">${esc(big)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;
  }).join('\n');

  const voEls = beats.filter((b) => b.voFile).map((b) =>
    `<audio id="vo-${b.label}" class="clip" data-start="${b.start}" data-duration="${b.dur.toFixed(3)}" data-volume="1" data-has-audio="true" src="${b.voFile}"></audio>`
  ).join('\n  ');

  const grain = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/></filter><rect width="160" height="160" filter="url(%23n)"/></svg>');

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${W}px; height:${H}px; background:#03101a; overflow:hidden; font-family:"Inter",system-ui,sans-serif; }
  #root { position:relative; width:${W}px; height:${H}px; }
  .bg { position:absolute; inset:0; background: radial-gradient(120% 80% at 50% 0%, #0b3a52 0%, #061826 58%, #03101a 100%); }
  .bgp { position:absolute; width:30px; height:30px; border-radius:7px; opacity:.16; }

  /* Echte Seite als Vollbild-Hintergrund */
  #bg-video { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:top center; z-index:0; will-change:transform; }

  /* Scrims: oben leicht, unten kräftig (Text lesbar über heller Seite) */
  .scrim-top { position:absolute; left:0; right:0; top:0; height:240px; z-index:1; pointer-events:none;
    background:linear-gradient(to bottom, rgba(3,16,26,.65), rgba(3,16,26,0)); }
  .scrim-bot { position:absolute; left:0; right:0; bottom:0; height:920px; z-index:1; pointer-events:none;
    background:linear-gradient(to top, rgba(3,16,26,.96) 0%, rgba(3,16,26,.82) 34%, rgba(3,16,26,0) 100%); }
  .vignette { position:absolute; inset:0; z-index:1; pointer-events:none; background: radial-gradient(130% 100% at 50% 42%, rgba(0,0,0,0) 55%, rgba(0,0,0,.5) 100%); }
  .grain { position:absolute; inset:0; z-index:2; pointer-events:none; opacity:.05; mix-blend-mode:overlay; background-image:url("data:image/svg+xml;utf8,${grain}"); }

  .pixi { position:absolute; top:300px; left:50%; transform:translateX(-50%); width:150px; height:150px; filter:drop-shadow(0 14px 36px rgba(0,0,0,.5)); opacity:0; z-index:3; }
  .grid { position:absolute; left:50%; top:640px; width:760px; height:760px; margin-left:-380px; border-radius:30px; border:1px solid rgba(255,255,255,.16); opacity:0; z-index:1; background-color:rgba(255,255,255,.03); background-image:linear-gradient(rgba(255,255,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.07) 1px,transparent 1px); background-size:40px 40px; }

  /* Hook-Text — bei Video unten im Scrim, sonst zentriert */
  .tblk { position:absolute; left:60px; right:60px; ${hasVideo ? 'bottom:300px' : 'top:880px'}; text-align:center; z-index:5; opacity:0; }
  .big { color:#fff; font-weight:900; font-size:${hasVideo ? 96 : 130}px; line-height:1.04; letter-spacing:-.03em; text-shadow:0 4px 24px rgba(0,0,0,.85), 0 2px 6px rgba(0,0,0,.9); }
  .sub { margin-top:18px; color:${C.brand1}; font-weight:800; font-size:${hasVideo ? 46 : 50}px; letter-spacing:-.01em; text-shadow:0 2px 10px rgba(0,0,0,.8); }
  #t-cta .sub { color:#fff; }

  .pill { position:absolute; left:50%; bottom:150px; transform:translateX(-50%); opacity:0; z-index:5; padding:24px 56px; border-radius:999px; color:#fff; font-weight:800; font-size:44px; background:linear-gradient(135deg,${C.brand1},${C.brand2}); box-shadow:0 18px 50px rgba(47,107,255,.55); white-space:nowrap; }
</style>
</head>
<body>
<div id="root" data-composition-id="root" data-start="0" data-width="${W}" data-height="${H}">
  ${hasVideo
    ? `<div class="bg"></div>
  <video id="bg-video" class="clip" muted playsinline data-start="0" data-duration="${total}" data-track-index="0" data-has-audio="false" src="capture.mp4"></video>
  <div class="scrim-top"></div>
  <div class="scrim-bot"></div>
  <div class="vignette"></div>`
    : `<div class="bg"></div>
  ${bgPixels()}
  <img class="pixi" id="pixi" src="logo.svg" alt="" />
  <div class="grid" id="grid">${gridCells()}</div>`}
  <div class="grain"></div>
  ${textBlocks}
  <div class="pill" id="pill">${esc(lang === 'de' ? 'Sichere dir deinen Pixel →' : 'Grab your pixel →')}</div>
  ${voEls}
</div>
<script>
const BEATS = ${JSON.stringify(beats.map((b) => ({ label: b.label, start: b.start, dur: b.dur, grid: !!b.grid })))};
const TOTAL = ${total}, LAST = ${JSON.stringify(lastLabel)}, HAS_VIDEO = ${hasVideo};
const tl = gsap.timeline({ paused: true });

if (HAS_VIDEO) {
  // langsamer Ken-Burns auf der echten Seite
  tl.fromTo('#bg-video', { scale: 1.0 }, { scale: 1.08, duration: TOTAL, ease: 'sine.inOut' }, 0);
} else {
  tl.fromTo('#pixi', { opacity:0, scale:0.5, y:10 }, { opacity:1, scale:1, y:0, duration:0.5, ease:'back.out(2.2)' }, 0.1);
  tl.to('#pixi', { y:'-=14', duration: TOTAL, ease:'sine.inOut' }, 0.1);
${[0,1,2,3,4,5,6,7,8,9].map(i=>`  tl.to('#bgp${i}', { y:'+=${(i%2?-1:1)*44}', x:'+=${(i%3-1)*26}', duration: TOTAL, ease:'sine.inOut' }, 0);`).join('\n')}
}

BEATS.forEach((b) => {
  const el = '#t-' + b.label;
  tl.fromTo(el, { opacity:0, scale:1.14, y:18 }, { opacity:1, scale:1, y:0, duration:0.42, ease:'back.out(1.8)' }, b.start);
  if (b.grid && !HAS_VIDEO) tl.fromTo('#grid', { opacity:0, scale:0.92 }, { opacity:1, scale:1, duration:0.5, ease:'power3.out' }, b.start);
  if (b.label !== LAST) {
    tl.to(el, { opacity:0, scale:0.96, duration:0.26, ease:'power1.in' }, b.start + b.dur);
    tl.set(el, { opacity:0 }, b.start + b.dur + 0.27);
    if (b.grid && !HAS_VIDEO) { tl.to('#grid', { opacity:0, duration:0.26 }, b.start + b.dur); tl.set('#grid', { opacity:0 }, b.start + b.dur + 0.27); }
  }
});

const cta = BEATS[BEATS.length-1];
tl.fromTo('#pill', { opacity:0, scale:0.8, y:14 }, { opacity:1, scale:1, y:0, duration:0.5, ease:'back.out(2)' }, cta.start + 0.4);

window.__timelines = window.__timelines || {};
window.__timelines["root"] = tl;
</script>
</body>
</html>`;

  await fs.writeFile(join(compDir, 'index.html'), html);
  console.log(`✅ Teaser (${lang}): ${compDir}/index.html — total ${total}s (Video: ${hasVideo ? 'echte Seite' : 'CSS-Grid'}, VO: ${vo ? 'ja' : 'nein'})`);
  return { compDir, total };
}

function bgPixels() {
  const cols = [C.brand1, C.brand2, C.gold, C.pink, C.ok];
  const pts = [[80,360],[980,420],[140,1520],[930,1580],[60,1020],[1000,1140],[200,1760],[880,300],[40,1340],[1010,1700]];
  return pts.map((p,i)=>`<div class="bgp" id="bgp${i}" style="left:${p[0]}px;top:${p[1]}px;background:${cols[i%cols.length]}"></div>`).join('\n  ');
}
function gridCells() {
  const cols = [C.brand1, C.brand2, C.gold, C.pink];
  const cells = [[3,4],[16,2],[9,11],[14,15],[5,17]];
  return cells.map((c,i)=>`<div class="gcell" style="position:absolute;width:38px;height:38px;border-radius:5px;left:${c[0]*40+4}px;top:${c[1]*40+4}px;background:${cols[i%cols.length]};opacity:.55"></div>`).join('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const lang = process.argv[2] || 'en';
  const flow = process.argv[3] || 'teaser';
  buildTeaser({ lang, flow }).then(() => process.exit(0)).catch((e)=>{ console.error(e); process.exit(1); });
}
