/** Канонический контракт API (совпадает с backend) */
export interface CarIdentity {
  brand: string;
  model: string;
  generation: string;
  year: number | null;
  body_type: string;
  color: string;
  steering_wheel_position: string;
  engine_capacity: number | null;
  transmission: string;
  drive_type: string;
  mileage: number | null;
  damage_flag: string;
}

export type DefectType = "scratch" | "dent" | "chip" | "corrosion" | "replaced" | "painted";
export type DefectSeverity = "weak" | "moderate" | "strong";

export interface DefectItem {
  type: DefectType | string;
  severity: DefectSeverity;
  location: string;
  body_part?: string;
}

export interface VisualCondition {
  overall_score: number;
  defects: DefectItem[];
}

export interface TechnicalAssumptions {
  accident_signs: boolean;
  repaint_probability: number;
}

export interface PriceEstimation {
  min_price: number | null;
  max_price: number | null;
  suggested_price: number | null;
  mae: number | null;
  missing_fields: string[];
  error_message?: string | null;
  /** Строки, сгенерированные промптом LLM для оценки стоимости */
  generated_rows?: Record<string, unknown>[] | null;
}

export type ConfidenceLevel = "high" | "medium" | "low";

export interface ConfidenceWarning {
  field: string;
  confidence: ConfidenceLevel;
  reason: string;
}

export type Status = "ok" | "needs_user_input" | "error";

export interface AnalysisResponse {
  car_identity: CarIdentity;
  visual_condition: VisualCondition;
  technical_assumptions: TechnicalAssumptions;
  price_estimation: PriceEstimation;
  generated_description: string;
  confidence_warnings: ConfidenceWarning[];
  status: Status;
  vision_result?: Record<string, unknown>;
}

/** Поля, которые пользователь изменил вручную (ИИ не затирает) */
export type UserEditedSet = Set<string>;

export interface RecalculatePriceBody {
  car_identity: CarIdentity;
  visual_condition: VisualCondition;
  technical_assumptions: TechnicalAssumptions;
}

export interface RegenerateDescriptionBody {
  car_identity: CarIdentity;
  vision_result: Record<string, unknown>;
  extra_params: Record<string, unknown>;
  images_base64: string[];
}

export interface PhotoRecommendationsResponse {
  verdict: "all_ok" | "has_recommendations";
  quality_issues: string[];
  recommendations: string[];
  missing_photo_types: string[];
  summary: string;
}
