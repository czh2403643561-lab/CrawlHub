(() => {

const storageRequestEvent = "crawlHub:storage-request";
const storageResponseEvent = "crawlHub:storage-response";
const reconnectSessionKey = "crawlHub.reconnect.pending";
const bindingCachesStorageKey = "crawlHub.bindingCaches.v1";
const bindingDebugModesStorageKey = "crawlHub.bindingDebugModes.v1";
const directBindingStorageTypes = new Set([
  "crawlHub:read-binding-debug-mode",
  "crawlHub:save-binding-debug-mode",
  "crawlHub:read-binding-cache",
  "crawlHub:save-binding-cache",
  "crawlHub:clear-binding-cache"
]);

function isExtensionContextError(error) {
  return /extension context invalidated|receiving end does not exist|message port closed/i.test(String(error?.message || error || ""));
}

if (globalThis.__crawlHubStorageBridgeHandler) {
  document.removeEventListener(storageRequestEvent, globalThis.__crawlHubStorageBridgeHandler);
}

async function readStorageMap(storageKey) {
  const stored = await globalThis.chrome.storage.local.get(storageKey);
  return stored?.[storageKey] && typeof stored[storageKey] === "object" ? stored[storageKey] : {};
}

async function handleDirectBindingStorageRequest(request) {
  const cacheKey = String(request.cache_key || "");
  if (!cacheKey) throw new Error("缓存范围不完整");

  if (request.type === "crawlHub:read-binding-debug-mode") {
    const modes = await readStorageMap(bindingDebugModesStorageKey);
    return { ok: true, enabled: Boolean(modes[cacheKey]) };
  }

  if (request.type === "crawlHub:save-binding-debug-mode") {
    const modes = await readStorageMap(bindingDebugModesStorageKey);
    if (request.enabled) modes[cacheKey] = true;
    else delete modes[cacheKey];
    await globalThis.chrome.storage.local.set({ [bindingDebugModesStorageKey]: modes });
    return { ok: true, enabled: Boolean(request.enabled) };
  }

  const caches = await readStorageMap(bindingCachesStorageKey);
  if (request.type === "crawlHub:read-binding-cache") {
    return { ok: true, cache: caches[cacheKey] || null };
  }
  if (request.type === "crawlHub:save-binding-cache") {
    if (!request.cache || typeof request.cache !== "object") throw new Error("扫描缓存不完整");
    caches[cacheKey] = request.cache;
    await globalThis.chrome.storage.local.set({ [bindingCachesStorageKey]: caches });
    return { ok: true, cache: caches[cacheKey] };
  }
  if (request.type === "crawlHub:clear-binding-cache") {
    delete caches[cacheKey];
    await globalThis.chrome.storage.local.set({ [bindingCachesStorageKey]: caches });
    return { ok: true, cleared: true };
  }

  throw new Error("不支持的绑定缓存操作");
}

const storageBridgeHandler = async (event) => {
  const request = event.detail;
  if (!request?.request_id || !request?.type) return;
  try {
    if (!globalThis.chrome?.runtime?.id) throw new Error("Extension context invalidated.");
    const response = directBindingStorageTypes.has(request.type)
      ? await handleDirectBindingStorageRequest(request)
      : await globalThis.chrome.runtime.sendMessage({
        type: request.type,
        project_id: request.project_id,
        project: request.project,
        cache_key: request.cache_key,
        cache: request.cache,
        enabled: request.enabled
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
