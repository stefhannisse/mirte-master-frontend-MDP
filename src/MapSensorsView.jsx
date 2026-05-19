import { useEffect, useState, useCallback } from "react";
import * as ROSLIB from "roslib";
import { MapCanvas, ScanCanvas, TopicRow, StatCard, SectionLabel, useTopicHz, COLORS } from "./shared.jsx";

export default function MapSensorsView({ ros, status }) {
  const [mapMsg, setMapMsg]       = useState(null);
  const [scanRanges, setScanRanges] = useState([]);
  const [scanMeta, setScanMeta]   = useState(null);
  const [robotPose, setRobotPose] = useState(null);

  const mapHz  = useTopicHz("/map");
  const scanHz = useTopicHz("/scan");
  const odomHz = useTopicHz("/mirte_base_controller/odom");
  const tfHz   = useTopicHz("/tf");

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
  }, [ros, status]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 12, padding: 16, flex: 1, overflow: "auto" }}>
      {/* map panel */}
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
