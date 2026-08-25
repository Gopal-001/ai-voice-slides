import { useCallback, useEffect, useRef, useState } from "react";
import SlideDeck from "./components/SlideDeck.jsx";
import Transcript from "./components/Transcript.jsx";
import { useVoice } from "./useVoice.js";

// Spoken phrases that request a brand-new deck, e.g.
// "make a presentation about black holes", "present slides on the Roman Empire"
const DECK_REQUEST = /(?:presentation|slides|deck|present)\s+(?:about|on)\s+(.+)/i;

export default function App() {
  const [slides, setSlides] = useState([]);
  const [deckTopic, setDeckTopic] = useState("");
  const [topicInput, setTopicInput] = useState("");
  const [currentSlide, setCurrentSlide] = useState(0);
  const [busy, setBusy] = useState(null); // null | "thinking" | "generating"
  const [messages, setMessages] = useState([]);
  const [agentMode, setAgentMode] = useState(null);

  const currentSlideRef = useRef(0);
  currentSlideRef.current = currentSlide;
  const busyRef = useRef(false); // true while a question/generation is in flight

  const addMessage = useCallback((role, text) => {
    setMessages((prev) => [...prev, { role, text, at: Date.now() }]);
  }, []);

  const generateDeck = useCallback(
    async (topic) => {
      if (busyRef.current || !topic.trim()) return;
      busyRef.current = true;
      addMessage("system", `📑 Generating a deck about “${topic.trim()}”…`);
      setBusy("generating");
      try {
        const res = await fetch("/api/generate-deck", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic: topic.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || data.error || `Backend returned ${res.status}`);

        setSlides(data.slides);
        setDeckTopic(data.topic);
        setCurrentSlide(0);
        addMessage("system", `✅ New deck ready: ${data.topic}`);
        setBusy(null);
        busyRef.current = false;

        const intro = data.slides[0]?.narration;
        if (intro) {
          addMessage("ai", intro);
          await speakRef.current(intro);
        }
      } catch (err) {
        console.error(err);
        addMessage("system", `⚠ ${err.message}`);
        setBusy(null);
        busyRef.current = false;
      }
    },
    [addMessage]
  );

  const handleFinalResult = useCallback(
    async (question) => {
      if (busyRef.current) return; // one request at a time

      // "Make a presentation about X" → generate a new deck instead of Q&A
      const deckMatch = question.match(DECK_REQUEST);
      if (deckMatch) {
        addMessage("user", question);
        return generateDeck(deckMatch[1]);
      }

      busyRef.current = true;
      addMessage("user", question);
      setBusy("thinking");
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
        setBusy(null);
        busyRef.current = false; // allow barge-in questions while speaking
        await speakRef.current(answer);
      } catch (err) {
        console.error(err);
        addMessage("system", "⚠ Couldn't reach the backend. Is it running on port 3001?");
        setBusy(null);
        busyRef.current = false;
      }
    },
    [addMessage, generateDeck]
  );

  const voice = useVoice({ onFinalResult: handleFinalResult });
  const speakRef = useRef(voice.speak);
  speakRef.current = voice.speak;

  // Status is derived, not managed: requests > narration > mic state
  const status = busy ?? (voice.speaking ? "speaking" : voice.listening ? "listening" : "idle");

  // Load the deck + agent mode from the backend
  useEffect(() => {
    fetch("/api/slides")
      .then((r) => r.json())
      .then((data) => {
        setSlides(data.slides);
        setDeckTopic(data.topic ?? "");
      })
      .catch(() => addMessage("system", "⚠ Backend not reachable — start it with: npm run dev (in backend/)"));
    fetch("/api/health")
      .then((r) => r.json())
      .then((data) => setAgentMode(data.mode))
      .catch(() => {});
  }, [addMessage]);

  // Mic button: pure listen on/off toggle — never touches narration
  const toggleMic = () => {
    if (voice.listening) voice.stopListening();
    else voice.startListening();
  };

  const presentSlide = async (index) => {
    const slide = slides[index];
    if (!slide?.narration) return;
    voice.stopSpeaking();
    setCurrentSlide(index);
    addMessage("ai", slide.narration);
    await voice.speak(slide.narration);
  };

  const goTo = (index) => {
    const clamped = Math.min(Math.max(index, 0), slides.length - 1);
    setCurrentSlide(clamped);
  };

  const onTopicSubmit = (e) => {
    e.preventDefault();
    generateDeck(topicInput);
    setTopicInput("");
  };

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>🎙 AI Voice Slides</h1>
          {deckTopic && <div className="deck-topic">Now presenting: {deckTopic}</div>}
        </div>
        <div className="topbar-right">
          {agentMode && (
            <span className={`badge ${agentMode === "offline" ? "badge-offline" : "badge-claude"}`}>
              {agentMode === "claude" && "Claude agent"}
              {agentMode === "gemini" && "Gemini agent"}
              {agentMode === "offline" && "Offline mode"}
            </span>
          )}
          <span className={`status status-${status}`}>
            {status === "idle" && "Mic off"}
            {status === "listening" && "Listening…"}
            {status === "thinking" && "Thinking…"}
            {status === "generating" && "Generating deck…"}
            {status === "speaking" && "Speaking — ✋ to interrupt"}
          </span>
        </div>
      </header>

      {!voice.supported && (
        <div className="warning">
          Your browser doesn't support the Web Speech API. Please use Chrome or Edge.
        </div>
      )}

      {agentMode === "offline" && (
        <div className="notice">
          Offline mode: Q&amp;A uses simple text matching and new decks can't be generated.
          Add <code>ANTHROPIC_API_KEY</code> or <code>GEMINI_API_KEY</code> (free at{" "}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com</a>)
          to <code>backend/.env</code> and restart the backend to present any topic.
        </div>
      )}

      <form className="topic-row" onSubmit={onTopicSubmit}>
        <input
          type="text"
          value={topicInput}
          onChange={(e) => setTopicInput(e.target.value)}
          placeholder='Present any topic… e.g. "The Roman Empire" or "How rockets work"'
          disabled={busy === "generating"}
        />
        <button type="submit" disabled={busy === "generating" || !topicInput.trim()}>
          {busy === "generating" ? "Generating…" : "✨ Generate deck"}
        </button>
      </form>

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
              <button
                className="stop-button"
                onClick={() => {
                  voice.stopSpeaking();
                  addMessage("system", "⏸ Narration interrupted");
                }}
              >
                ✋ Interrupt
              </button>
            )}
            {voice.interimText && <span className="interim">“{voice.interimText}”</span>}
          </div>
        </section>

        <Transcript messages={messages} />
      </main>

      <footer className="hints">
        Try: “Make a presentation about volcanoes” · “Tell me more about slide 2” ·
        “Next slide” · “Go to slide 3” · or just ask anything about the current deck
      </footer>
    </div>
  );
}
