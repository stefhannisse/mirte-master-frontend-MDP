import { useEffect, useRef, useState, useCallback, createContext, useContext } from "react";

const DARK_COLORS = {
  bg: "#0d0f14",
  surface: "#13161e",
  border: "#1e2330",
  accent: "#00e5a0",
  accentDim: "#00e5a022",
  warn: "#f5a623",
  text: "#e8eaf0",
  textMuted: "#5a6280",
  textDim: "#2e3450",
  unknown: "#1a1c2a",
  free: "#d8dce8",
  occupied: "#1e2030",
};

const LIGHT_COLORS = {
  bg: "#f0f2f5",
  surface: "#ffffff",
  border: "#d8dce6",
  accent: "#009e6e",
  accentDim: "#009e6e1a",
  warn: "#c47a00",
  text: "#1a1d2b",
  textMuted: "#6b7280",
  textDim: "#bcc1cc",
  unknown: "#1a1c2a",
  free: "#d8dce8",
  occupied: "#1e2030",
};

export const COLORS = DARK_COLORS;

const ThemeContext = createContext(LIGHT_COLORS);

export function ThemeProvider({ dark, children }) {
  return (
    <ThemeContext.Provider value={dark ? DARK_COLORS : LIGHT_COLORS}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useColors() {
  return useContext(ThemeContext);
}

export const SCAN_MAX_RANGE = 12;

export function labelToColor(label) {
  const l = (label || "").toLowerCase();
  if (l.includes("bug") || l.includes("pest") || l.includes("disease")) return "#f87171";
  if (l.includes("red") && l.includes("pink")) return "#e8567a"; // combined "red/pink" label
  if (l.includes("pink"))  return "#ec4899";
  if (l.includes("red"))   return "#dc2626";
  if (l.includes("white")) return "#e2e8f0";
  return "#8b9bc8";
}

export function useTopicHz() {
  const countRef = useRef(0);
  const [hz, setHz] = useState(null);
  useEffect(() => {
    const interval = setInterval(() => {
      setHz(countRef.current > 0 ? countRef.current : null);
      countRef.current = 0;
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  const tick = useCallback(() => { countRef.current++; }, []);
  return { hz, tick };
}

export function MapCanvas({ mapMsg, robotPose, waypoints = [], activeWaypointIdx = -1, flowerDetections = [] }) {
  const COLORS = useColors();
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!mapMsg || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const { width, height, data, info } = mapMsg;

    const offscreen = document.createElement("canvas");
    offscreen.width = width; offscreen.height = height;
    const oc = offscreen.getContext("2d");
    const img = oc.createImageData(width, height);
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      let r, g, b;
      if (v === -1)     { r = 26;  g = 28;  b = 42; }
      else if (v === 0) { r = 210; g = 215; b = 225; }
      else              { r = 18;  g = 20;  b = 32; }
      img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
    }
    oc.putImageData(img, 0, 0);

    const cw = canvas.width, ch = canvas.height;
    ctx.fillStyle = "#1a1c2a"; ctx.fillRect(0, 0, cw, ch);
    const scale = Math.min(cw / width, ch / height) * 0.95;
    const dx = (cw - width * scale) / 2, dy = (ch - height * scale) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreen, dx, dy, width * scale, height * scale);

    ctx.strokeStyle = "rgba(0,229,160,0.04)"; ctx.lineWidth = 0.5;
    const gridStep = 50;
    for (let gx = dx; gx < dx + width * scale; gx += gridStep) { ctx.beginPath(); ctx.moveTo(gx, dy); ctx.lineTo(gx, dy + height * scale); ctx.stroke(); }
    for (let gy = dy; gy < dy + height * scale; gy += gridStep) { ctx.beginPath(); ctx.moveTo(dx, gy); ctx.lineTo(dx + width * scale, gy); ctx.stroke(); }

    // Object detections from /greenvision/xyz
    if (flowerDetections.length > 0 && info) {
      const res = info.resolution, ox = info.origin.position.x, oy = info.origin.position.y;
      flowerDetections.forEach((det) => {
        const cx = dx + (det.position.x - ox) / res * scale;
        const cy = dy + (height - (det.position.y - oy) / res) * scale;
        const color = labelToColor(det.label);
        ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 8; ctx.fill();
        ctx.shadowBlur = 0;
        ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.lineWidth = 0.5; ctx.stroke();
      });
    }

    // Waypoints
    if (waypoints.length > 0 && info) {
      const toCanvas = (wx, wy) => ({
        cx: dx + (wx - info.origin.position.x) / info.resolution * scale,
        cy: dy + (height - (wy - info.origin.position.y) / info.resolution) * scale,
      });

      // Draw path lines between waypoints
      if (waypoints.length > 1) {
        ctx.beginPath();
        waypoints.forEach((wp, i) => {
          const { cx, cy } = toCanvas(wp.x, wp.y);
          i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
        });
        ctx.strokeStyle = "rgba(0,229,160,0.2)"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.stroke(); ctx.setLineDash([]);
      }

      waypoints.forEach((wp, i) => {
        const { cx, cy } = toCanvas(wp.x, wp.y);
        const isActive = i === activeWaypointIdx;
        const isVisited = activeWaypointIdx >= 0 && i < activeWaypointIdx;

        if (isActive) {
          // Outer ring
          ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(0,229,160,0.3)"; ctx.lineWidth = 1; ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(cx, cy, isActive ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = isActive ? COLORS.accent : isVisited ? "rgba(0,229,160,0.4)" : "rgba(0,229,160,0.6)";
        if (isActive) { ctx.shadowColor = COLORS.accent; ctx.shadowBlur = 8; }
        ctx.fill();
        ctx.shadowBlur = 0;

        // Label
        ctx.font = "bold 9px monospace";
        ctx.fillStyle = isActive ? COLORS.accent : "rgba(0,229,160,0.7)";
        ctx.textAlign = "center";
        ctx.fillText(i + 1, cx, cy - 10);
      });
    }

    if (robotPose && info) {
      const rx = dx + (robotPose.x - info.origin.position.x) / info.resolution * scale;
      const ry = dy + (height - (robotPose.y - info.origin.position.y) / info.resolution) * scale;
      ctx.beginPath(); ctx.arc(rx, ry, 20, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,229,160,0.12)"; ctx.lineWidth = 1; ctx.stroke();
      ctx.save(); ctx.translate(rx, ry); ctx.rotate(robotPose.yaw);
      ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(6, 6); ctx.lineTo(0, 2); ctx.lineTo(-6, 6); ctx.closePath();
      ctx.fillStyle = COLORS.accent; ctx.shadowColor = COLORS.accent; ctx.shadowBlur = 8; ctx.fill();
      ctx.restore();
    }
  }, [mapMsg, robotPose, waypoints, activeWaypointIdx, flowerDetections, COLORS]);
  return <canvas ref={canvasRef} width={640} height={480} style={{ width: "100%", height: "100%", display: "block", borderRadius: 4 }} />;
}

export function ScanCanvas({ ranges }) {
  const COLORS = useColors();
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!ranges || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const cw = canvas.width, ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    const n = ranges.length;
    if (n === 0) return;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / n) * cw;
      const r = isFinite(ranges[i]) ? ranges[i] : SCAN_MAX_RANGE;
      const y = ch - (Math.min(r, SCAN_MAX_RANGE) / SCAN_MAX_RANGE) * ch * 0.9;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.lineTo(cw, ch); ctx.lineTo(0, ch); ctx.closePath();
    ctx.fillStyle = COLORS.accentDim; ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / n) * cw;
      const r = isFinite(ranges[i]) ? ranges[i] : SCAN_MAX_RANGE;
      const y = ch - (Math.min(r, SCAN_MAX_RANGE) / SCAN_MAX_RANGE) * ch * 0.9;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 1.5; ctx.stroke();
  }, [ranges, COLORS]);
  return <canvas ref={canvasRef} width={800} height={80} style={{ width: "100%", height: 70, display: "block" }} />;
}

