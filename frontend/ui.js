/**
 * ui.js — DOM rendering helpers for VIVORA.
 *
 * Exports:
 *   showScreen(name)                  show one of: 'start' | 'session' | 'feedback'
 *   setPresenceState(state, label?)   'idle' | 'speaking' | 'listening' | 'thinking'
 *   showQuestion(text, type?)         show question in large serif; type = 'new_topic' | 'followup' | null
 *   appendTranscript(text, final)     add text to live transcript
 *   clearTranscript()                 clear live transcript
 *   addHistoryTurn(q, a, verdict)     add past Q+A to collapsible history
 *   showEvalChip(evaluation)          show verdict chip after an answer
 *   hideEvalChip()                    dismiss the chip
 *   showNudge(text)                   show a gentle nudge from the examiner
 *   hideNudge()
 *   showNudgeActions(onRephrase, onSkip)   show Rephrase / Skip buttons
 *   hideNudgeActions()
 *   setProgress(current, total, level)   update top bar
 *   showSections(sections)            render section list after upload
 *   hideSections()
 *   showFeedback(data)                render entire feedback screen
 *   showError(message, { onRetry })   show inline error
 *   hideError()
 *   setButtonLoading(btn, loading)    toggle loading state on a button
 *   showToast(message)                ephemeral toast notification
 *   updateCountdown(secs)             show/hide the auto-submit countdown
 *   setMicActive(active)              update mic button appearance
 *   showTypingFallback(show)          show/hide the type-instead panel
 */

// ── Screen switching ──────────────────────────────────────────────────────────

/**
 * Show one screen and hide all others.
 * @param {'start'|'session'|'feedback'} name
 */
export function showScreen(name) {
  document.querySelectorAll('.screen').forEach(el => {
    el.hidden = el.dataset.screen !== name;
  });
  // Update ARIA live region
  const liveRegion = document.getElementById('aria-live');
  if (liveRegion) {
    const labels = { start: 'Start screen', session: 'Practice session', feedback: 'Feedback screen' };
    liveRegion.textContent = labels[name] || '';
  }
}

// ── Presence state ────────────────────────────────────────────────────────────

const PRESENCE_LABELS = {
  idle:      'Ready',
  speaking:  'Examiner is speaking',
  listening: 'Your turn to speak',
  thinking:  'Thinking...',
};

/**
 * Set the animated examiner presence circle state.
 * @param {'idle'|'speaking'|'listening'|'thinking'} state
 * @param {string} [label] Override the default state label
 */
export function setPresenceState(state, label) {
  const presence = document.getElementById('presence');
  const presenceLabel = document.getElementById('presence-label');
  if (!presence) return;

  // Remove all state classes
  presence.classList.remove('presence--idle', 'presence--speaking', 'presence--listening', 'presence--thinking');
  presence.classList.add(`presence--${state}`);
  presence.setAttribute('aria-label', label || PRESENCE_LABELS[state] || state);

  if (presenceLabel) {
    presenceLabel.textContent = label || PRESENCE_LABELS[state] || state;
  }
}

// ── Question display ──────────────────────────────────────────────────────────

/**
 * Show the current examiner question.
 * @param {string} text
 * @param {'new_topic'|'followup'|null} [type]
 */
