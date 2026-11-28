import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Play, Pause, Volume2, VolumeX, Download, Maximize2, X, Folder, Check, ImageOff, Loader2, AlertCircle, RotateCcw } from "lucide-react";
import { revealWorkspaceFile } from "../../services/api";
import { triggerDownload } from "./filenames";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function basename(path, fallback) {
  if (!path) return fallback;
  return String(path).split("/").pop().split("\\").pop().split("?")[0] || fallback;
}

function useRevealFile(path) {
  const [state, setState] = useState("idle");
  const reveal = useCallback(async () => {
    setState("busy");
    try {
      const res = await revealWorkspaceFile(path);
      setState(res && res.ok ? "done" : "error");
    } catch (_) {
      setState("error");
    }
    setTimeout(() => setState("idle"), 2200);
  }, [path]);
  return [state, reveal];
}

function RevealButton({ path }) {
  const [state, reveal] = useRevealFile(path);
  return (
    <button
      type="button"
      className={`abyx-media-btn${state === "done" ? " is-success" : ""}${state === "error" ? " is-error" : ""}`}
      onClick={reveal}
      disabled={state === "busy"}
      aria-label={state === "error" ? "Could not reveal file" : "Reveal in workspace"}
      data-tooltip={state === "error" ? "Could not reveal file" : "Reveal in workspace"}
    >
      {state === "busy" ? <Loader2 size={14} className="abyx-spin" /> : state === "done" ? <Check size={14} /> : state === "error" ? <AlertCircle size={14} /> : <Folder size={14} />}
    </button>
  );
}

/* ─── Audio ───────────────────────────────────────────────────── */

export const AudioPlayer = memo(function AudioPlayer({ src, filename, duration: declaredDuration, text }) {
  const audioRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(() => Number.parseFloat(declaredDuration) || 0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const name = basename(filename || src, "speech.wav");

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const onMeta = () => {
      if (Number.isFinite(audio.duration)) setDuration(audio.duration);
      setStatus("ready");
    };
    const onTime = () => setCurrent(audio.currentTime);
    const onProgress = () => {
      if (audio.buffered.length && Number.isFinite(audio.duration) && audio.duration > 0) {
        setBuffered(audio.buffered.end(audio.buffered.length - 1) / audio.duration);
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => { setPlaying(false); setCurrent(0); };
    const onWaiting = () => setStatus((s) => (s === "error" ? s : "buffering"));
    const onCanPlay = () => setStatus((s) => (s === "error" ? s : "ready"));
    const onError = () => { setStatus("error"); setPlaying(false); };
    const events = { loadedmetadata: onMeta, timeupdate: onTime, progress: onProgress, play: onPlay, pause: onPause, ended: onEnded, waiting: onWaiting, canplay: onCanPlay, error: onError };
    for (const [evt, fn] of Object.entries(events)) audio.addEventListener(evt, fn);
    return () => {
      for (const [evt, fn] of Object.entries(events)) audio.removeEventListener(evt, fn);
      audio.pause();
    };
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = muted;
    audio.playbackRate = speed;
  }, [volume, muted, speed]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || status === "error") return;
    if (audio.paused) {
      // Only one ABYX player at a time
      document.querySelectorAll("audio[data-abyx-player]").forEach((el) => { if (el !== audio) el.pause(); });
      audio.play().catch(() => setStatus("error"));
    } else {
      audio.pause();
    }
  }, [status]);

  const retry = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setStatus("loading");
    audio.load();
  }, []);

  const seek = (event) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    audio.currentTime = Number(event.target.value);
    setCurrent(audio.currentTime);
  };

  const onKeyDown = (event) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (event.key === " " || event.key === "k") { event.preventDefault(); toggle(); }
  };

  const cycleSpeed = () => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length]);
  const progress = duration ? Math.min(100, (current / duration) * 100) : 0;

  return (
    <div className={`abyx-audio is-${status}${playing ? " is-playing" : ""}`} role="group" aria-label={`Audio: ${name}`} onKeyDown={onKeyDown}>
      <audio ref={audioRef} src={src} preload="metadata" data-abyx-player="" />
      <button
        type="button"
        className="abyx-audio-play"
        onClick={status === "error" ? retry : toggle}
        aria-label={status === "error" ? "Retry loading audio" : playing ? "Pause" : "Play"}
      >
        {status === "error" ? <RotateCcw size={16} /> : status === "loading" || (status === "buffering" && playing) ? <Loader2 size={16} className="abyx-spin" /> : playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" style={{ marginLeft: 2 }} />}
      </button>

      <div className="abyx-audio-main">
        <div className="abyx-audio-top">
          <span className="abyx-audio-name" title={name}>{name}</span>
          <span className="abyx-audio-time" aria-live="off">
            {status === "error" ? "Couldn't load audio" : `${formatTime(current)} / ${formatTime(duration)}`}
          </span>
        </div>
        <div className="abyx-audio-track" style={{ "--progress": `${progress}%`, "--buffered": `${buffered * 100}%` }}>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.01}
            value={Math.min(current, duration || 0)}
            onChange={seek}
            disabled={!duration || status === "error"}
            aria-label="Seek"
            aria-valuetext={`${formatTime(current)} of ${formatTime(duration)}`}
          />
        </div>
        {text && <p className="abyx-audio-text">{text}</p>}
      </div>

      <div className="abyx-audio-tools">
        <button type="button" className="abyx-media-btn abyx-audio-speed" onClick={cycleSpeed} aria-label={`Playback speed ${speed}x`} data-tooltip="Playback speed">
          {speed}x
        </button>
        <div className="abyx-audio-volume">
          <button type="button" className="abyx-media-btn" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"} data-tooltip={muted ? "Unmute" : "Mute"}>
            {muted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => { setVolume(Number(e.target.value)); setMuted(false); }}
            aria-label="Volume"
            className="abyx-audio-volume-range"
          />
        </div>
        <button type="button" className="abyx-media-btn" onClick={() => triggerDownload(src, name)} aria-label={`Download ${name}`} data-tooltip="Download">
          <Download size={14} />
        </button>
      </div>
    </div>
  );
});

