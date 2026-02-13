// =============================
// 상태 관리
// =============================

const state = {
  memos: [],
  currentMemoId: null,
  layers: [
    { id: 'layer-0', name: '기본', color: '#94a3b8', visible: true, colorMode: 'highlight' },
    { id: 'layer-1', name: '대사', color: '#60a5fa', visible: true, colorMode: 'highlight' },
    { id: 'layer-2', name: '묘사', color: '#f472b6', visible: true, colorMode: 'highlight' }
  ],
  activeLayerId: 'layer-1',
  displayMode: 'keep',
  defaultColors: ['#94a3b8', '#60a5fa', '#f472b6', '#fbbf24', '#34d399', '#a78bfa']
};

const history = { undoStack: [], redoStack: [], maxSize: 50 };
let savedSelection = null;
let isComposing = false;

// =============================
// DOM 요소
// =============================

// 화면 및 메모 관련 요소
const listScreen = document.getElementById('listScreen');
const editorScreen = document.getElementById('editorScreen');
const memoList = document.getElementById('memoList');
const memoTitle = document.getElementById('memoTitle');
const newMemoFab = document.getElementById('newMemoFab');
const backBtn = document.getElementById('backBtn');

// 레이어 관련 요소
const layerList = document.getElementById('layerList');
const addLayerBtn = document.getElementById('addLayerBtn');
const layerContextMenu = document.getElementById('layerContextMenu');
const contextMenuItems = document.getElementById('contextMenuItems');
const floatingPanel = document.getElementById('floatingPanel');
const layerPanelToggle = document.getElementById('layerPanelToggle');
const panelClose = document.getElementById('panelClose');
const panelHeader = document.getElementById('panelHeader');

// 에디터 관련 요소
const editor = document.getElementById('editor');
const charCount = document.getElementById('charCount');
const wordCount = document.getElementById('wordCount');
const saveStatus = document.getElementById('saveStatus');

// 서식 툴바 버튼
const boldBtn = document.getElementById('boldBtn');
const italicBtn = document.getElementById('italicBtn');
const underlineBtn = document.getElementById('underlineBtn');
const strikeBtn = document.getElementById('strikeBtn');
const alignLeftBtn = document.getElementById('alignLeftBtn');
const alignCenterBtn = document.getElementById('alignCenterBtn');
const alignRightBtn = document.getElementById('alignRightBtn');
const alignJustifyBtn = document.getElementById('alignJustifyBtn');
const bulletListBtn = document.getElementById('bulletListBtn');
const numberListBtn = document.getElementById('numberListBtn');

// =============================
// 서식 툴바 기능
// =============================

// 에디터에 포커스하여 커서 유지
function focusEditor() {
  editor.focus();
}

// 블록 레벨 명령 목록 (정렬, 리스트 등)
// 이 명령들은 레이어 span을 파괴하지 않으므로 별도 후처리
const BLOCK_COMMANDS = [
  'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull',
  'insertUnorderedList', 'insertOrderedList'
];

// 서식 적용 함수 - 블록/인라인 명령 분리 처리
function applyFormat(command, value = null) {
  const selection = window.getSelection();                               // 현재 선택 영역
  const isBlock = BLOCK_COMMANDS.includes(command);                      // 블록 명령 여부

  // 인라인 서식은 선택 영역이 있어야 적용 가능
  if (!isBlock && (!selection.rangeCount || selection.isCollapsed)) {
    focusEditor();                                                       // 선택 없으면 포커스만
    return;
  }

  // 블록 명령은 커서만 있어도 해당 줄 전체에 적용 가능
  if (isBlock && !selection.rangeCount) {
    focusEditor();                                                       // 포커스 복원
    return;
  }

  // 인라인 명령 전: 영향받는 span의 레이어 정보 수집
  let affectedSpans = [];
  if (!isBlock) {
    const range = selection.getRangeAt(0);                               // 현재 범위
    editor.querySelectorAll('.layer-text').forEach(span => {
      const spanRange = document.createRange();                          // span 범위 생성
      spanRange.selectNodeContents(span);                                // span 내용 선택
      try {
        // 선택 영역과 겹치는 span만 수집
        if (!(range.compareBoundaryPoints(Range.END_TO_START, spanRange) >= 0 ||
              range.compareBoundaryPoints(Range.START_TO_END, spanRange) <= 0)) {
          affectedSpans.push({
            layerId: span.dataset.layer,                                 // 레이어 ID
            text: span.textContent                                       // 텍스트 내용
          });
        }
      } catch (e) {}
    });
  }

  focusEditor();                                                         // 에디터에 포커스
  document.execCommand(command, false, value);                           // 명령 실행

  // === 블록 명령 후처리 ===
  if (isBlock) {
    setTimeout(() => {
      wrapNakedTextInList();                                             // 리스트 내 naked 텍스트 처리
      wrapNakedTextNodes();                                              // 에디터 직속 naked 텍스트 처리
      removeEmptySpans();                                                // 빈 span 정리
      mergeAdjacentLayers();                                             // 인접 동일 레이어 병합
      updateLayerStyles();                                               // 스타일 업데이트
      updateLayerVisibility();                                           // 가시성 업데이트
      updateFormatButtons();                                             // 버튼 상태 업데이트
      updateCounts();                                                    // 글자수 업데이트
      saveCurrentMemo();                                                 // 저장
    }, 10);
    return;
  }

  // === 인라인 명령 후처리: naked 텍스트를 원래 레이어로 복원 ===
  setTimeout(() => {
    const walker = document.createTreeWalker(                            // 텍스트 노드 탐색
      editor, NodeFilter.SHOW_TEXT, null, false
    );
    const textNodes = [];                                                // 텍스트 노드 목록
    let node;
    while (node = walker.nextNode()) {
      if (node.textContent.trim()) textNodes.push(node);                 // 비어있지 않은 노드만
    }

    textNodes.forEach(textNode => {
      const parent = textNode.parentNode;                                // 부모 노드
      // 이미 레이어 span 안이면 스킵
      if (parent.classList && parent.classList.contains('layer-text')) return;

      // 텍스트 내용으로 원래 레이어 매칭
      const matchedLayer = affectedSpans.find(info =>
        textNode.textContent.includes(info.text) || info.text.includes(textNode.textContent)
      );
      const layerId = matchedLayer ? matchedLayer.layerId : state.activeLayerId;
      const layerSpan = createLayerSpan(layerId, textNode.textContent);  // 레이어 span 생성
      textNode.parentNode.replaceChild(layerSpan, textNode);             // 교체
    });

    normalizeEditor();                                                   // 정규화
    updateLayerStyles();                                                 // 스타일
    updateLayerVisibility();                                             // 가시성
    updateFormatButtons();                                               // 버튼 상태
    saveCurrentMemo();                                                   // 저장
  }, 10);
}

