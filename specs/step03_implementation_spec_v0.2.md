# STEP_03 実装仕様 v0.2

> **ステータス**: 確定（ユーザー確認済み 2026-04-04）
> **前バージョン**: draft v0.1
> **前提**: STEP_01 / STEP_02 実装仕様 v0.2 の構造・パターンを継承する

---

## 1. 目的

本ドキュメントは、GitHub Actions 上で実行する STEP_03（Scenes Build）の初期実装仕様を定義する合意済み仕様書である。

**STEP_03 の役割**:
STEP_02 で生成した `01_Source`（底本・脚色方針）をもとに、AI が物語を scene 単位に分割し、
後工程（STEP_04 Short Script / STEP_05 Full Script / STEP_06 Visual Bible / STEP_07 Image Prompts / STEP_08 TTS・Edit Plan / STEP_09 Q&A）が参照する **scene master** を `02_Scenes` に生成する。

**設計原則**:
- scene は `target_age` と動画尺（`short_target_sec` / `full_target_sec`）を前提に設計する
- scene の粒度は「年齢適合性・理解しやすさ・映像化しやすさ・脚本化しやすさ」を満たすこと
- 初期実装では、**後工程側での scene 分割・統合・並べ替えは禁止**（STEP_03 が正本）
- scene 数・尺は `prompts/scene_count_and_duration_policy_v1.md` および `prompts/age_band_scene_guidline_v1.md` に従う

---

## 2. スコープ

### 対象
- 起動: GAS → GitHub Actions `workflow_dispatch`（STEP_01 / STEP_02 と同一経路）
- 入力:
  - `00_Project`（主入力）
  - `01_Source`（参照入力）
  - `94_Runtime_Config`（scene_max_sec 等のランタイム設定）
- AI 実行: Gemini API を利用して scene 分割を行う
- 出力:
  - `02_Scenes` に scene 行を書き込む（`project_id` + `scene_id` 複合キー upsert）
  - `00_Project` の `current_step` を `STEP_03_SCENES_BUILD` に更新
  - `100_App_Logs` に成功・失敗ログを書き出す

### スコープ外（初期実装）
- 後工程側での scene 分割・統合・並べ替え（禁止）
- Short / Full で別々の scene 構成を持つこと（同一 scene master を両方で再利用）
- fast-pass（STEP_03 では適用なし）
- 大量バッチ最適化

---

## 3. 実行方式

STEP_01 / STEP_02 と同一の実行経路を採用する。

1. GAS が `workflow_dispatch` で GitHub Actions を起動
2. GitHub Actions が `94_Runtime_Config` を読む（`scene_max_sec_*` キーを含む）
3. payload に基づき `00_Project` から対象案件を読む
4. `01_Source` から当該 `project_id` の行を読む
5. **`01_Source` の `approval_status` が `APPROVED` でない場合はエラー停止**
6. Prompt / Schema / Example / Field Guide / Policy を読み込む
7. `required_scene_count` を算出する（§6.2 参照）
8. Gemini を実行する（primary → secondary fallback）
9. AI 出力を schema 検証する
10. `02_Scenes` に scene 行を upsert する（`project_id` + `scene_id` 複合キー）
11. `00_Project` の `current_step` 等を最小更新する
12. `100_App_Logs` に成功・失敗ログを書き出す

---

## 4. 入力

### 4.1 主入力シート
- `00_Project`

### 4.2 参照入力シート
- `01_Source`（`project_id` をキーに 1 行取得）

### 4.3 主キー
- `project_id`

### 4.4 AI に渡す入力列（確定）

**`00_Project` から渡す列（全 Mandatory）**:

| フィールド | 必須 | 用途 |
|---|---|---|
| `project_id` | **Mandatory** | 案件識別 |
| `title_jp` | **Mandatory** | 作品タイトル |
| `target_age` | **Mandatory** | scene 粒度・語彙・尺算出に直結 |
| `short_target_sec` | **Mandatory** | Short 動画尺（60〜480秒、30秒刻み） |
| `full_target_sec` | **Mandatory** | Full 動画尺（60〜480秒、30秒刻み） |
| `visual_style` | Optional | 映像化方針の補足 |

**`01_Source` から渡す列**:

