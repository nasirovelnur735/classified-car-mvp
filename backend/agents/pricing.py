"""
Агент оценки рыночной стоимости. Логика из ноутбука: LLM генерирует синтетические данные,
обучение CatBoost, предсказание цены для одного авто. Без подстановки значений по умолчанию —
если данных не хватает, возвращаем список недостающих полей; пользователь вводит их сам.
Диапазон цены: suggested_price ± MAE (Mean Absolute Error).
"""
import json
import pandas as pd
from catboost import CatBoostRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error

from .client import get_client, get_model

CAT_FEATURES = ["color", "steering_wheel_position", "body_type", "transmission", "drive_type", "damage_flag"]
FEATURE_COLUMNS = [
    "body_type", "color", "steering_wheel_position", "year", "engine_capacity",
    "transmission", "drive_type", "mileage", "damage_flag",
    "visual_condition_score", "inspection_reliability_score",
    "defects_cnt", "defects_severity_weak_cnt", "defects_severity_moderate_cnt", "defects_severity_strong_cnt",
]

# Поля, обязательные для расчёта стоимости. Пустые — пользователь должен заполнить.
REQUIRED_FOR_PRICING = [
    "brand", "model", "body_type", "color", "steering_wheel_position",
    "year", "engine_capacity", "transmission", "drive_type", "mileage", "damage_flag",
]


def _build_pricing_prompt(brand: str, model: str, n_rows: int) -> str:
    return f'''
Ты — генератор синтетических рыночных данных для подержанных автомобилей.
Твоя задача — СГЕНЕРИРОВАТЬ ДАННЫЕ. Ты возвращаешь ТОЛЬКО данные.

Сгенерируй РОВНО {n_rows} записей для ОДНОЙ и той же модели автомобиля:
brand = "{brand}"
model = "{model}"

Каждая запись — отдельный экземпляр (разный год, пробег, состояние, дефекты и цена).

Используй СТРОГО поля: brand, model, body_type, color, steering_wheel_position ("left"|"right"), year (целое), engine_capacity (число), transmission ("manual"|"automatic"|"robot"|"cvt"), drive_type ("fwd"|"rwd"|"awd"|"4wd"), mileage (целое), damage_flag ("не битый"|"битый"|"не определено"), visual_condition_score (0.3-1.0), inspection_reliability_score (0.5-1.0), defects_cnt, defects_severity_weak_cnt, defects_severity_moderate_cnt, defects_severity_strong_cnt, price (рубли, целое).

Логика: больший пробег и старый год → ниже price; лучше состояние → выше price. Цены реалистичны для РФ.
defects_cnt = weak + moderate + strong.

Верни ТОЛЬКО валидный JSON-массив из {n_rows} объектов. Без текста до/после.
Обязательно сгенерируй ровно {n_rows} объектов в массиве. Пустой массив [] возвращать запрещено.
'''


def _to_serializable(v):
    """Преобразует numpy/pandas значения в типы, сериализуемые в JSON."""
    if v is None or (isinstance(v, float) and (v != v or abs(v) == float("inf"))):
        return None
    if pd.isna(v):
        return None
    if hasattr(v, "item"):
        try:
            return v.item()
        except (ValueError, AttributeError):
            return None
    return v


def _extract_json_array(text: str) -> list:
    text = (text or "").strip()
    start = text.find("[")
    if start == -1:
        raise ValueError("No JSON array in response")
    depth = 0
    for i in range(start, len(text)):
        if text[i] in "[{":
            depth += 1
        elif text[i] in "]}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start : i + 1])
    raise ValueError("Unbalanced brackets")


def _check_missing(row: dict) -> list[str]:
    """Возвращает список полей, которые пустые или отсутствуют. Без подстановки значений по умолчанию."""
    missing = []
    if not (row.get("brand") or "").strip():
        missing.append("brand")
    if not (row.get("model") or "").strip():
        missing.append("model")
    if not (row.get("body_type") or "").strip():
        missing.append("body_type")
    if not (row.get("color") or "").strip():
        missing.append("color")
    sp = (row.get("steering_wheel_position") or "").strip()
    if sp not in ("left", "right"):
        missing.append("steering_wheel_position")
    if row.get("year") is None:
        missing.append("year")
    else:
        try:
            int(row["year"])
        except (TypeError, ValueError):
            missing.append("year")
    if row.get("engine_capacity") is None:
        missing.append("engine_capacity")
    else:
        try:
            float(row["engine_capacity"])
        except (TypeError, ValueError):
            missing.append("engine_capacity")
    if not (row.get("transmission") or "").strip():
        missing.append("transmission")
    if not (row.get("drive_type") or "").strip():
        missing.append("drive_type")
    if row.get("mileage") is None:
        missing.append("mileage")
    else:
        try:
            int(row["mileage"])
        except (TypeError, ValueError):
            missing.append("mileage")
    if not (row.get("damage_flag") or "").strip():
        missing.append("damage_flag")
    return missing


