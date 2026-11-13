FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public
# PORT tem padrão 3000, mas o Render (ou qualquer host) pode sobrescrever.
ENV NODE_ENV=production PORT=3000 TRUST_PROXY=1 TMP_DIR=/tmp/clipr
RUN mkdir -p /tmp/clipr && chown -R node:node /tmp/clipr /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
