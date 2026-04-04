export type StepId = "STEP_01" | "STEP_02" | "STEP_03";

// ─── Runtime Config ──────────────────────────────────────────────────────────

export interface RuntimeConfigRow {
  key: string;
  value: string;
  category?: string;
  data_type?: string;
  environment?: string;
  enabled?: string;
  description?: string;
  updated_at?: string;
  updated_by?: string;
  notes?: string;
}

export type RuntimeConfigMap = Map<string, string>;

// ─── 00_Project ───────────────────────────────────────────────────────────────

export interface ProjectRow {
  project_id: string;
  record_id: string;
  project_status?: string;
  current_step?: string;
  run_enabled?: string;
  approval_status?: string;
  rights_status?: string;
  title_jp?: string;
  title_en?: string;
  series_name?: string;
  episode_no?: string;
  source_title?: string;
  source_url?: string;
  target_age?: string;
  video_format?: string;
  aspect_short?: string;
  aspect_full?: string;
  short_target_sec?: string;
  full_target_sec?: string;
  visual_style?: string;
  owner?: string;
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
  notes?: string;
}

export interface ProjectMinimalPatch {
  current_step: string;
  approval_status: "PENDING" | "UNKNOWN";
  created_at?: string; // 既存が空欄の場合のみ補完
  updated_at: string;
  updated_by: string;
}

// ─── 00_Rights_Validation ─────────────────────────────────────────────────────

/** AI が返す rights validation の row（スキーマ: rights_validation_schema_ai_v1） */
export interface RightsValidationAiRow {
  is_translation: "Y" | "N" | "UNKNOWN";
  original_author: string;
  original_author_birth_year: string;
  original_author_death_year: string;
  translator: string;
  translator_birth_year: string;
  translator_death_year: string;
  aozora_rights_note: string;
  cc_license_present: "Y" | "N" | "UNKNOWN";
  cc_license_type: string;
  public_domain_candidate: "Y" | "N" | "UNKNOWN";
  original_author_pd_jp: "Y" | "N" | "UNKNOWN";
  translator_pd_jp: "Y" | "N" | "UNKNOWN";
  other_rights_risk: string;
  war_addition_risk: string;
  rights_evidence_url_1: string;
  rights_evidence_url_2: string;
  rights_evidence_url_3: string;
  rights_summary: string;
  rights_status: "APPROVED" | "NEEDS_REVIEW" | "BLOCKED" | "UNKNOWN";
  risk_level: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  review_required: "Y" | "N";
}

/** Google Sheets に書き込む full row（スキーマ: rights_validation_schema_full_v1） */
export interface RightsValidationFullRow extends RightsValidationAiRow {
  project_id: string;
  record_id: string;
  generation_status: "GENERATED" | "FAILED" | "SKIPPED" | "PENDING";
  approval_status: "PENDING" | "APPROVED" | "REJECTED";
  step_id: "STEP_01";
  checked_by: string;
  checked_date: string;
  reviewer: string;
  review_date: string;
  go_next: "Y" | "N" | "";
  updated_at: string;
  updated_by: string;
  notes: string;
}

// ─── 01_Source ────────────────────────────────────────────────────────────────

/** AI が返す Source Build の row（スキーマ: source_build_schema_ai_v1） */
export interface SourceAiRow {
  source_title: string;
  author: string;
  translator: string;
  source_url: string;
  source_type: "aozora" | "original" | "translation" | "arrangement" | "unknown";
  copyright_status: string;
  credit_text: string;
  base_text_notes: string;
  language_style: string;
  difficult_terms: string;
  adaptation_policy: string;
}

/** Google Sheets に書き込む full row（スキーマ: source_build_schema_full_v1） */
export interface SourceFullRow extends SourceAiRow {
  project_id: string;
  record_id: string;
  generation_status: "GENERATED" | "FAILED" | "SKIPPED" | "PENDING";
  approval_status: "PENDING" | "APPROVED" | "REJECTED";
  step_id: string;
  original_text: string;
  legal_check_status: string;
  legal_check_notes: string;
  updated_at: string;
  updated_by: string;
  notes: string;
}

// ─── 01_Source (read) ─────────────────────────────────────────────────────────

/** 01_Source から読み込む参照用 row（STEP_03 が参照） */
export interface SourceReadRow {
  project_id: string;
  record_id: string;
  approval_status: string;
  adaptation_policy: string;
  language_style: string;
  difficult_terms?: string;
  credit_text?: string;
  base_text_notes?: string;
}

// ─── 02_Scenes ────────────────────────────────────────────────────────────────

/** AI が返す Scenes Build の scene 1件（スキーマ: scene_build_schema_ai_v1） */
export interface SceneAiRow {
  scene_id: string;
  scene_order: number;
  scene_title: string;
  scene_summary: string;
  scene_purpose: string;
  scene_type: "intro" | "development" | "climax" | "resolution" | "ending";
  scene_target_sec: number;
  key_characters: string;
  key_events: string;
  visual_notes: string;
  narration_style: string;
}

/** Google Sheets に書き込む full row（スキーマ: scene_build_schema_full_v1） */
export interface SceneFullRow extends SceneAiRow {
  project_id: string;
  record_id: string;
  generation_status: "GENERATED" | "FAILED" | "SKIPPED" | "PENDING";
  approval_status: "PENDING" | "APPROVED" | "REJECTED";
  step_id: string;
  updated_at: string;
  updated_by: string;
  notes: string;
}

// ─── 00_Rights_Validation (read) ──────────────────────────────────────────────

/** 00_Rights_Validation から読み込む参照用 row */
export interface RightsValidationReadRow {
  project_id: string;
  record_id: string;
  rights_status: string;
  original_author?: string;
  translator?: string;
  rights_summary?: string;
  public_domain_candidate?: string;
}

// ─── 100_App_Logs ─────────────────────────────────────────────────────────────


export interface AppLogRow {
  project_id: string;
  record_id: string;
  current_step: string;
  timestamp: string;
  app_log: string; // "[LEVEL][error_type] message" 形式で log_level/error_type を含む
}

// ─── Workflow Payload ─────────────────────────────────────────────────────────

export interface WorkflowPayload {
  project_ids: string[];
  max_items: number;
  dry_run: boolean;
}
