---
name: update-worker
description: >-
  Evalua cuando es necesario actualizar y desplegar el Cloudflare Worker de
  Movie Night, y realiza la actualizacion con Wrangler cuando esta autorizada.
  Usar ante pedidos como "actualiza el worker", "despliega el proxy" o
  "deploy worker", cambios en proxy/worker.mjs, proxy/parties.mjs, configuracion
  Wrangler o migraciones D1, y cambios del frontend que requieren una nueva
  respuesta de la API. Distingue estos casos de cambios solo visuales o de
  documentacion que no requieren redesplegar el Worker y evita despliegues
  desde ramas desactualizadas que eliminen funcionalidad ya publicada.
---

# Actualizar el Worker de Movie Night

Mantener sincronizados el frontend de GitHub Pages y su API de Cloudflare sin
desplegar innecesariamente, exponer secretos ni perder datos de parties.
Esta skill es un procedimiento bajo demanda, no un proceso programado ni CI.

Los comandos siguientes son para PowerShell, desde la raiz del repositorio,
no desde el directorio de la skill. Ejecutarlos por separado y detenerse si
alguno falla; no continuar con migraciones o despliegues tras un error.

## 1. Determinar si hace falta una actualizacion

Leer `README.md`, `proxy\wrangler.jsonc`, `config.js` y los archivos afectados.
Revisar el estado completo del worktree, incluidos cambios preparados y archivos
nuevos, sin descartar cambios ajenos:

```powershell
git --no-pager status --short
git --no-pager diff -- proxy
git --no-pager diff --cached -- proxy
git --no-pager log -5 --oneline -- proxy
```

Si se conoce la revision del ultimo despliegue, comparar tambien los cambios
desde esa revision, no solo el ultimo commit o la diferencia con `main`.

| Cambio | Accion |
| --- | --- |
| `proxy\worker.mjs`, `proxy\parties.mjs` o sus dependencias de ejecucion | Validar y desplegar el Worker si esos cambios no estan publicados. |
| `proxy\wrangler.jsonc`: variables, bindings, rutas o compatibilidad | Revisar el impacto y desplegar si cambia la configuracion efectiva. |
| `proxy\migrations\*.sql` | Revisar migraciones pendientes y compatibilidad antes de actualizar D1 o el Worker. |
| Frontend que necesita nuevas rutas o campos de la API | Comprobar si el Worker publicado ya cumple el contrato; desplegar el backend necesario antes del frontend. |
| Solo HTML, CSS, assets o logica local del frontend sin cambios de contrato | No desplegar el Worker. GitHub Pages se publica por separado. |
| Solo documentacion, skills, tests o fixtures | No desplegar el Worker por esos cambios. |

Wrangler publica el contenido actual del worktree, incluidos cambios sin commit,
no una revision de Git seleccionada automaticamente. Revisar todo lo que entrara
en el bundle. No desplegar trabajo ajeno o incompleto sin acordar su alcance.
Si se pide modificar el backend, hacer solo los cambios necesarios y mantener
compatibilidad con los clientes existentes.

No deducir que produccion esta actualizada solo porque Git esta limpio, ni que
esta desactualizada porque la rama difiere de `main`. Los metadatos de Wrangler
no garantizan una correspondencia con un commit. Si falta evidencia, indicar
la incertidumbre y confirmar la revision o el redespliegue con el usuario.
Si no hace falta actualizar, explicar el motivo y terminar sin desplegar.

### Bloquear despliegues desde ramas desactualizadas

