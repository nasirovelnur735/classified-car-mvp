"""
FastAPI backend: приём изображений, вызов оркестратора, возврат канонического JSON.
"""
import base64
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware

from app.schemas import (
    AnalysisResponse,
    CarIdentity,
    VisualCondition,
    TechnicalAssumptions,
    PriceEstimation,
    RecalculatePriceBody,
    RegenerateDescriptionBody,
    PhotoRecommendationsBody,
    PhotoRecommendationsResponse,
)
from app.orchestrator import analyze_images, recalculate_price, regenerate_description
from agents import run_augmentation, run_photo_recommendations, get_generations

app = FastAPI(
    title="Classified Car Ad API",
    description="MVP: загрузка фото → AI-анализ → редактируемое объявление",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    """Healthcheck для Railway/Render."""
    return {"status": "ok"}


@app.post("/api/analyze", response_model=AnalysisResponse)
async def analyze(files: list[UploadFile] = File(...)):
    """
    Загрузка 1+ фото автомобиля. Запускает агентов визуальной инспекции, классификации,
    оценки цены и генерации описания. Возвращает канонический JSON.
    """
    if not files:
        raise HTTPException(status_code=400, detail="Need at least one image")
    images_bytes = []
    for f in files:
        if not f.content_type or not f.content_type.startswith("image/"):
            continue
        raw = await f.read()
        if len(raw) > 15 * 1024 * 1024:  # 15 MB
            continue
        images_bytes.append(raw)
    if not images_bytes:
        raise HTTPException(status_code=400, detail="No valid image files")
    try:
        result = analyze_images(images_bytes)
        return result
    except Exception as e:
        import traceback
        from app.schemas import AnalysisResponse, ConfidenceWarning
        error_msg = str(e)
        traceback.print_exc()
        return AnalysisResponse(
            status="error",
            confidence_warnings=[ConfidenceWarning(field="analysis", confidence="low", reason=f"Ошибка обработки: {error_msg}")],
        )


@app.post("/api/recalculate-price", response_model=PriceEstimation)
async def recalc_price(body: RecalculatePriceBody):
    """
    Пересчёт ценового диапазона по текущим данным формы (в т.ч. после правок пользователя).
    ИИ не затирает пользовательские правки.
    """
    return recalculate_price(
        body.car_identity,
        body.visual_condition,
        body.technical_assumptions,
    )


@app.post("/api/regenerate-description")
async def regenerate_desc(body: RegenerateDescriptionBody):
    """
    Перегенерация текста описания с учётом текущих данных (в т.ч. изменённых пользователем).
    """
    text = regenerate_description(
        body.images_base64 or [],
        body.car_identity,
        body.vision_result,
        body.extra_params or {},
    )
    return {"generated_description": text}


@app.post("/api/photo-recommendations", response_model=PhotoRecommendationsResponse)
async def photo_recommendations(body: PhotoRecommendationsBody):
    """
    Агент-рекомендатель: оценка качества фото, ракурсов и перечень недостающих снимков для объявления.
    """
    raw = run_photo_recommendations(body.images_base64 or [], body.car_context)
    return PhotoRecommendationsResponse(
        verdict=raw.get("verdict") or "has_recommendations",
        quality_issues=raw.get("quality_issues") or [],
        recommendations=raw.get("recommendations") or [],
        missing_photo_types=raw.get("missing_photo_types") or [],
        summary=raw.get("summary") or "",
    )


@app.get("/api/generations")
async def generations(brand: str = "", model: str = ""):
    """
    Список поколений автомобиля по марке и модели (для выпадающего списка).
    Вызов LLM; при пустых brand/model или ошибке возвращается [].
    """
    return {"generations": get_generations(brand, model)}


@app.post("/api/augment-image")
async def augment_image(file: UploadFile = File(...), prompt: str = Form(...)):
    """
    Агент преобразования изображений: улучшение качества (improve) или добавление одного объекта (augment).
    Запрос проверяется на предмет автомобиля и реалистичности сцены.
    """
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Expected an image file")
    raw = await file.read()
    if len(raw) > 15 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large")
    result = run_augmentation(raw, prompt)
    return result
