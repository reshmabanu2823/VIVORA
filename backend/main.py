"""VIVORA backend. Run:  uvicorn main:app --reload"""
import logging
import re
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

Level = Literal["warmup", "normal", "strict", "defense"]
FALLBACK_NUDGES = ["Start with what this part of the project does.",
                   "Take your time. Begin with the problem it solves."]
DISCLAIMER = "Practice feedback only. It is not an official grade."

CORE_SECTION_KEYWORDS = [
    "methodology", "proposed system", "system architecture", "architecture",
    "implementation", "design", "model", "algorithm", "results", "results and discussion",
    "evaluation", "analysis", "experiments", "experimental", "system design", "approach",
    "components", "protocol", "scheme", "verification", "benchmark", "framework", "pipeline"
]

INTRO_SECTION_KEYWORDS = [
    "abstract", "overview", "introduction", "background", "literature review",
    "problem statement", "summary", "executive summary", "preface"
]


# ---------- request models ----------
class SessionIn(BaseModel):
    upload_id: str
    code_upload_id: str | None = None
    level: Level = "normal"
    num_questions: int = Field(default=config.NUM_QUESTIONS_DEFAULT, ge=1, le=15)


class TurnIn(BaseModel):
    session_id: str
    question_id: int
    answer: str = Field(default="", max_length=6000)
    duration_sec: float = Field(default=0, ge=0, le=900)
    first_speech_delay_sec: float | None = Field(default=None, ge=0, le=900)
    input_mode: Literal["voice", "typed"] = "voice"
    status: Literal["answered", "skipped", "unanswered"] = "answered"


class SkipIn(BaseModel):
    session_id: str
    question_id: int


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
    all_secs = s["sections"] + s.get("code_sections", [])
    return next((x for x in all_secs if x["id"] == section_id), s["sections"][0])


def _score_section_meaningfulness(sec: dict) -> float:
    """Score how substantive and technical a section is for initiating questions."""
    title_lower = sec["title"].lower()
    score = 0.0

    for kw in CORE_SECTION_KEYWORDS:
        if kw in title_lower:
            score += 15.0
            break

    for kw in INTRO_SECTION_KEYWORDS:
        if kw in title_lower:
            score -= 5.0
            break

    wc = sec.get("word_count", 0)
    if wc >= 80:
        score += min(wc / 50.0, 10.0)
    else:
        score -= 5.0

    return score


def _pick_opening_section(sections: list[dict]) -> dict:
    """Choose a meaningful, technical section from the uploaded report rather than a generic intro."""
    if not sections:
        raise HTTPException(400, "No valid sections found in report.")
    if len(sections) == 1:
        return sections[0]

    scored = sorted(sections, key=_score_section_meaningfulness, reverse=True)
    return scored[0]


def _pick_next_section(s: dict) -> tuple[dict, str | None]:
    """Select the next topic section balancing REPORT and CODE sources, prioritizing cross-verification mismatches."""
    # 1. Prioritize cross-verification mismatches
    if s.get("pending_mismatches"):
        mismatch = s["pending_mismatches"].pop(0)
        tech = mismatch.get("tech", "")
        # Find a report section containing this tech mention
        matching_sec = next((sec for sec in s["sections"] if tech.lower() in sec["text"].lower()), s["sections"][0])
        return matching_sec, tech

    # 2. Balance between report sections and code sections
    report_pool = s["sections"]
    code_pool = s.get("code_sections", [])

    if s.get("has_code") and code_pool:
        asked_report = sum(1 for sid in s.get("asked_sections", []) if any(x["id"] == sid for x in report_pool))
        asked_code = sum(1 for sid in s.get("asked_sections", []) if any(x["id"] == sid for x in code_pool))
        # Alternate or choose code if report has been asked more
        pool = code_pool if (asked_code < asked_report or asked_report >= len(report_pool)) else report_pool
    else:
        pool = report_pool

    current_id = s["current"]["section_id"] if s.get("current") else None
    asked_counts = {x["id"]: 0 for x in pool}
    for sid in s.get("asked_sections", []):
        asked_counts[sid] = asked_counts.get(sid, 0) + 1

    weak_sections = {t["section_id"] for t in s.get("turns", []) if t.get("status") == "answered" and t.get("verdict") in ("weak", "partial")}
    eligible_pool = [x for x in pool if x["id"] != current_id] or pool

    def _rank_key(sec: dict):
        asked = asked_counts.get(sec["id"], 0)
        is_weak = 0 if sec["id"] in weak_sections else 1
        substance = -_score_section_meaningfulness(sec) if sec.get("source") == "REPORT" else -sec.get("word_count", 0)
        return (asked, is_weak, substance, sec["id"])

    return min(eligible_pool, key=_rank_key), None


