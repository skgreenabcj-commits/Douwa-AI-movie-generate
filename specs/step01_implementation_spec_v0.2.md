# STEP_01 実装仕様 v0.2

## 1. 目的
本ドキュメントは、GitHub 上で実行する STEP_01（Rights Validation）の初期実装仕様を定義するための合意用仕様書である。  
対象は、Google Sheets 上の案件情報を入力として、Gemini を用いた権利確認を実行し、結果を `00_Rights_Validation` および `00_Project` に書き戻す処理である。

本書は以下を目的とする。
- STEP_01 の初期実装範囲を明確化する
- GAS → GitHub Actions → Google Sheets API の実行経路を固定する
- AI 出力、GitHub 補完、fast-pass 適用の責務分担を明確化する
- 未確定論点を整理し、実装に必要な前提を固定する

---

## 2. スコープ
本仕様の対象範囲は以下とする。
- 起動: GAS から GitHub Actions を `workflow_dispatch` で起動
- 入力: `00_Project` から 1 件または複数件の案件を読み込む
- AI 実行: Gemini API を利用して rights validation を行う
- 出力:
  - `00_Rights_Validation` に権利確認結果を書き込む
  - `00_Project` に案件側の最小状態更新を書き戻す
  - `100_App_Logs` に成功・失敗ログを書き出す
- fast-pass: `config/fast_pass_logic_v1.md` に基づき適用する
- ランタイム設定: `94_Runtime_Config` から取得する

本仕様では、以下は初期スコープ外とする。
- Webhook 受信
- 履歴バージョン管理の高度化
- 大量バッチ最適化
- Secrets fallback の本格実装
- STEP 横断の汎用実行基盤化

---

## 3. 実行方式

### 3.1 基本方針
- 起動元は GAS とする
- 実行先は GitHub Actions とする
- GitHub Actions は Google Sheets API を直接利用して GSS を read/write する
- GitHub → GSS の戻しに Webhook は使わない
- 認証は Service Account を使用する
- 実行単位は `project_id` ベースとする

### 3.2 実行経路
1. 人が `00_Project` を管理する
2. GAS 実行前に、対象案件の `project_id` はシート側で採番済みである
3. GAS が `workflow_dispatch` で GitHub Actions を起動する
4. GitHub Actions が `94_Runtime_Config` を読む
5. GitHub Actions が payload に基づいて `00_Project` から対象案件を読む
6. Prompt / Policy / Schema / Example を読み込む
7. Gemini を実行する
8. AI 出力を schema 検証する
9. fast-pass を適用する
10. `00_Rights_Validation` に full row を upsert する
11. `00_Project` に最小状態更新を反映する
12. `100_App_Logs` に成功・失敗ログを書き出す

---

## 4. 入力

### 4.1 主入力シート
- `00_Project`

### 4.2 主キー
- `project_id`

### 4.3 `project_id` 採番方針
- `project_id` は GitHub では採番しない
- `00_Project` は人手管理シートとする
- GAS 実行前に、対象案件の `project_id` はシート運用側で自動採番済みであることを前提とする

### 4.4 `project_id` 採番規則
- 形式: `PJT-###`
- `###` は 3 桁固定数字
- 例: `PJT-001`, `PJT-002`

### 4.5 AI に渡す `00_Project` 入力列
初期実装で Gemini に渡す `00_Project` の入力列は以下のみとする。
- `title_jp`
- `source_url`

### 4.6 payload と AI 入力の違い
payload は、GAS から GitHub Actions に対して「どの案件を処理するか」を伝えるための起動パラメータであり、Gemini に直接渡す本文ではない。  
Gemini に渡す詳細入力情報は、GitHub が payload を受け取った後に `00_Project` を read して組み立てる。

---

## 5. 出力

### 5.1 主出力シート
- `00_Rights_Validation`

### 5.2 補助出力シート
- `00_Project`

### 5.3 ログ出力シート
- `100_App_Logs`

### 5.4 出力責務の分担

#### AI が主に返すもの
- 著者・訳者情報
- 生没年
- public domain candidate 判定
- rights summary
- rights evidence URL
- rights_status の候補
- risk_level の候補
- review_required の候補
- その他 schema で定義された AI 出力項目

#### GitHub システムが補完・確定するもの
- `project_id`
- `record_id`
- `step_id`
- `updated_at`
- `updated_by`
- `notes`
- fast-pass による補正後の最終値
- `00_Project` の最小更新項目
- `100_App_Logs` のログ行

---

## 6. ランタイム設定

### 6.1 設定の取得元
- `94_Runtime_Config`

### 6.2 シートヘッダー
- `key`
- `value`
- `category`
- `data_type`
- `environment`
- `enabled`
- `description`
- `updated_at`
- `updated_by`
- `notes`

### 6.3 取得対象
- Gemini API Key
- STEP_01 primary model
- STEP_01 secondary model
- 必要に応じて温度・実行フラグ等

### 6.4 Runtime Config の key
- Gemini API key: `gemini_api_key`
- STEP_01 primary model key: `[PLACEHOLDER: 例 model_step01_primary]`
- STEP_01 secondary model key: `[PLACEHOLDER: 例 model_step01_secondary]`

### 6.5 Runtime Config の値方針
- primary model: `gemini-2.5-pro`
- secondary model: `gemini-2.0-pro`

### 6.6 方針
初期実装では、Gemini API Key と model は `94_Runtime_Config` を正本として取得する。  
将来的に GitHub Secrets fallback を設ける余地はあるが、v0.2 では必須としない。

---

## 7. AI 実行方針

