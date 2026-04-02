/**
 * step02-source-build.ts
 *
 * STEP_02 Source Build のオーケストレーター。
 *
 * 処理フロー（仕様書 step02_implementation_spec_v0.2.md §3 準拠）:
 * 1. 94_Runtime_Config を読む
 * 2. 00_Project から対象案件を読む
 * 3. 00_Rights_Validation から当該 project_id の行を読む
 * 4. rights_status が APPROVED でない場合はエラー停止
 * 5. Prompt / Schema / Example / Field Guide を repo から読む
 * 6. STEP_02 プロンプトをアセンブル
 * 7. Gemini を実行する（primary → secondary fallback）
 * 8. AI 出力を schema 検証する
 * 9. 01_Source に full row を upsert する
 * 10. 00_Project の current_step 等を最小更新する
 * 11. 100_App_Logs に成功・失敗ログを書き出す
 *
 * dry_run=true の場合:
 * - Stage 1（dry_run=true）: Gemini 呼び出しをスキップ。プロンプトプレビューのみ。
 * - Stage 2（dry_run=false, GSS書き込みのみスキップ）: Gemini 呼び出しは実施。
 *   ただし SKIP_GSS_WRITE=true 環境変数がある場合は Sheets への書き込みをスキップする。
 *
 * 制約:
 * - 単件実行のみ（複数 project_ids は逐次処理）
 * - dry_run=true の場合は Sheets への書き込みをスキップし、ログ出力のみ
 */

import type { WorkflowPayload, ProjectMinimalPatch } from "../types.js";
import { loadRuntimeConfig } from "../lib/load-runtime-config.js";
import { readProjectsByIds } from "../lib/load-project-input.js";
import { loadRightsValidationByProjectId } from "../lib/load-rights-validation.js";
import { loadStep02Assets } from "../lib/load-assets.js";
import { buildStep02Prompt } from "../lib/build-prompt.js";
import { callGemini, buildGeminiOptionsStep02 } from "../lib/call-gemini.js";
import { validateSourceAiResponse } from "../lib/validate-json.js";
import { upsertSource } from "../lib/write-source.js";
import { updateProjectMinimal } from "../lib/update-project.js";
import {
  appendAppLog,
  buildStep02SuccessLog,
  buildStep02FailureLog,
} from "../lib/write-app-log.js";
import { logInfo, logError } from "../lib/logger.js";
import type { SourceFullRow } from "../types.js";