export function StatusDot({ status }) {
  const COLORS = useColors();
  const colors = { connected: COLORS.accent, connecting: COLORS.warn, error: "#e24b4a", disconnected: COLORS.textDim };
  return (
    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: colors[status] || COLORS.textDim, boxShadow: status === "connected" ? `0 0 6px ${COLORS.accent}` : "none", flexShrink: 0 }} />
  );
}

export function TopicRow({ name, hz, active }) {
  const COLORS = useColors();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: `0.5px solid ${COLORS.border}` }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: active ? COLORS.accent : COLORS.textDim, boxShadow: active ? `0 0 4px ${COLORS.accent}` : "none" }} />
      <span style={{ flex: 1, fontSize: 11, fontFamily: "monospace", color: COLORS.textMuted }}>{name}</span>
      <span style={{ fontSize: 11, color: hz ? COLORS.accent : COLORS.textDim, fontFamily: "monospace" }}>{hz ? `${hz}Hz` : "—"}</span>
    </div>
  );
}

export function StatCard({ label, value, unit }) {
  const COLORS = useColors();
  return (
    <div style={{ background: COLORS.surface, borderRadius: 6, padding: "10px 12px", border: `0.5px solid ${COLORS.border}` }}>
      <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 500, color: COLORS.text, fontFamily: "monospace" }}>
        {value ?? "—"}{unit && <span style={{ fontSize: 12, color: COLORS.textMuted, marginLeft: 3 }}>{unit}</span>}
      </div>
    </div>
  );
}

export function SectionLabel({ children }) {
  const COLORS = useColors();
  return (
    <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, paddingBottom: 4, borderBottom: `0.5px solid ${COLORS.border}` }}>
      {children}
    </div>
  );
}
