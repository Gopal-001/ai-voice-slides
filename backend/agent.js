import Anthropic from "@anthropic-ai/sdk";

const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
const client = hasApiKey ? new Anthropic() : null;

export const claudeEnabled = hasApiKey;

/* ---------------------------------------------------------------- *
 *  Deck generation: Claude writes a 5-6 slide deck on any topic     *
 * ---------------------------------------------------------------- */

const DECK_PROMPT = `You write slide decks for a live AI voice presenter. The narration is read aloud by text-to-speech, so it must be natural spoken prose — no markdown, no symbols, no lists.

Given a topic, produce a deck of exactly 6 slides:
- Slide 1 introduces the topic and the agenda.
- Slides 2-5 each cover one key sub-topic.
- Slide 6 wraps up: takeaways, open questions, or what to explore next.

Respond with ONLY a JSON object, no other text:
{
  "topic": "<clean short title for the topic>",
  "slides": [
    {
      "title": "<slide title, max 8 words>",
      "subtitle": "<one-line hook>",
      "bullets": ["<3 to 4 short bullet points>"],
      "narration": "<3-4 conversational spoken sentences presenting this slide>"
    }
  ]
}`;

export async function generateDeck(topic) {
  if (!client) {
    const err = new Error(
      "Deck generation needs the Claude API. Add ANTHROPIC_API_KEY to backend/.env and restart the backend."
    );
    err.status = 400;
    throw err;
  }

  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 8000,
    system: DECK_PROMPT,
    messages: [{ role: "user", content: `Topic: ${topic}` }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);

  if (!Array.isArray(parsed.slides) || parsed.slides.length < 3) {
    throw new Error("Model returned an invalid deck");
  }

  return {
    topic: String(parsed.topic || topic),
    slides: parsed.slides.map((s, i) => ({
      id: i,
      title: String(s.title ?? `Slide ${i + 1}`),
      subtitle: String(s.subtitle ?? ""),
      bullets: (Array.isArray(s.bullets) ? s.bullets : []).map(String),
      narration: String(s.narration ?? ""),
    })),
  };
}

/* ---------------------------------------------------------------- *
 *  Q&A: answer a spoken question grounded in the current deck       *
 * ---------------------------------------------------------------- */

function buildSystemPrompt(deck) {
  const slideDetail = deck.slides
    .map(
      (s) =>
        `Slide ${s.id}: "${s.title}"\n  Points: ${s.bullets.join("; ")}\n  Narration: ${s.narration}`
    )
    .join("\n");

  return `You are a friendly voice presenter giving a live spoken presentation on "${deck.topic}". These are your slides:

${slideDetail}

The user asks questions by voice; your answer is read aloud by text-to-speech.

Rules:
- Answer in 2-4 short conversational sentences. No markdown, no lists, no symbols — this is spoken aloud.
- Ground your answer in the deck when it covers the question; you may add your own knowledge to go deeper.
- Pick the slide most relevant to the question. If the current slide is already the best fit, keep it.
- If the user asks to go to the next/previous/first/last slide or a specific slide, honor that.
- If the question is off-topic, answer briefly and keep the current slide.

Respond with ONLY a JSON object, no other text:
{"answer": "<spoken answer>", "slide": <slide id 0-${deck.slides.length - 1}>}`;
}

async function claudeAgent(question, currentSlide, deck) {
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 1024, // spoken answers are deliberately short
    output_config: { effort: "low" }, // low latency matters for voice
    system: buildSystemPrompt(deck),
    messages: [
      {
        role: "user",
        content: `Current slide: ${currentSlide}. User asked (via voice): "${question}"`,
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  const slide = Math.min(Math.max(Number(parsed.slide) || 0, 0), deck.slides.length - 1);
  return { answer: String(parsed.answer), slide };
}

/* ---------------------------------------------------------------- *
 *  Offline fallback: works on ANY deck by matching question words   *
 *  against slide text (no canned answers required)                  *
 * ---------------------------------------------------------------- */

const STOPWORDS = new Set(
  "a an the is are was were be been do does did what when where which who why how tell me about of in on to for with and or it its this that these those can could you your".split(" ")
);

function slideText(slide) {
  return [slide.title, slide.subtitle, ...slide.bullets, slide.narration]
    .join(" ")
    .toLowerCase();
}

function fallbackAgent(question, currentSlide, deck) {
  const q = question.toLowerCase();
  const slides = deck.slides;
  const last = slides.length - 1;

  // Navigation commands first
  if (/\b(next|forward|continue|move on)\b/.test(q)) {
    const target = Math.min(currentSlide + 1, last);
    return { answer: slides[target].narration || slides[target].title, slide: target };
  }
  if (/\b(previous|back|go back)\b/.test(q)) {
    const target = Math.max(currentSlide - 1, 0);
    return { answer: slides[target].narration || slides[target].title, slide: target };
  }
  const numberMatch = q.match(/slide (\d+)|(first|second|third|fourth|fifth|sixth) slide/);
  if (numberMatch) {
    const words = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6 };
    const n = numberMatch[1] ? parseInt(numberMatch[1], 10) : words[numberMatch[2]];
    const target = Math.min(Math.max(n - 1, 0), last);
    return { answer: slides[target].narration || slides[target].title, slide: target };
  }

  // Score each slide by how many meaningful question words appear in its text
  const qWords = q.replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w && !STOPWORDS.has(w));
  let best = { score: 0, slide: currentSlide };
  for (const s of slides) {
    const text = slideText(s);
    const score = qWords.filter((w) => text.includes(w)).length;
    if (score > best.score) best = { score, slide: s.id };
  }

  if (best.score === 0) {
    return {
      answer:
        "I'm running in offline mode, so I can only match your question to slide content. Try mentioning a topic from one of the slides, or say next slide.",
      slide: currentSlide,
    };
  }
  return { answer: slides[best.slide].narration || slides[best.slide].title, slide: best.slide };
}

/* ---------------------------------------------------------------- */

/**
 * Main entry: answer a question and choose the slide to show,
 * grounded in whatever deck is currently loaded.
 */
export async function askAgent(question, currentSlide, deck) {
  if (!client) {
    return { ...fallbackAgent(question, currentSlide, deck), source: "offline" };
  }
  try {
    return { ...(await claudeAgent(question, currentSlide, deck)), source: "claude" };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      console.error("Invalid ANTHROPIC_API_KEY — falling back to offline mode.");
    } else if (error instanceof Anthropic.RateLimitError) {
      console.error("Rate limited by the Claude API — falling back to offline mode.");
    } else if (error instanceof Anthropic.APIError) {
      console.error(`Claude API error ${error.status}: ${error.message}`);
    } else {
      console.error("Agent error:", error);
    }
    return { ...fallbackAgent(question, currentSlide, deck), source: "offline-fallback" };
  }
}
