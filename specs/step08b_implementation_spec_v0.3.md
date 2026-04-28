# STEP_08B TTS Audio Generate 実装設計書 v0.3

> **ステータス**: 確定（オーナー判断反映済み 2026-04-25）
> **改訂履歴**:
> - v0.1 (2026-04-12): 初版
> - v0.2 (2026-04-13): narrator 女性固定・全 voice female 統一・speakingRate 読み聞かせ基準値化・TTS 入力を SSML 化（`input.ssml`）・日本語イントネーション厳格指示追加
> - v0.3 (2026-04-24): voice_style prosody マッピング更新（rate 固定・pitch/volume のみ）・tts_voice_name RuntimeConfig キー追加・tts_text 漢字仮名交じり文前提を明記・§5 イントネーション対策レイヤー更新
> - v0.3.1 (2026-04-25): pitch 値縮小（Chirp3-HD DSP劣化対策）・excited/cheerful speech_rate 制約追加・`<sub>` 間読点 `<break>` 置換ルール追加
> - v0.3.2 (2026-04-26): `</sub>` 直後の break ルールを拡張（通常テキストへの接続も対象）・お供 誤読み対処を追加
> - v0.3.3 (2026-04-26): `<sub>` 用途をA（アクセント補助）/B（読み補助）に分類。`<break>` 置換はA のみ。読み補助は確認済み誤読みケースのみに限定
> - v0.3.4 (2026-04-29): duration 算出をMP3フレームヘッダー解析方式に変更・RETAKE モード追加・`audioConfig.pitch` 除去
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
>
> **漢字仮名交じり文**: STEP_08A v0.3 以降、`tts_text` 内のテキストは漢字仮名交じり文で生成される。
> これにより TTS エンジンのピッチアクセント辞書解決精度が向上する（§5 参照）。

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
| 論点7 | narrator キャラクター | **`tts_voice_name` RuntimeConfig キーで指定**（デフォルト: `ja-JP-Neural2-B`） | 全 voice_style でベース voice を統一。`94_Runtime_Config.tts_voice_name` で上書き可能 |
| 論点8 | TTS 入力形式 | **SSML**（`input.ssml`） | STEP_08A の `tts_text` は SSML 文字列のため `input.text` ではなく `input.ssml` で渡す |
| 論点9（v0.3）| `<prosody rate>` の扱い | **TTS API 側の `speakingRate` のみで速度制御** | STEP_08A が生成する SSML の `<prosody rate>` は常に `"1.0"` 固定。API の `speakingRate` が実効速度 |

### voice_style → SSML prosody マッピング（v0.3 更新）

**声優キャラクターは全スタイルで統一**（デフォルト: `ja-JP-Neural2-B`、`tts_voice_name` で上書き可）。
`voice_style` は `pitch` / `volume` のみで差別化する。**`rate` は SSML 内で変更しない**（API の `speakingRate` が実効速度）。

| `voice_style` | `<prosody>` 属性 | 効果 |
|---|---|---|
| `narrator` | `rate="1.0"` のみ | ベース（標準ナレーション） |
| `gentle` | `rate="1.0" volume="soft"` | やさしく柔らかい語り口 |
| `excited` | `rate="1.0" pitch="+0.5st"` | 明るく活気ある表現 |
| `tense` | `rate="1.0" pitch="-0.5st"` | 低く緊張感のある場面 |
| `whisper` | `rate="1.0" volume="x-soft"` | ひそやかな独白・秘密 |
| `cheerful` | `rate="1.0" pitch="+1.0st"` | 子ども向け・元気いっぱい |

> **v0.3 からの変更（v0.3.1）**:
> - `excited` / `cheerful` / `tense` の pitch 値を縮小。
>   Chirp3-HD は SSML `<prosody pitch>` を DSP 後処理で適用するため、
>   ±2st 以上では音質劣化（甲高い/くぐもり）が発生する。±0.5〜1.0st に収めることで自然な演技差を確保する。
> - `excited`: `+2st` → `+0.5st` / `cheerful`: `+3st` → `+1.0st` / `tense`: `-1st` → `-0.5st`

### voice_style 別 speech_rate 制約（v0.3.1 追加）

`voice_style` によっては `speech_rate` に制約を設ける。

