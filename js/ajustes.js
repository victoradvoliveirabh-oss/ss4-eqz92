// ajustes.js — tema, backup do progresso e informações do banco carregado.
import * as ui from './ui.js';
import * as storage from './storage.js';

const { esc, num } = ui;
let el = null;

export async function renderizar(raiz) {
  el = raiz;
  desenhar();
  el.addEventListener('click', onClique);
  el.addEventListener('change', onMudar);
}

export function sair() { el = null; }

function desenhar() {
  const { estado } = ui;
  const st = storage.statusArmazenamento();
  const p = estado.progresso;
  const tema = estado.prefs.tema || 'auto';

  el.innerHTML = `
    ${ui.cabecalhoHTML('Ajustes')}

    <section class="cartao">
      <div class="cartao-cabeca"><h2>Aparência</h2></div>
      <div class="segmento" role="group" aria-label="Tema">
        ${[['auto', 'Automático'], ['claro', 'Claro'], ['escuro', 'Escuro']].map(([v, r]) =>
          `<button type="button" data-a="tema" data-valor="${v}" aria-pressed="${tema === v}">${r}</button>`).join('')}
      </div>
    </section>

    <section class="cartao">
      <div class="cartao-cabeca"><h2>Seu progresso</h2></div>
      <div class="grade grade-4">
        ${ui.kpiHTML('Questões respondidas', num(Object.keys(p.respostas).length))}
        ${ui.kpiHTML('Favoritas', num(Object.keys(p.favoritos).length))}
        ${ui.kpiHTML('Anotações', num(Object.keys(p.anotacoes).length))}
        ${ui.kpiHTML('Cadernos', num((p.cadernos || []).length))}
      </div>
      <p class="caderno-meta" style="margin-top:12px">
        Gravação: ${st.persistente ? 'no armazenamento local deste navegador' : `<b style="color:var(--vermelho)">só na memória (${esc(st.erro || 'bloqueado')})</b>`}
        · última gravação em ${ui.fmtData(p.atualizadoEm, true)}
      </p>
      <div class="caderno-acoes" style="margin-top:12px">
        <button type="button" class="btn btn-primario" data-a="exportar">Baixar backup (.json)</button>
        <label class="btn" for="arq-import">Importar backup…</label>
        <input id="arq-import" type="file" accept="application/json,.json" class="sr">
        <button type="button" class="btn btn-perigo" data-a="zerar">Apagar todo o progresso</button>
      </div>
      <p class="caderno-meta">O backup guarda respostas, favoritas, anotações, cadernos e provas — não guarda as questões.</p>
    </section>

    <section class="cartao">
      <div class="cartao-cabeca"><h2>Banco carregado</h2></div>
      <p class="caderno-meta">Gerado em ${ui.fmtData(Date.parse(estado.meta.geradoEm), true)} a partir de ${esc((estado.meta.arquivos || []).join(', ') || '—')}.</p>
      <div class="rolagem-x"><table class="tabela">
        <thead><tr><th>Prova</th><th>Cadernos</th><th class="num">Questões</th></tr></thead>
        <tbody>${estado.meta.provas.map((pr) => `<tr>
          <td>${esc(pr.banca)} ${esc(pr.ciclo || pr.ano)} · ${esc(pr.prova)}</td>
          <td>${esc((pr.cadernos || []).join(', '))}</td>
          <td class="num">${num(pr.total)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="caderno-meta" style="margin-top:10px">
        ${num(estado.meta.total)} questões · ${num(estado.meta.comImagem)} com imagem · ${num(estado.meta.anuladas)} anuladas.
        Para atualizar, rode <code>npm run dados</code> na pasta <code>app/</code>.
      </p>
    </section>

    <section class="cartao">
      <div class="cartao-cabeca"><h2>Atalhos de teclado</h2></div>
      <table class="tabela">
        <tbody>
          <tr><td><b>A</b> a <b>E</b></td><td>marca a alternativa</td></tr>
          <tr><td><b>Enter</b></td><td>responde / vai para a próxima</td></tr>
          <tr><td><b>←</b> <b>→</b></td><td>questão anterior / seguinte</td></tr>
          <tr><td>toque longo (ou o botão ⊘)</td><td>risca uma alternativa</td></tr>
        </tbody>
      </table>
    </section>`;
}

async function onClique(e) {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  const acao = b.dataset.a;

  if (acao === 'tema') {
    await storage.salvarPreferencias({ tema: b.dataset.valor });
    await ui.sincronizarProgresso();
    document.body.classList.toggle('escuro',
      b.dataset.valor === 'escuro' || (b.dataset.valor === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches));
    desenhar();
  } else if (acao === 'exportar') {
    const json = await storage.exportar();
    const nome = `backup-banco-questoes-${new Date().toISOString().slice(0, 10)}.json`;
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = nome; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    ui.toast('Backup baixado.', 'ok');
  } else if (acao === 'zerar') {
    const ok = await ui.confirmar('Apagar respostas, favoritas, anotações, cadernos e provas? Não dá para desfazer.',
      { titulo: 'Apagar tudo', ok: 'Apagar tudo', perigo: true });
    if (!ok) return;
    await storage.importar(JSON.stringify(storage.progressoVazio()), { modo: 'substituir' });
    await ui.sincronizarProgresso();
    desenhar();
    ui.toast('Progresso apagado.', 'aviso');
  }
}

async function onMudar(e) {
  if (e.target.id !== 'arq-import') return;
  const arq = e.target.files && e.target.files[0];
  if (!arq) return;
  const texto = await arq.text();
  const modo = await ui.modal({
    titulo: 'Importar backup',
    corpo: `<p>Como você quer trazer <b>${esc(arq.name)}</b>?</p>
      <p class="caderno-meta">Mesclar mantém o que já existe e soma o que vier do arquivo.
      Substituir apaga o progresso atual.</p>`,
    botoes: [
      { rotulo: 'Cancelar', valor: null },
      { rotulo: 'Substituir', valor: 'substituir', classe: 'btn-perigo' },
      { rotulo: 'Mesclar', valor: 'mesclar', classe: 'btn-primario' },
    ],
  });
  e.target.value = '';
  if (!modo) return;
  try {
    const r = await storage.importar(texto, { modo });
    await ui.sincronizarProgresso();
    desenhar();
    ui.toast(`Importado: ${r.respostas} questões, ${r.cadernos} cadernos.`, 'ok', 4000);
  } catch (err) {
    ui.toast(String(err && err.message || err), 'erro', 5000);
  }
}
