import { useEffect } from "react";
import Icon from "./Icon.jsx";
import Showcase from "./Showcase.jsx";

// Prices from a real SnapBuy search for a G-Shock style watch (Oct 2026),
// used to illustrate the features. Live prices will differ.
const EXAMPLE_PRICES = [
  { store: "IndiaMART", price: "₹480", width: 32 },
  { store: "Meesho", price: "₹495", width: 34 },
  { store: "Flipkart", price: "₹840", width: 58 },
  { store: "AJIO", price: "₹899", width: 62 },
];

const STEPS = [
  {
    icon: "upload",
    title: "Snap, paste or describe",
    text: "Upload a product or outfit photo, paste a screenshot, or just type what you want in your own words.",
  },
  {
    icon: "sparkles",
    title: "AI understands it",
    text: "Google Lens and AI models recognise the product, every piece of an outfit, or the specs and budget you typed.",
  },
  {
    icon: "tag",
    title: "Compare, try on, buy",
    text: "See prices and stock across stores, try clothes and glasses on yourself, then buy from the seller you trust.",
  },
];

/** Fade sections in as they scroll into view. */
function useReveal() {
  useEffect(() => {
    const nodes = document.querySelectorAll(".reveal:not(.is-visible)");
    if (typeof IntersectionObserver === "undefined") {
      nodes.forEach((node) => node.classList.add("is-visible"));
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }),
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);
}

const FAQS = [
  {
    question: "How does SnapBuy find products?",
    answer:
      "Your photo is sent to Google Lens, which finds visually similar listings across the web. SnapBuy keeps the shopping results, ranks them with an AI image model by how closely they match your photo, and reads each listing's price and stock.",
  },
  {
    question: "Can I search without a photo?",
    answer:
      "Yes. Switch the search panel to Text and type what you're looking for: keywords like \"Casio G-Shock green watch\", or a full sentence like \"an HP laptop with 8GB RAM and 512GB storage under 50k\". SnapBuy understands the brand, specs and budget, searches Google Shopping across Indian stores, and ranks listings by how many of your requirements they meet.",
  },
  {
    question: "Can I see how clothes look on me?",
    answer:
      "Yes. Tap \"Try on\" on any top, kurti, shirt, dress or bottom in your results, add a photo of yourself, and AI shows you wearing it in about 20–40 seconds. Use a clear, front-facing photo; a full-length one works best for long garments. Your photo is sent to free AI models on Hugging Face only to create the try-on, and is kept in your browser for next time.",
  },
  {
    question: "Can I try on sunglasses and watches?",
    answer:
      "Yes, live. Tap \"Try live\" on sunglasses, glasses or a watch and SnapBuy opens your camera: the frames follow your face in 3D — turning with your head, arms running back to your ears — and the watch wraps around your wrist as you move. You can also use a photo, adjust the size and position, and save a picture. It runs entirely on your device — the camera feed is never uploaded.",
  },
  {
    question: "Can SnapBuy find a whole outfit from one photo?",
    answer:
      "Yes. Upload a photo of someone and tap \"Find the outfit\". AI identifies each item they're wearing (top, trousers, shoes, watch, glasses, bag and more) and SnapBuy shows shopping options for every item separately, usually in a few seconds. Clothing in the results can be tried on too.",
  },
  {
    question: "Which stores does it search?",
    answer:
      "Any online store Google Lens finds — often Amazon, Flipkart, Myntra, AJIO, Meesho and Tata CLiQ, plus many smaller shops. Results are tuned for India.",
  },
  {
    question: "Why do some products say “Price on store”?",
    answer:
      "Some listings don't share their price with search engines, and some stores block automated price checks. Open the listing to see its current price.",
  },
  {
    question: "Are prices and stock always accurate?",
    answer:
      "They're read at the moment you search and can change at any time. Always confirm the price and availability on the seller's site before you buy.",
  },
  {
    question: "What happens to my photo?",
    answer:
      "It's sent to Google Lens only to run your search (for \"Find the outfit\", to an AI model on Groq that lists the items instead). To do that, it may sit for a few seconds at a private, unguessable temporary link, which is deleted as soon as the search starts; the SnapBuy server doesn't keep a copy. Your recent searches (with a small copy of each photo) and saved items stay in this browser only, and you can clear them at any time.",
  },
  {
    question: "What kind of photo works best?",
    answer:
      "A clear, well-lit photo where the product fills most of the frame. Plain backgrounds help, and visible logos or labels make exact matches more likely.",
  },
];

function BentoCard({ icon, title, text, className = "", children }) {
  return (
    <article className={`bento-card ${className}`}>
      <div className="bento-visual" aria-hidden="true">
        {children}
      </div>
      <div className="bento-copy">
        <span className="bento-icon">
          <Icon name={icon} size={16} />
        </span>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
    </article>
  );
}

