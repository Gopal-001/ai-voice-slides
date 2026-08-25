import { useCallback, useEffect, useRef, useState } from "react";

const SpeechRecognition =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

/**
 * Wraps the Web Speech API:
 *  - continuous speech recognition (mic stays open)
 *  - speech synthesis for the AI's voice
 *  - barge-in: if the user starts talking while the AI is speaking,
 *    the AI is cancelled immediately and the user's speech becomes the next question.
 */
export function useVoice({ onFinalResult, onInterrupt }) {
  const supported = Boolean(SpeechRecognition) && "speechSynthesis" in window;

  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interimText, setInterimText] = useState("");

  const recognitionRef = useRef(null);
  const listeningRef = useRef(false);
  const speakingRef = useRef(false);
  const spokenWordsRef = useRef(new Set());
  const echoUntilRef = useRef(0);
  const callbacksRef = useRef({ onFinalResult, onInterrupt });
  callbacksRef.current = { onFinalResult, onInterrupt };

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis.cancel();
    speakingRef.current = false;
    setSpeaking(false);
    echoUntilRef.current = Date.now() + 2500;
  }, []);

  const normalizeWords = (text) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter(Boolean);

  // Echo filter: the mic picks up the AI's own voice through the speakers,
  // but recognition never transcribes it exactly. Treat a transcript as echo
  // if most of its words appear in what the AI is currently saying (or said
  // within the last couple of seconds — recognition results lag the audio).
  const isEcho = useCallback((text) => {
    if (!speakingRef.current && Date.now() > echoUntilRef.current) return false;
    const words = normalizeWords(text);
    if (words.length === 0) return true;
    const hits = words.filter((w) => spokenWordsRef.current.has(w)).length;
    return hits / words.length >= 0.6;
  }, []);

  useEffect(() => {
    if (!supported) return undefined;

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += chunk;
        else interim += chunk;
      }

      // Barge-in: real user speech (2+ words, not an echo) cancels the AI mid-sentence
      const liveText = (final || interim).trim();
      if (
        speakingRef.current &&
        liveText.split(/\s+/).length >= 2 &&
        !isEcho(liveText)
      ) {
        window.speechSynthesis.cancel();
        speakingRef.current = false;
        setSpeaking(false);
        echoUntilRef.current = Date.now() + 2500;
        callbacksRef.current.onInterrupt?.();
      }

      // Don't display the AI's own voice as the user's in-progress speech
      const interimTrimmed = interim.trim();
      setInterimText(interimTrimmed && !isEcho(interimTrimmed) ? interimTrimmed : "");

      const finalText = final.trim();
      if (finalText && !isEcho(finalText)) {
        setInterimText("");
        callbacksRef.current.onFinalResult?.(finalText);
      }
    };

    // Chrome ends recognition after silence — restart while the mic toggle is on
    rec.onend = () => {
      if (listeningRef.current) {
        try {
          rec.start();
        } catch {
          /* already started */
        }
      } else {
        setListening(false);
      }
    };

    rec.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        listeningRef.current = false;
        setListening(false);
      }
    };

    recognitionRef.current = rec;
    return () => {
      listeningRef.current = false;
      rec.onend = null;
      rec.stop();
      window.speechSynthesis.cancel();
    };
  }, [supported, isEcho]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current || listeningRef.current) return;
    listeningRef.current = true;
    setListening(true);
    try {
      recognitionRef.current.start();
    } catch {
      /* already started */
    }
  }, []);

  const stopListening = useCallback(() => {
    listeningRef.current = false;
    setListening(false);
    recognitionRef.current?.stop();
    setInterimText("");
  }, []);

  const speak = useCallback((text) => {
    return new Promise((resolve) => {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;

      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(
        (v) => v.lang.startsWith("en") && /Google|Natural|Aria|Zira/i.test(v.name)
      );
      if (preferred) utterance.voice = preferred;

      spokenWordsRef.current = new Set(normalizeWords(text));
      speakingRef.current = true;
      setSpeaking(true);

      const finish = () => {
        speakingRef.current = false;
        setSpeaking(false);
        // Recognition results lag the audio — keep filtering echoes briefly
        echoUntilRef.current = Date.now() + 2500;
        resolve();
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.speak(utterance);
    });
  }, []);

  return {
    supported,
    listening,
    speaking,
    interimText,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  };
}
