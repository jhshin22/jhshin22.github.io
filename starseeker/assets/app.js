const state = {
  events: [],
  dailySummary: [],
  noRecommendationReasons: [],
  metadata: null,
  currentMonth: new Date(),
  selectedDate: null,
  expandedEventKey: null,
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

function filterEventsForList(events) {
  return events.filter((event) => {
    const categoryOk = state.filters.category === 'all' || event.category === state.filters.category;
    const gradeOk = state.filters.grade === 'all' || event.grade === state.filters.grade;
    return categoryOk && gradeOk;
  });
}

function eventDisplayTime(event) {
  return event.display_time || event.time || '-';
}

function eventDateTime(event) {
  const raw = event.datetime || `${event.date || event.calendar_date}T${eventDisplayTime(event)}:00+09:00`;
  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function visibilityTimeRange(event) {
  const items = Array.isArray(event.grouped_events) && event.grouped_events.length ? event.grouped_events : [event];
  const sortedByTime = [...items].sort((a, b) => eventDateTime(a) - eventDateTime(b));
  const start = eventDisplayTime(sortedByTime[0]);
  const end = eventDisplayTime(sortedByTime[sortedByTime.length - 1]);
  return `${start} ~ ${end}`;
}

function objectGroupKey(event) {
  return `${event.calendar_date || event.date}__${event.category}__${event.object_id || event.object_name_kr}`;
}

function groupEventsByObject(events) {
  const groups = new Map();

  events.forEach((event) => {
    const key = objectGroupKey(event);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  });

  return Array.from(groups.entries()).map(([key, items]) => {
    const sortedByTime = [...items].sort((a, b) => eventDateTime(a) - eventDateTime(b));
    const sortedByScore = [...items].sort((a, b) => b.score - a.score);
    const best = sortedByScore[0];
    const first = sortedByTime[0];
    const last = sortedByTime[sortedByTime.length - 1];

    return {
      ...best,
      group_key: key,
      time_range: `${eventDisplayTime(first)} ~ ${eventDisplayTime(last)}`,
      start_time: eventDisplayTime(first),
      end_time: eventDisplayTime(last),
      best_time: eventDisplayTime(best),
      slot_count: sortedByTime.length,
      grouped_events: sortedByTime
    };
  }).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return eventDateTime(a) - eventDateTime(b);
  });
}

function uniqueObjectNames(events, limit = 3) {
  const names = [];
  const seen = new Set();
  events
    .sort((a, b) => b.score - a.score)
    .forEach((event) => {
      const key = `${event.category}__${event.object_id || event.object_name_kr}`;
      if (!seen.has(key)) {
        seen.add(key);
        names.push(event.object_name_kr);
      }
    });
  return names.slice(0, limit);
}

function weatherSeverity(weather) {
  if (!weather || !weather.available) return 0;
  let severity = 0;
  const cloud = Number(weather.cloud_cover);
  const pop = Number(weather.precipitation_probability);
  const precipitation = Number(weather.precipitation);
  if (!Number.isNaN(precipitation) && precipitation > 0) severity += 4;
  if (!Number.isNaN(pop) && pop >= 50) severity += 3;
  if (!Number.isNaN(cloud) && cloud >= 80) severity += 4;
  else if (!Number.isNaN(cloud) && cloud >= 65) severity += 2;
  else if (!Number.isNaN(cloud) && cloud >= 40) severity += 1;
  return severity;
}

function warningsForEvent(event) {
  const warnings = [];
  const items = Array.isArray(event.grouped_events) && event.grouped_events.length ? event.grouped_events : [event];
  const worstWeather = items
    .map((item) => item.weather)
    .filter(Boolean)
    .sort((a, b) => weatherSeverity(b) - weatherSeverity(a))[0];

  if (worstWeather?.available) {
    const cloud = Number(worstWeather.cloud_cover);
    const pop = Number(worstWeather.precipitation_probability);
    const precipitation = Number(worstWeather.precipitation);
    if (!Number.isNaN(cloud) && cloud >= 65) warnings.push(`구름량이 높은 시간대가 있습니다(${cloud}%).`);
    else if (!Number.isNaN(cloud) && cloud >= 40) warnings.push(`구름이 일부 있어 시야가 불안정할 수 있습니다(${cloud}%).`);
    if (!Number.isNaN(pop) && pop >= 30) warnings.push(`강수확률이 다소 있습니다(${pop}%).`);
    if (!Number.isNaN(precipitation) && precipitation > 0) warnings.push('강수 예보가 있어 실제 관측이 어려울 수 있습니다.');
  }

  if (Number(event.altitude_deg) < 20) warnings.push('고도가 낮아 건물, 산, 나무에 가려질 수 있습니다.');
  if (Number(event.sun_altitude_deg) > -12) warnings.push('하늘이 완전히 어두워지기 전이라 대비가 약할 수 있습니다.');
  if (event.category === 'star' && Number(event.moon_altitude_deg) > 0 && Number(event.moon_illumination_pct) >= 40) {
    warnings.push(`달빛이 밝아 별 관측이 방해될 수 있습니다(달 조명률 ${formatNumber(event.moon_illumination_pct)}%).`);
  }

  if (!warnings.length) warnings.push('큰 관측 방해 요인은 적은 편입니다.');
  return warnings;
}

