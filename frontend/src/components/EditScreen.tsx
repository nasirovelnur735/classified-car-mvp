import { useCallback, useState, useEffect, useMemo, useRef } from "react";
import { recalculatePrice, regenerateDescription, augmentImage, getPhotoRecommendations, getGenerations } from "../api";
import type {
  AnalysisResponse,
  CarIdentity,
  VisualCondition,
  TechnicalAssumptions,
  PriceEstimation,
  ConfidenceWarning,
  UserEditedSet,
  PhotoRecommendationsResponse,
} from "../types";
import "./EditScreen.css";

type Props = {
  data: AnalysisResponse;
  files: File[];
  setFiles: (files: File[]) => void;
  onBack: () => void;
};

const DEFECT_SEVERITY_LABEL: Record<string, string> = {
  weak: "Слабая",
  moderate: "Умеренная",
  strong: "Сильная",
};
const DEFECT_TYPE_LABEL: Record<string, string> = {
  scratch: "Царапина",
  dent: "Вмятина",
  chip: "Скол",
  corrosion: "Коррозия",
  replaced: "Заменена",
  painted: "Окрашена",
};

const STEERING_OPTIONS = [
  { value: "left", label: "Слева" },
  { value: "right", label: "Справа" },
];
const TRANSMISSION_OPTIONS = [
  { value: "manual", label: "Механика" },
  { value: "automatic", label: "Автомат" },
  { value: "robot", label: "Робот" },
  { value: "cvt", label: "Вариатор" },
];
const DRIVE_OPTIONS = [
  { value: "fwd", label: "Передний" },
  { value: "rwd", label: "Задний" },
  { value: "awd", label: "Полный" },
  { value: "4wd", label: "4WD" },
];

const BODY_TYPE_OPTIONS = [
  "Седан",
  "Хэтчбек",
  "Универсал",
  "Купе",
  "Внедорожник",
  "Пикап",
  "Минивэн",
  "Кроссовер",
];

/** Варианты цвета кузова для выпадающего списка */
const COLOR_OPTIONS = [
  "Белый",
  "Чёрный",
  "Серебристый",
  "Серый",
  "Синий",
  "Красный",
  "Зелёный",
  "Коричневый",
  "Бежевый",
  "Жёлтый",
  "Золотистый",
  "Оранжевый",
  "Бордовый",
  "Голубой",
  "Фиолетовый",
  "Кремовый",
  "Другой",
];

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR - 1980 + 1 }, (_, i) => CURRENT_YEAR - i);

const PRICING_FIELD_LABELS: Record<string, string> = {
  brand: "Марка",
  model: "Модель",
  body_type: "Тип кузова",
  color: "Цвет",
  steering_wheel_position: "Руль (слева/справа)",
  year: "Год выпуска",
  engine_capacity: "Объём двигателя",
  transmission: "КПП",
  drive_type: "Привод",
  mileage: "Пробег",
  damage_flag: "Признаки ДТП (битый)",
};

