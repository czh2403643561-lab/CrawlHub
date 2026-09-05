export function analyzePage() {
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

  const selectedElement = window.__crawlHubSelectedElement || null;
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
    return {
      selector: selectorFor(table),
      row_count: rows.length,
      column_count: rows.reduce((max, row) => Math.max(max, row.children.length), 0),
      headers: headers.slice(0, 30),
      sample_rows: rows.slice(0, LIMITS.sampleItems).map((row) => Array.from(row.children).map((cell) => compactText(cell.innerText || cell.textContent || "")))
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
  try {
    for (const entry of performance.getEntriesByType("resource")) {
      if (!["fetch", "xmlhttprequest"].includes(entry.initiatorType)) continue;
      if (networkClues.length >= LIMITS.networkClues) break;
      const safeUrl = new URL(entry.name, location.href);
      safeUrl.search = "";
      safeUrl.hash = "";
      networkClues.push({
        url: safeUrl.href,
        initiator_type: entry.initiatorType,
        duration_ms: Math.round(entry.duration)
      });
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
    selected_element: selectedElement,
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

export function startElementPicker() {
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
      attributes: Array.from(element.attributes)
        .filter((attribute) => !["value", "src", "href", "style"].includes(attribute.name))
        .slice(0, 30)
        .map((attribute) => ({ name: attribute.name, value: compactText(attribute.value, 240) })),
      parent_structure: parentStructure(element),
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
