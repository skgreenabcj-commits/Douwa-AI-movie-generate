/**
 * step01-rights-validation.ts
 *
 * STEP_01 Rights Validation のオーケストレーター。
 *
 * 処理フロー（指示書 §3 / docs/04_step01_detailed_sequence.md 準拠）:
 * 1. 94_Runtime_Config を読む
 * 2. 00_Project から対象案件を読む
 * 3. title_jp, source_url を抽出
 * 4. prompt / policy / schema / example / fast-pass logic を repo から読む
 * 5. STEP_01 prompt をアセンブル
 * 6. Gemini に rights validation JSON を要求（primary → secondary fallback）
 * 7. AI 応答を parse / validate
 * 8. normalize（full row に変換）
 * 9. fast-pass を評価・適用
 * 10. 00_Rights_Validation を upsert
 * 11. 00_Project を最小更新
 * 12. 100_App_Logs に成功/失敗ログを書く
 *
 * 制約:
 * - 初期実装: 単件実行のみ（複数 project_ids は逐次処理）
 * - dry_run=true の場合は Sheets への書き込みをスキップし、ログ出力のみ
 */

import type { WorkflowPayload, ProjectMinimalPatch } from "../types.js";
import { loadRuntimeConfig, getConfigValue } from "../lib/load-runtime-config.js";
import { readProjectsByIds } from "../lib/load-project-input.js";
import { loadStep01Assets } from "../lib/load-assets.js";
import { buildStep01Prompt } from "../lib/build-prompt.js";
import { callGemini, buildGeminiOptions } from "../lib/call-gemini.js";
import { validateAiResponse } from "../lib/validate-json.js";
import { normalizeAiRow } from "../lib/normalize-ai-row.js";
import { applyFastPass } from "../lib/apply-fast-pass.js";
import { upsertRightsValidation, markRightsValidationGenerationFailed } from "../lib/write-rights-validation.js";
import { updateProjectMinimal } from "../lib/update-project.js";
import {
  appendAppLog,
  buildSuccessLog,
  buildFailureLog,
} from "../lib/write-app-log.js";
import { logInfo, logError } from "../lib/logger.js";

