// ==========================================
// 1. CONFIGURACIÓN E INICIALIZACIÓN DE SUPABASE Y FIREBASE
// ==========================================
const SUPABASE_URL = 'https://mpomtdtmdsggybhnvdof.supabase.co';
const SUPABASE_KEY = 'sb_publishable_5Z828OdqG-DuZNcgYJq_lQ_eMp-zeBk';

// Crear el cliente de Supabase
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Configuración de Firebase para Push Notifications (SDK Compat v9)
const firebaseConfig = {
  apiKey: "AIzaSyBoAEj2D9wUNZrRFSmdxOM1scqm0urNfRo",
  authDomain: "control-envasado-agua.firebaseapp.com",
  projectId: "control-envasado-agua",
  storageBucket: "control-envasado-agua.firebasestorage.app",
  messagingSenderId: "337600183929",
  appId: "1:337600183929:web:1f019b401521161a2e1ea8",
  measurementId: "G-DJ3LZ96XP7"
};

// Clave pública VAPID de Firebase Cloud Messaging
const VAPID_KEY = "BF_3H1pli2NFqoTH2corhZst279V0S3f1Hhoyw5tEQb9cNKmNEQMJzhceaYtQT5LWVfB8upVOggBhiaG7Ikz6s8";

let messaging = null;

// Inicializar Firebase Messaging si es compatible
if (typeof firebase !== 'undefined' && firebase.messaging.isSupported()) {
  firebase.initializeApp(firebaseConfig);
  messaging = firebase.messaging();
}

// Estados globales de la aplicación
let registros = [];
let solicitudes = [];
let bitacoraRegistros = [];
let currentUser = null; // { role: 'operador'|'admin'|'jefe', nombre: '...' }
let selectedRoleTemp = '';
let chartInstance = null;
let loteActivoId = null; // Rastrilla el Lote en curso
let loteAConfirmar = null; // Auxiliar para modal de confirmación

// Credenciales
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

// Cargar opciones OW001 - OW027
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
  // Asegurar vista de login inicial
  const loginModal = document.getElementById('login-modal');
  const appContent = document.getElementById('app-content');
  if (loginModal) loginModal.style.display = 'flex';
  if (appContent) appContent.style.display = 'block';

  const elemFecha = document.getElementById('fechaProd');
  if (elemFecha) elemFecha.valueAsDate = new Date();
  
  cargarOpcionesCilindros();

  // Registrar Service Worker para PWA y Notificaciones Push
  registrarServiceWorkerYNotificaciones();

  // Inicializar el gráfico básico en fondo
  inicializarGrafico();

  // Cargar datos iniciales desde Supabase
  await cargarSolicitudesDesdeSupabase();
  await cargarRegistrosDesdeSupabase();
  await cargarBitacoraDesdeSupabase();

  // Suscribirse a cambios en tiempo real (Realtime)
  suscribirSupabaseRealtime();
});

// ==========================================
// 1.1 SERVICE WORKER, TOKEN FCM Y SUPABASE
// ==========================================
function registrarServiceWorkerYNotificaciones() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./firebase-messaging-sw.js')
      .then((registration) => {
        console.log('Service Worker registrado correctamente:', registration.scope);
        solicitarPermisoNotificaciones(registration);
      })
      .catch((err) => {
        console.error('Error al registrar Service Worker:', err);
      });
  }
}

async function solicitarPermisoNotificaciones(registration) {
  if (!messaging) return;

  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const token = await messaging.getToken({
        serviceWorkerRegistration: registration,
        vapidKey: VAPID_KEY
      });

      if (token) {
        await guardarTokenEnSupabase(token);
      }
    } else {
      console.warn('Permiso de notificaciones denegado.');
    }
  } catch (err) {
    console.error('Error obteniendo token FCM:', err);
  }

  // Notificación silenciosa en primer plano
  messaging.onMessage((payload) => {
    console.log('Notificación recibida en segundo plano/primer plano:', payload);
  });
}

