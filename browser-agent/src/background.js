'use strict';

const PAGE_METHOD_DOMAINS = ["Page", "Runtime", "Network","Log","DOM","Overlay","Input","Emulation","Accessibility"];


const updated_browser_version_result = {
    "protocolVersion": "1.3",
    "product": "Chrome/134.0.6998.35",
    "revision": "@ea6ef4c2ac15ae95d2cfd65682da62c093415099",
    "userAgent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    "jsVersion": "13.4.114.14"
};

function generate_random_session_id() {
  return [...Array(32)]
    .map(() => Math.floor(Math.random() * 16).toString(16).toUpperCase())
    .join('');
}


const PROXY_WS_URL = "ws://34.171.7.176:9223/extension";
let socket = null;

async function attach_to_tab(tabId, targetId) {
  // todo: what is the correct way to not try to attach again?
  return new Promise((resolve, reject) => {
    let sessionId = generate_random_session_id();
    if (tab_session_registry.some(entry => entry.tabId === tabId)) { // don't try to attach again if we know someone already attached to this tab
      tab_session_registry.push({ tabId, sessionId, targetId });
      resolve(sessionId);
    }
    chrome.debugger.attach({ tabId }, "1.3", () => {
      if (chrome.runtime.lastError) {
        console.error("Failed to attach debugger:", chrome.runtime.lastError);
      }
      tab_session_registry.push({ tabId, sessionId, targetId });
      resolve(sessionId);
    });
  });
}
async function detach_from_tab(tabId) {
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      if (chrome.runtime.lastError) {
        console.warn("Failed to detach debugger (possibly not attached):", chrome.runtime.lastError);
      }
      console.log("Debugger detached");
      tab_session_registry = tab_session_registry.filter(t => t.tabId !== tabId); // remove all entries for this tab
      resolve();
    });
  });
}
async function simple_detach_from_target(targetId) {
  return new Promise((resolve) => {
    chrome.debugger.detach({targetId}, () => {
      if (chrome.runtime.lastError) {
        console.warn("Failed to detach debugger from target:", chrome.runtime.lastError);
      }
      console.log("Debugger detached from target", targetId);
      resolve();
    });
  });
}
async function detach_from_all_targets() {
  return new Promise(async (resolve) => {
    let targets = await chrome.debugger.getTargets();
    for (const target of targets) {
      if (target.attached) {
        await simple_detach_from_target(target.id);
      }
    }
    resolve();
  });
}

let browserTargetInfo = {
  type: "browser",
  title: "",
  url: "",
  attached: true,
  canAccessOpener: false,
  targetId: "b8f93388-34cb-4de8-b071-c1b071711254"
}
let browserSessionId = "D4BD71B1F4DFE512ED1783FF02EDE0F7";
let BROWSER_CONTEXT_ID = "94F66902FFA1FEE58E89A2C3BC80DA7E";

function add_fields_to_target(target) {
    return {
        ...target,
        targetId: target.id,
        attached: target.attached || true, // todo: this is a hack to always tell playwright that we are attached
        canAccessOpener: target.canAccessOpener || false,
        browserContextId: BROWSER_CONTEXT_ID,
    };
}

let autoAttach, tab_session_registry;  // state

