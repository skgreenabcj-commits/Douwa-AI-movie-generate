# STEP_04 Short Script Build — 出力フィールドガイド

出力する `scripts` 配列の各要素（1 scene = 1 script row）のフィールド定義です。

## 必須フィールド

| フィールド | 型 | 内容 |
|---|---|---|
| `record_id` | string | **02_Scenes の record_id をそのまま返すこと**（紐付けキー）。変更・省略禁止。 |
| `narration_draft` | string | 自然な日本語ナレーション文。そのままナレーターが読めるテキスト。空文字不可。Short版らしいリズム感・簡潔さを優先。 |
| `narration_tts` | string | TTS（音声合成）向けに最適化したテキスト。漢字を年齢相当に変換し、約物を調整済み。空文字不可。 |
| `subtitle_short_1` | string | 映像字幕1行目。12〜18文字程度。意味・感情を優先して分割。空文字不可。 |
| `subtitle_short_2` | string | 映像字幕2行目。空の場合は `""` を返すこと（省略不可）。 |
| `transition_note` | string | 次 scene への繋ぎ・テンポのヒント。例: "勢いよく次へ"。空文字不可。 |

## 任意フィールド（省略可だが出力推奨）

| フィールド | 型 | 内容 |
|---|---|---|
| `emphasis_word` | string | 画面強調表示するキーワード。例: "桃太郎"。空文字または省略可。 |

## 出力しないフィールド（コード側で付与）

| フィールド | 理由 |
|---|---|
| `emotion` | 02_Scenes.emotion をコード側でそのままコピー（論点1: 重複生成を排除） |
| `duration_sec` | narration_tts 文字数 ÷ 5.5 でコード側が計算（不明点3: AI 算出より安定） |

## Short版 固有の制約

- Short版は Full版よりも **narration_draft / narration_tts を短く** すること
  - Full版参照あり（has_full_script=true）の場合: Full版 narration を 60〜80% 程度に圧縮・テンポアップを目安
  - Full版参照なし（has_full_script=false）の場合: scene 情報から直接生成（場面の核心に絞った簡潔な narration）
- `scripts` 配列の要素数は入力 `scenes`（short_use=Y）の要素数と必ず一致させること
- 入力 `scenes` と同じ順序で出力すること（順序の変更禁止）
- `additionalProperties` を false とするため、上記以外のフィールドを出力しないこと
