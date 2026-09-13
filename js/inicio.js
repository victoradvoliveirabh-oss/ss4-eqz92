// inicio.js — painel inicial: retomar o que estava aberto, atalhos rápidos e resumo.
import * as ui from './ui.js';
import * as storage from './storage.js';
import { estatisticas, listasRevisao, filtroVazio, resumoIds } from './nucleo.js';

const { esc, num, pct } = ui;
let el = null;

export async function renderizar(raiz) {
  el = raiz;
  const { estado } = ui;
  const est = estatisticas(estado.porId, estado.progresso, { modo: 'ultima' });
  const { devidas } = listasRevisao(estado.progresso, Date.now(), new Set(estado.porId.keys()));
  const sessao = estado.prefs.sessao;
  const cadernos = [...(estado.progresso.cadernos || [])].sort((a, b) => b.atualizadoEm - a.atualizadoEm).slice(0, 3);
  const resolvidas = [...estado.status.resolvidas].filter((id) => estado.porId.has(id)).length;

  el.innerHTML = `
    ${ui.avisoExemploHTML()}
    ${ui.cabecalhoHTML('Bom estudo, Samanta', 'Só provas oficiais: ENAMED, ENARE (Acesso Direto) e PSU-MG.')}

    ${sessao && sessao.ids && sessao.ids.length ? `
      <section class="cartao" style="border-color:var(--marca-borda);background:var(--marca-clara)">
        <div class="caderno-cabeca">
          <div>
            <div class="caderno-nome">Você parou em: ${esc(sessao.titulo)}</div>
            <div class="caderno-meta">Questão ${(sessao.indice || 0) + 1} de ${num(sessao.ids.length)} · ${sessao.modo === 'prova' ? 'modo prova' : 'modo estudo'} · ${ui.fmtDuracao(sessao.tempoMs)} de estudo</div>
          </div>
          <a class="btn btn-primario" href="#/resolver">Continuar</a>
        </div>
      </section>` : ''}

    <div class="grade grade-4" style="margin-top:14px">
      ${ui.kpiHTML('Questões no banco', num(estado.questoes.length), `${num(estado.meta.provas.length)} provas`)}
      ${ui.kpiHTML('Já resolvidas', num(resolvidas), `${pct(estado.questoes.length ? resolvidas / estado.questoes.length : 0)} do banco`)}
      ${ui.kpiHTML('Aproveitamento', pct(est.pct), `${num(est.acertos)} certas · ${num(est.erros)} erradas`, true)}
      ${ui.kpiHTML('Revisões para hoje', num(devidas.length), devidas.length ? 'clique em Revisão' : 'nada pendente')}
    </div>

    <section class="cartao">
      <div class="cartao-cabeca"><h2>Começar rápido</h2><a class="btn btn-p" href="#/filtrar">Filtro completo</a></div>
      <div class="grade grade-3">
        ${atalho('erradas', 'Minhas erradas', 'Questões em que você errou na última tentativa')}
        ${atalho('nao_resolvidas', 'Nunca resolvidas', 'Questões que você ainda não viu')}
        ${atalho('favoritas', 'Favoritas', 'Marcadas com estrela')}
        ${atalho('anotadas', 'Com anotação', 'Onde você deixou um lembrete')}
      </div>
      <div class="cartao-cabeca" style="margin-top:18px"><h3>Por grande área</h3></div>
      <div class="chips">
        ${estado.meta.areas.map((a) => `<button type="button" class="chip" data-i="area" data-valor="${esc(a.nome)}">${esc(a.nome)} · ${num(a.total)}</button>`).join('')}
      </div>
      <div class="cartao-cabeca" style="margin-top:18px"><h3>Prova inteira (modo prova)</h3></div>
      <div class="chips">
        ${estado.meta.provas.slice(0, 12).map((p) => `<button type="button" class="chip" data-i="prova" data-valor="${esc(p.chave)}">${esc(p.banca)} ${esc(p.ciclo || p.ano)} · ${num(p.total)}</button>`).join('')}
      </div>
    </section>

    ${cadernos.length ? `<section class="cartao">
      <div class="cartao-cabeca"><h2>Cadernos recentes</h2><a class="btn btn-p" href="#/cadernos">Ver todos</a></div>
      <div class="grade grade-2">
        ${cadernos.map((c) => {
          const ids = (c.ids || []).filter((id) => estado.porId.has(id));
          const r = resumoIds(ids, estado.status);
          return `<div class="cartao" style="box-shadow:none">
            <div class="caderno-nome">${esc(c.nome)}</div>
            <div class="caderno-meta" style="margin-bottom:8px">${num(ids.length)} questões · ${pct(r.andamento)} feito</div>
            ${ui.barraHTML(r.andamento, c.nome)}
            <div class="caderno-acoes" style="margin-top:10px">
              <button type="button" class="btn btn-p btn-primario" data-i="caderno" data-valor="${esc(c.id)}">Continuar</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </section>` : ''}

    ${est.temasMaisErrados.length ? `<section class="cartao">
      <div class="cartao-cabeca"><h2>Onde você mais erra</h2><a class="btn btn-p" href="#/desempenho">Desempenho completo</a></div>
      <div class="rolagem-x"><table class="tabela">
        <thead><tr><th>Tema</th><th>Especialidade</th><th class="num">Erros</th><th>Acerto</th><th></th></tr></thead>
        <tbody>${est.temasMaisErrados.slice(0, 6).map((t) => `<tr>
          <td>${esc(t.nome)}</td><td>${esc(t.especialidade)}</td><td class="num">${num(t.erros)}</td>
          <td style="min-width:120px">${ui.barraHTML(t.pct, t.nome)}</td>
          <td><button type="button" class="btn btn-p" data-i="tema" data-valor="${esc(t.chave)}">Treinar</button></td>
        </tr>`).join('')}</tbody>
      </table></div>
    </section>` : ''}`;

  el.addEventListener('click', onClique);
}

export function sair() { el = null; }

function atalho(status, titulo, texto) {
  return `<button type="button" class="cartao" style="text-align:left;cursor:pointer;box-shadow:none" data-i="status" data-valor="${status}">
    <div class="caderno-nome">${esc(titulo)}</div>
    <div class="caderno-meta">${esc(texto)}</div>
  </button>`;
}

async function onClique(e) {
  const b = e.target.closest('[data-i]');
  if (!b) return;
  const tipo = b.dataset.i, valor = b.dataset.valor;
  const filtro = filtroVazio();

  if (tipo === 'caderno') {
    const c = (ui.estado.progresso.cadernos || []).find((x) => x.id === valor);
    if (!c) return;
    const ids = (c.ids || []).filter((id) => ui.estado.porId.has(id));
    return ui.iniciarSessao(ids, { titulo: c.nome, indice: Math.min(c.indice || 0, ids.length - 1), cadernoId: c.id });
  }
  if (tipo === 'status') filtro.status = [valor];
  else if (tipo === 'area' || tipo === 'tema') filtro.assuntos = [valor];
  else if (tipo === 'prova') filtro.provas = [valor];

  await storage.salvarPreferencias({ ultimoFiltro: filtro });
  ui.navegar('#/filtrar');
}
