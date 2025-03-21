let events = [];
let screenshots = [];
let recorder = null;
let isRecording = false;
let isPickerActive = false;
let highlightedElement = null;
let originalOutline = null;
let port = null;

// Initialize rrweb when the script loads
let rrwebScript = document.createElement('script');
rrwebScript.src = chrome.runtime.getURL('rrweb.min.js');
document.head.appendChild(rrwebScript);

// Initialize html2canvas
let html2canvasScript = document.createElement('script');
html2canvasScript.src = chrome.runtime.getURL('html2canvas.min.js');
document.head.appendChild(html2canvasScript);

window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data.type) return;
    console.log("CONTENT SCRIPT: Received message:", event.data);
    if (event.data.type === "JUMP_TO_AGENT_WINDOW") {
        console.log("CONTENT SCRIPT: Received message to jump to agent window");
        // forward
        chrome.runtime.sendMessage({ type: event.data.type, payload: event.data.payload });
    }

    // Handle specific message types
    if (event.data.type === "CREATE_RECORDING_WINDOW" || event.data.type === "CREATE_AGENT_RUN_WINDOW") {
        console.log("CONTENT SCRIPT: Received message to create window of type:", event.data.type, "with payload:", event.data.payload);
        // Send message to background script to create a new window
        chrome.runtime.sendMessage({ 
            type: event.data.type, // CREATE_RECORDING_WINDOW or CREATE_AGENT_RUN_WINDOW
            payload: event.data.payload 
        });
    }



}); 

window.postMessage({ type: "EXTENSION_INSTALLED" }, "*");

function startCapturing() {
    console.log("Content: startCapturing called, isRecording:", isRecording);
    if (isRecording) {
        console.log("Content: Already recording, ignoring start request");
        return;
    }
    
    // Ensure port is connected when starting recording
    // connectPort();
    
    console.log("Content: Initializing rrweb recorder");
    events = [];
    isRecording = true;

    try {
        if (typeof rrweb === 'undefined') {
            console.error("Content: rrweb is not defined!");
            return;
        }
        
        recorder = rrweb.record({
            emit(event) {
                events.push(event);
                // let eventDetail = getEventTypeName(event.type);
                
                // Add more details for incremental snapshots
                if (event.type === 3 && event.data.source !== undefined) {
                    const sourceMap = {
                        0: 'Mouse Move',
                        1: 'Mouse Interaction',
                        2: 'Viewport Resize',
                        3: 'Scroll',
                        4: 'Input',
                        5: 'Touch Move',
                        6: 'Media Interaction',
                        7: 'Style Sheet Rule',
                        8: 'Canvas Mutation',
                        9: 'Font',
                        10: 'Selection',
                    };
                    console.log("Content: Recorded event xyz:", event.data);
                    // eventDetail += ` - ${sourceMap[event.data.source] || 'Unknown Source'}`;

                    if (event.data.source === 2 && event.data.type === 1) {
                        console.log("Content: Mouse interaction click detected, capturing screenshot");
                        // Add delay before capturing screenshot
                        captureScreenshot(event.data.x, event.data.y);
                        // setTimeout(() => {
                        //     captureScreenshot(event.data.x, event.data.y);
                        // }, 1000); // 1 second delay
                    }
                }
                
                // console.log("Content: Recorded event:", eventDetail);
            },
        });
        console.log("Content: rrweb recorder initialized successfully");
    } catch (error) {
        console.error("Content: Error initializing rrweb:", error);
    }
}

function stopCapturing() {
    console.log("Content: Stop capturing called, isRecording:", isRecording);
    if (!isRecording) {
        console.log("Content: Not recording, nothing to stop");
        return;
    }
    
    console.log("Content: Stopping recording...");
    if (recorder) {
        recorder(); // Stop recording
        console.log("Content: Recorder stopped");
        recorder = null;
    }
    
    isRecording = false;
    console.log("Content: Sending recording complete message with", events.length, "events and", screenshots.length, "screenshots");
   
    // if (port) {
    //     try {
    //         port.disconnect();
    //     } catch (e) {
    //         console.log("Port already disconnected");
    //     }
    //     port = null;
    // }
}

