export type StepId = "STEP_01";

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

// ─── 100_App_Logs ─────────────────────────────────────────────────────────────

export type AppLogLevel = "INFO" | "WARN" | "ERROR";
export type AppLogErrorType =
  | "schema_validation_failure"
  | "runtime_failure"
  | "ai_failure"
  | "write_failure"
  | "success";

export interface AppLogRow {
  project_id: string;
  record_id: string;
  current_step: string;
  timestamp: string;
  log_level: AppLogLevel;
  error_type: AppLogErrorType;
  app_log: string;
}

// ─── Workflow Payload ─────────────────────────────────────────────────────────

export interface WorkflowPayload {
  project_ids: string[];
  max_items: number;
  dry_run: boolean;
}
