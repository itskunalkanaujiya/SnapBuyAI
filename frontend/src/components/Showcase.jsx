import { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";

// Interactive "see it in action" section: one animated demo per way to shop.
// Demos are drawn with SVG and CSS, restart when their tab opens, and the
// tabs advance on their own until the visitor hovers or picks one.

const ADVANCE_MS = 7000;

const TABS = [
  {
    key: "photo",
    icon: "camera",
    label: "Photo search",
    title: "Snap it. We'll find where it's cheapest.",
    text: "Upload or paste any product photo. Google Lens recognises it, an AI image model ranks every listing by how closely it matches, and prices and stock are checked at each store.",
    points: ["Works with screenshots and camera photos", "Closest matches first, lowest prices alongside", "Results start appearing in seconds"],
    cta: "Upload a photo",
  },
  {
    key: "text",
    icon: "search",
    label: "Smart search",
    title: "Describe it the way you'd say it.",
    text: "Type a whole sentence: brand, specs, budget. AI understands what you mean and ranks listings by how many of your requirements they meet.",
    points: ["“under 50k”, “8GB RAM”, “for my mom” all understood", "Budgets are strict, specs are checked", "Plain keywords work too"],
    cta: "Try “HP laptop, 8GB RAM, under 50k”",
    example: "HP laptop with 8GB RAM and 512GB SSD under 50k",
  },
  {
    key: "outfit",
    icon: "shirt",
    label: "Find the outfit",
    title: "Love the look? Shop every piece.",
    text: "Upload a photo of anyone. AI spots each item they're wearing (top, trousers, shoes, watch, glasses, bag) and finds shopping options for every one, with the price of the whole look.",
    points: ["Every item found in about a second", "Options for each piece, side by side", "“Whole look from ₹…” at a glance"],
    cta: "Find an outfit",
  },
  {
    key: "tryon",
    icon: "sparkles",
    label: "Virtual try-on",
    title: "See it on you before you buy.",
    text: "Tap “Try on” on tops, kurtis, dresses or bottoms, add your photo, and AI shows you wearing it. Compare before and after with a slider.",
    points: ["Your own photo, realistic fit and fabric", "Before / after slider and download", "Works on clothes from your results"],
    cta: "Try on a kurti",
    example: "Cotton kurti for women",
  },
  {
    key: "live",
    icon: "camera",
    label: "Live 3D try-on",
    title: "Glasses and watches, live on camera.",
    text: "Sunglasses sit on your face and watches on your wrist, following you in 3D as you move. Everything runs on your phone or laptop; nothing is uploaded.",
    points: ["Follows your head and wrist in real time", "Real product photos, adjustable fit", "Save a picture to share"],
    cta: "Try on sunglasses",
    example: "Aviator sunglasses for men",
  },
];

/* ---------- Demos ---------- */

function PhotoDemo() {
  const rows = [
    ["Myntra", "₹1,299", "Very close"],
    ["Flipkart", "₹1,149", "Very close"],
    ["AJIO", "₹999", "Similar"],
  ];
  return (
    <div className="demo demo-photo-search">
      <div className="demo-shot">
        <svg viewBox="0 0 120 70" aria-hidden="true">
          <path d="M10 50c0-12 14-16 24-26l14-8c6 8 16 12 28 14l26 6c8 2 10 8 10 14z" fill="currentColor" />
          <path d="M26 40c14 2 34 2 58 4" stroke="#fb7185" strokeWidth="4" strokeLinecap="round" fill="none" />
          <rect x="8" y="50" width="106" height="10" rx="5" fill="#ffffff" />
          {[42, 50, 58].map((x) => (
            <path key={x} d={`M${x} ${20 + (x - 42) / 3}l6 4`} stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
          ))}
        </svg>
        <span className="demo-scanline" />
        <span className="demo-tag">Identified: running shoes</span>
      </div>
      <ul className="demo-rows">
        {rows.map(([store, price, match], index) => (
          <li key={store} style={{ "--i": index }}>
            <span className="demo-swatch" />
            <span className="demo-row-text">
              <strong>{store}</strong>
              <small>{match}</small>
            </span>
            <span className="demo-price">{price}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function useTypewriter(text, speed = 45) {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    let index = 0;
    const timer = setInterval(() => {
      index += 1;
      setTyped(text.slice(0, index));
      if (index >= text.length) clearInterval(timer);
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);
  return typed;
}

function TextDemo() {
  const sentence = "an hp laptop with 8gb ram and 512gb ssd under 50k";
  const typed = useTypewriter(sentence);
  const done = typed.length === sentence.length;
  const chips = ["HP", "Laptop", "8 GB RAM", "512 GB storage", "Under ₹50,000"];
  return (
    <div className="demo demo-text-search">
      <div className="demo-input">
        <Icon name="search" size={16} />
        <span>
          {typed}
          <span className="demo-caret" />
        </span>
      </div>
      <div className={`demo-understood ${done ? "is-done" : ""}`}>
        <span className="demo-understood-label">
          <Icon name="sparkles" size={12} /> Understood as
        </span>
        {chips.map((chip, index) => (
          <span key={chip} className="demo-chip" style={{ "--i": index }}>
            {chip}
          </span>
        ))}
      </div>
      <ul className={`demo-rows ${done ? "is-done" : ""}`}>
        {[
          ["HP 15s · 8GB · 512GB SSD", "₹38,990"],
          ["HP 255 G10 · 8GB · 512GB", "₹35,500"],
        ].map(([name, price], index) => (
          <li key={name} style={{ "--i": index + 5 }}>
            <span className="demo-swatch demo-swatch-laptop" />
            <span className="demo-row-text">
              <strong>{name}</strong>
              <small>Meets all 4 requirements</small>
            </span>
            <span className="demo-price">{price}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Person({ shirt = "#f2c94c", stripes = true, pants = "#2f4a7a", children }) {
  return (
    <svg className="demo-person" viewBox="0 0 120 200" aria-hidden="true">
      <circle cx="60" cy="26" r="16" fill="#e2b48c" />
      <path d="M44 20c2-12 30-14 32 0-6-4-24-4-32 0z" fill="#2b2b33" />
      <path d="M34 50c6-6 46-6 52 0l6 46H28z" fill={shirt} />
      {stripes &&
        [62, 72, 82].map((y) => <rect key={y} x="30" y={y} width="60" height="4" fill="#3b6fd8" opacity="0.8" />)}
      <rect x="24" y="52" width="10" height="40" rx="5" fill="#e2b48c" />
      <rect x="86" y="52" width="10" height="40" rx="5" fill="#e2b48c" />
      <path d="M32 96h56l-4 84H66l-6-60-6 60H36z" fill={pants} />
      <rect x="30" y="178" width="26" height="10" rx="5" fill="#1d1d24" />
      <rect x="64" y="178" width="26" height="10" rx="5" fill="#1d1d24" />
      <rect x="85" y="84" width="12" height="7" rx="2" fill="#c9ccd6" />
      {children}
    </svg>
  );
}

function OutfitDemo() {
  const items = [
    ["T-shirt", "₹304", { left: "50%", top: "36%" }],
    ["Jeans", "₹459", { left: "50%", top: "66%" }],
    ["Sneakers", "₹369", { left: "38%", top: "93%" }],
    ["Watch", "₹244", { left: "76%", top: "44%" }],
  ];
  return (
    <div className="demo demo-outfit">
      <div className="demo-figure">
        <Person />
        {items.map(([name, , position], index) => (
          <span key={name} className="demo-marker" style={{ ...position, "--i": index }}>
            {index + 1}
          </span>
        ))}
      </div>
      <div className="demo-outfit-side">
        <ul className="demo-rows">
          {items.map(([name, price], index) => (
            <li key={name} style={{ "--i": index + 1 }}>
              <span className="demo-number">{index + 1}</span>
              <span className="demo-row-text">
                <strong>{name}</strong>
              </span>
              <span className="demo-price">
                <small>from</small> {price}
              </span>
            </li>
          ))}
        </ul>
        <div className="demo-total" style={{ "--i": 6 }}>
          <Icon name="tag" size={14} /> Whole look from <strong>₹1,376</strong>
        </div>
      </div>
    </div>
  );
}

function TryOnDemo() {
  return (
    <div className="demo demo-tryon">
      <div className="demo-compare">
        <div className="demo-compare-layer">
          <Person shirt="#d9dce4" stripes={false} pants="#3a3f4f" />
        </div>
        <div className="demo-compare-layer demo-compare-after">
          <Person shirt="#9b2c3a" stripes={false} pants="#3a3f4f">
            {[58, 70, 82].map((y) => (
              <g key={y} fill="#f2c94c" opacity="0.85">
                <circle cx="44" cy={y} r="2.4" />
                <circle cx="60" cy={y + 4} r="2.4" />
                <circle cx="76" cy={y} r="2.4" />
              </g>
            ))}
          </Person>
        </div>
        <span className="demo-compare-handle" />
        <span className="demo-compare-tag tag-left">Before</span>
        <span className="demo-compare-tag tag-right">After</span>
      </div>
      <div className="demo-tryon-caption">
        <span className="demo-swatch demo-swatch-kurti" />
        <span className="demo-row-text">
          <strong>Maroon printed cotton kurti</strong>
          <small>Ready in about 20 seconds</small>
        </span>
      </div>
    </div>
  );
}

function LiveDemo() {
  return (
    <div className="demo demo-live">
      <div className="demo-camera">
        <span className="demo-live-badge">
          <span className="live-dot" /> Live
        </span>
        <svg className="demo-head" viewBox="0 0 160 160" aria-hidden="true">
          <g className="demo-head-move">
            <ellipse cx="80" cy="84" rx="40" ry="48" fill="#e2b48c" />
            <path d="M40 74c0-36 80-36 80 0-10-16-70-16-80 0z" fill="#2b2b33" />
            <path d="M68 116c8 6 16 6 24 0" stroke="#9a5b3c" strokeWidth="3" fill="none" strokeLinecap="round" />
            <g className="demo-glasses">
              <rect x="46" y="84" width="30" height="19" rx="9" fill="#1f2937" opacity="0.92" />
              <rect x="84" y="84" width="30" height="19" rx="9" fill="#1f2937" opacity="0.92" />
              <path d="M76 91h8" stroke="#c9a227" strokeWidth="3" />
              <path d="M50 88l8-2" stroke="#ffffff" strokeWidth="2" opacity="0.5" strokeLinecap="round" />
              <path d="M88 88l8-2" stroke="#ffffff" strokeWidth="2" opacity="0.5" strokeLinecap="round" />
            </g>
          </g>
        </svg>
        <span className="demo-track" />
      </div>
      <div className="demo-tryon-caption">
        <span className="demo-swatch demo-swatch-glasses" />
        <span className="demo-row-text">
          <strong>Aviator sunglasses · 3D</strong>
          <small>Follows your head as you move</small>
        </span>
      </div>
    </div>
  );
}

const DEMOS = { photo: PhotoDemo, text: TextDemo, outfit: OutfitDemo, tryon: TryOnDemo, live: LiveDemo };

/* ---------- Section ---------- */

export default function Showcase({ onStart, onExample }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [cycle, setCycle] = useState(0); // restarts the demo and progress bar
  const sectionRef = useRef(null);
  const tabsRef = useRef(null);
  const [visible, setVisible] = useState(false);

  // Keep the active tab in view in the scrollable tab row (phones).
  useEffect(() => {
    const row = tabsRef.current;
    const tab = row?.children[active];
    if (!row || !tab || row.scrollWidth <= row.clientWidth) return;
    row.scrollTo({ left: tab.offsetLeft - (row.clientWidth - tab.offsetWidth) / 2, behavior: "smooth" });
  }, [active]);

  // Only animate while the section is on screen.
  useEffect(() => {
    const node = sectionRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0.25,
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (paused || !visible) return undefined;
    const timer = setTimeout(() => {
      setActive((current) => (current + 1) % TABS.length);
      setCycle((current) => current + 1);
    }, ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [active, paused, visible, cycle]);

  function select(index) {
    setActive(index);
    setCycle((current) => current + 1);
    setPaused(true);
  }

  const tab = TABS[active];
  const Demo = DEMOS[tab.key];

  return (
    <section
      ref={sectionRef}
      className="landing-section container showcase"
      aria-labelledby="showcase-title"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="section-intro section-intro-center reveal">
        <span className="eyebrow">See it in action</span>
        <h2 id="showcase-title">Five ways to shop smarter</h2>
        <p>Pick one and watch how it works, then try it yourself.</p>
      </div>

      <div ref={tabsRef} className="showcase-tabs reveal" role="tablist" aria-label="Ways to shop">
        {TABS.map((item, index) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={`showcase-tab-${item.key}`}
            aria-selected={index === active}
            aria-controls="showcase-panel"
            className={`showcase-tab ${index === active ? "is-active" : ""}`}
            onClick={() => select(index)}
          >
            <Icon name={item.icon} size={16} />
            {item.label}
            {index === active && !paused && visible && (
              <span key={cycle} className="showcase-progress" style={{ animationDuration: `${ADVANCE_MS}ms` }} />
            )}
          </button>
        ))}
      </div>

      <div
        id="showcase-panel"
        className="showcase-panel reveal"
        role="tabpanel"
        aria-labelledby={`showcase-tab-${tab.key}`}
      >
        <div className="showcase-copy" key={`copy-${tab.key}`}>
          <h3>{tab.title}</h3>
          <p>{tab.text}</p>
          <ul>
            {tab.points.map((point) => (
              <li key={point}>
                <Icon name="check" size={15} />
                {point}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="button button-primary"
            onClick={() => (tab.example ? onExample(tab.example) : onStart(tab.key))}
          >
            {tab.cta}
            <Icon name="arrowRight" size={16} />
          </button>
        </div>
        <div className="showcase-stage" aria-hidden="true">
          {visible && <Demo key={`${tab.key}-${cycle}`} />}
        </div>
      </div>
    </section>
  );
}
