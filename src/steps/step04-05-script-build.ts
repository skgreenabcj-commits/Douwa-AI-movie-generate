/**
 * step04-05-script-build.ts
 *
 * STEP_04_05_COMBINED Script Build のオーケストレーター。
 *
 * ─── video_format による実行分岐 ──────────────────────────────────────────────
 *
 * video_format = "full":
 *   STEP_05（Full）のみ実行。STEP_04 は実行しない。
 *
 * video_format = "short":
 *   STEP_04（Short）のみ実行。Full script を参照しない（hasFullScript = false 固定）。
 *
 * video_format = "short+full":
 *   STEP_05（Full）→ STEP_04（Short）の順で実行。
 *   ⚠️ STEP_04 は STEP_05 の成功を前提とする。
 *   Full が失敗した場合、または Full script 読み込み（loadFullScriptByProjectId）に
 *   失敗・0件の場合、Short は「依存関係失敗」として実行しない（Fix #1）。
 *   理由: short+full モードの Short は Full script を参照しながら tuning する成果物であり、
 *         Full 参照がない状態では intended design を満たさない。
 *
 * ─── record_id 突合方針（Fix #5）─────────────────────────────────────────────
 *
 * - AI 出力件数 ≠ 入力 scene 件数: validateScript*AiResponse が fail を返すため、
 *   オーケストレーター側に到達しない（validation で早期 fail）。
 * - AI 出力の record_id が全て一致する場合: ID マップで突合（正常ケース）。
 * - record_id 不一致が 1 件でも存在する場合:
 *   - 全 record_id が不一致 → fail（インデックス順フォールバック禁止）
 *   - 不一致が全体の 20% 以下かつ件数一致 → デフォルト fail-fast。
 *     94_Runtime_Config の allow_record_id_index_fallback = "true" の場合のみ
 *     警告ログを出してインデックス順フォールバックを許容。
 *   - 上記以外 → fail
 *
 * ─── short_use=Y 0 件（Fix #6）───────────────────────────────────────────────
 *
 * short_use=Y の scene が 0 件の場合は Short を SKIPPED 扱いとする。
 * 失敗ではない。ログに [INFO][short_skipped] を残す。
 * current_step は「Full のみ成功」扱いで STEP_05_FULL_SCRIPT_BUILD のまま。
 *
 * ─── partial success 定義（Fix #1 反映後）─────────────────────────────────────
 *
 * video_format = "full":
 *   Full 成功 → current_step = STEP_05_FULL_SCRIPT_BUILD
 *   Full 失敗 → current_step 更新しない
 *
 * video_format = "short":
 *   Short 成功 → current_step = STEP_04_SHORT_SCRIPT_BUILD
 *   Short 失敗 → current_step 更新しない
 *
 * video_format = "short+full":
 *   両方成功    → current_step = STEP_04_05_COMBINED
 *   Full 成功 / Short 失敗   → current_step = STEP_05_FULL_SCRIPT_BUILD（partial）
 *   Full 成功 / Short SKIPPED → current_step = STEP_05_FULL_SCRIPT_BUILD（short_skipped）
 *   Full 失敗 / Short 未実行 → current_step 更新しない（dependency_failure）
 *   両方失敗    → current_step 更新しない
 */

