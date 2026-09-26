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
let qualityVerificationChartInstance = null;
let dailyChartInstance = null;
let loteActivoId = null;

let fechaSeleccionadaPanel = null;
let estadoEnvasadoIniciado = false;
let horaInicioEnvasado = null;
let solicitudSeleccionadaModal = null;
let cilindrosAcumuladosParaLote = [];

const CREDENTIALLS = {
  operador: {
    gustavo: { nombre: 'Gustavo Silva', pass: 'gustavo123' },
    paul: { nombre: 'Paul Hernandez', pass: 'paul123' }
  },
  admin: { pass: 'admin123' },
  jefe: {
    karent: { nombre: 'Karent Namuche', pass: 'karent2026' }
  },
  supervisor: {
    selene: { nombre: 'Selene Cordova', pass: 'selene123' },
    carlos: { nombre: 'Carlos Coronado', pass: 'carlos123' }
  },
  calidad: {
    david: { nombre: 'David', pass: 'david123' },
    daniel: { nombre: 'Daniel', pass: 'contraseña123' },
    priscila: { nombre: 'Priscila', pass: 'pris123' },
    estefanny: { nombre: 'Estefanny Icanaque', pass: 'estefanny123' }
  }
};

// Función para calcular el Día Juliano y generar el código del cilindro (Ej: AO26.265-001)
function obtenerDiaJuliano(fecha = new Date()) {
  const inicio = new Date(fecha.getFullYear(), 0, 0);
  const diff = (fecha - inicio) + ((inicio.getTimezoneOffset() - fecha.getTimezoneOffset()) * 60 * 1000);
  const unDia = 1000 * 60 * 60 * 24;
  return Math.floor(diff / unDia);
}

function generarSiguienteCodigoCilindro(fechaStr) {
  const fechaObj = fechaStr ? new Date(fechaStr + 'T00:00:00') : new Date();
  const anioCorto = String(fechaObj.getFullYear()).slice(-2);
  const diaJuliano = String(obtenerDiaJuliano(fechaObj)).padStart(3, '0');

  // Contar cuántos registros existen en esa fecha para calcular el correlativo 001, 002...
  const regsFecha = registros.filter(r => r.fecha === fechaStr);
  const correlativo = String(regsFecha.length + 1).padStart(3, '0');

  return `AO${anioCorto}.${diaJuliano}-${correlativo}`;
}

