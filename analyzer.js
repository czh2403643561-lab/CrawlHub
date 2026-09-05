function analyzePage() {
  const LIMITS = {
    textNodes: 2000,
    images: 500,
    structures: 100,
    jsonCandidates: 100,
    networkClues: 100,
    sampleItems: 8,
    previewLength: 240
  };

  const compactText = (value, length = LIMITS.previewLength) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > length ? `${text.slice(0, length)}…` : text;
  };

  const safeNetworkUrl = (value) => {
    try {
      const url = new URL(value, location.href);
      if (["data:", "blob:"].includes(url.protocol)) return `${url.protocol}//local`;
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.href;
    } catch {
      return String(value || "").split(/[?#]/, 1)[0];
    }
  };

  const selectorFor = (element) => {
    if (!(element instanceof Element)) return "";
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += `#${current.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      } else if (current.classList.length) {
        part += `.${Array.from(current.classList).slice(0, 2).join(".")}`;
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(" > ");
  };

  const xpathFor = (element) => {
    if (!(element instanceof Element)) return "";
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) index += 1;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
      current = current.parentElement;
    }
    return `/${parts.join("/")}`;
  };

  const isVisible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  };

  const parentSummary = (element) => {
    const ancestors = [];
    let current = element.parentElement;
    while (current && ancestors.length < 5) {
      ancestors.push({
        tag: current.tagName.toLowerCase(),
        id: current.id || null,
        class: compactText(current.className, 160),
        selector: selectorFor(current),
        text: compactText(current.innerText || current.textContent || "")
      });
      current = current.parentElement;
    }
    return ancestors;
  };

  const selectedElements = Array.isArray(window.__crawlHubSelectedElements)
    ? window.__crawlHubSelectedElements
    : (window.__crawlHubSelectedElement ? [window.__crawlHubSelectedElement] : []);
  const countByTag = {};
  let elementCount = 0;
  let maxDepth = 0;
  const topLevelElements = [];
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
  let current = walker.currentNode;
  while (current) {
    elementCount += 1;
    const tag = current.tagName.toLowerCase();
    countByTag[tag] = (countByTag[tag] || 0) + 1;
    let depth = 0;
    for (let parent = current; parent; parent = parent.parentElement) depth += 1;
    maxDepth = Math.max(maxDepth, depth);
    if (current.parentElement === document.body && topLevelElements.length < 40) {
      topLevelElements.push({
        tag,
        id: current.id || null,
        class: compactText(current.className, 160),
        selector: selectorFor(current),
        text: compactText(current.innerText || current.textContent || "")
      });
    }
    current = walker.nextNode();
  }

  const textNodes = [];
  let omittedTextNodes = 0;
  const textWalker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  let textNode = textWalker.nextNode();
  while (textNode) {
    const parent = textNode.parentElement;
    const parentTag = parent?.tagName.toLowerCase();
    const text = compactText(textNode.nodeValue, 500);
    if (text && parent && !["script", "style", "noscript", "template"].includes(parentTag) && isVisible(parent)) {
      if (textNodes.length < LIMITS.textNodes) {
        textNodes.push({
          text,
          parent_tag: parentTag,
          selector: selectorFor(parent),
          length: text.length
        });
      } else {
        omittedTextNodes += 1;
      }
    }
    textNode = textWalker.nextNode();
  }

  const images = Array.from(document.images).slice(0, LIMITS.images).map((image) => ({
    src: image.currentSrc || image.src || null,
    alt: image.alt || "",
    width: image.naturalWidth || image.width || null,
    height: image.naturalHeight || image.height || null,
    loading: image.loading || null,
    selector: selectorFor(image)
  }));

  const lists = Array.from(document.querySelectorAll("ul, ol")).slice(0, LIMITS.structures).map((list) => {
    const items = Array.from(list.children).filter((child) => child.tagName.toLowerCase() === "li");
    return {
      type: list.tagName.toLowerCase(),
      selector: selectorFor(list),
      item_count: items.length,
      sample_items: items.slice(0, LIMITS.sampleItems).map((item) => compactText(item.innerText || item.textContent || ""))
    };
  });

  const tables = Array.from(document.querySelectorAll("table")).slice(0, LIMITS.structures).map((table) => {
    const rows = Array.from(table.querySelectorAll("tr"));
    const headers = Array.from(table.querySelectorAll("thead th, tr:first-child th")).map((cell) => compactText(cell.innerText || cell.textContent || ""));
    const getCells = (row) => Array.from(row.children).map((cell) => compactText(cell.innerText || cell.textContent || ""));
    const columnCount = rows.reduce((max, row) => Math.max(max, row.children.length), 0);
    const dataRows = rows.filter((row) => !row.querySelector("th"));
    const columns = Array.from({ length: columnCount }, (_, index) => ({
      index,
      name: headers[index] || `column_${index + 1}`,
      sample_values: dataRows.slice(0, LIMITS.sampleItems).map((row) => getCells(row)[index] || "")
    }));
    return {
      selector: selectorFor(table),
      row_count: rows.length,
      data_row_count: dataRows.length,
      column_count: columnCount,
      headers: headers.slice(0, 30),
      columns,
      sample_rows: rows.slice(0, LIMITS.sampleItems).map(getCells),
      sample_records: dataRows.slice(0, LIMITS.sampleItems).map((row) => Object.fromEntries(columns.map((column) => [column.name, getCells(row)[column.index] || ""])))
    };
  });

  const jsonCandidates = [];
  for (const script of Array.from(document.scripts)) {
    if (jsonCandidates.length >= LIMITS.jsonCandidates) break;
    const raw = (script.textContent || "").trim();
    if (!raw) continue;
    const type = (script.getAttribute("type") || "").toLowerCase();
    const isJsonType = type.includes("json");
    const looksLikeJson = raw.startsWith("{") || raw.startsWith("[");
    const looksLikeAssignment = /(?:window\.)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*=\s*[\[{]/.test(raw);
    if (!isJsonType && !looksLikeJson && !looksLikeAssignment) continue;

    let parsed = null;
    let validJson = false;
    try {
      parsed = JSON.parse(raw);
      validJson = true;
    } catch {
      // Wrapper code can still be a useful JSON clue even when it is not pure JSON.
    }
    const previewValue = validJson ? JSON.stringify(parsed) : raw;
    jsonCandidates.push({
      selector: selectorFor(script),
      type: type || "text/javascript",
      length: raw.length,
      valid_json: validJson,
      top_level_type: validJson ? (Array.isArray(parsed) ? "array" : typeof parsed) : null,
      keys: validJson && parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed).slice(0, 50) : [],
      preview: compactText(previewValue, 500)
    });
  }

  const networkClues = [];
  const seenNetworkClues = new Set();
  for (const request of Array.isArray(window.__crawlHubNetworkLog) ? window.__crawlHubNetworkLog : []) {
    const clue = {
      source: request.source || "runtime_observer",
      method: request.method || null,
      url: safeNetworkUrl(request.url),
      response_type: request.response_type || null,
      status: Number.isFinite(request.status) ? request.status : null,
      content_type: request.content_type || null,
      duration_ms: Number.isFinite(request.duration_ms) ? request.duration_ms : null
    };
    const key = `${clue.method}|${clue.url}|${clue.source}`;
    if (!seenNetworkClues.has(key) && networkClues.length < LIMITS.networkClues) {
      seenNetworkClues.add(key);
      networkClues.push(clue);
    }
  }
  try {
    for (const entry of performance.getEntriesByType("resource")) {
      if (!["fetch", "xmlhttprequest"].includes(entry.initiatorType)) continue;
      if (networkClues.length >= LIMITS.networkClues) break;
      const clue = {
        source: "performance",
        method: null,
        url: safeNetworkUrl(entry.name),
        initiator_type: entry.initiatorType,
        response_type: null,
        status: null,
        content_type: null,
        duration_ms: Math.round(entry.duration)
      };
      const key = `${clue.method}|${clue.url}|${clue.source}`;
      if (!seenNetworkClues.has(key)) {
        seenNetworkClues.add(key);
        networkClues.push(clue);
      }
    }
  } catch {
    // Performance timing is optional in some page contexts.
  }

  const recommendations = ["优先检查重复出现的列表项或表格行，确认字段与稳定选择器。"];
  if (jsonCandidates.length) recommendations.push("进一步确认可疑 JSON 中的字段含义，并与页面展示内容比对。");
  if (networkClues.length) recommendations.push("结合已记录的请求路径判断数据是否来自页面接口；本报告未发起请求。");
  if (!lists.length && !tables.length) recommendations.push("当前未识别出标准列表或表格，可继续检查重复的 div/card 结构。");

  return {
    schema_version: "1.0",
    mode: window.__crawlHubMode || "analysis",
    analysis_scope: "通用页面结构分析，不包含平台专用解析规则",
    generated_at: new Date().toISOString(),
    page: {
      url: location.href,
      title: document.title,
      language: document.documentElement.lang || null,
      charset: document.characterSet || null,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    },
    dom_summary: {
      element_count: elementCount,
      max_depth: maxDepth,
      tag_counts: Object.fromEntries(Object.entries(countByTag).sort((a, b) => b[1] - a[1])),
      top_level_elements: topLevelElements,
      landmark_counts: Object.fromEntries(["header", "nav", "main", "aside", "footer", "form"].map((tag) => [tag, countByTag[tag] || 0]))
    },
    selected_element: selectedElements[0] || null,
    selected_elements: selectedElements,
    sampling: {
      selected_count: selectedElements.length,
      mode: window.__crawlHubSamplingActive ? "sampling" : "idle"
    },
    text_nodes: { items: textNodes, count: textNodes.length, omitted_count: omittedTextNodes },
    images: { items: images, count: images.length, omitted_count: Math.max(0, document.images.length - images.length) },
    structures: {
      lists,
      tables,
      possible_repeated_containers: Array.from(document.querySelectorAll("[class]"))
        .filter((element) => isVisible(element) && element.children.length >= 2)
        .slice(0, 30)
        .map((element) => ({ selector: selectorFor(element), child_count: element.children.length }))
    },
    json_candidates: { items: jsonCandidates, count: jsonCandidates.length },
    network_clues: { items: networkClues, count: networkClues.length },
    data_source_assessment: {
      dom_elements: elementCount > 0,
      embedded_json: jsonCandidates.length > 0,
      network_requests: networkClues.length > 0,
      determination: "unknown"
    },
    collection_suggestions: recommendations,
    local_processing: true
  };
}

function startElementPicker() {
  if (window.__crawlHubPickerCleanup) window.__crawlHubPickerCleanup();

  const compactText = (value, length = 240) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > length ? `${text.slice(0, length)}…` : text;
  };

  const selectorFor = (element) => {
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
      let part = current.tagName.toLowerCase();
      if (current.id) part += `#${current.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      else if (current.classList.length) part += `.${Array.from(current.classList).slice(0, 2).join(".")}`;
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(" > ");
  };

  const xpathFor = (element) => {
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) index += 1;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
      current = current.parentElement;
    }
    return `/${parts.join("/")}`;
  };

  const parentStructure = (element) => {
    const result = [];
    let current = element.parentElement;
    while (current && result.length < 5) {
      result.push({
        tag: current.tagName.toLowerCase(),
        id: current.id || null,
        class: compactText(current.className, 160),
        selector: selectorFor(current),
        text: compactText(current.innerText || current.textContent || "")
      });
      current = current.parentElement;
    }
    return result;
  };

  const siblingSummary = (element) => {
    const siblings = element.parentElement ? Array.from(element.parentElement.children) : [];
    const index = siblings.indexOf(element);
    const summarize = (node) => ({
      tag: node.tagName.toLowerCase(),
      id: node.id || null,
      class: compactText(node.className, 160),
      selector: selectorFor(node),
      text: compactText(node.innerText || node.textContent || "")
    });
    return {
      position: index >= 0 ? index + 1 : null,
      total: siblings.length,
      previous: siblings.slice(Math.max(0, index - 3), index).map(summarize),
      next: siblings.slice(index + 1, index + 4).map(summarize)
    };
  };

  const guessFieldTypes = (element) => {
    const tag = element.tagName.toLowerCase();
    const text = compactText(element.innerText || element.textContent || "", 500);
    const tokens = `${tag} ${element.id || ""} ${element.className || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("alt") || ""} ${text}`.toLowerCase();
    const types = [];
    if (tag === "img" || /image|img|photo|picture|图片|照片/.test(tokens)) types.push("image");
    if (/product|item|商品|名称|name|title|标题/.test(tokens)) types.push("product_name");
    if (/price|cost|金额|价格|售价|货币|\$|€|£|¥/.test(tokens)) types.push("price");
    if (/count|quantity|number|total|gmv|sales|click|view|score|rating|数量|销量|点击|浏览|评分|指标/.test(tokens) || /^[-+]?\d[\d,.% ]*$/.test(text)) types.push("numeric_metric");
    if (/percent|percentage|rate|比例|百分比|%/.test(tokens)) types.push("percentage");
    if (tag === "a" || element.hasAttribute("href")) types.push("link");
    if (!types.length && text) types.push("text");
    return types;
  };

  const overlay = document.createElement("div");
  overlay.textContent = "CrawlHub：点击页面元素完成选择；按 Esc 取消";
  Object.assign(overlay.style, {
    position: "fixed",
    zIndex: "2147483647",
    top: "12px",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "8px 12px",
    borderRadius: "6px",
    color: "#fff",
    background: "#315efb",
    font: "12px sans-serif",
    pointerEvents: "none",
    boxShadow: "0 2px 10px rgba(0,0,0,.25)"
  });
  document.documentElement.appendChild(overlay);

  const highlight = document.createElement("div");
  Object.assign(highlight.style, {
    position: "fixed",
    zIndex: "2147483646",
    pointerEvents: "none",
    border: "2px solid #315efb",
    background: "rgba(49,94,251,.12)",
    display: "none"
  });
  document.documentElement.appendChild(highlight);

  let hovered = null;
  const onMove = (event) => {
    if (event.target === overlay || event.target === highlight) return;
    hovered = event.target instanceof Element ? event.target : null;
    if (!hovered) return;
    const rect = hovered.getBoundingClientRect();
    Object.assign(highlight.style, {
      display: "block",
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`
    });
  };
  const onClick = (event) => {
    if (!(event.target instanceof Element) || event.target === overlay || event.target === highlight) return;
    event.preventDefault();
    event.stopPropagation();
    const element = event.target;
    window.__crawlHubSelectedElement = {
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      class: compactText(element.className, 240),
      selector: selectorFor(element),
      xpath: xpathFor(element),
      text: compactText(element.innerText || element.textContent || "", 500),
      possible_field_types: guessFieldTypes(element),
      attributes: Array.from(element.attributes)
        .filter((attribute) => !["value", "src", "href", "style"].includes(attribute.name))
        .slice(0, 30)
        .map((attribute) => ({ name: attribute.name, value: compactText(attribute.value, 240) })),
      parent_structure: parentStructure(element),
      nearby_siblings: siblingSummary(element),
      selected_at: new Date().toISOString()
    };
    cleanup();
    const notice = document.createElement("div");
    notice.textContent = "CrawlHub：元素已记录，请重新打开插件生成报告";
    Object.assign(notice.style, {
      position: "fixed",
      zIndex: "2147483647",
      top: "12px",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "8px 12px",
      borderRadius: "6px",
      color: "#fff",
      background: "#16794c",
      font: "12px sans-serif"
    });
    document.documentElement.appendChild(notice);
    setTimeout(() => notice.remove(), 2200);
  };
  const onKey = (event) => {
    if (event.key === "Escape") cleanup();
  };
  const cleanup = () => {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    highlight.remove();
    delete window.__crawlHubPickerCleanup;
  };

  window.__crawlHubPickerCleanup = cleanup;
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  return { started: true };
}

function startNetworkObserver() {
  if (window.__crawlHubNetworkObserverInstalled) {
    return { started: true, already_running: true };
  }

  const sanitizeUrl = (value) => {
    try {
      const url = new URL(value, location.href);
      if (["data:", "blob:"].includes(url.protocol)) return `${url.protocol}//local`;
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.href;
    } catch {
      return String(value || "").split(/[?#]/, 1)[0];
    }
  };
  const log = Array.isArray(window.__crawlHubNetworkLog) ? window.__crawlHubNetworkLog : [];
  const add = (request) => {
    if (log.length >= 100) log.shift();
    log.push({ ...request, url: sanitizeUrl(request.url), recorded_at: new Date().toISOString() });
    window.__crawlHubNetworkLog = log;
  };

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function (...args) {
      const input = args[0];
      const init = args[1] || {};
      const request = {
        source: "fetch",
        method: String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase(),
        url: input instanceof Request ? input.url : String(input || ""),
        started_at: performance.now()
      };
      return originalFetch.apply(this, args).then((response) => {
        add({
          source: request.source,
          method: request.method,
          url: request.url,
          response_type: response.type || null,
          status: response.status,
          content_type: response.headers.get("content-type"),
          duration_ms: Math.round(performance.now() - request.started_at)
        });
        return response;
      }).catch((error) => {
        add({
          source: request.source,
          method: request.method,
          url: request.url,
          response_type: null,
          status: null,
          content_type: null,
          duration_ms: Math.round(performance.now() - request.started_at),
          error: String(error?.message || "request_failed")
        });
        throw error;
      });
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__crawlHubRequest = { method: String(method || "GET").toUpperCase(), url: String(url || ""), started_at: performance.now() };
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const request = this.__crawlHubRequest || { method: "GET", url: "", started_at: performance.now() };
    this.addEventListener("loadend", () => {
      let contentType = null;
      try { contentType = this.getResponseHeader("content-type"); } catch { /* Header access can fail for some responses. */ }
      add({
        source: "xhr",
        method: request.method,
        url: request.url,
        response_type: this.responseType || "text",
        status: this.status || null,
        content_type: contentType,
        duration_ms: Math.round(performance.now() - request.started_at)
      });
    }, { once: true });
    return originalSend.apply(this, args);
  };

  window.__crawlHubNetworkObserverInstalled = true;
  window.__crawlHubNetworkLog = log;
  return { started: true, already_running: false };
}

function startElementSampling() {
  if (window.__crawlHubSamplingCleanup) window.__crawlHubSamplingCleanup();
  window.__crawlHubSamplingActive = true;
  window.__crawlHubSelectedElements = [];

  const compactText = (value, length = 240) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > length ? `${text.slice(0, length)}…` : text;
  };
  const selectorFor = (element) => {
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
      let part = current.tagName.toLowerCase();
      if (current.id) part += `#${current.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      else if (current.classList.length) part += `.${Array.from(current.classList).slice(0, 2).join(".")}`;
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(" > ");
  };
  const xpathFor = (element) => {
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) index += 1;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
      current = current.parentElement;
    }
    return `/${parts.join("/")}`;
  };
  const summarize = (element) => ({
    tag: element.tagName.toLowerCase(),
    id: element.id || null,
    class: compactText(element.className, 160),
    selector: selectorFor(element),
    text: compactText(element.innerText || element.textContent || "")
  });
  const parentStructure = (element) => {
    const result = [];
    let current = element.parentElement;
    while (current && result.length < 5) {
      result.push(summarize(current));
      current = current.parentElement;
    }
    return result;
  };
  const nearbySiblings = (element) => {
    const siblings = element.parentElement ? Array.from(element.parentElement.children) : [];
    const index = siblings.indexOf(element);
    return {
      position: index >= 0 ? index + 1 : null,
      total: siblings.length,
      previous: siblings.slice(Math.max(0, index - 3), index).map(summarize),
      next: siblings.slice(index + 1, index + 4).map(summarize)
    };
  };
  const guessFieldTypes = (element) => {
    const tag = element.tagName.toLowerCase();
    const text = compactText(element.innerText || element.textContent || "", 500);
    const tokens = `${tag} ${element.id || ""} ${element.className || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("alt") || ""} ${text}`.toLowerCase();
    const types = [];
    if (tag === "img" || /image|img|photo|picture|图片|照片/.test(tokens)) types.push("image");
    if (/product|item|商品|名称|name|title|标题/.test(tokens)) types.push("product_name");
    if (/price|cost|金额|价格|售价|货币|\$|€|£|¥/.test(tokens)) types.push("price");
    if (/count|quantity|number|total|gmv|sales|click|view|score|rating|数量|销量|点击|浏览|评分|指标/.test(tokens) || /^[-+]?\d[\d,.% ]*$/.test(text)) types.push("numeric_metric");
    if (/percent|percentage|rate|比例|百分比|%/.test(tokens)) types.push("percentage");
    if (tag === "a" || element.hasAttribute("href")) types.push("link");
    if (!types.length && text) types.push("text");
    return types;
  };
  const describe = (element) => ({
    tag: element.tagName.toLowerCase(),
    class: compactText(element.className, 240),
    id: element.id || null,
    selector: selectorFor(element),
    xpath: xpathFor(element),
    text: compactText(element.innerText || element.textContent || "", 500),
    possible_field_types: guessFieldTypes(element),
    parent_structure: parentStructure(element),
    nearby_siblings: nearbySiblings(element),
    attributes: Array.from(element.attributes)
      .filter((attribute) => !["value", "src", "href", "style"].includes(attribute.name))
      .slice(0, 30)
      .map((attribute) => ({ name: attribute.name, value: compactText(attribute.value, 240) })),
    selected_at: new Date().toISOString()
  });

  const notice = document.createElement("div");
  notice.textContent = "CrawlHub：采样中，点击多个页面元素；完成后回到面板结束";
  Object.assign(notice.style, {
    position: "fixed",
    zIndex: "2147483647",
    top: "12px",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "8px 12px",
    borderRadius: "6px",
    color: "#fff",
    background: "#315efb",
    font: "12px sans-serif",
    pointerEvents: "none",
    boxShadow: "0 2px 10px rgba(0,0,0,.25)"
  });
  document.documentElement.appendChild(notice);
  const highlight = document.createElement("div");
  Object.assign(highlight.style, {
    position: "fixed",
    zIndex: "2147483646",
    pointerEvents: "none",
    border: "2px solid #315efb",
    background: "rgba(49,94,251,.12)",
    display: "none"
  });
  document.documentElement.appendChild(highlight);

  const isPanelTarget = (event) => {
    const panelHost = window.__crawlHubPanelHost;
    return panelHost && typeof event.composedPath === "function" && event.composedPath().includes(panelHost);
  };
  const onMove = (event) => {
    if (isPanelTarget(event)) return;
    const element = event.target instanceof Element ? event.target : null;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    Object.assign(highlight.style, {
      display: "block",
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`
    });
  };
  const onClick = (event) => {
    if (isPanelTarget(event) || !(event.target instanceof Element)) return;
    event.preventDefault();
    event.stopPropagation();
    const item = describe(event.target);
    if (!window.__crawlHubSelectedElements.some((selected) => selected.xpath === item.xpath)) {
      window.__crawlHubSelectedElements.push(item);
      if (window.__crawlHubSamplingChanged) window.__crawlHubSamplingChanged();
      notice.textContent = `CrawlHub：已选择 ${window.__crawlHubSelectedElements.length} 个元素，继续点击或完成采样`;
    }
  };
  const cleanup = () => {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    notice.remove();
    highlight.remove();
    window.__crawlHubSamplingActive = false;
    delete window.__crawlHubSamplingCleanup;
  };

  window.__crawlHubSamplingCleanup = cleanup;
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  return { started: true };
}

