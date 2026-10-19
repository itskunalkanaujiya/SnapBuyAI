import { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { askAssistant } from "../lib/assistant.js";
import { formatPrice } from "../lib/products.js";

const SUGGESTIONS = [
  "Which one is the best value?",
  "Which has the most trusted reviews?",
  "Sabse sasta achha option kaunsa hai?",
  "Is anything here refurbished or used?",
];

function Pick({ product }) {
  const price = formatPrice(product);
  const content = (
    <>
      {product.image_url ? (
        <img src={product.image_url} alt="" loading="lazy" />
      ) : (
        <span className="chat-pick-image" aria-hidden="true">
          <Icon name="image" size={16} />
        </span>
      )}
      <span className="chat-pick-text">
        <strong>{product.name || "Unnamed product"}</strong>
        <small>
          {price || "Price on store"}
          {product.marketplace ? ` · ${product.marketplace}` : ""}
        </small>
      </span>
      {product.product_url && <Icon name="external" size={14} />}
    </>
  );

  return product.product_url ? (
    <a className="chat-pick" href={product.product_url} target="_blank" rel="noopener noreferrer">
      {content}
    </a>
  ) : (
    <span className="chat-pick">{content}</span>
  );
}

/**
 * "Ask AI": a chat about the products on screen. The assistant answers
 * from those listings, links the ones it recommends, and can suggest a new
 * search. Remount it (key) when the products change to start over.
 */
export default function AssistantChat({ products, query, onSearch }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isThinking]);

  useEffect(() => {
    if (!isOpen) return undefined;
    inputRef.current?.focus();
    const closeOnEscape = (event) => event.key === "Escape" && setIsOpen(false);
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  async function send(text) {
    const question = (text ?? draft).trim();
    if (!question || isThinking) return;

    const conversation = [...messages, { role: "user", content: question }];
    setMessages(conversation);
    setDraft("");
    setIsThinking(true);

    try {
      // Earlier errors aren't part of the conversation the model sees.
      const history = conversation
        .filter((message) => !message.error)
        .map(({ role, content }) => ({ role, content }));
      const answer = await askAssistant(history, products, query);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: answer.reply,
          picks: (answer.picks || []).map((index) => products[index]).filter(Boolean),
          search: answer.search,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          error: true,
          content:
            error instanceof TypeError
              ? "Can't reach the SnapBuy server. Check that the backend is running."
              : error.message,
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  }

  if (!isOpen) {
    return (
      <button type="button" className="chat-launcher" onClick={() => setIsOpen(true)}>
        <Icon name="sparkles" size={18} />
        Ask AI about these
      </button>
    );
  }

  return (
    <section className="chat-panel" role="dialog" aria-label="Shopping assistant">
      <header className="chat-header">
        <span className="chat-avatar" aria-hidden="true">
          <Icon name="sparkles" size={16} />
        </span>
        <div>
          <strong>Shopping assistant</strong>
          <small>Answers from the {products.length} listings on screen</small>
        </div>
        <button
          type="button"
          className="icon-button chat-close"
          onClick={() => setIsOpen(false)}
          aria-label="Close the assistant"
        >
          <Icon name="x" size={16} />
        </button>
      </header>

      <div className="chat-messages" ref={listRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <p>
              Ask me to compare these listings: value for money, reviews, stores. English, Hindi or
              Hinglish all work.
            </p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => send(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            className={`chat-message chat-${message.role} ${message.error ? "is-error" : ""}`}
          >
            <p>{message.content}</p>
            {message.picks?.length > 0 && (
              <div className="chat-picks">
                {message.picks.map((product, position) => (
                  <Pick key={position} product={product} />
                ))}
              </div>
            )}
            {message.search && onSearch && (
              <button
                type="button"
                className="button button-secondary button-sm chat-search"
                onClick={() => onSearch(message.search)}
              >
                <Icon name="search" size={14} />
                Search “{message.search}”
              </button>
            )}
          </div>
        ))}

        {isThinking && (
          <div className="chat-message chat-assistant chat-typing" aria-label="Thinking">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      <form
        className="chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about these products…"
          maxLength={500}
          aria-label="Your question"
        />
        <button
          type="submit"
          className="button button-primary chat-send"
          disabled={!draft.trim() || isThinking}
          aria-label="Send"
        >
          <Icon name="arrowRight" size={16} />
        </button>
      </form>
    </section>
  );
}
