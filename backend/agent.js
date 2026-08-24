import Anthropic from "@anthropic-ai/sdk";
import { slides } from "./slides.js";

const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
const client = hasApiKey ? new Anthropic() : null;

const slideSummary = slides
  .map((s) => `Slide ${s.id}: "${s.title}" — ${s.bullets.join("; ")}`)
  .join("\n");

const SYSTEM_PROMPT = `You are a friendly voice presenter giving a live spoken presentation titled "How Large Language Models Work". These are your slides:

${slideSummary}

The user asks questions by voice; your answer is read aloud by text-to-speech.

Rules:
- Answer in 2-4 short conversational sentences. No markdown, no lists, no symbols — this is spoken aloud.
- Pick the slide most relevant to the question. If the current slide is already the best fit, keep it.
- If the user asks to go to the next/previous/first/last slide or a specific slide, honor that.
- If the question is off-topic, answer briefly and keep the current slide.

Respond with ONLY a JSON object, no other text:
{"answer": "<spoken answer>", "slide": <slide id 0-5>}`;

/**
 * Offline fallback: keyword-match the question against slide keywords.
 * Lets the prototype run with no API key.
 */
function keywordAgent(question, currentSlide) {
  const q = question.toLowerCase();

  // Navigation commands first
  if (/\b(next|forward|continue|move on)\b/.test(q)) {
    const target = Math.min(currentSlide + 1, slides.length - 1);
    return { answer: slides[target].narration, slide: target };
  }
  if (/\b(previous|back|go back)\b/.test(q)) {
    const target = Math.max(currentSlide - 1, 0);
    return { answer: slides[target].narration, slide: target };
  }
  const numberMatch = q.match(/slide (\d+)|(first|second|third|fourth|fifth|sixth) slide/);
  if (numberMatch) {
    const words = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6 };
    const n = numberMatch[1] ? parseInt(numberMatch[1], 10) : words[numberMatch[2]];
    const target = Math.min(Math.max(n - 1, 0), slides.length - 1);
    return { answer: slides[target].narration, slide: target };
  }

  // Score each slide by keyword hits
  let best = { score: 0, slide: currentSlide };
  for (const s of slides) {
    const score = s.keywords.filter((k) => q.includes(k)).length;
    if (score > best.score) best = { score, slide: s.id };
  }

  if (best.score === 0) {
    return {
      answer:
        "I'm running in offline mode, so I can only match questions to slide topics. Try asking about tokens, training, transformers, prompting, or hallucinations — or say next slide.",
      slide: currentSlide,
    };
  }
  return { answer: slides[best.slide].narration, slide: best.slide };
}

async function claudeAgent(question, currentSlide) {
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 1024, // spoken answers are deliberately short
    output_config: { effort: "low" }, // low latency matters for voice
    system: SYSTEM_PROMPT,
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

  // Extract the JSON object even if the model wraps it in stray text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  const slide = Math.min(Math.max(Number(parsed.slide) || 0, 0), slides.length - 1);
  return { answer: String(parsed.answer), slide };
}

/**
 * Main entry: answer a question and choose the slide to show.
 * Uses Claude when a key is configured, keyword matching otherwise.
 */
export async function askAgent(question, currentSlide) {
  if (!client) {
    return { ...keywordAgent(question, currentSlide), source: "offline" };
  }
  try {
    return { ...(await claudeAgent(question, currentSlide)), source: "claude" };
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
    return { ...keywordAgent(question, currentSlide), source: "offline-fallback" };
  }
}
