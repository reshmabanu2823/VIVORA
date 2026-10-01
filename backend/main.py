"""VIVORA backend. Run:  uvicorn main:app --reload"""
import logging
import time
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

import config
import llm
import metrics
import parsing
import prompts
from sessions import store

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("vivora")

app = FastAPI(title="VIVORA", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=[config.FRONTEND_ORIGIN], allow_methods=["*"], allow_headers=["*"])

Level = Literal["warmup", "normal", "strict"]
FALLBACK_NUDGES = ["Start with what this part of the project does.",
                   "Take your time. Begin with the problem it solves."]
DISCLAIMER = "Practice feedback only. It is not an official grade."


# ---------- request models ----------
class SessionIn(BaseModel):
    upload_id: str
    level: Level = "normal"
    num_questions: int = Field(default=config.NUM_QUESTIONS_DEFAULT, ge=1, le=15)


class TurnIn(BaseModel):
    session_id: str
    question_id: int
    answer: str = Field(max_length=6000)
    duration_sec: float = Field(default=0, ge=0, le=900)
    first_speech_delay_sec: float | None = Field(default=None, ge=0, le=900)
    input_mode: Literal["voice", "typed"] = "voice"   # typed answers are excluded from pace and delay stats


class NudgeIn(BaseModel):
    session_id: str
    question_id: int
    nudge_number: int = Field(default=1, ge=1)


class FeedbackIn(BaseModel):
    session_id: str


# ---------- helpers ----------
def _session_or_404(sid: str) -> dict:
    s = store.get_session(sid)
    if not s:
        raise HTTPException(404, "Unknown or expired session")
    return s


def _section(s: dict, section_id: int) -> dict:
    return next(x for x in s["sections"] if x["id"] == section_id)


def _pick_section(s: dict) -> dict:
    """Least-asked section first; sections answered weakly come earlier on ties; avoid repeating the current one."""
    asked = {x["id"]: 0 for x in s["sections"]}
    for sid in s["asked_sections"]:
        asked[sid] = asked.get(sid, 0) + 1
    weak = {t["section_id"] for t in s["turns"] if t["verdict"] in ("weak", "partial")}
    current = s["current"]["section_id"] if s.get("current") else None
    pool = [x for x in s["sections"] if x["id"] != current] or s["sections"]
    return min(pool, key=lambda x: (asked[x["id"]], 0 if x["id"] in weak else 1, x["id"]))


async def _new_question(s: dict, section: dict) -> dict:
    text = await llm.complete(prompts.system_prompt(s["level"]),
                              prompts.first_question_prompt(section["title"], section["text"], s["all_questions"]))
    q = {"id": s["next_qid"], "text": text.strip().strip('"'), "section_id": section["id"]}
    s["next_qid"] += 1
    s["asked_sections"].append(section["id"])
    s["all_questions"].append(q["text"])
    return q


def _clean_eval(raw: dict | None) -> dict:
    raw = raw or {}
    verdict = raw.get("verdict") if raw.get("verdict") in ("strong", "partial", "weak") else "partial"
    as_list = lambda v: [str(x) for x in v][:6] if isinstance(v, list) else []
    return {"verdict": verdict, "covered": as_list(raw.get("covered")), "missed": as_list(raw.get("missed")),
            "next_type": raw.get("next_type") if raw.get("next_type") in ("followup", "new_topic") else "new_topic",
            "next_question": str(raw.get("next_question") or "").strip()}


def _llm_error(e: Exception) -> HTTPException:
    log.error("LLM failure: %s", e)
    return HTTPException(502, "The examiner is unavailable right now. Please try again.")


# ---------- routes ----------
@app.get("/health")
def health():
    return {"status": "ok", "llm_provider": config.LLM_PROVIDER}


