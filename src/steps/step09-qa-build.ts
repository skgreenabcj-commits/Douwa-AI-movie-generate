/**
 * step09-qa-build.ts
 *
 * STEP_09 Q&A Build のオーケストレーター（v2: 6問固定・バージョン共通）。
 *
 * ─── 処理概要 ──────────────────────────────────────────────────────────────────
 *
 * 1. 00_Project から ProjectRow を取得
 * 2. video_format を検証（"full" | "short" | "short+full"）
 * 3. 02_Scenes から全 scene を取得（generation_status = "GENERATED"）
 * 4. video_format に応じてシーン選択:
 *    - "full" または "short+full" → full_use=Y シーンを使用
 *    - "short" のみ             → short_use=Y シーンを使用
 * 5. Gemini 呼び出し → 6問生成
 * 6. AI 出力を AJV でスキーマ検証（minItems=maxItems=6）
 * 7. record_id を採番（既存行は qa_no 順で再利用、新規は PJT-001-QA-001〜006）
 * 8. QaRow を組み立て 10_QA に upsert（全6行）
 * 9. 00_Project を最小更新（current_step = STEP_09_QA_BUILD）
 * 10. 100_App_Logs にログ記録
 *
 * ─── record_id 採番方針 ────────────────────────────────────────────────────────
 *
 * - 既存行（generation_status = "GENERATED"）の record_id をインデックス順で再利用
 * - AI 出力6件 > 既存行件数の場合: 超過分は通し番号で新規採番
 * - AI 出力6件 < 既存行件数の場合: 余剰の既存行は残置（DELETE 禁止）
 */

