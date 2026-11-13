import { spawn } from 'node:child_process';

// Argumentos sempre em array (sem shell) e apenas valores numéricos/URLs validadas vindos do backend.
const run = (cmd, args, timeoutMs) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
  p.on('error', reject);
  p.on('close', (c) => { clearTimeout(t); c === 0 ? resolve(out) : reject(new Error(`${cmd} exit ${c}`)); });
});

/**
 * Padrão: stream copy (sem recompressão). O início ajusta para o keyframe mais próximo.
 * precise=true: reencoda só o vídeo (x264 CRF 14, resolução/FPS originais); áudio copiado.
 */
export function cutClip({ source, start, duration, out, precise }) {
  const a = ['-hide_banner', '-loglevel', 'error', '-y',
    '-protocol_whitelist', 'http,https,tcp,tls,crypto',
    '-ss', String(start), '-i', source, '-t', String(duration)];
  if (precise) a.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-c:a', 'copy');
  else a.push('-c', 'copy', '-avoid_negative_ts', 'make_zero');
  a.push('-movflags', '+faststart', out);
  return run('ffmpeg', a, 15 * 60_000);
}

export async function probe(file) {
  const o = JSON.parse(await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate:format=duration,size', '-of', 'json', file], 30_000));
  const [n, d] = (o.streams?.[0]?.r_frame_rate || '0/1').split('/').map(Number);
  return {
    width: o.streams?.[0]?.width, height: o.streams?.[0]?.height,
    fps: d ? Math.round((n / d) * 100) / 100 : null,
    duration: +o.format?.duration || 0, size: +o.format?.size || 0,
  };
}
