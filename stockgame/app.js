const chartEl = document.getElementById('chart');
const progressText = document.getElementById('progressText');
const scoreText = document.getElementById('scoreText');
const marketText = document.getElementById('marketText');
const feedbackText = document.getElementById('feedbackText');
const finalScore = document.getElementById('finalScore');
const resultList = document.getElementById('resultList');
const resultPanel = document.getElementById('resultPanel');
const questionPanel = document.getElementById('questionPanel');
const submitBtn = document.getElementById('submitBtn');
const nextBtn = document.getElementById('nextBtn');
const resetBtn = document.getElementById('resetBtn');

let chart = null;
let problems = [];
let currentIndex = 0;
let score = 0;
let selections = { open: null, close: null };
let answered = false;
let results = [];

function ensureChart() {
  if (chart) {
    return chart;
  }
  chartEl.innerHTML = '';
  chart = echarts.init(chartEl, null, { renderer: 'canvas' });
  return chart;
}

function disposeChart() {
  if (chart) {
    chart.dispose();
    chart = null;
  }
}

function shuffle(array) {
  const copied = [...array];
  for (let i = copied.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copied[i], copied[j]] = [copied[j], copied[i]];
  }
  return copied;
}

function formatNumber(value) {
  return new Intl.NumberFormat('ko-KR').format(value);
}

function directionText(v) {
  return v === 'up' ? '상승' : '하락';
}

function resetChoiceButtons() {
  document.querySelectorAll('.choice-btn').forEach(btn => btn.classList.remove('active'));
  selections = { open: null, close: null };
}

function bindChoiceButtons() {
  document.querySelectorAll('.choice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (answered) return;
      const group = btn.parentElement;
      const question = group.dataset.question;
      group.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selections[question] = btn.dataset.value;
    });
  });
}

function buildChartOption(problem, reveal = false) {
  const visible = problem.visibleCandles || [];
  const target = problem.targetCandle;
  const candles = reveal ? [...visible, target] : visible;
  const categoryData = candles.map(d => d.date);
  const values = candles.map(d => [d.open, d.close, d.low, d.high]);
  const volumes = candles.map((d, i) => ({
    value: [i, d.volume, d.close >= d.open ? 1 : -1]
  }));

  const markAreaData = !reveal && visible.length
    ? [[
        { xAxis: visible[visible.length - 1].date },
        { xAxis: visible[visible.length - 1].date }
      ]]
    : [];

  return {
    animation: false,
    legend: { data: ['일봉', '거래량'] },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' }
    },
    grid: [
      { left: '8%', right: '5%', top: 50, height: '55%' },
      { left: '8%', right: '5%', top: '72%', height: '16%' }
    ],
    xAxis: [
      {
        type: 'category',
        data: categoryData,
        boundaryGap: true,
        axisLine: { onZero: false },
        splitLine: { show: false },
        min: 'dataMin',
        max: 'dataMax'
      },
      {
        type: 'category',
        gridIndex: 1,
        data: categoryData,
        boundaryGap: true,
        axisLine: { onZero: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        min: 'dataMin',
        max: 'dataMax'
      }
    ],
    yAxis: [
      { scale: true, splitArea: { show: true } },
      { scale: true, gridIndex: 1, splitNumber: 2 }
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start: 0, end: 100 },
      { show: false, xAxisIndex: [0, 1], type: 'slider', start: 0, end: 100 }
    ],
    visualMap: {
      show: false,
      seriesIndex: 1,
      dimension: 2,
      pieces: [
        { value: 1, color: '#d9485f' },
        { value: -1, color: '#11a36a' }
      ]
    },
    series: [
      {
        name: '일봉',
        type: 'candlestick',
        data: values,
        itemStyle: {
          color: '#d9485f',
          color0: '#11a36a',
          borderColor: '#d9485f',
          borderColor0: '#11a36a'
        },
        markArea: markAreaData.length ? {
          itemStyle: { color: 'rgba(36, 91, 219, 0.08)' },
          data: markAreaData
        } : undefined
      },
      {
        name: '거래량',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volumes
      }
    ]
  };
}

function renderProblem() {
  const problem = problems[currentIndex];
  answered = false;
  resetChoiceButtons();
  feedbackText.textContent = '';
  progressText.textContent = `${currentIndex + 1} / ${problems.length}`;
  scoreText.textContent = `${score}점`;
  marketText.textContent = problem.market;
  submitBtn.hidden = false;
  nextBtn.hidden = true;
  resultPanel.hidden = true;
  questionPanel.hidden = false;
  const chartInstance = ensureChart();
  chartInstance.clear();
  chartInstance.setOption(buildChartOption(problem, false), true);
  chartInstance.resize();
}

