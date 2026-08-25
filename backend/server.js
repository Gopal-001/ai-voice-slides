import "dotenv/config";
import express from "express";
import cors from "cors";
import { slides as defaultSlides } from "./slides.js";
import { askAgent, generateDeck, claudeEnabled } from "./agent.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// The deck currently being presented. Starts with the built-in sample;
// POST /api/generate-deck replaces it with a Claude-generated deck on any topic.
let deck = { topic: "How Large Language Models Work", slides: defaultSlides };

// Current deck for the frontend to render
app.get("/api/slides", (_req, res) => {
  res.json({ topic: deck.topic, slides: deck.slides });
});

// Generate a brand-new deck on any topic (requires ANTHROPIC_API_KEY)
app.post("/api/generate-deck", async (req, res) => {
  const { topic } = req.body ?? {};
  if (typeof topic !== "string" || !topic.trim()) {
    return res.status(400).json({ error: "topic (string) is required" });
  }
  try {
    deck = await generateDeck(topic.trim());
    console.log(`Generated deck: "${deck.topic}" (${deck.slides.length} slides)`);
    res.json(deck);
  } catch (error) {
    console.error("Deck generation failed:", error.message);
    res.status(error.status || 500).json({ error: error.message });
  }
});

// The agent: takes a voice-transcribed question + current slide,
// returns a spoken answer and the slide to display.
app.post("/api/ask", async (req, res) => {
  const { question, currentSlide } = req.body ?? {};
  if (typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ error: "question (string) is required" });
  }
  const slideIndex = Number.isInteger(currentSlide) ? currentSlide : 0;

  try {
    const result = await askAgent(question.trim(), slideIndex, deck);
    res.json(result);
  } catch (error) {
    console.error("Unhandled agent error:", error);
    res.status(500).json({ error: "Agent failed to answer" });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, mode: claudeEnabled ? "claude" : "offline" });
});

app.listen(PORT, () => {
  const mode = claudeEnabled
    ? "Claude API (claude-opus-5) — dynamic decks enabled"
    : "offline keyword matching (set ANTHROPIC_API_KEY to enable dynamic deck generation)";
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`Agent mode: ${mode}`);
});