import type {
  WorkflowPayload,
  ProjectMinimalPatch,
  SceneReadRow,
  ScriptFullRow,
  ScriptShortRow,
  ScriptFullReadRow,
} from "../types.js";
import { parseRuntimeConfig, getConfigValue } from "../lib/load-runtime-config.js";
import { filterProjectsByIds } from "../lib/load-project-input.js";
import { filterScenesByProjectId } from "../lib/load-scenes.js";
import { filterFullScriptByProjectId } from "../lib/load-script.js";
import { readSheetsBatch } from "../lib/sheets-client.js";
import { loadStep04Assets, loadStep05Assets } from "../lib/load-assets.js";
import { buildStep04Prompt, buildStep05Prompt } from "../lib/build-prompt.js";
import {
  callGemini,
  buildGeminiOptionsStep04,
  buildGeminiOptionsStep05,
  GeminiSpendingCapError,
} from "../lib/call-gemini.js";
import {
  validateScriptFullAiResponse,
  validateScriptShortAiResponse,
} from "../lib/validate-json.js";
import { upsertScriptFull } from "../lib/write-script-full.js";
import { upsertScriptShort } from "../lib/write-script-short.js";
import { updateProjectMinimal } from "../lib/update-project.js";
import {
  appendAppLog,
  buildStep04SuccessLog,
  buildStep04FailureLog,
  buildStep05SuccessLog,
  buildStep05FailureLog,
  buildStep04_05PreflightFailureLog,
  buildStep04_05PartialSuccessLog,
  buildStep04ShortSkippedLog,
  buildStep04DependencySkippedLog,
} from "../lib/write-app-log.js";
import { logInfo, logError } from "../lib/logger.js";

// ─── duration_sec 計算 ────────────────────────────────────────────────────────

/**
 * narration_tts の文字数から duration_sec を概算する。
 * 読み速度: 5.5 文字/秒（日本語音読の一般的な平均）
 */
function calcDurationSec(narrationTts: string): number {
  return Math.ceil(narrationTts.length / 5.5);
}

// ─── record_id 突合ロジック（Fix #5 強化版） ──────────────────────────────────

type AiRow = { record_id: string; [key: string]: unknown };

/** 突合成功時は matched 配列を返す。失敗時は null を返す。 */
function matchAiOutputToScenes<T extends AiRow>(
  aiRows: T[],
  sceneRows: SceneReadRow[],
  stepLabel: string,
  allowIndexFallback: boolean
): Array<{ ai: T; scene: SceneReadRow }> | null {
  // 件数は validateScript*AiResponse(expectedCount) で事前に保証済み。
  // 万一ここで不一致になった場合も fail-fast とする。
  if (aiRows.length !== sceneRows.length) {
    logError(
      `[${stepLabel}] record_id match: count mismatch ` +
      `aiRows=${aiRows.length}, sceneRows=${sceneRows.length}. Aborting.`
    );
    return null;
  }

  const sceneMap = new Map<string, SceneReadRow>(
    sceneRows.map((s) => [s.record_id, s])
  );

  const result: Array<{ ai: T; scene: SceneReadRow }> = [];
  const mismatches: number[] = [];

  for (let i = 0; i < aiRows.length; i++) {
    const ai = aiRows[i];
    const byId = sceneMap.get(ai.record_id);
    if (byId) {
      result.push({ ai, scene: byId });
    } else {
      mismatches.push(i);
    }
  }

  if (mismatches.length === 0) {
    return result; // 正常ケース
  }

  // index fallback は allowIndexFallback が有効 かつ mismatch ≤ 20% の場合のみ許容
  const mismatchRate = mismatches.length / aiRows.length;
  if (allowIndexFallback && mismatchRate <= 0.2) {
    logError(
      `[${stepLabel}] record_id mismatch: ${mismatches.length}/${aiRows.length} rows ` +
      `(${(mismatchRate * 100).toFixed(0)}%). Falling back to index order for mismatched rows.`
    );
    // フォールバック: 不一致分だけインデックス順で再突合
    const fallbackResult: Array<{ ai: T; scene: SceneReadRow }> = [];
    for (let i = 0; i < aiRows.length; i++) {
      const ai = aiRows[i];
      const byId = sceneMap.get(ai.record_id);
      if (byId) {
        fallbackResult.push({ ai, scene: byId });
      } else {
        const fallbackScene = sceneRows[i];
        logError(
          `[${stepLabel}] index fallback: AI[${i}].record_id="${ai.record_id}" ` +
          `→ scene[${i}].record_id="${fallbackScene.record_id}"`
        );
        fallbackResult.push({ ai, scene: fallbackScene });
      }
    }
    return fallbackResult;
  }

  // index fallback 無効、または 20% 超 → fail
  logError(
    `[${stepLabel}] record_id mismatch: ${mismatches.length}/${aiRows.length}. ` +
    (!allowIndexFallback
      ? "Index fallback is disabled (allow_record_id_index_fallback not set in 94_Runtime_Config). "
      : "Mismatch rate too high (>20%). ") +
    "Refusing to upsert to prevent data corruption."
  );
  return null;
}

