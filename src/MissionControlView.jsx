import { useEffect, useState, useRef, useCallback } from "react";
import * as ROSLIB_NAMESPACE from "roslib";
import { useColors, MapCanvas, labelToColor } from "./shared.jsx";

// Unpack the namespace context into a standard plain object using bracket notation strings.
// This completely bypasses the production bundler's strict named-export validation flags.
const ROSLIB = ROSLIB_NAMESPACE["default"] || ROSLIB_NAMESPACE;

// ── Simulation data ──────────────────────────────────────────────────────────

const SIM_MAP_DATA = (() => {
  const W = 100, H = 100, RES = 0.05;
  const data = new Array(W * H).fill(0);
  const fill = (c, r) => { if (c >= 0 && c < W && r >= 0 && r < H) data[r * W + c] = 100; };
  for (let i = 0; i < 100; i++)
    for (let t = 0; t < 3; t++) { fill(t, i); fill(99 - t, i); fill(i, t); fill(i, 99 - t); }
  for (let c = 6; c <= 22; c++) for (let r = 5; r <= 21; r++) if (c === 6 || c === 22 || r === 5 || r === 21) fill(c, r);
  for (let c = 78; c <= 94; c++) for (let r = 77; r <= 93; r++) if (c === 78 || c === 94 || r === 77 || r === 93) fill(c, r);
  for (let r = 29; r <= 69; r++) { fill(86, r); fill(87, r); }
  return { width: W, height: H, data, info: { resolution: RES, width: W, height: H, origin: { position: { x: -2.5, y: -2.5, z: 0 } } } };
})();

// Approach positions outside each plant bed / wall stub
const SIM_WAYPOINTS = [
  { x: -1.8, y:  1.0 },  // south of top-left bed
  { x: -1.0, y:  1.8 },  // east of top-left bed
  { x:  1.5, y:  0.3 },  // west of wall stub, upper section
  { x:  1.5, y: -0.6 },  // west of wall stub, lower section
  { x:  1.0, y: -1.8 },  // west of bottom-right bed
];

// Flower / pest detections scattered across the three plant areas
const SIM_DETECTIONS = [
  { track_id: 1,  label: "red/pink", position: { x: -2.0, y: 1.9, z: 0.3 }, observations: 28 },
  { track_id: 2,  label: "pink",     position: { x: -1.8, y: 1.9, z: 0.3 }, observations: 21 },
  { track_id: 3,  label: "red",      position: { x: -1.6, y: 1.9, z: 0.3 }, observations: 34 },
  { track_id: 4,  label: "white",    position: { x: -2.0, y: 1.6, z: 0.3 }, observations: 15 },
  { track_id: 5,  label: "bug",      position: { x: -1.8, y: 1.6, z: 0.3 }, observations:  6 },
  { track_id: 6,  label: "white",    position: { x: -1.6, y: 1.6, z: 0.3 }, observations: 19 },
  { track_id: 7,  label: "red",      position: { x:  1.70, y:  0.7, z: 0.3 }, observations: 12 },
  { track_id: 8,  label: "pink",     position: { x:  1.70, y:  0.0, z: 0.3 }, observations: 17 },
  { track_id: 9,  label: "white",    position: { x:  1.70, y: -0.7, z: 0.3 }, observations: 22 },
  { track_id: 10, label: "pink",     position: { x:  1.6,  y: -1.6, z: 0.3 }, observations:  9 },
  { track_id: 11, label: "red/pink", position: { x:  1.9,  y: -1.6, z: 0.3 }, observations: 22 },
  { track_id: 12, label: "red",      position: { x:  1.6,  y: -1.9, z: 0.3 }, observations: 11 },
  { track_id: 13, label: "bug",      position: { x:  1.9,  y: -1.9, z: 0.3 }, observations:  4 },
  { track_id: 14, label: "white",    position: { x:  2.05, y: -1.75, z: 0.3 }, observations: 16 },
  { track_id: 15, label: "pink",     position: { x: -0.4,  y:  0.3, z: 0.3 }, observations:  8 },
];

const SIM_SENSOR_DATA = [
  { temperature: 22.1, humidity: 58.2, co2: 412 },
  { temperature: 23.5, humidity: 62.1, co2: 445 },
  { temperature: 21.8, humidity: 55.8, co2: 398 },
  { temperature: 22.4, humidity: 57.0, co2: 421 },
  { temperature: 24.2, humidity: 64.5, co2: 461 },
];

