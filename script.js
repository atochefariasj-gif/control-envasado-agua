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
  // Mantener la app visible en segundo plano para que se aprecie detrás del modal transparente
  document.getElementById('app-content').style.display = 'block';

  const elemFecha = document.getElementById('fechaProd');
  if (elemFecha) elemFecha.valueAsDate = new Date();
  
  cargarOpcionesCilindros();

  // Registrar Service Worker para PWA y Notificaciones Push
  registrarServiceWorkerYNotificaciones();

  // Inicializar el gráfico básico en fondo
  inicializarGrafico();

  // Cargar datos iniciales desde Supabase
  await cargarRegistrosDesdeSupabase();
  await cargarSolicitudesDesdeSupabase();
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
      console.log('FCM Token de Notificaciones Push:', token);

      if (token) {
        await guardarTokenEnSupabase(token);
      }
    } else {
      console.warn('Permiso de notificaciones denegado.');
    }
  } catch (err) {
    console.error('Error obteniendo token FCM:', err);
  }

  messaging.onMessage((payload) => {
    console.log('Notificación recibida en primer plano:', payload);
    const title = payload.notification?.title || 'Nuevo aviso de producción';
    const body = payload.notification?.body || '';
    alert(`🔔 ${title}\n${body}`);
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
      } else {
        console.log('✅ Token FCM registrado correctamente en Supabase.');
      }
    } else {
      console.log('El dispositivo ya estaba registrado en Supabase.');
    }
  } catch (err) {
    console.error('Error guardando token:', err);
  }
}

// ==========================================
// 2. CONEXIÓN Y ACCIONES SUPABASE (CRUD)
// ==========================================

// --- REGISTROS DE CILINDROS ---
async function cargarRegistrosDesdeSupabase() {
  const { data, error } = await supabaseClient
    .from('solicitudes')
    .select('*')
    .like('producto', 'Registro_CPFO16%')
    .order('created_at', { ascending: true });

  if (!error && data) {
    registros = data.map(item => {
      let dureza = 0;
      let ph = 0;
      let cloro = 0;
      let olor = 'CC';
      let color = 'CC';

      if (item.producto && item.producto.includes('|')) {
        const partes = item.producto.split('|');
        partes.forEach(p => {
          if (p.startsWith('D:')) dureza = parseFloat(p.replace('D:', ''));
          if (p.startsWith('PH:')) ph = parseFloat(p.replace('PH:', ''));
          if (p.startsWith('CL:')) cloro = parseFloat(p.replace('CL:', ''));
          if (p.startsWith('OL:')) olor = p.replace('OL:', '');
          if (p.startsWith('CO:')) color = p.replace('CO:', '');
        });
      }

      const conductividad = parseFloat(item.cantidad ?? 0);

      return {
        id: item.id,
        cilindro: item.id,
        fecha: item.fecha_completado || (item.created_at ? item.created_at.split('T')[0] : ''),
        responsable: item.creado_por,
        conductividad: conductividad,
        dureza: dureza,
        ph: ph,
        cloro: cloro,
        olor: olor,
        color: color,
        conforme: evaluarConformidad(conductividad, dureza, ph, cloro, olor, color)
      };
    });
    actualizarUI();
  }
}

