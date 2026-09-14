# Decisiones de arquitectura

Este directorio almacenará los registros de decisiones de arquitectura (ADR) de las próximas fases. Su objetivo es conservar el contexto y las consecuencias de decisiones importantes sin convertir la documentación de cada versión en un historial de debates.

## Convención

- Nombre: `NNNN-titulo-breve.md`, con numeración correlativa.
- Estados permitidos: `propuesta`, `aceptada`, `sustituida` o `rechazada`.
- Una decisión aceptada no se reescribe para cambiar su resultado; una nueva ADR la sustituye y enlaza ambas.
- Nunca se incluyen datos personales, capturas reales, credenciales o secretos.
- La ADR y los cambios que implementa deben formar parte del mismo commit siempre que sea posible.

## Plantilla

```markdown
# ADR NNNN — Título

- Estado: propuesta
- Fecha: YYYY-MM-DD
- Responsables: producto / ingeniería / seguridad
- Sustituye: ninguna

## Contexto

Problema, restricciones y fuerzas que obligan a tomar una decisión.

## Decisión

Solución elegida y límites exactos de su alcance.

## Alternativas consideradas

Opciones reales evaluadas y motivo de descarte.

## Consecuencias

Beneficios, costes, riesgos, operación y deuda asumida.

## Validación

Pruebas, métricas y criterio que demostrarán que la decisión funciona.
```