function makeSimCameraImg(label) {
  const canvas = document.createElement("canvas");
  canvas.width = 640; canvas.height = 480;
  const ctx = canvas.getContext("2d");
  const color = labelToColor(label);

  // Background
  const bg = ctx.createRadialGradient(320, 240, 30, 320, 240, 300);
  bg.addColorStop(0, "#1a1c2a"); bg.addColorStop(1, "#0d0f14");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 640, 480);

  // Flower glow blob
  const fg = ctx.createRadialGradient(320, 230, 0, 320, 230, 90);
  fg.addColorStop(0, color); fg.addColorStop(0.45, color + "66"); fg.addColorStop(1, color + "00");
  ctx.beginPath(); ctx.arc(320, 230, 90, 0, Math.PI * 2);
  ctx.fillStyle = fg; ctx.fill();

  // Detection bounding box
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
  ctx.strokeRect(205, 130, 230, 210); ctx.setLineDash([]);

  // Corner marks
  [[205, 130], [435, 130], [205, 340], [435, 340]].forEach(([bx, by]) => {
    const sx = bx < 320 ? 1 : -1, sy = by < 280 ? 1 : -1;
    ctx.beginPath(); ctx.moveTo(bx, by + sy * 14); ctx.lineTo(bx, by); ctx.lineTo(bx + sx * 14, by);
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  });

  // Label chip
  ctx.fillStyle = color + "30"; ctx.fillRect(205, 105, label.length * 8 + 20, 22);
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(205, 105, label.length * 8 + 20, 22);
  ctx.fillStyle = color; ctx.font = "bold 12px monospace"; ctx.textAlign = "left";
  ctx.fillText(label, 213, 120);

  // Confidence
  const conf = (0.85 + Math.random() * 0.12).toFixed(2);
  ctx.fillStyle = "rgba(0,229,160,0.15)"; ctx.fillRect(205, 344, 112, 20);
  ctx.strokeStyle = "rgba(0,229,160,0.5)"; ctx.lineWidth = 1; ctx.strokeRect(205, 344, 112, 20);
  ctx.fillStyle = "#00e5a0"; ctx.font = "11px monospace";
  ctx.fillText(`conf  ${conf}`, 213, 358);

  // Watermark
  ctx.fillStyle = "rgba(255,255,255,0.07)"; ctx.textAlign = "right"; ctx.font = "10px monospace";
  ctx.fillText("● SIM", 630, 18);

  return canvas.toDataURL("image/jpeg", 0.85);
}

// ─────────────────────────────────────────────────────────────────────────────

const STATE_META = {
  IDLE:                   { label: "Idle",                    icon: "○", color: null,      desc: "System ready. Start a mission to begin autonomous greenhouse inspection." },
  STARTING_EXPLORATION:   { label: "Starting Exploration",    icon: "⋯", color: "warn",    desc: "Launching the frontier-based exploration stack…" },
  EXPLORATION:            { label: "Exploring",               icon: "◎", color: "warn",    desc: "Building a map of the greenhouse using frontier-based exploration. The robot autonomously navigates to unmapped areas." },
  STOPPING_EXPLORATION:   { label: "Stopping Exploration",    icon: "⋯", color: "warn",    desc: "Shutting down the exploration stack and waiting for stale nodes to disappear from the ROS graph." },
  STARTING_NAVIGATION:    { label: "Starting Navigation",     icon: "⋯", color: "accent",  desc: "Launching map_server, AMCL, and Nav2 against the saved map and pose." },
  PLANNING:               { label: "Planning Waypoints",      icon: "◈", color: "accent",  desc: "Analyzing the completed map to detect tulip boxes and generate optimal approach poses for inspection." },
  INSPECTION:             { label: "Navigating",              icon: "▶", color: "accent",  desc: "Navigating to the next tulip box inspection point using Nav2. The robot follows the computed path autonomously." },
  TULIP_INSPECTION:       { label: "Inspecting",              icon: "◉", color: "warn",    desc: "Robot has arrived at the waypoint. Camera inspection in progress — detecting tulip health with the ML model." },
  RETURNING_HOME:         { label: "Returning Home",          icon: "↩", color: "accent",  desc: "All waypoints visited. Navigating back to the start position." },
  ENTERING_TELEOPERATION: { label: "Entering Tele-operation", icon: "⋯", color: null,      desc: "Suspending autonomous operation and preparing for manual control." },
  TELEOPERATION:          { label: "Tele-operation",          icon: "◌", color: null,      desc: "Autonomous mission paused. Robot is under manual operation via the Tele-op page." },
  EXITING_TELEOPERATION:  { label: "Exiting Tele-operation",  icon: "⋯", color: null,      desc: "Leaving manual operation and restoring the suspended autonomous state." },
  DONE:                   { label: "Mission Complete",        icon: "✓", color: "success", desc: "Inspection complete. All tulip boxes have been visited and assessed." },
  ABORTED:                { label: "Aborted",                 icon: "✕", color: "error",   desc: "Mission was aborted." },
};

const ACTIVE_STATES = new Set([
  "STARTING_EXPLORATION", "EXPLORATION", "STOPPING_EXPLORATION",
  "STARTING_NAVIGATION", "PLANNING", "INSPECTION", "TULIP_INSPECTION", "RETURNING_HOME",
]);

function useRosService(ros, name) {
  return useCallback((onResult) => {
    if (!ros) return;
    const svc = new ROSLIB["Service"]({ ros, name, serviceType: "std_srvs/Trigger" });
    svc.callService({}, onResult, (err) => console.warn(name, err));
  }, [ros, name]);
}

