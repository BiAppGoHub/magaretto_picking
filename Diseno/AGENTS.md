# Guía de diseño para agentes de IA

**Antes de empezar cualquier trabajo de interfaz: revisa la carpeta Diseno.** Lee este archivo, inspecciona los logos colocados directamente en `Diseno/` y abre los mockups pertinentes de `Diseno/Referencias/` antes de tomar decisiones de diseño.

Esta carpeta es la referencia visual compartida para las aplicaciones y sistemas del equipo. Al incorporarla a un proyecto, aplicar estas reglas a todas las pantallas nuevas y a las pantallas existentes que se modifiquen. Las imágenes de `Referencias/` son ejemplos de apariencia y estructura, no contenido literal: sustituir TaskFlow Pro, nombres, datos y funciones de ejemplo por los del producto real.

## Logos, paleta y favicon

- **Toda imagen colocada directamente en esta carpeta `Diseno/` se considera un logo del proyecto.** Las capturas y mockups van en `Referencias/`, nunca junto a los logos. Conservar los archivos originales sin modificarlos.
- Revisar todos los logos de `Diseno/`, identificar el logo principal y sus variantes, y extraer de ellos los colores de marca. Definir tokens de color con valores hexadecimales para acento principal, acento secundario, fondos suaves, texto y estados. Elegir combinaciones con contraste legible. La paleta del logo del proyecto prevalece sobre el violeta de los mockups; conservar la estructura y la sobriedad de las referencias.
- Determinar si alguno de los logos contiene un **isologo**, es decir, un símbolo o emblema que puede reconocerse y usarse sin el nombre escrito. Si existe, usar ese símbolo para el favicon. Si no existe, usar el logo completo, conservando sus proporciones y sin inventar un símbolo nuevo.
- Crear un favicon **PNG de 64 × 64 px** sobre un lienzo cuadrado transparente, con un **fondo circular** en un color de la paleta extraída. Centrar el isologo o logo dentro del círculo con margen suficiente; elegir la combinación de símbolo y fondo que dé mejor contraste. No estirar, recortar partes importantes ni deformar el logo.
- Comprobar visualmente el favicon a 64, 32 y 16 px; si el logo completo es ancho, ajustarlo al espacio disponible sin sustituirlo por letras inventadas. Guardar el favicon generado como recurso del proyecto, enlazarlo desde la aplicación y verificar que aparece en el navegador.

## Referencias

- `Referencias/Dashboard Principal.png`: estructura general, métricas, gráficos y tareas recientes.
- `Referencias/Gestión de Clientes.png`: tablas, búsqueda, estados y paginación.
- `Referencias/Tablero Kanban.png`: columnas, tarjetas, prioridades y progreso.
- `Referencias/Tareas de la Semana.png`: tarjetas de agenda y estados vacíos.
- `Referencias/Configuración.png`: formularios, pestañas y preferencias.
- `Referencias/Referencia pie barra lateral.png`: ubicación obligatoria del crédito del desarrollador. Usar esta captura solo para la posición del crédito; no copiar su paleta, logo ni contenido del dashboard.
- `Referencias/Barra lateral expandida.png` y `Referencias/Barra lateral compacta.png`: los dos estados de la navegación y la ubicación de sus botones. Usar estas capturas para el comportamiento y la distribución, no para copiar la paleta ni los datos del ejemplo.

Antes de diseñar o modificar una pantalla, abrir las imágenes pertinentes. Mantener la misma familia visual aunque el producto tenga módulos distintos.

## Identidad visual

- Apariencia de software de gestión: clara, ordenada, moderna y sobria. Usar espacios amplios, jerarquía nítida y pocos adornos.
- Fondo principal `#F8F9FF`; barra lateral `#EFF4FF`; tarjetas y paneles `#FFFFFF`.
- Texto principal `#0B1C30`; texto secundario `#545F73`; bordes y separadores en lavanda grisáceo claro (aprox. `#D5E0F8`).
- Si aún no se proporcionó un logo, usar violeta como acento provisional para las acciones principales: base sugerida `#6412D5`, con variantes próximas a `#7C3AED` para hover, gráficos y selección. Cuando haya logo, reemplazar esos acentos por los colores extraídos de él y centralizarlos en tokens consistentes.
- Para el ítem activo del menú y los fondos informativos, usar un tono claro derivado de la paleta del logo; `#D5E0F8` es solo la referencia provisional sin logo. Usar verde para éxito, rojo para error o atraso y ámbar para advertencia; nunca comunicar un estado solo por color.
- Tipografía sans serif legible, similar a Inter. Escala sugerida: títulos de página 30–34 px, títulos de sección 22–26 px, cuerpo 14–16 px y metadatos 12–13 px. Peso 600–700 para títulos; 400–500 para texto.
- Radios suaves: 8–12 px en campos y botones; 12–16 px en tarjetas. Sombras muy sutiles y bordes finos. Evitar efectos pesados, neón y gradientes extensos.

