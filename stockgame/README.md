# stockgame

과거 일봉 캔들차트(+거래량)를 보고 다음 거래일의 **시가 방향 / 종가 방향**을 맞히는 웹 게임입니다.

## 포함 파일

- `index.html` : 게임 화면
- `style.css` : 스타일
- `app.js` : 문제 진행, 채점, 최종 결과 표시 로직
- `data/problems.json` : 게임 문제 데이터
- `build_dataset.py` : 한국/미국 대형주 실제 과거 데이터 기반 문제 생성 스크립트
- `requirements.txt` : 데이터 생성용 패키지

## 게임 규칙

- 차트에는 과거 일봉과 거래량만 표시됩니다.
- 다음 거래일은 숨겨져 있습니다.
- 사용자는 **전일 종가 대비** 다음 거래일의
  - 시가 상승/하락
  - 종가 상승/하락
  을 맞힙니다.
- 모든 문제 제출 후에는
  1. 실제 등락 여부
  2. 문제였던 주식의 종목명 / 티커 / 날짜
  가 함께 공개됩니다.

## 데이터 생성 방법

### 로컬에서 생성

```bash
cd stockgame
pip install -r requirements.txt
python build_dataset.py
```

생성 후 `data/problems.json`이 실제 과거 데이터 기반으로 갱신됩니다.

## 주의

현재 저장소에 포함된 `data/problems.json`은 **UI가 바로 실행되도록 넣어둔 샘플 문제**입니다.
실전용으로 쓰려면 `build_dataset.py`를 실행해서 교체하는 것이 좋습니다.

## 추천 종목군

- 한국: 삼성전자, SK하이닉스, 현대차, NAVER, KB금융, LG화학, POSCO홀딩스, 삼성바이오로직스
- 미국: Apple, Microsoft, Alphabet, Amazon, NVIDIA, Meta, JPMorgan Chase, Berkshire Hathaway
