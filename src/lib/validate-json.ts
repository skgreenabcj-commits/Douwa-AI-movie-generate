/**
 * validate-json.ts
 *
 * AI レスポンスの parse / validate / normalize を担当する。
 *
 * 処理順:
 * 1. AI テキストから JSON ブロックを抽出（extractJson）
 * 2. JSON.parse
 * 3. Ajv でスキーマに対してバリデーション（コンパイル結果をキャッシュ）
 * 4. 追加バリデーション（空文字チェック・件数チェック）
 * 5. 型安全な AI row を返す
 *
 * subtitle_short_2 ルール（Fix #4 統一）:
 *   - required: true（省略不可）
 *   - 空文字 \"\" は許容（短い scene では使わないことがある）
 *   - 空文字チェックの対象外（subtitle_short_1 / narration_* のみ必須空文字チェック）
 *
 * record_id 件数チェック（Fix #5）:
 *   - validateScriptFullAiResponse / validateScriptShortAiResponse は
 *     expectedCount を受け取り、AI 出力件数と一致しない場合は fail を返す
 */

import Ajv, { type ValidateFunction } from "ajv";
import type {
  RightsValidationAiRow,
  SourceAiRow,
  SceneAiRow,
  ScriptFullAiRow,
  ScriptShortAiRow,
  VisualBibleAiRow,
} from "../types.js";

// NodeNext + AJV8 でデフォルトエクスポートがコンストラクタとして解決されない場合の型キャスト。
// InstanceType<typeof Ajv> は NodeNext 環境で型解決が失敗するため、使用するメソッドを直接定義する。
type AjvLike = {
  compile: (schema: object) => ValidateFunction;
  errorsText: (errors: unknown, opts?: { separator?: string }) => string;
};
type AjvConstructor = new (opts?: object) => AjvLike;

// Ajv インスタンスはモジュール単位で1つ（Fix #9: 再利用）
const ajv = new (Ajv as unknown as AjvConstructor)({ allErrors: true, strict: false });

// ─── スキーマキャッシュ（Fix #9: compile の再利用） ────────────────────────────
const schemaCache = new Map<string, ValidateFunction>();

function getValidator(schemaStr: string): ValidateFunction | null {
  if (schemaCache.has(schemaStr)) {
    return schemaCache.get(schemaStr)!;
  }
  let schemaObj: unknown;
  try {
    schemaObj = JSON.parse(schemaStr);
  } catch {
    return null;
  }
  const validator = ajv.compile(schemaObj as object);
  schemaCache.set(schemaStr, validator);
  return validator;
}

// ─── STEP_01 用バリデーター ───────────────────────────────────────────────────

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
 */
