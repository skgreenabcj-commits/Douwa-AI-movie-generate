/**
 * step07-image-prompts.ts
 *
 * STEP_07 Image Prompts Build のオーケストレーター。
 *
 * ─── 処理概要（STEP_07A: プロンプト生成フェーズ）──────────────────────────────
 *
 * 1. 00_Project から ProjectRow を取得
 * 2. video_format を検証（"full" | "short" | "short+full"）
 * 3. 02_Scenes から全 scene を取得し video_format でフィルタ
 * 4. 05_Visual_Bible から全 VB 要素を取得（0 件は preflight failure）
 * 5. Runtime Config から google_drive_folder_id を取得
 * 6. ensurePjtFolder で PJT-### フォルダを確保
 * 7. キャラクターシートを生成して Drive の character_book/ に保存
 * 8. シーンごとに以下を実行:
 *    a. buildStep07Prompt → callGemini でプロンプトパーツ生成
 *    b. validateImagePromptAiResponse でスキーマ検証
 *    c. buildPromptFull でコード側が prompt_full を組み立て
 *    d. upsertImagePrompts で 06_Image_Prompts に書き込み
 *       （generation_status = "PENDING", image_take_1 = "" — 画像生成は STEP_07B が担当）
 * 9. 00_Project を最小更新（current_step = STEP_07_IMAGE_PROMPTS）
 * 10. 100_App_Logs にログ記録
 *
 * ─── record_id 採番方針 ────────────────────────────────────────────────────────
 *
 * - 既存行（generation_status = "GENERATED" | "PENDING"）の record_id をインデックス順で再利用
 * - 超過分は新規採番（{projectId}-IMG-{i+1:03d}）
 * - 再実行時に件数が減少した場合: 余剰既存行は残置（DELETE 禁止）
 *
 * ─── Retake モード ────────────────────────────────────────────────────────────
 *
 * approval_status = "RETAKE" 行が存在する場合に Retake モードで動作する。
 * 既存プロンプトを再利用し、generation_status = "PENDING" に戻すことで
 * STEP_07B が画像を再生成できるようにする。既存の画像 URL は保持する。
 */

import type {
  WorkflowPayload,
  ProjectMinimalPatch,
  ImagePromptRow,
  ImagePromptReadRow,
  ImagePromptRetakeRow,
  SceneReadRow,
  VisualBibleCharacterRow,
} from "../types.js";
import { loadRuntimeConfig, getConfigValue } from "../lib/load-runtime-config.js";
import { readProjectsByIds } from "../lib/load-project-input.js";
import { loadScenesByProjectId } from "../lib/load-scenes.js";
import {
  loadFullVisualBibleByProjectId,
  loadCharactersByProjectId,
} from "../lib/load-visual-bible.js";
import {
  loadImagePromptsByProjectId,
  loadRetakeImagePromptsByProjectId,
} from "../lib/load-image-prompts.js";
import { loadStep07Assets } from "../lib/load-assets.js";
import { buildStep07Prompt } from "../lib/build-prompt.js";
import {
  callGemini,
  buildGeminiOptionsStep07,
  buildImageGenOptions,
  generateCharacterSheet,
  GeminiSpendingCapError,
} from "../lib/call-gemini.js";
import { validateImagePromptAiResponse } from "../lib/validate-json.js";
import { upsertImagePrompts } from "../lib/write-image-prompts.js";
import { updateProjectMinimal } from "../lib/update-project.js";
import {
  ensurePjtFolder,
  uploadImageToDrive,
  convertToJpeg,
  listFilesInFolder,
  downloadFileFromDrive,
} from "../lib/upload-to-drive.js";
import {
  appendAppLog,
  buildStep07SuccessLog,
  buildStep07PartialSuccessLog,
  buildStep07FailureLog,
} from "../lib/write-app-log.js";
import { logInfo, logError } from "../lib/logger.js";

// ─── キャラクターシート ───────────────────────────────────────────────────────

/**
 * Visual Bible のキャラクターエントリからキャラクターシート生成用英語プロンプトを組み立てる。
 */
