"""
Оркестратор: принимает изображения, вызывает агентов из ipynb, агрегирует ответы в канонический JSON.
Логику агентов не переписываем — только вызов и маппинг в контракт.
Для ускорения: vision и classification запускаются параллельно; затем pricing и description — тоже параллельно.
"""
import base64
import io
from concurrent.futures import ThreadPoolExecutor
from typing import List

from app.schemas import (
    AnalysisResponse,
    CarIdentity,
    VisualCondition,
    TechnicalAssumptions,
    PriceEstimation,
    ConfidenceWarning,
    DefectItem,
    SEVERITY_MAP,
    DEFECT_TYPE_MAP,
)
from agents import run_vision, run_classification, run_pricing, run_description


def _normalize_defect_type(t: str) -> str:
    t_lower = (t or "").strip().lower()
    for ru, en in DEFECT_TYPE_MAP.items():
        if ru in t_lower or t_lower in ru:
            return en
    if not t_lower:
        return "scratch"
    if "царапин" in t_lower:
        return "scratch"
    if "вмятин" in t_lower or "деформац" in t_lower:
        return "dent"
    if "скол" in t_lower:
        return "chip"
    if "коррози" in t_lower or "ржавчин" in t_lower:
        return "corrosion"
    if "окраш" in t_lower or "перекраш" in t_lower:
        return "painted"
    if "замен" in t_lower:
        return "replaced"
    return "scratch"


def _map_defects(vision: dict) -> list[DefectItem]:
    raw = vision.get("defects") or []
    if not isinstance(raw, list):
        return []
    out = []
    for d in raw:
        if not isinstance(d, dict):
            continue
        try:
            severity_ru = str(d.get("severity") or "слабая").strip().lower()
            severity = SEVERITY_MAP.get(severity_ru, "weak")
            defect_type = _normalize_defect_type(str(d.get("type") or ""))
            if defect_type not in ("scratch", "dent", "chip", "corrosion", "replaced", "painted"):
                defect_type = "scratch"
            body_part = str(d.get("body_part") or "").strip()
            location = str(d.get("location") or "").strip()
            out.append(
                DefectItem(
                    type=defect_type,
                    severity=severity,
                    location=location,
                    body_part=body_part,
                )
            )
        except Exception:
            continue  # Пропускаем некорректные дефекты
    return out


def _confidence_warnings(
    classification: dict,
    vision: dict,
    price_est: dict,
) -> list[ConfidenceWarning]:
    warnings = []
    try:
        conf = classification.get("classification_confidence") or {}
        if isinstance(conf, dict) and (conf.get("category") == "low" or conf.get("subcategory") == "low"):
            warnings.append(
                ConfidenceWarning(field="model", confidence="low", reason="Низкая уверенность визуальной классификации")
            )
        if not classification.get("brand") or not classification.get("model"):
            warnings.append(
                ConfidenceWarning(field="model", confidence="low", reason="Марка или модель не определены по фото")
            )
        insp = vision.get("inspection_reliability_score")
        if isinstance(insp, (int, float)) and insp < 0.6:
            warnings.append(
                ConfidenceWarning(field="visual_condition", confidence="medium", reason="Ограниченная видимость на фото")
            )
        if price_est.get("suggested_price") is None and (price_est.get("missing_fields") or price_est.get("_error") or price_est.get("_reason")):
            warnings.append(
                ConfidenceWarning(field="price_estimation", confidence="low", reason="Недостаточно данных для оценки цены")
            )
    except Exception:
        pass  # Игнорируем ошибки при формировании предупреждений
    return warnings


def _decide_status(vision: dict, classification: dict) -> str:
    try:
        if vision.get("_error") or vision.get("_parse_error"):
            return "error"
        if classification.get("_error") or classification.get("_parse_error"):
            return "error"
        raw_desc = str(vision.get("raw_text_description") or "").lower()
        if "анализ невозможен" in raw_desc or "не содержит автомобиль" in raw_desc or "не соответствует задаче" in raw_desc:
            return "needs_user_input"
        status = str(classification.get("status") or "")
        if status == "failed" and classification.get("failure_reason"):
            return "needs_user_input"
        if not classification.get("brand") and not classification.get("model"):
            return "needs_user_input"
        return "ok"
    except Exception:
        return "error"


