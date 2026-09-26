// ==========================================
// 1. CONFIGURACIÓN DE SUPABASE Y FIREBASE
// ==========================================
const SUPABASE_URL = 'https://mpomtdtmdsggybhnvdof.supabase.co';
const SUPABASE_KEY = 'sb_publishable_5Z828OdqG-DuZNcgYJq_lQ_eMp-zeBk';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const firebaseConfig = {
  apiKey: "AIzaSyBoAEj2D9wUNZrRFSmdxOM1scqm0urNfRo",
  authDomain: "control-envasado-agua.firebaseapp.com",
  projectId: "control-envasado-agua",
  storageBucket: "control-envasado-agua.firebasestorage.app",
  messagingSenderId: "337600183929",
  appId: "1:337600183929:web:1f019b401521161a2e1ea8"
};

const VAPID_KEY = "BF_3H1pli2NFqoTH2corhZst279V0S3f1Hhoyw5tEQb9cNKmNEQMJzhceaYtQT5LWVfB8upVOggBhiaG7Ikz6s8";

let messaging = null;
if (typeof firebase !== 'undefined' && firebase.messaging.isSupported()) {
  firebase.initializeApp(firebaseConfig);
  messaging = firebase.messaging();
}

// Estados globales
let registros = [];
let solicitudes = [];
let currentUser = null;
let selectedRoleTemp = '';

let chartInstance = null;
let dailyChartInstance = null;
let loteActivoId = null;

let fechaSeleccionadaPanel = null;
let estadoEnvasadoIniciado = false;
let horaInicioEnvasado = null;
let solicitudSeleccionadaModal = null;

// Variable para acumular cilindros seleccionados en la sesión del modal
let cilindrosAcumuladosParaLote = [];

const CREDENTIALLS = {
  operador: {
    gustavo: { nombre: 'Gustavo Silva', pass: 'gustavo123' },
    paul: { nombre: 'Paul Hernandez', pass: 'paul123' }
  },
  admin: { pass: 'admin123' },
  jefe: {
    karent: { nombre: 'Karent Namuche', pass: 'karent2026' }
  }
};

function cargarOpcionesCilindros() {
  const selectCilindro = document.getElementById('numCilindro');
  if (!selectCilindro) return;
  selectCilindro.innerHTML = '<option value="" disabled selected>-- Seleccione Cilindro --</option>';
  for (let i = 1; i <= 27; i++) {
    const num = i.toString().padStart(3, '0');
    const codigo = `OW${num}`;
    const option = document.createElement('option');
    option.value = codigo;
    option.textContent = codigo;
    selectCilindro.appendChild(option);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const picker = document.getElementById('cal-fecha-picker');
  if (picker) picker.valueAsDate = new Date();

  cargarOpcionesCilindros();
  registrarServiceWorkerYNotificaciones();
  
  inicializarGraficos();
  
  await cargarSolicitudesDesdeSupabase();
  await cargarRegistrosDesdeSupabase();
  
  renderizarCalendario();
  suscribirSupabaseRealtime();
});

function registrarServiceWorkerYNotificaciones() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./firebase-messaging-sw.js')
      .then((registration) => {
        solicitarPermisoNotificaciones(registration);
      })
      .catch((err) => console.error('SW Error:', err));
  }
}

async function solicitarPermisoNotificaciones(registration) {
  if (!messaging) return;
  if (typeof Notification === 'undefined') return;

  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const token = await messaging.getToken({ serviceWorkerRegistration: registration, vapidKey: VAPID_KEY });
      if (token) await guardarTokenEnSupabase(token);
    }
  } catch (err) {
    console.error('Error FCM:', err);
  }
}

async function guardarTokenEnSupabase(tokenFCM) {
  const { data: existente } = await supabaseClient.from('dispositivos_tokens').select('fcm_token').eq('fcm_token', tokenFCM);
  if (!existente || existente.length === 0) {
    await supabaseClient.from('dispositivos_tokens').insert([{ fcm_token: tokenFCM, usuario: 'User_' + Math.floor(Math.random() * 1000) }]);
  }
}

