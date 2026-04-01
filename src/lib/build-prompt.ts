/**
 * build-prompt.ts
 *
 * プロンプトテンプレートへのプレースホルダー置換を行う。
 *
 * テンプレート内の {{KEY}} を replacements[KEY] で置換する。
 */

import type { ProjectRow } from "../types.js";
import type { Step01Assets } from "./load-assets.js";

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