// 리스트(UL/OL) 내부의 naked 텍스트 노드를 레이어 span으로 감싸기
function wrapNakedTextInList() {
  const lists = editor.querySelectorAll('ul, ol');                       // 모든 리스트 요소
  lists.forEach(list => {
    list.querySelectorAll('li').forEach(li => {                          // 각 항목 순회
      const walker = document.createTreeWalker(                          // 텍스트 노드 탐색
        li, NodeFilter.SHOW_TEXT, null, false
      );
      const textNodes = [];                                              // naked 텍스트 목록
      let tn;
      while (tn = walker.nextNode()) textNodes.push(tn);                 // 수집

      textNodes.forEach(tn => {
        const parent = tn.parentNode;                                    // 부모 확인
        // 이미 레이어 span 안이면 스킵
        if (parent.classList && parent.classList.contains('layer-text')) return;
        if (!tn.textContent) return;                                     // 빈 텍스트 스킵
        const span = createLayerSpan(state.activeLayerId, tn.textContent); // 활성 레이어로 감싸기
        parent.replaceChild(span, tn);                                   // 교체
      });

      // 빈 LI에 레이어 span 추가 (커서 위치 확보)
      if (!li.querySelector('.layer-text') && !li.textContent.trim()) {
        li.appendChild(createLayerSpan(state.activeLayerId, '\u200B'));   // 제로폭 공백 삽입
      }
    });
  });
}

// 서식 버튼 활성 상태 업데이트
function updateFormatButtons() {
  const selection = window.getSelection();
  
  // 선택 영역이 없으면 모든 버튼 비활성화
  if (!selection.rangeCount || selection.isCollapsed) {
    boldBtn.classList.remove('active');
    italicBtn.classList.remove('active');
    underlineBtn.classList.remove('active');
    strikeBtn.classList.remove('active');
    alignLeftBtn.classList.remove('active');
    alignCenterBtn.classList.remove('active');
    alignRightBtn.classList.remove('active');
    alignJustifyBtn.classList.remove('active');
    bulletListBtn.classList.remove('active');
    numberListBtn.classList.remove('active');
    return;
  }
  
  const range = selection.getRangeAt(0);
  let node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentElement;
  }
  
  // 선택된 요소의 스타일 확인
  const computedStyle = window.getComputedStyle(node);
  const parentStyle = node.style || {};
  
  // 텍스트 스타일 확인
  boldBtn.classList.toggle('active', 
    computedStyle.fontWeight === '700' || computedStyle.fontWeight === 'bold' ||
    parentStyle.fontWeight === '700');
  
  italicBtn.classList.toggle('active', 
    computedStyle.fontStyle === 'italic' || parentStyle.fontStyle === 'italic');
  
  underlineBtn.classList.toggle('active', 
    computedStyle.textDecoration.includes('underline') || 
    parentStyle.textDecoration?.includes('underline'));
  
  strikeBtn.classList.toggle('active', 
    computedStyle.textDecoration.includes('line-through') || 
    parentStyle.textDecoration?.includes('line-through'));
  
  // 정렬 확인 - 부모 요소들도 확인
  let alignNode = node;
  let alignment = 'left'; // 기본값
  
  while (alignNode && alignNode !== editor) {
    const align = window.getComputedStyle(alignNode).textAlign;
    if (align && align !== 'start') {
      alignment = align;
      break;
    }
    alignNode = alignNode.parentElement;
  }
  
  alignLeftBtn.classList.toggle('active', alignment === 'left' || alignment === 'start');
  alignCenterBtn.classList.toggle('active', alignment === 'center');
  alignRightBtn.classList.toggle('active', alignment === 'right' || alignment === 'end');
  alignJustifyBtn.classList.toggle('active', alignment === 'justify');
  
  // 리스트 확인
  const inList = node.closest('ul, ol');
  bulletListBtn.classList.toggle('active', !!node.closest('ul'));
  numberListBtn.classList.toggle('active', !!node.closest('ol'));
}

// 서식 툴바 버튼 이벤트 리스너
boldBtn.addEventListener('click', () => applyFormat('bold')); // 굵게
italicBtn.addEventListener('click', () => applyFormat('italic')); // 기울임
underlineBtn.addEventListener('click', () => applyFormat('underline')); // 밑줄
strikeBtn.addEventListener('click', () => applyFormat('strikeThrough')); // 취소선
alignLeftBtn.addEventListener('click', () => applyFormat('justifyLeft')); // 왼쪽 정렬
alignCenterBtn.addEventListener('click', () => applyFormat('justifyCenter')); // 가운데 정렬
alignRightBtn.addEventListener('click', () => applyFormat('justifyRight')); // 오른쪽 정렬
alignJustifyBtn.addEventListener('click', () => applyFormat('justifyFull')); // 양쪽 정렬
bulletListBtn.addEventListener('click', () => applyFormat('insertUnorderedList')); // 글머리 기호
numberListBtn.addEventListener('click', () => applyFormat('insertOrderedList')); // 번호 매기기

// 에디터 선택 변경 시 버튼 상태 업데이트
editor.addEventListener('mouseup', updateFormatButtons);
editor.addEventListener('keyup', updateFormatButtons);
editor.addEventListener('focus', updateFormatButtons);