async function enviarNotificacionPush(titulo, cuerpo) {
  console.log(`[Notificación simulada localmente]: ${titulo} - ${cuerpo}`);
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(titulo, { body: cuerpo, icon: './icon-192.png' });
  }
}

// ==========================================
// 2. CARGA DE DATOS DESDE SUPABASE
// ==========================================
async function cargarRegistrosDesdeSupabase() {
  const { data, error } = await supabaseClient
    .from('registros_cilindros')
    .select('*')
    .order('created_at', { ascending: true });

  if (!error && data) {
    registros = data.map(item => ({
      id: item.id,
      cilindro: item.cilindro,
      lote: item.lote_id,
      lote_id: item.lote_id,
      fecha: item.fecha_envasado || item.fecha,
      responsable: item.creado_por,
      conductividad: parseFloat(item.conductividad ?? 0),
      dureza: parseFloat(item.dureza ?? 0),
      ph: parseFloat(item.ph ?? 0),
      cloro: parseFloat(item.cloro ?? 0),
      olor: item.olor,
      color: item.color,
      conforme: item.conforme,
      enviado: item.enviado === true || String(item.enviado) === 'true',
      hora_inicio: item.hora_inicio,
      hora_fin: item.hora_fin
    }));
    actualizarUI();
  }
}

async function cargarSolicitudesDesdeSupabase() {
  const { data, error } = await supabaseClient
    .from('solicitudes')
    .select('*')
    .order('created_at', { ascending: false });

  if (!error && data) {
    solicitudes = data;
    const lotePendiente = solicitudes.find(s => s.estado === 'Pendiente' || s.estado === 'En Proceso');
    loteActivoId = lotePendiente ? lotePendiente.id : null;
    renderSolicitudes();
  }
}

function suscribirSupabaseRealtime() {
  supabaseClient.channel('public:solicitudes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes' }, async () => {
      await cargarSolicitudesDesdeSupabase();
      actualizarUI();
    }).subscribe();

  supabaseClient.channel('public:registros_cilindros')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'registros_cilindros' }, async () => {
      await cargarRegistrosDesdeSupabase();
      actualizarUI();
    }).subscribe();
}

// ==========================================
// 3. SELECCIÓN DE ROL Y AUTENTICACIÓN
// ==========================================
function seleccionarRol(rol) {
  selectedRoleTemp = rol;
  document.getElementById('role-selection').style.display = 'none';
  document.getElementById('form-login').style.display = 'flex';
  document.getElementById('login-error').style.display = 'none';

  const groupUsuario = document.getElementById('group-usuario');
  const labelUsuario = document.getElementById('label-usuario');
  const selectUsuario = document.getElementById('login-user');
  const loginTitle = document.getElementById('login-title');

  if (rol === 'operador') {
    loginTitle.textContent = 'Acceso Operador';
    labelUsuario.textContent = 'Operador de Turno';
    groupUsuario.style.display = 'flex';
    selectUsuario.innerHTML = `<option value="gustavo">Gustavo Silva</option><option value="paul">Paul Hernandez</option>`;
  } else if (rol === 'admin') {
    loginTitle.textContent = 'Acceso Administrador';
    groupUsuario.style.display = 'none';
  } else if (rol === 'jefe') {
    loginTitle.textContent = 'Acceso Jefe de Producción';
    labelUsuario.textContent = 'Jefe de Producción';
    groupUsuario.style.display = 'flex';
    selectUsuario.innerHTML = `<option value="karent">Karent Namuche</option>`;
  }
}

function volverARoles() {
  document.getElementById('role-selection').style.display = 'flex';
  document.getElementById('form-login').style.display = 'none';
}

function procesarLogin(e) {
  e.preventDefault();
  const pass = document.getElementById('login-pass').value;

  if (selectedRoleTemp === 'operador') {
    const userKey = document.getElementById('login-user').value;
    const opData = CREDENTIALLS.operador[userKey];
    if (pass === opData.pass) {
      currentUser = { role: 'operador', nombre: opData.nombre };
      iniciarSesionApp();
    } else mostrarErrorLogin();
  } else if (selectedRoleTemp === 'admin') {
    if (pass === CREDENTIALLS.admin.pass) {
      currentUser = { role: 'admin', nombre: 'Administrador' };
      iniciarSesionApp();
    } else mostrarErrorLogin();
  } else if (selectedRoleTemp === 'jefe') {
    const userKey = document.getElementById('login-user').value;
    const jefeData = CREDENTIALLS.jefe[userKey];
    if (pass === jefeData.pass) {
      currentUser = { role: 'jefe', nombre: jefeData.nombre };
      iniciarSesionApp();
    } else mostrarErrorLogin();
  }
}