import type {
  WorkflowPayload,
  ProjectMinimalPatch,
  QaRow,
  SceneReadRow,
} from "../types.js";
import { loadRuntimeConfig } from "../lib/load-runtime-config.js";
import { readProjectsByIds } from "../lib/load-project-input.js";
import { loadScenesByProjectId } from "../lib/load-scenes.js";
import { loadQaByProjectId } from "../lib/load-qa.js";
import { loadStep09Assets } from "../lib/load-assets.js";
import { buildStep09Prompt } from "../lib/build-prompt.js";
import {
  callGemini,
  buildGeminiOptionsStep09,
  GeminiSpendingCapError,
} from "../lib/call-gemini.js";
import { validateQaAiResponse } from "../lib/validate-json.js";
import { upsertQa, markQaGenerationFailed } from "../lib/write-qa.js";
import { updateProjectMinimal } from "../lib/update-project.js";
import {
  appendAppLog,
  buildStep09SuccessLog,
  buildStep09FailureLog,
} from "../lib/write-app-log.js";
import { logInfo, logError } from "../lib/logger.js";

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function runStep09QaBuild(
  payload: WorkflowPayload,
  spreadsheetId: string
): Promise<void> {
  logInfo("[STEP_09] Q&A Build start");

  const configMap = await loadRuntimeConfig(spreadsheetId);
  const geminiOptions = buildGeminiOptionsStep09(configMap);
  const step09Assets = loadStep09Assets();

  for (const projectId of payload.project_ids) {
    logInfo(`[STEP_09] Processing project: ${projectId}`);

    let projectRecordId = "";
    let success = false;

    try {
      // ── プロジェクト取得 ──────────────────────────────────────────────────────
      const projects = await readProjectsByIds(spreadsheetId, [projectId]);
      const project = projects[0];
      if (!project) {
        const msg = `[STEP_09] project not found: ${projectId}`;
        logError(msg);
        try {
          await appendAppLog(spreadsheetId,
            buildStep09FailureLog(projectId, "", "project_not_found", msg));
        } catch (_) {}
        continue;
      }
      projectRecordId = project.record_id;
      const videoFormat = (project.video_format ?? "").trim().toLowerCase();

      // ── video_format 検証 ────────────────────────────────────────────────────
      if (!["full", "short", "short+full"].includes(videoFormat)) {
        const msg = `[STEP_09] Invalid video_format: "${videoFormat}" for project ${projectId}`;
        logError(msg);
        try {
          await appendAppLog(spreadsheetId,
            buildStep09FailureLog(projectId, projectRecordId, "invalid_video_format", msg));
        } catch (_) {}
        continue;
      }

      // ── 02_Scenes 取得 ───────────────────────────────────────────────────────
      const allScenes = await loadScenesByProjectId(spreadsheetId, projectId);
      if (allScenes.length === 0) {
        const msg = `[STEP_09] No GENERATED scenes found for project ${projectId}`;
        logError(msg);
        try {
          await appendAppLog(spreadsheetId,
            buildStep09FailureLog(projectId, projectRecordId, "no_scenes", msg));
        } catch (_) {}
        continue;
      }

      // ── シーン選択: full が含まれれば full_use=Y、short のみなら short_use=Y ──
      const scenes: SceneReadRow[] = videoFormat.includes("full")
        ? allScenes.filter((s) => s.full_use === "Y")
        : allScenes.filter((s) => s.short_use === "Y");

      if (scenes.length === 0) {
        const filterKey = videoFormat.includes("full") ? "full_use=Y" : "short_use=Y";
        const msg = `[STEP_09] No ${filterKey} scenes for project ${projectId}`;
        logError(msg);
        try {
          await appendAppLog(spreadsheetId,
            buildStep09FailureLog(projectId, projectRecordId, "no_scenes", msg));
        } catch (_) {}
        continue;
      }

      // ── 既存 QA 行の取得（再実行時の record_id 引き継ぎ用） ─────────────────
      const existingQa = await loadQaByProjectId(spreadsheetId, projectId);
      if (existingQa.length > 0) {
        logInfo(`[STEP_09] Re-run: ${existingQa.length} existing rows for ${projectId}`);
        if (existingQa.length > 6) {
          logError(`[STEP_09][WARN] Existing QA rows (${existingQa.length}) > 6. Surplus rows remain in place.`);
        }
      }

      // ── プロンプト組み立て・Gemini 呼び出し ──────────────────────────────────
      const prompt = buildStep09Prompt(step09Assets, project, scenes);
      logInfo(`[STEP_09] Calling Gemini for ${projectId} (${scenes.length} scenes)`);

      let geminiResult: Awaited<ReturnType<typeof callGemini>> | null = null;
      try {
        geminiResult = await callGemini(prompt, {
          ...geminiOptions,
          maxOutputTokens: 8192,
        });
        logInfo(`[STEP_09] Gemini responded. modelUsed=${geminiResult.modelUsed}`);
      } catch (geminiErr) {
        if (geminiErr instanceof GeminiSpendingCapError) throw geminiErr;
        const msg =
          `[STEP_09] Gemini call failed for ${projectId}: ` +
          (geminiErr instanceof Error ? geminiErr.message : String(geminiErr));
        logError(msg);
        try {
          await appendAppLog(spreadsheetId,
            buildStep09FailureLog(projectId, projectRecordId, "gemini_call_failed", msg));
        } catch (_) {}
        continue;
      }

      // ── スキーマ検証（minItems = maxItems = 6 はスキーマ側で保証） ────────────
      const validation = validateQaAiResponse(geminiResult.text, step09Assets.aiSchema, 6);
      if (!validation.success) {
        const msg = `[STEP_09] Schema validation failed for ${projectId}: ${validation.errors}`;
        logError(msg);
        try {
          await appendAppLog(spreadsheetId,
            buildStep09FailureLog(projectId, projectRecordId, "schema_validation_failed", msg));
        } catch (_) {}
        continue;
      }

      const qaAiRows = validation.items; // 必ず6件

      // ── record_id 採番 ──────────────────────────────────────────────────────
      // 既存行 index 0〜5 を再利用。超過分は通し番号で新規採番。
      const maxExistingSeq = existingQa.reduce((max, row) => {
        const m = row.record_id.match(/-QA-(\d+)$/);
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 0);

      const assigned = qaAiRows.map((ai, i) => {
        const record_id =
          existingQa[i]?.record_id ??
          `${projectId}-QA-${String(maxExistingSeq + (i - existingQa.length) + 1).padStart(3, "0")}`;
        return { ai, record_id, qa_no: i + 1 };
      });

      // ── 10_QA upsert ────────────────────────────────────────────────────────
      const now = new Date().toISOString();
      let successCount = 0;
      let failCount = 0;
      let lastRecordId = projectRecordId;

      for (const { ai, record_id, qa_no } of assigned) {
        const row: QaRow = {
          ...ai,
          project_id:        projectId,
          record_id,
          generation_status: "GENERATED",
          approval_status:   "PENDING",
          step_id:           "STEP_09_QA_BUILD",
          qa_no,
          updated_at:        now,
          updated_by:        "github_actions",
          notes:             "",
        };

        if (payload.dry_run) {
          logInfo(`[STEP_09][DRY_RUN] Would upsert: ${record_id} (${ai.qa_type}: ${ai.question.slice(0, 30)}...)`);
          successCount++;
          lastRecordId = record_id;
          continue;
        }

        try {
          await upsertQa(spreadsheetId, row);
          logInfo(`[STEP_09] Upserted: ${record_id}`);
          successCount++;
          lastRecordId = record_id;
        } catch (upsertErr) {
          const msg =
            `[STEP_09] upsertQa failed for ${record_id}: ` +
            (upsertErr instanceof Error ? upsertErr.message : String(upsertErr));
          logError(msg);
          try {
            await appendAppLog(spreadsheetId,
              buildStep09FailureLog(projectId, record_id, "upsert_failed", msg));
          } catch (_) {}
          failCount++;
        }
      }

      const summary =
        `QA complete: success=${successCount}, fail=${failCount}, ` +
        `total=${assigned.length}, project=${projectId}`;
      logInfo(`[STEP_09] ${summary}`);

      if (failCount > 0 && successCount === 0) {
        try {
          await appendAppLog(spreadsheetId,
            buildStep09FailureLog(projectId, projectRecordId, "all_upsert_failed", summary));
        } catch (_) {}
      } else {
        success = true;
        try {
          await appendAppLog(spreadsheetId,
            buildStep09SuccessLog(projectId, lastRecordId, summary));
        } catch (_) {}
      }

      // ── 00_Project 最小更新 ────────────────────────────────────────────────
      if (success && !payload.dry_run) {
        const patch: ProjectMinimalPatch = {
          current_step:    "STEP_09_QA_BUILD",
          approval_status: "PENDING",
          updated_at:      new Date().toISOString(),
          updated_by:      "github_actions",
        };
        try {
          await updateProjectMinimal(spreadsheetId, projectId, patch);
        } catch (updateErr) {
          logError(
            `[STEP_09] updateProjectMinimal failed for ${projectId}: ` +
            (updateErr instanceof Error ? updateErr.message : String(updateErr))
          );
        }
      }

      // 失敗時: 10_QA の既存行を FAILED に更新
      if (!success && !payload.dry_run) {
        try { await markQaGenerationFailed(spreadsheetId, projectId, now); } catch (_) {}
      }

    } catch (err) {
      // Spending Cap は全プロジェクト停止
      if (err instanceof GeminiSpendingCapError) throw err;
      const msg =
        `[STEP_09] Unexpected error for project ${projectId}: ` +
        (err instanceof Error ? err.message : String(err));
      logError(msg);
      try {
        await appendAppLog(spreadsheetId,
          buildStep09FailureLog(projectId, projectRecordId, "unexpected_error", msg));
      } catch (_) {}
      if (!payload.dry_run) {
        try { await markQaGenerationFailed(spreadsheetId, projectId, new Date().toISOString()); } catch (_) {}
      }
    }
  }

  logInfo("[STEP_09] Q&A Build finished.");
}
