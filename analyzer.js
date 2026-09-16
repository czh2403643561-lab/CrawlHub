(() => {

function inspectScrollableElements(target = null, limit = 30) {
  const selectorFor = (element) => {
    const parts = [];
    for (let current = element; current && current.nodeType === Node.ELEMENT_NODE && parts.length < 6; current = current.parentElement) {
      let part = current.tagName.toLowerCase();
      if (current.id) part += `#${current.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      else if (current.classList.length) part += `.${Array.from(current.classList).slice(0, 2).join(".")}`;
      parts.unshift(part);
    }
    return parts.join(" > ");
  };
  const targetAncestors = new Map();
  for (let current = target, distance = 0; current; current = current.parentElement, distance += 1) targetAncestors.set(current, distance);
  const targetDistance = (element) => {
    for (let current = element, distance = 0; current; current = current.parentElement, distance += 1) {
      if (targetAncestors.has(current)) return distance + targetAncestors.get(current);
    }
    return null;
  };
  return Array.from(document.querySelectorAll("*")).map((element) => {
    const style = getComputedStyle(element);
    const scrollHeight = element.scrollHeight;
    const clientHeight = element.clientHeight;
    const overflow = style.overflowY;
    const canScroll = scrollHeight > clientHeight + 8 && !["visible", "clip"].includes(overflow);
    return {
      element,
      selector: selectorFor(element),
      scrollHeight,
      clientHeight,
      overflow,
      is_scrollable: canScroll,
      vertical_overflow: Math.max(0, scrollHeight - clientHeight),
      target_distance: target ? targetDistance(element) : null
    };
  }).filter((item) => item.is_scrollable)
    .map((item) => ({ ...item, contains_list_data: Boolean(item.element.querySelector("table, [role='rowgroup'], [role='grid'], [role='list'], tr td, [role='row'] [role='cell'], [class*='row'] [class*='cell']")) }))
    .sort((left, right) => Number(right.contains_list_data) - Number(left.contains_list_data)
      || Number(right.clientHeight >= 80) - Number(left.clientHeight >= 80)
      || (left.target_distance ?? Number.MAX_SAFE_INTEGER) - (right.target_distance ?? Number.MAX_SAFE_INTEGER)
      || right.vertical_overflow - left.vertical_overflow)
    .slice(0, limit);
}

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
  const scrollContainers = inspectScrollableElements(null, LIMITS.structures).map(({ element, ...item }) => item);

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
      mode: window.__crawlHubSamplingState || (window.__crawlHubSamplingActive ? "sampling" : "idle")
    },
    text_nodes: { items: textNodes, count: textNodes.length, omitted_count: omittedTextNodes },
    images: { items: images, count: images.length, omitted_count: Math.max(0, document.images.length - images.length) },
    structures: {
      lists,
      tables,
      scroll_containers: scrollContainers,
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

function collectPageData() {
  const compactText = (value, length = 500) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > length ? `${text.slice(0, length)}…` : text;
  };
  const isVisible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
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
  const normalizeHeader = (value) => String(value || "").toLowerCase().replace(/[\s_\-:/：()（）]/g, "");
  const fieldDefinitions = [
    { key: "rank", label: "排名", aliases: ["排名", "rank", "ranking", "position", "序号"], kind: "number" },
    { key: "rank_change", label: "排名变化", aliases: ["排名变化", "排名变动", "排名趋势", "rank change", "rank trend"], kind: "number" },
    { key: "product_name", label: "商品名称", aliases: ["商品名称", "商品", "产品名称", "产品", "product name", "product", "title", "名称"], kind: "text" },
    { key: "image", label: "图片", aliases: ["图片", "商品图片", "image", "product image", "thumbnail", "cover"], kind: "image" },
    { key: "price_range", label: "价格范围", aliases: ["价格范围", "价格", "price range", "price"], kind: "text" },
    { key: "rating", label: "商品评分", aliases: ["商品评分", "评分", "rating", "score"], kind: "number" },
    { key: "review_count", label: "评价数量", aliases: ["评价数量", "评价数", "review count", "review number", "reviews"], kind: "number" },
    { key: "gmv", label: "GMV", aliases: ["gmv", "成交额", "交易额", "gross merchandise value"], kind: "metric" },
    { key: "click_count", label: "点击次数", aliases: ["点击次数", "点击量", "click count", "clicks"], kind: "metric" },
    { key: "click_rate", label: "点击率", aliases: ["点击率", "ctr", "click through rate", "click-through rate"], kind: "percentage" },
    { key: "live_account", label: "直播账号", aliases: ["直播账号", "直播间账号", "live account", "live stream account"], kind: "text" },
    { key: "best_video", label: "表现最佳的视频", aliases: ["表现最佳的视频", "最佳视频", "top performing video", "best performing video", "best video"], kind: "text" },
    { key: "videos", label: "视频", aliases: ["表现最佳的视频", "视频", "视频内容", "视频卡片", "videos"], kind: "object" },
    { key: "creator", label: "带货达人", aliases: ["带货达人", "达人账号", "creator", "influencer", "affiliate creator"], kind: "text" },
    { key: "shop", label: "店铺", aliases: ["店铺名称", "店铺", "shop name", "shop", "store", "seller"], kind: "text" },
    { key: "similar_product_count", label: "同款商品数", aliases: ["同款商品数", "同款数", "similar product count", "similar products", "similar items"], kind: "metric" }
  ];
  const headerScore = (header, aliases) => {
    const normalized = normalizeHeader(header);
    return aliases.reduce((best, alias) => {
      const candidate = normalizeHeader(alias);
      if (!candidate) return best;
      if (normalized === candidate) return Math.max(best, 100 + candidate.length);
      if (normalized.includes(candidate)) return Math.max(best, candidate.length);
      return best;
    }, 0);
  };
  const imageUrl = (image) => {
    if (!image) return null;
    const candidates = [image.getAttribute("src"), image.getAttribute("data-src"), image.currentSrc, image.src]
      .filter((value) => value && !String(value).startsWith("data:"));
    if (!candidates.length) return null;
    try {
      return new URL(candidates[0], location.href).href;
    } catch {
      return candidates[0];
    }
  };
  const imageSource = (cell) => imageUrl(cell?.querySelector("img"));
  const cellDetails = (row) => Array.from(row.children)
    .filter((cell) => ["td", "th"].includes(cell.tagName.toLowerCase()))
    .map((cell) => ({ text: compactText(cell.innerText || cell.textContent || "", 2000), image: imageSource(cell) }));
  const parseCount = (value) => {
    const text = String(value || "").replace(/,/g, "").trim();
    const match = text.match(/^([\d.]+)\s*([万kK])?\+?$/);
    if (!match) return text || null;
    const multiplier = match[2] === "万" ? 10000 : ["k", "K"].includes(match[2]) ? 1000 : 1;
    return Number(match[1]) * multiplier;
  };
  const parseRankNumber = (value) => {
    const match = String(value || "").match(/\d+/);
    return match ? Number(match[0]) : null;
  };
  const parseRankChange = (value) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text || /^[\-–—]$/.test(text)) return null;
    const match = text.match(/\d+/);
    return match ? Number(match[0]) : null;
  };
  const rankParts = (cell, rowIndex) => {
    const containers = Array.from(cell?.querySelectorAll("*") || []);
    const container = containers.find((element) => {
      const children = Array.from(element.children).filter(isVisible);
      if (children.length !== 2) return false;
      const trendText = compactText(children[1].innerText || children[1].textContent || "", 100);
      return /^(?:[↑↓]\s*)?(?:\d+\+?|[\-–—])$/.test(trendText);
    });
    if (container) {
      const [rankElement, trendElement] = Array.from(container.children).filter(isVisible);
      const rank = parseRankNumber(rankElement.innerText || rankElement.textContent || "") ?? rowIndex + 1;
      return { rank, rank_change: parseRankChange(trendElement.innerText || trendElement.textContent || "") };
    }
    const visibleNumericElements = containers.filter((element) => {
      if (!isVisible(element)) return false;
      const text = compactText(element.innerText || element.textContent || "", 100);
      return /^(?:[↑↓]\s*)?(?:\d+\+?|[\-–—])$/.test(text);
    });
    const trendElement = visibleNumericElements.find((element) => {
      const className = String(element.className || "");
      const text = compactText(element.innerText || element.textContent || "", 100);
      return /[↑↓]/.test(text) || /text-\[12px\]|trend|change/i.test(className);
    });
    if (trendElement) {
      const parent = trendElement.parentElement;
      const sibling = Array.from(parent?.children || [])
        .filter((element) => element !== trendElement && isVisible(element))
        .find((element) => parseRankNumber(element.innerText || element.textContent || "") !== null);
      return {
        rank: sibling ? parseRankNumber(sibling.innerText || sibling.textContent || "") : rowIndex + 1,
        rank_change: parseRankChange(trendElement.innerText || trendElement.textContent || "")
      };
    }
    const text = compactText(cell?.innerText || cell?.textContent || "", 100);
    const values = text.match(/\d+\+?|[\-–—]/g) || [];
    return {
      rank: values.length > 1 ? parseRankNumber(values[0]) : (parseRankNumber(text) ?? rowIndex + 1),
      rank_change: values.length > 1 ? parseRankChange(values[1]) : null
    };
  };
  const pageMetadata = () => {
    const categoryElement = Array.from(document.querySelectorAll(".rank-arco-tag-content, [class~='rank-arco-tag-content'], [class*='rank-arco-tag-content']"))
      .filter(isVisible)
      .find((element) => /\s*\/\s*/.test(compactText(element.innerText || element.textContent || "", 500)));
    const sampledCategory = compactText(categoryElement?.innerText || categoryElement?.textContent || "", 500);
    const categoryFull = sampledCategory || "未识别";
    const categoryShort = sampledCategory ? categoryFull.split(/\s*\/\s*/).filter(Boolean).at(-1) || categoryFull : "未识别";
    const pageHeading = Array.from(document.querySelectorAll("h1")).find(isVisible);
    const rankTypeLabels = ["总榜", "直播榜", "短视频榜", "商品卡", "达人榜", "新品榜"];
    const isActiveTab = (element) => {
      let current = element;
      let depth = 0;
      while (current && depth < 3) {
        const active = current.getAttribute("aria-selected") === "true"
          || current.getAttribute("aria-current") === "page"
          || /(?:^|[-_\s])(active|selected|current)(?:$|[-_\s])/i.test(String(current.className || ""));
        if (active) return true;
        current = current.parentElement;
        depth += 1;
      }
      return false;
    };
    const rankTypeElement = Array.from(document.querySelectorAll("[role='tab'], button, a, [class*='tab']"))
      .filter(isVisible)
      .find((element) => {
        const text = compactText(element.innerText || element.textContent || "", 80);
        return isActiveTab(element) && rankTypeLabels.includes(text);
      });
    const rankType = rankTypeElement ? compactText(rankTypeElement.innerText || rankTypeElement.textContent || "", 80) : "未识别";
    return {
      category_full: categoryFull,
      category_short: categoryShort,
      category: categoryFull,
      created_at: new Date().toISOString(),
      page_title: compactText(pageHeading?.innerText || pageHeading?.textContent || document.title || "", 500) || "未识别",
      rank_type: rankType,
      url: location.href
    };
  };
  const parseProductDetails = (value) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    const priceMatch = text.match(/(?:价格范围|价格|price range)\s*[:：]\s*(.*?)(?=\s*(?:商品评分|评分|rating)\s*[:：]|$)/i);
    const ratingMatch = text.match(/(?:商品评分|评分|rating)\s*[:：]\s*([\d.]+)\s*\/\s*5/i);
    const reviewMatch = text.match(/\(\s*([\d,.]+\s*[万kK]?\+?)\s*(?:条)?\s*(?:评价|reviews?)\s*\)/i)
      || text.match(/([\d,.]+\s*[万kK]?\+?)\s*(?:条)?\s*(?:评价|reviews?)/i);
    const priceMarker = text.search(/(?:价格范围|价格|price range)\s*[:：]/i);
    return {
      title: priceMarker >= 0 ? text.slice(0, priceMarker).trim() : text,
      price_range: priceMatch ? priceMatch[1].trim() : null,
      rating: ratingMatch ? Number(ratingMatch[1]) : null,
      review_count: reviewMatch ? parseCount(reviewMatch[1]) : null,
      has_embedded_details: Boolean(priceMatch || ratingMatch || reviewMatch)
    };
  };
  const relatedUrl = (element) => {
    let current = element;
    let depth = 0;
    while (current && depth < 5) {
      const candidates = [
        current.getAttribute?.("href"),
        current.getAttribute?.("data-url"),
        current.getAttribute?.("data-href"),
        current.getAttribute?.("data-link")
      ].filter(Boolean);
      const link = current.querySelector?.("a[href]");
      if (link) candidates.push(link.getAttribute("href"));
      const value = candidates.find((candidate) => !String(candidate).startsWith("javascript:"));
      if (value) {
        try { return new URL(value, location.href).href; } catch { return String(value); }
      }
      current = current.parentElement;
      depth += 1;
    }
    return null;
  };
  const relatedCount = (text) => {
    const match = String(text || "").match(/\+(\d+)/);
    return match ? Number(match[1]) : 0;
  };
  const relatedCard = (image) => {
    let current = image?.parentElement || null;
    let depth = 0;
    while (current && depth < 5) {
      if (/(?:video|play)/i.test(String(current.className || ""))) return current;
      current = current.parentElement;
      depth += 1;
    }
    return image?.parentElement || null;
  };
  const relatedVisibleText = (element) => {
    const text = compactText(element?.innerText || element?.textContent || "", 160);
    return /^\+\d+$/.test(text) ? "" : text;
  };
  const extractRelatedContent = (cell, type) => {
    if (!cell) return null;
    const images = Array.from(cell.querySelectorAll("img"));
    const text = compactText(cell.innerText || cell.textContent || "", 300);
    const items = images.slice(0, 12).map((image) => {
      if (type === "video") {
        const card = relatedCard(image);
        return {
          cover: imageUrl(image),
          url: null,
          creator: null,
          visible_text: relatedVisibleText(card)
        };
      }
      return { avatar: imageUrl(image), name: null, profile: relatedUrl(image) };
    }).filter((item) => type === "video" ? Boolean(item.cover) : Object.values(item).some(Boolean));
    if (type === "creator" && !items.length && text && !/^\+\d+$/.test(text)) {
      const name = text.replace(/\s*ID:\s*@[^\s]+/i, "").trim();
      if (name) items.push({ avatar: null, name, profile: relatedUrl(cell) });
    }
    const additionalCount = relatedCount(text);
    if (!items.length && !additionalCount) return null;
    const result = {
      [type]: {
        items: type === "video" ? items.map(({ visible_text, ...item }) => item) : items,
        visible_count: items.length,
        additional_count: additionalCount,
        source_text: text || null
      }
    };
    if (type === "video") {
      result.videos = items
        .filter((item) => Boolean(item.cover))
        .map((item) => ({
          cover: item.cover,
          creator: item.creator || null
        }));
    }
    return result;
  };
  const tableCandidates = Array.from(document.querySelectorAll("table"))
    .filter(isVisible)
    .map((table) => {
      const rows = Array.from(table.querySelectorAll("tr"));
      const headerRow = rows.find((row) => row.querySelector(":scope > th")) || rows[0];
      const headers = headerRow ? cellDetails(headerRow).map((cell, index) => cell.text || `column_${index + 1}`) : [];
      const dataRows = rows.filter((row) => row !== headerRow && row.querySelector(":scope > td"));
      const mappedCount = fieldDefinitions.filter((field) => headers.some((header) => headerScore(header, field.aliases) > 0)).length;
      return { table, headers, dataRows, mappedCount, score: dataRows.length * 10 + mappedCount * 20 };
    })
    .filter((candidate) => candidate.headers.length && candidate.dataRows.length)
    .sort((left, right) => right.score - left.score);

  const pageAnalysis = analyzePage();
  const tableCandidate = tableCandidates[0];
  if (tableCandidate) {
    const { table, headers, dataRows } = tableCandidate;
    const columns = headers.map((header, index) => ({ index, header }));
    const imageColumn = columns
      .map((column) => ({ ...column, image_count: dataRows.slice(0, 8).filter((row) => Boolean(imageSource(row.children[column.index]))).length }))
      .sort((left, right) => right.image_count - left.image_count)[0];
    const productColumn = columns
      .map((column) => ({ ...column, score: headerScore(column.header, fieldDefinitions.find((field) => field.key === "product_name").aliases) }))
      .sort((left, right) => right.score - left.score)[0];
    const videoImage = (image) => {
      let current = image?.parentElement || null;
      let depth = 0;
      while (current && depth < 5) {
        if (/(?:VideoPlayBtn|video|play)/i.test(String(current.className || ""))) return true;
        current = current.parentElement;
        depth += 1;
      }
      return false;
    };
    const videoColumn = columns
      .map((column) => ({
        ...column,
        video_image_count: dataRows.slice(0, 8).reduce((count, row) => count
          + Array.from(row.children[column.index]?.querySelectorAll("img") || []).filter(videoImage).length, 0)
      }))
      .sort((left, right) => right.video_image_count - left.video_image_count)[0];
    const hasVideoColumn = Boolean(videoColumn?.video_image_count);
    const embeddedProductDetails = productColumn?.score
      ? dataRows.slice(0, 8).map((row) => parseProductDetails(cellDetails(row)[productColumn.index]?.text || ""))
      : [];
    const hasEmbeddedProductDetails = embeddedProductDetails.some((details) => details.has_embedded_details);
    const fieldTemplate = fieldDefinitions.map((field) => {
      let best = columns
        .map((column) => ({ ...column, score: headerScore(column.header, field.aliases) }))
        .sort((left, right) => right.score - left.score)[0];
      if (field.key === "image" && (!best || best.score === 0) && imageColumn?.image_count) {
        best = { ...imageColumn, score: 1 };
      }
      if (["price_range", "rating", "review_count"].includes(field.key) && (!best || best.score === 0) && productColumn?.score && hasEmbeddedProductDetails) {
        best = { ...productColumn, score: 1 };
      }
      if (field.key === "videos" && (!best || best.score === 0) && hasVideoColumn) {
        best = { ...videoColumn, score: 1 };
      }
      if (field.key === "rank_change" && (!best || best.score === 0)) {
        const rankColumn = columns
          .map((column) => ({ ...column, score: headerScore(column.header, fieldDefinitions.find((candidate) => candidate.key === "rank").aliases) }))
          .sort((left, right) => right.score - left.score)[0];
        if (rankColumn?.score) best = { ...rankColumn, score: 1 };
      }
      return {
        key: field.key,
        label: field.label,
        value_type: field.kind,
        source_header: best?.score ? best.header : null,
        column_index: best?.score ? best.index : null,
        available: Boolean(best?.score),
        match_confidence: best?.score >= 100 ? "high" : best?.score ? "low" : "unmatched",
        extraction: ["price_range", "rating", "review_count"].includes(field.key) && best?.index === productColumn?.index && best?.score < 100 ? "embedded_product_text" : "cell_value"
      };
    });
    const rankColumnIndex = fieldTemplate.find((field) => field.key === "rank" && field.available)?.column_index;
    const relatedColumnIndexes = {
        video: fieldTemplate.find((field) => field.key === "videos" && field.available)?.column_index
          ?? fieldTemplate.find((field) => field.key === "best_video" && field.available)?.column_index
          ?? (hasVideoColumn ? videoColumn.index : undefined),
      creator: fieldTemplate.find((field) => field.key === "creator" && field.available)?.column_index
    };
    const records = dataRows.map((row, rowIndex) => {
      const cells = cellDetails(row);
      const productDetails = productColumn?.score ? parseProductDetails(cells[productColumn.index]?.text || "") : null;
      const rowRankParts = rankColumnIndex !== undefined ? rankParts(row.children[rankColumnIndex], rowIndex) : { rank: null, rank_change: null };
      const record = Object.fromEntries(fieldTemplate
        .filter((field) => field.available)
        .map((field) => {
          if (productDetails && field.key === "product_name" && field.column_index === productColumn.index) return [field.label, productDetails.title];
          if (productDetails && field.key === "price_range" && field.column_index === productColumn.index && field.extraction === "embedded_product_text") return [field.label, productDetails.price_range];
          if (productDetails && field.key === "rating" && field.column_index === productColumn.index && field.extraction === "embedded_product_text") return [field.label, productDetails.rating];
          if (productDetails && field.key === "review_count" && field.column_index === productColumn.index && field.extraction === "embedded_product_text") return [field.label, productDetails.review_count];
          if (field.key === "rank") return [field.label, rowRankParts.rank];
          if (field.key === "rank_change") return [field.label, rowRankParts.rank_change];
          if (field.key === "videos") return [field.label, []];
          return [field.label, field.key === "image" ? (cells[field.column_index]?.image || null) : (cells[field.column_index]?.text || "")];
        }));
      const videoContent = relatedColumnIndexes.video !== undefined
        ? extractRelatedContent(row.children[relatedColumnIndexes.video], "video")
        : null;
      const creatorContent = relatedColumnIndexes.creator !== undefined
        ? extractRelatedContent(row.children[relatedColumnIndexes.creator], "creator")
        : null;
      const relatedContent = {
        ...(videoContent?.video ? { video: videoContent.video } : {}),
        ...(creatorContent?.creator ? { creator: creatorContent.creator } : {})
      };
      if (Object.keys(relatedContent).length) record["关联内容"] = relatedContent;
      if (videoContent?.video) record["视频"] = videoContent.videos || [];
      return record;
    });
    return {
      schema_version: "1.0",
      generated_at: new Date().toISOString(),
      metadata: pageMetadata(),
      local_processing: true,
      source_type: "table",
      analysis_basis: { detected_tables: pageAnalysis.structures.tables.length, detected_lists: pageAnalysis.structures.lists.length },
      source_selector: selectorFor(table),
      item_count: records.length,
      raw_columns: headers,
      field_template: fieldTemplate,
      records,
      preview_records: records.slice(0, 5)
    };
  }

  const listCandidate = Array.from(document.querySelectorAll("ul, ol, [role='list']"))
    .filter(isVisible)
    .map((list) => {
      const items = Array.from(list.children).filter((item) => item.matches("li, [role='listitem']"));
      return { list, items };
    })
    .filter((candidate) => candidate.items.length >= 2)
    .sort((left, right) => right.items.length - left.items.length)[0];
  if (listCandidate) {
    const records = listCandidate.items.map((item) => ({
      "条目文本": compactText(item.innerText || item.textContent || ""),
      "图片": imageSource(item)
    }));
    return {
      schema_version: "1.0",
      generated_at: new Date().toISOString(),
      metadata: pageMetadata(),
      local_processing: true,
      source_type: "list",
      analysis_basis: { detected_tables: pageAnalysis.structures.tables.length, detected_lists: pageAnalysis.structures.lists.length },
      source_selector: selectorFor(listCandidate.list),
      item_count: records.length,
      raw_columns: ["条目文本", "图片"],
      field_template: [
        { key: "item_text", label: "条目文本", value_type: "text", source_header: "列表项文本", column_index: null, available: true, match_confidence: "high" },
        { key: "image", label: "图片", value_type: "image", source_header: "列表项图片", column_index: null, available: records.some((record) => Boolean(record["图片"])), match_confidence: "high" }
      ],
      records,
      preview_records: records.slice(0, 5)
    };
  }

  return {
    schema_version: "1.0",
    generated_at: new Date().toISOString(),
    metadata: pageMetadata(),
    local_processing: true,
    source_type: null,
    analysis_basis: { detected_tables: pageAnalysis.structures.tables.length, detected_lists: pageAnalysis.structures.lists.length },
    item_count: 0,
    raw_columns: [],
    field_template: fieldDefinitions.map((field) => ({ key: field.key, label: field.label, value_type: field.kind, source_header: null, column_index: null, available: false, match_confidence: "unmatched" })),
    records: [],
    preview_records: []
  };
}

function detectProductOpportunityTable() {
  const compactText = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const normalizeHeader = (value) => compactText(value).toLowerCase().replace(/[\s_\-:/：()（）]/g, "");
  const isVisible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  };
  const fields = ["关键词", "类目", "线索来源", "搜索次数", "在售商品"];
  const candidates = Array.from(document.querySelectorAll("table"))
    .filter(isVisible)
    .map((table) => {
      const headers = Array.from(table.querySelectorAll("thead th")).map((cell) => compactText(cell.innerText || cell.textContent || ""));
      const matchedFields = fields.filter((field) => headers.some((header) => normalizeHeader(header) === normalizeHeader(field)));
      return matchedFields.length >= 3 ? { table, headers, matched_fields: matchedFields } : null;
    })
    .filter(Boolean);
  return candidates[0] || null;
}

function detectCollectionPageType() {
  return detectProductOpportunityTable() ? "product_opportunity" : "product_rank";
}

function findProductOpportunityScrollContainer(detected = detectProductOpportunityTable()) {
  const table = detected?.table;
  if (!table) return null;
  const cached = window.__crawlHubOpportunityScrollContainer;
  if (cached instanceof Element && window.__crawlHubOpportunityScrollContainerTarget === table && document.documentElement.contains(cached)
    && cached.scrollHeight > cached.clientHeight + 8) return cached;
  const candidates = inspectScrollableElements(table);
  const container = candidates.find((item) => item.contains_list_data && item.clientHeight >= 80)?.element
    || candidates.find((item) => item.clientHeight >= 80)?.element
    || null;
  window.__crawlHubOpportunityScrollContainer = container;
  window.__crawlHubOpportunityScrollContainerTarget = table;
  return container;
}

function isVisiblePageElement(element) {
  if (!(element instanceof Element)) return false;
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
}

function compactOpportunityText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeOpportunityText(value) {
  return compactOpportunityText(value).toLowerCase().replace(/[\s_\-:/：()（）]/g, "");
}

function normalizeOpportunityKeyword(value) {
  return compactOpportunityText(value).replace(/^#\s*/, "").toLowerCase();
}

function isTrendingKeywordsOpportunityPage() {
  const detected = detectProductOpportunityTable();
  if (!detected) return false;
  const isOpportunityRoute = /\/product\/opportunity/i.test(location.pathname);
  const params = new URL(location.href).searchParams;
  const selectedByUrl = params.get("tab") === "trending_keywords";
  const selectedByTab = Array.from(document.querySelectorAll("[role='tab'], button, a"))
    .filter(isVisiblePageElement)
    .some((element) => {
      const text = compactOpportunityText(element.innerText || element.textContent || "");
      if (!["热门关键词", "Trending Keywords"].includes(text)) return false;
      for (let current = element, depth = 0; current && depth < 3; current = current.parentElement, depth += 1) {
        if (current.getAttribute("aria-selected") === "true" || current.getAttribute("aria-current") === "page"
          || /(?:^|[-_\s])(active|selected|current)(?:$|[-_\s])/i.test(String(current.className || ""))) return true;
      }
      return false;
    });
  return isOpportunityRoute && (selectedByUrl || selectedByTab);
}

function productOpportunityRows(detected, container = findProductOpportunityScrollContainer(detected)) {
  if (!container) return [];
  const expectedColumns = detected.headers.length;
  return Array.from(container.querySelectorAll("tr, [role='row'], div"))
    .filter(isVisiblePageElement)
    .filter((row) => {
      const cells = Array.from(row.children).filter(isVisiblePageElement);
      return cells.length >= expectedColumns && cells.length <= expectedColumns + 3;
  });
}

function productOpportunityColumnIndexes(detected) {
  return {
    keyword: detected.headers.findIndex((header) => normalizeOpportunityText(header) === normalizeOpportunityText("关键词")),
    category: detected.headers.findIndex((header) => normalizeOpportunityText(header) === normalizeOpportunityText("类目")),
    action: detected.headers.findIndex((header) => normalizeOpportunityText(header) === normalizeOpportunityText("操作"))
  };
}

function waitForPageUpdate(milliseconds = 180) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForProductOpportunityScrollStability(container, {
  minWait = 300,
  maxWait = 3000,
  pollWait = 180,
  stablePollsRequired = 2
} = {}) {
  let observedScrollTop = container.scrollTop;
  let observedScrollHeight = container.scrollHeight;
  let elapsed = 0;
  let stablePolls = 0;
  while (elapsed < maxWait) {
    await waitForPageUpdate(pollWait);
    elapsed += pollWait;
    const scrollChanged = Math.abs(container.scrollTop - observedScrollTop) > 2;
    const heightChanged = Math.abs(container.scrollHeight - observedScrollHeight) > 2;
    if (scrollChanged || heightChanged) {
      observedScrollTop = container.scrollTop;
      observedScrollHeight = container.scrollHeight;
      stablePolls = 0;
      continue;
    }
    stablePolls += 1;
    if (elapsed >= minWait && stablePolls >= stablePollsRequired) {
      return { stable: true, elapsed, scroll_changed: scrollChanged, height_changed: heightChanged };
    }
  }
  return { stable: false, elapsed, scroll_changed: Math.abs(container.scrollTop - observedScrollTop) > 2, height_changed: Math.abs(container.scrollHeight - observedScrollHeight) > 2 };
}

async function scanProductOpportunityScroll({
  container,
  collect,
  onProgress = null,
  shouldContinue = async () => true,
  restoreScrollPosition = false,
  bottomStableRequired = 3,
  maxRounds = 240
}) {
  if (!(container instanceof Element)) throw new Error("未找到商品机会列表的可滚动区域。");
  const originalScrollTop = container.scrollTop;
  const tolerance = 2;
  let bottomStableRounds = 0;
  let stopped = false;
  let completed = false;
  let lastTotalCount = 0;
  let endReason = "达到最大扫描轮次，未确认到底部";
  const diagnosticLog = (message) => console.debug(`[CrawlHub][商品机会扫描]\n${message}`);
  const progress = (phase, totalCount = 0, addedCount = 0) => {
    onProgress?.({ phase, total_count: totalCount, added_count: addedCount, scroll_top: container.scrollTop, scroll_height: container.scrollHeight });
  };

  try {
    container.scrollTop = 0;
    await waitForPageUpdate(180);
    for (let round = 0; round < maxRounds; round += 1) {
      if (!await shouldContinue()) {
        stopped = true;
        endReason = "任务被停止";
        break;
      }
      const beforeScrollTop = container.scrollTop;
      const beforeScrollHeight = container.scrollHeight;
      const before = await collect({ phase: "scanning", scroll_top: beforeScrollTop, scroll_height: beforeScrollHeight });
      const beforeTotal = Number(before?.total_count || 0);
      lastTotalCount = beforeTotal;
      progress("scanning", beforeTotal, Number(before?.added_count || 0));
      const maximumScrollTop = Math.max(0, beforeScrollHeight - container.clientHeight);
      const isNearBottom = beforeScrollTop >= maximumScrollTop - tolerance;
      const beforeAddedCount = Number(before?.added_count || 0);
      diagnosticLog(`扫描轮次: ${round + 1}\n\nscrollTop:\n${beforeScrollTop}\n\nclientHeight:\n${container.clientHeight}\n\nscrollHeight:\n${beforeScrollHeight}\n\n是否到底:\n${isNearBottom}\n\n当前数量:\n${beforeTotal}\n\n新增:\n${beforeAddedCount}\n\n当前关键词数量:\n${beforeTotal}`);

      if (!isNearBottom) {
        const scrollStep = 400 + ((round * 173 + container.clientHeight) % 401);
        const targetScrollTop = Math.min(beforeScrollTop + scrollStep, maximumScrollTop);
        container.scrollTop = targetScrollTop;
        diagnosticLog(`扫描轮次: ${round + 1}\n\n滚动距离：\n${scrollStep}\n\n滚动前：\nscrollTop = ${beforeScrollTop}\n\n滚动后：\nscrollTop = ${container.scrollTop}`);
        bottomStableRounds = 0;
        progress("loading", beforeTotal, 0);
        await waitForProductOpportunityScrollStability(container);
        continue;
      }

      progress("loading", beforeTotal, 0);
      await waitForProductOpportunityScrollStability(container);
      const after = await collect({ phase: "scanning", scroll_top: container.scrollTop, scroll_height: container.scrollHeight });
      const afterTotal = Number(after?.total_count || beforeTotal);
      lastTotalCount = afterTotal;
      const addedCount = Math.max(Number(after?.added_count || 0), afterTotal - beforeTotal);
      const afterScrollTop = container.scrollTop;
      const afterScrollHeight = container.scrollHeight;
      const afterMaximumScrollTop = Math.max(0, afterScrollHeight - container.clientHeight);
      const bottomStable = afterScrollTop >= afterMaximumScrollTop - tolerance
        && Math.abs(afterScrollHeight - beforeScrollHeight) <= tolerance
        && Math.abs(afterScrollTop - beforeScrollTop) <= tolerance
        && addedCount === 0;
      diagnosticLog(`扫描轮次: ${round + 1}\n\n滚动前：\nscrollTop = ${beforeScrollTop}\n\n滚动后：\nscrollTop = ${afterScrollTop}\n\nclientHeight:\n${container.clientHeight}\n\nscrollHeight:\n${afterScrollHeight}\n\n是否到底:\n${afterScrollTop >= afterMaximumScrollTop - tolerance}\n\n当前数量:\n${afterTotal}\n\n新增:\n${addedCount}\n\n当前关键词数量:\n${afterTotal}\n\n底部稳定轮次:\n${bottomStableRounds + (bottomStable ? 1 : 0)}`);
      progress("scanning", afterTotal, addedCount);
      bottomStableRounds = bottomStable ? bottomStableRounds + 1 : 0;
      if (bottomStableRounds >= bottomStableRequired) {
        completed = true;
        endReason = "到达底部且连续无新增";
        break;
      }
    }
  } finally {
    if (restoreScrollPosition && document.documentElement.contains(container)) {
      container.scrollTop = originalScrollTop;
      await waitForPageUpdate(180);
    }
    diagnosticLog(`扫描${completed ? "完成" : "结束"}\n\n原因：\n- ${endReason}\n\n最终 scrollTop：\n${container.scrollTop}\n\n最终 scrollHeight：\n${container.scrollHeight}\n\n最终数量：\n${lastTotalCount}`);
  }
  return { stopped, completed, reached_limit: !stopped && !completed, bottom_stable_rounds: bottomStableRounds };
}

function findProductOpportunityRowForEntry(detected, container, entry) {
  const { keyword: keywordColumn, category: categoryColumn } = productOpportunityColumnIndexes(detected);
  if (keywordColumn < 0) return null;
  return productOpportunityRows(detected, container).find((row) => {
    const cells = Array.from(row.children).filter(isVisiblePageElement);
    const keyword = compactOpportunityText(cells[keywordColumn]?.innerText || cells[keywordColumn]?.textContent || "");
    const category = categoryColumn >= 0 ? compactOpportunityText(cells[categoryColumn]?.innerText || cells[categoryColumn]?.textContent || "") : "";
    return normalizeOpportunityKeyword(keyword) === entry.normalized_keyword && category === entry.category;
  }) || null;
}

async function scanProductOpportunityBindingIndex(onProgress = null, scanControl = window.__crawlHubBindingScanControl) {
  const detected = detectProductOpportunityTable();
  if (!isTrendingKeywordsOpportunityPage() || !detected) throw new Error("请先打开 TikTok 商品机会的“热门关键词”页面。");
  const container = findProductOpportunityScrollContainer(detected);
  if (!container) throw new Error("未找到热门关键词列表的可滚动区域。");
  const { keyword: keywordColumn, category: categoryColumn } = productOpportunityColumnIndexes(detected);
  if (keywordColumn < 0) throw new Error("当前页面未找到关键词列。");
  const entries = [];
  const seen = new Set();
  let controlPhase = "scanning";
  const updateProgress = (phase) => {
    window.__crawlHubBindingSession = {
      state: "scanning",
      phase,
      entries,
      loaded_count: entries.length,
      scanned_at: Date.now()
    };
    if (onProgress) onProgress();
  };
  const shouldContinue = async () => {
    while (scanControl?.paused) {
      if (controlPhase !== "paused") {
        controlPhase = "paused";
        updateProgress("paused");
      }
      await waitForPageUpdate(200);
    }
    if (scanControl && controlPhase !== "scanning") {
      controlPhase = "scanning";
      updateProgress("scanning");
    }
    return !scanControl?.cancelled;
  };
  const collectCurrentRows = () => {
    const scrollTop = container.scrollTop;
    productOpportunityRows(detected, container).forEach((row, rowIndex) => {
      const cells = Array.from(row.children).filter(isVisiblePageElement);
      const keyword = compactOpportunityText(cells[keywordColumn]?.innerText || cells[keywordColumn]?.textContent || "");
      if (!keyword) return;
      const category = categoryColumn >= 0 ? compactOpportunityText(cells[categoryColumn]?.innerText || cells[categoryColumn]?.textContent || "") : "";
      const normalizedKeyword = normalizeOpportunityKeyword(keyword);
      const entryKey = `${normalizedKeyword}\u0000${category}`;
      if (seen.has(entryKey)) return;
      seen.add(entryKey);
      entries.push({ keyword, normalized_keyword: normalizedKeyword, category, row, row_index: rowIndex, scroll_top: scrollTop, container });
    });
  };

  const scanResult = await scanProductOpportunityScroll({
    container,
    collect: async () => {
      const countBeforeCollect = entries.length;
      collectCurrentRows();
      return { total_count: entries.length, added_count: entries.length - countBeforeCollect };
    },
    onProgress: ({ phase, total_count: totalCount }) => updateProgress(phase, totalCount),
    shouldContinue,
    restoreScrollPosition: true
  });
  if (!scanResult.completed) throw new Error("未能确认商品机会列表已滚动到底部，请稍后重试。");
  window.__crawlHubBindingSession = { state: "completed", entries, loaded_count: entries.length, scanned_at: Date.now() };
  if (onProgress) onProgress();
  return window.__crawlHubBindingSession;
}

async function locateProductOpportunityKeyword(keyword) {
  const session = window.__crawlHubBindingSession;
  if (!session || session.state !== "completed") throw new Error("请先扫描商品机会。");
  const normalizedKeyword = normalizeOpportunityKeyword(keyword);
  const entry = session.entries.find((item) => item.normalized_keyword === normalizedKeyword);
  if (!entry) throw new Error("未找到该商品机会关键词。");
  const detected = detectProductOpportunityTable();
  if (!detected) throw new Error("当前页面已不是商品机会页面，请重新扫描。");
  const container = findProductOpportunityScrollContainer(detected);
  if (!container) throw new Error("未找到热门关键词列表的可滚动区域。");
  let row = document.documentElement.contains(entry.row) ? entry.row : null;
  if (!row) {
    container.scrollTop = entry.scroll_top;
    await waitForPageUpdate(1200);
    row = findProductOpportunityRowForEntry(detected, container, entry);
  }
  if (!row) throw new Error("页面内容已变化，请重新扫描商品机会。");
  entry.row = row;
  entry.container = container;
  row.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
  await waitForPageUpdate(80);
  const rowRect = row.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  if (rowRect.top < containerRect.top || rowRect.bottom > containerRect.bottom) {
    container.scrollTop += rowRect.top < containerRect.top
      ? rowRect.top - containerRect.top
      : rowRect.bottom - containerRect.bottom;
    await waitForPageUpdate(80);
  }
  return entry;
}

function findProductOpportunityMenuTrigger(row, detected) {
  const { action: actionColumn } = productOpportunityColumnIndexes(detected);
  const cells = Array.from(row.children).filter(isVisiblePageElement);
  const actionCell = actionColumn >= 0 ? cells[actionColumn] : null;
  if (!actionCell) return null;
  const controls = Array.from(actionCell.querySelectorAll("button, [role='button'], [tabindex]"))
    .filter(isVisiblePageElement);
  return controls.find((control) => /^(?:\.{3}|…|⋯)$/.test(compactOpportunityText(control.innerText || control.textContent || "")))
    || controls.find((control) => /更多|more|menu|action|ellipsis|三点/i.test([
      control.getAttribute("aria-label"), control.getAttribute("title"), control.getAttribute("data-tooltip"), control.innerText, control.textContent
    ].join(" ")))
    || controls.find((control) => !compactOpportunityText(control.innerText || control.textContent || "") && Boolean(control.querySelector("svg, img")))
    || null;
}

function findVisibleBindingMenuItem() {
  const matches = Array.from(document.body?.querySelectorAll("*") || [])
    .filter(isVisiblePageElement)
    .filter((element) => compactOpportunityText(element.innerText || element.textContent || "") === "绑定现有商品")
    .filter((element) => !Array.from(element.children).some((child) => compactOpportunityText(child.innerText || child.textContent || "") === "绑定现有商品"));
  const item = matches[0] || null;
  return item?.closest("button, [role='menuitem'], [role='button'], [tabindex]") || item;
}

async function openExistingProductBinding(keyword) {
  const entry = await locateProductOpportunityKeyword(keyword);
  const trigger = findProductOpportunityMenuTrigger(entry.row, detectProductOpportunityTable());
  if (!trigger) throw new Error("未在该关键词行的操作区域找到三点菜单。");
  trigger.click();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await waitForPageUpdate(100);
    const menuItem = findVisibleBindingMenuItem();
    if (!menuItem) continue;
    menuItem.click();
    return entry;
  }
  throw new Error("三点菜单已打开，但未找到“绑定现有商品”。");
}

function findVisibleExactTextElement(text, root = document) {
  return Array.from(root.querySelectorAll("*")).find((element) => {
    if (!isVisiblePageElement(element)) return false;
    if (compactOpportunityText(element.innerText || element.textContent || "") !== text) return false;
    return !Array.from(element.children).some((child) => compactOpportunityText(child.innerText || child.textContent || "") === text);
  }) || null;
}

function isAvailableDomControl(control) {
  if (!control || !isVisiblePageElement(control)) return false;
  return !control.disabled
    && control.getAttribute("disabled") === null
    && control.getAttribute("aria-disabled") !== "true";
}

function findVisibleTextButton(text, root = document) {
  return Array.from(root.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']"))
    .find((control) => isAvailableDomControl(control)
      && compactOpportunityText(control.innerText || control.value || control.textContent || "") === text) || null;
}

async function waitForDomState(readState, { timeout = 8000, interval = 250 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = readState();
    if (state) return state;
    await waitForPageUpdate(interval);
  }
  return null;
}

function setNativeInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement?.prototype || {}, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function findSearchControlForInput(searchInput) {
  const inputComponent = searchInput.closest(".core-input-group") || searchInput.parentElement;
  if (!inputComponent) return null;
  const suffix = Array.from(inputComponent.querySelectorAll(".core-input-group-suffix"))
    .find(isVisiblePageElement);
  if (!suffix) return null;
  const icon = suffix.querySelector("svg.arco-icon-search") || suffix.querySelector("svg");
  return icon?.closest("button, [role='button'], [tabindex]") || suffix;
}

function triggerSearchForInput(searchInput) {
  const searchControl = findSearchControlForInput(searchInput);
  if (searchControl && isVisiblePageElement(searchControl)) {
    searchControl.click();
    return true;
  }
  searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
  searchInput.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
  return false;
}

function findAutoReportStepOneRoot(searchInput) {
  const stepTitle = findVisibleExactTextElement("第 1 步：选择商品");
  for (let element = searchInput; element instanceof Element && element !== document.body; element = element.parentElement) {
    if (stepTitle && element.contains(stepTitle) && element.querySelector("tr")) return element;
  }
  return document.body;
}

function rowContainsCompleteProductId(row, productId) {
  const escapedId = productId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const completeId = new RegExp(`(^|[^0-9A-Za-z_-])${escapedId}(?=$|[^0-9A-Za-z_-])`);
  return completeId.test(compactOpportunityText(row.innerText || row.textContent || ""));
}

function findRowCheckboxControl(row) {
  return Array.from(row.querySelectorAll("input[type='checkbox'], [role='checkbox'], label"))
    .find(isVisiblePageElement) || null;
}

function hasCheckedState(element) {
  if (!(element instanceof Element)) return false;
  if (element instanceof HTMLInputElement && element.type === "checkbox") return element.checked;
  if (element.getAttribute("aria-checked") === "true" || element.getAttribute("aria-selected") === "true") return true;
  return typeof element.className === "string" && /(?:^|\s)[\w-]*checked(?:\s|$)/i.test(element.className);
}

function isProductRowChecked(row) {
  if (hasCheckedState(row)) return true;
  return Array.from(row.querySelectorAll("input[type='checkbox'], [role='checkbox'], label"))
    .some(hasCheckedState);
}

async function runSingleProductAutoReport(keyword, productId, onStatus = null) {
  const session = window.__crawlHubBindingSession;
  if (!session || session.state !== "completed") throw new Error("请先完成商品机会扫描。");
  const updateStatus = (message) => {
    if (onStatus) onStatus(message);
  };

  updateStatus("正在打开绑定入口...");
  await openExistingProductBinding(keyword);
  updateStatus("正在等待商品选择窗口...");
  const searchInput = await waitForDomState(() => {
    const input = document.getElementById("search_content_input");
    return input && isVisiblePageElement(input) && findVisibleExactTextElement("第 1 步：选择商品") ? input : null;
  });
  if (!searchInput) throw new Error("未等到商品选择窗口，请稍后重试。");
  await waitForPageUpdate(350);

  updateStatus("正在搜索商品...");
  setNativeInputValue(searchInput, productId);
  if (searchInput.value !== productId) throw new Error("商品 ID 未能写入搜索框，请重试。");
  triggerSearchForInput(searchInput);
  await waitForPageUpdate(350);
  const stepOneRoot = findAutoReportStepOneRoot(searchInput);
  const matchingRows = await waitForDomState(() => {
    const rows = Array.from(stepOneRoot.querySelectorAll("tr")).filter(isVisiblePageElement);
    const matches = rows.filter((row) => rowContainsCompleteProductId(row, productId));
    return matches.length ? matches : null;
  }, { timeout: 12000 });
  if (!matchingRows) throw new Error("商品搜索结果中没有此商品 ID。");
  if (matchingRows.length !== 1) throw new Error("商品 ID 匹配到多条结果，请确认后重试。");

  const targetRow = matchingRows[0];
  const checkbox = findRowCheckboxControl(targetRow);
  if (!checkbox) throw new Error("该商品暂时无法勾选。");
  updateStatus("正在选择商品...");
  if (!isProductRowChecked(targetRow)) checkbox.click();
  const checked = await waitForDomState(() => isProductRowChecked(targetRow));
  if (!checked) throw new Error("未能确认商品已选中。");
  await waitForPageUpdate(350);

  const nextButton = await waitForDomState(() => findVisibleTextButton("下一步"));
  if (!nextButton) throw new Error("未找到可用的下一步按钮。");
  updateStatus("正在进入添加关键词步骤...");
  nextButton.click();
  const stepTwoReady = await waitForDomState(() => {
    const hasStepTwoTitle = Boolean(findVisibleExactTextElement("第 2 步：添加关键词"));
    const submitButton = findVisibleTextButton("提交");
    const firstStepInput = document.getElementById("search_content_input");
    return hasStepTwoTitle || (submitButton && (!firstStepInput || !isVisiblePageElement(firstStepInput)));
  });
  if (!stepTwoReady) throw new Error("未能进入添加关键词步骤。");
  await waitForPageUpdate(350);

  const submitButton = await waitForDomState(() => findVisibleTextButton("提交"));
  if (!submitButton) throw new Error("未找到可用的提交按钮。");
  updateStatus("正在提交...");
  submitButton.click();
  const submitted = await waitForDomState(() => Array.from(document.body?.querySelectorAll("*") || [])
    .some((element) => isVisiblePageElement(element)
      && compactOpportunityText(element.innerText || element.textContent || "").includes("商品提交成功")), { timeout: 10000 });
  if (!submitted) throw new Error("提交后未看到成功提示。");
  updateStatus("提报成功。");
  return { keyword, product_id: productId };
}

function collectProductOpportunityData() {
  const detected = detectProductOpportunityTable();
  if (!detected) throw new Error("当前页面未识别到商品机会字段。");
  const compactText = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const normalizeHeader = (value) => compactText(value).toLowerCase().replace(/[\s_\-:/：()（）]/g, "");
  const isVisible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  };
  const fields = [
    { key: "keyword", label: "关键词", value_type: "text" },
    { key: "category", label: "类目", value_type: "text" },
    { key: "source", label: "线索来源", value_type: "text" },
    { key: "search_count", label: "搜索次数", value_type: "metric" },
    { key: "selling_products", label: "在售商品", value_type: "metric" }
  ];
  const columns = Object.fromEntries(fields.map((field) => [field.key, detected.headers.findIndex((header) => normalizeHeader(header) === normalizeHeader(field.label))]));
  const metricValue = (value) => {
    const match = compactText(value).match(/[\d,.]+\s*[万kK]?/);
    if (!match) return null;
    const text = match[0].replace(/,/g, "").replace(/\s/g, "");
    const multiplier = /万$/i.test(text) ? 10000 : /k$/i.test(text) ? 1000 : 1;
    const number = Number(text.replace(/[万kK]$/i, ""));
    return Number.isFinite(number) ? number * multiplier : null;
  };
  const container = findProductOpportunityScrollContainer(detected) || detected.table.parentElement;
  const rows = Array.from(container?.querySelectorAll(".core-table-tr") || [])
    .filter(isVisible)
    .filter((row) => row.querySelector(":scope > .core-table-td"));
  const seen = new Set();
  const records = rows.flatMap((row) => {
    const cells = Array.from(row.children).filter((cell) => cell.classList.contains("core-table-td"));
    const value = (key) => compactText(cells[columns[key]]?.innerText || cells[columns[key]]?.textContent || "");
    const keyword = value("keyword");
    const category = value("category");
    const source = value("source");
    const recordKey = `${keyword}|${category}`;
    if (!keyword || seen.has(recordKey)) return [];
    seen.add(recordKey);
    return [{
      "关键词": keyword,
      "类目": category || null,
      "线索来源": source || null,
      "搜索次数": metricValue(value("search_count")),
      "在售商品": metricValue(value("selling_products"))
    }];
  });
  return {
    schema_version: "1.0",
    generated_at: new Date().toISOString(),
    metadata: {
      category_full: "商品机会",
      category_short: "商品机会",
      category: "商品机会",
      created_at: new Date().toISOString(),
      page_title: document.title || "TikTok Shop Seller Center",
      rank_type: "热门关键词",
      url: location.href
    },
    local_processing: true,
    source_type: "product_opportunity",
    analysis_basis: { detected_tables: 1, detected_lists: 0 },
    source_selector: ".core-table-tr > .core-table-td",
    item_count: records.length,
    raw_columns: fields.map((field) => ({ header: field.label, column_index: columns[field.key] })),
    field_template: fields.map((field) => ({
      ...field,
      source_header: detected.headers[columns[field.key]],
      column_index: columns[field.key],
      available: columns[field.key] >= 0,
      match_confidence: "high"
    })),
    records,
    preview_records: records.slice(0, 5)
  };
}

function detectPaginationState() {
  const isVisible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  };
  const compactText = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const exactTextElements = Array.from(document.body?.querySelectorAll("*") || []).filter(isVisible).map((element) => ({ element, text: compactText(element.innerText || element.textContent) }));
  const rangeMatch = exactTextElements.map((item) => ({ ...item, match: item.text.match(/^(\d+)\s*[-–—~]\s*(\d+)\s*[/／]\s*(\d+)$/) })).find((item) => item.match);
  const perPageMatch = exactTextElements.map((item) => ({ ...item, match: item.text.match(/^(\d+)\s*[/／]\s*(?:page|页)$/i) })).find((item) => item.match);
  const rangeStart = rangeMatch ? Number(rangeMatch.match[1]) : null;
  const rangeEnd = rangeMatch ? Number(rangeMatch.match[2]) : null;
  const totalItems = rangeMatch ? Number(rangeMatch.match[3]) : null;
  const itemsPerPage = perPageMatch ? Number(perPageMatch.match[1]) : (rangeStart !== null && rangeEnd !== null ? rangeEnd - rangeStart + 1 : null);
  const interactive = Array.from(document.querySelectorAll("button, a, [role='button'], [role='link']")).filter(isVisible);
  const currentControl = interactive.find((element) => element.getAttribute("aria-current") === "page")
    || interactive.find((element) => element.getAttribute("aria-selected") === "true" && /^\d+$/.test(compactText(element.textContent)))
    || interactive.find((element) => /(?:^|[-_\s])(active|current|selected)(?:$|[-_\s])/i.test(String(element.className || "")) && /^\d+$/.test(compactText(element.textContent)));
  const currentFromControl = currentControl ? Number(compactText(currentControl.textContent)) : null;
  const currentPage = rangeStart && itemsPerPage ? Math.ceil(rangeStart / itemsPerPage) : currentFromControl;
  const totalPages = totalItems && itemsPerPage ? Math.ceil(totalItems / itemsPerPage) : null;

  const paginationContainer = (() => {
    let current = rangeMatch?.element || perPageMatch?.element || currentControl || null;
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      const controls = Array.from(current.querySelectorAll("button, a, [role='button'], [role='link']")).filter(isVisible);
      const pageControls = controls.filter((element) => /^\d+$/.test(compactText(element.textContent)));
      if (pageControls.length >= 2) return current;
    }
    return null;
  })();

  return {
    range_start: rangeStart,
    range_end: rangeEnd,
    total_items: totalItems,
    items_per_page: itemsPerPage,
    current_page: currentPage,
    total_pages: totalPages,
    range_element: rangeMatch?.element || null,
    pagination_container: paginationContainer
  };
}

function collectionEnvironment(result, pagination) {
  return {
    page: `${location.origin || ""}${location.pathname || ""}`,
    title: document.title || "",
    category_full: result.metadata?.category_full || null,
    source_type: result.source_type,
    columns: result.raw_columns.map((column) => ({ header: column.header, column_index: column.column_index })),
    fields: result.field_template.map((field) => ({ key: field.key, source_header: field.source_header, column_index: field.column_index, available: field.available })),
    total_items: pagination.total_items,
    items_per_page: pagination.items_per_page
  };
}

const collectionTaskSessionKey = "crawlHub.collection.tasks.v1";

function collectionTaskIdentity(metadata) {
  const category = exportDirectoryName(metadata.category_short || metadata.category_full || "未识别");
  const rankType = rankingDirectoryName(metadata);
  return {
    task_id: `${category}__${rankType}`,
    category,
    rank_type: rankType,
    label: `${category} / ${rankType}`
  };
}

function readCollectionTaskSessions() {
  try {
    const value = JSON.parse(sessionStorage.getItem(collectionTaskSessionKey) || "null");
    if (!value || typeof value !== "object") return { active_task_id: null, tasks: {} };
    return {
      active_task_id: value.active_task_id || null,
      tasks: value.tasks && typeof value.tasks === "object" ? value.tasks : {}
    };
  } catch {
    return { active_task_id: null, tasks: {} };
  }
}

function writeCollectionTaskSessions(sessions) {
  try { sessionStorage.setItem(collectionTaskSessionKey, JSON.stringify(sessions)); } catch { }
}

function applyCollectionTaskSnapshot(identity, snapshot, status = "active") {
  const result = snapshot?.result;
  if (!result || !Array.isArray(snapshot.pages)) return false;
  window.__crawlHubManualCollectionPages = snapshot.pages;
  window.__crawlHubCollectionPreview = result;
  window.__crawlHubCollectionEnvironment = snapshot.environment || null;
  window.__crawlHubCollectionFieldTemplate = result.field_template || snapshot.field_template || [];
  window.__crawlHubCollectionRawColumns = result.raw_columns || snapshot.raw_columns || [];
  window.__crawlHubCollectionSourceType = result.source_type || snapshot.source_type || null;
  window.__crawlHubCurrentProjectId = result.project_id || identity.task_id;
  window.__crawlHubManualCollectionState = {
    last_page: result.pagination?.current_page || null,
    collected_pages: result.pagination?.collected_pages || snapshot.pages.length,
    collected_items: result.item_count || result.records.length,
    duplicate: false
  };
  window.__crawlHubActiveTask = { ...identity, status, collected_count: result.item_count || result.records.length };
  return true;
}

function collectionTaskSnapshot(identity) {
  const result = window.__crawlHubCollectionPreview;
  if (!result || !Array.isArray(window.__crawlHubManualCollectionPages)) return null;
  return {
    url: location.href,
    pages: window.__crawlHubManualCollectionPages,
    result,
    environment: window.__crawlHubCollectionEnvironment || null,
    field_template: window.__crawlHubCollectionFieldTemplate || result.field_template || [],
    raw_columns: window.__crawlHubCollectionRawColumns || result.raw_columns || [],
    source_type: window.__crawlHubCollectionSourceType || result.source_type || null,
    task_id: identity.task_id
  };
}

function persistCollectionTaskSession(identity) {
  const snapshot = collectionTaskSnapshot(identity);
  if (!snapshot) return;
  const sessions = readCollectionTaskSessions();
  sessions.active_task_id = identity.task_id;
  sessions.tasks[identity.task_id] = { ...snapshot, status: window.__crawlHubActiveTask?.status || "active", updated_at: new Date().toISOString() };
  writeCollectionTaskSessions(sessions);
}

function clearActiveTaskView() {
  window.__crawlHubManualCollectionPages = [];
  delete window.__crawlHubCollectionPreview;
  delete window.__crawlHubManualCollectionState;
  delete window.__crawlHubCollectionEnvironment;
  delete window.__crawlHubPaginationState;
  delete window.__crawlHubActiveTask;
}

async function activateCollectionTask(identity, metadata = {}) {
  const sessions = readCollectionTaskSessions();
  const session = sessions.tasks[identity.task_id];
  if (session?.url === location.href && applyCollectionTaskSnapshot(identity, session, session.status || "active")) return true;
  try {
    const stored = await projectStorageRequest("crawlHub:read-project", { project_id: identity.task_id });
    if (applyStoredCollectionTask(identity, stored.project)) return true;
    const legacy = await projectStorageRequest("crawlHub:read-project", { project_id: legacyProjectFolderName({ ...metadata, category_short: identity.category }) });
    if (applyStoredCollectionTask(identity, legacy.project)) return true;
  } catch { }
  clearActiveTaskView();
  window.__crawlHubActiveTask = { ...identity, status: "active", collected_count: 0 };
  return false;
}

function applyStoredCollectionTask(identity, project) {
  const storedTask = project?.task;
  if (storedTask?.snapshot && applyCollectionTaskSnapshot(identity, storedTask.snapshot, storedTask.status || "active")) return true;
  if (!Array.isArray(project?.products) || !project.products.length) return false;
  const records = project.products.map((product) => Object.fromEntries(projectProductFields.map((field) => [field.label, product[field.key] ?? null])));
  const result = {
    metadata: project.metadata || {},
    source_type: "restored_session",
    item_count: records.length,
    raw_columns: projectProductFields.map((field, index) => ({ header: field.label, column_index: index })),
    field_template: projectProductFields.map((field, index) => ({ key: field.key, label: field.label, value_type: "text", source_header: field.label, column_index: index, available: records.some((record) => record[field.label] !== null && record[field.label] !== ""), match_confidence: "restored" })),
    records,
    preview_records: records.slice(0, 5),
    pagination: { current_page: null, total_items: records.length, items_per_page: null, total_pages: null, collected_pages: 1 },
    project_id: project.project_id || identity.task_id
  };
  return applyCollectionTaskSnapshot(identity, { pages: [{ key: "restored-project", page: null, result }], result }, storedTask?.status || "active");
}

function clearCollectionData() {
  const identity = window.__crawlHubActiveTask;
  clearActiveTaskView();
  const sessions = readCollectionTaskSessions();
  if (identity) delete sessions.tasks[identity.task_id];
  if (sessions.active_task_id === identity?.task_id) sessions.active_task_id = null;
  writeCollectionTaskSessions(sessions);
  return { cleared: true };
}

function productOpportunityTaskIdentity() {
  return collectionTaskIdentity({ category_full: "商品机会", category_short: "商品机会", rank_type: "热门关键词" });
}

function isProductOpportunitySnapshot(snapshot) {
  return snapshot?.source_type === "product_opportunity" || snapshot?.result?.source_type === "product_opportunity";
}

function resetProductOpportunityCollectionSession() {
  const scrollContainer = findProductOpportunityScrollContainer();
  if (scrollContainer) scrollContainer.scrollTop = 0;
  const identity = productOpportunityTaskIdentity();
  clearActiveTaskView();
  delete window.__crawlHubCollectionSourceType;
  delete window.__crawlHubCurrentProjectId;
  delete window.__crawlHubOpportunityScrollContainer;
  delete window.__crawlHubOpportunityScrollContainerTarget;
  window.__crawlHubCollectionBusy = false;
  const sessions = readCollectionTaskSessions();
  delete sessions.tasks[identity.task_id];
  if (sessions.active_task_id === identity.task_id) sessions.active_task_id = null;
  writeCollectionTaskSessions(sessions);
  return identity;
}

function startFreshProductOpportunityTask() {
  const identity = resetProductOpportunityCollectionSession();
  window.__crawlHubActiveTask = { ...identity, status: "active", collected_count: 0 };
  return identity;
}

async function saveCurrentTaskStatus(status) {
  const task = window.__crawlHubActiveTask;
  const result = window.__crawlHubCollectionPreview;
  if (!task || !result) return null;
  task.status = status;
  const savedProject = await saveInternalProject(result, {
    identity: task,
    pages: window.__crawlHubManualCollectionPages || [],
    environment: window.__crawlHubCollectionEnvironment,
    status,
    collected_count: result.item_count,
    field_template: result.field_template,
    collection_state: result.pagination
  });
  result.project_id = savedProject.project_id;
  task.collected_count = result.item_count;
  persistCollectionTaskSession(task);
  return savedProject;
}

async function collectCurrentPage() {
  const result = detectCollectionPageType() === "product_opportunity" ? collectProductOpportunityData() : collectPageData();
  const pagination = detectPaginationState();
  const environment = collectionEnvironment(result, pagination);
  const nextTask = collectionTaskIdentity(result.metadata);
  const currentTask = window.__crawlHubActiveTask;
  if (currentTask && currentTask.task_id !== nextTask.task_id) {
    if (result.source_type !== "product_opportunity") {
      const confirmed = window.confirm(`检测到类目或榜单已变化。\n旧任务数据会保留，新榜单将创建新的采集任务。\n\n是否切换到“${nextTask.label}”？`);
      if (!confirmed) return { cancelled: true, task_switch_cancelled: true, result: window.__crawlHubCollectionPreview || null, pagination, duplicate: false };
    }
    await activateCollectionTask(nextTask, result.metadata);
  } else if (!currentTask) {
    await activateCollectionTask(nextTask, result.metadata);
  }
  window.__crawlHubActiveTask = { ...nextTask, status: "active", collected_count: window.__crawlHubActiveTask?.collected_count || 0 };
  const existingPages = Array.isArray(window.__crawlHubManualCollectionPages) ? window.__crawlHubManualCollectionPages : [];
  const previousEnvironment = window.__crawlHubCollectionEnvironment;
  if (existingPages.length && previousEnvironment && previousEnvironment.signature !== JSON.stringify(environment)) {
    if (result.source_type !== "product_opportunity") {
      const confirmed = window.confirm("当前任务的分页或页面结构发生变化。\n旧任务数据会保留，本次将重新记录当前页面结果。\n\n是否继续？");
      if (!confirmed) return { cancelled: true, result: window.__crawlHubCollectionPreview || null, pagination, duplicate: false };
    }
    clearCollectionData();
    window.__crawlHubActiveTask = { ...nextTask, status: "active", collected_count: 0 };
  }
  const pageKey = pagination.current_page ? `page:${pagination.current_page}` : `records:${JSON.stringify(result.records)}`;
  if (!Array.isArray(window.__crawlHubManualCollectionPages)) window.__crawlHubManualCollectionPages = [];
  const alreadyCollected = window.__crawlHubManualCollectionPages.some((page) => page.key === pageKey);
  if (!alreadyCollected) {
    window.__crawlHubManualCollectionPages.push({
      key: pageKey,
      page: pagination.current_page,
      result
    });
  }
  const pages = window.__crawlHubManualCollectionPages;
  const seen = new Set();
  const records = [];
  pages.forEach((page) => page.result.records.forEach((record) => {
    const key = record["排名"] ?? (record["关键词"] ? `${record["关键词"]}|${record["类目"] || ""}` : `${record["商品名称"] || ""}|${record["店铺"] || ""}|${record["图片"] || ""}`);
    if (seen.has(key)) return;
    seen.add(key);
    records.push(record);
  }));
  const merged = {
    ...result,
    source_type: result.source_type === "product_opportunity" ? result.source_type : pages.length > 1 ? "manual_paginated_table" : result.source_type,
    item_count: records.length,
    records,
    preview_records: records.slice(0, 5),
    pagination: {
      current_page: pagination.current_page,
      total_items: pagination.total_items,
      items_per_page: pagination.items_per_page,
      total_pages: pagination.total_pages,
      collected_pages: pages.length
    }
  };
  const environmentSnapshot = { ...environment, signature: JSON.stringify(environment) };
  const savedProject = await saveInternalProject(merged, { identity: nextTask, pages, environment: environmentSnapshot });
  merged.project_id = savedProject.project_id;
  window.__crawlHubCollectionEnvironment = environmentSnapshot;
  window.__crawlHubCollectionFieldTemplate = result.field_template;
  window.__crawlHubCollectionRawColumns = result.raw_columns;
  window.__crawlHubCollectionSourceType = result.source_type;
  window.__crawlHubCollectionPreview = merged;
  window.__crawlHubManualCollectionState = {
    last_page: pagination.current_page,
    collected_pages: pages.length,
    collected_items: records.length,
    duplicate: alreadyCollected
  };
  window.__crawlHubActiveTask = { ...nextTask, status: "active", collected_count: records.length };
  persistCollectionTaskSession(nextTask);
  return { result: merged, pagination, duplicate: alreadyCollected, cancelled: false };
}

const projectProductFields = [
  { key: "rank", label: "排名" },
  { key: "rank_change", label: "排名变化" },
  { key: "product_name", label: "商品名称" },
  { key: "image", label: "图片" },
  { key: "price", label: "价格范围" },
  { key: "rating", label: "商品评分" },
  { key: "review_count", label: "评价数量" },
  { key: "gmv", label: "GMV" },
  { key: "clicks", label: "点击次数" },
  { key: "ctr", label: "点击率" },
  { key: "live_account", label: "直播账号" },
  { key: "best_video", label: "表现最佳的视频" },
  { key: "creator", label: "带货达人" },
  { key: "shop", label: "店铺" },
  { key: "similar_products", label: "同款商品数" },
  { key: "videos", label: "视频", value_type: "object" },
  { key: "related_content", label: "关联内容", value_type: "object" },
  { key: "keyword", label: "关键词" },
  { key: "category", label: "类目" },
  { key: "source", label: "线索来源" },
  { key: "search_count", label: "搜索次数" },
  { key: "selling_products", label: "在售商品" }
];

const productOpportunityExportFields = [
  { key: "keyword", label: "关键词" },
  { key: "category", label: "类目" },
  { key: "source", label: "线索来源" },
  { key: "search_count", label: "搜索次数" },
  { key: "selling_products", label: "在售商品" }
];

function collectionExportFields(sourceType) {
  return sourceType === "product_opportunity" ? productOpportunityExportFields : projectProductFields;
}

function collectionExportProducts(products, fields) {
  return products.map((product) => Object.fromEntries(fields.map((field) => [field.key, product[field.key] ?? null])));
}

function collectionProjectData(result) {
  const metadata = result.metadata || {};
  const products = result.records.map((record) => {
    const relatedContent = record["关联内容"] ?? record.related_content ?? null;
    const rawVideos = record["视频"] ?? record.videos
      ?? (Array.isArray(relatedContent?.video?.items) ? relatedContent.video.items : null);
    const videos = Array.isArray(rawVideos)
      ? rawVideos.map((item) => ({
        cover: item?.cover ?? item?.cover_image ?? null,
        creator: item?.creator ?? item?.creator_name ?? null
      })).filter((item) => Boolean(item.cover))
      : null;
    return {
    rank: record["排名"] ?? null,
    rank_change: record["排名变化"] ?? null,
    product_name: record["商品名称"] ?? null,
    image: record["图片"] ?? null,
    price: record["价格范围"] ?? null,
    rating: record["商品评分"] ?? null,
    review_count: record["评价数量"] ?? null,
    gmv: record["GMV"] ?? null,
    clicks: record["点击次数"] ?? null,
    ctr: record["点击率"] ?? null,
    live_account: record["直播账号"] ?? null,
    best_video: record["表现最佳的视频"] ?? null,
    creator: record["带货达人"] ?? null,
    shop: record["店铺"] ?? null,
    similar_products: record["同款商品数"] ?? null,
    videos,
    related_content: relatedContent,
    keyword: record["关键词"] ?? null,
    category: record["类目"] ?? null,
    source: record["线索来源"] ?? null,
    search_count: record["搜索次数"] ?? null,
    selling_products: record["在售商品"] ?? null
    };
  });
  return {
    metadata: {
      category_full: metadata.category_full || "未识别",
      category_short: metadata.category_short || "未识别",
      page_title: metadata.page_title || "未识别",
      url: metadata.url || location.href,
      created_at: metadata.created_at || new Date().toISOString(),
      rank_type: metadata.rank_type || "未识别"
    },
    products
  };
}

function collectionExportValue(value) {
  return value && typeof value === "object" ? JSON.stringify(value) : value ?? "";
}

function restoreCollectionSession() {
  try {
    if (detectCollectionPageType() === "product_opportunity") return false;
    const sessions = readCollectionTaskSessions();
    const activeTaskId = sessions.active_task_id;
    const saved = activeTaskId ? sessions.tasks[activeTaskId] : null;
    if (saved?.url === location.href) {
      if (isProductOpportunitySnapshot(saved)) {
        delete sessions.tasks[activeTaskId];
        sessions.active_task_id = null;
        writeCollectionTaskSessions(sessions);
        return false;
      }
      return applyCollectionTaskSnapshot(collectionTaskIdentity(saved.result?.metadata || {}), saved, saved.status || "active");
    }
    const legacy = JSON.parse(sessionStorage.getItem("crawlHub.collection.session.v1") || "null");
    if (legacy?.url === location.href && legacy.result && Array.isArray(legacy.pages)) {
      if (isProductOpportunitySnapshot(legacy)) {
        sessionStorage.removeItem("crawlHub.collection.session.v1");
        return false;
      }
      const identity = collectionTaskIdentity(legacy.result.metadata || {});
      const migrated = { ...legacy, task_id: identity.task_id, status: "active" };
      sessions.active_task_id = identity.task_id;
      sessions.tasks[identity.task_id] = migrated;
      writeCollectionTaskSessions(sessions);
      return applyCollectionTaskSnapshot(identity, migrated, "active");
    }
    return false;
  } catch {
    return false;
  }
}

function projectStorageRequest(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const recoveryMessage = "扩展刚刚重载，请点击浏览器工具栏中的 CrawlHub 图标重新打开面板后重试。字段模板会保留。";
    const isContextInvalidated = (value) => /extension context invalidated|receiving end does not exist|message port closed/i.test(String(value || ""));
    const requestId = `crawlHub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeout = setTimeout(() => {
      document.removeEventListener("crawlHub:storage-response", onResponse);
      reject(new Error("本地项目数据连接已失效，请点击浏览器工具栏中的 CrawlHub 图标重新打开面板后重试。"));
    }, 3000);
    const onResponse = (event) => {
      const response = event.detail;
      if (response?.request_id !== requestId) return;
      clearTimeout(timeout);
      document.removeEventListener("crawlHub:storage-response", onResponse);
      if (!response.ok) {
        const error = response.error || "本地项目数据操作失败";
        reject(new Error(response.error_code === "extension_context_invalidated" || isContextInvalidated(error) ? recoveryMessage : error));
      }
      else resolve(response);
    };
    document.addEventListener("crawlHub:storage-response", onResponse);
    document.dispatchEvent(new CustomEvent("crawlHub:storage-request", {
      detail: { request_id: requestId, type, ...payload }
    }));
  });
}

async function checkExtensionConnection() {
  await projectStorageRequest("crawlHub:ping");
  return true;
}

function markReconnectPending() {
  try { sessionStorage.setItem("crawlHub.reconnect.pending", "1"); } catch { }
}

async function saveInternalProject(result, taskState = {}) {
  const project = collectionProjectData(result);
  const identity = taskState.identity || collectionTaskIdentity(project.metadata);
  const projectId = identity.task_id;
  project.task = {
    task_id: projectId,
    category: identity.category,
    rank_type: identity.rank_type,
    status: taskState.status || "active",
    collected_count: taskState.collected_count ?? result.item_count ?? result.records.length,
    field_template: taskState.field_template || result.field_template || [],
    collection_state: taskState.collection_state || result.pagination || null,
    snapshot: taskState.pages ? {
      url: location.href,
      pages: taskState.pages,
      result: { ...result, project_id: projectId },
      environment: taskState.environment || null,
      field_template: taskState.field_template || result.field_template || [],
      raw_columns: result.raw_columns || [],
      source_type: result.source_type || null,
      task_id: projectId
    } : null
  };
  const response = await projectStorageRequest("crawlHub:save-project", { project_id: projectId, project });
  window.__crawlHubCurrentProjectId = projectId;
  return response.project;
}

function collectionXlsx(products, fields = projectProductFields) {

  const escapeXml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
  const columnName = (index) => {
    let value = index + 1;
    let name = "";
    while (value) {
      const remainder = (value - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      value = Math.floor((value - 1) / 26);
    }
    return name;
  };
  const textEncoder = new TextEncoder();
  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const zip = (entries) => {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const entry of entries) {
      const name = textEncoder.encode(entry.name);
      const data = typeof entry.content === "string" ? textEncoder.encode(entry.content) : entry.content;
      const crc = crc32(data);
      const local = new Uint8Array(30 + name.length + data.length);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, data.length, true);
      localView.setUint32(22, data.length, true);
      localView.setUint16(26, name.length, true);
      local.set(name, 30);
      local.set(data, 30 + name.length);
      localParts.push(local);

      const central = new Uint8Array(46 + name.length);
      const centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, data.length, true);
      centralView.setUint32(24, data.length, true);
      centralView.setUint16(28, name.length, true);
      centralView.setUint32(42, offset, true);
      central.set(name, 46);
      centralParts.push(central);
      offset += local.length;
    }
    const centralLength = centralParts.reduce((total, part) => total + part.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, centralLength, true);
    endView.setUint32(16, offset, true);
    const archive = new Uint8Array(offset + centralLength + end.length);
    let cursor = 0;
    for (const part of [...localParts, ...centralParts, end]) {
      archive.set(part, cursor);
      cursor += part.length;
    }
    return archive;
  };
  const rows = [fields.map((field) => field.key), ...products.map((product) => fields.map((field) => collectionExportValue(product[field.key])))];
  const columns = fields.map((field, index) => {
    const longest = Math.max(...rows.map((row) => String(row[index] ?? "").length));
    return `<col min="${index + 1}" max="${index + 1}" width="${Math.min(48, Math.max(10, longest + 2))}" customWidth="1"/>`;
  }).join("");
  const rowXml = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      if (typeof value === "number" && Number.isFinite(value)) return `<c r="${reference}" s="${rowIndex === 0 ? 1 : 0}"><v>${value}</v></c>`;
      const text = escapeXml(value);
      const preserve = /^\s|\s$/.test(String(value ?? "")) ? ' xml:space="preserve"' : "";
      return `<c r="${reference}" t="inlineStr" s="${rowIndex === 0 ? 1 : 0}"><is><t${preserve}>${text}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="24" customHeight="1"' : ""}>${cells}</row>`;
  }).join("");
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${columns}</cols><sheetData>${rowXml}</sheetData></worksheet>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF315EFB"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="1" borderId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs></styleSheet>`;
  return zip([
    { name: "[Content_Types].xml", content: "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/><Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/></Types>" },
    { name: "_rels/.rels", content: "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>" },
    { name: "xl/workbook.xml", content: "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"采集结果\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>" },
    { name: "xl/_rels/workbook.xml.rels", content: "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>" },
    { name: "xl/styles.xml", content: stylesXml },
    { name: "xl/worksheets/sheet1.xml", content: sheetXml }
  ]);
}

