const ext = globalThis.browser ?? globalThis.chrome;

document.getElementById("openOptions").addEventListener("click", () => {
  ext.runtime.openOptionsPage();
});
