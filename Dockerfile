# Qwen Showrunner — Node + FFmpeg. Pure API orchestration, no GPU required.
FROM node:22-bookworm-slim

# FFmpeg for the stitch/editor step
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
# No dependencies to install — the app is dependency-free.
COPY lib ./lib
COPY agent ./agent
COPY server.mjs ./

ENV PORT=8787
EXPOSE 8787
# QWEN_API_KEY is passed at runtime ( -e QWEN_API_KEY=... ), never baked into the image.
CMD ["node", "server.mjs"]
