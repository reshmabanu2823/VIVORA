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
let _mockSections = [
  { id: 1, title: 'Introduction', word_count: 412, text: 'We introduce an automated pipeline for distributed inference across resource-constrained edge nodes.' },
  { id: 2, title: 'Methodology', word_count: 638, text: 'The proposed algorithm uses dynamic tensor partitioning and adaptive quantization to reduce communication latency.' },
  { id: 3, title: 'Implementation', word_count: 891, text: 'We implemented the core scheduler in Rust using asynchronous event loops and zero-copy shared memory queues.' },
  { id: 4, title: 'Results and Discussion', word_count: 544, text: 'Experimental evaluations demonstrated a 42 percent reduction in end-to-end latency with minimal accuracy degradation.' },
  { id: 5, title: 'Conclusion', word_count: 210, text: 'The edge scheduling paradigm offers a viable approach for latency-critical deep learning deployments.' },
];

function _makeMockQuestion(sec, qid) {
  const words = (sec.text || sec.title).split(/\s+/);
  const snippet = words.slice(0, Math.min(6, words.length)).join(' ');
  const source = sec.source || (sec.title && sec.title.startsWith('Code:') ? 'CODE' : 'REPORT');
  return {
    id: qid,
    text: `Regarding "${snippet}" in ${sec.title}, can you walk me through the specific design choices and tradeoffs?`,
    section_id: sec.id,
    section_title: sec.title,
    evidence: snippet,
    source,
  };
}

const MOCK_RESPONSES = {
  health: { status: 'ok', llm_provider: 'mock' },
  upload: { upload_id: 'u_mock01', sections: _mockSections.map(s => ({ id: s.id, title: s.title, word_count: s.word_count, source: 'REPORT' })) },
  code_upload: {
    code_upload_id: 'c_mock01',
    total_files: 2,
    files: [{ path: 'main.py', lines: 45, size: 1200 }, { path: 'utils.py', lines: 30, size: 800 }],
    sections: [{ id: 101, title: 'Code: main.py', word_count: 320, source: 'CODE' }],
  },
  session: () => {
    _mockTurnCount = 0;
    const sec = _mockSections[1] || _mockSections[0];
    return {
      session_id: 's_mock01',
      question: _makeMockQuestion(sec, 1),
      silence_nudge_seconds: 8,
    };
  },
  turn: (qid) => {
    _mockTurnCount++;
    const isLast = _mockTurnCount >= 5;
    const verdicts = ['strong', 'partial', 'weak'];
    const verdict = verdicts[_mockTurnCount % 3];
    const nextSec = _mockSections[_mockTurnCount % _mockSections.length];
    const source = (nextSec.source || 'REPORT');
    return {
      evaluation: {
        verdict,
        source,
        covered: ['main concept', 'system design'],
        missed: verdict !== 'strong' ? ['performance benchmarks', 'error handling rationale'] : [],
      },
      next: isLast
        ? { type: 'end', question: null }
        : {
            type: _mockTurnCount % 2 === 0 ? 'followup' : 'new_topic',
            question: _makeMockQuestion(nextSec, qid + 1),
          },
    };
  },
  skip: (qid) => {
    _mockTurnCount++;
    const isLast = _mockTurnCount >= 5;
    const nextSec = _mockSections[_mockTurnCount % _mockSections.length];
    const source = (nextSec.source || 'REPORT');
    return {
      evaluation: {
        verdict: null,
        covered: [],
        missed: [],
        source,
        status: 'skipped',
      },
      next: isLast
        ? { type: 'end', question: null }
        : {
            type: 'new_topic',
            question: _makeMockQuestion(nextSec, qid + 1),
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
      questions_asked: 5,
      questions_answered: 5,
      questions_skipped: 0,
      level: 'normal',
    },
    per_question: _mockSections.slice(0, 5).map((sec, i) => {
      const qObj = _makeMockQuestion(sec, i + 1);
      return {
        question: qObj.text,
        section: sec.title,
        source: qObj.source || 'REPORT',
        status: 'answered',
        verdict: ['strong', 'partial', 'weak', 'strong', 'partial'][i],
        covered: ['main idea', 'system design'],
        missed: i % 2 ? ['performance data', 'comparison to alternatives'] : [],
      };
    }),
    weak_topics: ['Methodology', 'Results analysis'],
    project_defense_weak_points: [
      'Performance evaluation: Claimed 42% latency reduction without documenting comparative hardware baselines.',
      'Implementation trade-offs: Did not justify choosing zero-copy queues over standard POSIX message channels.'
    ],
    cross_verification: {
      has_code: true,
      total_files: 2,
      verified: [
        { tech: 'Rust', claim: 'Implemented in Rust', evidence_in_code: 'scheduler.rs', status: 'verified' }
      ],
      mismatches: [
        { tech: 'MongoDB', claim: 'Report claims MongoDB is used', status: 'mismatch', neutral_question: 'Your report mentions MongoDB. Can you show how MongoDB is implemented in the project?' }
      ]
    },
    suggestions: [
      'Include specific figures or metrics from your results when addressing evaluation questions.',
      'Clearly justify why you chose your methodology over alternatives.',
      'Highlight trade-offs and design constraints in your architecture.',
    ],
    disclaimer: 'Practice feedback only. It is not an official grade.',
  },
  transcript: `# VIVORA practice session (normal)\nStarted: 2026-10-01T11:00:00\n\n## Q1 [Methodology] (Source: REPORT)\n**Examiner:** Regarding the proposed algorithm in Methodology, can you explain the tradeoffs?\n**You:** We evaluated latency and throughput...\n*Verdict: strong*\n*Source: REPORT*\n`,
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
 * Upload a source code archive (.zip) or single code file.
 * @param {File} file
 * @returns {Promise<{code_upload_id: string, total_files: number, files: Array, sections: Array}>}
 */
export async function uploadCodeFile(file) {
  if (MOCK_MODE) return MOCK_RESPONSES.code_upload;
  const form = new FormData();
  form.append('file', file);
  return apiJSON('/upload_code', { method: 'POST', body: form });
}

/**
 * Upload raw source code text.
 * @param {string} text
 * @param {string} [filename]
 * @returns {Promise<{code_upload_id: string, total_files: number, files: Array, sections: Array}>}
 */
export async function uploadCodeText(text, filename = 'source_code.py') {
  if (MOCK_MODE) return MOCK_RESPONSES.code_upload;
  return apiJSON('/upload_code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, filename }),
  });
}

/**
 * Create a new practice session.
 * @param {string} uploadId
 * @param {'warmup'|'normal'|'strict'|'defense'} level
 * @param {number} numQuestions
 * @param {string|null} [codeUploadId]
 * @returns {Promise<{session_id, question, silence_nudge_seconds}>}
 */
export async function createSession(uploadId, level, numQuestions, codeUploadId = null) {
  if (MOCK_MODE) { return typeof MOCK_RESPONSES.session === 'function' ? MOCK_RESPONSES.session() : MOCK_RESPONSES.session; }
  const payload = { upload_id: uploadId, level, num_questions: numQuestions };
  if (codeUploadId) payload.code_upload_id = codeUploadId;
  return apiJSON('/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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
      status: 'answered',
    }),
  });
}

/**
 * Skip the current question without submitting an answer.
 * @param {string} sessionId
 * @param {number} questionId Must match the current question's id.
 * @returns {Promise<{evaluation, next}>}
 */
export async function skipTurn(sessionId, questionId) {
  if (MOCK_MODE) return MOCK_RESPONSES.skip(questionId);
  return apiJSON('/skip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      question_id: questionId,
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
