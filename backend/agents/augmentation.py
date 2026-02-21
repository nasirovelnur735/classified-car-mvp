# =========================
# Image Augmentation Agent
# =========================
# Логика из ноутбука: проверка запроса (domain/realism/mode), затем improve или augment.
# Использует OPENAI_API_KEY из client.get_client().

import json
import base64
from io import BytesIO

from PIL import Image

from .client import get_client, get_model, get_image_model

MODE_PROMPT_TEMPLATE = """
Ты анализируешь запрос пользователя к агенту обработки изображений автомобилей.

Твоя задача — выполнить ТРИ проверки.

────────────────────
1. DOMAIN CHECK
────────────────────
Запрос допустим ТОЛЬКО если он относится к автомобилю
и визуальному изменению фотографии машины.

────────────────────
2. REALISM CHECK
────────────────────
Допустимы ТОЛЬКО реалистичные, физически возможные сцены.

РАЗРЕШЕНО:
- добавление временных предметов (чемодан, кофе, сумка, кальян)
- предметы могут находиться НА или РЯДОМ с автомобилем
- сцена выглядит как обычная фотография

ЗАПРЕЩЕНО:
- фантазийные сцены
- художественный рендер
- иллюстрация
- игрушечный масштаб
- изменение геометрии автомобиля
- смена погоды, времени суток, окружения

────────────────────
3. MODE DETECTION
────────────────────
Определи режим:

- "improve"  — улучшение качества фото БЕЗ добавления объектов
- "augment"  — добавление ОДНОГО объекта без изменения сцены

Ответь СТРОГО в формате JSON без пояснений:

{{
  "domain": "car" | "not_car",
  "realism": "acceptable" | "unacceptable",
  "mode": "improve" | "augment"
}}

Запрос пользователя:
{user_prompt}

Возвращай ТОЛЬКО один JSON-объект.
Не добавляй никакой текст до или после JSON.
"""

IMPROVE_PROMPT_TEMPLATE = """
Ты — агент улучшения фотографий автомобилей для объявлений.

ЗАДАЧА:
Улучшить качество изображения на основе исходного фото.

СТРОГИЕ ПРАВИЛА:
- Используй ТОЛЬКО предоставленное изображение
- НЕ добавляй новые объекты
- НЕ меняй форму, цвет и геометрию автомобиля
- НЕ скрывай и не маскируй дефекты
- Разрешено:
  • улучшить резкость
  • улучшить экспозицию
  • слегка улучшить контраст
- Запрещены художественные стили и рендер
- Итог должен выглядеть как реальное фото

ЗАПРОС ПОЛЬЗОВАТЕЛЯ:
{user_prompt}
"""

AUGMENT_PROMPT_TEMPLATE = """
Ты — агент локального дополнения фотографии автомобиля.

ЗАДАЧА:
Добавить ОДИН физически возможный объект
на исходное фото автомобиля.

СТРОГИЕ ПРАВИЛА (ОБЯЗАТЕЛЬНЫ):
- Исходное изображение должно остаться ФОТОГРАФИЕЙ
- Запрещено менять:
  • освещение
  • цветовую температуру
  • погоду
  • фон
  • стиль изображения
- Запрещено перерисовывать автомобиль
- Запрещено улучшать сцену
- Запрещены киноэффекты и художественный стиль

РАЗРЕШЕНО:
- Добавить ТОЛЬКО один объект
- Объект должен выглядеть как реально поставленный
- Масштаб, перспектива и тени — реалистичные
- Всё должно выглядеть как обычное фото с телефона

ОБЪЕКТ ДЛЯ ДОБАВЛЕНИЯ:
{user_prompt}

ВАЖНО:
Если невозможно добавить объект без перерисовки сцены —
выполни минимальное вмешательство и сохрани фото.
"""


def _extract_json(text: str) -> dict:
    text = (text or "").strip()
    start = text.find("{")
    if start == -1:
        raise ValueError("No JSON object in response")
    depth = 0
    end = -1
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end == -1:
        raise ValueError("Unbalanced braces")
    return json.loads(text[start:end])


