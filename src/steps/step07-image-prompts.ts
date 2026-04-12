/**
 * step07-image-prompts.ts
 *
 * STEP_07 Image Prompts Build のオーケストレーター。
 *
 * ─── 処理概要 ──────────────────────────────────────────────────────────────────
 *
 * 1. 00_Project から ProjectRow を取得
 * 2. video_format を検証（"full" | "short" | "short+full"）
 * 3. 02_Scenes から全 scene を取得し video_format でフィルタ
 * 4. 05_Visual_Bible から全 VB 要素を取得（0 件は preflight failure）
 * 5. Runtime Config から google_drive_folder_id を取得
 * 6. ensurePjtFolder で PJT-### フォルダを確保
 * 7. シーンごとに以下を実行:
 *    a. buildStep07Prompt → callGemini でプロンプトパーツ生成
 *    b. validateImagePromptAiResponse でスキーマ検証
 *    c. buildPromptFull でコード側が prompt_full を組み立て
 *    d. generateImageStep07 で Gemini Image 生成（失敗時は image_take_1 = ""）
 *    e. uploadImageToDrive で Google Drive にアップロード（失敗時は image_take_1 = ""）
 *    f. upsertImagePrompts で 06_Image_Prompts に書き込み
 * 8. 00_Project を最小更新（current_step = STEP_07_IMAGE_PROMPTS）
 * 9. 100_App_Logs にログ記録
 *
 * ─── record_id 採番方針 ────────────────────────────────────────────────────────
 *
 * - 既存行（generation_status = "GENERATED"）の record_id をインデックス順で再利用
 * - 超過分は新規採番（{projectId}-IMG-{i+1:03d}）
 * - 再実行時に件数が減少した場合: 余剰既存行は残置（DELETE 禁止）
 *
 * ─── 画像生成エラーの扱い ──────────────────────────────────────────────────────
 *
 * 画像生成 / Drive アップロードに失敗した場合でも、プロンプト行は upsert する。
 * image_take_1 = "" のままにして failure log を記録し、次シーンへ進む。
 */

import type {
  WorkflowPayload,
  ProjectMinimalPatch,
  ImagePromptRow,
  ImagePromptReadRow,
  SceneReadRow,
} from "../types.js";
import { loadRuntimeConfig, getConfigValue } from "../lib/load-runtime-config.js";
import { readProjectsByIds } from "../lib/load-project-input.js";
import { loadScenesByProjectId } from "../lib/load-scenes.js";
import { loadVisualBibleByProjectId } from "../lib/load-visual-bible.js";
import { loadImagePromptsByProjectId } from "../lib/load-image-prompts.js";
import { loadStep07Assets } from "../lib/load-assets.js";
import { buildStep07Prompt } from "../lib/build-prompt.js";
import {
  callGemini,
  buildGeminiOptionsStep07,
  generateImageStep07,
  GeminiSpendingCapError,
} from "../lib/call-gemini.js";
import { validateImagePromptAiResponse } from "../lib/validate-json.js";
import { upsertImagePrompts } from "../lib/write-image-prompts.js";
import { updateProjectMinimal } from "../lib/update-project.js";
import {
  ensurePjtFolder,
  uploadImageToDrive,
  resolveVersionLabel,
} from "../lib/upload-to-drive.js";
import {
  appendAppLog,
  buildStep07SuccessLog,
  buildStep07PartialSuccessLog,
  buildStep07FailureLog,
} from "../lib/write-app-log.js";
import { logInfo, logError } from "../lib/logger.js";

// ─── record_id 採番 ───────────────────────────────────────────────────────────

function assignImagePromptRecordIds(
  projectId: string,
  sceneCount: number,
  existingRows: ImagePromptReadRow[]
): string[] {
  return Array.from({ length: sceneCount }, (_, i) =>
    existingRows[i]?.record_id ?? `${projectId}-IMG-${String(i + 1).padStart(3, "0")}`
  );
}

// ─── prompt_full 組み立て ─────────────────────────────────────────────────────

/**
 * AI が返したプロンプトパーツを結合して prompt_full を組み立てる。
 * negative_prompt は画像生成 API に別途渡すため prompt_full には含めない。
 */
