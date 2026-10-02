/**
 * ui.js — DOM rendering helpers for VIVORA (text-only mode).
 *
 * Exports:
 *   showScreen(name)                  show one of: 'start' | 'session' | 'feedback'
 *   setPresenceState(state)           'idle' | 'thinking'
 *   showQuestion(text, type?)         show question in large serif; type = 'new_topic' | 'followup' | null
 *   addHistoryTurn(q, a, verdict)     add past Q+A to collapsible history
 *   showEvalChip(evaluation)          show verdict chip after an answer
 *   hideEvalChip()                    dismiss the chip
 *   showNudge(text)                   show hint from the examiner
 *   hideNudge()
 *   setProgress(current, total, level) update top bar
 *   showSections(sections)            render section list after upload
 *   hideSections()
 *   showFeedback(data)                render feedback screen (questions answered, verdicts, weak topics, suggestions)
 *   showError(message, { onRetry, context }) show inline error
 *   hideError(context)
 *   setButtonLoading(btn, loading)    toggle loading state on a button
 *   showToast(message)                ephemeral toast notification
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
  const liveRegion = document.getElementById('aria-live');
  if (liveRegion) {
    const labels = { start: 'Start screen', session: 'Practice session', feedback: 'Feedback screen' };
    liveRegion.textContent = labels[name] || '';
  }
}

// ── Examiner status ───────────────────────────────────────────────────────────

/**
 * Set examiner state: 'thinking' -> "Examiner is thinking...", 'idle' -> hidden / calm.
 * @param {'idle'|'thinking'} state
 */
export function setPresenceState(state) {
  const presenceLabel = document.getElementById('presence-label');
  if (!presenceLabel) return;

  if (state === 'thinking') {
    presenceLabel.textContent = 'Examiner is thinking...';
    presenceLabel.classList.add('presence-label--thinking');
  } else {
    presenceLabel.textContent = '';
    presenceLabel.classList.remove('presence-label--thinking');
  }
}

// ── Question display ──────────────────────────────────────────────────────────

/**
 * Show the current examiner question.
 * @param {string} text
 * @param {'new_topic'|'followup'|null} [type]
 * @param {Object} [questionObj]
 */
export function showQuestion(text, type = null, questionObj = null) {
  const el = document.getElementById('question-text');
  const typeBadge = document.getElementById('question-type-badge');
  const sourceBadge = document.getElementById('question-source-badge');

  if (el) el.textContent = text;
  if (typeBadge) {
    if (type === 'followup') {
      typeBadge.textContent = 'Follow-up';
      typeBadge.hidden = false;
    } else if (type === 'new_topic') {
      typeBadge.textContent = 'New topic';
      typeBadge.hidden = false;
    } else {
      typeBadge.hidden = true;
    }
  }

  const source = (questionObj?.source || 'REPORT').toUpperCase();
  if (sourceBadge) {
    sourceBadge.textContent = source;
    sourceBadge.className = `source-badge source-badge--${source.toLowerCase()}`;
    sourceBadge.hidden = false;
  }

  // Developer Grounding Debug box
  const debugSource = document.getElementById('debug-source');
  const debugSec = document.getElementById('debug-section');
  const debugEv = document.getElementById('debug-evidence');
  const debugQ = document.getElementById('debug-question');

  if (debugSource) {
    debugSource.textContent = `SOURCE: ${source}`;
  }
  if (debugSec) {
    const title = questionObj?.section_title || (questionObj?.section_id ? `Section ${questionObj.section_id}` : '--');
    debugSec.textContent = `Section: ${title}`;
  }
  if (debugEv) {
    debugEv.textContent = questionObj?.evidence || '--';
  }
  if (debugQ) {
    debugQ.textContent = questionObj?.text || text || '--';
  }
}

// ── History panel ─────────────────────────────────────────────────────────────

