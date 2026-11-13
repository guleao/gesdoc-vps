# Painel Solicitações ODA NIP (VPS)

Mesmo painel publicado no claude.ai, rodando na VPS: pendentes, enviados (aprovado, aguardando análise, reprovado),
alertas dos que vencem em até 7 dias, de quem é a ação, motivos, o que o sistema processou (hoje, ontem, 7 e 30 dias),
cada solicitação com filtros e os reprovados no portal.

- **Só leitura:** usa a role `painel_leitura` (só SELECT). O servidor aceita só GET e só roda as 13 consultas fixas de `consultas.json`;
  o único parâmetro é o período, validado contra `hoje | ontem | 7d | 30d`.
- **Sem dependências:** `node server.js` (Node 22), Neon pela API HTTPS, igual ao painel da automação.
- **Acesso:** só pelo Tailscale, `http://100.103.196.93:3022` (3020 = painel da automação, 3021 = proxy do Docker).
- **Atualização:** a página recarrega os dados a cada 5 minutos; o servidor guarda cada resposta por 60 s.

## Subir na VPS (primeira vez)

```bash
# 1. no PC, com o repositório atualizado: copiar a pasta para a VPS
scp -r bernhoeft-robo/deploy/gesdoc/services/painel-solicitacoes augusto@<vps>:/opt/gesdoc/services/

# 2. na VPS
cd /opt/gesdoc
sops exec-env infra/secrets/hml.enc.env 'docker compose -f services/painel-solicitacoes/compose.hml.yml up -d'
docker logs --tail 5 gesdoc-painel-solicitacoes-hml-painel-solicitacoes-1   # "Painel Solicitações ODA NIP em http://100.103.196.93:3022"
curl -s http://100.103.196.93:3022/saude                                   # {"ok":true}
```

Depois abrir `http://100.103.196.93:3022` no navegador (com o Tailscale ligado).

## Atualizar

Copiar os arquivos alterados para `/opt/gesdoc/services/painel-solicitacoes/` e `docker restart gesdoc-painel-solicitacoes-hml-painel-solicitacoes-1`.

## Rotas

| Rota | O quê |
|---|---|
| `GET /` | a página |
| `GET /api/consultas` | lista das consultas |
| `GET /api/dados/<consulta>?periodo=hoje` | linhas de uma consulta (o período só vale para `proc_*`) |
| `GET /saude` | 200 se o banco responde |

## Problemas comuns

- `PAINEL_DATABASE_URL não configurada`: o compose subiu sem o `sops exec-env`.
- `permission denied for view v_solicitacoes`: a role do cofre não é a `painel_leitura` (ou falta o GRANT das migrações 003/009).
- Nenhuma resposta na porta: o Tailscale ainda não subiu; o servidor tenta escutar de novo a cada 10 s.

## Origem

`pagina.html` = página do painel do claude.ai + um adaptador no topo (a interface `dash` lendo `/api/dados`).
`consultas.json` = as mesmas consultas do painel do claude.ai. Ao mudar uma consulta ou a página lá, trazer para cá também.
