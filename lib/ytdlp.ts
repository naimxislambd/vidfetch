import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const YTDLP = process.env.YTDLP_BIN || "yt-dlp";

// Only these platforms are supported. This also protects the server from
// being used as an arbitrary-URL fetcher (SSRF).
const ALLOWED_HOSTS =
  /(^|\.)(youtube\.com|youtu\.be|facebook\.com|fb\.watch|fb\.com|m\.facebook\.com|x\.com|twitter\.com|tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)$/i;

export function validateUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim())
    throw new Error("Please paste a video link first.");
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("That doesn't look like a valid link.");
  }
  if (!/^https?:$/.test(u.protocol))
    throw new Error("Link must start with http:// or https://");
  if (!ALLOWED_HOSTS.test(u.hostname))
    throw new Error("Only YouTube, Facebook, X and TikTok links are supported.");
  return u.toString();
}

export type QualityKey = "best" | "q1080" | "q720" | "q480" | "audio";

export const QUALITY_LABELS: Record<QualityKey, string> = {
  best: "Best quality",
  q1080: "1080p Full HD",
  q720: "720p HD",
  q480: "480p",
  audio: "MP3 audio only",
};

// Server-side map only — the client sends a key, never a raw format string.
const QUALITY_ARGS: Record<QualityKey, string[]> = {
  best: ["-f", "bv*+ba/b", "--merge-output-format", "mp4"],
  q1080: ["-f", "bv*[height<=1080]+ba/b[height<=1080]", "--merge-output-format", "mp4"],
  q720: ["-f", "bv*[height<=720]+ba/b[height<=720]", "--merge-output-format", "mp4"],
  q480: ["-f", "bv*[height<=480]+ba/b[height<=480]", "--merge-output-format", "mp4"],
  audio: ["-f", "ba/b", "--extract-audio", "--audio-format", "mp3"],
};

export interface VideoInfo {
  title: string;
  uploader: string | null;
  duration: number | null;
  thumbnail: string | null;
  webpageUrl: string;
  /** true when YouTube bot-checks forced the limited (360p) fallback client */
  limited?: boolean;
}

function isYouTube(url: string): boolean {
  try {
    return /(^|\.)(youtube\.com|youtu\.be)$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

// YouTube's "sign in to confirm you're not a bot" blocks datacenter IPs.
// The android player client usually still works there, but only serves
// ~360p. We try the full client chain first, then fall back to it.
const YT_BOT_RE = /not a bot|sign in|confirm/i;
const YT_FALLBACK_ARGS = ["--extractor-args", "youtube:player_client=android"];

export const LIMITED_QUALITY_NOTE =
  "YouTube is restricting this network, so quality is capped at 360p here. For full quality, enable Private mode and paste your YouTube login cookies.";

/**
 * Site-owner cookies (a spare/burner account) from the SITE_YOUTUBE_COOKIES
 * env var, used as a fallback so visitors can download YouTube links without
 * pasting their own cookies. Only ever applies to YouTube — never to
 * Facebook/X/TikTok, where the visitor's own session is what matters
 * (private videos must always use the visitor's own cookies).
 * Precedence: visitor cookies > site cookies > none.
 */
export function siteCookiesFor(
  url: string,
  visitorCookies?: string
): string | undefined {
  if (visitorCookies && visitorCookies.trim()) return visitorCookies;
  const site = process.env.SITE_YOUTUBE_COOKIES;
  if (site && site.trim() && isYouTube(url)) return site;
  return undefined;
}

function stderrTail(stderr: string): string {
  const errs = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /ERROR/i.test(l));
  return errs.slice(-3).join(" ") || "yt-dlp failed";
}

/** Turn raw yt-dlp errors into human-friendly messages (no internals leak). */
export function friendlyError(raw: string): string {
  const m = raw.toLowerCase();
  if (/spawn failed|not found|enoent/.test(m))
    return "The video engine (yt-dlp) is not installed on the server.";
  if (/private video|login|log in|sign in|cookies|confirm you're not a bot|bot/.test(m))
    return "This video needs login. Turn on Private mode, paste your login cookies, and try again.";
  if (/unavailable|removed|deleted|404|not available/.test(m))
    return "This video is unavailable, removed, or the link is wrong.";
  if (/unsupported url|not supported/.test(m))
    return "This link isn't supported. Paste a direct video, reel or Shorts URL.";
  if (/timed out|timeout/.test(m))
    return "The site took too long to respond. Please try again.";
  if (/rate-limit|too many requests/.test(m))
    return "The platform is rate-limiting downloads right now. Wait a bit and retry.";
  return "Couldn't fetch this video. Check the link and try again.";
}

function runYtDlp(
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(YTDLP, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d.toString();
      if (stdout.length > 4_000_000) child.kill("SIGKILL");
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 500_000) stderr = stderr.slice(-500_000);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + "\n[spawn failed: yt-dlp not found]", code: 1 });
    });
  });
}

