// ==========================================
// CONFIGURACIÓN DE SUPABASE Y ESTADOS
// ==========================================
const SUPABASE_URL = 'https://mpomtdtmdsggyhnvdof.supabase.co';
const SUPABASE_KEY = 'sb_publishable_5Z828OdqG-DuZNcgYJq_lQ_eMp-zeBk'; 

// Uso de _supabase para evitar conflictos con el objeto global de la CDN
const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let registros = [];
let solicitudes = [];
let currentUser = null; 
let selectedRoleTemp = '';
let chartInstance = null;

// Credenciales actualizadas
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

// Cargar la lista desplegable OW001 - OW027
function cargarOpcionesCilindros() {
  const selectCilindro = document.getElementById('numCilindro');
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
  document.getElementById('fechaProd').valueAsDate = new Date();
  cargarOpcionesCilindros();

  // Cargar datos desde Supabase
  await cargarDatosSupabase();

  // Suscribirse a cambios en tiempo real
  suscripcionEnTiempoReal();
});

// CARGAR DESDE SUPABASE
async function cargarDatosSupabase() {
  const { data: dataReg, error: errReg } = await _supabase
    .from('registros_agua')
    .select('*')
    .order('id', { ascending: true });
  
  if (!errReg) registros = dataReg || [];

  const { data: dataSol, error: errSol } = await _supabase
    .from('solicitudes')
    .select('*')
    .order('id', { ascending: false });

  if (!errSol) solicitudes = dataSol || [];

  actualizarUI();
}

// TIEMPO REAL CON SUPABASE
function suscripcionEnTiempoReal() {
  _supabase
    .channel('cambios-agua-industrial')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'registros_agua' }, () => {
      cargarDatosSupabase();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes' }, () => {
      cargarDatosSupabase();
    })
    .subscribe();
}

// DISPARAR NOTIFICACIÓN PUSH ONESIGNAL
function enviarNotificacionPush(titulo, mensaje) {
  if (window.OneSignalDeferred) {
    OneSignalDeferred.push(async function(OneSignal) {
      console.log("Notificación Push enviada:", titulo, mensaje);
    });
  }
}

// LÓGICA DE CONTROL DE ROLES Y LOGIN
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
    document.getElementById('responsable').value = currentUser.nombre;
  }

  aplicarPermisosPorRol();
  inicializarGrafico();
  actualizarUI();
}

function cerrarSesion() {
  currentUser = null;
  document.getElementById('app-content').style.display = 'none';
  document.getElementById('login-modal').style.display = 'flex';
  volverARoles();
}

// APLICAR PERMISOS SEGÚN ROL
function aplicarPermisosPorRol() {
  const secForm = document.getElementById('sec-formulario');
  const secSolicitudes = document.getElementById('sec-solicitudes');
  const formSolicitud = document.getElementById('form-solicitud');
  const btnExport = document.getElementById('btnExport');
  const mainGrid = document.querySelector('.main-grid');

  secSolicitudes.style.display = 'block';

  if (currentUser.role === 'operador') {
    secForm.style.display = 'block';
    formSolicitud.style.display = 'none';
    btnExport.style.display = 'none';
    mainGrid.classList.remove('full-width-grid');
  } 
  else if (currentUser.role === 'admin') {
    secForm.style.display = 'none';
    formSolicitud.style.display = 'none';
    btnExport.style.display = 'inline-flex';
    mainGrid.classList.add('full-width-grid');
  } 
  else if (currentUser.role === 'jefe') {
    secForm.style.display = 'none';
    formSolicitud.style.display = 'grid';
    btnExport.style.display = 'none';
    mainGrid.classList.add('full-width-grid');
  }
}

// EVALUACIÓN DE CALIDAD
function evaluarConformidad(cond, dureza, ph, cloro, olor, color) {
  const condOK = cond <= 70.0;
  const durezaOK = dureza <= 2.0;
  const phOK = ph >= 6.0 && ph <= 7.0;
  const cloroOK = cloro < 0.01;
  const olorOK = olor === 'CC';
  const colorOK = color === 'CC';

  return condOK && durezaOK && phOK && cloroOK && olorOK && colorOK;
}

