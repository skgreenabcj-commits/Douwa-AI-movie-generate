/**
 * step09-qa-build.ts
 *
 * STEP_09 Q&A Build のオーケストレーター。
 *
 * ─── 処理概要 ──────────────────────────────────────────────────────────────────
 *
 * 1. 00_Project から ProjectRow を取得
 * 2. video_format を検証（"full" | "short" | "short+full"）
 * 3. 02_Scenes から全 scene を取得（generation_status = "GENERATED"）
 * 4. video_format に応じて Full / Short QA を生成:
 *    Full  → full_use=Y の scene を使い 10問生成
 *    Short → short_use=Y の scene を使い 3〜10問生成（Full QA を参照コンテキストとして提供）
 *    ※ short+full の場合: Full → Short の順に実行。Full 失敗時は Short もスキップ
 * 5. AI 出力を AJV でスキーマ検証
 * 6. record_id を採番（既存行は再利用、新規は PJT-001-QA-001 形式の通し採番）
 * 7. QaRow を組み立て 10_QA に upsert
 * 8. 00_Project を最小更新（current_step = STEP_09_QA_BUILD）
 * 9. 100_App_Logs にログ記録
 *
 * ─── record_id 採番方針 ────────────────────────────────────────────────────────
 *
 * - 通し採番（Full と Short で連続番号）
 * - Full QA が先に採番（例: 001〜010）、Short QA が後続（例: 011〜020）
 * - 既存行（generation_status = "GENERATED"）の record_id をインデックス順で再利用
 * - AI 出力件数 > 既存行件数の場合: 超過分は通し番号で新規採番
 * - AI 出力件数 < 既存行件数の場合: 余剰の既存行は残置（DELETE 禁止）
 *
 * ─── Short QA の最小件数 ───────────────────────────────────────────────────────
 *
 * - 目標: 10問（scenes.length * 2 を上限として target_question_count を算出）
 * - 最小: 3問。short_use=Y scene が少ない場合はスキーマ minItems=3 で検証
 */

import type {
  WorkflowPayload,
  ProjectMinimalPatch,
  QaAiRow,
  QaRow,
  QaReadRow,
  SceneReadRow,
} from "../types.js";
import { loadRuntimeConfig } from "../lib/load-runtime-config.js";
import { readProjectsByIds } from "../lib/load-project-input.js";
import { loadScenesByProjectId } from "../lib/load-scenes.js";
import { loadQaByProjectId } from "../lib/load-qa.js";
import { loadStep09Assets } from "../lib/load-assets.js";
import { buildStep09FullPrompt, buildStep09ShortPrompt } from "../lib/build-prompt.js";
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

// ─── record_id 採番 ───────────────────────────────────────────────────────────

/**
 * QA rows に record_id を割り当てる。
 *
 * @param projectId    - project_id
 * @param aiRows       - AI が返した QaAiRow[]
 * @param existingRows - 既存の record_id リスト（再利用用）
 * @param globalOffset - 通し番号のオフセット（Full=0, Short=Full件数）
 */
