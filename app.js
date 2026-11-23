/* ==============================================================================
   MAGARETTO - SISTEMA DE CONTROL DE EMPAQUE Y CÓDIGO DE BARRAS
   Lógica de Negocio, Driver de Pistola USB, Audio Synth y Motor Supabase
   ============================================================================== */

// ==============================================================================
// 1. CONFIGURACIÓN Y ESTADO GLOBAL
// ==============================================================================
// Limpiar claves de localStorage si apuntaban a proyectos anteriores (ej. VETE, Agroconecta o Bachelor)
(function purgeLegacyStorage() {
  const oldUrls = ['yqybugqwfxmsvoszoyhr', 'ladhxiimwzpvoxnvndys', 'ohhabwafbuyatrjycblr'];
  const savedUrl = localStorage.getItem('magaretto_supabase_url') || localStorage.getItem('vete_supabase_url') || localStorage.getItem('agroconecta_supabase_url');
  if (savedUrl && oldUrls.some(ou => savedUrl.includes(ou))) {
    localStorage.removeItem('magaretto_supabase_url');
    localStorage.removeItem('magaretto_supabase_key');
    localStorage.removeItem('vete_supabase_url');
    localStorage.removeItem('vete_supabase_key');
    localStorage.removeItem('agroconecta_supabase_url');
    localStorage.removeItem('agroconecta_supabase_key');
    localStorage.removeItem('magaretto_cached_employees');
    localStorage.removeItem('vete_cached_employees');
    localStorage.removeItem('agroconecta_cached_employees');
    localStorage.removeItem('magaretto_auth_session_v1');
    localStorage.removeItem('vete_auth_session_v1');
    localStorage.removeItem('agroconecta_auth_session_v1');
  }
})();

const APP_CONFIG = {
  SUPABASE_URL: localStorage.getItem('magaretto_supabase_url') || localStorage.getItem('vete_supabase_url') || 'https://dalhlqamxzmblggxffnt.supabase.co',
  SUPABASE_KEY: localStorage.getItem('magaretto_supabase_key') || localStorage.getItem('vete_supabase_key') || 'sb_publishable_eoaaNmuekqgQ2pl8T5a5Jg_uwhsHsLH',
  TARIFA_BASE: parseFloat(localStorage.getItem('magaretto_tarifa_base') || localStorage.getItem('vete_tarifa_base')) || 150.00,
  TOLERANCIA_DUPLICADO_SEG: parseInt(localStorage.getItem('magaretto_tolerancia_dup') || localStorage.getItem('vete_tolerancia_dup')) || 5,
  LINEA_EMPAQUE: localStorage.getItem('magaretto_linea') || localStorage.getItem('vete_linea') || 'Línea 1 - Galpón Principal',
  AUDIO_VOLUME: parseFloat(localStorage.getItem('magaretto_audio_vol') || localStorage.getItem('vete_audio_vol')) || 0.9,
  MODO_PRUEBA: localStorage.getItem('magaretto_modo_prueba') === 'true',
  MONEDA: '$'
};

// Estado en memoria para respuesta ultra rápida y control de acceso
const AppState = {
  supabaseClient: null,
  isOnline: navigator.onLine,
  supabaseConnected: false,
  testMode: localStorage.getItem('magaretto_modo_prueba') === 'true',
  currentUser: null, // Usuario autenticado { username, nombre_completo, rol, activo }
  users: [], // Lista de usuarios del sistema
  employees: [], // Lista en caché de empleados
  todayScans: [], // Escaneos del día de hoy
  recentScans: [], // Últimos escaneos para el stream en vivo y anti-duplicados
  totalHistoricalScans: 0, // Total acumulado histórico de cajas registradas en Supabase
  employeeBoxTotals: {}, // Mapa de cajas históricas por empleado { [id/codigo]: count }
  lastScannedTimeByCode: {}, // Para anti-duplicados por tiempo
  activeTab: 'tab-scanner',
  pendingSyncQueue: [] // Cola de registros pendientes de enviar a Supabase
};

// Usuarios iniciales del sistema (Roles: Administrador, Ejecutivo, RRHH, Usuario)
const DEFAULT_SYSTEM_USERS = [
  {
    id: 'user-nico',
    username: 'nico',
    nombre_completo: 'Nico',
    password_hash: 'e6d5e47d930591f026ca645226934cb5f4bf45d961da19b828c0f7f1ca34da8d', // chicho
    rol: 'Administrador',
    activo: true,
    created_at: new Date().toISOString()
  },
  {
    id: 'user-admin',
    username: 'admin',
    nombre_completo: 'Administrador General Magaretto',
    password_hash: '8fb05ad764196bb1ebd6305e1242cea66965e52f0584ad54db39d85596c7c219', // magaretto2026 (también acepta admin2026 y vete2026)
    rol: 'Administrador',
    activo: true,
    created_at: new Date().toISOString()
  },
  {
    id: 'user-ejecutivo',
    username: 'ejecutivo',
    nombre_completo: 'Dirección Ejecutiva',
    password_hash: 'c1a0286d7a9093f1eb4d06339654f548d101ccd24a5c92a14efd64116fa8696d', // ejecutivo2026
    rol: 'Ejecutivo',
    activo: true,
    created_at: new Date().toISOString()
  },
  {
    id: 'user-rrhh',
    username: 'rrhh',
    nombre_completo: 'Recursos Humanos',
    password_hash: '20e60c92cadd6d8a7fb5d07a7ccf1f0560e42974f597ac963e65e3f92158750b', // rrhh2026
    rol: 'RRHH',
    activo: true,
    created_at: new Date().toISOString()
  },
  {
    id: 'user-operador',
    username: 'operador',
    nombre_completo: 'Operador de Empaque',
    password_hash: '1725165c9a0b3698a3d01016e0d8205155820b8d7f21835ca64c0f81c728d880', // operador123
    rol: 'Usuario',
    activo: true,
    created_at: new Date().toISOString()
  }
];

// Función Criptográfica SHA-256 Segura (Soporta Web Crypto API y Fallback puro para HTTP en red local/celular)
function sha256_pure(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  var mathPow = Math.pow;
  var maxWord = mathPow(2, 32);
  var lengthProperty = 'length';
  var i, j;
  var result = '';
  var words = [];
  var asciiBitLength = ascii[lengthProperty] * 8;
  var hash = [];
  var k = [];
  var primeCounter = 0;
  var isComposite = {};
  for (var candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  ascii += '\x80';
  while (ascii[lengthProperty] % 64 - 56) ascii += '\x00';
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    words[i >> 2] |= j << ((3 - i) % 4) * 8;
  }
  words[words[lengthProperty]] = ((asciiBitLength / maxWord) | 0);
  words[words[lengthProperty]] = (asciiBitLength) | 0;

  for (j = 0; j < words[lengthProperty];) {
    var w = words.slice(j, j += 16);
    var oldHash = hash;
    hash = hash.slice(0, 8);
    for (i = 0; i < 64; i++) {
      var w15 = w[i - 15], w2 = w[i - 2];
      var a = hash[0], e = hash[4];
      var temp1 = hash[7]
        + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
        + ((e & hash[5]) ^ ((~e) & hash[6]))
        + k[i]
        + (w[i] = (i < 16) ? w[i] : (
            w[i - 16]
            + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
            + w[i - 7]
            + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
          ) | 0
        );
      var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
        + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));

      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }
    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }
  for (i = 0; i < 8; i++) {
    for (var i2 = 3; i2 >= 0; i2--) {
      var b = (hash[i] >> (8 * i2)) & 255;
      result += ((b < 16) ? 0 : '') + b.toString(16);
    }
  }
  return result;
}

async function hashPassword(plainText) {
  if (!plainText) return '';
  try {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle && typeof window.crypto.subtle.digest === 'function') {
      const encoder = new TextEncoder();
      const data = encoder.encode(plainText);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) {
    console.warn('crypto.subtle no disponible (contexto HTTP), usando fallback SHA-256');
  }
  return sha256_pure(plainText);
}

// ==============================================================================
// GESTOR DE ENVASES ACTIVOS DE JORNADA (PRIMERA Y SEGUNDA)
// El operador selecciona un envase para Primera y un envase para Segunda:
// - Para PRIMERA (000): 'Caja 10 kgs.' o 'Caja 14 kgs.'
// - Para SEGUNDA (002): 'Caja 10 kgs.' o 'Caja 14 kgs.'
// Al escanear un código de barras de 7 dígitos [3d Calidad: 000, 002, 003][4d Personal]:
// - Si la calidad es '000' (Primera) -> asigna el tipo de envase configurado para Primera.
// - Si la calidad es '002' (Segunda) -> asigna el tipo de envase configurado para Segunda.
// Ambos se sincronizan en la nube (Supabase) en tiempo real para todos los dispositivos.
// ==============================================================================
const VALID_PRIMERA_OPTIONS = [
  'Caja 10 kgs.',
  'Caja 14 kgs.'
];

const VALID_SEGUNDA_OPTIONS = [
  'Caja 10 kgs.',
  'Caja 14 kgs.'
];

const PackingOptions = {
  storageKeyPrimera: 'vete_envase_primera',
  storageKeySegunda: 'vete_envase_segunda',

  getPrimera() {
    const saved = localStorage.getItem(this.storageKeyPrimera);
    if (VALID_PRIMERA_OPTIONS.includes(saved)) {
      return saved;
    }
    if (saved && (saved.includes('14') || saved.includes('13') || saved.includes('LIBRAS'))) return 'Caja 14 kgs.';
    return 'Caja 10 kgs.';
  },

  getSegunda() {
    const saved = localStorage.getItem(this.storageKeySegunda);
    if (VALID_SEGUNDA_OPTIONS.includes(saved)) {
      return saved;
    }
    if (saved && (saved.includes('14') || saved.includes('20') || saved.includes('BOLSA'))) return 'Caja 14 kgs.';
    return 'Caja 10 kgs.';
  },

  setPrimera(val) {
    if (!VALID_PRIMERA_OPTIONS.includes(val)) return;
    localStorage.setItem(this.storageKeyPrimera, val);
    this.syncUI();
    this.saveToSupabase();
  },

  setSegunda(val) {
    if (!VALID_SEGUNDA_OPTIONS.includes(val)) return;
    localStorage.setItem(this.storageKeySegunda, val);
    this.syncUI();
    this.saveToSupabase();
  },

  handleRemoteUpdate(rawVal) {
    if (!rawVal) return;
    let p = null;
    let s = null;
    try {
      if (typeof rawVal === 'string' && rawVal.trim().startsWith('{')) {
        const parsed = JSON.parse(rawVal);
        p = parsed.primera;
        s = parsed.segunda;
      } else if (typeof rawVal === 'string') {
        if (rawVal.includes('14') || rawVal.includes('13 LIBRAS')) p = 'Caja 14 kgs.';
        else if (rawVal.includes('BOLSA') || rawVal.includes('20')) s = 'Caja 14 kgs.';
      }
    } catch (_) {}

    if (p === 'CAJA 10 KG') p = 'Caja 10 kgs.';
    if (p === 'CAJA 13 LIBRAS') p = 'Caja 14 kgs.';
    if (s === 'CAJA 10 KG') s = 'Caja 10 kgs.';
    if (s === 'BOLSA 20 KG') s = 'Caja 14 kgs.';

    let changed = false;
    if (p && VALID_PRIMERA_OPTIONS.includes(p)) {
      if (localStorage.getItem(this.storageKeyPrimera) !== p) {
        localStorage.setItem(this.storageKeyPrimera, p);
        changed = true;
      }
    }
    if (s && VALID_SEGUNDA_OPTIONS.includes(s)) {
      if (localStorage.getItem(this.storageKeySegunda) !== s) {
        localStorage.setItem(this.storageKeySegunda, s);
        changed = true;
      }
    }
    if (changed) {
      this.syncUI();
      console.log('📦 Envases de jornada actualizados desde la nube:', { primera: this.getPrimera(), segunda: this.getSegunda() });
    }
  },

  async saveToSupabase() {
    if (!AppState.supabaseClient || !AppState.supabaseConnected) return;
    const payloadStr = JSON.stringify({
      primera: this.getPrimera(),
      segunda: this.getSegunda()
    });
    try {
      const { error } = await AppState.supabaseClient
        .from('configuracion')
        .upsert({
          id: 'envase_jornada',
          nombre_empresa: payloadStr,
          updated_at: new Date().toISOString()
        });
      if (error) {
        console.warn('Error guardando envases en Supabase:', error);
      } else {
        console.log('✅ Envases de jornada sincronizados en Supabase:', payloadStr);
      }
    } catch (e) {
      console.warn('Excepción guardando envases en Supabase:', e);
    }
  },

  async loadFromSupabase() {
    if (!AppState.supabaseClient || !AppState.supabaseConnected) return;
    try {
      const { data, error } = await AppState.supabaseClient
        .from('configuracion')
        .select('id, nombre_empresa')
        .eq('id', 'envase_jornada')
        .maybeSingle();

      if (!error && data && data.nombre_empresa) {
        this.handleRemoteUpdate(data.nombre_empresa);
      }
    } catch (e) {
      console.warn('Error leyendo envases desde Supabase:', e);
    }
  },

  // Obtiene los detalles de empaque según el código de calidad del código de barra:
  // 7 Dígitos: '000' Primera, '002' Segunda, '003' Araña, 'DESCARTE'/'DS' Descarte
  // (También mantiene compatibilidad con '01', '02', '03')
  getDetailsForQuality(qualityCode) {
    const qCode = String(qualityCode || '').trim();
    if (qCode === '002' || qCode === '02') {
      const boxName = this.getSegunda();
      const boxCode = (boxName.includes('10')) ? '10KG' : '14KG';
      return {
        calidad: 'Segunda',
        qualityCode: '002',
        calidadCorto: '2ª',
        boxName: boxName,
        boxCode: boxCode,
        fullName: `Segunda ${boxName}`
      };
    } else if (qCode === '003' || qCode === '03') {
      return {
        calidad: 'Araña',
        qualityCode: '003',
        calidadCorto: 'Araña',
        boxName: 'Caja Araña',
        boxCode: 'ARANA',
        fullName: 'Araña Caja Araña'
      };
    } else if (qCode === 'DESCARTE' || qCode === 'DS') {
      return {
        calidad: 'Descarte',
        qualityCode: 'DESCARTE',
        calidadCorto: 'Descarte',
        boxName: 'Descarte',
        boxCode: 'DESC',
        fullName: 'Cajas de Descarte'
      };
    } else {
      // Por defecto o '000' / '01': Primera
      const boxName = this.getPrimera();
      const boxCode = (boxName.includes('10')) ? '10KG' : '14KG';
      return {
        calidad: 'Primera',
        qualityCode: '000',
        calidadCorto: '1ª',
        boxName: boxName,
        boxCode: boxCode,
        fullName: `Primera ${boxName}`
      };
    }
  },

  getDetails() {
    return this.getDetailsForQuality('000');
  },

  getActive() {
    return this.getSummaryText();
  },

  getSummaryText() {
    return `1ª: ${this.getPrimera()} | 2ª: ${this.getSegunda()}`;
  },

  syncUI() {
    const primera = this.getPrimera();
    const segunda = this.getSegunda();
    const kpiVal = document.getElementById('kpiEnvaseActivo');
    if (kpiVal) {
      kpiVal.innerHTML = `
        <span class="envase-line-1">1ª: <strong>${primera}</strong></span>
        <span class="envase-line-2">2ª: <strong>${segunda}</strong></span>
      `;
      kpiVal.title = `Primera (000): ${primera} · Segunda (002): ${segunda}`;
    }

    const selPrimera = document.getElementById('selectEnvasePrimera');
    if (selPrimera && selPrimera.value !== primera) {
      selPrimera.value = primera;
    }
    const selSegunda = document.getElementById('selectEnvaseSegunda');
    if (selSegunda && selSegunda.value !== segunda) {
      selSegunda.value = segunda;
    }
  },

  init() {
    this.syncUI();
    const selPrimera = document.getElementById('selectEnvasePrimera');
    if (selPrimera) {
      selPrimera.value = this.getPrimera();
      selPrimera.addEventListener('change', (e) => {
        this.setPrimera(e.target.value);
        showToast(`📦 Primera (000) fijada: ${e.target.value}`, 'success');
      });
    }

    const selSegunda = document.getElementById('selectEnvaseSegunda');
    if (selSegunda) {
      selSegunda.value = this.getSegunda();
      selSegunda.addEventListener('change', (e) => {
        this.setSegunda(e.target.value);
        showToast(`📦 Segunda (002) fijada: ${e.target.value}`, 'success');
      });
    }

    this.loadFromSupabase();
  }
};

// Catálogos Oficiales de Calidad para VETE (7 Dígitos: [3d Calidad: 000, 002, 003][4d Personal])
const CALIDADES_VETE = {
  '000': { codigo: '000', nombre: 'Primera', corto: '1ª' },
  '002': { codigo: '002', nombre: 'Segunda', corto: '2ª' },
  '003': { codigo: '003', nombre: 'Araña', corto: 'Araña' },
  '01': { codigo: '000', nombre: 'Primera', corto: '1ª' },
  '02': { codigo: '002', nombre: 'Segunda', corto: '2ª' },
  '03': { codigo: '003', nombre: 'Araña', corto: 'Araña' },
  'DESCARTE': { codigo: 'DESCARTE', nombre: 'Descarte', corto: 'Descarte' },
  'DS': { codigo: 'DESCARTE', nombre: 'Descarte', corto: 'Descarte' }
};
const CALIDADES_AGRO = CALIDADES_VETE; // Compatibilidad
const CALIDADES_AJO = CALIDADES_VETE; // Compatibilidad

// Helper para extraer el código de empleado de 4 dígitos de un registro o código de barra
function extractEmpCodeFromRecord(r) {
  if (!r) return '0000';
  if (r.codigo_empleado_extraido) return String(r.codigo_empleado_extraido).trim();
  const clean = String(r.codigo_barra_leido || '').trim().replace(/[^0-9a-zA-Z]/g, '');
  if (clean.startsWith('000') || clean.startsWith('002') || clean.startsWith('003')) {
    if (clean.length >= 7) return clean.substring(3, 7);
  }
  if (clean.length === 7) return clean.substring(3, 7);
  if (clean.length === 10) return clean.substring(0, 4);
  if (clean.length === 6) return clean.substring(0, 4);
  return clean.padStart(4, '0').substring(0, 4);
}

// Parser de Código de Barra Oficial VETE (7 Dígitos):
// - Los primeros 3 dígitos son la calidad: 000 (Primera), 002 (Segunda), 003 (Araña)
// - Los últimos 4 dígitos identifican al personal (empacador)
function parseVeteBarcode(rawBarcode) {
  const clean = String(rawBarcode || '').trim().replace(/[^0-9a-zA-Z]/g, '');

  const startsWithNewQuality = clean.startsWith('000') || clean.startsWith('002') || clean.startsWith('003');

  // 1. Estructura Oficial VETE de 7 Dígitos: [3d Calidad: 000, 002, 003][4d Personal]
  if (clean.length === 7 || (clean.length > 7 && startsWithNewQuality)) {
    const barcodeQualityCode = clean.substring(0, 3);
    const empCode = clean.substring(3, 7);
    const qualityDetails = PackingOptions.getDetailsForQuality(barcodeQualityCode);

    return {
      isValid: true,
      is7Digit: clean.length === 7,
      fullCode: clean,
      empCode: empCode,
      barcodeQualityCode: barcodeQualityCode,
      qualityCode: qualityDetails.qualityCode,
      calidadNombre: qualityDetails.calidad,
      calidadCorto: qualityDetails.calidadCorto,
      correlativo: clean.length > 7 ? clean.substring(7) : '',
      boxTypeCode: qualityDetails.boxCode,
      tipoCajaNombre: qualityDetails.boxName,
      tipoCajaCorto: qualityDetails.boxName,
      envaseCompleto: qualityDetails.fullName
    };
  }

  // 2. Compatibilidad con códigos previos de 10 Dígitos: [4d Personal][2d Calidad][4d Correlativo]
  if (clean.length === 10) {
    const empCode = clean.substring(0, 4);
    const barcodeQualityCode = clean.substring(4, 6);
    const correlativo = clean.substring(6, 10);
    const qualityDetails = PackingOptions.getDetailsForQuality(barcodeQualityCode);

    return {
      isValid: true,
      is7Digit: false,
      is10Digit: true,
      fullCode: clean,
      empCode: empCode,
      barcodeQualityCode: barcodeQualityCode,
      qualityCode: qualityDetails.qualityCode,
      calidadNombre: qualityDetails.calidad,
      calidadCorto: qualityDetails.calidadCorto,
      correlativo: correlativo,
      boxTypeCode: qualityDetails.boxCode,
      tipoCajaNombre: qualityDetails.boxName,
      tipoCajaCorto: qualityDetails.boxName,
      envaseCompleto: qualityDetails.fullName
    };
  }

  // 3. Compatibilidad con códigos previos de 6 Dígitos: [4d Personal][2d Calidad]
  if (clean.length === 6) {
    const empCode = clean.substring(0, 4);
    const barcodeQualityCode = clean.substring(4, 6);
    const qualityDetails = PackingOptions.getDetailsForQuality(barcodeQualityCode);

    return {
      isValid: true,
      is7Digit: false,
      is6Digit: true,
      fullCode: clean,
      empCode: empCode,
      barcodeQualityCode: barcodeQualityCode,
      qualityCode: qualityDetails.qualityCode,
      calidadNombre: qualityDetails.calidad,
      calidadCorto: qualityDetails.calidadCorto,
      correlativo: '',
      boxTypeCode: qualityDetails.boxCode,
      tipoCajaNombre: qualityDetails.boxName,
      tipoCajaCorto: qualityDetails.boxName,
      envaseCompleto: qualityDetails.fullName
    };
  }

  // 4. Fallback si escanean código menor o no estándar
  const empCode = clean.padStart(4, '0').substring(0, 4);
  const qualityDetails = PackingOptions.getDetailsForQuality('000');
  return {
    isValid: false,
    is7Digit: false,
    fullCode: clean,
    empCode: empCode,
    barcodeQualityCode: '000',
    qualityCode: qualityDetails.qualityCode,
    calidadNombre: qualityDetails.calidad,
    calidadCorto: '1ª',
    correlativo: '',
    boxTypeCode: qualityDetails.boxCode,
    tipoCajaNombre: qualityDetails.boxName,
    tipoCajaCorto: qualityDetails.boxName,
    envaseCompleto: qualityDetails.fullName
  };
}

// Alias para mantener compatibilidad en todo el código
const parseAgroBarcode = parseVeteBarcode;

// Empleados iniciales de respaldo con códigos de 4 dígitos (con IDs exactos sincronizados con Supabase)
const INITIAL_FALLBACK_EMPLOYEES = [
  { id: '49280d93-4242-465b-91c3-bca5c911dfa8', codigo_empleado: '0101', nombre_completo: 'Juan Carlos Mendoza', dni_rut: '28.450.123', telefono: '+54 9 261 455-1122', tarifa_personalizada: 150.00, activo: true },
  { id: '0689de4c-abf0-4cd1-9c71-9b5be0dcdf87', codigo_empleado: '0102', nombre_completo: 'María Elena Gómez', dni_rut: '30.124.789', telefono: '+54 9 261 455-2233', tarifa_personalizada: 150.00, activo: true },
  { id: '5f9525b6-529f-4313-bcd1-562e3a5d274a', codigo_empleado: '0103', nombre_completo: 'Pedro Antonio López', dni_rut: '27.890.456', telefono: '+54 9 261 455-3344', tarifa_personalizada: 160.00, activo: true },
  { id: '657e0343-60cb-4875-87f9-f13941c2aeaf', codigo_empleado: '0104', nombre_completo: 'Rosaura Benítez', dni_rut: '32.654.987', telefono: '+54 9 261 455-4455', tarifa_personalizada: 150.00, activo: true },
  { id: '887f1a90-5456-4f6b-b3f9-a1e648b7165a', codigo_empleado: '0121', nombre_completo: 'Carlos Rodríguez (Ejemplo 0121)', dni_rut: '31.852.963', telefono: '+54 9 261 455-7788', tarifa_personalizada: 150.00, activo: true }
];

// ==============================================================================
// 2. MOTOR DE SONIDO (WEB AUDIO API) - BEEP FUERTE Y POTENTE (< 5ms LATENCIA)
// ==============================================================================
class SoundEngine {
  constructor() {
    this.audioCtx = null;
  }

  _initContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  /**
   * Beep de Éxito: Tono agudo (1200Hz y armónico 1800Hz), claro y penetrante para plantas de empaque ruidosas
   */
  playSuccessBeep() {
    try {
      this._initContext();
      const ctx = this.audioCtx;
      const now = ctx.currentTime;
      const vol = APP_CONFIG.AUDIO_VOLUME;

      // Oscilador 1: Tono Principal (1200 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(1200, now);
      osc1.frequency.exponentialRampToValueAtTime(1400, now + 0.1);

      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(vol * 0.9, now + 0.015);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

      // Oscilador 2: Armónico de Brillo (1800 Hz)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(1800, now);
      gain2.gain.setValueAtTime(0, now);
      gain2.gain.linearRampToValueAtTime(vol * 0.4, now + 0.015);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.14);
      osc2.stop(now + 0.14);
    } catch (e) {
      console.warn('Audio Context no pudo reproducir tono:', e);
    }
  }

  /**
   * Tono de Error / Desconocido: Doble tono grave tipo zumbador (280Hz)
   */
  playErrorBeep() {
    try {
      this._initContext();
      const ctx = this.audioCtx;
      const now = ctx.currentTime;
      const vol = APP_CONFIG.AUDIO_VOLUME;

      // Dos pulsos de advertencia graves
      [0, 0.15].forEach(offset => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(260, now + offset);

        gain.gain.setValueAtTime(0, now + offset);
        gain.gain.linearRampToValueAtTime(vol * 0.8, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.11);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.12);
      });
    } catch (e) {
      console.warn('Audio error beep falló:', e);
    }
  }

  /**
   * Alarma Sonora de Duplicado de Correlativo (Alerta de Alta Urgencia):
   * 3 pulsos potentes y penetrantes tipo sirena industrial descendente (880Hz -> 320Hz)
   * Diseñado específicamente para alertar al operador en caso de doble picking
   */
  playDuplicateAlertSound() {
    try {
      this._initContext();
      const ctx = this.audioCtx;
      const now = ctx.currentTime;
      const vol = APP_CONFIG.AUDIO_VOLUME;

      [0, 0.15, 0.30].forEach(offset => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, now + offset);
        osc.frequency.exponentialRampToValueAtTime(320, now + offset + 0.12);

        gain.gain.setValueAtTime(0, now + offset);
        gain.gain.linearRampToValueAtTime(vol * 0.95, now + offset + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.13);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.14);
      });
    } catch (e) {
      console.warn('Audio duplicate alert falló:', e);
    }
  }

  playDuplicateBeep() {
    this.playDuplicateAlertSound();
  }
}

const AudioPlayer = new SoundEngine();