async function writeProjectFile(directory, filename, content) {
  const fileHandle = await directory.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

function collectionCsv(products, fields = projectProductFields) {
  const escapeCsv = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = [fields.map((field) => escapeCsv(field.label)).join(",")];
  products.forEach((product) => rows.push(fields.map((field) => escapeCsv(collectionExportValue(product[field.key]))).join(",")));
  return `\uFEFF${rows.join("\r\n")}\r\n`;
}

const exportSettingsDatabase = "crawlHub.export-settings.v1";
const exportSettingsStore = "settings";
const exportRootSettingKey = "default_root";

function openExportSettingsDatabase() {
  if (!window.indexedDB) throw new Error("当前页面不支持保存导出目录设置。");
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(exportSettingsDatabase, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(exportSettingsStore, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("导出目录设置无法保存。"));
  });
}

async function readExportRootDirectory() {
  if (window.__crawlHubExportRootDirectory) return window.__crawlHubExportRootDirectory;
  const database = await openExportSettingsDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(exportSettingsStore, "readonly").objectStore(exportSettingsStore).get(exportRootSettingKey);
    request.onsuccess = () => {
      database.close();
      const handle = request.result?.handle || null;
      window.__crawlHubExportRootDirectory = handle;
      resolve(handle);
    };
    request.onerror = () => {
      database.close();
      reject(request.error || new Error("导出目录设置无法读取。"));
    };
  });
}

