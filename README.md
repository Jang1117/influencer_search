# INFL KR — 한국 인스타그램 인플루언서 플랫폼

## ✅ Node.js 불필요 — Python으로 실행

### 1. Python 설치 확인
CMD에서:
```
python --version
```
없으면 → https://www.python.org 또는 Microsoft Store에서 "Python" 검색 후 무료 설치

### 2. 필요 패키지 설치 (최초 1회)
```
pip install flask flask-cors
```

### 3. 서버 실행
```
cd 폴더경로
python server.py
```

### 4. index.html을 브라우저에서 열기
- server.py는 그대로 두고
- index.html 더블클릭
- 우측 상단 "수집 설정" → 수집 시작

---

## 수집 소스 (완전 무료)
| 소스 | 데이터 |
|------|--------|
| 나무위키 | 이름 + Instagram 아이디 (~1,600명) |
| HypeAuditor | 팔로워, 참여율, 카테고리, 프로필 사진 |

---

## GitHub Pages로 검색 페이지 공개하기

이 프로젝트는 두 개의 페이지로 나뉩니다:

- **index.html** — 수집·편집용 관리 페이지. `server.py`(Flask)가 로컬에서 돌아가야 동작. 본인 PC에서만 사용.
- **docs/index.html** — 검색·열람 전용 정적 페이지. 백엔드 없이 `docs/data.json`만 읽어서 동작. GitHub Pages로 무료 공개 가능.

### 배포 흐름
1. 로컬에서 평소처럼 `python server.py` 실행 후 "수집 시작"으로 데이터 수집/편집
2. 관리 페이지 우측 상단 "⚙ 수집 설정" → **"📤 정적 사이트로 내보내기"** 클릭
   (또는 수집이 끝나면 자동으로 `docs/data.json`이 갱신됩니다)
3. 변경사항을 GitHub에 올리기:
   ```
   git add docs/
   git commit -m "데이터 갱신"
   git push
   ```
4. 저장소 Settings → Pages → Source를 `main` 브랜치 `/docs` 폴더로 설정 (최초 1회)

공개되는 저장소에는 이미 공개된 Instagram/HypeAuditor 정보(이름, 팔로워 수, 프로필 사진 URL)가 포함됩니다.
