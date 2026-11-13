import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
import requests
from pypdf import PdfReader, PdfWriter

import sincronizacao_factorial as sinc
from sincronizacao_factorial import PASTA_ASO, PASTA_FERIAS, PASTA_OFFBOARDING
from tests.conftest import PREFIXO_TESTE


def doc(id, filename, pasta, criado, assinatura=None, empregado="1"):
    return {"id": id, "filename": filename, "folder_id": pasta, "created_at": criado + "T12:00:00.000Z",
            "signature_status": assinatura, "employee_id": empregado}


ATIVO = {"id": "1", "full_name": "ANA TESTE SILVA", "terminated_on": None}
DESLIGADO = {"id": "1", "full_name": "ANA TESTE SILVA", "terminated_on": "2026-07-20"}
FERIAS = {"doc_id": 8, "competencia": "07/2026"}


# ============================================================================
# REGRAS DE CASAMENTO
# ============================================================================

def test_ferias_completas_saem_na_ordem_aviso_recibo_comprovante():
    docs = [
        doc("c", "ANA TESTE SILVA comprovante.pdf", PASTA_FERIAS, "2026-08-07"),
        doc("r", "Recibo de Férias - ANA TESTE SILVA.pdf", PASTA_FERIAS, "2026-06-16", "completed"),
        doc("a", "Aviso de Férias - ANA TESTE SILVA.pdf", PASTA_FERIAS, "2026-06-01"),
    ]
    resultado = sinc.casar_pendencia(FERIAS, ATIVO, docs)
    assert resultado["estado"] == "LOCALIZADO"
    assert [a["id"] for a in resultado["arquivos"]] == ["a", "r", "c"]
    assert [a["ordem"] for a in resultado["arquivos"]] == [1, 2, 3]


def test_ferias_sem_aviso_nao_e_localizada():
    docs = [
        doc("r", "Recibo de Férias - ANA TESTE SILVA.pdf", PASTA_FERIAS, "2026-06-16", "completed"),
        doc("c", "ANA TESTE SILVA comprovante.pdf", PASTA_FERIAS, "2026-08-07"),
    ]
    resultado = sinc.casar_pendencia(FERIAS, ATIVO, docs)
    assert resultado["estado"] == "NAO_ENCONTRADO_FACTORIAL"
    assert resultado["motivo"] == "Não encontrado na Factorial: Aviso de férias"


def test_recibo_de_ferias_pendente_de_assinatura_aguarda():
    docs = [
        doc("a", "aviso de ferias.pdf", PASTA_FERIAS, "2026-06-01"),
        doc("r", "Recibo de Férias - ANA TESTE SILVA.pdf", PASTA_FERIAS, "2026-07-09", "pending"),
        doc("c", "ANA TESTE SILVA comprovante.pdf", PASTA_FERIAS, "2026-08-07"),
    ]
    assert sinc.casar_pendencia(FERIAS, ATIVO, docs)["estado"] == "AGUARDANDO_ASSINATURA"


def test_recibo_enviado_sem_assinatura_eletronica_conta_como_ok():
    docs = [
        doc("a", "aviso de ferias.pdf", PASTA_FERIAS, "2026-06-01"),
        doc("r", "Recibo de Férias - ANA TESTE SILVA (1).pdf", PASTA_FERIAS, "2026-07-13", None),
        doc("c", "ANA TESTE SILVA comprovante.pdf", PASTA_FERIAS, "2026-08-07"),
    ]
    assert sinc.casar_pendencia(FERIAS, ATIVO, docs)["estado"] == "LOCALIZADO"


def test_ferias_ignora_arquivos_fora_da_janela_da_competencia():
    docs = [
        doc("a", "aviso de ferias.pdf", PASTA_FERIAS, "2026-06-01"),
        doc("r-velho", "Recibo de Férias - ANA TESTE SILVA.pdf", PASTA_FERIAS, "2026-07-02", "completed"),
        doc("r-novo", "Recibo de Férias - ANA TESTE SILVA.pdf", PASTA_FERIAS, "2026-10-05", "completed"),
        doc("c", "ANA TESTE SILVA comprovante.pdf", PASTA_FERIAS, "2026-08-07"),
    ]
    resultado = sinc.casar_pendencia(FERIAS, ATIVO, docs)
    assert [a["id"] for a in resultado["arquivos"]] == ["a", "r-velho", "c"]


