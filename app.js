/* global crypto */
(() => {
  const STORAGE_KEYS = {
    authToken: 'll_access_token'
  };
  const MEMORY_ONLY = new URLSearchParams(window.location.search).has('memory');
  const API_BASE = resolveApiBase();

  const SUPPORTED_TYPES = new Set([
    'multiple_choice',
    'multiple_select',
    'fill_in',
    'cloze',
    'dictation',
    'read_answer',
    'translate',
    'speaking',
    'flashcards'
  ]);

  const state = {
    lessons: [],
    attempts: [],
    authToken: '',
    tokenMeta: null,
    eventsBound: false,
    currentLesson: null,
    currentAttempt: null,
    currentTasks: [],
    currentTaskIndex: 0,
    mode: 'practice',
    paused: false,
    pauseStartedAt: null,
    pausedMs: 0,
    currentAnswerProvider: null
  };

  const elements = {
    appRoot: document.querySelector('.app'),
    authGate: document.getElementById('auth-gate'),
    authForm: document.getElementById('auth-form'),
    authTokenInput: document.getElementById('auth-token-input'),
    authError: document.getElementById('auth-error'),
    authUser: document.getElementById('auth-user'),
    authLogout: document.getElementById('auth-logout'),
    navButtons: document.querySelectorAll('.nav-btn'),
    views: document.querySelectorAll('.view'),
    storageStatus: document.getElementById('storage-status'),
    lessonJsonInput: document.getElementById('lesson-json-input'),
    importLessonTextBtn: document.getElementById('import-lesson-text'),
    copyLessonFormatBtn: document.getElementById('copy-lesson-format'),
    lessonImportErrors: document.getElementById('lesson-import-errors'),
    lessonImportStatus: document.getElementById('lesson-import-status'),
    lessonSearch: document.getElementById('lesson-search'),
    lessonLanguageFilter: document.getElementById('lesson-language-filter'),
    lessonList: document.getElementById('lesson-list'),
    playerLessonTitle: document.getElementById('player-lesson-title'),
    playerLessonMeta: document.getElementById('player-lesson-meta'),
    taskContainer: document.getElementById('task-container'),
    taskNav: document.getElementById('task-nav'),
    taskFeedback: document.getElementById('task-feedback'),
    progressBar: document.getElementById('progress-bar'),
    pauseToggle: document.getElementById('pause-toggle'),
    exitLesson: document.getElementById('exit-lesson'),
    prevTask: document.getElementById('prev-task'),
    nextTask: document.getElementById('next-task'),
    skipTask: document.getElementById('skip-task'),
    checkTask: document.getElementById('check-task'),
    finishLesson: document.getElementById('finish-lesson'),
    resultSummary: document.getElementById('result-summary'),
    resultDetails: document.getElementById('result-details'),
    reviewAttempt: document.getElementById('review-attempt'),
    repeatWrong: document.getElementById('repeat-wrong'),
    exportAttempt: document.getElementById('export-attempt'),
    historyLanguage: document.getElementById('history-language'),
    historyLesson: document.getElementById('history-lesson'),
    historyTag: document.getElementById('history-tag'),
    historyLevel: document.getElementById('history-level'),
    historyMode: document.getElementById('history-mode'),
    historyDateFrom: document.getElementById('history-date-from'),
    historyDateTo: document.getElementById('history-date-to'),
    historySort: document.getElementById('history-sort'),
    historyList: document.getElementById('history-list'),
    exportHistory: document.getElementById('export-history'),
    exportReport: document.getElementById('export-report'),
    importHistory: document.getElementById('import-history'),
    historyFile: document.getElementById('history-file'),
    lessonAnalytics: document.getElementById('lesson-analytics'),
    languageAnalytics: document.getElementById('language-analytics'),
    weaknessAnalytics: document.getElementById('weakness-analytics'),
    storageBreakdown: document.getElementById('storage-breakdown'),
    exportAll: document.getElementById('export-all'),
    resetAll: document.getElementById('reset-all')
  };

  const lessonCardTemplate = document.getElementById('lesson-card-template');
  const historyCardTemplate = document.getElementById('history-card-template');

  const app = {
    async init() {
      lockApp('Enter your access token.');
      bindAuthEvents();
      const savedToken = localStorage.getItem(STORAGE_KEYS.authToken);
      if (!savedToken) {
        return;
      }
      await signInWithToken(savedToken, true);
    },
    async startAuthorized() {
      await loadData();
      if (!state.eventsBound) {
        bindEvents();
        state.eventsBound = true;
      }
      renderAll();
      unlockApp();
    }
  };

  async function loadData() {
    if (MEMORY_ONLY) {
      state.lessons = [];
    } else {
      state.lessons = await fetchLessons();
    }
    state.attempts = await fetchAttempts();
    updateStorageStatus();
  }

  async function saveLessons(options = {}) {
    if (MEMORY_ONLY) {
      updateStorageStatus();
      return;
    }
    const lessons = [];
    if (options.lesson) {
      lessons.push(options.lesson);
    }
    if (Array.isArray(options.lessons) && options.lessons.length) {
      lessons.push(...options.lessons);
    }
    if (!lessons.length) {
      return;
    }
    await apiRequest('/api/lessons/bulk', {
      method: 'POST',
      body: { lessons }
    });
    updateStorageStatus();
  }

  async function saveAttempts(options = {}) {
    const attempts = [];
    if (options.attempt) {
      attempts.push(options.attempt);
    }
    if (Array.isArray(options.attempts) && options.attempts.length) {
      attempts.push(...options.attempts);
    }
    if (!attempts.length) {
      return;
    }
    await apiRequest('/api/attempts/bulk', {
      method: 'POST',
      body: { attempts }
    });
    updateStorageStatus();
  }

  function updateStorageStatus() {
    const lessonSize = estimateSize(state.lessons);
    const tokenLabel = state.tokenMeta?.tokenHint || maskToken(state.authToken) || 'no token';
    const lessonPart = MEMORY_ONLY
      ? `lessons in memory (${state.lessons.length})`
      : `lessons in token DB ${formatBytes(lessonSize)} (${state.lessons.length})`;
    elements.storageStatus.textContent = `Token ${tokenLabel}. Attempts synced to server: ${state.attempts.length}.`;
    elements.storageBreakdown.textContent = `${lessonPart}. Attempts in DB: ${state.attempts.length}`;
  }

  function estimateSize(value) {
    try {
      return new Blob([JSON.stringify(value)]).size;
    } catch (error) {
      return 0;
    }
  }

  function bindAuthEvents() {
    elements.authForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const token = elements.authTokenInput.value.trim();
      if (!token) {
        lockApp('Token is required.');
        return;
      }
      await signInWithToken(token, false);
    });

    elements.authLogout.addEventListener('click', () => {
      localStorage.removeItem(STORAGE_KEYS.authToken);
      state.authToken = '';
      state.tokenMeta = null;
      state.attempts = [];
      state.lessons = [];
      lockApp('Session ended. Enter token to continue.');
    });
  }

  async function signInWithToken(token, silent) {
    try {
      const payload = await requestJSON('/api/auth/validate', {
        method: 'POST',
        body: { token },
        skipAuth: true
      });

      state.authToken = token;
      state.tokenMeta = {
        tokenHint: payload.tokenHint || maskToken(token),
        label: payload.label || ''
      };
      localStorage.setItem(STORAGE_KEYS.authToken, token);
      elements.authUser.textContent = state.tokenMeta.label
        ? `${state.tokenMeta.label} (${state.tokenMeta.tokenHint})`
        : state.tokenMeta.tokenHint;
      await app.startAuthorized();
    } catch (error) {
      if (!silent) {
        lockApp(error.message || 'Token validation failed.');
      } else {
        lockApp('Saved token is invalid. Enter a valid token.');
      }
      localStorage.removeItem(STORAGE_KEYS.authToken);
      state.authToken = '';
      state.tokenMeta = null;
    }
  }

  function lockApp(message) {
    elements.appRoot.hidden = true;
    elements.authGate.classList.remove('hidden');
    elements.authError.textContent = message || '';
    elements.authUser.textContent = 'Not authorized';
    setTimeout(() => elements.authTokenInput.focus(), 0);
    updateStorageStatusSafe();
  }

  function unlockApp() {
    elements.authGate.classList.add('hidden');
    elements.authError.textContent = '';
    elements.authTokenInput.value = '';
    elements.appRoot.hidden = false;
    updateStorageStatusSafe();
  }

  function updateStorageStatusSafe() {
    if (!state.authToken) {
      elements.storageStatus.textContent = 'Authorization required.';
      elements.storageBreakdown.textContent = 'Lessons: 0, Attempts: 0';
      return;
    }
    updateStorageStatus();
  }

  function maskToken(token) {
    if (!token) return '';
    if (token.length <= 8) return token;
    return `${token.slice(0, 4)}...${token.slice(-4)}`;
  }

  async function fetchLessons() {
    const payload = await apiRequest('/api/lessons', { method: 'GET' });
    return Array.isArray(payload.lessons) ? payload.lessons : [];
  }

  async function fetchAttempts() {
    const payload = await apiRequest('/api/attempts', { method: 'GET' });
    return Array.isArray(payload.attempts) ? payload.attempts : [];
  }

  async function clearLessons() {
    await apiRequest('/api/lessons', { method: 'DELETE' });
  }

  async function clearAttempts() {
    await apiRequest('/api/attempts', { method: 'DELETE' });
  }

  async function apiRequest(path, options = {}) {
    return requestJSON(path, options);
  }

  async function requestJSON(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    if (!options.skipAuth) {
      headers['X-Access-Token'] = state.authToken;
    }

    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    } catch (error) {
      const base = API_BASE || window.location.origin;
      throw new Error(`API unreachable at ${base}. Start server with \"npm start\".`);
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload.error || `Request failed (${response.status})`;
      if (response.status === 401 && !options.skipAuth) {
        localStorage.removeItem(STORAGE_KEYS.authToken);
        lockApp('Access denied. Enter a valid token.');
      }
      throw new Error(message);
    }

    return payload;
  }

  function bindEvents() {
    elements.navButtons.forEach((btn) => {
      btn.addEventListener('click', () => showView(btn.dataset.view));
    });

    elements.importLessonTextBtn.addEventListener('click', () => handleImportLessonText());
    elements.lessonJsonInput.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        handleImportLessonText();
      }
    });
    elements.copyLessonFormatBtn.addEventListener('click', copyLessonFormatToClipboard);
    elements.lessonSearch.addEventListener('input', renderLessonList);
    elements.lessonLanguageFilter.addEventListener('change', renderLessonList);

    elements.pauseToggle.addEventListener('click', togglePause);
    elements.exitLesson.addEventListener('click', exitLesson);
    elements.prevTask.addEventListener('click', () => changeTask(-1));
    elements.nextTask.addEventListener('click', () => changeTask(1));
    elements.skipTask.addEventListener('click', skipCurrentTask);
    elements.checkTask.addEventListener('click', () => checkCurrentTask(true));
    elements.finishLesson.addEventListener('click', finalizeAttempt);

    elements.reviewAttempt.addEventListener('click', () => {
      if (state.currentAttempt) {
        renderResults(state.currentAttempt);
        showView('results');
      }
    });
    elements.repeatWrong.addEventListener('click', repeatWrongOnly);
    elements.exportAttempt.addEventListener('click', () => {
      if (state.currentAttempt) {
        downloadJSON(state.currentAttempt, `attempt-${state.currentAttempt.attemptId}.json`);
      }
    });

    [
      elements.historyLanguage,
      elements.historyLesson,
      elements.historyTag,
      elements.historyLevel,
      elements.historyMode,
      elements.historyDateFrom,
      elements.historyDateTo,
      elements.historySort
    ].forEach((el) => el.addEventListener('change', renderHistoryList));

    elements.exportHistory.addEventListener('click', exportFilteredHistory);
    elements.exportReport.addEventListener('click', exportLessonReport);
    elements.importHistory.addEventListener('click', () => elements.historyFile.click());
    elements.historyFile.addEventListener('change', handleImportHistory);

    elements.exportAll.addEventListener('click', exportAllData);
    elements.resetAll.addEventListener('click', resetAllData);
  }

  function renderAll() {
    renderLessonList();
    renderHistoryFilters();
    renderHistoryList();
    renderAnalytics();
  }

  function showView(viewId) {
    elements.views.forEach((view) => {
      view.classList.toggle('active', view.id === `view-${viewId}`);
    });
    elements.navButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === viewId);
    });
  }

  async function handleImportLessonText() {
    elements.lessonImportErrors.textContent = '';
    elements.lessonImportStatus.textContent = '';

    const rawText = elements.lessonJsonInput.value.trim();
    if (!rawText) {
      elements.lessonImportErrors.textContent = 'Paste lesson JSON text first.';
      return;
    }

    try {
      const jsonText = extractJsonFromText(rawText);
      const parsed = JSON.parse(jsonText);
      const { errors, lesson } = validateLesson(parsed);

      if (errors.length) {
        elements.lessonImportErrors.textContent = errors.join('\n');
        return;
      }

      const conflictPolicy = document.querySelector('input[name="conflict"]:checked')?.value || 'replace';
      const existingIndex = state.lessons.findIndex((item) => item.lessonId === lesson.lessonId);

      if (existingIndex !== -1 && conflictPolicy === 'duplicate') {
        lesson.lessonId = `${lesson.lessonId}-${Date.now()}`;
        lesson.title = `${lesson.title} (copy)`;
      }

      if (existingIndex !== -1 && conflictPolicy === 'replace') {
        state.lessons[existingIndex] = lesson;
      } else if (existingIndex === -1 || conflictPolicy === 'duplicate') {
        state.lessons.push(lesson);
      }

      await saveLessons({ lesson });
      renderLessonList();
      renderHistoryFilters();
      renderAnalytics();
      elements.lessonImportStatus.textContent = `Imported lesson ${lesson.title}.`;
      elements.lessonJsonInput.value = '';
    } catch (error) {
      elements.lessonImportErrors.textContent = `Invalid JSON: ${error.message}`;
    }
  }

  async function copyLessonFormatToClipboard() {
    elements.lessonImportErrors.textContent = '';
    try {
      const payload = await apiRequest('/api/lesson-format', { method: 'GET' });
      const text = payload.text || '';
      await copyText(text);
      elements.lessonImportStatus.textContent = 'LESSON_FORMAT.md скопирован. Передай его нейросети с темой урока и вставь полученный JSON сюда.';
    } catch (error) {
      elements.lessonImportErrors.textContent = `Failed to copy template: ${error.message}`;
    }
  }

  function validateLesson(rawLesson) {
    const errors = [];
    if (!rawLesson || typeof rawLesson !== 'object') {
      return { errors: ['Lesson JSON must be an object.'], lesson: null };
    }

    const lesson = structuredCloneSafe(rawLesson);

    if (!lesson.lessonId || typeof lesson.lessonId !== 'string') {
      errors.push('lessonId is required and must be a string.');
    }
    if (!lesson.title || typeof lesson.title !== 'string') {
      errors.push('title is required and must be a string.');
    }
    if (!lesson.languageId || typeof lesson.languageId !== 'string') {
      errors.push('languageId is required and must be a string.');
    }
    if (lesson.tags && !Array.isArray(lesson.tags)) {
      errors.push('tags must be an array of strings.');
    }
    if (!Array.isArray(lesson.tasks) || !lesson.tasks.length) {
      errors.push('tasks must be a non-empty array.');
    }

    const taskIds = new Set();
    (lesson.tasks || []).forEach((task, index) => {
      if (!task || typeof task !== 'object') {
        errors.push(`task[${index}] must be an object.`);
        return;
      }

      if (!task.taskId || typeof task.taskId !== 'string') {
        errors.push(`task[${index}].taskId is required and must be a string.`);
      } else if (taskIds.has(task.taskId)) {
        errors.push(`taskId "${task.taskId}" is duplicated.`);
      } else {
        taskIds.add(task.taskId);
      }

      task.type = normalizeTaskType(task.type);
      if (!SUPPORTED_TYPES.has(task.type)) {
        errors.push(`task[${index}].type "${task.type}" is not supported.`);
      }

      if (!task.prompt || typeof task.prompt !== 'string') {
        errors.push(`task[${index}].prompt is required and must be a string.`);
      }

      if (task.points !== undefined && typeof task.points !== 'number') {
        errors.push(`task[${index}].points must be a number.`);
      }

      if (!task.data || typeof task.data !== 'object') {
        errors.push(`task[${index}].data is required.`);
      } else {
        validateTaskData(task, index, errors);
      }

      task.points = typeof task.points === 'number' ? task.points : 1;
      task.tags = Array.isArray(task.tags) ? task.tags : [];
    });

    lesson.tags = Array.isArray(lesson.tags) ? lesson.tags : [];

    return { errors, lesson };
  }

  function validateTaskData(task, index, errors) {
    const data = task.data;
    switch (task.type) {
      case 'multiple_choice':
      case 'multiple_select':
        if (!Array.isArray(data.options) || !data.options.length) {
          errors.push(`task[${index}].data.options must be a non-empty array.`);
        }
        if (data.correct === undefined) {
          errors.push(`task[${index}].data.correct is required.`);
        }
        break;
      case 'fill_in':
        if (data.answers === undefined) {
          errors.push(`task[${index}].data.answers is required.`);
        }
        break;
      case 'cloze':
        if (typeof data.text !== 'string') {
          errors.push(`task[${index}].data.text must be a string.`);
        }
        if (!Array.isArray(data.blanks)) {
          errors.push(`task[${index}].data.blanks must be an array.`);
        }
        break;
      case 'dictation':
        if (!data.sourceText && !data.audioUrl) {
          errors.push(`task[${index}].data.sourceText or data.audioUrl is required.`);
        }
        break;
      case 'read_answer':
        if (typeof data.passage !== 'string') {
          errors.push(`task[${index}].data.passage must be a string.`);
        }
        if (!Array.isArray(data.questions) || !data.questions.length) {
          errors.push(`task[${index}].data.questions must be a non-empty array.`);
        }
        break;
      case 'translate':
        if (!data.direction) {
          errors.push(`task[${index}].data.direction is required.`);
        }
        break;
      case 'speaking':
        break;
      case 'flashcards':
        if (!Array.isArray(data.cards) || !data.cards.length) {
          errors.push(`task[${index}].data.cards must be a non-empty array.`);
        }
        break;
      default:
        break;
    }
  }

  function renderLessonList() {
    const search = elements.lessonSearch.value.trim().toLowerCase();
    const previousLanguage = elements.lessonLanguageFilter.value || '';
    const languageFilter = previousLanguage;
    const languages = ['All', ...new Set(state.lessons.map((lesson) => lesson.languageId))];
    elements.lessonLanguageFilter.innerHTML = languages
      .map((lang) => `<option value="${lang === 'All' ? '' : lang}">${lang}</option>`)
      .join('');
    elements.lessonLanguageFilter.value = previousLanguage;

    const filtered = state.lessons.filter((lesson) => {
      const matchesSearch =
        !search ||
        lesson.title.toLowerCase().includes(search) ||
        lesson.tags.some((tag) => tag.toLowerCase().includes(search)) ||
        (lesson.level || '').toLowerCase().includes(search);
      const matchesLanguage = !languageFilter || lesson.languageId === languageFilter;
      return matchesSearch && matchesLanguage;
    });

    elements.lessonList.innerHTML = '';

    if (!filtered.length) {
      elements.lessonList.innerHTML = '<div class="muted">No lessons yet. Paste JSON lesson text to start.</div>';
      return;
    }

    filtered.forEach((lesson, index) => {
      const node = lessonCardTemplate.content.firstElementChild.cloneNode(true);
      node.style.animationDelay = `${index * 0.05}s`;
      node.querySelector('.lesson-title').textContent = lesson.title;
      node.querySelector('.lesson-sub').textContent = `${lesson.languageId} - ${lesson.level || 'custom'} - ${lesson.tasks.length} tasks`;

      const tagsEl = node.querySelector('.lesson-tags');
      tagsEl.innerHTML = '';
      lesson.tags.forEach((tag) => {
        const span = document.createElement('span');
        span.className = 'tag';
        span.textContent = tag;
        tagsEl.appendChild(span);
      });

      node.querySelector('.start-practice').addEventListener('click', () => startLesson(lesson.lessonId, 'practice'));
      node.querySelector('.start-test').addEventListener('click', () => startLesson(lesson.lessonId, 'test'));
      node.querySelector('.export-lesson').addEventListener('click', () => downloadJSON(lesson, `lesson-${lesson.lessonId}.json`));
      node.querySelector('.delete-lesson').addEventListener('click', () => deleteLesson(lesson.lessonId));

      elements.lessonList.appendChild(node);
    });
  }

  async function deleteLesson(lessonId) {
    if (!confirm('Delete this lesson for your current token? Attempts will remain in history.')) {
      return;
    }
    const nextLessons = state.lessons.filter((lesson) => lesson.lessonId !== lessonId);
    try {
      if (!MEMORY_ONLY) {
        await apiRequest(`/api/lessons/${encodeURIComponent(lessonId)}`, { method: 'DELETE' });
      }
      state.lessons = nextLessons;
      renderLessonList();
      renderHistoryFilters();
      renderAnalytics();
      updateStorageStatus();
    } catch (error) {
      alert(`Failed to delete lesson: ${error.message}`);
    }
  }

  function startLesson(lessonId, mode, subsetTaskIds = null) {
    const lesson = state.lessons.find((item) => item.lessonId === lessonId);
    if (!lesson) {
      return;
    }

    state.currentLesson = lesson;
    state.mode = mode;
    state.currentTaskIndex = 0;
    state.paused = false;
    state.pausedMs = 0;
    state.pauseStartedAt = null;

    const tasks = subsetTaskIds
      ? lesson.tasks.filter((task) => subsetTaskIds.includes(task.taskId))
      : lesson.tasks;

    state.currentTasks = tasks;
    state.currentAttempt = createAttempt(lesson, mode, tasks);

    renderPlayer();
    showView('player');
  }

  function createAttempt(lesson, mode, tasks) {
    return {
      attemptId: uid('attempt'),
      lessonId: lesson.lessonId,
      timestampStart: new Date().toISOString(),
      timestampEnd: null,
      durationSec: 0,
      mode,
      answers: {},
      autograde: {},
      manual: {},
      score: {
        pointsEarned: 0,
        pointsMax: 0,
        percent: 0
      },
      weaknessSnapshot: [],
      taskIds: tasks.map((task) => task.taskId),
      taskKeys: tasks.map((task) => buildTaskKey(lesson.lessonId, task.taskId))
    };
  }

  function buildTaskKey(lessonId, taskId) {
    return `${lessonId}::${taskId}`;
  }

  function getAttemptAnswer(attempt, taskId) {
    const taskKey = buildTaskKey(attempt.lessonId, taskId);
    if (attempt.answers[taskKey] !== undefined) {
      return attempt.answers[taskKey];
    }
    return attempt.answers[taskId];
  }

  function getAttemptAnswerSafe(attempt, taskId) {
    return getAttemptAnswer(attempt, taskId) || {};
  }

  function setAttemptAnswer(attempt, taskId, answer) {
    attempt.answers[buildTaskKey(attempt.lessonId, taskId)] = answer;
  }

  function getAttemptGrade(attempt, taskId) {
    const taskKey = buildTaskKey(attempt.lessonId, taskId);
    if (attempt.autograde[taskKey] !== undefined) {
      return attempt.autograde[taskKey];
    }
    return attempt.autograde[taskId];
  }

  function setAttemptGrade(attempt, taskId, grade) {
    attempt.autograde[buildTaskKey(attempt.lessonId, taskId)] = grade;
  }

  function renderPlayer() {
    const lesson = state.currentLesson;
    if (!lesson) {
      return;
    }

    elements.playerLessonTitle.textContent = lesson.title;
    elements.playerLessonMeta.textContent = `${lesson.languageId} - ${lesson.level || 'custom'} - ${state.mode}`;
    elements.pauseToggle.disabled = state.mode !== 'practice';
    elements.checkTask.style.display = state.mode === 'practice' ? 'inline-flex' : 'none';
    elements.taskFeedback.textContent = '';

    renderTaskNavigation();
    renderCurrentTask();
  }

  function renderTaskNavigation() {
    elements.taskNav.innerHTML = '';
    state.currentTasks.forEach((task, index) => {
      const btn = document.createElement('button');
      btn.textContent = index + 1;
      btn.classList.toggle('active', index === state.currentTaskIndex);
      btn.addEventListener('click', () => {
        saveCurrentAnswer();
        state.currentTaskIndex = index;
        renderCurrentTask();
      });
      elements.taskNav.appendChild(btn);
    });
    updateProgress();
  }

  function renderCurrentTask() {
    const task = state.currentTasks[state.currentTaskIndex];
    if (!task) {
      elements.taskContainer.innerHTML = '<div class="muted">No task available.</div>';
      return;
    }

    elements.taskFeedback.textContent = '';
    elements.taskContainer.innerHTML = '';

    const prompt = document.createElement('div');
    prompt.innerHTML = `<strong>${task.prompt}</strong>`;
    elements.taskContainer.appendChild(prompt);

    if (task.tags.length) {
      const tagWrap = document.createElement('div');
      task.tags.forEach((tag) => {
        const span = document.createElement('span');
        span.className = 'tag';
        span.textContent = tag;
        tagWrap.appendChild(span);
      });
      elements.taskContainer.appendChild(tagWrap);
    }

    const existingAnswer = getAttemptAnswerSafe(state.currentAttempt, task.taskId);
    const render = renderTaskContent(task, existingAnswer);
    state.currentAnswerProvider = render.getAnswer;
    updateProgress();
    updateNavButtons();
  }

  function renderTaskContent(task, existingAnswer) {
    switch (task.type) {
      case 'multiple_choice':
        return renderMultipleChoice(task, existingAnswer);
      case 'multiple_select':
        return renderMultipleSelect(task, existingAnswer);
      case 'fill_in':
        return renderFillIn(task, existingAnswer);
      case 'cloze':
        return renderCloze(task, existingAnswer);
      case 'dictation':
        return renderDictation(task, existingAnswer);
      case 'read_answer':
        return renderReadAnswer(task, existingAnswer);
      case 'translate':
        return renderTranslate(task, existingAnswer);
      case 'speaking':
        return renderSpeaking(task, existingAnswer);
      case 'flashcards':
        return renderFlashcards(task, existingAnswer);
      default:
        elements.taskContainer.appendChild(document.createTextNode('Unsupported task type.'));
        return { getAnswer: () => ({ skipped: true }) };
    }
  }

  function renderMultipleChoice(task, existingAnswer, container = elements.taskContainer) {
    const list = document.createElement('div');
    list.className = 'choice-list';
    task.data.options.forEach((option, index) => {
      const label = document.createElement('label');
      label.className = 'inline';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `choice-${task.taskId}`;
      input.value = index;
      if (existingAnswer.value === index || existingAnswer.value === option) {
        input.checked = true;
      }
      label.appendChild(input);
      label.append(String(option));
      list.appendChild(label);
    });
    container.appendChild(list);

    return {
      getAnswer: () => {
        const selected = list.querySelector('input:checked');
        return selected ? { value: Number(selected.value) } : {};
      }
    };
  }

  function renderMultipleSelect(task, existingAnswer, container = elements.taskContainer) {
    const list = document.createElement('div');
    list.className = 'checkbox-list';
    task.data.options.forEach((option, index) => {
      const label = document.createElement('label');
      label.className = 'inline';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = index;
      if (Array.isArray(existingAnswer.values)) {
        const has = existingAnswer.values.includes(index) || existingAnswer.values.includes(option);
        input.checked = has;
      }
      label.appendChild(input);
      label.append(String(option));
      list.appendChild(label);
    });
    container.appendChild(list);

    return {
      getAnswer: () => {
        const values = Array.from(list.querySelectorAll('input:checked')).map((input) => Number(input.value));
        return values.length ? { values } : {};
      }
    };
  }

  function renderFillIn(task, existingAnswer, container = elements.taskContainer) {
    const input = document.createElement('textarea');
    input.placeholder = 'Type your answer';
    if (existingAnswer.text) {
      input.value = existingAnswer.text;
    }
    container.appendChild(input);

    return {
      getAnswer: () => ({ text: input.value })
    };
  }

  function renderCloze(task, existingAnswer) {
    const text = task.data.text || '';
    const blanks = Array.isArray(task.data.blanks) ? task.data.blanks : [];
    const parts = text.split('___');
    const wrapper = document.createElement('div');

    const inputs = [];
    parts.forEach((part, index) => {
      wrapper.append(part);
      if (index < parts.length - 1) {
        const input = document.createElement('input');
        input.className = 'cloze-input';
        input.type = 'text';
        input.placeholder = blanks[index]?.label || `Blank ${index + 1}`;
        if (existingAnswer.blanks && existingAnswer.blanks[index]) {
          input.value = existingAnswer.blanks[index];
        }
        inputs.push(input);
        wrapper.appendChild(input);
      }
    });

    elements.taskContainer.appendChild(wrapper);

    return {
      getAnswer: () => ({ blanks: inputs.map((input) => input.value) })
    };
  }

  function renderDictation(task, existingAnswer) {
    const hasAudio = Boolean(task.data.audioUrl);
    if (hasAudio) {
      const note = document.createElement('div');
      note.className = 'muted';
      note.textContent = 'Audio playback is temporarily disabled.';
      elements.taskContainer.appendChild(note);
    }
    if (task.data.sourceText) {
      const hint = document.createElement('div');
      hint.className = 'muted';
      hint.textContent = 'Use the text below as your dictation source.';
      elements.taskContainer.appendChild(hint);
      const source = document.createElement('div');
      source.textContent = task.data.sourceText;
      elements.taskContainer.appendChild(source);
    } else if (!hasAudio) {
      const hint = document.createElement('div');
      hint.className = 'muted';
      hint.textContent = 'No source text provided for dictation.';
      elements.taskContainer.appendChild(hint);
    }

    const input = document.createElement('textarea');
    input.placeholder = 'Type what you hear';
    if (existingAnswer.text) {
      input.value = existingAnswer.text;
    }
    elements.taskContainer.appendChild(input);

    return {
      getAnswer: () => ({ text: input.value })
    };
  }

  function renderReadAnswer(task, existingAnswer) {
    const passage = document.createElement('div');
    passage.textContent = task.data.passage || '';
    elements.taskContainer.appendChild(passage);

    const questionWrap = document.createElement('div');
    questionWrap.className = 'question-list';

    const responseMap = existingAnswer.responses || {};
    const responders = [];

    (task.data.questions || []).forEach((question, index) => {
      const container = document.createElement('div');
      container.className = 'result-row';
      const title = document.createElement('div');
      title.innerHTML = `<strong>${question.prompt || question.question || `Question ${index + 1}`}</strong>`;
      container.appendChild(title);

      const subTask = normalizeReadQuestion(question, index, task.taskId);

      const renderer = renderQuestion(subTask, responseMap[subTask.taskId] || {});
      responders.push({ id: subTask.taskId, getAnswer: renderer.getAnswer });
      container.appendChild(renderer.node);
      questionWrap.appendChild(container);
    });

    elements.taskContainer.appendChild(questionWrap);

    return {
      getAnswer: () => {
        const responses = {};
        responders.forEach((responder) => {
          responses[responder.id] = responder.getAnswer();
        });
        return { responses };
      }
    };
  }

  function renderQuestion(question, existingAnswer) {
    const node = document.createElement('div');
    let getAnswer = () => ({});

    switch (question.type) {
      case 'multiple_choice':
        ({ getAnswer } = renderMultipleChoice(question, existingAnswer, node));
        break;
      case 'multiple_select':
        ({ getAnswer } = renderMultipleSelect(question, existingAnswer, node));
        break;
      case 'fill_in':
      case 'short_answer':
        ({ getAnswer } = renderFillIn(question, existingAnswer, node));
        break;
      default:
        const input = document.createElement('textarea');
        input.value = existingAnswer.text || '';
        node.appendChild(input);
        getAnswer = () => ({ text: input.value });
        break;
    }

    return { node, getAnswer };
  }

  function renderTranslate(task, existingAnswer) {
    const direction = document.createElement('div');
    direction.className = 'muted';
    direction.textContent = `Direction: ${task.data.direction || 'self-check'}`;
    elements.taskContainer.appendChild(direction);

    const input = document.createElement('textarea');
    input.placeholder = 'Type your translation';
    if (existingAnswer.text) {
      input.value = existingAnswer.text;
    }
    elements.taskContainer.appendChild(input);

    return {
      getAnswer: () => ({ text: input.value })
    };
  }

  function renderSpeaking(task, existingAnswer) {
    const prepTime = Number(task.data.prepSeconds || task.data.timerPrep || 0);
    const speakTime = Number(task.data.speakSeconds || task.data.timerSpeak || 0);
    const info = document.createElement('div');
    info.className = 'muted';
    info.textContent = `Prep: ${prepTime || 'off'}s - Speak: ${speakTime || 'open'}`;
    elements.taskContainer.appendChild(info);

    const audioNotice = document.createElement('div');
    audioNotice.className = 'muted';
    audioNotice.textContent = 'Audio recording is temporarily disabled.';
    elements.taskContainer.appendChild(audioNotice);

    const transcript = document.createElement('textarea');
    transcript.placeholder = 'Transcript (optional)';
    transcript.value = existingAnswer.transcript || '';
    elements.taskContainer.appendChild(transcript);

    const rating = document.createElement('input');
    rating.type = 'range';
    rating.min = 1;
    rating.max = 10;
    rating.value = existingAnswer.rating || 5;
    const ratingLabel = document.createElement('div');
    ratingLabel.textContent = `Self-rating: ${rating.value}`;
    rating.addEventListener('input', () => {
      ratingLabel.textContent = `Self-rating: ${rating.value}`;
    });

    elements.taskContainer.appendChild(ratingLabel);
    elements.taskContainer.appendChild(rating);

    const criteriaWrap = document.createElement('div');
    criteriaWrap.className = 'criteria-grid';
    const criteria = task.data.criteria || ['Fluency', 'Clarity', 'Range'];
    const criteriaInputs = [];
    const existingScores = normalizeCriteriaScores(existingAnswer);
    criteria.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'criteria-row';
      const label = document.createElement('div');
      label.textContent = item;
      const value = document.createElement('div');
      const input = document.createElement('input');
      input.type = 'range';
      input.min = 1;
      input.max = 10;
      input.value = existingScores[item] || 5;
      value.textContent = input.value;
      input.addEventListener('input', () => {
        value.textContent = input.value;
      });
      row.appendChild(label);
      row.appendChild(input);
      row.appendChild(value);
      criteriaWrap.appendChild(row);
      criteriaInputs.push({ name: item, input });
    });
    elements.taskContainer.appendChild(criteriaWrap);

    const notes = document.createElement('textarea');
    notes.placeholder = 'Notes';
    notes.value = existingAnswer.notes || '';
    elements.taskContainer.appendChild(notes);

    const audioDataUrl = existingAnswer.audioDataUrl || '';

    return {
      getAnswer: () => {
        const criteriaScores = {};
        criteriaInputs.forEach(({ name, input }) => {
          criteriaScores[name] = Number(input.value);
        });
        const metrics = buildTranscriptMetrics(transcript.value);
        return {
          transcript: transcript.value,
          rating: Number(rating.value),
          notes: notes.value,
          criteriaScores,
          audioDataUrl,
          metrics
        };
      }
    };
  }

  function renderFlashcards(task, existingAnswer) {
    const cards = task.data.cards || [];
    const cardState = Array.isArray(existingAnswer.cards)
      ? existingAnswer.cards.map((item) => ({ ...item }))
      : cards.map(() => ({ status: 'unseen' }));

    let current = 0;
    const card = document.createElement('div');
    card.className = 'flashcard';
    elements.taskContainer.appendChild(card);

    const actions = document.createElement('div');
    actions.className = 'result-actions';
    elements.taskContainer.appendChild(actions);

    const prev = document.createElement('button');
    prev.textContent = 'Prev card';
    prev.className = 'ghost';
    const next = document.createElement('button');
    next.textContent = 'Next card';
    next.className = 'ghost';
    actions.appendChild(prev);
    actions.appendChild(next);

    const revealBtn = document.createElement('button');
    revealBtn.textContent = 'Reveal';
    revealBtn.className = 'ghost';
    actions.appendChild(revealBtn);

    const markKnow = document.createElement('button');
    markKnow.textContent = 'Know';
    markKnow.className = 'ghost';
    actions.appendChild(markKnow);

    const markDontKnow = document.createElement('button');
    markDontKnow.textContent = "Don't know";
    markDontKnow.className = 'ghost';
    actions.appendChild(markDontKnow);

    const markWrong = document.createElement('button');
    markWrong.textContent = 'Wrong';
    markWrong.className = 'ghost';
    actions.appendChild(markWrong);

    function renderCard() {
      const currentCard = cards[current];
      card.innerHTML = '';
      if (!currentCard) {
        card.textContent = 'No cards found.';
        return;
      }
      const front = document.createElement('div');
      front.innerHTML = `<strong>${currentCard.front}</strong>`;
      card.appendChild(front);

      const status = document.createElement('div');
      status.className = 'muted';
      status.textContent = `Status: ${formatFlashcardStatus(cardState[current]?.status)}`;
      card.appendChild(status);
    }

    function updateCardState(status) {
      cardState[current].status = status;
      renderCard();
    }

    prev.addEventListener('click', () => {
      if (current > 0) {
        updateCardState(cardState[current].status);
        current -= 1;
        renderCard();
      }
    });

    next.addEventListener('click', () => {
      if (current < cards.length - 1) {
        updateCardState(cardState[current].status);
        current += 1;
        renderCard();
      }
    });

    revealBtn.addEventListener('click', () => {
      const back = document.createElement('div');
      back.textContent = cards[current]?.back || '';
      card.appendChild(back);
    });

    markKnow.addEventListener('click', () => updateCardState('know'));
    markDontKnow.addEventListener('click', () => updateCardState('dont_know'));
    markWrong.addEventListener('click', () => updateCardState('wrong'));

    renderCard();

    return {
      getAnswer: () => ({ cards: cardState })
    };
  }

  function changeTask(delta) {
    if (!state.currentLesson) {
      return;
    }
    saveCurrentAnswer();
    state.currentTaskIndex = Math.min(Math.max(0, state.currentTaskIndex + delta), state.currentTasks.length - 1);
    renderCurrentTask();
    renderTaskNavigation();
  }

  function skipCurrentTask() {
    const task = state.currentTasks[state.currentTaskIndex];
    if (!task) {
      return;
    }
    setAttemptAnswer(state.currentAttempt, task.taskId, { skipped: true });
    checkCurrentTask(false, true);
    changeTask(1);
  }

  function saveCurrentAnswer() {
    if (!state.currentAnswerProvider || !state.currentLesson) {
      return;
    }
    const task = state.currentTasks[state.currentTaskIndex];
    if (!task) {
      return;
    }
    const answer = state.currentAnswerProvider();
    setAttemptAnswer(state.currentAttempt, task.taskId, answer);
  }

  function checkCurrentTask(showFeedback, skip = false) {
    if (!state.currentLesson) {
      return;
    }
    const task = state.currentTasks[state.currentTaskIndex];
    const storedAnswer = getAttemptAnswer(state.currentAttempt, task.taskId);
    const answer = storedAnswer && Object.keys(storedAnswer).length ? storedAnswer : state.currentAnswerProvider();
    if (!skip) {
      setAttemptAnswer(state.currentAttempt, task.taskId, answer);
    }
    const grade = gradeTask(task, answer);
    setAttemptGrade(state.currentAttempt, task.taskId, grade);

    if (showFeedback && state.mode === 'practice') {
      elements.taskFeedback.innerHTML = formatGradeFeedback(task, grade);
    }
  }

  function updateProgress() {
    const total = state.currentTasks.length || 1;
    const percent = ((state.currentTaskIndex + 1) / total) * 100;
    elements.progressBar.style.width = `${percent}%`;
  }

  function updateNavButtons() {
    elements.prevTask.disabled = state.currentTaskIndex === 0;
    elements.nextTask.disabled = state.currentTaskIndex >= state.currentTasks.length - 1;
  }

  function togglePause() {
    if (state.mode !== 'practice') {
      return;
    }
    state.paused = !state.paused;
    if (state.paused) {
      state.pauseStartedAt = Date.now();
      elements.pauseToggle.textContent = 'Resume';
      elements.taskContainer.style.opacity = '0.5';
    } else {
      if (state.pauseStartedAt) {
        state.pausedMs += Date.now() - state.pauseStartedAt;
      }
      state.pauseStartedAt = null;
      elements.pauseToggle.textContent = 'Pause';
      elements.taskContainer.style.opacity = '1';
    }
  }

  function exitLesson() {
    if (state.currentAttempt && confirm('Exit the lesson? Progress will be saved as-is.')) {
      finalizeAttempt();
    }
  }

  async function finalizeAttempt() {
    if (!state.currentAttempt || !state.currentLesson) {
      return;
    }

    saveCurrentAnswer();
    const attempt = state.currentAttempt;

    const now = Date.now();
    if (state.pauseStartedAt) {
      state.pausedMs += now - state.pauseStartedAt;
    }
    attempt.timestampEnd = new Date().toISOString();
    attempt.durationSec = Math.max(0, Math.round((now - new Date(attempt.timestampStart).getTime() - state.pausedMs) / 1000));

    attempt.autograde = buildAutograde(state.currentLesson.lessonId, state.currentTasks, attempt.answers);
    attempt.manual = buildManual(state.currentLesson.lessonId, state.currentTasks, attempt.answers);
    attempt.score = buildScore(attempt.autograde);
    attempt.weaknessSnapshot = buildWeaknessSnapshot(state.currentLesson, state.currentTasks, attempt.autograde);

    state.attempts.unshift(attempt);
    try {
      await saveAttempts({ attempt });
    } catch (error) {
      alert(`Attempt was finished but sync failed: ${error.message}`);
    }
    renderHistoryFilters();
    renderHistoryList();
    renderAnalytics();
    renderResults(attempt);
    showView('results');
  }

  function buildAutograde(lessonId, tasks, answers) {
    const autograde = {};
    tasks.forEach((task) => {
      const taskKey = buildTaskKey(lessonId, task.taskId);
      const answer = answers[taskKey] || {};
      autograde[taskKey] = gradeTask(task, answer);
    });
    return autograde;
  }

  function buildManual(lessonId, tasks, answers) {
    const manual = {};
    tasks.forEach((task) => {
      if (task.type === 'speaking') {
        const taskKey = buildTaskKey(lessonId, task.taskId);
        const answer = answers[taskKey] || {};
        const criteriaScores = normalizeCriteriaScores(answer);
        manual[taskKey] = {
          selfScore: answer.rating || null,
          criteria: criteriaScores,
          notes: answer.notes || '',
          transcript: answer.transcript || '',
          metrics: answer.metrics || {},
          audioDataUrl: answer.audioDataUrl || ''
        };
      }
    });
    return manual;
  }

  function buildScore(autograde) {
    let pointsEarned = 0;
    let pointsMax = 0;
    Object.values(autograde).forEach((grade) => {
      pointsEarned += grade.pointsEarned || 0;
      pointsMax += grade.pointsMax || 0;
    });
    const percent = pointsMax ? Math.round((pointsEarned / pointsMax) * 100) : 0;
    return { pointsEarned, pointsMax, percent };
  }

  function buildWeaknessSnapshot(lesson, tasks, autograde) {
    const counts = {};
    const taskMap = {};
    tasks.forEach((task) => {
      const taskKey = buildTaskKey(lesson.lessonId, task.taskId);
      const grade = autograde[taskKey];
      if (!grade || grade.status === 'correct') {
        return;
      }
      const tags = [...task.tags, task.type];
      tags.forEach((tag) => {
        counts[tag] = (counts[tag] || 0) + 1;
        if (!taskMap[tag]) {
          taskMap[tag] = new Set();
        }
        taskMap[tag].add(task.taskId);
      });
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count, taskIds: Array.from(taskMap[tag] || []) }));
  }

  function renderResults(attempt) {
    const lesson = state.lessons.find((item) => item.lessonId === attempt.lessonId);
    if (!lesson) {
      return;
    }

    elements.resultSummary.innerHTML = '';

    const tiles = [
      { label: 'Score', value: `${attempt.score.percent}% (${attempt.score.pointsEarned}/${attempt.score.pointsMax})` },
      { label: 'Mode', value: attempt.mode },
      { label: 'Duration', value: formatDuration(attempt.durationSec) },
      { label: 'Date', value: formatDate(attempt.timestampStart) }
    ];

    tiles.forEach((tile) => {
      const div = document.createElement('div');
      div.className = 'summary-tile';
      div.innerHTML = `<div class="muted">${tile.label}</div><strong>${tile.value}</strong>`;
      elements.resultSummary.appendChild(div);
    });

    elements.resultDetails.innerHTML = '';

    attempt.taskIds.forEach((taskId) => {
      const task = lesson.tasks.find((item) => item.taskId === taskId);
      const grade = getAttemptGrade(attempt, taskId);
      const answer = getAttemptAnswerSafe(attempt, taskId);

      if (!task || !grade) {
        return;
      }

      const row = document.createElement('div');
      row.className = `result-row ${grade.status}`;
      const explanation = task.data?.explanation || task.rubric?.explanation;
      row.innerHTML = `
        <div><strong>${task.prompt}</strong></div>
        <div>Status: ${grade.status}</div>
        <div>Your answer: ${formatAnswer(task, answer)}</div>
        <div>Correct: ${grade.correctAnswer || 'N/A'}</div>
        <div>${grade.details || ''}</div>
        ${explanation ? `<div>Note: ${explanation}</div>` : ''}
      `;

      if (task.type === 'speaking' && answer.audioDataUrl) {
        const note = document.createElement('div');
        note.className = 'muted';
        note.textContent = 'Audio playback is temporarily disabled.';
        row.appendChild(note);
      }

      elements.resultDetails.appendChild(row);
    });
  }

  function renderHistoryFilters() {
    const languages = ['All', ...new Set(state.lessons.map((lesson) => lesson.languageId))];
    const lessons = ['All', ...state.lessons.map((lesson) => lesson.lessonId)];
    const levels = ['All', ...new Set(state.lessons.map((lesson) => lesson.level || 'custom'))];
    const tags = ['All', ...new Set(state.lessons.flatMap((lesson) => lesson.tags))];

    elements.historyLanguage.innerHTML = languages.map((lang) => `<option value="${lang === 'All' ? '' : lang}">${lang}</option>`).join('');
    elements.historyLesson.innerHTML = lessons.map((id) => `<option value="${id === 'All' ? '' : id}">${id}</option>`).join('');
    elements.historyLevel.innerHTML = levels.map((level) => `<option value="${level === 'All' ? '' : level}">${level}</option>`).join('');
    elements.historyTag.innerHTML = tags.map((tag) => `<option value="${tag === 'All' ? '' : tag}">${tag}</option>`).join('');
  }

  function renderHistoryList() {
    const filtered = filterAttempts();
    elements.historyList.innerHTML = '';

    if (!filtered.length) {
      elements.historyList.innerHTML = '<div class="muted">No attempts yet.</div>';
      return;
    }

    filtered.forEach((attempt) => {
      const lesson = state.lessons.find((item) => item.lessonId === attempt.lessonId);
      const node = historyCardTemplate.content.firstElementChild.cloneNode(true);
      node.querySelector('.history-title').textContent = lesson ? lesson.title : attempt.lessonId;
      node.querySelector('.history-sub').textContent = `${formatDate(attempt.timestampStart)} - ${attempt.mode} - ${formatDuration(attempt.durationSec)}`;
      node.querySelector('.history-score').textContent = `${attempt.score.percent}%`;
      node.querySelector('.view-attempt').addEventListener('click', () => {
        state.currentAttempt = attempt;
        renderResults(attempt);
        showView('results');
      });
      elements.historyList.appendChild(node);
    });
  }

  function filterAttempts() {
    const language = elements.historyLanguage.value;
    const lessonId = elements.historyLesson.value;
    const tag = elements.historyTag.value;
    const level = elements.historyLevel.value;
    const mode = elements.historyMode.value;
    const dateFrom = elements.historyDateFrom.value ? new Date(elements.historyDateFrom.value) : null;
    const dateTo = elements.historyDateTo.value ? new Date(elements.historyDateTo.value) : null;
    const sort = elements.historySort.value;

    let filtered = state.attempts.filter((attempt) => {
      const lesson = state.lessons.find((item) => item.lessonId === attempt.lessonId);
      if (language && lesson?.languageId !== language) return false;
      if (lessonId && attempt.lessonId !== lessonId) return false;
      if (level && (lesson?.level || 'custom') !== level) return false;
      if (mode && attempt.mode !== mode) return false;
      if (tag && !lesson?.tags.includes(tag)) return false;

      const attemptDate = new Date(attempt.timestampStart);
      if (dateFrom && attemptDate < dateFrom) return false;
      if (dateTo && attemptDate > new Date(dateTo.getTime() + 86400000)) return false;
      return true;
    });

    if (sort === 'percent') {
      filtered = filtered.sort((a, b) => b.score.percent - a.score.percent);
    } else if (sort === 'duration') {
      filtered = filtered.sort((a, b) => b.durationSec - a.durationSec);
    } else {
      filtered = filtered.sort((a, b) => new Date(b.timestampStart) - new Date(a.timestampStart));
    }

    return filtered;
  }

  function exportFilteredHistory() {
    const filtered = filterAttempts();
    downloadJSON(filtered, `attempts-${Date.now()}.json`);
  }

  function exportLessonReport() {
    const lessonId = elements.historyLesson.value || state.lessons[0]?.lessonId;
    if (!lessonId) {
      alert('No lesson selected.');
      return;
    }

    const attempts = state.attempts.filter((attempt) => attempt.lessonId === lessonId);
    const summary = buildLessonSummary(lessonId, attempts);
    downloadJSON(summary, `lesson-report-${lessonId}.json`);
  }

  function buildLessonSummary(lessonId, attempts) {
    const lesson = state.lessons.find((item) => item.lessonId === lessonId);
    const avgPercent = average(attempts.map((a) => a.score.percent));
    const avgDuration = average(attempts.map((a) => a.durationSec));
    const best = Math.max(...attempts.map((a) => a.score.percent), 0);
    const last = attempts[0] || null;

    return {
      lessonId,
      lessonTitle: lesson?.title,
      attempts: attempts.length,
      averagePercent: Math.round(avgPercent || 0),
      averageDurationSec: Math.round(avgDuration || 0),
      bestPercent: best,
      lastAttempt: last,
      lastAttempts: attempts.slice(0, 5)
    };
  }

  async function handleImportHistory() {
    const file = elements.historyFile.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const attempts = Array.isArray(parsed) ? parsed : parsed.attempts;
      if (!Array.isArray(attempts)) {
        alert('History file must be an array of attempts.');
        return;
      }

      const existingIds = new Set(state.attempts.map((attempt) => attempt.attemptId));
      const newAttempts = attempts.filter((attempt) => attempt.attemptId && !existingIds.has(attempt.attemptId));
      state.attempts = [...newAttempts, ...state.attempts];
      await saveAttempts({ attempts: newAttempts });
      renderHistoryFilters();
      renderHistoryList();
      renderAnalytics();
      elements.historyFile.value = '';
    } catch (error) {
      alert(`Invalid JSON: ${error.message}`);
    }
  }

  function renderAnalytics() {
    renderLessonAnalytics();
    renderLanguageAnalytics();
    renderWeaknessAnalytics();
  }

  function renderLessonAnalytics() {
    const lessonOptions = state.lessons.map((lesson) => `<option value="${lesson.lessonId}">${lesson.title}</option>`);
    const selectedLesson = state.lessons[0]?.lessonId || '';

    elements.lessonAnalytics.innerHTML = `
      <div class="field">
        <label>Lesson focus</label>
        <select id="lesson-analytics-select">${lessonOptions.join('')}</select>
      </div>
      <div id="lesson-analytics-body" class="muted">Select a lesson</div>
    `;

    const select = elements.lessonAnalytics.querySelector('#lesson-analytics-select');
    const body = elements.lessonAnalytics.querySelector('#lesson-analytics-body');

    if (!selectedLesson) {
      body.textContent = 'No lessons yet.';
      return;
    }

    select.value = selectedLesson;
    const update = () => {
      const lessonId = select.value;
      const attempts = state.attempts.filter((attempt) => attempt.lessonId === lessonId);
      const summary = buildLessonSummary(lessonId, attempts);
      body.innerHTML = `
        <div>Attempts: ${summary.attempts}</div>
        <div>Average: ${summary.averagePercent}%</div>
        <div>Best: ${summary.bestPercent}%</div>
        <div>Avg duration: ${formatDuration(summary.averageDurationSec)}</div>
      `;
    };
    select.addEventListener('change', update);
    update();
  }

  function renderLanguageAnalytics() {
    const languages = Array.from(new Set(state.lessons.map((lesson) => lesson.languageId)));
    elements.languageAnalytics.innerHTML = `
      <div class="field">
        <label>Language focus</label>
        <select id="language-analytics-select">${languages.map((lang) => `<option value="${lang}">${lang}</option>`).join('')}</select>
      </div>
      <div id="language-analytics-body" class="muted">Select a language</div>
    `;

    const select = elements.languageAnalytics.querySelector('#language-analytics-select');
    const body = elements.languageAnalytics.querySelector('#language-analytics-body');

    if (!languages.length) {
      body.textContent = 'No languages yet.';
      return;
    }

    const update = () => {
      const lang = select.value;
      const attempts = state.attempts.filter((attempt) => {
        const lesson = state.lessons.find((item) => item.lessonId === attempt.lessonId);
        return lesson?.languageId === lang;
      });

      const totalDuration = attempts.reduce((sum, attempt) => sum + (attempt.durationSec || 0), 0);
      const taskTypeCounts = {};

      attempts.forEach((attempt) => {
        const lesson = state.lessons.find((item) => item.lessonId === attempt.lessonId);
        lesson?.tasks.forEach((task) => {
          taskTypeCounts[task.type] = (taskTypeCounts[task.type] || 0) + 1;
        });
      });

      const types = Object.entries(taskTypeCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `${type}: ${count}`)
        .join('<br/>');

      body.innerHTML = `
        <div>Total time: ${formatDuration(totalDuration)}</div>
        <div>Attempts: ${attempts.length}</div>
        <div>Task mix:</div>
        <div class="muted">${types || 'No tasks yet.'}</div>
      `;
    };

    select.addEventListener('change', update);
    update();
  }

  function renderWeaknessAnalytics() {
    const counts = {};
    state.attempts.forEach((attempt) => {
      attempt.weaknessSnapshot.forEach((item) => {
        counts[item.tag] = (counts[item.tag] || 0) + item.count;
      });
    });

    const list = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => `<div>${tag}: ${count}</div>`)
      .join('');

    elements.weaknessAnalytics.innerHTML = `
      <div><strong>Top weaknesses</strong></div>
      <div class="muted">${list || 'No weakness data yet.'}</div>
    `;
  }

  function repeatWrongOnly() {
    const attempt = state.currentAttempt;
    if (!attempt) {
      return;
    }
    const wrongTaskIds = attempt.taskIds.filter((taskId) => {
      const grade = getAttemptGrade(attempt, taskId);
      return grade && grade.status !== 'correct';
    });

    if (!wrongTaskIds.length) {
      alert('No incorrect tasks to repeat.');
      return;
    }

    startLesson(attempt.lessonId, 'practice', wrongTaskIds);
  }

  function exportAllData() {
    const payload = {
      lessons: state.lessons,
      attempts: state.attempts
    };
    downloadJSON(payload, `lingualab-backup-${Date.now()}.json`);
  }

  async function resetAllData() {
    if (!confirm('This will delete all lessons and attempts for your current token. Continue?')) {
      return;
    }
    state.lessons = [];
    state.attempts = [];
    try {
      if (!MEMORY_ONLY) {
        await clearLessons();
      }
      await clearAttempts();
    } catch (error) {
      alert(`Failed to clear server data: ${error.message}`);
    }
    renderAll();
    updateStorageStatus();
  }

  function gradeTask(task, answer) {
    const pointsMax = task.points || 1;
    if (!answer || answer.skipped) {
      return { status: 'skipped', pointsEarned: 0, pointsMax, correctAnswer: '', details: '' };
    }

    switch (task.type) {
      case 'multiple_choice':
        return gradeMultipleChoice(task, answer, pointsMax);
      case 'multiple_select':
        return gradeMultipleSelect(task, answer, pointsMax);
      case 'fill_in':
        return gradeFillIn(task, answer, pointsMax);
      case 'cloze':
        return gradeCloze(task, answer, pointsMax);
      case 'dictation':
        return gradeDictation(task, answer, pointsMax);
      case 'read_answer':
        return gradeReadAnswer(task, answer, pointsMax);
      case 'translate':
        return gradeTranslate(task, answer, pointsMax);
      case 'speaking':
        return {
          status: 'partial',
          pointsEarned: 0,
          pointsMax,
          correctAnswer: 'Self-rating only',
          details: answer.rating ? `Self-rating ${answer.rating}/10` : 'Self-rating pending'
        };
      case 'flashcards':
        return gradeFlashcards(task, answer, pointsMax);
      default:
        return { status: 'skipped', pointsEarned: 0, pointsMax, correctAnswer: '', details: '' };
    }
  }

  function resolveScoringMode(task, fallback) {
    const mode = task.rubric?.scoring?.mode;
    if (typeof mode !== 'string') {
      return fallback;
    }
    const normalized = mode.toLowerCase();
    if (['binary', 'partial', 'proportional'].includes(normalized)) {
      return normalized;
    }
    return fallback;
  }

  function applyScoring(pointsMax, ratio, status, mode) {
    if (mode === 'binary') {
      return status === 'correct' ? pointsMax : 0;
    }
    if (mode === 'partial') {
      if (status === 'correct') {
        return pointsMax;
      }
      if (status === 'partial') {
        return roundScore(pointsMax * ratio);
      }
      return 0;
    }
    return roundScore(pointsMax * ratio);
  }

  function roundScore(value) {
    return Math.round(value * 100) / 100;
  }

  function gradeMultipleChoice(task, answer, pointsMax) {
    const correctIndex = resolveCorrectIndex(task.data.options, task.data.correct);
    const isCorrect = Number(answer.value) === correctIndex;
    return {
      status: isCorrect ? 'correct' : 'incorrect',
      pointsEarned: isCorrect ? pointsMax : 0,
      pointsMax,
      correctAnswer: task.data.options?.[correctIndex] || 'N/A',
      details: ''
    };
  }

  function gradeMultipleSelect(task, answer, pointsMax) {
    const correctIndices = resolveCorrectIndices(task.data.options, task.data.correct);
    const chosen = Array.isArray(answer.values) ? answer.values.map(Number) : [];
    const chosenSet = new Set(chosen);
    const correctSet = new Set(correctIndices);
    const matchCount = Array.from(chosenSet).filter((value) => correctSet.has(value)).length;
    const wrongCount = Array.from(chosenSet).filter((value) => !correctSet.has(value)).length;
    const correctCount = correctSet.size;
    const rawRatio = correctCount ? (matchCount - wrongCount) / correctCount : 0;
    const ratio = Math.min(Math.max(rawRatio, 0), 1);
    const isCorrect = matchCount === correctCount && wrongCount === 0 && chosenSet.size === correctCount;
    const status = isCorrect ? 'correct' : ratio > 0 ? 'partial' : 'incorrect';
    const mode = resolveScoringMode(task, 'partial');
    return {
      status,
      pointsEarned: applyScoring(pointsMax, ratio, status, mode),
      pointsMax,
      correctAnswer: correctIndices.map((idx) => task.data.options[idx]).join(', '),
      details: `Matched ${matchCount}/${correctCount}, extra ${wrongCount}`
    };
  }

  function gradeFillIn(task, answer, pointsMax) {
    const answers = normalizeAnswers(task.data.answers);
    const rules = resolveMatchRules(task.rubric);
    const response = normalizeText(answer.text || '', rules);
    const match = answers.some((value) => normalizeText(value, rules) === response);
    return {
      status: match ? 'correct' : 'incorrect',
      pointsEarned: match ? pointsMax : 0,
      pointsMax,
      correctAnswer: answers.join(' / '),
      details: ''
    };
  }

  function gradeCloze(task, answer, pointsMax) {
    const blanks = Array.isArray(task.data.blanks) ? task.data.blanks : [];
    const responses = Array.isArray(answer.blanks) ? answer.blanks : [];
    const rules = resolveMatchRules(task.rubric);
    let correct = 0;

    blanks.forEach((blank, index) => {
      const acceptable = normalizeAnswers(blank.answers || blank.options || blank.accepted || []);
      const response = normalizeText(responses[index] || '', rules);
      if (acceptable.some((value) => normalizeText(value, rules) === response)) {
        correct += 1;
      }
    });

    const ratio = blanks.length ? correct / blanks.length : 0;
    const status = ratio === 1 ? 'correct' : ratio > 0 ? 'partial' : 'incorrect';
    const mode = resolveScoringMode(task, 'proportional');
    return {
      status,
      pointsEarned: applyScoring(pointsMax, ratio, status, mode),
      pointsMax,
      correctAnswer: blanks
        .map((blank) => normalizeAnswers(blank.answers || blank.options || []).join('/'))
        .join(' | '),
      details: `${correct}/${blanks.length} blanks correct`
    };
  }

  function gradeDictation(task, answer, pointsMax) {
    const expected = task.data.sourceText || '';
    const diff = wordDiff(expected, answer.text || '');
    const status = diff.percent >= 0.9 ? 'correct' : diff.percent > 0.6 ? 'partial' : 'incorrect';
    const mode = resolveScoringMode(task, 'proportional');
    return {
      status,
      pointsEarned: applyScoring(pointsMax, diff.percent, status, mode),
      pointsMax,
      correctAnswer: expected,
      details: `Match ${Math.round(diff.percent * 100)}%. Missing: ${diff.missing.join(', ') || 'none'}`
    };
  }

  function gradeReadAnswer(task, answer, pointsMax) {
    const responses = answer.responses || {};
    const questions = task.data.questions || [];
    let correct = 0;

    questions.forEach((question, index) => {
      const subTask = normalizeReadQuestion(question, index, task.taskId);
      const subAnswer = responses[subTask.taskId] || {};
      const grade = gradeTask({ ...subTask, points: 1 }, subAnswer);
      if (grade.status === 'correct') {
        correct += 1;
      }
    });

    const ratio = questions.length ? correct / questions.length : 0;
    const status = ratio === 1 ? 'correct' : ratio > 0 ? 'partial' : 'incorrect';
    const mode = resolveScoringMode(task, 'proportional');
    return {
      status,
      pointsEarned: applyScoring(pointsMax, ratio, status, mode),
      pointsMax,
      correctAnswer: 'See sub-questions',
      details: `${correct}/${questions.length} correct`
    };
  }

  function gradeTranslate(task, answer, pointsMax) {
    const references = normalizeAnswers(task.data.references || task.data.reference || []);
    const rubric = resolveTranslateRubric(task);
    if (!references.length && !rubric.keywords.length) {
      return {
        status: 'partial',
        pointsEarned: 0,
        pointsMax,
        correctAnswer: 'Self-check',
        details: 'No reference answers configured.'
      };
    }
    const response = answer.text || '';
    let best = 0;
    let correctAnswer = 'Self-check';
    if (rubric.keywords.length) {
      best = keywordOverlapFromList(rubric.keywords, response);
      correctAnswer = rubric.keywords.join(', ');
    } else {
      references.forEach((ref) => {
        best = Math.max(best, keywordOverlap(ref, response));
      });
      correctAnswer = references.join(' / ');
    }
    const status = best === 1 ? 'correct' : best >= rubric.minMatchPercent ? 'partial' : 'incorrect';
    const mode = resolveScoringMode(task, 'partial');
    return {
      status,
      pointsEarned: applyScoring(pointsMax, best, status, mode),
      pointsMax,
      correctAnswer,
      details: `Keyword match ${Math.round(best * 100)}% (min ${Math.round(rubric.minMatchPercent * 100)}%)`
    };
  }

  function gradeFlashcards(task, answer, pointsMax) {
    const cards = task.data.cards || [];
    const responses = answer.cards || [];
    let correct = 0;
    cards.forEach((card, index) => {
      const response = responses[index] || {};
      if (response.status === 'know' || response.status === 'correct') {
        correct += 1;
      }
    });
    const ratio = cards.length ? correct / cards.length : 0;
    const status = ratio === 1 ? 'correct' : ratio > 0 ? 'partial' : 'incorrect';
    const mode = resolveScoringMode(task, 'proportional');
    return {
      status,
      pointsEarned: applyScoring(pointsMax, ratio, status, mode),
      pointsMax,
      correctAnswer: 'Flashcards review',
      details: `${correct}/${cards.length} cards marked know`
    };
  }

  function formatGradeFeedback(task, grade) {
    const correct = grade.correctAnswer ? `<div><strong>Correct:</strong> ${grade.correctAnswer}</div>` : '';
    const explanation = task.data?.explanation || task.rubric?.explanation ? `<div>${task.data?.explanation || task.rubric?.explanation}</div>` : '';
    return `
      <div><strong>Status:</strong> ${grade.status} (${grade.pointsEarned}/${grade.pointsMax})</div>
      ${correct}
      ${grade.details ? `<div>${grade.details}</div>` : ''}
      ${explanation}
    `;
  }

  function formatAnswer(task, answer) {
    if (answer.skipped) return 'Skipped';
    switch (task.type) {
      case 'multiple_choice':
        return task.data.options?.[answer.value] ?? 'N/A';
      case 'multiple_select':
        return Array.isArray(answer.values)
          ? answer.values.map((idx) => task.data.options?.[idx] ?? idx).join(', ')
          : 'N/A';
      case 'fill_in':
      case 'dictation':
      case 'translate':
        return answer.text || 'N/A';
      case 'cloze':
        return Array.isArray(answer.blanks) ? answer.blanks.join(' | ') : 'N/A';
      case 'read_answer':
        return 'See sub-answers';
      case 'speaking':
        const criteriaScores = normalizeCriteriaScores(answer);
        const criteriaCount = Object.keys(criteriaScores).length;
        return `Self-score ${answer.rating || 'N/A'} - Criteria rated: ${criteriaCount} - Notes: ${answer.notes || 'N/A'}`;
      case 'flashcards':
        return summarizeFlashcards(answer);
      default:
        return 'N/A';
    }
  }

  function summarizeFlashcards(answer) {
    const cards = Array.isArray(answer.cards) ? answer.cards : [];
    const counts = { know: 0, dont_know: 0, wrong: 0, unseen: 0 };
    cards.forEach((card) => {
      const normalized = normalizeFlashcardStatus(card.status);
      counts[normalized] = (counts[normalized] || 0) + 1;
    });
    return `Know ${counts.know}, Don't know ${counts.dont_know}, Wrong ${counts.wrong}`;
  }

  function normalizeFlashcardStatus(status) {
    if (status === 'correct') return 'know';
    if (status === 'incorrect') return 'wrong';
    if (status === 'know' || status === 'dont_know' || status === 'wrong') {
      return status;
    }
    return 'unseen';
  }

  function formatFlashcardStatus(status) {
    const normalized = normalizeFlashcardStatus(status);
    if (normalized === 'know') return 'know';
    if (normalized === 'dont_know') return "don't know";
    if (normalized === 'wrong') return 'wrong';
    return 'unseen';
  }

  function normalizeAnswers(value) {
    if (Array.isArray(value)) {
      return value;
    }
    if (typeof value === 'string') {
      return [value];
    }
    return [];
  }

  function normalizeTaskType(type) {
    if (!type) {
      return '';
    }
    const normalized = type.toString().toLowerCase().replace(/[\s-]+/g, '_');
    const map = {
      mcq: 'multiple_choice',
      multiplechoice: 'multiple_choice',
      multiple_select: 'multiple_select',
      multiselect: 'multiple_select',
      fill: 'fill_in',
      fillin: 'fill_in',
      cloze_test: 'cloze',
      readandanswer: 'read_answer',
      read_answer: 'read_answer',
      translation: 'translate',
      speaking_prompt: 'speaking',
      flashcard: 'flashcards'
    };
    return map[normalized] || normalized;
  }

  function normalizeQuestionType(type) {
    if (!type) return 'fill_in';
    const normalized = normalizeTaskType(type);
    return normalized === 'short_answer' ? 'fill_in' : normalized;
  }

  function normalizeReadQuestion(question, index, parentTaskId) {
    const normalized = { ...question };
    normalized.taskId = question.questionId || question.id || `${parentTaskId}-q${index}`;
    normalized.type = normalizeQuestionType(question.type || question.questionType);
    normalized.prompt = question.prompt || question.question || `Question ${index + 1}`;
    if (!normalized.data) {
      normalized.data = {};
    }
    if (question.options && !normalized.data.options) {
      normalized.data.options = question.options;
    }
    if (question.correct !== undefined && normalized.data.correct === undefined) {
      normalized.data.correct = question.correct;
    }
    if (question.answers !== undefined && normalized.data.answers === undefined) {
      normalized.data.answers = question.answers;
    }
    return normalized;
  }

  function normalizeCriteriaScores(answer) {
    const scores = {};
    if (!answer) {
      return scores;
    }
    const source = answer.criteriaScores || answer.criteria;
    if (source && typeof source === 'object' && !Array.isArray(source)) {
      Object.entries(source).forEach(([key, value]) => {
        const numeric = Number(value);
        scores[key] = Number.isFinite(numeric) ? Math.min(Math.max(numeric, 1), 10) : 5;
      });
      return scores;
    }
    if (Array.isArray(source)) {
      source.forEach((name) => {
        scores[name] = 5;
      });
    }
    return scores;
  }

  function resolveTranslateRubric(task) {
    const rubric = task.rubric || {};
    const keywords = Array.isArray(rubric.keywords) ? rubric.keywords : [];
    const minMatchPercent = typeof rubric.minMatchPercent === 'number' ? rubric.minMatchPercent : 0.6;
    return { keywords, minMatchPercent };
  }

  function resolveCorrectIndex(options, correct) {
    if (typeof correct === 'number') return correct;
    if (typeof correct === 'string') return options.indexOf(correct);
    return -1;
  }

  function resolveCorrectIndices(options, correct) {
    if (Array.isArray(correct)) {
      return correct.map((value) => (typeof value === 'number' ? value : options.indexOf(value))).filter((idx) => idx >= 0);
    }
    if (typeof correct === 'number') return [correct];
    if (typeof correct === 'string') return [options.indexOf(correct)];
    return [];
  }

  function resolveMatchRules(rubric) {
    const rules = rubric?.match || rubric || {};
    return {
      caseInsensitive: Boolean(rules.caseInsensitive),
      trim: rules.trim !== false,
      normalizeSpaces: Boolean(rules.normalizeSpaces),
      ignorePunctuation: Boolean(rules.ignorePunctuation)
    };
  }

  function normalizeText(text, rules) {
    let value = text == null ? '' : String(text);
    if (rules.trim) value = value.trim();
    if (rules.normalizeSpaces) value = value.replace(/\s+/g, ' ');
    if (rules.ignorePunctuation) value = value.replace(/[\.,!?:;\"'\(\)\[\]\{\}-]/g, '');
    if (rules.caseInsensitive) value = value.toLowerCase();
    return value;
  }

  function wordDiff(expectedText, actualText) {
    const expected = tokenize(expectedText);
    const actual = tokenize(actualText);
    const dp = Array.from({ length: expected.length + 1 }, () => Array(actual.length + 1).fill(0));

    for (let i = 1; i <= expected.length; i += 1) {
      for (let j = 1; j <= actual.length; j += 1) {
        if (expected[i - 1] === actual[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    const lcs = [];
    let i = expected.length;
    let j = actual.length;
    while (i > 0 && j > 0) {
      if (expected[i - 1] === actual[j - 1]) {
        lcs.unshift(expected[i - 1]);
        i -= 1;
        j -= 1;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) {
        i -= 1;
      } else {
        j -= 1;
      }
    }

    const missing = expected.filter((word) => !lcs.includes(word));
    const percent = expected.length ? lcs.length / expected.length : 0;

    return { percent, missing };
  }

  function tokenize(text) {
    return String(text)
      .toLowerCase()
      .replace(/[\.,!?:;\"'\(\)\[\]\{\}-]/g, '')
      .split(/\s+/)
      .filter(Boolean);
  }

  function keywordOverlap(reference, response) {
    const refTokens = new Set(tokenize(reference));
    const resTokens = new Set(tokenize(response));
    if (!refTokens.size) return 0;
    let match = 0;
    refTokens.forEach((token) => {
      if (resTokens.has(token)) match += 1;
    });
    return match / refTokens.size;
  }

  function keywordOverlapFromList(keywords, response) {
    const refTokens = new Set();
    keywords.forEach((keyword) => {
      tokenize(keyword).forEach((token) => refTokens.add(token));
    });
    const resTokens = new Set(tokenize(response));
    if (!refTokens.size) return 0;
    let match = 0;
    refTokens.forEach((token) => {
      if (resTokens.has(token)) match += 1;
    });
    return match / refTokens.size;
  }

  function buildTranscriptMetrics(transcript) {
    const words = tokenize(transcript);
    const fillerWords = ['um', 'uh', 'like', 'you', 'know'];
    const fillers = words.filter((word) => fillerWords.includes(word)).length;
    return {
      words: words.length,
      fillers,
      fillerRate: words.length ? Math.round((fillers / words.length) * 100) : 0
    };
  }

  function formatDuration(seconds) {
    if (!seconds) return '0m';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  }

  function formatDate(iso) {
    if (!iso) return 'N/A';
    const date = new Date(iso);
    return date.toLocaleString();
  }

  function average(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function uid(prefix) {
    if (crypto?.randomUUID) {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function extractJsonFromText(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
      return '';
    }
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced && fenced[1]) {
      return fenced[1].trim();
    }
    return trimmed;
  }

  async function copyText(text) {
    if (!text) {
      throw new Error('Template is empty.');
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const temp = document.createElement('textarea');
    temp.value = text;
    temp.style.position = 'fixed';
    temp.style.opacity = '0';
    document.body.appendChild(temp);
    temp.focus();
    temp.select();
    const ok = document.execCommand('copy');
    temp.remove();
    if (!ok) {
      throw new Error('Clipboard API unavailable.');
    }
  }

  function structuredCloneSafe(value) {
    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return `${value.toFixed(1)} ${units[index]}`;
  }

  function resolveApiBase() {
    if (window.LL_API_BASE) {
      return window.LL_API_BASE;
    }
    const isWebStormStatic = window.location.hostname === 'localhost' && window.location.port === '63342';
    if (isWebStormStatic) {
      return 'http://127.0.0.1:3000';
    }
    return '';
  }

  document.addEventListener('DOMContentLoaded', () => {
    app.init().catch((error) => {
      lockApp(`Startup failed: ${error.message}`);
    });
  });
})();