def analyze_images(images_bytes: List[bytes]) -> AnalysisResponse:
    """
    Основной поток: изображения -> агенты -> канонический JSON.
    """
    if not images_bytes:
        return AnalysisResponse(
            status="needs_user_input",
            confidence_warnings=[ConfidenceWarning(field="images", confidence="low", reason="Нет загруженных фото")],
        )
    images_b64 = []
    for raw in images_bytes:
        b64 = base64.b64encode(raw).decode("utf-8")
        images_b64.append(b64)

    # 1) Параллельно: визуальная инспекция и классификация (сокращает время в ~2 раза)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            fut_vision = executor.submit(run_vision, images_b64)
            fut_classification = executor.submit(run_classification, images_b64)
            vision = fut_vision.result()
            classification = fut_classification.result()
    except Exception as e:
        return AnalysisResponse(
            status="error",
            confidence_warnings=[ConfidenceWarning(field="agents", confidence="low", reason=f"Ошибка выполнения агентов: {str(e)}")],
        )

    # 2) Маппинг в контракт (все поля как в df_for_pricing ноутбука)
    # Безопасная обработка: если vision/classification вернули ошибку, используем дефолты
    def safe_str(value) -> str:
        if value is None:
            return ""
        return str(value).strip()
    
    damage_flag_str = safe_str(vision.get("damage_flag") or "не определено")
    car_identity = CarIdentity(
        brand=safe_str(classification.get("brand")),
        model=safe_str(classification.get("model")),
        generation="",
        year=None,
        body_type=safe_str(classification.get("body_type")),
        color=safe_str(classification.get("color")),
        steering_wheel_position=safe_str(classification.get("steering_wheel_position")),
        engine_capacity=None,
        transmission=safe_str(classification.get("transmission")),
        drive_type="",
        mileage=None,
        damage_flag=damage_flag_str,
    )
    try:
        visual_score = float(vision.get("visual_condition_score") or 0.0)
    except (ValueError, TypeError):
        visual_score = 0.0
    visual_condition = VisualCondition(
        overall_score=visual_score,
        defects=_map_defects(vision),
    )
    technical_assumptions = TechnicalAssumptions(
        accident_signs=damage_flag_str.lower() == "битый",
        repaint_probability=0.0,
    )

    # 3) Подготовка данных для цены и описания
    df_for_pricing = {
        "brand": car_identity.brand,
        "model": car_identity.model,
        "body_type": car_identity.body_type,
        "color": car_identity.color,
        "steering_wheel_position": car_identity.steering_wheel_position,
        "year": car_identity.year,
        "engine_capacity": car_identity.engine_capacity,
        "transmission": car_identity.transmission,
        "drive_type": car_identity.drive_type,
        "mileage": car_identity.mileage,
        "damage_flag": car_identity.damage_flag,
        "visual_condition_score": visual_condition.overall_score,
        "defects_cnt": len(visual_condition.defects),
    }

    # 4) Параллельно: оценка цены и генерация описания (оба зависят только от уже собранных данных)
    def _run_pricing() -> dict:
        return run_pricing(
            brand=car_identity.brand,
            model=car_identity.model,
            body_type=car_identity.body_type,
            color=car_identity.color,
            steering_wheel_position=car_identity.steering_wheel_position,
            year=car_identity.year,
            engine_capacity=car_identity.engine_capacity,
            transmission=car_identity.transmission,
            drive_type=car_identity.drive_type,
            mileage=car_identity.mileage,
            damage_flag=car_identity.damage_flag,
            visual_condition_score=visual_condition.overall_score,
            inspection_reliability_score=float(vision.get("inspection_reliability_score") or 0.5) if vision.get("inspection_reliability_score") is not None else 0.5,
            defects=vision.get("defects") or [],
        )

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            fut_price = executor.submit(_run_pricing)
            fut_desc = executor.submit(run_description, images_b64, classification, vision, df_for_pricing)
            price_est = fut_price.result()
            generated_description = fut_desc.result()
    except Exception as e:
        # Если ошибка в pricing/description, продолжаем с дефолтами
        import traceback
        traceback.print_exc()
        price_est = {"_error": str(e)}
        generated_description = ""

    err_msg = price_est.get("_error") or price_est.get("_reason")
    def safe_int(value):
        if value is None:
            return None
        try:
            return int(value)
        except (ValueError, TypeError):
            return None
    
    def safe_float(value):
        if value is None:
            return None
        try:
            return float(value)
        except (ValueError, TypeError):
            return None
    
    price_estimation = PriceEstimation(
        min_price=safe_int(price_est.get("min_price")),
        max_price=safe_int(price_est.get("max_price")),
        suggested_price=safe_int(price_est.get("suggested_price")),
        mae=safe_float(price_est.get("mae")),
        missing_fields=price_est.get("missing_fields") if isinstance(price_est.get("missing_fields"), list) else [],
        error_message=str(err_msg) if err_msg else None,
        generated_rows=price_est.get("generated_rows") if isinstance(price_est.get("generated_rows"), list) else None,
    )

    # 5) Предупреждения и статус
    confidence_warnings = _confidence_warnings(classification, vision, price_est)
    status = _decide_status(vision, classification)

    return AnalysisResponse(
        car_identity=car_identity,
        visual_condition=visual_condition,
        technical_assumptions=technical_assumptions,
        price_estimation=price_estimation,
        generated_description=generated_description,
        confidence_warnings=confidence_warnings,
        status=status,
        vision_result=vision,
    )


