"""
Агент для получения списка поколений автомобиля по марке и модели.
Используется для выпадающего списка на экране редактирования.
Вход: brand, model. Выход: list[str] — названия/коды поколений (например E90, F30, G20 для BMW 3).
"""
import json
import re
from .client import get_client, get_model

GENERATIONS_PROMPT = """Ты — эксперт по автомобилям. По марке и модели автомобиля верни список поколений (рестайлингов/поколений), которые существуют для этой модели.

Марка: {brand}
Модель: {model}

Поколения указывай в формате, принятом на авторынке: код или название (например E90, F30, G20 для BMW 3 серии; или "IV рестайлинг", "VII" для Lada Vesta).
Верни ТОЛЬКО JSON-массив строк, без пояснений. Пример: ["E46", "E90", "F30", "G20"] или ["I", "II", "III рестайлинг"].
От 1 до 20 элементов, от более старых к более новым где возможно.
Если марка или модель пустые/неизвестны — верни пустой массив: []."""


def _extract_json_array(text: str) -> list:
    text = text.strip()
    # Убрать markdown-обёртку если есть
    if "```" in text:
        text = re.sub(r"```(?:json)?\s*", "", text).strip()
        text = text.rstrip("`")
    start = text.find("[")
    if start == -1:
        return []
    depth = 0
    end = -1
    for i in range(start, len(text)):
        if text[i] == "[":
            depth += 1
        elif text[i] == "]":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end == -1:
        return []
    try:
        arr = json.loads(text[start:end])
        return [str(x).strip() for x in arr if x]
    except (json.JSONDecodeError, TypeError):
        return []


def get_generations(brand: str, model: str) -> list[str]:
    """
    Возвращает список поколений для данной марки и модели.
    При ошибке или пустых brand/model возвращает [].
    """
    brand = (brand or "").strip()
    model = (model or "").strip()
    if not brand or not model:
        return []

    client = get_client()
    llm_model = get_model()
    prompt = GENERATIONS_PROMPT.format(brand=brand, model=model)
    try:
        resp = client.chat.completions.create(
            model=llm_model,
            messages=[{"role": "user", "content": prompt}],
            max_completion_tokens=1024,
        )
        raw = resp.choices[0].message.content or ""
        return _extract_json_array(raw)
    except Exception:
        return []
