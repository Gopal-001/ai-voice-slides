import { useCallback, useEffect, useRef, useState } from "react";

const SpeechRecognition =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

/**
 * Wraps the Web Speech API with a simple half-duplex model:
 * the app is either LISTENING (mic open) or SPEAKING (narration playing),
 * never both. While the AI speaks the mic is paused, so it can never hear
 * its own voice. Ask a question after the narration finishes, or press the
 * ✋ Interrupt button to cut it short — the mic reopens immediately.
 */
export function useVoice({ onFinalResult }) {
  const supported = Boolean(SpeechRecognition) && "speechSynthesis" in window;

  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interimText, setInterimText] = useState("");

  const recognitionRef = useRef(null);
  const listeningRef = useRef(false); // the user's mic toggle
  const speakingRef = useRef(false);
  const utteranceRef = useRef(null);
  const callbacksRef = useRef({ onFinalResult });
  callbacksRef.current = { onFinalResult };

  const resumeMicIfNeeded = useCallback(() => {
    if (listeningRef.current) {
      try {
        recognitionRef.current?.start();
      } catch {
        /* already started */
      }
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    utteranceRef.current = null;
    window.speechSynthesis.cancel();
    speakingRef.current = false;
    setSpeaking(false);
    resumeMicIfNeeded();
  }, [resumeMicIfNeeded]);

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

      setInterimText(interim.trim());

      const finalText = final.trim();
      if (finalText) {
        setInterimText("");
        callbacksRef.current.onFinalResult?.(finalText);
      }
    };

    // Chrome ends recognition after silence — restart while the mic toggle
    // is on, unless the AI is speaking (mic stays paused until it finishes).
    rec.onend = () => {
      if (listeningRef.current && !speakingRef.current) {
        try {
          rec.start();
        } catch {
          /* already started */
        }
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
  }, [supported]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current || listeningRef.current) return;
    listeningRef.current = true;
    setListening(true);
    // If the AI is speaking, the mic opens automatically when it finishes
    if (!speakingRef.current) {
      try {
        recognitionRef.current.start();
      } catch {
        /* already started */
      }
    }
  }, []);

  const stopListening = useCallback(() => {
    listeningRef.current = false;
    setListening(false);
    recognitionRef.current?.stop();
    setInterimText("");
  }, []);

  const speak = useCallback(
    (text) => {
      return new Promise((resolve) => {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.05;

        const voices = window.speechSynthesis.getVoices();
        const preferred = voices.find(
          (v) => v.lang.startsWith("en") && /Google|Natural|Aria|Zira/i.test(v.name)
        );
        if (preferred) utterance.voice = preferred;

        utteranceRef.current = utterance;
        speakingRef.current = true;
        setSpeaking(true);

        // Pause the mic while speaking; abort() discards buffered audio so
        // nothing the mic already captured leaks through as a question.
        setInterimText("");
        try {
          recognitionRef.current?.abort();
        } catch {
          /* not running */
        }

        const finish = () => {
          // Superseded by a newer utterance, or already cancelled via stopSpeaking
          if (utteranceRef.current !== utterance) return resolve();
          utteranceRef.current = null;
          speakingRef.current = false;
          setSpeaking(false);
          resumeMicIfNeeded();
          resolve();
        };
        utterance.onend = finish;
        utterance.onerror = finish;
        window.speechSynthesis.speak(utterance);
      });
    },
    [resumeMicIfNeeded]
  );

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
