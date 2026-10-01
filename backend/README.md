# VIVORA backend

FastAPI app. Endpoints are described in [../docs/API.md](../docs/API.md).

## Run it

```bash
cd backend
python -m venv venv && source venv/bin/activate     # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp ../.env.example ../.env                           # then edit ../.env
uvicorn main:app --reload
```

Open http://localhost:8000/docs for the interactive API page.

## LLM setup

Set these in `.env`:

| Provider | `LLM_PROVIDER` | Also set |
|----------|----------------|----------|
| Anthropic | `anthropic` | `LLM_API_KEY`, `LLM_MODEL` |
| OpenAI-compatible (OpenAI, Groq, etc.) | `openai` | `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` |
| No key (fake examiner for testing the flow) | `mock` | nothing |

The model name is not hard-coded. Check your provider's current model list and put one in `LLM_MODEL`.

## Files

| File | What it does |
|------|--------------|
| `main.py` | Routes and the session/turn logic |
| `parsing.py` | PDF/DOCX text extraction and section splitting |
| `prompts.py` | All prompt templates (keep in sync with `docs/PROMPTS.md`) |
| `llm.py` | One wrapper for the LLM provider, JSON parsing, retry |
| `metrics.py` | Filler-word count and words-per-minute |
| `sessions.py` | In-memory store with expiry and a per-session rate limit |
| `config.py` | Reads environment variables |
| `tests/` | Pytest tests, run with the mock LLM |

## Test

```bash
cd backend
python -m pytest -q
```

## Try the flow with curl

```bash
curl -s localhost:8000/upload -H "Content-Type: application/json" -d '{"text":"<paste 60+ words of your report>"}'
curl -s localhost:8000/session -H "Content-Type: application/json" -d '{"upload_id":"u_xxx","level":"normal","num_questions":3}'
curl -s localhost:8000/turn -H "Content-Type: application/json" -d '{"session_id":"s_xxx","question_id":1,"answer":"my answer","duration_sec":20}'
```

## Known limits

- State is in memory. Restarting the server clears sessions, and it will not work across multiple server workers.
- Scanned PDFs have no text layer and are rejected (paste the text instead).
- Tested only with the mock LLM so far. Check question quality with a real model and fix prompts in `prompts.py`.
