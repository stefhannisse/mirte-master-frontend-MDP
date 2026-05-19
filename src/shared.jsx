import { useEffect, useRef, useState, useCallback } from "react";

export const COLORS = {
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

export const SCAN_MAX_RANGE = 12;

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

export function MapCanvas({ mapMsg, robotPose }) {
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
    ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, cw, ch);
    const scale = Math.min(cw / width, ch / height) * 0.95;
    const dx = (cw - width * scale) / 2, dy = (ch - height * scale) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreen, dx, dy, width * scale, height * scale);

    ctx.strokeStyle = "rgba(0,229,160,0.04)"; ctx.lineWidth = 0.5;
    const gridStep = 50;
    for (let gx = dx; gx < dx + width * scale; gx += gridStep) { ctx.beginPath(); ctx.moveTo(gx, dy); ctx.lineTo(gx, dy + height * scale); ctx.stroke(); }
    for (let gy = dy; gy < dy + height * scale; gy += gridStep) { ctx.beginPath(); ctx.moveTo(dx, gy); ctx.lineTo(dx + width * scale, gy); ctx.stroke(); }

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
  }, [mapMsg, robotPose]);
  return <canvas ref={canvasRef} width={640} height={480} style={{ width: "100%", height: "100%", display: "block", borderRadius: 4 }} />;
}

export function ScanCanvas({ ranges }) {
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
    ctx.fillStyle = "rgba(0,229,160,0.08)"; ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / n) * cw;
      const r = isFinite(ranges[i]) ? ranges[i] : SCAN_MAX_RANGE;
      const y = ch - (Math.min(r, SCAN_MAX_RANGE) / SCAN_MAX_RANGE) * ch * 0.9;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 1.5; ctx.stroke();
  }, [ranges]);
  return <canvas ref={canvasRef} width={800} height={80} style={{ width: "100%", height: 70, display: "block" }} />;
}

export function StatusDot({ status }) {
  const colors = { connected: COLORS.accent, connecting: COLORS.warn, error: "#e24b4a", disconnected: COLORS.textDim };
  return (
    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: colors[status] || COLORS.textDim, boxShadow: status === "connected" ? `0 0 6px ${COLORS.accent}` : "none", flexShrink: 0 }} />
  );
}

export function TopicRow({ name, hz, active }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: `0.5px solid ${COLORS.border}` }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: active ? COLORS.accent : COLORS.textDim, boxShadow: active ? `0 0 4px ${COLORS.accent}` : "none" }} />
      <span style={{ flex: 1, fontSize: 11, fontFamily: "monospace", color: COLORS.textMuted }}>{name}</span>
      <span style={{ fontSize: 11, color: hz ? COLORS.accent : COLORS.textDim, fontFamily: "monospace" }}>{hz ? `${hz}Hz` : "—"}</span>
    </div>
  );
}

export function StatCard({ label, value, unit }) {
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
  return (
    <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, paddingBottom: 4, borderBottom: `0.5px solid ${COLORS.border}` }}>
      {children}
    </div>
  );
}
