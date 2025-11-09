const STORAGE_KEYS = {
  tasks: 'pomotive.tasks',
  sessions: 'pomotive.sessions',
  settings: 'pomotive.settings'
};

const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
const timerVisual = document.querySelector('.timer-visual');
const countdownEl = document.querySelector('.timer-countdown');
const progressCircle = document.querySelector('.progress-ring__value');
const startButton = document.getElementById('start-button');
const togglePauseButton = document.getElementById('toggle-pause-button');
const resetButton = document.getElementById('reset-button');
const todoForm = document.getElementById('todo-form');
const todoInput = document.getElementById('todo-input');
const todoListEl = document.getElementById('todo-list');
const historyListEl = document.getElementById('history-list');
const historyEmptyEl = document.getElementById('history-empty');
const clearHistoryButton = document.getElementById('clear-history');
const historyTemplate = document.getElementById('history-item-template');
const focusMessageEl = document.querySelector('.timer-header .muted');
const APP_NAME = 'Pomotive';

const DEFAULT_FOCUS_MESSAGE = 'Dial in, breathe, and let the minutes work for you.';
const motivationalQuotes = [
  'Deep focus builds deep results.',
  'Small steps right now become big wins later.',
  'Stay with the work; momentum is here.',
  'You chose this task; own it fully.',
  'Progress loves consistency more than speed.',
  'Keep attention on the next useful move.',
  'Let distraction pass; stay with the signal.',
  'Patience plus effort equals progress.',
  'You are building future ease in present effort.',
  'Push through the quiet; clarity follows.',
  'The work in front of you matters most.',
  'Curiosity keeps your mind engaged; lean in.',
  'One focused block unlocks another.',
  'Aim for clean execution, not quick escape.',
  'Stay deliberate; the clock is on your side.',
  'You thrive when you show up with intention.',
  'Keep crafting; skill sharpens under pressure.',
  'Your future self is grateful for this minute.',
  'Hold steady; the solution is forming.',
  'Focus muscles grow with reps like this.',
  'Every keystroke is a brick in your vision.',
  'Right now is the only time you can shape.',
  'Stay present; momentum loves commitment.',
  'You are closer with every engaged breath.',
  'Quality emerges from sustained attention.',
  'Let the rhythm of work settle you.',
  'Discipline today writes easier tomorrows.',
  'Keep refining; calm effort compounds.',
  'Lean into the challenge; you adapt fast.',
  'Noise fades when purpose leads the way.',
  'Your craft improves under thoughtful focus.',
  'Stick with it; breakthroughs favor persistence.',
  'Attention is your most powerful tool; wield it.',
  'You are capable; prove it one minute at a time.',
  'Protect this block; it protects your goals.',
  'Deep work now creates creative space later.',
  'Keep eyes on the path, not the clock.',
  'The next insight is a breath away.',
  'Trust the process; iteration breeds mastery.',
  'Stay locked in; you are in the right place.',
  'Your effort is aligning opportunity.',
  'Let dedication outshine doubt.',
  'You are sculpting results with focus.',
  'Hold your attention; it sharpens every detail.',
  'Momentum rewards steady builders.',
  'Show up for the full session; you earn the break.',
  'Turn quiet concentration into visible progress.',
  'Commit to now; the rest can wait.',
  'Stay engaged; your work deserves it.',
  'Confidence grows where effort is invested.'
];
let lastMotivationalIndex = -1;
let activeFocusQuote = '';

function getRandomMotivationalQuote() {
  if (!motivationalQuotes.length) {
    return DEFAULT_FOCUS_MESSAGE;
  }
  let index = Math.floor(Math.random() * motivationalQuotes.length);
  if (motivationalQuotes.length > 1) {
    while (index === lastMotivationalIndex) {
      index = Math.floor(Math.random() * motivationalQuotes.length);
    }
  }
  lastMotivationalIndex = index;
  return motivationalQuotes[index];
}

const MIN_SESSION_SECONDS = 30;
const MAX_SESSION_SECONDS = 90 * 60;

const circleRadius = parseFloat(progressCircle.getAttribute('r'));
const circleCircumference = 2 * Math.PI * circleRadius;
progressCircle.style.strokeDasharray = `${circleCircumference}`;
progressCircle.style.strokeDashoffset = `${circleCircumference}`;

const datetimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
});

let tasks = loadFromStorage(STORAGE_KEYS.tasks, []);
let sessions = loadFromStorage(STORAGE_KEYS.sessions, []);
const settings = normalizeSettings(
  loadFromStorage(STORAGE_KEYS.settings, { lastDurationSeconds: 25 * 60 })
);

persistDurationSetting(settings.lastDurationSeconds);

const initialSeconds = clampDurationSeconds(settings.lastDurationSeconds);
let isCountdownEditing = false;
let countdownEditBackup = '';

class PomodoroTimer {
  constructor({ totalSeconds = 1500, onTick, onStateChange, onComplete } = {}) {
    this.totalSeconds = totalSeconds;
    this.totalMs = totalSeconds * 1000;
    this.state = 'idle';
    this.frameId = null;
    this.startedAt = null;
    this.startTimestamp = null;
    this.elapsedMsBase = 0;
    this.remainingSeconds = totalSeconds;
    this.onTick = onTick;
    this.onStateChange = onStateChange;
    this.onComplete = onComplete;
    this.handleFrame = this.handleFrame.bind(this);
  }

  configure(totalSeconds) {
    const clampedSeconds = clampDurationSeconds(totalSeconds);
    this.totalSeconds = clampedSeconds;
    this.totalMs = clampedSeconds * 1000;
    if (this.state === 'running' || this.state === 'paused') {
      return;
    }
    this.elapsedMsBase = 0;
    this.remainingSeconds = this.totalSeconds;
    this.emitTick();
  }

  start() {
    if (this.state !== 'idle' && this.state !== 'complete') return;
    this.cancelFrame();
    this.elapsedMsBase = 0;
    this.remainingSeconds = this.totalSeconds;
    this.startedAt = new Date();
    this.startTimestamp = performance.now();
    this.switchState('running');
    this.emitTick();
    this.frameId = requestAnimationFrame(this.handleFrame);
  }

  pause() {
    if (this.state !== 'running') return;
    this.updateElapsedFromNow();
    this.cancelFrame();
    this.switchState('paused');
    this.emitTick();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.startTimestamp = performance.now();
    this.switchState('running');
    this.emitTick();
    this.frameId = requestAnimationFrame(this.handleFrame);
  }

  reset() {
    this.cancelFrame();
    this.elapsedMsBase = 0;
    this.remainingSeconds = this.totalSeconds;
    this.startedAt = null;
    this.startTimestamp = null;
    this.switchState('idle');
    this.emitTick();
  }

  setDuration(totalSeconds) {
    const clamped = clampDurationSeconds(totalSeconds);
    this.totalSeconds = clamped;
    this.totalMs = clamped * 1000;
    if (this.state === 'idle' || this.state === 'complete') {
      this.elapsedMsBase = 0;
      this.remainingSeconds = this.totalSeconds;
      this.emitTick();
    } else if (this.state === 'paused') {
      this.elapsedMsBase = Math.min(this.totalMs, this.totalMs - this.remainingSeconds * 1000);
      this.remainingSeconds = Math.max(0, (this.totalMs - this.elapsedMsBase) / 1000);
      this.emitTick();
    } else if (this.state === 'running') {
      this.elapsedMsBase = Math.min(this.totalMs, this.totalMs - this.remainingSeconds * 1000);
    }
  }

  complete() {
    this.cancelFrame();
    this.elapsedMsBase = this.totalMs;
    this.remainingSeconds = 0;
    this.startTimestamp = null;
    const endedAt = new Date();
    this.switchState('complete');
    this.emitTick();
    if (typeof this.onComplete === 'function') {
      this.onComplete({
        startedAt: this.startedAt,
        endedAt,
        totalSeconds: this.totalSeconds
      });
    }
  }

  handleFrame(timestamp) {
    if (this.state !== 'running') return;
    this.updateElapsedFromTimestamp(timestamp);
    if (this.remainingSeconds <= 0) {
      this.complete();
      return;
    }
    this.emitTick();
    this.frameId = requestAnimationFrame(this.handleFrame);
  }

