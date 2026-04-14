# STEP_08B TTS Audio Generate 実装設計書 v0.2

> **ステータス**: 確定（オーナー判断反映済み 2026-04-13）
> **改訂履歴**:
> - v0.1 (2026-04-12): 初版
> - v0.2 (2026-04-13): narrator 女性固定・全 voice female 統一・speakingRate 読み聞かせ基準値化・TTS 入力を SSML 化（`input.ssml`）・日本語イントネーション厳格指示追加
> **元仕様**: `docs/02_process_flow.md`、`docs/GSS_field_master.tsv`
> **前提実装**: STEP_08A 完了後に実行（`08_TTS_Subtitles.audio_file = ""` の行が対象）

---

## 1. 本書の目的

STEP_08B TTS Audio Generate の実装設計を定義する。

本ステップは STEP_08A が生成した `08_TTS_Subtitles` の `tts_text`（SSML 文字列）/
`voice_style` / `speech_rate` を入力として
Google Cloud Text-to-Speech API で音声ファイルを生成し、以下を書き戻す:

| 書き戻し先 | フィールド |
|---|---|
| `08_TTS_Subtitles` | `audio_file`（Drive URL）、`tc_in`、`tc_out` |
| `09_Edit_Plan` | `asset_audio`（Drive URL）、`duration_sec`（実測値で上書き） |

本ステップは Gemini を呼び出さない（AI レス）。

> **SSML 入力**: STEP_08A が生成した `tts_text` は `<speak>〜</speak>` 形式の SSML 文字列。
> TTS API には `input.text` ではなく `input.ssml` フィールドで渡す。

---

## 2. 確定した設計判断

| # | 論点 | 判断 | 実装への影響 |
|---|---|---|---|
| 論点1 | TTS サービス | **Google Cloud Text-to-Speech API**（REST v1） | 既存の `GOOGLE_SERVICE_ACCOUNT_JSON` で認証。新規パッケージ不要 |
| 論点2 | 音声フォーマット | **MP3**（`MP3` encoding） | ファイルサイズが小さく Drive・編集ソフトとの互換性が高い |
| 論点3 | `tc_in` / `tc_out` の算出 | **`tc_in = "0:00.000"` 固定、`tc_out` = 実測音声長** | 1シーン1行のため tc_in は常に 0。音声バイナリから duration を計算（§4 参照） |
| 論点4 | `duration_sec` の扱い | **STEP_08A の AI 推定値を実測値で上書き** | TTS 生成後に `09_Edit_Plan.duration_sec` を実測秒数で更新 |
| 論点5 | Drive 保存先 | **STEP_07 と同一プロジェクトフォルダ**（`ensurePjtFolder` を流用） | 画像と音声を同一フォルダで管理。ファイル名は `{record_id}_{version}_{date}.mp3` |
| 論点6 | 再実行時の挙動 | **`audio_file` が空欄の行のみ処理** | 既に音声生成済みの行はスキップ。強制再生成は手動で `audio_file` をクリアして再実行 |
| 論点7 | narrator キャラクター | **女性固定**（`ja-JP-Neural2-B`） | 全 voice_style でベース声優を女性 Neural2-B に統一 |
| 論点8 | TTS 入力形式 | **SSML**（`input.ssml`） | STEP_08A の `tts_text` は SSML 文字列のため `input.text` ではなく `input.ssml` で渡す |

### `voice_style` → Google Cloud TTS voice 名 マッピング

**声優キャラクターは全スタイルで女性（`ja-JP-Neural2-B`）に統一する。**
`voice_style` は声のトーンを `prosody` / `speakingRate` 等の SSML パラメータで差別化する。
マッピングは `94_Runtime_Config` にキーとして保持しハードコードしない。

