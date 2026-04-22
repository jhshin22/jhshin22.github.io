const introScreen = document.getElementById('introScreen');
const gameScreen = document.getElementById('gameScreen');
const startBtn = document.getElementById('startBtn');
const statusBar = document.getElementById('statusBar');
const chartPanel = document.getElementById('chartPanel');
const questionPanel = document.getElementById('questionPanel');
const monkeyPanel = document.getElementById('monkeyPanel');
const chartEl = document.getElementById('chart');
const remainingText = document.getElementById('remainingText');
const marketText = document.getElementById('marketText');
const questionTypeText = document.getElementById('questionTypeText');
const questionTitle = document.getElementById('questionTitle');
const questionGuide = document.getElementById('questionGuide');
const feedbackText = document.getElementById('feedbackText');
const tradeSummary = document.getElementById('tradeSummary');
const finalSummary = document.getElementById('finalSummary');
const resultList = document.getElementById('resultList');
const resultPanel = document.getElementById('resultPanel');
const resetBtn = document.getElementById('resetBtn');
const chartNote = document.getElementById('chartNote');
const openHintBox = document.getElementById('openHintBox');
const userBalanceText = document.getElementById('userBalanceText');
const userReturnText = document.getElementById('userReturnText');
const monkeyBalanceText = document.getElementById('monkeyBalanceText');
const monkeyReturnText = document.getElementById('monkeyReturnText');
const monkeyDecisionBox = document.getElementById('monkeyDecisionBox');
const monkeyCharacter = document.getElementById('monkeyCharacter');
const monkeyMoodText = document.getElementById('monkeyMoodText');
const monkeyBadge = document.getElementById('monkeyBadge');
const decisionBar = document.getElementById('decisionBar');
const buyBtn = document.getElementById('buyBtn');
const sellBtn = document.getElementById('sellBtn');
const nextBtn = document.getElementById('nextBtn');

const INITIAL_BALANCE = 1000000;
const GAME_ROUND_COUNT = 6;

let chart = null;
let rounds = [];
let currentIndex = 0;
let answered = false;
let playerBalance = INITIAL_BALANCE;
let monkeyBalance = INITIAL_BALANCE;
let results = [];