function mostrarErrorLogin() {
  document.getElementById('login-error').style.display = 'block';
}

function iniciarSesionApp() {
  document.getElementById('login-modal').style.display = 'none';
  document.getElementById('app-content').style.display = 'block';
  document.getElementById('user-display-tag').textContent = `${currentUser.nombre} (${currentUser.role.toUpperCase()})`;

  if (currentUser.role === 'operador') {
    const elemResp = document.getElementById('responsable');
    if (elemResp) elemResp.value = currentUser.nombre;
  }

  aplicarPermisosPorRol();
  actualizarUI();
}

function cerrarSesion() {
  currentUser = null;
  document.getElementById('login-modal').style.display = 'flex';
  document.getElementById('app-content').style.display = 'none';
  volverARoles();
}

function aplicarPermisosPorRol() {
  const formSolicitud = document.getElementById('form-solicitud');
  if (currentUser && currentUser.role === 'jefe') {
    if (formSolicitud) formSolicitud.style.display = 'grid';
  } else {
    if (formSolicitud) formSolicitud.style.display = 'none';
  }
}

// ==========================================
// 4. SOLICITUDES CON BÚSQUEDA Y SELECCIÓN
// ==========================================
function renderSolicitudes() {
  const container = document.getElementById('lista-solicitudes');
  if (!container) return;
  
  const filtro = (document.getElementById('searchSolicitud')?.value || '').toLowerCase();
  container.innerHTML = '';

  const solicitudesFiltradas = solicitudes.filter(sol => 
    sol.id.toLowerCase().includes(filtro) || (sol.fecha_completado && sol.fecha_completado.includes(filtro))
  );

  if (solicitudesFiltradas.length === 0) {
    container.innerHTML = '<p style="font-size: 0.85rem; color: #666;">No hay solicitudes que coincidan.</p>';
    return;
  }

  solicitudesFiltradas.forEach(sol => {
    const estaCompletado = sol.estado === 'Completado';
    const enProceso = sol.estado === 'En Proceso';
    
    const div = document.createElement('div');
    div.className = `solicitud-card ${estaCompletado ? 'completada' : ''}`;
    div.style.border = "1px solid #ddd";
    div.style.padding = "10px";
    div.style.marginBottom = "8px";
    div.style.borderRadius = "6px";

    let estadoBadge = '<span style="color: orange; font-weight: bold;">Pendiente</span>';
    if (estaCompletado) {
      estadoBadge = '<span style="color: green; font-weight: bold;">✓ Completado</span>';
    } else if (enProceso) {
      estadoBadge = '<span style="color: #0d6efd; font-weight: bold;">🔄 En Proceso</span>';
    }

    let htmlContent = `
      <div class="solicitud-info">
        <h4><i class="fa-solid fa-box"></i> ${sol.producto}</h4>
        <p>ID Lote: <strong>${sol.id}</strong> | Fecha: <strong>${sol.fecha_completado || '-'}</strong></p>
        <p>Estado: ${estadoBadge}</p>
      </div>
      <div class="solicitud-acciones" style="margin-top: 8px; display: flex; gap: 8px;">
    `;

    if (estaCompletado) {
      htmlContent += `<button class="btn btn-secondary" onclick="verTablaLoteCompletado('${sol.id}')">📊 Ver Tabla</button>`;
    } else if (currentUser && currentUser.role === 'operador') {
      htmlContent += `<button class="btn btn-primary" onclick="abrirModalSeleccionarCilindros('${sol.id}')">📦 Asignar Cilindros Disponibles</button>`;
    }

    htmlContent += `</div>`;
    div.innerHTML = htmlContent;
    container.appendChild(div);
  });
}

function filtrarSolicitudes() {
  renderSolicitudes();
}

