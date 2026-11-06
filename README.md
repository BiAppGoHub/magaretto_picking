# 📦 VETE - Sistema de Control de Empaque y Picking con Códigos de Barra

Sistema de alta velocidad diseñado para el empaque, picking y procesamiento de cajas en **VETE**, permitiendo a los operadores en planta registrar en tiempo real las cajas embaladas por cada empleado mediante pistolas lectoras de códigos de barra inalámbricas USB o cámara de celular, con feedback sonoro instantáneo, backend en Supabase y liquidación automática de pago a destajo (por caja).

---

## 🚀 Características Principales

### 1. 🔫 Lector de Código de Barras USB Inalámbrico y Cámara Móvil (10 Dígitos)
- **Estructura de 10 Dígitos**:
  - **Dígitos 1-4 (Izq. a Der.)**: Identifica al Empleado (ej: `0121`).
  - **Dígitos 5-6**: Calidad del Producto Embalado (`01` = Primera, `02` = Segunda).
  - **Dígitos 7-10**: Número Correlativo Digital único (ej: `0045`).
- Captura global sin importar dónde esté el cursor del operador.
- Auto-enfoque permanente para máxima agilidad en línea de producción.
- Detección anti-duplicados con alarma sonora y cartel visual de bloqueo.
- Soporte para colocación manual en caso de etiquetas rotas o dañadas.

### 2. 🔊 Sonido Beep Inmediato y Fuerte (<5ms)
- Sintetizado mediante **Web Audio API** de baja latencia.
- **Beep de Éxito**: Tono agudo y penetrante (1200 Hz) audible en ambientes industriales con alto ruido.
- **Tono de Error**: Zumbador grave doble (260 Hz) para alertar al operador sin necesidad de mirar la pantalla.
- **Alarma de Duplicado**: Sirena industrial descendente de 3 pulsos si una caja ya fue registrada.
- Control de volumen y botón de prueba sonora en vivo.

### 3. ☁️ Backend en Supabase & Arquitectura Anticolapso
- Diseñado para alta concurrencia y miles de lecturas continuas.
- **Offline-First & IndexedDB**: Si la conexión Wi-Fi en el galpón fluctúa, los escaneos se guardan en la cola local instantáneamente con beep inmediato y se sincronizan automáticamente en segundo plano hacia Supabase.
- **Supabase Realtime**: Permite a Recursos Humanos, dirección ejecutiva y supervisores ver la producción actualizarse segundo a segundo en pantallas remotas o celulares.

### 4. 📊 Tablero / Dashboard Analítico y Liquidación RRHH
- Monitoreo en tiempo real de cajas embaladas por empleado, calidad (`Primera` / `Segunda`) y envase (`CAJA 10 KG`, `CAJA 13 LIBRAS`, `BOLSA 20 KG`).
- Cálculo automático del monto a pagar según tarifa ($ por caja).
- Filtros multicriterio por turnos (Mañana, Tarde, Noche) y períodos (Este Mes, Hoy, Ayer, Esta Semana, Últimos 30 Días, Histórico Completo, Personalizado).
- **Exportación a Excel / CSV** para nómina y contabilidad.
- **Impresión de Recibos de Liquidación Individuales** con detalle de cajas, subtotal y firma de conformidad.

---

## 📂 Estructura del Proyecto

- [`Iniciar_Sistema_VETE.bat`](Iniciar_Sistema_VETE.bat) - Acceso directo para iniciar la app en Google Chrome con 1 clic.
- [`index.html`](index.html) - Interfaz de usuario industrial y adaptable.
- [`styles.css`](styles.css) - Estilos visuales de alto contraste con animaciones de escaneo.
- [`app.js`](app.js) - Lógica de negocio, sintetizador de audio, driver de pistola USB, cámara móvil y sincronización Supabase.
- [`supabase_schema.sql`](supabase_schema.sql) - Script SQL para inicializar Supabase.
- [`solucion_permisos.sql`](solucion_permisos.sql) - Script SQL para configurar permisos GRANT y RLS.
- [`INSTRUCCIONES_SUPABASE.md`](INSTRUCCIONES_SUPABASE.md) - Guía paso a paso para Supabase.
- [`HOSTINGER_DEPLOY.md`](HOSTINGER_DEPLOY.md) - Guía para desplegar en Hostinger.
- [`build.js`](build.js) - Generador de compilación para producción (`dist/` y `.zip`).

---

## 🛠️ Puesta en Marcha

1. Abre el [SQL Editor de Supabase (Proyecto ohhabwafbuyatrjycblr)](https://supabase.com/dashboard/project/ohhabwafbuyatrjycblr/sql) y ejecuta el contenido de [`supabase_schema.sql`](supabase_schema.sql).
2. Haz doble clic en **`Iniciar_Sistema_VETE.bat`** (o abre `index.html` en Chrome).
3. Inicia sesión con:
   - **Usuario**: `admin`
   - **Contraseña**: `vete2026` *(o `admin2026`)*
4. Conecta el receptor USB inalámbrico de tu pistola lectora.
5. ¡Comienza a escanear las cajas en la planta!
