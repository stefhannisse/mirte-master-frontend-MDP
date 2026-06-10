import { useRef, useState, useCallback, useEffect } from "react";
import * as ROSLIB from "roslib";
import { useRobotScene } from "./useRobotScene.js";
import { useColors } from "./shared.jsx";

const DEG = Math.PI / 180;

const DRIVE_VECTORS = {
  forward:     { vx:  0.3, vy: 0,    wz: 0,    wheels: [ 1,  1,  1,  1] },
  backward:    { vx: -0.3, vy: 0,    wz: 0,    wheels: [-1, -1, -1, -1] },
  left:        { vx: 0,    vy:  0.3,  wz: 0,    wheels: [-1,  1,  1, -1] },
  right:       { vx: 0,    vy: -0.3,  wz: 0,    wheels: [ 1, -1, -1,  1] },
  fwdLeft:     { vx:  0.3, vy:  0.3, wz: 0,    wheels: [ 0,  1,  1,  0] },
  fwdRight:    { vx:  0.3, vy: -0.3, wz: 0,    wheels: [ 1,  0,  0,  1] },
  backLeft:    { vx: -0.3, vy:  0.3, wz: 0,    wheels: [ 0, -1, -1,  0] },
  backRight:   { vx: -0.3, vy: -0.3, wz: 0,    wheels: [-1,  0,  0, -1] },
  rotateCW:    { vx: 0,    vy: 0,    wz: -0.5, wheels: [ 1, -1,  1, -1] },
  rotateCCW:   { vx: 0,    vy: 0,    wz:  0.5, wheels: [-1,  1, -1,  1] },
  stop:        { vx: 0,    vy: 0,    wz: 0,    wheels: [ 0,  0,  0,  0] },
};

