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

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set."
    );
  }

  const credentials = JSON.parse(raw) as {
    client_email: string;
    private_key: string;
  };

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

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
export async function uploadImageToDrive(
  folderId: string,
  fileName: string,
  pngBuffer: Buffer
): Promise<string> {
  const drive = getDriveClient();

  // アップロード
  const uploadRes = await drive.files.create({
    requestBody: {
      name: fileName,
      mimeType: "image/png",
      parents: [folderId],
    },
    media: {
      mimeType: "image/png",
      body: Readable.from(pngBuffer),
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