| `voice_style` | デフォルト voice name | 性別 | 備考 |
|---|---|---|---|
| `narrator` | `ja-JP-Neural2-B` | 女性 | 標準ナレーション。落ち着いた語り口 |
| `gentle` | `ja-JP-Neural2-B` | 女性 | やさしく温かみのある表現。SSML `<prosody rate="slow">` で調整 |
| `excited` | `ja-JP-Neural2-B` | 女性 | 明るく活気ある表現。SSML `<prosody rate="fast" pitch="+2st">` で調整 |
| `tense` | `ja-JP-Neural2-B` | 女性 | 緊張感ある場面。SSML `<prosody pitch="-1st">` で低めに調整 |
| `whisper` | `ja-JP-Neural2-B` | 女性 | ひそやかな場面。SSML `<prosody rate="slow" volume="soft">` で調整 |
| `cheerful` | `ja-JP-Neural2-B` | 女性 | 子ども向け・元気な場面。SSML `<prosody rate="fast" pitch="+3st">` で調整 |

> voice name は `94_Runtime_Config` の `tts_voice_{voice_style}` キーで上書き可能にする。
> 将来的に男性ナレーションを追加する場合は `tts_voice_narrator_male` 等を別キーで追加する。

### `speech_rate` → `speakingRate` 数値マッピング

児童向け読み聞かせ基準。実数値は `94_Runtime_Config` で管理する。

| `speech_rate` | デフォルト `speakingRate` | RuntimeConfig キー |
|---|---|---|
| `slow` | `0.75` | `tts_speaking_rate_slow` |
| `normal` | `0.82` | `tts_speaking_rate_normal` |
| `fast` | `0.92` | `tts_speaking_rate_fast` |

> Google Cloud TTS の `speakingRate = 1.0` は機械的な標準速であり読み聞かせには速すぎる。
> 本システムの `normal = 0.82` を読み聞かせ標準速として定義する。

### `tc_in` / `tc_out` フォーマット

- 形式: `M:SS.mmm`（例: `0:00.000`、`0:08.432`）
- `tc_in`: 常に `"0:00.000"`（1行1シーンのため）
- `tc_out`: TTS 音声の実測 duration から算出

### `current_step` 設定値

| 実行状態 | `current_step` 値 |
|---|---|
| 成功（1件以上） | `STEP_08B_TTS_AUDIO` |
| 失敗 | 更新しない |

---

## 3. ファイル構成（新規作成対象）

```
src/
  steps/
    step08b-tts-audio-generate.ts      # オーケストレーター

  lib/
    generate-tts-audio.ts              # Google Cloud TTS 呼び出し・音声バイナリ生成

  scripts/
    dry-run-step08b.ts                 # dry-run スクリプト
```

### 既存ファイルへの追記対象

```
src/
  types.ts                             # TtsAudioPatch / EditPlanAudioPatch 追加
  index.ts                             # STEP_08B ルーティング追加

  lib/
    upload-to-drive.ts                 # uploadAudioToDrive() 追加（uploadImageToDrive の音声版）
    write-tts-subtitles.ts             # patchTtsAudio() 追加（audio_file / tc_in / tc_out 部分更新）
    write-edit-plan.ts                 # patchEditPlanAudio() 追加（asset_audio / duration_sec 部分更新）
    write-app-log.ts                   # buildStep08bSuccessLog() / buildStep08bFailureLog() 追加
    load-assets.ts                     # loadStep08bAssets() 追加
```

---

## 4. 音声 duration の算出方法

Google Cloud TTS の `synthesizeSpeech` レスポンスは **Base64 エンコードされた MP3 バイナリ**を返す。
MP3 ファイルの duration を Node.js で算出する方法として、**MP3 ヘッダーのビットレートと
ファイルサイズから推算する軽量アプローチ**を採用する（外部 npm パッケージ不使用）。

```typescript
/**
 * MP3 バイナリから duration（秒）を推算する。
 * CBR（固定ビットレート）前提: duration ≒ fileBytes * 8 / bitrate_bps
 * Google Cloud TTS は通常 64kbps CBR で出力する。
 */
function estimateMp3DurationSec(mp3Buffer: Buffer): number {
  const BITRATE_KBPS = 64; // Google Cloud TTS MP3 デフォルト
  const durationSec = (mp3Buffer.byteLength * 8) / (BITRATE_KBPS * 1000);
  return Math.round(durationSec * 1000) / 1000; // 小数点3桁
}
```

> **精度**: CBR 64kbps 前提のため ±0.1 秒程度の誤差が生じる可能性がある。
> 実用上十分と判断する。より高精度が必要な場合は SSML `<mark>` タグによる
> timepoints 方式への移行を将来的に検討する。

