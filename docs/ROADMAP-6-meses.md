# Aedos → Roadmap 6 meses (salud mental primero)

> Estado: **vivo — se revisa trimestralmente y se recorta sin culpa.**
> Norte: **el propósito es que el usuario entienda su tema, no solo producir PDFs.**
> Contexto: el motor (pipeline, providers, PDF, editor) ya está **estable en main**.
> De aquí al deadline esto es **pulido de experiencia y estética**, no más features.

---

## 0. Lo primero: la regla de oro

**El deadline no se alcanza trabajando más; se alcanza recortando bien.**

Si una fase se retrasa, se **corta alcance**, nunca se alarga la jornada.
Un sprint atrasado que roba descanso es un sprint que roba al siguiente.

---

## 1. Reglas que protegen tu salud mental (no negociables)

1. **Máximo 4-5 días de trabajo por semana. Máximo ~6h de foco real por día.**
   Las horas no son el combustible; el descanso sí.
2. **Un viernes "Vitrina".** Cada semana hay 1 demo visible que mostrar
   (una pantalla pulida, un sonido, un flujo nuevo). Así el progreso se *siente*,
   que es lo que evita la ansiedad de "no estoy avanzando".
3. **Nunca 2 días seguidos de crunch.** Si surge, se recorta, se pospone, se pide
   ayuda; no se dobla la jornada dos días seguidos.
4. **Sunday reset.** El domingo no se toca código. Se lee el plan, se escribe la
   intención de la semana, y se termina.
5. **Feedback sin drama.** Los testers usan la app; se recogen 3 cosas concretas
   y se deciden por prioridad. Un comentario negativo = dato, no identidad.
6. **Revisión mensual (media jornada).** Qué avanzó, qué se descarta, cómo te
   sientes. Se ajusta el roadmap, no se juzga el rendimiento.
7. **El sprint 12 y 13 son reserva.** Antes del deadline, 4 semanas de buffer
   **sagradas**: imprevistos, enfermedad, vida. No se llenan por adelantado.

---

## 2. Mapa de fases (6 meses ≈ 13 sprints de 2 semanas)

Enfoque: **primero hacer que el flujo actual se sienta increíble** (estética +
menos fricción), **después** el Modo Tutor como diferenciador que enseña.

| Fase | Ventana | Foco | Entregable visible (Vitrina) |
|---|---|---|---|
| **F0 · Estabilidad** | Sprints 1-2 | Deploy congelado (solo hotfixes reales), monitoreo | 2 semanas seguidas sin crashes |
| **F1 · Aterrizaje UX** | Sprints 3-4 | Home que invita, camino claro a "crear", menos fricción | El flujo completo se siente fluido, no "beta" |
| **F2 · Estética cohesiva** | Sprints 5-6 | Design system: color, tipografía, espacio, las pantallas del Modo Tutor | Todas las pantallas se ven "de la misma familia" |
| **F3 · Modo Tutor MVP** | Sprints 7-10 | Niveles 1-3 (Desafío, Qué sé, Pre-check) end-to-end | Prototipo del tutor jugable, con sonido y XP básica |
| **F4 · Co-autoría + ensayo** | Sprints 11-13 | Niveles 4-6 (tono, co-creación con editor, ensayo) | Modo Tutor completo + gamificación ligera |
| **F5 · Pulido final** | Sprints 16-18 | Bugs críticos, accesibilidad, rendimiento, onboarding | Reporte de lanzamiento + página estable |

> El número de sprint **salta de 13 a 16** a propósito: los sprints 14-15 son
> **buffer de medio plazo** (vacaciones, imprevistos) que si no se usan se
> convierten en más pulido. El buffer no es opcional, es estructural.
>
> Resto de buffer: +2 semanas dentro/detrás de F5 para emergencias de último
> minuto. Estructura total: 18 sprints = 9 semanas de margen sobre 6 meses.

---

## 3. Estética y UX — qué significa "se siente increíble"

Hay una skill de **frontend-design** disponible. La idea es usarla por fases,
**no** todos los días:

- **Paleta cálida y accesible** (no choque visual), tarjetas redondeadas,
  micro-animaciones sutiles (el stack ya trae `motion`).
- **Feedback formativo y con cariño**: cada "acierto" del tutor refuerza el
  *porqué*, no solo premia.
- **Sonido discreto y desactivable** (toggle, bajo por defecto). Sin música
  obligatoria.
- **"Menos es más"**: antes de añadir un elemento, se *quita uno*.
- **El Modo Tutor se siente como un juego, no como un formulario disfrazado.**
  Preguntas en una sola pantalla a la vez, defaults seguros, "sáltame esta".

> Esto NO significa infantilizar: paleta amigable + sonido + microanimación,
> con contenido académico serio. La estética es el *vehículo* del
> aprendizaje, no el protagonista.

---

## 4. Qué NO hacer en estos 6 meses

- No abrir nuevos frentes técnicos (el motor ya es estable).
- No intentar "arreglar" el buscador de imágenes hasta tener VPS.
- No agregar features fuera de este mapa.
- No comparar con "días de 10h de código": el objetivo es *terminar sano*.

---

## 5. Cómo medir el progreso (para sentir que avanzas)

- **1 Vitrina por semana** (la demo de los viernes).
- **Funnel**: de "usuario llega" → "primera presentación generada".
- **Retención Modo Tutor**: % que responde pre-check y post-check (la métrica
  de éxito de la idea de tutor).
- **Check-in personal mensual**: energía, foco, claridad. Si baja 2 meses
  seguidos, se reduce alcance — eso también es éxito.

---

## 6. Historial de decisiones

- 2026-09-05: Se fija `main` como estable. Se abre la ventana de 6 meses de UX
  y estética. Se descarta (por ahora) la búsqueda de imágenes remota hasta
  tener VPS. Se adopta el modo "Vitrina semanal" y el sprint-buffer sagrado.