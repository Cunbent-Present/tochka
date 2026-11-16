'use strict';
// Additional navigation over the existing authenticated application features.
const morePages={'privacy.html':'Политика конфиденциальности','oferta.html':'Тарифы, оферта и реквизиты','o-tochke.html':'О Точке','download.html':'Скачать приложение'};
$('.account-main').insertAdjacentHTML('beforeend',`<section class="account-card service-card"><div class="card-heading"><h2>Помощь и документы</h2></div>
${Object.entries(morePages).map(([file,title])=>`<a class="pi" href="${file}" data-document="${file}"><span>${title}</span><span class="chev">›</span></a>`).join('')}
<button class="pi" type="button" id="moreGuide"><span>Как начать<small>Три шага от поиска до первого сообщения</small></span><span class="chev">›</span></button>
<button class="pi" type="button" id="moreSupport"><span>Поддержка и мои данные<small>Вопросы, ошибки, возврат и запрос удаления аккаунта</small></span><span class="chev">›</span></button>
</section>`);
document.body.insertAdjacentHTML('beforeend',`<dialog id="moreDialog" class="more-dialog" aria-labelledby="moreTitle"><header><h2 id="moreTitle"></h2><button class="x" type="button" id="moreClose" aria-label="Закрыть раздел">×</button></header><div id="moreContent" class="more-content"></div></dialog>`);
const moreDialog=$('#moreDialog'),moreContent=$('#moreContent');let moreReturnFocus,moreLoad=0;
function moreOpen(title){moreLoad++;if(!moreDialog.open)moreReturnFocus=document.activeElement;$('#moreTitle').textContent=title;moreContent.replaceChildren();if(!moreDialog.open)moreDialog.showModal();moreContent.scrollTop=0;$('#moreClose').focus();return moreLoad}
function moreClose(){moreLoad++;moreDialog.close();if(moreReturnFocus?.isConnected)moreReturnFocus.focus()}
$('#moreClose').onclick=moreClose;moreDialog.addEventListener('click',e=>{if(e.target===moreDialog){const r=moreDialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)moreClose()}});
moreDialog.addEventListener('cancel',e=>{e.preventDefault();moreClose()});
// Documents are local copies of the existing published text. No legal terms are invented here.
async function moreDocument(file){
 const title=morePages[file];if(!title)return;const load=moreOpen(title);moreContent.textContent='Загружаю документ…';
 try{const r=await fetch(file);if(!r.ok)throw Error();const parsed=new DOMParser().parseFromString(await r.text(),'text/html');
 const source=parsed.querySelector('main')||parsed.querySelector('.wrap')||parsed.body;
 source.querySelectorAll('script,style,iframe,form,button,svg,link,meta,.share,.top,.back,.toast').forEach(el=>el.remove());
 for(const node of [...source.childNodes]){if(node.nodeType===3&&/^[\s·]*$/.test(node.textContent))node.remove();else break}
 source.querySelectorAll('*').forEach(el=>{for(const attr of [...el.attributes])if(!['href','class','title','open','target','rel'].includes(attr.name))el.removeAttribute(attr.name)});
 source.querySelectorAll('a').forEach(a=>{const raw=a.getAttribute('href')||'';if(raw==='./'||raw==='index.html'){a.href='#';a.dataset.moreHome='1';return}const url=new URL(raw,'https://tochka-klient.ru/');if(!['https:','mailto:'].includes(url.protocol)){a.removeAttribute('href');return}a.href=url.href;a.rel='noopener noreferrer';a.target='_blank';});
 if(load!==moreLoad)return;moreContent.innerHTML=source.innerHTML;moreContent.scrollTop=0;
 }catch{if(load===moreLoad){moreContent.innerHTML='<p>Не получилось открыть документ.</p>';const retry=document.createElement('button');retry.className='btn';retry.textContent='Попробовать ещё раз';retry.onclick=()=>moreDocument(file);moreContent.append(retry)}}
}
document.addEventListener('click',e=>{
 const a=e.target.closest('a');if(!a)return;
 if(a.dataset.moreHome){e.preventDefault();moreClose();go('v-map');return}
 let file=a.dataset.document;try{const u=new URL(a.href,location.href);if(u.origin===location.origin||u.origin==='https://tochka-klient.ru')file=file||u.pathname.split('/').pop()}catch{}
 if(morePages[file]){e.preventDefault();moreDocument(file)}
 else if(file==='reviews.html'){e.preventDefault();if(moreDialog.open)moreClose();openReviews()}
 else if(file==='showcase.html'){e.preventDefault();if(moreDialog.open)moreClose();$('#workspaceShowcase').click()}
});
$('#moreSupport').onclick=()=>{moreOpen('Поддержка и мои данные');moreContent.innerHTML=`<h3>Нужна помощь?</h3><p>Напиши, что произошло и на каком устройстве. Для вопроса о подписке укажи почту аккаунта.</p><div class="more-actions"><a class="btn" href="https://t.me/cunbent" target="_blank" rel="noopener noreferrer">Написать в Telegram</a><a class="btn" href="mailto:tochka.app1@yandex.ru">Написать на почту</a></div><h3>Данные на устройстве</h3><p>Заметки, избранное, шаблоны и свои места хранятся в этом браузере. Перед сменой устройства сохрани клиентов через экспорт в Excel.</p><button class="btn" id="moreExport" type="button">Экспортировать клиентов</button><h3>Данные аккаунта</h3><p>Для исправления данных, отзыва согласия или удаления аккаунта отправь запрос на почту поддержки. Порядок указан в политике конфиденциальности.</p><a href="mailto:tochka.app1@yandex.ru?subject=${encodeURIComponent('Запрос об удалении аккаунта Точки')}">Подготовить запрос на удаление аккаунта</a><h3>Оплата и возврат</h3><p>Условия оплаты, сроки доступа и возврата находятся в оферте.</p><a href="oferta.html" data-document="oferta.html">Тарифы, оферта и реквизиты</a>`;$('#moreExport').onclick=()=>{moreClose();$('#export').click()}};
$('#moreGuide').onclick=()=>{moreOpen('Как начать');moreContent.innerHTML='<ol class="more-guide"><li><h3>Выбери город и фильтр</h3><p>Включи «Предположительно без сайта». Отсутствие сайта в базе не гарантирует, что у заведения его нет.</p></li><li><h3>Посмотри подходящего клиента</h3><p>Открой карточку: проверь контакты, источник, найденные соцсети и оценку потенциала.</p></li><li><h3>Подготовь сообщение</h3><p>В Pro нажми «Написать», выбери шаблон и адаптируй текст под заведение. Отметь результат и поставь напоминание в блокноте.</p></li></ol><button class="btn pri" id="moreGuideMap" type="button">Перейти к карте</button>';$('#moreGuideMap').onclick=()=>{moreClose();go('v-map')}};
const moreOriginalOpenAdmin=openAdmin;
async function moreAdminEntry(){
 const load=moreOpen('Админ-панель');
 if(!session){moreContent.innerHTML='<h3>Войти как владелец</h3><p>Используй почту аккаунта администратора. После входа сервер проверит права доступа.</p><p class="small">Здесь доступны пользователи, поиск по почте, продление на день, неделю или месяц, точные сроки подписки и модерация отзывов.</p><button class="btn pri" id="moreOwnerLogin" type="button">Войти по почте</button>';$('#moreOwnerLogin').onclick=()=>{moreClose();showGate('email');$('#gateTitle').textContent='Вход в аккаунт владельца'};return}
 moreContent.textContent='Проверяю права доступа…';
 try{const t=await token();if(!t)throw Error('LOGIN');const allowed=await api('/rest/v1/rpc/tochka_is_admin',{method:'POST',body:{},token:t});if(load!==moreLoad)return;
 if(allowed!==true){moreContent.innerHTML='<h3>Нет доступа к управлению</h3><p>Этот аккаунт не имеет прав администратора.</p><button class="btn" type="button" id="moreOwnerAccount">Открыть аккаунт</button>';$('#moreOwnerAccount').onclick=()=>{moreClose();openPro()};return}
 moreClose();moreOriginalOpenAdmin();
 }catch{if(load===moreLoad){moreContent.innerHTML='<p>Не удалось проверить права. Проверь подключение и вход в аккаунт.</p><button class="btn" id="moreOwnerRetry" type="button">Повторить проверку</button>';$('#moreOwnerRetry').onclick=moreAdminEntry}}
}
openAdmin=moreAdminEntry;
// Reset owner-specific login copy when a normal Pro entry is opened next.
const moreOriginalShowGate=showGate;showGate=function(step){moreOriginalShowGate(step);if(step==='email')$('#gateTitle').textContent='Контакты и шаблоны — в Pro'};
