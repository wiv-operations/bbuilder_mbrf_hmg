## O que mudou

<!-- 1-2 frases descrevendo a alteração no bot (nova funcionalidade, correção, refactor). -->

## Jornadas afetadas

<!-- Marque com [x] as jornadas que o PR toca. -->

- [ ] Captação / autenticação (`hmgf2captacao`)
- [ ] Ofertas e Oportunidades (`hmgf2ofertaseoportunida`)
- [ ] Meus Pedidos (`hmlf1meuspedidos`)
- [ ] Financeiro (`hmgf1financeiroo`)
- [ ] Meu Cadastro (`hmgf1meucadastroo`)
- [ ] Ajuda e Suporte (`hmgf1ajudaesuporte`)
- [ ] Fluxo de exceções (`mbrfexcecoeshmg`)
- [ ] Finalização / NPS (`mbrffinalizarhmg`)
- [ ] Outro: _____________

## Cobertura de testes

- [ ] Rodei `bbuilder validate` localmente
- [ ] Rodei `npm run type-check` localmente
- [ ] Para cada state alterado, há um CT em `tests/jornadas.test.ts`
- [ ] Atualizei `tests/coverage.json` apontando os CTs que cobrem os states tocados
- [ ] Rodei pelo menos o smoke test (`bbuilder test -t "CT-23|CT-25|CT-20"`)

## Massas de dados

<!-- Se o PR introduz um cenário que exige nova massa de dados em QAS, listar aqui. -->

## Riscos conhecidos

<!-- Chamadas de API externas novas? Mudança em condição de saída crítica? Impacto em jornada que vai para atendimento humano? -->
