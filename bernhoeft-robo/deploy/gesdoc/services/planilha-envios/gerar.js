// Planilha "USO INTENSIVO ASSISTIDO" (pedido do Sr. Marcelo, 29/10): cada tentativa de envio do dia, com o resultado e a
// atitude a tomar. Colunas: A) DATA  B) FATO-DOC #  C) RESULTADO  D) ATITUDE. Um arquivo por dia.
// Só lê: o envios.log dos dois robôs (toda tentativa fica lá), o resultados.json (o resultado do envio manual do Atlas
// só fica nele) e o pendencias.json (situação de hoje no portal). Não toca em portal, Neon nem painel. Sem CPF e sem nome.
// Uso: node gerar.js [AAAA-MM-DD ...]   (sem data = ontem, horário de Brasília; o cron roda às 00:00)
//      node gerar.js --desde AAAA-MM-DD  (um arquivo por dia, da data até ontem)
// Variáveis: DADOS (padrão /dados = /opt/gesdoc/data/hml), SAIDA (padrão /saida).
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const DADOS = process.env.DADOS || '/dados';
const SAIDA = process.env.SAIDA || '/saida';
const FUSO = 'America/Sao_Paulo';
const COR = 'FF0B4F6C';
const lerJson = (arq) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return null; } };
const lerTexto = (arq) => { try { return fs.readFileSync(arq, 'utf8'); } catch { return ''; } };

