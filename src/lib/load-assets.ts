/**
 * load-assets.ts
 *
 * リポジトリ内の prompts / schemas / examples / config ファイルを読み込む loader。
 * GitHub Actions ランタイムでは checkout 済みのファイルとして存在する。
 *
 * 読み込み対象（STEP_01）:
 * - prompts/rights_validation_prompt_v1.md
 * - prompts/copyright_policy_jp_v1.md
 * - prompts/rights_review_policy_v1.md
 * - prompts/fragments/rights_validation_output_field_guide_v1.md
 * - schemas/rights_validation_schema_ai_v1.json
 * - schemas/rights_validation_schema_full_v1.json
 * - examples/rights_validation_ai_response_example_v1.json
 * - config/fast_pass_logic_v1.md
 *
 * 読み込み対象（STEP_02）:
 * - prompts/source_build_prompt_v1.md
 * - prompts/copyright_policy_jp_v1.md
 * - prompts/difficult_terms_policy_v1.md
 * - prompts/fragments/source_build_output_field_guide_v1.md
 * - schemas/source_build_schema_ai_v1.json
 * - schemas/source_build_schema_full_v1.json
 * - examples/source_build_ai_response_example_v1.json
 *
 * 読み込み対象（STEP_03）:
 * - prompts/scene_build_prompt_v1.md
 * - prompts/scene_count_and_duration_policy_v1.md
 * - prompts/age_band_scene_guideline_v1.md
 * - prompts/fragments/scene_build_output_field_guide_v1.md
 * - schemas/scene_build_schema_ai_v1.json
 * - schemas/scene_build_schema_full_v1.json
 * - examples/scene_build_ai_response_example_v1.json
 *
 * 読み込み対象（STEP_05 Full）:
 * - prompts/script_full_prompt_v1.md
 * - prompts/fragments/script_output_field_guide_full_v1.md
 * - schemas/script_full_schema_ai_v1.json
 * - schemas/script_full_schema_full_v1.json
 * - examples/script_full_ai_response_example_v1.json
 *
 * 読み込み対象（STEP_04 Short）:
 * - prompts/script_short_prompt_v1.md
 * - prompts/fragments/script_output_field_guide_short_v1.md
 * - schemas/script_short_schema_ai_v1.json
 * - schemas/script_short_schema_full_v1.json
 * - examples/script_short_ai_response_example_v1.json
 *
 * 読み込み対象（STEP_06 Visual Bible）:
 * - prompts/visual_bible_prompt_v1.md
 * - schemas/visual_bible_schema_ai_v1.json
 * - schemas/visual_bible_schema_full_v1.json
 * - examples/visual_bible_ai_response_example_v1.json
 *
 * 読み込み対象（STEP_07 Image Prompts）:
 * - prompts/image_prompt_prompt_v1.md
 * - schemas/image_prompt_schema_ai_v1.json
 * - schemas/image_prompt_schema_full_v1.json
 *
 * 読み込み対象（STEP_08A TTS Subtitle & Edit Plan）:
 * - prompts/tts_subtitle_edit_plan_prompt_v1.md
 * - schemas/tts_subtitle_schema_ai_v1.json
 * - schemas/tts_subtitle_schema_full_v1.json
 * - schemas/edit_plan_schema_full_v1.json
 * - examples/tts_subtitle_ai_response_example_v1.json
 *
 * 読み込み対象（STEP_09 Q&A Build）:
 * - prompts/qa_prompt_v1.md
 * - schemas/qa_schema_ai_v1.json
 * - schemas/qa_schema_full_v1.json
 * - examples/qa_ai_response_example_v1.json
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// __dirname 相当（ESM 対応）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// リポジトリルート = dist/lib/../.. = プロジェクトルート
// dist/lib/load-assets.js → dist/lib → dist → repo_root
const REPO_ROOT = resolve(__dirname, "..", "..");

function repoPath(...segments: string[]): string {
  return resolve(REPO_ROOT, ...segments);
}

function readText(filePath: string): string {
  return readFileSync(filePath, "utf-8");
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface Step01Assets {
  promptTemplate: string;
  copyrightPolicy: string;
  rightsReviewPolicy: string;
  outputFieldGuide: string;
  aiSchema: string;         // JSON string
  fullSchema: string;       // JSON string
  aiResponseExample: string; // JSON string
  fastPassLogic: string;
}

// ─── STEP_02 Assets ───────────────────────────────────────────────────────────

export interface Step02Assets {
  promptTemplate: string;
  copyrightPolicy: string;
  difficultTermsPolicy: string;
  outputFieldGuide: string;
  aiSchema: string;         // JSON string
  fullSchema: string;       // JSON string
  aiResponseExample: string; // JSON string
}

/**
 * STEP_02 に必要な全ファイルを読み込んで返す。
 */