Antes de preparar un despliegue de produccion, actualizar las referencias remotas
y exigir que la rama incluya el `main` remoto actual:

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "No se pudo actualizar origin; despliegue bloqueado." }
git merge-base --is-ancestor origin/main HEAD
if ($LASTEXITCODE -ne 0) { throw "HEAD no incluye origin/main; despliegue bloqueado." }
```

Si falla el requisito, detenerse: incorporar `origin/main` mediante el flujo
acordado y repetir las validaciones, o preparar un worktree aislado del ultimo
`origin/main` si el usuario autoriza desplegar esa revision. No publicar desde
la rama antigua, sobrescribir el checkout actual ni usar archivos de otro
worktree a escondidas.

La ascendencia no protege contra reversiones o cambios locales incompletos.
Revisar tambien `git diff origin/main -- proxy` y el bundle efectivo: deben
conservar `proxy\parties.mjs`, su importacion y enrutado desde `worker.mjs`,
las rutas `/parties` y el binding `PARTY_DB` con la base correcta. Un despliegue
del catalogo no debe eliminar parties ya publicadas. No retirar esas capacidades
sin un cambio de alcance explicitamente aprobado.
`--keep-vars` no conserva bindings D1 ni codigo o rutas ausentes del checkout;
no usar ese flag como sustituto de estos controles.

## 2. Confirmar destino, acceso y autorizacion

La fuente de verdad es `proxy\wrangler.jsonc`: actualmente el Worker se llama
`movie-night-api`, su entrada es `worker.mjs` y el binding D1 es `PARTY_DB`.
Leer el nombre y el ID de la base de datos desde esa configuracion; no inventar
identificadores ni crear otro Worker o base de datos para sortear un error.

Si otra sesion o persona esta desplegando o restaurando este Worker, coordinar
un unico responsable y esperar su confirmacion antes de cualquier cambio remoto,
incluidos secretos y migraciones. No publicar una version en paralelo ni asumir
que la ausencia de cambios en Git significa que nadie esta desplegando.

```powershell
node --version
npx wrangler --version
npx wrangler whoami
npx wrangler deployments list --config proxy\wrangler.jsonc
npx wrangler secret list --config proxy\wrangler.jsonc
```

Usar Node.js 22.13 o posterior con `node:sqlite`. Los tests no necesitan paquetes
npm; no agregar un `package.json` ni instalar Wrangler globalmente para esta tarea.
Si falta autenticacion, pedir al propietario que ejecute `npx wrangler login`
en su entorno. Confirmar la cuenta y el Worker de destino; no continuar si
hay ambiguedad, faltan permisos o no se puede identificar el despliegue existente.
Para una primera instalacion, seguir el setup del README con autorizacion.

Preservar `TMDB_READ_TOKEN`; `secret list` solo debe usarse para comprobar nombres,
nunca para obtener valores. Si falta el secreto y se necesita catalogo, pedir al
propietario que lo introduzca exclusivamente en el prompt interactivo de:

```powershell
npx wrangler secret put TMDB_READ_TOKEN --config proxy\wrangler.jsonc
```

No pedir tokens en el chat, imprimirlos ni guardarlos en archivos versionados,
argumentos de comandos, URLs o el frontend. No leer archivos locales de secretos
para elaborar informes. Las parties no necesitan el secreto TMDB.
Mantener `ALLOWED_ORIGINS` como origenes exactos, sin ruta ni barra final;
no ampliarlo a `*`. No cambiar `compatibility_date`, bindings o `apiBaseUrl`
como parte rutinaria de un redespliegue.

Antes de cualquier cambio remoto, exponer el destino, el alcance y las migraciones.
Una peticion explicita de desplegar autoriza ese despliegue; una peticion de
editar codigo, crear esta skill o diagnosticar no lo autoriza. En ese caso,
preparar la actualizacion y solicitar confirmacion antes de publicarla.
Las migraciones remotas requieren autorizacion de su impacto sobre los datos.

## 3. Validar los cambios antes de publicarlos

Para cambios del Worker, ejecutar los tests existentes de catalogo y parties:

```powershell
node --test proxy\worker.test.mjs proxy\parties.test.mjs
```

Si tambien cambia el contrato o su consumo en el frontend, usar en su lugar
una sola invocacion que incluya los tests del frontend:

```powershell
node --test app.test.mjs proxy\worker.test.mjs proxy\parties.test.mjs
```

Comprobar que Wrangler puede preparar el bundle sin publicarlo:

```powershell
npx wrangler deploy --dry-run --config proxy\wrangler.jsonc
```

No confundir un dry run correcto con un despliegue ni con una validacion de
secretos, permisos o esquema de la base remota. Si falla alguna comprobacion,
resolver la causa relacionada con la tarea o informar del bloqueo; no omitirla.

## 4. Aplicar D1 solo cuando corresponda

Si hay cambios de esquema o indicios de migraciones faltantes, listar las
migraciones remotas. Los ejemplos usan el nombre actual `movie-night-parties`;
sustituirlo si la configuracion del destino indica otro nombre.

```powershell
npx wrangler d1 migrations list movie-night-parties --remote --config proxy\wrangler.jsonc
```

Si no hay migraciones pendientes, no ejecutar una aplicacion innecesaria.
No editar migraciones ya aplicadas: los cambios de esquema deben ir en una nueva
migracion versionada. Antes de modificar datos remotos, revisar el SQL, confirmar
con el propietario un respaldo o punto recuperable de D1 y comprobar que el
Worker anterior sigue funcionando con el nuevo esquema.

Probar primero las migraciones en la base local aislada:

```powershell
npx wrangler d1 migrations apply movie-night-parties --local --config proxy\wrangler.jsonc
```

La base local no demuestra que una migracion preserve los datos existentes de
produccion; revisar tambien ese impacto. Con autorizacion y compatibilidad
confirmadas, aplicar las pendientes al destino remoto antes de desplegar el
codigo que las necesita:

```powershell
npx wrangler d1 migrations apply movie-night-parties --remote --config proxy\wrangler.jsonc
```

Revisar los prompts de Wrangler sin aceptarlos a ciegas. Si el cambio rompe
compatibilidad, detenerse y acordar un despliegue por etapas. No borrar, recrear
ni restaurar la base para desbloquear una actualizacion.

## 5. Desplegar el Worker

Justo antes de publicar, repetir el fetch y el control de ascendencia de la
seccion 1, y volver a consultar los despliegues:

```powershell
npx wrangler deployments list --config proxy\wrangler.jsonc
```

Si la version activa o el reparto de trafico cambio desde la revision inicial,
detenerse y coordinar con quien publico ese cambio; no sobrescribir una
actualizacion o restauracion reciente. Estos controles no son un bloqueo atomico:
mantener la coordinacion hasta completar el despliegue y sus comprobaciones.

Guardar los IDs de las versiones activas y su reparto de trafico mostrados por
Wrangler antes de publicar, para poder plantear una recuperacion. No confundir
un ID de despliegue con un ID de version.

```powershell
npx wrangler deploy --config proxy\wrangler.jsonc
```

Registrar la URL y el ID de version que devuelve Wrangler. Comparar la URL
con `window.MOVIE_NIGHT_CONFIG.apiBaseUrl` en `config.js`; no reemplazarla con
una URL local ni cambiarla si el destino sigue siendo el mismo.
Si cambia el contrato, mantener compatibilidad con el frontend publicado y
coordinar su publicacion por separado. Hacer push a GitHub Pages no despliega
el Worker, y desplegar el Worker no publica el frontend.

## 6. Comprobar el servicio publicado

Usar la URL real del despliegue y un `Origin` exacto de `ALLOWED_ORIGINS`.
Enviar solicitudes acotadas; no usar `/` o un supuesto `/health`, porque no
son endpoints de salud de esta API.

| Solicitud | Resultado esperado |
| --- | --- |
| `GET /movies?genre=all&page=1` | 200 y JSON con `page`, `totalPages`, `totalResults` y `results`. |
| `GET /movies/{tmdbId}` con un ID de los resultados | 200 y `movie` con los campos que necesita el cambio, no solo cualquier respuesta 200. |
| `OPTIONS /movies`, solicitando metodo `GET` | 204 y `Access-Control-Allow-Origin` igual al origen enviado. |
| `GET /movies` con un origen no permitido | 403 sin `Access-Control-Allow-Origin`. |
| `OPTIONS /parties`, solicitando `POST` y cabeceras `Authorization, Content-Type` | 204 con CORS y cabeceras permitidas. |
| `POST /parties` con `Content-Type: application/json` y cuerpo `{}` | 400 de validacion, sin crear una party ni un miembro. |

Comprobar siempre las dos solicitudes de parties, aunque solo se haya cambiado
el catalogo: un 404 puede indicar que se desplego una version antigua sin esas
rutas, y un 503 puede indicar que se perdio `PARTY_DB`. El cuerpo `{}` se rechaza
antes de escribir en D1; no sustituirlo por datos validos ni por un POST sin
`Content-Type`, que produciria 415 y no la comprobacion prevista.

El catalogo requiere un secreto TMDB valido. Un 503 por falta de configuracion,
un error TMDB o un limite de solicitudes no demuestra que el despliegue haya
fallado, pero tampoco permite declarar el servicio funcional. Informar la causa
y no ocultarla con datos de ejemplo.

Las respuestas del catalogo se cachean durante 300 segundos. Si aparecen datos
anteriores al despliegue, esperar su expiracion y repetir; no agregar parametros
arbitrarios para saltar la cache, porque el Worker rechaza parametros desconocidos.
Confirmar tambien CORS en las respuestas GET.

Un preflight o un POST rechazado no comprueba el esquema de D1 ni autenticacion.
Si se modificaron parties, comprobar las migraciones remotas y, con una sesion
de prueba autorizada, leer `GET /parties/{partyId}`: debe devolver un snapshot
y `Cache-Control: no-store`.
No crear parties o miembros ni modificar datos reales solo para hacer una prueba.
No exponer tokens ni snapshots privados en el informe. Si no hay una sesion de
prueba disponible, indicar que la comprobacion funcional de parties queda pendiente.

## 7. Cerrar o recuperar

Informar si no era necesaria una actualizacion, si quedo preparada sin desplegar,
o si se desplego; en este ultimo caso incluir URL, version, migraciones aplicadas
y cualquier comprobacion pendiente o fallo. No afirmar exito completo solo
porque Wrangler termino correctamente.

Si se confirma una regresion en produccion, explicar el impacto y pedir
autorizacion antes de restaurar una version. Usar `npx wrangler rollback` con
el ID de version anterior confirmado y `--config proxy\wrangler.jsonc`, solo
tras verificar su compatibilidad con el esquema y bindings actuales.
Un rollback del Worker no revierte migraciones D1 ni restaura datos.
