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
