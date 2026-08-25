"""FastAPI backend for the AI voice presentation agent.

Run with:  uvicorn main:app --port 3001 --reload
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agent import (
    CLAUDE_ENABLED,
    DeckGenerationUnavailable,
    ask_agent,
    generate_deck,
)
from slides_data import DEFAULT_SLIDES, DEFAULT_TOPIC

app = FastAPI(title="AI Voice Slides", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# The deck currently being presented. Starts with the built-in sample;
# POST /api/generate-deck replaces it with a Claude-generated deck on any topic.
deck = {"topic": DEFAULT_TOPIC, "slides": DEFAULT_SLIDES}


class AskRequest(BaseModel):
    question: str = Field(min_length=1)
    currentSlide: int = 0


class GenerateDeckRequest(BaseModel):
    topic: str = Field(min_length=1)


@app.get("/api/slides")
def get_slides():
    """Current deck for the frontend to render."""
    return deck


@app.post("/api/generate-deck")
def post_generate_deck(body: GenerateDeckRequest):
    """Generate a brand-new deck on any topic (requires ANTHROPIC_API_KEY)."""
    global deck
    try:
        deck = generate_deck(body.topic.strip())
    except DeckGenerationUnavailable as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        print(f"Deck generation failed: {error}")
        raise HTTPException(status_code=500, detail=f"Deck generation failed: {error}")
    print(f'Generated deck: "{deck["topic"]}" ({len(deck["slides"])} slides)')
    return deck


@app.post("/api/ask")
def post_ask(body: AskRequest):
    """Answer a voice-transcribed question and pick the slide to display."""
    slide_index = min(max(body.currentSlide, 0), len(deck["slides"]) - 1)
    return ask_agent(body.question.strip(), slide_index, deck)


@app.get("/api/health")
def get_health():
    return {"ok": True, "mode": "claude" if CLAUDE_ENABLED else "offline"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=3001)
