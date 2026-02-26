const ext = globalThis.browser ?? globalThis.chrome;

const DEFAULTS = {
  enabled: true,
  hideVideos: false,
  behavior: "close",
  blockedTerms: ["news"],
  blockedUrls: [],
  engines: { google: true, bing: true, duckduckgo: true, brave: true },
  maxTerms: 150,
  maxUrls: 150,
};

function $(id) {
  return document.getElementById(id);
}

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

function storageSet(items) {
  try {
    const r = ext.storage.sync.set(items);
    if (r && typeof r.then === "function") return r;
  } catch {}
  return new Promise((resolve, reject) => {
    ext.storage.sync.set(items, () => {
      const err = ext.runtime?.lastError;
      if (err) reject(new Error(err.message || String(err)));
      else resolve();
    });
  });
}

function splitList(text) {
  return String(text || "")
    .split(/[\n,]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function load() {
  const cfg = await storageGet(DEFAULTS);

  $("enabled").checked = Boolean(cfg.enabled);
  $("hideVideos").checked = Boolean(cfg.hideVideos);

  $("terms").value = (cfg.blockedTerms || []).join("\n");
  $("urls").value = (cfg.blockedUrls || []).join("\n");

  $("google").checked = Boolean(cfg.engines?.google);
  $("bing").checked = Boolean(cfg.engines?.bing);
  $("duckduckgo").checked = Boolean(cfg.engines?.duckduckgo);
  $("brave").checked = Boolean(cfg.engines?.brave);

  const behavior = ["close", "newtab", "blockpage"].includes(cfg.behavior)
    ? cfg.behavior
    : DEFAULTS.behavior;
  document.querySelectorAll('input[name="behavior"]').forEach((r) => {
    r.checked = r.value === behavior;
  });
}

async function save() {
  const status = $("status");
  status.textContent = "";

  const behaviorEl = document.querySelector('input[name="behavior"]:checked');
  const behavior = behaviorEl ? behaviorEl.value : DEFAULTS.behavior;

  const blockedTerms = splitList($("terms").value);
  const blockedUrls = splitList($("urls").value);

  if (blockedTerms.length > DEFAULTS.maxTerms) {
    status.textContent = `Too many terms (max ${DEFAULTS.maxTerms}).`;
    return;
  }

  if (blockedUrls.length > DEFAULTS.maxUrls) {
    status.textContent = `Too many URLs (max ${DEFAULTS.maxUrls}).`;
    return;
  }

  const engines = {
    google: $("google").checked,
    bing: $("bing").checked,
    duckduckgo: $("duckduckgo").checked,
    brave: $("brave").checked,
  };

  await storageSet({
    enabled: $("enabled").checked,
    hideVideos: $("hideVideos").checked,
    behavior,
    blockedTerms,
    blockedUrls,
    engines,
  });

  status.textContent = "Saved.";
  setTimeout(() => (status.textContent = ""), 1200);
}

document.addEventListener("DOMContentLoaded", () => {
  load();
  $("save").addEventListener("click", save);
});
