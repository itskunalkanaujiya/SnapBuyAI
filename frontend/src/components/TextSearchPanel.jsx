import { useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { VOICE_LANGUAGES, useVoiceSearch, voiceSupported } from "../lib/voice.js";

const EXAMPLES = [
  "HP laptop with 8GB RAM and 512GB SSD under 50k",
  "50k ke andar 8GB RAM wala laptop",
  "Samsung 5G phone with 6000mAh battery under 20000",
  "Casio G-Shock green watch",
  "Nike running shoes for men",
  "Cotton kurti for women",
];

const LIST_EXAMPLE = [
  "Diwali list:",
  "kurta for papa",
  "saree for mummy, 3000 tak",
  "2 diya sets",
  "dry fruit gift box",
].join("\n");

/** Photo / Text / Plan / Gift switch shown at the top of every search panel. */
export function SearchModeTabs({ mode, onChange, disabled }) {
  const tabs = [
    { key: "photo", label: "Photo", icon: "camera" },
    { key: "text", label: "Text", icon: "search" },
    { key: "plan", label: "Plan", icon: "tag" },
    { key: "gift", label: "Gift", icon: "heart" },
  ];

  return (
    <div className="mode-tabs" role="tablist" aria-label="Search by">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={mode === tab.key}
          className={`mode-tab ${mode === tab.key ? "is-active" : ""}`}
          onClick={() => onChange(tab.key)}
          disabled={disabled}
        >
          <Icon name={tab.icon} size={16} />
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export default function TextSearchPanel({
  modeTabs,
  query,
  onQueryChange,
  onSearch,
  isSearching,
  error,
  onShopList,
  isShoppingList = false,
}) {
  const inputRef = useRef(null);
  const trimmed = query.trim();
  // "A whole list": several things to buy, shopped at once as one cart.
  const [listMode, setListMode] = useState(false);
  const [listText, setListText] = useState("");
  const [language, setLanguage] = useState(VOICE_LANGUAGES[0].code);
  const canSpeak = voiceSupported();
  const voice = useVoiceSearch((text, isFinal) => {
    onQueryChange(text);
    // Search as soon as the sentence is finished.
    if (isFinal && text.trim().length >= 2) onSearch(text.trim());
  });

  if (listMode) {
    return (
      <div className="panel search-panel">
        {modeTabs}

        <div className="panel-header">
          <div>
            <h2>Shop a whole list</h2>
            <p>Paste or type your list; we find every item and add up the cart.</p>
          </div>
        </div>

        <form
          className="text-search"
          onSubmit={(event) => {
            event.preventDefault();
            if (listText.trim().length >= 3 && !isShoppingList) onShopList({ text: listText.trim() });
          }}
        >
          <textarea
            className="plan-input list-input"
            value={listText}
            onChange={(event) => setListText(event.target.value)}
            rows={6}
            maxLength={2000}
            placeholder={LIST_EXAMPLE}
            aria-label="Your shopping list"
          />

          {error && (
            <div className="alert alert-error" role="alert">
              <Icon name="alert" size={17} />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="button button-primary button-lg search-button"
            disabled={listText.trim().length < 3 || isShoppingList}
          >
            {isShoppingList ? (
              <>
                <span className="spinner spinner-light" />
                Shopping your list…
              </>
            ) : (
              <>
                <Icon name="bag" size={18} />
                Shop my list
              </>
            )}
          </button>
        </form>

        <p className="panel-footnote">
          <Icon name="camera" size={13} />
          Have it on paper? Use Photo and tap “Shop my list” to read a handwritten note or a
          WhatsApp screenshot.
        </p>
        <button type="button" className="link-button" onClick={() => setListMode(false)}>
          <Icon name="search" size={14} />
          Back to searching one product
        </button>
      </div>
    );
  }

  return (
    <div className="panel search-panel">
      {modeTabs}

      <div className="panel-header">
        <div>
          <h2>Search by text</h2>
          <p>Describe the product and we'll compare stores for you.</p>
        </div>
      </div>

      <form
        className="text-search"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed.length >= 2 && !isSearching) onSearch(trimmed);
        }}
      >
        <label className="field text-search-field">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            value={query}
            maxLength={150}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={voice.listening ? "Listening… speak now" : "e.g. HP laptop with 8GB RAM under 50k"}
            aria-label="What are you looking for?"
            disabled={isSearching}
          />
          {canSpeak && !isSearching && (
            <button
              type="button"
              className={`icon-button voice-button ${voice.listening ? "is-listening" : ""}`}
              onClick={() => (voice.listening ? voice.stop() : voice.start(language))}
              aria-label={voice.listening ? "Stop listening" : "Search by voice"}
              title="Search by voice (English or Hindi)"
            >
              <Icon name="mic" size={17} />
            </button>
          )}
          {query && !isSearching && (
            <button
              type="button"
              className="icon-button text-search-clear"
              onClick={() => {
                onQueryChange("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
            >
              <Icon name="x" size={15} />
            </button>
          )}
        </label>

        {canSpeak && (
          <div className="voice-row">
            <span className="voice-hint">
              <Icon name="mic" size={13} />
              {voice.listening ? "Listening…" : "Speak in"}
            </span>
            <div className="voice-languages" role="group" aria-label="Voice language">
              {VOICE_LANGUAGES.map((option) => (
                <button
                  key={option.code}
                  type="button"
                  className={language === option.code ? "is-active" : ""}
                  aria-pressed={language === option.code}
                  onClick={() => setLanguage(option.code)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <span className="voice-note">Hindi and Hinglish work too</span>
          </div>
        )}
        {voice.error && <p className="voice-error">{voice.error}</p>}

        <div className="text-examples">
          <span>Try:</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="example-chip"
              onClick={() => {
                onQueryChange(example);
                inputRef.current?.focus();
              }}
              disabled={isSearching}
            >
              {example}
            </button>
          ))}
        </div>

        {error && (
          <div className="alert alert-error" role="alert">
            <Icon name="alert" size={17} />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          className={`button button-primary button-lg search-button ${isSearching ? "is-loading" : ""}`}
          disabled={trimmed.length < 2 || isSearching}
        >
          {isSearching ? (
            <>
              <span className="spinner spinner-light" />
              Searching stores…
            </>
          ) : (
            <>
              <Icon name="search" size={18} />
              Search products
            </>
          )}
        </button>
      </form>

      <p className="panel-footnote">
        <Icon name="store" size={13} />
        Searches Google Shopping across stores in India.
      </p>
      {onShopList && (
        <button type="button" className="link-button" onClick={() => setListMode(true)}>
          <Icon name="bag" size={14} />
          Have a whole list? Shop it all at once
        </button>
      )}
    </div>
  );
}
