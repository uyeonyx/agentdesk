// Release step: SHA256SUMS over every installer in <dir>, signed with the update key.
//   UPDATE_SIGNING_KEY='-----BEGIN PRIVATE KEY-----…' node scripts/sign-release.mjs release-files/
// Refuses to sign with a key whose public half isn't the one the app ships (desktop/update-key.js),
// since every installed copy would then reject the update.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PUBLIC_KEY } from '../desktop/update-key.js';

const dir = process.argv[2];
const pem = process.env.UPDATE_SIGNING_KEY;
if (!dir || !pem) {
  console.error('usage: UPDATE_SIGNING_KEY=<pem> node scripts/sign-release.mjs <dir>');
  process.exit(2);
}
const key = crypto.createPrivateKey(pem);
const shipped = crypto.createPublicKey(PUBLIC_KEY).export({ type: 'spki', format: 'der' });
if (!crypto.createPublicKey(key).export({ type: 'spki', format: 'der' }).equals(shipped)) {
  console.error('UPDATE_SIGNING_KEY does not match desktop/update-key.js');
  process.exit(1);
}

const files = fs
  .readdirSync(dir)
  .filter((f) => /^AgentDesk-.+\.(zip|dmg|exe)$/.test(f))
  .sort();
if (!files.length) {
  console.error(`no installers in ${dir}`);
  process.exit(1);
}
const sums = files.map((f) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex')}  ${f}`).join('\n') + '\n';
fs.writeFileSync(path.join(dir, 'SHA256SUMS'), sums);
fs.writeFileSync(path.join(dir, 'SHA256SUMS.sig'), crypto.sign(null, Buffer.from(sums), key).toString('base64') + '\n');
console.log(sums.trim());