// 키보드 단축키 추가 (기존 keydown 이벤트에 추가)
document.addEventListener('keydown', e => {
  // Esc 키는 그대로 유지
  if (e.key === 'Escape') return;
  
  // Ctrl+B: 굵게
  if ((e.ctrlKey || e.metaKey) && e.key === 'b' && !e.shiftKey) {
    e.preventDefault();
    applyFormat('bold');
    return;
  }
  
  // Ctrl+I: 기울임
  if ((e.ctrlKey || e.metaKey) && e.key === 'i' && !e.shiftKey) {
    e.preventDefault();
    applyFormat('italic');
    return;
  }
  
  // Ctrl+U: 밑줄
  if ((e.ctrlKey || e.metaKey) && e.key === 'u' && !e.shiftKey) {
    e.preventDefault();
    applyFormat('underline');
    return;
  }
  
  // 기존 단축키 유지
  if ((e.ctrlKey||e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  if ((e.ctrlKey||e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  if ((e.ctrlKey||e.metaKey) && e.key >= '1' && e.key <= '9') {
    const i = parseInt(e.key) - 1;
    if (state.layers[i]) { e.preventDefault(); state.activeLayerId = state.layers[i].id; renderLayers(); }
  }
});

// =============================
// 플로팅 패널 드래그
// =============================

let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let panelStartX = 0, panelStartY = 0;

panelHeader.addEventListener('mousedown', (e) => {
  isDragging = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  const rect = floatingPanel.getBoundingClientRect();
  panelStartX = rect.left;
  panelStartY = rect.top;
  panelHeader.style.cursor = 'grabbing';
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const deltaX = e.clientX - dragStartX;
  const deltaY = e.clientY - dragStartY;
  let newX = panelStartX + deltaX;
  let newY = panelStartY + deltaY;
  const panelRect = floatingPanel.getBoundingClientRect();
  newX = Math.max(0, Math.min(newX, window.innerWidth - panelRect.width));
  newY = Math.max(0, Math.min(newY, window.innerHeight - panelRect.height));
  floatingPanel.style.left = newX + 'px';
  floatingPanel.style.top = newY + 'px';
  floatingPanel.style.right = 'auto';
});

document.addEventListener('mouseup', () => {
  if (isDragging) { isDragging = false; panelHeader.style.cursor = 'move'; }
});

// =============================
// 패널 토글
// =============================

function showPanel() { floatingPanel.classList.remove('hidden'); }
function hidePanel() { floatingPanel.classList.add('hidden'); }

layerPanelToggle.addEventListener('click', () => {
  floatingPanel.classList.contains('hidden') ? showPanel() : hidePanel();
});
panelClose.addEventListener('click', hidePanel);

// =============================
// 화면 전환
// =============================

function showListScreen() {
  saveCurrentMemo();
  listScreen.classList.remove('hidden');
  editorScreen.classList.add('hidden');
  hidePanel();
  renderMemoList();
}

function showEditorScreen() {
  listScreen.classList.add('hidden');
  editorScreen.classList.remove('hidden');
}

// =============================
// 메모 CRUD
// =============================

function createMemo() {
  const memo = {
    id: `memo-${Date.now()}`,
    title: '',
    content: '',
    layers: JSON.parse(JSON.stringify(state.layers)),
    activeLayerId: state.activeLayerId,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  state.memos.unshift(memo);
  state.currentMemoId = memo.id;
  saveMemos();
  openMemo(memo.id);
}

function openMemo(memoId) {
  const memo = state.memos.find(m => m.id === memoId);
  if (!memo) return;
  state.currentMemoId = memoId;
  state.layers = JSON.parse(JSON.stringify(memo.layers));
  state.activeLayerId = memo.activeLayerId;
  memoTitle.value = memo.title;
  editor.innerHTML = memo.content;
  showEditorScreen();
  renderLayers();
  updateLayerStyles();
  updateLayerVisibility();
  updateCounts();
  const radio = document.querySelector(`input[name="displayMode"][value="${state.displayMode}"]`);
  if (radio) radio.checked = true;
}

function saveCurrentMemo() {
  if (!state.currentMemoId) return;
  const memo = state.memos.find(m => m.id === state.currentMemoId);
  if (!memo) return;
  memo.title = memoTitle.value;
  memo.content = editor.innerHTML;
  memo.layers = JSON.parse(JSON.stringify(state.layers));
  memo.activeLayerId = state.activeLayerId;
  memo.updatedAt = Date.now();
  saveMemos();
}

function deleteMemo(memoId, e) {
  e.stopPropagation();
  if (!confirm('이 메모를 삭제할까요?')) return;
  state.memos = state.memos.filter(m => m.id !== memoId);
  saveMemos();
  renderMemoList();
}

function renderMemoList() {
  if (state.memos.length === 0) {
    memoList.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">note_stack</span><p>메모가 없습니다</p></div>`;
    return;
  }
  memoList.innerHTML = state.memos.map(memo => {
    const preview = memo.content.replace(/<[^>]*>/g, '').slice(0, 100);
    const date = new Date(memo.updatedAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
    const c = memo.layers[0]?.color || '#94a3b8';
    return `<div class="memo-card" data-id="${memo.id}"><div class="memo-card-indicator" style="background:${c}"></div><div class="memo-card-body"><div class="memo-card-header"><h3 class="memo-card-title">${memo.title||'제목 없음'}</h3><button class="memo-card-delete" data-id="${memo.id}"><span class="material-symbols-outlined">delete</span></button></div><p class="memo-card-preview">${preview||'내용 없음'}</p><div class="memo-card-footer"><span class="memo-card-date">${date}</span><span class="memo-card-dot" style="background:${c}"></span></div></div></div>`;
  }).join('');
}

// =============================
// 히스토리 (Undo/Redo)
// =============================

function saveHistory() {
  history.undoStack.push({ layers: JSON.parse(JSON.stringify(state.layers)), activeLayerId: state.activeLayerId, content: editor.innerHTML });
  if (history.undoStack.length > history.maxSize) history.undoStack.shift();
  history.redoStack = [];
}

function undo() {
  if (history.undoStack.length === 0) return;
  history.redoStack.push({ layers: JSON.parse(JSON.stringify(state.layers)), activeLayerId: state.activeLayerId, content: editor.innerHTML });
  const prev = history.undoStack.pop();
  state.layers = prev.layers; state.activeLayerId = prev.activeLayerId; editor.innerHTML = prev.content;
  renderLayers(); updateLayerStyles(); updateLayerVisibility(); updateCounts(); saveCurrentMemo();
}

function redo() {
  if (history.redoStack.length === 0) return;
  history.undoStack.push({ layers: JSON.parse(JSON.stringify(state.layers)), activeLayerId: state.activeLayerId, content: editor.innerHTML });
  const next = history.redoStack.pop();
  state.layers = next.layers; state.activeLayerId = next.activeLayerId; editor.innerHTML = next.content;
  renderLayers(); updateLayerStyles(); updateLayerVisibility(); updateCounts(); saveCurrentMemo();
}

// =============================
// 레이어 스타일링
// =============================

// 모든 레이어 span에 색상 스타일 적용
// 주의: 서식 툴바로 적용된 인라인 스타일(bold, italic 등)은 보존
function updateLayerStyles() {
  const spans = editor.querySelectorAll('.layer-text');
  spans.forEach(span => {
    const layerId = span.dataset.layer;                                 // 레이어 ID
    const layer = state.layers.find(l => l.id === layerId);             // 레이어 객체 검색
    if (!layer || !layer.color) return;                                 // 없으면 건너뜀
    const hex = layer.color.replace('#', '');                           // HEX → RGB 변환
    const r = parseInt(hex.slice(0, 2), 16) || 0;                      // Red
    const g = parseInt(hex.slice(2, 4), 16) || 0;                      // Green
    const b = parseInt(hex.slice(4, 6), 16) || 0;                      // Blue
    if (layer.colorMode === 'highlight') {
      span.style.backgroundColor = `rgba(${r},${g},${b},0.25)`;        // 배경색
      span.style.color = '#334155';                                     // 글자색 기본
    } else {
      span.style.backgroundColor = 'transparent';                       // 배경 투명
      span.style.color = layer.color;                                   // 글자색을 레이어색으로
    }
  });
}

// 레이어 가시성 업데이트
function updateLayerVisibility() {
  const spans = editor.querySelectorAll('.layer-text');
  spans.forEach(span => {
    const layerId = span.dataset.layer;                                 // 레이어 ID
    const layer = state.layers.find(l => l.id === layerId);             // 레이어 검색
    if (!layer) return;
    if (!layer.visible) {
      if (state.displayMode === 'collapse') { span.style.display = 'none'; }     // 완전 숨김
      else { span.style.visibility = 'hidden'; }                                  // 공간 유지 숨김
    } else {
      span.style.display = '';                                          // 보임
      span.style.visibility = '';                                       // 보임
    }
  });
}

// =============================
// 레이어 관리
// =============================

function renderLayers() {
  layerList.innerHTML = state.layers.map(layer => {
    const isActive = layer.id === state.activeLayerId; // 활성 레이어 여부
    // 레이어 이름 input은 readonly로 설정
    return `<div class="layer-item ${isActive?'active':''}" data-id="${layer.id}">
      <button class="layer-toggle ${!layer.visible?'hidden-layer':''}" data-id="${layer.id}">
        <span class="material-symbols-outlined">${layer.visible?'visibility':'visibility_off'}</span>
      </button>
      <input type="color" class="layer-color layer-color-picker" value="${layer.color}" data-id="${layer.id}"/>
      <input type="text" class="layer-name" value="${layer.name}" data-id="${layer.id}" readonly/>
      <button class="layer-mode-btn ${layer.colorMode==='text'?'text-mode':''} layer-mode" data-id="${layer.id}">
        ${layer.colorMode==='highlight'?'BG':'TXT'}
      </button>
    </div>`;
  }).join('');
}

function addLayer() {
  const ci = state.layers.length % state.defaultColors.length;         // 색상 순환 인덱스
  const nl = { id: `layer-${Date.now()}`, name: `레이어 ${state.layers.length+1}`, color: state.defaultColors[ci], visible: true, colorMode: 'highlight' };
  state.layers.push(nl);
  state.activeLayerId = nl.id;
  renderLayers(); saveCurrentMemo();
}

function deleteLayer(layerId) {
  state.layers = state.layers.filter(l => l.id !== layerId);
  if (state.activeLayerId === layerId && state.layers.length > 0) state.activeLayerId = state.layers[0].id;
  const fallback = state.layers[0]?.id;
  editor.querySelectorAll(`.layer-text[data-layer="${layerId}"]`).forEach(span => {
    if (fallback) { span.dataset.layer = fallback; }                    // 대체 레이어로 이전
    else { span.parentNode.replaceChild(document.createTextNode(span.textContent), span); }
  });
  renderLayers(); updateLayerStyles(); updateLayerVisibility(); saveCurrentMemo();
}

function toggleLayerVisibility(layerId) {
  const layer = state.layers.find(l => l.id === layerId);
  if (!layer) return;
  layer.visible = !layer.visible;
  renderLayers(); updateLayerVisibility(); saveCurrentMemo();
}

function toggleLayerColorMode(layerId) {
  const layer = state.layers.find(l => l.id === layerId);
  if (!layer) return;
  layer.colorMode = layer.colorMode === 'highlight' ? 'text' : 'highlight';
  renderLayers(); updateLayerStyles(); saveCurrentMemo();
}

// =============================
// 레이어 적용 (핵심 로직)
// =============================

// 선택 영역에 레이어 적용
function applyLayerToSelection(layerId) {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return false;                 // 선택 없으면 종료
  applyLayerToRange(layerId, sel.getRangeAt(0));
  return true;
}

// Range에 레이어 적용 - extractContents 기반
// extractContents가 DOM에서 내용을 제거한 후 Fragment로 반환하므로
// 노드 참조 문제 없이 안전하게 처리 가능
function applyLayerToRange(layerId, range) {
  const layer = state.layers.find(l => l.id === layerId);
  if (!layer) return;
  saveHistory();                                                        // 변경 전 상태 저장

  const extracted = range.extractContents();                            // 선택 내용 추출
  const reassigned = reassignFragmentToLayer(extracted, layerId);       // 레이어 재할당
  range.insertNode(reassigned);                                         // 원래 위치에 삽입

  normalizeEditor();                                                    // 정규화
  updateLayerStyles();                                                  // 스타일
  updateLayerVisibility();                                              // 가시성
  updateCounts();                                                       // 글자수
  saveCurrentMemo();                                                    // 저장
}

// Fragment 내 모든 텍스트를 지정 레이어로 재할당
function reassignFragmentToLayer(fragment, layerId) {
  const result = document.createDocumentFragment();
  Array.from(fragment.childNodes).forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) {
      // naked 텍스트 → 대상 레이어로 감싸기
      if (child.textContent) result.appendChild(createLayerSpan(layerId, child.textContent));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      if (child.classList && child.classList.contains('layer-text')) {
        // 기존 layer-text span → 내부를 대상 레이어로 교체
        Array.from(child.childNodes).forEach(inner => {
          if (inner.nodeType === Node.TEXT_NODE) {
            if (inner.textContent) result.appendChild(createLayerSpan(layerId, inner.textContent));
          } else if (inner.tagName === 'BR') {
            result.appendChild(inner.cloneNode());                      // BR 유지
          } else if (inner.classList && inner.classList.contains('layer-text')) {
            if (inner.textContent) result.appendChild(createLayerSpan(layerId, inner.textContent));
          } else {
            if (inner.textContent) result.appendChild(createLayerSpan(layerId, inner.textContent));
          }
        });
      } else if (child.tagName === 'BR') {
        result.appendChild(child.cloneNode());                          // BR 유지
      } else {
        // 기타 요소 (div 등) → 재귀 처리
        result.appendChild(reassignFragmentToLayer(child, layerId));
      }
    }
  });
  return result;
}

// 레이어 span 생성 헬퍼
function createLayerSpan(layerId, text) {
  const span = document.createElement('span');
  span.className = 'layer-text';
  span.dataset.layer = layerId;
  span.textContent = text;
  return span;
}

// =============================
// 정규화: 중첩 해소, naked 텍스트 감싸기, 빈 span 제거, 인접 병합
// =============================

function normalizeEditor() {
  flattenNestedSpans();                                                 // 중첩 평탄화
  wrapNakedTextNodes();                                                 // naked 텍스트 감싸기
  removeEmptySpans();                                                   // 빈 span 제거
  mergeAdjacentLayers();                                                // 인접 병합
}

// 중첩된 layer-text 평탄화 (자식 레이어 우선)
function flattenNestedSpans() {
  let nested = editor.querySelector('.layer-text .layer-text');
  let safety = 0;
  while (nested && safety < 500) {
    safety++;
    const parent = nested.parentElement.closest('.layer-text');
    if (!parent) break;
    const parentLayerId = parent.dataset.layer;
    const frag = document.createDocumentFragment();
    Array.from(parent.childNodes).forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.textContent) frag.appendChild(createLayerSpan(parentLayerId, child.textContent));
      } else if (child.classList && child.classList.contains('layer-text')) {
        const cid = child.dataset.layer;                                // 자식 레이어 ID
        Array.from(child.childNodes).forEach(inner => {
          if (inner.nodeType === Node.TEXT_NODE) {
            if (inner.textContent) frag.appendChild(createLayerSpan(cid, inner.textContent));
          } else if (inner.tagName === 'BR') {
            frag.appendChild(inner.cloneNode());
          } else {
            if (inner.textContent) frag.appendChild(createLayerSpan(cid, inner.textContent));
          }
        });
      } else if (child.tagName === 'BR') {
        frag.appendChild(child.cloneNode());
      } else {
        if (child.textContent) frag.appendChild(createLayerSpan(parentLayerId, child.textContent));
      }
    });
    parent.parentNode.replaceChild(frag, parent);
    nested = editor.querySelector('.layer-text .layer-text');
  }
}

