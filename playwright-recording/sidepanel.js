const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const status = document.getElementById("status");

startBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.runtime.sendMessage({ action: "startRecording", tabId: tab.id }, (response) => {
    status.textContent = "Recording...";
    status.style.color = "red";
  });
});

stopBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.runtime.sendMessage({ action: "stopRecording", tabId: tab.id }, (response) => {
    status.textContent = "Stopped";
    status.style.color = "green";
  });
});
