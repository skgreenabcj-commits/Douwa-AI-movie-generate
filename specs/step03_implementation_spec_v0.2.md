# STEP_03 実装仕様 v0.2

> **ステータス**: 確定（ユーザー確認済み 2026-04-04 / 要件正本改訂反映 2026-04-04）
> **正本要件**: `specs/step03_implementation_ai_requirement.md`
> **修正指示**: `specs/step_03_update_request_for_claude.md`（旧ファイル名: `step_03_update_request_for_calude.md`）
> **前提**: STEP_01 / STEP_02 実装仕様 v0.2 の構造・パターンを継承する

---

## 1. 目的

本ドキュメントは、GitHub Actions 上で実行する STEP_03（Scene Build）の実装仕様を定義する合意済み仕様書である。

**STEP_03 の役割**:
STEP_02 で生成した `01_Source`（底本・脚色方針）をもとに、AI が物語を scene 単位に分割し、
後工程が参照する **scene master** を `02_Scenes` に生成する。

後工程とは以下を指す:
- `STEP_04_05_COMBINED`（Short + Full Script Build）
- `STEP_06`（Visual Bible）
- `STEP_07`（Image Prompts）
- `STEP_08`（Audio / Subtitle / Edit Plan）
- `STEP_09`（Q&A Build）

**設計原則**:
- `02_Scenes` は後工程の **基準データ（scene master）** であり、後工程は `02_Scenes` を参照して処理を行う
- scene は `target_age` と動画尺（`short_target_sec` / `full_target_sec`）を前提に設計する
- scene の粒度は「年齢適合性・理解しやすさ・映像化しやすさ・脚本化しやすさ」を満たすこと
- 初期実装では、**後工程側での scene 分割・統合・並べ替えは禁止**（STEP_03 が正本）
- scene 数・尺は `prompts/scene_count_and_duration_policy_v1.md` および `prompts/age_band_scene_guideline_v1.md` に従う
- `scene_no`（project_id ごとの通し番号）はシステム側（GitHub）で付与し、AI には scene 内容の構造化に集中させる

---

## 2. スコープ

### 対象
- 起動: GAS → GitHub Actions `workflow_dispatch`（STEP_01 / STEP_02 と同一経路）
- 入力:
  - `00_Project`（主入力）
  - `01_Source`（参照入力）
  - `94_Runtime_Config`（scene_max_sec 等のランタイム設定）
- AI 実行: Gemini API を利用して scene master を生成する
- 出力:
  - `02_Scenes` に scene 行を書き込む（`project_id` + `scene_no` 複合キー upsert）
  - `00_Project` の `current_step` を `STEP_03_SCENES_BUILD` に更新
  - `100_App_Logs` に成功・失敗ログを書き出す

### スコープ外（初期実装）
- 後工程側での scene 分割・統合・並べ替え（禁止）
- Short版 / Full版 で別々の scene 構成を持つこと（同一 scene master を両方で再利用）
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
7. `required_scene_count_base` を算出する（§6.2 参照）
8. Gemini を実行する（primary → 1st fallback → 2nd fallback の 3 段構成）
9. AI 出力を schema 検証する
10. `scene_no`（通し番号）・`scene_order` をシステム側で付与する
11. `02_Scenes` に scene 行を upsert する（`project_id` + `scene_no` 複合キー）
12. `00_Project` の `current_step` 等を最小更新する
13. `100_App_Logs` に成功・失敗ログを書き出す

---

## 4. 入力

### 4.1 主入力シート
- `00_Project`

### 4.2 参照入力シート
- `01_Source`（`project_id` をキーに 1 行取得）

### 4.3 主キー
- `project_id`

### 4.4 AI に渡す入力列（確定）

**`00_Project` から渡す列**:

| フィールド | 必須 | 用途 |
|---|---|---|
| `project_id` | **Mandatory** | 案件識別 |
| `title_jp` | **Mandatory** | 作品タイトル |
| `target_age` | **Mandatory** | scene 粒度・語彙・尺算出に直結（2-3 / 4-6 / 6-8 の3区分） |
| `short_target_sec` | **Mandatory** | Short版 動画尺（60〜1200秒、30秒刻み）。rough estimate の基準。 |
| `full_target_sec` | **Mandatory** | Full版 動画尺（60〜1200秒、30秒刻み）。scene 数算出の基準。 |
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

