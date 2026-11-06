# 🚀 Guía de Despliegue en Hostinger - VETE Picking

Este proyecto ha sido compilado y empaquetado para ser alojado directamente en cualquier plan de **Hostinger** (Hosting Compartido, Cloud Hosting o VPS).

---

## 📦 Archivo de Producción Generado

En la raíz del proyecto encontrarás el paquete listo para producción:
👉 **`vete-picking-hostinger.zip`** (o el contenido de la carpeta [`dist/`](dist/))

El paquete incluye:
- `index.html`: Interfaz SPA con marca **VETE**.
- `app.js`: Motor de base de datos Supabase, driver de pistola lectora USB, lector de cámara móvil y audio synth.
- `styles.css`: Estilos visuales industriales de alto contraste.
- `sw.js` & `manifest.json`: Soporte PWA para instalar la app en teléfonos Android/iOS y PCs en la planta.
- Iconos y recursos gráficos actualizados con la identidad de **VETE**.
- **`.htaccess` optimizado para Hostinger**:
  - Redirección automática a **HTTPS**.
  - Tipos MIME correctos para PWA (`.webmanifest`, `.json`, `.svg`).
  - Compresión **Gzip / Brotli** para carga ultra rápida en galpón.
  - Políticas de caché (Service Worker sin caché para actualizaciones inmediatas; activos estáticos cacheados por 30 días).
  - Encabezados de seguridad (`nosniff`, `X-XSS-Protection`).

---

## 🛠️ Pasos para Subir a Hostinger (3 minutos)

### Paso 1: Ingresar a Hostinger
1. Entra a tu panel de control de Hostinger (**hPanel**): [https://hpanel.hostinger.com](https://hpanel.hostinger.com).
2. Ve a la sección **Sitios Web** (Websites) y haz clic en **Administrar** junto a tu dominio.

### Paso 2: Abrir el Administrador de Archivos (File Manager)
1. En el menú lateral o en el panel de control, busca y abre el **Administrador de Archivos** (*File Manager*).
2. Entra en la carpeta raíz pública de tu sitio: **`public_html`**.
   *(Si hay un archivo por defecto como `default.php` o una página en blanco de Hostinger, puedes eliminarlo).*

### Paso 3: Subir y Extraer
1. En la barra superior del File Manager, haz clic en el botón **Subir** (ícono de flecha hacia arriba) y selecciona **Archivo**.
2. Selecciona el archivo **`vete-picking-hostinger.zip`** de tu computadora y espera que termine de subir.
3. Haz **clic derecho** sobre `vete-picking-hostinger.zip` y selecciona **Extraer** (*Extract*).
4. Elige como destino la misma carpeta `public_html` (o deja el punto `.`).
5. Todos los archivos (`index.html`, `app.js`, `.htaccess`, etc.) quedarán en la raíz de `public_html`.
6. *(Opcional)* Puedes borrar el archivo `.zip` para no ocupar espacio.

---

### Paso 4: ¡Probar tu Sistema!
Abre tu navegador e ingresa a tu dominio (ejemplo: `https://tudominio.com`):
1. Verás la pantalla de inicio de sesión de **VETE**.
2. Inicia sesión con:
   - **Usuario**: `admin`
   - **Contraseña**: `vete2026` *(o `admin2026`)*
3. Verifica el indicador superior: debe decir **"Base de Datos En Línea"** con punto verde.
4. Conecta tu pistola lectora o utiliza el lector de cámara / botón de colocación manual y ¡comienza a registrar empaques!

---

## 🔄 Cómo volver a compilar en el futuro

Si en el futuro haces cambios en el código y quieres volver a generar el paquete para Hostinger, simplemente abre una terminal en esta carpeta y ejecuta:

```bash
node build.js
```
Esto regenerará automáticamente la carpeta `dist/` y el archivo `vete-picking-hostinger.zip`.