function buildCharacterSheetPrompt(char: VisualBibleCharacterRow): string {
  const parts: string[] = [
    `Generate a character reference sheet for the following character.`,
    `Front-facing view, even neutral lighting, full body visible, centered in frame.`,
    `Plain white or very light background. No scene elements, no other characters.`,
  ];
  if (char.description)    parts.push(`Character overview: ${char.description}`);
  if (char.character_rule) parts.push(`Design rules: ${char.character_rule}`);
  if (char.color_palette)  parts.push(`Color palette: ${char.color_palette}`);
  if (char.expression_rule) parts.push(`Expression: neutral, friendly.`);
  if (char.avoid_rule)     parts.push(`Avoid: ${char.avoid_rule}`);
  parts.push(`no text, no letters, no captions, no watermark`);
  return parts.join(" ");
}

/**
 * AI が返した character_refs（VB key_name の配列）からキャラクターシート Buffer を選択する。
 * key_name の完全一致で照合する（言語不一致を回避）。
 */
function selectReferenceImages(
  characterRefs: string[],
  characterSheets: Map<string, Buffer>,
): Buffer[] {
  return characterRefs
    .map((ref) => characterSheets.get(ref))
    .filter((buf): buf is Buffer => buf !== undefined);
}

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
  const imageGenOptions = buildImageGenOptions(configMap);
  const step07Assets = loadStep07Assets();
  // Configurable inter-scene delay to avoid quota exhaustion (default: 0ms = disabled)
  const sceneDelayMs = Math.max(0, Number(getConfigValue(configMap, "step_07_scene_delay_ms", "0")) || 0);

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
      const visualBible = await loadFullVisualBibleByProjectId(spreadsheetId, projectId);
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

      // ── 日時（pre-processing とシーンループで共用）────────────────────────
      const now = new Date();
      const dateStr = toDateString(now);
      const nowIso = now.toISOString();

      // ── Retake モード判定 ─────────────────────────────────────────────────────
      // approval_status = "RETAKE" の行があれば Retake モードとして動作する。
      // 0件の場合は通常の全シーン処理（既存動作を維持）。
      const retakeRows = await loadRetakeImagePromptsByProjectId(spreadsheetId, projectId);
      const isRetakeMode = retakeRows.length > 0;
      // Build lookup: 02_Scenes.record_id → retake row
      const retakeMap = new Map<string, ImagePromptRetakeRow>(
        retakeRows.map((r) => [r.related_version, r])
      );

      if (isRetakeMode) {
        // Filter to only retake target scenes
        targetScenes = targetScenes.filter((s) => retakeMap.has(s.record_id));
        logInfo(`[STEP_07][RETAKE] Retake mode: ${retakeRows.length} scene(s) targeted`);
        if (targetScenes.length === 0) {
          logInfo(`[STEP_07][RETAKE] No matching scenes found — skipping project ${projectId}`);
          continue;
        }
      }

      // ── キャラクターシート Pre-processing ─────────────────────────────────────
      // Map<key_name, Buffer> としてメモリ保持する。
      // Retake モード: Drive の character_book/ から既存シートをダウンロード（なければ生成）
      // 通常モード: VB エントリから 1:1 参照画像を生成
      const characterSheets = new Map<string, Buffer>();
      const charEntries = await loadCharactersByProjectId(spreadsheetId, projectId);

      if (charEntries.length > 0 && !payload.dry_run) {
        const charBookFolderId = await ensurePjtFolder(pjtFolderId, "character_book");

        if (isRetakeMode) {
          // ── Retake: Drive からシートを再利用（なければ生成にフォールバック）──
          logInfo(`[STEP_07][RETAKE] Loading existing character sheets from Drive...`);
          const driveFiles = await listFilesInFolder(charBookFolderId);
          for (const char of charEntries) {
            if (!char.key_name) continue;
            const safeFileName = char.key_name.replace(/[^\w\u3000-\u9FFF\u30A0-\u30FF]/g, "_");
            const match = driveFiles.find((f) => f.name.startsWith(safeFileName + "_"));
            if (match) {
              try {
                const buf = await downloadFileFromDrive(match.id);
                characterSheets.set(char.key_name, buf);
                logInfo(`[STEP_07][RETAKE] Character sheet loaded from Drive: ${char.key_name}`);
              } catch (dlErr) {
                logError(
                  `[STEP_07][RETAKE] Download failed for "${char.key_name}": ` +
                  (dlErr instanceof Error ? dlErr.message : String(dlErr)) +
                  " — will regenerate."
                );
              }
            }
            // Fallback: generate if not found in Drive
            if (!characterSheets.has(char.key_name)) {
              try {
                logInfo(`[STEP_07][RETAKE] Generating character sheet (fallback): ${char.key_name}`);
                const sheetPrompt = buildCharacterSheetPrompt(char);
                const sheetPng = await generateCharacterSheet(
                  sheetPrompt, imageGenOptions.primaryModel, imageGenOptions.secondaryModel,
                );
                const sheetJpeg = await convertToJpeg(sheetPng);
                characterSheets.set(char.key_name, sheetJpeg);
                const sheetFileName = `${safeFileName}_${dateStr}.jpg`;
                const sheetUrl = await uploadImageToDrive(charBookFolderId, sheetFileName, sheetJpeg, "image/jpeg");
                logInfo(`[STEP_07][RETAKE] Character sheet uploaded: ${char.key_name} → ${sheetUrl}`);
              } catch (charErr) {
                if (charErr instanceof GeminiSpendingCapError) throw charErr;
                logError(
                  `[STEP_07][RETAKE] Character sheet generation failed for "${char.key_name}": ` +
                  (charErr instanceof Error ? charErr.message : String(charErr))
                );
              }
            }
          }
        } else {
          // ── 通常モード: VB から 1:1 キャラクターシートを生成 ─────────────────
          logInfo(`[STEP_07] Generating character sheets for ${charEntries.length} character(s)...`);
          for (const char of charEntries) {
            if (!char.key_name) continue;
            try {
              const sheetPrompt = buildCharacterSheetPrompt(char);
              const sheetPng = await generateCharacterSheet(
                sheetPrompt, imageGenOptions.primaryModel, imageGenOptions.secondaryModel,
              );
              const sheetJpeg = await convertToJpeg(sheetPng);
              characterSheets.set(char.key_name, sheetJpeg);

              // Upload to Drive for user review
              const safeFileName = char.key_name.replace(/[^\w\u3000-\u9FFF\u30A0-\u30FF]/g, "_");
              const sheetFileName = `${safeFileName}_${dateStr}.jpg`;
              const sheetUrl = await uploadImageToDrive(charBookFolderId, sheetFileName, sheetJpeg, "image/jpeg");
              logInfo(`[STEP_07] Character sheet uploaded: ${char.key_name} → ${sheetUrl}`);
            } catch (charErr) {
              if (charErr instanceof GeminiSpendingCapError) throw charErr;
              logError(
                `[STEP_07] Character sheet generation failed for "${char.key_name}": ` +
                (charErr instanceof Error ? charErr.message : String(charErr))
              );
            }
          }
        }
        logInfo(`[STEP_07] Character sheets ready: ${characterSheets.size}/${charEntries.length}`);
      } else if (payload.dry_run) {
        logInfo(`[STEP_07][DRY_RUN] Would process ${charEntries.length} character sheet(s)`);
      }

      // ── record_id 採番（通常モード）/ Retake は retakeMap から取得 ─────────────
      const existingRows = await loadImagePromptsByProjectId(spreadsheetId, projectId);
      if (!isRetakeMode && existingRows.length > 0) {
        logInfo(`[STEP_07] Re-run detected: ${existingRows.length} existing rows for project ${projectId}`);
      }
      const recordIds = isRetakeMode
        ? targetScenes.map((s) => retakeMap.get(s.record_id)!.record_id)
        : assignImagePromptRecordIds(projectId, targetScenes.length, existingRows);

      // ── シーンループ ─────────────────────────────────────────────────────────
      let firstUpsertedId = "";
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < targetScenes.length; i++) {
        const scene = targetScenes[i];
        const recordId = recordIds[i];

        logInfo(`[STEP_07] Scene ${scene.scene_no}: ${scene.scene_title} (${recordId})`);

        try {
          // ── テキストフェーズ: Retake はプロンプト再利用、通常は AI 生成 ────────
          let promptFull: string;
          let negativePrompt: string;
          let promptBase: string;
          let promptCharacter: string;
          let promptScene: string;
          let promptComposition: string;

          if (isRetakeMode) {
            // Retake: reuse existing prompt without calling text AI
            const retakeRow = retakeMap.get(scene.record_id)!;
            promptFull        = retakeRow.prompt_full;
            negativePrompt    = retakeRow.negative_prompt;
            promptBase        = retakeRow.prompt_base;
            promptCharacter   = retakeRow.prompt_character;
            promptScene       = retakeRow.prompt_scene;
            promptComposition = retakeRow.prompt_composition;
            logInfo(`[STEP_07][RETAKE] Reusing prompt_full for ${recordId}`);
          } else {
            // Normal: call text AI → validate schema → build prompt_full
            const prompt = buildStep07Prompt(step07Assets, project, scene, visualBible);
            const geminiResult = await callGemini(prompt, {
              ...geminiOptions,
              maxOutputTokens: 8192,
            });
            logInfo(`[STEP_07] Text generated. model=${geminiResult.modelUsed}`);

            // ── スキーマ検証 ───────────────────────────────────────────────────
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

            const aiRow       = validation.item;
            promptFull        = buildPromptFull(aiRow);
            negativePrompt    = aiRow.negative_prompt;
            promptBase        = aiRow.prompt_base;
            promptCharacter   = aiRow.prompt_character;
            promptScene       = aiRow.prompt_scene;
            promptComposition = aiRow.prompt_composition;
            // character_refs is captured by AI but not stored in GSS (not in field master).
            // Image generation is deferred to STEP_07B which uses prompt_full + character sheets.
          }
          // Image generation is handled by STEP_07B (step07b-image-generate.ts).
          // STEP_07A only writes prompts with generation_status = "PENDING".

          // ── GSS Upsert ─────────────────────────────────────────────────────────
          // generation_status = "PENDING" で書き込む（画像生成は STEP_07B に委譲）。
          // Retake 行: 既存の image_take_1/2 を保持する（STEP_07B が退避・上書きを担当）。
          const row: ImagePromptRow = {
            project_id:              projectId,
            record_id:               recordId,
            generation_status:       "PENDING",
            approval_status:         "PENDING",
            step_id:                 "STEP_07_IMAGE_PROMPTS",
            scene_no:                scene.scene_no,
            related_version:         scene.record_id,
            prompt_base:             promptBase,
            prompt_character:        promptCharacter,
            prompt_scene:            promptScene,
            prompt_composition:      promptComposition,
            negative_prompt:         negativePrompt,
            prompt_full:             promptFull,
            image_take_1:            isRetakeMode
                                       ? (retakeMap.get(scene.record_id)?.image_take_1 ?? "")
                                       : "",
            image_take_2:            isRetakeMode
                                       ? (retakeMap.get(scene.record_id)?.image_take_2 ?? "")
                                       : "",
            image_take_3:            "",
            selected_asset:          "",
            revision_note:           "",
            style_consistency_check: "",
            updated_at:              nowIso,
            updated_by:              "github_actions",
            notes:                   "",
          };

          if (payload.dry_run) {
            logInfo(`[STEP_07A][DRY_RUN] Would upsert prompt (PENDING): ${recordId} (scene: ${scene.scene_title})`);
            logInfo(`[STEP_07A][DRY_RUN] prompt_full preview: ${promptFull.slice(0, 200)}`);
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

        // ── シーン間 delay（クォータ枯渇防止）────────────────────────────────
        if (sceneDelayMs > 0 && i < targetScenes.length - 1 && !payload.dry_run) {
          logInfo(`[STEP_07] Waiting ${sceneDelayMs}ms before next scene...`);
          await new Promise<void>((resolve) => setTimeout(resolve, sceneDelayMs));
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
        `Image Prompts Build (STEP_07A) complete: success=${successCount}, fail=${failCount}, ` +
        `total=${targetScenes.length}, project=${projectId}. Run STEP_07B to generate images.`;
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
