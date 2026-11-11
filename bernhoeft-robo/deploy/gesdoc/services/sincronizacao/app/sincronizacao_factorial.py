"""
Pendências atrasadas do Atlas (Neon) → validação e busca na Factorial → unificação dos pacotes → estado no Neon.

A Factorial é a fonte da verdade sobre o empregado. O tipo de cada arquivo é identificado só pelo nome,
pasta e data na Factorial: o conteúdo dos documentos não é aberto.
"""
import hashlib
import json
import logging
import os
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence, Tuple

import psycopg2.extras
import requests

import factorial_busca as fb
from composicao_pdf import ComposicaoInvalida, compor_pdf

logger = logging.getLogger(__name__)

PASTA_OFFBOARDING = "2466946"
PASTA_FERIAS = "2764697"
PASTA_ASO = "2830537"

RESCISAO = {9, 10, 67, 68, 69}
ESTADOS_ELEGIVEIS = ("PENDENTE_ENVIO", "DIVERGENTE_FACTORIAL", "AGUARDANDO_ASSINATURA", "NAO_ENCONTRADO_FACTORIAL", "ERRO_COMPOSICAO")

SQL_PENDENCIAS = """
    SELECT d.id, d.doc_id, d.nome, d.competencia, d.funcionario, d.estado,
           regexp_replace(d.cpf, '\\D', '', 'g') AS cpf, r.requer_composicao
    FROM documentos d
    JOIN documento_regras r ON r.doc_id = d.doc_id
    WHERE d.aba IN ('Atrasados', 'Próximas entregas')  -- atrasadas e ainda no prazo
      AND d.aberto_no_portal IS NOT FALSE                -- o robô de leitura marca o que saiu do portal
      AND d.cpf IS NOT NULL
      AND r.ativo
      AND r.origem = 'Factorial'
      AND r.chave = 'CPF'
      AND d.estado = ANY(%s)
      AND (%s::int[] IS NULL OR d.id = ANY(%s::int[]))
    ORDER BY d.id
"""


# ============================================================================
# REGRAS DE CASAMENTO (puras)
# ============================================================================

def _norm(texto: Optional[str]) -> str:
    sem_acento = unicodedata.normalize("NFD", str(texto or ""))
    return "".join(c for c in sem_acento if not unicodedata.combining(c)).lower()


def _nome(doc: Dict) -> str:
    return _norm(doc.get("filename"))


def _criado_em(doc: Dict) -> datetime:
    return datetime.fromisoformat(doc["created_at"].replace("Z", "+00:00"))


def _na_pasta(docs: Sequence[Dict], *pastas: str) -> List[Dict]:
    return [d for d in docs if str(d.get("folder_id")) in pastas]


def _casa(docs: Sequence[Dict], padrao: str) -> List[Dict]:
    return [d for d in docs if re.search(padrao, _nome(d))]


def _nao_casa(docs: Sequence[Dict], padrao: str) -> List[Dict]:
    return [d for d in docs if not re.search(padrao, _nome(d))]


def _entre(docs: Sequence[Dict], inicio: datetime, fim: datetime) -> List[Dict]:
    return [d for d in docs if inicio <= _criado_em(d) <= fim]


def _mais_recente(docs: Sequence[Dict]) -> Optional[Dict]:
    return sorted(docs, key=lambda d: d["created_at"], reverse=True)[0] if docs else None


def _assinado(doc: Dict) -> bool:
    return "assinad" in _nome(doc) or doc.get("signature_status") == "completed"


def _sem_pendencia_de_assinatura(doc: Dict) -> bool:
    return doc.get("signature_status") != "pending"


def _preferir_assinado(docs: Sequence[Dict]) -> Optional[Dict]:
    return _mais_recente([d for d in docs if _assinado(d)]) or _mais_recente(docs)


