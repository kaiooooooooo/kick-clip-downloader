// Acesso à Kick. ATENÇÃO: a Kick NÃO tem API pública documentada para baixar VODs.
// Este módulo usa o endpoint interno não oficial que o próprio site usa (kick.com/api/v1/video/{uuid}).
// Ele pode mudar ou ser bloqueado (ex.: Cloudflare) a qualquer momento. Todo o acesso fica isolado aqui.
const UA = process.env.KICK_UA || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const RE = /^https:\/\/(?:www\.)?kick\.com\/[\w-]{1,40}\/videos\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

const err = (code) => Object.assign(new Error(code), { code });

// Allowlist anti-SSRF: só hosts da Kick/IVS.
export const isAllowedHost = (h) =>
  h === 'kick.com' || h.endsWith('.kick.com') || h.endsWith('.live-video.net');

const get = async (url, json) => {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !isAllowedHost(u.hostname)) throw err('UNAVAILABLE');
  const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: json ? 'application/json' : '*/*' }, redirect: 'error', signal: AbortSignal.timeout(15000) }).catch(() => { throw err('UPSTREAM'); });
  if (r.status === 404) throw err('NOT_FOUND');
  if (!r.ok) throw err('UPSTREAM');
  return json ? r.json().catch(() => { throw err('UPSTREAM'); }) : r.text();
};

function parseMaster(text, base) {
  const L = text.split(/\r?\n/), v = [];
  for (let i = 0; i < L.length; i++) {
    if (!L[i].startsWith('#EXT-X-STREAM-INF:') || !L[i + 1]?.trim()) continue;
    const res = /RESOLUTION=(\d+)x(\d+)/.exec(L[i]);
    v.push({
      url: new URL(L[i + 1].trim(), base).href,
      bandwidth: +(/BANDWIDTH=(\d+)/.exec(L[i]) || [])[1] || 0,
      width: res ? +res[1] : null,
      height: res ? +res[2] : null,
      fps: +(/FRAME-RATE=([\d.]+)/.exec(L[i]) || [])[1] || null,
    });
  }
  if (!v.length) v.push({ url: base, bandwidth: 0, width: null, height: null, fps: null }); // já é media playlist
  return v.sort((a, b) => (b.height || 0) - (a.height || 0) || b.bandwidth - a.bandwidth);
}

const sumDuration = (t) => [...t.matchAll(/#EXTINF:([\d.]+)/g)].reduce((s, m) => s + +m[1], 0);

/** Valida a URL e resolve a melhor variante disponível. Sempre chamado no backend. */
export async function resolveVod(url) {
  const m = RE.exec(String(url || '').trim());
  if (!m) throw err('INVALID_URL');
  const d = await get(`https://kick.com/api/v1/video/${m[1]}`, true);
  if (!d?.source) throw err('UNAVAILABLE');
  const master = await get(d.source);
  const best = parseMaster(master, d.source)[0];
  const media = await get(best.url);
  const duration = sumDuration(media) || (d.livestream?.duration ? d.livestream.duration / 1000 : 0);
  if (!duration) throw err('UNAVAILABLE');
  return {
    title: d.livestream?.session_title || 'VOD da Kick',
    thumbnail: d.livestream?.thumbnail?.src || d.livestream?.thumbnail || null,
    duration,
    best,
  };
}
