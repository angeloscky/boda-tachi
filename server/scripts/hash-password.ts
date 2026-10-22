import { createInterface } from 'node:readline';
import { hashPassword } from '../auth.js';

// Uso: npm run admin:hash  (pide la contraseña; también acepta: npm run admin:hash -- "contraseña")
async function main() {
  let password = process.argv[2];
  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    password = await new Promise<string>((resolve) => rl.question('Contraseña para el panel: ', (a) => (rl.close(), resolve(a))));
  }
  if (!password || password.length < 10) {
    console.error('Usa al menos 10 caracteres.');
    process.exit(1);
  }
  console.log('\nCopia esta línea en tu archivo .env:\n');
  console.log(`ADMIN_PASSWORD_HASH=${hashPassword(password)}`);
}
void main();
