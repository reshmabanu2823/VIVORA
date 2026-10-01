# VIVORA: API Reference (draft)

Base URL (local): `http://localhost:8000`
All requests and responses are JSON unless noted. Errors use `{ "error": "message" }`.

## POST `/upload`
Upload a report. `multipart/form-data` with field `file` (PDF or DOCX), or JSON `{ "text": "..." }`.

**Response 200**
```json
{
  "upload_id": "u_123",
  "sections": [{ "id": 1, "title": "Introduction", "word_count": 410 }]
}
```

## POST `/session`
Start a session.

**Request**
```json
{ "upload_id": "u_123", "level": "warmup | normal | strict", "num_questions": 5 }
```
**Response 200**
```json
{ "session_id": "s_456", "question": { "id": 1, "text": "...", "section_id": 2 } }
```

## POST `/turn`
Submit an answer and get the next question.

**Request**
```json
{
  "session_id": "s_456",
  "question_id": 1,
  "answer": "transcript text",
  "duration_sec": 34,
  "first_speech_delay_sec": 3,
  "input_mode": "voice"
}
```
`input_mode` is `"voice"` (default) or `"typed"`. Typed answers are left out of pace (WPM) and
response-delay statistics, because typing time says nothing about speaking.

**Response 200**
```json
{
  "evaluation": {
    "verdict": "strong | partial | weak",
    "covered": ["..."],
    "missed": ["..."]
  },
  "next": {
    "type": "followup | new_topic | end",
    "question": { "id": 2, "text": "...", "section_id": 2 }
  }
}
```
When `next.type` is `end`, call `/feedback`.

## POST `/nudge`
Get a gentle nudge for a silent student.

**Request** `{ "session_id": "s_456", "question_id": 1, "nudge_number": 1 }`
**Response 200** `{ "text": "Start with what this module does." }`

## POST `/feedback`
**Request** `{ "session_id": "s_456" }`

**Response 200**
```json
{
  "summary": { "questions": 5, "avg_wpm": 128, "filler_count": 14 },
  "per_question": [
    { "question": "...", "verdict": "partial", "covered": ["..."], "missed": ["..."] }
  ],
  "weak_topics": ["...", "...", "..."],
  "suggestions": ["...", "..."]
}
```

## GET `/health`
Returns `{ "status": "ok" }`.

## Error codes

| Code | Meaning |
|------|---------|
| 400 | Bad input (missing field, unsupported file) |
| 404 | Unknown session or upload |
| 413 | File too large |
| 429 | Too many requests |
| 502 | LLM provider failed |
