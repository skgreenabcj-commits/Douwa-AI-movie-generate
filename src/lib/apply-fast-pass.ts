/**
 * apply-fast-pass.ts
 *
 * fast-pass 条件判定と補正を行う。
 * config/fast_pass_logic_v1.md の定義に従って実装する。
 *
 * fast-pass の原則（fast_pass_logic_v1.md より）:
 * - source_url のドメイン一致を起点に判定
 * - AI が BLOCKED または risk_level=HIGH の場合は適用しない
 * - 翻訳者・編者・注釈者・挿絵など別権利懸念がある場合は適用しない
 * - 個別注意書き・特殊利用条件がある場合は適用しない
 * - 適用時も notes に適用根拠を残す
 *
 * 初期対象: www.aozora.gr.jp
 */

import type { RightsValidationFullRow } from "../types.js";

export interface FastPassResult {
  applied: boolean;
  reason: string;
  row: RightsValidationFullRow;
}

/**
 * fast-pass を評価し、条件を満たす場合に補正を適用する。
 *
 * @param row       - normalize 済みの full row
 * @param sourceUrl - 00_Project から取得した source_url
 * @returns 補正後の row と適用有無
 */
export function applyFastPass(
  row: RightsValidationFullRow,
  sourceUrl: string
): FastPassResult {
  const domain = extractDomain(sourceUrl);

  // ─── aozora.gr.jp ────────────────────────────────────────────────────────
  if (domain === "www.aozora.gr.jp") {
    return evaluateAozoraFastPass(row, sourceUrl);
  }

  // 他ドメインは現時点では fast-pass なし
  return {
    applied: false,
    reason: `Domain "${domain}" is not covered by any fast-pass rule.`,
    row,
  };
}

// ─── aozora.gr.jp fast-pass ──────────────────────────────────────────────────

function evaluateAozoraFastPass(
  row: RightsValidationFullRow,
  sourceUrl: string
): FastPassResult {
  const skipReasons: string[] = [];

  // 適用しない条件のチェック
  if (row.rights_status === "BLOCKED") {
    skipReasons.push("AI returned rights_status=BLOCKED");
  }
  if (row.risk_level === "HIGH") {
    skipReasons.push("AI returned risk_level=HIGH");
  }

  // 翻訳者別権利懸念: is_translation=Y かつ translator が存在する場合
  if (row.is_translation === "Y" && row.translator.trim() !== "") {
    skipReasons.push(
      "Translation detected (is_translation=Y with translator name) — separate rights risk"
    );
  }

  // translator_pd_jp が N または UNKNOWN の場合も慎重に
  if (row.is_translation === "Y" && row.translator_pd_jp !== "Y") {
    skipReasons.push(
      `Translator rights are uncertain (translator_pd_jp=${row.translator_pd_jp})`
    );
  }

  // other_rights_risk が空でない場合
  if (row.other_rights_risk.trim() !== "") {
    skipReasons.push(
      "Other rights risk noted by AI — cannot auto-approve via fast-pass"
    );
  }

  // war_addition_risk が空でない場合
  if (row.war_addition_risk.trim() !== "") {
    skipReasons.push("War-era addition risk noted by AI");
  }

  if (skipReasons.length > 0) {
    const reason = `fast-pass skipped for aozora.gr.jp: ${skipReasons.join("; ")}`;
    return { applied: false, reason, row };
  }

  // ─── 補正適用 ────────────────────────────────────────────────────────────
  const fastPassNote =
    `[fast-pass applied: aozora.gr.jp] ` +
    `Source: ${sourceUrl} — ` +
    `青空文庫収録ファイル取扱規準・朗読配信案内に基づき、` +
    `著作権保護期間満了作品として fast-pass 補正候補と判定。` +
    `人間レビューにより最終確認すること。`;

  const correctedRow: RightsValidationFullRow = {
    ...row,
    rights_status: "APPROVED",
    risk_level: "LOW",
    review_required: "N",
    go_next: "Y",
    notes: row.notes
      ? `${row.notes}\n${fastPassNote}`
      : fastPassNote,
  };

  return {
    applied: true,
    reason: `fast-pass applied for domain: www.aozora.gr.jp`,
    row: correctedRow,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
