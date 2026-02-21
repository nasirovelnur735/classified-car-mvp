"""
Канонический контракт данных API. Backend всегда возвращает JSON этой структуры.
"""
from typing import Literal
from pydantic import BaseModel, Field


class CarIdentity(BaseModel):
    brand: str = ""
    model: str = ""
    generation: str = ""
    year: int | None = None
    body_type: str = ""
    color: str = ""
    steering_wheel_position: str = ""
    engine_capacity: float | None = None
    transmission: str = ""
    drive_type: str = ""
    mileage: int | None = None
    damage_flag: str = ""  # "битый" | "не битый" | "не определено"


class DefectItem(BaseModel):
    type: Literal["scratch", "dent", "chip", "corrosion", "replaced", "painted"] | str = "scratch"
    severity: Literal["weak", "moderate", "strong"] = "weak"
    location: str = ""
    body_part: str = ""  # hood, front_door_left, rear_bumper, ... для привязки к диаграмме кузова


class VisualCondition(BaseModel):
    overall_score: float = 0.0
    defects: list[DefectItem] = Field(default_factory=list)


class TechnicalAssumptions(BaseModel):
    accident_signs: bool = False
    repaint_probability: float = 0.0


class PriceEstimation(BaseModel):
    min_price: int | None = None
    max_price: int | None = None
    suggested_price: int | None = None
    mae: float | None = None  # Mean Absolute Error — диапазон: цена ± MAE
    missing_fields: list[str] = Field(default_factory=list)  # поля, которые нужно заполнить для оценки
    error_message: str | None = None  # сообщение об ошибке (LLM, таймаут и т.д.)
    generated_rows: list[dict] | None = None  # строки, сгенерированные промптом LLM для обучения модели


class ConfidenceWarning(BaseModel):
    field: str = ""
    confidence: Literal["high", "medium", "low"] = "low"
    reason: str = ""


class AnalysisResponse(BaseModel):
    car_identity: CarIdentity = Field(default_factory=CarIdentity)
    visual_condition: VisualCondition = Field(default_factory=VisualCondition)
    technical_assumptions: TechnicalAssumptions = Field(default_factory=TechnicalAssumptions)
    price_estimation: PriceEstimation = Field(default_factory=PriceEstimation)
    generated_description: str = ""
    confidence_warnings: list[ConfidenceWarning] = Field(default_factory=list)
    status: Literal["ok", "needs_user_input", "error"] = "ok"
    # Для перегенерации описания и отображения ограничений (не затирается пользователем)
    vision_result: dict = Field(default_factory=dict)


class RecalculatePriceBody(BaseModel):
    car_identity: CarIdentity
    visual_condition: VisualCondition
    technical_assumptions: TechnicalAssumptions


class RegenerateDescriptionBody(BaseModel):
    car_identity: CarIdentity
    vision_result: dict = Field(default_factory=dict)
    extra_params: dict = Field(default_factory=dict)
    images_base64: list[str] = Field(default_factory=list)


class PhotoRecommendationsBody(BaseModel):
    images_base64: list[str] = Field(default_factory=list)
    car_context: str | None = None  # например "Toyota Camry" для контекста в промпте


class PhotoRecommendationsResponse(BaseModel):
    verdict: Literal["all_ok", "has_recommendations"] = "has_recommendations"
    quality_issues: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    missing_photo_types: list[str] = Field(default_factory=list)
    summary: str = ""


# Severity mapping from notebook (Russian) to contract
SEVERITY_MAP = {"слабая": "weak", "умеренная": "moderate", "сильная": "strong"}
# Type: notebook returns free text (e.g. "царапина", "загрязнение"); map to contract or pass as-is
DEFECT_TYPE_MAP = {
    "царапина": "scratch",
    "вмятина": "dent",
    "скол": "chip",
    "коррозия": "corrosion",
    "загрязнение": "chip",
    "окрашена": "painted",
    "перекрашена": "painted",
    "заменена": "replaced",
}
