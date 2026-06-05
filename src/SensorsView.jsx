import { useEffect, useState } from "react";
import * as ROSLIB from "roslib";
import { MapCanvas, ScanCanvas, useTopicHz, useColors } from "./shared.jsx";

// Same sim data as MapSensorsView for consistency
const SIM_MAP = (() => {
  const W = 100, H = 100, RES = 0.05;
  const data = new Array(W * H).fill(0);
  const fill = (c, r) => { if (c >= 0 && c < W && r >= 0 && r < H) data[r * W + c] = 100; };
  for (let i = 0; i < 100; i++)
    for (let t = 0; t < 3; t++) {
      fill(t, i); fill(99 - t, i); fill(i, t); fill(i, 99 - t);
    }
  for (let c = 6; c <= 22; c++)
    for (let r = 5; r <= 21; r++)
      if (c === 6 || c === 22 || r === 5 || r === 21) fill(c, r);
  for (let c = 78; c <= 94; c++)
    for (let r = 77; r <= 93; r++)
      if (c === 78 || c === 94 || r === 77 || r === 93) fill(c, r);
  for (let r = 29; r <= 69; r++) { fill(86, r); fill(87, r); }
  return {
    width: W, height: H, data,
    info: { resolution: RES, width: W, height: H, origin: { position: { x: -2.5, y: -2.5, z: 0 } } },
  };
})();

function simRaycast(px, py, angle) {
  const { width: W, height: H, data, info: { resolution: res, origin: { position: { x: ox, y: oy } } } } = SIM_MAP;
  const step = res * 0.7;
  for (let d = step; d < 6; d += step) {
    const col = Math.floor((px + Math.cos(angle) * d - ox) / res);
    const row = H - 1 - Math.floor((py + Math.sin(angle) * d - oy) / res);
    if (col < 0 || col >= W || row < 0 || row >= H) return d;
    if (data[row * W + col] > 50) return d;
  }
  return 6;
}

