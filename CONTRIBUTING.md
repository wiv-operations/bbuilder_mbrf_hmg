# Como contribuir com o chatbot MBRF

Este repositório hospeda os **flows** do chatbot da Central MBRF rodando no Blip Builder (tenant `mbrf`, router `hmgmbrf`). A automação deste repo garante que **cada alteração em flow.json é coberta por cenário de teste** e que **a suíte E2E roda contra o bot publicado antes de merge na `main`**.

## Ciclo de contribuição

1. Crie uma branch a partir de `main`.
2. Edite o(s) `flows/<identifier>/flow.json` localmente ou pelo canvas do Blip (nesse caso rode `bbuilder pull` antes de commitar).
3. Antes de commitar, o hook de pre-commit roda `bbuilder validate` e `npm run type-check`. Se falhar, corrija.
4. Para cada state novo ou alterado, adicione (ou atualize) um cenário em `tests/jornadas.test.ts` e aponte o CT em `tests/coverage.json`.
5. Abra o PR. O GitHub Actions roda:
   - `bbuilder validate` + `type-check`
   - Script `scripts/check-coverage.mjs` — reprova o PR se algum state alterado não tem CT no mapa.
   - Smoke test (CT-20, CT-23, CT-25) contra o bot publicado em QAS.
6. Após aprovação, o merge dispara a **suíte E2E completa**. Enquanto rodar, outros merges não são bloqueados; mas o status check sinaliza falhas.
7. Quando quiser, rode manualmente o workflow **Suite completa (manual)** pela aba Actions. Ele dispara a suíte inteira + `bbuilder diff --published` e, se detectar drift (alguém editou pelo canvas sem commitar), abre uma issue automaticamente.
8. **Publicar** continua ação manual: `bbuilder publish` roda localmente, com confirmação explícita. O CI nunca publica.

## Convenções

- **Nomes de CTs** seguem `CT-XX`. Reserve o próximo número livre em `cenarios_de_teste.md` ao criar um novo.
- **Branches**: `feature/<breve-descricao>`, `fix/<breve-descricao>`.
- **Commits**: imperativo, português, resumo em uma linha. Ex.: `ajuda-e-suporte: tratar 'Dúvidas' com retry na Sophia`.
- **Nunca** commitar `configuration.local.json`, `.env`, logs de evidência ou backups.
- **Secrets** vivem no bucket do Blip (`bbuilder bucket set`) — nunca em `flows/*/configuration.json`.

## Rodando os testes localmente

```bash
npm install                                           # uma vez
bbuilder login                                        # uma vez por máquina
bbuilder test -t "CT-23"                              # um teste específico
bbuilder test --purge                                 # suite inteira (~50 min)
node scripts/check-coverage.mjs origin/main           # simula o check de cobertura
```

As evidências ficam em `docs/evidencias/CT-XX.log` após cada rodada.

## Blip CLI em CI

A pipeline usa `bbuilder login --email ... --access-key ...` com os secrets:

- `BBUILDER_EMAIL` — e-mail da conta de serviço no Blip
- `BBUILDER_ACCESS_KEY` — chave de acesso dessa conta

A conta de serviço precisa de permissão de **leitura e teste** no router `hmgmbrf`. Não dê permissão de publicação — o CI nunca publica.

## Quando a suíte fica vermelha

- Se a falha for de **assertion** (um teste descobriu um bug), corrija o bot ou atualize a expectativa com justificativa.
- Se a falha for de **infra do Blip** (erro `LocalQuorum`, `NoHostAvailable`), o script `scripts/test-with-retry.mjs` já tenta 2 vezes com backoff. Se persistir, o pipeline sai com código 2 e marca o status como `neutral` — não bloqueia merges, mas sinaliza.
- Se o status estiver `neutral` por mais de uma hora, acione o time de operações do Blip.

## Perguntas comuns

**Posso editar pelo canvas do Blip?**
Pode, mas rode `bbuilder pull` imediatamente depois para trazer a mudança ao repo e abra um PR. Senão a próxima rodada manual do workflow "Suite completa" acusa drift.

**Preciso criar CT para mudança de posição no canvas?**
Não. O `check-coverage.mjs` já ignora mudanças só em `$position`.

**Como adicionar um CT novo?**
Siga o modelo dos CTs existentes em `tests/jornadas.test.ts`. Use `blocoA(run, email)` quando o teste precisa de autenticação. Documente o CT em `cenarios_de_teste.md` com o número reservado e aponte o(s) state(s) coberto(s) em `tests/coverage.json`.