### `tc_out` フォーマット変換

```typescript
function formatTc(durationSec: number): string {
  const minutes = Math.floor(durationSec / 60);
  const seconds = durationSec % 60;
  const sec = Math.floor(seconds);
  const ms  = Math.round((seconds - sec) * 1000);
  return `${minutes}:${String(sec).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}
// 例: 8.432 → "0:08.432"
```

---

## 5. Google Cloud TTS API 呼び出し仕様

### エンドポイント

```
POST https://texttospeech.googleapis.com/v1/text:synthesize
Authorization: Bearer {access_token}
```

認証は `src/lib/call-gemini.ts` の `getAccessToken()` を流用（既存の service account で対応）。

### リクエストボディ

STEP_08A が生成した `tts_text` は SSML 文字列のため、`input.ssml` フィールドで渡す。

```json
{
  "input": {
    "ssml": "{tts_text の <speak>〜</speak> SSML 文字列}"
  },
  "voice": {
    "languageCode": "ja-JP",
    "name": "{resolved_voice_name}"
  },
  "audioConfig": {
    "audioEncoding": "MP3",
    "speakingRate": 0.82,
    "effectsProfileId": ["large-home-entertainment-class-device"]
  }
}
```

> `pitch` パラメータは `audioConfig` には設定しない。
> ピッチ・抑揚の制御は STEP_08A が生成した SSML 内の `<prosody>` タグで行う。
>
> `effectsProfileId` に `large-home-entertainment-class-device` を指定することで、
> スピーカー再生を想定した音質最適化を適用する（動画向け）。

### 日本語イントネーション品質の担保

Google Cloud TTS は擬音語・擬態語・複合語において日本語標準ピッチアクセントから
逸脱した読み方をする場合がある（例: 「どんぶらこ」の誤ったアクセント）。

**本システムでの対策レイヤー:**

#### レイヤー1: STEP_08A（Gemini）によるSSML 事前処理
STEP_08A のプロンプトで Gemini に以下を指示する:
- 擬音語・擬態語（どんぶらこ、ざあざあ、ふわふわ 等）を検出すること
- 検出した語に対して標準的な日本語アクセントを SSML で明示すること
- 使用する SSML 手法（優先順）:

  ```xml
  <!-- 方法1: <sub> による読みの置き換え（最もシンプル） -->
  <sub alias="どんぶらこ">どんぶらこ</sub>

  <!-- 方法2: <break> による強制ピッチブレーク -->
  ど<break time="1ms"/>んぶらこ

  <!-- 方法3: <prosody> による個別音節制御（高精度だが複雑） -->
  <prosody>ど<prosody pitch="+2st">ん</prosody><prosody pitch="-1st">ぶらこ</prosody></prosody>
  ```

#### レイヤー2: TTS API の `languageCode` 指定
`languageCode: "ja-JP"` を明示することで日本語モデルが適用される。

#### レイヤー3: 人間レビュー（`reading_check` フィールド）
生成音声を人間がレビューし、問題がある場合は `08_TTS_Subtitles.reading_check` に
修正指示を記録する。再生成が必要な場合は `audio_file` をクリアして STEP_08B を再実行する。

**既知のアクセント問題と SSML 対処例:**

| 語 | 誤りパターン | 正しいアクセント | SSML 対処 |
|---|---|---|---|
| どんぶらこ | ど↗ん→ぶ→ら→こ↘ | ど↗ん↘ぶ→ら→こ↘ | `ど<break time="1ms"/>んぶらこ` |
| もったいない | も→っ→た→い→な→い | も↗っ↘た→い→な→い | `<sub alias="もったいない">もったいない</sub>` |
| おじいさん | お→じ→い→さ→ん | お↗じ↘い→さ→ん | そのままで概ね正常 |

> **設計方針**: レイヤー1（Gemini による SSML 事前処理）で大半の問題を予防する。
> STEP_08B はあくまで「Gemini が生成した SSML を忠実に音声化する」役割に徹する。
> TTS API 側でピッチを後処理修正するロジックは持たない（保守性の観点から）。

### レスポンス

```json
{
  "audioContent": "//NExAAA...（Base64 エンコード MP3）"
}
```

---

## 6. 処理フロー（オーケストレーター）

```
1. 00_Project から ProjectRow を取得
2. 08_TTS_Subtitles から対象行を取得
   - generation_status = "GENERATED"
   - audio_file = ""（未生成のみ）