function ArmSlider({ label, min, max, value, unit = "°", onChange }) {
  const COLORS = useColors();
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

export default function TeleopView({ socket, ros, darkMode }) {
  const COLORS = useColors();
  const mountRef = useRef(null);
  const sceneControlsRef = useRef(null);

  // Reference tracker to store our continuous 50ms driving loop ID
  const intervalRef = useRef(null);

  const [activeDir, setActiveDir] = useState(null);
  const [armState, setArmState] = useState({ base: 0, shoulder: 0, elbow: 0, wrist: 0, gripper: 0 });
  const [teleopEnabled, setTeleopEnabled] = useState(false);
  const [teleopPending, setTeleopPending] = useState(false);

  const { driveRef, rendererRef, groundMatRef, gridRef } = useRobotScene(mountRef, sceneControlsRef);

  // Sync Three.js scene background and grids when theme changes
  useEffect(() => {
    const bgHex = parseInt(COLORS.bg.replace("#", ""), 16);
    const groundHex = parseInt(darkMode ? "#1a1d26" : "#e8eaf0", 16);
    const gridHex = parseInt(darkMode ? "#1e2330" : "#d0d5e0", 16);

    if (rendererRef.current) rendererRef.current.setClearColor(bgHex);
    if (groundMatRef.current) groundMatRef.current.color.setHex(groundHex);
    if (gridRef.current) {
      gridRef.current.material.color?.setHex(gridHex);
      if (Array.isArray(gridRef.current.material)) {
        gridRef.current.material.forEach(m => m.color?.setHex(gridHex));
      }
    }
  }, [darkMode, COLORS, rendererRef, groundMatRef, gridRef]);

  // Safety cleanup: If user navigates away or tab closes, instantly kill any running loop
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Disable teleop in the FSM when navigating away from this view
  useEffect(() => {
    return () => {
      if (!ros) return;
      const svc = new ROSLIB["Service"]({ ros, name: "/mission_executive_node/set_teleoperation", serviceType: "std_srvs/SetBool" });
      svc.callService({ data: false }, () => {}, () => {});
      setTeleopEnabled(false);
    };
  }, [ros]);

  const toggleTeleop = useCallback(() => {
    if (!ros) return;
    const enable = !teleopEnabled;
    setTeleopPending(true);
    const svc = new ROSLIB["Service"]({ ros, name: "/mission_executive_node/set_teleoperation", serviceType: "std_srvs/SetBool" });
    svc.callService(
      { data: enable },
      (result) => {
        console.log(result);
        if (result.success) setTeleopEnabled(enable);
        setTeleopPending(false);
      },
      (err) => {
        console.warn("set_teleoperation error:", err);
        setTeleopPending(false);
      },
    );
  }, [ros, teleopEnabled]);

  // Arm Control Logic (via roslibjs bridge pipeline)
  const updateArm = useCallback((key, deg) => {
    setArmState((prev) => {
      const next = { ...prev, [key]: deg };
      const arm = sceneControlsRef.current?.arm;
      
      if (arm) {
        arm.armBase.rotation.y  = next.base     * DEG;
        arm.shoulder.rotation.x = next.shoulder * DEG;
        arm.elbow.rotation.x    = next.elbow    * DEG;
        arm.wrist.rotation.x    = next.wrist    * DEG;
        const spread = next.gripper * 0.001;
        if (arm.fingerL) arm.fingerL.position.x = -0.014 - spread;
        if (arm.fingerR) arm.fingerR.position.x =  0.014 + spread;
      }

      // Replaced strict 'socket.isConnected' check with direct validation on the active connection prop object
      if (socket) {
        socket.callOnConnection({
          op: "publish",
          topic: "/mirte_master_arm_controller/joint_trajectory",
          type: "trajectory_msgs/msg/JointTrajectory", 
          msg: {
            header: { stamp: { sec: 0, nanosec: 0 }, frame_id: "" },
            joint_names: ["shoulder_pan_joint", "shoulder_lift_joint", "elbow_joint", "wrist_joint"],
            points: [
              {
                positions: [next.base * DEG, next.shoulder * DEG, next.elbow * DEG, next.wrist * DEG],
                velocities: [0.0, 0.0, 0.0, 0.0], 
                accelerations: [0.0, 0.0, 0.0, 0.0],
                effort: [],
                time_from_start: { sec: 0, nanosec: 200000000 } 
              }
            ]
          }
        });
      }
      return next;
    });
  }, [socket]);

  // Base Mecanum Drive - Smooth continuous stream loop
  const handleDrive = useCallback((dir) => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    setActiveDir(dir);
    const vec = DRIVE_VECTORS[dir] ?? DRIVE_VECTORS.stop;
    
    driveRef.current = { fl: vec.wheels[0], fr: vec.wheels[1], rl: vec.wheels[2], rr: vec.wheels[3] };

    const sendTwistCommand = () => {
      // Adjusted check target matching the active connection thread baseline state
      if (socket) {
        socket.callOnConnection({
          op: "publish",
          topic: "/cmd_vel/teleop_raw",
          type: "geometry_msgs/msg/Twist",
          msg: {
            linear: { x: vec.vx, y: vec.vy, z: 0.0 },
            angular: { x: 0.0, y: 0.0, z: vec.wz }
          }
        });
      }
    };

    sendTwistCommand();
    intervalRef.current = setInterval(sendTwistCommand, 50);
  }, [socket, driveRef]);

  // Base Mecanum Drive - Clear loop and send explicit stop command
  const handleDriveStop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    setActiveDir(null);
    driveRef.current = { fl: 0, fr: 0, rl: 0, rr: 0 };

    if (socket) {
      socket.callOnConnection({
        op: "publish",
        topic: "/mirte_base_controller/cmd_vel_unstamped",
        type: "geometry_msgs/msg/Twist",
        msg: {
          linear: { x: 0.0, y: 0.0, z: 0.0 },
          angular: { x: 0.0, y: 0.0, z: 0.0 }
        }
      });
    }
  }, [socket, driveRef]);

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      {/* Three.js canvas area */}
      <div ref={mountRef} style={{ flex: 1, position: "relative", background: COLORS.bg }} />

      {/* Control sidebar menu layout */}
      <div style={{
        width: 260, flexShrink: 0,
        background: COLORS.surface,
        borderLeft: `0.5px solid ${COLORS.border}`,
        overflowY: "auto",
        padding: "14px 16px",
        display: "flex", flexDirection: "column", gap: 18,
      }}>
        {/* Teleoperation Enable/Disable Toggle */}
        <div style={{
          borderRadius: 6,
          border: `0.5px solid ${teleopEnabled ? COLORS.accent : COLORS.border}`,
          background: teleopEnabled ? COLORS.accentDim : "transparent",
          padding: "10px 12px",
        }}>
          <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
            teleoperation
          </div>
          <div style={{ fontSize: 11, color: teleopEnabled ? COLORS.accent : COLORS.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
            {teleopEnabled
              ? "● Active — controls are live. Autonomous mission is paused."
              : "○ Disabled — enable to activate controls and pause autonomous mission."}
          </div>
          <button
            onClick={toggleTeleop}
            disabled={!ros || teleopPending}
            style={{
              width: "100%",
              background: teleopEnabled ? "rgba(248,113,113,0.12)" : COLORS.accentDim,
              border: `0.5px solid ${teleopEnabled ? "#f87171" : COLORS.accent}`,
              borderRadius: 4,
              color: teleopEnabled ? "#f87171" : COLORS.accent,
              fontSize: 12, padding: "6px 0", cursor: ros && !teleopPending ? "pointer" : "not-allowed",
              fontFamily: "monospace", letterSpacing: "0.05em",
              opacity: !ros || teleopPending ? 0.5 : 1,
              transition: "all 0.2s",
            }}
          >
            {teleopPending ? "…" : teleopEnabled ? "✕ Disable Teleoperation" : "▶ Enable Teleoperation"}
          </button>
          {!ros && (
            <div style={{ fontSize: 10, color: COLORS.textDim, marginTop: 6, textAlign: "center" }}>
              connect to rosbridge first
            </div>
          )}
        </div>

        {/* Controls — gated on teleopEnabled */}
        <div style={{ opacity: teleopEnabled ? 1 : 0.35, pointerEvents: teleopEnabled ? "auto" : "none", display: "flex", flexDirection: "column", gap: 18, transition: "opacity 0.2s" }}>
          {/* Arm UI Sliders Section */}
          <div>
            <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12, paddingBottom: 4, borderBottom: `0.5px solid ${COLORS.border}` }}>
              arm control
            </div>
            <ArmSlider label="Base rotation"  min={-180} max={180} value={armState.base}     onChange={(v) => updateArm("base", v)} />
            <ArmSlider label="Shoulder pitch" min={-90}  max={90}  value={armState.shoulder} onChange={(v) => updateArm("shoulder", v)} />
            <ArmSlider label="Elbow pitch"    min={-120} max={120} value={armState.elbow}    onChange={(v) => updateArm("elbow", v)} />
            <ArmSlider label="Wrist pitch"    min={-90}  max={90}  value={armState.wrist}    onChange={(v) => updateArm("wrist", v)} />
            <ArmSlider label="Gripper open"   min={0}    max={40}  value={armState.gripper}  unit=" mm" onChange={(v) => updateArm("gripper", v)} />
          </div>

          {/* Mecanum Grid Buttons Section */}
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
                    onPointerDown={() => handleDrive(dir)}
                    onPointerUp={isStop ? undefined : handleDriveStop}
                    onPointerLeave={isStop ? undefined : handleDriveStop}
                    style={{
                      padding: "8px 0", fontSize: 16, cursor: "pointer", borderRadius: 4,
                      border: `0.5px solid ${isActive ? COLORS.accent : COLORS.border}`,
                      background: isActive ? COLORS.accentDim : isStop ? COLORS.surface : "transparent",
                      color: isActive ? COLORS.accent : isStop ? COLORS.warn : COLORS.text,
                      fontFamily: "monospace", transition: "all 0.1s",
                      touchAction: "none",
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
        </div>

        {/* Global Connection Status Block */}
        <div style={{ fontSize: 10, color: COLORS.textDim, borderTop: `0.5px solid ${COLORS.border}`, paddingTop: 10 }}>
          {socket
            ? <span style={{ color: COLORS.accent }}>● rosbridge connected</span>
            : <span>○ rosbridge not connected</span>}
        </div>
      </div>
    </div>
  );
}