// import { createClient } from './supabase.js';
import { createClient } from '@supabase/supabase-js';
console.log("Creating supabase client");
const SUPABASE_URL = 'https://scydgsnstcmcdfxrgvoh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjeWRnc25zdGNtY2RmeHJndm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE5OTAyOTgsImV4cCI6MjA1NzU2NjI5OH0.ZHfoMs5E_1Hra4KAlLt610RuQQA71Zlfl_zEGETGUaE';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjeWRnc25zdGNtY2RmeHJndm9oIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MTk5MDI5OCwiZXhwIjoyMDU3NTY2Mjk4fQ.NNZCzKTIqyh7rdzrERQ1kE1YQjxAcQuQ2-ph5UVZ8BQ';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
// Subscribe to changes to messages
const channel = supabase
  .channel('db-changes')
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'messages'
    },
    (payload) => {
      console.log('Change received!', payload);
    }
  )
  .subscribe();

let window_payload_map = new Map(); // Maps window IDs to their payload
let run_id_to_window_id_map = new Map(); // Maps run IDs to window IDs

let recordings = new Map();
let attachedTabs = new Set();
let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let activeRecordingTabId = null;

// Add these near the top with other global variables
let recordingPort = null;
let isRecording = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle specific message types
    if (message.type === "CREATE_RECORDING_WINDOW" || message.type === "CREATE_AGENT_RUN_WINDOW") {
        console.log("Creating window of type:", message.type, "with payload:", message.payload);
        create_window(message.type, message.payload);
    } else if (message.type === "JUMP_TO_AGENT_WINDOW") {
        console.log("BACKGROUND SCRIPT: Jumping to agent window");
        let run_id = message.payload.runId;
        console.log("BACKGROUND SCRIPT: Run ID:", run_id);
        let window_id = run_id_to_window_id_map.get(run_id);
        console.log("BACKGROUND SCRIPT: Window ID:", window_id);
        if (window_id) {
            console.log("BACKGROUND SCRIPT: Focusing on window ID:", window_id);
            chrome.windows.update(window_id, { focused: true });
        }
    } else if (message.action === "startRecording") {
        console.log("Received startRecording message with chatId:", message.chatId);
        // Add any additional recording logic here
    } else if (message.action === "START_RECORDING") {
        console.log("Background: Handling start recording request");
        // Use async function to handle the tab query
        (async () => {
            try {
                const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
                console.log("Background: Found tabs:", tabs);
                if (tabs && tabs.length > 0) {
                    // Start screen recording first
                    startScreenRecording().then(() => sendResponse({ status: "success" }))
                    .catch((err) => sendResponse({ status: "error", message: err.message }));;
                    // await handleStartRecording(tabs[0].id, sendResponse);
                } else {
                    console.error("Background: No active tab found");
                    sendResponse({ status: "error", message: "No active tab found. Please refresh the page and try again." });
                }
            } catch (error) {
                console.error("Background: Error querying tabs:", error);
                sendResponse({ status: "error", message: error.message });
            }
        })();
        
       
        
    }
    else if (message.action === "STOP_RECORDING") {
        console.log("Background: Handling stop recording request");
        (async () => {
            try {
                const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
                console.log("Background: Found tabs for stop:", tabs);
                if (tabs && tabs.length > 0) {
                    // Stop screen recording
                    stopScreenRecording().then(() => sendResponse({ status: "success" }))
                    .catch((err) => sendResponse({ status: "error", message: err.message }));
                
                return true;
                    
                
                } else {
                    console.error("Background: No active tab found for stop");
                    sendResponse({ status: "error", message: "No active tab found" });
                }
            } catch (error) {
                console.error("Background: Error stopping recording:", error);
                sendResponse({ status: "error", message: error.message });
            }
        })();

     
        
    }
    else if (message.action === "SCREENSHOT_CAPTURED") {
        console.log("Background: Handling screenshot capture request");
        handleScreenshot(sender.tab.id,message.screenshot)
    }
    
    else if (message.action === "getTabId") {
        (async () => {
            const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            console.log("Background: Getting tab ID", tabs);
            sendResponse({ tabId: tabs[0].index, tabTitle: tabs[0].title });
        })();
    }
    return true;
    
});

function create_window(window_type, payload) {
    payload.windowType = window_type;
    chrome.windows.create({
        focused: true,
        type: 'normal',
        state: 'maximized',
        url: 'https://preview--workflow-chat-buddy-04.lovable.app/screen-recording'
    },
    (window) => {
        window_payload_map.set(window.id, payload);
        // Open the side panel in the newly created window
        let run_id = payload.runId;
        if (run_id) {
            run_id_to_window_id_map.set(run_id, window.id);
        }
        chrome.sidePanel.open({ windowId: window.id }, () => {
            if (chrome.runtime.lastError) {
                console.error("Failed to open side panel:", chrome.runtime.lastError);
            } else {
                console.log("Side panel opened in new window");
            }
        });
    });
}