def _validate_question(q_data: dict, section: dict, mismatch_claim: str | None = None) -> tuple[bool, str]:
    """Strictly validate structured question format and grounding evidence."""
    if not isinstance(q_data, dict):
        return False, "Response is not a valid JSON dictionary."

    question = str(q_data.get("question") or "").strip()
    evidence = str(q_data.get("evidence") or "").strip()

    if not question:
        return False, "Question is empty."
    if not evidence:
        return False, "Evidence is empty."

    if mismatch_claim and mismatch_claim.lower() in evidence.lower():
        return True, ""

    norm_excerpt = " ".join(section["text"].lower().split())
    norm_evidence = " ".join(evidence.lower().split())

    if norm_evidence not in norm_excerpt:
        if mismatch_claim and mismatch_claim.lower() in question.lower():
            return True, ""
        return False, f"Evidence '{evidence}' is not an exact substring in the selected excerpt."

    if len(evidence) < 3:
        return False, f"Evidence '{evidence}' is too short to prove document grounding."

    generic_patterns = [
        r"^what is your project\??$",
        r"^can you explain your project\??$",
        r"^explain your project\??$",
        r"^tell me about your project\??$",
        r"^can you explain the main decision you made\??$",
        r"^what did you do in this project\??$",
    ]
    for pat in generic_patterns:
        if re.match(pat, question.strip(), re.I):
            return False, f"Question '{question}' is too generic and not grounded in the specific excerpt."

    return True, ""


async def _generate_question(s: dict, section: dict, is_followup: bool = False,
                             history: list[dict] | None = None,
                             missed_points: list[str] | None = None,
                             unsupported_claim: str | None = None,
                             mismatch_claim: str | None = None) -> dict:
    """Generate a question requiring structured JSON with evidence, validated against the excerpt."""
    source = section.get("source", "REPORT")
    level = s["level"]
    sys_p = prompts.system_prompt(level)
    prompt = prompts.question_prompt(
        section_title=section["title"],
        section_id=section["id"],
        section_text=section["text"],
        asked=s["all_questions"],
        is_followup=is_followup,
        history=history,
        missed_points=missed_points,
        level=level,
        unsupported_claim=unsupported_claim,
        source=source,
        mismatch_claim=mismatch_claim
    )

    last_err = ""
    for attempt in range(3):
        cur_prompt = prompt if attempt == 0 else (
            f"{prompt}\n\nIMPORTANT: Your previous output was rejected: {last_err}. "
            "You MUST return valid JSON with an exact verbatim substring from the excerpt as 'evidence'."
        )

        q_data = await llm.complete_json(sys_p, cur_prompt)
        valid, last_err = _validate_question(q_data, section, mismatch_claim=mismatch_claim)
        if valid:
            q = {
                "id": s["next_qid"],
                "text": q_data["question"].strip(),
                "section_id": section["id"],
                "section_title": section["title"],
                "evidence": q_data["evidence"].strip(),
                "source": q_data.get("source", source),
                "status": "unanswered",
            }
            s["next_qid"] += 1
            s["asked_sections"].append(section["id"])
            s["all_questions"].append(q["text"])

            # Server-side debug logging per Requirement 10
            first_part = section["text"][:80].replace("\n", " ").strip()
            last_part = section["text"][-80:].replace("\n", " ").strip()
            log.info(
                "[GROUNDING DEBUG] source=%s section_id=%s title='%s' excerpt_preview='%s...%s' question='%s' evidence='%s'",
                q["source"], section["id"], section["title"], first_part, last_part, q["text"], q["evidence"]
            )
            return q

        log.warning("Question rejected on attempt %d: %s", attempt + 1, last_err)

    raise llm.LLMError(f"Failed to generate a grounded question after 3 attempts: {last_err}")