| `voice_style` | `speech_rate` 制約 | 理由 |
|---|---|---|
| `excited` | **`"fast"` 固定** | normal 速度では興奮・緊張感が伝わらない |
| `cheerful` | `"fast"` または `"normal"` 任意 | 場面テンポに応じて選択 |
| その他 | 自由選択 | slow / normal / fast から場面に応じて |

### TTS 音声モデル（RuntimeConfig）

| RuntimeConfig キー | デフォルト値 | 説明 |
|---|---|---|
| `tts_voice_name` | `ja-JP-Neural2-B` | 使用する TTS 音声モデル名（全 voice_style 共通） |

> 音声モデルを変更する場合は `94_Runtime_Config` の `tts_voice_name` を設定する。
> 例: `ja-JP-Chirp3-HD-Achernar`（Chirp3 HD シリーズ）
>
> ⚠️ **Chirp3 HD 利用時の注意**: `<prosody pitch>` は公式サポート対象外の可能性がある。
> Neural2-B の場合は `pitch` / `volume` いずれも正常動作が確認されている。

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

## 4. 音声 duration の算出方法（v0.3.4 更新）

Google Cloud TTS の `synthesizeSpeech` レスポンスは **Base64 エンコードされた MP3 バイナリ**を返す。

**v0.3.4 以前（廃止）**: CBR 64kbps サイズ推算方式。
Google Cloud TTS の実際のビットレートは約 32kbps のため、64kbps 仮定では **約 2 倍の誤差**が生じることが確認された（例: SCN-001(full) 推定 12.8sec vs 実測 25sec 超）。

**v0.3.4 以降（現行）**: **MP3 フレームヘッダー直接解析**方式。外部 npm パッケージ不使用。

アルゴリズム（`src/lib/generate-tts-audio.ts`）:
1. ID3v2 タグをスキップ（先頭 `"ID3"` 判定 + syncsafe サイズ読み取り）
2. 同期ワード（`0xFF 0xEX`）でフレーム境界を検出
3. ヘッダーから MPEG バージョン・レイヤー・ビットレート・サンプルレートを読み取り
4. `duration += samplesPerFrame / sampleRate` をフレームごとに累積
5. フレーム未検出時のみ旧推算にフォールバック（通常は到達しない）

| MPEG Layer | MPEG1 samples/frame | MPEG2/2.5 samples/frame |
|---|---|---|
| Layer I | 384 | 384 |
| Layer II | 1152 | 1152 |
| Layer III | 1152 | 576 |

> **精度**: フレームヘッダーの実データから算出するため、ビットレート・サンプルレートに依存しない正確な値が得られる。

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

認証は `src/lib/generate-tts-audio.ts` の `getTtsAccessToken()`（GOOGLE_SERVICE_ACCOUNT_JSON を使用）。

### リクエストボディ

STEP_08A が生成した `tts_text` は SSML 文字列のため、`input.ssml` フィールドで渡す。

```json
{
  "input": {
    "ssml": "{tts_text の <speak>〜</speak> SSML 文字列}"
  },
  "voice": {
    "languageCode": "ja-JP",
    "name": "{tts_voice_name}"
  },
  "audioConfig": {
    "audioEncoding": "MP3",
    "speakingRate": 0.82
  }
}
```

> **`audioConfig.pitch` は意図的に省略**（v0.3.4 変更）。
> Chirp3-HD 系ボイス（`ja-JP-Chirp3-HD-*`）は `audioConfig.pitch` フィールドを受け付けず
> `HTTP 400 INVALID_ARGUMENT` を返す。Neural2 でも `pitch: 0.0` はデフォルト値と等価のため、
> 省略しても動作に差異はない。
> ピッチ制御は STEP_08A が生成した SSML 内の `<prosody pitch="+Nst">` タグのみで行う。
>
> `speakingRate` は `speech_rate` フィールドから `tts_speaking_rate_{slow|normal|fast}` キーで解決する。
> SSML 内の `<prosody rate>` は常に `"1.0"` 固定のため、API の `speakingRate` が唯一の速度制御となる。

### 日本語イントネーション品質の担保（v0.3 更新）

**本システムの対策レイヤー（STEP_08A/B 合わせた全体像）:**

#### レイヤー1: STEP_08A（Gemini）による tts_text 生成時の3つの改善

**①漢字仮名交じり文への変換**
TTS エンジンのピッチアクセント辞書は漢字表記でエントリを解決する。
ひらがなのみの入力では同音異義語が解決できず、フラットアクセントに fallback する。

