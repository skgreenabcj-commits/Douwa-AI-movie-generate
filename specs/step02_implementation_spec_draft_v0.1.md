# STEP_02 実装仕様 初期ドラフト v0.1

> **ステータス**: ドラフト — 確認事項 A〜D 回答済み、実装作業待ち  
> **作成日**: 2026-04-01  
> **最終更新**: 2026-04-02  
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
  - `00_Project` に最小状態更新を書き戻す（`current_step` を `STEP_02_SOURCE_BUILD` に上書き）
  - `100_App_Logs` に成功・失敗ログを書き出す

### スコープ外（初期実装）
- 並列処理・大量バッチ最適化
- fast-pass（STEP_02 では fast-pass 適用なし）
- 底本テキストのURL取得・スクレイピング（`source_url` が有効な限り `original_text` は空で良い）

---

## 3. 実行方式

STEP_01 と同一の実行経路を採用する。

1. GAS が `workflow_dispatch` で GitHub Actions を起動
2. GitHub Actions が `94_Runtime_Config` を読む
3. payload に基づき `00_Project` から対象案件を読む
4. `rights_status` を確認し、`APPROVED` でなければエラー停止（後述 A）
5. `00_Rights_Validation` から当該 `project_id` の行を読む（AI 入力補完用）
6. Prompt / Schema / Example を読み込む
7. Gemini を実行する
8. AI 出力を schema 検証する
9. `01_Source` に full row を upsert する
10. `00_Project` に最小状態更新を反映する（`current_step` 上書きを含む）
11. `100_App_Logs` に成功・失敗ログを書き出す

---

## 4. 入力

### 4.1 主入力シート
- `00_Project`

### 4.2 参照入力シート
- `00_Rights_Validation`（`project_id` をキーに 1 行取得、必須）

### 4.3 主キー
- `project_id`

### 4.4 AI に渡す入力列（確定）

**`00_Project` から渡す列**:

| フィールド | 必須 | 用途 |
|---|---|---|
| `project_id` | **Mandatory** | 案件識別 |
| `title_jp` | **Mandatory** | 作品タイトル（AI が底本タイトルの補完に使用） |
| `source_url` | **Mandatory** | 底本URL（AI が底本情報を参照する起点） |
| `target_age` | **Mandatory** | 対象年齢（現代語化方針・言語スタイルの生成に使用） |

> 注意: `source_url` が有効な URL を返す限り、`original_text` は Blank で良い（B-1 方式）。

**`00_Rights_Validation` から渡す列**:

| フィールド | 必須 | 用途 |
|---|---|---|
| `rights_status` | **Mandatory** | APPROVED チェック用（A-1 方式） |
| `original_author` | 任意 | 著者名（クレジット生成補助） |
| `translator` | 任意 | 翻訳者名（クレジット生成補助） |
| `rights_summary` | 任意 | 権利サマリー（AI への文脈補足） |
| `public_domain_candidate` | 任意 | PD候補フラグ |

### 4.5 `rights_status` チェック（確定: A-1）

- `rights_status != APPROVED` の場合、**GitHub 側でエラー停止**する
- エラー内容を `100_App_Logs` に記録し、`00_Project.approval_status = UNKNOWN` に更新する

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
| `record_id` | SYSTEM_CONTROL | N | — | GH採番 `PJT-001-SC-001` |
| `generation_status` | SYSTEM_CONTROL | N | — | 固定: `GENERATED` |
| `approval_status` | HUMAN_REVIEW | N | — | 固定: `PENDING` |
| `step_id` | SYSTEM_CONTROL | N | — | 固定: `STEP_02_SOURCE_BUILD` |
| `source_title` | AI_OUTPUT | Y | N | 底本タイトル |
| `author` | AI_OUTPUT | Y | N | 著者名 |
| `translator` | AI_OUTPUT | Y | N | 翻訳者名 |
| `source_url` | AI_OUTPUT | Y | N | 底本URL（入力と同値を返させる） |
| `source_type` | AI_OUTPUT | Y | N | 例: `aozora`, `original`, `translation` |
| `copyright_status` | AI_OUTPUT | Y | N | 著作権状態の要約（1〜2文） |
| `credit_text` | AI_OUTPUT | Y | **Y** | クレジット文（後続AI入力） |
| `base_text_notes` | AI_OUTPUT | Y | **Y** | 底本注記（後続AI入力） |
| `language_style` | AI_OUTPUT | Y | **Y** | 言語スタイル方針（後続AI入力） |
| `original_text` | REFERENCE | N | N | 原文テキスト（B-1方式により空欄可） |
| `difficult_terms` | AI_OUTPUT | Y | **Y** | 難語リスト（後続AI入力） |
| `adaptation_policy` | AI_OUTPUT | Y | **Y** | 現代語化・脚色方針（後続AI入力）← 最重要 |
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
- `original_text`（空欄: B-1 方式）
- `updated_at`, `updated_by`

---

## 6. ランタイム設定

STEP_01 と同一の設定取得元（`94_Runtime_Config`）を使用する。

| key | 内容 | 備考 |
|---|---|---|
| `gemini_api_key` | Gemini API Key | STEP_01 と共通 |
| `step_02_model_role` | STEP_02 primary model | 独立キー（確定: C）、フォールバック: `gemini-2.5-pro` |
| `model_role_text_pro` | STEP_02 secondary model | STEP_01 と共通キー |

