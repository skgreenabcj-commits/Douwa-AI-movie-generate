/**
 * step08b-tts-audio-generate.ts
 *
 * STEP_08B TTS Audio Generate のオーケストレーター。
 *
 * ─── 処理概要 ──────────────────────────────────────────────────────────────────
 *
 * 1. RuntimeConfig を取得
 * 2. 各 project_id に対して:
 *    a. 00_Project から ProjectRow を取得
 *    b. video_format を検証（"full" | "short" | "short+full"）
 *    c. 08_TTS_Subtitles から audio_file="" の未生成行を取得
 *    d. 各 TTS 行に対して:
 *       - Cloud TTS API で MP3 を生成
 *       - 再生時間を推定、tc_out を計算
 *       - Google Drive に MP3 をアップロード
 *       - 08_TTS_Subtitles を patchTtsAudio で更新
 *       - 09_Edit_Plan を patchEditPlanAudio で更新
 *       - 100_App_Logs に成功/失敗ログ記録
 *    e. 00_Project を更新（current_step = STEP_08B_TTS_AUDIO）
 */

import type {
  WorkflowPayload,
  ProjectMinimalPatch,
  TtsAudioPatch,
  EditPlanAudioPatch,
} from "../types.js";
import { loadRuntimeConfig, getConfigValue } from "../lib/load-runtime-config.js";
import { readProjectsByIds } from "../lib/load-project-input.js";
import { loadTtsSubtitlesByProjectId } from "../lib/load-tts-subtitles.js";
import { patchTtsAudio } from "../lib/write-tts-subtitles.js";
import { patchEditPlanAudio } from "../lib/write-edit-plan.js";
import {
  generateTtsAudio,
  estimateMp3DurationSec,
  formatTcOut,
} from "../lib/generate-tts-audio.js";
import { uploadAudioToDrive, ensurePjtFolder } from "../lib/upload-to-drive.js";
import { updateProjectMinimal } from "../lib/update-project.js";
import {
  appendAppLog,
  buildStep08bSuccessLog,
  buildStep08bFailureLog,
} from "../lib/write-app-log.js";
import { logInfo, logError } from "../lib/logger.js";

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function runStep08bTtsAudioGenerate(
  payload: WorkflowPayload,
  spreadsheetId: string
): Promise<void> {
  logInfo("[STEP_08B] TTS Audio Generate start");

  const configMap = await loadRuntimeConfig(spreadsheetId);

  for (const projectId of payload.project_ids) {
    logInfo(`[STEP_08B] Processing project: ${projectId}`);

    let projectRecordId   = "";
    let atLeastOneSuccess = false;

    try {
      // ── プロジェクト取得 ──────────────────────────────────────────────────────
      const projects = await readProjectsByIds(spreadsheetId, [projectId]);
      const project  = projects[0];
      if (!project) {
        const msg = `[STEP_08B] project not found: ${projectId}`;
        logError(msg);
        try {
          await appendAppLog(spreadsheetId,
            buildStep08bFailureLog(projectId, "", "project_not_found", msg));
        } catch (_) {}
        continue;
      }
      projectRecordId = project.record_id;
      const videoFormat = (project.video_format ?? "").trim().toLowerCase();

      if (!["full", "short", "short+full"].includes(videoFormat)) {
        const msg = `[STEP_08B] Invalid video_format: "${videoFormat}" for project ${projectId}`;
        logError(msg);
        try {
          await appendAppLog(spreadsheetId,
            buildStep08bFailureLog(projectId, projectRecordId, "invalid_video_format", msg));
        } catch (_) {}
        continue;
      }

      // ── Drive フォルダ ID の取得（STEP_07 と同一親フォルダ下の PJT-### フォルダを使用）───
      const parentFolderId = getConfigValue(configMap, "google_drive_folder_id", "");
      if (!parentFolderId) {
        const msg = `[STEP_08B] google_drive_folder_id is not configured in RuntimeConfig`;
        logError(msg);
        try {
          await appendAppLog(spreadsheetId,
            buildStep08bFailureLog(projectId, projectRecordId, "config_missing", msg));
        } catch (_) {}
        continue;
      }

      let driveFolderId: string;
      try {
        driveFolderId = await ensurePjtFolder(parentFolderId, projectId);
        logInfo(`[STEP_08B] Drive folder ready: ${driveFolderId} (project: ${projectId})`);
      } catch (folderErr) {
        const msg =
          `[STEP_08B] ensurePjtFolder failed for project ${projectId}: ` +
          (folderErr instanceof Error ? folderErr.message : String(folderErr));
        logError(msg);
        try {
          await appendAppLog(spreadsheetId,
            buildStep08bFailureLog(projectId, projectRecordId, "drive_folder_error", msg));
        } catch (_) {}
        continue;
      }

      // ── 未生成 TTS 行の取得（audio_file = "" のもの） ───────────────────────
      const allTtsRows = await loadTtsSubtitlesByProjectId(spreadsheetId, projectId);
      const unprocessedRows = allTtsRows.filter((r) => (r.audio_file ?? "").trim() === "");

      if (unprocessedRows.length === 0) {
        logInfo(`[STEP_08B] No unprocessed TTS rows for project ${projectId}. Skipping.`);
        continue;
      }

      logInfo(`[STEP_08B] ${unprocessedRows.length} unprocessed TTS rows for ${projectId}`);

      // ── 各 TTS 行に対して音声生成 ────────────────────────────────────────────
      for (const ttsRow of unprocessedRows) {
        const recordId       = ttsRow.record_id;
        const relatedVersion = ttsRow.related_version;

        logInfo(`[STEP_08B] Generating TTS audio for ${recordId} (${relatedVersion})`);

        if (payload.dry_run) {
          logInfo(`[STEP_08B][DRY_RUN] Would generate audio for ${recordId}_${relatedVersion}`);
          logInfo(`  tts_text length: ${ttsRow.tts_text.length}, speech_rate: ${ttsRow.speech_rate}`);
          atLeastOneSuccess = true;
          continue;
        }

        try {
          // TTS API 呼び出し
          const mp3Buffer = await generateTtsAudio(
            ttsRow.tts_text,
            ttsRow.speech_rate,
            configMap
          );
          logInfo(`[STEP_08B] TTS generated: ${recordId} (${mp3Buffer.length} bytes)`);

          // 再生時間推定・タイムコード計算
          const durationSec = estimateMp3DurationSec(mp3Buffer);
          const tcOut       = formatTcOut(durationSec);
          const tcIn        = "0:00.000";

          // ファイル名: "{record_id}_{relatedVersion}_{YYYYMMDD}.mp3"
          const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
          const fileName = `${recordId}_${relatedVersion}_${datePart}.mp3`;

          // Drive アップロード
          const driveUrl = await uploadAudioToDrive(driveFolderId, fileName, mp3Buffer);
          logInfo(`[STEP_08B] Uploaded to Drive: ${driveUrl}`);

          const now = new Date().toISOString();

          // 08_TTS_Subtitles を更新
          const ttsPatch: TtsAudioPatch = {
            record_id:       recordId,
            related_version: relatedVersion,
            audio_file:      driveUrl,
            tc_in:           tcIn,
            tc_out:          tcOut,
            updated_at:      now,
            updated_by:      "github_actions",
          };
          await patchTtsAudio(spreadsheetId, ttsPatch);
          logInfo(`[STEP_08B] patchTtsAudio done: ${recordId} (${relatedVersion})`);

          // 09_Edit_Plan を更新
          const epPatch: EditPlanAudioPatch = {
            record_id:       recordId,
            related_version: relatedVersion,
            asset_audio:     driveUrl,
            duration_sec:    durationSec,
            updated_at:      now,
            updated_by:      "github_actions",
          };
          await patchEditPlanAudio(spreadsheetId, epPatch);
          logInfo(`[STEP_08B] patchEditPlanAudio done: ${recordId} (${relatedVersion})`);

          // 成功ログ
          const successMsg =
            `TTS audio generated: ${recordId} (${relatedVersion}), duration=${tcOut}, url=${driveUrl}`;
          try {
            await appendAppLog(spreadsheetId,
              buildStep08bSuccessLog(projectId, recordId, successMsg));
          } catch (_) {}
          atLeastOneSuccess = true;

        } catch (rowErr) {
          const msg =
            `[STEP_08B] Failed to process TTS row ${recordId} (${relatedVersion}): ` +
            (rowErr instanceof Error ? rowErr.message : String(rowErr));
          logError(msg);
          try {
            await appendAppLog(spreadsheetId,
              buildStep08bFailureLog(projectId, recordId, "tts_generation_failed", msg));
          } catch (_) {}
          // 個別行のエラーは継続（部分成功を許容）
        }
      }

      // ── 00_Project 最小更新 ────────────────────────────────────────────────
      if (atLeastOneSuccess && !payload.dry_run) {
        const patch: ProjectMinimalPatch = {
          current_step:    "STEP_08B_TTS_AUDIO",
          approval_status: "PENDING",
          updated_at:      new Date().toISOString(),
          updated_by:      "github_actions",
        };
        try {
          await updateProjectMinimal(spreadsheetId, projectId, patch);
        } catch (updateErr) {
          logError(
            `[STEP_08B] updateProjectMinimal failed for ${projectId}: ` +
            (updateErr instanceof Error ? updateErr.message : String(updateErr))
          );
        }
      }

    } catch (err) {
      const msg =
        `[STEP_08B] Unexpected error for project ${projectId}: ` +
        (err instanceof Error ? err.message : String(err));
      logError(msg);
      try {
        await appendAppLog(spreadsheetId,
          buildStep08bFailureLog(projectId, projectRecordId, "unexpected_error", msg));
      } catch (_) {}
    }
  }

  logInfo("[STEP_08B] TTS Audio Generate finished.");
}
