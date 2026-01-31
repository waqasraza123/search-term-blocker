const DEFAULTS = Object.freeze({
  enabled: true,
  behavior: "close", // "close" | "newtab" | "blockpage"
  blockedTerms: ["news"],
  engines: {
    google: true,
    bing: true,
    duckduckgo: true,
    brave: true,
  },
  maxTerms: 150,
});

const BLOCKED_PAGE = "/blocked.html";

let updateInProgress = false;
let updateQueued = false;

function normalizeTerms(input) {
  const raw = Array.isArray(input) ? input.join("\n") : String(input || "");
  const parts = raw
    .split(/[\n,]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.toLowerCase());

  // De-dupe while preserving order
  const seen = new Set();
  const out = [];
  for (const t of parts) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

function escapeRegexLiteral(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Build a RE2-friendly pattern that matches common URL encodings for spaces.
function buildTermRegex(term) {
  const clean = term.trim().toLowerCase();
  if (!clean) return null;

  const hasSpace = /\s/.test(clean);

  const literal = escapeRegexLiteral(clean);
  const encoded = escapeRegexLiteral(encodeURIComponent(clean));
  const plusEncoded = escapeRegexLiteral(clean.replace(/\s+/g, "+"));

  if (!hasSpace) {
    // Include both literal and encoded forms (helps non-ascii / special chars).
    // Most ASCII terms will be identical, but that’s fine.
    if (literal === encoded) return literal;
    return `(?:${literal}|${encoded})`;
  }

  // If term contains spaces, match:
  // - plus-separated tokens: "world+news"
  // - %20 separated tokens: "world%20news"
  // - encodeURIComponent form (usually %20)
  const tokens = clean.split(/\s+/).map(escapeRegexLiteral).filter(Boolean);
  const spaced = tokens.join("(?:\\+|%20)+");

  // Avoid a giant alternation if they’re identical (rare)
  const variants = new Set([spaced, encoded, plusEncoded].filter(Boolean));
  if (variants.size === 1) return [...variants][0];

  return `(?:${[...variants].join("|")})`;
}

function engineBaseRegex(engineKey) {
  // Match only main search URLs where q= contains the term.
  // Use a conservative query match: after ?, optionally "...&", then q=VALUE
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

function buildRules(config) {
  const enabledEngines = Object.entries(config.engines || {})
    .filter(([, v]) => v === true)
    .map(([k]) => k);

  const terms = normalizeTerms(config.blockedTerms).slice(
    0,
    Number(config.maxTerms) || DEFAULTS.maxTerms,
  );

  const rules = [];
  let id = 1;

  for (const engine of enabledEngines) {
    const base = engineBaseRegex(engine);
    if (!base) continue;

    for (const term of terms) {
      const termRegex = buildTermRegex(term);
      if (!termRegex) continue;

      const regexFilter = base.replace("__TERM__", termRegex);

      rules.push({
        id: id++,
        priority: 1,
        action: {
          type: "redirect",
          redirect: { extensionPath: BLOCKED_PAGE },
        },
        condition: {
          regexFilter,
          isUrlFilterCaseSensitive: false,
          resourceTypes: ["main_frame"],
        },
      });

      // Safety: Chrome caps dynamic rules; stop before hitting limits.
      if (rules.length >= 4500) return rules;
    }
  }

  return rules;
}

async function getConfig() {
  const stored = await chrome.storage.sync.get(DEFAULTS);

  const cfg = {
    enabled: Boolean(stored.enabled),
    behavior: ["close", "newtab", "blockpage"].includes(stored.behavior)
      ? stored.behavior
      : DEFAULTS.behavior,
    blockedTerms: Array.isArray(stored.blockedTerms)
      ? stored.blockedTerms
      : DEFAULTS.blockedTerms,
    engines:
      typeof stored.engines === "object" && stored.engines
        ? stored.engines
        : DEFAULTS.engines,
    maxTerms: Number.isFinite(stored.maxTerms)
      ? stored.maxTerms
      : DEFAULTS.maxTerms,
  };

  return cfg;
}

async function removeAllDynamicRules() {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  if (!existing.length) return;

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
  });
}

async function applyRules() {
  const config = await getConfig();

  if (!config.enabled) {
    await removeAllDynamicRules();
    return;
  }

  const newRules = buildRules(config);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules: newRules,
  });
}

async function syncRulesDebounced() {
  if (updateInProgress) {
    updateQueued = true;
    return;
  }

  updateInProgress = true;
  try {
    await applyRules();
  } catch (err) {
    // Don’t crash the service worker on bad configs.
    console.error("Failed to apply rules:", err);
  } finally {
    updateInProgress = false;
    if (updateQueued) {
      updateQueued = false;
      // Run once more to pick up the latest changes.
      syncRulesDebounced();
    }
  }
}

// Close/redirect behavior after DNR redirects to blocked.html
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;

  const blockedUrl = chrome.runtime.getURL("blocked.html"); // no leading slash here
  if (!changeInfo.url.startsWith(blockedUrl)) return;

  const config = await getConfig();
  if (!config.enabled) return;

  if (config.behavior === "close") chrome.tabs.remove(tabId);
  else if (config.behavior === "newtab")
    chrome.tabs.update(tabId, { url: "chrome://newtab" });
});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await chrome.storage.sync.set(DEFAULTS);
  }
  syncRulesDebounced();
});

chrome.runtime.onStartup.addListener(() => {
  syncRulesDebounced();
});

chrome.storage.onChanged.addListener((_changes, areaName) => {
  if (areaName !== "sync") return;
  syncRulesDebounced();
});
