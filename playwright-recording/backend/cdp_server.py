import os
import shutil
import base64
import uuid
import json
from fastapi import FastAPI, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx
import asyncio
import websockets
import subprocess
import datetime
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)
video_path = "recording.webm"
frame_dir = "frames"
cdp_ws = None
session_id = 0
recording = False
frame_count = 0

CHROME_REMOTE_URL = "http://localhost:9222/json"

async def connect_to_cdp():
    global cdp_ws
    async with httpx.AsyncClient() as client:
        tabs = await client.get(CHROME_REMOTE_URL)
        ws_url = tabs.json()[0]['webSocketDebuggerUrl']
    cdp_ws = await websockets.connect(ws_url)

async def send_cdp_command(method, params=None):
    global session_id
    session_id += 1
    msg = {
        "id": session_id,
        "method": method,
        "params": params or {}
    }
    await cdp_ws.send(json.dumps(msg))

    while True:
        resp = await cdp_ws.recv()
        data = json.loads(resp)
        if data.get("id") == session_id:
            return data

async def receive_frames():
    global recording, frame_count
    while recording:
        message = await cdp_ws.recv()
        data = json.loads(message)
        if data.get("method") == "Page.screencastFrame":
            frame_data = data["params"]["data"]
            session = data["params"]["sessionId"]

            frame_count += 1
            frame_filename = os.path.join(frame_dir, f"frame{frame_count:04d}.jpg")
            with open(frame_filename, "wb") as f:
                f.write(base64.b64decode(frame_data))

            await send_cdp_command("Page.screencastFrameAck", {"sessionId": session})
        if data.get("method") == "Page.frameNavigated":
            await send_cdp_command("Page.startScreencast", {
                "format": "jpeg",
                "quality": 80,
                "maxWidth": 1280,
                "maxHeight": 720
            })

@app.on_event("startup")
async def startup():
    await connect_to_cdp()
    await send_cdp_command("Page.enable")

@app.on_event("shutdown")
async def shutdown():
    if cdp_ws:
        await cdp_ws.close()

@app.post("/start_recording")
async def start_recording(background_tasks: BackgroundTasks):
    global recording, frame_count
    if recording:
        return JSONResponse({"status": "Already recording"}, status_code=400)

    if os.path.exists(frame_dir):
        shutil.rmtree(frame_dir)
    os.makedirs(frame_dir, exist_ok=True)

    await send_cdp_command("Page.startScreencast", {
        "format": "jpeg",
        "quality": 80,
        "maxWidth": 1280,
        "maxHeight": 720
    })

    recording = True
    frame_count = 0
    background_tasks.add_task(receive_frames)
    return {"status": "Recording started"}

@app.post("/stop_recording")
async def stop_recording():
    global recording
    if not recording:
        return JSONResponse({"status": "Not recording"}, status_code=400)

    recording = False
    await asyncio.sleep(2)  # Allow last frames to arrive

    if frame_count == 0:
        return JSONResponse({"error": "No frames captured"}, status_code=500)

    # Use ffmpeg to assemble frames
    if os.path.exists(video_path):
        os.remove(video_path)

    ffmpeg_cmd = [
        "ffmpeg", "-y", "-framerate", "10",
        "-i", os.path.join(frame_dir, "frame%04d.jpg"),
        "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", video_path
    ]

    subprocess.run(ffmpeg_cmd)

    return {"status": "Recording stopped", "video_file": video_path}

@app.get("/get_video")
async def get_video():
    if os.path.exists(video_path):
        return FileResponse(video_path, media_type='video/webm', filename="recording.webm")
    return JSONResponse({"error": "No video found"}, status_code=404)


@app.post("/take_screenshot")
async def take_screenshot():
    result = await send_cdp_command("Page.captureScreenshot")
    screenshot_data = result.get("result", {}).get("data")
    if screenshot_data:
        # Save screenshot to file
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"screenshots/screenshot_{timestamp}.png"
        with open(filename, "wb") as f:
            f.write(base64.b64decode(screenshot_data))
        return {"screenshot": screenshot_data, "filepath": filename}
    return JSONResponse({"error": "Failed to capture screenshot"}, status_code=500)

# To run:
# Start Chrome with --remote-debugging-port=9222
# uvicorn cdp_server:app --reload