# STEP_02 実装仕様 v0.2

> **ステータス**: 確定（ユーザー確認済み 2026-04-02）  
> **前バージョン**: draft v0.1  
> **前提**: STEP_01 実装仕様 v0.2 の構造・パターンを継承する

---

## 1. 目的

本ドキュメントは、GitHub Actions 上で実行する STEP_02（Source Build）の初期実装仕様を定義する合意済み仕様書である。

**STEP_02 の役割**:  
STEP_01 で権利確認が完了した案件について、底本・出典・現代語化方針を AI が整理し、後工程（STEP_03〜）の AI 入力として使う `01_Source` 行を生成する。

---

## 2. スコープ

### 対象
- 起動: GAS → GitHub Actions `workflow_dispatch`（STEP_01 と同一経路）
- 入力: `00_Project`（主入力）+ `00_Rights_Validation`（参照入力）
- AI 実行: Gemini API を利用して Source Build を行う
- 出力:
  - `01_Source` に Source Build 結果を書き込む（upsert）
  - `00_Project` の `current_step` を `STEP_02_SOURCE_BUILD` に上書き更新
  - `100_App_Logs` に成功・失敗ログを書き出す

### スコープ外（初期実装）
- 並列処理・大量バッチ最適化
- fast-pass（STEP_02 では適用なし）
- `source_url` からの原文テキスト自動取得・スクレイピング

---

## 3. 実行方式

STEP_01 と同一の実行経路を採用する。

1. GAS が `workflow_dispatch` で GitHub Actions を起動
2. GitHub Actions が `94_Runtime_Config` を読む
3. payload に基づき `00_Project` から対象案件を読む
4. `00_Rights_Validation` から当該 `project_id` の行を読む
5. **`rights_status` が `APPROVED` でない場合はエラー停止**（後述 §6）
6. Prompt / Schema / Example / Field Guide を読み込む
7. Gemini を実行する
8. AI 出力を schema 検証する
9. `01_Source` に full row を upsert する
10. `00_Project` の `current_step` 等を最小更新する
11. `100_App_Logs` に成功・失敗ログを書き出す

---

## 4. 入力

### 4.1 主入力シート
- `00_Project`

### 4.2 参照入力シート
- `00_Rights_Validation`（`project_id` をキーに 1 行取得）

### 4.3 主キー
- `project_id`

### 4.4 AI に渡す入力列（確定）

**`00_Project` から渡す列（全 Mandatory）**:

| フィールド | 必須 | 用途 |
|---|---|---|
| `project_id` | **Mandatory** | 案件識別 |
| `title_jp` | **Mandatory** | 作品タイトル（現代語化対象の判断基準） |
| `source_url` | **Mandatory** | 底本URL（AI が著者・権利・本文内容を参照） |
| `target_age` | **Mandatory** | 対象年齢（言語スタイル・難語抽出方針に直結） |

> `source_url` に有効な URL がある限り `original_text` は Blank とする。  
> AI は `source_url` 経由で内容を参照する。

**`00_Rights_Validation` から渡す列**:

| フィールド | 必須 | 用途 |
|---|---|---|
| `original_author` | Optional | クレジット文生成の補足 |
| `translator` | Optional | クレジット文生成の補足 |
| `rights_summary` | Optional | 権利状況の文脈補足 |

### 4.5 事前チェック（rights_status）

`00_Rights_Validation` を読み込んだ後、以下をチェックする：

```
if rights_status != "APPROVED":
  → エラー停止
  → 00_Project.approval_status = "UNKNOWN"
  → 100_App_Logs にエラーログを書く
  → 処理を中断（後続 project_id があれば次へ）
```

---

## 5. 出力

### 5.1 `01_Source` の列定義（GSS_field_master 準拠）