function noRecommendationReason(dateKey, allEventsForDate) {
  const generatedReason = state.noRecommendationReasons.find((item) => item.date === dateKey);
  if (generatedReason?.reason) return generatedReason.reason;

  if (!allEventsForDate.length) {
    return '고도, 밝기, 하늘 어두움 조건을 동시에 만족하는 대상이 없습니다.';
  }

  return '현재 선택한 필터 조건을 만족하는 추천 대상이 없습니다.';
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
  const [events, dailySummary, noRecommendationReasons, metadata] = await Promise.all([
    loadJson('data/events.json', []),
    loadJson('data/daily_summary.json', []),
    loadJson('data/no_recommendation_reasons.json', []),
    loadJson('data/metadata.json', null)
  ]);

  state.events = events;
  state.dailySummary = dailySummary;
  state.noRecommendationReasons = noRecommendationReasons;
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
    state.expandedEventKey = null;
    renderAll();
  });

  document.getElementById('gradeFilter').addEventListener('change', (event) => {
    state.filters.grade = event.target.value;
    state.expandedEventKey = null;
    renderAll();
  });

  document.getElementById('prevMonth').addEventListener('click', () => {
    state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() - 1, 1);
    state.expandedEventKey = null;
    renderCalendar();
    renderDetail(state.selectedDate);
  });

  document.getElementById('nextMonth').addEventListener('click', () => {
    state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() + 1, 1);
    state.expandedEventKey = null;
    renderCalendar();
    renderDetail(state.selectedDate);
  });
}

function renderAll() {
  renderMetadata();
  renderCalendar();
  renderDetail(state.selectedDate);
}

function renderMetadata() {
  const el = document.getElementById('metadataCard');
  el.innerHTML = '<strong>별보러 언제갈까?</strong><br />서울에서 별이 관측 가능한 날을 알아보세요';
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
    const events = filterEventsForList(state.events).filter((event) => (event.calendar_date || event.date) === key);
    const topObjects = summary?.best_objects || uniqueObjectNames(events, 3);
    const grouped = groupEventsByObject(events);
    const grade = summary?.grade || grouped[0]?.grade || 'poor';
    const active = state.selectedDate === key ? 'active' : '';

    pieces.push(`
      <button class="day-card ${active}" type="button" data-date="${key}">
        <span class="day-num">${day}</span>
        <span class="day-objects">${topObjects.slice(0, 3).join(' · ') || '추천 없음'}</span>
        ${grouped.length ? `<span class="badge ${grade}">${gradeLabels[grade] || grade}</span>` : '<span class="badge poor">추천 없음</span>'}
      </button>
    `);
  }

  grid.innerHTML = pieces.join('');
  grid.querySelectorAll('.day-card[data-date]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedDate = button.dataset.date;
      state.expandedEventKey = null;
      renderCalendar();
      renderDetail(state.selectedDate);
    });
  });
}

function renderDetail(dateKey) {
  const title = document.getElementById('detailTitle');
  const list = document.getElementById('detailList');
  title.textContent = `${dateKey} 밤 관측 추천`;

  const allDateEvents = state.events.filter((event) => (event.calendar_date || event.date) === dateKey);
  const filteredEvents = filterEventsForList(allDateEvents);
  const grouped = groupEventsByObject(filteredEvents);

  list.classList.remove('muted');
  if (!grouped.length) {
    list.innerHTML = `<p class="muted">추천 대상 없음<br />${noRecommendationReason(dateKey, allDateEvents)}</p>`;
    return;
  }

  list.innerHTML = grouped.map((event) => renderExpandableEventCard(event, event.group_key === state.expandedEventKey)).join('');
  list.querySelectorAll('.expand-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.eventKey;
      state.expandedEventKey = state.expandedEventKey === key ? null : key;
      renderDetail(state.selectedDate);
    });
  });
}

function renderExpandableEventCard(event, isExpanded) {
  const grade = event.grade || 'fair';
  const bestTime = event.best_time || eventDisplayTime(event);
  const detail = isExpanded ? renderInlineEventDetail(event) : '';
  return `
    <article class="event-card summary-card ${isExpanded ? 'active expanded' : ''}">
      <div class="summary-row">
        <span class="summary-object">${event.object_name_kr}</span>
        <span class="summary-time">최적시간 ${bestTime}</span>
        <span class="badge ${grade}">${gradeLabels[grade] || grade}</span>
        <button class="expand-toggle" type="button" data-event-key="${event.group_key}">${isExpanded ? '접기' : '확장'}</button>
      </div>
      ${detail}
    </article>
  `;
}

function renderInlineEventDetail(event) {
  const grade = event.grade || 'fair';
  const weather = event.weather?.available
    ? `${event.weather.sky || '-'} · 구름량 ${event.weather.cloud_cover ?? '-'}% · 강수확률 ${event.weather.precipitation_probability ?? '-'}%`
    : '날씨 데이터 없음';
  const timeRange = visibilityTimeRange(event);
  const category = categoryLabels[event.category] || event.category;
  const bestTime = event.best_time || eventDisplayTime(event);
  const warnings = warningsForEvent(event);

  return `
    <div class="inline-detail">
      <div class="event-meta">
        관측 가능 시간: ${timeRange}<br />
        최적 시간: ${bestTime}<br />
        ${category} · 방향 ${event.direction_kr || '-'} · 최적 고도 ${formatNumber(event.altitude_deg)}° · 방위각 ${formatNumber(event.azimuth_deg)}° · 점수 ${event.score}<br />
        달 조명률 ${formatNumber(event.moon_illumination_pct)}% · 태양고도 ${formatNumber(event.sun_altitude_deg)}°<br />
        날씨: ${weather}
      </div>
      <p class="event-summary">${event.summary || event.viewing_hint || '관측 메모가 없습니다.'}</p>
      <div class="warning-box">
        <strong>관측 주의사항</strong>
        <ul>${warnings.map((warning) => `<li>${warning}</li>`).join('')}</ul>
      </div>
    </div>
  `;
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return Number(value).toFixed(1);
}

init();
