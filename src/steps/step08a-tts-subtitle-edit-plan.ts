/**
 * step08a-tts-subtitle-edit-plan.ts
 *
 * STEP_08A TTS Subtitle & Edit Plan Build のオーケストレーター。
 *
 * ─── 処理概要 ──────────────────────────────────────────────────────────────────
 *
 * 1. RuntimeConfig を取得
 * 2. Step08aAssets を読み込む
 * 3. 各 project_id に対して:
 *    a. 00_Project から ProjectRow を取得
 *    b. video_format を検証（"full" | "short" | "short+full"）
 *    c. Full: 04_Script_Full から Script を取得 → Gemini → TTS/EditPlan upsert
 *    d. Short: 03_Script_Short から Script を取得 → Gemini → TTS/EditPlan upsert
 *    e. 00_Project を更新（current_step = STEP_08A_TTS_SUBTITLE）
 *    f. 100_App_Logs にログ記録
 *
 * ─── 複合キー ──────────────────────────────────────────────────────────────────
 * - 08_TTS_Subtitles upsert キー: record_id + related_version
 * - 09_Edit_Plan upsert キー: record_id + related_version
 * - 再実行時は同一キーの行を上書きする（DELETE 禁止）
 */

import type {
  WorkflowPayload,
  ProjectMinimalPatch,
  TtsSubtitleRow,
  EditPlanRow,
  TtsSubtitleVersion,
} from "../types.js";
import { loadRuntimeConfig } from "../lib/load-runtime-config.js";
import { readProjectsByIds } from "../lib/load-project-input.js";
import { loadStep08aAssets } from "../lib/load-assets.js";
import { loadFullScriptByProjectId, loadShortScriptByProjectId } from "../lib/load-script.js";
import { upsertTtsSubtitle } from "../lib/write-tts-subtitles.js";
import { upsertEditPlan } from "../lib/write-edit-plan.js";
import { buildStep08aFullPrompt, buildStep08aShortPrompt } from "../lib/build-prompt.js";
import {
  callGemini,
  buildGeminiOptionsStep08a,
  GeminiSpendingCapError,
} from "../lib/call-gemini.js";
import { validateTtsSubtitleAiResponse } from "../lib/validate-json.js";
import { updateProjectMinimal } from "../lib/update-project.js";
import {
  appendAppLog,
  buildStep08aSuccessLog,
  buildStep08aFailureLog,
} from "../lib/write-app-log.js";
import { logInfo, logError } from "../lib/logger.js";

// ─── 戻り値型 ─────────────────────────────────────────────────────────────────