function StateHeader({ state, progress, onAbort, onStart, onStopExploration }) {
  const COLORS = useColors();
  const meta = STATE_META[state] || STATE_META.IDLE;
  const [cur, total] = progress ? progress.split("/").map(Number) : [0, 0];
  const pct = total > 0 ? Math.round((cur / total) * 100) : 0;

  const stateColor =
    meta.color === "accent"  ? COLORS.accent :
    meta.color === "warn"    ? COLORS.warn :
    meta.color === "success" ? "#4ade80" :
    meta.color === "error"   ? "#f87171" :
    COLORS.textMuted;

  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 20,
      padding: "14px 20px", borderBottom: `0.5px solid ${COLORS.border}`,
      background: COLORS.surface, flexShrink: 0, flexWrap: "wrap",
    }}>
      {/* State */}
      <div style={{ flex: "1 1 280px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 16, color: stateColor, lineHeight: 1 }}>{meta.icon}</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: stateColor, letterSpacing: "0.05em" }}>
            {meta.label}
            {progress && ACTIVE_STATES.has(state) && state !== "EXPLORATION" && (
              <span style={{ color: COLORS.textMuted, fontWeight: 400 }}> — waypoint {cur} of {total}</span>
            )}
          </span>
        </div>
        <div style={{ fontSize: 11, color: COLORS.textMuted, lineHeight: 1.5 }}>{meta.desc}</div>
      </div>

      {/* Progress */}
      {total > 0 && state !== "EXPLORATION" && (
        <div style={{ flex: "0 0 200px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: COLORS.textMuted, marginBottom: 5, letterSpacing: "0.06em" }}>
            <span>PROGRESS</span>
            <span style={{ color: COLORS.accent, fontFamily: "monospace" }}>{progress}</span>
          </div>
          <div style={{ height: 4, background: COLORS.border, borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: COLORS.accent, borderRadius: 2, transition: "width 0.4s" }} />
          </div>
          <div style={{ fontSize: 10, color: COLORS.textDim, marginTop: 3, textAlign: "right", fontFamily: "monospace" }}>{pct}%</div>
        </div>
      )}

      {/* Controls */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
        {(state === "IDLE" || state === "ABORTED" || state === "DONE") && (
          <button onClick={onStart} style={{
            background: COLORS.accentDim, border: `0.5px solid ${COLORS.accent}`,
            borderRadius: 4, color: COLORS.accent, fontSize: 12,
            padding: "6px 16px", cursor: "pointer", fontFamily: "monospace",
            letterSpacing: "0.05em", transition: "all 0.2s",
          }}>
            ▶ Start Mission
          </button>
        )}
        {state === "EXPLORATION" && (
          <button onClick={onStopExploration} style={{
            background: "transparent", border: `0.5px solid ${COLORS.border}`,
            borderRadius: 4, color: COLORS.textMuted, fontSize: 12,
            padding: "6px 14px", cursor: "pointer", fontFamily: "monospace",
            letterSpacing: "0.05em",
          }}>
            ■ Stop Exploration
          </button>
        )}
        {ACTIVE_STATES.has(state) && (
          <button onClick={onAbort} style={{
            background: "rgba(248,113,113,0.12)", border: "0.5px solid #f87171",
            borderRadius: 4, color: "#f87171", fontSize: 12,
            padding: "6px 14px", cursor: "pointer", fontFamily: "monospace",
            letterSpacing: "0.05em", fontWeight: 500,
          }}>
            ✕ Emergency Stop
          </button>
        )}
      </div>
    </div>
  );
}

function FlowerOverview({ detections }) {
  const COLORS = useColors();
  const groups = {};
  detections.forEach(d => { const k = d.label || "unknown"; groups[k] = (groups[k] || 0) + 1; });
  const sorted = Object.entries(groups).sort(([, a], [, b]) => b - a);
  const total = detections.length;

  return (
    <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, paddingBottom: 4, borderBottom: `0.5px solid ${COLORS.border}` }}>
        detections
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: total > 0 ? 10 : 4 }}>
        <span style={{ fontSize: 26, fontWeight: 500, color: COLORS.text, fontFamily: "monospace", lineHeight: 1 }}>{total}</span>
        <span style={{ fontSize: 11, color: COLORS.textMuted }}>objects tracked</span>
      </div>
      {sorted.length === 0 ? (
        <div style={{ fontSize: 11, color: COLORS.textDim }}>no detections yet</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {sorted.map(([label, count]) => {
            const color = labelToColor(label);
            const pct = total > 0 ? (count / total) * 100 : 0;
            return (
              <div key={label}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: color, boxShadow: `0 0 4px ${color}` }} />
                  <span style={{ flex: 1, fontSize: 11, color: COLORS.textMuted, fontFamily: "monospace" }}>{label}</span>
                  <span style={{ fontSize: 12, color: COLORS.text, fontFamily: "monospace", fontWeight: 500 }}>{count}</span>
                </div>
                <div style={{ height: 2, background: COLORS.border, borderRadius: 1, overflow: "hidden", marginLeft: 15 }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 1, transition: "width 0.4s" }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ExplorationView({ mapMsg, robotPose, flowerDetections = [] }) {
  const COLORS = useColors();
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const secs = String(elapsed % 60).padStart(2, "0");

  return (
    <div style={{ display: "flex", flex: 1, gap: 16, padding: 16, overflow: "hidden" }}>
      {/* Map being built */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, color: COLORS.textMuted, letterSpacing: "0.06em" }}>
            /map — building occupancy grid
          </span>
          <span style={{ fontSize: 11, color: COLORS.textDim, fontFamily: "monospace" }}>
            elapsed {mins}:{secs}
          </span>
        </div>
        <div style={{
          flex: 1, background: COLORS.surface, border: `0.5px solid ${COLORS.border}`,
          borderRadius: 8, overflow: "hidden", minHeight: 300, position: "relative",
        }}>
          {mapMsg ? (
            <MapCanvas mapMsg={mapMsg} robotPose={robotPose} flowerDetections={flowerDetections} />
          ) : (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
              <div style={{ width: 40, height: 40, border: `1px solid ${COLORS.border}`, borderTop: `1px solid ${COLORS.accent}`, borderRadius: "50%", animation: "spin 1.2s linear infinite" }} />
              <span style={{ fontSize: 12, color: COLORS.textMuted }}>waiting for /map…</span>
            </div>
          )}
        </div>
      </div>

      {/* Info sidebar */}
      <div style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10, paddingBottom: 4, borderBottom: `0.5px solid ${COLORS.border}` }}>
            exploration
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              ["status", <span style={{ color: COLORS.warn }}>● active</span>],
              ["strategy", "frontier-based"],
              ["tool", "explore_lite"],
              ["elapsed", <span style={{ fontFamily: "monospace" }}>{mins}:{secs}</span>],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: COLORS.textMuted }}>{k}</span>
                <span style={{ color: COLORS.text }}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {mapMsg && (
          <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, padding: "12px 14px" }}>
            <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10, paddingBottom: 4, borderBottom: `0.5px solid ${COLORS.border}` }}>
              map stats
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                ["size", `${mapMsg.width}×${mapMsg.height}px`],
                ["resolution", `${mapMsg.info?.resolution?.toFixed(3)}m/px`],
                ["known cells", `${mapMsg.data.filter(v => v !== -1).length}`],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                  <span style={{ color: COLORS.textMuted }}>{k}</span>
                  <span style={{ color: COLORS.text, fontFamily: "monospace" }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {robotPose && (
          <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, padding: "12px 14px" }}>
            <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10, paddingBottom: 4, borderBottom: `0.5px solid ${COLORS.border}` }}>
              robot pose
            </div>
            {[
              ["x", `${robotPose.x.toFixed(2)} m`],
              ["y", `${robotPose.y.toFixed(2)} m`],
              ["yaw", `${(robotPose.yaw * 180 / Math.PI).toFixed(1)}°`],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 6 }}>
                <span style={{ color: COLORS.textMuted }}>{k}</span>
                <span style={{ color: COLORS.text, fontFamily: "monospace" }}>{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TagReadingsPanel({ tagReadings }) {
  const COLORS = useColors();
  const entries = Object.values(tagReadings).sort((a, b) => a.tag_id - b.tag_id);
  if (entries.length === 0) return null;

  return (
    <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, paddingBottom: 4, borderBottom: `0.5px solid ${COLORS.border}` }}>
        sensor log
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, maxHeight: 180, overflowY: "auto" }}>
        {entries.map(entry => {
          const sd = entry.sensor_data || {};
          return (
            <div key={entry.tag_id} style={{ padding: "6px 0", borderBottom: `0.5px solid ${COLORS.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 9, color: COLORS.accent, background: COLORS.accentDim, borderRadius: 2, padding: "1px 6px", fontFamily: "monospace" }}>
                  tag #{entry.tag_id}
                </span>
                {entry.robot_position && (
                  <span style={{ fontSize: 9, color: COLORS.textDim, fontFamily: "monospace" }}>
                    {entry.robot_position.x?.toFixed(1)}, {entry.robot_position.y?.toFixed(1)}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", paddingLeft: 2 }}>
                {sd.temperature != null && (
                  <span style={{ fontSize: 10, color: COLORS.textMuted }}>
                    <span style={{ color: COLORS.warn, fontFamily: "monospace" }}>{sd.temperature.toFixed(1)}</span> °C
                  </span>
                )}
                {sd.humidity != null && (
                  <span style={{ fontSize: 10, color: COLORS.textMuted }}>
                    <span style={{ color: "#60a5fa", fontFamily: "monospace" }}>{sd.humidity.toFixed(1)}</span> %
                  </span>
                )}
                {sd.co2 != null && (
                  <span style={{ fontSize: 10, color: COLORS.textMuted }}>
                    <span style={{ color: "#4ade80", fontFamily: "monospace" }}>{sd.co2}</span> ppm
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InspectionMapView({ mapMsg, robotPose, waypoints, activeWaypointIdx, state, flowerDetections = [], tagReadings = {} }) {
  const COLORS = useColors();
  const [cur, total] = activeWaypointIdx >= 0
    ? [activeWaypointIdx + 1, waypoints.length]
    : [0, waypoints.length];

  return (
    <div style={{ display: "flex", flex: 1, gap: 16, padding: 16, overflow: "hidden" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, color: COLORS.textMuted, letterSpacing: "0.06em" }}>
            /map — inspection route
          </span>
          {waypoints.length > 0 && (
            <span style={{ fontSize: 11, color: COLORS.textDim, fontFamily: "monospace" }}>
              {waypoints.length} waypoints · {cur}/{total} visited
            </span>
          )}
        </div>
        <div style={{ flex: 1, background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, overflow: "hidden", minHeight: 300 }}>
          {mapMsg ? (
            <MapCanvas mapMsg={mapMsg} robotPose={robotPose} waypoints={waypoints} activeWaypointIdx={activeWaypointIdx} flowerDetections={flowerDetections} />
          ) : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 12, color: COLORS.textMuted }}>waiting for /map…</span>
            </div>
          )}
        </div>
      </div>

      <div style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <FlowerOverview detections={flowerDetections} />

        <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10, paddingBottom: 4, borderBottom: `0.5px solid ${COLORS.border}` }}>
            waypoints
          </div>
          {waypoints.length === 0 ? (
            <div style={{ fontSize: 11, color: COLORS.textDim }}>no waypoints received yet</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 200, overflowY: "auto" }}>
              {waypoints.map((wp, i) => {
                const isActive = i === activeWaypointIdx;
                const isVisited = activeWaypointIdx >= 0 && i < activeWaypointIdx;
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "4px 0", fontSize: 11,
                    color: isActive ? COLORS.accent : isVisited ? COLORS.textDim : COLORS.textMuted,
                  }}>
                    <span style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center", background: isActive ? COLORS.accentDim : "transparent", border: `0.5px solid ${isActive ? COLORS.accent : COLORS.border}`, color: isActive ? COLORS.accent : COLORS.textDim }}>
                      {i + 1}
                    </span>
                    <span style={{ fontFamily: "monospace" }}>
                      {wp.x.toFixed(2)}, {wp.y.toFixed(2)}
                    </span>
                    {isVisited && <span style={{ marginLeft: "auto", color: "#4ade80", fontSize: 10 }}>✓</span>}
                    {isActive && <span style={{ marginLeft: "auto", color: COLORS.accent, fontSize: 9 }}>▶ nav</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <TagReadingsPanel tagReadings={tagReadings} />

        {robotPose && (
          <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, padding: "12px 14px" }}>
            <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10, paddingBottom: 4, borderBottom: `0.5px solid ${COLORS.border}` }}>
              robot pose
            </div>
            {[["x", `${robotPose.x.toFixed(2)} m`], ["y", `${robotPose.y.toFixed(2)} m`], ["yaw", `${(robotPose.yaw * 180 / Math.PI).toFixed(1)}°`], ["speed", `${(robotPose.speed ?? 0).toFixed(2)} m/s`]].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 6 }}>
                <span style={{ color: COLORS.textMuted }}>{k}</span>
                <span style={{ color: COLORS.text, fontFamily: "monospace" }}>{v}</span>
              </div>
            ))}
          </div>
        )}

        {state === "RETURNING_HOME" && (
          <div style={{ background: COLORS.surface, border: `0.5px solid #4ade80`, borderRadius: 8, padding: "12px 14px" }}>
            <div style={{ fontSize: 11, color: "#4ade80", lineHeight: 1.5 }}>
              ✓ All {waypoints.length} waypoints inspected. Returning to start.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TulipInspectionView({ cameraImg, detectionImg, mapMsg, robotPose, waypoints, activeWaypointIdx, flowerDetections = [], sensorReadings = null }) {
  const COLORS = useColors();
  const [camMode, setCamMode] = useState("detection");
  const displayImg = camMode === "detection" ? (detectionImg || cameraImg) : cameraImg;

  return (
    <div style={{ display: "flex", flex: 1, gap: 16, padding: 16, overflow: "hidden" }}>
      {/* Camera feed - primary */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, color: COLORS.textMuted, letterSpacing: "0.06em" }}>camera feed</span>
          <div style={{ display: "flex", gap: 4 }}>
            {["detection", "raw"].map(mode => (
              <button key={mode} onClick={() => setCamMode(mode)} style={{
                background: camMode === mode ? COLORS.accentDim : "transparent",
                border: `0.5px solid ${camMode === mode ? COLORS.accent : COLORS.border}`,
                borderRadius: 3, color: camMode === mode ? COLORS.accent : COLORS.textMuted,
                fontSize: 10, padding: "3px 10px", cursor: "pointer", fontFamily: "monospace",
              }}>{mode}</button>
            ))}
          </div>
        </div>
        <div style={{
          flex: 1, background: "#000", border: `0.5px solid ${COLORS.border}`,
          borderRadius: 8, overflow: "hidden", minHeight: 300, position: "relative",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {displayImg ? (
            <img src={displayImg} alt="camera" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <div style={{ width: 40, height: 40, border: `1px solid ${COLORS.border}`, borderTop: `1px solid ${COLORS.accent}`, borderRadius: "50%", animation: "spin 1.2s linear infinite" }} />
              <span style={{ fontSize: 12, color: COLORS.textMuted }}>waiting for camera stream…</span>
              <span style={{ fontSize: 10, color: COLORS.textDim }}>
                {camMode === "detection" ? "/camera/detection/compressed" : "/camera/image_raw/compressed"}
              </span>
            </div>
          )}
          <div style={{ position: "absolute", top: 8, left: 8, fontSize: 9, color: COLORS.accent, fontFamily: "monospace", background: "rgba(0,0,0,0.6)", padding: "2px 6px", borderRadius: 3 }}>
            ● LIVE · {camMode.toUpperCase()}
          </div>
        </div>
      </div>

      {/* Minimap + info */}
      <div style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.08em", marginBottom: 8 }}>inspection point</div>
          {activeWaypointIdx >= 0 && waypoints[activeWaypointIdx] && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: COLORS.textMuted }}>waypoint</span>
                <span style={{ color: COLORS.accent, fontFamily: "monospace" }}>#{activeWaypointIdx + 1} of {waypoints.length}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: COLORS.textMuted }}>position</span>
                <span style={{ color: COLORS.text, fontFamily: "monospace" }}>
                  {waypoints[activeWaypointIdx].x.toFixed(2)}, {waypoints[activeWaypointIdx].y.toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </div>

        {sensorReadings ? (
          <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8, paddingBottom: 4, borderBottom: `0.5px solid ${COLORS.border}` }}>
              sensor readings
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                ["temperature", sensorReadings.temperature?.toFixed(1), "°C",  COLORS.warn],
                ["humidity",    sensorReadings.humidity?.toFixed(1),    "%",   "#60a5fa"],
                ["CO₂",        sensorReadings.co2,                     "ppm", "#4ade80"],
              ].map(([k, v, u, c]) => v != null && (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: c, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 11, color: COLORS.textMuted }}>{k}</span>
                  <span style={{ fontSize: 13, color: COLORS.text, fontFamily: "monospace", fontWeight: 500 }}>
                    {v}<span style={{ fontSize: 10, color: COLORS.textDim, marginLeft: 2 }}>{u}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>sensor readings</div>
            <div style={{ fontSize: 11, color: COLORS.textDim }}>waiting for sensor data…</div>
          </div>
        )}

        <div style={{ flex: 1, background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, overflow: "hidden", minHeight: 180 }}>
          {mapMsg ? (
            <MapCanvas mapMsg={mapMsg} robotPose={robotPose} waypoints={waypoints} activeWaypointIdx={activeWaypointIdx} flowerDetections={flowerDetections} />
          ) : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 11, color: COLORS.textMuted }}>no map</span>
            </div>
          )}
        </div>

        <FlowerOverview detections={flowerDetections} />

        <div style={{ background: "rgba(248,113,113,0.08)", border: "0.5px solid rgba(248,113,113,0.4)", borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ fontSize: 10, color: "#f87171", letterSpacing: "0.08em", marginBottom: 4 }}>ml detections</div>
          <div style={{ fontSize: 11, color: COLORS.textMuted }}>
            {detectionImg ? "Model output streamed via /camera/detection/compressed" : "Waiting for detection stream…"}
          </div>
        </div>
      </div>
    </div>
  );
}

const TRANSITION_STATES = new Set([
  "STARTING_EXPLORATION", "STOPPING_EXPLORATION", "STARTING_NAVIGATION",
  "ENTERING_TELEOPERATION", "EXITING_TELEOPERATION",
]);

function TransitionView({ state }) {
  const COLORS = useColors();
  const meta = STATE_META[state] || STATE_META.IDLE;
  const stateColor =
    meta.color === "accent" ? COLORS.accent :
    meta.color === "warn"   ? COLORS.warn :
    COLORS.textMuted;
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 40 }}>
      <div style={{ width: 36, height: 36, border: `1px solid ${COLORS.border}`, borderTop: `1px solid ${stateColor}`, borderRadius: "50%", animation: "spin 1.2s linear infinite" }} />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 13, color: stateColor, fontFamily: "monospace", marginBottom: 8, letterSpacing: "0.05em" }}>{meta.label}</div>
        <div style={{ fontSize: 12, color: COLORS.textMuted, maxWidth: 380, lineHeight: 1.6 }}>{meta.desc}</div>
      </div>
    </div>
  );
}

