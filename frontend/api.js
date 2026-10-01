/**
 * api.js — All fetch calls to the VIVORA backend (text-only mode).
 * Config: change API_BASE if your backend runs on a different port.
 * Mock mode: add ?mock=1 to the URL to use fake responses (no backend needed).
 */

const API_BASE = 'http://localhost:8000';

// ── Mock mode ─────────────────────────────────────────────────────────────────
const MOCK_MODE = new URLSearchParams(window.location.search).get('mock') === '1';

if (MOCK_MODE) console.info('[VIVORA] Mock mode active — no backend calls will be made.');

const MOCK_SECTIONS = [
  { id: 1, title: 'Introduction', word_count: 412 },
  { id: 2, title: 'Methodology', word_count: 638 },
  { id: 3, title: 'Implementation', word_count: 891 },
  { id: 4, title: 'Results and Discussion', word_count: 544 },
  { id: 5, title: 'Conclusion', word_count: 210 },
];

let _mockTurnCount = 0;
const MOCK_QUESTIONS = [
  'Can you explain the main motivation behind your project?',
  'Walk me through the architecture you chose for the system.',
  'What methodology did you follow and why did you pick it over alternatives?',
  'What were the key results and how did you measure success?',
  'What limitations does your current implementation have?',
];

const MOCK_RESPONSES = {
  health: { status: 'ok', llm_provider: 'mock' },
  upload: { upload_id: 'u_mock01', sections: MOCK_SECTIONS },
  session: {
    session_id: 's_mock01',
    question: { id: 1, text: MOCK_QUESTIONS[0], section_id: 1 },
    silence_nudge_seconds: 8,
  },
  turn: (qid) => {
    _mockTurnCount++;
    const isLast = _mockTurnCount >= 5;
    const verdicts = ['strong', 'partial', 'weak'];
    const verdict = verdicts[_mockTurnCount % 3];
    return {
      evaluation: {
        verdict,
        covered: ['main concept', 'system design'],
        missed: verdict !== 'strong' ? ['performance benchmarks', 'error handling rationale'] : [],
      },
      next: isLast
        ? { type: 'end', question: null }
        : {
            type: _mockTurnCount % 3 === 0 ? 'followup' : 'new_topic',
            question: {
              id: qid + 1,
              text: MOCK_QUESTIONS[Math.min(_mockTurnCount, MOCK_QUESTIONS.length - 1)],
              section_id: (_mockTurnCount % MOCK_SECTIONS.length) + 1,
            },
          },
    };
  },
  nudge: (n) => ({
    text: n >= 2 ? 'Consider explaining what the section aims to solve first.' : 'Try outlining the main design choice made here.',
    offer_skip: n >= 2,
  }),
  feedback: {
    summary: {
      questions: 5,
      level: 'normal',
    },
    per_question: MOCK_QUESTIONS.slice(0, 5).map((q, i) => ({
      question: q,
      section: MOCK_SECTIONS[i % MOCK_SECTIONS.length].title,
      verdict: ['strong', 'partial', 'weak', 'strong', 'partial'][i],
      covered: ['main idea', 'system design'],
      missed: i % 2 ? ['performance data', 'comparison to alternatives'] : [],
    })),
    weak_topics: ['Methodology', 'Results analysis'],
    suggestions: [
      'Include specific figures or metrics from your results when addressing evaluation questions.',
      'Clearly justify why you chose your methodology over alternatives.',
      'Highlight trade-offs and design constraints in your architecture.',
    ],
    disclaimer: 'Practice feedback only. It is not an official grade.',
  },
  transcript: `# VIVORA practice session (normal)\nStarted: 2026-10-01T11:00:00\n\n## Q1 [Introduction]\n**Examiner:** Can you explain the main motivation behind your project?\n**You:** Our project aims to help students practise for their viva...\n*Verdict: strong*\n`,
};

// ── HTTP helpers ──────────────────────────────────────────────────────────────

/**
 * Generic fetch wrapper. Throws an enriched Error with .status and .detail.
 */
async function apiFetch(path, options = {}) {
  let response;
  try {
    response = await fetch(API_BASE + path, options);
  } catch (e) {
    const err = new Error("Can't reach the server. Is the backend running?");
    err.status = 0;
    throw err;
  }

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      detail = body.detail || detail;
    } catch (_) {}
    const err = new Error(detail);
    err.status = response.status;
    throw err;
  }

  return response;
}

async function apiJSON(path, options = {}) {
  const r = await apiFetch(path, options);
  return r.json();
}

async function apiText(path, options = {}) {
  const r = await apiFetch(path, options);
  return r.text();
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Upload a File object (.pdf or .docx).
 * @param {File} file
 * @returns {Promise<{upload_id: string, sections: Array}>}
 */
export async function uploadFile(file) {
  if (MOCK_MODE) return MOCK_RESPONSES.upload;
  const form = new FormData();
  form.append('file', file);
  return apiJSON('/upload', { method: 'POST', body: form });
}

/**
 * Upload raw text pasted by the student.
 * @param {string} text
 * @returns {Promise<{upload_id: string, sections: Array}>}
 */
export async function uploadText(text) {
  if (MOCK_MODE) return MOCK_RESPONSES.upload;
  return apiJSON('/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

/**
 * Create a new practice session.
 * @param {string} uploadId
 * @param {'warmup'|'normal'|'strict'} level
 * @param {number} numQuestions
 * @returns {Promise<{session_id, question, silence_nudge_seconds}>}
 */
export async function createSession(uploadId, level, numQuestions) {
  if (MOCK_MODE) { _mockTurnCount = 0; return MOCK_RESPONSES.session; }
  return apiJSON('/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_id: uploadId, level, num_questions: numQuestions }),
  });
}

/**
 * Submit a student's typed answer for the current question.
 * Every POST /turn sends input_mode "typed", duration_sec 0 and first_speech_delay_sec null.
 * @param {string} sessionId
 * @param {number} questionId Must match the current question's id.
 * @param {string} answer
 * @returns {Promise<{evaluation, next}>}
 */
export async function submitTurn(sessionId, questionId, answer) {
  if (MOCK_MODE) return MOCK_RESPONSES.turn(questionId);
  return apiJSON('/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      question_id: questionId,
      answer,
      duration_sec: 0,
      first_speech_delay_sec: null,
      input_mode: 'typed',
    }),
  });
}

/**
 * Request a hint when the student wants assistance.
 * @param {string} sessionId
 * @param {number} questionId
 * @param {number} nudgeNumber 1-indexed
 * @returns {Promise<{text: string, offer_skip: boolean}>}
 */
export async function getNudge(sessionId, questionId, nudgeNumber) {
  if (MOCK_MODE) return MOCK_RESPONSES.nudge(nudgeNumber);
  return apiJSON('/nudge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, question_id: questionId, nudge_number: nudgeNumber }),
  });
}

/**
 * Fetch the final feedback report.
 * @param {string} sessionId
 */
export async function getFeedback(sessionId) {
  if (MOCK_MODE) return MOCK_RESPONSES.feedback;
  return apiJSON('/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  });
}

/**
 * Fetch the plain-text session transcript (markdown).
 * @param {string} sessionId
 * @returns {Promise<string>}
 */
export async function getTranscript(sessionId) {
  if (MOCK_MODE) return MOCK_RESPONSES.transcript;
  return apiText(`/session/${sessionId}/transcript`);
}
