// content-script.js
(() => {
  const SHOW_MORE_BTN_SELECTOR =
    'div.ShowMore-scss--module_showMore_B3tq- button, button.ReadMoreButton-scss--module_root_pcljX, button.ShowMore-scss--module_button_vHAUa';
  const COMMENT_SELECTOR =
    '.CommentView-scss--module_root_VLxON:not(.CommentInThread-scss--module_comment_b3HaG)';
  const DATE_SELECTOR =
    '.CreatedAtDate-scss--module_text_m09De, .CommentView-scss--module_bottomBlock_yiODN a';
  const REACTIONS_SELECTOR = '.ReactionsComment-scss--module_amount_DFk-j';
  const MAX_CLICKS = 150;
  const WAIT_AFTER_CLICK_MS = 700;
  const WAIT_POLL_INTERVAL_MS = 300;
  const WAIT_POLL_MAX_MS = 6000;
  const PANEL_ID = 'boosty-top-comments-panel-v1';

  function parseReactions(reactionsText) {
    if (!reactionsText) return 0;
    let t = String(reactionsText).trim().toLowerCase();
    t = t.replace(',', '.').replace(/\s+/g, '');
    const m = t.match(/^([\d.]+)(k|к)?$/i);
    if (m) {
      let num = parseFloat(m[1].replace(/,/g, '.')) || 0;
      if (m[2]) num *= 1000;
      return Math.round(num);
    }
    const digits = parseInt(reactionsText.replace(/\D/g, ''), 10);
    return Number.isNaN(digits) ? 0 : digits;
  }

  function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }
  function getCommentsCount() { return document.querySelectorAll(COMMENT_SELECTOR).length; }

  async function waitForNewOrNoButton(prevCount, timeout = WAIT_POLL_MAX_MS) {
    const start = Date.now();
    await sleep(WAIT_AFTER_CLICK_MS);
    while (Date.now() - start < timeout) {
      const currentCount = getCommentsCount();
      if (currentCount > prevCount) return { newCount: currentCount, reason: 'more' };
      const btn = document.querySelector(SHOW_MORE_BTN_SELECTOR);
      if (!btn) return { newCount: currentCount, reason: 'no_button' };
      await sleep(WAIT_POLL_INTERVAL_MS);
    }
    return { newCount: getCommentsCount(), reason: 'timeout' };
  }

  async function expandAllComments() {
    let clicks = 0;
    while (clicks < MAX_CLICKS) {
      const btn = document.querySelector(SHOW_MORE_BTN_SELECTOR);
      if (!btn) break;
      try { btn.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (e) {}
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true' || btn.offsetParent === null) break;
      const prev = getCommentsCount();
      // клик через dispatchEvent, если обычный click может быть заблокирован
      try {
        btn.click();
      } catch (e) {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      }
      clicks++;
      const result = await waitForNewOrNoButton(prev);
      if (result.reason === 'timeout') break;
      // если кнопки больше нет — цикл завершится сам
    }
    return getCommentsCount();
  }

  function collectAndProcess() {
    const nodes = Array.from(document.querySelectorAll(COMMENT_SELECTOR));
    const unedited = [];
    const edited = [];

    nodes.forEach(node => {
      const author = node.querySelector('.CommentView-scss--module_name_2sHKt')?.innerText?.trim() || 'Неизвестно';
      const text = node.querySelector('.CommentView-scss--module_content_oZw-i')?.innerText?.trim() || '';
      const reactionsText = node.querySelector(REACTIONS_SELECTOR)?.innerText?.trim() || '0';
      const reactions = parseReactions(reactionsText);
      const dateText = node.querySelector(DATE_SELECTOR)?.innerText?.trim() || '';
      const isEdited = /измен/i.test(dateText);
      const idAttr = node.getAttribute('id') || '';
      if (isEdited) edited.push({ author, text, reactions, dateText, idAttr });
      else unedited.push({ author, text, reactions, dateText, idAttr });
    });

    unedited.sort((a, b) => b.reactions - a.reactions);

    let threshold = 0;
    if (unedited.length >= 4) threshold = unedited[3].reactions;
    else if (unedited.length > 0) threshold = unedited[unedited.length - 1].reactions;

    const mainResult = unedited.filter(it => it.reactions >= threshold);

    return { mainResult, edited, threshold, allCounts: { total: nodes.length, unedited: unedited.length, edited: edited.length } };
  }

  function detectDarkTheme() {
    try {
      const cs = window.getComputedStyle(document.body);
      const bg = cs && cs.backgroundColor ? cs.backgroundColor : null;
      if (bg) {
        const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (m) {
          const r = parseInt(m[1], 10) / 255;
          const g = parseInt(m[2], 10) / 255;
          const b = parseInt(m[3], 10) / 255;
          const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
          if (a === 0) return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          return lum < 0.5;
        }
      }
    } catch (e) {}
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  }

  function fallbackCopyTextToClipboard(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  function buildPlainText(mainResult, edited, threshold, allCounts) {
    const out = [];
    out.push(`ТОП комментариев (лайки ≥ ${threshold})`);
    out.push(`Всего: ${allCounts.total} • Неизменённых: ${allCounts.unedited} • Изменённых: ${allCounts.edited}`);
    out.push('----------------------------------------');
    mainResult.forEach((it, i) => {
      out.push(`#${i + 1} | ${it.reactions} | ${it.author} | ${it.text}`);
    });
    out.push('');
    out.push('Тайтлы нарушившие правила (изменённые комментарии):');
    out.push('----------------------------------------');
    if (edited.length === 0) out.push('(нет)');
    edited.forEach((it, i) => {
      out.push(`#${i + 1} | ${it.reactions} | ${it.author} | ${it.text} | ${it.dateText || ''}`);
    });
    return out.join('\n');
  }

  function showTempHint(panel, msg, isOk = true) {
    const hint = document.createElement('div');
    hint.textContent = msg;
    hint.style.position = 'absolute';
    hint.style.right = '12px';
    hint.style.top = '44px';
    hint.style.padding = '6px 10px';
    hint.style.borderRadius = '6px';
    hint.style.background = isOk ? '#2563eb' : '#b91c1c';
    hint.style.color = '#ffffff';
    hint.style.fontSize = '12px';
    hint.style.zIndex = '2147483650';
    panel.appendChild(hint);
    setTimeout(() => hint.remove(), 1400);
  }

  // создание панели
  function createPanel({ mainResult, edited, threshold, allCounts }) {
    const old = document.getElementById(PANEL_ID);
    if (old) old.remove();

    const isDark = detectDarkTheme();
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('role', 'region');
    panel.style.position = 'fixed';
    panel.style.right = '18px';
    panel.style.top = '18px';
    panel.style.zIndex = '2147483647';
    panel.style.minWidth = '360px';
    panel.style.maxWidth = 'min(95vw, 900px)';
    panel.style.maxHeight = '80vh';
    panel.style.overflow = 'hidden';
    panel.style.borderRadius = '10px';
    panel.style.boxShadow = '0 10px 30px rgba(0,0,0,0.28)';
    panel.style.fontFamily = 'Inter, Roboto, Arial, sans-serif';
    panel.style.fontSize = '13px';

    const vars = {
      '--bg': isDark ? '#0b0c0d' : '#ffffff',
      '--panel': isDark ? '#0b0c0d' : '#ffffff',
      '--cell': isDark ? '#141618' : '#f7f8fa',
      '--muted': isDark ? '#9aa0a6' : '#6b7280',
      '--text': isDark ? '#ffffff' : '#0b0b0b',
      '--accent': isDark ? '#2563eb' : '#1f4ed8',
      '--border': isDark ? '#222427' : '#e6e9ee'
    };
    Object.entries(vars).forEach(([k, v]) => panel.style.setProperty(k, v));
    panel.style.background = 'var(--panel)';

    panel.innerHTML = `
      <div style="
        background: var(--panel);
        color: var(--text);
        padding: 10px;
        box-sizing: border-box;
        display:flex;
        gap:8px;
        align-items:center;
        justify-content:space-between;
        border-bottom:1px solid var(--border);
      ">
        <div style="display:flex;flex-direction:column;gap:2px;">
          <strong style="font-size:14px;line-height:1">ТОП комментариев по реакциям</strong>
          <span style="font-size:12px;color:var(--muted)">Всего: ${allCounts.total} • Неизменённых: ${allCounts.unedited} • Изменённых: ${allCounts.edited}</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <button id="${PANEL_ID}-copy" title="Скопировать результат" style="
            background:transparent;border:1px solid var(--border);padding:6px 8px;border-radius:6px;color:var(--text);cursor:pointer;
          ">Скопировать</button>
          <button id="${PANEL_ID}-close" title="Закрыть" style="
            background:transparent;border:1px solid transparent;padding:6px 8px;border-radius:6px;color:var(--muted);cursor:pointer;
          ">✕</button>
        </div>
      </div>
      <div style="padding:8px; overflow:auto; max-height: calc(80vh - 70px); background:var(--panel);">
        <div style="margin-bottom:10px;">
          <div style="font-weight:600;margin-bottom:6px;color:var(--muted);font-size:12px">Основной список (лайки ≥ ${threshold})</div>
          <div style="border-radius:8px;overflow:auto;border:1px solid var(--border);background:var(--cell);">
            <table id="${PANEL_ID}-main-table" style="width:100%;border-collapse:collapse;">
              <thead>
                <tr>
                  <th style="text-align:left;padding:8px;border-bottom:1px solid var(--border);font-weight:600">#</th>
                  <th style="text-align:left;padding:8px;border-bottom:1px solid var(--border);font-weight:600">Автор</th>
                  <th style="text-align:left;padding:8px;border-bottom:1px solid var(--border);font-weight:600">Текст / тайтл</th>
                  <th style="text-align:right;padding:8px;border-bottom:1px solid var(--border);font-weight:600">Реакции</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
        </div>

        <div>
          <div style="font-weight:600;margin-bottom:6px;color:var(--muted);font-size:12px">Тайтлы нарушившие правила (изменённые комментарии)</div>
          <div style="border-radius:8px;overflow:auto;border:1px solid var(--border);background:var(--cell);">
            <table id="${PANEL_ID}-edited-table" style="width:100%;border-collapse:collapse;">
              <thead>
                <tr>
                  <th style="text-align:left;padding:8px;border-bottom:1px solid var(--border);font-weight:600">#</th>
                  <th style="text-align:left;padding:8px;border-bottom:1px solid var(--border);font-weight:600">Автор</th>
                  <th style="text-align:left;padding:8px;border-bottom:1px solid var(--border);font-weight:600">Текст / тайтл</th>
                  <th style="text-align:right;padding:8px;border-bottom:1px solid var(--border);font-weight:600">Реакции</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    function styleRow(tr, idx) {
      tr.style.background = idx % 2 === 0 ? 'var(--panel)' : 'var(--cell)';
      tr.style.color = 'var(--text)';
    }

    const mainTbody = panel.querySelector(`#${PANEL_ID}-main-table tbody`);
    mainResult.forEach((it, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding:8px;vertical-align:top;width:36px;border-bottom:1px solid var(--border)">${i + 1}</td>
        <td style="padding:8px;vertical-align:top;min-width:90px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-bottom:1px solid var(--border)">${escapeHtml(it.author)}</td>
        <td style="padding:8px;vertical-align:top;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-bottom:1px solid var(--border)" title="${escapeHtml(it.text)}">${escapeHtml(it.text)}</td>
        <td style="padding:8px;vertical-align:top;text-align:right;width:76px;border-bottom:1px solid var(--border)">${it.reactions}</td>
      `;
      styleRow(tr, i);
      mainTbody.appendChild(tr);
    });

    const editedTbody = panel.querySelector(`#${PANEL_ID}-edited-table tbody`);
    edited.forEach((it, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding:8px;vertical-align:top;width:36px;border-bottom:1px solid var(--border)">${i + 1}</td>
        <td style="padding:8px;vertical-align:top;min-width:90px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-bottom:1px solid var(--border)">${escapeHtml(it.author)}</td>
        <td style="padding:8px;vertical-align:top;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-bottom:1px solid var(--border)" title="${escapeHtml(it.text)}">${escapeHtml(it.text)}</td>
        <td style="padding:8px;vertical-align:top;text-align:right;width:76px;border-bottom:1px solid var(--border)">${it.reactions}</td>
      `;
      styleRow(tr, i);
      editedTbody.appendChild(tr);
    });

    panel.querySelector(`#${PANEL_ID}-close`).addEventListener('click', () => panel.remove());
    panel.querySelector(`#${PANEL_ID}-copy`).addEventListener('click', async () => {
      const text = buildPlainText(mainResult, edited, threshold, allCounts);
      try {
        await navigator.clipboard.writeText(text);
        showTempHint(panel, 'Скопировано в буфер', true);
      } catch (e) {
        const ok = fallbackCopyTextToClipboard(text);
        showTempHint(panel, ok ? 'Скопировано (fallback)' : 'Ошибка копирования', ok);
      }
    });

    document.body.appendChild(panel);
  }

  // основной запуск: разворачиваем и строим панель
  (async () => {
    try {
      await expandAllComments();
      const res = collectAndProcess();
      createPanel(res);
    } catch (e) {
      // тихая обработка ошибок: покажем в консоли
      console.error('error in content-script:', e);
      // попытка показать всплытие на странице
      const existing = document.getElementById(PANEL_ID);
      if (!existing) {
        const fallback = document.createElement('div');
        fallback.style.position = 'fixed';
        fallback.style.right = '12px';
        fallback.style.bottom = '12px';
        fallback.style.zIndex = '2147483647';
        fallback.style.padding = '8px 12px';
        fallback.style.background = '#b91c1c';
        fallback.style.color = '#fff';
        fallback.style.borderRadius = '6px';
        fallback.textContent = 'Ошибка выполнения скрипта (см. консоль)';
        document.body.appendChild(fallback);
        setTimeout(() => fallback.remove(), 3000);
      }
    }
  })();
})();