// ==============================================================================
// 3. GESTOR MULTI-ZONA (3 ZONAS DE MARCADO x 2 ESCÁNERES = 6 ESCÁNERES EN 1 PC)
// ==============================================================================
const MultiZoneScannerManager = {
  storageKey: 'magaretto_zones_config_v1',
  ZONES: [
    { id: 'zona_1', name: 'Zona 1', shortName: 'Z1', scanners: [1, 2], color: '#60A5FA' },
    { id: 'zona_2', name: 'Zona 2', shortName: 'Z2', scanners: [3, 4], color: '#22C55E' },
    { id: 'zona_3', name: 'Zona 3', shortName: 'Z3', scanners: [5, 6], color: '#A78BFA' }
  ],
  config: {
    prefixes: { 1: 'S1', 2: 'S2', 3: 'S3', 4: 'S4', 5: 'S5', 6: 'S6' },
    duplicateScope: 'zone', // 'zone' | 'scanner'
    autoRouteSimultaneous: true,
    activeZoneId: 'zona_1',
    serialAssignments: {} // { [scannerId]: { portIndex, usbVendorId, usbProductId, pairedAt } }
  },
  lastTimeByScopeKey: {},
  cooldownMetaByZone: {}, // { zona_1: { code, expiresAt, lastLabel } }
  serialConnections: {},
  serialReaders: {},
  _tickerInterval: null,
  _initialized: false,
  _reconnectTimeout: null,

  init() {
    this.loadConfig();
    if (!this._initialized) {
      this._initialized = true;
      this.bindUIEvents();
      this.startCooldownTicker();
      this.setupUnloadCleanup();
    }
    this.syncSettingsUI();
    this.refreshZoneCounts();
    // Programar reconexión con breve espera para que el sistema operativo y Chrome liberen puertos del reload anterior
    if (this._reconnectTimeout) clearTimeout(this._reconnectTimeout);
    this._reconnectTimeout = setTimeout(() => this.autoConnectSerialPorts(), 450);
  },

  setupUnloadCleanup() {
    window.addEventListener('beforeunload', () => {
      // Liberar streams antes de que la página cierre o recargue
      for (const id in this.serialReaders) {
        try { this.serialReaders[id].cancel(); } catch (_) {}
      }
    });

    // Si el navegador postergó la apertura hasta una interacción del usuario, reconectar en el primer clic
    let gestureTriggered = false;
    document.addEventListener('click', () => {
      if (gestureTriggered) return;
      const assignedCount = Object.keys(this.config.serialAssignments || {}).length;
      const connectedCount = Object.keys(this.serialConnections || {}).length;
      if (assignedCount > 0 && connectedCount < assignedCount) {
        gestureTriggered = true;
        this.autoConnectSerialPorts();
      }
    }, { passive: true });
  },

  loadConfig() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (parsed.prefixes && typeof parsed.prefixes === 'object') {
            for (let id = 1; id <= 6; id++) {
              const p = String(parsed.prefixes[id] || `S${id}`).trim().toUpperCase();
              this.config.prefixes[id] = p || `S${id}`;
            }
          }
          if (parsed.duplicateScope === 'scanner' || parsed.duplicateScope === 'zone') {
            this.config.duplicateScope = parsed.duplicateScope;
          }
          if (typeof parsed.autoRouteSimultaneous === 'boolean') {
            this.config.autoRouteSimultaneous = parsed.autoRouteSimultaneous;
          }
          if (this.getZoneMeta(parsed.activeZoneId)) {
            this.config.activeZoneId = parsed.activeZoneId;
          }
          if (parsed.serialAssignments && typeof parsed.serialAssignments === 'object') {
            this.config.serialAssignments = parsed.serialAssignments;
          }
        }
      }
    } catch (e) {
      console.warn('Error cargando config de zonas:', e);
    }
  },

  saveConfig(nextConfig = {}) {
    if (nextConfig.prefixes) {
      for (let id = 1; id <= 6; id++) {
        const val = String(nextConfig.prefixes[id] || `S${id}`).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
        this.config.prefixes[id] = val || `S${id}`;
      }
    }
    if (nextConfig.duplicateScope === 'scanner' || nextConfig.duplicateScope === 'zone') {
      this.config.duplicateScope = nextConfig.duplicateScope;
    }
    if (typeof nextConfig.autoRouteSimultaneous === 'boolean') {
      this.config.autoRouteSimultaneous = nextConfig.autoRouteSimultaneous;
    }
    if (nextConfig.activeZoneId && this.getZoneMeta(nextConfig.activeZoneId)) {
      this.config.activeZoneId = nextConfig.activeZoneId;
    }
    if (nextConfig.serialAssignments && typeof nextConfig.serialAssignments === 'object') {
      this.config.serialAssignments = nextConfig.serialAssignments;
    }
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.config));
    } catch (_) {}
    this.syncSettingsUI();
    this.refreshZoneCounts();
  },

  getZoneMeta(zoneId) {
    return this.ZONES.find(z => z.id === zoneId) || null;
  },

  getScannerZone(scannerId) {
    const sid = Number(scannerId);
    return this.ZONES.find(z => z.scanners.includes(sid)) || this.ZONES[0];
  },

  getDefaultScannerForZone(zoneId) {
    const z = this.getZoneMeta(zoneId) || this.ZONES[0];
    return z.scanners[0];
  },

  buildPrefixEntries() {
    const entries = [];
    for (let id = 1; id <= 6; id++) {
      const p = String(this.config.prefixes[id] || `S${id}`).trim().toUpperCase();
      if (p) {
        const z = this.getScannerZone(id);
        entries.push({ prefix: p, zoneId: z.id, zoneName: z.name, scannerId: id, sepOptional: true });
      }
    }
    // Aliases estándar compatibles (S1..S6, E1..E6, Z1..Z3, 1-..3-, 1:..3:, 1#..3#)
    for (let id = 1; id <= 6; id++) {
      const z = this.getScannerZone(id);
      entries.push({ prefix: `S${id}`, zoneId: z.id, zoneName: z.name, scannerId: id, sepOptional: true });
      entries.push({ prefix: `E${id}`, zoneId: z.id, zoneName: z.name, scannerId: id, sepOptional: true });
    }
    this.ZONES.forEach((z, idx) => {
      const num = idx + 1;
      entries.push({ prefix: `ZONA${num}`, zoneId: z.id, zoneName: z.name, scannerId: z.scanners[0], sepOptional: true });
      entries.push({ prefix: `Z${num}`, zoneId: z.id, zoneName: z.name, scannerId: z.scanners[0], sepOptional: true });
      entries.push({ prefix: `${num}-`, zoneId: z.id, zoneName: z.name, scannerId: z.scanners[0], sepOptional: true });
      entries.push({ prefix: `${num}:`, zoneId: z.id, zoneName: z.name, scannerId: z.scanners[0], sepOptional: true });
      entries.push({ prefix: `${num}#`, zoneId: z.id, zoneName: z.name, scannerId: z.scanners[0], sepOptional: true });
    });

    // Deduplicar conservando prioridad de prefijos configurados y ordenando de mayor a menor longitud
    const seen = new Map();
    entries.forEach(e => {
      if (!seen.has(e.prefix)) seen.set(e.prefix, e);
    });
    return Array.from(seen.values()).sort((a, b) => b.prefix.length - a.prefix.length);
  },

  matchPrefixAtStart(str, prefixEntries) {
    const upper = String(str || '').toUpperCase();
    for (let i = 0; i < prefixEntries.length; i++) {
      const entry = prefixEntries[i];
      if (upper.startsWith(entry.prefix)) {
        let rest = upper.slice(entry.prefix.length);
        // Remover separador opcional después del prefijo (ej: S1-0000121, Z2:0000121)
        if (/^[-:_#]/.test(rest)) {
          rest = rest.slice(1);
        }
        if (rest.length >= 4) {
          return { entry, bodyStartOffset: upper.length - rest.length, rest };
        }
      }
    }
    return null;
  },

  parseSingleChunk(chunk, prefixEntries) {
    const tokens = [];
    const upper = String(chunk || '').trim().toUpperCase();
    if (!upper) return tokens;

    // 1. Intentar separar múltiples códigos prefijados concatenados (ej: S10000121S30000121)
    let pos = 0;
    const firstMatch = this.matchPrefixAtStart(upper, prefixEntries);
    if (firstMatch) {
      while (pos < upper.length) {
        const sub = upper.slice(pos);
        const m = this.matchPrefixAtStart(sub, prefixEntries);
        if (!m) break;

        const bodyStart = pos + m.bodyStartOffset;
        let nextPrefixPos = upper.length;

        // Buscar siguiente prefijo válido a partir de al menos 6 caracteres del cuerpo
        for (let scanIdx = bodyStart + 6; scanIdx < upper.length; scanIdx++) {
          const tail = upper.slice(scanIdx);
          const nextM = this.matchPrefixAtStart(tail, prefixEntries);
          if (nextM && /^[0-9A-Z]{6,}/.test(nextM.rest)) {
            nextPrefixPos = scanIdx;
            break;
          }
        }

        const rawCodeBody = upper.slice(bodyStart, nextPrefixPos).replace(/[^0-9A-Z]/g, '');
        if (rawCodeBody) {
          tokens.push({
            rawToken: upper.slice(pos, nextPrefixPos),
            cleanCode: rawCodeBody,
            zoneId: m.entry.zoneId,
            zoneName: m.entry.zoneName,
            scannerId: m.entry.scannerId,
            hadExplicitZone: true
          });
        }
        pos = nextPrefixPos;
      }
      if (tokens.length > 0) return tokens;
    }

    // 2. Sin prefijo explícito: verificar si hay múltiples códigos VETE de 7 dígitos pegados (ej: 00001210000121)
    const clean = upper.replace(/[^0-9A-Z]/g, '');
    if (clean.length >= 14 && clean.length % 7 === 0 && /^(?:(?:000|002|003)\d{4}){2,}$/.test(clean)) {
      for (let i = 0; i < clean.length; i += 7) {
        const part = clean.slice(i, i + 7);
        tokens.push({
          rawToken: part,
          cleanCode: part,
          zoneId: null,
          zoneName: null,
          scannerId: null,
          hadExplicitZone: false
        });
      }
      return tokens;
    }

    // 3. Token único sin prefijo
    if (clean) {
      tokens.push({
        rawToken: upper,
        cleanCode: clean,
        zoneId: null,
        zoneName: null,
        scannerId: null,
        hadExplicitZone: false
      });
    }
    return tokens;
  },

  parseBurst(rawBuffer) {
    const text = String(rawBuffer || '').trim();
    if (!text) return [];
    const prefixEntries = this.buildPrefixEntries();
    const rawChunks = text.split(/[\r\n,;|+\s]+/).filter(Boolean);
    const allTokens = [];
    rawChunks.forEach(chunk => {
      const parsed = this.parseSingleChunk(chunk, prefixEntries);
      parsed.forEach(tok => allTokens.push(tok));
    });
    return allTokens;
  },

  getDedupScopeKey(zoneId, scannerId, cleanCode) {
    if (this.config.duplicateScope === 'scanner' && scannerId) {
      return `scanner_${scannerId}__${cleanCode}`;
    }
    return `${zoneId}__${cleanCode}`;
  },

  resolveZoneForScan(tokenInfo, cleanCode, now, options = {}) {
    const toleranceMs = (Number(APP_CONFIG.TOLERANCIA_DUPLICADO_SEG) || 5) * 1000;
    let targetZoneId = options.zoneId || (tokenInfo && tokenInfo.zoneId) || this.config.activeZoneId || 'zona_1';
    let targetScannerId = options.scannerId || (tokenInfo && tokenInfo.scannerId) || this.getDefaultScannerForZone(targetZoneId);
    const hadExplicitZone = Boolean(options.zoneId || (tokenInfo && tokenInfo.hadExplicitZone));
    let autoRouted = false;

    // Si llega sin prefijo de zona y la zona activa está dentro de la ventana anti-duplicado para ese código,
    // asumir lectura simultánea en otra zona y derivar a la primera zona libre (Zona 1 -> Zona 2 -> Zona 3).
    if (!hadExplicitZone && !options.ignoreDuplicate && this.config.autoRouteSimultaneous) {
      const primaryKey = this.getDedupScopeKey(targetZoneId, targetScannerId, cleanCode);
      const primaryElapsed = now - (this.lastTimeByScopeKey[primaryKey] || 0);
      if (primaryElapsed < toleranceMs) {
        const startIdx = this.ZONES.findIndex(z => z.id === targetZoneId);
        for (let step = 1; step < this.ZONES.length; step++) {
          const candidate = this.ZONES[(Math.max(0, startIdx) + step) % this.ZONES.length];
          const candidateScanner = candidate.scanners[0];
          const candKey = this.getDedupScopeKey(candidate.id, candidateScanner, cleanCode);
          const candElapsed = now - (this.lastTimeByScopeKey[candKey] || 0);
          if (candElapsed >= toleranceMs) {
            targetZoneId = candidate.id;
            targetScannerId = candidateScanner;
            autoRouted = true;
            break;
          }
        }
      }
    }

    const zoneMeta = this.getZoneMeta(targetZoneId) || this.ZONES[0];
    const resolvedScannerId = targetScannerId || zoneMeta.scanners[0];
    const dedupScopeKey = this.getDedupScopeKey(zoneMeta.id, resolvedScannerId, cleanCode);
    const deviceLabel = options.origenDispositivo
      ? options.origenDispositivo
      : `Escáner ${resolvedScannerId} (${zoneMeta.name})`;

    return {
      zoneId: zoneMeta.id,
      zoneName: zoneMeta.name,
      scannerId: resolvedScannerId,
      deviceLabel,
      hadExplicitZone,
      autoRouted,
      dedupScopeKey
    };
  },

  isDuplicate(dedupScopeKey, now, toleranceSec) {
    const lastTime = this.lastTimeByScopeKey[dedupScopeKey] || 0;
    const elapsedSec = (now - lastTime) / 1000;
    const tol = Number(toleranceSec) || 5;
    return {
      blocked: lastTime > 0 && elapsedSec < tol,
      elapsedSec,
      remainingSec: Math.max(0, Math.ceil(tol - elapsedSec))
    };
  },

  markScanned(resolved, cleanCode, now, meta = {}) {
    this.lastTimeByScopeKey[resolved.dedupScopeKey] = now;
    AppState.lastScannedTimeByCode[resolved.dedupScopeKey] = now;

    const tolMs = (Number(APP_CONFIG.TOLERANCIA_DUPLICADO_SEG) || 5) * 1000;
    this.cooldownMetaByZone[resolved.zoneId] = {
      code: cleanCode,
      empName: meta.empName || '',
      expiresAt: now + tolMs
    };

    const lastEl = document.getElementById(`zoneLastScan_${resolved.zoneId}`);
    if (lastEl) {
      const timeStr = new Date(now).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      lastEl.textContent = `${meta.empName || cleanCode} · E${resolved.scannerId} (${timeStr})`;
    }

    this.notifyZoneResult(resolved.zoneId, resolved.scannerId, 'ok');
    this.updateCooldownBadges();
  },

  notifyZoneResult(zoneId, scannerId, status) {
    const card = document.getElementById(`zoneCard_${zoneId}`);
    if (card) {
      card.classList.remove('zone-flash-ok', 'zone-flash-dup');
      void card.offsetWidth;
      card.classList.add(status === 'duplicate' ? 'zone-flash-dup' : 'zone-flash-ok');
    }
    if (scannerId) {
      const pill = document.getElementById(`scannerPill${scannerId}`);
      if (pill) {
        pill.classList.remove('active-pulse');
        void pill.offsetWidth;
        pill.classList.add('active-pulse');
        setTimeout(() => pill.classList.remove('active-pulse'), 850);
      }
    }
  },

  setActiveZone(zoneId) {
    if (!this.getZoneMeta(zoneId)) return;
    this.config.activeZoneId = zoneId;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.config));
    } catch (_) {}
    this.ZONES.forEach(z => {
      const card = document.getElementById(`zoneCard_${z.id}`);
      if (card) card.classList.toggle('is-default', z.id === zoneId);
    });
  },

  refreshZoneCounts() {
    const counts = { zona_1: 0, zona_2: 0, zona_3: 0 };
    const latest = { zona_1: null, zona_2: null, zona_3: null };

    (AppState.todayScans || []).forEach(s => {
      const linea = String(s.linea_empaque || '').toLowerCase();
      const orig = String(s.origen_dispositivo || '').toLowerCase();
      let zKey = 'zona_1';
      if (linea.includes('zona 2') || orig.includes('zona 2') || orig.includes('escáner 3') || orig.includes('escáner 4')) {
        zKey = 'zona_2';
      } else if (linea.includes('zona 3') || orig.includes('zona 3') || orig.includes('escáner 5') || orig.includes('escáner 6')) {
        zKey = 'zona_3';
      }
      counts[zKey]++;
      if (!latest[zKey]) latest[zKey] = s;
    });

    this.ZONES.forEach(z => {
      const countEl = document.getElementById(`zoneCount_${z.id}`);
      if (countEl) countEl.textContent = counts[z.id].toLocaleString('es-AR');

      const lastEl = document.getElementById(`zoneLastScan_${z.id}`);
      if (lastEl && latest[z.id]) {
        const dt = new Date(latest[z.id].fecha_hora || Date.now());
        const t = isNaN(dt.getTime()) ? '' : dt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        lastEl.textContent = `${latest[z.id].empleado_nombre_snapshot || latest[z.id].codigo_barra_leido} (${t})`;
      }

      const card = document.getElementById(`zoneCard_${z.id}`);
      if (card) card.classList.toggle('is-default', z.id === this.config.activeZoneId);
    });

    for (let id = 1; id <= 6; id++) {
      const lbl = document.getElementById(`scannerPrefixLbl${id}`);
      if (lbl) lbl.textContent = this.config.prefixes[id] || `S${id}`;
    }
  },

  updateCooldownBadges() {
    const now = Date.now();
    this.ZONES.forEach(z => {
      const badge = document.getElementById(`zoneCooldown_${z.id}`);
      if (!badge) return;
      const meta = this.cooldownMetaByZone[z.id];
      if (meta && meta.expiresAt > now) {
        const rem = Math.ceil((meta.expiresAt - now) / 1000);
        badge.textContent = `Anti-dup ${meta.code}: ${rem}s`;
        badge.classList.add('cooling');
      } else {
        badge.textContent = 'LISTO';
        badge.classList.remove('cooling');
      }
    });
  },

  startCooldownTicker() {
    if (this._tickerInterval) clearInterval(this._tickerInterval);
    this._tickerInterval = setInterval(() => this.updateCooldownBadges(), 500);
  },

  syncSettingsUI() {
    for (let id = 1; id <= 6; id++) {
      const input = document.getElementById(`cfgScanner${id}Prefix`);
      if (input) input.value = this.config.prefixes[id] || `S${id}`;
      const lbl = document.getElementById(`scannerPrefixLbl${id}`);
      if (lbl) lbl.textContent = this.config.prefixes[id] || `S${id}`;
    }
    const scopeSel = document.getElementById('cfgDuplicateScope');
    if (scopeSel) scopeSel.value = this.config.duplicateScope;
    const autoChk = document.getElementById('cfgAutoRouteNoPrefix');
    if (autoChk) autoChk.checked = this.config.autoRouteSimultaneous;
    const modeChip = document.getElementById('multiZoneModeChip');
    if (modeChip) {
      modeChip.textContent = this.config.duplicateScope === 'scanner'
        ? 'Anti-duplicado por escáner individual'
        : 'Anti-duplicado independiente por zona';
    }

    // Reflejar estado de escáneres seriales guardados vs conectados
    const assignments = this.config.serialAssignments || {};
    for (let id = 1; id <= 6; id++) {
      const isConnected = !!this.serialConnections[id];
      const isSaved = !!assignments[id];
      this.updateSerialUI(id, isConnected, isSaved);
    }
  },

  async autoConnectSerialPorts() {
    if (!('serial' in navigator)) return;
    try {
      // Breve espera para asegurar que el sistema operativo y Chrome liberen los sockets COM del reload previo
      await new Promise(r => setTimeout(r, 450));
      const ports = await navigator.serial.getPorts();
      if (!ports || ports.length === 0) {
        this.resetUnconnectedUI();
        return;
      }

      const assignments = this.config.serialAssignments || {};
      const assignedScannerIds = Object.keys(assignments).map(Number);
      const usedPorts = new Set();
      let connectedCount = 0;

      if (assignedScannerIds.length > 0) {
        for (const scannerId of assignedScannerIds) {
          if (this.serialConnections[scannerId]) {
            connectedCount++;
            continue;
          }
          const cfg = assignments[scannerId];
          let portToUse = null;

          // 1. Intentar por coincidencia de Hardware IDs
          if (cfg && (cfg.usbVendorId || cfg.usbProductId)) {
            portToUse = ports.find(p => {
              if (usedPorts.has(p)) return false;
              const inf = (p.getInfo && typeof p.getInfo === 'function') ? p.getInfo() : {};
              return inf.usbVendorId === cfg.usbVendorId && inf.usbProductId === cfg.usbProductId;
            });
          }

          // 2. Intentar por índice de puerto en el array
          if (!portToUse && cfg && typeof cfg.portIndex === 'number' && ports[cfg.portIndex] && !usedPorts.has(ports[cfg.portIndex])) {
            portToUse = ports[cfg.portIndex];
          }

          // 3. Fallback: cualquier puerto disponible no asignado
          if (!portToUse) {
            portToUse = ports.find(p => !usedPorts.has(p));
          }

          if (portToUse) {
            usedPorts.add(portToUse);
            const ok = await this.tryOpenAndListen(portToUse, scannerId);
            if (ok) connectedCount++;
          } else {
            this.updateSerialUI(scannerId, false, true);
          }
        }
      } else {
        // Si no había asignaciones previas, vincular en orden los puertos que el usuario ya autorizó
        for (let idx = 0; idx < ports.length; idx++) {
          const scannerId = idx + 1;
          if (scannerId <= 6 && !this.serialConnections[scannerId]) {
            const ok = await this.tryOpenAndListen(ports[idx], scannerId);
            if (ok) {
              connectedCount++;
              if (!this.config.serialAssignments) this.config.serialAssignments = {};
              const inf = (ports[idx].getInfo && typeof ports[idx].getInfo === 'function') ? ports[idx].getInfo() : {};
              this.config.serialAssignments[scannerId] = {
                portIndex: idx,
                usbVendorId: inf.usbVendorId || 0,
                usbProductId: inf.usbProductId || 0,
                pairedAt: Date.now()
              };
            }
          }
        }
        if (connectedCount > 0) {
          try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.config));
          } catch (_) {}
        }
      }

      this.resetUnconnectedUI();

      if (connectedCount > 0) {
        showToast(`⚡ ${connectedCount} escáner(es) USB-COM reconectado(s) automáticamente.`, 'success');
      }
    } catch (err) {
      console.warn('Error en autoConnectSerialPorts:', err);
      this.resetUnconnectedUI();
    }
  },

  resetUnconnectedUI() {
    const assignments = this.config.serialAssignments || {};
    for (let id = 1; id <= 6; id++) {
      if (!this.serialConnections[id]) {
        this.updateSerialUI(id, false, !!assignments[id]);
      }
    }
  },

  async tryOpenAndListen(port, scannerId, maxAttempts = 2) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.listenToSerialPort(port, scannerId);
        return true;
      } catch (err) {
        console.warn(`Intento ${attempt} al abrir puerto para Escáner ${scannerId}:`, err);
        if (attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, 600));
        }
      }
    }
    const isSaved = !!(this.config.serialAssignments && this.config.serialAssignments[scannerId]);
    this.updateSerialUI(scannerId, false, isSaved);
    return false;
  },

  async listenToSerialPort(port, scannerId) {
    if (!port.readable) {
      await port.open({ baudRate: 9600 });
    }
    const zone = this.getScannerZone(scannerId);
    this.serialConnections[scannerId] = port;
    this.updateSerialUI(scannerId, true, true);

    showToast(`Escáner ${scannerId} (${zone.name}) vinculado por Web Serial.`, 'success');

    const reader = port.readable.getReader();
    this.serialReaders[scannerId] = reader;
    const decoder = new TextDecoder();
    let buffer = '';
    let serialTrailingTimer = null;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/[\r\n\t\x03]+/);
          buffer = lines.pop() || '';
          for (const line of lines) {
            const code = line.trim();
            if (code) {
              dispatchBarcodeBurst(code, {
                zoneId: zone.id,
                scannerId,
                hadExplicitZone: true,
                origenDispositivo: `Escáner ${scannerId} COM (${zone.name})`
              });
            }
          }

          // Buffer flush por inactividad (100ms): si el escáner envía sin Enter ni salto de línea
          if (serialTrailingTimer) clearTimeout(serialTrailingTimer);
          if (buffer.trim().length >= 4) {
            serialTrailingTimer = setTimeout(() => {
              if (buffer.trim()) {
                const code = buffer.trim();
                buffer = '';
                dispatchBarcodeBurst(code, {
                  zoneId: zone.id,
                  scannerId,
                  hadExplicitZone: true,
                  origenDispositivo: `Escáner ${scannerId} COM (${zone.name})`
                });
              }
            }, 100);
          }
        }
      }
    } catch (err) {
      if (err && err.name !== 'AbortError') {
        console.warn(`Puerto serial Escáner ${scannerId} cerrado o desconectado:`, err);
      }
    } finally {
      if (serialTrailingTimer) clearTimeout(serialTrailingTimer);
      try {
        reader.releaseLock();
      } catch (_) {}
      delete this.serialReaders[scannerId];
      delete this.serialConnections[scannerId];
      const isSaved = !!(this.config.serialAssignments && this.config.serialAssignments[scannerId]);
      this.updateSerialUI(scannerId, false, isSaved);
    }
  },

  updateSerialUI(scannerId, isConnected, isSaved = false) {
    const btn = document.getElementById(`btnPairSerial_${scannerId}`);
    const pill = document.getElementById(`scannerPill${scannerId}`);
    if (btn) {
      if (isConnected) {
        btn.classList.add('paired');
        btn.classList.remove('pairing');
        btn.innerHTML = `<i class="fa-solid fa-link-slash"></i> Desconectar COM ${scannerId}`;
        btn.title = `Escáner ${scannerId} conectado. Clic para desconectar.`;
      } else if (isSaved) {
        btn.classList.remove('paired');
        btn.innerHTML = `<i class="fa-solid fa-plug"></i> COM ${scannerId} (Guardado)`;
        btn.title = `Escáner ${scannerId} asignado previamente. Clic para conectar o reasignar.`;
      } else {
        btn.classList.remove('paired');
        btn.classList.remove('pairing');
        btn.innerHTML = `<i class="fa-solid fa-plug"></i> COM ${scannerId}`;
        btn.title = `Vincular puerto USB-COM para Escáner ${scannerId}`;
      }
    }
    if (pill) {
      if (isConnected) {
        pill.classList.add('serial-connected');
        pill.title = `Escáner ${scannerId} conectado (Web Serial). Clic para desconectar.`;
      } else if (isSaved) {
        pill.classList.remove('serial-connected');
        const pfx = this.config.prefixes[scannerId] || `S${scannerId}`;
        pill.title = `Escáner ${scannerId} asignado a puerto COM (Clic para reconectar)`;
      } else {
        pill.classList.remove('serial-connected');
        const pfx = this.config.prefixes[scannerId] || `S${scannerId}`;
        pill.title = `Escáner ${scannerId} (Prefijo ${pfx} o Clic para conectar COM)`;
      }
    }
  },

  async disconnectSerialScanner(scannerId) {
    const port = this.serialConnections[scannerId];
    const reader = this.serialReaders[scannerId];

    if (!port && !reader) {
      if (this.config.serialAssignments && this.config.serialAssignments[scannerId]) {
        delete this.config.serialAssignments[scannerId];
        this.saveConfig();
      }
      this.updateSerialUI(scannerId, false, false);
      return;
    }

    try {
      if (reader) {
        await reader.cancel();
      }
    } catch (e) {
      console.warn('Error cancelando reader serial:', e);
    }

    try {
      if (port) {
        await port.close();
      }
    } catch (e) {
      console.warn('Error cerrando puerto serial:', e);
    }

    delete this.serialConnections[scannerId];
    delete this.serialReaders[scannerId];
    if (this.config.serialAssignments && this.config.serialAssignments[scannerId]) {
      delete this.config.serialAssignments[scannerId];
      this.saveConfig();
    }
    this.updateSerialUI(scannerId, false, false);
    showToast(`Escáner ${scannerId} desconectado.`, 'info');
  },

  async disconnectAllScanners() {
    const connectedIds = Object.keys(this.serialConnections);
    const assignedIds = Object.keys(this.config.serialAssignments || {});
    const allIds = Array.from(new Set([...connectedIds, ...assignedIds]));
    if (allIds.length === 0) {
      showToast('No hay escáneres COM conectados actualmente.', 'info');
      return;
    }
    for (const id of allIds) {
      await this.disconnectSerialScanner(Number(id));
    }
    this.config.serialAssignments = {};
    this.saveConfig();
    showToast('Todos los escáneres seriales han sido desconectados.', 'success');
  },

  async toggleSerialPairing(scannerId) {
    if (this.serialConnections[scannerId]) {
      if (confirm(`¿Desea desconectar el Escáner ${scannerId} del puerto COM?`)) {
        await this.disconnectSerialScanner(scannerId);
      }
      return;
    }
    await this.pairSerialScanner(scannerId);
  },

  async handlePillClick(scannerId) {
    if (this.serialConnections[scannerId]) {
      if (confirm(`El Escáner ${scannerId} está conectado por puerto COM.\n¿Desea desconectarlo?`)) {
        await this.disconnectSerialScanner(scannerId);
      }
    } else {
      if (confirm(`¿Desea conectar el Escáner ${scannerId} a un puerto USB-COM?`)) {
        await this.pairSerialScanner(scannerId);
      }
    }
  },

  async pairSerialScanner(scannerId) {
    if (!('serial' in navigator)) {
      showToast('Web Serial requiere Chrome/Edge en HTTPS o localhost. En red local usá prefijos S1..S6 en las pistolas USB.', 'warning');
      return;
    }
    try {
      const port = await navigator.serial.requestPort();
      await this.listenToSerialPort(port, scannerId);

      // Persistir asignación exacta en localStorage
      const allPorts = await navigator.serial.getPorts();
      const portIndex = allPorts.indexOf(port);
      const info = (port.getInfo && typeof port.getInfo === 'function') ? port.getInfo() : {};

      if (!this.config.serialAssignments) this.config.serialAssignments = {};
      this.config.serialAssignments[scannerId] = {
        portIndex: portIndex >= 0 ? portIndex : 0,
        usbVendorId: info.usbVendorId || 0,
        usbProductId: info.usbProductId || 0,
        pairedAt: Date.now()
      };
      this.saveConfig();
    } catch (err) {
      if (err && err.name !== 'NotFoundError') {
        showToast(`No se pudo abrir puerto COM ${scannerId}: ${err.message}`, 'error');
      }
    }
  },

  runSimultaneousTest() {
    const activeEmp = (AppState.employees || []).find(e => e.activo !== false) || (AppState.employees || [])[0];
    if (!activeEmp) {
      showToast('Registre al menos un empacador activo para probar lecturas simultáneas.', 'warning');
      return;
    }
    const empCode4 = String(activeEmp.codigo_empleado || '').replace(/\D/g, '').padStart(4, '0').substring(0, 4);
    const sameBarcode = `000${empCode4}`;
    const p1 = this.config.prefixes[1] || 'S1';
    const p3 = this.config.prefixes[3] || 'S3';
    const burst = `${p1}${sameBarcode}${p3}${sameBarcode}`;

    dispatchBarcodeBurst(burst, {});
    showToast(`⚡ Prueba simultánea: mismo código ${sameBarcode} registrado en Zona 1 (E1) y Zona 2 (E3) al mismo tiempo.`, 'success');
  },

  bindUIEvents() {
    this.ZONES.forEach(z => {
      const card = document.getElementById(`zoneCard_${z.id}`);
      if (card) {
        card.addEventListener('click', (e) => {
          if (e.target.closest('input, button')) return;
          this.setActiveZone(z.id);
        });
      }

      const quickInput = document.getElementById(`zoneInput_${z.id}`);
      if (quickInput) {
        quickInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            const code = quickInput.value.trim();
            if (code) {
              dispatchBarcodeBurst(code, {
                zoneId: z.id,
                scannerId: z.scanners[0],
                hadExplicitZone: true
              });
              quickInput.value = '';
            }
          }
        });
      }
    });

    const btnSaveZones = document.getElementById('btnSaveZonesConfig');
    if (btnSaveZones) {
      btnSaveZones.addEventListener('click', () => {
        const prefixes = {};
        for (let id = 1; id <= 6; id++) {
          prefixes[id] = document.getElementById(`cfgScanner${id}Prefix`)?.value || `S${id}`;
        }
        const duplicateScope = document.getElementById('cfgDuplicateScope')?.value || 'zone';
        const autoRouteSimultaneous = document.getElementById('cfgAutoRouteNoPrefix')?.checked !== false;
        this.saveConfig({ prefixes, duplicateScope, autoRouteSimultaneous });
        showToast('Configuración de 3 Zonas y 6 Escáneres guardada correctamente.', 'success');
      });
    }

    for (let id = 1; id <= 6; id++) {
      const btnSerial = document.getElementById(`btnPairSerial_${id}`);
      if (btnSerial) {
        btnSerial.addEventListener('click', () => this.toggleSerialPairing(id));
      }
      const pill = document.getElementById(`scannerPill${id}`);
      if (pill) {
        pill.style.cursor = 'pointer';
        pill.addEventListener('click', () => this.handlePillClick(id));
      }
    }

    const btnSim = document.getElementById('btnTestSimultaneousScans');
    if (btnSim) {
      btnSim.addEventListener('click', () => this.runSimultaneousTest());
    }
  }
};

function dispatchBarcodeBurst(rawInput, baseOptions = {}) {
  const tokens = MultiZoneScannerManager.parseBurst(rawInput);
  if (tokens.length === 0) return;
  tokens.forEach(tok => {
    handleBarcodeScanned(tok.cleanCode, {
      ...baseOptions,
      _fromBurst: true,
      _parsedToken: tok,
      zoneId: baseOptions.zoneId || tok.zoneId || undefined,
      scannerId: baseOptions.scannerId || tok.scannerId || undefined
    });
  });
}

// ==============================================================================
// 3A. DRIVER DE CAPTURA PARA PISTOLA LECTORA DE CÓDIGOS DE BARRA USB
// ==============================================================================
class BarcodeScannerDriver {
  constructor(onScanCallback) {
    this.onScan = onScanCallback;
    this.buffer = '';
    this.lastKeyTime = Date.now();
    this.trailingTimer = null;
    this.initGlobalListener();
  }

  initGlobalListener() {
    // Interceptor global de pulsaciones de teclado (emulación de pistolas HID)
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const activeEl = document.activeElement;
      const isTypingInInput = activeEl &&
        (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT') &&
        activeEl.id !== 'barcodeInput';

      // Si el usuario está editando un formulario o un input de zona dedicado, no interceptar
      if (isTypingInInput) return;

      const currentTime = Date.now();
      const timeDiff = currentTime - this.lastKeyTime;

      // Tolerancia amplia entre caracteres (1000ms): evita que una pequeña pausa o salto de USB corte el código
      if (timeDiff > 1000 && this.buffer.length > 0 && e.key !== 'Enter' && e.key !== 'Tab') {
        this.buffer = ''; // Resetear buffer si hubo pausa manual prolongada
      }

      this.lastKeyTime = currentTime;

      const isTerminalKey = (e.key === 'Enter' || e.key === 'Tab');

      if (isTerminalKey) {
        if (this.trailingTimer) {
          clearTimeout(this.trailingTimer);
          this.trailingTimer = null;
        }
        // Fin de lectura por la pistola o entrada en el campo de escaneo
        const inputEl = document.getElementById('barcodeInput');
        const inputVal = inputEl ? inputEl.value.trim() : '';
        const scannedCode = inputVal || this.buffer.trim();
        if (scannedCode) {
          e.preventDefault();
          this.processBarcode(scannedCode);
        }
        this.buffer = '';
        if (inputEl) {
          inputEl.value = '';
        }
      } else if (e.key.length === 1) {
        // Carácter alfanumérico o separador de prefijo de zona
        this.buffer += e.key;

        // Auto-detección para escáneres configurados en modo "Sin sufijo" (no envían Enter ni Tab):
        // Si llegaron caracteres y se detiene por 120ms, procesar el código acumulado
        if (this.trailingTimer) clearTimeout(this.trailingTimer);
        this.trailingTimer = setTimeout(() => {
          if (this.buffer.trim().length >= 4) {
            const code = this.buffer.trim();
            this.buffer = '';
            const inputEl = document.getElementById('barcodeInput');
            if (inputEl && inputEl.value) inputEl.value = '';
            this.processBarcode(code);
          }
        }, 120);
      }
    });

    // Auto-focus continuo en el campo de escaneo al hacer clic en cualquier lugar seguro (solo en PC)
    document.addEventListener('click', (e) => {
      if (AppState.activeTab === 'tab-scanner') {
        if (MobileCameraScanner.isMobile()) return; // En móvil no auto-enfocar para no forzar la cámara ni el teclado
        const isModalOpen = document.querySelector('.modal-backdrop.open') ||
                            (document.getElementById('duplicateAlertModal')?.style.display === 'flex') ||
                            (document.getElementById('mobileCameraModal')?.style.display === 'flex');
        const isButton = e.target.closest('button, input, select, a, .zone-card');
        if (!isModalOpen && !isButton) {
          const barcodeInput = document.getElementById('barcodeInput');
          if (barcodeInput) barcodeInput.focus();
        }
      }
    });
  }

  processBarcode(rawCode) {
    const cleanCode = String(rawCode || '').trim().toUpperCase();
    if (!cleanCode) return;
    if (cleanCode.length > 7 || cleanCode.includes(' ') || cleanCode.includes('-') || cleanCode.includes(':')) {
      dispatchBarcodeBurst(cleanCode);
    } else {
      this.onScan(cleanCode);
    }
  }
}

// ==============================================================================
// 3B. ESCÁNER DE CÓDIGOS DE BARRA CON CÁMARA (CELULARES Y DISPOSITIVOS MÓVILES)
// ==============================================================================
const MobileCameraScanner = {
  html5QrCode: null,
  isScanning: false,
  lastScanTime: 0,
  lastScanCode: '',
  availableCameras: [],
  currentCameraIndex: 0,
  torchActive: false,

  isMobile() {
    const ua = navigator.userAgent || '';
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    const isTouchScreen = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const isNarrowScreen = window.innerWidth <= 820;
    return isMobileUA || (isTouchScreen && isNarrowScreen);
  },

  async open() {
    const modal = document.getElementById('mobileCameraModal');
    if (!modal) return;
    modal.style.display = 'flex';

    if (this.isScanning) return;

    if (!window.Html5Qrcode) {
      showToast('Cargando módulo de cámara, reintente en un instante...', 'warning');
      return;
    }

    try {
      if (!this.html5QrCode) {
        this.html5QrCode = new Html5Qrcode("cameraVideoViewport");
      }

      // Enumerar cámaras físicas disponibles
      try {
        const cameras = await Html5Qrcode.getCameras();
        if (cameras && cameras.length > 0) {
          this.availableCameras = cameras;
          // Priorizar cámara trasera ('back', 'rear', 'environment', 'trasera')
          const backIdx = cameras.findIndex(c => /back|rear|environment|trasera|posterior/i.test(c.label));
          this.currentCameraIndex = backIdx >= 0 ? backIdx : 0;
          const btnSwitch = document.getElementById('btnSwitchCamera');
          if (btnSwitch) btnSwitch.style.display = cameras.length > 1 ? 'flex' : 'none';
        }
      } catch (camErr) {
        console.warn('Enumeración de cámaras fallida o bloqueada:', camErr);
      }

      const cameraConfig = this.availableCameras.length > 0
        ? this.availableCameras[this.currentCameraIndex].id
        : { facingMode: "environment" };

      const scanConfig = {
        fps: 15,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
          const w = Math.min(viewfinderWidth * 0.85, 340);
          const h = Math.min(viewfinderHeight * 0.45, 150);
          return { width: Math.floor(w), height: Math.floor(h) };
        },
        aspectRatio: 1.333333,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.QR_CODE
        ]
      };

      await this.html5QrCode.start(
        cameraConfig,
        scanConfig,
        (decodedText, decodedResult) => {
          this.onCodeDetected(decodedText);
        },
        () => {} // Ignorar frames sin código
      );

      this.isScanning = true;

      // Habilitar botón de linterna si el hardware lo soporta
      try {
        const track = this.html5QrCode.getRunningTrack();
        const capabilities = track?.getCapabilities ? track.getCapabilities() : {};
        const btnTorch = document.getElementById('btnToggleTorch');
        if (btnTorch) {
          btnTorch.style.display = capabilities.torch ? 'flex' : 'none';
        }
      } catch (_) {}

    } catch (err) {
      console.error('Error al iniciar cámara:', err);
      showToast('No se pudo acceder a la cámara. Conceda permisos de cámara en el navegador.', 'danger');
      this.close();
    }
  },

  onCodeDetected(decodedText) {
    const now = Date.now();
    const clean = String(decodedText || '').trim();
    if (!clean) return;

    // Evitar ráfagas repetidas en menos de 1.8 segundos del mismo código
    if (now - this.lastScanTime < 1800 && this.lastScanCode === clean) {
      return;
    }
    this.lastScanTime = now;
    this.lastScanCode = clean;

    // Vibración háptica en celulares
    if ('vibrate' in navigator) {
      try { navigator.vibrate([90]); } catch (_) {}
    }

    // Feedback visual en la cámara
    const feedbackEl = document.getElementById('cameraScanFeedback');
    const feedbackText = document.getElementById('cameraFeedbackText');
    if (feedbackEl && feedbackText) {
      feedbackText.innerText = `Leído: ${clean}`;
      feedbackEl.style.display = 'flex';
      setTimeout(() => { if (feedbackEl) feedbackEl.style.display = 'none'; }, 1500);
    }

    // Procesar código leído por cámara
    handleBarcodeScanned(clean, { origenDispositivo: 'Cámara Celular' });

    // Si NO está activado el modo de escaneo continuo, cerrar la cámara
    const chkCont = document.getElementById('chkContinuousScan');
    if (chkCont && !chkCont.checked) {
      this.close();
    }
  },

  async close() {
    const modal = document.getElementById('mobileCameraModal');
    if (modal) modal.style.display = 'none';

    if (this.html5QrCode && this.isScanning) {
      try {
        await this.html5QrCode.stop();
      } catch (e) {
        console.warn('Error deteniendo cámara:', e);
      }
    }
    this.isScanning = false;
    this.torchActive = false;
    const btnTorch = document.getElementById('btnToggleTorch');
    if (btnTorch) btnTorch.style.color = '#cbd5e1';
  },

  async toggleTorch() {
    if (!this.html5QrCode || !this.isScanning) return;
    try {
      this.torchActive = !this.torchActive;
      await this.html5QrCode.applyVideoConstraints({
        advanced: [{ torch: this.torchActive }]
      });
      const btnTorch = document.getElementById('btnToggleTorch');
      if (btnTorch) {
        btnTorch.style.color = this.torchActive ? '#fef08a' : '#cbd5e1';
      }
    } catch (e) {
      console.warn('No se pudo conmutar la linterna:', e);
    }
  },

  async switchCamera() {
    if (this.availableCameras.length <= 1 || !this.isScanning) return;
    this.currentCameraIndex = (this.currentCameraIndex + 1) % this.availableCameras.length;
    await this.close();
    await this.open();
  }
};

// ==============================================================================
// 4. MOTOR DE BASE DE DATOS SUPABASE & COLA OFFLINE (INDEXEDDB)
// ==============================================================================
class DatabaseEngine {
  constructor() {
    this.initSupabaseClient();
    this.initIndexedDb();
    this.startSyncWorker();
  }

  initSupabaseClient() {
    try {
      if (window.supabase && APP_CONFIG.SUPABASE_URL && APP_CONFIG.SUPABASE_KEY) {
        AppState.supabaseClient = window.supabase.createClient(
          APP_CONFIG.SUPABASE_URL,
          APP_CONFIG.SUPABASE_KEY,
          {
            auth: { persistSession: false },
            realtime: { params: { eventsPerSecond: 10 } }
          }
        );
        this.testConnection();
      } else {
        console.warn('Supabase JS SDK no disponible o credenciales no configuradas.');
      }
    } catch (err) {
      console.error('Error inicializando Supabase Client:', err);
      this.updateConnectionStatus(false, 'Error de Configuración');
    }
  }

  async testConnection() {
    if (!AppState.supabaseClient) {
      this.updateConnectionStatus(false, 'Sin Cliente Supabase');
      return false;
    }
    try {
      // Probar consulta rápida a la tabla de empleados
      const { data, error } = await AppState.supabaseClient
        .from('empleados')
        .select('id, codigo_empleado, nombre_completo, tarifa_personalizada, activo')
        .limit(10);

      if (error) {
        // Puede que la tabla aún no esté creada en Supabase
        if (error.code === 'PGRST205' || error.message.includes('not find the table')) {
          this.updateConnectionStatus(false, 'Tablas Pendientes en SQL Editor');
          showToast('Ejecuta el script SQL en Supabase para crear las tablas.', 'warning');
        } else if (error.code === '42501' || (error.message && error.message.includes('permission denied'))) {
          this.updateConnectionStatus(false, 'Permisos SQL Pendientes');
          showToast('⚠️ Permisos de Supabase pendientes: ejecuta solucion_permisos.sql en el SQL Editor.', 'error');
        } else {
          this.updateConnectionStatus(false, 'Error: ' + error.message);
        }
        AppState.supabaseConnected = false;
        return false;
      }

      AppState.supabaseConnected = true;
      this.updateConnectionStatus(true, 'Base de Datos En Línea');
      await this.loadLocalEmployees();
      await this.loadTodayScans();
      await PackingOptions.loadFromSupabase();
      this.setupRealtimeSubscriptions();
      this.startSyncWorker();
      return true;
    } catch (e) {
      this.updateConnectionStatus(false, 'Sin Conexión');
      AppState.supabaseConnected = false;
      return false;
    }
  }

  updateConnectionStatus(isOnline, message) {
    const badge = document.getElementById('connectionBadge');
    const dot = document.getElementById('connectionDot');
    const text = document.getElementById('connectionText');

    if (!badge || !dot || !text) return;

    if (isOnline) {
      dot.className = 'status-dot';
      text.innerText = message || 'Base de Datos En Línea';
      badge.title = 'Conectado en tiempo real con Supabase.';
    } else {
      dot.className = 'status-dot offline';
      text.innerText = message || 'Base de Datos Desconectada';
      badge.title = 'Guardando escaneos localmente. Se sincronizarán al reconectar.';
    }
  }