def run_augmentation(image_bytes: bytes, user_prompt: str) -> dict:
    """
    Агент преобразования изображений (Image Augmentation Agent).
    Вход: image_bytes (исходное фото), user_prompt (запрос: улучшить или что добавить).
    Выход: dict с ключами:
      - success: bool
      - image_base64: str | None — результат в base64 (JPEG/PNG)
      - error: str | None — сообщение при отклонении или ошибке
      - mode: "improve" | "augment" | None
    """
    client = get_client()
    chat_model = get_model()
    image_model = get_image_model()

    if not (user_prompt or "").strip():
        return {"success": False, "image_base64": None, "error": "Запрос пользователя пуст.", "mode": None}

    # 1) LLM: Domain / Realism / Mode
    try:
        resp = client.chat.completions.create(
            model=chat_model,
            messages=[{"role": "user", "content": MODE_PROMPT_TEMPLATE.format(user_prompt=user_prompt.strip())}],
            max_completion_tokens=256,
        )
        raw = resp.choices[0].message.content or ""
        analysis = _extract_json(raw)
    except Exception as e:
        return {"success": False, "image_base64": None, "error": f"Ошибка анализа запроса: {e}", "mode": None}

    # 2) Валидация
    if analysis.get("domain") != "car":
        return {"success": False, "image_base64": None, "error": "Запрос отклонён: не относится к автомобилю.", "mode": None}
    if analysis.get("realism") != "acceptable":
        return {"success": False, "image_base64": None, "error": "Запрос отклонён: нереалистичная сцена.", "mode": None}
    mode = analysis.get("mode")
    if mode not in ("improve", "augment"):
        return {"success": False, "image_base64": None, "error": "Некорректный режим обработки.", "mode": mode}

    # 3) Промпт для изображения
    image_prompt = IMPROVE_PROMPT_TEMPLATE.format(user_prompt=user_prompt.strip()) if mode == "improve" else AUGMENT_PROMPT_TEMPLATE.format(user_prompt=user_prompt.strip())

    # 4) Подготовка изображения (PIL -> RGB JPEG в BytesIO)
    try:
        with Image.open(BytesIO(image_bytes)) as img:
            img = img.convert("RGB")
            buffer = BytesIO()
            img.save(buffer, format="JPEG", quality=95)
            buffer.seek(0)
            buffer.name = "input.jpg"
            image_file = buffer
    except Exception as e:
        return {"success": False, "image_base64": None, "error": f"Ошибка чтения изображения: {e}", "mode": mode}

    # 5) Image-to-image edit (API OpenAI)
    try:
        # client.images.edit может отличаться в актуальной версии SDK; при необходимости заменить на images.generate с image
        result = client.images.edit(
            model=image_model,
            image=image_file,
            prompt=image_prompt,
            size="1024x1024",
        )
    except AttributeError:
        return {"success": False, "image_base64": None, "error": "API images.edit недоступен. Проверьте модель и версию SDK.", "mode": mode}
    except Exception as e:
        return {"success": False, "image_base64": None, "error": str(e), "mode": mode}

    # 6) Результат: b64_json или url
    if not result.data or len(result.data) == 0:
        return {"success": False, "image_base64": None, "error": "Нет данных в ответе API изображений.", "mode": mode}
    first = result.data[0]
    b64 = getattr(first, "b64_json", None) or getattr(first, "b64", None)
    if b64:
        return {"success": True, "image_base64": b64, "error": None, "mode": mode}
    # если вернулся url
    url = getattr(first, "url", None)
    if url:
        import urllib.request
        try:
            with urllib.request.urlopen(url) as r:
                b64 = base64.b64encode(r.read()).decode("utf-8")
            return {"success": True, "image_base64": b64, "error": None, "mode": mode}
        except Exception as e:
            return {"success": False, "image_base64": None, "error": f"Не удалось загрузить результат: {e}", "mode": mode}
    return {"success": False, "image_base64": None, "error": "Неизвестный формат ответа API изображений.", "mode": mode}