@app.post("/upload")
async def upload(request: Request):
    """Accepts multipart (field 'file' = .pdf/.docx) or JSON {"text": "..."} or form field 'text'."""
    ctype = request.headers.get("content-type", "")
    try:
        if "application/json" in ctype:
            body = await request.json()
            text = (body.get("text") or "") if isinstance(body, dict) else ""
        else:
            form = await request.form()
            f = form.get("file")
            if f is not None and hasattr(f, "read"):
                data = await f.read(config.MAX_UPLOAD_MB * 1024 * 1024 + 1)
                if len(data) > config.MAX_UPLOAD_MB * 1024 * 1024:
                    raise HTTPException(413, f"File too large (max {config.MAX_UPLOAD_MB} MB)")
                text = parsing.extract_text(f.filename or "", data)
            else:
                text = str(form.get("text") or "")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except HTTPException:
        raise
    except Exception as e:
        log.warning("Upload parse failed: %s", e)
        raise HTTPException(400, "Could not read that file. Try pasting the text instead.")

    if len(text.split()) < 60:
        raise HTTPException(400, "Not enough text to ask questions from (need at least about 60 words).")
    sections = parsing.split_sections(text)
    if not sections:
        raise HTTPException(400, "Could not find any content in that report.")
    uid = store.add_upload(sections)
    return {"upload_id": uid,
            "sections": [{"id": s["id"], "title": s["title"], "word_count": s["word_count"]} for s in sections]}


