const { google } = require('googleapis');

async function main() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  if (!serviceAccountJson) {
    throw new Error('Missing env: GOOGLE_SERVICE_ACCOUNT_JSON');
  }
  if (!spreadsheetId) {
    throw new Error('Missing env: GOOGLE_SPREADSHEET_ID');
  }

  let credentials;
  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch (error) {
    throw new Error(`Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON: ${error.message}`);
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Read test
  const readRange = '91_Field_Master!B5:P6';
  const readRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: readRange,
  });

  console.log('=== READ TEST SUCCESS ===');
  console.log(`Range: ${readRange}`);
  console.log(JSON.stringify(readRes.data.values || [], null, 2));

  // Write test
  const now = new Date().toISOString();
  const writeRange = '00_Rights_Validation!B6:C6';
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: writeRange,
    valueInputOption: 'RAW',
    requestBody: {
      values: [['GITHUB_READ_WRITE_TEST_OK', now]],
    },
  });

  console.log('=== WRITE TEST SUCCESS ===');
  console.log(`Range: ${writeRange}`);
  console.log(`Values: ["GITHUB_READ_WRITE_TEST_OK", "${now}"]`);
}

main().catch((error) => {
  console.error('=== TEST FAILED ===');
  console.error(error);
  process.exit(1);
});
