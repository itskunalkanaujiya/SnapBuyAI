// The app was called SnapBuy AI, and its browser storage keys started with
// "snapbuy-ai-". Move anything saved under an old key to its "vistora-" key
// once, so saved items, watches and photos survive the rename. Imported
// first in main.jsx, before anything reads storage.
const OLD_PREFIX = "snapbuy-ai-";
const NEW_PREFIX = "vistora-";

try {
  const oldKeys = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(OLD_PREFIX)) oldKeys.push(key);
  }
  for (const key of oldKeys) {
    const newKey = NEW_PREFIX + key.slice(OLD_PREFIX.length);
    if (localStorage.getItem(newKey) === null) localStorage.setItem(newKey, localStorage.getItem(key));
    localStorage.removeItem(key);
  }
} catch {
  // Storage is unavailable (private mode); nothing to move.
}
