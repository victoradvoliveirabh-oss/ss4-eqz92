// cadernos.js — lista de cadernos salvos (conjuntos congelados de questões),
// com andamento, retomada e recriação a partir do filtro de origem.
import * as ui from './ui.js';
import * as storage from './storage.js';
import { resumoIds, selecionarQuestoes, normalizarFiltro, contarCriterios } from './nucleo.js';

const { esc, num, pct } = ui;
let el = null;

export async function renderizar(raiz, params) {
  el = raiz;
  const abrir = params && params.get('abrir');
  desenhar();
  if (abrir) {
    const alvo = ui.$(`[data-caderno="${CSS.escape(abrir)}"]`, el);
    if (alvo) { alvo.scrollIntoView({ block: 'center', behavior: 'smooth' }); alvo.style.outline = '3px solid var(--marca)'; }
  }
}

export function sair() { el = null; }

function desenhar() {
  const cadernos = [...(ui.estado.progresso.cadernos || [])].sort((a, b) => b.atualizadoEm - a.atualizadoEm);
  el.innerHTML = `
    ${ui.avisoExemploHTML()}
    ${ui.cabecalhoHTML('Cadernos', 'Cada caderno é uma lista fixa de questões — você para e retoma de onde parou.',
      `<a class="btn btn-primario" href="#/filtrar?novo">+ Novo caderno</a>`)}
    ${cadernos.length
      ? `<div class="grade grade-2">${cadernos.map(cartao).join('')}</div>`
      : ui.vazioHTML('Você ainda não tem cadernos',
          'Monte um filtro (banca, ano, assunto, suas erradas…) e salve como caderno.',
          '<p style="margin-top:14px"><a class="btn btn-primario" href="#/filtrar">Filtrar questões</a></p>')}`;
  el.addEventListener('click', onClique);
}

function cartao(c) {
  const ids = (c.ids || []).filter((id) => ui.estado.porId.has(id));
  const r = resumoIds(ids, ui.estado.status);
  const pos = Math.min(c.indice || 0, Math.max(0, ids.length - 1));
  const criterios = contarCriterios(c.filtro || {});
  return `<section class="cartao caderno" data-caderno="${esc(c.id)}">
    <div class="caderno-cabeca">
      <div>
        <div class="caderno-nome">${esc(c.nome)}</div>
        <div class="caderno-meta">${num(ids.length)} questões · ${criterios} ${criterios === 1 ? 'critério' : 'critérios'} · atualizado em ${ui.fmtData(c.atualizadoEm)}</div>
      </div>
      <span class="selo">${r.resolvidas ? pct(r.andamento) + ' feito' : 'novo'}</span>
    </div>
    ${ui.barraHTML(r.andamento, 'Andamento')}
    <div class="caderno-meta">
      ${num(r.resolvidas)} resolvidas · ${num(r.acertos)} certas · ${num(r.erros)} erradas
      ${r.acertos + r.erros ? ` · aproveitamento ${pct(r.pct)}` : ''}
    </div>
    <div class="caderno-acoes">
      <button type="button" class="btn btn-primario" data-c="continuar" data-id="${esc(c.id)}">
        ${r.resolvidas ? `Continuar (questão ${pos + 1})` : 'Começar'}
      </button>
      <button type="button" class="btn btn-p" data-c="prova" data-id="${esc(c.id)}">Modo prova</button>
      <button type="button" class="btn btn-p" data-c="pendentes" data-id="${esc(c.id)}" ${r.pendentes ? '' : 'disabled'}>Só as ${num(r.pendentes)} pendentes</button>
      <button type="button" class="btn btn-p" data-c="erradas" data-id="${esc(c.id)}" ${r.erros ? '' : 'disabled'}>Só as erradas</button>
      <button type="button" class="btn btn-p" data-c="renomear" data-id="${esc(c.id)}">Renomear</button>
      <button type="button" class="btn btn-p" data-c="editar" data-id="${esc(c.id)}">Editar filtro</button>
      <button type="button" class="btn btn-p" data-c="atualizar" data-id="${esc(c.id)}" title="Refaz a seleção com o filtro salvo">Atualizar questões</button>
      <button type="button" class="btn btn-p" data-c="reiniciar" data-id="${esc(c.id)}">Voltar ao início</button>
      <button type="button" class="btn btn-p btn-perigo" data-c="excluir" data-id="${esc(c.id)}">Excluir</button>
    </div>
  </section>`;
}

async function onClique(e) {
  const b = e.target.closest('[data-c]');
  if (!b) return;
  const c = (ui.estado.progresso.cadernos || []).find((x) => x.id === b.dataset.id);
  if (!c) return;
  const ids = (c.ids || []).filter((id) => ui.estado.porId.has(id));
  const st = ui.estado.status;
  const acao = b.dataset.c;

  if (acao === 'continuar') {
    await ui.iniciarSessao(ids, { titulo: c.nome, modo: 'estudo', indice: Math.min(c.indice || 0, ids.length - 1), cadernoId: c.id });
  } else if (acao === 'prova') {
    await ui.iniciarSessao(ids, { titulo: `${c.nome} (prova)`, modo: 'prova', cadernoId: c.id });
  } else if (acao === 'pendentes') {
    await ui.iniciarSessao(ids.filter((id) => !st.resolvidas.has(id)), { titulo: `${c.nome} · pendentes` });
  } else if (acao === 'erradas') {
    await ui.iniciarSessao(ids.filter((id) => st.ultima.get(id) === false), { titulo: `${c.nome} · erradas` });
  } else if (acao === 'renomear') {
    const nome = await ui.pedirTexto('Renomear caderno', { rotulo: 'Nome', valor: c.nome });
    if (nome) { await storage.atualizarCaderno(c.id, { nome }); await recarregar(); }
  } else if (acao === 'editar') {
    ui.navegar(`#/filtrar?caderno=${c.id}`);
  } else if (acao === 'atualizar') {
    const filtro = normalizarFiltro(c.filtro);
    const { ids: novos } = selecionarQuestoes(ui.estado.questoes, filtro, st, { ordem: c.ordem || 'prova' });
    const dif = novos.length - ids.length;
    const ok = await ui.confirmar(
      `Refazer a seleção com o filtro salvo? O caderno fica com ${num(novos.length)} questões (${dif >= 0 ? '+' : ''}${num(dif)}).`,
      { ok: 'Atualizar' });
    if (!ok) return;
    await storage.atualizarCaderno(c.id, { ids: novos, indice: 0 });
    await recarregar();
    ui.toast('Caderno atualizado.', 'ok');
  } else if (acao === 'reiniciar') {
    await storage.atualizarCaderno(c.id, { indice: 0 });
    await recarregar();
    ui.toast('Caderno voltou para a primeira questão.');
  } else if (acao === 'excluir') {
    const ok = await ui.confirmar(`Excluir o caderno "${c.nome}"? As respostas que você já deu continuam salvas.`, { ok: 'Excluir', perigo: true });
    if (!ok) return;
    await storage.removerCaderno(c.id);
    await recarregar();
  }
}

async function recarregar() {
  await ui.sincronizarProgresso();
  el.removeEventListener('click', onClique);
  desenhar();
}
