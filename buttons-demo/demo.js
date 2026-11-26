(() => {
  const root = document.documentElement;
  const status = document.querySelector('#demoStatus');
  const initialCards = document.querySelector('.todo').innerHTML;
  const undoButton = document.querySelector('#undoSkip');
  const skippedCards = [];
  const updateCount = () => { document.querySelector('.count').textContent = document.querySelectorAll('.todo .tcard:not([hidden])').length; };
  undoButton.addEventListener('click', () => {
    const card = skippedCards.pop();
    if (!card) return;
    card.hidden = false; updateCount(); undoButton.hidden = !skippedCards.length;
    status.textContent = `${card.querySelector('.nm').textContent}: клиент возвращён в список.`;
    card.querySelector('[data-action=skip]').focus();
  });
  document.querySelectorAll('[data-theme]').forEach(button => {
    if (button === root) return;
    button.addEventListener('click', () => {
      const theme = button.dataset.theme;
      root.dataset.theme = theme === 'navy' ? 'dark' : theme;
      root.dataset.palette = theme === 'navy' ? 'navy' : '';
      document.querySelectorAll('.theme-picker button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    });
  });
  document.querySelectorAll('[data-version]').forEach(button => button.addEventListener('click', () => {
    const old = button.dataset.version === 'old';
    document.querySelector('#buttonStyles').sheet.disabled = old;
    const buttonType = getComputedStyle(document.querySelector('.ta .btn'));
    document.querySelector('#fontName').textContent = old ? `${buttonType.fontFamily.split(',')[0].replace(/["']/g, '')} / ${buttonType.fontWeight}` : 'Onest / 600';
    document.querySelectorAll('[data-version]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  }));
  document.querySelector('.todo').addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const card = button.closest('.tcard');
    const name = card.querySelector('.nm').textContent;
    if (button.dataset.action === 'write') {
      document.querySelector('#messageTitle').textContent = `Написать · ${name}`;
      document.querySelector('#messageDialog').showModal();
    } else if (button.dataset.action === 'done') {
      card.classList.add('is-done');
      card.querySelector('.sb').textContent = 'Написал · напомним через 3 дня';
      button.setAttribute('aria-pressed', 'true');
      status.textContent = `${name}: статус изменён в демо.`;
    } else if (button.dataset.action === 'skip') {
      card.hidden = true; skippedCards.push(card); updateCount(); undoButton.hidden = false;
      status.textContent = `${name}: напоминание убрано, клиент остаётся в блокноте.`;
      undoButton.focus();
    } else {
      card.querySelector('.sb').textContent = 'Напоминание · завтра';
      status.textContent = `${name}: напоминание перенесено в демо.`;
    }
  });
  document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => {
    const messages = { save: 'Изменения сохранены в демо.', note: 'Клиент добавлен в демонстрационный блокнот.', copy: 'Пример действия «Копировать». Буфер обмена не меняется.' };
    status.textContent = messages[button.dataset.example];
    if (button.dataset.example === 'save') button.textContent = 'Сохранено ✓';
  }));
  document.querySelector('#reset').addEventListener('click', () => {
    document.querySelector('.todo').innerHTML = initialCards;
    skippedCards.length = 0; undoButton.hidden = true; updateCount();
    document.querySelector('[data-example=save]').textContent = 'Сохранить изменения';
    status.textContent = 'Пример сброшен. Кнопки можно попробовать снова.';
  });
})();