export function loadStep02Assets(): Step02Assets {
  return {
    promptTemplate: readText(
      repoPath("prompts", "source_build_prompt_v1.md")
    ),
    copyrightPolicy: readText(
      repoPath("prompts", "copyright_policy_jp_v1.md")
    ),
    difficultTermsPolicy: readText(
      repoPath("prompts", "difficult_terms_policy_v1.md")
    ),
    outputFieldGuide: readText(
      repoPath("prompts", "fragments", "source_build_output_field_guide_v1.md")
    ),
    aiSchema: readText(
      repoPath("schemas", "source_build_schema_ai_v1.json")
    ),
    fullSchema: readText(
      repoPath("schemas", "source_build_schema_full_v1.json")
    ),
    aiResponseExample: readText(
      repoPath("examples", "source_build_ai_response_example_v1.json")
    ),
  };
}

// ─── STEP_03 Assets ───────────────────────────────────────────────────────────

export interface Step03Assets {
  promptTemplate: string;
  sceneCountAndDurationPolicy: string;
  ageBandSceneGuideline: string;
  outputFieldGuide: string;
  aiSchema: string;         // JSON string
  fullSchema: string;       // JSON string
  aiResponseExample: string; // JSON string
}

/**
 * STEP_03 に必要な全ファイルを読み込んで返す。
 */
export function loadStep03Assets(): Step03Assets {
  return {
    promptTemplate: readText(
      repoPath("prompts", "scene_build_prompt_v1.md")
    ),
    sceneCountAndDurationPolicy: readText(
      repoPath("prompts", "scene_count_and_duration_policy_v1.md")
    ),
    ageBandSceneGuideline: readText(
      repoPath("prompts", "age_band_scene_guideline_v1.md")
    ),
    outputFieldGuide: readText(
      repoPath("prompts", "fragments", "scene_build_output_field_guide_v1.md")
    ),
    aiSchema: readText(
      repoPath("schemas", "scene_build_schema_ai_v1.json")
    ),
    fullSchema: readText(
      repoPath("schemas", "scene_build_schema_full_v1.json")
    ),
    aiResponseExample: readText(
      repoPath("examples", "scene_build_ai_response_example_v1.json")
    ),
  };
}

/**
 * STEP_01 に必要な全ファイルを読み込んで返す。
 */
export function loadStep01Assets(): Step01Assets {
  return {
    promptTemplate: readText(
      repoPath("prompts", "rights_validation_prompt_v1.md")
    ),
    copyrightPolicy: readText(
      repoPath("prompts", "copyright_policy_jp_v1.md")
    ),
    rightsReviewPolicy: readText(
      repoPath("prompts", "rights_review_policy_v1.md")
    ),
    outputFieldGuide: readText(
      repoPath(
        "prompts",
        "fragments",
        "rights_validation_output_field_guide_v1.md"
      )
    ),
    aiSchema: readText(
      repoPath("schemas", "rights_validation_schema_ai_v1.json")
    ),
    fullSchema: readText(
      repoPath("schemas", "rights_validation_schema_full_v1.json")
    ),
    aiResponseExample: readText(
      repoPath("examples", "rights_validation_ai_response_example_v1.json")
    ),
    fastPassLogic: readText(repoPath("config", "fast_pass_logic_v1.md")),
  };
}

// ─── STEP_05 Assets (Full Script) ─────────────────────────────────────────────

export interface Step05Assets {
  promptTemplate: string;
  outputFieldGuide: string;
  aiSchema: string;          // JSON string
  fullSchema: string;        // JSON string
  aiResponseExample: string; // JSON string
}

/**
 * STEP_05 に必要な全ファイルを読み込んで返す。
 */
export function loadStep05Assets(): Step05Assets {
  return {
    promptTemplate: readText(
      repoPath("prompts", "script_full_prompt_v1.md")
    ),
    outputFieldGuide: readText(
      repoPath("prompts", "fragments", "script_output_field_guide_full_v1.md")
    ),
    aiSchema: readText(
      repoPath("schemas", "script_full_schema_ai_v1.json")
    ),
    fullSchema: readText(
      repoPath("schemas", "script_full_schema_full_v1.json")
    ),
    aiResponseExample: readText(
      repoPath("examples", "script_full_ai_response_example_v1.json")
    ),
  };
}

// ─── STEP_04 Assets (Short Script) ────────────────────────────────────────────

export interface Step04Assets {
  promptTemplate: string;
  outputFieldGuide: string;
  aiSchema: string;          // JSON string
  fullSchema: string;        // JSON string
  aiResponseExample: string; // JSON string
}

// ─── STEP_06 Assets (Visual Bible) ───────────────────────────────────────────

export interface Step06Assets {
  promptTemplate:    string;  // visual_bible_prompt_v1.md
  aiSchema:          string;  // visual_bible_schema_ai_v1.json（JSON string）
  fullSchema:        string;  // visual_bible_schema_full_v1.json（JSON string）
  aiResponseExample: string;  // visual_bible_ai_response_example_v1.json（JSON string）
}