function renderResults() {
  questionPanel.hidden = true;
  resultPanel.hidden = false;
  finalScore.textContent = `총 ${problems.length * 2}점 만점 중 ${score}점`;
  resultList.innerHTML = results.map((item, idx) => {
    return `
      <article class="result-card">
        <h3>${idx + 1}번 문제 - ${item.company} (${item.symbol}) <span class="badge ${item.totalCorrect === 2 ? 'correct' : 'wrong'}">${item.totalCorrect}/2 정답</span></h3>
        <div class="result-grid">
          <div><strong>시장</strong>: ${item.market}</div>
          <div><strong>정답 날짜</strong>: ${item.targetDate}</div>
          <div><strong>시가 방향</strong>: <span class="${item.openCorrect ? 'correct' : 'wrong'}">${directionText(item.actualOpenDirection)}</span> / 내 답: ${directionText(item.userOpen)}</div>
          <div><strong>종가 방향</strong>: <span class="${item.closeCorrect ? 'correct' : 'wrong'}">${directionText(item.actualCloseDirection)}</span> / 내 답: ${directionText(item.userClose)}</div>
          <div><strong>전날 종가</strong>: ${formatNumber(item.prevClose)}</div>
          <div><strong>다음날 시가 · 종가</strong>: ${formatNumber(item.targetOpen)} · ${formatNumber(item.targetClose)}</div>
        </div>
      </article>
    `;
  }).join('');
}

function submitAnswer() {
  if (!selections.open || !selections.close) {
    feedbackText.textContent = '시가와 종가 방향을 모두 선택해 주세요. (전날 종가대비)';
    return;
  }

  const problem = problems[currentIndex];
  const actualOpen = problem.targetCandle.openDirection;
  const actualClose = problem.targetCandle.closeDirection;
  const openCorrect = selections.open === actualOpen;
  const closeCorrect = selections.close === actualClose;
  const gained = Number(openCorrect) + Number(closeCorrect);

  score += gained;
  answered = true;
  scoreText.textContent = `${score}점`;
  const chartInstance = ensureChart();
  chartInstance.clear();
  chartInstance.setOption(buildChartOption(problem, true), true);
  chartInstance.resize();

  results.push({
    company: problem.company,
    symbol: problem.symbol,
    market: problem.market,
    targetDate: problem.targetCandle.date,
    prevClose: problem.visibleCandles[problem.visibleCandles.length - 1].close,
    targetOpen: problem.targetCandle.open,
    targetClose: problem.targetCandle.close,
    actualOpenDirection: actualOpen,
    actualCloseDirection: actualClose,
    userOpen: selections.open,
    userClose: selections.close,
    openCorrect,
    closeCorrect,
    totalCorrect: gained
  });

  feedbackText.textContent = `정답 공개 (전날 종가대비): 시가 ${directionText(actualOpen)}, 종가 ${directionText(actualClose)} — ${gained}점 획득`;
  submitBtn.hidden = true;
  nextBtn.hidden = false;
}

function goNext() {
  currentIndex += 1;
  if (currentIndex >= problems.length) {
    renderResults();
    return;
  }
  renderProblem();
}

async function loadProblems() {
  const res = await fetch('./data/problems.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('문제 데이터를 불러오지 못했습니다.');
  const data = await res.json();
  const candidates = Array.isArray(data.problems) ? data.problems : [];
  const valid = candidates.filter(p => Array.isArray(p.visibleCandles) && p.visibleCandles.length > 5 && p.targetCandle);
  if (!valid.length) throw new Error('사용 가능한 문제가 없습니다. build_dataset.py 또는 GitHub Actions로 데이터를 생성해 주세요.');
  return shuffle(valid);
}

function showEmptyState(message) {
  disposeChart();
  chartEl.innerHTML = `<div class="empty-state">${message}</div>`;
  questionPanel.hidden = true;
  resultPanel.hidden = false;
  finalScore.textContent = '게임을 시작할 수 없습니다.';
  resultList.innerHTML = '<div class="result-card">실제 과거 데이터를 담은 problems.json이 필요합니다. 저장소의 stockgame/build_dataset.py 또는 GitHub Actions workflow를 실행해 주세요.</div>';
}

resetBtn.addEventListener('click', async () => {
  problems = await loadProblems().catch(err => {
    showEmptyState(err.message);
    return null;
  });
  if (!problems) return;
  currentIndex = 0;
  score = 0;
  results = [];
  renderProblem();
});
submitBtn.addEventListener('click', submitAnswer);
nextBtn.addEventListener('click', goNext);
window.addEventListener('resize', () => {
  if (chart) chart.resize();
});
window.addEventListener('pageshow', () => {
  if (chart) chart.resize();
});

bindChoiceButtons();
resetBtn.click();
