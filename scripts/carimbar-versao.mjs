// Carimba a versão do build nas URLs do index.html (CSS, script de entrada e import map).
// Sem isso, o CDN do GitHub Pages entrega os arquivos com validades diferentes e o app
// pode rodar "meio novo, meio velho" depois de uma publicação.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versao = process.argv[2] || Date.now().toString(36);
const arquivo = path.join(APP, 'index.html');
let html = fs.readFileSync(arquivo, 'utf8');

const modulos = fs.readdirSync(path.join(APP, 'js')).filter((f) => f.endsWith('.js')).sort();
const mapa = Object.fromEntries(modulos.map((f) => [`./js/${f}`, `./js/${f}?v=${versao}`]));
const tagMapa = `<script type="importmap" id="mapa-versao">${JSON.stringify({ imports: mapa })}</script>`;

html = html.replace(/href="css\/estilo\.css(\?v=[^"]*)?"/, `href="css/estilo.css?v=${versao}"`);
html = html.replace(/<script type="importmap" id="mapa-versao">[\s\S]*?<\/script>\s*/, '');
html = html.replace(/<script type="module" src="js\/app\.js(\?v=[^"]*)?"><\/script>/,
  `${tagMapa}\n<script type="module" src="js/app.js?v=${versao}"></script>`);

fs.writeFileSync(arquivo, html);
console.log(`versão ${versao} carimbada em index.html (${modulos.length} módulos no import map)`);