async function guardarTokenEnSupabase(tokenFCM) {
  try {
    const { data: existente } = await supabaseClient
      .from('dispositivos_tokens')
      .select('fcm_token')
      .eq('fcm_token', tokenFCM);

    if (!existente || existente.length === 0) {
      const { error } = await supabaseClient
        .from('dispositivos_tokens')
        .insert([
          { 
            fcm_token: tokenFCM, 
            usuario: 'Operador_' + Math.floor(Math.random() * 1000) 
          }
        ]);

      if (error) {
        console.error('Error al insertar token en Supabase:', error.message);
      }
    }
  } catch (err) {
    console.error('Error guardando token:', err);
  }
}

// ==========================================
// 2. CONEXIÓN Y ACCIONES SUPABASE (CRUD)
// ==========================================

// --- REGISTROS DE CILINDROS (Desde la nueva tabla: registros_cilindros) ---
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
      fecha: item.fecha,
      responsable: item.creado_por,
      conductividad: parseFloat(item.conductividad ?? 0),
      dureza: parseFloat(item.dureza ?? 0),
      ph: parseFloat(item.ph ?? 0),
      cloro: parseFloat(item.cloro ?? 0),
      olor: item.olor,
      color: item.color,
      conforme: item.conforme
    }));
    actualizarUI();
  }
}

// --- SOLICITUDES DE LOTES ---
async function cargarSolicitudesDesdeSupabase() {
  const { data, error } = await supabaseClient
    .from('solicitudes')
    .select('*')
    .order('created_at', { ascending: false });

  if (!error && data) {
    solicitudes = data;
    
    // Obtener el lote más reciente pendiente para asignarle los nuevos cilindros
    const lotePendiente = solicitudes.find(s => s.estado === 'Pendiente');
    loteActivoId = lotePendiente ? lotePendiente.id : null;

    renderSolicitudes();
  }
}

// --- BITÁCORA ---
async function cargarBitacoraDesdeSupabase() {
  const { data, error } = await supabaseClient
    .from('bitacora')
    .select('*')
    .order('created_at', { ascending: false });

  if (!error && data) {
    bitacoraRegistros = data.map(b => ({
      id: b.id,
      usuario: b.usuario,
      rol: b.rol,
      texto: b.texto,
      fechaHora: new Date(b.created_at).toLocaleString('es-PE')
    }));
    renderizarBitacora();
  }
}

function suscribirSupabaseRealtime() {
  // Escuchar cambios en la tabla de solicitudes
  supabaseClient
    .channel('public:solicitudes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes' }, () => {
      cargarSolicitudesDesdeSupabase();
    })
    .subscribe();

  // Escuchar cambios en la nueva tabla de registros_cilindros
  supabaseClient
    .channel('public:registros_cilindros')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'registros_cilindros' }, () => {
      cargarRegistrosDesdeSupabase();
    })
    .subscribe();

  // Escuchar cambios en la tabla bitácora
  supabaseClient
    .channel('public:bitacora')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bitacora' }, () => {
      cargarBitacoraDesdeSupabase();
    })
    .subscribe();
}

