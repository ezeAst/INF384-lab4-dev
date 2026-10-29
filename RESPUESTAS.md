# Respuestas · Laboratorio 4
Alumno: 20213298
Presupuesto: [ ] min  Métrica DORA: [ ]

## Parte 1 · Diagnóstico
### Defecto 1
- Job y etapa: `smoke`, en la etapa deploy (tenía `needs: build-push`, al mismo nivel que `deploy`).
- Problema que causa en el pipeline: smoke corre en paralelo con el despliegue, así que prueba la versión anterior que sigue en Lambda (o falla si la función aún no existe). Deja pasar una versión nueva que no arranca, y como `e2e` y `load` dependen de smoke, también arrancan antes de que termine el deploy.
- Link al commit: https://github.com/ezeAst/INF384-lab4-dev/commit/78c19785fcfe5a03ad96ec705a843fef4bf061f4
- Corrección: mover de etapa (smoke pasa a post-deploy con `needs: deploy`).
- Evidencia: en el run previo https://github.com/ezeAst/INF384-lab4-dev/actions/runs/40956817656 (job `deploy` 21:20:51 → 21:21:14 y job `smoke` 21:20:52 → 21:21:24), smoke empezó 1 s después que deploy y antes de que este terminara. En el run con la corrección https://github.com/ezeAst/INF384-lab4-dev/actions/runs/40959282655, deploy terminó a las 21:38:37 y smoke empezó a las 21:38:40.

### Defecto 2
- Job y etapa: `smoke`, en la etapa post-deploy (step "Smoke").
- Problema que causa en el pipeline: `test/smoke/smoke.sh` solo compara `/version.commit` con el commit esperado si `EXPECTED_COMMIT` está definido, y el workflow no lo pasaba. Smoke daba verde con cualquier versión que respondiera `/salud` y `/saldo/ana`, aunque fuera la imagen anterior o la de otro PR (todos despliegan en la misma función).
- Link al commit: https://github.com/ezeAst/INF384-lab4-dev/commit/a56411731415b9ba25e7eaf107ac5ba9e3ce3156
- Corrección: ajustar configuración (`EXPECTED_COMMIT: ${{ github.sha }}` en el env del step).
- Evidencia: salida local:
  ```
  $ grep -n EXPECTED_COMMIT test/smoke/smoke.sh
  20:if [ -n "${EXPECTED_COMMIT:-}" ]; then
  23:    if [ "$commit" = "$EXPECTED_COMMIT" ]; then
  ```
  En el run previo https://github.com/ezeAst/INF384-lab4-dev/actions/runs/40956817656, el job `smoke` (21:20:52 → 21:21:24) se puso en verde aunque corrió mientras `deploy` todavía no terminaba (21:21:14). Pasó sin verificar qué commit estaba desplegado.

### Defecto 3
- Job y etapa: `sca`, en la etapa pre-build.
- Problema que causa en el pipeline: con `--include-dev-deps`, Trivy analiza también las dependencias de desarrollo (`@playwright/test`, `c8`, `esbuild` y su árbol), que no se despliegan porque el Dockerfile hace `npm prune --omit=dev`. Una CVE HIGH/CRITICAL en una herramienta de test bloquearía el build sin que exista riesgo en producción (falsos positivos que bloquean y hacen perder tiempo).
- Link al commit: https://github.com/ezeAst/INF384-lab4-dev/commit/b8e4b5f78431054ce96ca6d7120345bdaeabb377
- Corrección: ajustar configuración (se quita `--include-dev-deps`).
- Evidencia: salida local:
  ```
  $ grep -n npm Dockerfile
  5:RUN npm ci
  8:RUN npm run build && npm prune --omit=dev
  $ npm ls --all --parseable | tail -n +2 | wc -l
  97
  $ npm ls --all --omit=dev --parseable | tail -n +2 | wc -l
  38
  ```
  Sca analizaba 97 paquetes, aunque solo 38 llegan a la imagen; los 59 restantes son de desarrollo.

### Defecto 4
- Job y etapa: `load` (`test/load/transferir.js`), en la etapa post-deploy.
- Problema que causa en el pipeline: `http.expectedStatuses(200, 400)` y el check `'transferir 200 o 400'` cuentan un 400 como éxito. La carga usa usuarios semilla válidos, distintos entre sí y con `monto: 1`, así que la respuesta correcta siempre es 200. Si `/transferir` rechazara transferencias válidas con 400 (por ejemplo, "saldo insuficiente" o "usuario inexistente" por error), `http_req_failed` y `checks` seguirían en verde, porque load no lo detecta.
- Link al commit: https://github.com/ezeAst/INF384-lab4-dev/commit/48b9c9ea67e1895d2c6201635cc29625b0e96c09
- Corrección: modificar tests (`expectedStatuses(200)` y check `'transferir 200'`).
- Evidencia: salida local, invocando `src/handler.js`:
  ```
  {"origen":"ana","destino":"beto","monto":1} -> 200 {"id":1,"origen":"ana","destino":"beto","monto":1,"saldoOrigen":999}
  {"origen":"ana","destino":"beto","monto":99999999} -> 400 {"error":"saldo insuficiente"}
  {"origen":"ana","destino":"zzz","monto":1} -> 400 {"error":"usuario inexistente"}
  ```
  Un caso válido como el que genera k6 devuelve 200; los 400 solo corresponden a errores, y el script anterior los aceptaba como OK.

### Defecto 5
- Job y etapa: nivel workflow (`ci.yml`); afecta a `smoke`, `e2e` y `load` (post-deploy).
- Problema que causa en el pipeline: solo `deploy` tenía `concurrency`. Cada PR y cada push a main despliegan en la misma función Lambda, y dos runs simultáneos se pisan: el run B puede desplegar su imagen mientras `e2e`/`load` del run A todavía están probando. El resultado de A queda validando código de B (o falla por culpa de B).
- Link al commit: https://github.com/ezeAst/INF384-lab4-dev/commit/afc20b928626ca0f72a97d83d2d462f48194246f
- Corrección: ajustar configuración (`concurrency: group: ci-lambda-${{ github.repository }}`, `cancel-in-progress: false` a nivel workflow).
- Evidencia: en el run https://github.com/ezeAst/INF384-lab4-dev/actions/runs/40956817656, el lock de `deploy` solo cubrió 23 s (21:20:51 → 21:21:14), pero las pruebas contra la función siguieron hasta las 21:33:46 (`load` 21:21:28 → 21:33:46). Durante unos 12,5 min otro run podía redesplegar la función. Con la corrección, el run completo queda serializado.

## Parte 2 · Implementación
- Link al run en verde en main:
- Link al pull request:
- Defecto de la aplicación introducido (archivo y descripción):
- Job que debería detenerlo:
- Link al run fallido:

## Parte 3 · Decisión bajo restricción
Link al run medido:

| Job | Duración (min:seg) |
|---|---|
| unit | |
| integration | |
| sast | |
| sca | |
| build-push | |
| deploy | |
| smoke | |
| e2e | |
| load | |
| **Total** | |

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
