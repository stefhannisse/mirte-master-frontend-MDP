import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// Build a single mecanum wheel Group (cylinder + 8 rollers at 45°)
function makeMecanumWheel() {
  const group = new THREE.Group();

  const tireMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  const rollerMat = new THREE.MeshLambertMaterial({ color: 0x333333 });

  const tireGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.04, 16);
  const tire = new THREE.Mesh(tireGeo, tireMat);
  tire.castShadow = true;
  group.add(tire);

  const rollerGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.046, 8);
  const rollerCount = 8;
  for (let i = 0; i < rollerCount; i++) {
    const roller = new THREE.Mesh(rollerGeo, rollerMat);
    const angle = (i / rollerCount) * Math.PI * 2;
    roller.position.set(Math.cos(angle) * 0.05, 0, Math.sin(angle) * 0.05);
    roller.rotation.z = Math.PI / 4; // 45° tilt
    roller.rotation.y = angle;
    group.add(roller);
  }

  return group;
}

// Build full robot Group; returns { robot, wheels, arm }
function buildRobot() {
  const root = new THREE.Group();

  // Chassis
  const chassisMat = new THREE.MeshLambertMaterial({ color: 0x2a5ca8 });
  const chassisGeo = new THREE.BoxGeometry(0.24, 0.14, 0.30);
  const chassis = new THREE.Mesh(chassisGeo, chassisMat);
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  root.add(chassis);

  // 4 mecanum wheels: FL, FR, RL, RR
  const wheelPositions = [
    [-0.13, -0.09, -0.12], // FL
    [ 0.13, -0.09, -0.12], // FR
    [-0.13, -0.09,  0.12], // RL
    [ 0.13, -0.09,  0.12], // RR
  ];
  const wheels = wheelPositions.map((pos) => {
    const w = makeMecanumWheel();
    w.position.set(...pos);
    w.rotation.z = Math.PI / 2; // lay flat on ground axis
    root.add(w);
    return w;
  });

  // ── Arm ───────────────────────────────────────────────────────────────────
  const darkGray = new THREE.MeshLambertMaterial({ color: 0x444444 });
  const lightGray = new THREE.MeshLambertMaterial({ color: 0x888888 });

  // armBase (turret) — rotates around Y
  const armBase = new THREE.Group();
  armBase.position.set(-0.08, 0.1, -0.10);
  const baseCylGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.04, 16);
  armBase.add(new THREE.Mesh(baseCylGeo, darkGray));

  // shoulder → upperArm
  const shoulder = new THREE.Group();
  shoulder.position.set(0, 0.04, 0);
  const upperArmGeo = new THREE.BoxGeometry(0.03, 0.12, 0.03);
  const upperArmMesh = new THREE.Mesh(upperArmGeo, lightGray);
  upperArmMesh.position.set(0, 0.06, 0);
  upperArmMesh.castShadow = true;
  shoulder.add(upperArmMesh);

  // elbow cylinder on top of upperArm
  const elbowCylGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.034, 12);
  const elbowCyl = new THREE.Mesh(elbowCylGeo, darkGray);
  elbowCyl.rotation.z = Math.PI / 2;
  elbowCyl.position.set(0, 0.125, 0);
  shoulder.add(elbowCyl);

  // elbow → foreArm
  const elbow = new THREE.Group();
  elbow.position.set(0, 0.13, 0);
  const foreArmGeo = new THREE.BoxGeometry(0.025, 0.10, 0.025);
  const foreArmMesh = new THREE.Mesh(foreArmGeo, lightGray);
  foreArmMesh.position.set(0, 0.05, 0);
  foreArmMesh.castShadow = true;
  elbow.add(foreArmMesh);

  // wrist cylinder
  const wristCylGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.028, 12);
  const wristCyl = new THREE.Mesh(wristCylGeo, darkGray);
  wristCyl.rotation.z = Math.PI / 2;
  wristCyl.position.set(0, 0.105, 0);
  elbow.add(wristCyl);

  // wrist → gripper fingers
  const wrist = new THREE.Group();
  wrist.position.set(0, 0.11, 0);
  const fingerGeo = new THREE.BoxGeometry(0.012, 0.04, 0.012);
  const fingerMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
  const fingerL = new THREE.Mesh(fingerGeo, fingerMat);
  const fingerR = new THREE.Mesh(fingerGeo, fingerMat);
  fingerL.position.set(-0.014, 0.02, 0);
  fingerR.position.set( 0.014, 0.02, 0);
  wrist.add(fingerL, fingerR);

  // assemble hierarchy
  elbow.add(wrist);
  shoulder.add(elbow);
  armBase.add(shoulder);
  root.add(armBase);

  return {
    robot: root,
    wheels,
    arm: { armBase, shoulder, upperArm: shoulder, elbow, foreArm: elbow, wrist, fingerL, fingerR },
  };
}

export function useRobotScene(mountRef, controlsRef) {
  const sceneRef = useRef(null);
  const driveRef = useRef({ fl: 0, fr: 0, rl: 0, rr: 0 });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.setClearColor(0x0d0f14);
    const resize = () => {
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
    };
    mount.appendChild(renderer.domElement);

    // Camera
    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.01, 100);
    camera.position.set(0.6, 0.5, 0.9);
    camera.lookAt(0, 0, 0);

    // Scene
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(1, 2, 1.5);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // Ground
    const groundGeo = new THREE.PlaneGeometry(4, 4);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x1a1d26 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.12;
    ground.receiveShadow = true;
    scene.add(ground);

    // Grid helper (subtle)
    const grid = new THREE.GridHelper(4, 40, 0x1e2330, 0x1e2330);
    grid.position.y = -0.119;
    scene.add(grid);

    // Robot
    const { robot, wheels, arm } = buildRobot();
    scene.add(robot);

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);

    // expose to parent via ref
    sceneRef.current = { scene, camera, renderer, controls, wheels, arm };
    if (controlsRef) controlsRef.current = { wheels, arm };

    // Resize observer
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    // Animation loop
    let rafId;
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      const { fl, fr, rl, rr } = driveRef.current;
      const speed = 0.05;
      wheels[0].rotation.x += fl * speed;
      wheels[1].rotation.x += fr * speed;
      wheels[2].rotation.x += rl * speed;
      wheels[3].rotation.x += rr * speed;
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  return { driveRef };
}