  // Inicializar almacenamiento offline robusto con IndexedDB
  initIndexedDb() {
    const request = indexedDB.open('VetePickingDB', 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('scans_queue')) {
        const store = db.createObjectStore('scans_queue', { keyPath: 'local_id', autoIncrement: true });
        store.createIndex('synced', 'synced', { unique: false });
      }
      if (!db.objectStoreNames.contains('local_employees')) {
        db.createObjectStore('local_employees', { keyPath: 'codigo_empleado' });
      }
    };
    request.onsuccess = (event) => {
      this.db = event.target.result;
      // Limpiar cola residual antigua para evitar bucles de sincronización
      try {
        const clearTx = this.db.transaction(['scans_queue'], 'readwrite');
        clearTx.objectStore('scans_queue').clear();
      } catch (e) {}
      this.loadLocalEmployees();
    };
  }

  async loadLocalEmployees() {
    // Intentar primero desde Supabase
    if (AppState.supabaseConnected && AppState.supabaseClient) {
      try {
        const { data, error } = await AppState.supabaseClient
          .from('empleados')
          .select('*')
          .order('nombre_completo', { ascending: true });

        if (!error && data && data.length > 0) {
          AppState.employees = data;
          this.saveEmployeesToLocalStorage(data);
          renderEmployeesTable();
          populateEmployeeSelects();
          renderEmployeeAccumulatedList();
          if (typeof DescarteManager !== 'undefined') DescarteManager.populateEmployees();
          if (typeof DashboardManager !== 'undefined') DashboardManager.populateEmployeeFilter();
          return;
        }
      } catch (e) {
        console.warn('Error cargando empleados desde Supabase, usando respaldo local:', e);
      }
    }

    // Respaldo desde LocalStorage / Fallback
    const cached = localStorage.getItem('vete_cached_employees');
    if (cached) {
      try {
        AppState.employees = JSON.parse(cached);
      } catch (e) {
        AppState.employees = INITIAL_FALLBACK_EMPLOYEES;
      }
    } else {
      AppState.employees = INITIAL_FALLBACK_EMPLOYEES;
      this.saveEmployeesToLocalStorage(INITIAL_FALLBACK_EMPLOYEES);
    }
    renderEmployeesTable();
    populateEmployeeSelects();
    renderEmployeeAccumulatedList();
    if (typeof DescarteManager !== 'undefined') DescarteManager.populateEmployees();
    if (typeof DashboardManager !== 'undefined') DashboardManager.populateEmployeeFilter();
  }

  saveEmployeesToLocalStorage(emps) {
    localStorage.setItem('vete_cached_employees', JSON.stringify(emps));
  }

  async saveEmployee(employeeData) {
    // Si tiene ID, es actualización, si no, es inserción
    if (AppState.supabaseConnected && AppState.supabaseClient) {
      try {
        if (employeeData.id) {
          const { error } = await AppState.supabaseClient
            .from('empleados')
            .update({
              codigo_empleado: employeeData.codigo_empleado,
              nombre_completo: employeeData.nombre_completo,
              dni_rut: employeeData.dni_rut,
              telefono: employeeData.telefono,
              tarifa_personalizada: employeeData.tarifa_personalizada,
              activo: employeeData.activo,
              updated_at: new Date().toISOString()
            })
            .eq('id', employeeData.id);
          if (error) throw error;
        } else {
          const { data, error } = await AppState.supabaseClient
            .from('empleados')
            .insert([{
              codigo_empleado: employeeData.codigo_empleado,
              nombre_completo: employeeData.nombre_completo,
              dni_rut: employeeData.dni_rut,
              telefono: employeeData.telefono,
              tarifa_personalizada: employeeData.tarifa_personalizada,
              activo: employeeData.activo
            }])
            .select();
          if (error) throw error;
          if (data && data[0]) employeeData.id = data[0].id;
        }
      } catch (err) {
        console.error('Error guardando empleado en Supabase:', err);
        showToast('Guardado localmente (Supabase error: ' + err.message + ')', 'warning');
      }
    }

    // Guardar localmente
    const existingIndex = AppState.employees.findIndex(e => e.id === employeeData.id || e.codigo_empleado === employeeData.codigo_empleado);
    if (existingIndex >= 0) {
      AppState.employees[existingIndex] = employeeData;
    } else {
      if (!employeeData.id) employeeData.id = 'local_' + Date.now();
      AppState.employees.push(employeeData);
    }

    this.saveEmployeesToLocalStorage(AppState.employees);
    renderEmployeesTable();
    populateEmployeeSelects();
    return true;
  }

  // --- GESTIÓN DE USUARIOS DEL SISTEMA (RBAC) ---
  async loadUsers() {
    if (AppState.supabaseConnected && AppState.supabaseClient) {
      try {
        const { data, error } = await AppState.supabaseClient
          .from('usuarios_sistema')
          .select('id, username, nombre_completo, rol, activo, created_at')
          .order('created_at', { ascending: true });

        if (!error && data && data.length > 0) {
          AppState.users = data;
          this.saveUsersToLocalStorage(data);
          renderUsersTable();
          return;
        }
      } catch (e) {
        console.warn('Error cargando usuarios desde Supabase, usando respaldo local:', e);
      }
    }

    const cached = localStorage.getItem('vete_cached_users');
    if (cached) {
      try {
        AppState.users = JSON.parse(cached);
      } catch (e) {
        AppState.users = DEFAULT_SYSTEM_USERS;
      }
    } else {
      AppState.users = DEFAULT_SYSTEM_USERS;
      this.saveUsersToLocalStorage(DEFAULT_SYSTEM_USERS);
    }
    renderUsersTable();
  }

  saveUsersToLocalStorage(usersList) {
    localStorage.setItem('vete_cached_users', JSON.stringify(usersList));
  }

  async saveUser(userData) {
    if (AppState.supabaseConnected && AppState.supabaseClient) {
      try {
        if (userData.id && !String(userData.id).startsWith('local_') && !String(userData.id).startsWith('user-')) {
          const updateObj = {
            username: userData.username,
            nombre_completo: userData.nombre_completo,
            rol: userData.rol,
            activo: userData.activo,
            updated_at: new Date().toISOString()
          };
          if (userData.password_hash) {
            updateObj.password_hash = userData.password_hash;
          }
          const { error } = await AppState.supabaseClient
            .from('usuarios_sistema')
            .update(updateObj)
            .eq('id', userData.id);
          if (error) throw error;
        } else {
          const { data, error } = await AppState.supabaseClient
            .from('usuarios_sistema')
            .insert([{
              username: userData.username,
              nombre_completo: userData.nombre_completo,
              password_hash: userData.password_hash,
              rol: userData.rol,
              activo: userData.activo
            }])
            .select();
          if (error) throw error;
          if (data && data[0]) userData.id = data[0].id;
        }
      } catch (e) {
        console.warn('Error guardando usuario en Supabase, guardando localmente:', e);
      }
    }

    const idx = AppState.users.findIndex(u => (userData.id && u.id === userData.id) || u.username.toLowerCase() === userData.username.toLowerCase());
    if (idx >= 0) {
      AppState.users[idx] = { ...AppState.users[idx], ...userData };
    } else {
      AppState.users.push({
        id: userData.id || `local_user_${Date.now()}`,
        ...userData,
        created_at: new Date().toISOString()
      });
    }

    this.saveUsersToLocalStorage(AppState.users);
    renderUsersTable();
    return true;
  }

  async deleteUser(userId) {
    if (AppState.supabaseConnected && AppState.supabaseClient) {
      try {
        await AppState.supabaseClient.from('usuarios_sistema').delete().eq('id', userId);
      } catch (e) {
        console.warn('Error eliminando usuario en Supabase:', e);
      }
    }
    AppState.users = AppState.users.filter(u => u.id !== userId);
    this.saveUsersToLocalStorage(AppState.users);
    renderUsersTable();
  }

  // Guardar un nuevo escaneo de caja
  async recordScan(scanRecord) {
    // 1. Guardar en memoria para UI instantánea
    AppState.todayScans.unshift(scanRecord);
    AppState.recentScans.unshift(scanRecord);
    if (AppState.recentScans.length > 30) AppState.recentScans.pop();

    // 2. Si hay conexión a Supabase, enviar directamente
    if (AppState.supabaseConnected && AppState.supabaseClient) {
      const ok = await this.pushScanToSupabase(scanRecord);
      if (!ok) {
        // Solo si falla la red, encolar en IndexedDB
        this.enqueueScanForSync(scanRecord);
      }
    } else {
      // Sin conexión: encolar para sincronizar al volver la red
      this.enqueueScanForSync(scanRecord);
    }
  }

  enqueueScanForSync(scanRecord) {
    if (!this.db) return;
    try {
      const tx = this.db.transaction(['scans_queue'], 'readwrite');
      const store = tx.objectStore('scans_queue');
      store.add({ ...scanRecord, synced: false });
    } catch (e) {
      console.warn('Error encolando en IndexedDB:', e);
    }
  }

  async pushScanToSupabase(scanRecord) {
    if (!AppState.supabaseConnected || !AppState.supabaseClient) {
      this.updateSyncBadge(false);
      return false;
    }

    try {
      // 1. Proactivamente normalizar el código de calidad a máximo 2 caracteres
      // para garantizar 100% de éxito con columnas VARCHAR(2) en PostgreSQL/Supabase
      let rawCal = String(scanRecord.codigo_calidad || '00').trim().toUpperCase();
      let safeCalidad = '00';
      if (rawCal === 'DESCARTE' || rawCal === 'DS') safeCalidad = 'DS';
      else if (rawCal === '000' || rawCal === '00' || rawCal === '01') safeCalidad = '00';
      else if (rawCal === '002' || rawCal === '02') safeCalidad = '02';
      else if (rawCal === '003' || rawCal === '03') safeCalidad = '03';
      else if (rawCal.length > 2) safeCalidad = rawCal.substring(0, 2);
      else safeCalidad = rawCal;

      // 2. Normalizar código de tipo de caja (máximo 16 caracteres)
      let safeTipoCaja = String(scanRecord.codigo_tipo_caja || '10KG').substring(0, 16);

      // 3. Buscar el empleado real en Supabase por codigo_empleado o id
      let validEmpId = null;
      const targetEmpCode = scanRecord.codigo_empleado_extraido || extractEmpCodeFromRecord(scanRecord);
      
      const allEmps = (AppState.employees && AppState.employees.length > 0) ? AppState.employees : INITIAL_FALLBACK_EMPLOYEES;
      const emp = allEmps.find(e => 
        (targetEmpCode && e.codigo_empleado === targetEmpCode) ||
        (scanRecord.empleado_id && e.id === scanRecord.empleado_id)
      );

      // Solo enviar empleado_id si es un UUID válido existente de Supabase (no provisional local_)
      if (emp && emp.id && !String(emp.id).startsWith('local_') && !String(emp.id).startsWith('waste_')) {
        validEmpId = emp.id;
      }

      const payload = {
        empleado_id: validEmpId,
        codigo_barra_leido: scanRecord.codigo_barra_leido,
        codigo_empleado_extraido: targetEmpCode,
        codigo_calidad: safeCalidad,
        nombre_calidad: scanRecord.nombre_calidad || (safeCalidad === 'DS' ? 'Descarte' : 'Primera'),
        codigo_tipo_caja: safeTipoCaja,
        nombre_tipo_caja: scanRecord.nombre_tipo_caja || (safeCalidad === 'DS' ? 'Descarte' : 'Caja 10 kgs.'),
        empleado_nombre_snapshot: scanRecord.empleado_nombre_snapshot || (emp ? emp.nombre_completo : 'Empacador ' + targetEmpCode),
        tarifa_aplicada: scanRecord.tarifa_aplicada !== undefined ? scanRecord.tarifa_aplicada : (safeCalidad === 'DS' ? 0.00 : APP_CONFIG.TARIFA_BASE),
        fecha_hora: scanRecord.fecha_hora,
        fecha_dia: scanRecord.fecha_dia,
        turno: scanRecord.turno || 'Mañana',
        linea_empaque: scanRecord.linea_empaque || (safeCalidad === 'DS' ? 'Línea Descarte' : 'Línea 1'),
        origen_dispositivo: scanRecord.origen_dispositivo || (safeCalidad === 'DS' ? 'Registro Manual Descarte' : 'Pistola USB')
      };

      let { data, error } = await AppState.supabaseClient
        .from('registros_cajas')
        .insert([payload])
        .select();

      // Si falla por Foreign Key (el empleado_id no existe en Supabase), reintentar sin empleado_id para no perder la caja
      if (error && (error.code === '23503' || (error.message && error.message.includes('foreign key')))) {
        console.warn('empleado_id no encontrado en Supabase (FK), reintentando con empleado_id null...');
        payload.empleado_id = null;
        const retryResult = await AppState.supabaseClient
          .from('registros_cajas')
          .insert([payload])
          .select();
        error = retryResult.error;
        data = retryResult.data;
      }

      // Respaldo secundario si la base de datos tuviera alguna otra restricción de longitud (22001)
      if (error && error.code === '22001') {
        payload.codigo_calidad = payload.codigo_calidad.substring(0, 2);
        payload.codigo_tipo_caja = payload.codigo_tipo_caja.substring(0, 8);
        const retryRes = await AppState.supabaseClient
          .from('registros_cajas')
          .insert([payload])
          .select();
        error = retryRes.error;
        data = retryRes.data;
      }

      if (error) {
        console.error('Error insertando escaneo en Supabase:', error);
        throw error;
      }

      if (data && data[0] && data[0].id) {
        scanRecord.id = data[0].id;
      }

      console.log('✅ Escaneo persistido en Supabase en tiempo real:', scanRecord.codigo_barra_leido);
      this.updateSyncBadge(true);
      return true;
    } catch (e) {
      console.warn('Error subiendo escaneo a Supabase (reintentará en segundo plano):', e);
      this.updateSyncBadge(false);
      return false;
    }
  }

  updateSyncBadge(allSynced) {
    const badge = document.getElementById('syncQueueCounter');
    if (!badge) return;
    if (allSynced) {
      badge.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Sincronizado';
      badge.style.color = 'var(--status-success)';
    } else {
      badge.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> Encolado Localmente';
      badge.style.color = 'var(--status-warning)';
    }
  }

  // Worker en segundo plano: sincronización bidireccional continua PC <-> Celulares cada 3 seg
  startSyncWorker() {
    if (this._syncWorkerInterval) clearInterval(this._syncWorkerInterval);
    this._syncWorkerInterval = setInterval(async () => {
      if (AppState.supabaseConnected && AppState.supabaseClient) {
        // 1. Vaciar cola offline si hay registros pendientes
        if (this.db && !this._isFlushing) {
          this.flushPendingQueue();
        }
        // 2. Traer escaneos frescos de hoy registrados en otros dispositivos (PC o móvil)
        await this.loadTodayScans();
        // 3. Sincronizar el envase activo de la jornada si fue cambiado en otro dispositivo
        await PackingOptions.loadFromSupabase();
      }
    }, 3000);
  }

  async flushPendingQueue() {
    if (!this.db || !AppState.supabaseConnected || !AppState.supabaseClient || this._isFlushing) return;
    this._isFlushing = true;

    try {
      const tx = this.db.transaction(['scans_queue'], 'readwrite');
      const store = tx.objectStore('scans_queue');
      const request = store.getAll();

      request.onsuccess = async () => {
        const pendingItems = (request.result || []).filter(item => !item.synced);
        if (pendingItems.length === 0) {
          this.updateSyncBadge(true);
          this._isFlushing = false;
          return;
        }

        const payloads = [];
        for (const item of pendingItems) {
          let validEmpId = null;
          const targetCode = item.codigo_empleado_extraido || extractEmpCodeFromRecord(item);
          const allEmps = (AppState.employees && AppState.employees.length > 0) ? AppState.employees : INITIAL_FALLBACK_EMPLOYEES;
          const emp = allEmps.find(e => (targetCode && e.codigo_empleado === targetCode) || (item.empleado_id && e.id === item.empleado_id));
          if (emp && emp.id && !String(emp.id).startsWith('local_') && !String(emp.id).startsWith('waste_')) {
            validEmpId = emp.id;
          }

          let rawCal = String(item.codigo_calidad || '00').trim().toUpperCase();
          let safeCalidad = '00';
          if (rawCal === 'DESCARTE' || rawCal === 'DS') safeCalidad = 'DS';
          else if (rawCal === '000' || rawCal === '00' || rawCal === '01') safeCalidad = '00';
          else if (rawCal === '002' || rawCal === '02') safeCalidad = '02';
          else if (rawCal === '003' || rawCal === '03') safeCalidad = '03';
          else if (rawCal.length > 2) safeCalidad = rawCal.substring(0, 2);
          else safeCalidad = rawCal;

          payloads.push({
            empleado_id: validEmpId,
            codigo_barra_leido: item.codigo_barra_leido,
            codigo_empleado_extraido: targetCode,
            codigo_calidad: safeCalidad,
            nombre_calidad: item.nombre_calidad || (safeCalidad === 'DS' ? 'Descarte' : 'Primera'),
            codigo_tipo_caja: String(item.codigo_tipo_caja || '10KG').substring(0, 16),
            nombre_tipo_caja: item.nombre_tipo_caja || (safeCalidad === 'DS' ? 'Descarte' : 'Caja 10 kgs.'),
            empleado_nombre_snapshot: item.empleado_nombre_snapshot || (emp ? emp.nombre_completo : 'Empacador ' + targetCode),
            tarifa_aplicada: item.tarifa_aplicada !== undefined ? item.tarifa_aplicada : (safeCalidad === 'DS' ? 0.00 : APP_CONFIG.TARIFA_BASE),
            fecha_hora: item.fecha_hora,
            fecha_dia: item.fecha_dia,
            turno: item.turno || 'Mañana',
            linea_empaque: item.linea_empaque || 'Línea 1',
            origen_dispositivo: item.origen_dispositivo || 'Pistola USB'
          });
        }

        if (payloads.length > 0) {
          try {
            let { error } = await AppState.supabaseClient
              .from('registros_cajas')
              .insert(payloads);

            if (error && error.code === '22001') {
              console.warn('Batch 22001 error, reintentando con fallback de 2 caracteres...');
              const safeLenPayloads = payloads.map(p => {
                let cq = p.codigo_calidad;
                if (cq === 'DESCARTE') cq = 'DS';
                else if (cq === '000') cq = '00';
                else if (cq === '002') cq = '02';
                else if (cq === '003') cq = '03';
                else cq = cq.substring(0, 2);
                return {
                  ...p,
                  codigo_calidad: cq,
                  codigo_tipo_caja: p.codigo_tipo_caja ? p.codigo_tipo_caja.substring(0, 16) : p.codigo_tipo_caja
                };
              });
              const retry = await AppState.supabaseClient
                .from('registros_cajas')
                .insert(safeLenPayloads);
              error = retry.error;
            }

            if (error && (error.code === '23503' || (error.message && error.message.includes('foreign key')))) {
              console.warn('Batch FK error, reintentando con empleado_id null...');
              const safePayloads = payloads.map(p => ({ ...p, empleado_id: null }));
              const retry = await AppState.supabaseClient
                .from('registros_cajas')
                .insert(safePayloads);
              error = retry.error;
            }

            if (!error) {
              const delTx = this.db.transaction(['scans_queue'], 'readwrite');
              delTx.objectStore('scans_queue').clear();
              this.updateSyncBadge(true);
            }
          } catch (insertErr) {
            console.warn('Error en batch sync:', insertErr);
          }
        }
        this._isFlushing = false;
      };

      request.onerror = () => {
        this._isFlushing = false;
      };
    } catch (e) {
      console.warn('Sync flush error:', e);
      this._isFlushing = false;
    }
  }

  // Supabase Realtime para que todos los dispositivos reflejen cambios instantáneamente
  setupRealtimeSubscriptions() {
    if (!AppState.supabaseClient) return;

    try {
      const channel = AppState.supabaseClient
        .channel('vete-live-all-devices')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'registros_cajas' },
          (payload) => {
            console.log('⚡ Realtime: cambio en registros_cajas detectado:', payload);
            this.loadTodayScans();
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'configuracion' },
          (payload) => {
            console.log('⚡ Realtime: cambio en configuracion detectado:', payload);
            if (payload.new && payload.new.id === 'envase_jornada') {
              PackingOptions.handleRemoteUpdate(payload.new.nombre_empresa);
            }
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'empleados' },
          () => {
            console.log('⚡ Realtime: cambio en empleados detectado');
            this.loadLocalEmployees();
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'usuarios_sistema' },
          () => {
            if (AppState.currentUser && AppState.currentUser.rol === 'Administrador') {
              this.loadUsers();
            }
          }
        )
        .subscribe((status) => {
          console.log('📡 Supabase Realtime Channel Status:', status);
        });
    } catch (e) {
      console.warn('Realtime subscription error:', e);
    }
  }

  // Cargar estadísticas de hoy y globales desde Supabase
  async loadTodayScans() {
    const today = new Date();
    const utcDateStr = today.toISOString().split('T')[0];
    const localDateStr = today.toLocaleDateString('en-CA');
    const targetDates = Array.from(new Set([utcDateStr, localDateStr]));

    if (AppState.supabaseConnected && AppState.supabaseClient) {
      try {
        // 1. Escaneos de la jornada de hoy (cubre fecha local y UTC)
        const { data: todayData, error: todayErr } = await AppState.supabaseClient
          .from('registros_cajas')
          .select('*')
          .in('fecha_dia', targetDates)
          .order('fecha_hora', { ascending: false });

        if (!todayErr && todayData) {
          AppState.todayScans = todayData;
        }

        // 2. Últimos escaneos globales recientes (para mostrar actividad real si hoy aún no se escaneó)
        const { data: recentData, error: recentErr } = await AppState.supabaseClient
          .from('registros_cajas')
          .select('*')
          .order('fecha_hora', { ascending: false })
          .limit(30);

        if (!recentErr && recentData) {
          AppState.recentScans = recentData;
        }

        // 3. Totales acumulados históricos en el sistema
        await this.loadHistoricalTotals();

        // 4. Actualizar interfaces
        updateAllDashboardStats();
        renderLiveScansList();
        renderEmployeeAccumulatedList();
        renderEmployeesTable();

        if (typeof DescarteManager !== 'undefined') {
          if (typeof DescarteManager.loadWasteRecords === 'function') {
            DescarteManager.loadWasteRecords();
          } else if (typeof DescarteManager.renderTable === 'function') {
            DescarteManager.renderTable();
          }
        }

        if (AppState.todayScans.length > 0) {
          refreshHeroCardIfVisible(true);
        }
      } catch (e) {
        console.warn('Error cargando escaneos desde Supabase:', e);
      }
    }
  }

  async loadHistoricalTotals() {
    if (!AppState.supabaseConnected || !AppState.supabaseClient) return;
    try {
      const { data, error } = await AppState.supabaseClient
        .from('registros_cajas')
        .select('id, empleado_id, codigo_empleado_extraido, codigo_barra_leido, empleado_nombre_snapshot, fecha_dia');

      if (!error && data) {
        AppState.totalHistoricalScans = data.length;
        const empTotals = {};
        data.forEach(r => {
          const empCode = r.codigo_empleado_extraido || extractEmpCodeFromRecord(r);
          const empName = (r.empleado_nombre_snapshot || '').toLowerCase().trim();
          if (r.empleado_id) {
            empTotals[r.empleado_id] = (empTotals[r.empleado_id] || 0) + 1;
          }
          if (empCode) {
            empTotals[empCode] = (empTotals[empCode] || 0) + 1;
          }
          if (empName) {
            empTotals[empName] = (empTotals[empName] || 0) + 1;
          }
        });
        AppState.employeeBoxTotals = empTotals;
      }
    } catch (err) {
      console.warn('Error calculando totales históricos:', err);
    }
  }
}

const DB = new DatabaseEngine();

// ==============================================================================
// GESTOR DE CARTEL MODAL DE ALERTA: CAJA DUPLICADA (PICKING DUPLICADO)
// ==============================================================================
function showDuplicateAlertModal(barcode10d, duplicateRecord, parsed) {
  const modal = document.getElementById('duplicateAlertModal');
  if (!modal) return;

  const elCorr = document.getElementById('dupAlertCorrelativo');
  const elBar = document.getElementById('dupAlertBarcode');
  const elEmp = document.getElementById('dupAlertEmpName');
  const elTime = document.getElementById('dupAlertTimestamp');
  const elProd = document.getElementById('dupAlertProduct');

  const p = parsed || parseAgroBarcode(barcode10d);
  const corr = p?.correlativo || (barcode10d && barcode10d.length === 10 ? barcode10d.substring(6, 10) : '----');

  if (elBar) elBar.innerText = barcode10d || '----------';
  if (elCorr) elCorr.innerText = `#${corr}`;

  let empName = duplicateRecord?.empleado_nombre_snapshot;
  if (!empName && duplicateRecord?.empleado_id) {
    const foundEmp = AppState.employees.find(e => e.id === duplicateRecord.empleado_id);
    if (foundEmp) empName = foundEmp.nombre_completo;
  }
  if (!empName && duplicateRecord?.codigo_empleado_extraido) {
    const foundEmp = AppState.employees.find(e => e.codigo_empleado === duplicateRecord.codigo_empleado_extraido);
    if (foundEmp) empName = foundEmp.nombre_completo;
  }
  if (!empName && p?.empCode) {
    const foundEmp = AppState.employees.find(e => e.codigo_empleado === p.empCode);
    if (foundEmp) empName = foundEmp.nombre_completo;
  }
  if (elEmp) elEmp.innerText = empName || 'Empacador registrado previamente hoy';

  if (elTime) {
    if (duplicateRecord?.fecha_hora) {
      const d = new Date(duplicateRecord.fecha_hora);
      elTime.innerText = `${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} (${d.toLocaleDateString('es-AR')})`;
    } else {
      elTime.innerText = 'Jornada de hoy';
    }
  }

  if (elProd) {
    const box = duplicateRecord?.nombre_tipo_caja || p?.tipoCajaNombre || (p?.qualityCode === '02' ? PackingOptions.getSegunda() : PackingOptions.getPrimera());
    elProd.innerText = box;
  }

  modal.style.display = 'flex';

  const btnAck = document.getElementById('btnDismissDuplicateAlert');
  if (btnAck) {
    setTimeout(() => btnAck.focus(), 60);
  }
}

function dismissDuplicateAlertModal() {
  const modal = document.getElementById('duplicateAlertModal');
  if (modal && modal.style.display !== 'none') {
    modal.style.display = 'none';
    const barcodeInput = document.getElementById('barcodeInput');
    if (barcodeInput) {
      barcodeInput.value = '';
      barcodeInput.focus();
    }
  }
}

// ==============================================================================
// 5. LÓGICA DE PROCESAMIENTO DE ESCANEO DE CÓDIGO DE BARRAS (6 DÍGITOS VETE)
//    Estructura: [4d Personal][2d Calidad: 01 Primera, 02 Segunda, 03 Araña]
//    Sin duplicados bloqueados en la jornada: respeta la Tolerancia Anti-Duplicado (Segundos)
// ==============================================================================
function handleBarcodeScanned(barcode, options = {}) {
  if (!options._fromBurst && typeof MultiZoneScannerManager !== 'undefined') {
    const burstTokens = MultiZoneScannerManager.parseBurst(barcode);
    if (burstTokens.length > 1 || (burstTokens.length === 1 && burstTokens[0].zoneId && !options.zoneId)) {
      burstTokens.forEach(tok => {
        handleBarcodeScanned(tok.cleanCode, {
          ...options,
          _fromBurst: true,
          _parsedToken: tok,
          zoneId: options.zoneId || tok.zoneId,
          scannerId: options.scannerId || tok.scannerId
        });
      });
      return;
    }
  }

  const now = Date.now();
  const currentDate = new Date();
  const rawToken = options._parsedToken || null;
  const cleanCode = String(rawToken ? rawToken.cleanCode : (barcode || '')).trim().replace(/[^0-9a-zA-Z]/g, '');
  if (!cleanCode) return;

  // Resolver Zona de Marcado (Zona 1/2/3), Escáner (1..6) y Clave Anti-Duplicado por Zona
  const resolved = (typeof MultiZoneScannerManager !== 'undefined')
    ? MultiZoneScannerManager.resolveZoneForScan(rawToken, cleanCode, now, options)
    : {
        zoneId: 'zona_1',
        zoneName: APP_CONFIG.LINEA_EMPAQUE,
        scannerId: 1,
        deviceLabel: options.origenDispositivo || 'Pistola USB Inalámbrica',
        hadExplicitZone: false,
        autoRouted: false,
        dedupScopeKey: `zona_1__${cleanCode}`
      };

  // Si el modal de alerta previa estaba en pantalla, descartarlo
  dismissDuplicateAlertModal();

  // 1. PARSEAR ESTRUCTURA OFICIAL VETE (7 DÍGITOS: [3d Calidad: 000, 002, 003][4d Personal])
  const parsed = parseVeteBarcode(cleanCode);

  // 2. FILTRO ANTI-DUPLICADO INDEPENDIENTE POR ZONA / ESCÁNER
  // Permite que el mismo código pase al mismo tiempo en Zonas diferentes, bloqueando solo rebotes en la misma Zona.
  const effectiveTol = APP_CONFIG.MODO_PRUEBA ? 0.35 : APP_CONFIG.TOLERANCIA_DUPLICADO_SEG;
  const dupInfo = (typeof MultiZoneScannerManager !== 'undefined')
    ? MultiZoneScannerManager.isDuplicate(resolved.dedupScopeKey, now, effectiveTol)
    : { blocked: false, elapsedSec: 999, remainingSec: 0 };

  if (!options.ignoreDuplicate && dupInfo.blocked) {
    if (APP_CONFIG.MODO_PRUEBA) {
      // En Modo Prueba: ignorar rebotes de hardware ultra-rápidos (< 350ms) pero permitir lecturas repetidas
      return;
    }
    AudioPlayer.playDuplicateAlertSound();
    if (typeof MultiZoneScannerManager !== 'undefined') {
      MultiZoneScannerManager.notifyZoneResult(resolved.zoneId, resolved.scannerId, 'duplicate');
    }
    triggerHeroFlash('duplicate', cleanCode, `Caja duplicada en ${resolved.zoneName} (leída hace ${Math.round(dupInfo.elapsedSec)}s)`, null, 0, 0, currentDate, parsed, resolved);
    showToast(`⚠️ ${resolved.zoneName} (${APP_CONFIG.TOLERANCIA_DUPLICADO_SEG}s): Espera ${dupInfo.remainingSec}s para repetir ${cleanCode} en esa zona.`, 'warning');
    return;
  }

  // 3. IDENTIFICAR AL EMPLEADO ASOCIADO (Primeros 4 dígitos)
  let matchedEmployee = AppState.employees.find(emp => {
    const empCodeNorm = String(emp.codigo_empleado || '').trim().toUpperCase();
    const targetNorm = String(parsed.empCode || '').trim().toUpperCase();
    const targetDigits = targetNorm.replace(/\D/g, '');
    const empDigits = empCodeNorm.replace(/\D/g, '');
    return empCodeNorm === targetNorm || 
           empCodeNorm === `BAC-${targetNorm}` ||
           (empDigits && targetDigits && empDigits.padStart(4, '0') === targetDigits.padStart(4, '0')) ||
           (emp.nombre_completo && emp.nombre_completo.toUpperCase().includes(targetNorm));
  });

  // Fallback de búsqueda amplia si no coincide con los 4 dígitos
  if (!matchedEmployee) {
    matchedEmployee = AppState.employees.find(emp => 
      cleanCode.toUpperCase().startsWith(String(emp.codigo_empleado).toUpperCase()) ||
      String(emp.codigo_empleado).toUpperCase().startsWith(parsed.empCode.toUpperCase())
    );
  }

  // 4. MODO DE PRUEBA: Si no coincide ningún empleado, auto-asignar para aceptar CUALQUIER código
  if (!matchedEmployee && APP_CONFIG.MODO_PRUEBA) {
    matchedEmployee = (AppState.employees && AppState.employees.find(emp => emp.activo !== false)) ||
                      (INITIAL_FALLBACK_EMPLOYEES && INITIAL_FALLBACK_EMPLOYEES[0]) || {
                        id: '49280d93-4242-465b-91c3-bca5c911dfa8',
                        codigo_empleado: '0101',
                        nombre_completo: 'Juan Carlos Mendoza (Modo Prueba)',
                        tarifa_personalizada: 150.00,
                        activo: true
                      };
    parsed.empCode = matchedEmployee.codigo_empleado || '0101';
  }

  // 5. CASO: EMPLEADO DESCONOCIDO
  if (!matchedEmployee) {
    AudioPlayer.playErrorBeep();
    triggerHeroFlash('error', cleanCode, `Empleado "${parsed.empCode}" no registrado (${resolved.zoneName})`, null, 0, 0, currentDate, parsed, resolved);
    showToast(`❌ Empleado "${parsed.empCode}" no registrado en ${resolved.zoneName} (Código: ${cleanCode}). Activá el 'Modo Prueba' para aceptar cualquier código.`, 'error');
    return;
  }

  // 6. CASO: EMPLEADO INACTIVO
  if (matchedEmployee.activo === false) {
    AudioPlayer.playErrorBeep();
    triggerHeroFlash('error', cleanCode, `Empleado inactivo: ${matchedEmployee.nombre_completo}`, matchedEmployee, 0, 0, currentDate, parsed, resolved);
    showToast(`⚠️ El empleado ${matchedEmployee.nombre_completo} está marcado como INACTIVO.`, 'warning');
    return;
  }

  // 7. REGISTRO EXITOSO: EMITIR BEEP POTENTE INMEDIATAMENTE (< 5ms)
  AudioPlayer.playSuccessBeep();
  if (typeof MultiZoneScannerManager !== 'undefined') {
    MultiZoneScannerManager.markScanned(resolved, cleanCode, now, { empName: matchedEmployee.nombre_completo });
  } else {
    AppState.lastScannedTimeByCode[resolved.dedupScopeKey] = now;
  }

  // Calcular tarifa para este empleado
  const appliedRate = (matchedEmployee.tarifa_personalizada && matchedEmployee.tarifa_personalizada > 0)
    ? parseFloat(matchedEmployee.tarifa_personalizada)
    : APP_CONFIG.TARIFA_BASE;

  // Determinar turno actual según la hora
  const currentHour = currentDate.getHours();
  let turno = 'Mañana';
  if (currentHour >= 14 && currentHour < 22) turno = 'Tarde';
  else if (currentHour >= 22 || currentHour < 6) turno = 'Noche';

  const newRecord = {
    id: 'scan_' + now + '_' + Math.random().toString(36).substr(2, 5),
    empleado_id: matchedEmployee.id,
    codigo_barra_leido: cleanCode || barcode,
    codigo_empleado_extraido: parsed.empCode,
    codigo_calidad: parsed.qualityCode,
    nombre_calidad: parsed.calidadNombre,
    codigo_tipo_caja: parsed.boxTypeCode,
    nombre_tipo_caja: parsed.tipoCajaNombre,
    empleado_nombre_snapshot: matchedEmployee.nombre_completo,
    tarifa_aplicada: appliedRate,
    fecha_hora: currentDate.toISOString(),
    fecha_dia: currentDate.toISOString().split('T')[0],
    turno: turno,
    linea_empaque: resolved.zoneName,
    origen_dispositivo: resolved.deviceLabel,
    numero_correlativo: '',
    es_prueba: !!APP_CONFIG.MODO_PRUEBA
  };

  // Guardar en la base de datos (Supabase + IndexedDB) y actualizar estado
  DB.recordScan(newRecord);

  // Calcular conteo y acumulado exacto del día de este empleado
  const empTodayScans = getEmployeeScansToday(matchedEmployee);
  const empTotalBoxes = empTodayScans.length;
  const empTotalEarnings = empTodayScans.reduce((sum, s) => sum + (parseFloat(s.tarifa_aplicada) || 0), 0);

  // Actualizar Tarjeta Gigante del Operador con Animación y Zona/Escáner
  const heroActionText = APP_CONFIG.MODO_PRUEBA
    ? `🧪 MODO PRUEBA · ${resolved.zoneName.toUpperCase()}`
    : `CAJA REGISTRADA · ${resolved.zoneName.toUpperCase()}`;
  triggerHeroFlash('success', cleanCode, heroActionText, matchedEmployee, empTotalBoxes, empTotalEarnings, currentDate, parsed, resolved);

  // Actualizar todos los tableros y KPIs
  updateAllDashboardStats();
  renderLiveScansList();
}

// Inicializar el Driver del Lector de Código de Barras
const BarcodeScanner = new BarcodeScannerDriver(handleBarcodeScanned);

// ==============================================================================
// 5B. CONTROL DEL MODO DE PRUEBA (ACEPTAR CUALQUIER CÓDIGO DE BARRA)
// ==============================================================================
function setTestMode(enable) {
  APP_CONFIG.MODO_PRUEBA = !!enable;
  AppState.testMode = !!enable;
  try {
    localStorage.setItem('magaretto_modo_prueba', enable ? 'true' : 'false');
  } catch (_) {}

  updateTestModeUI();

  if (enable) {
    showToast('🧪 Modo de Prueba ACTIVADO: Se aceptará cualquier código de barra en todas las zonas.', 'success');
  } else {
    showToast('Modo de Prueba DESACTIVADO: Volviendo a validación estricta de empleados.', 'info');
  }
}

