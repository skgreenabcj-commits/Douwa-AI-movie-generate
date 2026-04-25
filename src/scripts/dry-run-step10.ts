/**
 * src/scripts/dry-run-step10.ts
 *
 * STEP_10 Video Build テスト実行スクリプト
 *
 * 【概要】
 * DRY_RUN=true（デフォルト）の場合、GSS 読み込みは実際に行うが、
 * ffmpeg 処理・Drive アップロード・GSS 書き込みはすべてスキップする。
 * アセット取得の検証（09_Edit_Plan / 08_TTS_Subtitles に必要なデータが揃っているか）と
 * パイプラインのフロー確認に使用する。
 *
 * 【ビルド & 実行】
 *   npm run build
 *   npm run dry-run:step10
 *
 * 【環境変数】
 *   PROJECT_IDS  : カンマ区切りの project_id（例: "PJT-001"）
 *   DRY_RUN      : "true" (default) / "false"
 *   VIDEO_FORMAT : "full" / "short" / "short+full"（省略時はプロジェクト設定を使用）
 *   SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_JSON: GSS 接続に必要
 *   DRIVE_IMAGE_FOLDER_ID: Drive フォルダ ID（DRY_RUN=false のとき必要）
 */

import { runStep10VideoBuild } from "../steps/step10-video-build.js";
import type { WorkflowPayload } from "../types.js";

// ─── CLI パース ───────────────────────────────────────────────────────────────
const rawProjectIds = (process.env.PROJECT_IDS ?? "PJT-001").trim();
const projectIds = rawProjectIds.split(",").map((id) => id.trim()).filter(Boolean);
const isDryRun   = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
const maxItems   = parseInt(process.env.MAX_ITEMS ?? "99", 10);
const spreadsheetId = (process.env.SPREADSHEET_ID ?? "").trim();

console.log("═".repeat(70));
console.log("  STEP_10 テスト実行 — Video Build");
console.log("═".repeat(70));
console.log(`  DRY_RUN     : ${isDryRun}`);
console.log(`  PROJECT_IDS : ${projectIds.join(", ")}`);
console.log(`  MAX_ITEMS   : ${maxItems}`);
console.log(`  SPREADSHEET : ${spreadsheetId ? spreadsheetId.slice(0, 16) + "..." : "(not set)"}`);
console.log();

if (!spreadsheetId) {
  console.error("[ERROR] SPREADSHEET_ID is required. Set it via env var.");
  process.exit(1);
}
if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  console.error("[ERROR] GOOGLE_SERVICE_ACCOUNT_JSON is required.");
  process.exit(1);
}

const payload: WorkflowPayload = {
  project_ids: projectIds,
  max_items:   maxItems,
  dry_run:     isDryRun,
};

try {
  const results = await runStep10VideoBuild(payload, spreadsheetId);

  console.log();
  console.log("═".repeat(70));
  console.log("  SUMMARY");
  console.log("═".repeat(70));

  let totalSuccess = 0;
  let totalFail    = 0;

  for (const r of results) {
    console.log(`  [${r.projectId}] success=${r.successCount}, fail=${r.failCount}`);
    totalSuccess += r.successCount;
    totalFail    += r.failCount;
  }

  console.log(`  Total: success=${totalSuccess}, fail=${totalFail}`);
  console.log();

  if (totalFail > 0) process.exit(1);
} catch (err) {
  console.error("[FATAL]", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
