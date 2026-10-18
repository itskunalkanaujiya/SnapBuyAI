import { useEffect, useState } from "react";

const WORDS = ["product", "outfit", "deal", "look"];
const CHANGE_MS = 2400;

/** "Find any product / outfit / deal / look", the last word rolling over. */
export default function HeroHeadline() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
    const timer = setInterval(() => setIndex((current) => (current + 1) % WORDS.length), CHANGE_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <h1>
      Find any{" "}
      <span className="rotating-word" aria-live="off">
        <span className="sr-only">product</span>
        {WORDS.map((word, position) => (
          <span
            key={word}
            aria-hidden="true"
            className={`rotating-item ${position === index ? "is-current" : ""} ${
              position === (index + WORDS.length - 1) % WORDS.length ? "is-leaving" : ""
            }`}
          >
            {word}
          </span>
        ))}
      </span>
      <br />
      <span className="accent">from a single photo.</span>
    </h1>
  );
}