| key | 内容 | 値 |
|---|---|---|
| `scene_max_sec_2-3` | 2-3歳向け 1 scene 最大秒数 | `15` |
| `scene_max_sec_4-6` | 4-6歳向け 1 scene 最大秒数 | `25` |
| `scene_max_sec_6-8` | 6-8歳向け 1 scene 最大秒数 | `40` |

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
| `scene_no` | SYSTEM | N（システム付与） | **Y** | scene 識別子。project_id ごとの通し番号（`"1"`, `"2"`, `"3"`...）。文字列型で GSS に書き込む。 |
| `chapter` | AI_OUTPUT | Y | **Y** | 物語上の章・大区分（例: 「導入」「仲間集結」「対決」）。Script/Visual の整理用。 |
| `scene_title` | AI_OUTPUT | Y | **Y** | scene を一目で識別できる短い名称（20字以内目安） |
| `scene_summary` | AI_OUTPUT | Y | **Y** | scene 内で何が起こるかの要約（1〜3文程度） |
| `scene_goal` | AI_OUTPUT | Y | **Y** | その scene が物語上果たす役割（1文程度）。構成妥当性・脚色方針・QC に使用。 |
| `visual_focus` | AI_OUTPUT | Y | **Y** | 映像上、何を主に見せるか（具体的な名詞句/短文）。STEP_06, STEP_07 用。 |
| `emotion` | AI_OUTPUT | Y | **Y** | scene の主感情・感情トーン（短いテキスト）。Script トーン・演出・音調整用。 |
| `short_use` | AI_OUTPUT | Y | **Y** | Short版で採用するか。`Y` または `N` のみ。厳選基準は §9 参照。 |
| `full_use` | AI_OUTPUT | Y | **Y** | Full版で採用するか。`Y` または `N` のみ。初期実装では原則 `Y`。 |
| `est_duration_short` | AI_OUTPUT | Y | **Y** | Short版での概算秒数（rough estimate）。最終調整は STEP_04_05_COMBINED で行う。 |
| `est_duration_full` | AI_OUTPUT | Y | **Y** | Full版での概算秒数（rough estimate）。Full版 scene の想定時間。 |
| `difficult_words` | AI_OUTPUT | Y | **Y** | 対象年齢に難しい語彙（全角「、」区切り）。語彙平易化・字幕最適化用。 |
| `easy_rewrite` | AI_OUTPUT | Y | **Y** | 難語の言い換え候補（全角「、」区切り対応）。STEP_04_05_COMBINED でのやさしい表現化用。 |
| `qa_seed` | AI_OUTPUT | Y | **Y** | QA生成の種になる問い・観点（短い問い/論点）。STEP_09 で再利用。 |
| `continuity_note` | AI_OUTPUT | Y | **Y** | 前後 scene との接続メモ（短文）。Script / Visual / Edit の continuity 維持用。 |
| `updated_at` | SYSTEM_CONTROL | N | — | GH補完（ISO8601） |
| `updated_by` | SYSTEM_CONTROL | N | — | 固定: `github_actions` |
| `notes` | HUMAN_REVIEW | N | N | 補足メモ（空文字） |

### 5.2 `record_id` 採番規則（確定）

- 形式: `PJT-001-SCN-001`
- `SCN` サフィックス（STEP_02 の `SC` と区別）
- 連番部分は `scene_order` に対応（scene_order=1 → `PJT-001-SCN-001`）

### 5.3 `scene_no` の付与責務（確定）

- **`scene_no`** はシステム側（GitHub）で付与する
- AI には scene 内容の構造化に集中させ、識別子の責務はシステムに持たせる
- `scene_no` 形式: project_id ごとの通し番号（`"1"`, `"2"`, `"3"`...）。文字列型で GSS に書き込む。
- 内部管理用 `scene_order`（1始まり整数）もあわせて保持するが GSS には出力しない
- これにより、後工程との同期性・再実行時の整合性を担保する