  updateElapsedFromTimestamp(timestamp) {
    if (this.startTimestamp == null) {
      this.startTimestamp = timestamp;
    }
    const elapsedSinceStart = timestamp - this.startTimestamp;
    const elapsedTotal = this.elapsedMsBase + elapsedSinceStart;
    const clampedElapsed = Math.min(this.totalMs, elapsedTotal);
    this.remainingSeconds = Math.max(0, (this.totalMs - clampedElapsed) / 1000);
  }

  updateElapsedFromNow() {
    if (this.startTimestamp == null) return;
    const now = performance.now();
    const elapsedSinceStart = now - this.startTimestamp;
    this.elapsedMsBase = Math.min(this.totalMs, this.elapsedMsBase + elapsedSinceStart);
    this.remainingSeconds = Math.max(0, (this.totalMs - this.elapsedMsBase) / 1000);
    this.startTimestamp = null;
  }

  cancelFrame() {
    if (this.frameId != null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  switchState(next) {
    if (this.state === next) return;
    this.state = next;
    if (typeof this.onStateChange === 'function') {
      this.onStateChange(next);
    }
  }

  emitTick() {
    if (typeof this.onTick === 'function') {
      this.onTick({
        remainingSeconds: this.remainingSeconds,
        totalSeconds: this.totalSeconds,
        state: this.state
      });
    }
  }
}

const timer = new PomodoroTimer({
  totalSeconds: initialSeconds,
  onTick: updateTimerDisplay,
  onStateChange: updateTimerState,
  onComplete: captureSession
});

timer.reset();
renderTodos();
renderHistory();
setupTabs();
setupControls();
setupTodoForm();
setupHistoryActions();
setupCountdownEditor();

function setupTabs() {
  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const targetId = button.dataset.tabTarget;
      if (!targetId) return;

      tabButtons.forEach((btn) => btn.classList.toggle('is-active', btn === button));
      tabPanels.forEach((panel) => {
        const shouldShow = panel.id === targetId;
        panel.hidden = !shouldShow;
        panel.classList.toggle('is-active', shouldShow);
      });

      if (targetId === 'history') {
        renderHistory();
      }
    });
  });
}

function setupControls() {
  startButton.addEventListener('click', () => {
    if (timer.state === 'idle' || timer.state === 'complete') {
      timer.start();
    }
  });

  togglePauseButton.addEventListener('click', () => {
    if (timer.state === 'running') {
      timer.pause();
    } else if (timer.state === 'paused') {
      timer.resume();
    }
  });
  resetButton.addEventListener('click', () => timer.reset());
}

function setupTodoForm() {
  todoForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = todoInput.value.trim();
    if (!text) return;

    const newTask = {
      id: createId(),
      text,
      done: false
    };

    tasks.unshift(newTask);
    persistStorage(STORAGE_KEYS.tasks, tasks);
    todoInput.value = '';
    renderTodos();
    todoInput.focus();
  });
}

function setupHistoryActions() {
  clearHistoryButton.addEventListener('click', () => {
    if (!sessions.length) return;
    const confirmed = confirm('Clear all recorded sessions?');
    if (!confirmed) return;
    sessions = [];
    persistStorage(STORAGE_KEYS.sessions, sessions);
    renderHistory();
  });
}

function setupCountdownEditor() {
  countdownEl.addEventListener('focus', handleCountdownFocus);
  countdownEl.addEventListener('blur', handleCountdownBlur);
  countdownEl.addEventListener('keydown', handleCountdownKeydown);
  countdownEl.addEventListener('beforeinput', handleCountdownBeforeInput);
  countdownEl.addEventListener('cut', handleCountdownCut);
  countdownEl.addEventListener('paste', handleCountdownPaste);
}

function handleCountdownFocus() {
  isCountdownEditing = true;
  countdownEditBackup = countdownEl.textContent?.trim() ?? '';
  countdownEl.dataset.editing = 'true';
  if (timer.state === 'running') {
    timer.pause();
  }
  requestAnimationFrame(() => selectCountdownText(countdownEl));
}