function assignQaRecordIds(
  projectId: string,
  aiRows: QaAiRow[],
  existingRows: QaReadRow[],
  globalOffset: number
): Array<{ ai: QaAiRow; record_id: string; qa_no: number }> {
  return aiRows.map((ai, i) => {
    const record_id =
      existingRows[i]?.record_id ??
      `${projectId}-QA-${String(globalOffset + i + 1).padStart(3, "0")}`;
    return { ai, record_id, qa_no: i + 1 };
  });
}

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

    // ── プロジェクト取得 ──────────────────────────────────────────────────────
    let projectRecordId = "";
    let videoFormat = "";
    let atLeastOneSuccess = false;

    try {
      const projects = await readProjectsByIds(spreadsheetId, [projectId]);
      const project = projects[0];
      if (!project) {
        const msg = `[STEP_09] project not found: ${projectId}`;
        logError(msg);
        try {
          await appendAppLog(
            spreadsheetId,
            buildStep09FailureLog(projectId, "", "project_not_found", msg)
          );
        } catch (_) {}
        continue;
      }
      projectRecordId = project.record_id;
      videoFormat = (project.video_format ?? "").trim().toLowerCase();

      // ── video_format 検証 ────────────────────────────────────────────────────
      if (!["full", "short", "short+full"].includes(videoFormat)) {
        const msg = `[STEP_09] Invalid video_format: "${videoFormat}" for project ${projectId}`;
        logError(msg);
        try {
          await appendAppLog(
            spreadsheetId,
            buildStep09FailureLog(projectId, projectRecordId, "invalid_video_format", msg)
          );
        } catch (_) {}
        continue;
      }

      // ── 02_Scenes 取得 ───────────────────────────────────────────────────────
      const allScenes = await loadScenesByProjectId(spreadsheetId, projectId);
      if (allScenes.length === 0) {
        const msg = `[STEP_09] No GENERATED scenes found for project ${projectId}`;
        logError(msg);
        try {
          await appendAppLog(
            spreadsheetId,
            buildStep09FailureLog(projectId, projectRecordId, "no_scenes", msg)
          );
        } catch (_) {}
        continue;
      }

      // ── 既存 QA 行の取得（再実行時の record_id 引き継ぎ用） ─────────────────
      const allExistingQa = await loadQaByProjectId(spreadsheetId, projectId);
      const existingFullQa = allExistingQa.filter((r) => r.related_version === "full");
      const existingShortQa = allExistingQa.filter((r) => r.related_version === "short");

      // Full QA 書き込み済み件数（Short の通し番号オフセットに使用）
      let fullWrittenCount = 0;
      // Full で生成した QaAiRow[]（Short プロンプトの参照コンテキストに使用）
      let fullQaAiRows: QaAiRow[] = [];

      // ─────────────────────────────────────────────────────────────────────────
      // Full QA Build（video_format = "full" or "short+full"）
      // ─────────────────────────────────────────────────────────────────────────
      if (videoFormat === "full" || videoFormat === "short+full") {
        const fullScenes: SceneReadRow[] = allScenes.filter((s) => s.full_use === "Y");

        if (fullScenes.length === 0) {
          const msg = `[STEP_09] No full_use=Y scenes for project ${projectId}`;
          logError(msg);
          try {
            await appendAppLog(
              spreadsheetId,
              buildStep09FailureLog(projectId, projectRecordId, "no_full_scenes", msg)
            );
          } catch (_) {}
          // short+full の場合は Short も依存スキップ
          if (videoFormat === "short+full") {
            try {
              await appendAppLog(
                spreadsheetId,
                buildStep09FailureLog(projectId, projectRecordId, "short_skipped_due_to_full_failure",
                  `[STEP_09] Short QA skipped: Full QA failed (no_full_scenes) for ${projectId}`)
              );
            } catch (_) {}
            continue;
          }
        } else {
          // ── Full プロンプト組み立て・Gemini 呼び出し ─────────────────────────
          const fullPrompt = buildStep09FullPrompt(step09Assets, project, fullScenes);
          logInfo(`[STEP_09] Calling Gemini (Full QA) for ${projectId} (${fullScenes.length} scenes)`);

          let fullGeminiResult: Awaited<ReturnType<typeof callGemini>> | null = null;
          try {
            fullGeminiResult = await callGemini(fullPrompt, {
              ...geminiOptions,
              maxOutputTokens: 8192,
            });
            logInfo(`[STEP_09] Gemini (Full QA) responded. modelUsed=${fullGeminiResult.modelUsed}`);
          } catch (geminiErr) {
            if (geminiErr instanceof GeminiSpendingCapError) throw geminiErr;
            const msg =
              `[STEP_09] Gemini call failed (Full QA) for ${projectId}: ` +
              (geminiErr instanceof Error ? geminiErr.message : String(geminiErr));
            logError(msg);
            try {
              await appendAppLog(spreadsheetId,
                buildStep09FailureLog(projectId, projectRecordId, "gemini_call_failed", msg));
            } catch (_) {}
            if (videoFormat === "short+full") {
              try {
                await appendAppLog(spreadsheetId,
                  buildStep09FailureLog(projectId, projectRecordId, "short_skipped_due_to_full_failure",
                    `Short QA skipped: Full QA failed for ${projectId}`));
              } catch (_) {}
              continue;
            }
          }

          if (fullGeminiResult) {
            // ── スキーマ検証 ────────────────────────────────────────────────────
            const fullValidation = validateQaAiResponse(fullGeminiResult.text, step09Assets.aiSchema, 1);
            if (!fullValidation.success) {
              const msg = `[STEP_09] Schema validation failed (Full QA) for ${projectId}: ${fullValidation.errors}`;
              logError(msg);
              try {
                await appendAppLog(spreadsheetId,
                  buildStep09FailureLog(projectId, projectRecordId, "schema_validation_failed", msg));
              } catch (_) {}
              if (videoFormat === "short+full") {
                try {
                  await appendAppLog(spreadsheetId,
                    buildStep09FailureLog(projectId, projectRecordId, "short_skipped_due_to_full_failure",
                      `Short QA skipped: Full QA validation failed for ${projectId}`));
                } catch (_) {}
                continue;
              }
            } else {
              fullQaAiRows = fullValidation.items;
              // ── record_id 採番（Full: offset=0） ────────────────────────────
              if (existingFullQa.length > 0) {
                logInfo(`[STEP_09] Re-run (Full): ${existingFullQa.length} existing rows for ${projectId}`);
                if (existingFullQa.length > fullValidation.items.length) {
                  logError(
                    `[STEP_09][WARN] Full QA: AI count (${fullValidation.items.length}) < existing (${existingFullQa.length}). ` +
                    `Surplus rows remain in place.`
                  );
                }
              }

              const assignedFull = assignQaRecordIds(
                projectId, fullValidation.items, existingFullQa, 0
              );

              // ── 10_QA upsert（Full） ─────────────────────────────────────────
              const now = new Date().toISOString();
              let fullSuccessCount = 0;
              let fullFailCount = 0;
              let lastFullRecordId = projectRecordId;

              for (const { ai, record_id, qa_no } of assignedFull) {
                const row: QaRow = {
                  ...ai,
                  project_id:        projectId,
                  record_id,
                  generation_status: "GENERATED",
                  approval_status:   "PENDING",
                  step_id:           "STEP_09_QA_BUILD",
                  qa_no,
                  related_version:   "full",
                  card_visual:       "",
                  duration_sec:      "",
                  learning_goal:     "",
                  updated_at:        now,
                  updated_by:        "github_actions",
                  notes:             "",
                };

                if (payload.dry_run) {
                  logInfo(`[STEP_09][DRY_RUN] Would upsert (Full): ${record_id} (${ai.qa_type}: ${ai.question.slice(0, 30)}...)`);
                  fullSuccessCount++;
                  lastFullRecordId = record_id;
                  continue;
                }

                try {
                  await upsertQa(spreadsheetId, row);
                  logInfo(`[STEP_09] Upserted (Full): ${record_id}`);
                  fullSuccessCount++;
                  lastFullRecordId = record_id;
                } catch (upsertErr) {
                  const msg =
                    `[STEP_09] upsertQa failed (Full) for ${record_id}: ` +
                    (upsertErr instanceof Error ? upsertErr.message : String(upsertErr));
                  logError(msg);
                  try {
                    await appendAppLog(spreadsheetId,
                      buildStep09FailureLog(projectId, record_id, "upsert_failed", msg));
                  } catch (_) {}
                  fullFailCount++;
                }
              }

              fullWrittenCount = assignedFull.length;

              const fullSummary =
                `Full QA complete: success=${fullSuccessCount}, fail=${fullFailCount}, ` +
                `total=${assignedFull.length}, project=${projectId}`;
              logInfo(`[STEP_09] ${fullSummary}`);

              try {
                if (fullFailCount > 0 && fullSuccessCount === 0) {
                  await appendAppLog(spreadsheetId,
                    buildStep09FailureLog(projectId, projectRecordId, "all_upsert_failed", fullSummary));
                } else {
                  await appendAppLog(spreadsheetId,
                    buildStep09SuccessLog(projectId, lastFullRecordId, fullSummary));
                  atLeastOneSuccess = true;
                }
              } catch (_) {}
            }
          }
        }
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Short QA Build（video_format = "short" or "short+full"）
      // ─────────────────────────────────────────────────────────────────────────
      if (videoFormat === "short" || videoFormat === "short+full") {
        const shortScenes: SceneReadRow[] = allScenes.filter((s) => s.short_use === "Y");

        if (shortScenes.length === 0) {
          const msg = `[STEP_09] No short_use=Y scenes for project ${projectId}`;
          logError(msg);
          try {
            await appendAppLog(spreadsheetId,
              buildStep09FailureLog(projectId, projectRecordId, "no_short_scenes", msg));
          } catch (_) {}
        } else {
          // ── Short プロンプト組み立て・Gemini 呼び出し ─────────────────────────
          const shortPrompt = buildStep09ShortPrompt(
            step09Assets, project, shortScenes, fullQaAiRows
          );
          logInfo(`[STEP_09] Calling Gemini (Short QA) for ${projectId} (${shortScenes.length} scenes)`);

          let shortGeminiResult: Awaited<ReturnType<typeof callGemini>> | null = null;
          try {
            shortGeminiResult = await callGemini(shortPrompt, {
              ...geminiOptions,
              maxOutputTokens: 8192,
            });
            logInfo(`[STEP_09] Gemini (Short QA) responded. modelUsed=${shortGeminiResult.modelUsed}`);
          } catch (geminiErr) {
            if (geminiErr instanceof GeminiSpendingCapError) throw geminiErr;
            const msg =
              `[STEP_09] Gemini call failed (Short QA) for ${projectId}: ` +
              (geminiErr instanceof Error ? geminiErr.message : String(geminiErr));
            logError(msg);
            try {
              await appendAppLog(spreadsheetId,
                buildStep09FailureLog(projectId, projectRecordId, "gemini_call_failed", msg));
            } catch (_) {}
          }

          if (shortGeminiResult) {
            // ── スキーマ検証（Short: minItems=3） ───────────────────────────────
            const shortValidation = validateQaAiResponse(
              shortGeminiResult.text, step09Assets.aiSchema, 3
            );
            if (!shortValidation.success) {
              const msg = `[STEP_09] Schema validation failed (Short QA) for ${projectId}: ${shortValidation.errors}`;
              logError(msg);
              try {
                await appendAppLog(spreadsheetId,
                  buildStep09FailureLog(projectId, projectRecordId, "schema_validation_failed", msg));
              } catch (_) {}
            } else {
              // ── record_id 採番（Short: offset=fullWrittenCount） ────────────
              if (existingShortQa.length > 0) {
                logInfo(`[STEP_09] Re-run (Short): ${existingShortQa.length} existing rows for ${projectId}`);
                if (existingShortQa.length > shortValidation.items.length) {
                  logError(
                    `[STEP_09][WARN] Short QA: AI count (${shortValidation.items.length}) < existing (${existingShortQa.length}). ` +
                    `Surplus rows remain in place.`
                  );
                }
              }

              const assignedShort = assignQaRecordIds(
                projectId, shortValidation.items, existingShortQa, fullWrittenCount
              );

              // ── 10_QA upsert（Short） ────────────────────────────────────────
              const now = new Date().toISOString();
              let shortSuccessCount = 0;
              let shortFailCount = 0;
              let lastShortRecordId = projectRecordId;

              for (const { ai, record_id, qa_no } of assignedShort) {
                const row: QaRow = {
                  ...ai,
                  project_id:        projectId,
                  record_id,
                  generation_status: "GENERATED",
                  approval_status:   "PENDING",
                  step_id:           "STEP_09_QA_BUILD",
                  qa_no,
                  related_version:   "short",
                  card_visual:       "",
                  duration_sec:      "",
                  learning_goal:     "",
                  updated_at:        now,
                  updated_by:        "github_actions",
                  notes:             "",
                };

                if (payload.dry_run) {
                  logInfo(`[STEP_09][DRY_RUN] Would upsert (Short): ${record_id} (${ai.qa_type}: ${ai.question.slice(0, 30)}...)`);
                  shortSuccessCount++;
                  lastShortRecordId = record_id;
                  continue;
                }

                try {
                  await upsertQa(spreadsheetId, row);
                  logInfo(`[STEP_09] Upserted (Short): ${record_id}`);
                  shortSuccessCount++;
                  lastShortRecordId = record_id;
                } catch (upsertErr) {
                  const msg =
                    `[STEP_09] upsertQa failed (Short) for ${record_id}: ` +
                    (upsertErr instanceof Error ? upsertErr.message : String(upsertErr));
                  logError(msg);
                  try {
                    await appendAppLog(spreadsheetId,
                      buildStep09FailureLog(projectId, record_id, "upsert_failed", msg));
                  } catch (_) {}
                  shortFailCount++;
                }
              }

              const shortSummary =
                `Short QA complete: success=${shortSuccessCount}, fail=${shortFailCount}, ` +
                `total=${assignedShort.length}, project=${projectId}`;
              logInfo(`[STEP_09] ${shortSummary}`);

              try {
                if (shortFailCount > 0 && shortSuccessCount === 0) {
                  await appendAppLog(spreadsheetId,
                    buildStep09FailureLog(projectId, projectRecordId, "all_upsert_failed", shortSummary));
                } else {
                  await appendAppLog(spreadsheetId,
                    buildStep09SuccessLog(projectId, lastShortRecordId, shortSummary));
                  atLeastOneSuccess = true;
                }
              } catch (_) {}
            }
          }
        }
      }

      // 失敗時: 10_QA の既存行を FAILED に更新
      if (!atLeastOneSuccess && !payload.dry_run) {
        try { await markQaGenerationFailed(spreadsheetId, projectId, new Date().toISOString()); } catch (_) {}
      }

      // ── 00_Project 最小更新 ────────────────────────────────────────────────
      if (atLeastOneSuccess && !payload.dry_run) {
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
    } catch (err) {
      // Spending Cap は全プロジェクト停止
      if (err instanceof GeminiSpendingCapError) {
        throw err;
      }
      const msg =
        `[STEP_09] Unexpected error for project ${projectId}: ` +
        (err instanceof Error ? err.message : String(err));
      logError(msg);
      try {
        await appendAppLog(
          spreadsheetId,
          buildStep09FailureLog(projectId, projectRecordId, "unexpected_error", msg)
        );
      } catch (_) {}
      if (!payload.dry_run) {
        try { await markQaGenerationFailed(spreadsheetId, projectId, new Date().toISOString()); } catch (_) {}
      }
    }
  }

  logInfo("[STEP_09] Q&A Build finished.");
}