const REQUIRED_PRICING_FIELDS: (keyof CarIdentity)[] = [
  "brand",
  "model",
  "body_type",
  "color",
  "steering_wheel_position",
  "year",
  "engine_capacity",
  "transmission",
  "drive_type",
  "mileage",
  "damage_flag",
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const dataUrl = r.result as string;
      const base64 = dataUrl.split(",")[1] || "";
      resolve(base64);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function getMissingPricingFields(car: CarIdentity, accidentSigns: boolean): string[] {
  const damage = accidentSigns ? "битый" : (car.damage_flag || "").trim();
  const missing: string[] = [];
  if (!(car.brand || "").trim()) missing.push("brand");
  if (!(car.model || "").trim()) missing.push("model");
  if (!(car.body_type || "").trim()) missing.push("body_type");
  if (!(car.color || "").trim()) missing.push("color");
  const sp = (car.steering_wheel_position || "").trim();
  if (sp !== "left" && sp !== "right") missing.push("steering_wheel_position");
  if (car.year == null || car.year < 1980 || car.year > CURRENT_YEAR) missing.push("year");
  if (car.engine_capacity == null || car.engine_capacity <= 0) missing.push("engine_capacity");
  if (!(car.transmission || "").trim()) missing.push("transmission");
  if (!(car.drive_type || "").trim()) missing.push("drive_type");
  if (car.mileage == null || car.mileage < 0) missing.push("mileage");
  if (!damage) missing.push("damage_flag");
  return missing;
}

function defaultCarIdentity(from: Partial<CarIdentity>): CarIdentity {
  return {
    brand: from?.brand ?? "",
    model: from?.model ?? "",
    generation: from?.generation ?? "",
    year: from?.year ?? null,
    body_type: from?.body_type ?? "",
    color: from?.color ?? "",
    steering_wheel_position: from?.steering_wheel_position ?? "left",
    engine_capacity: from?.engine_capacity ?? null,
    transmission: from?.transmission ?? "",
    drive_type: from?.drive_type ?? "",
    mileage: from?.mileage ?? null,
    damage_flag: from?.damage_flag ?? "",
  };
}

const defaultVisualCondition: VisualCondition = { overall_score: 0, defects: [] };
const defaultTechnicalAssumptions: TechnicalAssumptions = { accident_signs: false, repaint_probability: 0 };
const defaultPriceEstimation: PriceEstimation = {
  min_price: null,
  max_price: null,
  suggested_price: null,
  mae: null,
  missing_fields: [],
};

export function EditScreen({ data, files, setFiles, onBack }: Props) {
  const [carIdentity, setCarIdentity] = useState<CarIdentity>(() => defaultCarIdentity(data?.car_identity));
  const [visualCondition] = useState<VisualCondition>(() => {
    const v = data?.visual_condition;
    if (!v) return defaultVisualCondition;
    return {
      overall_score: v.overall_score ?? defaultVisualCondition.overall_score,
      defects: Array.isArray(v.defects) ? v.defects : [],
    };
  });
  const [technicalAssumptions, setTechnicalAssumptions] = useState<TechnicalAssumptions>(() => data?.technical_assumptions ?? defaultTechnicalAssumptions);
  const [priceEstimation, setPriceEstimation] = useState<PriceEstimation>(() => data?.price_estimation ?? defaultPriceEstimation);
  const [description, setDescription] = useState(() => (data?.generated_description != null ? String(data.generated_description) : ""));
  const [userEdited, setUserEdited] = useState<UserEditedSet>(new Set<string>());
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [descLoading, setDescLoading] = useState(false);
  const [augmentFile, setAugmentFile] = useState<File | null>(null);
  const [augmentSelectedIndex, setAugmentSelectedIndex] = useState<number | null>(null);
  const [augmentPrompt, setAugmentPrompt] = useState("");
  const [augmentLoading, setAugmentLoading] = useState(false);
  const [augmentResult, setAugmentResult] = useState<{ imageBase64?: string; error?: string }>({});
  const [augmentImageLoadError, setAugmentImageLoadError] = useState(false);
  const [previewImageError, setPreviewImageError] = useState(false);
  const [brands, setBrands] = useState<string[]>([]);
  const [modelsByBrand, setModelsByBrand] = useState<Record<string, string[]>>({});
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [showGeneratedData, setShowGeneratedData] = useState(false);
  const [recLoading, setRecLoading] = useState(false);
  const [recResult, setRecResult] = useState<PhotoRecommendationsResponse | null>(null);
  const [recError, setRecError] = useState<string | null>(null);
  const [generationOptions, setGenerationOptions] = useState<string[]>([]);
  const [generationOptionsLoading, setGenerationOptionsLoading] = useState(false);
  const addPhotoInputRef = useRef<HTMLInputElement>(null);

  const missingFields = useMemo(
    () => getMissingPricingFields(carIdentity, technicalAssumptions.accident_signs),
    [carIdentity, technicalAssumptions.accident_signs]
  );

  useEffect(() => {
    fetch("/cars_for_project.csv")
      .then((r) => r.text())
      .then((text) => {
        const lines = text.trim().split(/\r?\n/).slice(1);
        const byBrand: Record<string, Set<string>> = {};
        for (const line of lines) {
          const parts = line.split(";");
          if (parts.length >= 2) {
            const brand = parts[0].trim();
            const model = parts[1].trim();
            if (!byBrand[brand]) byBrand[brand] = new Set();
            byBrand[brand].add(model);
          }
        }
        const brandList = Object.keys(byBrand).sort((a, b) => a.localeCompare(b));
        const modelMap: Record<string, string[]> = {};
        for (const b of brandList) {
          modelMap[b] = Array.from(byBrand[b]).sort((a, b) => a.localeCompare(b));
        }
        setBrands(brandList);
        setModelsByBrand(modelMap);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPhotoUrls(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  useEffect(() => {
    if (photoUrls.length > 0 && galleryIndex >= photoUrls.length) {
      setGalleryIndex(0);
    }
  }, [photoUrls.length, galleryIndex]);

  useEffect(() => {
    setPreviewImageError(false);
  }, [galleryIndex]);

  useEffect(() => {
    const brand = (carIdentity.brand || "").trim();
    const model = (carIdentity.model || "").trim();
    if (!brand || !model) {
      setGenerationOptions([]);
      return;
    }
    let cancelled = false;
    setGenerationOptionsLoading(true);
    getGenerations(brand, model)
      .then((r) => {
        if (!cancelled && Array.isArray(r.generations)) setGenerationOptions(r.generations);
      })
      .catch(() => {
        if (!cancelled) setGenerationOptions([]);
      })
      .finally(() => {
        if (!cancelled) setGenerationOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [carIdentity.brand, carIdentity.model]);

  const markEdited = useCallback((field: string) => {
    setUserEdited((prev) => new Set(prev).add(field));
  }, []);

  const handleCarIdentityChange = useCallback(
    (field: keyof CarIdentity, value: string | number | null) => {
      setCarIdentity((prev) => {
        const next = { ...prev, [field]: value };
        if (field === "brand") next.model = "";
        return next;
      });
      markEdited(`car_identity.${field}`);
    },
    [markEdited]
  );

  const handleRecalcPrice = useCallback(async () => {
    setPriceLoading(true);
    try {
      const identityForPrice: CarIdentity = {
        ...carIdentity,
        damage_flag: technicalAssumptions.accident_signs ? "битый" : (carIdentity.damage_flag || "не битый"),
      };
      const result = await recalculatePrice({
        car_identity: identityForPrice,
        visual_condition: visualCondition,
        technical_assumptions: technicalAssumptions,
      });
      setPriceError(null);
      setPriceEstimation(result);
      if (result?.error_message) setPriceError(result.error_message);
    } catch (e) {
      setPriceError(e instanceof Error ? e.message : "Ошибка пересчёта цены");
    } finally {
      setPriceLoading(false);
    }
  }, [carIdentity, visualCondition, technicalAssumptions]);

  const handleRegenerateDesc = useCallback(async () => {
    setDescLoading(true);
    try {
      const b64 = await Promise.all(files.slice(0, 5).map(fileToBase64));
      const result = await regenerateDescription({
        car_identity: carIdentity,
        vision_result: data?.vision_result ?? {},
        extra_params: {},
        images_base64: b64,
      });
      setDescription(result.generated_description);
      markEdited("generated_description");
    } finally {
      setDescLoading(false);
    }
  }, [carIdentity, data?.vision_result, files, markEdited]);

  const handleAugment = useCallback(async () => {
    const file = augmentSelectedIndex != null && files[augmentSelectedIndex] ? files[augmentSelectedIndex] : augmentFile;
    if (!file || !augmentPrompt.trim()) return;
    setAugmentLoading(true);
    setAugmentResult({});
    try {
      const result = await augmentImage(file, augmentPrompt.trim());
      if (result.success && result.image_base64) {
        setAugmentImageLoadError(false);
        setAugmentResult({ imageBase64: result.image_base64 });
      } else {
        setAugmentResult({ error: result.error || "Не удалось преобразовать изображение" });
      }
    } catch (e) {
      setAugmentResult({ error: e instanceof Error ? e.message : "Ошибка запроса" });
    } finally {
      setAugmentLoading(false);
    }
  }, [augmentFile, augmentSelectedIndex, files, augmentPrompt]);

  const augmentSourceFile =
    augmentSelectedIndex != null && files[augmentSelectedIndex] ? files[augmentSelectedIndex] : augmentFile;

  const handleGetRecommendations = useCallback(async () => {
    if (files.length === 0) {
      setRecError("Добавьте хотя бы одно фото.");
      return;
    }
    setRecLoading(true);
    setRecError(null);
    setRecResult(null);
    try {
      const b64 = await Promise.all(files.slice(0, 20).map(fileToBase64));
      const carContext = [carIdentity.brand, carIdentity.model].filter(Boolean).join(" ") || undefined;
      const result = await getPhotoRecommendations(b64, carContext);
      setRecResult(result);
    } catch (e) {
      setRecError(e instanceof Error ? e.message : "Ошибка получения рекомендаций");
    } finally {
      setRecLoading(false);
    }
  }, [files, carIdentity.brand, carIdentity.model]);

  const handleRemovePhoto = useCallback(
    (index: number) => {
      if (files.length <= 1) return;
      setFiles(files.filter((_, i) => i !== index));
      setRecResult(null);
      setRecError(null);
    },
    [files, setFiles]
  );

  const handleAddPhotos = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const added = e.target.files;
      if (!added?.length) return;
      const newFiles = Array.from(added).filter((f) => f.type.startsWith("image/"));
      if (newFiles.length) {
        setFiles([...files, ...newFiles]);
        setRecResult(null);
        setRecError(null);
      }
      e.target.value = "";
    },
    [files, setFiles]
  );

  const warningsByField = (data?.confidence_warnings || []).reduce<Record<string, ConfidenceWarning>>((acc, w) => {
    acc[w.field] = w;
    return acc;
  }, {});

  const isLowConfidence = (field: string) => warningsByField[field]?.confidence === "low";
  const isUserEdited = (field: string) => userEdited.has(field);

  const modelOptions = carIdentity.brand ? (modelsByBrand[carIdentity.brand] || []) : [];
  const brandOptions = brands.length > 0 ? brands : [];
  const hasBrandInList = !carIdentity.brand || brandOptions.includes(carIdentity.brand);
  const hasModelInList = !carIdentity.model || (carIdentity.brand && (modelsByBrand[carIdentity.brand] || []).includes(carIdentity.model));

  const aiSummary = useMemo(() => {
    const filledCount = REQUIRED_PRICING_FIELDS.filter((k) => {
      const v = carIdentity[k];
      if (v === null || v === undefined) return false;
      if (typeof v === "string") return v.trim() !== "";
      if (typeof v === "number") return k === "year" ? v >= 1980 : v > 0;
      return false;
    }).length;
    const priceAfter =
      priceEstimation.suggested_price != null
        ? `${priceEstimation.suggested_price.toLocaleString("ru-RU")} ₽${priceEstimation.mae != null ? ` ± ${Math.round(priceEstimation.mae).toLocaleString("ru-RU")} ₽` : ""}`
        : null;
    const descTrim = description.trim();
    const descAfter = descTrim ? (descTrim.split(/\n\n+/).filter((p) => p.trim()).length || 1) : 0;
    return { filledCount, priceAfter, descAfter, descLen: descTrim.length };
  }, [carIdentity, priceEstimation.suggested_price, priceEstimation.mae, description]);

  const readiness = useMemo(
    () => ({
      photos: files.length > 0,
      params: aiSummary.filledCount >= 11,
      condition: true,
      price: priceEstimation.suggested_price != null,
      description: description.trim().length > 0,
    }),
    [files.length, aiSummary.filledCount, priceEstimation.suggested_price, description]
  );
  const readinessCount = [readiness.photos, readiness.params, readiness.condition, readiness.price, readiness.description].filter(Boolean).length;

  return (
    <div className="edit-screen">
      <header className="edit-header">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          ← Назад
        </button>
        <div className="edit-header-row">
          <h1>Редактирование объявления</h1>
          <button
            type="button"
            className="btn btn-small btn-ghost toggle-generated"
            onClick={() => setShowGeneratedData((v) => !v)}
            aria-expanded={showGeneratedData}
          >
            {showGeneratedData ? "Скрыть таблицу ▲" : "Сгенерированные строки (таблица) ▼"}
          </button>
        </div>
      </header>

      {showGeneratedData && (
        <section className="block generated-data-block">
          <p className="hint">Строки, сгенерированные промптом LLM для обучения модели оценки стоимости:</p>
          {priceEstimation.generated_rows && priceEstimation.generated_rows.length > 0 ? (
            <div className="generated-rows-wrap">
              <table className="generated-rows-table">
                <thead>
                  <tr>
                    {Object.keys(priceEstimation.generated_rows[0]).map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {priceEstimation.generated_rows.map((row, idx) => (
                    <tr key={idx}>
                      {Object.keys(priceEstimation.generated_rows![0]).map((col) => {
                        const v = row[col];
                        const display = v == null || v === "" ? "—" : typeof v === "number" ? (col === "price" ? (v as number).toLocaleString("ru-RU") : String(v)) : String(v);
                        return <td key={col}>{display}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Нажмите «Пересчитать цену», чтобы увидеть сгенерированные промптом строки.</p>
          )}
        </section>
      )}

      {files.length === 0 && (
        <div className="banner error">
          Фото не загружены или были сброшены. Вернитесь на предыдущий шаг и загрузите фото снова.
        </div>
      )}
      {data?.status === "needs_user_input" && (
        <div className="banner needs-input">
          Не удалось однозначно определить данные по фото. Проверьте и при необходимости введите марку, модель и год вручную.
        </div>
      )}
      {data?.status === "error" && (
        <div className="banner error">Произошла ошибка при анализе. Вы можете заполнить поля вручную.</div>
      )}

      <section className="block ai-summary-block">
        <h2>Что сделал ИИ</h2>
        <p className="hint">До анализа — только ваши фото. После — заполненные поля, цена и описание.</p>
        <div className="ai-summary-grid">
          <div className="ai-summary-item">
            <span className="ai-summary-label">Заполнено полей</span>
            <span className="ai-summary-values">
              <span className="before">0</span>
              <span className="arrow">→</span>
              <span className="after">{aiSummary.filledCount}</span>
            </span>
          </div>
          <div className="ai-summary-item">
            <span className="ai-summary-label">Цена</span>
            <span className="ai-summary-values">
              <span className="before">не рассчитана</span>
              <span className="arrow">→</span>
              <span className="after">{aiSummary.priceAfter || "—"}</span>
            </span>
          </div>
          <div className="ai-summary-item">
            <span className="ai-summary-label">Описание</span>
            <span className="ai-summary-values">
              <span className="before">пусто</span>
              <span className="arrow">→</span>
              <span className="after">{aiSummary.descAfter ? `${aiSummary.descAfter} абз.` : "—"}</span>
            </span>
          </div>
        </div>
      </section>

      <section className="block readiness-block">
        <h2>Готовность объявления</h2>
        <div className="readiness-checklist">
          <div className={`readiness-item ${readiness.photos ? "done" : ""}`}>
            <span className="readiness-icon">{readiness.photos ? "✓" : "○"}</span>
            <span>Фото загружены</span>
          </div>
          <div className={`readiness-item ${readiness.params ? "done" : ""}`}>
            <span className="readiness-icon">{readiness.params ? "✓" : "○"}</span>
            <span>Параметры заполнены</span>
          </div>
          <div className={`readiness-item ${readiness.condition ? "done" : ""}`}>
            <span className="readiness-icon">{readiness.condition ? "✓" : "○"}</span>
            <span>Состояние оценено</span>
          </div>
          <div className={`readiness-item ${readiness.price ? "done" : ""}`}>
            <span className="readiness-icon">{readiness.price ? "✓" : "○"}</span>
            <span>Цена рассчитана</span>
          </div>
          <div className={`readiness-item ${readiness.description ? "done" : ""}`}>
            <span className="readiness-icon">{readiness.description ? "✓" : "○"}</span>
            <span>Описание сгенерировано</span>
          </div>
        </div>
        <p className="readiness-total">
          {readinessCount === 5 ? (
            <strong className="ready">Объявление готово к публикации</strong>
          ) : (
            <>Готовность: {readinessCount} из 5</>
          )}
        </p>
      </section>

      <section className="block preview-block">
        <h2>Как будет выглядеть объявление</h2>
        <p className="hint">Превью в стиле карточки на площадке. Перелистывайте фото стрелками.</p>
        <div className="ad-preview-card">
          <div className="ad-preview-photo ad-preview-photo-carousel">
            {photoUrls.length > 0 ? (
              <>
                <button
                  type="button"
                  className="carousel-btn carousel-prev ad-preview-carousel-btn"
                  onClick={() => setGalleryIndex((i) => (i <= 0 ? photoUrls.length - 1 : i - 1))}
                  aria-label="Предыдущее фото"
                >
                  ‹
                </button>
                <div className="ad-preview-photo-inner">
                  {previewImageError ? (
                    <div className="ad-preview-photo-placeholder">Ошибка загрузки фото</div>
                  ) : (
                    <img
                      src={photoUrls[galleryIndex]}
                      alt={`Фото ${galleryIndex + 1}`}
                      onError={() => setPreviewImageError(true)}
                      onLoad={() => setPreviewImageError(false)}
                    />
                  )}
                  <span className="ad-preview-photo-count">{galleryIndex + 1} / {photoUrls.length}</span>
                </div>
                <button
                  type="button"
                  className="carousel-btn carousel-next ad-preview-carousel-btn"
                  onClick={() => setGalleryIndex((i) => (i >= photoUrls.length - 1 ? 0 : i + 1))}
                  aria-label="Следующее фото"
                >
                  ›
                </button>
                <div className="ad-preview-dots">
                  {photoUrls.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`carousel-dot ${i === galleryIndex ? "active" : ""}`}
                      onClick={() => setGalleryIndex(i)}
                      aria-label={`Фото ${i + 1}`}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="ad-preview-photo-placeholder">Нет фото</div>
            )}
          </div>
          <div className="ad-preview-body">
            <div className="ad-preview-title">
              {[carIdentity.brand, carIdentity.model, carIdentity.year].filter(Boolean).join(" ") || "Марка, модель, год"}
            </div>
            <div className="ad-preview-params">
              <span>{carIdentity.body_type || "—"}</span>
              <span>{(carIdentity.mileage != null ? `${carIdentity.mileage.toLocaleString("ru-RU")} км` : "—")}</span>
              <span>{carIdentity.transmission || "—"}</span>
              <span>{carIdentity.drive_type ? (DRIVE_OPTIONS.find((o) => o.value === carIdentity.drive_type)?.label ?? carIdentity.drive_type) : "—"}</span>
            </div>
            {priceEstimation.suggested_price != null && (
              <div className="ad-preview-price">
                {priceEstimation.suggested_price.toLocaleString("ru-RU")} ₽
              </div>
            )}
            {description.trim() && (
              <div className="ad-preview-desc">
                {description.trim().slice(0, 200)}
                {description.trim().length > 200 ? "…" : ""}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="block recommendations-block">
        <h2>Рекомендации по фото</h2>
        <p className="hint">Добавьте или удалите фото, затем нажмите кнопку — ИИ подскажет, что улучшить или чего не хватает.</p>
        <div className="recommendations-row">
          <div className="rec-thumbnails-inline">
            {photoUrls.map((url, i) => (
              <div key={i} className="rec-thumb-wrap">
                <img src={url} alt={`${i + 1}`} />
                <span className="rec-thumb-num">{i + 1}</span>
                {files.length > 1 && (
                  <button type="button" className="rec-thumb-remove" onClick={() => handleRemovePhoto(i)} aria-label={`Удалить фото ${i + 1}`} title="Удалить">×</button>
                )}
              </div>
            ))}
          </div>
          <div className="rec-actions-inline">
            <input ref={addPhotoInputRef} type="file" accept="image/*" multiple onChange={handleAddPhotos} className="rec-file-input" aria-label="Добавить фото" />
            <button type="button" className="btn btn-secondary btn-small" onClick={() => addPhotoInputRef.current?.click()}>+ Добавить</button>
            <button type="button" className="btn btn-primary" onClick={handleGetRecommendations} disabled={recLoading || files.length === 0}>
              {recLoading ? "Анализ…" : "Рекомендации по фото"}
            </button>
          </div>
        </div>
        {recLoading && (
          <div className="loading-inline">
            <span className="loading-spinner" aria-hidden />
            <span>Анализируем фото…</span>
          </div>
        )}
        {recError && <div className="banner error" role="alert">{recError}</div>}
        {recResult && !recLoading && (
          <div className="rec-result">
            <div className={`rec-verdict rec-verdict--${recResult.verdict}`}>{recResult.verdict === "all_ok" ? "Всё замечательно" : "Есть рекомендации"}</div>
            {recResult.summary && <p className="rec-summary">{recResult.summary}</p>}
            {recResult.quality_issues.length > 0 && (
              <div className="rec-list"><strong>Качество:</strong><ul>{recResult.quality_issues.map((q, i) => <li key={i}>{q}</li>)}</ul></div>
            )}
            {recResult.missing_photo_types.length > 0 && (
              <div className="rec-list"><strong>Не хватает:</strong><ul>{recResult.missing_photo_types.map((m, i) => <li key={i}>{m}</li>)}</ul></div>
            )}
            {recResult.recommendations.length > 0 && (
              <div className="rec-list"><strong>Советы:</strong><ul>{recResult.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
            )}
          </div>
        )}
      </section>

      <section className="block form-block">
        <h2>Параметры автомобиля</h2>
        <p className="hint">Все поля можно изменить. Помечены: заполнено ИИ · изменено вами.</p>
        <div className="form-grid form-grid-wide">
          {brandOptions.length > 0 ? (
            <div className={`field ${isLowConfidence("model") ? "low-confidence" : ""}`}>
              <label>Марка</label>
              <select
                value={carIdentity.brand}
                onChange={(e) => handleCarIdentityChange("brand", e.target.value)}
              >
                <option value="">—</option>
                {carIdentity.brand && !brandOptions.includes(carIdentity.brand) && (
                  <option value={carIdentity.brand}>{carIdentity.brand}</option>
                )}
                {brandOptions.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
          ) : (
            <LabelInput label="Марка" value={carIdentity.brand} onChange={(v) => handleCarIdentityChange("brand", v)} aiFilled={!!data?.car_identity?.brand} userEdited={isUserEdited("car_identity.brand")} lowConfidence={isLowConfidence("model")} />
          )}

          {brandOptions.length > 0 && carIdentity.brand ? (
            <div className="field">
              <label>Модель</label>
              <select
                value={carIdentity.model}
                onChange={(e) => handleCarIdentityChange("model", e.target.value)}
              >
                <option value="">—</option>
                {carIdentity.model && !modelOptions.includes(carIdentity.model) && (
                  <option value={carIdentity.model}>{carIdentity.model}</option>
                )}
                {modelOptions.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          ) : (
            <LabelInput label="Модель" value={carIdentity.model} onChange={(v) => handleCarIdentityChange("model", v)} aiFilled={!!data?.car_identity?.model} userEdited={isUserEdited("car_identity.model")} lowConfidence={isLowConfidence("model")} />
          )}

          <div className="field">
            <label>
              Поколение
              {data?.car_identity?.generation && <span className="badge ai">ИИ</span>}
              {isUserEdited("car_identity.generation") && <span className="badge user">Изменено</span>}
              {generationOptionsLoading && <span className="loading-inline" style={{ marginLeft: "0.5rem" }}><span className="loading-spinner" aria-hidden /> загрузка…</span>}
            </label>
            <select
              value={carIdentity.generation}
              onChange={(e) => handleCarIdentityChange("generation", e.target.value)}
              disabled={generationOptionsLoading}
            >
              <option value="">—</option>
              {carIdentity.generation && !generationOptions.includes(carIdentity.generation) && (
                <option value={carIdentity.generation}>{carIdentity.generation}</option>
              )}
              {generationOptions.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Год выпуска</label>
            <select
              value={carIdentity.year != null ? String(carIdentity.year) : ""}
              onChange={(e) => handleCarIdentityChange("year", e.target.value ? parseInt(e.target.value, 10) : null)}
            >
              <option value="">—</option>
              {carIdentity.year != null && (carIdentity.year < 1980 || carIdentity.year > CURRENT_YEAR) && (
                <option value={String(carIdentity.year)}>{carIdentity.year}</option>
              )}
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Тип кузова</label>
            <select
              value={carIdentity.body_type}
              onChange={(e) => handleCarIdentityChange("body_type", e.target.value)}
            >
              <option value="">—</option>
              {carIdentity.body_type && !BODY_TYPE_OPTIONS.includes(carIdentity.body_type) && (
                <option value={carIdentity.body_type}>{carIdentity.body_type}</option>
              )}
              {BODY_TYPE_OPTIONS.map((bt) => (
                <option key={bt} value={bt}>{bt}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>
              Цвет
              {data?.car_identity?.color && <span className="badge ai">ИИ</span>}
              {isUserEdited("car_identity.color") && <span className="badge user">Изменено</span>}
            </label>
            <select
              value={carIdentity.color}
              onChange={(e) => handleCarIdentityChange("color", e.target.value)}
            >
              <option value="">—</option>
              {carIdentity.color && !COLOR_OPTIONS.includes(carIdentity.color) && (
                <option value={carIdentity.color}>{carIdentity.color}</option>
              )}
              {COLOR_OPTIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className={`field ${isLowConfidence("model") ? "low-confidence" : ""}`}>
            <label>Руль</label>
            <select
              value={carIdentity.steering_wheel_position === "right" ? "right" : "left"}
              onChange={(e) => handleCarIdentityChange("steering_wheel_position", e.target.value)}
            >
              {STEERING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Объём двигателя (л)</label>
            <input
              type="number"
              step="0.1"
              min="0.5"
              max="10"
              value={carIdentity.engine_capacity != null ? String(carIdentity.engine_capacity) : ""}
              onChange={(e) => {
                const v = e.target.value;
                handleCarIdentityChange("engine_capacity", v === "" ? null : parseFloat(v) || null);
              }}
              placeholder="1.6"
            />
          </div>

          <div className="field">
            <label>КПП</label>
            <select value={carIdentity.transmission || ""} onChange={(e) => handleCarIdentityChange("transmission", e.target.value)}>
              <option value="">—</option>
              {TRANSMISSION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Привод</label>
            <select value={carIdentity.drive_type || ""} onChange={(e) => handleCarIdentityChange("drive_type", e.target.value)}>
              <option value="">—</option>
              {DRIVE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <LabelInput
            label="Пробег (км)"
            value={carIdentity.mileage != null ? String(carIdentity.mileage) : ""}
            onChange={(v) => handleCarIdentityChange("mileage", v === "" ? null : (parseInt(v, 10) || null))}
            onBlurNumber={(n) => handleCarIdentityChange("mileage", n != null ? Math.round(Number(n)) : null)}
          />
        </div>

        <div className="form-row">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={technicalAssumptions.accident_signs}
              onChange={(e) => {
                setTechnicalAssumptions((p) => ({ ...p, accident_signs: e.target.checked }));
                setCarIdentity((prev) => ({ ...prev, damage_flag: e.target.checked ? "битый" : "не битый" }));
                markEdited("technical_assumptions.accident_signs");
              }}
            />
            Признаки ДТП (битый)
          </label>
        </div>
      </section>

      <section className="block state-block">
        <h2>Состояние</h2>
        <div className="overall-score">
          Общий балл состояния: <strong>{(visualCondition.overall_score * 100).toFixed(0)}%</strong>
        </div>
        {visualCondition.defects.length > 0 ? (
          <ul className="defects-list">
            {visualCondition.defects.map((d, i) => (
              <li key={i}>
                {DEFECT_TYPE_LABEL[d.type] || d.type} — {DEFECT_SEVERITY_LABEL[d.severity] || d.severity}
                {d.location && ` (${d.location})`}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Визуальных дефектов не выявлено.</p>
        )}
      </section>

      <section className="block price-data-block">
        <h2>Данные для оценки стоимости</h2>
        <p className="hint">Для расчёта цены нужны все поля. Заполните недостающие — список обновляется в реальном времени.</p>
        {missingFields.length > 0 ? (
          <div className="missing-fields-box">
            <p><strong>Не заполнено (заполните для оценки цены):</strong></p>
            <ul>
              {missingFields.map((f) => (
                <li key={f}>{PRICING_FIELD_LABELS[f] ?? f}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="muted">Все обязательные поля заполнены. Можно нажать «Пересчитать цену» ниже.</p>
        )}
      </section>

      <section className="block price-block">
        <h2>Цена</h2>
        {priceLoading && (
          <div className="loading-inline">
            <span className="loading-spinner" aria-hidden />
            <span>Идёт расчёт стоимости… (может занять 1–2 минуты)</span>
          </div>
        )}
        {priceError && (
          <div className="banner error" role="alert">
            {priceError}
          </div>
        )}
        {!priceLoading && priceEstimation.suggested_price != null && (
          <div className="price-range">
            <p>
              Рекомендуемая цена: <strong>{priceEstimation.suggested_price.toLocaleString("ru-RU")} ₽</strong>
              {priceEstimation.mae != null && (
                <span className="price-mae"> ± {Math.round(priceEstimation.mae).toLocaleString("ru-RU")} ₽ (MAE)</span>
              )}
            </p>
            {priceEstimation.min_price != null && priceEstimation.max_price != null && (
              <p className="muted">Диапазон: {priceEstimation.min_price.toLocaleString("ru-RU")} – {priceEstimation.max_price.toLocaleString("ru-RU")} ₽</p>
            )}
          </div>
        )}
        {!priceLoading && priceEstimation.suggested_price == null && missingFields.length > 0 && (
          <p className="muted">Заполните все поля в блоке выше и нажмите «Пересчитать цену».</p>
        )}
        {!priceLoading && (
          <>
            <button type="button" className="btn btn-secondary" onClick={handleRecalcPrice} disabled={missingFields.length > 0}>
              Пересчитать цену
            </button>
          </>
        )}
      </section>

      <section className="block description-block">
        <h2>Описание</h2>
        {descLoading && (
          <div className="loading-inline">
            <span className="loading-spinner" aria-hidden />
            <span>Генерация описания…</span>
          </div>
        )}
        {!descLoading && (
          <>
            <textarea
              className="description-textarea"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                markEdited("generated_description");
              }}
              rows={8}
              placeholder="Текст объявления"
            />
            <button type="button" className="btn btn-secondary" onClick={handleRegenerateDesc}>
              Перегенерировать описание
            </button>
          </>
        )}
      </section>

      <section className="block augment-block">
        <h2>Преобразование изображения</h2>
        <p className="hint">Выберите фото из загруженных или загрузите другое. Улучшение качества или добавление объекта — запрос должен относиться к автомобилю.</p>
        {augmentLoading && (
          <div className="loading-inline">
            <span className="loading-spinner" aria-hidden />
            <span>Обработка изображения…</span>
          </div>
        )}
        {!augmentLoading && (
          <div className="augment-form">
            <div className="field">
              <label>Фото для преобразования</label>
              {photoUrls.length > 0 && (
                <div className="augment-source-thumbnails">
                  {photoUrls.map((url, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`augment-thumb ${augmentSelectedIndex === i && !augmentFile ? "selected" : ""}`}
                      onClick={() => {
                        setAugmentSelectedIndex(i);
                        setAugmentFile(null);
                      }}
                      title={`Фото ${i + 1}`}
                    >
                      <img src={url} alt={`${i + 1}`} />
                      <span>{i + 1}</span>
                    </button>
                  ))}
                </div>
              )}
              <label className="augment-upload-label">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    setAugmentFile(e.target.files?.[0] ?? null);
                    setAugmentSelectedIndex(null);
                  }}
                />
                <span className="btn btn-ghost btn-small">или загрузить другой файл</span>
              </label>
            </div>
            <div className="field">
              <label>Запрос (например: «улучши резкость» или «добавь чемодан на крышу»)</label>
              <input
                type="text"
                value={augmentPrompt}
                onChange={(e) => setAugmentPrompt(e.target.value)}
                placeholder="Опишите, что сделать с фото"
              />
            </div>
            <button type="button" className="btn btn-secondary" onClick={handleAugment} disabled={!augmentSourceFile || !augmentPrompt.trim()}>
              Преобразовать изображение
            </button>
          </div>
        )}
        {augmentResult.error && <div className="augment-error">{augmentResult.error}</div>}
        {augmentResult.imageBase64 && (
          <div className="augment-result">
            <p>Результат:</p>
            {augmentImageLoadError || (augmentResult.imageBase64.length < 200) ? (
              <div className="augment-result-fail">
                Не удалось отобразить изображение (пустой или повреждённый результат от API). Попробуйте другой запрос или другое фото.
              </div>
            ) : (
              <img
                src={`data:image/png;base64,${augmentResult.imageBase64}`}
                alt="Результат преобразования"
                onError={() => setAugmentImageLoadError(true)}
              />
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function LabelInput({
  label,
  value,
  onChange,
  onBlurNumber,
  aiFilled,
  userEdited,
  lowConfidence,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlurNumber?: (n: number | null) => void;
  aiFilled?: boolean;
  userEdited?: boolean;
  lowConfidence?: boolean;
}) {
  const handleBlur = onBlurNumber
    ? () => {
        const n = value === "" ? null : parseFloat(value);
        onBlurNumber(Number.isNaN(n as number) ? null : (n as number));
      }
    : undefined;
  return (
    <div className={`field ${lowConfidence ? "low-confidence" : ""}`}>
      <label>
        {label}
        {aiFilled && <span className="badge ai">ИИ</span>}
        {userEdited && <span className="badge user">Изменено</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
      />
    </div>
  );
}
