# Migrações do banco (Neon)

Histórico das mudanças no esquema, em ordem. **Todas já estão aplicadas em produção** (branch `production`) em 10/11/2026;
ficam aqui para recriar o banco do zero ou um branch de teste, e para saber de onde veio cada coluna, tabela e view.

| Ordem | Arquivo | O quê |
|---|---|---|
| base | `docs/banco/3.2_DDL_PostgreSQL_Entidades.sql`, `3.3_SEED_regra_documento_36.sql`, `populate_documento_regras.sql` | esquema e regras dos 36 documentos (modelo em `docs/banco/3.1_Estados_Entidades_Transicoes.md`) |
| 1 | `001_correcoes_banco.sql` | evidências com RESTRICT, protocolos 1:N, destinos por pendência |
| 2 | `001b_email_responsavel.sql` | e-mail do responsável por tipo de documento (usado pelo "Alertas EQT" do n8n) |
| 3 | `002_rastreio.sql` | colunas do portal e do motivo em `documentos`, `coletas`, `documento_eventos`, catálogo `motivos` |
| 4 | `003_solicitacoes.sql` | view `v_solicitacoes`, `situacoes_portal` com grupo, `buscas_cobertura` |
| 5 | `004_vocabulario_robo.sql` | sinônimos do vocabulário que o robô grava |
| 6 | `005_sem_regra.sql` | itens sem regra entram no banco (`doc_id` vazio) |
| 7 | `006_protocolos_destino.sql` | `robo_atlas` lê `documento_destinos` |
| 8 | `007_bernhoeft_e_doc5.sql` | = `docs/sql/2026-11-10-regras-bernhoeft.sql` + `2026-11-05-tirar-plano-odontologico.sql` |
| 9 | `008_numero_pedido_200.sql` | `numero_pedido` até 200 caracteres |
| 10 | `009_etapa_e_status_envio.sql` | pendente × enviado, status do envio, quem enviou (base do painel Solicitações ODA NIP) |
| 11 | `010_dias_no_horario_de_brasilia.sql` | prazos pela data de Brasília |
| 12 | `011_protocolo_conta_como_enviado.sql` | protocolo registrado conta como enviado |

As roles (`robo_atlas`, `sinc_factorial`, `painel_leitura`) ficam em `seguranca/roles.sql` e são aplicadas depois da base.

Regras:
- Rodar como owner do banco, primeiro no branch de teste, depois em produção.
- Migração nova: próximo número, cabeçalho dizendo o que muda e quando foi aplicada. Nunca editar uma já aplicada.
- Nada de URL do banco ou senha nos arquivos.
