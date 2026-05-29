/*
    You can use the cloudflare tunnel to pass the rosbridge websocket to your local machine for testing:
    cloudflared tunnel --url http://localhost:9090
*/

import { useEffect, useRef, useState, useCallback } from "react";
import * as ROSLIB from "roslib";
import { COLORS, StatusDot } from "./shared.jsx";
import MapSensorsView from "./MapSensorsView.jsx";
import RobotControlView from "./RobotControlView.jsx";

const DEFAULT_WS = "ws://localhost:9090";

function useRos(wsUrl) {
  const rosRef = useRef(null);
  const socketRef = useRef(null);
  const [status, setStatus] = useState("disconnected");

  const connect = useCallback((url) => {
    if (rosRef.current) rosRef.current.close();
    setStatus("connecting");
    const ros = new ROSLIB.Ros({ url });
    rosRef.current = ros;
    ros.on("connection", () => {
      setStatus("connected");
      // Grab the underlying WebSocket from roslibjs
      socketRef.current = ros.socket;
    });
    ros.on("error", () => setStatus("error"));
    ros.on("close", () => { setStatus("disconnected"); socketRef.current = null; });
  }, []);

  const disconnect = useCallback(() => {
    if (rosRef.current) rosRef.current.close();
    setStatus("disconnected");
    socketRef.current = null;
  }, []);

  useEffect(() => {
    connect(wsUrl);
    return () => { if (rosRef.current) rosRef.current.close(); };
  }, []);

  return { ros: rosRef.current, socket: socketRef.current, status, connect, disconnect };
}

const NAV_ITEMS = [
  { id: "map",    label: "Map & Sensors" },
  { id: "robot",  label: "Robot Control" },
];

export default function RosDashboard() {
  const [wsUrl, setWsUrl]       = useState(DEFAULT_WS);
  const [inputUrl, setInputUrl] = useState(DEFAULT_WS);
  const [view, setView]         = useState("map");
  const [simMode, setSimMode]   = useState(false);
  const { ros, socket, status, connect, disconnect } = useRos(wsUrl);

  const handleConnect = () => {
    if (status === "connected") disconnect();
    else { connect(inputUrl); setWsUrl(inputUrl); }
  };

  return (
    <div style={{
      background: COLORS.bg, minHeight: "100vh", color: COLORS.text,
      fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
      display: "flex", flexDirection: "column",
    }}>
      {/* ── Navbar ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 0,
        height: 48, flexShrink: 0,
        borderBottom: `0.5px solid ${COLORS.border}`,
        background: COLORS.surface,
      }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px", borderRight: `0.5px solid ${COLORS.border}`, height: "100%" }}>
          <StatusDot status={status} />
          <span style={{ fontSize: 13, fontWeight: 500, color: COLORS.text, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>MIRTE</span>
          <span style={{ fontSize: 11, color: COLORS.textMuted }}>ros2</span>
        </div>

        {/* Nav items */}
        {NAV_ITEMS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            style={{
              height: "100%",
              padding: "0 20px",
              background: "transparent",
              border: "none",
              borderBottom: view === id ? `2px solid ${COLORS.accent}` : "2px solid transparent",
              borderRight: `0.5px solid ${COLORS.border}`,
              color: view === id ? COLORS.accent : COLORS.textMuted,
              fontSize: 12,
              letterSpacing: "0.05em",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "color 0.15s",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </button>
        ))}

        {/* Connection controls */}
        <div style={{ flex: 1, display: "flex", gap: 8, padding: "0 16px", justifyContent: "flex-end", alignItems: "center", maxWidth: 540, marginLeft: "auto" }}>
          <button
            onClick={() => setSimMode(m => !m)}
            style={{
              background: simMode ? COLORS.accentDim : "transparent",
              border: `0.5px solid ${simMode ? COLORS.accent : COLORS.border}`,
              borderRadius: 4, color: simMode ? COLORS.accent : COLORS.textMuted,
              fontSize: 12, padding: "4px 14px", cursor: "pointer",
              fontFamily: "monospace", transition: "all 0.2s", whiteSpace: "nowrap",
            }}
          >
            {simMode ? "● sim" : "sim"}
          </button>
          <input
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleConnect()}
            style={{
              flex: 1, background: COLORS.bg, border: `0.5px solid ${COLORS.border}`,
              borderRadius: 4, color: COLORS.text, fontSize: 12,
              padding: "4px 10px", fontFamily: "monospace", outline: "none",
            }}
          />
          <button
            onClick={handleConnect}
            style={{
              background: status === "connected" ? "transparent" : COLORS.accentDim,
              border: `0.5px solid ${status === "connected" ? COLORS.border : COLORS.accent}`,
              borderRadius: 4, color: status === "connected" ? COLORS.textMuted : COLORS.accent,
              fontSize: 12, padding: "4px 14px", cursor: "pointer", fontFamily: "monospace",
              transition: "all 0.2s", whiteSpace: "nowrap",
            }}
          >
            {status === "connected" ? "disconnect" : status === "connecting" ? "connecting…" : "connect"}
          </button>
        </div>

        {/* Live badge */}
        <div style={{ padding: "0 16px", fontSize: 11, color: COLORS.textMuted, whiteSpace: "nowrap" }}>
          {status === "connected"    && <span style={{ color: COLORS.accent }}>● live</span>}
          {status === "connecting"   && <span style={{ color: COLORS.warn }}>● connecting</span>}
          {status === "error"        && <span style={{ color: "#e24b4a" }}>● error</span>}
          {status === "disconnected" && <span>○ offline</span>}
        </div>
      </div>

      {/* ── Active View ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {view === "map"
          ? <MapSensorsView ros={ros} status={status} simMode={simMode} />
          : <RobotControlView socket={socket} />
        }
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${COLORS.bg}; }
        input:focus { border-color: ${COLORS.accent} !important; box-shadow: 0 0 0 2px ${COLORS.accentDim}; }
        button:hover { opacity: 0.85; }
        button:active { transform: scale(0.98); }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: ${COLORS.bg}; }
        ::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 2px; }
      `}</style>
    </div>
  );
}
