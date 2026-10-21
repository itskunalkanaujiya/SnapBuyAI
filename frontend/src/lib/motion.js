import { useEffect, useState } from "react";

// Small motion helpers for the home page. The pointer glow and the typing
// text don't move the page around, so they run even when the device asks
// to reduce motion; the CSS stops parallax and tilt in that case.

/**
 * Pointer handler that writes the pointer position into CSS variables on
 * the element: --mx/--my in pixels (for a spotlight) and --px/--py from -1
 * to 1 (for parallax or tilt).
 */
export function trackPointer(event) {
  const element = event.currentTarget;
  const box = element.getBoundingClientRect();
  const x = event.clientX - box.left;
  const y = event.clientY - box.top;
  element.style.setProperty("--mx", `${x}px`);
  element.style.setProperty("--my", `${y}px`);
  element.style.setProperty("--px", ((x / box.width) * 2 - 1).toFixed(3));
  element.style.setProperty("--py", ((y / box.height) * 2 - 1).toFixed(3));
}

/** Put the element back at rest when the pointer leaves. */
export function resetPointer(event) {
  const element = event.currentTarget;
  element.style.setProperty("--px", "0");
  element.style.setProperty("--py", "0");
}

const TYPE_MS = 55;
const ERASE_MS = 28;
const HOLD_MS = 1600;

/**
 * Text that types itself: each phrase is typed, held, erased, then the next.
 * Returns the current text ("" while paused).
 */
export function useTypewriter(phrases, active = true) {
  const [text, setText] = useState("");

  useEffect(() => {
    if (!active || !phrases.length) return undefined;
    let phrase = 0;
    let length = 0;
    let erasing = false;
    let timer;

    const step = () => {
      const current = phrases[phrase];
      if (!erasing) {
        length += 1;
        setText(current.slice(0, length));
        if (length === current.length) {
          erasing = true;
          timer = setTimeout(step, HOLD_MS);
          return;
        }
        timer = setTimeout(step, TYPE_MS);
      } else {
        length -= 1;
        setText(current.slice(0, length));
        if (length === 0) {
          erasing = false;
          phrase = (phrase + 1) % phrases.length;
        }
        timer = setTimeout(step, ERASE_MS);
      }
    };
    timer = setTimeout(step, 600);
    return () => clearTimeout(timer);
  }, [phrases, active]);

  return active ? text : "";
}

const THEME_KEY = "snapbuy-ai-theme";

/** The colour theme ("dark" by default), applied to <html> and remembered. */
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem(THEME_KEY) || "dark";
    } catch {
      return "dark";
    }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#08080f" : "#ffffff");
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // The theme still applies for this visit.
    }
  }, [theme]);

  return [theme, () => setTheme((current) => (current === "dark" ? "light" : "dark"))];
}
