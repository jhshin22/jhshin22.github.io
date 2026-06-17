window.ChuWar = window.ChuWar || {};
(function (A) {
  const T = {
    KING: { name: "왕", short: "王", count: 1 },
    INFANTRY: { name: "보병", short: "보", count: 4 },
    CAVALRY: { name: "기병", short: "기", count: 2 },
    SPY: { name: "스파이", short: "첩", count: 2 },
    BOMB: { name: "폭탄병", short: "폭", count: 2 },
    G1: { name: "1성장군", short: "★1", count: 1, rank: 1 },
    G2: { name: "2성장군", short: "★2", count: 1, rank: 2 },
    G3: { name: "3성장군", short: "★3", count: 1, rank: 3 },
    G4: { name: "4성장군", short: "★4", count: 1, rank: 4 },
    G5: { name: "5성장군", short: "★5", count: 1, rank: 5 },
  };
  function ico(txt, bg = "#142137", fg = "#ffe08e") {
    let c = document.createElement("canvas"),
      x = c.getContext("2d");
    c.width = c.height = 128;
    x.fillStyle = bg;
    x.beginPath();
    x.moveTo(64, 8);
    x.lineTo(114, 25);
    x.lineTo(106, 82);
    x.lineTo(64, 120);
    x.lineTo(22, 82);
    x.lineTo(14, 25);
    x.closePath();
    x.fill();
    x.lineWidth = 5;
    x.strokeStyle = "#e3b75b";
    x.stroke();
    x.fillStyle = fg;
    x.font = "bold 36px Arial";
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText(txt, 64, 64);
    try {
      return c.toDataURL("image/webp", 0.88);
    } catch (e) {
      return c.toDataURL("image/png");
    }
  }
  A.C = {
    PLAYERS: { top: "상단 플레이어", bottom: "하단 플레이어" },
    FIELD: { top: "위쪽 4행", bottom: "아래쪽 4행" },
    TYPES: T,
    ORDER: [
      "KING",
      "G1",
      "G2",
      "G3",
      "G4",
      "G5",
      "INFANTRY",
      "CAVALRY",
      "SPY",
      "BOMB",
    ],
    ICONS: {},
  };
  for (const k of Object.keys(T)) A.C.ICONS[k] = ico(T[k].short);
  A.C.ICONS.UNKNOWN = ico("?", "#202632", "#d6dee8");
})(ChuWar);
