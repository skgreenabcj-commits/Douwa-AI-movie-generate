/**
 * StepId: GitHub Actions STEP_ID 環境変数で使用する値。
 * 複合ステップ（STEP_04_05）は1回の起動で STEP_04/05 両方を実行する。
 */
export type StepId =
  | "STEP_01"                       // Rights Validation
  | "STEP_02"                       // Source Build
  | "STEP_03"                       // Scenes Build
  | "STEP_04_05"                    // Short + Full Script Build (combined)
  | "STEP_04_SHORT_SCRIPT_BUILD"    // GSS step_id / current_step 値（Short 完了）
  | "STEP_05_FULL_SCRIPT_BUILD"     // GSS step_id / current_step 値（Full 完了）
  | "STEP_04_05_COMBINED"           // current_step 値（Short+Full 両方完了）
  | "STEP_06_VISUAL_BIBLE"          // Visual Bible Build
  | "STEP_09_QA_BUILD";             // Q&A Build

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

/**
 * AI が返す Scenes Build の scene 1件（スキーマ: scene_build_schema_ai_v1）
 *
 * scene_no はシステム側（write-scenes.ts）で付与する（project_id ごとの通し番号）。
 *   - GSS 02_Scenes に存在する列。AI には返させない。
 * scene_order はシステム内部専用の整数インデックス（record_id 生成用）。
 *   - GSS 02_Scenes には存在しない列。write-scenes.ts で採番し、GSS には書き込まない。
 * short_use / full_use は "Y" | "N" のみ（スキーマ enum 準拠）。
 */
export interface SceneAiRow {
  chapter: string;
  scene_title: string;
  scene_summary: string;
  scene_goal: string;
  visual_focus: string;
  emotion: string;
  short_use: "Y" | "N";
  full_use: "Y" | "N";
  est_duration_short: number;
  est_duration_full: number;
  difficult_words: string;
  easy_rewrite: string;
  qa_seed: string;
  continuity_note: string;
}

/**
 * Google Sheets に書き込む full row（スキーマ: scene_build_schema_full_v1）
 *
 * scene_no はシステム側で付与する（project_id ごとの通し番号: "1", "2", "3"...）。
 *   - GSS 02_Scenes ヘッダーに存在する。write-scenes.ts の SCN_HEADERS に含める。
 * scene_order はシステム内部専用（record_id 生成用の整数インデックス）。
 *   - GSS 02_Scenes ヘッダーには存在しない。write-scenes.ts の SCN_HEADERS に含めない。
 *   - TS の型としては保持するが、GSS に書き込まないこと。
 * record_id は write-scenes.ts で採番する（format: PJT-001-SCN-001）。
 */
