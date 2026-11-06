# Padrão de análise de documentos (Atlas e Bernhoeft)

Quem analisa: Atlas = Augusto · Bernhoeft = (colega). Os dois usam ESTE modelo, com as mesmas palavras, para que as análises possam ser juntadas e virar regra no robô sem retrabalho.

São duas fichas:
1. **Ficha do tipo**: a regra de um documento (vale para todas as pendências daquele tipo). Uma por documento.
2. **Ficha da pendência**: o diagnóstico de um item concreto que está travado. Uma por pendência com problema.

Regras gerais:
- **Sem CPF, nome de colaborador ou senha** nas fichas. Identificar pelo nº da pendência (#id do painel) ou pelo nº do contrato/unidade.
- Escrever o que **foi visto**, com data. Suposição vai em "Dúvidas", nunca como regra.
- Nome do documento **exatamente como aparece no portal** (copiar e colar).
- Toda dúvida tem dono: quem responde (Milena, Gabriela, Tatiana, Joana, suporte do portal…).

---

## 1. Ficha do tipo (regra do documento)

```
### Doc <nº> — <nome curto>
Analisado por: <nome> em <dd/mm/aaaa>

PORTAL
- Portal: Atlas | Bernhoeft
- Nome exato no portal: "<copiar da tela>"
- Outros nomes que já apareceram: "<…>"
- Pedido por: colaborador | unidade/filial | empresa | contrato
- Frequência: mensal | por evento (admissão, demissão, férias…) | anual | quando vence
- Prazo: <ex.: até o dia 20 do mês seguinte>
- Formato aceito: PDF único | outro: <…>
- Onde clica para subir: <caminho de telas, só se for diferente do padrão>

ORIGEM
- Sistema: Factorial | SharePoint | site externo (<qual>) | modelo do portal | e-mail
- Pasta/caminho: <ex.: 13 Auditorias/.../<ano>/<mês>/FGTS>
- Como reconhecer o arquivo: <palavras do nome do arquivo, ex.: "guia", "TRCT">
- Quem coloca o arquivo lá: <pessoa/equipe>

MONTAGEM
- Tipo: arquivo único | unir várias partes
- Ordem das partes: 1) <…> 2) <…> 3) <…>
- Fica de fora: <ex.: nota fiscal, ficha clínica>
- Um arquivo serve para: 1 pendência | todas as pendências do mês | todas da unidade

CONFERÊNCIA DO CONTEÚDO (o que tem que estar no PDF)
- Palavras que provam que é o documento certo: <…>
- Tem que bater: CPF | CNPJ/filial | nº do contrato | mês/competência | data de validade
- NÃO pode ir: <ex.: anamnese (LGPD), documento de outro contrato>
- Precisa de assinatura? sim | não

QUANDO NÃO HÁ DOCUMENTO
- Não se aplica quando: <ex.: colaborador administrativo>
- Comentário padrão (texto exato): "<…>"
- Substitui por: <ex.: eSocial no lugar da CTPS>

RISCOS / EXCEÇÕES CONHECIDAS
- <ex.: já sobe automático por outro processo — risco de envio em dobro>

DÚVIDAS (com dono)
- <pergunta> → <quem responde>

AUTOMAÇÃO (preencher depois)
- Hoje: robô sozinho | robô acha, equipe confere | só pacote quando pedem | equipe à mão
- Dá para automatizar? sim | não | depende de <…>
```

---

## 2. Ficha da pendência (diagnóstico)

```
### #<id> — Doc <nº> <nome> — <unidade ou contrato> — <competência MM/AAAA>
Analisado por: <nome> em <dd/mm/aaaa hh:mm>

SITUAÇÃO (escolher 1 da lista da seção 3): <…>
No portal agora: <status como aparece na tela + status padrão da seção 4>
O que aconteceu: <fatos, em ordem, com data>
Por quê: <causa>
O que fazer: <ação concreta>
Quem faz: <pessoa/equipe/robô>
Fica resolvido quando: <o que precisa aparecer no portal>
Evidência: <print/arquivo conferido, sem CPF>
```

---

## 3. Situações (usar SÓ estas)

| Situação | Quando usar |
|---|---|
| Pronto para enviar | Arquivo certo, conferido, portal aceita |
| Falta arquivo | O documento não existe na origem |
| Arquivo incompleto | Existe, mas falta parte (assinatura, comprovante, relação…) |
| Arquivo errado | É de outra pessoa, outro mês, outro contrato ou outro documento |
| Conteúdo proibido | Tem algo que não pode ir (ex.: dado clínico) |
| Reprovado no portal | O portal recusou; copiar o motivo |
| Aguardando o portal | Enviado e ainda não analisado / esperando predecessor |
| Precisa de ação no portal | Ex.: excluir arquivo antigo, aceitar termo, concluir carregamento |
| Não se aplica | Vai comentário padrão no lugar do documento |
| Sem acesso | A conta não tem permissão / contrato não vinculado |
| Dúvida de regra | Ninguém sabe ainda; tem pergunta aberta com dono |

## 4. Status dos portais → status padrão

| Atlas | Bernhoeft | Status padrão |
|---|---|---|
| Pending / PendingNotSent | Não Entregue | Pendente |
| Delay | Não Entregue (vencido) | Atrasado |
| (enviado) | Não Analisado | Aguardando análise |
| WaitingForPredecessors | — | Aguardando outro documento |
| Approved / Validated | Aprovado / Conforme | Aprovado |
| Rejected / DelayRejected | Reprovado / Não Conforme | Reprovado |

Ao achar um status novo em qualquer portal, acrescentar aqui (texto exato da tela).

---

## 5. Exemplos preenchidos

### Doc 9 — TRCT (Atlas)
- Portal: Atlas · Nome exato: "TRCT" · Pedido por: colaborador · Frequência: por evento (demissão)
- Origem: Factorial · documentos do colaborador / offboarding · Quem coloca: DP
- Montagem: unir · 1) TRCT 2) comprovante de pagamento do TRCT · 1 arquivo = 1 pendência
- Conteúdo: "Termo de Rescisão"; CPF do colaborador; assinatura obrigatória
- Riscos: 22 TRCT sem assinatura (20/10)
- Automação hoje: robô sozinho (sincronização Factorial)

### Documento de empresa — AVCB (Bernhoeft)
- Portal: Bernhoeft · Pedido por: contrato (competência "Documentos da empresa") · Frequência: quando vence
- Onde sobe: Carregamento Mobilização → Documentos da empresa → Etapa 6 → nuvem do documento → "Enviar para análise"
- Conteúdo: nº do contrato tem que bater (PDF de outro contrato = Arquivo errado)
- Dúvida: upload em competência "Finalizando carregamento." entra em análise sem "Concluir carregamento"? → suporte Bernhoeft
- Automação hoje: robô acha e envia só com o interruptor ligado pelo usuário

---

## 6. Como entregar
- Um arquivo por portal: `docs/analise-atlas.md` e `docs/analise-bernhoeft.md`, fichas do tipo primeiro, depois as de pendência.
- Ao terminar um tipo, a regra vai para o painel (aba 8, `DOCS36`) e para `docs/documentos-36.md`.
- Documento que aparece no Bernhoeft e não está nos 36 (ex.: AVCB, Brigada): fazer a ficha do tipo do mesmo jeito, com nº "E-<sigla>".
