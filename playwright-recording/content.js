let lastClickTime = 0;

document.addEventListener("click", async (e) => {
  const now = Date.now();
  if (now - lastClickTime < 300) return; // Prevent rapid clicks
  lastClickTime = now;

  console.log("Sending click event to server");
  fetch("http://localhost:8000/save_screenshot", {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
});
