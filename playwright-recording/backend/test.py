%% Do not delete this line
# !apt-get install libevent-2.1-7t64 libgstreamer-plugins-bad1.0-0 libavif16
# !pip install playwright --break-system-packages
# !playwright install

import asyncio
import nest_asyncio
nest_asyncio.apply()
from playwright.async_api import async_playwright
import time

CHROME_CDP_URL = "http://localhost:9223/playwright"  # Default CDP endpoint
import base64
import os

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(
            'ws://localhost:9223/playwright'
        )
        context = browser.contexts[0]
        page = await context.new_page()
        print("page created", page)
        
        # Create a CDP session
        client = await page.context.new_cdp_session(page)
        
        # Create directory for frames if it doesn't exist
        os.makedirs("screencast_frames", exist_ok=True)
        frame_count = 0
        
        # Handler for screencast frames
        async def handle_frame(params):
            nonlocal frame_count
            data = base64.b64decode(params["data"])
            session_id = params["sessionId"]
            
            # Save frame
            frame_path = f"screencast_frames/frame_{frame_count:04d}.jpg"
            with open(frame_path, "wb") as f:
                f.write(data)
            print(f"Saved frame: {frame_path}")
            frame_count += 1
            
            # Acknowledge the frame
            await client.send("Page.screencastFrameAck", {"sessionId": session_id})
        
        # Register the event handler
        client.on("Page.screencastFrame", handle_frame)
        
        # Start screencast
        await client.send("Page.startScreencast", {
            "format": "jpeg",
            "quality": 80,
            "maxWidth": 1280,
            "maxHeight": 720,
            "everyNthFrame": 1
        })
        
        # Navigate to the page
        await page.goto('https://example.com')
        print("Navigated to example.com")
        
        # Wait for a few seconds to capture frames
        print("Recording screencast for 5 seconds...")
        await page.wait_for_timeout(5000)
        
        # Stop screencast
        await client.send("Page.stopScreencast")
        print(f"Screencast stopped. Captured {frame_count} frames in 'screencast_frames' directory")

asyncio.run(main())

#%%
import os
import subprocess
from PIL import Image
import numpy as np
from pathlib import Path

def create_video_from_frames(frames_dir="screencast_frames", output_file="screencast.mp4", fps=30):
    """
    Create a video from a sequence of frames in the specified directory using FFmpeg.
    
    Args:
        frames_dir (str): Directory containing the frames
        output_file (str): Path to the output video file
        fps (int): Frames per second for the output video
    """
    # Get all frame files and sort them - looking for jpg files (not png)
    frame_files = sorted([f for f in os.listdir(frames_dir) if f.startswith("frame_") and f.endswith(".jpg")])
    
    if not frame_files:
        print(f"No frames found in {frames_dir}")
        # Debug information
        all_files = os.listdir(frames_dir)
        print(f"Files in directory: {all_files}")
        return
    
    # Only use the first 100 frames
    if len(frame_files) > 100:
        frame_files = frame_files[10:110]
        print(f"Using only the first 100 frames out of {len(frame_files)} total frames")
    
    # Use FFmpeg to create the video
    try:
        # Create the FFmpeg command
        cmd = [
            'ffmpeg',
            '-y',  # Overwrite output file if it exists
            '-framerate', str(fps),
            '-i', f'{frames_dir}/frame_%04d.jpg',  # Input pattern
            '-c:v', 'libx264',  # Use H.264 codec
            '-pix_fmt', 'yuv420p',  # Pixel format for compatibility
            '-crf', '23',  # Quality (lower is better)
            output_file
        ]
        
        # Run the FFmpeg command
        subprocess.run(cmd, check=True)
        print(f"Video created successfully: {output_file} using FFmpeg")
        
    except subprocess.CalledProcessError as e:
        print(f"Error creating video with FFmpeg: {e}")
        
        # Fallback to using imageio if FFmpeg fails
        try:
            import imageio
            
            # Read all frames
            frames = []
            for frame_file in frame_files:
                frame_path = os.path.join(frames_dir, frame_file)
                img = imageio.imread(frame_path)
                frames.append(img)
            
            # Write video
            imageio.mimsave(output_file, frames, fps=fps)
            print(f"Video created successfully with imageio: {output_file} using {len(frames)} frames")
            
        except Exception as e2:
            print(f"Fallback to imageio also failed: {e2}")

# Create video from the captured frames
create_video_from_frames()