// 에디터 직접 자식 중 naked 텍스트를 활성 레이어로 감싸기
// UL, OL, LI 등 블록 요소는 보존
function wrapNakedTextNodes() {
  Array.from(editor.childNodes).forEach(node => {
    if (node.nodeType === Node.TEXT_NODE && node.textContent) {
      // naked 텍스트 노드 → 레이어 span으로 감싸기
      node.parentNode.replaceChild(createLayerSpan(state.activeLayerId, node.textContent), node);
    } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'DIV' && !node.classList.contains('layer-text')) {
      if (node.style.textAlign) {
        // 정렬 DIV — 보존하되 내부 naked 텍스트만 감싸기
        Array.from(node.childNodes).forEach(child => {
          if (child.nodeType === Node.TEXT_NODE && child.textContent) {
            child.parentNode.replaceChild(createLayerSpan(state.activeLayerId, child.textContent), child);
          }
        });
      } else {
        // 일반 DIV — 자식 노드 추출 (기존 레이어 span 보존)
        if (node.textContent) {
          const frag = document.createDocumentFragment();
          frag.appendChild(document.createElement('br'));
          Array.from(node.childNodes).forEach(child => {
            if (child.nodeType === Node.TEXT_NODE && child.textContent) {
              frag.appendChild(createLayerSpan(state.activeLayerId, child.textContent));
            } else {
              frag.appendChild(child.cloneNode(true));
            }
          });
          node.parentNode.replaceChild(frag, node);
        } else { node.remove(); }
      }
    }
    // UL, OL 등 리스트 블록 요소는 그대로 유지
  });
}

