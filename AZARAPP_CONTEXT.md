# Azarapp — Contexto del Proyecto

## Descripción General

Aplicación web multijugador en tiempo real tipo "tragamonedas / carrera de caballos" para tomar decisiones al azar. Los usuarios crean salas, agregan opciones y giran una máquina tragamonedas o corren caballos para elegir una opción aleatoria.

## Stack Tecnológico

| Capa       | Tecnología                          |
| ---------- | ----------------------------------- |
| Backend    | Node.js + Express 4.18              |
| Tiempo real | Socket.IO 4.7                      |
| Frontend   | HTML5 + CSS3 + Vanilla JS           |
| Fuente     | Google Fonts "Press Start 2P"       |
| QR         | API externa: qrserver.com           |
| Despliegue | Render (render.yaml)                |

## Estructura del Proyecto

```
C:\Opencode\Azarapp\
├── public/
│   └── index.html          # Frontend monolítico (CSS + HTML + JS)
├── server.js               # Servidor Express + Socket.IO
├── package.json            # Dependencias
├── render.yaml             # Config de despliegue Render
├── .gitignore
└── AZARAPP_CONTEXT.md      # Este archivo
```

## Arquitectura

### Servidor (`server.js`)

- Servidor HTTP básico con Express para archivos estáticos y Socket.IO para comunicación en tiempo real.
- **Salas en memoria**: `Map<code, Room>` — cada sala tiene:
  - `code`: código alfanumérico de 6 caracteres
  - `options`: array de strings (opciones a sortear)
  - `mode`: `'slot'` | `'race'`
  - `busy`: boolean (true durante sorteo + cooldown de 10s)
  - `host`: socket ID del anfitrión
  - `sockets`: Set de socket IDs conectados
  - `busyTimeout`: auto-unlock tras 20s si no llega decision-done
  - `cooldownTimeout`: libera busy tras 10s de cooldown
  - `pendingWinner`: winner elegido por servidor, pendiente de confirmación
- **Eventos Socket.IO**:
  - `create-room` → crea sala, devuelve código y estado
  - `join-room` → se une a sala por código
  - `add-option` → agrega opción
  - `remove-option` → elimina opción por índice
  - `trigger-decision` → inicia el sorteo (solo host)
  - `decision-done` → notifica el resultado
  - `decision-start` → servidor anuncia inicio + winner
  - `decision-result` → servidor confirma resultado
  - `cooldown-end` → servidor anuncia fin de cooldown (libera botón)
  - `busy-timeout` → servidor anuncia timeout por falta de decision-done
  - `state-update` → cambios en opciones
  - `new-host` → migración de host
  - `room-info` → info de sala (conteo usuarios, host)
  - `disconnect` → maneja migración de host y limpieza

### Frontend (`public/index.html`)

- **Pantalla inicial**: overlay para crear o unirse a sala (con código de 6 caracteres)
- **Barra de sala**: muestra código, cantidad de usuarios, botón QR
- **Gestor de opciones**: input + botón para agregar/quitar opciones
- **Selector de modo**: tragamonedas / carrera de caballos
- **Panel de tragamonedas**: 3 carretes con animación CSS, palanca, LEDs, botón SPIN
- **Panel de carrera**: canvas con caballos pixel-art animados
- **Confetti**: animación al terminar

### Flujo de Decisión (con cooldown)

1. El anfitrión hace clic en SPIN / ¡CORRE! / palanca
2. Cliente emite `trigger-decision` → servidor marca `room.busy = true`
3. Servidor emite `decision-start` a todos en la sala
4. Cada cliente ejecuta su propia animación local mostrando el winner del servidor
5. Cuando la animación termina, el cliente emite `decision-done` con el winner (NO libera `localBusy`)
6. Servidor valida (host, busy, winner match) → emite `decision-result` + inicia cooldown 10s
7. Cliente recibe `decision-result` → muestra "⏳ ESPERA Xs" en el botón, `localBusy` sigue true
8. Tras 10s → servidor emite `cooldown-end` → cliente hace `localBusy = false` y habilita el botón
9. Si nunca llega `decision-done`, el `busy-timeout` (20s) también inicia cooldown 10s