function TopicsDropdown({ topics }) {
  const COLORS = useColors();
  const [open, setOpen] = useState(false);
  const active = topics.filter(t => t.hz > 0);

  return (
    <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8 }}>
      {/* Summary row */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "transparent", border: "none", cursor: "pointer",
          padding: "10px 14px", fontFamily: "monospace", color: COLORS.textMuted,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase" }}>topics</span>
          <span style={{ display: "flex", gap: 4 }}>
            {active.map(t => (
              <span key={t.name} style={{ fontSize: 9, color: COLORS.accent, background: COLORS.accentDim, borderRadius: 3, padding: "1px 5px", fontFamily: "monospace" }}>
                {t.name.split("/").pop()} {t.hz}Hz
              </span>
            ))}
            {active.length === 0 && <span style={{ fontSize: 10, color: COLORS.textDim }}>no active topics</span>}
          </span>
        </div>
        <span style={{ fontSize: 10, color: COLORS.textDim, transition: "transform 0.2s", display: "inline-block", transform: open ? "rotate(180deg)" : "none" }}>▾</span>
      </button>

      {/* Expanded list */}
      {open && (
        <div style={{ borderTop: `0.5px solid ${COLORS.border}`, padding: "6px 14px 10px" }}>
          {topics.map(t => (
            <div key={t.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: `0.5px solid ${COLORS.border}` }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                background: t.hz > 0 ? COLORS.accent : COLORS.textDim,
                boxShadow: t.hz > 0 ? `0 0 4px ${COLORS.accent}` : "none",
              }} />
              <span style={{ flex: 1, fontSize: 11, color: COLORS.textMuted }}>{t.name}</span>
              <span style={{ fontSize: 10, color: COLORS.textDim, fontFamily: "monospace" }}>{t.type}</span>
              <span style={{ fontSize: 11, color: t.hz ? COLORS.accent : COLORS.textDim, fontFamily: "monospace", width: 52, textAlign: "right" }}>
                {t.hz ? `${t.hz}Hz` : "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SensorsView({ ros, status, simMode }) {
  const COLORS = useColors();
  const [mapMsg, setMapMsg]         = useState(null);
  const [scanRanges, setScanRanges] = useState([]);
  const [scanMeta, setScanMeta]     = useState(null);
  const [robotPose, setRobotPose]   = useState(null);

  const mapHz  = useTopicHz();
  const scanHz = useTopicHz();
  const odomHz = useTopicHz();
  const tfHz   = useTopicHz();

  useEffect(() => {
    if (!ros || status !== "connected" || simMode) return;
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
      setScanMeta({ min: msg.range_min, max: msg.range_max, rays: msg.ranges.length, frame: msg.header.frame_id });
    });
    subs.push(scanTopic);

    const odomTopic = new ROSLIB.Topic({ ros, name: "/mirte_base_controller/odom", messageType: "nav_msgs/Odometry" });
    odomTopic.subscribe((msg) => {
      odomHz.tick();
      const { x, y } = msg.pose.pose.position;
      const { z: qz, w: qw } = msg.pose.pose.orientation;
      const yaw = Math.atan2(2 * (qw * qz), 1 - 2 * qz * qz);
      setRobotPose({ x, y, yaw });
    });
    subs.push(odomTopic);

    const tfTopic = new ROSLIB.Topic({ ros, name: "/tf", messageType: "tf2_msgs/TFMessage" });
    tfTopic.subscribe(() => tfHz.tick());
    subs.push(tfTopic);

    return () => subs.forEach(s => s.unsubscribe());
  }, [ros, status, simMode]);

  useEffect(() => {
    if (!simMode) {
      setMapMsg(null); setScanRanges([]); setScanMeta(null); setRobotPose(null);
      return;
    }
    setMapMsg(SIM_MAP);
    setScanMeta({ min: 0.1, max: 6.0, rays: 360, frame: "sim_laser" });
    let theta = 0, lastT = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      theta += 0.3 * (now - lastT) / 1000; lastT = now;
      const x = Math.cos(theta), y = Math.sin(theta);
      const yaw = theta + Math.PI / 2;
      setRobotPose({ x, y, yaw });
      const ranges = Array.from({ length: 360 }, (_, i) =>
        simRaycast(x, y, yaw + (i / 360) * Math.PI * 2 - Math.PI)
      );
      setScanRanges(ranges);
      mapHz.tick(); scanHz.tick(); odomHz.tick();
    }, 100);
    return () => clearInterval(id);
  }, [simMode]);

  const topics = [
    { name: "/map",                            type: "nav_msgs/OccupancyGrid", hz: mapHz.hz },
    { name: "/scan",                           type: "sensor_msgs/LaserScan",  hz: scanHz.hz },
    { name: "/mirte_base_controller/odom",     type: "nav_msgs/Odometry",      hz: odomHz.hz },
    { name: "/tf",                             type: "tf2_msgs/TFMessage",     hz: tfHz.hz },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 12, padding: 16, flex: 1, overflow: "auto" }}>
      {/* Left: map + scan */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{
          flex: 1, background: COLORS.surface,
          border: `0.5px solid ${COLORS.border}`,
          borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8, minHeight: 400,
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
            {mapMsg ? (
              <MapCanvas mapMsg={mapMsg} robotPose={robotPose} />
            ) : (
              <div style={{ height: "100%", minHeight: 360, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
                <div style={{ width: 40, height: 40, border: `1px solid ${COLORS.border}`, borderTop: `1px solid ${COLORS.accent}`, borderRadius: "50%", animation: "spin 1.2s linear infinite" }} />
                <span style={{ fontSize: 12, color: COLORS.textMuted }}>waiting for /map…</span>
              </div>
            )}
          </div>
        </div>

        <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, padding: "10px 12px" }}>
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

      {/* Right sidebar */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <TopicsDropdown topics={topics} />

        {robotPose && (
          <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, padding: "12px 14px" }}>
            <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10, paddingBottom: 4, borderBottom: `0.5px solid ${COLORS.border}` }}>
              robot pose
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[["x", robotPose.x.toFixed(2), "m"], ["y", robotPose.y.toFixed(2), "m"], ["yaw", (robotPose.yaw * 180 / Math.PI).toFixed(1), "°"]].map(([l, v, u]) => (
                <div key={l} style={{ background: COLORS.surface, borderRadius: 6, padding: "10px 12px", border: `0.5px solid ${COLORS.border}` }}>
                  <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{l}</div>
                  <div style={{ fontSize: 18, fontWeight: 500, color: COLORS.text, fontFamily: "monospace" }}>{v}<span style={{ fontSize: 11, color: COLORS.textMuted, marginLeft: 2 }}>{u}</span></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {mapMsg && (
          <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, padding: "12px 14px" }}>
            <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10, paddingBottom: 4, borderBottom: `0.5px solid ${COLORS.border}` }}>
              map info
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                ["resolution", `${mapMsg.info?.resolution?.toFixed(3)} m/px`],
                ["size",       `${mapMsg.width}×${mapMsg.height} px`],
                ["origin x",  `${mapMsg.info?.origin?.position?.x?.toFixed(2)} m`],
                ["origin y",  `${mapMsg.info?.origin?.position?.y?.toFixed(2)} m`],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                  <span style={{ color: COLORS.textMuted }}>{k}</span>
                  <span style={{ color: COLORS.text, fontFamily: "monospace" }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