| フィールド | 必須 | 用途 |
|---|---|---|
| `adaptation_policy` | **Mandatory** | 現代語化・脚色方針（scene 設計の最重要入力） |
| `language_style` | **Mandatory** | 言語スタイル方針 |
| `difficult_terms` | Optional | 難語リスト（scene 内での言葉の扱い補足） |
| `credit_text` | Optional | クレジット文（参照のみ） |
| `base_text_notes` | Optional | 底本注記（補足） |

**`94_Runtime_Config` から取得する値**:

| key | 内容 | 例 |
|---|---|---|
| `scene_max_sec_2-3` | 2-3歳向け 1 scene 最大秒数 | `15` |
| `scene_max_sec_4-6` | 4-6歳向け 1 scene 最大秒数 | `20` |
| `scene_max_sec_6-8` | 6-8歳向け 1 scene 最大秒数 | `30` |

### 4.5 事前チェック（01_Source approval_status）

```
if 01_Source row が見つからない:
  → エラー停止 + approval_status=UNKNOWN + ログ

if 01_Source.approval_status != "APPROVED":
  → エラー停止 + approval_status=UNKNOWN + ログ
  （STEP_02 完了・人手承認が前提）
```

---

## 5. 出力

### 5.1 `02_Scenes` の列定義（確定）

| フィールド | role | AI出力 | 後続AI入力 | 説明 |
|---|---|---|---|---|
| `project_id` | SYSTEM_CONTROL | N | — | 案件ID（GH補完） |
| `record_id` | SYSTEM_CONTROL | N | — | GH採番 `PJT-001-SCN-001`（後述） |
| `generation_status` | SYSTEM_CONTROL | N | — | 固定: `GENERATED` |
| `approval_status` | HUMAN_REVIEW | N | — | 固定: `PENDING` |
| `step_id` | SYSTEM_CONTROL | N | — | 固定: `STEP_03_SCENES_BUILD` |
| `scene_id` | AI_OUTPUT | Y | **Y** | scene 識別子 例: `SC-001-01` |
| `scene_order` | AI_OUTPUT | Y | **Y** | scene の順序（1始まり整数） |
| `scene_title` | AI_OUTPUT | Y | **Y** | scene タイトル（端的に） |
| `scene_summary` | AI_OUTPUT | Y | **Y** | scene の内容サマリー（2〜4文） |
| `scene_purpose` | AI_OUTPUT | Y | **Y** | scene の物語的役割・目的 |
| `scene_type` | AI_OUTPUT | Y | **Y** | scene 種別（enum: `intro` / `development` / `climax` / `resolution` / `ending`） |
| `scene_target_sec` | AI_OUTPUT | Y | **Y** | この scene の推奨尺（秒）|
| `key_characters` | AI_OUTPUT | Y | **Y** | 登場する主要キャラクター（全角「、」区切り） |
| `key_events` | AI_OUTPUT | Y | **Y** | scene 内で起こる主要な出来事（1〜3文） |
| `visual_notes` | AI_OUTPUT | Y | **Y** | 映像化の方向性ヒント（STEP_06 Visual Bible 用） |
| `narration_style` | AI_OUTPUT | Y | **Y** | このscene のナレーション・語りのトーン |
| `updated_at` | SYSTEM_CONTROL | N | — | GH補完（ISO8601） |
| `updated_by` | SYSTEM_CONTROL | N | — | 固定: `github_actions` |
| `notes` | HUMAN_REVIEW | N | N | 補足メモ（空文字） |

### 5.2 `record_id` 採番規則（確定）

- 形式: `PJT-001-SCN-001`
- `SCN` サフィックス（STEP_02 の `SC` と区別）
- 連番部分は `scene_order` に対応（scene_order=1 → `PJT-001-SCN-001`）

### 5.3 upsert 単位（確定: B-2）

- **複合キー**: `project_id` + `scene_id`
- 既存行に `project_id` + `scene_id` が一致する行があれば UPDATE（`record_id` は既存を維持）
- 一致しなければ新規 INSERT（`record_id` を新規採番）
- 再実行時の動作: 既存 scene は上書き更新。新 scene は追記。削除された scene は残存する（初期実装では削除しない）

