/**
 * build-prompt.ts
 *
 * プロンプトテンプレートへのプレースホルダー置換を行う。
 *
 * テンプレート内の {{KEY}} を replacements[KEY] で置換する。
 */

import type { ProjectRow, RightsValidationReadRow, SourceReadRow, SceneReadRow, ScriptFullReadRow } from "../types.js";
import type { Step01Assets, Step02Assets, Step03Assets, Step04Assets, Step05Assets } from "./load-assets.js";

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
 *
 * inputData キー:
 * - project_id, title_jp, target_age, short_target_sec, full_target_sec, visual_style
 * - adaptation_policy, language_style, difficult_terms, credit_text, base_text_notes
 * - scene_max_sec: target_age に対応する 1 scene 最大秒数（Runtime Config 参照値）
 * - required_scene_count_base: ceil(full_target_sec / scene_max_sec)。
 *   AI はこの値の ±15% 程度を許容範囲として scene 数を調整してよい。
 */
export function buildStep03Prompt(
  assets: Step03Assets,
  project: ProjectRow,
  sourceRow: SourceReadRow,
  sceneMaxSec: number,
  requiredSceneCountBase: number
): string {
  const fullTargetSec = parseInt(project.full_target_sec ?? "0", 10);
  const shortTargetSec = parseInt(project.short_target_sec ?? "0", 10);

  const inputData = JSON.stringify(
    {
      project_id: project.project_id,
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
      required_scene_count_base: requiredSceneCountBase,
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

/**
 * STEP_05 用のプロンプトを組み立てる（Full Script Build）。
 *
 * テンプレート内のプレースホルダー:
 * - {{INPUT_DATA}}          : project + 02_Scenes rows（full_use=Y のみ）
 * - {{OUTPUT_JSON_SCHEMA}}  : script_full_schema_ai_v1.json
 * - {{OUTPUT_FIELD_GUIDE}}  : script_output_field_guide_full_v1.md
 * - {{OUTPUT_EXAMPLE}}      : script_full_ai_response_example_v1.json
 *
 * INPUT_DATA の scenes 配列:
 * - full_use=Y の scene のみを渡す
 * - emotion / difficult_words / easy_rewrite を含める（論点3）
 * - 各 scene に record_id を含める（AI が record_id を返す際の突合キー）
 */
export function buildStep05Prompt(
  assets: Step05Assets,
  project: ProjectRow,
  scenes: SceneReadRow[]   // full_use=Y でフィルタ済みであること
): string {
  const fullTargetSec = parseInt(project.full_target_sec ?? "0", 10);

  const scenesInput = scenes.map((s) => ({
    record_id:         s.record_id,
    scene_no:          s.scene_no,
    chapter:           s.chapter,
    scene_title:       s.scene_title,
    scene_summary:     s.scene_summary,
    scene_goal:        s.scene_goal,
    visual_focus:      s.visual_focus,
    emotion:           s.emotion,
    est_duration_full: Number(s.est_duration_full) || 0,
    difficult_words:   s.difficult_words,
    easy_rewrite:      s.easy_rewrite,
    continuity_note:   s.continuity_note,
  }));

  const inputData = JSON.stringify(
    {
      project_id:      project.project_id,
      title_jp:        project.title_jp ?? "",
      target_age:      project.target_age ?? "",
      full_target_sec: fullTargetSec,
      visual_style:    project.visual_style ?? "",
      notes:           project.notes ?? "",
      scenes:          scenesInput,
    },
    null,
    2
  );

  return buildPrompt(assets.promptTemplate, {
    INPUT_DATA:         inputData,
    OUTPUT_JSON_SCHEMA: assets.aiSchema,
    OUTPUT_FIELD_GUIDE: assets.outputFieldGuide,
    OUTPUT_EXAMPLE:     assets.aiResponseExample,
  });
}

/**
 * STEP_04 用のプロンプトを組み立てる（Short Script Build）。
 *
 * テンプレート内のプレースホルダー:
 * - {{INPUT_DATA}}          : project + 02_Scenes rows（short_use=Y のみ）+ Full 参照（任意）
 * - {{HAS_FULL_SCRIPT}}     : "true" or "false"
 * - {{OUTPUT_JSON_SCHEMA}}  : script_short_schema_ai_v1.json
 * - {{OUTPUT_FIELD_GUIDE}}  : script_output_field_guide_short_v1.md
 * - {{OUTPUT_EXAMPLE}}      : script_short_ai_response_example_v1.json
 *
 * INPUT_DATA の scenes 配列:
 * - short_use=Y の scene のみを渡す（不明点6）
 * - hasFullScript=true の場合: 対応 Full script の narration_draft/tts/pause_hint を
 *   scenes 配列の各要素に full_script_ref として追記（不明点1）
 * - hasFullScript=false の場合: full_script_ref は含めない
 */
export function buildStep04Prompt(
  assets: Step04Assets,
  project: ProjectRow,
  scenes: SceneReadRow[],          // short_use=Y でフィルタ済みであること
  fullScripts: ScriptFullReadRow[] // 空配列なら hasFullScript=false とみなす
): string {
  const shortTargetSec = parseInt(project.short_target_sec ?? "0", 10);
  const hasFullScript = fullScripts.length > 0;

  // record_id → ScriptFullReadRow のマップ（O(1) 突合用）
  const fullScriptMap = new Map<string, ScriptFullReadRow>(
    fullScripts.map((f) => [f.record_id, f])
  );

  const scenesInput = scenes.map((s) => {
    const base = {
      record_id:          s.record_id,
      scene_no:           s.scene_no,
      chapter:            s.chapter,
      scene_title:        s.scene_title,
      scene_summary:      s.scene_summary,
      scene_goal:         s.scene_goal,
      visual_focus:       s.visual_focus,
      emotion:            s.emotion,
      est_duration_short: Number(s.est_duration_short) || 0,
      difficult_words:    s.difficult_words,
      easy_rewrite:       s.easy_rewrite,
      continuity_note:    s.continuity_note,
    };

    if (hasFullScript) {
      const fullRef = fullScriptMap.get(s.record_id);
      if (fullRef) {
        return {
          ...base,
          full_script_ref: {
            narration_draft: fullRef.narration_draft,
            narration_tts:   fullRef.narration_tts,
            pause_hint:      fullRef.pause_hint,
          },
        };
      }
    }
    return base;
  });

  const inputData = JSON.stringify(
    {
      project_id:       project.project_id,
      title_jp:         project.title_jp ?? "",
      target_age:       project.target_age ?? "",
      short_target_sec: shortTargetSec,
      visual_style:     project.visual_style ?? "",
      notes:            project.notes ?? "",
      has_full_script:  hasFullScript,
      scenes:           scenesInput,
    },
    null,
    2
  );

  return buildPrompt(assets.promptTemplate, {
    INPUT_DATA:         inputData,
    HAS_FULL_SCRIPT:    String(hasFullScript),
    OUTPUT_JSON_SCHEMA: assets.aiSchema,
    OUTPUT_FIELD_GUIDE: assets.outputFieldGuide,
    OUTPUT_EXAMPLE:     assets.aiResponseExample,
  });
}
