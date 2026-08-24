import "dotenv/config";
import express from "express";
import cors from "cors";
import { slides } from "./slides.js";
import { askAgent } from "./agent.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Full slide deck for the frontend to render
app.get("/api/slides", (_req, res) => {
  res.json({ slides });
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
    const result = await askAgent(question.trim(), slideIndex);
    res.json(result);
  } catch (error) {
    console.error("Unhandled agent error:", error);
    res.status(500).json({ error: "Agent failed to answer" });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mode: process.env.ANTHROPIC_API_KEY ? "claude" : "offline",
  });
});

app.listen(PORT, () => {
  const mode = process.env.ANTHROPIC_API_KEY
    ? "Claude API (claude-opus-5)"
    : "offline keyword matching (set ANTHROPIC_API_KEY for the full agent)";
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`Agent mode: ${mode}`);
});
