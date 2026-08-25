"""The agent brain: deck generation and deck-grounded Q&A.

Providers, in order of preference:
  1. Claude   — set ANTHROPIC_API_KEY
  2. Gemini   — set GEMINI_API_KEY (free tier at https://aistudio.google.com)
  3. Offline  — word-overlap matching, so the prototype runs with no key at all
"""

import json
import os
import re

import anthropic
import httpx
from dotenv import load_dotenv

load_dotenv()

CLAUDE_ENABLED = bool(os.environ.get("ANTHROPIC_API_KEY"))
GEMINI_ENABLED = bool(os.environ.get("GEMINI_API_KEY"))

# Auto-pick a provider; LLM_PROVIDER=claude|gemini|offline in .env forces one
# (useful when a key is present but unusable, e.g. no API credits).
_requested = os.environ.get("LLM_PROVIDER", "").strip().lower()
if _requested == "claude" and CLAUDE_ENABLED:
    PROVIDER = "claude"
elif _requested == "gemini" and GEMINI_ENABLED:
    PROVIDER = "gemini"
elif _requested == "offline":
    PROVIDER = "offline"
else:
    PROVIDER = "claude" if CLAUDE_ENABLED else "gemini" if GEMINI_ENABLED else "offline"

client = anthropic.Anthropic() if CLAUDE_ENABLED else None

MODEL = "claude-opus-5"
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

# ---------------------------------------------------------------------------
# Deck generation: the LLM writes a 6-slide deck on any topic
# ---------------------------------------------------------------------------

DECK_PROMPT = """You write slide decks for a live AI voice presenter. The narration is read aloud by text-to-speech, so it must be natural spoken prose — no markdown, no symbols, no lists.

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
}"""


class DeckGenerationUnavailable(Exception):
    """Raised when deck generation is requested but no API key is configured."""


# Gemini structured-output schemas (OpenAPI subset)
DECK_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "topic": {"type": "STRING"},
        "slides": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "title": {"type": "STRING"},
                    "subtitle": {"type": "STRING"},
                    "bullets": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "narration": {"type": "STRING"},
                },
                "required": ["title", "subtitle", "bullets", "narration"],
            },
        },
    },
    "required": ["topic", "slides"],
}

ANSWER_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "answer": {"type": "STRING"},
        "slide": {"type": "INTEGER"},
    },
    "required": ["answer", "slide"],
}


def _extract_json(text: str) -> dict:
    match = re.search(r"\{[\s\S]*\}", text)
    return json.loads(match.group(0) if match else text)


def _response_text(response) -> str:
    return "".join(block.text for block in response.content if block.type == "text")


def _gemini_text(system: str, user: str, max_tokens: int, schema: dict | None) -> str:
    """Call the Gemini REST API (free tier) and return the response text."""
    generation_config = {
        "maxOutputTokens": max_tokens,
        "responseMimeType": "application/json",
    }
    if schema:
        # Structured output: constrains Gemini to valid JSON matching the schema
        generation_config["responseSchema"] = schema

    response = httpx.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
        headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]},
        json={
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": generation_config,
        },
        timeout=90.0,
    )
    response.raise_for_status()
    data = response.json()
    candidate = data["candidates"][0]
    if candidate.get("finishReason") == "MAX_TOKENS":
        raise ValueError("Gemini response was cut off (MAX_TOKENS)")
    return "".join(
        part.get("text", "")
        for part in candidate["content"]["parts"]
    )


def _llm_text(system: str, user: str, max_tokens: int, schema: dict | None = None) -> str:
    """Route a single system+user request to the configured provider."""
    if PROVIDER == "claude":
        response = client.messages.create(
            model=MODEL,
            max_tokens=max_tokens,
            output_config={"effort": "low"},  # low latency matters for voice
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return _response_text(response)
    return _gemini_text(system, user, max_tokens, schema)


def _llm_json(system: str, user: str, max_tokens: int, schema: dict | None = None) -> dict:
    """LLM call + JSON parse, with one retry — models occasionally emit broken JSON."""
    try:
        return _extract_json(_llm_text(system, user, max_tokens, schema))
    except (json.JSONDecodeError, ValueError) as error:
        print(f"Bad JSON from model ({error}) — retrying once")
        return _extract_json(_llm_text(system, user, max_tokens, schema))


def generate_deck(topic: str) -> dict:
    if PROVIDER == "offline":
        raise DeckGenerationUnavailable(
            "Deck generation needs an LLM. Add ANTHROPIC_API_KEY (Claude) or "
            "GEMINI_API_KEY (free at aistudio.google.com) to backend/.env and "
            "restart the backend."
        )

    parsed = _llm_json(DECK_PROMPT, f"Topic: {topic}", 8000, DECK_SCHEMA)

    slides = parsed.get("slides")
    if not isinstance(slides, list) or len(slides) < 3:
        raise ValueError("Model returned an invalid deck")

    return {
        "topic": str(parsed.get("topic") or topic),
        "slides": [
            {
                "id": i,
                "title": str(s.get("title") or f"Slide {i + 1}"),
                "subtitle": str(s.get("subtitle") or ""),
                "bullets": [str(b) for b in (s.get("bullets") or [])],
                "narration": str(s.get("narration") or ""),
            }
            for i, s in enumerate(slides)
        ],
    }


# ---------------------------------------------------------------------------
# Q&A: answer a spoken question grounded in the current deck
# ---------------------------------------------------------------------------


def _build_system_prompt(deck: dict) -> str:
    slide_detail = "\n".join(
        f'Slide {s["id"]}: "{s["title"]}"\n'
        f'  Points: {"; ".join(s["bullets"])}\n'
        f'  Narration: {s["narration"]}'
        for s in deck["slides"]
    )
    last = len(deck["slides"]) - 1
    return f"""You are a friendly voice presenter giving a live spoken presentation on "{deck["topic"]}". These are your slides:

{slide_detail}

The user asks questions by voice; your answer is read aloud by text-to-speech.

Rules:
- Answer in 2-4 short conversational sentences. No markdown, no lists, no symbols — this is spoken aloud.
- Ground your answer in the deck when it covers the question; you may add your own knowledge to go deeper.
- Pick the slide most relevant to the question. If the current slide is already the best fit, keep it.
- If the user asks to go to the next/previous/first/last slide or a specific slide, honor that.
- If the question is off-topic, answer briefly and keep the current slide.

Respond with ONLY a JSON object, no other text:
{{"answer": "<spoken answer>", "slide": <slide id 0-{last}>}}"""


def _llm_agent(question: str, current_slide: int, deck: dict) -> dict:
    parsed = _llm_json(
        _build_system_prompt(deck),
        f'Current slide: {current_slide}. User asked (via voice): "{question}"',
        1024,  # spoken answers are deliberately short
        ANSWER_SCHEMA,
    )
    slide = min(max(int(parsed.get("slide") or 0), 0), len(deck["slides"]) - 1)
    return {"answer": str(parsed.get("answer") or ""), "slide": slide}


# ---------------------------------------------------------------------------
# Offline fallback: works on ANY deck by matching question words against
# slide text (no canned answers required)
# ---------------------------------------------------------------------------

STOPWORDS = set(
    "a an the is are was were be been do does did what when where which who why "
    "how tell me about of in on to for with and or it its this that these those "
    "they them can could you your".split()
)

_ORDINALS = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6}