def test_trct_com_termo_assinado_e_comprovante():
    docs = [
        doc("t", "TRCT ANA TESTE SILVA.pdf", PASTA_OFFBOARDING, "2026-07-22"),
        doc("q1", "Termo de quitação.pdf", PASTA_OFFBOARDING, "2026-07-22"),
        doc("q2", "TERMO DE QUTAÇÃO ASSINADO .pdf", PASTA_OFFBOARDING, "2026-07-27"),
        doc("cp", "ANA TESTE SILVA.pdf", PASTA_OFFBOARDING, "2026-07-31"),
        doc("f", "FGTS ANA.pdf", PASTA_OFFBOARDING, "2026-07-22"),
    ]
    resultado = sinc.casar_pendencia({"doc_id": 9, "competencia": "07/2026"}, DESLIGADO, docs)
    assert resultado["estado"] == "LOCALIZADO"
    assert [a["id"] for a in resultado["arquivos"]] == ["t", "q2", "cp"]


def test_trct_sem_versao_assinada_aguarda_assinatura():
    docs = [
        doc("r", "Recibo de Rescisão.pdf", PASTA_OFFBOARDING, "2026-08-04"),
        doc("q", "Termo de quitação.pdf", PASTA_OFFBOARDING, "2026-08-04"),
        doc("cp", "ana teste silva  comprovante.pdf", PASTA_OFFBOARDING, "2026-08-13"),
    ]
    resultado = sinc.casar_pendencia({"doc_id": 9, "competencia": "08/2026"}, DESLIGADO, docs)
    assert resultado["estado"] == "AGUARDANDO_ASSINATURA"
    assert "Termo de quitação assinado" in resultado["motivo"]


def test_gfd_exige_guia_e_comprovante_pelo_nome():
    guia = doc("g", "FGTS ANA.pdf", PASTA_OFFBOARDING, "2026-07-22")
    comprovante = doc("c", "comp fgts do ANA TESTE SILVA.pdf", PASTA_OFFBOARDING, "2026-07-25")
    analitico = doc("x", "ANALITICO FGTS.pdf", PASTA_OFFBOARDING, "2026-07-22")
    gfd = {"doc_id": 10, "competencia": "07/2026"}

    completo = sinc.casar_pendencia(gfd, DESLIGADO, [guia, comprovante, analitico])
    assert [a["id"] for a in completo["arquivos"]] == ["g", "c"]

    sem_comprovante = sinc.casar_pendencia(gfd, DESLIGADO, [guia, analitico])
    assert sem_comprovante["motivo"] == "Não encontrado na Factorial: Comprovante de pagamento da GFD rescisória"


def test_aso_demissional_aceita_aso_sem_a_palavra_demissional_no_offboarding():
    docs = [doc("a", "ASO ANA TESTE SILVA - NIP GLOBAL.pdf", PASTA_OFFBOARDING, "2026-07-02")]
    assert sinc.casar_pendencia({"doc_id": 67, "competencia": "07/2026"}, DESLIGADO, docs)["estado"] == "LOCALIZADO"


def test_aso_periodico_antigo_nao_vale_como_demissional():
    docs = [doc("a", "ASO PERIÓDICO ANA.pdf", PASTA_ASO, "2026-05-29")]
    assert sinc.casar_pendencia({"doc_id": 67, "competencia": "07/2026"}, DESLIGADO, docs)["estado"] == "NAO_ENCONTRADO_FACTORIAL"