async function saveExportRootDirectory(handle) {
  const database = await openExportSettingsDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(exportSettingsStore, "readwrite").objectStore(exportSettingsStore).put({ key: exportRootSettingKey, handle });
    request.onsuccess = () => {
      database.close();
      window.__crawlHubExportRootDirectory = handle;
      resolve(handle);
    };
    request.onerror = () => {
      database.close();
      reject(request.error || new Error("导出目录设置无法保存。"));
    };
  });
}

async function ensureExportRootPermission(handle) {
  if (!handle || typeof handle.queryPermission !== "function") return Boolean(handle);
  const permission = await handle.queryPermission({ mode: "readwrite" });
  if (permission === "granted") return true;
  return (await handle.requestPermission({ mode: "readwrite" })) === "granted";
}

function exportDirectoryName(value) {
  const cleaned = String(value || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 80);
  return cleaned || "未识别";
}

function categoryDirectoryName(metadata) {
  return exportDirectoryName(metadata.category_short || metadata.category_full || "未识别");
}

function rankingDirectoryName(metadata) {
  const supportedRankTypes = ["总榜", "直播榜", "短视频榜", "商品卡", "达人榜", "新品榜"];
  return exportDirectoryName(supportedRankTypes.includes(metadata.rank_type) ? metadata.rank_type : "未识别");
}

