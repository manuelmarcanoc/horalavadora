# HoraLavadora (PWA ultra-rápida)

Web estática minimalista para ver el **precio horario de la luz en España** y decidir cuándo usar electrodomésticos.

- Frontend: HTML + CSS moderno + Vanilla JS (sin frameworks)
- Datos: `public/data.json` generado desde la API de ESIOS (REE)
- Automatización: script Node.js + GitHub Actions
- Deploy: GitHub Pages o Vercel (sitio estático)

## 1) Requisitos

- Node.js 18+ (recomendado 20+)

## 2) Ejecutar en local

Instala dependencias (solo para el script/format, el frontend no requiere build):

```bash
npm install
```

Genera datos (pon tu token real):

```bash
set ESIOS_TOKEN=YOUR_ESIOS_TOKEN
npm run fetch
```

Sirve el sitio estático:

```bash
npm run dev
```

Abre `http://localhost:4173`.

## 3) Token ESIOS

El script usa `ESIOS_TOKEN` y envía:

- `Authorization: Token token="..."`  
- `x-api-key: ...`  

Si tu token funciona con solo una de las dos, no pasa nada (la API suele aceptar ambas; el script manda ambas por compatibilidad).

## 4) Estructura del JSON (`public/data.json`)

El archivo queda pensado para render rápido (una sola lectura, sin cálculos costosos):

- `generatedAt`: ISO timestamp de generación
- `timezone`: `"Europe/Madrid"`
- `currency`: `"EUR"`
- `unit`: `"EUR_PER_KWH"`
- `days`: array con 1 o 2 días (hoy y, si ya está publicado, mañana)
  - `date`: `"YYYY-MM-DD"`
  - `hours`: 24 items ordenados
    - `start`: ISO (hora inicio, zona Madrid)
    - `end`: ISO (hora fin, zona Madrid)
    - `price`: número en €/kWh

El frontend:

- muestra el **precio actual** (hora Madrid)
- colorea barato/medio/caro según percentiles del día
- destaca las **3 horas más baratas del día**
- calcula coste estimado para electrodomésticos comparando **ahora vs mejor hora futura**

