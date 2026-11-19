const menuButton = document.querySelector('.menu-toggle');
const mobileNav = document.querySelector('.mobile-nav');
const dialog = document.querySelector('#booking-dialog');

function closeMenu() {
  mobileNav.hidden = true;
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Открыть меню');
}

menuButton.addEventListener('click', () => {
  const opening = mobileNav.hidden;
  mobileNav.hidden = !opening;
  menuButton.setAttribute('aria-expanded', String(opening));
  menuButton.setAttribute('aria-label', opening ? 'Закрыть меню' : 'Открыть меню');
});

mobileNav.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
document.querySelectorAll('[data-open-dialog]').forEach(button => button.addEventListener('click', () => {
  closeMenu();
  dialog.showModal();
}));
document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => dialog.close()));
dialog.addEventListener('click', event => {
  if (event.target === dialog) dialog.close();
});
