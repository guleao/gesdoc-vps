# Relatório de trabalho — Infraestrutura GesDoc / `srv2007033`

**Período:** 2026-10-01 a 2026-10-02
**Servidor:** `srv2007033.hstgr.cloud` (Hostinger, Ubuntu 24.04 LTS, KVM)
**Responsável:** Augusto Leão
**Commit de referência:** `d2abad5`

---

## Parte 1 — Resumo para apresentação

### O que foi entregue

Quatro frentes, em ordem de valor:

**1. Auditoria completa da infraestrutura.** Levantamento de 19 seções cobrindo sistema, rede, firewall, containers, bancos, segurança, backups e atualizações. Resultado: **15 achados** classificados por severidade, cada um com o comando de correção. Relatório de 1115 linhas.

**2. Backup corrigido.** O backup existente cobria **um** dos dois bancos de dados e **nenhum** dos workflows de automação. Foi substituído por um que cobre tudo, com retenção ampliada de 14 para 30 dias e validação de integridade em dois estágios.

**3. Fundação técnica para a Fase 3.** Núcleo compartilhado dos serviços Python (fila, controle de idempotência, acesso a banco), ferramenta de versionamento de schema, e três decisões de arquitetura documentadas. **59 testes automatizados**, todos passando.

**4. Correções de segurança aplicadas.** Quatro achados resolvidos e dois parcialmente, com registro de reversão para cada um.

### O número que mais importa

A auditoria encontrou um padrão que atravessava toda a infraestrutura: **nada que importa existia em dois lugares.**

| Ativo crítico | Situação encontrada | Situação atual |
|---|---|---|
| Banco de homologação | sem backup algum | ✅ backup diário |
| Workflows de automação | sem backup algum | ✅ backup diário |
| Chave de criptografia do n8n | sem backup algum | ✅ backup diário |
| Cópia dos backups fora do servidor | inexistente | 🟠 mecanismo pronto, falta credencial |
| Chave do cofre de segredos | existe em um único arquivo | ❌ **pendente** |
| Código-fonte e histórico | existe só dentro do servidor | ❌ **pendente** |

Três linhas ainda não estão verdes. Todas dependem de ação que exige credencial ou conta corporativa — detalhadas na Parte 4.

### Postura de segurança: o diagnóstico foi positivo

Vale dizer isso explicitamente, porque é incomum: a configuração de segurança do servidor está **acima da média de mercado**.

- SSH **inalcançável pela internet** — firewall aceita entrada apenas pela rede privada (Tailscale)
- Nenhuma porta de aplicação exposta; o acesso público passa por túnel Cloudflare, sem porta de entrada
- Autenticação por senha desabilitada, login de root bloqueado
- `fail2ban`, `auditd`, `AppArmor` e varredura `Lynis` todos ativos — é raro ver os quatro juntos
- Atualizações automáticas de segurança habilitadas

**Evidência objetiva:** o log de autenticação registra **1 tentativa falha**. Um servidor com SSH exposto à internet acumula milhares por dia. O firewall está fazendo o trabalho.

Zero unidade de serviço falhada, zero evento de falta de memória, zero erro de disco.

### Os achados em números

| Severidade | Total | Resolvidos | Parciais | Abertos |
|---|---|---|---|---|
| Alta | 3 | 1 | 1 | 1 |
| Média | 5 | 1 | 0 | 4 |
| Baixa | 5 | 2 | 2 | 1 |
| Informativo | 2 | 0 | 0 | 2 |

Nenhum achado indicava comprometimento, invasão ou exposição ativa. São falhas de **resiliência e higiene** — o que quebra num desastre, não o que já está quebrado.

---

## Parte 2 — Detalhamento técnico

### 2.1 Auditoria

Coleta em seis passadas via SSH. As cinco primeiras **somente leitura** — nenhuma escrita, instalação ou alteração de serviço. A sexta aplicou correções sob autorização.

Nenhum valor de senha, token ou chave privada foi lido. Arquivos de credencial foram inventariados por caminho, permissão e **nomes** de variáveis.

