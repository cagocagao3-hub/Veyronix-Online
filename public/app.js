(() => {
  // No próprio aparelho, 0.0.0.0 não é uma origem segura para microfone.
  // Redireciona para loopback, que navegadores reconhecem como contexto seguro.
  if (location.hostname === "0.0.0.0") {
    const localUrl = new URL(location.href);
    localUrl.hostname = "127.0.0.1";
    location.replace(localUrl.href);
    return;
  }

  const $ = (selector) => document.querySelector(selector);
  const authView = $("#authView");
  const appView = $("#appView");
  const forms = ["registerForm", "verifyForm", "loginForm", "forgotForm", "resetForm"];
  let csrfToken = "";
  let pendingEmail = "";

  function icons() {
    if (window.lucide) window.lucide.createIcons();
  }
  function showMessage(message, isError = false) {
    const box = $("#authMessage");
    box.textContent = message;
    box.classList.remove("hidden", "error");
    if (isError) box.classList.add("error");
  }
  function clearMessage() {
    $("#authMessage").classList.add("hidden");
  }
  function showAuthView(view) {
    clearMessage();
    forms.forEach(id => $("#" + id).classList.toggle("hidden", id !== view + "Form"));
    const titles = {
      register: ["COMECE POR AQUI", "Crie sua conta", "Entre para fazer parte de novas comunidades."],
      verify: ["QUASE LÁ", "Confirme seu e-mail", "Só precisamos confirmar que o endereço é seu."],
      login: ["BEM-VINDO DE VOLTA", "Que bom te ver", "Entre na sua conta para continuar."],
      forgot: ["RECUPERAÇÃO DE CONTA", "Esqueceu sua senha?", "Vamos ajudar você a recuperar o acesso."],
      reset: ["NOVA SENHA", "Crie outra senha", "Use o código enviado ao seu e-mail."]
    };
    const [kicker, title, subtitle] = titles[view];
    $("#authKicker").textContent = kicker;
    $("#authTitle").textContent = title;
    $("#authSubtitle").textContent = subtitle;
    authView.classList.remove("hidden");
    appView.classList.add("hidden");
  }
  async function api(url, data = {}, method = "POST") {
    const response = await fetch(url, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Veyronix-Request": csrfToken
      },
      body: method === "GET" ? undefined : JSON.stringify(data)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Não foi possível concluir. Tente novamente.");
    return result;
  }
  function busy(form, busy) {
    const button = form.querySelector('button[type="submit"]');
    if (!button) return;
    button.disabled = busy;
    button.dataset.original ||= button.innerHTML;
    button.innerHTML = busy ? '<span>Processando...</span>' : button.dataset.original;
    icons();
  }
  async function submit(formId, action) {
    const form = $("#" + formId);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearMessage();
      busy(form, true);
      const data = Object.fromEntries(new FormData(form).entries());
      try {
        const result = await api(action, data);
        if (result.email && action.endsWith("register")) {
          pendingEmail = result.email;
          $("#verifyEmailLabel").textContent = result.email;
          showAuthView("verify");
        } else if (result.redirect) {
          // Recarrega a aplicação após autenticar para descartar qualquer estado visual
          // que tenha ficado em memória de uma conta anterior.
          window.location.replace(window.location.pathname + "?session=" + Date.now());
          return;
        } else {
          showMessage(result.message || "Tudo certo.");
          if (action.endsWith("reset")) setTimeout(() => showAuthView("login"), 1300);
        }
      } catch (error) {
        showMessage(error.message, true);
      } finally {
        busy(form, false);
      }
    });
  }
  let profileState = null;
  function enterApp(user) {
    // Se a sessão mudou sem uma navegação completa, zera os estados da conta anterior.
    const previousUserId = profileState?.id;
    if (previousUserId && Number(previousUserId) !== Number(user.id)) {
      if (voice.channelId) leaveVoice(false);
      if (messagePoll) clearInterval(messagePoll);
      if (dmTimer) clearInterval(dmTimer);
      messagePoll = null; dmTimer = null;
      communities = []; activeCommunity = null; activeChannel = null;
      activeDmFriend = null; dmAfter = 0; lastMessageId = 0;
      socialData = { incoming: [], outgoing: [], friends: [] };
      ["#messageList", "#communityList", "#railDynamicList"].forEach(sel => { const el=$(sel); if(el) el.innerHTML=""; });
      ["#friendsOverlay", "#publicProfileOverlay", "#dmOverlay", "#membersOverlay", "#serverSettingsOverlay", "#settingsOverlay"].forEach(sel => { const el=$(sel); if(el) el.classList.add("hidden"); });
      $(".conversation-area")?.style.removeProperty("--server-wallpaper");
      $("#chatWorkspace")?.classList.add("hidden");
      $(".welcome-content")?.classList.remove("hidden");
      activeCommunity = null; activeChannel = null;
    }
    authView.classList.add("hidden");
    appView.classList.remove("hidden");
    profileState = user;
    loadCommunities();
    const name = (user.display_name || user.username || "Membro").slice(0,20);
    const betaPreview = $("#previewBetaTag");
    if (betaPreview) betaPreview.classList.toggle("hidden", !user.is_beta);
    const initial = name.trim().charAt(0).toUpperCase() || "V";
    $("#dockName").textContent = name;
    $("#welcomeName").textContent = name;
    $("#profileName").textContent = name;
    $("#profileEmail").textContent = user.email || "—";
    ["#dockAvatar", "#railAvatar", "#largeAvatar"].forEach(sel => {
      const el=$(sel);
      el.style.background = user.avatar_data ? `url("${user.avatar_data}") center / cover no-repeat` : "linear-gradient(145deg,#9587ff,#6252e7)";
      el.style.backgroundSize="cover"; el.style.backgroundPosition="center"; el.style.backgroundRepeat="no-repeat";
      el.textContent = user.avatar_data ? "" : initial;
      el.classList.toggle("has-image", !!user.avatar_data);
    });
    const ownCover = $(".profile-cover");
    ownCover.style.backgroundImage = user.banner_data ? `url("${user.banner_data}")` : "";
    ownCover.classList.toggle("has-cover", !!user.banner_data);
    icons();
  }
  async function loadSession() {
    const response = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
    const session = await response.json();
    csrfToken = session.csrfToken;
    if (session.authenticated) enterApp(session.user);
    else {
      if (messagePoll) clearInterval(messagePoll);
      if (dmTimer) clearInterval(dmTimer);
      messagePoll = null; dmTimer = null; profileState = null;
      appView.classList.add("hidden");
      authView.classList.remove("hidden");
      showAuthView("register");
    }
  }

  const registerUsername = document.querySelector('#registerForm input[name="username"]');
  registerUsername.addEventListener("input", () => { registerUsername.value = registerUsername.value.toLowerCase().replace(/[^a-z0-9_.]/g, ""); });
  submit("registerForm", "/api/auth/register");
  // Set the pending address in capture phase before the form's API handler runs.
  const verifyEmailField = document.createElement("input");
  verifyEmailField.type = "hidden";
  verifyEmailField.name = "email";
  $("#verifyForm").appendChild(verifyEmailField);
  $("#verifyForm").addEventListener("submit", () => {
    verifyEmailField.value = pendingEmail;
  }, true);
  submit("verifyForm", "/api/auth/verify");
  submit("loginForm", "/api/auth/login");
  submit("forgotForm", "/api/auth/forgot");
  submit("resetForm", "/api/auth/reset");

  document.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) showAuthView(viewButton.dataset.view);
    const eye = event.target.closest(".eye-button");
    if (eye) {
      const input = eye.parentElement.querySelector("input");
      input.type = input.type === "password" ? "text" : "password";
      eye.innerHTML = input.type === "password" ? '<i data-lucide="eye"></i>' : '<i data-lucide="eye-off"></i>';
      icons();
    }
  });
  $("#backToRegister").addEventListener("click", () => showAuthView("register"));
  $("#verifyForm").addEventListener("submit", () => {
    verifyEmailField.value = pendingEmail;
  }, true);

  $("#logoutButton").addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", {});
      window.location.replace(window.location.pathname + "?signedout=" + Date.now());
    } catch (error) { toast(error.message); }
  });
  function openSettings() {
    if (!profileState) return;
    $("#settingsOverlay").classList.remove("hidden");
    $("#settingsOverlay").setAttribute("aria-hidden", "false");
    $("#profileUsername").value = profileState.username || "";
    $("#displayName").value = profileState.display_name || "";
    $("#profileBio").value = profileState.bio || "";
    $("#avatarFile").value = ""; $("#bannerFile").value = ""; delete $("#avatarFile").dataset.data; delete $("#bannerFile").dataset.data; delete $("#avatarFile").dataset.clear; delete $("#bannerFile").dataset.clear;
    updatePreview(); showSettingsPanel("profile"); icons();
  }
  function closeSettings() { $("#settingsOverlay").classList.add("hidden"); $("#settingsOverlay").setAttribute("aria-hidden", "true"); }
  async function showSettingsPanel(key) {
    const titles = {profile:["Perfil","Personalize como as pessoas veem você."],account:["Minha conta","Informações e acesso à sua conta."],privacy:["Dados e privacidade","Controle a visibilidade e seus dados."],security:["Senha e segurança","Mantenha sua conta protegida."],sessions:["Dispositivos","Gerencie os acessos à sua conta."]};
    const [title,subtitle]=titles[key]||titles.profile;
    $("#settingsTitle").textContent=title; $("#settingsSubtitle").textContent=subtitle;
    $("#settingsProfilePanel").classList.toggle("hidden",key!=="profile");
    $("#settingsInfoPanel").classList.toggle("hidden",key==="profile");
    ["account","privacy","security","sessions"].forEach(k=>$("#"+k+"SettingsPanel").classList.toggle("hidden",key!==k));
    document.querySelectorAll(".settings-tab").forEach(btn=>btn.classList.toggle("active",btn.dataset.settings===key));
    if(key==="account"){$("#accountEmail").textContent=profileState?.email||"—";$("#accountUsername").textContent="@"+(profileState?.username||"");}
    if(["privacy","sessions"].includes(key)) await loadSettingsData();
    icons();
  }
  async function loadSettingsData(){
    try{
      const data=await api("/api/settings",{},"GET");
      if(data.preferences){$("#privacyProfilePublic").checked=!!data.preferences.profile_public;$("#privacyFriendRequests").checked=!!data.preferences.friend_requests;}
      $("#devicesList").innerHTML=(data.devices||[]).length?data.devices.map(d=>`<div class="settings-row"><div><strong>${escapeHtml(d.label)}</strong><small>${d.current?"Este dispositivo":"Último acesso: "+escapeHtml(d.last_seen)}</small></div>${d.current?'<span class="settings-status">Atual</span>':`<button class="secondary-button compact" data-remove-device="${d.id}">Encerrar</button>`}</div>`).join(""):'<p class="settings-muted">Nenhum dispositivo registrado.</p>';
      $("#blockedUsersList").innerHTML=(data.blocked||[]).length?data.blocked.map(u=>`<div class="settings-row"><div><strong>${escapeHtml(u.display_name||u.username)}</strong><small>@${escapeHtml(u.username)}</small></div><button class="secondary-button compact" data-unblock="${escapeHtml(u.username)}">Desbloquear</button></div>`).join(""):'<p class="settings-muted">Você não bloqueou ninguém.</p>';
    }catch(e){toast(e.message,true);}
  }
  function updatePreview() {
    const username = $("#profileUsername").value.toLowerCase();
    const name = $("#displayName").value.trim() || username || "Seu nome";
    $("#previewName").textContent = name.slice(0,20);
    $("#previewBetaTag").classList.toggle("hidden", !profileState?.is_beta);
    $("#previewUsername").textContent = "@" + (username || "usuario");
    $("#previewBio").textContent = $("#profileBio").value || "Sua descrição aparecerá aqui.";
    const avatar = $("#avatarFile").dataset.clear ? "" : ($("#avatarFile").dataset.data || profileState?.avatar_data || "");
    const banner = $("#bannerFile").dataset.clear ? "" : ($("#bannerFile").dataset.data || profileState?.banner_data || "");
    $("#previewAvatar").style.backgroundImage = avatar ? `url("${avatar}")` : "";
    $("#previewAvatar").textContent = avatar ? "" : (name.charAt(0).toUpperCase() || "V");
    $("#previewBanner").style.backgroundImage = banner ? `url("${banner}")` : "";
    $("#previewBanner").classList.toggle("has-cover", !!banner);
  }
  function readImage(file, input) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast("O arquivo deve ter no máximo 10 MB.", true); input.value=""; return; }
    if (!/image\/(png|jpeg|webp|gif)/.test(file.type)) { toast("Formato não suportado. Use PNG, JPG, WEBP ou GIF.", true); input.value=""; return; }
    const reader = new FileReader();
    reader.onload = () => { delete input.dataset.clear; input.dataset.data = reader.result; updatePreview(); };
    reader.readAsDataURL(file);
  }
  $("#settingsButton").addEventListener("click", openSettings);
  document.querySelector(".server-rail .server-icon[title='Configurações']")?.addEventListener("click", openSettings);
  $("#closeSettings").addEventListener("click", closeSettings);
  $("#settingsOverlay").addEventListener("click", e => { if (e.target.id === "settingsOverlay") closeSettings(); });
  document.querySelectorAll(".settings-tab").forEach(btn => btn.addEventListener("click", () => showSettingsPanel(btn.dataset.settings)));
  ["profileUsername","displayName","profileBio"].forEach(id => $("#"+id).addEventListener("input", () => { if(id === "profileUsername") $("#profileUsername").value = $("#profileUsername").value.toLowerCase().replace(/[^a-z0-9_.]/g, ""); updatePreview(); }));
  $("#avatarFile").addEventListener("change", e => readImage(e.target.files[0], e.target));
  $("#bannerFile").addEventListener("change", e => readImage(e.target.files[0], e.target));
  $("#removeAvatar").addEventListener("click",()=>{ $("#avatarFile").value=""; delete $("#avatarFile").dataset.data; $("#avatarFile").dataset.clear="1"; updatePreview(); toast("A foto será removida ao salvar.",false,true); });
  $("#removeBanner").addEventListener("click",()=>{ $("#bannerFile").value=""; delete $("#bannerFile").dataset.data; $("#bannerFile").dataset.clear="1"; updatePreview(); toast("O banner será removido ao salvar.",false,true); });
  $("#profileForm").addEventListener("submit", async e => {
    e.preventDefault();
    const button = e.currentTarget.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      const result = await api("/api/profile", { username: $("#profileUsername").value, displayName: $("#displayName").value, bio: $("#profileBio").value, avatarData: $("#avatarFile").dataset.data || "", bannerData: $("#bannerFile").dataset.data || "", clearAvatar:!!$("#avatarFile").dataset.clear, clearBanner:!!$("#bannerFile").dataset.clear }, "PATCH");
      profileState = result.user; enterApp(result.user); toast("Perfil atualizado com sucesso.", false, true); closeSettings();
    } catch(error) { toast(error.message, true); }
    finally { button.disabled = false; }
  });

  $("#accountEditProfile").addEventListener("click",()=>showSettingsPanel("profile"));
  $("#settingsLogout").addEventListener("click",async()=>{try{await api("/api/auth/logout",{});window.location.replace(window.location.pathname + "?signedout=" + Date.now());}catch(e){toast(e.message,true);}});
  $("#savePrivacy").addEventListener("click",async()=>{try{await api("/api/settings/privacy",{profilePublic:$("#privacyProfilePublic").checked,friendRequests:$("#privacyFriendRequests").checked},"PATCH");toast("Preferências de privacidade salvas.",false,true);}catch(e){toast(e.message,true);}});
  $("#exportData").addEventListener("click",async()=>{try{const r=await fetch("/api/settings/export",{credentials:"same-origin"});if(!r.ok)throw new Error("Não foi possível exportar seus dados.");const blob=await r.blob(),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download="veyronix-dados.json";link.click();URL.revokeObjectURL(url);toast("Exportação iniciada.",false,true);}catch(e){toast(e.message,true);}});
  $("#changePasswordForm").addEventListener("submit",async e=>{e.preventDefault();const next=$("#newPassword").value;if(next!==$("#confirmPassword").value){toast("As senhas novas não coincidem.",true);return;}try{await api("/api/settings/password",{currentPassword:$("#currentPassword").value,newPassword:next});e.target.reset();toast("Senha alterada com sucesso.",false,true);}catch(x){toast(x.message,true);}});
  $("#logoutAllDevices").addEventListener("click",async()=>{try{const r=await api("/api/settings/logout-all",{});toast(`${r.closed} outro(s) dispositivo(s) encerrado(s).`,false,true);loadSettingsData();}catch(e){toast(e.message,true);}});
  document.addEventListener("click",async e=>{const device=e.target.closest("[data-remove-device]");if(device){try{await api(`/api/settings/devices/${device.dataset.removeDevice}`,{},"DELETE");loadSettingsData();toast("Dispositivo encerrado.",false,true);}catch(x){toast(x.message,true);}}
    const unblock=e.target.closest("[data-unblock]");if(unblock){try{await api(`/api/settings/blocked/${encodeURIComponent(unblock.dataset.unblock)}`,{},"DELETE");loadSettingsData();toast("Usuário desbloqueado.",false,true);}catch(x){toast(x.message,true);}}
  });
  $("#publicProfileBlock").addEventListener("click",async()=>{if(!viewedUsername)return;try{await api(`/api/users/${encodeURIComponent(viewedUsername)}/block`,{});$("#publicProfileOverlay").classList.add("hidden");toast("Usuário bloqueado.",false,true);}catch(e){toast(e.message,true);}});

  let communities = [], activeCommunity = null, activeChannel = null, lastMessageId = 0, messagePoll = null;
  let voice = {channelId:null,stream:null,peers:new Map(),poll:null,signalAfter:0,muted:true,deafened:false,screen:null,outputDeviceId:"",joining:false,participantSignature:"",iceServers:[{urls:["stun:stun.l.google.com:19302","stun:stun1.l.google.com:19302"]}],audioContext:null,localAnalyser:null,remoteAnalysers:new Map(),levelTimer:null};
  let railMode = "servers";
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  async function loadCommunities() {
    try {
      const result = await api("/api/communities", {}, "GET");
      communities = result.communities || [];
      renderCommunities();
    } catch (error) { toast(error.message, true); }
  }
  function renderCommunities() {
    const list=$("#communityList"); list.innerHTML="";
    $("#emptyServers").classList.toggle("hidden",communities.length>0);
    const rail=$("#railDynamicList"); const railScrollTop=rail.scrollTop; rail.innerHTML="";
    communities.forEach(community => {
      const item=document.createElement("button"); item.className="server-icon rail-community"+(activeCommunity?.id===community.id?" active":"");
      item.type="button"; item.title=community.name; item.setAttribute("aria-label",community.name);
      const mark=document.createElement("span"); mark.className="rail-community-mark";
      if(typeof community.icon==="string" && community.icon.startsWith("data:image/")){
        mark.classList.add("has-image");
        const image=document.createElement("img");image.className="rail-community-image";image.src=community.icon;image.alt="";image.draggable=false;mark.appendChild(image);
      } else mark.textContent=(community.name||"V").trim().charAt(0).toUpperCase();
      item.appendChild(mark); item.addEventListener("click",()=>{setRailMode("servers");selectCommunity(community);if(window.innerWidth<=760){const sidebar=$(".channel-sidebar");sidebar.classList.add("channels-only","mobile-open");}}); rail.appendChild(item);
    });
    rail.scrollTop=railScrollTop;
    if(activeCommunity && railMode==="servers") {
      const community=activeCommunity;
      const group=document.createElement("div"); group.className="community-group";
      const head=document.createElement("div"); head.className="community-title active-community-title";
      const glyph=document.createElement("span");glyph.className="community-glyph";
      if(community.icon){glyph.style.backgroundImage=`url("${community.icon}")`;glyph.classList.add("has-image");}else glyph.textContent=(community.name||"V").slice(0,1).toUpperCase();
      const label=document.createElement("span");label.textContent=community.name;head.append(glyph,label);group.appendChild(head);
      const channels=document.createElement("div"); channels.className="community-channels";
      const categories=(community.categories||[]).slice().sort((a,b)=>a.position-b.position);
      const groups=categories.length?categories:[{id:null,name:"CANAIS",position:0}];
      if(categories.length && community.channels.some(ch=>!ch.category_id)) groups.push({id:"__uncategorized__",name:"SEM CATEGORIA",position:999999});
      groups.forEach(category=>{
        const bucket=document.createElement("div"); bucket.className="channel-category-items";
        const matches=community.channels.filter(ch=>category.id===null?(!ch.category_id):category.id==="__uncategorized__"?!ch.category_id:ch.category_id===category.id);
        if(!matches.length)return;
        const catHead=document.createElement("button");catHead.type="button";catHead.className="channel-category-title";catHead.innerHTML=`<i data-lucide="chevron-down"></i><span>${escapeHtml(category.name)}</span>`;
        catHead.addEventListener("click",()=>{bucket.classList.toggle("collapsed");catHead.classList.toggle("collapsed");});
        matches.forEach(channel=>{const b=document.createElement("button");b.className="channel-link"+(activeChannel?.id===channel.id?" selected":"");b.innerHTML=`<span>${channel.kind==="voice"?"◖))":"#"}</span>${escapeHtml(channel.name)}`;b.addEventListener("click",()=>{selectChannel(channel);if(window.innerWidth<=760){$(".channel-sidebar").classList.remove("mobile-open","channels-only");}});bucket.appendChild(b);});
        channels.append(catHead,bucket);
      });
      if(!channels.childElementCount){const empty=document.createElement("div");empty.className="channel-empty-note";empty.textContent="Nenhum canal neste servidor";channels.appendChild(empty);}
      group.appendChild(channels);list.appendChild(group);
    } else if(railMode==="friends") {
      const title=document.createElement("div");title.className="community-title";title.textContent="Mensagens e amigos";list.appendChild(title);
      const note=document.createElement("div");note.className="channel-empty-note";note.textContent="Escolha um amigo na barra lateral para abrir a conversa.";list.appendChild(note);
    } else {
      const empty=document.createElement("div");empty.className="empty-server";empty.innerHTML='<span class="empty-server-icon"><i data-lucide="messages-square"></i></span><strong>Selecione um servidor</strong><p>Os canais do servidor selecionado aparecerão aqui.</p>';list.appendChild(empty);
    }
    icons();
  }
  function setRailMode(mode){
    railMode=mode;
    $("#railHomeButton").classList.toggle("active",mode==="servers");
    $("#railFriendsButton").classList.toggle("active",mode==="friends");
    $("#railDynamicList").setAttribute("aria-label",mode==="friends"?"Seus amigos":"Seus servidores");
    if(mode==="friends") loadFriendData(); else renderCommunities();
  }
  function renderRailFriends(){
    const rail=$("#railDynamicList"); const railScrollTop=rail.scrollTop; rail.innerHTML="";
    const friends=socialData.friends||[];
    friends.forEach(friend=>{
      const item=document.createElement("button"); item.type="button"; item.className="server-icon rail-friend"+(activeDmFriend?.id===Number(friend.user_id)?" active":"");
      item.title=`${friend.display_name||friend.username} (@${friend.username})`; item.setAttribute("aria-label",item.title);
      const avatar=document.createElement("span"); avatar.className="rail-friend-avatar";
      if(friend.avatar_data){avatar.style.backgroundImage=`url("${friend.avatar_data}")`;avatar.classList.add("has-image");}
      else avatar.textContent=(friend.display_name||friend.username||"?").trim().charAt(0).toUpperCase();
      item.appendChild(avatar);
      item.addEventListener("click",()=>openDm({id:Number(friend.user_id),username:friend.username,display_name:friend.display_name||friend.username}));
      rail.appendChild(item);
    });
    rail.scrollTop=railScrollTop;
    if(!friends.length){const empty=document.createElement("div");empty.className="rail-friends-empty";empty.innerHTML='<i data-lucide="users"></i><small>Sem<br>amigos</small>';empty.title="Adicione amigos para iniciar conversas";rail.appendChild(empty);}
    icons();
  }
  async function selectCommunity(community) {
    activeCommunity=community;
    const wall=community.banner_data||community.icon||"";
    const area=$(".conversation-area");
    if(area){if(wall) area.style.setProperty("--server-wallpaper",`url("${wall}")`);else area.style.removeProperty("--server-wallpaper");}
    railMode="servers";
    $("#railHomeButton").classList.add("active"); $("#railFriendsButton").classList.remove("active");
    document.querySelectorAll(".rail-community").forEach(el=>el.classList.remove("active"));
    [...document.querySelectorAll(".rail-community")].find(el=>el.title===community.name)?.classList.add("active");
    $("#welcomeContent")?.classList.add("hidden");
    $(".welcome-content").classList.add("hidden");
    $("#chatWorkspace").classList.remove("hidden");
    $("#activeCommunityName").textContent=community.name;
    renderCommunities();
    if (community.channels.length) selectChannel(community.channels[0]);
    else { $("#activeChannelName").textContent="sem-canais"; $("#messageList").innerHTML='<div class="chat-empty">Crie um canal para começar.</div>'; }
  }
  function voiceAvatar(user){const name=user.display_name||user.username||"V";return user.avatar_data?`<span class="voice-avatar has-photo" style="background-image:url('${user.avatar_data.replace(/'/g,"%27")}')"></span>`:`<span class="voice-avatar">${escapeHtml(name.slice(0,1).toUpperCase())}</span>`;}
  function openVoiceJoin(){
    if(!activeChannel||activeChannel.kind!=="voice")return;
    $("#voiceJoinTitle").textContent=`Conectar a ${activeChannel.name}?`;
    $("#voiceJoinOverlay").classList.remove("hidden");$("#voiceJoinOverlay").setAttribute("aria-hidden","false");icons();
  }
  function closeVoiceJoin(){$("#voiceJoinOverlay").classList.add("hidden");$("#voiceJoinOverlay").setAttribute("aria-hidden","true");}
  function renderVoiceChannel(participants=[]){
    const mine=voice.channelId===activeChannel?.id;
    const list=participants.length?participants:(mine?[{...profileState,id:profileState.id}]:[]);
    voice.participantSignature=JSON.stringify(list.map(u=>Number(u.id)).sort((a,b)=>a-b));
    $("#messageList").innerHTML=`<section class="voice-room"><div class="voice-room-heading"><span class="voice-room-symbol"><i data-lucide="headphones"></i></span><div><strong>${escapeHtml(activeChannel?.name||"Canal de voz")}</strong><small>${mine?`${list.length} conectado(s)`:"Conecte-se para conversar"}</small></div><span class="voice-live-dot"></span></div><div class="voice-participant-grid" id="voiceParticipantGrid">${list.map(u=>`<div class="voice-participant" data-voice-user="${u.id}">${voiceAvatar(u)}<strong>${escapeHtml(u.display_name||u.username||"Você")}</strong><small>${Number(u.id)===Number(profileState?.id)?(voice.muted?"Microfone desligado":"Conectado") : "Conectado"}</small><audio data-voice-audio="${u.id}" autoplay playsinline></audio></div>`).join("")}</div><div class="voice-room-empty ${mine?"hidden":""}"><i data-lucide="radio-tower"></i><strong>Entre na conversa</strong><span>Conecte-se para aparecer aqui e conversar com os membros.</span><button class="primary-button" id="voiceConnectButton"><i data-lucide="phone"></i> Conectar</button></div>${mine?`<div class="voice-controls"><button type="button" id="voiceMicButton" class="${voice.muted?"is-off":""}"><i data-lucide="${voice.muted?"mic-off":"mic"}"></i><span>${voice.muted?"Ativar mic":"Mutar mic"}</span></button><button type="button" id="voiceDeafenButton" class="${voice.deafened?"is-off":""}"><i data-lucide="${voice.deafened?"volume-x":"headphones"}"></i><span>${voice.deafened?"Ouvir":"Silenciar"}</span></button><button type="button" id="voiceDevicesButton"><i data-lucide="settings-2"></i><span>Dispositivos</span></button><button type="button" id="voiceShareButton"><i data-lucide="monitor-up"></i><span>Compartilhar tela</span></button><button type="button" id="voiceLeaveButton" class="voice-leave"><i data-lucide="phone-off"></i><span>Sair</span></button></div><div class="voice-device-panel hidden" id="voiceDevicePanel"><label class="hidden" id="voiceInputWrap">Microfone<select id="voiceInputDevice"></select></label><label class="hidden" id="voiceOutputWrap">Saída de áudio<select id="voiceOutputDevice"></select></label></div><div class="voice-screen-grid" id="voiceScreenGrid"></div>`:""}</section>`;
    icons(); if(mine)updateVoiceSpeakingUI();
  }
  function ensureVoiceAudioContext(){if(!voice.audioContext){const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return null;voice.audioContext=new Ctx();}if(voice.audioContext.state==="suspended")voice.audioContext.resume().catch(()=>{});return voice.audioContext;}
  function makeVoiceAnalyser(stream){const ctx=ensureVoiceAudioContext();if(!ctx||!stream?.getAudioTracks().length)return null;try{const source=ctx.createMediaStreamSource(stream),analyser=ctx.createAnalyser();analyser.fftSize=512;analyser.smoothingTimeConstant=.78;source.connect(analyser);return {source,analyser,data:new Uint8Array(analyser.fftSize)};}catch{return null;}}
  function analyserIsSpeaking(entry){if(!entry)return false;entry.analyser.getByteTimeDomainData(entry.data);let sum=0;for(const v of entry.data){const n=(v-128)/128;sum+=n*n;}return Math.sqrt(sum/entry.data.length)>.035;}
  function updateVoiceSpeakingUI(){if(!voice.channelId)return;const ownId=Number(profileState?.id),ownSpeaking=!voice.muted&&analyserIsSpeaking(voice.localAnalyser),ownCard=document.querySelector(`[data-voice-user="${ownId}"]`);ownCard?.classList.toggle("is-speaking",ownSpeaking);const ownLabel=ownCard?.querySelector("small");if(ownLabel)ownLabel.textContent=voice.muted?"Microfone desligado":(ownSpeaking?"Falando":"Conectado");for(const [id,entry] of voice.remoteAnalysers){document.querySelector(`[data-voice-user="${id}"]`)?.classList.toggle("is-speaking",analyserIsSpeaking(entry));}}
  async function voiceApi(path,data={},method="POST"){return api(path,data,method);}
  async function sendVoiceSignal(toUserId,type,payload){if(!voice.channelId)return;try{await voiceApi(`/api/voice/${voice.channelId}/signal`,{toUserId,type,payload});}catch(e){console.warn("voice signal",e.message);}}
  function makePeer(userId){
    if(voice.peers.has(userId))return voice.peers.get(userId);
    const pc=new RTCPeerConnection({iceServers:voice.iceServers});
    voice.stream?.getTracks().forEach(track=>pc.addTrack(track,voice.stream));
    // Reserva a faixa de vídeo na negociação inicial para evitar renegociações concorrentes ao iniciar a tela.
    const videoTx=pc.addTransceiver("video",{direction:"sendrecv"});
    if(voice.screen?.getVideoTracks()[0])videoTx.sender.replaceTrack(voice.screen.getVideoTracks()[0]).catch(()=>{});
    pc.onicecandidate=e=>{if(e.candidate)sendVoiceSignal(userId,"ice",e.candidate.toJSON());};
    pc.ontrack=e=>{const card=document.querySelector(`[data-voice-user="${userId}"]`);if(e.track.kind==="audio"){const stream=e.streams[0]||new MediaStream([e.track]),node=card?.querySelector("audio");if(node){node.srcObject=stream;node.muted=voice.deafened;if(typeof node.setSinkId==="function")node.setSinkId(voice.outputDeviceId||"").catch(()=>{});node.play().catch(()=>{});}voice.remoteAnalysers.set(Number(userId),makeVoiceAnalyser(stream));}else if(e.track.kind==="video"&&card){let video=card.querySelector("video");if(!video){video=document.createElement("video");video.autoplay=true;video.playsInline=true;video.controls=false;card.prepend(video);}video.srcObject=e.streams[0]||new MediaStream([e.track]);video.play().catch(()=>{});}};
    pc.onconnectionstatechange=()=>{if(["failed","closed"].includes(pc.connectionState)){pc.close();voice.peers.delete(userId);voice.remoteAnalysers.delete(Number(userId));}};
    voice.peers.set(userId,pc);return pc;
  }
  async function negotiateVoicePeer(user){
    const id=Number(user.id);if(id===Number(profileState?.id)||voice.peers.has(id))return;
    // Apenas o participante com menor ID inicia a oferta, evitando ofertas simultâneas.
    if(Number(profileState.id)>id)return;
    const pc=makePeer(id);const offer=await pc.createOffer();await pc.setLocalDescription(offer);await sendVoiceSignal(id,"offer",pc.localDescription.toJSON());
  }
  async function processVoiceSignals(signals){
    for(const sig of signals){voice.signalAfter=Math.max(voice.signalAfter,Number(sig.id));const id=Number(sig.from_user_id);let pc=voice.peers.get(id);
      try{
        if(sig.signal_type==="offer") {pc=makePeer(id);await pc.setRemoteDescription(new RTCSessionDescription(sig.payload));const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await sendVoiceSignal(id,"answer",pc.localDescription.toJSON());}
        else if(sig.signal_type==="answer"&&pc){await pc.setRemoteDescription(new RTCSessionDescription(sig.payload));}
        else if(sig.signal_type==="ice"&&pc&&sig.payload){await pc.addIceCandidate(new RTCIceCandidate(sig.payload));}
        else if(sig.signal_type==="hangup"&&pc){pc.close();voice.peers.delete(id);}
      }catch(e){console.warn("voice negotiation",e);}
    }
  }
  async function pollVoice(){
    if(!voice.channelId)return;
    try{await voiceApi(`/api/voice/${voice.channelId}/join`,{});const state=await voiceApi(`/api/voice/${voice.channelId}/state?after=${voice.signalAfter}`,{},"GET");
      const participants=state.participants||[];const signature=JSON.stringify(participants.map(u=>Number(u.id)).sort((a,b)=>a-b));if(signature!==voice.participantSignature)renderVoiceChannel(participants);
      const activeIds=new Set(participants.map(u=>Number(u.id)));
      for(const [id,pc] of voice.peers){if(!activeIds.has(id)){pc.close();voice.peers.delete(id);}}
      for(const user of participants)await negotiateVoicePeer(user);
      await processVoiceSignals(state.signals||[]);
      // Reanexa streams remotos após a atualização da lista de participantes.
      for(const [id,pc] of voice.peers){const receivers=pc.getReceivers().filter(r=>r.track);const audioTrack=receivers.find(r=>r.track.kind==="audio")?.track;const card=document.querySelector(`[data-voice-user="${id}"]`);const el=card?.querySelector("audio");if(audioTrack&&el&&!el.srcObject){el.srcObject=new MediaStream([audioTrack]);el.muted=voice.deafened;if(typeof el.setSinkId==="function")el.setSinkId(voice.outputDeviceId||"").catch(()=>{});el.play().catch(()=>{});voice.remoteAnalysers.set(Number(id),makeVoiceAnalyser(el.srcObject));}const videoTrack=receivers.find(r=>r.track.kind==="video")?.track;if(videoTrack&&card&&!card.querySelector("video")){const video=document.createElement("video");video.autoplay=true;video.playsInline=true;video.srcObject=new MediaStream([videoTrack]);card.prepend(video);}}
    }catch(e){toast(e.message,true);leaveVoice(false);}
  }
  async function connectVoice(){
    if(voice.joining||!activeChannel||activeChannel.kind!=="voice")return;voice.joining=true;
    try{
      if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error("O áudio ao vivo exige HTTPS ou localhost. Abra o Veyronix por um endereço seguro.");
      try{const cfg=await voiceApi("/api/voice/config",{},"GET");if(Array.isArray(cfg.iceServers)&&cfg.iceServers.length)voice.iceServers=cfg.iceServers;}catch{}
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      voice.channelId=activeChannel.id;voice.stream=stream;voice.muted=true;stream.getAudioTracks().forEach(t=>t.enabled=false);voice.localAnalyser=makeVoiceAnalyser(stream);if(voice.levelTimer)clearInterval(voice.levelTimer);voice.levelTimer=setInterval(updateVoiceSpeakingUI,120);
      await voiceApi(`/api/voice/${voice.channelId}/join`,{});closeVoiceJoin();renderVoiceChannel([{...profileState,id:profileState.id}]);
      voice.poll=setInterval(pollVoice,1400);await pollVoice();toast("Conectado ao canal de voz.",false,true);
    }catch(e){voice.stream?.getTracks().forEach(t=>t.stop());voice.stream=null;voice.channelId=null;toast(e.message||"Não foi possível conectar ao canal.",true);}
    finally{voice.joining=false;}
  }
  async function leaveVoice(notify=true){
    const channelId=voice.channelId;if(!channelId)return;
    if(voice.poll)clearInterval(voice.poll);voice.poll=null;
    for(const [id,pc] of voice.peers){if(notify)await sendVoiceSignal(id,"hangup",{});pc.close();}voice.peers.clear();
    voice.screen?.getTracks().forEach(t=>t.stop());voice.screen=null;voice.stream?.getTracks().forEach(t=>t.stop());voice.stream=null;
    voice.channelId=null;voice.signalAfter=0;voice.muted=true;voice.deafened=false;voice.localAnalyser=null;voice.remoteAnalysers.clear();if(voice.levelTimer)clearInterval(voice.levelTimer);voice.levelTimer=null;if(voice.audioContext){voice.audioContext.close().catch(()=>{});voice.audioContext=null;}
    try{await voiceApi(`/api/voice/${channelId}/leave`,{});}catch{}
    if(activeChannel?.id===channelId)renderVoiceChannel([]);
  }
  async function toggleVoiceMic(){
    if(!voice.stream)return;voice.muted=!voice.muted;voice.stream.getAudioTracks().forEach(t=>t.enabled=!voice.muted);
    const button=$("#voiceMicButton");if(button){button.classList.toggle("is-off",voice.muted);button.innerHTML=`<i data-lucide="${voice.muted?"mic-off":"mic"}"></i><span>${voice.muted?"Ativar mic":"Mutar mic"}</span>`;icons();}updateVoiceSpeakingUI();
  }
  function toggleDeafen(){
    voice.deafened=!voice.deafened;document.querySelectorAll("[data-voice-audio]").forEach(a=>a.muted=voice.deafened);
    const button=$("#voiceDeafenButton");if(button){button.classList.toggle("is-off",voice.deafened);button.innerHTML=`<i data-lucide="${voice.deafened?"volume-x":"headphones"}"></i><span>${voice.deafened?"Ouvir":"Silenciar"}</span>`;icons();}
  }
  async function loadVoiceDevices(){
    const panel=$("#voiceDevicePanel");
    try{
      if(!navigator.mediaDevices?.enumerateDevices)throw new Error("API de dispositivos indisponível");
      const devices=await navigator.mediaDevices.enumerateDevices();
      const externalName=/(bluetooth|headset|headphone|hands.?free|usb|airpods|buds|wireless|earphone|fone|extern[oa]|hdmi|display audio|webcam|pnp)/i;
      const valid=(d)=>d.deviceId&&d.deviceId!=="default"&&d.deviceId!=="communications";
      const inputs=devices.filter(d=>d.kind==="audioinput"&&valid(d)&&externalName.test(d.label||""));
      const canChooseOutput=typeof HTMLMediaElement.prototype.setSinkId==="function";
      const outputs=devices.filter(d=>d.kind==="audiooutput"&&valid(d)&&externalName.test(d.label||""));
      const inputWrap=$("#voiceInputWrap"),outputWrap=$("#voiceOutputWrap");
      const hasInput=inputs.length>0;
      const hasOutput=canChooseOutput&&outputs.length>0;
      inputWrap.classList.toggle("hidden",!hasInput);
      outputWrap.classList.toggle("hidden",!hasOutput);
      if(hasInput){
        $("#voiceInputDevice").innerHTML=inputs.map((d,i)=>`<option value="${escapeHtml(d.deviceId)}">${escapeHtml(d.label||`Microfone ${i+1}`)}</option>`).join("");
      }
      if(hasOutput){
        $("#voiceOutputDevice").innerHTML=outputs.map((d,i)=>`<option value="${escapeHtml(d.deviceId)}">${escapeHtml(d.label||`Saída ${i+1}`)}</option>`).join("");
        if(outputs.some(d=>d.deviceId===voice.outputDeviceId))$("#voiceOutputDevice").value=voice.outputDeviceId;
        else $("#voiceOutputDevice").value=outputs[0].deviceId;
      }
      if(!hasInput&&!hasOutput){
        panel.classList.add("hidden");
        toast("Nenhum dispositivo de áudio adicional compatível foi detectado. O áudio continuará usando o padrão do aparelho.",false,true);
        return;
      }
      panel.classList.remove("hidden");
    }catch{panel.classList.add("hidden");toast("Não foi possível detectar dispositivos de áudio.",true);}
  }
  async function changeVoiceInput(deviceId){
    if(!deviceId||!voice.stream)return;
    try{const next=await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:deviceId},echoCancellation:true,noiseSuppression:true},video:false});const track=next.getAudioTracks()[0];track.enabled=!voice.muted;
      for(const pc of voice.peers.values()){const sender=pc.getSenders().find(s=>s.track?.kind==="audio");if(sender)await sender.replaceTrack(track);}
      voice.stream.getAudioTracks().forEach(t=>t.stop());voice.stream.removeTrack(voice.stream.getAudioTracks()[0]);voice.stream.addTrack(track);next.getTracks().filter(t=>t!==track).forEach(t=>t.stop());voice.localAnalyser?.source?.disconnect();voice.localAnalyser=makeVoiceAnalyser(voice.stream);toast("Microfone alterado.",false,true);
    }catch{toast("Não foi possível trocar o microfone.",true);}
  }
  async function changeVoiceOutput(deviceId){
    const audios=[...document.querySelectorAll("[data-voice-audio]")];
    if(!audios.length){voice.outputDeviceId=deviceId||"";toast("Saída salva para esta chamada.",false,true);return;}
    let ok=false;
    for(const audio of audios){if(typeof audio.setSinkId==="function"){try{await audio.setSinkId(deviceId||"");ok=true;}catch{}}}
    if(!ok)toast("Este navegador não permite selecionar a saída. Use o seletor de áudio do Android ou do sistema.",true);
    else{voice.outputDeviceId=deviceId||"";toast("Saída de áudio alterada.",false,true);}
  }
  async function toggleScreenShare(){
    if(!voice.channelId)return;const button=$("#voiceShareButton");
    if(voice.screen){voice.screen.getTracks().forEach(t=>t.stop());voice.screen=null;for(const pc of voice.peers.values()){const sender=pc.getSenders().find(s=>s.track?.kind==="video")||pc.getTransceivers().find(t=>t.receiver.track.kind==="video")?.sender;if(sender)await sender.replaceTrack(null).catch(()=>{});}button?.classList.remove("is-active");toast("Compartilhamento encerrado.",false,true);return;}
    const capture=navigator.mediaDevices?.getDisplayMedia;
    if(!capture){toast("Este navegador no Android não oferece captura de tela por páginas web. No computador, use um navegador compatível. Para compartilhar a tela do celular, será necessária a versão Android nativa do Veyronix.",true);return;}
    try{
      // Deve ser chamado diretamente pelo toque do usuário para abrir o seletor de captura do navegador.
      const stream=await capture.call(navigator.mediaDevices,{video:{frameRate:{ideal:15,max:30}},audio:false});
      const track=stream.getVideoTracks()[0];if(!track)throw new Error("O navegador não forneceu vídeo para compartilhar.");voice.screen=stream;
      for(const pc of voice.peers.values()){const sender=pc.getSenders().find(s=>s.track?.kind==="video")||pc.getTransceivers().find(t=>t.receiver.track.kind==="video")?.sender;if(sender)await sender.replaceTrack(track);}
      track.onended=()=>{voice.screen=null;for(const pc of voice.peers.values()){const sender=pc.getSenders().find(s=>s.track?.kind==="video")||pc.getTransceivers().find(t=>t.receiver.track.kind==="video")?.sender;sender?.replaceTrack(null).catch(()=>{});}$("#voiceShareButton")?.classList.remove("is-active");};button?.classList.add("is-active");toast("Tela sendo compartilhada.",false,true);
    }catch(e){voice.screen?.getTracks().forEach(t=>t.stop());voice.screen=null;const android=/Android/i.test(navigator.userAgent);const msg=android?"O navegador Android não permite compartilhar a tela por uma página web. Para isso, o Veyronix precisará de uma versão Android nativa.":e.name==="NotAllowedError"?"Compartilhamento cancelado ou bloqueado pelo navegador.":e.name==="NotFoundError"?"Nenhuma tela disponível para compartilhar.":(e.message||"Não foi possível compartilhar a tela neste navegador.");toast(msg,true);}
  }


  async function selectChannel(channel) {
    if(voice.channelId && voice.channelId!==channel.id) await leaveVoice();
    activeChannel=channel; lastMessageId=0;
    renderCommunities();
    $("#activeChannelName").textContent=channel.name;
    $(".chat-hash").textContent=channel.kind==="voice"?"◖))":"#";
    $("#activeCommunityName").textContent=activeCommunity?.name || "";
    $("#chatWorkspace").classList.remove("hidden"); $(".welcome-content").classList.add("hidden");
    $("#messageForm").classList.toggle("hidden",channel.kind==="voice");
    $("#messageList").innerHTML="";
    if (messagePoll) clearInterval(messagePoll);messagePoll=null;
    if(channel.kind==="voice"){
      renderVoiceChannel();
      if(voice.channelId===channel.id) return;
      openVoiceJoin();
      icons();return;
    }
    await refreshMessages(true);
    messagePoll=setInterval(()=>refreshMessages(false),3500);
  }
  async function refreshMessages(initial=false) {
    if (!activeChannel) return;
    try {
      const result=await api(`/api/channels/${activeChannel.id}/messages?after=${initial?0:lastMessageId}`,{},"GET");
      const list=$("#messageList");
      if(initial) list.innerHTML="";
      (result.messages||[]).forEach(m=>{
        if(m.id<=lastMessageId) return;
        list.querySelector(".channel-start-state")?.remove();
        const item=document.createElement("article"); item.className="chat-message";
        const name=m.display_name || m.username;
        const avatarStyle = m.avatar_data ? `style="background-image:url('${m.avatar_data}')"` : "";
        item.innerHTML=`<button class="message-avatar profile-open${m.avatar_data?" has-image":""}" data-username="${escapeHtml(m.username)}" ${avatarStyle}>${m.avatar_data?"":escapeHtml((name||"V").slice(0,1).toUpperCase())}</button><div class="message-body"><div class="message-meta"><button class="message-author profile-open" data-username="${escapeHtml(m.username)}"${m.primary_role_color?` style="color:${escapeHtml(m.primary_role_color)}"`:""}>${escapeHtml(name)}</button>${m.is_beta?'<span class="beta-text-tag">BETA</span>':""}<time>${new Date(m.created_at.replace(" ","T")+"Z").toLocaleString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</time></div><p>${escapeHtml(m.content).replace(/\n/g,"<br>")}</p></div>${Number(m.user_id)===Number(profileState?.id)?`<button class="message-more-button" type="button" aria-label="Opções da mensagem" aria-haspopup="menu" aria-expanded="false" data-message-more="${m.id}"><i data-lucide="more-horizontal"></i></button>`:""}`;
        list.appendChild(item); lastMessageId=m.id;
      });
      if(initial && lastMessageId===0 && !(result.messages||[]).length){
        list.innerHTML='<div class="chat-empty channel-start-state"><span class="channel-start-icon"><i data-lucide="messages-square"></i></span><strong>Este é o começo de #'+escapeHtml(activeChannel.name)+'</strong><p>Envie a primeira mensagem para iniciar a conversa.</p></div>';
      }
      if(initial || (result.messages||[]).length) list.scrollTop=list.scrollHeight;
      icons();
    } catch(error) { if(initial) toast(error.message,true); }
  }

  // Menu de mensagem: renderizado no body para não ser cortado pelo scroll do chat.
  let openedMessageMenu = null;
  function closeMessageMenu(){
    if(!openedMessageMenu) return;
    const {menu,button}=openedMessageMenu;
    menu.remove();
    button?.setAttribute("aria-expanded","false");
    openedMessageMenu=null;
  }
  function positionMessageMenu(menu, button){
    const rect=button.getBoundingClientRect(), width=menu.offsetWidth||184, height=menu.offsetHeight||88;
    const left=Math.max(8,Math.min(window.innerWidth-width-8,rect.right-width));
    const below=rect.bottom+6, top=below+height<=window.innerHeight-8?below:Math.max(8,rect.top-height-6);
    menu.style.left=`${left}px`;menu.style.top=`${top}px`;
  }
  async function copyMessageText(value){
    try{
      if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {const field=document.createElement("textarea");field.value=value;field.style.position="fixed";field.style.opacity="0";document.body.appendChild(field);field.select();const ok=document.execCommand("copy");field.remove();if(!ok)throw new Error("Cópia indisponível neste navegador.");}
      toast("Texto da mensagem copiado.",false,true);
    }catch(err){toast("Não foi possível copiar. Verifique a permissão do navegador.",true);}
  }
  document.addEventListener("click",async e=>{
    const more=e.target.closest("[data-message-more]");
    if(more){
      e.preventDefault();e.stopPropagation();
      if(openedMessageMenu?.button===more){closeMessageMenu();return;}
      closeMessageMenu();
      const message=more.closest(".chat-message"), body=message?.querySelector(".message-body p");
      if(!message||!body||!activeChannel)return;
      const channelId=activeChannel.id, messageId=Number(more.dataset.messageMore), text=body.innerText||body.textContent||"";
      const menu=document.createElement("div");menu.className="message-mini-menu";menu.setAttribute("role","menu");menu.innerHTML='<button type="button" role="menuitem" data-copy-own-message><i data-lucide="copy"></i><span>Copiar texto</span></button><div class="message-menu-divider"></div><button type="button" role="menuitem" class="danger" data-delete-own-message><i data-lucide="trash-2"></i><span>Excluir mensagem</span></button>';
      document.body.appendChild(menu);more.setAttribute("aria-expanded","true");openedMessageMenu={menu,button:more};icons();positionMessageMenu(menu,more);
      menu.addEventListener("click",async action=>{
        action.stopPropagation();
        const copy=action.target.closest("[data-copy-own-message]"), remove=action.target.closest("[data-delete-own-message]");
        if(copy){closeMessageMenu();await copyMessageText(text);return;}
        if(remove){const button=remove;button.disabled=true;button.querySelector("span").textContent="Excluindo…";
          try{await api(`/api/channels/${channelId}/messages/${messageId}`,{},"DELETE");closeMessageMenu();if(activeChannel?.id===channelId){lastMessageId=0;await refreshMessages(true);}toast("Mensagem excluída.",false,true);}
          catch(err){button.disabled=false;button.querySelector("span").textContent="Excluir mensagem";toast(err.message,true);}
        }
      });
      return;
    }
    if(!e.target.closest(".message-mini-menu"))closeMessageMenu();
  },true);
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeMessageMenu();});
  window.addEventListener("resize",()=>{if(openedMessageMenu)positionMessageMenu(openedMessageMenu.menu,openedMessageMenu.button);});
  document.addEventListener("visibilitychange",()=>{if(document.hidden)closeMessageMenu();});
  window.visualViewport?.addEventListener("resize",()=>{if(openedMessageMenu)positionMessageMenu(openedMessageMenu.menu,openedMessageMenu.button);});
  $("#messageList").addEventListener("scroll",closeMessageMenu,{passive:true});

  let viewedUsername = "";
  async function openPublicProfile(username) {
    viewedUsername = username;
    try {
      const result = await api(`/api/users/${encodeURIComponent(username)}`, {}, "GET");
      const user = result.user;
      const overlay=$("#publicProfileOverlay");$("#serverProfileRoles").classList.add("hidden");
      const banner=$("#publicProfileBanner"), avatar=$("#publicProfileAvatar");
      banner.style.backgroundImage=user.banner_data ? `url("${user.banner_data}")` : "";
      banner.classList.toggle("has-cover", !!user.banner_data);
      avatar.style.backgroundImage=user.avatar_data ? `url("${user.avatar_data}")` : "";
      avatar.textContent=user.avatar_data ? "" : (user.display_name || user.username).slice(0,1).toUpperCase();
      $("#publicProfileName").textContent=(user.display_name || user.username).slice(0,20);
      $("#publicProfileBetaTag").classList.toggle("hidden", !user.is_beta);
      $("#publicProfileUsername").textContent="@"+user.username;
      $("#publicProfileBio").textContent=user.bio || "Este usuário ainda não adicionou uma descrição.";
      $("#publicProfileSince").textContent=new Date(user.created_at.replace(" ","T")+"Z").toLocaleDateString("pt-BR");
      overlay.classList.remove("hidden"); overlay.setAttribute("aria-hidden","false"); icons();
    } catch(error) { toast(error.message,true); }
  }
  document.addEventListener("click", e => {
    const trigger=e.target.closest(".profile-open");
    if(trigger) openPublicProfile(trigger.dataset.username);
  });
  function closePublicProfile(){ const o=$("#publicProfileOverlay"); o.classList.add("hidden"); o.setAttribute("aria-hidden","true"); $("#serverProfileRoles").classList.add("hidden"); }
  $("#closePublicProfile").addEventListener("click",closePublicProfile);
  let serverMemberCache=[], serverRoleCatalog=[], selectedServerMember=null;
  async function openMembers(){
    if(!activeCommunity){toast("Entre em um servidor primeiro.",true);return;}
    $("#membersTitle").textContent="Membros — "+activeCommunity.name;
    $("#membersSubtitle").textContent="Pessoas deste servidor, organizadas por cargos.";
    $("#membersFilter").value="";$("#membersList").innerHTML='<p class="social-muted">Carregando membros...</p>';
    const overlay=$("#membersOverlay");overlay.classList.remove("hidden");overlay.setAttribute("aria-hidden","false");
    try{const r=await api(`/api/communities/${activeCommunity.id}/members`,{},"GET");serverMemberCache=r.members||[];serverRoleCatalog=r.roles||[];$("#createServerRole").classList.toggle("hidden",!(["owner","admin"].includes(activeCommunity?.role)));renderServerMembers();}
    catch(e){$("#membersList").innerHTML=`<p class="social-muted">${escapeHtml(e.message)}</p>`;}
  }
  function renderServerMembers(){
    const query=$("#membersFilter").value.trim().toLowerCase(),list=$("#membersList");list.innerHTML="";
    const filtered=serverMemberCache.filter(u=>(u.display_name||u.username).toLowerCase().includes(query)||u.username.toLowerCase().includes(query));
    const buckets=new Map(), roleOrder=[...serverRoleCatalog].sort((a,b)=>b.position-a.position||a.id-b.id);
    roleOrder.forEach(role=>buckets.set(`role-${role.id}`,{name:role.name,color:role.color,users:[],position:role.position}));
    const fallback=new Map();
    filtered.forEach(user=>{
      const primary=(user.roles||[]).slice().sort((a,b)=>a.id-b.id)[0];
      if(primary && buckets.has(`role-${primary.id}`)) buckets.get(`role-${primary.id}`).users.push(user);
      else {
        const key=user.base_role==="owner"?"base-owner":user.base_role==="admin"?"base-admin":"base-member";
        if(!fallback.has(key))fallback.set(key,{name:user.base_role==="owner"?"PROPRIETÁRIO":user.base_role==="admin"?"ADMINISTRADORES":"MEMBROS",color:user.base_role==="owner"?"#f0c66e":user.base_role==="admin"?"#d58cff":"#8d91a8",users:[],position:-1});
        fallback.get(key).users.push(user);
      }
    });
    const groups=[...roleOrder.map(r=>buckets.get(`role-${r.id}`)).filter(b=>b.users.length),...["base-owner","base-admin","base-member"].map(k=>fallback.get(k)).filter(Boolean)];
    if(!groups.length){list.innerHTML='<p class="social-muted">Nenhum membro encontrado.</p>';return;}
    groups.forEach(bucket=>{
      const section=document.createElement("section");section.className="member-role-group";
      const title=document.createElement("div");title.className="member-role-heading";
      title.innerHTML=`<span style="--role-color:${bucket.color}"></span>${escapeHtml(bucket.name)} <small>${bucket.users.length}</small>`;
      section.appendChild(title);
      bucket.users.forEach(user=>{
        const row=document.createElement("button");row.type="button";row.className="server-member-row";
        const avatar=document.createElement("span");avatar.className="server-member-avatar";
        if(user.avatar_data){avatar.style.backgroundImage=`url("${user.avatar_data}")`;avatar.classList.add("has-image");}else avatar.textContent=(user.display_name||user.username).slice(0,1).toUpperCase();
        const info=document.createElement("span");info.className="server-member-info";
        const primary=(user.roles||[]).slice().sort((a,b)=>a.id-b.id)[0];
        info.innerHTML=`<strong${primary?` style="color:${escapeHtml(primary.color)}"`:""}>${escapeHtml(user.display_name||user.username)}</strong><small>@${escapeHtml(user.username)}</small>`;
        row.append(avatar,info);
        row.addEventListener("click",()=>{selectedServerMember=user;closeMembers();openPublicProfile(user.username).then(()=>{
          $("#manageServerRoles").classList.toggle("hidden",!(["owner","admin"].includes(activeCommunity?.role))||(user.base_role==="owner" && !(activeCommunity?.role==="owner" && Number(user.id)===Number(profileState?.id))));
          const wrap=$("#serverProfileRoles"),chips=$("#serverProfileRoleList");chips.innerHTML="";
          (user.roles||[]).forEach(role=>{const chip=document.createElement("span");chip.className="server-role-chip";chip.style.setProperty("--role-color",role.color);chip.textContent=role.name;chips.appendChild(chip);});
          wrap.classList.toggle("hidden",!(user.roles||[]).length);
        });});
        section.appendChild(row);
      });
      list.appendChild(section);
    });
    icons();
  }
  function closeMembers(){const o=$("#membersOverlay");o.classList.add("hidden");o.setAttribute("aria-hidden","true");}
  $("#openMembersButton").addEventListener("click",openMembers);
  $("#closeMembers").addEventListener("click",closeMembers);
  $("#membersOverlay").addEventListener("click",e=>{if(e.target.id==="membersOverlay")closeMembers();});
  $("#membersFilter").addEventListener("input",renderServerMembers);
  $("#createServerRole").addEventListener("click",async()=>{if(!activeCommunity)return;const name=await askDialog({title:"Criar cargo",description:"Adicione um cargo para organizar os membros do servidor.",label:"Nome do cargo",placeholder:"Ex.: Moderador",confirm:"Criar cargo"});if(!name)return;try{await api(`/api/communities/${activeCommunity.id}/roles`,{name,color:"#9b8cff"});const r=await api(`/api/communities/${activeCommunity.id}/members`,{},"GET");serverRoleCatalog=r.roles||[];serverMemberCache=r.members||[];renderServerMembers();toast("Cargo criado.",false,true);}catch(e){toast(e.message,true);}});
  $("#manageServerRoles").addEventListener("click",async()=>{
    if(!activeCommunity||!selectedServerMember)return;
    if(!["owner","admin"].includes(activeCommunity.role)){toast("Somente a equipe pode gerenciar cargos.",true);return;}
    if(selectedServerMember.base_role==="owner" && !(activeCommunity.role==="owner" && Number(selectedServerMember.id)===Number(profileState?.id))){toast("Somente o proprietário pode gerenciar os próprios cargos.",true);return;}
    if(!serverRoleCatalog.length){toast("Crie um cargo primeiro nas configurações do servidor.",true);return;}
    const overlay=document.createElement("div");overlay.className="role-picker-overlay";
    const card=document.createElement("section");card.className="role-picker-card";
    const options=serverRoleCatalog.map(r=>`<option value="${r.id}">${escapeHtml(r.name)}</option>`).join("");
    const currentRoles=(selectedServerMember.roles||[]).map(r=>`<span class="server-role-chip" style="--role-color:${r.color}">${escapeHtml(r.name)}</span>`).join("");
    card.innerHTML=`<button type="button" class="role-picker-close" aria-label="Fechar">×</button><span class="mini-label">GERENCIAR MEMBRO</span><h3>Cargos de ${escapeHtml(selectedServerMember.display_name||selectedServerMember.username)}</h3><p>Adicione ou remova cargos deste perfil. As alterações são salvas no servidor.</p><div class="role-picker-current">${currentRoles||'<small>Este membro ainda não tem cargos personalizados.</small>'}</div><label>Cargo<select id="rolePickerSelect">${options}</select></label><div class="role-picker-actions"><button type="button" id="rolePickerAdd" class="primary-button compact"><i data-lucide="plus"></i> Adicionar</button><button type="button" id="rolePickerRemove" class="secondary-button compact">Remover</button></div>`;
    overlay.appendChild(card);document.body.appendChild(overlay);icons();
    const close=()=>overlay.remove();card.querySelector(".role-picker-close").addEventListener("click",close);overlay.addEventListener("click",e=>{if(e.target===overlay)close();});
    const apply=async remove=>{const roleId=Number(card.querySelector("#rolePickerSelect").value);const url=`/api/communities/${activeCommunity.id}/members/${selectedServerMember.id}/roles/${roleId}`;try{if(remove)await api(url,{},"DELETE");else await api(`/api/communities/${activeCommunity.id}/members/${selectedServerMember.id}/roles`,{roleId});toast(remove?"Cargo removido.":"Cargo atribuído.",false,true);close();closePublicProfile();await openMembers();}catch(e){toast(e.message,true);}};
    card.querySelector("#rolePickerAdd").addEventListener("click",()=>apply(false));card.querySelector("#rolePickerRemove").addEventListener("click",()=>apply(true));
  });

  $("#mobileChannelsButton").addEventListener("click",()=>{const sidebar=$(".channel-sidebar");const opening=!sidebar.classList.contains("mobile-open");sidebar.classList.toggle("mobile-open",opening);sidebar.classList.toggle("channels-only",opening);});
  $("#createCategoryButton").addEventListener("click",async()=>{if(!activeCommunity){toast("Selecione um servidor.",true);return;}const name=await askDialog({title:"Nova categoria",description:"Organize seus canais em uma seção.",label:"Nome da categoria",placeholder:"Ex.: COMUNIDADE",confirm:"Criar categoria"});if(!name)return;try{await api(`/api/communities/${activeCommunity.id}/categories`,{name});await loadCommunities();activeCommunity=communities.find(c=>c.id===activeCommunity.id)||activeCommunity;toast("Categoria criada.",false,true);}catch(e){toast(e.message,true);}});

  $("#publicProfileMessage").addEventListener("click",async()=>{
    if(!viewedUsername)return;
    try{
      const r=await api("/api/friends/search?username="+encodeURIComponent(viewedUsername),{},"GET");
      if(r.user?.relationship!=="friends"){toast("Adicione essa pessoa como amiga para enviar mensagem privada.",true);return;}
      closePublicProfile();openDm({id:r.user.id,username:r.user.username,display_name:r.user.display_name});
    }catch(e){toast(e.message,true);}
  });

  $("#publicProfileOverlay").addEventListener("click",e=>{if(e.target.id==="publicProfileOverlay")closePublicProfile();});

  // Diálogos próprios do Veyronix: evita os alertas nativos do navegador/Android.
  let dialogResolve=null;
  function askDialog({title,description,label,placeholder="",confirm="Continuar",value=""}){
    const overlay=$("#actionDialog"), input=$("#actionDialogInput"), kindSelect=$("#actionDialogChannelKind");
    if(kindSelect)kindSelect.classList.add("hidden");
    $("#actionDialogTitle").textContent=title; $("#actionDialogDescription").textContent=description||"";
    $("#actionDialogLabelText").textContent=label; input.placeholder=placeholder; input.value=value;
    overlay.classList.remove("hidden"); overlay.setAttribute("aria-hidden","false");
    $("#actionDialogConfirm").textContent=confirm; input.focus(); if(value) input.select();
    return new Promise(resolve=>{dialogResolve=resolve;});
  }
  function finishDialog(value){const o=$("#actionDialog");o.classList.add("hidden");o.setAttribute("aria-hidden","true");if(dialogResolve){dialogResolve(value);dialogResolve=null;}}
  async function askChannelDialog(){
    const pending=askDialog({title:"Novo canal",description:"Escolha um nome e o tipo de espaço da comunidade.",label:"Nome do canal",placeholder:"Ex.: novidades",confirm:"Criar canal"});
    const kind=$("#actionDialogChannelKind");kind.classList.remove("hidden");kind.value="text";
    const name=await pending;return name?{name,kind:kind.value}:null;
  }
  $("#actionDialogCancel").addEventListener("click",()=>finishDialog(null));
  $("#actionDialog").addEventListener("click",e=>{if(e.target.id==="actionDialog")finishDialog(null);});
  $("#actionDialogForm").addEventListener("submit",e=>{e.preventDefault();finishDialog($("#actionDialogInput").value.trim());});

  let newServerIconData="", editServerIconData="", clearEditServerIcon=false;
  function readImageFile(file,max=8*1024*1024){return new Promise((resolve,reject)=>{if(!file)return resolve("");if(!/^image\/(png|jpeg|webp)$/.test(file.type))return reject(new Error("Use uma imagem PNG, JPG ou WEBP."));if(file.size>max)return reject(new Error("A imagem deve ter no máximo 8 MB."));const reader=new FileReader();reader.onerror=()=>reject(new Error("Não foi possível ler a imagem."));reader.onload=()=>{const img=new Image();img.onerror=()=>reject(new Error("Imagem inválida."));img.onload=()=>{if(img.naturalWidth>2500||img.naturalHeight>2500)return reject(new Error("A imagem pode ter até 2500 × 2500 pixels."));if(img.naturalWidth<200||img.naturalHeight<200)return reject(new Error("Use uma imagem com pelo menos 200 × 200 pixels."));const canvas=document.createElement("canvas");canvas.width=1024;canvas.height=1024;const ctx=canvas.getContext("2d");const side=Math.min(img.naturalWidth,img.naturalHeight),sx=(img.naturalWidth-side)/2,sy=(img.naturalHeight-side)/2;ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";ctx.drawImage(img,sx,sy,side,side,0,0,1024,1024);resolve(canvas.toDataURL("image/webp",.88));};img.src=String(reader.result);};reader.readAsDataURL(file);});}
  $("#newServerIconPreview").addEventListener("click",e=>{e.preventDefault();e.stopPropagation();$("#newServerIcon").click();});
  $("#editServerIconPreview").addEventListener("click",e=>{e.preventDefault();e.stopPropagation();$("#editServerIcon").click();});
  $("#newServerIcon").addEventListener("change",async e=>{try{newServerIconData=await readImageFile(e.target.files[0]);const p=$("#newServerIconPreview");p.style.backgroundImage=`url("${newServerIconData}")`;p.classList.add("has-image");p.textContent="";}catch(x){toast(x.message,true);e.target.value="";}});
  function openServerHub(){ $("#serverHubOverlay").classList.remove("hidden");$("#serverHubOverlay").setAttribute("aria-hidden","false"); }
  function closeServerHub(){ $("#serverHubOverlay").classList.add("hidden");$("#serverHubOverlay").setAttribute("aria-hidden","true"); }
  $("#closeServerHub").addEventListener("click",closeServerHub);
  $("#serverHubOverlay").addEventListener("click",e=>{if(e.target.id==="serverHubOverlay")closeServerHub();});
  $("#createServerButton").addEventListener("click",openServerHub);
  document.querySelectorAll(".add-server,.tiny-icon").forEach(button=>button.addEventListener("click",openServerHub));
  $("#confirmCreateServer").addEventListener("click",async()=>{
    const name=$("#newServerName").value.trim(),description=$("#newServerDescription").value.trim();
    if(name.length<2){toast("O nome precisa ter pelo menos 2 caracteres.",true);return;}
    try{await api("/api/communities",{name,description,icon:newServerIconData,banner:""});await loadCommunities();const created=communities.find(c=>c.name===name)||communities[0];if(created)selectCommunity(created);closeServerHub();$("#newServerName").value="";$("#newServerDescription").value="";$("#newServerIcon").value="";newServerIconData="";$("#newServerIconPreview").style.backgroundImage="";$("#newServerIconPreview").classList.remove("has-image");$("#newServerIconPreview").textContent="V";toast("Servidor criado com sucesso.",false,true);}
    catch(error){toast(error.message,true);}
  });
  $("#confirmJoinServer").addEventListener("click",async()=>{
    const code=$("#serverInviteCode").value.trim();if(!code){toast("Cole um código de convite.",true);return;}
    try{await api("/api/communities/join",{code});await loadCommunities();closeServerHub();$("#serverInviteCode").value="";toast("Você entrou no servidor.",false,true);}
    catch(error){toast(error.message,true);}
  });
  async function openServerSettings(){
    if(!activeCommunity){toast("Selecione um servidor primeiro.",true);return;}
    if(!["owner","admin"].includes(activeCommunity.role)){toast("Você não tem permissão para gerenciar este servidor.",true);return;}
    $("#editServerName").value=activeCommunity.name;$("#editServerDescription").value=activeCommunity.description||"";
    editServerIconData=activeCommunity.icon||"";clearEditServerIcon=false;const preview=$("#editServerIconPreview");preview.style.backgroundImage=editServerIconData?`url("${editServerIconData}")`:"";preview.classList.toggle("has-image",!!editServerIconData);preview.textContent=editServerIconData?"":"V";
    $("#editServerIcon").value="";$("#serverDeleteSection").classList.toggle("hidden",activeCommunity.role!=="owner");await renderServerSettingsStructure();$("#serverSettingsOverlay").classList.remove("hidden");$("#serverSettingsOverlay").setAttribute("aria-hidden","false");icons();
  }
  async function renderServerSettingsStructure(){
    if(!activeCommunity)return;
    const [members]=await Promise.all([api(`/api/communities/${activeCommunity.id}/members`,{},"GET")]);serverRoleCatalog=members.roles||[];
    const box=$("#serverStructureList");box.innerHTML="";
    (activeCommunity.categories||[]).forEach(cat=>{const row=document.createElement("div");row.className="server-structure-row category-permission-row";let selected=[];try{selected=JSON.parse(cat.private_role_ids||"[]");}catch{}const isPrivate=selected.length>0;const roleChecks=serverRoleCatalog.map(role=>`<label class="permission-role-chip"><input type="checkbox" data-category-role="${cat.id}" value="${role.id}" ${selected.includes(role.id)?"checked":""}><span style="--role-color:${role.color}">${escapeHtml(role.name)}</span></label>`).join("");row.innerHTML=`<div class="category-permission-main"><span><i data-lucide="folder"></i> ${escapeHtml(cat.name)} ${isPrivate?'<small class="private-category-tag">PRIVADA</small>':'<small class="public-category-tag">PÚBLICA</small>'}</span><button data-delete-category="${cat.id}" class="danger-mini">Excluir</button></div><details class="category-access-editor"><summary>Visibilidade e cargos autorizados</summary><label class="category-public-toggle"><span>Categoria privada</span><input type="checkbox" role="switch" data-category-private="${cat.id}" ${isPrivate?"checked":""}><small>Restringir por cargo</small></label><div class="permission-role-grid">${roleChecks||'<small>Crie cargos para restringir esta categoria.</small>'}</div><button type="button" class="secondary-button compact" data-save-category-permission="${cat.id}">Salvar acesso</button></details>`;box.appendChild(row);});
    activeCommunity.channels.forEach(ch=>{const row=document.createElement("div");row.className="server-structure-row";const categoryOptions=(activeCommunity.categories||[]).map(cat=>`<option value="${cat.id}" ${Number(ch.category_id)===cat.id?"selected":""}>${escapeHtml(cat.name)}</option>`).join("");row.innerHTML=`<span><i data-lucide="${ch.kind==="voice"?"volume-2":"hash"}"></i> ${escapeHtml(ch.name)} <small class="channel-kind-tag">${ch.kind==="voice"?"VOZ":"TEXTO"}</small></span><div class="server-structure-controls"><select aria-label="Categoria de ${escapeHtml(ch.name)}" data-channel-category="${ch.id}"><option value="">Sem categoria</option>${categoryOptions}</select><button data-delete-channel="${ch.id}" class="danger-mini">Excluir</button></div>`;box.appendChild(row);});
    serverRoleCatalog.forEach((role,index)=>{const row=document.createElement("details");row.className="server-structure-row role-structure-row role-compact-item";row.innerHTML=`<summary><span class="role-summary-dot" style="--role-color:${role.color}"></span><strong>${escapeHtml(role.name)}</strong><small>${index+1}</small><span class="role-summary-hint">Editar</span></summary><div class="role-edit-inline"><input class="role-name-edit" maxlength="32" value="${escapeHtml(role.name)}" data-role-name="${role.id}" aria-label="Nome do cargo"><label class="role-color-mini" title="Alterar cor"><input type="color" value="${role.color}" data-role-color="${role.id}" aria-label="Cor de ${escapeHtml(role.name)}"></label><div class="role-order-mini"><button type="button" class="icon-mini" data-role-up="${role.id}" ${index===0?"disabled":""} aria-label="Mover para cima">↑</button><button type="button" class="icon-mini" data-role-down="${role.id}" ${index===serverRoleCatalog.length-1?"disabled":""} aria-label="Mover para baixo">↓</button></div><button class="secondary-button compact role-action-mini" data-save-role="${role.id}">Salvar</button><button data-delete-role="${role.id}" class="danger-mini role-action-mini">Excluir</button></div>`;box.appendChild(row);});
    const editor=$("#channelPermissionEditor");editor.innerHTML="";
    activeCommunity.channels.forEach(ch=>{
      const card=document.createElement("div");card.className="permission-card";
      let readIds=[],sendIds=[];try{readIds=JSON.parse(ch.read_role_ids||"[]");sendIds=JSON.parse(ch.send_role_ids||"[]");}catch{}
      const chips=(kind,selected)=>serverRoleCatalog.length?serverRoleCatalog.map(r=>`<label class="permission-role-chip"><input type="checkbox" value="${r.id}" data-${kind}-role="${ch.id}" ${selected.includes(r.id)?"checked":""}><span style="--role-color:${r.color}">${escapeHtml(r.name)}</span></label>`).join(""):'<small>Nenhum cargo criado ainda.</small>';
      card.innerHTML=`<div class="permission-card-head"><strong>${ch.kind==="voice"?"◖))":"#"} ${escapeHtml(ch.name)}</strong><button class="secondary-button compact" data-save-permission="${ch.id}">Salvar</button></div><details><summary>Permissões de acesso</summary><div class="permission-group"><b>Quem pode visualizar</b><div class="permission-role-grid">${chips("read",readIds)}</div></div><div class="permission-group"><b>Quem pode enviar mensagens</b><div class="permission-role-grid">${chips("send",sendIds)}</div></div><small>Sem cargos selecionados, todos os membros têm acesso. Proprietário e administradores mantêm acesso de gerenciamento.</small></details>`;
      editor.appendChild(card);
    });
    icons();
  }
  $("#serverSettingsButton").addEventListener("click",openServerSettings);
  function closeServerSettings(){const overlay=$("#serverSettingsOverlay");overlay.classList.add("hidden");overlay.setAttribute("aria-hidden","true");}
  $("#closeServerSettings").addEventListener("click",closeServerSettings);
  $("#serverSettingsOverlay").addEventListener("click",e=>{if(e.target.id==="serverSettingsOverlay")$("#closeServerSettings").click();});
  $("#editServerIcon").addEventListener("change",async e=>{try{editServerIconData=await readImageFile(e.target.files[0]);clearEditServerIcon=false;const p=$("#editServerIconPreview");p.style.backgroundImage=`url("${editServerIconData}")`;p.classList.add("has-image");p.textContent="";}catch(x){toast(x.message,true);e.target.value="";}});
  $("#removeServerIcon").addEventListener("click",()=>{editServerIconData="";clearEditServerIcon=true;const p=$("#editServerIconPreview");p.style.backgroundImage="";p.classList.remove("has-image");p.textContent=(activeCommunity?.name||"V").slice(0,1).toUpperCase();$("#editServerIcon").value="";});
  $("#saveServerSettings").addEventListener("click",async()=>{try{await api(`/api/communities/${activeCommunity.id}`,{name:$("#editServerName").value,description:$("#editServerDescription").value,icon:editServerIconData,banner:activeCommunity.banner_data||"",clearIcon:clearEditServerIcon},"PATCH");await loadCommunities();activeCommunity=communities.find(c=>c.id===activeCommunity.id);$("#activeCommunityName").textContent=activeCommunity.name;renderCommunities();const wall=activeCommunity.banner_data||activeCommunity.icon||"";if(wall)$(".conversation-area").style.setProperty("--server-wallpaper",`url("${wall}")`);else $(".conversation-area").style.removeProperty("--server-wallpaper");toast("Configurações salvas.",false,true);}catch(e){toast(e.message,true);}});
  $("#settingsCreateCategory").addEventListener("click",async()=>{const name=await askDialog({title:"Nova categoria",description:"Organize os canais em uma seção.",label:"Nome",placeholder:"Ex.: COMUNIDADE",confirm:"Continuar"});if(!name)return;const privacy=await askDialog({title:"Visibilidade da categoria",description:"Digite PUBLICA para todos os membros ou PRIVADA para restringir por cargos.",label:"Visibilidade",placeholder:"PUBLICA ou PRIVADA",value:"PUBLICA",confirm:"Continuar"});if(!privacy)return;let roleIds=[];if(privacy.trim().toUpperCase()==="PRIVADA"){if(!serverRoleCatalog.length){toast("Crie os cargos antes de criar uma categoria privada.",true);return;}const raw=await askDialog({title:"Cargos autorizados",description:`Informe os IDs dos cargos separados por vírgula: ${serverRoleCatalog.map(r=>`${r.name} (ID ${r.id})`).join(" • ")}`,label:"IDs dos cargos",placeholder:"Ex.: 2, 4",confirm:"Criar privada"});if(!raw)return;roleIds=raw.split(",").map(v=>Number(v.trim())).filter(Number.isInteger);if(!roleIds.length){toast("Selecione pelo menos um ID de cargo válido.",true);return;}}try{await api(`/api/communities/${activeCommunity.id}/categories`,{name,isPrivate:privacy.trim().toUpperCase()==="PRIVADA",roleIds});await loadCommunities();activeCommunity=communities.find(c=>c.id===activeCommunity.id);await renderServerSettingsStructure();toast("Categoria criada.",false,true);}catch(e){toast(e.message,true);}});
  $("#settingsCreateChannel").addEventListener("click",async()=>{const choice=await askChannelDialog();if(!choice)return;try{await api(`/api/communities/${activeCommunity.id}/channels`,choice);await loadCommunities();activeCommunity=communities.find(c=>c.id===activeCommunity.id);await renderServerSettingsStructure();toast(choice.kind==="voice"?"Canal de voz criado.":"Canal de texto criado.",false,true);}catch(e){toast(e.message,true);}});
  $("#settingsCreateRole").addEventListener("click",async()=>{const name=$("#settingsRoleName").value.trim(),color=$("#settingsRoleColor").value||"#9b8cff";if(name.length<2){toast("Digite um nome de cargo com pelo menos 2 caracteres.",true);return;}try{await api(`/api/communities/${activeCommunity.id}/roles`,{name,color});$("#settingsRoleName").value="";$("#settingsRoleColor").value="#9b8cff";await renderServerSettingsStructure();toast("Cargo criado.",false,true);}catch(e){toast(e.message,true);}});
  $("#serverStructureList").addEventListener("click",async e=>{
    const move=e.target.closest("[data-role-up],[data-role-down]");
    if(move){const id=Number(move.dataset.roleUp||move.dataset.roleDown),ordered=[...serverRoleCatalog].sort((a,b)=>b.position-a.position||a.id-b.id),index=ordered.findIndex(r=>r.id===id),nextIndex=move.hasAttribute("data-role-up")?index-1:index+1;if(index<0||nextIndex<0||nextIndex>=ordered.length)return;const a=ordered[index],b=ordered[nextIndex];try{await api(`/api/communities/${activeCommunity.id}/roles/${a.id}`,{name:a.name,color:a.color,position:b.position},"PATCH");await api(`/api/communities/${activeCommunity.id}/roles/${b.id}`,{name:b.name,color:b.color,position:a.position},"PATCH");await renderServerSettingsStructure();toast("Ordem dos cargos atualizada.",false,true);}catch(x){toast(x.message,true);}return;}
    const b=e.target.closest("[data-save-role]");if(!b)return;const id=b.dataset.saveRole,row=b.closest(".server-structure-row"),role=serverRoleCatalog.find(r=>r.id===Number(id));if(!role)return;const color=row.querySelector(`[data-role-color="${id}"]`).value,name=row.querySelector(`[data-role-name="${id}"]`).value.trim();try{await api(`/api/communities/${activeCommunity.id}/roles/${id}`,{name,color},"PATCH");await renderServerSettingsStructure();toast("Cargo atualizado.",false,true);}catch(x){toast(x.message,true);}});
  $("#serverStructureList").addEventListener("change",async e=>{const select=e.target.closest("[data-channel-category]");if(!select)return;try{await api(`/api/communities/${activeCommunity.id}/channels/${select.dataset.channelCategory}/category`,{categoryId:select.value||null},"PATCH");await loadCommunities();activeCommunity=communities.find(c=>c.id===activeCommunity.id);await renderServerSettingsStructure();toast("Canal movido de categoria.",false,true);}catch(x){toast(x.message,true);}});
  $("#serverStructureList").addEventListener("click",async e=>{const b=e.target.closest("button");if(!b||b.dataset.saveRole)return;try{if(b.dataset.saveCategoryPermission){const id=b.dataset.saveCategoryPermission,isPrivate=!!document.querySelector(`[data-category-private="${id}"]`)?.checked,roleIds=[...document.querySelectorAll(`[data-category-role="${id}"]:checked`)].map(x=>Number(x.value));await api(`/api/communities/${activeCommunity.id}/categories/${id}/permissions`,{isPrivate,roleIds},"PATCH");await loadCommunities();activeCommunity=communities.find(c=>c.id===activeCommunity.id);await renderServerSettingsStructure();toast("Visibilidade da categoria atualizada.",false,true);return;}if(b.dataset.deleteCategory)await api(`/api/communities/${activeCommunity.id}/categories/${b.dataset.deleteCategory}`,{},"DELETE");else if(b.dataset.deleteChannel){await api(`/api/communities/${activeCommunity.id}/channels/${b.dataset.deleteChannel}`,{},"DELETE");if(activeChannel?.id===Number(b.dataset.deleteChannel))activeChannel=null;}else if(b.dataset.deleteRole)await api(`/api/communities/${activeCommunity.id}/roles/${b.dataset.deleteRole}`,{},"DELETE");await loadCommunities();activeCommunity=communities.find(c=>c.id===activeCommunity.id);if(activeCommunity?.channels?.length&&!activeChannel)selectChannel(activeCommunity.channels[0]);await renderServerSettingsStructure();toast("Estrutura atualizada.",false,true);}catch(x){toast(x.message,true);}});
  $("#channelPermissionEditor").addEventListener("click",async e=>{const b=e.target.closest("[data-save-permission]");if(!b)return;const id=b.dataset.savePermission,read=[...document.querySelectorAll(`[data-read-role="${id}"]:checked`)].map(o=>Number(o.value)),send=[...document.querySelectorAll(`[data-send-role="${id}"]:checked`)].map(o=>Number(o.value));try{await api(`/api/communities/${activeCommunity.id}/channels/${id}/permissions`,{readRoleIds:read,sendRoleIds:send},"PATCH");toast("Permissões do canal salvas.",false,true);}catch(x){toast(x.message,true);}});
  $("#deleteServerButton").addEventListener("click",async()=>{
    // Fecha primeiro o painel de configurações para a confirmação nunca ficar atrás dele.
    const community=activeCommunity;
    if(!community||community.role!=="owner"){toast("Somente o proprietário pode excluir este servidor.",true);return;}
    const communityId=community.id, communityName=community.name;
    closeServerSettings();
    const typed=await askDialog({title:"Excluir servidor",description:`Digite exatamente “${communityName}” para confirmar a exclusão permanente.`,label:"Nome do servidor",placeholder:communityName,confirm:"Excluir definitivamente"});
    if(typed===null)return;
    if(typed!==communityName){toast("Nome não confere. O servidor foi mantido.",true);return;}
    try{
      await api(`/api/communities/${communityId}`,{},"DELETE");
      if(activeCommunity?.id===communityId){activeCommunity=null;activeChannel=null;}
      await loadCommunities();
      $("#chatWorkspace").classList.add("hidden");
      $(".welcome-content").classList.remove("hidden");
      toast("Servidor excluído com sucesso.",false,true);
    }catch(e){toast(e.message||"Não foi possível excluir o servidor.",true);}
  });
  $("#inviteActiveButton").addEventListener("click",async()=>{
    if(!activeCommunity)return;
    try{const r=await api(`/api/communities/${activeCommunity.id}/invite`,{},"POST");let copied=false;try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(r.invite_code);copied=true;}}catch{}if(!copied){const temp=document.createElement("textarea");temp.value=r.invite_code;temp.setAttribute("readonly","");temp.style.position="fixed";temp.style.opacity="0";document.body.appendChild(temp);temp.select();copied=document.execCommand("copy");temp.remove();}if(copied)toast("Convite copiado: "+r.invite_code,false,true);else{await askDialog({title:"Convite do servidor",description:"Não foi possível copiar automaticamente. Selecione e copie o código abaixo.",label:"Código de convite",value:r.invite_code,confirm:"Fechar"});}}
    catch(error){toast(error.message||"Não foi possível gerar o convite.",true);}
  });
  $("#createChannelButton").addEventListener("click",async()=>{
    if(!activeCommunity)return;
    const choice=await askChannelDialog();if(!choice)return;
    try{await api(`/api/communities/${activeCommunity.id}/channels`,choice);await loadCommunities();activeCommunity=communities.find(c=>c.id===activeCommunity.id)||activeCommunity;const channel=activeCommunity.channels.find(c=>c.name===choice.name.toLowerCase());if(channel)selectChannel(channel);toast(choice.kind==="voice"?"Canal de voz criado.":"Canal de texto criado.",false,true);}
    catch(error){toast(error.message,true);}
  });
  $("#messageForm").addEventListener("submit",async e=>{
    e.preventDefault();if(!activeChannel)return;
    const input=$("#messageInput"),content=input.value.trim();if(!content)return;
    input.value="";
    try{await api(`/api/channels/${activeChannel.id}/messages`,{content});await refreshMessages(false);}
    catch(error){input.value=content;toast(error.message,true);}
  });

  // Central social: busca exata, pedidos, lista de amigos e conversas privadas.
  let socialData={incoming:[],outgoing:[],friends:[]}, socialTab="incoming", activeDmFriend=null, dmAfter=0, dmTimer=null;
  function openFriends(){ $("#friendsOverlay").classList.remove("hidden");$("#friendsOverlay").setAttribute("aria-hidden","false");loadFriendData(); }
  function closeFriends(){ $("#friendsOverlay").classList.add("hidden");$("#friendsOverlay").setAttribute("aria-hidden","true"); }
  $("#findFriendsButton")?.addEventListener("click",openFriends);
  $("#railHomeButton").addEventListener("click",()=>{
    activeCommunity=null;activeChannel=null;if(messagePoll){clearInterval(messagePoll);messagePoll=null;}setRailMode("servers");
    $("#railHomeButton").classList.add("active");
    document.querySelectorAll(".rail-community").forEach(el=>el.classList.remove("active"));
    $("#welcomeContent")?.classList.remove("hidden");
    $(".welcome-content")?.classList.remove("hidden");
    $(".conversation-area")?.style.removeProperty("--server-wallpaper");
    $("#chatWorkspace").classList.add("hidden");
    $(".channel-sidebar")?.classList.remove("mobile-open","channels-only");
  });
  $("#railFriendsButton").addEventListener("click",()=>setRailMode("friends"));
  $("#friendsNav").addEventListener("click",()=>{socialTab="friends";openFriends();});
  $("#inboxNav").addEventListener("click",()=>{socialTab="incoming";openFriends();});
  $("#personalMessagesNav").addEventListener("click",()=>{setRailMode("friends");socialTab="friends";loadFriendData();});
  $("#notificationsButton")?.addEventListener("click",()=>{socialTab="incoming";openFriends();});
  document.querySelector('.header-actions button[title="Ajuda"]')?.addEventListener("click",()=>{
    askDialog({title:"Ajuda do Veyronix",description:"Mensagens: abra suas conversas. O sino leva às solicitações recebidas de amizade. Para gerenciar um servidor, selecione-o e abra Configurações. O proprietário pode editar o servidor e excluí-lo; a exclusão exige digitar o nome exato.",label:"Dica rápida",value:"Toque em Continuar para fechar esta ajuda.",confirm:"Entendi"}).then(()=>{});
  });
  $("#closeFriends").addEventListener("click",closeFriends);
  $("#friendsOverlay").addEventListener("click",e=>{if(e.target.id==="friendsOverlay")closeFriends();});
  async function loadFriendData(){
    try{socialData=await api("/api/friends/requests",{},"GET");renderFriendTab();}
    catch(e){toast(e.message,true);}
  }
  function socialUserCard(u,kind){
    const name=u.display_name||u.username, avatar=u.avatar_data?`style="background-image:url('${u.avatar_data}')"`:"";
    let action="";
    if(kind==="incoming") action=`<button data-friend-action="accept" data-id="${u.id}">Aceitar</button><button data-friend-action="remove" data-id="${u.id}">Recusar</button>`;
    if(kind==="outgoing") action=`<button data-friend-action="remove" data-id="${u.id}">Cancelar</button>`;
    if(kind==="friends") action=`<button data-dm-user="${u.user_id}" data-username="${escapeHtml(u.username)}" data-name="${escapeHtml(name)}">Mensagem</button><button data-friend-action="remove" data-id="${u.id}">Remover</button>`;
    return `<div class="social-user"><div class="social-avatar" ${avatar}>${u.avatar_data?"":escapeHtml(name.slice(0,1).toUpperCase())}</div><div class="social-user-info"><strong>${escapeHtml(name)}</strong><small>@${escapeHtml(u.username)}</small></div>${action}</div>`;
  }
  function renderFriendTab(){
    document.querySelectorAll("[data-friend-tab]").forEach(b=>b.classList.toggle("active",b.dataset.friendTab===socialTab));
    const rows=socialData[socialTab]||[], list=$("#friendRequestsList");
    list.innerHTML=rows.length?rows.map(u=>socialUserCard(u,socialTab)).join(""):`<p class="social-muted">Nenhuma solicitação por aqui.</p>`;
    if(railMode==="friends") renderRailFriends();
    icons();
  }
  document.querySelectorAll("[data-friend-tab]").forEach(b=>b.addEventListener("click",()=>{socialTab=b.dataset.friendTab;renderFriendTab();}));
  $("#friendSearchForm").addEventListener("submit",async e=>{
    e.preventDefault();const username=$("#friendSearchInput").value.trim().toLowerCase();
    if(!/^[a-z0-9_.]{3,24}$/.test(username)){toast("Digite o @usuário completo.",true);return;}
    try{
      const r=await api("/api/friends/search?username="+encodeURIComponent(username),{},"GET"), box=$("#friendSearchResult");
      if(!r.user){box.innerHTML='<p class="social-muted">Nenhuma conta encontrada com esse nome exato.</p>';return;}
      const u=r.user, name=u.display_name||u.username;
      let action=u.relationship==="none"?`<button data-add-friend="${escapeHtml(u.username)}">Adicionar</button>`:u.relationship==="sent"?'<button disabled>Solicitação enviada</button>':u.relationship==="received"?'<button disabled>Confira solicitações recebidas</button>':'<button disabled>Já são amigos</button>';
      box.innerHTML=`<div class="social-user"><div class="social-avatar">${escapeHtml(name.slice(0,1).toUpperCase())}</div><div class="social-user-info"><strong>${escapeHtml(name)}</strong><small>@${escapeHtml(u.username)}</small></div>${action}</div>`;
    }catch(error){toast(error.message,true);}
  });
  document.addEventListener("click",async e=>{
    const add=e.target.closest("[data-add-friend]");
    if(add){try{await api("/api/friends/request",{username:add.dataset.addFriend});toast("Solicitação enviada.",false,true);add.disabled=true;add.textContent="Solicitação enviada";loadFriendData();}catch(x){toast(x.message,true);} }
    const act=e.target.closest("[data-friend-action]");
    if(act){try{const id=act.dataset.id;if(act.dataset.friendAction==="accept")await api(`/api/friends/${id}/accept`,{});else await api(`/api/friends/${id}`,{},"DELETE");await loadFriendData();toast("Lista atualizada.",false,true);}catch(x){toast(x.message,true);}}
    const dm=e.target.closest("[data-dm-user]");
    if(dm)openDm({id:Number(dm.dataset.dmUser),username:dm.dataset.username,display_name:dm.dataset.name});
  });
  async function openDm(friend){
    activeDmFriend=friend;dmAfter=0;$("#dmFriendName").textContent=friend.display_name||friend.username;$("#dmFriendUsername").textContent="@"+friend.username;
    $("#dmMessages").innerHTML="";$("#dmOverlay").classList.remove("hidden");$("#dmOverlay").setAttribute("aria-hidden","false");
    await refreshDm(true);if(dmTimer)clearInterval(dmTimer);dmTimer=setInterval(()=>refreshDm(false),2500);icons();
  }
  function closeDm(){ $("#dmOverlay").classList.add("hidden");$("#dmOverlay").setAttribute("aria-hidden","true");if(dmTimer)clearInterval(dmTimer);dmTimer=null;activeDmFriend=null; }
  $("#closeDm").addEventListener("click",closeDm);$("#dmOverlay").addEventListener("click",e=>{if(e.target.id==="dmOverlay")closeDm();});
  async function refreshDm(initial=false){
    if(!activeDmFriend)return;
    try{const r=await api(`/api/dm/${activeDmFriend.id}/messages?after=${initial?0:dmAfter}`,{},"GET"),box=$("#dmMessages");
      (r.messages||[]).forEach(m=>{if(m.id<=dmAfter)return;const empty=box.querySelector(".dm-empty-state");if(empty)empty.remove();const el=document.createElement("div");el.className="dm-bubble"+(m.sender_id===profileState.id?" mine":"");
        let attachment="";
        if(m.attachment_data){if(m.attachment_type.startsWith("image/"))attachment=`<button type="button" class="dm-image-open" data-image-src="${m.attachment_data}" data-image-name="${escapeHtml(m.attachment_name||"imagem.png")}" aria-label="Abrir imagem em tela cheia"><img src="${m.attachment_data}" alt="Imagem enviada" loading="lazy"></button><a class="dm-download-link" href="${m.attachment_data}" download="${escapeHtml(m.attachment_name||"imagem.png")}"><i data-lucide="download"></i> Baixar imagem</a>`;else if(m.attachment_type.startsWith("audio/"))attachment=`<audio controls preload="metadata" src="${m.attachment_data}"></audio>`;else if(m.attachment_type.startsWith("video/"))attachment=`<video controls preload="metadata" src="${m.attachment_data}"></video><a class="dm-download-link" href="${m.attachment_data}" download="${escapeHtml(m.attachment_name||"video")}"><i data-lucide="download"></i> Baixar vídeo</a>`;else attachment=`<a class="dm-file-link" href="${m.attachment_data}" download="${escapeHtml(m.attachment_name||"arquivo")}"><i data-lucide="file-down"></i>${escapeHtml(m.attachment_name||"Baixar arquivo")}</a>`;}
        const own=Number(m.sender_id)===Number(profileState.id);
        el.dataset.dmMessageId=m.id;
        el.innerHTML=`${own?`<button type="button" class="dm-message-more" aria-label="Opções da mensagem" data-dm-more="${m.id}"><i data-lucide="more-horizontal"></i></button>`:""}${m.content?`<div class="dm-message-text">${escapeHtml(m.content).replace(/\n/g,"<br>")}</div>`:""}${attachment}<small>${escapeHtml(own?"Você":m.username)} · ${new Date(m.created_at.replace(" ","T")+"Z").toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</small>`;
        box.appendChild(el);dmAfter=m.id;icons();});
      if(initial&&!(r.messages||[]).length&&!box.children.length){
        box.innerHTML='<div class="dm-empty-state"><strong>Conversa iniciada</strong>Envie uma mensagem para começar a conversar.</div>';
      }
      if(initial||r.messages?.length)box.scrollTop=box.scrollHeight;
    }catch(e){if(initial)toast(e.message,true);}
  }
  let dmOpenMenu=null;
  function closeDmMessageMenu(){dmOpenMenu?.remove();dmOpenMenu=null;}
  $("#dmMessages").addEventListener("click",async e=>{
    const more=e.target.closest("[data-dm-more]");
    if(more){e.stopPropagation();closeDmMessageMenu();const bubble=more.closest(".dm-bubble"),menu=document.createElement("div");menu.className="dm-message-menu";menu.innerHTML='<button type="button" data-dm-copy><i data-lucide="copy"></i> Copiar texto</button><button type="button" data-dm-delete><i data-lucide="trash-2"></i> Excluir mensagem</button>';bubble.appendChild(menu);dmOpenMenu=menu;icons();return;}
    const image=e.target.closest("[data-image-src]");
    if(image){const src=image.dataset.imageSrc;$("#dmImageFull").src=src;$("#dmImageDownload").href=src;$("#dmImageDownload").download=image.dataset.imageName||"imagem.png";$("#dmImageViewer").classList.remove("hidden");$("#dmImageViewer").setAttribute("aria-hidden","false");return;}
    const action=e.target.closest("[data-dm-copy],[data-dm-delete]");
    if(!action)return;const bubble=action.closest(".dm-bubble"),id=Number(bubble?.dataset.dmMessageId),text=bubble?.querySelector(".dm-message-text")?.innerText||"";
    if(action.hasAttribute("data-dm-copy")){try{await navigator.clipboard.writeText(text);toast("Texto copiado.",false,true);}catch{toast("Não foi possível copiar neste navegador.",true);}closeDmMessageMenu();return;}
    if(action.hasAttribute("data-dm-delete")){try{await api(`/api/dm/${activeDmFriend.id}/messages/${id}`,{},"DELETE");bubble.remove();closeDmMessageMenu();toast("Mensagem excluída.",false,true);if(!$("#dmMessages").children.length)$("#dmMessages").innerHTML='<div class="dm-empty-state"><strong>Conversa iniciada</strong>Envie uma mensagem para começar a conversar.</div>';}catch(err){toast(err.message,true);}return;}
  });
  document.addEventListener("click",e=>{if(dmOpenMenu&&!e.target.closest(".dm-message-menu")&&!e.target.closest("[data-dm-more]"))closeDmMessageMenu();});
  function closeDmImageViewer(){const v=$("#dmImageViewer");v.classList.add("hidden");v.setAttribute("aria-hidden","true");$("#dmImageFull").src="";}
  $("#closeDmImage").addEventListener("click",closeDmImageViewer);
  $("#dmImageViewer").addEventListener("click",e=>{if(e.target.id==="dmImageViewer")closeDmImageViewer();});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeDmMessageMenu();closeDmImageViewer();}});

  async function sendDm(content="",file=null){
    if(!activeDmFriend)return;
    let attachmentData="",attachmentName="",attachmentType="";
    if(file){if(file.size>8*1024*1024)throw new Error("O arquivo deve ter no máximo 8 MB.");attachmentName=file.name;attachmentType=file.type||"application/octet-stream";
      attachmentData=await new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result);fr.onerror=reject;fr.readAsDataURL(file);});}
    await api(`/api/dm/${activeDmFriend.id}/messages`,{content,attachmentData,attachmentName,attachmentType});await refreshDm(false);
  }
  $("#dmForm").addEventListener("submit",async e=>{e.preventDefault();const input=$("#dmInput"),v=input.value.trim();if(!v)return;input.value="";try{await sendDm(v);}catch(x){input.value=v;toast(x.message,true);}});
  $("#dmAttach").addEventListener("click",()=>$("#dmFile").click());
  $("#dmFile").addEventListener("change",async e=>{const f=e.target.files[0];if(!f)return;try{await sendDm("",f);toast("Arquivo enviado.",false,true);}catch(x){toast(x.message,true);}e.target.value="";});
  let mediaRecorder=null, audioChunks=[];
  $("#dmRecord").addEventListener("click",async()=>{
    const btn=$("#dmRecord");
    if(mediaRecorder?.state==="recording"){mediaRecorder.stop();btn.innerHTML='<i data-lucide="mic"></i>';$("#dmRecordStatus").textContent="";icons();return;}
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast("O microfone exige HTTPS ou acesso por localhost/127.0.0.1. Abra o site por um endereço seguro e tente novamente.",true);return;}
    try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});mediaRecorder=new MediaRecorder(stream);audioChunks=[];
      mediaRecorder.ondataavailable=e=>{if(e.data.size)audioChunks.push(e.data);};
      mediaRecorder.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());const blob=new Blob(audioChunks,{type:mediaRecorder.mimeType||"audio/webm"});if(blob.size>8*1024*1024){toast("Áudio acima de 8 MB.",true);return;}const file=new File([blob],"mensagem-de-audio.webm",{type:blob.type});try{await sendDm("",file);}catch(x){toast(x.message,true);}};
      mediaRecorder.start();btn.innerHTML='<i data-lucide="square"></i>';$("#dmRecordStatus").textContent="Gravando… toque para parar";icons();
    }catch(e){toast("Permita o acesso ao microfone para gravar áudio.",true);}
  });

  $("#voiceJoinClose").addEventListener("click",closeVoiceJoin);$("#voiceJoinCancel").addEventListener("click",closeVoiceJoin);$("#voiceJoinConfirm").addEventListener("click",connectVoice);
  $("#voiceJoinOverlay").addEventListener("click",e=>{if(e.target.id==="voiceJoinOverlay")closeVoiceJoin();});
  $("#messageList").addEventListener("click",e=>{
    if(e.target.closest("#voiceConnectButton")){openVoiceJoin();return;}
    if(e.target.closest("#voiceMicButton")){toggleVoiceMic();return;}
    if(e.target.closest("#voiceDeafenButton")){toggleDeafen();return;}
    if(e.target.closest("#voiceDevicesButton")){
      const panel=$("#voiceDevicePanel");
      if(!panel.classList.contains("hidden")){panel.classList.add("hidden");return;}
      loadVoiceDevices();return;
    }
    if(e.target.closest("#voiceShareButton")){toggleScreenShare();return;}
    if(e.target.closest("#voiceLeaveButton")){leaveVoice();return;}
  });
  $("#messageList").addEventListener("change",e=>{if(e.target.id==="voiceInputDevice")changeVoiceInput(e.target.value);if(e.target.id==="voiceOutputDevice")changeVoiceOutput(e.target.value);});
  navigator.mediaDevices?.addEventListener?.("devicechange",()=>{const panel=$("#voiceDevicePanel");if(panel&&!panel.classList.contains("hidden"))loadVoiceDevices();});
  window.addEventListener("beforeunload",()=>{if(voice.channelId){navigator.sendBeacon?.(`/api/voice/${voice.channelId}/leave`,new Blob([JSON.stringify({})],{type:"application/json"}));voice.stream?.getTracks().forEach(t=>t.stop());}});

  function toast(message, isError = false, isSuccess = false) {
    const node = $("#toast");
    node.textContent = message;
    node.classList.toggle("error", isError); node.classList.toggle("success", isSuccess);
    node.classList.remove("hidden");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.add("hidden"), 2800);
  }
  loadSession().then(icons).catch(() => showAuthView("register"));
  window.addEventListener("load", icons);
})();
