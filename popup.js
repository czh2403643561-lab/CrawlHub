const openButton = document.querySelector("#openButton");
const status = document.querySelector("#status");

function setStatus(message, kind = "") {
  status.textContent = message;
  status.className = `status ${kind}`.trim();
}

async function openPanel() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]?.id) throw new Error("没有找到当前页面。");
  const target = { tabId: tabs[0].id };
  await chrome.scripting.executeScript({ target, files: ["content.js"] });
  await chrome.scripting.executeScript({ target, files: ["analyzer.js"], world: "MAIN" });
  const execution = await chrome.scripting.executeScript({
    target,
    world: "MAIN",
    func: () => window.__crawlHub?.installPanel?.()
  });
  if (!execution[0]?.result?.started) throw new Error("页面分析面板未启动。");
}

openButton.addEventListener("click", async () => {
  openButton.disabled = true;
  setStatus("正在打开页面面板…");
  try {
    await openPanel();
    window.close();
  } catch (error) {
    setStatus(`打开失败：${error.message || "当前页面不可访问"}`, "error");
    openButton.disabled = false;
  }
});

openPanel().then(() => window.close()).catch((error) => {
  setStatus(`打开失败：${error.message || "当前页面不可访问"}`, "error");
});
