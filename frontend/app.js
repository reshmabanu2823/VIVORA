/**
 * app.js — VIVORA application entry point and state machine.
 *
 * States:
 *   start      The upload / configuration screen
 *   uploading  File or text is being sent to /upload
 *   ready      Upload succeeded; student configures level & questions
 *   asking     TTS is speaking the examiner's question
 *   listening  Mic is on; student is answering
 *   thinking   POST /turn is in flight
 *   feedback   Session complete; feedback screen shown
 *   error      Unrecoverable error (session expired, etc.)
 */

import * as api from './api.js';
import * as speech from './speech.js';
import * as ui from './ui.js';

// ── Auto-submit silence window (ms) ──────────────────────────────────────────
// Change this constant to adjust how long after silence before auto-submitting.
const AUTO_SUBMIT_MS = 2500;

// ── App state ─────────────────────────────────────────────────────────────────
const state = {
  current: 'start',     // current FSM state

  // Upload
  uploadId: null,
  sections: [],

  // Session config (set before /session)
  level: 'normal',
  numQuestions: 5,

  // Live session
  sessionId: null,
  currentQuestion: null,   // { id, text, section_id }
  questionNumber: 0,
  silenceNudgeSec: 8,
  nudgeCount: 0,
  nudgeTimer: null,

  // Typing/mic mode
  voiceMode: null,    // true = voice, false = typed-only

  // Answer timing
  ttsEndTime: null,
  firstSpeechTime: null,
  answerStartTime: null,

  // Auto-submit
  silenceTimer: null,
  countdownTimer: null,

  // Pending retry (for 502 errors)
  pendingAnswer: null,
  pendingDuration: null,
  pendingDelay: null,

  // Prevents double-submits
  submitting: false,

  // Mic level stop function (for mic check)
  stopMicLevel: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function transition(newState) {
  console.debug(`[VIVORA] ${state.current} → ${newState}`);
  state.current = newState;
}

/** Cancel all timers cleanly. */
function clearTimers() {
  clearTimeout(state.silenceTimer);
  clearTimeout(state.nudgeTimer);
  clearInterval(state.countdownTimer);
  state.silenceTimer = null;
  state.nudgeTimer = null;
  state.countdownTimer = null;
  ui.updateCountdown(null);
}

/** Stop speech and recognition. */
function cleanup() {
  clearTimers();
  speech.stopSpeaking();
  speech.stopListening();
  state.submitting = false;
}

/** Handle API errors with appropriate UX. */
function handleApiError(err, { onRetry, context = 'start' } = {}) {
  const status = err.status || 0;

  if (status === 429) {
    ui.showToast('Slow down a little. Retrying in 3 seconds...');
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
  ui.hideError();
  ui.hideSections();

  const fileInput = document.getElementById('file-input');
  const dropZone = document.getElementById('drop-zone');
  const pasteTab = document.getElementById('tab-paste');
  const fileTab = document.getElementById('tab-file');
  const filePanel = document.getElementById('panel-file');
  const pastePanel = document.getElementById('panel-paste');
  const pasteArea = document.getElementById('paste-area');
  const btnStart = document.getElementById('btn-start');
  const btnMicCheck = document.getElementById('btn-mic-check');
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
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); } });
  });

  // Questions stepper
  if (questionsStepper) {
    questionsStepper.value = state.numQuestions;
    questionsStepper.addEventListener('input', () => {
      state.numQuestions = parseInt(questionsStepper.value, 10) || 5;
    });
  }

  // Drop zone
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drop-zone--hover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drop-zone--hover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drop-zone--hover');
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelected(file);
  });
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFileSelected(fileInput.files[0]);
  });

  // Paste text
  pasteArea.addEventListener('input', () => {
    const words = pasteArea.value.trim().split(/\s+/).filter(Boolean).length;
    btnStart.disabled = words < 60;
    if (words >= 60) {
      state.uploadId = null; // will upload on start
      btnStart.disabled = false;
    }
  });

  // Mic check
  if (btnMicCheck) {
    if (!speech.isVoiceAvailable()) {
      btnMicCheck.hidden = true;
    } else {
      btnMicCheck.addEventListener('click', runMicCheck);
    }
  }

  // Start button
  btnStart.addEventListener('click', handleStart);
}