@app.post("/session")
async def create_session(body: SessionIn):
    up = store.get_upload(body.upload_id)
    if not up:
        raise HTTPException(404, "Unknown or expired upload")
    sections = parsing.eligible_sections(up["sections"])
    s = {"sections": sections, "level": body.level, "num_questions": body.num_questions, "turns": [],
         "asked_sections": [], "all_questions": [], "next_qid": 1, "topic_followups": 0, "current": None,
         "finished": False, "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "nudges": {}, "feedback": None}
    try:
        q = await _new_question(s, _pick_section(s))
    except llm.LLMError as e:
        raise _llm_error(e)
    s["current"] = q
    sid = store.add_session(s)
    return {"session_id": sid, "question": q, "silence_nudge_seconds": config.SILENCE_NUDGE_SECONDS}


@app.post("/turn")
async def turn(body: TurnIn):
    s = _session_or_404(body.session_id)
    if s["finished"] or not s["current"]:
        raise HTTPException(400, "This session has ended. Request /feedback.")
    if body.question_id != s["current"]["id"]:
        raise HTTPException(400, "question_id does not match the current question")
    if not store.rate_ok(body.session_id):
        raise HTTPException(429, "Too many requests. Slow down a little.")

    answer = body.answer.strip() or "(no answer given)"
    cur = s["current"]
    section = _section(s, cur["section_id"])
    max_f = prompts.MAX_FOLLOWUPS[s["level"]]
    try:
        raw = await llm.complete_json(
            prompts.system_prompt(s["level"]),
            prompts.evaluation_prompt(section["title"], section["text"], s["turns"][-3:], cur["text"], answer,
                                      s["topic_followups"], max_f))
    except llm.LLMError as e:
        raise _llm_error(e)
    ev = _clean_eval(raw)

    voice = body.input_mode == "voice"
    wpm = metrics.words_per_minute(answer, body.duration_sec) if voice else None
    s["turns"].append({"question_id": cur["id"], "question": cur["text"], "section_id": section["id"],
                       "section_title": section["title"], "answer": answer, "duration_sec": body.duration_sec,
                       "first_speech_delay_sec": body.first_speech_delay_sec if voice else None,
                       "input_mode": body.input_mode, "wpm": wpm,
                       "fillers": metrics.count_fillers(answer), **{k: ev[k] for k in ("verdict", "covered", "missed")}})

    evaluation = {k: ev[k] for k in ("verdict", "covered", "missed")}
    if len(s["turns"]) >= s["num_questions"]:
        s["finished"], s["current"] = True, None
        return {"evaluation": evaluation, "next": {"type": "end", "question": None}}

    want_follow = (ev["next_type"] == "followup" and ev["verdict"] != "strong" and bool(ev["next_question"])
                   and s["topic_followups"] < max_f)
    try:
        if want_follow:
            s["topic_followups"] += 1
            q = {"id": s["next_qid"], "text": ev["next_question"], "section_id": section["id"]}
            s["next_qid"] += 1
            s["all_questions"].append(q["text"])
            kind = "followup"
        else:
            s["topic_followups"] = 0
            q = await _new_question(s, _pick_section(s))
            kind = "new_topic"
    except llm.LLMError as e:
        s["turns"].pop()  # let the client retry the same answer
        raise _llm_error(e)
    s["current"] = q
    return {"evaluation": evaluation, "next": {"type": kind, "question": q}}


@app.post("/nudge")
async def nudge(body: NudgeIn):
    s = _session_or_404(body.session_id)
    cur = s["current"]
    if not cur or cur["id"] != body.question_id:
        raise HTTPException(400, "question_id does not match the current question")
    used = s["nudges"].get(cur["id"], 0)
    if used >= config.MAX_NUDGES_PER_QUESTION or body.nudge_number > config.MAX_NUDGES_PER_QUESTION:
        return {"text": "No problem. Want me to rephrase the question, or skip it?", "offer_skip": True}
    s["nudges"][cur["id"]] = used + 1
    section = _section(s, cur["section_id"])
    try:
        text = await llm.complete(prompts.system_prompt(s["level"]),
                                  prompts.nudge_prompt(cur["text"], section["text"], body.nudge_number))
    except llm.LLMError:
        text = FALLBACK_NUDGES[min(used, len(FALLBACK_NUDGES) - 1)]
    return {"text": text.strip().strip('"'), "offer_skip": False}


@app.post("/feedback")
async def feedback(body: FeedbackIn):
    s = _session_or_404(body.session_id)
    if not s["turns"]:
        raise HTTPException(400, "Answer at least one question first.")
    if s["feedback"]:
        return s["feedback"]

    turns = s["turns"]
    total_fillers = sum(t["fillers"]["total"] for t in turns)
    # Pace and delay only make sense for spoken answers; typed answers are left out.
    spoken = [t for t in turns if t.get("input_mode") == "voice" and t["duration_sec"] > 0]
    spoken_sec = sum(t["duration_sec"] for t in spoken)
    spoken_words = sum(len(t["answer"].split()) for t in spoken)
    spoken_fillers = sum(t["fillers"]["total"] for t in spoken)
    avg_wpm = round(spoken_words / (spoken_sec / 60), 1) if spoken_sec > 0 else None
    delays = [t["first_speech_delay_sec"] for t in spoken if t["first_speech_delay_sec"] is not None]

    transcript = "\n\n".join(
        f"[{t['section_title']}] Q: {t['question']}\nA: {t['answer']}\nCovered: {t['covered']}\nMissed: {t['missed']}"
        for t in turns)
    summary_ai = None
    try:
        summary_ai = await llm.complete_json(prompts.system_prompt(s["level"]),
                                             prompts.feedback_prompt(s["level"], transcript))
    except llm.LLMError as e:
        log.warning("Feedback LLM failed, using fallback: %s", e)
    summary_ai = summary_ai or {}
    weak_topics = [str(x) for x in summary_ai.get("weak_topics", [])][:3] if isinstance(summary_ai.get("weak_topics"), list) else []
    if not weak_topics:  # fallback: sections with the weakest verdicts
        weak_topics = list(dict.fromkeys(t["section_title"] for t in turns if t["verdict"] != "strong"))[:3]
    suggestions = [str(x) for x in summary_ai.get("suggestions", [])][:3] if isinstance(summary_ai.get("suggestions"), list) else []

    report = {
        "summary": {"questions": len(turns), "avg_wpm": avg_wpm, "pace_note": metrics.pace_note(avg_wpm),
                    "filler_count": total_fillers, "spoken_answers": len(spoken),
                    "fillers_per_minute": round(spoken_fillers / (spoken_sec / 60), 1) if spoken_sec > 0 else None,
                    "avg_first_speech_delay_sec": round(sum(delays) / len(delays), 1) if delays else None,
                    "level": s["level"]},
        "per_question": [{"question": t["question"], "section": t["section_title"], "verdict": t["verdict"],
                          "covered": t["covered"], "missed": t["missed"], "wpm": t["wpm"],
                          "fillers": t["fillers"]["by_word"]} for t in turns],
        "weak_topics": weak_topics,
        "suggestions": suggestions,
        "disclaimer": DISCLAIMER,
    }
    s["feedback"] = report
    return report


@app.get("/session/{session_id}/transcript", response_class=PlainTextResponse)
def transcript(session_id: str):
    s = _session_or_404(session_id)
    lines = [f"# VIVORA practice session ({s['level']})", f"Started: {s['started_at']}", ""]
    for i, t in enumerate(s["turns"], 1):
        lines += [f"## Q{i} [{t['section_title']}]", f"**Examiner:** {t['question']}", f"**You:** {t['answer']}",
                  f"*Verdict: {t['verdict']}*", ""]
    return "\n".join(lines)
