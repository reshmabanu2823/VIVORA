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
    """Deterministic fake model so the whole app can be run and tested without an API key."""
    if '"weak_topics"' in user:
        return json.dumps({"weak_topics": ["Methodology"], "suggestions": ["Explain why you chose each technique.",
                                                                           "Quote one number from your results."]})
    if '"verdict"' in user:
        words = user.split("Student's spoken answer", 1)[-1].split("\n", 1)[0].split()
        verdict = "strong" if len(words) > 40 else "partial" if len(words) > 12 else "weak"
        return json.dumps({"verdict": verdict, "covered": ["main idea"], "missed": ["reason for the choice"],
                           "next_type": "followup" if verdict != "strong" else "new_topic",
                           "next_question": "You mentioned that, but why did you choose that approach over the alternatives?"})
    if "nudge number" in user:
        return "Start with what this part of the project does."
    title = user.split("Section title:", 1)[-1].split("\n", 1)[0].strip()
    n = user.count("\n- ")
    return f"In the {title} section, can you explain the main decision you made? (mock question {n + 1})"