> **注**: 再実行時に scene 構成が変わった場合（scene 数の増減）は、旧 scene 行が残存する可能性がある。初期実装ではこの残存行は許容とし、後工程は `step_id = STEP_03_SCENES_BUILD` かつ `generation_status = GENERATED` の行を `scene_order` 昇順で参照する仕様とする。

### 5.4 `00_Project` の更新対象列

| フィールド | 更新値 |
|---|---|
| `current_step` | `STEP_03_SCENES_BUILD`（上書き） |
| `approval_status` | 成功: `PENDING` / 失敗: `UNKNOWN` |
| `updated_at` | 実行完了時刻 |
| `updated_by` | `github_actions` |

---

## 6. scene 設計ルール

### 6.1 基本原則（scene_count_and_duration_policy_v1.md 準拠）

- STEP_03 は後工程（STEP_04〜09）の基準となる **scene master** を定義する
- scene 分割時の 1 scene 最大秒数は `94_Runtime_Config` の `scene_max_sec_{target_age}` を参照する
- 最低必要 scene 数: `required_scene_count = ceil(full_target_sec / scene_max_sec)`
- `full_target_sec` と `scene_max_sec` の制約を満たすために必要な場合、推奨 scene 数レンジより `required_scene_count` を優先する
- `short_target_sec` / `full_target_sec` の範囲: **60〜480秒（30秒刻み）**

### 6.2 required_scene_count の算出（GitHub 側で実施）

```typescript
const sceneMaxSec = parseInt(configMap.get(`scene_max_sec_${targetAge}`) ?? defaultSceneMaxSec);
const requiredSceneCount = Math.ceil(fullTargetSec / sceneMaxSec);
```

- 算出した `required_scene_count` を AI へのプロンプトに含めて渡す
- `scene_target_sec` の合計が `full_target_sec` の ±15% 以内に収まるよう AI に指示する

### 6.3 age_band_scene_guidline_v1.md 準拠ルール

| target_age | scene の特徴 | 構成方針 |
|---|---|---|
| `2-3` | 短く単純で反復しやすい場面。理解負荷の高い転換を避ける | 繰り返し・リズム中心 |
| `4-6` | 導入・展開・山場・結びの役割が分かりやすい構成 | 起承転結を意識 |
| `6-8` | 因果関係や感情変化をより明確に含む構成を許容 | 心情変化・動機を含む |

### 6.4 scene_max_sec のデフォルト値（94_Runtime_Config 未設定時のフォールバック）

| key | デフォルト値 | 根拠 |
|---|---|---|
| `scene_max_sec_2-3` | `15` | 2-3歳は集中持続が短い |
| `scene_max_sec_4-6` | `20` | 4-6歳は1場面20秒程度が適切 |
| `scene_max_sec_6-8` | `30` | 6-8歳は1場面30秒まで対応可 |

---

## 7. エラーハンドリング

| エラー種別 | 対処 |
|---|---|
| `01_Source` 行が見つからない | エラー停止 + `approval_status=UNKNOWN` + ログ |
| `01_Source.approval_status != APPROVED` | エラー停止 + `approval_status=UNKNOWN` + ログ |
| `scene_max_sec_{target_age}` キーが未設定 | デフォルト値でフォールバック + 警告ログ |
| Gemini API 失敗（primary） | secondary fallback |
| Gemini API 失敗（secondary） | `approval_status=UNKNOWN` + ログ |
| schema validation 失敗 | `approval_status=UNKNOWN` + ログ |
| scene 数が 0 または極端に多い（>20） | 警告ログ + schema validation で棄却 |
| GSS 書き込み失敗 | ログ出力（処理続行） |

---

## 8. ランタイム設定

| key | 内容 | 備考 |
|---|---|---|
| `gemini_api_key` | Gemini API Key | STEP_01/02 と共通 |
| `step_03_model_role` | STEP_03 primary model | **独立キー**、未設定時: `gemini-2.5-pro` |
| `model_role_text_pro` | STEP_03 seconday model | **独立キー**、未設定時: `gemini-3.1-pro-preview` |
| `model_role_text_flash_seconday` | secondary model | STEP_02 と共通キー |
| `scene_max_sec_2-3` | 2-3歳向け 1 scene 最大秒数 | 未設定時: `15` |
| `scene_max_sec_4-6` | 4-6歳向け 1 scene 最大秒数 | 未設定時: `20` |
| `scene_max_sec_6-8` | 6-8歳向け 1 scene 最大秒数 | 未設定時: `30` |

