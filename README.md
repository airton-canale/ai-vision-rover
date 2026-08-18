# AI Vision Rover

Raspberry-Pi-style rover project running on an **Orange Pi 4 LTS**, streaming camera feed to a **Mission Control** web dashboard, with CI/CD auto-deploy via GitHub Actions + Tailscale.

## Project structure

```
ai-vision-rover/
├── .github/workflows/deploy.yml
├── server/
│   ├── main.py
│   └── requirements.txt
├── frontend/
│   ├── src/
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── static/
├── deploy/
│   ├── deploy.sh
│   └── rover-cam.service
└── README.md
```

## Frontend dev

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173, proxies /ws → localhost:8000
```

Run the FastAPI server separately (`python3 server/main.py`) for the WebSocket feed.

Production build (auto-run by `deploy.sh` on the Orange Pi):

```bash
cd frontend
npm run build   # outputs to ../static
```

---

## CI/CD Setup (one-time)

### 1. Install Tailscale on the Orange Pi

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
```

Follow the printed URL to authenticate. Then get its Tailscale IP:

```bash
tailscale ip -4
```

Save this IP — you'll need it for the GitHub secret below.

### 2. Create a Tailscale OAuth client (for GitHub Actions)

Go to https://login.tailscale.com/admin/settings/oauth → **Generate OAuth client**.
Give it the `tag:ci` tag capability. Save the **Client ID** and **Client Secret**.

### 3. Generate an SSH key pair for GitHub Actions → Orange Pi

On your own machine:
```bash
ssh-keygen -t ed25519 -f deploy_key -N ""
```

Copy the **public key** (`deploy_key.pub`) to the Orange Pi's authorized keys:
```bash
ssh-copy-id -i deploy_key.pub root@<orange_pi_tailscale_ip>
```

### 4. Add GitHub repo secrets

Go to **Settings → Secrets and variables → Actions** on the repo and add:

| Secret name | Value |
|---|---|
| `TS_OAUTH_CLIENT_ID` | From step 2 |
| `TS_OAUTH_SECRET` | From step 2 |
| `ORANGE_PI_SSH_KEY` | Contents of the **private** key (`deploy_key`) from step 3 |
| `ORANGE_PI_TAILSCALE_IP` | The Tailscale IP from step 1 |

### 5. Push to main or trigger manually

Every merge to `main` (or a manual "Run workflow" click in the Actions tab) will:
1. Connect the GitHub runner to your Tailscale network
2. SSH into the Orange Pi
3. Pull the latest code
4. Reinstall dependencies if needed
5. Restart the `rover-cam` systemd service

---

## Manual run (without CI/CD)

```bash
cd frontend && npm ci && npm run build && cd ..
cd server
pip3 install -r requirements.txt --break-system-packages
python3 main.py
```

Open `http://<orange_pi_ip>:8000` and click **Connect**.

---

## Gamepad control (DualShock 4)

The rover drives from a DS4 gamepad plugged into the **operator's laptop**, not the Pi. Inputs are polled in the browser (Gamepad API) and sent over WebSocket `/ws/control` at ~15 Hz.

### Wiring (L298N HW-095 → Orange Pi)

| L298N | Physical pin | Side |
|---|---|---|
| IN1 | 11 | left motors |
| IN2 | 13 | left motors |
| IN3 | 15 | right motors |
| IN4 | 22 | right motors |

Both motors per side are ganged to one channel. If a side spins the wrong way, swap the two motor wires on that channel of the L298N.

### Connecting the controller

1. Plug DS4 into the laptop via USB (or pair over Bluetooth to the laptop — **not** the Pi).
2. Open the Mission Control page in Chrome or Edge (best Gamepad API support).
3. Press any button on the DS4 once — browsers only expose the pad after first input.
4. The **GAMEPAD** pill in the header turns green and its name appears in the Control panel.

### Button map

| Input | Action |
|---|---|
| Left stick Y | Throttle (forward / reverse) |
| Right stick X | Steering |
| Circle (button 1) | Emergency stop |

Deadzone is 0.15 on both axes. Throttle + steering are mixed into left/right track speeds (arcade drive), clamped to [-1, 1].

### Hardware limitation: no PWM speed control (yet)

The HW-095's **ENA/ENB pins are jumpered HIGH**, so `IN1`–`IN4` are digital-only. Motors run at full speed or stopped — no proportional control. In software the whole pipeline uses floats in [-1, 1]; only the last hop (`_apply_side` in `motor_control.py`) thresholds to bang-bang. Anything with magnitude ≥ 0.3 drives full-on.

To enable true PWM: remove the ENA/ENB jumpers, wire them to two PWM-capable GPIOs, and replace the body of `_apply_side`. Nothing else in the pipeline needs to change.

### Server-side safety

