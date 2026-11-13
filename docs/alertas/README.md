# Alertas ODA (workflow "Alertas EQT" do n8n)

E-mail diário, às 8h (Brasília), para o responsável de cada tipo de documento da Equatorial, nesta ordem:
documentos a vencer (7, 3, 1 e 0 dias), enviados e reprovados (com o motivo do portal) e vencidos e não enviados.
Cada aviso sai uma vez e fica registrado na tabela `alerta`.

| Arquivo | O quê |
|---|---|
| `ALERTAS_ODA.html` / `.pdf` | como o alerta funciona: regras, layout do e-mail, de onde vêm os dados e operação |
| `workflow-alertas-eqt.ts` | definição do workflow no SDK do n8n (consultas, montagem do e-mail, envio e registro) |
| `../sql/2026-11-12-responsaveis-alertas.sql` | e-mails dos responsáveis por tipo de documento |

- **Onde roda:** n8n da Stant (`n8n.stant-ad.com`), workflow `Alertas EQT`. Não roda na VPS.
- **Banco:** lê `v_solicitacoes`, `documentos`, `documento_regras` e `documento_destinos`; grava só em `alerta`
  (`PRAZO_VENCIMENTO`, `DOCUMENTO_REJEITADO`, `DOCUMENTO_VENCIDO`). Credencial do n8n com o usuário `sinc_factorial`.
- **Responsável:** coluna `documento_regras.email_responsavel` (migração `001b_email_responsavel.sql`).
- **Cópia:** o nó "Enviar e-mail ao responsável" tem uma lista fixa de endereços em cópia, configurada no n8n.

## Atualizar o workflow

O arquivo `.ts` é a referência. Ao mudar o workflow no n8n, trazer a mudança para cá.
Ao salvar pelo MCP do n8n, conferir se os dois nós de banco continuam com a credencial do Neon do GesDoc:
o n8n pode ligar sozinho a credencial de outro projeto.

## Reenviar um aviso

Apagar da tabela `alerta` os registros daquele envio e rodar o workflow de novo:

```sql
SELECT date_trunc('second', criado_em) AS envio, tipo_alerta, count(*), min(id), max(id)
  FROM alerta
 WHERE tipo_alerta IN ('PRAZO_VENCIMENTO', 'DOCUMENTO_VENCIDO', 'DOCUMENTO_REJEITADO')
 GROUP BY 1, 2 ORDER BY 1 DESC;
```
