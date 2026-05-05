const moodRules = {
  "피곤함": {
    categories: ["한식", "국물", "찌개", "밥"],
    tags: ["피곤함", "따뜻함", "무난함"],
    reason: "피곤한 날에 맞는 따뜻하고 무난한 메뉴"
  },
  "스트레스": {
    categories: ["매운맛", "고기", "튀김", "분식"],
    tags: ["스트레스", "자극적", "든든함"],
    spicyMin: 3,
    reason: "스트레스 해소에 맞는 자극적이거나 든든한 메뉴"
  },
  "기분좋음": {
    categories: ["외식", "양식", "고기", "일식"],
    tags: ["기분좋음", "특별함"],
    reason: "기분 좋은 날에 어울리는 외식감 있는 메뉴"
  },
  "우울함": {
    categories: ["국물", "한식", "찌개", "밥"],
    tags: ["우울함", "따뜻함", "익숙함"],
    reason: "우울한 날에 부담이 적고 익숙한 메뉴"
  },
  "아무생각없음": {
    categories: ["한식", "분식", "밥", "면"],
    tags: ["무난함", "익숙함"],
    reason: "고민이 적은 무난한 선택지"
  }
};

const weatherRules = {
  "추움": ["국물", "찌개", "전골", "따뜻함"],
  "비": ["국물", "전", "매운맛", "따뜻함"],
  "눈": ["국물", "전골", "한식", "따뜻함"],
  "더움": ["차가움", "가벼움", "면", "샐러드"],
  "맑음": ["외식", "가벼움", "일식", "양식"],
  "흐림": ["무난함", "따뜻함", "밥", "한식"]
};

const recommendModes = {
  stable: { label: "안정 추천", limit: 3 },
  balanced: { label: "균형 추천", limit: 10 },
  adventure: { label: "모험 추천", limit: 30 },
  random: { label: "아무거나", limit: Infinity }
};

let menus = [];
let currentInput = null;
let currentResults = [];
let activeCardId = null;
const storageKey = "dinner-picker-exclusions";
const recentRecommendationKey = "dinner-picker-recent-recommendations";
const exclusionState = {
  recentIds: new Set(),
  notCravingIds: new Set(),
  notCravingGroups: [],
  history: []
};

const form = document.querySelector("#recommendForm");
const resultsList = document.querySelector("#resultsList");
const statusText = document.querySelector("#statusText");
const effortInput = document.querySelector("#effort");
const effortValue = document.querySelector("#effortValue");
const menuCount = document.querySelector("#menuCount");
const exclusionPanel = document.querySelector("#exclusionPanel");
const exclusionList = document.querySelector("#exclusionList");
const clearExclusions = document.querySelector("#clearExclusions");

fetch("data/menus_100.json")
  .then((response) => response.json())
  .then((data) => {
    menus = data;
    menuCount.textContent = menus.length;
    loadExclusions();
    renderExclusionHistory();
  })
  .catch(() => {
    statusText.textContent = "메뉴 데이터를 불러오지 못했습니다.";
  });

effortInput.addEventListener("input", () => {
  effortValue.textContent = effortInput.value;
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!menus.length) return;

  currentInput = {
    moodA: form.moodA.value,
    moodB: form.moodB.value,
    weather: form.weather.value,
    budget: Number(form.budget.value),
    effort: Number(form.effort.value),
    nutrition: form.nutrition.value,
    recommendMode: form.recommendMode.value,
    recentTerms: splitTerms(form.recentMeals.value),
    dislikeTerms: splitTerms(form.dislikes.value)
  };

  activeCardId = null;
  generateRecommendations();
});

resultsList.addEventListener("click", (event) => {
  const reasonButton = event.target.closest("[data-exclude-reason]");
  const card = event.target.closest(".result-card");
  if (!card) return;

  const menu = menus.find((item) => item.id === card.dataset.menuId);
  if (!menu) return;

  if (reasonButton) {
    event.stopPropagation();
    excludeMenu(menu, reasonButton.dataset.excludeReason);
    return;
  }

  activeCardId = activeCardId === menu.id ? null : menu.id;
  renderResults(currentResults);
});

resultsList.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest(".result-card");
  if (!card || event.target.closest("button")) return;
  event.preventDefault();
  activeCardId = activeCardId === card.dataset.menuId ? null : card.dataset.menuId;
  renderResults(currentResults);
});