// ==========================================
// 3. LÓGICA DE ROLES Y LOGIN
// ==========================================
function seleccionarRol(rol) {
  selectedRoleTemp = rol;
  document.getElementById('role-selection').style.display = 'none';
  document.getElementById('form-login').style.display = 'flex';
  document.getElementById('login-error').style.display = 'none';
  document.getElementById('login-pass').value = '';

  const groupUsuario = document.getElementById('group-usuario');
  const labelUsuario = document.getElementById('label-usuario');
  const selectUsuario = document.getElementById('login-user');
  const loginTitle = document.getElementById('login-title');

  if (rol === 'operador') {
    loginTitle.textContent = 'Acceso Operador';
    labelUsuario.textContent = 'Operador de Turno';
    groupUsuario.style.display = 'flex';
    selectUsuario.innerHTML = `
      <option value="gustavo">Gustavo Silva</option>
      <option value="paul">Paul Hernandez</option>
    `;
  } else if (rol === 'admin') {
    loginTitle.textContent = 'Acceso Administrador';
    groupUsuario.style.display = 'none';
  } else if (rol === 'jefe') {
    loginTitle.textContent = 'Acceso Jefe de Producción';
    labelUsuario.textContent = 'Jefe de Producción';
    groupUsuario.style.display = 'flex';
    selectUsuario.innerHTML = `
      <option value="karent">Karent Namuche</option>
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
      iniciarSesionApp();
    } else {
      mostrarErrorLogin();
    }
  } else if (selectedRoleTemp === 'admin') {
    if (pass === CREDENTIALLS.admin.pass) {
      currentUser = { role: 'admin', nombre: 'Administrador' };
      iniciarSesionApp();
    } else {
      mostrarErrorLogin();
    }
  } else if (selectedRoleTemp === 'jefe') {
    const userKey = document.getElementById('login-user').value;
    const jefeData = CREDENTIALLS.jefe[userKey];
    if (pass === jefeData.pass) {
      currentUser = { role: 'jefe', nombre: jefeData.nombre };
      iniciarSesionApp();
    } else {
      mostrarErrorLogin();
    }
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
  document.getElementById('app-content').style.display = 'block'; 
  document.getElementById('login-modal').style.display = 'flex';
  volverARoles();
}

function aplicarPermisosPorRol() {
  const secForm = document.getElementById('sec-formulario');
  const secSolicitudes = document.getElementById('sec-solicitudes');
  const formSolicitud = document.getElementById('form-solicitud');
  const btnExport = document.getElementById('btnExport');
  const mainGrid = document.querySelector('.main-grid');

  if (!currentUser) return;

  if (secSolicitudes) secSolicitudes.style.display = 'block';

  if (currentUser.role === 'operador') {
    if (secForm) secForm.style.display = 'block';
    if (formSolicitud) formSolicitud.style.display = 'none';
    if (btnExport) btnExport.style.display = 'none';
    if (mainGrid) mainGrid.classList.remove('full-width-grid');
  } 
  else if (currentUser.role === 'admin') {
    if (secForm) secForm.style.display = 'none';
    if (formSolicitud) formSolicitud.style.display = 'none';
    if (btnExport) btnExport.style.display = 'inline-flex';
    if (mainGrid) mainGrid.classList.add('full-width-grid');
  } 
  else if (currentUser.role === 'jefe') {
    if (secForm) secForm.style.display = 'none';
    if (formSolicitud) formSolicitud.style.display = 'grid';
    if (btnExport) btnExport.style.display = 'none';
    if (mainGrid) mainGrid.classList.add('full-width-grid');
  }
}

// ==========================================
// 4. EVALUACIÓN Y REGISTRO DE CILINDROS
// ==========================================

function evaluarConformidad(cond, dureza, ph, cloro, olor, color) {
  const condOK = typeof cond === 'number' && !isNaN(cond) && cond <= 70.0;
  const durezaOK = typeof dureza === 'number' && !isNaN(dureza) && dureza <= 2.0;
  const phOK = typeof ph === 'number' && !isNaN(ph) && ph >= 6.0 && ph <= 7.0;
  const cloroOK = typeof cloro === 'number' && !isNaN(cloro) && cloro < 0.01;
  const olorOK = olor === 'CC';
  const colorOK = color === 'CC';

  return condOK && durezaOK && phOK && cloroOK && olorOK && colorOK;
}

const formAgua = document.getElementById('form-agua');
if (formAgua) {
  formAgua.addEventListener('submit', async (e) => {
    e.preventDefault();

    const cilindro = document.getElementById('numCilindro').value;
    const idLoteActual = loteActivoId || 'SIN_LOTE';
    
    // Restricción: Validar que el cilindro NO esté duplicado DENTRO DEL LOTE ACTIVO
    const registrosLoteActivo = registros.filter(r => r.lote === idLoteActual);
    const existeEnLoteActivo = registrosLoteActivo.some(r => r.cilindro.toUpperCase() === cilindro.toUpperCase());
    
    if (existeEnLoteActivo) {
      alert(`El cilindro ${cilindro} ya ha sido registrado previamente en este lote activo.`);
      return;
    }

    const fecha = document.getElementById('fechaProd').value;
    const responsable = document.getElementById('responsable').value;
    
    const conductividad = parseFloat(document.getElementById('conductividad').value);
    const dureza = parseFloat(document.getElementById('dureza').value);
    const ph = parseFloat(document.getElementById('ph').value);
    const cloro = parseFloat(document.getElementById('cloro').value);
    const olor = document.getElementById('olor').value;
    const color = document.getElementById('color').value;

    const conforme = evaluarConformidad(conductividad, dureza, ph, cloro, olor, color);
    
    // Generar ID único uniendo ID del Lote + Nombre del Cilindro
    const idUnicoRegistro = `${idLoteActual}_${cilindro}`;

    // Insertar en la nueva tabla dedicada: registros_cilindros
    const { error } = await supabaseClient.from('registros_cilindros').insert([
      {
        id: idUnicoRegistro,
        lote_id: idLoteActual,
        cilindro: cilindro,
        conductividad: conductividad,
        dureza: dureza,
        ph: ph,
        cloro: cloro,
        olor: olor,
        color: color,
        conforme: conforme,
        creado_por: responsable,
        fecha: fecha
      }
    ]);

    if (!error) {
      alert(`Cilindro ${cilindro} registrado con éxito en el lote ${idLoteActual} (${conforme ? 'CONFORME' : 'NO CONFORME'}).`);
      await cargarRegistrosDesdeSupabase();

      document.getElementById('numCilindro').selectedIndex = 0;
      document.getElementById('conductividad').value = '';
      document.getElementById('dureza').value = '';
      document.getElementById('ph').value = '';
      document.getElementById('cloro').value = '';
    } else {
      alert("Error al guardar en Supabase: " + error.message);
    }
  });
}

// ==========================================
// 5. SOLICITUD Y CONFIRMACIÓN DE LOTES
// ==========================================
async function crearSolicitudLote(e) {
  e.preventDefault();
  const detalle = document.getElementById('sol-cilindros').value;
  const fechaEntrega = document.getElementById('sol-fecha').value;

  const siguienteCorrelativo = solicitudes.length + 1;
  const numeroFormateado = siguienteCorrelativo.toString().padStart(3, '0');
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
    await registrarEnBitacoraAutomático(`Nueva solicitud de lote creada: ${idSol} - ${detalle}`);
    await cargarSolicitudesDesdeSupabase();
  } else {
    alert("Error al crear la solicitud: " + error.message);
  }
}

function renderSolicitudes() {
  const container = document.getElementById('lista-solicitudes');
  if (!container) return;
  container.innerHTML = '';

  if (solicitudes.length === 0) {
    container.innerHTML = '<p style="font-size: 0.85rem; color: #666;">No hay solicitudes de nuevos lotes registradas.</p>';
    return;
  }

  solicitudes.forEach(sol => {
    const esOperador = currentUser && currentUser.role === 'operador';
    const estaCompletado = sol.estado === 'Completado';

    const div = document.createElement('div');
    div.className = `solicitud-card ${estaCompletado ? 'completada' : ''}`;
    
    let htmlContent = `
      <div class="solicitud-info">
        <h4><i class="fa-solid fa-box"></i> ${sol.producto}</h4>
        <p>ID Lote: <strong>${sol.id}</strong> | Requerido para: <strong>${sol.fecha_completado || '-'}</strong></p>
        <p>Estado: ${estaCompletado ? '<span style="color: green; font-weight: bold;">✓ Completado y Confirmado</span>' : '<span style="color: orange; font-weight: bold;">Pendiente (En curso)</span>'}</p>
        ${sol.observacion ? `<p style="font-size: 0.8rem; color: #555;"><em>Obs: ${sol.observacion}</em></p>` : ''}
      </div>
      <div class="solicitud-acciones" style="display: flex; gap: 8px; align-items: center;">
    `;

    if (estaCompletado) {
      htmlContent += `
        <button class="btn btn-secondary" onclick="verTablaLoteCompletado('${sol.id}')" style="font-size: 0.8rem; padding: 6px 12px; height: fit-content; cursor: pointer;">
          📊 Ver Tabla
        </button>
      `;
    } else if (esOperador) {
      htmlContent += `
        <button class="btn btn-success" onclick="abrirModalConfirmarLote('${sol.id}')">
          ✅ Confirmar Lote Completado
        </button>
      `;
    }

    htmlContent += `</div>`;
    div.innerHTML = htmlContent;
    container.appendChild(div);
  });
}

function abrirModalConfirmarLote(idSolicitud) {
  loteAConfirmar = idSolicitud;
  document.getElementById('obs-lote-input').value = '';
  document.getElementById('modal-confirmar-lote').style.display = 'flex';
}

function cerrarModalConfirmarLote() {
  loteAConfirmar = null;
  document.getElementById('modal-confirmar-lote').style.display = 'none';
}

async function guardarConfirmacionLote() {
  if (!loteAConfirmar) return;

  const observacion = document.getElementById('obs-lote-input').value.trim();

  const { error } = await supabaseClient
    .from('solicitudes')
    .update({ 
      estado: 'Completado', 
      completado_por: currentUser ? currentUser.nombre : 'Operador',
      observacion: observacion || null
    })
    .eq('id', loteAConfirmar);

  if (!error) {
    await registrarEnBitacoraAutomático(`El lote #${loteAConfirmar} fue completado por ${currentUser ? currentUser.nombre : 'Operador'}.${observacion ? ' Obs: ' + observacion : ''}`);
    cerrarModalConfirmarLote();
    await cargarSolicitudesDesdeSupabase();
    await cargarRegistrosDesdeSupabase();
    alert("¡El lote se ha marcado como completado correctamente!");
  } else {
    alert("Error al confirmar el lote: " + error.message);
  }
}