Entregável: `auditoria-srv2007033-2026-10-01.md` (1115 linhas, 20 seções).

### 2.2 Backup — o que mudou

| | Antes | Depois |
|---|---|---|
| Postgres produção | ✅ | ✅ |
| Postgres homologação | ❌ | ✅ |
| Workflows do n8n | ❌ | ✅ |
| Credenciais do n8n | ❌ | ✅ (cifradas) |
| Chave de criptografia do n8n | ❌ | ✅ |
| Retenção | 14 dias | **30 dias** |
| Destino | `/var/backups/postgres` | `/opt/gesdoc/backups` |
| Cópia externa | ❌ | 🟠 pronta, inerte |

**Por que o volume do n8n entra junto:** as credenciais são exportadas cifradas, de propósito — o backup não carrega segredo em texto plano. A chave que as decifra vive dentro do volume. Restaurar o banco sem o volume devolve credenciais ilegíveis. São um par.

**Validação em dois estágios:** cada arquivo passa por teste de integridade e por tamanho mínimo. O segundo existe porque um backup truncado permanece válido até o ponto do corte — o teste de integridade sozinho não detecta esse caso.

Executado duas vezes em teste. 8 arquivos gerados, todos íntegros, conteúdo conferido.

### 2.3 Fundação da Fase 3

| Entrega | Conteúdo |
|---|---|
| `gesdoc_core` | 5 módulos: configuração, travas, fila, idempotência, banco |
| Fila | Redis Streams com consumer groups, índice de banco separado do n8n |
| Idempotência | duas chaves — trava curta contra execução simultânea, marcador longo contra reprocessamento |
| Migrations | `dbmate` com SQL puro, primeira migration aplicada em homologação |
| Decisões | 3 documentos em `docs/decisoes/` |
| Testes | **59**, contra Redis real |

**Uma descoberta relevante:** o n8n já ocupava o índice 0 do Redis que o projeto iria usar. Um `FLUSHDB` acidental nesse índice derrubaria a fila do n8n. O projeto foi alocado no índice 1, com prefixo próprio de chave, e há teste automatizado garantindo que as duas aplicações não se alcançam.

**Defesa em duas camadas para a idempotência:** trava no Redis (protege durante a execução, mas é volátil) **e** índice único no banco (sobrevive a reinício do Redis, troca de instância ou falha de rede). Testado: a segunda tentativa de inserir a mesma chave é rejeitada pelo banco.

### 2.4 Correções de segurança aplicadas

| Achado | Ação | Reversão |
|---|---|---|
| Chave SSH do usuário também autorizada como root | arquivada | `/root/backup-auditoria-2026-10-01/root-authorized_keys` |
| Credencial do banco de produção legível por qualquer usuário | permissão restrita a `600` | — |
| Servidor sem swap (risco de encerramento abrupto sob pico) | 2 GB configurados | `/etc/fstab.bak-2026-10-01` |
| Política de força de senha ausente | `libpam-pwquality` instalado | — |
| Core dumps habilitados | desabilitados | — |
| Stack de proxy inativa com acesso privilegiado ao Docker | arquivada | `/root/backup-auditoria-2026-10-01/traefik-desativado` |

**Uma recomendação foi revista.** A auditoria sugeria travar a senha do root. **Não foi aplicado, e a recomendação foi retirada:** isso elimina o último caminho de recuperação pelo console do provedor. Se o `sudo` quebrar — arquivo de configuração inválido, pacote corrompido, disco em modo leitura — o login de root no console é o que resta. Num servidor sem acesso físico, manter essa porta vale mais que o ganho marginal, já que o acesso root pela rede já está bloqueado por duas vias independentes.

---

## Parte 3 — Como encontrar e verificar os commits

### 3.1 Onde o repositório está

**Importante:** o repositório existe **apenas dentro do servidor**, em `/opt/gesdoc`. Não há GitHub, GitLab ou qualquer remote configurado.

```
Caminho:  /opt/gesdoc
Branch:   main
Commits:  3
Remotes:  0
Arquivos versionados: 39
```