function TeleopHoldView() {
  const COLORS = useColors();
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 40 }}>
      <div style={{ fontSize: 40, color: COLORS.textDim }}>◌</div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 13, color: COLORS.text, fontFamily: "monospace", marginBottom: 8 }}>Manual Operation Active</div>
        <div style={{ fontSize: 12, color: COLORS.textMuted, maxWidth: 380, lineHeight: 1.6 }}>
          Autonomous mission is paused. Switch to the Tele-op page to control the robot. Disable tele-operation there to resume the mission.
        </div>
      </div>
    </div>
  );
}

function IdleView({ onStartNavigation, onStartExploration }) {
  const COLORS = useColors();
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: 40 }}>
      <div style={{ fontSize: 48, color: COLORS.textDim }}>○</div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 14, color: COLORS.text, fontFamily: "monospace", marginBottom: 8 }}>System Ready</div>
        <div style={{ fontSize: 12, color: COLORS.textMuted, maxWidth: 360, lineHeight: 1.6 }}>
          Press Start Mission to begin autonomous greenhouse inspection. The robot will explore, map, detect tulip boxes, and inspect each one.
        </div>
      </div>
      <button onClick={onStartNavigation} style={{
        background: COLORS.accentDim, border: `0.5px solid ${COLORS.accent}`,
        borderRadius: 6, color: COLORS.accent, fontSize: 13,
        padding: "10px 28px", cursor: "pointer", fontFamily: "monospace",
        letterSpacing: "0.06em", transition: "all 0.2s",
      }}>
        ▶ Start Navigation
      </button>
      <button onClick={onStartExploration} style={{
        background: COLORS.accentDim, border: `0.5px solid ${COLORS.accent}`,
        borderRadius: 6, color: COLORS.accent, fontSize: 13,
        padding: "10px 28px", cursor: "pointer", fontFamily: "monospace",
        letterSpacing: "0.06em", transition: "all 0.2s",
      }}>
        ▶ Start Exploration
      </button>
    </div>
  );
}

