# STEP_02 実装仕様 初期ドラフト v0.1

> **ステータス**: ドラフト — ユーザー確認待ち  
> **作成日**: 2026-04-01  
> **前提**: STEP_01 実装仕様 v0.2 の構造・パターンを継承する

---

## 1. 目的

本ドキュメントは、GitHub Actions 上で実行する STEP_02（Source Build）の初期実装仕様を定義するための合意用仕様書である。

**STEP_02 の役割**:  
STEP_01 で権利確認が完了した案件について、底本・出典・現代語化方針を AI が整理し、後工程の AI 入力として使う `01_Source` 行を生成する。

---

## 2. スコープ

### 対象
- 起動: GAS → GitHub Actions `workflow_dispatch`（STEP_01 と同一経路）
- 入力: `00_Project`（主入力）+ `00_Rights_Validation`（参照入力）
- AI 実行: Gemini API を利用して Source Build を行う
- 出力:
  - `01_Source` に Source Build 結果を書き込む
  - `00_Project` に最小状態更新を書き戻す
  - `100_App_Logs` に成功・失敗ログを書き出す

### スコープ外（初期実装）
- 並列処理・大量バッチ最適化
- fast-pass（STEP_02 では fast-pass 適用なし）
- 底本テキストのURL取得・スクレイピング

---

## 3. 実行方式

STEP_01 と同一の実行経路を採用する。

1. GAS が `workflow_dispatch` で GitHub Actions を起動
2. GitHub Actions が `94_Runtime_Config` を読む
3. payload に基づき `00_Project` から対象案件を読む
4. `00_Rights_Validation` から当該 `project_id` の行を読む（AI 入力補完用）
5. Prompt / Schema / Example を読み込む
6. Gemini を実行する
7. AI 出力を schema 検証する
8. `01_Source` に full row を upsert する
9. `00_Project` に最小状態更新を反映する
10. `100_App_Logs` に成功・失敗ログを書き出す

---

## 4. 入力

### 4.1 主入力シート
- `00_Project`

### 4.2 参照入力シート
- `00_Rights_Validation`（`project_id` をキーに 1 行取得）

### 4.3 主キー
- `project_id`

### 4.4 AI に渡す入力列

**`00_Project` から渡す列**:
| フィールド | 必須 | 用途 |
|---|---|---|
| `project_id` | Y | 案件識別 |
| `title_jp` | Y | 作品タイトル |
| `source_title` | Y | 底本タイトル |
| `source_url` | Y | 底本URL |
| `target_age` | N | 対象年齢（現代語化方針の参考） |
| `video_format` | N | 動画形式（short/full判断の参考） |

**`00_Rights_Validation` から渡す列**:
| フィールド | 必須 | 用途 |
|---|---|---|
| `original_author` | N | 著者名（クレジット生成用） |
| `translator` | N | 翻訳者名（クレジット生成用） |
| `rights_status` | Y | 権利確認状態（APPROVED 前提チェック） |
| `rights_summary` | N | 権利サマリー（AIへの文脈補足） |
| `public_domain_candidate` | N | PD候補フラグ |

> ⚠️ **【確認事項 A】**: `00_Rights_Validation` の読み込みを必須とするか任意とするか。  
> `rights_status = APPROVED` の案件のみ STEP_02 を実行する制約を GitHub 側で設けるか？  
> **選択肢**:  
> - A-1: GitHub 側で `rights_status != APPROVED` の場合はエラー停止（推奨）  
> - A-2: チェックなし（GAS/人間が制御する前提）  
> - A-3: WARN ログを出すが処理は続行

---

## 5. 出力

### 5.1 主出力シート
- `01_Source`

### 5.2 補助出力シート
- `00_Project`

### 5.3 ログ出力シート
- `100_App_Logs`

### 5.4 `01_Source` の列定義（GSS_field_master 準拠）