Isso é uma pendência, não uma escolha — ver Parte 4.

### 3.2 Acessar

O servidor só aceita conexão pela rede privada Tailscale. Com o Tailscale ativo:

```bash
ssh augusto@100.103.196.93
cd /opt/gesdoc
```

Se o Tailscale estiver fechado, abra o cliente antes — sem ele o endereço não responde.

### 3.3 Ver o histórico

```bash
# os três commits
git log --oneline

# com data e autor
git log --format='%h  %ad  %an  %s' --date=short
```

Resultado esperado:

```
d2abad5  2026-10-02  Augusto Leao  Fase 4: backup completo, cofre de backup, nucleo Python e migrations
cb1dcd6  2026-09-25  augusto       Fase 3: Redis por ambiente, banco e segredos de producao
bb0d139  2026-09-25  augusto       Fase 2: estrutura, compose hml/prd e segredos SOPS
```

### 3.4 O commit desta sessão

**Hash completo:**
```
d2abad5c0137fbd5089dac0276724baa182f26a2
```

**Hash curto:** `d2abad5` · **Data:** 2026-10-02 01:38 (-03) · **23 arquivos, +2084 / −5 linhas**

```bash
# mensagem completa (explica cada decisão)
git log -1 --format=%B d2abad5

# quais arquivos e quantas linhas cada um
git show --stat d2abad5

# o conteúdo inteiro da mudança
git show d2abad5

# só a lista de arquivos
git show --name-status d2abad5
```

### 3.5 Verificar um arquivo específico

```bash
# o modelo de dados proposto
git show d2abad5:docs/decisoes/0003-modelo-de-dados.md

# a migration
git show d2abad5:migrations/20261001160000_criar_modelo_base.sql

# o núcleo de idempotência
git show d2abad5:services/_core/gesdoc_core/idempotencia.py
```

### 3.6 Rodar os testes para confirmar

```bash
cd /opt/gesdoc
export SOPS_AGE_KEY_FILE=/home/augusto/.config/sops/age/keys.txt
sops exec-env infra/secrets/hml.enc.env 'docker run --rm \
  --network gesdoc-hml-internal -e REDIS_PASSWORD -e DATABASE_URL \
  -v /opt/gesdoc/services/_core:/src:ro python:3.12-slim \
  sh -c "cp -r /src /app && cd /app && pip install -q redis pytest . \
    && REDIS_URL=\"redis://:\$REDIS_PASSWORD@redis:6379/15\" python -m pytest -q"'
```

Esperado: `59 passed`.

### 3.7 Verificar o backup

```bash
# arquivos gerados
sudo ls -la /opt/gesdoc/backups/postgres /opt/gesdoc/backups/n8n

# integridade de todos
sudo find /opt/gesdoc/backups -name '*.gz' -exec gzip -t {} \; -print

# agendamento
sudo cat /etc/cron.d/backup-gesdoc

# log da última execução
sudo tail /var/log/backup-gesdoc.log
```

### 3.8 O que NÃO está no git

Vale saber, para não procurar no lugar errado:

| Artefato | Onde está | Versionado? |
|---|---|---|
| `backup-gesdoc.sh` | `/usr/local/bin/` | ❌ |
| `backup-offsite.sh` | `/usr/local/bin/` | ❌ |
| `dbmate` (binário) | `/usr/local/bin/` | ❌ (é binário de terceiro) |
| Agendamento | `/etc/cron.d/backup-gesdoc` | ❌ |
| Relatório da auditoria | máquina local do responsável | ❌ |
| Chave do cofre | `~/.config/sops/age/keys.txt` | ❌ (correto — nunca deve ser) |

Os dois scripts de backup **deveriam** estar versionados. Hoje só o `docs/BACKUP.md`, que os descreve, está no repositório. Se o servidor for perdido, os scripts se vão com ele. Pendência listada na Parte 4.

### 3.9 Nota de transparência sobre autoria

O commit `d2abad5` tem no rodapé a linha:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