/* ─── Images ──────────────────────────────────────────────────── */

function resolveImageSrc(src, filename) {
  if (src && (/^(?:https?:|data:|blob:)/.test(src) || src.startsWith("/"))) return src;
  return `/api/output-file?filename=${encodeURIComponent(filename)}`;
}

export function ImageLightbox({ src, alt, filename, onClose }) {
  const closeRef = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div className="abyx-lightbox" role="dialog" aria-modal="true" aria-label={alt || "Image preview"} onClick={onClose}>
      <div className="abyx-lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="abyx-lightbox-title">{alt || filename}</span>
        <div className="abyx-lightbox-actions">
          <button type="button" className="abyx-lightbox-btn" onClick={() => triggerDownload(src, filename)}>
            <Download size={15} aria-hidden="true" />
            <span>Save</span>
          </button>
          <button ref={closeRef} type="button" className="abyx-lightbox-btn is-icon" onClick={onClose} aria-label="Close preview">
            <X size={16} />
          </button>
        </div>
      </div>
      <img className="abyx-lightbox-img" src={src} alt={alt || ""} onClick={(e) => e.stopPropagation()} />
    </div>,
    document.body
  );
}

export const ImageCard = memo(function ImageCard({ src, alt, filename }) {
  const name = basename(filename || src, "image.png");
  const displaySrc = resolveImageSrc(src, name);
  const [status, setStatus] = useState("loading");
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const isGenerated = displaySrc.startsWith("/api/output-file");
  const retryTimer = useRef(null);

  useEffect(() => () => clearTimeout(retryTimer.current), []);

  // Freshly generated files can lag a moment behind the reply, so retry a few times
  const onError = () => {
    if (isGenerated && attempt < 4) {
      retryTimer.current = setTimeout(() => setAttempt((a) => a + 1), 900 * (attempt + 1));
      return;
    }
    setStatus("error");
  };

  const imgSrc = attempt ? `${displaySrc}${displaySrc.includes("?") ? "&" : "?"}r=${attempt}` : displaySrc;

  return (
    <figure className={`abyx-image is-${status}`}>
      <button
        type="button"
        className="abyx-image-frame"
        onClick={() => status === "ready" && setOpen(true)}
        disabled={status !== "ready"}
        aria-label={status === "ready" ? `Expand image${alt ? `: ${alt}` : ""}` : "Image loading"}
      >
        {status === "loading" && (
          <span className="abyx-image-skeleton" aria-hidden="true">
            <Loader2 size={18} className="abyx-spin" />
            <span>{isGenerated ? "Rendering image" : "Loading image"}</span>
          </span>
        )}
        {status === "error" ? (
          <span className="abyx-image-error">
            <ImageOff size={20} aria-hidden="true" />
            <span>Image unavailable</span>
          </span>
        ) : (
          <img
            key={attempt}
            src={imgSrc}
            alt={alt || "Generated image"}
            loading="lazy"
            decoding="async"
            onLoad={() => setStatus("ready")}
            onError={onError}
          />
        )}
        {status === "ready" && (
          <span className="abyx-image-zoom" aria-hidden="true"><Maximize2 size={14} /></span>
        )}
      </button>
      <figcaption className="abyx-image-caption">
        <span className="abyx-image-alt" title={alt || name}>{alt || name}</span>
        <span className="abyx-image-actions">
          <button type="button" className="abyx-media-btn" onClick={() => triggerDownload(imgSrc, name)} disabled={status !== "ready"} aria-label={`Save ${name}`} data-tooltip="Save image">
            <Download size={14} />
          </button>
          {isGenerated && <RevealButton path={`assets/${name}`} />}
        </span>
      </figcaption>
      {open && <ImageLightbox src={imgSrc} alt={alt} filename={name} onClose={() => setOpen(false)} />}
    </figure>
  );
});

export function ImageGallery({ images }) {
  return (
    <div className={`abyx-image-gallery count-${Math.min(images.length, 4)}`}>
      {images.map((img) => <ImageCard key={img.src + img.filename} {...img} />)}
    </div>
  );
}

/* ─── Video ───────────────────────────────────────────────────── */

export const VideoPlayer = memo(function VideoPlayer({ src, title, poster }) {
  const [status, setStatus] = useState("loading");
  const name = basename(src, "video.mp4");
  return (
    <figure className={`abyx-video is-${status}`}>
      {status === "error" ? (
        <div className="abyx-image-error"><AlertCircle size={18} aria-hidden="true" /><span>Video unavailable</span></div>
      ) : (
        <video
          src={src}
          poster={poster}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={() => setStatus("ready")}
          onError={() => setStatus("error")}
          aria-label={title || name}
        />
      )}
      <figcaption className="abyx-image-caption">
        <span className="abyx-image-alt">{title || name}</span>
        <span className="abyx-image-actions">
          <button type="button" className="abyx-media-btn" onClick={() => triggerDownload(src, name)} aria-label={`Download ${name}`} data-tooltip="Download">
            <Download size={14} />
          </button>
        </span>
      </figcaption>
    </figure>
  );
});
