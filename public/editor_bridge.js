/**
 * editor_bridge.js — iframe ↔ 编辑器 postMessage 通信桥
 * 注入到 iframe 内部，监听编辑器指令并操作 DOM
 */
const EditorBridge = (() => {
  let selectedEl = null;
  let highlightBox = null;
  const undoStack = []; // 撤销快照栈
  const redoStack = []; // 重做快照栈
  const MAX_UNDO = 30;

  function init(iframe) {
    // 在 iframe 加载完成后注入桥接脚本
    iframe.addEventListener('load', () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        injectBridge(doc);
      } catch (e) {
        console.warn('Bridge inject failed (cross-origin?):', e);
      }
    });
  }

  function injectBridge(doc) {
    // 创建高亮框样式
    const style = doc.createElement('style');
    style.dataset.edInject = '1';
    style.textContent = `
      .ed-highlight { outline: 2px solid #00d4ff !important; outline-offset: 2px;
        cursor: pointer; position: relative; }
      .ed-highlight::after { content: attr(data-ed-tag); position: absolute; top: -20px; left: 0;
        background: #00d4ff; color: #000; font-size: 10px; padding: 1px 6px; border-radius: 3px;
        font-weight: 700; pointer-events: none; z-index: 99999; }
      .ed-editing { outline: 2px solid #00ff88 !important; outline-offset: 2px; }
    `;
    doc.head.appendChild(style);

    // 隐藏标注画板层（会拦截点击）
    const annotationLayer = doc.getElementById('annotation-layer');
    if (annotationLayer) annotationLayer.style.display = 'none';

    // 让 .slide 不拦截 .frame 内的点击事件
    const editorOverride = doc.createElement('style');
    editorOverride.dataset.edInject = '1';
    editorOverride.textContent = `
      .slide { pointer-events: none !important; }
      .slide .frame, .slide .frame * { pointer-events: auto !important; }
    `;
    doc.head.appendChild(editorOverride);

    // 禁用 PPT 自身的键盘导航 + 撤销/删除
    doc.addEventListener('keydown', (e) => {
      const navKeys = ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space','PageUp','PageDown','Home','End'];
      if (navKeys.includes(e.code) || navKeys.includes(e.key)) {
        e.stopPropagation();
      }
      // Ctrl+Z 撤销、Ctrl+Y / Ctrl+Shift+Z 重做
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault(); e.stopPropagation();
        if (e.shiftKey) redo(doc); else undo(doc);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault(); e.stopPropagation();
        redo(doc);
        return;
      }
      // Delete/Backspace 删除选中元素（排除正在编辑文字的情况）
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEl && !selectedEl.isContentEditable) {
        e.preventDefault(); e.stopPropagation();
        saveSnapshot(doc);
        selectedEl.classList.remove('ed-highlight');
        selectedEl.removeAttribute('data-ed-tag');
        clearHandles(doc);
        selectedEl.remove();
        selectedEl = null;
        window.parent.postMessage({ type: 'text-edited' }, '*');
        return;
      }
    }, true);

    // 点击事件：选中元素（阻止 PPT 翻页等默认行为）
    doc.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 找到 .frame 内最近的有意义元素
      const el = e.target.closest('.frame') ? findBestTarget(e.target) : null;
      if (!el) return;
      selectElement(el, doc);
    }, true);

    // 双击事件：进入编辑模式
    doc.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = e.target;
      if (el.closest('.frame') && isTextElement(el)) {
        enterEditMode(el, doc, e);
      }
    }, true);

    // ===== 编辑模式：强制展开所有隐藏的交互组件内容 =====
    const editModeCSS = doc.createElement('style');
    editModeCSS.dataset.edInject = '1';
    editModeCSS.textContent = `
      /* 标签切换：显示所有 tab-panel */
      .tab-group .tab-panel {
        display: block !important;
        border: 1px dashed rgba(0,212,255,0.3) !important;
        padding: 8px !important;
        margin-top: 4px !important;
        position: relative !important;
      }
      .tab-group .tab-panel::before {
        content: 'Tab: ' attr(data-tab) !important;
        display: block; font-size: 9px; color: #00d4ff;
        background: rgba(0,0,0,0.6); padding: 1px 6px; border-radius: 3px;
        margin-bottom: 4px; width: fit-content;
      }

      /* 翻转卡片：保持原始悬停翻转行为，不强制展开 */
      /* 悬停揭示：保持原始悬停行为 */

      /* 步进器：显示所有面板 */
      .stepper-panel {
        display: block !important;
        border: 1px dashed rgba(0,212,255,0.3) !important;
        margin-top: 4px !important;
      }

      /* 开关切换：显示所有面板 */
      .toggle-panel {
        display: block !important;
        border: 1px dashed rgba(0,212,255,0.3) !important;
      }

      /* 轮播：展开所有项目 */
      .carousel { overflow: visible !important; }
      .carousel-track {
        transform: none !important;
        display: flex !important; flex-wrap: wrap !important; gap: 8px !important;
      }

      /* 交错动画：取消初始隐藏 */
      .stagger > *, .stagger-left > *, .stagger-scale > * {
        opacity: 1 !important;
        transform: none !important;
      }

      /* 拖拽手柄样式 */
      .ed-move-handle {
        position: absolute; top: -12px; left: 50%; transform: translateX(-50%);
        width: 24px; height: 8px; background: #00d4ff; border-radius: 4px;
        cursor: move; z-index: 99999; opacity: 0.8;
      }
      .ed-move-handle:hover { opacity: 1; }
      .ed-resize-handle {
        position: absolute; width: 8px; height: 8px;
        background: #00ff88; border: 1px solid #fff; border-radius: 2px;
        z-index: 99999;
      }
      .ed-resize-handle.se { bottom: -4px; right: -4px; cursor: se-resize; }
      .ed-dragging { opacity: 0.7; }
    `;
    doc.head.appendChild(editModeCSS);

    // JS：强制打开所有 <details> 元素（手风琴）
    doc.querySelectorAll('details').forEach(d => d.setAttribute('open', ''));
  }

  // 找到最佳选中目标（优先选中有意义的子元素而非容器）
  function findBestTarget(el) {
    // 如果点击的是文本节点的父元素，直接返回
    if (isTextElement(el)) return el;
    // 如果是卡片/容器，返回自身
    if (el.closest('.glass-card, .card, .card-accent, .metric-card, .kpi-block')) {
      return el.closest('.glass-card, .card, .card-accent, .metric-card, .kpi-block');
    }
    return el;
  }

  function selectElement(el, doc) {
    // 清除旧选中和手柄
    if (selectedEl) {
      selectedEl.classList.remove('ed-highlight');
      selectedEl.removeAttribute('data-ed-tag');
    }
    clearHandles(doc);

    selectedEl = el;
    el.classList.add('ed-highlight');
    el.setAttribute('data-ed-tag', el.tagName.toLowerCase() + (el.className ? '.' + el.className.split(' ')[0] : ''));

    // 确保元素可定位（拖拽需要）
    const pos = getComputedStyle(el).position;
    if (pos === 'static') el.style.position = 'relative';

    // 添加移动手柄
    attachHandles(el, doc);

    // 检测组件类型
    const compType = detectComponentType(el);

    // 通知编辑器
    window.parent.postMessage({
      type: 'element-selected',
      tag: el.tagName,
      classes: el.className,
      text: el.textContent?.substring(0, 200),
      componentType: compType,
      componentData: compType ? getComponentData(el, compType) : null,
      styles: {
        fontSize: getComputedStyle(el).fontSize,
        color: getComputedStyle(el).color,
        fontWeight: getComputedStyle(el).fontWeight,
        textAlign: getComputedStyle(el).textAlign,
      },
      rect: el.getBoundingClientRect()
    }, '*');
  }

  // ===== 撤销/重做快照系统 =====
  function saveSnapshot(doc) {
    const active = doc.querySelector('.slide.active');
    if (!active) return;
    const frame = active.querySelector('.frame');
    if (!frame) return;
    const slides = doc.querySelectorAll('.slide');
    let idx = 0;
    slides.forEach((s, i) => { if (s.classList.contains('active')) idx = i; });
    undoStack.push({ slideIndex: idx, html: frame.innerHTML });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    // 新操作清空重做栈
    redoStack.length = 0;
  }

  function undo(doc) {
    if (undoStack.length === 0) return;
    const snap = undoStack.pop();
    const slides = doc.querySelectorAll('.slide');
    const slide = slides[snap.slideIndex];
    if (!slide) return;
    const frame = slide.querySelector('.frame');
    if (!frame) return;
    // 保存当前状态到重做栈
    redoStack.push({ slideIndex: snap.slideIndex, html: frame.innerHTML });
    // 清除当前选中
    if (selectedEl) {
      selectedEl.classList.remove('ed-highlight');
      selectedEl.removeAttribute('data-ed-tag');
    }
    clearHandles(doc);
    selectedEl = null;
    // 恢复快照
    frame.innerHTML = snap.html;
    window.parent.postMessage({ type: 'text-edited' }, '*');
  }

  function redo(doc) {
    if (redoStack.length === 0) return;
    const snap = redoStack.pop();
    const slides = doc.querySelectorAll('.slide');
    const slide = slides[snap.slideIndex];
    if (!slide) return;
    const frame = slide.querySelector('.frame');
    if (!frame) return;
    // 保存当前状态到撤销栈
    undoStack.push({ slideIndex: snap.slideIndex, html: frame.innerHTML });
    // 清除当前选中
    if (selectedEl) {
      selectedEl.classList.remove('ed-highlight');
      selectedEl.removeAttribute('data-ed-tag');
    }
    clearHandles(doc);
    selectedEl = null;
    // 恢复快照
    frame.innerHTML = snap.html;
    window.parent.postMessage({ type: 'text-edited' }, '*');
  }

  // ===== 拖拽手柄系统 =====
  let dragState = null;

  function clearHandles(doc) {
    doc.querySelectorAll('.ed-move-handle, .ed-resize-handle').forEach(h => h.remove());
  }

  function attachHandles(el, doc) {
    // img 是 void 元素，不能 appendChild，手柄需要加到父元素上
    const isImg = el.tagName === 'IMG';
    const handleParent = isImg ? el.parentElement : el;
    if (!handleParent) return;

    // 移动手柄
    const moveH = doc.createElement('div');
    moveH.className = 'ed-move-handle';
    moveH.title = '拖动移动';
    if (isImg) {
      moveH.style.cssText = `position:absolute;top:${el.offsetTop - 12}px;left:${el.offsetLeft + el.offsetWidth/2 - 12}px;`;
    }
    handleParent.appendChild(moveH);

    moveH.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const startX = e.clientX, startY = e.clientY;
      const origLeft = parseInt(el.style.left) || 0;
      const origTop = parseInt(el.style.top) || 0;
      el.classList.add('ed-dragging');
      dragState = { type: 'move', startX, startY, origLeft, origTop, el };

      const onMove = (ev) => {
        if (!dragState) return;
        el.style.left = (dragState.origLeft + ev.clientX - dragState.startX) + 'px';
        el.style.top = (dragState.origTop + ev.clientY - dragState.startY) + 'px';
        if (isImg) {
          moveH.style.top = (el.offsetTop - 12) + 'px';
          moveH.style.left = (el.offsetLeft + el.offsetWidth/2 - 12) + 'px';
        }
      };
      const onUp = () => {
        el.classList.remove('ed-dragging');
        dragState = null;
        doc.removeEventListener('mousemove', onMove);
        doc.removeEventListener('mouseup', onUp);
        window.parent.postMessage({ type: 'text-edited' }, '*');
      };
      doc.addEventListener('mousemove', onMove);
      doc.addEventListener('mouseup', onUp);
    });

    // 图片/卡片：右下角调整大小手柄
    if (isImg || el.querySelector('img') || el.classList.contains('card') || el.classList.contains('glass-card')) {
      const resizeH = doc.createElement('div');
      resizeH.className = 'ed-resize-handle se';
      resizeH.title = '拖动调整大小';
      if (isImg) {
        resizeH.style.cssText = `position:absolute;top:${el.offsetTop + el.offsetHeight - 4}px;left:${el.offsetLeft + el.offsetWidth - 4}px;`;
      }
      handleParent.appendChild(resizeH);

      resizeH.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const startX = e.clientX, startY = e.clientY;
        const origW = el.offsetWidth, origH = el.offsetHeight;
        dragState = { type: 'resize' };

        const onMove = (ev) => {
          const newW = Math.max(40, origW + (ev.clientX - startX));
          const newH = Math.max(30, origH + (ev.clientY - startY));
          el.style.width = newW + 'px';
          el.style.height = newH + 'px';
          if (isImg) {
            resizeH.style.top = (el.offsetTop + el.offsetHeight - 4) + 'px';
            resizeH.style.left = (el.offsetLeft + el.offsetWidth - 4) + 'px';
          }
        };
        const onUp = () => {
          dragState = null;
          doc.removeEventListener('mousemove', onMove);
          doc.removeEventListener('mouseup', onUp);
          window.parent.postMessage({ type: 'text-edited' }, '*');
        };
        doc.addEventListener('mousemove', onMove);
        doc.addEventListener('mouseup', onUp);
      });
    }
  }

  // ===== 组件类型检测 =====
  function detectComponentType(el) {
    const map = [
      { sel: '.accordion', type: 'accordion' },
      { sel: '.tab-group', type: 'tab-group' },
      { sel: '.flip-card', type: 'flip-card' },
      { sel: '.hover-reveal', type: 'hover-reveal' },
      { sel: '.stepper', type: 'stepper' },
      { sel: '.carousel', type: 'carousel' },
      { sel: '.counter-up', type: 'counter-up' },
      { sel: '.progress-bar', type: 'progress-bar' },
      { sel: '.progress-ring', type: 'progress-ring' },
      { sel: '.typewriter', type: 'typewriter' },
      { sel: '.marquee', type: 'marquee' },
    ];
    for (const { sel, type } of map) {
      if (el.closest(sel)) return type;
    }
    return null;
  }

  function getComponentData(el, type) {
    const comp = el.closest('.' + type.replace('-', '-')) || el;
    switch (type) {
      case 'counter-up':
        return { target: comp.dataset.target || '', duration: comp.dataset.duration || '2000' };
      case 'progress-bar':
        return { value: comp.dataset.value || comp.style.width || '' };
      case 'progress-ring':
        return { value: comp.dataset.value || '', size: comp.dataset.size || '' };
      case 'typewriter':
        return { speed: comp.dataset.speed || '50', text: comp.textContent?.substring(0, 200) || '' };
      case 'marquee':
        return { speed: comp.dataset.speed || '' };
      case 'carousel':
        return { items: comp.querySelectorAll('.carousel-item, .carousel-track > *').length };
      default:
        return {};
    }
  }

  function updateComponentAttr(attr, value) {
    if (!selectedEl) return;
    // 找到最近的组件容器
    const type = detectComponentType(selectedEl);
    if (!type) return;
    const comp = selectedEl.closest('.' + type) || selectedEl;
    if (attr.startsWith('data-')) {
      comp.setAttribute(attr, value);
    } else {
      comp.style[attr] = value;
    }
  }

  function isTextElement(el) {
    const textTags = ['H1','H2','H3','H4','H5','H6','P','SPAN','STRONG','EM','LI','LABEL','A','TD','TH','FIGCAPTION'];
    return textTags.includes(el.tagName) || el.childNodes.length === 1 && el.childNodes[0].nodeType === 3;
  }

  function enterEditMode(el, doc, evt) {
    saveSnapshot(doc);
    if (selectedEl) selectedEl.classList.remove('ed-highlight');
    el.classList.add('ed-editing');
    el.contentEditable = 'true';
    el.focus();

    // 定位光标到双击位置
    if (evt && doc.caretRangeFromPoint) {
      const range = doc.caretRangeFromPoint(evt.clientX, evt.clientY);
      if (range) {
        const sel = doc.defaultView.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }

    const exitEdit = () => {
      el.contentEditable = 'false';
      el.classList.remove('ed-editing');
      window.parent.postMessage({ type: 'text-edited', text: el.textContent }, '*');
      el.removeEventListener('blur', exitEdit);
      el.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); exitEdit(); } };
    el.addEventListener('blur', exitEdit);
    el.addEventListener('keydown', onKey);
  }

  // ========== 直接操作 iframe DOM 的 API（同源） ==========
  function getIframeDoc() {
    const iframe = document.getElementById('preview-iframe');
    return iframe?.contentDocument || null;
  }

  function getSlides() {
    const doc = getIframeDoc();
    if (!doc) return [];
    const slides = doc.querySelectorAll('.slide');
    return Array.from(slides).map((s, i) => ({
      index: i,
      chapter: s.dataset.chapter || '',
      active: s.classList.contains('active'),
      notes: s.querySelector('aside.notes')?.textContent || ''
    }));
  }

  function gotoSlide(index) {
    const doc = getIframeDoc();
    if (!doc) return;
    const iframe = document.getElementById('preview-iframe');
    // 优先用 core_engine 的 setSlide
    if (iframe.contentWindow?.setSlide) {
      iframe.contentWindow.setSlide(index);
    } else {
      doc.querySelectorAll('.slide').forEach((s, i) => s.classList.toggle('active', i === index));
    }
  }

  function getFullHTML() {
    const doc = getIframeDoc();
    if (!doc) return '';

    // --- 保存前记录选中状态 ---
    const savedSelected = selectedEl;
    const hadHighlight = selectedEl?.classList.contains('ed-highlight');
    const savedTag = selectedEl?.getAttribute('data-ed-tag');

    // --- 清理编辑器注入的痕迹 ---

    // 1. 移除所有注入的 <style data-ed-inject>
    const injectedStyles = doc.querySelectorAll('style[data-ed-inject]');
    injectedStyles.forEach(s => s.remove());

    // 2. 移除元素上的编辑器类和属性
    doc.querySelectorAll('.ed-highlight').forEach(el => {
      el.classList.remove('ed-highlight');
      el.removeAttribute('data-ed-tag');
    });
    doc.querySelectorAll('.ed-editing').forEach(el => el.classList.remove('ed-editing'));
    doc.querySelectorAll('.ed-move-handle, .ed-resize-handle').forEach(h => h.remove());

    // 3. 恢复 annotation-layer 显示
    const annotationLayer = doc.getElementById('annotation-layer');
    if (annotationLayer) annotationLayer.style.display = '';

    // 4. 关闭被编辑器强制打开的 <details>
    doc.querySelectorAll('details[open]').forEach(d => d.removeAttribute('open'));

    // --- 导出干净的 HTML ---
    const html = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;

    // --- 恢复编辑模式 ---
    injectedStyles.forEach(s => doc.head.appendChild(s));
    doc.querySelectorAll('details').forEach(d => d.setAttribute('open', ''));
    if (annotationLayer) annotationLayer.style.display = 'none';

    // --- 恢复选中状态 ---
    if (savedSelected && savedSelected.isConnected) {
      if (hadHighlight) savedSelected.classList.add('ed-highlight');
      if (savedTag) savedSelected.setAttribute('data-ed-tag', savedTag);
      attachHandles(savedSelected, doc);
    }

    return html;
  }

  function getNotes(index) {
    const doc = getIframeDoc();
    if (!doc) return '';
    const slides = doc.querySelectorAll('.slide');
    return slides[index]?.querySelector('aside.notes')?.textContent || '';
  }

  function updateNotes(index, text) {
    const doc = getIframeDoc();
    if (!doc) return;
    const slide = doc.querySelectorAll('.slide')[index];
    if (!slide) return;
    let notes = slide.querySelector('aside.notes');
    if (!notes) { notes = doc.createElement('aside'); notes.className = 'notes'; slide.appendChild(notes); }
    notes.textContent = text;
  }

  function insertImage(url) {
    const doc = getIframeDoc();
    if (!doc) return;
    saveSnapshot(doc);
    const img = doc.createElement('img');
    img.src = url;
    // 浮动定位，不用 transform（会导致手柄坐标偏移）
    img.style.cssText = 'position:absolute;max-width:60%;max-height:60%;border-radius:8px;z-index:10;cursor:pointer;';
    const active = doc.querySelector('.slide.active');
    const target = active?.querySelector('.frame') || active;
    if (target) {
      if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
      target.appendChild(img);
      // 图片加载后居中并选中
      const centerAndSelect = () => {
        const tw = target.offsetWidth, th = target.offsetHeight;
        const iw = img.offsetWidth, ih = img.offsetHeight;
        img.style.left = Math.max(0, (tw - iw) / 2) + 'px';
        img.style.top = Math.max(0, (th - ih) / 2) + 'px';
        selectElement(img, doc);
      };
      if (img.complete) centerAndSelect();
      else img.onload = centerAndSelect;
    }
  }

  function applyStyle(styles) {
    if (!selectedEl) return;
    const doc = getIframeDoc();
    if (doc) saveSnapshot(doc);
    Object.assign(selectedEl.style, styles);
  }

  function insertComponent(html) {
    const doc = getIframeDoc();
    if (!doc) return;
    saveSnapshot(doc);
    const wrapper = doc.createElement('div');
    wrapper.innerHTML = html;
    const el = wrapper.firstElementChild;
    if (!el) return;
    if (selectedEl) {
      selectedEl.after(el);
    } else {
      const active = doc.querySelector('.slide.active');
      const target = active?.querySelector('.frame .in') || active?.querySelector('.frame');
      if (target) target.appendChild(el);
    }
    // 编辑模式下新插入的 details 也要强制打开
    el.querySelectorAll('details').forEach(d => d.setAttribute('open', ''));
  }

  function getSelectedEl() { return selectedEl; }

  function applyEffect(fn) {
    if (!selectedEl) return;
    const doc = getIframeDoc();
    if (doc) fn(selectedEl);
  }

  return { init, getSlides, gotoSlide, getFullHTML, getNotes, updateNotes, insertImage, applyStyle, insertComponent, updateComponentAttr, getSelectedEl, applyEffect, undo: (doc) => undo(doc || getIframeDoc()), redo: (doc) => redo(doc || getIframeDoc()), canUndo: () => undoStack.length > 0, canRedo: () => redoStack.length > 0 };
})();