clearExclusions.addEventListener("click", () => {
  exclusionState.recentIds.clear();
  exclusionState.notCravingIds.clear();
  exclusionState.notCravingGroups = [];
  exclusionState.history = [];
  saveExclusions();
  activeCardId = null;
  renderExclusionHistory();
  if (currentInput) generateRecommendations();
});

function splitTerms(value) {
  return value
    .split(/[,，\n]/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function scoreMenu(menu, input) {
  const reasons = [];
  const penalties = [];
  let score = 50;

  const manualExclusion = getManualExclusion(menu);
  if (manualExclusion) {
    return {
      menu,
      score: -999,
      reasons,
      penalties: [manualExclusion],
      excluded: true
    };
  }

  const dislikeHit = input.dislikeTerms.find((term) => matchesMenu(menu, term));
  if (dislikeHit) {
    return {
      menu,
      score: -999,
      reasons,
      penalties: [`비선호 항목 '${dislikeHit}'과 겹쳐 제외됨`],
      excluded: true
    };
  }

  const moodA = applyMood(menu, input.moodA);
  const moodB = applyMood(menu, input.moodB);
  score += moodA.points + moodB.points;
  if (moodA.points > 0) reasons.push(`사람 A: ${moodRules[input.moodA].reason}`);
  if (moodB.points > 0) reasons.push(`사람 B: ${moodRules[input.moodB].reason}`);
  if (Math.abs(moodA.points - moodB.points) <= 4) {
    score += 4;
    reasons.push("두 사람의 기분에 고르게 맞음");
  }

  const recentPenalty = input.recentTerms.reduce((sum, term) => {
    if (matchesMenu(menu, term)) return sum + 18;
    if (menu.categories.some((category) => term.includes(category) || category.includes(term))) return sum + 8;
    return sum;
  }, 0);
  if (recentPenalty) {
    score -= recentPenalty;
    penalties.push("최근 먹은 메뉴 또는 비슷한 카테고리와 겹침");
  } else if (input.recentTerms.length) {
    score += 6;
    reasons.push("최근 섭취 이력과 겹치지 않음");
  }

  const weatherScore = weatherRules[input.weather].filter((tag) => hasAny(menu, [tag])).length * 5;
  if (weatherScore) {
    score += weatherScore;
    reasons.push(`${input.weather} 날씨에 어울리는 속성이 있음`);
  } else {
    score -= 4;
    penalties.push(`${input.weather} 날씨와의 직접 적합도가 낮음`);
  }

  if (menu.pricePerPerson <= input.budget) {
    const budgetBonus = menu.pricePerPerson <= input.budget * 0.8 ? 8 : 4;
    score += budgetBonus;
    reasons.push(`1인 ${menu.pricePerPerson.toLocaleString()}원으로 예산 안에 들어옴`);
  } else {
    const over = menu.pricePerPerson - input.budget;
    score -= Math.min(22, Math.ceil(over / 1000) * 3);
    penalties.push(`예산보다 1인 ${over.toLocaleString()}원 높음`);
  }

  const maxEffort = 6 - input.effort;
  if (menu.effortLevel <= maxEffort || menu.deliveryFriendly) {
    score += 8;
    reasons.push(menu.deliveryFriendly ? "배달 또는 간편 주문에 적합함" : "현재 귀찮음 정도에서 부담이 낮음");
  } else {
    score -= (menu.effortLevel - maxEffort) * 5;
    penalties.push("현재 귀찮음 정도에 비해 준비나 이동 부담이 있음");
  }

  const nutritionResult = scoreNutrition(menu, input.nutrition);
  score += nutritionResult.points;
  if (nutritionResult.reason) reasons.push(nutritionResult.reason);
  if (nutritionResult.penalty) penalties.push(nutritionResult.penalty);

  score += menu.shareability * 3;
  if (menu.shareability >= 4) reasons.push("2인이 나눠 먹기 좋음");

  return {
    menu,
    score: Math.round(score),
    reasons: unique(reasons).slice(0, 5),
    penalties: unique(penalties).slice(0, 4),
    excluded: false
  };
}

function getRankedMenus() {
  const recentIds = getRecentRecommendationIds();
  return menus
    .map((menu) => scoreMenu(menu, currentInput))
    .filter((item) => !item.excluded)
    .map((item) => applyRecentRecommendationPenalty(item, recentIds))
    .sort((a, b) => b.finalScore - a.finalScore);
}

function applyRecentRecommendationPenalty(item, recentIds) {
  const wasRecentlyRecommended = recentIds.includes(item.menu.id);
  if (!wasRecentlyRecommended) {
    return { ...item, finalScore: item.score };
  }

  return {
    ...item,
    finalScore: Math.max(1, item.score - 14),
    penalties: unique([...item.penalties, "최근 추천된 메뉴라 반복 방지 패널티가 적용됨"])
  };
}

function getManualExclusion(menu) {
  if (exclusionState.recentIds.has(menu.id)) return "최근에 먹은 메뉴로 제외됨";
  if (exclusionState.notCravingIds.has(menu.id)) return "안땡김으로 직접 제외됨";
  const similarGroup = exclusionState.notCravingGroups.find((group) => isSimilarMenu(menu, group));
  if (similarGroup) return `'${similarGroup.sourceName}'와 비슷한 음식으로 함께 제외됨`;
  return "";
}

function excludeMenu(menu, reason) {
  if (reason === "recent") {
    exclusionState.recentIds.add(menu.id);
    exclusionState.history.push({
      id: menu.id,
      name: menu.name,
      label: "최근에 먹음",
      detail: "해당 메뉴만 제외"
    });
  }

  if (reason === "not-craving") {
    const group = {
      sourceId: menu.id,
      sourceName: menu.name,
      tags: getSimilarityTags(menu)
    };
    exclusionState.notCravingIds.add(menu.id);
    exclusionState.notCravingGroups.push(group);
    exclusionState.history.push({
      id: menu.id,
      name: menu.name,
      label: "안땡김",
      detail: group.tags.length ? `비슷한 ${group.tags.join(", ")} 메뉴도 제외` : "비슷한 메뉴도 제외"
    });
  }

  saveExclusions();
  activeCardId = null;
  generateRecommendations();
}

function saveExclusions() {
  const payload = {
    recentIds: [...exclusionState.recentIds],
    notCravingIds: [...exclusionState.notCravingIds],
    notCravingGroups: exclusionState.notCravingGroups,
    history: exclusionState.history
  };
  localStorage.setItem(storageKey, JSON.stringify(payload));
}

function loadExclusions() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (!saved) return;
    exclusionState.recentIds = new Set(saved.recentIds || []);
    exclusionState.notCravingIds = new Set(saved.notCravingIds || []);
    exclusionState.notCravingGroups = saved.notCravingGroups || [];
    exclusionState.history = saved.history || [];
  } catch {
    localStorage.removeItem(storageKey);
  }
}

