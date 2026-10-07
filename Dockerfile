FROM node:22-bookworm-slim

# yt-dlp + ffmpeg for downloads and merging
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && pip3 install --break-system-packages --no-cache-dir yt-dlp

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000
ENV PORT=3000 NODE_ENV=production

CMD ["npm", "start"]