> GSS `94_Runtime_Config` に `step_02_model_role` キーを追加すること（実装前提条件）。

---

## 7. AI 実行方針

### 7.1 利用ファイル

| ファイルパス | 状態 | 内容 |
|---|---|---|
| `prompts/source_build_prompt_v1.md` | **作成済** | STEP_02 メインプロンプト |
| `prompts/fragments/source_build_output_field_guide_v1.md` | **作成済** | 出力フィールドガイド |
| `schemas/source_build_schema_ai_v1.json` | **作成済** | AI出力スキーマ |
| `examples/source_build_ai_response_example_v1.json` | **作成済** | AI出力サンプル |
| `prompts/copyright_policy_jp_v1.md` | 流用 | 著作権ポリシー（STEP_01 と共通） |

### 7.2 プロンプト方針
- AI には schema 準拠 JSON のみを返させる
- `source_url` の内容・著者情報は AI が知識として参照する（B-1 方式）
- 現代語化方針は `target_age`（対象年齢）を踏まえて生成させる
- `adaptation_policy` は後続の STEP_03〜05 で参照される最重要フィールドであり、`target_age` に応じた具体的な方針を返させる
- `language_style` も `target_age` に連動させる

### 7.3 モデル方針
- primary: `step_02_model_role`（`gemini-2.5-pro` をデフォルト）
- fallback: `model_role_text_pro`（`gemini-3.1-pro-preview` 等）

---

## 8. upsert 方針

### 8.1 基本方針
STEP_01 の `00_Rights_Validation` upsert と同一方式を採用する。

- キー: `project_id`
- 既存行あり → UPDATE（`record_id` 維持）
- 既存行なし → `getNextEmptyRowIndex` + `updateRow`（空行を埋める）

### 8.2 `record_id` 採番規則（確定: D-3）

- 形式: `PJT-001-SC-001`（GSS_field_master の example 値 `PJT-01-SC-001` に準拠）
- プロジェクト番号は 3 桁パディング（例: PJT-001, PJT-002）
- 連番は既存行数 + 1

---

## 9. `00_Project` 更新方針

STEP_01 と同一の最小更新方針を採用する。**STEP_02 終了後、`current_step` を `STEP_02_SOURCE_BUILD` に上書きする。**

| フィールド | 更新値 |
|---|---|
| `current_step` | `STEP_02_SOURCE_BUILD`（STEP_02完了後に上書き） |
| `approval_status` | 成功: `PENDING` / 失敗: `UNKNOWN` |
| `updated_at` | 実行時刻 |
| `updated_by` | `github_actions` |

---

## 10. エラーハンドリング

| エラー種別 | 対処 |
|---|---|
| `00_Rights_Validation` 行が見つからない | **エラー停止**（`approval_status=UNKNOWN` + ログ） |
| `rights_status != APPROVED` | **エラー停止**（A-1: `approval_status=UNKNOWN` + ログ） |
| Gemini API 失敗 | secondary fallback → 失敗時 `approval_status=UNKNOWN` + ログ |
| schema validation 失敗 | `approval_status=UNKNOWN` + ログ |
| GSS 書き込み失敗 | ログ出力（処理続行） |

---

## 11. 実装フェーズ計画

STEP_01 の実装構造を継承し、差分のみ追加する。

| フェーズ | 内容 | 新規/流用 |
|---|---|---|
| Phase 1 | `src/lib/write-source.ts`（01_Source upsert） | **新規** |
| Phase 2 | `src/lib/load-rights-validation.ts`（00_RV 読み込み） | **新規** |
| Phase 3 | `prompts/`, `schemas/`, `examples/` ファイル群 | **新規（作成済）** |
| Phase 4 | `src/lib/build-prompt.ts` に `buildStep02Prompt` 追加 | 既存拡張 |
| Phase 5 | `src/steps/step02-source-build.ts`（オーケストレーター） | **新規** |
| Phase 6 | `src/index.ts` に STEP_02 ルーティング追加 | 既存拡張 |
| Phase 7 | `src/types.ts` に `SourceAiRow`, `SourceFullRow` 等の型追加 | 既存拡張 |

---

## 12. 確認事項ステータス（すべて確定）

| # | 確認事項 | 決定内容 |
|---|---|---|
| **A** | `rights_status` チェック | **A-1: エラー停止**（`rights_status != APPROVED` で停止） |
| **B** | `original_text` の取得方法 | **B-1: `source_url` のみ渡す**（有効なURLがあれば `original_text` は空欄） |
| **C** | `step_02_model_role` キーの管理 | **独立キー**として GSS `94_Runtime_Config` で管理 |
| **D** | `01_Source` の `record_id` 形式 | **D-3: `PJT-001-SC-001`**（GSS_field_master example 準拠） |

---

## 13. 実装前提条件チェックリスト

- [x] 確認事項 A〜D のユーザー回答完了
- [x] `prompts/source_build_prompt_v1.md` 作成済
- [x] `prompts/fragments/source_build_output_field_guide_v1.md` 作成済
- [x] `schemas/source_build_schema_ai_v1.json` 作成済
- [x] `examples/source_build_ai_response_example_v1.json` 作成済
- [ ] GSS `94_Runtime_Config` に `step_02_model_role` キーを追加（実装前にユーザー対応）
- [ ] 実装フェーズ Phase 1〜7 の実施