def _clean_eval(raw: dict | None) -> dict:
    raw = raw or {}
    verdict = raw.get("verdict") if raw.get("verdict") in ("strong", "partial", "weak") else "partial"
    as_list = lambda v: [str(x) for x in v][:6] if isinstance(v, list) else []
    unsupported_claim = str(raw["unsupported_claim"]).strip() if raw.get("unsupported_claim") else None
    undefended_decision = str(raw["undefended_decision"]).strip() if raw.get("undefended_decision") else None
    return {
        "verdict": verdict,
        "covered": as_list(raw.get("covered")),
        "missed": as_list(raw.get("missed")),
        "unsupported_claim": unsupported_claim,
        "undefended_decision": undefended_decision,
        "next_type": raw.get("next_type") if raw.get("next_type") in ("followup", "new_topic") else "new_topic"
    }


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
    filename = "pasted_text"
    code_files = []
    try:
        if "application/json" in ctype:
            body = await request.json()
            text = (body.get("text") or "") if isinstance(body, dict) else ""
            if isinstance(body, dict) and body.get("code_text"):
                code_files = parsing.extract_code_files("pasted_code.py", body["code_text"].encode("utf-8"))
        else:
            form = await request.form()
            f = form.get("file")
            if f is not None and hasattr(f, "read"):
                filename = f.filename or "uploaded_file"
                data = await f.read(config.MAX_UPLOAD_MB * 1024 * 1024 + 1)
                if len(data) > config.MAX_UPLOAD_MB * 1024 * 1024:
                    raise HTTPException(413, f"File too large (max {config.MAX_UPLOAD_MB} MB)")
                text = parsing.extract_text(filename, data)
            else:
                text = str(form.get("text") or "")

            cf = form.get("code_file")
            if cf is not None and hasattr(cf, "read"):
                cdata = await cf.read(config.MAX_UPLOAD_MB * 1024 * 1024 + 1)
                code_files = parsing.extract_code_files(cf.filename or "code.zip", cdata)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except HTTPException:
        raise
    except Exception as e:
        log.warning("Upload parse failed: %s", e)
        raise HTTPException(400, "Could not read that report. The document format is unreadable or corrupted.")

    if len(text.split()) < 60:
        raise HTTPException(400, "Not enough text to ask questions from (need at least about 60 words).")
    sections = parsing.split_sections(text)
    if not sections:
        raise HTTPException(400, "Could not extract readable sections from that report.")

    code_sections = parsing.split_code_sections(code_files) if code_files else []
    uid = store.add_upload(sections, code_sections=code_sections, code_files=code_files)
    log.info("[UPLOAD DEBUG] filename='%s' extracted_chars=%d sections=%d code_files=%d",
             filename, len(text), len(sections), len(code_files))

    return {
        "upload_id": uid,
        "sections": [{"id": s["id"], "title": s["title"], "word_count": s["word_count"], "source": "REPORT"} for s in sections],
        "code_files": [{"path": f["path"], "lines": f["lines"]} for f in code_files] if code_files else []
    }


