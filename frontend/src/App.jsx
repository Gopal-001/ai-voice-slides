import { useCallback, useEffect, useRef, useState } from "react";
import SlideDeck from "./components/SlideDeck.jsx";
import Transcript from "./components/Transcript.jsx";
import { useVoice } from "./useVoice.js";

export default function App() {
  const [slides, setSlides] = useState([]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [status, setStatus] = useState("idle"); // idle | listening | thinking | speaking
  const [messages, setMessages] = useState([]);
  const [agentMode, setAgentMode] = useState(null);

  const currentSlideRef = useRef(0);
  currentSlideRef.current = currentSlide;
  const busyRef = useRef(false); // true while a question is in flight

  const addMessage = useCallback((role, text) => {
    setMessages((prev) => [...prev, { role, text, at: Date.now() }]);
  }, []);

  const handleInterrupt = useCallback(() => {
    setStatus("listening");
    addMessage("system", "⏸ You interrupted the AI");
  }, [addMessage]);

  const handleFinalResult = useCallback(async (question) => {
    if (busyRef.current) return; // one question at a time
    busyRef.current = true;

    addMessage("user", question);
    setStatus("thinking");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, currentSlide: currentSlideRef.current }),
      });
      if (!res.ok) throw new Error(`Backend returned ${res.status}`);
      const { answer, slide } = await res.json();

      if (slide !== currentSlideRef.current) {
        setCurrentSlide(slide);
        addMessage("system", `→ Jumped to slide ${slide + 1}`);
      }
      addMessage("ai", answer);
      setStatus("speaking");
      busyRef.current = false; // allow barge-in questions while speaking
      await speakRef.current(answer);
      setStatus((s) => (s === "speaking" ? "listening" : s));
    } catch (err) {
      console.error(err);
      addMessage("system", "⚠ Couldn't reach the backend. Is it running on port 3001?");
      setStatus("listening");
      busyRef.current = false;
    }
  }, [addMessage]);

  const voice = useVoice({ onFinalResult: handleFinalResult, onInterrupt: handleInterrupt });
  const speakRef = useRef(voice.speak);
  speakRef.current = voice.speak;

  // Load the deck + agent mode from the backend
  useEffect(() => {
    fetch("/api/slides")
      .then((r) => r.json())
      .then((data) => setSlides(data.slides))
      .catch(() => addMessage("system", "⚠ Backend not reachable — start it with: npm run dev (in backend/)"));
    fetch("/api/health")
      .then((r) => r.json())
      .then((data) => setAgentMode(data.mode))
      .catch(() => {});
  }, [addMessage]);

  const toggleMic = () => {
    if (voice.listening) {
      voice.stopListening();
      voice.stopSpeaking();
      setStatus("idle");
    } else {
      voice.startListening();
      setStatus("listening");
    }
  };

  const presentSlide = async (index) => {
    const slide = slides[index];
    if (!slide) return;
    voice.stopSpeaking();
    setCurrentSlide(index);
    addMessage("ai", slide.narration);
    setStatus("speaking");
    await voice.speak(slide.narration);
    setStatus(voice.listening ? "listening" : "idle");
  };

  const goTo = (index) => {
    const clamped = Math.min(Math.max(index, 0), slides.length - 1);
    setCurrentSlide(clamped);
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>🎙 AI Voice Slides</h1>
        <div className="topbar-right">
          {agentMode && (
            <span className={`badge ${agentMode === "claude" ? "badge-claude" : "badge-offline"}`}>
              {agentMode === "claude" ? "Claude agent" : "Offline mode"}
            </span>
          )}
          <span className={`status status-${status}`}>
            {status === "idle" && "Mic off"}
            {status === "listening" && "Listening…"}
            {status === "thinking" && "Thinking…"}
            {status === "speaking" && "Speaking — talk to interrupt"}
          </span>
        </div>
      </header>

      {!voice.supported && (
        <div className="warning">
          Your browser doesn't support the Web Speech API. Please use Chrome or Edge.
        </div>
      )}

      <main className="layout">
        <section className="stage">
          <SlideDeck
            slides={slides}
            current={currentSlide}
            onNavigate={goTo}
            onPresent={() => presentSlide(currentSlide)}
          />
          <div className="mic-row">
            <button
              className={`mic-button ${voice.listening ? "mic-on" : ""}`}
              onClick={toggleMic}
              disabled={!voice.supported}
            >
              {voice.listening ? "🔴 Stop mic" : "🎤 Start mic"}
            </button>
            {voice.speaking && (
              <button className="stop-button" onClick={() => { voice.stopSpeaking(); setStatus("listening"); }}>
                ✋ Interrupt
              </button>
            )}
            {voice.interimText && <span className="interim">“{voice.interimText}”</span>}
          </div>
        </section>

        <Transcript messages={messages} />
      </main>

      <footer className="hints">
        Try: “Tell me about tokens” · “How are these models trained?” · “What is attention?” ·
        “Why do they hallucinate?” · “Next slide” · “Go to slide 3”
      </footer>
    </div>
  );
}