export function showQuestion(text, type = null) {
  const el = document.getElementById('question-text');
  const badge = document.getElementById('question-type-badge');
  if (el) el.textContent = text;
  if (badge) {
    if (type === 'followup') {
      badge.textContent = 'Follow-up';
      badge.hidden = false;
    } else if (type === 'new_topic') {
      badge.textContent = 'New topic';
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }
}

// ── Live transcript ───────────────────────────────────────────────────────────

let _finalTranscript = '';

/**
 * Append text to the live answer transcript.
 * @param {string} text
 * @param {boolean} isFinal  Final text is shown in normal weight; interim in lighter colour
 */
export function appendTranscript(text, isFinal) {
  const el = document.getElementById('live-transcript');
  if (!el) return;

  if (isFinal) {
    _finalTranscript += (_finalTranscript ? ' ' : '') + text.trim();
  }

  // Render: final text + interim text
  const interimEl = el.querySelector('.transcript-interim');
  const finalEl = el.querySelector('.transcript-final');

  if (finalEl) finalEl.textContent = _finalTranscript;
  if (interimEl) interimEl.textContent = isFinal ? '' : text;

  el.scrollTop = el.scrollHeight;
}

/**
 * Clear the live transcript (call between questions).
 */
export function clearTranscript() {
  _finalTranscript = '';
  const el = document.getElementById('live-transcript');
  if (!el) return;
  const finalEl = el.querySelector('.transcript-final');
  const interimEl = el.querySelector('.transcript-interim');
  if (finalEl) finalEl.textContent = '';
  if (interimEl) interimEl.textContent = '';
}

/**
 * Get the current final transcript text.
 * @returns {string}
 */
export function getFinalTranscript() {
  return _finalTranscript;
}

/**
 * Set the final transcript (used when student edits it in the textarea).
 */
export function setFinalTranscript(text) {
  _finalTranscript = text;
  const el = document.getElementById('live-transcript');
  if (!el) return;
  const finalEl = el.querySelector('.transcript-final');
  if (finalEl) finalEl.textContent = _finalTranscript;
}

// ── History panel ─────────────────────────────────────────────────────────────

const VERDICT_LABELS = {
  strong:  { text: 'Solid answer', cls: 'verdict--strong' },
  partial: { text: 'Partly there', cls: 'verdict--partial' },
  weak:    { text: 'Needs more detail', cls: 'verdict--weak' },
};

/**
 * Add a completed Q+A pair to the scrollable history.
 */
export function addHistoryTurn(question, answer, verdict) {
  const list = document.getElementById('history-list');
  if (!list) return;

  const v = VERDICT_LABELS[verdict] || VERDICT_LABELS.partial;
  const item = document.createElement('div');
  item.className = 'history-item';
  item.innerHTML = `
    <p class="history-q">${escapeHtml(question)}</p>
    <p class="history-a">${escapeHtml(answer)}</p>
    <span class="verdict-tag ${v.cls}">${v.text}</span>
  `;
  list.appendChild(item);
  list.scrollTop = list.scrollHeight;
}

// ── Evaluation chip ───────────────────────────────────────────────────────────

/**
 * Show the small evaluation chip after an answer.
 * @param {{ verdict: string, covered: string[], missed: string[] }} evaluation
 */
export function showEvalChip(evaluation) {
  const chip = document.getElementById('eval-chip');
  if (!chip) return;

  const v = VERDICT_LABELS[evaluation.verdict] || VERDICT_LABELS.partial;
  const vCls = evaluation.verdict === 'strong' ? 'verdict--strong'
    : evaluation.verdict === 'weak' ? 'verdict--weak' : 'verdict--partial';

  let html = `<span class="verdict-tag ${vCls}">${v.text}</span>`;
  if (evaluation.missed && evaluation.missed.length) {
    const items = evaluation.missed.slice(0, 2).map(m => `<li>${escapeHtml(m)}</li>`).join('');
    html += `<p class="chip-missed">You could also mention: <ul>${items}</ul></p>`;
  }
  const dismissBtn = `<button class="chip-dismiss" aria-label="Dismiss feedback" onclick="document.getElementById('eval-chip').hidden=true">Dismiss</button>`;
  chip.innerHTML = html + dismissBtn;
  chip.hidden = false;
}

export function hideEvalChip() {
  const chip = document.getElementById('eval-chip');
  if (chip) chip.hidden = true;
}

// ── Nudge display ─────────────────────────────────────────────────────────────

export function showNudge(text) {
  const el = document.getElementById('nudge-text');
  const box = document.getElementById('nudge-box');
  if (el) el.textContent = text;
  if (box) box.hidden = false;
}

export function hideNudge() {
  const box = document.getElementById('nudge-box');
  if (box) box.hidden = true;
  hideNudgeActions();
}

export function showNudgeActions(onRephrase, onSkip) {
  const actions = document.getElementById('nudge-actions');
  if (!actions) return;
  actions.hidden = false;
  const rBtn = actions.querySelector('#btn-rephrase');
  const sBtn = actions.querySelector('#btn-skip');
  if (rBtn) rBtn.onclick = onRephrase;
  if (sBtn) sBtn.onclick = onSkip;
}

export function hideNudgeActions() {
  const actions = document.getElementById('nudge-actions');
  if (actions) actions.hidden = true;
}

// ── Progress bar ──────────────────────────────────────────────────────────────

export function setProgress(current, total, level) {
  const counter = document.getElementById('question-counter');
  const levelBadge = document.getElementById('level-badge');
  if (counter) counter.textContent = `Question ${current} of ${total}`;
  if (levelBadge && level) {
    levelBadge.textContent = level.charAt(0).toUpperCase() + level.slice(1);
    levelBadge.className = `level-badge level-badge--${level}`;
  }
}

// ── Section list ──────────────────────────────────────────────────────────────

export function showSections(sections) {
  const container = document.getElementById('sections-preview');
  if (!container) return;
  container.innerHTML = `
    <p class="sections-label">Detected sections</p>
    <ul class="sections-list">
      ${sections.map(s => `
        <li class="section-item">
          <span class="section-title">${escapeHtml(s.title)}</span>
          <span class="section-words">${s.word_count} words</span>
        </li>
      `).join('')}
    </ul>
  `;
  container.hidden = false;
}

export function hideSections() {
  const container = document.getElementById('sections-preview');
  if (container) container.hidden = true;
}

// ── Feedback screen ───────────────────────────────────────────────────────────

export function showFeedback(data) {
  const screen = document.querySelector('[data-screen="feedback"]');
  if (!screen) return;

  const s = data.summary;
  const paceClass = s.avg_wpm < 100 ? 'pace--slow' : s.avg_wpm <= 160 ? 'pace--ok' : 'pace--fast';

  // Build summary cards
  const summaryEl = screen.querySelector('#feedback-summary');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="summary-card">
        <span class="card-value">${s.questions}</span>
        <span class="card-label">Questions answered</span>
      </div>
      <div class="summary-card">
        <span class="card-value ${paceClass}">${s.avg_wpm != null ? s.avg_wpm + ' wpm' : '--'}</span>
        <span class="card-label">Speaking pace</span>
        <span class="card-sub">${s.pace_note || ''}</span>
      </div>
      <div class="summary-card">
        <span class="card-value">${s.filler_count ?? '--'}</span>
        <span class="card-label">Filler words</span>
        <span class="card-sub">${s.fillers_per_minute != null ? s.fillers_per_minute + '/min' : ''}</span>
      </div>
      <div class="summary-card">
        <span class="card-value">${s.avg_first_speech_delay_sec != null ? s.avg_first_speech_delay_sec + 's' : '--'}</span>
        <span class="card-label">Avg. response delay</span>
      </div>
    `;
  }

  // Per-question list
  const perQEl = screen.querySelector('#feedback-per-question');
  if (perQEl) {
    perQEl.innerHTML = data.per_question.map((q, i) => {
      const v = VERDICT_LABELS[q.verdict] || VERDICT_LABELS.partial;
      const vCls = q.verdict === 'strong' ? 'verdict--strong' : q.verdict === 'weak' ? 'verdict--weak' : 'verdict--partial';
      const fillerStr = q.fillers && Object.keys(q.fillers).length
        ? Object.entries(q.fillers).map(([w, n]) => `"${w}" x${n}`).join(', ')
        : 'None';
      return `
        <details class="perq-item">
          <summary class="perq-summary">
            <span class="perq-num">Q${i + 1}</span>
            <span class="perq-q">${escapeHtml(q.question)}</span>
            <span class="verdict-tag ${vCls}">${v.text}</span>
          </summary>
          <div class="perq-detail">
            <p class="perq-section">Section: ${escapeHtml(q.section)}</p>
            ${q.covered && q.covered.length ? `<p class="perq-covered">Covered: ${q.covered.map(escapeHtml).join(', ')}</p>` : ''}
            ${q.missed && q.missed.length ? `<p class="perq-missed">Could mention: ${q.missed.map(escapeHtml).join(', ')}</p>` : ''}
            <p class="perq-pace">Speaking pace: ${q.wpm != null ? q.wpm + ' wpm' : '--'}</p>
            <p class="perq-fillers">Filler words: ${fillerStr}</p>
          </div>
        </details>
      `;
    }).join('');
  }

  // Weak topics
  const weakEl = screen.querySelector('#feedback-weak-topics');
  if (weakEl && data.weak_topics && data.weak_topics.length) {
    weakEl.innerHTML = `
      <h3>Your weakest areas</h3>
      <ul>${data.weak_topics.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
    `;
    weakEl.hidden = false;
  }

  // Suggestions
  const suggEl = screen.querySelector('#feedback-suggestions');
  if (suggEl && data.suggestions && data.suggestions.length) {
    suggEl.innerHTML = `
      <h3>Suggestions for next time</h3>
      <ol>${data.suggestions.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
    `;
    suggEl.hidden = false;
  }

  // Disclaimer
  const disclaimerEl = screen.querySelector('#feedback-disclaimer');
  if (disclaimerEl) disclaimerEl.textContent = data.disclaimer || '';

  showScreen('feedback');
}

// ── Error display ─────────────────────────────────────────────────────────────

export function showError(message, { onRetry, context = 'start' } = {}) {
  const boxId = context === 'session' ? 'session-error-box' : 'error-box';
  const msgId = context === 'session' ? 'session-error-message' : 'error-message';
  const retryId = context === 'session' ? 'btn-retry-session-error' : 'btn-retry-error';

  const box = document.getElementById(boxId);
  const msgEl = document.getElementById(msgId);
  const retryBtn = document.getElementById(retryId);
  if (!box) return;
  if (msgEl) msgEl.textContent = message;
  if (retryBtn) {
    if (onRetry) {
      retryBtn.hidden = false;
      retryBtn.onclick = onRetry;
    } else {
      retryBtn.hidden = true;
    }
  }
  box.hidden = false;
}

export function hideError(context = 'start') {
  const boxId = context === 'session' ? 'session-error-box' : 'error-box';
  const box = document.getElementById(boxId);
  if (box) box.hidden = true;
}

// ── Button loading state ──────────────────────────────────────────────────────

export function setButtonLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = btn.dataset.loadingText || 'Please wait...';
  } else {
    btn.textContent = btn.dataset.originalText || btn.textContent;
  }
}

// ── Toast ────────────────────────────────────────────────────────────────────

let _toastTimer;
export function showToast(message) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('toast--visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove('toast--visible'), 3500);
}

// ── Countdown hint ────────────────────────────────────────────────────────────

export function updateCountdown(secs) {
  const el = document.getElementById('countdown-hint');
  if (!el) return;
  if (secs != null && secs > 0) {
    el.textContent = `Sending in ${secs}...`;
    el.hidden = false;
  } else {
    el.hidden = true;
    el.textContent = '';
  }
}

// ── Mic button ────────────────────────────────────────────────────────────────

export function setMicActive(active) {
  const btn = document.getElementById('btn-mic');
  if (!btn) return;
  btn.classList.toggle('mic--active', active);
  btn.setAttribute('aria-pressed', String(active));
  btn.title = active ? 'Mute microphone' : 'Unmute microphone';
}

// ── Typing fallback ───────────────────────────────────────────────────────────

export function showTypingFallback(show) {
  const panel = document.getElementById('typing-panel');
  const voiceControls = document.getElementById('voice-controls');
  if (panel) panel.hidden = !show;
  if (voiceControls) voiceControls.hidden = show;
}

// ── Mic check overlay ─────────────────────────────────────────────────────────

export function showMicCheckOverlay(show) {
  const el = document.getElementById('mic-check-overlay');
  if (el) el.hidden = !show;
}

// ── Utility ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
