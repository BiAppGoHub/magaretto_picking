# Guía de Inicialización en Supabase para MAGARETTO

Para que tu base de datos en Supabase quede 100% activa con las tablas de alta velocidad, vistas de Recursos Humanos, índices y políticas de seguridad:

---

### Proyecto Supabase Configurado
- **Nombre**: Magaretto
- **Project ID**: `dalhlqamxzmblggxffnt`
- **URL**: `https://dalhlqamxzmblggxffnt.supabase.co`
- 👉 **[Supabase SQL Editor - Proyecto Magaretto](https://supabase.com/dashboard/project/dalhlqamxzmblggxffnt/sql)**

---

### Tablas y Componentes Activos
1. **`public.configuracion`**: Tarifa base por caja ($150), moneda y tolerancia anti-duplicados para Magaretto.
2. **`public.calidades_producto`**: Catálogo de calidades (`000` Primera, `002` Segunda, `003` Araña, `DESCARTE`).
3. **`public.tipos_caja`**: Catálogo de envases de jornada (`CAJA 10 KG`, `CAJA 13 LIBRAS`, `BOLSA 20 KG`).
4. **`public.empleados`**: Tabla de empacadores identificados por sus dígitos de legajo (ej: `0101`, `0121`).
5. **`public.usuarios_sistema`**: Tabla de seguridad con contraseñas encriptadas SHA-256 y roles (`Administrador`, `Ejecutivo`, `RRHH`, `Usuario`).
   - `admin` / `magaretto2026` *(Administrador: Control total y gestión de usuarios - también acepta `vete2026` y `admin2026`)*
   - `ejecutivo` / `ejecutivo2026` *(Ejecutivo: Ve todos los paneles sin gestión de usuarios)*
   - `rrhh` / `rrhh2026` *(RRHH: Ve todos los paneles sin gestión de usuarios)*
   - `operador` / `operador123` *(Usuario: Solo Estación Escáner)*
6. **`public.registros_cajas`**: Tabla optimizada para registros de cajas en alta concurrencia con fecha/hora exacta, turno, empacador, calidad, tipo de caja, correlativo digital y tarifa congelada.
7. **Índices de Alto Rendimiento**: Para que las consultas de liquidación y conteo en plena temporada respondan en milisegundos.
8. **Vistas de RRHH & Producción**: `v_resumen_hoy`, `v_produccion_calidad_caja` y `v_resumen_liquidaciones`.
9. **Políticas de Seguridad RLS & GRANTs**: Habilitadas para permitir lectura y escritura desde la aplicación web.
10. **Supabase Realtime**: Habilitado para sincronización instantánea entre estaciones y pantallas.

---

### Cómo Iniciar la Aplicación
1. Haz doble clic en el archivo **`Iniciar_Sistema_Magaretto.bat`** (o abre `index.html` en Chrome).
2. Conecta la pistola lectora USB inalámbrica a la computadora.
3. ¡Listo! Puedes comenzar a escanear cajas para Magaretto.
