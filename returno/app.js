// ═══════════════════════════════════════════════════════════
// ReTurno — Motor de simulación de cobertura de cancelaciones
// ═══════════════════════════════════════════════════════════

// ─── Datos de la Agenda ─────────────────────────────────────

const agendaData = [
  { time: '09:00', client: 'María López',       service: 'Limpieza facial profunda',     status: 'confirmed' },
  { time: '09:45', client: 'Ana García',         service: 'Manicura semipermanente',      status: 'confirmed' },
  { time: '10:30', client: 'Carmen Ruiz',        service: 'Masaje relajante 60 min',      status: 'confirmed' },
  { time: '11:15', client: 'Laura Fernández',    service: 'Depilación láser',             status: 'confirmed' },
  { time: '12:00', client: 'Isabel Martín',      service: 'Tratamiento capilar',          status: 'confirmed' },
  { time: '12:45', client: '— PAUSA —',          service: 'Almuerzo',                     status: 'break' },
  { time: '13:30', client: 'Patricia Sánchez',   service: 'Ácido hialurónico',            status: 'confirmed' },
  { time: '14:15', client: 'Elena Torres',       service: 'Mesoterapia facial',           status: 'confirmed' },
  { time: '15:00', client: 'Cristina Díaz',      service: 'Radiofrecuencia corporal',     status: 'confirmed' },
  { time: '15:45', client: 'Rosa Jiménez',       service: 'Hidratación profunda',         status: 'confirmed' },
  { time: '16:30', client: 'Marta Vega',         service: 'Tratamiento anti-age',         status: 'cancelled', id: 'cancelled-slot' },
  { time: '17:15', client: 'Andrea Gil',         service: 'Limpieza con extracciones',    status: 'confirmed' },
  { time: '18:00', client: 'Beatriz Molina',     service: 'Extensión de pestañas',        status: 'confirmed' },
  { time: '18:45', client: 'Diana Navarro',      service: 'Drenaje linfático',            status: 'confirmed' },
];

// ─── Datos de la Lista de Espera ────────────────────────────

const waitlistData = [
  { name: 'Julia Ortega',    service: 'Tratamiento anti-age',       availability: '16:00 – 18:00', initials: 'JO', match: 98,  bestMatch: true,  id: 'waitlist-julia' },
  { name: 'Sara Delgado',    service: 'Botox preventivo',           availability: '15:00 – 17:00', initials: 'SD', match: 72,  bestMatch: false, id: 'waitlist-sara' },
  { name: 'Verónica Castro', service: 'Masaje descontracturante',   availability: 'Solo mañanas',  initials: 'VC', match: 35,  bestMatch: false, id: 'waitlist-veronica' },
  { name: 'Natalia Ramos',   service: 'Peeling químico',            availability: '17:00 – 19:00', initials: 'NR', match: 45,  bestMatch: false, id: 'waitlist-natalia' },
  { name: 'Claudia Vidal',   service: 'Microblading cejas',         availability: '14:00 – 16:00', initials: 'CV', match: 20,  bestMatch: false, id: 'waitlist-claudia' },
];

// ─── Referencias DOM ────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const agendaList       = $('#agendaList');
const waitlistItems    = $('#waitlistItems');
const simButton        = $('#simButton');
const resetButton      = $('#resetButton');
const simSteps         = $('#simSteps');
const toastContainer   = $('#toastContainer');
const whatsappOverlay  = $('#whatsappOverlay');
const confettiContainer = $('#confettiContainer');

// ─── Inicialización ─────────────────────────────────────────

function init() {
  setCurrentDate();
  renderAgenda();
  renderWaitlist();
}

function setCurrentDate() {
  const now = new Date();
  const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  let dateStr = now.toLocaleDateString('es-ES', options);
  dateStr = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
  $('#currentDate').textContent = dateStr;
}