function ensureChart() {
  if (!window.echarts) throw new Error('ECharts 라이브러리를 불러오지 못했습니다.');
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

function formatPercentFromBase(value, base) {
  const pct = ((Number(value) / Number(base)) - 1) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function directionText(v) {
  return v === 'up' ? '상승' : '하락';
}

function positionText(v) {
  return v === 'up' ? '매수' : '매도';
}

function typeLabel(type) {
  return type === 'open' ? '유형 1 · 시가 예측' : '유형 2 · 종가 예측';
}

function questionPrompt(type) {
  return type === 'open'
    ? '전날까지의 차트만 보고 다음 거래일 시가가 전날 종가보다 위에서 시작할지 아래에서 시작할지 고르세요.'
    : '별표로 표시된 당일 시가를 기준으로 종가가 위에서 끝날지 아래에서 끝날지 고르세요.';
}

function clearAnswerFeedback() {
  document.body.classList.remove('answer-correct', 'answer-wrong');
}

function applyAnswerFeedback(isCorrect) {
  clearAnswerFeedback();
  document.body.classList.add(isCorrect ? 'answer-correct' : 'answer-wrong');
}

function resetMonkeyState() {
  monkeyCharacter.classList.remove('correct', 'wrong', 'buy', 'sell');
  monkeyCharacter.classList.add('thinking');
  monkeyMoodText.textContent = '차트보고 생각중';
  monkeyDecisionBox.textContent = '아직 안 골랐어';
  monkeyBadge.textContent = '대기';
}

function setMonkeyResult(decision, isCorrect) {
  monkeyCharacter.classList.remove('thinking', 'correct', 'wrong', 'buy', 'sell');
  monkeyCharacter.classList.add(isCorrect ? 'correct' : 'wrong', decision === 'up' ? 'buy' : 'sell');
  monkeyMoodText.textContent = `${positionText(decision)} 골랐어`;
  monkeyDecisionBox.textContent = isCorrect ? '예측 성공!' : '예측 실패...';
  monkeyBadge.textContent = isCorrect ? '성공' : '실패';
}

function setDecisionButtonsDisabled(disabled) {
  buyBtn.disabled = disabled;
  sellBtn.disabled = disabled;
}

function setDecisionMode(mode) {
  if (mode === 'question') {
    buyBtn.hidden = false;
    sellBtn.hidden = false;
    nextBtn.hidden = true;
    decisionBar.classList.remove('result-mode');
  } else {
    buyBtn.hidden = true;
    sellBtn.hidden = true;
    nextBtn.hidden = false;
    decisionBar.classList.add('result-mode');
  }
}

function setPlayViewVisible(visible) {
  statusBar.hidden = !visible;
  chartPanel.hidden = !visible;
  questionPanel.hidden = !visible;
  monkeyPanel.hidden = !visible;
  decisionBar.hidden = !visible;
}

function buildRounds(problems) {
  return shuffle(problems)
    .slice(0, Math.min(GAME_ROUND_COUNT, problems.length))
    .map((problem, idx) => ({
      id: `${problem.id}-${idx}`,
      type: Math.random() < 0.5 ? 'open' : 'close',
      problem,
    }));
}

function getChartData(round, reveal = false) {
  const { problem, type } = round;
  const visible = Array.isArray(problem.visibleCandles) ? problem.visibleCandles : [];
  const target = problem.targetCandle;
  const prevClose = Number(visible[visible.length - 1].close);

  if (type === 'close') {
    const candles = reveal
      ? [...visible, target]
      : [
          ...visible,
          {
            date: target.date,
            open: Number(target.open),
            close: Number(target.open),
            low: Number(target.open),
            high: Number(target.open),
            volume: target.volume,
          }
        ];

    return {
      isPercentMode: true,
      showVolume: false,
      percentBase: prevClose,
      categoryData: candles.map(d => d.date),
      candleValues: candles.map(d => [Number(d.open), Number(d.close), Number(d.low), Number(d.high)]),
      volumeValues: [],
      volumeDirections: [],
      targetDate: target.date,
      targetOpen: Number(target.open),
      targetHigh: Number(target.high),
      targetLow: Number(target.low),
      openPercent: ((Number(target.open) / prevClose) - 1) * 100,
    };
  }

  const candles = reveal
    ? [...visible, target]
    : [...visible, { date: '?', open: null, close: null, low: null, high: null, volume: null }];

  return {
    isPercentMode: false,
    showVolume: true,
    percentBase: null,
    categoryData: candles.map(d => d.date),
    candleValues: candles.map(d => (d.open == null ? '-' : [Number(d.open), Number(d.close), Number(d.low), Number(d.high)])),
    volumeValues: candles.map(d => (d.volume == null ? '-' : Number(d.volume))),
    volumeDirections: candles.map(d => (d.close == null || d.open == null ? 0 : (Number(d.close) >= Number(d.open) ? 1 : -1))),
    targetDate: target.date,
    targetOpen: Number(target.open),
    targetHigh: Number(target.high),
    targetLow: Number(target.low),
    openPercent: null,
  };
}

function buildGraphicOverlay(round, reveal = false, outcome = null) {
  if (reveal) {
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
            shape: { x: 0, y: 0, width: 160, height: 54, r: 14 },
            style: {
              fill: 'rgba(255,255,255,0.94)',
              stroke: outcome.playerCorrect ? '#9bd8b7' : '#f0b8c2',
              lineWidth: 1,
              shadowBlur: 12,
              shadowColor: 'rgba(31, 43, 58, 0.10)'
            }
          },
          {
            type: 'text',
            style: {
              x: 14,
              y: 21,
              text: outcome.playerCorrect ? '정답입니다' : '오답입니다',
              fill: outcome.playerCorrect ? '#0d8b59' : '#c7374f',
              fontSize: 15,
              fontWeight: 800
            }
          },
          {
            type: 'text',
            style: {
              x: 14,
              y: 42,
              text: `실제 방향: ${directionText(outcome.actualDirection)}`,
              fill: '#66758a',
              fontSize: 12,
              fontWeight: 700
            }
          }
        ]
      }
    ];
  }

  if (round.type !== 'open') return [];

  return [
    {
      type: 'group',
      right: 32,
      top: '32%',
      z: 130,
      children: [
        {
          type: 'circle',
          shape: { cx: 30, cy: 30, r: 26 },
          style: {
            fill: 'rgba(36, 91, 219, 0.10)',
            stroke: '#245bdb',
            lineWidth: 2
          }
        },
        {
          type: 'text',
          style: {
            x: 30,
            y: 40,
            text: '?',
            fill: '#245bdb',
            fontSize: 32,
            fontWeight: 900,
            align: 'center'
          }
        }
      ]
    }
  ];
}