// 빈 span 제거 (텍스트, BR, 제로폭공백 모두 없는 것만)
function removeEmptySpans() {
  editor.querySelectorAll('.layer-text').forEach(span => {
    if (!span.textContent.trim() && !span.querySelector('br') && !span.textContent.includes('\u200B')) {
      span.remove();
    }
  });
}

// 인접한 같은 레이어 span 병합
function mergeAdjacentLayers() {
  let merged = true, safety = 0;
  while (merged && safety < 200) {
    merged = false; safety++;
    const spans = Array.from(editor.querySelectorAll('.layer-text'));
    for (let i = 0; i < spans.length - 1; i++) {
      const cur = spans[i], nxt = spans[i + 1];
      if (nxt && cur.dataset.layer === nxt.dataset.layer && cur.nextSibling === nxt) {
        while (nxt.firstChild) cur.appendChild(nxt.firstChild);         // 자식 이동
        nxt.remove();                                                   // 빈 span 제거
        merged = true; break;                                           // 처음부터 다시
      }
    }
  }
}

// =============================
// 통계
// =============================

function updateCounts() {
  const text = (editor.textContent || '').replace(/\u200B/g, '');       // 제로폭 공백 제거
  charCount.textContent = text.length;                                  // 글자수
  wordCount.textContent = text.trim() ? text.trim().split(/\s+/).length : 0;  // 단어수
}

// =============================
// localStorage
// =============================

function saveMemos() { localStorage.setItem('layerMemos', JSON.stringify(state.memos)); }
function loadMemos() { const s = localStorage.getItem('layerMemos'); if (s) state.memos = JSON.parse(s); }

// =============================
// Enter 키 처리
// =============================