let _lastTestModeToggleTime = 0;
function toggleTestMode(e) {
  if (e) {
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }
  const now = Date.now();
  if (now - _lastTestModeToggleTime < 400) {
    // Evitar doble ejecución en el mismo clic
    return;
  }
  _lastTestModeToggleTime = now;
  setTestMode(!APP_CONFIG.MODO_PRUEBA);
}

// Exponer en window para llamadas directas onclick y compatibilidad global
window.setTestMode = setTestMode;
window.toggleTestMode = toggleTestMode;
window.clearTestScans = clearTestScans;
window.deleteSingleScan = deleteSingleScan;
window.updateTestModeUI = updateTestModeUI;

async function deleteSingleScan(scanId) {
  if (!scanId) return;
  const scan = (AppState.todayScans || []).find(s => s.id === scanId) || (AppState.recentScans || []).find(s => s.id === scanId);
  const desc = scan ? `${scan.empleado_nombre_snapshot || 'Caja'} (${scan.codigo_barra_leido})` : 'este escaneo';
  if (!confirm(`¿Eliminar definitivamente ${desc} de la base de datos?`)) return;

  // Actualización optimista de UI
  AppState.todayScans = (AppState.todayScans || []).filter(s => s.id !== scanId);
  AppState.recentScans = (AppState.recentScans || []).filter(s => s.id !== scanId);
  updateAllDashboardStats();
  renderLiveScansList();

  try {
    if (AppState.supabaseConnected && AppState.supabaseClient) {
      const { error } = await AppState.supabaseClient
        .from('registros_cajas')
        .delete()
        .eq('id', scanId);
      if (error) {
        console.error('Error eliminando escaneo de Supabase:', error);
        showToast(`Error al borrar en Supabase: ${error.message}`, 'error');
        await DB.loadTodayScans();
        return;
      }
    }

    // Limpiar de cola IndexedDB si estaba offline
    if (DB && DB.db) {
      try {
        const tx = DB.db.transaction(['scans_queue'], 'readwrite');
        const store = tx.objectStore('scans_queue');
        const getAllReq = store.getAll();
        getAllReq.onsuccess = () => {
          (getAllReq.result || []).forEach(item => {
            if (item.id === scanId && item.local_id) {
              store.delete(item.local_id);
            }
          });
        };
      } catch (_) {}
    }

    showToast('🗑️ Escaneo eliminado definitivamente de la base de datos.', 'success');
  } catch (err) {
    console.error('Error en deleteSingleScan:', err);
    showToast('Error al eliminar el escaneo: ' + (err.message || err), 'error');
  }
}

function updateTestModeUI() {
  const isTest = !!APP_CONFIG.MODO_PRUEBA;

  // 1. Botón en la barra compacta del escáner
  const btnToggle = document.getElementById('btnToggleTestMode');
  const txtToggle = document.getElementById('testModeStatusText');
  if (btnToggle) {
    btnToggle.classList.toggle('active', isTest);
    if (txtToggle) txtToggle.textContent = isTest ? 'ON' : 'OFF';
  }

  // 2. Botón en el topbar
  const topbarBtn = document.getElementById('btnTopbarTestMode');
  const topbarTxt = document.getElementById('topbarTestModeText');
  if (topbarBtn) {
    topbarBtn.classList.toggle('active', isTest);
    if (topbarTxt) topbarTxt.textContent = isTest ? 'ON' : 'OFF';
  }

  // 3. Banner informativo en la mesa del escáner
  const banner = document.getElementById('testModeBanner');
  if (banner) {
    banner.style.display = isTest ? 'flex' : 'none';
  }

  // 4. Checkbox en configuración
  const chk = document.getElementById('cfgModoPrueba');
  if (chk && chk.checked !== isTest) {
    chk.checked = isTest;
  }
}

async function clearTestScans(e) {
  if (e && e.preventDefault) e.preventDefault();

  const testScansCount = (AppState.todayScans || []).filter(s => s.es_prueba).length;
  const totalScans = (AppState.todayScans || []).length;
  const totalRecent = (AppState.recentScans || []).length;

  if (totalScans === 0 && totalRecent === 0) {
    showToast('No hay escaneos para limpiar en la base de datos.', 'info');
    return;
  }

  let deleteMode = 'tests'; // 'tests' | 'all_today'
  let confirmMsg = '';

  if (testScansCount > 0) {
    confirmMsg = `¿Desea eliminar definitivamente las ${testScansCount} cajas de prueba de la base de datos en Supabase?`;
    deleteMode = 'tests';
  } else if (totalScans > 0) {
    confirmMsg = `No hay cajas marcadas con bandera de prueba.\n\n¿Desea eliminar definitivamente las ${totalScans} cajas de hoy de la base de datos para comenzar una jornada limpia?`;
    deleteMode = 'all_today';
  } else {
    confirmMsg = `No hay cajas escaneadas hoy, pero hay ${totalRecent} movimientos recientes.\n¿Desea limpiar los registros de prueba recientes de la base de datos?`;
    deleteMode = 'tests';
  }

  if (!confirm(confirmMsg)) return;

  const btnClear = document.getElementById('btnClearTestScans');
  if (btnClear) {
    btnClear.disabled = true;
    btnClear.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Limpiando...';
  }

  try {
    const today = new Date();
    const utcDateStr = today.toISOString().split('T')[0];
    const localDateStr = today.toLocaleDateString('en-CA');
    const targetDates = Array.from(new Set([utcDateStr, localDateStr]));

    if (AppState.supabaseConnected && AppState.supabaseClient) {
      if (deleteMode === 'tests') {
        const testIds = (AppState.todayScans || [])
          .concat(AppState.recentScans || [])
          .filter(s => s.es_prueba)
          .map(s => s.id);

        if (testIds.length > 0) {
          const { error } = await AppState.supabaseClient
            .from('registros_cajas')
            .delete()
            .in('id', testIds);
          if (error) console.error('Error borrando tests por ID en Supabase:', error);
        }

        // También borrar cualquier registro con es_prueba = true en la tabla
        await AppState.supabaseClient
          .from('registros_cajas')
          .delete()
          .eq('es_prueba', true);

      } else {
        // Borrar todos los registros de la jornada de hoy
        const { error } = await AppState.supabaseClient
          .from('registros_cajas')
          .delete()
          .in('fecha_dia', targetDates);
        if (error) console.error('Error borrando hoy en Supabase:', error);
      }
    }

    // Limpiar cola IndexedDB
    if (DB && DB.db) {
      try {
        const tx = DB.db.transaction(['scans_queue'], 'readwrite');
        tx.objectStore('scans_queue').clear();
      } catch (e) {}
    }

    // Limpiar cache localStorage si existiera
    try {
      localStorage.removeItem('vete_cached_scans');
    } catch (_) {}

    // Limpiar memoria
    if (deleteMode === 'tests') {
      AppState.todayScans = (AppState.todayScans || []).filter(s => !s.es_prueba);
      AppState.recentScans = (AppState.recentScans || []).filter(s => !s.es_prueba);
    } else {
      AppState.todayScans = [];
      AppState.recentScans = [];
    }

    // Reiniciar anti-duplicados en memoria
    AppState.lastScannedTimeByCode = {};
    if (typeof MultiZoneScannerManager !== 'undefined') {
      MultiZoneScannerManager.lastTimeByScopeKey = {};
      MultiZoneScannerManager.cooldownMetaByZone = {};
      MultiZoneScannerManager.refreshZoneCounts();
    }

    // Limpiar hero card si mostraba scan previo
    const heroContent = document.getElementById('lastScanContent');
    const heroEmpty = document.getElementById('lastScanEmpty');
    if (heroContent && heroEmpty) {
      heroContent.classList.remove('visible');
      heroEmpty.style.display = 'block';
    }

    // Recargar desde Supabase para confirmar sincronización absoluta
    await DB.loadTodayScans();
    showToast('🧹 Escaneos eliminados definitivamente de la base de datos.', 'success');
  } catch (err) {
    console.error('Error en clearTestScans:', err);
    showToast('Ocurrió un error al limpiar los escaneos: ' + (err.message || err), 'error');
  } finally {
    if (btnClear) {
      btnClear.disabled = false;
      btnClear.innerHTML = '<i class="fa-solid fa-trash-can"></i> Limpiar Pruebas';
    }
  }
}

function initTestModeControls() {
  const chkCfg = document.getElementById('cfgModoPrueba');
  if (chkCfg) {
    chkCfg.checked = !!APP_CONFIG.MODO_PRUEBA;
    chkCfg.addEventListener('change', (e) => setTestMode(e.target.checked));
  }

  // Atajo de teclado global Alt+T para alternar Modo Prueba rápidamente
  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      toggleTestMode(e);
    }
  });

  updateTestModeUI();
}

// ==============================================================================
// 6. RENDERIZADO VISUAL Y TABLEROS DE INFORMACIÓN
// ==============================================================================

// Helper unificado para calcular todas las cajas escaneadas hoy por un empleado
function getEmployeeScansToday(emp) {
  if (!emp) return [];
  const empId = String(emp.id || '');
  const empCode = String(emp.codigo_empleado || '').trim().toUpperCase();
  const empName = String(emp.nombre_completo || '').trim().toLowerCase();

  return AppState.todayScans.filter(s => {
    // 1. Coincidencia por ID
    if (s.empleado_id && String(s.empleado_id) === empId) return true;
    
    // 2. Coincidencia por código de empleado extraído de 4 dígitos (ej: "0121")
    if (s.codigo_empleado_extraido && String(s.codigo_empleado_extraido).trim().toUpperCase() === empCode) return true;

    // 3. Coincidencia por código de empleado extraído del código de barra
    const bcEmp = extractEmpCodeFromRecord(s);
    if (bcEmp && bcEmp.toUpperCase() === empCode) return true;

    // 4. Coincidencia por nombre completo del empacador
    if (s.empleado_nombre_snapshot && String(s.empleado_nombre_snapshot).trim().toLowerCase() === empName) return true;

    return false;
  });
}

// Helper unificado para obtener el total acumulado histórico de cajas por empleado
function getEmployeeHistoricalBoxes(emp) {
  if (!emp) return 0;
  const totals = AppState.employeeBoxTotals || {};
  const empId = String(emp.id || '');
  const empCode = String(emp.codigo_empleado || '').trim();
  const empName = (emp.nombre_completo || '').toLowerCase().trim();

  if (empId && totals[empId] !== undefined) return totals[empId];
  if (empCode && totals[empCode] !== undefined) return totals[empCode];
  if (empName && totals[empName] !== undefined) return totals[empName];
  return 0;
}

// Helper para formatear fecha corta en formato DD/MM/YY (ej: 22/08/26)
function getFormattedDateShort(date = new Date()) {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
}

// Animación y Actualización de la Tarjeta Gigante de Última Caja (Con Desglose 8 Dígitos)
function triggerHeroFlash(status, barcode, message, employee = null, empBoxes = 0, empEarnings = 0, dateObj = new Date(), parsed = null, zoneMeta = null) {
  const heroCard = document.getElementById('lastScanHeroCard');
  const emptyState = document.getElementById('lastScanEmpty');
  const contentState = document.getElementById('lastScanContent');
  const statusBadge = document.getElementById('heroStatusBadge');
  const heroTimestamp = document.getElementById('heroTimestamp');
  const heroEmpName = document.getElementById('heroEmployeeName');
  const heroCodeText = document.getElementById('heroCodeText');
  const heroDniText = document.getElementById('heroDniText');
  const heroAccumText = document.getElementById('heroAccumText');
  const heroEmpBoxCount = document.getElementById('heroEmpBoxCount');
  const heroBarcodeRead = document.getElementById('heroBarcodeRead');
  const heroEmpDateShift = document.getElementById('heroEmpDateShift');

  if (!heroCard || !emptyState || !contentState) return;

  // Remover clases previas
  heroCard.classList.remove('success-flash', 'error-flash');
  void heroCard.offsetWidth; // Forzar reflow para reiniciar la animación CSS

  emptyState.style.display = 'none';
  contentState.classList.add('visible');

  const timeStr = dateObj.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  heroTimestamp.innerText = timeStr;
  const zoneBadgeHtml = zoneMeta && (zoneMeta.deviceLabel || zoneMeta.zoneName)
    ? `<span class="ui-badge ui-badge-info"><i class="fa-solid fa-diagram-project"></i> ${escapeHtml(zoneMeta.deviceLabel || zoneMeta.zoneName)}</span>`
    : '';

  if (status === 'success' && employee) {
    const formattedDate = getFormattedDateShort(dateObj);
    const boxWord = empBoxes === 1 ? 'caja' : 'cajas';
    const p = parsed || parseVeteBarcode(barcode);

    heroCard.classList.add('success-flash');
    statusBadge.className = 'scan-status-badge success' + (APP_CONFIG.MODO_PRUEBA ? ' test-mode' : '');
    statusBadge.innerHTML = (APP_CONFIG.MODO_PRUEBA ? '<i class="fa-solid fa-flask"></i> ' : '<i class="fa-solid fa-circle-check"></i> ') + message;
    heroEmpName.innerText = employee.nombre_completo + (APP_CONFIG.MODO_PRUEBA ? ' (Modo Prueba)' : '');
    
    // Desglose de 10 Dígitos: Empleado, Calidad, Envase y Zona
    heroCodeText.innerHTML = `
      ${APP_CONFIG.MODO_PRUEBA ? '<span class="ui-badge ui-badge-warning" style="background:rgba(245,158,11,0.15); color:#b45309; border:1px solid #f59e0b; font-weight:700;"><i class="fa-solid fa-flask"></i> CÓDIGO DE PRUEBA</span>' : ''}
      <span class="ui-badge ui-badge-neutral"><i class="fa-solid fa-user-tag"></i> Emp: <strong>${escapeHtml(p.empCode)}</strong></span>
      <span class="ui-badge ui-badge-info">
        <i class="fa-solid fa-leaf"></i> Cal: <strong>${escapeHtml(p.qualityCode)}</strong> (${escapeHtml(p.calidadCorto)})
      </span>
      <span class="ui-badge ui-badge-warning">
        <i class="fa-solid fa-box"></i> Envase: <strong>${escapeHtml(p.tipoCajaNombre)}</strong>
      </span>
      ${zoneBadgeHtml}
    `;
    
    heroDniText.innerText = employee.dni_rut ? `DNI: ${employee.dni_rut}` : '';
    
    // Frase requerida de alta visibilidad: Juan Carlos Mendoza 10 cajas - 22/08/26
    if (heroAccumText) {
      heroAccumText.innerHTML = `<span style="color:var(--text-primary); font-weight:700; font-size:1rem;">${escapeHtml(employee.nombre_completo)}</span> <span class="ui-badge ui-badge-violet" style="font-family:var(--font-mono); font-weight:700; font-size:0.9rem;">${empBoxes} ${boxWord}</span> <span style="color:var(--text-muted); font-weight:600; font-size:0.85rem;">- ${formattedDate}</span>`;
    }

    if (heroEmpBoxCount) heroEmpBoxCount.innerText = `${empBoxes}`;
    if (heroEmpDateShift) heroEmpDateShift.innerText = `${formattedDate}`;
    if (heroBarcodeRead) {
      heroBarcodeRead.innerHTML = `<span style="font-family:var(--font-mono); font-weight:700; color:var(--accent-primary);">${escapeHtml(barcode)}</span>`;
    }
  } else if (status === 'duplicate') {
    const p = parsed || parseVeteBarcode(barcode);
    heroCard.classList.add('error-flash');
    statusBadge.className = 'scan-status-badge duplicate';
    statusBadge.innerHTML = '<i class="fa-solid fa-clock"></i> ' + message;
    heroEmpName.innerHTML = `<span style="color:var(--status-warning); font-weight:700;">TOLERANCIA ANTI-DUPLICADO</span>`;
    heroCodeText.innerHTML = `
      <span class="ui-badge ui-badge-warning">
        <i class="fa-solid fa-hourglass-half"></i> Espera ${APP_CONFIG.TOLERANCIA_DUPLICADO_SEG}s entre lecturas consecutivas en esta zona
      </span>
      ${zoneBadgeHtml}
    `;
    heroDniText.innerText = `Anti-rebote activo (${APP_CONFIG.TOLERANCIA_DUPLICADO_SEG} segundos)`;
    if (heroAccumText) heroAccumText.innerHTML = `<span style="color:var(--status-warning); font-weight:600;">⏱️ Escaneo muy rápido. Otras zonas siguen libres para leer el mismo código.</span>`;
    if (heroBarcodeRead) heroBarcodeRead.innerHTML = `<span style="color:var(--status-warning); font-family:var(--font-mono); font-weight:700;">${escapeHtml(barcode)}</span>`;
  } else {
    heroCard.classList.add('error-flash');
    statusBadge.className = 'scan-status-badge error';
    statusBadge.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> ' + message;
    heroEmpName.innerText = 'CÓDIGO NO IDENTIFICADO';
    heroCodeText.innerText = barcode;
    heroDniText.innerText = '';
    if (heroAccumText) heroAccumText.innerText = '-';
    if (heroEmpBoxCount) heroEmpBoxCount.innerText = '-';
    if (heroBarcodeRead) heroBarcodeRead.innerText = barcode;
  }
}

// Actualizar Tarjeta Gigante si ya está visible o al cargar escaneos iniciales
function refreshHeroCardIfVisible(forceShow = false) {
  const contentState = document.getElementById('lastScanContent');
  const emptyState = document.getElementById('lastScanEmpty');
  if (!contentState) return;
  if (!forceShow && !contentState.classList.contains('visible')) return;
  if (!AppState.todayScans || AppState.todayScans.length === 0) return;

  const lastScan = AppState.todayScans[0];
  if (!lastScan) return;

  const targetCode = lastScan.codigo_empleado_extraido || extractEmpCodeFromRecord(lastScan);
  const emp = AppState.employees.find(e => 
    (targetCode && e.codigo_empleado === targetCode) ||
    (lastScan.empleado_id && e.id === lastScan.empleado_id) ||
    (lastScan.empleado_nombre_snapshot && e.nombre_completo === lastScan.empleado_nombre_snapshot)
  );

  const displayEmp = emp || {
    id: lastScan.empleado_id,
    codigo_empleado: targetCode || '0000',
    nombre_completo: lastScan.empleado_nombre_snapshot || `Operario ${targetCode || ''}`
  };

  const empScans = getEmployeeScansToday(displayEmp);
  const empBoxes = empScans.length;
  const empEarnings = empScans.reduce((sum, s) => sum + (parseFloat(s.tarifa_aplicada) || 0), 0);
  const scanDate = new Date(lastScan.fecha_hora || Date.now());
  const parsed = parseVeteBarcode(lastScan.codigo_barra_leido);

  if (forceShow) {
    if (emptyState) emptyState.style.display = 'none';
    contentState.classList.add('visible');
  }

  triggerHeroFlash('success', lastScan.codigo_barra_leido, 'CAJA REGISTRADA CORRECTAMENTE', displayEmp, empBoxes, empEarnings, scanDate, parsed, {
    zoneName: lastScan.linea_empaque || 'Zona 1',
    deviceLabel: lastScan.origen_dispositivo || lastScan.linea_empaque || 'Zona 1'
  });
}

// Renderizar el Acumulado de Cajas por Empleado Hoy (Números Gigantes de Alta Visibilidad, Sin Importes)
function renderEmployeeAccumulatedList() {
  const container = document.getElementById('empAccumulatedList');
  const badge = document.getElementById('liveScanCountBadge');
  if (!container) return;

  const formattedDate = getFormattedDateShort(new Date());
  const totalTodayScans = AppState.todayScans.length;
  const totalHist = AppState.totalHistoricalScans || 0;
  if (badge) {
    badge.innerText = totalTodayScans > 0 
      ? `${totalTodayScans} cajas hoy` 
      : `0 hoy • ${totalHist} en total`;
  }

  // Calcular la suma exacta de cajas por cada empleado el día de hoy y su total histórico
  const empStats = AppState.employees.map(emp => {
    const scans = getEmployeeScansToday(emp);
    const histTotal = getEmployeeHistoricalBoxes(emp);
    return {
      ...emp,
      boxes: scans.length,
      historicalBoxes: histTotal
    };
  });

  // Ordenar: primero los que tienen más cajas acumuladas hoy; si están en 0 hoy, ordenar por histórico
  empStats.sort((a, b) => (b.boxes - a.boxes) || (b.historicalBoxes - a.historicalBoxes) || a.nombre_completo.localeCompare(b.nombre_completo));

  if (empStats.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:3rem 1rem; color:var(--text-muted);">
        <i class="fa-solid fa-users" style="font-size:2rem; margin-bottom:0.5rem; display:block;"></i>
        No hay empleados registrados.
      </div>`;
    return;
  }

  const maxBoxes = empStats[0]?.boxes || 0;

  container.innerHTML = empStats.map((emp, index) => {
    const isLeader = emp.boxes > 0 && emp.boxes === maxBoxes;
    const hasBoxes = emp.boxes > 0;
    const hasHistorical = emp.historicalBoxes > 0;
    const initials = (emp.nombre_completo || 'E')
      .split(' ')
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();

    const boxWord = emp.boxes === 1 ? 'caja' : 'cajas';

    return `
      <div class="emp-accum-item ${hasBoxes ? 'has-boxes' : ''} ${isLeader ? 'leader' : ''}">
        <div class="emp-accum-left">
          <div class="emp-accum-avatar ${isLeader ? 'leader-avatar' : ''}">${initials}</div>
          <div style="min-width:0;">
            <div class="emp-accum-name-line">
              <span>${escapeHtml(emp.nombre_completo)}</span>
              ${isLeader ? '<span style="font-size:0.9rem;" title="Líder del turno">🥇</span>' : ''}
            </div>
            <div class="emp-accum-meta-sub">
              <span style="font-family:var(--font-mono); font-weight:600; color:var(--accent-primary);"><i class="fa-solid fa-barcode"></i> ${escapeHtml(emp.codigo_empleado)}</span>
              <span>• ${emp.boxes} hoy</span>
              ${hasHistorical ? `<span style="color:var(--status-success); font-weight:600;">• ${emp.historicalBoxes} en total</span>` : ''}
              ${emp.dni_rut ? `<span>• DNI: ${escapeHtml(emp.dni_rut)}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="emp-accum-big-count ${hasBoxes ? 'active-count' : (hasHistorical ? 'active-count' : 'zero-badge')} ${isLeader ? 'leader-badge' : ''}" title="${escapeHtml(emp.nombre_completo)}: ${emp.boxes} cajas hoy • ${emp.historicalBoxes} histórico">
          <span class="count-num">${hasBoxes ? emp.boxes : emp.historicalBoxes}</span>
          <span class="count-unit">${hasBoxes ? boxWord : 'total'}</span>
        </div>
      </div>
    `;
  }).join('');
}

// Renderizar la lista de últimas cajas escaneadas (Stream en vivo)
function renderLiveScansList() {
  const container = document.getElementById('liveScansList');
  const badge = document.getElementById('liveScanCountBadge');
  if (!container) return;

  const totalToday = AppState.todayScans.length;
  const totalHist = AppState.totalHistoricalScans || 0;
  if (badge) {
    badge.innerText = totalToday > 0 ? `${totalToday} cajas hoy` : `0 hoy • ${totalHist} en total`;
  }

  // Si hoy no hay escaneos, mostrar los últimos movimientos guardados en la nube
  const displayScans = (AppState.todayScans.length > 0) ? AppState.todayScans : AppState.recentScans;

  if (displayScans.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:3rem 1rem; color:var(--text-muted);">
        <i class="fa-solid fa-list-check" style="font-size:2rem; margin-bottom:0.5rem; display:block;"></i>
        No hay escaneos registrados aún en la base de datos.
      </div>`;
    return;
  }

  const isShowingHistoricalNotice = (AppState.todayScans.length === 0 && AppState.recentScans.length > 0);
  const noticeHtml = isShowingHistoricalNotice ? `
    <div class="ui-notice-banner" style="margin:0.6rem; padding:0.6rem 0.85rem;">
      <div class="ui-notice-banner-text" style="font-size:0.78rem;">
        <i class="fa-solid fa-clock-rotate-left"></i>
        <span>Sin escaneos hoy. Mostrando últimos movimientos guardados en Supabase:</span>
      </div>
    </div>
  ` : '';

  container.innerHTML = noticeHtml + displayScans.map((scan, idx) => {
    const scanDate = new Date(scan.fecha_hora || Date.now());
    const time = scanDate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    const dateStr = getFormattedDateShort(scanDate);
    const displayTimestamp = isShowingHistoricalNotice ? `${dateStr} ${time}` : time;

    const initials = (scan.empleado_nombre_snapshot || 'E')
      .split(' ')
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();

    const isSegunda = scan.codigo_calidad === '02';
    const calBadgeColor = isSegunda ? 'var(--status-success)' : 'var(--status-info)';
    const calLabel = isSegunda ? '2ª' : '1ª';
    const boxLabel = escapeHtml(scan.nombre_tipo_caja || (isSegunda ? 'Segunda' : 'Primera'));

    return `
      <div class="scan-log-item">
        <div class="log-emp-info">
          <div class="emp-avatar-circle">${initials}</div>
          <div>
            <div class="log-emp-name">${escapeHtml(scan.empleado_nombre_snapshot)}</div>
            <div class="log-emp-code">
              <i class="fa-solid fa-barcode"></i> ${escapeHtml(scan.codigo_barra_leido)} 
              <span style="color:var(--text-muted); font-size:0.7rem;">(${escapeHtml(scan.linea_empaque || 'Zona 1')} • ${scan.turno})</span>
            </div>
          </div>
        </div>
        <div class="log-meta-info" style="display:flex; align-items:center; gap:8px;">
          <div>
            <div class="log-price-badge" style="color:${calBadgeColor}; font-weight:600; font-size:0.75rem;"><i class="fa-solid fa-box"></i> ${calLabel}: ${boxLabel}</div>
            <div class="log-time" style="font-size:0.75rem;">${displayTimestamp}</div>
          </div>
          <button type="button" class="btn-delete-scan-row" title="Eliminar este escaneo" onclick="event.stopPropagation(); deleteSingleScan('${scan.id}')">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Actualizar todos los KPIs superiores y métricas de producción
function updateAllDashboardStats() {
  const totalBoxes = AppState.todayScans.length;
  const totalNomina = AppState.todayScans.reduce((acc, s) => acc + (parseFloat(s.tarifa_aplicada) || 0), 0);

  // Conteo de empacadores únicos con al menos 1 caja hoy
  const uniqueEmps = new Set();
  const empCounts = {};
  let leaderName = '-';
  let leaderBoxes = 0;

  AppState.employees.forEach(emp => {
    const count = getEmployeeScansToday(emp).length;
    if (count > 0) {
      uniqueEmps.add(emp.nombre_completo);
      empCounts[emp.nombre_completo] = count;
      if (count > leaderBoxes) {
        leaderBoxes = count;
        leaderName = emp.nombre_completo;
      }
    }
  });

  const activeCount = uniqueEmps.size;

  // Calcular ritmo de cajas por hora
  let ritmoHora = 0;
  if (AppState.todayScans.length > 1) {
    const timestamps = AppState.todayScans.map(s => new Date(s.fecha_hora).getTime());
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const diffHours = (maxTime - minTime) / (1000 * 60 * 60);
    ritmoHora = diffHours > 0.05 ? Math.round(totalBoxes / diffHours) : totalBoxes * 10;
  } else if (totalBoxes === 1) {
    ritmoHora = 15;
  }

  // Actualizar elementos en DOM
  setElementText('kpiTotalCajas', totalBoxes.toLocaleString('es-AR'));
  setElementText('kpiTotalHistorico', `(Histórico: ${(AppState.totalHistoricalScans || 0).toLocaleString('es-AR')})`);
  setElementText('kpiEmpacadoresActivos', activeCount);
  setElementText('kpiRitmoHora', `${ritmoHora} <small>c/h</small>`);
  setElementText('kpiLiderNombre', leaderBoxes > 0 ? `${escapeHtml(leaderName)} <small style="font-size:0.78rem; color:var(--accent-primary); font-weight:700;">(${leaderBoxes})</small>` : '-');

  const navBadge = document.getElementById('navScannerBadge');
  if (navBadge) {
    navBadge.textContent = totalBoxes.toLocaleString('es-AR');
  }

  // Actualizar listas de la pantalla principal
  renderEmployeeAccumulatedList();
  renderLiveScansList();

  // Actualizar contadores en vivo de las 3 Zonas de Marcado
  if (typeof MultiZoneScannerManager !== 'undefined') {
    MultiZoneScannerManager.refreshZoneCounts();
  }

  // Actualizar también ranking en la pestaña de Producción
  renderProductionRankings(empCounts, totalBoxes);

  // Renderizar la Vista Ejecutiva (Dashboard optimizado para Gerencia y Celulares)
  renderExecutiveDashboard(totalBoxes, activeCount, ritmoHora, leaderName, leaderBoxes);

  // Mantener la Tarjeta Gigante (Hero) siempre actualizada con la cuenta exacta
  refreshHeroCardIfVisible();

  // Actualizar en tiempo real el Tablero / Dashboard si está activo
  if (AppState.activeTab === 'tab-dashboard' && typeof DashboardManager !== 'undefined') {
    DashboardManager.refreshLiveIfActive();
  }
}

// Renderizar el Tablero Ejecutivo Especial para Gerencia / Celulares
function renderExecutiveDashboard(totalBoxes, activeCount, ritmoHora, leaderName, leaderBoxes) {
  const execView = document.getElementById('executiveStationView');
  if (!execView) return;

  // 1. Total Cajas Gigante
  setElementText('execTotalCajas', totalBoxes.toLocaleString('es-AR'));

  // 2. Fecha Actual Legible
  const now = new Date();
  const dateOptions = { weekday: 'long', day: 'numeric', month: 'long' };
  const formattedDateLong = now.toLocaleDateString('es-AR', dateOptions);
  setElementText('execCurrentDate', formattedDateLong);

  // 3. Mini Métricas
  setElementText('execRitmoHora', `${ritmoHora} <small style="font-size:0.65rem; font-weight:normal;">c/h</small>`);
  setElementText('execEmpacadoresActivos', `${activeCount}`);
  setElementText('execLiderTurno', leaderBoxes > 0 ? `${escapeHtml(leaderName)} (${leaderBoxes})` : '-');

  // Hora de la última caja registrada hoy
  if (AppState.todayScans && AppState.todayScans.length > 0) {
    const lastTime = new Date(AppState.todayScans[0].fecha_hora || Date.now());
    setElementText('execUltimaCajaHora', lastTime.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }));
  } else {
    setElementText('execUltimaCajaHora', '--:--');
  }

  // 4. Barra de Calidad Minimalista
  let cal1Count = 0;
  let cal2Count = 0;
  AppState.todayScans.forEach(s => {
    if (s.codigo_calidad === '01' || String(s.nombre_calidad).includes('Primera') || String(s.nombre_calidad).includes('Premium')) {
      cal1Count++;
    } else {
      cal2Count++;
    }
  });

  const pct1 = totalBoxes > 0 ? Math.round((cal1Count / totalBoxes) * 100) : 100;
  const pct2 = totalBoxes > 0 ? (100 - pct1) : 0;

  const q1El = document.getElementById('execQuality1Label');
  const q2El = document.getElementById('execQuality2Label');
  const qFill = document.getElementById('execQualityFill');

  if (q1El) q1El.innerHTML = `<i class="fa-solid fa-medal exec-q-icon-1"></i> Primera: <strong>${cal1Count}</strong> (${pct1}%)`;
  if (q2El) q2El.innerHTML = `<i class="fa-solid fa-box-archive exec-q-icon-2"></i> Estándar: <strong>${cal2Count}</strong> (${pct2}%)`;
  if (qFill) qFill.style.width = `${pct1}%`;

  // 5. Lista de Acumulado por Empacador
  const container = document.getElementById('execEmployeeAccumList');
  const totalBadge = document.getElementById('execTotalEmployeesBadge');
  if (!container) return;

  if (totalBadge) {
    totalBadge.innerText = `${activeCount} activos hoy • ${AppState.employees.length} registrados`;
  }

  const empStats = AppState.employees.map(emp => {
    const scans = getEmployeeScansToday(emp);
    return {
      ...emp,
      boxes: scans.length
    };
  });

  // Ordenar: primero los que tienen más cajas acumuladas hoy
  empStats.sort((a, b) => b.boxes - a.boxes || a.nombre_completo.localeCompare(b.nombre_completo));

  if (empStats.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:2rem 1rem; color:var(--text-muted);">
        No hay empacadores dados de alta.
      </div>`;
    return;
  }

  const maxBoxes = empStats[0]?.boxes || 1;

  container.innerHTML = empStats.map((emp, index) => {
    const isLeader = emp.boxes > 0 && emp.boxes === empStats[0].boxes;
    const hasBoxes = emp.boxes > 0;
    const percentage = totalBoxes > 0 ? Math.round((emp.boxes / totalBoxes) * 100) : 0;
    const medalOrRank = index === 0 && hasBoxes ? '🥇' : index === 1 && hasBoxes ? '🥈' : index === 2 && hasBoxes ? '🥉' : `<span style="color:var(--text-muted); font-size:0.8rem;">#${index + 1}</span>`;

    const initials = (emp.nombre_completo || 'E')
      .split(' ')
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();

    const boxWord = emp.boxes === 1 ? 'caja' : 'cajas';

    return `
      <div class="exec-emp-item ${hasBoxes ? 'has-boxes' : ''} ${isLeader ? 'leader-item' : ''}">
        <div class="exec-emp-left">
          <div class="exec-rank-badge">${medalOrRank}</div>
          <div class="exec-emp-avatar ${isLeader ? 'leader-avatar' : ''}">${initials}</div>
          <div class="exec-emp-details">
            <div class="exec-emp-name-line">
              <span>${escapeHtml(emp.nombre_completo)}</span>
              ${isLeader ? '<span title="Líder del Turno" style="font-size:0.8rem;">🏆</span>' : ''}
            </div>
            <div class="exec-emp-meta-line">
              <span style="font-family:var(--font-mono); font-weight:600; color:var(--accent-primary);"><i class="fa-solid fa-barcode"></i> ${escapeHtml(emp.codigo_empleado)}</span>
              ${emp.dni_rut ? `<span>• DNI: ${escapeHtml(emp.dni_rut)}</span>` : ''}
              ${hasBoxes ? `<span>• ${percentage}% del total</span>` : ''}
            </div>
            ${hasBoxes ? `
              <div class="exec-emp-bar">
                <div class="exec-emp-bar-fill" style="width: ${Math.round((emp.boxes / maxBoxes) * 100)}%;"></div>
              </div>
            ` : ''}
          </div>
        </div>
        <div class="exec-emp-count-box ${isLeader ? 'leader-count' : hasBoxes ? 'active' : ''}">
          <span class="exec-count-num">${emp.boxes}</span>
          <span class="exec-count-label">${boxWord}</span>
        </div>
      </div>
    `;
  }).join('');
}

