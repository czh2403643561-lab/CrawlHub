(() => {

const storageRequestEvent = "crawlHub:storage-request";
const storageResponseEvent = "crawlHub:storage-response";
const reconnectSessionKey = "crawlHub.reconnect.pending";

function isExtensionContextError(error) {
  return /extension context invalidated|receiving end does not exist|message port closed/i.test(String(error?.message || error || ""));
}

if (globalThis.__crawlHubStorageBridgeHandler) {
  document.removeEventListener(storageRequestEvent, globalThis.__crawlHubStorageBridgeHandler);
}

const storageBridgeHandler = async (event) => {
  const request = event.detail;
  if (!request?.request_id || !request?.type) return;
  try {
    if (!globalThis.chrome?.runtime?.id) throw new Error("Extension context invalidated.");
    const response = await globalThis.chrome.runtime.sendMessage({
      type: request.type,
      project_id: request.project_id,
      project: request.project
    });
    document.dispatchEvent(new CustomEvent(storageResponseEvent, {
      detail: { request_id: request.request_id, ...(response || { ok: false, error: "本地数据服务未响应" }) }
    }));
  } catch (error) {
    const contextInvalidated = isExtensionContextError(error);
    document.dispatchEvent(new CustomEvent(storageResponseEvent, {
      detail: {
        request_id: request.request_id,
        ok: false,
        error: contextInvalidated ? "扩展刚刚重载，请点击浏览器工具栏中的 CrawlHub 图标重新打开面板后重试。" : (error?.message || "本地数据通信失败"),
        error_code: contextInvalidated ? "extension_context_invalidated" : null
      }
    }));
  }
};

document.addEventListener(storageRequestEvent, storageBridgeHandler);
globalThis.__crawlHubStorageBridgeHandler = storageBridgeHandler;
globalThis.__crawlHubStorageBridgeInstalled = true;

function injectReconnectPanel() {
  if (sessionStorage.getItem(reconnectSessionKey) !== "1") return;
  const script = document.createElement("script");
  script.src = globalThis.chrome.runtime.getURL("analyzer.js");
  script.dataset.crawlHubReconnect = "true";
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", injectReconnectPanel, { once: true });
else injectReconnectPanel();

})();