def _inicio_mes_seguinte(competencia: str) -> datetime:
    mes, ano = (int(parte) for parte in competencia.split("/"))
    return datetime(ano + mes // 12, mes % 12 + 1, 1, tzinfo=timezone.utc)


@dataclass
class ResultadoRegra:
    """Itens do pacote, na ordem em que entram no PDF final."""
    itens: List[tuple] = field(default_factory=list)
    faltando: List[str] = field(default_factory=list)
    sem_assinatura: List[str] = field(default_factory=list)

    def exigir(self, item: str, doc: Optional[Dict], assinatura_ok: Optional[Callable[[Dict], bool]] = None):
        if not doc:
            self.faltando.append(item)
            return
        if assinatura_ok and not assinatura_ok(doc):
            self.sem_assinatura.append(item)
        self.itens.append((item, doc))


def _janela_rescisao(docs: Sequence[Dict], empregado: Dict) -> List[Dict]:
    desligamento = datetime.fromisoformat(empregado["terminated_on"]).replace(tzinfo=timezone.utc)
    rescisao = _na_pasta(docs, PASTA_OFFBOARDING, PASTA_ASO)
    return _entre(rescisao, desligamento - timedelta(days=30), desligamento + timedelta(days=120))


def regra_ferias(docs, pendencia, empregado) -> ResultadoRegra:
    limite = _inicio_mes_seguinte(pendencia["competencia"])
    ferias = _entre(_na_pasta(docs, PASTA_FERIAS), limite - timedelta(days=120), limite + timedelta(days=45))
    resultado = ResultadoRegra()
    resultado.exigir("Aviso de férias", _mais_recente(_casa(ferias, r"aviso")))
    resultado.exigir("Recibo de férias", _mais_recente(_casa(ferias, r"recibo.{0,3}de.{0,3}ferias")), _sem_pendencia_de_assinatura)
    resultado.exigir("Comprovante de pagamento das férias", _mais_recente(_casa(ferias, r"comprovante")))
    return resultado


def regra_trct(docs, pendencia, empregado) -> ResultadoRegra:
    rescisao = _janela_rescisao(docs, empregado)
    resultado = ResultadoRegra()
    trct = _mais_recente(_casa(rescisao, r"\btrct\b"))
    if trct:
        resultado.itens.append(("TRCT", trct))
    else:
        recibos = _casa(rescisao, r"recibo.{1,3}de.{1,3}rescisao")
        resultado.exigir("TRCT / Recibo de rescisão assinado", _preferir_assinado(recibos), _assinado)
    termos = _casa(rescisao, r"termo.{1,3}de.{1,3}qu[a-z]*tacao")
    resultado.exigir("Termo de quitação assinado", _preferir_assinado(termos), _assinado)
    nome = _norm(empregado.get("full_name"))
    candidatos = _nao_casa(_na_pasta(rescisao, PASTA_OFFBOARDING), r"fgts|esocial|aso|aviso|termo|recibo|trct|ficha|seguro|analitic|memoria")
    comprovantes = [d for d in candidatos if _nome(d).startswith(nome) or "comprovante" in _nome(d)]
    resultado.exigir("Comprovante de pagamento da rescisão", _mais_recente(comprovantes))
    return resultado


def regra_gfd(docs, pendencia, empregado) -> ResultadoRegra:
    fgts = _nao_casa(_casa(_na_pasta(_janela_rescisao(docs, empregado), PASTA_OFFBOARDING), r"fgts"), r"analitic|credito|consignado")
    nome = _norm(empregado.get("full_name"))

    def eh_comprovante(doc):
        return bool(re.search(r"comprovante|\bcomp\b", _nome(doc))) or _nome(doc).startswith(nome)

    resultado = ResultadoRegra()
    resultado.exigir("Guia GFD rescisória", _mais_recente([d for d in fgts if not eh_comprovante(d)]))
    resultado.exigir("Comprovante de pagamento da GFD rescisória", _mais_recente([d for d in fgts if eh_comprovante(d)]))
    return resultado


def regra_aso_demissional(docs, pendencia, empregado) -> ResultadoRegra:
    rescisao = _janela_rescisao(docs, empregado)
    aso = _mais_recente(_casa(rescisao, r"\baso\b.*demissional|demissional.*\baso\b")) \
        or _mais_recente(_casa(_na_pasta(rescisao, PASTA_OFFBOARDING), r"^aso\b"))
    resultado = ResultadoRegra()
    resultado.exigir("ASO demissional", aso)
    return resultado


def regra_esocial(docs, pendencia, empregado) -> ResultadoRegra:
    resultado = ResultadoRegra()
    resultado.exigir("Baixa eSocial", _mais_recente(_casa(_janela_rescisao(docs, empregado), r"esocial")))
    return resultado


def regra_aviso_previo(docs, pendencia, empregado) -> ResultadoRegra:
    avisos = _casa(_janela_rescisao(docs, empregado), r"aviso.{0,3}previo")
    resultado = ResultadoRegra()
    resultado.exigir("Aviso prévio / carta de desligamento assinada", _preferir_assinado(avisos), _assinado)
    return resultado


REGRAS = {8: regra_ferias, 9: regra_trct, 10: regra_gfd, 67: regra_aso_demissional, 68: regra_esocial, 69: regra_aviso_previo}


def validar_empregado(pendencia: Dict, empregado: Optional[Dict]) -> Optional[str]:
    """Motivo da divergência entre Atlas e Factorial, ou None se a pendência é válida."""
    if not empregado:
        return "CPF não encontrado na Factorial"
    if int(pendencia["doc_id"]) in RESCISAO and not empregado.get("terminated_on"):
        return "Empregado ativo na Factorial: pendência de rescisão indevida no Atlas"
    return None


def casar_pendencia(pendencia: Dict, empregado: Dict, docs: Sequence[Dict]) -> Dict:
    regra = REGRAS.get(int(pendencia["doc_id"]))
    if not regra:
        return {"estado": "NAO_ENCONTRADO_FACTORIAL", "motivo": f"Sem regra de busca para o doc_id {pendencia['doc_id']}", "arquivos": []}
    resultado = regra(docs, pendencia, empregado)
    arquivos = [
        {"ordem": ordem, "item": item, "id": str(doc["id"]), "filename": doc.get("filename"), "created_at": doc["created_at"]}
        for ordem, (item, doc) in enumerate(resultado.itens, start=1)
    ]
    if resultado.faltando:
        return {"estado": "NAO_ENCONTRADO_FACTORIAL", "motivo": "Não encontrado na Factorial: " + ", ".join(resultado.faltando), "arquivos": arquivos}
    if resultado.sem_assinatura:
        return {"estado": "AGUARDANDO_ASSINATURA", "motivo": "Sem assinatura na Factorial: " + ", ".join(resultado.sem_assinatura), "arquivos": arquivos}
    return {"estado": "LOCALIZADO", "motivo": None, "arquivos": arquivos}


# ============================================================================
# FACTORIAL
# ============================================================================

def listar_documentos(api_key: str, employee_ids: Sequence[str], base_url: str = fb.BASE_URL) -> List[Dict]:
    if not employee_ids:
        return []
    return fb._listar_paginado(
        "/documents/documents",
        api_key,
        params={"employee_ids[]": list(employee_ids), "by_trash_bin": "false"},
        base_url=base_url,
    )


def baixar_arquivos(api_key: str, ids: Sequence[str], base_url: str = fb.BASE_URL) -> Dict[str, bytes]:
    urls = fb.gerar_urls_download(api_key, list(ids), base_url=base_url)
    conteudos = {}
    for documento_id in ids:
        url = urls.get(documento_id)
        if not url:
            raise RuntimeError(f"Factorial não gerou URL de download para o documento {documento_id}")
        resposta = requests.get(url, timeout=120)
        resposta.raise_for_status()
        conteudos[documento_id] = resposta.content
    return conteudos


# ============================================================================
# BANCO
# ============================================================================

def buscar_pendencias(conn, somente_ids: Optional[Sequence[int]] = None) -> List[Dict]:
    ids = list(somente_ids) if somente_ids else None
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cursor.execute(SQL_PENDENCIAS, (list(ESTADOS_ELEGIVEIS), ids, ids))
    pendencias = [dict(linha) for linha in cursor.fetchall()]
    cursor.close()
    return pendencias


SEVERIDADE = {"DIVERGENTE_FACTORIAL": "alta", "ERRO_COMPOSICAO": "alta"}  # demais estados: média


def motivo_do_estado(estado: str, motivo: Optional[str]) -> Tuple[str, str, str]:
    """Código do motivo, responsável e um detalhe sem CPF/nome (catálogo `motivos` do banco, migração 002)."""
    texto = motivo or ""
    if estado == "DIVERGENTE_FACTORIAL":
        if texto.startswith("Empregado ativo"):
            return "COLABORADOR_ATIVO", "CLIENTE", texto
        return "COLABORADOR_NAO_ENCONTRADO", "CLIENTE", texto
    if estado == "NAO_ENCONTRADO_FACTORIAL":
        if texto.startswith("Sem regra de busca"):
            return "SEM_REGRA", "SISTEMA", texto
        return "FALTA_ARQUIVO", "CLIENTE", texto
    if estado == "AGUARDANDO_ASSINATURA":
        return "ARQUIVO_INCOMPLETO", "CLIENTE", texto
    if estado == "ERRO_COMPOSICAO":
        return "ARQUIVO_INVALIDO", "SISTEMA", "Falha ao unificar o pacote"  # o erro pode citar nome de arquivo
    return "DESCONHECIDO", "SISTEMA", texto


def registrar_status(conn, documento_id: int, estado: str, motivo: str) -> bool:
    """Atualiza estado e motivo. Alerta só quando o estado muda e evento só quando estado ou motivo mudam,
    para reexecuções não duplicarem nada. Estado e id ficam nos dois primeiros parâmetros (o rodar.py da VPS
    simula esta gravação lendo essas posições)."""
    codigo, responsavel, detalhe = motivo_do_estado(estado, motivo)
    cursor = conn.cursor()
    cursor.execute(
        """
        WITH p AS (
          SELECT %s::varchar AS estado, %s::int AS id, %s::varchar AS motivo, %s::varchar AS responsavel,
                 %s::varchar AS severidade, %s::text AS descricao, %s::text AS detalhe
        ),
        alterado AS (
          UPDATE documentos d
             SET estado = p.estado, motivo = p.motivo, responsavel = p.responsavel, motivo_em = now(), atualizado_em = now()
            FROM p
           WHERE d.id = p.id AND (d.estado IS DISTINCT FROM p.estado OR d.motivo IS DISTINCT FROM p.motivo)
          RETURNING d.id, old.estado IS DISTINCT FROM new.estado AS mudou_estado
        ),
        evento AS (
          INSERT INTO documento_eventos (documento_id, robo, tipo, resultado, motivo, responsavel, detalhe)
          SELECT a.id, 'sincronizacao', 'BUSCA', 'FALHA', p.motivo, p.responsavel, p.detalhe FROM alterado a, p
        )
        INSERT INTO alerta (tipo_alerta, severidade, documento_id, descricao)
        SELECT p.estado, p.severidade, a.id, p.descricao FROM alterado a, p WHERE a.mudou_estado
        RETURNING id
        """,
        (estado, documento_id, codigo, responsavel, SEVERIDADE.get(estado, "media"), motivo, detalhe),
    )
    mudou = cursor.fetchone() is not None
    conn.commit()
    cursor.close()
    return mudou


def marcar_localizado(conn, documento_id: int, estado: str, caminho: Path, conteudo: bytes, dados: Dict, fluxo_id: str):
    cursor = conn.cursor()
    cursor.execute(
        """
        UPDATE documentos
        SET estado = %s, caminho_origem = %s, tamanho_bytes = %s, hash_arquivo = %s, atualizado_em = now(),
            motivo = 'PRONTO_PARA_ENVIO', responsavel = 'NENHUM', motivo_em = now()
        WHERE id = %s
        """,
        (estado, str(caminho), len(conteudo), hashlib.sha256(conteudo).hexdigest(), documento_id),
    )
    cursor.execute(
        """
        INSERT INTO documento_envios (documento_id, fluxo_id, etapa, status, dados_resposta, timestamp_inicio, timestamp_fim)
        VALUES (%s, %s, 'FACTORIAL_DOWNLOAD', 'SUCESSO', %s, now(), now())
        """,
        (documento_id, fluxo_id, json.dumps(dados, ensure_ascii=False)),
    )
    conn.commit()
    cursor.close()


# ============================================================================
# ORQUESTRAÇÃO
# ============================================================================

def _nome_seguro(nome: str) -> str:
    return re.sub(r"[^\w.\- ]", "_", nome).strip() or "arquivo"


def _gravar(pasta: Path, documento_id: int, nome: str, conteudo: bytes) -> Path:
    destino = pasta / str(documento_id)
    destino.mkdir(parents=True, exist_ok=True)
    caminho = destino / _nome_seguro(nome)
    caminho.write_bytes(conteudo)
    return caminho


def sincronizar(conn, api_key: str, pasta_destino: str, base_url: str = fb.BASE_URL,
                somente_ids: Optional[Sequence[int]] = None) -> Dict:
    fluxo_id = "sinc-" + datetime.now().strftime("%Y%m%d%H%M%S")
    pasta = Path(pasta_destino).resolve()
    pendencias = buscar_pendencias(conn, somente_ids)
    resumo = {"fluxo_id": fluxo_id, "pendencias": len(pendencias), "por_estado": {}, "alertas_novos": 0, "itens": []}
    if not pendencias:
        return resumo

    # Busca tudo na Factorial antes de gravar: se a API falhar (ex.: 401), nada é alterado no banco
    empregados = fb.indexar_empregados_por_cpf(api_key, base_url=base_url)
    if not empregados:
        raise RuntimeError("Factorial retornou zero empregados; nada foi alterado no banco")

    resultados = []
    for pendencia in pendencias:
        empregado = empregados.get(pendencia["cpf"])
        motivo = validar_empregado(pendencia, empregado)
        resultados.append({"pendencia": pendencia, "empregado": empregado, "divergencia": motivo})

    validos = [r for r in resultados if not r["divergencia"]]
    documentos = listar_documentos(api_key, sorted({str(r["empregado"]["id"]) for r in validos}), base_url=base_url)
    por_empregado: Dict[str, List[Dict]] = {}
    for documento in documentos:
        por_empregado.setdefault(str(documento.get("employee_id")), []).append(documento)

    for r in resultados:
        if r["divergencia"]:
            r["casamento"] = {"estado": "DIVERGENTE_FACTORIAL", "motivo": r["divergencia"], "arquivos": []}
        else:
            docs = por_empregado.get(str(r["empregado"]["id"]), [])
            r["casamento"] = casar_pendencia(r["pendencia"], r["empregado"], docs)

    localizados = [r for r in resultados if r["casamento"]["estado"] == "LOCALIZADO"]
    ids_para_baixar = sorted({a["id"] for r in localizados for a in r["casamento"]["arquivos"]})
    conteudos = baixar_arquivos(api_key, ids_para_baixar, base_url=base_url) if ids_para_baixar else {}

    for r in resultados:
        pendencia, casamento = r["pendencia"], r["casamento"]
        estado, motivo = casamento["estado"], casamento["motivo"]
        detalhe = {"id": pendencia["id"], "doc_id": pendencia["doc_id"], "funcionario": pendencia.get("funcionario")}

        if estado == "LOCALIZADO":
            arquivos = casamento["arquivos"]
            dados = {"employee_id": str(r["empregado"]["id"]), "composto": bool(pendencia["requer_composicao"]), "itens": arquivos}
            try:
                if pendencia["requer_composicao"]:
                    estado = "COMPOSTO"
                    # sem CPF no nome: o caminho vai para o banco e para os logs
                    nome_final = f"doc{pendencia['doc_id']}_{pendencia['competencia'].replace('/', '-')}.pdf"
                    conteudo = compor_pdf([{"nome": a["filename"], "conteudo": conteudos[a["id"]]} for a in arquivos])
                else:
                    nome_final = arquivos[0]["filename"] or f"{arquivos[0]['id']}.pdf"
                    conteudo = conteudos[arquivos[0]["id"]]
            except ComposicaoInvalida as erro:
                estado, motivo = "ERRO_COMPOSICAO", f"Falha ao unificar o pacote: {erro}"
            else:
                caminho = _gravar(pasta, pendencia["id"], nome_final, conteudo)
                marcar_localizado(conn, pendencia["id"], estado, caminho, conteudo, {**dados, "arquivo_final": caminho.name}, fluxo_id)
                detalhe.update({"arquivo": str(caminho), "bytes": len(conteudo)})

        if estado not in ("LOCALIZADO", "COMPOSTO"):
            if registrar_status(conn, pendencia["id"], estado, motivo):
                resumo["alertas_novos"] += 1
            detalhe["motivo"] = motivo

        detalhe["estado"] = estado
        resumo["por_estado"][estado] = resumo["por_estado"].get(estado, 0) + 1
        resumo["itens"].append(detalhe)

    logger.info("Sincronização %s: %s", fluxo_id, resumo["por_estado"])
    return resumo


def main():
    import psycopg2
    from dotenv import load_dotenv

    load_dotenv()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
    api_key = os.getenv("FACTORIAL_API_KEY")
    if not api_key:
        raise SystemExit("FACTORIAL_API_KEY não configurada")
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        resumo = sincronizar(
            conn,
            api_key,
            os.getenv("FACTORIAL_PASTA_DOWNLOAD", "downloads/factorial"),
            base_url=os.getenv("FACTORIAL_API_URL", fb.BASE_URL),
        )
    finally:
        conn.close()
    print(json.dumps({k: v for k, v in resumo.items() if k != "itens"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
