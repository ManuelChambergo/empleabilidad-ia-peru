/* ═══════════════════════════════════════════════════════════════════════
   Motor del sitio. Sin backend: los 544 avisos viven en el navegador y cada
   cifra se recalcula al mover un filtro. A este tamano (194 KB) recorrer el
   corpus entero es mas barato que cualquier indice, asi que no hay ninguno.
   ═══════════════════════════════════════════════════════════════════════ */
(() => {
  "use strict";

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // Coma decimal y punto de millar, como se escriben las cifras en un
  // documento peruano. Ojo: la locale "es-PE" del navegador usa PUNTO decimal
  // (asi lo define CLDR), asi que da "30.3%" — por eso vamos con "es-ES".
  const LOC = "es-ES";
  const nf  = new Intl.NumberFormat(LOC);
  const pct = (n, d) => d ? (n / d * 100).toLocaleString(LOC, {
    minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%" : "0%";

  // Orden fijo: el color sigue a la categoria, nunca a su tamano. Si un
  // filtro deja una categoria en cero, las demas conservan su color.
  const TIPOS = [
    { id: "Puesto de IA",            serie: 1, glosa: "El rol nació con la IA como razón de ser." },
    { id: "Tradicional que pide IA", serie: 2, glosa: "El puesto existía antes y ahora la exige." },
    { id: "Datos sin IA",            serie: 3, glosa: "Analítica y datos, sin mención de IA." },
    { id: "Sin IA ni datos",         serie: 4, glosa: "Ni IA ni trabajo de datos." },
  ];

  const CUBOS_IA = [
    { f: 1, nom: "IA de uso",        serie: 2, glosa: "Manejar la herramienta: ChatGPT, Claude, Gemini, Copilot, prompting." },
    { f: 2, nom: "IA técnica",       serie: 1, glosa: "Construir el sistema: RAG, LangChain, PyTorch, MLOps, embeddings." },
    { f: 3, nom: "Mención genérica", serie: 4, glosa: "El aviso dice «Inteligencia Artificial» sin precisar qué espera." },
  ];

  // El pipeline guarda estos valores sin tilde. Se muestran bien escritos.
  const ROTULO = {
    Tecnico: "Técnico", Magister: "Magíster", Direccion: "Dirección",
    Hibrido: "Híbrido", Analitica: "Analítica",
  };
  const rot = t => ROTULO[t] || t;

  const ORDEN_NIVEL = ["Direccion", "Gerencia", "Jefatura", "Especialista",
                       "Analista", "Asistente", "Practicante", "No especificado"];
  const ORDEN_ESTUDIO = ["Estudiante", "Tecnico", "Egresado", "Bachiller",
                         "Titulado", "Magister", "Doctorado", "No especificado"];

  // Variantes que `consolidar_skills.py` dejo pasar y que aqui parten un
  // conteo en dos: Excel sale 87 por un lado y 33 por el otro, y ninguna de
  // las dos cifras es la verdadera. El primero de cada fila es el canonico.
  //
  // Solo se fusiona lo que la base clasifica IGUAL (mismo `ia`). `Airflow` y
  // `Apache Airflow` NO estan aqui a proposito: la base les da dominios
  // distintos (Data Engineering vs MLOps), asi que unirlos obliga a decidir si
  // Airflow cuenta como IA, y esa decision mueve el KPI de portada 1,3 puntos.
  // Es una correccion de criterio que va en el pipeline, no un parche de
  // presentacion. Ver el cierre de sesion.
  const ALIAS = [
    ["Excel", "Microsoft Excel"],
    ["Spark", "Apache Spark"],
    ["LLM", "LLMs"],
    ["Agentes de IA", "AI Agents", "Agentic AI"],
  ];

  const estado = { sector: "", region: "", nivel: "", sinConsultoras: false };
  let AVISOS = [], SKILLS = {}, META = {};

  // Catalogo del diagnostico y habilidades que el usuario marco.
  let CATALOGO = [];
  const MIAS = new Set();
  const LS_PERFIL = "ia-peru-perfil";

  // ── datos ───────────────────────────────────────────────────────────
  async function cargar() {
    const [a, s, m] = await Promise.all(
      ["avisos", "skills", "meta"].map(n =>
        fetch(`data/${n}.json`).then(r => {
          if (!r.ok) throw new Error(`data/${n}.json → ${r.status}`);
          return r.json();
        }))
    );
    AVISOS = a;
    META = m;
    SKILLS = Object.fromEntries(Object.entries(s).map(([k, v]) => [+k, v]));
    fusionarAlias();
    // `Tecnologia` sin tilde es un unico aviso que el pipeline dejo escapar, y
    // sin esto sale como un sector aparte en el desplegable y en el ranking.
    for (const v of AVISOS) if (v.s === "Tecnologia") v.s = "Tecnología";
  }

  /** Reescribe las variantes al id canonico. Por nombre, no por id: los ids
   *  cambian cada vez que se reexporta la base, los nombres no. */
  function fusionarAlias() {
    const porNombre = new Map();
    for (const [id, s] of Object.entries(SKILLS)) porNombre.set(s.n, +id);

    const mapa = new Map();
    for (const [canon, ...variantes] of ALIAS) {
      const destino = porNombre.get(canon);
      if (destino === undefined) continue;
      for (const v of variantes) {
        const origen = porNombre.get(v);
        if (origen === undefined) continue;
        // Red de seguridad: fusionar dos habilidades que la base clasifica
        // distinto haria que el conteo de IA dependiera de cual quedo como
        // canonico. Antes que adivinar, se deja el par sin tocar.
        if (SKILLS[origen].ia !== SKILLS[destino].ia) {
          console.warn(`ALIAS: «${v}» (ia=${SKILLS[origen].ia}) y «${canon}» ` +
            `(ia=${SKILLS[destino].ia}) no se fusionan: la base los clasifica distinto.`);
          continue;
        }
        mapa.set(origen, destino); delete SKILLS[origen];
      }
    }
    if (!mapa.size) return;
    // Set: un aviso que nombra las dos variantes sigue contando una sola vez.
    for (const a of AVISOS) a.sk = [...new Set(a.sk.map(id => mapa.get(id) ?? id))];
  }

  const filtrar = () => AVISOS.filter(v =>
    (!estado.sector || v.s === estado.sector) &&
    (!estado.region || v.r === estado.region) &&
    (!estado.nivel  || v.nv === estado.nivel) &&
    (!estado.sinConsultoras || !v.co));

  /** Cuántos avisos del conjunto piden al menos una habilidad de este cubo. */
  const conCubo = (vs, f) => vs.filter(v => v.sk.some(id => SKILLS[id]?.ia === f)).length;

  /** Familia visual de una habilidad. El color es el mismo en todo el sitio. */
  function familia(id) {
    const s = SKILLS[id];
    if (!s) return { serie: "var(--serie-4)", nom: "Oficio de siempre" };
    if (s.ia === 2) return { serie: "var(--serie-1)", nom: "IA técnica" };
    if (s.ia === 1) return { serie: "var(--serie-2)", nom: "IA de uso" };
    if (s.ia === 3) return { serie: "var(--ia-vaga)", nom: "IA sin precisar" };
    if (s.c === "Datos") return { serie: "var(--serie-3)", nom: "Datos y analítica" };
    return { serie: "var(--serie-4)", nom: "Oficio de siempre" };
  }

  /** Cuenta avisos por habilidad. Devuelve [[id, k], …] de mayor a menor. */
  function contarSkills(vs, filtro = () => true) {
    const c = new Map();
    for (const v of vs)
      for (const id of v.sk)
        if (filtro(SKILLS[id], id)) c.set(id, (c.get(id) || 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1] || cmp(SKILLS[a[0]]?.n, SKILLS[b[0]]?.n));
  }

  const cmp = (a, b) => String(a).localeCompare(String(b), "es");

  /** Cuenta avisos por valor de un campo, o por cada valor de un campo lista. */
  function contarCampo(vs, clave, { lista = false } = {}) {
    const c = new Map();
    for (const v of vs) {
      const vals = lista ? v[clave] : [v[clave]];
      for (const x of (vals || [])) if (x) c.set(x, (c.get(x) || 0) + 1);
    }
    return [...c].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
  }

  // ── ranking reutilizable ────────────────────────────────────────────
  /**
   * items: [{ nom, k, color, glosa? }]. La barra se escala contra el mayor
   * del propio ranking, no contra el total: con Python en 55% y la cola en 5%
   * escalar al total dejaria toda la lista en una raya invisible.
   */
  function pintarRank(cont, items, total, { escala = "max" } = {}) {
    cont.replaceChildren();
    if (!items.length) {
      cont.innerHTML = '<p class="vacio">Sin datos para estos filtros.</p>';
      return;
    }
    const tope = escala === "total" ? total : Math.max(...items.map(i => i.k), 1);

    items.forEach((it, i) => {
      const el = document.createElement("div");
      el.className = "rank__it";
      el.innerHTML =
        `<span class="rank__i">${i + 1}</span>` +
        `<span class="rank__nom" title="${esc(it.nom)}">` +
          `<span class="pip" style="background:${it.color}"></span>` +
          `<span>${esc(it.nom)}</span></span>` +
        `<span class="rank__pista"><span class="rank__relleno" style="background:${it.color}"></span></span>` +
        `<span class="rank__val">${nf.format(it.k)} · ${pct(it.k, total)}</span>`;
      cont.append(el);
      requestAnimationFrame(() => {
        el.querySelector(".rank__relleno").style.width = `${it.k / tope * 100}%`;
      });
    });
  }

  const esc = s => String(s).replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ── controles ───────────────────────────────────────────────────────
  function poblarSelects() {
    const llenar = (sel, valores) => {
      sel.append(...valores.map(v => new Option(rot(v), v)));
    };
    const unicos = k => [...new Set(AVISOS.map(v => v[k]))]
      .filter(Boolean).sort((a, b) => cmp(a, b));

    llenar($("#f-sector"), unicos("s"));
    llenar($("#f-region"), ["Lima", "Provincia", "No especificado"]
      .filter(r => AVISOS.some(v => v.r === r)));
    // el nivel es jerarquico: alfabetizarlo lo volveria ilegible
    llenar($("#f-nivel"), ORDEN_NIVEL.filter(n => AVISOS.some(v => v.nv === n)));

    $("#consultoras-cuenta").textContent =
      `${nf.format(META.consultoras.avisos)} avisos · ${pct(META.consultoras.avisos, META.avisos)}`;
  }

  function conectarControles() {
    const enlazar = (sel, clave) => $(sel).addEventListener("change", e => {
      estado[clave] = e.target.value;
      pintar();
    });
    enlazar("#f-sector", "sector");
    enlazar("#f-region", "region");
    enlazar("#f-nivel",  "nivel");

    $("#f-consultoras").addEventListener("change", e => {
      estado.sinConsultoras = e.target.checked;
      pintar();
    });

    $("#limpiar").addEventListener("click", () => {
      Object.assign(estado, { sector: "", region: "", nivel: "", sinConsultoras: false });
      $("#f-sector").value = $("#f-region").value = $("#f-nivel").value = "";
      $("#f-consultoras").checked = false;
      pintar();
    });
  }

  // ── render ──────────────────────────────────────────────────────────
  function pintar() {
    const vs = filtrar(), n = vs.length;
    const activo = estado.sector || estado.region || estado.nivel || estado.sinConsultoras;
    $("#limpiar").hidden = !activo;

    $("#cuenta").textContent = nf.format(n);
    $$("[data-n]").forEach(e => e.textContent = nf.format(n));

    pintarKpis(vs, n);
    pintarApilada(vs, n);
    pintarUso(vs, n);
    pintarHabilidades(vs, n);
    pintarMatriz(vs, n);
    pintarDiagnostico(vs);
    pintarContrata(vs, n);
    pintarFormacion(vs, n);
  }

  function pintarKpis(vs, n) {
    const set = (k, v) => { const e = $(`[data-kpi="${k}"]`); if (e) e.textContent = v; };
    const trans = vs.filter(v => v.tp === "Tradicional que pide IA").length;
    const algo  = vs.filter(v => v.sk.some(id => [1, 2, 3].includes(SKILLS[id]?.ia))).length;

    set("avisos", nf.format(n));
    set("avisos-pie", n === META.avisos ? "el corpus completo"
                                        : `de ${nf.format(META.avisos)} del corpus`);
    set("empresas", nf.format(new Set(vs.map(v => v.e)).size));
    set("transformados", pct(trans, n));
    set("transformados-pie", `${nf.format(trans)} avisos · el puesto existía antes`);
    set("algo-ia", pct(algo, n));
    set("algo-ia-pie", `${nf.format(algo)} avisos · usarla, construirla o mencionarla`);
  }

  function pintarApilada(vs, n) {
    const cont = $("#apilada"), tbody = $("#apilada-tabla tbody"), det = $("#hallazgo-detalle");
    cont.replaceChildren(); tbody.replaceChildren(); det.replaceChildren();

    if (!n) {
      cont.innerHTML = '<p class="vacio">Ningún aviso cumple estos filtros.</p>';
      return;
    }

    const datos = TIPOS.map(t => {
      const k = vs.filter(v => v.tp === t.id).length;
      return { ...t, k, p: k / n * 100 };
    });

    datos.forEach(d => {
      const seg = document.createElement("div");
      seg.className = "apilada__seg";
      seg.style.background = `var(--serie-${d.serie})`;
      // por debajo de ~9% no cabe la etiqueta larga; por debajo de ~4% no cabe
      // ni el porcentaje sin cortarse a media cifra
      if (d.p < 4) seg.dataset.estrecho = "2";
      else if (d.p < 9) seg.dataset.estrecho = "1";
      seg.innerHTML =
        `<span class="apilada__pct">${pct(d.k, n)}</span>` +
        `<span class="apilada__rot">${d.id}</span>`;
      seg.title = `${d.id}: ${nf.format(d.k)} avisos (${pct(d.k, n)})`;
      cont.append(seg);
      // el ancho se aplica tras el primer cuadro para que la transicion corra
      requestAnimationFrame(() => { seg.style.width = `${d.p}%`; });

      const it = document.createElement("div");
      it.className = "detalle__it";
      it.innerHTML =
        `<span class="detalle__ficha" style="background:var(--serie-${d.serie})"></span>` +
        `<span><span class="detalle__nom">${d.id}</span>` +
        `<span class="detalle__dat">${nf.format(d.k)} avisos · ${pct(d.k, n)}</span>` +
        `<span class="detalle__glosa">${d.glosa}</span></span>`;
      det.append(it);

      const tr = document.createElement("tr");
      tr.innerHTML = `<th scope="row">${d.id}</th><td>${nf.format(d.k)}</td><td>${pct(d.k, n)}</td>`;
      tbody.append(tr);
    });
  }

  function pintarUso(vs, n) {
    const cont = $("#barras-uso");
    cont.replaceChildren();

    if (!n) {
      cont.innerHTML = '<p class="vacio">Ningún aviso cumple estos filtros.</p>';
      $("#golpe").hidden = true;
      return;
    }
    $("#golpe").hidden = false;

    CUBOS_IA.forEach(c => {
      const k = conCubo(vs, c.f), p = k / n * 100;
      const it = document.createElement("div");
      it.className = "barra-it";
      it.innerHTML =
        `<div class="barra-it__cab">
           <span class="barra-it__nom">${c.nom}</span>
           <span><span class="barra-it__val">${pct(k, n)}</span>
                 <span class="barra-it__n">· ${nf.format(k)} avisos</span></span>
         </div>
         <div class="barra-it__pista"><div class="barra-it__relleno"
              style="background:var(--serie-${c.serie})"></div></div>
         <p class="barra-it__glosa">${c.glosa}</p>`;
      cont.append(it);
      requestAnimationFrame(() => {
        it.querySelector(".barra-it__relleno").style.width = `${p}%`;
      });
    });

    // Piden IA de uso pero ninguna habilidad tecnica de IA: el atajo que casi
    // no existe. Es la cifra que sostiene el titular de la seccion.
    const soloUso = vs.filter(v =>
      v.sk.some(id => SKILLS[id]?.ia === 1) &&
      !v.sk.some(id => SKILLS[id]?.ia === 2)).length;
    $('[data-golpe="n"]').textContent   = nf.format(soloUso);
    $('[data-golpe="total"]').textContent = nf.format(n);
    $('[data-golpe="pct"]').textContent = pct(soloUso, n);
  }

  // ── 03 · habilidades ────────────────────────────────────────────────
  function pintarHabilidades(vs, n) {
    const todas = contarSkills(vs);

    pintarRank($("#rank-hab"), todas.slice(0, 20).map(([id, k]) => ({
      nom: SKILLS[id].n, k, color: familia(id).serie,
    })), n);

    const tbody = $("#hab-tabla tbody");
    tbody.replaceChildren();
    todas.slice(0, 40).forEach(([id, k]) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<th scope="row">${esc(SKILLS[id].n)}</th>` +
                     `<td>${familia(id).nom}</td>` +
                     `<td>${nf.format(k)}</td><td>${pct(k, n)}</td>`;
      tbody.append(tr);
    });

    // Solo dominios de IA estricta: los siete que declara la nota al pie.
    const soloIA = contarSkills(vs, s => s && s.ia > 0);
    pintarRank($("#rank-ia"), soloIA.slice(0, 14).map(([id, k]) => ({
      nom: SKILLS[id].n, k, color: familia(id).serie,
    })), n);
  }

  // ── 04 · matriz de co-ocurrencia ────────────────────────────────────
  /** Las 12 habilidades concretas mas pedidas: sin blandas ni «IA» a secas. */
  const concreta = s => s && s.c !== "Blanda" && s.ia !== 3;

  function pintarMatriz(vs, n) {
    const caja = $("#matriz-caja");
    caja.replaceChildren();

    const top = contarSkills(vs, concreta).slice(0, 12);
    if (top.length < 2) {
      caja.innerHTML = '<p class="vacio">Hacen falta al menos dos habilidades para cruzarlas.</p>';
      $("#golpe-par").hidden = true;
      return;
    }
    $("#golpe-par").hidden = false;

    const ids = top.map(([id]) => id);
    const idx = new Map(ids.map((id, i) => [id, i]));
    const filaN = top.map(([, k]) => k);
    const par = ids.map(() => new Array(ids.length).fill(0));

    for (const v of vs) {
      const presentes = [];
      for (const id of v.sk) if (idx.has(id)) presentes.push(idx.get(id));
      for (const a of presentes) for (const b of presentes) if (a !== b) par[a][b]++;
    }

    const tabla = document.createElement("table");
    tabla.className = "matriz";
    tabla.innerHTML =
      `<caption class="visualmente-oculto">Porcentaje de avisos de cada fila que
        pide además la habilidad de cada columna</caption>`;

    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    trh.innerHTML = "<td></td>" + ids.map(id =>
      `<th scope="col"><div>${esc(SKILLS[id].n)}</div></th>`).join("");
    thead.append(trh);
    tabla.append(thead);

    const tbody = document.createElement("tbody");
    let mejor = null;
    ids.forEach((idA, a) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<th scope="row" title="${esc(SKILLS[idA].n)}">${esc(SKILLS[idA].n)}</th>`;
      ids.forEach((idB, b) => {
        const td = document.createElement("td");
        if (a === b) {
          // Con aria-hidden la fila declaraba una celda menos que la cabecera.
          td.dataset.diag = "1";
          td.innerHTML = '<span class="visualmente-oculto">misma habilidad</span>';
        } else {
          const p = filaN[a] ? par[a][b] / filaN[a] * 100 : 0;
          // La intensidad va contra el champagne de marca. El texto se queda
          // SIEMPRE en negro: incluso al 100% el fondo es #A97D3A, que contra
          // negro da 5,3:1 y contra blanco solo 3,7:1. Poner blanco en las
          // celdas fuertes las volvia lo menos legible de la tabla.
          td.style.background = `color-mix(in oklab, var(--champagne) ${Math.round(p)}%, var(--muted))`;
          td.textContent = Math.round(p);
          td.title = `${SKILLS[idA].n} → ${SKILLS[idB].n}: ` +
            `${nf.format(par[a][b])} de ${nf.format(filaN[a])} avisos (${pct(par[a][b], filaN[a])})`;
          // el par mas fuerte se busca con soporte suficiente: una fila de 12
          // avisos da porcentajes espectaculares que no significan nada
          if (filaN[a] >= 30 && (!mejor || p > mejor.p))
            mejor = { p, a: SKILLS[idA].n, b: SKILLS[idB].n, k: par[a][b], base: filaN[a] };
        }
        tr.append(td);
      });
      tbody.append(tr);
    });
    tabla.append(tbody);
    caja.append(tabla);

    if (mejor) {
      $('[data-par="pct"]').textContent = pct(mejor.k, mejor.base);
      $('[data-par="txt"]').innerHTML =
        `de los <strong>${nf.format(mejor.base)}</strong> avisos que piden ` +
        `<strong>${esc(mejor.a)}</strong> piden también <strong>${esc(mejor.b)}</strong> ` +
        `(${nf.format(mejor.k)} avisos). Aprender una sin la otra deja la mitad del ` +
        `requisito sin cubrir.`;
    } else {
      $("#golpe-par").hidden = true;
    }
  }

  // ── 05 · diagnóstico de perfil ──────────────────────────────────────
  /**
   * El catalogo se fija una sola vez sobre el corpus completo: si cambiara con
   * cada filtro, marcar una casilla haria desaparecer otra a media interaccion.
   * Quedan fuera las habilidades blandas (todos las marcarian) y el «IA» a
   * secas (nadie sabe si la tiene).
   */
  function armarCatalogo() {
    CATALOGO = contarSkills(AVISOS, concreta).slice(0, 28).map(([id]) => id);
    const set = new Set(CATALOGO);
    // interseccion pre-calculada por aviso: el diagnostico la recorre mucho
    for (const v of AVISOS) v._cat = v.sk.filter(id => set.has(id));
    $("#cat-n").textContent = nf.format(CATALOGO.length);
  }

  const UMBRAL = 2 / 3;
  const encaja = (v, mias) =>
    v._cat.filter(id => mias.has(id)).length / v._cat.length >= UMBRAL;

  function pintarChips() {
    const cont = $("#chips-perfil");
    cont.replaceChildren();
    const conteo = new Map(contarSkills(AVISOS, concreta));

    CATALOGO.forEach(id => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.setAttribute("aria-pressed", MIAS.has(id) ? "true" : "false");
      b.innerHTML = `${esc(SKILLS[id].n)} <span class="chip__n">${nf.format(conteo.get(id) || 0)}</span>`;
      b.addEventListener("click", () => {
        MIAS.has(id) ? MIAS.delete(id) : MIAS.add(id);
        b.setAttribute("aria-pressed", MIAS.has(id) ? "true" : "false");
        guardarPerfil();
        pintarDiagnostico(filtrar());
      });
      li.append(b);
      cont.append(li);
    });
  }

  function guardarPerfil() {
    // Solo el navegador del lector. No hay backend al que mandarlo.
    // Por NOMBRE, no por id: los ids cambian en cada reexport de la base, y
    // guardarlos hacia que al lector le aparecieran marcadas habilidades que
    // nunca marco.
    try {
      localStorage.setItem(LS_PERFIL,
        JSON.stringify([...MIAS].map(id => SKILLS[id]?.n).filter(Boolean)));
    } catch { /* modo privado */ }
  }

  function leerPerfil() {
    try {
      const g = JSON.parse(localStorage.getItem(LS_PERFIL) || "[]");
      if (!Array.isArray(g)) return;
      const porNombre = new Map(CATALOGO.map(id => [SKILLS[id].n, id]));
      for (const x of g) {
        const id = porNombre.get(x);
        if (id !== undefined) MIAS.add(id);
      }
    } catch { /* dato corrupto: se ignora */ }
  }

  function pintarDiagnostico(vs) {
    const cifra = $('[data-diag="cifra"]'), txt = $('[data-diag="txt"]');
    const cuerpo = $("#brecha-cuerpo");
    $("#limpiar-perfil").hidden = MIAS.size === 0;

    const evaluables = vs.filter(v => v._cat.length > 0);

    if (!MIAS.size) {
      cifra.textContent = "—";
      txt.textContent = "Marca al menos una habilidad para calcularlo.";
      cuerpo.innerHTML = '<p class="diag__vacio">Cuando marques tus habilidades, ' +
        'aquí aparecen las cinco que más avisos te abrirían.</p>';
      return;
    }
    if (!evaluables.length) {
      cifra.textContent = "—";
      txt.textContent = "Ningún aviso del filtro actual nombra habilidades del catálogo.";
      cuerpo.innerHTML = '<p class="diag__vacio">Sin avisos comparables en este filtro.</p>';
      return;
    }

    const dentro = evaluables.filter(v => encaja(v, MIAS));
    cifra.textContent = pct(dentro.length, evaluables.length);
    txt.innerHTML = `<strong>${nf.format(dentro.length)}</strong> de ` +
      `${nf.format(evaluables.length)} avisos comparables. Cubres al menos dos de ` +
      `cada tres de las habilidades del catálogo que piden.`;

    // Valor marginal: cuantos avisos MAS encajarian si sumaras esta habilidad.
    // Es la pregunta util — no «cual es la mas pedida», sino «cual me mueve la
    // aguja a mi, dado lo que ya se».
    const fuera = evaluables.filter(v => !encaja(v, MIAS));
    const brecha = CATALOGO
      .filter(id => !MIAS.has(id))
      .map(id => {
        const mas = new Set(MIAS); mas.add(id);
        return { id, gana: fuera.filter(v => v._cat.includes(id) && encaja(v, mas)).length };
      })
      .filter(x => x.gana > 0)
      .sort((a, b) => b.gana - a.gana || cmp(SKILLS[a.id].n, SKILLS[b.id].n))
      .slice(0, 5);

    if (!brecha.length) {
      cuerpo.innerHTML = '<p class="diag__vacio">Ninguna habilidad suelta del ' +
        'catálogo te abriría avisos nuevos: lo que falta viene en paquetes de dos ' +
        'o más. Mira la matriz de la sección anterior para ver cuáles viajan juntas.</p>';
      return;
    }

    cuerpo.innerHTML =
      `<ul class="brecha">${brecha.map((x, i) =>
        `<li><b>${i + 1}</b><span>${esc(SKILLS[x.id].n)}</span>` +
        `<span>+${nf.format(x.gana)}</span></li>`).join("")}</ul>` +
      `<p class="diag__txt" style="margin-top:.9rem">La cifra es cuántos avisos ` +
      `más pasarían a encajar contigo si sumaras esa sola habilidad.</p>`;
  }

  function conectarPerfil() {
    $("#limpiar-perfil").addEventListener("click", () => {
      MIAS.clear();
      $$("#chips-perfil .chip").forEach(b => b.setAttribute("aria-pressed", "false"));
      guardarPerfil();
      pintarDiagnostico(filtrar());
    });

    $("#copiar-perfil").addEventListener("click", async e => {
      const b = e.currentTarget, original = b.textContent;
      const vs = filtrar(), evaluables = vs.filter(v => v._cat.length > 0);
      const dentro = evaluables.filter(v => encaja(v, MIAS)).length;

      const texto = MIAS.size
        ? `Encajo con el ${pct(dentro, evaluables.length)} de los avisos de IA y datos ` +
          `en Perú (${nf.format(dentro)} de ${nf.format(evaluables.length)}).\n` +
          `Lo que manejo: ${[...MIAS].map(id => SKILLS[id].n).join(", ")}.\n` +
          `Calculado sobre ${nf.format(META.avisos)} avisos reales de LinkedIn y Laborum, agosto 2026.`
        : `${nf.format(META.avisos)} avisos de empleo en Perú analizados: el 28,9% son ` +
          `puestos de siempre que ahora piden IA.`;

      try {
        await navigator.clipboard.writeText(texto);
        b.textContent = "Copiado ✓";
      } catch {
        b.textContent = "No se pudo copiar";
      }
      setTimeout(() => { b.textContent = original; }, 2200);
    });
  }

  // ── 06 · quién contrata ─────────────────────────────────────────────
  function pintarContrata(vs, n) {
    const emp = contarCampo(vs, "e");
    $("#emp-total").textContent = nf.format(emp.length);

    // el color separa lo que el interruptor saca de lo que deja
    const esConsultora = new Map();
    for (const v of vs) if (!esConsultora.has(v.e)) esConsultora.set(v.e, v.co);

    pintarRank($("#rank-emp"), emp.slice(0, 12).map(([nom, k]) => ({
      nom, k, color: esConsultora.get(nom) ? "var(--serie-4)" : "var(--serie-2)",
    })), n);

    const cola = emp.filter(([, k]) => k === 1).length;
    $("#emp-cola").innerHTML =
      `<b>La cola es larguísima.</b> ${nf.format(cola)} de las ` +
      `${nf.format(emp.length)} empresas publicaron un solo aviso ` +
      `(${pct(cola, emp.length)}). No hay un puñado de empresas moviendo el ` +
      `mercado: hay muchísimas pidiendo una cosa cada una.`;

    pintarRank($("#rank-sector"), contarCampo(vs, "s").slice(0, 12).map(([nom, k]) => ({
      nom, k, color: "var(--serie-1)",
    })), n);

    const ordenar = (pares, orden) => orden
      .map(x => [x, (pares.find(([nom]) => nom === x) || [, 0])[1]])
      .filter(([, k]) => k > 0);

    pintarRank($("#rank-region"),
      ordenar(contarCampo(vs, "r"), ["Lima", "Provincia", "No especificado"])
        .map(([nom, k]) => ({ nom: rot(nom), k, color: "var(--serie-3)" })), n, { escala: "total" });

    pintarRank($("#rank-modalidad"),
      ordenar(contarCampo(vs, "m"), ["Remoto", "Hibrido", "Presencial", "No especificado"])
        .map(([nom, k]) => ({ nom: rot(nom), k, color: "var(--serie-4)" })), n, { escala: "total" });

    $("#sin-modalidad").textContent = nf.format(
      vs.filter(v => v.m === "No especificado").length);
  }

  // ── 07 · formación ──────────────────────────────────────────────────
  function pintarFormacion(vs, n) {
    const est = contarCampo(vs, "ne", { lista: true });
    // jerarquico: de menos a mas grado, con el hueco de dato al final
    const porOrden = ORDEN_ESTUDIO
      .map(x => [x, (est.find(([nom]) => nom === x) || [, 0])[1]])
      .filter(([, k]) => k > 0);

    pintarRank($("#rank-estudio"), porOrden.map(([nom, k]) => ({
      nom: rot(nom), k,
      color: nom === "No especificado" ? "var(--serie-4)" : "var(--serie-2)",
    })), n);

    pintarRank($("#rank-carrera"), contarCampo(vs, "ca", { lista: true })
      .slice(0, 12).map(([nom, k]) => ({ nom, k, color: "var(--serie-2)" })), n);

    const niv = contarCampo(vs, "nv");
    pintarRank($("#rank-nivel"), ORDEN_NIVEL
      .map(x => [x, (niv.find(([nom]) => nom === x) || [, 0])[1]])
      .filter(([, k]) => k > 0)
      .map(([nom, k]) => ({
        nom: rot(nom), k,
        color: nom === "No especificado" ? "var(--serie-4)" : "var(--serie-1)",
      })), n);
  }

  // ── 08 · tabla de datos faltantes ───────────────────────────────────
  // Sale de meta.json: describe el corpus entero, no el filtro. Un dato que
  // falta no deja de faltar porque filtres.
  function pintarSinDato() {
    const filas = [
      ["Salario", META.sin_dato.salario, "los avisos peruanos casi nunca publican rango"],
      ["Modalidad", META.sin_dato.modalidad, "no dicen si es remoto, híbrido o presencial"],
      ["Ciudad", META.sin_dato.ciudad, "no declaran dónde se trabaja"],
      ["Nivel del puesto", META.sin_dato.nivel, "el título no da ninguna señal de seniority"],
    ];
    $("#sin-dato").innerHTML = filas.map(([campo, k, glosa]) =>
      `<tr><th scope="row">${campo}<br><span class="dato-glosa">${glosa}</span></th>` +
      `<td>${nf.format(k)}</td><td>${pct(k, META.avisos)}</td></tr>`).join("");
  }

  // ── spotlight ───────────────────────────────────────────────────────
  // El halo champagne sigue al cursor dentro de cada tarjeta .spotlight.
  // Se apaga con reduced-motion: es decoracion, no informacion.
  function conectarSpotlight() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    addEventListener("pointermove", e => {
      const caja = e.target instanceof Element && e.target.closest(".spotlight");
      if (!caja) return;
      const r = caja.getBoundingClientRect();
      caja.style.setProperty("--mouse-x", `${e.clientX - r.left}px`);
      caja.style.setProperty("--mouse-y", `${e.clientY - r.top}px`);
    }, { passive: true });
  }

  // ── navegación activa ───────────────────────────────────────────────
  function conectarNav() {
    const enlaces = $$(".barra__nav a");
    const porId = new Map(enlaces.map(a => [a.hash.slice(1), a]));
    const visibles = new Set();

    const obs = new IntersectionObserver(entradas => {
      entradas.forEach(e => e.isIntersecting ? visibles.add(e.target.id)
                                             : visibles.delete(e.target.id));
      // la primera seccion visible en el documento manda
      const activa = [...porId.keys()].find(id => visibles.has(id));
      enlaces.forEach(a => a.removeAttribute("aria-current"));
      if (activa) porId.get(activa).setAttribute("aria-current", "true");
    }, { rootMargin: "-25% 0px -60% 0px" });

    porId.forEach((_, id) => { const s = document.getElementById(id); if (s) obs.observe(s); });
  }

  // ── arranque ────────────────────────────────────────────────────────
  conectarSpotlight();
  cargar().then(() => {
    poblarSelects();
    conectarControles();
    armarCatalogo();
    leerPerfil();
    pintarChips();
    conectarPerfil();
    pintarSinDato();
    conectarNav();
    pintar();
  }).catch(err => {
    console.error(err);
    $("#contenido").insertAdjacentHTML("afterbegin",
      `<p class="vacio">No se pudieron cargar los datos (${esc(err.message)}).
       Si abriste el archivo directamente, sírvelo con un servidor local:
       <code>python -m http.server</code>.</p>`);
  });
})();
