/**
 * Cookie-free TikTok downloads via the free tikwm API.
 *
 * TikTok aggressively blocks datacenter IPs, so yt-dlp alone can't fetch
 * from servers. tikwm resolves a TikTok link to a direct (signed, short-lived)
 * MP4 URL with no login. We always fetch a FRESH url at download time because
 * the signatures expire within minutes.
 */
import { createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import type { Job, QualityKey, VideoInfo } from "./ytdlp";

const TIKWM_API = "https://www.tikwm.com/api/?url=";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export function isTikTokUrl(url: string): boolean {
  try {
    return /(^|\.)(tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)$/i.test(
      new URL(url).hostname
    );
  } catch {
    return false;
  }
}

async function tikwmLookup(url: string): Promise<any> {
  const res = await fetch(TIKWM_API + encodeURIComponent(url), {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`TikTok service error (${res.status})`);
  const j: any = await res.json();
  if (j.code !== 0 || !j.data?.play)
    throw new Error(j.msg || "TikTok lookup failed");
  return j.data;
}

function safeName(title: string): string {
  return (
    String(title || "tiktok-video")
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "tiktok-video"
  );
}

export async function getTikTokInfo(url: string): Promise<VideoInfo> {
  const d = await tikwmLookup(url);
  const sizes: Partial<Record<QualityKey, number>> = {};
  if (typeof d.size === "number" && d.size > 0) sizes.best = d.size;
  return {
    title: String(d.title || "TikTok video"),
    uploader:
      d.author?.nickname || d.author?.unique_id || null,
    duration: typeof d.duration === "number" ? d.duration : null,
    thumbnail: d.cover || d.origin_cover || null,
    webpageUrl: url,
    sizes,
    qualities: ["best", "audio"],
  };
}

/** Download the TikTok video (or its audio) straight to the job dir. */
export async function downloadTikTokDirect(
  job: Job,
  url: string,
  quality: QualityKey
): Promise<void> {
  const d = await tikwmLookup(url); // fresh signed URL
  const name = safeName(d.title);
  const isAudio = quality === "audio";
  const videoPath = path.join(job.dir, `${name}.mp4`);

  await streamToFile(d.play, videoPath, (done, total) => {
    if (total > 0) job.progress = Math.min(96, (done / total) * 100);
    else job.progress = Math.min(96, job.progress + 1);
  });

  if (isAudio) {
    const outPath = path.join(job.dir, `${name}.mp3`);
    await extractAudio(videoPath, outPath);
    await fs.unlink(videoPath).catch(() => {});
  }
}

async function streamToFile(
  fileUrl: string,
  dest: string,
  onProgress: (done: number, total: number) => void
): Promise<void> {
  const res = await fetch(fileUrl, {
    headers: { "User-Agent": UA, Referer: "https://www.tiktok.com/" },
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!res.ok || !res.body)
    throw new Error(`Video download failed (${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  const ws = createWriteStream(dest);
  let done = 0;
  try {
    for await (const chunk of res.body as any) {
      const len = chunk.byteLength ?? chunk.length ?? 0;
      done += len;
      if (!ws.write(chunk)) await once(ws, "drain");
      onProgress(done, total);
    }
  } finally {
    ws.end();
  }
  await once(ws, "finish");
  const stat = await fs.stat(dest).catch(() => null);
  if (!stat || stat.size < 1024)
    throw new Error("Downloaded file looks empty — try again.");
}

function extractAudio(inPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      ["-y", "-v", "error", "-i", inPath, "-vn", "-acodec", "libmp3lame", "-q:a", "4", outPath],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error("Audio extraction failed"))
    );
    child.on("error", () => reject(new Error("Audio engine not available")));
  });
}
