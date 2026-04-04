/**
 * validate-json.ts
 *
 * AI レスポンスの parse / validate / normalize を担当する。
 *
 * 処理順:
 * 1. AI テキストから JSON ブロックを抽出
 * 2. Ajv でスキーマに対してバリデーション
 * 3. 型安全な AI row を返す
 */

import Ajv from "ajv";
import type { RightsValidationAiRow, SourceAiRow, SceneAiRow, ScriptFullAiRow, ScriptShortAiRow } from "../types.js";

const ajv = new Ajv({ allErrors: true, strict: false });

export interface ValidationResult {
  success: true;
  row: RightsValidationAiRow;
}

export interface ValidationFailure {
  success: false;
  errors: string;
  rawText: string;
}

export type ValidateJsonResult = ValidationResult | ValidationFailure;

/**
 * AI レスポンステキストを parse / validate して RightsValidationAiRow を返す。
 *
 * @param rawText  - Gemini が返したテキスト
 * @param schema   - rights_validation_schema_ai_v1.json の文字列
 */
export function validateAiResponse(
  rawText: string,
  schema: string
): ValidateJsonResult {
  // 1. JSON 抽出
  const extracted = extractJson(rawText);
  if (extracted === null) {
    return {
      success: false,
      errors: "Could not extract valid JSON from AI response.",
      rawText,
    };
  }

  // 2. parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted);
  } catch (e) {
    return {
      success: false,
      errors: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
      rawText,
    };
  }

  // 3. Ajv バリデーション
  let schemaObj: unknown;
  try {
    schemaObj = JSON.parse(schema);
  } catch {
    return {
      success: false,
      errors: "Failed to parse AI schema JSON file.",
      rawText,
    };
  }

  const validate = ajv.compile(schemaObj as object);
  const valid = validate(parsed);

  if (!valid) {
    const errors = ajv.errorsText(validate.errors, { separator: "; " });
    return { success: false, errors, rawText };
  }

  // 4. rows[0] を取り出す
  const response = parsed as { rows: RightsValidationAiRow[] };
  if (!response.rows || response.rows.length === 0) {
    return {
      success: false,
      errors: "rows array is empty after validation.",
      rawText,
    };
  }

  return { success: true, row: response.rows[0] };
}

// ─── STEP_02 用バリデーター ───────────────────────────────────────────────────

export interface SourceValidationResult {
  success: true;
  row: SourceAiRow;
}

export interface SourceValidationFailure {
  success: false;
  errors: string;
  rawText: string;
}

export type ValidateSourceResult = SourceValidationResult | SourceValidationFailure;

/**
 * STEP_02 AI レスポンスを parse / validate して SourceAiRow を返す。
 */
export function validateSourceAiResponse(
  rawText: string,
  schema: string
): ValidateSourceResult {
  const extracted = extractJson(rawText);
  if (extracted === null) {
    return {
      success: false,
      errors: "Could not extract valid JSON from AI response.",
      rawText,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted);
  } catch (e) {
    return {
      success: false,
      errors: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
      rawText,
    };
  }

  let schemaObj: unknown;
  try {
    schemaObj = JSON.parse(schema);
  } catch {
    return {
      success: false,
      errors: "Failed to parse AI schema JSON file.",
      rawText,
    };
  }

  const validate = ajv.compile(schemaObj as object);
  const valid = validate(parsed);

  if (!valid) {
    const errors = ajv.errorsText(validate.errors, { separator: "; " });
    return { success: false, errors, rawText };
  }

  const response = parsed as { rows: SourceAiRow[] };
  if (!response.rows || response.rows.length === 0) {
    return {
      success: false,
      errors: "rows array is empty after validation.",
      rawText,
    };
  }

  return { success: true, row: response.rows[0] };
}

// ─── STEP_03 用バリデーター ───────────────────────────────────────────────────

export interface SceneValidationResult {
  success: true;
  scenes: SceneAiRow[];
}

export interface SceneValidationFailure {
  success: false;
  errors: string;
  rawText: string;
}

export type ValidateSceneResult = SceneValidationResult | SceneValidationFailure;

/**
 * STEP_03 AI レスポンスを parse / validate して SceneAiRow[] を返す。
 *
 * AI 出力は { scenes: [...] } 形式（rows ではなく scenes キー）。
 * 各 scene には chapter, scene_title, scene_summary, scene_goal, visual_focus,
 * emotion, short_use, full_use, est_duration_short, est_duration_full,
 * difficult_words, easy_rewrite, qa_seed, continuity_note が含まれる。
 * scene_id / scene_order は AI 出力に含まれず、システム側で付与する。
 */
export function validateSceneAiResponse(
  rawText: string,
  schema: string
): ValidateSceneResult {
  const extracted = extractJson(rawText);
  if (extracted === null) {
    return {
      success: false,
      errors: "Could not extract valid JSON from AI response.",
      rawText,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted);
  } catch (e) {
    return {
      success: false,
      errors: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
      rawText,
    };
  }

  let schemaObj: unknown;
  try {
    schemaObj = JSON.parse(schema);
  } catch {
    return {
      success: false,
      errors: "Failed to parse AI schema JSON file.",
      rawText,
    };
  }

  const validate = ajv.compile(schemaObj as object);
  const valid = validate(parsed);

  if (!valid) {
    const errors = ajv.errorsText(validate.errors, { separator: "; " });
    return { success: false, errors, rawText };
  }

  const response = parsed as { scenes: SceneAiRow[] };
  if (!response.scenes || response.scenes.length === 0) {
    return {
      success: false,
      errors: "scenes array is empty after validation.",
      rawText,
    };
  }

  return { success: true, scenes: response.scenes };
}

