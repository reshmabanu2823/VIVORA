/**
 * app.js — VIVORA text-only application entry point and state machine.
 *
 * States:
 *   start      Upload / configuration screen
 *   uploading  Document or text being parsed
 *   ready      Ready to begin session
 *   asking     Question presented, waiting for student's typed answer
 *   thinking   POST /turn in flight ("Examiner is thinking...")
 *   feedback   Session finished, feedback report displayed
 *   error      Unrecoverable error state
 */

import * as api from './api.js';
import * as ui from './ui.js';
import { generateTranscriptPDF } from './pdf.js';

// ── App state ─────────────────────────────────────────────────────────────────
const state = {
  current: 'start',

  // Upload
  uploadId: null,
  sections: [],

  // Feedback & reports
  feedbackData: null,

  // Configuration
  level: 'normal',
  numQuestions: 5,

  // Active session
  sessionId: null,
  currentQuestion: null,
  questionNumber: 0,
  nudgeCount: 0,

  // Submission control
  submitting: false,
  pendingAnswer: null,
};

// ── State transition helper ───────────────────────────────────────────────────

function transition(newState) {
  console.debug(`[VIVORA] ${state.current} → ${newState}`);
  state.current = newState;
}

/** Handle API errors with friendly, accessible UX. */
function handleApiError(err, { onRetry, context = 'start' } = {}) {
  const status = err.status || 0;

  if (status === 429) {
    ui.showToast('Please wait a moment before sending again.');
    if (onRetry) setTimeout(onRetry, 3000);
    return;
  }
  if (status === 404) {
    ui.showError('Session expired. Please start a new practice session.', {
      context,
      onRetry: () => { ui.hideError(context); startOver(); },
    });
    return;
  }
  if (status === 502) {
    ui.showError('The examiner is temporarily unavailable.', {
      context,
      onRetry: onRetry || undefined,
    });
    return;
  }
  if (status === 413) {
    ui.showError('File too large (max 10 MB). Try a shorter document or paste text instead.', { context });
    return;
  }
  if (status === 0) {
    ui.showError("Can't reach the server. Is the backend running?", { context, onRetry });
    return;
  }

  ui.showError(err.message || 'Something went wrong. Please try again.', { context, onRetry });
}

// ── Start screen ──────────────────────────────────────────────────────────────

function initStartScreen() {
  transition('start');
  ui.showScreen('start');
  ui.hideError('start');
  ui.hideSections();

  const fileInput = document.getElementById('file-input');
  const dropZone = document.getElementById('drop-zone');
  const pasteTab = document.getElementById('tab-paste');
  const fileTab = document.getElementById('tab-file');
  const filePanel = document.getElementById('panel-file');
  const pastePanel = document.getElementById('panel-paste');
  const pasteArea = document.getElementById('paste-area');
  const btnStart = document.getElementById('btn-start');
  const levelCards = document.querySelectorAll('.level-card');
  const questionsStepper = document.getElementById('questions-count');

  // Tab switching
  function switchTab(tab) {
    const isFile = tab === 'file';
    fileTab.setAttribute('aria-selected', String(isFile));
    pasteTab.setAttribute('aria-selected', String(!isFile));
    filePanel.hidden = !isFile;
    pastePanel.hidden = isFile;
  }
  fileTab.addEventListener('click', () => switchTab('file'));
  pasteTab.addEventListener('click', () => switchTab('paste'));

  // Level card selection
  levelCards.forEach(card => {
    card.addEventListener('click', () => {
      levelCards.forEach(c => { c.classList.remove('level-card--selected'); c.setAttribute('aria-pressed', 'false'); });
      card.classList.add('level-card--selected');
      card.setAttribute('aria-pressed', 'true');
      state.level = card.dataset.level;
    });
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        card.click();
      }
    });
  });

  // Questions stepper
  if (questionsStepper) {
    questionsStepper.value = state.numQuestions;
    questionsStepper.addEventListener('input', () => {
      state.numQuestions = parseInt(questionsStepper.value, 10) || 5;
    });
  }

  // File drop zone
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drop-zone--hover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drop-zone--hover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drop-zone--hover');
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelected(file);
  });
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFileSelected(fileInput.files[0]);
  });

  // Paste text
  pasteArea.addEventListener('input', () => {
    const words = pasteArea.value.trim().split(/\s+/).filter(Boolean).length;
    btnStart.disabled = words < 60;
    if (words >= 60) {
      state.uploadId = null;
      btnStart.disabled = false;
    }
  });

  // Start button
  btnStart.addEventListener('click', handleStart);
}

