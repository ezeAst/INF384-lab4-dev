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
- Corrección: ajustar configuración (agregué `EXPECTED_COMMIT: ${{ github.sha }}` al env del step)
- Evidencia: corrí en mi máquina:
  ```
  $ grep -n EXPECTED_COMMIT test/smoke/smoke.sh
  20:if [ -n "${EXPECTED_COMMIT:-}" ]; then
  23:    if [ "$commit" = "$EXPECTED_COMMIT" ]; then
  ```
  La validación está dentro de un if, y sin la variable nunca entra. En el run https://github.com/ezeAst/INF384-lab4-dev/actions/runs/40956817656 smoke salió en verde (21:20:52 - 21:21:24) aunque deploy todavía no había terminado (21:21:14), así que pasó sin comprobar el commit.

### Defecto 3
- Job y etapa: sca, pre-build
- Problema que causa en el pipeline: con `--include-dev-deps` Trivy también revisa las dependencias de desarrollo (playwright, c8, esbuild y todo lo que traen), pero esas no llegan a la imagen porque el Dockerfile hace `npm prune --omit=dev`. Si sale una vulnerabilidad HIGH en alguna de esas herramientas, el pipeline se cae por algo que no está en producción.
- Link al commit: https://github.com/ezeAst/INF384-lab4-dev/commit/b8e4b5f78431054ce96ca6d7120345bdaeabb377
- Corrección: ajustar configuración (saqué la línea `--include-dev-deps`)
- Evidencia: en mi máquina:
  ```
  $ grep -n npm Dockerfile
  5:RUN npm ci
  8:RUN npm run build && npm prune --omit=dev
  $ npm ls --all --parseable | tail -n +2 | wc -l
  97
  $ npm ls --all --omit=dev --parseable | tail -n +2 | wc -l
  38
  ```
  sca revisaba 97 paquetes cuando a la imagen solo van 38, los otros 59 son de desarrollo.

### Defecto 4
- Job y etapa: load (test/load/transferir.js), post-deploy
- Problema que causa en el pipeline: el script acepta 400 como respuesta válida (`expectedStatuses(200, 400)` y el check 'transferir 200 o 400'). Pero k6 siempre manda usuarios que existen, distintos y con monto 1, entonces lo correcto siempre es 200. Si /transferir empezara a responder 400 a transferencias válidas, load no lo marcaría como error y pasaría igual.
- Link al commit: https://github.com/ezeAst/INF384-lab4-dev/commit/48b9c9ea67e1895d2c6201635cc29625b0e96c09
- Corrección: modificar tests (ahora solo acepta 200 y el check se llama 'transferir 200')
- Evidencia: llamé al handler en local con distintos casos:
  ```
  {"origen":"ana","destino":"beto","monto":1} -> 200 {"id":1,"origen":"ana","destino":"beto","monto":1,"saldoOrigen":999}
  {"origen":"ana","destino":"beto","monto":99999999} -> 400 {"error":"saldo insuficiente"}
  {"origen":"ana","destino":"zzz","monto":1} -> 400 {"error":"usuario inexistente"}
  ```
  Un request como el de k6 da 200; el 400 solo sale cuando algo está mal, y antes el script lo contaba como OK.

### Defecto 5
- Job y etapa: es a nivel de todo el workflow (ci.yml), afecta a smoke, e2e y load que están en post-deploy
- Problema que causa en el pipeline: solo deploy tenía concurrency. Como cada PR y cada push a main despliegan en la misma Lambda, si hay dos runs a la vez uno puede redesplegar mientras el otro todavía está corriendo e2e o load, y el primero termina probando el código del segundo.
- Link al commit: https://github.com/ezeAst/INF384-lab4-dev/commit/afc20b928626ca0f72a97d83d2d462f48194246f
- Corrección: ajustar configuración (concurrency con group `ci-lambda-${{ github.repository }}` y cancel-in-progress: false a nivel de workflow)
- Evidencia: en el run https://github.com/ezeAst/INF384-lab4-dev/actions/runs/40956817656 el bloqueo de deploy solo duró 23 s (21:20:51 - 21:21:14), pero las pruebas contra la función siguieron hasta 21:33:46 (load fue de 21:21:28 a 21:33:46). Fueron como 12 minutos y medio en los que otro run podía cambiar la función. Con el cambio todo el run se ejecuta uno a la vez.

## Parte 2 · Implementación
- Link al run en verde en main: https://github.com/ezeAst/INF384-lab4-dev/actions/runs/40959282655
- Link al pull request: https://github.com/ezeAst/INF384-lab4-dev/pull/1
- Defecto de la aplicación introducido (archivo y descripción): en src/util.js, en validarMonto cambié `monto <= 0` por `monto < 0`. Con eso se acepta un monto de 0, entonces POST /transferir con monto 0 responde 200 y registra un movimiento vacío, cuando según las reglas debería devolver 400.
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
| p90 | |
| p95 | |
| Máximo | |
| Tasa de error | |
| Requests por segundo | |

Conclusión sobre el comportamiento bajo carga:

SLO propuesto (percentil, valor, ventana) y justificación:

SLA propuesto y diferencia con el SLO:

Cambios para cumplir el presupuesto:
| Cambio | Job | Minutos recuperados |
|---|---|---|

Total resultante: [ ] min
Link al run en main con los cambios:

Riesgo aceptado (defecto de la aplicación concreto y efecto en la métrica DORA asignada):

Decisión sobre sast (se queda / se mueve a otra etapa o evento / informativo) y razón:

## Declaración de uso de IA
Herramientas usadas y para qué:
