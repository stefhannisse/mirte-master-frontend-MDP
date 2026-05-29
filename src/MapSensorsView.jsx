import { useEffect, useState } from "react";
import * as ROSLIB from "roslib";
import { MapCanvas, ScanCanvas, TopicRow, StatCard, SectionLabel, useTopicHz, COLORS } from "./shared.jsx";

// ── Simulation data ──────────────────────────────────────────────────────────

// 100×100 occupancy grid, 0.05 m/cell → 5 m × 5 m room, origin at (-2.5, -2.5)
// Array layout: data[row * W + col], row 0 = top of canvas (high world-y)
const SIM_MAP = (() => {
  const W = 100, H = 100, RES = 0.05;
  const data = new Array(W * H).fill(0);
  const fill = (c, r) => { if (c >= 0 && c < W && r >= 0 && r < H) data[r * W + c] = 100; };

  // Outer walls (3 cells thick)
  for (let i = 0; i < 100; i++)
    for (let t = 0; t < 3; t++) {
      fill(t, i); fill(99 - t, i); fill(i, t); fill(i, 99 - t);
    }

  // Box — top-left  (world x=-2.2..−1.4, y=1.4..2.2) → col 6-22, row 5-21
  for (let c = 6; c <= 22; c++)
    for (let r = 5; r <= 21; r++)
      if (c === 6 || c === 22 || r === 5 || r === 21) fill(c, r);

  // Box — bottom-right (world x=1.4..2.2, y=-2.2..−1.4) → col 78-94, row 77-93
  for (let c = 78; c <= 94; c++)
    for (let r = 77; r <= 93; r++)
      if (c === 78 || c === 94 || r === 77 || r === 93) fill(c, r);

  // Wall stub — right side (world x=1.8, y=-1.0..1.0) → col 86-87, row 29-69
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

// ── Component ────────────────────────────────────────────────────────────────

export default function MapSensorsView({ ros, status, simMode }) {
  const [mapMsg, setMapMsg]         = useState(null);
  const [scanRanges, setScanRanges] = useState([]);
  const [scanMeta, setScanMeta]     = useState(null);
  const [robotPose, setRobotPose]   = useState(null);

  const mapHz  = useTopicHz("/map");
  const scanHz = useTopicHz("/scan");
  const odomHz = useTopicHz("/mirte_base_controller/odom");
  const tfHz   = useTopicHz("/tf");

  // ROS subscriptions — disabled while sim is active
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
      const vx = msg.twist.twist.linear.x;
      const vy = msg.twist.twist.linear.y;
      setRobotPose({ x, y, yaw, speed: Math.sqrt(vx * vx + vy * vy) });
    });
    subs.push(odomTopic);

    const tfTopic = new ROSLIB.Topic({ ros, name: "/tf", messageType: "tf2_msgs/TFMessage" });
    tfTopic.subscribe(() => tfHz.tick());
    subs.push(tfTopic);

    return () => subs.forEach((s) => s.unsubscribe());
  }, [ros, status, simMode]);

  // Simulation — animated robot driving a 1 m-radius circle at 0.3 rad/s
  useEffect(() => {
    if (!simMode) {
      setMapMsg(null); setScanRanges([]); setScanMeta(null); setRobotPose(null);
      return;
    }

    setMapMsg(SIM_MAP);
    setScanMeta({ min: 0.1, max: 6.0, rays: 360, frame: "sim_laser" });

    let theta = 0;
    let lastT = performance.now();

    const id = setInterval(() => {
      const now = performance.now();
      theta += 0.3 * (now - lastT) / 1000;
      lastT = now;

      const x = Math.cos(theta), y = Math.sin(theta);
      const yaw = theta + Math.PI / 2;
      setRobotPose({ x, y, yaw, speed: 0.3 });

      const ranges = Array.from({ length: 360 }, (_, i) =>
        simRaycast(x, y, yaw + (i / 360) * Math.PI * 2 - Math.PI)
      );
      setScanRanges(ranges);

      mapHz.tick(); scanHz.tick(); odomHz.tick();
    }, 100);

    return () => clearInterval(id);
  }, [simMode]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 12, padding: 16, flex: 1, overflow: "auto" }}>
      {/* map panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 6, letterSpacing: "0.06em" }}>Robot state</div>
          <button>START discovery</button>
        </div>

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

      {/* sidebar */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, padding: "12px 14px" }}>
          <SectionLabel>topics</SectionLabel>
          <TopicRow name="/map" hz={mapHz.hz} active={mapHz.hz > 0} />
          <TopicRow name="/scan" hz={scanHz.hz} active={scanHz.hz > 0} />
          <TopicRow name="/mirte_base_controller/odom" hz={odomHz.hz} active={odomHz.hz > 0} />
          <TopicRow name="/tf" hz={tfHz.hz} active={tfHz.hz > 0} />
        </div>

        <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, padding: "12px 14px" }}>
          <SectionLabel>robot pose</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <StatCard label="x"     value={robotPose?.x?.toFixed(2)} unit="m" />
            <StatCard label="y"     value={robotPose?.y?.toFixed(2)} unit="m" />
            <StatCard label="yaw"   value={robotPose ? (robotPose.yaw * 180 / Math.PI).toFixed(1) : null} unit="°" />
            <StatCard label="speed" value={robotPose?.speed?.toFixed(2)} unit="m/s" />
          </div>
        </div>

        <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, padding: "12px 14px" }}>
          <SectionLabel>map info</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <StatCard label="resolution" value={mapMsg?.info?.resolution?.toFixed(3)} unit="m/px" />
            <StatCard label="size"       value={mapMsg ? `${mapMsg.width}×${mapMsg.height}` : null} unit="px" />
            <StatCard label="origin x"   value={mapMsg?.info?.origin?.position?.x?.toFixed(2)} unit="m" />
            <StatCard label="origin y"   value={mapMsg?.info?.origin?.position?.y?.toFixed(2)} unit="m" />
          </div>
        </div>
      </div>
    </div>
  );
}