### 5.4 upsert 単位（確定: B-2）

- **複合キー**: `project_id` + `scene_no`
- 既存行に `project_id` + `scene_no` が一致する行があれば UPDATE（`record_id` は既存を維持）
- 一致しなければ新規 INSERT（`record_id` を新規採番）
- 再実行時の動作: 既存 scene は上書き更新。新 scene は追記。削除された scene は残存する（初期実装では削除しない）

> **注**: 再実行時に scene 構成が変わった場合（scene 数の増減）は、旧 scene 行が残存する可能性がある。後工程は `step_id = STEP_03_SCENES_BUILD` かつ `generation_status = GENERATED` の行を `scene_no`（数値順）昇順で参照する仕様とする。

### 5.5 `00_Project` の更新対象列

| フィールド | 更新値 |
|---|---|
| `current_step` | `STEP_03_SCENES_BUILD`（上書き） |
| `approval_status` | 成功: `PENDING` / 失敗: `UNKNOWN` |
| `updated_at` | 実行完了時刻 |
| `updated_by` | `github_actions` |

---

## 6. scene 設計ルール

### 6.1 基本原則

- STEP_03 は後工程（STEP_04_05_COMBINED〜STEP_09）の基準となる **scene master** を定義する
- `02_Scenes` は Full版基準の scene master として構成する
- Short版は `short_use = Y` の scene を厳選して構成する
- scene 分割時の 1 scene 最大秒数は `94_Runtime_Config` の `scene_max_sec_{target_age}` を参照する
- `target_sec` は品質優先の目標値であり、機械的な厳守を最優先にはしない
  - 子どもが楽しめること・物語として自然であること・一貫性があることを優先する
  - ただし STEP_04_05_COMBINED において、ユーザー指定秒数に対して **最大 +15% まで** を許容上限とする

### 6.2 `required_scene_count_base` の算出（GitHub 側で実施）

```typescript
const sceneMaxSec = parseInt(configMap.get(`scene_max_sec_${targetAge}`) ?? defaultSceneMaxSec);
const requiredSceneCountBase = Math.ceil(fullTargetSec / sceneMaxSec);
// 許容レンジ: Math.floor(base * 0.85) 〜 Math.ceil(base * 1.15)
```

- 算出した `required_scene_count_base` を AI へのプロンプトに含めて渡す
- AI はこの基準値の **±15% 程度**を許容範囲として、物語構造・導入の短さ・感情展開・理解負荷を考慮して scene 数を調整してよい
- `est_duration_full` の合計が `full_target_sec` の ±15% 以内を目安とする（rough estimate）

### 6.3 年齢帯別 scene 設計ルール

| target_age | scene_max_sec | scene の特徴 | 構成方針 |
|---|---|---|---|
| `2-3` | 15秒 | 短く単純で反復しやすい場面。理解負荷の高い転換を避ける | 繰り返し・リズム中心 |
| `4-6` | 25秒 | 導入・展開・山場・結びの役割が分かりやすい構成 | 起承転結を意識 |
| `6-8` | 40秒 | 因果関係や感情変化をより明確に含む構成を許容 | 心情変化・動機を含む |

### 6.4 scene_max_sec のデフォルト値（94_Runtime_Config 未設定時のフォールバック）

| key | デフォルト値 | 根拠 |
|---|---|---|
| `scene_max_sec_2-3` | `15` | 2-3歳は集中持続が短い |
| `scene_max_sec_4-6` | `25` | 4-6歳は1場面25秒程度が適切 |
| `scene_max_sec_6-8` | `40` | 6-8歳は1場面40秒まで対応可 |

---

## 7. STEP_04_05_COMBINED との同期ルール

- `STEP_04_05_COMBINED` は STEP_03 の `02_Scenes` を scene master として参照する
- 初期実装では scene の増減・分割・統合・並び替えは禁止
- 各 script row は少なくとも `project_id`, `scene_no`（内部管理用: `scene_order`）を保持する
- Short版 / Full版 の違いは scene 構造ではなく、採用可否・記述密度・尺配分で調整する
- `short_use` / `full_use` は Y/N フラグであり、STEP_04_05_COMBINED での Short / Full 分岐の基準となる
- GitHub 側では後段バリデーションとして以下を検証する:
  - scene count の一致
  - `scene_no` 集合の整合
  - scene_order の整合
  - 重複の有無

