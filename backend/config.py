"""All settings come from environment variables (see ../.env.example)."""
import os
from dotenv import load_dotenv

# load ../.env if present, then backend/.env
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
load_dotenv()


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


# LLM_PROVIDER: "anthropic" | "openai" (any OpenAI-compatible API) | "mock" (no key needed, for testing)
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "").lower() or ("mock" if not os.getenv("LLM_API_KEY") else "anthropic")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")  # only used by "openai" provider
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.4"))
LLM_TIMEOUT_SEC = _int("LLM_TIMEOUT_SEC", 30)

PORT = _int("PORT", 8000)
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5500")
MAX_UPLOAD_MB = _int("MAX_UPLOAD_MB", 10)
SESSION_TIMEOUT_MIN = _int("SESSION_TIMEOUT_MIN", 60)
NUM_QUESTIONS_DEFAULT = _int("NUM_QUESTIONS_DEFAULT", 5)
SILENCE_NUDGE_SECONDS = _int("SILENCE_NUDGE_SECONDS", 8)
MAX_NUDGES_PER_QUESTION = _int("MAX_NUDGES_PER_QUESTION", 2)
TURNS_PER_MINUTE_LIMIT = _int("TURNS_PER_MINUTE_LIMIT", 12)