async function crearSolicitudLote(e) {
  e.preventDefault();
  const detalle = document.getElementById('sol-cilindros').value;
  const fechaEntrega = document.getElementById('sol-fecha').value;

  const numeroFormateado = (solicitudes.length + 1).toString().padStart(3, '0');
  const idSol = `A026.261-${numeroFormateado}`;

  const { error } = await supabaseClient.from('solicitudes').insert([
    {
      id: idSol,
      producto: detalle,
      estado: 'Pendiente',
      creado_por: currentUser ? currentUser.nombre : 'Sistema',
      fecha_completado: fechaEntrega
    }
  ]);

  if (!error) {
    document.getElementById('sol-cilindros').value = '';
    document.getElementById('sol-fecha').value = '';
    await enviarNotificacionPush("Nueva Solicitud de Lote", `Lote ${idSol} solicitado para ${fechaEntrega}`);
    await cargarSolicitudesDesdeSupabase();
    actualizarUI();
  }
}

// ==========================================
// 5. CALENDARIO DE ENVASADO
// ==========================================
function renderizarCalendario() {
  const container = document.getElementById('calendar-render-area');
  const vista = document.getElementById('cal-vista').value;
  const fechaVal = document.getElementById('cal-fecha-picker').value;
  
  if (!container || !fechaVal) return;
  const fechaActual = new Date(fechaVal + 'T00:00:00');

  container.innerHTML = '';

  if (vista === 'dia') {
    const div = document.createElement('div');
    const fStr = fechaActual.toISOString().split('T')[0];
    div.className = 'cal-day-box';
    div.style.padding = "15px";
    div.style.border = "1px solid #007bff";
    div.style.borderRadius = "8px";
    div.style.background = "#eef6ff";
    div.innerHTML = `<h3>Fecha: ${fStr}</h3><p>Haz clic para abrir el panel de control de envasado de este día.</p>`;
    div.onclick = () => abrirPanelFecha(fStr);
    container.appendChild(div);
  } else if (vista === 'mes') {
    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(7, 1fr)';
    grid.style.gap = '5px';

    const año = fechaActual.getFullYear();
    const mes = fechaActual.getMonth();
    const diasEnMes = new Date(año, mes + 1, 0).getDate();

    for (let d = 1; d <= diasEnMes; d++) {
      const diaFecha = new Date(año, mes, d);
      const fStr = diaFecha.toISOString().split('T')[0];
      
      const box = document.createElement('div');
      box.style.border = "1px solid #ccc";
      box.style.padding = "10px";
      box.style.textAlign = "center";
      box.style.cursor = "pointer";
      box.style.borderRadius = "4px";

      const cilindrosDia = registros.filter(r => r.fecha === fStr);
      if (cilindrosDia.length > 0) box.style.background = "#d4edda";

      box.innerHTML = `<strong>${d}</strong><br><small>${cilindrosDia.length} Cil.</small>`;
      box.onclick = () => abrirPanelFecha(fStr);
      grid.appendChild(box);
    }
    container.appendChild(grid);
  } else {
    container.innerHTML = `<p style="padding:10px;">Vista ${vista.toUpperCase()} seleccionada para ${fechaVal}. Haga clic abajo para ingresar al día actual.</p>
    <button class="btn btn-primary" onclick="abrirPanelFecha('${fechaVal}')">Abrir Día ${fechaVal}</button>`;
  }
}

// ==========================================
// 6. PANEL DE CONTROL DE ENVASADO Y DESPACHO
// ==========================================
function abrirPanelFecha(fechaStr) {
  fechaSeleccionadaPanel = fechaStr;
  document.getElementById('titulo-panel-fecha').innerHTML = `<i class="fa-solid fa-clock"></i> Registro de Envasado - ${fechaStr}`;
  document.getElementById('panel-envasado-fecha').style.display = 'block';

  const regDia = registros.filter(r => r.fecha === fechaStr);
  if (regDia.length > 0 && regDia[0].hora_inicio) {
    estadoEnvasadoIniciado = true;
    horaInicioEnvasado = regDia[0].hora_inicio;
    actualizarEstadoBotonesEnvasado(true);
  } else {
    estadoEnvasadoIniciado = false;
    horaInicioEnvasado = null;
    actualizarEstadoBotonesEnvasado(false);
  }

  renderTablaDia();
  window.scrollTo({ top: document.getElementById('panel-envasado-fecha').offsetTop - 20, behavior: 'smooth' });
}

