import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import pytest

import factorial_busca as fb

EMPREGADOS = [
    {"id": "1", "full_name": "Ana Teste", "identifier": "111.222.333-44"},
    {"id": "2", "full_name": "Bruno Teste", "identifier": "55566677788"},
    {"id": "3", "full_name": "Carla Teste", "identifier": "99988877766"},
]
DOCUMENTOS = {
    "2": [
        {"id": "d1", "filename": "ASO.pdf", "employee_id": "2"},
        {"id": "d2", "filename": "TRCT.pdf", "employee_id": "2"},
        {"id": "d3", "filename": "Ficha.pdf", "employee_id": "2"},
    ],
}


class FactorialFalso:
    def __init__(self, paginas_por_pagina=2):
        self.paginas = paginas_por_pagina
        self.requisicoes = []
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self.base_url = f"http://127.0.0.1:{self._server.server_address[1]}/api/2026-10-01/resources"
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    def iniciar(self):
        self._thread.start()
        return self

    def parar(self):
        self._server.shutdown()
        self._server.server_close()

    def _paginar(self, itens, query):
        inicio = 0
        if "after_id" in query:
            inicio = next(i for i, x in enumerate(itens) if x["id"] == query["after_id"][0]) + 1
        fatia = itens[inicio:inicio + self.paginas]
        proximo = inicio + self.paginas < len(itens)
        meta = {"has_next_page": proximo, "end_cursor": fatia[-1]["id"] if fatia else None}
        return {"data": fatia, "meta": meta}

    def _handler(self):
        falso = self

        class Handler(BaseHTTPRequestHandler):
            def _responder(self, corpo):
                dados = json.dumps(corpo).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(dados)))
                self.end_headers()
                self.wfile.write(dados)

            def do_GET(self):
                url = urlparse(self.path)
                query = parse_qs(url.query)
                falso.requisicoes.append(("GET", url.path, query, self.headers.get("x-api-key")))
                if "/files/" in url.path:
                    dados = f"PDF-{url.path.rsplit('/', 1)[-1]}".encode()
                    self.send_response(200)
                    self.send_header("Content-Length", str(len(dados)))
                    self.end_headers()
                    self.wfile.write(dados)
                    return
                if url.path.endswith("/employees/employees"):
                    return self._responder(falso._paginar(EMPREGADOS, query))
                if url.path.endswith("/documents/documents"):
                    ids = query.get("employee_ids[]", [""])[0]
                    docs = DOCUMENTOS.get(ids, [])
                    return self._responder(falso._paginar(docs, query))
                self.send_response(404)
                self.end_headers()

            def do_POST(self):
                tamanho = int(self.headers.get("Content-Length", 0))
                corpo = json.loads(self.rfile.read(tamanho))
                falso.requisicoes.append(("POST", urlparse(self.path).path, corpo, self.headers.get("x-api-key")))
                self._responder([{"id": i, "url": f"{falso.base_url}/files/{i}.pdf"} for i in corpo["ids"]])

            def log_message(self, *args):
                pass

        return Handler


@pytest.fixture
def factorial():
    servidor = FactorialFalso().iniciar()
    yield servidor
    servidor.parar()


def test_acha_empregado_pelo_cpf_com_pontuacao_e_paginacao(factorial):
    empregado = fb.achar_empregado_por_cpf("chave", "55566677788", base_url=factorial.base_url)
    assert empregado["id"] == "2"

    empregado = fb.achar_empregado_por_cpf("chave", "11122233344", base_url=factorial.base_url)
    assert empregado["id"] == "1"


def test_cpf_inexistente_retorna_none(factorial):
    assert fb.achar_empregado_por_cpf("chave", "00000000000", base_url=factorial.base_url) is None


def test_lista_documentos_com_filtros_obrigatorios(factorial):
    docs = fb.listar_documentos_do_empregado("chave", "2", base_url=factorial.base_url)

    assert [d["filename"] for d in docs] == ["ASO.pdf", "TRCT.pdf", "Ficha.pdf"]
    doc_req = [r for r in factorial.requisicoes if r[1].endswith("/documents/documents")][0]
    assert doc_req[2]["by_pending_assignment"] == ["false"]
    assert doc_req[2]["by_trash_bin"] == ["false"]
    assert doc_req[2]["employee_ids[]"] == ["2"]
    assert doc_req[3] == "chave"


def test_gera_url_de_download_em_lote(factorial):
    urls = fb.gerar_urls_download("chave", ["d1", "d2"], base_url=factorial.base_url)

    assert urls == {"d1": f"{factorial.base_url}/files/d1.pdf", "d2": f"{factorial.base_url}/files/d2.pdf"}
    post = [r for r in factorial.requisicoes if r[0] == "POST"][0]
    assert post[2] == {"ids": ["d1", "d2"]}


def test_busca_documentos_a_partir_do_cpf(factorial):
    docs = fb.buscar_documentos_por_cpf("chave", "555.666.777-88", base_url=factorial.base_url)

    assert len(docs) == 3
    assert all(d["_funcionario"] == "Bruno Teste" for d in docs)


def test_cpf_sem_empregado_nao_lista_documentos(factorial):
    assert fb.buscar_documentos_por_cpf("chave", "00000000000", base_url=factorial.base_url) == []


def test_baixa_arquivos_para_pasta_do_cpf(factorial, tmp_path):
    baixados = fb.baixar_documentos_do_cpf("chave", "555.666.777-88", str(tmp_path), base_url=factorial.base_url)

    assert len(baixados) == 3
    arquivo = tmp_path / "55566677788" / "d1_ASO.pdf"
    assert arquivo.read_bytes() == b"PDF-d1.pdf"
    assert all(b["bytes"] > 0 for b in baixados)
