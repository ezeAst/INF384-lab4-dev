# Respuestas · Laboratorio 4
Alumno: 20213298
Presupuesto: 13 min  Métrica DORA: time to restore

## Parte 1 · Diagnóstico
### Defecto 1
- Job y etapa: smoke, etapa deploy (estaba con needs: build-push, o sea al mismo nivel que deploy)
- Problema que causa en el pipeline: smoke arranca a la vez que deploy, entonces termina probando lo que ya estaba en Lambda y no la versión nueva. Si la versión nueva no levanta, smoke igual pasa. Además e2e y load dependen de smoke, así que también pueden empezar antes de que el deploy termine.
- Link al commit: https://github.com/ezeAst/INF384-lab4-dev/commit/78c19785fcfe5a03ad96ec705a843fef4bf061f4
- Corrección: mover de etapa (ahora smoke tiene needs: deploy)
- Evidencia: en el run https://github.com/ezeAst/INF384-lab4-dev/actions/runs/40956817656 deploy fue de 21:20:51 a 21:21:14 y smoke de 21:20:52 a 21:21:24, o sea smoke empezó 1 segundo después de deploy, sin esperar a que acabe. En el run ya corregido https://github.com/ezeAst/INF384-lab4-dev/actions/runs/40959282655 deploy termina 21:38:37 y recién ahí smoke empieza (21:38:40).

### Defecto 2
- Job y etapa: smoke, post-deploy (step Smoke)
- Problema que causa en el pipeline: smoke.sh solo revisa que /version devuelva el commit correcto si existe la variable EXPECTED_COMMIT, pero en el ci.yml no se le pasaba. Entonces smoke solo veía que /salud y /saldo/ana respondan, sin importar qué versión estaba desplegada (podía ser la anterior o la de otro PR, ya que todos usan la misma función).
- Link al commit: https://github.com/ezeAst/INF384-lab4-dev/commit/a56411731415b9ba25e7eaf107ac5ba9e3ce3156
- Corrección: ajustar configuración (agregué EXPECTED_COMMIT: ${{ github.sha }} al env del step)
- Evidencia: corrí grep -n EXPECTED_COMMIT test/smoke/smoke.sh en mi máquina y salió que la variable se usa en la línea 20 (if [ -n "${EXPECTED_COMMIT:-}" ]; then) y en la 23 (if [ "$commit" = "$EXPECTED_COMMIT" ]; then). La validación está dentro de un if, y sin la variable nunca entra. En el run https://github.com/ezeAst/INF384-lab4-dev/actions/runs/40956817656 smoke salió en verde (21:20:52 - 21:21:24) aunque deploy todavía no había terminado (21:21:14), así que pasó sin comprobar el commit.

### Defecto 3
- Job y etapa: sca, pre-build
- Problema que causa en el pipeline: con --include-dev-deps Trivy también revisa las dependencias de desarrollo (playwright, c8, esbuild y todo lo que traen), pero esas no llegan a la imagen porque el Dockerfile hace npm prune --omit=dev. Si sale una vulnerabilidad HIGH en alguna de esas herramientas, el pipeline se cae por algo que no está en producción.
- Link al commit: https://github.com/ezeAst/INF384-lab4-dev/commit/b8e4b5f78431054ce96ca6d7120345bdaeabb377
- Corrección: ajustar configuración (saqué la línea --include-dev-deps)
- Evidencia: en mi máquina, grep -n npm Dockerfile muestra en la línea 8 "RUN npm run build && npm prune --omit=dev", o sea que la imagen se queda sin las dependencias de desarrollo. Luego conté los paquetes del lock: npm ls --all --parseable dio 97 y npm ls --all --omit=dev --parseable dio 38. sca revisaba 97 paquetes cuando a la imagen solo van 38, los otros 59 son de desarrollo.

### Defecto 4
- Job y etapa: load (test/load/transferir.js), post-deploy
- Problema que causa en el pipeline: el script acepta 400 como respuesta válida (expectedStatuses(200, 400) y el check 'transferir 200 o 400'). Pero k6 siempre manda usuarios que existen, distintos y con monto 1, entonces lo correcto siempre es 200. Si /transferir empezara a responder 400 a transferencias válidas, load no lo marcaría como error y pasaría igual.
- Link al commit: https://github.com/ezeAst/INF384-lab4-dev/commit/48b9c9ea67e1895d2c6201635cc29625b0e96c09
- Corrección: modificar tests (ahora solo acepta 200 y el check se llama 'transferir 200')
- Evidencia: llamé al handler en local con tres casos. De ana a beto con monto 1 respondió 200 con saldoOrigen 999. De ana a beto con monto 99999999 respondió 400 "saldo insuficiente". De ana a zzz con monto 1 respondió 400 "usuario inexistente". Un request como el de k6 da 200; el 400 solo sale cuando algo está mal, y antes el script lo contaba como OK.

