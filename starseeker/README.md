# StarSeeker

한국 기준 일자별·시간대별 관측 추천 천체를 자동 계산해 보여주는 정적 HTML 캘린더입니다.

## 1차 버전 목표

- GitHub Pages에서 바로 열리는 `calendar.html` 제공
- `data/events.json` 기반 월간 캘린더 표시
- 날짜 클릭 시 시간대별 추천 천체 상세 표시
- 달, 행성, 주요 1등성 중심의 관측 추천 데이터 구조 정의
- Python 스크립트로 샘플/계산 데이터를 생성할 수 있는 기반 마련
- GitHub Actions로 매일 자동 갱신 가능하도록 워크플로 준비

## 현재 구현 상태

- 샘플 JSON 기반 정적 캘린더 구현
- 모바일 우선 CSS 적용
- 천체 유형·추천 등급 필터 구현
- Python 빌드 진입점 및 검증 스크립트 추가
- Skyfield 연동 전에도 샘플 데이터 생성 가능

## 로컬 실행

```bash
cd starseeker
python scripts/build_all.py --days 30
python scripts/validate_output.py
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
    utils_direction.py
    validate_output.py
```

## 데이터 출처 계획

1차 개발은 API 키 없이도 돌아가는 구조를 우선합니다.

- 기본 계산: Python + Skyfield
- 한국 기준 보강 데이터: 한국천문연구원 Open API
- 실제 관측 가능성 보정: 기상청 단기예보 API

API 키가 없거나 실패해도 빌드가 중단되지 않고, 천문 계산 또는 샘플 데이터만으로 페이지가 표시되도록 설계합니다.

## 한계

- 건물, 산, 나무 등 실제 지평선 장애물은 반영하지 않습니다.
- 도시 광해, 시상, 투명도는 정밀 반영하지 않습니다.
- 현재 커밋은 1차 개발 시작용 스캐폴드이며, Skyfield 실제 계산 로직은 후속 단계에서 확장합니다.
