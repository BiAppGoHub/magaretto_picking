-- ==============================================================================
-- BASE DE DATOS SUPABASE: SISTEMA MAGARETTO
-- Control de Empaque de Cajas, Picking y Liquidación a Destajo
-- Formato de Código de Barra (7 Dígitos: [3d Calidad][4d Personal]) + Seguridad y Roles
-- Proyecto: dalhlqamxzmblggxffnt (Magaretto)
-- ==============================================================================

-- 1. EXTENSIONES NECESARIAS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABLA DE CONFIGURACIÓN DEL SISTEMA
CREATE TABLE IF NOT EXISTS public.configuracion (
    id TEXT PRIMARY KEY DEFAULT 'general',
    nombre_empresa TEXT NOT NULL DEFAULT 'Magaretto - Control de Empaque y Picking',
    tarifa_por_caja_default NUMERIC(10, 2) NOT NULL DEFAULT 150.00,
    moneda_simbolo TEXT NOT NULL DEFAULT '$',
    tolerancia_duplicado_segundos INT NOT NULL DEFAULT 5,
    envase_primera TEXT DEFAULT '10KG',
    envase_segunda TEXT DEFAULT '10KG',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO public.configuracion (id, nombre_empresa, tarifa_por_caja_default, moneda_simbolo, tolerancia_duplicado_segundos, envase_primera, envase_segunda)
VALUES ('general', 'Magaretto - Control de Empaque y Picking', 150.00, '$', 5, '10KG', '10KG')
ON CONFLICT (id) DO UPDATE SET nombre_empresa = EXCLUDED.nombre_empresa;

-- 3. CATÁLOGO DE CALIDADES DE PRODUCTO
CREATE TABLE IF NOT EXISTS public.calidades_producto (
    codigo VARCHAR(20) PRIMARY KEY,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

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

-- 4. CATÁLOGO DE ENVASES DISPONIBLES PARA JORNADA
CREATE TABLE IF NOT EXISTS public.tipos_caja (
    codigo VARCHAR(20) PRIMARY KEY,
    nombre TEXT NOT NULL,
    capacidad_kg NUMERIC(6, 2) DEFAULT 10.00,
    descripcion TEXT,
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO public.tipos_caja (codigo, nombre, capacidad_kg, descripcion)
VALUES 
    ('10KG', 'CAJA 10 KG', 10.00, 'Caja de 10 Kilogramos para empaque estándar'),
    ('13LB', 'CAJA 13 LIBRAS', 5.90, 'Caja de 13 Libras para exportación'),
    ('BOLSA20', 'BOLSA 20 KG', 20.00, 'Bolsa de 20 Kilogramos para segunda / granel')
ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, capacidad_kg = EXCLUDED.capacidad_kg;

-- 5. TABLA DE EMPLEADOS / EMPACADORES
CREATE TABLE IF NOT EXISTS public.empleados (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo_empleado VARCHAR(10) UNIQUE NOT NULL,
    nombre_completo TEXT NOT NULL,
    dni_rut TEXT,
    telefono TEXT,
    tarifa_personalizada NUMERIC(10, 2),
    activo BOOLEAN DEFAULT TRUE,
    notas TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO public.empleados (codigo_empleado, nombre_completo, dni_rut, telefono, tarifa_personalizada)
VALUES 
    ('0101', 'Juan Carlos Mendoza', '28.450.123', '+54 9 261 455-1122', 150.00),
    ('0102', 'María Elena Gómez', '30.124.789', '+54 9 261 455-2233', 150.00),
    ('0103', 'Pedro Antonio López', '27.890.456', '+54 9 261 455-3344', 160.00),
    ('0104', 'Rosaura Benítez', '32.654.987', '+54 9 261 455-4455', 150.00),
    ('0121', 'Carlos Rodríguez (Ejemplo 0121)', '31.852.963', '+54 9 261 455-7788', 150.00)
ON CONFLICT (codigo_empleado) DO NOTHING;

-- 6. TABLA DE USUARIOS DEL SISTEMA Y ROLES (RBAC)
CREATE TABLE IF NOT EXISTS public.usuarios_sistema (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username TEXT UNIQUE NOT NULL,
    nombre_completo TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    rol TEXT NOT NULL CHECK (rol IN ('Administrador', 'Ejecutivo', 'RRHH', 'Usuario')),
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO public.usuarios_sistema (username, nombre_completo, password_hash, rol, activo)
VALUES 
    -- admin / magaretto2026 (también acepta vete2026 y admin2026)
    ('admin', 'Administrador General Magaretto', '8fb05ad764196bb1ebd6305e1242cea66965e52f0584ad54db39d85596c7c219', 'Administrador', true),
    -- ejecutivo / ejecutivo2026
    ('ejecutivo', 'Dirección Ejecutiva', 'c1a0286d7a9093f1eb4d06339654f548d101ccd24a5c92a14efd64116fa8696d', 'Ejecutivo', true),
    -- rrhh / rrhh2026
    ('rrhh', 'Recursos Humanos', '20e60c92cadd6d8a7fb5d07a7ccf1f0560e42974f597ac963e65e3f92158750b', 'RRHH', true),
    -- operador / operador123
    ('operador', 'Operador de Empaque', '1725165c9a0b3698a3d01016e0d8205155820b8d7f21835ca64c0f81c728d880', 'Usuario', true)
ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- 7. TABLA DE REGISTRO DE CAJAS ESCANEADAS
CREATE TABLE IF NOT EXISTS public.registros_cajas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empleado_id UUID REFERENCES public.empleados(id) ON DELETE SET NULL,
    codigo_barra_leido VARCHAR(32) NOT NULL,
    codigo_empleado_extraido VARCHAR(4),
    codigo_calidad VARCHAR(20) DEFAULT '000',
    nombre_calidad TEXT DEFAULT 'Primera',
    codigo_tipo_caja VARCHAR(20) DEFAULT '10KG',
    nombre_tipo_caja TEXT DEFAULT 'CAJA 10 KG',
    numero_correlativo VARCHAR(10),
    empleado_nombre_snapshot TEXT NOT NULL,
    tarifa_aplicada NUMERIC(10, 2) NOT NULL DEFAULT 150.00,
    fecha_hora TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    fecha_dia DATE DEFAULT CURRENT_DATE,
    turno TEXT DEFAULT 'Mañana',
    linea_empaque TEXT DEFAULT 'Línea 1',
    origen_dispositivo TEXT DEFAULT 'Pistola USB',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. ÍNDICES DE ALTO RENDIMIENTO
CREATE INDEX IF NOT EXISTS idx_empleados_codigo ON public.empleados (codigo_empleado);
CREATE INDEX IF NOT EXISTS idx_usuarios_username ON public.usuarios_sistema (LOWER(username));
CREATE INDEX IF NOT EXISTS idx_registros_fecha_dia ON public.registros_cajas (fecha_dia);
CREATE INDEX IF NOT EXISTS idx_registros_fecha_hora ON public.registros_cajas (fecha_hora DESC);
CREATE INDEX IF NOT EXISTS idx_registros_emp_extraido ON public.registros_cajas (codigo_empleado_extraido);
CREATE INDEX IF NOT EXISTS idx_registros_calidad ON public.registros_cajas (codigo_calidad);
CREATE INDEX IF NOT EXISTS idx_registros_tipo_caja ON public.registros_cajas (codigo_tipo_caja);
CREATE INDEX IF NOT EXISTS idx_registros_correlativo ON public.registros_cajas (numero_correlativo);
CREATE INDEX IF NOT EXISTS idx_registros_dia_correlativo ON public.registros_cajas (fecha_dia, numero_correlativo);
CREATE INDEX IF NOT EXISTS idx_registros_codigo_leido ON public.registros_cajas (codigo_barra_leido);

-- 9. VISTAS ANALÍTICAS PARA RECURSOS HUMANOS Y PRODUCCIÓN
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

-- 10. HABILITAR ROW LEVEL SECURITY (RLS) Y POLÍTICAS PÚBLICAS
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

-- 11. PERMISOS SQL PARA ROLES DE SUPABASE (anon, authenticated, service_role)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;

-- 12. HABILITAR REALTIME EN SUPABASE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

DO $$
DECLARE
  tbl text;
  tablas text[] := ARRAY['registros_cajas', 'empleados', 'configuracion', 'calidades_producto', 'tipos_caja', 'usuarios_sistema'];
BEGIN
  FOREACH tbl IN ARRAY tablas LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
END $$;

SELECT 'Base de datos MAGARETTO configurada exitosamente con módulo de seguridad y roles.' AS status;
