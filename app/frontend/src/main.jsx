import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
// Shared styles load before App's components so each screen's own stylesheet
// (src/styles/*.css) comes later in the cascade and can refine the shared classes
import "./App.css";
import App from "./App";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: "100vh",
          backgroundColor: "#0d0f12",
          color: "#f0f2f5",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px",
          fontFamily: "system-ui, -apple-system, sans-serif"
        }}>
          <div style={{
            maxWidth: "600px",
            width: "100%",
            background: "#181b20",
            border: "1px solid #2a2f38",
            borderRadius: "16px",
            padding: "28px",
            boxShadow: "0 16px 40px rgba(0,0,0,0.5)"
          }}>
            <h2 style={{ margin: "0 0 12px", fontSize: "1.25rem", color: "#ff6b6b" }}>
              Something went wrong loading Abyx
            </h2>
            <p style={{ fontSize: "0.9rem", color: "#9aa2af", marginBottom: "16px", lineHeight: "1.5" }}>
              An unexpected interface error occurred. You can click below to reload or reset the view:
            </p>
            <pre style={{
              background: "#0d0f12",
              padding: "12px",
              borderRadius: "8px",
              fontSize: "0.8rem",
              color: "#ff8787",
              overflowX: "auto",
              marginBottom: "20px"
            }}>
              {this.state.error?.message || String(this.state.error)}
            </pre>
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                type="button"
                onClick={() => {
                  window.location.hash = "#/chat";
                  window.location.reload();
                }}
                style={{
                  padding: "8px 16px",
                  borderRadius: "8px",
                  background: "#4f8cff",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 600
                }}
              >
                Reload Abyx
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
