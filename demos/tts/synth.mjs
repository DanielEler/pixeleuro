// ============================================================
//  TTS — Sprecher-Synthese mit Hash-Cache.
//  Provider: ElevenLabs (eleven_multilingual_v2, natürlicher) wenn
//  ein gültiger sk_-Key da ist; sonst Kokoro (lokal, $0) via HyperFrames.
//  Pro Beat: synth -> trim silence -> Dauer (ffprobe) -> Manifest.
//  Guard: nie zu-kurzes/leeres Audio cachen.
// ============================================================
import 'dotenv/config';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE = join(__dirname, 'cache');

// Default-Stimmen
const KOKORO_VOICE = { en: 'am_adam', de: 'bm_george' }; // Kokoro hat kein DE -> bm_george als Platzhalter
const EL_MODEL = 'eleven_multilingual_v2';
const EL_DEFAULT_VOICE = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb'; // "George" (EL preset)

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const ps = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    ps.stdout.on('data', (d) => (out += d));
    ps.stderr.on('data', (d) => (err += d));
    ps.on('error', reject);
    ps.on('close', (c) => (c === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(' ')} exit ${c}\n${err.slice(-800)}`))));
  });
}

async function ffprobeDur(file) {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  return parseFloat(out.trim()) || 0;
}

// Stille am Anfang/Ende trimmen + leise normalisieren -> .mp3
async function trimToMp3(src, dst) {
  await run('ffmpeg', [
    '-y', '-i', src,
    '-af', 'silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB:detection=peak,areverse,silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB:detection=peak,areverse,loudnorm=I=-16:TP=-1.5:LRA=11',
    '-ar', '44100', '-ac', '1', '-b:a', '128k', dst,
  ]);
}

// --- ElevenLabs: Key vorhanden? (nur Format prüfen, KEIN Voices-Call ->
//     so reicht ein Key mit ausschließlich "Text zu Sprache"-Recht.) ---
async function elevenLabsAvailable() {
  const key = process.env.ELEVENLABS_API_KEY;
  return !!(key && /^sk_/.test(key));
}

async function synthElevenLabs(text, lang, rawOut) {
  const key = process.env.ELEVENLABS_API_KEY;
  const voice = EL_DEFAULT_VOICE;
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: EL_MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true } }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await fs.writeFile(rawOut, buf);
}

async function synthKokoro(text, lang, rawOut) {
  const voice = KOKORO_VOICE[lang] || 'am_adam';
  await run('npx', ['--yes', 'hyperframes', 'tts', text, '-o', rawOut, '-v', voice, '-l', lang === 'de' ? 'en-gb' : 'en-us']);
}

/**
 * synth({ text, lang, provider, key }) -> { file, dur } (file relativ zu cache/)
 * Hash-Cache über Text+Provider+Voice.
 */
export async function synth({ text, lang = 'en', provider }) {
  await fs.mkdir(CACHE, { recursive: true });
  const prov = provider || (await elevenLabsAvailable() ? 'elevenlabs' : 'kokoro');
  const voiceTag = prov === 'elevenlabs' ? EL_DEFAULT_VOICE : (KOKORO_VOICE[lang] || 'am_adam');
  const hash = createHash('sha1').update(`${prov}|${voiceTag}|${lang}|${text}`).digest('hex').slice(0, 12);
  const fileName = `vo-${lang}-${hash}.mp3`;
  const finalPath = join(CACHE, fileName);

  // Cache-Hit (mit Plausibilitäts-Guard: Datei existiert & Dauer ok)
  try {
    const dur = await ffprobeDur(finalPath);
    if (dur >= 0.4) return { file: fileName, dur, provider: prov };
  } catch {}

  const raw = join(CACHE, `_raw-${hash}.${prov === 'kokoro' ? 'wav' : 'mp3'}`);
  if (prov === 'elevenlabs') await synthElevenLabs(text, lang, raw);
  else await synthKokoro(text, lang, raw);

  await trimToMp3(raw, finalPath);
  await fs.rm(raw, { force: true });

  const dur = await ffprobeDur(finalPath);
  if (dur < 0.4) { // Guard gegen leeres/zu-kurzes Audio -> nicht "vergiften"
    await fs.rm(finalPath, { force: true });
    throw new Error(`TTS-Ergebnis zu kurz (${dur}s) für: "${text.slice(0, 40)}"`);
  }
  return { file: fileName, dur, provider: prov };
}

/**
 * buildVoiceover(flow, lang) — synthetisiert alle Beats + schreibt Manifest.
 * Manifest: cache/<flow>-<lang>.json = [{label, file, dur}]
 */
export async function buildVoiceover(flow = 'buy', lang = 'en') {
  const feature = JSON.parse(await fs.readFile(join(ROOT, 'features', `${flow}.json`), 'utf8'));
  const prov = (await elevenLabsAvailable()) ? 'elevenlabs' : 'kokoro';
  console.log(`🎙️  TTS-Provider: ${prov}  (lang=${lang})`);
  const manifest = [];
  for (const beat of feature.beats) {
    const text = beat.narration?.[lang];
    if (!text) continue;
    const { file, dur } = await synth({ text, lang, provider: prov });
    manifest.push({ label: beat.label, file, dur: +dur.toFixed(3), text });
    console.log(`   ✓ ${beat.label.padEnd(8)} ${dur.toFixed(2)}s  "${text.slice(0, 48)}"`);
  }
  const manifestPath = join(CACHE, `${flow}-${lang}.json`);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`   -> Manifest: ${manifestPath}`);
  return manifest;
}

// CLI: node tts/synth.mjs [en|de] [flow]
if (import.meta.url === `file://${process.argv[1]}`) {
  const lang = process.argv[2] || 'en';
  const flow = process.argv[3] || 'buy';
  buildVoiceover(flow, lang).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
