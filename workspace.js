'use strict';
// Presentation and local personalization only. Authentication, contacts, payments,
// reviews and administrator permissions continue through the original app.js.
const workspacePerson=store.get('tochka-workspace-person',{name:'',city:'Москва'});
const workspaceSectionNames={'v-map':'Карта клиентов','v-list':'Список заведений','v-crm':'Мои клиенты','v-prof':'Личный кабинет'};
const workspaceBaseRenderProfile=renderProfile;
function workspaceSync(){
 const name=workspacePerson.name||'Мой профиль',initial=Array.from(name)[0].toUpperCase();
 $('#workspaceProfile').textContent=initial;$('#profileAvatar').textContent=initial;$('#profileName').textContent=name;
 $('#workspaceSection').textContent=workspaceSectionNames[current]||'Точка';
 document.querySelectorAll('.view').forEach(view=>view.inert=view.id!==current);
 $('#profileAccess').textContent=session ? session.user.email : 'Профиль на этом устройстве';
 $('#workspaceSaved').textContent=Object.keys(favs).length;
 $('#workspaceSent').textContent=notes.filter(n=>['sent','reply','deal','no'].includes(n.s)).length;
 $('#workspaceReplies').textContent=notes.filter(n=>['reply','deal'].includes(n.s)).length;
 $('#workspaceDeals').textContent=notes.filter(n=>n.s==='deal').length;
 $('#membershipState').textContent=acct?.admin?'Администратор':acct?.state==='active'?'Активна':acct?.state==='trial'?'Пробный доступ':'Подписка';
 if(!session)$('#pProSub').textContent='Контакты и инструменты откроются после входа.';
 $('#workspaceTheme').setAttribute('aria-label',DARK?'Включить светлую тему':'Включить тёмно-синюю тему');
}
renderProfile=function(){workspaceBaseRenderProfile();workspaceSync()};
const workspaceBaseGo=go;
go=function(v){const previous=current;workspaceBaseGo(v);$('#app').scrollTop=0;if(previous!==v&&v==='v-prof')$('.account-scroll').scrollTop=0;workspaceSync()};
const workspaceBaseRestyle=restyleMap;
restyleMap=function(){workspaceBaseRestyle();document.documentElement.setAttribute('data-theme',DARK?'dark':'light');document.documentElement.dataset.palette=themeMode==='navy'?'navy':'';workspaceSync()};
document.documentElement.setAttribute('data-theme',DARK?'dark':'light');
document.documentElement.dataset.palette=themeMode==='navy'?'navy':'';
$('#workspaceName').value=workspacePerson.name||'';
$('#workspaceCity').innerHTML=CITIES.map(([name])=>`<option>${esc(name)}</option>`).join('');
$('#workspaceCity').value=CITIES.some(([n])=>n===workspacePerson.city)?workspacePerson.city:'Москва';
const workspaceIcon=paths=>`<svg class="workspace-line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const workspaceSaveIcon=workspaceIcon('<path d="M12 3v11m-4-4 4 4 4-4M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>');
const workspaceCheckIcon=workspaceIcon('<path d="m5 12 4 4L19 6"/>');
const workspaceSaveButton=$('#workspaceProfileForm button[type="submit"]');
workspaceSaveButton.classList.add('profile-save-button');
function workspaceSaveState(done){
 workspaceSaveButton.classList.toggle('is-saved',done);
 workspaceSaveButton.innerHTML=(done?workspaceCheckIcon:workspaceSaveIcon)+`<span>${done?'Профиль сохранён':'Сохранить профиль'}</span>`;
}
workspaceSaveState(false);
$('#workspaceProfileForm').addEventListener('input',()=>workspaceSaveState(false));
$('#workspaceCity').addEventListener('change',()=>workspaceSaveState(false));
const workspaceMetricIcons=[
 '<path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4z"/>',
 '<path d="m21 3-7 18-4-7-7-4 18-7ZM10 14 21 3"/>',
 '<path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3H3V6a2 2 0 0 1 2-2Z"/><path d="M8 9h8M8 13h5"/>',
 '<rect x="4" y="4" width="16" height="16" rx="5"/><path d="m8 12 3 3 5-6"/>'
];
document.querySelectorAll('.metric-symbol').forEach((el,i)=>{el.innerHTML=workspaceIcon(workspaceMetricIcons[i]);el.setAttribute('aria-hidden','true')});
$('.device-icon').innerHTML=workspaceIcon('<rect x="2" y="3" width="15" height="12" rx="2"/><path d="M5 20h7M9 15v5"/><rect x="15" y="8" width="7" height="13" rx="1.8"/><path d="M18 18h1"/>');
$('#workspaceProfileForm').addEventListener('submit',e=>{
 e.preventDefault();const name=$('#workspaceName').value.trim();if(!name)return $('#workspaceName').focus();
 workspacePerson.name=name.slice(0,40);const city=$('#workspaceCity').value;const changed=city!==workspacePerson.city;workspacePerson.city=city;
 if(!store.set('tochka-workspace-person',workspacePerson))return toast('Не удалось сохранить: память устройства заполнена');
 if(changed){const place=CITIES.find(([n])=>n===city);if(place)flyToCity(place[1],place[2]);}
 workspaceSync();workspaceSaveState(true);toast('Профиль сохранён на этом устройстве');
});
$('#workspaceProfile').onclick=()=>go('v-prof');$('#workspaceTheme').onclick=()=>{setTheme(DARK?'light':'navy');workspaceSync()};
$('#theme').addEventListener('click',()=>workspaceSync());
document.querySelectorAll('[data-open-map]').forEach(b=>b.onclick=()=>go('v-map'));
$('#workspaceClients').onclick=()=>go('v-crm');
const workspaceShowcase=$('#workspaceShowcasePage'),workspaceFrame=$('#workspaceShowcaseFrame');
$('#workspaceShowcase').onclick=async()=>{
 try{if(!workspaceFrame.srcdoc){const r=await fetch('showcase.html');if(!r.ok)throw Error();workspaceFrame.srcdoc=await r.text();}
 workspaceShowcase.hidden=false;$('#app').inert=true;$('#workspaceShowcaseClose').focus();
 }catch{toast('Не получилось открыть макет. Обнови страницу и попробуй ещё раз.');}
};
function workspaceCloseShowcase(){workspaceShowcase.hidden=true;$('#app').inert=false;$('#workspaceShowcase').focus()}
$('#workspaceShowcaseClose').onclick=workspaceCloseShowcase;
addEventListener('message',e=>{if(e.source===workspaceFrame.contentWindow&&e.data?.type==='tochka-showcase-close')workspaceCloseShowcase()});
addEventListener('keydown',e=>{if(e.key==='Escape'&&!workspaceShowcase.hidden)workspaceCloseShowcase()});
// Keep the main qualification filter visible before the scrollable category choices.
const workspaceNoSite=$('#chips .nosite');if(workspaceNoSite)$('#chips').prepend(workspaceNoSite);
// Дополнительные категории приходят из той же защищённой базы, что и салоны.
workspaceSync();