---

## 8. Short版 / Full版 の設計方針

### 8.1 基本方針

- `02_Scenes` は Full版基準の scene master として構成する
- Full版の想定サンプルは約 **480 秒**
- Short版の想定サンプルは約 **240 秒**
- Short版は `short_use = Y` の scene を厳選して構成する
- Short版の時間配分は STEP_03 で rough に見積もる（`est_duration_short`）
- 最終的な Short版 script の尺調整は `STEP_04_05_COMBINED` で行う

### 8.2 `short_use` フラグの運用

- `short_use = Y` は Short版で採用すべき主要 scene を示す
- 物語の理解・感情曲線・満足感を保てるよう厳選する
- 説明重複 scene や補助的 scene は `N` にしてよい
- ただし、導入・転換点・山場・結びの欠落で物語が崩れないようにする

### 8.3 `full_use` フラグの運用

- 初期実装では Full版 scene master を主系統とするため、原則 `full_use = Y`
- ただし schema 上は Y/N を保持し、将来の例外運用に備える

---

## 9. エラーハンドリング

| エラー種別 | 対処 |
|---|---|
| `01_Source` 行が見つからない | エラー停止 + `approval_status=UNKNOWN` + ログ |
| `01_Source.approval_status != APPROVED` | エラー停止 + `approval_status=UNKNOWN` + ログ |
| `scene_max_sec_{target_age}` キーが未設定 | デフォルト値でフォールバック + 警告ログ |
| Gemini API 失敗（primary） | 1st fallback（`model_role_text_pro`）へ続行 |
| Gemini API 失敗（1st fallback） | 2nd fallback（`model_role_text_flash_seconday`）へ続行 |
| Gemini API 失敗（2nd fallback） | `approval_status=UNKNOWN` + ログ |
| schema validation 失敗 | `approval_status=UNKNOWN` + ログ |
| scene 数が 0 または極端に多い（>30） | 警告ログ + schema validation で棄却 |
| GSS 書き込み失敗 | ログ出力（処理続行） |

---

## 10. ランタイム設定

| key | 内容 | 備考 |
|---|---|---|
| `gemini_api_key` | Gemini API Key | STEP_01/02 と共通 |
| `step_03_model_role` | STEP_03 primary model | **独立キー**、未設定時: `gemini-2.5-pro` |
| `model_role_text_pro` | 1st fallback model | STEP_01 と共通キー、未設定時: `gemini-3.1-pro-preview` |
| `model_role_text_flash_seconday` | 2nd fallback model（最終手段） | STEP_02 と共通キー、未設定時: `gemini-2.0-flash` |
| `scene_max_sec_2-3` | 2-3歳向け 1 scene 最大秒数 | 未設定時: `15` |
| `scene_max_sec_4-6` | 4-6歳向け 1 scene 最大秒数 | 未設定時: `25` |
| `scene_max_sec_6-8` | 6-8歳向け 1 scene 最大秒数 | 未設定時: `40` |

> **GSS 対応**: `94_Runtime_Config` に `step_03_model_role` および `scene_max_sec_*` 3キーを実装着手前に追加すること。
>
> **モデル fallback 構成（3 段）**:
> 1. **Primary**: `step_03_model_role`（デフォルト: `gemini-2.5-pro`）
> 2. **1st fallback**: `model_role_text_pro`（デフォルト: `gemini-3.1-pro-preview`）← STEP_01 と共通キー
> 3. **2nd fallback**: `model_role_text_flash_seconday`（デフォルト: `gemini-2.0-flash`）← STEP_02 と共通キー・最終手段
> Spending Cap 超過時はいかなる fallback も行わずに即時停止する。
>
> **⚠️ `model_role_text_flash_seconday` についての注記**:
> このキー名は `secondary` の誤記（`seconday`）であるが、GSS `94_Runtime_Config` および STEP_01/02 のコードで**すでに確定済みのキー名**として使用されている。
> コード・GSS 両方の同時移行なしに単独修正すると実行時エラーとなるため、現時点では**意図的にそのまま維持**する。
> 将来的に `model_role_text_flash_secondary`（正しいスペル）へリネームする場合は、`94_Runtime_Config` の GSS 変更とコード変更を同一リリースで実施すること。

