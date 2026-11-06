-- ==============================================================================
-- SOLUCIÓN DE PERMISOS PARA SUPABASE (Corrige error 42501 permission denied)
-- ==============================================================================
-- Ejecuta este script en el SQL Editor de tu proyecto Supabase:
-- https://supabase.com/dashboard/project/ohhabwafbuyatrjycblr/sql/new
-- ==============================================================================

-- 1. Dar permisos de uso sobre el esquema public
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- 2. Dar todos los permisos sobre todas las tablas existentes
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

-- 3. Dar permisos sobre secuencias (IDs autonuméricos)
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- 4. Dar permisos sobre funciones y procedimientos
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

-- 5. Configurar permisos por defecto para cualquier tabla futura
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;

-- 6. Asegurar políticas RLS permisivas para conexión directa
ALTER TABLE public.configuracion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calidades_producto ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tipos_caja ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empleados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios_sistema ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registros_cajas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir configuracion" ON public.configuracion;
CREATE POLICY "Permitir configuracion" ON public.configuracion FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir calidades" ON public.calidades_producto;
CREATE POLICY "Permitir calidades" ON public.calidades_producto FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir tipos_caja" ON public.tipos_caja;
CREATE POLICY "Permitir tipos_caja" ON public.tipos_caja FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir empleados" ON public.empleados;
CREATE POLICY "Permitir empleados" ON public.empleados FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir usuarios" ON public.usuarios_sistema;
CREATE POLICY "Permitir usuarios" ON public.usuarios_sistema FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir registros" ON public.registros_cajas;
CREATE POLICY "Permitir registros" ON public.registros_cajas FOR ALL USING (true) WITH CHECK (true);

-- 7. Asegurar columnas para 7 dígitos VETE (Calidad 000, 002, 003 + Personal) y Descarte
-- Si existen vistas dependientes, se eliminan temporalmente para permitir cambiar el tipo de columna
DROP VIEW IF EXISTS public.v_resumen_hoy CASCADE;
DROP VIEW IF EXISTS public.v_produccion_calidad_caja CASCADE;
DROP VIEW IF EXISTS public.v_resumen_liquidaciones CASCADE;

ALTER TABLE public.calidades_producto ALTER COLUMN codigo TYPE VARCHAR(20);
INSERT INTO public.calidades_producto (codigo, nombre, descripcion)
VALUES 
    ('000', 'Primera', 'Calidad Primera (000)'),
    ('002', 'Segunda', 'Calidad Segunda (002)'),
    ('003', 'Araña', 'Calidad Araña (003)'),
    ('01', 'Primera', 'Calidad 1 (Selección Primera legacy)'),
    ('02', 'Segunda', 'Calidad 2 (Selección Segunda legacy)'),
    ('03', 'Araña', 'Calidad 3 (Selección Araña legacy)'),
    ('DESCARTE', 'Descarte', 'Cajas de Descarte Manual'),
    ('DS', 'Descarte', 'Descarte Abreviado')
ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, descripcion = EXCLUDED.descripcion;

ALTER TABLE public.registros_cajas ADD COLUMN IF NOT EXISTS codigo_empleado_extraido VARCHAR(4);
ALTER TABLE public.registros_cajas ADD COLUMN IF NOT EXISTS codigo_calidad VARCHAR(20) DEFAULT '000';
ALTER TABLE public.registros_cajas ADD COLUMN IF NOT EXISTS nombre_calidad TEXT DEFAULT 'Primera';
ALTER TABLE public.registros_cajas ADD COLUMN IF NOT EXISTS codigo_tipo_caja VARCHAR(20) DEFAULT '10KG';
ALTER TABLE public.registros_cajas ADD COLUMN IF NOT EXISTS nombre_tipo_caja TEXT DEFAULT 'Caja 10 kgs.';
ALTER TABLE public.registros_cajas ADD COLUMN IF NOT EXISTS numero_correlativo VARCHAR(10);
ALTER TABLE public.registros_cajas ALTER COLUMN codigo_calidad TYPE VARCHAR(20);
ALTER TABLE public.registros_cajas ALTER COLUMN codigo_tipo_caja TYPE VARCHAR(20);
CREATE INDEX IF NOT EXISTS idx_registros_calidad ON public.registros_cajas (codigo_calidad);
CREATE INDEX IF NOT EXISTS idx_registros_correlativo ON public.registros_cajas (numero_correlativo);
CREATE INDEX IF NOT EXISTS idx_registros_dia_correlativo ON public.registros_cajas (fecha_dia, numero_correlativo);

-- Recrear vistas analíticas
CREATE OR REPLACE VIEW public.v_resumen_hoy AS
SELECT 
    e.id AS empleado_id,
    e.codigo_empleado,
    e.nombre_completo,
    COUNT(r.id) AS total_cajas_hoy,
    COALESCE(SUM(r.tarifa_aplicada), 0) AS total_a_pagar_hoy,
    MAX(r.fecha_hora) AS ultima_caja_hora
FROM public.empleados e
LEFT JOIN public.registros_cajas r 
    ON e.id = r.empleado_id AND r.fecha_dia = CURRENT_DATE
WHERE e.activo = TRUE
GROUP BY e.id, e.codigo_empleado, e.nombre_completo
ORDER BY total_cajas_hoy DESC, e.nombre_completo ASC;

CREATE OR REPLACE VIEW public.v_produccion_calidad_caja AS
SELECT 
    r.fecha_dia,
    r.codigo_calidad,
    r.nombre_calidad,
    r.codigo_tipo_caja,
    r.nombre_tipo_caja,
    COUNT(r.id) AS total_cajas,
    COUNT(DISTINCT r.empleado_id) AS total_empacadores
FROM public.registros_cajas r
GROUP BY r.fecha_dia, r.codigo_calidad, r.nombre_calidad, r.codigo_tipo_caja, r.nombre_tipo_caja
ORDER BY r.fecha_dia DESC, total_cajas DESC;

CREATE OR REPLACE VIEW public.v_resumen_liquidaciones AS
SELECT 
    r.fecha_dia,
    e.id AS empleado_id,
    e.codigo_empleado,
    e.nombre_completo,
    COUNT(r.id) AS total_cajas,
    SUM(r.tarifa_aplicada) AS total_monto,
    MIN(r.fecha_hora) AS primer_escaneo,
    MAX(r.fecha_hora) AS ultimo_escaneo
FROM public.registros_cajas r
JOIN public.empleados e ON r.empleado_id = e.id
GROUP BY r.fecha_dia, e.id, e.codigo_empleado, e.nombre_completo
ORDER BY r.fecha_dia DESC, total_cajas DESC;

-- 8. Actualizar nombre de empresa y clave de admin para VETE (vete2026)
UPDATE public.configuracion SET nombre_empresa = 'VETE - Control de Empaque y Picking' WHERE id = 'general';
UPDATE public.usuarios_sistema SET password_hash = 'e9d504cb733426a5d09933cd0160c830bb71b49228307bc3c165c34358c75828' WHERE username = 'admin';

SELECT '✅ Permisos y RLS configurados correctamente en Supabase. Tablas desbloqueadas para VETE.' AS status;
