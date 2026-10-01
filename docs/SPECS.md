# VIVORA: Specifications

Version 0.1 · Status: Draft

## 1. Overview

VIVORA is a web application where a student uploads their project report and practises a **spoken** viva
against an AI examiner. The examiner asks questions grounded in the student's own work, listens to spoken answers,
and asks adaptive follow-ups.

## 2. Problem statement

Many students know their project well but struggle to explain it out loud in a viva. Nervousness, fear of judgement,
and limited spoken-English practice make them freeze or under-explain. Existing prep tools are written question banks,
which do not train the skill that is actually tested: answering a live examiner's follow-ups aloud.
This project builds a voice-based examiner simulator that asks questions grounded in the student's own project report
and adapts to their spoken answers, so they can practise privately, repeatedly, and without fear of being judged.

## 3. Objectives

| ID | Objective | How we will show it |
|----|-----------|---------------------|
| O1 | Build a working, deployable GenAI web app | Live demo + hosted link |
| O2 | Generate questions grounded in the uploaded report | Manual check of 20 questions (target: 80%+ grounded) |
| O3 | Support spoken interaction (speech in, speech out) | End-to-end demo of a full session by voice |
| O4 | Adapt follow-ups to the student's answer | Examples where weak answers get sharper follow-ups |
| O5 | Give useful end-of-session feedback | Feedback report screenshots |
| O6 | Evaluate quality and student usefulness | Before/after confidence survey + question audit |

## 4. Scope

### In scope (v1)
- Upload of PDF, DOCX, or pasted text
- Question generation from the report content
- Voice interaction through the browser
- Three difficulty levels: Warm-up, Normal, Strict
- Freeze-rescue nudges after silence
- Transcript view
- End-of-session feedback (filler words, pace, missed points, weak topics)

### Out of scope (v1)
- Video, body-language, or eye-contact analysis
- Multiple students in a single session
- Mobile app (web only; mobile browser may work but is not tested)
- Languages other than English
- Accounts, login, and long-term history storage
- Official grading or any claim that it predicts real viva marks

## 5. Users

| User | Needs |
|------|-------|
| Final/pre-final year students | Practise explaining their mini/major project aloud |
| Students who freeze under pressure | A private space with gentle difficulty levels |
| Students with limited speaking practice | Repeat practice and feedback on pace and fillers |

## 6. Functional requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR1 | User can upload a PDF or DOCX report, or paste text | Must |
| FR2 | System extracts text and splits it into labelled sections | Must |
| FR3 | User can choose a level (Warm-up / Normal / Strict) before starting | Must |
| FR4 | Examiner asks one question at a time and speaks it aloud | Must |
| FR5 | User answers by microphone; transcript is shown live | Must |
| FR6 | System evaluates the answer and asks one follow-up or moves on | Must |
| FR7 | Questions must reference the uploaded content, not generic topics | Must |
| FR8 | If the user is silent for N seconds, a gentle nudge is shown/spoken | Should |
| FR9 | User can replay, skip, or end the session at any time | Must |
| FR10 | At the end, system produces a feedback report | Must |
| FR11 | Typed answers are allowed as a fallback if the mic fails | Should |
| FR12 | Session can be exported as a text/markdown transcript | Could |

## 7. Non-functional requirements

| ID | Requirement |
|----|-------------|
| NFR1 | Examiner's next question should appear within about 5 seconds of the user finishing speaking (depends on API latency) |
| NFR2 | UI must be usable on a laptop screen without training |
| NFR3 | API keys must never be exposed to the browser |
| NFR4 | App must fail gracefully: show a clear message if the mic, network, or API fails |
| NFR5 | Tone must be respectful in every level. Strict means demanding, not insulting |
| NFR6 | Works on latest Chrome/Edge (primary), others best effort |

## 8. Difficulty levels

| Level | Examiner behaviour |
|-------|--------------------|
| Warm-up | Friendly, simple questions, gives an encouraging line, one soft follow-up at most |
| Normal | Balanced. Asks "why" and "how" and one follow-up on vague answers |
| Strict | Challenges claims, asks for numbers/comparisons, up to two follow-ups |

## 9. Freeze-rescue rules

- Trigger: no speech detected for a set time after the question ends (default 8 s, configurable).
- Allowed: a prompt that helps you start ("Start with what the module does").
- Not allowed: giving the answer or part of it.
- Maximum of 2 nudges per question, then the examiner offers to rephrase or skip.

## 10. Feedback report contents

- Number of questions asked and answered
- Filler-word count (um, uh, like, basically, you know) and rate per minute
- Average speaking pace (words per minute) with a comfortable range note
- Per-question: key points from the report that were covered or missed
- Top 3 weakest topics
- Two or three specific suggestions for next practice

## 11. Data handling and privacy

- Uploaded text is kept in memory for the session only (v1 does not write reports to a database).
- Audio is not stored. Speech-to-text runs in the browser.
- Text sent to the LLM includes report excerpts and transcripts, so users are told not to upload confidential material.
- API keys live in environment variables on the server only.

## 12. Assumptions and constraints

- The browser's Web Speech API is available and microphone permission is granted.
- An LLM API key and budget/free tier are available for the project period.
- Reports are mostly text. Content inside images or diagrams is not read in v1.

## 13. Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Speech recognition mishears technical terms | Wrong transcripts, unfair feedback | Show transcript, allow edit/typed fallback, note limitation |
| LLM asks off-topic or generic questions | Defeats the purpose | Ground every prompt in a report excerpt; audit 20 questions |
| LLM is too harsh or too soft | Poor experience | Level-specific rules in the prompt; test with real users |
| API latency or cost | Slow or unusable demo | Keep prompts short, send only recent turns, cache section summaries |
| Users treat feedback as official marks | Misleading | Clear on-screen disclaimer |

## 14. Acceptance criteria (v1 is done when)

1. A user can upload a report, pick a level, and complete a 5-question spoken session end to end.
2. At least 80% of audited questions refer to the user's actual report content.
3. A feedback report is generated at the end of the session.
4. The app handles mic denial and API failure without crashing.
5. Evaluation results (see EVALUATION.md) are recorded, including failures.
