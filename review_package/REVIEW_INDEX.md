# STEP_04_05 クロスレビューパッケージ INDEX

> **作成日**: 2026-04-04
> **対象仕様バージョン**: combined spec v1.2 / impl spec v0.2
> **目的**: 別AIによる設計クロスレビュー

---

## 収録ファイル一覧

### 仕様書

| ファイル名 | 内容 | バージョン |
|---|---|---|
| `step_04-step_05_combined_script_generate_v1.md` | STEP_04/05 Combined 仕様書（確定版） | v1.2 |
| `step04_05_implementation_spec_v0.1.md` | STEP_04_05 実装設計書 | v0.2 |

### ソースコード

| ファイル名 | 内容 |
|---|---|
| `step04-05-script-build.ts` | オーケストレーター（メイン実装） |
| `types.ts` | 型定義（StepId / SceneReadRow / ScriptFullRow 等） |
| `validate-json.ts` | AI 出力バリデーター |
| `write-app-log.ts` | ログビルダー |
| `load-scenes.ts` | 02_Scenes 読み込み |
| `load-script.ts` | 04_Script_Full 読み込み（Short 参照用） |
| `write-script-full.ts` | 04_Script_Full upsert |
| `write-script-short.ts` | 03_Script_Short upsert |
| `load-assets.ts` | プロンプト/スキーマ/サンプルファイル読み込み |
| `build-prompt.ts` | プロンプトアセンブラー |
| `call-gemini.ts` | Gemini 呼び出しラッパー |
| `index.ts` | ルーター（STEP_ID によるディスパッチ） |

### プロンプト

| ファイル名（prompts/ 以下） | 内容 |
|---|---|
| `prompts/script_full_prompt_v1.md` | STEP_05 Full Script プロンプトテンプレート |
| `prompts/script_short_prompt_v1.md` | STEP_04 Short Script プロンプトテンプレート |
| `prompts/fragments/script_output_field_guide_full_v1.md` | Full フィールドガイド |
| `prompts/fragments/script_output_field_guide_short_v1.md` | Short フィールドガイド |

### スキーマ

| ファイル名（schemas/ 以下） | 内容 |
|---|---|
| `schemas/script_full_schema_ai_v1.json` | STEP_05 AI 出力スキーマ |
| `schemas/script_short_schema_ai_v1.json` | STEP_04 AI 出力スキーマ |

### サンプル

| ファイル名（examples/ 以下） | 内容 |
|---|---|
| `examples/script_full_ai_response_example_v1.json` | Full Script AI 出力サンプル |
| `examples/script_short_ai_response_example_v1.json` | Short Script AI 出力サンプル |

---

## レビュー観点

### A. 仕様 ↔ 実装の整合性

1. **video_format 分岐**: `short+full` 時 Full 成功を Short 実行の前提条件とするルール（Fix #1）が
   `step04-05-script-build.ts` の `shortDependsOnFull` フラグで正しく実装されているか
2. **current_step 遷移**: §17 の状態表どおりに `updateProjectMinimal` が呼ばれているか
   （COMBINED / FULL_ONLY / SHORT_ONLY / 更新なし の4パターン）
3. **short_use=Y 0件 SKIPPED**: Fix #6 が `if (shortUseCount === 0)` で正しく分岐しているか

### B. 型定義の正確性

4. **StepId**: STEP_04/STEP_05 関連値（`STEP_04_SHORT_SCRIPT_BUILD`, `STEP_05_FULL_SCRIPT_BUILD`,
   `STEP_04_05_COMBINED`, `STEP_04_05`）が正しく定義されているか
5. **SceneReadRow**: `scene_id` / `scene_order` が含まれていないか（GSS 非書き込み列）
6. **ScriptFullAiRow / ScriptShortAiRow**: `subtitle_short_2` が `string`（必須・空文字可）で定義されているか（Fix #4）

### C. バリデーションロジック

7. **件数 fail-fast**: `validateScriptFullAiResponse` / `validateScriptShortAiResponse` が
   `expectedCount` 不一致時に即座に fail を返すか（Fix #5）
8. **subtitle_short_2**: `undefined`/`null` のみ reject、`""` は pass するか（Fix #4）
9. **extractJson**: brace カウント方式がネスト・文字列内ブレースを正しく扱えるか（Fix #9）
10. **Ajv キャッシュ**: `schemaCache` により同一スキーマの二重コンパイルを防いでいるか（Fix #9）

### D. record_id 突合ロジック

11. **matchAiOutputToScenes**: 20%閾値の判定とフォールバック上限が仕様（§7.6）どおりか
12. **件数不一致の二重防御**: validation で捕捉済みでも `matchAiOutputToScenes` が件数確認を行っているか

### E. upsert ロジック

13. **write-script-full / write-script-short**: `record_id` による UPDATE / INSERT の切り替えが正しいか
14. **SCRIPT_FULL_HEADERS / SCRIPT_SHORT_HEADERS**: GSS 列順と一致しているか

### F. ログ設計

15. **buildStep04_05PreflightFailureLog**: 前段エラー（video_format 不正・scenes 0件）専用ビルダーが
    正しく使われているか（buildStep05FailureLog の流用がないか）
16. **buildStep04_05PartialSuccessLog**: Full/Short の一方失敗時に呼ばれているか
17. **buildStep04DependencySkippedLog**: Fix #1 で Short をスキップした際に `[WARN][dependency_failure]` が記録されるか
18. **buildStep04ShortSkippedLog**: Fix #6 で 0件 SKIPPED 時に `[INFO][short_skipped]` が記録されるか

### G. プロンプト設計

19. **subtitle_short_2 の instruction**: フィールドガイド（`script_output_field_guide_*`）で
    「短い scene では `""` を返すこと（省略不可）」が明記されているか
20. **has_full_script フラグ**: Short プロンプトで `{{HAS_FULL_SCRIPT}}` が AI に正しく伝わるか

### H. コード品質

21. **未使用変数**: `step04-05-script-build.ts` に unused import / variable がないか
22. **型安全性**: `unknown` キャスト（load-script.ts の scene_no アクセス等）の影響範囲が限定されているか
23. **GeminiSpendingCapError の re-throw**: 残プロジェクトを正しくスキップするか

---

## 既知の制限・改善候補

| # | 内容 | 優先度 |
|---|---|---|
| L1 | `load-script.ts` の `scene_no` ソートが型キャスト経由（`ScriptFullReadRow` に `scene_no?` 追加で解決） | 低 |
| L2 | `matchAiOutputToScenes` の 20% フォールバック閾値は設計判断。実運用での妥当性を要確認 | 中 |
| L3 | `short+full` で Full が成功後に Short が 0件 SKIPPED の場合、`current_step` は `STEP_05_FULL_SCRIPT_BUILD` のまま。後工程でこの状態を正しく識別できるか確認が必要 | 中 |
| L4 | 将来最適化 FUTURE_OPTIMIZATION_C（Full+Short 1回呼び出し統合）は品質検証後に検討 | 低 |