// Renderizar Rankings de la Pestaña de Producción
function renderProductionRankings(empCounts = {}, totalBoxes = 0) {
  const container = document.getElementById('productionRankingsList');
  if (!container) return;

  const sorted = Object.entries(empCounts).sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:2rem; color:var(--text-muted);">
        Aún no hay registros de empaque en el período seleccionado.
      </div>`;
    return;
  }

  const maxBoxes = sorted[0][1] || 1;

  container.innerHTML = sorted.map(([name, count], index) => {
    const percentage = Math.round((count / maxBoxes) * 100);
    const shareOfTotal = totalBoxes > 0 ? ((count / totalBoxes) * 100).toFixed(1) : 0;
    const medalIcon = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;

    return `
      <div style="background:var(--bg-primary); padding:0.85rem 1.25rem; border-radius:var(--radius-md); border:1px solid var(--border-color);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.4rem;">
          <div style="font-weight:700; font-size:0.95rem; display:flex; align-items:center; gap:0.5rem;">
            <span style="font-size:1.1rem; width:28px;">${medalIcon}</span>
            <span>${escapeHtml(name)}</span>
          </div>
          <div style="font-family:var(--font-mono); font-weight:700; font-size:1.05rem; color:var(--accent-primary);">
            ${count} <span style="font-size:0.8rem; color:var(--text-secondary); font-weight:normal;">cajas (${shareOfTotal}%)</span>
          </div>
        </div>
        <div style="width:100%; height:7px; background-color:var(--bg-secondary); border-radius:99px; overflow:hidden;">
          <div style="width:${percentage}%; height:100%; background:var(--accent-primary); border-radius:99px; transition:width 0.5s ease;"></div>
        </div>
      </div>
    `;
  }).join('');
}

// Monitor y Gráficos de Producción (Soporta período, turno y ordenamiento)
async function renderProductionCharts() {
  const container = document.getElementById('productionRankingsList');
  if (!container) return;

  const periodSelect = document.getElementById('prodFilterPeriod');
  const turnoSelect = document.getElementById('prodFilterTurno');
  const sortSelect = document.getElementById('prodSortBy');

  const period = periodSelect ? periodSelect.value : 'este_mes';
  const turno = turnoSelect ? turnoSelect.value : 'todos';
  const sortBy = sortSelect ? sortSelect.value : 'cajas_desc';

  let records = [];

  if (period === 'hoy') {
    records = [...AppState.todayScans];
  } else if (AppState.supabaseConnected && AppState.supabaseClient) {
    try {
      const now = new Date();
      let startStr = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      let endStr = now.toISOString().split('T')[0];

      if (period === 'esta_semana') {
        const currentDay = now.getDay();
        const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;
        const monday = new Date(now);
        monday.setDate(now.getDate() + diffToMonday);
        startStr = monday.toISOString().split('T')[0];
      } else if (period === 'todo') {
        startStr = '2024-01-01';
      }

      const { data, error } = await AppState.supabaseClient
        .from('registros_cajas')
        .select('*')
        .gte('fecha_dia', startStr)
        .lte('fecha_dia', endStr);

      if (!error && data) {
        records = data;
      } else {
        records = AppState.todayScans;
      }
    } catch (e) {
      records = AppState.todayScans;
    }
  } else {
    records = AppState.todayScans;
  }

  // Filtrar por turno si aplica
  if (turno !== 'todos') {
    records = records.filter(r => r.turno === turno);
  }

  // Conteo por empleado
  const counts = {};
  records.forEach(r => {
    const name = r.empleado_nombre_snapshot || 'Desconocido';
    counts[name] = (counts[name] || 0) + 1;
  });

  // Si no hay cajas hoy pero sí hay histórico y se eligió 'hoy', mostrar tarjeta de acción rápida
  if (records.length === 0 && AppState.totalHistoricalScans > 0 && period === 'hoy') {
    container.innerHTML = `
      <div style="text-align:center; padding:2rem 1rem; color:var(--text-muted); background:var(--bg-primary); border-radius:var(--radius-md); border:1px solid var(--border-color);">
        <i class="fa-solid fa-calendar-xmark" style="font-size:2rem; margin-bottom:0.75rem; color:var(--accent-primary); display:block;"></i>
        <div style="font-weight:700; color:var(--text-primary); margin-bottom:0.35rem;">Sin registros en la jornada de hoy</div>
        <p style="font-size:0.85rem; margin-bottom:1rem;">Hay <strong>${AppState.totalHistoricalScans} cajas</strong> guardadas en la base de datos.</p>
        <button type="button" class="btn-primary" style="margin:0 auto; padding:0.4rem 1rem; font-size:0.85rem;" onclick="const p=document.getElementById('prodFilterPeriod'); if(p){p.value='este_mes';} renderProductionCharts();">
          <i class="fa-solid fa-calendar-days"></i> Ver Ranking de Este Mes (${AppState.totalHistoricalScans} cajas)
        </button>
      </div>`;
    return;
  }

  // Ordenar
  let entries = Object.entries(counts);
  if (sortBy === 'cajas_desc') {
    entries.sort((a, b) => b[1] - a[1]);
  } else if (sortBy === 'cajas_asc') {
    entries.sort((a, b) => a[1] - b[1]);
  } else if (sortBy === 'nombre') {
    entries.sort((a, b) => a[0].localeCompare(b[0]));
  }

  const sortedObj = Object.fromEntries(entries);
  renderProductionRankings(sortedObj, records.length);
}

// ==============================================================================
// 7. GESTIÓN DE EMPLEADOS Y ETIQUETAS DE CÓDIGO DE BARRAS
// ==============================================================================
function renderEmployeesTable() {
  const tbody = document.getElementById('employeesTableBody');
  if (!tbody) return;

  const searchTerm = (document.getElementById('employeeSearchInput')?.value || '').toLowerCase();

  const filtered = AppState.employees.filter(emp => {
    const matchName = emp.nombre_completo.toLowerCase().includes(searchTerm);
    const matchCode = emp.codigo_empleado.toLowerCase().includes(searchTerm);
    const matchDni = (emp.dni_rut || '').toLowerCase().includes(searchTerm);
    return matchName || matchCode || matchDni;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center; padding:2rem; color:var(--text-muted);">
          No se encontraron empacadores con el criterio de búsqueda.
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(emp => {
    const rate = emp.tarifa_personalizada ? `$${parseFloat(emp.tarifa_personalizada).toFixed(2)}` : `<span style="color:var(--text-muted)">General ($${APP_CONFIG.TARIFA_BASE.toFixed(2)})</span>`;
    const todayBoxes = AppState.todayScans.filter(s => s.empleado_id === emp.id || s.empleado_nombre_snapshot === emp.nombre_completo).length;
    const histTotal = getEmployeeHistoricalBoxes(emp);
    const statusBadge = emp.activo !== false 
      ? '<span class="badge-active"><i class="fa-solid fa-check"></i> Activo</span>'
      : '<span class="badge-inactive"><i class="fa-solid fa-ban"></i> Inactivo</span>';

    return `
      <tr>
        <td style="font-family:var(--font-mono); font-weight:700; color:var(--accent-primary);">${escapeHtml(emp.codigo_empleado)}</td>
        <td style="font-weight:700; color:var(--text-primary);">${escapeHtml(emp.nombre_completo)}</td>
        <td>${escapeHtml(emp.dni_rut || '-')}</td>
        <td>${escapeHtml(emp.telefono || '-')}</td>
        <td>${rate}</td>
        <td>${statusBadge}</td>
        <td style="font-family:var(--font-mono); font-weight:700; color:var(--status-success);">${todayBoxes} cajas</td>
        <td style="font-family:var(--font-mono); font-weight:800; color:var(--accent-primary);">${histTotal} cajas</td>
        <td style="text-align:right;">
          <button class="btn-secondary" style="padding:0.3rem 0.6rem; font-size:0.8rem; display:inline-flex;" onclick="openEditEmployeeModal('${emp.id || emp.codigo_empleado}')">
            <i class="fa-solid fa-pen"></i> Editar
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// Generación de etiquetas removida (no requerida)
function renderBarcodeLabels() {}

function populateEmployeeSelects() {
  const select = document.getElementById('manualSelectEmployee');
  if (select) {
    select.innerHTML = '<option value="">-- Seleccionar Empacador --</option>' + 
      AppState.employees
        .filter(e => e.activo !== false)
        .map(e => `<option value="${e.id || e.codigo_empleado}">${escapeHtml(e.codigo_empleado)} - ${escapeHtml(e.nombre_completo)}</option>`)
        .join('');
  }

  if (typeof DashboardManager !== 'undefined') {
    DashboardManager.populateEmployeeFilter();
  }
  if (typeof DescarteManager !== 'undefined') {
    DescarteManager.populateEmployees();
  }
}

// ==============================================================================
// 8. MÓDULO DE LIQUIDACIÓN DE NÓMINA Y PAGO A DESTAJO (RRHH)
// ==============================================================================
async function calculatePayroll(periodType = 'este_mes') {
  const dateFromInput = document.getElementById('payrollDateFrom');
  const dateToInput = document.getElementById('payrollDateTo');
  const tbody = document.getElementById('payrollTableBody');
  const bannerTotal = document.getElementById('payrollTotalAmount');
  const bannerBoxes = document.getElementById('payrollTotalBoxesCount');
  const bannerSubtitle = document.getElementById('payrollBannerSubtitle');

  let startDate, endDate;
  const now = new Date();

  if (periodType === 'hoy') {
    startDate = now.toISOString().split('T')[0];
    endDate = startDate;
  } else if (periodType === 'ayer') {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    startDate = y.toISOString().split('T')[0];
    endDate = startDate;
  } else if (periodType === 'esta_semana') {
    const curr = new Date();
    const currentDay = curr.getDay();
    const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    const monday = new Date(curr);
    monday.setDate(curr.getDate() + diffToMonday);
    startDate = monday.toISOString().split('T')[0];
    endDate = new Date().toISOString().split('T')[0];
  } else if (periodType === 'este_mes') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    endDate = now.toISOString().split('T')[0];
  } else if (periodType === 'ultimos_30') {
    const d30 = new Date(now);
    d30.setDate(now.getDate() - 29);
    startDate = d30.toISOString().split('T')[0];
    endDate = now.toISOString().split('T')[0];
  } else if (periodType === 'todo') {
    startDate = '2024-01-01';
    endDate = '2099-12-31';
  } else {
    startDate = dateFromInput?.value || now.toISOString().split('T')[0];
    endDate = dateToInput?.value || now.toISOString().split('T')[0];
  }

  if (dateFromInput) dateFromInput.value = startDate;
  if (dateToInput) dateToInput.value = endDate;

  if (bannerSubtitle) {
    bannerSubtitle.innerText = `Período desde ${startDate} hasta ${endDate}`;
  }

  // Obtener datos (desde Supabase o desde memoria local)
  let scanRecords = [];

  if (AppState.supabaseConnected && AppState.supabaseClient) {
    try {
      const { data, error } = await AppState.supabaseClient
        .from('registros_cajas')
        .select('*')
        .gte('fecha_dia', startDate)
        .lte('fecha_dia', endDate)
        .order('fecha_hora', { ascending: true });

      if (!error && data) {
        scanRecords = data;
      }
    } catch (e) {
      console.warn('Error calculando liquidación en Supabase, usando datos locales:', e);
      scanRecords = AppState.todayScans;
    }
  } else {
    scanRecords = AppState.todayScans;
  }

  // Agrupar por empleado
  const payrollByEmployee = {};

  AppState.employees.forEach(emp => {
    payrollByEmployee[emp.id || emp.codigo_empleado] = {
      employee: emp,
      boxes: 0,
      totalAmount: 0,
      firstScan: null,
      lastScan: null
    };
  });

  scanRecords.forEach(scan => {
    const targetCode = scan.codigo_empleado_extraido || extractEmpCodeFromRecord(scan);
    const matchedEmp = AppState.employees.find(e => 
      (scan.empleado_id && e.id === scan.empleado_id) ||
      (targetCode && e.codigo_empleado === targetCode) ||
      (scan.empleado_nombre_snapshot && e.nombre_completo.toLowerCase() === scan.empleado_nombre_snapshot.toLowerCase())
    );

    const empKey = matchedEmp ? (matchedEmp.id || matchedEmp.codigo_empleado) : null;
    const rateVal = (scan.tarifa_aplicada !== undefined && scan.tarifa_aplicada !== null) 
      ? parseFloat(scan.tarifa_aplicada) 
      : APP_CONFIG.TARIFA_BASE;

    if (empKey && payrollByEmployee[empKey]) {
      payrollByEmployee[empKey].boxes += 1;
      payrollByEmployee[empKey].totalAmount += rateVal;
      if (!payrollByEmployee[empKey].firstScan) payrollByEmployee[empKey].firstScan = scan.fecha_hora;
      payrollByEmployee[empKey].lastScan = scan.fecha_hora;
    } else {
      // Registro de empleado no mapeado
      const orphanKey = scan.empleado_nombre_snapshot || 'Desconocido';
      if (!payrollByEmployee[orphanKey]) {
        payrollByEmployee[orphanKey] = {
          employee: { codigo_empleado: scan.codigo_barra_leido, nombre_completo: orphanKey, dni_rut: '-' },
          boxes: 0,
          totalAmount: 0,
          firstScan: null,
          lastScan: null
        };
      }
      payrollByEmployee[orphanKey].boxes += 1;
      payrollByEmployee[orphanKey].totalAmount += rateVal;
      if (!payrollByEmployee[orphanKey].firstScan) payrollByEmployee[orphanKey].firstScan = scan.fecha_hora;
      payrollByEmployee[orphanKey].lastScan = scan.fecha_hora;
    }
  });

  let grandTotalBoxes = 0;
  let grandTotalAmount = 0;
  const rowsHtml = [];

  Object.values(payrollByEmployee)
    .sort((a, b) => b.boxes - a.boxes)
    .forEach(item => {
      grandTotalBoxes += item.boxes;
      grandTotalAmount += item.totalAmount;

      const avgRate = item.boxes > 0 ? (item.totalAmount / item.boxes).toFixed(2) : APP_CONFIG.TARIFA_BASE.toFixed(2);
      const firstStr = item.firstScan ? new Date(item.firstScan).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '-';
      const lastStr = item.lastScan ? new Date(item.lastScan).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '-';

      rowsHtml.push(`
        <tr>
          <td style="font-family:var(--font-mono); font-weight:700; color:var(--accent-primary);">${escapeHtml(item.employee.codigo_empleado)}</td>
          <td style="font-weight:700; color:var(--text-primary);">${escapeHtml(item.employee.nombre_completo)}</td>
          <td>${escapeHtml(item.employee.dni_rut || '-')}</td>
          <td style="text-align:center; font-family:var(--font-mono); font-weight:800; font-size:1.1rem; color:var(--status-success);">${item.boxes}</td>
          <td style="text-align:right; font-family:var(--font-mono);">$${avgRate}</td>
          <td style="text-align:right; font-family:var(--font-mono); font-weight:800; font-size:1.15rem; color:var(--accent-primary);">$${item.totalAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
          <td style="text-align:center; font-family:var(--font-mono); font-size:0.85rem; color:var(--text-secondary);">${firstStr}</td>
          <td style="text-align:center; font-family:var(--font-mono); font-size:0.85rem; color:var(--text-secondary);">${lastStr}</td>
          <td style="text-align:right;">
            <button class="btn-primary" style="padding:0.3rem 0.6rem; font-size:0.78rem; display:inline-flex;" onclick="generateReceiptModal('${escapeHtml(item.employee.nombre_completo)}', '${escapeHtml(item.employee.codigo_empleado)}', '${escapeHtml(item.employee.dni_rut || '')}', ${item.boxes}, ${item.totalAmount}, '${startDate}', '${endDate}')">
              <i class="fa-solid fa-receipt"></i> Recibo
            </button>
          </td>
        </tr>
      `);
    });

  if (tbody) tbody.innerHTML = rowsHtml.join('');
  if (bannerTotal) bannerTotal.innerText = `$ ${grandTotalAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
  if (bannerBoxes) bannerBoxes.innerText = `${grandTotalBoxes.toLocaleString('es-AR')} cajas embaladas`;

  // Guardar cálculo para exportación
  AppState.currentPayrollData = {
    startDate,
    endDate,
    grandTotalBoxes,
    grandTotalAmount,
    items: Object.values(payrollByEmployee)
  };
}

// Exportar liquidación a CSV / Excel
function exportPayrollToCSV() {
  if (!AppState.currentPayrollData || !AppState.currentPayrollData.items) {
    showToast('Calcule primero la liquidación para exportar.', 'warning');
    return;
  }

  const { startDate, endDate, items } = AppState.currentPayrollData;
  let csvContent = 'data:text/csv;charset=utf-8,\uFEFF'; // UTF-8 BOM para tildes en Excel
  csvContent += `EMPRESA;MAGARETTO - CONTROL DE EMPAQUE Y PICKING\n`;
  csvContent += `LIQUIDACION DE PAGO A DESTAJO;DESDE ${startDate} HASTA ${endDate}\n\n`;
  csvContent += `CODIGO;EMPLEADO;DNI_RUT;TOTAL_CAJAS;TARIFA_PROMEDIO;TOTAL_A_PAGAR\n`;

  items.forEach(item => {
    const avgRate = item.boxes > 0 ? (item.totalAmount / item.boxes).toFixed(2) : '0';
    csvContent += `"${item.employee.codigo_empleado}";"${item.employee.nombre_completo}";"${item.employee.dni_rut || ''}";${item.boxes};${avgRate};${item.totalAmount.toFixed(2)}\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `MAGARETTO_Liquidacion_${startDate}_al_${endDate}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast('Planilla CSV descargada con éxito.', 'success');
}

// Generar e Imprimir Recibo Individual de Liquidación
function generateReceiptModal(empName, empCode, empDni, boxes, totalAmount, startDate, endDate) {
  const modal = document.getElementById('modalReceipt');
  const printArea = document.getElementById('receiptPrintArea');
  if (!modal || !printArea) return;

  const now = new Date();
  const dateStr = now.toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric' });
  const avgRate = boxes > 0 ? (totalAmount / boxes).toFixed(2) : APP_CONFIG.TARIFA_BASE.toFixed(2);

  printArea.innerHTML = `
    <div style="text-align:center; border-bottom:2px solid #0B1C30; padding-bottom:1rem; margin-bottom:1.5rem;">
      <h2 style="font-size:1.6rem; font-weight:900; color:#0B1C30; margin-bottom:0.25rem;">MAGARETTO</h2>
      <div style="font-size:0.9rem; font-weight:700; color:#6412D5; text-transform:uppercase; letter-spacing:0.1em;">Control de Empaque y Picking de Cajas</div>
      <div style="font-size:0.8rem; color:#64748b;">Comprobante de Pago por Trabajo a Destajo / Cajas Embaladas</div>
    </div>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-bottom:1.5rem; font-size:0.95rem;">
      <div>
        <strong style="color:#64748b; font-size:0.8rem; text-transform:uppercase; display:block;">Empacador:</strong>
        <span style="font-size:1.15rem; font-weight:800; color:#0B1C30;">${escapeHtml(empName)}</span>
      </div>
      <div>
        <strong style="color:#64748b; font-size:0.8rem; text-transform:uppercase; display:block;">Código / Identificación:</strong>
        <span style="font-family:monospace; font-weight:700; color:#0B1C30;">${escapeHtml(empCode)} ${empDni ? `| DNI: ${escapeHtml(empDni)}` : ''}</span>
      </div>
      <div>
        <strong style="color:#64748b; font-size:0.8rem; text-transform:uppercase; display:block;">Período Liquidado:</strong>
        <span>Del ${startDate} al ${endDate}</span>
      </div>
      <div>
        <strong style="color:#64748b; font-size:0.8rem; text-transform:uppercase; display:block;">Fecha de Emisión:</strong>
        <span>${dateStr}</span>
      </div>
    </div>

    <table style="width:100%; border-collapse:collapse; margin-bottom:1.5rem; font-size:0.95rem;">
      <thead>
        <tr style="background:#f1f5f9; border-bottom:2px solid #cbd5e1;">
          <th style="padding:0.75rem; text-align:left;">Concepto</th>
          <th style="padding:0.75rem; text-align:center;">Cantidad Cajas</th>
          <th style="padding:0.75rem; text-align:right;">Tarifa / Caja</th>
          <th style="padding:0.75rem; text-align:right;">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:0.75rem;">Embalaje y acondicionamiento de cabezas de ajo</td>
          <td style="padding:0.75rem; text-align:center; font-weight:800; font-size:1.1rem;">${boxes}</td>
          <td style="padding:0.75rem; text-align:right;">$${avgRate}</td>
          <td style="padding:0.75rem; text-align:right; font-weight:800; font-size:1.1rem;">$${totalAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr style="background:#f8fafc; font-size:1.2rem; font-weight:900;">
          <td colspan="3" style="padding:1rem; text-align:right; text-transform:uppercase;">Total Neto a Pagar:</td>
          <td style="padding:1rem; text-align:right; color:#059669;">$${totalAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
        </tr>
      </tfoot>
    </table>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:3rem; margin-top:3.5rem; text-align:center; font-size:0.85rem;">
      <div style="border-top:1px solid #0B1C30; padding-top:0.5rem;">
        Firma Responsable Recursos Humanos<br><strong>MAGARETTO</strong>
      </div>
      <div style="border-top:1px solid #0B1C30; padding-top:0.5rem;">
        Firma y Aclaración del Empacador<br>Recibí Conforme
      </div>
    </div>
  `;

  modal.classList.add('open');
}

// ==============================================================================
// 9. IMPRESIÓN Y MODALES
// ==============================================================================
function printSingleBarcodeCard(svgId, name, code) {
  const card = document.getElementById(`card-${svgId}`);
  if (!card) return;

  const printWindow = window.open('', '_blank', 'width=400,height=300');
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Etiqueta ${code} - MAGARETTO</title>
        <style>
          body { margin: 0; padding: 10px; font-family: sans-serif; text-align: center; }
          .tag { font-size: 11px; font-weight: bold; color: #6412D5; text-transform: uppercase; margin-bottom: 4px; }
          .name { font-size: 16px; font-weight: 900; margin-bottom: 8px; color: #000; }
          svg { width: 100%; max-height: 80px; }
        </style>
      </head>
      <body>
        <div class="tag">MAGARETTO - CONTROL DE EMPAQUE</div>
        <div class="name">${name}</div>
        ${card.querySelector('svg').outerHTML}
        <script>window.onload = function() { window.print(); window.close(); };<\/script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

function openEditEmployeeModal(empIdOrCode) {
  const emp = AppState.employees.find(e => e.id === empIdOrCode || e.codigo_empleado === empIdOrCode);
  const modal = document.getElementById('modalEmployee');
  const title = document.getElementById('modalEmployeeTitle');

  if (!modal) return;

  if (emp) {
    title.innerHTML = '<i class="fa-solid fa-user-pen"></i> Editar Empacador';
    document.getElementById('empFormId').value = emp.id || '';
    document.getElementById('empFormCode').value = emp.codigo_empleado || '';
    document.getElementById('empFormName').value = emp.nombre_completo || '';
    document.getElementById('empFormDni').value = emp.dni_rut || '';
    document.getElementById('empFormPhone').value = emp.telefono || '';
    document.getElementById('empFormRate').value = emp.tarifa_personalizada || '';
    document.getElementById('empFormActive').checked = emp.activo !== false;
  } else {
    title.innerHTML = '<i class="fa-solid fa-user-plus"></i> Nuevo Empacador';
    document.getElementById('employeeForm').reset();
    document.getElementById('empFormId').value = '';
    // Sugerir nuevo código secuencial de 4 dígitos (ej: 0105)
    const nextNum = AppState.employees.length + 101;
    document.getElementById('empFormCode').value = String(nextNum).padStart(4, '0');
  }

  modal.classList.add('open');
}

// ==============================================================================
// 9B. CONTROLADOR DE AUTENTICACIÓN Y ROLES (RBAC)
// ==============================================================================
function switchTab(targetTabId) {
  const tabs = document.querySelectorAll('.nav-tab');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach(b => {
    if (b.dataset.tab === targetTabId) {
      b.classList.add('active');
    } else {
      b.classList.remove('active');
    }
  });

  contents.forEach(c => {
    if (c.id === targetTabId) {
      c.classList.add('active');
      c.style.display = (c.id === 'tab-scanner') ? 'flex' : 'block';
    } else {
      c.classList.remove('active');
      c.style.display = 'none';
    }
  });

  AppState.activeTab = targetTabId;

  // Actualizar Título y Subtítulo en Topbar Superior (AGENTS.md)
  const TAB_META = {
    'tab-scanner': { title: 'Estación Escáner', subtitle: 'Sistema de Registro de Cajas y Liquidación de Destajo' },
    'tab-waste': { title: 'Control de Descarte', subtitle: 'Registro y auditoría de cajas de descarte manual' },
    'tab-dashboard': { title: 'Tablero / Dashboard', subtitle: 'Métricas generales, avances y gráficos de empaque' },
    'tab-employees': { title: 'Padrón de Personal', subtitle: 'Gestión de empacadores y tarifas personalizadas' },
    'tab-production': { title: 'Producción en Vivo', subtitle: 'Monitoreo en tiempo real por calidad, envase y turno' },
    'tab-payroll': { title: 'Liquidación RRHH', subtitle: 'Resumen de jornales y pagos de Recursos Humanos' },
    'tab-users': { title: 'Usuarios del Sistema', subtitle: 'Control de accesos y roles de seguridad' },
    'tab-settings': { title: 'Configuración Operativa', subtitle: 'Ajustes de jornada, envases y parámetros del sistema' }
  };

  const meta = TAB_META[targetTabId];
  if (meta) {
    const titleEl = document.getElementById('topbarPageTitle');
    const subEl = document.getElementById('topbarPageSubtitle');
    if (titleEl) titleEl.textContent = meta.title;
    if (subEl) subEl.textContent = meta.subtitle;
  }

  // Cerrar drawer móvil si está abierto
  const sidebar = document.getElementById('appSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (sidebar && sidebar.classList.contains('mobile-open')) {
    sidebar.classList.remove('mobile-open');
    if (backdrop) backdrop.classList.remove('active');
  }

  if (targetTabId === 'tab-scanner') {
    const barcodeInput = document.getElementById('barcodeInput');
    if (barcodeInput) barcodeInput.focus();
  } else if (targetTabId === 'tab-waste') {
    if (typeof DescarteManager !== 'undefined') DescarteManager.renderView();
  } else if (targetTabId === 'tab-dashboard') {
    DashboardManager.renderView();
  } else if (targetTabId === 'tab-payroll') {
    calculatePayroll();
  } else if (targetTabId === 'tab-production') {
    renderProductionCharts();
  } else if (targetTabId === 'tab-users') {
    renderUsersTable();
  }
}

// Inicializador de la Barra Lateral Colapsable y Responsive (AGENTS.md)
function initSidebarController() {
  const sidebar = document.getElementById('appSidebar');
  const btnCollapse = document.getElementById('btnCollapseSidebar');
  const btnExpand = document.getElementById('btnExpandSidebar');
  const btnMobile = document.getElementById('btnMobileToggle');
  const backdrop = document.getElementById('sidebarBackdrop');

  const syncAriaExpanded = (compact) => {
    if (btnCollapse) btnCollapse.setAttribute('aria-expanded', String(!compact));
    if (btnExpand) btnExpand.setAttribute('aria-expanded', String(!compact));
  };

  // Recuperar preferencia de barra compacta guardada en localStorage
  const isCompact = localStorage.getItem('magaretto_sidebar_compact') === 'true';
  if (isCompact && sidebar && window.innerWidth > 768) {
    sidebar.classList.add('compact');
    syncAriaExpanded(true);
  } else {
    syncAriaExpanded(false);
  }

  // Contraer menú
  if (btnCollapse) {
    btnCollapse.addEventListener('click', () => {
      if (sidebar) {
        sidebar.classList.add('compact');
        localStorage.setItem('magaretto_sidebar_compact', 'true');
        syncAriaExpanded(true);
      }
    });
  }

  // Expandir menú
  if (btnExpand) {
    btnExpand.addEventListener('click', () => {
      if (sidebar) {
        sidebar.classList.remove('compact');
        localStorage.setItem('magaretto_sidebar_compact', 'false');
        syncAriaExpanded(false);
      }
    });
  }

  // Menú móvil (abrir drawer)
  if (btnMobile) {
    btnMobile.addEventListener('click', () => {
      if (sidebar) sidebar.classList.add('mobile-open');
      if (backdrop) backdrop.classList.add('active');
    });
  }

  // Cerrar drawer móvil al tocar el fondo oscuro
  if (backdrop) {
    backdrop.addEventListener('click', () => {
      if (sidebar) sidebar.classList.remove('mobile-open');
      backdrop.classList.remove('active');
    });
  }
}

// ==============================================================================
// CONTROLADOR DE TEMA CLARO / OSCURO (THEME MANAGER)
// ==============================================================================
const ThemeManager = {
  storageKey: 'magaretto_theme',

  init() {
    const btnToggle = document.getElementById('btnThemeToggle');
    const saved = localStorage.getItem(this.storageKey);
    // Preferencia guardada o por defecto dark (estilo Bento Telemetry)
    const initialTheme = (saved === 'light') ? 'light' : 'dark';
    
    this.applyTheme(initialTheme);

    if (btnToggle) {
      btnToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        const newTheme = (currentTheme === 'dark') ? 'light' : 'dark';
        this.applyTheme(newTheme);
        showToast(newTheme === 'dark' ? 'Modo oscuro activado' : 'Modo claro activado', 'info');
      });
    }
  },

  applyTheme(theme) {
    const isDark = (theme === 'dark');
    document.documentElement.setAttribute('data-theme', theme);
    if (isDark) {
      document.documentElement.classList.add('dark-theme');
      document.body.classList.add('dark-theme');
    } else {
      document.documentElement.classList.remove('dark-theme');
      document.body.classList.remove('dark-theme');
    }

    try {
      localStorage.setItem(this.storageKey, theme);
    } catch (_) {}

    // Actualizar icono, texto y tooltip accesible del botón
    const icon = document.getElementById('themeToggleIcon');
    const text = document.getElementById('themeToggleText');
    const btn = document.getElementById('btnThemeToggle');

    if (icon) {
      icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    }
    if (text) {
      text.textContent = isDark ? 'Modo Claro' : 'Modo Oscuro';
    }
    if (btn) {
      const label = isDark ? 'Cambiar a Modo Claro' : 'Cambiar a Modo Oscuro';
      btn.title = label;
      btn.setAttribute('aria-label', label);
    }
  }
};

const AuthManager = {
  sessionKey: 'vete_auth_session_v1',

  async init() {
    const loginForm = document.getElementById('loginForm');
    const btnToggleEye = document.getElementById('btnTogglePassword');
    const btnLogout = document.getElementById('btnLogout');

    if (btnToggleEye) {
      btnToggleEye.addEventListener('click', () => {
        const pwdInput = document.getElementById('loginPassword');
        const icon = document.getElementById('eyeIcon');
        if (pwdInput.type === 'password') {
          pwdInput.type = 'text';
          icon.className = 'fa-solid fa-eye-slash';
        } else {
          pwdInput.type = 'password';
          icon.className = 'fa-solid fa-eye';
        }
      });
    }

    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const userVal = document.getElementById('loginUsername').value.trim();
        const pwdVal = document.getElementById('loginPassword').value;
        await this.login(userVal, pwdVal);
      });
    }

    if (btnLogout) {
      btnLogout.addEventListener('click', () => {
        if (confirm('¿Cerrar sesión de MAGARETTO?')) {
          this.logout();
        }
      });
    }

    // Verificar si hay sesión guardada en localStorage
    const saved = localStorage.getItem(this.sessionKey);
    if (saved) {
      try {
        const parsedUser = JSON.parse(saved);
        if (parsedUser && parsedUser.username && parsedUser.rol) {
          this.applyUserSession(parsedUser);
          return;
        }
      } catch (e) {
        console.warn('Error leyendo sesión guardada:', e);
      }
    }

    // Si no hay sesión, mostrar pantalla de login
    this.showLoginOverlay();
  },

  showLoginOverlay() {
    const overlay = document.getElementById('authLoginOverlay');
    if (overlay) {
      overlay.classList.remove('hidden');
      const userIn = document.getElementById('loginUsername');
      const passIn = document.getElementById('loginPassword');
      if (userIn) userIn.value = '';
      if (passIn) passIn.value = '';
      const errBox = document.getElementById('loginErrorAlert');
      if (errBox) errBox.style.display = 'none';
      setTimeout(() => userIn && userIn.focus(), 150);
    }
    const chip = document.getElementById('userSessionChip');
    if (chip) chip.style.display = 'none';
  },

  async login(username, password) {
    const submitBtn = document.getElementById('btnSubmitLogin');

    if (!username || !password) {
      this.showLoginError('Por favor ingrese usuario y contraseña.');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verificando...';
    }

    try {
      const inputHash = await hashPassword(password);
      const ADMIN_HASHES = [
        '8fb05ad764196bb1ebd6305e1242cea66965e52f0584ad54db39d85596c7c219', // magaretto2026
        '6051fc84a7a0d74c225fb18a496b09952da5642e60723ecae543298edd7d82d6', // admin2026
        'e9d504cb733426a5d09933cd0160c830bb71b49228307bc3c165c34358c75828', // vete2026
        '9a83a7d854850a8b542ab432d5eff9cd6b3eb5797adcfa5512a67636a971d500', // agroconecta2026
        '077d1cf29426c4cda94f4134632c9d19533de0d870732519896f69ae9acdcb7f'  // agro2026
      ];
      let matchedUser = null;

      // 1. Intentar validar en Supabase si está disponible
      if (AppState.supabaseConnected && AppState.supabaseClient) {
        try {
          const { data, error } = await AppState.supabaseClient
            .from('usuarios_sistema')
            .select('*')
            .ilike('username', username.trim())
            .eq('activo', true);

          if (!error && data && data.length > 0) {
            const found = data.find(u => {
              if (u.username.toLowerCase() === 'admin' && ADMIN_HASHES.includes(inputHash)) return true;
              return u.password_hash === inputHash;
            });
            if (found) matchedUser = found;
          }
        } catch (e) {
          console.warn('Error validando en Supabase, usando respaldo local:', e);
        }
      }

      // 2. Si no se encontró en Supabase o estamos offline, probar contra la lista en memoria/defaults
      if (!matchedUser) {
        const pool = AppState.users && AppState.users.length > 0 ? AppState.users : DEFAULT_SYSTEM_USERS;
        matchedUser = pool.find(u => {
          if (u.username.toLowerCase() !== username.trim().toLowerCase() || u.activo === false) return false;
          if (u.username.toLowerCase() === 'admin' && ADMIN_HASHES.includes(inputHash)) return true;
          return u.password_hash === inputHash;
        });
      }

      if (matchedUser) {
        this.applyUserSession(matchedUser);
        showToast(`Bienvenido/a, ${matchedUser.nombre_completo} (${matchedUser.rol})`, 'success');
      } else {
        this.showLoginError('Usuario o contraseña incorrectos, o usuario inactivo.');
      }
    } catch (err) {
      console.error('Error durante el inicio de sesión:', err);
      this.showLoginError('Error verificando credenciales.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Iniciar Sesión';
      }
    }
  },

  showLoginError(msg) {
    const errBox = document.getElementById('loginErrorAlert');
    if (errBox) {
      errBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>${escapeHtml(msg)}</span>`;
      errBox.style.display = 'flex';
    }
  },

  applyUserSession(user) {
    AppState.currentUser = user;
    localStorage.setItem(this.sessionKey, JSON.stringify(user));

    // Ocultar pantalla de login
    const overlay = document.getElementById('authLoginOverlay');
    if (overlay) overlay.classList.add('hidden');

    // Actualizar datos del usuario en la barra superior
    const chip = document.getElementById('userSessionChip');
    const nameEl = document.getElementById('sessionUserName');
    const roleEl = document.getElementById('sessionUserRole');

    if (chip) chip.style.display = 'flex';
    if (nameEl) nameEl.innerText = user.nombre_completo || user.username;
    if (roleEl) {
      roleEl.innerText = user.rol;
      roleEl.className = `user-session-role role-${(user.rol || 'usuario').toLowerCase()}`;
    }

    // Aplicar permisos según el rol
    this.applyRolePermissions(user.rol);

    // Si es Administrador, cargar usuarios del sistema
    if (user.rol === 'Administrador') {
      DB.loadUsers();
    }
  },

  applyRolePermissions(role) {
    const tabs = document.querySelectorAll('.nav-tab[data-roles]');
    let currentTabAllowed = false;

    tabs.forEach(btn => {
      const allowed = (btn.dataset.roles || '').split(',').map(r => r.trim());
      if (allowed.includes(role)) {
        btn.style.display = '';
        if (btn.dataset.tab === AppState.activeTab) {
          currentTabAllowed = true;
        }
      } else {
        btn.style.display = 'none';
      }
    });

    const operatorView = document.getElementById('operatorScannerView');
    const execView = document.getElementById('executiveStationView');
    const kpiStrip = document.querySelector('.kpi-compact-strip');
    const tabScannerBtn = document.querySelector('.nav-tab[data-tab="tab-scanner"]');
    const audioControls = document.querySelector('.audio-controls');

    const currentCount = document.getElementById('navScannerBadge')?.textContent || '0';
    if (role === 'Ejecutivo') {
      if (operatorView) operatorView.style.display = 'none';
      if (execView) execView.style.display = 'flex';
      if (kpiStrip) kpiStrip.style.display = 'none';
      if (audioControls) audioControls.style.display = 'none';
      if (tabScannerBtn) {
        tabScannerBtn.title = 'Monitoreo Ejecutivo';
        tabScannerBtn.innerHTML = `<span class="nav-tab-main"><i class="fa-solid fa-chart-pie"></i><span class="nav-tab-label">Monitoreo Ejecutivo</span></span><span class="nav-tab-side"><span class="nav-tab-badge" id="navScannerBadge">${escapeHtml(currentCount)}</span><kbd class="ui-kbd">⌘1</kbd></span>`;
      }
    } else {
      if (operatorView) operatorView.style.display = '';
      if (execView) execView.style.display = 'none';
      if (kpiStrip) kpiStrip.style.display = '';
      if (audioControls) audioControls.style.display = '';
      if (tabScannerBtn) {
        tabScannerBtn.title = 'Estación Escáner';
        tabScannerBtn.innerHTML = `<span class="nav-tab-main"><i class="fa-solid fa-barcode"></i><span class="nav-tab-label">Estación Escáner</span></span><span class="nav-tab-side"><span class="nav-tab-badge" id="navScannerBadge">${escapeHtml(currentCount)}</span><kbd class="ui-kbd">⌘1</kbd></span>`;
      }
    }

    // Ocultar grupos de la barra lateral que no tengan ítems visibles
    document.querySelectorAll('.sidebar-group').forEach(group => {
      const hasVisible = Array.from(group.querySelectorAll('.nav-tab')).some(t => t.style.display !== 'none');
      group.style.display = hasVisible ? '' : 'none';
    });

    // Si el rol actual no tiene acceso a la pestaña que estaba activa, llevar a Estación Escáner
    if (!currentTabAllowed) {
      switchTab('tab-scanner');
    }

    // Actualizar tableros inmediatamente con la vista apropiada
    updateAllDashboardStats();
  },

  logout() {
    localStorage.removeItem(this.sessionKey);
    AppState.currentUser = null;
    this.showLoginOverlay();
    switchTab('tab-scanner');
    showToast('Sesión cerrada correctamente.', 'info');
  }
};

