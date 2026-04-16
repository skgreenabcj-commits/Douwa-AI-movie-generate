/**
 * upload-to-drive.ts
 *
 * Google Drive へのフォルダ作成・画像アップロードを担当する。
 *
 * 認証:
 * - GOOGLE_SERVICE_ACCOUNT_JSON 環境変数（GSS 認証と同一サービスアカウント）
 *
 * 主な責務:
 * 1. ensurePjtFolder  : 親フォルダ配下に "PJT-###" フォルダを作成（既存ならスキップ）
 * 2. uploadImageToDrive: PNG バッファを指定フォルダにアップロードし閲覧 URL を返す
 * 3. resolveVersionLabel: short_use / full_use から "short" | "full" | "shortfull" を解決
 */

import { google } from "googleapis";
import { Readable } from "stream";

// ─── Auth ─────────────────────────────────────────────────────────────────────

let _driveClient: ReturnType<typeof google.drive> | null = null;

function getDriveClient(): ReturnType<typeof google.drive> {
  if (_driveClient) return _driveClient;

  const clientId     = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Google Drive OAuth2 credentials are not set. " +
      "Required env vars: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN"
    );
  }

  // Use OAuth2 with personal Gmail account (service accounts lack Drive storage quota)
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });

  _driveClient = google.drive({ version: "v3", auth });
  return _driveClient;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * 親フォルダ配下に projectId 名のフォルダを作成する。
 * 既に同名フォルダが存在する場合はスキップして既存の folderId を返す。
 *
 * @param parentFolderId - 親フォルダの Google Drive ID
 * @param projectId      - 作成するフォルダ名（例: "PJT-001"）
 * @returns 作成または既存のフォルダ ID
 */
export async function ensurePjtFolder(
  parentFolderId: string,
  projectId: string
): Promise<string> {
  const drive = getDriveClient();

  // 既存フォルダを検索
  const query =
    `mimeType = 'application/vnd.google-apps.folder'` +
    ` and '${parentFolderId}' in parents` +
    ` and name = '${projectId}'` +
    ` and trashed = false`;

  const listRes = await drive.files.list({
    q: query,
    fields: "files(id, name)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const existing = listRes.data.files?.[0];
  if (existing?.id) {
    return existing.id;
  }

  // 新規作成
  const createRes = await drive.files.create({
    requestBody: {
      name: projectId,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentFolderId],
    },
    fields: "id",
    supportsAllDrives: true,
  });

  const newFolderId = createRes.data.id;
  if (!newFolderId) {
    throw new Error(`Failed to create Google Drive folder for project: ${projectId}`);
  }
  return newFolderId;
}

/**
 * PNG バッファを指定フォルダにアップロードし、閲覧用 URL を返す。
 * アップロード後に "anyone-reader" の共有設定を付与する。
 *
 * @param folderId  - アップロード先フォルダの Google Drive ID
 * @param fileName  - ファイル名（例: "PJT-001-SCN-001_shortfull_20260412.png"）
 * @param pngBuffer - PNG バイナリ
 * @returns 閲覧用 URL（https://drive.google.com/file/d/{fileId}/view）
 */
/**
 * PNG Buffer を JPEG に変換して返す。
 * sharp ライブラリを動的 import で使用する（ESM 互換）。
 *
 * @param buf     - 変換元 PNG バイナリ
 * @param quality - JPEG 品質（0〜100, デフォルト 90）
 * @returns JPEG バイナリ Buffer
 */
export async function convertToJpeg(buf: Buffer, quality = 90): Promise<Buffer> {
  const sharpModule = (await import("sharp")).default;
  return sharpModule(buf).jpeg({ quality }).toBuffer();
}

/**
 * Drive フォルダ内のファイル一覧（id + name）を返す。
 * Retake モードでのキャラクターシート再利用に使用する。
 *
 * @param folderId - 一覧取得するフォルダの Google Drive ID
 * @returns { id, name }[] のファイルリスト
 */
export async function listFilesInFolder(
  folderId: string
): Promise<{ id: string; name: string }[]> {
  const drive = getDriveClient();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "files(id, name)",
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return (res.data.files ?? [])
    .filter((f): f is { id: string; name: string } => !!f.id && !!f.name)
    .map((f) => ({ id: f.id, name: f.name }));
}

/**
 * Drive ファイルを Buffer としてダウンロードする。
 * Retake モードでのキャラクターシート再利用に使用する。
 *
 * @param fileId - ダウンロードするファイルの Google Drive ID
 * @returns ファイルバイナリ Buffer
 */
export async function downloadFileFromDrive(fileId: string): Promise<Buffer> {
  const drive = getDriveClient();
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data as ArrayBuffer);
}

export async function uploadImageToDrive(
  folderId: string,
  fileName: string,
  imageBuffer: Buffer,
  mimeType = "image/png"
): Promise<string> {
  const drive = getDriveClient();

  // アップロード
  const uploadRes = await drive.files.create({
    requestBody: {
      name: fileName,
      mimeType,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from(imageBuffer),
    },
    fields: "id",
    supportsAllDrives: true,
  });

  const fileId = uploadRes.data.id;
  if (!fileId) {
    throw new Error(`Google Drive upload failed: no fileId returned for ${fileName}`);
  }

  // anyone-reader 権限を付与（閲覧用公開リンク）
  await drive.permissions.create({
    fileId,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
  });

  return `https://drive.google.com/file/d/${fileId}/view`;
}

/**
 * 02_Scenes の short_use / full_use から版種ラベルを解決する。
 *
 * short_use=Y, full_use=N → "short"
 * short_use=N, full_use=Y → "full"
 * short_use=Y, full_use=Y → "shortfull"
 *
 * @param shortUse - "Y" | "N"
 * @param fullUse  - "Y" | "N"
 * @returns "short" | "full" | "shortfull"
 */
/**
 * MP3 バッファを指定フォルダにアップロードし、閲覧用 URL を返す。
 * アップロード後に "anyone-reader" の共有設定を付与する。
 *
 * @param folderId  - アップロード先フォルダの Google Drive ID
 * @param fileName  - ファイル名（例: "PJT-001-SCN-001_full_20260413.mp3"）
 * @param mp3Buffer - MP3 バイナリ
 * @returns 閲覧用 URL（https://drive.google.com/file/d/{fileId}/view）
 */
export async function uploadAudioToDrive(
  folderId: string,
  fileName: string,
  mp3Buffer: Buffer
): Promise<string> {
  const drive = getDriveClient();

  // アップロード
  const uploadRes = await drive.files.create({
    requestBody: {
      name: fileName,
      mimeType: "audio/mpeg",
      parents: [folderId],
    },
    media: {
      mimeType: "audio/mpeg",
      body: Readable.from(mp3Buffer),
    },
    fields: "id",
    supportsAllDrives: true,
  });

  const fileId = uploadRes.data.id;
  if (!fileId) {
    throw new Error(`Google Drive audio upload failed: no fileId returned for ${fileName}`);
  }

  // anyone-reader 権限を付与（閲覧用公開リンク）
  await drive.permissions.create({
    fileId,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
  });

  return `https://drive.google.com/file/d/${fileId}/view`;
}

export function resolveVersionLabel(
  shortUse: string,
  fullUse: string
): "short" | "full" | "shortfull" {
  const isShort = shortUse.trim().toUpperCase() === "Y";
  const isFull  = fullUse.trim().toUpperCase()  === "Y";

  if (isShort && isFull)  return "shortfull";
  if (isFull)             return "full";
  return "short";
}