3. 対象行が 0件 → スキップ（already completed ログ）
4. 09_Edit_Plan を全件取得（scene_no + related_version → EditPlanRow の Map を構築）
5. configMap から tts_voice_* / tts_speaking_rate_* / drive_parent_folder_id を取得
6. ensurePjtFolder(parentFolderId, projectId) → folderId
7. for each ttsRow in targetRows:
   7-1. voiceName     = resolveVoiceName(ttsRow.voice_style, configMap)
   7-2. speakingRate  = resolveSpeakingRate(ttsRow.speech_rate, configMap)
   7-3. mp3Buffer     = await generateTtsAudio(ttsRow.tts_text, voiceName, speakingRate)
        └─ 失敗 → error log + continue
   7-4. durationSec   = estimateMp3DurationSec(mp3Buffer)
   7-5. tcOut         = formatTc(durationSec)
   7-6. fileName      = `${ttsRow.record_id}_${ttsRow.related_version}_${dateStr}.mp3`
   7-7. driveUrl      = await uploadAudioToDrive(folderId, fileName, mp3Buffer)
        └─ 失敗 → error log + continue
   7-8. patchTtsAudio([{ record_id, related_version, audio_file: driveUrl, tc_in, tc_out, ... }])
        └─ 失敗 → error log + continue
   7-9. editPlanRow = editPlanMap.get(`${ttsRow.record_id}__${ttsRow.related_version}`)
        ├─ 見つからない → [WARN] log + continue（TTS 更新は確定済み）
        └─ patchEditPlanAudio([{ record_id, related_version, asset_audio, duration_sec, ... }])
            └─ 失敗 → error log + continue

8. updateProjectCurrentStep("STEP_08B_TTS_AUDIO")  ← 1件以上成功時のみ
9. writeAppLog(summaryLog)
```

> **09_Edit_Plan との紐付け**: STEP_08A で record_id を Script から引き継いだため、
> `record_id + related_version` の複合キーで TTS と Edit Plan を 1:1 照合できる。

---

## 7. GSS フィールドマッピング（書き戻し対象のみ）

### 08_TTS_Subtitles（部分更新）

| フィールド | 値の設定元 |
|---|---|
| `audio_file` | Drive URL（`https://drive.google.com/file/d/{fileId}/view`） |
| `tc_in` | `"0:00.000"` 固定 |
| `tc_out` | `formatTc(estimateMp3DurationSec(mp3Buffer))` |
| `updated_at` | `new Date().toISOString()` |
| `updated_by` | `"github_actions"` 固定 |

### 09_Edit_Plan（部分更新）

| フィールド | 値の設定元 |
|---|---|
| `asset_audio` | 同行の `audio_file` と同値（Drive URL） |
| `duration_sec` | TTS 実測値（STEP_08A の AI 推定値を上書き） |
| `updated_at` | `new Date().toISOString()` |
| `updated_by` | `"github_actions"` 固定 |

---

## 8. エラーハンドリング方針

| エラー種別 | 挙動 |
|---|---|
| project not found | `100_App_Logs` にエラー記録。当該 project をスキップ |
| 対象行 0件（全行 audio_file 埋め済み） | `[INFO]` ログ記録のみ（エラーではない） |
| TTS API 呼び出し失敗（行単位） | その行のみ記録。次の行へ継続 |
| Drive アップロード失敗（行単位） | 同上 |
| GSS 部分更新失敗（行単位） | 同上 |
| 09_Edit_Plan の対応行が見つからない | `[WARN]` ログ記録。TTS 側の更新は確定。Edit Plan のみスキップ |
| Google Cloud TTS の quota 超過 | `[ERROR]` ログ記録。残り行をスキップ。全プロジェクト停止 |

---

## 9. dry-run スクリプト

`src/scripts/dry-run-step08b.ts` を追加する（実装フェーズで作成）。

