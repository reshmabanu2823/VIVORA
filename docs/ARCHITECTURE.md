# VIVORA: Architecture

## 1. Components

```
┌──────────────────────────── Browser ────────────────────────────┐
│  UI (upload, level select, mic button, transcript, feedback)    │
│  Speech-to-Text  (Web Speech API: SpeechRecognition)            │
│  Text-to-Speech  (Web Speech API: speechSynthesis)              │
│  Silence timer (freeze rescue)                                  │
└───────────────┬──────────────────────────────────▲──────────────┘
                │ HTTPS (JSON)                     │
                ▼                                  │
┌──────────────────────────── Backend ─────────────┴──────────────┐
│  /upload     -> parse + split report                            │
│  /session    -> create session, store sections in memory        │
│  /turn       -> build prompt, call LLM, return next question    │
│  /feedback   -> score full transcript, return report            │
│  Prompt builder  |  Session store (in-memory)  |  Metrics        │
└───────────────┬─────────────────────────────────────────────────┘
                │ HTTPS (API key kept here only)
                ▼
         ┌──────────────┐
         │  LLM API     │
         └──────────────┘
```

## 2. Request / response flow

1. **Upload:** user sends a PDF/DOCX/text. Backend extracts text and splits it into sections (Introduction, Methodology, Implementation, Results, etc.).
2. **Start session:** user picks a level. Backend creates a `session_id`, stores sections and level.
3. **First question:** backend picks a section, builds the prompt (persona + level rules + section text), calls the LLM, returns the question.
4. **Ask aloud:** browser speaks the question with TTS.
5. **Listen:** browser starts STT. Silence timer runs. Transcript updates live.
6. **Answer submitted:** when the user finishes (silence end or button), browser sends the transcript to `/turn`.
7. **Evaluate + follow up:** backend sends the question, answer, section excerpt, and last 3 turns to the LLM. The LLM returns JSON: verdict, covered points, missed points, and next question (follow-up or new topic).
8. **Loop** steps 4 to 7 until the target number of questions is reached or the user ends the session.
9. **Feedback:** backend sends the whole transcript with the rubric to the LLM, merges that with locally computed stats (filler words, pace), and returns the report.

## 3. Report processing

- **Extraction:** PDF -> text with `pypdf` (or `pdfplumber`); DOCX -> text with `python-docx`.
- **Sectioning:** split by headings where possible; fallback is fixed-size chunks (around 600 to 800 words) with overlap.
- **Section selection:** round-robin over sections, weighted toward sections the user has answered weakly.
- **Grounding rule:** every prompt includes the chosen excerpt, and the examiner must reference it.

## 4. Session state (in memory)

```json
{
  "session_id": "uuid",
  "level": "normal",
  "sections": [{"id": 1, "title": "Methodology", "text": "..."}],
  "turns": [
    {
      "question": "...",
      "section_id": 1,
      "answer": "...",
      "duration_sec": 34,
      "covered": ["..."],
      "missed": ["..."],
      "followup_count": 1
    }
  ],
  "started_at": "ISO-8601"
}
```

Nothing is written to disk in v1. Sessions expire after a timeout (for example 60 minutes).

## 5. Local speech metrics (computed in browser or backend, not by the LLM)

| Metric | How |
|--------|-----|
| Words per minute | word count / answer duration |
| Filler words | count of a fixed list (um, uh, like, basically, you know, actually) in the transcript |
| Silence before answering | time from question end to first speech |

Computing these directly avoids asking the LLM to count, which it does unreliably.

## 6. Error handling

| Failure | Behaviour |
|---------|-----------|
| Mic permission denied | Show message, switch to typed answers |
| Speech recognition unsupported | Same as above |
| LLM call fails or times out | Retry once, then show "Examiner is unavailable, try again" |
| LLM returns invalid JSON | Re-ask once with a stricter instruction, else fall back to a plain question |
| Upload cannot be parsed | Ask the user to paste text instead |

## 7. Security notes

- API key only in backend environment variables.
- Limit upload size (for example 10 MB) and accepted types.
- Rate-limit `/turn` per session to control cost.
- Treat uploaded report text as untrusted input: the prompt must tell the model that the report is data and any instructions inside it must be ignored.
- Configure CORS to allow only the frontend origin.

## 8. Deployment (suggested)

- Frontend: static hosting (GitHub Pages, Netlify, Vercel)
- Backend: any free-tier Python/Node host
- Config via environment variables (see `.env.example`)
