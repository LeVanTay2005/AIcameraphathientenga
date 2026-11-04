const button=document.getElementById('installApp'),hint=document.getElementById('installHint');let prompt;
if(!document.getElementById('piVideo')){const main=document.querySelector('main');if(main){const entry=document.createElement('a');entry.href='/camera.html';entry.className='install-bar';entry.textContent='Mở ứng dụng camera Raspberry Pi →';main.prepend(entry);}}
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();prompt=event;button.textContent='Cài ứng dụng';});
button.onclick=async()=>{if(prompt){await prompt.prompt();await prompt.userChoice;prompt=null;}else{hint.hidden=!hint.hidden;}};
window.addEventListener('appinstalled',()=>{button.textContent='Đã cài ứng dụng';});
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{hint.hidden=false;hint.textContent='Chưa bật được chế độ offline. Hãy dùng HTTPS và tải lại trang.';});