def test_aviso_previo_prefere_a_versao_assinada():
    docs = [
        doc("p", "Aviso Prévio de Rescisão 160.pdf", PASTA_OFFBOARDING, "2026-07-21", "pending"),
        doc("s", "Aviso_Previo_de_Rescisao_160_assinado.pdf", PASTA_OFFBOARDING, "2026-07-20"),
    ]
    resultado = sinc.casar_pendencia({"doc_id": 69, "competencia": "07/2026"}, DESLIGADO, docs)
    assert resultado["estado"] == "LOCALIZADO"
    assert resultado["arquivos"][0]["id"] == "s"


def test_validacao_factorial_e_a_fonte_da_verdade():
    rescisao, ferias = {"doc_id": 9}, {"doc_id": 8}
    assert sinc.validar_empregado(rescisao, None) == "CPF não encontrado na Factorial"
    assert "ativo na Factorial" in sinc.validar_empregado(rescisao, ATIVO)
    assert sinc.validar_empregado(rescisao, DESLIGADO) is None
    assert sinc.validar_empregado(ferias, ATIVO) is None


# ============================================================================
# INTEGRAÇÃO: Factorial falsa + branch de teste do Neon
# ============================================================================

def _pdf(paginas):
    escritor = PdfWriter()
    for _ in range(paginas):
        escritor.add_blank_page(width=200, height=300)
    saida = BytesIO()
    escritor.write(saida)
    return saida.getvalue()


EMPREGADOS = [
    {"id": "10", "full_name": "ANA TESTE SILVA", "identifier": "111.222.333-44", "terminated_on": "2026-07-20"},
    {"id": "20", "full_name": "BRUNO TESTE", "identifier": "55566677788", "terminated_on": None},
]
DOCUMENTOS = [
    doc("t", "TRCT ANA.pdf", PASTA_OFFBOARDING, "2026-07-22", empregado="10"),
    doc("q", "Termo_de_quitacao_assinado.pdf", PASTA_OFFBOARDING, "2026-07-27", empregado="10"),
    doc("cp", "ANA TESTE SILVA.pdf", PASTA_OFFBOARDING, "2026-07-31", empregado="10"),
    doc("e", "eSocial ANA.pdf", PASTA_OFFBOARDING, "2026-07-22", empregado="10"),
    doc("r", "Recibo de Férias - BRUNO TESTE.pdf", PASTA_FERIAS, "2026-06-16", "completed", empregado="20"),
]
PAGINAS = {"t": 2, "q": 1, "cp": 1, "e": 1, "r": 1}


class FactorialConfiguravel:
    def __init__(self, status=200):
        self.status = status
        self.requisicoes = []
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self.base_url = f"http://127.0.0.1:{self._server.server_address[1]}/api/2026-10-01/resources"
        threading.Thread(target=self._server.serve_forever, daemon=True).start()

    def parar(self):
        self._server.shutdown()
        self._server.server_close()

    def _handler(self):
        falsa = self

        class Handler(BaseHTTPRequestHandler):
            def _enviar(self, status, corpo, tipo="application/json"):
                self.send_response(status)
                self.send_header("Content-Type", tipo)
                self.send_header("Content-Length", str(len(corpo)))
                self.end_headers()
                self.wfile.write(corpo)

            def do_GET(self):
                url = urlparse(self.path)
                query = parse_qs(url.query)
                falsa.requisicoes.append(("GET", url.path, query))
                if "/files/" in url.path:
                    return self._enviar(200, _pdf(PAGINAS[url.path.rsplit("/", 1)[-1]]), "application/pdf")
                if falsa.status != 200:
                    return self._enviar(falsa.status, b'{"errors":null}')
                if url.path.endswith("/employees/employees"):
                    dados = EMPREGADOS
                elif url.path.endswith("/documents/documents"):
                    ids = set(query.get("employee_ids[]", []))
                    dados = [d for d in DOCUMENTOS if d["employee_id"] in ids]
                else:
                    return self._enviar(404, b"{}")
                return self._enviar(200, json.dumps({"data": dados, "meta": {"has_next_page": False}}).encode())

            def do_POST(self):
                corpo = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
                falsa.requisicoes.append(("POST", urlparse(self.path).path, corpo))
                urls = [{"id": i, "url": f"{falsa.base_url}/files/{i}"} for i in corpo["ids"]]
                return self._enviar(200, json.dumps(urls).encode())

            def log_message(self, *args):
                pass

        return Handler


