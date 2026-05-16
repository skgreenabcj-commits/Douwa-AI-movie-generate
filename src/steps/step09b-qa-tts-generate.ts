/**
 * step09b-qa-tts-generate.ts
 *
 * STEP_09B Q&A TTS Audio Generate のオーケストレーター。
 *
 * ─── 処理概要 ──────────────────────────────────────────────────────────────────
 *
 * 1. RuntimeConfig を取得
 * 2. 各 project_id に対して:
 *    a. 00_Project から ProjectRow を取得
 *    b. 10_QA から question_tts_file = "" の未生成行を取得
 *    c. 各 QA 行に対して:
 *       - question_tts SSML → Cloud TTS API → MP3 生成 → Drive アップロード
 *       - answer_announcement_tts SSML → Cloud TTS API → MP3 生成 → Drive アップロード
 *       - 10_QA の question_tts_file / answer_tts_file を patchQaTtsFiles で更新
 *       - 100_App_Logs に成功/失敗ログ記録
 *    d. 00_Project を更新（current_step = STEP_09B_QA_TTS）
 *
 * ─── 音声設定 ─────────────────────────────────────────────────────────────────
 *
 * 音声モデル: 94_Runtime_Config の `tts_qa_voice_name`（デフォルト: ja-JP-Chirp3-HD-Kore）
 * ピッチ    : `tts_qa_pitch_st`（数値のみ格納 → parsePitchSt() で "+1st" 形式に変換）
 * SSML 形式 : question_tts / answer_announcement_tts はいずれも
 *             <speak><prosody rate="1.0">…</prosody></speak> 形式
 *
 * ─── ファイル命名規則 ─────────────────────────────────────────────────────────
 *
 * 問題音声: {record_id}_q.mp3  （例: PJT-001-QA-001_q.mp3）
 * 正解音声: {record_id}_a.mp3  （例: PJT-001-QA-001_a.mp3）
 * Drive 保存先: {google_drive_folder_id}/{project_id}/ フォルダ
 */

