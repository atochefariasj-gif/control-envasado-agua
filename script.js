// ==========================================
// 1. CONFIGURACIÓN DE SUPABASE Y FIREBASE
// ==========================================
const SUPABASE_URL = 'https://mpomtdtmdsggybhnvdof.supabase.co';
const SUPABASE_KEY = 'sb_publishable_5Z828OdqG-DuZNcgYJq_lQ_eMp-zeBk';

// Se deshabilita la persistencia automática de sesión para requerir login
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

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
let estadoEnvasadoPausado = false;
let horaInicioEnvasado = null;
let solicitudSeleccionadaModal = null;

// Variable para acumular cilindros seleccionados en la sesión del modal
let cilindrosAcumuladosParaLote = [];

// Credenciales por Rol
const CREDENTIALLS = {
  operador: {
    gustavo: { nombre: 'Gustavo Silva', pass: 'gustavo123' },
    paul: { nombre: 'Paul Hernandez', pass: 'paul123' }
  },
  supervisor: {
    selene: { nombre: 'Selene Córdova', pass: 'selene123' },
    carlos: { nombre: 'Carlos Coronado', pass: 'carlos123' }
  },
  calidad: {
    david: { nombre: 'David', pass: 'david123' },
    daniel: { nombre: 'Daniel', pass: 'contraseña123' },
    priscila: { nombre: 'Priscila', pass: 'pris123' },
    estefanny: { nombre: 'Estefanny Icanaque', pass: 'estefanny123' }
  },
  admin: { pass: 'admin123' },
  jefe: {
    karent: { nombre: 'Karent Namuche', pass: 'karent2026' }
  }
};

// Generador del código estándar de cilindros A026.[DíaJuliano]-[Lote]-[Cilindro]
function obtenerSiguienteCodigoCilindro(fechaStr) {
  const date = fechaStr ? new Date(fechaStr + 'T00:00:00') : new Date();
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date - start;
  const oneDay = 1000 * 60 * 60 * 24;
  const diaJuliano = Math.floor(diff / oneDay).toString().padStart(3, '0');

  // LOTE SECUENCIAL CORREGIDO (001, 002, 003...):
  const fechasProcesadas = [...new Set(registros.map(r => r.fecha))].sort();
  let indiceLote = fechasProcesadas.indexOf(fechaStr || date.toISOString().split('T')[0]);

  if (indiceLote === -1) {
    indiceLote = fechasProcesadas.length;
  }

  const numLoteSecuencial = indiceLote + 1;
  const numLote = numLoteSecuencial.toString().padStart(3, '0');

  // Secuencial de cilindros producidos en el día
  const registrosDelDia = registros.filter(r => r.fecha === (fechaStr || date.toISOString().split('T')[0]));
  const numCilindro = (registrosDelDia.length + 1).toString().padStart(3, '0');

  return `A026.${diaJuliano}-${numLote}-${numCilindro}`;
}

