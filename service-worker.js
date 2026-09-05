const PROJECTS_STORAGE_KEY = "crawlHub.projects.v1";

async function readProjects() {
  const stored = await chrome.storage.local.get(PROJECTS_STORAGE_KEY);
  return stored[PROJECTS_STORAGE_KEY] || {};
}

function latestProject(projects) {
  return Object.values(projects).sort((left, right) => {
    const leftTime = new Date(left.saved_at || left.metadata?.created_at || 0).valueOf();
    const rightTime = new Date(right.saved_at || right.metadata?.created_at || 0).valueOf();
    return rightTime - leftTime;
  })[0] || null;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type?.startsWith("crawlHub:")) return undefined;

  (async () => {
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
    if (message.type === "crawlHub:read-latest-project") {
      return { project: latestProject(projects) };
    }
    throw new Error("不支持的数据操作");
  })().then(
    (data) => sendResponse({ ok: true, ...data }),
    (error) => sendResponse({ ok: false, error: error?.message || "本地数据保存失败" })
  );
  return true;
});
