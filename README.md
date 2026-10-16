# bbuilder_mbrf_hmg

Flows e suíte E2E do chatbot da **Central MBRF** no Blip Builder.
Ambiente alvo: QAS (`https://qas.central-brf.com.br`) · tenant `mbrf` · router `hmgmbrf`.

## Mapa do repositório

```
flows/<identifier>/      flow.json, configuration.json, global-actions.json
backup/                  cópias intocáveis para bbuilder restore
tests/
  jornadas.test.ts       20 cenários E2E
  helpers/e2e.ts         harness: Bloco A, coleta de mensagens, logs
  coverage.json          mapa stateId → CTs
scripts/
  check-coverage.mjs     usado no PR para reprovar states sem teste
  test-with-retry.mjs    envolve bbuilder test com retry em erro de infra
.github/
  workflows/             CI (PR, merge, noturno)
  CODEOWNERS             dono de cada caminho
cenarios_de_teste.md     catálogo oficial dos 52 cenários mapeados
docs/
  relatorio-testes-e2e.* última execução
  prd-cenarios-executados.md    PRD do que a suíte garante
  evidencias/            logs CT-XX.log por rodada
```

## CI

| Gatilho | Workflow | O que roda | Tempo |
|---|---|---|---|
| PR → `main` | `ci-pr.yml` | validate + type-check + cobertura + smoke (3 CTs) | ~5 min |
| Push em `main` | `ci-merge.yml` | suíte completa com retry | ~50 min |
| Manual (botão **Run workflow**) | `suite-completa.yml` | suíte completa + diff drift + abre issue se diverge | ~55 min |

**Publicação (`bbuilder publish`)** continua sendo ação manual com confirmação. O CI nunca publica.

## Começando

```bash
npm install
bbuilder login
bbuilder validate
bbuilder test -t "CT-23"      # roda um teste rápido para checar auth
```

Para abrir um PR, siga o [CONTRIBUTING.md](CONTRIBUTING.md).

## Status

![PR checks](https://github.com/wiv-operations/bbuilder_mbrf_hmg/actions/workflows/ci-pr.yml/badge.svg)
![Suite E2E](https://github.com/wiv-operations/bbuilder_mbrf_hmg/actions/workflows/ci-merge.yml/badge.svg)
![Suite completa (manual)](https://github.com/wiv-operations/bbuilder_mbrf_hmg/actions/workflows/suite-completa.yml/badge.svg)