// ─── メインオーケストレーター ─────────────────────────────────────────────────

export async function runStep04_05ScriptBuild(
  payload: WorkflowPayload,
  spreadsheetId: string
): Promise<void> {
  logInfo("STEP_04_05 Script Build started", {
    project_ids: payload.project_ids,
    max_items: payload.max_items,
    dry_run: payload.dry_run,
  });

  // ── batchGet: 必要な全シートを 1 回の API コールで取得 ──────────────────────
  const BATCH_SHEETS = ["94_Runtime_Config", "00_Project", "02_Scenes", "04_Script_Full"] as const;
  logInfo("STEP_04_05 loading sheets via batchGet", { sheets: BATCH_SHEETS });
  const batchData = await readSheetsBatch(spreadsheetId, [...BATCH_SHEETS]);

  const configMap = parseRuntimeConfig(batchData.get("94_Runtime_Config") ?? []);
  logInfo("94_Runtime_Config parsed", { size: configMap.size });

  const geminiOptionsStep05 = buildGeminiOptionsStep05(configMap);
  const geminiOptionsStep04 = buildGeminiOptionsStep04(configMap);

  // record_id mismatch fallback is disabled by default (fail-fast).
  // Enable only when 94_Runtime_Config has allow_record_id_index_fallback = "true".
  const allowIndexFallback =
    getConfigValue(configMap, "allow_record_id_index_fallback", "false") === "true";

  const targetIds = payload.project_ids.slice(0, payload.max_items);
  const projects = filterProjectsByIds(batchData.get("00_Project") ?? [], targetIds);

  if (projects.length === 0) {
    logInfo("No matching projects found. STEP_04_05 finished with no-op.", { project_ids: targetIds });
    return;
  }

  const step05Assets = loadStep05Assets();
  const step04Assets = loadStep04Assets();
  logInfo("STEP_04_05 assets loaded from repo.");

  for (const project of projects) {
    const projectId = project.project_id;
    const projectRecordId = project.record_id;

    logInfo(`Processing project: ${projectId}`);

    // ── video_format チェック ──────────────────────────────────────────────
    const videoFormat = (project.video_format ?? "").trim();
    if (!["short", "full", "short+full"].includes(videoFormat)) {
      const msg = `Invalid video_format="${videoFormat}". Must be "short", "full", or "short+full".`;
      logError(msg);
      try {
        await appendAppLog(
          spreadsheetId,
          buildStep04_05PreflightFailureLog(projectId, projectRecordId, "invalid_video_format", msg)
        );
      } catch (_) { /* ignore */ }
      continue;
    }

    const runFull  = videoFormat === "full"  || videoFormat === "short+full";
    const runShort = videoFormat === "short" || videoFormat === "short+full";
    // short+full モードでは Short は Full の成功を前提とする（Fix #1）
    const shortDependsOnFull = videoFormat === "short+full";

    // ── 02_Scenes フィルタ（batchGet 済みデータをメモリ内検索）────────────────
    const allScenes: SceneReadRow[] = filterScenesByProjectId(
      batchData.get("02_Scenes") ?? [],
      projectId
    );

    if (allScenes.length === 0) {
      const msg = `No GENERATED scenes found in 02_Scenes for project_id="${projectId}".`;
      logError(msg);
      try {
        await appendAppLog(
          spreadsheetId,
          buildStep04_05PreflightFailureLog(projectId, projectRecordId, "no_scenes", msg)
        );
      } catch (_) { /* ignore */ }
      continue;
    }

    logInfo(`02_Scenes loaded. total=${allScenes.length} for project="${projectId}".`);

    let fullSuccess = false;
    let shortResult: "success" | "fail" | "skipped" | "not_run" = "not_run";

    // ─────────────────────────────────────────────────────────────────────
    // STEP_05 Full Script Build
    // ─────────────────────────────────────────────────────────────────────
    if (runFull) {
      try {
        const fullScenes = allScenes.filter((s) => s.full_use === "Y");
        const fullUseCount = fullScenes.length;
        logInfo(
          `[STEP_05] Starting Full Script Build. ` +
          `full_use_count=${fullUseCount}, total_scene_count=${allScenes.length}`
        );

        if (payload.dry_run) {
          const previewPrompt = buildStep05Prompt(step05Assets, project, fullScenes);
          console.log("[DRY_RUN][STEP_05] Full Script Prompt Preview:");
          console.log("--- PROMPT START ---");
          console.log(previewPrompt.slice(0, 2000));
          console.log("--- PROMPT END (truncated at 2000 chars) ---");
          fullSuccess = true;
        } else {
          const prompt = buildStep05Prompt(step05Assets, project, fullScenes);
          const geminiResult = await callGemini(prompt, {
            ...geminiOptionsStep05,
            maxOutputTokens: 32768,
          });

          logInfo(
            `[STEP_05] Gemini responded. model="${geminiResult.modelUsed}", ` +
            `usedFallback=${geminiResult.usedFallback}, ` +
            `responseLength=${geminiResult.text.length}`
          );

          // expectedCount を渡して件数チェックを validation 内で実施（Fix #5）
          const validation = validateScriptFullAiResponse(
            geminiResult.text,
            step05Assets.aiSchema,
            fullUseCount
          );

          if (!validation.success) {
            const msg =
              `[STEP_05] schema_validation_failure: ${validation.errors}. ` +
              `rawText head: ${geminiResult.text.slice(0, 200)}`;
            logError(msg);
            await appendAppLog(
              spreadsheetId,
              buildStep05FailureLog(projectId, projectRecordId, "schema_validation_failure", msg)
            );
          } else {
            const matched = matchAiOutputToScenes(validation.scripts, fullScenes, "STEP_05", allowIndexFallback);
            if (!matched) {
              const msg = "[STEP_05] record_id_mismatch: match failed. Aborting Full upsert.";
              logError(msg);
              await appendAppLog(
                spreadsheetId,
                buildStep05FailureLog(projectId, projectRecordId, "record_id_mismatch", msg)
              );
            } else {
              const nowStr = new Date().toISOString();
              let scriptCount = 0;
              let durationTotal = 0;
              let firstUpsertedIdFull = "";

              for (const { ai, scene } of matched) {
                const durationSec = calcDurationSec(ai.narration_tts);
                durationTotal += durationSec;

                const fullRow: ScriptFullRow = {
                  project_id:       projectId,
                  record_id:        scene.record_id,
                  generation_status:"GENERATED",
                  approval_status:  "PENDING",
                  step_id:          "STEP_05_FULL_SCRIPT_BUILD",
                  scene_no:         scene.scene_no,
                  related_version:  "full",
                  duration_sec:     durationSec,
                  narration_draft:  ai.narration_draft,
                  narration_tts:    ai.narration_tts,
                  subtitle_short_1: ai.subtitle_short_1,
                  subtitle_short_2: ai.subtitle_short_2 ?? "",
                  visual_emphasis:  ai.visual_emphasis ?? "",
                  pause_hint:       ai.pause_hint,
                  emotion:          scene.emotion,
                  hook_flag:        "",
                  tts_ready:        "",
                  updated_at:       nowStr,
                  updated_by:       "github_actions",
                  notes:            "",
                };

                const upsertedId = await upsertScriptFull(spreadsheetId, fullRow);
                if (!firstUpsertedIdFull) firstUpsertedIdFull = upsertedId;
                logInfo(`[STEP_05] upserted record_id="${upsertedId}", scene_no="${scene.scene_no}"`);
                scriptCount++;
              }

              const patch: ProjectMinimalPatch = {
                current_step:    "STEP_05_FULL_SCRIPT_BUILD",
                approval_status: "PENDING",
                updated_at:      nowStr,
                updated_by:      "github_actions",
              };
              await updateProjectMinimal(spreadsheetId, projectId, patch);

              const successMsg =
                `STEP_05 completed. model=${geminiResult.modelUsed}, ` +
                `usedFallback=${geminiResult.usedFallback}, ` +
                `script_count=${scriptCount}, duration_sec_total=${durationTotal}`;
              await appendAppLog(
                spreadsheetId,
                buildStep05SuccessLog(projectId, firstUpsertedIdFull || projectRecordId, successMsg)
              );

              logInfo(`[STEP_05] Success. ${successMsg}`);
              fullSuccess = true;
            }
          }
        }
      } catch (e) {
        if (e instanceof GeminiSpendingCapError) {
          logError("[STEP_05] SpendingCapError. Stopping all remaining projects.");
          throw e;
        }
        const msg = `[STEP_05] Unexpected error: ${e instanceof Error ? e.message : String(e)}`;
        logError(msg);
        try {
          await appendAppLog(
            spreadsheetId,
            buildStep05FailureLog(projectId, projectRecordId, "unexpected_error", msg)
          );
        } catch (_) { /* ignore */ }
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // STEP_04 Short Script Build
    // ─────────────────────────────────────────────────────────────────────
    if (runShort) {
      // Fix #1: short+full モードでは Full の成功を前提とする
      if (shortDependsOnFull && !fullSuccess) {
        const msg =
          `[STEP_04] Skipping Short Script Build because Full Script Build failed ` +
          `(video_format="short+full" requires Full success before Short).`;
        logError(msg);
        try {
          await appendAppLog(
            spreadsheetId,
            buildStep04DependencySkippedLog(projectId, projectRecordId, msg)
          );
        } catch (_) { /* ignore */ }
        shortResult = "skipped";
      } else {
        try {
          const shortScenes = allScenes.filter((s) => s.short_use === "Y");
          const shortUseCount = shortScenes.length;

          // Fix #6: short_use=Y が 0 件 → SKIPPED 扱い
          if (shortUseCount === 0) {
            const skipMsg =
              `short_use=Y scenes not found (count=0). ` +
              `Short Script Build skipped (not a failure).`;
            logInfo(`[STEP_04] ${skipMsg}`);
            const currentStepForLog = fullSuccess
              ? "STEP_05_FULL_SCRIPT_BUILD"
              : "STEP_04_SHORT_SCRIPT_BUILD";
            try {
              await appendAppLog(
                spreadsheetId,
                buildStep04ShortSkippedLog(projectId, projectRecordId, currentStepForLog, skipMsg)
              );
            } catch (_) { /* ignore */ }
            shortResult = "skipped";
          } else {
            // Full script 参照（video_format = "short+full" かつ Full 成功済みのみ）
            let fullScripts: ScriptFullReadRow[] = [];
            let hasFullScript = false;

            if (videoFormat === "short+full" && fullSuccess) {
              // Full script をメモリ内フィルタ（batchGet 済みデータを使用、API 呼び出しなし）
              fullScripts = filterFullScriptByProjectId(
                batchData.get("04_Script_Full") ?? [],
                projectId
              );
              hasFullScript = fullScripts.length > 0;
              if (!hasFullScript) {
                // Full rows が 0 件 → Short は Full 参照前提のため dependency failure として skip
                const msg =
                  "[STEP_04] filterFullScriptByProjectId returned 0 rows. " +
                  "Short Script requires Full reference in short+full mode. Skipping.";
                logError(msg);
                try {
                  await appendAppLog(
                    spreadsheetId,
                    buildStep04DependencySkippedLog(projectId, projectRecordId, msg)
                  );
                } catch (_) { /* ignore */ }
                shortResult = "skipped";
              }
            }
            // video_format = "short" → hasFullScript = false（仕様 §4.5）

            if (shortResult === "skipped") {
              // Full 参照不能による dependency skip は上で AppLog 記録済み
            } else {
            logInfo(
              `[STEP_04] Starting Short Script Build. ` +
              `short_use_count=${shortUseCount}, has_full_script=${hasFullScript}`
            );

            if (payload.dry_run) {
              const previewPrompt = buildStep04Prompt(step04Assets, project, shortScenes, fullScripts);
              console.log("[DRY_RUN][STEP_04] Short Script Prompt Preview:");
              console.log("--- PROMPT START ---");
              console.log(previewPrompt.slice(0, 2000));
              console.log("--- PROMPT END (truncated at 2000 chars) ---");
              shortResult = "success";
            } else {
              const prompt = buildStep04Prompt(step04Assets, project, shortScenes, fullScripts);
              const geminiResult = await callGemini(prompt, {
                ...geminiOptionsStep04,
                maxOutputTokens: 32768,
              });

              logInfo(
                `[STEP_04] Gemini responded. model="${geminiResult.modelUsed}", ` +
                `usedFallback=${geminiResult.usedFallback}, ` +
                `responseLength=${geminiResult.text.length}`
              );

              // expectedCount 渡し（Fix #5）
              const validation = validateScriptShortAiResponse(
                geminiResult.text,
                step04Assets.aiSchema,
                shortUseCount
              );

              if (!validation.success) {
                const msg =
                  `[STEP_04] schema_validation_failure: ${validation.errors}. ` +
                  `rawText head: ${geminiResult.text.slice(0, 200)}`;
                logError(msg);
                await appendAppLog(
                  spreadsheetId,
                  buildStep04FailureLog(projectId, projectRecordId, "schema_validation_failure", msg)
                );
                shortResult = "fail";
              } else {
                const matched = matchAiOutputToScenes(validation.scripts, shortScenes, "STEP_04", allowIndexFallback);
                if (!matched) {
                  const msg = "[STEP_04] record_id_mismatch: match failed. Aborting Short upsert.";
                  logError(msg);
                  await appendAppLog(
                    spreadsheetId,
                    buildStep04FailureLog(projectId, projectRecordId, "record_id_mismatch", msg)
                  );
                  shortResult = "fail";
                } else {
                  const nowStr = new Date().toISOString();
                  let scriptCount = 0;
                  let firstUpsertedIdShort = "";

                  for (const { ai, scene } of matched) {
                    const durationSec = calcDurationSec(ai.narration_tts);

                    const shortRow: ScriptShortRow = {
                      project_id:       projectId,
                      record_id:        scene.record_id,
                      generation_status:"GENERATED",
                      approval_status:  "PENDING",
                      step_id:          "STEP_04_SHORT_SCRIPT_BUILD",
                      scene_no:         scene.scene_no,
                      related_version:  "short",
                      duration_sec:     durationSec,
                      narration_draft:  ai.narration_draft,
                      narration_tts:    ai.narration_tts,
                      subtitle_short_1: ai.subtitle_short_1,
                      subtitle_short_2: ai.subtitle_short_2 ?? "",
                      emphasis_word:    ai.emphasis_word ?? "",
                      transition_note:  ai.transition_note,
                      emotion:          scene.emotion,
                      hook_flag:        "",
                      tts_ready:        "",
                      updated_at:       nowStr,
                      updated_by:       "github_actions",
                      notes:            "",
                    };

                    const upsertedId = await upsertScriptShort(spreadsheetId, shortRow);
                    if (!firstUpsertedIdShort) firstUpsertedIdShort = upsertedId;
                    logInfo(`[STEP_04] upserted record_id="${upsertedId}", scene_no="${scene.scene_no}"`);
                    scriptCount++;
                  }

                  // current_step: Full+Short 両方成功なら COMBINED、Short のみなら SHORT
                  const currentStepShort = fullSuccess
                    ? "STEP_04_05_COMBINED"
                    : "STEP_04_SHORT_SCRIPT_BUILD";

                  const patch: ProjectMinimalPatch = {
                    current_step:    currentStepShort,
                    approval_status: "PENDING",
                    updated_at:      nowStr,
                    updated_by:      "github_actions",
                  };
                  await updateProjectMinimal(spreadsheetId, projectId, patch);

                  const successMsg =
                    `STEP_04 completed. model=${geminiResult.modelUsed}, ` +
                    `usedFallback=${geminiResult.usedFallback}, ` +
                    `script_count=${scriptCount}, has_full_script=${hasFullScript}`;
                  await appendAppLog(
                    spreadsheetId,
                    buildStep04SuccessLog(projectId, firstUpsertedIdShort || projectRecordId, successMsg)
                  );

                  logInfo(`[STEP_04] Success. ${successMsg}`);
                  shortResult = "success";
                }
              }
            }
            } // closes: if (shortResult === "skipped") else
          }
        } catch (e) {
          if (e instanceof GeminiSpendingCapError) {
            logError("[STEP_04] SpendingCapError. Stopping all remaining projects.");
            throw e;
          }
          const msg = `[STEP_04] Unexpected error: ${e instanceof Error ? e.message : String(e)}`;
          logError(msg);
          try {
            await appendAppLog(
              spreadsheetId,
              buildStep04FailureLog(projectId, projectRecordId, "unexpected_error", msg)
            );
          } catch (_) { /* ignore */ }
          shortResult = "fail";
        }
      }
    }

    // ─── partial success / 完了後処理 ─────────────────────────────────────
    if (runFull && runShort) {
      // Fix #1 反映: short+full モードの partial success パターン整理
      if (fullSuccess && shortResult === "success") {
        logInfo(`[STEP_04_05] Both Full and Short completed. current_step=STEP_04_05_COMBINED`);
        // current_step は STEP_04 の updateProjectMinimal で STEP_04_05_COMBINED 設定済み
      } else if (fullSuccess && shortResult === "fail") {
        logInfo(`[STEP_04_05] Partial: Full=success, Short=fail. current_step=STEP_05_FULL_SCRIPT_BUILD`);
        try {
          await appendAppLog(
            spreadsheetId,
            buildStep04_05PartialSuccessLog(
              projectId, projectRecordId,
              "STEP_05_FULL_SCRIPT_BUILD",
              "success", "fail"
            )
          );
        } catch (_) { /* ignore */ }
      } else if (fullSuccess && shortResult === "skipped") {
        logInfo(`[STEP_04_05] Short skipped (short_use=0 or dependency). current_step=STEP_05_FULL_SCRIPT_BUILD`);
        // dependency skip の場合は buildStep04DependencySkippedLog で既に記録済み
        // short_use=0 skip の場合は buildStep04ShortSkippedLog で既に記録済み
      } else if (!fullSuccess && shortResult === "skipped") {
        // Fix #1: short+full で Full 失敗 → Short 未実行
        logError(`[STEP_04_05] Full failed. Short not executed (dependency_failure). current_step not updated.`);
        // buildStep04DependencySkippedLog で既に記録済み
      } else {
        logError(`[STEP_04_05] Both Full and Short failed/skipped. current_step not updated.`);
      }
    }

    logInfo(`STEP_04_05 finished for project: ${projectId}`);
  }

  logInfo("STEP_04_05 Script Build completed for all projects.");
}
