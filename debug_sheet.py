import paramiko

host = "35.255.81.115"
user = "aichaguimaoune"
password = "Hamza@19951995"

debug_script = '''
cd ~/sheet-to-tiktok-automation && node -e "
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const fs = require('fs');

async function main() {
  const creds = JSON.parse(fs.readFileSync('./credentials/service-account.json', 'utf-8'));
  const jwt = new JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const doc = new GoogleSpreadsheet('19xNwnl0k-jOqbR08NGqKziyiNV2K3_4X5Hw7nb0ULc0', jwt);
  await doc.loadInfo();
  
  console.log('Worksheets:', Object.keys(doc.sheetsByTitle));
  
  const sheet = doc.sheetsByTitle['TikTok'];
  if (!sheet) { console.log('TikTok sheet not found!'); return; }
  
  await sheet.loadHeaderRow();
  console.log('Headers:', sheet.headerValues);
  
  const rows = await sheet.getRows();
  console.log('Total rows:', rows.length);
  
  for (let i = 0; i < Math.min(3, rows.length); i++) {
    const row = rows[i];
    console.log('Row ' + (i) + ' (rowNumber=' + row.rowNumber + '):', JSON.stringify(row._rawData));
  }
}
main().catch(e => console.error(e.message));
"
'''

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=user, password=password, timeout=30)

stdin, stdout, stderr = client.exec_command(debug_script, timeout=30)
out = stdout.read().decode()
err = stderr.read().decode()
print("OUTPUT:")
print(out.strip())
if err.strip():
    print("ERR:", err.strip())

client.close()