export async function runStep01RightsValidation(
  payload: WorkflowPayload,
  spreadsheetId: string
): Promise<void> {
  logInfo("STEP_01 Rights Validation started", {
    project_ids: payload.project_ids,
    max_items: payload.max_items,
    dry_run: payload.dry_run,
  });

  // ─── 1. Runtime Config ──────────────────────────────────────────────────
  const configMap = await loadRuntimeConfig(spreadsheetId);
  logInfo("94_Runtime_Config loaded", { size: configMap.size });

  const geminiOptions = buildGeminiOptions(configMap);
  logInfo("Gemini options resolved", {
    primaryModel: geminiOptions.primaryModel,
    secondaryModel: geminiOptions.secondaryModel,
  });

  // ─── 2. 対象案件を読む（max_items でスライス）────────────────────────────
  const targetIds = payload.project_ids.slice(0, payload.max_items);
  const projects = await readProjectsByIds(spreadsheetId, targetIds);

  if (projects.length === 0) {
    logInfo("No matching projects found. STEP_01 finished with no-op.", {
      project_ids: targetIds,
    });
    return;
  }

  // ─── 3. repo assets を一度だけ読む ─────────────────────────────────────
  const assets = loadStep01Assets();
  logInfo("STEP_01 assets loaded from repo.");

  // ─── 4. 案件を逐次処理 ──────────────────────────────────────────────────
  for (const project of projects) {
    const projectId = project.project_id;
    const recordId = project.record_id; // 00_Project の record_id（参照用）
    const now = new Date().toISOString();

    logInfo(`Processing project: ${projectId}`);

    try {
      // 3. title_jp, source_url を確認
      const titleJp = (project.title_jp ?? "").trim();
      const sourceUrl = (project.source_url ?? "").trim();

      if (!titleJp && !sourceUrl) {
        throw new Error(
          `project_id "${projectId}": both title_jp and source_url are empty.`
        );
      }

      // 4. prompt アセンブル
      const prompt = buildStep01Prompt(assets, project);
      logInfo(`Prompt assembled for ${projectId}`, {
        promptLength: prompt.length,
      });

      // 5. dry_run チェック
      if (payload.dry_run) {
        logInfo(`[dry_run] Skipping Gemini call for ${projectId}.`);
        logInfo(`[dry_run] Prompt preview (first 300 chars):\n${prompt.slice(0, 300)}`);
        continue;
      }

      // 6. Gemini 呼び出し
      logInfo(`Calling Gemini for ${projectId}...`);
      let geminiResult;
      try {
        geminiResult = await callGemini(prompt, geminiOptions);
      } catch (aiErr) {
        await handleProjectFailure(
          spreadsheetId,
          projectId,
          recordId,
          now,
          "ai_failure",
          `Gemini call failed: ${aiErr instanceof Error ? aiErr.message : String(aiErr)}`
        );
        continue;
      }

      logInfo(`Gemini responded for ${projectId}`, {
        modelUsed: geminiResult.modelUsed,
        usedFallback: geminiResult.usedFallback,
        responseLength: geminiResult.text.length,
      });

      // 7. parse / validate
      const validationResult = validateAiResponse(
        geminiResult.text,
        assets.aiSchema
      );

      if (!validationResult.success) {
        await handleProjectFailure(
          spreadsheetId,
          projectId,
          recordId,
          now,
          "schema_validation_failure",
          `Schema validation failed: ${validationResult.errors}`
        );
        continue;
      }

      logInfo(`AI response validated for ${projectId}.`);

      // 8. normalize（AI row → full row）
      const fullRow = normalizeAiRow(
        validationResult.row,
        projectId,
        "", // record_id は upsert 側で確定
        now
      );

      // 9. fast-pass 評価
      const fastPassResult = applyFastPass(fullRow, sourceUrl);
      logInfo(`Fast-pass evaluation for ${projectId}`, {
        applied: fastPassResult.applied,
        reason: fastPassResult.reason,
      });
      const finalRow = fastPassResult.row;

      // 10. 00_Rights_Validation を upsert
      const upsertedRecordId = await upsertRightsValidation(
        spreadsheetId,
        finalRow
      );
      logInfo(`00_Rights_Validation upserted for ${projectId}`, {
        record_id: upsertedRecordId,
      });

      // 11. 00_Project を最小更新（成功時）
      const patch: ProjectMinimalPatch = {
        current_step: "STEP_01_RIGHTS_VALIDATION",
        approval_status: "PENDING",
        created_at: now,
        updated_at: now,
        updated_by: "github_actions",
      };
      await updateProjectMinimal(spreadsheetId, projectId, patch);
      logInfo(`00_Project updated for ${projectId}.`);

      // 12. 成功ログ
      const successLog = buildSuccessLog(
        projectId,
        upsertedRecordId,
        `STEP_01 completed. model=${geminiResult.modelUsed}, ` +
          `fast_pass=${fastPassResult.applied}, ` +
          `rights_status=${finalRow.rights_status}, ` +
          `risk_level=${finalRow.risk_level}`
      );
      await appendAppLog(spreadsheetId, successLog);

      logInfo(`STEP_01 completed successfully for ${projectId}.`);
    } catch (err) {
      // 予期しないランタイムエラー
      await handleProjectFailure(
        spreadsheetId,
        projectId,
        recordId,
        now,
        "runtime_failure",
        `Unexpected error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  logInfo("STEP_01 Rights Validation finished.");
}

// ─── Private helpers ─────────────────────────────────────────────────────────

/**
 * プロジェクトの失敗処理:
 * - 00_Project.approval_status = UNKNOWN
 * - 100_App_Logs にエラーログを append
 */
async function handleProjectFailure(
  spreadsheetId: string,
  projectId: string,
  recordId: string,
  now: string,
  errorType: string,
  message: string
): Promise<void> {
  logError(`STEP_01 failed for ${projectId} [${errorType}]: ${message}`);

  // 00_Project を失敗状態に更新
  try {
    const failPatch: ProjectMinimalPatch = {
      current_step: "STEP_01_RIGHTS_VALIDATION",
      approval_status: "UNKNOWN",
      updated_at: now,
      updated_by: "github_actions",
    };
    await updateProjectMinimal(spreadsheetId, projectId, failPatch);
  } catch (updateErr) {
    logError(
      `Failed to update 00_Project for ${projectId} after failure`,
      updateErr
    );
  }

  // 100_App_Logs にエラーログを append
  try {
    const failLog = buildFailureLog(projectId, recordId, errorType, message);
    await appendAppLog(spreadsheetId, failLog);
  } catch (logErr) {
    logError(
      `Failed to write failure log for ${projectId}`,
      logErr
    );
  }

  // 00_Rights_Validation の generation_status を "FAILED" に更新（行が存在する場合のみ）
  try {
    await markRightsValidationGenerationFailed(spreadsheetId, projectId, now);
  } catch (markErr) {
    logError(`Failed to mark generation_status=FAILED for ${projectId} in 00_Rights_Validation`, markErr);
  }
}
