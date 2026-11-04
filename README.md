# Evento CaVeCeCo · Registro de contactos

SPA para capturar contactos de empresas en eventos. Frontend estático (`public/`), API en funciones de Vercel (`api/`), datos en Supabase.

## Funcionalidad
- Login por **usuario + PIN** contra lista blanca (`equipo`). Bloqueo 15 min tras 5 PIN fallidos. Sesión 12 h en cookie `HttpOnly`.
- Formulario: Empresa*, Contacto*, Cargo, Teléfono, Email (al menos uno de los dos), categorías (pills, multiselección) y **Observaciones** del capturador.
- Observaciones por **dictado** (🎤, Web Speech API) o **cargando la transcripción** de una nota de voz (`.txt`, `.vtt`, `.srt`).
- Cada registro guarda quién lo capturó (`registrado_por`, tomado de la sesión).
- **Funciona sin conexión**: guarda en cola local y sincroniza al volver la red (reintento cada 30 s). Reintentos idempotentes (id generado en el dispositivo).
- **Captura rápida**: Enter salta al siguiente campo; botón Guardar fijo abajo; prefijo +58 automático; chips de cargo frecuente; empresa sugerida desde registros previos y desde el dominio del email; aviso de duplicado en línea (no bloquea).
- **Otro de esta empresa**: tras guardar, un toque conserva empresa, categorías y próximo paso para la siguiente persona.
- **Próximo paso** (multiselección): Enviar propuesta, Agendar demo, Llamar, Enviar información, Visita comercial.
- **App instalable (PWA)**: abre sin conexión (service worker, nunca cachea `/api`) y mantiene la pantalla encendida (Wake Lock) mientras está abierta.
- Lista con búsqueda, filtro por categoría y por evento. Cada miembro borra solo lo suyo; admin borra todo.
- **Exportar CSV** (solo admin): `;` como separador, UTF-8 con BOM (abre bien en Excel en español).

## Puesta en marcha
1. **Supabase**: crea proyecto y ejecuta `supabase/schema.sql` en el SQL Editor (si ya lo habías corrido, vuelve a correrlo: agrega la columna `proximos_pasos`).
2. **Variables**: `cp .env.example .env` y complétalo (`openssl rand -hex 32` para `SESSION_SECRET` y `PIN_PEPPER`).
3. **Dependencias**: `npm install`
4. **Alta del equipo** (pide el PIN por consola):
   ```bash
   npm run alta -- cmoniz "Carlos Moniz" admin
   npm run alta -- ana "Ana Pérez"
   npm run alta -- --desactivar ana
   ```
5. **Local**: `npx vercel dev` → http://localhost:3000
6. **Vercel**: importa el repo, carga las mismas variables de entorno (Production + Preview) y despliega.

## Seguridad (resumen)
- El navegador nunca habla con Supabase; solo la API con la `service_role`. RLS activado sin políticas: la anon key no ve nada.
- PIN guardado como HMAC-SHA256 con `PIN_PEPPER` (secreto fuera de la BD).
- Cookie `HttpOnly; Secure; SameSite=Strict` + verificación de origen y JSON en escrituras.
- CSV con neutralización de fórmulas (`=`, `+`, `-`, `@`).
- El dictado en Chrome envía el audio a Google para transcribir. Si no es aceptable, usar el dictado del teclado del dispositivo o cargar la transcripción.
- Registros pendientes de sincronizar quedan en `localStorage` del dispositivo hasta enviarse.

## Pendiente (próximos incrementos)
- Escaneo de tarjeta de presentación con cámara (Claude Haiku visión).
- Transcripción en servidor de audio grabado (requiere proveedor: Whisper u otro).
- Gestión de miembros desde la UI (hoy por script).