async function handleFileSelected(file) {
  const btnStart = document.getElementById('btn-start');
  const dropLabel = document.getElementById('drop-label');

  const name = file.name.toLowerCase();
  if (!name.endsWith('.pdf') && !name.endsWith('.docx')) {
    ui.showError('Please upload a .pdf or .docx file. Text files (.txt) are not supported \u2014 paste the text instead.', { context: 'start' });
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    ui.showError('File too large. Maximum size is 10 MB.', { context: 'start' });
    return;
  }

  ui.hideError('start');
  transition('uploading');
  if (dropLabel) dropLabel.textContent = `Uploading ${file.name}...`;
  btnStart.disabled = true;
  ui.hideSections();

  try {
    const result = await api.uploadFile(file);
    state.uploadId = result.upload_id;
    state.sections = result.sections;
    ui.showSections(result.sections);
    if (dropLabel) dropLabel.textContent = `${file.name} — ready`;
    btnStart.disabled = false;
    transition('ready');
  } catch (err) {
    if (dropLabel) dropLabel.textContent = 'Upload failed. Try again or paste text.';
    handleApiError(err, { context: 'start' });
    transition('start');
  }
}

async function handleStart() {
  const btnStart = document.getElementById('btn-start');
  const pasteArea = document.getElementById('paste-area');
  const pastePanel = document.getElementById('panel-paste');

  ui.hideError('start');
  ui.setButtonLoading(btnStart, true);

  try {
    if (!state.uploadId) {
      if (pastePanel && !pastePanel.hidden) {
        const text = pasteArea.value.trim();
        if (!text || text.split(/\s+/).length < 60) {
          ui.showError('Please paste at least 60 words of your report.', { context: 'start' });
          ui.setButtonLoading(btnStart, false);
          return;
        }
        transition('uploading');
        const result = await api.uploadText(text);
        state.uploadId = result.upload_id;
        state.sections = result.sections;
      } else {
        ui.showError('Please upload or paste your report first.', { context: 'start' });
        ui.setButtonLoading(btnStart, false);
        return;
      }
    }

    const session = await api.createSession(state.uploadId, state.level, state.numQuestions);
    state.sessionId = session.session_id;
    state.currentQuestion = session.question;
    state.questionNumber = 1;
    state.nudgeCount = 0;

    startSessionScreen();
  } catch (err) {
    handleApiError(err, { context: 'start' });
    ui.setButtonLoading(btnStart, false);
    transition('start');
  }
}

// ── Session screen ─────────────────────────────────────────────────────────────

function startSessionScreen() {
  ui.showScreen('session');
  ui.hideEvalChip();
  ui.hideNudge();
  ui.hideError('session');

  wireSessionControls();
  askCurrentQuestion(null);
}

function wireSessionControls() {
  // End session
  document.getElementById('btn-end-session')?.addEventListener('click', () => {
    if (confirm('End the practice session now? You can still view your feedback summary.')) {
      endSession();
    }
  });

  // Textarea Ctrl+Enter submission
  const answerTextarea = document.getElementById('answer-text');
  if (answerTextarea) {
    answerTextarea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (state.current === 'asking' && !state.submitting) {
          submitAnswer();
        }
      }
    });
  }

  // Submit button
  document.getElementById('btn-submit-answer')?.addEventListener('click', () => {
    if (state.current === 'asking' && !state.submitting) {
      submitAnswer();
    }
  });

  // Give me a hint
  document.getElementById('btn-hint')?.addEventListener('click', handleHintRequest);

  // Skip question
  document.getElementById('btn-skip')?.addEventListener('click', () => {
    if (state.current === 'asking' && !state.submitting) {
      handleSkipQuestion();
    }
  });
}