async function eliminarRegistro(id) {
  if (!currentUser || currentUser.role !== 'admin') {
    alert('Acceso Denegado: Solo el administrador puede eliminar registros.');
    return;
  }
  if (confirm('¿Eliminar este registro de cilindro?')) {
    await supabaseClient.from('registros_cilindros').delete().eq('id', id);
    await cargarRegistrosDesdeSupabase();
  }
}

// ==========================================
// 6. RENDERIZADO TABLA, KPIS Y GRÁFICO
// ==========================================
function actualizarUI() {
  const registrosLoteActivo = registros.filter(r => r.lote === (loteActivoId || 'SIN_LOTE'));

  renderTabla(registrosLoteActivo);
  actualizarKPIs(registrosLoteActivo);
  actualizarGrafico(registrosLoteActivo);
  renderSolicitudes();
}

function renderTabla(datosLoteActivo) {
  const tablaBody = document.getElementById('tabla-body');
  if (!tablaBody) return;
  tablaBody.innerHTML = '';

  const colAccionHeader = document.querySelectorAll('.col-accion');
  
  if (currentUser && currentUser.role === 'admin') {
    colAccionHeader.forEach(el => el.style.display = 'table-cell');
  } else {
    colAccionHeader.forEach(el => el.style.display = 'none');
  }

  if (datosLoteActivo.length === 0) {
    tablaBody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: #777;">No hay cilindros registrados en el lote activo.</td></tr>`;
    limpiarPromedios();
    return;
  }

  datosLoteActivo.forEach(item => {
    const tr = document.createElement('tr');
    const badgeClass = item.conforme ? 'badge-success' : 'badge-danger';
    const estadoTexto = item.conforme ? 'SI' : 'NO';

    let htmlRow = `
      <td><strong>${item.cilindro}</strong></td>
      <td>${item.fecha || '-'}</td>
      <td>${item.responsable || '-'}</td>
      <td>${item.conductividad}</td>
      <td>${item.dureza}</td>
      <td>${item.ph}</td>
      <td>${item.cloro}</td>
      <td>${item.olor}</td>
      <td>${item.color}</td>
      <td><span class="badge ${badgeClass}">${estadoTexto}</span></td>
    `;

    if (currentUser && currentUser.role === 'admin') {
      htmlRow += `
        <td class="col-accion">
          <button class="btn-delete" onclick="eliminarRegistro('${item.id}')">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      `;
    }

    tr.innerHTML = htmlRow;
    tablaBody.appendChild(tr);
  });

  calcularPromedios(datosLoteActivo);
}