editor.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return; // 엔터 키만 처리
  
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  
  const range = selection.getRangeAt(0);
  let node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode; // 텍스트 노드면 부모로
  
  // 리스트(UL, OL) 안에 있는지 확인
  const inList = node.closest('ul, ol, li');
  if (inList) {
    // 리스트 안에서는 기본 동작 허용 (새 항목 생성)
    // 하지만 레이어는 유지해야 함
    const layerSpan = node.closest('.layer-text');
    const currentLayerId = layerSpan ? layerSpan.dataset.layer : state.activeLayerId;
    
    // 기본 동작 허용
    setTimeout(() => {
      // 새로 생성된 모든 LI 항목들의 텍스트를 레이어로 감싸기
      const listItems = inList.closest('ul, ol').querySelectorAll('li');
      
      listItems.forEach(li => {
        // LI 안의 naked 텍스트 노드를 찾아 레이어로 감싸기
        const textNodes = [];
        const walker = document.createTreeWalker(
          li,
          NodeFilter.SHOW_TEXT,
          null,
          false
        );
        
        let textNode;
        while (textNode = walker.nextNode()) {
          textNodes.push(textNode);
        }
        
        textNodes.forEach(tn => {
          const parent = tn.parentNode;
          // 이미 layer-text 안에 있으면 스킵
          if (parent.classList && parent.classList.contains('layer-text')) {
            return;
          }
          
          // 빈 텍스트 노드도 레이어로 감싸기 (커서 위치 확보)
          const text = tn.textContent || '\u200B';
          const layerSpan = createLayerSpan(currentLayerId, text);
          parent.replaceChild(layerSpan, tn);
        });
        
        // 텍스트 노드가 없는 빈 LI도 레이어 span 추가
        if (textNodes.length === 0 && !li.querySelector('.layer-text')) {
          const emptySpan = createLayerSpan(currentLayerId, '\u200B');
          li.appendChild(emptySpan);
        }
      });
      
      // 커서를 새 span으로 이동
      const sel = window.getSelection();
      if (sel.rangeCount) {
        const currentNode = sel.anchorNode;
        const newSpan = currentNode.closest ? currentNode.closest('.layer-text') : 
                        currentNode.parentElement?.querySelector('.layer-text');
        
        if (newSpan) {
          const range = document.createRange();
          range.setStart(newSpan.firstChild || newSpan, 0);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
      
      updateLayerStyles();
      updateLayerVisibility();
      updateCounts();
      saveCurrentMemo();
    }, 10);
    return; // 기본 동작 허용
  }
  
  // 리스트가 아닌 경우 기존 로직 실행
  e.preventDefault();

  const layerSpan = node.closest('.layer-text'); // 현재 span
  const currentLayerId = layerSpan ? layerSpan.dataset.layer : state.activeLayerId; // 현재 레이어 유지

  if (layerSpan) {
    // layer-text 안에서 Enter
    const textNode = range.startContainer;
    if (textNode.nodeType === Node.TEXT_NODE) {
      const offset = range.startOffset;
      const fullText = textNode.textContent;
      const beforeText = fullText.slice(0, offset); // 커서 이전
      const afterText = fullText.slice(offset); // 커서 이후
      const currentLayerId = layerSpan.dataset.layer;

      // 이후 형제 노드 수집
      const afterSiblings = [];
      let sib = textNode.nextSibling;
      while (sib) { afterSiblings.push(sib); sib = sib.nextSibling; }

      // 커서 이전 텍스트만 남기기
      textNode.textContent = beforeText;

      // BR 삽입
      const br = document.createElement('br');
      layerSpan.parentNode.insertBefore(br, layerSpan.nextSibling);

      // 이후 텍스트+형제가 있으면 기존 레이어 span으로
      if (afterText || afterSiblings.length > 0) {
        const remainSpan = document.createElement('span');
        remainSpan.className = 'layer-text';
        remainSpan.dataset.layer = currentLayerId;
        if (afterText) remainSpan.appendChild(document.createTextNode(afterText));
        afterSiblings.forEach(s => remainSpan.appendChild(s));
        br.parentNode.insertBefore(remainSpan, br.nextSibling);
      }

      // 새 줄도 현재 레이어 유지
      const newLineSpan = createLayerSpan(currentLayerId, '\u200B'); // 활성 레이어가 아닌 현재 레이어로
      const afterBr = br.nextSibling;
      if (afterBr && afterBr.classList && afterBr.classList.contains('layer-text')) {
        afterBr.parentNode.insertBefore(newLineSpan, afterBr);          // remainSpan 앞에
      } else {
        br.parentNode.insertBefore(newLineSpan, br.nextSibling);       // BR 뒤에
      }

      // 커서 이동
      const nr = document.createRange();
      nr.setStart(newLineSpan.firstChild, 0);
      nr.collapse(true);
      selection.removeAllRanges();
      selection.addRange(nr);
    } else {
      // 텍스트 노드가 아닌 경우
      const br = document.createElement('br');
      const ns = createLayerSpan(currentLayerId, '\u200B'); // 현재 레이어 유지
      layerSpan.parentNode.insertBefore(br, layerSpan.nextSibling);
      br.parentNode.insertBefore(ns, br.nextSibling);
      const nr = document.createRange();
      nr.setStart(ns.firstChild, 0); 
      nr.collapse(true);
      selection.removeAllRanges(); selection.addRange(nr);
    }
  } else {
    // layer-text 밖에서 Enter
    const br = document.createElement('br');
    const ns = createLayerSpan(currentLayerId, '\u200B'); // 현재 또는 활성 레이어
    range.deleteContents();
    range.insertNode(br);
    br.parentNode.insertBefore(ns, br.nextSibling);
    const nr = document.createRange();
    nr.setStart(ns.firstChild, 0); 
    nr.collapse(true);
    selection.removeAllRanges(); 
    selection.addRange(nr);
  }

  removeEmptySpans(); 
  mergeAdjacentLayers();
  updateLayerStyles(); 
  updateLayerVisibility(); 
  updateCounts(); 
  saveCurrentMemo();
});

// =============================
// 텍스트 입력 처리 (beforeinput)
// 핵심 수정: 활성 레이어와 다른 span 안에서 입력 시
// 기존 span을 분할하고 새 활성 레이어 span 삽입
// =============================

editor.addEventListener('beforeinput', e => {
  if (e.inputType !== 'insertText') return;                             // 텍스트 입력만

  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  let node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;

  const inLayerSpan = node.closest('.layer-text');                      // 현재 span

  if (inLayerSpan) {
    // === 같은 레이어 → 기본 동작 허용 ===
    if (inLayerSpan.dataset.layer === state.activeLayerId) {
      // 제로폭 공백만 있으면 비우기
      if (inLayerSpan.textContent === '\u200B') {
        inLayerSpan.textContent = '';
        const nr = document.createRange();
        nr.setStart(inLayerSpan, 0); nr.collapse(true);
        selection.removeAllRanges(); selection.addRange(nr);
      }
      return;                                                           // 브라우저 기본 입력
    }

    // === 다른 레이어 → span 분할 후 활성 레이어 삽입 ===
    e.preventDefault();
    const textNode = range.startContainer;
    const currentLayerId = inLayerSpan.dataset.layer;

    if (textNode.nodeType === Node.TEXT_NODE) {
      const offset = range.startOffset;
      const fullText = textNode.textContent;
      const beforeText = fullText.slice(0, offset);
      const afterText = fullText.slice(offset);

      // 이후 형제 수집
      const afterSiblings = [];
      let sib = textNode.nextSibling;
      while (sib) { afterSiblings.push(sib); sib = sib.nextSibling; }

      // [이전(기존)] [입력(활성)] [이후(기존)] 구성
      const frag = document.createDocumentFragment();
      if (beforeText) frag.appendChild(createLayerSpan(currentLayerId, beforeText));

      const newSpan = createLayerSpan(state.activeLayerId, e.data);     // 입력 문자
      frag.appendChild(newSpan);

      if (afterText || afterSiblings.length > 0) {
        const afterSpan = document.createElement('span');
        afterSpan.className = 'layer-text';
        afterSpan.dataset.layer = currentLayerId;
        if (afterText) afterSpan.appendChild(document.createTextNode(afterText));
        afterSiblings.forEach(s => afterSpan.appendChild(s));
        frag.appendChild(afterSpan);
      }

      inLayerSpan.parentNode.replaceChild(frag, inLayerSpan);          // 원본 교체

      // 커서를 새 span 끝으로
      const cr = document.createRange();
      cr.selectNodeContents(newSpan); cr.collapse(false);
      selection.removeAllRanges(); selection.addRange(cr);
    } else {
      const newSpan = createLayerSpan(state.activeLayerId, e.data);
      inLayerSpan.parentNode.insertBefore(newSpan, inLayerSpan.nextSibling);
      const cr = document.createRange();
      cr.selectNodeContents(newSpan); cr.collapse(false);
      selection.removeAllRanges(); selection.addRange(cr);
    }

    mergeAdjacentLayers(); updateLayerStyles(); updateCounts(); saveCurrentMemo();
    return;
  }

  // === layer-text 밖에서 입력 ===
  e.preventDefault();
  const newSpan = createLayerSpan(state.activeLayerId, e.data);
  range.deleteContents();
  range.insertNode(newSpan);
  const nr = document.createRange();
  nr.selectNodeContents(newSpan); nr.collapse(false);
  selection.removeAllRanges(); selection.addRange(nr);
  mergeAdjacentLayers(); updateLayerStyles(); updateCounts(); saveCurrentMemo();
});