// REGISTRO DE CILINDRO
document.getElementById('form-agua').addEventListener('submit', async (e) => {
  e.preventDefault();

  const cilindro = document.getElementById('numCilindro').value;

  const existe = registros.some(r => r.cilindro.toUpperCase() === cilindro.toUpperCase());
  if (existe) {
    alert(`El cilindro ${cilindro} ya ha sido registrado previamente. Elija uno diferente.`);
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

  const nuevoRegistro = {
    cilindro,
    fecha,
    responsable,
    conductividad,
    dureza,
    ph,
    cloro,
    olor,
    color,
    conforme
  };

  const { error } = await _supabase.from('registros_agua').insert([nuevoRegistro]);

  if (error) {
    alert('Error al registrar en la base de datos.');
    console.error(error);
  } else {
    enviarNotificacionPush("💧 Nuevo Cilindro Registrado", `Cilindro ${cilindro} registrado por ${responsable}`);
  }

  document.getElementById('numCilindro').selectedIndex = 0;
  document.getElementById('conductividad').value = '';
  document.getElementById('dureza').value = '';
  document.getElementById('ph').value = '';
  document.getElementById('cloro').value = '';
});

// SOLICITUD DE NUEVO LOTE (Jefe de producción)
async function crearSolicitudLote(e) {
  e.preventDefault();
  const detalle = document.getElementById('sol-cilindros').value;
  const fechaEntrega = document.getElementById('sol-fecha').value;
  
  const ahora = new Date();
  const horaReal = ahora.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const nuevaSol = {
    detalle,
    fechaEntrega,
    horaReal
  };

  const { error } = await _supabase.from('solicitudes').insert([nuevaSol]);

  if (error) {
    alert('Error al crear la solicitud.');
    console.error(error);
  } else {
    enviarNotificacionPush("📦 Nueva Solicitud de Lote", `Detalle: ${detalle}`);
  }

  document.getElementById('sol-cilindros').value = '';
  document.getElementById('sol-fecha').value = '';
}

function renderSolicitudes() {
  const container = document.getElementById('lista-solicitudes');
  container.innerHTML = '';

  if (solicitudes.length === 0) {
    container.innerHTML = '<p style="font-size: 0.85rem; color: var(--text-muted);">No hay solicitudes de nuevos lotes registradas.</p>';
    return;
  }

  solicitudes.forEach(sol => {
    const div = document.createElement('div');
    div.className = 'solicitud-card';
    div.innerHTML = `
      <div class="solicitud-info">
        <h4><i class="fa-solid fa-box"></i> ${sol.detalle}</h4>
        <p>Fecha Requerida: <strong>${sol.fechaEntrega}</strong></p>
      </div>
      <div class="solicitud-time">
        <i class="fa-regular fa-clock"></i> Solicitado a las ${sol.horaReal || 'N/A'}
      </div>
    `;
    container.appendChild(div);
  });
}

async function eliminarRegistro(id) {
  if (currentUser.role !== 'admin') {
    alert('Acceso Denegado: Solo el administrador puede eliminar registros.');
    return;
  }
  if (confirm('¿Eliminar este registro de cilindro?')) {
    const { error } = await _supabase.from('registros_agua').delete().eq('id', id);
    if (error) {
      alert('No se pudo eliminar el registro.');
      console.error(error);
    }
  }
}

function actualizarUI() {
  const registrosOrdenados = [...registros].sort((a, b) => a.id - b.id);
  renderTabla(registrosOrdenados);
  actualizarKPIs();
  actualizarGrafico();
  renderSolicitudes();
}

function renderTabla(datos) {
  const tablaBody = document.getElementById('tabla-body');
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
          <button class="btn-delete" onclick="eliminarRegistro(${item.id})">
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
  const sumCond = datos.reduce((a, b) => a + b.conductividad, 0);
  const sumDureza = datos.reduce((a, b) => a + b.dureza, 0);
  const sumPh = datos.reduce((a, b) => a + b.ph, 0);
  const sumCloro = datos.reduce((a, b) => a + b.cloro, 0);

  document.getElementById('prom-cond').textContent = (sumCond / count).toFixed(2);
  document.getElementById('prom-dureza').textContent = (sumDureza / count).toFixed(2);
  document.getElementById('prom-ph').textContent = (sumPh / count).toFixed(2);
  document.getElementById('prom-cloro').textContent = (sumCloro / count).toFixed(3);
}

function limpiarPromedios() {
  document.getElementById('prom-cond').textContent = '-';
  document.getElementById('prom-dureza').textContent = '-';
  document.getElementById('prom-ph').textContent = '-';
  document.getElementById('prom-cloro').textContent = '-';
}

function actualizarKPIs() {
  const conformes = registros.filter(r => r.conforme).length;
  const noConformes = registros.filter(r => !r.conforme).length;
  const promCond = registros.length > 0 
    ? (registros.reduce((a, b) => a + b.conductividad, 0) / registros.length).toFixed(1)
    : '0.0';

  document.getElementById('kpi-total').textContent = registros.length;
  document.getElementById('kpi-conformes').textContent = conformes;
  document.getElementById('kpi-noconformes').textContent = noConformes;
  document.getElementById('kpi-cond').textContent = promCond;
}

function inicializarGrafico() {
  const ctx = document.getElementById('qualityChart').getContext('2d');
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

// Búsqueda por cilindro
document.getElementById('searchInput').addEventListener('input', (e) => {
  const term = e.target.value.toLowerCase();
  const filtrados = registros
    .filter(r => r.cilindro.toLowerCase().includes(term))
    .sort((a, b) => a.id - b.id);
  renderTabla(filtrados);
});

// EXPORTACIÓN CSV
document.getElementById('btnExport').addEventListener('click', () => {
  if (registros.length === 0) return alert('No hay datos para exportar.');

  let csvContent = "\uFEFF"; 
  csvContent += "# Cilindro;Fecha Produccion;Responsable;Conductividad;Dureza Total;pH;Cloro Residual;Olor;Color;Conforme\n";

  const datosOrdenados = [...registros].sort((a, b) => a.id - b.id);

  datosOrdenados.forEach(r => {
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