export async function runStep02SourceBuild(
  payload: WorkflowPayload,
  spreadsheetId: string
): Promise<void> {
  logInfo("STEP_02 Source Build started", {
    project_ids: payload.project_ids,
    max_items: payload.max_items,
    dry_run: payload.dry_run,
  });

  // ─── 1. Runtime Config ──────────────────────────────────────────────────
  const configMap = await loadRuntimeConfig(spreadsheetId);
  logInfo("94_Runtime_Config loaded", { size: configMap.size });

  const geminiOptions = buildGeminiOptionsStep02(configMap);
  logInfo("Gemini options resolved (STEP_02)", {
    primaryModel: geminiOptions.primaryModel,
    secondaryModel: geminiOptions.secondaryModel,
  });

  // ─── 2. 対象案件を読む（max_items でスライス）────────────────────────────
  const targetIds = payload.project_ids.slice(0, payload.max_items);
  const projects = await readProjectsByIds(spreadsheetId, targetIds);

  if (projects.length === 0) {
    logInfo("No matching projects found. STEP_02 finished with no-op.", {
      project_ids: targetIds,
    });
    return;
  }

  // ─── 3. repo assets を一度だけ読む ─────────────────────────────────────
  const assets = loadStep02Assets();
  logInfo("STEP_02 assets loaded from repo.");

  // ─── 4. 案件を逐次処理 ──────────────────────────────────────────────────
  for (const project of projects) {
    const projectId = project.project_id;
    const projectRecordId = project.record_id;
    const now = new Date().toISOString();

    logInfo(`Processing project: ${projectId}`);

    try {
      // Mandatory フィールドチェック
      const titleJp = (project.title_jp ?? "").trim();
      const sourceUrl = (project.source_url ?? "").trim();
      const targetAge = (project.target_age ?? "").trim();

      if (!titleJp) {
        throw new Error(`project_id "${projectId}": title_jp is empty.`);
      }
      if (!sourceUrl) {
        throw new Error(`project_id "${projectId}": source_url is empty.`);
      }

      // 3. 00_Rights_Validation を読む
      const rvRow = await loadRightsValidationByProjectId(spreadsheetId, projectId);

      if (!rvRow) {
        await handleStep02Failure(
          spreadsheetId,
          projectId,
          projectRecordId,
          now,
          "runtime_failure",
          `00_Rights_Validation row not found for project_id "${projectId}". Run STEP_01 first.`,
          payload.dry_run
        );
        continue;
      }

      logInfo(`00_Rights_Validation loaded for ${projectId}`, {
        rights_status: rvRow.rights_status,
      });

      // 4. rights_status チェック（A-1: APPROVED でなければエラー停止）
      if (rvRow.rights_status !== "APPROVED") {
        await handleStep02Failure(
          spreadsheetId,
          projectId,
          rvRow.record_id,
          now,
          "runtime_failure",
          `rights_status is "${rvRow.rights_status}" (expected: APPROVED). STEP_02 aborted.`,
          payload.dry_run
        );
        continue;
      }

      // 5. プロンプトアセンブル
      const prompt = buildStep02Prompt(assets, project, rvRow);
      logInfo(`Prompt assembled for ${projectId}`, {
        promptLength: prompt.length,
        target_age: targetAge || "(empty)",
      });

      // ── Stage 1: dry_run=true → Gemini 呼び出しをスキップ ─────────────
      if (payload.dry_run) {
        logInfo(`[dry_run] Skipping Gemini call for ${projectId}.`);
        logInfo(`[dry_run] Prompt preview (first 500 chars):\n${prompt.slice(0, 500)}`);
        continue;
      }

      // 6. Gemini 呼び出し
      logInfo(`Calling Gemini for ${projectId}...`);
      let geminiResult;
      try {
        geminiResult = await callGemini(prompt, geminiOptions);
      } catch (aiErr) {
        await handleStep02Failure(
          spreadsheetId,
          projectId,
          rvRow.record_id,
          now,
          "ai_failure",
          `Gemini call failed: ${aiErr instanceof Error ? aiErr.message : String(aiErr)}`,
          payload.dry_run
        );
        continue;
      }

      logInfo(`Gemini responded for ${projectId}`, {
        modelUsed: geminiResult.modelUsed,
        usedFallback: geminiResult.usedFallback,
        responseLength: geminiResult.text.length,
      });

      // 7. schema validate
      const validationResult = validateSourceAiResponse(
        geminiResult.text,
        assets.aiSchema
      );

      if (!validationResult.success) {
        await handleStep02Failure(
          spreadsheetId,
          projectId,
          rvRow.record_id,
          now,
          "schema_validation_failure",
          `Schema validation failed: ${validationResult.errors}`,
          payload.dry_run
        );
        continue;
      }

      logInfo(`AI response validated for ${projectId}.`);
      const aiRow = validationResult.row;

      // 8. full row に変換（GitHub 補完フィールドをセット）
      const fullRow: SourceFullRow = {
        // AI 出力フィールド
        ...aiRow,
        // GitHub 補完フィールド
        project_id: projectId,
        record_id: "",           // upsert 側で確定
        generation_status: "GENERATED",
        approval_status: "PENDING",
        step_id: "STEP_02_SOURCE_BUILD",
        original_text: "",       // B-1方式: source_url があるため空欄
        legal_check_status: "",
        legal_check_notes: "",
        updated_at: now,
        updated_by: "github_actions",
        notes: "",
      };

      // 9. 01_Source を upsert
      const upsertedRecordId = await upsertSource(spreadsheetId, fullRow);
      logInfo(`01_Source upserted for ${projectId}`, {
        record_id: upsertedRecordId,
      });

      // 10. 00_Project を最小更新（成功時）
      const patch: ProjectMinimalPatch = {
        current_step: "STEP_02_SOURCE_BUILD",
        approval_status: "PENDING",
        created_at: now,
        updated_at: now,
        updated_by: "github_actions",
      };
      await updateProjectMinimal(spreadsheetId, projectId, patch);
      logInfo(`00_Project updated for ${projectId}.`);

      // 11. 成功ログ
      const successLog = buildStep02SuccessLog(
        projectId,
        upsertedRecordId,
        `STEP_02 completed. model=${geminiResult.modelUsed}, ` +
          `source_type=${aiRow.source_type}, ` +
          `usedFallback=${geminiResult.usedFallback}`
      );
      await appendAppLog(spreadsheetId, successLog);

      logInfo(`STEP_02 completed successfully for ${projectId}.`);
    } catch (err) {
      // 予期しないランタイムエラー
      await handleStep02Failure(
        spreadsheetId,
        projectId,
        projectRecordId,
        now,
        "runtime_failure",
        `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
        payload.dry_run
      );
    }
  }

  logInfo("STEP_02 Source Build finished.");
}

// ─── Private helpers ─────────────────────────────────────────────────────────

async function handleStep02Failure(
  spreadsheetId: string,
  projectId: string,
  recordId: string,
  now: string,
  errorType: string,
  message: string,
  dryRun: boolean
): Promise<void> {
  logError(`STEP_02 failed for ${projectId} [${errorType}]: ${message}`);

  if (dryRun) {
    logInfo(`[dry_run] Skipping GSS write for failure of ${projectId}.`);
    return;
  }

  // 00_Project を失敗状態に更新
  try {
    const failPatch: ProjectMinimalPatch = {
      current_step: "STEP_02_SOURCE_BUILD",
      approval_status: "UNKNOWN",
      updated_at: now,
      updated_by: "github_actions",
    };
    await updateProjectMinimal(spreadsheetId, projectId, failPatch);
  } catch (updateErr) {
    logError(
      `Failed to update 00_Project for ${projectId} after STEP_02 failure`,
      updateErr
    );
  }

  // 100_App_Logs にエラーログを追記
  try {
    const failLog = buildStep02FailureLog(projectId, recordId, errorType, message);
    await appendAppLog(spreadsheetId, failLog);
  } catch (logErr) {
    logError(`Failed to write failure log for ${projectId}`, logErr);
  }
}