function actualizarCodigoCilindroFormulario() {
  const inputCilindro = document.getElementById('numCilindro');
  if (inputCilindro && fechaSeleccionadaPanel) {
    inputCilindro.value = obtenerSiguienteCodigoCilindro(fechaSeleccionadaPanel);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const picker = document.getElementById('cal-fecha-picker');
  if (picker) picker.valueAsDate = new Date();

  registrarServiceWorkerYNotificaciones();
  inicializarGraficos();
  
  await cargarSolicitudesDesdeSupabase();
  await cargarRegistrosDesdeSupabase();
  
  renderizarCalendario();
  suscribirSupabaseRealtime();

  // NO AUTO-LOGIN: Se fuerza la pantalla de Login siempre que se carga la página
  currentUser = null;
  localStorage.removeItem('currentUser');
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
  if (typeof Notification === 'undefined') return;

  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted' && messaging) {
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

// MIGRACIÓN A SUPABASE CLIENT FUNCTIONS INVOKE
async function enviarNotificacionPushEdge(titulo, cuerpo, evento = 'GENERAL', record = {}) {
  try {
    const { data, error } = await supabaseClient.functions.invoke('enviar-notificacion', {
      body: {
        titulo: titulo,
        mensaje: cuerpo,
        evento: evento,
        record: {
          operador: currentUser ? currentUser.nombre : 'Operador',
          fecha: fechaSeleccionadaPanel || new Date().toISOString().split('T')[0],
          hora: new Date().toLocaleTimeString('es-PE', { hour12: false }),
          codigo_solicitud: solicitudSeleccionadaModal || record.id || '',
          ...record
        }
      }
    });

    if (error) {
      console.warn("Error al invocar Edge Function via Supabase SDK:", error.message);
    } else {
      console.log("Notificación push enviada con éxito:", data);
    }
  } catch (error) {
    console.error("Error inesperado invocando Edge Function:", error);
  }
}

async function enviarNotificacionPush(titulo, cuerpo, evento = 'GENERAL', record = {}) {
  console.log(`[Notificación Push]: ${titulo} - ${cuerpo}`);
  
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(titulo, { body: cuerpo, icon: './icon-192.png' });
  }

  await enviarNotificacionPushEdge(titulo, cuerpo, evento, record);
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
  } else if (rol === 'supervisor') {
    loginTitle.textContent = 'Acceso Supervisor';
    labelUsuario.textContent = 'Supervisor';
    groupUsuario.style.display = 'flex';
    selectUsuario.innerHTML = `<option value="selene">Selene Córdova</option><option value="carlos">Carlos Coronado</option>`;
  } else if (rol === 'calidad') {
    loginTitle.textContent = 'Acceso Calidad';
    labelUsuario.textContent = 'Personal de Calidad';
    groupUsuario.style.display = 'flex';
    selectUsuario.innerHTML = `<option value="david">David</option><option value="daniel">Daniel</option><option value="priscila">Priscila</option><option value="estefanny">Estefanny Icanaque</option>`;
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
  } else if (selectedRoleTemp === 'supervisor') {
    const userKey = document.getElementById('login-user').value;
    const supData = CREDENTIALLS.supervisor[userKey];
    if (pass === supData.pass) {
      currentUser = { role: 'supervisor', nombre: supData.nombre };
      iniciarSesionApp();
    } else mostrarErrorLogin();
  } else if (selectedRoleTemp === 'calidad') {
    const userKey = document.getElementById('login-user').value;
    const calData = CREDENTIALLS.calidad[userKey];
    if (pass === calData.pass) {
      currentUser = { role: 'calidad', nombre: calData.nombre };
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
  localStorage.removeItem('currentUser');
  document.getElementById('login-modal').style.display = 'flex';
  document.getElementById('app-content').style.display = 'none';
  document.getElementById('login-pass').value = '';
  volverARoles();
}

function aplicarPermisosPorRol() {
  // Visibilidad del formulario de solicitudes (Jefe)
  const formSolicitud = document.getElementById('form-solicitud');
  if (currentUser && currentUser.role === 'jefe') {
    if (formSolicitud) formSolicitud.style.display = 'grid';
  } else {
    if (formSolicitud) formSolicitud.style.display = 'none';
  }

  // Visibilidad del botón de Exportar a Excel (Solo Admin)
  const btnExportar = document.getElementById('btn-exportar-excel');
  if (btnExportar) {
    if (currentUser && currentUser.role === 'admin') {
      btnExportar.style.display = 'inline-block';
    } else {
      btnExportar.style.display = 'none';
    }
  }

  // Visibilidad de controles del operador
  const btnIniciar = document.getElementById('btn-iniciar-envasado');
  const btnPausar = document.getElementById('btn-pausar-envasado');
  const btnReanudar = document.getElementById('btn-reanudar-envasado');
  const btnFinalizar = document.getElementById('btn-finalizar-envasado');

  if (currentUser && currentUser.role !== 'operador') {
    if (btnIniciar) btnIniciar.style.display = 'none';
    if (btnPausar) btnPausar.style.display = 'none';
    if (btnReanudar) btnReanudar.style.display = 'none';
    if (btnFinalizar) btnFinalizar.style.display = 'none';
  } else {
    if (btnIniciar) btnIniciar.style.display = 'inline-block';
    if (btnFinalizar) btnFinalizar.style.display = 'inline-block';
  }
}

// ==========================================
// 4. SOLICITUDES DE ENVÍO CON BÚSQUEDA Y ESTADOS
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
    container.innerHTML = '<p style="font-size: 0.85rem; color: #666;">No hay solicitudes de envío que coincidan.</p>';
    return;
  }

  solicitudesFiltradas.forEach(sol => {
    const estado = sol.estado;
    const esVerificadoYEnviado = estado === 'Verificado y Enviado' || estado === 'Completado';
    const esEnVerificacion = estado === 'En Verificación';
    const esEnProceso = estado === 'En Proceso';

    const div = document.createElement('div');
    div.className = 'solicitud-card';
    div.style.border = "1px solid #ddd";
    div.style.padding = "10px";
    div.style.marginBottom = "8px";
    div.style.borderRadius = "6px";

    if (esVerificadoYEnviado) {
      div.style.backgroundColor = "#d1e7dd";
      div.style.borderColor = "#0f5132";
    } else if (esEnVerificacion) {
      div.style.backgroundColor = "#fff3cd";
      div.style.borderColor = "#ffc107";
    }

    let estadoBadge = '<span style="color: orange; font-weight: bold;">Pendiente</span>';
    if (esVerificadoYEnviado) {
      estadoBadge = '<span style="color: #0f5132; font-weight: bold;">✓ Verificado y Enviado</span>';
    } else if (esEnVerificacion) {
      estadoBadge = '<span style="color: #856404; font-weight: bold;">⏳ En Verificación (Calidad)</span>';
    } else if (esEnProceso) {
      estadoBadge = '<span style="color: #0d6efd; font-weight: bold;">🔄 En Proceso</span>';
    }

    let htmlContent = `
      <div class="solicitud-info">
        <h4><i class="fa-solid fa-box"></i> Solicitud de Envío: ${sol.producto || 'Cilindros de Agua'}</h4>
        <p>ID Lote: <strong>${sol.id}</strong> | Fecha Req: <strong>${sol.fecha_completado || '-'}</strong> | Hora Envío: <strong>${sol.hora_envio || 'Pendiente'}</strong></p>
        <p>Estado: ${estadoBadge}</p>
      </div>
      <div class="solicitud-acciones" style="margin-top: 8px; display: flex; gap: 8px;">
    `;

    if (esVerificadoYEnviado || esEnVerificacion || currentUser?.role === 'calidad' || currentUser?.role === 'jefe' || currentUser?.role === 'supervisor') {
      htmlContent += `<button class="btn btn-secondary" onclick="verTablaLoteCompletado('${sol.id}')">📊 Ver Tabla / Detalle</button>`;
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
  const numCilindrosSol = document.getElementById('sol-cilindros').value;
  const fechaEntrega = document.getElementById('sol-fecha').value;

  const numSolicitudSecuencial = (solicitudes.length + 1).toString();
  const idSol = numSolicitudSecuencial;

  const { error } = await supabaseClient.from('solicitudes').insert([
    {
      id: idSol,
      producto: `${numCilindrosSol} Cilindros Solicitados`,
      estado: 'Pendiente',
      creado_por: currentUser ? currentUser.nombre : 'Sistema',
      fecha_completado: fechaEntrega
    }
  ]);

  if (!error) {
    document.getElementById('sol-cilindros').value = '';
    document.getElementById('sol-fecha').value = '';
    await enviarNotificacionPush(
      "Nueva Solicitud de Envío", 
      `Solicitud #${idSol} creada para ${fechaEntrega}`,
      'NUEVA_SOLICITUD',
      { codigo_solicitud: idSol, fecha: fechaEntrega }
    );
    await cargarSolicitudesDesdeSupabase();
    actualizarUI();
  } else {
    alert("Error al crear la solicitud de envío: " + error.message);
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
// 6. PANEL DE CONTROL DE ENVASADO
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

  actualizarCodigoCilindroFormulario();
  renderTablaDia();
  window.scrollTo({ top: document.getElementById('panel-envasado-fecha').offsetTop - 20, behavior: 'smooth' });
}

function cerrarPanelFecha() {
  document.getElementById('panel-envasado-fecha').style.display = 'none';
}

function actualizarEstadoBotonesEnvasado(iniciado) {
  const btnIni = document.getElementById('btn-iniciar-envasado');
  const btnPausar = document.getElementById('btn-pausar-envasado');
  const btnReanudar = document.getElementById('btn-reanudar-envasado');
  const btnFin = document.getElementById('btn-finalizar-envasado');
  const label = document.getElementById('label-estado-envasado');
  const formDia = document.getElementById('sec-formulario-dia');

  if (currentUser && currentUser.role !== 'operador') {
    if (btnIni) btnIni.style.display = 'none';
    if (btnPausar) btnPausar.style.display = 'none';
    if (btnReanudar) btnReanudar.style.display = 'none';
    if (btnFin) btnFin.style.display = 'none';
    if (formDia) formDia.style.display = 'none';
    return;
  }

  if (iniciado && !estadoEnvasadoPausado) {
    if (btnIni) btnIni.style.display = 'none';
    if (btnPausar) btnPausar.style.display = 'inline-block';
    if (btnReanudar) btnReanudar.style.display = 'none';
    if (btnFin) { btnFin.style.display = 'inline-block'; btnFin.disabled = false; }
    if (label) {
      label.textContent = "Envasado En Curso";
      label.style.background = "#28a745";
    }
    if (formDia) formDia.style.display = 'block';
  } else if (estadoEnvasadoPausado) {
    if (btnIni) btnIni.style.display = 'none';
    if (btnPausar) btnPausar.style.display = 'none';
    if (btnReanudar) btnReanudar.style.display = 'inline-block';
    if (btnFin) { btnFin.style.display = 'inline-block'; btnFin.disabled = false; }
    if (label) {
      label.textContent = "Envasado Pausado";
      label.style.background = "#ffc107";
      label.style.color = "#000";
    }
    if (formDia) formDia.style.display = 'none';
  } else {
    if (btnIni) { btnIni.style.display = 'inline-block'; btnIni.disabled = false; }
    if (btnPausar) btnPausar.style.display = 'none';
    if (btnReanudar) btnReanudar.style.display = 'none';
    if (btnFin) { btnFin.style.display = 'inline-block'; btnFin.disabled = true; }
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
  estadoEnvasadoPausado = false;
  actualizarEstadoBotonesEnvasado(true);
  actualizarCodigoCilindroFormulario();

  await enviarNotificacionPush(
    "Envasado Iniciado", 
    `${currentUser.nombre} inició el envasado para la fecha ${fechaSeleccionadaPanel} a las ${ahora}`,
    'INICIO_ENVASADO',
    { hora: ahora }
  );
}

async function pausarEnvasado() {
  const ahora = new Date().toTimeString().split(' ')[0];
  estadoEnvasadoPausado = true;
  actualizarEstadoBotonesEnvasado(true);

  await enviarNotificacionPush(
    "Envasado Pausado", 
    `${currentUser.nombre} pausó el envasado para la fecha ${fechaSeleccionadaPanel} a las ${ahora}`,
    'PAUSA_ENVASADO',
    { hora: ahora }
  );
}

async function reanudarEnvasado() {
  const ahora = new Date().toTimeString().split(' ')[0];
  estadoEnvasadoPausado = false;
  
  const elemResp = document.getElementById('responsable');
  if (elemResp) elemResp.value = currentUser.nombre;

  actualizarEstadoBotonesEnvasado(true);
  actualizarCodigoCilindroFormulario();

  await enviarNotificacionPush(
    "Envasado Reanudado", 
    `${currentUser.nombre} reanudó el envasado para la fecha ${fechaSeleccionadaPanel} a las ${ahora}`,
    'REANUDAR_ENVASADO',
    { hora: ahora }
  );
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
  estadoEnvasadoPausado = false;
  actualizarEstadoBotonesEnvasado(false);

  await enviarNotificacionPush(
    "Envasado Finalizado", 
    `Se finalizó el envasado para la fecha ${fechaSeleccionadaPanel} a las ${ahora}`,
    'FIN_ENVASADO',
    { hora: ahora }
  );
  
  await cargarRegistrosDesdeSupabase();
  renderTablaDia();
  actualizarUI();
}

const formAguaDia = document.getElementById('form-agua-dia');
if (formAguaDia) {
  formAguaDia.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!estadoEnvasadoIniciado || estadoEnvasadoPausado) {
      alert("Debe iniciar o reanudar el envasado para registrar cilindros.");
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
      actualizarCodigoCilindroFormulario();
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
// 7. VINCULACIÓN Y ASIGNACIÓN DE CILINDROS
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
    const { error: errorCilindros } = await supabaseClient
      .from('registros_cilindros')
      .update({ 
        lote_id: idLote
      })
      .in('id', seleccionados);

    if (errorCilindros) {
      alert("Error al actualizar cilindros: " + errorCilindros.message);
      return;
    }

    await supabaseClient
      .from('solicitudes')
      .update({ estado: 'En Proceso' })
      .eq('id', idLote);

    cilindrosAcumuladosParaLote.push(...seleccionados);

    alert(`✅ Se asignaron ${seleccionados.length} cilindros a la Solicitud #${idLote}.`);

    await cargarRegistrosDesdeSupabase();
    await cargarSolicitudesDesdeSupabase();
    actualizarUI();
    cargarCilindrosPorFechaSeleccionada();

  } catch (err) {
    console.error("Error al asignar cilindros:", err);
    alert("Ocurrió un error inesperado al asignar.");
  }
}

async function completarSolicitudConCilindros() {
  if (!solicitudSeleccionadaModal) return;

  const confirmacion = confirm(`¿Deseas enviar la Solicitud de Envío #${solicitudSeleccionadaModal} a VERIFICACIÓN por Calidad?`);
  if (!confirmacion) return;

  const nombreUsuario = currentUser ? currentUser.nombre : 'Operador';

  try {
    const { error } = await supabaseClient
      .from('solicitudes')
      .update({ 
        estado: 'En Verificación', 
        completado_por: nombreUsuario
      })
      .eq('id', solicitudSeleccionadaModal);

    if (!error) {
      await enviarNotificacionPush(
        "Lote Listo para Verificación", 
        `La solicitud #${solicitudSeleccionadaModal} pasó a estado En Verificación por el operador ${nombreUsuario}`,
        'EN_VERIFICACION',
        { codigo_solicitud: solicitudSeleccionadaModal }
      );
      alert(`⏳ Solicitud #${solicitudSeleccionadaModal} enviada a Verificación por Calidad.`);
      cerrarModalSeleccionCilindros();
      await cargarSolicitudesDesdeSupabase();
      await cargarRegistrosDesdeSupabase();
      actualizarUI();
    } else {
      alert("Error al enviar a verificación: " + error.message);
    }
  } catch (err) {
    console.error("Error al enviar a verificación:", err);
  }
}

// ==========================================
// 8. VER TABLA Y LIBERACIÓN CONFORMIDAD CALIDAD
// ==========================================
async function verTablaLoteCompletado(idLote) {
  solicitudSeleccionadaModal = String(idLote).trim();
  const modal = document.getElementById('modal-ver-lote');
  const bodyModal = document.getElementById('tabla-body-modal-lote');
  const titulo = document.getElementById('modal-lote-titulo');
  const panelCalidad = document.getElementById('panel-verificacion-calidad');

  if (titulo) titulo.textContent = `Cilindros de la Solicitud #${solicitudSeleccionadaModal}`;
  if (bodyModal) bodyModal.innerHTML = '<tr><td colspan="11" style="text-align:center;">Cargando datos desde la base de datos...</td></tr>';
  
  const solActual = solicitudes.find(s => String(s.id).trim() === solicitudSeleccionadaModal);
  if (currentUser && currentUser.role === 'calidad' && solActual && solActual.estado === 'En Verificación') {
    if (panelCalidad) panelCalidad.style.display = 'block';
  } else {
    if (panelCalidad) panelCalidad.style.display = 'none';
  }

  if (modal) modal.style.display = 'flex';

  const { data: cilindrosDB, error } = await supabaseClient
    .from('registros_cilindros')
    .select('*')
    .eq('lote_id', solicitudSeleccionadaModal);

  if (!bodyModal) return;
  bodyModal.innerHTML = '';

  if (error) {
    bodyModal.innerHTML = `<tr><td colspan="11" style="text-align:center; color:red;">Error de lectura: ${error.message}</td></tr>`;
    return;
  }

  if (!cilindrosDB || cilindrosDB.length === 0) {
    bodyModal.innerHTML = `<tr><td colspan="11" style="text-align:center;">No se encontraron registros asignados a la solicitud (#${solicitudSeleccionadaModal}).</td></tr>`;
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

async function darConformidadCalidad() {
  const horaEnvio = document.getElementById('hora-envio-calidad')?.value;

  if (!horaEnvio) {
    alert("Por favor ingrese la Hora de Envío antes de dar la conformidad.");
    return;
  }

  if (!solicitudSeleccionadaModal) return;

  const confirmacion = confirm(`¿Dar Conformidad y Liberar para Envío la Solicitud #${solicitudSeleccionadaModal}?`);
  if (!confirmacion) return;

  try {
    const { error: errorSol } = await supabaseClient
      .from('solicitudes')
      .update({
        estado: 'Verificado y Enviado',
        verificado_por: currentUser ? currentUser.nombre : 'Calidad',
        hora_envio: horaEnvio,
        fecha_completado: new Date().toISOString().split('T')[0]
      })
      .eq('id', solicitudSeleccionadaModal);

    if (errorSol) {
      alert("Error actualizando solicitud: " + errorSol.message);
      return;
    }

    const { error: errorCil } = await supabaseClient
      .from('registros_cilindros')
      .update({ enviado: true })
      .eq('lote_id', solicitudSeleccionadaModal);

    if (errorCil) {
      alert("Error actualizando cilindros enviando: " + errorCil.message);
      return;
    }

    await enviarNotificacionPush(
      "Conformidad Otorgada", 
      `La solicitud #${solicitudSeleccionadaModal} fue verificada y liberada a las ${horaEnvio} por ${currentUser.nombre}`,
      'VERIFICADO',
      { codigo_solicitud: solicitudSeleccionadaModal, hora_envio: horaEnvio }
    );
    alert(`✅ Lote #${solicitudSeleccionadaModal} verificado y liberado exitosamente.`);

    cerrarModalLote();
    await cargarSolicitudesDesdeSupabase();
    await cargarRegistrosDesdeSupabase();
    actualizarUI();

  } catch (err) {
    console.error("Error en darConformidadCalidad:", err);
  }
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
  if (currentUser && currentUser.role === 'calidad') {
    const title1 = document.getElementById('title-chart-1');
    if (title1) title1.innerHTML = `<i class="fa-solid fa-list-check"></i> Avance de Verificación de Lotes`;

    const totalLotes = solicitudes.length;
    const lotesVerificados = solicitudes.filter(s => s.estado === 'Verificado y Enviado' || s.estado === 'Completado').length;
    const lotesEnVerificacion = solicitudes.filter(s => s.estado === 'En Verificación').length;
    const lotesPendientes = totalLotes - (lotesVerificados + lotesEnVerificacion);

    if (chartInstance) {
      chartInstance.data.labels = ['Verificados', 'En Verificación', 'Pendientes'];
      chartInstance.data.datasets[0].data = [lotesVerificados, lotesEnVerificacion, Math.max(0, lotesPendientes)];
      chartInstance.data.datasets[0].backgroundColor = ['#15803d', '#ffc107', '#e5e7eb'];
      chartInstance.update();

      const text = document.getElementById('chart-center-text');
      if (text) {
        const pct = totalLotes > 0 ? Math.round((lotesVerificados / totalLotes) * 100) : 0;
        text.textContent = `${pct}%`;
      }
    }
  } else {
    const title1 = document.getElementById('title-chart-1');
    if (title1) title1.innerHTML = `<i class="fa-solid fa-chart-pie"></i> Avance del Lote Activo`;

    const datosLoteActivo = registros.filter(r => r.lote === (loteActivoId || 'STOCK_GENERAL'));
    if (chartInstance) {
      const conformes = datosLoteActivo.filter(r => r.conforme).length;
      const noConformes = datosLoteActivo.filter(r => !r.conforme).length;
      const restantes = Math.max(0, 27 - datosLoteActivo.length);

      chartInstance.data.labels = ['Conforme', 'No Conforme', 'Restantes'];
      chartInstance.data.datasets[0].data = [conformes, noConformes, restantes];
      chartInstance.data.datasets[0].backgroundColor = ['#15803d', '#dc2626', '#e5e7eb'];
      chartInstance.update();

      const text = document.getElementById('chart-center-text');
      if (text) text.textContent = `${Math.round((datosLoteActivo.length / 27) * 100)}%`;
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

// ==========================================
// 10. EXPORTACIÓN DE DATOS A EXCEL (ADMIN)
// ==========================================
function exportarAExcel() {
  if (!currentUser || currentUser.role !== 'admin') {
    alert("Solo el Administrador tiene permisos para exportar datos.");
    return;
  }

  if (registros.length === 0) {
    alert("No hay registros disponibles para exportar.");
    return;
  }

  // Mapeo de datos para el reporte Excel
  const datosExcel = registros.map(r => ({
    "Cilindro": r.cilindro,
    "Lote / Solicitud": r.lote_id || r.lote || '-',
    "Fecha Envasado": r.fecha,
    "Hora Inicio": r.hora_inicio || '-',
    "Hora Fin": r.hora_fin || '-',
    "Responsable": r.responsable || '-',
    "Conductividad (µS/cm)": r.conductividad,
    "Dureza (ppm)": r.dureza,
    "pH": r.ph,
    "Cloro (ppm)": r.cloro,
    "Olor": r.olor,
    "Color": r.color,
    "Conforme": r.conforme ? 'SÍ' : 'NO',
    "Estado Envío": r.enviado ? 'ENVIADO' : 'EN STOCK'
  }));

  // Crear hoja y libro de trabajo con XLSX
  const worksheet = XLSX.utils.json_to_sheet(datosExcel);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Registros_Envasado");

  // Descargar archivo .xlsx
  const fechaHoy = new Date().toISOString().split('T')[0];
  XLSX.writeFile(workbook, `Reporte_Envasado_Agua_${fechaHoy}.xlsx`);
}
