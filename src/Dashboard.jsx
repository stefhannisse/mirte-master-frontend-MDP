/*
    You can use the cloudflare tunnel to pass the rosbridge websocket to your local machine for testing:
    cloudflared tunnel --url http://localhost:9090
*/

import { useEffect, useRef, useState, useCallback } from "react";
import * as ROSLIB from "roslib";

// ─── constants ───────────────────────────────────────────────────────────────
const DEFAULT_WS = "ws://localhost:9090";
const SCAN_MAX_RANGE = 12;

const COLORS = {
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

// ─── hooks ───────────────────────────────────────────────────────────────────
function useRos(wsUrl) {
  const rosRef = useRef(null);
  const [status, setStatus] = useState("disconnected"); // connecting | connected | disconnected | error

  const connect = useCallback((url) => {
    if (rosRef.current) {
      rosRef.current.close();
    }
    setStatus("connecting");
    const ros = new ROSLIB.Ros({ url });
    rosRef.current = ros;
    ros.on("connection", () => setStatus("connected"));
    ros.on("error", () => setStatus("error"));
    ros.on("close", () => setStatus("disconnected"));
  }, []);

  const disconnect = useCallback(() => {
    if (rosRef.current) rosRef.current.close();
    setStatus("disconnected");
  }, []);

  useEffect(() => {
    connect(wsUrl);
    return () => { if (rosRef.current) rosRef.current.close(); };
  }, []);

  return { ros: rosRef.current, status, connect, disconnect };
}

function useTopicHz(topicName) {
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

// ─── map canvas ──────────────────────────────────────────────────────────────
function MapCanvas({ mapMsg, robotPose }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!mapMsg || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const { width, height, data, info } = mapMsg;

    const offscreen = document.createElement("canvas");
    offscreen.width = width;
    offscreen.height = height;
    const oc = offscreen.getContext("2d");
    const img = oc.createImageData(width, height);

    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      let r, g, b;
      if (v === -1)       { r = 26;  g = 28;  b = 42; }   // unknown
      else if (v === 0)   { r = 210; g = 215; b = 225; }   // free
      else                { r = 18;  g = 20;  b = 32; }    // occupied
      img.data[i * 4]     = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    oc.putImageData(img, 0, 0);

    const cw = canvas.width, ch = canvas.height;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, cw, ch);

    const scale = Math.min(cw / width, ch / height) * 0.95;
    const dx = (cw - width * scale) / 2;
    const dy = (ch - height * scale) / 2;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreen, dx, dy, width * scale, height * scale);

    // grid overlay
    ctx.strokeStyle = "rgba(0,229,160,0.04)";
    ctx.lineWidth = 0.5;
    const gridStep = 50;
    for (let gx = dx; gx < dx + width * scale; gx += gridStep) {
      ctx.beginPath(); ctx.moveTo(gx, dy); ctx.lineTo(gx, dy + height * scale); ctx.stroke();
    }
    for (let gy = dy; gy < dy + height * scale; gy += gridStep) {
      ctx.beginPath(); ctx.moveTo(dx, gy); ctx.lineTo(dx + width * scale, gy); ctx.stroke();
    }

    // robot
    if (robotPose && info) {
      const rx = dx + (robotPose.x - info.origin.position.x) / info.resolution * scale;
      const ry = dy + (height - (robotPose.y - info.origin.position.y) / info.resolution) * scale;
      const yaw = robotPose.yaw;

      // range ring
      ctx.beginPath();
      ctx.arc(rx, ry, 20, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,229,160,0.12)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // heading arrow
      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(yaw);
      ctx.beginPath();
      ctx.moveTo(0, -11);
      ctx.lineTo(6, 6);
      ctx.lineTo(0, 2);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fillStyle = COLORS.accent;
      ctx.shadowColor = COLORS.accent;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.restore();
    }
  }, [mapMsg, robotPose]);

  return (
    <canvas
      ref={canvasRef}
      width={640}
      height={480}
      style={{ width: "100%", height: "100%", display: "block", borderRadius: 4 }}
    />
  );
}

// ─── scan canvas ─────────────────────────────────────────────────────────────
function ScanCanvas({ ranges }) {
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
    ctx.lineTo(cw, ch);
    ctx.lineTo(0, ch);
    ctx.closePath();
    ctx.fillStyle = "rgba(0,229,160,0.08)";
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / n) * cw;
      const r = isFinite(ranges[i]) ? ranges[i] : SCAN_MAX_RANGE;
      const y = ch - (Math.min(r, SCAN_MAX_RANGE) / SCAN_MAX_RANGE) * ch * 0.9;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [ranges]);

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={80}
      style={{ width: "100%", height: 70, display: "block" }}
    />
  );
}

// ─── small components ─────────────────────────────────────────────────────────
function StatusDot({ status }) {
  const colors = {
    connected: COLORS.accent,
    connecting: COLORS.warn,
    error: "#e24b4a",
    disconnected: COLORS.textDim,
  };
  return (
    <span style={{
      display: "inline-block",
      width: 8, height: 8,
      borderRadius: "50%",
      background: colors[status] || COLORS.textDim,
      boxShadow: status === "connected" ? `0 0 6px ${COLORS.accent}` : "none",
      flexShrink: 0,
    }} />
  );
}