function askCurrentQuestion(questionType) {
  transition('asking');
  state.submitting = false;
  state.nudgeCount = 0;

  ui.hideEvalChip();
  ui.hideNudge();
  ui.hideError('session');
  ui.setPresenceState('idle');

  // Reset hint button
  resetHintButton();

  // Update progress and question
  ui.setProgress(state.questionNumber, state.numQuestions, state.level);
  ui.showQuestion(state.currentQuestion.text, questionType, state.currentQuestion);

  // Clear and focus textarea
  const ta = document.getElementById('answer-text');
  if (ta) {
    ta.value = '';
    ta.disabled = false;
    ta.focus();
  }

  setSessionButtonsDisabled(false);
}

async function handleHintRequest() {
  const btnHint = document.getElementById('btn-hint');
  if (btnHint && btnHint.dataset.isSkip === 'true') {
    handleSkipQuestion();
    return;
  }

  state.nudgeCount += 1;
  ui.setButtonLoading(btnHint, true);

  try {
    const nudge = await api.getNudge(state.sessionId, state.currentQuestion.id, state.nudgeCount);
    ui.showNudge(nudge.text);

    if (nudge.offer_skip) {
      // When offer_skip is true, replace the button with "Skip"
      if (btnHint) {
        btnHint.textContent = 'Skip';
        btnHint.dataset.isSkip = 'true';
        btnHint.classList.remove('btn--secondary');
        btnHint.classList.add('btn--ghost');
      }
    }
  } catch (err) {
    handleApiError(err, { context: 'session' });
  } finally {
    ui.setButtonLoading(btnHint, false);
  }
}

function resetHintButton() {
  const btnHint = document.getElementById('btn-hint');
  if (btnHint) {
    btnHint.textContent = 'Give me a hint';
    btnHint.dataset.isSkip = 'false';
    btnHint.classList.remove('btn--ghost');
    btnHint.classList.add('btn--secondary');
  }
}

async function handleSkipQuestion() {
  if (state.submitting) return;
  state.submitting = true;

  setSessionButtonsDisabled(true);
  const ta = document.getElementById('answer-text');
  if (ta) {
    ta.value = '';
    ta.disabled = true;
  }

  // Add turn to history list as skipped
  ui.addHistoryTurn(state.currentQuestion.text, '[Skipped]', 'skipped');

  transition('thinking');
  ui.setPresenceState('thinking');
  ui.hideEvalChip();
  ui.hideNudge();

  try {
    const result = await api.skipTurn(state.sessionId, state.currentQuestion.id);

    state.submitting = false;

    if (result.next.type === 'end') {
      await endSession();
    } else {
      state.questionNumber += 1;
      state.currentQuestion = result.next.question;
      state.pendingAnswer = null;
      askCurrentQuestion(result.next.type);
    }
  } catch (err) {
    state.submitting = false;
    ui.setPresenceState('idle');
    setSessionButtonsDisabled(false);
    if (ta) ta.disabled = false;
    handleApiError(err, { context: 'session' });
  }
}

async function submitAnswer() {
  if (state.submitting) return;
  state.submitting = true;

  const ta = document.getElementById('answer-text');
  let answerText = ta ? ta.value.trim() : '';

  // Confirm if blank
  if (!answerText) {
    if (!confirm('Submit without an answer?')) {
      state.submitting = false;
      if (ta) ta.focus();
      return;
    }
    answerText = '(no answer given)';
  }

  if (ta) ta.disabled = true;
  setSessionButtonsDisabled(true);

  state.pendingAnswer = answerText;

  // Add turn to history list
  ui.addHistoryTurn(state.currentQuestion.text, answerText, 'partial');

  transition('thinking');
  ui.setPresenceState('thinking');

  await doSubmitTurn(answerText);
}

