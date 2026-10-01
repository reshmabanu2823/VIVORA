# VIVORA Frontend

An AI examiner that questions you on your own project report. Students upload their project report, and an AI examiner presents questions, evaluates typed answers, provides hints, and produces structured feedback.

## Requirements

- A modern browser (Chrome, Firefox, Safari, Edge)
- [VS Code Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) extension or any local HTTP server
- The VIVORA backend running at `http://localhost:8000`

## How to Run

### 1. Start the backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

The backend runs at `http://localhost:8000`. By default, it allows CORS from `http://localhost:5500` (Live Server's default port).

### 2. Open the frontend

1. Open the `VIVORA/` folder in VS Code.
2. Right-click `frontend/index.html` → **Open with Live Server**.
3. Live Server will open `http://localhost:5500/frontend/index.html`.

### 3. (Optional) Mock mode — no backend needed

Add `?mock=1` to the URL:

```
http://localhost:5500/frontend/index.html?mock=1
```

All API calls return realistic mock data. Use this to test or demo the UI without running the backend.

## Changing the API URL

Open `frontend/api.js` and change the first constant:

```js
const API_BASE = 'http://localhost:8000';
```

## File Structure

```
frontend/
├── index.html     — All three screens (Start, Session, Feedback)
├── styles.css     — Complete stylesheet (calm, warm editorial design)
├── app.js         — State machine + business logic (text-only)
├── api.js         — All fetch calls to the backend (+ mock mode)
├── ui.js          — DOM rendering helpers
└── README.md      — Documentation & guide
```

## State Machine

`app.js` manages state transitions across the session lifecycle:

| State | Description |
|---|---|
| `start` | Upload / configuration screen |
| `uploading` | File or text being parsed |
| `ready` | Upload succeeded; configure examiner level & questions |
| `asking` | Question presented; waiting for student's typed answer |
| `thinking` | `POST /turn` in flight ("Examiner is thinking...") |
| `feedback` | Practice session complete; feedback report displayed |
| `error` | Error state (network, timeout, expired session) |

## Interaction & Keyboard Shortcuts

- **Submit Answer**: Click "Submit answer" or press `Ctrl + Enter` (or `Cmd + Enter` on macOS) inside the answer textarea.
- **Hints**: Click "Give me a hint" to receive context-sensitive assistance via `POST /nudge`. After two hints, the button offers to skip the question.
- **Skip**: Click "Skip question" to move to the next question with `(skipped)`.

## Screenshot Checklist (for project report)

Take screenshots of the following for your report:

- [ ] **Start screen — empty state**: headline ("An AI examiner that questions you on your own project report"), upload area, level cards, "Start practice" button disabled
- [ ] **Start screen — document loaded**: sections list shown with word counts, "Start practice" button enabled
- [ ] **Start screen — paste text tab**: textarea with word count validation
- [ ] **Session screen — question prompt**: examiner status, serif question text, answer textarea with Ctrl+Enter hint
- [ ] **Session screen — hint active**: hint card displayed with advice from examiner
- [ ] **Session screen — thinking state**: "Examiner is thinking..." status indicator while evaluating
- [ ] **Session screen — evaluation chip**: verdict tag ("Solid answer", "Partly there", "Needs more detail") and missed points
- [ ] **Session screen — question history**: collapsible previous questions list expanded
- [ ] **Feedback screen — summary**: questions answered card
- [ ] **Feedback screen — question breakdown**: accordion items showing questions, verdicts, covered points, and missed points
- [ ] **Feedback screen — weak topics & suggestions**: weakest topics list and suggestions for improvement
- [ ] **Mock mode**: full application running via `?mock=1`
