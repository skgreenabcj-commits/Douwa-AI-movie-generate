/**
 * scripts/dry-run-step03.ts  ← リポジトリルートからの実行用エントリポイント
 *
 * このファイルは `npx tsx scripts/dry-run-step03.ts [project_id]` で直接実行できる
 * thin wrapper です。実体は src/scripts/dry-run-step03.ts にあります。
 *
 * 使用方法（ビルド不要 / tsx が自動インストールされます）:
 *   npx tsx scripts/dry-run-step03.ts
 *   npx tsx scripts/dry-run-step03.ts PJT-001
 *
 * ビルド後に node で実行する場合:
 *   npm run build
 *   node dist/scripts/dry-run-step03.js PJT-001
 *
 * npm scripts 経由:
 *   npm run dry-run:step03
 *   PROJECT_ID=PJT-001 npm run dry-run:step03
 */

// src/scripts/ の実体に処理を委譲する
// tsx で実行する場合は .ts を直接 import する
// (esbuild ビルド後は dist/scripts/ を直接実行すること)
import "../src/scripts/dry-run-step03.ts";
