# VIVORA Frontend

A voice-based viva practice app. Students upload their project report, and an AI examiner asks questions aloud, listens to spoken answers, and gives feedback.

## Requirements

- A modern browser (**Chrome is strongly recommended** for voice support)
- [VS Code Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) extension
- The VIVORA backend running at `http://localhost:8000`

## How to Run

### 1. Start the backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

The backend must be running at `http://localhost:8000`. By default, it only allows CORS from `http://localhost:5500` (Live Server's default port).

### 2. Open the frontend with Live Server

1. Open the `VIVORA/` folder in VS Code.
2. Right-click `frontend/index.html` → **Open with Live Server**.
3. Live Server will open `http://localhost:5500/frontend/index.html`.

> **Important:** Live Server must use port **5500**. If it uses a different port (e.g. 5501), update `FRONTEND_ORIGIN` in your backend `.env` file to match.

### 3. (Optional) Mock mode — no backend needed

Add `?mock=1` to the URL:

```
http://localhost:5500/frontend/index.html?mock=1
```

All API calls return realistic fake data. Use this to develop or demo the UI without the backend.

## Changing the API URL

Open `frontend/api.js` and change the first constant:

```js
const API_BASE = 'http://localhost:8000';
```

## File Structure

```
frontend/
├── index.html     — All three screens (Start, Session, Feedback)
├── styles.css     — Complete stylesheet (warm editorial design)
├── app.js         — State machine + business logic
├── api.js         — All fetch calls to the backend (+ mock mode)
├── speech.js      — TTS + STT Web Speech API wrapper
├── ui.js          — DOM rendering helpers (no business logic)
└── README.md      — This file
```

## State Machine

`app.js` manages a single `state.current` variable with these states:

| State | Description |
|---|---|
| `start` | Upload / configuration screen |
| `uploading` | File or text being sent to `/upload` |
| `ready` | Upload succeeded; student configures session |
| `asking` | TTS is speaking the examiner's question |
| `listening` | Mic on; student is answering |
| `thinking` | `POST /turn` is in flight |
| `feedback` | Session complete; feedback screen |
| `error` | Unrecoverable error |

## Voice Behaviour

- **TTS** uses `speechSynthesis` with `rate = 0.95` and `lang = 'en-IN'`.
- **STT** uses `SpeechRecognition` with `continuous = true` and `interimResults = true`. Chrome stops recognition after a silence — `speech.js` auto-restarts it.
- Listening never starts while TTS is speaking (prevents echo).
- Auto-submit fires after **2.5 seconds of silence** following speech. Change `AUTO_SUBMIT_MS` in `app.js`.
- Silence nudges fire after `silence_nudge_seconds` (returned by `/session`). The backend allows 2 nudges; the third triggers a "Rephrase / Skip" offer.
- If voice is unavailable or mic is denied, the app automatically switches to typed answers.

## Browser Compatibility

| Feature | Chrome | Safari | Firefox |
|---|---|---|---|
| TTS | ✓ | ✓ | ✓ |
| Speech Recognition | ✓ | ✓ (limited) | ✗ |
| Typed fallback | ✓ | ✓ | ✓ |

Chrome is recommended for the full voice experience.

## Screenshot Checklist (for project report)

Take screenshots of the following for your report:

- [ ] **Start screen — empty state**: headline, upload area (file tab active), level cards, "Start practice" button disabled
- [ ] **Start screen — file uploaded**: sections list shown, "Start practice" button enabled
- [ ] **Start screen — paste tab**: textarea visible with word count hint
- [ ] **Mic check overlay**: level meter showing audio activity
- [ ] **Session screen — Speaking state**: presence circle pulsing, question text displayed, "Examiner is speaking" label
- [ ] **Session screen — Listening state**: presence circle in breathing animation, "Your turn to speak" label, live transcript updating
- [ ] **Session screen — Thinking state**: rotating arc, "Thinking..." label
- [ ] **Session screen — Evaluation chip**: verdict tag ("Solid answer", "Partly there", "Needs more detail"), missed points shown
- [ ] **Session screen — Nudge**: nudge text visible, optional Rephrase / Skip buttons
- [ ] **Session screen — Typing fallback**: typing panel shown, voice controls hidden, browser notice
- [ ] **Session screen — History panel**: previous Q&A pairs expanded
- [ ] **Feedback screen — Summary cards**: questions, pace, fillers, delay
- [ ] **Feedback screen — Per-question accordion**: one item expanded showing covered/missed points
- [ ] **Feedback screen — Weak topics and suggestions**: sections visible
- [ ] **Mock mode**: URL with `?mock=1`, all screens functional without backend

## Adjustable Constants

| Constant | File | Default | Description |
|---|---|---|---|
| `API_BASE` | `api.js` | `http://localhost:8000` | Backend URL |
| `AUTO_SUBMIT_MS` | `app.js` | `2500` | Silence → auto-submit delay (ms) |
| `TTS_RATE` | `speech.js` | `0.95` | Examiner speech rate (0.1–2) |
| `TTS_LANG` | `speech.js` | `en-IN` | TTS language |
| `STT_LANG` | `speech.js` | `en-IN` | Recognition language |