async function captureScreenshot(x, y) {
    try {
        // Create and immediately remove cursor to make the click feel more responsive
        const cursor = document.createElement('div');
        cursor.style.cssText = `
            position: fixed;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: rgba(255, 0, 0, 0.5);
            border: 2px solid red;
            pointer-events: none;
            z-index: 999999;
            transform: translate(-50%, -50%);
            left: ${x}px;
            top: ${y}px;
        `;
        document.body.appendChild(cursor);
        
        // Remove cursor after a brief flash (100ms)
        setTimeout(() => document.body.removeChild(cursor), 100);

        // // Find the clicked element at the coordinates
        const clickedElement = document.elementFromPoint(x, y);
        const elementInfo = clickedElement ? {
            tag: clickedElement.tagName.toLowerCase(),
            text: clickedElement.textContent?.trim().substring(0, 50),
            xpath: getXPath(clickedElement),
            selector: generateUniqueSelector(clickedElement),
            attributes: getElementAttributes(clickedElement)
        } : null;

        // Get recent typing events from rrweb events array
        const recentTypingEvents = events
            .filter(event => {
                // Filter for input events in the last 5 seconds
                const isInputEvent = event.type === 3 && event.data.source === 4;
                const isRecent = Date.now() - event.timestamp < 5000;
                return isInputEvent && isRecent;
            })
            .map(event => ({
                timestamp: event.timestamp,
                value: event.data.text || '',
                target: event.data.target
            }));

        // Capture the screenshot
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const canvas = await html2canvas(document.documentElement, {
            width: viewportWidth,
            height: viewportHeight,
            windowWidth: viewportWidth,
            windowHeight: viewportHeight,
            x: window.pageXOffset,
            y: window.pageYOffset,
            scrollX: window.pageXOffset,
            scrollY: window.pageYOffset,
            allowTaint: true,
            useCORS: true,
            logging: false,
            scale: 0.75,
            imageTimeout: 2000,
            removeContainer: true,
            onclone: (clonedDoc) => {
                const fixedElements = clonedDoc.querySelectorAll('*:not([hidden]):not([style*="display: none"])');
                fixedElements.forEach(el => {
                    const style = window.getComputedStyle(el);
                    if (style.position === 'fixed') {
                        el.style.position = 'absolute';
                    }
                });
            }
        });
        
        const screenshot = canvas.toDataURL('image/jpeg', 0.3);
        
        // Get current tab ID
        const { tabId, tabTitle } = await new Promise(resolve => {
            chrome.runtime.sendMessage({ action: "getTabId" }, response => {
                resolve({ tabId: response.tabId, tabTitle: response.tabTitle });
            });
        });

        // Capture HTML snapshot
        const htmlSnapshot = document.documentElement.cloneNode(true);
        
        // Clean up the snapshot by removing scripts and potentially sensitive data
        const scripts = htmlSnapshot.getElementsByTagName('script');
        while (scripts[0]) {
            scripts[0].parentNode.removeChild(scripts[0]);
        }
        
        // Convert to string and limit size if needed
        const htmlString = htmlSnapshot.outerHTML;
        const maxSize = 5 * 1024 * 1024; // 5MB limit
        const truncatedHtml = htmlString.length > maxSize 
            ? htmlString.substring(0, maxSize) + '<!-- truncated -->'
            : htmlString;

        // Send enhanced data to background script
        chrome.runtime.sendMessage({ 
            action: "sendScreenshotToServer", 
            data: {
                screenshot: screenshot,
                timestamp: Date.now(),
                url: window.location.href,
                clickedElement: elementInfo,
                tabId: tabId,
                tabTitle: tabTitle,
                recentTypingEvents: recentTypingEvents,
                htmlSnapshot: truncatedHtml // Add HTML snapshot to the payload
            }
        });
    } catch (error) {
        console.error("Screenshot/HTML capture failed:", error);
    }
}

function getXPath(element) {
    if (!element) return '';
    
    try {
        if (element.id) {
            return `//*[@id="${element.id}"]`;
        }
        
        if (element === document.body) {
            return '/html/body';
        }
        
        let path = '';
        while (element.parentElement) {
            const index = Array.from(element.parentElement.children)
                .filter(child => child.tagName === element.tagName)
                .indexOf(element) + 1;
            
            path = `/${element.tagName.toLowerCase()}[${index}]${path}`;
            element = element.parentElement;
        }
        
        return `/html${path}`;
    } catch (e) {
        console.error('XPath generation failed:', e);
        return '';
    }
}

function generateUniqueSelector(element) {
    if (element.id) {
        return `#${element.id}`;
    }
    
    let path = [];
    while (element) {
        let selector = element.tagName.toLowerCase();
        if (element.className) {
            selector += `.${Array.from(element.classList).join('.')}`;
        }
        path.unshift(selector);
        element = element.parentElement;
    }
    return path.join(" > ");
}
function getElementAttributes(element) {
    if (!element) return {};
    
    const attributes = {};
    for (const attr of element.attributes) {
        attributes[attr.name] = attr.value;
    }
    return attributes;
}


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "START_CAPTURING") {
        console.log("Content script: Received START_CAPTURING message");
        // Your capturing logic here
        startCapturing();
        sendResponse({ status: "received" });
        return true; // Keep the message channel open for async response
    }
    if (message.action === "STOP_CAPTURING") {
        console.log("Content script: Received STOP_CAPTURING message");
        // Your capturing logic here
        stopCapturing();
        sendResponse({ status: "received" });
        return true; // Keep the message channel open for async response
    }
});