function buildChartOption(round, reveal = false, outcome = null) {
  const chartData = getChartData(round, reveal);
  const { showVolume, percentBase, categoryData, candleValues, volumeValues, volumeDirections, targetDate, targetOpen, targetHigh, targetLow } = chartData;
  const predictionBandData = !reveal ? [[{ xAxis: categoryData[categoryData.length - 1] }, { xAxis: categoryData[categoryData.length - 1] }]] : [];
  const revealBandData = reveal && targetDate ? [[{ xAxis: targetDate }, { xAxis: targetDate }]] : [];
  const targetMid = targetHigh != null && targetLow != null ? (Number(targetHigh) + Number(targetLow)) / 2 : null;

  const grids = showVolume
    ? [
        { left: '8%', right: '4%', top: 24, height: '58%' },
        { left: '8%', right: '4%', top: '74%', height: '14%' }
      ]
    : [
        { left: '8%', right: '4%', top: 24, bottom: 38 }
      ];

  const xAxis = showVolume
    ? [
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
      ]
    : [
        {
          type: 'category',
          data: categoryData,
          scale: true,
          boundaryGap: true,
          axisLine: { lineStyle: { color: '#9fb0c7' } },
          axisLabel: { color: '#66758a', formatter: value => (reveal ? value : '') },
          axisTick: { show: reveal },
          splitLine: { show: false }
        }
      ];

  const percentFormatter = value => {
    if (!reveal || percentBase == null) return '';
    return formatPercentFromBase(value, percentBase);
  };

  const yAxis = showVolume
    ? [
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
      ]
    : [
        {
          scale: true,
          axisLine: { show: false },
          axisLabel: { color: '#66758a', formatter: percentFormatter },
          splitLine: { lineStyle: { color: '#edf2f8' } }
        }
      ];

  const markPoints = [];
  if (!reveal && round.type === 'close') {
    markPoints.push({
      coord: [targetDate, targetOpen],
      value: '시가'
    });
  }
  if (reveal && targetDate && targetHigh != null) {
    markPoints.push({
      coord: [targetDate, Number(targetHigh)],
      value: '정답'
    });
  }

  const series = [
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
      markPoint: markPoints.length
        ? {
            symbol: reveal ? 'pin' : 'star',
            symbolSize: reveal ? 34 : 28,
            itemStyle: { color: reveal ? '#f5be3b' : '#245bdb' },
            label: { show: false },
            data: markPoints
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
    }
  ];

  if (showVolume) {
    series.push({
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
    });
  }

  return {
    animation: false,
    backgroundColor: '#ffffff',
    tooltip: reveal ? { trigger: 'axis', axisPointer: { type: 'cross' } } : { show: false },
    axisPointer: { link: showVolume ? [{ xAxisIndex: [0, 1] }] : undefined },
    graphic: buildGraphicOverlay(round, reveal, outcome),
    grid: grids,
    xAxis,
    yAxis,
    dataZoom: [
      { type: 'inside', xAxisIndex: showVolume ? [0, 1] : [0], start: 0, end: 100, disabled: !reveal }
    ],
    series
  };
}

function updateBalanceTexts() {
  const userReturn = playerBalance / INITIAL_BALANCE - 1;
  const monkeyReturn = monkeyBalance / INITIAL_BALANCE - 1;
  userBalanceText.textContent = formatMoney(playerBalance);
  userReturnText.textContent = formatPercent(userReturn);
  monkeyBalanceText.textContent = formatMoney(monkeyBalance);
  monkeyReturnText.textContent = formatPercent(monkeyReturn);
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
    actualDirection: targetClose >= targetOpen ? 'up' : 'down',
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
  clearAnswerFeedback();
  resetMonkeyState();
  feedbackText.textContent = '';
  tradeSummary.innerHTML = '';
  resultPanel.hidden = true;
  openHintBox.hidden = true;
  setPlayViewVisible(true);
  setDecisionButtonsDisabled(false);
  setDecisionMode('question');

  remainingText.textContent = `${rounds.length - currentIndex}`;
  marketText.textContent = problem.market;
  questionTypeText.textContent = typeLabel(type);
  questionTitle.textContent = type === 'open' ? '다음 날 시가 방향을 고르세요' : '해당일 종가 방향을 고르세요';
  questionGuide.textContent = questionPrompt(type);

  const chartInstance = ensureChart();
  chartInstance.clear();
  chartInstance.setOption(buildChartOption(round, false, null), true);
  chartInstance.resize();

  chartNote.textContent = type === 'open'
    ? '오른쪽 물음표 구간은 아직 숨겨진 다음 거래일 시가입니다.'
    : '별표가 당일 시가 위치입니다. 이 시가를 기준으로 종가 방향을 판단해 보세요.';
}