function handleCountdownBlur() {
  if (!isCountdownEditing) return;
  isCountdownEditing = false;
  countdownEl.dataset.editing = 'false';

  const parsedSeconds = parseDurationText(countdownEl.textContent ?? '');

  if (parsedSeconds == null) {
    countdownEl.textContent = formatClock(timer.totalSeconds);
    if (timer.state !== 'idle') {
      timer.reset();
    }
    return;
  }

  const nextSeconds = clampDurationSeconds(parsedSeconds);

  if (nextSeconds !== timer.totalSeconds) {
    timer.setDuration(nextSeconds);
    timer.reset();
    persistDurationSetting(nextSeconds);
  } else if (timer.state !== 'idle') {
    timer.reset();
  } else {
    countdownEl.textContent = formatClock(timer.totalSeconds);
  }
}

function handleCountdownKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    countdownEl.blur();
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    countdownEl.textContent = countdownEditBackup || formatClock(timer.totalSeconds);
    countdownEl.blur();
    return;
  }

  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  const allowedNavigationKeys = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Tab'];
  if (allowedNavigationKeys.includes(event.key)) {
    return;
  }

  if (event.key === ':') {
    const existing = countdownEl.textContent ?? '';
    if (existing.includes(':') || existing.trim().length === 0) {
      event.preventDefault();
      return;
    }
  }

  if (!/^[0-9:]$/.test(event.key)) {
    event.preventDefault();
  }
}

function handleCountdownPaste(event) {
  event.preventDefault();
  if (!isCountdownEditing) return;
  const text = event.clipboardData?.getData('text') ?? '';
  const sanitizedDigits = sanitizeDurationInput(text).replace(/[^0-9]/g, '');
  replaceCountdownDigitsAtSelection(sanitizedDigits);
}

function handleCountdownBeforeInput(event) {
  if (!isCountdownEditing) return;
  const selection = getCountdownSelectionRange();
  if (!selection) return;
  const digitRange = getCountdownDigitRange(selection);
  const isCollapsed = selection.start === selection.end;

  switch (event.inputType) {
    case 'insertText':
    case 'insertCompositionText': {
      const digits = event.data?.replace(/[^0-9]/g, '') ?? '';
      event.preventDefault();
      if (digits.length === 0) {
        return;
      }
      replaceCountdownDigits(digitRange, digits);
      break;
    }
    case 'deleteContentBackward': {
      event.preventDefault();
      if (isCollapsed && digitRange.start === 0) return;
      const start = Math.max(0, isCollapsed ? digitRange.start - 1 : digitRange.start);
      replaceCountdownDigits({ start, end: digitRange.end }, '');
      break;
    }
    case 'deleteContentForward': {
      event.preventDefault();
      if (isCollapsed && digitRange.start >= 4) return;
      const end = isCollapsed ? Math.min(4, digitRange.start + 1) : digitRange.end;
      replaceCountdownDigits({ start: digitRange.start, end }, '');
      break;
    }
    case 'deleteContent':
    case 'deleteByCut': {
      event.preventDefault();
      replaceCountdownDigits(digitRange, '');
      break;
    }
    case 'insertFromPaste':
    case 'insertReplacementText': {
      event.preventDefault();
      const clipboardData = event.clipboardData ?? null;
      const raw = clipboardData?.getData?.('text') ?? '';
      const digits = sanitizeDurationInput(raw).replace(/[^0-9]/g, '');
      replaceCountdownDigits(digitRange, digits);
      break;
    }
    default: {
      if (event.inputType.startsWith('insert')) {
        event.preventDefault();
      }
    }
  }
}

function handleCountdownCut(event) {
  if (!isCountdownEditing) return;
  event.preventDefault();
  const selection = getCountdownSelectionRange();
  if (!selection || selection.start === selection.end) return;
  const text = countdownEl.textContent ?? '';
  const selectedText = text.slice(selection.start, selection.end);
  if (event.clipboardData) {
    event.clipboardData.setData('text/plain', selectedText);
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(selectedText).catch(() => {});
  }
  replaceCountdownDigitsAtSelection('');
}

function replaceCountdownDigitsAtSelection(insertDigits) {
  const selection = getCountdownSelectionRange();
  if (!selection) return;
  const digitRange = getCountdownDigitRange(selection);
  replaceCountdownDigits(digitRange, insertDigits);
}