---

## 11. 利用アセットファイル一覧（確定）

| ファイルパス | 状態 | 内容 |
|---|---|---|
| `prompts/scene_build_prompt_v1.md` | 本仕様と同時改訂 | STEP_03 メインプロンプト |
| `prompts/fragments/scene_build_output_field_guide_v1.md` | 本仕様と同時改訂 | 出力フィールドガイド |
| `prompts/scene_count_and_duration_policy_v1.md` | 本仕様と同時改訂 | scene 数・尺ポリシー |
| `prompts/age_band_scene_guideline_v1.md` | 既存（commit 818d701）からファイル名修正 | 年齢帯別 scene ガイドライン |
| `schemas/scene_build_schema_ai_v1.json` | 本仕様と同時改訂 | AI出力スキーマ |
| `schemas/scene_build_schema_full_v1.json` | 本仕様と同時改訂 | GSS書き込み full スキーマ |
| `examples/scene_build_ai_response_example_v1.json` | 本仕様と同時改訂 | AI出力サンプル（桃太郎 Full480秒/Short240秒前提）|

---

## 12. 実装フェーズ計画

| フェーズ | 内容 | 状態 |
|---|---|---|
| Phase 1 | `src/types.ts` に `SceneAiRow`, `SceneFullRow`, `SourceReadRow` 追加・更新 | 要更新 |
| Phase 2 | `src/lib/load-source.ts`（01_Source 読み込み） | 完了 |
| Phase 3 | `src/lib/write-scenes.ts`（02_Scenes 複合キー upsert）新フィールド対応 | 要更新 |
| Phase 4 | `src/lib/build-prompt.ts` の `buildStep03Prompt` 更新 | 要更新 |
| Phase 5 | `src/lib/load-assets.ts` の `loadStep03Assets` | 完了 |
| Phase 6 | `src/lib/validate-json.ts` の `validateSceneAiResponse` 更新 | 要更新 |
| Phase 7 | `src/steps/step03-scenes-build.ts`（オーケストレーター）scene_no/scene_order 付与ロジック追加 | 完了 |
| Phase 8 | `src/index.ts` に STEP_03 ルーティング | 完了 |
| Phase 9 | `src/lib/write-app-log.ts` に STEP_03 ログビルダー | 完了 |

---

## 13. 実装着手前チェックリスト

**GSS 対応（ユーザー実施）**
- [ ] `94_Runtime_Config` に `step_03_model_role = gemini-2.5-pro` を追加（`model_role_text_pro` および `model_role_text_flash_seconday` は STEP_01/02 で設定済の場合は追加不要）
- [ ] `94_Runtime_Config` に `scene_max_sec_2-3 = 15` を追加
- [ ] `94_Runtime_Config` に `scene_max_sec_4-6 = 25` を追加
- [ ] `94_Runtime_Config` に `scene_max_sec_6-8 = 40` を追加
- [ ] `02_Scenes` シートを GSS に作成し、ヘッダー行（row 5）に列定義を設定（新フィールド含む）
- [ ] `02_Scenes` シートに 999 行の空行を挿入

**リポジトリ対応（実装と同時）**
- [x] `prompts/scene_build_prompt_v1.md` 改訂済
- [x] `prompts/fragments/scene_build_output_field_guide_v1.md` 改訂済
- [x] `prompts/scene_count_and_duration_policy_v1.md` 改訂済
- [x] `schemas/scene_build_schema_ai_v1.json` 改訂済
- [x] `schemas/scene_build_schema_full_v1.json` 改訂済
- [x] `examples/scene_build_ai_response_example_v1.json` 改訂済
- [x] `prompts/age_band_scene_guideline_v1.md` ファイル名修正済（旧: `age_band_scene_guidline_v1.md`）
- [x] `src/lib/load-assets.ts` ファイル名参照を `age_band_scene_guideline_v1.md` に更新済
