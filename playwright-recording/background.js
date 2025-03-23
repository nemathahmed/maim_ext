let isRecording = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startRecording") {
    const tabId = message.tabId;
    if (!isRecording) {
      chrome.debugger.attach({ tabId }, "1.3", () => {
        chrome.debugger.sendCommand({ tabId }, "Page.enable");
        chrome.debugger.sendCommand({ tabId }, "Page.startScreencast", {
          format: "jpeg",
          quality: 80,
          everyNthFrame: 1
        });
        isRecording = true;
        sendResponse({ status: "recording started" });
      });
    } else {
      sendResponse({ status: "already recording" });
    }
    return true;
  }

  if (message.action === "stopRecording") {
    const tabId = message.tabId;
    if (isRecording) {
      chrome.debugger.sendCommand({ tabId }, "Page.stopScreencast", () => {
        chrome.debugger.detach({ tabId }, () => {
          isRecording = false;
          sendResponse({ status: "recording stopped" });
        });
      });
    } else {
      sendResponse({ status: "not recording" });
    }
    return true;
  }
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "screenshot") {
      chrome.tabs.captureVisibleTab(null, { format: "jpeg", quality: 80 }, (dataUrl) => {
        sendResponse(dataUrl);
      });
      return true; // Keeps response channel open
    }
  });
  