function getSimilarityTags(menu) {
  const weakTags = ["한식", "중식", "일식", "양식", "외식", "밥", "배달", "무난함", "가벼움"];
  const tags = menu.categories.filter((category) => !weakTags.includes(category));
  return tags.length ? tags : menu.categories.slice(0, 2);
}

function isSimilarMenu(menu, group) {
  if (menu.id === group.sourceId) return true;
  const overlap = menu.categories.filter((category) => group.tags.includes(category)).length;
  return overlap > 0;
}

function applyMood(menu, mood) {
  const rule = moodRules[mood];
  let points = 0;
  points += menu.categories.filter((category) => rule.categories.includes(category)).length * 4;
  points += menu.moodTags.filter((tag) => rule.tags.includes(tag)).length * 5;
  if (rule.spicyMin && menu.spicyLevel >= rule.spicyMin) points += 5;
  return { points };
}

function scoreNutrition(menu, mode) {
  const tags = menu.nutritionTags;
  if (mode === "normal") return { points: 2, reason: "영양 조건을 엄격히 보지 않음" };
  if (mode === "balanced") {
    const balanced = tags.includes("단백질") && tags.includes("채소") && tags.includes("탄수화물");
    return balanced
      ? { points: 14, reason: "단백질, 채소, 탄수화물 균형이 좋음" }
      : { points: -5, penalty: "영양 밸런스가 한쪽으로 치우침" };
  }
  if (mode === "light") {
    if (tags.includes("가벼움") || tags.includes("채소")) return { points: 12, reason: "가볍게 먹기 좋은 구성" };
    if (tags.includes("기름짐") || tags.includes("나트륨높음")) return { points: -10, penalty: "가볍게 먹기에는 기름지거나 짠 편" };
  }
  if (mode === "protein") {
    return tags.includes("단백질")
      ? { points: 12, reason: "단백질 보충에 유리함" }
      : { points: -6, penalty: "단백질 중심 조건에는 약함" };
  }
  return { points: 0 };
}