// ==============================================================================
// 9C. RENDERIZADO Y CONTROL DEL MÓDULO DE USUARIOS (SOLO ADMINISTRADOR)
// ==============================================================================
function renderUsersTable() {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  const usersList = AppState.users.length > 0 ? AppState.users : DEFAULT_SYSTEM_USERS;

  if (usersList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; padding:2rem; color:var(--text-muted);">
          <i class="fa-solid fa-users-slash" style="font-size:1.5rem; margin-bottom:0.5rem; display:block;"></i>
          No hay usuarios registrados.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = usersList.map(u => {
    const roleClass = `role-${(u.rol || 'usuario').toLowerCase()}`;
    const isSelf = AppState.currentUser && AppState.currentUser.username.toLowerCase() === (u.username || '').toLowerCase();
    const createdDate = u.created_at ? new Date(u.created_at).toLocaleDateString('es-AR') : '-';

    return `
      <tr>
        <td>
          <strong style="font-family:var(--font-mono); color:var(--accent-primary); font-size:0.95rem;">${escapeHtml(u.username)}</strong>
          ${isSelf ? '<span class="badge" style="background:var(--accent-light); color:var(--accent-primary); border:1px solid rgba(100,18,213,0.2); font-size:0.65rem; margin-left:0.4rem; font-weight:800; padding:0.15rem 0.5rem; border-radius:12px;">TU SESIÓN</span>' : ''}
        </td>
        <td><strong style="color:var(--text-primary);">${escapeHtml(u.nombre_completo)}</strong></td>
        <td>
          <span class="role-badge ${roleClass}">${escapeHtml(u.rol)}</span>
        </td>
        <td>
          <span class="status-chip ${u.activo !== false ? 'active' : 'inactive'}">
            <span class="dot"></span> ${u.activo !== false ? 'Activo' : 'Inactivo'}
          </span>
        </td>
        <td style="color:var(--text-secondary); font-size:0.85rem;">${createdDate}</td>
        <td style="text-align:right;">
          <div style="display:inline-flex; align-items:center; justify-content:flex-end; gap:0.4rem;">
            <button class="btn-action-sm btn-edit-user" data-user-id="${u.id || u.username}" title="Editar Usuario">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            ${!isSelf ? `
              <button class="btn-action-sm ${u.activo !== false ? 'btn-warn' : 'btn-ok'} btn-toggle-user-status" data-user-id="${u.id || u.username}" title="${u.activo !== false ? 'Desactivar acceso' : 'Activar acceso'}">
                <i class="fa-solid ${u.activo !== false ? 'fa-user-xmark' : 'fa-user-check'}"></i>
              </button>
              <button class="btn-action-sm btn-delete-user" data-user-id="${u.id || u.username}" title="Eliminar Usuario">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Event Listeners de la tabla
  tbody.querySelectorAll('.btn-edit-user').forEach(btn => {
    btn.addEventListener('click', () => openEditUserModal(btn.dataset.userId));
  });

  tbody.querySelectorAll('.btn-toggle-user-status').forEach(btn => {
    btn.addEventListener('click', () => toggleUserStatus(btn.dataset.userId));
  });

  tbody.querySelectorAll('.btn-delete-user').forEach(btn => {
    btn.addEventListener('click', () => confirmDeleteUser(btn.dataset.userId));
  });
}

function openEditUserModal(userIdOrUsername) {
  const modal = document.getElementById('modalUser');
  const title = document.getElementById('modalUserTitle');
  const pwdHint = document.getElementById('userFormPasswordHint');
  const pwdInput = document.getElementById('userFormPassword');

  if (!modal) return;

  const usersList = AppState.users.length > 0 ? AppState.users : DEFAULT_SYSTEM_USERS;
  const user = userIdOrUsername ? usersList.find(u => u.id === userIdOrUsername || u.username === userIdOrUsername) : null;

  if (user) {
    title.innerHTML = '<i class="fa-solid fa-user-pen"></i> Editar Usuario';
    document.getElementById('userFormId').value = user.id || user.username;
    document.getElementById('userFormFullName').value = user.nombre_completo || '';
    document.getElementById('userFormUsername').value = user.username || '';
    document.getElementById('userFormRole').value = user.rol || 'Usuario';
    document.getElementById('userFormActive').checked = user.activo !== false;
    if (pwdInput) pwdInput.value = '';
    if (pwdHint) pwdHint.innerText = 'Dejar en blanco para mantener la contraseña actual.';
  } else {
    title.innerHTML = '<i class="fa-solid fa-user-plus"></i> Nuevo Usuario';
    document.getElementById('userForm').reset();
    document.getElementById('userFormId').value = '';
    document.getElementById('userFormRole').value = 'Usuario';
    document.getElementById('userFormActive').checked = true;
    if (pwdHint) pwdHint.innerText = 'Ingrese una contraseña segura para este usuario.';
  }

  modal.classList.add('open');
}

async function toggleUserStatus(userIdOrUsername) {
  const usersList = AppState.users.length > 0 ? AppState.users : DEFAULT_SYSTEM_USERS;
  const user = usersList.find(u => u.id === userIdOrUsername || u.username === userIdOrUsername);
  if (!user) return;

  user.activo = !user.activo;
  await DB.saveUser(user);
  showToast(`Usuario ${user.username} ${user.activo ? 'activado' : 'desactivado'}.`, 'info');
}

async function confirmDeleteUser(userIdOrUsername) {
  const usersList = AppState.users.length > 0 ? AppState.users : DEFAULT_SYSTEM_USERS;
  const user = usersList.find(u => u.id === userIdOrUsername || u.username === userIdOrUsername);
  if (!user) return;

  if (confirm(`¿Está seguro de eliminar al usuario "${user.username}" (${user.nombre_completo})?`)) {
    await DB.deleteUser(user.id || user.username);
    showToast(`Usuario ${user.username} eliminado.`, 'warning');
  }
}

// ==============================================================================
// 10. INICIALIZACIÓN DE EVENTOS Y FORMULARIOS
// ==============================================================================
function initializeApp() {
  // 0. Inicializar Autenticación y Control de Roles (RBAC)
  AuthManager.init();

  // 0B. Inicializar Controlador de Barra Lateral (AGENTS.md)
  initSidebarController();

  // 0C. Inicializar Selector de Tema Claro / Oscuro
  ThemeManager.init();

  // 0D. Inicializar Paleta de Búsqueda Rápida (⌘K / Ctrl+K) y Atajos
  SearchPaletteManager.init();

  // 0E. Inicializar Gestor Multi-Zona (3 Zonas de Marcado x 2 Escáneres)
  MultiZoneScannerManager.init();

  // 1. Inicializar Pestañas con switchTab
  document.querySelectorAll('.nav-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      const targetTabId = tabBtn.dataset.tab;
      switchTab(targetTabId);
    });
  });

  // Asegurar que la pantalla inicial sea únicamente Estación Escáner
  switchTab('tab-scanner');

  // 1B. Configuración de Cámara para Celulares y Pistola Lectora para PC
  const barcodeInput = document.getElementById('barcodeInput');
  if (barcodeInput) {
    // En celular: al ubicarse o tocar el campo de escaneo, abrir la cámara automáticamente
    barcodeInput.addEventListener('focus', (e) => {
      if (MobileCameraScanner.isMobile()) {
        e.preventDefault();
        barcodeInput.blur(); // Evita el teclado virtual táctil que cubre la pantalla
        MobileCameraScanner.open();
      }
    });

    barcodeInput.addEventListener('click', (e) => {
      if (MobileCameraScanner.isMobile()) {
        e.preventDefault();
        barcodeInput.blur();
        MobileCameraScanner.open();
      }
    });
  }

  // Botón manual de cámara en la barra de escaneo
  const btnOpenCam = document.getElementById('btnOpenMobileCamera');
  if (btnOpenCam) {
    btnOpenCam.addEventListener('click', () => {
      MobileCameraScanner.open();
    });
  }

  // Controles del modal de cámara
  const btnCloseCam = document.getElementById('btnCloseCameraModal');
  const btnCancelCam = document.getElementById('btnCancelCamera');
  if (btnCloseCam) btnCloseCam.addEventListener('click', () => MobileCameraScanner.close());
  if (btnCancelCam) btnCancelCam.addEventListener('click', () => MobileCameraScanner.close());

  const btnToggleTorch = document.getElementById('btnToggleTorch');
  if (btnToggleTorch) btnToggleTorch.addEventListener('click', () => MobileCameraScanner.toggleTorch());

  const btnSwitchCam = document.getElementById('btnSwitchCamera');
  if (btnSwitchCam) btnSwitchCam.addEventListener('click', () => MobileCameraScanner.switchCamera());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && MobileCameraScanner.isScanning) {
      MobileCameraScanner.close();
    }
  });

  // Modal y Gestión de Usuarios (Exclusivo Administrador)
  const userForm = document.getElementById('userForm');
  const modalUser = document.getElementById('modalUser');
  const btnCloseUserModal = document.getElementById('btnCloseUserModal');
  const btnCancelUserModal = document.getElementById('btnCancelUserModal');
  const btnNewUserModal = document.getElementById('btnNewUserModal');

  if (btnNewUserModal) {
    btnNewUserModal.addEventListener('click', () => openEditUserModal(null));
  }

  [btnCloseUserModal, btnCancelUserModal].forEach(b => {
    if (b) b.addEventListener('click', () => modalUser && modalUser.classList.remove('open'));
  });

  if (userForm) {
    userForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const userId = document.getElementById('userFormId').value;
      const fullName = document.getElementById('userFormFullName').value.trim();
      const username = document.getElementById('userFormUsername').value.trim();
      const role = document.getElementById('userFormRole').value;
      const password = document.getElementById('userFormPassword').value;
      const active = document.getElementById('userFormActive').checked;

      if (!username || !fullName) {
        showToast('Nombre completo y usuario son obligatorios.', 'error');
        return;
      }

      if (!userId && (!password || password.length < 4)) {
        showToast('Ingrese una contraseña de al menos 4 caracteres.', 'error');
        return;
      }

      const userData = {
        id: userId || undefined,
        username: username,
        nombre_completo: fullName,
        rol: role,
        activo: active
      };

      if (password && password.trim().length > 0) {
        userData.password_hash = await hashPassword(password);
      }

      await DB.saveUser(userData);
      modalUser.classList.remove('open');
      showToast(`Usuario ${username} guardado correctamente.`, 'success');
    });
  }

  // Alternador de Pestañas en el Panel Lateral (Acumulado vs En Vivo)
  const btnTabEmpAccum = document.getElementById('btnTabEmpAccum');
  const btnTabLiveFeed = document.getElementById('btnTabLiveFeed');
  const empAccumList = document.getElementById('empAccumulatedList');
  const liveScansList = document.getElementById('liveScansList');

  if (btnTabEmpAccum && btnTabLiveFeed && empAccumList && liveScansList) {
    btnTabEmpAccum.addEventListener('click', () => {
      btnTabEmpAccum.classList.add('active');
      btnTabLiveFeed.classList.remove('active');
      empAccumList.style.display = 'block';
      liveScansList.style.display = 'none';
    });

    btnTabLiveFeed.addEventListener('click', () => {
      btnTabLiveFeed.classList.add('active');
      btnTabEmpAccum.classList.remove('active');
      liveScansList.style.display = 'block';
      empAccumList.style.display = 'none';
    });
  }

  // 2. Control de Volumen y Sonido Beep
  const volumeSlider = document.getElementById('volumeSlider');
  if (volumeSlider) {
    volumeSlider.value = APP_CONFIG.AUDIO_VOLUME;
    volumeSlider.addEventListener('input', (e) => {
      APP_CONFIG.AUDIO_VOLUME = parseFloat(e.target.value);
      localStorage.setItem('vete_audio_vol', APP_CONFIG.AUDIO_VOLUME);
    });
  }

  const btnTestBeep = document.getElementById('btnTestBeep');
  if (btnTestBeep) {
    btnTestBeep.addEventListener('click', () => {
      AudioPlayer.playSuccessBeep();
      showToast('🔊 Sonido de lectura correcto (1200Hz)', 'success');
    });
  }

  // 3. Formulario de Escaneo Manual / Enter
  const barcodeForm = document.getElementById('barcodeScanForm');
  if (barcodeForm && barcodeInput) {
    barcodeForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = barcodeInput.value.trim();
      if (code) {
        dispatchBarcodeBurst(code);
        barcodeInput.value = '';
      }
    });
  }

  // 4. Modal de Empleado
  const btnNewEmployee = document.getElementById('btnNewEmployeeModal');
  if (btnNewEmployee) {
    btnNewEmployee.addEventListener('click', () => openEditEmployeeModal(null));
  }

  const btnCloseEmpModal = document.getElementById('btnCloseEmployeeModal');
  const btnCancelEmpModal = document.getElementById('btnCancelEmployeeModal');
  const modalEmp = document.getElementById('modalEmployee');
  [btnCloseEmpModal, btnCancelEmpModal].forEach(b => {
    if (b) b.addEventListener('click', () => modalEmp.classList.remove('open'));
  });

  const empForm = document.getElementById('employeeForm');
  if (empForm) {
    empForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newEmpData = {
        id: document.getElementById('empFormId').value || undefined,
        codigo_empleado: document.getElementById('empFormCode').value.trim().toUpperCase(),
        nombre_completo: document.getElementById('empFormName').value.trim(),
        dni_rut: document.getElementById('empFormDni').value.trim(),
        telefono: document.getElementById('empFormPhone').value.trim(),
        tarifa_personalizada: parseFloat(document.getElementById('empFormRate').value) || null,
        activo: document.getElementById('empFormActive').checked
      };

      await DB.saveEmployee(newEmpData);
      modalEmp.classList.remove('open');
      showToast(`Empacador ${newEmpData.nombre_completo} guardado.`, 'success');
    });
  }

  // 5. Modal de Registro Manual
  const btnManualModal = document.getElementById('btnManualRegisterModal');
  const modalManual = document.getElementById('modalManualScan');
  const btnCloseManual = document.getElementById('btnCloseManualModal');
  const btnCancelManual = document.getElementById('btnCancelManualModal');
  const manualForm = document.getElementById('manualScanForm');

  if (btnManualModal && modalManual) {
    btnManualModal.addEventListener('click', () => {
      populateEmployeeSelects();
      modalManual.classList.add('open');
    });
  }

  [btnCloseManual, btnCancelManual].forEach(b => {
    if (b) b.addEventListener('click', () => modalManual.classList.remove('open'));
  });

  if (manualForm) {
    manualForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const empSelectVal = document.getElementById('manualSelectEmployee').value;
      const zoneIdVal = document.getElementById('manualSelectZone')?.value || MultiZoneScannerManager.config.activeZoneId || 'zona_1';
      const calVal = document.getElementById('manualSelectCalidad')?.value || '000';
      const count = parseInt(document.getElementById('manualBoxCount').value) || 1;
      const reason = document.getElementById('manualReason').value;

      const emp = AppState.employees.find(e => e.id === empSelectVal || e.codigo_empleado === empSelectVal);
      if (!emp) {
        showToast('Seleccione un empacador válido.', 'error');
        return;
      }

      const zoneMeta = MultiZoneScannerManager.getZoneMeta(zoneIdVal) || MultiZoneScannerManager.ZONES[0];
      const empCode4 = String(emp.codigo_empleado || '').replace(/\D/g, '').padStart(4, '0').substring(0, 4);
      const reasonText = reason || 'Etiqueta ilegible / manual';
      for (let i = 0; i < count; i++) {
        // Generar código de 7 dígitos VETE [3d Calidad 000/002/003][4d Emp]
        const manualBarcode = `${calVal}${empCode4}`;
        handleBarcodeScanned(manualBarcode, {
          isManual: true,
          zoneId: zoneMeta.id,
          scannerId: zoneMeta.scanners[0],
          origenDispositivo: `Manual · ${zoneMeta.name} (${reasonText})`,
          ignoreDuplicate: true
        });
      }

      modalManual.classList.remove('open');
      showToast(`Colocadas ${count} cajas manualmente en ${zoneMeta.name} para ${emp.nombre_completo}.`, 'success');
    });
  }

  // 6. Recibo de Pago Modal Print
  const btnCloseReceipt = document.getElementById('btnCloseReceiptModal');
  const btnCancelReceipt = document.getElementById('btnCancelReceiptModal');
  const modalReceipt = document.getElementById('modalReceipt');
  const btnPrintReceipt = document.getElementById('btnPrintReceiptBtn');

  [btnCloseReceipt, btnCancelReceipt].forEach(b => {
    if (b) b.addEventListener('click', () => modalReceipt.classList.remove('open'));
  });

  if (btnPrintReceipt) {
    btnPrintReceipt.addEventListener('click', () => {
      window.print();
    });
  }

  // 7. Filtros de Liquidación
  const payrollPeriodSelect = document.getElementById('payrollPeriodSelect');
  if (payrollPeriodSelect) {
    payrollPeriodSelect.addEventListener('change', (e) => calculatePayroll(e.target.value));
  }

  const btnApplyPayroll = document.getElementById('btnApplyPayrollFilter');
  if (btnApplyPayroll) {
    btnApplyPayroll.addEventListener('click', () => calculatePayroll('personalizado'));
  }

  const btnExportCSV = document.getElementById('btnExportPayrollCSV');
  if (btnExportCSV) {
    btnExportCSV.addEventListener('click', exportPayrollToCSV);
  }

  const btnPrintPayroll = document.getElementById('btnPrintPayrollReport');
  if (btnPrintPayroll) {
    btnPrintPayroll.addEventListener('click', () => window.print());
  }

  // 7B. Filtros de Monitor de Producción
  ['prodFilterPeriod', 'prodFilterTurno', 'prodSortBy'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => renderProductionCharts());
  });

  // 8. Búsqueda de Empleados
  const searchInput = document.getElementById('employeeSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', renderEmployeesTable);
  }

  // 9. Configuración de Parámetros
  const btnSaveParams = document.getElementById('btnSaveParamsConfig');
  if (btnSaveParams) {
    btnSaveParams.addEventListener('click', () => {
      APP_CONFIG.TARIFA_BASE = parseFloat(document.getElementById('cfgTarifaBase').value) || 150.00;
      APP_CONFIG.TOLERANCIA_DUPLICADO_SEG = parseInt(document.getElementById('cfgToleranciaDuplicado').value) || 5;
      APP_CONFIG.LINEA_EMPAQUE = document.getElementById('cfgLineaEmpaque').value || 'Línea 1';

      localStorage.setItem('agroconecta_tarifa_base', APP_CONFIG.TARIFA_BASE);
      localStorage.setItem('agroconecta_tolerancia_dup', APP_CONFIG.TOLERANCIA_DUPLICADO_SEG);
      localStorage.setItem('agroconecta_linea', APP_CONFIG.LINEA_EMPAQUE);
      localStorage.setItem('vete_tarifa_base', APP_CONFIG.TARIFA_BASE);
      localStorage.setItem('vete_tolerancia_dup', APP_CONFIG.TOLERANCIA_DUPLICADO_SEG);
      localStorage.setItem('vete_linea', APP_CONFIG.LINEA_EMPAQUE);

      const chkModoPrueba = document.getElementById('cfgModoPrueba');
      if (chkModoPrueba) {
        setTestMode(chkModoPrueba.checked);
      }

      updateAllDashboardStats();
      showToast('Parámetros de operación guardados correctamente.', 'success');
    });
  }

  // 10. Diagnóstico y Pruebas en Configuración
  const btnTestSupabase = document.getElementById('btnTestSupabaseConnection');
  if (btnTestSupabase) {
    btnTestSupabase.addEventListener('click', async () => {
      showToast('Probando conexión con la base de datos...', 'warning');
      const ok = await DB.testConnection();
      if (ok) showToast('✅ Base de datos conectada en tiempo real.', 'success');
    });
  }

  const btnTestBeepSettings = document.getElementById('btnTestBeepSettings');
  if (btnTestBeepSettings) {
    btnTestBeepSettings.addEventListener('click', () => {
      SoundSynth.playSuccessBeep();
      showToast('🔊 Beep emitido con éxito.', 'success');
    });
  }

  // 11. Control del Cartel Modal de Alerta de Duplicado
  const btnDismissDup = document.getElementById('btnDismissDuplicateAlert');
  const modalDup = document.getElementById('duplicateAlertModal');
  if (btnDismissDup) {
    btnDismissDup.addEventListener('click', () => dismissDuplicateAlertModal());
  }
  if (modalDup) {
    modalDup.addEventListener('click', (e) => {
      if (e.target === modalDup) dismissDuplicateAlertModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Escape' || e.key === 'Enter') && modalDup && modalDup.style.display === 'flex') {
      e.preventDefault();
      dismissDuplicateAlertModal();
    }
  });

  // 12. Inicializar Opciones de Envase de Jornada (Primera y Segunda)
  PackingOptions.init();

  // 12B. Inicializar Gestor de Descarte Manual
  if (typeof DescarteManager !== 'undefined') {
    DescarteManager.init();
  }

  // 12C. Inicializar Tablero / Dashboard
  if (typeof DashboardManager !== 'undefined') {
    DashboardManager.init();
  }

  // 12D. Inicializar MODO DE PRUEBA (Aceptar cualquier código de barra)
  initTestModeControls();

  // Cargar escaneos del día
  DB.loadTodayScans();

  // Inicializar Gestor de Instalación PWA (Botón flotante en Celular y PC)
  PwaInstallManager.init();

  // Registro de Service Worker para PWA (Instalación en Celulares Android / iOS)
  if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => {
        console.log('PWA Service Worker registrado correctamente.');
        reg.update();
      })
      .catch((err) => console.warn('Error registrando Service Worker:', err));
  }
}

// Inicialización segura garantizada (si el DOM ya cargó, iniciar de inmediato)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}

// ==============================================================================
// 12. GESTOR DE INSTALACIÓN PWA (PROMPT DE INSTALACIÓN EN PC & CELULARES)
// ==============================================================================
const PwaInstallManager = {
  deferredPrompt: null,

  init() {
    const container = document.getElementById('pwaFloatingContainer');
    const btnInstall = document.getElementById('btnPwaInstall');
    const btnDismiss = document.getElementById('btnPwaDismiss');
    const modalIos = document.getElementById('modalIosInstall');
    const btnCloseIos = document.getElementById('btnCloseIosModal');
    const btnUnderstandIos = document.getElementById('btnUnderstandIos');

    if (!container || !btnInstall) return;

    // Verificar si ya está corriendo instalada como PWA (Modo Standalone)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                         window.navigator.standalone === true || 
                         document.referrer.includes('android-app://');

    if (isStandalone) {
      container.style.display = 'none';
      return;
    }

    // Verificar si el usuario la descartó en esta sesión
    if (sessionStorage.getItem('vete_pwa_dismissed') === 'true') {
      container.style.display = 'none';
    }

    // Detectar iOS / Safari
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

    // Escuchar el evento estándar de instalación (Chrome Android / Windows PC / Edge)
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      if (sessionStorage.getItem('vete_pwa_dismissed') !== 'true') {
        container.style.display = 'flex';
      }
    });

    // En iOS Safari, mostrar el botón si no está descartado
    if (isIos && !isStandalone) {
      if (sessionStorage.getItem('vete_pwa_dismissed') !== 'true') {
        container.style.display = 'flex';
      }
    }

    // Clic en el botón flotante de instalación
    btnInstall.addEventListener('click', async () => {
      if (this.deferredPrompt) {
        this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          showToast('🎉 ¡Gracias por instalar MAGARETTO!', 'success');
          container.style.display = 'none';
        }
        this.deferredPrompt = null;
      } else if (isIos) {
        if (modalIos) modalIos.style.display = 'flex';
      } else {
        showToast('Para instalar: Haz clic en el ícono de instalación (⊕) en la barra de direcciones de tu navegador.', 'info');
      }
    });

    // Botón de descartar/minimizar
    if (btnDismiss) {
      btnDismiss.addEventListener('click', (e) => {
        e.stopPropagation();
        container.style.display = 'none';
        sessionStorage.setItem('vete_pwa_dismissed', 'true');
      });
    }

    // Cerrar modal iOS
    if (btnCloseIos) btnCloseIos.addEventListener('click', () => { if (modalIos) modalIos.style.display = 'none'; });
    if (btnUnderstandIos) btnUnderstandIos.addEventListener('click', () => { if (modalIos) modalIos.style.display = 'none'; });

    // Cuando la app se instala con éxito
    window.addEventListener('appinstalled', () => {
      container.style.display = 'none';
      showToast('✅ Aplicación instalada correctamente.', 'success');
      this.deferredPrompt = null;
    });
  }
};

