# Aedos → Minijuego de aprendizaje (visión)

> Estado: **borrador aprobado a medias / para revisar en calma**. No es plan de
> ejecución inmediata. Captura la visión de producto para no perderla.
>
> Reframe central: **el propósito de la página no es producir un PDF bonito, es
> que el usuario entienda el tema que va a exponer.** La presentación es el
> subproducto; el aprendizaje es el producto.

---

## 1. El problema que estamos resolviendo

Hoy el flujo es: "pego un texto → la IA me devuelve una presentación". El
usuario es **pasivo**: no piensa el tema, no lo procesa, no lo hace suyo. En
el examen o la exposición lo va a pasar mal porque nunca lo entendió.

La idea: convertir la creación de la presentación en un **minijuego de
aprendizaje** — con sonido, estética amigable (no infantil), dinámica y
divertida — donde el usuario trabaja el tema a través de preguntas guiadas,
lluvia de ideas y explicaciones con sus propias palabras. El modelo actúa como
**tutor socrático**: pregunta, detecta huecos, y enseña rellenando solo lo que
falta.

## 2. Principios anti-estrés (críticos)

La tentación es "agregar más preguntas" y eso es lo *opuesto* a lo que
queremos. Reglas:

1. **Un solo foco a la vez.** Nunca pedir 10 cosas en una pantalla. Cada paso
   del juego pide una única cosa concreta.
2. **Defaults seguros.** Si el usuario no sabe qué responder, hay una opción
   recomendada ("El tema es nuevo para mí", "Tono formal", tamaño mediano…)
   con un solo clic. El juego avanza igual; no puede quedar atrapado.
3. **Siempre se puede saltar.** Toda pregunta tiene "Sáltame esta" sin castigo.
   El tutor rellena el hueco con lo académicamente correcto (y lo marca como
   "lo aprendiste después").
4. **Se aprende jugando, no llenando formularios.** Las preguntas se sienten
   como retos del juego, no como requisitos de configuración.
5. **Sin juicio.** Si el usuario no sabe algo, no es un error: es el *enganche*
   del juego ("¡Ese es justo el dato que te va a salvar en la expo!").

## 3. El loop del minijuego (concepto)

Una partida = una presentación. Progreso dividido en **misiones/niveles**, cada
uno mapeando un momento natural del tema (contexto → núcleo → datos → cierre)
o de la creación (punta del iceberg → qué sé → qué me falta → cómo lo cuento).

Estados posibles (no todos obligatorios en el MVP):

| Nivel | Qué hace el usuario | Qué hace el tutor |
|---|---|---|
| **1. Desafío** | Elige un tema (o una frase/concepto suelto) | Lo convierte en una misión clara: "Vas a dominar X" |
| **2. Qué sé yo** | Lluvia libre de lo que cree saber (palabras, frases, garabatos) | Valida, corrige con tacto, y detecta huecos |
| **3. Pre-check** | Mini-quiz de 2–3 preguntas sobre el tema | Calibra el nivel: si domina, contenido más denso; si no, más explicativo |
| **4. Cómo lo cuento** | Prefiere tono, duración, para quién es | No pregunta todo: infiere la mayoría, confirma solo lo esencial |
| **5. Co-creación** | Reordena/edita el outline (editor existente) | Sugiere solo lo que falta, pregunta socráticamente |
| **6. Ensayo** | Juego de "explica la diapositiva antes de verla" | Compara, aplaude lo bien dicho, enseña lo omitido |

La mecánica de recompensa: **XP y "streak"**, no por llenar datos sino por
*procesar el tema* (explicar con tus palabras, corregir una idea, conectar dos
diapositivas). Feedback visible y sonoro (toggle), logros amables sin presión.

## 4. Estética

- **Amigable, no infantil**: paleta cálida, tarjetas redondeadas, micro
  animaciones (motion ya está en el stack), emojis moderados, tipografía
  legible. Nada de dibujos/caricaturas ni de gamificación agresiva tipo
  slot machine.
- **Sonido**: efectos cortos y discretos (acierto, avance, "aha moment"),
  desactivables, volumen bajo por defecto. Sin música obligatoria.
- **Todo el feedback es formativo**: cada "acierto" incluye una frasecta que
  refuerza por qué es correcto.

## 5. Regla de oro de implementación (para no romper nada)

Esta visión **no sustituye** el flujo actual: se agrega como **modo opcional**
("Modo Tutor ⚡") detrás de un toggle en la pantalla de inicio. El flujo normal
("escribe un tema y listo") queda intacto para quien quiere rapidez. Así:

- Riesgo ≈ cero en producción mientras el modo nuevo madura.
- Podemos medir: ¿los usuarios del Modo Tutor entienden más el tema?
- El acuerdo de producto se valida con datos, no con opiniones.

**Qué se reutiliza tal cual** (no se demuele nada):
- Pipeline de 3 etapas (contenido → diseño → HTML) y render a PDF.
- Editor de outline (ya es co-autoría parcial).
- Editor de slides, sanitizadores, colas, límites, providers.

**Qué es nuevo**:
- Una máquina de estados conversacional "tutor" bajo `src/backend/tutor/`
  (turnos cortos, razonamiento bajo) que termina produciendo el mismo JSON de
  skeleton que el pipeline ya consume.
- Una vista de "misiones" en el frontend + capa de feedback/audio/XP.
- Un endpoint de "ensayo" para el nivel 6.

## 6. La métrica que define el éxito

No el nº de decks generados: **% de usuarios del Modo Tutor que responden el
pre-check y el pos-check (nivel 6) con mejor puntuación**. Si el usuario sale
entendiendo más su tema, la página cumple su propósito.

## 7. Siguientes pasos (cuando haya luz)

1. Desplegar/validar los fixes de fiabilidad (ya están en el working tree).
2. Prototipar el **Nivel 2 (Qué sé yo)** como una sola pantalla: input libre
   + tutor que devuelve "lo que ya sabes ✅ / huecos que te conviene cubrir 🧩"
   con sonido de acierto. Eso valida la mecánica sin construir todo.
3. Si la mecánica cargue, construir la máquina de estados completa.

---

*Noche del 2026-09-04/05: decisión explícita de NO tomar decisiones drásticas
ni demoler nada. Este doc existe para que la idea sobreviva a la mañana.*