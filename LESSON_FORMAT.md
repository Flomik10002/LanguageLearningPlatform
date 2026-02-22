# Формат урока (Lesson JSON)

Этот файл описывает формат JSON-урока, который можно импортировать в приложение. Уроки полностью оффлайн, дополнительные поля не запрещены и сохраняются при экспорте.

## 1) Общая структура урока

```json
{
  "lessonId": "unique-string-id",
  "title": "Lesson title",
  "languageId": "en",
  "level": "A1",
  "tags": ["grammar", "travel"],
  "estimatedMinutes": 20,
  "tasks": [
    { "taskId": "t1", "type": "multiple_choice", "prompt": "...", "data": { "options": ["a", "b"], "correct": 0 } }
  ]
}
```

### Обязательные поля
- `lessonId` (string) — уникальный идентификатор урока.
- `title` (string) — название урока.
- `languageId` (string) — код языка (например, `en`, `zh`, `de`).
- `tasks` (array) — список заданий, минимум 1.

### Опциональные поля
- `level` (string) — уровень (`A1..C2`, `HSK3`, `JLPT N3`, `custom`).
- `tags` (array of strings) — теги урока.
- `estimatedMinutes` (number) — оценка времени.

## 2) Структура задания

```json
{
  "taskId": "unique-in-lesson",
  "type": "multiple_choice",
  "prompt": "Task prompt",
  "data": {},
  "rubric": {},
  "points": 1,
  "tags": ["grammar", "vocab"]
}
```

### Обязательные поля задания
- `taskId` (string) — уникальный в рамках урока. В попытках ключи хранятся как `${lessonId}::${taskId}`.
- `type` (string) — тип задания (см. ниже).
- `prompt` (string) — формулировка задания.
- `data` (object) — полезная нагрузка типа.

### Опциональные поля задания
- `rubric` (object) — правила оценивания и параметры сравнения.
- `points` (number) — вес задания, по умолчанию 1.
- `tags` (array of strings) — теги задания.

**Режим подсчета очков** можно задать через `rubric.scoring.mode`:
```json
"rubric": {
  "scoring": {
    "mode": "binary | partial | proportional"
  }
}
```

## 3) Поддерживаемые типы и поля `data`

### 3.1 `multiple_choice` (один правильный)
```json
"data": {
  "options": ["a", "an", "the"],
  "correct": "an",
  "explanation": "Optional explanation"
}
```
- `options` (array) — варианты.
- `correct` (string | number) — правильный вариант (текстом или индексом).

### 3.2 `multiple_select` (несколько правильных)
```json
"data": {
  "options": ["run", "blue", "think"],
  "correct": ["run", "think"]
}
```
- `correct` (array | string | number) — список правильных (индексы или тексты).
- По умолчанию используется partial credit, можно переключить через `rubric.scoring.mode`.

### 3.3 `fill_in` (ввод текста)
```json
"data": {
  "answers": ["drink", "have"]
}
```
- `answers` (string | array) — допустимые ответы.

**Режим сравнения** задается в `rubric.match`:
```json
"rubric": {
  "match": {
    "caseInsensitive": true,
    "trim": true,
    "normalizeSpaces": true,
    "ignorePunctuation": true
  }
}
```

### 3.4 `cloze` (пропуски)
```json
"data": {
  "text": "She ___ to the store ___ Saturday.",
  "blanks": [
    { "label": "verb", "answers": ["went", "goes"] },
    { "label": "preposition", "answers": ["on"] }
  ]
}
```
- `text` — текст с `___` для каждого пропуска.
- `blanks` — массив пропусков в порядке следования.
- По умолчанию используется proportional, можно переключить через `rubric.scoring.mode`.

### 3.5 `dictation` (диктант)
```json
"data": {
  "sourceText": "We meet at the station at noon.",
  "audioUrl": "optional-url"
}
```
- Нужен `sourceText` или `audioUrl` (или оба).
- Проверка по совпадению слов.
- По умолчанию используется proportional, можно переключить через `rubric.scoring.mode`.
- **Аудио прослушивание временно отключено**: `audioUrl` хранится, но воспроизведение не работает.