@pytest.fixture
def factorial():
    servidor = FactorialConfiguravel()
    yield servidor
    servidor.parar()


def _inserir_pendencia(conn, doc_id, cpf, competencia, nome, aba="Atrasados", aberto_no_portal=None):
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO documentos (doc_id, colaborador_id, competencia, estado, nome, aba, cpf, funcionario, aberto_no_portal)
        VALUES (%s, 'TESTE', %s, 'PENDENTE_ENVIO', %s, %s, %s, 'FUNCIONARIO TESTE', %s)
        RETURNING id
        """,
        (doc_id, competencia, PREFIXO_TESTE + nome, aba, cpf, aberto_no_portal),
    )
    novo_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    return novo_id


def _linha(conn, documento_id):
    cur = conn.cursor()
    cur.execute("SELECT estado, caminho_origem, tamanho_bytes, hash_arquivo FROM documentos WHERE id = %s", (documento_id,))
    linha = cur.fetchone()
    cur.close()
    return linha


def _contar(conn, tabela, documento_id):
    cur = conn.cursor()
    cur.execute(f"SELECT count(*) FROM {tabela} WHERE documento_id = %s", (documento_id,))
    total = cur.fetchone()[0]
    cur.close()
    return total


def _motivo(conn, documento_id):
    cur = conn.cursor()
    cur.execute("SELECT motivo, responsavel FROM documentos WHERE id = %s", (documento_id,))
    linha = cur.fetchone()
    cur.close()
    return linha


def _severidades(conn, documento_id):
    cur = conn.cursor()
    cur.execute("SELECT severidade FROM alerta WHERE documento_id = %s ORDER BY id", (documento_id,))
    valores = [linha[0] for linha in cur.fetchall()]
    cur.close()
    return valores


@pytest.fixture
def pendencias(conn_teste, limpa_documentos_teste):
    return {
        "trct": _inserir_pendencia(conn_teste, 9, "11122233344", "07/2026", "trct"),
        "esocial": _inserir_pendencia(conn_teste, 68, "11122233344", "07/2026", "esocial"),
        "rescisao_ativo": _inserir_pendencia(conn_teste, 69, "55566677788", "07/2026", "rescisao_ativo"),
        "ferias_sem_aviso": _inserir_pendencia(conn_teste, 8, "55566677788", "07/2026", "ferias"),
        "cpf_inexistente": _inserir_pendencia(conn_teste, 67, "00000000000", "07/2026", "cpf_inexistente"),
    }


def test_sincronizar_unifica_pacote_e_registra_estados(conn_teste, pendencias, factorial, tmp_path):
    resumo = sinc.sincronizar(conn_teste, "chave", str(tmp_path), base_url=factorial.base_url, somente_ids=list(pendencias.values()))

    assert resumo["pendencias"] == 5
    assert resumo["por_estado"] == {"COMPOSTO": 1, "LOCALIZADO": 1, "DIVERGENTE_FACTORIAL": 2, "NAO_ENCONTRADO_FACTORIAL": 1}
    assert resumo["alertas_novos"] == 3

    estado, caminho, tamanho, hash_arquivo = _linha(conn_teste, pendencias["trct"])
    assert estado == "COMPOSTO"
    assert Path(caminho).name == "doc9_07-2026.pdf"  # sem CPF no nome
    assert len(PdfReader(caminho).pages) == 4  # TRCT (2) + termo (1) + comprovante (1)
    assert tamanho == Path(caminho).stat().st_size and len(hash_arquivo) == 64
    assert _contar(conn_teste, "documento_envios", pendencias["trct"]) == 1

    estado, caminho, _, _ = _linha(conn_teste, pendencias["esocial"])
    assert estado == "LOCALIZADO" and Path(caminho).name == "eSocial ANA.pdf"

    assert _linha(conn_teste, pendencias["rescisao_ativo"])[0] == "DIVERGENTE_FACTORIAL"
    assert _linha(conn_teste, pendencias["cpf_inexistente"])[0] == "DIVERGENTE_FACTORIAL"
    assert _linha(conn_teste, pendencias["ferias_sem_aviso"])[0] == "NAO_ENCONTRADO_FACTORIAL"
    assert _contar(conn_teste, "alerta", pendencias["ferias_sem_aviso"]) == 1
    assert _severidades(conn_teste, pendencias["ferias_sem_aviso"]) == ["media"]
    assert _severidades(conn_teste, pendencias["rescisao_ativo"]) == ["alta"]

    # Motivo e responsável para a v_solicitacoes, com um evento por mudança
    assert _motivo(conn_teste, pendencias["ferias_sem_aviso"]) == ("FALTA_ARQUIVO", "CLIENTE")
    assert _motivo(conn_teste, pendencias["rescisao_ativo"]) == ("COLABORADOR_ATIVO", "CLIENTE")
    assert _motivo(conn_teste, pendencias["cpf_inexistente"]) == ("COLABORADOR_NAO_ENCONTRADO", "CLIENTE")
    assert _motivo(conn_teste, pendencias["trct"]) == ("PRONTO_PARA_ENVIO", "NENHUM")
    assert _contar(conn_teste, "documento_eventos", pendencias["ferias_sem_aviso"]) == 1

    # Só os arquivos dos pendências localizadas são baixados, numa única chamada de URLs
    posts = [r for r in factorial.requisicoes if r[0] == "POST"]
    assert len(posts) == 1 and sorted(posts[0][2]["ids"]) == ["cp", "e", "q", "t"]


def test_reexecucao_nao_duplica_alertas_nem_reprocessa_localizados(conn_teste, pendencias, factorial, tmp_path):
    ids = list(pendencias.values())
    sinc.sincronizar(conn_teste, "chave", str(tmp_path), base_url=factorial.base_url, somente_ids=ids)
    segundo = sinc.sincronizar(conn_teste, "chave", str(tmp_path), base_url=factorial.base_url, somente_ids=ids)

    assert segundo["pendencias"] == 3  # COMPOSTO e LOCALIZADO saem da fila
    assert segundo["alertas_novos"] == 0
    assert _contar(conn_teste, "alerta", pendencias["ferias_sem_aviso"]) == 1
    assert _contar(conn_teste, "documento_envios", pendencias["trct"]) == 1
    assert _contar(conn_teste, "documento_eventos", pendencias["ferias_sem_aviso"]) == 1  # motivo igual: sem evento novo


def test_busca_atrasadas_e_no_prazo_mas_nao_o_que_saiu_do_portal(conn_teste, limpa_documentos_teste):
    no_prazo = _inserir_pendencia(conn_teste, 9, "11122233344", "11/2026", "no_prazo", aba="Próximas entregas")
    atrasada = _inserir_pendencia(conn_teste, 9, "11122233344", "07/2026", "atrasada", aberto_no_portal=True)
    entregue = _inserir_pendencia(conn_teste, 9, "11122233344", "06/2026", "entregue", aba="Entregues", aberto_no_portal=False)
    fechada = _inserir_pendencia(conn_teste, 9, "11122233344", "05/2026", "fechada", aberto_no_portal=False)

    achadas = {p["id"] for p in sinc.buscar_pendencias(conn_teste, [no_prazo, atrasada, entregue, fechada])}

    assert achadas == {no_prazo, atrasada}


def test_factorial_recusando_a_chave_nao_altera_o_banco(conn_teste, pendencias, tmp_path):
    recusando = FactorialConfiguravel(status=401)
    try:
        with pytest.raises(requests.HTTPError):
            sinc.sincronizar(conn_teste, "chave-errada", str(tmp_path), base_url=recusando.base_url, somente_ids=list(pendencias.values()))
    finally:
        recusando.parar()

    for documento_id in pendencias.values():
        assert _linha(conn_teste, documento_id)[0] == "PENDENTE_ENVIO"
        assert _contar(conn_teste, "alerta", documento_id) == 0
    assert not any(tmp_path.iterdir())