- `DRY_RUN=true`: TTS API 呼び出しなし。対象行の一覧表示のみ
- `DRY_RUN=false`: TTS 生成 + Drive アップロード実行（GSS 書き込みなし）
- モック: `PJT-001`（桃太郎）を使用

---

## 10. 型定義設計（`src/types.ts` 追記）

### 10.1 `StepId`（更新）

```typescript
export type StepId =
  | "STEP_01"
  | "STEP_02"
  | "STEP_03"
  | "STEP_04_05"
  | "STEP_04_SHORT_SCRIPT_BUILD"
  | "STEP_05_FULL_SCRIPT_BUILD"
  | "STEP_04_05_COMBINED"
  | "STEP_06_VISUAL_BIBLE"
  | "STEP_07_IMAGE_PROMPTS"
  | "STEP_08A_TTS_SUBTITLE"
  | "STEP_08B_TTS_AUDIO"        // ← 追加
  | "STEP_09_QA_BUILD";
```

### 10.2 `TtsAudioPatch`（新規）

```typescript
/**
 * STEP_08B が 08_TTS_Subtitles に書き戻す部分更新フィールド
 * upsert キー: record_id + related_version の複合キー（STEP_08A と同一ルール）
 */
export interface TtsAudioPatch {
  record_id:       string;
  related_version: TtsSubtitleVersion;
  audio_file:      string;   // Google Drive URL
  tc_in:           string;   // 固定: "0:00.000"
  tc_out:          string;   // 実測値: "M:SS.mmm"
  updated_at:      string;
  updated_by:      string;
}
```

### 10.3 `EditPlanAudioPatch`（新規）

```typescript
/**
 * STEP_08B が 09_Edit_Plan に書き戻す部分更新フィールド
 * upsert キー: record_id + related_version の複合キー
 */
export interface EditPlanAudioPatch {
  record_id:       string;
  related_version: TtsSubtitleVersion;
  asset_audio:     string;   // Google Drive URL（audio_file と同値）
  duration_sec:    number;   // TTS 実測値（AI 推定値を上書き）
  updated_at:      string;
  updated_by:      string;
}
```

---

## 11. モジュール設計

### 11.1 `src/steps/step08b-tts-audio-generate.ts`

```typescript
export async function runStep08bTtsAudioGenerate(
  payload: WorkflowPayload
): Promise<void>
```

主要なヘルパー:

```typescript
// voice_style → TTS voice name を解決（94_Runtime_Config 優先、なければデフォルト）
function resolveVoiceName(
  voiceStyle: string,
  configMap: RuntimeConfigMap
): string

// speech_rate → speakingRate 数値を解決（94_Runtime_Config 優先）
function resolveSpeakingRate(
  speechRate: string,
  configMap: RuntimeConfigMap
): number

// MP3 バイナリから duration（秒）を推算
function estimateMp3DurationSec(mp3Buffer: Buffer): number

// duration 秒数を "M:SS.mmm" 形式に変換
function formatTc(durationSec: number): string
```

### 11.2 `src/lib/generate-tts-audio.ts`（新規）

```typescript
/**
 * Google Cloud Text-to-Speech API を呼び出し MP3 バイナリを返す。
 * 認証は call-gemini.ts の getAccessToken() を流用する。
 *
 * tts_text は SSML 文字列（<speak>〜</speak>）のため input.ssml で渡す。
 *
 * @param ssml          - SSML 文字列（<speak>〜</speak>）
 * @param voiceName     - ja-JP-Neural2-B 等（94_Runtime_Config から解決済み）
 * @param speakingRate  - 0.75 | 0.82 | 0.92 等（94_Runtime_Config から解決済み）
 * @returns MP3 バイナリ（Buffer）
 */
export async function generateTtsAudio(
  ssml: string,
  voiceName: string,
  speakingRate: number
): Promise<Buffer>
```

### 11.3 `src/lib/upload-to-drive.ts`（既存ファイルに追記）

```typescript
/**
 * MP3 バッファを指定フォルダにアップロードし、閲覧用 URL を返す。
 * uploadImageToDrive() の音声版（mimeType: "audio/mpeg"）。
 */
export async function uploadAudioToDrive(
  folderId: string,
  fileName: string,
  mp3Buffer: Buffer
): Promise<string>
```