function getCountdownSelectionRange() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!countdownEl.contains(range.startContainer) || !countdownEl.contains(range.endContainer)) {
    return null;
  }
  const preRange = range.cloneRange();
  preRange.selectNodeContents(countdownEl);
  preRange.setEnd(range.startContainer, range.startOffset);
  const start = preRange.toString().length;
  const length = range.toString().length;
  return {
    start,
    end: start + length
  };
}

function getCountdownDigitRange(selection) {
  const text = countdownEl.textContent ?? '';
  const startDigits = text.slice(0, selection.start).replace(/\D/g, '').length;
  const endDigits = text.slice(0, selection.end).replace(/\D/g, '').length;
  return {
    start: Math.min(startDigits, 4),
    end: Math.min(endDigits, 4)
  };
}

function setCountdownCaretPosition(position) {
  countdownEl.normalize();
  const node = countdownEl.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) {
    return;
  }
  const clamped = Math.max(0, Math.min(position, node.textContent?.length ?? 0));
  const range = document.createRange();
  range.setStart(node, clamped);
  range.collapse(true);
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}

function getCountdownDigits() {
  const text = countdownEl.textContent ?? '';
  return text.replace(/\D/g, '').padEnd(4, '0').slice(0, 4);
}

function renderCountdownDigits(digits) {
  const normalized = digits.padEnd(4, '0').slice(0, 4);
  const next = `${normalized.slice(0, 2)}:${normalized.slice(2, 4)}`;
  if (countdownEl.textContent !== next) {
    countdownEl.textContent = next;
  }
}

function digitIndexToTextIndex(digitIndex) {
  const text = countdownEl.textContent ?? '';
  let digitsSeen = 0;
  for (let i = 0; i < text.length; i++) {
    if (/\d/.test(text[i])) {
      if (digitsSeen === digitIndex) {
        return i;
      }
      digitsSeen += 1;
    }
  }
  return text.length;
}

function replaceCountdownDigits(range, rawInsertDigits) {
  const digits = getCountdownDigits();
  const start = Math.max(0, Math.min(range.start, 4));
  const end = Math.max(start, Math.min(range.end, 4));
  const insertDigits = rawInsertDigits.replace(/[^0-9]/g, '');
  const combined = `${digits.slice(0, start)}${insertDigits}${digits.slice(end)}`;
  const nextDigits = combined.slice(0, 4).padEnd(4, '0');
  renderCountdownDigits(nextDigits);
  const caretDigitIndex = Math.min(start + insertDigits.length, 4);
  setCountdownCaretPosition(digitIndexToTextIndex(caretDigitIndex));
}

function updateTimerDisplay({ remainingSeconds, totalSeconds, state }) {
  const editing = isCountdownEditing;
  const safeRemaining = Math.max(0, remainingSeconds);
  const minutesValue = Math.floor(safeRemaining / 60);
  const secondsValue = Math.floor(safeRemaining % 60);
  const minutes = minutesValue.toString().padStart(2, '0');
  const seconds = secondsValue.toString().padStart(2, '0');
  const nextDisplay = `${minutes}:${seconds}`;
  if (!editing && countdownEl.textContent !== nextDisplay) {
    countdownEl.textContent = nextDisplay;
  }

  const total = Math.max(1, totalSeconds);
  const progress = total === 0 ? 0 : 1 - safeRemaining / total;
  setProgress(progress);

  if (!editing) {
    const baseTitle = APP_NAME;
    if (state === 'running') {
      const nextTitle = `${baseTitle} • ${minutes}:${seconds}`;
      if (document.title !== nextTitle) {
        document.title = nextTitle;
      }
    } else if (state === 'complete') {
      if (document.title !== `${baseTitle} • Done!`) {
        document.title = `${baseTitle} • Done!`;
      }
    } else if (document.title !== baseTitle) {
      document.title = baseTitle;
    }
  }
}

