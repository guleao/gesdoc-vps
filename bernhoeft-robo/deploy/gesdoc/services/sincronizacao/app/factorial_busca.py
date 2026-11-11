import re
from pathlib import Path
from typing import Dict, List, Optional

import requests

BASE_URL = "https://api.factorialhr.com/api/2026-10-01/resources"
TAMANHO_PAGINA = 100


def _normalizar_cpf(valor: Optional[str]) -> str:
    return re.sub(r"\D", "", valor or "")


def _cabecalhos(api_key: str) -> Dict[str, str]:
    return {"x-api-key": api_key, "Accept": "application/json"}


def _listar_paginado(url: str, api_key: str, params: Optional[Dict] = None, base_url: str = BASE_URL) -> List[Dict]:
    itens: List[Dict] = []
    params = dict(params or {})
    params["limit"] = TAMANHO_PAGINA
    while True:
        resposta = requests.get(f"{base_url}{url}", headers=_cabecalhos(api_key), params=params, timeout=30)
        resposta.raise_for_status()
        corpo = resposta.json()
        itens.extend(corpo.get("data", []))
        meta = corpo.get("meta", {})
        if not meta.get("has_next_page"):
            return itens
        params["after_id"] = meta["end_cursor"]


def indexar_empregados_por_cpf(api_key: str, base_url: str = BASE_URL) -> Dict[str, Dict]:
    indice: Dict[str, Dict] = {}
    for empregado in _listar_paginado("/employees/employees", api_key, base_url=base_url):
        chave = _normalizar_cpf(empregado.get("identifier"))
        if chave:
            indice.setdefault(chave, empregado)
    return indice


def achar_empregado_por_cpf(api_key: str, cpf: str, base_url: str = BASE_URL, indice: Optional[Dict[str, Dict]] = None) -> Optional[Dict]:
    if indice is None:
        indice = indexar_empregados_por_cpf(api_key, base_url=base_url)
    return indice.get(_normalizar_cpf(cpf))


def listar_documentos_do_empregado(api_key: str, employee_id: str, base_url: str = BASE_URL) -> List[Dict]:
    return _listar_paginado(
        "/documents/documents",
        api_key,
        params={
            "employee_ids[]": [employee_id],
            "by_pending_assignment": "false",
            "by_trash_bin": "false",
        },
        base_url=base_url,
    )


def gerar_urls_download(api_key: str, ids: List[str], base_url: str = BASE_URL) -> Dict[str, str]:
    urls: Dict[str, str] = {}
    for inicio in range(0, len(ids), 100):
        lote = ids[inicio:inicio + 100]
        resposta = requests.post(
            f"{base_url}/documents/download_urls/bulk_create",
            headers=_cabecalhos(api_key),
            json={"ids": lote},
            timeout=30,
        )
        resposta.raise_for_status()
        for item in resposta.json():
            urls[item["id"]] = item["url"]
    return urls


def buscar_documentos_por_cpf(api_key: str, cpf: str, base_url: str = BASE_URL, indice: Optional[Dict[str, Dict]] = None) -> List[Dict]:
    empregado = achar_empregado_por_cpf(api_key, cpf, base_url=base_url, indice=indice)
    if not empregado:
        return []
    documentos = listar_documentos_do_empregado(api_key, empregado["id"], base_url=base_url)
    for documento in documentos:
        documento["_funcionario"] = empregado.get("full_name")
    return documentos


def baixar_documentos_do_cpf(api_key: str, cpf: str, pasta_destino: str, base_url: str = BASE_URL, indice: Optional[Dict[str, Dict]] = None) -> List[Dict]:
    documentos = buscar_documentos_por_cpf(api_key, cpf, base_url=base_url, indice=indice)
    if not documentos:
        return []
    urls = gerar_urls_download(api_key, [d["id"] for d in documentos], base_url=base_url)
    pasta = Path(pasta_destino) / _normalizar_cpf(cpf)
    pasta.mkdir(parents=True, exist_ok=True)
    baixados = []
    for documento in documentos:
        url = urls.get(documento["id"])
        if not url:
            continue
        resposta = requests.get(url, timeout=60)
        resposta.raise_for_status()
        nome = re.sub(r"[^\w.\- ]", "_", documento.get("filename") or documento["id"])
        caminho = pasta / f"{documento['id']}_{nome}"
        caminho.write_bytes(resposta.content)
        baixados.append({
            "documento_id": documento["id"],
            "filename": documento.get("filename"),
            "caminho": str(caminho),
            "bytes": len(resposta.content),
        })
    return baixados