function Features() {
  return (
    <section className="landing-section container" aria-labelledby="features-title">
      <div className="section-intro section-intro-center reveal">
        <span className="eyebrow">Why SnapBuy</span>
        <h2 id="features-title">Everything you need to shop smarter</h2>
        <p>
          One photo gives you the product, the stores that sell it and the
          best price — without typing a single search.
        </p>
      </div>

      <div className="bento reveal">
        <BentoCard
          className="bento-wide"
          icon="scan"
          title="Recognises the product, not just the picture"
          text="Lens identifies what's in your photo, and SnapBuy scores every listing for visual similarity so the closest matches come first."
        >
          <div className="demo-identify">
            <div className="demo-photo">
              <span className="demo-corner tl" />
              <span className="demo-corner tr" />
              <span className="demo-corner bl" />
              <span className="demo-corner br" />
              <Icon name="image" size={34} />
              <span className="demo-scan" />
            </div>
            <div className="demo-identify-side">
              <span className="demo-label">Identified as</span>
              <span className="demo-chip">Men analog digital watch</span>
              <div className="demo-match">
                <span className="demo-ring" style={{ "--value": 95 }}>
                  <span>
                    <Icon name="check" size={18} />
                  </span>
                </span>
                <span className="demo-match-text">
                  <strong>Very close match</strong>
                  Ranked by AI similarity
                </span>
              </div>
            </div>
          </div>
        </BentoCard>

        <BentoCard
          icon="tag"
          title="Lowest prices first"
          text="Prices from every store, sorted so the best deal is on top."
        >
          <ul className="demo-prices">
            {EXAMPLE_PRICES.map((row, index) => (
              <li key={row.store}>
                <span className="demo-store">{row.store}</span>
                <span className="demo-bar">
                  <span style={{ width: `${row.width}%` }} />
                </span>
                <span className="demo-price">{row.price}</span>
                {index === 0 && <span className="demo-best">Lowest</span>}
              </li>
            ))}
          </ul>
        </BentoCard>

        <BentoCard
          icon="box"
          title="Stock at a glance"
          text="See which listings are in stock before you click through."
        >
          <ul className="demo-stock">
            <li>
              <span className="demo-line" style={{ width: "62%" }} />
              <span className="stock stock-in_stock">In stock</span>
            </li>
            <li>
              <span className="demo-line" style={{ width: "48%" }} />
              <span className="stock stock-in_stock">In stock</span>
            </li>
            <li>
              <span className="demo-line" style={{ width: "56%" }} />
              <span className="stock stock-out_of_stock">Out of stock</span>
            </li>
          </ul>
        </BentoCard>

        <BentoCard
          className="bento-wide"
          icon="heart"
          title="Save favourites and decide later"
          text="Keep the listings you like in one place and compare them whenever you're ready — no account needed."
        >
          <div className="demo-saved">
            {["₹480", "₹840", "₹899"].map((price, index) => (
              <div key={price} className="demo-saved-card" style={{ "--i": index }}>
                <span className="demo-saved-media">
                  <Icon name="image" size={20} />
                  <span className="demo-heart">
                    <Icon name="heart" size={12} />
                  </span>
                </span>
                <span className="demo-line" style={{ width: "80%" }} />
                <span className="demo-line demo-line-soft" style={{ width: "55%" }} />
                <strong>{price}</strong>
              </div>
            ))}
          </div>
        </BentoCard>
      </div>

      <p className="example-note">
        Example prices are from a real search on 13 Oct 2026. Live prices change.
      </p>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="landing-section landing-band" aria-labelledby="how-title">
      <div className="container">
        <div className="section-intro section-intro-center reveal">
          <span className="eyebrow">How it works</span>
          <h2 id="how-title">From idea to best price in seconds</h2>
        </div>

        <ol className="timeline reveal">
          {STEPS.map((step, index) => (
            <li key={step.title} className="timeline-step">
              <span className="timeline-marker">
                <Icon name={step.icon} size={20} />
                <span className="timeline-number">{index + 1}</span>
              </span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section className="landing-section container faq" aria-labelledby="faq-title">
      <div className="faq-intro reveal">
        <span className="eyebrow">FAQ</span>
        <h2 id="faq-title">Questions, answered</h2>
        <p>
          Everything you need to know about how SnapBuy finds products and
          prices.
        </p>
      </div>

      <div className="faq-list reveal">
        {FAQS.map((item, index) => (
          <details key={item.question} className="faq-item" open={index === 0}>
            <summary>
              {item.question}
              <span className="faq-toggle" aria-hidden="true" />
            </summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function CtaBand({ onStart }) {
  return (
    <section className="container landing-section-tight">
      <div className="cta-band reveal">
        <div>
          <h2>Seen something you like?</h2>
          <p>Snap it, describe it or shop the whole outfit, and find where it's cheapest in seconds.</p>
        </div>
        <div className="cta-actions">
          <button type="button" className="button button-light button-lg" onClick={() => onStart("photo")}>
            <Icon name="upload" size={18} />
            Upload a photo
          </button>
          <button type="button" className="button button-outline-light button-lg" onClick={() => onStart("text")}>
            <Icon name="search" size={18} />
            Describe it
          </button>
        </div>
      </div>
    </section>
  );
}

export default function Landing({ onStart, onExample }) {
  useReveal();
  return (
    <>
      <Showcase onStart={onStart} onExample={onExample} />
      <Features />
      <HowItWorks />
      <Faq />
      <CtaBand onStart={onStart} />
    </>
  );
}
