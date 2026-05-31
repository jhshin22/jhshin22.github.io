# StarSeeker

한국 기준 일자별·시간대별 관측 추천 천체를 자동 계산해 보여주는 정적 HTML 캘린더입니다.

## 1차 버전 목표

- GitHub Pages에서 바로 열리는 `calendar.html` 제공
- `data/events.json` 기반 월간 캘린더 표시
- 날짜 클릭 시 시간대별 추천 천체 상세 표시
- 달, 행성, 주요 1등성 중심의 관측 추천 데이터 생성
- Python + Skyfield + JPL DE421 기반 실제 고도/방위각 계산
- Open-Meteo 시간대별 예보를 이용한 흐림/강수 필터링
- GitHub Actions로 매일 자동 갱신

## 현재 구현 상태

- 정적 HTML 캘린더 구현
- 모바일 우선 CSS 적용
- 천체 유형·추천 등급 필터 구현
- Skyfield 기반 천문 계산 엔진 연결
- Open-Meteo 기반 날씨 필터 연결
- 서울 종로 기준 달·수성·금성·화성·목성·토성·주요 1등성 계산
- GitHub Actions 자동 갱신 workflow 추가

## 로컬 실행

```bash
cd starseeker
pip install -r requirements.txt
python scripts/build_all.py --days 30
python scripts/validate_output.py
```

첫 실행 시 Skyfield가 `data/skyfield_cache/de421.bsp` 천체력 파일을 다운로드할 수 있습니다.

날씨 예보 호출을 끄고 천문 계산만 실행하려면 다음처럼 실행합니다.

```bash
python scripts/build_all.py --days 30 --disable-weather
```

브라우저에서 아래 파일을 엽니다.

```text
starseeker/calendar.html
```

GitHub Pages에서는 다음 형태로 접근할 수 있습니다.

```text
https://jhshin22.github.io/starseeker/calendar.html
```

## 주요 폴더

```text
starseeker/
  calendar.html
  assets/
    style.css
    app.js
  config/
    location.json
    objects.json
    scoring_rules.json
  data/
    events.json
    daily_summary.json
    metadata.json
    meteor_showers.json
  scripts/
    build_all.py
    build_events.py
    calc_objects.py
    fetch_weather.py
    utils_direction.py
    validate_output.py
```

## 데이터 생성 방식

현재 실제 계산은 다음 구조로 동작합니다.

- `calc_objects.py`: Skyfield + JPL DE421 기반 고도/방위각 계산
- `fetch_weather.py`: Open-Meteo 시간대별 구름량·강수확률·강수량 수집
- `build_events.py`: 시간대별 관측 가능성 점수 산정 및 흐림/강수 시간대 제외
- `build_all.py`: 30일치 `events.json`, `daily_summary.json`, `metadata.json` 생성
- `calendar.html`: 생성된 JSON을 읽어 월간 캘린더 표시

## 날씨 필터 기준

현재 Open-Meteo 예보가 있는 시간대에는 다음 조건이면 추천 대상에서 제외합니다.

- 강수량이 0보다 큼
- 강수확률 50% 이상
- 구름량 80% 이상

구름량 65~79%는 큰 감점, 40~64%는 소폭 감점, 20% 이하는 가점 처리합니다. 예보가 제공되지 않는 날짜는 천문 조건만으로 계산합니다.

## 계산 대상

- 달
- 수성, 금성, 화성, 목성, 토성
- 시리우스, 베가, 아크투루스, 스피카, 알타이르, 데네브, 카펠라, 리겔, 베텔게우스, 알데바란, 안타레스, 포말하우트

## 한계

- 건물, 산, 나무 등 실제 지평선 장애물은 반영하지 않습니다.
- 도시 광해, 시상, 투명도는 정밀 반영하지 않습니다.
- Open-Meteo 예보가 실제 관측 시점의 구름 상태와 다를 수 있습니다.
- Open-Meteo 기본 예보 범위 밖 날짜는 날씨 필터 없이 천문 조건만 계산합니다.
- 현재 KASI API는 아직 연결하지 않았습니다.
- 별 좌표는 `config/objects.json`에 수동 등록된 주요 별만 사용합니다.
- 유성우 데이터는 아직 자동 이벤트 생성에 반영하지 않고 참고 JSON으로만 둡니다.
