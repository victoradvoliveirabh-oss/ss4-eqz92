// desempenho.js — estatísticas de acerto por área, especialidade, banca, ano e tema,
// evolução no tempo e histórico de provas feitas em modo prova.
import * as ui from './ui.js';
import * as storage from './storage.js';
import { estatisticas, filtroVazio, SEP } from './nucleo.js';

const { esc, num, pct } = ui;
let el = null;
let modo = 'ultima'; // 'todas' | 'primeira' | 'ultima'

const MODOS = [
  ['ultima', 'Última tentativa'],
  ['primeira', 'Primeira tentativa'],
  ['todas', 'Todas as tentativas'],
];

export async function renderizar(raiz) {
  el = raiz;
  desenhar();
  el.addEventListener('click', onClique);
}

export function sair() { el = null; }

function desenhar() {
  const { estado } = ui;
  const est = estatisticas(estado.porId, estado.progresso, { modo });
  const simulados = [...(estado.progresso.simulados || [])].sort((a, b) => (b.finalizadoEm || 0) - (a.finalizadoEm || 0));

  if (!est.totalRespostas) {
    el.innerHTML = `${ui.cabecalhoHTML('Desempenho')}
      ${ui.vazioHTML('Ainda não há respostas registradas',
        'Resolva algumas questões e este painel se monta sozinho.',
        '<p style="margin-top:14px"><a class="btn btn-primario" href="#/filtrar">Filtrar questões</a></p>')}`;
    return;
  }

  el.innerHTML = `
    ${ui.cabecalhoHTML('Desempenho', `${num(est.questoesResolvidas)} questões resolvidas · ${num(est.totalRespostas)} respostas contadas`,
      `<div class="segmento" role="group" aria-label="Como contar">
        ${MODOS.map(([v, r]) => `<button type="button" data-d="modo" data-valor="${v}" aria-pressed="${modo === v}">${esc(r)}</button>`).join('')}
      </div>`)}

    <section class="cartao" style="display:flex;gap:24px;align-items:center;flex-wrap:wrap">
      ${ui.anelHTML(est.pct, { rotulo: 'Aproveitamento geral', tamanho: 128 })}
      <div class="grade grade-4" style="flex:1;min-width:260px">
        ${ui.kpiHTML('Acertos', num(est.acertos))}
        ${ui.kpiHTML('Erros', num(est.erros))}
        ${ui.kpiHTML('Questões distintas', num(est.questoesResolvidas))}
        ${ui.kpiHTML('Aproveitamento', pct(est.pct), MODOS.find(([v]) => v === modo)[1], true)}
      </div>
    </section>

    <section class="cartao">
      <div class="cartao-cabeca"><h2>Por grande área</h2></div>
      ${tabela(est.porArea, 'areas', (g) => g.nome, (g) => g.nome)}
    </section>

    <section class="cartao">
      <div class="cartao-cabeca"><h2>Por especialidade</h2><span class="caderno-meta">as 15 com mais respostas</span></div>
      ${tabela(est.porEspecialidade.slice(0, 15), 'especialidades', (g) => g.chave, (g) => `${g.nome} <small style="color:var(--tinta-3)">${esc(g.area)}</small>`)}
    </section>

    <section class="cartao">
      <div class="cartao-cabeca"><h2>Onde você mais erra</h2><span class="caderno-meta">temas ordenados por número de erros</span></div>
      ${tabela(est.temasMaisErrados.slice(0, 15), 'temas', (g) => g.chave, (g) => `${g.nome} <small style="color:var(--tinta-3)">${esc(g.especialidade)}</small>`)}
    </section>

    <div class="grade grade-2">
      <section class="cartao">
        <div class="cartao-cabeca"><h2>Por banca</h2></div>
        ${tabela(est.porBanca, 'bancas', (g) => g.nome, (g) => g.nome)}
      </section>
      <section class="cartao">
        <div class="cartao-cabeca"><h2>Por ano da prova</h2></div>
        ${tabela(est.porAno, 'anos', (g) => String(g.chave), (g) => g.nome)}
      </section>
    </div>

    <section class="cartao">
      <div class="cartao-cabeca"><h2>Evolução</h2><span class="caderno-meta">por ${est.evolucao.unidade}</span></div>
      ${evolucaoHTML(est.evolucao)}
    </section>

    ${simulados.length ? `<section class="cartao">
      <div class="cartao-cabeca"><h2>Provas feitas</h2></div>
      <div class="rolagem-x"><table class="tabela">
        <thead><tr><th>Prova</th><th>Quando</th><th class="num">Questões</th><th class="num">Acertos</th><th>Nota</th><th></th></tr></thead>
        <tbody>${simulados.map((s) => `<tr>
          <td>${esc(s.titulo)}</td>
          <td>${ui.fmtData(s.finalizadoEm, true)}<br><small style="color:var(--tinta-3)">${ui.fmtDuracao(s.duracaoMs)}</small></td>
          <td class="num">${num(s.resultado.validas)}</td>
          <td class="num">${num(s.resultado.acertos)}</td>
          <td style="min-width:130px">${ui.barraHTML(s.resultado.nota, s.titulo)} <small>${pct(s.resultado.nota)}</small></td>
          <td><button type="button" class="btn btn-p btn-perigo" data-d="apagar-simulado" data-valor="${esc(s.id)}">Apagar</button></td>
        </tr>`).join('')}</tbody>
      </table></div>
    </section>` : ''}`;
}