```
❌ もも → 「MOMO」相当のフラット読み（ピッチ辞書未解決）
✅ 桃   → HLL（高低低）アクセント正確に適用
```

**②`<prosody rate>` を `"1.0"` 固定**
SSML の `<prosody rate>` と TTS API の `speakingRate` は乗算で適用される。
Gemini が `rate="0.75"` を生成した場合 `0.75 × 0.75 = 0.56`（極端に遅い）になるリスクを排除。

**③voice_style 別の pitch/volume 制御**
Gemini が `voice_style` に応じた `<prosody pitch/volume>` を生成し演技トーンを差別化する。

```xml
<!-- excited の例（pitch=+0.5st・speech_rate=fast 固定） -->
<speak><prosody rate="1.0" pitch="+0.5st">鬼を倒しました！</prosody></speak>

<!-- whisper の例 -->
<speak><prosody rate="1.0" volume="x-soft">しっ、静かに...</prosody></speak>
```

**④擬音語・擬態語への `<sub>` タグ付与**
Gemini が擬音語・擬態語を検出し、標準アクセントを `<sub>` タグで補助する。

```xml
<sub alias="どんぶらこ">どんぶらこ</sub>
```

**⑤`<sub>` の2用途と `</sub>` 直後の句読点ルール（v0.3.1〜v0.3.3 更新）**

`<sub>` には2種類の用途があり、`</sub>` 直後の句読点の扱いが異なる。

**用途A：アクセント補助（alias = text が同一）**
擬音語・擬態語等、読みは正しいがアクセントが崩れやすい語。
`</sub>` 直後の `、` `。` はアーティファクトを生成するため `<break>` に置換する。

```xml
<!-- ❌ NG → ✅ OK（アクセント補助） -->
<sub alias="ひょっこり">ひょっこり</sub>、 → <sub alias="ひょっこり">ひょっこり</sub><break time="200ms"/>
<sub alias="どんぶらこ">どんぶらこ</sub>、<sub ...> → <sub alias="どんぶらこ">どんぶらこ</sub><break time="200ms"/><sub ...>
```

| 対象 | 置換後 |
|---|---|
| アクセント補助 `</sub>、` | `</sub><break time="200ms"/>` |
| アクセント補助 `</sub>。` | `</sub><break time="300ms"/>` |

**用途B：読み補助（alias ≠ text、確認済み誤読みのみ）**
多音字等 TTS が誤読みすることが確認された語。
`</sub>` 直後の `、` `。` は**そのまま維持する**（`<break>` に置換しない）。
通常の漢字（大きな・昔々 等）は TTS が正しく読めるため `<sub>` 自体不要。

```xml
<!-- ✅ OK（読み補助）: </sub> 直後の読点はそのまま -->
<sub alias="おとも">お供</sub>させてください
<sub alias="おとも">お供</sub>、仲間に加わりました
```

#### レイヤー2: TTS API の `languageCode` 指定
`languageCode: "ja-JP"` を明示することで日本語モデルが適用される。

#### レイヤー3: 人間レビュー（`reading_check` フィールド）
生成音声を人間がレビューし、問題がある場合は `08_TTS_Subtitles.reading_check` に
修正指示を記録する。再生成が必要な場合は `audio_file` をクリアして STEP_08B を再実行する。

**既知のアクセント・誤読み問題と SSML 対処例:**

| 語 | 誤りパターン | 正しいアクセント/読み | SSML 対処 |
|---|---|---|---|
| 桃（もも） | フラット（ひらがな入力時） | HLL | 漢字「桃」で入力 |
| どんぶらこ | ど↗ん→ぶ→ら→こ↘ | ど↗ん↘ぶ→ら→こ↘ | `<sub alias="どんぶらこ">どんぶらこ</sub>` |
| もったいない | も→っ→た→い→な→い | も↗っ↘た→い→な→い | `<sub alias="もったいない">もったいない</sub>` |
| おじいさん | お→じ→い→さ→ん | お↗じ↘い→さ→ん | そのままで概ね正常 |
| お供 | `おきょう`（供述と混同） | `おとも` | `<sub alias="おとも">お供</sub>` |

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
2. RETAKE モード検出（v0.3.4 追加）
   - loadRetakeTtsSubtitlesByProjectId() で approval_status="RETAKE" 行を取得
   - 1件以上あれば isRetakeMode = true
