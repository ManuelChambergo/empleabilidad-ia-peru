# ¿Tu puesto ya te pide IA?

Dashboard sobre la demanda de habilidades de inteligencia artificial en el
mercado laboral peruano. **544 avisos de empleo · 269 empresas · agosto 2026**,
capturados en LinkedIn y Laborum.

## Cómo verlo en local

El sitio carga los datos con `fetch`, así que abrir `index.html` con doble clic
no funciona — hace falta servirlo:

```bash
cd site
python -m http.server 8765
# http://localhost:8765
```

## Cómo se regeneran los datos

```bash
# desde la raíz del proyecto, con DATABASE_URL en .env
python export_json.py
```

Vuelca el corpus completo de Neon a `site/data/`. No hay backend: los 544 avisos
viajan al navegador (380 KB en total) y cada cifra se recalcula ahí al mover un
filtro. Eso hace que los filtros respondan al instante y que el sitio se pueda
publicar en GitHub Pages sin ningún servidor.

| Archivo | Qué trae |
|---|---|
| `data/avisos.json` | Los 544 avisos: puesto, empresa, sector, región, nivel, tipo de oferta, fecha, habilidades, estudios |
| `data/skills.json` | Diccionario de habilidades: nombre, dominio, y si la IA que piden es de uso, técnica o una mención genérica |
| `data/meta.json` | Cobertura del corpus, portales, consultoras y campos sin dato |

## Estructura

```
site/
  index.html
  assets/style.css     Ditrenzzo Pearl · solo modo claro
  assets/app.js        motor de filtros, render y diagnóstico de perfil
  data/*.json          generados por export_json.py
```

## Las ocho secciones

| # | Sección | Qué hace |
|---|---|---|
| 01 | El hallazgo | Barra apilada: qué papel juega la IA en cada aviso |
| 02 | Usarla o construirla | IA de uso, IA técnica y mención genérica |
| 03 | Qué te piden | Ranking de habilidades, coloreado por familia |
| 04 | Cómo se combinan | Matriz de co-ocurrencia de las 12 más pedidas |
| 05 | Tu perfil | Marcas lo que sabes → encaje y brecha, todo en el navegador |
| 06 | Quién contrata | Empresas, sectores, región y modalidad |
| 07 | Formación | Grado, carreras y nivel del puesto |
| 08 | Método | Fuentes, limpieza, huecos y sesgos |

Todo se recalcula con los filtros de arriba, incluido el interruptor de
consultoras. El diagnóstico de la sección 05 guarda tus habilidades en
`localStorage` y no las manda a ningún lado — no hay a dónde mandarlas.

### Dos habilidades que el pipeline no consolidó

`app.js` fusiona en el navegador tres pares de variantes que
`consolidar_skills.py` dejó pasar: `Excel`/`Microsoft Excel`,
`Airflow`/`Apache Airflow` y `Spark`/`Apache Spark`. Sin eso, Excel aparece
partido en 87 y 33 avisos y ninguna de las dos cifras es la buena. Si algún día
se arreglan en la base, la lista `ALIAS` se queda sin efecto sola.

## Advertencia sobre las cifras

Muestra no probabilística de dos portales. Sobre-representa empresas formales
medianas y grandes de Lima; no cubre pymes, bolsas de trabajo internas ni el
sector informal. Es una foto de avisos activos capturada en dos días, no una
serie temporal: **no permite afirmar que la demanda de IA suba o baje**. Los
porcentajes describen esta muestra, no «el mercado peruano».