async function findDirectory(parent, name) {
  try {
    return await parent.getDirectoryHandle(name, { create: false });
  } catch (error) {
    if (error?.name === "NotFoundError") return null;
    throw error;
  }
}

function projectFolderName(metadata) {
  return collectionTaskIdentity(metadata).task_id;
}

function legacyProjectFolderName(metadata) {
  const shortName = String(metadata.category_short || metadata.category || "未识别").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim() || "未识别";
  const createdAt = new Date(metadata.created_at);
  const date = Number.isNaN(createdAt.valueOf()) ? new Date() : createdAt;
  const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return `${shortName}_${localDate}`;
}

async function exportCollectionProject() {
  const result = window.__crawlHubCollectionPreview;
  if (!result) throw new Error("请先提取当前页列表数据");
  if (typeof window.showDirectoryPicker !== "function") throw new Error("当前浏览器不支持项目文件夹导出，请使用最新版 Chrome。");
  const projectId = window.__crawlHubCurrentProjectId || projectFolderName(collectionProjectData(result).metadata);
  const stored = await projectStorageRequest("crawlHub:read-project", { project_id: projectId });
  const project = stored.project;
  if (!project) throw new Error("未找到已保存的项目数据，请重新采集当前页");
  const sourceType = result.source_type === "product_opportunity"
    ? result.source_type
    : project.task?.snapshot?.source_type || project.task?.snapshot?.result?.source_type || result.source_type;
  const exportFields = collectionExportFields(sourceType);
  const exportProducts = collectionExportProducts(project.products, exportFields);
  const rootDirectory = await readExportRootDirectory();
  if (!rootDirectory) throw new Error("尚未设置默认导出根目录，请先点击齿轮设置；设置后可通过设置入口修改。");
  if (!(await ensureExportRootPermission(rootDirectory))) throw new Error("默认导出目录权限已失效，请点击齿轮重新设置。");
  const categoryDirectory = await rootDirectory.getDirectoryHandle(categoryDirectoryName(project.metadata), { create: true });
  const rankDirectoryName = sourceType === "product_opportunity" ? "热门关键词" : rankingDirectoryName(project.metadata);
  let collectionDirectory = await findDirectory(categoryDirectory, rankDirectoryName);
  if (collectionDirectory) {
    const confirmed = window.confirm(`发现已有数据：${categoryDirectory.name} / ${collectionDirectory.name}\n是否覆盖该榜单目录中的文件？`);
    if (!confirmed) throw new Error("已取消覆盖，原有数据未修改。");
  } else {
    collectionDirectory = await categoryDirectory.getDirectoryHandle(rankDirectoryName, { create: true });
  }
  await writeProjectFile(collectionDirectory, "metadata.json", JSON.stringify(project.metadata, null, 2));
  const filename = sourceType === "product_opportunity" ? "商品机会_热门关键词" : "products";
  await writeProjectFile(collectionDirectory, `${filename}.json`, JSON.stringify(exportProducts, null, 2));
  await writeProjectFile(collectionDirectory, `${filename}.xlsx`, collectionXlsx(exportProducts, exportFields));
  await writeProjectFile(collectionDirectory, `${filename}.csv`, collectionCsv(exportProducts, exportFields));
  return {
    folder_name: `${categoryDirectory.name}/${collectionDirectory.name}`,
    file_name: `${filename}.xlsx`,
    location: `${rootDirectory.name} / ${categoryDirectory.name}`,
    product_count: exportProducts.length
  };
}

