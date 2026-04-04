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
import type { RightsValidationAiRow, SourceAiRow, SceneAiRow } from "../types.js";

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
 * AI 出力は { scenes: [...] } 形式（rows ではなく scenes キー）。
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
