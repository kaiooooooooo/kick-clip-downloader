import express from 'express';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVod, isAllowedHost } from './kick.js';
import { cutClip, probe } from './clip.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const TMP = process.env.TMP_DIR || path.join(dir, '../tmp');
const MAX_SECONDS = +process.env.MAX_CLIP_SECONDS || 600;
const MAX_CONCURRENT = +process.env.MAX_CONCURRENT || 2;
const TTL = 30 * 60_000;
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY === '1');
app.use(express.json({ limit: '2kb' }));
app.use(express.static(path.join(dir, '../public')));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120 }));
const heavy = rateLimit({ windowMs: 10 * 60_000, limit: 10 });
const loadLimit = rateLimit({ windowMs: 60_000, limit: 15 });

const jobs = new Map();
const fail = (res, status, code) => res.status(status).json({ error: code });
const STATUS = { INVALID_URL: 400, NOT_FOUND: 404, UNAVAILABLE: 422, UPSTREAM: 502 };
const handle = (res, e) => fail(res, STATUS[e.code] || 500, STATUS[e.code] ? e.code : 'PROCESSING');

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.post('/api/video', loadLimit, async (req, res) => {
  try {
    const v = await resolveVod(req.body?.url);
    res.json({
      title: v.title, thumbnail: v.thumbnail, duration: v.duration,
      quality: { height: v.best.height, fps: v.best.fps },
      playbackUrl: '/api/proxy?u=' + encodeURIComponent(v.best.url),
    });
  } catch (e) { handle(res, e); }
});

// Proxy mínimo só para o preview no navegador (CORS). Allowlist de hosts, sem redirects.
app.get('/api/proxy', async (req, res) => {
  try {
    const u = new URL(String(req.query.u));
    if (u.protocol !== 'https:' || !isAllowedHost(u.hostname)) return res.sendStatus(400);
    const r = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!r.ok) return res.sendStatus(502);
    if (u.pathname.endsWith('.m3u8')) {
      const px = (s) => '/api/proxy?u=' + encodeURIComponent(new URL(s, u).href);
      const body = (await r.text()).split('\n').map((l) => l.startsWith('#')
        ? l.replace(/URI="([^"]+)"/g, (_, s) => `URI="${px(s)}"`)
        : l.trim() ? px(l.trim()) : l).join('\n');
      return res.type('application/vnd.apple.mpegurl').send(body);
    }
    res.type(r.headers.get('content-type') || 'application/octet-stream');
    Readable.fromWeb(r.body).on('error', () => res.end()).pipe(res);
  } catch { res.sendStatus(400); }
});

app.post('/api/clip', heavy, async (req, res) => {
  try {
    const { url, start, end, precise } = req.body || {};
    const s = Number(start), e = Number(end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e <= s) return fail(res, 400, 'INVALID_RANGE');
    if (e - s > MAX_SECONDS) return fail(res, 400, 'TOO_LONG');
    if ([...jobs.values()].filter((j) => j.status === 'processing').length >= MAX_CONCURRENT) return fail(res, 503, 'BUSY');
    const vod = await resolveVod(url); // revalida e re-resolve a fonte no servidor
    if (e > vod.duration + 1) return fail(res, 400, 'INVALID_RANGE');
    const id = randomUUID();
    const job = { status: 'processing', file: path.join(TMP, id + '.mp4'), created: Date.now() };
    jobs.set(id, job);
    cutClip({ source: vod.best.url, start: s, duration: e - s, out: job.file, precise: precise === true })
      .then(() => probe(job.file))
      .then((info) => Object.assign(job, { status: 'done', info }))
      .catch(() => { job.status = 'error'; fs.rm(job.file, { force: true }, () => {}); });
    res.status(202).json({ id });
  } catch (e) { handle(res, e); }
});

app.get('/api/jobs/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  j ? res.json({ status: j.status, info: j.info }) : fail(res, 404, 'NOT_FOUND');
});

// Só serve arquivos cujo id existe no mapa de jobs (nunca caminhos vindos do cliente).
app.get('/api/file/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j || j.status !== 'done') return fail(res, 404, 'NOT_FOUND');
  req.query.dl ? res.download(j.file, 'clipe.mp4') : res.sendFile(j.file);
});

setInterval(() => {
  for (const [id, j] of jobs) if (Date.now() - j.created > TTL) { fs.rm(j.file, { force: true }, () => {}); jobs.delete(id); }
}, 60_000).unref();

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Clipr ouvindo em 0.0.0.0:${PORT}`));
