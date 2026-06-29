// ============================================================
//  Grade — ffmpeg-Post auf das fertige MP4 (kein Re-Render):
//   1) global etwas schneller (snappier, VO pitch-erhaltend via atempo)
//   2) Musik-Bett UNTER die Stimme geduckt (sidechaincompress)
//  Bett: audio/bed.mp3 wenn vorhanden (z. B. Pixabay-Track), sonst ein
//  dezentes prozedurales Pad als Platzhalter.
// ============================================================
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const AUDIO = join(ROOT, 'audio');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const ps = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    ps.stdout.on('data', (d) => (out += d));
    ps.stderr.on('data', (d) => (err += d));
    ps.on('error', reject);
    ps.on('close', (c) => (c === 0 ? resolve(out) : reject(new Error(`${cmd} exit ${c}\n${err.slice(-1200)}`))));
  });
}
async function dur(file) {
  const o = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  return parseFloat(o.trim()) || 0;
}
async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

// Dezentes, warmes Pad als Platzhalter-Bett (falls kein echter Track liegt).
async function makeProceduralBed(seconds, out) {
  const d = Math.ceil(seconds) + 1;
  await run('ffmpeg', [
    '-y',
    '-f', 'lavfi', '-i', `sine=frequency=220:duration=${d}`,   // A3
    '-f', 'lavfi', '-i', `sine=frequency=329.63:duration=${d}`, // E4
    '-f', 'lavfi', '-i', `sine=frequency=164.81:duration=${d}`, // E3
    '-filter_complex',
    '[0][1][2]amix=inputs=3,tremolo=f=4.5:d=0.35,highpass=f=90,lowpass=f=950,volume=2.2[a]',
    '-map', '[a]', '-ar', '44100', '-ac', '2', '-b:a', '128k', out,
  ]);
}

// Ein Segment mit eigener Geschwindigkeit re-encoden (Video + VO, pitch-erhaltend).
async function speedSegment(input, out, spd, { ss = null, t = null } = {}) {
  const args = ['-y'];
  if (ss != null) args.push('-ss', String(ss));
  args.push('-i', input);
  if (t != null) args.push('-t', String(t));
  args.push(
    '-filter:v', `setpts=PTS/${spd}`,
    '-filter:a', `atempo=${spd}`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-r', '30', '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2', out
  );
  await run('ffmpeg', args);
}

/**
 * grade(input, output, { speed, music, hookEnd, hookSpeed, bodySpeed })
 *  - Einfach: nur `speed` -> global.
 *  - Hook-schonend: `hookEnd` (Sek. im Roh-Video) + `hookSpeed`/`bodySpeed`
 *    -> Hook bleibt schnell, Rest langsamer.
 */
export async function grade(input, output, opts = {}) {
  const { speed = 1.1, music = 0.16, hookEnd = null, hookSpeed = 1.3, bodySpeed = 1.08 } = opts;
  await fs.mkdir(AUDIO, { recursive: true });
  const tmp = output.replace(/\.mp4$/, '') + '.speed.mp4';

  if (hookEnd) {
    // Variable Geschwindigkeit: Hook (0..hookEnd) schnell, Rest langsamer.
    const a = output.replace(/\.mp4$/, '') + '.A.mp4';
    const b = output.replace(/\.mp4$/, '') + '.B.mp4';
    await speedSegment(input, a, hookSpeed, { t: hookEnd });
    await speedSegment(input, b, bodySpeed, { ss: hookEnd });
    await run('ffmpeg', [
      '-y', '-i', a, '-i', b,
      '-filter_complex', '[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]',
      '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', tmp,
    ]);
    await fs.rm(a, { force: true }); await fs.rm(b, { force: true });
    console.log(`   Hook 0–${hookEnd}s @ ${hookSpeed}x, Rest @ ${bodySpeed}x`);
  } else if (speed && speed !== 1) {
    await speedSegment(input, tmp, speed);
  } else {
    await fs.copyFile(input, tmp);
  }

  // Ohne Musik: nur Tempo, VO bleibt — fertig.
  if (opts.noMusic || music === 0) {
    await fs.rename(tmp, output);
    console.log(`✅ Grade: speed ${hookEnd ? `${hookSpeed}/${bodySpeed}` : speed}x, OHNE Musik`);
    console.log(`   -> ${output}`);
    return { output, isRealBed: false };
  }

  // 2) Musik-Bett bestimmen
  const realBed = join(AUDIO, 'bed.mp3');
  let bed, isReal = false;
  if (await exists(realBed)) { bed = realBed; isReal = true; }
  else { bed = join(AUDIO, '_bed_proc.mp3'); await makeProceduralBed(await dur(tmp), bed); }

  const total = await dur(tmp);
  // 3) Bett loopen, leise, unter die VO ducken, mischen
  await run('ffmpeg', [
    '-y',
    '-i', tmp,
    '-stream_loop', '-1', '-i', bed,
    '-filter_complex',
    `[1:a]volume=${music},atrim=0:${total.toFixed(2)},asetpts=N/SR/TB[bed];` +
    `[bed][0:a]sidechaincompress=threshold=0.03:ratio=12:attack=15:release=320[duck];` +
    `[0:a][duck]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95[mix]`,
    '-map', '0:v', '-map', '[mix]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', output,
  ]);

  await fs.rm(tmp, { force: true });
  console.log(`✅ Grade: speed ${speed}x, Musik ${isReal ? 'bed.mp3 (echt)' : 'prozedural (Platzhalter)'} geduckt`);
  console.log(`   -> ${output}`);
  return { output, isRealBed: isReal };
}

// CLI:
//   node compose/grade.mjs <in> [out] <globalSpeed>            -> global
//   node compose/grade.mjs <in> [out] hook [hookEnd] [hookSpd] [bodySpd]  -> hook-schonend
if (import.meta.url === `file://${process.argv[1]}`) {
  const input = process.argv[2];
  const output = process.argv[3] || input.replace(/\.mp4$/, '') + '-final.mp4';
  let opts;
  if (process.argv[4] === 'hook') {
    opts = {
      hookEnd: process.argv[5] ? Number(process.argv[5]) : 8.0,
      hookSpeed: process.argv[6] ? Number(process.argv[6]) : 1.3,
      bodySpeed: process.argv[7] ? Number(process.argv[7]) : 1.08,
    };
  } else {
    opts = { speed: process.argv[4] ? Number(process.argv[4]) : 1.1 };
  }
  if (process.argv.includes('nomusic')) opts.noMusic = true;
  grade(input, output, opts).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
