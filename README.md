# VIVORA

**A voice-based viva practice partner that questions you on your own project.**

You know your project. But when the examiner is sitting in front of you, the words disappear.
VIVORA is a private place to practise that exact moment: upload your project report, and an AI examiner
speaks questions out loud, listens to your spoken answers, and pushes back with follow-ups, just like a real viva.

> Built as a Learning Block 1 mini project (GenAI-based web application).

---

## Why this exists

- Most viva prep is a written question bank. A real viva is **spoken**, **live**, and full of **follow-ups**.
- Many students know the answer but freeze, because of nervousness, fear of being judged, or limited speaking practice.
- Practising with friends is awkward, and practising alone doesn't give you pushback.

VIVORA doesn't claim to cure anxiety. It gives you a low-pressure place to repeat the situation until it feels less scary.

## What it does

| Feature | Description |
|---|---|
| Upload your work | PDF / DOCX report (or pasted text). Questions come only from *your* project. |
| Voice in, voice out | The examiner speaks; you answer with the mic. Transcript shown live. |
| Adaptive follow-ups | Vague answer? You get a sharper question on the weak part. |
| Three levels | Warm-up (friendly), Normal, Strict. Build up gradually. |
| Freeze rescue | If you go silent for a few seconds, a gentle nudge appears. It never gives the answer. |
| Session feedback | Filler words, speaking pace, missed key points, and your weakest topics. |

## How it works (short version)

```
Upload report -> extract text -> split into sections
        |
        v
Examiner picks a section -> LLM writes a question -> spoken aloud (TTS)
        |
        v
Student answers by voice (STT) -> transcript -> LLM judges + writes follow-up
        |
        v
Repeat -> end session -> feedback report
```

Full details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Tech stack

- **Frontend:** HTML / CSS / JavaScript (or React), Web Speech API for speech recognition and synthesis
- **Backend:** Python (FastAPI) or Node.js (Express). Holds the API key and talks to the LLM
- **LLM:** Any chat-capable LLM API, configured through environment variables
- **Parsing:** `pypdf` / `python-docx` (or equivalents)

> Final choices are recorded in [docs/SPECS.md](docs/SPECS.md). Update that file if the stack changes.

## Getting started

### Prerequisites
- Python 3.10+ (or Node 18+)
- A modern Chrome-based browser (best Web Speech API support)
- An API key for your chosen LLM provider

### Setup
```bash
git clone https://github.com/reshmabanu2823/VIVORA.git
cd VIVORA

# create your env file
cp .env.example .env
# open .env and add your API key

# backend (Python example)
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Then open the frontend (`frontend/index.html`, or the dev server URL) in Chrome and allow microphone access.

> The `backend/` and `frontend/` folders are added as development progresses. See [docs/ROADMAP.md](docs/ROADMAP.md) for status.

## Project structure

```
VIVORA/
├── README.md
├── CONTRIBUTING.md
├── .env.example
├── .gitignore
├── docs/
│   ├── SPECS.md           # requirements and scope
│   ├── ARCHITECTURE.md    # components and data flow
│   ├── API.md             # backend endpoints
│   ├── PROMPTS.md         # prompt templates
│   ├── EVALUATION.md      # how we test it
│   └── ROADMAP.md         # milestones and future scope
├── backend/               # (to be added)
└── frontend/              # (to be added)
```

## Known limitations

- Browser speech recognition can mis-hear Indian accents and technical terms.
- It cannot judge body language, eye contact, or confidence.
- Answer quality is judged by an LLM, not a human examiner.
- Needs an internet connection and an API key.

## Privacy

Uploaded reports are used only to generate questions in the current session. Do not upload anything confidential.
See the data-handling section in [docs/SPECS.md](docs/SPECS.md).

## Documentation

- [Specifications](docs/SPECS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [API reference](docs/API.md)
- [Prompt design](docs/PROMPTS.md)
- [Evaluation plan](docs/EVALUATION.md)
- [Roadmap](docs/ROADMAP.md)
- [Contributing](CONTRIBUTING.md)

## Team

- Team VIVORA: _add names here_
- Guide: _add mentor name here_
- Institute: _add college name here_

## License

Academic project. Add a license of your choice before making the repo public for reuse.