/** Write pasted Netscape-format cookies to a temp file. Caller must delete it. */
export async function writeCookies(text: string): Promise<string> {
  const p = path.join(
    os.tmpdir(),
    `vidfetch-cookies-${crypto.randomBytes(8).toString("hex")}.txt`
  );
  const body = text.trim().endsWith("\n") ? text.trim() : text.trim() + "\n";
  await fs.writeFile(p, body, "utf8");
  return p;
}

export async function getVideoInfo(
  url: string,
  cookieFile?: string
): Promise<VideoInfo> {
  const base = [
    "--no-playlist",
    "--no-warnings",
    "--socket-timeout",
    "20",
    "--retries",
    "2",
    "--dump-single-json",
  ];
  // Attempt 1: default client chain (full quality). Attempt 2 (YouTube only):
  // android client fallback when bot-checks block the datacenter IP.
  const attempts: string[][] = isYouTube(url) ? [[], YT_FALLBACK_ARGS] : [[]];
  let lastErr = "yt-dlp failed";
  for (let i = 0; i < attempts.length; i++) {
    const args = [...base, ...attempts[i]];
    if (cookieFile) args.push("--cookies", cookieFile);
    args.push(url);
    const { stdout, code, stderr } = await runYtDlp(args, 60_000);
    if (code === 0) {
      let j: any;
      try {
        j = JSON.parse(stdout);
      } catch {
        throw new Error("Could not read video info for this link.");
      }
      return {
        title: String(j.title || "Untitled video"),
        uploader: j.uploader || j.channel || null,
        duration: typeof j.duration === "number" ? j.duration : null,
        thumbnail: j.thumbnail || null,
        webpageUrl: j.webpage_url || url,
        limited: i > 0,
      };
    }
    lastErr = stderrTail(stderr);
    // Only retry with the fallback client on YouTube bot-check failures.
    if (!(i === 0 && isYouTube(url) && YT_BOT_RE.test(lastErr))) break;
  }
  throw new Error(friendlyError(lastErr));
}

// ---------------------------------------------------------------------------
// Download jobs (in-memory; suited to a single long-running server / container)
// ---------------------------------------------------------------------------

export type JobStatus = "running" | "done" | "error";

export interface Job {
  id: string;
  status: JobStatus;
  progress: number; // 0..100
  title: string;
  quality: QualityKey;
  dir: string;
  filename: string | null;
  filepath: string | null;
  error: string | null;
  note: string | null;
  createdAt: number;
}

