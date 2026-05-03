/**
 * step07b-image-generate.ts
 *
 * STEP_07B Image Generate のオーケストレーター。
 *
 * STEP_07A（step07-image-prompts.ts）がプロンプトを生成した後に実行し、
 * 06_Image_Prompts の generation_status = "PENDING" 行に対して画像を生成する。
 *
 * ─── 処理概要 ──────────────────────────────────────────────────────────────────
 *
 * 1. 06_Image_Prompts から generation_status = "PENDING" の行を取得
 *    （0 件 = STEP_07A 未実行、またはすべて処理済み → スキップ）
 * 2. Drive の character_book/ フォルダから既存キャラクターシートを全件読み込む
 * 3. 行ごとに以下を実行:
 *    a. prompt_full + negative_prompt で generateImageStep07 を呼び出し
 *    b. PNG → JPEG 変換後 Drive にアップロード
 *    c. generation_status = "GENERATED" / "FAILED"（driveUrl の有無で決定）
 *    d. approval_status = "RETAKE" 行: 旧 image_take_1 → image_take_2 に退避、
 *       approval_status を "PENDING" に戻す
 *    e. upsertImagePrompts で 06_Image_Prompts を更新
 * 4. 00_Project を最小更新（current_step = STEP_07B_IMAGE_GENERATE）
 * 5. 100_App_Logs にログ記録
 */