/**
 * STEP_06 に必要な全ファイルを読み込んで返す。
 */
export function loadStep06Assets(): Step06Assets {
  return {
    promptTemplate: readText(
      repoPath("prompts", "visual_bible_prompt_v2.md")
    ),
    aiSchema: readText(
      repoPath("schemas", "visual_bible_schema_ai_v1.json")
    ),
    fullSchema: readText(
      repoPath("schemas", "visual_bible_schema_full_v1.json")
    ),
    aiResponseExample: readText(
      repoPath("examples", "visual_bible_ai_response_example_v1.json")
    ),
  };
}

// ─── STEP_07 Assets (Image Prompts) ──────────────────────────────────────────

export interface Step07Assets {
  promptTemplate: string;  // image_prompt_prompt_v2.md
  aiSchema:       string;  // image_prompt_schema_ai_v1.json（JSON string）
  fullSchema:     string;  // image_prompt_schema_full_v1.json（JSON string）
}

/**
 * STEP_07 に必要な全ファイルを読み込んで返す。
 */
export function loadStep07Assets(): Step07Assets {
  return {
    promptTemplate: readText(
      repoPath("prompts", "image_prompt_prompt_v2.md")
    ),
    aiSchema: readText(
      repoPath("schemas", "image_prompt_schema_ai_v1.json")
    ),
    fullSchema: readText(
      repoPath("schemas", "image_prompt_schema_full_v1.json")
    ),
  };
}

// ─── STEP_09 Assets (Q&A Build) ──────────────────────────────────────────────

export interface Step09Assets {
  promptTemplate:    string;  // qa_prompt_v2.md
  aiSchema:          string;  // qa_schema_ai_v2.json（JSON string）
  fullSchema:        string;  // qa_schema_full_v2.json（JSON string）
  aiResponseExample: string;  // qa_ai_response_example_v2.json（JSON string）
}

/**
 * STEP_09 に必要な全ファイルを読み込んで返す。
 */
export function loadStep09Assets(): Step09Assets {
  return {
    promptTemplate: readText(
      repoPath("prompts", "qa_prompt_v2.md")
    ),
    aiSchema: readText(
      repoPath("schemas", "qa_schema_ai_v2.json")
    ),
    fullSchema: readText(
      repoPath("schemas", "qa_schema_full_v2.json")
    ),
    aiResponseExample: readText(
      repoPath("examples", "qa_ai_response_example_v2.json")
    ),
  };
}

// ─── STEP_08A Assets (TTS Subtitle & Edit Plan) ──────────────────────────────

export interface Step08aAssets {
  promptTemplate:    string;  // tts_subtitle_edit_plan_prompt_v2.md
  aiSchema:          string;  // tts_subtitle_schema_ai_v1.json（JSON string）
  ttsFullSchema:     string;  // tts_subtitle_schema_full_v1.json（JSON string）
  editPlanFullSchema: string; // edit_plan_schema_full_v1.json（JSON string）
  aiResponseExample: string;  // tts_subtitle_ai_response_example_v1.json（JSON string）
  readingDict:       string;  // config/tts_reading_dict_v1.md
}

/**
 * STEP_08A に必要な全ファイルを読み込んで返す。
 */
export function loadStep08aAssets(): Step08aAssets {
  return {
    promptTemplate: readText(
      repoPath("prompts", "tts_subtitle_edit_plan_prompt_v2.md")
    ),
    aiSchema: readText(
      repoPath("schemas", "tts_subtitle_schema_ai_v1.json")
    ),
    ttsFullSchema: readText(
      repoPath("schemas", "tts_subtitle_schema_full_v1.json")
    ),
    editPlanFullSchema: readText(
      repoPath("schemas", "edit_plan_schema_full_v1.json")
    ),
    aiResponseExample: readText(
      repoPath("examples", "tts_subtitle_ai_response_example_v1.json")
    ),
    readingDict: readText(
      repoPath("config", "tts_reading_dict_v1.md")
    ),
  };
}

/**
 * STEP_04 に必要な全ファイルを読み込んで返す。
 */
export function loadStep04Assets(): Step04Assets {
  return {
    promptTemplate: readText(
      repoPath("prompts", "script_short_prompt_v1.md")
    ),
    outputFieldGuide: readText(
      repoPath("prompts", "fragments", "script_output_field_guide_short_v1.md")
    ),
    aiSchema: readText(
      repoPath("schemas", "script_short_schema_ai_v1.json")
    ),
    fullSchema: readText(
      repoPath("schemas", "script_short_schema_full_v1.json")
    ),
    aiResponseExample: readText(
      repoPath("examples", "script_short_ai_response_example_v1.json")
    ),
  };
}
