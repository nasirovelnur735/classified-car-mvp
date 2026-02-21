"""
Агент-рекомендатель по фото: качество снимков, ракурсы, каких фото не хватает для объявления.
Вход: список изображений (base64), опционально краткий контекст (марка/модель).
Выход: вердикт, замечания по качеству, рекомендации, список недостающих типов фото.
"""
import json
from .client import get_client, get_model

RECOMMENDER_PROMPT = """
Ты — эксперт по фотосъёмке автомобилей для объявлений на досках (типа «Дром», «Авито»).

По предоставленным фотографиям одного автомобиля оцени:
1) **Качество фото**: размытость (motion_blur, нечёткость), освещение (тёмно/пересвет), разрешение, отражения на кузове/стёклах, закрытие кадра посторонними объектами.
2) **Ракурсы**: удачные ли ракурсы; с какого ракурса лучше бы снять (спереди, сбоку, сзади, интерьер, приборная панель, одометр, VIN, двигатель, багажник, колёса/диски).
3) **Недостающие фото**: каких снимков не хватает для полноценного объявления. Типично полезны: общий вид спереди/сбоку/сзади, салон (передние сиденья, задние), приборная панель и одометр, VIN (шильдик), двигатель (под капотом), багажник, колёса/диски, документы (если уместно).

Правила:
- Если фото сделаны хорошо и всего достаточно — скажи, что рекомендаций нет, всё замечательно.
- Будь конкретен: не «добавьте фото салона», а «добавьте фото передних сидений и руля» при необходимости.
- Не придумывай дефекты автомобиля — только оценка качества и полноты фото.
- Учитывай, что все изображения относятся к одному автомобилю.

Верни ответ СТРОГО в формате JSON без текста до/после:
{
  "verdict": "all_ok" | "has_recommendations",
  "quality_issues": ["строка с замечанием по качеству 1", "..."],
  "recommendations": ["рекомендация 1", "рекомендация 2", "..."],
  "missing_photo_types": ["тип недостающего фото на русском", "..."],
  "summary": "Краткий итог одним предложением на русском."
}

- verdict: "all_ok" — замечаний нет, фото в порядке; "has_recommendations" — есть что улучшить или добавить.
- quality_issues: пустой массив [], если замечаний по качеству нет. Иначе перечисли (размытость, тёмное фото, отражения и т.д.).
- recommendations: общий список советов (качество + ракурсы + чего не хватает). Пустой [], если рекомендаций нет.
- missing_photo_types: только типы недостающих фото (например: "Вид спереди", "Салон", "Одометр", "VIN", "Двигатель под капотом"). Пустой [], если всего достаточно.
- summary: одно короткое предложение для пользователя.
"""


def _extract_json(text: str) -> dict:
    text = (text or "").strip()
    start = text.find("{")
    if start == -1:
        raise ValueError("No JSON object in response")
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start : i + 1])
    raise ValueError("Unbalanced braces")


def run_photo_recommendations(images_base64: list[str], car_context: str | None = None) -> dict:
    """
    Анализирует фото и возвращает рекомендации: качество, ракурсы, каких фото не хватает.
    car_context: опционально "Марка Модель" для контекста в промпте.
    """
    if not images_base64:
        return {
            "verdict": "has_recommendations",
            "quality_issues": [],
            "recommendations": ["Добавьте хотя бы одно фото автомобиля."],
            "missing_photo_types": ["Любое фото автомобиля"],
            "summary": "Нет загруженных фото.",
            "_error": "no images",
        }
    client = get_client()
    model = get_model()
    prompt = RECOMMENDER_PROMPT
    if car_context and car_context.strip():
        prompt += f'\n\nКонтекст: автомобиль — {car_context.strip()}.'
    content = [{"type": "text", "text": prompt}]
    for b64 in images_base64[:20]:  # не более 20 фото
        url = f"data:image/jpeg;base64,{b64}" if not b64.startswith("data:") else b64
        content.append({"type": "image_url", "image_url": {"url": url}})
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": content}],
            max_completion_tokens=2048,
        )
        raw = resp.choices[0].message.content or "{}"
    except Exception as e:
        return {
            "verdict": "has_recommendations",
            "quality_issues": [],
            "recommendations": [],
            "missing_photo_types": [],
            "summary": "Не удалось получить рекомендации.",
            "_error": str(e),
        }
    try:
        out = _extract_json(raw)
        verdict = out.get("verdict") or "has_recommendations"
        if verdict not in ("all_ok", "has_recommendations"):
            verdict = "has_recommendations"
        return {
            "verdict": verdict,
            "quality_issues": out.get("quality_issues") if isinstance(out.get("quality_issues"), list) else [],
            "recommendations": out.get("recommendations") if isinstance(out.get("recommendations"), list) else [],
            "missing_photo_types": out.get("missing_photo_types") if isinstance(out.get("missing_photo_types"), list) else [],
            "summary": str(out.get("summary") or "").strip() or "Анализ выполнен.",
        }
    except (json.JSONDecodeError, ValueError) as e:
        return {
            "verdict": "has_recommendations",
            "quality_issues": [],
            "recommendations": [],
            "missing_photo_types": [],
            "summary": "Не удалось разобрать ответ.",
            "_parse_error": str(e),
        }
