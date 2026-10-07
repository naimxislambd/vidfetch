# VidFetch — Free Video & Reels Downloader

A free, no-signup web app to download long videos and reels from
**YouTube, Facebook, X and TikTok** — including **private and group Facebook
videos** (via your own login cookies).

Built with **Next.js + TypeScript**, powered by **yt-dlp** + **ffmpeg** on the
server. 100% free, no accounts, no credits, no watermarks.

## Features

- 🎬 Long videos + 📱 reels / Shorts / TikTok clips
- 🔒 Private & group Facebook videos (cookie-based, your own session)
- 🎵 MP3 audio extraction
- Quality picker: Best / 1080p / 720p / 480p / MP3
- Live download progress bar (SSE)
- Cookies kept only in a temp file for one download, then deleted
- Files auto-delete from the server after 30 minutes

## Quick start (local)

Requirements: **Node 20+**, **Python 3**, **ffmpeg**, **yt-dlp**.

```bash
# 1. Install the video engine
pip install yt-dlp            # or: pip3 install --user yt-dlp

# 2. Install & run the app
cd video-downloader
npm install
npm run dev                   # → http://localhost:3000

# Production
npm run build && npm start
```

If `yt-dlp` isn't on your PATH, point the app at it:

```bash
YTDLP_BIN=/full/path/to/yt-dlp npm run dev
```

## Deploy with Docker

```bash
docker build -t vidfetch .
docker run -p 3000:3000 vidfetch
```

The image bundles Node, Python, ffmpeg and yt-dlp. It also works on
Railway / Render / any VPS: just deploy the Dockerfile and expose port 3000.

> Note: download jobs live in server memory, so deploy as **one**
> long-running instance (not serverless / multi-replica).

## Downloading private / group Facebook videos

1. Install the free **"Get cookies.txt LOCALLY"** browser extension.
2. Log in to facebook.com, open the video page.
3. Click the extension → **Export** → copy everything.
4. On VidFetch, enable **🔒 Private mode**, paste the cookies, press Fetch.

The download runs through *your* session, so you can only fetch videos you
can already watch. Only download videos you have the right to save.

Same trick fixes YouTube's *"sign in to confirm you're not a bot"* error —
export cookies while logged into YouTube and paste them in Private mode.

## Cookie-free YouTube for visitors (optional, recommended)

YouTube blocks datacenter IPs, so visitors would otherwise hit login walls.
You can give the server its own YouTube session — then visitors just paste
links and everything works:

1. Create a **spare Google account** (do NOT use your main account).
2. Log into YouTube with it in your browser.
3. Export its cookies with the **"Get cookies.txt LOCALLY"** extension.
4. In Render: open your `vidfetch` service → **Environment** → add variable
   `SITE_YOUTUBE_COOKIES` → paste the cookies → **Save** (this redeploys).
5. Done — the server now uses that session as a fallback whenever a visitor
   pastes a YouTube link without their own cookies.

Honest trade-offs, read before doing this:

- YouTube may **rate-limit or ban** the spare account if the site gets busy.
  It's a burner — that's the point.
- Cookies **expire** (typically every few months). When YouTube downloads
  start failing again, re-export and update the variable.
- This is **against YouTube's Terms of Service**. Fine for personal/low-key
  use; don't be surprised if Google fights back.
- Never paste these cookies into any chat or public place — only into
  Render's Environment settings, which are encrypted.
- Private Facebook videos ALWAYS need each visitor's own cookies — the
  server session is only ever used for YouTube, never for Facebook/X/TikTok.

## API

| Endpoint | Method | Description |
|---|---|---|
| `/api/info` | POST `{url, cookies?}` | Video title, thumbnail, duration, uploader |
| `/api/jobs` | POST `{url, quality, cookies?}` | Start download → `{jobId}` |
| `/api/jobs/[id]/events` | GET (SSE) | `{status, progress, title, filename, error}` |
| `/api/jobs/[id]/file` | GET | The finished file (download) |

`quality` is one of `best | q1080 | q720 | q480 | audio`. Only YouTube,
Facebook, X and TikTok URLs are accepted (SSRF protection).

## Honest limitations

- **YouTube** aggressively blocks datacenter IPs. VidFetch automatically
  retries blocked YouTube links with a fallback client (quality capped at
  ~360p on restricted networks, with an on-screen note). For full quality,
  add your own YouTube cookies in Private mode — on a normal residential
  connection you usually won't need them at all. Optional: set the
  `SITE_YOUTUBE_COOKIES` env var (see above) so visitors never need cookies.
- **TikTok** is also IP-blocked for yt-dlp on servers, so VidFetch uses a
  free third-party lookup API as a cookie-free fallback (tried before
  yt-dlp). No login needed.
- **Private videos** always need your own cookies — there is no way to fetch
  a video you can't watch yourself, and that's intentional.
- Platforms change their front-ends often; if a site breaks, updating yt-dlp
  (`pip install -U yt-dlp`) usually fixes it.

## Legal note

Only download videos you own or have permission to save. Respect creators'
rights and each platform's terms of service. This tool is for personal,
lawful use.
