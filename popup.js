// popup.js
document.getElementById('run').addEventListener('click', async () => {
  const status = document.getElementById('status');
  status.textContent = 'Выполнение...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      status.textContent = 'Не удалось получить вкладку.';
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content-script.js']
    });

    status.textContent = 'Готово — панель должна появиться на странице Boosty.';
  } catch (err) {
    console.error(err);
    status.textContent = 'Ошибка: ' + (err && err.message ? err.message : String(err));
  }
});