def _stems(word: str) -> set[str]:
    """Cheap stemming so 'trained' matches 'training', 'tokens' matches 'token'."""
    stems = {word}
    for suffix in ("ing", "ed", "es", "s"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            stems.add(word[: -len(suffix)])
    return stems


def _slide_text(slide: dict) -> str:
    return " ".join(
        [slide["title"], slide["subtitle"], *slide["bullets"], slide["narration"]]
    ).lower()


def _narrate(slide: dict) -> str:
    return slide["narration"] or slide["title"]


def _fallback_agent(question: str, current_slide: int, deck: dict) -> dict:
    q = question.lower()
    slides = deck["slides"]
    last = len(slides) - 1

    # Navigation commands first
    if re.search(r"\b(next|forward|continue|move on)\b", q):
        target = min(current_slide + 1, last)
        return {"answer": _narrate(slides[target]), "slide": target}
    if re.search(r"\b(previous|back|go back)\b", q):
        target = max(current_slide - 1, 0)
        return {"answer": _narrate(slides[target]), "slide": target}
    number_match = re.search(r"slide (\d+)|(first|second|third|fourth|fifth|sixth) slide", q)
    if number_match:
        n = int(number_match.group(1)) if number_match.group(1) else _ORDINALS[number_match.group(2)]
        target = min(max(n - 1, 0), last)
        return {"answer": _narrate(slides[target]), "slide": target}

    # Score each slide by occurrences of the meaningful question words in its
    # text. Weight by word length (distinctive words outrank short common ones)
    # and divide by how many slides mention the word, so deck-wide terms like
    # "model" don't drown out slide-specific ones like "hallucinate".
    q_words = [
        w for w in re.sub(r"[^a-z0-9\s]", "", q).split() if w and w not in STOPWORDS
    ]
    texts = [_slide_text(s) for s in slides]
    best_score, best_slide = 0.0, current_slide
    for s, text in zip(slides, texts):
        score = 0.0
        for w in q_words:
            stems = _stems(w)
            count = max(text.count(st) for st in stems)
            if count:
                doc_freq = sum(1 for t in texts if any(st in t for st in stems))
                score += len(w) * count / doc_freq
        if score > best_score:
            best_score, best_slide = score, s["id"]

    if best_score == 0:
        return {
            "answer": (
                "I'm running in offline mode, so I can only match your question to "
                "slide content. Try mentioning a topic from one of the slides, or "
                "say next slide."
            ),
            "slide": current_slide,
        }
    return {"answer": _narrate(slides[best_slide]), "slide": best_slide}


# ---------------------------------------------------------------------------


def ask_agent(question: str, current_slide: int, deck: dict) -> dict:
    """Answer a question and choose the slide to show, grounded in the current deck."""
    if PROVIDER == "offline":
        return {**_fallback_agent(question, current_slide, deck), "source": "offline"}
    try:
        return {**_llm_agent(question, current_slide, deck), "source": PROVIDER}
    except anthropic.AuthenticationError:
        print("Invalid ANTHROPIC_API_KEY — falling back to offline mode.")
    except anthropic.RateLimitError:
        print("Rate limited by the Claude API — falling back to offline mode.")
    except anthropic.APIStatusError as error:
        print(f"Claude API error {error.status_code}: {error.message}")
    except anthropic.APIConnectionError as error:
        print(f"Could not reach the Claude API: {error}")
    except httpx.HTTPStatusError as error:
        print(f"Gemini API error {error.response.status_code}: {error.response.text[:300]}")
    except httpx.HTTPError as error:
        print(f"Could not reach the Gemini API: {error}")
    except (json.JSONDecodeError, ValueError, KeyError, IndexError) as error:
        print(f"Could not parse the model response: {error}")
    return {**_fallback_agent(question, current_slide, deck), "source": "offline-fallback"}
