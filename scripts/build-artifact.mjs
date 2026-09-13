// Gera artifact.html a partir do index.html, no formato que o Artifact do Claude espera
// (só o conteúdo do <body>, com <title> e o <link> do CSS no topo; a casca vem do publicador).
// Uso: npm run artifact   →  publique artifact.html junto com css/, js/, data/ e img/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');

const titulo = (html.match(/<title>([\s\S]*?)<\/title>/) || [, 'Banco de Questões'])[1];
const corpo = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) || [, ''])[1];
if (!corpo.trim()) { console.error('Não achei o <body> do index.html'); process.exit(1); }

// data-tema fica no <body> do app local; no artifact o body é do publicador, então move para o html
const saida = `<title>${titulo}</title>
<link rel="stylesheet" href="css/estilo.css">
<script>document.body.dataset.tema = 'auto';</script>
${corpo.trim()}
`;
fs.writeFileSync(path.join(APP, 'artifact.html'), saida);

// lista de arquivos de apoio, para conferência
const apoio = [
  'css/estilo.css',
  ...fs.readdirSync(path.join(APP, 'js')).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`),
  ...fs.readdirSync(path.join(APP, 'data')).filter((f) => f.endsWith('.json')).map((f) => `data/${f}`),
  ...(fs.existsSync(path.join(APP, 'img')) ? fs.readdirSync(path.join(APP, 'img')).map((f) => `img/${f}`) : []),
];
const tamanho = (p) => fs.statSync(path.join(APP, p)).size;
const total = apoio.reduce((s, f) => s + tamanho(f), 0) + fs.statSync(path.join(APP, 'artifact.html')).size;
console.log('artifact.html gerado.');
console.log(`Arquivos de apoio (${apoio.length}):`);
for (const f of apoio) console.log(`  ${f.padEnd(28)} ${(tamanho(f) / 1024).toFixed(1)} kB`);
console.log(`Total publicado: ${(total / 1024).toFixed(1)} kB`);
