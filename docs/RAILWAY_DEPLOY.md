# Деплой backend на Railway

## Шаги (по порядку)

1. **Залогиньтесь:** [railway.app](https://railway.app) → войдите через GitHub.

2. **Новый проект:** New Project → **Deploy from GitHub repo** → выберите репозиторий с этим проектом.

3. **Настройка сервиса:**
   - После добавления репозитория откройте сервис (backend).
   - **Settings** → **Source**:
     - **Root Directory:** укажите `backend` (обязательно, иначе Docker не найдёт `requirements.txt` и код).
   - **Settings** → **Build:**
     - Builder должен определиться как **Dockerfile** (в папке `backend` есть `Dockerfile` и `railway.toml`).
     - Если Railway не подхватил Dockerfile: в переменных окружения добавьте `RAILWAY_DOCKERFILE_PATH` = `backend/Dockerfile` и оставьте Root Directory пустым (тогда в Dockerfile пути должны быть от корня репо — у нас сейчас рассчитано на Root Directory = `backend`).

4. **Переменные окружения (Variables):**
   - `OPENAI_API_KEY` = ваш ключ OpenAI (обязательно).
   - По желанию: `OPENAI_MODEL` = `gpt-5.1` или `gpt-4.1`, `OPENAI_IMAGE_MODEL` = `gpt-image-1`.
   - Для NeuroAPI вместо OpenAI: `NEUROAPI_API_KEY` = ключ с [neuroapi.host](https://neuroapi.host) (тогда `OPENAI_API_KEY` не нужен).

5. **Домен:** **Settings** → **Networking** → **Generate Domain** → скопируйте URL (например `https://xxx.up.railway.app`).

6. **Деплой:** при включённом Root Directory = `backend` после пуша в GitHub Railway пересоберёт образ и задеплоит. Логи смотрите во вкладке **Deployments**.

## Проверка

- Откройте в браузере: `https://ваш-домен.up.railway.app/api/health`  
  Должен вернуться JSON: `{"status":"ok"}`.

## Частые проблемы

| Проблема | Решение |
|----------|--------|
| Сборка падает на `COPY requirements.txt` | Убедитесь, что **Root Directory** = `backend`. |
| Сервис падает после старта | Проверьте логи (Deployments → последний деплой → View Logs). Часто причина — не задан `OPENAI_API_KEY` или `NEUROAPI_API_KEY`. |
| Healthcheck failed | Railway дергает `/api/health`; убедитесь, что порт берётся из `PORT` (в Dockerfile уже `PORT:-8000`). |
| Долгая сборка | Первая сборка может занимать 5–10 минут (установка CatBoost, scikit-learn). |

## Подключение фронта

Локально (PowerShell):

```powershell
cd frontend
$env:VITE_API_URL="https://ваш-домен.up.railway.app"
npm run dev
```

Или при сборке продакшна:

```powershell
$env:VITE_API_URL="https://ваш-домен.up.railway.app"
npm run build
```

После этого фронт будет ходить за данными на ваш backend в Railway.
