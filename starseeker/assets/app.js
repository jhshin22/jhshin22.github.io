const state = {
  events: [],
  dailySummary: [],
  metadata: null,
  currentMonth: new Date(),
  selectedDate: null,
  filters: {
    category: 'all',
    grade: 'all'
  }
};

const gradeLabels = {
  excellent: '매우 추천',
  good: '추천',
  fair: '조건부 가능',
  poor: '비추천'
};

const categoryLabels = {
  moon: '달',
  planet: '행성',
  star: '별',
  meteor_shower: '유성우'
};

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTodayKey() {
  return toDateKey(new Date());
}

function filterEvents(events) {
  return events.filter((event) => {
    const categoryOk = state.filters.category === 'all' || event.category === state.filters.category;
    const gradeOk = state.filters.grade === 'all' || event.grade === state.filters.grade;
    return categoryOk && gradeOk;
  });
}

async function loadJson(path, fallback) {
  try {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${path} ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn(`Failed to load ${path}`, error);
    return fallback;
  }
}

async function init() {
  const [events, dailySummary, metadata] = await Promise.all([
    loadJson('data/events.json', []),
    loadJson('data/daily_summary.json', []),
    loadJson('data/metadata.json', null)
  ]);

  state.events = events;
  state.dailySummary = dailySummary;
  state.metadata = metadata;

  const rangeStart = metadata?.range?.start_date;
  state.currentMonth = rangeStart ? new Date(`${rangeStart}T00:00:00+09:00`) : new Date();
  state.selectedDate = getTodayKey();

  bindEvents();
  renderAll();
}

function bindEvents() {
  document.getElementById('categoryFilter').addEventListener('change', (event) => {
    state.filters.category = event.target.value;
    renderAll();
  });

  document.getElementById('gradeFilter').addEventListener('change', (event) => {
    state.filters.grade = event.target.value;
    renderAll();
  });

  document.getElementById('prevMonth').addEventListener('click', () => {
    state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() - 1, 1);
    renderCalendar();
  });

  document.getElementById('nextMonth').addEventListener('click', () => {
    state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() + 1, 1);
    renderCalendar();
  });
}

function renderAll() {
  renderMetadata();
  renderToday();
  renderCalendar();
  renderDetail(state.selectedDate);
}

function renderMetadata() {
  const el = document.getElementById('metadataCard');
  if (!state.metadata) {
    el.textContent = '메타데이터 없음 · 샘플 또는 로컬 데이터 확인 필요';
    return;
  }

  const generated = state.metadata.generated_at || '-';
  const location = state.metadata.location?.name || '관측지 미지정';
  const start = state.metadata.range?.start_date || '-';
  const end = state.metadata.range?.end_date || '-';
  el.innerHTML = `
    <strong>${location}</strong><br />
    데이터 범위: ${start} ~ ${end}<br />
    생성: ${generated}<br />
    날씨: ${state.metadata.weather_enabled ? '사용' : '미사용'} · KASI: ${state.metadata.kasi_enabled ? '사용' : '미사용'}
  `;
}

function renderToday() {
  const todayKey = getTodayKey();
  document.getElementById('todayDate').textContent = todayKey;
  const list = document.getElementById('todayList');
  const events = filterEvents(state.events)
    .filter((event) => event.calendar_date === todayKey || event.date === todayKey)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  list.innerHTML = events.length ? events.map(renderEventCard).join('') : '<p class="muted">오늘 날짜의 추천 데이터가 없습니다. 캘린더에서 다른 날짜를 선택하세요.</p>';
}

function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  const y = state.currentMonth.getFullYear();
  const m = state.currentMonth.getMonth();
  document.getElementById('monthTitle').textContent = `${y}년 ${m + 1}월`;

  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const blanks = first.getDay();
  const days = last.getDate();
  const pieces = [];

  for (let i = 0; i < blanks; i += 1) {
    pieces.push('<button class="day-card empty" type="button" disabled></button>');
  }

  for (let day = 1; day <= days; day += 1) {
    const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const summary = state.dailySummary.find((item) => item.date === key);
    const events = filterEvents(state.events).filter((event) => (event.calendar_date || event.date) === key);
    const topObjects = summary?.best_objects || events.slice(0, 3).map((event) => event.object_name_kr);
    const grade = summary?.grade || events[0]?.grade || 'poor';
    const active = state.selectedDate === key ? 'active' : '';

    pieces.push(`
      <button class="day-card ${active}" type="button" data-date="${key}">
        <span class="day-num">${day}</span>
        <span class="day-objects">${topObjects.slice(0, 3).join(' · ') || '추천 없음'}</span>
        ${events.length ? `<span class="badge ${grade}">${gradeLabels[grade] || grade}</span>` : '<span class="badge poor">없음</span>'}
      </button>
    `);
  }

  grid.innerHTML = pieces.join('');
  grid.querySelectorAll('.day-card[data-date]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedDate = button.dataset.date;
      renderCalendar();
      renderDetail(state.selectedDate);
    });
  });
}

function renderDetail(dateKey) {
  const title = document.getElementById('detailTitle');
  const list = document.getElementById('detailList');
  title.textContent = `${dateKey} 밤 관측 추천`;

  const events = filterEvents(state.events)
    .filter((event) => (event.calendar_date || event.date) === dateKey)
    .sort((a, b) => `${a.display_time || a.time}`.localeCompare(`${b.display_time || b.time}`));

  list.classList.remove('muted');
  list.innerHTML = events.length ? events.map(renderEventCard).join('') : '<p class="muted">선택한 날짜에 조건을 만족하는 추천 천체가 없습니다.</p>';
}

function renderEventCard(event) {
  const grade = event.grade || 'fair';
  const weather = event.weather?.available
    ? `${event.weather.sky || '-'} · 강수확률 ${event.weather.precipitation_probability ?? '-'}%`
    : '날씨 데이터 없음';
  const time = event.display_time || event.time;
  const category = categoryLabels[event.category] || event.category;

  return `
    <article class="event-card">
      <h3>${time} · ${event.object_name_kr} <span class="badge ${grade}">${gradeLabels[grade] || grade}</span></h3>
      <div class="event-meta">
        ${category} · ${event.direction_kr || '-'} · 고도 ${formatNumber(event.altitude_deg)}° · 방위각 ${formatNumber(event.azimuth_deg)}° · 점수 ${event.score}<br />
        달 조명률 ${formatNumber(event.moon_illumination_pct)}% · 태양고도 ${formatNumber(event.sun_altitude_deg)}° · ${weather}
      </div>
      <p class="event-summary">${event.summary || event.viewing_hint || '관측 메모가 없습니다.'}</p>
    </article>
  `;
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return Number(value).toFixed(1);
}

init();