function calcularPromedios(datos) {
  const count = datos.length;
  if (count === 0) return limpiarPromedios();

  const sumCond = datos.reduce((a, b) => a + b.conductividad, 0);
  const sumDureza = datos.reduce((a, b) => a + b.dureza, 0);
  const sumPh = datos.reduce((a, b) => a + b.ph, 0);
  const sumCloro = datos.reduce((a, b) => a + b.cloro, 0);

  const eCond = document.getElementById('prom-cond');
  const eDur = document.getElementById('prom-dureza');
  const ePh = document.getElementById('prom-ph');
  const eClo = document.getElementById('prom-cloro');

  if (eCond) eCond.textContent = (sumCond / count).toFixed(2);
  if (eDur) eDur.textContent = (sumDureza / count).toFixed(2);
  if (ePh) ePh.textContent = (sumPh / count).toFixed(2);
  if (eClo) eClo.textContent = (sumCloro / count).toFixed(3);
}

function limpiarPromedios() {
  ['prom-cond', 'prom-dureza', 'prom-ph', 'prom-cloro'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '-';
  });
}

function actualizarKPIs(datosLoteActivo) {
  const conformes = datosLoteActivo.filter(r => r.conforme).length;
  const noConformes = datosLoteActivo.filter(r => !r.conforme).length;
  const promCond = datosLoteActivo.length > 0 
    ? (datosLoteActivo.reduce((a, b) => a + b.conductividad, 0) / datosLoteActivo.length).toFixed(1)
    : '0.0';

  const eTot = document.getElementById('kpi-total');
  const eConf = document.getElementById('kpi-conformes');
  const eNoConf = document.getElementById('kpi-noconformes');
  const eCond = document.getElementById('kpi-cond');

  if (eTot) eTot.textContent = datosLoteActivo.length;
  if (eConf) eConf.textContent = conformes;
  if (eNoConf) eNoConf.textContent = noConformes;
  if (eCond) eCond.textContent = promCond;
}

