/**
 * step06-visual-bible.ts
 *
 * STEP_06 Visual Bible Build のオーケストレーター。
 *
 * ─── 処理概要 ──────────────────────────────────────────────────────────────────
 *
 * 1. 00_Project から ProjectRow を取得
 * 2. video_format を検証（"full" | "short" | "short+full"）
 * 3. 02_Scenes から全 scene を取得
 * 4. video_format に応じて対象 scene をフィルタ:
 *    - "full"       → full_use = "Y"
 *    - "short"      → short_use = "Y"
 *    - "short+full" → full_use = "Y"（包括的）
 * 5. Visual Bible プロンプトを組み立て Gemini に送信
 * 6. AI 出力を AJV でスキーマ検証
 * 7. record_id を採番（既存行は再利用、新規は PJT-001-VB-001 形式）
 * 8. VisualBibleRow を組み立て 05_Visual_Bible に upsert
 * 9. 00_Project を最小更新（current_step = STEP_06_VISUAL_BIBLE）
 * 10. 100_App_Logs にログ記録
 *
 * ─── record_id 採番方針 ────────────────────────────────────────────────────────
 *
 * - 既存行（generation_status = "GENERATED"）の record_id をインデックス順で再利用
 * - AI 出力件数 > 既存行件数の場合: 超過分は新規採番（{projectId}-VB-{i+1:03d}）
 * - AI 出力件数 < 既存行件数の場合: 余剰の既存行は残置（DELETE 禁止）
 *
 * ─── 再実行時の挙動 ────────────────────────────────────────────────────────────
 *
 * 再実行時に AI 出力件数が減少した場合、余剰の既存行は残置する（手動管理）。
 * 余剰行の generation_status は "GENERATED" のまま残る。
 */

import type {
  WorkflowPayload,
  ProjectMinimalPatch,
  VisualBibleAiRow,
  VisualBibleRow,
  VisualBibleReadRow,
  SceneReadRow,
} from "../types.js";
import { loadRuntimeConfig } from "../lib/load-runtime-config.js";
import { readProjectsByIds } from "../lib/load-project-input.js";
import { loadScenesByProjectId } from "../lib/load-scenes.js";
import { loadVisualBibleByProjectId } from "../lib/load-visual-bible.js";
import { loadStep06Assets } from "../lib/load-assets.js";
import { buildStep06Prompt } from "../lib/build-prompt.js";
import {
  callGemini,
  buildGeminiOptionsStep06,
  GeminiSpendingCapError,
} from "../lib/call-gemini.js";
import { validateVisualBibleAiResponse } from "../lib/validate-json.js";
import { upsertVisualBible } from "../lib/write-visual-bible.js";
import { updateProjectMinimal } from "../lib/update-project.js";
import {
  appendAppLog,
  buildStep06SuccessLog,
  buildStep06FailureLog,
} from "../lib/write-app-log.js";
import { logInfo, logError } from "../lib/logger.js";

// ─── record_id 採番 ───────────────────────────────────────────────────────────

