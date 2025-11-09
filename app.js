const STORAGE_KEYS = {
  tasks: 'focus-flow.tasks',
  sessions: 'focus-flow.sessions',
  settings: 'focus-flow.settings'
};

const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
const timerVisual = document.querySelector('.timer-visual');
const countdownEl = document.querySelector('.timer-countdown');
const progressCircle = document.querySelector('.progress-ring__value');
const startButton = document.getElementById('start-button');
const pauseButton = document.getElementById('pause-button');
const resumeButton = document.getElementById('resume-button');
const resetButton = document.getElementById('reset-button');
const todoForm = document.getElementById('todo-form');
const todoInput = document.getElementById('todo-input');
const todoListEl = document.getElementById('todo-list');
const historyListEl = document.getElementById('history-list');
const historyEmptyEl = document.getElementById('history-empty');
const clearHistoryButton = document.getElementById('clear-history');
const historyTemplate = document.getElementById('history-item-template');

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

  pauseButton.addEventListener('click', () => timer.pause());
  resumeButton.addEventListener('click', () => timer.resume());
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
  const text = event.clipboardData?.getData('text') ?? '';
  const sanitized = sanitizeDurationInput(text);
  insertTextAtCursor(sanitized);
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
    const baseTitle = 'Focus Flow';
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

  const stateIsRunning = state === 'running';
  const stateIsPaused = state === 'paused';
  const stateIsComplete = state === 'complete';

  startButton.disabled = stateIsRunning || stateIsPaused;
  pauseButton.disabled = !stateIsRunning;
  resumeButton.disabled = !stateIsPaused;

  startButton.textContent = stateIsComplete ? 'Restart Focus' : 'Start Focus';

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
    removeButton.className = 'todo-remove';
    removeButton.textContent = 'Clear';
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

function insertTextAtCursor(text) {
  if (!text) return;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  selection.deleteFromDocument();
  const range = selection.getRangeAt(0);
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
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