## Formato de Sala

Códigos de 6 caracteres: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (excluye vocales para evitar palabras, I, O, 0, 1 para evitar confusiones).

---

## Revisión de Seguridad

Realizada el 2026-05-30. A continuación los hallazgos categorizados por severidad.

### 🔴 CRÍTICOS

#### 1. Sin autenticación ni autorización real
- **Archivo**: `server.js` (todo el archivo)
- **Problema**: Cualquier cliente conectado puede emitir cualquier evento a cualquier sala. Los IDs de socket son el único mecanismo de "identidad" y no hay validación de que el emisor sea realmente quien dice ser.
- **Riesgo**: Un cliente malicioso podría interceptar o adivinar socket IDs y ejecutar acciones no autorizadas.
- **Mitigación**: Baja probabilidad de explotación porque Socket.IO genera IDs aleatorios, pero la arquitectura no debería depender de esto.

#### 2. Aleatoriedad insegura — `Math.random()`
- **Archivo**: `public/index.html:1091` y `server.js` no participa en la selección del ganador
- **Problema**: La decisión del ganador se calcula **exclusivamente en el cliente** usando `Math.random()`, que no es criptográficamente segura y puede ser predecible. Además, cada cliente ejecuta su propia instancia de la animación y escoge su propio ganador — no hay una fuente de verdad centralizada.
- **Riesgo**: Un cliente malicioso puede manipular el resultado localmente. Diferentes clientes podrían ver resultados distintos.
- **Mitigación**: El servidor DEBERÍA calcular el ganador con `crypto.randomBytes()` y transmitirlo como autoridad central.

#### 3. El servidor no valida el resultado
- **Archivo**: `server.js:126-134` — `decision-done`
- **Problema**: El servidor acepta ciegamente el `winner` que el cliente envía y lo retransmite a todos. No verifica que corresponda a una opción válida de la sala, ni que quien lo envía sea el host.
- **Riesgo**: Cualquier cliente puede emitir `decision-done` con un ganador falso, y el servidor lo transmitirá a todos.
- **Mitigación**: Validar que `winner` esté en `room.options`, que quien emite sea el `room.host`, y que `room.busy === true`.

### 🟠 ALTOS

#### 4. Sin límite de opciones
- **Archivo**: `server.js:81-93` — `add-option`
- **Problema**: No hay límite en la cantidad ni longitud de opciones que se pueden agregar a una sala. Un cliente podría agregar miles de opciones y causar denegación de servicio (DoS) por memoria.
- **Riesgo**: Agotamiento de memoria del servidor, degradación del rendimiento.
- **Mitigación**: Limitar `room.options.length` (ej. máx. 20) y longitud de cada opción (ej. máx. 20 caracteres) en el servidor.

#### 5. Sin rate limiting
- **Archivo**: `server.js`
- **Problema**: No hay límite en la frecuencia de eventos Socket.IO. Un cliente puede emitir `create-room`, `add-option`, etc. miles de veces por segundo.
- **Riesgo**: DoS por agotamiento de recursos (creación masiva de salas, llenado de memoria).
- **Mitigación**: Implementar rate limiting por socket (ej. `express-rate-limiter` para Socket.IO).

#### 6. Sin límite de capacidad de sala
- **Archivo**: `server.js:65-78` — `join-room`
- **Problema**: No hay límite de cuántos sockets pueden unirse a una sala.
- **Riesgo**: Una sala con cientos de conexiones puede degradar el rendimiento del servidor.
- **Mitigación**: Limitar a un número razonable (ej. 20-50 sockets por sala).

#### 7. Sin límite de salas por socket
- **Archivo**: `server.js:40-62` — `create-room`
- **Problema**: Un mismo socket puede crear múltiples salas.
- **Riesgo**: Un atacante podría crear miles de salas desde una sola conexión.
- **Mitigación**: Limitar a 1 sala por socket.

### 🟡 MEDIOS