function saveCollectionTemplate() {
  const result = window.__crawlHubCollectionPreview;
  const fieldTemplate = result?.field_template || window.__crawlHubCollectionFieldTemplate || [];
  if (!fieldTemplate.length) throw new Error("请先生成字段模板");
  const template = {
    schema_version: "1.0",
    saved_at: new Date().toISOString(),
    source_type: result?.source_type || window.__crawlHubCollectionSourceType || null,
    raw_columns: result?.raw_columns || window.__crawlHubCollectionRawColumns || [],
    field_template: fieldTemplate
  };
  localStorage.setItem("crawlHub.collectionTemplate.v1", JSON.stringify(template));
  return template;
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
  if (window.__crawlHubSamplingState === "sampling") {
    return { started: true, already_running: true };
  }
  if (window.__crawlHubSamplingState === "paused") {
    return resumeElementSampling();
  }
  if (window.__crawlHubSamplingCleanup) window.__crawlHubSamplingCleanup();
  window.__crawlHubSamplingActive = true;
  window.__crawlHubSamplingState = "sampling";
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
  notice.textContent = "CrawlHub：采样中，点击多个页面元素；可暂停后滚动页面";
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
  const onKey = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    cancelElementSampling();
  };
  const attach = () => {
    window.__crawlHubSamplingActive = true;
    window.__crawlHubSamplingState = "sampling";
    notice.style.display = "block";
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
  };
  const cleanup = () => {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    notice.remove();
    highlight.remove();
    window.__crawlHubSamplingActive = false;
    window.__crawlHubSamplingState = "idle";
    delete window.__crawlHubSamplingCleanup;
    delete window.__crawlHubSamplingPause;
    delete window.__crawlHubSamplingResume;
  };
  const pause = () => {
    if (window.__crawlHubSamplingState !== "sampling") return { paused: false };
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    highlight.style.display = "none";
    notice.style.display = "none";
    window.__crawlHubSamplingActive = false;
    window.__crawlHubSamplingState = "paused";
    return { paused: true, selected_count: window.__crawlHubSelectedElements.length };
  };
  const resume = () => {
    if (window.__crawlHubSamplingState !== "paused") return { resumed: false };
    attach();
    return { resumed: true, selected_count: window.__crawlHubSelectedElements.length };
  };

  window.__crawlHubSamplingCleanup = cleanup;
  window.__crawlHubSamplingPause = pause;
  window.__crawlHubSamplingResume = resume;
  attach();
  return { started: true };
}