function buildPromptFull(ai: {
  prompt_base: string;
  prompt_character: string;
  prompt_scene: string;
  prompt_composition: string;
}): string {
  return [
    ai.prompt_base,
    ai.prompt_character,
    ai.prompt_scene,
    ai.prompt_composition,
  ]
    .filter(Boolean)
    .join(", ");
}

// ─── YYYYMMDD ─────────────────────────────────────────────────────────────────

function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function runStep07ImagePrompts(
  payload: WorkflowPayload,
  spreadsheetId: string
): Promise<void> {
  logInfo("[STEP_07] Image Prompts Build start");

  const configMap = await loadRuntimeConfig(spreadsheetId);
  const geminiOptions = buildGeminiOptionsStep07(configMap);
  const step07Assets = loadStep07Assets();

  for (const projectId of payload.project_ids) {
    logInfo(`[STEP_07] Processing project: ${projectId}`);

    let projectRecordId = "";

    try {
      // ── プロジェクト取得 ────────────────────────────────────────────────────
      const projects = await readProjectsByIds(spreadsheetId, [projectId]);
      const project = projects[0];
      if (!project) {
        const msg = `[STEP_07] project not found: ${projectId}`;
        logError(msg);
        try {
          await appendAppLog(
            spreadsheetId,
            buildStep07FailureLog(projectId, "", "project_not_found", msg)
          );
        } catch (_) {}
        continue;
      }
      projectRecordId = project.record_id;
      const videoFormat = (project.video_format ?? "").trim().toLowerCase();

      // ── video_format 検証 ───────────────────────────────────────────────────
      if (!["full", "short", "short+full"].includes(videoFormat)) {
        const msg = `[STEP_07] Invalid video_format: "${videoFormat}" for project ${projectId}`;
        logError(msg);
        try {
          await appendAppLog(
            spreadsheetId,
            buildStep07FailureLog(projectId, projectRecordId, "invalid_video_format", msg)
          );
        } catch (_) {}
        continue;
      }

      // ── 02_Scenes 取得・フィルタ ────────────────────────────────────────────
      const allScenes = await loadScenesByProjectId(spreadsheetId, projectId);
      if (allScenes.length === 0) {
        const msg = `[STEP_07] No GENERATED scenes found for project ${projectId}`;
        logError(msg);
        try {
          await appendAppLog(
            spreadsheetId,
            buildStep07FailureLog(projectId, projectRecordId, "no_scenes", msg)
          );
        } catch (_) {}
        continue;
      }

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
        const msg = `[STEP_07] No target scenes after video_format filter (format=${videoFormat}) for project ${projectId}`;
        logError(msg);
        try {
          await appendAppLog(
            spreadsheetId,
            buildStep07FailureLog(projectId, projectRecordId, "no_target_scenes", msg)
          );
        } catch (_) {}
        continue;
      }

      // ── 05_Visual_Bible 取得 ────────────────────────────────────────────────
      const visualBible = await loadVisualBibleByProjectId(spreadsheetId, projectId);
      if (visualBible.length === 0) {
        const msg = `[STEP_07] No GENERATED Visual Bible rows found for project ${projectId}. Run STEP_06 first.`;
        logError(msg);
        try {
          await appendAppLog(
            spreadsheetId,
            buildStep07FailureLog(projectId, projectRecordId, "no_visual_bible", msg)
          );
        } catch (_) {}
        continue;
      }

      // ── Google Drive フォルダ確保 ───────────────────────────────────────────
      const parentFolderId = getConfigValue(configMap, "google_drive_folder_id", "");
      if (!parentFolderId) {
        const msg = `[STEP_07] google_drive_folder_id is not set in 94_Runtime_Config for project ${projectId}`;
        logError(msg);
        try {
          await appendAppLog(
            spreadsheetId,
            buildStep07FailureLog(projectId, projectRecordId, "missing_config_gdrive_folder", msg)
          );
        } catch (_) {}
        continue;
      }

      let pjtFolderId = "";
      if (!payload.dry_run) {
        try {
          pjtFolderId = await ensurePjtFolder(parentFolderId, projectId);
          logInfo(`[STEP_07] Drive folder ready: ${pjtFolderId}`);
        } catch (driveErr) {
          const msg =
            `[STEP_07] ensurePjtFolder failed for project ${projectId}: ` +
            (driveErr instanceof Error ? driveErr.message : String(driveErr));
          logError(msg);
          try {
            await appendAppLog(
              spreadsheetId,
              buildStep07FailureLog(projectId, projectRecordId, "drive_folder_error", msg)
            );
          } catch (_) {}
          continue;
        }
      }

      // ── record_id 採番 ───────────────────────────────────────────────────────
      const existingRows = await loadImagePromptsByProjectId(spreadsheetId, projectId);
      if (existingRows.length > 0) {
        logInfo(`[STEP_07] Re-run detected: ${existingRows.length} existing rows for project ${projectId}`);
      }
      const recordIds = assignImagePromptRecordIds(projectId, targetScenes.length, existingRows);

      // ── シーンループ ─────────────────────────────────────────────────────────
      const now = new Date();
      const dateStr = toDateString(now);
      const nowIso = now.toISOString();
      let firstUpsertedId = "";
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < targetScenes.length; i++) {
        const scene = targetScenes[i];
        const recordId = recordIds[i];

        logInfo(`[STEP_07] Scene ${scene.scene_no}: ${scene.scene_title} (${recordId})`);

        try {
          // ── Gemini テキスト生成（プロンプトパーツ）──────────────────────────
          const prompt = buildStep07Prompt(step07Assets, project, scene, visualBible);
          const geminiResult = await callGemini(prompt, {
            ...geminiOptions,
            maxOutputTokens: 8192,
          });
          logInfo(`[STEP_07] Text generated. model=${geminiResult.modelUsed}`);

          // ── スキーマ検証 ─────────────────────────────────────────────────────
          const validation = validateImagePromptAiResponse(
            geminiResult.text,
            step07Assets.aiSchema
          );
          if (!validation.success) {
            const msg =
              `[STEP_07] Schema validation failed for scene ${scene.record_id} ` +
              `(project ${projectId}): ${validation.errors}`;
            logError(msg);
            try {
              await appendAppLog(
                spreadsheetId,
                buildStep07FailureLog(projectId, recordId, "schema_validation_failure", msg)
              );
            } catch (_) {}
            failCount++;
            continue;
          }

          const aiRow = validation.item;
          const promptFull = buildPromptFull(aiRow);

          // ── 画像生成 + Drive アップロード ─────────────────────────────────────
          let driveUrl = "";

          if (payload.dry_run) {
            logInfo(`[STEP_07][DRY_RUN] Would generate image for ${recordId}`);
          } else {
            try {
              const pngBuffer = await generateImageStep07(
                promptFull,
                aiRow.negative_prompt,
              );
              const versionLabel = resolveVersionLabel(scene.short_use, scene.full_use);
              const fileName = `${scene.record_id}_${versionLabel}_${dateStr}.png`;
              driveUrl = await uploadImageToDrive(pjtFolderId, fileName, pngBuffer);
              logInfo(`[STEP_07] Image uploaded: ${driveUrl}`);
            } catch (imageErr) {
              const isSpendingCap = imageErr instanceof GeminiSpendingCapError;
              if (isSpendingCap) throw imageErr; // 全停止

              const errType = (imageErr instanceof Error && imageErr.message.includes("Drive"))
                ? "drive_upload_error"
                : "gemini_image_error";
              const msg =
                `[STEP_07] Image generation/upload failed for ${recordId}: ` +
                (imageErr instanceof Error ? imageErr.message : String(imageErr));
              logError(msg);
              try {
                await appendAppLog(
                  spreadsheetId,
                  buildStep07FailureLog(projectId, recordId, errType, msg)
                );
              } catch (_) {}
              // driveUrl = "" のままプロンプト行は upsert する
            }
          }

          // ── GSS Upsert ────────────────────────────────────────────────────────
          const row: ImagePromptRow = {
            project_id:              projectId,
            record_id:               recordId,
            generation_status:       "GENERATED",
            approval_status:         "PENDING",
            step_id:                 "STEP_07_IMAGE_PROMPTS",
            scene_no:                scene.scene_no,
            related_version:         scene.record_id,
            prompt_base:             aiRow.prompt_base,
            prompt_character:        aiRow.prompt_character,
            prompt_scene:            aiRow.prompt_scene,
            prompt_composition:      aiRow.prompt_composition,
            negative_prompt:         aiRow.negative_prompt,
            prompt_full:             promptFull,
            image_take_1:            driveUrl,
            image_take_2:            "",
            image_take_3:            "",
            selected_asset:          "",
            revision_note:           "",
            style_consistency_check: "",
            updated_at:              nowIso,
            updated_by:              "github_actions",
            notes:                   "",
          };

          if (payload.dry_run) {
            logInfo(`[STEP_07][DRY_RUN] Would upsert: ${recordId} (scene: ${scene.scene_title})`);
            logInfo(`[STEP_07][DRY_RUN] prompt_full preview: ${promptFull.slice(0, 200)}`);
            successCount++;
            if (!firstUpsertedId) firstUpsertedId = recordId;
            continue;
          }

          await upsertImagePrompts(spreadsheetId, row);
          logInfo(`[STEP_07] Upserted: ${recordId}`);
          successCount++;
          if (!firstUpsertedId) firstUpsertedId = recordId;
        } catch (sceneErr) {
          if (sceneErr instanceof GeminiSpendingCapError) throw sceneErr;

          const msg =
            `[STEP_07] Unexpected error for scene ${scene.record_id} ` +
            `(project ${projectId}): ` +
            (sceneErr instanceof Error ? sceneErr.message : String(sceneErr));
          logError(msg);
          try {
            await appendAppLog(
              spreadsheetId,
              buildStep07FailureLog(projectId, recordId, "unexpected_error", msg)
            );
          } catch (_) {}
          failCount++;
        }
      }

      // ── 00_Project 最小更新 ────────────────────────────────────────────────
      if (successCount > 0 && !payload.dry_run) {
        const patch: ProjectMinimalPatch = {
          current_step:    "STEP_07_IMAGE_PROMPTS",
          approval_status: "PENDING",
          updated_at:      nowIso,
          updated_by:      "github_actions",
        };
        try {
          await updateProjectMinimal(spreadsheetId, projectId, patch);
        } catch (updateErr) {
          logError(
            `[STEP_07] updateProjectMinimal failed for ${projectId}: ` +
            (updateErr instanceof Error ? updateErr.message : String(updateErr))
          );
        }
      }

      // ── 完了ログ ──────────────────────────────────────────────────────────
      const summaryMsg =
        `Image Prompts Build complete: success=${successCount}, fail=${failCount}, ` +
        `total=${targetScenes.length}, project=${projectId}`;
      logInfo(`[STEP_07] ${summaryMsg}`);

      try {
        const logRecordId = firstUpsertedId || projectRecordId;
        if (successCount === 0) {
          await appendAppLog(
            spreadsheetId,
            buildStep07FailureLog(projectId, logRecordId, "all_scenes_failed", summaryMsg)
          );
        } else if (failCount > 0) {
          await appendAppLog(
            spreadsheetId,
            buildStep07PartialSuccessLog(projectId, logRecordId, summaryMsg)
          );
        } else {
          await appendAppLog(
            spreadsheetId,
            buildStep07SuccessLog(projectId, logRecordId, summaryMsg)
          );
        }
      } catch (_) {}
    } catch (err) {
      if (err instanceof GeminiSpendingCapError) throw err;

      const msg =
        `[STEP_07] Unexpected error for project ${projectId}: ` +
        (err instanceof Error ? err.message : String(err));
      logError(msg);
      try {
        await appendAppLog(
          spreadsheetId,
          buildStep07FailureLog(projectId, projectRecordId, "unexpected_error", msg)
        );
      } catch (_) {}
    }
  }

  logInfo("[STEP_07] Image Prompts Build finished.");
}
