import base64
from datetime import datetime, timedelta, timezone
from io import BytesIO

import jwt
import pytest
from PIL import Image
from pypdf import PdfReader, PdfWriter

import app as app_mod
from composicao_pdf import ComposicaoInvalida, compor_pdf


def _pdf(paginas: int, largura: int = 200) -> bytes:
    escritor = PdfWriter()
    for _ in range(paginas):
        escritor.add_blank_page(width=largura, height=300)
    saida = BytesIO()
    escritor.write(saida)
    return saida.getvalue()


def _png() -> bytes:
    saida = BytesIO()
    Image.new("RGB", (40, 60), "white").save(saida, format="PNG")
    return saida.getvalue()


def _larguras(pdf: bytes):
    return [round(float(pagina.mediabox.width)) for pagina in PdfReader(BytesIO(pdf)).pages]


def test_compor_junta_paginas_na_ordem_recebida():
    pdf = compor_pdf([
        {"nome": "aviso.pdf", "conteudo": _pdf(2, largura=100)},
        {"nome": "recibo.pdf", "conteudo": _pdf(1, largura=200)},
        {"nome": "comprovante.pdf", "conteudo": _pdf(1, largura=300)},
    ])
    assert _larguras(pdf) == [100, 100, 200, 300]


def test_compor_converte_imagem_em_pagina():
    pdf = compor_pdf([
        {"nome": "trct.pdf", "conteudo": _pdf(1)},
        {"nome": "comprovante.png", "conteudo": _png()},
    ])
    assert len(PdfReader(BytesIO(pdf)).pages) == 2


def test_compor_rejeita_lista_vazia():
    with pytest.raises(ComposicaoInvalida):
        compor_pdf([])


def test_compor_rejeita_arquivo_que_nao_e_pdf_nem_imagem():
    with pytest.raises(ComposicaoInvalida, match="planilha.xlsx"):
        compor_pdf([{"nome": "planilha.xlsx", "conteudo": b"nao sou pdf"}])


@pytest.fixture
def cliente():
    app_mod.app.config["TESTING"] = True
    with app_mod.app.test_client() as c:
        yield c


def _cabecalho():
    token = jwt.encode({"exp": datetime.now(timezone.utc) + timedelta(minutes=5)}, app_mod.SECRET_KEY, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _b64(conteudo: bytes) -> str:
    return base64.b64encode(conteudo).decode()


def test_endpoint_compor_exige_token(cliente):
    assert cliente.post("/compor", json={"arquivos": []}).status_code == 401


def test_endpoint_compor_devolve_pdf_unico(cliente):
    resposta = cliente.post(
        "/compor",
        headers=_cabecalho(),
        json={
            "nome_saida": "doc9_00000000000_07-2026.pdf",
            "arquivos": [
                {"nome": "trct.pdf", "conteudo_base64": _b64(_pdf(2))},
                {"nome": "comprovante.png", "conteudo_base64": _b64(_png())},
            ],
        },
    )
    assert resposta.status_code == 200
    assert resposta.mimetype == "application/pdf"
    assert resposta.headers["X-Paginas"] == "3"
    assert "doc9_00000000000_07-2026.pdf" in resposta.headers["Content-Disposition"]
    assert len(PdfReader(BytesIO(resposta.data)).pages) == 3


def test_endpoint_compor_nao_aceita_caminho_no_nome_de_saida(cliente):
    resposta = cliente.post(
        "/compor",
        headers=_cabecalho(),
        json={"nome_saida": "../../etc/x.pdf", "arquivos": [{"nome": "a.pdf", "conteudo_base64": _b64(_pdf(1))}]},
    )
    assert resposta.status_code == 200
    assert "../" not in resposta.headers["Content-Disposition"]


def test_endpoint_compor_valida_entrada(cliente):
    assert cliente.post("/compor", headers=_cabecalho(), json={"arquivos": []}).status_code == 400
    assert cliente.post("/compor", headers=_cabecalho(), json={"arquivos": [{"nome": "a.pdf", "conteudo_base64": "***"}]}).status_code == 400
    invalido = cliente.post("/compor", headers=_cabecalho(), json={"arquivos": [{"nome": "a.xlsx", "conteudo_base64": _b64(b"xx")}]})
    assert invalido.status_code == 422