function assignVisualBibleRecordIds(
  projectId: string,
  aiRows: VisualBibleAiRow[],
  existingRows: VisualBibleReadRow[]
): Array<{ ai: VisualBibleAiRow; record_id: string }> {
  return aiRows.map((ai, i) => {
    // 既存行が存在する場合は既存 record_id を再利用（インデックス順で突合）
    const record_id =
      existingRows[i]?.record_id ??
      `${projectId}-VB-${String(i + 1).padStart(3, "0")}`;
    return { ai, record_id };
  });
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function runStep06VisualBible(
  payload: WorkflowPayload,
  spreadsheetId: string
): Promise<void> {
  logInfo("[STEP_06] Visual Bible Build start");

  const configMap = await loadRuntimeConfig(spreadsheetId);
  const geminiOptions = buildGeminiOptionsStep06(configMap);
  const step06Assets = loadStep06Assets();

  for (const projectId of payload.project_ids) {
    logInfo(`[STEP_06] Processing project: ${projectId}`);

    // ── プロジェクト取得 ──────────────────────────────────────────────────────
    let projectRecordId = "";
    let videoFormat = "";

    try {
      const projects = await readProjectsByIds(spreadsheetId, [projectId]);
      const project = projects[0];
      if (!project) {
        const msg = `[STEP_06] project not found: ${projectId}`;
        logError(msg);
        try {
          await appendAppLog(
            spreadsheetId,
            buildStep06FailureLog(projectId, "", "project_not_found", msg)
          );
        } catch (_) {}
        continue;
      }
      projectRecordId = project.record_id;
      videoFormat = (project.video_format ?? "").trim().toLowerCase();

      // ── video_format 検証 ────────────────────────────────────────────────────
      if (!["full", "short", "short+full"].includes(videoFormat)) {
        const msg = `[STEP_06] Invalid video_format: "${videoFormat}" for project ${projectId}`;
        logError(msg);
        try {
          await appendAppLog(
            spreadsheetId,
            buildStep06FailureLog(projectId, projectRecordId, "invalid_video_format", msg)
          );
        } catch (_) {}
        continue;
      }

      // ── 02_Scenes 取得 ───────────────────────────────────────────────────────
      const allScenes = await loadScenesByProjectId(spreadsheetId, projectId);
      if (allScenes.length === 0) {
        const msg = `[STEP_06] No GENERATED scenes found for project ${projectId}`;
        logError(msg);
        try {
          await appendAppLog(
            spreadsheetId,
            buildStep06FailureLog(projectId, projectRecordId, "no_scenes", msg)
          );
        } catch (_) {}
        continue;
      }

      // ── video_format に応じて scene をフィルタ ───────────────────────────────
      let targetScenes: SceneReadRow[];
      if (videoFormat === "full") {
        targetScenes = allScenes.filter((s) => s.full_use === "Y");
      } else if (videoFormat === "short") {
        targetScenes = allScenes.filter((s) => s.short_use === "Y");
      } else {
        // "short+full" → full_use=Y（包括的）
        targetScenes = allScenes.filter((s) => s.full_use === "Y");
      }

      if (targetScenes.length === 0) {
        const msg = `[STEP_06] No target scenes after video_format filter (format=${videoFormat}) for project ${projectId}`;
        logError(msg);
        try {
          await appendAppLog(
            spreadsheetId,
            buildStep06FailureLog(projectId, projectRecordId, "no_target_scenes", msg)
          );
        } catch (_) {}
        continue;
      }

      // ── Gemini 呼び出し ──────────────────────────────────────────────────────
      const prompt = buildStep06Prompt(step06Assets, project, targetScenes);

      logInfo(`[STEP_06] Calling Gemini for project ${projectId} (${targetScenes.length} scenes)`);
      const geminiResult = await callGemini(prompt, {
        ...geminiOptions,
        maxOutputTokens: 32768,
      });
      logInfo(`[STEP_06] Gemini responded. modelUsed=${geminiResult.modelUsed}`);

      // ── スキーマ検証 ─────────────────────────────────────────────────────────
      const validation = validateVisualBibleAiResponse(
        geminiResult.text,
        step06Assets.aiSchema
      );
      if (!validation.success) {
        const msg = `[STEP_06] Schema validation failed for project ${projectId}: ${validation.errors}`;
        logError(msg);
        try {
          await appendAppLog(
            spreadsheetId,
            buildStep06FailureLog(projectId, projectRecordId, "schema_validation_failure", msg)
          );
        } catch (_) {}
        continue;
      }

      // ── record_id 採番 ────────────────────────────────────────────────────────
      const existingRows = await loadVisualBibleByProjectId(spreadsheetId, projectId);
      if (existingRows.length > 0) {
        logInfo(
          `[STEP_06] Re-run detected: ${existingRows.length} existing rows found for project ${projectId}`
        );
        if (existingRows.length > validation.items.length) {
          logError(
            `[STEP_06][WARN] AI output count (${validation.items.length}) < existing rows (${existingRows.length}). ` +
            `Surplus rows will remain in place (manual management required).`
          );
        }
      }

      const assigned = assignVisualBibleRecordIds(
        projectId,
        validation.items,
        existingRows
      );

      // ── 05_Visual_Bible upsert ───────────────────────────────────────────────
      const now = new Date().toISOString();
      let successCount = 0;
      let failCount = 0;

      for (const { ai, record_id } of assigned) {
        const row: VisualBibleRow = {
          ...ai,
          project_id:        projectId,
          record_id,
          generation_status: "GENERATED",
          approval_status:   "PENDING",
          step_id:           "STEP_06_VISUAL_BIBLE",
          updated_at:        now,
          updated_by:        "github_actions",
          notes:             "",
        };

        if (payload.dry_run) {
          logInfo(`[STEP_06][DRY_RUN] Would upsert: ${record_id} (${ai.category}: ${ai.key_name})`);
          successCount++;
          continue;
        }

        try {
          await upsertVisualBible(spreadsheetId, row);
          logInfo(`[STEP_06] Upserted: ${record_id} (${ai.category}: ${ai.key_name})`);
          successCount++;
        } catch (upsertErr) {
          const msg =
            `[STEP_06] upsertVisualBible failed for ${record_id}: ` +
            (upsertErr instanceof Error ? upsertErr.message : String(upsertErr));
          logError(msg);
          try {
            await appendAppLog(
              spreadsheetId,
              buildStep06FailureLog(projectId, record_id, "upsert_failure", msg)
            );
          } catch (_) {}
          failCount++;
        }
      }

      // ── 00_Project 最小更新 ──────────────────────────────────────────────────
      if (successCount > 0 && !payload.dry_run) {
        const patch: ProjectMinimalPatch = {
          current_step:    "STEP_06_VISUAL_BIBLE",
          approval_status: "PENDING",
          updated_at:      now,
          updated_by:      "github_actions",
        };
        try {
          await updateProjectMinimal(spreadsheetId, projectId, patch);
        } catch (updateErr) {
          logError(
            `[STEP_06] updateProjectMinimal failed for ${projectId}: ` +
            (updateErr instanceof Error ? updateErr.message : String(updateErr))
          );
        }
      }

      // ── 完了ログ ──────────────────────────────────────────────────────────────
      const summaryMsg =
        `Visual Bible Build complete: success=${successCount}, fail=${failCount}, ` +
        `total=${assigned.length}, project=${projectId}`;
      logInfo(`[STEP_06] ${summaryMsg}`);

      try {
        const firstRecordId = assigned[0]?.record_id || projectRecordId;
        if (failCount > 0 && successCount === 0) {
          await appendAppLog(
            spreadsheetId,
            buildStep06FailureLog(projectId, firstRecordId, "all_upsert_failed", summaryMsg)
          );
        } else {
          await appendAppLog(
            spreadsheetId,
            buildStep06SuccessLog(projectId, firstRecordId, summaryMsg)
          );
        }
      } catch (_) {}
    } catch (err) {
      // Spending Cap は全プロジェクト停止
      if (err instanceof GeminiSpendingCapError) {
        throw err;
      }
      const msg =
        `[STEP_06] Unexpected error for project ${projectId}: ` +
        (err instanceof Error ? err.message : String(err));
      logError(msg);
      try {
        await appendAppLog(
          spreadsheetId,
          buildStep06FailureLog(projectId, projectRecordId, "unexpected_error", msg)
        );
      } catch (_) {}
    }
  }

  logInfo("[STEP_06] Visual Bible Build finished.");
}
