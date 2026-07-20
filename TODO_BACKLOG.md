# Backlog de Mejoras - Proyecto Reloj

Este archivo contiene las tareas y mejoras identificadas durante la auditoría del proyecto que se implementarán en fases futuras para mejorar la robustez, experiencia de usuario y calidad del código.

## 🚀 Prioridad Alta (Robustez y Corrección)
- [ ] **Validación de Datos en Frontend:** Implementar validaciones antes de enviar el formulario (ej. verificar que el monto sea mayor a cero y que los campos no estén vacíos).
- [ ] **Limpieza de Entradas (Backend):** Aplicar `.trim()` a las descripciones para evitar espacios en blanco accidentales en la base de datos.
- [ ] **Validación de Rango:** Asegurar en el backend que el monto sea un número positivo antes de procesarlo.

## ✨ Mejoras de Experiencia (UX/UI)
- [ ] **Feedback Visual Mejorado:** Reemplazar los `alert()` por notificaciones visuales integradas en la interfaz para una experiencia más fluida.
- [ ] **Manejo de Estado de Carga:** Añadir un indicador de "Cargando..." mientras el servidor procesa la solicitud del usuario.

## 🛠️ Refactorización y Mantenimiento
- [ ] **Consistencia de Codificación:** Asegurar que todos los caracteres especiales (como símbolos de moneda o grados) utilicen entidades HTML para evitar problemas en diferentes navegadores.
- [ ] **Refactorización de Mensajes:** Limpiar las cadenas de texto en el backend para eliminar errores de codificación y mejorar la legibilidad del log.

## 💡 Ideas Futuras
- [ ] Implementar un historial visual de gastos con filtros por fecha o categoría.
- [ ] Añadir una sección de "Resumen" que muestre cuánto debe cada persona automáticamente.