// ==============================================================================
// ==============================================================================
// 12B. GESTOR DE DESCARTE (REGISTRO MANUAL Y AUDITORÍA DE CAJAS DESCARTADAS)
// ==============================================================================
const DescarteManager = {
  initialized: false,
  wasteRecords: [],

  saveWasteToLocalStorage() {
    try {
      localStorage.setItem('vete_waste_records', JSON.stringify(this.wasteRecords || []));
    } catch (_) {}
  },

  loadWasteFromLocalStorage() {
    try {
      const cached = localStorage.getItem('vete_waste_records');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}
    return [];
  },

  async loadWasteRecords() {
    if (!this.wasteRecords || this.wasteRecords.length === 0) {
      this.wasteRecords = this.loadWasteFromLocalStorage();
      this.renderTable();
    }

    if (AppState.supabaseClient && AppState.supabaseConnected) {
      try {
        const { data, error } = await AppState.supabaseClient
          .from('registros_cajas')
          .select('*')
          .or('codigo_calidad.eq.DS,codigo_calidad.eq.DESCARTE,nombre_calidad.ilike.%descarte%,origen_dispositivo.ilike.%descarte%')
          .order('fecha_hora', { ascending: false })
          .limit(100);

        if (!error && Array.isArray(data)) {
          const map = new Map();
          data.forEach(d => map.set(d.id, d));
          (this.wasteRecords || []).forEach(w => {
            if (w.id && !map.has(w.id)) map.set(w.id, w);
          });
          this.wasteRecords = Array.from(map.values()).sort((a, b) => new Date(b.fecha_hora) - new Date(a.fecha_hora));
          this.saveWasteToLocalStorage();
          this.renderTable();
          return this.wasteRecords;
        }
      } catch (e) {
        console.warn('Error cargando registros de descarte desde Supabase:', e);
      }
    }
    return this.wasteRecords;
  },

  getAllEmployees() {
    if (AppState.employees && AppState.employees.length > 0) {
      return AppState.employees;
    }
    const cached = localStorage.getItem('vete_cached_employees');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          AppState.employees = parsed;
          return parsed;
        }
      } catch (_) {}
    }
    return INITIAL_FALLBACK_EMPLOYEES;
  },

  getLocalDateString(d = new Date()) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  },

  getLocalTimeString(d = new Date()) {
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${min}`;
  },

  init() {
    if (this.initialized) return;
    this.initialized = true;

    this.setupDateAndTimeDefaults(true);
    this.populateEmployees();
    this.setupSearchFilter();
    this.setupForm();
    this.loadWasteRecords();
    this.renderTable();
  },

  setupDateAndTimeDefaults(force = false) {
    const dateInput = document.getElementById('wasteDate');
    const timeInput = document.getElementById('wasteTime');
    const todayStr = this.getLocalDateString();
    const nowTimeStr = this.getLocalTimeString();

    if (dateInput && (force || !dateInput.value)) {
      dateInput.value = todayStr;
    }
    if (timeInput && (force || !timeInput.value)) {
      timeInput.value = nowTimeStr;
    }
  },

  populateEmployees(filterText = '') {
    const select = document.getElementById('wasteEmployeeSelect');
    const matchEl = document.getElementById('wasteSearchMatchCount');
    const btnReset = document.getElementById('btnResetWasteSearch');
    if (!select) return;

    const term = (filterText || '').trim().toLowerCase();
    const allEmps = this.getAllEmployees();

    const emps = allEmps.filter(e => {
      if (e.activo === false) return false;
      if (!term) return true;
      const code = String(e.codigo_empleado || '').toLowerCase();
      const name = String(e.nombre_completo || '').toLowerCase();
      const dni = String(e.dni_rut || '').toLowerCase();
      return code.includes(term) || name.includes(term) || dni.includes(term);
    });

    if (btnReset) {
      btnReset.style.display = term ? 'block' : 'none';
    }

    if (emps.length === 0) {
      select.innerHTML = `<option value="" disabled selected>⚠️ No hay personal que coincida con "${escapeHtml(filterText)}"</option>`;
      if (matchEl) matchEl.innerHTML = `<span style="color:#ef4444;"><i class="fa-solid fa-circle-exclamation"></i> 0 personas encontradas</span>`;
      return;
    }

    const currentSelected = select.value;
    const defaultPlaceholder = term 
      ? `-- ${emps.length} personas coincidentes --`
      : `-- Seleccionar Personal (${emps.length} personas) --`;

    let optionsHtml = `<option value="" disabled ${!currentSelected ? 'selected' : ''}>${defaultPlaceholder}</option>`;
    optionsHtml += emps.map((e, idx) => {
      // Si el usuario buscó por texto, auto-seleccionar la primera coincidencia
      const isSelected = (term && idx === 0) || (currentSelected && (e.id === currentSelected || e.codigo_empleado === currentSelected));
      const dniText = e.dni_rut ? ` · DNI: ${escapeHtml(e.dni_rut)}` : '';
      return `
        <option value="${escapeHtml(e.id || e.codigo_empleado)}" ${isSelected ? 'selected' : ''}>
          [${escapeHtml(e.codigo_empleado)}] ${escapeHtml(e.nombre_completo)}${dniText}
        </option>
      `;
    }).join('');

    select.innerHTML = optionsHtml;

    if (matchEl) {
      if (term) {
        matchEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${emps.length} ${emps.length === 1 ? 'coincidencia' : 'coincidencias'}: <strong>${escapeHtml(emps[0].nombre_completo)}</strong>`;
      } else {
        matchEl.innerText = `Total: ${emps.length} empacadores en nómina`;
      }
    }
  },

  setupSearchFilter() {
    const searchInput = document.getElementById('wasteEmployeeSearch');
    const btnReset = document.getElementById('btnResetWasteSearch');
    const select = document.getElementById('wasteEmployeeSelect');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.populateEmployees(e.target.value);
      });

      // Si presionan Enter en el buscador, pasar al campo de cantidad
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const qtyInput = document.getElementById('wasteQuantity');
          if (qtyInput) qtyInput.focus();
        }
      });
    }

    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        this.populateEmployees('');
        if (searchInput) searchInput.focus();
      });
    }

    if (select) {
      select.addEventListener('change', () => {
        const val = select.value;
        const allEmps = this.getAllEmployees();
        const found = allEmps.find(emp => emp.id === val || emp.codigo_empleado === val);
        if (found && searchInput && !searchInput.value) {
          // Mantener informado al usuario
          const matchEl = document.getElementById('wasteSearchMatchCount');
          if (matchEl) {
            matchEl.innerHTML = `<i class="fa-solid fa-user-check"></i> Seleccionado: <strong>${escapeHtml(found.nombre_completo)}</strong>`;
          }
        }
      });
    }
  },

  setupForm() {
    const form = document.getElementById('formWasteEntry');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const select = document.getElementById('wasteEmployeeSelect');
      const dateInput = document.getElementById('wasteDate');
      const timeInput = document.getElementById('wasteTime');
      const qtyInput = document.getElementById('wasteQuantity');

      const empVal = select ? select.value : '';
      if (!empVal) {
        showToast('⚠️ Por favor selecciona un empacador del menú desplegable.', 'warning');
        if (select) select.focus();
        return;
      }

      const allEmps = this.getAllEmployees();
      const emp = allEmps.find(e => e.id === empVal || e.codigo_empleado === empVal);
      if (!emp) {
        showToast('⚠️ Empacador no encontrado.', 'error');
        return;
      }

      const dateStr = dateInput && dateInput.value ? dateInput.value : this.getLocalDateString();
      const timeStr = timeInput && timeInput.value ? timeInput.value : this.getLocalTimeString();
      const qty = parseInt(qtyInput ? qtyInput.value : '1', 10) || 1;

      if (qty <= 0) {
        showToast('⚠️ La cantidad debe ser al menos 1 caja.', 'warning');
        return;
      }

      // Determinar turno según hora
      const hour = parseInt(timeStr.split(':')[0], 10) || 12;
      let turno = 'Mañana';
      if (hour >= 14 && hour < 22) turno = 'Tarde';
      else if (hour >= 22 || hour < 6) turno = 'Noche';

      let timestamp;
      try {
        const fullTimeStr = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
        timestamp = new Date(`${dateStr}T${fullTimeStr}`).toISOString();
      } catch (_) {
        timestamp = new Date().toISOString();
      }

      const now = Date.now();
      const records = [];

      for (let i = 0; i < qty; i++) {
        const rec = {
          id: 'waste_' + now + '_' + i + '_' + Math.random().toString(36).substr(2, 6),
          empleado_id: emp.id,
          codigo_barra_leido: `${emp.codigo_empleado || '0000'}DESC`,
          codigo_empleado_extraido: emp.codigo_empleado || '0000',
          codigo_calidad: 'DS',
          nombre_calidad: 'Descarte',
          codigo_tipo_caja: 'DESCARTE',
          nombre_tipo_caja: 'Descarte',
          empleado_nombre_snapshot: emp.nombre_completo,
          tarifa_aplicada: 0.00,
          fecha_hora: timestamp,
          fecha_dia: dateStr,
          turno: turno,
          linea_empaque: 'Línea Descarte',
          origen_dispositivo: 'Registro Manual Descarte',
          numero_correlativo: ''
        };
        records.push(rec);
      }

      // Guardar cada registro de forma persistente en Supabase y memoria
      for (const rec of records) {
        await DB.recordScan(rec);
        this.wasteRecords.unshift(rec);
      }
      this.saveWasteToLocalStorage();

      showToast(`🗑️ Registradas ${qty} ${qty === 1 ? 'caja' : 'cajas'} de descarte para ${emp.nombre_completo}.`, 'success');

      if (qtyInput) qtyInput.value = '1';
      this.setupDateAndTimeDefaults(true); // Refresca con la hora exacta en que se da de alta
      this.renderTable();
      updateAllDashboardStats();
      
      // Recargar registros frescos de Supabase para obtener IDs oficiales y sincronizar el Tablero
      await this.loadWasteRecords();
      await DB.loadTodayScans();
      if (typeof DashboardManager !== 'undefined') {
        DashboardManager.loadDataAndRender(true);
      }
    });
  },

  renderView() {
    this.setupDateAndTimeDefaults(true); // Siempre refresca con la fecha de hoy y hora exacta actual al entrar
    this.populateEmployees();
    this.loadWasteRecords();
    this.renderTable();
  },

  renderTable() {
    const tbody = document.getElementById('wasteTableBody');
    const badge = document.getElementById('wasteCountBadge');
    if (!tbody) return;

    // Obtener registros de descarte unificando wasteRecords, todayScans y recentScans
    const allScans = [...(this.wasteRecords || []), ...AppState.todayScans, ...(AppState.recentScans || [])];
    const wasteScans = allScans.filter(s => 
      s.codigo_calidad === 'DESCARTE' || 
      s.codigo_calidad === 'DS' || 
      String(s.nombre_calidad || '').toLowerCase().includes('descarte') ||
      String(s.nombre_tipo_caja || '').toLowerCase().includes('descarte') ||
      String(s.origen_dispositivo || '').toLowerCase().includes('descarte')
    );

    // Desduplicar por ID
    const uniqueMap = new Map();
    wasteScans.forEach(s => {
      if (s.id) uniqueMap.set(s.id, s);
    });
    const uniqueWaste = Array.from(uniqueMap.values()).sort((a, b) => new Date(b.fecha_hora) - new Date(a.fecha_hora));

    if (badge) {
      badge.innerText = `${uniqueWaste.length} ${uniqueWaste.length === 1 ? 'caja de descarte' : 'cajas de descarte'}`;
    }

    if (uniqueWaste.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
            <i class="fa-solid fa-trash-can" style="font-size: 2rem; margin-bottom: 0.5rem; display: block; opacity: 0.4;"></i>
            No hay registros de descarte cargados en esta jornada.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = uniqueWaste.slice(0, 50).map(item => {
      const d = new Date(item.fecha_hora);
      const timeStr = `${d.toLocaleDateString('es-AR')} ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
      return `
        <tr>
          <td style="font-family: var(--font-mono); font-size: 0.85rem;">${timeStr}</td>
          <td><strong style="color: var(--text-primary);">${escapeHtml(item.empleado_nombre_snapshot || '-')}</strong></td>
          <td style="font-family: var(--font-mono); color: var(--accent-primary); font-weight: 700;">${escapeHtml(item.codigo_empleado_extraido || '-')}</td>
          <td style="text-align: center; font-weight: 800; color: var(--text-primary);">1 cj</td>
          <td style="text-align: center;">
            <span class="ui-badge ui-badge-danger" style="font-weight:700;">
              <i class="fa-solid fa-trash-can"></i> DESCARTE
            </span>
          </td>
          <td style="font-size: 0.8rem; color: var(--text-secondary);">${escapeHtml(item.origen_dispositivo || 'Manual')}</td>
          <td style="text-align: center;">
            <button type="button" class="btn-action-sm btn-delete-user" onclick="DescarteManager.deleteWasteRecord('${item.id}')" title="Eliminar este registro">
              <i class="fa-solid fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  },

  async deleteWasteRecord(recordId) {
    if (!confirm('¿Deseas eliminar este registro de caja de descarte?')) return;

    this.wasteRecords = (this.wasteRecords || []).filter(s => s.id !== recordId);
    this.saveWasteToLocalStorage();
    AppState.todayScans = AppState.todayScans.filter(s => s.id !== recordId);
    if (AppState.supabaseClient && AppState.supabaseConnected) {
      try {
        await AppState.supabaseClient.from('registros_cajas').delete().eq('id', recordId);
      } catch (err) {
        console.warn('Error borrando descarte en Supabase:', err);
      }
    }
    showToast('Registro de descarte eliminado.', 'info');
    this.renderTable();
    updateAllDashboardStats();
    if (typeof DashboardManager !== 'undefined') {
      DashboardManager.refreshLiveIfActive();
    }
  }
};

// ==============================================================================
// 13. MOTOR ANALÍTICO DEL TABLERO / DASHBOARD INTEGRAL DE PICKING & ESTADÍSTICAS
// ==============================================================================
const DashboardManager = {
  cachedScans: [],
  filteredScans: [],
  isLoading: false,
  _initialized: false,
  filters: {
    period: 'este_mes',
    dateFrom: '',
    dateTo: '',
    qualities: ['000', '002', '003', 'DESCARTE'], // Todas por defecto
    boxTypes: ['Caja 10 kgs.', 'Caja 14 kgs.', 'Caja Araña', 'Descarte'], // Todos por defecto
    shift: 'todos',
    zone: 'todas',
    employees: [], // Array de códigos de empacadores seleccionados
    allEmployeesSelected: true, // Flag booleano explícito
    query: ''
  },

  getLocalDateString(d = new Date()) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  },

  getAllEmployees() {
    if (AppState.employees && AppState.employees.length > 0) {
      return AppState.employees;
    }
    const cached = localStorage.getItem('vete_cached_employees');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          AppState.employees = parsed;
          return parsed;
        }
      } catch (_) {}
    }
    return INITIAL_FALLBACK_EMPLOYEES;
  },

  init() {
    if (this._initialized) return;
    this._initialized = true;

    // 1. Selector de Período Rápido y Rango de Fechas
    const periodSelect = document.getElementById('dashFilterPeriod');
    const dateFromInput = document.getElementById('dashFilterDateFrom');
    const dateToInput = document.getElementById('dashFilterDateTo');
    const wrapFrom = document.getElementById('dashFilterFromWrap');
    const wrapTo = document.getElementById('dashFilterToWrap');

    const todayStr = this.getLocalDateString();
    if (dateFromInput) dateFromInput.value = todayStr;
    if (dateToInput) dateToInput.value = todayStr;

    this.computeDateRange('este_mes');
    if (periodSelect) periodSelect.value = 'este_mes';

    if (periodSelect) {
      periodSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        this.filters.period = val;
        if (val === 'personalizado') {
          if (wrapFrom) wrapFrom.style.display = 'flex';
          if (wrapTo) wrapTo.style.display = 'flex';
        } else {
          this.computeDateRange(val);
        }
        this.loadDataAndRender();
      });
    }

    if (dateFromInput) {
      dateFromInput.addEventListener('change', (e) => {
        this.filters.dateFrom = e.target.value;
        if (this.filters.period === 'personalizado') {
          this.loadDataAndRender();
        }
      });
    }

    if (dateToInput) {
      dateToInput.addEventListener('change', (e) => {
        this.filters.dateTo = e.target.value;
        if (this.filters.period === 'personalizado') {
          this.loadDataAndRender();
        }
      });
    }

    // 2. Filtro de Turno
    const shiftSelect = document.getElementById('dashFilterShift');
    if (shiftSelect) {
      shiftSelect.addEventListener('change', (e) => {
        this.filters.shift = e.target.value;
        this.applyFiltersAndRender();
      });
    }

    // 2B. Filtro por Zona de Marcado
    const zoneSelect = document.getElementById('dashFilterZone');
    if (zoneSelect) {
      zoneSelect.addEventListener('change', (e) => {
        this.filters.zone = e.target.value;
        this.applyFiltersAndRender();
      });
    }

    // 3. Inicializar Multi-Selects (Calidad, Tipo de Envase y Empacador con Buscador)
    this.setupMultiSelects();

    // 4. Búsqueda en Vivo (con debounce)
    const searchInput = document.getElementById('dashSearchInput');
    if (searchInput) {
      let debounceTimer = null;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          this.filters.query = e.target.value.trim().toLowerCase();
          this.applyFiltersAndRender();
        }, 180);
      });
    }

    // 5. Botones de Acción de Cabecera
    const btnRefresh = document.getElementById('btnRefreshDashboard');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        showToast('Actualizando datos del tablero...', 'info');
        this.loadDataAndRender(true);
      });
    }

    const btnExportExcel = document.getElementById('btnExportDashboardExcel');
    if (btnExportExcel) {
      btnExportExcel.addEventListener('click', () => this.exportExcel());
    }

    const btnExportCSV = document.getElementById('btnExportDashboardCSV');
    if (btnExportCSV) {
      btnExportCSV.addEventListener('click', () => this.exportCSV());
    }

    const btnPrint = document.getElementById('btnPrintDashboard');
    if (btnPrint) {
      btnPrint.addEventListener('click', () => window.print());
    }

    const btnReset = document.getElementById('btnResetDashboardFilters');
    if (btnReset) {
      btnReset.addEventListener('click', () => this.resetFilters());
    }

    this.populateEmployeeFilter();
  },

  setupMultiSelects() {
    const closeAll = () => {
      document.querySelectorAll('.dash-multiselect-dropdown.open').forEach(d => d.classList.remove('open'));
      document.querySelectorAll('.dash-multiselect-btn.open').forEach(b => b.classList.remove('open'));
    };

    const setupToggle = (btnId, dropId) => {
      const btn = document.getElementById(btnId);
      const drop = document.getElementById(dropId);
      if (btn && drop) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const wasOpen = drop.classList.contains('open');
          closeAll();
          if (!wasOpen) {
            drop.classList.add('open');
            btn.classList.add('open');
          }
        });
        drop.addEventListener('click', (e) => {
          e.stopPropagation();
        });
      }
    };

    setupToggle('btnDashFilterQuality', 'dropdownDashQuality');
    setupToggle('btnDashFilterBoxType', 'dropdownDashBoxType');
    setupToggle('btnDashFilterEmployee', 'dropdownDashEmployee');

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.dash-multiselect-wrap')) {
        closeAll();
      }
    });

    // Multi-Select Calidad
    const qualList = document.getElementById('listDashQuality');
    if (qualList) {
      qualList.addEventListener('change', () => {
        const checked = Array.from(qualList.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value);
        this.filters.qualities = checked;
        this.updateQualityLabel();
        this.applyFiltersAndRender();
      });
    }
    const btnQAll = document.getElementById('btnQualitySelectAll');
    if (btnQAll && qualList) {
      btnQAll.addEventListener('click', () => {
        qualList.querySelectorAll('input[type="checkbox"]').forEach(c => { c.checked = true; });
        this.filters.qualities = ['000', '002', '003', 'DESCARTE'];
        this.updateQualityLabel();
        this.applyFiltersAndRender();
      });
    }
    const btnQClear = document.getElementById('btnQualityClear');
    if (btnQClear && qualList) {
      btnQClear.addEventListener('click', () => {
        qualList.querySelectorAll('input[type="checkbox"]').forEach(c => { c.checked = false; });
        this.filters.qualities = [];
        this.updateQualityLabel();
        this.applyFiltersAndRender();
      });
    }

    // Multi-Select Tipo de Envase
    const boxList = document.getElementById('listDashBoxType');
    if (boxList) {
      boxList.addEventListener('change', () => {
        const checked = Array.from(boxList.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value);
        this.filters.boxTypes = checked;
        this.updateBoxTypeLabel();
        this.applyFiltersAndRender();
      });
    }
    const btnBAll = document.getElementById('btnBoxTypeSelectAll');
    if (btnBAll && boxList) {
      btnBAll.addEventListener('click', () => {
        boxList.querySelectorAll('input[type="checkbox"]').forEach(c => { c.checked = true; });
        this.filters.boxTypes = ['Caja 10 kgs.', 'Caja 14 kgs.', 'Caja Araña', 'Descarte'];
        this.updateBoxTypeLabel();
        this.applyFiltersAndRender();
      });
    }
    const btnBClear = document.getElementById('btnBoxTypeClear');
    if (btnBClear && boxList) {
      btnBClear.addEventListener('click', () => {
        boxList.querySelectorAll('input[type="checkbox"]').forEach(c => { c.checked = false; });
        this.filters.boxTypes = [];
        this.updateBoxTypeLabel();
        this.applyFiltersAndRender();
      });
    }

    // Buscador de Empacadores en Menú Desplegable
    const empSearch = document.getElementById('dashPackerSearchInput');
    const empList = document.getElementById('listDashEmployee');
    if (empSearch && empList) {
      empSearch.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        const items = empList.querySelectorAll('.dash-multiselect-item');
        items.forEach(item => {
          const code = (item.getAttribute('data-code') || '').toLowerCase();
          const name = (item.getAttribute('data-name') || '').toLowerCase();
          if (!term || code.includes(term) || name.includes(term)) {
            item.style.display = 'flex';
          } else {
            item.style.display = 'none';
          }
        });
      });
    }

    if (empList) {
      empList.addEventListener('change', () => {
        const checked = Array.from(empList.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value);
        const allEmps = this.getAllEmployees();
        this.filters.employees = checked;
        this.filters.allEmployeesSelected = (checked.length === allEmps.length);
        this.updateEmployeeLabel();
        this.applyFiltersAndRender();
      });
    }

    const btnEAll = document.getElementById('btnEmployeeSelectAll');
    if (btnEAll && empList) {
      btnEAll.addEventListener('click', () => {
        empList.querySelectorAll('.dash-multiselect-item').forEach(item => {
          if (item.style.display !== 'none') {
            const cb = item.querySelector('input[type="checkbox"]');
            if (cb) cb.checked = true;
          }
        });
        const checked = Array.from(empList.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value);
        const allEmps = this.getAllEmployees();
        this.filters.employees = checked;
        this.filters.allEmployeesSelected = true;
        this.updateEmployeeLabel();
        this.applyFiltersAndRender();
      });
    }

    const btnEClear = document.getElementById('btnEmployeeClear');
    if (btnEClear && empList) {
      btnEClear.addEventListener('click', () => {
        empList.querySelectorAll('.dash-multiselect-item').forEach(item => {
          if (item.style.display !== 'none') {
            const cb = item.querySelector('input[type="checkbox"]');
            if (cb) cb.checked = false;
          }
        });
        this.filters.employees = [];
        this.filters.allEmployeesSelected = false;
        this.updateEmployeeLabel();
        this.applyFiltersAndRender();
      });
    }
  },

  updateQualityLabel() {
    const lbl = document.getElementById('labelDashFilterQuality');
    if (!lbl) return;
    const q = this.filters.qualities || [];
    if (q.length === 0) {
      lbl.innerText = 'Ninguna seleccionada (0)';
    } else if (q.length === 4) {
      lbl.innerText = 'Todas las Calidades';
    } else {
      const names = q.map(val => {
        if (val === '000') return '1ª (000)';
        if (val === '002') return '2ª (002)';
        if (val === '003') return 'Araña (003)';
        if (val === 'DESCARTE') return 'Descarte';
        return val;
      });
      lbl.innerText = names.join(', ');
    }
  },

  updateBoxTypeLabel() {
    const lbl = document.getElementById('labelDashFilterBoxType');
    if (!lbl) return;
    const b = this.filters.boxTypes || [];
    if (b.length === 0) {
      lbl.innerText = 'Ningún envase (0)';
    } else if (b.length === 4) {
      lbl.innerText = 'Todos los Envases';
    } else {
      lbl.innerText = b.join(', ');
    }
  },

  updateEmployeeLabel() {
    const lbl = document.getElementById('labelDashFilterEmployee');
    if (!lbl) return;
    const emps = this.filters.employees || [];
    const allEmps = this.getAllEmployees();
    if (this.filters.allEmployeesSelected || (allEmps.length > 0 && emps.length === allEmps.length)) {
      lbl.innerText = 'Todos los Empacadores';
    } else if (emps.length === 0) {
      lbl.innerText = 'Ningún empacador (0)';
    } else if (emps.length === 1) {
      const emp = allEmps.find(e => e.codigo_empleado === emps[0]);
      lbl.innerText = emp ? `${emp.nombre_completo} (${emp.codigo_empleado})` : `Empacador ${emps[0]}`;
    } else {
      lbl.innerText = `${emps.length} empacadores selecc.`;
    }
  },

  populateEmployeeFilter() {
    const empList = document.getElementById('listDashEmployee');
    if (!empList) return;

    const allEmps = this.getAllEmployees();
    if (this.filters.allEmployeesSelected && this.filters.employees.length === 0) {
      this.filters.employees = allEmps.map(e => e.codigo_empleado);
    }
    const selected = new Set(this.filters.employees);

    let html = '';
    allEmps.forEach(emp => {
      const isChecked = this.filters.allEmployeesSelected || selected.has(emp.codigo_empleado);
      html += `
        <label class="dash-multiselect-item" data-code="${escapeHtml(emp.codigo_empleado)}" data-name="${escapeHtml((emp.nombre_completo || '').toLowerCase())}">
          <input type="checkbox" value="${escapeHtml(emp.codigo_empleado)}" ${isChecked ? 'checked' : ''}>
          <span class="dash-multiselect-item-badge">${escapeHtml(emp.codigo_empleado)}</span>
          <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(emp.nombre_completo)}</span>
        </label>
      `;
    });

    if (allEmps.length === 0) {
      html = '<div style="padding:0.75rem; text-align:center; color:var(--text-muted); font-size:0.8rem;">No hay empacadores registrados</div>';
    }

    empList.innerHTML = html;
    this.updateEmployeeLabel();
  },

  computeDateRange(period) {
    const today = new Date();
    const todayStr = this.getLocalDateString(today);

    let startStr = todayStr;
    let endStr = todayStr;

    if (period === 'ayer') {
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      startStr = this.getLocalDateString(yesterday);
      endStr = startStr;
    } else if (period === 'esta_semana') {
      const currentDay = today.getDay(); // 0 domingo
      const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;
      const monday = new Date(today);
      monday.setDate(today.getDate() + diffToMonday);
      startStr = this.getLocalDateString(monday);
      endStr = todayStr;
    } else if (period === 'este_mes') {
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      startStr = `${today.getFullYear()}-${mm}-01`;
      endStr = todayStr;
    } else if (period === 'ultimos_30') {
      const d30 = new Date(today);
      d30.setDate(today.getDate() - 29);
      startStr = this.getLocalDateString(d30);
      endStr = todayStr;
    } else if (period === 'todo') {
      startStr = '2024-01-01';
      endStr = todayStr;
    }

    this.filters.dateFrom = startStr;
    this.filters.dateTo = endStr;

    const fromIn = document.getElementById('dashFilterDateFrom');
    const toIn = document.getElementById('dashFilterDateTo');
    if (fromIn) fromIn.value = startStr;
    if (toIn) toIn.value = endStr;
  },

  resetFilters() {
    this.filters.period = 'este_mes';
    this.filters.qualities = ['000', '002', '003', 'DESCARTE'];
    this.filters.boxTypes = ['Caja 10 kgs.', 'Caja 14 kgs.', 'Caja Araña', 'Descarte'];
    this.filters.shift = 'todos';
    this.filters.zone = 'todas';
    this.filters.allEmployeesSelected = true;
    this.filters.employees = this.getAllEmployees().map(e => e.codigo_empleado);
    this.filters.query = '';

    const pSel = document.getElementById('dashFilterPeriod');
    if (pSel) pSel.value = 'este_mes';
    const sSel = document.getElementById('dashFilterShift');
    if (sSel) sSel.value = 'todos';
    const zSel = document.getElementById('dashFilterZone');
    if (zSel) zSel.value = 'todas';
    const sIn = document.getElementById('dashSearchInput');
    if (sIn) sIn.value = '';

    const qList = document.getElementById('listDashQuality');
    if (qList) qList.querySelectorAll('input[type="checkbox"]').forEach(c => { c.checked = true; });
    this.updateQualityLabel();

    const bList = document.getElementById('listDashBoxType');
    if (bList) bList.querySelectorAll('input[type="checkbox"]').forEach(c => { c.checked = true; });
    this.updateBoxTypeLabel();

    const empList = document.getElementById('listDashEmployee');
    if (empList) {
      empList.querySelectorAll('input[type="checkbox"]').forEach(c => { c.checked = true; });
      empList.querySelectorAll('.dash-multiselect-item').forEach(i => { i.style.display = 'flex'; });
    }
    const empSearch = document.getElementById('dashPackerSearchInput');
    if (empSearch) empSearch.value = '';
    this.updateEmployeeLabel();

    const wrapFrom = document.getElementById('dashFilterFromWrap');
    const wrapTo = document.getElementById('dashFilterToWrap');
    if (wrapFrom) wrapFrom.style.display = 'none';
    if (wrapTo) wrapTo.style.display = 'none';

    this.computeDateRange('este_mes');
    this.loadDataAndRender();
    showToast('Filtros restablecidos.', 'info');
  },

  switchToMonth() {
    this.filters.period = 'este_mes';
    const pSel = document.getElementById('dashFilterPeriod');
    if (pSel) pSel.value = 'este_mes';
    const wrapFrom = document.getElementById('dashFilterFromWrap');
    const wrapTo = document.getElementById('dashFilterToWrap');
    if (wrapFrom) wrapFrom.style.display = 'none';
    if (wrapTo) wrapTo.style.display = 'none';
    this.computeDateRange('este_mes');
    this.loadDataAndRender();
  },

  switchToAll() {
    this.filters.period = 'todo';
    const pSel = document.getElementById('dashFilterPeriod');
    if (pSel) pSel.value = 'todo';
    const wrapFrom = document.getElementById('dashFilterFromWrap');
    const wrapTo = document.getElementById('dashFilterToWrap');
    if (wrapFrom) wrapFrom.style.display = 'none';
    if (wrapTo) wrapTo.style.display = 'none';
    this.computeDateRange('todo');
    this.loadDataAndRender();
  },

  async renderView() {
    this.init();
    this.populateEmployeeFilter();
    await this.loadDataAndRender(true);
  },

  async loadDataAndRender(forceRemote = false) {
    if (this.isLoading) return;
    this.isLoading = true;

    try {
      if (this.filters.period === 'hoy' && !forceRemote && AppState.todayScans.length > 0) {
        this.cachedScans = [...AppState.todayScans];
      } else if (AppState.supabaseConnected && AppState.supabaseClient) {
        let query = AppState.supabaseClient
          .from('registros_cajas')
          .select('*')
          .gte('fecha_dia', this.filters.dateFrom)
          .lte('fecha_dia', this.filters.dateTo)
          .order('fecha_hora', { ascending: false });

        const { data, error } = await query;
        if (!error && data) {
          this.cachedScans = data;
          if (this.filters.period === 'hoy') {
            AppState.todayScans = data;
          }
        } else {
          console.warn('Error trayendo datos de Supabase para el tablero:', error);
          if (this.filters.period === 'hoy') {
            this.cachedScans = [...AppState.todayScans];
          }
        }
      } else {
        this.cachedScans = [...AppState.todayScans];
      }

      this.applyFiltersAndRender();
    } catch (err) {
      console.error('Error cargando estadísticas para el dashboard:', err);
    } finally {
      this.isLoading = false;
    }
  },

  refreshLiveIfActive() {
    if (this.filters.period === 'hoy') {
      this.cachedScans = [...AppState.todayScans];
      this.applyFiltersAndRender();
    } else {
      this.loadDataAndRender(true);
    }
  },

  applyFiltersAndRender() {
    let list = [...this.cachedScans];

    // 1. Filtro por Calidades (Multi-selección)
    if (!this.filters.qualities || this.filters.qualities.length === 0) {
      list = [];
    } else if (this.filters.qualities.length < 4) {
      list = list.filter(s => {
        const calCode = String(s.codigo_calidad || '').trim();
        const calName = String(s.nombre_calidad || '').toLowerCase();

        return this.filters.qualities.some(q => {
          if (q === '000' || q === '01') {
            return (calCode === '000' || calCode === '01' || calCode === '00' || calName.includes('primera')) && calCode !== 'DESCARTE' && calCode !== 'DS' && calCode !== '003' && calCode !== '03';
          }
          if (q === '002' || q === '02') {
            return (calCode === '002' || calCode === '02' || calName.includes('segunda')) && calCode !== 'DESCARTE' && calCode !== 'DS' && calCode !== '003' && calCode !== '03';
          }
          if (q === '003' || q === '03') {
            return calCode === '003' || calCode === '03' || calName.includes('araña') || calName.includes('arana');
          }
          if (q === 'DESCARTE' || q === 'DS') {
            return calCode === 'DESCARTE' || calCode === 'DS' || calName.includes('descarte') || String(s.nombre_tipo_caja || '').toLowerCase().includes('descarte');
          }
          return false;
        });
      });
    }

    // 2. Filtro por Tipo de Envase (Multi-selección)
    if (!this.filters.boxTypes || this.filters.boxTypes.length === 0) {
      list = [];
    } else if (this.filters.boxTypes.length < 4) {
      list = list.filter(s => {
        const boxName = String(s.nombre_tipo_caja || '').toUpperCase();
        return this.filters.boxTypes.some(bt => {
          if (bt.includes('10')) return boxName.includes('10');
          if (bt.includes('14')) return boxName.includes('14') || boxName.includes('13') || boxName.includes('20') || boxName.includes('BOLSA');
          if (bt.toLowerCase().includes('araña') || bt.toLowerCase().includes('arana')) return boxName.includes('ARAÑA') || boxName.includes('ARANA');
          if (bt.toLowerCase().includes('descarte')) return boxName.includes('DESCARTE') || String(s.codigo_calidad || '').includes('DESC');
          return false;
        });
      });
    }

    // 3. Filtro por Turno
    if (this.filters.shift !== 'todos') {
      list = list.filter(s => {
        const shift = this.resolveShift(s);
        return shift === this.filters.shift;
      });
    }

    // 3B. Filtro por Zona de Marcado
    if (this.filters.zone && this.filters.zone !== 'todas') {
      const targetZone = this.filters.zone.toLowerCase();
      list = list.filter(s => {
        const linea = String(s.linea_empaque || '').toLowerCase();
        const origen = String(s.origen_dispositivo || '').toLowerCase();
        return linea.includes(targetZone) || origen.includes(targetZone);
      });
    }

    // 4. Filtro por Empacador (Multi-selección)
    if (!this.filters.allEmployeesSelected) {
      if (!this.filters.employees || this.filters.employees.length === 0) {
        list = [];
      } else {
        const selectedCodes = new Set(this.filters.employees.map(c => String(c).toUpperCase()));
        list = list.filter(s => {
          const empCode = String(s.codigo_empleado_extraido || extractEmpCodeFromRecord(s)).toUpperCase();
          return selectedCodes.has(empCode);
        });
      }
    }

    // 5. Filtro por Búsqueda de Texto en Vivo
    if (this.filters.query) {
      const q = this.filters.query;
      list = list.filter(s => {
        const barcode = String(s.codigo_barra_leido || '').toLowerCase();
        const empName = String(s.empleado_nombre_snapshot || '').toLowerCase();
        const empCode = String(s.codigo_empleado_extraido || extractEmpCodeFromRecord(s)).toLowerCase();
        const corr = barcode.length >= 10 ? barcode.substring(6, 10) : '';
        const envase = String(s.nombre_tipo_caja || '').toLowerCase();
        return barcode.includes(q) || empName.includes(q) || empCode.includes(q) || corr.includes(q) || envase.includes(q);
      });
    }

    this.filteredScans = list;

    // Actualizar Contador en Badge
    const badge = document.getElementById('dashFilteredCountBadge');
    if (badge) {
      const word = list.length === 1 ? 'caja encontrada' : 'cajas encontradas';
      badge.innerHTML = `<i class="fa-solid fa-filter"></i> ${list.length.toLocaleString('es-AR')} ${word}`;
    }

    // Notificación inteligente si hoy está en 0 pero hay histórico guardado en Supabase
    const noticeEl = document.getElementById('dashPeriodNotice');
    if (noticeEl) {
      if (this.cachedScans.length === 0 && AppState.totalHistoricalScans > 0 && this.filters.period === 'hoy') {
        noticeEl.innerHTML = `
          <div class="ui-notice-banner">
            <div class="ui-notice-banner-text">
              <i class="fa-solid fa-circle-info"></i>
              <span>Hoy es una nueva jornada y aún no hay cajas escaneadas. Hay <strong>${AppState.totalHistoricalScans} cajas</strong> guardadas en la base de datos de este mes.</span>
            </div>
            <button type="button" class="btn-primary btn-sm" onclick="DashboardManager.switchToMonth()">
              <i class="fa-solid fa-calendar-days"></i> Ver Mes Actual (${AppState.totalHistoricalScans} cajas)
            </button>
          </div>
        `;
        noticeEl.style.display = 'block';
      } else {
        noticeEl.innerHTML = '';
        noticeEl.style.display = 'none';
      }
    }

    // Renderizar subcomponentes
    this.renderKPIs(list);
    this.renderQualityEnvaseMatrix(list);
    this.renderShiftDistribution(list);
    this.renderHourlyChart(list);
    this.renderEmployeeTable(list);
    this.renderAuditTable(list);
  },

  resolveShift(scan) {
    if (scan.turno) {
      const t = String(scan.turno).toLowerCase();
      if (t.includes('mañ') || t.includes('man')) return 'manana';
      if (t.includes('tar')) return 'tarde';
      if (t.includes('noc')) return 'noche';
    }
    const d = new Date(scan.fecha_hora || Date.now());
    const h = d.getHours();
    if (h >= 6 && h < 14) return 'manana';
    if (h >= 14 && h < 22) return 'tarde';
    return 'noche';
  },

  renderKPIs(scans) {
    const total = scans.length;

    let primeraCount = 0;
    let segundaCount = 0;
    let aranaCount = 0;
    let descarteCount = 0;
    let manualWasteCount = 0;
    let totalCost = 0;
    let totalKg = 0;
    const empCounts = new Map();

    const empRateMap = new Map();
    if (Array.isArray(AppState.employees)) {
      AppState.employees.forEach(e => {
        if (e && e.codigo_empleado) {
          empRateMap.set(String(e.codigo_empleado), parseFloat(e.tarifa_personalizada) || APP_CONFIG.TARIFA_BASE);
        }
      });
    }

    scans.forEach(s => {
      const calCode = String(s.codigo_calidad || '').trim();
      const calName = String(s.nombre_calidad || '').toLowerCase();
      const boxName = String(s.nombre_tipo_caja || '').toLowerCase();
      const originStr = String(s.origen_dispositivo || '').toLowerCase();
      const empCode = s.codigo_empleado_extraido || extractEmpCodeFromRecord(s);
      const empName = s.empleado_nombre_snapshot || 'Empacador ' + empCode;

      const isDescarte = (calCode === 'DESCARTE' || calCode === 'DS' || calName.includes('descarte') || boxName.includes('descarte'));

      if (isDescarte) {
        descarteCount++;
        if (originStr.includes('manual') || calCode === 'DS') {
          manualWasteCount++;
        }
      } else if (calCode === '003' || calCode === '03' || calName.includes('araña') || calName.includes('arana')) {
        aranaCount++;
      } else if (calCode === '002' || calCode === '02' || calName.includes('segunda')) {
        segundaCount++;
      } else {
        primeraCount++;
      }

      if (!isDescarte) {
        const rate = parseFloat(s.tarifa_aplicada) || empRateMap.get(String(empCode)) || APP_CONFIG.TARIFA_BASE;
        totalCost += rate;

        let kg = 10;
        if (boxName.includes('14')) kg = 14;
        else if (boxName.includes('13')) kg = 13;
        else if (boxName.includes('20')) kg = 20;
        else if (boxName.includes('8')) kg = 8;
        totalKg += kg;
      }

      const key = `${empCode}__${empName}`;
      empCounts.set(key, (empCounts.get(key) || 0) + 1);
    });

    const primeraPct = total > 0 ? Math.round((primeraCount / total) * 100) : 0;
    const segundaPct = total > 0 ? Math.round((segundaCount / total) * 100) : 0;
    const aranaPct = total > 0 ? Math.round((aranaCount / total) * 100) : 0;
    const descartePct = total > 0 ? Math.round((descarteCount / total) * 100) : 0;
    const validPct = total > 0 ? Math.round(((total - descarteCount) / total) * 100) : 0;
    const activeEmps = empCounts.size;
    const avgBoxes = activeEmps > 0 ? Math.round(total / activeEmps) : 0;

    let boxesPerHour = 0;
    const timestamps = scans.map(s => new Date(s.fecha_hora).getTime()).filter(t => !isNaN(t));
    if (total > 1 && timestamps.length > 1) {
      const minT = Math.min(...timestamps);
      const maxT = Math.max(...timestamps);
      const hours = (maxT - minT) / (1000 * 60 * 60);
      boxesPerHour = hours > 0.08 ? Math.round(total / hours) : Math.round(total * 8);
    } else if (total > 0) {
      boxesPerHour = total === 1 ? 12 : total;
    }

    let topName = '-';
    let topBoxes = 0;
    empCounts.forEach((count, key) => {
      if (count > topBoxes) {
        topBoxes = count;
        topName = key.split('__')[1] || key;
      }
    });

    const qualityScore = total > 0
      ? ((primeraCount * 1.0 + segundaCount * 0.75 + aranaCount * 0.35) / total).toFixed(2)
      : '0.00';
    const exportShare = total > 0
      ? ((primeraCount + segundaCount) / total).toFixed(2)
      : '0.00';

    setElementText('dashKpiTotalBoxes', total.toLocaleString('es-AR'));
    setElementText('dashKpiPrimeraBoxes', primeraCount.toLocaleString('es-AR'));
    setElementText('dashKpiSegundaBoxes', segundaCount.toLocaleString('es-AR'));
    setElementText('dashKpiAranaBoxes', aranaCount.toLocaleString('es-AR'));
    setElementText('dashKpiDescarteBoxes', descarteCount.toLocaleString('es-AR'));
    setElementText('dashKpiPrimeraPct', total > 0 ? `<i class="fa-solid fa-arrow-up"></i> ${primeraPct}%` : '0%');
    setElementText('dashKpiSegundaPct', `${segundaPct}%`);
    setElementText('dashKpiAranaPct', `${aranaPct}%`);
    setElementText('dashKpiDescartePct', `${descartePct}%`);
    setElementText('dashKpiActiveEmployees', activeEmps);
    setElementText('dashKpiAvgBoxesPerEmp', `Promedio: ${avgBoxes} cj/empacador`);
    setElementText('dashKpiBoxesPerHour', boxesPerHour.toLocaleString('es-AR'));
    setElementText('dashKpiTopPackerName', topBoxes > 0 ? escapeHtml(topName) : '-');
    setElementText('dashKpiTopPackerCount', topBoxes > 0 ? `${topBoxes.toLocaleString('es-AR')} cajas registradas` : '0 cajas registradas');

    // Métricas Bento Telemetry adicionales
    setElementText('dashBentoDeltaBoxes', `<i class="fa-solid fa-arrow-up"></i> ${validPct}% válidas`);
    setElementText('dashBentoTotalCost', `$ ${Math.round(totalCost).toLocaleString('es-AR')}`);
    setElementText('dashBentoTarifaTag', `$${Math.round(APP_CONFIG.TARIFA_BASE)} base`);
    setElementText('dashBentoWasteManual', (manualWasteCount || descarteCount).toLocaleString('es-AR'));
    setElementText('dashBentoQualityIndex', qualityScore);
    setElementText('dashBentoFidelityVal', exportShare);
    setElementText('dashBentoTopEmpTotal', total.toLocaleString('es-AR'));
    setElementText('dashBentoTotalKg', totalKg.toLocaleString('es-AR'));

    // Strip de 28 ticks operativos (Card 2)
    const ticksEl = document.getElementById('dashUptimeTicks');
    if (ticksEl) {
      const slotCount = 28;
      const slotTotals = new Array(slotCount).fill(0);
      const slotWaste = new Array(slotCount).fill(0);
      if (timestamps.length > 0) {
        const minT = Math.min(...timestamps);
        const maxT = Math.max(...timestamps);
        const span = Math.max(maxT - minT, 1);
        scans.forEach(s => {
          const ts = new Date(s.fecha_hora).getTime();
          if (isNaN(ts)) return;
          const idx = Math.min(slotCount - 1, Math.floor(((ts - minT) / span) * slotCount));
          slotTotals[idx]++;
          const c = String(s.codigo_calidad || '').trim();
          const n = String(s.nombre_calidad || '').toLowerCase();
          if (c === 'DESCARTE' || c === 'DS' || n.includes('descarte')) slotWaste[idx]++;
        });
      }
      const maxSlot = Math.max(...slotTotals, 1);
      ticksEl.innerHTML = slotTotals.map((cnt, idx) => {
        let cls = 'bento-tick';
        if (cnt > 0) {
          const isAnomaly = (slotWaste[idx] > 0 && slotWaste[idx] >= cnt * 0.25) || (cnt >= maxSlot * 0.9 && total > 5);
          cls += isAnomaly ? ' amber' : ' active';
        }
        return `<span class="${cls}" title="Tramo ${idx + 1}: ${cnt} cajas"></span>`;
      }).join('');
    }

    // Sparkline de 12 barras redondeadas (Card 3)
    const sparkEl = document.getElementById('dashCostSparkline');
    if (sparkEl) {
      const bars = new Array(12).fill(0);
      if (timestamps.length > 0) {
        const minT = Math.min(...timestamps);
        const maxT = Math.max(...timestamps);
        const span = Math.max(maxT - minT, 1);
        scans.forEach(s => {
          const ts = new Date(s.fecha_hora).getTime();
          if (isNaN(ts)) return;
          const idx = Math.min(11, Math.floor(((ts - minT) / span) * 12));
          bars[idx]++;
        });
      }
      const maxBar = Math.max(...bars, 1);
      sparkEl.innerHTML = bars.map((val, idx) => {
        const h = total > 0 ? Math.max(26, Math.round((val / maxBar) * 100)) : (30 + ((idx * 11) % 36));
        const curCls = idx === 11 ? ' current' : '';
        return `<div class="bento-pill-bar${curCls}" style="height: ${h}%;" title="${val} cajas en segmento ${idx + 1}"></div>`;
      }).join('');
    }

    // Trazas Recientes en Vivo (Card 5)
    const tracesEl = document.getElementById('dashBentoRecentTraces');
    if (tracesEl) {
      const recent = scans.slice(0, 3);
      if (recent.length === 0) {
        tracesEl.innerHTML = `<div class="bento-empty-mini">Sin actividad registrada en este período.</div>`;
      } else {
        const maxEmp = Math.max(topBoxes, 1);
        tracesEl.innerHTML = recent.map((s, idx) => {
          const rawCode = String(s.codigo_barra_leido || '000000');
          const shortCode = rawCode.length > 8 ? `pk_${rawCode.slice(-6)}` : `pk_${rawCode}`;
          const empCode = s.codigo_empleado_extraido || extractEmpCodeFromRecord(s);
          const empName = s.empleado_nombre_snapshot || `Emp. ${empCode}`;
          const empTotal = empCounts.get(`${empCode}__${empName}`) || 1;
          const barPct = Math.max(16, Math.min(100, Math.round((empTotal / maxEmp) * 100)));
          const calCode = String(s.codigo_calidad || '').trim();
          const calName = String(s.nombre_calidad || '').toLowerCase();
          const isWaste = calCode === 'DESCARTE' || calCode === 'DS' || calName.includes('descarte');
          const dotCls = isWaste ? 'red' : 'green';
          const dt = new Date(s.fecha_hora || Date.now());
          const timeStr = isNaN(dt.getTime()) ? '--:--' : dt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

          return `
            <div class="bento-trace-row${idx === 0 ? ' is-first' : ''}">
              <span class="bento-dot ${dotCls}"></span>
              <span class="bento-trace-code">${escapeHtml(shortCode)}</span>
              <span class="bento-trace-name">${escapeHtml(empName)}</span>
              <div class="bento-slim-track">
                <div class="bento-slim-fill${idx === 0 ? ' lead' : ''}" style="width: ${barPct}%;"></div>
              </div>
              <span class="bento-trace-time">${timeStr}</span>
            </div>
          `;
        }).join('');
      }
    }

    // Top Empacadores en Barras Horizontales (Card 7)
    const packerBarsEl = document.getElementById('dashBentoPackerBars');
    if (packerBarsEl) {
      const sortedTop = Array.from(empCounts.entries())
        .map(([k, count]) => ({ name: k.split('__')[1] || k, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 4);

      if (sortedTop.length === 0) {
        packerBarsEl.innerHTML = `<div class="bento-empty-mini">Sin empacadores con picking en este rango.</div>`;
      } else {
        const leaderCount = Math.max(sortedTop[0].count, 1);
        packerBarsEl.innerHTML = sortedTop.map((emp, idx) => {
          const pctW = Math.max(8, Math.round((emp.count / leaderCount) * 100));
          return `
            <div class="bento-packer-row${idx === 0 ? ' is-first' : ''}">
              <span class="bento-packer-name">${escapeHtml(emp.name)}</span>
              <div class="bento-slim-track">
                <div class="bento-slim-fill${idx === 0 ? ' lead' : ''}" style="width: ${pctW}%;"></div>
              </div>
              <span class="bento-packer-count">${emp.count.toLocaleString('es-AR')}</span>
            </div>
          `;
        }).join('');
      }
    }
  },

  renderQualityEnvaseMatrix(scans) {
    const container = document.getElementById('dashMatrixContainer');
    const segBar = document.getElementById('dashBentoSegmentedBar');
    if (!container) return;

    const total = scans.length;
    const combos = [
      { key: 'primera_10kg', label: '1ª · Caja 10 kg', dot: 'blue', color: '#60A5FA' },
      { key: 'primera_14kg', label: '1ª · Caja 14 kg', dot: 'cobalt', color: '#3B82F6' },
      { key: 'segunda_10kg', label: '2ª · Caja 10 kg', dot: 'muted', color: '#52525B' },
      { key: 'segunda_14kg', label: '2ª · Caja 14 kg', dot: 'muted', color: '#3F3F46' },
      { key: 'arana_caja', label: 'Araña (03)', dot: 'dim', color: '#27272A' },
      { key: 'descarte_manual', label: 'Descarte', dot: 'dim', color: '#1F2937' }
    ];

    const counts = {};
    combos.forEach(c => { counts[c.key] = 0; });

    scans.forEach(s => {
      const calCode = String(s.codigo_calidad || '').trim();
      const calName = String(s.nombre_calidad || '').toLowerCase();
      const boxName = String(s.nombre_tipo_caja || '').toUpperCase();

      if (calCode === 'DESCARTE' || calCode === 'DS' || calName.includes('descarte') || boxName.includes('DESCARTE')) {
        counts['descarte_manual']++;
      } else if (calCode === '003' || calCode === '03' || calName.includes('araña') || calName.includes('arana') || boxName.includes('ARAÑA') || boxName.includes('ARANA')) {
        counts['arana_caja']++;
      } else if (calCode === '002' || calCode === '02' || calName.includes('segunda')) {
        if (boxName.includes('14') || boxName.includes('BOLSA') || boxName.includes('20')) counts['segunda_14kg']++;
        else counts['segunda_10kg']++;
      } else {
        if (boxName.includes('14') || boxName.includes('13') || boxName.includes('LIBRAS')) counts['primera_14kg']++;
        else counts['primera_10kg']++;
      }
    });

    const ranked = combos
      .map(c => ({ ...c, count: counts[c.key] || 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);

    const paletteDots = ['blue', 'cobalt', 'muted', 'dim'];
    const paletteHex = ['#60A5FA', '#3B82F6', '#52525B', '#27272A'];

    container.innerHTML = ranked.map((c, idx) => {
      const pct = total > 0 ? Math.round((c.count / total) * 100) : 0;
      return `
        <div class="bento-bd-item${idx === 0 ? ' is-first' : ''}" title="${c.count} cajas (${pct}%)">
          <span class="bento-bd-left">
            <span class="bento-dot ${paletteDots[idx]}"></span>
            <span>${c.label}</span>
          </span>
          <span class="bento-bd-pct">${pct}%</span>
        </div>
      `;
    }).join('');

    if (segBar) {
      if (total === 0) {
        segBar.innerHTML = `<div class="bento-seg-piece" style="width: 100%; background: #27272A;"></div>`;
      } else {
        segBar.innerHTML = ranked.map((c, idx) => {
          const pct = Math.max(c.count > 0 ? 3 : 0, (c.count / total) * 100);
          return pct > 0
            ? `<div class="bento-seg-piece" style="width: ${pct.toFixed(1)}%; background: ${paletteHex[idx]};" title="${c.label}: ${c.count} cajas"></div>`
            : '';
        }).join('');
      }
    }
  },

  renderShiftDistribution(scans) {
    const container = document.getElementById('dashShiftContainer');
    if (!container) return;

    const total = scans.length;
    let manana = 0;
    let tarde = 0;
    let noche = 0;

    scans.forEach(s => {
      const shift = this.resolveShift(s);
      if (shift === 'manana') manana++;
      else if (shift === 'tarde') tarde++;
      else noche++;
    });

    const pctM = total > 0 ? Math.round((manana / total) * 100) : 0;
    const pctT = total > 0 ? Math.round((tarde / total) * 100) : 0;
    const pctN = total > 0 ? Math.round((noche / total) * 100) : 0;

    container.innerHTML = `
      <span class="bento-shift-chip">Mañana <strong>${manana.toLocaleString('es-AR')}</strong> (${pctM}%)</span>
      <span class="bento-shift-chip">Tarde <strong>${tarde.toLocaleString('es-AR')}</strong> (${pctT}%)</span>
      <span class="bento-shift-chip">Noche <strong>${noche.toLocaleString('es-AR')}</strong> (${pctN}%)</span>
    `;
  },

  renderHourlyChart(scans) {
    const chart = document.getElementById('dashHourlyChart');
    if (!chart) return;

    const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const timestamps = scans.map(s => new Date(s.fecha_hora).getTime()).filter(t => !isNaN(t));
    const anchorDate = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : new Date();
    const todayDate = new Date();
    const anchorDayStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate());
    const todayDayStart = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate());

    const rows = [];
    const keyToRowIdx = new Map();
    for (let offset = 4; offset >= 0; offset--) {
      const d = new Date(anchorDayStart);
      d.setDate(anchorDayStart.getDate() - offset);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dayNum = String(d.getDate()).padStart(2, '0');
      const key = `${y}-${m}-${dayNum}`;
      const isActualToday = d.getTime() === todayDayStart.getTime();
      const label = (offset === 0 && isActualToday) ? 'Hoy' : (offset === 0 ? `${dayNum}/${m}` : dayNames[d.getDay()]);
      keyToRowIdx.set(key, rows.length);
      rows.push({
        label,
        isLast: offset === 0,
        isActualToday,
        hours: new Array(24).fill(0)
      });
    }

    scans.forEach(s => {
      const d = new Date(s.fecha_hora);
      if (isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const rIdx = keyToRowIdx.get(key);
      if (rIdx !== undefined) {
        const h = d.getHours();
        if (h >= 0 && h < 24) rows[rIdx].hours[h]++;
      }
    });

    let maxCell = 1;
    rows.forEach(r => {
      r.hours.forEach(c => { if (c > maxCell) maxCell = c; });
    });
    const currentHour = todayDate.getHours();

    const rowsHtml = rows.map(row => {
      const cellsHtml = row.hours.map((cnt, h) => {
        let lvl = 'lvl-0';
        if (cnt > 0) {
          const ratio = cnt / maxCell;
          if (ratio > 0.78) lvl = 'lvl-4';
          else if (ratio > 0.50) lvl = 'lvl-3';
          else if (ratio > 0.22) lvl = 'lvl-2';
          else lvl = 'lvl-1';
        } else if (row.isActualToday && h > currentHour) {
          lvl = 'lvl-future';
        }
        return `<div class="bento-hm-cell ${lvl}" title="${row.label} ${String(h).padStart(2, '0')}:00 · ${cnt} cajas"></div>`;
      }).join('');

      return `
        <div class="bento-hm-row${row.isLast ? ' is-today' : ''}">
          <span class="bento-hm-day">${row.label}</span>
          ${cellsHtml}
        </div>
      `;
    }).join('');

    const axisHtml = `
      <div class="bento-hm-axis">
        <span></span>
        <span class="bento-hm-tick-lbl" style="grid-column: 2 / span 4;">0:00</span>
        <span class="bento-hm-tick-lbl" style="grid-column: 8 / span 4;">6:00</span>
        <span class="bento-hm-tick-lbl" style="grid-column: 14 / span 4;">12:00</span>
        <span class="bento-hm-tick-lbl" style="grid-column: 20 / span 4;">18:00</span>
      </div>
    `;

    chart.innerHTML = `<div class="bento-hm-grid">${rowsHtml}${axisHtml}</div>`;
  },

  renderEmployeeTable(scans) {
    const tbody = document.getElementById('dashEmployeesTableBody');
    const badge = document.getElementById('dashEmployeeTableCountBadge');
    const tableSub = document.getElementById('dashTableEmpSubtitle');
    if (!tbody) return;

    const totalPlantBoxes = scans.length;
    const empMap = new Map();

    scans.forEach(s => {
      const empCode = s.codigo_empleado_extraido || extractEmpCodeFromRecord(s) || '0000';
      let empObj = empMap.get(empCode);
      if (!empObj) {
        const meta = AppState.employees.find(e => e.codigo_empleado === empCode) || {};
        empObj = {
          code: empCode,
          name: s.empleado_nombre_snapshot || meta.nombre_completo || `Empacador ${empCode}`,
          dni: meta.dni_rut || '-',
          rate: meta.tarifa_personalizada || APP_CONFIG.TARIFA_BASE,
          total: 0,
          primera: 0,
          segunda: 0,
          arana: 0,
          descarte: 0,
          envases: {}
        };
        empMap.set(empCode, empObj);
      }

      empObj.total++;
      const calCode = String(s.codigo_calidad || '').trim();
      const calName = String(s.nombre_calidad || '').toLowerCase();

      if (calCode === 'DESCARTE' || calCode === 'DS' || calName.includes('descarte')) {
        empObj.descarte++;
      } else if (calCode === '003' || calCode === '03' || calName.includes('araña') || calName.includes('arana')) {
        empObj.arana++;
      } else if (calCode === '002' || calCode === '02' || calName.includes('segunda')) {
        empObj.segunda++;
      } else {
        empObj.primera++;
      }

      const envName = s.nombre_tipo_caja || (calCode === 'DESCARTE' || calCode === 'DS' ? 'Descarte' : 'Caja Estándar');
      empObj.envases[envName] = (empObj.envases[envName] || 0) + 1;
    });

    const sortedEmps = Array.from(empMap.values()).sort((a, b) => b.total - a.total);

    if (badge) {
      const word = sortedEmps.length === 1 ? 'empacador' : 'empacadores';
      badge.innerText = `${sortedEmps.length} ${word}`;
    }
    if (tableSub) {
      const word = sortedEmps.length === 1 ? 'empacador activo' : 'empacadores activos';
      tableSub.innerText = `${sortedEmps.length} ${word}`;
    }

    if (sortedEmps.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="11" style="text-align:center; padding:3rem 1rem; color:var(--text-muted);">
            <i class="fa-solid fa-boxes-packing" style="font-size:2rem; margin-bottom:0.75rem; display:block; opacity:0.5;"></i>
            No se encontraron registros de picking ni descarte para los filtros seleccionados.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = sortedEmps.map((emp, index) => {
      const rank = index + 1;
      let rankHtml = `<span class="dash-rank-badge standard">#${rank}</span>`;
      if (rank === 1) rankHtml = `<span class="dash-rank-badge top-1">🥇</span>`;
      else if (rank === 2) rankHtml = `<span class="dash-rank-badge top-2">🥈</span>`;
      else if (rank === 3) rankHtml = `<span class="dash-rank-badge top-3">🥉</span>`;

      const plantShare = totalPlantBoxes > 0 ? ((emp.total / totalPlantBoxes) * 100).toFixed(1) : 0;
      const cajasPagas = emp.total - emp.descarte;
      const subtotalEst = (cajasPagas * emp.rate).toLocaleString('es-AR', { minimumFractionDigits: 2 });

      const envasePills = Object.entries(emp.envases)
        .map(([name, count]) => `<span class="dash-envase-pill">${escapeHtml(name)}: <strong>${count}</strong></span>`)
        .join(' ');

      return `
        <tr>
          <td style="text-align:center;">${rankHtml}</td>
          <td>
            <strong style="color:var(--text-primary); font-size:0.95rem;">${escapeHtml(emp.name)}</strong>
            <div style="font-size:0.75rem; color:var(--accent-primary); font-family:var(--font-mono); font-weight:700;">
              CÓD: ${escapeHtml(emp.code)}
            </div>
          </td>
          <td style="font-size:0.85rem; color:var(--text-secondary); font-family:var(--font-mono);">${escapeHtml(emp.dni)}</td>
          <td style="text-align:center;">
            <strong style="font-size:1.15rem; font-family:var(--font-mono); color:var(--text-primary);">${emp.total.toLocaleString('es-AR')}</strong>
            <div class="dash-plant-share-bar">
              <div class="dash-plant-share-fill" style="width: ${plantShare}%;"></div>
            </div>
          </td>
          <td style="text-align:center;">
            <span class="ui-badge ui-badge-info" style="font-weight:700; font-family:var(--font-mono);">${emp.primera}</span>
          </td>
          <td style="text-align:center;">
            <span class="ui-badge ui-badge-success" style="font-weight:700; font-family:var(--font-mono);">${emp.segunda}</span>
          </td>
          <td style="text-align:center;">
            <span class="ui-badge ui-badge-violet" style="font-weight:700; font-family:var(--font-mono);">${emp.arana}</span>
          </td>
          <td style="text-align:center;">
            <span class="ui-badge ui-badge-danger" style="font-weight:700; font-family:var(--font-mono);">${emp.descarte}</span>
          </td>
          <td>${envasePills}</td>
          <td style="text-align:center; font-weight:800; font-family:var(--font-mono); color:var(--accent-primary);">
            ${plantShare}%
          </td>
          <td style="text-align:right; font-weight:900; font-family:var(--font-mono); color:var(--status-success); font-size:0.95rem;">
            $${subtotalEst}
          </td>
        </tr>
      `;
    }).join('');
  },

  renderAuditTable(scans) {
    const tbody = document.getElementById('dashAuditTableBody');
    const badge = document.getElementById('dashAuditCountBadge');
    if (!tbody) return;

    const sample = scans.slice(0, 50);

    if (badge) {
      badge.innerText = `MOSTRANDO ${sample.length} DE ${scans.length} ESCANEOS / REGISTROS`;
    }

    if (sample.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center; padding:2.5rem 1rem; color:var(--text-muted);">
            No hay registros para mostrar.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = sample.map(s => {
      const barcode = s.codigo_barra_leido || '000000';
      const calCode = String(s.codigo_calidad || '').trim();
      const calName = String(s.nombre_calidad || '').toLowerCase();
      const correlativo = (calCode === 'DESCARTE' || calCode === 'DS' || barcode.length < 10) ? '-' : `#${barcode.substring(6, 10)}`;
      const date = new Date(s.fecha_hora || Date.now());
      const timeStr = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const dateStr = date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });

      let qualBadge = `<span class="dash-matrix-tag primera">Primera (000)</span>`;
      if (calCode === 'DESCARTE' || calCode === 'DS' || calName.includes('descarte')) {
        qualBadge = `<span class="dash-matrix-tag descarte"><i class="fa-solid fa-trash-can"></i> Descarte</span>`;
      } else if (calCode === '003' || calCode === '03' || calName.includes('araña') || calName.includes('arana')) {
        qualBadge = `<span class="dash-matrix-tag arana"><i class="fa-solid fa-bug"></i> Araña (003)</span>`;
      } else if (calCode === '002' || calCode === '02' || calName.includes('segunda')) {
        qualBadge = `<span class="dash-matrix-tag segunda">Segunda (002)</span>`;
      }

      return `
        <tr>
          <td>
            <span style="font-family:var(--font-mono); font-weight:800; color:var(--accent-primary); letter-spacing:0.04em;">
              ${escapeHtml(barcode)}
            </span>
          </td>
          <td>
            <span class="badge" style="background:var(--accent-light); color:var(--accent-primary); font-weight:700; font-family:var(--font-mono);">
              ${escapeHtml(correlativo)}
            </span>
          </td>
          <td style="font-size:0.85rem; color:var(--text-secondary); font-family:var(--font-mono);">
            ${timeStr} • ${dateStr}
          </td>
          <td>
            <strong style="color:var(--text-primary);">${escapeHtml(s.empleado_nombre_snapshot || 'Empacador')}</strong>
            <span style="font-size:0.75rem; color:var(--text-muted); font-family:var(--font-mono);"> (${escapeHtml(s.codigo_empleado_extraido || extractEmpCodeFromRecord(s))})</span>
          </td>
          <td>
            ${qualBadge}
          </td>
          <td>
            <span style="font-size:0.85rem; font-weight:700; color:var(--text-primary);">${escapeHtml(s.nombre_tipo_caja || 'Caja')}</span>
          </td>
          <td style="font-size:0.8rem; color:var(--text-muted);">
            ${escapeHtml(s.linea_empaque || 'Línea 1')} • ${escapeHtml(s.origen_dispositivo || 'Pistola')}
          </td>
        </tr>
      `;
    }).join('');
  },

  exportExcel() {
    let scansToExport = this.filteredScans;
    if (!scansToExport || scansToExport.length === 0) {
      if (this.cachedScans && this.cachedScans.length > 0) {
        scansToExport = this.cachedScans;
      } else if (AppState.todayScans && AppState.todayScans.length > 0) {
        scansToExport = AppState.todayScans;
      } else if (AppState.recentScans && AppState.recentScans.length > 0) {
        scansToExport = AppState.recentScans;
      }
    }

    if (typeof XLSX === 'undefined') {
      showToast('Cargando motor de Excel...', 'info');
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      script.onload = () => this.exportExcel();
      script.onerror = () => {
        showToast('Descargando reporte en formato CSV alternativo...', 'warning');
        this.exportCSV();
      };
      document.head.appendChild(script);
      return;
    }

    try {
      // 1. Preparar datos formateados para la hoja principal
      const dataRows = (scansToExport && scansToExport.length > 0) ? scansToExport.map((s, idx) => {
        const barcode = s.codigo_barra_leido || '';
        const calCode = String(s.codigo_calidad || '').trim();
        const calName = s.nombre_calidad || (calCode === '002' || calCode === '02' ? 'Segunda' : calCode === '003' || calCode === '03' ? 'Araña' : calCode === 'DESCARTE' || calCode === 'DS' ? 'Descarte' : 'Primera');
        const empCode = s.codigo_empleado_extraido || extractEmpCodeFromRecord(s);
        const empName = s.empleado_nombre_snapshot || 'Empacador ' + empCode;
        const date = new Date(s.fecha_hora || Date.now());
        const timeStr = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const dateStr = s.fecha_dia || date.toISOString().split('T')[0];
        const correlativo = (calCode === 'DESCARTE' || calCode === 'DS' || barcode.length < 10) ? '-' : barcode.substring(6, 10);
        const tarifa = parseFloat(s.tarifa_aplicada) || APP_CONFIG.TARIFA_BASE;

        return {
          'N°': idx + 1,
          'Fecha': dateStr,
          'Hora': timeStr,
          'Código Barra': barcode,
          'Correlativo': correlativo,
          'Cód. Empacador': empCode,
          'Empacador': empName,
          'Cód. Calidad': calCode || '000',
          'Calidad': calName,
          'Tipo de Envase': s.nombre_tipo_caja || 'Caja Estándar',
          'Turno': s.turno || this.resolveShift(s),
          'Línea Empaque': s.linea_empaque || 'Línea 1',
          'Dispositivo': s.origen_dispositivo || 'Pistola USB',
          'Tarifa ($)': tarifa
        };
      }) : [{
        'N°': 1,
        'Fecha': this.filters.dateFrom || this.getLocalDateString(),
        'Hora': '--:--:--',
        'Código Barra': '(Sin movimientos registrados en este período)',
        'Correlativo': '-',
        'Cód. Empacador': '-',
        'Empacador': '-',
        'Cód. Calidad': '-',
        'Calidad': '-',
        'Tipo de Envase': '-',
        'Turno': '-',
        'Línea Empaque': '-',
        'Dispositivo': '-',
        'Tarifa ($)': 0
      }];

      // 2. Crear Libro de Trabajo
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(dataRows);

      // Anchos de columna automáticos
      ws['!cols'] = [
        { wch: 6 },
        { wch: 12 },
        { wch: 10 },
        { wch: 16 },
        { wch: 12 },
        { wch: 16 },
        { wch: 28 },
        { wch: 14 },
        { wch: 16 },
        { wch: 20 },
        { wch: 12 },
        { wch: 14 },
        { wch: 16 },
        { wch: 12 }
      ];

      XLSX.utils.book_append_sheet(wb, ws, 'Picking Detallado');

      // 3. Crear Hoja 2: Resumen por Empacador
      const empMap = new Map();
      if (scansToExport && scansToExport.length > 0) {
        scansToExport.forEach(s => {
          const empCode = s.codigo_empleado_extraido || extractEmpCodeFromRecord(s);
          let empObj = empMap.get(empCode);
          if (!empObj) {
            empObj = {
              'Cód. Empacador': empCode,
              'Nombre Empacador': s.empleado_nombre_snapshot || `Empacador ${empCode}`,
              'Total Cajas': 0,
              'Primera': 0,
              'Segunda': 0,
              'Araña': 0,
              'Descarte': 0,
              'Subtotal Estimado ($)': 0
            };
            empMap.set(empCode, empObj);
          }
          empObj['Total Cajas']++;
          const calCode = String(s.codigo_calidad || '').trim();
          const calName = String(s.nombre_calidad || '').toLowerCase();
          if (calCode === 'DESCARTE' || calCode === 'DS' || calName.includes('descarte')) {
            empObj['Descarte']++;
          } else if (calCode === '003' || calCode === '03' || calName.includes('araña') || calName.includes('arana')) {
            empObj['Araña']++;
          } else if (calCode === '002' || calCode === '02' || calName.includes('segunda')) {
            empObj['Segunda']++;
          } else {
            empObj['Primera']++;
          }

          const rate = parseFloat(s.tarifa_aplicada) || APP_CONFIG.TARIFA_BASE;
          if (calCode !== 'DESCARTE' && calCode !== 'DS') {
            empObj['Subtotal Estimado ($)'] += rate;
          }
        });
      }

      const summaryRows = (empMap.size > 0) 
        ? Array.from(empMap.values()).sort((a, b) => b['Total Cajas'] - a['Total Cajas'])
        : [{
          'Cód. Empacador': '-',
          'Nombre Empacador': '(Sin movimientos)',
          'Total Cajas': 0,
          'Primera': 0,
          'Segunda': 0,
          'Araña': 0,
          'Descarte': 0,
          'Subtotal Estimado ($)': 0
        }];

      const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
      wsSummary['!cols'] = [
        { wch: 14 },
        { wch: 28 },
        { wch: 12 },
        { wch: 10 },
        { wch: 10 },
        { wch: 10 },
        { wch: 10 },
        { wch: 22 }
      ];
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen Empacadores');

      // 4. Descargar archivo Excel .xlsx
      const fileName = `MAGARETTO_Picking_Dashboard_${this.filters.dateFrom}_al_${this.filters.dateTo}.xlsx`;
      try {
        XLSX.writeFile(wb, fileName);
      } catch (writeErr) {
        console.warn('XLSX.writeFile bloqueado por navegador, descargando vía Blob binario...', writeErr);
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 1500);
      }
      showToast(`Archivo Excel exportado exitosamente (${dataRows.length} registros).`, 'success');
    } catch (err) {
      console.error('Error generando archivo Excel:', err);
      showToast('Error generando archivo Excel. Se exportará como CSV.', 'error');
      this.exportCSV();
    }
  },

  exportCSV() {
    let scansToExport = this.filteredScans;
    if (!scansToExport || scansToExport.length === 0) {
      if (this.cachedScans && this.cachedScans.length > 0) {
        scansToExport = this.cachedScans;
      } else if (AppState.todayScans && AppState.todayScans.length > 0) {
        scansToExport = AppState.todayScans;
      }
    }

    if (!scansToExport || scansToExport.length === 0) {
      showToast('No hay datos disponibles para exportar con los filtros actuales.', 'warning');
      return;
    }

    const headers = [
      'Codigo_Barra_7D',
      'Correlativo_Digital',
      'Fecha_Dia',
      'Hora',
      'Codigo_Empleado',
      'Nombre_Empleado',
      'Codigo_Calidad',
      'Nombre_Calidad',
      'Tipo_Envase',
      'Turno',
      'Linea_Empaque',
      'Origen_Dispositivo',
      'Tarifa_Aplicada'
    ];

    const rows = scansToExport.map(s => {
      const barcode = s.codigo_barra_leido || '';
      const calCode = String(s.codigo_calidad || '').trim();
      const correlativo = (calCode === 'DESCARTE' || calCode === 'DS' || barcode.length < 10) ? '' : barcode.substring(6, 10);
      const date = new Date(s.fecha_hora || Date.now());
      const timeStr = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      return [
        `"${barcode}"`,
        `"${correlativo}"`,
        `"${s.fecha_dia || date.toISOString().split('T')[0]}"`,
        `"${timeStr}"`,
        `"${s.codigo_empleado_extraido || extractEmpCodeFromRecord(s)}"`,
        `"${(s.empleado_nombre_snapshot || '').replace(/"/g, '""')}"`,
        `"${s.codigo_calidad || '000'}"`,
        `"${(s.nombre_calidad || '').replace(/"/g, '""')}"`,
        `"${(s.nombre_tipo_caja || '').replace(/"/g, '""')}"`,
        `"${s.turno || this.resolveShift(s)}"`,
        `"${s.linea_empaque || 'Línea 1'}"`,
        `"${s.origen_dispositivo || 'Pistola USB'}"`,
        s.tarifa_aplicada || APP_CONFIG.TARIFA_BASE
      ].join(';');
    });

    const csvContent = '\uFEFF' + headers.join(';') + '\n' + rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MAGARETTO_Picking_Dashboard_${this.filters.dateFrom}_al_${this.filters.dateTo}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Archivo CSV exportado (${scansToExport.length} registros).`, 'success');
  }
};

// ==============================================================================
// 11. UTILIDADES GENERALES
// ==============================================================================
function setElementText(elementId, htmlContent) {
  const el = document.getElementById(elementId);
  if (el) el.innerHTML = htmlContent;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-msg ${type}`;
  toast.innerHTML = `
    <i class="fa-solid ${type === 'success' ? 'fa-circle-check' : type === 'error' ? 'fa-circle-xmark' : 'fa-circle-info'}"></i>
    <span>${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ==============================================================================
// 14. PALETA DE BÚSQUEDA RÁPIDA (⌘K / Ctrl+K) Y ATAJOS DE TECLADO
// ==============================================================================
const SearchPaletteManager = {
  isOpen: false,
  activeIndex: 0,
  filteredEntries: [],
  previousFocus: null,

  fold(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  },

  isAuthLocked() {
    const overlay = document.getElementById('authLoginOverlay');
    return Boolean(overlay && !overlay.classList.contains('hidden'));
  },

  init() {
    const btnSidebar = document.getElementById('btnSidebarSearch');
    const btnTopbar = document.getElementById('btnTopbarSearch');
    const btnClose = document.getElementById('btnCloseSearchPalette');
    const scrim = document.getElementById('searchPaletteScrim');
    const escBadge = document.querySelector('.search-palette-esc');
    const input = document.getElementById('searchPaletteInput');

    if (btnSidebar) btnSidebar.addEventListener('click', () => this.open());
    if (btnTopbar) btnTopbar.addEventListener('click', () => this.open());
    if (btnClose) btnClose.addEventListener('click', () => this.close());
    if (scrim) scrim.addEventListener('click', () => this.close());
    if (escBadge) escBadge.addEventListener('click', () => this.close());

    if (input) {
      input.addEventListener('input', () => {
        this.activeIndex = 0;
        this.render();
      });

      input.addEventListener('keydown', (e) => {
        if (e.isComposing) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!this.filteredEntries.length) return;
          const delta = e.key === 'ArrowDown' ? 1 : -1;
          this.activeIndex = (this.activeIndex + delta + this.filteredEntries.length) % this.filteredEntries.length;
          this.renderSelectionOnly();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const chosen = this.filteredEntries[this.activeIndex];
          if (chosen) this.execute(chosen);
        }
      });
    }

    const TAB_SHORTCUTS = {
      '1': 'tab-scanner',
      '2': 'tab-waste',
      '3': 'tab-dashboard',
      '4': 'tab-production',
      '5': 'tab-employees',
      '6': 'tab-payroll',
      '7': 'tab-users',
      ',': 'tab-settings'
    };

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        e.preventDefault();
        this.close();
        return;
      }

      if (this.isAuthLocked()) return;
      if (e.defaultPrevented || e.repeat || e.isComposing || e.altKey || !(e.metaKey || e.ctrlKey)) return;

      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        if (this.isOpen) this.close();
        else this.open();
        return;
      }

      const targetTab = TAB_SHORTCUTS[key];
      if (targetTab) {
        const tabBtn = document.querySelector(`.nav-tab[data-tab="${targetTab}"]`);
        if (tabBtn && tabBtn.style.display !== 'none') {
          e.preventDefault();
          if (this.isOpen) this.close();
          switchTab(targetTab);
        }
      }
    });
  },

  open() {
    if (this.isAuthLocked()) return;
    const modal = document.getElementById('searchPaletteModal');
    const input = document.getElementById('searchPaletteInput');
    if (!modal || !input) return;

    this.previousFocus = document.activeElement;
    this.isOpen = true;
    this.activeIndex = 0;
    input.value = '';
    modal.style.display = 'block';
    this.render();
    setTimeout(() => input.focus({ preventScroll: true }), 10);
  },

  close() {
    const modal = document.getElementById('searchPaletteModal');
    const input = document.getElementById('searchPaletteInput');
    if (!modal) return;

    this.isOpen = false;
    modal.style.display = 'none';
    if (input) input.value = '';

    if (this.previousFocus && this.previousFocus.isConnected && typeof this.previousFocus.focus === 'function') {
      this.previousFocus.focus({ preventScroll: true });
    } else if (AppState.activeTab === 'tab-scanner' && !MobileCameraScanner.isMobile()) {
      document.getElementById('barcodeInput')?.focus({ preventScroll: true });
    }
    this.previousFocus = null;
  },

  buildEntries() {
    const entries = [];
    const role = AppState.currentUser?.rol || 'Usuario';

    // 1. Secciones visibles para el rol actual
    document.querySelectorAll('.nav-tab[data-tab]').forEach(btn => {
      if (btn.style.display === 'none') return;
      const tabId = btn.dataset.tab;
      const label = btn.querySelector('.nav-tab-label')?.textContent?.trim() || btn.title || tabId;
      const iconClass = btn.querySelector('i')?.className || 'fa-solid fa-layer-group';
      const kbd = btn.querySelector('.ui-kbd')?.textContent?.trim();
      entries.push({
        title: label,
        meta: kbd ? `Sección · ${kbd}` : 'Sección',
        icon: iconClass,
        action: () => switchTab(tabId)
      });
    });

    // 2. Acciones rápidas
    const scannerBtn = document.querySelector('.nav-tab[data-tab="tab-scanner"]');
    if (scannerBtn && scannerBtn.style.display !== 'none' && role !== 'Ejecutivo') {
      entries.push({
        title: 'Colocar caja manualmente',
        meta: 'Acción rápida',
        icon: 'fa-solid fa-hand',
        action: () => {
          switchTab('tab-scanner');
          populateEmployeeSelects();
          document.getElementById('modalManualScan')?.classList.add('open');
        }
      });
    }

    entries.push({
      title: 'Cambiar tema Claro / Oscuro',
      meta: 'Apariencia',
      icon: 'fa-solid fa-circle-half-stroke',
      action: () => document.getElementById('btnThemeToggle')?.click()
    });

    entries.push({
      title: 'Probar sonido Beep',
      meta: 'Audio',
      icon: 'fa-solid fa-volume-high',
      action: () => {
        AudioPlayer.playSuccessBeep();
        showToast('🔊 Sonido de lectura correcto (1200Hz)', 'success');
      }
    });

    const dashBtn = document.querySelector('.nav-tab[data-tab="tab-dashboard"]');
    if (dashBtn && dashBtn.style.display !== 'none') {
      entries.push({
        title: 'Exportar Excel del Tablero',
        meta: 'Reporte',
        icon: 'fa-solid fa-file-excel',
        action: () => DashboardManager.exportExcel()
      });
    }

    const empBtn = document.querySelector('.nav-tab[data-tab="tab-employees"]');
    const canViewEmployees = Boolean(empBtn && empBtn.style.display !== 'none');
    if (canViewEmployees) {
      entries.push({
        title: 'Nuevo Empacador',
        meta: 'Personal',
        icon: 'fa-solid fa-user-plus',
        action: () => {
          switchTab('tab-employees');
          openEditEmployeeModal(null);
        }
      });
    }

    // 3. Empacadores activos
    (AppState.employees || []).forEach(emp => {
      if (emp.activo === false) return;
      entries.push({
        title: `${emp.nombre_completo} (${emp.codigo_empleado})`,
        meta: 'Empacador',
        icon: 'fa-solid fa-user',
        isEmployee: true,
        action: () => {
          if (canViewEmployees) {
            switchTab('tab-employees');
            const empSearch = document.getElementById('employeeSearchInput');
            if (empSearch) {
              empSearch.value = emp.codigo_empleado || emp.nombre_completo || '';
              renderEmployeesTable();
            }
          } else {
            switchTab('tab-dashboard');
            const dashSearch = document.getElementById('dashSearchInput');
            if (dashSearch) {
              dashSearch.value = emp.codigo_empleado || '';
              DashboardManager.filters.query = (emp.codigo_empleado || '').toLowerCase();
              DashboardManager.applyFiltersAndRender();
            }
          }
        }
      });
    });

    return entries;
  },

  render() {
    const list = document.getElementById('searchPaletteResults');
    const input = document.getElementById('searchPaletteInput');
    if (!list || !input) return;

    const q = this.fold(input.value.trim());
    const all = this.buildEntries();

    if (!q) {
      this.filteredEntries = all.filter(e => !e.isEmployee).slice(0, 12);
    } else {
      this.filteredEntries = all
        .filter(e => this.fold(e.title).includes(q) || this.fold(e.meta).includes(q))
        .slice(0, 20);
    }

    if (this.activeIndex >= this.filteredEntries.length) {
      this.activeIndex = Math.max(0, this.filteredEntries.length - 1);
    }

    if (this.filteredEntries.length === 0) {
      list.innerHTML = `<div class="search-palette-empty">No se encontraron resultados para "${escapeHtml(input.value.trim())}".</div>`;
      return;
    }

    list.innerHTML = this.filteredEntries.map((entry, idx) => `
      <div
        class="search-palette-option"
        role="option"
        aria-selected="${idx === this.activeIndex ? 'true' : 'false'}"
        data-palette-idx="${idx}"
      >
        <i class="${escapeHtml(entry.icon)} search-palette-option-icon" aria-hidden="true"></i>
        <span class="search-palette-option-title">${escapeHtml(entry.title)}</span>
        <span class="search-palette-option-meta">${escapeHtml(entry.meta)}</span>
      </div>
    `).join('');

    list.querySelectorAll('.search-palette-option').forEach(el => {
      const idx = Number(el.dataset.paletteIdx);
      el.addEventListener('mousedown', (e) => e.preventDefault());
      el.addEventListener('mousemove', () => {
        if (this.activeIndex !== idx) {
          this.activeIndex = idx;
          this.renderSelectionOnly();
        }
      });
      el.addEventListener('click', () => {
        const chosen = this.filteredEntries[idx];
        if (chosen) this.execute(chosen);
      });
    });
  },

  renderSelectionOnly() {
    const list = document.getElementById('searchPaletteResults');
    if (!list) return;
    list.querySelectorAll('.search-palette-option').forEach((el, idx) => {
      el.setAttribute('aria-selected', idx === this.activeIndex ? 'true' : 'false');
      if (idx === this.activeIndex) {
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  },

  execute(entry) {
    this.close();
    if (entry && typeof entry.action === 'function') {
      entry.action();
    }
  }
};
