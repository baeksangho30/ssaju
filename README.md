# 오행 체력 종목

사주 오행(재미용) × 코스피 체력 점수(RS) 80점 초과 종목.

- 사주 계산: [ssaju](https://github.com/golbin/ssaju) (MIT, `vendor/ssaju.mjs` + `vendor/ssaju.LICENSE`)
- RS 점수: [달리나음의 코스피 상대 강도](https://dalinaum.github.io/rs/)에 **공개된 최신 코스피 점수표 페이지만 읽어서** 씀. 그 저장소 코드는 쓰지 않음.
- 업종: [FinanceDataReader](https://github.com/FinanceData/FinanceDataReader) `StockListing('KRX-DESC')`의 `Industry`
- 1년 주가 그래프: FinanceDataReader `DataReader` 종가 (RS 80점 넘는 후보만, 점수 기준일까지 1년)
- 오행↔업종 규칙: `mapping.js`
- 디자인 고르기(기본·BMW·NVIDIA·Ferrari): [awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT)에서 받은 `designs/*/DESIGN.md`를 보고 `style.css`의 `[data-theme]` 블록으로 옮겼음. 고른 디자인은 브라우저 `localStorage`(`ohaeng-theme`)에 저장. 상승 빨강·하락 파랑은 모든 디자인에서 유지.

## 점수 새로 받기

```bash
pip install -r scripts/requirements.txt
python scripts/build_data.py
```

`data/kospi-rs.json`이 그 날 가장 최근 코스피 점수로 바뀝니다.

## 열기

`fetch`를 쓰므로 파일을 바로 열지 말고 간단한 서버로 엽니다.

```bash
python -m http.server 8765
```
