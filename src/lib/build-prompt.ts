/**
 * build-prompt.ts
 *
 * プロンプトテンプレートへのプレースホルダー置換を行う。
 *
 * テンプレート内の {{KEY}} を replacements[KEY] で置換する。
 */

import type { ProjectRow, RightsValidationReadRow, SourceReadRow } from "../types.js";
import type { Step01Assets, Step02Assets, Step03Assets } from "./load-assets.js";

/**
 * プレースホルダーを一括置換する汎用関数。
 */
export function buildPrompt(
  template: string,
  replacements: Record<string, string>
): string {
  return Object.entries(replacements).reduce(
    (acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value),
    template
  );
}

/**
 * STEP_01 用のプロンプトを組み立てる。
 *
 * テンプレート内のプレースホルダー:
 * - {{COPYRIGHT_POLICY}}
 * - {{RIGHTS_REVIEW_POLICY}}
 * - {{INPUT_DATA}}
 * - {{OUTPUT_JSON_SCHEMA}}
 * - {{OUTPUT_FIELD_GUIDE}}
 * - {{OUTPUT_EXAMPLE}}
 */
export function buildStep01Prompt(
  assets: Step01Assets,
  project: ProjectRow
): string {
  // AI に渡す INPUT_DATA（初期実装は title_jp と source_url のみ）
  const inputData = JSON.stringify(
    {
      project_id: project.project_id,
      record_id: project.record_id,
      title_jp: project.title_jp ?? "",
      title_en: project.title_en ?? "",
      source_title: project.source_title ?? "",
      source_url: project.source_url ?? "",
      notes: project.notes ?? "",
    },
    null,
    2
  );

  return buildPrompt(assets.promptTemplate, {
    COPYRIGHT_POLICY: assets.copyrightPolicy,
    RIGHTS_REVIEW_POLICY: assets.rightsReviewPolicy,
    INPUT_DATA: inputData,
    OUTPUT_JSON_SCHEMA: assets.aiSchema,
    OUTPUT_FIELD_GUIDE: assets.outputFieldGuide,
    OUTPUT_EXAMPLE: assets.aiResponseExample,
  });
}

/**
 * STEP_02 用のプロンプトを組み立てる。
 *
 * テンプレート内のプレースホルダー:
 * - {{COPYRIGHT_POLICY}}
 * - {{INPUT_DATA}}
 * - {{OUTPUT_JSON_SCHEMA}}
 * - {{OUTPUT_FIELD_GUIDE}}
 * - {{OUTPUT_EXAMPLE}}
 */
export function buildStep02Prompt(
  assets: Step02Assets,
  project: ProjectRow,
  rightsValidation: RightsValidationReadRow
): string {
  // AI に渡す INPUT_DATA（Mandatory: project_id, title_jp, source_url, target_age）
  const inputData = JSON.stringify(
    {
      project_id: project.project_id,
      title_jp: project.title_jp ?? "",
      source_url: project.source_url ?? "",
      target_age: project.target_age ?? "",
      // 00_Rights_Validation からの補完（Optional）
      original_author: rightsValidation.original_author ?? "",
      translator: rightsValidation.translator ?? "",
      rights_summary: rightsValidation.rights_summary ?? "",
    },
    null,
    2
  );

  return buildPrompt(assets.promptTemplate, {
    COPYRIGHT_POLICY: assets.copyrightPolicy,
    DIFFICULT_TERMS_POLICY: assets.difficultTermsPolicy,
    INPUT_DATA: inputData,
    OUTPUT_JSON_SCHEMA: assets.aiSchema,
    OUTPUT_FIELD_GUIDE: assets.outputFieldGuide,
    OUTPUT_EXAMPLE: assets.aiResponseExample,
  });
}

/**
 * STEP_03 用のプロンプトを組み立てる。
 *
 * テンプレート内のプレースホルダー:
 * - {{SCENE_COUNT_AND_DURATION_POLICY}}
 * - {{AGE_BAND_SCENE_GUIDELINE}}
 * - {{INPUT_DATA}}
 * - {{OUTPUT_JSON_SCHEMA}}
 * - {{OUTPUT_FIELD_GUIDE}}
 * - {{OUTPUT_EXAMPLE}}
 */
export function buildStep03Prompt(
  assets: Step03Assets,
  project: ProjectRow,
  sourceRow: SourceReadRow,
  sceneMaxSec: number,
  requiredSceneCount: number
): string {
  const fullTargetSec = parseInt(project.full_target_sec ?? "0", 10);
  const shortTargetSec = parseInt(project.short_target_sec ?? "0", 10);

  // project_id から project 番号を抽出（SC-001-XX の生成ヒント用）
  const projectNumMatch = project.project_id.match(/^PJT-(\d+)$/);
  const projectNum = projectNumMatch ? projectNumMatch[1].padStart(3, "0") : "001";

  const inputData = JSON.stringify(
    {
      project_id: project.project_id,
      project_num: projectNum,
      title_jp: project.title_jp ?? "",
      target_age: project.target_age ?? "",
      short_target_sec: shortTargetSec,
      full_target_sec: fullTargetSec,
      visual_style: project.visual_style ?? "",
      // 01_Source からの入力
      adaptation_policy: sourceRow.adaptation_policy ?? "",
      language_style: sourceRow.language_style ?? "",
      difficult_terms: sourceRow.difficult_terms ?? "",
      credit_text: sourceRow.credit_text ?? "",
      base_text_notes: sourceRow.base_text_notes ?? "",
      // scene 設計パラメータ（GitHub 側で算出して渡す）
      scene_max_sec: sceneMaxSec,
      required_scene_count: requiredSceneCount,
    },
    null,
    2
  );

  return buildPrompt(assets.promptTemplate, {
    SCENE_COUNT_AND_DURATION_POLICY: assets.sceneCountAndDurationPolicy,
    AGE_BAND_SCENE_GUIDELINE: assets.ageBandSceneGuideline,
    INPUT_DATA: inputData,
    OUTPUT_JSON_SCHEMA: assets.aiSchema,
    OUTPUT_FIELD_GUIDE: assets.outputFieldGuide,
    OUTPUT_EXAMPLE: assets.aiResponseExample,
  });
}