/** 1 project の STEP_08A 処理結果 */
export interface Step08aResult {
  projectId:     string;
  successCount:  number;   // upsert 成功行数（Full + Short 合計）
  failCount:     number;   // upsert 失敗行数（Full + Short 合計）
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function runStep08aTtsSubtitleEditPlan(
  payload: WorkflowPayload,
  spreadsheetId: string
): Promise<Step08aResult[]> {
  logInfo("[STEP_08A] TTS Subtitle & Edit Plan Build start");

  const configMap     = await loadRuntimeConfig(spreadsheetId);
  const geminiOptions = buildGeminiOptionsStep08a(configMap);
  const step08aAssets = loadStep08aAssets();

  const results: Step08aResult[] = [];

  for (const projectId of payload.project_ids) {
    logInfo(`[STEP_08A] Processing project: ${projectId}`);

    let projectRecordId   = "";
    let videoFormat       = "";
    let atLeastOneSuccess = false;
    let totalSuccess      = 0;
    let totalFail         = 0;

    try {
      // ── プロジェクト取得 ──────────────────────────────────────────────────────
      const projects = await readProjectsByIds(spreadsheetId, [projectId]);
      const project  = projects[0];
      if (!project) {
        const msg = `[STEP_08A] project not found: ${projectId}`;
        logError(msg);
        try {
          await appendAppLog(spreadsheetId,
            buildStep08aFailureLog(projectId, "", "project_not_found", msg));
        } catch (_) {}
        continue;
      }
      projectRecordId = project.record_id;
      videoFormat     = (project.video_format ?? "").trim().toLowerCase();

      // ── video_format 検証 ────────────────────────────────────────────────────
      if (!["full", "short", "short+full"].includes(videoFormat)) {
        const msg = `[STEP_08A] Invalid video_format: "${videoFormat}" for project ${projectId}`;
        logError(msg);
        try {
          await appendAppLog(spreadsheetId,
            buildStep08aFailureLog(projectId, projectRecordId, "invalid_video_format", msg));
        } catch (_) {}
        continue;
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Full TTS Subtitle Build（video_format = "full" or "short+full"）
      // ─────────────────────────────────────────────────────────────────────────
      let fullBuildSuccess = false;
      if (videoFormat === "full" || videoFormat === "short+full") {
        const fullScripts = await loadFullScriptByProjectId(spreadsheetId, projectId);

        if (fullScripts.length === 0) {
          const msg = `[STEP_08A] No GENERATED full scripts found for project ${projectId}`;
          logError(msg);
          try {
            await appendAppLog(spreadsheetId,
              buildStep08aFailureLog(projectId, projectRecordId, "no_full_scripts", msg));
          } catch (_) {}
          // short+full: Full 失敗 → Short もスキップ
          if (videoFormat === "short+full") {
            try {
              await appendAppLog(spreadsheetId,
                buildStep08aFailureLog(projectId, projectRecordId, "short_skipped_due_to_full_failure",
                  `[STEP_08A] Short skipped: Full failed (no_full_scripts) for ${projectId}`));
            } catch (_) {}
            continue;
          }
        } else {
          // プロンプト組み立て・Gemini 呼び出し
          const fullPrompt = buildStep08aFullPrompt(step08aAssets, project, fullScripts);
          logInfo(`[STEP_08A] Calling Gemini (Full) for ${projectId} (${fullScripts.length} scenes)`);

          let fullGeminiResult: Awaited<ReturnType<typeof callGemini>> | null = null;
          try {
            fullGeminiResult = await callGemini(fullPrompt, {
              ...geminiOptions,
              maxOutputTokens: 16384,
              timeoutMs: 300_000,
            });
            logInfo(`[STEP_08A] Gemini (Full) responded. modelUsed=${fullGeminiResult.modelUsed}`);
          } catch (geminiErr) {
            if (geminiErr instanceof GeminiSpendingCapError) throw geminiErr;
            const msg =
              `[STEP_08A] Gemini call failed (Full) for ${projectId}: ` +
              (geminiErr instanceof Error ? geminiErr.message : String(geminiErr));
            logError(msg);
            try {
              await appendAppLog(spreadsheetId,
                buildStep08aFailureLog(projectId, projectRecordId, "gemini_call_failed", msg));
            } catch (_) {}
            if (videoFormat === "short+full") {
              try {
                await appendAppLog(spreadsheetId,
                  buildStep08aFailureLog(projectId, projectRecordId, "short_skipped_due_to_full_failure",
                    `Short skipped: Full Gemini call failed for ${projectId}`));
              } catch (_) {}
              continue;
            }
          }

          if (fullGeminiResult) {
            const validation = validateTtsSubtitleAiResponse(fullGeminiResult.text, step08aAssets.aiSchema);
            if (!validation.success) {
              const msg = `[STEP_08A] Schema validation failed (Full) for ${projectId}: ${validation.errors}`;
              logError(msg);
              try {
                await appendAppLog(spreadsheetId,
                  buildStep08aFailureLog(projectId, projectRecordId, "schema_validation_failed", msg));
              } catch (_) {}
              if (videoFormat === "short+full") {
                try {
                  await appendAppLog(spreadsheetId,
                    buildStep08aFailureLog(projectId, projectRecordId, "short_skipped_due_to_full_failure",
                      `Short skipped: Full validation failed for ${projectId}`));
                } catch (_) {}
                continue;
              }
            } else {
              // TTS / EditPlan を upsert
              const now     = new Date().toISOString();
              const version: TtsSubtitleVersion = "full";
              let successCount = 0;
              let failCount    = 0;

              for (const ttsAi of validation.ttsSubtitles) {
                const sceneRecordId = ttsAi.scene_record_id;
                // 対応する script から scene_no を取得（見つからなければ ""）
                const matchedScript = fullScripts.find((s) => s.record_id === sceneRecordId);

                const ttsRow: TtsSubtitleRow = {
                  project_id:        projectId,
                  record_id:         sceneRecordId,
                  generation_status: "GENERATED",
                  approval_status:   "PENDING",
                  step_id:           "STEP_08A_TTS_SUBTITLE",
                  scene_no:          (matchedScript as unknown as Record<string, string>)?.["scene_no"] ?? "",
                  line_no:           1,
                  related_version:   version,
                  tts_text:          ttsAi.tts_text,
                  voice_style:       ttsAi.voice_style,
                  speech_rate:       ttsAi.speech_rate,
                  pitch_hint:        ttsAi.pitch_hint,
                  emotion_hint:      ttsAi.emotion_hint,
                  audio_file:        "",
                  subtitle_text:     ttsAi.subtitle_text,
                  subtitle_text_alt: ttsAi.subtitle_text_alt,
                  tc_in:             "",
                  tc_out:            "",
                  subtitle_style:    ttsAi.subtitle_style,
                  reading_check:     "",
                  lip_sync_note:     "",
                  updated_at:        now,
                  updated_by:        "github_actions",
                  notes:             "",
                };

                if (payload.dry_run) {
                  logInfo(`[STEP_08A][DRY_RUN] Would upsert TTS (Full): ${sceneRecordId}`);
                  successCount++;
                  continue;
                }

                try {
                  await upsertTtsSubtitle(spreadsheetId, ttsRow);
                  logInfo(`[STEP_08A] Upserted TTS (Full): ${sceneRecordId}`);
                  successCount++;
                } catch (upsertErr) {
                  const msg =
                    `[STEP_08A] upsertTtsSubtitle failed (Full) for ${sceneRecordId}: ` +
                    (upsertErr instanceof Error ? upsertErr.message : String(upsertErr));
                  logError(msg);
                  try {
                    await appendAppLog(spreadsheetId,
                      buildStep08aFailureLog(projectId, sceneRecordId, "upsert_failed", msg));
                  } catch (_) {}
                  failCount++;
                }
              }

              for (const epAi of validation.editPlan) {
                const sceneRecordId = epAi.scene_record_id;
                const matchedScript = fullScripts.find((s) => s.record_id === sceneRecordId);

                const epRow: EditPlanRow = {
                  project_id:        projectId,
                  record_id:         sceneRecordId,
                  generation_status: "GENERATED",
                  approval_status:   "PENDING",
                  step_id:           "STEP_08A_TTS_SUBTITLE",
                  scene_no:          (matchedScript as unknown as Record<string, string>)?.["scene_no"] ?? "",
                  related_version:   version,
                  asset_image:       "",
                  asset_audio:       "",
                  duration_sec:      epAi.duration_sec,
                  camera_motion:     epAi.camera_motion,
                  transition_in:     epAi.transition_in,
                  transition_out:    epAi.transition_out,
                  bgm_section:       epAi.bgm_section,
                  sfx:               epAi.sfx,
                  subtitle_on:       epAi.subtitle_on,
                  text_overlay_on:   epAi.text_overlay_on,
                  qa_insert_after:   epAi.qa_insert_after,
                  note:              "",
                  updated_at:        now,
                  updated_by:        "github_actions",
                  notes:             "",
                };

                if (payload.dry_run) {
                  logInfo(`[STEP_08A][DRY_RUN] Would upsert EditPlan (Full): ${sceneRecordId}`);
                  continue;
                }

                try {
                  await upsertEditPlan(spreadsheetId, epRow);
                  logInfo(`[STEP_08A] Upserted EditPlan (Full): ${sceneRecordId}`);
                } catch (upsertErr) {
                  const msg =
                    `[STEP_08A] upsertEditPlan failed (Full) for ${sceneRecordId}: ` +
                    (upsertErr instanceof Error ? upsertErr.message : String(upsertErr));
                  logError(msg);
                  try {
                    await appendAppLog(spreadsheetId,
                      buildStep08aFailureLog(projectId, sceneRecordId, "upsert_failed", msg));
                  } catch (_) {}
                  failCount++;
                }
              }

              totalSuccess += successCount;
              totalFail   += failCount;

              const summary =
                `Full TTS complete: success=${successCount}, fail=${failCount}, project=${projectId}`;
              logInfo(`[STEP_08A] ${summary}`);
              try {
                if (failCount > 0 && successCount === 0) {
                  await appendAppLog(spreadsheetId,
                    buildStep08aFailureLog(projectId, projectRecordId, "all_upsert_failed", summary));
                } else {
                  await appendAppLog(spreadsheetId,
                    buildStep08aSuccessLog(projectId, projectRecordId, summary));
                  fullBuildSuccess = true;
                  atLeastOneSuccess = true;
                }
              } catch (_) {}
            }
          }
        }
      }

      // short+full の場合、Full が失敗していたら Short はスキップ
      if (videoFormat === "short+full" && !fullBuildSuccess) {
        logError(`[STEP_08A] Skipping Short build: Full build was not successful for ${projectId}`);
        continue;
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Short TTS Subtitle Build（video_format = "short" or "short+full"）
      // ─────────────────────────────────────────────────────────────────────────
      if (videoFormat === "short" || videoFormat === "short+full") {
        const shortScripts = await loadShortScriptByProjectId(spreadsheetId, projectId);

        if (shortScripts.length === 0) {
          const msg = `[STEP_08A] No GENERATED short scripts found for project ${projectId}`;
          logError(msg);
          try {
            await appendAppLog(spreadsheetId,
              buildStep08aFailureLog(projectId, projectRecordId, "no_short_scripts", msg));
          } catch (_) {}
        } else {
          const shortPrompt = buildStep08aShortPrompt(step08aAssets, project, shortScripts);
          logInfo(`[STEP_08A] Calling Gemini (Short) for ${projectId} (${shortScripts.length} scenes)`);

          let shortGeminiResult: Awaited<ReturnType<typeof callGemini>> | null = null;
          try {
            shortGeminiResult = await callGemini(shortPrompt, {
              ...geminiOptions,
              maxOutputTokens: 16384,
              timeoutMs: 300_000,
            });
            logInfo(`[STEP_08A] Gemini (Short) responded. modelUsed=${shortGeminiResult.modelUsed}`);
          } catch (geminiErr) {
            if (geminiErr instanceof GeminiSpendingCapError) throw geminiErr;
            const msg =
              `[STEP_08A] Gemini call failed (Short) for ${projectId}: ` +
              (geminiErr instanceof Error ? geminiErr.message : String(geminiErr));
            logError(msg);
            try {
              await appendAppLog(spreadsheetId,
                buildStep08aFailureLog(projectId, projectRecordId, "gemini_call_failed", msg));
            } catch (_) {}
          }

          if (shortGeminiResult) {
            const validation = validateTtsSubtitleAiResponse(shortGeminiResult.text, step08aAssets.aiSchema);
            if (!validation.success) {
              const msg = `[STEP_08A] Schema validation failed (Short) for ${projectId}: ${validation.errors}`;
              logError(msg);
              try {
                await appendAppLog(spreadsheetId,
                  buildStep08aFailureLog(projectId, projectRecordId, "schema_validation_failed", msg));
              } catch (_) {}
            } else {
              const now     = new Date().toISOString();
              const version: TtsSubtitleVersion = "short";
              let successCount = 0;
              let failCount    = 0;

              for (const ttsAi of validation.ttsSubtitles) {
                const sceneRecordId = ttsAi.scene_record_id;
                const matchedScript = shortScripts.find((s) => s.record_id === sceneRecordId);

                const ttsRow: TtsSubtitleRow = {
                  project_id:        projectId,
                  record_id:         sceneRecordId,
                  generation_status: "GENERATED",
                  approval_status:   "PENDING",
                  step_id:           "STEP_08A_TTS_SUBTITLE",
                  scene_no:          (matchedScript as unknown as Record<string, string>)?.["scene_no"] ?? "",
                  line_no:           1,
                  related_version:   version,
                  tts_text:          ttsAi.tts_text,
                  voice_style:       ttsAi.voice_style,
                  speech_rate:       ttsAi.speech_rate,
                  pitch_hint:        ttsAi.pitch_hint,
                  emotion_hint:      ttsAi.emotion_hint,
                  audio_file:        "",
                  subtitle_text:     ttsAi.subtitle_text,
                  subtitle_text_alt: ttsAi.subtitle_text_alt,
                  tc_in:             "",
                  tc_out:            "",
                  subtitle_style:    ttsAi.subtitle_style,
                  reading_check:     "",
                  lip_sync_note:     "",
                  updated_at:        now,
                  updated_by:        "github_actions",
                  notes:             "",
                };

                if (payload.dry_run) {
                  logInfo(`[STEP_08A][DRY_RUN] Would upsert TTS (Short): ${sceneRecordId}`);
                  successCount++;
                  continue;
                }

                try {
                  await upsertTtsSubtitle(spreadsheetId, ttsRow);
                  logInfo(`[STEP_08A] Upserted TTS (Short): ${sceneRecordId}`);
                  successCount++;
                } catch (upsertErr) {
                  const msg =
                    `[STEP_08A] upsertTtsSubtitle failed (Short) for ${sceneRecordId}: ` +
                    (upsertErr instanceof Error ? upsertErr.message : String(upsertErr));
                  logError(msg);
                  try {
                    await appendAppLog(spreadsheetId,
                      buildStep08aFailureLog(projectId, sceneRecordId, "upsert_failed", msg));
                  } catch (_) {}
                  failCount++;
                }
              }

              for (const epAi of validation.editPlan) {
                const sceneRecordId = epAi.scene_record_id;
                const matchedScript = shortScripts.find((s) => s.record_id === sceneRecordId);

                const epRow: EditPlanRow = {
                  project_id:        projectId,
                  record_id:         sceneRecordId,
                  generation_status: "GENERATED",
                  approval_status:   "PENDING",
                  step_id:           "STEP_08A_TTS_SUBTITLE",
                  scene_no:          (matchedScript as unknown as Record<string, string>)?.["scene_no"] ?? "",
                  related_version:   version,
                  asset_image:       "",
                  asset_audio:       "",
                  duration_sec:      epAi.duration_sec,
                  camera_motion:     epAi.camera_motion,
                  transition_in:     epAi.transition_in,
                  transition_out:    epAi.transition_out,
                  bgm_section:       epAi.bgm_section,
                  sfx:               epAi.sfx,
                  subtitle_on:       epAi.subtitle_on,
                  text_overlay_on:   epAi.text_overlay_on,
                  qa_insert_after:   epAi.qa_insert_after,
                  note:              "",
                  updated_at:        now,
                  updated_by:        "github_actions",
                  notes:             "",
                };

                if (payload.dry_run) {
                  logInfo(`[STEP_08A][DRY_RUN] Would upsert EditPlan (Short): ${sceneRecordId}`);
                  continue;
                }

                try {
                  await upsertEditPlan(spreadsheetId, epRow);
                  logInfo(`[STEP_08A] Upserted EditPlan (Short): ${sceneRecordId}`);
                } catch (upsertErr) {
                  const msg =
                    `[STEP_08A] upsertEditPlan failed (Short) for ${sceneRecordId}: ` +
                    (upsertErr instanceof Error ? upsertErr.message : String(upsertErr));
                  logError(msg);
                  try {
                    await appendAppLog(spreadsheetId,
                      buildStep08aFailureLog(projectId, sceneRecordId, "upsert_failed", msg));
                  } catch (_) {}
                  failCount++;
                }
              }

              totalSuccess += successCount;
              totalFail   += failCount;

              const summary =
                `Short TTS complete: success=${successCount}, fail=${failCount}, project=${projectId}`;
              logInfo(`[STEP_08A] ${summary}`);
              try {
                if (failCount > 0 && successCount === 0) {
                  await appendAppLog(spreadsheetId,
                    buildStep08aFailureLog(projectId, projectRecordId, "all_upsert_failed", summary));
                } else {
                  await appendAppLog(spreadsheetId,
                    buildStep08aSuccessLog(projectId, projectRecordId, summary));
                  atLeastOneSuccess = true;
                }
              } catch (_) {}
            }
          }
        }
      }

      // ── 00_Project 最小更新 ──────────────────────────────────────────────────
      if (atLeastOneSuccess && !payload.dry_run) {
        const patch: ProjectMinimalPatch = {
          current_step:    "STEP_08A_TTS_SUBTITLE",
          approval_status: "PENDING",
          updated_at:      new Date().toISOString(),
          updated_by:      "github_actions",
        };
        try {
          await updateProjectMinimal(spreadsheetId, projectId, patch);
        } catch (updateErr) {
          logError(
            `[STEP_08A] updateProjectMinimal failed for ${projectId}: ` +
            (updateErr instanceof Error ? updateErr.message : String(updateErr))
          );
        }
      }
    } catch (err) {
      if (err instanceof GeminiSpendingCapError) throw err;
      const msg =
        `[STEP_08A] Unexpected error for project ${projectId}: ` +
        (err instanceof Error ? err.message : String(err));
      logError(msg);
      try {
        await appendAppLog(spreadsheetId,
          buildStep08aFailureLog(projectId, projectRecordId, "unexpected_error", msg));
      } catch (_) {}
      totalFail++;
    }

    results.push({ projectId, successCount: totalSuccess, failCount: totalFail });
  }

  logInfo("[STEP_08A] TTS Subtitle & Edit Plan Build finished.");
  return results;
}
