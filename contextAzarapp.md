# Azarapp — Contexto para Sesiones Futuras

## Stack
- Node.js + Express 4.18 + Socket.IO 4.7 + Helmet 7.1
- Frontend: HTML5 + CSS3 + Vanilla JS (monolítico en public/index.html)
- Despliegue: Render (render.yaml)

## Estructura
```
C:\Opencode\Azarapp\
├── public/index.html       # Frontend completo (CSS + HTML + JS)
├── server.js               # Servidor Express + Socket.IO
├── package.json
├── render.yaml
├── .gitignore
├── AZARAPP_CONTEXT.md      # Documentación detallada + auditoría seguridad
└── contextAzarapp.md       # Este archivo (contexto rápido para IA)
```

## Archivos Clave para Editar

### server.js — Backend
- `generateCode()`: genera códigos sala con `crypto.randomBytes`
- `pickWinner(options)`: selecciona ganador con `crypto.randomBytes` — fuente única de verdad
- `checkRateLimit(socket)`: rate limiter simple en memoria (30 eventos / 10s por socket)
- Límites: MAX_OPTIONS_PER_ROOM=20, MAX_OPTION_LENGTH=20, MAX_SOCKETS_PER_ROOM=50, MAX_ROOMS_PER_SOCKET=1, DECISION_TIMEOUT_MS=20000
- Eventos Socket.IO: create-room, join-room, add-option, remove-option, trigger-decision, decision-done, disconnect
- `trigger-decision` valida host, busy, options ≥ 2, computa winner, envía `decision-start` con winner
- `decision-done` valida host, busy, winner match con pendingWinner

### public/index.html — Frontend
- `startSlotSync(serverWinner)`: animación tragamonedas, recibe winner del servidor
- `startRaceSync(serverWinner)`: animación carrera, recibe winner del servidor
- `socket.emit('decision-done', { winner })`: envía winner de vuelta para validación servidor

## Flujo de Decisión (seguro)
1. Host → click SPIN/CORRE → emite `trigger-decision`
2. Servidor valida (host, busy, ≥2 opciones) → `pickWinner()` con crypto → marca busy
3. Servidor envía `decision-start` con winner a todos en la sala
4. Clientes animan mostrando ese winner
5. Al terminar → emiten `decision-done` con winner
6. Servidor valida (host, busy, winner match) → envía `decision-result`

## Reglas de Seguridad Implementadas
- Helmet (cabeceras HTTP seguras)
- CORS configurable via env `CORS_ORIGIN`
- Rate limiting por socket (30 eventos / 10s)
- Límites: opciones (20), largo opción (20), sockets/sala (50), salas/socket (1)
- Timeout automático de busy (20s)
- maxHttpBufferSize: 8192 bytes
- Sorteo con crypto.randomBytes en servidor

## Comandos
- `npm start` — inicia servidor en puerto 3000
- `npm audit` — verifica vulnerabilidades de dependencias
- Puerto configurable via `PORT` env var