function stopElementSampling() {
  if (window.__crawlHubSamplingCleanup) window.__crawlHubSamplingCleanup();
  window.__crawlHubSamplingActive = false;
  return { stopped: true, selected_count: Array.isArray(window.__crawlHubSelectedElements) ? window.__crawlHubSelectedElements.length : 0 };
}

function installPanel() {
  if (window.__crawlHubPanelHost) {
    window.__crawlHubPanelHost.style.display = "block";
    return { started: true, already_open: true };
  }

  if (!Array.isArray(window.__crawlHubSelectedElements)) window.__crawlHubSelectedElements = [];
  const host = document.createElement("div");
  host.id = "crawlHubPanelHost";
  Object.assign(host.style, {
    all: "initial",
    position: "fixed",
    zIndex: "2147483645",
    top: "16px",
    right: "16px",
    width: "360px",
    maxWidth: "calc(100vw - 32px)",
    color: "#172033",
    font: "13px/1.45 Arial, sans-serif"
  });
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .panel { overflow: hidden; border: 1px solid #d9e0ed; border-radius: 10px; background: #f6f8fc; box-shadow: 0 8px 30px rgba(16, 24, 40, .22); }
      header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; color: #fff; background: #315efb; }
      header strong { flex: 1; font-size: 14px; }
      header button { width: 24px; height: 24px; border: 0; border-radius: 5px; color: #fff; background: rgba(255,255,255,.18); cursor: pointer; font-size: 16px; line-height: 20px; }
      .content { padding: 12px; }
      .hint { margin-bottom: 10px; color: #667085; font-size: 12px; }
      .state { margin-bottom: 8px; font-weight: 600; }
      .state span { color: #16794c; }
      .count { margin-bottom: 8px; color: #344054; }
      .field-summary { min-height: 20px; margin-bottom: 10px; color: #475467; font-size: 12px; }
      .samples { max-height: 180px; margin: 0 0 12px; padding: 0; overflow: auto; list-style: none; }
      .samples li { margin-top: 6px; border-radius: 6px; padding: 7px 8px; background: #fff; overflow-wrap: anywhere; }
      .samples li:first-child { margin-top: 0; }
      .actions { display: grid; gap: 7px; }
      .actions button { width: 100%; border: 0; border-radius: 7px; padding: 8px 10px; color: #fff; background: #315efb; cursor: pointer; font: inherit; font-weight: 600; }
      .actions button.secondary { color: #315efb; background: #e8edff; }
      .actions button:disabled { cursor: default; opacity: .6; }
      .message { min-height: 18px; margin-top: 9px; color: #667085; font-size: 12px; }
      .message.success { color: #16794c; }
      .message.error { color: #b42318; }
      .mode-switch { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 10px; padding: 3px; border-radius: 7px; background: #e5eaf3; }
      .mode-switch button { border: 0; border-radius: 5px; padding: 7px 8px; color: #667085; background: transparent; cursor: pointer; font: inherit; font-weight: 600; }
      .mode-switch button.active { color: #315efb; background: #fff; box-shadow: 0 1px 3px rgba(16,24,40,.12); }
      .collection-card { border-radius: 7px; padding: 11px; background: #fff; color: #475467; }
      .collection-card strong { color: #172033; }
      .collection-card p { margin: 7px 0 0; }
      .collection-card ul { margin: 8px 0 0; padding-left: 18px; }
      .view[hidden], .content[hidden] { display: none; }
    </style>
    <div class="panel">
      <header><strong>CrawlHub 页面分析</strong><button id="minimize" title="最小化">−</button><button id="close" title="关闭">×</button></header>
      <div id="content" class="content">
        <div class="hint">数据仅在本地处理，不记录响应内容。</div>
        <div class="mode-switch" role="tablist" aria-label="工作模式">
          <button id="analysisMode" class="active" type="button">页面分析</button>
          <button id="collectionMode" type="button">数据采集</button>
        </div>
        <div id="analysisView" class="view">
          <div class="state">当前状态：<span id="state">待机</span></div>
          <div class="count">已选择元素：<strong id="count">0</strong></div>
          <div id="fieldSummary" class="field-summary">已选择字段摘要：暂无</div>
          <ul id="samples" class="samples"></ul>
          <div class="actions">
            <button id="sample">开始元素采样</button>
            <button id="observe" class="secondary">监听后续网络请求</button>
            <button id="analyze" class="secondary">分析并下载 analysis.json</button>
          </div>
        </div>
        <div id="collectionView" class="view" hidden>
          <div class="collection-card">
            <strong>数据采集模式（基础框架）</strong>
            <p>后续可根据页面分析结果生成采集规则，用于列表数据提取和导出。</p>
            <ul>
              <li>当前仅提供模式入口</li>
              <li>暂不执行自动采集</li>
              <li>暂不生成平台专用规则</li>
            </ul>
          </div>
          <div class="actions" style="margin-top: 10px;"><button id="backToAnalysis" class="secondary">返回页面分析</button></div>
        </div>
        <div id="message" class="message"></div>
      </div>
    </div>`;
  document.documentElement.appendChild(host);
  window.__crawlHubPanelHost = host;

  const content = shadow.querySelector("#content");
  const analysisView = shadow.querySelector("#analysisView");
  const collectionView = shadow.querySelector("#collectionView");
  const analysisModeButton = shadow.querySelector("#analysisMode");
  const collectionModeButton = shadow.querySelector("#collectionMode");
  const stateText = shadow.querySelector("#state");
  const countText = shadow.querySelector("#count");
  const fieldSummary = shadow.querySelector("#fieldSummary");
  const samples = shadow.querySelector("#samples");
  const sampleButton = shadow.querySelector("#sample");
  const observeButton = shadow.querySelector("#observe");
  const analyzeButton = shadow.querySelector("#analyze");
  const message = shadow.querySelector("#message");

  const setMessage = (text, kind = "") => {
    message.textContent = text;
    message.className = `message ${kind}`.trim();
  };
  const setMode = (mode) => {
    window.__crawlHubMode = mode;
    const isAnalysis = mode === "analysis";
    analysisView.hidden = !isAnalysis;
    collectionView.hidden = isAnalysis;
    analysisModeButton.classList.toggle("active", isAnalysis);
    collectionModeButton.classList.toggle("active", !isAnalysis);
    if (!isAnalysis && window.__crawlHubSamplingActive) stopElementSampling();
    render();
  };
  const render = () => {
    const selected = Array.isArray(window.__crawlHubSelectedElements) ? window.__crawlHubSelectedElements : [];
    countText.textContent = String(selected.length);
    stateText.textContent = window.__crawlHubSamplingActive ? "元素采样中" : "待机";
    const fields = Array.from(new Set(selected.flatMap((item) => item.possible_field_types || [])));
    fieldSummary.textContent = `已选择字段摘要：${fields.length ? fields.join("、") : "暂无"}`;
    samples.replaceChildren();
    selected.forEach((item, index) => {
      const row = document.createElement("li");
      row.textContent = `${index + 1}. ${item.tag} · ${item.possible_field_types?.join("/") || "text"} · ${item.text || item.selector}`;
      samples.appendChild(row);
    });
    sampleButton.textContent = window.__crawlHubSamplingActive ? "完成采样并生成报告" : "开始元素采样";
    observeButton.textContent = window.__crawlHubNetworkObserverInstalled ? "网络监听已开启" : "监听后续网络请求";
    observeButton.disabled = Boolean(window.__crawlHubNetworkObserverInstalled);
  };
  const downloadReport = () => {
    const report = analyzePage();
    const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = "analysis.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    setMessage("分析完成，analysis.json 已下载", "success");
  };

  window.__crawlHubSamplingChanged = render;
  analysisModeButton.addEventListener("click", () => setMode("analysis"));
  collectionModeButton.addEventListener("click", () => {
    setMode("collection");
    setMessage("数据采集模式已打开：当前仅保留基础框架，未执行采集。", "success");
  });
  shadow.querySelector("#backToAnalysis").addEventListener("click", () => setMode("analysis"));
  sampleButton.addEventListener("click", () => {
    if (window.__crawlHubSamplingActive) {
      stopElementSampling();
      render();
      downloadReport();
      return;
    }
    startElementSampling();
    render();
    setMessage("请连续点击页面元素，完成后点击“完成采样并生成报告”。");
  });
  observeButton.addEventListener("click", () => {
    try {
      startNetworkObserver();
      render();
      setMessage("网络监听已启动，只记录后续请求元信息。", "success");
    } catch (error) {
      setMessage(`监听失败：${error.message || "无法启动"}`, "error");
    }
  });
  analyzeButton.addEventListener("click", () => {
    try { downloadReport(); } catch (error) { setMessage(`分析失败：${error.message || "无法生成报告"}`, "error"); }
  });
  shadow.querySelector("#minimize").addEventListener("click", () => {
    content.hidden = !content.hidden;
  });
  shadow.querySelector("#close").addEventListener("click", () => {
    stopElementSampling();
    host.remove();
    delete window.__crawlHubPanelHost;
    delete window.__crawlHubSamplingChanged;
  });
  setMode(window.__crawlHubMode || "analysis");
  return { started: true, already_open: false };
}

window.__crawlHub = { analyzePage, startNetworkObserver, startElementSampling, stopElementSampling, installPanel };
