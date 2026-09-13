// revisao.js — revisão espaçada derivada do histórico (1, 3, 7 e 15 dias após o erro).
import * as ui from './ui.js';
import { listasRevisao, INTERVALOS_REVISAO } from './nucleo.js';

const { esc, num } = ui;
let el = null;

export async function renderizar(raiz) {
  el = raiz;
  const idsValidos = new Set(ui.estado.porId.keys());
  const l = listasRevisao(ui.estado.progresso, Date.now(), idsValidos);

  el.innerHTML = `
    ${ui.cabecalhoHTML('Revisão espaçada',
      `Errou uma questão? Ela volta em ${INTERVALOS_REVISAO.join(', ')} dias. Acertando nas quatro vezes, ela sai da fila.`)}

    <div class="grade grade-4">
      ${ui.kpiHTML('Para hoje', num(l.devidas.length), 'no ponto de revisar', true)}
      ${ui.kpiHTML('Agendadas', num(l.agendadas.length), 'ainda não venceram')}
      ${ui.kpiHTML('Erradas na última', num(l.erradasUltima.length), '')}
      ${ui.kpiHTML('Já errou alguma vez', num(l.jaErradas.length), '')}
    </div>

    <section class="cartao">
      <div class="cartao-cabeca"><h2>Revisar agora</h2>
        <button type="button" class="btn btn-primario" data-r="devidas" ${l.devidas.length ? '' : 'disabled'}>
          Revisar ${num(l.devidas.length)} questões</button>
      </div>
      ${l.devidas.length
        ? `<ul class="lista-q">${l.devidas.slice(0, 30).map((d) => item(d)).join('')}</ul>
           ${l.devidas.length > 30 ? `<p class="caderno-meta" style="margin-top:10px">+${num(l.devidas.length - 30)} na fila</p>` : ''}`
        : ui.vazioHTML('Nada para revisar hoje', 'Volte depois de errar algumas questões — a fila se monta sozinha.')}
    </section>

    <section class="cartao">
      <div class="cartao-cabeca"><h2>Treinar os erros</h2></div>
      <div class="caderno-acoes">
        <button type="button" class="btn" data-r="erradas-ultima" ${l.erradasUltima.length ? '' : 'disabled'}>Erradas na última tentativa (${num(l.erradasUltima.length)})</button>
        <button type="button" class="btn" data-r="ja-erradas" ${l.jaErradas.length ? '' : 'disabled'}>Tudo que já errei (${num(l.jaErradas.length)})</button>
      </div>
    </section>

    ${l.agendadas.length ? `<section class="cartao">
      <div class="cartao-cabeca"><h2>Próximas revisões</h2></div>
      <div class="rolagem-x"><table class="tabela">
        <thead><tr><th>Questão</th><th>Etapa</th><th>Volta em</th></tr></thead>
        <tbody>${l.agendadas.slice(0, 25).map((a) => {
          const q = ui.estado.porId.get(a.id);
          return `<tr><td>${esc(q ? q.referencia : a.id)}</td>
            <td>${a.etapa + 1}ª (${INTERVALOS_REVISAO[a.etapa]} dias)</td>
            <td>${ui.fmtData(a.proxima)}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
    </section>` : ''}`;

  el.addEventListener('click', onClique);
}

export function sair() { el = null; }

function item(d) {
  const q = ui.estado.porId.get(d.id);
  if (!q) return '';
  return ui.itemQuestaoHTML(q, {
    acao: `data-r="abrir" data-id="${esc(q.id)}"`,
    extra: `<span class="selo">${d.etapa + 1}ª revisão</span>`,
  });
}

function onClique(e) {
  const b = e.target.closest('[data-r]');
  if (!b) return;
  const idsValidos = new Set(ui.estado.porId.keys());
  const l = listasRevisao(ui.estado.progresso, Date.now(), idsValidos);
  const acao = b.dataset.r;
  if (acao === 'devidas') ui.iniciarSessao(l.devidas.map((d) => d.id), { titulo: 'Revisão de hoje' });
  else if (acao === 'erradas-ultima') ui.iniciarSessao(l.erradasUltima, { titulo: 'Erradas na última tentativa' });
  else if (acao === 'ja-erradas') ui.iniciarSessao(l.jaErradas, { titulo: 'Tudo que já errei' });
  else if (acao === 'abrir') {
    const ids = l.devidas.map((d) => d.id);
    ui.iniciarSessao(ids, { titulo: 'Revisão de hoje', indice: ids.indexOf(b.dataset.id) });
  }
}
