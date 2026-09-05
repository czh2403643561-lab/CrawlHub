import { analyzePage, startElementPicker, startNetworkObserver } from "./analyzer.js";

const analyzeButton = document.querySelector("#analyzeButton");
const pickButton = document.querySelector("#pickButton");
const observeButton = document.querySelector("#observeButton");
const downloadButton = document.querySelector("#downloadButton");
const status = document.querySelector("#status");
const result = document.querySelector("#result");
const pageTitle = document.querySelector("#pageTitle");
const selectedElement = document.querySelector("#selectedElement");
const selectedSummary = document.querySelector("#selectedSummary");
const reportCounts = {
  text: document.querySelector("#textCount"),
  images: document.querySelector("#imageCount"),
  lists: document.querySelector("#listCount"),
  tables: document.querySelector("#tableCount"),
  json: document.querySelector("#jsonCount"),
  network: document.querySelector("#networkCount")
};

let latestReport = null;

function setStatus(message, kind = "") {
  status.textContent = message;
  status.className = `status ${kind}`.trim();
}

function displayReport(report) {
  pageTitle.textContent = report.page.title || report.page.url;
  reportCounts.text.textContent = report.text_nodes.count;
  reportCounts.images.textContent = report.images.count;
  reportCounts.lists.textContent = report.structures.lists.length;
  reportCounts.tables.textContent = report.structures.tables.length;
  reportCounts.json.textContent = report.json_candidates.count;
  reportCounts.network.textContent = report.network_clues.count;
  if (report.selected_element) {
    selectedElement.hidden = false;
    selectedSummary.textContent = `${report.selected_element.tag} · ${report.selected_element.selector} · ${report.selected_element.text || "无文本"}`;
  } else {
    selectedElement.hidden = true;
  }
  result.hidden = false;
  downloadButton.disabled = false;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]?.id) throw new Error("没有找到当前页面。");
  return tabs[0];
}

async function executeInActiveTab(func, world = "MAIN") {
  const tab = await getActiveTab();
  const execution = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, world });
  return execution[0]?.result;
}

async function downloadReport() {
  if (!latestReport) return;
  const json = JSON.stringify(latestReport, null, 2);
  const blobUrl = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  try {
    await new Promise((resolve, reject) => {
      chrome.downloads.download(
        { url: blobUrl, filename: "analysis.json", saveAs: false, conflictAction: "uniquify" },
        (downloadId) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(downloadId);
        }
      );
    });
    setStatus("分析完成，analysis.json 已下载", "success");
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }
}

analyzeButton.addEventListener("click", async () => {
  analyzeButton.disabled = true;
  pickButton.disabled = true;
  observeButton.disabled = true;
  downloadButton.disabled = true;
  setStatus("正在读取当前页面…");
  try {
    const report = await executeInActiveTab(analyzePage);
    if (!report) throw new Error("页面未返回分析结果。");
    latestReport = report;
    displayReport(report);
    await downloadReport();
  } catch (error) {
    latestReport = null;
    result.hidden = true;
    setStatus(`分析失败：${error.message || "无法读取当前页面"}`, "error");
  } finally {
    analyzeButton.disabled = false;
    pickButton.disabled = false;
    observeButton.disabled = false;
  }
});

pickButton.addEventListener("click", async () => {
  pickButton.disabled = true;
  analyzeButton.disabled = true;
  observeButton.disabled = true;
  setStatus("请在页面中点击要分析的元素…");
  try {
    await executeInActiveTab(startElementPicker);
    window.close();
  } catch (error) {
    setStatus(`无法启动元素选择：${error.message || "当前页面不可访问"}`, "error");
    pickButton.disabled = false;
    analyzeButton.disabled = false;
    observeButton.disabled = false;
  }
});

observeButton.addEventListener("click", async () => {
  observeButton.disabled = true;
  setStatus("正在启动本地网络请求监听…");
  try {
    const result = await executeInActiveTab(startNetworkObserver, "MAIN");
    if (!result?.started) throw new Error("监听器未启动。");
    setStatus("监听已启动；操作页面后再生成报告", "success");
  } catch (error) {
    setStatus(`无法启动监听：${error.message || "当前页面不可访问"}`, "error");
  } finally {
    observeButton.disabled = false;
  }
});

downloadButton.addEventListener("click", async () => {
  downloadButton.disabled = true;
  try {
    await downloadReport();
  } catch (error) {
    setStatus(`下载失败：${error.message || "无法下载文件"}`, "error");
  } finally {
    downloadButton.disabled = false;
  }
});