function cerrarPanelFecha() {
  document.getElementById('panel-envasado-fecha').style.display = 'none';
}

function actualizarEstadoBotonesEnvasado(iniciado) {
  const btnIni = document.getElementById('btn-iniciar-envasado');
  const btnFin = document.getElementById('btn-finalizar-envasado');
  const label = document.getElementById('label-estado-envasado');
  const formDia = document.getElementById('sec-formulario-dia');

  if (iniciado) {
    btnIni.disabled = true;
    btnFin.disabled = false;
    label.textContent = "Envasado En Curso";
    label.style.background = "#28a745";
    if (currentUser && currentUser.role === 'operador') formDia.style.display = 'block';
  } else {
    btnIni.disabled = false;
    btnFin.disabled = true;
    label.textContent = "Envasado No Iniciado";
    label.style.background = "#6c757d";
    formDia.style.display = 'none';
  }
}

async function iniciarEnvasado() {
  const ahora = new Date().toTimeString().split(' ')[0];
  horaInicioEnvasado = ahora;
  estadoEnvasadoIniciado = true;
  actualizarEstadoBotonesEnvasado(true);

  await enviarNotificacionPush("Inicio de Envasado", `Se inició el envasado para la fecha ${fechaSeleccionadaPanel} a las ${ahora}`);
}

async function finalizarEnvasado() {
  const ahora = new Date().toTimeString().split(' ')[0];
  
  const { error } = await supabaseClient
    .from('registros_cilindros')
    .update({ hora_fin: ahora })
    .eq('fecha_envasado', fechaSeleccionadaPanel);

  if (error) {
    alert("Error al finalizar envasado: " + error.message);
    return;
  }

  estadoEnvasadoIniciado = false;
  actualizarEstadoBotonesEnvasado(false);

  await enviarNotificacionPush("Finalización de Envasado", `Se finalizó el envasado para la fecha ${fechaSeleccionadaPanel} a las ${ahora}`);
  
  await cargarRegistrosDesdeSupabase();
  renderTablaDia();
  actualizarUI();
}

const formAguaDia = document.getElementById('form-agua-dia');
if (formAguaDia) {
  formAguaDia.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!estadoEnvasadoIniciado) {
      alert("Debe pulsar 'Iniciar Envasado' para poder registrar cilindros.");
      return;
    }

    const cilindro = document.getElementById('numCilindro').value;
    const conductividad = parseFloat(document.getElementById('conductividad').value);
    const dureza = parseFloat(document.getElementById('dureza').value);
    const ph = parseFloat(document.getElementById('ph').value);
    const cloro = parseFloat(document.getElementById('cloro').value);
    const olor = document.getElementById('olor').value;
    const color = document.getElementById('color').value;

    const conforme = (conductividad <= 70.0 && dureza <= 2.0 && ph >= 6.0 && ph <= 7.0 && cloro < 0.01 && olor === 'CC' && color === 'CC');
    const idUnico = `${fechaSeleccionadaPanel}_${cilindro}`;

    const nombreUsuario = currentUser ? currentUser.nombre : 'Operador';

    const { error } = await supabaseClient.from('registros_cilindros').insert([{
      id: idUnico,
      lote_id: loteActivoId || 'STOCK_GENERAL',
      cilindro: cilindro,
      conductividad: conductividad,
      dureza: dureza,
      ph: ph,
      cloro: cloro,
      olor: olor,
      color: color,
      conforme: conforme,
      creado_por: nombreUsuario,
      fecha_envasado: fechaSeleccionadaPanel,
      fecha: fechaSeleccionadaPanel,
      hora_inicio: horaInicioEnvasado,
      enviado: false
    }]);

    if (!error) {
      document.getElementById('numCilindro').selectedIndex = 0;
      document.getElementById('conductividad').value = '';
      document.getElementById('dureza').value = '';
      document.getElementById('ph').value = '';
      document.getElementById('cloro').value = '';
      
      await cargarRegistrosDesdeSupabase();
      renderTablaDia();
      actualizarUI();
    } else {
      alert("Error guardando registro: " + error.message);
    }
  });
}