export function validateAiResponse(
  rawText: string,
  schema: string
): ValidateJsonResult {
  const extracted = extractJson(rawText);
  if (extracted === null) {
    return { success: false, errors: "Could not extract valid JSON from AI response.", rawText };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted);
  } catch (e) {
    return { success: false, errors: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`, rawText };
  }

  const validate = getValidator(schema);
  if (!validate) {
    return { success: false, errors: "Failed to parse AI schema JSON file.", rawText };
  }

  if (!validate(parsed)) {
    return { success: false, errors: ajv.errorsText(validate.errors, { separator: "; " }), rawText };
  }

  const response = parsed as { rows: RightsValidationAiRow[] };
  if (!response.rows || response.rows.length === 0) {
    return { success: false, errors: "rows array is empty after validation.", rawText };
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
    return { success: false, errors: "Could not extract valid JSON from AI response.", rawText };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted);
  } catch (e) {
    return { success: false, errors: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`, rawText };
  }

  const validate = getValidator(schema);
  if (!validate) {
    return { success: false, errors: "Failed to parse AI schema JSON file.", rawText };
  }

  if (!validate(parsed)) {
    return { success: false, errors: ajv.errorsText(validate.errors, { separator: "; " }), rawText };
  }

  const response = parsed as { rows: SourceAiRow[] };
  if (!response.rows || response.rows.length === 0) {
    return { success: false, errors: "rows array is empty after validation.", rawText };
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
 * AI 出力は { scenes: [...] } 形式。
 * scene_no / scene_order は AI 出力に含まれず、システム側で付与する。
 */
export function validateSceneAiResponse(
  rawText: string,
  schema: string
): ValidateSceneResult {
  const extracted = extractJson(rawText);
  if (extracted === null) {
    return { success: false, errors: "Could not extract valid JSON from AI response.", rawText };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted);
  } catch (e) {
    return { success: false, errors: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`, rawText };
  }

  const validate = getValidator(schema);
  if (!validate) {
    return { success: false, errors: "Failed to parse AI schema JSON file.", rawText };
  }

  if (!validate(parsed)) {
    return { success: false, errors: ajv.errorsText(validate.errors, { separator: "; " }), rawText };
  }

  const response = parsed as { scenes: SceneAiRow[] };
  if (!response.scenes || response.scenes.length === 0) {
    return { success: false, errors: "scenes array is empty after validation.", rawText };
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
 * @param rawText       - Gemini が返したテキスト
 * @param schema        - script_full_schema_ai_v1.json の文字列
 * @param expectedCount - 入力した full_use=Y の scene 件数。
 *                        AI 出力件数と一致しない場合は fail を返す（Fix #5）。
 *
 * subtitle_short_2: required だが空文字 "" は許容（Fix #4）。
 * 空文字チェックの対象は record_id, narration_draft, narration_tts,
 * subtitle_short_1, pause_hint のみ。
 */
export function validateScriptFullAiResponse(
  rawText: string,
  schema: string,
  expectedCount?: number
): ValidateScriptFullResult {
  const extracted = extractJson(rawText);
  if (extracted === null) {
    return { success: false, errors: "Could not extract valid JSON from AI response.", rawText };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted);
  } catch (e) {
    return { success: false, errors: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`, rawText };
  }

  const validate = getValidator(schema);
  if (!validate) {
    return { success: false, errors: "Failed to parse AI schema JSON file.", rawText };
  }

  if (!validate(parsed)) {
    return { success: false, errors: ajv.errorsText(validate.errors, { separator: "; " }), rawText };
  }

  const response = parsed as { scripts: ScriptFullAiRow[] };
  if (!response.scripts || response.scripts.length === 0) {
    return { success: false, errors: "scripts array is empty after validation.", rawText };
  }

  // Fix #5: 件数チェック（fail-fast）
  if (expectedCount !== undefined && response.scripts.length !== expectedCount) {
    return {
      success: false,
      errors: `scene_count_mismatch: expected ${expectedCount} scripts, AI returned ${response.scripts.length}. ` +
              `This is a hard error; use the full expected count to avoid partial upserts.`,
      rawText,
    };
  }

  // 追加バリデーション: 空文字チェック（subtitle_short_2 は除外）
  for (let i = 0; i < response.scripts.length; i++) {
    const s = response.scripts[i];
    for (const field of [
      "record_id",
      "narration_draft",
      "narration_tts",
      "subtitle_short_1",
      "pause_hint",
    ] as const) {
      // index signature により s[field] は unknown になるため string にキャスト
      const val = s[field] as string;
      if (!val || val.trim() === "") {
        return {
          success: false,
          errors: `scripts[${i}].${field} is empty (empty_required_field).`,
          rawText,
        };
      }
    }
    // subtitle_short_2: required（省略不可）だが空文字は許容。undefined のみ reject。
    if (s.subtitle_short_2 === undefined || s.subtitle_short_2 === null) {
      return {
        success: false,
        errors: `scripts[${i}].subtitle_short_2 is missing (must be string, empty "" is allowed).`,
        rawText,
      };
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
 * @param rawText       - Gemini が返したテキスト
 * @param schema        - script_short_schema_ai_v1.json の文字列
 * @param expectedCount - 入力した short_use=Y の scene 件数。
 *                        AI 出力件数と一致しない場合は fail を返す（Fix #5）。
 *
 * subtitle_short_2: required だが空文字 "" は許容（Fix #4）。
 */
export function validateScriptShortAiResponse(
  rawText: string,
  schema: string,
  expectedCount?: number
): ValidateScriptShortResult {
  const extracted = extractJson(rawText);
  if (extracted === null) {
    return { success: false, errors: "Could not extract valid JSON from AI response.", rawText };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted);
  } catch (e) {
    return { success: false, errors: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`, rawText };
  }

  const validate = getValidator(schema);
  if (!validate) {
    return { success: false, errors: "Failed to parse AI schema JSON file.", rawText };
  }

  if (!validate(parsed)) {
    return { success: false, errors: ajv.errorsText(validate.errors, { separator: "; " }), rawText };
  }

  const response = parsed as { scripts: ScriptShortAiRow[] };
  if (!response.scripts || response.scripts.length === 0) {
    return { success: false, errors: "scripts array is empty after validation.", rawText };
  }

  // Fix #5: 件数チェック（fail-fast）
  if (expectedCount !== undefined && response.scripts.length !== expectedCount) {
    return {
      success: false,
      errors: `scene_count_mismatch: expected ${expectedCount} scripts, AI returned ${response.scripts.length}. ` +
              `This is a hard error; use the full expected count to avoid partial upserts.`,
      rawText,
    };
  }

  // 追加バリデーション: 空文字チェック（subtitle_short_2 は除外）
  for (let i = 0; i < response.scripts.length; i++) {
    const s = response.scripts[i];
    for (const field of [
      "record_id",
      "narration_draft",
      "narration_tts",
      "subtitle_short_1",
      "transition_note",
    ] as const) {
      // index signature により s[field] は unknown になるため string にキャスト
      const val = s[field] as string;
      if (!val || val.trim() === "") {
        return {
          success: false,
          errors: `scripts[${i}].${field} is empty (empty_required_field).`,
          rawText,
        };
      }
    }
    // subtitle_short_2: required だが空文字は許容
    if (s.subtitle_short_2 === undefined || s.subtitle_short_2 === null) {
      return {
        success: false,
        errors: `scripts[${i}].subtitle_short_2 is missing (must be string, empty "" is allowed).`,
        rawText,
      };
    }
  }

  return { success: true, scripts: response.scripts };
}

// ─── STEP_06 用バリデーター（Visual Bible）───────────────────────────────────

export interface VisualBibleValidationResult {
  success: true;
  items: VisualBibleAiRow[];
}

export interface VisualBibleValidationFailure {
  success: false;
  errors: string;
  rawText: string;
}

export type ValidateVisualBibleResult =
  | VisualBibleValidationResult
  | VisualBibleValidationFailure;

/**
 * STEP_06 AI レスポンスを parse / validate して VisualBibleAiRow[] を返す。
 *
 * - expectedCount は不要（AI が判断した件数を受け入れる）
 * - category / key_name / description の必須チェックはスキーマ（minLength:1 / enum）が保証
 * - 他フィールドは空文字可（string 型のみ強制）
 */
export function validateVisualBibleAiResponse(
  rawText: string,
  schema: string
): ValidateVisualBibleResult {
  const extracted = extractJson(rawText);
  if (extracted === null) {
    return { success: false, errors: "Could not extract valid JSON from AI response.", rawText };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted);
  } catch (e) {
    return { success: false, errors: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`, rawText };
  }

  const validate = getValidator(schema);
  if (!validate) {
    return { success: false, errors: "Failed to parse AI schema JSON file.", rawText };
  }

  if (!validate(parsed)) {
    return { success: false, errors: ajv.errorsText(validate.errors, { separator: "; " }), rawText };
  }

  const response = parsed as { visual_bible: VisualBibleAiRow[] };
  if (!response.visual_bible || response.visual_bible.length === 0) {
    return { success: false, errors: "visual_bible array is empty after validation.", rawText };
  }

  return { success: true, items: response.visual_bible };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * テキストから JSON オブジェクト（{...}）ブロックを抽出する（Fix #9: 堅牢化）。
 *
 * 優先順:
 * 1. Markdown コードフェンス (```json ... ``` or ``` ... ```)
 * 2. テキスト全体がそのまま JSON の場合（先頭 { 末尾 }）
 * 3. 最初の { から対応する最後の } までを取り出す（ネスト対応の brace カウント）
 *
 * 注: brace カウント方式は文字列内に含まれるブレースをカウントしてしまう制限があるが、
 * AI 出力の実用上は十分な精度を持つ。
 */
function extractJson(text: string): string | null {
  const trimmed = text.trim();

  // 1. コードフェンス内から取り出す
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    const inner = fenceMatch[1].trim();
    if (inner.startsWith("{")) return inner;
  }

  // 2. テキスト全体が JSON オブジェクト
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  // 3. brace カウントで最初の完全な JSON オブジェクトを取り出す
  const start = trimmed.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }

  return null;
}