function inicializarGrafico() {
  const canvas = document.getElementById('qualityChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Conforme', 'No Conforme', 'Restantes'],
      datasets: [{
        data: [0, 0, 100],
        backgroundColor: ['#15803d', '#dc2626', '#e5e7eb']
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '75%',
      plugins: { legend: { position: 'bottom' } }
    }
  });
}

function actualizarGrafico(datosLoteActivo = []) {
  if (!chartInstance) return;

  const conformes = datosLoteActivo.filter(r => r.conforme).length;
  const noConformes = datosLoteActivo.filter(r => !r.conforme).length;
  const totalRegistrados = datosLoteActivo.length;

  // Obtener objetivo desde el lote activo
  const lotePendiente = solicitudes.find(s => s.id === loteActivoId);
  let totalEsperado = 27; // Valor por defecto

  if (lotePendiente && lotePendiente.producto) {
    const match = lotePendiente.producto.match(/\((\d+)\s*cilindros?\)/i);
    if (match && match[1]) {
      totalEsperado = parseInt(match[1], 10);
    }
  }

  const restantes = Math.max(0, totalEsperado - totalRegistrados);
  const porcentajeAvance = totalEsperado > 0 ? Math.round((totalRegistrados / totalEsperado) * 100) : 0;

  chartInstance.data.datasets[0].data = [conformes, noConformes, restantes];
  chartInstance.update();

  const centerText = document.getElementById('chart-center-text');
  if (centerText) {
    centerText.textContent = `${porcentajeAvance}%`;
  }
}

// ==========================================
// MODAL DE LOTE COMPLETADO (OPTIMIZADO)
// ==========================================
function verTablaLoteCompletado(idLote) {
  const modal = document.getElementById('modal-ver-lote');
  const bodyModal = document.getElementById('tabla-body-modal-lote');
  const titulo = document.getElementById('modal-lote-titulo');
  const subtitulo = document.getElementById('modal-lote-subtitulo');

  if (!modal || !bodyModal) {
    console.error("No se encontró la estructura del modal en el HTML.");
    return;
  }

  const cilindrosLote = registros.filter(r => r.lote === idLote);
  
  if (titulo) titulo.textContent = `Cilindros del Lote: ${idLote}`;
  if (subtitulo) subtitulo.textContent = `Total cilindros registrados: ${cilindrosLote.length}`;
  
  bodyModal.innerHTML = '';

  if (cilindrosLote.length === 0) {
    bodyModal.innerHTML = `<tr><td colspan="10" style="text-align:center; padding: 15px; color: #777;">No se registraron cilindros vinculados a este lote.</td></tr>`;
  } else {
    cilindrosLote.forEach(item => {
      const tr = document.createElement('tr');
      const badgeClass = item.conforme ? 'badge-success' : 'badge-danger';
      
      tr.innerHTML = `
        <td><strong>${item.cilindro}</strong></td>
        <td>${item.fecha || '-'}</td>
        <td>${item.responsable || '-'}</td>
        <td>${item.conductividad}</td>
        <td>${item.dureza}</td>
        <td>${item.ph}</td>
        <td>${item.cloro}</td>
        <td>${item.olor}</td>
        <td>${item.color}</td>
        <td><span class="badge ${badgeClass}">${item.conforme ? 'SI' : 'NO'}</span></td>
      `;
      bodyModal.appendChild(tr);
    });
  }

  modal.style.display = 'flex';
}

