"use client";

import { useEffect, useRef, useState } from "react";

interface VideoInfo {
  title: string;
  uploader: string | null;
  duration: number | null;
  thumbnail: string | null;
  webpageUrl: string;
  limited?: boolean;
  sizes?: Partial<Record<QualityKey, number>>;
}

type QualityKey = "best" | "q1080" | "q720" | "q480" | "audio";

const FAST_ROWS: { key: QualityKey; label: string }[] = [
  { key: "q480", label: "480p MP4" },
  { key: "audio", label: "Audio MP3" },
];

const HD_ROWS: { key: QualityKey; label: string }[] = [
  { key: "best", label: "Best quality MP4" },
  { key: "q1080", label: "1080p MP4" },
  { key: "q720", label: "720p MP4" },
];

const LIMITED_MSG =
  "YouTube is restricting this network, so quality is capped at 360p here. For full quality, enable Private mode and paste your YouTube login cookies.";

const PLATFORMS = [
  { name: "YouTube", color: "#ff4d4d" },
  { name: "Facebook", color: "#4d8dff" },
  { name: "X", color: "#94a3b8" },
  { name: "TikTok", color: "#0d9488" },
];

function formatDuration(s: number | null): string {
  if (s === null || s === undefined) return "";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const h = Math.floor(m / 60);
  if (h > 0)
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(sec).padStart(
      2,
      "0"
    )}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function fmtSize(bytes?: number): string {
  if (!bytes) return "";
  const mb = bytes / 1048576;
  return mb >= 1024 ? `~${(mb / 1024).toFixed(1)} GB` : `~${Math.max(1, Math.round(mb))} MB`;
}