async function handleFileSelected(file) {
  const btnStart = document.getElementById('btn-start');
  const dropLabel = document.getElementById('drop-label');

  // Validate type
  const name = file.name.toLowerCase();
  if (!name.endsWith('.pdf') && !name.endsWith('.docx')) {
    ui.showError('Please upload a .pdf or .docx file. Text files (.txt) are not supported \u2014 paste the text instead.');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    ui.showError('File too large. Maximum size is 10 MB.');
    return;
  }

  ui.hideError();
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
    handleApiError(err);
    transition('start');
  }
}

async function handleStart() {
  const btnStart = document.getElementById('btn-start');
  const pasteArea = document.getElementById('paste-area');
  const pastePanel = document.getElementById('panel-paste');

  ui.hideError();
  ui.setButtonLoading(btnStart, true);

  try {
    // If no file uploaded yet, upload the pasted text
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

    // Determine voice mode
    state.voiceMode = speech.isVoiceAvailable();

    // Create session
    const session = await api.createSession(state.uploadId, state.level, state.numQuestions);
    state.sessionId = session.session_id;
    state.currentQuestion = session.question;
    state.questionNumber = 1;
    state.silenceNudgeSec = session.silence_nudge_seconds || 8;
    state.nudgeCount = 0;

    // Start session screen
    startSessionScreen();
  } catch (err) {
    handleApiError(err, { context: 'start' });
    ui.setButtonLoading(btnStart, false);
    transition('start');
  }
}

// ── Mic check ──────────────────────────────────────────────────────────────────

async function runMicCheck() {
  const overlay = document.getElementById('mic-check-overlay');
  const meter = document.getElementById('mic-meter-fill');
  const btnClose = document.getElementById('btn-mic-check-close');

  ui.showMicCheckOverlay(true);

  const granted = await speech.checkMicPermission();
  if (!granted) {
    ui.showMicCheckOverlay(false);
    ui.showToast('Microphone access was denied. You can still type your answers.');
    state.voiceMode = false;
    return;
  }

  // Show live level meter for 5 seconds
  const stopLevel = await speech.getMicLevel((level) => {
    if (meter) meter.style.width = `${Math.round(level * 100)}%`;
  });

  state.stopMicLevel = stopLevel;

  const closeCheck = () => {
    if (state.stopMicLevel) { state.stopMicLevel(); state.stopMicLevel = null; }
    ui.showMicCheckOverlay(false);
  };

  if (btnClose) btnClose.onclick = closeCheck;
  setTimeout(closeCheck, 6000);
}

// ── Session screen ─────────────────────────────────────────────────────────────

function startSessionScreen() {
  ui.showScreen('session');
  ui.clearTranscript();
  ui.hideEvalChip();
  ui.hideNudge();
  ui.hideError();

  // Show voice unavailable banner if needed
  if (!state.voiceMode) {
    ui.showToast("Voice isn't available here, so you can type your answers. Chrome works best for voice.");
    ui.showTypingFallback(true);
  } else {
    ui.showTypingFallback(false);
  }

  // Wire up session controls
  wireSessionControls();

  // Speak first question
  askCurrentQuestion(null);
}