> **GSS 対応**: `94_Runtime_Config` に `step_03_model_role` および `scene_max_sec_*` 3キーを実装着手前に追加すること。

---

## 9. 利用アセットファイル一覧（確定）

| ファイルパス | 状態 | 内容 |
|---|---|---|
| `prompts/scene_build_prompt_v1.md` | **本仕様と同時作成** | STEP_03 メインプロンプト |
| `prompts/fragments/scene_build_output_field_guide_v1.md` | **本仕様と同時作成** | 出力フィールドガイド |
| `prompts/scene_count_and_duration_policy_v1.md` | **既存（commit 9b8fb89）** | scene 数・尺ポリシー |
| `prompts/age_band_scene_guidline_v1.md` | **既存（commit 818d701）** | 年齢帯別 scene ガイドライン |
| `schemas/scene_build_schema_ai_v1.json` | **本仕様と同時作成** | AI出力スキーマ |
| `schemas/scene_build_schema_full_v1.json` | **本仕様と同時作成** | GSS書き込み full スキーマ |
| `examples/scene_build_ai_response_example_v1.json` | **本仕様と同時作成** | AI出力サンプル（1案件・複数 scene） |

---

## 10. 実装フェーズ計画

| フェーズ | 内容 | 新規/流用 |
|---|---|---|
| Phase 1 | `src/types.ts` に `SceneAiRow`, `SceneFullRow`, `SourceReadRow` 追加 | 既存拡張 |
| Phase 2 | `src/lib/load-source.ts`（01_Source 読み込み） | **新規** |
| Phase 3 | `src/lib/write-scenes.ts`（02_Scenes 複合キー upsert） | **新規** |
| Phase 4 | `src/lib/build-prompt.ts` に `buildStep03Prompt` 追加 | 既存拡張 |
| Phase 5 | `src/lib/load-assets.ts` に `loadStep03Assets` 追加 | 既存拡張 |
| Phase 6 | `src/lib/validate-json.ts` に `validateSceneAiResponse` 追加 | 既存拡張 |
| Phase 7 | `src/steps/step03-scenes-build.ts`（オーケストレーター） | **新規** |
| Phase 8 | `src/index.ts` に STEP_03 ルーティング追加 | 既存拡張 |
| Phase 9 | `src/lib/write-app-log.ts` に STEP_03 ログビルダー追加 | 既存拡張 |

---

## 11. 実装着手前チェックリスト

**GSS 対応（ユーザー実施）**
- [ ] `94_Runtime_Config` に `step_03_model_role = gemini-2.5-pro` を追加
- [ ] `94_Runtime_Config` に `scene_max_sec_2-3 = 15` を追加
- [ ] `94_Runtime_Config` に `scene_max_sec_4-6 = 25` を追加
- [ ] `94_Runtime_Config` に `scene_max_sec_6-8 = 40` を追加
- [ ] `02_Scenes` シートを GSS に作成し、ヘッダー行（row 5）に列定義を設定
- [ ] `02_Scenes` シートに 999 行の空行を挿入

**リポジトリ対応（実装と同時）**
- [ ] `prompts/scene_build_prompt_v1.md` 作成
- [ ] `prompts/fragments/scene_build_output_field_guide_v1.md` 作成
- [ ] `schemas/scene_build_schema_ai_v1.json` 作成
- [ ] `schemas/scene_build_schema_full_v1.json` 作成
- [ ] `examples/scene_build_ai_response_example_v1.json` 作成

**実装フェーズ**
- [ ] Phase 1: `src/types.ts` 拡張
- [ ] Phase 2: `src/lib/load-source.ts` 新規作成
- [ ] Phase 3: `src/lib/write-scenes.ts` 新規作成
- [ ] Phase 4: `src/lib/build-prompt.ts` 拡張
- [ ] Phase 5: `src/lib/load-assets.ts` 拡張
- [ ] Phase 6: `src/lib/validate-json.ts` 拡張
- [ ] Phase 7: `src/steps/step03-scenes-build.ts` 新規作成
- [ ] Phase 8: `src/index.ts` 拡張
- [ ] Phase 9: `src/lib/write-app-log.ts` 拡張
