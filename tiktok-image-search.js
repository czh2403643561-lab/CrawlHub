(() => {
  const ENABLED_KEY = "crawlHub.tiktokImageSearch.enabled.v1";
  const PANEL_ID = "crawlHub-1688-sourcing";
  const HOVER_ID = "crawlHub-image-search-hover";
  let enabled = false;
  let hoverHost, hoverShadow, activeImage, hideTimer;
  let panelHost, panelShadow, currentJob, cropMode = false, cropSource = "", firstNotice = false, panelDismissed = false;
  let contextInvalidatedHandled = false, pageIsLeaving = false;
  const resultImageHostStats = new Map();

  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const escape = (value) => clean(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const productId = () => location.pathname.match(/^\/view\/product\/(\d{8,24})(?:\/|$)/)?.[1] || "";
  const isProductPage = () => location.hostname === "shop.tiktok.com" && Boolean(productId());
  const imageUrl = (image) => image?.currentSrc || image?.getAttribute("src") || "";

  function isExtensionContextInvalidated(error) {
    const message = String(error?.message || error || "");
    return /extension context invalidated/i.test(message) || /context invalidated/i.test(message);
  }
  function hasExtensionRuntime() {
    try {
      return Boolean(globalThis.chrome?.runtime?.id);
    } catch {
      return false;
    }
  }
  function handleInvalidExtensionContext() {
    if (contextInvalidatedHandled) return;
    contextInvalidatedHandled = true;
    enabled = false;
    document.removeEventListener("pointerover", handleProductImagePointerOver, true);
    document.removeEventListener("pointerout", handleProductImagePointerOut, true);
    removeEventListener("scroll", syncHoverPosition, true);
    removeEventListener("resize", syncHoverPosition);
    clearHideTimer();
    hoverHost?.remove(); hoverHost = hoverShadow = activeImage = undefined;
    panelHost?.remove(); panelHost = panelShadow = undefined;
    currentJob = undefined; cropMode = false; cropSource = ""; panelDismissed = true;
    if (pageIsLeaving || !isProductPage() || document.visibilityState === "hidden") return;
    try {
      const key = "crawlHub.extensionContextReloadAt";
      const lastReload = Number(sessionStorage.getItem(key) || 0);
      if (!lastReload || Date.now() - lastReload >= 10000) {
        setTimeout(() => {
          if (pageIsLeaving || !isProductPage() || document.visibilityState === "hidden") return;
          const reloadAt = Number(sessionStorage.getItem(key) || 0);
          if (!reloadAt || Date.now() - reloadAt >= 10000) {
            sessionStorage.setItem(key, String(Date.now()));
            location.reload();
          }
        }, 100);
      }
    } catch { /* Recovery is best-effort and must not pollute extension errors. */ }
  }
  async function safeRuntimeMessage(message) {
    if (!hasExtensionRuntime()) {
      handleInvalidExtensionContext();
      return { ok: false, context_invalidated: true };
    }
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        handleInvalidExtensionContext();
        return { ok: false, context_invalidated: true };
      }
      console.error("[CrawlHub] Runtime message failed", error);
      return { ok: false, error: error?.message || String(error || "运行时通信失败") };
    }
  }
  async function safeStorageGet(key) {
    if (!hasExtensionRuntime()) {
      handleInvalidExtensionContext();
      return null;
    }
    try {
      return await chrome.storage.local.get(key);
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        handleInvalidExtensionContext();
        return null;
      }
      console.error("[CrawlHub] Storage read failed", error);
      return null;
    }
  }
  async function safeStorageSet(values) {
    if (!hasExtensionRuntime()) {
      handleInvalidExtensionContext();
      return false;
    }
    try {
      await chrome.storage.local.set(values);
      return true;
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        handleInvalidExtensionContext();
        return false;
      }
      console.error("[CrawlHub] Storage write failed", error);
      return false;
    }
  }

  function isSourceImage(url) {
    try {
      const parsed = new URL(url, location.href), target = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
      return /(?:tiktokcdn|ibytedtos|byteimg)/.test(parsed.hostname) && !/(?:logo|icon|avatar|static|placeholder)/.test(target);
    } catch { return false; }
  }
  function isVisible(image, minimumSize = 80) {
    const rect = image.getBoundingClientRect(), style = getComputedStyle(image);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width >= minimumSize && rect.height >= minimumSize && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
  }
  function findTikTokProductGalleryRoot() {
    if (!isProductPage()) return undefined;
    const counter = [...document.querySelectorAll("body *")].find((element) => {
      const match = clean(element.textContent).match(/^(\d+)\s*\/\s*(\d+)$/);
      if (!match || Number(match[2]) <= 1) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.top < innerHeight * 1.5 && rect.bottom > 0;
    });
    if (!counter) return undefined;
    const total = Number(clean(counter.textContent).match(/^(\d+)\s*\/\s*(\d+)$/)?.[2] || 0);
    let ancestor = counter.parentElement;
    for (let depth = 0; ancestor && ancestor !== document.body && depth < 8; depth += 1, ancestor = ancestor.parentElement) {
      const images = [...ancestor.querySelectorAll("img")].filter((item) => isVisible(item, 36) && isSourceImage(imageUrl(item)));
      if (images.length >= 2 && images.length <= Math.max(total + 4, 4)) return ancestor;
    }
    return undefined;
  }
  function isTikTokGalleryImage(image) {
    if (!isProductPage() || !(image instanceof HTMLImageElement) || !isSourceImage(imageUrl(image))) return false;
    const galleryRoot = findTikTokProductGalleryRoot();
    if (galleryRoot) return galleryRoot.contains(image) && isVisible(image, 36);
    if (!isVisible(image)) return false;
    const topLimit = Math.max(1400, innerHeight * 1.5);
    const candidates = [...document.images]
      .filter((item) => isVisible(item) && isSourceImage(imageUrl(item)) && item.getBoundingClientRect().top + scrollY < topLimit)
      .map((item) => { const rect = item.getBoundingClientRect(); return { item, area: rect.width * rect.height, natural: item.naturalWidth * item.naturalHeight }; })
      .sort((left, right) => right.area - left.area || right.natural - left.natural);
    return candidates[0]?.item === image;
  }
  function currentProduct(image) {
    const id = productId(), url = imageUrl(image);
    const title = clean(document.querySelector("h1")?.textContent || document.querySelector('[data-e2e*="title"]')?.textContent || document.title);
    return id && isSourceImage(url) ? { product_id: id, title: title || id, image_url: url } : undefined;
  }

  function ensureHoverHost() {
    if (hoverHost?.isConnected) return;
    hoverHost = document.createElement("span"); hoverHost.id = HOVER_ID;
    hoverHost.style.cssText = "position:fixed;z-index:2147483645;display:none;pointer-events:auto;";
    hoverShadow = hoverHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = "button{display:grid;place-items:center;width:var(--crawlHub-image-search-size,42px);height:var(--crawlHub-image-search-size,42px);border:2px solid #ff0050;border-radius:50%;background:#fff;color:#e60046;box-shadow:0 3px 12px rgba(0,0,0,.28);cursor:pointer;padding:0}button:hover{background:#fff0f4}svg{width:58%;height:58%;fill:none;stroke:currentColor;stroke-width:2.2}";
    const button = document.createElement("button"); button.type = "button"; button.title = "搜索1688同款货源"; button.setAttribute("aria-label", "搜索1688同款货源");
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"></circle><path d="m16 16 5 5"></path></svg>';
    button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); const product = currentProduct(activeImage); if (product) void startSourcing(product); });
    hoverHost.addEventListener("pointerenter", clearHideTimer); hoverHost.addEventListener("pointerleave", scheduleHide);
    hoverShadow.append(style, button); document.documentElement.appendChild(hoverHost);
  }
  function clearHideTimer() { if (hideTimer) clearTimeout(hideTimer); hideTimer = undefined; }
  function hideHoverButton() { if (hoverHost) hoverHost.style.display = "none"; }
  function scheduleHide() {
    clearHideTimer();
    hideTimer = setTimeout(() => {
      if (activeImage?.matches(":hover") || hoverHost?.matches(":hover") || hoverHost?.matches(":focus-within")) return;
      hideHoverButton();
    }, 190);
  }
  function positionHoverButton() {
    if (!activeImage || !isTikTokGalleryImage(activeImage)) { hideHoverButton(); return; }
    const rect = activeImage.getBoundingClientRect();
    const size = Math.min(42, Math.max(30, Math.min(rect.width, rect.height) - 8));
    hoverHost.style.setProperty("--crawlHub-image-search-size", `${size}px`);
    hoverHost.style.left = `${Math.max(8, Math.min(innerWidth - size - 8, rect.right - size - 8))}px`;
    hoverHost.style.top = `${Math.max(8, Math.min(innerHeight - size - 8, rect.bottom - size - 8))}px`;
    hoverHost.style.display = "block";
  }
  function handleProductImagePointerOver(event) {
    if (!enabled) return;
    if (!isProductPage()) { stopTikTokImageSearch(); return; }
    const fromPath = event.composedPath?.().find((item) => item instanceof HTMLImageElement);
    const image = fromPath || event.target?.closest?.("img");
    if (!isTikTokGalleryImage(image)) return;
    clearHideTimer(); activeImage = image; ensureHoverHost(); positionHoverButton();
  }
  function handleProductImagePointerOut(event) { if (event.target === activeImage) scheduleHide(); }
  function syncHoverPosition() { if (hoverHost?.style.display === "block") positionHoverButton(); }
  function startTikTokImageSearch() {
    if (enabled || !isProductPage()) return;
    enabled = true; ensureHoverHost();
    document.addEventListener("pointerover", handleProductImagePointerOver, true);
    document.addEventListener("pointerout", handleProductImagePointerOut, true);
    addEventListener("scroll", syncHoverPosition, true); addEventListener("resize", syncHoverPosition);
  }
  function closeSourcingPanel({ cancelJob = true } = {}) {
    panelHost?.remove(); panelHost = panelShadow = undefined;
    cropMode = false; cropSource = ""; currentJob = undefined; panelDismissed = true;
    if (cancelJob && !contextInvalidatedHandled) void safeRuntimeMessage({ type: "CANCEL_1688_IMAGE_SEARCH" });
  }
  function stopTikTokImageSearch({ cancelJob = true } = {}) {
    enabled = false; clearHideTimer();
    document.removeEventListener("pointerover", handleProductImagePointerOver, true);
    document.removeEventListener("pointerout", handleProductImagePointerOut, true);
    removeEventListener("scroll", syncHoverPosition, true); removeEventListener("resize", syncHoverPosition);
    hoverHost?.remove(); hoverHost = hoverShadow = activeImage = undefined;
    closeSourcingPanel({ cancelJob });
  }

  function stateText(job) {
    if (!job) return "选择商品主图开始搜货";
    if (job.state === "preparing-image") return "正在准备图片…";
    if (job.state === "uploading") return "正在提交1688官方图搜…";
    if (job.state === "searching" || job.enrichment_state === "running") return "正在匹配同款货源…";
    if (job.state === "ready") return job.results?.length ? `找到 ${job.results.length} 条1688货源` : "1688本次没有返回货源";
    if (job.state === "needs-auth") return job.auth_issue === "challenge" ? "1688暂时限制访问" : "需要连接1688";
    return job.state === "cancelled" ? "搜索已取消" : "搜索失败";
  }
  function ensurePanel() {
    if (panelHost?.isConnected) return;
    panelHost = document.createElement("aside"); panelHost.id = PANEL_ID;
    panelHost.style.cssText = "position:fixed;left:0;top:0;bottom:0;z-index:2147483644;";
    panelShadow = panelHost.attachShadow({ mode: "open" }); document.documentElement.appendChild(panelHost);
  }
  async function startSourcing(product, dataUrl) {
    panelDismissed = false; ensurePanel(); cropMode = false;
    const stored = await safeStorageGet("crawlHub.1688ImageSearchNotice.v1");
    if (contextInvalidatedHandled) return;
    firstNotice = !stored?.["crawlHub.1688ImageSearchNotice.v1"];
    if (firstNotice) await safeStorageSet({ "crawlHub.1688ImageSearchNotice.v1": true });
    if (contextInvalidatedHandled) return;
    currentJob = { source_product_id: product.product_id, source_title: product.title, source_image_url: product.image_url, query_image_data_url: dataUrl || "", state: "preparing-image", results: [] };
    render();
    const response = await safeRuntimeMessage({ type: "START_1688_IMAGE_SEARCH", product, query_image_data_url: dataUrl });
    if (!response?.ok && currentJob) { currentJob.state = "failed"; currentJob.error = response?.error || "无法启动1688图搜。"; render(); }
  }

  function card(result, index) {
    const image = result.image_url
      ? `<img data-source="${escape(result.image_url)}" src="${escape(result.image_url)}" alt="" decoding="async" referrerpolicy="no-referrer">`
      : '<span class="no-image">暂无图片</span>';
    return `<article class="card" data-offer="${escape(result.offer_id)}" tabindex="0" role="link"><div class="pic"><i class="rank">${index + 1}</i>${image}</div><div class="meta"><h3>${escape(result.title)}</h3><b class="price">${escape(result.price?.display || "—")}</b><div class="facts"><span>销量 ${escape(result.sales || "—")}</span><span>起批 ${escape(result.minimum_order || "—")}</span><span>回头率 ${escape(result.repurchase_rate || "—")}</span>${result.shipping_time ? `<span>发货 ${escape(result.shipping_time)}</span>` : ""}${result.supplier_years ? `<span>店龄 ${escape(result.supplier_years)}</span>` : ""}</div><div class="badges">${result.badges?.length ? result.badges.map((item) => `<em>${escape(item)}</em>`).join("") : ""}</div><footer>${escape(result.supplier_name || "供应商未显示")} <b>↗</b></footer></div></article>`;
  }
  const style = `:host{all:initial}*{box-sizing:border-box}.panel{width:min(820px,calc(100vw - 54px));height:100vh;background:#292929;color:#f5f5f5;box-shadow:16px 0 42px #0006;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;display:flex;flex-direction:column}.head{min-height:61px;display:flex;align-items:center;gap:14px;padding:0 15px;background:#303030;border-bottom:1px solid #464646}.brand{color:#ff5a83;font-size:18px;font-weight:800}.state{color:#c4c9c7;font-size:12px}.actions{margin-left:auto;display:flex;gap:7px}.icon{width:33px;height:33px;border:1px solid #555;border-radius:7px;background:#373737;color:#fff;cursor:pointer}.body{display:flex;min-height:0;flex:1}.side{width:205px;padding:13px;background:#2e2e2e;border-right:1px solid #464646;overflow:auto}.query{width:100%;height:170px;object-fit:contain;background:#fff;border-radius:5px}.title{margin:10px 0 3px;font-size:12px}.id{font-size:11px;color:#aaa}.btn{width:100%;margin-top:9px;padding:9px;border:1px solid #666;border-radius:6px;background:#3d3d3d;color:#fff;cursor:pointer;font-weight:700}.btn.primary{background:#e60046;border-color:#e60046}.notice{margin-top:12px;padding:9px;background:#443138;color:#ffd0dc;border-radius:6px;font-size:11px}.results{flex:1;min-width:0;display:flex;flex-direction:column}.toolbar{padding:12px 15px;border-bottom:1px solid #464646;color:#ff9ab5}.scroll{overflow:auto;padding:14px;flex:1}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.card{overflow:hidden;background:#353535;border:1px solid #4a4a4a;border-radius:7px;cursor:pointer}.card:hover{border-color:#ff5a83}.pic{position:relative;width:100%;height:220px;overflow:hidden;background:#fff;color:#777;font-size:11px;display:flex;align-items:center;justify-content:center}.pic img{display:block;width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain}.rank{position:absolute;z-index:2;top:9px;left:9px;background:#fff;color:#555;width:23px;height:23px;border-radius:50%;text-align:center;font-style:normal;line-height:23px}.no-image,.image-error{color:#777}.meta{position:relative;background:#353535;padding:10px;border-top:1px solid #505050}.card h3{height:38px;overflow:hidden;margin:0 0 5px;font-size:12px;line-height:19px}.price{color:#ff7197}.facts{display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-top:7px;color:#b8bebc;font-size:10px}.badges{display:flex;gap:3px;overflow:hidden;min-height:0;margin-top:6px}.badges:empty{display:none}.badges em{font-style:normal;background:#523840;color:#ffb5ca;padding:1px 4px;border-radius:3px;font-size:10px;white-space:nowrap}.card footer{margin-top:7px;padding-top:6px;border-top:1px solid #484848;color:#bbb;font-size:10px;display:flex}.card footer b{margin-left:auto;color:#ff7297}.empty,.error,.loading{max-width:480px;margin:45px auto;text-align:center;padding:22px;color:#c4c9c7}.error{border:1px solid #92536a;background:#443138;border-radius:8px;color:#ffd2de}.error button{display:block;width:100%;margin-top:9px;padding:9px;border:0;border-radius:6px;background:#e60046;color:#fff;cursor:pointer}.error button.alt{background:#5a454c}.spinner{width:36px;height:36px;margin:0 auto 12px;border:4px solid #555;border-top-color:#ff5a83;border-radius:50%;animation:spin .8s linear infinite}.crop canvas{display:block;width:100%;background:#fff;touch-action:none}.cropbox{position:absolute;display:none;border:2px solid #ff5a83;background:#ff5a8333;pointer-events:none}.canvas{position:relative}.collapsed{position:fixed;top:42%;left:0;border:0;border-radius:0 8px 8px 0;background:#e60046;color:#fff;padding:12px 9px;writing-mode:vertical-rl;cursor:pointer}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:650px){.side{width:160px}.query{height:130px}.grid{grid-template-columns:1fr}.panel{width:calc(100vw - 24px)}}`;
  function resultFactsMarkup(result) { return `<span>销量 ${escape(result.sales || "—")}</span><span>起批 ${escape(result.minimum_order || "—")}</span><span>回头率 ${escape(result.repurchase_rate || "—")}</span>${result.shipping_time ? `<span>发货 ${escape(result.shipping_time)}</span>` : ""}${result.supplier_years ? `<span>店龄 ${escape(result.supplier_years)}</span>` : ""}`; }
  function updateResultCard(element, result, index) {
    element.dataset.offer = result.offer_id;
    const rank = element.querySelector(".rank"); if (rank) rank.textContent = String(index + 1);
    const title = element.querySelector("h3"); if (title) title.textContent = result.title || "—";
    const price = element.querySelector(".price"); if (price) price.textContent = result.price?.display || "—";
    const facts = element.querySelector(".facts"); if (facts) facts.innerHTML = resultFactsMarkup(result);
    const badges = element.querySelector(".badges"); if (badges) badges.innerHTML = result.badges?.map((item) => `<em>${escape(item)}</em>`).join("") || "";
    const footer = element.querySelector("footer"); if (footer) footer.innerHTML = `${escape(result.supplier_name || "供应商未显示")} <b>↗</b>`;
    const pic = element.querySelector(".pic");
    const image = pic?.querySelector("img");
    if (!image && result.image_url && pic) {
      pic.querySelector(".no-image")?.remove();
      const nextImage = document.createElement("img");
      nextImage.alt = ""; nextImage.decoding = "async"; nextImage.referrerPolicy = "no-referrer";
      nextImage.dataset.source = result.image_url;
      pic.appendChild(nextImage);
      bindResultImage(nextImage);
      nextImage.src = result.image_url;
    } else if (image && result.image_url && (image.hidden || pic?.querySelector(".image-error")) && result.image_url !== image.dataset.source) {
      image.dataset.source = result.image_url;
      image.hidden = false;
      image.removeAttribute("data-retry-count");
      image.removeAttribute("data-image-final-state");
      pic?.querySelector(".image-error")?.remove();
      image.src = result.image_url;
    }
  }
  function resultImageDetails(image) {
    const source_url = image.dataset.source || image.currentSrc || image.src || "";
    let host = "";
    try { host = new URL(source_url).host; } catch { /* Keep diagnostics usable for malformed URLs. */ }
    return { offer_id: image.closest(".card")?.dataset.offer || "", host, source_url };
  }
  function recordResultImageHost(image, outcome) {
    if (image.dataset.imageFinalState === outcome) return;
    image.dataset.imageFinalState = outcome;
    const { host } = resultImageDetails(image);
    const stats = resultImageHostStats.get(host) || { loaded: 0, failed: 0 };
    stats[outcome] += 1;
    resultImageHostStats.set(host, stats);
    globalThis.__crawlHub1688ImageHostStats = Object.fromEntries(resultImageHostStats);
    console.debug("[CrawlHub][1688 image] host stats", globalThis.__crawlHub1688ImageHostStats);
  }
  function bindResultImage(image) {
    if (!image) return;
    if (!image.dataset.source) image.dataset.source = image.getAttribute("src") || "";
    image.onload = () => {
      image.hidden = false;
      image.closest(".pic")?.querySelector(".image-error")?.remove();
      const { offer_id, host } = resultImageDetails(image);
      console.debug("[CrawlHub][1688 image] loaded", { offer_id, host });
      recordResultImageHost(image, "loaded");
    };
    image.onerror = () => {
      const { offer_id, host, source_url } = resultImageDetails(image);
      if (image.dataset.retryCount !== "1") {
        image.dataset.retryCount = "1";
        console.debug("[CrawlHub][1688 image] retry", { offer_id, host });
        setTimeout(() => {
          if (!image.isConnected || image.dataset.source !== source_url) return;
          image.removeAttribute("src");
          requestAnimationFrame(() => { if (image.isConnected && image.dataset.source === source_url) image.src = source_url; });
        }, 400);
        return;
      }
      image.hidden = true;
      const pic = image.closest(".pic");
      if (pic && !pic.querySelector(".image-error")) {
        const message = document.createElement("span"); message.className = "image-error"; message.textContent = "图片加载失败"; pic.appendChild(message);
      }
      console.debug("[CrawlHub][1688 image] failed", { offer_id, host, source_url });
      recordResultImageHost(image, "failed");
    };
  }
  function bindResultCards() {
    for (const element of panelShadow.querySelectorAll(".card")) {
      bindResultImage(element.querySelector(".pic img"));
      if (element.dataset.bound === "true") continue;
      element.dataset.bound = "true";
      const open = () => void safeRuntimeMessage({ type: "OPEN_1688_OFFER", offer_id: element.dataset.offer });
      element.addEventListener("click", open);
      element.addEventListener("keydown", (event) => { if (event.key === "Enter") open(); });
    }
  }
  function updateResultCards(results) {
    const grid = panelShadow?.querySelector(".grid");
    if (!grid) return false;
    const existing = new Map([...grid.querySelectorAll(".card")].map((element) => [element.dataset.offer, element]));
    results.forEach((result, index) => {
      const element = existing.get(result.offer_id);
      if (element) updateResultCard(element, result, index);
      else {
        const template = document.createElement("template"); template.innerHTML = card(result, index).trim();
        grid.appendChild(template.content.firstElementChild);
      }
    });
    const state = panelShadow.querySelector(".state"); if (state) state.textContent = stateText(currentJob);
    const toolbar = panelShadow.querySelector(".toolbar"); if (toolbar) toolbar.textContent = `1688 推荐顺序 · ${results.length} 条结果`;
    bindResultCards();
    return true;
  }
  function render() {
    if (!panelShadow) return;
    const incomingResults = currentJob?.results || [];
    if (incomingResults.length && panelShadow.querySelector(".grid") && !cropMode && updateResultCards(incomingResults)) return;
    const job = currentJob, results = job?.results || [], image = job?.query_image_data_url || job?.source_image_url || "";
    const working = job && ["preparing-image", "uploading", "searching"].includes(job.state), auth = job?.state === "needs-auth", challenge = job?.auth_issue === "challenge", failed = job?.state === "failed";
    panelShadow.innerHTML = `<style>${style}</style><section class="panel"><header class="head"><b class="brand">CrawlHub <small>1688官方图搜</small></b><span class="state">${escape(stateText(job))}</span><div class="actions"><button class="icon" data-collapse title="折叠">‹</button><button class="icon" data-close title="关闭">×</button></div></header><div class="body"><aside class="side">${cropMode ? '<div class="crop"><div class="canvas"><canvas></canvas><div class="cropbox"></div></div><p>拖动框选商品主体</p><button class="btn primary" data-crop-apply>用框选区域重搜</button><button class="btn" data-crop-cancel>取消</button></div>' : `${image ? `<img class="query" src="${escape(image)}" alt="搜索图片">` : ""}<div class="title">${escape(job?.source_title || "尚未选择商品")}</div><div class="id">商品 ID：${escape(job?.source_product_id || "")}</div><button class="btn" data-crop ${!image || working ? "disabled" : ""}>框选主体</button><button class="btn primary" data-retry ${!job || working ? "disabled" : ""}>重新搜索</button>${firstNotice ? '<div class="notice">当前商品图片会提交给1688官方图搜，用于查找相似货源。</div>' : ""}`}</aside><main class="results"><div class="toolbar">1688 推荐顺序 ${results.length ? `· ${results.length} 条结果` : ""}</div><div class="scroll">${auth ? `<div class="error"><b>${challenge ? "1688暂时限制访问" : "需要连接1688"}</b><p>${challenge ? "请在已有的1688页面完成验证，插件不会绕过验证。" : "请在当前浏览器完成1688登录，完成后会自动继续本次搜图。"}</p><button data-recheck>${challenge ? "我已完成验证，重新检测" : "我已登录，重新检测"}</button><button class="alt" data-login>${challenge ? "打开已有1688页面" : "连接1688"}</button></div>` : failed ? `<div class="error">${escape(job.error || "1688图搜暂时失败。")}<button data-official>打开1688官方搜图页</button></div>` : working ? `<div class="loading"><div class="spinner"></div>${escape(stateText(job))}</div>` : results.length ? `<div class="grid">${results.map(card).join("")}</div>` : `<div class="empty">${escape(job?.error || "1688本次没有返回相似货源，可以框选商品主体后重新搜索。")}</div>`}</div></main></div></section>`;
    bindPanel(); if (cropMode) void initializeCrop();
  }
  function bindPanel() {
    panelShadow.querySelector("[data-close]")?.addEventListener("click", () => closeSourcingPanel({ cancelJob: true }));
    panelShadow.querySelector("[data-collapse]")?.addEventListener("click", () => { panelShadow.innerHTML = `<style>${style}</style><button class="collapsed">1688货源 ›</button>`; panelShadow.querySelector("button")?.addEventListener("click", render); });
    panelShadow.querySelector("[data-retry]")?.addEventListener("click", () => { if (currentJob) void startSourcing({ product_id: currentJob.source_product_id, title: currentJob.source_title, image_url: currentJob.source_image_url }, currentJob.query_image_data_url || undefined); });
    panelShadow.querySelector("[data-crop]")?.addEventListener("click", () => void openCrop());
    panelShadow.querySelector("[data-crop-cancel]")?.addEventListener("click", () => { cropMode = false; render(); });
    panelShadow.querySelector("[data-recheck]")?.addEventListener("click", () => void safeRuntimeMessage({ type: "RECHECK_1688_LOGIN" }));
    panelShadow.querySelector("[data-login]")?.addEventListener("click", () => void safeRuntimeMessage({ type: "REOPEN_1688_LOGIN" }));
    panelShadow.querySelector("[data-official]")?.addEventListener("click", () => void safeRuntimeMessage({ type: "OPEN_1688_OFFICIAL_SEARCH" }));
    bindResultCards();
  }
  async function openCrop() {
    if (!currentJob) return; cropSource = currentJob.query_image_data_url;
    if (!cropSource) { const response = await safeRuntimeMessage({ type: "PREPARE_SOURCE_IMAGE", image_url: currentJob.source_image_url }); if (!response?.ok) { currentJob.state = "failed"; currentJob.error = response?.error || "无法读取原图。"; render(); return; } cropSource = response.data_url; }
    cropMode = true; render();
  }
  async function initializeCrop() {
    const canvas = panelShadow.querySelector("canvas"), box = panelShadow.querySelector(".cropbox"); if (!canvas || !box || !cropSource) return;
    const image = new Image(); image.src = cropSource; await image.decode().catch(() => undefined); canvas.width = image.naturalWidth || image.width; canvas.height = image.naturalHeight || image.height; canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    let sx = 0, sy = 0, ex = 0, ey = 0, dragging = false;
    const point = (event) => { const rect = canvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)), y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)) }; };
    const paint = () => { box.style.display = "block"; box.style.left = `${Math.min(sx, ex)}px`; box.style.top = `${Math.min(sy, ey)}px`; box.style.width = `${Math.abs(ex - sx)}px`; box.style.height = `${Math.abs(ey - sy)}px`; };
    canvas.addEventListener("pointerdown", (event) => { const value = point(event); sx = ex = value.x; sy = ey = value.y; dragging = true; canvas.setPointerCapture(event.pointerId); paint(); });
    canvas.addEventListener("pointermove", (event) => { if (!dragging) return; const value = point(event); ex = value.x; ey = value.y; paint(); });
    canvas.addEventListener("pointerup", (event) => { dragging = false; canvas.releasePointerCapture(event.pointerId); });
    panelShadow.querySelector("[data-crop-apply]")?.addEventListener("click", () => { const rect = canvas.getBoundingClientRect(), x = Math.min(sx, ex) * canvas.width / rect.width, y = Math.min(sy, ey) * canvas.height / rect.height, width = Math.abs(ex - sx) * canvas.width / rect.width, height = Math.abs(ey - sy) * canvas.height / rect.height; if (width < 20 || height < 20 || !currentJob) return; const output = document.createElement("canvas"); output.width = Math.round(width); output.height = Math.round(height); output.getContext("2d")?.drawImage(canvas, x, y, width, height, 0, 0, output.width, output.height); void startSourcing({ product_id: currentJob.source_product_id, title: currentJob.source_title, image_url: currentJob.source_image_url }, output.toDataURL("image/jpeg", .88)); });
  }

  addEventListener("popstate", () => { if (!isProductPage()) stopTikTokImageSearch({ cancelJob: true }); });
  addEventListener("pagehide", () => {
    pageIsLeaving = true;
    stopTikTokImageSearch({ cancelJob: false });
  });

  if (!hasExtensionRuntime()) {
    handleInvalidExtensionContext();
  } else {
    try {
      chrome.runtime.onMessage.addListener((message) => {
        if (message?.type !== "SOURCING_JOB_UPDATED" || !message.job) return;
        currentJob = message.job;
        if (currentJob.state !== "cancelled" && !panelDismissed) { ensurePanel(); render(); }
      });
      chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes[ENABLED_KEY]) changes[ENABLED_KEY].newValue !== false ? startTikTokImageSearch() : stopTikTokImageSearch({ cancelJob: true }); });
    } catch (error) {
      if (isExtensionContextInvalidated(error)) handleInvalidExtensionContext();
      else console.error("[CrawlHub] Failed to register extension listeners", error);
    }
  }

  if (!globalThis.__crawlHubTikTokImageSearchInstalled && isProductPage()) {
    globalThis.__crawlHubTikTokImageSearchInstalled = true;
    void safeStorageGet(ENABLED_KEY).then((stored) => { if (!contextInvalidatedHandled && stored?.[ENABLED_KEY] !== false) startTikTokImageSearch(); });
    void safeRuntimeMessage({ type: "GET_1688_IMAGE_SEARCH_JOB" }).then((response) => { if (!contextInvalidatedHandled && response?.job && response.job.state !== "cancelled") { currentJob = response.job; ensurePanel(); render(); } });
  }
})();