function renderAgenda() {
  agendaList.innerHTML = agendaData.map((item, i) => {
    const statusClass = item.status === 'confirmed' ? 'status-confirmed' :
                        item.status === 'cancelled' ? 'status-cancelled' : 'status-break';
    const itemClass   = item.status === 'cancelled' ? 'cancelled' : '';
    const statusLabel = item.status === 'confirmed' ? 'Confirmada' :
                        item.status === 'cancelled' ? '✕ Cancelada' : 'Pausa';
    const itemId = item.id || `agenda-${i}`;
    return `
      <div class="agenda-item ${itemClass}" id="${itemId}">
        <div class="agenda-time">${item.time}</div>
        <div class="agenda-info">
          <div class="agenda-client">${item.client}</div>
          <div class="agenda-service">${item.service}</div>
        </div>
        <span class="agenda-status ${statusClass}">${statusLabel}</span>
      </div>`;
  }).join('');
}

function renderWaitlist() {
  waitlistItems.innerHTML = waitlistData.map(item => `
    <div class="waitlist-card ${item.bestMatch ? 'best-match' : ''}" id="${item.id}">
      <div class="waitlist-avatar">${item.initials}</div>
      <div class="waitlist-info">
        <div class="waitlist-name">${item.name}</div>
        <div class="waitlist-service">${item.service}</div>
        <div class="waitlist-availability">🕐 ${item.availability}</div>
      </div>
      <div class="waitlist-match">${item.match}% match</div>
    </div>`).join('');
}

// ─── Motor de Simulación ────────────────────────────────────

let isSimulating = false;

async function startSimulation() {
  if (isSimulating) return;
  isSimulating = true;

  simButton.disabled = true;
  simButton.innerHTML = '⏳ Simulando...';
  simSteps.classList.add('visible');

  await step1_DetectGap();
  await step2_FindCandidate();
  await step3_SendWhatsApp();
  await step4_ReceiveConfirmation();
  await step5_CoverSlot();

  isSimulating = false;
}

// — Paso 1: Detectar hueco ————————————————————————

async function step1_DetectGap() {
  activateStep(1);
  showToast('🔍', 'Escaneando agenda...', 'Buscando huecos por cancelaciones', 'info');

  const slot = $('#cancelled-slot');
  slot.classList.add('scanning');
  slot.scrollIntoView({ behavior: 'smooth', block: 'center' });

  await delay(2200);
  showToast('🚨', 'Hueco detectado', '16:30 — Tratamiento anti-age · €85', 'warning');
  completeStep(1);
  await delay(1200);
}

// — Paso 2: Buscar candidato compatible ———————————

async function step2_FindCandidate() {
  activateStep(2);
  showToast('📋', 'Analizando lista de espera...', 'Comparando servicio, horario y compatibilidad', 'info');

  const cards = $$('.waitlist-card');

  for (let i = 0; i < cards.length; i++) {
    cards[i].classList.add('scanning');
    await delay(550);

    if (!waitlistData[i].bestMatch) {
      cards[i].classList.remove('scanning');
    } else {
      cards[i].classList.remove('scanning');
      cards[i].classList.add('selected');
      break;
    }
  }

  await delay(600);
  showToast('✅', '¡Candidata ideal encontrada!', 'Julia Ortega — 98% compatibilidad · Mismo servicio', 'success');
  completeStep(2);
  await delay(1200);
}

// — Paso 3: Enviar WhatsApp ——————————————————————

async function step3_SendWhatsApp() {
  activateStep(3);
  showToast('📱', 'Enviando WhatsApp automático...', 'Contactando a Julia Ortega', 'whatsapp');

  whatsappOverlay.classList.add('active');
  await delay(900);

  $('#waMsg1').classList.add('visible');
  await delay(2200);
  completeStep(3);
}

// — Paso 4: Recibir confirmación —————————————————

async function step4_ReceiveConfirmation() {
  activateStep(4);

  $('#waTyping').classList.add('visible');
  await delay(2800);

  $('#waTyping').classList.remove('visible');
  await delay(350);

  $('#waMsg2').classList.add('visible');
  await delay(1800);

  whatsappOverlay.classList.remove('active');
  showToast('💬', '¡Julia ha confirmado! ✓✓', 'Respuesta recibida en 1.2 minutos', 'success');
  completeStep(4);
  await delay(1000);
}

// — Paso 5: Cubrir hueco y celebrar —————————————

