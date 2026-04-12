/**
 * index.ts
 *
 * GitHub Actions ランタイムのエントリポイント。
 *
 * 環境変数から payload を取り出し、対象 STEP を実行する。
 *
 * 必須環境変数:
 * - STEP_ID               : 実行する STEP ID（例: "STEP_01"）
 * - PROJECT_IDS           : カンマ区切りの project_id（例: "PJT-001,PJT-002"）
 * - MAX_ITEMS             : 最大処理件数（デフォルト: 1）
 * - DRY_RUN               : "true" なら Sheets 書き込みをスキップ
 * - SPREADSHEET_ID        : 対象スプレッドシートID
 * - GOOGLE_SERVICE_ACCOUNT_JSON : サービスアカウント JSON 全体
 */

import { runStep01RightsValidation } from "./steps/step01-rights-validation.js";
import { runStep02SourceBuild } from "./steps/step02-source-build.js";
import { runStep03ScenesBuild } from "./steps/step03-scenes-build.js";
import { runStep04_05ScriptBuild } from "./steps/step04-05-script-build.js";
import { runStep06VisualBible } from "./steps/step06-visual-bible.js";
import { runStep09QaBuild } from "./steps/step09-qa-build.js";
import type { WorkflowPayload } from "./types.js";

async function main(): Promise<void> {
  const stepId = (process.env.STEP_ID ?? "").trim();
  const spreadsheetId = (process.env.SPREADSHEET_ID ?? "").trim();

  if (!spreadsheetId) {
    console.error("[ERROR] SPREADSHEET_ID is not set.");
    process.exit(1);
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.error("[ERROR] GOOGLE_SERVICE_ACCOUNT_JSON is not set.");
    process.exit(1);
  }

  // payload を環境変数から組み立てる
  const rawProjectIds = (process.env.PROJECT_IDS ?? "").trim();
  const project_ids = rawProjectIds
    ? rawProjectIds.split(",").map((id) => id.trim()).filter(Boolean)
    : [];

  const max_items = parseInt(process.env.MAX_ITEMS ?? "1", 10) || 1;
  const dry_run = (process.env.DRY_RUN ?? "false").toLowerCase() === "true";

  const payload: WorkflowPayload = { project_ids, max_items, dry_run };

  console.log("[INFO] Douwa AI Workflow entrypoint");
  console.log("[INFO] STEP_ID:", stepId);
  console.log("[INFO] PROJECT_IDS:", project_ids.join(","));
  console.log("[INFO] MAX_ITEMS:", max_items);
  console.log("[INFO] DRY_RUN:", dry_run);

  switch (stepId) {
    case "STEP_01":
      await runStep01RightsValidation(payload, spreadsheetId);
      break;

    case "STEP_02":
      await runStep02SourceBuild(payload, spreadsheetId);
      break;

    case "STEP_03":
      await runStep03ScenesBuild(payload, spreadsheetId);
      break;

    case "STEP_04_05":
      await runStep04_05ScriptBuild(payload, spreadsheetId);
      break;

    case "STEP_06":
      await runStep06VisualBible(payload, spreadsheetId);
      break;

    case "STEP_09":
      await runStep09QaBuild(payload, spreadsheetId);
      break;

    default:
      console.error(`[ERROR] Unknown or unsupported STEP_ID: "${stepId}"`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("[FATAL]", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
