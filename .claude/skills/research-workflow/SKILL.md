---
name: research-workflow
description: Conducts technical research, competitive analysis, technology
  evaluation, or market investigation. Use when investigating tools,
  libraries, services, frameworks, comparing options, or writing research
  summaries. Outputs results to Google Docs (documents) or Google Sheets
  (tables/comparisons).
---

# Research Workflow

## When to Activate
- 技術調査・ライブラリ比較・競合調査
- サービス・APIの評価
- 市場調査・トレンド調査
- リサーチレポートの作成

## Process
1. 調査目的・スコープ・出力フォーマットを作業前に確認する
2. 複数ソース（公式ドキュメント・GitHub・最新記事）を横断して収集する
3. 情報の鮮度（公開日・バージョン）を必ず確認し記録する
4. 推測・補完を行わない。不明点は「要確認」と明記する
5. 出力先のフォーマットに合わせて整形して納品する

## Output Destination
- 文書レポート → Google Docs 形式（Markdown で下書き後、共有用に変換）
- 比較表・データ → Google Sheets 形式（CSV または表構造で出力）
- ファイル命名規則: YYYY-MM-DD_[topic-slug]

## Output Format - Google Docs 向け（文書レポート）

# [調査タイトル]
調査日: YYYY-MM-DD

### TL;DR（3行以内）
[結論のみ。理由は次セクションへ]

### 背景・調査目的
[なぜこの調査が必要か]

### 調査結果
[詳細な発見事項]

### 推奨と根拠
[具体的な理由と制約条件付きで推奨を記載]

### 懸念・未確認事項
- [要確認点があれば必ず列挙]

### ソース
- [タイトル](URL) — YYYY-MM-DD

## Output Format - Google Sheets 向け（比較表）

| 観点 | 選択肢A | 選択肢B | 選択肢C |
|------|---------|---------|---------|
| 項目1 | ... | ... | ... |
| 項目2 | ... | ... | ... |
| 総合評価 | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |

## Rules
- バージョン違いによる情報の矛盾に注意する
- 「最新」と書かれていても公開日を必ず確認する
- 推測で情報を補わない。不明点は「要確認」と明記する
- 情報源が1つだけの場合はその旨を明記する