function wireSessionControls() {
  // End session
  document.getElementById('btn-end-session')?.addEventListener('click', () => {
    if (confirm('End the practice session now? You can still see your feedback.')) {
      endSession();
    }
  });

  // Done answering
  document.getElementById('btn-done')?.addEventListener('click', () => {
    if (state.current === 'listening') submitAnswer();
  });

  // Repeat question (voice controls)
  document.getElementById('btn-repeat')?.addEventListener('click', () => {
    if (state.current === 'listening' || state.current === 'asking') {
      clearTimers();
      speech.stopSpeaking();
      speakQuestion(state.currentQuestion.text, () => beginListening());
    }
  });

  // Repeat question (typing panel)
  document.getElementById('btn-repeat-type')?.addEventListener('click', () => {
    if (state.currentQuestion) {
      ui.showQuestion(state.currentQuestion.text);
    }
  });

  // Type instead
  document.getElementById('btn-type-instead')?.addEventListener('click', () => {
    ui.showTypingFallback(true);
    speech.stopListening();
    clearTimers();
    setListeningControls(false);
  });

  // Mic toggle
  document.getElementById('btn-mic')?.addEventListener('click', toggleMic);

  // Typing panel submit
  document.getElementById('btn-type-submit')?.addEventListener('click', () => {
    const ta = document.getElementById('type-answer');
    if (ta) {
      ui.setFinalTranscript(ta.value.trim());
      ta.value = '';
    }
    submitAnswer();
  });

  // Skip button (wired dynamically in showNudgeActions)
}

function askCurrentQuestion(questionType) {
  transition('asking');
  clearTimers();
  ui.clearTranscript();
  ui.hideEvalChip();
  ui.hideNudge();
  ui.hideError();
  state.nudgeCount = 0;
  state.firstSpeechTime = null;
  state.answerStartTime = null;

  setListeningControls(false);
  ui.setProgress(state.questionNumber, state.numQuestions, state.level);
  ui.showQuestion(state.currentQuestion.text, questionType);
  ui.setPresenceState('speaking');

  if (state.voiceMode) {
    speakQuestion(state.currentQuestion.text, () => {
      state.ttsEndTime = Date.now();
      beginListening();
    });
  } else {
    // Typed mode: just show the question and open the typing panel
    state.ttsEndTime = Date.now();
    ui.showTypingFallback(true);
    setListeningControls(true);
    transition('listening');
    ui.setPresenceState('listening');
  }
}

function speakQuestion(text, onEnd) {
  speech.speak(text, {
    onEnd,
    onError: () => {
      // TTS failed silently — continue
      onEnd && onEnd();
    },
  });
}

function beginListening() {
  transition('listening');
  ui.setPresenceState('listening');
  setListeningControls(true);
  ui.setMicActive(true);

  startNudgeTimer();

  if (!state.voiceMode) return;

  let hasSpeech = false;

  speech.startListening({
    onSpeechStart: () => {
      if (!state.firstSpeechTime) {
        state.firstSpeechTime = Date.now();
        state.answerStartTime = Date.now();
      }
      // Reset silence timers when speech resumes
      clearTimers();
      startNudgeTimer();
      hasSpeech = true;
    },
    onInterim: (text) => {
      ui.appendTranscript(text, false);
      // Cancel auto-submit while still talking
      clearTimeout(state.silenceTimer);
      clearInterval(state.countdownTimer);
      ui.updateCountdown(null);
    },
    onFinal: (text) => {
      ui.appendTranscript(text, true);
      // Enforce 6000 char limit
      const current = ui.getFinalTranscript ? ui.getFinalTranscript() : '';
      if (current.length >= 5800) {
        submitAnswer();
        return;
      }
      // Start silence window for auto-submit
      startSilenceAutoSubmit();
    },
    onEnd: () => {
      // Recognition ended (Chrome auto-stop) — already handled via _shouldRestart
    },
    onError: (err) => {
      if (err === 'not-allowed' || err === 'permission-denied') {
        state.voiceMode = false;
        speech.stopListening();
        ui.showTypingFallback(true);
        ui.showToast("Microphone access was denied. Switching to typed answers.");
      }
    },
  });
}

function startNudgeTimer() {
  clearTimeout(state.nudgeTimer);
  state.nudgeTimer = setTimeout(triggerNudge, state.silenceNudgeSec * 1000);
}

