// Background service worker. Small for now; later it handles update checks.
chrome.runtime.onInstalled.addListener((details) => {
  console.log(`CheckMate ${chrome.runtime.getManifest().version} ${details.reason}`);
});
