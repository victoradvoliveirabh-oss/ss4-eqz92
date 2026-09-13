// app.js — inicialização, tema, menu e roteador por hash.
import * as ui from './ui.js';
import * as storage from './storage.js';
import { listasRevisao } from './nucleo.js';

const ROTAS = {
  '/inicio': () => import('./inicio.js'),
  '/filtrar': () => import('./filtros.js'),
  '/cadernos': () => import('./cadernos.js'),
  '/resolver': () => import('./estudo.js'),
  '/revisao': () => import('./revisao.js'),
  '/desempenho': () => import('./desempenho.js'),
  '/ajustes': () => import('./ajustes.js'),
};

const TITULOS = {
  '/inicio': 'Início',
  '/filtrar': 'Filtrar questões',
  '/cadernos': 'Cadernos',
  '/resolver': 'Resolvendo',
  '/revisao': 'Revisão',
  '/desempenho': 'Desempenho',
  '/ajustes': 'Ajustes',
};

let moduloAtual = null;

// ---------------- Tema ----------------
const midiaEscura = window.matchMedia('(prefers-color-scheme: dark)');

function aplicarTema(tema) {
  const escuro = tema === 'escuro' || (tema !== 'claro' && midiaEscura.matches);
  document.body.classList.toggle('escuro', escuro);
  document.body.dataset.tema = tema;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = escuro ? '#050a13' : '#0b1220';
}

async function alternarTema() {
  const atual = (ui.estado.prefs && ui.estado.prefs.tema) || 'auto';
  const proximo = atual === 'auto' ? 'claro' : atual === 'claro' ? 'escuro' : 'auto';
  await storage.salvarPreferencias({ tema: proximo });
  await ui.sincronizarProgresso();
  aplicarTema(proximo);
  ui.toast(`Tema: ${proximo === 'auto' ? 'automático' : proximo}`);
}

// ---------------- Shell ----------------
function marcarNavegacao(rota) {
  for (const a of ui.$$('[data-rota]')) a.classList.toggle('ativo', a.dataset.rota === rota);
  const t = ui.$('#topo-titulo');
  if (t) t.textContent = TITULOS[rota] || 'Banco de Questões';
  document.title = `${TITULOS[rota] || 'Banco'} · Banco de Questões`;
}

export function atualizarBadges() {
  const { estado } = ui;
  const cadernos = (estado.progresso.cadernos || []).length;
  const bc = ui.$('#badge-cadernos');
  bc.hidden = !cadernos;
  bc.textContent = cadernos;

  const idsValidos = new Set(estado.porId.keys());
  const { devidas } = listasRevisao(estado.progresso, Date.now(), idsValidos);
  const br = ui.$('#badge-revisao');
  br.hidden = !devidas.length;
  br.textContent = devidas.length;

  const total = estado.questoes.length;
  const resolvidas = [...estado.status.resolvidas].filter((id) => estado.porId.has(id)).length;
  ui.$('#lateral-stat').innerHTML =
    `<b>${ui.num(total)}</b> questões no banco<br><b>${ui.num(resolvidas)}</b> já resolvidas`;
}

function fecharMenu() { document.body.classList.remove('menu-aberto'); }

function ligarShell() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-acao]');
    if (b && b.dataset.acao === 'alternar-tema') { alternarTema(); return; }
    if (b && b.dataset.acao === 'abrir-menu') { document.body.classList.add('menu-aberto'); return; }
    if (e.target.id === 'veu') fecharMenu();
    const link = e.target.closest('a[href^="#/"]');
    if (link) fecharMenu();
    const img = e.target.closest('[data-ampliar]');
    if (img) ui.abrirImagem(img.dataset.ampliar, 'Imagem da questão ampliada');
  });
  midiaEscura.addEventListener('change', () => aplicarTema((ui.estado.prefs && ui.estado.prefs.tema) || 'auto'));
  storage.aoMudar(() => { ui.sincronizarProgresso().then(atualizarBadges); });
}

// ---------------- Roteador ----------------
async function rotear() {
  const bruto = location.hash.replace(/^#/, '') || '/inicio';
  const [rota, consulta] = bruto.split('?');
  const params = new URLSearchParams(consulta || '');
  const carregar = ROTAS[rota];
  if (!carregar) { location.replace('#/inicio'); return; }

  if (moduloAtual && typeof moduloAtual.sair === 'function') {
    try { moduloAtual.sair(); } catch (e) { console.warn(e); }
  }
  marcarNavegacao(rota);
  // Troca o container por um novo: qualquer ouvinte deixado pela tela anterior
  // morre junto com o nó antigo (cada tela liga os seus eventos no próprio container).
  const antigo = ui.$('#view');
  const view = document.createElement('div');
  view.id = 'view';
  antigo.replaceWith(view);
  view.innerHTML = '<div class="carregando"><span class="girando"></span> Carregando…</div>';
  try {
    const mod = await carregar();
    moduloAtual = mod;
    await ui.sincronizarProgresso();
    await mod.renderizar(view, params);
    atualizarBadges();
  } catch (e) {
    console.error(e);
    view.innerHTML = ui.vazioHTML('Não consegui abrir esta tela', String(e && e.message || e));
  }
  if (rota !== '/resolver') window.scrollTo({ top: 0 });
}

// ---------------- Bootstrap ----------------
async function iniciar() {
  ligarShell();
  try {
    await ui.carregarDados();
  } catch (e) {
    ui.$('#carregando').innerHTML = `<div class="vazio"><h3>Não encontrei os dados do banco</h3>
      <p>Rode <code>npm run dados</code> na pasta <code>app/</code> para gerar
      <code>data/questoes.json</code> a partir de <code>banco/questoes/</code>.</p>
      <p style="color:var(--vermelho)">${ui.esc(e && e.message || e)}</p></div>`;
    return;
  }
  aplicarTema((ui.estado.prefs && ui.estado.prefs.tema) || 'auto');
  ui.$('#carregando').remove();
  ui.$('#view').hidden = false;
  atualizarBadges();
  window.addEventListener('hashchange', rotear);
  await rotear();

  const st = storage.statusArmazenamento();
  if (!st.persistente) ui.toast('Atenção: não consegui gravar o progresso neste navegador.', 'aviso', 6000);
}

iniciar();
