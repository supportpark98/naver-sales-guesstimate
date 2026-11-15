"""index.html 생성: template.html + app.js → 북마클릿 두 종류를 넣은 설치 페이지"""
import re
import html
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).parent
PAGES_URL = "https://supportpark98.github.io/naver-sales/app.js"

app = (ROOT / "app.js").read_text(encoding="utf-8")
version = re.search(r"VERSION = '([^']+)'", app).group(1)

loader = (
    "javascript:(function(){var s=document.createElement('script');"
    f"s.src='{PAGES_URL}?v='+Date.now();"
    "s.onerror=function(){alert('분석 도구를 불러오지 못했어요. 설치 페이지의 (단독) 버튼을 써주세요.')};"
    "document.body.appendChild(s)})();"
)
standalone = "javascript:" + quote(app, safe="")

page = (ROOT / "template.html").read_text(encoding="utf-8")
page = (page.replace("__VERSION__", version)
            .replace("__LOADER__", html.escape(loader, quote=True))
            .replace("__STANDALONE__", html.escape(standalone, quote=True)))
(ROOT / "index.html").write_text(page, encoding="utf-8")
print(f"index.html 생성 완료 (v{version}, 단독 북마클릿 {len(standalone):,}자)")