| フィールド | role | AI出力? | 後続AI入力? | 説明 |
|---|---|---|---|---|
| `project_id` | SYSTEM_CONTROL | N | — | 案件ID |
| `record_id` | SYSTEM_CONTROL | N | — | GH採番 `PJT-001-SRC-001` |
| `generation_status` | SYSTEM_CONTROL | N | — | 固定: `GENERATED` |
| `approval_status` | HUMAN_REVIEW | N | — | 固定: `PENDING` |
| `step_id` | SYSTEM_CONTROL | N | — | 固定: `STEP_02_SOURCE_BUILD` |
| `source_title` | AI_OUTPUT | Y | N | 底本タイトル |
| `author` | AI_OUTPUT | Y | N | 著者名 |
| `translator` | AI_OUTPUT | Y | N | 翻訳者名 |
| `source_url` | AI_OUTPUT | Y | N | 底本URL |
| `source_type` | AI_OUTPUT | Y | N | 例: `aozora`, `original`, `translation` |
| `copyright_status` | AI_OUTPUT | Y | N | 著作権状態の要約 |
| `credit_text` | AI_OUTPUT | Y | **Y** | クレジット文（後続AI入力） |
| `base_text_notes` | AI_OUTPUT | Y | **Y** | 底本注記（後続AI入力） |
| `language_style` | AI_OUTPUT | Y | **Y** | 言語スタイル方針（後続AI入力） |
| `original_text` | REFERENCE | N | N | 原文テキスト（任意・参照用） |
| `difficult_terms` | AI_OUTPUT | Y | **Y** | 難語リスト（後続AI入力） |
| `adaptation_policy` | AI_OUTPUT | Y | **Y** | 現代語化・脚色方針（後続AI入力） |
| `legal_check_status` | HUMAN_REVIEW | N | N | 人手確認ステータス |
| `legal_check_notes` | HUMAN_REVIEW | N | N | 人手確認メモ |
| `updated_at` | SYSTEM_CONTROL | N | — | GH補完 |
| `updated_by` | SYSTEM_CONTROL | N | — | 固定: `github_actions` |
| `notes` | HUMAN_REVIEW | N | N | 補足メモ |

### 5.5 AI が主に返すもの
- `source_title`, `author`, `translator`, `source_url`, `source_type`
- `copyright_status`, `credit_text`, `base_text_notes`
- `language_style`, `difficult_terms`, `adaptation_policy`

### 5.6 GitHub システムが補完・確定するもの
- `project_id`, `record_id`, `step_id`
- `generation_status`（固定: `GENERATED`）
- `approval_status`（固定: `PENDING`）
- `updated_at`, `updated_by`

> ⚠️ **【確認事項 B】**: `original_text`（原文テキスト）の扱い。  
> `source_url` から原文を取得してAIに渡すか、AIにURL参照させるか、省略するか。  
> **選択肢**:  
> - B-1: `source_url` のみAIに渡し、AI自身がURL内容を参照（現行STEP_01と同じ方式）  
> - B-2: GitHub が `source_url` をフェッチして本文を抽出し、AIへのプロンプトに含める  
> - B-3: `original_text` 列はAI出力外とし、人が後から入力する  
> **推奨**: B-1（実装コスト低、STEP_01との一貫性あり）

---

## 6. ランタイム設定

STEP_01 と同一の設定取得元（`94_Runtime_Config`）を使用する。

| key | 内容 | 備考 |
|---|---|---|
| `gemini_api_key` | Gemini API Key | STEP_01 と共通 |
| `step_02_model_role` | STEP_02 primary model | 未設定時フォールバック: `gemini-2.5-pro` |
| `model_role_text_pro` | STEP_02 secondary model | STEP_01 と共通キー |

> ⚠️ **【確認事項 C】**: `step_02_model_role` を `94_Runtime_Config` に追加するか？  
> `step_01_model_role` と同様に独立キーとして管理する方針を推奨。

---

## 7. AI 実行方針

### 7.1 利用ファイル（新規作成が必要なもの）

| ファイルパス | 状態 | 内容 |
|---|---|---|
| `prompts/source_build_prompt_v1.md` | **未作成** | STEP_02 メインプロンプト |
| `prompts/fragments/source_build_output_field_guide_v1.md` | **未作成** | 出力フィールドガイド |
| `schemas/source_build_schema_ai_v1.json` | **未作成** | AI出力スキーマ |
| `schemas/source_build_schema_full_v1.json` | **未作成** | フルスキーマ |
| `examples/source_build_ai_response_example_v1.json` | **未作成** | AI出力サンプル |
| `examples/source_build_full_response_example_v1.json` | **未作成** | フルレスポンスサンプル |

STEP_01 で用いた以下は STEP_02 でも **流用**:
- `prompts/copyright_policy_jp_v1.md`（著作権ポリシー）

