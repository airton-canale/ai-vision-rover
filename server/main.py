import asyncio
import base64
import json
import os
import time
from contextlib import asynccontextmanager

import cv2
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

import motor_control
from autopilot import autopilot

CAMERA_INDEX = int(os.environ.get("CAMERA_INDEX", "5"))
CONTROL_TIMEOUT = 0.5      # manual mode: no cmd in this window → stop motors
STATUS_BROADCAST_HZ = 5
MANUAL_INPUT_EPSILON = 0.05  # any drive cmd above this while in auto → back to manual

camera = None

def get_camera():
    global camera
    if camera is None or not camera.isOpened():
        camera = cv2.VideoCapture(CAMERA_INDEX)
        camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        camera.set(cv2.CAP_PROP_FPS, 30)
    return camera

connected_clients: list[WebSocket] = []

async def broadcast_frames():
    cam = get_camera()
    while True:
        if not connected_clients:
            await asyncio.sleep(0.1)
            continue

        ret, frame = cam.read()
        if not ret:
            await asyncio.sleep(0.05)
            continue

        _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
        b64 = base64.b64encode(buffer).decode("utf-8")
        payload = f"data:image/jpeg;base64,{b64}"

        dead = []
        for ws in connected_clients:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            connected_clients.remove(ws)

        await asyncio.sleep(1 / 30)


active_control_ws: WebSocket | None = None
last_cmd_time: float = 0.0

mode: str = "manual"  # "manual" | "auto"
status_clients: list[WebSocket] = []


async def _switch_to_manual():
    global mode
    if autopilot.running():
        await autopilot.stop()
    mode = "manual"
    motor_control.parar()


async def _switch_to_auto():
    global mode
    mode = "auto"
    await autopilot.start()


async def control_watchdog():
    while True:
        await asyncio.sleep(0.1)
        if mode != "manual":
            continue
        if active_control_ws is None:
            continue
        if time.monotonic() - last_cmd_time > CONTROL_TIMEOUT:
            motor_control.parar()


async def status_broadcaster():
    interval = 1 / STATUS_BROADCAST_HZ
    while True:
        await asyncio.sleep(interval)
        if not status_clients:
            continue
        payload = json.dumps({
            "mode": mode,
            "state": autopilot.state.value,
            "distance_cm": autopilot.distance_cm,
            "distance_stale": autopilot.distance_stale,
        })
        dead = []
        for ws in status_clients:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            if ws in status_clients:
                status_clients.remove(ws)


@asynccontextmanager
async def lifespan(app: FastAPI):
    motor_control.setup()
    asyncio.create_task(broadcast_frames())
    asyncio.create_task(control_watchdog())
    asyncio.create_task(status_broadcaster())
    try:
        yield
    finally:
        await autopilot.stop()
        motor_control.parar()


app = FastAPI(lifespan=lifespan)


@app.websocket("/ws/camera")
async def camera_ws(websocket: WebSocket):
    await websocket.accept()
    connected_clients.append(websocket)
    print(f"Camera client connected. Total: {len(connected_clients)}")
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        connected_clients.remove(websocket)
        print(f"Camera client disconnected. Total: {len(connected_clients)}")


@app.websocket("/ws/control")
async def control_ws(websocket: WebSocket):
    global active_control_ws, last_cmd_time
    await websocket.accept()

    if active_control_ws is not None:
        try:
            await active_control_ws.close(code=1000, reason="displaced by new controller")
        except Exception:
            pass
        motor_control.parar()

    active_control_ws = websocket
    last_cmd_time = time.monotonic()
    print("Control client connected")

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            # Emergency stop — always wins, forces manual.
            if msg.get("stop"):
                await _switch_to_manual()
                last_cmd_time = time.monotonic()
                continue

            requested_mode = msg.get("mode")
            if requested_mode == "auto":
                await _switch_to_auto()
                last_cmd_time = time.monotonic()
                continue
            if requested_mode == "manual":
                await _switch_to_manual()
                last_cmd_time = time.monotonic()
                continue

            left = max(-1.0, min(1.0, float(msg.get("left", 0))))
            right = max(-1.0, min(1.0, float(msg.get("right", 0))))

            # Manual override: any real drive input while in auto flips to manual.
            if mode == "auto" and (abs(left) > MANUAL_INPUT_EPSILON or abs(right) > MANUAL_INPUT_EPSILON):
                await _switch_to_manual()

            if mode == "manual":
                motor_control.set_speeds(left, right)
                last_cmd_time = time.monotonic()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"Control error: {e}")
    finally:
        motor_control.parar()
        if active_control_ws is websocket:
            active_control_ws = None
        print("Control client disconnected")


@app.websocket("/ws/status")
async def status_ws(websocket: WebSocket):
    await websocket.accept()
    status_clients.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        if websocket in status_clients:
            status_clients.remove(websocket)
        # Unsupervised autopilot is a hazard. If everyone left, stop it.
        if not status_clients and autopilot.running():
            print("All status clients gone — stopping autopilot")
            await _switch_to_manual()


app.mount("/", StaticFiles(directory="../static", html=True), name="static")


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
