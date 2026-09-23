/* CrawlHub's isolated 1688 official image-search worker. It deliberately keeps
 * tokens in browser cookies and never serializes them into jobs or storage. */
(() => {
  const APP_KEY = "12574478";
  const UPLOAD_API = "mtop.1688.imageService.putImage";
  const UPLOAD_URL = "https://h5api.m.1688.com/h5/mtop.1688.imageservice.putimage/1.0/";
  const SEARCH_URL = "https://search.1688.com/service/imageSearchOfferResultViewService";
  const OFFICIAL_URL = "https://air.1688.com/kapp/1688-search/pc-image-search/?tab=imageSearch";
  const SESSION_KEY = "crawlHub.active1688ImageSearch.v1";
  const MESSAGE_TYPES = new Set(["START_1688_IMAGE_SEARCH", "CANCEL_1688_IMAGE_SEARCH", "GET_1688_IMAGE_SEARCH_JOB", "OPEN_1688_LOGIN", "REOPEN_1688_LOGIN", "RECHECK_1688_LOGIN", "OPEN_1688_OFFICIAL_SEARCH", "OPEN_1688_OFFER", "PREPARE_SOURCE_IMAGE", "FETCH_1688_RESULT_IMAGE"]);

  let currentJob;
  let generation = 0;
  let authResumeInFlight = false;
  let imageProxyActive = 0;
  const imageProxyQueue = [];
  const recovery = restoreSession();

  const shifts = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const constants = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0);
  function md5(input) {
    const source = new TextEncoder().encode(input), length = Math.ceil((source.length + 9) / 64) * 64, bytes = new Uint8Array(length);
    bytes.set(source); bytes[source.length] = 0x80;
    const bits = BigInt(source.length) * 8n;
    for (let i = 0; i < 8; i += 1) bytes[length - 8 + i] = Number((bits >> BigInt(i * 8)) & 0xffn);
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const rot = (n, s) => ((n << s) | (n >>> (32 - s))) >>> 0;
    for (let offset = 0; offset < bytes.length; offset += 64) {
      const words = new Uint32Array(16);
      for (let i = 0; i < 16; i += 1) words[i] = (bytes[offset + i * 4] | (bytes[offset + i * 4 + 1] << 8) | (bytes[offset + i * 4 + 2] << 16) | (bytes[offset + i * 4 + 3] << 24)) >>> 0;
      let a = a0, b = b0, c = c0, d = d0;
      for (let i = 0; i < 64; i += 1) {
        let f, wi;
        if (i < 16) { f = (b & c) | (~b & d); wi = i; }
        else if (i < 32) { f = (d & b) | (~d & c); wi = (5 * i + 1) % 16; }
        else if (i < 48) { f = b ^ c ^ d; wi = (3 * i + 5) % 16; }
        else { f = c ^ (b | ~d); wi = (7 * i) % 16; }
        const oldD = d; d = c; c = b; b = (b + rot((a + f + constants[i] + words[wi]) >>> 0, shifts[i])) >>> 0; a = oldD;
      }
      a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
    }
    const hex = (v) => [0, 8, 16, 24].map((s) => ((v >>> s) & 255).toString(16).padStart(2, "0")).join("");
    return hex(a0) + hex(b0) + hex(c0) + hex(d0);
  }
  const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const now = () => new Date().toISOString();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const errorMessage = (error, fallback) => error instanceof Error ? error.message : fallback;

  async function mtopToken() {
    const fromUrl = await chrome.cookies.getAll({ url: "https://h5api.m.1688.com/", name: "_m_h5_tk" }).catch(() => []);
    const fromDomain = await chrome.cookies.getAll({ domain: "1688.com", name: "_m_h5_tk" }).catch(() => []);
    const cookie = [...fromUrl, ...fromDomain].find((item) => item.value);
    return decodeURIComponent(cookie?.value || "").split("_")[0].trim();
  }
  async function hasSession() { return Boolean(await mtopToken()); }
  function accessChallenge(value) { return /_____tmd_____|(?:\/|\b)punish(?:\/|\b)|captcha|x5secdata|验证码|安全验证/i.test(value.slice(0, 250000)); }
  function parseResponse(value) {
    const source = value.trim();
    if (accessChallenge(source) || (/<(?:html|script)\b/i.test(source) && /login\.1688\.com|请登录|登录后继续/i.test(source))) {
      throw new Error(`NEEDS_AUTH:1688要求完成登录或安全验证。 [issue=${/login\.1688\.com|请登录|登录后继续/i.test(source) ? "login" : "challenge"}]`);
    }
    try { return JSON.parse(source); } catch { const start = source.indexOf("("), end = source.lastIndexOf(")"); if (start >= 0 && end > start) return JSON.parse(source.slice(start + 1, end)); }
    throw new Error("1688返回了无法识别的数据格式。");
  }
  function responseError(data) { return (Array.isArray(data?.ret) ? data.ret : [data?.ret, data?.msg, data?.message]).filter(Boolean).map(String).join("；"); }
  function tokenError(data) { return /TOKEN|SESSION_EXPIRED|NOT_LOGIN|登录/i.test(responseError(data)); }
  function authError(data) { return tokenError(data) || /FAIL_SYS_USER_VALIDATE|RGV587|CAPTCHA|安全|验证|PUNISH|X5SECDATA/i.test(responseError(data)); }
  async function uploadRequest(body, token) {
    const time = String(Date.now()), url = new URL(UPLOAD_URL);
    Object.entries({ jsv: "2.7.2", appKey: APP_KEY, t: time, sign: token ? md5(`${token}&${time}&${APP_KEY}&${body}`) : "", api: UPLOAD_API, ecode: "0", v: "1.0", type: "originaljson", dataType: "jsonp" }).forEach(([k, v]) => url.searchParams.set(k, v));
    const response = await fetch(url, { method: "POST", credentials: "include", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: `data=${encodeURIComponent(body)}` });
    const result = await response.text();
    if (!response.ok) throw new Error(`1688图片上传请求失败（HTTP ${response.status}）。`);
    return parseResponse(result);
  }
  function findSession(value, depth = 0) {
    if (!value || depth > 8) return undefined;
    if (Array.isArray(value)) { for (const item of value) { const found = findSession(item, depth + 1); if (found) return found; } return undefined; }
    if (typeof value !== "object") return undefined;
    const imageId = text(value.imageId || value.image_id || value.result);
    if (imageId.length >= 8) return { image_id: imageId, request_id: text(value.requestId) || undefined, session_id: text(value.sessionId) || undefined };
    for (const child of Object.values(value)) { const found = findSession(child, depth + 1); if (found) return found; }
  }
  async function uploadImage(dataUrl) {
    const base64 = String(dataUrl || "").replace(/^data:image\/[^;]+;base64,/i, "");
    if (base64.length < 100) throw new Error("待搜索图片内容无效。");
    const body = JSON.stringify({ imageBase64: base64, appName: "searchImageUpload", appKey: "pvvljh1grxcmaay2vgpe9nb68gg9ueg2" });
    let token = await mtopToken();
    if (!token) { await uploadRequest(body, "").catch(() => undefined); token = await mtopToken(); }
    if (!token) throw new Error("NEEDS_AUTH:请先在当前浏览器登录1688，再重新搜索。 [issue=login]");
    let result = await uploadRequest(body, token);
    if (tokenError(result) && (token = await mtopToken())) result = await uploadRequest(body, token);
    const session = findSession(result);
    if (session) return session;
    const reason = responseError(result);
    if (authError(result)) throw new Error(`NEEDS_AUTH:${reason || "1688登录状态已失效或需要安全验证。"} [issue=${tokenError(result) ? "session" : "challenge"}]`);
    throw new Error(reason || "1688没有返回图片识别编号。");
  }
  function pathValue(source, paths) { for (const path of paths) { let value = source; for (const part of path.split(".")) value = value && typeof value === "object" ? value[part] : undefined; if (value !== undefined && value !== null && value !== "") return value; } }
  function display(raw, depth = 0) {
    if (depth > 4 || raw === null || raw === undefined) return "";
    if (typeof raw === "string" || typeof raw === "number") return text(raw);
    if (Array.isArray(raw)) { for (const item of raw) { const result = display(item, depth + 1); if (result) return result; } return ""; }
    if (typeof raw === "object") for (const key of ["display", "text", "value", "name", "title", "label", "count", "amount"]) { const result = display(raw[key], depth + 1); if (result) return result; }
    return "";
  }
  function canonicalizeUrl(raw, baseUrl = "https://www.1688.com/") {
    const source = text(raw);
    if (!source || source === "undefined" || source === "null" || /^(?:data|blob):/i.test(source)) return "";
    try {
      const url = new URL(source.replace(/^\/\//, "https://"), baseUrl);
      return /^https?:$/.test(url.protocol) ? url.toString() : "";
    } catch { return ""; }
  }
  function imageUrl(raw, depth = 0) {
    if (depth > 4 || !raw) return "";
    if (typeof raw === "string") return /^(?:https?:)?\/\//i.test(raw) ? raw : "";
    if (Array.isArray(raw)) { for (const item of raw) { const result = imageUrl(item, depth + 1); if (result) return result; } return ""; }
    if (typeof raw === "object") for (const key of ["url", "imageUrl", "image_url", "src", "originUrl", "original", "bigImage", "mainImage", "productImage", "picUrl"]) { const result = imageUrl(raw[key], depth + 1); if (result) return result; }
    return "";
  }
  function offerId(offer) { const direct = text(pathValue(offer, ["id", "offerId", "offer_id", "productId", "product_id", "itemId", "information.id"])); return /^\d{8,}$/.test(direct) ? direct : text(pathValue(offer, ["href", "real_url", "realUrl", "detailUrl", "productUrl", "url"])).match(/(?:offer\/|offerId=|[?&](?:id|offer_id)=)(\d{8,})/i)?.[1] || ""; }
  function numeric(raw) { const match = display(raw).replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([万千KkMm])?/); if (!match) return undefined; const factor = match[2] === "万" ? 10000 : match[2] === "千" || /k/i.test(match[2] || "") ? 1000 : /m/i.test(match[2] || "") ? 1000000 : 1; return Number(match[1]) * factor; }
  function price(raw) { const values = [...display(raw).matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])).filter(Number.isFinite); if (!values.length) return undefined; const min = Math.min(...values), max = Math.max(...values), money = (v) => `¥${v.toFixed(2).replace(/\.00$/, "")}`; return { display: min === max ? money(min) : `${money(min)}–${money(max)}`, min, max, kind: "page-quote" }; }
  function normalizeOffer(offer) {
    const id = offerId(offer); if (!id) return undefined;
    const salesRaw = pathValue(offer, ["yearSales", "yearSale", "annualSales", "monthSold", "monthSales", "saleQuantity", "sold", "soldCount", "salesCount", "tradeQuantity", "sales"]);
    const repurchaseRaw = pathValue(offer, ["repurchaseRate", "repurchaseRatio", "repeatPurchaseRate", "returnRate"]), repurchaseValue = numeric(repurchaseRaw), repurchase = repurchaseValue === undefined ? "" : `${Number((repurchaseValue > 0 && repurchaseValue <= 1 && !display(repurchaseRaw).includes("%") ? repurchaseValue * 100 : repurchaseValue).toFixed(2))}%`;
    const years = display(pathValue(offer, ["shops.opened_year", "shops.tpyear", "supplier.supplierYear", "supplierYear", "tpYear", "companyYear"]));
    const badges = pathValue(offer, ["badges", "tags", "offerIdentities", "sellerIdentities", "serviceTags", "tagList"]);
    return { offer_id: id, title: display(pathValue(offer, ["title", "subject", "offerTitle", "information.title", "productInfo"])) || `1688 商品 ${id}`, image_url: canonicalizeUrl(imageUrl(pathValue(offer, ["picture", "imageUrl", "mainImage", "picUrl", "imgUrl", "offerPicUrl", "image.productImage", "image.url", "image", "pictures", "media"]))), detail_url: `https://detail.1688.com/offer/${id}.html`, price: price(pathValue(offer, ["price", "priceDisplay", "tradePrice.price", "priceInfo.price", "showPrice", "discountPrice", "priceInfo", "tradePrice"])), sales: display(salesRaw) || undefined, sales_value: numeric(salesRaw), minimum_order: display(pathValue(offer, ["minOrderQuantity", "minOrder", "tradePrice.minOrder", "quantityBegin", "beginAmount", "moq"])) || undefined, repurchase_rate: repurchase || undefined, repurchase_rate_value: repurchaseValue, shipping_time: display(pathValue(offer, ["shippingTimeGuarantee", "shipSpeed", "shipTime", "deliveryTime", "fahuoTime", "shipWithinHours", "deliveryPromise"])) || undefined, supplier_years: years ? (/年/.test(years) ? years : `入驻${years}年`) : undefined, listed_at: display(pathValue(offer, ["createDate", "publishTime", "listedAt", "onlineTime", "addTime"])) || undefined, supplier_name: display(pathValue(offer, ["shops.shop_name", "shops.company_name", "supplier.supplierName", "supplier.companyName", "supplierName", "companyName", "shopName", "sellerName"])) || undefined, badges: Array.isArray(badges) ? badges.map(display).filter(Boolean).slice(0, 4) : [] };
  }
  function findOffers(value, depth = 0) { if (!value || depth > 8) return undefined; if (Array.isArray(value)) { for (const item of value) { const found = findOffers(item, depth + 1); if (found) return found; } } else if (typeof value === "object") { if (Array.isArray(value.offerList || value.offers)) return { offers: value.offerList || value.offers, pageCount: Number(value.pageCount) || undefined, requestId: text(value.requestId), sessionId: text(value.sessionId) }; for (const child of Object.values(value)) { const found = findOffers(child, depth + 1); if (found) return found; } } }
  async function search(session, pageNumber = 1, pageSize = 20) {
    const url = new URL(SEARCH_URL); Object.entries({ tab: "imageSearch", imageId: session.image_id, imageIdList: session.image_id, filt: "y", beginPage: String(pageNumber), pageSize: String(pageSize), pageName: "image", ...(session.request_id ? { requestId: session.request_id } : {}), ...(session.session_id ? { sessionId: session.session_id } : {}) }).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetch(url, { credentials: "include", headers: { Accept: "application/json, text/plain, */*" } }), body = await response.text();
    if (!response.ok) throw new Error(`1688图搜请求失败（HTTP ${response.status}）。`);
    const data = parseResponse(body), payload = findOffers(data);
    if (!payload) { const reason = responseError(data); if (authError(data)) throw new Error(`NEEDS_AUTH:${reason || "1688要求完成登录或安全验证。"} [issue=${tokenError(data) ? "session" : "challenge"}]`); throw new Error(reason || "1688图搜结果结构暂时无法识别。"); }
    const results = payload.offers.map(normalizeOffer).filter(Boolean);
    return { results, session: { image_id: session.image_id, request_id: payload.requestId || session.request_id, session_id: payload.sessionId || session.session_id }, has_more: payload.pageCount ? pageNumber < payload.pageCount : payload.offers.length >= pageSize, diagnostics: { raw_offer_count: payload.offers.length, normalized_count: results.length, dropped_count: payload.offers.length - results.length, dropped_missing_identity: payload.offers.filter((item) => !offerId(item)).length, missing_image_count: results.filter((item) => !item.image_url).length, complete_card_count: results.filter((item) => item.image_url && !item.title.startsWith("1688 商品 ") && item.price).length } };
  }
  async function blobDataUrl(blob) { const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ""; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return `data:${blob.type || "image/jpeg"};base64,${btoa(binary)}`; }
  function runImageProxyQueue() {
    while (imageProxyActive < 4 && imageProxyQueue.length) {
      const task = imageProxyQueue.shift(); imageProxyActive += 1;
      task().finally(() => { imageProxyActive -= 1; runImageProxyQueue(); });
    }
  }
  function fetch1688ResultImage(url) {
    return new Promise((resolve, reject) => {
      imageProxyQueue.push(async () => {
        const startedAt = performance.now();
        let host = "", status = 0, contentType = "";
        try {
          const parsed = new URL(url);
          host = parsed.hostname;
          if (!/^https?:$/.test(parsed.protocol) || !/(?:^|\.)(?:alicdn\.com|1688\.com)$/i.test(parsed.hostname)) throw new Error("图片地址不属于允许的1688图片 CDN。");
          const response = await fetch(parsed.href, { credentials: "omit", referrerPolicy: "no-referrer" });
          status = response.status;
          contentType = response.headers.get("content-type") || "";
          if (!response.ok) throw new Error(`1688图片代理失败（HTTP ${response.status}）。`);
          if (!/^image\//i.test(contentType)) throw new Error("1688图片代理返回的不是图片。");
          const blob = await response.blob();
          console.debug("[CrawlHub][1688 proxy]", { host, status, content_type: contentType, elapsed_ms: Math.round(performance.now() - startedAt) });
          resolve({ data_url: await blobDataUrl(blob), content_type: contentType, byte_length: blob.size });
        } catch (error) {
          console.debug("[CrawlHub][1688 proxy]", { host, status, content_type: contentType, elapsed_ms: Math.round(performance.now() - startedAt), error: error?.message || String(error) });
          reject(error);
        }
      });
      runImageProxyQueue();
    });
  }
  async function prepareImageDataUrl(imageUrl) {
    if (String(imageUrl).startsWith("data:image/")) return imageUrl;
    const parsed = new URL(imageUrl); if (!/^https?:$/.test(parsed.protocol)) throw new Error("商品图片地址无效。");
    const response = await fetch(parsed.href, { credentials: "omit", referrerPolicy: "no-referrer" }); if (!response.ok) throw new Error(`商品图片下载失败（HTTP ${response.status}）。`);
    const source = await response.blob(); if (!source.type.startsWith("image/")) throw new Error("下载内容不是有效图片。");
    try { const bitmap = await createImageBitmap(source), scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height)), width = Math.max(100, Math.round(bitmap.width * scale)), height = Math.max(100, Math.round(bitmap.height * scale)), canvas = new OffscreenCanvas(width, height), context = canvas.getContext("2d"); if (!context) throw new Error("无法创建图片转换画布。"); context.fillStyle = "#fff"; context.fillRect(0, 0, width, height); context.drawImage(bitmap, 0, 0, width, height); bitmap.close(); return blobDataUrl(await canvas.convertToBlob({ type: "image/jpeg", quality: .88 })); } catch { if (/image\/(?:jpeg|png)/i.test(source.type)) return blobDataUrl(source); throw new Error("图片格式转换失败，请尝试框选商品主体。"); }
  }
  function officialSearchUrl(job) { const url = new URL(OFFICIAL_URL); if (job.official_session?.image_id) { url.searchParams.set("imageId", job.official_session.image_id); url.searchParams.set("imageIdList", job.official_session.image_id); } return url.href; }
  function domCards() {
    const seen = new Set(), clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    return [...document.querySelectorAll('[class*="searchOfferWrapper"]')].flatMap((card) => { const link = [...card.querySelectorAll('a[href*="detail.1688.com/offer/"],a[href*="offerId="]')].find((item) => /(?:\/offer\/|[?&]offerId=)\d{8,}/i.test(item.href)); const id = link?.href.match(/(?:\/offer\/|[?&]offerId=)(\d{8,})/i)?.[1]; if (!id || seen.has(id)) return []; seen.add(id); const desc = [...card.querySelectorAll('[class*="descText"]')].map((item) => clean(item.innerText || item.textContent)); const supplier = clean(card.querySelector('[class*="offerShopRow"]')?.textContent); const priceText = clean(card.querySelector('[class*="priceItem"],[class*="priceValue"],[class*="offerPrice"]')?.textContent || card.textContent).replace(/(\d)\s*\.\s*(\d)/g, "$1.$2"); const match = priceText.match(/(?:¥|￥)\s*(\d+(?:\.\d+)?)(?:\s*[-–~至]\s*(?:¥|￥)?\s*(\d+(?:\.\d+)?))?/); return [{ offer_id: id, href: link.href, real_url: link.href, picture: card.querySelector("img")?.currentSrc || card.querySelector("img")?.src || "", title: clean(card.querySelector('[class*="titleText"],[class*="offerTitle"],[class*="subject"]')?.textContent), price: match ? (match[2] ? `${match[1]}-${match[2]}` : match[1]) : undefined, sales: desc.find((item) => /件$/.test(item)), minOrderQuantity: desc.find((item) => /件起批$/.test(item)), repurchaseRate: desc.find((item) => /^回头率/.test(item)), shippingTimeGuarantee: desc.find((item) => /(?:\d+H发|\d+小时发|\d+天达|后天达)/i.test(item)), shops: { opened_year: supplier.match(/入驻\s*(\d+)\s*年/)?.[1], shop_name: supplier.replace(/^入驻\s*\d+\s*年\s*/, "").replace(/旺旺在线.*$/u, "").trim() } }]; });
  }
  function mergeOfficial(api, official) { const apiById = new Map(api.map((item) => [item.offer_id, item])), ids = new Set(official.map((item) => item.offer_id)); return official.map((item) => { const source = apiById.get(item.offer_id); return source ? { ...source, title: source.title.startsWith("1688 商品 ") && !item.title.startsWith("1688 商品 ") ? item.title : source.title, image_url: source.image_url || item.image_url, price: source.price || item.price, sales: source.sales || item.sales, minimum_order: source.minimum_order || item.minimum_order, repurchase_rate: source.repurchase_rate || item.repurchase_rate, shipping_time: source.shipping_time || item.shipping_time, supplier_years: source.supplier_years || item.supplier_years, supplier_name: source.supplier_name || item.supplier_name, badges: source.badges.length ? source.badges : item.badges } : item; }).concat(api.filter((item) => !ids.has(item.offer_id))); }
  async function broadcast() { if (!currentJob) return; const job = structuredClone(currentJob); await chrome.storage.session.set({ [SESSION_KEY]: job }).catch(() => undefined); if (job.source_tab_id !== undefined) chrome.tabs.sendMessage(job.source_tab_id, { type: "SOURCING_JOB_UPDATED", job }).catch(() => undefined); }
  function assertCurrent(token) { if (token !== generation || !currentJob) throw new Error("图搜任务已被新搜索替代。"); return currentJob; }
  async function enrich(token) {
    const job = assertCurrent(token); if (!job.official_session || job.fallback_tab_id !== undefined) return;
    let tabId;
    try { const tab = await chrome.tabs.create({ url: officialSearchUrl(job), active: false }); tabId = tab.id; if (tabId === undefined) throw new Error("无法创建1688官方结果页。"); job.fallback_tab_id = tabId; job.enrichment_state = "running"; await broadcast(); let offers = [];
      for (let attempt = 0; attempt < 8 && token === generation; attempt += 1) { await wait(900); const injected = await chrome.scripting.executeScript({ target: { tabId }, func: domCards }).catch(() => []); if (Array.isArray(injected[0]?.result) && injected[0].result.length) { offers = injected[0].result; break; } }
      const current = assertCurrent(token), official = offers.map(normalizeOffer).filter(Boolean); if (official.length) { current.results = mergeOfficial(current.results, official); current.has_more = false; current.enrichment_state = "complete"; current.enrichment_error = undefined; } else await appendPages(token); current.updated_at = now(); await broadcast();
    } catch { if (token === generation && currentJob) { await appendPages(token).catch(() => undefined); currentJob.enrichment_state = "partial"; currentJob.enrichment_error = `已保留前 ${currentJob.results.length} 条结果，更多官方资料暂不可用。`; currentJob.updated_at = now(); await broadcast(); } }
    finally { if (tabId !== undefined) await chrome.tabs.remove(tabId).catch(() => undefined); if (token === generation && currentJob?.fallback_tab_id === tabId) { currentJob.fallback_tab_id = undefined; await broadcast(); } }
  }
  async function appendPages(token) { const job = assertCurrent(token); if (!job.official_session) return; let pages = 0; while (job.has_more && pages < 4 && token === generation) { const page = await search(job.official_session, job.next_page, 20), current = assertCurrent(token), ids = new Set(current.results.map((item) => item.offer_id)); current.results.push(...page.results.filter((item) => !ids.has(item.offer_id))); current.official_session = page.session; current.next_page += 1; current.has_more = page.has_more; pages += 1; await broadcast(); } const current = assertCurrent(token); current.enrichment_state = current.has_more ? "partial" : "complete"; current.enrichment_error = current.has_more ? "已显示当前可用结果，更多结果暂不可用。" : undefined; }
  async function run(token) { try { const job = assertCurrent(token); if (!job.query_image_data_url) job.query_image_data_url = await prepareImageDataUrl(job.source_image_url); job.state = "uploading"; job.updated_at = now(); await broadcast(); const session = await uploadImage(job.query_image_data_url); job.official_session = session; job.state = "searching"; job.updated_at = now(); await broadcast(); const page = await search(session); const current = assertCurrent(token); current.official_session = page.session; current.results = page.results; current.next_page = 2; current.has_more = page.has_more; current.diagnostics = page.diagnostics; current.state = page.diagnostics.raw_offer_count && !page.results.length ? "failed" : "ready"; current.enrichment_state = current.state === "ready" && page.results.length ? "running" : "complete"; current.error = current.state === "failed" ? `1688返回了 ${page.diagnostics.raw_offer_count} 条候选货源，但插件未能识别商品编号。` : page.results.length ? undefined : "1688本次确实没有返回相似货源，可框选商品主体后重搜。"; current.updated_at = now(); await broadcast(); if (current.state === "ready" && page.results.length) void enrich(token); } catch (error) { if (token !== generation || !currentJob) return; const message = errorMessage(error, "1688官方图搜失败。"); currentJob.state = message.startsWith("NEEDS_AUTH:") ? "needs-auth" : "failed"; currentJob.auth_issue = message.match(/\[issue=(login|session|challenge)\]/i)?.[1]?.toLowerCase() || (/验证|安全|captcha|punish/i.test(message) ? "challenge" : "login"); currentJob.error = message.replace(/^NEEDS_AUTH:/, "").replace(/\s*\[issue=(?:login|session|challenge)\]\s*$/i, "").trim(); currentJob.updated_at = now(); await broadcast(); } }
  async function cancel() { generation += 1; if (!currentJob) return chrome.storage.session.remove(SESSION_KEY).catch(() => undefined); if (currentJob.fallback_tab_id !== undefined) await chrome.tabs.remove(currentJob.fallback_tab_id).catch(() => undefined); currentJob.state = "cancelled"; currentJob.updated_at = now(); await broadcast(); currentJob = undefined; await chrome.storage.session.remove(SESSION_KEY).catch(() => undefined); }
  async function start(product, dataUrl, sourceTabId) { const productId = String(product?.product_id || ""), imageUrl = String(product?.image_url || ""); if (!/^\d{8,24}$/.test(productId) || !imageUrl) return { ok: false, error: "TikTok 商品图片或商品 ID 无效。" }; await cancel(); const token = ++generation; currentJob = { id: `${productId}-${Date.now()}`, source_product_id: productId, source_title: text(product?.title) || productId, source_image_url: imageUrl, query_image_data_url: typeof dataUrl === "string" && dataUrl.startsWith("data:image/") ? dataUrl : "", source_tab_id: sourceTabId, state: "preparing-image", results: [], next_page: 1, has_more: false, official_search_url: OFFICIAL_URL, created_at: now(), updated_at: now() }; await broadcast(); void run(token); return { ok: true, job: currentJob }; }
  async function openLogin() { if (!currentJob) return; const tabs = await chrome.tabs.query({}).catch(() => []), existing = tabs.filter((tab) => tab.id !== undefined && /^https?:\/\/(?:[^/]+\.)?1688\.com\//i.test(tab.url || "")).sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)))[0], tab = existing ? await chrome.tabs.update(existing.id, { active: true }) : await chrome.tabs.create({ url: `https://login.1688.com/member/signin.htm?Done=${encodeURIComponent("https://www.1688.com/")}`, active: true }); if (tab?.id !== undefined) { currentJob.login_tab_id = tab.id; currentJob.updated_at = now(); await broadcast(); } }
  async function resumeAuth() { if (!currentJob || currentJob.state !== "needs-auth" || authResumeInFlight || !(await hasSession())) return false; authResumeInFlight = true; try { const token = ++generation; currentJob.state = "preparing-image"; currentJob.error = undefined; currentJob.auth_issue = undefined; currentJob.updated_at = now(); await broadcast(); void run(token); return true; } finally { authResumeInFlight = false; } }
  async function restoreSession() { const stored = await chrome.storage.session.get(SESSION_KEY).catch(() => ({})), restored = stored[SESSION_KEY]; if (!restored?.id) return; currentJob = restored; const token = ++generation; if (["preparing-image", "uploading", "searching"].includes(restored.state)) { restored.state = "preparing-image"; restored.results = []; restored.next_page = 1; restored.has_more = false; restored.official_session = undefined; await broadcast(); void run(token); } else if (restored.state === "ready" && restored.enrichment_state === "running") { restored.enrichment_state = "partial"; restored.enrichment_error = "扩展重新启动，已保留当前可用结果。"; restored.fallback_tab_id = undefined; await broadcast(); } }
  chrome.cookies.onChanged.addListener((change) => { if (change.cookie.name === "_m_h5_tk" && /(^|\.)1688\.com$/i.test(change.cookie.domain)) void resumeAuth(); });
  chrome.tabs.onRemoved.addListener((tabId) => { if (currentJob?.source_tab_id === tabId) void cancel(); if (currentJob?.fallback_tab_id === tabId && currentJob) { currentJob.fallback_tab_id = undefined; currentJob.enrichment_state = "partial"; currentJob.enrichment_error = "官方结果补充页已关闭，已保留当前可用结果。"; void broadcast(); } if (currentJob?.login_tab_id === tabId) { currentJob.login_tab_id = undefined; void broadcast(); } });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => { if (!MESSAGE_TYPES.has(message?.type)) return undefined; (async () => { await recovery; if (message.type === "START_1688_IMAGE_SEARCH") return start(message.product, message.query_image_data_url, sender.tab?.id); if (message.type === "CANCEL_1688_IMAGE_SEARCH") { await cancel(); return { ok: true }; } if (message.type === "GET_1688_IMAGE_SEARCH_JOB") return { ok: true, job: currentJob && (!sender.tab?.id || currentJob.source_tab_id === sender.tab.id) ? currentJob : undefined }; if (message.type === "PREPARE_SOURCE_IMAGE") return { ok: true, data_url: await prepareImageDataUrl(String(message.image_url || "")) }; if (message.type === "FETCH_1688_RESULT_IMAGE") return { ok: true, ...(await fetch1688ResultImage(String(message.url || ""))) }; if (message.type === "OPEN_1688_OFFER") { const offerId = String(message.offer_id || ""); if (!/^\d{8,}$/.test(offerId)) return { ok: false, error: "1688 商品 ID 无效。" }; await chrome.tabs.create({ url: `https://detail.1688.com/offer/${offerId}.html`, active: true }); return { ok: true }; } if (message.type === "OPEN_1688_OFFICIAL_SEARCH") { await chrome.tabs.create({ url: currentJob ? officialSearchUrl(currentJob) : OFFICIAL_URL, active: true }); return { ok: true }; } if (message.type === "OPEN_1688_LOGIN" || message.type === "REOPEN_1688_LOGIN") { await openLogin(); return { ok: true }; } if (message.type === "RECHECK_1688_LOGIN") { const connected = await resumeAuth(); return { ok: connected, connected, error: connected ? undefined : "尚未检测到1688登录状态，请完成验证后再试。" }; } return { ok: false, error: "未知的1688图搜请求。" }; })().then((value) => sendResponse(value), (error) => sendResponse({ ok: false, error: errorMessage(error, "1688图搜请求失败。") })); return true; });
})();
