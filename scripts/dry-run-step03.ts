/**
 * scripts/dry-run-step03.ts
 *
 * STEP_03 dry-run ローカル実行スクリプト。
 *
 * GSS（Google Sheets）への接続なしに、
 * ローカルのリポジトリ assets + モック project/source データを使って
 * STEP_03 用プロンプトをアセンブルし、コンソールに全文出力する。
 *
 * 使用方法:
 *   npx tsx scripts/dry-run-step03.ts [project_id]
 *   npx tsx scripts/dry-run-step03.ts PJT-001
 *
 * 出力:
 *   - 実行パラメータサマリー
 *   - アセンブルされた完全プロンプト全文
 *   - プロンプト文字数
 */

import { loadStep03Assets } from "../src/lib/load-assets.js";
import { buildStep03Prompt } from "../src/lib/build-prompt.js";
import type { ProjectRow, SourceReadRow } from "../src/types.js";

// ─── CLI 引数 ─────────────────────────────────────────────────────────────────
const projectId = process.argv[2]?.trim() ?? "PJT-001";

// ─── scene_max_sec デフォルト値（94_Runtime_Config 未参照のためコードに持つ）───
const DEFAULT_SCENE_MAX_SEC: Record<string, number> = {
  "2-3": 15,
  "4-6": 25,
  "6-8": 40,
};
const DEFAULT_SCENE_MAX_SEC_FALLBACK = 25;

// ─── モック: 00_Project 行（PJT-001 = 桃太郎）────────────────────────────────
// 実際の GSS の 00_Project シートを模したデータ。
// target_age: "4-6", full_target_sec: "480", short_target_sec: "240"
const mockProject: ProjectRow = {
  project_id:       projectId,
  record_id:        "PJT-001",
  project_status:   "ACTIVE",
  title_jp:         "桃太郎",
  title_en:         "Momotaro",
  source_title:     "桃太郎（青空文庫）",
  source_url:       "https://www.aozora.gr.jp/cards/001044/files/4782_14903.html",
  target_age:       "4-6",
  full_target_sec:  "480",
  short_target_sec: "240",
  visual_style:     "やわらかい水彩絵本風、明るい色調",
  approval_status:  "PENDING",
  current_step:     "STEP_02_SOURCE_BUILD",
  created_at:       "2026-04-04T00:00:00.000Z",
  updated_at:       "2026-04-04T00:00:00.000Z",
  updated_by:       "dry_run",
  notes:            "",
};

// ─── モック: 01_Source 行（桃太郎、APPROVED）─────────────────────────────────
// 実際の GSS の 01_Source シートを模したデータ。
// SourceReadRow の定義フィールドのみ設定する。
const mockSource: SourceReadRow = {
  project_id:       projectId,
  record_id:        "PJT-001-SRC-001",
  approval_status:  "APPROVED",
  language_style:   "4〜6歳向け。短文・ひらがな中心。オノマトペを積極活用。",
  adaptation_policy:
    "現代語訳でやさしく語り直す。" +
    "「どんぶらこ」などオノマトペを残す。" +
    "暴力描写は最小限にし、協力と勇気のテーマを前面に出す。" +
    "仲間（犬・猿・きじ）それぞれの個性を活かした場面を設ける。" +
    "結末は全員が笑顔で帰るハッピーエンドにする。",
  difficult_terms:  "どんぶらこ、家来、退治、覚悟、宝物、鬼ヶ島",
  credit_text:      "原作: 楠山正雄 編（青空文庫）",
  base_text_notes:  "青空文庫版を底本とする。楠山正雄の編集版。",
};

// ─── メイン処理 ───────────────────────────────────────────────────────────────

function main(): void {
  console.log("=".repeat(80));
  console.log("  STEP_03 DRY-RUN プロンプトプレビュー");
  console.log("=".repeat(80));
  console.log();

  // ── 1. アセットを読み込む ───────────────────────────────────────────────
  const assets = loadStep03Assets();

  // ── 2. scene_max_sec / required_scene_count_base を算出 ────────────────
  const targetAge = mockProject.target_age ?? "4-6";
  const fullTargetSec = parseInt(mockProject.full_target_sec ?? "480", 10);
  const shortTargetSec = parseInt(mockProject.short_target_sec ?? "240", 10);

  const sceneMaxSec =
    DEFAULT_SCENE_MAX_SEC[targetAge] ?? DEFAULT_SCENE_MAX_SEC_FALLBACK;

  const requiredSceneCountBase = Math.ceil(fullTargetSec / sceneMaxSec);
  const allowedMin = Math.floor(requiredSceneCountBase * 0.85);
  const allowedMax = Math.ceil(requiredSceneCountBase * 1.15);

  // ── 3. パラメータサマリーを出力 ────────────────────────────────────────
  console.log("【実行パラメータ】");
  console.log(`  project_id               : ${mockProject.project_id}`);
  console.log(`  title_jp                 : ${mockProject.title_jp}`);
  console.log(`  target_age               : ${targetAge}`);
  console.log(`  full_target_sec          : ${fullTargetSec}s`);
  console.log(`  short_target_sec         : ${shortTargetSec}s`);
  console.log(`  visual_style             : ${mockProject.visual_style}`);
  console.log(`  01_Source.approval_status: ${mockSource.approval_status}`);
  console.log(`  adaptation_policy        : ${mockSource.adaptation_policy}`);
  console.log(`  language_style           : ${mockSource.language_style}`);
  console.log(`  difficult_terms          : ${mockSource.difficult_terms}`);
  console.log();
  console.log("【scene 設計パラメータ】");
  console.log(`  scene_max_sec            : ${sceneMaxSec}s (target_age="${targetAge}")`);
  console.log(`  required_scene_count_base: ${requiredSceneCountBase}`);
  console.log(`  allowed range            : ${allowedMin} 〜 ${allowedMax} scenes (±15%)`);
  console.log();

  // ── 4. プロンプトアセンブル ───────────────────────────────────────────
  const prompt = buildStep03Prompt(
    assets,
    mockProject,
    mockSource,
    sceneMaxSec,
    requiredSceneCountBase
  );

  // ── 5. プロンプト全文出力 ─────────────────────────────────────────────
  console.log("=".repeat(80));
  console.log("  ASSEMBLED PROMPT（全文）");
  console.log("=".repeat(80));
  console.log();
  console.log(prompt);
  console.log();
  console.log("=".repeat(80));
  console.log(`  Total prompt length: ${prompt.length.toLocaleString()} characters`);
  console.log(`  [dry_run] Gemini 呼び出しはスキップされました。GSS への書き込みはありません。`);
  console.log("=".repeat(80));
}

main();
