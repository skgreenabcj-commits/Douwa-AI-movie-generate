/**
 * step04-05-script-build.ts
 *
 * STEP_04_05_COMBINED Script Build のオーケストレーター。
 *
 * 処理フロー（設計仕様書 step04_05_implementation_spec_v0.1.md §6 準拠）:
 *
 * 1. 94_Runtime_Config を読む
 * 2. 00_Project から対象案件を読む
 * 3. video_format を取得（"short" | "full" | "short+full"）
 * 4. 02_Scenes から scene master を読む（generation_status=GENERATED のみ）
 *    → 0 件の場合はエラー停止
 *
 * ─── STEP_05 Full Script Build ───────────────────────────────────────────────
 * 5. full_use=Y の scene のみを抽出
 * 6. assets をロード（script_full_prompt, schema, example, field_guide）
 * 7. buildStep05Prompt でプロンプト組み立て
 * 8. Gemini 呼び出し（一括生成: maxOutputTokens=32768）
 * 9. AI 出力を schema 検証
 * 10. record_id 突合（順序ズレ検出 + インデックスフォールバック）
 * 11. 各 scene の ScriptFullRow を組み立て upsertScriptFull
 *     - duration_sec: Math.ceil(narration_tts.length / 5.5)
 *     - emotion: 02_Scenes.emotion をコピー（論点1）
 * 12. 00_Project を最小更新（current_step = "STEP_05_FULL_SCRIPT_BUILD"）
 * 13. 成功ログ
 *
 * ─── STEP_04 Short Script Build ──────────────────────────────────────────────
 * 14. short_use=Y の scene のみを抽出
 * 15. video_format = "short+full" の場合: 04_Script_Full から Full Script を任意読み込み
 *     hasFullScript = (results.length > 0)
 * 16. assets をロード（script_short_prompt, schema, example, field_guide）
 * 17. buildStep04Prompt でプロンプト組み立て
 * 18. Gemini 呼び出し
 * 19. AI 出力を schema 検証
 * 20. record_id 突合
 * 21. 各 scene の ScriptShortRow を組み立て upsertScriptShort
 * 22. 00_Project を最小更新（状態に応じた current_step）
 * 23. 成功ログ
 *
 * ─── 完了後処理 ───────────────────────────────────────────────────────────────
 * 24. 両方成功: current_step = "STEP_04_05_COMBINED"
 *     Full のみ成功: current_step = "STEP_05_FULL_SCRIPT_BUILD"（step 12 で設定済み）
 *     Short のみ成功: current_step = "STEP_04_SHORT_SCRIPT_BUILD"
 *     両方失敗: current_step は更新しない
 *
 * dry_run=true の場合:
 *   Gemini 呼び出しをスキップし、プロンプトプレビューのみ出力する。
 */

import type {
  WorkflowPayload,
  ProjectMinimalPatch,
  SceneReadRow,
  ScriptFullRow,
  ScriptShortRow,
} from "../types.js";
import { loadRuntimeConfig } from "../lib/load-runtime-config.js";
import { readProjectsByIds } from "../lib/load-project-input.js";
import { loadScenesByProjectId } from "../lib/load-scenes.js";
import { loadFullScriptByProjectId } from "../lib/load-script.js";
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
} from "../lib/write-app-log.js";
import { logInfo, logError } from "../lib/logger.js";

// ─── duration_sec 計算ロジック ────────────────────────────────────────────────

/**
 * narration_tts の文字数から duration_sec を概算する。
 * 読み速度: 5.5 文字/秒（日本語音読の一般的な平均）
 * 結果は Math.ceil で整数化（切り上げ）する（不明点3）。
 */
function calcDurationSec(narrationTts: string): number {
  return Math.ceil(narrationTts.length / 5.5);
}

// ─── record_id 突合ロジック ───────────────────────────────────────────────────

type AiRow = { record_id: string; [key: string]: unknown };

