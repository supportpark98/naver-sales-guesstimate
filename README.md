# 📊 naver-sales-guesstimate — 네이버 판매량 추정 (베타)

네이버 브랜드스토어 상품 페이지의 구매자 수 배지(오늘 / 최근 1주 / 약 4개월)를 읽어
일간·주간 판매량과 추정매출을 보여주는 북마클릿 도구입니다.

- 설치 페이지: https://supportpark98.github.io/naver-sales-guesstimate/
- `app.js` — 분석 창과 수집 로직 (북마클릿이 이 파일을 불러옴)
- `template.html` + `build.py` → `index.html` (설치 페이지) 생성

## 수정 후 배포

```bash
python3 build.py   # index.html 다시 생성 (단독 버전 북마클릿에 최신 app.js 반영)
git add -A && git commit -m "업데이트" && git push
```

기본 버전 북마클릿은 매번 최신 `app.js`를 불러오므로 푸시만 하면 바로 반영됩니다.
단독 버전은 설치 페이지에서 다시 끌어다 놓아야 합니다.