import type {
  WorkflowPayload,
  ProjectMinimalPatch,
  QaTtsFilePatch,
} from "../types.js";
import { loadRuntimeConfig, getConfigValue } from "../lib/load-runtime-config.js";
import { readProjectsByIds } from "../lib/load-project-input.js";
import {
  loadQaTtsTargetsByProjectId,
  loadQaRetakeTtsTargetsByProjectId,
} from "../lib/load-qa.js";
import { patchQaTtsFiles } from "../lib/write-qa.js";
import { generateQaTtsAudio } from "../lib/generate-tts-audio.js";
import { uploadAudioToDrive, ensurePjtFolder } from "../lib/upload-to-drive.js";
import { updateProjectMinimal } from "../lib/update-project.js";
import {
  appendAppLog,
  buildStep09bSuccessLog,
  buildStep09bFailureLog,
} from "../lib/write-app-log.js";
import { logInfo, logError } from "../lib/logger.js";

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function runStep09bQaTtsGenerate(
  payload: WorkflowPayload,
  spreadsheetId: string
): Promise<void> {
  logInfo("[STEP_09B] Q&A TTS Audio Generate start");

  const configMap = await loadRuntimeConfig(spreadsheetId);

  for (const projectId of payload.project_ids) {
    logInfo(`[STEP_09B] Processing project: ${projectId}`);

    let projectRecordId   = "";
    let atLeastOneSuccess = false;

    try {
      // ── プロジェクト取得 ──────────────────────────────────────────────────────
      const projects = await readProjectsByIds(spreadsheetId, [projectId]);
      const project  = projects[0];
      if (!project) {
        const msg = `[STEP_09B] project not found: ${projectId}`;
        logError(msg);
        try {
          await appendAppLog(spreadsheetId,
            buildStep09bFailureLog(projectId, "", "project_not_found", msg));
        } catch (_) {}
        continue;
      }
      projectRecordId = project.record_id;

      // ── Drive フォルダ ID の取得 ──────────────────────────────────────────────
      const parentFolderId = getConfigValue(configMap, "google_drive_folder_id", "");
      if (!parentFolderId) {
        const msg = `[STEP_09B] google_drive_folder_id is not configured in RuntimeConfig`;
        logError(msg);
        try {
          await appendAppLog(spreadsheetId,
            buildStep09bFailureLog(projectId, projectRecordId, "config_missing", msg));
        } catch (_) {}
        continue;
      }

      let driveFolderId: string;
      try {
        driveFolderId = await ensurePjtFolder(parentFolderId, projectId);
        logInfo(`[STEP_09B] Drive folder ready: ${driveFolderId} (project: ${projectId})`);
      } catch (folderErr) {
        const msg =
          `[STEP_09B] ensurePjtFolder failed for project ${projectId}: ` +
          (folderErr instanceof Error ? folderErr.message : String(folderErr));
        logError(msg);
        try {
          await appendAppLog(spreadsheetId,
            buildStep09bFailureLog(projectId, projectRecordId, "drive_folder_error", msg));
        } catch (_) {}
        continue;
      }

      // ── RETAKE モード検出 ──────────────────────────────────────────────────
      // approval_status = "RETAKE" の行が 1 件でもあれば RETAKE モードで動作する。
      const retakeRows = await loadQaRetakeTtsTargetsByProjectId(spreadsheetId, projectId);
      const isRetakeMode = retakeRows.length > 0;

      if (isRetakeMode) {
        logInfo(`[STEP_09B][RETAKE] Retake mode: ${retakeRows.length} row(s) targeted for project ${projectId}`);
      }

      // ── 処理対象行の選択 ─────────────────────────────────────────────────
      // 通常モード: question_tts_file = "" の未生成行
      // RETAKE モード: approval_status = "RETAKE" の行（tts_file の有無を問わない）
      const unprocessedRows = await loadQaTtsTargetsByProjectId(spreadsheetId, projectId);
      const targetRows = isRetakeMode ? retakeRows : unprocessedRows;

      if (targetRows.length === 0) {
        logInfo(`[STEP_09B] No target QA TTS rows for project ${projectId}. Skipping.`);
        continue;
      }

      logInfo(
        `[STEP_09B] ${targetRows.length} target QA row(s) for ${projectId}` +
        (isRetakeMode ? " [RETAKE]" : "")
      );

      // ── 各 QA 行に対して音声生成 ─────────────────────────────────────────────
      for (const qaRow of targetRows) {
        const recordId = qaRow.record_id;

        logInfo(
          `[STEP_09B] Processing QA ${recordId} (qa_no=${qaRow.qa_no})` +
          (isRetakeMode ? " [RETAKE]" : "")
        );

        if (payload.dry_run) {
          logInfo(`[STEP_09B][DRY_RUN] Would generate audio for ${recordId}${isRetakeMode ? " [RETAKE]" : ""}`);
          logInfo(`  question_tts length: ${qaRow.question_tts.length}`);
          logInfo(`  answer_tts length  : ${qaRow.answer_announcement_tts.length}`);
          atLeastOneSuccess = true;
          continue;
        }

        try {
          const now = new Date().toISOString();

          // ── 問題音声: question_tts → {record_id}_q.mp3 ──────────────────────
          if (!qaRow.question_tts) {
            throw new Error(`question_tts is empty for ${recordId}`);
          }
          const questionMp3 = await generateQaTtsAudio(qaRow.question_tts, configMap);
          logInfo(`[STEP_09B] question MP3 generated: ${recordId} (${questionMp3.length} bytes)`);

          const questionFileName = `${recordId}_q.mp3`;
          const questionUrl = await uploadAudioToDrive(driveFolderId, questionFileName, questionMp3);
          logInfo(`[STEP_09B] question MP3 uploaded: ${questionUrl}`);

          // ── 正解音声: answer_announcement_tts → {record_id}_a.mp3 ───────────
          if (!qaRow.answer_announcement_tts) {
            throw new Error(`answer_announcement_tts is empty for ${recordId}`);
          }
          const answerMp3 = await generateQaTtsAudio(qaRow.answer_announcement_tts, configMap);
          logInfo(`[STEP_09B] answer MP3 generated: ${recordId} (${answerMp3.length} bytes)`);

          const answerFileName = `${recordId}_a.mp3`;
          const answerUrl = await uploadAudioToDrive(driveFolderId, answerFileName, answerMp3);
          logInfo(`[STEP_09B] answer MP3 uploaded: ${answerUrl}`);

          // ── 10_QA パッチ ────────────────────────────────────────────────────
          const patch: QaTtsFilePatch = {
            record_id:          recordId,
            question_tts_file:  questionUrl,
            answer_tts_file:    answerUrl,
            // RETAKE 後は approval_status を "PENDING" にリセットして再レビュー待ちにする
            ...(isRetakeMode ? { approval_status: "PENDING" } : {}),
            updated_at:         now,
            updated_by:         "github_actions",
          };
          await patchQaTtsFiles(spreadsheetId, patch);
          logInfo(`[STEP_09B] patchQaTtsFiles done: ${recordId}`);

          // 成功ログ
          const successMsg =
            `QA TTS audio generated: ${recordId} (qa_no=${qaRow.qa_no}), ` +
            `q=${questionUrl}, a=${answerUrl}`;
          try {
            await appendAppLog(spreadsheetId,
              buildStep09bSuccessLog(projectId, recordId, successMsg));
          } catch (_) {}
          atLeastOneSuccess = true;

        } catch (rowErr) {
          const msg =
            `[STEP_09B] Failed to process QA row ${recordId}: ` +
            (rowErr instanceof Error ? rowErr.message : String(rowErr));
          logError(msg);
          try {
            await appendAppLog(spreadsheetId,
              buildStep09bFailureLog(projectId, recordId, "tts_generation_failed", msg));
          } catch (_) {}
          // 個別行のエラーは継続（部分成功を許容）
        }
      }

      // ── 00_Project 最小更新 ────────────────────────────────────────────────
      if (atLeastOneSuccess && !payload.dry_run) {
        const patch: ProjectMinimalPatch = {
          current_step:    "STEP_09B_QA_TTS",
          approval_status: "PENDING",
          updated_at:      new Date().toISOString(),
          updated_by:      "github_actions",
        };
        try {
          await updateProjectMinimal(spreadsheetId, projectId, patch);
        } catch (updateErr) {
          logError(
            `[STEP_09B] updateProjectMinimal failed for ${projectId}: ` +
            (updateErr instanceof Error ? updateErr.message : String(updateErr))
          );
        }
      }

    } catch (err) {
      const msg =
        `[STEP_09B] Unexpected error for project ${projectId}: ` +
        (err instanceof Error ? err.message : String(err));
      logError(msg);
      try {
        await appendAppLog(spreadsheetId,
          buildStep09bFailureLog(projectId, projectRecordId, "unexpected_error", msg));
      } catch (_) {}
    }
  }

  logInfo("[STEP_09B] Q&A TTS Audio Generate finished.");
}