// Get the window ID of the current tab
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "get-window-payload") {
        console.log("Received message get-window-payload:", request, "from sender:", sender, "with window id:", request.windowId);
        sendResponse({ payload: window_payload_map.get(request.windowId) });
    }
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });



async function startScreenRecording() {
    console.log("Background: Starting screen recording");
    recordedChunks = [];
    isRecording = true;
    
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs || tabs.length === 0) {
            throw new Error("No active tab found for screen recording");
        }
        const activeTab = tabs[0];
        activeRecordingTabId = activeTab.id;
        
        // Inject screen capture script first
        await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            function: initiateScreenCapture
        });

        // Wait for the START_CAPTURING_INTERNAL message before sending START_CAPTURING
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Timeout waiting for recording to start")), 30000);
            
            const listener = (message) => {
                if (message.action === "START_CAPTURING_INTERNAL") {
                    clearTimeout(timeout);
                    chrome.runtime.onMessage.removeListener(listener);
                    resolve();
                }
            };
            
            chrome.runtime.onMessage.addListener(listener);
        });

        // Now send the START_CAPTURING message after recording has started
        await chrome.tabs.sendMessage(activeTab.id, { action: "START_CAPTURING" });
        
    } catch (error) {
        console.error("Background: Error starting screen recording:", error);
        isRecording = false;
        throw error;
    }
}