function pauseElementSampling() {
  const result = window.__crawlHubSamplingPause?.() || { paused: false };
  if (result.paused && window.__crawlHubSamplingChanged) window.__crawlHubSamplingChanged();
  return result;
}

function resumeElementSampling() {
  const result = window.__crawlHubSamplingResume?.() || { resumed: false };
  if (result.resumed && window.__crawlHubSamplingChanged) window.__crawlHubSamplingChanged();
  return result;
}

function cancelElementSampling() {
  const selectedCount = Array.isArray(window.__crawlHubSelectedElements) ? window.__crawlHubSelectedElements.length : 0;
  if (window.__crawlHubSamplingCleanup) window.__crawlHubSamplingCleanup();
  window.__crawlHubSamplingActive = false;
  window.__crawlHubSamplingState = "idle";
  window.__crawlHubSelectedElements = [];
  if (window.__crawlHubSamplingChanged) window.__crawlHubSamplingChanged();
  return { cancelled: true, selected_count: selectedCount };
}

function stopElementSampling() {
  if (window.__crawlHubSamplingCleanup) window.__crawlHubSamplingCleanup();
  window.__crawlHubSamplingActive = false;
  window.__crawlHubSamplingState = "idle";
  return { stopped: true, selected_count: Array.isArray(window.__crawlHubSelectedElements) ? window.__crawlHubSelectedElements.length : 0 };
}