function actualizarInputCilindroGenerado() {
  const inputCil = document.getElementById('numCilindro');
  if (inputCil && fechaSeleccionadaPanel) {
    inputCil.value = generarSiguienteCodigoCilindro(fechaSeleccionadaPanel);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const picker = document.getElementById('cal-fecha-picker');
  if (picker) picker.valueAsDate = new Date();

  registrarServiceWorkerYNotificaciones();
  inicializarGraficos();
  
  await cargarSolicitudesDespachoDesdeSupabase();
  await cargarRegistrosDesdeSupabase();
  
  renderizarCalendario();
  suscribirSupabaseRealtime();

  const savedUser = localStorage.getItem('currentUser');
  if (savedUser) {
    currentUser = JSON.parse(savedUser);
    iniciarSesionApp(true);
  }
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
  console.log(`[Notificación]: ${titulo} - ${cuerpo}`);
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

async function cargarSolicitudesDespachoDesdeSupabase() {
  const { data, error } = await supabaseClient
    .from('solicitudes')
    .select('*')
    .order('created_at', { ascending: false });

  if (!error && data) {
    solicitudes = data;
    const lotePendiente = solicitudes.find(s => s.estado === 'Pendiente' || s.estado === 'En Proceso' || s.estado === 'En Verificación');
    loteActivoId = lotePendiente ? String(lotePendiente.id) : null;
    renderSolicitudes();
  }
}

function suscribirSupabaseRealtime() {
  supabaseClient.channel('public:solicitudes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes' }, async () => {
      await cargarSolicitudesDespachoDesdeSupabase();
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
  } else if (rol === 'supervisor') {
    loginTitle.textContent = 'Acceso Supervisor';
    labelUsuario.textContent = 'Supervisor de Turno';
    groupUsuario.style.display = 'flex';
    selectUsuario.innerHTML = `<option value="selene">Selene Cordova</option><option value="carlos">Carlos Coronado</option>`;
  } else if (rol === 'calidad') {
    loginTitle.textContent = 'Acceso Control de Calidad';
    labelUsuario.textContent = 'Personal de Calidad';
    groupUsuario.style.display = 'flex';
    selectUsuario.innerHTML = `
      <option value="david">David</option>
      <option value="daniel">Daniel</option>
      <option value="priscila">Priscila</option>
      <option value="estefanny">Estefanny Icanaque</option>
    `;
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
      iniciarSesionApp(false);
    } else mostrarErrorLogin();
  } else if (selectedRoleTemp === 'admin') {
    if (pass === CREDENTIALLS.admin.pass) {
      currentUser = { role: 'admin', nombre: 'Administrador' };
      iniciarSesionApp(false);
    } else mostrarErrorLogin();
  } else if (selectedRoleTemp === 'jefe') {
    const userKey = document.getElementById('login-user').value;
    const jefeData = CREDENTIALLS.jefe[userKey];
    if (pass === jefeData.pass) {
      currentUser = { role: 'jefe', nombre: jefeData.nombre };
      iniciarSesionApp(false);
    } else mostrarErrorLogin();
  } else if (selectedRoleTemp === 'supervisor') {
    const userKey = document.getElementById('login-user').value;
    const supData = CREDENTIALLS.supervisor[userKey];
    if (pass === supData.pass) {
      currentUser = { role: 'supervisor', nombre: supData.nombre };
      iniciarSesionApp(false);
    } else mostrarErrorLogin();
  } else if (selectedRoleTemp === 'calidad') {
    const userKey = document.getElementById('login-user').value;
    const calData = CREDENTIALLS.calidad[userKey];
    if (pass === calData.pass) {
      currentUser = { role: 'calidad', nombre: calData.nombre };
      iniciarSesionApp(false);
    } else mostrarErrorLogin();
  }
}

function mostrarErrorLogin() {
  document.getElementById('login-error').style.display = 'block';
}

function iniciarSesionApp(desdeMemoria = false) {
  if (!desdeMemoria) {
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
  }

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
  localStorage.removeItem('currentUser');
  document.getElementById('login-modal').style.display = 'flex';
  document.getElementById('app-content').style.display = 'none';
  volverARoles();
}

function aplicarPermisosPorRol() {
  const formSolicitud = document.getElementById('form-solicitud');
  
  if (currentUser && (currentUser.role === 'jefe' || currentUser.role === 'supervisor' || currentUser.role === 'calidad')) {
    if (formSolicitud) formSolicitud.style.display = 'grid';
  } else {
    if (formSolicitud) formSolicitud.style.display = 'none';
  }

  const cardEstandar = document.getElementById('card-grafico-estandar');
  const cardCalidad = document.getElementById('card-grafico-calidad');

  if (currentUser && currentUser.role === 'calidad') {
    if (cardEstandar) cardEstandar.style.display = 'none';
    if (cardCalidad) cardCalidad.style.display = 'block';
  } else {
    if (cardEstandar) cardEstandar.style.display = 'block';
    if (cardCalidad) cardCalidad.style.display = 'none';
  }

  const btnIniciar = document.getElementById('btn-iniciar-envasado');
  const btnFinalizar = document.getElementById('btn-finalizar-envasado');

  if (currentUser && currentUser.role !== 'operador') {
    if (btnIniciar) btnIniciar.style.display = 'none';
    if (btnFinalizar) btnFinalizar.style.display = 'none';
  } else {
    if (btnIniciar) btnIniciar.style.display = 'inline-block';
    if (btnFinalizar) btnFinalizar.style.display = 'inline-block';
  }
}

// ==========================================
// 4. SOLICITUDES DE ENVÍO Y ESTADOS
// ==========================================
function renderSolicitudes() {
  const container = document.getElementById('lista-solicitudes');
  if (!container) return;
  
  const filtro = (document.getElementById('searchSolicitud')?.value || '').toLowerCase();
  container.innerHTML = '';

  const solicitudesFiltradas = solicitudes.filter(sol => 
    String(sol.id).toLowerCase().includes(filtro) || (sol.fecha_completado && sol.fecha_completado.includes(filtro)) || (sol.producto && sol.producto.toLowerCase().includes(filtro))
  );

  if (solicitudesFiltradas.length === 0) {
    container.innerHTML = '<p style="font-size: 0.85rem; color: #666;">No hay solicitudes de envío que coincidan.</p>';
    return;
  }

  solicitudesFiltradas.forEach(sol => {
    const estado = sol.estado || 'Pendiente';
    const esCompletado = estado === 'Completado';
    const enVerificacion = estado === 'En Verificación';
    const enProceso = estado === 'En Proceso';
    
    const div = document.createElement('div');
    div.className = `solicitud-card`;
    div.style.border = "1px solid #ddd";
    div.style.padding = "10px";
    div.style.marginBottom = "8px";
    div.style.borderRadius = "6px";

    if (esCompletado) {
      div.style.backgroundColor = '#d1e7dd'; // Verde
    } else if (enVerificacion) {
      div.style.backgroundColor = '#fff3cd'; // Amarillo
    }

    let estadoBadge = '<span style="color: orange; font-weight: bold;">Pendiente</span>';
    if (esCompletado) {
      estadoBadge = '<span style="color: green; font-weight: bold;">✓ Envío verificado y completado</span>';
    } else if (enVerificacion) {
      estadoBadge = '<span style="color: #b8860b; font-weight: bold;">⚠️ En verificación</span>';
    } else if (enProceso) {
      estadoBadge = '<span style="color: #0d6efd; font-weight: bold;">🔄 En Proceso</span>';
    }

    let htmlContent = `
      <div class="solicitud-info">
        <h4><i class="fa-solid fa-box"></i> Solicitud N° ${sol.id}</h4>
        <p>Detalle: <strong>${sol.producto}</strong> | Fecha: <strong>${sol.fecha_completado || '-'}</strong> ${sol.hora_envio ? '| Hora Envío: <strong>' + sol.hora_envio + '</strong>' : ''}</p>
        <p>Estado: ${estadoBadge}</p>
      </div>
      <div class="solicitud-acciones" style="margin-top: 8px; display: flex; gap: 8px;">
    `;

    if (esCompletado || enVerificacion) {
      htmlContent += `<button class="btn btn-secondary" onclick="verTablaLoteCompletado('${sol.id}')">📊 Ver Tabla</button>`;
    }
    
    if (currentUser && currentUser.role === 'operador' && !esCompletado && !enVerificacion) {
      htmlContent += `<button class="btn btn-primary" onclick="abrirModalSeleccionarCilindros('${sol.id}')">📦 Asignar Cilindros</button>`;
    }

    if (currentUser && currentUser.role === 'calidad' && enVerificacion) {
      htmlContent += `<button class="btn btn-success" onclick="abrirModalCalidadConformidad('${sol.id}')">✅ Dar Conformidad y Enviar</button>`;
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

  // Numeración 1 creciente según las solicitudes existentes
  const nuevoId = solicitudes.length > 0 ? Math.max(...solicitudes.map(s => parseInt(s.id) || 0)) + 1 : 1;

  const { error } = await supabaseClient.from('solicitudes').insert([
    {
      id: nuevoId,
      producto: detalle,
      estado: 'Pendiente',
      creado_por: currentUser ? currentUser.nombre : 'Sistema',
      fecha_completado: fechaEntrega
    }
  ]);

  if (!error) {
    document.getElementById('sol-cilindros').value = '';
    document.getElementById('sol-fecha').value = '';
    // Notificación actualizada a Solicitud de Envío
    await enviarNotificacionPush("Nueva Solicitud de Envío", `Solicitud N° ${nuevoId} creada para ${fechaEntrega}`);
    await cargarSolicitudesDespachoDesdeSupabase();
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

  actualizarInputCilindroGenerado();

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

  if (currentUser && currentUser.role !== 'operador') {
    if (btnIni) btnIni.style.display = 'none';
    if (btnFin) btnFin.style.display = 'none';
    if (formDia) formDia.style.display = 'none';
    return;
  }

  if (iniciado) {
    if (btnIni) btnIni.disabled = true;
    if (btnFin) btnFin.disabled = false;
    if (label) {
      label.textContent = "Envasado En Curso";
      label.style.background = "#28a745";
    }
    if (currentUser && currentUser.role === 'operador' && formDia) {
      formDia.style.display = 'block';
    }
  } else {
    if (btnIni) btnIni.disabled = false;
    if (btnFin) btnFin.disabled = true;
    if (label) {
      label.textContent = "Envasado No Iniciado";
      label.style.background = "#6c757d";
    }
    if (formDia) formDia.style.display = 'none';
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
      document.getElementById('conductividad').value = '';
      document.getElementById('dureza').value = '';
      document.getElementById('ph').value = '';
      document.getElementById('cloro').value = '';
      
      await cargarRegistrosDesdeSupabase();
      renderTablaDia();
      actualizarInputCilindroGenerado();
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
    actualizarInputCilindroGenerado();
    actualizarUI();
  }
}

// ==========================================
// 7. VINCULACIÓN Y FLUJO DE VERIFICACIÓN
// ==========================================
function abrirModalSeleccionarCilindros(idSolicitud) {
  solicitudSeleccionadaModal = String(idSolicitud).trim();
  cilindrosAcumuladosParaLote = [];
  
  const selectFecha = document.getElementById('select-fecha-disponible');
  if (selectFecha) {
    selectFecha.innerHTML = '<option value="TODAS">-- Ver Todas las Fechas --</option>';

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

  const cilindrosStock = registros.filter(r => {
    const estaEnStock = !r.enviado;
    const noEstaEnAcumulado = !cilindrosAcumuladosParaLote.includes(String(r.id));
    
    if (valorFecha === 'TODAS') {
      return estaEnStock && noEstaEnAcumulado;
    }
    return estaEnStock && noEstaEnAcumulado && r.fecha === valorFecha;
  });

  if (cilindrosStock.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">No hay cilindros en stock disponibles.</td></tr>`;
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

async function guardarCilindrosEnSolicitud() {
  const checkboxes = document.querySelectorAll('.chk-cilindro:checked');
  const seleccionados = Array.from(checkboxes).map(cb => cb.value);
  
  if (seleccionados.length === 0) {
    alert("Seleccione al menos un cilindro.");
    return;
  }

  const idSol = String(solicitudSeleccionadaModal).trim();

  try {
    const { error: errorCilindros } = await supabaseClient
      .from('registros_cilindros')
      .update({ lote_id: idSol })
      .in('id', seleccionados);

    if (errorCilindros) {
      alert("Error al asignar cilindros: " + errorCilindros.message);
      return;
    }

    await supabaseClient
      .from('solicitudes')
      .update({ estado: 'En Proceso' })
      .eq('id', idSol);

    cilindrosAcumuladosParaLote.push(...seleccionados);
    alert(`✅ Se asignaron ${seleccionados.length} cilindros a la solicitud.`);

    await cargarRegistrosDesdeSupabase();
    await cargarSolicitudesDespachoDesdeSupabase();
    actualizarUI();
    cargarCilindrosPorFechaSeleccionada();
  } catch (err) {
    console.error("Error:", err);
  }
}

async function completarSolicitudOperador() {
  if (!solicitudSeleccionadaModal) return;

  const confirmacion = confirm(`¿Desea marcar la solicitud N° ${solicitudSeleccionadaModal} como completada para que pase a "En Verificación"?`);
  if (!confirmacion) return;

  const { error } = await supabaseClient
    .from('solicitudes')
    .update({ estado: 'En Verificación' })
    .eq('id', solicitudSeleccionadaModal);

  if (!error) {
    alert(`⚠️ Solicitud N° ${solicitudSeleccionadaModal} enviada a Calidad (En Verificación).`);
    cerrarModalSeleccionCilindros();
    await cargarSolicitudesDespachoDesdeSupabase();
    actualizarUI();
  } else {
    alert("Error al actualizar estado: " + error.message);
  }
}

function abrirModalCalidadConformidad(idSol) {
  solicitudSeleccionadaModal = String(idSol).trim();
  document.getElementById('modal-calidad-lote-id').textContent = solicitudSeleccionadaModal;
  
  const now = new Date();
  const horaActual = now.toTimeString().substring(0, 5);
  document.getElementById('input-hora-envio').value = horaActual;

  document.getElementById('modal-calidad-conformidad').style.display = 'flex';
}

function cerrarModalCalidad() {
  document.getElementById('modal-calidad-conformidad').style.display = 'none';
}

async function confirmarEnvioCalidad() {
  const horaEnvio = document.getElementById('input-hora-envio').value;
  if (!horaEnvio) {
    alert("Por favor, ingrese la hora de envío.");
    return;
  }

  const idSol = solicitudSeleccionadaModal;
  const nombreUsuario = currentUser ? currentUser.nombre : 'Calidad';

  try {
    const { error: errCilindros } = await supabaseClient
      .from('registros_cilindros')
      .update({ enviado: true })
      .eq('lote_id', idSol);

    if (errCilindros) {
      alert("Error al actualizar cilindros: " + errCilindros.message);
      return;
    }

    const { error: errSol } = await supabaseClient
      .from('solicitudes')
      .update({ 
        estado: 'Completado', 
        completado_por: nombreUsuario,
        fecha_completado: new Date().toISOString().split('T')[0],
        hora_envio: horaEnvio
      })
      .eq('id', idSol);

    if (!errSol) {
      alert(`🎉 Solicitud N° ${idSol} verificada y enviada correctamente a las ${horaEnvio}.`);
      cerrarModalCalidad();
      await cargarRegistrosDesdeSupabase();
      await cargarSolicitudesDespachoDesdeSupabase();
      actualizarUI();
    } else {
      alert("Error al completar solicitud: " + errSol.message);
    }
  } catch (err) {
    console.error("Error en conformidad:", err);
  }
}

// ==========================================
// 8. VER TABLA DE SOLICITUD
// ==========================================
async function verTablaLoteCompletado(idSol) {
  const modal = document.getElementById('modal-ver-lote');
  const bodyModal = document.getElementById('tabla-body-modal-lote');
  const titulo = document.getElementById('modal-lote-titulo');

  const idNormalizado = String(idSol).trim();

  if (titulo) titulo.textContent = `Cilindros de Solicitud N° ${idNormalizado}`;
  if (bodyModal) bodyModal.innerHTML = '<tr><td colspan="11" style="text-align:center;">Cargando datos...</td></tr>';
  if (modal) modal.style.display = 'flex';

  const { data: cilindrosDB, error } = await supabaseClient
    .from('registros_cilindros')
    .select('*')
    .eq('lote_id', idNormalizado);

  if (!bodyModal) return;
  bodyModal.innerHTML = '';

  if (error || !cilindrosDB || cilindrosDB.length === 0) {
    bodyModal.innerHTML = `<tr><td colspan="11" style="text-align:center;">No se encontraron registros vinculados.</td></tr>`;
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
  document.getElementById('modal-ver-lote').style.display = 'none';
}

// ==========================================
// 9. DIAGRAMAS Y ACTUALIZACIONES UI
// ==========================================
function actualizarUI() {
  renderSolicitudes();
  actualizarGraficos();
  renderizarCalendario();
  if (fechaSeleccionadaPanel) {
    renderTablaDia();
    actualizarInputCilindroGenerado();
  }
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

  const canvasQuality = document.getElementById('qualityVerificationChart');
  if (canvasQuality) {
    qualityVerificationChartInstance = new Chart(canvasQuality.getContext('2d'), {
      type: 'doughnut',
      data: { labels: ['Verificados y Enviados', 'Pendientes de Verificación'], datasets: [{ data: [0, 100], backgroundColor: ['#15803d', '#ffc107'] }] },
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
  const datosEnvioActivo = registros.filter(r => r.lote === (loteActivoId || 'STOCK_GENERAL'));
  if (chartInstance) {
    const conformes = datosEnvioActivo.filter(r => r.conforme).length;
    const noConformes = datosEnvioActivo.filter(r => !r.conforme).length;
    const restantes = Math.max(0, 27 - datosEnvioActivo.length);

    chartInstance.data.datasets[0].data = [conformes, noConformes, restantes];
    chartInstance.update();

    const text = document.getElementById('chart-center-text');
    if (text) text.textContent = `${Math.round((datosEnvioActivo.length / 27) * 100)}%`;
  }

  if (qualityVerificationChartInstance && solicitudes.length > 0) {
    const totalSolicitudes = solicitudes.length;
    const solicitudesVerificadas = solicitudes.filter(s => s.estado === 'Completado').length;
    const solicitudesPendientesVerif = totalSolicitudes - solicitudesVerificadas;

    qualityVerificationChartInstance.data.datasets[0].data = [solicitudesVerificadas, solicitudesPendientesVerif];
    qualityVerificationChartInstance.update();

    const textCalidad = document.getElementById('quality-chart-center-text');
    if (textCalidad) {
      const porcentaje = Math.round((solicitudesVerificadas / totalSolicitudes) * 100);
      textCalidad.textContent = `${porcentaje}%`;
    }
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
