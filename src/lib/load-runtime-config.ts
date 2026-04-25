/**
 * load-runtime-config.ts
 *
 * 94_Runtime_Config シートを読み込み、key → value の Map を返す。
 * enabled=FALSE の行はスキップする。
 */

import { readSheet } from "./sheets-client.js";
import type { RuntimeConfigMap } from "../types.js";

const SHEET_NAME = "94_Runtime_Config";

/**
 * 94_Runtime_Config を読み込んで RuntimeConfigMap を返す。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @returns key → value の Map
 */
export async function loadRuntimeConfig(
  spreadsheetId: string
): Promise<RuntimeConfigMap> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);

  const configMap: RuntimeConfigMap = new Map();

  // デバッグ: 読み込んだ生の行データを出力（調査用）
  console.error("[DEBUG] 94_Runtime_Config raw rows (first 3):", JSON.stringify(rows.slice(0, 3)));
  console.error("[DEBUG] 94_Runtime_Config all keys:", rows.map(r => r["key"]).filter(Boolean));

  for (const row of rows) {
    const key = (row["key"] ?? "").trim();
    const value = (row["value"] ?? "").trim();
    const enabled = (row["enabled"] ?? "TRUE").trim().toUpperCase();

    if (!key) continue;
    if (enabled === "FALSE") continue;

    // デバッグ: モデル関連のキーのみ詳細出力
    if (key.includes("model") || key.includes("gemini")) {
      console.error(`[DEBUG] config row: key="${key}", value="${value}", enabled="${enabled}", raw_row=${JSON.stringify(row)}`);
    }

    configMap.set(key, value);
  }

  // ── 環境変数オーバーライド ──────────────────────────────────────────────
  // 各 Secret が設定されている場合、GSS の値を上書きする。
  // GitHub Secret を run-step.yml 経由で渡すことで GSS を編集せずに切り替えられる。

  // プライマリモデルのオーバーライド（RPD 上限枯渇時などに使用）
  // step_01_model_role / step_02_model_role の両方を同じ値で上書きする
  const primaryModelOverride = (process.env["GEMINI_PRIMARY_MODEL_OVERRIDE"] ?? "").trim();
  if (primaryModelOverride) {
    console.error(`[INFO] GEMINI_PRIMARY_MODEL_OVERRIDE detected — overriding primary models to: ${primaryModelOverride}`);
    configMap.set("step_01_model_role", primaryModelOverride);
    configMap.set("step_02_model_role", primaryModelOverride);
  }

  return configMap;
}

/**
 * RuntimeConfigMap から必須キーを取り出す。
 * 存在しない場合はフォールバック値を返す（指定なければエラーを投げる）。
 */
export function getConfigValue(
  configMap: RuntimeConfigMap,
  key: string,
  fallback?: string
): string {
  const value = configMap.get(key);
  if (value !== undefined && value !== "") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`94_Runtime_Config: required key "${key}" is missing or empty.`);
}
