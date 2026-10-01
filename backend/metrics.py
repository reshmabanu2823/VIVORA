"""Speech metrics are counted in code, not by the LLM (LLMs count badly)."""
import re

FILLERS = ["um", "umm", "uh", "uhh", "like", "basically", "actually", "you know", "i mean", "sort of", "kind of"]
_FILLER_RES = [(f, re.compile(rf"\b{re.escape(f)}\b", re.I)) for f in FILLERS]


def count_fillers(text: str) -> dict:
    counts = {f: len(rx.findall(text)) for f, rx in _FILLER_RES}
    counts = {k: v for k, v in counts.items() if v}
    return {"total": sum(counts.values()), "by_word": counts}


def words_per_minute(text: str, duration_sec: float) -> float | None:
    words = len(text.split())
    if duration_sec and duration_sec > 0 and words:
        return round(words / (duration_sec / 60), 1)
    return None


def pace_note(wpm: float | None) -> str:
    if wpm is None:
        return "Pace is measured only on spoken answers"
    if wpm < 100:
        return "a bit slow; fine if you are thinking, but try to keep momentum"
    if wpm <= 160:
        return "comfortable range"
    return "fast; slow down so the examiner can follow"