// ─── STEP_05 用バリデーター（Script Full）────────────────────────────────────

export interface ScriptFullValidationResult {
  success: true;
  scripts: ScriptFullAiRow[];
}

export interface ScriptFullValidationFailure {
  success: false;
  errors: string;
  rawText: string;
}

export type ValidateScriptFullResult =
  | ScriptFullValidationResult
  | ScriptFullValidationFailure;

/**
 * STEP_05 AI レスポンスを parse / validate して ScriptFullAiRow[] を返す。
 *
 * AI 出力は { "scripts": [...] } 形式。
 * 各 script には record_id, narration_draft, narration_tts,
 * subtitle_short_1, subtitle_short_2, pause_hint が必須。
 * visual_emphasis は optional（空文字可）。
 * emotion / duration_sec は AI 出力に含まれない（コード側で付与）。
 */
export function validateScriptFullAiResponse(
  rawText: string,
  schema: string
): ValidateScriptFullResult {
  const extracted = extractJson(rawText);
  if (extracted === null) {
    return {
      success: false,
      errors: "Could not extract valid JSON from AI response.",
      rawText,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted);
  } catch (e) {
    return {
      success: false,
      errors: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
      rawText,
    };
  }

  let schemaObj: unknown;
  try {
    schemaObj = JSON.parse(schema);
  } catch {
    return {
      success: false,
      errors: "Failed to parse AI schema JSON file.",
      rawText,
    };
  }

  const validate = ajv.compile(schemaObj as object);
  const valid = validate(parsed);

  if (!valid) {
    const errors = ajv.errorsText(validate.errors, { separator: "; " });
    return { success: false, errors, rawText };
  }

  const response = parsed as { scripts: ScriptFullAiRow[] };
  if (!response.scripts || response.scripts.length === 0) {
    return {
      success: false,
      errors: "scripts array is empty after validation.",
      rawText,
    };
  }

  // 追加バリデーション: 必須フィールドの空文字チェック
  for (let i = 0; i < response.scripts.length; i++) {
    const s = response.scripts[i];
    for (const field of ["record_id", "narration_draft", "narration_tts", "subtitle_short_1", "pause_hint"] as const) {
      if (!s[field] || s[field].trim() === "") {
        return {
          success: false,
          errors: `scripts[${i}].${field} is empty (empty_required_field).`,
          rawText,
        };
      }
    }
  }

  return { success: true, scripts: response.scripts };
}

// ─── STEP_04 用バリデーター（Script Short）───────────────────────────────────

export interface ScriptShortValidationResult {
  success: true;
  scripts: ScriptShortAiRow[];
}

export interface ScriptShortValidationFailure {
  success: false;
  errors: string;
  rawText: string;
}

export type ValidateScriptShortResult =
  | ScriptShortValidationResult
  | ScriptShortValidationFailure;

/**
 * STEP_04 AI レスポンスを parse / validate して ScriptShortAiRow[] を返す。
 *
 * AI 出力は { "scripts": [...] } 形式。
 * 各 script には record_id, narration_draft, narration_tts,
 * subtitle_short_1, subtitle_short_2, transition_note が必須。
 * emphasis_word は optional（空文字可）。
 * emotion / duration_sec は AI 出力に含まれない（コード側で付与）。
 */
export function validateScriptShortAiResponse(
  rawText: string,
  schema: string
): ValidateScriptShortResult {
  const extracted = extractJson(rawText);
  if (extracted === null) {
    return {
      success: false,
      errors: "Could not extract valid JSON from AI response.",
      rawText,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted);
  } catch (e) {
    return {
      success: false,
      errors: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
      rawText,
    };
  }

  let schemaObj: unknown;
  try {
    schemaObj = JSON.parse(schema);
  } catch {
    return {
      success: false,
      errors: "Failed to parse AI schema JSON file.",
      rawText,
    };
  }

  const validate = ajv.compile(schemaObj as object);
  const valid = validate(parsed);

  if (!valid) {
    const errors = ajv.errorsText(validate.errors, { separator: "; " });
    return { success: false, errors, rawText };
  }

  const response = parsed as { scripts: ScriptShortAiRow[] };
  if (!response.scripts || response.scripts.length === 0) {
    return {
      success: false,
      errors: "scripts array is empty after validation.",
      rawText,
    };
  }

  // 追加バリデーション: 必須フィールドの空文字チェック
  for (let i = 0; i < response.scripts.length; i++) {
    const s = response.scripts[i];
    for (const field of ["record_id", "narration_draft", "narration_tts", "subtitle_short_1", "transition_note"] as const) {
      if (!s[field] || s[field].trim() === "") {
        return {
          success: false,
          errors: `scripts[${i}].${field} is empty (empty_required_field).`,
          rawText,
        };
      }
    }
  }

  return { success: true, scripts: response.scripts };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * テキストから JSON ブロックを抽出する。
 * AI が Markdown コードフェンス (```json ... ```) で囲んで返す場合も対応する。
 */
function extractJson(text: string): string | null {
  const trimmed = text.trim();

  // コードフェンスがある場合 (```json ... ``` or ``` ... ```)
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // 直接 JSON オブジェクトで始まる場合（{ で始まり } で終わる）
  const directMatch = trimmed.match(/^(\{[\s\S]*\})$/);
  if (directMatch) {
    return directMatch[1].trim();
  }

  // テキスト中に埋め込まれた JSON ブロック
  const embeddedMatch = trimmed.match(/(\{[\s\S]*\})/);
  if (embeddedMatch) {
    return embeddedMatch[1].trim();
  }

  return null;
}