### 7.2 プロンプト方針
- AI には schema 準拠 JSON のみを返させる
- `source_url` の内容・著者情報は AI が知識として参照する（B-1 方式）
- 現代語化方針は `target_age`（対象年齢）を踏まえて生成させる
- `adaptation_policy` は後続の STEP_03〜05 で参照される最重要フィールド

### 7.3 モデル方針
- STEP_01 と同一（primary: `gemini-2.5-pro`、fallback: secondary model）

---

## 8. upsert 方針

### 8.1 基本方針
STEP_01 の `00_Rights_Validation` upsert と同一方式を採用する。

- キー: `project_id`
- 既存行あり → UPDATE（`record_id` 維持）
- 既存行なし → `getNextEmptyRowIndex` + `updateRow`（空行を埋める）

### 8.2 `record_id` 採番規則

> ⚠️ **【確認事項 D】**: `record_id` の形式を決める必要がある。  
> **選択肢**:  
> - D-1: `PJT-001-SRC-001`（SRC サフィックス、行位置ベース連番）  
> - D-2: `PJT-001-S02-001`（STEP番号サフィックス）  
> - D-3: `PJT-001-SC-001`（GSS_field_master の example 値 `PJT-01-SC-001` に準拠）  
> **推奨**: D-3（既存 example 値との一貫性）→ `PJT-001-SC-001` 形式

---

## 9. `00_Project` 更新方針

STEP_01 と同一の最小更新方針を採用する。

| フィールド | 更新値 |
|---|---|
| `current_step` | `STEP_02_SOURCE_BUILD` |
| `approval_status` | 成功: `PENDING` / 失敗: `UNKNOWN` |
| `updated_at` | 実行時刻 |
| `updated_by` | `github_actions` |

---

## 10. エラーハンドリング

STEP_01 と同一方針。

| エラー種別 | 対処 |
|---|---|
| `00_Rights_Validation` 行が見つからない | エラー停止 or WARN（確認事項 A に依存） |
| `rights_status != APPROVED` | エラー停止 or WARN（確認事項 A に依存） |
| Gemini API 失敗 | secondary fallback → 失敗時 `approval_status=UNKNOWN` + ログ |
| schema validation 失敗 | `approval_status=UNKNOWN` + ログ |
| GSS 書き込み失敗 | ログ出力（処理続行） |

---

## 11. 実装フェーズ計画

STEP_01 の実装構造を継承し、差分のみ追加する。

| フェーズ | 内容 | 新規/流用 |
|---|---|---|
| Phase 1 | `write-source.ts`（01_Source upsert） | **新規** |
| Phase 2 | `load-rights-validation.ts`（00_RV 読み込み） | **新規** |
| Phase 3 | `prompts/`, `schemas/`, `examples/` ファイル群 | **新規** |
| Phase 4 | `build-prompt.ts` に `buildStep02Prompt` 追加 | 既存拡張 |
| Phase 5 | `src/steps/step02-source-build.ts`（オーケストレーター） | **新規** |
| Phase 6 | `src/index.ts` に STEP_02 ルーティング追加 | 既存拡張 |
| Phase 7 | `src/types.ts` に `SourceFullRow` 等の型追加 | 既存拡張 |

---

## 12. 未解決の確認事項（要ユーザー回答）

| # | 確認事項 | 選択肢 | 推奨 |
|---|---|---|---|
| **A** | `rights_status` チェックを GitHub 側で強制するか | A-1: エラー停止 / A-2: チェックなし / A-3: WARN継続 | **A-1** |
| **B** | `original_text`（原文）の取得方法 | B-1: URLのみ渡す / B-2: GHがフェッチ / B-3: 人手入力 | **B-1** |
| **C** | `step_02_model_role` を `94_Runtime_Config` に独立キーとして追加するか | 独立キー / STEP_01と共通キー | **独立キー** |
| **D** | `01_Source` の `record_id` 形式 | D-1: `SRC` / D-2: `S02` / D-3: `SC`（既存example準拠） | **D-3** |

---

## 13. 開発着手前チェックリスト

- [ ] 確認事項 A〜D のユーザー回答
- [ ] `prompts/source_build_prompt_v1.md` の内容確認・承認
- [ ] `schemas/source_build_schema_ai_v1.json` の確認・承認
- [ ] `94_Runtime_Config` に `step_02_model_role` キーを追加（確認事項 C に依存）