### 11.4 `src/lib/write-tts-subtitles.ts`（既存ファイルに追記）

```typescript
/**
 * 08_TTS_Subtitles の audio_file / tc_in / tc_out を部分更新する。
 * upsert キー: record_id + related_version の複合キー。
 */
export async function patchTtsAudio(
  patches: TtsAudioPatch[],
  sheets: sheets_v4.Sheets,
  spreadsheetId: string
): Promise<void>
```

### 11.5 `src/lib/write-edit-plan.ts`（既存ファイルに追記）

```typescript
/**
 * 09_Edit_Plan の asset_audio / duration_sec を部分更新する。
 * upsert キー: record_id + related_version の複合キー。
 */
export async function patchEditPlanAudio(
  patches: EditPlanAudioPatch[],
  sheets: sheets_v4.Sheets,
  spreadsheetId: string
): Promise<void>
```

---

## 12. 100_App_Logs Upsert 仕様

| タイミング | `error_type` | `app_log` 形式 |
|---|---|---|
| project not found | `PROJECT_NOT_FOUND` | `[ERROR][PROJECT_NOT_FOUND] project_id={id}` |
| 対象行 0件（完了済み） | — | `[INFO][ALREADY_COMPLETED] all audio_file filled` |
| TTS API 失敗 | `TTS_API_ERROR` | `[ERROR][TTS_API_ERROR] record_id={id} msg={e.message}` |
| Drive アップロード失敗 | `DRIVE_UPLOAD_ERROR` | `[ERROR][DRIVE_UPLOAD_ERROR] record_id={id} msg={e.message}` |
| GSS 更新失敗 | `UPSERT_ERROR` | `[ERROR][UPSERT_ERROR] sheet={name} record_id={id}` |
| Edit Plan 対応行なし | `EDIT_PLAN_NOT_FOUND` | `[WARN][EDIT_PLAN_NOT_FOUND] record_id={id} version={v}` |
| TTS quota 超過 | `TTS_QUOTA_EXCEEDED` | `[ERROR][TTS_QUOTA_EXCEEDED] msg={e.message}` |
| 成功 | — | `[INFO][SUCCESS] audio_count={n} skipped={m}` |

- `record_id` には `{project_id}-STEP08B` を使用（プロジェクト単位のログ）
- `current_step` には `"STEP_08B_TTS_AUDIO"` を使用

---

## 13. STEP_08A との依存関係

| 確認項目 | 前提条件 |
|---|---|
| `08_TTS_Subtitles` に行が存在すること | STEP_08A 完了後に実行 |
| `tts_text` が有効な SSML であること | STEP_08A generation_status = "GENERATED" 行のみ処理 |
| `09_Edit_Plan` に対応行が存在すること | 必須ではない（WARN ログで継続） |

STEP_08B は `generation_status = "GENERATED"` かつ `audio_file = ""` の行のみを処理する。

---

## 14. 注意事項

- **Google Cloud TTS の利用料**: Neural2 音声は 1文字あたり約 $0.000016。SSML タグ文字は課金対象外。短編童話 1プロジェクト分のナレーションは概算 500〜2,000 文字のため月 100 万字の無料枠内に収まる見込み。
- **MP3 duration 推算の精度**: CBR 64kbps 前提のため ±0.1 秒程度の誤差がある。字幕同期の精度が要求される場合は SSML `<mark>` による timepoints 方式へ移行する。
- **SSML 入力の前提**: `tts_text` が `<speak>〜</speak>` 形式でない場合（STEP_08A 生成エラー等）、TTS API がエラーを返す。`TTS_API_ERROR` としてログに記録し当該行をスキップする。
- **再実行時の重複**: `audio_file = ""` の行のみ処理するため既存の Drive ファイルは上書きしない。強制再生成が必要な場合は GSS で `audio_file` を手動クリアしてから再実行する。
- **日本語アクセント問題**: 擬音語・擬態語の誤ったアクセントは STEP_08A の SSML 生成（Gemini）で事前に対処する設計（§5 参照）。STEP_08B では追加処理を持たない。
