import Emoji3D from "./Emoji3D.jsx";

// Decoration for the home hero: soft colour blobs drifting behind it, and
// little product cards floating around the search box (desktop only).
const FLOATERS = [
  { art: "shoe", name: "Running shoes", price: "₹2,596", tag: "−48%", tone: "violet", spot: "a" },
  { art: "watch", name: "Analog watch", price: "₹1,155", tag: "Best price", tone: "teal", spot: "b" },
  { art: "dress", name: "Cotton kurti", price: "₹394", tag: "Great deal", tone: "pink", spot: "c" },
  { art: "gift", name: "Gift ideas", price: "6 picks", tag: "Under ₹2k", tone: "amber", spot: "d" },
];

const STORES = ["Amazon", "Flipkart", "Myntra", "AJIO", "Meesho", "Nykaa", "Tata CLiQ", "Croma", "IndiaMART", "Lenskart"];

export function HeroBackdrop() {
  return (
    <div className="hero-backdrop" aria-hidden="true">
      <span className="hero-aurora" />
      <span className="hero-spotlight" />
      <span className="blob blob-1" />
      <span className="blob blob-2" />
      <span className="blob blob-3" />
      <span className="blob blob-4" />
      {FLOATERS.map((card) => (
        <span key={card.spot} className={`floater floater-${card.spot} tone-${card.tone}`}>
          <span className="floater-emoji">
            <Emoji3D name={card.art} size={32} />
          </span>
          <span className="floater-text">
            <strong>{card.name}</strong>
            <small>{card.price}</small>
          </span>
          <span className="floater-tag">{card.tag}</span>
        </span>
      ))}
    </div>
  );
}

/** The stores SnapBuy compares, scrolling past. */
export function StoreMarquee() {
  const row = STORES.map((store) => (
    <li key={store}>
      <span className="marquee-dot" aria-hidden="true" />
      {store}
    </li>
  ));
  return (
    <div className="marquee" aria-label={`Compares stores like ${STORES.join(", ")}`}>
      <ul className="marquee-track" aria-hidden="true">
        {row}
        {row}
      </ul>
    </div>
  );
}