- Watchdog stops motors if no command arrives in 500 ms (network drop, tab closed).
- Only one control WebSocket is active at a time — a new connection displaces the old one.
- Motors stop on disconnect, shutdown, or any control-loop exception.
- Values are clamped server-side; client input is not trusted.

### Testing without the Pi (dev on laptop)

```bash
cd server
MOCK_GPIO=1 python3 main.py
```

`MOCK_GPIO=1` replaces the `gpio` subprocess calls with logged pin writes, so the whole WebSocket + mixing pipeline can be exercised on a laptop without wiringOP installed.

Manual motor sanity check on the Pi:

```bash
cd server
python3 motor_control.py teste
```

---

## Autopilot (HC-SR04 obstacle avoidance)

> ⚠ **Supervised only.** The rover has one forward-facing sensor and no drop-off
> detection. Never leave autopilot running unattended. A human watches the
> camera and can drop to Manual at any time — any gamepad input or the toggle
> button switches modes.

### Wiring the HC-SR04

| HC-SR04 | Orange Pi 4 LTS (physical pin) |
|---|---|
| VCC | 5V (pin 2 or 4) |
| GND | GND (pin 6) |
| Trig | pin **12** |
| Echo | pin **16** — **via voltage divider** ⚠ |

**⚠ Voltage divider on Echo is mandatory.** Echo drives 5V; the Orange Pi's
GPIO is 3.3V and **not 5V-tolerant**. Wiring Echo direct to pin 16 will damage
the SoC.

```
Echo ──┬── 1kΩ ──┬── pin 16 (GPIO)
                 │
                2kΩ
                 │
                GND
```

Verify pin assignments against `gpio readall` on the Pi before wiring — motor
pins are 11/13/15/22, do not reuse them.

### Why not use the `gpio` subprocess for the sensor

The motor driver shells out to wiringOP (`gpio -1 write`). Each shell takes
5-15 ms. HC-SR04 echo pulses are 150 µs to 25 ms wide — subprocess adds
100-1000× too much jitter to time them. The sensor driver uses `OPi.GPIO`
directly (pure Python, aarch64-compatible). The motor driver is unchanged.

### Autopilot behaviour

State machine in `server/autopilot.py`:

| State | Trigger / action |
|---|---|
| **CRUISE** | Drive forward while distance > `CLEAR_DISTANCE_CM` (50) |
| **OBSTACLE** | Distance < `STOP_DISTANCE_CM` (25) → stop, brief pause |
| **BACKUP** | Reverse for `BACKUP_DURATION_S` (0.5 s) |
| **TURN** | Rotate in place for `TURN_DURATION_S` (0.4 s), alternating L/R |
| **STUCK** | After `MAX_TURN_ATTEMPTS` (4) failed turns → stop and report |

Sensor reads take 5 samples, drop outliers via median, and never trust a single
reading. Timeouts return "no reading" (not 0 cm) so an absorbent surface doesn't
freeze the rover.

### Mode switching

- **Server-authoritative.** The current mode is broadcast to all `/ws/status`
  clients so two tabs cannot disagree.
- **Autopilot ↔ Manual toggle** in the UI header + Autopilot panel.
- **Any manual command overrides** — moving the stick in autopilot drops to
  Manual immediately.
- **Emergency stop works in both modes** and forces Manual.
- Switching stops the motors first, then hands over.
- If **all clients disconnect while in autopilot**, the server stops the motors
  and exits autopilot (nobody is watching).

### Known blind spots — documented, not solved

- Cone ~15°, range ~2 cm to 4 m.
- **Cannot detect drop-offs** (stairs, table edges). Autopilot on a table drives
  off.
- Soft or angled surfaces absorb / deflect the ping — sensor reports "clear"
  when there's actually a wall.
- Only faces forward. Nothing is known about sides or rear while reversing.

### Testing without hardware

```bash
cd server

# unit checks
MOCK_GPIO=1 python3 motor_control.py check
python3 sensors.py check
MOCK_GPIO=1 python3 autopilot.py check

# full stack, scripted distances cycling
MOCK_GPIO=1 MOCK_DISTANCES=100,80,50,25,10,-1,50,100 python3 main.py
```

`MOCK_DISTANCES` values are in cm; `-1` simulates a sensor timeout. The list
cycles per sample, so the state machine will walk CRUISE → OBSTACLE → BACKUP →
TURN → CRUISE as the distance drops and recovers.

---

## Notes

- Camera index is set via the `CAMERA_INDEX` env var in `rover-cam.service` (defaults to `5`, matched to our Logitech C270 on `/dev/video5`). Adjust if your camera enumerates differently — check with `v4l2-ctl --list-devices`.
- `opencv-python` is intentionally excluded from `requirements.txt` — install `python3-opencv` via `apt` on the Orange Pi instead, to avoid a numpy version conflict with the system package.
- `OPi.GPIO` is aarch64-compatible pure Python (no wheel build required).
