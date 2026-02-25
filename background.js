const ext = globalThis.browser ?? globalThis.chrome;

const DEFAULTS = Object.freeze({
  enabled: true,
  behavior: "close",
  blockedTerms: ["news"],
  blockedUrls: [],
  engines: { google: true, bing: true, duckduckgo: true, brave: true },
  maxTerms: 150,
  maxUrls: 150,
});

const BLOCKED_PAGE_URL = "blocked.html";

let cache = { cfg: null, compiled: null, ts: 0, p: null };
const CACHE_TTL_MS = 2000;

function normalizeList(input) {
  const raw = Array.isArray(input) ? input.join("\n") : String(input || "");
  const parts = raw
    .split(/[\n,]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const v = p.toLowerCase();
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function normalizeUrlInput(line) {
  let s = String(line || "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (/\s/.test(s)) return null;

  s = s.replace(/^view-source:/, "");
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^\/\//, "");
  s = s.split("#")[0];

  const firstSlash = s.indexOf("/");
  const firstQ = s.indexOf("?");
  let cut = -1;
  if (firstSlash >= 0 && firstQ >= 0) cut = Math.min(firstSlash, firstQ);
  else cut = Math.max(firstSlash, firstQ);

  let host = cut >= 0 ? s.slice(0, cut) : s;
  let rest = cut >= 0 ? s.slice(cut) : "";

  host = host.replace(/^www\./, "");
  host = host.replace(/\.+$/, "");
  if (!host) return null;

  if (rest === "/" || rest === "/.") rest = "";
  if (rest.endsWith("/")) rest = rest.slice(0, -1);
  if (rest && !rest.startsWith("/") && !rest.startsWith("?")) rest = `/${rest}`;

  return { host, rest };
}

function hostNoWww(host) {
  const h = String(host || "").toLowerCase();
  return h.startsWith("www.") ? h.slice(4) : h;
}

function normPath(pathname) {
  const p = String(pathname || "");
  if (p.length > 1 && p.endsWith("/")) return p.slice(0, -1);
  return p;
}

function compile(cfg) {
  const terms = normalizeList(cfg.blockedTerms).slice(0, cfg.maxTerms);
  const urlsRaw = normalizeList(cfg.blockedUrls).slice(0, cfg.maxUrls);
  const urls = [];
  for (const u of urlsRaw) {
    const parsed = normalizeUrlInput(u);
    if (parsed) urls.push(parsed);
  }
  return {
    enabled: !!cfg.enabled,
    behavior: cfg.behavior,
    engines: cfg.engines,
    terms,
    urls,
  };
}

async function getConfigFresh() {
  const stored = await ext.storage.sync.get(DEFAULTS);
  return {
    enabled: Boolean(stored.enabled),
    behavior: ["close", "newtab", "blockpage"].includes(stored.behavior)
      ? stored.behavior
      : DEFAULTS.behavior,
    blockedTerms: Array.isArray(stored.blockedTerms)
      ? stored.blockedTerms
      : DEFAULTS.blockedTerms,
    blockedUrls: Array.isArray(stored.blockedUrls)
      ? stored.blockedUrls
      : DEFAULTS.blockedUrls,
    engines:
      typeof stored.engines === "object" && stored.engines
        ? stored.engines
        : DEFAULTS.engines,
    maxTerms: Number.isFinite(stored.maxTerms)
      ? stored.maxTerms
      : DEFAULTS.maxTerms,
    maxUrls: Number.isFinite(stored.maxUrls)
      ? stored.maxUrls
      : DEFAULTS.maxUrls,
  };
}

async function getConfigCached() {
  const now = Date.now();
  if (cache.cfg && now - cache.ts < CACHE_TTL_MS) return cache.cfg;

  if (!cache.p) {
    cache.p = (async () => {
      const cfg = await getConfigFresh();
      cache.cfg = cfg;
      cache.compiled = compile(cfg);
      cache.ts = Date.now();
      cache.p = null;
      return cfg;
    })().catch((e) => {
      cache.p = null;
      throw e;
    });
  }

  return cache.p;
}

function matchesBlockedUrl(u, compiled) {
  const host = hostNoWww(u.hostname);
  const path = normPath(u.pathname);
  const full = path + (u.search || "");

  for (const item of compiled.urls) {
    if (host !== item.host) continue;
    if (!item.rest) return true;
    if (full.startsWith(item.rest)) return true;
  }
  return false;
}

function matchesSearchTerm(u, compiled) {
  const h = u.hostname.toLowerCase();
  const p = u.pathname;

  let qKey = null;
  if (compiled.engines.google && p === "/search" && /(^|\.)google\./.test(h))
    qKey = "q";
  else if (compiled.engines.bing && h === "www.bing.com" && p === "/search")
    qKey = "q";
  else if (
    compiled.engines.duckduckgo &&
    /(^|\.)duckduckgo\.com$/.test(h) &&
    p === "/"
  )
    qKey = "q";
  else if (
    compiled.engines.brave &&
    h === "search.brave.com" &&
    p === "/search"
  )
    qKey = "q";

  if (!qKey) return false;

  const q = String(u.searchParams.get(qKey) || "").toLowerCase();
  if (!q) return false;

  for (const t of compiled.terms) {
    if (t && q.includes(t)) return true;
  }
  return false;
}

function shouldBlock(urlStr, compiled) {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    return false;
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (matchesBlockedUrl(u, compiled)) return true;
  if (matchesSearchTerm(u, compiled)) return true;
  return false;
}

async function enforce(tabId, urlStr) {
  const cfg = await getConfigCached();
  if (!cfg.enabled) return;

  const compiled = cache.compiled || compile(cfg);
  if (!compiled.enabled) return;

  const blockedUrl = ext.runtime.getURL(BLOCKED_PAGE_URL);
  if (String(urlStr || "").startsWith(blockedUrl)) return;

  if (!shouldBlock(urlStr, compiled)) return;

  if (cfg.behavior === "close") {
    ext.tabs.remove(tabId);
    return;
  }

  if (cfg.behavior === "newtab") {
    ext.tabs.update(tabId, { url: "about:newtab" });
    return;
  }

  const dest = blockedUrl + "?src=" + encodeURIComponent(urlStr);
  ext.tabs.update(tabId, { url: dest });
}

if (ext.webNavigation?.onBeforeNavigate) {
  ext.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId !== 0) return;
    if (!details.url) return;
    enforce(details.tabId, details.url);
  });
}

if (ext.tabs?.onUpdated) {
  ext.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!changeInfo.url) return;
    enforce(tabId, changeInfo.url);
  });
}

if (ext.storage?.onChanged) {
  ext.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName !== "sync") return;
    cache = { cfg: null, compiled: null, ts: 0, p: null };
  });
}
