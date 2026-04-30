/**
 * editor_core.js — 编辑器核心逻辑（全功能版）
 */
const Editor = (() => {
  let currentFile = null;
  let currentFileUrl = null;
  let currentSlideIndex = 0;
  let totalSlides = 0;
  let isDirty = false;
  let slidesData = [];
  let autoSaveTimer = null;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ========== 初始化 ==========
  function init() {
    EditorBridge.init($('#preview-iframe'));
    bindToolbar();
    bindRightTabs();
    bindCompPanel();
    bindKeyboard();
    bindMessageListener();
    bindDragDrop();
    fitPreview();
    window.addEventListener('resize', fitPreview);
    startAutoSave();
  }

  // ========== 工具栏绑定 ==========
  function bindToolbar() {
    $('#btn-open').onclick = openFileNative;
    $('#btn-new').onclick = createNewPresentation;
    $('#btn-save').onclick = saveFile;
    $('#btn-export').onclick = exportHTML;
    $('#btn-undo').onclick = () => EditorBridge.undo();
    $('#btn-redo').onclick = () => EditorBridge.redo();
    $('#btn-add-slide').onclick = addSlide;
    $('#btn-dup-slide').onclick = duplicateSlide;
    $('#btn-del-slide').onclick = deleteSlide;
    $('#btn-insert-img').onclick = () => $('#img-input').click();
    $('#btn-play').onclick = playPresentation;
    $('#btn-tts').onclick = toggleTTS;
    $('#btn-theme').onclick = toggleTheme;
    $('#btn-help').onclick = toggleShortcuts;
    $('#img-input').onchange = handleImageUpload;
    $('#html-input').onchange = handleHtmlFileSelect;
    $('#tts-play-btn').onclick = toggleTTS;
    $('#notes-editor').oninput = onNotesChange;
    $('#btn-browse-disk').onclick = () => { $('#modal-open').classList.add('hidden'); openFileNative(); };
  }

  // ========== 右侧面板切换 ==========
  function bindRightTabs() {
    $$('.right-tab').forEach(tab => {
      tab.onclick = () => {
        $$('.right-tab').forEach(t => t.classList.remove('active'));
        $$('.right-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        $(`#panel-${tab.dataset.panel}`).classList.add('active');
      };
    });
  }

  // ========== 键盘快捷键 ==========
  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveFile(); }
      if (e.ctrlKey && e.key === 'o') { e.preventDefault(); openFileNative(); }
      if (e.key === 'F5') { e.preventDefault(); playPresentation(); }
      if (e.key === '?' && !e.ctrlKey && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault(); toggleShortcuts();
      }
      if (e.key === 't' && !e.ctrlKey && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault(); toggleTTS();
      }
      // Esc 关闭弹窗
      if (e.key === 'Escape') {
        $('#shortcuts-overlay')?.classList.add('hidden');
        $('#modal-open')?.classList.add('hidden');
      }
    });
  }

  // ========== postMessage 监听 ==========
  function bindMessageListener() {
    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (!msg || !msg.type) return;
      switch (msg.type) {
        case 'element-selected': onElementSelected(msg); break;
        case 'text-edited': isDirty = true; updateStatus(); break;
      }
    });
  }

  // ========== 拖放文件 ==========
  function bindDragDrop() {
    const area = document.body;
    area.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('drop-active'); });
    area.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) document.body.classList.remove('drop-active'); });
    area.addEventListener('drop', async (e) => {
      e.preventDefault();
      document.body.classList.remove('drop-active');
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const file = files[0];
      if (file.name.endsWith('.html') || file.name.endsWith('.htm')) {
        await loadHtmlFromFile(file);
      } else if (file.type.startsWith('image/')) {
        const formData = new FormData();
        formData.append('image', file);
        try {
          showLoading();
          const res = await fetch('/api/upload', { method: 'POST', body: formData });
          const data = await res.json();
          if (data.ok) { EditorBridge.insertImage(data.url); isDirty = true; updateStatus(); showToast('图片已插入', 'success'); }
        } catch (err) { showToast('图片上传失败: ' + err.message, 'error'); }
        finally { hideLoading(); }
      }
    });
  }

  // ========== 预览区缩放 ==========
  function fitPreview() {
    const area = $('#preview-area');
    const wrapper = $('#preview-wrapper');
    if (!area || !wrapper) return;
    const scaleX = (area.clientWidth - 40) / 1280;
    const scaleY = (area.clientHeight - 40) / 720;
    const scale = Math.min(scaleX, scaleY, 1);
    wrapper.style.zoom = scale;
    wrapper.style.transform = 'none';
  }

  // ========== Toast 通知 ==========
  function showToast(message, type = 'info', duration = 3000) {
    const container = $('#toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
  }

  // ========== Loading 遮罩 ==========
  function showLoading() { $('#loading-overlay').classList.remove('hidden'); }
  function hideLoading() { $('#loading-overlay').classList.add('hidden'); }

  // ========== 确认对话框 ==========
  function showConfirm(title, message) {
    return new Promise((resolve) => {
      const overlay = $('#confirm-overlay');
      $('#confirm-title').textContent = title;
      $('#confirm-message').textContent = message;
      overlay.classList.remove('hidden');
      const cleanup = (result) => { overlay.classList.add('hidden'); resolve(result); };
      $('#confirm-ok').onclick = () => cleanup(true);
      $('#confirm-cancel').onclick = () => cleanup(false);
    });
  }

  // ========== 快捷键帮助 ==========
  function toggleShortcuts() {
    $('#shortcuts-overlay').classList.toggle('hidden');
  }

  // ========== 自动保存 ==========
  function startAutoSave() {
    autoSaveTimer = setInterval(() => {
      if (isDirty && currentFile) {
        saveFile(true);
      }
    }, 30000);
  }

  // ========== 文件操作 ==========
  async function openFileNative() {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'HTML 文件', accept: { 'text/html': ['.html', '.htm'] } }],
          multiple: false
        });
        const file = await handle.getFile();
        await loadHtmlFromFile(file);
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    // 降级：显示文件浏览器 modal
    openFileModal();
  }

  async function openFileModal() {
    try {
      const res = await fetch('/api/files');
      if (!res.ok) throw new Error('获取文件列表失败');
      const files = await res.json();
      const list = $('#file-list');
      list.innerHTML = '';
      if (files.length === 0) {
        list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--ed-muted)">暂无 HTML 文件，请从磁盘选择</div>';
      }
      files.forEach(f => {
        const item = document.createElement('div');
        item.className = 'file-item';
        const sizeKB = (f.size / 1024).toFixed(0);
        const date = new Date(f.modified).toLocaleString('zh-CN');
        item.innerHTML = `<span class="fi-name">${f.name}</span><span class="fi-meta">${sizeKB}KB · ${date}</span>`;
        item.onclick = () => { loadFile(f.name); $('#modal-open').classList.add('hidden'); };
        list.appendChild(item);
      });
      $('#modal-open').classList.remove('hidden');
      $('#modal-open').onclick = (e) => { if (e.target === $('#modal-open')) $('#modal-open').classList.add('hidden'); };
    } catch (err) {
      showToast('获取文件列表失败: ' + err.message, 'error');
    }
  }

  async function handleHtmlFileSelect() {
    const file = $('#html-input').files[0];
    if (!file) return;
    await loadHtmlFromFile(file);
    $('#html-input').value = '';
  }

  async function loadHtmlFromFile(file) {
    try {
      showLoading();
      const content = await file.text();
      currentFile = file.name;
      currentFileUrl = null;
      $('#file-name').textContent = file.name;
      const res = await fetch('/api/open-remote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, content })
      });
      if (!res.ok) throw new Error('服务端返回错误');
      const data = await res.json();
      if (data.ok) {
        currentFileUrl = data.url;
        addRecentFile(file.name, data.url);
        const iframe = $('#preview-iframe');
        iframe.src = data.url;
        iframe.onload = () => setTimeout(() => refreshSlideList(), 800);
        isDirty = false;
        updateStatus();
        showToast(`已打开: ${file.name}`, 'success');
      }
    } catch (err) {
      showToast('打开文件失败: ' + err.message, 'error');
    } finally {
      hideLoading();
    }
  }

  async function loadFile(name) {
    currentFile = name;
    currentFileUrl = null;
    $('#file-name').textContent = name;
    addRecentFile(name, `/project/${encodeURIComponent(name)}`);
    const iframe = $('#preview-iframe');
    iframe.src = `/project/${encodeURIComponent(name)}`;
    iframe.onload = () => setTimeout(() => refreshSlideList(), 800);
    isDirty = false;
    updateStatus();
    showToast(`已打开: ${name}`, 'success');
  }

  async function saveFile(silent = false) {
    if (!currentFile) return;
    try {
      if (!silent) showLoading();
      const html = EditorBridge.getFullHTML();
      if (!html) return;
      let saveName;
      if (currentFileUrl) {
        // 远程文件：从 URL 提取路径
        saveName = currentFileUrl.startsWith('/') ? currentFileUrl.slice(1) : currentFileUrl;
      } else {
        saveName = currentFile;
      }
      const res = await fetch('/api/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: saveName, content: html })
      });
      if (!res.ok) throw new Error('保存失败');
      isDirty = false;
      updateStatus();
      if (silent) {
        $('#status-text').textContent = '自动保存';
      } else {
        showToast('已保存', 'success');
      }
    } catch (err) {
      showToast('保存失败: ' + err.message, 'error');
    } finally {
      if (!silent) hideLoading();
    }
  }

  function exportHTML() {
    const html = EditorBridge.getFullHTML();
    if (!html) { showToast('没有可导出的内容', 'warn'); return; }
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentFile || 'presentation.html';
    a.click();
    URL.revokeObjectURL(url);
    showToast('已导出', 'success');
  }

  // ========== 新建演示文稿 ==========
  function createNewPresentation() {
    if (isDirty) {
      showConfirm('未保存的更改', '当前文件未保存，确定要新建吗？').then(ok => {
        if (ok) doCreateNew();
      });
    } else {
      doCreateNew();
    }
  }

  async function doCreateNew() {
    const template = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>新建演示文稿</title>
  <style>
    :root { --bg: #0f172a; --text: #e2e8f0; --accent: #38bdf8; --card: #1e293b; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .deck { position: relative; width: 100vw; height: 100vh; overflow: hidden; }
    .slide { position: absolute; inset: 0; display: none; }
    .slide.active { display: flex; }
    .frame { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; padding: 60px; }
    .in { max-width: 960px; text-align: center; }
    h1 { font-size: 48px; margin-bottom: 16px; }
    h2 { font-size: 32px; margin-bottom: 12px; }
    p { font-size: 18px; line-height: 1.8; color: #94a3b8; }
    .notes { display: none; }
  </style>
</head>
<body>
  <main class="deck">
    <section class="slide active" data-chapter="封面">
      <div class="frame"><div class="in">
        <h1>演示文稿标题</h1>
        <p>副标题或描述</p>
      </div></div>
      <aside class="notes">封面页备注</aside>
    </section>
    <section class="slide" data-chapter="内容">
      <div class="frame"><div class="in">
        <h2>第一章节</h2>
        <p>在此添加内容</p>
      </div></div>
      <aside class="notes">内容页备注</aside>
    </section>
  </main>
</body>
</html>`;
    try {
      showLoading();
      const res = await fetch('/api/open-remote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '新建演示文稿.html', content: template })
      });
      if (!res.ok) throw new Error('创建失败');
      const data = await res.json();
      if (data.ok) {
        currentFile = '新建演示文稿.html';
        currentFileUrl = data.url;
        $('#file-name').textContent = currentFile;
        const iframe = $('#preview-iframe');
        iframe.src = data.url;
        iframe.onload = () => setTimeout(() => refreshSlideList(), 800);
        isDirty = false;
        updateStatus();
        showToast('已创建新演示文稿', 'success');
      }
    } catch (err) {
      showToast('创建失败: ' + err.message, 'error');
    } finally {
      hideLoading();
    }
  }

  // ========== 最近文件（localStorage） ==========
  function addRecentFile(name, url) {
    try {
      let recent = JSON.parse(localStorage.getItem('ppt-editor-recent') || '[]');
      recent = recent.filter(f => f.name !== name);
      recent.unshift({ name, url, time: Date.now() });
      if (recent.length > 10) recent = recent.slice(0, 10);
      localStorage.setItem('ppt-editor-recent', JSON.stringify(recent));
    } catch (e) { /* ignore */ }
  }

  // ========== 幻灯片列表 ==========
  function refreshSlideList() {
    const slides = EditorBridge.getSlides();
    slidesData = slides;
    totalSlides = slides.length;
    const list = $('#slide-list');
    list.innerHTML = '';
    slides.forEach((s, i) => {
      const thumb = document.createElement('div');
      thumb.className = 'slide-thumb' + (s.active ? ' active' : '');
      thumb.draggable = true;
      thumb.dataset.index = i;
      thumb.innerHTML = `<span class="thumb-num">${i + 1}</span><div style="padding:4px 6px;font-size:9px;color:var(--ed-muted);margin-top:auto;text-align:center;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${s.chapter || ''}</div>`;
      thumb.style.background = 'var(--ed-card)';
      thumb.title = s.chapter || `第 ${i + 1} 页`;
      thumb.onclick = () => gotoSlide(i);
      // 拖拽排序
      thumb.ondragstart = (e) => { e.dataTransfer.setData('text/plain', i); thumb.classList.add('dragging'); };
      thumb.ondragend = () => thumb.classList.remove('dragging');
      thumb.ondragover = (e) => { e.preventDefault(); thumb.classList.add('drag-over'); };
      thumb.ondragleave = () => thumb.classList.remove('drag-over');
      thumb.ondrop = (e) => {
        e.preventDefault();
        thumb.classList.remove('drag-over');
        const from = parseInt(e.dataTransfer.getData('text/plain'));
        const to = i;
        if (from !== to) reorderSlide(from, to);
      };
      list.appendChild(thumb);
      if (s.active) currentSlideIndex = i;
    });
    updateStatus();
    loadNotes(currentSlideIndex);
  }

  function gotoSlide(index) {
    currentSlideIndex = index;
    EditorBridge.gotoSlide(index);
    $$('.slide-thumb').forEach((t, i) => t.classList.toggle('active', i === index));
    updateStatus();
    loadNotes(index);
  }

  function reorderSlide(from, to) {
    const doc = $('#preview-iframe')?.contentDocument;
    if (!doc) return;
    const slides = doc.querySelectorAll('.slide');
    if (!slides[from] || !slides[to]) return;
    const deck = doc.querySelector('.deck');
    if (!deck) return;
    if (from < to) {
      deck.insertBefore(slides[from], slides[to].nextSibling);
    } else {
      deck.insertBefore(slides[from], slides[to]);
    }
    isDirty = true;
    refreshSlideList();
    gotoSlide(to);
    showToast('幻灯片已移动', 'info');
  }

  function loadNotes(index) {
    const text = EditorBridge.getNotes(index);
    $('#notes-editor').value = text;
  }

  function onNotesChange() {
    EditorBridge.updateNotes(currentSlideIndex, $('#notes-editor').value);
    isDirty = true;
    updateStatus();
  }

  // ========== 工具函数 ==========
  function rgbToHex(rgb) {
    const m = rgb.match(/\d+/g);
    if (!m || m.length < 3) return '#ffffff';
    return '#' + [m[0], m[1], m[2]].map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
  }

  // ========== 元素选中 ==========
  function onElementSelected(msg) {
    const info = $('#prop-element-info');
    info.textContent = `<${msg.tag.toLowerCase()}> .${(msg.classes || '').split(' ').filter(c => c && !c.startsWith('ed-')).join('.')}`;
    const fields = $('#prop-fields');
    fields.innerHTML = '';

    const apply = (key, val) => { EditorBridge.applyStyle({ [key]: val }); isDirty = true; updateStatus(); };

    // 字号：滑块
    const fsVal = parseInt(msg.styles.fontSize) || 14;
    const fsRow = document.createElement('div');
    fsRow.className = 'prop-row';
    fsRow.innerHTML = `<span class="prop-label">字号</span><input type="range" class="prop-range" min="8" max="72" value="${fsVal}"><span class="prop-range-val">${fsVal}px</span>`;
    const fsRange = fsRow.querySelector('input');
    const fsDisp = fsRow.querySelector('.prop-range-val');
    fsRange.oninput = () => { fsDisp.textContent = fsRange.value + 'px'; apply('fontSize', fsRange.value + 'px'); };
    fields.appendChild(fsRow);

    // 颜色：color picker
    const colorRow = document.createElement('div');
    colorRow.className = 'prop-row';
    const hexVal = rgbToHex(msg.styles.color);
    colorRow.innerHTML = `<span class="prop-label">颜色</span><input type="color" class="prop-color" value="${hexVal}"><span class="prop-color-hex">${hexVal}</span>`;
    const colorInput = colorRow.querySelector('input');
    const colorDisp = colorRow.querySelector('.prop-color-hex');
    colorInput.oninput = () => { colorDisp.textContent = colorInput.value; apply('color', colorInput.value); };
    fields.appendChild(colorRow);

    // 粗细：下拉
    const fwVal = msg.styles.fontWeight || '400';
    const fwRow = document.createElement('div');
    fwRow.className = 'prop-row';
    const opts = [100,200,300,400,500,600,700,800,900].map(w => `<option value="${w}" ${String(w)===String(fwVal)?'selected':''}>${w}${w===400?' 正常':w===700?' 粗体':''}</option>`).join('');
    fwRow.innerHTML = `<span class="prop-label">粗细</span><select class="prop-select">${opts}</select>`;
    fwRow.querySelector('select').onchange = (e) => apply('fontWeight', e.target.value);
    fields.appendChild(fwRow);

    // 对齐：按钮组
    const taVal = msg.styles.textAlign || 'start';
    const taRow = document.createElement('div');
    taRow.className = 'prop-row';
    const aligns = [
      { val: 'left', icon: '◧', tip: '左对齐' },
      { val: 'center', icon: '◫', tip: '居中' },
      { val: 'right', icon: '◨', tip: '右对齐' },
    ];
    const btns = aligns.map(a => `<button class="prop-align-btn${(taVal===a.val||taVal==='start'&&a.val==='left')?' active':''}" data-align="${a.val}" title="${a.tip}">${a.icon}</button>`).join('');
    taRow.innerHTML = `<span class="prop-label">对齐</span><div class="prop-align-group">${btns}</div>`;
    taRow.querySelectorAll('.prop-align-btn').forEach(btn => {
      btn.onclick = () => {
        taRow.querySelectorAll('.prop-align-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        apply('textAlign', btn.dataset.align);
      };
    });
    fields.appendChild(taRow);

    // 组件专属属性
    if (msg.componentType && msg.componentData) {
      const compSection = document.createElement('div');
      compSection.className = 'prop-group';
      compSection.style.marginTop = '12px';
      compSection.innerHTML = `<div class="prop-group-title">组件: ${msg.componentType}</div>`;
      const compProps = getComponentProps(msg.componentType, msg.componentData);
      compProps.forEach(p => {
        const row = document.createElement('div');
        row.className = 'prop-row';
        row.innerHTML = `<span class="prop-label">${p.label}</span><input class="prop-input" value="${p.value || ''}">`;
        row.querySelector('input').onchange = (e) => {
          EditorBridge.updateComponentAttr(p.attr, e.target.value);
          isDirty = true; updateStatus();
        };
        compSection.appendChild(row);
      });
      fields.appendChild(compSection);
    }
  }

  function getComponentProps(type, data) {
    switch (type) {
      case 'counter-up': return [
        { label: '目标值', attr: 'data-target', value: data.target },
        { label: '时长ms', attr: 'data-duration', value: data.duration },
      ];
      case 'progress-bar': return [{ label: '百分比', attr: 'data-value', value: data.value }];
      case 'progress-ring': return [
        { label: '百分比', attr: 'data-value', value: data.value },
        { label: '尺寸', attr: 'data-size', value: data.size },
      ];
      case 'typewriter': return [{ label: '速度ms', attr: 'data-speed', value: data.speed }];
      case 'marquee': return [{ label: '速度', attr: 'data-speed', value: data.speed }];
      default: return [];
    }
  }

  // ========== 组件模板 ==========
  const COMP_TEMPLATES = {
    'tab-group': '<div class="tab-group"><div class="tab-bar"><input type="radio" id="ed-tab1" name="ed-tabs" checked><label for="ed-tab1">标签 1</label><input type="radio" id="ed-tab2" name="ed-tabs"><label for="ed-tab2">标签 2</label></div><div class="tab-panel" data-tab="标签1"><p>标签 1 内容</p></div><div class="tab-panel" data-tab="标签2"><p>标签 2 内容</p></div></div>',
    'flip-card': '<div class="flip-card" style="width:280px;height:180px"><div class="flip-inner"><div class="flip-front" style="padding:20px"><h3>正面</h3><p>悬停翻转</p></div><div class="flip-back" style="padding:20px"><h3>背面</h3><p>背面内容</p></div></div></div>',
    'hover-reveal': '<div class="hover-reveal"><div class="reveal-summary"><strong>悬停查看详情</strong></div><div class="reveal-detail"><p>隐藏的详细内容</p></div></div>',
    'accordion': '<div class="accordion"><details><summary>第一项</summary><div class="acc-body">第一项内容</div></details><details><summary>第二项</summary><div class="acc-body">第二项内容</div></details></div>',
    'progress-bar': '<div class="progress-bar" style="--pct:65"><span>65%</span></div>',
    'progress-ring': '<div class="progress-ring" style="--pct:75"><span>75%</span></div>',
    'carousel': '<div class="carousel"><div class="carousel-track"><div class="carousel-slide"><p>幻灯片 1</p></div><div class="carousel-slide"><p>幻灯片 2</p></div></div><button class="carousel-btn prev">&lt;</button><button class="carousel-btn next">&gt;</button></div>',
    'stepper': '<div class="stepper"><div class="stepper-nav"><div class="stepper-dot active">1</div><div class="stepper-line"><div class="stepper-line-fill"></div></div><div class="stepper-dot">2</div></div><div class="stepper-panel active"><p>步骤 1 内容</p></div><div class="stepper-panel"><p>步骤 2 内容</p></div></div>',
    'toggle-switch': '<div class="toggle-switch"><input type="checkbox" id="ed-toggle"><div class="toggle-track"></div><label class="toggle-label-off">关</label><label class="toggle-label-on">开</label></div>',
    'quiz': '<div class="quiz" style="padding:16px;background:var(--card,#1e2a47);border-radius:8px"><p><strong>问题：HTML 是什么？</strong></p><label style="display:block;padding:4px 0;cursor:pointer"><input type="radio" name="ed-quiz"> A. 编程语言</label><label style="display:block;padding:4px 0;cursor:pointer"><input type="radio" name="ed-quiz"> B. 标记语言</label></div>',
    'sortable-list': '<ul class="sortable-list" style="list-style:none;padding:0"><li style="padding:8px 12px;margin:4px 0;background:var(--card,#1e2a47);border-radius:6px;cursor:grab">项目 1</li><li style="padding:8px 12px;margin:4px 0;background:var(--card,#1e2a47);border-radius:6px;cursor:grab">项目 2</li><li style="padding:8px 12px;margin:4px 0;background:var(--card,#1e2a47);border-radius:6px;cursor:grab">项目 3</li></ul>',
    'morph-number': '<div class="morph-number" style="font-size:48px;font-weight:700"><div class="morph-digit"><div class="morph-digit-inner"><span>0</span></div></div></div>',
  };

  const EFFECT_CLASSES = {
    'counter-up': el => { el.classList.add('counter-up'); if (!el.dataset.target) el.dataset.target = el.textContent.replace(/\D/g,'') || '100'; },
    'typewriter': el => { el.classList.add('typewriter'); },
    'marquee': el => { const wrapper = document.createElement('div'); wrapper.className = 'marquee'; const content = document.createElement('div'); content.className = 'marquee-content'; content.innerHTML = el.outerHTML; el.replaceWith(wrapper); wrapper.appendChild(content); },
    'stagger': el => { el.classList.add('stagger'); },
    'zoom-hover': el => { el.classList.add('zoom-hover'); },
    'glow-pulse': el => { el.classList.add('glow-pulse'); },
    'tilt-card': el => { el.classList.add('tilt-card'); },
    'neon-underline': el => { el.classList.add('neon-underline'); },
  };

  function bindCompPanel() {
    $$('.comp-item').forEach(item => {
      item.onclick = () => {
        const comp = item.dataset.comp;
        if (!comp) return;
        if (EFFECT_CLASSES[comp]) {
          if (!EditorBridge.getSelectedEl()) { showToast('请先选中一个元素', 'warn'); return; }
          EditorBridge.applyEffect(EFFECT_CLASSES[comp]);
          isDirty = true; updateStatus();
          return;
        }
        const html = COMP_TEMPLATES[comp];
        if (html) {
          EditorBridge.insertComponent(html);
          isDirty = true; updateStatus();
        }
      };
    });
  }

  // ========== 幻灯片操作 ==========
  function addSlide() {
    const iframe = $('#preview-iframe');
    const doc = iframe?.contentDocument;
    if (!doc) return;
    const deck = doc.querySelector('.deck');
    if (!deck) return;
    const section = doc.createElement('section');
    section.className = 'slide';
    section.dataset.chapter = '新页面';
    section.innerHTML = `<div class="frame"><div class="in"><h2 style="text-align:center;margin-top:200px;color:var(--text)">新幻灯片</h2></div></div><aside class="notes">备注</aside>`;
    deck.appendChild(section);
    isDirty = true;
    refreshSlideList();
    gotoSlide(totalSlides - 1); // 跳到新页
    showToast('已添加新幻灯片', 'success');
  }

  function duplicateSlide() {
    const iframe = $('#preview-iframe');
    const doc = iframe?.contentDocument;
    if (!doc) return;
    const slides = doc.querySelectorAll('.slide');
    const current = slides[currentSlideIndex];
    if (!current) return;
    const clone = current.cloneNode(true);
    clone.classList.remove('active');
    clone.dataset.chapter = (clone.dataset.chapter || '') + ' (副本)';
    current.after(clone);
    isDirty = true;
    refreshSlideList();
    gotoSlide(currentSlideIndex + 1);
    showToast('已复制幻灯片', 'success');
  }

  async function deleteSlide() {
    if (totalSlides <= 1) { showToast('至少保留一页幻灯片', 'warn'); return; }
    const ok = await showConfirm('删除幻灯片', `确定要删除第 ${currentSlideIndex + 1} 页吗？此操作不可撤销。`);
    if (!ok) return;
    const iframe = $('#preview-iframe');
    const doc = iframe?.contentDocument;
    if (!doc) return;
    const slides = doc.querySelectorAll('.slide');
    if (slides[currentSlideIndex]) {
      slides[currentSlideIndex].remove();
      isDirty = true;
      if (currentSlideIndex >= totalSlides - 1) currentSlideIndex = Math.max(0, currentSlideIndex - 1);
      refreshSlideList();
      gotoSlide(Math.min(currentSlideIndex, totalSlides - 1));
      showToast('已删除幻灯片', 'info');
    }
  }

  // ========== 图片上传 ==========
  async function handleImageUpload() {
    const file = $('#img-input').files[0];
    if (!file) return;
    try {
      showLoading();
      const formData = new FormData();
      formData.append('image', file);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('上传失败');
      const data = await res.json();
      if (data.ok) {
        EditorBridge.insertImage(data.url);
        isDirty = true; updateStatus();
        showToast('图片已插入', 'success');
      }
    } catch (err) {
      showToast('图片上传失败: ' + err.message, 'error');
    } finally {
      hideLoading();
      $('#img-input').value = '';
    }
  }

  // ========== 播放 / 主题 / TTS ==========
  function playPresentation() {
    if (!currentFile) { showToast('请先打开一个文件', 'warn'); return; }
    const url = currentFileUrl || `/project/${encodeURIComponent(currentFile)}`;
    window.open(url, '_blank');
  }

  function toggleTheme() {
    const iframe = $('#preview-iframe');
    if (iframe.contentDocument?.body) {
      iframe.contentDocument.body.classList.toggle('dark-mode');
    }
  }

  function toggleTTS() {
    if (TTS.speaking) { TTS.stop(); return; }
    const notes = $('#notes-editor').value;
    TTS.speakSlideNotes(notes);
  }

  // ========== 状态更新 ==========
  function updateStatus() {
    $('#status-page').textContent = `${currentSlideIndex + 1} / ${totalSlides}`;
    const dot = $('#status-dot');
    dot.classList.toggle('unsaved', isDirty);
    if (isDirty) $('#status-text').textContent = '未保存';
  }

  // ========== 启动 ==========
  document.addEventListener('DOMContentLoaded', init);

  return { init, gotoSlide };
})();
