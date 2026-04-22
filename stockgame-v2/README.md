# stockgame-v2

기존 `stockgame` 프로젝트의 개선 버전입니다.

## 핵심 변경점

- 문제를 2가지 유형으로 분리
  - **유형 1**: 전날까지의 캔들 + 거래량을 보고 다음 날 **시가 방향** 예측
  - **유형 2**: 전날까지의 캔들 + 거래량 + 해당일 **시가 정보**를 보고 당일 **종가 방향** 예측
- 점수제 대신 **가상 투자금 100만원**으로 Long / Short 포지션 수익률 반영
- 같은 문제를 완전 무작위로 판단하는 **원숭이 벤치마크**와 결과 비교

## 데이터 사용 방식

이 버전은 현재 별도 데이터 파일을 만들지 않고, 기존 데이터를 그대로 재사용합니다.

- 참조 경로: `../stockgame/data/problems.json`

현재 `stockgame/data/problems.json` 구조에는 아래 정보가 모두 포함되어 있어 v2 문제 유형을 만드는 데 충분합니다.

- 전날까지의 `visibleCandles`
- 다음 날/해당일 정보인 `targetCandle.open`
- `targetCandle.close`
- `targetCandle.openDirection`
- `targetCandle.closeDirection`

## 포함 파일

- `index.html` : 개선판 화면
- `style.css` : 개선판 스타일
- `app.js` : 문제 유형 분기, 투자 시뮬레이션, 원숭이 비교 로직

## 참고

현재 구현은 **기존 데이터 재사용을 우선한 1차 개선판**입니다.
다음 단계에서는 문제 수, 포지션 크기 조절, 난이도 분리, 랭킹 저장, 원숭이 애니메이션 등을 추가할 수 있습니다.
