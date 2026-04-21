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
const chartNote = document.getElementById('chartNote');

const GAME_PROBLEM_COUNT = 3;

let chart = null;
let problems = [];
let currentIndex = 0;
let score = 0;
let selections = { open: null, close: null };
let answered = false;
let results = [];

function ensureChart() {
  if (!window.echarts) {
    throw new Error('ECharts 라이브러리를 불러오지 못했습니다.');
  }
  if (chart) return chart;
  chartEl.innerHTML = '';
  chart = window.echarts.init(chartEl, null, { renderer: 'canvas' });
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

function resultText(isCorrect) {
  return isCorrect ? '맞춤' : '틀림';
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

function getChartData(problem, reveal = false) {
  const visible = Array.isArray(problem.visibleCandles) ? problem.visibleCandles : [];
  const target = problem.targetCandle;
  const hiddenSlot = { date: '?', open: null, close: null, low: null, high: null, volume: null };
  const candles = reveal ? [...visible, target] : [...visible, hiddenSlot];

  return {
    categoryData: candles.map(d => d.date),
    candleValues: candles.map(d => (
      d.open == null ? '-' : [Number(d.open), Number(d.close), Number(d.low), Number(d.high)]
    )),
    volumeValues: candles.map(d => (d.volume == null ? '-' : Number(d.volume))),
    volumeDirections: candles.map(d => (d.close == null || d.open == null ? 0 : (Number(d.close) >= Number(d.open) ? 1 : -1))),
    hiddenSlotDate: hiddenSlot.date,
    targetDate: target?.date ?? null,
    targetHigh: target?.high ?? null,
    targetLow: target?.low ?? null,
  };
}

function buildGraphicOverlay(reveal = false, answerMeta = null) {
  if (!reveal) {
    return [
      {
        type: 'text',
        right: '6.5%',
        top: '33%',
        z: 121,
        style: {
          text: '?',
          fill: 'rgba(36, 91, 219, 0.55)',
          fontSize: 28,
          fontWeight: 800,
          textAlign: 'center'
        }
      },
      {
        type: 'text',
        right: '4.8%',
        top: '42%',
        z: 121,
        style: {
          text: '예측 구간',
          fill: 'rgba(36, 91, 219, 0.72)',
          fontSize: 11,
          fontWeight: 700,
          textAlign: 'center'
        }
      }
    ];
  }

  if (!answerMeta) return [];

  return [
    {
      type: 'group',
      right: 22,
      top: 18,
      z: 120,
      children: [
        {
          type: 'rect',
          shape: { x: 0, y: 0, width: 176, height: 68, r: 14 },
          style: {
            fill: 'rgba(255,255,255,0.94)',
            stroke: '#d9e2ef',
            lineWidth: 1,
            shadowBlur: 12,
            shadowColor: 'rgba(31, 43, 58, 0.10)'
          }
        },
        {
          type: 'text',
          style: {
            x: 14,
            y: 22,
            text: `시가 ${directionText(answerMeta.actualOpen)} · ${resultText(answerMeta.openCorrect)}`,
            fill: answerMeta.openCorrect ? '#11a36a' : '#d9485f',
            fontSize: 13,
            fontWeight: 700
          }
        },
        {
          type: 'text',
          style: {
            x: 14,
            y: 46,
            text: `종가 ${directionText(answerMeta.actualClose)} · ${resultText(answerMeta.closeCorrect)}`,
            fill: answerMeta.closeCorrect ? '#11a36a' : '#d9485f',
            fontSize: 13,
            fontWeight: 700
          }
        }
      ]
    }
  ];
}

function buildChartOption(problem, reveal = false, answerMeta = null) {
  const { categoryData, candleValues, volumeValues, volumeDirections, hiddenSlotDate, targetDate, targetHigh, targetLow } = getChartData(problem, reveal);

  const predictionBandData = !reveal
    ? [[{ xAxis: hiddenSlotDate }, { xAxis: hiddenSlotDate }]]
    : [];

  const revealBandData = reveal && targetDate
    ? [[{ xAxis: targetDate }, { xAxis: targetDate }]]
    : [];

  const targetMid = targetHigh != null && targetLow != null ? (Number(targetHigh) + Number(targetLow)) / 2 : null;

  return {
    animation: false,
    backgroundColor: '#ffffff',
    tooltip: reveal
      ? {
          trigger: 'axis',
          axisPointer: { type: 'cross' }
        }
      : { show: false },
    axisPointer: { link: [{ xAxisIndex: [0, 1] }] },
    graphic: buildGraphicOverlay(reveal, answerMeta),
    grid: [
      { left: '8%', right: '4%', top: 24, height: '58%' },
      { left: '8%', right: '4%', top: '74%', height: '14%' }
    ],
    xAxis: [
      {
        type: 'category',
        data: categoryData,
        scale: true,
        boundaryGap: true,
        axisLine: { lineStyle: { color: '#9fb0c7' } },
        axisLabel: {
          color: '#66758a',
          formatter: value => (reveal ? value : '')
        },
        axisTick: { show: reveal },
        splitLine: { show: false }
      },
      {
        type: 'category',
        gridIndex: 1,
        data: categoryData,
        scale: true,
        boundaryGap: true,
        axisLine: { lineStyle: { color: '#9fb0c7' } },
        axisLabel: { show: false },
        axisTick: { show: false },
        splitLine: { show: false }
      }
    ],
    yAxis: [
      {
        scale: true,
        axisLine: { show: false },
        axisLabel: {
          color: '#66758a',
          formatter: value => (reveal ? formatNumber(value) : '')
        },
        splitLine: { lineStyle: { color: '#edf2f8' } }
      },
      {
        gridIndex: 1,
        scale: true,
        axisLine: { show: false },
        axisLabel: {
          color: '#66758a',
          formatter: value => (reveal ? formatNumber(value) : '')
        },
        splitLine: { show: false }
      }
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start: 0, end: 100, disabled: !reveal }
    ],
    series: [
      {
        name: '일봉',
        type: 'candlestick',
        data: candleValues,
        itemStyle: {
          color: '#d9485f',
          color0: '#11a36a',
          borderColor: '#d9485f',
          borderColor0: '#11a36a'
        },
        markArea: predictionBandData.length
          ? {
              itemStyle: { color: 'rgba(36, 91, 219, 0.10)' },
              data: predictionBandData
            }
          : revealBandData.length
            ? {
                itemStyle: { color: 'rgba(245, 190, 59, 0.22)' },
                data: revealBandData
              }
            : undefined,
        markPoint: reveal && targetDate && targetHigh != null
          ? {
              symbol: 'pin',
              symbolSize: 34,
              itemStyle: { color: '#f5be3b' },
              label: { show: false },
              data: [{ coord: [targetDate, Number(targetHigh)], value: '정답' }]
            }
          : undefined,
        markLine: reveal && targetDate && targetMid != null
          ? {
              symbol: ['none', 'none'],
              label: { show: false },
              lineStyle: { color: '#f5be3b', type: 'dashed', width: 1.5 },
              data: [{ xAxis: targetDate }]
            }
          : undefined
      },
      {
        name: '거래량',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volumeValues,
        itemStyle: {
          color: params => {
            const dir = volumeDirections[params.dataIndex];
            if (dir === 1) return '#d9485f';
            if (dir === -1) return '#11a36a';
            return 'rgba(36, 91, 219, 0.12)';
          }
        },
        markArea: predictionBandData.length
          ? {
              itemStyle: { color: 'rgba(36, 91, 219, 0.08)' },
              data: predictionBandData
            }
          : revealBandData.length
            ? {
                itemStyle: { color: 'rgba(245, 190, 59, 0.16)' },
                data: revealBandData
              }
            : undefined
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
  marketText.textContent = '비공개';
  submitBtn.hidden = false;
  nextBtn.hidden = true;
  resultPanel.hidden = true;
  questionPanel.hidden = false;

  const chartInstance = ensureChart();
  chartInstance.clear();
  chartInstance.setOption(buildChartOption(problem, false, null), true);
  chartInstance.resize();

  chartNote.textContent = `날짜·가격·종목 비공개 상태 · 마지막 세로 띠로 표시된 예측 구간의 다음 거래일 캔들을 예측해 보세요.`;
}

function renderResults() {
  questionPanel.hidden = true;
  resultPanel.hidden = false;
  finalScore.textContent = `총 ${problems.length * 2}점 만점 중 ${score}점`;
  resultList.innerHTML = results.map((item, idx) => {
    return `
      <article class="result-card">
        <h3>${idx + 1}번 문제 - <strong>${item.company}</strong> (${item.symbol}) <span class="badge ${item.totalCorrect === 2 ? 'correct' : 'wrong'}">${item.totalCorrect}/2 정답</span></h3>
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
  const answerMeta = { actualOpen, actualClose, openCorrect, closeCorrect };

  score += gained;
  answered = true;
  scoreText.textContent = `${score}점`;
  marketText.textContent = problem.market;

  chartEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const chartInstance = ensureChart();
  chartInstance.clear();
  chartInstance.setOption(buildChartOption(problem, true, answerMeta), true);
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
  chartNote.innerHTML = `정답 공개 완료 · 이번 차트는 <strong>${problem.company}</strong> (${problem.symbol}) · ${problem.targetCandle.date} · 차트 오른쪽 상단에서 시가/종가 정답 여부를 확인해 보세요.`;
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
  chartNote.textContent = '문제 데이터를 불러오는 중...';
  const res = await fetch('./data/problems.json', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`문제 데이터를 불러오지 못했습니다. (HTTP ${res.status})`);
  }
  const data = await res.json();
  const candidates = Array.isArray(data.problems) ? data.problems : [];
  const valid = candidates.filter(p => Array.isArray(p.visibleCandles) && p.visibleCandles.length > 5 && p.targetCandle);
  if (!valid.length) {
    throw new Error('사용 가능한 문제가 없습니다. build_dataset.py 또는 GitHub Actions로 데이터를 생성해 주세요.');
  }
  const shuffled = shuffle(valid);
  chartNote.textContent = `문제 데이터 로드 성공 · 전체 ${valid.length}문제 중 이번 판은 ${Math.min(GAME_PROBLEM_COUNT, shuffled.length)}문제 랜덤 출제`;
  return shuffled.slice(0, GAME_PROBLEM_COUNT);
}

function showEmptyState(message) {
  disposeChart();
  chartEl.innerHTML = `<div class="empty-state">${message}</div>`;
  chartNote.textContent = message;
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