function updateTimerState(state) {
  timerVisual.dataset.state = state;
  document.body.dataset.timerState = state;

  const stateIsRunning = state === 'running';
  const stateIsPaused = state === 'paused';
  const stateIsComplete = state === 'complete';

  if (focusMessageEl) {
    if (stateIsRunning || stateIsPaused) {
      if (!activeFocusQuote) {
        activeFocusQuote = getRandomMotivationalQuote();
      }
      focusMessageEl.textContent = activeFocusQuote;
    } else {
      activeFocusQuote = '';
      focusMessageEl.textContent = DEFAULT_FOCUS_MESSAGE;
    }
  }

  startButton.disabled = stateIsRunning || stateIsPaused;
  togglePauseButton.disabled = !(stateIsRunning || stateIsPaused);

  const startLabel = stateIsComplete ? 'Restart Focus' : 'Start Focus';
  const startMode = stateIsComplete ? 'restart' : 'start';
  startButton.dataset.mode = startMode;
  startButton.setAttribute('aria-label', startLabel);
  startButton.setAttribute('title', startLabel);
  const startSrOnly = startButton.querySelector('.sr-only');
  if (startSrOnly) {
    startSrOnly.textContent = startLabel;
  }

  const toggleMode = stateIsPaused ? 'resume' : 'pause';
  const toggleLabel = stateIsPaused ? 'Resume Focus' : 'Pause Focus';
  togglePauseButton.dataset.mode = toggleMode;
  togglePauseButton.setAttribute('aria-label', toggleLabel);
  togglePauseButton.setAttribute('title', toggleLabel);
  const toggleSrOnly = togglePauseButton.querySelector('.sr-only');
  if (toggleSrOnly) {
    toggleSrOnly.textContent = toggleLabel;
  }

  if (state === 'idle') {
    setProgress(0);
  }
}

function setProgress(value) {
  const clamped = Math.min(1, Math.max(0, value));
  const offset = circleCircumference * (1 - clamped);
  progressCircle.style.strokeDashoffset = `${offset}`;
}

function renderTodos() {
  todoListEl.innerHTML = '';

  if (!tasks.length) {
    const placeholder = document.createElement('li');
    placeholder.className = 'todo-placeholder muted';
    placeholder.textContent = 'Add a few tasks you want to stay focused on.';
    todoListEl.appendChild(placeholder);
    return;
  }

  tasks.forEach((task) => {
    const listItem = document.createElement('li');
    listItem.className = 'todo-item';
    listItem.dataset.id = task.id;
    listItem.dataset.complete = 'false';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `task-${task.id}`;
    checkbox.checked = task.done;
    checkbox.addEventListener('change', () => toggleTask(task.id, checkbox.checked));

    const label = document.createElement('label');
    label.setAttribute('for', checkbox.id);
    label.textContent = task.text;

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'todo-remove icon-button';
    removeButton.setAttribute('aria-label', `Remove task "${task.text}"`);
    removeButton.setAttribute('title', 'Remove task');
    removeButton.innerHTML = `
      <svg class="icon icon-close" aria-hidden="true" viewBox="0 0 24 24">
        <path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
      </svg>
      <span class="sr-only">Remove task</span>
    `;
    removeButton.addEventListener('click', () => removeTask(task.id));

    listItem.append(checkbox, label, removeButton);
    todoListEl.appendChild(listItem);

    if (task.done) {
      requestAnimationFrame(() => {
        listItem.dataset.complete = 'true';
      });
    } else {
      listItem.dataset.complete = 'false';
    }
  });
}

function toggleTask(taskId, done) {
  tasks = tasks.map((task) =>
    task.id === taskId ? { ...task, done } : task
  );
  persistStorage(STORAGE_KEYS.tasks, tasks);
  renderTodos();
}

function removeTask(taskId) {
  tasks = tasks.filter((task) => task.id !== taskId);
  persistStorage(STORAGE_KEYS.tasks, tasks);
  renderTodos();
}

function captureSession(sessionMeta) {
  const snapshot = tasks.map(({ id, text, done }) => ({ id, text, done }));
  const completedCount = snapshot.filter((task) => task.done).length;

  const sessionRecord = {
    id: createId(),
    startedAt: sessionMeta.startedAt,
    endedAt: sessionMeta.endedAt,
    totalSeconds: sessionMeta.totalSeconds,
    tasks: snapshot,
    completedCount,
    totalTasks: snapshot.length
  };

  sessions.unshift(sessionRecord);
  persistStorage(STORAGE_KEYS.sessions, sessions);
  renderHistory();
}

