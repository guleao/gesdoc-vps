from io import BytesIO
from typing import Dict, List

from PIL import Image
from pypdf import PdfReader, PdfWriter

LIMITE_ARQUIVOS = 20
LIMITE_BYTES_TOTAL = 50 * 1024 * 1024


class ComposicaoInvalida(ValueError):
    pass


def _eh_pdf(conteudo: bytes) -> bool:
    return conteudo.lstrip()[:5] == b"%PDF-"


def _imagem_para_pdf(conteudo: bytes, nome: str) -> bytes:
    try:
        imagem = Image.open(BytesIO(conteudo))
        imagem.load()
    except Exception as erro:
        raise ComposicaoInvalida(f"Arquivo '{nome}' não é PDF nem imagem suportada") from erro
    saida = BytesIO()
    imagem.convert("RGB").save(saida, format="PDF")
    return saida.getvalue()


def compor_pdf(arquivos: List[Dict]) -> bytes:
    """Junta os arquivos, na ordem recebida, num único PDF. Cada item: {"nome": str, "conteudo": bytes}."""
    if not arquivos:
        raise ComposicaoInvalida("Nenhum arquivo para compor")
    if len(arquivos) > LIMITE_ARQUIVOS:
        raise ComposicaoInvalida(f"Máximo de {LIMITE_ARQUIVOS} arquivos por composição")
    if sum(len(arquivo["conteudo"]) for arquivo in arquivos) > LIMITE_BYTES_TOTAL:
        raise ComposicaoInvalida("Arquivos excedem o tamanho máximo da composição")

    escritor = PdfWriter()
    for arquivo in arquivos:
        conteudo = arquivo["conteudo"]
        if not _eh_pdf(conteudo):
            conteudo = _imagem_para_pdf(conteudo, arquivo["nome"])
        try:
            leitor = PdfReader(BytesIO(conteudo))
            if leitor.is_encrypted:
                leitor.decrypt("")
            for pagina in leitor.pages:
                escritor.add_page(pagina)
        except ComposicaoInvalida:
            raise
        except Exception as erro:
            raise ComposicaoInvalida(f"Não foi possível ler o PDF '{arquivo['nome']}'") from erro

    saida = BytesIO()
    escritor.write(saida)
    return saida.getvalue()
