"""
Проверка согласованности изображений: все фото должны относиться к одному автомобилю.
"""
import json

from .client import get_client, get_model

CONSISTENCY_PROMPT = """
Ты — агент проверки согласованности набора фотографий автомобиля.

ЗАДАЧА:
Определи, относятся ли ВСЕ предоставленные изображения к одному и тому же автомобилю.

КРИТЕРИИ:
- Если на фото явно разные автомобили — verdict = "multiple_cars".
- Если недостаточно данных, чтобы уверенно подтвердить, что это один автомобиль — verdict = "uncertain".
- Если все фото относятся к одному автомобилю — verdict = "single_car".

ВАЖНО:
- Нужна высокая уверенность для "single_car".
- При любом сомнении выбирай "uncertain".
- Не придумывай детали, опирайся только на визуальные признаки.

Ответь СТРОГО JSON-объектом без дополнительного текста:
{
  "verdict": "single_car" | "multiple_cars" | "uncertain",
  "reason": "краткое объяснение",
  "confidence": "high" | "medium" | "low"
}
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


def run_consistency_check(images_base64: list[str]) -> dict:
    client = get_client()
    model = get_model()
    content = [{"type": "text", "text": CONSISTENCY_PROMPT}]
    for b64 in images_base64:
        url = f"data:image/jpeg;base64,{b64}" if not b64.startswith("data:") else b64
        content.append({"type": "image_url", "image_url": {"url": url}})

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": content}],
            max_completion_tokens=512,
        )
        raw = resp.choices[0].message.content or ""
        parsed = _extract_json(raw)
        verdict = parsed.get("verdict")
        if verdict not in ("single_car", "multiple_cars", "uncertain"):
            raise ValueError("Invalid verdict")
        confidence = parsed.get("confidence")
        if confidence not in ("high", "medium", "low"):
            confidence = "low"
        return {
            "verdict": verdict,
            "reason": str(parsed.get("reason") or "").strip(),
            "confidence": confidence,
        }
    except Exception as e:
        return {
            "verdict": "uncertain",
            "reason": f"Ошибка проверки согласованности: {str(e)}",
            "confidence": "low",
            "_error": str(e),
        }