function renderHistory() {
  historyListEl.innerHTML = '';

  if (!sessions.length) {
    historyEmptyEl.hidden = false;
    historyListEl.hidden = true;
    return;
  }

  historyEmptyEl.hidden = true;
  historyListEl.hidden = false;

  sessions.forEach((session) => {
    const entry = historyTemplate.content.cloneNode(true);
    const root = entry.querySelector('.history-item');
    const timeEl = entry.querySelector('.history-time');
    const durationEl = entry.querySelector('.history-duration');
    const tasksEl = entry.querySelector('.history-tasks');

    const started = new Date(session.startedAt);
    const ended = new Date(session.endedAt);
    timeEl.textContent = `${datetimeFormatter.format(started)} – ${datetimeFormatter.format(ended)}`;

    durationEl.textContent = formatDuration(session.totalSeconds);

    if (!session.tasks.length) {
      const meta = document.createElement('span');
      meta.className = 'muted';
      meta.textContent = 'No tasks captured this round.';
      tasksEl.appendChild(meta);
    } else {
      const summary = document.createElement('p');
      summary.className = 'muted';
      summary.textContent = `${session.completedCount} of ${session.totalTasks} tasks checked off.`;
      tasksEl.appendChild(summary);

      session.tasks.forEach((task) => {
        const item = document.createElement('div');
        item.className = 'history-task';
        item.dataset.complete = String(task.done);
        item.textContent = task.text;
        tasksEl.appendChild(item);
      });
    }

    historyListEl.appendChild(entry);
  });
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) {
    return `${minutes} min`;
  }
  return `${minutes}m ${remainingSeconds}s`;
}

function loadFromStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`Unable to load ${key}`, error);
    return fallback;
  }
}

function persistStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Unable to persist ${key}`, error);
  }
}

function normalizeSettings(rawSettings) {
  const normalized = { ...rawSettings };

  if (typeof normalized.lastDurationSeconds !== 'number') {
    if (typeof normalized.lastDurationMinutes === 'number') {
      normalized.lastDurationSeconds = normalized.lastDurationMinutes * 60;
    } else {
      normalized.lastDurationSeconds = 25 * 60;
    }
  }

  normalized.lastDurationSeconds = clampDurationSeconds(normalized.lastDurationSeconds);
  delete normalized.lastDurationMinutes;

  return normalized;
}

function clampDurationSeconds(seconds) {
  if (!Number.isFinite(seconds)) {
    return 25 * 60;
  }
  const rounded = Math.round(seconds);
  return Math.min(MAX_SESSION_SECONDS, Math.max(MIN_SESSION_SECONDS, rounded));
}

function formatClock(totalSeconds) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (safeSeconds % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function sanitizeDurationInput(text) {
  let cleaned = '';
  let colonUsed = false;
  for (const char of text) {
    if (/[0-9]/.test(char)) {
      cleaned += char;
      continue;
    }
    if (char === ':' && !colonUsed && cleaned.length > 0) {
      cleaned += ':';
      colonUsed = true;
    }
  }
  return cleaned.slice(0, 5);
}

function parseDurationText(text) {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const sanitized = trimmed.replace(/[^0-9:]/g, '');
  if (!sanitized) return null;

  if (sanitized.includes(':')) {
    const [minutePart, secondPart = '0'] = sanitized.split(':');
    if (minutePart === '') return null;
    const minutes = parseInt(minutePart, 10);
    const secondsFragment = secondPart.substring(0, 2);
    const seconds = secondsFragment === '' ? 0 : parseInt(secondsFragment, 10);
    if (Number.isNaN(minutes) || Number.isNaN(seconds)) return null;
    return minutes * 60 + Math.min(59, Math.max(0, seconds));
  }

  const minutesOnly = parseInt(sanitized, 10);
  if (Number.isNaN(minutesOnly)) return null;
  return minutesOnly * 60;
}

function selectCountdownText(element) {
  if (!element) return;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function persistDurationSetting(seconds) {
  settings.lastDurationSeconds = clampDurationSeconds(seconds);
  persistStorage(STORAGE_KEYS.settings, settings);
}

function createId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}
