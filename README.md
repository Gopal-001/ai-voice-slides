# 🎙 AI Voice Slides

A working prototype of an **AI voice presentation agent**. The AI presents a 6-slide deck ("How Large Language Models Work"), answers spoken questions out loud, **automatically jumps to the slide relevant to your question**, and can be **interrupted mid-sentence** just by talking over it.

## Features

- **6-slide deck** on "How Large Language Models Work", served by the backend
- **Voice in / voice out** — Web Speech API (speech recognition + speech synthesis), no audio API keys needed
- **Automatic slide navigation** — ask "why do models hallucinate?" and the deck jumps to the Limitations slide while the AI answers
- **Barge-in interruption** — start talking while the AI is speaking and it stops immediately; your speech becomes the next question
- **Voice navigation** — "next slide", "go back", "go to slide 3"
- **Lightweight stack** — React + Vite frontend, Node + Express backend
- **Two agent modes**:
  - **Claude mode** (recommended): set `ANTHROPIC_API_KEY` and a Claude model answers free-form questions and picks the target slide
  - **Offline mode** (zero config): keyword matching maps questions to slides so the demo works with no API key at all

## Architecture

```
┌────────────────────────────┐        ┌──────────────────────────────┐
│  Frontend (React + Vite)   │        │  Backend (Node + Express)    │
│                            │        │                              │
│  Web Speech API            │  HTTP  │  GET  /api/slides            │
│   ├─ SpeechRecognition ────┼───────▶│  POST /api/ask               │
│   │   (mic → text)         │        │        │                     │
│   └─ SpeechSynthesis       │◀───────┼────────┤                     │
│       (text → voice)       │ answer │   Claude API (if key set)    │
│                            │ +slide │   or keyword matcher         │
│  Slide deck UI + barge-in  │        │                              │
└────────────────────────────┘        └──────────────────────────────┘
```

The interruption logic lives in the frontend ([useVoice.js](frontend/src/useVoice.js)): the microphone stays open while the AI speaks. If the recognizer picks up 2+ words that aren't an echo of the AI's own audio, `speechSynthesis.cancel()` fires instantly and the user's speech is treated as the next question.

## Getting started

**Requirements:** Node 18+, and **Chrome or Edge** (the Web Speech API's `SpeechRecognition` is not available in Firefox).

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env   # optional: add your ANTHROPIC_API_KEY for the full agent
npm run dev            # starts on http://localhost:3001
```

Without an API key the backend runs in offline keyword-matching mode — fine for a demo.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev            # starts on http://localhost:5173 (proxies /api to the backend)
```

Open http://localhost:5173, click **🎤 Start mic**, allow microphone access, and start asking questions.

### Things to try

- "Tell me about tokens"
- "How are these models trained?"
- "What is attention?" → jumps to the Transformer slide
- "Why do these models make things up?" → jumps to Limitations
- "Next slide" / "Go to slide 3"
- Interrupt the AI mid-answer just by talking

## Notes & limitations

- **Use headphones for the best barge-in experience.** With loudspeakers, the mic can pick up the AI's own voice; a simple echo filter drops transcripts that match what the AI just said, but headphones make interruption crisper.
- Speech recognition quality depends on the browser's engine (Chrome routes it through Google's speech service).
- The prototype is single-session and keeps no server-side state — the frontend sends the current slide index with each question.

## Project structure

```
ai-voice-slides/
├── backend/
│   ├── server.js      # Express app: /api/slides, /api/ask, /api/health
│   ├── agent.js       # Claude-powered agent + offline keyword fallback
│   ├── slides.js      # Slide content, narration scripts, keywords
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── App.jsx            # State machine: idle → listening → thinking → speaking
    │   ├── useVoice.js        # Web Speech API hook: recognition, synthesis, barge-in
    │   └── components/
    │       ├── SlideDeck.jsx  # Slide rendering + manual navigation
    │       └── Transcript.jsx # Conversation log
    └── vite.config.js         # Dev server + /api proxy
```
