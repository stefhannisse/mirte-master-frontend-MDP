import { useRef, useState, useCallback } from "react";
import { useRobotScene } from "./useRobotScene.js";

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
};

const DEG = Math.PI / 180;

// Mecanum drive speed signs per direction
// [FL, FR, RL, RR]
const DRIVE_VECTORS = {
  forward:     { vx:  0.3, vy: 0,    wz: 0,    wheels: [ 1,  1,  1,  1] },
  backward:    { vx: -0.3, vy: 0,    wz: 0,    wheels: [-1, -1, -1, -1] },
  left:        { vx: 0,   vy:  0.3,  wz: 0,    wheels: [-1,  1,  1, -1] },
  right:       { vx: 0,   vy: -0.3,  wz: 0,    wheels: [ 1, -1, -1,  1] },
  fwdLeft:     { vx:  0.3, vy:  0.3, wz: 0,    wheels: [ 0,  1,  1,  0] },
  fwdRight:    { vx:  0.3, vy: -0.3, wz: 0,    wheels: [ 1,  0,  0,  1] },
  backLeft:    { vx: -0.3, vy:  0.3, wz: 0,    wheels: [ 0, -1, -1,  0] },
  backRight:   { vx: -0.3, vy: -0.3, wz: 0,    wheels: [-1,  0,  0, -1] },
  rotateCW:    { vx: 0,   vy: 0,    wz: -0.5,  wheels: [ 1, -1,  1, -1] },
  rotateCCW:   { vx: 0,   vy: 0,    wz:  0.5,  wheels: [-1,  1, -1,  1] },
  stop:        { vx: 0,   vy: 0,    wz: 0,     wheels: [ 0,  0,  0,  0] },
};

function publish(socket, topic, msg) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ op: "publish", topic, msg }));
}

function ArmSlider({ label, min, max, value, unit = "°", onChange }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: COLORS.textMuted, marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ color: COLORS.accent, fontFamily: "monospace" }}>{value.toFixed(1)}{unit}</span>
      </div>
      <input
        type="range"
        min={min} max={max} value={value} step={0.5}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: COLORS.accent }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: COLORS.textDim }}>
        <span>{min}{unit}</span><span>{max}{unit}</span>
      </div>
    </div>
  );
}

const DRIVE_BUTTONS = [
  [null,       "fwdLeft",  "forward",  "fwdRight",  null],
  ["rotateCCW","left",     "stop",     "right",     "rotateCW"],
  [null,       "backLeft", "backward", "backRight", null],
];

const BUTTON_LABELS = {
  forward: "↑", backward: "↓", left: "←", right: "→",
  fwdLeft: "↖", fwdRight: "↗", backLeft: "↙", backRight: "↘",
  rotateCW: "↻", rotateCCW: "↺", stop: "■",
};

