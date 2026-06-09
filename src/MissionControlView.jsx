import { useEffect, useState, useRef, useCallback } from "react";
import * as ROSLIB from "roslib";
import { useColors, MapCanvas } from "./shared.jsx";

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
    const svc = new ROSLIB.Service({ ros, name, serviceType: "std_srvs/Trigger" });
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

function ExplorationView({ mapMsg, robotPose }) {
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
            <MapCanvas mapMsg={mapMsg} robotPose={robotPose} />
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

function InspectionMapView({ mapMsg, robotPose, waypoints, activeWaypointIdx, state }) {
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
            <MapCanvas mapMsg={mapMsg} robotPose={robotPose} waypoints={waypoints} activeWaypointIdx={activeWaypointIdx} />
          ) : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 12, color: COLORS.textMuted }}>waiting for /map…</span>
            </div>
          )}
        </div>
      </div>

      <div style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
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

function TulipInspectionView({ cameraImg, detectionImg, mapMsg, robotPose, waypoints, activeWaypointIdx }) {
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

        <div style={{ flex: 1, background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, overflow: "hidden", minHeight: 180 }}>
          {mapMsg ? (
            <MapCanvas mapMsg={mapMsg} robotPose={robotPose} waypoints={waypoints} activeWaypointIdx={activeWaypointIdx} />
          ) : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 11, color: COLORS.textMuted }}>no map</span>
            </div>
          )}
        </div>

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
  const [missionState, setMissionState] = useState(null); // null = waiting for latched state from ROS
  const [progress, setProgress]         = useState(null);
  const [mapMsg, setMapMsg]             = useState(null);
  const [robotPose, setRobotPose]       = useState(null);
  const [waypoints, setWaypoints]       = useState([]);
  const [cameraImg, setCameraImg]       = useState(null);
  const [detectionImg, setDetectionImg] = useState(null);

  const callStartExploration    = useRosService(ros, "/mission_executive_node/start_exploration");
  const callStartNavigation    = useRosService(ros, "/mission_executive_node/start_navigation");
  const callDone     = useRosService(ros, "/mission_executive_node/exploration_done");
  const callAbort    = useRosService(ros, "/mission_executive_node/abort");

  // Parse progress "3/8" → active waypoint index 2
  const [curWp] = progress ? progress.split("/").map(Number) : [0];
  const activeWaypointIdx = curWp > 0 ? curWp - 1 : -1;

  useEffect(() => {
    if (!ros || status !== "connected") {
      setMissionState(null); // clear stale state on disconnect
      return;
    }
    const subs = [];

    const stateTopic = new ROSLIB.Topic({ ros, name: "/mission_executive_node/state", messageType: "std_msgs/String" });
    stateTopic.subscribe((msg) => setMissionState(msg.data));
    subs.push(stateTopic);

    const progressTopic = new ROSLIB.Topic({ ros, name: "/mission_executive_node/progress", messageType: "std_msgs/String" });
    progressTopic.subscribe((msg) => setProgress(msg.data));
    subs.push(progressTopic);

    const mapTopic = new ROSLIB.Topic({ ros, name: "/map", messageType: "nav_msgs/OccupancyGrid" });
    mapTopic.subscribe((msg) => setMapMsg({ width: msg.info.width, height: msg.info.height, data: msg.data, info: msg.info }));
    subs.push(mapTopic);

    const odomTopic = new ROSLIB.Topic({ ros, name: "/mirte_base_controller/odom", messageType: "nav_msgs/Odometry" });
    odomTopic.subscribe((msg) => {
      const { x, y } = msg.pose.pose.position;
      const { z: qz, w: qw } = msg.pose.pose.orientation;
      const yaw = Math.atan2(2 * (qw * qz), 1 - 2 * qz * qz);
      const vx = msg.twist.twist.linear.x, vy = msg.twist.twist.linear.y;
      setRobotPose({ x, y, yaw, speed: Math.sqrt(vx * vx + vy * vy) });
    });
    subs.push(odomTopic);

    const wpTopic = new ROSLIB.Topic({ ros, name: "/inspection_waypoints", messageType: "geometry_msgs/PoseArray" });
    wpTopic.subscribe((msg) => setWaypoints(msg.poses.map(p => ({ x: p.position.x, y: p.position.y }))));
    subs.push(wpTopic);

    const camTopic = new ROSLIB.Topic({ ros, name: "/camera/image_raw/compressed", messageType: "sensor_msgs/CompressedImage" });
    camTopic.subscribe((msg) => setCameraImg(`data:image/jpeg;base64,${msg.data}`));
    subs.push(camTopic);

    const detTopic = new ROSLIB.Topic({ ros, name: "/camera/detection/compressed", messageType: "sensor_msgs/CompressedImage" });
    detTopic.subscribe((msg) => setDetectionImg(`data:image/jpeg;base64,${msg.data}`));
    subs.push(detTopic);

    return () => subs.forEach(s => s.unsubscribe());
  }, [ros, status]);

  // Sim mode: show exploration state for preview without a real ROS connection
  useEffect(() => {
    if (simMode) {
      setMissionState("EXPLORATION");
      setProgress(null);
    } else if (status !== "connected") {
      setMissionState(null);
    }
  }, [simMode, status]);

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
      {showDone && <DoneView waypoints={waypoints} onStart={handleStart} />}
      {showTransition && <TransitionView state={missionState} />}
      {showTeleop && <TeleopHoldView />}
      {showExploration && <ExplorationView mapMsg={mapMsg} robotPose={robotPose} />}
      {showMap && (
        <InspectionMapView
          mapMsg={mapMsg}
          robotPose={robotPose}
          waypoints={waypoints}
          activeWaypointIdx={activeWaypointIdx}
          state={missionState}
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
