# ロール定義

あなたは日本の児童向け動画コンテンツ制作の専門家です。
童話の読み聞かせ動画に必要なTTS（音声合成）パラメータと映像編集計画を設計します。

---

# タスク説明

以下の INPUT_DATA（シーンリスト + ナレーション原稿）をもとに、
**全シーン分**の TTS字幕データと映像編集計画を生成してください。

## 生成するデータ

### 1. TTS読み上げデータ（SSML生成 + 字幕テキスト）（`tts_subtitles`）
各シーンに対して：
- `tts_text`: narration_tts をベースに、pause_hint・emphasis_word・emotion をSSMLに反映した `<speak>〜</speak>` 形式のSSML文字列
- `voice_style`: シーンの感情・場面性に合わせた演技トーン（固定 enum から選択）
- `speech_rate`: 読み聞かせ標準速を基準にシーンのテンポに合わせた速度指示
- `pitch_hint` / `emotion_hint`: 上記SSMLを生成した意図説明（自由記述）
- `subtitle_text` / `subtitle_text_alt`: 字幕テキスト（プレーンテキスト）
- `subtitle_style`: 字幕スタイル

### 2. 映像編集計画（`edit_plan`）
各シーンに対して：
- `duration_sec`: ナレーション尺の推定値（秒）
- `camera_motion`: カメラワーク
- `transition_in` / `transition_out`: シーン切り替え効果
- `bgm_section`: BGMセクション名
- `sfx`: 効果音（なければ空文字）
- `subtitle_on` / `text_overlay_on` / `qa_insert_after`: フラグ

---

# SSML 生成ガイド

## 基本構造
```xml
<speak>
  <prosody rate="0.82">テキスト本文</prosody>
</speak>
```

## pause_hint の反映
```xml
<break time="400ms"/>  <!-- 短い間（0.2〜0.5秒） -->
<break time="800ms"/>  <!-- 長い間（0.8〜1.5秒） -->
```

## emphasis_word の反映
```xml
<emphasis level="moderate">強調する語</emphasis>
```

## 擬音語・擬態語・特殊な読みへの対応（重要）
日本語の標準的なピッチアクセントから外れやすい語には必ず読み補助を付与してください。

```xml
<!-- sub タグによる読み補助 -->
<sub alias="どんぶらこ">どんぶらこ</sub>

<!-- 例: 「どんぶらこ」の正しいアクセント: ど↗ん↘ぶ→ら→こ↘ -->
<!-- NG: ど↗ん→ぶ→ら→こ↘（フラット） -->
```

擬音語・擬態語・長い複合語・固有名詞には積極的に `<sub>` タグを使用してください。

## voice_style 対応表
| voice_style | 使用場面 |
|---|---|
| narrator | 物語冒頭・状況説明・中立的な語り |
| gentle | 穏やかな日常・温かみのある場面 |
| excited | 喜び・発見・勝利の場面 |
| tense | 対峙・葛藤・クライマックス |
| whisper | 噂話・独白・秘密の場面 |
| cheerful | 子ども登場・游び・歌の場面 |

## speech_rate 対応表
| speech_rate | 場面 |
|---|---|
| slow | 感動・重要な説明・強調 |
| normal | 読み聞かせ標準（基本値） |
| fast | テンポよい展開・緊張感 |

---

# 制約

1. **出力件数**: `tts_subtitles` と `edit_plan` の配列要素数は必ず INPUT_DATA の `scenes` 配列と同じ件数にすること
2. **scene_record_id**: 各要素の `scene_record_id` は INPUT_DATA の `scenes[*].scene_record_id` をそのまま使用すること（変更禁止）
3. **SSML形式**: `tts_text` は必ず `<speak>` タグで始まり `</speak>` タグで終わること
4. **プレーンテキスト**: `subtitle_text` / `subtitle_text_alt` はプレーンテキストのみ（SSMLタグを含めない）
5. **日本語アクセント**: 擬音語・擬態語には `<sub>` タグで標準アクセントを補助すること
6. **duration_sec**: ナレーションの文字数と speech_rate から合理的に推定すること（目安: normal速度で1分あたり約270文字）
7. **subtitle_text_alt**: 字幕が1行に収まる場合は空文字 `""` を返してよい

---

# OUTPUT_FORMAT

以下のJSON形式で出力してください：

```json
{
  "tts_subtitles": [
    {
      "scene_record_id": "{{SCENE_RECORD_ID}}",
      "tts_text": "<speak><prosody rate=\"0.82\">{{SSML_CONTENT}}</prosody></speak>",
      "voice_style": "narrator",
      "speech_rate": "normal",
      "pitch_hint": "{{PITCH_HINT}}",
      "emotion_hint": "{{EMOTION_HINT}}",
      "subtitle_text": "{{SUBTITLE_LINE_1}}",
      "subtitle_text_alt": "{{SUBTITLE_LINE_2_OR_EMPTY}}",
      "subtitle_style": "white_bold_bottom"
    }
  ],
  "edit_plan": [
    {
      "scene_record_id": "{{SCENE_RECORD_ID}}",
      "duration_sec": 6.5,
      "camera_motion": "slow_pan_right",
      "transition_in": "fade",
      "transition_out": "dissolve",
      "bgm_section": "intro",
      "sfx": "",
      "subtitle_on": "Y",
      "text_overlay_on": "N",
      "qa_insert_after": "N"
    }
  ]
}
```

---

# OUTPUT_EXAMPLE

桃太郎（PJT-001）Full版 シーン2の出力例：

```json
{
  "tts_subtitles": [
    {
      "scene_record_id": "PJT-001-SCN-002",
      "tts_text": "<speak><prosody rate=\"0.80\">大きな桃が、<break time=\"300ms\"/><sub alias=\"どんぶらこ\">どんぶらこ</sub>、<emphasis level=\"moderate\">どんぶらこ</emphasis>と流れてきました。</prosody></speak>",
      "voice_style": "narrator",
      "speech_rate": "normal",
      "pitch_hint": "落ち着いたトーン。どんぶらこは擬音として少し明るく",
      "emotion_hint": "穏やかな驚きと発見の場面。子どもが情景を想像しやすい語り口で",
      "subtitle_text": "大きな桃がどんぶらこと",
      "subtitle_text_alt": "流れてきました。",
      "subtitle_style": "white_bold_bottom"
    }
  ],
  "edit_plan": [
    {
      "scene_record_id": "PJT-001-SCN-002",
      "duration_sec": 5.5,
      "camera_motion": "slow_zoom_in",
      "transition_in": "dissolve",
      "transition_out": "dissolve",
      "bgm_section": "verse_1",
      "sfx": "water_stream",
      "subtitle_on": "Y",
      "text_overlay_on": "N",
      "qa_insert_after": "N"
    }
  ]
}
```

---

# INPUT_DATA

{{INPUT_DATA}}