export default function RobotControlView({ socket }) {
  const mountRef = useRef(null);
  const sceneControlsRef = useRef(null);
  const [activeDir, setActiveDir] = useState(null);

  const [armState, setArmState] = useState({
    base: 0, shoulder: 0, elbow: 0, wrist: 0, gripper: 0,
  });

  const { driveRef } = useRobotScene(mountRef, sceneControlsRef);

  const updateArm = useCallback((key, deg) => {
    setArmState((prev) => {
      const next = { ...prev, [key]: deg };

      // Apply to Three.js arm
      const arm = sceneControlsRef.current?.arm;
      if (arm) {
        arm.armBase.rotation.y   = next.base     * DEG;
        arm.shoulder.rotation.x  = next.shoulder * DEG;
        arm.elbow.rotation.x     = next.elbow    * DEG;
        arm.wrist.rotation.x     = next.wrist    * DEG;
        const spread = next.gripper * 0.001; // mm → m
        if (arm.fingerL) arm.fingerL.position.x = -0.014 - spread;
        if (arm.fingerR) arm.fingerR.position.x =  0.014 + spread;
      }

      // Publish joint states
      publish(socket, "/mirte/arm/joint_states", {
        name: ["base", "shoulder", "elbow", "wrist", "gripper"],
        position: [
          next.base     * DEG,
          next.shoulder * DEG,
          next.elbow    * DEG,
          next.wrist    * DEG,
          next.gripper  * 0.001,
        ],
      });

      return next;
    });
  }, [socket]);

  const handleDrive = useCallback((dir) => {
    setActiveDir(dir);
    const vec = DRIVE_VECTORS[dir] ?? DRIVE_VECTORS.stop;
    driveRef.current = { fl: vec.wheels[0], fr: vec.wheels[1], rl: vec.wheels[2], rr: vec.wheels[3] };
    publish(socket, "/cmd_vel", {
      linear:  { x: vec.vx, y: vec.vy, z: 0 },
      angular: { z: vec.wz },
    });
  }, [socket, driveRef]);

  const handleDriveStop = useCallback(() => {
    setActiveDir(null);
    driveRef.current = { fl: 0, fr: 0, rl: 0, rr: 0 };
    publish(socket, "/cmd_vel", { linear: { x: 0, y: 0, z: 0 }, angular: { z: 0 } });
  }, [socket, driveRef]);

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      {/* Three.js canvas area */}
      <div ref={mountRef} style={{ flex: 1, position: "relative", background: COLORS.bg }} />

      {/* Control sidebar */}
      <div style={{
        width: 260, flexShrink: 0,
        background: COLORS.surface,
        borderLeft: `0.5px solid ${COLORS.border}`,
        overflowY: "auto",
        padding: "14px 16px",
        display: "flex", flexDirection: "column", gap: 18,
      }}>
        {/* Arm controls */}
        <div>
          <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12, paddingBottom: 4, borderBottom: `0.5px solid ${COLORS.border}` }}>
            arm control
          </div>
          <ArmSlider label="Base rotation" min={-180} max={180} value={armState.base}     onChange={(v) => updateArm("base", v)} />
          <ArmSlider label="Shoulder pitch" min={-90}  max={90}  value={armState.shoulder} onChange={(v) => updateArm("shoulder", v)} />
          <ArmSlider label="Elbow pitch"    min={-120} max={120} value={armState.elbow}    onChange={(v) => updateArm("elbow", v)} />
          <ArmSlider label="Wrist pitch"    min={-90}  max={90}  value={armState.wrist}    onChange={(v) => updateArm("wrist", v)} />
          <ArmSlider label="Gripper open"   min={0}    max={40}  value={armState.gripper}  unit=" mm" onChange={(v) => updateArm("gripper", v)} />
        </div>

        {/* Drive controls */}
        <div>
          <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12, paddingBottom: 4, borderBottom: `0.5px solid ${COLORS.border}` }}>
            mecanum drive
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
            {DRIVE_BUTTONS.flat().map((dir, i) => {
              if (!dir) return <div key={i} />;
              const isStop = dir === "stop";
              const isActive = activeDir === dir;
              return (
                <button
                  key={dir}
                  onMouseDown={() => handleDrive(dir)}
                  onMouseUp={isStop ? undefined : handleDriveStop}
                  onMouseLeave={isStop ? undefined : handleDriveStop}
                  onTouchStart={(e) => { e.preventDefault(); handleDrive(dir); }}
                  onTouchEnd={isStop ? undefined : handleDriveStop}
                  style={{
                    padding: "8px 0",
                    fontSize: 16,
                    cursor: "pointer",
                    borderRadius: 4,
                    border: `0.5px solid ${isActive ? COLORS.accent : COLORS.border}`,
                    background: isActive ? COLORS.accentDim : isStop ? "#1e1e2a" : "transparent",
                    color: isActive ? COLORS.accent : isStop ? COLORS.warn : COLORS.text,
                    fontFamily: "monospace",
                    transition: "all 0.1s",
                  }}
                >
                  {BUTTON_LABELS[dir]}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 8, fontSize: 10, color: COLORS.textDim, textAlign: "center" }}>
            hold to drive · release to stop
          </div>
        </div>

        {/* Socket status note */}
        <div style={{ fontSize: 10, color: COLORS.textDim, borderTop: `0.5px solid ${COLORS.border}`, paddingTop: 10 }}>
          {socket && socket.readyState === WebSocket.OPEN
            ? <span style={{ color: COLORS.accent }}>● rosbridge connected</span>
            : <span>○ rosbridge not connected</span>}
        </div>
      </div>
    </div>
  );
}
