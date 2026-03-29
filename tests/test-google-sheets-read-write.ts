import { google } from 'googleapis';

async function main() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  if (!serviceAccountJson) {
    throw new Error('Missing environment variable: GOOGLE_SERVICE_ACCOUNT_JSON');
  }

  if (!spreadsheetId) {
    throw new Error('Missing environment variable: GOOGLE_SPREADSHEET_ID');
  }

  const credentials = JSON.parse(serviceAccountJson);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // 1) Read test: 91_Field_Master!B5:P6
  const readRange = '91_Field_Master!B5:P6';
  const readRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: readRange
  });

  console.log('=== READ TEST SUCCESS ===');
  console.log(`Range: ${readRange}`);
  console.log(JSON.stringify(readRes.data.values, null, 2));

  // 2) Write test: 00_Rights_Validation row 6
  const nowIso = new Date().toISOString();
  const writeRange = '00_Rights_Validation!B6:C6';

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: writeRange,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[
        'GITHUB_READ_WRITE_TEST_OK',
        nowIso
      ]]
    }
  });

  console.log('=== WRITE TEST SUCCESS ===');
  console.log(`Range: ${writeRange}`);
  console.log(`Written values: ["GITHUB_READ_WRITE_TEST_OK", "${nowIso}"]`);
}

main().catch((err) => {
  console.error('=== TEST FAILED ===');
  console.error(err);
  process.exit(1);
});
