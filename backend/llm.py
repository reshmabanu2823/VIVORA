"""One small wrapper around the LLM. Providers: anthropic, openai (any OpenAI-compatible API), mock."""
import json
import logging
import re

import httpx

import config

log = logging.getLogger("vivora.llm")


class LLMError(Exception):
    pass


async def complete(system: str, user: str) -> str:
    """Send one request, retry once on failure. Returns the model's text."""
    last = None
    for attempt in range(2):
        try:
            if config.LLM_PROVIDER == "mock":
                return _mock(system, user)
            if config.LLM_PROVIDER == "anthropic":
                return await _anthropic(system, user)
            if config.LLM_PROVIDER == "openai":
                return await _openai(system, user)
            raise LLMError(f"Unknown LLM_PROVIDER '{config.LLM_PROVIDER}'")
        except LLMError:
            raise
        except Exception as e:  # network, timeout, bad status
            last = e
            log.warning("LLM call failed (attempt %d): %s", attempt + 1, e)
    raise LLMError(f"LLM request failed: {last}")


def _need_model():
    if not config.LLM_MODEL or not config.LLM_API_KEY:
        raise LLMError("LLM_API_KEY and LLM_MODEL must be set in .env (or use LLM_PROVIDER=mock for testing).")


async def _anthropic(system: str, user: str) -> str:
    _need_model()
    async with httpx.AsyncClient(timeout=config.LLM_TIMEOUT_SEC) as client:
        r = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": config.LLM_API_KEY, "anthropic-version": "2023-06-01",
                     "content-type": "application/json"},
            json={"model": config.LLM_MODEL, "max_tokens": 700, "temperature": config.LLM_TEMPERATURE,
                  "system": system, "messages": [{"role": "user", "content": user}]},
        )
        r.raise_for_status()
        data = r.json()
    return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text").strip()


async def _openai(system: str, user: str) -> str:
    _need_model()
    async with httpx.AsyncClient(timeout=config.LLM_TIMEOUT_SEC) as client:
        r = await client.post(
            config.LLM_BASE_URL.rstrip("/") + "/chat/completions",
            headers={"Authorization": f"Bearer {config.LLM_API_KEY}"},
            json={"model": config.LLM_MODEL, "temperature": config.LLM_TEMPERATURE, "max_tokens": 700,
                  "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
        )
        r.raise_for_status()
        data = r.json()
    return data["choices"][0]["message"]["content"].strip()


def parse_json(text: str) -> dict | None:
    """Pull a JSON object out of the model's reply (handles ```json fences and extra words)."""
    if not text:
        return None
    cleaned = re.sub(r"```(?:json)?", "", text).strip()
    try:
        obj = json.loads(cleaned)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        pass
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start != -1 and end > start:
        try:
            obj = json.loads(cleaned[start:end + 1])
            return obj if isinstance(obj, dict) else None
        except json.JSONDecodeError:
            return None
    return None


async def complete_json(system: str, user: str) -> dict | None:
    """Ask for JSON; if the reply is not valid JSON, ask once more with a stricter instruction."""
    text = await complete(system, user)
    obj = parse_json(text)
    if obj is not None:
        return obj
    text = await complete(system, user + "\n\nYour last reply was not valid JSON. Reply with ONLY the JSON object, nothing else.")
    return parse_json(text)


def _mock(system: str, user: str) -> str:
    """Deterministic mock model that grounds questions in the actual supplied report excerpt."""
    # 1. Feedback summary request
    if '"weak_topics"' in user:
        topics = ["Methodology"]
        m = re.search(r"\[(.*?)\]", user)
        if m and m.group(1).strip():
            topics = [m.group(1).strip()]
        return json.dumps({
            "weak_topics": topics[:2],
            "suggestions": [
                "Quantify technical metrics and benchmark comparisons.",
                "Explain the architectural trade-offs made in your implementation."
            ]
        })

    # 2. Evaluation request
    if '"verdict"' in user:
        answer_part = user.split("Student's answer:", 1)[-1].split("\n", 1)[0]
        words = answer_part.strip().split()
        verdict = "strong" if len(words) > 35 else "partial" if len(words) > 10 else "weak"
        return json.dumps({
            "verdict": verdict,
            "covered": ["primary concept"],
            "missed": ["quantitative validation"] if verdict != "strong" else [],
            "next_type": "followup" if verdict != "strong" else "new_topic"
        })

    # 3. Hint / nudge request
    if "hint number" in user or "nudge number" in user:
        excerpt_m = re.search(r"<report_excerpt>\s*(.*?)\s*</report_excerpt>", user, re.DOTALL)
        if excerpt_m:
            first_sentence = [s.strip() for s in re.split(r"[.!?]\s+", excerpt_m.group(1)) if len(s.strip()) > 10]
            if first_sentence:
                words = first_sentence[0].split()[:6]
                return f"Consider starting with {' '.join(words)}."
        return "Start with the core objective described in this section."

    # 4. Structured Question Generation with exact evidence
    title_m = re.search(r"Section title:\s*([^\n]+)", user)
    title = title_m.group(1).strip() if title_m else "Methodology"

    sid_m = re.search(r"Section ID:\s*(\d+)", user)
    section_id = int(sid_m.group(1)) if sid_m else 1

    excerpt_m = re.search(r"<report_excerpt>\s*(.*?)\s*</report_excerpt>", user, re.DOTALL)
    excerpt = excerpt_m.group(1).strip() if excerpt_m else "Project report excerpt."

    # Extract sentences from excerpt
    raw_sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", excerpt) if len(s.strip()) > 15]
    if not raw_sentences:
        raw_sentences = [excerpt[:120].strip()]

    # Pick sentence based on question count in prompt to ensure variation
    already_count = user.count("\n- ")
    sent_idx = already_count % len(raw_sentences)
    target_sentence = raw_sentences[sent_idx]

    # Extract a clean, verbatim phrase (3 to 8 words) from target_sentence as evidence
    words = target_sentence.split()
    if len(words) >= 4:
        # Choose a meaningful phrase from the sentence
        start_idx = 0 if len(words) <= 7 else min(1, len(words) - 5)
        length = min(len(words) - start_idx, 6)
        phrase = " ".join(words[start_idx:start_idx + length])
    else:
        phrase = target_sentence

    # Ensure phrase is an exact substring in excerpt
    if phrase not in excerpt:
        # Fallback to direct slice
        phrase = excerpt[:min(len(excerpt), 40)].strip()

    # Determine question framing by level
    level = "normal"
    if "warmup" in system.lower():
        level = "warmup"
    elif "strict" in system.lower():
        level = "strict"

    if level == "warmup":
        question = f"In the {title} section, can you explain how '{phrase}' operates within your project?"
    elif level == "strict":
        question = f"Your report states '{phrase}'. What specific quantitative evidence and trade-offs support this choice?"
    else:
        question = f"Regarding your work in {title}, what was the primary rationale behind '{phrase}'?"

    return json.dumps({
        "question": question,
        "section_id": section_id,
        "section_title": title,
        "evidence": phrase
    })
