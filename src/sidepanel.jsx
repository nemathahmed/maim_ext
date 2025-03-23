import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
// import './background_agent.js';
// import ChatInterface from "../../workflow-chat-buddy/src/components/ChatInterface";
// import App from "../../workflowlchat-buddy/src/App";
// import Index from "../../workflow-chat-buddy/src/pages/Index";

// import { createClient } from './supabase.js';

import { createClient } from '@supabase/supabase-js';
console.log("Creating supabase client in sidepanel");
const SUPABASE_URL = 'https://scydgsnstcmcdfxrgvoh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjeWRnc25zdGNtY2RmeHJndm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE5OTAyOTgsImV4cCI6MjA1NzU2NjI5OH0.ZHfoMs5E_1Hra4KAlLt610RuQQA71Zlfl_zEGETGUaE';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjeWRnc25zdGNtY2RmeHJndm9oIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MTk5MDI5OCwiZXhwIjoyMDU3NTY2Mjk4fQ.NNZCzKTIqyh7rdzrERQ1kE1YQjxAcQuQ2-ph5UVZ8BQ';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
let isRecording = false;
let selectedElement = null;
let mediaRecorder = null;
// TODO: reply to commands with real results
const channel = supabase
  .channel('db-changes')
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'run_messages'
    },
    async (payload) => {
      console.log('Change received!', payload);
      let sender_type = payload.new.sender_type;
      let type = payload.new.type;
      console.log('Sender type:', sender_type);
      console.log('Type:', type);
    //   if (sender_type === 'backend' && type === 'command') {
    //     console.log('Command received:', payload.new.display_text);
    //     await supabase.from("run_messages").insert({
    //       "run_id": payload.new.run_id,
    //       "type": "result",
    //       "chat_id": payload.new.chat_id,
    //       "sender_type": "extension",
    //       "display_text": "Command received",
    //       "payload": {
    //         "dom": "fake"
    //       }
    //     });
    //   } 
    }
  )
  .subscribe();

// Add this at the top level, near other global variables
let globalWindowPayload = null;
let recordingMessageId = null; // Add this near other global variables
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    chrome.runtime.sendMessage({
      type: "sidepanel_opened",
      windowId: tab.windowId,
    });
  });
