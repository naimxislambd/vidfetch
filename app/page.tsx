"use client";

import { useEffect, useRef, useState } from "react";

interface VideoInfo {
  title: string;
  uploader: string | null;
  duration: number | null;
  thumbnail: string | null;
  webpageUrl: string;
  limited?: boolean;
}

type QualityKey = "best" | "q1080" | "q720" | "q480" | "audio";

const QUALITIES: { key: QualityKey; label: string; sub: string }[] = [
  { key: "best", label: "MP4 · Best", sub: "Highest quality" },
  { key: "q1080", label: "MP4 · 1080p", sub: "Full HD" },
  { key: "q720", label: "MP4 · 720p", sub: "HD · smaller file" },
  { key: "q480", label: "MP4 · 480p", sub: "Small file" },
  { key: "audio", label: "MP3", sub: "Audio only" },
];

const LIMITED_MSG =
  "YouTube is restricting this network, so quality is capped at 360p here. For full quality, enable Private mode and paste your YouTube login cookies.";

const PLATFORMS = [
  { name: "YouTube", color: "#ff4d4d", hint: "Videos & Shorts" },
  { name: "Facebook", color: "#4d8dff", hint: "Videos, reels, private & group" },
  { name: "X", color: "#e7e9ea", hint: "Videos" },
  { name: "TikTok", color: "#25f4ee", hint: "Videos" },
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

  return (
    <div className="wrap">
      <header className="hero">
        <div className="logo">⬇️</div>
        <h1>VidFetch</h1>
        <p>
          <b>Free. No signup. Download now.</b>
          <br />
          YouTube, Facebook, X and TikTok videos &amp; reels — including
          private &amp; group Facebook videos.
        </p>
        <div className="platforms">
          {PLATFORMS.map((p) => (
            <span key={p.name} className="chip" title={p.hint}>
              <span className="dot" style={{ background: p.color }} />
              {p.name}
            </span>
          ))}
        </div>
      </header>

      {/* INPUT */}
      <section className="card">
        <div className="url-row">
          <input
            type="text"
            placeholder="Paste a video link here…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => e.key === "Enter" && fetchInfo()}
          />
          <button className="btn" onClick={() => fetchInfo()} disabled={busy}>
            {busy ? (
              <>
                <span className="spinner" /> Loading…
              </>
            ) : (
              "Download"
            )}
          </button>
        </div>
        {platform && !info && (
          <div style={{ marginTop: 10 }}>
            <span className="chip">{platform} link detected</span>
          </div>
        )}

        <label className="private-toggle">
          <input
            type="checkbox"
            checked={privateMode}
            onChange={(e) => setPrivateMode(e.target.checked)}
          />
          🔒 Private / group video mode (needs your login cookies)
        </label>

        {privateMode && (
          <div className="private-box">
            <p>
              Private videos download through <b>your own session</b> — paste
              your login cookies below. Used for this one download only, then
              deleted. Nothing is stored.
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
          <div className="result">
            {info.thumbnail && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="thumb"
                src={info.thumbnail}
                alt="Video thumbnail"
              />
            )}
            <div className="result-info">
              <h3>{info.title}</h3>
              <div className="meta">
                {[info.uploader, formatDuration(info.duration)]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {note && <div className="note">⚠️ {note}</div>}
              <div className="qualities">
                {QUALITIES.map((q) => {
                  const active = dlQuality === q.key && downloading;
                  return (
                    <button
                      key={q.key}
                      className={`qbtn ${active ? "active" : ""}`}
                      onClick={() => startDownload(q.key)}
                      disabled={downloading}
                    >
                      {active ? (
                        <>
                          <span className="spinner" /> {progress}%
                        </>
                      ) : (
                        <>⬇ {q.label}</>
                      )}
                      <small>{q.sub}</small>
                    </button>
                  );
                })}
              </div>

              {downloading && (
                <div className="progress-wrap">
                  <div className="bar">
                    <div style={{ width: `${progress}%` }} />
                  </div>
                </div>
              )}
              {done && (
                <div className="done-note">
                  ✅ Done! Your file should be saving now — check your
                  downloads folder.
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* FEATURES */}
      <section className="card">
        <h2>What you can download</h2>
        <div className="grid">
          <div className="feat">
            <div className="icon">🎬</div>
            <b>Long videos</b>
            <span>
              Full-length YouTube videos, Facebook watch videos, X &amp;
              TikTok uploads.
            </span>
          </div>
          <div className="feat">
            <div className="icon">📱</div>
            <b>Reels &amp; Shorts</b>
            <span>
              Facebook reels, YouTube Shorts, TikTok clips — paste the link,
              same flow.
            </span>
          </div>
          <div className="feat">
            <div className="icon">🔒</div>
            <b>Private &amp; group videos</b>
            <span>
              Members-only Facebook groups and private videos, via your own
              login cookies.
            </span>
          </div>
          <div className="feat">
            <div className="icon">🎵</div>
            <b>MP3 audio</b>
            <span>
              Extract just the audio from any supported video in one click.
            </span>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="card faq">
        <h2>Good to know</h2>
        <details open>
          <summary>Is it really free? Do I need an account?</summary>
          <p>
            Yes — 100% free, no signup, no credits, no watermarks. Just paste
            a link and download. Private Facebook videos are the only case
            that needs your own login cookies (Private mode above).
          </p>
        </details>
        <details>
          <summary>How do private / group Facebook videos work?</summary>
          <p>
            Turn on <b>Private mode</b> and paste your Facebook login cookies
            (see the how-to above). The download runs through your own
            session, so it can fetch anything you&apos;re already able to
            watch. Only download videos you have the right to save.
          </p>
        </details>
        <details>
          <summary>YouTube says “sign in to confirm you’re not a bot”</summary>
          <p>
            YouTube blocks many server IPs. If the site owner has added the
            server&apos;s own YouTube session, you&apos;ll never see this —
            otherwise, export your YouTube cookies while logged in (same
            “Get cookies.txt LOCALLY” extension), enable Private mode, paste
            them, and retry.
          </p>
        </details>
        <details>
          <summary>Where do my files and cookies go?</summary>
          <p>
            Downloads are processed on the server and streamed straight to
            your browser. Cookies live only in a temporary file for that one
            download and are deleted immediately after. Files auto-delete from
            the server after 30 minutes.
          </p>
        </details>
      </section>

      <footer>
        VidFetch is a personal utility. Only download videos you own or have
        permission to save — respect creators&apos; rights and each
        platform&apos;s terms of service.
        <br />© 2026 VidFetch · Free forever, no signup.
      </footer>
    </div>
  );
}