const jobs = new Map<string, Job>();

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function createJob(
  url: string,
  quality: QualityKey,
  cookiesText?: string
): Job {
  const id = crypto.randomBytes(10).toString("hex");
  const dir = path.join(os.tmpdir(), `vidfetch-${id}`);
  const job: Job = {
    id,
    status: "running",
    progress: 0,
    title: "video",
    quality,
    dir,
    filename: null,
    filepath: null,
    error: null,
    note: null,
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  void runJob(job, url, quality, cookiesText);
  // Auto-cleanup after 30 minutes no matter what.
  setTimeout(() => void cleanupJob(id), 30 * 60 * 1000).unref?.();
  return job;
}

async function runJob(
  job: Job,
  url: string,
  quality: QualityKey,
  cookiesText?: string
): Promise<void> {
  let cookieFile: string | undefined;
  try {
    await fs.mkdir(job.dir, { recursive: true });
    if (cookiesText && cookiesText.trim())
      cookieFile = await writeCookies(cookiesText);

    const baseArgs = [
      "--no-playlist",
      "--no-warnings",
      "--socket-timeout",
      "30",
      "--retries",
      "3",
      "--newline",
      "--progress",
      "--progress-template",
      "%(progress._percent_str)s",
      ...QUALITY_ARGS[quality],
      "-o",
      path.join(job.dir, "%(title).80s-%(id)s.%(ext)s"),
    ];
    if (cookieFile) baseArgs.push("--cookies", cookieFile);
    baseArgs.push(url);

    // Attempt 1: default client chain (full quality). Attempt 2 (YouTube
    // bot-check only): android client fallback (~360p cap).
    const attempts: string[][] = isYouTube(url) ? [[], YT_FALLBACK_ARGS] : [[]];
    let lastErr = "Download failed.";
    let downloaded = false;
    for (let i = 0; i < attempts.length && !downloaded; i++) {
      const extra = attempts[i];
      const args =
        extra.length === 0
          ? baseArgs
          : [...baseArgs.slice(0, -1), ...extra, baseArgs[baseArgs.length - 1]];
      const outcome = await spawnDownload(job, args);
      if (outcome.ok) {
        downloaded = true;
        if (i > 0) job.note = LIMITED_QUALITY_NOTE;
      } else {
        lastErr = outcome.error;
        if (!(i === 0 && isYouTube(url) && YT_BOT_RE.test(lastErr))) break;
      }
    }
    if (!downloaded) throw new Error(lastErr);

    const files = (await fs.readdir(job.dir)).filter((f) => !f.startsWith("."));
    if (!files.length)
      throw new Error("Download finished but no file was created.");
    let best = files[0];
    let bestSize = -1;
    for (const f of files) {
      const s = (await fs.stat(path.join(job.dir, f))).size;
      if (s > bestSize) {
        bestSize = s;
        best = f;
      }
    }
    job.filepath = path.join(job.dir, best);
    job.filename = best;
    job.title = best.replace(/\.[^.]+$/, "");
    job.progress = 100;
    job.status = "done";
  } catch (e: any) {
    job.status = "error";
    job.error = friendlyError(e?.message || "failed");
  } finally {
    // Cookies live only for the duration of this download.
    if (cookieFile) await fs.unlink(cookieFile).catch(() => {});
  }
}

/** Spawn one yt-dlp download attempt, tracking progress on the job. */
function spawnDownload(
  job: Job,
  args: string[]
): Promise<{ ok: boolean; error: string }> {
  return new Promise((resolve) => {
    const child = spawn(YTDLP, args, { stdio: ["ignore", "pipe", "pipe"] });
    let errBuf = "";
    // yt-dlp prints progress to stderr, so parse it there.
    child.stderr.on("data", (d: Buffer) => {
      const chunk = d.toString();
      errBuf = (errBuf + chunk).slice(-20000);
      const m = chunk.match(/([\d.]+)%/);
      if (m) {
        const pct = parseFloat(m[1]);
        if (!Number.isNaN(pct))
          job.progress = Math.min(99, Math.max(job.progress, pct));
      }
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15 * 60 * 1000);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true, error: "" });
      else resolve({ ok: false, error: stderrTail(errBuf) });
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, error: "spawn failed: yt-dlp not found" });
    });
  });
}

async function cleanupJob(id: string): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  await fs.rm(job.dir, { recursive: true, force: true }).catch(() => {});
}