function SidePanel() {
    const [windowId, setWindowId] = useState("unknown");
    const [windowPayload, setWindowPayload] = useState("unknown");

    useEffect(() => {
        // Add message event listener
        const handleMessage = async (event) => {
            // Verify origin if needed
            if (event.data.type === 'START_RECORDING') {
                console.log('Received START_RECORDING message:', event.data);
                if (!isRecording) {
                    try {
                        // Create initial recording message
                        const { data: messageData, error: messageError } = await supabase
                            .from('messages')
                            .insert({
                                chat_id: globalWindowPayload.chatId,
                                role: 'user',
                                content: 'Recording in Progress',
                                username: 'current_user',
                                from_template: false,
                                is_currently_streaming: false,
                                function_name: 'recording_progress'
                            })
                            .select();

                        if (messageError) throw messageError;
                        recordingMessageId = messageData[0].id;

                        // Original recording logic first
                        const tabs = await chrome.tabs.query({ currentWindow: true });
                        
                        // Inject content script into all tabs if not already injected
                        for (const tab of tabs) {
                            try {
                                await chrome.scripting.executeScript({
                                    target: { tabId: tab.id },
                                    files: ['content.js']
                                });
                            } catch (e) {
                                console.log(`Script already injected in tab ${tab.id}`);
                            }
                        }
                        
                        // Start recording in the active tab
                        console.log("Popup: Sending start message to background");
                        const response = await chrome.runtime.sendMessage({ action: "START_RECORDING" });
                        console.log("Popup: Received response from background:", response);
                        
                        if (response.status === "error") {
                            throw new Error(response.message);
                        }
                        
                        isRecording = true;
                    
                        
                    } catch (error) {
                        console.error("Popup: Error starting recording:", error);
                        document.getElementById("status").textContent = error.message || "Error starting recording";
                        isRecording = false;
                    }
                }
            } else if (event.data.type === 'STOP_RECORDING') {
                console.log('Received STOP_RECORDING message:', event.data);
                if (isRecording) {
                
                    
                   
                    try {
                        console.log("Popup: Sending stop message to background");
                        const response = await chrome.runtime.sendMessage({ action: "STOP_RECORDING" });
                        console.log("Popup: Received stop response:", response);
                        
                        if (response.status === "error") {
                            throw new Error(response.message);
                        }
                        
                        isRecording = false;
                        
                    } catch (error) {
                        console.error("Popup: Error stopping recording:", error);
                        isRecording = false;
                    }
                }
            }
        };

        window.addEventListener('message', handleMessage);

        // get our window id
        chrome.windows.getCurrent((window) => {
            setWindowId(window.id);
            // ask the background script for the window type (recording or agent)
            chrome.runtime.sendMessage({type: "get-window-payload", windowId: window.id}, async (response) => {
                let payload = response.payload;
                setWindowPayload(payload);
                // Store in global variable for use in processScreenRecording
                globalWindowPayload = payload;
                console.log("Sidepanel: Received window payload:", payload);
                // post a run_message indicating that the extension has launched
                if (payload && payload.runId && payload.chatId) {
                    console.log("Sending extension_loaded message for run:", payload.runId);
                    await supabase.from("run_messages").insert({
                        "run_id": payload.runId,
                        "type": "extension_loaded",
                        "chat_id": payload.chatId,
                        "sender_type": "extension",
                        "display_text": "Extension loaded",
                    });
                }
            });
        });

        // Cleanup listener on unmount
        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    const getIframeSrc = () => {
        if (windowPayload.windowType === "CREATE_RECORDING_WINDOW") {
            return "https://preview--workflow-chat-buddy-04.lovable.app/conversation?chat_id=" + windowPayload.chatId;
        } else if (windowPayload.windowType === "CREATE_AGENT_RUN_WINDOW") {
            return "https://preview--workflow-chat-buddy-04.lovable.app/workflow?chat_id=" + windowPayload.chatId;
        }
        return null;
    };

    return (
        <div style={{ padding: 0, height: '100vh', display: 'flex', flexDirection: 'column' }}>
            {windowPayload.windowType !== "unknown" ? (
                <iframe 
                    src={getIframeSrc()}
                    style={{
                        width: '100%',
                        height: '100%',
                        border: 'none',
                        flex: 1
                    }}
                />
            ) : (
                <div style={{ padding: '8px' }}>Loading...</div>
            )}
        </div>
    );
}

const container = document.createElement("div");
document.body.appendChild(container);
const root = createRoot(container);
root.render(<SidePanel />);




chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    console.log("Sidepanel: Received message:", message);
    if (message.type === "START_RECORDING") {
        // Dispatch message to window to trigger the useEffect handler
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'START_RECORDING' }
        }));
        sendResponse({ status: "success" });
        return true;
    }
    else if (message.type === "STOP_RECORDING") {
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'STOP_RECORDING' }
        }));
        sendResponse({ status: "success" });
        return true;
    }
    else if (message.action === "processScreenRecording") {
        console.log("Sidepanel: Processing screen recording");
        
        if (!message.videoBlob) {
            console.error("Sidepanel: No video blob received");
            return;
        }
        
        // Process the recording
        processScreenRecording(message.videoBlob)
            .then(() => {
                console.log("Sidepanel: Screen recording processed successfully");
                sendResponse({ status: "success" });
            })
            .catch((error) => {
                console.error("Sidepanel: Error processing screen recording:", error);
                sendResponse({ status: "error", error: error.message });
            });
            
        return true; // Keep the message channel open for async response
    } else if (message.action === "sendScreenshotToServer") {
        try {
            // Check Supabase connection first with a known table
            const { data: schemaCheck, error: schemaError } = await supabase
                .from('keyframes')  
                .select('count')
                .limit(1);

            if (schemaError) {
                throw new Error(`Supabase connection failed: ${schemaError.message}`);
            }

            console.log('Supabase connection successful');
            
            // Generate a unique filename for the screenshot
            const timestamp = new Date().getTime();
            const filename = `screenshot_${timestamp}.png`;
            
            // 1. Upload screenshot to storage
            let screenshotUrl = null;
            try {
                // Convert base64 to blob
                const base64Data = message.data.screenshot.split(',')[1];
                const blob = await (await fetch(`data:image/png;base64,${base64Data}`)).blob();
                
                // Upload to Supabase storage
                const { data: uploadData, error: uploadError } = await supabase
                    .storage
                    .from('workflow-screenshots')
                    .upload(`public/${filename}`, blob, {
                        contentType: 'image/png',
                        upsert: true
                    });
                    
                if (uploadError) {
                    console.error('Error uploading screenshot:', uploadError);
                } else {
                    console.log('Screenshot uploaded successfully:', uploadData);
                    
                    // Get the public URL
                    const { data: publicUrlData } = supabase
                        .storage
                        .from('workflow-screenshots')
                        .getPublicUrl(`public/${filename}`);
                        
                    screenshotUrl = publicUrlData.publicUrl;
                    console.log('Screenshot public URL:', screenshotUrl);
                }
            } catch (uploadErr) {
                console.error('Error processing upload:', uploadErr);
            }
            
            // 2. Save record to keyframes table with both the screenshot base64 and URL
            const { data, error } = await supabase
                .from('keyframes')
                .insert([{
                    screenshot_base64: message.data.screenshot,
                    screenshot_url: screenshotUrl,
                    timestamp: message.data.timestamp,
                    url: message.data.url,
                    clicked_element: message.data.clickedElement,
                    tab_id: message.data.tabId,
                    tab_title: message.data.tabTitle,
                    typing_events: message.data.recentTypingEvents,
                    html_snapshot: message.data.htmlSnapshot,
                    created_at: new Date().toISOString(),
                    message_id: recordingMessageId
                }]);

            if (error) {
                console.error('Error saving to Supabase:', error);
            } else {
                console.log('Successfully saved keyframe to Supabase:', data);
            }
        } catch (error) {
            console.error('Error in Supabase operation:', error);
        }
        
        return true; // Keep the message channel open for async response
    }
});