function tabela(grupos, dim, chave, rotulo) {
  if (!grupos.length) return '<p class="caderno-meta">Sem dados ainda.</p>';
  return `<div class="rolagem-x"><table class="tabela">
    <thead><tr><th>Nome</th><th class="num">Respostas</th><th class="num">Acertos</th><th>Aproveitamento</th><th></th></tr></thead>
    <tbody>${grupos.map((g) => `<tr>
      <td>${rotulo(g)}</td>
      <td class="num">${num(g.total)}</td>
      <td class="num">${num(g.acertos)}</td>
      <td style="min-width:150px">${ui.barraHTML(g.pct, g.nome)} <small>${pct(g.pct)}</small></td>
      <td><button type="button" class="btn btn-p" data-d="treinar" data-dim="${dim}" data-valor="${esc(chave(g))}">Treinar</button></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function evolucaoHTML(ev) {
  if (!ev.pontos.length) return '<p class="caderno-meta">Sem dados ainda.</p>';
  const pontos = ev.pontos.slice(-30);
  return `<div class="colunas-evolucao">${pontos.map((p) => {
    const alt = Math.max(4, Math.round(p.pct * 100));
    const cor = p.pct >= 0.7 ? 'var(--marca)' : p.pct >= 0.5 ? '#d19a00' : 'var(--vermelho)';
    return `<div class="coluna-ev" title="${ui.fmtData(p.inicio)} · ${p.acertos}/${p.total} (${pct(p.pct)})">
      <i style="height:${alt}%;background:${cor}"></i>
      <span>${new Date(p.inicio).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
    </div>`;
  }).join('')}</div>
  <p class="caderno-meta" style="margin-top:8px">Altura = aproveitamento no período. Passe o mouse para ver os números.</p>`;
}

async function onClique(e) {
  const b = e.target.closest('[data-d]');
  if (!b) return;
  const acao = b.dataset.d;
  if (acao === 'modo') { modo = b.dataset.valor; desenhar(); return; }
  if (acao === 'apagar-simulado') {
    const ok = await ui.confirmar('Apagar este registro de prova? As respostas continuam no histórico.', { ok: 'Apagar', perigo: true });
    if (!ok) return;
    await storage.removerSimulado(b.dataset.valor);
    await ui.sincronizarProgresso();
    desenhar();
    return;
  }
  if (acao === 'treinar') {
    const filtro = filtroVazio();
    const dim = b.dataset.dim, valor = b.dataset.valor;
    if (dim === 'anos') filtro.anos = [valor];
    else if (dim === 'bancas') filtro.bancas = [valor];
    else filtro.assuntos = [valor];
    await storage.salvarPreferencias({ ultimoFiltro: filtro });
    ui.navegar('#/filtrar');
  }
}

void SEP;
