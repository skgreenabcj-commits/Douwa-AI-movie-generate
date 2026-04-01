/**
 * normalize-ai-row.ts
 *
 * AI が返した RightsValidationAiRow を、
 * Google Sheets に書き込む RightsValidationFullRow に変換する。
 *
 * システム管理フィールド（project_id, record_id, generation_status 等）は
 * ここで設定する。
 */

import type {
  RightsValidationAiRow,
  RightsValidationFullRow,
} from "../types.js";

/**
 * AI row + システムメタデータを組み合わせて full row を組み立てる。
 *
 * @param aiRow     - AI バリデーション済みの行
 * @param projectId - 処理中の project_id
 * @param recordId  - 採番済み or 既存の record_id（upsert 前には空文字でも可）
 * @param now       - 現在時刻の ISO 文字列
 */
export function normalizeAiRow(
  aiRow: RightsValidationAiRow,
  projectId: string,
  recordId: string,
  now: string
): RightsValidationFullRow {
  return {
    // ─── System fields ────────────────────────────────────────────────────
    project_id: projectId,
    record_id: recordId, // upsert 側で上書き確定する
    generation_status: "GENERATED",
    approval_status: "PENDING",
    step_id: "STEP_01",

    // ─── AI output fields ────────────────────────────────────────────────
    is_translation: aiRow.is_translation,
    original_author: aiRow.original_author,
    original_author_birth_year: aiRow.original_author_birth_year,
    original_author_death_year: aiRow.original_author_death_year,
    translator: aiRow.translator,
    translator_birth_year: aiRow.translator_birth_year,
    translator_death_year: aiRow.translator_death_year,
    aozora_rights_note: aiRow.aozora_rights_note,
    cc_license_present: aiRow.cc_license_present,
    cc_license_type: aiRow.cc_license_type,
    public_domain_candidate: aiRow.public_domain_candidate,
    original_author_pd_jp: aiRow.original_author_pd_jp,
    translator_pd_jp: aiRow.translator_pd_jp,
    other_rights_risk: aiRow.other_rights_risk,
    war_addition_risk: aiRow.war_addition_risk,
    rights_evidence_url_1: aiRow.rights_evidence_url_1,
    rights_evidence_url_2: aiRow.rights_evidence_url_2,
    rights_evidence_url_3: aiRow.rights_evidence_url_3,
    rights_summary: aiRow.rights_summary,
    rights_status: aiRow.rights_status,
    risk_level: aiRow.risk_level,
    review_required: aiRow.review_required,

    // ─── Review fields（初期値は空、人間が後から記入） ──────────────────
    checked_by: "",
    checked_date: "",
    reviewer: "AI",
    review_date: now.slice(0, 10).replace(/-/g, "/"), // YYYY/MM/DD
    go_next: aiRow.rights_status === "APPROVED" ? "Y" : "",

    // ─── Update tracking ─────────────────────────────────────────────────
    updated_at: now,
    updated_by: "github_actions",
    notes: "",
  };
}
