import Icon from "./Icon.jsx";

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
    title: "Upload a photo",
    text: "Snap a picture, upload one, or paste it straight from your clipboard.",
  },
  {
    icon: "sparkles",
    title: "We identify it",
    text: "Google Lens recognises the product and AI ranks every listing by how closely it matches.",
  },
  {
    icon: "tag",
    title: "Compare and buy",
    text: "Check prices and stock side by side, then buy from the seller you trust.",
  },
];

const FAQS = [
  {
    question: "How does SnapBuy find products?",
    answer:
      "Your photo is sent to Google Lens, which finds visually similar listings across the web. SnapBuy keeps the shopping results, ranks them with an AI image model by how closely they match your photo, and reads each listing's price and stock.",
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
      "It's sent to Google Lens only to run your search. SnapBuy doesn't keep a copy, and your saved items stay in this browser.",
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
      <div className="section-intro section-intro-center">
        <span className="eyebrow">Why SnapBuy</span>
        <h2 id="features-title">Everything you need to shop smarter</h2>
        <p>
          One photo gives you the product, the stores that sell it and the
          best price — without typing a single search.
        </p>
      </div>

      <div className="bento">
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
                  <span>95%</span>
                </span>
                <span className="demo-match-text">
                  <strong>Visual match</strong>
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
        <div className="section-intro section-intro-center">
          <span className="eyebrow">How it works</span>
          <h2 id="how-title">From photo to best price in seconds</h2>
        </div>

        <ol className="timeline">
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
      <div className="faq-intro">
        <span className="eyebrow">FAQ</span>
        <h2 id="faq-title">Questions, answered</h2>
        <p>
          Everything you need to know about how SnapBuy finds products and
          prices.
        </p>
      </div>

      <div className="faq-list">
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
      <div className="cta-band">
        <div>
          <h2>Seen something you like?</h2>
          <p>Snap it, upload it and find where it's cheapest — in seconds.</p>
        </div>
        <button type="button" className="button button-light button-lg" onClick={onStart}>
          <Icon name="upload" size={18} />
          Upload a photo
        </button>
      </div>
    </section>
  );
}

export default function Landing({ onStart }) {
  return (
    <>
      <Features />
      <HowItWorks />
      <Faq />
      <CtaBand onStart={onStart} />
    </>
  );
}