function installPanel() {
  const panelVersion = "collection-binding-v1";
  if (window.__crawlHubPanelHost) {
    if (window.__crawlHubPanelHost.dataset.crawlHubPanelVersion !== panelVersion) {
      stopElementSampling();
      window.__crawlHubPanelHost.remove();
      delete window.__crawlHubPanelHost;
    } else {
      window.__crawlHubPanelHost.style.display = "block";
      return { started: true, already_open: true };
    }
  }
  if (!Array.isArray(window.__crawlHubSelectedElements)) window.__crawlHubSelectedElements = [];
  const host = document.createElement("div");
  host.id = "crawlHubPanelHost";
  host.dataset.crawlHubPanelVersion = panelVersion;
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
      .panel { display: flex; max-height: calc(100vh - 32px); flex-direction: column; overflow: hidden; border: 1px solid #d9e0ed; border-radius: 10px; background: #f6f8fc; box-shadow: 0 8px 30px rgba(16, 24, 40, .22); }
      header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; color: #fff; background: #315efb; cursor: move; user-select: none; }
      header strong { flex: 1; font-size: 14px; }
      header button { width: 24px; height: 24px; border: 0; border-radius: 5px; color: #fff; background: rgba(255,255,255,.18); cursor: pointer; font-size: 16px; line-height: 20px; }
      header button.settings { font-size: 14px; }
      header button.reconnect { font-size: 15px; }
      .content { min-height: 0; flex: 1 1 auto; overflow: auto; padding: 12px; }
      .hint { margin-bottom: 10px; color: #667085; font-size: 12px; }
      .state { margin-bottom: 8px; font-weight: 600; }
      .state span { color: #16794c; }
      .state span[data-sampling-state="paused"] { color: #b54708; }
      .state span[data-sampling-state="idle"] { color: #667085; }
      .count { margin-bottom: 8px; color: #344054; }
      .field-summary { min-height: 20px; margin-bottom: 10px; color: #475467; font-size: 12px; }
      .samples { max-height: 180px; margin: 0 0 12px; padding: 0; overflow: auto; list-style: none; }
      .samples li { margin-top: 6px; border-radius: 6px; padding: 7px 8px; background: #fff; overflow-wrap: anywhere; }
      .samples li:first-child { margin-top: 0; }
      .actions { display: grid; gap: 7px; }
      .actions button { width: 100%; border: 0; border-radius: 7px; padding: 8px 10px; color: #fff; background: #315efb; cursor: pointer; font: inherit; font-weight: 600; }
      .actions button.secondary { color: #315efb; background: #e8edff; }
      .actions button:disabled { cursor: default; opacity: .6; }
      .actions button[hidden] { display: none; }
      .message { min-height: 18px; margin-top: 9px; color: #667085; font-size: 12px; white-space: pre-line; }
      .message.success { color: #16794c; }
      .message.error { color: #b42318; }
      .mode-switch { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-bottom: 10px; padding: 3px; border-radius: 7px; background: #e5eaf3; }
      .mode-switch button { border: 0; border-radius: 5px; padding: 7px 8px; color: #667085; background: transparent; cursor: pointer; font: inherit; font-weight: 600; }
      .mode-switch button.active { color: #315efb; background: #fff; box-shadow: 0 1px 3px rgba(16,24,40,.12); }
      .collection-card { border-radius: 7px; padding: 9px; background: #fff; color: #475467; }
      .collection-card strong { color: #172033; }
      .collection-card p { margin: 5px 0 0; }
      .collection-meta { margin: 9px 0; color: #344054; }
      .opportunity-summary { margin: 9px 0; padding: 10px; border-radius: 7px; color: #16794c; background: #ecfdf3; }
      .opportunity-summary p { margin: 0 0 7px; color: inherit; font-weight: 600; }
      .opportunity-summary ul { display: flex; flex-wrap: wrap; gap: 5px; margin: 5px 0 0; padding: 0; list-style: none; }
      .opportunity-summary li { padding: 3px 6px; border-radius: 4px; color: #16794c; background: #d1fadf; font-size: 12px; }
      .collection-advanced { margin: 9px 0; color: #475467; }
      .collection-advanced summary { cursor: pointer; color: #344054; font-weight: 600; }
      .collection-fields { max-height: 84px; margin: 0; padding: 0; overflow: auto; list-style: none; }
      .collection-fields li { margin-top: 4px; border-radius: 5px; padding: 5px 7px; background: #f6f8fc; overflow-wrap: anywhere; font-size: 12px; }
      .collection-fields li:first-child { margin-top: 0; }
      .collection-preview-table { max-height: 140px; margin-top: 7px; overflow: auto; border: 1px solid #e4e7ec; border-radius: 6px; background: #fff; }
      .collection-preview-table table { width: 100%; border-collapse: collapse; font-size: 11px; }
      .collection-preview-table th, .collection-preview-table td { min-width: 84px; max-width: 180px; padding: 6px; border-bottom: 1px solid #eaecf0; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
      .collection-preview-table th { position: sticky; top: 0; color: #344054; background: #f6f8fc; }
      .collection-preview-table td { color: #475467; }
      .collection-actions { position: sticky; bottom: -12px; z-index: 2; gap: 5px; padding: 7px 0 12px; background: #f6f8fc; }
      .collection-actions button { padding: 6px 8px; }
      .export-options { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
      .export-options[hidden] { display: none; }
      .binding-card { border-radius: 7px; padding: 10px; background: #fff; color: #475467; }
      .binding-card p { margin: 6px 0 10px; }
      .binding-input { width: 100%; border: 1px solid #d0d5dd; border-radius: 6px; padding: 8px; color: #172033; background: #fff; font: inherit; }
      .binding-count, .binding-status { min-height: 18px; margin-top: 9px; color: #667085; font-size: 12px; }
      .binding-search { margin-top: 12px; padding-top: 12px; border-top: 1px solid #eaecf0; }
      .binding-search[hidden] { display: none; }
      .view[hidden], .content[hidden] { display: none; }
    </style>
    <div class="panel">
      <header><strong>CrawlHub 页面分析</strong><button id="exportSettings" class="settings" title="设置默认导出目录">⚙</button><button id="reconnectPage" class="reconnect" title="重新连接页面">↻</button><button id="minimize" title="最小化">−</button><button id="close" title="关闭">×</button></header>
      <div id="content" class="content">
        <div class="hint">数据仅在本地处理，不记录响应内容。</div>
        <div class="mode-switch" role="tablist" aria-label="工作模式">
          <button id="analysisMode" class="active" type="button">页面分析</button>
          <button id="collectionMode" type="button">数据采集</button>
          <button id="bindingMode" type="button">商品绑定</button>
        </div>
        <div id="analysisView" class="view">
          <div class="state">当前状态：<span id="state">待机</span></div>
          <div class="count">已选择元素：<strong id="count">0</strong></div>
          <div id="fieldSummary" class="field-summary">已选择字段摘要：暂无</div>
          <ul id="samples" class="samples"></ul>
          <div class="actions">
            <button id="sample">开始元素采样</button>
            <button id="pauseSampling" class="secondary" hidden>暂停采样</button>
            <button id="resumeSampling" class="secondary" hidden>继续采样</button>
            <button id="cancelSampling" class="secondary" hidden>取消采样</button>
            <button id="observe" class="secondary">监听后续网络请求</button>
            <button id="analyze" class="secondary">分析并下载 analysis.json</button>
          </div>
        </div>
        <div id="collectionView" class="view" hidden>
          <div class="collection-card">
            <strong id="collectionTitle">当前页数据提取验证</strong>
            <p id="collectionHint">根据表头和行列关系生成字段模板，提取当前已加载的表格或列表数据。</p>
            <div id="rankSummary" class="opportunity-summary" hidden><p>✓ 页面已识别</p><p>页面：TikTok 热卖商品榜</p><p id="rankType">当前榜单：未识别</p><p>采集模式：分页采集</p><p id="rankState">状态：等待采集</p></div>
            <div id="opportunitySummary" class="opportunity-summary" hidden><p>✓ 页面已识别</p><p>页面：TikTok 商品机会 - 热门关键词</p><p id="opportunityState">状态：等待采集</p><strong>已识别字段：</strong><ul><li>关键词</li><li>类目</li><li>线索来源</li><li>搜索次数</li><li>在售商品</li></ul></div>
            <details id="collectionAdvanced" class="collection-advanced"><summary>高级信息</summary><div id="collectionDiagnostics">
              <div id="collectionState" class="collection-meta">尚未采集</div>
              <div id="taskStatus" class="collection-meta">当前任务：未创建</div>
              <div id="metadataStatus" class="collection-meta">metadata：等待采样顶部类目标签</div>
              <div id="exportRootStatus" class="collection-meta">默认导出目录：未设置（请点击齿轮设置）</div>
              <div id="paginationStatus" class="collection-meta">分页状态：未识别</div>
              <ul id="collectionFields" class="collection-fields"><li>字段模板：未生成</li></ul>
              <div id="collectionPreviewTable" class="collection-preview-table">点击“采集当前页”查看示例数据。</div>
              <div id="templateStatus" class="collection-meta">字段模板尚未保存</div>
            </div></details>
          </div>
          <div class="actions collection-actions" style="margin-top: 7px;">
            <button id="collectCollection">采集当前页</button>
            <button id="pauseCollectionTask" class="secondary" hidden>暂停采集</button>
            <button id="cancelCollectionTask" class="secondary" hidden>取消当前任务</button>
            <button id="exportProject" class="secondary">导出项目</button>
            <button id="saveCollectionTemplate" class="secondary">保存字段模板</button>
            <button id="clearCollectionData" class="secondary">清除采集数据</button>
          </div>
        </div>
        <div id="bindingView" class="view" hidden>
          <div class="binding-card">
            <strong>商品绑定</strong>
            <p>扫描商品机会后，可快速定位对应关键词。</p>
            <div id="bindingScanState" class="binding-status">尚未扫描</div>
            <div id="bindingLoaded" class="binding-count" hidden>已加载：0</div>
            <div class="actions" style="margin-top: 9px;"><button id="scanBinding" type="button">扫描商品机会</button></div>
            <div class="actions" style="margin-top: 7px;"><button id="pause_scan_task" class="secondary" type="button" hidden>暂停扫描</button></div>
            <div id="bindingSearch" class="binding-search" hidden>
              <input id="bindingKeyword" class="binding-input" type="text" autocomplete="off" placeholder="请输入完整关键词" />
              <div class="actions" style="margin-top: 9px;"><button id="locateBinding" type="button">定位并打开</button></div>
              <div id="bindingLocateState" class="binding-status"></div>
            </div>
            <div id="autoReportTest" class="binding-search" hidden>
              <strong>自动提报（测试）</strong>
              <input id="autoReportKeyword" class="binding-input" type="text" autocomplete="off" placeholder="请输入完整关键词" style="margin-top: 9px;" />
              <input id="autoReportProductId" class="binding-input" type="text" inputmode="numeric" autocomplete="off" placeholder="请输入商品 ID" style="margin-top: 7px;" />
              <div class="actions" style="margin-top: 9px;"><button id="startAutoReport" type="button">开始自动提报</button></div>
              <div id="autoReportState" class="binding-status"></div>
            </div>
          </div>
        </div>
        <div id="message" class="message"></div>
      </div>
    </div>`;
  document.documentElement.appendChild(host);
  window.__crawlHubPanelHost = host;

  const content = shadow.querySelector("#content");
  const exportSettingsButton = shadow.querySelector("#exportSettings");
  const reconnectPageButton = shadow.querySelector("#reconnectPage");
  const analysisView = shadow.querySelector("#analysisView");
  const collectionView = shadow.querySelector("#collectionView");
  const bindingView = shadow.querySelector("#bindingView");
  const analysisModeButton = shadow.querySelector("#analysisMode");
  const collectionModeButton = shadow.querySelector("#collectionMode");
  const bindingModeButton = shadow.querySelector("#bindingMode");
  const bindingKeywordInput = shadow.querySelector("#bindingKeyword");
  const bindingScanButton = shadow.querySelector("#scanBinding");
  const pauseScanTaskButton = shadow.querySelector("#pause_scan_task");
  const bindingScanState = shadow.querySelector("#bindingScanState");
  const bindingLoaded = shadow.querySelector("#bindingLoaded");
  const bindingSearch = shadow.querySelector("#bindingSearch");
  const bindingLocateButton = shadow.querySelector("#locateBinding");
  const bindingLocateState = shadow.querySelector("#bindingLocateState");
  const autoReportTest = shadow.querySelector("#autoReportTest");
  const autoReportKeywordInput = shadow.querySelector("#autoReportKeyword");
  const autoReportProductIdInput = shadow.querySelector("#autoReportProductId");
  const startAutoReportButton = shadow.querySelector("#startAutoReport");
  const autoReportState = shadow.querySelector("#autoReportState");
  const collectionTitle = shadow.querySelector("#collectionTitle");
  const collectionHint = shadow.querySelector("#collectionHint");
  const rankSummary = shadow.querySelector("#rankSummary");
  const rankType = shadow.querySelector("#rankType");
  const rankState = shadow.querySelector("#rankState");
  const opportunitySummary = shadow.querySelector("#opportunitySummary");
  const opportunityState = shadow.querySelector("#opportunityState");
  const collectionAdvanced = shadow.querySelector("#collectionAdvanced");
  const collectionState = shadow.querySelector("#collectionState");
  const taskStatus = shadow.querySelector("#taskStatus");
  const metadataStatus = shadow.querySelector("#metadataStatus");
  const exportRootStatus = shadow.querySelector("#exportRootStatus");
  const paginationStatus = shadow.querySelector("#paginationStatus");
  const collectionFields = shadow.querySelector("#collectionFields");
  const collectionPreviewTable = shadow.querySelector("#collectionPreviewTable");
  const templateStatus = shadow.querySelector("#templateStatus");
  const collectCollectionButton = shadow.querySelector("#collectCollection");
  const pauseCollectionTaskButton = shadow.querySelector("#pauseCollectionTask");
  const cancelCollectionTaskButton = shadow.querySelector("#cancelCollectionTask");
  const exportProjectButton = shadow.querySelector("#exportProject");
  const saveCollectionTemplateButton = shadow.querySelector("#saveCollectionTemplate");
  const clearCollectionDataButton = shadow.querySelector("#clearCollectionData");
  const stateText = shadow.querySelector("#state");
  const countText = shadow.querySelector("#count");
  const fieldSummary = shadow.querySelector("#fieldSummary");
  const samples = shadow.querySelector("#samples");
  const sampleButton = shadow.querySelector("#sample");
  const pauseSamplingButton = shadow.querySelector("#pauseSampling");
  const resumeSamplingButton = shadow.querySelector("#resumeSampling");
  const cancelSamplingButton = shadow.querySelector("#cancelSampling");
  const observeButton = shadow.querySelector("#observe");
  const analyzeButton = shadow.querySelector("#analyze");
  const message = shadow.querySelector("#message");
  let opportunityCollectionState = "idle";
  let opportunityCollectionCount = 0;
  let bindingScanBusy = false;
  let bindingLocateBusy = false;
  let autoReportBusy = false;
  let previousCollectionPageType = null;
  const header = shadow.querySelector("header");
  const dragState = { active: false, offsetX: 0, offsetY: 0, htmlUserSelect: "", bodyUserSelect: "" };
  const stopPanelDrag = () => {
    if (!dragState.active) return;
    dragState.active = false;
    document.documentElement.style.userSelect = dragState.htmlUserSelect;
    if (document.body) document.body.style.userSelect = dragState.bodyUserSelect;
    document.removeEventListener("mousemove", movePanel);
    document.removeEventListener("mouseup", stopPanelDrag);
  };
  const movePanel = (event) => {
    if (!dragState.active) return;
    const maxLeft = Math.max(0, window.innerWidth - host.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - host.offsetHeight);
    host.style.left = `${Math.min(Math.max(0, event.clientX - dragState.offsetX), maxLeft)}px`;
    host.style.top = `${Math.min(Math.max(0, event.clientY - dragState.offsetY), maxTop)}px`;
  };
  header.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button"))) return;
    const rect = host.getBoundingClientRect();
    dragState.active = true;
    dragState.offsetX = event.clientX - rect.left;
    dragState.offsetY = event.clientY - rect.top;
    dragState.htmlUserSelect = document.documentElement.style.userSelect;
    dragState.bodyUserSelect = document.body?.style.userSelect || "";
    document.documentElement.style.userSelect = "none";
    if (document.body) document.body.style.userSelect = "none";
    host.style.left = `${rect.left}px`;
    host.style.top = `${rect.top}px`;
    host.style.right = "auto";
    event.preventDefault();
    document.addEventListener("mousemove", movePanel);
    document.addEventListener("mouseup", stopPanelDrag);
  });

  const setMessage = (text, kind = "") => {
    message.textContent = text;
    message.className = `message ${kind}`.trim();
  };
  const renderExportRootStatus = () => {
    exportRootStatus.textContent = "默认导出目录：读取中…";
    readExportRootDirectory().then((handle) => {
      exportRootStatus.textContent = handle ? `默认导出目录：${handle.name}` : "默认导出目录：未设置（请点击齿轮设置）";
    }).catch(() => {
      exportRootStatus.textContent = "默认导出目录：设置读取失败（请点击齿轮重新设置）";
    });
  };
  const renderFieldTemplate = (fields) => {
    collectionFields.replaceChildren();
    if (!fields.length) {
      const row = document.createElement("li");
      row.textContent = "字段模板：未生成";
      collectionFields.appendChild(row);
      return;
    }
    fields.forEach((field) => {
      const row = document.createElement("li");
      row.textContent = `${field.label}：${field.available ? `来自“${field.source_header}”` : "未匹配"}`;
      collectionFields.appendChild(row);
    });
  };
  const renderCollection = () => {
    renderExportRootStatus();
    const result = window.__crawlHubCollectionPreview;
    const manualState = window.__crawlHubManualCollectionState;
    const activeTask = window.__crawlHubActiveTask;
    const pageType = detectCollectionPageType();
    const isOpportunity = pageType === "product_opportunity";
    const visibleRankType = () => {
      const labels = ["总榜", "直播榜", "短视频榜", "商品卡", "达人榜", "新品榜"];
      return Array.from(document.querySelectorAll("[role='tab'], button, a, [class*='tab']")).find((element) => {
        const text = String(element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
        if (!labels.includes(text)) return false;
        for (let current = element, depth = 0; current && depth < 3; current = current.parentElement, depth += 1) {
          if (current.getAttribute("aria-selected") === "true" || current.getAttribute("aria-current") === "page" || /(?:^|[-_\s])(active|selected|current)(?:$|[-_\s])/i.test(String(current.className || ""))) return true;
        }
        return false;
      })?.textContent?.replace(/\s+/g, " ").trim() || null;
    };
    const opportunityStateLabel = opportunityCollectionState === "active" ? "采集中" : opportunityCollectionState === "paused" ? "已暂停" : opportunityCollectionState === "completed" ? "已完成" : opportunityCollectionState === "stopped" ? "已停止" : "待开始";
    const opportunityUserState = opportunityCollectionState === "active"
      ? `正在滚动采集 · 已采集 ${opportunityCollectionCount} 条`
      : opportunityCollectionState === "completed"
      ? `采集完成 · 总数量 ${opportunityCollectionCount} 条`
      : `准备采集 · 已采集 ${opportunityCollectionCount} 条`;
    const rankUserState = window.__crawlHubCollectionBusy
      ? "正在采集"
      : activeTask?.status === "paused" || activeTask?.status === "cancelled"
      ? "等待采集"
      : result ? "已完成" : "等待采集";
    rankSummary.hidden = isOpportunity;
    opportunitySummary.hidden = !isOpportunity;
    collectionTitle.hidden = true;
    collectionHint.hidden = true;
    collectionAdvanced.classList.remove("rank-diagnostics");
    if (!isOpportunity) {
      rankType.textContent = `当前榜单：${visibleRankType() || activeTask?.rank_type || result?.metadata?.rank_type || "未识别"}`;
      rankState.textContent = `状态：${rankUserState}`;
    }
    if (isOpportunity) opportunityState.textContent = `状态：${opportunityUserState}`;
    if (previousCollectionPageType !== pageType) collectionAdvanced.open = false;
    previousCollectionPageType = pageType;
    collectCollectionButton.textContent = "开始采集";
    collectCollectionButton.disabled = Boolean(window.__crawlHubCollectionBusy);
    saveCollectionTemplateButton.hidden = true;
    const taskStatusLabel = activeTask?.status === "paused" ? "已暂停" : activeTask?.status === "cancelled" ? "已结束" : "采集中";
    taskStatus.textContent = isOpportunity
      ? `当前任务：product_opportunity · ${opportunityStateLabel}`
      : activeTask
      ? `当前任务：${activeTask.label} · ${taskStatusLabel} · 已采集${activeTask.collected_count || result?.item_count || 0}条`
      : "当前任务：未创建";
    pauseCollectionTaskButton.hidden = false;
    pauseCollectionTaskButton.textContent = isOpportunity ? opportunityCollectionState === "paused" ? "继续采集" : "暂停" : activeTask?.status === "paused" ? "继续采集" : "暂停";
    pauseCollectionTaskButton.disabled = isOpportunity
      ? !["active", "paused"].includes(opportunityCollectionState)
      : Boolean(window.__crawlHubCollectionBusy) || !activeTask || activeTask.status === "cancelled";
    cancelCollectionTaskButton.hidden = false;
    cancelCollectionTaskButton.textContent = "停止";
    cancelCollectionTaskButton.disabled = isOpportunity
      ? !["active", "paused"].includes(opportunityCollectionState)
      : Boolean(window.__crawlHubCollectionBusy) || !activeTask || activeTask.status === "cancelled";
    const fieldTemplate = result?.field_template || (isOpportunity ? [] : window.__crawlHubCollectionFieldTemplate || []);
    const pageState = detectPaginationState();
    const pageText = isOpportunity
      ? "页面类型：product_opportunity"
      : pageState.current_page && pageState.total_pages
      ? `当前：第${pageState.current_page}页 / ${pageState.total_pages}页`
      : "分页状态：未识别";
    paginationStatus.textContent = pageText;
    if (!result) {
      collectionState.textContent = isOpportunity ? `商品机会模式：${opportunityStateLabel}（自动滚动采集）` : "尚未采集";
      metadataStatus.textContent = isOpportunity ? "页面识别：product_opportunity（关键词表头已匹配）" : "metadata：采集当前页时自动读取页面信息";
      renderFieldTemplate(fieldTemplate);
      collectionPreviewTable.textContent = isOpportunity ? "已识别商品机会页面；点击“开始采集”将自动滚动并采集关键词。" : fieldTemplate.length ? "字段模板已保留，点击“采集当前页”生成新结果。" : "点击“采集当前页”查看示例数据。";
      try {
        templateStatus.textContent = localStorage.getItem("crawlHub.collectionTemplate.v1") ? "已有本地保存的字段模板" : fieldTemplate.length ? "当前字段模板已保留，尚未保存" : "字段模板尚未保存";
      } catch {
        templateStatus.textContent = "当前页面不允许保存字段模板";
      }
      collectCollectionButton.disabled = Boolean(window.__crawlHubCollectionBusy);
      exportProjectButton.disabled = true;
      saveCollectionTemplateButton.disabled = !fieldTemplate.length;
      clearCollectionDataButton.disabled = true;
      return;
    }
    const sourceLabel = result.source_type === "product_opportunity" ? "商品机会当前页" : result.source_type === "table" ? "表格" : result.source_type === "list" ? "列表" : result.source_type === "paginated_table" || result.source_type === "manual_paginated_table" ? "分页表格" : result.source_type === "restored_session" ? "已恢复项目" : "未找到可提取的表格或列表";
    collectionState.textContent = isOpportunity
      ? `✓ 商品机会已采集 ${result.item_count} 条`
      : manualState?.last_page
      ? `✓ 第${manualState.last_page}页完成 · 已采集${result.item_count}条 · 已保存到本地项目${manualState.duplicate ? "（本页已采集，未重复计数）" : ""}`
      : `${sourceLabel} · 当前页商品/条目数量：${result.item_count}`;
    metadataStatus.textContent = result.metadata?.category_full === "未识别"
      ? "metadata 类目：未识别（仍可导出项目）"
      : `metadata 类目：${result.metadata.category_full}`;
    renderFieldTemplate(result.field_template);
    collectionPreviewTable.replaceChildren();
    if (result.preview_records.length) {
      const fields = result.field_template.filter((field) => field.available && result.preview_records.some((record) => Object.prototype.hasOwnProperty.call(record, field.label)));
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");
      fields.forEach((field) => {
        const cell = document.createElement("th");
        cell.textContent = field.label;
        headerRow.appendChild(cell);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      result.preview_records.forEach((record) => {
        const row = document.createElement("tr");
        fields.forEach((field) => {
          const cell = document.createElement("td");
          cell.textContent = String(record[field.label] ?? "");
          row.appendChild(cell);
        });
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      collectionPreviewTable.appendChild(table);
    } else {
      collectionPreviewTable.textContent = "当前页面未识别到可提取的表格或列表数据。";
    }
    try {
      templateStatus.textContent = localStorage.getItem("crawlHub.collectionTemplate.v1") ? "已有本地保存的字段模板" : "字段模板尚未保存";
    } catch {
      templateStatus.textContent = "当前页面不允许保存字段模板";
    }
    collectCollectionButton.disabled = false;
    exportProjectButton.disabled = !result.records.length;
    saveCollectionTemplateButton.disabled = !result.field_template.length;
    clearCollectionDataButton.disabled = false;
  };
  const renderBinding = () => {
    const session = window.__crawlHubBindingSession;
    const scanControl = window.__crawlHubBindingScanControl;
    bindingScanButton.disabled = bindingScanBusy;
    bindingLocateButton.disabled = bindingLocateBusy;
    startAutoReportButton.disabled = autoReportBusy;
    if (!session) {
      bindingScanState.textContent = "尚未扫描";
      bindingLoaded.hidden = true;
      pauseScanTaskButton.hidden = true;
      bindingSearch.hidden = true;
      autoReportTest.hidden = true;
      return;
    }
    if (session.state === "scanning") {
      bindingScanState.textContent = session.phase === "paused" ? "扫描已暂停" : session.phase === "loading" ? "正在加载更多..." : "正在扫描商品机会...";
      bindingLoaded.hidden = false;
      bindingLoaded.textContent = `已发现：${session.loaded_count || 0}`;
      pauseScanTaskButton.hidden = !scanControl?.active;
      pauseScanTaskButton.textContent = session.phase === "paused" ? "继续扫描" : "暂停扫描";
      pauseScanTaskButton.disabled = false;
      bindingSearch.hidden = true;
      autoReportTest.hidden = true;
      return;
    }
    if (session.state === "error") {
      bindingScanState.textContent = session.error || "暂时无法扫描商品机会。";
      bindingLoaded.hidden = true;
      pauseScanTaskButton.hidden = true;
      bindingSearch.hidden = true;
      autoReportTest.hidden = true;
      return;
    }
    bindingScanState.textContent = "扫描完成";
    bindingLoaded.hidden = false;
    bindingLoaded.textContent = `已发现：${session.loaded_count} 个商品机会`;
    pauseScanTaskButton.hidden = true;
    bindingSearch.hidden = false;
    autoReportTest.hidden = false;
  };
  const reconnectPage = async () => {
    setMessage("正在检查页面连接…");
    try {
      await checkExtensionConnection();
      setMessage("页面连接成功，可以继续采集", "success");
      return true;
    } catch {
      markReconnectPending();
      setMessage("检测到插件更新，正在重新连接当前页面…", "success");
      if (typeof window.location?.reload === "function") setTimeout(() => window.location.reload(), 60);
      return false;
    }
  };
  window.__crawlHubCollectionRender = renderCollection;
  let checkedDetectedTaskChange = false;
  const checkDetectedTaskChange = async () => {
    if (checkedDetectedTaskChange || detectCollectionPageType() !== "product_opportunity") return;
    checkedDetectedTaskChange = true;
    setMode("collection");
    resetProductOpportunityCollectionSession();
    opportunityCollectionState = "idle";
    opportunityCollectionCount = 0;
    renderCollection();
    setMessage("已识别商品机会页面，准备开始新的采集。", "success");
  };
  const setMode = (mode) => {
    window.__crawlHubMode = mode;
    const isAnalysis = mode === "analysis";
    const isCollection = mode === "collection";
    const isBinding = mode === "binding";
    analysisView.hidden = !isAnalysis;
    collectionView.hidden = !isCollection;
    bindingView.hidden = !isBinding;
    analysisModeButton.classList.toggle("active", isAnalysis);
    collectionModeButton.classList.toggle("active", isCollection);
    bindingModeButton.classList.toggle("active", isBinding);
    host.style.width = "360px";
    if (!isAnalysis && window.__crawlHubSamplingActive) stopElementSampling();
    render();
    renderCollection();
    renderBinding();
  };
  const render = () => {
    const selected = Array.isArray(window.__crawlHubSelectedElements) ? window.__crawlHubSelectedElements : [];
    countText.textContent = String(selected.length);
    const samplingState = window.__crawlHubSamplingState || (window.__crawlHubSamplingActive ? "sampling" : "idle");
    stateText.textContent = samplingState === "sampling" ? "元素采样中" : samplingState === "paused" ? "已暂停" : "待机";
    stateText.dataset.samplingState = samplingState;
    const fields = Array.from(new Set(selected.flatMap((item) => item.possible_field_types || [])));
    fieldSummary.textContent = `已选择字段摘要：${fields.length ? fields.join("、") : "暂无"}`;
    samples.replaceChildren();
    selected.forEach((item, index) => {
      const row = document.createElement("li");
      row.textContent = `${index + 1}. ${item.tag} · ${item.possible_field_types?.join("/") || "text"} · ${item.text || item.selector}`;
      samples.appendChild(row);
    });
    sampleButton.textContent = samplingState === "idle" ? "开始元素采样" : "完成采样并生成报告";
    sampleButton.disabled = samplingState === "paused";
    pauseSamplingButton.hidden = samplingState !== "sampling";
    resumeSamplingButton.hidden = samplingState !== "paused";
    cancelSamplingButton.hidden = samplingState === "idle";
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
    setMessage(detectCollectionPageType() === "product_opportunity" ? "已识别商品机会页面，可开始自动滚动采集。" : "可提取当前页已加载的数据；不会翻页或发送页面数据。", "success");
  });
  bindingModeButton.addEventListener("click", () => {
    setMode("binding");
  });
  bindingScanButton.addEventListener("click", async () => {
    if (bindingScanBusy) return;
    bindingScanBusy = true;
    const scanControl = { active: true, paused: false, cancelled: false };
    window.__crawlHubBindingScanControl = scanControl;
    bindingKeywordInput.value = "";
    bindingLocateState.textContent = "";
    window.__crawlHubBindingSession = { state: "scanning", entries: [], loaded_count: 0 };
    renderBinding();
    await waitForPageUpdate(0);
    try {
      await scanProductOpportunityBindingIndex(renderBinding, scanControl);
    } catch (error) {
      window.__crawlHubBindingSession = { state: "error", entries: [], loaded_count: 0, error: error.message || "暂时无法扫描商品机会。" };
    } finally {
      scanControl.active = false;
      scanControl.paused = false;
      bindingScanBusy = false;
      renderBinding();
    }
  });
  pauseScanTaskButton.addEventListener("click", () => {
    const scanControl = window.__crawlHubBindingScanControl;
    if (!scanControl?.active) return;
    scanControl.paused = !scanControl.paused;
    const session = window.__crawlHubBindingSession;
    if (session?.state === "scanning") {
      session.phase = scanControl.paused ? "paused" : "scanning";
    }
    renderBinding();
  });
  bindingLocateButton.addEventListener("click", async () => {
    const keyword = compactOpportunityText(bindingKeywordInput.value);
    if (!keyword) {
      bindingLocateState.textContent = "请输入关键词。";
      return;
    }
    if (bindingLocateBusy) return;
    bindingLocateBusy = true;
    bindingLocateState.textContent = "正在定位...";
    renderBinding();
    try {
      const entry = await openExistingProductBinding(keyword);
      bindingLocateState.textContent = entry.category
        ? `已打开：${entry.keyword}（${entry.category}）的绑定入口`
        : `已打开：${entry.keyword}的绑定入口`;
    } catch (error) {
      bindingLocateState.textContent = error.message || "未找到该商品机会关键词。";
    } finally {
      bindingLocateBusy = false;
      renderBinding();
    }
  });
  startAutoReportButton.addEventListener("click", async () => {
    const keyword = compactOpportunityText(autoReportKeywordInput.value);
    const productId = compactOpportunityText(autoReportProductIdInput.value);
    if (!keyword) {
      autoReportState.textContent = "请输入关键词。";
      return;
    }
    if (!productId) {
      autoReportState.textContent = "请输入商品 ID。";
      return;
    }
    if (autoReportBusy) return;
    autoReportBusy = true;
    autoReportState.textContent = "正在准备提报...";
    renderBinding();
    try {
      await runSingleProductAutoReport(keyword, productId, (status) => {
        autoReportState.textContent = status;
      });
    } catch (error) {
      autoReportState.textContent = error.message || "自动提报未完成。";
    } finally {
      autoReportBusy = false;
      renderBinding();
    }
  });
  exportSettingsButton.addEventListener("click", async () => {
    try {
      if (typeof window.showDirectoryPicker !== "function") throw new Error("当前浏览器不支持目录选择，请使用最新版 Chrome。");
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      await saveExportRootDirectory(handle);
      renderExportRootStatus();
      setMessage(`默认导出目录已设置为“${handle.name}”，之后可通过齿轮修改。`, "success");
    } catch (error) {
      if (error?.name === "AbortError") {
        setMessage("已取消设置导出目录。", "success");
        return;
      }
      setMessage(`设置导出目录失败：${error.message || "无法保存设置"}`, "error");
    }
  });
  reconnectPageButton.addEventListener("click", reconnectPage);
  collectCollectionButton.addEventListener("click", async () => {
    if (detectCollectionPageType() === "product_opportunity") {
      try {
        setMessage("正在检查页面连接…");
        try {
          await checkExtensionConnection();
        } catch {
          await reconnectPage();
          return;
        }
        startFreshProductOpportunityTask();
        opportunityCollectionState = "active";
        opportunityCollectionCount = 0;
        window.__crawlHubCollectionBusy = true;
        renderCollection();
        const scrollContainer = findProductOpportunityScrollContainer();
        if (!scrollContainer) throw new Error("未找到商品机会列表的可滚动容器。");
        const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
        const canContinue = async () => {
          while (opportunityCollectionState === "paused") await wait(250);
          return opportunityCollectionState !== "stopped";
        };
        const scanResult = await scanProductOpportunityScroll({
          container: scrollContainer,
          shouldContinue: canContinue,
          collect: async () => {
            const countBeforeCollect = opportunityCollectionCount;
            const collected = await collectCurrentPage();
            opportunityCollectionCount = collected.result.item_count;
            renderCollection();
            return { total_count: opportunityCollectionCount, added_count: Math.max(0, opportunityCollectionCount - countBeforeCollect) };
          },
          onProgress: ({ total_count: totalCount }) => {
            setMessage(`正在滚动采集，已采集 ${totalCount} 条…`);
          }
        });
        if (scanResult.stopped || opportunityCollectionState === "stopped") {
          setMessage(`商品机会采集已停止，已采集 ${opportunityCollectionCount} 条。`, "success");
          return;
        }
        if (!scanResult.completed) throw new Error("未能确认商品机会列表已滚动到底部，请稍后重试。");
        opportunityCollectionState = "completed";
        renderCollection();
        setMessage(`✓ 商品机会采集完成：共 ${opportunityCollectionCount} 条，已保存到本地项目。`, "success");
      } catch (error) {
        opportunityCollectionState = "stopped";
        setMessage(`商品机会采集失败：${error.message || "无法读取当前可见数据"}`, "error");
      } finally {
        window.__crawlHubCollectionBusy = false;
        renderCollection();
      }
      return;
    }
    if (window.__crawlHubActiveTask?.status === "paused") {
      setMessage("当前任务已暂停，请先点击“继续采集”。", "error");
      return;
    }
    try {
      setMessage("正在检查页面连接…");
      try {
        await checkExtensionConnection();
      } catch {
        await reconnectPage();
        return;
      }
      setMessage("采集中…");
      window.__crawlHubCollectionBusy = true;
      renderCollection();
      collectCollectionButton.disabled = true;
      const collected = await collectCurrentPage();
      if (collected.cancelled) {
        renderCollection();
        setMessage("已取消新采集任务，原采集结果保留。", "success");
        return;
      }
      renderCollection();
      setMessage(collected.duplicate ? "✓ 当前页完成：本页已采集，未重复计数，已保存到本地项目。" : `✓ 当前页完成：已采集 ${collected.result.item_count} 条，已保存到本地项目。`, "success");
    } catch (error) {
      setMessage(`提取失败：${error.message || "无法读取当前页面"}`, "error");
    } finally {
      window.__crawlHubCollectionBusy = false;
      collectCollectionButton.disabled = false;
      renderCollection();
    }
  });
  pauseCollectionTaskButton.addEventListener("click", async () => {
    if (detectCollectionPageType() === "product_opportunity") {
      opportunityCollectionState = opportunityCollectionState === "paused" ? "active" : "paused";
      renderCollection();
      setMessage(opportunityCollectionState === "paused" ? "商品机会采集已暂停。" : "商品机会采集已继续。", "success");
      return;
    }
    const task = window.__crawlHubActiveTask;
    if (!task) return;
    const nextStatus = task.status === "paused" ? "active" : "paused";
    try {
      await saveCurrentTaskStatus(nextStatus);
      renderCollection();
      setMessage(nextStatus === "paused" ? "采集已暂停，当前进度已保留。" : "采集已继续，可以采集下一页。", "success");
    } catch (error) {
      setMessage(`任务状态保存失败：${error.message || "无法保存当前进度"}`, "error");
    }
  });
  cancelCollectionTaskButton.addEventListener("click", async () => {
    if (detectCollectionPageType() === "product_opportunity") {
      opportunityCollectionState = "stopped";
      renderCollection();
      setMessage("商品机会采集已停止。", "success");
      return;
    }
    const task = window.__crawlHubActiveTask;
    if (!task) return;
    const confirmed = window.confirm("确认结束当前采集任务？\n已有数据会保留，之后可再次切换回来继续采集。");
    if (!confirmed) return;
    try {
      await saveCurrentTaskStatus("cancelled");
      renderCollection();
      setMessage("当前任务已结束，已有数据已保留。", "success");
    } catch (error) {
      setMessage(`任务结束失败：${error.message || "无法保存当前进度"}`, "error");
    }
  });
  exportProjectButton.addEventListener("click", async () => {
    try {
      setMessage("请选择项目保存位置…");
      const exported = await exportCollectionProject();
      setMessage(`项目已导出：\n${exported.file_name}（${exported.product_count}条）\n\n位置：\n${exported.location}`, "success");
    } catch (error) {
      if (error?.name === "AbortError") {
        setMessage("已取消选择保存位置。", "success");
        return;
      }
      setMessage(`项目导出失败：${error.message || "无法导出"}`, "error");
    }
  });
  clearCollectionDataButton.addEventListener("click", () => {
    if (detectCollectionPageType() === "product_opportunity") {
      resetProductOpportunityCollectionSession();
      opportunityCollectionState = "idle";
      opportunityCollectionCount = 0;
      renderCollection();
      setMessage("商品机会采集数据已清除，可以从 0 开始新的采集。", "success");
      return;
    }
    if (!window.__crawlHubCollectionPreview && !window.__crawlHubManualCollectionPages?.length) return;
    const confirmed = window.confirm("确认清除当前采集结果？\n\n将删除：\n- 已采集数据\n- 当前进度\n\n不会删除字段模板。");
    if (!confirmed) return;
    clearCollectionData();
    renderCollection();
    setMessage("采集数据已清除，字段模板已保留。", "success");
  });
  saveCollectionTemplateButton.addEventListener("click", () => {
    try {
      saveCollectionTemplate();
      templateStatus.textContent = "字段模板已保存到当前网站本地存储";
      setMessage("字段模板已保存，仅保留字段映射，不保存页面数据。", "success");
    } catch (error) {
      setMessage(`模板保存失败：${error.message || "无法保存"}`, "error");
    }
  });
  sampleButton.addEventListener("click", () => {
    if (window.__crawlHubSamplingState === "sampling") {
      stopElementSampling();
      render();
      downloadReport();
      return;
    }
    if (window.__crawlHubSamplingState === "paused") return;
    startElementSampling();
    render();
    setMessage("采样中：可点击页面元素；需要移动页面时点击“暂停采样”。");
  });
  pauseSamplingButton.addEventListener("click", () => {
    const result = pauseElementSampling();
    if (result.paused) setMessage(`采样已暂停，已保留 ${result.selected_count} 个元素。现在可以滚动和操作页面。`, "success");
  });
  resumeSamplingButton.addEventListener("click", () => {
    const result = resumeElementSampling();
    if (result.resumed) setMessage(`已继续采样，当前保留 ${result.selected_count} 个元素。`, "success");
  });
  cancelSamplingButton.addEventListener("click", () => {
    const result = cancelElementSampling();
    setMessage(`已取消采样，本轮未完成的 ${result.selected_count} 个元素已清除。`, "success");
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
    stopPanelDrag();
    stopElementSampling();
    host.remove();
    delete window.__crawlHubPanelHost;
    delete window.__crawlHubSamplingChanged;
    delete window.__crawlHubCollectionRender;
  });
  setMode(window.__crawlHubMode || "analysis");
  void checkDetectedTaskChange();
  return { started: true, already_open: false };
}

window.__crawlHub = { analyzePage, collectPageData, detectPaginationState, detectProductOpportunityTable, detectCollectionPageType, collectProductOpportunityData, scanProductOpportunityScroll, scanProductOpportunityBindingIndex, locateProductOpportunityKeyword, isTrendingKeywordsOpportunityPage, collectCurrentPage, clearCollectionData, collectionCsv, collectionXlsx, collectionProjectData, exportCollectionProject, saveCollectionTemplate, startNetworkObserver, startElementSampling, pauseElementSampling, resumeElementSampling, cancelElementSampling, stopElementSampling, installPanel };

restoreCollectionSession();
try {
  if (sessionStorage.getItem("crawlHub.reconnect.pending") === "1") {
    sessionStorage.removeItem("crawlHub.reconnect.pending");
    setTimeout(() => window.__crawlHub.installPanel(), 0);
  }
} catch { }

})();
