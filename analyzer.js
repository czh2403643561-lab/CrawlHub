(() => {

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
    { key: "shop", label: "店铺", aliases: ["店铺名称", "店铺", "shop name", "shop", "store", "seller"], kind: "text" },
    { key: "similar_product_count", label: "同款商品数", aliases: ["同款商品数", "同款数", "similar product count", "similar products", "similar items"], kind: "metric" }
  ];
  const headerScore = (header, aliases) => {
    const normalized = normalizeHeader(header);
    return aliases.reduce((best, alias) => {
      const candidate = normalizeHeader(alias);
      if (!candidate) return best;
      if (normalized === candidate) return Math.max(best, 100 + candidate.length);
      if (normalized.includes(candidate) || candidate.includes(normalized)) return Math.max(best, candidate.length);
      return best;
    }, 0);
  };
  const imageSource = (cell) => {
    const image = cell?.querySelector("img");
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
    return { rank: parseRankNumber(cell?.innerText || cell?.textContent || ""), rank_change: null };
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
    const rankTypeElement = Array.from(document.querySelectorAll("[role='tab'], button, a, [class*='tab']"))
      .filter(isVisible)
      .find((element) => {
        const text = compactText(element.innerText || element.textContent || "", 80);
        const active = element.getAttribute("aria-selected") === "true"
          || element.getAttribute("aria-current") === "page"
          || /(?:^|[-_\s])(active|selected|current)(?:$|[-_\s])/i.test(String(element.className || ""));
        return active && rankTypeLabels.includes(text);
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
    const records = dataRows.map((row, rowIndex) => {
      const cells = cellDetails(row);
      const productDetails = productColumn?.score ? parseProductDetails(cells[productColumn.index]?.text || "") : null;
      const rowRankParts = rankColumnIndex !== undefined ? rankParts(row.children[rankColumnIndex], rowIndex) : { rank: null, rank_change: null };
      return Object.fromEntries(fieldTemplate
        .filter((field) => field.available)
        .map((field) => {
          if (productDetails && field.key === "product_name" && field.column_index === productColumn.index) return [field.label, productDetails.title];
          if (productDetails && field.key === "price_range" && field.column_index === productColumn.index && field.extraction === "embedded_product_text") return [field.label, productDetails.price_range];
          if (productDetails && field.key === "rating" && field.column_index === productColumn.index && field.extraction === "embedded_product_text") return [field.label, productDetails.rating];
          if (productDetails && field.key === "review_count" && field.column_index === productColumn.index && field.extraction === "embedded_product_text") return [field.label, productDetails.review_count];
          if (field.key === "rank") return [field.label, rowRankParts.rank];
          if (field.key === "rank_change") return [field.label, rowRankParts.rank_change];
          return [field.label, field.key === "image" ? (cells[field.column_index]?.image || null) : (cells[field.column_index]?.text || "")];
        }));
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

function clearCollectionData() {
  window.__crawlHubManualCollectionPages = [];
  delete window.__crawlHubCollectionPreview;
  delete window.__crawlHubManualCollectionState;
  delete window.__crawlHubCollectionEnvironment;
  delete window.__crawlHubPaginationState;
  return { cleared: true };
}

async function collectCurrentPage() {
  const result = collectPageData();
  const pagination = detectPaginationState();
  const environment = collectionEnvironment(result, pagination);
  const existingPages = Array.isArray(window.__crawlHubManualCollectionPages) ? window.__crawlHubManualCollectionPages : [];
  const previousEnvironment = window.__crawlHubCollectionEnvironment;
  if (existingPages.length && previousEnvironment && previousEnvironment.signature !== JSON.stringify(environment)) {
    const confirmed = window.confirm("当前分页数量或页面采集环境已变化。\n是否开始新的采集任务？\n\n确认后将清除旧的已采集数据和当前进度。\n字段模板不会删除。");
    if (!confirmed) return { cancelled: true, result: window.__crawlHubCollectionPreview || null, pagination, duplicate: false };
    clearCollectionData();
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
    const key = record["排名"] ?? `${record["商品名称"] || ""}|${record["店铺"] || ""}|${record["图片"] || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    records.push(record);
  }));
  const merged = {
    ...result,
    source_type: pages.length > 1 ? "manual_paginated_table" : result.source_type,
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
  const savedProject = await saveInternalProject(merged);
  merged.project_id = savedProject.project_id;
  window.__crawlHubCollectionEnvironment = { ...environment, signature: JSON.stringify(environment) };
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
  { key: "shop", label: "店铺" },
  { key: "similar_products", label: "同款商品数" }
];

function collectionProjectData(result) {
  const metadata = result.metadata || {};
  const products = result.records.map((record) => ({
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
    shop: record["店铺"] ?? null,
    similar_products: record["同款商品数"] ?? null
  }));
  return {
    metadata: {
      category_full: metadata.category_full || "未识别",
      category_short: metadata.category_short || "未识别",
      page_title: metadata.page_title || "未识别",
      url: metadata.url || location.href,
      created_at: metadata.created_at || new Date().toISOString()
    },
    products
  };
}

function projectStorageRequest(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const requestId = `crawlHub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeout = setTimeout(() => {
      document.removeEventListener("crawlHub:storage-response", onResponse);
      reject(new Error("本地项目数据服务未连接，请重新打开插件面板后再试"));
    }, 3000);
    const onResponse = (event) => {
      const response = event.detail;
      if (response?.request_id !== requestId) return;
      clearTimeout(timeout);
      document.removeEventListener("crawlHub:storage-response", onResponse);
      if (!response.ok) reject(new Error(response.error || "本地项目数据操作失败"));
      else resolve(response);
    };
    document.addEventListener("crawlHub:storage-response", onResponse);
    document.dispatchEvent(new CustomEvent("crawlHub:storage-request", {
      detail: { request_id: requestId, type, ...payload }
    }));
  });
}

async function saveInternalProject(result) {
  const project = collectionProjectData(result);
  const projectId = projectFolderName(project.metadata);
  const response = await projectStorageRequest("crawlHub:save-project", { project_id: projectId, project });
  window.__crawlHubCurrentProjectId = projectId;
  return response.project;
}

async function readIntelligenceProject() {
  let project = null;
  if (window.__crawlHubCurrentProjectId) {
    const current = await projectStorageRequest("crawlHub:read-project", { project_id: window.__crawlHubCurrentProjectId });
    project = current.project;
  }
  if (!project) {
    const latest = await projectStorageRequest("crawlHub:read-latest-project");
    project = latest.project;
  }
  if (project?.project_id) window.__crawlHubCurrentProjectId = project.project_id;
  return project;
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
  const rows = [fields.map((field) => field.key), ...products.map((product) => fields.map((field) => product[field.key] ?? ""))];
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

function projectFolderName(metadata) {
  const shortName = String(metadata.category_short || "未识别").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim() || "未识别";
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
  const parentDirectory = await window.showDirectoryPicker({ mode: "readwrite" });
  const projectDirectory = await parentDirectory.getDirectoryHandle("CrawlHub项目", { create: true });
  const collectionDirectory = await projectDirectory.getDirectoryHandle(projectFolderName(project.metadata), { create: true });
  await writeProjectFile(collectionDirectory, "metadata.json", JSON.stringify(project.metadata, null, 2));
  await writeProjectFile(collectionDirectory, "products.json", JSON.stringify(project.products, null, 2));
  await writeProjectFile(collectionDirectory, "products.xlsx", collectionXlsx(project.products));
  return { folder_name: collectionDirectory.name, product_count: project.products.length };
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
  const panelVersion = "intelligence-center-v3";
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
      .mode-switch { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-bottom: 10px; padding: 3px; border-radius: 7px; background: #e5eaf3; }
      .mode-switch button { border: 0; border-radius: 5px; padding: 7px 8px; color: #667085; background: transparent; cursor: pointer; font: inherit; font-weight: 600; }
      .mode-switch button.active { color: #315efb; background: #fff; box-shadow: 0 1px 3px rgba(16,24,40,.12); }
      .collection-card { border-radius: 7px; padding: 9px; background: #fff; color: #475467; }
      .collection-card strong { color: #172033; }
      .collection-card p { margin: 5px 0 0; }
      .collection-meta { margin: 9px 0; color: #344054; }
      .collection-fields { max-height: 84px; margin: 0; padding: 0; overflow: auto; list-style: none; }
      .collection-fields li { margin-top: 4px; border-radius: 5px; padding: 5px 7px; background: #f6f8fc; overflow-wrap: anywhere; font-size: 12px; }
      .collection-fields li:first-child { margin-top: 0; }
      .collection-preview-table { max-height: 140px; margin-top: 7px; overflow: auto; border: 1px solid #e4e7ec; border-radius: 6px; background: #fff; }
      .collection-preview-table table { width: 100%; border-collapse: collapse; font-size: 11px; }
      .collection-preview-table th, .collection-preview-table td { min-width: 84px; max-width: 180px; padding: 6px; border-bottom: 1px solid #eaecf0; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
      .collection-preview-table th { position: sticky; top: 0; color: #344054; background: #f6f8fc; }
      .collection-preview-table td { color: #475467; }
      .collection-actions { gap: 5px; }
      .collection-actions button { padding: 6px 8px; }
      .export-options { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
      .export-options[hidden] { display: none; }
      .intelligence-workbench { display: grid; grid-template-columns: 184px minmax(0, 1fr); gap: 14px; min-height: 620px; padding: 2px; background: #f4f6fa; }
      .intelligence-nav { padding: 16px 10px; border-radius: 9px; background: #fff; }
      .intelligence-nav-label { margin: 0 8px 12px; color: #98a2b3; font-size: 12px; }
      .intelligence-nav-item { display: block; width: 100%; border: 0; border-radius: 6px; padding: 9px 10px; color: #475467; background: transparent; text-align: left; font: inherit; cursor: default; }
      .intelligence-nav-item.active { color: #008f8a; background: #e8f7f5; font-weight: 700; }
      .intelligence-main { min-width: 0; overflow: hidden; border-radius: 9px; background: #fff; }
      .intelligence-top { padding: 18px 20px 0; border-bottom: 1px solid #eaecf0; }
      .intelligence-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
      .intelligence-header h2 { margin: 0; color: #172033; font-size: 20px; line-height: 1.35; }
      .intelligence-header p { margin: 4px 0 0; color: #667085; font-size: 12px; }
      .intelligence-header-actions { display: flex; align-items: center; gap: 9px; color: #667085; font-size: 12px; white-space: nowrap; }
      .intelligence-header button { flex: 0 0 auto; border: 1px solid #bcd9ff; border-radius: 6px; padding: 7px 10px; color: #315efb; background: #f5f8ff; cursor: pointer; font: inherit; font-size: 12px; }
      .intelligence-tabs { display: flex; gap: 22px; margin-top: 18px; }
      .intelligence-tabs span { padding: 0 0 10px; color: #667085; font-size: 13px; }
      .intelligence-tabs span.active { border-bottom: 2px solid #00a39b; color: #172033; font-weight: 700; }
      .intelligence-filter { display: flex; align-items: center; gap: 8px; padding: 13px 0; border-top: 1px solid #f2f4f7; }
      .intelligence-category { max-width: 360px; overflow: hidden; border: 1px solid #d0d5dd; border-radius: 5px; padding: 7px 10px; color: #344054; background: #fff; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
      .intelligence-filter input { width: 220px; border: 1px solid #d0d5dd; border-radius: 5px; padding: 7px 10px; color: #98a2b3; background: #fff; font: inherit; font-size: 12px; }
      .intelligence-filter input:disabled { opacity: 1; cursor: default; }
      .intelligence-note { margin: 0 20px 14px; border-radius: 7px; padding: 10px 12px; color: #475467; background: #eef1f5; font-size: 12px; }
      .intelligence-note strong { color: #344054; }
      .intelligence-summary { display: flex; gap: 14px; padding: 0 20px 12px; color: #667085; font-size: 12px; }
      .intelligence-summary span { max-width: 48%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .intelligence-table-wrap { max-height: min(60vh, 650px); margin: 0 20px; overflow-y: auto; overflow-x: hidden; border: 1px solid #eaecf0; border-radius: 8px; overscroll-behavior: contain; }
      .intelligence-table-layout { display: flex; min-width: 0; align-items: stretch; }
      .intelligence-fixed-pane { position: sticky; left: 0; z-index: 3; flex: 0 0 460px; width: 460px; background: #fff; box-shadow: 8px 0 14px -14px rgba(16,24,40,.7); }
      .intelligence-metrics-pane { min-width: 0; flex: 1 1 auto; overflow-x: auto; overflow-y: visible; }
      .intelligence-table { width: 100%; border-collapse: separate; border-spacing: 0; color: #344054; font-size: 12px; table-layout: fixed; }
      .intelligence-metrics-table { min-width: 790px; table-layout: auto; }
      .intelligence-table th, .intelligence-table td { height: 92px; padding: 10px 8px; border-bottom: 1px solid #eaecf0; background: #fff; text-align: left; vertical-align: middle; }
      .intelligence-table th { position: sticky; top: 0; z-index: 4; height: 48px; color: #667085; background: #f7f8fa; font-size: 12px; font-weight: 600; white-space: nowrap; }
      .intelligence-table tbody tr:hover td { background: #f8fcfc; }
      .intelligence-fixed-table th { z-index: 5; }
      .fixed-rank { width: 42px; text-align: center !important; }
      .fixed-change { width: 52px; text-align: center !important; }
      .fixed-product { width: 210px; }
      .fixed-price { width: 96px; color: #475467; white-space: nowrap; }
      .fixed-rating { width: 60px; color: #475467; text-align: center !important; white-space: nowrap; }
      .intelligence-product { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
      .intelligence-product img, .intelligence-image-placeholder { flex: 0 0 auto; width: 40px; height: 40px; border: 1px solid #e4e7ec; border-radius: 6px; background: #f2f4f7; object-fit: cover; }
      .intelligence-product-name { display: -webkit-box; overflow: hidden; color: #172033; font-weight: 600; line-height: 1.4; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
      .trend-up { color: #039855; font-weight: 600; }
      .trend-down { color: #d92d20; font-weight: 600; }
      .trend-flat { color: #98a2b3; }
      .intelligence-metric { min-width: 120px; white-space: nowrap; }
      .intelligence-shop { min-width: 150px; }
      .intelligence-actions { display: grid; gap: 5px; min-width: 112px; }
      .intelligence-actions button { border: 0; border-radius: 4px; padding: 5px 8px; color: #475467; background: #f2f4f7; cursor: default; font: inherit; font-size: 11px; white-space: nowrap; }
      .intelligence-actions button:first-child { color: #fff; background: #00a39b; }
      .intelligence-footer { display: flex; justify-content: flex-end; padding: 11px 20px 15px; color: #667085; font-size: 12px; }
      .intelligence-empty { padding: 48px 16px; color: #667085; text-align: center; }
      .view[hidden], .content[hidden] { display: none; }
    </style>
    <div class="panel">
      <header><strong>CrawlHub 页面分析</strong><button id="minimize" title="最小化">−</button><button id="close" title="关闭">×</button></header>
      <div id="content" class="content">
        <div class="hint">数据仅在本地处理，不记录响应内容。</div>
        <div class="mode-switch" role="tablist" aria-label="工作模式">
          <button id="analysisMode" class="active" type="button">页面分析</button>
          <button id="collectionMode" type="button">数据采集</button>
          <button id="intelligenceMode" type="button">商品情报中心</button>
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
            <strong>当前页数据提取验证</strong>
            <p>根据表头和行列关系生成字段模板，提取当前已加载的表格或列表数据。</p>
            <div id="collectionState" class="collection-meta">尚未采集</div>
            <div id="metadataStatus" class="collection-meta">metadata：等待采样顶部类目标签</div>
            <div id="paginationStatus" class="collection-meta">分页状态：未识别</div>
            <ul id="collectionFields" class="collection-fields"><li>字段模板：未生成</li></ul>
            <div id="collectionPreviewTable" class="collection-preview-table">点击“采集当前页”查看示例数据。</div>
            <div id="templateStatus" class="collection-meta">字段模板尚未保存</div>
          </div>
          <div class="actions collection-actions" style="margin-top: 7px;">
            <button id="collectCollection">采集当前页</button>
            <button id="exportProject" class="secondary">导出项目</button>
            <button id="saveCollectionTemplate" class="secondary">保存字段模板</button>
            <button id="clearCollectionData" class="secondary">清除采集数据</button>
          </div>
        </div>
        <div id="intelligenceView" class="view" hidden>
          <div class="intelligence-workbench">
            <aside class="intelligence-nav" aria-label="商品情报导航">
              <p class="intelligence-nav-label">商品</p>
              <button class="intelligence-nav-item" type="button">详细信息</button>
              <button class="intelligence-nav-item" type="button">热卖商品</button>
              <button class="intelligence-nav-item" type="button">商品流量</button>
              <p class="intelligence-nav-label" style="margin-top: 20px;">商品榜单</p>
              <button class="intelligence-nav-item active" type="button">TikTok 热卖商品榜</button>
            </aside>
            <section class="intelligence-main">
              <div class="intelligence-top">
                <div class="intelligence-header">
                  <div><h2 id="intelligenceTitle">商品情报中心</h2><p id="intelligenceSubtitle">读取已保存的项目数据，集中浏览商品表现。</p></div>
                  <div class="intelligence-header-actions"><span id="intelligenceTime">本地采集数据</span><button id="refreshIntelligence" type="button">刷新项目数据</button></div>
                </div>
                <div class="intelligence-tabs"><span class="active">总榜</span><span>直播榜</span><span>短视频榜</span><span>商品卡</span></div>
                <div class="intelligence-filter"><span id="intelligenceCategory" class="intelligence-category">类目：未识别</span><input disabled value="同款商品少于　请填写数字" aria-label="同款商品筛选（暂未开放）" /></div>
              </div>
              <div class="intelligence-note"><strong>●</strong> 本页展示 CrawlHub 已保存的商品数据，横向滚动可浏览更多指标。</div>
              <div id="intelligenceSummary" class="intelligence-summary"></div>
              <div id="intelligenceTable" class="intelligence-table-wrap"></div>
              <div id="intelligenceFooter" class="intelligence-footer"></div>
            </div>
          </div>
        </div>
        <div id="message" class="message"></div>
      </div>
    </div>`;
  document.documentElement.appendChild(host);
  window.__crawlHubPanelHost = host;

  const content = shadow.querySelector("#content");
  const analysisView = shadow.querySelector("#analysisView");
  const collectionView = shadow.querySelector("#collectionView");
  const intelligenceView = shadow.querySelector("#intelligenceView");
  const analysisModeButton = shadow.querySelector("#analysisMode");
  const collectionModeButton = shadow.querySelector("#collectionMode");
  const intelligenceModeButton = shadow.querySelector("#intelligenceMode");
  const intelligenceTitle = shadow.querySelector("#intelligenceTitle");
  const intelligenceSubtitle = shadow.querySelector("#intelligenceSubtitle");
  const intelligenceSummary = shadow.querySelector("#intelligenceSummary");
  const intelligenceTable = shadow.querySelector("#intelligenceTable");
  const intelligenceTime = shadow.querySelector("#intelligenceTime");
  const intelligenceCategory = shadow.querySelector("#intelligenceCategory");
  const intelligenceFooter = shadow.querySelector("#intelligenceFooter");
  const refreshIntelligenceButton = shadow.querySelector("#refreshIntelligence");
  const collectionState = shadow.querySelector("#collectionState");
  const metadataStatus = shadow.querySelector("#metadataStatus");
  const paginationStatus = shadow.querySelector("#paginationStatus");
  const collectionFields = shadow.querySelector("#collectionFields");
  const collectionPreviewTable = shadow.querySelector("#collectionPreviewTable");
  const templateStatus = shadow.querySelector("#templateStatus");
  const collectCollectionButton = shadow.querySelector("#collectCollection");
  const exportProjectButton = shadow.querySelector("#exportProject");
  const saveCollectionTemplateButton = shadow.querySelector("#saveCollectionTemplate");
  const clearCollectionDataButton = shadow.querySelector("#clearCollectionData");
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
    const result = window.__crawlHubCollectionPreview;
    const manualState = window.__crawlHubManualCollectionState;
    const fieldTemplate = result?.field_template || window.__crawlHubCollectionFieldTemplate || [];
    const pageState = detectPaginationState();
    const pageText = pageState.current_page && pageState.total_pages
      ? `当前：第${pageState.current_page}页 / ${pageState.total_pages}页`
      : "分页状态：未识别";
    paginationStatus.textContent = pageText;
    if (!result) {
      collectionState.textContent = "尚未采集";
      metadataStatus.textContent = "metadata：采集当前页时自动读取页面信息";
      renderFieldTemplate(fieldTemplate);
      collectionPreviewTable.textContent = fieldTemplate.length ? "字段模板已保留，点击“采集当前页”生成新结果。" : "点击“采集当前页”查看示例数据。";
      try {
        templateStatus.textContent = localStorage.getItem("crawlHub.collectionTemplate.v1") ? "已有本地保存的字段模板" : fieldTemplate.length ? "当前字段模板已保留，尚未保存" : "字段模板尚未保存";
      } catch {
        templateStatus.textContent = "当前页面不允许保存字段模板";
      }
      collectCollectionButton.disabled = false;
      exportProjectButton.disabled = true;
      saveCollectionTemplateButton.disabled = !fieldTemplate.length;
      clearCollectionDataButton.disabled = true;
      return;
    }
    const sourceLabel = result.source_type === "table" ? "表格" : result.source_type === "list" ? "列表" : result.source_type === "paginated_table" || result.source_type === "manual_paginated_table" ? "分页表格" : "未找到可提取的表格或列表";
    collectionState.textContent = manualState?.last_page
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
  const renderIntelligence = async () => {
    intelligenceSubtitle.textContent = "正在读取已保存的项目数据…";
    intelligenceTitle.textContent = "商品情报中心";
    intelligenceTime.textContent = "本地采集数据";
    intelligenceCategory.textContent = "类目：未识别";
    intelligenceSummary.replaceChildren();
    intelligenceFooter.textContent = "";
    intelligenceTable.innerHTML = '<div class="intelligence-empty">正在加载商品项目…</div>';
    const project = await readIntelligenceProject();
    if (window.__crawlHubMode !== "intelligence") return;
    if (!project?.products?.length) {
      intelligenceSubtitle.textContent = "尚未找到已保存的采集项目。请先在“数据采集”中完成至少一页采集。";
      intelligenceTable.innerHTML = '<div class="intelligence-empty">暂无商品数据</div>';
      return;
    }
    const metadata = project.metadata || {};
    const products = project.products;
    const category = metadata.category_full || metadata.category_short || "未识别类目";
    const createdAt = metadata.created_at ? new Date(metadata.created_at) : null;
    const createdText = createdAt && !Number.isNaN(createdAt.valueOf()) ? createdAt.toLocaleString() : "未识别";
    intelligenceTitle.textContent = metadata.page_title || "TikTok 热卖商品榜";
    intelligenceSubtitle.textContent = `已保存商品研究项目 · ${products.length} 条商品`;
    intelligenceTime.textContent = `采集时间：${createdText}`;
    intelligenceCategory.textContent = `类目：${category}`;
    [
      `项目：${project.project_id || "当前项目"}`,
      `数据来源：CrawlHub 本地项目`,
      `当前商品：${products.length} 条`
    ].forEach((text) => {
      const item = document.createElement("span");
      item.textContent = text;
      intelligenceSummary.appendChild(item);
    });
    intelligenceTable.replaceChildren();
    const layout = document.createElement("div");
    layout.className = "intelligence-table-layout";
    const fixedPane = document.createElement("div");
    fixedPane.className = "intelligence-fixed-pane";
    const metricsPane = document.createElement("div");
    metricsPane.className = "intelligence-metrics-pane";
    const createTable = (className, headers) => {
      const table = document.createElement("table");
      table.className = `intelligence-table ${className}`;
      const head = table.createTHead();
      const headRow = head.insertRow();
      headers.forEach(([label, cellClass]) => {
        const cell = document.createElement("th");
        cell.className = cellClass;
        cell.textContent = label;
        headRow.appendChild(cell);
      });
      return table;
    };
    const fixedTable = createTable("intelligence-fixed-table", [
      ["排名", "fixed-rank"], ["排名变化", "fixed-change"], ["商品", "fixed-product"],
      ["价格范围", "fixed-price"], ["商品评分", "fixed-rating"]
    ]);
    const metricsTable = createTable("intelligence-metrics-table", [
      ["GMV", "intelligence-metric"], ["点击次数", "intelligence-metric"], ["点击率", "intelligence-metric"],
      ["店铺", "intelligence-metric intelligence-shop"], ["同款商品数", "intelligence-metric"], ["商品操作", "intelligence-metric"]
    ]);
    const display = (value) => value === null || value === undefined || value === "" ? "—" : String(value);
    const trendClass = (value) => {
      const text = String(value ?? "");
      if (text.includes("↑")) return "trend-up";
      if (text.includes("↓")) return "trend-down";
      return "trend-flat";
    };
    const fixedBody = fixedTable.createTBody();
    const metricsBody = metricsTable.createTBody();
    products.forEach((product) => {
      const fixedRow = fixedBody.insertRow();
      const rank = fixedRow.insertCell();
      rank.className = "fixed-rank";
      rank.textContent = display(product.rank);
      const change = fixedRow.insertCell();
      change.className = `fixed-change ${trendClass(product.rank_change)}`;
      change.textContent = display(product.rank_change);
      const productCell = fixedRow.insertCell();
      productCell.className = "fixed-product";
      const productInfo = document.createElement("div");
      productInfo.className = "intelligence-product";
      if (product.image) {
        const image = document.createElement("img");
        image.src = product.image;
        image.alt = "商品图片";
        image.loading = "lazy";
        image.addEventListener("error", () => image.replaceWith(Object.assign(document.createElement("div"), { className: "intelligence-image-placeholder" })));
        productInfo.appendChild(image);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "intelligence-image-placeholder";
        productInfo.appendChild(placeholder);
      }
      const name = document.createElement("div");
      name.className = "intelligence-product-name";
      name.title = display(product.product_name);
      name.textContent = display(product.product_name);
      productInfo.appendChild(name);
      productCell.appendChild(productInfo);
      const price = fixedRow.insertCell();
      price.className = "fixed-price";
      price.textContent = display(product.price);
      const rating = fixedRow.insertCell();
      rating.className = "fixed-rating";
      rating.textContent = display(product.rating);
      const metricsRow = metricsBody.insertRow();
      [
        [product.gmv, "intelligence-metric"],
        [product.clicks, "intelligence-metric"],
        [product.ctr, "intelligence-metric"],
        [product.shop, "intelligence-metric intelligence-shop"],
        [product.similar_products, "intelligence-metric"]
      ].forEach(([value, className]) => {
        const cell = metricsRow.insertCell();
        cell.className = className;
        cell.textContent = display(value);
      });
      const actions = metricsRow.insertCell();
      actions.className = "intelligence-metric";
      const actionGroup = document.createElement("div");
      actionGroup.className = "intelligence-actions";
      ["AI分析", "找货源", "收藏"].forEach((label) => {
        const button = document.createElement("button");
        button.type = "button";
        button.title = "功能即将开放";
        button.textContent = label;
        actionGroup.appendChild(button);
      });
      actions.appendChild(actionGroup);
    });
    fixedPane.appendChild(fixedTable);
    metricsPane.appendChild(metricsTable);
    layout.append(fixedPane, metricsPane);
    intelligenceTable.appendChild(layout);
    intelligenceFooter.textContent = `共 ${products.length} 条商品 · 可上下浏览，横向滚动查看店铺、同款商品数等指标`;
  };
  const setMode = (mode) => {
    window.__crawlHubMode = mode;
    const isAnalysis = mode === "analysis";
    const isCollection = mode === "collection";
    const isIntelligence = mode === "intelligence";
    analysisView.hidden = !isAnalysis;
    collectionView.hidden = !isCollection;
    intelligenceView.hidden = !isIntelligence;
    analysisModeButton.classList.toggle("active", isAnalysis);
    collectionModeButton.classList.toggle("active", isCollection);
    intelligenceModeButton.classList.toggle("active", isIntelligence);
    host.style.width = isIntelligence ? "min(1180px, calc(100vw - 32px))" : "360px";
    if (!isAnalysis && window.__crawlHubSamplingActive) stopElementSampling();
    render();
    renderCollection();
    if (isIntelligence) {
      renderIntelligence().catch((error) => {
        if (window.__crawlHubMode !== "intelligence") return;
        intelligenceSubtitle.textContent = "无法读取本地项目数据。";
        intelligenceTable.innerHTML = '<div class="intelligence-empty">请重新打开插件面板后再试。</div>';
        setMessage(`项目读取失败：${error.message || "无法读取"}`, "error");
      });
    }
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
    setMessage("可提取当前页已加载的数据；不会翻页或发送页面数据。", "success");
  });
  intelligenceModeButton.addEventListener("click", () => {
    setMode("intelligence");
    setMessage("商品情报中心只读取已保存项目，不会重新采集页面。", "success");
  });
  refreshIntelligenceButton.addEventListener("click", () => {
    renderIntelligence().catch((error) => setMessage(`项目读取失败：${error.message || "无法读取"}`, "error"));
  });
  collectCollectionButton.addEventListener("click", async () => {
    try {
      setMessage("采集中…");
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
      collectCollectionButton.disabled = false;
    }
  });
  exportProjectButton.addEventListener("click", async () => {
    try {
      setMessage("请选择项目保存位置…");
      const exported = await exportCollectionProject();
      setMessage(`项目已导出：${exported.folder_name}（${exported.product_count} 条商品）`, "success");
    } catch (error) {
      if (error?.name === "AbortError") {
        setMessage("已取消选择保存位置。", "success");
        return;
      }
      setMessage(`项目导出失败：${error.message || "无法导出"}`, "error");
    }
  });
  clearCollectionDataButton.addEventListener("click", () => {
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

window.__crawlHub = { analyzePage, collectPageData, detectPaginationState, collectCurrentPage, clearCollectionData, collectionXlsx, collectionProjectData, exportCollectionProject, readIntelligenceProject, saveCollectionTemplate, startNetworkObserver, startElementSampling, stopElementSampling, installPanel };

})();
