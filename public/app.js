const $ = (s) => document.querySelector(s);
const MSG = {
  INVALID_URL: 'Link inválido. Use um link de VOD da Kick, como kick.com/canal/videos/…',
  NOT_FOUND: 'Não encontramos este vídeo. Verifique o link e tente novamente.',
  UNAVAILABLE: 'Este vídeo não está disponível para processamento.',
  UPSTREAM: 'Não conseguimos carregar este vídeo. Verifique o link e tente novamente.',
  INVALID_RANGE: 'Intervalo inválido. O início deve ser menor que o fim e estar dentro do vídeo.',
  TOO_LONG: 'Duração excedida. Escolha um trecho mais curto.',
  BUSY: 'Estamos com muitos pedidos agora. Tente novamente em instantes.',
  PROCESSING: 'Algo deu errado ao gerar o clipe. Tente novamente.',
  DOWNLOAD: 'Falha no download. Gere o clipe novamente.',
  RATE: 'Muitas solicitações. Aguarde um pouco e tente de novo.',
};
const KICK_RE = /^https:\/\/(www\.)?kick\.com\/[\w-]+\/videos\/[0-9a-f-]{36}\/?$/i;
let vod, url, start = 0, end = 30, hls, timer;
const v = $('#video'), track = $('#track');

const fmt = (t) => { t = Math.max(0, Math.round(t)); return [t / 3600 | 0, (t % 3600) / 60 | 0, t % 60].map((n) => String(n).padStart(2, '0')).join(':'); };
const parse = (s) => { const p = s.trim().split(':').map(Number); return p.some(isNaN) || p.length > 3 ? NaN : p.reduce((a, n) => a * 60 + n, 0); };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const show = (el, msg) => { el.textContent = msg || ''; el.hidden = !msg; };

async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined).catch(() => { throw new Error('UPSTREAM'); });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 429 ? 'RATE' : d.error || 'UPSTREAM');
  return d;
}

$('#helpBtn').onclick = () => ($('#help').hidden = !$('#help').hidden);
$('#url').oninput = () => { $('#url').classList.remove('invalid'); show($('#err')); };

$('#loadForm').onsubmit = async (e) => {
  e.preventDefault();
  url = $('#url').value.trim();
  if (!KICK_RE.test(url)) { $('#url').classList.add('invalid'); return show($('#err'), MSG.INVALID_URL); }
  $('#loadBtn').disabled = true; $('#loadBtn').textContent = 'Carregando…'; show($('#err'));
  try { vod = await api('/api/video', { url }); openEditor(); }
  catch (x) { show($('#err'), MSG[x.message] || MSG.UPSTREAM); }
  $('#loadBtn').disabled = false; $('#loadBtn').textContent = 'Carregar vídeo';
};

function openEditor() {
  $('#editor').hidden = false; $('#result').hidden = true;
  $('#vTitle').textContent = vod.title;
  if (vod.thumbnail) $('#thumb').src = vod.thumbnail;
  const q = vod.quality, qs = [q.height && q.height + 'p', q.fps && q.fps + ' FPS'].filter(Boolean).join(' • ');
  $('#vMeta').textContent = `Duração ${fmt(vod.duration)}${qs ? ' • ' + qs : ''}`;
  $('#src').textContent = `Fonte: ${qs || 'melhor qualidade disponível'} • Áudio original`;
  $('#tot').textContent = fmt(vod.duration);
  start = 0; end = Math.min(30, vod.duration);
  hls?.destroy();
  if (window.Hls && Hls.isSupported()) {
    hls = new Hls(); hls.loadSource(vod.playbackUrl); hls.attachMedia(v);
    hls.on(Hls.Events.ERROR, (_, d) => d.fatal && show($('#rangeErr'), MSG.UPSTREAM));
  } else v.src = vod.playbackUrl;
  render(); $('#editor').scrollIntoView({ behavior: 'smooth' });
}

