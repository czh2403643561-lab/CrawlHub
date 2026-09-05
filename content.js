if (!globalThis.__crawlHubStorageBridgeInstalled) {
  globalThis.__crawlHubStorageBridgeInstalled = true;

  document.addEventListener("crawlHub:storage-request", async (event) => {
    const request = event.detail;
    if (!request?.request_id || !request?.type) return;
    try {
      const response = await chrome.runtime.sendMessage({
        type: request.type,
        project_id: request.project_id,
        project: request.project
      });
      document.dispatchEvent(new CustomEvent("crawlHub:storage-response", {
        detail: { request_id: request.request_id, ...response }
      }));
    } catch (error) {
      document.dispatchEvent(new CustomEvent("crawlHub:storage-response", {
        detail: { request_id: request.request_id, ok: false, error: error?.message || "本地数据通信失败" }
      }));
    }
  });
}
