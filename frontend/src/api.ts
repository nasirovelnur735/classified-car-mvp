import type {
  AnalysisResponse,
  PriceEstimation,
  RecalculatePriceBody,
  RegenerateDescriptionBody,
  PhotoRecommendationsResponse,
} from "./types";

const API_BASE = import.meta.env.VITE_API_URL || "";

export interface AugmentImageResult {
  success: boolean;
  image_base64?: string;
  error?: string;
  mode?: string;
}

export async function analyzeImages(files: File[]): Promise<AnalysisResponse> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  const res = await fetch(`${API_BASE}/api/analyze`, {
    method: "POST",
    body: form,
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(res.ok ? "Неверный формат ответа сервера" : res.statusText || "Ошибка анализа");
  }
  if (!res.ok) {
    const err = body as { detail?: string };
    throw new Error(typeof err?.detail === "string" ? err.detail : res.statusText || "Ошибка анализа");
  }
  if (body == null || typeof body !== "object") {
    throw new Error("Пустой ответ сервера");
  }
  return body as AnalysisResponse;
}

const RECALC_PRICE_TIMEOUT_MS = 180_000; // 3 min

export async function recalculatePrice(body: RecalculatePriceBody): Promise<PriceEstimation> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), RECALC_PRICE_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/api/recalculate-price`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = typeof data.detail === "string" ? data.detail : Array.isArray(data.detail) ? data.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join("; ") : data._error || "Ошибка пересчёта цены";
      throw new Error(msg || "Ошибка пересчёта цены");
    }
    return data;
  } catch (e) {
    clearTimeout(t);
    if (e instanceof Error) {
      if (e.name === "AbortError") throw new Error("Превышено время ожидания (3 мин). Попробуйте ещё раз.");
      throw e;
    }
    throw new Error("Ошибка пересчёта цены");
  }
}

export async function regenerateDescription(body: RegenerateDescriptionBody): Promise<{ generated_description: string }> {
  const res = await fetch(`${API_BASE}/api/regenerate-description`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Ошибка генерации описания");
  return res.json();
}

export async function getPhotoRecommendations(
  imagesBase64: string[],
  carContext?: string | null
): Promise<PhotoRecommendationsResponse> {
  const res = await fetch(`${API_BASE}/api/photo-recommendations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images_base64: imagesBase64, car_context: carContext || null }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === "string" ? err.detail : "Ошибка рекомендаций");
  }
  return res.json();
}

export async function getGenerations(brand: string, model: string): Promise<{ generations: string[] }> {
  const params = new URLSearchParams({ brand: brand.trim(), model: model.trim() });
  const res = await fetch(`${API_BASE}/api/generations?${params}`);
  if (!res.ok) return { generations: [] };
  return res.json();
}

export async function augmentImage(file: File, prompt: string): Promise<AugmentImageResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("prompt", prompt);
  const res = await fetch(`${API_BASE}/api/augment-image`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error("Ошибка преобразования изображения");
  return res.json();
}