3. 処理対象行の決定
   - 通常モード: audio_file = "" の未生成行
   - RETAKE モード: approval_status = "RETAKE" の行（tts_text はユーザー手動編集済み）
4. 対象行が 0件 → スキップ
5. configMap から tts_voice_name / tts_speaking_rate_* / drive_parent_folder_id を取得
6. ensurePjtFolder(parentFolderId, projectId) → folderId
7. for each ttsRow in targetRows:
   7-1. voiceName     = getConfigValue(configMap, "tts_voice_name", "ja-JP-Neural2-B")
   7-2. speakingRate  = resolveSpeakingRate(ttsRow.speech_rate, configMap)
   7-3. mp3Buffer     = await generateTtsAudio(ttsRow.tts_text, speakingRate, configMap)
        └─ 失敗 → error log + continue
   7-4. durationSec   = estimateMp3DurationSec(mp3Buffer)  ← MP3フレームヘッダー解析（v0.3.4）
   7-5. tcOut         = formatTc(durationSec)
   7-6. fileName      = `${ttsRow.record_id}_${ttsRow.related_version}_${dateStr}.mp3`
   7-7. driveUrl      = await uploadAudioToDrive(folderId, fileName, mp3Buffer)
        └─ 失敗 → error log + continue
   7-8. patchTtsAudio({ record_id, related_version, audio_file: driveUrl, tc_in, tc_out, ... })
        ├─ RETAKE モードの場合: approval_status を "RETAKE" → "PENDING" に自動リセット
        └─ 失敗 → error log + continue
   7-9. patchEditPlanAudio({ record_id, related_version, asset_audio, duration_sec, ... })
        └─ 失敗 → error log + continue（TTS 更新は確定済み）

8. updateProjectCurrentStep("STEP_08B_TTS_AUDIO")  ← 1件以上成功時のみ
9. writeAppLog(summaryLog)
```

> **09_Edit_Plan との紐付け**: `record_id + related_version` の複合キーで TTS と Edit Plan を 1:1 照合。

---

## 6-A. RETAKE モード（v0.3.4 追加）

### 概要

ユーザーが `08_TTS_Subtitles` の `tts_text` を手動編集した後、音声のみを再生成する機能。
STEP_08A（SSML 生成）はスキップし、既存の `tts_text` をそのまま TTS API へ渡す。

### ユーザー操作フロー

```
1. GSS の 08_TTS_Subtitles で tts_text を直接編集
2. 同行の approval_status を "RETAKE" にセット
3. GAS ダイアログ → "STEP_08B 音声生成（個別）" を選択
4. "RETAKE モード" チェックをオン → 実行
5. GAS 側で RETAKE 行の存在を事前検証（validateRetakeTts）
6. GitHub Actions 起動 → RETAKE 行のみ音声再生成
7. 完了後: approval_status が自動的に "PENDING" にリセット
```

### 実装詳細

| ファイル | 追加内容 |
|---|---|
| `src/types.ts` | `TtsSubtitleRetakeRow` インターフェース追加 |
| `src/lib/load-tts-subtitles.ts` | `loadRetakeTtsSubtitlesByProjectId()` — `approval_status="RETAKE"` 行を返す |
| `src/lib/write-tts-subtitles.ts` | `patchTtsAudio` 内で RETAKE → PENDING 自動リセット |
| `src/steps/step08b-tts-audio-generate.ts` | RETAKE モード検出・対象行切替（STEP_07 と同パターン） |
| `gas/Code.gs` | `SHEET_TTS_SUBTITLES` 定数・`validateRetakeTts()` 追加 |
| `gas/Dialog.html` | `STEP_08B` ラジオ追加・RETAKE チェックボックス（モード別独立） |

### STEP_07 との設計の違い

| 項目 | STEP_07 | STEP_08B |
|---|---|---|
| 旧データの退避 | `image_take_2` に旧 URL を退避 | なし（`audio_file` を直接上書き） |
| 完了後ステータス | `approval_status = "PENDING"` | 同じ |
| `generation_status` | `"GENERATED"` 維持 | 同じ |

---

## 7〜14.

v0.2 から変更なし。詳細は `step08b_implementation_spec_v0.2.md` §7〜§14 を参照。

（GSS フィールドマッピング・エラーハンドリング・dry-run・型定義・モジュール設計・ログ仕様・依存関係・注意事項は同一）
