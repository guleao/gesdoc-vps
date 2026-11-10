// Passo 3 (10/11): motivos.js grava em documento_eventos o que cada etapa fez (busca, montagem, conferência, trava,
// segurar/soltar) só quando muda, e o motivo + responsável de cada pendência aberta; eventos.js classifica o texto dos robôs
// e grava o protocolo de cada envio (tentativa 1, 2...). Postgres descartável (PGlite) com o esquema do Passo 1 (Neon, 10/11)
// e as permissões do robo_atlas. Rodar: node teste/t-eventos-motivos.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const PGLITE_DIR = process.env.PGLITE_DIR || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Temp', 'gesdoc-teste', 'pglite2');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't-eventos-'));
process.env.ATLAS_OUT = tmp;
fs.mkdirSync(path.join(tmp, 'envio'), { recursive: true });
let ok = 0, falhou = 0;
const t = (cond, msg) => { cond ? ok++ : (falhou++, console.log('FALHOU', msg)); };
const grava = (nome, obj) => fs.writeFileSync(path.join(tmp, nome), JSON.stringify(obj));

(async () => {
  const { PGlite } = await import(pathToFileURL(path.join(PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js')).href);
  const pg = new PGlite();
  await pg.exec(`
    create role robo_atlas;
    create table documento_regras (doc_id int unique not null, ativo boolean default true);
    create table documentos (id serial primary key, doc_id int not null, estado varchar not null, aba varchar, situacao varchar, nome varchar,
      portal varchar, portal_item_id varchar, status_portal varchar, situacao_portal varchar, motivo_reprovacao text, aberto_no_portal boolean,
      visto_no_portal_em timestamptz, motivo varchar, responsavel varchar, motivo_em timestamptz, atualizado_em timestamp);
    create table documento_eventos (id bigserial primary key, documento_id int not null references documentos(id) on delete restrict, em timestamptz not null default now(),
      robo varchar not null, tipo varchar not null, resultado varchar not null, motivo varchar, responsavel varchar, detalhe text, dados jsonb);
    create table documento_protocolos (id serial primary key, documento_id int not null references documentos(id), plataforma varchar not null, protocolo varchar not null unique,
      data_protocolo timestamp, estado_protocolo varchar, resultado_texto text, criado_em timestamp default now(), atualizado_em timestamp default now(),
      tentativa int not null default 1, destino_id int, unique (documento_id, plataforma, tentativa));
    grant select on documentos, documento_regras to robo_atlas;
    grant update (motivo, responsavel, motivo_em) on documentos to robo_atlas;
    grant select, insert on documento_eventos, documento_protocolos to robo_atlas;
    grant usage on sequence documento_eventos_id_seq, documento_protocolos_id_seq to robo_atlas;
    -- 1 pronto | 2 segurado | 3 reprovado c/ arquivo (lista) | 4 pendente: busca não achou | 5 pendente: busca SharePoint ESCE
    -- 6 enviado e ainda aberto | 7 TRCT (sincronização) | 8 cartão de ponto (sem robô) | 9 aguardando assinatura | 10 fechado (Entregues)
    -- 11 REJEITADO sem arquivo novo | 12 achado e unido (montagem)
    insert into documentos (id, doc_id, estado, portal, aberto_no_portal, status_portal, situacao_portal, motivo_reprovacao) values
      (1, 24, 'LOCALIZADO', 'Atlas', true, 'PendingNotSent', 'NO_PRAZO', null),
      (2, 6, 'LOCALIZADO', 'Atlas', true, 'PendingNotSent', 'NO_PRAZO', null),
      (3, 7, 'COMPOSTO', 'Atlas', true, 'DelayRejected', 'REPROVADO', 'Falta a relação'),
      (4, 26, 'PENDENTE_ENVIO', 'Atlas', true, 'PendingNotSent', 'NO_PRAZO', null),
      (5, 25, 'PENDENTE_ENVIO', 'Atlas', true, 'DelayNotSent', 'ATRASADO', null),
      (6, 2, 'ENVIADO', 'Atlas', true, 'PendingNotSent', 'NO_PRAZO', null),
      (7, 9, 'PENDENTE_ENVIO', 'Atlas', true, 'DelayNotSent', 'ATRASADO', null),
      (8, 83, 'PENDENTE_ENVIO', 'Atlas', true, 'PendingNotSent', 'NO_PRAZO', null),
      (9, 9, 'AGUARDANDO_ASSINATURA', 'Atlas', true, 'DelayNotSent', 'ATRASADO', null),
      (10, 24, 'ENVIADO', 'Atlas', false, 'Approved', 'APROVADO', null),
      (11, 67, 'REJEITADO', 'Atlas', true, 'DelayRejected', 'REPROVADO', 'ASO sem assinatura do médico'),
      (12, 4, 'COMPOSTO', null, true, 'PendingNotSent', 'NO_PRAZO', null);
  `);
  const sql = {
    query: (text, params = []) => ({ text, params, then: (a, b) => pg.query(text, params).then((r) => r.rows).then(a, b) }),
    transaction: async (qs) => { await pg.exec('begin'); try { const out = []; for (const q of qs) out.push((await pg.query(q.text, q.params)).rows); await pg.exec('commit'); return out; } catch (e) { await pg.exec('rollback'); throw e; } },
  };
  await pg.exec('set role robo_atlas');
  const { classificar, gravarProtocolo, protocoloDaResposta } = require(path.join(__dirname, '..', 'atlas-robo', 'eventos'));
  const { consolidar } = require(path.join(__dirname, '..', 'atlas-robo', 'motivos'));
  const q = async (s) => (await pg.query(s)).rows;

  // classificar: textos reais dos robôs
  const c = (txt, tipo) => classificar(txt, tipo).motivo;
  t(c('não há pasta 2026 no 20102080') === 'falta_arquivo', 'pasta que não existe = falta_arquivo');
  t(c('ESCE é de outro projeto (EDP), não é Equatorial (Milena, 06/11)') === 'fora_do_escopo', 'ESCE = fora_do_escopo');
  t(c('Empregado ativo na Factorial: pendência de rescisão indevida no Atlas') === 'pendencia_indevida', 'empregado ativo = pendencia_indevida');
  t(c('2 convenções possíveis para CEA em 2024 (...): alguém escolhe') === 'definicao_pendente', 'duas convenções = definicao_pendente');
  t(c('precisa de ação no portal: reprovada no Atlas (DelayRejected); excluir o arquivo antigo no portal antes de reenviar', 'trava') === 'reprovado_portal', 'reprovada = reprovado_portal');
  t(c('segurada no painel: 1ª montagem pelo caminho novo', 'trava') === 'segurado', 'segurada = segurado');
  t(c('conteúdo: o CPF do PDF é de outra pessoa', 'conferencia') === 'arquivo_errado', 'conteúdo = arquivo_errado');
  t(c('Atlas recusou o envio: HTTP 500', 'envio') === 'erro_envio', 'HTTP 500 no envio = erro_envio');
  t(c('Graph: fetch failed', 'busca') === 'erro_busca', 'fetch failed na busca = erro_busca');
  t(classificar('não há pasta 2026').responsavel === 'cliente' && classificar('x', 'envio').responsavel === 'sistema', 'responsável vem do código');

  // Saídas de uma rodada
  grava('enviar-simulacao.json', { itens: [
    { id: 1, pronta: true, motivos: [] },
    { id: 2, pronta: false, segurada: true, motivos: ['segurada no painel: 1ª montagem pelo caminho novo (declaração do VR gerada do modelo): conferir o PDF na ficha e soltar'] },
    { id: 3, pronta: false, acao_portal: true, status_atlas: 'DelayRejected', motivos: ['precisa de ação no portal: reprovada no Atlas (DelayRejected); excluir o arquivo antigo no portal antes de reenviar'] },
    { id: 12, pronta: true, motivos: [] },
  ] });
  grava('envio/segurar.json', { 2: { motivo: '1ª montagem pelo caminho novo', em: '2026-11-09T19:30:00Z', auto: true } });
  grava('envio/busca.json', { em: '2026-11-10T20:00:00Z', itens: [{ id: 9, doc_id: 9, achou: false, motivo: 'Termo de quitação sem assinatura' }] });
  grava('envio/busca-sharepoint.json', { em: '2026-11-10T20:01:00Z', modo: 'gravar', itens: [
    { id: 4, doc_id: 26, achou: false, motivo: 'não há pasta 2026 no 20102080' },
    { id: 5, doc_id: 25, achou: false, motivo: 'ESCE é de outro projeto (EDP), não é Equatorial (Milena, 06/11): fora da automação da Equatorial' },
    { id: 12, doc_id: 4, achou: true, unido: true, pasta: '02 - Benefícios/Seguro', partes: [{}, {}, {}] },
  ] });

  const r1 = await consolidar({ sql });
  const d = Object.fromEntries((await q('select id, motivo, responsavel, motivo_em from documentos order by id')).map((x) => [x.id, x]));
  const esp = { 1: ['pronto', 'sistema'], 2: ['segurado', 'operacao'], 3: ['reprovado_portal', 'operacao'], 4: ['falta_arquivo', 'cliente'], 5: ['fora_do_escopo', 'cliente'],
    6: ['enviado_aguardando', 'operacao'], 7: ['aguardando_sincronizacao', 'sistema'], 8: ['sem_robo', 'sistema'], 9: ['aguardando_assinatura', 'cliente'],
    11: ['reprovado_portal', 'operacao'], 12: ['pronto', 'sistema'] };
  for (const [id, [m, r]] of Object.entries(esp)) t(d[id].motivo === m && d[id].responsavel === r, `#${id}: ${m}/${r} (deu ${d[id].motivo}/${d[id].responsavel})`);
  t(d[10].motivo == null, '#10 fechado no portal: sem motivo');
  const ev = await q('select documento_id, robo, tipo, resultado, motivo from documento_eventos order by id');
  const tem = (id, robo, tipo, res) => ev.some((e) => e.documento_id === id && e.robo === robo && e.tipo === tipo && e.resultado === res);
  t(tem(1, 'enviar', 'conferencia', 'ok') && tem(2, 'enviar', 'trava', 'bloqueado') && tem(3, 'enviar', 'trava', 'bloqueado'), 'eventos da lista (conferência/trava)');
  t(tem(4, 'sharepoint', 'busca', 'falha') && tem(9, 'factorial', 'busca', 'falha') && tem(12, 'sharepoint', 'busca', 'ok') && tem(12, 'sharepoint', 'montagem', 'ok'), 'eventos da busca e da montagem');
  t(!ev.some((e) => e.tipo === 'segurar'), '1ª rodada: sem histórico do segurar.json, não inventa "segurar"');
  const n1 = ev.length;

  // 2ª rodada igual: nada novo; motivo_em não muda
  const m1 = (await q('select motivo_em from documentos where id = 4'))[0].motivo_em;
  await consolidar({ sql });
  t((await q('select count(*)::int n from documento_eventos'))[0].n === n1, 'rodada igual não grava eventos repetidos');
  t(String((await q('select motivo_em from documentos where id = 4'))[0].motivo_em) === String(m1), 'motivo igual não regrava motivo_em');

  // 3ª rodada: #2 solto no painel e virou pronto; #1 segurado à mão; #4 agora achado
  grava('envio/segurar.json', { 1: { motivo: 'conferir competência', em: '2026-11-10T21:00:00Z' } });
  grava('enviar-simulacao.json', { itens: [
    { id: 1, pronta: false, segurada: true, motivos: ['segurada no painel: conferir competência'] },
    { id: 2, pronta: true, motivos: [] },
    { id: 3, pronta: false, acao_portal: true, motivos: ['precisa de ação no portal: reprovada no Atlas (DelayRejected)'] },
  ] });
  await consolidar({ sql });
  const ev3 = await q(`select documento_id, robo, tipo, resultado from documento_eventos where id > ${n1} order by id`);
  t(ev3.some((e) => e.documento_id === 2 && e.robo === 'painel' && e.tipo === 'soltar'), 'soltar no painel vira evento');
  t(ev3.some((e) => e.documento_id === 1 && e.robo === 'painel' && e.tipo === 'segurar'), 'segurar no painel vira evento');
  t(ev3.some((e) => e.documento_id === 2 && e.tipo === 'conferencia' && e.resultado === 'ok'), '#2 solto: conferência ok');
  t((await q('select motivo from documentos where id = 2'))[0].motivo === 'pronto' && (await q('select motivo from documentos where id = 1'))[0].motivo === 'segurado', 'motivos atualizados');

  // Protocolo: tentativa 1 e 2 do mesmo documento; id do portal quando vem na resposta
  t(protocoloDaResposta('{"data":{"id":"abc-123"}}') === 'abc-123' && protocoloDaResposta('ok') === null, 'id do portal na resposta');
  await gravarProtocolo(sql, { documento_id: 6, protocolo: 'abc-123', local: 'sch-6', estado: 'ToValidate', texto: '{"data":{"id":"abc-123"}}' });
  await gravarProtocolo(sql, { documento_id: 6, protocolo: null, local: 'sch-6', estado: 'ToValidate' });
  const pr = await q('select tentativa, protocolo from documento_protocolos where documento_id = 6 order by tentativa');
  t(pr.length === 2 && pr[0].tentativa === 1 && pr[1].tentativa === 2 && /^Atlas:sch-6:/.test(pr[1].protocolo), 'protocolos 1:N (tentativa 1 e 2)');

  // Simulação não grava
  const antes = (await q('select count(*)::int n from documento_eventos'))[0].n;
  grava('envio/busca.json', { em: '2026-11-10T22:00:00Z', itens: [{ id: 9, achou: false, motivo: 'outro motivo qualquer' }] });
  await consolidar({ sql, simular: true });
  t((await q('select count(*)::int n from documento_eventos'))[0].n === antes, 'simulação não grava');

  console.log(`${ok} ok, ${falhou} falhou`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exitCode = falhou ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