// Helper function to convert Blob to base64
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function initiateScreenCapture() {
    console.log("Tab context: Initiating screen capture");
    
    const port = chrome.runtime.connect({ name: "screenRecorder" });
    
    // Create the initial instruction div
    console.log("Tab context: Initiating screen capture2");
    const div = document.createElement('div');
    div.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        padding: 20px;
        background: rgba(0, 0, 0, 0.9);
        color: white;
        z-index: 2147483647;
        font-family: Arial, sans-serif;
        text-align: center;
        border-radius: 8px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    `;
    div.innerHTML = `
        <p style="margin-bottom: 15px;">Please select a window to share for recording.</p>
        <button id="start-capture" style="
            padding: 10px 20px;
            margin: 0 10px;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        ">Select Window</button>
        <button id="cancel-capture" style="
            padding: 10px 20px;
            margin: 0 10px;
            background: #f44336;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        ">Cancel</button>
    `;
    document.body.appendChild(div);
    console.log("Tab context: Initiating screen capture3");
    // Create the instruction text
   
    

    console.log("Tab context: Initiating screen capture5");
    document.getElementById('start-capture').addEventListener('click', function() {
       
       document.body.removeChild(div);
        
        navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: "always",
                displaySurface: "window",
                logicalSurface: true,
                frameRate: { ideal: 30 }
            },
            audio: false,
            suppressLocalAudioPlayback: true,
            systemAudio: "exclude",
            selfBrowserSurface: "exclude",
            surfaceSwitching: "exclude",
            monitorTypeSurfaces: "exclude"
        }).then(function(stream) {
            
            
            // Set up media recorder
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'video/webm;codecs=vp9',
                videoBitsPerSecond: 2500000 // 2.5 Mbps
            });
            
            // Add a small recording indicator
            const indicator = document.createElement('div');
            indicator.style.cssText = `
                position: fixed;
                top: 10px;
                right: 10px;
                background: rgba(255, 0, 0, 0.7);
                color: white;
                padding: 5px 10px;
                border-radius: 5px;
                font-size: 12px;
                z-index: 9999999;
                font-family: Arial, sans-serif;
            `;
            indicator.textContent = "● Recording";
            document.body.appendChild(indicator);
            
            const recordedChunks = [];
         
            
            mediaRecorder.ondataavailable = function(event) {
                if (event.data.size > 0) {
                    recordedChunks.push(event.data);
                    // Send chunk to background to avoid memory issues
                    const reader = new FileReader();
                    reader.onloadend = function() {
                        port.postMessage({ 
                            action: "recordingChunk", 
                            chunk: reader.result 
                        });
                    };
                    reader.readAsDataURL(event.data);
                }
            };
            
            mediaRecorder.onstop = function() {
                stream.getTracks().forEach(function(track) { track.stop(); });
                if (document.body.contains(indicator)) {
                    document.body.removeChild(indicator);
                }
                console.log("Screen recording stopped H21");
                
                // Create a blob from the recorded chunks
                const videoBlob = new Blob(recordedChunks, {
                    type: 'video/webm'
                });
                
                // Convert blob to base64 and send it
                console.log("Screen recording stopped H22");
                const reader = new FileReader();
                reader.onloadend = function() {
                    port.postMessage({ 
                        action: "processScreenRecording",
                        videoBlob: reader.result
                    });
                };
                console.log("Screen recording stopped H23");
                reader.readAsDataURL(videoBlob);
            };
            
            // Start recording
            mediaRecorder.start(1000);
            
            // Save the recorder instance to window for later access
            window.extensionMediaRecorder = mediaRecorder;
            
            // Send START_CAPTURING message to content script after recording has started
            chrome.runtime.sendMessage({ action: "START_CAPTURING_INTERNAL" });
            
            // Notify that recording has started and request new tab creation
            port.postMessage({ 
                action: "recordingStarted",
                createNewTab: true
            });
        }).catch(function(error) {
            
            console.error("Tab context: Error starting media recorder:", error);
            port.postMessage({ action: "recordingError", error: error.message });
        });
    });
    
    document.getElementById('cancel-capture').addEventListener('click', function() {
        document.body.removeChild(div);
        
        port.postMessage({ action: "recordingCancelled" });
    });
}

async function stopScreenRecording() {
    console.log("Background: Stopping screen recording");
    
    try {
        isRecording = false;
        if (!activeRecordingTabId) {
            throw new Error("No active recording found");
        }

        await chrome.tabs.sendMessage(activeRecordingTabId, { action: "STOP_CAPTURING" });

        await chrome.scripting.executeScript({
            target: { tabId: activeRecordingTabId },
            function: () => {
                if (window.extensionMediaRecorder && 
                    window.extensionMediaRecorder.state !== 'inactive') {
                    console.log("Tab context: Stopping media recorder");
                    window.extensionMediaRecorder.stop();
                }
            }
        });

        activeRecordingTabId = null;
    } catch (error) {
        console.error("Background: Error stopping screen recording:", error);
        throw error;
    }
}

// Modify the port listener
chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "screenRecorder") {
        console.log("Background: Screen recorder port connected");
        recordingPort = port;
        
        port.onMessage.addListener((message) => {
            console.log("Background: Received port message:", message);
            
            if (message.action === "recordingStarted") {
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs && tabs.length > 0) {
                        console.log("Background: Recording started in tab", tabs[0].id);
                        activeRecordingTabId = tabs[0].id;
                        
                        // Create new tab if requested
                        if (message.createNewTab) {
                            chrome.tabs.create({ url: 'https://www.google.com' });
                        }
                    }
                });
            } else if (message.action === "processScreenRecording") {
                // Store the final recording data
                chrome.runtime.sendMessage({ 
                    action: "processScreenRecording",
                    videoBlob: message.videoBlob
                });
            } else if (message.action === "recordingError") {
                console.error("Background: Recording error:", message.error);
                isRecording = false;
            }
        });
        
        port.onDisconnect.addListener(() => {
            console.log("Background: Screen recorder port disconnected");
            recordingPort = null;
            // Don't set isRecording to false here as we might be reconnecting
        });
    }
});

function handleScreenshot(tabId, screenshot) {
    console.log(`Screenshot captured for tab ${tabId}`);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `screenshot-${timestamp}.png`;
    
    // Convert base64 to blob URL
    const base64Data = screenshot.replace(/^data:image\/png;base64,/, "");
    
    // Create download
    chrome.downloads.download({
        url: screenshot,
        filename: filename,
        saveAs: false  // This ensures silent download without prompting
    }, (downloadId) => {
        if (chrome.runtime.lastError) {
            console.error('Error saving screenshot:', chrome.runtime.lastError);
        } else {
            console.log(`Screenshot saved as ${filename} with download ID: ${downloadId}`);
        }
    });
}



// Add these new listeners
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (isRecording && changeInfo.status === 'complete') {
        console.log("Tab updated while recording:", tabId);
        try {
            await chrome.tabs.sendMessage(tabId, { action: "START_CAPTURING" });
            
            // Reinject screen capture script if this is the active recording tab
            if (tabId === activeRecordingTabId) {
                await chrome.scripting.executeScript({
                    target: { tabId },
                    function: initiateScreenCapture
                });
            }
        } catch (error) {
            console.error("Error restarting capture on updated tab:", error);
        }
    }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    if (isRecording) {
        console.log("Tab activated while recording:", activeInfo.tabId);
        try {
            await chrome.tabs.sendMessage(activeInfo.tabId, { action: "START_CAPTURING" });
        } catch (error) {
            console.error("Error starting capture on activated tab:", error);
        }
    }
});

