/**
 * MAGARETTO - SCRIPT DE COMPILACIÓN Y EMPAQUETADO PARA HOSTINGER
 * Genera la carpeta /dist y los archivos zip listos para subir a producción.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = __dirname;
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const ZIP_FILE = path.join(ROOT_DIR, 'magaretto-picking-hostinger.zip');
const VETE_ZIP_FILE = path.join(ROOT_DIR, 'vete-picking-hostinger.zip');
const LEGACY_ZIP_FILE = path.join(ROOT_DIR, 'agroconecta-picking-hostinger.zip');

// Lista de archivos necesarios para producción en Hostinger
const ASSETS_TO_BUILD = [
  'index.html',
  'styles.css',
  'app.js',
  'xlsx.full.min.js',
  'html5-qrcode.min.js',
  'manifest.json',
  'sw.js',
  '.htaccess',
  'favicon.png',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
  'icon.svg',
  'company_logo.jpg'
];

console.log('====================================================');
console.log('    MAGARETTO - COMPILACIÓN PARA PRODUCCIÓN');
console.log('====================================================\n');

// 1. Limpiar o crear carpeta dist/
if (fs.existsSync(DIST_DIR)) {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DIST_DIR, { recursive: true });
console.log('📁 Carpeta dist/ creada correctamente.');

// 2. Copiar archivos de producción a dist/
let totalBytes = 0;
ASSETS_TO_BUILD.forEach(file => {
  const srcPath = path.join(ROOT_DIR, file);
  const destPath = path.join(DIST_DIR, file);

  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    const size = fs.statSync(destPath).size;
    totalBytes += size;
    console.log(`  ✓ Copiado: ${file.padEnd(22)} (${(size / 1024).toFixed(1)} KB)`);
  } else {
    console.warn(`  ⚠️ Advertencia: ${file} no encontrado en la raíz.`);
  }
});

console.log(`\n📦 Total compilado en dist/: ${(totalBytes / 1024).toFixed(1)} KB (${ASSETS_TO_BUILD.length} archivos)`);

// 3. Crear archivo ZIP para Hostinger
[ZIP_FILE, VETE_ZIP_FILE, LEGACY_ZIP_FILE].forEach(f => {
  if (fs.existsSync(f)) fs.unlinkSync(f);
});

try {
  // Usar PowerShell Compress-Archive en Windows
  const psCmd = `powershell -NoProfile -Command "Compress-Archive -Path '${DIST_DIR}\\*' -DestinationPath '${ZIP_FILE}' -Force"`;
  execSync(psCmd, { stdio: 'inherit' });
  // Copia de respaldo con nombre vete para compatibilidad
  fs.copyFileSync(ZIP_FILE, VETE_ZIP_FILE);
  const zipSize = fs.statSync(ZIP_FILE).size;
  console.log(`\n✅ Paquetes ZIP generados exitosamente:`);
  console.log(`   👉 ${ZIP_FILE} (${(zipSize / 1024).toFixed(1)} KB)`);
  console.log(`   👉 ${VETE_ZIP_FILE} (${(zipSize / 1024).toFixed(1)} KB)`);
} catch (err) {
  console.error('Error generando el archivo ZIP:', err);
}

console.log('\n====================================================');
console.log(' ¡Compilación finalizada con éxito!');
console.log(' Sube magaretto-picking-hostinger.zip a tu public_html en Hostinger');
console.log('====================================================\n');
