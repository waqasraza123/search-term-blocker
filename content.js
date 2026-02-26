const ext = globalThis.browser ?? globalThis.chrome;

const DEFAULTS = Object.freeze({ hideVideos: false });

const VIDEO_HOST_RE =
  /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com|player\.vimeo\.com|loom\.com)$/i;
const IFRAME_SRC_RE =
  /(youtube\.com|youtu\.be|youtube-nocookie\.com|player\.vimeo\.com|vimeo\.com|loom\.com)/i;

let enabled = false;
let observer = null;

const originalToPlaceholder = new WeakMap();
const placeholderToOriginal = new WeakMap();

function storageGet(keys) {
  try {
    const r = ext.storage.sync.get(keys);
    if (r && typeof r.then === "function") return r;
  } catch {}
  return new Promise((resolve, reject) => {
    ext.storage.sync.get(keys, (res) => {
      const err = ext.runtime?.lastError;
      if (err) reject(new Error(err.message || String(err)));
      else resolve(res);
    });
  });
}

function ensureStyle() {
  if (document.getElementById("stb-video-style")) return;
  const style = document.createElement("style");
  style.id = "stb-video-style";
  style.textContent = `
    .stb-video-placeholder {
      background: #111 !important;
      color: #fff !important;
      border-radius: 10px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font: 600 14px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial !important;
      letter-spacing: .12em !important;
      text-transform: lowercase !important;
      user-select: none !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
    }
  `;
  (document.documentElement || document.head || document.body).appendChild(
    style,
  );
}

function dimFromAttr(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?%$/.test(s)) return s;
  if (/^\d+(\.\d+)?$/.test(s)) return `${s}px`;
  if (/^\d+(\.\d+)?(px|rem|em|vh|vw)$/.test(s)) return s;
  return null;
}

function isVideoTarget(el) {
  if (!el || el.nodeType !== 1) return false;

  const tag = el.tagName;
  if (tag === "VIDEO") return true;

  if (tag === "IFRAME") {
    const src = (
      el.getAttribute("src") ||
      el.getAttribute("data-src") ||
      ""
    ).toLowerCase();
    if (!src) return false;
    return IFRAME_SRC_RE.test(src);
  }

  if (tag === "EMBED" || tag === "OBJECT") {
    const src = (
      el.getAttribute("src") ||
      el.getAttribute("data") ||
      ""
    ).toLowerCase();
    if (!src) return false;
    return IFRAME_SRC_RE.test(src);
  }

  return false;
}

function buildPlaceholder(el) {
  const ph = document.createElement("div");
  const cls = (el.getAttribute("class") || "").trim();
  ph.setAttribute("data-stb-video", "1");
  ph.className = cls ? `${cls} stb-video-placeholder` : "stb-video-placeholder";
  ph.textContent = "video";

  const cssText = el.getAttribute("style");
  if (cssText) ph.setAttribute("style", cssText);

  const w = dimFromAttr(el.getAttribute("width"));
  const h = dimFromAttr(el.getAttribute("height"));

  if (w && !ph.style.width) ph.style.width = w;
  if (h && !ph.style.height) ph.style.height = h;

  if (!ph.style.width) ph.style.width = "100%";
  if (!ph.style.height && !ph.style.aspectRatio) {
    let ratio = null;
    try {
      const r = el.getBoundingClientRect();
      if (r.width > 20 && r.height > 20) ratio = r.width / r.height;
    } catch {}

    if (!ratio && w && h && w.endsWith("px") && h.endsWith("px")) {
      const wn = parseFloat(w);
      const hn = parseFloat(h);
      if (wn > 0 && hn > 0) ratio = wn / hn;
    }

    if (ratio && Number.isFinite(ratio) && ratio > 0.1 && ratio < 10) {
      const a = Math.max(100, Math.round(ratio * 1000));
      ph.style.aspectRatio = `${a} / 1000`;
    } else {
      ph.style.aspectRatio = "16 / 9";
    }

    if (!ph.style.minHeight) ph.style.minHeight = "160px";
  }

  ph.setAttribute("aria-label", "video");
  return ph;
}

function mask(el) {
  if (!el || !el.isConnected) return;
  if (originalToPlaceholder.has(el)) return;
  if (el.closest && el.closest('[data-stb-video="1"]')) return;

  ensureStyle();

  const ph = buildPlaceholder(el);
  placeholderToOriginal.set(ph, el);
  originalToPlaceholder.set(el, ph);

  try {
    el.replaceWith(ph);
  } catch {
    try {
      const parent = el.parentNode;
      if (parent) parent.replaceChild(ph, el);
    } catch {}
  }
}

function unmaskAll() {
  const placeholders = document.querySelectorAll('[data-stb-video="1"]');
  for (const ph of placeholders) {
    const orig = placeholderToOriginal.get(ph);
    if (!orig) continue;
    try {
      ph.replaceWith(orig);
    } catch {
      try {
        const parent = ph.parentNode;
        if (parent) parent.replaceChild(orig, ph);
      } catch {}
    }
    placeholderToOriginal.delete(ph);
    originalToPlaceholder.delete(orig);
  }
}

function scan(root) {
  const node = root && root.nodeType === 1 ? root : document.documentElement;
  if (!node) return;

  if (isVideoTarget(node)) mask(node);

  const list = node.querySelectorAll
    ? node.querySelectorAll("video,iframe,embed,object")
    : [];
  for (const el of list) {
    if (isVideoTarget(el)) mask(el);
  }
}

function start() {
  if (observer) return;
  scan(document.documentElement);

  observer = new MutationObserver((muts) => {
    if (!enabled) return;
    for (const m of muts) {
      if (m.type === "childList") {
        for (const n of m.addedNodes) {
          if (n && n.nodeType === 1) scan(n);
        }
      } else if (m.type === "attributes") {
        const t = m.target;
        if (isVideoTarget(t)) mask(t);
      }
    }
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["src", "data", "data-src"],
  });
}

function stop() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  unmaskAll();
}

async function init() {
  const cfg = await storageGet(DEFAULTS);
  enabled = Boolean(cfg.hideVideos);

  if (enabled) start();

  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (!changes.hideVideos) return;

    enabled = Boolean(changes.hideVideos.newValue);
    if (enabled) start();
    else stop();
  });
}

(function boot() {
  const run = () => init().catch(() => {});
  if (document.documentElement) run();
  else document.addEventListener("DOMContentLoaded", run, { once: true });
})();