| フィールド | role | AI出力 | 後続AI入力 | 説明 |
|---|---|---|---|---|
| `project_id` | SYSTEM_CONTROL | N | — | 案件ID（GH補完） |
| `record_id` | SYSTEM_CONTROL | N | — | GH採番 `PJT-001-SC-001` |
| `generation_status` | SYSTEM_CONTROL | N | — | 固定: `GENERATED` |
| `approval_status` | HUMAN_REVIEW | N | — | 固定: `PENDING` |
| `step_id` | SYSTEM_CONTROL | N | — | 固定: `STEP_02_SOURCE_BUILD` |
| `source_title` | AI_OUTPUT | Y | N | 底本タイトル |
| `author` | AI_OUTPUT | Y | N | 著者名 |
| `translator` | AI_OUTPUT | Y | N | 翻訳者名（なければ空文字） |
| `source_url` | AI_OUTPUT | Y | N | 底本URL（入力値をそのまま返す） |
| `source_type` | AI_OUTPUT | Y | N | 例: `aozora` / `original` / `translation` |
| `copyright_status` | AI_OUTPUT | Y | N | 著作権状態の簡潔な要約 |
| `credit_text` | AI_OUTPUT | Y | **Y** | クレジット文（後続AI入力） |
| `base_text_notes` | AI_OUTPUT | Y | **Y** | 底本注記（後続AI入力） |
| `language_style` | AI_OUTPUT | Y | **Y** | 言語スタイル方針（target_age 考慮、後続AI入力） |
| `original_text` | REFERENCE | N | N | 空文字固定（source_url あるため不要） |
| `difficult_terms` | AI_OUTPUT | Y | **Y** | 難語リスト（**全角「、」区切り**、target_age 考慮必須） |
| `adaptation_policy` | AI_OUTPUT | Y | **Y** | 現代語化・脚色方針（target_age 考慮、後続AI入力） |
| `legal_check_status` | HUMAN_REVIEW | N | N | 人手確認ステータス（空文字） |
| `legal_check_notes` | HUMAN_REVIEW | N | N | 人手確認メモ（空文字） |
| `updated_at` | SYSTEM_CONTROL | N | — | GH補完（ISO8601） |
| `updated_by` | SYSTEM_CONTROL | N | — | 固定: `github_actions` |
| `notes` | HUMAN_REVIEW | N | N | 補足メモ（空文字） |

### 5.2 `record_id` 採番規則（確定）

- 形式: `PJT-001-SC-001`
- `SC` サフィックス（GSS_field_master の example 値 `PJT-01-SC-001` に準拠）
- 連番部分は `getNextEmptyRowIndex` から算出（STEP_01 の `RV` と同一ロジック）

### 5.3 `00_Project` の更新対象列

| フィールド | 更新値 |
|---|---|
| `current_step` | `STEP_02_SOURCE_BUILD`（**上書き**） |
| `approval_status` | 成功: `PENDING` / 失敗: `UNKNOWN` |
| `updated_at` | 実行完了時刻 |
| `updated_by` | `github_actions` |

---

## 6. エラーハンドリング

| エラー種別 | 対処 |
|---|---|
| `00_Rights_Validation` 行が見つからない | エラー停止 + `approval_status=UNKNOWN` + ログ |
| `rights_status != APPROVED` | エラー停止 + `approval_status=UNKNOWN` + ログ |
| Gemini API 失敗（primary） | secondary fallback |
| Gemini API 失敗（secondary） | `approval_status=UNKNOWN` + ログ |
| schema validation 失敗 | `approval_status=UNKNOWN` + ログ |
| GSS 書き込み失敗 | ログ出力（処理続行） |

---

## 7. ランタイム設定

| key | 内容 | 備考 |
|---|---|---|
| `gemini_api_key` | Gemini API Key | STEP_01 と共通 |
| `step_02_model_role` | STEP_02 primary model | **独立キー**、未設定時: `gemini-2.5-pro` |
| `model_role_text_pro` | secondary model | STEP_01 と共通キー |

> **GSS 対応**: `94_Runtime_Config` に `step_02_model_role` キーを追加すること（実装着手前に実施）。

---

## 8. 利用アセットファイル一覧（確定）

