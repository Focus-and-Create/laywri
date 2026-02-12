# CLAUDE.md — LayWri (Layer Writing)

## Project Overview

LayWri는 레이어 기반 글쓰기/메모 웹 애플리케이션이다. 텍스트에 의미론적 레이어(대사, 묘사 등)를 태깅하여 시각적으로 구분하고, 레이어별 표시/숨김을 통해 원고를 다층적으로 관리할 수 있다.

## Tech Stack

- **순수 바닐라 JavaScript** (ES6+) — 프레임워크/라이브러리 없음
- **HTML5** (`contenteditable` 기반 리치 텍스트 에디터)
- **CSS3** (CSS Custom Properties, glassmorphism, flexbox/grid)
- **빌드 시스템 없음** — 정적 파일 직접 서빙
- **npm/패키지 매니저 없음**

## File Structure

```
laywri/
├── index.html      # SPA 엔트리포인트 (목록 화면 + 에디터 화면)
├── app.js          # 전체 앱 로직 (~1255줄)
├── styles.css      # 전체 스타일시트
├── CLAUDE.md       # 이 파일
└── .gitignore
```

## How to Run

```bash
# 방법 1: 파일 직접 열기
open index.html          # macOS
xdg-open index.html      # Linux

# 방법 2: 로컬 서버
python3 -m http.server 8000
# → http://localhost:8000
```

빌드, 번들링, 컴파일 단계 없음. 브라우저에서 바로 실행된다.

## Architecture

### 화면 구조
- **목록 화면** (`#listScreen`): 메모 카드 그리드, FAB 버튼으로 새 원고 생성
- **에디터 화면** (`#editorScreen`): contenteditable 에디터, 레이어 패널, 서식 툴바

### 핵심 모듈 (app.js)
| 영역 | 라인 범위 | 설명 |
|------|-----------|------|
| 상태 관리 | 1-18 | `state` 객체, `history` undo/redo 스택 |
| DOM 요소 | 23-60 | 40+ 요소 셀렉터 |
| 텍스트 서식 | 62-315 | `applyFormat()`, 키보드 단축키, `document.execCommand()` |
| 패널 관리 | 317-362 | 드래그 가능한 플로팅 레이어 패널 |
| 화면 전환 | 365-379 | 목록 ↔ 에디터 토글 |
| 메모 CRUD | 382-449 | 생성/열기/저장/삭제/렌더 |
| Undo/Redo | 452-476 | 히스토리 스택 (최대 50개) |
| 레이어 스타일 | 478-518 | 색상/배경 모드, 가시성 토글 |
| 레이어 관리 | 520-572 | 추가/삭제/토글/색상모드 전환 |
| 레이어 적용 | 574-644 | 선택 텍스트에 레이어 태깅 |
| 에디터 정규화 | 646-737 | DOM 정리, 중첩 제거, 병합 |
| 통계 | 739-747 | 글자 수/단어 수 |
| LocalStorage | 749-754 | `layerMemos` 키로 영속화 |
| Enter 처리 | 756-926 | 줄바꿈 시 레이어 컨텍스트 유지 |
| 텍스트 입력 | 928-1017 | `beforeinput` 이벤트, 레이어 분할 삽입 |
| 붙여넣기 | 1020-1042 | 평문 붙여넣기 + 레이어 할당 |
| 컨텍스트 메뉴 | 1045-1085 | 우클릭 레이어 선택 |
| 이벤트 리스너 | 1087-1249 | 전체 이벤트 바인딩 |
| 초기화 | 1251-1255 | 앱 부팅 |

### 데이터 모델
```javascript
// 메모 객체 구조
{
  id: "memo-{timestamp}",
  title: "string",
  content: "HTML string (레이어 span 포함)",
  layers: [
    { id: "layer-0", name: "기본", color: "#94a3b8", visible: true, colorMode: "highlight" }
  ],
  activeLayerId: "layer-id",
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### 저장소
- **localStorage** 키: `layerMemos`
- JSON 직렬화된 메모 배열

### 레이어 시스템
- 텍스트는 `<span class="layer-text" data-layer="{layerId}">` 로 감싸짐
- 기본 레이어: 기본(#94a3b8), 대사(#60a5fa), 묘사(#f472b6)
- 색상 모드: `highlight` (배경색) / `text` (글자색)
- 레이어 숨김 시 `displayMode`에 따라 `display:none` 또는 `visibility:hidden`

## External Dependencies

CDN으로 로드되는 외부 리소스 (오프라인 시 폰트 폴백):
- **Google Fonts**: Inter (UI), Source Serif 4 (본문)
- **Material Symbols Outlined**: 아이콘

## Browser APIs Used

- `contenteditable` + `document.execCommand()`: 리치 텍스트 편집
- `Selection` / `Range` API: 텍스트 선택 및 조작
- `TreeWalker`: DOM 노드 순회
- `localStorage`: 데이터 영속화
- `Clipboard API`: 붙여넣기 처리

## Coding Conventions

- **언어**: 코드 주석 및 UI 텍스트는 한국어
- **들여쓰기**: 2스페이스
- **문자열**: 작은따옴표 (`'`) 우선
- **변수명**: camelCase
- **상수**: 전역 `state`, `history` 객체에 상태 집중
- **DOM 접근**: `document.getElementById()` 직접 참조
- **이벤트**: 인라인 핸들러 최소화, `addEventListener` 우선
- **함수 스타일**: 일반 함수 선언 (`function name()`) 사용

## Important Patterns

1. **레이어 span 구조를 항상 유지**: 에디터 내 모든 텍스트는 반드시 `.layer-text[data-layer]` span으로 감싸져야 한다. 벌거벗은(naked) 텍스트 노드가 생기면 `normalizeEditor()`가 기본 레이어로 감싼다.
2. **편집 후 정규화**: 텍스트 변경 후 `normalizeEditor()` 호출 필수 — 중첩 span 제거, 빈 span 삭제, 인접 동일 레이어 병합 처리.
3. **Undo/Redo**: 변경 전 `saveHistory()` 호출. innerHTML 기반 스냅샷.
4. **저장**: 변경 시 `saveCurrentMemo()` → `saveMemos()` (localStorage) 체이닝.

## Known Limitations

- `document.execCommand()`는 deprecated API (현재 동작하나 향후 브라우저 지원 불확실)
- localStorage 용량 제한 (~5MB)
- 서버/클라우드 동기화 없음 (브라우저 로컬 전용)
- 테스트 프레임워크 미설정
- 린팅/포매팅 도구 미설정

## Key Keyboard Shortcuts

| 단축키 | 기능 |
|--------|------|
| Ctrl+B | 굵게 |
| Ctrl+I | 기울임 |
| Ctrl+U | 밑줄 |
| Ctrl+Z | 실행 취소 |
| Ctrl+Y | 다시 실행 |

## CSS Design Tokens

```css
--primary: #135bec;    /* 주 색상 (파란색) */
--bg-main: #ffffff;    /* 배경색 */
--text-main: #1e293b;  /* 본문 텍스트 */
--text-muted: #94a3b8; /* 보조 텍스트 */
--glass: rgba(255, 255, 255, 0.85); /* 글래스모피즘 배경 */
```
