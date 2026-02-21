# Классифайд: подготовка объявления о продаже авто (MVP)

Веб-интерфейс и backend-обвязка вокруг **существующих AI-агентов** из `Untitled.ipynb`. Логика агентов не переписывается — только вызов и агрегация результатов.

## Структура

- **Backend** (FastAPI): оркестратор принимает изображения, вызывает агенты из ноутбука (визуальная инспекция, классификация, оценка цены, описание), возвращает единый JSON по каноническому контракту.
- **Frontend** (React + TypeScript): загрузка фото, экран редактирования объявления (все поля редактируемы), блок состояния, блок цены с пересчётом, блок описания с перегенерацией.
- **Агенты** реализованы в `backend/agents/` и повторяют вызовы/промпты из `Untitled.ipynb` (через OpenAI Chat Completions API с vision).

## Требования

- Python 3.11+
- Node.js 18+
- Переменная окружения **`OPENAI_API_KEY`** (обязательна).
- Модели: по умолчанию **gpt-5.1** для всех агентов (инспекция, классификация, цена, описание); только агент преобразования изображений использует **gpt-image-1**. При необходимости можно переопределить через `OPENAI_MODEL` и `OPENAI_IMAGE_MODEL`.
- **Доступ к API OpenAI:** если в вашем регионе доступ к OpenAI ограничен, запускайте **VPN** (например, сервер в США или ЕС) до старта backend — иначе возможны ошибки «Connection error» при анализе фото и генерации описания.
- **Если при включённом VPN перестаёт открываться сайт (localhost):** многие VPN отправляют весь трафик в туннель, в том числе на localhost. Варианты: (1) В настройках VPN включите **split tunnel** / «Исключить локальные адреса» / «Не использовать VPN для локальной сети», чтобы трафик на 127.0.0.1 и локальную сеть шёл мимо VPN. (2) Фронт уже настроен на обращение к backend по `127.0.0.1:8000` — после перезапуска `npm run dev` попробуйте снова; если не поможет, настройте исключение локальных адресов в VPN.

---

## Как запустить

### 1. Backend (FastAPI)

В терминале:

```bash
cd backend
pip install -r requirements.txt
```

Задайте API-ключ и запустите сервер:

**Windows (cmd):**
```cmd
set OPENAI_API_KEY=sk-proj-ваш-ключ
set PYTHONPATH=.
uvicorn app.main:app --reload --port 8000
```

**Windows (PowerShell):**
```powershell
$env:OPENAI_API_KEY="sk-proj-ваш-ключ"
$env:PYTHONPATH="."
uvicorn app.main:app --reload --port 8000
```

**Linux / macOS:**
```bash
export OPENAI_API_KEY=sk-proj-ваш-ключ
export PYTHONPATH=.
uvicorn app.main:app --reload --port 8000
```

Сервер будет доступен по адресу **http://localhost:8000**. Документация API: http://localhost:8000/docs.

### 2. Frontend (React)

В **другом** терминале:

```bash
cd frontend
npm install
npm run dev
```

Откройте в браузере **http://localhost:5173**. Запросы к `/api/*` автоматически проксируются на backend (порт 8000).

## API

- **POST /api/analyze** — загрузка изображений (multipart), возврат полного анализа в каноническом JSON.
- **POST /api/recalculate-price** — тело: `car_identity`, `visual_condition`, `technical_assumptions`, `year?`, `mileage?`; возврат `price_estimation`.
- **POST /api/regenerate-description** — тело: `car_identity`, `vision_result`, `extra_params`, `images_base64?`; возврат `{ "generated_description": "..." }`.
- **POST /api/augment-image** — форма: `file` (изображение), `prompt` (текст запроса). Агент преобразования изображений: проверка запроса (автомобиль, реалистичность), режим improve/augment, возврат `{ "success", "image_base64", "error", "mode" }`.

## Канонический контракт ответа /api/analyze

См. описание в ТЗ: `car_identity`, `visual_condition`, `technical_assumptions`, `price_estimation`, `generated_description`, `confidence_warnings`, `status` (`ok` | `needs_user_input` | `error`). При низкой уверенности или невозможности определить модель/авто возвращается `status: "needs_user_input"` и соответствующие предупреждения в `confidence_warnings`.

---

## Вариант 1: Деплой backend в облако (без VPN)

Если OpenAI API недоступен в вашем регионе, backend можно развернуть в облаке. Сервер будет делать запросы к OpenAI, а фронт — обращаться к вашему облачному backend; VPN на компьютере не нужен.

### Подготовка

- В репозитории уже есть `backend/Dockerfile` и `backend/.dockerignore`.
- Добавлен healthcheck: `GET /api/health`.

### Railway

1. [railway.app](https://railway.app) → New Project → Deploy from GitHub.
2. Выберите репозиторий и укажите **Root Directory** = `backend`.
3. Добавьте переменные окружения: `OPENAI_API_KEY`, при необходимости `OPENAI_MODEL`, `OPENAI_IMAGE_MODEL`.
4. Railway подхватит Dockerfile и задеплоит сервис.
5. В разделе Settings → Networking включите **Generate Domain** и скопируйте URL (например, `https://xxx.up.railway.app`).

### Render

1. [render.com](https://render.com) → New → Web Service.
2. Подключите репозиторий. Укажите:
   - **Root Directory**: `backend`
   - **Environment**: Docker
   - Dockerfile обнаружит автоматически.
3. В разделе Environment добавьте `OPENAI_API_KEY` (и другие переменные при необходимости).
4. После деплоя Render выдаст URL (например, `https://xxx.onrender.com`).

### Подключение фронта к облачному backend

1. После деплоя получите URL backend (Railway или Render).
2. Запустите фронт с этой переменной:
   ```bash
   cd frontend
   VITE_API_URL=https://ваш-backend.railway.app npm run dev
   ```
   **Windows PowerShell:**
   ```powershell
   $env:VITE_API_URL="https://ваш-backend.railway.app"
   npm run dev
   ```
3. Или соберите продакшн-сборку:
   ```bash
   VITE_API_URL=https://ваш-backend.railway.app npm run build
   ```
4. В браузере фронт будет слать запросы на облачный backend; VPN на вашем ПК не нужен.

---

## Важно

- Агенты из `Untitled.ipynb` используются как «чёрный ящик»: только вызов и маппинг в контракт.
- ИИ не затирает пользовательские правки: пересчёт цены и перегенерация описания работают по текущим данным формы.
