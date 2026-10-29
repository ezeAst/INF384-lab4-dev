# Respuestas · Laboratorio 4
Alumno: 20213298
Presupuesto: 13 min  Métrica DORA: time to restore

## Parte 1 · Diagnóstico
### Defecto 1
- Job y etapa: smoke, etapa deploy (tenía needs: build-push, al mismo nivel que deploy)
- Problema que causa en el pipeline: smoke corre a la vez que deploy, así que prueba la versión que ya estaba en Lambda y no la nueva. Una versión que no levanta pasa igual.
- Link al commit: https://github.com/ezeAst/INF384-lab4-dev/commit/78c19785fcfe5a03ad96ec705a843fef4bf061f4
- Corrección: mover de etapa (needs: deploy)
- Evidencia: en el run https://github.com/ezeAst/INF384-lab4-dev/actions/runs/40956817656 deploy fue de 21:20:51 a 21:21:14 y smoke empezó a las 21:20:52, antes de que deploy termine. En el run corregido https://github.com/ezeAst/INF384-lab4-dev/actions/runs/40959282655 deploy termina 21:38:37 y smoke empieza 21:38:40.

### Defecto 2
- Job y etapa: smoke, post-deploy
- Problema que causa en el pipeline: smoke.sh solo verifica que /version tenga el commit correcto si existe EXPECTED_COMMIT, y el workflow no la pasaba. Smoke daba verde con cualquier versión desplegada (la anterior o la de otro PR).
- Link al commit: https://github.com/ezeAst/INF384-lab4-dev/commit/a56411731415b9ba25e7eaf107ac5ba9e3ce3156
- Corrección: ajustar configuración (EXPECTED_COMMIT: github.sha en el env del step)
- Evidencia: grep -n EXPECTED_COMMIT test/smoke/smoke.sh muestra que la validación está dentro de un if en la línea 20 que solo entra si la variable existe. En el run 40956817656 smoke salió en verde aunque deploy aún no terminaba, o sea sin verificar el commit.

### Defecto 3
- Job y etapa: sca, pre-build
- Problema que causa en el pipeline: con --include-dev-deps Trivy revisa también las dependencias de desarrollo, que no van a la imagen. Una vulnerabilidad en playwright, c8 o esbuild bloquearía el pipeline sin riesgo real en producción.
- Link al commit: https://github.com/ezeAst/INF384-lab4-dev/commit/b8e4b5f78431054ce96ca6d7120345bdaeabb377
- Corrección: ajustar configuración (se quita --include-dev-deps)
- Evidencia: el Dockerfile hace npm prune --omit=dev (línea 8). En mi máquina npm ls --all --parseable da 97 paquetes y npm ls --all --omit=dev --parseable da 38. sca revisaba 59 paquetes que no se despliegan.

### Defecto 4
- Job y etapa: load (test/load/transferir.js), post-deploy
- Problema que causa en el pipeline: el script aceptaba 400 como respuesta válida en transferir. k6 siempre manda transferencias válidas (monto 1, usuarios existentes), así que lo correcto es 200. Si transferir empezara a rechazar transferencias válidas, load no lo detectaría.
- Link al commit: https://github.com/ezeAst/INF384-lab4-dev/commit/48b9c9ea67e1895d2c6201635cc29625b0e96c09
- Corrección: modificar tests (solo acepta 200)
- Evidencia: probando el handler en local, ana a beto con monto 1 responde 200, y los 400 solo salen en casos de error (monto 99999999 da "saldo insuficiente", destino zzz da "usuario inexistente").

### Defecto 5
- Job y etapa: nivel workflow, afecta a smoke, e2e y load (post-deploy)
- Problema que causa en el pipeline: solo deploy tenía concurrency. Como PRs y main despliegan en la misma Lambda, un run puede redesplegar mientras otro sigue probando, y el primero termina validando código ajeno.
- Link al commit: https://github.com/ezeAst/INF384-lab4-dev/commit/afc20b928626ca0f72a97d83d2d462f48194246f
- Corrección: ajustar configuración (concurrency a nivel de workflow con cancel-in-progress: false)
- Evidencia: en el run 40956817656 el bloqueo de deploy duró 23 s (21:20:51 a 21:21:14), pero load siguió probando la función hasta las 21:33:46. Fueron unos 12 minutos en los que otro run podía cambiarla.