import type {
  WorkflowPayload,
  ProjectMinimalPatch,
  ImagePromptRow,
} from "../types.js";
import { loadRuntimeConfig, getConfigValue } from "../lib/load-runtime-config.js";
import { readProjectsByIds } from "../lib/load-project-input.js";
import { loadPendingImagePromptsByProjectId } from "../lib/load-image-prompts.js";
import {
  buildImageGenOptions,
  generateImageStep07,
  GeminiSpendingCapError,
} from "../lib/call-gemini.js";
import { upsertImagePrompts } from "../lib/write-image-prompts.js";
import { updateProjectMinimal } from "../lib/update-project.js";
import {
  ensurePjtFolder,
  uploadImageToDrive,
  resolveVersionLabel,
  convertToJpeg,
  listFilesInFolder,
  downloadFileFromDrive,
} from "../lib/upload-to-drive.js";
import {
  appendAppLog,
  buildStep07bSuccessLog,
  buildStep07bPartialSuccessLog,
  buildStep07bFailureLog,
} from "../lib/write-app-log.js";
import { logInfo, logError } from "../lib/logger.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function runStep07bImageGenerate(
  payload: WorkflowPayload,
  spreadsheetId: string
): Promise<void> {
  logInfo("[STEP_07B] Image Generate start");

  const configMap     = await loadRuntimeConfig(spreadsheetId);
  const imageGenOptions = buildImageGenOptions(configMap);
  const sceneDelayMs  = Math.max(0, Number(getConfigValue(configMap, "step_07_scene_delay_ms", "0")) || 0);

  for (const projectId of payload.project_ids) {
    logInfo(`[STEP_07B] Processing project: ${projectId}`);

    let projectRecordId = "";

    try {
      // ── プロジェクト取得 ─────────────────────────────────────────────────
      const projects = await readProjectsByIds(spreadsheetId, [projectId]);
      const project = projects[0];
      if (!project) {
        const msg = `[STEP_07B] project not found: ${projectId}`;
        logError(msg);
        try {
          await appendAppLog(
            spreadsheetId,
            buildStep07bFailureLog(projectId, "", "project_not_found", msg)
          );
        } catch (_) {}
        continue;
      }
      projectRecordId = project.record_id;

      // ── PENDING 行を取得 ─────────────────────────────────────────────────
      const pendingRows = await loadPendingImagePromptsByProjectId(spreadsheetId, projectId);
      if (pendingRows.length === 0) {
        logInfo(`[STEP_07B] No PENDING rows found for project ${projectId} — skipping. Run STEP_07A first.`);
        continue;
      }
      logInfo(`[STEP_07B] ${pendingRows.length} PENDING row(s) found for project ${projectId}`);

      // ── Google Drive フォルダ確保 ────────────────────────────────────────
      const parentFolderId = getConfigValue(configMap, "google_drive_folder_id", "");
      if (!parentFolderId) {
        const msg = `[STEP_07B] google_drive_folder_id is not set for project ${projectId}`;
        logError(msg);
        try {
          await appendAppLog(
            spreadsheetId,
            buildStep07bFailureLog(projectId, projectRecordId, "missing_config_gdrive_folder", msg)
          );
        } catch (_) {}
        continue;
      }

      let pjtFolderId = "";
      if (!payload.dry_run) {
        try {
          pjtFolderId = await ensurePjtFolder(parentFolderId, projectId);
          logInfo(`[STEP_07B] Drive folder ready: ${pjtFolderId}`);
        } catch (driveErr) {
          const msg =
            `[STEP_07B] ensurePjtFolder failed for project ${projectId}: ` +
            (driveErr instanceof Error ? driveErr.message : String(driveErr));
          logError(msg);
          try {
            await appendAppLog(
              spreadsheetId,
              buildStep07bFailureLog(projectId, projectRecordId, "drive_folder_error", msg)
            );
          } catch (_) {}
          continue;
        }
      }

      // ── character_book からキャラクターシートを全件読み込む ──────────────
      // character_refs は GSS に保存されていないため全シートを渡す。
      // prompt_character に外見記述がないため（STEP_07A の prompt 改修済み）、
      // 全シートを渡してもキャラクター混同は発生しにくい。
      const characterSheets: Buffer[] = [];
      if (!payload.dry_run) {
        try {
          const charBookFolderId = await ensurePjtFolder(pjtFolderId, "character_book");
          const driveFiles = await listFilesInFolder(charBookFolderId);
          for (const file of driveFiles) {
            try {
              const buf = await downloadFileFromDrive(file.id);
              characterSheets.push(buf);
            } catch (dlErr) {
              logError(
                `[STEP_07B] Failed to download character sheet "${file.name}": ` +
                (dlErr instanceof Error ? dlErr.message : String(dlErr)) +
                " — skipping this sheet."
              );
            }
          }
          logInfo(`[STEP_07B] Character sheets loaded: ${characterSheets.length} sheet(s)`);
        } catch (charErr) {
          logError(
            `[STEP_07B] character_book folder error for project ${projectId}: ` +
            (charErr instanceof Error ? charErr.message : String(charErr)) +
            " — proceeding without reference sheets."
          );
        }
      }

      // ── 行ごとに画像生成 ─────────────────────────────────────────────────
      const now    = new Date();
      const dateStr  = toDateString(now);
      const nowIso   = now.toISOString();

      let firstUpsertedId = "";
      let successCount    = 0;
      let failCount       = 0;

      for (let i = 0; i < pendingRows.length; i++) {
        const pending = pendingRows[i]!;
        const { record_id: recordId, prompt_full: promptFull, negative_prompt: negativePrompt } = pending;

        logInfo(`[STEP_07B] Processing: ${recordId} (approval=${pending.approval_status})`);

        try {
          let driveUrl = "";
          const isRetakeRow = pending.approval_status === "RETAKE";

          if (payload.dry_run) {
            logInfo(`[STEP_07B][DRY_RUN] Would generate image for ${recordId} (retake=${isRetakeRow})`);
            logInfo(`[STEP_07B][DRY_RUN] prompt_full preview: ${promptFull.slice(0, 200)}`);
          } else {
            try {
              const pngBuffer = await generateImageStep07(
                promptFull,
                negativePrompt,
                imageGenOptions.primaryModel,
                imageGenOptions.secondaryModel,
                characterSheets.length > 0 ? characterSheets : undefined,
              );
              // Convert PNG to JPEG (quality 90%) to reduce file size (~300KB target)
              const jpegBuffer  = await convertToJpeg(pngBuffer);
              const versionLabel = resolveVersionLabel(
                // related_version holds the scene record_id; restore short/full from it if available.
                // Fallback to "full" — the label is cosmetic for file naming only.
                "",
                "Y",
              );
              const fileName = `${pending.related_version}_${versionLabel}_${dateStr}.jpg`;
              driveUrl = await uploadImageToDrive(pjtFolderId, fileName, jpegBuffer, "image/jpeg");
              logInfo(`[STEP_07B] Image uploaded: ${driveUrl}`);
            } catch (imageErr) {
              const isSpendingCap = imageErr instanceof GeminiSpendingCapError;
              if (isSpendingCap) throw imageErr; // stop all processing

              const errType = (imageErr instanceof Error && imageErr.message.includes("Drive"))
                ? "drive_upload_error"
                : "gemini_image_error";
              const msg =
                `[STEP_07B] Image generation/upload failed for ${recordId}: ` +
                (imageErr instanceof Error ? imageErr.message : String(imageErr));
              logError(msg);
              try {
                await appendAppLog(
                  spreadsheetId,
                  buildStep07bFailureLog(projectId, recordId, errType, msg)
                );
              } catch (_) {}
              // driveUrl = "" — set generation_status to "FAILED"
            }
          }

          // generation_status: "GENERATED" if image was produced, "FAILED" otherwise.
          // For dry_run, treat as "GENERATED" to simulate success.
          const generationStatus = payload.dry_run
            ? "GENERATED"
            : (driveUrl ? "GENERATED" : "FAILED") as "GENERATED" | "FAILED";

          const row: ImagePromptRow = {
            project_id:              projectId,
            record_id:               recordId,
            generation_status:       generationStatus,
            // Retake rows: clear the RETAKE flag after image regeneration
            approval_status:         isRetakeRow ? "PENDING" : "PENDING",
            step_id:                 "STEP_07_IMAGE_PROMPTS",
            scene_no:                pending.scene_no,
            related_version:         pending.related_version,
            prompt_base:             pending.prompt_base,
            prompt_character:        pending.prompt_character,
            prompt_scene:            pending.prompt_scene,
            prompt_composition:      pending.prompt_composition,
            negative_prompt:         negativePrompt,
            prompt_full:             promptFull,
            // Retake rows: backup old image_take_1 → image_take_2 before overwriting
            image_take_1:            payload.dry_run ? "(dry_run)" : driveUrl,
            image_take_2:            isRetakeRow ? pending.image_take_1 : pending.image_take_2,
            image_take_3:            "",
            selected_asset:          pending.selected_asset,
            revision_note:           pending.revision_note,
            style_consistency_check: pending.style_consistency_check,
            updated_at:              nowIso,
            updated_by:              "github_actions",
            notes:                   pending.notes,
          };

          if (!payload.dry_run) {
            await upsertImagePrompts(spreadsheetId, row);
          }

          logInfo(`[STEP_07B] Upserted: ${recordId} (status=${generationStatus})`);
          if (generationStatus === "GENERATED") {
            successCount++;
          } else {
            failCount++;
          }
          if (!firstUpsertedId) firstUpsertedId = recordId;
        } catch (rowErr) {
          if (rowErr instanceof GeminiSpendingCapError) throw rowErr;

          const msg =
            `[STEP_07B] Unexpected error for row ${recordId} (project ${projectId}): ` +
            (rowErr instanceof Error ? rowErr.message : String(rowErr));
          logError(msg);
          try {
            await appendAppLog(
              spreadsheetId,
              buildStep07bFailureLog(projectId, recordId, "unexpected_error", msg)
            );
          } catch (_) {}
          failCount++;
        }

        // ── 行間 delay（クォータ枯渇防止）────────────────────────────────
        if (sceneDelayMs > 0 && i < pendingRows.length - 1 && !payload.dry_run) {
          logInfo(`[STEP_07B] Waiting ${sceneDelayMs}ms before next row...`);
          await new Promise<void>((resolve) => setTimeout(resolve, sceneDelayMs));
        }
      }

      // ── 00_Project 最小更新 ──────────────────────────────────────────────
      if (successCount > 0 && !payload.dry_run) {
        const patch: ProjectMinimalPatch = {
          current_step:    "STEP_07B_IMAGE_GENERATE",
          approval_status: "PENDING",
          updated_at:      nowIso,
          updated_by:      "github_actions",
        };
        try {
          await updateProjectMinimal(spreadsheetId, projectId, patch);
        } catch (updateErr) {
          logError(
            `[STEP_07B] updateProjectMinimal failed for ${projectId}: ` +
            (updateErr instanceof Error ? updateErr.message : String(updateErr))
          );
        }
      }

      // ── 完了ログ ─────────────────────────────────────────────────────────
      const summaryMsg =
        `Image Generate complete: success=${successCount}, fail=${failCount}, ` +
        `total=${pendingRows.length}, project=${projectId}`;
      logInfo(`[STEP_07B] ${summaryMsg}`);

      try {
        const logRecordId = firstUpsertedId || projectRecordId;
        if (successCount === 0) {
          await appendAppLog(
            spreadsheetId,
            buildStep07bFailureLog(projectId, logRecordId, "all_rows_failed", summaryMsg)
          );
        } else if (failCount > 0) {
          await appendAppLog(
            spreadsheetId,
            buildStep07bPartialSuccessLog(projectId, logRecordId, summaryMsg)
          );
        } else {
          await appendAppLog(
            spreadsheetId,
            buildStep07bSuccessLog(projectId, logRecordId, summaryMsg)
          );
        }
      } catch (_) {}
    } catch (err) {
      if (err instanceof GeminiSpendingCapError) throw err;

      const msg =
        `[STEP_07B] Unexpected error for project ${projectId}: ` +
        (err instanceof Error ? err.message : String(err));
      logError(msg);
      try {
        await appendAppLog(
          spreadsheetId,
          buildStep07bFailureLog(projectId, projectRecordId, "unexpected_error", msg)
        );
      } catch (_) {}
    }
  }

  logInfo("[STEP_07B] Image Generate finished.");
}