### 3.6 `read_answer` (чтение + вопросы)
```json
"data": {
  "passage": "Text to read...",
  "questions": [
    {
      "questionId": "q1",
      "type": "multiple_choice",
      "prompt": "Question?",
      "options": ["a", "b"],
      "correct": "a"
    },
    {
      "questionId": "q2",
      "type": "fill_in",
      "prompt": "Short answer",
      "answers": ["expected", "allowed"]
    }
  ]
}
```
Поддерживаемые типы вопросов: `multiple_choice`, `multiple_select`, `fill_in`, `short_answer`.
- По умолчанию используется proportional, можно переключить через `rubric.scoring.mode`.

### 3.7 `translate` (перевод)
```json
"data": {
  "direction": "L1->L2",
  "references": ["Hello, how are you?", "Hi, how are you?"]
}
```
- Если `references` пуст, задание остается на self-check.
- Сравнение по ключевым словам.

Дополнительная формализация через `rubric`:
```json
"rubric": {
  "keywords": ["hello", "how", "are", "you"],
  "minMatchPercent": 0.6,
  "scoring": { "mode": "partial" }
}
```

### 3.8 `speaking` (говорение)
```json
"data": {
  "timerPrep": 15,
  "timerSpeak": 60,
  "criteria": ["Fluency", "Vocabulary", "Organization"]
}
```
- Когда аудио включено, запись сохраняется локально как data URL в попытке.
- Самооценка: шкала 1–10 + оценки по критериям.
- **Аудио запись и воспроизведение временно отключены**.

### 3.9 `flashcards` (карточки)
```json
"data": {
  "cards": [
    { "front": "to book", "back": "to reserve" },
    { "front": "journey", "back": "trip" }
  ]
}
```
- Самопроверка: пользователь отмечает `know`, `dont_know`, `wrong`.
- Для оценивания учитывается только `know`.
- По умолчанию используется proportional, можно переключить через `rubric.scoring.mode`.

## 4) Алиасы типов (удобные названия)
При импорте нормализуются в базовые типы:
- `mcq`, `multiplechoice` -> `multiple_choice`
- `multiselect` -> `multiple_select`
- `fill`, `fillin` -> `fill_in`
- `cloze_test` -> `cloze`
- `readandanswer` -> `read_answer`
- `translation` -> `translate`
- `speaking_prompt` -> `speaking`
- `flashcard` -> `flashcards`

## 5) Валидация при импорте
- Проверяются обязательные поля.
- Проверяется уникальность `lessonId` и `taskId`.
- Несоответствие типов вызывает ошибку импорта.
- Конфликт `lessonId`: можно заменить или сохранить как новый (с суффиксом).

## 6) Формат экспортируемых попыток (Attempt)
Попытки можно экспортировать/импортировать. Дедупликация по `attemptId`.

Ключи в `answers`, `autograde`, `manual` строятся как `lessonId::taskId`, чтобы избежать коллизий при объединении баз.

```json
{
  "attemptId": "attempt-...",
  "lessonId": "sample-en-001",
  "timestampStart": "2025-01-01T10:00:00.000Z",
  "timestampEnd": "2025-01-01T10:15:00.000Z",
  "durationSec": 900,
  "mode": "practice",
  "answers": {
    "sample-en-001::mc-1": { "value": 1 }
  },
  "autograde": {
    "sample-en-001::mc-1": { "status": "correct", "pointsEarned": 1, "pointsMax": 1 }
  },
  "manual": {
    "sample-en-001::speak-1": {
      "selfScore": 7,
      "criteria": { "Fluency": 6, "Vocabulary": 7, "Organization": 8 },
      "notes": "Felt nervous",
      "transcript": "",
      "metrics": {},
      "audioDataUrl": ""
    }
  },
  "score": { "pointsEarned": 5, "pointsMax": 8, "percent": 62 },
  "weaknessSnapshot": [{ "tag": "articles", "count": 2, "taskIds": ["mc-1", "fill-1"] }],
  "taskIds": ["mc-1", "fill-1"],
  "taskKeys": ["sample-en-001::mc-1", "sample-en-001::fill-1"]
}
```

Примечание: аудио запись/воспроизведение временно отключены, поэтому `audioDataUrl` остается пустым.

## 7) Пример
См. файл `sample-lesson.json` в корне проекта.
