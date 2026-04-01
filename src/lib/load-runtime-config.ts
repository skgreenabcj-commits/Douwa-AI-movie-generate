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
  console.log("[DEBUG] 94_Runtime_Config raw rows (first 3):", JSON.stringify(rows.slice(0, 3)));
  console.log("[DEBUG] 94_Runtime_Config all keys:", rows.map(r => r["key"]).filter(Boolean));

  for (const row of rows) {
    const key = (row["key"] ?? "").trim();
    const value = (row["value"] ?? "").trim();
    const enabled = (row["enabled"] ?? "TRUE").trim().toUpperCase();

    if (!key) continue;
    if (enabled === "FALSE") continue;

    // デバッグ: モデル関連のキーのみ詳細出力
    if (key.includes("model") || key.includes("gemini")) {
      console.log(`[DEBUG] config row: key="${key}", value="${value}", enabled="${enabled}", raw_row=${JSON.stringify(row)}`);
    }

    configMap.set(key, value);
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