| ファイルパス | 状態 | 内容 |
|---|---|---|
| `prompts/source_build_prompt_v1.md` | **本仕様と同時作成** | STEP_02 メインプロンプト |
| `prompts/fragments/source_build_output_field_guide_v1.md` | **本仕様と同時作成** | 出力フィールドガイド |
| `schemas/source_build_schema_ai_v1.json` | **本仕様と同時作成** | AI出力スキーマ |
| `examples/source_build_ai_response_example_v1.json` | **本仕様と同時作成** | AI出力サンプル（1件） |
| `prompts/copyright_policy_jp_v1.md` | 流用（STEP_01 共通） | 著作権ポリシー |

---

## 9. `difficult_terms` の仕様（重要）

- **形式**: 全角読点「、」で term を列挙する
  - 例: `おじいさん、おばあさん、雉、犬、猿、鬼退治`
- **`target_age` との連動**:
  - 低年齢（例: 幼児・小学校低学年）向け: 大人には平易でも子どもに難しい語を積極的に列挙
  - 高年齢（例: 小学校高学年以上）向け: 古語・難読語・概念語に絞って列挙
  - この方針は `prompts/source_build_prompt_v1.md` および `prompts/fragments/source_build_output_field_guide_v1.md` に明示する

---

## 10. `language_style` / `adaptation_policy` の仕様

- どちらも `target_age` を必ず考慮した内容を生成させる
- `language_style` 例:
  - `幼児向け: やさしいひらがな中心、短文、擬音語多用`
  - `小学校低学年向け: やさしい漢字使用可、会話文中心`
- `adaptation_policy` 例:
  - `幼児向け: 長い文章を短く分割、難しい言葉をひらがなに置き換え、場面を簡略化`
- この方針は `prompts/source_build_prompt_v1.md` に明示する

---

## 11. 実装フェーズ計画

| フェーズ | 内容 | 新規/流用 |
|---|---|---|
| Phase 1 | `src/types.ts` に `SourceFullRow`, `SourceAiRow` 追加 | 既存拡張 |
| Phase 2 | `src/lib/write-source.ts`（01_Source upsert） | **新規** |
| Phase 3 | `src/lib/load-rights-validation.ts`（00_RV 読み込み） | **新規** |
| Phase 4 | `src/lib/build-prompt.ts` に `buildStep02Prompt` 追加 | 既存拡張 |
| Phase 5 | `src/lib/load-assets.ts` に `loadStep02Assets` 追加 | 既存拡張 |
| Phase 6 | `src/steps/step02-source-build.ts`（オーケストレーター） | **新規** |
| Phase 7 | `src/index.ts` に STEP_02 ルーティング追加 | 既存拡張 |
| Phase 8 | `package.json` の build コマンドに新ファイルを追加 | 既存拡張 |

---

## 12. 実装着手前チェックリスト

**ユーザー対応済み**
- [x] 確認事項 A～D 回答完了（2026-04-02）
- [x] `prompts/source_build_prompt_v1.md` 作成済（`difficult_terms` 全角「、」修正済）
- [x] `prompts/fragments/source_build_output_field_guide_v1.md` 作成済（`difficult_terms` 全角「、」修正済）
- [x] `schemas/source_build_schema_ai_v1.json` 作成済（`difficult_terms` 全角「、」修正済）
- [x] `examples/source_build_ai_response_example_v1.json` 作成済（`difficult_terms` 全角「、」修正済）

**実装着手前に実施すること**
- [ ] GSS `94_Runtime_Config` に `step_02_model_role = gemini-2.5-pro` を追加
- [ ] `01_Source` シートに 999 行の空行が存在することを確認

**実装フェーズ**
- [ ] Phase 1: `src/types.ts` に `SourceFullRow`, `SourceAiRow` 追加
- [ ] Phase 2: `src/lib/write-source.ts`（01_Source upsert）新規作成
- [ ] Phase 3: `src/lib/load-rights-validation.ts`＀00_RV 読み込み）新規作成
- [ ] Phase 4: `src/lib/build-prompt.ts` に `buildStep02Prompt` 追加
- [ ] Phase 5: `src/lib/load-assets.ts` に `loadStep02Assets` 追加
- [ ] Phase 6: `src/steps/step02-source-build.ts`（オーケストレーター）新規作成
- [ ] Phase 7: `src/index.ts` に STEP_02 ルーティング追加
- [ ] Phase 8: `package.json` の build コマンドに新ファイルを追加
