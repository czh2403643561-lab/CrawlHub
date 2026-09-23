const PROJECTS_STORAGE_KEY = "crawlHub.projects.v1";
const BINDING_CACHES_STORAGE_KEY = "crawlHub.bindingCaches.v1";
const BINDING_DEBUG_MODES_STORAGE_KEY = "crawlHub.bindingDebugModes.v1";

async function readProjects() {
  const stored = await chrome.storage.local.get(PROJECTS_STORAGE_KEY);
  return stored[PROJECTS_STORAGE_KEY] || {};
}

async function readStorageMap(key) {
  const stored = await chrome.storage.local.get(key);
  return stored[key] || {};
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    const end = Math.min(offset + 0x8000, bytes.length);
    let chunk = "";
    for (let index = offset; index < end; index += 1) chunk += String.fromCharCode(bytes[index]);
    binary += chunk;
  }
  return btoa(binary);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type?.startsWith("crawlHub:")) return undefined;

  (async () => {
    if (message.type === "crawlHub:ping") return { connected: true };
    if (message.type === "crawlHub:download-image") {
      const imageUrl = new URL(String(message.url || ""));
      if (imageUrl.protocol !== "https:" || !/(?:^|\.)tiktokcdn(?:-eu)?\.com$|(?:^|\.)ibytedtos\.com$/i.test(imageUrl.hostname)) {
        throw new Error("图片地址不是受支持的 TikTok 商品 CDN");
      }
      const response = await fetch(imageUrl.href, { credentials: "omit" });
      if (!response.ok) throw new Error(`图片下载失败（HTTP ${response.status}）`);
      const buffer = await response.arrayBuffer();
      return {
        base64: arrayBufferToBase64(buffer),
        content_type: response.headers.get("content-type") || "",
        byte_length: buffer.byteLength
      };
    }
    if (message.type === "crawlHub:download-batch-template") {
      const response = await fetch(chrome.runtime.getURL("templates/CrawlHub_批量提报模板.csv"));
      if (!response.ok) throw new Error("导入模板读取失败。");
      return { filename: "CrawlHub_批量提报模板.csv", content: await response.text() };
    }
    const cacheKey = String(message.cache_key || "");
    if (message.type === "crawlHub:read-binding-debug-mode") {
      const modes = await readStorageMap(BINDING_DEBUG_MODES_STORAGE_KEY);
      return { enabled: Boolean(modes[cacheKey]) };
    }
    if (message.type === "crawlHub:save-binding-debug-mode") {
      if (!cacheKey) throw new Error("缓存范围不完整");
      const modes = await readStorageMap(BINDING_DEBUG_MODES_STORAGE_KEY);
      if (message.enabled) modes[cacheKey] = true;
      else delete modes[cacheKey];
      await chrome.storage.local.set({ [BINDING_DEBUG_MODES_STORAGE_KEY]: modes });
      return { enabled: Boolean(message.enabled) };
    }
    if (message.type === "crawlHub:read-binding-cache") {
      const caches = await readStorageMap(BINDING_CACHES_STORAGE_KEY);
      return { cache: caches[cacheKey] || null };
    }
    if (message.type === "crawlHub:save-binding-cache") {
      if (!cacheKey || !message.cache) throw new Error("扫描缓存不完整");
      const caches = await readStorageMap(BINDING_CACHES_STORAGE_KEY);
      caches[cacheKey] = message.cache;
      await chrome.storage.local.set({ [BINDING_CACHES_STORAGE_KEY]: caches });
      return { cache: caches[cacheKey] };
    }
    if (message.type === "crawlHub:clear-binding-cache") {
      if (!cacheKey) throw new Error("缓存范围不完整");
      const caches = await readStorageMap(BINDING_CACHES_STORAGE_KEY);
      delete caches[cacheKey];
      await chrome.storage.local.set({ [BINDING_CACHES_STORAGE_KEY]: caches });
      return { cleared: true };
    }
    const projects = await readProjects();
    if (message.type === "crawlHub:save-project") {
      const projectId = String(message.project_id || "");
      if (!projectId || !message.project) throw new Error("项目数据不完整");
      const existing = projects[projectId];
      const project = {
        ...message.project,
        metadata: {
          ...message.project.metadata,
          created_at: existing?.metadata?.created_at || message.project.metadata?.created_at || new Date().toISOString()
        },
        project_id: projectId,
        saved_at: new Date().toISOString()
      };
      projects[projectId] = project;
      await chrome.storage.local.set({ [PROJECTS_STORAGE_KEY]: projects });
      return { project };
    }
    if (message.type === "crawlHub:read-project") {
      return { project: projects[String(message.project_id || "")] || null };
    }
    throw new Error("不支持的数据操作");
  })().then(
    (data) => sendResponse({ ok: true, ...data }),
    (error) => sendResponse({ ok: false, error: error?.message || "本地数据保存失败" })
  );
  return true;
});