function cerrarModalLote() {
  const modal = document.getElementById('modal-ver-lote');
  if (modal) modal.style.display = 'none';
}

// Búsqueda
const searchInput = document.getElementById('searchInput');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const registrosLoteActivo = registros.filter(r => r.lote === (loteActivoId || 'SIN_LOTE'));
    const filtrados = registrosLoteActivo.filter(r => r.cilindro.toLowerCase().includes(term));
    renderTabla(filtrados);
  });
}

// Exportación CSV
const btnExport = document.getElementById('btnExport');
if (btnExport) {
  btnExport.addEventListener('click', () => {
    if (registros.length === 0) return alert('No hay datos para exportar.');

    let csvContent = "\uFEFF"; 
    csvContent += "# Cilindro;Lote;Fecha Produccion;Responsable;Conductividad;Dureza Total;pH;Cloro Residual;Olor;Color;Conforme\n";

    registros.forEach(r => {
      const condFormatted = r.conductividad.toString().replace('.', ',');
      const durezaFormatted = r.dureza.toString().replace('.', ',');
      const phFormatted = r.ph.toString().replace('.', ',');
      const cloroFormatted = r.cloro.toString().replace('.', ',');

      csvContent += `"${r.cilindro}";"${r.lote}";"${r.fecha}";"${r.responsable || '-'}";${condFormatted};${durezaFormatted};${phFormatted};${cloroFormatted};"${r.olor}";"${r.color}";"${r.conforme ? 'SI' : 'NO'}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    
    link.setAttribute("href", url);
    link.setAttribute("download", `CPFO-16_AguaTratada_${Date.now()}.csv`);
    document.body.appendChild(link);
    
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  });
}

// ==========================================
// 7. LÓGICA DE BITÁCORA Y OBSERVACIONES
// ==========================================
function abrirBitacora() {
  const modalBitacora = document.getElementById('modal-bitacora');
  if (modalBitacora) {
    modalBitacora.style.display = 'flex';
    renderizarBitacora();
  }
}

function cerrarBitacora() {
  const modalBitacora = document.getElementById('modal-bitacora');
  if (modalBitacora) modalBitacora.style.display = 'none';
}

async function agregarObservacionBitacora(e) {
  e.preventDefault();
  const textarea = document.getElementById('bitacora-texto');
  const texto = textarea.value.trim();

  if (!texto) return;

  const { error } = await supabaseClient.from('bitacora').insert([
    {
      usuario: currentUser ? currentUser.nombre : 'Usuario Anónimo',
      rol: currentUser ? currentUser.role : 'invitado',
      texto: texto
    }
  ]);

  if (!error) {
    textarea.value = '';
    await cargarBitacoraDesdeSupabase();
  }
}

async function registrarEnBitacoraAutomático(mensaje) {
  await supabaseClient.from('bitacora').insert([
    {
      usuario: currentUser ? currentUser.nombre : 'Sistema',
      rol: currentUser ? currentUser.role : 'sistema',
      texto: `📌 [SISTEMA]: ${mensaje}`
    }
  ]);
}

function renderizarBitacora() {
  const contenedor = document.getElementById('lista-bitacora');
  if (!contenedor) return;
  
  if (bitacoraRegistros.length === 0) {
    contenedor.innerHTML = '<p style="text-align:center; color:#777;">No hay registros ni observaciones aún.</p>';
    return;
  }

  contenedor.innerHTML = bitacoraRegistros.map(reg => `
    <div class="bitacora-item" style="border-bottom: 1px solid #ddd; padding: 8px 0;">
      <div class="bitacora-header" style="display: flex; justify-content: space-between; font-size: 0.85rem; color: #555;">
        <span>👤 <strong>${reg.usuario}</strong> (${reg.rol.toUpperCase()})</span>
        <span>🕒 ${reg.fechaHora}</span>
      </div>
      <div class="bitacora-texto" style="margin-top: 4px;">${reg.texto}</div>
    </div>
  `).join('');
}
