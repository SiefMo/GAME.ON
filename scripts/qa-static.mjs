import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const required = [
  'client/src/main.tsx','client/src/styles.css','server/src/socket.ts','server/src/matchRuntimeStore.ts',
  'shared/src/game.ts','migrations/004_match_runtime.sql','migrations/007_admin_audit.sql','playwright.config.ts',
  'e2e/auth.spec.ts','e2e/lobby.spec.ts','docs/SECURITY-AUDIT.md'
];
for (const file of required) if (!fs.existsSync(path.join(root,file))) throw new Error(`Missing required file: ${file}`);
for (const file of fs.readdirSync(path.join(root,'config')).filter(x=>x.endsWith('.json'))) JSON.parse(fs.readFileSync(path.join(root,'config',file),'utf8'));
JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
for (const pkg of ['client','server','shared']) JSON.parse(fs.readFileSync(path.join(root,pkg,'package.json'),'utf8'));
console.log(`Static QA: required files + JSON validation passed (${required.length} required files).`);
try {
  execFileSync('tsc',['--noEmit','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--strict','--skipLibCheck','shared/src/game.ts'],{cwd:root,stdio:'inherit'});
  console.log('Shared GameEngine typecheck passed.');
} catch { console.error('Shared GameEngine typecheck failed.'); process.exitCode=1; }