function DoneView({ waypoints, onStart }) {
  const COLORS = useColors();
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: 40 }}>
      <div style={{ fontSize: 48, color: "#4ade80" }}>✓</div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 14, color: "#4ade80", fontFamily: "monospace", marginBottom: 8 }}>Mission Complete</div>
        <div style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.6 }}>
          All {waypoints.length > 0 ? waypoints.length : ""} tulip boxes have been inspected. The robot has returned to its start position.
        </div>
      </div>
      <button onClick={onStart} style={{
        background: "transparent", border: `0.5px solid ${COLORS.border}`,
        borderRadius: 6, color: COLORS.textMuted, fontSize: 12,
        padding: "8px 22px", cursor: "pointer", fontFamily: "monospace",
      }}>
        ↺ Start New Mission
      </button>
    </div>
  );
}

export default function MissionControlView({ ros, status, simMode }) {
  const [missionState, setMissionState]   = useState(null); // null = waiting for latched state from ROS
  const [progress, setProgress]           = useState(null);
  const [mapMsg, setMapMsg]               = useState(null);
  const [robotPose, setRobotPose]         = useState(null);
  const [waypoints, setWaypoints]         = useState([]);
  const [cameraImg, setCameraImg]         = useState(null);
  const [detectionImg, setDetectionImg]   = useState(null);
  const [flowerDetections, setFlowerDetections] = useState([]);
  const [sensorReadings, setSensorReadings]     = useState(null);
  const [tagReadings, setTagReadings]           = useState({});  // { [tag_id]: { tag_id, sensor_data, robot_position } }

  const callStartExploration    = useRosService(ros, "/mission_executive_node/start_exploration");
  const callStartNavigation    = useRosService(ros, "/mission_executive_node/start_navigation");
  const callDone     = useRosService(ros, "/mission_executive_node/skip_exploration");
  const callAbort    = useRosService(ros, "/mission_executive_node/abort");

  // Parse progress "3/8" → active waypoint index 2
  const [curWp] = progress ? progress.split("/").map(Number) : [0];
  const activeWaypointIdx = curWp > 0 ? curWp - 1 : -1;

  useEffect(() => {
    if (!ros || status !== "connected" || simMode) {
      if (!simMode) { setMissionState(null); setFlowerDetections([]); setTagReadings({}); }
      return;
    }
    const subs = [];

    const stateTopic = new ROSLIB["Topic"]({ ros, name: "/mission_executive_node/state", messageType: "std_msgs/String" });
    stateTopic.subscribe((msg) => setMissionState(msg.data));
    subs.push(stateTopic);

    const progressTopic = new ROSLIB["Topic"]({ ros, name: "/mission_executive_node/progress", messageType: "std_msgs/String" });
    progressTopic.subscribe((msg) => setProgress(msg.data));
    subs.push(progressTopic);

    const mapTopic = new ROSLIB["Topic"]({ ros, name: "/map", messageType: "nav_msgs/OccupancyGrid" });
    mapTopic.subscribe((msg) => setMapMsg({ width: msg.info.width, height: msg.info.height, data: msg.data, info: msg.info }));
    subs.push(mapTopic);

    const odomTopic = new ROSLIB["Topic"]({ ros, name: "/mirte_base_controller/odom", messageType: "nav_msgs/Odometry" });
    odomTopic.subscribe((msg) => {
      const { x, y } = msg.pose.pose.position;
      const { z: qz, w: qw } = msg.pose.pose.orientation;
      const yaw = Math.atan2(2 * (qw * qz), 1 - 2 * qz * qz);
      const vx = msg.twist.twist.linear.x, vy = msg.twist.twist.linear.y;
      setRobotPose({ x, y, yaw, speed: Math.sqrt(vx * vx + vy * vy) });
    });
    subs.push(odomTopic);

    const wpTopic = new ROSLIB["Topic"]({ ros, name: "/inspection_waypoints", messageType: "geometry_msgs/PoseArray" });
    wpTopic.subscribe((msg) => setWaypoints(msg.poses.map(p => ({ x: p.position.x, y: p.position.y }))));
    subs.push(wpTopic);

    const camTopic = new ROSLIB["Topic"]({ ros, name: "/camera/image_raw/compressed", messageType: "sensor_msgs/CompressedImage" });
    camTopic.subscribe((msg) => setCameraImg(`data:image/jpeg;base64,${msg.data}`));
    subs.push(camTopic);

    const detTopic = new ROSLIB["Topic"]({ ros, name: "/camera/detection/compressed", messageType: "sensor_msgs/CompressedImage" });
    detTopic.subscribe((msg) => setDetectionImg(`data:image/jpeg;base64,${msg.data}`));
    subs.push(detTopic);

    // /greenvision/xyz — JSON-encoded std_msgs/String containing object detections
    const xyzTopic = new ROSLIB["Topic"]({ ros, name: "/greenvision/xyz", messageType: "std_msgs/String" });
    xyzTopic.subscribe((msg) => {
      try { setFlowerDetections(JSON.parse(msg.data).objects || []); }
      catch (e) { console.warn("/greenvision/xyz parse error:", e); }
    });
    subs.push(xyzTopic);

    // AprilTag sensor readings — temperature (+ optional humidity / CO₂) per detected tag
    const aprilTagTopic = new ROSLIB["Topic"]({ ros, name: "/data/apriltag", messageType: "std_msgs/String" });
    aprilTagTopic.subscribe((msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (!data.detections?.length) return;
        setSensorReadings(data.detections[0].sensor_data);
        setTagReadings(prev => {
          const next = { ...prev };
          data.detections.forEach(det => {
            if (det.sensor_data) next[det.id] = { tag_id: det.id, sensor_data: det.sensor_data, robot_position: data.robot_position };
          });
          return next;
        });
      } catch (e) { console.warn("/data/apriltag parse error:", e); }
    });
    subs.push(aprilTagTopic);

    return () => subs.forEach(s => s.unsubscribe());
  }, [ros, status, simMode]);

  // Animated sim loop — runs only when simMode is on
  useEffect(() => {
    if (!simMode) {
      if (status !== "connected") { setMissionState(null); setSensorReadings(null); }
      return;
    }

    setMapMsg(SIM_MAP_DATA);
    setFlowerDetections(SIM_DETECTIONS);
    setWaypoints(SIM_WAYPOINTS);
    setMissionState("INSPECTION");
    setProgress(`1/${SIM_WAYPOINTS.length}`);

    let wpIdx = 0, phase = "moving", rx = 0, ry = 0, phaseTicks = 0;

    const id = setInterval(() => {
      if (phase === "moving") {
        const wp = SIM_WAYPOINTS[wpIdx];
        const dx = wp.x - rx, dy = wp.y - ry;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.07) {
          rx = wp.x; ry = wp.y;
          phase = "inspecting"; phaseTicks = 0;
          setMissionState("TULIP_INSPECTION");
        } else {
          const spd = 0.05;
          rx += (dx / dist) * spd; ry += (dy / dist) * spd;
          setRobotPose({ x: rx, y: ry, yaw: Math.atan2(dy, dx) - Math.PI / 2, speed: 0.12 });
        }
      } else if (phase === "inspecting") {
        if (phaseTicks === 0) {
          const wp = SIM_WAYPOINTS[wpIdx];
          const nearest = SIM_DETECTIONS.reduce((best, d) => {
            const dd = Math.hypot(d.position.x - wp.x, d.position.y - wp.y);
            return dd < best.dist ? { d, dist: dd } : best;
          }, { d: SIM_DETECTIONS[0], dist: Infinity }).d;
          const img = makeSimCameraImg(nearest.label);
          setCameraImg(img); setDetectionImg(img);
          const sd = SIM_SENSOR_DATA[wpIdx % SIM_SENSOR_DATA.length];
          setSensorReadings(sd);
          const tagId = wpIdx + 1;
          setTagReadings(prev => ({ ...prev, [tagId]: { tag_id: tagId, sensor_data: sd, robot_position: SIM_WAYPOINTS[wpIdx] } }));
        }
        phaseTicks++;
        if (phaseTicks > 38) {
          setCameraImg(null); setDetectionImg(null);
          wpIdx++;
          if (wpIdx >= SIM_WAYPOINTS.length) {
            phase = "returning"; phaseTicks = 0;
            setMissionState("RETURNING_HOME"); setProgress(null);
          } else {
            phase = "moving";
            setMissionState("INSPECTION");
            setProgress(`${wpIdx + 1}/${SIM_WAYPOINTS.length}`);
          }
        }
      } else if (phase === "returning") {
        const dx = -rx, dy = -ry;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.07) {
          rx = 0; ry = 0;
          setRobotPose({ x: 0, y: 0, yaw: 0, speed: 0 });
          setMissionState("DONE"); phase = "done"; phaseTicks = 0;
        } else {
          const spd = 0.05;
          rx += (dx / dist) * spd; ry += (dy / dist) * spd;
          setRobotPose({ x: rx, y: ry, yaw: Math.atan2(dy, dx) - Math.PI / 2, speed: 0.12 });
        }
      } else if (phase === "done") {
        phaseTicks++;
        if (phaseTicks > 45) {
          wpIdx = 0; rx = 0; ry = 0; phase = "moving"; phaseTicks = 0;
          setMissionState("INSPECTION");
          setProgress(`1/${SIM_WAYPOINTS.length}`);
          setSensorReadings(null);
          setTagReadings({});
          setRobotPose({ x: 0, y: 0, yaw: 0, speed: 0 });
        }
      }
    }, 100);

    return () => clearInterval(id);
  }, [simMode]);

  const handleStartNavigation = () => callStartNavigation((r) => console.log("start_mission:", r));
  const handleStartExploration = () => callStartExploration((r) => console.log("start_mission:", r));
  const handleStop  = () => callDone((r) => console.log("exploration_done:", r));
  const handleAbort = () => callAbort((r) => { console.log("abort:", r); setMissionState("ABORTED"); });

  const COLORS = useColors();

  // Waiting for the latched state message from ROS
  if (missionState === null) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
        {status === "connected" ? (
          <>
            <div style={{ width: 32, height: 32, border: `1px solid ${COLORS.border}`, borderTop: `1px solid ${COLORS.accent}`, borderRadius: "50%", animation: "spin 1.2s linear infinite" }} />
            <span style={{ fontSize: 12, color: COLORS.textMuted, fontFamily: "monospace" }}>reading mission state…</span>
            <span style={{ fontSize: 10, color: COLORS.textDim }}>subscribing to /mission_executive_node/state</span>
          </>
        ) : (
          <>
            <span style={{ fontSize: 32, color: COLORS.textDim }}>○</span>
            <span style={{ fontSize: 12, color: COLORS.textMuted }}>connect to rosbridge to see mission state</span>
          </>
        )}
      </div>
    );
  }

  const showMap        = ["PLANNING", "INSPECTION", "RETURNING_HOME"].includes(missionState);
  const showTulip      = missionState === "TULIP_INSPECTION";
  const showExploration= missionState === "EXPLORATION";
  const showIdle       = missionState === "IDLE";
  const showDone       = missionState === "DONE";
  const showAborted    = missionState === "ABORTED";
  const showTransition = TRANSITION_STATES.has(missionState);
  const showTeleop     = missionState === "TELEOPERATION";

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      <StateHeader
        state={missionState}
        progress={progress}
        onAbort={handleAbort}
        onStart={handleStartExploration}
        onStopExploration={handleStop}
      />

      {(showIdle || showAborted) && <IdleView onStartExploration={handleStartExploration} onStartNavigation={handleStartNavigation} />}
      {showDone && <DoneView waypoints={waypoints} onStart={handleStartExploration} />}
      {showTransition && <TransitionView state={missionState} />}
      {showTeleop && <TeleopHoldView />}
      {showExploration && <ExplorationView mapMsg={mapMsg} robotPose={robotPose} flowerDetections={flowerDetections} />}
      {showMap && (
        <InspectionMapView
          mapMsg={mapMsg}
          robotPose={robotPose}
          waypoints={waypoints}
          activeWaypointIdx={activeWaypointIdx}
          state={missionState}
          flowerDetections={flowerDetections}
          tagReadings={tagReadings}
        />
      )}
      {showTulip && (
        <TulipInspectionView
          cameraImg={cameraImg}
          detectionImg={detectionImg}
          mapMsg={mapMsg}
          robotPose={robotPose}
          waypoints={waypoints}
          activeWaypointIdx={activeWaypointIdx}
          flowerDetections={flowerDetections}
          sensorReadings={sensorReadings}
        />
      )}

      {/* PLANNING — waiting for first waypoint */}
      {missionState === "PLANNING" && waypoints.length === 0 && (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", textAlign: "center" }}>
          <div style={{ width: 32, height: 32, border: `1px solid ${COLORS.border}`, borderTop: `1px solid ${COLORS.accent}`, borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 10px" }} />
          <div style={{ fontSize: 12, color: COLORS.textMuted }}>Generating waypoints…</div>
        </div>
      )}
    </div>
  );
}