### 7.1 利用ファイル
想定する利用ファイルは以下。
- Prompt: `prompts/rights_validation_prompt_v1.md`
- Copyright Policy: `prompts/copyright_policy_jp_v1.md`
- Review Policy: `prompts/rights_review_policy_v1.md`
- Output Field Guide: `prompts/fragments/rights_validation_output_field_guide_v1.md`
- AI Schema: `schemas/rights_validation_schema_ai_v1.json`
- Full Schema: `schemas/rights_validation_schema_full_v1.json`
- AI Example: `examples/rights_validation_ai_row_example_v1.json`
- Full Example: `examples/rights_validation_full_row_example_v1.json`
- Fast-pass Logic: `config/fast_pass_logic_v1.md`

### 7.2 出力原則
- AI には schema 準拠 JSON を返させる
- GitHub は JSON parse / schema validation を行う
- validation 失敗時は失敗扱いとし、`00_Project` および `100_App_Logs` に反映する

### 7.3 モデル利用方針
- 初期実装では primary model を優先利用する
- primary 失敗時に secondary への fallback を行うかは実装時に切替可能とする
- fallback の実行有無は Runtime Config またはコード定数で管理してよい

### 7.4 入力最小化方針
初期実装では AI 入力を `title_jp`, `source_url` に限定する。  
このため、rights validation の精度は `source_url` の信頼性と参照先情報に大きく依存する。  
将来的に必要であれば `source_title` などの追加列を検討する。

---

## 8. fast-pass 適用方針

### 8.1 基本方針
- fast-pass は AI 出力を完全に置き換えるものではない
- GitHub 後段処理で限定的な補正候補として適用する
- 判定キーは `source_url` のドメインとする

### 8.2 ルール参照元
- `config/fast_pass_logic_v1.md`

### 8.3 初期実装対象
- `www.aozora.gr.jp`

### 8.4 適用タイミング
1. AI 出力取得
2. schema 検証
3. fast-pass 条件判定
4. 最終 row 組み立て
5. GSS 書き戻し

### 8.5 適用禁止条件
- AI が `BLOCKED` を返した場合
- AI が `risk_level=HIGH` を返した場合
- 翻訳者・編者・注釈者・挿絵等の別権利懸念がある場合
- 個別注意書きや特殊利用条件がある場合

---

## 9. 00_Project 更新方針（論点 A）

### 9.1 方針
基本方針は **案 A-1: 最小更新** とする。  
ただし、実運用上必要な列は本仕様で明示的に更新対象に含める。

### 9.2 `00_Project` の列構成
- `project_id`
- `record_id`
- `project_status`
- `current_step`
- `run_enabled`
- `approval_status`
- `rights_status`
- `title_jp`
- `title_en`
- `series_name`
- `episode_no`
- `source_title`
- `source_url`
- `target_age`
- `video_format`
- `aspect_short`
- `aspect_full`
- `short_target_sec`
- `full_target_sec`
- `visual_style`
- `owner`
- `created_at`
- `updated_at`
- `updated_by`
- `notes`

### 9.3 v0.2 の更新対象列
- `project_id`
- `record_id`
- `current_step`
- `approval_status`
- `created_at`
- `updated_at`
- `updated_by`

### 9.4 各列の更新ルール
- `project_id`
  - 原則として input と同一値を保持する
  - GitHub は新規採番しない

- `record_id`
  - 原則として input と同一値を保持する
  - 空欄時の扱いは実装時に要確認  
  - v0.2 では GitHub が `00_Project.record_id` を新規採番する前提にはしない

- `current_step`
  - 固定値 `STEP_01_RIGHTS_VALIDATION` を設定する

- `approval_status`
  - 成功時: `PENDING`
  - Gemini 実行失敗時: `UNKNOWN`
  - schema validation 失敗時: `UNKNOWN`

- `created_at`
  - 既存値があれば維持する
  - 空欄の場合のみ初回時刻を設定してよい

- `updated_at`
  - 実行完了時刻で更新する

- `updated_by`
  - 固定値 `github_actions` を設定する

### 9.5 `00_Project` に反映しないもの
以下は主として `00_Rights_Validation` に保持し、`00_Project` の主更新対象にはしない。
- `rights_status`
- `risk_level`
- `review_required`
- rights の詳細根拠情報

### 9.6 `notes` の扱い
- `notes` は初期実装では主更新対象としない
- 失敗要約を `00_Project.notes` に書く場合でも、長文上書きは避ける
- 詳細ログは `100_App_Logs` に出力する

---

## 10. 00_Rights_Validation upsert 方針（論点 B）

### 10.1 方針
**案 B-1: 1 project = 1 row の上書き** を採用する。

### 10.2 upsert ルール
- キー: `project_id`
- 既存 row がある場合: update
- 無い場合: insert

### 10.3 `record_id` 方針
- GitHub が初回 insert 時に採番する
- 再実行時は既存 `record_id` を維持する
- v0.2 では履歴分岐は持たない

### 10.4 `record_id` 採番規則
- 形式: `PJT-001-RV`
- 初期実装では上記固定サフィックス形式を採用する
- 1 project = 1 row 方針のため、`-001` のような連番は付与しない

### 10.5 補足
将来的に履歴管理を導入する場合は、`PJT-001-RV-001` のような version 形式へ拡張を検討する。

---

## 11. GAS → GitHub payload 方針（論点 C）

### 11.1 方針
**案 C-2a: GAS 先行前提の `project_ids` payload** を採用する。

### 11.2 payload の役割
payload は GitHub に対して「どの案件を処理するか」を伝えるための起動パラメータであり、Gemini に渡す本文ではない。  
Gemini に必要な本文情報は、GitHub が payload を受けてから `00_Project` を read して組み立てる。

### 11.3 v0.2 推奨 payload
```json
{
  "project_ids": ["PJT-001"],
  "max_items": 1,
  "dry_run": false
}