@app.post("/upload_code")
async def upload_code(request: Request):
    """Accepts multipart (field 'file' = .zip/.py/.js/etc.) or JSON {"text": "...", "filename": "..."} or form 'text'."""
    ctype = request.headers.get("content-type", "")
    filename = "pasted_code.py"
    try:
        if "application/json" in ctype:
            body = await request.json()
            text = (body.get("text") or body.get("code") or "") if isinstance(body, dict) else ""
            filename = (body.get("filename") or "source_code.py") if isinstance(body, dict) else "source_code.py"
            code_files = parsing.extract_code_files(filename, text.encode("utf-8"))
        else:
            form = await request.form()
            f = form.get("file") or form.get("code_file")
            if f is not None and hasattr(f, "read"):
                filename = f.filename or "uploaded_code.zip"
                data = await f.read(config.MAX_UPLOAD_MB * 1024 * 1024 + 1)
                if len(data) > config.MAX_UPLOAD_MB * 1024 * 1024:
                    raise HTTPException(413, f"Code file too large (max {config.MAX_UPLOAD_MB} MB)")
                code_files = parsing.extract_code_files(filename, data)
            else:
                text = str(form.get("text") or form.get("code") or "")
                code_files = parsing.extract_code_files("pasted_code.py", text.encode("utf-8"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except HTTPException:
        raise
    except Exception as e:
        log.warning("Code upload parse failed: %s", e)
        raise HTTPException(400, "Could not read that source code.")

    code_sections = parsing.split_code_sections(code_files)
    cuid = store.add_code_upload(code_sections, code_files)
    log.info("[CODE UPLOAD DEBUG] filename='%s' files=%d sections=%d", filename, len(code_files), len(code_sections))
    return {
        "code_upload_id": cuid,
        "total_files": len(code_files),
        "files": [{"path": f["path"], "lines": f["lines"], "size": f["size"]} for f in code_files],
        "sections": [{"id": s["id"], "title": s["title"], "word_count": s["word_count"], "source": "CODE"} for s in code_sections]
    }


@app.post("/session")
async def create_session(body: SessionIn):
    up = store.get_upload(body.upload_id)
    if not up:
        raise HTTPException(404, "Unknown or expired upload")
    sections = parsing.eligible_sections(up["sections"])
    if not sections:
        raise HTTPException(400, "Report has no eligible sections for viva questions.")

    code_sections = []
    code_files = []
    if body.code_upload_id:
        code_up = store.get_upload(body.code_upload_id)
        if code_up:
            code_sections = code_up.get("code_sections", [])
            code_files = code_up.get("code_files", [])
    elif up.get("code_sections"):
        code_sections = up.get("code_sections", [])
        code_files = up.get("code_files", [])

    max_rep_id = max((s["id"] for s in sections), default=0)
    adjusted_code_sections = []
    for i, cs in enumerate(code_sections, start=max_rep_id + 1):
        cs_copy = dict(cs)
        cs_copy["id"] = i
        cs_copy["source"] = "CODE"
        adjusted_code_sections.append(cs_copy)

    cross_verif = parsing.detect_cross_verification(sections, code_files) if code_files else None
    pending_mismatches = list(cross_verif.get("mismatches", [])) if cross_verif else []

    s = {
        "sections": sections,
        "code_sections": adjusted_code_sections,
        "code_files": code_files,
        "has_code": bool(code_files),
        "cross_verification": cross_verif,
        "pending_mismatches": pending_mismatches,
        "level": body.level,
        "num_questions": body.num_questions,
        "turns": [],
        "asked_sections": [],
        "all_questions": [],
        "next_qid": 1,
        "topic_followups": 0,
        "current": None,
        "finished": False,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "nudges": {},
        "feedback": None,
        "undefended_decisions": []
    }

    opening_sec = _pick_opening_section(sections)
    try:
        q = await _generate_question(s, opening_sec, is_followup=False)
    except llm.LLMError as e:
        raise _llm_error(e)

    s["current"] = q
    sid = store.add_session(s)
    return {"session_id": sid, "question": q, "silence_nudge_seconds": config.SILENCE_NUDGE_SECONDS}


async def _handle_turn(s: dict, question_id: int, answer: str, duration_sec: float,
                       first_speech_delay_sec: float | None, input_mode: str, status: str):
    if s["finished"] or not s["current"]:
        raise HTTPException(400, "This session has ended. Request /feedback.")
    if question_id != s["current"]["id"]:
        raise HTTPException(400, "question_id does not match the current question")
    if any(t["question_id"] == question_id for t in s["turns"]):
        raise HTTPException(400, "Turn already submitted for this question.")
    if s.get("processing"):
        raise HTTPException(409, "A turn is currently in progress for this session.")
    s["processing"] = True

    try:
        cur = s["current"]
        section = _section(s, cur["section_id"])
        source = cur.get("source", section.get("source", "REPORT"))
        is_skipped = (status == "skipped" or answer.strip() == "(skipped)")

        if is_skipped:
            cur["status"] = "skipped"
            s["turns"].append({
                "question_id": cur["id"],
                "question": cur["text"],
                "section_id": section["id"],
                "section_title": section["title"],
                "source": source,
                "answer": "[SKIPPED]",
                "status": "skipped",
                "duration_sec": 0,
                "first_speech_delay_sec": None,
                "input_mode": input_mode,
                "wpm": None,
                "fillers": {"total": 0, "by_word": {}},
                "verdict": None,
                "covered": [],
                "missed": [],
                "unsupported_claim": None,
                "undefended_decision": None
            })
            evaluation = {
                "verdict": None,
                "covered": [],
                "missed": [],
                "unsupported_claim": None,
                "undefended_decision": None,
                "source": source,
                "status": "skipped"
            }
            s["topic_followups"] = 0

            if len(s["turns"]) >= s["num_questions"]:
                s["finished"], s["current"] = True, None
                return {"evaluation": evaluation, "next": {"type": "end", "question": None}}

            next_sec, mismatch_claim = _pick_next_section(s)
            q = await _generate_question(s, next_sec, is_followup=False, mismatch_claim=mismatch_claim)
            s["current"] = q
            return {"evaluation": evaluation, "next": {"type": "new_topic", "question": q}}

        else:
            clean_answer = answer.strip() or "(no answer given)"
            max_f = prompts.MAX_FOLLOWUPS[s["level"]]

            try:
                raw = await llm.complete_json(
                    prompts.system_prompt(s["level"]),
                    prompts.evaluation_prompt(
                        section["title"], section["text"],
                        [t for t in s["turns"] if t.get("status") == "answered"][-3:],
                        cur["text"], clean_answer,
                        s["topic_followups"], max_f,
                        level=s["level"]
                    )
                )
            except llm.LLMError as e:
                raise _llm_error(e)
            ev = _clean_eval(raw)

            if ev.get("undefended_decision") and s["level"] == "defense":
                s.setdefault("undefended_decisions", []).append(ev["undefended_decision"])

            voice = input_mode == "voice"
            wpm = metrics.words_per_minute(clean_answer, duration_sec) if voice else None
            cur["status"] = "answered"
            s["turns"].append({
                "question_id": cur["id"],
                "question": cur["text"],
                "section_id": section["id"],
                "section_title": section["title"],
                "source": source,
                "answer": clean_answer,
                "status": "answered",
                "duration_sec": duration_sec,
                "first_speech_delay_sec": first_speech_delay_sec if voice else None,
                "input_mode": input_mode,
                "wpm": wpm,
                "fillers": metrics.count_fillers(clean_answer),
                "unsupported_claim": ev.get("unsupported_claim"),
                "undefended_decision": ev.get("undefended_decision"),
                **{k: ev[k] for k in ("verdict", "covered", "missed")}
            })

            evaluation = {k: ev[k] for k in ("verdict", "covered", "missed", "unsupported_claim", "undefended_decision")}
            evaluation["source"] = source
            evaluation["status"] = "answered"

            if len(s["turns"]) >= s["num_questions"]:
                s["finished"], s["current"] = True, None
                return {"evaluation": evaluation, "next": {"type": "end", "question": None}}

            want_follow = ((ev["next_type"] == "followup" or ev.get("unsupported_claim"))
                           and (ev["verdict"] != "strong" or ev.get("unsupported_claim"))
                           and s["topic_followups"] < max_f)
            try:
                if want_follow:
                    s["topic_followups"] += 1
                    q = await _generate_question(
                        s, section, is_followup=True,
                        history=[t for t in s["turns"] if t.get("status") == "answered"][-3:],
                        missed_points=ev["missed"],
                        unsupported_claim=ev.get("unsupported_claim")
                    )
                    kind = "followup"
                else:
                    s["topic_followups"] = 0
                    next_sec, mismatch_claim = _pick_next_section(s)
                    q = await _generate_question(s, next_sec, is_followup=False, mismatch_claim=mismatch_claim)
                    kind = "new_topic"
            except llm.LLMError as e:
                s["turns"].pop()  # allow retry
                raise _llm_error(e)

            s["current"] = q
            return {"evaluation": evaluation, "next": {"type": kind, "question": q}}

    finally:
        s["processing"] = False


@app.post("/turn")
async def turn(body: TurnIn):
    s = _session_or_404(body.session_id)
    if not store.rate_ok(body.session_id):
        raise HTTPException(429, "Too many requests. Slow down a little.")
    return await _handle_turn(
        s, body.question_id, body.answer, body.duration_sec,
        body.first_speech_delay_sec, body.input_mode, body.status
    )


@app.post("/skip")
async def skip(body: SkipIn):
    s = _session_or_404(body.session_id)
    if not store.rate_ok(body.session_id):
        raise HTTPException(429, "Too many requests. Slow down a little.")
    return await _handle_turn(
        s, body.question_id, "", 0, None, "typed", "skipped"
    )


@app.post("/nudge")
async def nudge(body: NudgeIn):
    s = _session_or_404(body.session_id)
    cur = s["current"]
    if not cur or cur["id"] != body.question_id:
        raise HTTPException(400, "question_id does not match the current question")
    used = s["nudges"].get(cur["id"], 0)
    if used >= config.MAX_NUDGES_PER_QUESTION or body.nudge_number > config.MAX_NUDGES_PER_QUESTION:
        return {"text": "No problem. You can skip this question if you would like.", "offer_skip": True}
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
    answered = [t for t in turns if t.get("status") == "answered"]
    skipped = [t for t in turns if t.get("status") == "skipped"]

    questions_asked = len(turns)
    questions_answered = len(answered)
    questions_skipped = len(skipped)

    total_fillers = sum(t["fillers"]["total"] for t in answered)
    spoken = [t for t in answered if t.get("input_mode") == "voice" and t["duration_sec"] > 0]
    spoken_sec = sum(t["duration_sec"] for t in spoken)
    spoken_words = sum(len(t["answer"].split()) for t in spoken)
    spoken_fillers = sum(t["fillers"]["total"] for t in spoken)
    avg_wpm = round(spoken_words / (spoken_sec / 60), 1) if spoken_sec > 0 else None
    delays = [t["first_speech_delay_sec"] for t in spoken if t["first_speech_delay_sec"] is not None]

    summary_ai = None
    if answered:
        transcript_for_ai = "\n\n".join(
            f"[{t['section_title']}] Q: {t['question']}\nA: {t['answer']}\nCovered: {t['covered']}\nMissed: {t['missed']}"
            + (f"\nUnsupported Claim: {t['unsupported_claim']}" if t.get("unsupported_claim") else "")
            + (f"\nUndefended Decision: {t['undefended_decision']}" if t.get("undefended_decision") else "")
            for t in answered
        )
        try:
            summary_ai = await llm.complete_json(
                prompts.system_prompt(s["level"]),
                prompts.feedback_prompt(s["level"], transcript_for_ai, s.get("undefended_decisions", []))
            )
        except llm.LLMError as e:
            log.warning("Feedback LLM failed, using fallback: %s", e)
    summary_ai = summary_ai or {}

    weak_topics = [str(x) for x in summary_ai.get("weak_topics", [])][:3] if isinstance(summary_ai.get("weak_topics"), list) else []
    if not weak_topics and answered:
        weak_topics = list(dict.fromkeys(t["section_title"] for t in answered if t.get("verdict") in ("weak", "partial")))[:3]

    suggestions = [str(x) for x in summary_ai.get("suggestions", [])][:3] if isinstance(summary_ai.get("suggestions"), list) else []

    defense_weak_points = None
    if s["level"] == "defense":
        raw_pts = summary_ai.get("project_defense_weak_points", [])
        if isinstance(raw_pts, list) and raw_pts:
            defense_weak_points = [str(x) for x in raw_pts][:4]
        else:
            candidates = []
            for d in s.get("undefended_decisions", []):
                if d and d not in candidates:
                    candidates.append(f"Undefended implementation choice: {d}")
            for t in answered:
                claim = t.get("unsupported_claim")
                if claim and claim not in candidates:
                    candidates.append(f"Unsubstantiated claim on {t['section_title']}: {claim}")
            defense_weak_points = candidates[:4]
            if not defense_weak_points:
                defense_weak_points = [
                    "Benchmark comparisons: Stated performance or efficiency claims without comparative baselines.",
                    "Implementation trade-offs: Did not fully defend architectural choices against alternatives."
                ]

    report = {
        "summary": {
            "questions": questions_answered,
            "questions_asked": questions_asked,
            "questions_answered": questions_answered,
            "questions_skipped": questions_skipped,
            "avg_wpm": avg_wpm,
            "pace_note": metrics.pace_note(avg_wpm),
            "filler_count": total_fillers,
            "spoken_answers": len(spoken),
            "fillers_per_minute": round(spoken_fillers / (spoken_sec / 60), 1) if spoken_sec > 0 else None,
            "avg_first_speech_delay_sec": round(sum(delays) / len(delays), 1) if delays else None,
            "level": s["level"],
            "started_at": s.get("started_at"),
        },
        "per_question": [
            {
                "question": t["question"],
                "section": t["section_title"],
                "source": t.get("source", "REPORT"),
                "status": t.get("status", "answered"),
                "answer": t.get("answer", ""),
                "verdict": t.get("verdict"),
                "covered": t.get("covered", []),
                "missed": t.get("missed", []),
                "unsupported_claim": t.get("unsupported_claim"),
                "undefended_decision": t.get("undefended_decision"),
                "wpm": t.get("wpm"),
                "fillers": t.get("fillers", {}).get("by_word", {})
            }
            for t in turns
        ],
        "weak_topics": weak_topics,
        "suggestions": suggestions,
        "project_defense_weak_points": defense_weak_points,
        "cross_verification": s.get("cross_verification"),
        "disclaimer": DISCLAIMER,
    }
    s["feedback"] = report
    return report


@app.get("/session/{session_id}/transcript", response_class=PlainTextResponse)
def transcript(session_id: str):
    s = _session_or_404(session_id)
    lines = [f"# VIVORA practice session ({s['level']})", f"Started: {s['started_at']}", ""]
    for i, t in enumerate(s["turns"], 1):
        src = t.get("source", "REPORT")
        lines += [f"## Q{i} [{t['section_title']}] (Source: {src})", f"**Examiner:** {t['question']}"]
        if t.get("status") == "skipped":
            lines += ["**You:** [SKIPPED]", "*Status: Skipped*", f"*Source: {src}*", ""]
        else:
            lines += [f"**You:** {t['answer']}", f"*Verdict: {t['verdict']}*", f"*Source: {src}*", ""]

    if s.get("cross_verification") and s["cross_verification"].get("has_code"):
        cv = s["cross_verification"]
        lines += ["# Cross-Verification Analysis", ""]
        if cv.get("verified"):
            lines += ["### Verified in Code:"]
            for v in cv["verified"]:
                lines += [f"- **{v['tech']}**: Evidence found in `{v['evidence_in_code']}`"]
            lines += [""]
        if cv.get("mismatches"):
            lines += ["### Clarification Items / Mismatches:"]
            for m in cv["mismatches"]:
                lines += [f"- **{m['tech']}**: {m['claim']} (No matching implementation found)"]
            lines += [""]
    return "\n".join(lines)