/**
 * AI 出力の各要素が持つ record_id と、事前に取得した SceneReadRow[] の record_id を照合する。
 * 突合できなかった要素は配列インデックス順でフォールバック（設計仕様書 §6.3 準拠）。
 */
function matchAiOutputToScenes<T extends AiRow>(
  aiRows: T[],
  sceneRows: SceneReadRow[]
): Array<{ ai: T; scene: SceneReadRow }> {
  const sceneMap = new Map<string, SceneReadRow>(
    sceneRows.map((s) => [s.record_id, s])
  );

  const result: Array<{ ai: T; scene: SceneReadRow }> = [];
  let mismatchCount = 0;

  for (let i = 0; i < aiRows.length; i++) {
    const ai = aiRows[i];
    const byId = sceneMap.get(ai.record_id);

    if (byId) {
      result.push({ ai, scene: byId });
    } else {
      // フォールバック: インデックス順で紐付け
      mismatchCount++;
      const fallbackScene = sceneRows[i];
      if (fallbackScene) {
        logError(
          `record_id_mismatch: AI output[${i}].record_id="${ai.record_id}" not found in scenes. ` +
            `Falling back to scene[${i}].record_id="${fallbackScene.record_id}".`
        );
        result.push({ ai, scene: fallbackScene });
      } else {
        logError(
          `record_id_mismatch: AI output[${i}].record_id="${ai.record_id}" has no fallback scene.`
        );
      }
    }
  }

  if (aiRows.length !== sceneRows.length) {
    logError(
      `scene_count_mismatch: AI output has ${aiRows.length} rows, but scenes have ${sceneRows.length} rows.`
    );
  }

  if (mismatchCount > 0) {
    logError(`record_id_mismatch: ${mismatchCount} row(s) fell back to index order.`);
  }

  return result;
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

  // ─── 1. Runtime Config ──────────────────────────────────────────────────
  const configMap = await loadRuntimeConfig(spreadsheetId);
  logInfo("94_Runtime_Config loaded", { size: configMap.size });

  const geminiOptionsStep05 = buildGeminiOptionsStep05(configMap);
  const geminiOptionsStep04 = buildGeminiOptionsStep04(configMap);

  // ─── 2. 対象案件を読む（max_items でスライス）────────────────────────────
  const targetIds = payload.project_ids.slice(0, payload.max_items);
  const projects = await readProjectsByIds(spreadsheetId, targetIds);

  if (projects.length === 0) {
    logInfo("No matching projects found. STEP_04_05 finished with no-op.", {
      project_ids: targetIds,
    });
    return;
  }

  // ─── 3. assets は一度だけ読む ────────────────────────────────────────────
  const step05Assets = loadStep05Assets();
  const step04Assets = loadStep04Assets();
  logInfo("STEP_04_05 assets loaded from repo.");

  // ─── 4. 案件を逐次処理 ──────────────────────────────────────────────────
  for (const project of projects) {
    const projectId = project.project_id;
    const projectRecordId = project.record_id;
    const now = new Date().toISOString();

    logInfo(`Processing project: ${projectId}`);

    // video_format チェック
    const videoFormat = (project.video_format ?? "").trim();
    if (!["short", "full", "short+full"].includes(videoFormat)) {
      const msg = `Invalid video_format="${videoFormat}". Must be "short", "full", or "short+full".`;
      logError(msg);
      try {
        await appendAppLog(
          spreadsheetId,
          buildStep05FailureLog(projectId, projectRecordId, "invalid_video_format", msg)
        );
      } catch (_) { /* ログ書き込み失敗は無視して次へ */ }
      continue;
    }

    const runFull  = videoFormat === "full"  || videoFormat === "short+full";
    const runShort = videoFormat === "short" || videoFormat === "short+full";

    // ─── 4. 02_Scenes から scene master を読む ────────────────────────────
    let allScenes: SceneReadRow[] = [];
    try {
      allScenes = await loadScenesByProjectId(spreadsheetId, projectId);
    } catch (e) {
      const msg = `Failed to load 02_Scenes: ${e instanceof Error ? e.message : String(e)}`;
      logError(msg);
      try {
        await appendAppLog(
          spreadsheetId,
          buildStep05FailureLog(projectId, projectRecordId, "load_scenes_failure", msg)
        );
      } catch (_) { /* ignore */ }
      continue;
    }

    if (allScenes.length === 0) {
      const msg = `No GENERATED scenes found in 02_Scenes for project_id="${projectId}".`;
      logError(msg);
      try {
        await appendAppLog(
          spreadsheetId,
          buildStep05FailureLog(projectId, projectRecordId, "no_scenes", msg)
        );
      } catch (_) { /* ignore */ }
      continue;
    }

    logInfo(`02_Scenes loaded. total=${allScenes.length} for project="${projectId}".`);

    let fullSuccess = false;
    let shortSuccess = false;

    // ─────────────────────────────────────────────────────────────────────
    // STEP_05 Full Script Build
    // ─────────────────────────────────────────────────────────────────────
    if (runFull) {
      try {
        const fullScenes = allScenes.filter((s) => s.full_use === "Y");
        const fullUseCount = fullScenes.length;
        const totalSceneCount = allScenes.length;

        logInfo(
          `[STEP_05] Starting Full Script Build. ` +
            `full_use_count=${fullUseCount}, total_scene_count=${totalSceneCount}`
        );

        // dry_run: プロンプトプレビューのみ
        if (payload.dry_run) {
          const previewPrompt = buildStep05Prompt(step05Assets, project, fullScenes);
          console.log("[DRY_RUN][STEP_05] Full Script Prompt Preview:");
          console.log("--- PROMPT START ---");
          console.log(previewPrompt.slice(0, 2000));
          console.log("--- PROMPT END (truncated at 2000 chars) ---");
          fullSuccess = true; // dry_run は成功扱い
        } else {
          // Gemini 呼び出し
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

          // Schema バリデーション
          const validation = validateScriptFullAiResponse(
            geminiResult.text,
            step05Assets.aiSchema
          );

          if (!validation.success) {
            const msg =
              `[STEP_05] schema_validation_failure: ${validation.errors}. ` +
              `rawText head: ${geminiResult.text.slice(0, 200)}`;
            logError(msg);
            await appendAppLog(
              spreadsheetId,
              buildStep05FailureLog(
                projectId,
                projectRecordId,
                "schema_validation_failure",
                msg
              )
            );
            // Full が失敗しても Short は継続する（エラーハンドリング表 §12 準拠）
          } else {
            // record_id 突合
            const matched = matchAiOutputToScenes(validation.scripts, fullScenes);

            // GSS へ upsert
            const nowStr = new Date().toISOString();
            let scriptCount = 0;
            let durationTotal = 0;

            for (const { ai, scene } of matched) {
              const durationSec = calcDurationSec(ai.narration_tts);
              durationTotal += durationSec;

              const fullRow: ScriptFullRow = {
                project_id:        projectId,
                record_id:         scene.record_id,
                generation_status: "GENERATED",
                approval_status:   "PENDING",
                step_id:           "STEP_05_FULL_SCRIPT_BUILD",
                scene_no:          scene.scene_no,
                related_version:   "full",
                duration_sec:      durationSec,
                narration_draft:   ai.narration_draft,
                narration_tts:     ai.narration_tts,
                subtitle_short_1:  ai.subtitle_short_1,
                subtitle_short_2:  ai.subtitle_short_2 ?? "",
                visual_emphasis:   ai.visual_emphasis ?? "",
                pause_hint:        ai.pause_hint,
                emotion:           scene.emotion,   // 論点1: 02_Scenes.emotion をコピー
                hook_flag:         "",
                tts_ready:         "",
                updated_at:        nowStr,
                updated_by:        "github_actions",
                notes:             "",
              };

              const upsertedId = await upsertScriptFull(spreadsheetId, fullRow);
              logInfo(`[STEP_05] upserted record_id="${upsertedId}", scene_no="${scene.scene_no}"`);
              scriptCount++;
            }

            // 00_Project 最小更新
            const patch: ProjectMinimalPatch = {
              current_step:    "STEP_05_FULL_SCRIPT_BUILD",
              approval_status: "PENDING",
              updated_at:      nowStr,
              updated_by:      "github_actions",
            };
            await updateProjectMinimal(spreadsheetId, projectId, patch);

            // 成功ログ
            const successMsg =
              `STEP_05 completed. model=${geminiResult.modelUsed}, ` +
              `usedFallback=${geminiResult.usedFallback}, ` +
              `script_count=${scriptCount}, duration_sec_total=${durationTotal}`;
            await appendAppLog(
              spreadsheetId,
              buildStep05SuccessLog(projectId, projectRecordId, successMsg)
            );

            logInfo(`[STEP_05] Success. ${successMsg}`);
            fullSuccess = true;
          }
        }
      } catch (e) {
        if (e instanceof GeminiSpendingCapError) {
          logError(`[STEP_05] SpendingCapError. Stopping all remaining projects.`);
          throw e; // 上位に伝播してプロセス停止
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
      try {
        const shortScenes = allScenes.filter((s) => s.short_use === "Y");
        const shortUseCount = shortScenes.length;

        // 04_Script_Full を任意参照（不明点1: video_format = "short+full" のみ）
        let fullScripts: import("../types.js").ScriptFullReadRow[] = [];
        let hasFullScript = false;

        if (videoFormat === "short+full") {
          try {
            fullScripts = await loadFullScriptByProjectId(spreadsheetId, projectId);
            hasFullScript = fullScripts.length > 0;
          } catch (_) {
            logInfo("[STEP_04] loadFullScriptByProjectId failed. Proceeding without Full reference.");
            hasFullScript = false;
          }
        }

        logInfo(
          `[STEP_04] Starting Short Script Build. ` +
            `short_use_count=${shortUseCount}, has_full_script=${hasFullScript}`
        );

        if (shortScenes.length === 0) {
          logInfo(`[STEP_04] No short_use=Y scenes. Skipping Short Script Build.`);
          // Short スキップは失敗ではなく no-op
        } else if (payload.dry_run) {
          const previewPrompt = buildStep04Prompt(step04Assets, project, shortScenes, fullScripts);
          console.log("[DRY_RUN][STEP_04] Short Script Prompt Preview:");
          console.log("--- PROMPT START ---");
          console.log(previewPrompt.slice(0, 2000));
          console.log("--- PROMPT END (truncated at 2000 chars) ---");
          shortSuccess = true;
        } else {
          // Gemini 呼び出し
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

          // Schema バリデーション
          const validation = validateScriptShortAiResponse(
            geminiResult.text,
            step04Assets.aiSchema
          );

          if (!validation.success) {
            const msg =
              `[STEP_04] schema_validation_failure: ${validation.errors}. ` +
              `rawText head: ${geminiResult.text.slice(0, 200)}`;
            logError(msg);
            await appendAppLog(
              spreadsheetId,
              buildStep04FailureLog(
                projectId,
                projectRecordId,
                "schema_validation_failure",
                msg
              )
            );
          } else {
            // record_id 突合
            const matched = matchAiOutputToScenes(validation.scripts, shortScenes);

            // GSS へ upsert
            const nowStr = new Date().toISOString();
            let scriptCount = 0;

            for (const { ai, scene } of matched) {
              const durationSec = calcDurationSec(ai.narration_tts);

              const shortRow: ScriptShortRow = {
                project_id:        projectId,
                record_id:         scene.record_id,
                generation_status: "GENERATED",
                approval_status:   "PENDING",
                step_id:           "STEP_04_SHORT_SCRIPT_BUILD",
                scene_no:          scene.scene_no,
                related_version:   "short",
                duration_sec:      durationSec,
                narration_draft:   ai.narration_draft,
                narration_tts:     ai.narration_tts,
                subtitle_short_1:  ai.subtitle_short_1,
                subtitle_short_2:  ai.subtitle_short_2 ?? "",
                emphasis_word:     ai.emphasis_word ?? "",
                transition_note:   ai.transition_note,
                emotion:           scene.emotion,   // 論点1: 02_Scenes.emotion をコピー
                hook_flag:         "",
                tts_ready:         "",
                updated_at:        nowStr,
                updated_by:        "github_actions",
                notes:             "",
              };

              const upsertedId = await upsertScriptShort(spreadsheetId, shortRow);
              logInfo(`[STEP_04] upserted record_id="${upsertedId}", scene_no="${scene.scene_no}"`);
              scriptCount++;
            }

            // 00_Project 最小更新（current_step は後で統合判定）
            const nowStr2 = new Date().toISOString();
            const currentStepShort = fullSuccess
              ? "STEP_04_05_COMBINED"
              : "STEP_04_SHORT_SCRIPT_BUILD";

            const patch: ProjectMinimalPatch = {
              current_step:    currentStepShort,
              approval_status: "PENDING",
              updated_at:      nowStr2,
              updated_by:      "github_actions",
            };
            await updateProjectMinimal(spreadsheetId, projectId, patch);

            // 成功ログ
            const successMsg =
              `STEP_04 completed. model=${geminiResult.modelUsed}, ` +
              `usedFallback=${geminiResult.usedFallback}, ` +
              `script_count=${scriptCount}, has_full_script=${hasFullScript}`;
            await appendAppLog(
              spreadsheetId,
              buildStep04SuccessLog(projectId, projectRecordId, successMsg)
            );

            logInfo(`[STEP_04] Success. ${successMsg}`);
            shortSuccess = true;
          }
        }
      } catch (e) {
        if (e instanceof GeminiSpendingCapError) {
          logError(`[STEP_04] SpendingCapError. Stopping all remaining projects.`);
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
      }
    }

    // ─── partial success / 両方完了 ─────────────────────────────────────────
    if (runFull && runShort) {
      if (fullSuccess && shortSuccess) {
        logInfo(`[STEP_04_05] Both Full and Short completed. current_step=STEP_04_05_COMBINED`);
        // current_step は STEP_04 の updateProjectMinimal で STEP_04_05_COMBINED が設定済み
      } else if (fullSuccess && !shortSuccess) {
        logInfo(`[STEP_04_05] Partial success: Full=success, Short=fail. current_step=STEP_05_FULL_SCRIPT_BUILD`);
        try {
          await appendAppLog(
            spreadsheetId,
            buildStep05SuccessLog(
              projectId,
              projectRecordId,
              `[WARN][partial_success] Full=success, Short=fail`
            )
          );
        } catch (_) { /* ignore */ }
      } else if (!fullSuccess && shortSuccess) {
        logInfo(`[STEP_04_05] Partial success: Full=fail, Short=success. current_step=STEP_04_SHORT_SCRIPT_BUILD`);
        try {
          await appendAppLog(
            spreadsheetId,
            buildStep04SuccessLog(
              projectId,
              projectRecordId,
              `[WARN][partial_success] Full=fail, Short=success`
            )
          );
        } catch (_) { /* ignore */ }
      } else {
        logError(`[STEP_04_05] Both Full and Short failed. current_step not updated.`);
      }
    }

    logInfo(`STEP_04_05 finished for project: ${projectId}`);
  }

  logInfo("STEP_04_05 Script Build completed for all projects.");
}