// Helper function to process the recording
async function processScreenRecording(videoBlob) {
    try {
        // Check Supabase connection first
        const { data: schemaCheck, error: schemaError } = await supabase
            .from('keyframes')  
            .select('count')
            .limit(1);

        if (schemaError) {
            throw new Error(`Supabase connection failed: ${schemaError.message}`);
        }
        
        // Convert base64 to blob properly
        const base64Data = videoBlob.split(',')[1];
        const blob = await fetch(videoBlob).then(r => r.blob());
        
        // Generate unique filename
        const timestamp = new Date().getTime();
        const filename = `screen_recording_${timestamp}.webm`;
        
        // Upload to Supabase storage
        const { data: uploadData, error: uploadError } = await supabase
            .storage
            .from('workflow-recordings')
            .upload(`public/${filename}`, blob, {
                contentType: 'video/webm',
                cacheControl: '3600',
                upsert: true
            });
            
        if (uploadError) throw uploadError;
        
        // Get public URL
        const { data: publicUrlData } = supabase
            .storage
            .from('workflow-recordings')
            .getPublicUrl(`public/${filename}`);
            
        // Update the existing message instead of creating a new one
        const { data: messageData, error: messageError } = await supabase
            .from('messages')
            .update({
                content: 'Recording Complete',
                function_name: 'screen_recording',
                screenrecording_url: publicUrlData.publicUrl
            })
            .eq('id', recordingMessageId)
            .select();

        if (messageError) throw messageError;
        
        // Test the video playback
        const videoElement = document.createElement('video');
        videoElement.controls = true;
        videoElement.src = publicUrlData.publicUrl;
        videoElement.style.maxWidth = '100%';
        // document.body.appendChild(videoElement);
        
    } catch (error) {
        // document.getElementById("status").textContent = "Error uploading screen recording: " + error.message;
        console.error("Error uploading screen recording:", error);
        throw error;
    }
}



  