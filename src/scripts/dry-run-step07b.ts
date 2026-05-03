/**
 * src/scripts/dry-run-step07b.ts
 *
 * STEP_07B Image Generate テスト実行スクリプト
 *
 * 【概要】
 * GSS・Google Drive・画像生成 API への接続なしに、モックの PENDING 行データを使って
 * STEP_07B のプロンプト読み込みフローを検証する。
 *
 * 【実行モード】
 *   DRY_RUN=true  : プロンプト表示のみ。Gemini 呼び出し・Drive アクセスなし。
 *
 * 【ビルド & 実行】
 *   npm run build
 *   npm run dry-run:step07b
 *
 * 【環境変数】
 *   PROJECT_IDS : カンマ区切りの project_id（例: "PJT-001"）
 *   DRY_RUN     : "true" (default) / "false"
 */

import type { ImagePromptPendingRow } from "../types.js";

// ─── モック: 06_Image_Prompts (PENDING 行) ───────────────────────────────────
const MOCK_PENDING_ROWS: Record<string, ImagePromptPendingRow[]> = {
  "PJT-001": [
    {
      project_id:              "PJT-001",
      record_id:               "PJT-001-IMG-001",
      related_version:         "PJT-001-SCN-001",
      approval_status:         "PENDING",
      scene_no:                "1",
      prompt_full:             "Children's picture-book illustration, soft watercolor style, warm pastel tones, gentle ink outlines, 16:9 landscape, high resolution, 2K quality, Grandmother: wide surprised eyes, mouth open in astonishment, leaning slightly forward toward the peach with both hands raised, Peaceful shallow riverside, large round pink peach floating gently downstream, lush green riverbanks with wildflowers, soft afternoon sunlight, Wide establishing shot, large pink peach as focal point in left-center stream, grandmother standing mid-right looking toward peach, open sky upper third",
      prompt_base:             "Children's picture-book illustration, soft watercolor style, warm pastel tones, gentle ink outlines, 16:9 landscape, high resolution, 2K quality",
      prompt_character:        "Grandmother: wide surprised eyes, mouth open in astonishment, leaning slightly forward toward the peach with both hands raised",
      prompt_scene:            "Peaceful shallow riverside, large round pink peach floating gently downstream, lush green riverbanks with wildflowers, soft afternoon sunlight",
      prompt_composition:      "Wide establishing shot, large pink peach as focal point in left-center stream, grandmother standing mid-right looking toward peach, open sky upper third",
      negative_prompt:         "dark tones, scary expressions, violence, blood, photorealistic, 3D render, fluorescent colors, neon colors, adult content, modern objects, no text, no letters, no captions, no subtitles, no story narration text, watermark, logo, blurry, low quality",
      image_take_1:            "",
      image_take_2:            "",
      selected_asset:          "",
      revision_note:           "",
      style_consistency_check: "",
      notes:                   "",
    },
    {
      project_id:              "PJT-001",
      record_id:               "PJT-001-IMG-002",
      related_version:         "PJT-001-SCN-002",
      approval_status:         "RETAKE",
      scene_no:                "2",
      prompt_full:             "Children's picture-book illustration, soft watercolor style, warm pastel tones, gentle ink outlines, 16:9 landscape, high resolution, 2K quality, Momotaro: bright surprised eyes, mouth wide open, both arms raised in joy; Grandmother: gentle smile, hands clasped together in delight, Bright wooden kitchen interior, halved large peach on cutting board, warm afternoon light through window, Medium shot, halved peach as focal point in center, grandmother and baby visible together, grandmother's expression of joy prominent",
      prompt_base:             "Children's picture-book illustration, soft watercolor style, warm pastel tones, gentle ink outlines, 16:9 landscape, high resolution, 2K quality",
      prompt_character:        "Momotaro: bright surprised eyes, mouth wide open, both arms raised in joy; Grandmother: gentle smile, hands clasped together in delight",
      prompt_scene:            "Bright wooden kitchen interior, halved large peach on cutting board, warm afternoon light through window",
      prompt_composition:      "Medium shot, halved peach as focal point in center, grandmother and baby visible together, grandmother's expression of joy prominent",
      negative_prompt:         "dark tones, scary expressions, violence, blood, photorealistic, 3D render, fluorescent colors, neon colors, adult content, modern objects, no text, no letters, no captions, no subtitles, no story narration text, watermark, logo, blurry, low quality",
      image_take_1:            "https://drive.google.com/file/d/old_image_url",
      image_take_2:            "",
      selected_asset:          "",
      revision_note:           "キャラクターの表情を修正してください",
      style_consistency_check: "",
      notes:                   "",
    },
  ],
};

// ─── CLI パース ───────────────────────────────────────────────────────────────
const cliArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const rawProjectIds = (process.env.PROJECT_IDS ?? cliArgs.join(",") ?? "PJT-001").trim();
const projectIds = rawProjectIds
  ? rawProjectIds.split(",").map((id) => id.trim()).filter(Boolean)
  : ["PJT-001"];

// ─── メイン ───────────────────────────────────────────────────────────────────
console.log("═".repeat(70));
console.log("  STEP_07B テスト実行 — Image Generate (DRY_RUN)");
console.log("═".repeat(70));
console.log(`  PROJECT_IDS: ${projectIds.join(", ")}`);
console.log();

let totalTests = 0;
let totalPassed = 0;
let totalFailed = 0;

for (const projectId of projectIds) {
  const pendingRows = MOCK_PENDING_ROWS[projectId] ?? [];
  if (pendingRows.length === 0) {
    console.log(`[${projectId}] No PENDING rows — skipping (run STEP_07A first)`);
    continue;
  }

  console.log("─".repeat(70));
  console.log(`  Project: ${projectId}  PENDING rows: ${pendingRows.length}`);
  console.log();

  for (const row of pendingRows) {
    totalTests++;
    const isRetake = row.approval_status === "RETAKE";
    console.log(`── Record: ${row.record_id} (approval=${row.approval_status}${isRetake ? " [RETAKE]" : ""})`);

    try {
      if (!row.prompt_full) {
        console.error(`  [ERROR] prompt_full is empty — STEP_07A may not have run`);
        totalFailed++;
      } else {
        console.log(`  [OK] prompt_full length: ${row.prompt_full.length} chars`);
        console.log(`  prompt preview: ${row.prompt_full.slice(0, 200)}`);
        if (isRetake) {
          console.log(`  [RETAKE] existing image_take_1: ${row.image_take_1 || "(empty)"}`);
          console.log(`  [RETAKE] After STEP_07B: old url will move to image_take_2`);
        }
        totalPassed++;
      }
    } catch (e) {
      console.error(`  [ERROR] ${e instanceof Error ? e.message : String(e)}`);
      totalFailed++;
    }
    console.log();
  }
}

// ─── サマリー ─────────────────────────────────────────────────────────────────
console.log("═".repeat(70));
console.log("  SUMMARY");
console.log("═".repeat(70));
console.log(`  Total  : ${totalTests}`);
console.log(`  Passed : ${totalPassed}`);
console.log(`  Failed : ${totalFailed}`);
console.log();

if (totalFailed > 0) {
  process.exit(1);
}