## Estructura y componentes

- En escritorio, usar barra lateral fija o estable a la izquierda, de aproximadamente 250 px cuando esté expandida. Arriba, identidad del producto; debajo, navegación con icono y etiqueta; abajo, bloque de usuario, crédito del desarrollador y salida de sesión cuando correspondan. Marcar claramente la sección activa.
- El área principal lleva título y breve descripción, seguidos de acciones y contenido. Mantener márgenes de unos 32 px y separación regular de 16–32 px.
- Usar tarjetas blancas para métricas, formularios, listas y gráficos. Las tablas deben tener encabezados claros, filas separadas, acciones reconocibles y adaptación móvil.
- Botón principal con el acento de marca y texto de alto contraste; acciones secundarias con borde discreto o estilo textual. Mostrar hover, foco, carga, deshabilitado y confirmación cuando aplique.
- Badges de estado pequeños y legibles. En Kanban, distinguir columna, tarjeta, prioridad y avance. En formularios, incluir etiquetas visibles, mensajes de error junto al campo y confirmación tras guardar.
- En móvil, reemplazar la barra lateral por navegación accesible y reorganizar tarjetas, tablas y columnas sin desbordamiento horizontal de toda la página. Mantener objetivos táctiles cómodos y foco visible.
- Textos reales en español del producto, con terminología consistente. Los mockups mezclan español e inglés; eso no es una regla de contenido.

## Barra lateral que se puede contraer

- Implementar los dos estados mostrados en `Referencias/Barra lateral expandida.png` y `Referencias/Barra lateral compacta.png`. En el estado expandido se ven logo, iconos y nombres de las secciones; en el compacto, una columna estrecha con el logo reducido y los iconos de navegación.
- Incluir un botón claro para contraer la barra en su parte superior, junto al logo, como en la imagen expandida. En el estado compacto, incluir el botón para volver a abrirla en la zona inferior, encima de la salida de sesión, como en la imagen compacta. El mismo control debe poder alternar ambos estados sin recargar la página.
- Al contraerla, liberar espacio para el contenido principal y mantener visible el indicador de la sección activa. El icono y el destino de cada opción deben seguir siendo los mismos. Mostrar el nombre de la opción mediante tooltip al pasar el cursor y con foco de teclado; dar a cada botón o enlace un nombre accesible.
- Recordar la preferencia de barra expandida o compacta al navegar entre pantallas y al recargar la aplicación. El botón debe indicar su acción actual, por ejemplo «Contraer menú» o «Expandir menú», y exponer el estado a tecnologías de asistencia.
- En pantallas pequeñas usar un menú que se pueda abrir y cerrar sin desbordar el contenido; no forzar la barra compacta de escritorio sobre la vista móvil.

## Crédito obligatorio en el pie de la barra lateral

Ubicar el crédito en la zona inferior de la barra lateral expandida, como en `Referencias/Referencia pie barra lateral.png`: debajo del bloque de usuario y encima de «Cerrar sesión». Centrarlo y darle un estilo discreto, con suficiente contraste para leerlo. Mantener este bloque anclado al pie de la barra lateral mientras la navegación se desplaza, sin superponer otros controles. Si el producto muestra una versión, colocarla debajo del crédito y encima de «Cerrar sesión»; la versión es opcional. En el estado compacto se puede ocultar el texto por falta de espacio, como en el ejemplo, pero debe reaparecer al expandir la barra.

Mostrar siempre el texto **«Desarrollado por BiAppGo»**. Solo **BiAppGo** va en negrita y debe ser un enlace a `https://biappgo.com` que se abra en una pestaña nueva. En HTML, usar `target="_blank"` y `rel="noopener noreferrer"`. Mantener el texto visible y el enlace accesible por teclado. No cambiar el nombre, la capitalización ni la URL entre proyectos.

En móvil, incluir el mismo crédito en la parte inferior del menú lateral o panel de navegación, cerca del bloque de usuario y de «Cerrar sesión». Si la navegación móvil usa otra estructura, conservar esa agrupación y hacer que el crédito sea fácil de encontrar sin tapar contenido ni acciones.

## Criterio de entrega

Comprobar visualmente al menos una vista de escritorio y una móvil. Probar la barra lateral abierta y compacta, su botón, la navegación, los tooltips y la preferencia después de recargar. Verificar consistencia de tokens, contraste, estados interactivos y presencia del crédito en la ubicación indicada cuando la barra está expandida. Si el producto ya tiene identidad de cliente, adaptar logo y nombre sin perder la estructura, la claridad y la familia cromática definidas aquí.
