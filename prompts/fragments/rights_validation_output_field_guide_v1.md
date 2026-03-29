出力JSONの rows[0] には、以下のフィールドのみを含めてください。
不明な場合は、指定のルールに従って空文字または UNKNOWN を返してください。
説明文や補足文を値に含めないでください。

- is_translation: "Y" / "N" / "UNKNOWN"
  - 翻訳作品と判断できる場合は "Y"
  - 翻訳ではないと判断できる場合は "N"
  - 判断根拠が弱い場合は "UNKNOWN"

- original_author: 原著者名
  - 人名のみ
  - 不明な場合は空文字

- original_author_birth_year: 原著者の生年
  - "YYYY" 形式の数字4桁を優先
  - 年が特定できない場合は空文字
  - 説明文や「頃」は書かない

- original_author_death_year: 原著者の没年
  - "YYYY" 形式の数字4桁を優先
  - 年が特定できない場合は空文字
  - 説明文や「頃」は書かない

- translator: 翻訳者名
  - 人名のみ
  - 翻訳者不明または翻訳でない場合は空文字

- translator_birth_year: 翻訳者の生年
  - "YYYY" 形式の数字4桁を優先
  - 不明な場合は空文字

- translator_death_year: 翻訳者の没年
  - "YYYY" 形式の数字4桁を優先
  - 不明な場合は空文字

- aozora_rights_note: 青空文庫等の権利注記に関する簡潔な整理
  - 1文または2文程度
  - 断定しない

- cc_license_present: "Y" / "N" / "UNKNOWN"
  - CCライセンス表記の存在が確認できる場合のみ "Y"
  - 見当たらない場合は "N"
  - 判断できない場合は "UNKNOWN"

- cc_license_type: CCライセンス種別
  - 例: "CC BY 4.0"
  - 不明な場合は空文字

- public_domain_candidate: "Y" / "N" / "UNKNOWN"
  - パブリックドメインの根拠が比較的明確な場合のみ "Y"
  - 保護中の可能性が高い場合は "N"
  - 根拠不足なら "UNKNOWN"

- original_author_pd_jp: "Y" / "N" / "UNKNOWN"
  - 日本で原著者の著作権が満了している根拠が比較的明確なら "Y"
  - 保護中の可能性が高いなら "N"
  - 不明なら "UNKNOWN"

- translator_pd_jp: "Y" / "N" / "UNKNOWN"
  - 日本で翻訳者の権利が満了している根拠が比較的明確なら "Y"
  - 保護中の可能性が高いなら "N"
  - 不明なら "UNKNOWN"

- other_rights_risk: その他の権利上の懸念
  - 例: 注釈、編集、解説、挿絵、編者追記
  - なければ空文字

- war_addition_risk: 戦後加筆や後年編集等の懸念
  - 懸念がなければ空文字

- rights_evidence_url_1: 根拠URLその1
  - URLのみ
  - なければ空文字

- rights_evidence_url_2: 根拠URLその2
  - URLのみ
  - なければ空文字

- rights_evidence_url_3: 根拠URLその3
  - URLのみ
  - なければ空文字

- rights_summary: 権利確認の要約
  - 日本語
  - 250文字以内
  - 非断定的
  - 「確認できたこと」「未確認事項」「懸念点」「次の確認事項」を優先

- rights_status: "APPROVED" / "NEEDS_REVIEW" / "BLOCKED" / "UNKNOWN"
  - 根拠が比較的明確で大きな懸念が少ない場合のみ "APPROVED"
  - 追加確認や人判断が必要なら "NEEDS_REVIEW"
  - 明確な権利懸念が強い場合は "BLOCKED"
  - 情報不足で暫定評価が固まりにくい場合は "UNKNOWN"

- risk_level: "LOW" / "MEDIUM" / "HIGH" / "UNKNOWN"
  - LOW: 大きな懸念が少ない
  - MEDIUM: 注意点や確認事項がある
  - HIGH: 明確な懸念が強い
  - UNKNOWN: 情報不足で評価困難

- review_required: "Y" / "N"
  - 少しでも不確実性がある場合は "Y"
  - 根拠が比較的明確で追加確認が実質不要な場合のみ "N"