function render() {
  const p = (t) => (t / vod.duration) * 100 + '%';
  $('#hS').style.left = p(start); $('#hE').style.left = p(end);
  $('#range').style.left = p(start); $('#range').style.width = ((end - start) / vod.duration) * 100 + '%';
  if (document.activeElement !== $('#inS')) $('#inS').value = fmt(start);
  if (document.activeElement !== $('#inE')) $('#inE').value = fmt(end);
  $('#dur').textContent = fmt(end - start);
}
v.ontimeupdate = () => { if (!vod) return; $('#cur').textContent = fmt(v.currentTime); $('#play').style.left = (v.currentTime / vod.duration) * 100 + '%'; };

// Arrastar marcadores (mouse e toque)
const timeAt = (e) => { const r = track.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) * vod.duration; };
for (const [id, isStart] of [['#hS', true], ['#hE', false]]) {
  const h = $(id);
  h.onpointerdown = (e) => { e.stopPropagation(); h.setPointerCapture(e.pointerId); };
  h.onpointermove = (e) => {
    if (!h.hasPointerCapture(e.pointerId)) return;
    const t = timeAt(e);
    if (isStart) start = Math.min(t, end - 0.1); else end = Math.max(t, start + 0.1);
    v.currentTime = isStart ? start : end; show($('#rangeErr')); render();
  };
  h.onkeydown = (e) => { const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key]; if (d) { isStart ? setS(start + d) : setE(end + d); } };
}
track.onpointerdown = (e) => { v.currentTime = timeAt(e); };

function setS(t) { if (t >= end) return show($('#rangeErr'), MSG.INVALID_RANGE); show($('#rangeErr')); start = clamp(t, 0, vod.duration); render(); }
function setE(t) { if (t <= start || t > vod.duration + 1) return show($('#rangeErr'), MSG.INVALID_RANGE); show($('#rangeErr')); end = Math.min(t, vod.duration); render(); }
$('#setS').onclick = () => setS(v.currentTime);
$('#setE').onclick = () => setE(v.currentTime);
$('#inS').onchange = () => { const t = parse($('#inS').value); isNaN(t) ? show($('#rangeErr'), MSG.INVALID_RANGE) : setS(t); render(); };
$('#inE').onchange = () => { const t = parse($('#inE').value); isNaN(t) ? show($('#rangeErr'), MSG.INVALID_RANGE) : setE(t); render(); };
document.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => (v.currentTime = clamp(v.currentTime + +b.dataset.d, 0, vod.duration))));

$('#gen').onclick = async () => {
  show($('#rangeErr')); $('#result').hidden = true;
  $('#gen').disabled = true; $('#busy').hidden = false;
  try {
    const { id } = await api('/api/clip', { url, start, end, precise: $('#precise').checked });
    await poll(id);
  } catch (x) { show($('#rangeErr'), MSG[x.message] || MSG.PROCESSING); }
  $('#gen').disabled = false; $('#busy').hidden = true;
};

function poll(id) {
  return new Promise((resolve, reject) => {
    clearInterval(timer);
    timer = setInterval(async () => {
      try {
        const j = await api('/api/jobs/' + id);
        if (j.status === 'processing') return;
        clearInterval(timer);
        if (j.status !== 'done') return reject(new Error('PROCESSING'));
        const i = j.info;
        $('#pv').src = '/api/file/' + id;
        $('#dl').href = '/api/file/' + id + '?dl=1';
        $('#rInfo').textContent = [i.height && i.height + 'p', i.fps && i.fps + ' FPS', fmt(i.duration), (i.size / 1048576).toFixed(1) + ' MB'].filter(Boolean).join(' • ');
        $('#result').hidden = false; $('#result').scrollIntoView({ behavior: 'smooth' });
        resolve();
      } catch (x) { clearInterval(timer); reject(x); }
    }, 1000);
  });
}