// Data e hora de Brasília a partir do ISO (UTC) do log.
const partes = (iso) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  .formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
const diaDe = (iso) => { const p = partes(iso); return `${p.year}-${p.month}-${p.day}`; };
const horaDe = (iso) => { const p = partes(iso); return `${p.hour}:${p.minute}:${p.second}`; };
const ontem = () => diaDe(new Date(Date.now() - 86400000).toISOString());
const br = (dia) => dia.split('-').reverse().join('/');
const proximoDia = (dia) => { const d = new Date(dia + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

const linhasLog = (arq) => lerTexto(arq).split('\n').map((l) => l.match(/^\[([^\]]+)\] (.*)$/)).filter(Boolean).map((m) => ({ em: m[1], txt: m[2] }));
const STATUS_ATLAS = {
  ToValidate: 'aguardando validação', WaitingForPredecessors: 'aguardando os documentos anteriores do grupo',
  Delay: 'atrasado (sem arquivo)', DelayRejected: 'reprovado (atrasado)', Rejected: 'reprovado', Pending: 'pendente',
  PendingNotSent: 'pendente', Approved: 'aprovado', Validated: 'aprovado',
};
const statusAtlas = (s) => STATUS_ATLAS[s] ? `${STATUS_ATLAS[s]} (${s})` : (s || '?');

// Resultado, atitude e o porquê de um erro, pelo texto que o robô gravou.
// O enviar.js segura sozinho a pendência recusada com 22006 desde a publicação de 28/10 às 14:12 (Brasília).
const SEGURA_22006 = '2026-10-28T17:12:00Z';
function lerErro(msg, portal, em) {
  const m = String(msg || '');
  const r = (resultado, atitude, porque) => ({ resultado, atitude, porque });
  if (/22006|já importado/i.test(m)) {
    const segurou = !em || em >= SEGURA_22006;
    return r(`Recusado: o portal diz "Documento já importado" (o item ainda tem o arquivo reprovado).${segurou ? ' A pendência foi segurada sozinha.' : ''}`,
      `Excluir no ${portal} o arquivo reprovado desse item${segurou ? ' e depois clicar em "Soltar" no painel (aba 6)' : ' antes de enviar de novo'}.`,
      `O item no ${portal} ainda guarda o arquivo que foi reprovado, e o portal não aceita outro enquanto ele não for excluído (erro 22006).`);
  }
  if (/81005|termo/i.test(m)) return r('Recusado: o portal pede o aceite de um termo antes do envio.', 'Uma pessoa abre o item no portal, lê e aceita o termo e envia pela tela.',
    'O portal exige que uma pessoa aceite um termo antes de receber o arquivo (erro 81005); o robô não aceita termos.');
  if (/bloqueado no painel/i.test(m)) return r('Não enviado: o envio estava bloqueado no painel.', 'Nenhuma, se o bloqueio foi de propósito. Só quem decide liga o "Envio liberado".',
    'O interruptor "Envio liberado" do painel estava desligado.');
  if (/NÃO ENVIEI|não está pronta/i.test(m)) {
    const motivo = m.replace(/^.*?(NÃO ENVIEI|não está pronta):?\s*/i, '').slice(0, 300);
    let atitude = 'Abrir o item no portal e resolver o motivo ao lado antes de soltar de novo.';
    if (/nome no Atlas/i.test(motivo)) atitude = 'Conferir se o documento do Neon é mesmo o deste item do Atlas (regra do tipo de documento).';
    else if (/sem arquivo/i.test(motivo)) atitude = 'Achar o arquivo (Factorial/SharePoint) ou montar o PDF; o robô tenta de novo na próxima rodada.';
    else if (/formato/i.test(motivo)) atitude = 'Converter o arquivo para o formato aceito pelo portal.';
    else if (/status|ação no portal|reprovad/i.test(motivo)) atitude = 'Abrir o item no portal: ler o motivo, excluir o arquivo antigo se houver e soltar no painel.';
    return r(`Não enviado pelo robô: ${motivo}`, atitude, `A conferência antes do envio barrou: ${motivo}`);
  }
  if (/HTTP (401|403)|sess[aã]o|login/i.test(m)) return r(`Falhou: sessão do portal caída (${m.slice(0, 160)}).`, 'Entrar de novo no portal (código do Atlas no painel, aba Operação); o robô tenta de novo depois.',
    'A sessão do robô no portal tinha expirado e ele precisa de um novo login.');
  if (/HTTP 5\d\d|timeout|ECONN|fetch failed/i.test(m)) return r(`Falhou: o portal não respondeu (${m.slice(0, 160)}).`, 'Nada a fazer agora: o robô tenta de novo na próxima rodada. Se repetir o dia todo, avisar o suporte do portal.',
    'O portal ficou fora do ar ou demorou demais para responder.');
  return r(`Falhou: ${m.slice(0, 300)}`, 'Ler o erro, abrir o item no portal e conferir se o arquivo entrou antes de reenviar.',
    `Erro não previsto, devolvido pelo portal ou pelo robô: ${m.slice(0, 200)}`);
}

// ---------- Atlas ----------
const dataBr = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? br(String(s).slice(0, 10)) : (s || ''));
const ENVIADO_ATLAS = (st) => ({
  resultado: `ENVIADO. Situação no Atlas logo depois: ${statusAtlas(st)}.`,
  atitude: st === 'WaitingForPredecessors'
    ? 'Nenhuma agora: o Atlas só valida depois que os documentos anteriores do mesmo grupo forem aprovados. Acompanhar.'
    : 'Nenhuma agora: aguardar a validação do Atlas e olhar de novo amanhã.',
});
function tentativasAtlas(dia) {
  const base = path.join(DADOS, 'pendencias-atlas');
  const log = linhasLog(path.join(base, 'envios.log'));
  const res = lerJson(path.join(base, 'envio', 'resultados.json')) || {};
  const hist = [].concat(lerJson(path.join(base, 'envio', 'historico-envios.json')) || []);
  const coleta = lerJson(path.join(base, 'pendencias.json'));
  const porSchedule = new Map((coleta?.pendencias || []).map((p) => [p.document_schedule_id, p]));
  const porId = new Map(hist.map((h) => [String(h.id), h]));
  const saida = [];
  const abertas = new Map(); // id -> tentativa que conferiu no Atlas e ainda não tem desfecho no log
  const fechar = (t, r, em) => { Object.assign(t, r); if (em) t.fim = em; abertas.delete(t.id); };
  for (const l of log) {
    let m;
    if ((m = l.txt.match(/^#(\d+) schedule (\S+): Atlas "([^"]*)" status (\S+)/))) {
      const ant = abertas.get(m[1]);
      if (ant) desfechoPeloResultado(ant);
      const t = { portal: 'Atlas', em: l.em, id: m[1], schedule: m[2], nome: m[3], status_antes: m[4], auto: false };
      abertas.set(m[1], t);
      saida.push(t);
    } else if ((m = l.txt.match(/^#(\d+) ENVIADO ao schedule \S+; status no Atlas agora: (\S+)/))) {
      const t = abertas.get(m[1]);
      if (t) fechar(t, ENVIADO_ATLAS(m[2]), l.em);
    } else if ((m = l.txt.match(/^Envio automático (PULOU|PAROU em) #(\d+)(?: e seguiu)?: (.*)$/))) {
      let t = abertas.get(m[2]);
      if (!t) { t = { portal: 'Atlas', em: l.em, id: m[2], auto: true }; saida.push(t); }
      t.auto = true;
      fechar(t, lerErro(m[3], 'Atlas', l.em), l.em);
    } else if ((m = l.txt.match(/^Envio automático PAROU antes de #(\d+): (.*)$/))) {
      const t = { portal: 'Atlas', em: l.em, id: m[1], auto: true };
      saida.push(t);
      fechar(t, lerErro(m[2], 'Atlas', l.em), l.em);
    }
  }
  // Conferência sem desfecho no log: o "Verificar" do painel grava a mesma linha e não é envio (sai da lista). O envio
  // manual com erro só grava no resultados.json, que guarda a última ação: vale se for "enviar" até 5 min depois.
  function desfechoPeloResultado(t) {
    const r = res[t.id];
    const dt = r ? new Date(r.em) - new Date(t.em) : -1;
    if (r && r.acao === 'enviar' && dt >= 0 && dt < 5 * 60000) {
      fechar(t, r.ok ? ENVIADO_ATLAS(r.status_atlas) : lerErro(r.msg, 'Atlas', r.em));
    } else { t.verificacao = true; abertas.delete(t.id); }
  }
  for (const t of [...abertas.values()]) desfechoPeloResultado(t);
  saida.splice(0, saida.length, ...saida.filter((t) => !t.verificacao));
  for (const t of saida) {
    const p = porSchedule.get(t.schedule || res[t.id]?.schedule_id || porId.get(t.id)?.schedule_id);
    const h = porId.get(t.id);
    t.chave = `Atlas#${t.id}`;
    t.documento = t.nome || p?.documento || h?.nome || '';
    t.competencia = p?.competencia || h?.competencia || '';
    t.unidade = (p?.unidades || '').split(/[;,]/)[0].trim();
    t.hoje = p ? `${p.aba}${p.status ? ' / ' + statusAtlas(p.status) : ''}` : '';
    t.motivo_rep = p?.motivo_reprovacao || '';
    // O que o robô leu da pendência (última leitura do portal) e, na tentativa, o que o Atlas mostrava antes de enviar.
    t.destino = ['Atlas', t.unidade, t.competencia && `competência ${t.competencia}`, p?.pedido && `pedido ${p.pedido}`,
      p?.prazo_envio && `prazo ${dataBr(p.prazo_envio)}`].filter(Boolean).join(' · ');
    t.leitura = p ? [
      `Leitura do portal (${coleta.coletado_em ? `${br(diaDe(coleta.coletado_em))} ${horaDe(coleta.coletado_em).slice(0, 5)}` : 'última'}): aba "${p.aba}", situação ${statusAtlas(p.status)}.`,
      p.enviado_em && `Último arquivo enviado em ${dataBr(p.enviado_em)}${p.validado_em ? `, avaliado em ${dataBr(p.validado_em)}` : ''}.`,
      p.motivo_reprovacao && `Motivo da reprovação escrito no Atlas: "${p.motivo_reprovacao}".`,
    ].filter(Boolean) : ['A pendência não aparece mais na última leitura do Atlas.'];
    t.conferencia = t.status_antes ? `o Atlas mostrava "${t.nome}" com situação ${statusAtlas(t.status_antes)}.` : '';
  }
  return saida.filter((t) => diaDe(t.em) === dia);
}

// ---------- Bernhoeft ----------
const SEM_DESFECHO = {
  resultado: 'Sem resposta registrada: o robô começou o envio e não gravou o desfecho.',
  atitude: 'Abrir o documento no Bernhoeft (Etapa 6) e ver se o arquivo entrou ANTES de mandar de novo.',
  porque: 'O robô parou (ou caiu) no meio do envio, antes de gravar se o portal aceitou.',
};
function tentativasBern(dia) {
  const base = path.join(DADOS, 'pendencias-bernhoeft');
  const log = linhasLog(path.join(base, 'envios.log'));
  const saida = [];
  let aberta = null;
  const nova = (t) => { saida.push(t); return t; };
  for (const l of log) {
    let m;
    if ((m = l.txt.match(/^(?:ENVIANDO|AUTOMÁTICO:) (.+?) · "([^"]*)"(?: \(([^)]*)\))?/))) {
      if (aberta && !aberta.resultado) Object.assign(aberta, SEM_DESFECHO);
      aberta = nova({ portal: 'Bernhoeft', em: l.em, contrato: m[1], documento: m[2], detalhe: m[3] || '', auto: l.txt.startsWith('AUTOMÁTICO') });
    } else if ((m = l.txt.match(/^ENVIADO(?: \(automático\))? (.+?) · "([^"]*)" → (.*)$/))) {
      const t = aberta && aberta.documento === m[2] && !aberta.resultado ? aberta : nova({ portal: 'Bernhoeft', em: l.em, contrato: m[1], documento: m[2] });
      Object.assign(t, { resultado: `ENVIADO. Situação no Bernhoeft logo depois: ${m[3]}.`, atitude: 'Nenhuma agora: aguardar a análise da Bernhoeft.' });
    } else if ((m = l.txt.match(/^(?:NÃO ENVIADO|AUTOMÁTICO PULOU) \(([^)]*)\)(?: e seguiu)?: (.*)$/))) {
      const t = aberta && !aberta.resultado ? aberta : nova({ portal: 'Bernhoeft', em: l.em, documento: m[1].split('|')[4] || m[1], contrato: m[1].split('|')[0].replace(/^doc:/, '') });
      Object.assign(t, lerErro(m[2], 'Bernhoeft'));
    } else if ((m = l.txt.match(/^AUTOMÁTICO PAROU: (.*)$/))) {
      const t = aberta && !aberta.resultado ? aberta : nova({ portal: 'Bernhoeft', em: l.em, documento: '(rodada automática)' });
      Object.assign(t, lerErro(m[1], 'Bernhoeft'));
    }
  }
  if (aberta && !aberta.resultado) Object.assign(aberta, SEM_DESFECHO);
  const coleta = lerJson(path.join(base, 'pendencias.json'));
  for (const t of saida) {
    const p = (coleta?.itens || []).find((i) => i.contrato === t.contrato && i.descricao === t.documento);
    t.chave = `Bernhoeft|${t.contrato || ''}|${t.documento}`;
    t.hoje = p?.status || '';
    t.destino = ['Bernhoeft', t.contrato && `contrato ${t.contrato}`, p?.area, p?.unidade, p?.competencia].filter(Boolean).join(' · ');
    t.leitura = p ? [
      `Leitura do portal (${coleta.coletado_em ? `${br(diaDe(coleta.coletado_em))} ${horaDe(coleta.coletado_em).slice(0, 5)}` : 'última'}): situação "${p.status}"${p.risco ? `, risco ${p.risco}` : ''}.`,
      'A situação vem do relatório 012 mais recente do portal, que pode estar atrasado em relação à tela.',
    ] : ['O documento não aparece na última leitura do Bernhoeft.'];
    const kb = (t.detalhe || '').match(/(\d+) KB/);
    t.conferencia = t.detalhe ? `achou o documento na Etapa 6 do contrato${kb ? ` e anexou um PDF de ${kb[1]} KB` : ''}.` : '';
  }
  return saida.filter((t) => diaDe(t.em) === dia);
}

// ---------- planilha ----------
const quem = (t) => (t.auto ? 'envio automático' : 'envio pelo painel');
function fatoDoc(t) {
  if (t.portal === 'Atlas') {
    const extra = [t.competencia && `competência ${t.competencia}`, t.unidade].filter(Boolean).join(' · ');
    return `Atlas · DOC #${t.id} · ${t.documento || '(documento não identificado)'}${extra ? ' · ' + extra : ''} (${quem(t)})`;
  }
  return `Bernhoeft · contrato ${t.contrato || '?'} · ${t.documento} (${quem(t)})`;
}
const titulo = (t) => (t.portal === 'Atlas' ? `Atlas · DOC #${t.id} · ${t.documento || '(documento não identificado)'}` : `Bernhoeft · contrato ${t.contrato || '?'} · ${t.documento}`);
const ok = (t) => /^ENVIADO/.test(t.resultado || '');
const unicos = (l) => [...new Set(l.filter(Boolean))];
const horas = (l) => l.map((t) => horaDe(t.em).slice(0, 5)).join(', ');

// Uma pendência = todas as tentativas do dia com a mesma chave (Atlas: id; Bernhoeft: contrato + documento).
function agrupar(lista) {
  const grupos = new Map();
  for (const t of lista) {
    if (!grupos.has(t.chave)) grupos.set(t.chave, []);
    grupos.get(t.chave).push(t);
  }
  return [...grupos.values()];
}

function ficha(g) {
  const ult = g[g.length - 1];
  const certas = g.filter(ok);
  const erradas = g.filter((t) => !ok(t));
  // A mesma conferência repetida em vários horários vira uma linha só, com os horários na frente.
  const porConf = new Map();
  for (const t of g) if (t.conferencia) porConf.set(t.conferencia, [...(porConf.get(t.conferencia) || []), t]);
  const conferencias = [...porConf].map(([txt, ts]) => `${horas(ts)}: ${txt}`);
  const porErro = new Map();
  for (const t of erradas) { const k = t.resultado || '?'; porErro.set(k, [...(porErro.get(k) || []), t]); }
  return [
    ['Documento', ult.documento || '(não identificado)'],
    ['Para onde vai', ult.destino || ult.portal],
    ['O que leu', [...(ult.leitura || []), ...(conferencias.length ? ['Na hora do envio:', ...conferencias] : [])].filter(Boolean).join('\n')],
    ['Tentativas no dia', `${g.length} (${horas(g)}) · ${unicos(g.map(quem)).join(' e ')}`],
    ['O que conseguiu', certas.length ? certas.map((t) => `${horaDe(t.em).slice(0, 5)} · ${t.resultado}`).join('\n') : 'Nada: o portal não aceitou nenhuma tentativa deste documento no dia.'],
    ['O que não conseguiu', erradas.length ? [...porErro].map(([res, ts]) => `${ts.length}× (${horas(ts)}) · ${res}`).join('\n') : 'Nada: todas as tentativas do dia foram aceitas.'],
    ['Por quê', erradas.length ? unicos(erradas.map((t) => t.porque)).join('\n') || '-' : '-'],
    ['Atitude', ult.atitude || '?'],
    ['Hoje no portal', ult.hoje ? `${ult.hoje}${ult.motivo_rep ? `\nMotivo: ${ult.motivo_rep}` : ''}` : 'Não aparece na última leitura do robô.'],
  ];
}

async function gerar(dia) {
  const lista = [...tentativasAtlas(dia), ...tentativasBern(dia)].sort((a, b) => a.em.localeCompare(b.em));
  // Pendências na ordem da 1ª tentativa do dia; dentro de cada uma, as tentativas na ordem do horário.
  const grupos = agrupar(lista);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Automação de Documentos';
  wb.calcProperties.fullCalcOnLoad = true;
  const fonte = { name: 'Arial', size: 10 };
  const branco = { ...fonte, bold: true, color: { argb: 'FFFFFFFF' } };
  const fundo = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const nota = { ...fonte, size: 9, italic: true, color: { argb: 'FF666666' } };
  const ws = wb.addWorksheet('USO INTENSIVO ASSISTIDO', { views: [{ state: 'frozen', ySplit: 3 }] });
  const fs2 = wb.addWorksheet('Fichas', { views: [{ state: 'frozen', ySplit: 2 }] });
  const rs = wb.addWorksheet('Resumo');

  ws.columns = [{ width: 18 }, { width: 70 }, { width: 70 }, { width: 70 }];
  ws.mergeCells('A1:D1');
  ws.getCell('A1').value = `USO INTENSIVO ASSISTIDO · tentativas de envio de ${br(dia)} (Atlas e Bernhoeft)`;
  ws.getCell('A1').font = { ...fonte, size: 13, bold: true, color: { argb: COR } };
  ws.mergeCells('A2:D2');
  ws.getCell('A2').value = `Gerada em ${br(diaDe(new Date().toISOString()))} às ${horaDe(new Date().toISOString()).slice(0, 5)} pelo robô da VPS, a partir do registro de envios dos robôs. Horário de Brasília. Separada por pendência: a linha cinza abre cada uma e leva à ficha dela (aba "Fichas").`;
  ws.getCell('A2').font = nota;
  const cab = ws.getRow(3);
  cab.values = ['DATA', 'FATO-DOC #', 'RESULTADO', 'ATITUDE'];
  cab.eachCell((c) => { c.font = branco; c.fill = fundo(COR); c.alignment = { vertical: 'middle' }; });

  fs2.columns = [{ width: 22 }, { width: 120 }];
  fs2.mergeCells('A1:B1');
  fs2.getCell('A1').value = `Fichas das pendências com tentativa de envio em ${br(dia)}: o que leu, o que conseguiu, o que não conseguiu e por quê`;
  fs2.getCell('A1').font = { ...fonte, size: 13, bold: true, color: { argb: COR } };
  fs2.mergeCells('A2:B2');
  fs2.getCell('A2').value = '"O que leu" = a última leitura do portal feita pelo robô + o que o portal mostrava na hora de cada envio. Sem CPF e sem nome de colaborador.';
  fs2.getCell('A2').font = nota;

  let r = 4;
  let rf = 4;
  if (!grupos.length) {
    ws.getRow(r).values = [br(dia), 'Nenhuma tentativa de envio neste dia.', '-', 'Nenhuma.'];
    ws.getRow(r).eachCell((c) => { c.font = fonte; });
    r++;
    fs2.getCell(`A${rf}`).value = 'Nenhuma pendência teve tentativa de envio neste dia.';
    fs2.getCell(`A${rf}`).font = fonte;
  }
  grupos.forEach((g, i) => {
    const t0 = g[0];
    const nOk = g.filter(ok).length;
    const rotulo = `PENDÊNCIA ${i + 1} de ${grupos.length} · ${titulo(t0)} · ${g.length} tentativa(s), ${nOk} enviada(s)`;
    // Ficha
    fs2.mergeCells(`A${rf}:B${rf}`);
    const cf = fs2.getCell(`A${rf}`);
    cf.value = `FICHA ${i + 1} de ${grupos.length} · ${titulo(t0)}`;
    cf.font = branco;
    cf.fill = fundo(COR);
    const inicioFicha = rf++;
    for (const [rot, val] of ficha(g)) {
      const row = fs2.getRow(rf++);
      row.values = [rot, val];
      row.getCell(1).font = { ...fonte, bold: true };
      row.getCell(2).font = rot === 'O que conseguiu' && nOk ? { ...fonte, color: { argb: 'FF1B6E3A' } }
        : rot === 'O que não conseguiu' && nOk < g.length ? { ...fonte, color: { argb: 'FFB42318' } } : fonte;
      row.eachCell((c) => { c.alignment = { vertical: 'top', wrapText: true }; c.border = { bottom: { style: 'hair', color: { argb: 'FFCCCCCC' } } }; });
    }
    rf++;
    // Cabeçalho da pendência na aba principal, com link para a ficha.
    ws.mergeCells(`A${r}:D${r}`);
    const ch = ws.getCell(`A${r}`);
    ch.value = { text: rotulo, hyperlink: `#'Fichas'!A${inicioFicha}` };
    ch.font = { ...fonte, bold: true, color: { argb: COR }, underline: true };
    ch.fill = fundo('FFE8EEF1');
    r++;
    for (const t of g) {
      const row = ws.getRow(r++);
      const hoje = t.hoje ? `\nHoje no portal: ${t.hoje}${t.motivo_rep ? ` · motivo: ${t.motivo_rep}` : ''}.` : '';
      row.values = [`${br(dia)} ${horaDe(t.em)}`, fatoDoc(t), (t.resultado || '?') + hoje, t.atitude || '?'];
      row.eachCell((c, k) => {
        c.font = k === 3 ? { ...fonte, color: { argb: ok(t) ? 'FF1B6E3A' : 'FFB42318' } } : fonte;
        c.alignment = { vertical: 'top', wrapText: true };
        c.border = { bottom: { style: 'hair', color: { argb: 'FFCCCCCC' } } };
      });
    }
  });
  const ult = Math.max(r - 1, 4);
  ws.autoFilter = { from: 'A3', to: `D${ult}` };

  // Resumo do dia (fórmulas sobre as outras abas).
  rs.columns = [{ width: 44 }, { width: 12 }];
  const A = `'USO INTENSIVO ASSISTIDO'`;
  const linhas = [
    ['Pendências com tentativa no dia', `COUNTIF(Fichas!A4:A${Math.max(rf, 4)},"FICHA*")`],
    ['Tentativas no dia', `COUNTIF(${A}!B4:B${ult},"Atlas*")+COUNTIF(${A}!B4:B${ult},"Bernhoeft*")`],
    ['Enviadas', `COUNTIF(${A}!C4:C${ult},"ENVIADO*")`],
    ['Não enviadas (erro ou recusa)', 'B3-B4'],
    ['No Atlas', `COUNTIF(${A}!B4:B${ult},"Atlas*")`],
    ['No Bernhoeft', `COUNTIF(${A}!B4:B${ult},"Bernhoeft*")`],
    ['Recusadas por "já importado"', `COUNTIF(${A}!C4:C${ult},"*já importado*")`],
  ];
  rs.getRow(1).values = ['Resumo de ' + br(dia), 'Quantidade'];
  rs.getRow(1).eachCell((c) => { c.font = branco; c.fill = fundo(COR); });
  linhas.forEach(([rot, f], i) => { const row = rs.getRow(i + 2); row.getCell(1).value = rot; row.getCell(2).value = { formula: f }; row.eachCell((c) => { c.font = fonte; }); });
  rs.getCell('A10').value = 'Contagem pelas abas "USO INTENSIVO ASSISTIDO" (cada linha de tentativa = 1) e "Fichas" (cada ficha = 1 pendência).';
  rs.getCell('A10').font = nota;

  fs.mkdirSync(SAIDA, { recursive: true });
  const arq = path.join(SAIDA, `uso-intensivo-assistido-${dia}.xlsx`);
  await wb.xlsx.writeFile(arq);
  // O mesmo conteúdo em JSON, para o espelho mostrar a planilha na tela (/planilhas) sem ler o xlsx.
  const nOk = lista.filter(ok).length;
  fs.writeFileSync(arq.replace(/\.xlsx$/, '.json'), JSON.stringify({
    dia,
    gerada_em: new Date().toISOString(),
    resumo: {
      pendencias: grupos.length, tentativas: lista.length, enviadas: nOk, nao_enviadas: lista.length - nOk,
      atlas: lista.filter((t) => t.portal === 'Atlas').length, bernhoeft: lista.filter((t) => t.portal === 'Bernhoeft').length,
      ja_importado: lista.filter((t) => /já importado/.test(t.resultado || '')).length,
    },
    pendencias: grupos.map((g) => ({
      titulo: titulo(g[0]),
      portal: g[0].portal,
      enviadas: g.filter(ok).length,
      tentativas: g.map((t) => ({
        data: `${br(dia)} ${horaDe(t.em)}`, fato_doc: fatoDoc(t), resultado: t.resultado || '?', ok: ok(t), atitude: t.atitude || '?',
        hoje: t.hoje ? `${t.hoje}${t.motivo_rep ? ` · motivo: ${t.motivo_rep}` : ''}` : '',
      })),
      ficha: ficha(g),
    })),
  }, null, 1));
  console.log(`${arq}: ${grupos.length} pendência(s), ${lista.length} tentativa(s), ${lista.filter(ok).length} enviada(s)`);
}

(async () => {
  const args = process.argv.slice(2);
  let dias = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const i = args.indexOf('--desde');
  if (i >= 0) { dias = []; for (let d = args[i + 1], fim = ontem(); d <= fim; d = proximoDia(d)) dias.push(d); }
  if (!dias.length) dias = [ontem()];
  for (const d of dias) await gerar(d);
})().catch((e) => { console.error(e); process.exit(1); });
