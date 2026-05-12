# MIRTE Master — ROS2 SLAM Dashboard

A live web dashboard for the MIRTE Master robot (TU Delft), streaming ROS2 topics to a React frontend via rosbridge. Displays the SLAM occupancy grid map, laser scan, robot pose, and topic health in real time.

---

## How it works

```
MIRTE Master (ROS2 Humble)
  └── rosbridge_server (WebSocket :9090)
        └── cloudflared (wss://xxx.trycloudflare.com)
              └── Firebase Hosting (React app)
                    └── roslibjs (browser WebSocket client)
```

The robot runs **rosbridge**, which exposes all ROS2 topics over a WebSocket. **Cloudflare Tunnel** creates a secure `wss://` public URL pointing at that WebSocket, so the browser can connect to it from any network. The React app uses **roslibjs** to subscribe to topics and render them live.

### Topics consumed

| Topic | Type | Used for |
|---|---|---|
| `/map` | `nav_msgs/OccupancyGrid` | Occupancy grid map from SLAM Toolbox |
| `/scan` | `sensor_msgs/LaserScan` | Laser scan waveform (RPLidar C1) |
| `/odometry/filtered` | `nav_msgs/Odometry` | Robot pose and speed |
| `/tf` | `tf2_msgs/TFMessage` | Transform health indicator |

---

## Requirements

### On the robot (MIRTE Master)
- ROS2 Humble (Ubuntu 22.04)
- `ros-humble-rosbridge-suite`
- `ros-humble-slam-toolbox`
- `cloudflared` binary

### On your development machine
- Node.js v20+
- Firebase CLI (`npm install -g firebase-tools`)

---

## Setup

### 1. Install rosbridge on the robot

```bash
sudo apt install ros-humble-rosbridge-suite
```

### 2. Start SLAM Toolbox

Create `slam_params.yaml`:

```yaml
slam_toolbox:
  ros__parameters:
    use_sim_time: false
    scan_topic: /scan
    odom_frame: odom
    map_frame: map
    base_frame: base_link
    mode: mapping
    use_scan_matching: true
    do_loop_closing: true
    resolution: 0.05
    max_laser_range: 12.0
    map_update_interval: 5.0
    transform_publish_period: 0.02
    transform_timeout: 0.2
    tf_buffer_duration: 30.0
```

Launch it:

```bash
source /opt/ros/humble/setup.bash
ros2 launch slam_toolbox online_async_launch.py params_file:=~/slam_params.yaml
```

### 3. Start rosbridge

```bash
source /opt/ros/humble/setup.bash
export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
```

> **Note:** The `RMW_IMPLEMENTATION` export is required on the MIRTE Master to avoid a FastDDS library conflict.

### 4. Start Cloudflare Tunnel

Download cloudflared (one time):

```bash
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O cloudflared
chmod +x cloudflared
sudo mv cloudflared /usr/local/bin
```

Start the tunnel:

```bash
cloudflared tunnel --url http://localhost:9090
```

It prints a URL like:

```
https://codes-ours-lobby-ceo.trycloudflare.com
```

Your WebSocket address is the same URL with `wss://`:

```
wss://codes-ours-lobby-ceo.trycloudflare.com
```

> **Note:** The tunnel URL changes every time you restart cloudflared. For a stable URL, create a named tunnel with a free Cloudflare account.

### 5. Open the dashboard

Go to the Firebase-hosted URL, paste the `wss://` address into the connection bar, and click **connect**.

---

## Local development

```bash
git clone <your-repo>
cd ros-dashboard
npm install
npm run dev
```

Use `ws://localhost:9090` as the WebSocket URL when rosbridge is running on the same machine.

## Deploy to Firebase

```bash
npm run build
firebase deploy
```

Make sure `firebase.json` exists in the project root:

```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  }
}
```

---

## Startup checklist

Every time you want to use the dashboard, run these on the robot in order:

```bash
# 1. Source ROS2
source /opt/ros/humble/setup.bash
export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp

# 2. Start your robot stack (lidar, odometry, etc.)
# ...

# 3. Start SLAM
ros2 launch slam_toolbox online_async_launch.py params_file:=~/slam_params.yaml

# 4. Start rosbridge
ros2 launch rosbridge_server rosbridge_websocket_launch.xml

# 5. Start tunnel (copy the wss:// URL it prints)
cloudflared tunnel --url http://localhost:9090
```

Then open the dashboard and paste the `wss://` URL.

---

## Troubleshooting

**"Failed to compute odom pose"** — TF tree is incomplete or timestamps are mismatched. Check:
```bash
ros2 run tf2_tools view_frames
```
You need `odom → base_link → base_laser` to exist.

**rosbridge crashes on startup** — FastDDS library conflict. Fix:
```bash
export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
```

**Dashboard can't connect from Firebase** — Make sure you're using `wss://` not `ws://`. Browsers block unencrypted WebSocket connections from HTTPS pages.

**Cloudflare tunnel warnings about ICMP / ping_group_range** — These are harmless. The tunnel works fine despite these warnings.

**Map not appearing** — SLAM Toolbox may not have received enough scan data yet. Drive the robot around to build the map.