function renderResults() {
  clearAnswerFeedback();
  setPlayViewVisible(false);
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
        <div><strong>기준 구간</strong>: ${item.referenceLabel}</div>
        <div><strong>가격 이동</strong>: ${formatNumber(item.entryPrice)} → ${formatNumber(item.exitPrice)}</div>
      </div>
    </article>
  `).join('');
}

function resolveDecision(playerDecision) {
  if (answered) return;

  const round = rounds[currentIndex];
  const { problem, type } = round;
  const monkeyDecision = Math.random() < 0.5 ? 'up' : 'down';
  const { entryPrice, exitPrice, actualDirection, label } = getRoundReferencePrices(round);
  const playerTrade = simulateTrade(playerBalance, playerDecision, entryPrice, exitPrice);
  const monkeyTrade = simulateTrade(monkeyBalance, monkeyDecision, entryPrice, exitPrice);
  const playerCorrect = playerDecision === actualDirection;
  const monkeyCorrect = monkeyDecision === actualDirection;

  playerBalance = playerTrade.nextBalance;
  monkeyBalance = monkeyTrade.nextBalance;
  updateBalanceTexts();
  answered = true;
  setDecisionButtonsDisabled(true);
  setDecisionMode('result');
  applyAnswerFeedback(playerCorrect);
  setMonkeyResult(monkeyDecision, monkeyCorrect);

  const outcome = { actualDirection, playerDecision, monkeyDecision, playerCorrect, monkeyCorrect };
  const chartInstance = ensureChart();
  chartInstance.clear();
  chartInstance.setOption(buildChartOption(round, true, outcome), true);
  chartInstance.resize();

  feedbackText.textContent = `${type === 'open' ? '시가' : '종가'} 실제 방향은 ${directionText(actualDirection)}입니다. ${positionText(playerDecision)} 선택은 ${playerCorrect ? '적중' : '실패'}입니다.`;
  tradeSummary.innerHTML = `
    <strong>수익 계산 기준</strong>: ${label}<br>
    플레이어는 <strong>${positionText(playerDecision)}</strong>로 ${formatPercent(playerTrade.signedReturn)} 수익률, 손익 ${formatMoney(playerTrade.pnl)}, 잔고 ${formatMoney(playerBalance)}<br>
    원숭이는 <strong>${positionText(monkeyDecision)}</strong>로 ${formatPercent(monkeyTrade.signedReturn)} 수익률, 손익 ${formatMoney(monkeyTrade.pnl)}, 잔고 ${formatMoney(monkeyBalance)}
  `;

  chartNote.textContent = `정답 공개 완료 · ${problem.company} (${problem.symbol}) · ${problem.targetCandle.date}`;

  results.push({
    type,
    company: problem.company,
    symbol: problem.symbol,
    market: problem.market,
    targetDate: problem.targetCandle.date,
    actualDirection,
    playerDecision,
    monkeyDecision,
    playerCorrect,
    monkeyCorrect,
    entryPrice,
    exitPrice,
    playerReturn: playerTrade.signedReturn,
    monkeyReturn: monkeyTrade.signedReturn,
    playerBalanceAfter: playerBalance,
    monkeyBalanceAfter: monkeyBalance,
    referenceLabel: label,
  });
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
  if (!res.ok) throw new Error(`문제 데이터를 불러오지 못했습니다. (HTTP ${res.status})`);

  const data = await res.json();
  const candidates = Array.isArray(data.problems) ? data.problems : [];
  const valid = candidates.filter(p => Array.isArray(p.visibleCandles) && p.visibleCandles.length > 5 && p.targetCandle);
  if (!valid.length) throw new Error('사용 가능한 문제가 없습니다. 기존 stockgame/data/problems.json을 확인해 주세요.');

  const built = buildRounds(valid);
  chartNote.textContent = `기존 stockgame 데이터 ${valid.length}문제를 활용해 개선판 ${built.length}문제를 구성했습니다.`;
  return built;
}

function showEmptyState(message) {
  clearAnswerFeedback();
  disposeChart();
  setPlayViewVisible(false);
  resultPanel.hidden = false;
  finalSummary.textContent = '게임을 시작할 수 없습니다.';
  resultList.innerHTML = `<div class="result-card">${message}</div>`;
}

async function startGame() {
  clearAnswerFeedback();
  resultPanel.hidden = true;
  rounds = await loadRounds().catch(err => {
    introScreen.hidden = true;
    gameScreen.hidden = false;
    showEmptyState(err.message);
    return null;
  });
  if (!rounds) return;

  currentIndex = 0;
  results = [];
  playerBalance = INITIAL_BALANCE;
  monkeyBalance = INITIAL_BALANCE;
  updateBalanceTexts();
  introScreen.hidden = true;
  gameScreen.hidden = false;
  renderProblem();
}

startBtn.addEventListener('click', startGame);
resetBtn.addEventListener('click', startGame);
buyBtn.addEventListener('click', () => resolveDecision('up'));
sellBtn.addEventListener('click', () => resolveDecision('down'));
nextBtn.addEventListener('click', goNext);
window.addEventListener('resize', () => { if (chart) chart.resize(); });
window.addEventListener('pageshow', () => { if (chart) chart.resize(); });
updateBalanceTexts();