async function step5_CoverSlot() {
  activateStep(5);

  const slot = $('#cancelled-slot');
  slot.classList.remove('cancelled', 'scanning');
  slot.classList.add('recovered');

  slot.querySelector('.agenda-client').textContent = 'Julia Ortega';
  slot.querySelector('.agenda-service').textContent = 'Tratamiento anti-age';
  const statusEl = slot.querySelector('.agenda-status');
  statusEl.textContent = '✓ Recuperada';
  statusEl.className = 'agenda-status status-confirmed';

  slot.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await delay(600);

  updateMetrics();
  launchConfetti();

  showToast('🎉', '¡Hueco cubierto con éxito!', '€85 recuperados · Tiempo: 1.2 min · Tasa: 95%', 'success');
  completeStep(5);

  simButton.innerHTML = '✅ Simulación completada';
  resetButton.classList.add('visible');
}

// ─── Gestión de pasos ───────────────────────────────────────

function activateStep(n) {
  $$('.sim-step').forEach(s => {
    if (+s.dataset.step === n) {
      s.classList.add('active');
      s.classList.remove('completed');
    }
  });
}

function completeStep(n) {
  $$('.sim-step').forEach(s => {
    if (+s.dataset.step === n) {
      s.classList.remove('active');
      s.classList.add('completed');
      s.querySelector('.sim-step-icon').textContent = '✓';
    }
  });
}

// ─── Actualización de métricas ──────────────────────────────

function updateMetrics() {
  animateMetric('metricRevenue',      '€12.535');
  animateMetric('metricAppointments', '48');
  animateMetric('metricTime',         '3.8 min');

  $$('.metric-change').forEach(el => {
    el.classList.add('highlight');
    setTimeout(() => el.classList.remove('highlight'), 700);
  });
}

function animateMetric(id, newVal) {
  const el = $(`#${id}`);
  el.style.transform = 'scale(1.1)';
  el.style.color = 'var(--emerald)';
  setTimeout(() => {
    el.textContent = newVal;
    el.style.transform = 'scale(1)';
    setTimeout(() => { el.style.color = ''; }, 500);
  }, 300);
}

// ─── Sistema de Toasts ──────────────────────────────────────

function showToast(icon, title, description, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <div>
      <div style="font-weight:600">${title}</div>
      <div style="font-size:0.75rem;color:var(--text-secondary);margin-top:2px">${description}</div>
    </div>`;
  toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 500);
  }, 4500);
}

// ─── Confetti ───────────────────────────────────────────────

function launchConfetti() {
  const colors = ['#0D9373', '#FF6B6B', '#F59E0B', '#3B82F6', '#8B5CF6', '#EC4899', '#10B981'];

  for (let i = 0; i < 80; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = `${Math.random() * 1.2}s`;
    piece.style.animationDuration = `${Math.random() * 2 + 2}s`;
    piece.style.width = `${Math.random() * 8 + 5}px`;
    piece.style.height = `${Math.random() * 8 + 5}px`;
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    confettiContainer.appendChild(piece);
  }

  setTimeout(() => { confettiContainer.innerHTML = ''; }, 5000);
}

// ─── Reiniciar ──────────────────────────────────────────────

function resetSimulation() {
  // Pasos
  $$('.sim-step').forEach(s => {
    s.classList.remove('active', 'completed');
    s.querySelector('.sim-step-icon').textContent = s.dataset.step;
  });
  simSteps.classList.remove('visible');

  // Botones
  simButton.disabled = false;
  simButton.innerHTML = '⚡ Simular cancelación';
  resetButton.classList.remove('visible');

  // Lista de espera
  $$('.waitlist-card').forEach(c => c.classList.remove('scanning', 'selected'));

  // WhatsApp
  $('#waMsg1').classList.remove('visible');
  $('#waMsg2').classList.remove('visible');
  $('#waTyping').classList.remove('visible');

  // Métricas
  $('#metricRevenue').textContent = '€12.450';
  $('#metricAppointments').textContent = '47';
  $('#metricTime').textContent = '4.2 min';

  // Agenda
  renderAgenda();

  // Limpieza
  toastContainer.innerHTML = '';
  confettiContainer.innerHTML = '';
}

// ─── Utilidades ─────────────────────────────────────────────

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Arranque ───────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