export interface SceneFullRow extends SceneAiRow {
  project_id: string;
  record_id: string;
  generation_status: "GENERATED" | "FAILED" | "SKIPPED" | "PENDING";
  approval_status: "PENDING" | "APPROVED" | "REJECTED";
  step_id: string;
  scene_no: string;     // GSS 書き込み用: project_id ごとの通し番号 ("1", "2", "3"...)
  scene_order: number;  // ⚠️ 内部専用: record_id 採番に使用。GSS には書き込まない。
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

// ─── 02_Scenes (read) ─────────────────────────────────────────────────────────

/**
 * 02_Scenes から読み込む参照用 row（STEP_04/05 が参照）
 * generation_status = "GENERATED" の行のみを対象とする。
 * scene_no は表示用通し番号であり upsert キーには使わない。
 */
export interface SceneReadRow {
  project_id:         string;
  record_id:          string;   // STEP_04/05 の upsert キーとして引き継ぐ
  scene_no:           string;   // 表示用通し番号（"1","2","3"...）。キーに使わない。
  chapter:            string;
  scene_title:        string;
  scene_summary:      string;
  scene_goal:         string;
  visual_focus:       string;
  emotion:            string;   // 論点1: コード側で ScriptRow にそのまま引き継ぐ
  short_use:          string;   // "Y" | "N"
  full_use:           string;   // "Y" | "N"
  est_duration_short: string;
  est_duration_full:  string;
  difficult_words:    string;
  easy_rewrite:       string;
  qa_seed:            string;
  continuity_note:    string;
}

// ─── 03_Script_Short ──────────────────────────────────────────────────────────

/**
 * STEP_04 Short Script Build — AI が返す 1 scene 分の row
 * スキーマ: script_short_schema_ai_v1.json
 *
 * emotion は AI 出力に含めない（論点1: 02_Scenes.emotion をコード側でコピー）。
 * duration_sec は AI 出力に含めない（不明点3: narration_tts 文字数 ÷ 5.5 でコード側が計算）。
 * short_use=N の scene は入力に含めないため、AI も short_use=Y の scene 分のみ返す。
 */
export interface ScriptShortAiRow {
  record_id:        string;   // 02_Scenes.record_id をそのまま返させる（紐付け用）
  narration_draft:  string;
  narration_tts:    string;
  subtitle_short_1: string;   // required（必須・空文字不可）
  subtitle_short_2: string;   // required・空文字可（"" は許容。長い scene は 2 行使用、短い scene は "" で返す）
  emphasis_word:    string;   // optional / 空文字可
  transition_note:  string;
  [key: string]: unknown;     // matchAiOutputToScenes<T extends AiRow> との互換性のため
}

/**
 * Google Sheets 03_Script_Short 書き込み行（script_short_schema_full_v1）
 *
 * record_id は 02_Scenes.record_id をそのまま流用する（新規採番なし）。
 * upsert キー: record_id 単体（シート名固定で一意性を担保）。
 * emotion はコード側が 02_Scenes.emotion をコピー（論点1）。
 * duration_sec はコード側が narration_tts 文字数 ÷ 5.5 で計算（不明点3）。
 */
export interface ScriptShortRow extends ScriptShortAiRow {
  project_id:        string;
  generation_status: "GENERATED" | "FAILED" | "SKIPPED" | "PENDING";
  approval_status:   "PENDING" | "APPROVED" | "REJECTED";
  step_id:           string;   // 固定: "STEP_04_SHORT_SCRIPT_BUILD"
  scene_no:          string;   // 参照用・表示用（キーに使わない）
  related_version:   string;   // 固定: "short"
  duration_sec:      number;   // コード側計算: Math.ceil(narration_tts.length / 5.5)
  emotion:           string;   // 02_Scenes.emotion をコード側でコピー（論点1）
  hook_flag:         string;   // "Y" | "N" | ""（optional）
  tts_ready:         string;   // "Y" | "N" | ""（optional）
  updated_at:        string;
  updated_by:        string;
  notes:             string;
}

// ─── 04_Script_Full ───────────────────────────────────────────────────────────

/**
 * STEP_05 Full Script Build — AI が返す 1 scene 分の row
 * スキーマ: script_full_schema_ai_v1.json
 *
 * emotion は AI 出力に含めない（論点1: 02_Scenes.emotion をコード側でコピー）。
 * duration_sec は AI 出力に含めない（不明点3: narration_tts 文字数 ÷ 5.5 でコード側が計算）。
 * subtitle_short_1/2 は列名に "short" があるが Full版でも同列を使用（論点4: GSS Field_Master 準拠）。
 */
export interface ScriptFullAiRow {
  record_id:        string;   // 02_Scenes.record_id をそのまま返させる（紐付け用）
  narration_draft:  string;
  narration_tts:    string;
  subtitle_short_1: string;   // 論点4: Full版でも同列名を使用
  subtitle_short_2: string;   // 論点4: required・空文字可（短い scene は "" で返す）
  visual_emphasis:  string;   // optional / 空文字可
  pause_hint:       string;
  [key: string]: unknown;     // matchAiOutputToScenes<T extends AiRow> との互換性のため
}

/**
 * Google Sheets 04_Script_Full 書き込み行（script_full_schema_full_v1）
 *
 * record_id は 02_Scenes.record_id をそのまま流用する（新規採番なし）。
 * upsert キー: record_id 単体（シート名固定で一意性を担保）。
 * emotion はコード側が 02_Scenes.emotion をコピー（論点1）。
 * duration_sec はコード側が narration_tts 文字数 ÷ 5.5 で計算（不明点3）。
 */
export interface ScriptFullRow extends ScriptFullAiRow {
  project_id:        string;
  generation_status: "GENERATED" | "FAILED" | "SKIPPED" | "PENDING";
  approval_status:   "PENDING" | "APPROVED" | "REJECTED";
  step_id:           string;   // 固定: "STEP_05_FULL_SCRIPT_BUILD"
  scene_no:          string;   // 参照用・表示用（キーに使わない）
  related_version:   string;   // 固定: "full"
  duration_sec:      number;   // コード側計算: Math.ceil(narration_tts.length / 5.5)
  emotion:           string;   // 02_Scenes.emotion をコード側でコピー（論点1）
  hook_flag:         string;   // "Y" | "N" | ""（optional）
  tts_ready:         string;   // "Y" | "N" | ""（optional）
  updated_at:        string;
  updated_by:        string;
  notes:             string;
}

// ─── 04_Script_Full (read) ────────────────────────────────────────────────────

/**
 * 04_Script_Full から読み込む参照用 row（STEP_04 Short 生成時の任意参照）
 * video_format = "short+full" のときのみ使用。
 * generation_status = "GENERATED" の行のみを対象とする。
 */
export interface ScriptFullReadRow {
  project_id:       string;
  record_id:        string;
  narration_draft:  string;
  narration_tts:    string;
  subtitle_short_1: string;
  subtitle_short_2: string;
  emotion:          string;
  pause_hint:       string;
}

// ─── 05_Visual_Bible ──────────────────────────────────────────────────────────

/** 05_Visual_Bible の category 固定 enum（スキーマと同期） */
export type VisualBibleCategory =
  | "character"
  | "background"
  | "color_theme"
  | "lighting"
  | "style_global"
  | "avoid";

/**
 * STEP_06 Visual Bible — AI が返す 1 element 分の row
 * スキーマ: visual_bible_schema_ai_v1.json
 *
 * record_id は AI 出力に含めない（システム側で採番: PJT-001-VB-001 形式）。
 * scene_no は含めない（論点C: Visual Bible は scene と切り離したプロジェクト辞書）。
 */
export interface VisualBibleAiRow {
  category:         VisualBibleCategory;  // 固定 enum
  key_name:         string;               // AI が自由記述（例: "桃太郎", "川辺", "全体配色"）
  description:      string;               // 要素の概要・役割説明
  color_palette:    string;               // 色指定（空文字可）
  line_style:       string;               // 線・タッチのスタイル（空文字可）
  lighting:         string;               // 照明・明暗指定（空文字可）
  composition_rule: string;               // 構図・フレーミングルール（空文字可）
  crop_rule:        string;               // クロップ・トリミングルール（空文字可）
  expression_rule:  string;               // 表情・動きの表現ルール（空文字可）
  character_rule:   string;               // キャラクターデザインルール（空文字可）
  background_rule:  string;               // 背景描写ルール（空文字可）
  avoid_rule:       string;               // 禁止表現・回避要素（空文字可）
  reference_note:   string;               // 参考メモ・補足（空文字可）
  [key: string]: unknown;                 // AJV バリデーション互換
}

/**
 * Google Sheets 05_Visual_Bible 書き込み行（visual_bible_schema_full_v1）
 *
 * record_id はシステム側で採番する（形式: PJT-001-VB-001）。
 * upsert キー: record_id 単体（シート名固定で一意性を担保）。
 * 再実行時は既存行を record_id で上書き UPDATE する。
 */
export interface VisualBibleRow extends VisualBibleAiRow {
  project_id:        string;
  record_id:         string;   // システム採番: {project_id}-VB-{index:03d}
  generation_status: "GENERATED" | "FAILED" | "PENDING";
  approval_status:   "PENDING" | "APPROVED" | "REJECTED";
  step_id:           string;   // 固定: "STEP_06_VISUAL_BIBLE"
  updated_at:        string;
  updated_by:        string;
  notes:             string;
}

/** 05_Visual_Bible から読み込む参照用 row（再実行時の既存行取得用） */
export interface VisualBibleReadRow {
  project_id:  string;
  record_id:   string;
  category:    string;
  key_name:    string;
}

// ─── 10_QA ───────────────────────────────────────────────────────────────────

/** 10_QA の qa_type 固定 enum（schemas/qa_schema_ai_v1.json と同期） */
export type QaType = "comprehension" | "emotion" | "vocabulary" | "moral";

/** 10_QA の related_version 固定 enum */
export type QaVersion = "full" | "short";

/**
 * STEP_09 Q&A Build — AI が返す 1 設問分の row
 * スキーマ: qa_schema_ai_v1.json
 *
 * record_id / qa_no / related_version は AI 出力に含めない（システム側で付与）。
 */
export interface QaAiRow {
  qa_type:          QaType;  // 固定 enum
  question:         string;  // 設問文
  answer_short:     string;  // 短い答え（1〜2語）
  answer_narration: string;  // 解説文（30〜60字）
  subtitle:         string;  // カード見出し（10〜20字）
}

/**
 * Google Sheets 10_QA 書き込み行（qa_schema_full_v1）
 *
 * record_id はシステム側で採番する（形式: PJT-001-QA-001）。
 * upsert キー: record_id 単体。
 * UNUSED フィールド（card_visual / duration_sec / learning_goal）は "" で書き込む。
 */
export interface QaRow extends QaAiRow {
  project_id:        string;
  record_id:         string;    // システム採番: {project_id}-QA-{seq:03d}
  generation_status: "GENERATED" | "FAILED" | "PENDING";
  approval_status:   "PENDING" | "APPROVED" | "REJECTED";
  step_id:           string;    // 固定: "STEP_09_QA_BUILD"
  qa_no:             number;    // バージョン内の連番（1〜）
  related_version:   QaVersion; // "full" | "short"
  card_visual:       "";        // UNUSED: 常に空文字
  duration_sec:      "";        // UNUSED: 常に空文字
  learning_goal:     "";        // UNUSED: 常に空文字
  updated_at:        string;
  updated_by:        string;
  notes:             string;
}

/** 10_QA から読み込む参照用 row（再実行時の既存行取得用） */
export interface QaReadRow {
  project_id:      string;
  record_id:       string;
  related_version: QaVersion;
}

// ─── Workflow Payload ─────────────────────────────────────────────────────────

export interface WorkflowPayload {
  project_ids: string[];
  max_items: number;
  dry_run: boolean;
}