const VERDICT_LABELS = {
  strong:  { text: 'Solid answer', cls: 'verdict--strong' },
  partial: { text: 'Partly there', cls: 'verdict--partial' },
  weak:    { text: 'Needs more detail', cls: 'verdict--weak' },
  skipped: { text: 'Skipped', cls: 'verdict--skipped' },
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

  if (!evaluation || !evaluation.verdict) {
    chip.hidden = true;
    return;
  }

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

// ── Nudge / Hint display ──────────────────────────────────────────────────────

export function showNudge(text) {
  const el = document.getElementById('nudge-text');
  const box = document.getElementById('nudge-box');
  if (el) el.textContent = text;
  if (box) box.hidden = false;
}

export function hideNudge() {
  const box = document.getElementById('nudge-box');
  if (box) box.hidden = true;
}

// ── Progress bar ──────────────────────────────────────────────────────────────

// ── Progress bar ──────────────────────────────────────────────────────────────

export function setProgress(current, total, level) {
  const counter = document.getElementById('question-counter');
  const levelBadge = document.getElementById('level-badge');
  if (counter) counter.textContent = `Question ${current} of ${total}`;
  if (levelBadge && level) {
    const levelLabel = level === 'defense' ? 'Project Defense' : (level.charAt(0).toUpperCase() + level.slice(1));
    levelBadge.textContent = levelLabel;
    levelBadge.className = `level-badge level-badge--${level}`;
  }
}

// ── Section list ──────────────────────────────────────────────────────────────

export function showSections(sections) {
  const container = document.getElementById('sections-preview');
  if (!container) return;
  container.innerHTML = `
    <p class="sections-label">Detected report sections</p>
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

export function showCodeFiles(files, totalFiles) {
  const container = document.getElementById('code-preview');
  if (!container) return;
  container.innerHTML = `
    <div class="code-files-preview">
      <span><strong>Source Code:</strong> ${totalFiles || files.length} file(s) indexed for cross-verification</span>
      <span>${files.slice(0, 3).map(f => escapeHtml(f.path)).join(', ')}${files.length > 3 ? '...' : ''}</span>
    </div>
  `;
  container.hidden = false;
}

export function hideCodeFiles() {
  const container = document.getElementById('code-preview');
  if (container) container.hidden = true;
}

// ── Feedback screen ───────────────────────────────────────────────────────────

export function showFeedback(data) {
  const screen = document.querySelector('[data-screen="feedback"]');
  if (!screen) return;

  const s = data.summary || {};
  const perQ = data.per_question || [];

  // Derive counts using status as mandated by Requirement 9
  const answeredCount = s.questions_answered ?? perQ.filter(t => t.status === 'answered').length;
  const skippedCount = s.questions_skipped ?? perQ.filter(t => t.status === 'skipped').length;
  const askedCount = s.questions_asked ?? perQ.length;

  // Build summary cards
  const summaryEl = screen.querySelector('#feedback-summary');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="summary-card">
        <span class="card-value">${askedCount}</span>
        <span class="card-label">Questions asked</span>
      </div>
      <div class="summary-card">
        <span class="card-value">${answeredCount}</span>
        <span class="card-label">Questions answered</span>
      </div>
      <div class="summary-card">
        <span class="card-value stat--skipped">${skippedCount}</span>
        <span class="card-label">Questions skipped</span>
      </div>
    `;
  }

  // Per-question list
  const perQEl = screen.querySelector('#feedback-per-question');
  if (perQEl) {
    perQEl.innerHTML = perQ.map((q, i) => {
      const isSkipped = q.status === 'skipped';
      const v = isSkipped ? VERDICT_LABELS.skipped : (VERDICT_LABELS[q.verdict] || VERDICT_LABELS.partial);
      const vCls = isSkipped ? 'verdict--skipped' : (q.verdict === 'strong' ? 'verdict--strong' : q.verdict === 'weak' ? 'verdict--weak' : 'verdict--partial');
      const src = (q.source || 'REPORT').toUpperCase();
      const srcCls = `source-badge--${src.toLowerCase()}`;
      return `
        <details class="perq-item ${isSkipped ? 'perq-item--skipped' : ''}">
          <summary class="perq-summary">
            <span class="perq-num">Q${i + 1}</span>
            <span class="source-badge ${srcCls}">${src}</span>
            <span class="perq-q">${escapeHtml(q.question)}</span>
            <span class="verdict-tag ${vCls}">${v.text}</span>
          </summary>
          <div class="perq-detail">
            <p class="perq-section">Section: ${escapeHtml(q.section)} &nbsp;&bull;&nbsp; Source: <strong>${src}</strong></p>
            ${isSkipped ? '<p class="perq-skipped-note"><em>Question was skipped (not answered).</em></p>' : ''}
            ${!isSkipped && q.covered && q.covered.length ? `<p class="perq-covered">Covered: ${q.covered.map(escapeHtml).join(', ')}</p>` : ''}
            ${!isSkipped && q.missed && q.missed.length ? `<p class="perq-missed">Could mention: ${q.missed.map(escapeHtml).join(', ')}</p>` : ''}
            ${q.unsupported_claim ? `<p class="perq-defense-claim"><strong>Unsupported claim flagged:</strong> ${escapeHtml(q.unsupported_claim)}</p>` : ''}
            ${q.undefended_decision ? `<p class="perq-defense-undefended"><strong>Undefended decision:</strong> ${escapeHtml(q.undefended_decision)}</p>` : ''}
          </div>
        </details>
      `;
    }).join('');
  }

  // Project Defense Weak Points
  const defenseEl = screen.querySelector('#feedback-defense-weak-points');
  const defenseContentEl = screen.querySelector('#defense-weak-points-content');
  if (defenseEl && data.project_defense_weak_points && data.project_defense_weak_points.length) {
    if (defenseContentEl) {
      defenseContentEl.innerHTML = `
        <ul>${data.project_defense_weak_points.map(pt => `<li>${escapeHtml(pt)}</li>`).join('')}</ul>
      `;
    }
    defenseEl.hidden = false;
  } else if (defenseEl) {
    defenseEl.hidden = true;
  }

  // Cross-Verification (Report vs Code)
  const cvEl = screen.querySelector('#feedback-cross-verification');
  const cvContentEl = screen.querySelector('#cross-verification-content');
  const cv = data.cross_verification;
  if (cvEl && cv && cv.has_code) {
    let cvHtml = '';
    if (cv.verified && cv.verified.length) {
      cvHtml += `
        <div class="cross-verif-group cross-verif-group--verified">
          <h3>Verified in Code (${cv.verified.length})</h3>
          <ul class="cross-verif-list">
            ${cv.verified.map(v => `
              <li class="cross-verif-item cross-verif-item--verified">
                <span class="cross-verif-tech">&#10003; ${escapeHtml(v.tech)}</span>
                <span class="cross-verif-detail">${escapeHtml(v.claim)} &bull; Implemented in <code>${escapeHtml(v.evidence_in_code)}</code></span>
              </li>
            `).join('')}
          </ul>
        </div>
      `;
    }
    if (cv.mismatches && cv.mismatches.length) {
      cvHtml += `
        <div class="cross-verif-group cross-verif-group--mismatches">
          <h3>Clarification Items / Mismatches (${cv.mismatches.length})</h3>
          <ul class="cross-verif-list">
            ${cv.mismatches.map(m => `
              <li class="cross-verif-item cross-verif-item--mismatch">
                <span class="cross-verif-tech">&#9888; ${escapeHtml(m.tech)}</span>
                <span class="cross-verif-detail">${escapeHtml(m.claim)} &bull; No corresponding code found</span>
                ${m.neutral_question ? `<span class="cross-verif-question">Clarification asked: "${escapeHtml(m.neutral_question)}"</span>` : ''}
              </li>
            `).join('')}
          </ul>
        </div>
      `;
    }
    if (cvContentEl) cvContentEl.innerHTML = cvHtml || '<p>No specific technology claims identified to cross-verify.</p>';
    cvEl.hidden = false;
  } else if (cvEl) {
    cvEl.hidden = true;
  }

  // Weak topics
  const weakEl = screen.querySelector('#feedback-weak-topics');
  if (weakEl && data.weak_topics && data.weak_topics.length) {
    weakEl.innerHTML = `
      <h3>Your weakest areas</h3>
      <ul>${data.weak_topics.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
    `;
    weakEl.hidden = false;
  } else if (weakEl) {
    weakEl.hidden = true;
  }

  // Suggestions
  const suggEl = screen.querySelector('#feedback-suggestions');
  if (suggEl && data.suggestions && data.suggestions.length) {
    suggEl.innerHTML = `
      <h3>Suggestions for next time</h3>
      <ol>${data.suggestions.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
    `;
    suggEl.hidden = false;
  } else if (suggEl) {
    suggEl.hidden = true;
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

// ── Utility ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