async function triggerNudge() {
  if (state.current !== 'listening') return;
  state.nudgeCount += 1;

  try {
    const nudge = await api.getNudge(state.sessionId, state.currentQuestion.id, state.nudgeCount);
    ui.showNudge(nudge.text);
    if (state.voiceMode) {
      speech.stopListening();
      speech.speak(nudge.text, {
        onEnd: () => {
          if (nudge.offer_skip) {
            ui.showNudgeActions(
              () => {
                // Rephrase: re-speak the question
                ui.hideNudge();
                speakQuestion(state.currentQuestion.text, () => beginListening());
              },
              () => {
                // Skip: submit "(skipped)"
                ui.setFinalTranscript('(skipped)');
                submitAnswer();
              }
            );
          } else {
            beginListening();
            startNudgeTimer();
          }
        },
      });
    } else {
      if (nudge.offer_skip) {
        ui.showNudgeActions(
          () => { ui.hideNudge(); },
          () => { ui.setFinalTranscript('(skipped)'); submitAnswer(); }
        );
      } else {
        startNudgeTimer();
      }
    }
  } catch (_) {
    // Ignore nudge failures silently
    startNudgeTimer();
  }
}

function startSilenceAutoSubmit() {
  clearTimeout(state.silenceTimer);
  clearInterval(state.countdownTimer);
  ui.updateCountdown(null);

  // Show countdown only in the last 1 second
  const countdownStartMs = AUTO_SUBMIT_MS - 1000;

  state.silenceTimer = setTimeout(() => {
    // Auto-submit
    submitAnswer();
  }, AUTO_SUBMIT_MS);

  // Countdown display
  const countdownAt = Math.floor(AUTO_SUBMIT_MS / 1000);
  if (countdownAt >= 1) {
    state.countdownTimer = setInterval(() => {
      const remaining = Math.ceil((state.silenceTimer ? AUTO_SUBMIT_MS : 0) / 1000);
      if (remaining <= 1) {
        ui.updateCountdown(1);
      }
    }, 500);

    // Show "Sending in 1..." only at the last second
    setTimeout(() => {
      if (state.current === 'listening') ui.updateCountdown(1);
    }, countdownStartMs > 0 ? countdownStartMs : 0);
  }
}

async function submitAnswer() {
  if (state.submitting) return;
  if (state.current !== 'listening') return;
  state.submitting = true;

  clearTimers();
  speech.stopListening();
  ui.updateCountdown(null);
  ui.setMicActive(false);
  setListeningControls(false);

  // Get answer text
  const answerText = (ui.getFinalTranscript ? ui.getFinalTranscript() : '') || '';

  // Confirm if empty
  if (!answerText.trim()) {
    if (!confirm('Submit without an answer?')) {
      state.submitting = false;
      beginListening();
      return;
    }
  }

  // Calculate timings
  const now = Date.now();
  const firstSpeechDelay = state.firstSpeechTime && state.ttsEndTime
    ? (state.firstSpeechTime - state.ttsEndTime) / 1000
    : null;
  const duration = state.answerStartTime
    ? (now - state.answerStartTime) / 1000
    : 0;

  // Store for potential 502 retry
  state.pendingAnswer = answerText;
  state.pendingDuration = duration;
  state.pendingDelay = firstSpeechDelay;

  // Add to history
  ui.addHistoryTurn(state.currentQuestion.text, answerText || '(no answer)', 'partial');

  transition('thinking');
  ui.setPresenceState('thinking');

  await doSubmitTurn(answerText, duration, firstSpeechDelay);
}