def recalculate_price(
    car_identity: CarIdentity,
    visual_condition: VisualCondition,
    technical_assumptions: TechnicalAssumptions,
) -> PriceEstimation:
    """Пересчёт цены по текущим данным. Без подстановки по умолчанию; при нехватке полей возвращаем missing_fields."""
    damage_flag = "битый" if technical_assumptions.accident_signs else (car_identity.damage_flag or "не битый")
    defects_raw = [
        {"type": d.type, "severity": d.severity, "location": d.location}
        for d in visual_condition.defects
    ]
    raw = run_pricing(
        brand=car_identity.brand,
        model=car_identity.model,
        body_type=car_identity.body_type,
        color=car_identity.color,
        steering_wheel_position=car_identity.steering_wheel_position,
        year=car_identity.year,
        engine_capacity=car_identity.engine_capacity,
        transmission=car_identity.transmission,
        drive_type=car_identity.drive_type,
        mileage=car_identity.mileage,
        damage_flag=damage_flag,
        visual_condition_score=visual_condition.overall_score,
        inspection_reliability_score=0.7,
        defects=defects_raw,
    )
    err_msg = raw.get("_error") or raw.get("_reason")
    return PriceEstimation(
        min_price=raw.get("min_price"),
        max_price=raw.get("max_price"),
        suggested_price=raw.get("suggested_price"),
        mae=raw.get("mae"),
        missing_fields=raw.get("missing_fields") or [],
        error_message=str(err_msg) if err_msg else None,
        generated_rows=raw.get("generated_rows"),
    )


def regenerate_description(
    images_base64: list[str],
    car_identity: CarIdentity,
    vision_result: dict,
    extra_params: dict,
) -> str:
    """Перегенерация описания с учётом текущих (возможно пользовательских) данных."""
    classification_result = {
        "brand": car_identity.brand,
        "model": car_identity.model,
        "body_type": car_identity.body_type,
        "color": car_identity.color,
    }
    df_for_pricing = {
        "brand": car_identity.brand,
        "model": car_identity.model,
        "body_type": car_identity.body_type,
        "color": car_identity.color,
        "year": car_identity.year or extra_params.get("year"),
        "mileage": extra_params.get("mileage"),
        **extra_params,
    }
    return run_description(images_base64, classification_result, vision_result, df_for_pricing)
