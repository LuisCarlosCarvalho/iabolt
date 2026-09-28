// Corre cada verificação em separado e regista o código de saída de cada uma.
// Termina com erro se QUALQUER comando falhar (sem cadeias com ';').
import { spawnSync } from 'node:child_process';

const steps = [
  ['typecheck', 'npm', ['run', 'typecheck']],
  ['lint', 'npm', ['run', 'lint']],
  ['test', 'npm', ['test']],
  ['build', 'npm', ['run', 'build']],
  ['diff-check', 'git', ['diff', '--check']],
];
const results = [];
for (const [name, cmd, args] of steps) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  results.push({ name, code: r.status });
}
console.log('\nResumo:');
for (const { name, code } of results) console.log(`  ${code === 0 ? 'OK ' : 'FALHA'}  ${name} (exit ${code})`);
process.exit(results.every((r) => r.code === 0) ? 0 : 1);