function detectPlatform(url: string): string | null {
  const u = url.toLowerCase();
  if (u.includes("youtu")) return "YouTube";
  if (u.includes("facebook") || u.includes("fb.watch")) return "Facebook";
  if (u.includes("x.com") || u.includes("twitter")) return "X";
  if (u.includes("tiktok")) return "TikTok";
  return null;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [privateMode, setPrivateMode] = useState(false);
  const [cookies, setCookies] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [dlQuality, setDlQuality] = useState<QualityKey | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => () => esRef.current?.close(), []);

  const platform = detectPlatform(url);

  async function fetchInfo(target?: string) {
    const link = (target ?? url).trim();
    setError("");
    setNote("");
    setInfo(null);
    setDone(false);
    setProgress(null);
    setDlQuality(null);
    esRef.current?.close();
    if (!link) {
      setError("Paste a video link first.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: link,
          cookies: privateMode ? cookies : "",
        }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Failed to fetch video info.");
      setInfo(j.info);
      if (j.info.limited) setNote(LIMITED_MSG);
    } catch (e: any) {
      setError(e.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (text && text.trim()) {
      setUrl(text.trim());
      fetchInfo(text.trim());
    }
  }

  async function pasteFromClipboard() {
    try {
      const t = await navigator.clipboard.readText();
      if (t && t.trim()) {
        setUrl(t.trim());
        fetchInfo(t.trim());
        return;
      }
    } catch {
      /* clipboard blocked — fall through to focus */
    }
    inputRef.current?.focus();
  }

  function startDownload(q: QualityKey) {
    if (!info) return;
    setError("");
    setDone(false);
    setProgress(0);
    setDlQuality(q);
    esRef.current?.close();
    fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: url.trim(),
        quality: q,
        cookies: privateMode ? cookies : "",
      }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error || "Failed to start download.");
        const es = new EventSource(`/api/jobs/${j.jobId}/events`);
        esRef.current = es;
        es.onmessage = (ev) => {
          const d = JSON.parse(ev.data);
          if (typeof d.progress === "number") setProgress(d.progress);
          if (d.note) setNote(d.note);
          if (d.status === "done") {
            es.close();
            setProgress(100);
            setDone(true);
            window.location.href = `/api/jobs/${j.jobId}/file`;
          } else if (d.status === "error") {
            es.close();
            setProgress(null);
            setDlQuality(null);
            setError(d.error || "Download failed.");
          }
        };
        es.onerror = () => {
          es.close();
          setProgress(null);
          setDlQuality(null);
          setError("Lost connection to the download. Please try again.");
        };
      })
      .catch((e: any) => {
        setProgress(null);
        setDlQuality(null);
        setError(e.message || "Something went wrong.");
      });
  }

  const downloading = progress !== null && !done;

  function qualityRow(
    q: { key: QualityKey; label: string },
    tone: "fast" | "hd"
  ) {
    const active = dlQuality === q.key && downloading;
    const size = fmtSize(info?.sizes?.[q.key]);
    return (
      <div key={q.key} className={`qrow ${tone}`}>
        <div className="qrow-info">
          <b>{q.label}</b>
          {size && <span>{size}</span>}
        </div>
        <button
          className="dl-btn"
          onClick={() => startDownload(q.key)}
          disabled={downloading}
        >
          {active ? (
            <>
              <span className="spinner" /> {progress}%
            </>
          ) : (
            "⬇ Download"
          )}
        </button>
      </div>
    );
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark">⬇</span> VidFetch
          </div>
          <span className="free-pill">100% Free</span>
        </div>
      </header>

      <div className="wrap">
        {/* HERO */}
        <section className="hero">
          <h1>Video Downloader</h1>
          <p className="tagline">Free. No signup. Download now.</p>
          <p className="tagline-sub">
            YouTube, Facebook, X and TikTok — long videos &amp; reels
          </p>

          <div className="fused">
            <input
              ref={inputRef}
              type="text"
              placeholder="Paste your link here..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => e.key === "Enter" && fetchInfo()}
            />
            <button className="paste-chip" onClick={pasteFromClipboard}>
              📋 Paste
            </button>
            <button
              className="go-btn"
              onClick={() => fetchInfo()}
              disabled={busy}
            >
              {busy ? (
                <>
                  <span className="spinner dark" /> Loading…
                </>
              ) : (
                "Download"
              )}
            </button>
          </div>

          <div className="platforms">
            {PLATFORMS.map((p) => (
              <span key={p.name} className="chip">
                <span className="dot" style={{ background: p.color }} />
                {p.name}
              </span>
            ))}
            {platform && <span className="chip">✓ {platform} detected</span>}
          </div>

          <p className="disclaimer">
            Copyrighted content is not available for download with this tool.
          </p>

          <div>
            <label className="private-toggle">
              <input
                type="checkbox"
                checked={privateMode}
                onChange={(e) => setPrivateMode(e.target.checked)}
              />
              🔒 Private / group video mode (needs your login cookies)
            </label>
          </div>

          {privateMode && (
            <div className="private-box">
              <p>
                Private videos download through <b>your own session</b> —
                paste your login cookies below. Used for this one download
                only, then deleted. Nothing is stored.
              </p>
              <textarea
                placeholder="Paste your cookies here (Netscape cookies.txt format)…"
                value={cookies}
                onChange={(e) => setCookies(e.target.value)}
                spellCheck={false}
              />
              <details className="howto">
                <summary>How do I get my cookies?</summary>
                <ol>
                  <li>
                    Install the free <b>“Get cookies.txt LOCALLY”</b> browser
                    extension (Chrome / Edge / Firefox).
                  </li>
                  <li>
                    Log in to <b>facebook.com</b> (or <b>youtube.com</b>) and
                    open the video page.
                  </li>
                  <li>
                    Click the extension icon → <b>Export</b> → copy everything.
                  </li>
                  <li>Paste it above, then press Download.</li>
                </ol>
              </details>
            </div>
          )}

          {error && <div className="error">⚠️ {error}</div>}
        </section>

        {/* RESULT */}
        {info && (
          <section className="card">
            <div className="result-head">
              {info.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="thumb"
                  src={info.thumbnail}
                  alt="Video thumbnail"
                />
              )}
              <div>
                <h3>{info.title}</h3>
                <div className="meta">
                  {[info.uploader, formatDuration(info.duration)]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
            </div>

            {note && <div className="note">⚠️ {note}</div>}

            <h3 className="sect">Fast Download</h3>
            {FAST_ROWS.map((q) => qualityRow(q, "fast"))}

            <h3 className="sect">HD Downloads</h3>
            {HD_ROWS.map((q) => qualityRow(q, "hd"))}

            {downloading && (
              <div className="bar">
                <div style={{ width: `${progress}%` }} />
              </div>
            )}
            {done && (
              <div className="done-note">
                ✅ Done! Your file should be saving now — check your downloads
                folder.
              </div>
            )}
          </section>
        )}

        {/* HOW TO */}
        <section className="section">
          <h2>How to Download Videos?</h2>
          <p className="sub">Get any video in 3 simple steps</p>
          <div className="steps">
            <div className="step">
              <span className="num">1</span>
              <b>Copy the link</b>
              <span>
                Open the video on YouTube, Facebook, X or TikTok and copy its
                link.
              </span>
            </div>
            <div className="step">
              <span className="num">2</span>
              <b>Paste the link</b>
              <span>
                Paste it into the box above — or hit the Paste button and it
                loads automatically.
              </span>
            </div>
            <div className="step">
              <span className="num">3</span>
              <b>Download the video</b>
              <span>
                Pick a quality and hit Download. The file saves straight to
                your device.
              </span>
            </div>
          </div>
        </section>

        {/* WHY */}
        <section className="section">
          <h2 className="red">Why Use VidFetch?</h2>
          <p className="sub">One downloader for everything you watch</p>
          <div className="grid">
            <div className="feat">
              <span className="tile">🎬</span>
              <b>Long videos</b>
              <span>
                Full-length videos from YouTube, Facebook, X and TikTok.
              </span>
            </div>
            <div className="feat">
              <span className="tile">📱</span>
              <b>Reels &amp; Shorts</b>
              <span>
                Short clips and reels download just as easily as long videos.
              </span>
            </div>
            <div className="feat">
              <span className="tile">🎞️</span>
              <b>HD quality</b>
              <span>
                Up to 1080p Full HD video, plus best-quality options.
              </span>
            </div>
            <div className="feat">
              <span className="tile">⚡</span>
              <b>Fast downloading</b>
              <span>
                Paste, pick, download — no waiting rooms, no countdowns.
              </span>
            </div>
            <div className="feat">
              <span className="tile">🔒</span>
              <b>Private videos</b>
              <span>
                Members-only Facebook groups and private videos via your own
                login cookies.
              </span>
            </div>
            <div className="feat">
              <span className="tile">📲</span>
              <b>Phone &amp; PC</b>
              <span>
                Works on Android, iPhone and desktop — nothing to install.
              </span>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="section faq">
          <h2 className="red">Frequently Asked Questions</h2>
          <p className="sub">Everything you need to know</p>
          <details open>
            <summary>
              Is VidFetch really free? <span className="pm" />
            </summary>
            <p>
              Yes — 100% free, no signup, no credits, no watermarks. Just paste
              a link and download. Private Facebook videos are the only case
              that needs your own login cookies.
            </p>
          </details>
          <details>
            <summary>
              Which sites are supported? <span className="pm" />
            </summary>
            <p>
              YouTube (videos &amp; Shorts), Facebook (videos, reels, private
              &amp; group videos), X (Twitter) videos, and TikTok videos.
            </p>
          </details>
          <details>
            <summary>
              How do private / group Facebook videos work?{" "}
              <span className="pm" />
            </summary>
            <p>
              Turn on Private mode and paste your Facebook login cookies (see
              the how-to above). The download runs through your own session,
              so it can fetch anything you&apos;re already able to watch.
              Only download videos you have the right to save.
            </p>
          </details>
          <details>
            <summary>
              Can I download as MP3? <span className="pm" />
            </summary>
            <p>
              Yes — choose the “Audio MP3” row under Fast Download and
              you&apos;ll get just the audio track.
            </p>
          </details>
          <details>
            <summary>
              Is it safe to use? <span className="pm" />
            </summary>
            <p>
              Yes. Downloads are processed on the server and streamed straight
              to your browser. Cookies live only in a temporary file for one
              download and are deleted immediately after; files auto-delete
              after 30 minutes.
            </p>
          </details>
        </section>

        <footer>
          <b>VidFetch</b> — Free Video Downloader
          <br />
          Only download videos you own or have permission to save. Respect
          creators&apos; rights and each platform&apos;s terms of service.
          <br />© 2026 VidFetch · Free forever, no signup.
        </footer>
      </div>
    </>
  );
}
