# Referencias visuales compartidas

Copiar la carpeta `Diseno` completa dentro de cada proyecto. Las capturas de `Referencias/` muestran la línea estética común, la ubicación del crédito obligatorio y la barra lateral expandida y compacta; `AGENTS.md` contiene las reglas para el agente de IA.

Al iniciar un proyecto o pedir un cambio de interfaz al agente, decirle: **«Revisa la carpeta Diseno»**. La primera instrucción de `AGENTS.md` también le exige hacerlo antes de diseñar.

Colocar las imágenes de logo del proyecto directamente en `Diseno/`. **Toda imagen en ese nivel se trata como logo** y sirve para extraer la paleta y crear un favicon circular de 64 × 64 px. Mantener mockups, capturas y otras imágenes ilustrativas dentro de `Referencias/`.

Para que un agente que trabaja en todo el proyecto encuentre las reglas automáticamente, colocar una copia de `Diseno/AGENTS.md` en la raíz del proyecto como `AGENTS.md`, o agregar esta indicación al `AGENTS.md` que ya exista:

> Para cualquier cambio de interfaz, leer y seguir `Diseno/AGENTS.md`, los logos de `Diseno/` y los mockups de `Diseno/Referencias/`.

Si el proyecto ya tiene instrucciones propias, integrarlas con esta guía; no sobrescribirlas. Verificar que todas las vistas principales muestren el crédito obligatorio en la parte inferior de la barra lateral según `AGENTS.md`.