// =============================
// 한글 IME 조합 처리
// compositionstart: 조합 중 플래그 설정 (normalizeEditor 방지)
// compositionend: 조합 완료 후 잘못된 레이어의 텍스트를 올바른 레이어로 이동
// =============================

editor.addEventListener('compositionstart', () => {
  isComposing = true;
});

editor.addEventListener('compositionend', e => {
  isComposing = false;

  const sel = window.getSelection();
  if (!sel.rangeCount) { normalizeEditor(); updateLayerStyles(); updateCounts(); saveCurrentMemo(); return; }
  const range = sel.getRangeAt(0);
  let node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;

  const inLayerSpan = node.closest('.layer-text');

  // 같은 레이어이거나 레이어 밖이면 정규화만
  if (!inLayerSpan || inLayerSpan.dataset.layer === state.activeLayerId) {
    normalizeEditor(); updateLayerStyles(); updateCounts(); saveCurrentMemo();
    return;
  }

  // 다른 레이어 안에 조합된 텍스트 → 추출하여 활성 레이어로 이동
  const composedText = e.data;
  if (!composedText) { normalizeEditor(); updateLayerStyles(); updateCounts(); saveCurrentMemo(); return; }

  const textNode = range.startContainer;
  if (textNode.nodeType !== Node.TEXT_NODE) { normalizeEditor(); updateLayerStyles(); updateCounts(); saveCurrentMemo(); return; }

  const cursorOffset = range.startOffset;
  const fullText = textNode.textContent;
  const compEnd = cursorOffset;
  const compStart = compEnd - composedText.length;
  if (compStart < 0) { normalizeEditor(); updateLayerStyles(); updateCounts(); saveCurrentMemo(); return; }

  const beforeText = fullText.slice(0, compStart);
  const afterText = fullText.slice(compEnd);
  const currentLayerId = inLayerSpan.dataset.layer;

  const afterSiblings = [];
  let sib = textNode.nextSibling;
  while (sib) { afterSiblings.push(sib); sib = sib.nextSibling; }

  const frag = document.createDocumentFragment();
  if (beforeText) frag.appendChild(createLayerSpan(currentLayerId, beforeText));

  const newSpan = createLayerSpan(state.activeLayerId, composedText);
  frag.appendChild(newSpan);

  if (afterText || afterSiblings.length > 0) {
    const afterSpan = document.createElement('span');
    afterSpan.className = 'layer-text';
    afterSpan.dataset.layer = currentLayerId;
    if (afterText) afterSpan.appendChild(document.createTextNode(afterText));
    afterSiblings.forEach(s => afterSpan.appendChild(s));
    frag.appendChild(afterSpan);
  }

  inLayerSpan.parentNode.replaceChild(frag, inLayerSpan);

  // 커서를 새 span 끝으로
  const cr = document.createRange();
  cr.selectNodeContents(newSpan);
  cr.collapse(false);
  sel.removeAllRanges();
  sel.addRange(cr);

  normalizeEditor(); updateLayerStyles(); updateCounts(); saveCurrentMemo();
});

// =============================
// 붙여넣기
// =============================

editor.addEventListener('paste', e => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  if (!text) return;
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const tid = state.activeLayerId;                                      // 활성 레이어로
  const lines = text.split('\n');
  const frag = document.createDocumentFragment();
  lines.forEach((line, i) => {
    if (i > 0) frag.appendChild(document.createElement('br'));
    if (line) frag.appendChild(createLayerSpan(tid, line));
  });
  range.deleteContents();
  range.insertNode(frag);
  range.collapse(false);
  selection.removeAllRanges(); selection.addRange(range);
  normalizeEditor(); updateLayerStyles(); updateLayerVisibility(); updateCounts(); saveCurrentMemo();
});

// =============================
// 컨텍스트 메뉴 (우클릭)
// =============================

function showContextMenu(x, y) {
  contextMenuItems.innerHTML = state.layers.map(l =>
    `<div class="context-menu-item" data-layer-id="${l.id}"><span class="layer-dot" style="background:${l.color}"></span><span>${l.name}</span></div>`
  ).join('');
  const mw = 160, mh = state.layers.length * 40 + 40;
  let px = x, py = y;
  if (x + mw > window.innerWidth) px = window.innerWidth - mw - 10;
  if (y + mh > window.innerHeight) py = window.innerHeight - mh - 10;
  layerContextMenu.style.left = px + 'px';
  layerContextMenu.style.top = py + 'px';
  layerContextMenu.classList.remove('hidden');
}

function hideContextMenu() { layerContextMenu.classList.add('hidden'); savedSelection = null; }

editor.addEventListener('contextmenu', e => {
  const sel = window.getSelection();
  if (sel.rangeCount && !sel.isCollapsed) {
    e.preventDefault();
    savedSelection = sel.getRangeAt(0).cloneRange();
    showContextMenu(e.clientX, e.clientY);
  }
});

layerContextMenu.addEventListener('mousedown', e => e.preventDefault());

contextMenuItems.addEventListener('click', e => {
  const item = e.target.closest('.context-menu-item');
  if (!item || !savedSelection) return;
  applyLayerToRange(item.dataset.layerId, savedSelection.cloneRange());
  savedSelection = null;
  hideContextMenu();
});

