import { useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { VOICE_LANGUAGES, useVoiceSearch, voiceSupported } from "../lib/voice.js";

const EXAMPLES = [
  "HP laptop with 16GB RAM under 60k",
  "Nike running shoes for men",
  "50k ke andar 8GB RAM wala laptop",
];

/**
 * The one search box on the home page: type or speak what you want, or tap
 * the camera to search with a photo (which then asks what to do with it).
 */
export default function HomeSearch({ query, onQueryChange, onSearch, onPhoto, isSearching, error }) {
  const fileRef = useRef(null);
  const [language, setLanguage] = useState(VOICE_LANGUAGES[0].code);
  const canSpeak = voiceSupported();
  const trimmed = query.trim();
  const voice = useVoiceSearch((text, isFinal) => {
    onQueryChange(text);
    if (isFinal && text.trim().length >= 2) onSearch(text.trim());
  });
  const hindi = language === "hi-IN";

  return (
    <div className="home-search">
      <form
        className={`home-search-bar ${voice.listening ? "is-listening" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed.length >= 2 && !isSearching) onSearch(trimmed);
        }}
      >
        <Icon name="search" size={20} className="home-search-icon" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={voice.listening ? "Listening… say what you want to buy" : "What are you looking for?"}
          aria-label="What are you looking for?"
          maxLength={150}
          enterKeyHint="search"
        />
        {canSpeak && (
          <>
            <button
              type="button"
              className="home-search-lang"
              onClick={() => setLanguage(hindi ? "en-IN" : "hi-IN")}
              title={hindi ? "Voice: Hindi (tap for English)" : "Voice: English (tap for Hindi)"}
              aria-label={hindi ? "Voice language Hindi, switch to English" : "Voice language English, switch to Hindi"}
            >
              {hindi ? "हि" : "EN"}
            </button>
            <button
              type="button"
              className={`home-search-tool ${voice.listening ? "is-listening" : ""}`}
              onClick={() => (voice.listening ? voice.stop() : voice.start(language))}
              aria-label={voice.listening ? "Stop listening" : "Search by voice"}
              title="Search by voice"
            >
              <Icon name="mic" size={19} />
            </button>
          </>
        )}
        <button
          type="button"
          className="home-search-tool"
          onClick={() => fileRef.current?.click()}
          aria-label="Search with a photo"
          title="Search with a photo"
        >
          <Icon name="camera" size={19} />
        </button>
        <button type="submit" className="button button-primary home-search-go" disabled={trimmed.length < 2 || isSearching}>
          {isSearching ? <span className="spinner spinner-light" /> : <Icon name="arrowRight" size={18} />}
          <span className="home-search-go-label">{isSearching ? "Searching" : "Search"}</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            onPhoto(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </form>

      {(voice.error || error) && (
        <p className="home-search-error" role="alert">
          <Icon name="alert" size={15} />
          {voice.error || error}
        </p>
      )}

      <div className="home-search-examples">
        <span>Try</span>
        {EXAMPLES.map((example) => (
          <button key={example} type="button" onClick={() => onSearch(example)} disabled={isSearching}>
            {example}
          </button>
        ))}
      </div>
      <p className="home-search-hint">
        <Icon name="clipboard" size={13} />
        <span className="only-pointer">You can also paste or drop a photo anywhere on this page.</span>
        <span className="only-touch">Tap the camera to search with a photo.</span>
      </p>
    </div>
  );
}
