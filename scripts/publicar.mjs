// Atualiza o site publicado no GitHub Pages:
// regenera os dados, commita o que mudou em app/ e empurra para o repositório.
// Uso: npm run publicar  [-- "mensagem do commit"]
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://victoradvoliveirabh-oss.github.io/ss4-eqz92/';
const rodar = (cmd, args) => execFileSync(cmd, args, { cwd: APP, stdio: 'inherit' });
const ler = (cmd, args) => execFileSync(cmd, args, { cwd: APP, encoding: 'utf8' }).trim();

const mensagem = process.argv.slice(2).join(' ') || `Atualiza o banco de questões (${new Date().toLocaleString('pt-BR')})`;

console.log('1/4 Gerando os dados a partir de banco/questoes/…');
rodar(process.execPath, ['scripts/build-data.mjs']);

console.log('\n2/4 Carimbando a versão do build nos arquivos do site…');
rodar(process.execPath, ['scripts/carimbar-versao.mjs', Date.now().toString(36)]);
rodar(process.execPath, ['scripts/build-artifact.mjs']);

console.log('\n3/4 Registrando as mudanças…');
rodar('git', ['add', '-A']);
if (!ler('git', ['status', '--porcelain'])) {
  console.log('Nada mudou — o site já está atualizado.');
  console.log(SITE);
  process.exit(0);
}
rodar('git', ['commit', '-m', mensagem]);

console.log('\n4/4 Publicando…');
rodar('git', ['push']);
console.log(`\nPronto. Em 1–2 minutos o site atualiza:\n  ${SITE}`);