document.addEventListener('mousedown', e => {
  if (!layerContextMenu.contains(e.target) && !layerContextMenu.classList.contains('hidden')) hideContextMenu();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideContextMenu(); });

// =============================
// 이벤트 리스너
// =============================

memoList.addEventListener('click', e => {
  const del = e.target.closest('.memo-card-delete');
  const card = e.target.closest('.memo-card');
  if (del) deleteMemo(del.dataset.id, e);
  else if (card) openMemo(card.dataset.id);
});

newMemoFab.addEventListener('click', createMemo); // FAB 버튼으로 새 메모 생성
backBtn.addEventListener('click', showListScreen); // 뒤로가기 버튼
memoTitle.addEventListener('input', saveCurrentMemo); // 제목 변경 시 저장

// 에디터 선택 영역 저장 변수 (레이어 적용용)
let editorSelection = null;

// 에디터에서 선택이 변경될 때마다 저장
editor.addEventListener('mouseup', () => {
  const sel = window.getSelection();
  if (sel.rangeCount && !sel.isCollapsed) {
    editorSelection = sel.getRangeAt(0).cloneRange(); // 선택 영역 복사
  }
});

// 키보드로 선택할 때도 저장
editor.addEventListener('keyup', () => {
  const sel = window.getSelection();
  if (sel.rangeCount && !sel.isCollapsed) {
    editorSelection = sel.getRangeAt(0).cloneRange(); // 선택 영역 복사
  }
});

// 에디터에서 선택 해제 시 저장된 선택도 유지 (5초간)
let selectionTimeout = null;
editor.addEventListener('blur', () => {
  // blur 시에도 선택 유지
  if (selectionTimeout) clearTimeout(selectionTimeout);
  selectionTimeout = setTimeout(() => {
    editorSelection = null;
  }, 5000); // 5초 후 초기화
});

layerList.addEventListener('mousedown', e => {
  const toggle = e.target.closest('.layer-toggle'); // 토글 버튼
  const color = e.target.closest('.layer-color'); // 색상 선택
  const mode = e.target.closest('.layer-mode'); // 모드 버튼
  const name = e.target.closest('.layer-name'); // 이름 입력
  const item = e.target.closest('.layer-item'); // 레이어 항목
  
  if (toggle) { 
    e.preventDefault(); 
    toggleLayerVisibility(toggle.dataset.id); // 가시성 토글
    return; 
  }
  if (mode) { 
    e.preventDefault(); 
    toggleLayerColorMode(mode.dataset.id); // 색상 모드 토글
    return; 
  }
  if (color) return; // 색상 선택은 클릭 무시
  // readonly 상태의 이름 클릭은 레이어 전환으로 동작 (편집 모드가 아닐 때)
  if (name && name.hasAttribute('readonly')) {
    // readonly이면 레이어 전환 처리로 통과시킴 (아래 item 로직에서 처리)
  } else if (name) {
    return; // 편집 모드(readonly 아닌 상태)에서는 클릭 무시
  }
  
  if (item) {
    e.preventDefault(); // 기본 동작 방지
    const lid = item.dataset.id; // 레이어 ID
    
    // 저장된 선택 영역이 있으면 사용
    if (editorSelection) {
      try {
        // 선택 영역 복원
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(editorSelection.cloneRange());
        
        // 레이어 적용
        applyLayerToRange(lid, editorSelection.cloneRange());
        
        // 선택 영역 유지
        sel.removeAllRanges();
        sel.addRange(editorSelection.cloneRange());
      } catch (e) {
        console.log('Selection error:', e);
      }
    }
    
    state.activeLayerId = lid; // 활성 레이어 변경
    renderLayers(); 
    saveCurrentMemo();
    
    // 에디터에 포커스 복원
    setTimeout(() => {
      editor.focus();
      if (editorSelection) {
        try {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(editorSelection.cloneRange());
        } catch (e) {}
      }
    }, 10);
  }
});

// 레이어 이름 더블클릭으로 편집 모드 진입
layerList.addEventListener('dblclick', e => {
  const name = e.target.closest('.layer-name'); // 이름 input
  if (name) {
    name.removeAttribute('readonly'); // readonly 제거
    name.focus(); // 포커스
    name.select(); // 전체 선택
  }
});

// 레이어 이름 입력 완료 시 readonly 복원
layerList.addEventListener('blur', e => {
  const name = e.target.closest('.layer-name'); // 이름 input
  if (name && !name.hasAttribute('readonly')) {
    name.setAttribute('readonly', 'readonly'); // readonly 복원
  }
}, true); // capture 단계에서 처리

layerList.addEventListener('change', e => {
  if (e.target.classList.contains('layer-name')) {
    const l = state.layers.find(l => l.id === e.target.dataset.id); // 레이어 찾기
    if (l) {
      l.name = e.target.value || '레이어'; // 이름 변경
      e.target.setAttribute('readonly', 'readonly'); // readonly 복원
      saveCurrentMemo(); // 저장
    }
  }
  if (e.target.classList.contains('layer-color')) {
    const l = state.layers.find(l => l.id === e.target.dataset.id); // 레이어 찾기
    if (l) {
      l.color = e.target.value; // 색상 변경
      updateLayerStyles(); // 스타일 업데이트
      updateLayerVisibility(); // 가시성 업데이트
      saveCurrentMemo(); // 저장
    }
  }
});

// 색상 피커 드래그 중 실시간 반영 (input 이벤트)
layerList.addEventListener('input', e => {
  if (e.target.classList.contains('layer-color')) {
    const l = state.layers.find(l => l.id === e.target.dataset.id);
    if (l) {
      l.color = e.target.value;
      updateLayerStyles();
      updateLayerVisibility();
    }
  }
});

layerList.addEventListener('contextmenu', e => {
  const item = e.target.closest('.layer-item');
  if (item) { e.preventDefault(); if (state.layers.length > 1 && confirm('이 레이어를 삭제할까요?')) deleteLayer(item.dataset.id); }
});

addLayerBtn.addEventListener('click', addLayer);

document.querySelectorAll('input[name="displayMode"]').forEach(r => {
  r.addEventListener('change', e => { state.displayMode = e.target.value; updateLayerVisibility(); saveCurrentMemo(); });
});

editor.addEventListener('input', () => {
  if (!isComposing) normalizeEditor();  // 조합 중에는 정규화 건너뛰기
  updateLayerStyles(); updateCounts(); saveCurrentMemo();
});

// =============================
// 초기화
// =============================

loadMemos();
renderMemoList();
showListScreen();