async function doSubmitTurn(answer, duration, delay) {
  const btnDone = document.getElementById('btn-done');
  ui.setButtonLoading(btnDone, true);
  ui.hideError();

  try {
    const result = await api.submitTurn(
      state.sessionId,
      state.currentQuestion.id,
      answer,
      duration,
      delay
    );

    state.submitting = false;
    ui.setButtonLoading(btnDone, false);

    // Show evaluation chip
    ui.showEvalChip(result.evaluation);

    if (result.next.type === 'end') {
      // Session complete
      await endSession();
    } else {
      // Move to next question
      state.questionNumber += 1;
      state.currentQuestion = result.next.question;
      state.pendingAnswer = null;

      // Short pause before next question
      setTimeout(() => {
        ui.hideEvalChip();
        askCurrentQuestion(result.next.type);
      }, 2500);
    }
  } catch (err) {
    state.submitting = false;
    ui.setButtonLoading(btnDone, false);

    if (err.status === 502) {
      handleApiError(err, {
        context: 'session',
        onRetry: () => {
          ui.hideError('session');
          transition('thinking');
          ui.setPresenceState('thinking');
          doSubmitTurn(state.pendingAnswer, state.pendingDuration, state.pendingDelay);
        },
      });
    } else if (err.status === 429) {
      handleApiError(err, {
        context: 'session',
        onRetry: () => doSubmitTurn(answer, duration, delay),
      });
    } else {
      handleApiError(err, { context: 'session' });
      // Allow retry via listening
      setTimeout(() => {
        if (state.current === 'thinking') {
          transition('listening');
          ui.setPresenceState('listening');
          beginListening();
        }
      }, 4000);
    }
  }
}

function setListeningControls(enabled) {
  const btnDone = document.getElementById('btn-done');
  const btnRepeat = document.getElementById('btn-repeat');
  const btnTypeInstead = document.getElementById('btn-type-instead');
  const btnMic = document.getElementById('btn-mic');

  if (btnDone) btnDone.disabled = !enabled;
  if (btnRepeat) btnRepeat.disabled = !enabled && state.current !== 'asking';
  if (btnTypeInstead) btnTypeInstead.disabled = !enabled;
  if (btnMic) btnMic.disabled = !enabled;
}

function toggleMic() {
  if (state.current !== 'listening') return;
  // Simple mute/unmute toggle
  const btn = document.getElementById('btn-mic');
  const isActive = btn?.classList.contains('mic--active');
  if (isActive) {
    speech.stopListening();
    ui.setMicActive(false);
    clearTimers();
  } else {
    ui.setMicActive(true);
    beginListening();
  }
}

// ── End session / feedback ─────────────────────────────────────────────────────

async function endSession() {
  cleanup();
  transition('feedback');
  ui.setPresenceState('idle');

  try {
    const feedback = await api.getFeedback(state.sessionId);
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
  // Download transcript
  document.getElementById('btn-download-transcript')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-download-transcript');
    ui.setButtonLoading(btn, true);
    try {
      const md = await api.getTranscript(state.sessionId);
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'vivora-transcript.md';
      a.click();
      URL.revokeObjectURL(url);
    } catch (_) {
      ui.showToast('Could not download transcript. Try again.');
    } finally {
      ui.setButtonLoading(btn, false);
    }
  });

  // Practise again
  document.getElementById('btn-practise-again')?.addEventListener('click', startOver);

  // Try another level
  document.getElementById('btn-try-level')?.addEventListener('click', () => {
    // Reset only the session, keep the upload
    state.sessionId = null;
    state.currentQuestion = null;
    state.questionNumber = 0;
    state.submitting = false;
    startOver(true); // keepUpload=true
  });
}

function startOver(keepUpload = false) {
  cleanup();
  if (!keepUpload) {
    state.uploadId = null;
    state.sections = [];
  }
  state.sessionId = null;
  state.currentQuestion = null;
  state.questionNumber = 0;
  state.submitting = false;
  state.voiceMode = null;

  // Re-init the start screen
  initStartScreen();

  if (keepUpload && state.uploadId) {
    ui.showSections(state.sections);
    document.getElementById('btn-start').disabled = false;
  }
}

// ── Page visibility & unload ───────────────────────────────────────────────────

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    speech.stopSpeaking();
    speech.stopListening();
  }
});

window.addEventListener('beforeunload', (e) => {
  if (state.current === 'listening' || state.current === 'asking' || state.current === 'thinking') {
    e.preventDefault();
    e.returnValue = '';
  }
  cleanup();
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Set default level card selection
  document.querySelector('.level-card[data-level="normal"]')?.classList.add('level-card--selected');
  document.querySelector('.level-card[data-level="normal"]')?.setAttribute('aria-pressed', 'true');

  initStartScreen();
  console.info('[VIVORA] App ready. State machine initialised.');
});
