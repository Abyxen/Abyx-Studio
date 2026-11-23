import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Globe,
  Lock,
  ExternalLink,
  Maximize2,
  Minimize2,
  X,
  Search,
  FileCode
} from "lucide-react";
import "../styles/browser.css";

export default function InsideBrowser({
  isOpen,
  onClose,
  initialUrl = "https://www.google.com",
  activeProject = null
}) {
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [inputValue, setInputValue] = useState(initialUrl);
  const [currentTitle, setCurrentTitle] = useState("Google");
  const [isMaximized, setIsMaximized] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const iframeRef = useRef(null);

  const formatProxyUrl = (target) => {
    if (!target) return "/api/browser/proxy?url=https://www.google.com";
    if (target.startsWith("data:") || target.startsWith("blob:") || target.startsWith("html:")) return target;
    return `/api/browser/proxy?url=${encodeURIComponent(target)}`;
  };

  const isDirectHtml = currentUrl && currentUrl.startsWith("html:");
  const directHtmlContent = isDirectHtml ? (() => {
    try {
      return decodeURIComponent(currentUrl.slice(5));
    } catch (_) {
      return currentUrl.slice(5);
    }
  })() : null;

  const navigate = useCallback((rawInput) => {
    if (!rawInput) return;
    let input = rawInput.trim();
    let url = "";

    if (input.startsWith("data:") || input.startsWith("blob:") || input.startsWith("local://") || input.startsWith("html:")) {
      url = input;
    } else if (/^https?:\/\//i.test(input)) {
      url = input;
    } else if (/^[\w-]+\.[a-z]{2,}(\/.*)?$/i.test(input) || input.includes("localhost:") || input.includes("127.0.0.1:")) {
      url = "https://" + input;
    } else if (input.endsWith(".html") || input.endsWith(".htm")) {
      url = "local://" + input;
    } else {
      url = "https://www.google.com/search?q=" + encodeURIComponent(input);
    }

    setCurrentUrl(url);
    setInputValue(url.startsWith("html:") ? "local://preview.html" : url);
    try {
      if (url.startsWith("html:")) {
        setCurrentTitle("Interactive Preview");
      } else if (url.startsWith("local://")) {
        setCurrentTitle(url.replace("local://", ""));
      } else if (url.startsWith("data:")) {
        setCurrentTitle("Custom Page");
      } else {
        setCurrentTitle(new URL(url).hostname || "Web");
      }
    } catch (_) {
      setCurrentTitle("Web");
    }
  }, []);

  useEffect(() => {
    if (initialUrl && initialUrl !== currentUrl) {
      navigate(initialUrl);
    }
  }, [initialUrl, navigate]);

  // Listen to postMessage from proxy interceptor inside iframe
  useEffect(() => {
    const handleMessage = (ev) => {
      if (iframeRef.current && ev.source === iframeRef.current.contentWindow && ev.data) {
        if (ev.data.act === "browserNavigated" || ev.data.act === "browserLoaded") {
          if (ev.data.url) {
            setCurrentUrl(ev.data.url);
            setInputValue(ev.data.url);
            if (ev.data.title) setCurrentTitle(ev.data.title);
          }
        }
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  if (!isOpen) return null;

  const handleOpenExternal = () => {
    if (isDirectHtml && directHtmlContent) {
      const blob = new Blob([directHtmlContent], { type: "text/html;charset=utf-8" });
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank");
    } else if (currentUrl.startsWith("local://")) {
      window.open(formatProxyUrl(currentUrl), "_blank");
    } else {
      window.open(currentUrl, "_blank");
    }
  };

  const handleReload = () => {
    setFrameKey((k) => k + 1);
  };

  const handlePreviewIndexHtml = () => {
    navigate("local://index.html");
  };

  return (
    <aside className={`inside-browser-container ${isMaximized ? "maximized" : "docked"}`}>
      {/* Header Bar */}
      <div className="ib-header">
        <div className="ib-tab" title={currentUrl}>
          <span className="ib-tab-dot"></span>
          <span className="ib-tab-title">{currentTitle}</span>
          <span className="ib-tab-badge">WEB</span>
        </div>

        <div className="ib-actions">
          <button
            type="button"
            className="ib-btn"
            onClick={handleOpenExternal}
            title="Open in External Window"
          >
            <ExternalLink size={14} />
          </button>
          <button
            type="button"
            className="ib-btn"
            onClick={() => setIsMaximized(!isMaximized)}
            title={isMaximized ? "Restore Split View" : "Maximize / Full Screen"}
          >
            {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            type="button"
            className="ib-btn"
            onClick={onClose}
            title="Close Browser"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Address Bar */}
      <div className="ib-address-bar">
        <button
          type="button"
          className="ib-nav-btn"
          onClick={() => {
            try { iframeRef.current?.contentWindow?.history.back(); } catch (_) {}
          }}
          title="Back"
        >
          <ArrowLeft size={14} />
        </button>
        <button
          type="button"
          className="ib-nav-btn"
          onClick={() => {
            try { iframeRef.current?.contentWindow?.history.forward(); } catch (_) {}
          }}
          title="Forward"
        >
          <ArrowRight size={14} />
        </button>
        <button
          type="button"
          className="ib-nav-btn"
          onClick={handleReload}
          title="Reload"
        >
          <RotateCw size={14} />
        </button>
        <button
          type="button"
          className="ib-nav-btn"
          onClick={() => navigate("https://www.google.com")}
          title="Home"
        >
          <Globe size={14} />
        </button>

        <form
          className="ib-url-box"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(inputValue);
          }}
        >
          <span className="ib-lock">
            <Lock size={12} />
          </span>
          <input
            type="text"
            className="ib-url-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Search web or enter URL..."
          />
          <button type="submit" className="ib-go-btn" title="Navigate">
            <Search size={12} />
          </button>
        </form>
      </div>

      {/* Quick Action Workspace Bar */}
      <div className="ib-quick-bar">
        <button
          type="button"
          className="ib-quick-btn"
          onClick={handlePreviewIndexHtml}
          title="Live preview active project's index.html"
        >
          <FileCode size={12} />
          <span>Preview Workspace: index.html</span>
        </button>
        <button
          type="button"
          className="ib-quick-btn"
          onClick={() => navigate("https://duckduckgo.com")}
        >
          <span>DuckDuckGo</span>
        </button>
        <button
          type="button"
          className="ib-quick-btn"
          onClick={() => navigate("https://github.com")}
        >
          <span>GitHub</span>
        </button>
      </div>

      {/* Frame Viewport */}
      <div className="ib-viewport">
        <iframe
          key={frameKey}
          ref={iframeRef}
          className="ib-frame"
          src={isDirectHtml ? undefined : formatProxyUrl(currentUrl)}
          srcDoc={isDirectHtml ? directHtmlContent : undefined}
          title="Built-in Web Browser"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    </aside>
  );
}