function TopicRow({ name, hz, active }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: `0.5px solid ${COLORS.border}` }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
        background: active ? COLORS.accent : COLORS.textDim,
        boxShadow: active ? `0 0 4px ${COLORS.accent}` : "none",
      }} />
      <span style={{ flex: 1, fontSize: 11, fontFamily: "monospace", color: COLORS.textMuted }}>{name}</span>
      <span style={{ fontSize: 11, color: hz ? COLORS.accent : COLORS.textDim, fontFamily: "monospace" }}>
        {hz ? `${hz}Hz` : "—"}
      </span>
    </div>
  );
}

function StatCard({ label, value, unit }) {
  return (
    <div style={{ background: COLORS.surface, borderRadius: 6, padding: "10px 12px", border: `0.5px solid ${COLORS.border}` }}>
      <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 500, color: COLORS.text, fontFamily: "monospace" }}>
        {value ?? "—"}
        {unit && <span style={{ fontSize: 12, color: COLORS.textMuted, marginLeft: 3 }}>{unit}</span>}
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, paddingBottom: 4, borderBottom: `0.5px solid ${COLORS.border}` }}>
      {children}
    </div>
  );
}

// ─── main dashboard ───────────────────────────────────────────────────────────
export default function RosDashboard() {
  const [wsUrl, setWsUrl] = useState(DEFAULT_WS);
  const [inputUrl, setInputUrl] = useState(DEFAULT_WS);
  const { ros, status, connect, disconnect } = useRos(wsUrl);

  const [mapMsg, setMapMsg] = useState(null);
  const [scanRanges, setScanRanges] = useState([]);
  const [scanMeta, setScanMeta] = useState(null);
  const [robotPose, setRobotPose] = useState(null);

  const mapHz = useTopicHz("/map");
  const scanHz = useTopicHz("/scan");
  const odomHz = useTopicHz("/odometry/filtered");
  const tfHz = useTopicHz("/tf");

  useEffect(() => {
    if (!ros || status !== "connected") return;

    const subs = [];

    const mapTopic = new ROSLIB.Topic({ ros, name: "/map", messageType: "nav_msgs/OccupancyGrid" });
    mapTopic.subscribe((msg) => {
      mapHz.tick();
      setMapMsg({ width: msg.info.width, height: msg.info.height, data: msg.data, info: msg.info });
    });
    subs.push(mapTopic);

    const scanTopic = new ROSLIB.Topic({ ros, name: "/scan", messageType: "sensor_msgs/LaserScan" });
    scanTopic.subscribe((msg) => {
      scanHz.tick();
      setScanRanges(msg.ranges);
      setScanMeta({
        min: msg.range_min,
        max: msg.range_max,
        rays: msg.ranges.length,
        frame: msg.header.frame_id,
      });
    });
    subs.push(scanTopic);

    const odomTopic = new ROSLIB.Topic({ ros, name: "/odometry/filtered", messageType: "nav_msgs/Odometry" });
    odomTopic.subscribe((msg) => {
      odomHz.tick();
      const { x, y } = msg.pose.pose.position;
      const { z: qz, w: qw } = msg.pose.pose.orientation;
      const yaw = Math.atan2(2 * (qw * qz), 1 - 2 * qz * qz);
      const vx = msg.twist.twist.linear.x;
      const vy = msg.twist.twist.linear.y;
      setRobotPose({ x, y, yaw, speed: Math.sqrt(vx * vx + vy * vy) });
    });
    subs.push(odomTopic);

    const tfTopic = new ROSLIB.Topic({ ros, name: "/tf", messageType: "tf2_msgs/TFMessage" });
    tfTopic.subscribe(() => tfHz.tick());
    subs.push(tfTopic);

    return () => subs.forEach((s) => s.unsubscribe());
  }, [ros, status]);

  const handleConnect = () => {
    if (status === "connected") {
      disconnect();
    } else {
      connect(inputUrl);
      setWsUrl(inputUrl);
    }
  };

  return (
    <div style={{
      background: COLORS.bg,
      minHeight: "100vh",
      color: COLORS.text,
      fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 16,
        padding: "12px 20px",
        borderBottom: `0.5px solid ${COLORS.border}`,
        background: COLORS.surface,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusDot status={status} />
          <span style={{ fontSize: 13, fontWeight: 500, color: COLORS.text, letterSpacing: "0.05em" }}>ROS2 SLAM</span>
          <span style={{ fontSize: 11, color: COLORS.textMuted }}>dashboard</span>
        </div>
        <div style={{ flex: 1, display: "flex", gap: 8, maxWidth: 400 }}>
          <input
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            style={{
              flex: 1, background: COLORS.bg, border: `0.5px solid ${COLORS.border}`,
              borderRadius: 4, color: COLORS.text, fontSize: 12,
              padding: "5px 10px", fontFamily: "monospace", outline: "none",
            }}
            onKeyDown={(e) => e.key === "Enter" && handleConnect()}
          />
          <button
            onClick={handleConnect}
            style={{
              background: status === "connected" ? "transparent" : COLORS.accentDim,
              border: `0.5px solid ${status === "connected" ? COLORS.border : COLORS.accent}`,
              borderRadius: 4, color: status === "connected" ? COLORS.textMuted : COLORS.accent,
              fontSize: 12, padding: "5px 14px", cursor: "pointer", fontFamily: "monospace",
              transition: "all 0.2s",
            }}
          >
            {status === "connected" ? "disconnect" : status === "connecting" ? "connecting…" : "connect"}
          </button>
        </div>
        <div style={{ marginLeft: "auto", fontSize: 11, color: COLORS.textMuted }}>
          {status === "connected" && <span style={{ color: COLORS.accent }}>● live</span>}
          {status === "connecting" && <span style={{ color: COLORS.warn }}>● connecting</span>}
          {status === "error" && <span style={{ color: "#e24b4a" }}>● error — is rosbridge running?</span>}
          {status === "disconnected" && <span>○ disconnected</span>}
        </div>
      </div>

      {/* body */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 12, padding: 16, flex: 1 }}>

        {/* map panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{
            flex: 1, background: COLORS.surface,
            border: `0.5px solid ${COLORS.border}`,
            borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8,
            minHeight: 400,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: COLORS.textMuted, letterSpacing: "0.06em" }}>/map — occupancy grid</span>
              {mapMsg && (
                <span style={{ fontSize: 11, color: COLORS.textDim, fontFamily: "monospace" }}>
                  {mapMsg.width}×{mapMsg.height}px · {mapMsg.info?.resolution?.toFixed(3)}m/px
                </span>
              )}
            </div>
            <div style={{ flex: 1, borderRadius: 4, overflow: "hidden", minHeight: 360 }}>
              {mapMsg
                ? <MapCanvas mapMsg={mapMsg} robotPose={robotPose} />
                : (
                  <div style={{ height: "100%", minHeight: 360, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
                    <div style={{ width: 40, height: 40, border: `1px solid ${COLORS.border}`, borderTop: `1px solid ${COLORS.accent}`, borderRadius: "50%", animation: "spin 1.2s linear infinite" }} />
                    <span style={{ fontSize: 12, color: COLORS.textMuted }}>waiting for /map…</span>
                  </div>
                )}
            </div>
          </div>

          {/* scan */}
          <div style={{
            background: COLORS.surface, border: `0.5px solid ${COLORS.border}`,
            borderRadius: 8, padding: "10px 12px",
          }}>
            <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 6, letterSpacing: "0.06em" }}>/scan — laser ranges</div>
            <ScanCanvas ranges={scanRanges} />
            {scanMeta && (
              <div style={{ display: "flex", gap: 16, marginTop: 6 }}>
                <span style={{ fontSize: 10, color: COLORS.textMuted }}>frame: <span style={{ color: COLORS.text }}>{scanMeta.frame}</span></span>
                <span style={{ fontSize: 10, color: COLORS.textMuted }}>rays: <span style={{ color: COLORS.text }}>{scanMeta.rays}</span></span>
                <span style={{ fontSize: 10, color: COLORS.textMuted }}>range: <span style={{ color: COLORS.text }}>{scanMeta.min.toFixed(2)}–{scanMeta.max.toFixed(2)}m</span></span>
              </div>
            )}
          </div>
        </div>

        {/* sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

          {/* topics */}
          <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, padding: "12px 14px" }}>
            <SectionLabel>topics</SectionLabel>
            <TopicRow name="/map" hz={mapHz.hz} active={mapHz.hz > 0} />
            <TopicRow name="/scan" hz={scanHz.hz} active={scanHz.hz > 0} />
            <TopicRow name="/odometry/filtered" hz={odomHz.hz} active={odomHz.hz > 0} />
            <TopicRow name="/tf" hz={tfHz.hz} active={tfHz.hz > 0} />
          </div>

          {/* pose */}
          <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, padding: "12px 14px" }}>
            <SectionLabel>robot pose</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <StatCard label="x" value={robotPose?.x?.toFixed(2)} unit="m" />
              <StatCard label="y" value={robotPose?.y?.toFixed(2)} unit="m" />
              <StatCard label="yaw" value={robotPose ? (robotPose.yaw * 180 / Math.PI).toFixed(1) : null} unit="°" />
              <StatCard label="speed" value={robotPose?.speed?.toFixed(2)} unit="m/s" />
            </div>
          </div>

          {/* map info */}
          <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, padding: "12px 14px" }}>
            <SectionLabel>map info</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <StatCard label="resolution" value={mapMsg?.info?.resolution?.toFixed(3)} unit="m/px" />
              <StatCard
                label="size"
                value={mapMsg ? `${mapMsg.width}×${mapMsg.height}` : null}
                unit="px"
              />
              <StatCard
                label="origin x"
                value={mapMsg?.info?.origin?.position?.x?.toFixed(2)}
                unit="m"
              />
              <StatCard
                label="origin y"
                value={mapMsg?.info?.origin?.position?.y?.toFixed(2)}
                unit="m"
              />
            </div>
          </div>
        </div>
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