#### 8. Cabeceras de seguridad HTTP (resuelto)
- **Archivo**: `server.js`
- **Estado**: Se agregó `helmet` con CSP personalizado. `script-src` incluye `'unsafe-inline'` para permitir el JS inline de index.html.
- **Advertencia**: El CSP por defecto de Helmet 7.1 bloquea scripts inline. Hay que agregar explícitamente `'unsafe-inline'` en `script-src`.

#### 9. Sin CORS configurado
- **Archivo**: `server.js:8` — `new Server(server)` sin opciones de CORS
- **Problema**: Socket.IO acepta conexiones desde cualquier origen por defecto (en desarrollo). En producción, esto no está restringido explícitamente.
- **Riesgo**: Orígenes no autorizados pueden conectar al servidor.
- **Mitigación**: Configurar `cors: { origin: ... }` en `Server` y `express`.

#### 10. Sin límite de tamaño de mensajes
- **Archivo**: `public/index.html` (envío de opciones largas) y `server.js`
- **Problema**: No hay límite en el tamaño de los mensajes que los clientes pueden enviar.
- **Riesgo**: Un atacante podría enviar payloads enormes para agotar memoria.
- **Mitigación**: Configurar `maxHttpBufferSize` en Socket.IO.

#### 11. Dependencias sin actualizar — sin auditoría
- **Archivo**: `package.json`
- **Problema**: Las versiones de dependencias no están bloqueadas a parches específicos. No se ejecuta `npm audit`.
- **Riesgo**: Vulnerabilidades conocidas no parcheadas.
- **Mitigación**: Ejecutar `npm audit` periódicamente, usar versiones exactas.

#### 12. Logging de IDs de socket
- **Archivo**: `server.js:37,60,76,138`
- **Problema**: Se loguean los socket IDs en consola. Aunque es de baja sensibilidad, expone información interna.
- **Riesgo**: Bajo — los IDs de socket son temporales.
- **Mitigación**: Eliminar o redactar logs en producción.

#### 13. Timeouts en eventos (resuelto)
- **Archivo**: `server.js`
- **Estado**: `DECISION_TIMEOUT_MS=20000` desbloquea `busy` si no llega `decision-done`. Al desbloquear inicia cooldown 10s (`COOLDOWN_MS`).

### 🟢 BAJOS

#### 14. Código duplicado en generación de aleatoriedad
- El frontend y backend usan lógica distinta para random. El backend no genera valores aleatorios para decisiones — solo para códigos de sala (función `generateCode` que usa `Math.random()`).

#### 15. Target `esmodules` no definido
- **Archivo**: `package.json` — no hay `type: "module"` ni `"engines"`.
- **Problema**: Podría causar inconsistencias al correr en Node 18+.

#### 16. Sin `.env` para configuración
- **Archivo**: `.gitignore` tiene `.env` pero no se usa ningún módulo de env.
- **Problema**: No relevante ahora, pero si se agregan secrets (API keys, etc.), no hay mecanismo para leerlas.

---

## Resumen de Riesgos

| Severidad | Cantidad |
| --------- | -------- |
| 🔴 Crítico | 3 |
| 🟠 Alto    | 4 |
| 🟡 Medio   | 6 |
| 🟢 Bajo    | 3 |

**Conclusión**: El proyecto es **funcional pero inseguro para producción real**. El mayor problema es que **el resultado del sorteo se calcula en el cliente** sin validación del servidor, lo que permite manipulación total del resultado. Además, la falta de rate limiting y límites de recursos hace que sea vulnerable a DoS fácilmente.

### Recomendaciones Inmediatas (Prioridad Alta)

1. Mover el cálculo del ganador al servidor usando `crypto.randomBytes()` y transmitirlo como autoridad.
2. Validar `decision-done`: verificar que el ganador esté en opciones, que el emisor sea host, que la sala esté en estado busy.
3. Agregar rate limiting y límites de opciones/salas/sockets.
4. Agregar `helmet` para cabeceras de seguridad.
5. Configurar CORS explícitamente.
6. Agregar timeout automático para `busy` en el servidor.
