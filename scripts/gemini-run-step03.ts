/**
 * scripts/gemini-run-step03.ts  ← リポジトリルートからの実行用エントリポイント
 *
 * このファイルは `npx tsx scripts/gemini-run-step03.ts [project_id...]` で直接実行できる
 * thin wrapper です。実体は src/scripts/gemini-run-step03.ts にあります。
 *
 * 使用方法（ビルド不要 / tsx が自動インストールされます）:
 *   npx tsx scripts/gemini-run-step03.ts
 *   npx tsx scripts/gemini-run-step03.ts PJT-001
 *   npx tsx scripts/gemini-run-step03.ts PJT-001 PJT-002
 *
 * ビルド後に node で実行する場合:
 *   npm run build
 *   node dist/scripts/gemini-run-step03.js PJT-001
 *
 * npm scripts 経由:
 *   npm run gemini-run:step03
 *   PROJECT_IDS=PJT-001,PJT-002 npm run gemini-run:step03:multi
 *
 * 環境変数:
 *   DRY_RUN=true/false    : false で LLM 呼び出し（デフォルト true）
 *   USE_MOCK=true/false   : true でモック応答を使用（デフォルト true）
 *   OUTPUT_DIR=tests/output : 結果保存ディレクトリ
 */

// src/scripts/ の実体に処理を委譲する
import "../src/scripts/gemini-run-step03.ts";
