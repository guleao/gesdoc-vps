# Exceções do conector Bernhoeft (O2.1, parte Bernhoeft)

Cenários de exceção do leitor de pendências do Bernhoeft. A parte do Atlas fica para quando o conector do Atlas existir. A regra é a da O2.1: primeiro a resposta automática e, só depois que ela se esgota, a fila de intervenção.

**Implementado** quer dizer que o comportamento já está no `pendencias.js` ou no `login_auto.py`. **A implementar** fica para o conector de envio (F3.18) ou para a integração com a fila de intervenção.

| Cenário | Como se detecta | Resposta automática | Fila de intervenção | Situação |
|---|---|---|---|---|
| **Sessão expirada** | `#password` presente na página | Fecha o navegador, roda o login automático e repete o ciclo | Se o login automático falhar, alerta "login manual necessário" e sai com código 2 | Implementado |
| **Captcha falhou** | O token não sai ou o portal responde "Validação do captcha incorreta" | Até 4 tentativas com pausa crescente pelo áudio, depois a reserva paga (se houver chave) | Código 3 e alerta. Não repetir no mesmo ciclo | Implementado |
| **Credencial recusada** | Mensagem "Não foi possível entrar, verifique seus dados de acesso" | **Nenhuma:** repetir pode bloquear a conta | Alerta imediato para trocar a credencial no cofre | A implementar (hoje cai no código 3) |
| **Portal fora do ar** | Erro de rede, timeout ou HTTP 5xx no `/Home` | Até 3 tentativas com espera de 15 s × tentativa. Depois, reagenda para o próximo ciclo (30 min) | Se continuar fora por 3 ciclos seguidos, alerta | Parcial: o próximo ciclo do timer funciona como reagendamento; falta o contador de ciclos |
| **Relatório 012 não pronto** | Nenhum pedido com status "Concluido" e download, ou o último é "Sem Conteúdo" | Mantém os documentos da leitura anterior, para não gerar "SAIU" falso | Se o relatório tiver mais de 7 dias, pendência "solicitar relatório 012" | Mantém anterior: implementado. Alerta de idade: a implementar |
| **Documento inexistente na competência** | Competência sem documento esperado pela matriz de regras | Nenhuma (é uma informação, não um erro): vai para a reconciliação (O2.8) | Pendência de envio quando a regra exige o documento | Depende da O2.8 |
| **Layout ou API mudou** | Seletor essencial não aparece no prazo (`table.q-table`, `#password`, link do 012) ou o JSON do `ListarCompetenciasAjax` vem sem `data` | Screenshot (`out/falha-012.png`) e mantém o estado anterior | Alerta "layout mudou" e pausa o worker até ajuste. Sem retry em loop | Screenshot e estado anterior: implementado. Pausa: a implementar |
| **Resposta parcial** | Paginação parou antes de `recordsFiltered`, ou o xlsx não abre ou não tem o cabeçalho "Contrato" | Descarta a leitura parcial dos documentos e mantém a anterior | Alerta se repetir em 3 ciclos | Mantém anterior: implementado. Alerta: a implementar |
| **Download cancelado pelo portal** | A aba de download fecha sem arquivo | Pega a URL assinada da resposta de `/api/v1/Download` e baixa direto | Se a URL não vier em 60 s, registra falha e mantém o anterior | Implementado |
| **Sem permissão** | Rota responde "Sem Permissão" | Nenhuma | Pendência "conta sem permissão para <rota>" | A implementar (é o caso do upload hoje) |

## Códigos de saída

São os mesmos de `docs/workers/padrao.md`:
- **0:** ok.
- **1:** erro inesperado ou layout.
- **2:** sessão expirada sem renovação.
- **3:** login automático falhou.

## Alertas

Hoje os alertas vão por `ALERT_WEBHOOK_URL`, com no máximo 1 aviso igual a cada 6 h. A fila de intervenção vai receber os mesmos eventos quando existir (O2.x).