async function doSubmitTurn(answer) {
  const btnSubmit = document.getElementById('btn-submit-answer');
  ui.setButtonLoading(btnSubmit, true);
  ui.hideError('session');

  try {
    const result = await api.submitTurn(
      state.sessionId,
      state.currentQuestion.id,
      answer
    );

    state.submitting = false;
    ui.setButtonLoading(btnSubmit, false);

    // Show evaluation chip
    ui.showEvalChip(result.evaluation);

    if (result.next.type === 'end') {
      await endSession();
    } else {
      state.questionNumber += 1;
      state.currentQuestion = result.next.question;
      state.pendingAnswer = null;

      setTimeout(() => {
        ui.hideEvalChip();
        askCurrentQuestion(result.next.type);
      }, 1800);
    }
  } catch (err) {
    state.submitting = false;
    ui.setButtonLoading(btnSubmit, false);
    ui.setPresenceState('idle');

    const ta = document.getElementById('answer-text');
    if (ta) ta.disabled = false;
    setSessionButtonsDisabled(false);

    if (err.status === 502) {
      handleApiError(err, {
        context: 'session',
        onRetry: () => {
          ui.hideError('session');
          transition('thinking');
          ui.setPresenceState('thinking');
          doSubmitTurn(state.pendingAnswer);
        },
      });
    } else if (err.status === 429) {
      handleApiError(err, {
        context: 'session',
        onRetry: () => doSubmitTurn(answer),
      });
    } else {
      handleApiError(err, { context: 'session' });
    }
  }
}

function setSessionButtonsDisabled(disabled) {
  const btnSubmit = document.getElementById('btn-submit-answer');
  const btnHint = document.getElementById('btn-hint');
  const btnSkip = document.getElementById('btn-skip');

  if (btnSubmit) btnSubmit.disabled = disabled;
  if (btnHint) btnHint.disabled = disabled;
  if (btnSkip) btnSkip.disabled = disabled;
}

// ── End session / feedback ─────────────────────────────────────────────────────

async function endSession() {
  transition('feedback');
  ui.setPresenceState('idle');

  try {
    const feedback = await api.getFeedback(state.sessionId);
    state.feedbackData = feedback;
    ui.showFeedback(feedback);
    wireFeedbackControls();
  } catch (err) {
    handleApiError(err, {
      context: 'session',
      onRetry: endSession,
    });
  }
}

function wireFeedbackControls() {
  // Download transcript (PDF)
  document.getElementById('btn-download-transcript')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-download-transcript');
    ui.setButtonLoading(btn, true);
    try {
      let feedback = state.feedbackData;
      if (!feedback && state.sessionId) {
        feedback = await api.getFeedback(state.sessionId);
        state.feedbackData = feedback;
      }
      if (!feedback) {
        throw new Error('No feedback data available for PDF export');
      }
      generateTranscriptPDF(feedback, state);
    } catch (err) {
      console.error('PDF export failed:', err);
      ui.showToast('Could not download PDF transcript. Please try again.');
    } finally {
      ui.setButtonLoading(btn, false);
    }
  });

  // Practise again
  document.getElementById('btn-practise-again')?.addEventListener('click', () => startOver(false));

  // Try another level
  document.getElementById('btn-try-level')?.addEventListener('click', () => {
    state.sessionId = null;
    state.currentQuestion = null;
    state.questionNumber = 0;
    state.submitting = false;
    startOver(true);
  });
}

function startOver(keepUpload = false) {
  if (!keepUpload) {
    state.uploadId = null;
    state.sections = [];
  }
  state.sessionId = null;
  state.currentQuestion = null;
  state.questionNumber = 0;
  state.submitting = false;
  state.feedbackData = null;

  initStartScreen();

  if (keepUpload && state.uploadId) {
    ui.showSections(state.sections);
    const btnStart = document.getElementById('btn-start');
    if (btnStart) btnStart.disabled = false;
  }
}

// ── Unload safety ─────────────────────────────────────────────────────────────

window.addEventListener('beforeunload', (e) => {
  if (state.current === 'asking' || state.current === 'thinking') {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.querySelector('.level-card[data-level="normal"]')?.classList.add('level-card--selected');
  document.querySelector('.level-card[data-level="normal"]')?.setAttribute('aria-pressed', 'true');

  initStartScreen();
  console.info('[VIVORA] Text-only application initialised.');
});
