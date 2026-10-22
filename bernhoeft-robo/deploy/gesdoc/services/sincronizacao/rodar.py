"""
Sincronização Factorial do Evilásio (sincronizacao_factorial.py, repo evilasioferreira/gestao-documental-equatorial) na VPS,
sem alterar o código dele: este arquivo só escolhe a conexão, filtra os tipos de documento e, na simulação, segura as gravações.

  python rodar.py                 simula: lê o Neon e a Factorial, baixa e une os PDFs numa pasta temporária (apagada no fim)
                                  e diz o que gravaria. NÃO grava no Neon: conexão read-only e UPDATE/INSERT descartados.
  python rodar.py --gravar        grava de verdade (estado, caminho_origem, alerta, documento_envios) com SINC_DATABASE_URL
                                  (role gesdoc_sync, seguranca/roles.sql); sem ela, recusa. PDFs em /srv/gesdoc/downloads.
  python rodar.py --ids 119,120   só estas pendências (id do Neon).
  python rodar.py --gravar --refazer-de-fora
                                  antes, volta para PENDENTE_ENVIO os COMPOSTO/LOCALIZADO de SINC_DOCS cujo PDF foi feito em outra
                                  máquina (caminho_origem fora de /srv/gesdoc/), para refazer aqui (passo 6.2 do DEPLOY.md dele).

SINC_DOCS (padrão "8,9,10"): só estes doc_id. 67/68/69 são do robô Atlas (factorial.js, regras do discovery v2 da Milena);
83 (cartão de ponto) não tem regra no código do Evilásio e viraria NAO_ENCONTRADO_FACTORIAL "Sem regra".
Relatório sem nome nem CPF em /out/ultima-<simulacao|gravacao>.json (o painel lê de /opt/gesdoc/data/hml/sincronizacao).
"""
import argparse
import fcntl
import json
import os
import shutil
import sys
import tempfile
from collections import Counter
from datetime import datetime
from pathlib import Path

import psycopg2
from pypdf import PdfReader

import factorial_busca as fb
import sincronizacao_factorial as sf

OUT = Path(os.getenv("SINC_OUT", "/out"))
PASTA_REAL = os.getenv("FACTORIAL_PASTA_DOWNLOAD", "/srv/gesdoc/downloads")
DOCS = {int(x) for x in os.getenv("SINC_DOCS", "8,9,10").split(",") if x.strip()}


class CursorSimulado:
    """SELECT vai ao banco; UPDATE/INSERT/WITH só são anotados (fetchone imita o RETURNING do registrar_status)."""

    def __init__(self, cursor, estados, gravacoes):
        self._c, self._estados, self._g = cursor, estados, gravacoes
        self._fingiu, self._retorno = False, None

    def execute(self, sql, params=None):
        palavra = sql.lstrip().split(None, 1)[0].upper()
        self._fingiu, self._retorno = palavra != "SELECT", None
        if palavra == "SELECT":
            return self._c.execute(sql, params)
        if palavra == "WITH":  # registrar_status: (estado, id, estado, tipo_alerta, descricao)
            estado, doc = params[0], params[1]
            mudou = self._estados.get(doc) != estado
            self._g.append({"sql": "estado+alerta", "id": doc, "estado": estado, "alerta_novo": mudou})
            self._retorno = (doc,) if mudou else None
        elif sql.lstrip().upper().startswith("UPDATE DOCUMENTOS"):  # marcar_localizado: (estado, caminho, bytes, hash, id)
            self._g.append({"sql": "localizado", "id": params[4], "estado": params[0], "bytes": params[2]})
        elif "DOCUMENTO_ENVIOS" in sql.upper():
            self._g.append({"sql": "documento_envios", "id": params[0]})
        else:
            raise RuntimeError("gravação não prevista na simulação: " + sql.strip()[:60])

    def fetchone(self):
        return self._retorno if self._fingiu else self._c.fetchone()

    def fetchall(self):
        return self._c.fetchall()

    def close(self):
        self._c.close()


class ConexaoSimulada:
    def __init__(self, conn, estados, gravacoes):
        self._conn, self._estados, self._g = conn, estados, gravacoes

    def cursor(self, *a, **kw):
        return CursorSimulado(self._conn.cursor(*a, **kw), self._estados, self._g)

    def commit(self):
        pass


def ler(conn, sql, params=None):
    cur = conn.cursor()
    cur.execute(sql, params)
    linhas = cur.fetchall()
    cur.close()
    return linhas


def conferir_banco(conn):
    """Passos 6.1 e 6.2 do DEPLOY.md, só leitura."""
    usuario = ler(conn, "select current_user")[0][0]
    roles = [r[0] for r in ler(conn, "select rolname from pg_roles where rolname in ('gesdoc_sync','sinc_factorial')")]
    composicao = {d: c for d, c in ler(conn, "select doc_id, requer_composicao from documento_regras where doc_id = any(%s)", (sorted(DOCS),))}
    fora = ler(conn, """select doc_id, estado, count(*) from documentos
                        where doc_id = any(%s) and estado in ('COMPOSTO','LOCALIZADO')
                          and coalesce(caminho_origem,'') not like '/srv/gesdoc/%%'
                        group by 1, 2 order by 1, 2""", (sorted(DOCS),))
    return {"usuario_banco": usuario, "roles_existentes": roles,
            "requer_composicao": {str(d): composicao.get(d) for d in sorted(DOCS)},
            "prontos_fora_da_vps": [{"doc_id": d, "estado": e, "n": int(n)} for d, e, n in fora]}