function connectWebSocket() {
    console.log("Connecting to WebSocket:", PROXY_WS_URL);
    socket = new WebSocket(PROXY_WS_URL);

    socket.onopen = async () => {
        console.log("Connected to WebSocket server.");
        autoAttach = false;
        tab_session_registry = []; // todo, have a subscriptions field so that we can keep track of which sessions want what
        console.log("Detaching from all targets");
        let targets = await chrome.debugger.getTargets();
        console.log("targets", targets);
        await detach_from_all_targets();
        console.log("Detached from all targets");
        console.log("targets", targets);
    };

    socket.onmessage = async (event) => {
        console.log("Received from proxy:", event.data);
        const payload = JSON.parse(event.data);
        const method = payload.method;
        let result = null;
        if (method === "Browser.getVersion") {
            result = updated_browser_version_result;
        } else if (method.startsWith("Target.")) {
            let targets, notice_params, notice, request_session_id, targetId, sessionId, registry_entry, target_session_id;
            switch (method) {
                case "Target.attachToTarget": // ATTACH TO TARGET
                    // is legal to call multiple times for same target; should give a different sessionId each time, but of course then we have 1-many tabid->sessionid
                    request_session_id = payload.sessionId;
                    targetId = payload.params.targetId;
                    targets = await chrome.debugger.getTargets();
                    let target = targets.find(t => t.id === targetId);
                    let targetInfo = add_fields_to_target(target);
                    console.assert(targetInfo.targetId === targetId, `targetInfo.targetId (${targetInfo.targetId}) does not match targetId (${targetId})`);
                    console.assert(targetInfo.tabId, `targetInfo does not have tabId: ${JSON.stringify(targetInfo)}`);
                    sessionId = await attach_to_tab(targetInfo.tabId, targetId);
                    result = { sessionId };
                    // send attached to target response to playwright
                    notice_params = { sessionId, targetInfo, waitingForDebugger: false };
                    notice = { method: "Target.attachedToTarget", params: notice_params, sessionId: request_session_id };
                    socket.send(JSON.stringify(notice));
                    break;
                case "Target.detachFromTarget": // DETACH FROM TARGET
                    result = {};
                    request_session_id = payload.sessionId;
                    target_session_id = payload.params.sessionId;
                    registry_entry = tab_session_registry.find(t => t.sessionId === target_session_id);
                    if (!registry_entry) {
                      throw new Error("Target.detachFromTarget: sessionId not found in registry");
                    }
                    // await detach_from_tab(registry_entry.tabId);
                    tab_session_registry = tab_session_registry.filter(entry => entry.sessionId !== target_session_id); // remove this session from the registry
                    notice_params = { sessionId: target_session_id, targetId: registry_entry.targetId };
                    notice = { method: "Target.detachedFromTarget", params: notice_params, sessionId: request_session_id };
                    socket.send(JSON.stringify(notice));
                    break;
                case "Target.attachToBrowserTarget": // ATTACH TO BROWSER TARGET
                    if (payload.sessionId) {
                      console.log("Calling attachToBrowserTarget with sessionId", payload.sessionId);
                      throw new Error("Calling attachToBrowserTarget with sessionId is not allowed");
                    }
                    result = { sessionId: browserSessionId };
                    // send attachedToTarget event to playwright
                    notice_params = { sessionId: browserSessionId, targetInfo: browserTargetInfo, waitingForDebugger: false };
                    notice = { method: "Target.attachedToTarget", params: notice_params };
                    socket.send(JSON.stringify(notice));
                    break;
                case "Target.getTargets": // GET TARGETS
                    if (!payload.sessionId) {
                      targets = await chrome.debugger.getTargets();
                      let response_targets = targets.map(add_fields_to_target);
                      response_targets = response_targets.filter(t => t.type === "page");
                      result = { targetInfos: response_targets };
                    } else {
                      // we assume no iframes/scripts so the only target is the one corresponding to this session
                      targets = await chrome.debugger.getTargets();
                      registry_entry = tab_session_registry.find(t => t.sessionId === payload.sessionId);
                      if (!registry_entry) {
                        throw new Error("Target.getTargets: sessionId not found in registry");
                      }
                      result = { targetInfos: [add_fields_to_target(targets.find(t => t.id === registry_entry.targetId))] };
                    }
                    break;
                case "Target.getTargetInfo": // GET TARGET INFO (no params or sessionId)
                    if (!payload.sessionId) {
                        result = { targetInfo: browserTargetInfo };
                    } else {
                      console.log("Calling getTargetInfo with sessionId", payload.sessionId);
                      throw new Error("Calling getTargetInfo with sessionId is not allowed");
                    }
                    break;
                case "Target.createTarget": // CREATE TARGET
                    if (payload.sessionId) {
                      console.log("Calling Target.createTarget with sessionId", payload.sessionId);
                      throw new Error("Calling Target.createTarget with sessionId is not allowed");
                    }
                    const newTab = await chrome.tabs.create({ url: payload.params.url });
                    // search for the new tab
                    targets = await chrome.debugger.getTargets();
                    const new_target = targets.find(t => t.tabId === newTab.id);
                    let new_targetInfo = add_fields_to_target(new_target);
                    result = { targetId: new_targetInfo.targetId };
                    // send attached to target response to playwright (if autoattach is true)
                    if (autoAttach) {
                        sessionId = await attach_to_tab(newTab.id, new_targetInfo.targetId);
                        let notice_params = { sessionId, targetInfo: new_targetInfo, waitingForDebugger: false };
                        let notice = { method: "Target.attachedToTarget", params: notice_params };
                        socket.send(JSON.stringify(notice));
                    }
                    break;
                case "Target.setAutoAttach":
                    /*
                    Controls whether to automatically attach to new targets which are considered to be related to this one. 
                    When turned on, attaches to all existing related targets as well. 
                    When turned off, automatically detaches from all currently attached targets.
                    */
                    if (!payload.sessionId) {
                        autoAttach = true;
                        // automatically attach to all existing pages
                        targets = await chrome.debugger.getTargets();
                        let targetInfos = targets.filter(t => t.tabId).map(add_fields_to_target);
                        for (const targetInfo of targetInfos) {
                            if (targetInfo.url.startsWith("chrome") || targetInfo.url.startsWith("devtools")) {
                                continue;
                            }
                            await detach_from_tab(targetInfo.tabId);
                            sessionId = await attach_to_tab(targetInfo.tabId, targetInfo.targetId);
                            let notice_params = { sessionId, targetInfo, waitingForDebugger: false };
                            let notice = { method: "Target.attachedToTarget", params: notice_params };
                            socket.send(JSON.stringify(notice));
                        }
                    } else {
                        console.log("Calling Target.setAutoAttach with sessionId", payload.sessionId);
                        console.warn("This is currently not supported");
                    }
                    result = {};
                    break;
                default:
                    console.log("Unknown Target method:", method);
                    result = {};
            }
        } else if (PAGE_METHOD_DOMAINS.includes(method.split(".")[0])) {
          let registry_entry = tab_session_registry.find(t => t.sessionId === payload.sessionId);
          if (!registry_entry) {
            throw new Error("Unknown method: sessionId not found in registry", payload.sessionId);
          }
          result = await chrome.debugger.sendCommand({ tabId: registry_entry.tabId }, method, payload.params);
        } else {
          console.log("Unknown method:", method);
          result = {}
        }
        console.log("Sending response:", result);
        const response = { "id": payload.id, "result": result }
        if (payload.sessionId) {  // keep the sessionId if present 
          response.sessionId = payload.sessionId;
        }
        socket.send(JSON.stringify(response));
    };

    socket.onclose = () => {
        console.log("WebSocket closed. Reconnecting in 3 seconds...");
        setTimeout(connectWebSocket, 3000); // Auto-reconnect
    };

    socket.onerror = (error) => {
        console.error("WebSocket error:", error);
    };
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  let registry_entries = tab_session_registry.filter(t => t.tabId === source.tabId);
  if (registry_entries.length > 1) {
    console.log("Multiple registry entries found for tabId:", source.tabId);
  }
  for (const registry_entry of registry_entries) {
    let session_id = registry_entry.sessionId;
    let payload = {
      method: method,
      params: params,
      sessionId: session_id,
    }
    socket.send(JSON.stringify(payload));
  }
})

// Start WebSocket connection
connectWebSocket();