def run_pricing(
    brand: str,
    model: str,
    body_type: str,
    color: str,
    steering_wheel_position: str,
    year: int | None,
    engine_capacity: float | None,
    transmission: str,
    drive_type: str,
    mileage: int | None,
    damage_flag: str,
    visual_condition_score: float,
    inspection_reliability_score: float,
    defects: list,
) -> dict:
    """
    Оценка стоимости только при полностью заполненных полях. Никаких значений по умолчанию.
    При отсутствии данных возвращаем missing_fields; пользователь вводит их сам.
    Диапазон: suggested_price ± MAE (Mean Absolute Error по тестовой выборке).
    """
    def _severity_ru(sev: str) -> str:
        s = (sev or "").strip().lower()
        if s in ("слабая", "weak"):
            return "слабая"
        if s in ("умеренная", "moderate"):
            return "умеренная"
        if s in ("сильная", "strong"):
            return "сильная"
        return ""
    weak = sum(1 for d in defects if _severity_ru(d.get("severity") or "") == "слабая")
    moderate = sum(1 for d in defects if _severity_ru(d.get("severity") or "") == "умеренная")
    strong = sum(1 for d in defects if _severity_ru(d.get("severity") or "") == "сильная")
    row = {
        "brand": (brand or "").strip(),
        "model": (model or "").strip(),
        "body_type": (body_type or "").strip(),
        "color": (color or "").strip(),
        "steering_wheel_position": (steering_wheel_position or "").strip(),
        "year": int(year) if year is not None else None,
        "engine_capacity": float(engine_capacity) if engine_capacity is not None else None,
        "transmission": (transmission or "").strip(),
        "drive_type": (drive_type or "").strip(),
        "mileage": int(mileage) if mileage is not None else None,
        "damage_flag": (damage_flag or "").strip(),
        "visual_condition_score": float(visual_condition_score) if visual_condition_score is not None else None,
        "inspection_reliability_score": float(inspection_reliability_score) if inspection_reliability_score is not None else None,
        "defects_cnt": weak + moderate + strong,
        "defects_severity_weak_cnt": weak,
        "defects_severity_moderate_cnt": moderate,
        "defects_severity_strong_cnt": strong,
    }
    missing = _check_missing(row)
    if missing:
        return {
            "min_price": None,
            "max_price": None,
            "suggested_price": None,
            "mae": None,
            "missing_fields": missing,
        }
    n_rows = 50  # больше строк — стабильнее модель и ниже MAE
    client = get_client()
    model_name = get_model()
    prompt = _build_pricing_prompt(row["brand"], row["model"], n_rows)
    # Лимит токенов: 50 объектов с ~20 полями — нужен запас (до ~15k токенов)
    max_tokens = 16384
    rows: list = []
    last_error: str = "empty data"
    for attempt in range(2):  # до 2 попыток при пустом или неполном ответе
        try:
            resp = client.chat.completions.create(
                model=model_name,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.7 if attempt == 0 else 0.9,
                max_completion_tokens=max_tokens,
            )
            raw = (resp.choices[0].message.content or "").strip()
            # Убираем обёртку markdown ```json ... ``` если есть
            if raw.startswith("```"):
                for prefix in ("```json", "```"):
                    if raw.startswith(prefix):
                        raw = raw[len(prefix) :].strip()
                        break
                if raw.endswith("```"):
                    raw = raw[: raw.rfind("```")].strip()
            if not raw:
                raw = "[]"
            rows = _extract_json_array(raw)
            if rows and len(rows) >= 10:
                break
            last_error = "empty data" if not rows else "too few rows"
        except (json.JSONDecodeError, ValueError):
            last_error = "failed to parse synthetic data"
            if attempt == 1:
                return {
                    "min_price": None,
                    "max_price": None,
                    "suggested_price": None,
                    "mae": None,
                    "missing_fields": [],
                    "_reason": last_error,
                }
            continue
        except Exception as e:
            last_error = str(e)
            if attempt == 1:
                return {
                    "min_price": None,
                    "max_price": None,
                    "suggested_price": None,
                    "mae": None,
                    "missing_fields": [],
                    "_error": last_error,
                }
            continue
    if not rows or len(rows) < 10:
        return {"min_price": None, "max_price": None, "suggested_price": None, "mae": None, "missing_fields": [], "_reason": last_error}
    df = pd.DataFrame(rows)
    if "price" not in df.columns or len(df) < 10:
        return {"min_price": None, "max_price": None, "suggested_price": None, "mae": None, "missing_fields": [], "_reason": "no price column or too few rows"}
    drop_cols = [c for c in ["price", "brand", "model"] if c in df.columns]
    X = df.drop(columns=drop_cols, errors="ignore")
    for col in FEATURE_COLUMNS:
        if col not in X.columns:
            X[col] = row.get(col, 0 if "cnt" in col or "score" in col else "")
    y = pd.to_numeric(df["price"], errors="coerce").dropna().astype(int)
    if len(y) < 10:
        return {"min_price": None, "max_price": None, "suggested_price": None, "mae": None, "missing_fields": [], "_reason": "too few valid prices"}
    X = X.loc[y.index]
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    cat_cols = [c for c in CAT_FEATURES if c in X.columns]
    cb = CatBoostRegressor(iterations=300, learning_rate=0.05, depth=6, loss_function="MAE", verbose=False)
    cb.fit(X_train, y_train, cat_features=cat_cols)
    y_pred_test = cb.predict(X_test)
    mae = float(mean_absolute_error(y_test, y_pred_test))
    car_row = {k: row[k] for k in X.columns if k in row}
    for k in X.columns:
        if k not in car_row:
            car_row[k] = row.get(k, 0 if ("cnt" in k or "score" in k) else "")
    car_df = pd.DataFrame([car_row])
    predicted = cb.predict(car_df)
    suggested_price = int(round(predicted[0])) if len(predicted) else None
    if suggested_price is None:
        return {"min_price": None, "max_price": None, "suggested_price": None, "mae": None, "missing_fields": []}
    min_price = max(0, int(round(suggested_price - mae)))
    max_price = int(round(suggested_price + mae))
    # Строки, сгенерированные промптом LLM (для отображения в UI)
    generated_rows = []
    for _, r in df.iterrows():
        generated_rows.append({k: _to_serializable(v) for k, v in r.items()})
    return {
        "min_price": min_price,
        "max_price": max_price,
        "suggested_price": suggested_price,
        "mae": round(mae, 0),
        "missing_fields": [],
        "generated_rows": generated_rows,
    }
