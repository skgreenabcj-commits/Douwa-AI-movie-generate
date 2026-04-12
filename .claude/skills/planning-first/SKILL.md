---
name: planning-first
description: Breaks down large or ambiguous tasks into a structured
  implementation plan before writing any code. Use when the task involves
  multiple files, architectural decisions, database changes, or unclear
  requirements. Do not start implementation without explicit approval.
---

# Planning First

## When to Activate
以下のいずれかに該当する場合、必ずプランを提示してから実装を開始する：
- 複数ファイルにまたがる変更
- アーキテクチャ上の判断が必要な場合
- データベーススキーマの変更を伴う場合
- 要件があいまい・解釈の余地がある場合
- 既存の動作に影響する可能性がある変更

## Plan Format
実装前に以下のフォーマットでプランを提示し、明示的な承認を得てから作業を開始する：

## 理解した要件
[何を実装するかの確認。認識のズレをここで潰す]

## 影響するファイル・コンポーネント
- path/to/file.ts : 変更内容の概要
- path/to/other.ts : 変更内容の概要

## 実装ステップ
1. [ステップ1の説明]
2. [ステップ2の説明]
3. [ステップ3の説明]

## 考慮したアーキテクチャ上の判断
- [選択肢があった場合、なぜこのアプローチを選んだか]

## 不明点・確認事項
- [着手前に確認が必要なこと。ある場合は必ず列挙する]

## Rules
- プランへの承認なしに実装を開始しない
- 「たぶんこういう意図だろう」と推測で進めない
- 不明点があれば実装前に質問する
- プラン承認後に要件の解釈が変わった場合は、再度プランを提示する
- 小さな修正（タイポ修正・1行の変更など）はプラン不要
