import { useCallback, useEffect, useRef, useState } from "react";

// Voice search with the browser's built-in speech recognition (Chrome, Edge,
// Safari, Android). Free and on-device or browser-provided; nothing is sent
// to SnapBuy until the words are searched.

const Recognition =
  typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export const VOICE_LANGUAGES = [
  { code: "en-IN", label: "English" },
  { code: "hi-IN", label: "हिंदी" },
];

export function voiceSupported() {
  return Boolean(Recognition);
}

/**
 * Listen once and report what was said. onText(text, isFinal) is called as
 * words arrive. Returns { listening, start(language), stop, error }.
 */
export function useVoiceSearch(onText) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const recognitionRef = useRef(null);
  const onTextRef = useRef(onText);

  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  useEffect(() => () => recognitionRef.current?.abort(), []);

  const stop = useCallback(() => recognitionRef.current?.stop(), []);

  const start = useCallback((language) => {
    if (!Recognition) return;
    recognitionRef.current?.abort();
    const recognition = new Recognition();
    recognition.lang = language;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      const text = [...event.results].map((result) => result[0].transcript).join(" ").trim();
      const isFinal = event.results[event.results.length - 1].isFinal;
      onTextRef.current?.(text, isFinal);
    };
    recognition.onerror = (event) => {
      setError(
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "Allow microphone access to search by voice."
          : event.error === "no-speech"
            ? "Didn't catch that. Tap the mic and try again."
            : "Voice search isn't available right now."
      );
    };
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    setError("");
    setListening(true);
    recognition.start();
  }, []);

  return { listening, start, stop, error };
}