function renderTablaDia() {
  const tbody = document.getElementById('tabla-body-dia');
  if (!tbody) return;
  tbody.innerHTML = '';

  const registrosDia = registros.filter(r => r.fecha === fechaSeleccionadaPanel);

  if (registrosDia.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;">No hay cilindros registrados para la fecha ${fechaSeleccionadaPanel}.</td></tr>`;
    return;
  }

  registrosDia.forEach(r => {
    const tr = document.createElement('tr');
    if (r.enviado) {
      tr.style.backgroundColor = '#d1e7dd';
    }

    tr.innerHTML = `
      <td><strong>${r.cilindro}</strong></td>
      <td>${r.fecha} ${r.hora_inicio || ''}</td>
      <td>${r.responsable || '-'}</td>
      <td>${r.conductividad}</td>
      <td>${r.dureza}</td>
      <td>${r.ph}</td>
      <td>${r.cloro}</td>
      <td>${r.olor}</td>
      <td>${r.color}</td>
      <td><span class="badge ${r.conforme ? 'badge-success' : 'badge-danger'}">${r.conforme ? 'SI' : 'NO'}</span></td>
      <td><strong>${r.enviado ? 'ENVIADO' : 'EN STOCK'}</strong></td>
      <td class="col-accion">
        ${currentUser && currentUser.role === 'admin' ? `<button class="btn-delete" onclick="eliminarRegistro('${r.id}')"><i class="fa-solid fa-trash"></i></button>` : '-'}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function eliminarRegistro(id) {
  if (confirm("¿Eliminar registro?")) {
    await supabaseClient.from('registros_cilindros').delete().eq('id', id);
    await cargarRegistrosDesdeSupabase();
    renderTablaDia();
    actualizarUI();
  }
}

// ==========================================
// 7. VINCULACIÓN Y ASIGNACIÓN DE CILINDROS DE MULTIPLES FECHAS
// ==========================================
function abrirModalSeleccionarCilindros(idSolicitud) {
  solicitudSeleccionadaModal = String(idSolicitud).trim();
  cilindrosAcumuladosParaLote = []; // Reiniciar acumulador
  
  const selectFecha = document.getElementById('select-fecha-disponible');
  if (selectFecha) {
    selectFecha.innerHTML = '<option value="TODAS">-- Ver Todas las Fechas --</option>';

    // Extraer fechas con cilindros que sigan en Stock (no enviados)
    const fechasDisponibles = [...new Set(
      registros
        .filter(r => !r.enviado)
        .map(r => r.fecha)
    )];

    fechasDisponibles.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = `Fecha: ${f}`;
      selectFecha.appendChild(opt);
    });
  }

  document.getElementById('modal-seleccionar-cilindros').style.display = 'flex';
  cargarCilindrosPorFechaSeleccionada();
}

function cerrarModalSeleccionCilindros() {
  const modal = document.getElementById('modal-seleccionar-cilindros');
  if (modal) modal.style.display = 'none';
  cilindrosAcumuladosParaLote = [];
}

function cargarCilindrosPorFechaSeleccionada() {
  const selectFecha = document.getElementById('select-fecha-disponible');
  const tbody = document.getElementById('tabla-body-cilindros-disponibles');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  const valorFecha = selectFecha ? selectFecha.value : 'TODAS';

  // Filtrar cilindros en stock que no hayan sido agregados en la sesión actual
  const cilindrosStock = registros.filter(r => {
    const estaEnStock = !r.enviado;
    const noEstaEnAcumulado = !cilindrosAcumuladosParaLote.includes(String(r.id));
    
    if (valorFecha === 'TODAS') {
      return estaEnStock && noEstaEnAcumulado;
    }
    return estaEnStock && noEstaEnAcumulado && r.fecha === valorFecha;
  });

  if (cilindrosStock.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">No hay cilindros en stock disponibles para la fecha seleccionada.</td></tr>`;
    return;
  }

  cilindrosStock.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" class="chk-cilindro" value="${c.id}"></td>
      <td><strong>${c.cilindro}</strong></td>
      <td>${c.fecha}</td>
      <td>${c.conductividad ?? '-'}</td>
      <td>${c.ph ?? '-'}</td>
      <td><span class="badge badge-success">En Stock</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// Guarda los cilindros seleccionados de la fecha elegida y permite seguir agregando más de otra fecha
async function guardarCilindrosEnSolicitud() {
  const checkboxes = document.querySelectorAll('.chk-cilindro:checked');
  const seleccionados = Array.from(checkboxes).map(cb => cb.value);
  
  if (seleccionados.length === 0) {
    alert("Por favor, seleccione al menos un cilindro antes de asignar.");
    return;
  }

  if (!solicitudSeleccionadaModal) {
    alert("Error: No hay una solicitud seleccionada.");
    return;
  }

  const idLote = String(solicitudSeleccionadaModal).trim();

  try {
    // 1. Asignar lote_id y marcar como enviado en Supabase (Se removió la columna 'lote')
    const { error: errorCilindros } = await supabaseClient
      .from('registros_cilindros')
      .update({ 
        lote_id: idLote,
        enviado: true 
      })
      .in('id', seleccionados);

    if (errorCilindros) {
      alert("Error al actualizar cilindros: " + errorCilindros.message);
      return;
    }

    // 2. Cambiar estado de solicitud a 'En Proceso'
    await supabaseClient
      .from('solicitudes')
      .update({ estado: 'En Proceso' })
      .eq('id', idLote);

    // Guardar en el acumulador local
    cilindrosAcumuladosParaLote.push(...seleccionados);

    alert(`✅ Se asignaron ${seleccionados.length} cilindros al lote ${idLote}.\n\nPuedes cambiar la fecha en el desplegable para agregar más cilindros.`);

    // Refrescar datos globales y la vista del modal
    await cargarRegistrosDesdeSupabase();
    await cargarSolicitudesDesdeSupabase();
    actualizarUI();
    cargarCilindrosPorFechaSeleccionada();

  } catch (err) {
    console.error("Error al asignar cilindros:", err);
    alert("Ocurrió un error inesperado al asignar.");
  }
}

// Finaliza y cierra la solicitud una vez completada la cantidad requerida
async function completarSolicitudConCilindros() {
  if (!solicitudSeleccionadaModal) return;

  const confirmacion = confirm(`¿Deseas dar por COMPLETADA la solicitud ${solicitudSeleccionadaModal}?`);
  if (!confirmacion) return;

  const nombreUsuario = currentUser ? currentUser.nombre : 'Operador';

  try {
    const { error } = await supabaseClient
      .from('solicitudes')
      .update({ 
        estado: 'Completado', 
        completado_por: nombreUsuario,
        fecha_completado: new Date().toISOString().split('T')[0]
      })
      .eq('id', solicitudSeleccionadaModal);

    if (!error) {
      alert(`🎉 La solicitud ${solicitudSeleccionadaModal} se ha completado con éxito.`);
      cerrarModalSeleccionCilindros();
      await cargarSolicitudesDesdeSupabase();
      await cargarRegistrosDesdeSupabase();
      actualizarUI();
    } else {
      alert("Error al completar solicitud: " + error.message);
    }
  } catch (err) {
    console.error("Error al completar solicitud:", err);
  }
}

// ==========================================
// 8. VER TABLA DE SOLICITUD COMPLETADA Y MODALES
// ==========================================
async function verTablaLoteCompletado(idLote) {
  const modal = document.getElementById('modal-ver-lote');
  const bodyModal = document.getElementById('tabla-body-modal-lote');
  const titulo = document.getElementById('modal-lote-titulo');

  const idNormalizado = String(idLote).trim();

  if (titulo) titulo.textContent = `Cilindros de Solicitud: ${idNormalizado}`;
  if (bodyModal) bodyModal.innerHTML = '<tr><td colspan="11" style="text-align:center;">Cargando datos desde la base de datos...</td></tr>';
  if (modal) modal.style.display = 'flex';

  const { data: cilindrosDB, error } = await supabaseClient
    .from('registros_cilindros')
    .select('*')
    .eq('lote_id', idNormalizado);

  if (!bodyModal) return;
  bodyModal.innerHTML = '';

  if (error) {
    bodyModal.innerHTML = `<tr><td colspan="11" style="text-align:center; color:red;">Error de lectura: ${error.message}</td></tr>`;
    return;
  }

  if (!cilindrosDB || cilindrosDB.length === 0) {
    bodyModal.innerHTML = `<tr><td colspan="11" style="text-align:center;">No se encontraron registros asignados a la solicitud (${idNormalizado}).</td></tr>`;
    return;
  }

  cilindrosDB.forEach(item => {
    const tr = document.createElement('tr');
    const estaEnviado = item.enviado === true || String(item.enviado) === 'true';
    
    if (estaEnviado) tr.style.backgroundColor = '#d1e7dd';

    tr.innerHTML = `
      <td><strong>${item.cilindro}</strong></td>
      <td>${item.fecha_envasado || item.fecha || '-'}</td>
      <td>${item.creado_por || '-'}</td>
      <td>${item.conductividad ?? '-'}</td>
      <td>${item.dureza ?? '-'}</td>
      <td>${item.ph ?? '-'}</td>
      <td>${item.cloro ?? '-'}</td>
      <td>${item.olor || '-'}</td>
      <td>${item.color || '-'}</td>
      <td><span class="badge ${item.conforme ? 'badge-success' : 'badge-danger'}">${item.conforme ? 'SI' : 'NO'}</span></td>
      <td><strong>${estaEnviado ? 'ENVIADO' : 'EN STOCK'}</strong></td>
    `;
    bodyModal.appendChild(tr);
  });
}

function cerrarModalLote() {
  const modal = document.getElementById('modal-ver-lote');
  if (modal) {
    modal.style.display = 'none';
  }
}

// ==========================================
// 9. DIAGRAMAS Y ACTUALIZACIONES UI
// ==========================================
function actualizarUI() {
  renderSolicitudes();
  actualizarGraficos();
  renderizarCalendario();
  if (fechaSeleccionadaPanel) renderTablaDia();
}

function inicializarGraficos() {
  const canvas1 = document.getElementById('qualityChart');
  if (canvas1) {
    chartInstance = new Chart(canvas1.getContext('2d'), {
      type: 'doughnut',
      data: { labels: ['Conforme', 'No Conforme', 'Restantes'], datasets: [{ data: [0, 0, 100], backgroundColor: ['#15803d', '#dc2626', '#e5e7eb'] }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { position: 'bottom' } } }
    });
  }

  const canvas2 = document.getElementById('dailyChart');
  if (canvas2) {
    dailyChartInstance = new Chart(canvas2.getContext('2d'), {
      type: 'doughnut',
      data: { labels: ['Producidos Hoy', 'Meta Diaria'], datasets: [{ data: [0, 27], backgroundColor: ['#007bff', '#e5e7eb'] }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { position: 'bottom' } } }
    });
  }
}

function actualizarGraficos() {
  const datosLoteActivo = registros.filter(r => r.lote === (loteActivoId || 'STOCK_GENERAL'));
  if (chartInstance) {
    const conformes = datosLoteActivo.filter(r => r.conforme).length;
    const noConformes = datosLoteActivo.filter(r => !r.conforme).length;
    const restantes = Math.max(0, 27 - datosLoteActivo.length);

    chartInstance.data.datasets[0].data = [conformes, noConformes, restantes];
    chartInstance.update();

    const text = document.getElementById('chart-center-text');
    if (text) text.textContent = `${Math.round((datosLoteActivo.length / 27) * 100)}%`;
  }

  actualizarGraficoDiario();
}

function actualizarGraficoDiario() {
  if (!dailyChartInstance) return;
  const hoyStr = new Date().toISOString().split('T')[0];
  const producidosHoy = registros.filter(r => r.fecha === hoyStr).length;

  dailyChartInstance.data.datasets[0].data = [producidosHoy, Math.max(0, 27 - producidosHoy)];
  dailyChartInstance.update();

  const text = document.getElementById('daily-chart-center-text');
  if (text) text.textContent = `${producidosHoy}`;
}
