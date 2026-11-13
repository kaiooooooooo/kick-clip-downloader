# Clipr — clipes de VODs da Kick

Frontend estático (`public/`) + backend Node/Express (`server/`) com FFmpeg.

## Requisitos
- Node.js 18.17+ (testado em 22)
- `ffmpeg` e `ffprobe` no PATH

## Rodar
```bash
npm install
npm start   # http://localhost:3000
```

## Variáveis de ambiente
| Variável | Padrão | Função |
|---|---|---|
| `PORT` | 3000 | Porta |
| `MAX_CLIP_SECONDS` | 600 | Duração máxima do clipe |
| `MAX_CONCURRENT` | 2 | Clipes processando ao mesmo tempo |
| `TMP_DIR` | `./tmp` | Armazenamento temporário (arquivos apagados após 30 min) |
| `TRUST_PROXY` | 0 | Use `1` atrás de proxy reverso (para o rate limit ver o IP real) |

## Fluxo
1. `POST /api/video` valida o link, resolve a melhor variante HLS (maior resolução/bitrate) e devolve metadados.
2. O player usa hls.js via `/api/proxy` (só hosts da Kick/IVS, sem redirects).
3. `POST /api/clip` revalida tudo no servidor e roda `ffmpeg` (argumentos em array, sem shell).
   - Padrão: `-c copy` (sem recompressão). O início pode se ajustar ao keyframe mais próximo.
   - "Corte preciso": reencoda só o vídeo (x264 CRF 14, mesma resolução/FPS), áudio copiado.
4. `GET /api/jobs/:id` (status) e `GET /api/file/:id` (preview/download). Só serve IDs de jobs existentes.

## Sobre a Kick (leia)
- A Kick **não oferece API pública documentada** para baixar VODs. `server/kick.js` usa o endpoint interno
  não oficial do site (`kick.com/api/v1/video/{uuid}`). Ele pode mudar, falhar ou ser bloqueado
  (ex.: Cloudflare em IPs de datacenter) sem aviso. Todo o acesso está isolado nesse arquivo.
- O app **não** contorna autenticação, DRM ou paywall e **não verifica** se um VOD é restrito a inscritos:
  use somente conteúdo que você tem autorização para baixar. Confira os Termos de Uso da Kick antes de publicar.
- Apenas VODs (`kick.com/canal/videos/uuid`). Lives em andamento não são suportadas.

## Produção
Coloque atrás de HTTPS/proxy reverso, ajuste os limites, monitore disco/CPU e considere fila (Redis/BullMQ)
e armazenamento externo (S3) se o volume crescer. O estado dos jobs hoje é em memória.

## Publicar no GitHub + Render
1. Crie um repositório no GitHub e envie esta pasta:
   ```bash
   git init && git add . && git commit -m "Clipr"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/clipr.git
   git push -u origin main
   ```
2. No Render: **New → Web Service** (ou **Blueprint**, que lê o `render.yaml`), conecte o repositório e escolha **Docker** como runtime.
3. O Render define a variável `PORT` automaticamente; o servidor usa `process.env.PORT` (padrão 3000) e escuta em `0.0.0.0`.
4. Health check: `/healthz`. Depois do deploy, abra a URL `https://clipr.onrender.com` (ou a que o Render gerar).

Observações: o plano gratuito do Render tem pouca CPU/RAM e "dorme" por inatividade; o modo "Corte preciso"
exige mais CPU. Os clipes ficam em `/tmp/clipr` (disco efêmero) e são apagados após 30 minutos.

## Rodar com Docker localmente
```bash
docker build -t clipr .
docker run -p 3000:3000 clipr                 # PORT padrão 3000
docker run -e PORT=8080 -p 8080:8080 clipr    # PORT customizada
curl http://localhost:3000/healthz            # {"ok":true}
```