function hasAny(menu, terms) {
  const values = [menu.name, ...menu.categories, ...menu.ingredients, ...menu.moodTags, ...menu.weatherTags, ...menu.nutritionTags];
  return terms.some((term) => values.some((value) => value.includes(term) || term.includes(value)));
}

function matchesMenu(menu, term) {
  return hasAny(menu, [term]);
}

function unique(items) {
  return [...new Set(items)];
}

function generateRecommendations() {
  if (!currentInput) return;
  currentResults = selectRecommendations(getRankedMenus(), currentInput.recommendMode);
  rememberRecommendations(currentResults.map((item) => item.menu.id));
  renderResults(currentResults);
  renderExclusionHistory();
}

function selectRecommendations(rankedItems, modeKey) {
  const mode = recommendModes[modeKey] || recommendModes.balanced;
  const candidates = modeKey === "random"
    ? rankedItems.filter((item) => item.menu.pricePerPerson <= currentInput.budget * 1.5)
    : rankedItems.slice(0, mode.limit);

  const pool = [...candidates];
  const selected = [];
  while (pool.length && selected.length < 3) {
    const picked = pickWeighted(pool);
    selected.push(picked);
    pool.splice(pool.indexOf(picked), 1);
  }
  return selected;
}

function pickWeighted(items) {
  const weightedItems = items.map((item) => ({
    item,
    weight: Math.sqrt(Math.max(1, item.finalScore))
  }));
  const totalWeight = weightedItems.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = Math.random() * totalWeight;

  for (const entry of weightedItems) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.item;
  }
  return weightedItems.at(-1).item;
}

function getRecentRecommendationIds() {
  try {
    const saved = JSON.parse(localStorage.getItem(recentRecommendationKey));
    return Array.isArray(saved) ? saved.slice(0, 10) : [];
  } catch {
    localStorage.removeItem(recentRecommendationKey);
    return [];
  }
}

function rememberRecommendations(ids) {
  const nextIds = unique([...ids, ...getRecentRecommendationIds()]).slice(0, 10);
  localStorage.setItem(recentRecommendationKey, JSON.stringify(nextIds));
}

function renderResults(items) {
  resultsList.innerHTML = "";
  const mode = recommendModes[currentInput?.recommendMode] || recommendModes.balanced;
  statusText.textContent = items.length
    ? `${mode.label}: 상위 후보군 중 점수 가중 랜덤으로 선정됨`
    : "추천 가능한 메뉴가 없습니다. 비선호 조건을 줄여보세요.";

  items.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = `result-card${activeCardId === item.menu.id ? " is-active" : ""}`;
    card.dataset.menuId = item.menu.id;
    card.tabIndex = 0;
    card.innerHTML = `
      <div class="rank">${index + 1}위</div>
      <div class="menu-title">
        <h3>${item.menu.name}</h3>
        <span class="score">${item.finalScore}점</span>
      </div>
      <div class="meta">
        ${item.menu.categories.slice(0, 4).map((tag) => `<span class="pill">${tag}</span>`).join("")}
      </div>
      <ul class="reason-list">
        <li><strong>추천 이유</strong></li>
        ${item.reasons.map((reason) => `<li>${reason}</li>`).join("")}
      </ul>
      <ul class="reason-list penalty">
        <li><strong>감점 이유</strong></li>
        ${item.penalties.length ? item.penalties.map((reason) => `<li>${reason}</li>`).join("") : "<li>큰 감점 요인이 없음</li>"}
      </ul>
      <div class="card-actions" aria-label="${item.menu.name} 제외 사유 선택">
        <button class="reason-button" type="button" data-exclude-reason="recent">최근에 먹음</button>
        <button class="reason-button" type="button" data-exclude-reason="not-craving">안땡김</button>
      </div>
    `;
    resultsList.appendChild(card);
  });
}

function renderExclusionHistory() {
  exclusionList.innerHTML = "";
  exclusionPanel.hidden = exclusionState.history.length === 0;

  exclusionState.history.forEach((item) => {
    const entry = document.createElement("li");
    entry.textContent = `${item.name} - ${item.label}: ${item.detail}`;
    exclusionList.appendChild(entry);
  });
}
