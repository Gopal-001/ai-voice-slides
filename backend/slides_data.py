"""Built-in sample deck: "How Large Language Models Work".

Used as the startup deck before the user generates their own via
POST /api/generate-deck. Each slide has a narration script the agent
reads aloud when presenting.
"""

DEFAULT_TOPIC = "How Large Language Models Work"

DEFAULT_SLIDES = [
    {
        "id": 0,
        "title": "How Large Language Models Work",
        "subtitle": "A 6-slide crash course",
        "bullets": [
            "What an LLM actually is",
            "Tokens, training, and transformers",
            "Why they sometimes get things wrong",
        ],
        "narration": (
            "Welcome! In this short presentation we'll walk through how large language "
            "models like Claude and GPT actually work — from tokens, to training, to why "
            "they sometimes make things up. Ask me anything at any point, and I'll jump "
            "to the right slide."
        ),
    },
    {
        "id": 1,
        "title": "Tokens: The Alphabet of AI",
        "subtitle": "Models don't read words — they read tokens",
        "bullets": [
            "Text is split into tokens (~4 characters each on average)",
            '"understanding" might become "under" + "standing"',
            "The model predicts the next token, one at a time",
            "Context window = how many tokens the model can see at once",
        ],
        "narration": (
            "Language models don't see words or letters the way we do. Text is chopped "
            "into tokens — chunks of roughly four characters. The word 'understanding' "
            "might be split into 'under' and 'standing'. Everything an LLM does boils "
            "down to one trick: predicting the most likely next token, over and over."
        ),
    },
    {
        "id": 2,
        "title": "Training: Learning from the Internet",
        "subtitle": "Two phases: pretraining, then fine-tuning",
        "bullets": [
            "Pretraining: predict the next token on trillions of tokens of text",
            "Fine-tuning: learn to be helpful, harmless, and follow instructions",
            "RLHF: humans rank answers, the model learns preferences",
            "No database of facts — knowledge is compressed into weights",
        ],
        "narration": (
            "Training happens in two big phases. First, pretraining: the model reads "
            "trillions of tokens of text and learns to predict what comes next. Then "
            "fine-tuning: humans rate the model's answers, teaching it to be helpful and "
            "follow instructions — a process called reinforcement learning from human "
            "feedback. Importantly, there's no database inside — all knowledge is "
            "compressed into billions of numeric weights."
        ),
    },
    {
        "id": 3,
        "title": "The Transformer: Attention Is All You Need",
        "subtitle": "The architecture behind every modern LLM",
        "bullets": [
            "Introduced by Google researchers in 2017",
            "Self-attention: every token 'looks at' every other token",
            "That's how 'it' in a sentence knows what it refers to",
            "Stacked in layers — big models have 100+ layers",
        ],
        "narration": (
            "Under the hood, nearly every modern LLM is a transformer — an architecture "
            "introduced in the famous 2017 paper 'Attention Is All You Need'. Its key "
            "idea is self-attention: every token can look at every other token in the "
            "input, which is how the model figures out that the word 'it' refers to 'the "
            "cat' three sentences back. Stack a hundred of these attention layers, and "
            "you get a frontier model."
        ),
    },
    {
        "id": 4,
        "title": "Prompting: Programming in English",
        "subtitle": "The model's behavior is steered by its input",
        "bullets": [
            "A prompt is just the tokens the model conditions on",
            "Few-shot: show examples, the model follows the pattern",
            "System prompts set persona, rules, and tone",
            "Better prompt → better next-token predictions → better answers",
        ],
        "narration": (
            "Once trained, you steer an LLM through prompting. A prompt is simply the "
            "text the model conditions on before predicting. Show it a few examples and "
            "it follows the pattern — that's few-shot learning. System prompts set the "
            "persona and rules. Prompting is essentially programming in plain English."
        ),
    },
    {
        "id": 5,
        "title": "Limitations: Hallucinations & Beyond",
        "subtitle": "Why LLMs confidently make things up",
        "bullets": [
            "Hallucination: fluent text ≠ true text",
            "The model optimizes plausibility, not truth",
            "Knowledge cutoff: no awareness of recent events",
            "Mitigations: retrieval (RAG), tool use, citations",
        ],
        "narration": (
            "Finally, the limitations. LLMs hallucinate — they produce fluent, confident "
            "text that can be completely wrong, because they optimize for plausibility, "
            "not truth. They also have a knowledge cutoff and can't know about recent "
            "events. Mitigations include retrieval-augmented generation, tool use, and "
            "citing sources. That's the end of the deck — happy to revisit any slide or "
            "take more questions!"
        ),
    },
]