def paginas(caminho):
    try:
        return len(PdfReader(caminho).pages)
    except Exception as erro:  # noqa: BLE001
        return "erro: " + str(erro)[:80]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gravar", action="store_true")
    ap.add_argument("--ids", default="")
    ap.add_argument("--refazer-de-fora", action="store_true")
    args = ap.parse_args()
    if args.refazer_de_fora and not args.gravar:
        sys.exit("--refazer-de-fora só com --gravar")
    ids = [int(x) for x in args.ids.split(",") if x.strip()] or None

    api_key = os.getenv("FACTORIAL_API_KEY")
    if not api_key:
        sys.exit("FACTORIAL_API_KEY não configurada")
    if args.gravar:
        url = os.getenv("SINC_DATABASE_URL")
        if not url:
            sys.exit("--gravar precisa de SINC_DATABASE_URL (role gesdoc_sync) no cofre; nada foi feito")
    else:
        url = os.getenv("SINC_DATABASE_URL") or os.getenv("ROBO_DATABASE_URL")
        if not url:
            sys.exit("sem SINC_DATABASE_URL nem ROBO_DATABASE_URL")

    OUT.mkdir(parents=True, exist_ok=True)
    trava = open(OUT / ".trava", "w")
    try:
        fcntl.flock(trava, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        sys.exit("outra sincronização ainda está rodando")

    modo = "gravacao" if args.gravar else "simulacao"
    conn = psycopg2.connect(url)
    if not args.gravar:
        conn.set_session(readonly=True)

    fora_dos_docs, estados, gravacoes = Counter(), {}, []
    original = sf.buscar_pendencias

    def so_os_docs(c, somente_ids=None):
        todas = original(c, somente_ids)
        fora_dos_docs.update(int(p["doc_id"]) for p in todas if int(p["doc_id"]) not in DOCS)
        escolhidas = [p for p in todas if int(p["doc_id"]) in DOCS]
        estados.update({p["id"]: p["estado"] for p in escolhidas})
        return escolhidas

    sf.buscar_pendencias = so_os_docs
    temp = None if args.gravar else tempfile.mkdtemp(prefix="sinc-")
    inicio = datetime.now().isoformat(timespec="seconds")
    try:
        banco = conferir_banco(conn)
        if args.refazer_de_fora:
            cur = conn.cursor()
            cur.execute("""update documentos set estado = 'PENDENTE_ENVIO', atualizado_em = now()
                           where doc_id = any(%s) and estado in ('COMPOSTO', 'LOCALIZADO')
                             and coalesce(caminho_origem, '') not like '/srv/gesdoc/%%' returning id""", (sorted(DOCS),))
            banco["refeitos"] = sorted(r[0] for r in cur.fetchall())
            conn.commit()
            cur.close()
        alvo = conn if args.gravar else ConexaoSimulada(conn, estados, gravacoes)
        resumo = sf.sincronizar(alvo, api_key, PASTA_REAL if args.gravar else temp,
                                base_url=os.getenv("FACTORIAL_API_URL", fb.BASE_URL), somente_ids=ids)
        itens = []
        for i in resumo.get("itens", []):
            item = {k: i.get(k) for k in ("id", "doc_id", "estado", "motivo", "bytes")}
            if i.get("arquivo"):
                item["paginas"] = paginas(i["arquivo"])
                item["arquivo"] = os.path.basename(i["arquivo"]).split("_")[0] if not args.gravar else i["arquivo"]
            itens.append(item)
        relatorio = {
            "modo": modo, "inicio": inicio, "fim": datetime.now().isoformat(timespec="seconds"),
            "docs": sorted(DOCS), "banco": banco, "fluxo_id": resumo["fluxo_id"],
            "pendencias": resumo["pendencias"], "ignoradas_outros_docs": {str(k): v for k, v in sorted(fora_dos_docs.items())},
            "por_doc_estado": {f"{d}:{e}": n for (d, e), n in sorted(Counter((i["doc_id"], i["estado"]) for i in itens).items())},
            "motivos": dict(Counter(i["motivo"] for i in itens if i.get("motivo")).most_common()),
            "alertas_novos": resumo["alertas_novos"],
            "itens": itens,
        }
        if not args.gravar:
            relatorio["gravaria"] = dict(Counter(g["sql"] for g in gravacoes))
    finally:
        conn.close()
        if temp:
            shutil.rmtree(temp, ignore_errors=True)

    (OUT / f"ultima-{modo}.json").write_text(json.dumps(relatorio, ensure_ascii=False, indent=1, default=str))
    print(json.dumps({k: v for k, v in relatorio.items() if k != "itens"}, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main()