### Defecto 5
- Job y etapa: es a nivel de todo el workflow (ci.yml), afecta a smoke, e2e y load que están en post-deploy
- Problema que causa en el pipeline: solo deploy tenía concurrency. Como cada PR y cada push a main despliegan en la misma Lambda, si hay dos runs a la vez uno puede redesplegar mientras el otro todavía está corriendo e2e o load, y el primero termina probando el código del segundo.
- Link al commit: https://github.com/ezeAst/INF384-lab4-dev/commit/afc20b928626ca0f72a97d83d2d462f48194246f
- Corrección: ajustar configuración (concurrency con group ci-lambda-${{ github.repository }} y cancel-in-progress: false a nivel de workflow)
- Evidencia: en el run https://github.com/ezeAst/INF384-lab4-dev/actions/runs/40956817656 el bloqueo de deploy solo duró 23 s (21:20:51 - 21:21:14), pero las pruebas contra la función siguieron hasta 21:33:46 (load fue de 21:21:28 a 21:33:46). Fueron como 12 minutos y medio en los que otro run podía cambiar la función. Con el cambio todo el run se ejecuta uno a la vez.

## Parte 2 · Implementación
- Link al run en verde en main: https://github.com/ezeAst/INF384-lab4-dev/actions/runs/40959282655
- Link al pull request: https://github.com/ezeAst/INF384-lab4-dev/pull/1
- Defecto de la aplicación introducido (archivo y descripción): en src/util.js, en validarMonto cambié monto <= 0 por monto < 0. Con eso se acepta un monto de 0, entonces POST /transferir con monto 0 responde 200 y registra un movimiento vacío, cuando según las reglas debería devolver 400.
- Job que debería detenerlo: unit (test/unit/util.test.js tiene el test "validarMonto rechaza cero" y wallet.test.js "transferir con monto invalido es 400")
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
| Tasa de error | 0.00% (0 de 34264) |
| Requests por segundo | 47.57 req/s |

Conclusión sobre el comportamiento bajo carga: con 30 usuarios por 12 minutos Monedero Andino aguanta sin problema. No falló ningún request y la latencia es bien estable: la mediana es 78 ms y el p95 84.56 ms, casi lo mismo. El máximo de 240 ms es un caso aislado, probablemente un cold start de alguna instancia nueva de Lambda. No se ve que la latencia vaya subiendo con el tiempo, así que con esta carga no hay saturación. El SLO_P95 que estaba (500 ms) quedaba muy lejos de lo medido y casi no servía para detectar una degradación.

SLO propuesto (percentil, valor, ventana) y justificación: p95 de la latencia de los requests (transferir y saldo) menor a 150 ms, medido en cada ejecución de load (ventana = los 5 min del test, 4 de carga constante) y en producción en una ventana móvil de 28 días. El p95 medido fue 84.56 ms, así que 150 ms deja ~65 ms de margen (casi el doble) para la variación normal entre runs y los cold starts, y load no se cae por ruido. Al mismo tiempo, si un cambio hace que la API se vuelva casi 2 veces más lenta, load lo detiene. Lo configuré en ci.yml como SLO_P95: 150 ({R}/commit/620234b9e94e29373a8756c719d0cd2967b5f454).

SLA propuesto y diferencia con el SLO: el 99% de las transferencias del mes responde en menos de 500 ms y la API está disponible el 99.5% del mes; si no se cumple, se compensa al cliente (por ejemplo, con un crédito). El SLO es la meta interna del equipo y el SLA es lo que se le promete al cliente con consecuencias si no se cumple. Por eso el SLA es más flojo que el SLO (500 ms vs 150 ms, p99 mensual vs p95): si el SLO se rompe, el equipo tiene tiempo para reaccionar antes de llegar a incumplir el SLA y tener que pagar.

Cambios para cumplir el presupuesto:
| Cambio | Job | Minutos recuperados |
|---|---|---|
| Stages de test/load/transferir.js de 1m/10m/1m a 30s/4m/30s (4 min de carga constante, el mínimo permitido) ({R}/commit/847bdfebff0c857ab26c0ab164839fc0faa1e044) | load | ~7 min (de 12:14 a ~5:14) |

Total resultante: [ ] min
Link al run en main con los cambios:

Riesgo aceptado (defecto de la aplicación concreto y efecto en la métrica DORA asignada): con load corriendo 4 minutos en vez de 10 se mandan como 11 mil requests en vez de 34 mil. Un defecto que solo empeora con el tiempo se nos puede pasar. Por ejemplo, si en src/wallet.js transferir calcula el saldo del origen sumando todos sus movimientos (leyendo la tabla movimientos completa) en vez de leer la columna saldo, cada transferencia se vuelve un poco más lenta a medida que crece la tabla: en 4 minutos el p95 todavía queda bajo 150 ms, pero después de más tiempo en producción lo pasaría. Ese defecto llegaría a producción y se detectaría tarde, por el monitoreo o por los clientes. Para time to restore el efecto es que baja: el pipeline pasa de ~16 a ~9 min, entonces el revert o el fix de ese incidente (o de cualquier otro) llega a producción unos 7 minutos antes. El costo de este riesgo se ve más en change failure rate (pasan más cambios malos), pero la métrica que me tocó mejora.

Decisión sobre sast (se queda / se mueve a otra etapa o evento / informativo) y razón: se queda en pre-build bloqueando. Cuesta 0:26 de los 13 min del presupuesto (3%) y corre en paralelo con unit, integration y sca, así que en tiempo real solo agrega ~4 s antes de build-push (el más lento del resto es sca con 0:22). Moverlo o pasarlo a informativo no ahorra presupuesto, porque el job sigue corriendo y sumando sus 26 s. Para time to restore casi no cambia nada (unos segundos más por fix), y evita que un fix hecho apurado durante un incidente meta una vulnerabilidad y genere otro incidente, lo que sí subiría el tiempo de restauración.

## Declaración de uso de IA
Herramientas usadas y para qué:
