import asyncio
import base64
import os
from contextlib import asynccontextmanager

import cv2
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

CAMERA_INDEX = int(os.environ.get("CAMERA_INDEX", "5"))

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(broadcast_frames())
    yield


app = FastAPI(lifespan=lifespan)


@app.websocket("/ws/camera")
async def camera_ws(websocket: WebSocket):
    await websocket.accept()
    connected_clients.append(websocket)
    print(f"Client connected. Total: {len(connected_clients)}")
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        connected_clients.remove(websocket)
        print(f"Client disconnected. Total: {len(connected_clients)}")


app.mount("/", StaticFiles(directory="../static", html=True), name="static")


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