Isso registra que a implementação foi feita com assistência de ferramenta de IA, sob direção e revisão suas. Qualquer pessoa que rode `git log` vai ver. Recomendo mencionar isso de forma natural ao apresentar — é um fato verificável no histórico, e tratá-lo abertamente é mais forte que deixar alguém descobrir depois. O trabalho de decisão, autorização de acesso, validação e priorização foi seu; a ferramenta acelerou a execução.

---

## Parte 4 — Pendências, com responsável

### Ação do responsável — bloqueiam o resto

**1. Copiar a chave do cofre para fora do servidor.** *Cinco minutos. Maior retorno de toda a lista.*

As chaves que decifram todos os segredos do projeto existem em **um único arquivo**, em `~/.config/sops/age/keys.txt`. 378 bytes. Não estão em nenhum backup — de propósito, porque guardar a chave junto do que ela protege não protege nada.

Perder esse arquivo torna os segredos **permanentemente ilegíveis**. Não há reset, não há suporte para acionar. A documentação do próprio projeto manda guardar cópia fora do servidor; isso não foi feito.

Destino recomendado: gerenciador de senhas corporativo, mais uma cópia impressa em local trancado.

**2. Criar o bucket e o token de acesso no Cloudflare R2.** *Dez minutos.*

Todo o mecanismo de cópia externa está instalado e testado. Falta só a credencial. Enquanto não houver, o backup funciona mas fica **só no disco do servidor** — e um backup que morre junto com o original não é backup. Passo a passo em `/opt/gesdoc/docs/BACKUP.md`.

**3. Revisar o modelo de dados proposto.** *Bloqueia a Fase 3.*

O modelo de dados (F3.1) não existia. Foi proposto um, com **seis suposições marcadas `[S1]`–`[S6]`** em `docs/decisoes/0003-modelo-de-dados.md`. A primeira é que o sistema obtém documentos em portais externos — se estiver errada, o modelo inteiro muda.

Está aplicado **apenas em homologação**. Produção segue com zero tabelas, esperando a revisão.

**4. Criar repositório remoto.** *Risco atual: perda total do histórico.*

Código e histórico existem só no servidor. O `.git` tem 388 KB e 3 commits. Perder o servidor hoje significa perder o histórico inteiro, não apenas os arquivos.

**5. Decidir sobre o CI/CD.** *Não iniciado.*

Travado em dois pontos: não existe repositório, e o runner do GitHub **não tem rota até o servidor** — o firewall aceita entrada apenas pela rede privada. Duas saídas viáveis: a ação oficial do Tailscale (mantém a porta fechada) ou um runner hospedado no próprio servidor. A terceira opção, abrir a porta 22 para faixas do GitHub, descartaria a melhor propriedade de segurança da infraestrutura.

### Janela de manutenção

**6. Atualizações pendentes.** 8 pacotes, **zero de segurança**. Inclui kernel novo e Docker — o pacote do Docker reinicia o serviço e interrompe os 7 containers. Precisa de janela combinada, não é tarefa silenciosa.

**7. Migrar três stacks para o cofre.** Os segredos de maior impacto — token do túnel Cloudflare, chave de criptografia do n8n, superusuário do banco de produção — seguem em texto plano, fora do cofre. Note a inversão: o cofre protege as senhas de *homologação*, enquanto as de produção ficaram fora. Recria containers de produção, então também é janela.

### Precisam de liberação de permissão

Quatro itens foram barrados por salvaguarda da ferramenta, não por decisão técnica:

| Item | Bloqueio |
|---|---|
| Consolidar configuração do SSH | reescrita remota de config SSH — risco de perda de acesso |
| Ajustar a URL de banco de produção no cofre | escrita em cofre de segredos |
| Mover segredos duplicados para o cofre | escrita em cofre de segredos |
| Remover dois volumes vazios do Docker | remoção irreversível |

São restrições razoáveis para operações em produção. Os comandos exatos estão na §20 do relatório de auditoria.