## Parte 2 · Implementación
- Link al run en verde en main: https://github.com/ezeAst/INF384-lab4-dev/actions/runs/40959282655
- Link al pull request: https://github.com/ezeAst/INF384-lab4-dev/pull/1
- Defecto de la aplicación introducido (archivo y descripción): src/util.js, en validarMonto cambié monto <= 0 por monto < 0. Ahora /transferir acepta monto 0 y responde 200 cuando debería dar 400.
- Job que debería detenerlo: unit (test "validarMonto rechaza cero")
- Link al run fallido: https://github.com/ezeAst/INF384-lab4-dev/actions/runs/40961461439

## Parte 3 · Decisión bajo restricción
Link al run medido: https://github.com/ezeAst/INF384-lab4-dev/actions/runs/40959282655

| Job | Duración (min:seg) |
|---|---|
| unit | 0:12 |
| integration | 0:10 |
| sast | 0:26 |
| sca | 0:22 |
| build-push | 0:45 |
| deploy | 0:19 |
| smoke | 0:11 |
| e2e | 1:04 |
| load | 12:14 |
| **Total** | 15:43 |

Resultado de load en ese run:
| Métrica | Valor |
|---|---|
| p90 | 82.67 ms |
| p95 | 84.56 ms |
| Máximo | 240.41 ms |
| Tasa de error | 0.00% |
| Requests por segundo | 47.57 req/s |

Conclusión sobre el comportamiento bajo carga: con 30 usuarios la API responde estable, sin errores y con p95 muy cerca de la mediana (78 ms). El máximo de 240 ms es un pico aislado, probablemente un cold start. No hay saturación.

SLO propuesto (percentil, valor, ventana) y justificación: p95 menor a 150 ms, medido en cada ejecución de load y en producción en una ventana de 28 días. Lo medido fue 84.56 ms, así que 150 ms deja margen para la variación entre runs y los cold starts, pero detecta si la API se vuelve casi el doble de lenta. Configurado en ci.yml como SLO_P95: 150 (https://github.com/ezeAst/INF384-lab4-dev/commit/620234b9e94e29373a8756c719d0cd2967b5f454).

SLA propuesto y diferencia con el SLO: 99% de las transferencias del mes en menos de 500 ms y 99.5% de disponibilidad mensual, con compensación al cliente si no se cumple. El SLO es la meta interna y el SLA es el compromiso con el cliente con penalidad. El SLA es más flojo para que el equipo tenga margen de reaccionar antes de incumplirlo.

Cambios para cumplir el presupuesto:
| Cambio | Job | Minutos recuperados |
|---|---|---|
| Stages de transferir.js de 1m/10m/1m a 30s/4m/30s (https://github.com/ezeAst/INF384-lab4-dev/commit/847bdfebff0c857ab26c0ab164839fc0faa1e044) | load | ~7 min |

Total resultante: [ ] min
Link al run en main con los cambios: https://github.com/ezeAst/INF384-lab4-dev/actions/runs/40962280165

Riesgo aceptado (defecto de la aplicación concreto y efecto en la métrica DORA asignada): con 4 min de carga en vez de 10 se puede pasar un defecto que se degrada con el tiempo. Por ejemplo, si transferir en src/wallet.js calculara el saldo sumando toda la tabla movimientos en vez de leer la columna saldo, cada transferencia sería más lenta a medida que crece la tabla. En 4 minutos el p95 seguiría bajo 150 ms y el problema aparecería recién en producción. Time to restore baja: el pipeline pasa de ~16 a ~9 min, así que el fix o el revert de ese incidente llega unos 7 minutos antes.

Decisión sobre sast (se queda / se mueve a otra etapa o evento / informativo) y razón: se queda en pre-build. Cuesta 26 s del presupuesto y corre en paralelo con unit, integration y sca, así que solo agrega unos 4 s antes de build-push. Pasarlo a informativo no ahorra presupuesto porque igual corre. Para time to restore el efecto es mínimo y evita que un fix apurado meta una vulnerabilidad y cause otro incidente.

## Declaración de uso de IA
Herramientas usadas y para qué:
