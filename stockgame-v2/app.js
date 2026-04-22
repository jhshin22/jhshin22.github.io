const chartEl = document.getElementById('chart');
const progressText = document.getElementById('progressText');
const marketText = document.getElementById('marketText');
const questionTypeText = document.getElementById('questionTypeText');
const questionTitle = document.getElementById('questionTitle');
const questionGuide = document.getElementById('questionGuide');
const feedbackText = document.getElementById('feedbackText');
const tradeSummary = document.getElementById('tradeSummary');
const finalSummary = document.getElementById('finalSummary');
const resultList = document.getElementById('resultList');
const resultPanel = document.getElementById('resultPanel');
const questionPanel = document.getElementById('questionPanel');
const submitBtn = document.getElementById('submitBtn');
const nextBtn = document.getElementById('nextBtn');
const resetBtn = document.getElementById('resetBtn');
const chartNote = document.getElementById('chartNote');
const openHintBox = document.getElementById('openHintBox');
const openHintValue = document.getElementById('openHintValue');
const userBalanceText = document.getElementById('userBalanceText');
const userReturnText = document.getElementById('userReturnText');
const monkeyBalanceText = document.getElementById('monkeyBalanceText');
const monkeyReturnText = document.getElementById('monkeyReturnText');
const monkeyDecisionBox = document.getElementById('monkeyDecisionBox');

const INITIAL_BALANCE = 1000000;
const GAME_ROUND_COUNT = 6;

let chart = null;
let rounds = [];
let currentIndex = 0;
let answered = false;
let selectedDecision = null;
let playerBalance = INITIAL_BALANCE;
let monkeyBalance = INITIAL_BALANCE;
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

function formatMoney(value) {
  return `₩${Math.round(value).toLocaleString('ko-KR')}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(value);
}

function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function directionText(v) {
  return v === 'up' ? '상승' : '하락';
}

function positionText(v) {
  return v === 'up' ? 'Long' : 'Short';
}

function typeLabel(type) {
  return type === 'open'
    ? '유형 1 · 시가 예측'
    : '유형 2 · 종가 예측';
}

function questionPrompt(type) {
  return type === 'open'
    ? '전날 종가 대비 다음 날 시가가 상승할지, 하락할지 맞혀보세요.'
    : '해당일 시가가 주어진 상태에서, 그 시가 대비 종가가 상승할지 하락할지 맞혀보세요.';
}

function buildRounds(problems) {
  const shuffled = shuffle(problems);
  return shuffled.slice(0, Math.min(GAME_ROUND_COUNT, shuffled.length)).map((problem, idx) => ({
    id: `${problem.id}-${idx}`,
    type: Math.random() < 0.5 ? 'open' : 'close',
    problem,
  }));
}

function resetChoiceButtons() {
  document.querySelectorAll('.choice-btn').forEach(btn => btn.classList.remove('active'));
  selectedDecision = null;
}

function bindChoiceButtons() {
  document.querySelectorAll('.choice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (answered) return;
      document.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedDecision = btn.dataset.value;
    });
  });
}

function getChartData(round, reveal = false) {
  const { problem, type } = round;
  const visible = Array.isArray(problem.visibleCandles) ? problem.visibleCandles : [];
  const target = problem.targetCandle;

  let candles;
  if (!reveal) {
    if (type === 'open') {
      candles = [...visible, { date: '?', open: null, close: null, low: null, high: null, volume: null }];
    } else {
      candles = [
        ...visible,
        {
          date: target.date,
          open: target.open,
          close: target.open,
          low: target.open,
          high: target.open,
          volume: target.volume,
        }
      ];
    }
  } else {
    candles = [...visible, target];
  }

  return {
    categoryData: candles.map(d => d.date),
    candleValues: candles.map(d => (
      d.open == null ? '-' : [Number(d.open), Number(d.close), Number(d.low), Number(d.high)]
    )),
    volumeValues: candles.map(d => (d.volume == null ? '-' : Number(d.volume))),
    volumeDirections: candles.map(d => (d.close == null || d.open == null ? 0 : (Number(d.close) >= Number(d.open) ? 1 : -1))),
    targetDate: target?.date ?? null,
    targetHigh: target?.high ?? null,
    targetLow: target?.low ?? null,
  };
}

function buildGraphicOverlay(round, reveal = false, outcome = null) {
  if (!reveal) {
    if (round.type === 'open') {
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
          right: '4.7%',
          top: '42%',
          z: 121,
          style: {
            text: '다음 날 시가 예측',
            fill: 'rgba(36, 91, 219, 0.72)',
            fontSize: 11,
            fontWeight: 700,
            textAlign: 'center'
          }
        }
      ];
    }

    return [
      {
        type: 'group',
        right: 20,
        top: 18,
        z: 120,
        children: [
          {
            type: 'rect',
            shape: { x: 0, y: 0, width: 178, height: 70, r: 14 },
            style: {
              fill: 'rgba(255,255,255,0.95)',
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
              y: 24,
              text: '해당일 시가 공개',
              fill: '#245bdb',
              fontSize: 13,
              fontWeight: 800
            }
          },
          {
            type: 'text',
            style: {
              x: 14,
              y: 48,
              text: '이 시가 대비 종가 방향을 예측',
              fill: '#66758a',
              fontSize: 12,
              fontWeight: 700
            }
          }
        ]
      }
    ];
  }

  if (!outcome) return [];

  return [
    {
      type: 'group',
      right: 22,
      top: 18,
      z: 120,
      children: [
        {
          type: 'rect',
          shape: { x: 0, y: 0, width: 220, height: 88, r: 14 },
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
            y: 24,
            text: `실제 방향: ${directionText(outcome.actualDirection)}`,
            fill: outcome.actualDirection === 'up' ? '#11a36a' : '#d9485f',
            fontSize: 14,
            fontWeight: 800
          }
        },
        {
          type: 'text',
          style: {
            x: 14,
            y: 48,
            text: `플레이어: ${positionText(outcome.playerDecision)} · ${outcome.playerCorrect ? '적중' : '실패'}`,
            fill: outcome.playerCorrect ? '#11a36a' : '#d9485f',
            fontSize: 13,
            fontWeight: 700
          }
        },
        {
          type: 'text',
          style: {
            x: 14,
            y: 70,
            text: `원숭이: ${positionText(outcome.monkeyDecision)} · ${outcome.monkeyCorrect ? '적중' : '실패'}`,
            fill: outcome.monkeyCorrect ? '#11a36a' : '#d9485f',
            fontSize: 13,
            fontWeight: 700
          }
        }
      ]
    }
  ];
}

function buildChartOption(round, reveal = false, outcome = null) {
  const { categoryData, candleValues, volumeValues, volumeDirections, targetDate, targetHigh, targetLow } = getChartData(round, reveal);

  const predictionBandData = !reveal
    ? [[{ xAxis: categoryData[categoryData.length - 1] }, { xAxis: categoryData[categoryData.length - 1] }]]
    : [];

  const revealBandData = reveal && targetDate
    ? [[{ xAxis: targetDate }, { xAxis: targetDate }]]
    : [];

  const targetMid = targetHigh != null && targetLow != null ? (Number(targetHigh) + Number(targetLow)) / 2 : null;

  return {
    animation: false,
    backgroundColor: '#ffffff',
    tooltip: reveal ? { trigger: 'axis', axisPointer: { type: 'cross' } } : { show: false },
    axisPointer: { link: [{ xAxisIndex: [0, 1] }] },
    graphic: buildGraphicOverlay(round, reveal, outcome),
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
        axisLabel: { color: '#66758a', formatter: value => (reveal ? value : '') },
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
        axisLabel: { color: '#66758a', formatter: value => (reveal ? formatNumber(value) : '') },
        splitLine: { lineStyle: { color: '#edf2f8' } }
      },
      {
        gridIndex: 1,
        scale: true,
        axisLine: { show: false },
        axisLabel: { color: '#66758a', formatter: value => (reveal ? formatNumber(value) : '') },
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
          ? { itemStyle: { color: 'rgba(36, 91, 219, 0.10)' }, data: predictionBandData }
          : revealBandData.length
            ? { itemStyle: { color: 'rgba(245, 190, 59, 0.22)' }, data: revealBandData }
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
          ? { itemStyle: { color: 'rgba(36, 91, 219, 0.08)' }, data: predictionBandData }
          : revealBandData.length
            ? { itemStyle: { color: 'rgba(245, 190, 59, 0.16)' }, data: revealBandData }
            : undefined
      }
    ]
  };
}

function updateBalanceTexts() {
  const userReturn = playerBalance / INITIAL_BALANCE - 1;
  const monkeyReturn = monkeyBalance / INITIAL_BALANCE - 1;
  userBalanceText.textContent = formatMoney(playerBalance);
  userReturnText.textContent = `수익률 ${formatPercent(userReturn)}`;
  monkeyBalanceText.textContent = formatMoney(monkeyBalance);
  monkeyReturnText.textContent = `수익률 ${formatPercent(monkeyReturn)}`;
}

function getRoundReferencePrices(round) {
  const { problem, type } = round;
  const prevClose = Number(problem.visibleCandles[problem.visibleCandles.length - 1].close);
  const targetOpen = Number(problem.targetCandle.open);
  const targetClose = Number(problem.targetCandle.close);

  if (type === 'open') {
    return {
      entryPrice: prevClose,
      exitPrice: targetOpen,
      actualDirection: problem.targetCandle.openDirection,
      label: '전날 종가 → 다음 날 시가'
    };
  }

  return {
    entryPrice: targetOpen,
    exitPrice: targetClose,
    actualDirection: problem.targetCandle.close >= problem.targetCandle.open ? 'up' : 'down',
    label: '해당일 시가 → 해당일 종가'
  };
}

function simulateTrade(balance, decision, entryPrice, exitPrice) {
  const rawReturn = exitPrice / entryPrice - 1;
  const signedReturn = decision === 'up' ? rawReturn : -rawReturn;
  const pnl = balance * signedReturn;
  return {
    signedReturn,
    pnl,
    nextBalance: balance + pnl,
  };
}

function renderProblem() {
  const round = rounds[currentIndex];
  const { problem, type } = round;

  answered = false;
  resetChoiceButtons();
  feedbackText.textContent = '';
  tradeSummary.innerHTML = '';
  resultPanel.hidden = true;
  questionPanel.hidden = false;
  submitBtn.hidden = false;
  nextBtn.hidden = true;

  progressText.textContent = `${currentIndex + 1} / ${rounds.length}`;
  marketText.textContent = problem.market;
  questionTypeText.textContent = typeLabel(type);
  questionTitle.textContent = type === 'open' ? '유형 1 · 다음 날 시가 예측' : '유형 2 · 해당일 종가 예측';
  questionGuide.textContent = questionPrompt(type);

  if (type === 'close') {
    openHintBox.hidden = false;
    openHintValue.textContent = `${formatNumber(problem.targetCandle.open)}`;
  } else {
    openHintBox.hidden = true;
  }

  monkeyDecisionBox.textContent = '원숭이도 아직 고민 중입니다... 제출하면 무작위 포지션이 공개됩니다.';

  const chartInstance = ensureChart();
  chartInstance.clear();
  chartInstance.setOption(buildChartOption(round, false, null), true);
  chartInstance.resize();

  chartNote.textContent = type === 'open'
    ? '과거 캔들과 거래량만 보고, 다음 거래일 시가가 전날 종가보다 위에서 시작할지 아래에서 시작할지 판단해 보세요.'
    : '과거 캔들과 거래량, 그리고 해당일 시가가 주어집니다. 이 시가를 기준으로 종가가 위에서 끝날지 아래에서 끝날지 판단해 보세요.';
}

function renderResults() {
  questionPanel.hidden = true;
  resultPanel.hidden = false;

  const playerReturn = playerBalance / INITIAL_BALANCE - 1;
  const monkeyReturn = monkeyBalance / INITIAL_BALANCE - 1;
  const winnerText = playerBalance === monkeyBalance
    ? '플레이어와 원숭이가 비겼습니다.'
    : playerBalance > monkeyBalance
      ? '플레이어가 원숭이를 이겼습니다.'
      : '원숭이가 플레이어를 이겼습니다.';

  finalSummary.textContent = `${winnerText} 플레이어 ${formatMoney(playerBalance)} (${formatPercent(playerReturn)}), 원숭이 ${formatMoney(monkeyBalance)} (${formatPercent(monkeyReturn)})`;

  resultList.innerHTML = results.map((item, idx) => `
    <article class="result-card">
      <h3>${idx + 1}번 문제 - <strong>${item.company}</strong> (${item.symbol}) <span class="badge ${item.playerCorrect ? 'correct' : 'wrong'}">플레이어 ${item.playerCorrect ? '적중' : '실패'}</span></h3>
      <div class="result-grid">
        <div><strong>유형</strong>: ${typeLabel(item.type)}</div>
        <div><strong>시장 / 날짜</strong>: ${item.market} / ${item.targetDate}</div>
        <div><strong>실제 방향</strong>: <span class="${item.actualDirection === 'up' ? 'correct' : 'wrong'}">${directionText(item.actualDirection)}</span></div>
        <div><strong>플레이어</strong>: ${positionText(item.playerDecision)} / ${formatPercent(item.playerReturn)} / ${formatMoney(item.playerBalanceAfter)}</div>
        <div><strong>원숭이</strong>: ${positionText(item.monkeyDecision)} / ${formatPercent(item.monkeyReturn)} / ${formatMoney(item.monkeyBalanceAfter)}</div>
        <div><strong>가격 구간</strong>: ${formatNumber(item.entryPrice)} → ${formatNumber(item.exitPrice)}</div>
      </div>
    </article>
  `).join('');
}

function submitAnswer() {
  if (!selectedDecision) {
    feedbackText.textContent = '상승(Long) 또는 하락(Short) 중 하나를 선택해 주세요.';
    return;
  }

  const round = rounds[currentIndex];
  const { problem, type } = round;
  const monkeyDecision = Math.random() < 0.5 ? 'up' : 'down';
  const { entryPrice, exitPrice, actualDirection, label } = getRoundReferencePrices(round);

  const playerTrade = simulateTrade(playerBalance, selectedDecision, entryPrice, exitPrice);
  const monkeyTrade = simulateTrade(monkeyBalance, monkeyDecision, entryPrice, exitPrice);
  const playerCorrect = selectedDecision === actualDirection;
  const monkeyCorrect = monkeyDecision === actualDirection;

  playerBalance = playerTrade.nextBalance;
  monkeyBalance = monkeyTrade.nextBalance;
  updateBalanceTexts();
  answered = true;

  const outcome = {
    actualDirection,
    playerDecision: selectedDecision,
    monkeyDecision,
    playerCorrect,
    monkeyCorrect,
  };

  const chartInstance = ensureChart();
  chartInstance.clear();
  chartInstance.setOption(buildChartOption(round, true, outcome), true);
  chartInstance.resize();

  feedbackText.textContent = `${type === 'open' ? '시가' : '종가'} 실제 방향은 ${directionText(actualDirection)}입니다. 플레이어 ${playerCorrect ? '적중' : '실패'}, 원숭이 ${monkeyCorrect ? '적중' : '실패'}.`;

  tradeSummary.innerHTML = `
    <strong>수익 계산 기준</strong>: ${label}<br>
    플레이어는 <strong>${positionText(selectedDecision)}</strong> 포지션으로 ${formatPercent(playerTrade.signedReturn)} 수익률, 손익 ${formatMoney(playerTrade.pnl)}, 잔고 ${formatMoney(playerBalance)}<br>
    원숭이는 <strong>${positionText(monkeyDecision)}</strong> 포지션으로 ${formatPercent(monkeyTrade.signedReturn)} 수익률, 손익 ${formatMoney(monkeyTrade.pnl)}, 잔고 ${formatMoney(monkeyBalance)}
  `;

  monkeyDecisionBox.textContent = `🐵 원숭이는 이번 문제에서 ${positionText(monkeyDecision)} (${directionText(monkeyDecision)} 예상)을 골랐습니다.`;

  chartNote.textContent = `정답 공개 완료 · ${problem.company} (${problem.symbol}) · ${problem.targetCandle.date} · 실제 가격 구간 ${formatNumber(entryPrice)} → ${formatNumber(exitPrice)}`;

  results.push({
    type,
    company: problem.company,
    symbol: problem.symbol,
    market: problem.market,
    targetDate: problem.targetCandle.date,
    actualDirection,
    playerDecision: selectedDecision,
    monkeyDecision,
    playerCorrect,
    monkeyCorrect,
    entryPrice,
    exitPrice,
    playerReturn: playerTrade.signedReturn,
    monkeyReturn: monkeyTrade.signedReturn,
    playerBalanceAfter: playerBalance,
    monkeyBalanceAfter: monkeyBalance,
  });

  submitBtn.hidden = true;
  nextBtn.hidden = false;
}

function goNext() {
  currentIndex += 1;
  if (currentIndex >= rounds.length) {
    renderResults();
    return;
  }
  renderProblem();
}

async function loadRounds() {
  chartNote.textContent = '문제 데이터를 불러오는 중...';
  const res = await fetch('../stockgame/data/problems.json', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`문제 데이터를 불러오지 못했습니다. (HTTP ${res.status})`);
  }

  const data = await res.json();
  const candidates = Array.isArray(data.problems) ? data.problems : [];
  const valid = candidates.filter(p => Array.isArray(p.visibleCandles) && p.visibleCandles.length > 5 && p.targetCandle);
  if (!valid.length) {
    throw new Error('사용 가능한 문제가 없습니다. 기존 stockgame/data/problems.json을 확인해 주세요.');
  }

  const built = buildRounds(valid);
  chartNote.textContent = `기존 stockgame 데이터 ${valid.length}문제를 활용해, 개선판 ${built.length}문제를 구성했습니다.`;
  return built;
}

function showEmptyState(message) {
  disposeChart();
  chartEl.innerHTML = `<div class="empty-state">${message}</div>`;
  chartNote.textContent = message;
  questionPanel.hidden = true;
  resultPanel.hidden = false;
  finalSummary.textContent = '게임을 시작할 수 없습니다.';
  resultList.innerHTML = '<div class="result-card">stockgame-v2는 기존 stockgame/data/problems.json을 참조합니다. 원본 데이터 파일 또는 경로를 확인해 주세요.</div>';
}

resetBtn.addEventListener('click', async () => {
  rounds = await loadRounds().catch(err => {
    showEmptyState(err.message);
    return null;
  });
  if (!rounds) return;

  currentIndex = 0;
  results = [];
  playerBalance = INITIAL_BALANCE;
  monkeyBalance = INITIAL_BALANCE;
  updateBalanceTexts();
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
updateBalanceTexts();
resetBtn.click();