// --- SOLICITUDES DE LOTES ---
async function cargarSolicitudesDesdeSupabase() {
  const { data, error } = await supabaseClient
    .from('solicitudes')
    .select('*')
    .not('producto', 'like', 'Registro_CPFO16%')
    .order('created_at', { ascending: false });

  if (!error && data) {
    solicitudes = data;
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
  supabaseClient
    .channel('public:solicitudes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes' }, () => {
      cargarRegistrosDesdeSupabase();
      cargarSolicitudesDesdeSupabase();
    })
    .subscribe();

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
  // Mantiene visible el fondo de la app mientras muestra el modal de login
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
    const existe = registros.some(r => r.cilindro.toUpperCase() === cilindro.toUpperCase());
    if (existe) {
      alert(`El cilindro ${cilindro} ya ha sido registrado previamente.`);
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
    const datosFormateados = `Registro_CPFO16|D:${dureza}|PH:${ph}|CL:${cloro}|OL:${olor}|CO:${color}`;

    const { error } = await supabaseClient.from('solicitudes').insert([
      {
        id: cilindro,
        producto: datosFormateados,
        cantidad: conductividad,
        estado: conforme ? 'Conforme' : 'No Conforme',
        creado_por: responsable,
        fecha_completado: fecha
      }
    ]);

    if (!error) {
      alert(`Cilindro ${cilindro} registrado con éxito (${conforme ? 'CONFORME' : 'NO CONFORME'}).`);
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

  const lotesExistentes = solicitudes.filter(s => !s.producto.startsWith('Registro_CPFO16'));
  const siguienteCorrelativo = lotesExistentes.length + 1;
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
    container.innerHTML = '<p style="font-size: 0.85rem; color: var(--text-muted);">No hay solicitudes de nuevos lotes registradas.</p>';
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
        <p>Estado: ${estaCompletado ? '<span style="color: green; font-weight: bold;">✓ Completado y Confirmado</span>' : '<span style="color: orange; font-weight: bold;">Pendiente</span>'}</p>
      </div>
    `;

    if (esOperador && !estaCompletado) {
      htmlContent += `
        <button class="btn btn-success" onclick="confirmarLote('${sol.id}')">
          ✅ Confirmar Lote Completado
        </button>
      `;
    }

    div.innerHTML = htmlContent;
    container.appendChild(div);
  });
}

async function confirmarLote(idSolicitud) {
  if (!confirm("¿Está seguro de marcar este lote como completado?")) return;

  const { error } = await supabaseClient
    .from('solicitudes')
    .update({ 
      estado: 'Completado', 
      completado_por: currentUser ? currentUser.nombre : 'Operador' 
    })
    .eq('id', idSolicitud);

  if (!error) {
    await registrarEnBitacoraAutomático(`El lote #${idSolicitud} fue completado y confirmado.`);
    await cargarSolicitudesDesdeSupabase();
    alert("¡El lote se ha marcado como completado correctamente!");
  }
}

async function eliminarRegistro(id) {
  if (!currentUser || currentUser.role !== 'admin') {
    alert('Acceso Denegado: Solo el administrador puede eliminar registros.');
    return;
  }
  if (confirm('¿Eliminar este registro de cilindro?')) {
    await supabaseClient.from('solicitudes').delete().eq('id', id);
    await cargarRegistrosDesdeSupabase();
  }
}

// ==========================================
// 6. RENDERIZADO TABLA, KPIS Y GRÁFICO
// ==========================================
function actualizarUI() {
  renderTabla(registros);
  actualizarKPIs();
  actualizarGrafico();
  renderSolicitudes();
}

function renderTabla(datos) {
  const tablaBody = document.getElementById('tabla-body');
  if (!tablaBody) return;
  tablaBody.innerHTML = '';

  const colAccionHeader = document.querySelectorAll('.col-accion');
  
  if (currentUser && currentUser.role === 'admin') {
    colAccionHeader.forEach(el => el.style.display = 'table-cell');
  } else {
    colAccionHeader.forEach(el => el.style.display = 'none');
  }

  if (datos.length === 0) {
    tablaBody.innerHTML = `<tr><td colspan="11">No hay cilindros registrados.</td></tr>`;
    limpiarPromedios();
    return;
  }

  datos.forEach(item => {
    const tr = document.createElement('tr');
    const badgeClass = item.conforme ? 'badge-success' : 'badge-danger';
    const estadoTexto = item.conforme ? 'SI' : 'NO';

    let htmlRow = `
      <td><strong>${item.cilindro}</strong></td>
      <td>${item.fecha}</td>
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

  calcularPromedios(datos);
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

function actualizarKPIs() {
  const conformes = registros.filter(r => r.conforme).length;
  const noConformes = registros.filter(r => !r.conforme).length;
  const promCond = registros.length > 0 
    ? (registros.reduce((a, b) => a + b.conductividad, 0) / registros.length).toFixed(1)
    : '0.0';

  const eTot = document.getElementById('kpi-total');
  const eConf = document.getElementById('kpi-conformes');
  const eNoConf = document.getElementById('kpi-noconformes');
  const eCond = document.getElementById('kpi-cond');

  if (eTot) eTot.textContent = registros.length;
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
      labels: ['Conforme', 'No Conforme'],
      datasets: [{
        data: [0, 0],
        backgroundColor: ['#15803d', '#dc2626']
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } }
    }
  });
}

function actualizarGrafico() {
  if (!chartInstance) return;
  const conformes = registros.filter(r => r.conforme).length;
  const noConformes = registros.filter(r => !r.conforme).length;

  chartInstance.data.datasets[0].data = [conformes, noConformes];
  chartInstance.update();
}

// Búsqueda
const searchInput = document.getElementById('searchInput');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtrados = registros.filter(r => r.cilindro.toLowerCase().includes(term));
    renderTabla(filtrados);
  });
}

// Exportación CSV
const btnExport = document.getElementById('btnExport');
if (btnExport) {
  btnExport.addEventListener('click', () => {
    if (registros.length === 0) return alert('No hay datos para exportar.');

    let csvContent = "\uFEFF"; 
    csvContent += "# Cilindro;Fecha Produccion;Responsable;Conductividad;Dureza Total;pH;Cloro Residual;Olor;Color;Conforme\n";

    registros.forEach(r => {
      const condFormatted = r.conductividad.toString().replace('.', ',');
      const durezaFormatted = r.dureza.toString().replace('.', ',');
      const phFormatted = r.ph.toString().replace('.', ',');
      const cloroFormatted = r.cloro.toString().replace('.', ',');

      csvContent += `"${r.cilindro}";"${r.fecha}";"${r.responsable || '-'}";${condFormatted};${durezaFormatted};${phFormatted};${cloroFormatted};"${r.olor}";"${r.color}";"${r.conforme ? 'SI' : 'NO'}"\n`;
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
  document.getElementById('modal-bitacora').style.display = 'flex';
  renderizarBitacora();
}

function cerrarBitacora() {
  document.getElementById('modal-bitacora').style.display = 'none';
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
