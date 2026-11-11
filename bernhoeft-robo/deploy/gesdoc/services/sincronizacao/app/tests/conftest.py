import os
import sys
from pathlib import Path

import psycopg2
import pytest
from dotenv import dotenv_values

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

_env_test = dotenv_values(RAIZ / ".env.test")
URL_TESTE = _env_test.get("TEST_DATABASE_URL")
BRANCH_TESTE = _env_test.get("TEST_BRANCH_ID")

if not URL_TESTE or not BRANCH_TESTE or BRANCH_TESTE not in URL_TESTE:
    raise RuntimeError(
        "Defina TEST_DATABASE_URL e TEST_BRANCH_ID em .env.test. "
        "TEST_BRANCH_ID deve ser o identificador do branch de teste contido na URL. "
        "Os testes não rodam contra o banco de produção."
    )

os.environ["DATABASE_URL"] = URL_TESTE
os.environ.setdefault("SECRET_KEY", "chave-de-teste-com-mais-de-32-bytes-000")

PREFIXO_TESTE = "TESTE_"


@pytest.fixture
def conn_teste():
    conn = psycopg2.connect(URL_TESTE)
    yield conn
    conn.close()


@pytest.fixture
def limpa_documentos_teste(conn_teste):
    def limpar():
        conn_teste.rollback()
        cur = conn_teste.cursor()
        # As tabelas de evidência usam ON DELETE RESTRICT: apagar os filhos antes da pendência
        for tabela in ("documento_envios", "idempotencia", "alerta", "documento_protocolos",
                       "documento_reprocessamento", "documento_destinos", "documento_eventos"):
            cur.execute(f"DELETE FROM {tabela} WHERE documento_id IN "
                        "(SELECT id FROM documentos WHERE nome LIKE %s)", (PREFIXO_TESTE + "%",))
        cur.execute("DELETE FROM documentos WHERE nome LIKE %s", (PREFIXO_TESTE + "%",))
        conn_teste.commit()
        cur.close()

    limpar()
    yield
    limpar()


def inserir_documento(conn, doc_id, nome, prazo, estado="PENDENTE_ENVIO"):
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO documentos
            (doc_id, colaborador_id, competencia, estado, versao, hash_arquivo,
             tamanho_bytes, caminho_origem, data_criacao_documento,
             prazo_envio, cliente, unidade, nome, categoria)
        VALUES (%s, 'TESTE', '2026-10', %s, 1, 'hash-teste', 0, '', NOW(),
                %s, 'Cliente Teste', 'Unidade Teste', %s, 'TESTE')
        RETURNING id
        """,
        (doc_id, estado, prazo, PREFIXO_TESTE + nome),
    )
    novo_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    return novo_id


def estado_documento(conn, documento_id):
    cur = conn.cursor()
    cur.execute("SELECT estado FROM documentos WHERE id = %s", (documento_id,))
    estado = cur.fetchone()[0]
    cur.close()
    return estado
