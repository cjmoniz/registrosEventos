(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const EVENT_KEY = 'rc.evento';
  const ME_KEY = 'rc.me';
  const OBS_MAX = 4000;
  const PREFIJO_TEL = '+58 ';
  const CARGOS = ['Gerente General', 'Director', 'Gerente', 'Tecnología', 'Finanzas', 'Compras', 'Comercial'];
  const DOMINIOS_GENERICOS = new Set([
    'gmail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com', 'yahoo.es', 'icloud.com', 'me.com',
    'msn.com', 'aol.com', 'protonmail.com', 'proton.me', 'gmx.com', 'hotmail.es', 'outlook.es', 'cantv.net',
  ]);

  let me = null;               // { id, alias, nombre, rol, categorias, proximos_pasos }
  let CATEGORIAS = [];
  let PASOS = [];
  let remotos = [];            // registros del servidor
  let seleccion = new Set();
  let pasos = new Set();
  let filtros = new Set();
  let sincronizando = false;
  let ultimo = null;           // último registro guardado (para "otro de esta empresa")
  let empresaAuto = false;     // empresa rellenada desde el dominio del email

  // ---------- almacenamiento local seguro ----------
  const ls = {
    get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  // Cola por usuario: un registro pendiente nunca se envía con la sesión de otra persona.
  const colaKey = () => `rc.pendientes.${me.id}`;
  const pendientes = () => ls.get(colaKey(), []);
  const setPendientes = (p) => ls.set(colaKey(), p);

  // ---------- API ----------
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (res.status === 401 && path !== '/api/login') sesionExpirada();
    return { ok: res.ok, status: res.status, data };
  }

  // ---------- vistas ----------
  function mostrar(vista) {
    $('#view-login').hidden = vista !== 'login';
    $('#view-app').hidden = vista !== 'app';
    if (vista === 'app') mantenerPantalla(); else soltarPantalla();
  }
  function tab(v) {
    document.querySelectorAll('nav button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    $('#view-form').hidden = v !== 'form';
    $('#view-list').hidden = v !== 'list';
    if (v === 'list') cargarLista();
  }
  document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => tab(b.dataset.view)));

  // ---------- login ----------
  $('#alias').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#pin').focus(); } });
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    const alias = $('#alias').value.trim().toLowerCase();
    const pin = $('#pin').value.trim();
    $('#loginErr').textContent = '';
    if (!alias || !/^\d{4,8}$/.test(pin)) { $('#loginErr').textContent = 'Ingresa usuario y PIN (4 a 8 dígitos).'; return; }
    btn.disabled = true;
    try {
      const r = await api('/api/login', { method: 'POST', body: { alias, pin } });
      if (!r.ok) { $('#loginErr').textContent = r.data?.error || 'No se pudo entrar.'; $('#pin').value = ''; $('#pin').focus(); return; }
      $('#pin').value = '';
      await iniciar();
    } catch {
      $('#loginErr').textContent = 'Sin conexión. Para entrar la primera vez se necesita internet.';
    } finally { btn.disabled = false; }
  });

  function sesionExpirada() {
    if (!me) return;
    toast('Tu sesión expiró. Vuelve a entrar.');
    $('#alias').value = me.alias;
    ls.del(ME_KEY);
    me = null;
    mostrar('login');
  }

  $('#logoutBtn').addEventListener('click', async () => {
    const n = pendientes().length;
    if (n && !confirm(`Tienes ${n} registro(s) sin sincronizar. Quedarán guardados en este dispositivo y se enviarán cuando vuelvas a entrar. ¿Salir?`)) return;
    try { await api('/api/logout', { method: 'POST', body: {} }); } catch {}
    ls.del(ME_KEY);
    me = null;
    limpiarForm();
    ocultarGuardado();
    mostrar('login');
  });

  async function iniciar() {
    let r = null;
    try { r = await api('/api/me'); } catch {
      // Sin red: si este dispositivo ya tenía sesión, se trabaja en modo offline.
      // El servidor sigue validando la cookie al sincronizar.
      const cache = ls.get(ME_KEY, null);
      if (cache) { arrancar(cache); toast('Sin conexión: los registros se enviarán al volver la red'); return; }
      mostrar('login');
      $('#loginErr').textContent = 'Sin conexión. Para entrar la primera vez se necesita internet.';
      return;
    }
    if (!r.ok) { ls.del(ME_KEY); mostrar('login'); return; }
    ls.set(ME_KEY, r.data);
    arrancar(r.data);
    sincronizar();
    cargarLista(true);
  }

  function arrancar(datos) {
    me = datos;
    CATEGORIAS = me.categorias || [];
    PASOS = me.proximos_pasos || [];
    $('#userName').textContent = me.nombre;
    $('#exportBtn').hidden = me.rol !== 'admin';
    renderPills();
    renderFiltros();
    renderCargos();
    mostrar('app');
    tab('form');
    actualizarContadores();
    actualizarEmpresas();
  }

  // ---------- evento ----------
  const eventInput = $('#eventName');
  eventInput.value = ls.get(EVENT_KEY, '') || 'Evento CaVeCeCo';
  eventInput.addEventListener('change', () => { ls.set(EVENT_KEY, eventInput.value.trim()); if (!$('#view-list').hidden) cargarLista(); });

  // ---------- pills ----------
  function pill(text, set, onChange, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pill' + (cls ? ' ' + cls : '');
    b.textContent = text;
    b.setAttribute('aria-pressed', String(set.has(text)));
    b.addEventListener('click', () => {
      set.has(text) ? set.delete(text) : set.add(text);
      b.setAttribute('aria-pressed', String(set.has(text)));
      onChange && onChange();
    });
    return b;
  }
  function renderPills() {
    $('#pills').replaceChildren(...CATEGORIAS.map((t) => pill(t, seleccion)));
    $('#pasos').replaceChildren(...PASOS.map((t) => pill(t, pasos)));
  }
  const renderFiltros = () => $('#filters').replaceChildren(...CATEGORIAS.map((t) => pill(t, filtros, renderLista, 'small')));

  // Cargos frecuentes: un toque rellena el campo (selección única)
  function renderCargos() {
    const cargo = $('#cargo');
    $('#cargoChips').replaceChildren(...CARGOS.map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pill';
      b.textContent = c;
      b.addEventListener('click', () => { cargo.value = cargo.value === c ? '' : c; marcarCargo(); });
      return b;
    }));
    marcarCargo();
  }
  function marcarCargo() {
    const v = $('#cargo').value.trim();
    $('#cargoChips').querySelectorAll('.pill').forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === v)));
  }
  $('#cargo').addEventListener('input', marcarCargo);

  // ---------- navegación con Enter ----------
  const ORDEN = ['empresa', 'contacto', 'email', 'telefono', 'cargo'];
  ORDEN.forEach((id, i) => {
    $('#' + id).addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      const sig = ORDEN[i + 1];
      if (sig) { $('#' + sig).focus(); return; }
      // Último campo: cierra el teclado y deja a la vista las categorías
      e.target.blur();
      $('#catLabel').scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  });

  // ---------- teléfono con prefijo ----------
  const tel = $('#telefono');
  tel.addEventListener('focus', () => {
    if (!tel.value) { tel.value = PREFIJO_TEL; requestAnimationFrame(() => tel.setSelectionRange(tel.value.length, tel.value.length)); }
  });
  tel.addEventListener('blur', () => { if (tel.value.trim() === PREFIJO_TEL.trim()) tel.value = ''; });
  const telefonoReal = (v) => (v.trim() === PREFIJO_TEL.trim() ? '' : v);

  // ---------- empresa: sugerencias y dominio del email ----------
  function todos() {
    const ids = new Set(remotos.map((r) => r.id));
    return [...(me ? pendientes() : []).filter((x) => !ids.has(x.id)), ...remotos];
  }
  function actualizarEmpresas() {
    const vistas = new Map();
    for (const r of todos()) {
      const k = (r.empresa || '').toLowerCase();
      if (k && !vistas.has(k)) vistas.set(k, r.empresa);
    }
    $('#empresasList').replaceChildren(...[...vistas.values()].slice(0, 300).map((e) => {
      const o = document.createElement('option');
      o.value = e;
      return o;
    }));
  }
  function empresaDesdeEmail(email) {
    const dom = (email.split('@')[1] || '').toLowerCase();
    if (!dom.includes('.') || DOMINIOS_GENERICOS.has(dom)) return '';
    const partes = dom.split('.');
    // acme.com.ve -> acme ; ventas.acme.com -> acme
    const base = partes.length > 2 && partes[partes.length - 2].length <= 3 ? partes[partes.length - 3] : partes[partes.length - 2];
    if (!base) return '';
    const conocida = todos().find((r) => (r.email || '').toLowerCase().endsWith('@' + dom) && r.empresa);
    if (conocida) return conocida.empresa;
    return base.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  $('#empresa').addEventListener('input', () => { empresaAuto = false; });
  $('#email').addEventListener('change', () => {
    const emp = $('#empresa');
    if (emp.value.trim() && !empresaAuto) return;
    const sug = empresaDesdeEmail($('#email').value.trim());
    if (sug) { emp.value = sug; empresaAuto = true; setErr('empresa', ''); }
  });

  // ---------- duplicados (aviso en línea, no bloquea) ----------
  const soloDigitos = (v) => String(v || '').replace(/\D/g, '');
  function revisarDuplicado() {
    const email = $('#email').value.trim().toLowerCase();
    const dig = soloDigitos(telefonoReal(tel.value));
    let hit = null;
    if (email && /@.+\./.test(email)) hit = todos().find((r) => r.email === email);
    if (!hit && dig.length >= 7) hit = todos().find((r) => r.telefono && soloDigitos(r.telefono).endsWith(dig.slice(-10)));
    const w = $('#dupWarn');
    w.hidden = !hit;
    if (hit) {
      const quien = hit.registrado_por_nombre ? ` por ${hit.registrado_por_nombre}` : '';
      $('#dupText').textContent = `Ya registrado: ${hit.contacto} · ${hit.empresa}${quien}. Puedes guardar igual.`;
    }
  }
  $('#email').addEventListener('input', revisarDuplicado);
  tel.addEventListener('input', revisarDuplicado);

  // ---------- observaciones: contador, dictado, transcripción ----------
  const obs = $('#observaciones');
  const actualizarObsCount = () => { $('#obsCount').textContent = obs.value.length; };
  obs.addEventListener('input', actualizarObsCount);

  function agregarObs(texto) {
    texto = texto.trim();
    if (!texto) return;
    const base = obs.value.trimEnd();
    let nuevo = base ? `${base}\n${texto}` : texto;
    if (nuevo.length > OBS_MAX) { nuevo = nuevo.slice(0, OBS_MAX); toast(`Observaciones recortadas a ${OBS_MAX} caracteres`); }
    obs.value = nuevo;
    actualizarObsCount();
    setErr('observaciones', '');
  }

  // Dictado en vivo (Web Speech API: Chrome, Edge, Safari). En Chrome el audio lo procesa Google.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const dictBtn = $('#dictBtn');
  const dictIcon = dictBtn.querySelector('use');
  const dictLabel = dictBtn.querySelector('span');
  let rec = null;
  if (SR) {
    dictBtn.hidden = false;
    dictBtn.setAttribute('aria-pressed', 'false');
    dictBtn.addEventListener('click', () => (rec ? rec.stop() : dictar()));
  }
  function estadoDictado(activo) {
    dictBtn.setAttribute('aria-pressed', String(activo));
    dictIcon.setAttribute('href', activo ? '#i-stop' : '#i-mic');
    dictLabel.textContent = activo ? 'Detener' : 'Dictar';
  }
  function dictar() {
    rec = new SR();
    rec.lang = 'es-VE';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) agregarObs(ev.results[i][0].transcript);
      }
    };
    rec.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') toast('Permite el micrófono para dictar');
      else if (ev.error !== 'no-speech' && ev.error !== 'aborted') toast('Error de dictado: ' + ev.error);
    };
    rec.onend = () => { rec = null; estadoDictado(false); };
    rec.start();
    estadoDictado(true);
  }

  // Cargar transcripción de nota de voz (.txt / .vtt / .srt)
  $('#txtBtn').addEventListener('click', () => $('#txtFile').click());
  $('#txtFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 200 * 1024) { toast('Archivo demasiado grande (máx. 200 KB)'); return; }
    const raw = await f.text();
    agregarObs(limpiarTranscripcion(raw));
    toast(`Transcripción cargada: ${f.name}`);
  });
  function limpiarTranscripcion(t) {
    return t
      .replace(/^﻿/, '')
      .replace(/^WEBVTT.*$/m, '')
      .split(/\r?\n/)
      .filter((l) => !/^\d+$/.test(l.trim()))
      .filter((l) => !/-->/.test(l))
      .map((l) => l.replace(/<[^>]+>/g, '').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ');
  }

  // ---------- validación ----------
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function setErr(id, msg) {
    $('#' + id).classList.toggle('invalid', !!msg);
    const e = document.querySelector(`.err[data-for="${id}"]`);
    if (e) e.textContent = msg || '';
  }
  function validar(d) {
    let ok = true;
    const chk = (id, msg) => { setErr(id, msg); if (msg) ok = false; };
    chk('empresa', d.empresa ? '' : 'Falta la empresa');
    chk('contacto', d.contacto ? '' : 'Falta el nombre del contacto');
    chk('email', d.email && !emailRe.test(d.email) ? 'Revisa el email' : '');
    const dig = soloDigitos(d.telefono);
    chk('telefono', d.telefono && (dig.length < 7 || dig.length > 15) ? 'Revisa el teléfono' : '');
    chk('observaciones', d.observaciones.length > OBS_MAX ? `Máximo ${OBS_MAX} caracteres` : '');
    if (ok && !d.email && !d.telefono) { setErr('email', 'Agrega email o teléfono'); setErr('telefono', ' '); ok = false; }
    return ok;
  }
  ['empresa', 'contacto', 'email', 'telefono'].forEach((id) => $('#' + id).addEventListener('input', () => setErr(id, '')));

  // ---------- guardar ----------
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

  $('#form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const val = (id) => $('#' + id).value.trim().replace(/\s+/g, ' ');
    const d = {
      empresa: val('empresa'), contacto: val('contacto'), cargo: val('cargo'),
      telefono: telefonoReal(val('telefono')), email: val('email').toLowerCase(),
      observaciones: obs.value.trim(),
    };
    if (!validar(d)) { const f = $('#form .invalid'); f && f.focus(); return; }

    const reg = {
      id: uuid(),
      capturado_en: new Date().toISOString(),
      evento: eventInput.value.trim(),
      ...d,
      categorias: CATEGORIAS.filter((c) => seleccion.has(c)),
      proximos_pasos: PASOS.filter((c) => pasos.has(c)),
    };
    const p = pendientes();
    p.push(reg);
    if (!setPendientes(p)) { toast('No se pudo guardar en el dispositivo'); return; }
    if (rec) rec.stop();
    ultimo = reg;
    limpiarForm();
    mostrarGuardado(reg);
    actualizarContadores();
    actualizarEmpresas();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    sincronizar();
  });

  function mostrarGuardado(reg) {
    $('#savedText').textContent = `Guardado: ${reg.contacto} · ${reg.empresa}`;
    $('#sameCoLabel').textContent = `Otro de ${reg.empresa.length > 22 ? reg.empresa.slice(0, 21) + '…' : reg.empresa}`;
    $('#savedBar').hidden = false;
  }
  function ocultarGuardado() { $('#savedBar').hidden = true; }

  // Otro contacto de la misma empresa: conserva empresa, categorías y próximo paso
  $('#sameCoBtn').addEventListener('click', () => {
    if (!ultimo) return;
    limpiarForm();
    $('#empresa').value = ultimo.empresa;
    seleccion = new Set(ultimo.categorias);
    pasos = new Set(ultimo.proximos_pasos);
    renderPills();
    ocultarGuardado();
    $('#contacto').focus();
  });
  $('#empresa').addEventListener('input', ocultarGuardado);
  $('#contacto').addEventListener('input', ocultarGuardado);

  function limpiarForm() {
    $('#form').reset();
    seleccion = new Set();
    pasos = new Set();
    empresaAuto = false;
    renderPills();
    marcarCargo();
    actualizarObsCount();
    $('#dupWarn').hidden = true;
    ['empresa', 'contacto', 'email', 'telefono', 'observaciones'].forEach((id) => setErr(id, ''));
  }
  $('#clearBtn').addEventListener('click', () => { limpiarForm(); ocultarGuardado(); $('#empresa').focus(); });

  // ---------- sincronización (cola offline) ----------
  async function sincronizar() {
    if (!me || sincronizando) return;
    sincronizando = true;
    try {
      for (const reg of pendientes()) {
        let r;
        try { r = await api('/api/registros', { method: 'POST', body: reg }); }
        catch { break; } // sin red: se reintenta luego
        if (r.status === 401) break;
        if (r.ok) {
          setPendientes(pendientes().filter((x) => x.id !== reg.id));
          remotos.unshift({ ...reg, registrado_por: me.id, registrado_por_nombre: me.nombre });
        } else if (r.status === 422) {
          setPendientes(pendientes().map((x) => (x.id === reg.id ? { ...x, _error: JSON.stringify(r.data?.errores || r.data) } : x)));
        } else break;
      }
    } finally {
      sincronizando = false;
      actualizarContadores();
      if (!$('#view-list').hidden) renderLista();
    }
  }
  window.addEventListener('online', sincronizar);
  setInterval(sincronizar, 30000);

  function actualizarContadores() {
    if (!me) return;
    const p = pendientes();
    $('#countNum').textContent = todos().length;
    const b = $('#pendingBadge');
    b.hidden = !p.length;
    b.textContent = p.length ? `${p.length} sin sincronizar` : '';
  }

  // ---------- lista ----------
  async function cargarLista(silencioso) {
    const q = $('#onlyEvent').checked && eventInput.value.trim() ? `?evento=${encodeURIComponent(eventInput.value.trim())}` : '';
    try {
      const r = await api('/api/registros' + q);
      if (r.ok) remotos = r.data;
      else if (!silencioso && r.status !== 401) toast('No se pudo cargar la lista');
    } catch { if (!silencioso) toast('Sin conexión: mostrando solo lo de este dispositivo'); }
    actualizarContadores();
    actualizarEmpresas();
    renderLista();
  }
  $('#onlyEvent').addEventListener('change', () => cargarLista());
  $('#search').addEventListener('input', renderLista);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function icono(id) {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('class', 'ic');
    s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(ns, 'use');
    u.setAttribute('href', '#' + id);
    s.append(u);
    return s;
  }

  function renderLista() {
    if (!me) return;
    const ids = new Set(remotos.map((r) => r.id));
    const pend = pendientes().filter((x) => !ids.has(x.id))
      .map((x) => ({ ...x, _pendiente: true, registrado_por: me.id, registrado_por_nombre: me.nombre }));
    const lista = [...pend, ...remotos];
    const q = $('#search').value.trim().toLowerCase();
    const items = lista.filter((r) => {
      if (filtros.size && !(r.categorias || []).some((c) => filtros.has(c))) return false;
      return !q || [r.empresa, r.contacto, r.email, r.telefono, r.cargo, r.observaciones, r.registrado_por_nombre].join(' ').toLowerCase().includes(q);
    });

    $('#stats').textContent = lista.length
      ? CATEGORIAS.map((c) => `${c}: ${lista.filter((r) => (r.categorias || []).includes(c)).length}`).join(' · ')
      : '';

    const list = $('#list');
    if (!items.length) {
      list.replaceChildren(el('div', 'empty card', lista.length ? 'Sin resultados para este filtro.' : 'Aún no hay registros en este evento.'));
      return;
    }
    list.replaceChildren(...items.map((r) => {
      const card = el('article', 'card item');
      const row = el('div', 'row');
      const left = el('div');
      left.append(el('h3', null, r.empresa));
      left.append(el('div', 'meta', [r.contacto, r.cargo].filter(Boolean).join(' — ')));
      left.append(el('div', 'meta', [r.telefono, r.email].filter(Boolean).join(' · ')));
      const right = el('div');
      right.append(el('div', 'time', new Date(r.capturado_en).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })));
      right.append(el('div', 'time', r.registrado_por_nombre || ''));
      const puedeBorrar = !r._pendiente && (me.rol === 'admin' || r.registrado_por === me.id);
      if (puedeBorrar) {
        const del = el('button', 'del');
        del.append(icono('i-trash'));
        del.title = 'Eliminar';
        del.setAttribute('aria-label', `Eliminar registro de ${r.contacto}`);
        del.addEventListener('click', () => borrar(r));
        right.append(del);
      }
      row.append(left, right);
      card.append(row);
      const tags = el('div', 'tags');
      (r.categorias || []).forEach((c) => tags.append(el('span', 'tag', c)));
      (r.proximos_pasos || []).forEach((c) => tags.append(el('span', 'tag paso', c)));
      if (r._pendiente) tags.append(el('span', 'tag warn', r._error ? 'Rechazado: revisar' : 'Sin sincronizar'));
      if (tags.childElementCount) card.append(tags);
      if (r.observaciones) card.append(el('div', 'note', r.observaciones));
      return card;
    }));
  }

  async function borrar(r) {
    if (!confirm(`¿Eliminar el registro de ${r.contacto} (${r.empresa})?`)) return;
    try {
      const res = await api(`/api/registros?id=${encodeURIComponent(r.id)}`, { method: 'DELETE' });
      if (!res.ok) { toast(res.data?.error || 'No se pudo eliminar'); return; }
      remotos = remotos.filter((x) => x.id !== r.id);
      actualizarContadores();
      renderLista();
    } catch { toast('Sin conexión'); }
  }

  // ---------- exportar (solo admin; el servidor lo valida) ----------
  $('#exportBtn').addEventListener('click', () => {
    const ev = $('#onlyEvent').checked ? eventInput.value.trim() : '';
    window.location.href = '/api/export' + (ev ? `?evento=${encodeURIComponent(ev)}` : '');
  });

  // ---------- pantalla siempre encendida (Wake Lock) ----------
  let wake = null;
  async function mantenerPantalla() {
    if (!('wakeLock' in navigator) || wake || document.visibilityState !== 'visible') return;
    try {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    } catch { wake = null; }
  }
  function soltarPantalla() { if (wake) { wake.release().catch(() => {}); wake = null; } }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && me) { mantenerPantalla(); sincronizar(); }
  });

  // ---------- toast ----------
  let tt;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(tt);
    tt = setTimeout(() => t.classList.remove('show'), 2400);
  }

  window.addEventListener('beforeunload', (e) => {
    if (me && ($('#empresa').value || $('#contacto').value)) { e.preventDefault(); e.returnValue = ''; }
  });

  // Logo opcional: si /logo.png no existe, se oculta (sin handlers inline por la CSP)
  document.querySelectorAll('img.logo').forEach((img) => {
    const ocultar = () => { img.hidden = true; };
    if (img.complete && !img.naturalWidth) ocultar(); else img.addEventListener('error', ocultar);
  });

  // App instalable + funciona sin conexión
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  iniciar();
})();
