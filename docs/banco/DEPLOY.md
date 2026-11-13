# Guia de implantação — Sincronização Factorial

Passo a passo para subir o serviço num servidor novo, do zero até rodar sozinho. Siga na ordem; cada passo diz o que conferir antes de seguir para o próximo.

O guia usa **Linux (Ubuntu 22.04 ou superior)**. Se o servidor for Windows, veja o [Anexo — Windows](#anexo--servidor-windows) no fim.

## 0. Instalação em uso hoje (VPS da Stant)

**Na VPS atual, não siga os passos 4 a 8 deste guia:** `/opt/gesdoc` lá é o repositório da infra e não pode ser sobrescrito. A sincronização roda assim, mantida pelo Augusto no repositório `guleao/gesdoc-vps`:

| O quê | Onde |
|---|---|
| Container | `/opt/gesdoc/services/sincronizacao/` (Dockerfile, `compose.hml.yml`, `rodar.py`, `cron.sh`) |
| Código deste repositório | copiado em `app/`, num commit fixo anotado em `app/VERSAO` |
| Quem chama | `rodar.py`: só os doc_id 9 e 10 (`SINC_DOCS`); sem `--gravar` apenas simula |
| Usuário do banco | `sinc_factorial` (criado por `seguranca/roles.sql` do Augusto), no cofre SOPS `infra/secrets/hml.enc.env` |
| Agendamento | crontab do `augusto`: `0 7-19/2 * * * /opt/gesdoc/services/sincronizacao/cron.sh` |
| Arquivos | `/opt/gesdoc/data/hml/sincronizacao/downloads` (= `/srv/gesdoc/downloads` no container) |
| Relatório da rodada | `/opt/gesdoc/data/hml/sincronizacao/ultima-*.json` |

**Para atualizar a versão:** no PC do Augusto, `bash publicar-sincronizacao.sh <commit>`. O script clona este repositório, faz o backup `sincronizacao-bak-<data>`, troca `app/` e roda uma simulação. Conferir o relatório e rodar uma vez com `--gravar`:

```bash
cd /opt/gesdoc && sops exec-env infra/secrets/hml.enc.env 'docker compose -f services/sincronizacao/compose.hml.yml run --rm sincronizacao --gravar'
```

O resto deste guia vale para instalar num servidor novo.

---

## 1. O que vai rodar

Duas peças, as duas a partir desta mesma pasta:

| Peça | O que faz | Como roda | Obrigatória? |
|---|---|---|---|
| **Sincronização** (`sincronizacao_factorial.py`) | Lê as pendências abertas no Neon (atrasadas e no prazo), busca e valida na Factorial, unifica os pacotes em PDF, grava o arquivo em disco e o estado no banco | Agendada (cron), **a cada 2 h das 07h às 19h** | **Sim** |
| **API** (`app.py`) | Expõe `POST /factorial/sincronizar` (rodar sob demanda, ex.: por outro sistema) e `GET /health` | Serviço permanente (systemd + gunicorn) | Opcional |

Fluxo completo do projeto:

```
[captura dos pendentes: robô Atlas → Neon]  →  [esta sincronização]  →  [envio ao Atlas: próxima etapa]
          (automação do Augusto/Luana)            (este repositório)          (ainda não implementado)
```

A sincronização só processa pendências que **já estão no Neon**. Agende-a para rodar **depois** da captura.

---

## 2. Pré-requisitos do servidor

| Item | Detalhe |
|---|---|
| Sistema | Ubuntu 22.04+ (ou outro Linux com systemd e cron) |
| Python | 3.10 ou superior (`python3 --version`) |
| Pacotes | `git`, `python3-venv` |
| Saída de rede (HTTPS) | `api.factorialhr.com` (443) e o host do Neon (`*.neon.tech`, porta 5432) |
| Disco | ~1 MB por documento processado; reserve alguns GB em `/srv/gesdoc/downloads` |
| Acesso | Usuário com `sudo` para a instalação |

```bash
sudo apt update && sudo apt install -y git python3 python3-venv
```

---

## 3. Credenciais necessárias

Tenha estes valores em mãos **antes** de começar. Nenhum deles vai para o git.

| Variável | O que é | Onde conseguir |
|---|---|---|
| `DATABASE_URL` | Conexão com o Postgres de **produção** | Console do Neon → projeto → branch **production** → *Connection string* (formato `postgresql://usuario:senha@ep-....neon.tech/neondb?sslmode=require`) |
| `FACTORIAL_API_KEY` | Chave da API da Factorial | Factorial → Configurações → Desenvolvedores / API keys. É enviada no header `x-api-key`, **sem** `Bearer` |
| `SECRET_KEY` | Chave que assina os tokens JWT da API | Gere no próprio servidor (passo 5) |
| `FACTORIAL_PASTA_DOWNLOAD` | Pasta onde os PDFs finais ficam | Use `/srv/gesdoc/downloads` |

> **Copie e cole as chaves; nunca digite.** A chave da Factorial tem centenas de caracteres e um único caractere trocado (`l`/`I`, `0`/`O`, `5`/`S`) faz a Factorial responder 401.

---

## 4. Instalação

Crie um usuário de serviço (sem login) e as pastas:

```bash
sudo useradd --system --create-home --home-dir /opt/gesdoc --shell /usr/sbin/nologin gesdoc
sudo mkdir -p /srv/gesdoc/downloads /var/log/gesdoc
sudo chown -R gesdoc:gesdoc /srv/gesdoc /var/log/gesdoc
sudo chmod 700 /srv/gesdoc/downloads
```

Clone o repositório e instale as dependências num ambiente virtual. O repositório é **privado**: a conta do GitHub usada precisa ter acesso a `evilasioferreira/gestao-documental-equatorial` (peça o convite) e, no `git clone`, use um *Personal Access Token* como senha (ou configure uma *deploy key* SSH só de leitura).

```bash
sudo -u gesdoc git clone https://github.com/evilasioferreira/gestao-documental-equatorial.git /opt/gesdoc/app
cd /opt/gesdoc/app
sudo -u gesdoc python3 -m venv .venv
sudo -u gesdoc .venv/bin/pip install -r requirements.txt
```

**Conferir:** `sudo -u gesdoc .venv/bin/python -c "import pypdf, PIL, flask; print('ok')"` imprime `ok`.

> A partir daqui, **todos os comandos rodam dentro de `/opt/gesdoc/app`**. Se aparecer `No such file or directory` para `requirements.txt`, `.env` ou um `.py`, o terminal está em outra pasta.

---

## 5. Configuração (`.env`)

Gere a `SECRET_KEY`:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Crie o `.env` a partir do modelo e preencha com os valores do passo 3:

```bash
sudo -u gesdoc cp .env.example .env
sudo -u gesdoc nano .env
```

```ini
DATABASE_URL=postgresql://usuario:senha@ep-....neon.tech/neondb?sslmode=require
SECRET_KEY=<valor gerado acima>
FACTORIAL_API_URL=https://api.factorialhr.com/api/2026-10-01/resources
FACTORIAL_API_KEY=<chave da Factorial>
FACTORIAL_PASTA_DOWNLOAD=/srv/gesdoc/downloads
```

Proteja o arquivo (só o usuário do serviço lê):

```bash
sudo chmod 600 .env
```

**Conferir as duas conexões:**

```bash
sudo -u gesdoc .venv/bin/python -c "from dotenv import load_dotenv; load_dotenv(); import os, psycopg2; psycopg2.connect(os.environ['DATABASE_URL']).close(); print('Neon ok')"
```

```bash
sudo -u gesdoc .venv/bin/python -c "from dotenv import load_dotenv; load_dotenv(); import os, requests; r = requests.get(os.environ['FACTORIAL_API_URL'] + '/employees/employees?limit=1', headers={'x-api-key': os.environ['FACTORIAL_API_KEY']}, timeout=30); print('Factorial', r.status_code)"
```

Esperado: `Neon ok` e `Factorial 200`. Se a Factorial der `401`, a chave está errada (veja o aviso do passo 3).

---

## 6. Preparar o banco (uma vez só)

**6.1 — Regras dos pacotes.** Os documentos que viram PDF único precisam estar marcados. No SQL Editor do Neon (branch production):

```sql
SELECT doc_id, nome, requer_composicao FROM documento_regras WHERE doc_id BETWEEN 2 AND 10 ORDER BY doc_id;
```

Os 9 devem estar `true`. Se algum estiver `false`:

```sql
UPDATE documento_regras SET requer_composicao = (doc_id BETWEEN 2 AND 10), atualizado_em = now()
WHERE requer_composicao IS DISTINCT FROM (doc_id BETWEEN 2 AND 10);
```

**6.2 — Regerar os arquivos no servidor.** As pendências já marcadas como prontas (`COMPOSTO`/`LOCALIZADO`) foram processadas em outra máquina, então **os PDFs não existem neste servidor**. Veja quantas são:

```sql
SELECT estado, count(*) FROM documentos
WHERE estado IN ('COMPOSTO', 'LOCALIZADO') AND caminho_origem NOT LIKE '/srv/gesdoc/%'
GROUP BY 1;
```

Volte-as para a fila para que este servidor gere os arquivos de novo (em 14/10/2026 eram 20: 8 `COMPOSTO` + 12 `LOCALIZADO`):

```sql
UPDATE documentos SET estado = 'PENDENTE_ENVIO', atualizado_em = now()
WHERE estado IN ('COMPOSTO', 'LOCALIZADO') AND caminho_origem NOT LIKE '/srv/gesdoc/%';
```

Isso não perde nada: o serviço baixa da Factorial e compõe tudo de novo no passo 7.

**6.3 — Migrações.** As migrações da pasta [`migracoes/`](migracoes/) (001 a 007) já foram aplicadas em produção, a última em 10/11/2026; não rode de novo. Num banco novo, rode-as em ordem, como `neondb_owner`. Para conferir a última:

```sql
SELECT count(*) FROM documento_regras WHERE doc_id BETWEEN 201 AND 217;  -- deve ser 17
```

**6.4 — Usuário do banco para o serviço.** O serviço não deve usar o dono do banco. Use o `sinc_factorial`, criado por SQL pelo `seguranca/roles.sql` do repositório `guleao/gesdoc-vps` (as senhas são geradas pelo `gerar-roles.js` de lá). Ponha esse usuário e a senha no `DATABASE_URL` do `.env` (passo 5).

**Não crie o usuário pelo console do Neon:** usuário criado em Roles entra no grupo `neon_superuser` e pode ler e alterar tudo (foi o caso do antigo `gesdoc_sync`).

---

## 7. Primeira execução (manual)

```bash
sudo -u gesdoc .venv/bin/python sincronizacao_factorial.py
```

A saída termina com o resumo:

```json
{
  "fluxo_id": "sinc-20261014154210",
  "pendencias": 44,
  "por_estado": {"COMPOSTO": 8, "LOCALIZADO": 12, "NAO_ENCONTRADO_FACTORIAL": 13, "AGUARDANDO_ASSINATURA": 2, "DIVERGENTE_FACTORIAL": 9},
  "alertas_novos": 0
}
```

(Os números dependem das pendências do dia; o importante é não haver erro e aparecerem `COMPOSTO`/`LOCALIZADO`.)

**Conferir:**

```bash
sudo ls -R /srv/gesdoc/downloads | head -30
```

Cada pendência resolvida tem uma pasta com o número dela; os pacotes aparecem como `doc<id>_<MM-AAAA>.pdf`, sem CPF no nome. No banco:

```sql
SELECT id, doc_id, estado, caminho_origem, tamanho_bytes FROM documentos
WHERE estado IN ('COMPOSTO', 'LOCALIZADO') ORDER BY id;
```

Todos os `caminho_origem` devem começar com `/srv/gesdoc/downloads/`.

**Rode de novo** o mesmo comando: deve terminar com `"alertas_novos": 0` e sem `COMPOSTO`/`LOCALIZADO` no resumo (o que já está pronto sai da fila).

---

## 8. Agendamento (cron)

A cada 2 horas, das 07h às 19h, todos os dias. O `flock` impede que duas execuções se sobreponham se uma demorar.

```bash
sudo crontab -u gesdoc -e
```

Adicione a linha:

```cron
0 7-19/2 * * * cd /opt/gesdoc/app && /usr/bin/flock -n /tmp/gesdoc-sinc.lock .venv/bin/python sincronizacao_factorial.py >> /var/log/gesdoc/sincronizacao.log 2>&1
```

Confira o fuso do servidor (o cron usa o horário local):

```bash
timedatectl
```

Se não estiver em `America/Sao_Paulo`: `sudo timedatectl set-timezone America/Sao_Paulo`.

**Conferir** depois do primeiro horário agendado:

```bash
tail -n 30 /var/log/gesdoc/sincronizacao.log
```

**Backup diário do banco.** O Neon guarda 7 dias de histórico; o backup próprio cobre o resto. Instale o cliente na mesma versão do servidor (`sudo apt install postgresql-client-18`) e adicione ao mesmo crontab:

```cron
30 3 * * * /opt/gesdoc/app/scripts/backup_banco.sh >> /var/log/gesdoc/backup.log 2>&1
```

Os dumps ficam em `/srv/gesdoc/backups` por 14 dias. Para manter uma cópia fora do servidor, defina `BACKUP_COPIA_CMD` (veja o cabeçalho do script). Teste a restauração num branch de teste do Neon pelo menos uma vez:

```bash
pg_restore --no-owner --dbname "<URL do branch de teste>" /srv/gesdoc/backups/<arquivo>.dump
```

Para rotacionar o log, crie `/etc/logrotate.d/gesdoc`:

```
/var/log/gesdoc/*.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
}
```

---

## 9. API (opcional)

Só é necessária se outro sistema (ex.: um n8n que apenas dispara a sincronização) for chamar `POST /factorial/sincronizar`. O agendamento do passo 8 funciona sem ela.

Crie `/etc/systemd/system/gesdoc-api.service`:

```ini
[Unit]
Description=GesDoc - API de sincronizacao Factorial
After=network-online.target
Wants=network-online.target

[Service]
User=gesdoc
WorkingDirectory=/opt/gesdoc/app
ExecStart=/opt/gesdoc/app/.venv/bin/gunicorn --workers 2 --bind 127.0.0.1:5000 --timeout 900 app:app
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

O `--timeout 900` é porque uma sincronização completa pode levar alguns minutos. A API escuta só em `127.0.0.1`; para acesso externo, coloque um proxy com HTTPS (nginx/Caddy) na frente — não exponha a porta 5000 direto.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gesdoc-api
sudo systemctl status gesdoc-api
```

**Conferir:**

```bash
curl -s http://127.0.0.1:5000/health
```

Esperado: `"database": "conectado"`. Para chamar as rotas protegidas, gere um token (vale 30 dias, assinado com a `SECRET_KEY` do `.env`):

```bash
sudo -u gesdoc .venv/bin/python generate_jwt_token.py
```

```bash
curl -s -X POST http://127.0.0.1:5000/factorial/sincronizar -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"ids": [119]}'
```

Sem `ids`, processa todas as pendências elegíveis. Se a Factorial recusar a chave, a rota responde `502` e não altera nada.

Logs da API: `journalctl -u gesdoc-api -n 100` e `/opt/gesdoc/app/logs/`.

---

## 10. Testes automatizados no servidor (recomendado)

Precisa de um **branch de teste** do Neon (os testes gravam e apagam dados; nunca use produção). No console do Neon, crie um branch a partir de production e anote a connection string e o identificador do endpoint (`ep-...`). Crie `/opt/gesdoc/app/.env.test`:

```ini
TEST_DATABASE_URL=postgresql://usuario:senha@ep-branch-de-teste....neon.tech/neondb?sslmode=require
TEST_BRANCH_ID=ep-branch-de-teste
```

No branch de teste, aplique o mesmo SQL do passo 6.1. Depois:

```bash
sudo chmod 600 .env.test
sudo -u gesdoc .venv/bin/python -m pytest tests -q
```

Esperado: `42 passed`. A Factorial é simulada nos testes; nada é chamado na Factorial real.

---

## 11. Operação do dia a dia

**O que cada estado significa e o que fazer:**

| Estado | Significa | Ação |
|---|---|---|
| `COMPOSTO` / `LOCALIZADO` | Arquivo pronto em `caminho_origem` | Nenhuma (aguarda o envio ao Atlas) |
| `NAO_ENCONTRADO_FACTORIAL` | Falta item na Factorial (ex.: aviso de férias, comprovante) | RH sobe o arquivo na Factorial **com o tipo no nome** (ex.: "aviso de férias", "comprovante"). A próxima execução resolve sozinha |
| `AGUARDANDO_ASSINATURA` | Documento existe mas não está assinado | Colher a assinatura. A próxima execução resolve sozinha |
| `DIVERGENTE_FACTORIAL` | CPF não existe na Factorial, ou o Atlas cobra rescisão de quem está **ativo** | Conferir com o RH; a Factorial é a fonte da verdade (provável cobrança indevida no Atlas) |
| `ERRO_COMPOSICAO` | Um item não é PDF nem imagem | Substituir o arquivo na Factorial por PDF |

**Consultas úteis** (SQL Editor do Neon):

```sql
-- Situação geral
SELECT d.estado, count(*) FROM documentos d JOIN documento_regras r ON r.doc_id = d.doc_id
WHERE d.aba = 'Atrasados' AND r.origem = 'Factorial' AND d.cpf IS NOT NULL GROUP BY 1 ORDER BY 1;

-- Pendências que precisam de ação, com o motivo
SELECT a.documento_id, d.funcionario, d.nome, a.descricao, a.criado_em
FROM alerta a JOIN documentos d ON d.id = a.documento_id
WHERE d.estado IN ('NAO_ENCONTRADO_FACTORIAL', 'AGUARDANDO_ASSINATURA', 'DIVERGENTE_FACTORIAL', 'ERRO_COMPOSICAO')
ORDER BY a.criado_em DESC;
```

**Reprocessar uma pendência específica** (ex.: id 119):

```sql
UPDATE documentos SET estado = 'PENDENTE_ENVIO' WHERE id = 119;
```

e rode o passo 7 (ou chame a API com `{"ids": [119]}`).

---

## 12. Atualizar para uma versão nova

```bash
cd /opt/gesdoc/app
sudo -u gesdoc git pull
sudo -u gesdoc .venv/bin/pip install -r requirements.txt
sudo -u gesdoc .venv/bin/python -m pytest tests -q
sudo systemctl restart gesdoc-api   # só se a API estiver instalada
```

O cron passa a usar a versão nova na próxima execução.

---

## 13. Segurança e dados pessoais (LGPD)

- `/srv/gesdoc/downloads` contém **documentos trabalhistas com CPF**: mantenha `chmod 700`, dono `gesdoc`, e inclua no backup só se o backup também for protegido.
- `.env` e `.env.test` com `chmod 600`; nunca commitar (o `.gitignore` já cobre).
- Os logs (`logs/`, `/var/log/gesdoc/`) podem conter nomes e CPFs: não compartilhe sem anonimizar.
- **Troque as credenciais que já circularam**: a chave da Factorial e a senha do `neondb_owner` aparecem no histórico antigo do git. Gere uma chave nova na Factorial e redefina a senha no Neon antes de colocar em produção, e use os valores novos no `.env`.

---

## 14. Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| `No such file or directory` (`requirements.txt`, `.env`, `.py`) | Terminal fora de `/opt/gesdoc/app`: rode `cd /opt/gesdoc/app` |
| `requests.exceptions.HTTPError: 401` / `{"errors": null}` | `FACTORIAL_API_KEY` errada ou com espaço/quebra de linha: copie e cole de novo. O header é `x-api-key`, sem `Bearer` |
| `DATABASE_URL não configurada` / `SECRET_KEY não configurada` | `.env` ausente, com nome errado, ou rodando de outra pasta |
| `psycopg2.OperationalError` | Sem saída para o Neon na porta 5432, ou senha do banco errada |
| Cron não roda | `sudo crontab -u gesdoc -l` para conferir a linha; veja `/var/log/gesdoc/sincronizacao.log` e `grep CRON /var/log/syslog` |
| Execução "pulada" sem log | O `flock` encontrou a anterior ainda rodando — normal; se for sempre, veja por que a anterior trava |
| `PermissionError` em `/srv/gesdoc/downloads` | Rode como `gesdoc` (`sudo -u gesdoc ...`) e confira `chown -R gesdoc:gesdoc /srv/gesdoc` |
| `Token não fornecido` / `Token inválido` na API | Gere token novo com `generate_jwt_token.py` (expira em 30 dias) no mesmo servidor, com a mesma `SECRET_KEY` |
| `TEST_DATABASE_URL ausente…` nos testes | Falta `.env.test`, ou `TEST_BRANCH_ID` não está dentro da URL |

---

## 15. Checklist final

- [ ] Credenciais novas (Factorial e Neon) geradas e no `.env`
- [ ] `.env` com `chmod 600`; `/srv/gesdoc/downloads` com `chmod 700`
- [ ] `Neon ok` e `Factorial 200` no passo 5
- [ ] `requer_composicao` = `true` nos doc_id 2 a 10 (passo 6.1)
- [ ] Pendências antigas voltadas para a fila (passo 6.2)
- [ ] Primeira execução manual sem erro e `caminho_origem` apontando para `/srv/gesdoc/downloads/` (passo 7)
- [ ] Segunda execução com `"alertas_novos": 0`
- [ ] Cron instalado e primeira execução agendada registrada no log (passo 8)
- [ ] (Se usar) API respondendo `/health` com `"database": "conectado"` (passo 9)
- [ ] (Recomendado) `42 passed` nos testes contra o branch de teste (passo 10)

---

## Anexo — Servidor Windows

Mesma lógica, com estas diferenças:

1. Instale Python 3.10+ (marque "Add to PATH") e Git. Clone em, por exemplo, `C:\gesdoc\app`.
2. Na pasta do projeto: `py -3 -m venv .venv` e `.venv\Scripts\pip install -r requirements.txt`.
3. No `.env`, use `FACTORIAL_PASTA_DOWNLOAD=C:\gesdoc\downloads`; no passo 6.2 troque `'/srv/gesdoc/%'` por `'C:\\gesdoc\\%'` (no `LIKE` do Postgres a barra invertida precisa ser dobrada).
4. Agendamento: **Agendador de Tarefas** → Criar Tarefa → Disparador diário às 07:00, repetir a cada 2 horas por 12 horas → Ação: programa `C:\gesdoc\app\.venv\Scripts\python.exe`, argumentos `sincronizacao_factorial.py`, **"Iniciar em"** `C:\gesdoc\app` (sem isso o `.env` não é encontrado) → em Configurações, "Não iniciar nova instância" se já estiver rodando.
5. API: o `gunicorn` não roda no Windows; use `.venv\Scripts\python app.py` (porta 5000) como serviço via NSSM, ou dispense a API e use só o agendamento.
6. Para `curl` no PowerShell, use `curl.exe`.
