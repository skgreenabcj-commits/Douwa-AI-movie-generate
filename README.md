# Douwa AI Movie Generate

児童向け童話動画アセットの AI 制作パイプライン。
Google Sheets をデータストアとし、GitHub Actions + TypeScript で「権利確認 → 脚本 → 音声 → Q&A」までのアセット生成を自動化する。

---

## 目次

1. [システム概要](#システム概要)
2. [技術スタック](#技術スタック)
3. [リポジトリ構成](#リポジトリ構成)
4. [GitHub Actions 仕様](#github-actions-仕様)
5. [ステップ一覧](#ステップ一覧)
6. [Google Sheets 構成](#google-sheets-構成)
7. [設定・シークレット](#設定シークレット)
8. [ローカル開発](#ローカル開発)
9. [ブランチ・PR 運用](#ブランチpr-運用)

---

## システム概要

```
Human Operator
    │
    ├─► Google Spreadsheet (00_Project シートで案件登録)
    │       ↕  Google Apps Script (UI/手動トリガー)
    │
    └─► GitHub Actions  ← workflow_dispatch (手動 or GAS 連携)
            │
            ├─ Node.js 20 + TypeScript (dist/)
            │       │
            │       ├─ Google Sheets API  ← 入力読み込み / 結果書き込み
            │       ├─ Vertex AI / Gemini ← テキスト生成
            │       ├─ Cloud Text-to-Speech API ← 音声生成
            │       └─ Google Drive API   ← 画像・音声アップロード
            │
            └─ 100_App_Logs シートにエラー記録
```

**処理フロー（ステップ依存関係）**

```
STEP_01 Rights Validation
    └─► STEP_02 Source Build
            └─► STEP_03 Scenes Build
                    └─► STEP_04/05 Script Build (Short / Full / Short+Full)
                                └─► STEP_06 Visual Bible
                                        └─► STEP_07 Image Prompts
                                                └─► STEP_08A TTS Subtitle & Edit Plan
                                                        └─► STEP_08B TTS Audio Generate
                                                                └─► STEP_09 Q&A Build
                                                                        └─► STEP_10 Human QC (手動)
                                                                                └─► STEP_11 Publish Decision (手動)
```

各ステップは独立して再実行可能。前ステップの出力が GSS に書き込まれていることが前提条件。

---

## 技術スタック

| 領域 | 技術 |
|---|---|
| ランタイム | Node.js 20 + TypeScript 5.6 (ESM) |
| ビルド | esbuild (bundle=false, target=node20) |
| Google API | googleapis@172.x (Sheets, Drive) |
| AI | Vertex AI / Gemini (call-gemini.ts 経由) |
| 音声生成 | Cloud Text-to-Speech API |
| スキーマ検証 | AJV (JSON Schema Draft-07) |
| CI/CD | GitHub Actions |

---

## リポジトリ構成

```
.
├── src/
│   ├── index.ts                    # エントリーポイント・ステップルーター
│   ├── types.ts                    # 全型定義（StepId, Row 型等）
│   ├── steps/                      # ステップ別オーケストレーター
│   │   ├── step01-rights-validation.ts
│   │   ├── step02-source-build.ts
│   │   ├── step03-scenes-build.ts
│   │   ├── step04-05-script-build.ts
│   │   ├── step06-visual-bible.ts
│   │   ├── step07-image-prompts.ts
│   │   ├── step08a-tts-subtitle-edit-plan.ts
│   │   ├── step08b-tts-audio-generate.ts
│   │   └── step09-qa-build.ts
│   ├── lib/                        # 共通ライブラリ
│   │   ├── sheets-client.ts        # Google Sheets API ラッパー
│   │   ├── call-gemini.ts          # Gemini 呼び出し・モデル選択
│   │   ├── build-prompt.ts         # プロンプト組み立て
│   │   ├── validate-json.ts        # AJV 検証
│   │   ├── load-assets.ts          # prompts/schemas/examples 読み込み
│   │   ├── write-app-log.ts        # 100_App_Logs への記録
│   │   ├── generate-tts-audio.ts   # Cloud TTS + MP3 処理
│   │   ├── upload-to-drive.ts      # Google Drive アップロード
│   │   ├── load-*.ts               # 各シートの読み込み関数
│   │   └── write-*.ts              # 各シートへの upsert 関数
│   └── scripts/                    # dry-run・検証スクリプト
│       ├── dry-run-step03.ts
│       ├── dry-run-step04-05.ts
│       ├── dry-run-step06.ts
│       ├── dry-run-step07.ts
│       ├── dry-run-step08a.ts
│       ├── dry-run-step08b.ts
│       ├── dry-run-step08a-08b.ts
│       └── dry-run-step09.ts
├── prompts/                        # Gemini プロンプトテンプレート（バージョン管理）
├── schemas/                        # AJV 検証用 JSON Schema
│   ├── *_schema_ai_v1.json         # AI レスポンス検証
│   └── *_schema_full_v1.json       # GSS 書き込み行検証
├── examples/                       # AI レスポンスサンプル
├── specs/                          # ステップ別実装仕様書
├── docs/                           # アーキテクチャ・フィールドマスター
│   ├── 01_system_architecture.md
│   ├── 02_process_flow.md
│   ├── 03_process_sequence.md
│   └── GSS_field_master.tsv        # GSS カラム定義（正本）
├── config/                         # ランタイム設定・ロジック定義
├── .github/workflows/
│   ├── run-step.yml                # メイン GitHub Actions ワークフロー
│   └── test-google-sheets.yml      # GSS 接続テスト
└── dist/                           # ビルド成果物（直接編集禁止）
```

---

## GitHub Actions 仕様

### `run-step.yml` — メインワークフロー

**発火条件:** `workflow_dispatch`（手動実行 / GAS からの API 呼び出し）

**入力パラメータ:**

| パラメータ | 必須 | 説明 | 例 |
|---|---|---|---|
| `step_id` | ✅ | 実行するステップ ID | `STEP_01`, `STEP_08A_08B` |
| `project_ids` | ✅ | 対象プロジェクト ID（カンマ区切り） | `PJT-001,PJT-002` |
| `max_items` | — | 最大処理件数（デフォルト: 1） | `5` |
| `dry_run` | — | true = GSS 書き込みをスキップ | `true` |

**実行フロー:**
1. `actions/checkout` + Node.js 20 セットアップ
2. `npm ci`
3. `npm run build`
4. `node dist/index.js`（環境変数経由でパラメータ渡し）

**参照シークレット:**

| シークレット名 | 用途 |
|---|---|
| `SPREADSHEET_ID` | 対象 Google Spreadsheet の ID |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | サービスアカウント認証 JSON |
| `GOOGLE_CLOUD_PROJECT` | GCP プロジェクト ID（Vertex AI / TTS / Drive） |
| `GOOGLE_CLOUD_LOCATION` | Vertex AI リージョン（例: `asia-northeast1`） |
| `GEMINI_PRIMARY_MODEL_OVERRIDE` | モデル上書き（省略時は 94_Runtime_Config の値を使用） |

**step_id ルーティング（src/index.ts）:**

| step_id | 処理内容 |
|---|---|
| `STEP_01` | 権利確認 |
| `STEP_02` | ソース構造化 |
| `STEP_03` | シーン生成 |
| `STEP_04_05` | 脚本生成（video_format で Short/Full/両方を自動分岐） |
| `STEP_06` | ビジュアルバイブル生成 |
| `STEP_07` | 画像プロンプト生成 + 画像生成（オプション） |
| `STEP_08A` | TTS 字幕 + 編集プラン生成（Gemini） |
| `STEP_08B` | TTS 音声ファイル生成（Cloud TTS → Google Drive） |
| `STEP_08A_08B` | 08A 完全成功後に 08B を自動実行する複合モード |
| `STEP_09` | Q&A 生成 |

**STEP_08A_08B 複合モードの挙動:**
- 08A を全プロジェクト実行 → `failCount === 0 && successCount > 0` の場合のみ 08B を実行
- 1 件でも失敗があれば 08B はスキップされエラー終了

---

### `test-google-sheets.yml` — GSS 接続テスト

**発火条件:** `workflow_dispatch`（手動）  
**用途:** サービスアカウント認証と Sheets 読み書きの疎通確認

---

## ステップ一覧

### STEP_01 — Rights Validation（権利確認）

| 項目 | 内容 |
|---|---|
| 入力シート | `00_Project` |
| 出力シート | `00_Rights_Validation`, `00_Project`（minimal patch） |
| AI | Gemini（Primary: `step_01_model_role` / Secondary: `model_role_text_pro`） |
| 前提条件 | なし |
| 仕様書 | `specs/step01_implementation_spec_v0.2.md` |

著作権・翻訳権・出版社を確認し、`approval_status` を設定。ソースドメインによるファストパスロジックあり（`apply-fast-pass.ts`）。

---

### STEP_02 — Source Build（ソース構造化）

| 項目 | 内容 |
|---|---|
| 入力シート | `00_Project`, `00_Rights_Validation` |
| 出力シート | `01_Source` |
| AI | Gemini（Primary: `step_02_model_role` / Secondary: `model_role_text_flash_seconday`） |
| 前提条件 | `00_Rights_Validation.approval_status = APPROVED` |
| 仕様書 | `specs/step02_implementation_spec_v0.2.md` |

ソース素材を構造化メタデータ（タイトル・著者・あらすじ・登場人物等）に変換。

---

### STEP_03 — Scenes Build（シーン分割）

| 項目 | 内容 |
|---|---|
| 入力シート | `00_Project`, `01_Source` |
| 出力シート | `02_Scenes` |
| AI | Gemini（Primary: `step_03_model_role` / Secondary: `model_role_text_pro` → `model_role_text_flash_seconday`） |
| 前提条件 | `01_Source.approval_status = APPROVED` |
| 仕様書 | `specs/step03_implementation_spec_v0.2.md` |

`full_target_sec / scene_max_sec_*` から必要シーン数を算出し、シーンを分割。`scene_no` は表示専用（`record_id` が主キー）。

---

### STEP_04/05 — Script Build（脚本生成）

| 項目 | 内容 |
|---|---|
| 入力シート | `00_Project`, `02_Scenes`, `04_Script_Full`（short+full 時） |
| 出力シート | `03_Script_Short`（Short）, `04_Script_Full`（Full） |
| AI | Gemini（Primary: `step_04/05_model_role` / Secondary: `model_role_text_pro` → `model_role_text_flash_seconday`） |
| 前提条件 | `02_Scenes` 生成済み |
| 仕様書 | `specs/step04_05_implementation_spec_v0.1.md` |

`video_format` による分岐:

| video_format | 動作 |
|---|---|
| `full` | STEP_05（Full 脚本）のみ実行 |
| `short` | STEP_04（Short 脚本）のみ実行 |
| `short+full` | STEP_05 → STEP_04 の順に実行（Full 成功後に Short を実行） |

Short は Full の出力を参照する派生物。`short_use=Y` のシーンのみ対象。

---

### STEP_06 — Visual Bible（ビジュアルバイブル）

| 項目 | 内容 |
|---|---|
| 入力シート | `00_Project`, `02_Scenes`, `03_Script_Short`, `04_Script_Full` |
| 出力シート | `05_Visual_Bible` |
| AI | Gemini（Primary: `step_06_model_role` / Secondary: `model_role_text_pro`） |
| 前提条件 | 脚本生成済み |
| 仕様書 | `specs/step06_implementation_spec_v0.1.md` |

各シーンのビジュアル方向性（構図・色調・雰囲気）を定義。`record_id`: `{projectId}-VB-{i:03d}`。過去行は削除せず保持。

---

### STEP_07 — Image Prompts（画像プロンプト生成）

| 項目 | 内容 |
|---|---|
| 入力シート | `00_Project`, `02_Scenes`, `05_Visual_Bible` |
| 出力シート | `06_Image_Prompts` |
| AI（テキスト） | Gemini — 画像生成プロンプト文を生成 |
| AI（画像） | Gemini Image — PNG を生成して Drive にアップロード |
| 外部出力 | Google Drive（PNG ファイル） |
| 前提条件 | `05_Visual_Bible` 生成済み |
| 仕様書 | `specs/step07_implementation_spec_v0.1.md` |

**STEP_07 は 2 種類の AI 呼び出しを連続実行する:**

| フェーズ | 役割 | 94_Runtime_Config キー |
|---|---|---|
| ① テキスト生成 | `prompt_base` / `negative_prompt` 等のプロンプトパーツをテキストで生成 | Primary: `step_07_model_role`<br>Secondary: `model_role_text_pro` |
| ② 画像生成 | ①の出力を元に PNG を生成（失敗時は `image_take_1 = ""` として部分失敗扱い） | Primary: `step_07_image_model_role`<br>Secondary: `model_role_picture_seconday` |

`record_id`: `{projectId}-IMG-{i:03d}`。画像生成失敗は部分失敗として処理し、テキストプロンプトはシートに書き込まれる。

---

### STEP_08A — TTS Subtitle & Edit Plan（TTS 字幕 + 編集プラン）

| 項目 | 内容 |
|---|---|
| 入力シート | `00_Project`, `04_Script_Full` または `03_Script_Short`（format 依存） |
| 出力シート | `08_TTS_Subtitles`, `09_Edit_Plan` |
| AI | Gemini（Primary: `step_08a_model_role` / Secondary: `model_role_text_pro`） |
| 前提条件 | 脚本生成済み |
| 仕様書 | `specs/step08a_implementation_spec_v0.2.md` |

ナレーション TTS テキスト・字幕・感情・ポーズヒントを生成。`record_id + related_version` で複合キー管理。

---

### STEP_08B — TTS Audio Generate（音声ファイル生成）

| 項目 | 内容 |
|---|---|
| 入力シート | `00_Project`, `08_TTS_Subtitles`（`audio_file = ""` の行） |
| 出力シート | `08_TTS_Subtitles`（`audio_file` パス patch）, `09_Edit_Plan`（タイムコード patch） |
| AI | Cloud Text-to-Speech API |
| 外部出力 | Google Drive（MP3 ファイル） |
| 前提条件 | `08_TTS_Subtitles` 生成済み |
| 仕様書 | `specs/step08b_implementation_spec_v0.2.md` |

Cloud TTS で MP3 を生成 → MP3 時間を推定 → `tc_out` 計算 → Drive アップロード → シートにパスを記録。

---

### STEP_09 — Q&A Build（Q&A 生成）

| 項目 | 内容 |
|---|---|
| 入力シート | `00_Project`, `02_Scenes`, `03_Script_Short`, `04_Script_Full` |
| 出力シート | `10_QA` |
| AI | Gemini（Primary: `step_09_model_role` / Secondary: `model_role_text_flash_seconday`） |
| 前提条件 | 脚本生成済み |
| 仕様書 | `specs/step09_implementation_spec_v1.0.md` |

`video_format` による分岐:

| video_format | Q&A 生成内容 |
|---|---|
| `full` | Full スクリプトから 10 問 |
| `short` | Short スクリプトから 3〜10 問 |
| `short+full` | Full → Short の順に生成（Full を Short 生成時のコンテキストとして利用） |

`record_id`: Full = `{projectId}-QA-001〜010`、Short = `{projectId}-QA-011〜020`。

---

### STEP_10 / STEP_11 — Human QC / Publish Decision（手動）

GitHub Actions での自動化なし。オペレーターが GSS 上で確認・判定を行う。

---

## Google Sheets 構成

| シート名 | 役割 |
|---|---|
| `00_Project` | 案件マスター（project_id, title_jp, video_format, current_step 等） |
| `00_Rights_Validation` | STEP_01 出力（著作権・翻訳権・approval_status） |
| `01_Source` | STEP_02 出力（ソース構造化メタデータ） |
| `02_Scenes` | STEP_03 出力（シーン分割。record_id の採番起点） |
| `03_Script_Short` | STEP_04 出力（Short 脚本） |
| `04_Script_Full` | STEP_05 出力（Full 脚本） |
| `05_Visual_Bible` | STEP_06 出力（ビジュアル方向性） |
| `06_Image_Prompts` | STEP_07 出力（画像生成プロンプト + Drive パス） |
| `08_TTS_Subtitles` | STEP_08A/B 出力（字幕テキスト + 音声ファイルパス） |
| `09_Edit_Plan` | STEP_08A/B 出力（編集プラン + タイムコード） |
| `10_QA` | STEP_09 出力（Q&A ペア） |
| `94_Runtime_Config` | ランタイム設定（モデル名・パラメータ等） |
| `100_App_Logs` | エラーログ（全ステップ共通） |

**主キー:** `record_id`（`02_Scenes` から継承）。`scene_no` は表示専用。

**書き込みルール:** 全操作は upsert（DELETE 禁止）。書き込み対象カラムは `docs/GSS_field_master.tsv` 定義のもののみ。

---

## 設定・シークレット

### GitHub Secrets（必須）

| シークレット名 | 説明 |
|---|---|
| `SPREADSHEET_ID` | Google Spreadsheet ID |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | GCP サービスアカウント認証 JSON |
| `GOOGLE_CLOUD_PROJECT` | GCP プロジェクト ID |
| `GOOGLE_CLOUD_LOCATION` | Vertex AI リージョン |

### サービスアカウントの必要権限

| API / リソース | 必要な権限 |
|---|---|
| Google Sheets | `roles/editor`（Spreadsheet の共有で付与） |
| Google Drive | `roles/editor` |
| Vertex AI / Gemini | `roles/aiplatform.user` |
| Cloud Text-to-Speech | `roles/editor`（専用ロールなし） |

### 94_Runtime_Config（主要キー）

#### モデル設定

各ステップのモデルは `Primary → Secondary` の順で fallback する。
キーが未設定の場合はコード内のデフォルト値が使われる。

| ステップ | Primary キー | Secondary キー |
|---|---|---|
| STEP_01 | `step_01_model_role` | `model_role_text_pro` |
| STEP_02 | `step_02_model_role` | `model_role_text_flash_seconday` |
| STEP_03 | `step_03_model_role` | `model_role_text_pro` → `model_role_text_flash_seconday`（2段） |
| STEP_04 | `step_04_model_role` | `model_role_text_pro` → `model_role_text_flash_seconday`（2段） |
| STEP_05 | `step_05_model_role` | `model_role_text_pro` → `model_role_text_flash_seconday`（2段） |
| STEP_06 | `step_06_model_role` | `model_role_text_pro` |
| STEP_07（テキスト） | `step_07_model_role` | `model_role_text_pro` |
| STEP_07（画像生成） | `step_07_image_model_role` | `model_role_picture_seconday` |
| STEP_08A | `step_08a_model_role` | `model_role_text_pro` |
| STEP_09 | `step_09_model_role` | `model_role_text_flash_seconday` |

#### 共通モデルロール

| キー | 役割 |
|---|---|
| `model_role_text_pro` | Pro 系テキストモデル（複数ステップの fallback に使用） |
| `model_role_text_flash_seconday` | Flash 系テキストモデル（STEP_02/03/04/05/09 の fallback） |
| `model_role_picture_seconday` | 画像生成 fallback モデル（STEP_07 画像生成） |

#### モデル選定方針

- **Primary = 最新 Preview モデル**（高品質を優先）
- **Fallback = GA 安定版モデル**（可用性を優先、Preview 障害時に処理継続）

**Vertex AI 利用可能モデル一覧（global エンドポイント）:**  
https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations?hl=ja#%E3%82%B0%E3%83%AD%E3%83%BC%E3%83%90%E3%83%AB

> モデル名を変更する際は必ず上記ドキュメントで global エンドポイントへの掲載を確認すること。  
> Preview モデルはロケーションドキュメントへの掲載が遅れる場合があり、404 エラーの原因となる。

#### 動作パラメータ

| キー | 説明 | 例 |
|---|---|---|
| `google_drive_folder_id` | Drive ルートフォルダ ID（画像・音声の格納先親フォルダ） | `1xxxxx...` |
| `full_target_sec` | Full 動画の目標秒数 | `600` |
| `scene_max_sec_full` | Full 1 シーンの最大秒数 | `60` |

---

## ローカル開発

### 初期セットアップ

```bash
npm ci
cp .env.example .env   # 認証情報を設定
npm run typecheck
npm run build
```

### dry-run（GSS 書き込みなし）

```bash
npm run dry-run:step03
npm run dry-run:step04-05
npm run dry-run:step06
npm run dry-run:step07
npm run dry-run:step08a
npm run dry-run:step08b
npm run dry-run:step08a-08b
npm run dry-run:step09
```

### Gemini 実行（実際の AI 呼び出し、GSS 書き込みあり）

```bash
# 環境変数でステップと対象プロジェクトを指定
STEP_ID=STEP_03 PROJECT_IDS=PJT-001 node dist/index.js
```

### ビルド・型チェック

```bash
npm run typecheck   # TypeScript 検証
npm run build       # dist/ へコンパイル
```

---

## ブランチ・PR 運用

- `main` が本番ブランチ。直接 push 禁止
- 作業は `feature/*` ブランチで行い PR を出す
- **pre-push フック:** `npm run typecheck` + `npm run build` が自動実行される
  - フック通過後に push が実行される
  - `--no-verify` は緊急時のみ使用し、使用後は必ず型エラーを修正すること

### 新規ステップ実装時のチェックリスト

- [ ] `src/steps/stepNN-xxx.ts` 作成
- [ ] `src/lib/write-xxx.ts` + `load-xxx.ts` 作成
- [ ] `src/scripts/dry-run-stepNN.ts` 作成
- [ ] `src/index.ts` にルーティング追加
- [ ] `package.json` の build コマンドと `dry-run:stepNN` スクリプト追加
- [ ] `prompts/`, `schemas/`, `examples/` にファイル配置
- [ ] `specs/stepNN_implementation_spec_vX.X.md` 作成
- [ ] `npm run typecheck` + `npm run build` + `npm run dry-run:stepNN` が通ること
