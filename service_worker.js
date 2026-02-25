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

const BLOCKED_PAGE_PATH = "/blocked.html";
const BLOCKED_PAGE_URL = "blocked.html";
const RULE_LIMIT_SOFT = 4500;

let updateInProgress = false;
let updateQueued = false;

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

function escapeRegexLiteral(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildTermRegex(term) {
  const clean = term.trim().toLowerCase();
  if (!clean) return null;

  const hasSpace = /\s/.test(clean);
  const literal = escapeRegexLiteral(clean);
  const encoded = escapeRegexLiteral(encodeURIComponent(clean));
  const plusEncoded = escapeRegexLiteral(clean.replace(/\s+/g, "+"));

  if (!hasSpace) {
    if (literal === encoded) return literal;
    return `(?:${literal}|${encoded})`;
  }

  const tokens = clean.split(/\s+/).map(escapeRegexLiteral).filter(Boolean);
  const spaced = tokens.join("(?:\\+|%20)+");

  const variants = new Set([spaced, encoded, plusEncoded].filter(Boolean));
  if (variants.size === 1) return [...variants][0];

  return `(?:${[...variants].join("|")})`;
}

function engineBaseRegex(engineKey) {
  switch (engineKey) {
    case "google":
      return String.raw`^https?:\/\/(?:www\.)?google\.[^\/]+\/search\?(?:[^#]*&)?q=[^#&]*__TERM__[^#&]*`;
    case "bing":
      return String.raw`^https?:\/\/(?:www\.)?bing\.com\/search\?(?:[^#]*&)?q=[^#&]*__TERM__[^#&]*`;
    case "duckduckgo":
      return String.raw`^https?:\/\/(?:www\.)?duckduckgo\.com\/\?(?:[^#]*&)?q=[^#&]*__TERM__[^#&]*`;
    case "brave":
      return String.raw`^https?:\/\/search\.brave\.com\/search\?(?:[^#]*&)?q=[^#&]*__TERM__[^#&]*`;
    default:
      return null;
  }
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

function buildBlockedUrlRegex(host, rest) {
  const hostEsc = escapeRegexLiteral(host);
  if (!rest) return `^https?:\\/\\/(?:www\\.)?${hostEsc}(?:$|[\\/?#])`;
  const restEsc = escapeRegexLiteral(rest);
  return `^https?:\\/\\/(?:www\\.)?${hostEsc}${restEsc}`;
}

function buildRules(config) {
  const enabledEngines = Object.entries(config.engines || {})
    .filter(([, v]) => v === true)
    .map(([k]) => k);
  const terms = normalizeList(config.blockedTerms).slice(
    0,
    Number(config.maxTerms) || DEFAULTS.maxTerms,
  );
  const urlsRaw = normalizeList(config.blockedUrls).slice(
    0,
    Number(config.maxUrls) || DEFAULTS.maxUrls,
  );

  const normalizedUrls = [];
  for (const u of urlsRaw) {
    const parsed = normalizeUrlInput(u);
    if (parsed) normalizedUrls.push(parsed);
  }

  const rules = [];
  let id = 1;

  for (const engine of enabledEngines) {
    const base = engineBaseRegex(engine);
    if (!base) continue;

    for (const term of terms) {
      const termRegex = buildTermRegex(term);
      if (!termRegex) continue;

      rules.push({
        id: id++,
        priority: 1,
        action: {
          type: "redirect",
          redirect: { extensionPath: BLOCKED_PAGE_PATH },
        },
        condition: {
          regexFilter: base.replace("__TERM__", termRegex),
          isUrlFilterCaseSensitive: false,
          resourceTypes: ["main_frame"],
        },
      });

      if (rules.length >= RULE_LIMIT_SOFT) return rules;
    }
  }

  for (const { host, rest } of normalizedUrls) {
    rules.push({
      id: id++,
      priority: 1,
      action: {
        type: "redirect",
        redirect: { extensionPath: BLOCKED_PAGE_PATH },
      },
      condition: {
        regexFilter: buildBlockedUrlRegex(host, rest),
        isUrlFilterCaseSensitive: false,
        resourceTypes: ["main_frame"],
      },
    });

    if (rules.length >= RULE_LIMIT_SOFT) return rules;
  }

  return rules;
}

async function getConfig() {
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

async function removeAllDynamicRules() {
  if (!ext.declarativeNetRequest?.getDynamicRules) return;
  const existing = await ext.declarativeNetRequest.getDynamicRules();
  if (!existing.length) return;
  await ext.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
  });
}

async function applyRules() {
  if (!ext.declarativeNetRequest?.updateDynamicRules) return;

  const config = await getConfig();

  if (!config.enabled) {
    await removeAllDynamicRules();
    return;
  }

  const newRules = buildRules(config);
  const existing = await ext.declarativeNetRequest.getDynamicRules();

  await ext.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: newRules,
  });
}

async function syncRules() {
  if (updateInProgress) {
    updateQueued = true;
    return;
  }

  updateInProgress = true;
  try {
    await applyRules();
  } catch (err) {
    console.error("Failed to apply rules:", err);
  } finally {
    updateInProgress = false;
    if (updateQueued) {
      updateQueued = false;
      syncRules();
    }
  }
}

ext.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;

  const blockedUrl = ext.runtime.getURL(BLOCKED_PAGE_URL);
  if (!changeInfo.url.startsWith(blockedUrl)) return;

  const config = await getConfig();
  if (!config.enabled) return;

  if (config.behavior === "close") {
    ext.tabs.remove(tabId);
    return;
  }

  if (config.behavior === "newtab") {
    ext.tabs.update(tabId, { url: "chrome://newtab" });
  }
});

ext.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") await ext.storage.sync.set(DEFAULTS);
  syncRules();
});

ext.runtime.onStartup.addListener(() => {
  syncRules();
});

ext.storage.onChanged.addListener((_changes, areaName) => {
  if (areaName !== "sync") return;
  syncRules();
});