**Um detalhe importante sobre a configuração do SSH:** existe uma contradição ativa. Três arquivos definem a autenticação por senha; um diz `yes`. Hoje o valor correto prevalece por ordem de leitura, mas é frágil — renomear ou remover o arquivo que impõe `no` **liga a autenticação por senha silenciosamente**, sem erro nem aviso. Vale corrigir na próxima janela.

### Pendência menor

**8. Versionar os scripts de backup.** Vivem em `/usr/local/bin/` e não estão no git. Se o servidor for perdido, vão com ele.

---

## Parte 5 — Como apresentar

### A narrativa em três frases

> Fizemos uma auditoria completa do servidor. O diagnóstico de segurança foi positivo — a configuração está acima da média, com o SSH inalcançável pela internet e o firewall comprovadamente funcionando. O problema real era de resiliência: parte dos dados não tinha backup nenhum, e nada crítico tinha segunda cópia. Corrigimos o backup, construímos a fundação técnica da Fase 3 com 59 testes automatizados, e restam três itens que dependem de credencial corporativa.

### Se a pergunta for "estamos seguros?"

Sim, contra ataque externo — e há evidência objetiva: **1 tentativa falha de autenticação** no log, contra os milhares por dia que um servidor exposto acumula. O firewall só aceita entrada pela rede privada.

O risco real não é invasão, é **perda**. Um incidente no provedor hoje levaria embora dados, backups e a chave que decifra os segredos, porque os três viviam no mesmo disco.

### Se a pergunta for "quanto falta?"

Duas ações de responsável somam **15 minutos** e removem o risco mais grave: copiar a chave do cofre para o gerenciador de senhas, e criar o bucket no R2.

A Fase 3 depende de uma revisão de escopo — o modelo de dados não existia e foi proposto; precisa de validação de quem conhece o negócio.

### Se a pergunta for "por que não terminou tudo?"

Três categorias, e nenhuma é falta de execução:

1. **Exige credencial que o time técnico não deve criar sozinho** — conta Cloudflare, gerenciador de senhas corporativo
2. **Exige conhecimento de negócio** — o modelo de dados não pode ser inventado e aplicado em produção sem validação
3. **Exige janela de manutenção** — atualizar o Docker reinicia os containers

### O que não dizer

Não afirme que o backup está completo. **Não está** — a cópia externa está pronta mas inerte, e sem ela o backup protege contra erro humano, não contra perda do servidor. Essa distinção importa, e é melhor você fazê-la do que alguém fazer por você depois.

Não afirme que a Fase 3 está pronta. A fundação está e é sólida: 59 testes, decisões documentadas, homologação funcionando. Mas o modelo de dados é **proposta**, não decisão.

### Um ponto que merece destaque

Vale dizer que o backup anterior **parecia funcionar**. Rodava todo dia, registrava sucesso em log, mantinha retenção, validava integridade — era bem escrito. E deixava de fora um banco inteiro e todos os workflows de automação, incluindo a chave sem a qual as credenciais salvas são irrecuperáveis.

É o tipo de falha que só aparece no dia da restauração. Encontrar isso **antes** foi o resultado mais valioso da auditoria.

---

## Apêndice — Referências rápidas

| Item | Localização |
|---|---|
| Relatório da auditoria | `auditoria-srv2007033-2026-10-01.md` (máquina local) |
| Repositório | `/opt/gesdoc` no servidor |
| Commit desta sessão | `d2abad5c0137fbd5089dac0276724baa182f26a2` |
| Decisões de arquitetura | `/opt/gesdoc/docs/decisoes/` |
| Documentação do backup | `/opt/gesdoc/docs/BACKUP.md` |
| Scripts de backup | `/usr/local/bin/backup-gesdoc.sh`, `backup-offsite.sh` |
| Agendamento | `/etc/cron.d/backup-gesdoc` (diário, 03:30) |
| Log do backup | `/var/log/backup-gesdoc.log` |
| Arquivos de reversão | `/root/backup-auditoria-2026-10-01/` |
| Acesso | `ssh augusto@100.103.196.93` (requer Tailscale ativo) |
