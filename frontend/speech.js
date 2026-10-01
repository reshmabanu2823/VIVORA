/**
 * speech.js — Web Speech API wrapper for VIVORA.
 *
 * Exports:
 *   isVoiceAvailable()          -> boolean
 *   speak(text, { onEnd })      -> void  (TTS: examiner speaks)
 *   stopSpeaking()              -> void
 *   startListening({ onInterim, onFinal, onSpeechStart, onEnd, onError }) -> void
 *   stopListening()             -> void
 *   checkMicPermission()        -> Promise<boolean>
 *   getMicLevel(onLevel)        -> Promise<() => void>  (returns a stop fn)
 */

// ── TTS config ────────────────────────────────────────────────────────────────
const TTS_RATE = 0.95;   // slightly slower than default; adjust here
const TTS_LANG = 'en-IN';

// ── STT config ────────────────────────────────────────────────────────────────
const STT_LANG = 'en-IN';

// ── Capability detection ──────────────────────────────────────────────────────
const _hasTTS = typeof speechSynthesis !== 'undefined';
const _SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;

/**
 * Returns true if speech recognition is available in this browser.
 */
export function isVoiceAvailable() {
  return Boolean(_SpeechRecognition);
}

// ── TTS ───────────────────────────────────────────────────────────────────────

let _currentUtterance = null;

/**
 * Speak text using the browser TTS.
 * @param {string} text
 * @param {{ onEnd?: () => void, onError?: (e: Event) => void }} callbacks
 */
export function speak(text, { onEnd = () => {}, onError = () => {} } = {}) {
  if (!_hasTTS) { onEnd(); return; }

  stopSpeaking();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = TTS_LANG;
  utterance.rate = TTS_RATE;

  // Pick an English voice — prefer a natural-sounding one
  const voices = speechSynthesis.getVoices();
  const preferred = voices.find(v => v.lang.startsWith('en') && !v.localService === false)
    || voices.find(v => v.lang.startsWith('en'))
    || null;
  if (preferred) utterance.voice = preferred;

  utterance.onend = () => { _currentUtterance = null; onEnd(); };
  utterance.onerror = (e) => {
    // 'interrupted' is expected when we call cancel(); don't treat as error
    _currentUtterance = null;
    if (e.error !== 'interrupted' && e.error !== 'canceled') onError(e);
    else onEnd();
  };

  _currentUtterance = utterance;
  speechSynthesis.speak(utterance);
}

/**
 * Stop any ongoing speech synthesis immediately.
 */
export function stopSpeaking() {
  if (_hasTTS && speechSynthesis.speaking) {
    speechSynthesis.cancel();
  }
  _currentUtterance = null;
}

// Chrome bug: voices list loads asynchronously. Trigger a load so the list
// is available when we first call speak().
if (_hasTTS) {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener('voiceschanged', () => speechSynthesis.getVoices());
}

// ── STT ───────────────────────────────────────────────────────────────────────

let _recognition = null;
let _recognitionRunning = false;
let _shouldRestart = false;   // whether we want continuous listening (Chrome auto-stops)
let _pendingCallbacks = null;

/**
 * Start listening for student speech.
 * @param {{
 *   onInterim: (text: string) => void,
 *   onFinal: (text: string) => void,
 *   onSpeechStart: () => void,
 *   onEnd: () => void,
 *   onError: (error: string) => void,
 * }} callbacks
 */
export function startListening({ onInterim, onFinal, onSpeechStart, onEnd, onError } = {}) {
  if (!_SpeechRecognition) {
    onError && onError('unsupported');
    return;
  }

  _shouldRestart = true;
  _pendingCallbacks = { onInterim, onFinal, onSpeechStart, onEnd, onError };
  _startRecognitionInternal();
}

function _startRecognitionInternal() {
  if (!_SpeechRecognition || _recognitionRunning) return;

  const { onInterim, onFinal, onSpeechStart, onEnd, onError } = _pendingCallbacks || {};

  const rec = new _SpeechRecognition();
  rec.lang = STT_LANG;
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onspeechstart = () => { onSpeechStart && onSpeechStart(); };

  rec.onresult = (event) => {
    let interim = '';
    let finalChunk = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalChunk += text;
      else interim += text;
    }
    if (interim) onInterim && onInterim(interim);
    if (finalChunk) onFinal && onFinal(finalChunk);
  };

  rec.onend = () => {
    _recognitionRunning = false;
    _recognition = null;
    // Chrome stops recognition after silence — restart it if we still want to listen
    if (_shouldRestart) {
      setTimeout(_startRecognitionInternal, 150);
    } else {
      onEnd && onEnd();
    }
  };

  rec.onerror = (event) => {
    const ignorable = ['no-speech', 'aborted'];
    if (ignorable.includes(event.error)) return;
    _shouldRestart = false;
    _recognitionRunning = false;
    _recognition = null;
    onError && onError(event.error);
  };

  try {
    rec.start();
    _recognition = rec;
    _recognitionRunning = true;
  } catch (e) {
    // Already started — ignore
  }
}

/**
 * Stop listening. Safe to call even if not listening.
 */
export function stopListening() {
  _shouldRestart = false;
  _recognitionRunning = false;
  if (_recognition) {
    try { _recognition.stop(); } catch (_) {}
    _recognition = null;
  }
  _pendingCallbacks = null;
}

// ── Mic permission check ──────────────────────────────────────────────────────

/**
 * Requests mic access and resolves to true/false.
 * @returns {Promise<boolean>}
 */
export async function checkMicPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    return true;
  } catch (_) {
    return false;
  }
}

// ── Mic level meter ───────────────────────────────────────────────────────────

/**
 * Starts a mic level meter. Calls onLevel(0–1) ~60x/sec.
 * @param {(level: number) => void} onLevel
 * @returns {Promise<() => void>} resolves to a stop function
 */
export async function getMicLevel(onLevel) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (_) {
    return () => {};
  }

  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  let rafId;
  let stopped = false;

  function tick() {
    if (stopped) return;
    analyser.getByteFrequencyData(data);
    const sum = data.reduce((a, b) => a + b, 0);
    const avg = sum / data.length;
    onLevel(Math.min(avg / 128, 1));
    rafId = requestAnimationFrame(tick);
  }
  tick();

  return function stop() {
    stopped = true;
    cancelAnimationFrame(rafId);
    stream.getTracks().forEach(t => t.stop());
    ctx.close();
    onLevel(0);
  };
}
