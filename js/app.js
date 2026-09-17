import {
  DIVISIONS,
  DEFAULT_PRODUCTS,
  STATUSES,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  STATUS_LABEL,
  DEFAULT_MEMBERS,
  SEED
} from './data.js';

let products = JSON.parse(localStorage.getItem('taskboard_products_v1') || 'null') || JSON.parse(JSON.stringify(DEFAULT_PRODUCTS));

  let tasks = JSON.parse(localStorage.getItem('taskboard_data_v2') || 'null') || SEED;
  let members = JSON.parse(localStorage.getItem('taskboard_members_v2') || 'null') || DEFAULT_MEMBERS;
  let activities = JSON.parse(localStorage.getItem('taskboard_activity_v2') || 'null') || [];
  let messages = JSON.parse(localStorage.getItem('taskboard_messages_v1') || 'null') || [];
  let notifications = JSON.parse(localStorage.getItem('taskboard_notifications_v1') || 'null') || [];
  let activeDepartmenton = 'all';
  let activeProduct = null;
  let expandedDepartments = new Set();
  let currentRole = 'admin';
  let notificationFilter = 'all';
  let dashboardMode = true;
  let taskSearch = '';
  let picFilter = 'all';
  let priorityFilter = 'all';
  let statusFilter = 'all';
  members = members.map(m => ({ ...m, email: m.email || `${m.id}@twc.local`, role: m.role || 'member', active: m.active !== false }));
  tasks = tasks.map(t => ({
    ...t,
    product: t.product || '',
    createdBy: t.createdBy || 'admin',
    createdAt: t.createdAt || new Date().toISOString(),
    updatedAt: t.updatedAt || t.createdAt || new Date().toISOString(),
    statusHistory: Array.isArray(t.statusHistory) && t.statusHistory.length ? t.statusHistory : [{ status: t.status || 'todo', at: t.createdAt || new Date().toISOString(), by: t.createdBy || 'admin' }],
    contributors: Array.isArray(t.contributors) ? t.contributors : [],
    attachments: Array.isArray(t.attachments) ? t.attachments : []
  }));

  function save(){ localStorage.setItem('taskboard_data_v2', JSON.stringify(tasks)); }
  function saveMembers(){ localStorage.setItem('taskboard_members_v2', JSON.stringify(members)); }
  function saveActivities(){ localStorage.setItem('taskboard_activity_v2', JSON.stringify(activities)); }
  function saveMessages(){ localStorage.setItem('taskboard_messages_v1', JSON.stringify(messages)); }
  function saveNotifications(){ localStorage.setItem('taskboard_notifications_v1', JSON.stringify(notifications)); }
  function saveProducts(){ localStorage.setItem('taskboard_products_v1', JSON.stringify(products)); }
  function productListForDivision(divId){ return Array.isArray(products[divId]) ? products[divId] : []; }
  function allProducts(){ return Object.values(products).flat(); }
  function productCount(divId, product){ return tasks.filter(t => t.division === divId && (t.product || '') === product).length; }
  function escapeHtml(value){
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }
  function normalizeUrl(url){
    const value = String(url || '').trim();
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  }
  function sanitizeRichHtml(html){
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    const allowed = new Set(['B','STRONG','I','EM','U','S','BR','P','DIV','SPAN','OL','UL','LI','A']);
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
    const nodes=[];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(el=>{
      if (!allowed.has(el.tagName)){
        const fragment=document.createDocumentFragment();
        while(el.firstChild) fragment.appendChild(el.firstChild);
        el.replaceWith(fragment);
        return;
      }
      const href = el.tagName==='A' ? el.getAttribute('href') : null;
      [...el.attributes].forEach(attr=>el.removeAttribute(attr.name));
      if(el.tagName==='A'){
        const safeHref=normalizeUrl(href || '');
        if(/^https?:\/\//i.test(safeHref)){ el.setAttribute('href', safeHref); el.setAttribute('target','_blank'); el.setAttribute('rel','noopener noreferrer'); }
        else el.replaceWith(document.createTextNode(el.textContent || ''));
      }
    });
    return template.innerHTML;
  }
  function plainTextToRichHtml(text){ return escapeHtml(text || '').replace(/\r?\n/g,'<br>'); }
  function getTaskDescriptionHtml(task){ return sanitizeRichHtml(task.descriptionHtml || plainTextToRichHtml(task.description || '')); }
  function relativeTime(iso){
    const diff = Math.max(0, Date.now() - new Date(iso).getTime());
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }
  let audioContext = null;
  function playNotificationSound(kind='mention'){
    const settings = {
      mention: document.getElementById('mentionSound')?.checked !== false,
      message: document.getElementById('chatSound')?.checked === true,
      assigned: true
    };
    if (!settings[kind]) return;
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume();
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sine';
      osc.frequency.value = kind === 'mention' ? 880 : kind === 'assigned' ? 1040 : 660;
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.06, audioContext.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.16);
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.18);
    } catch(e) { console.warn('Notification sound unavailable', e); }
  }
  function showNotificationToast(n){
    const wrap = document.getElementById('notificationToastWrap');
    if (!wrap) return;
    const highPriority = n.type === 'assigned';
    const toast = document.createElement('div');
    toast.className = `notification-toast ${highPriority ? 'high-priority' : ''}`;
    toast.innerHTML = `
      <div class="notification-toast-icon">${highPriority ? '!' : '🔔'}</div>
      <div>
        <div class="notification-toast-title">${escapeHtml(n.title)}</div>
        <div class="notification-toast-body">${escapeHtml(n.body)}</div>
        ${highPriority ? '<span class="notification-toast-priority">HIGH PRIORITY • NEW TASK</span>' : ''}
      </div>
      <button class="notification-toast-close" aria-label="Dismiss notification">×</button>`;
    wrap.appendChild(toast);
    const close = () => {
      if (toast.classList.contains('closing')) return;
      toast.classList.add('closing');
      setTimeout(() => toast.remove(), 220);
    };
    toast.querySelector('.notification-toast-close')?.addEventListener('click', close);
    toast.addEventListener('click', (e) => {
      if (e.target.closest('.notification-toast-close')) return;
      close();
      document.getElementById('notificationPanel')?.classList.remove('open');
      if (n.taskId) openDetail(n.taskId);
    });
    setTimeout(close, highPriority ? 6500 : 4500);
  }

  function maybeToastLatestNotification(){
    if (!notifications.length) return;
    const mine = notifications.filter(n => n.userId === currentRole && !n.read).sort((a,b) => new Date(b.at) - new Date(a.at));
    if (!mine.length) return;
    let toasted = [];
    try { toasted = JSON.parse(sessionStorage.getItem('taskboard_toasted_notifications_v1') || '[]'); } catch(e) {}
    const candidate = mine.find(n => !toasted.includes(String(n.id)));
    if (!candidate) return;
    toasted.push(String(candidate.id));
    if (toasted.length > 200) toasted = toasted.slice(-200);
    try { sessionStorage.setItem('taskboard_toasted_notifications_v1', JSON.stringify(toasted)); } catch(e) {}
    showNotificationToast(candidate);
    if (candidate.type === 'assigned') playNotificationSound('assigned');
  }

  function makeNotification(userId, type, title, body, taskId=null){
    const notification = {
      id: Date.now() + Math.random(),
      userId, type, title, body, taskId, read:false, at:new Date().toISOString()
    };
    notifications.push(notification);
    if (notifications.length > 3000) notifications = notifications.slice(-3000);
    saveNotifications();
    if (userId === currentRole) {
      showNotificationToast(notification);
      playNotificationSound(type === 'mention' ? 'mention' : type === 'assigned' ? 'assigned' : 'message');
    }
  }
  function usersMentioned(text){
    const lower = String(text || '').toLowerCase();
    const mentioned = members.filter(m => lower.includes(`@${m.name.toLowerCase()}`));
    return lower.includes('@admin') ? [...mentioned, { id:'admin', name:'Admin', color:'#344054' }] : mentioned;
  }
  function mentionHtml(text){
    let safe = escapeHtml(text);
    members.forEach(m => {
      const escaped = String(m.name).replace(/[-/\^$*+?.()|[\]{}]/g, '\\$&');
      const re = new RegExp('(@' + escaped + ')\\b', 'gi');
      safe = safe.replace(re, `<span class="mention">$1</span>`);
    });
    return safe;
  }
  function actorName(){ return isAdmin() ? 'Admin' : memberOf(currentRole).name; }
  function logActivity(taskId, action, detail){
    activities.push({ id: Date.now() + Math.random(), taskId, actorId: currentRole, actorName: actorName(), action, detail, at: new Date().toISOString() });
    if (activities.length > 2000) activities = activities.slice(-2000);
    saveActivities();
  }
  function isOverdue(task){
    if (!task.due || task.status === 'done') return false;
    const today = new Date(); today.setHours(0,0,0,0);
    const due = new Date(task.due + 'T00:00:00');
    return due < today;
  }
  function deadlineLabel(task){ if(!task.due || task.status==='done') return ''; const d=daysUntilDue(task); if(d<0) return `<span class="deadline-label overdue">Overdue by ${Math.abs(d)} day(s)</span>`; if(d===0) return `<span class="deadline-label today">Due today</span>`; if(d<=2) return `<span class="deadline-label soon">Due in ${d} day${d===1?'':'s'}</span>`; return ''; }
  function overdueLabel(task){
    if (!isOverdue(task)) return '';
    const today = new Date(); today.setHours(0,0,0,0);
    const due = new Date(task.due + 'T00:00:00');
    const days = Math.max(1, Math.round((today - due) / 86400000));
    return `<span class="overdue-badge">⚠ Overdue ${days} days</span>`;
  }
  function saveAll(){ save(); saveMembers(); saveActivities(); saveMessages(); saveNotifications(); saveProducts(); }
  function divisionOf(id){ return DIVISIONS.find(d => d.id === id); }
  function memberOf(id){ return members.find(m => m.id === id) || (id === 'admin' || id === '__admin__' ? { name: 'Admin', color: '#344054' } : { name: '?', color: '#999' }); }
  function isAdmin(){ return currentRole === 'admin' || memberOf(currentRole).role === 'admin'; }
  function canManageTask(task){ return !!task && (isAdmin() || currentRole === task.assignee); }
  function canEditTask(task){ return canManageTask(task); }

  function renderRoleSelect(){
    const sel = document.getElementById('roleSelect');
    const currentMember = members.find(m => m.id === currentRole);
    if (currentMember && currentMember.active === false) currentRole = 'admin';
    const activeMembers = members.filter(m => m.active !== false);
    sel.innerHTML = `<option value="admin">Admin</option>` +
      activeMembers.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('');
    sel.value = currentRole;
    document.getElementById('roleTag').textContent = isAdmin() ? 'Admin — full access' : 'Member';
    document.getElementById('roleTag').className = 'role-tag ' + (isAdmin() ? 'admin' : 'member');
    document.getElementById('addBtn').style.display = isAdmin() ? 'inline-block' : 'none';
    document.getElementById('productsBtn').style.display = isAdmin() ? 'block' : 'none';
    document.getElementById('membersBtn').style.display = isAdmin() ? 'block' : 'none';
  }

  function renderSidebar(){
    const list = document.getElementById('divList');
    const allCount = tasks.length;
    let html = `
      <li class="nav-section-label">Home</li>
      <li class="div-item dashboard-nav ${dashboardMode?'active':''}" data-dashboard="true">
        <span class="nav-icon">⌂</span><span>Dashboard</span></li>
      <li class="nav-section-label workspace-label">Workspace</li>
      <li class="div-item ${activeDepartmenton==='all' && !activeProduct && !dashboardMode?'active':''}" data-div="all">
        <span class="dot" style="background:var(--ink-soft)"></span><span>All Departments</span><span class="count">${allCount}</span></li>`;
    DIVISIONS.forEach(d => {
      const count = tasks.filter(t => t.division === d.id).length;
      const expanded = expandedDepartments.has(d.id);
      const deptActive = activeDepartmenton === d.id && !activeProduct && !dashboardMode;
      html += `<li class="div-item ${deptActive?'active ':''}${expanded?'expanded':''}" data-div="${d.id}">
        <span class="dot" style="background:${d.color}"></span><span>${escapeHtml(d.name)}</span><span class="count">${count}</span><span class="chevron">›</span></li>`;
      if (expanded) {
        const divProducts = productListForDivision(d.id);
        html += `<ul class="product-list">`;
        divProducts.forEach(product => {
          const pCount = productCount(d.id, product);
          const pActive = activeDepartmenton === d.id && activeProduct === product && !dashboardMode;
          html += `<li class="product-item ${pActive?'active':''}" data-product-dept="${d.id}" data-product="${escapeHtml(product)}">
            <span class="product-dot"></span><span>${escapeHtml(product)}</span><span class="count">${pCount}</span></li>`;
        });
        html += `</ul>`;
      }
    });
    list.innerHTML = html;
    list.querySelector('[data-dashboard="true"]')?.addEventListener('click', () => {
      dashboardMode = true; activeDepartmenton = 'all'; activeProduct = null;
      document.getElementById('boardTitle').textContent = 'Dashboard'; renderAll();
    });
    list.querySelectorAll('.div-item[data-div]').forEach(el => el.addEventListener('click', () => {
      dashboardMode = false;
      const divId = el.dataset.div;
      if (divId === 'all') { activeDepartmenton='all'; activeProduct=null; expandedDepartments.clear(); document.getElementById('boardTitle').textContent='All Departments'; }
      else { activeDepartmenton=divId; activeProduct=null; if(expandedDepartments.has(divId)) expandedDepartments.delete(divId); else expandedDepartments.add(divId); document.getElementById('boardTitle').textContent=divisionOf(divId).name; }
      updateBoardContext();
      renderAll();
    }));
    list.querySelectorAll('.product-item').forEach(el => el.addEventListener('click', e => {
      e.stopPropagation(); dashboardMode=false; activeDepartmenton=el.dataset.productDept; activeProduct=el.dataset.product;
      expandedDepartments.add(activeDepartmenton); document.getElementById('boardTitle').textContent=`${divisionOf(activeDepartmenton).name} / ${activeProduct}`; updateBoardContext(); renderAll();
    }));
  }

  function updateBoardContext(){
    const crumb = document.getElementById('boardBreadcrumb');
    const title = document.getElementById('boardTitle');
    const desc = document.getElementById('boardDesc');
    if (!crumb || !title || !desc) return;
    if (dashboardMode) {
      crumb.innerHTML = '<span>Home</span><span class="crumb-sep">›</span><strong>Dashboard</strong>';
      title.textContent = 'Dashboard';
      desc.textContent = 'Your workspace overview and the tasks that need attention.';
      return;
    }
    if (activeDepartmenton === 'all') {
      crumb.innerHTML = '<span>Workspace</span><span class="crumb-sep">›</span><strong>All Departments</strong>';
      title.textContent = 'All Departments';
      desc.textContent = 'Browse and manage tasks across the entire workspace.';
      return;
    }
    const dept = divisionOf(activeDepartmenton);
    crumb.innerHTML = activeProduct
      ? `<span>Workspace</span><span class="crumb-sep">›</span><span>${escapeHtml(dept?.name || 'Department')}</span><span class="crumb-sep">›</span><strong>${escapeHtml(activeProduct)}</strong>`
      : `<span>Workspace</span><span class="crumb-sep">›</span><strong>${escapeHtml(dept?.name || 'Department')}</strong>`;
    title.textContent = activeProduct ? `${dept?.name || 'Department'} / ${activeProduct}` : (dept?.name || 'Department');
    desc.textContent = activeProduct ? 'Tasks connected to this product.' : 'Browse and manage tasks for this department.';
  }

  function renderBoard(){
    const board = document.getElementById('board');
    const visibleBase = activeDepartmenton === 'all'
      ? tasks
      : tasks.filter(t => t.division === activeDepartmenton && (!activeProduct || (t.product || '') === activeProduct));
    const q = taskSearch.trim().toLowerCase();
    const filtered = visibleBase.filter(t => {
      const personName = memberOf(t.assignee).name.toLowerCase();
      const deptName = (divisionOf(t.division)?.name || '').toLowerCase();
      const hay = [t.title, t.description, t.product || '', personName, deptName].join(' ').toLowerCase();
      return (!q || hay.includes(q)) &&
        (picFilter === 'all' || t.assignee === picFilter) &&
        (priorityFilter === 'all' || t.priority === priorityFilter) &&
        (statusFilter === 'all' || t.status === statusFilter);
    });

    const filterActive = q || picFilter !== 'all' || priorityFilter !== 'all' || statusFilter !== 'all';
    const resultMeta = document.getElementById('taskResultMeta');
    if (resultMeta) resultMeta.innerHTML = filterActive
      ? `Showing <strong>${filtered.length}</strong> of ${visibleBase.length} tasks${q ? ` for “${escapeHtml(taskSearch.trim())}”` : ''}`
      : `${visibleBase.length} task${visibleBase.length === 1 ? '' : 's'} in this view`;

    board.innerHTML = STATUSES.map(s => {
      const colTasks = filtered.filter(t => t.status === s.id);
      const cards = colTasks.map(t => {
        const div = divisionOf(t.division) || {name:'Unknown', color:'#999'};
        const person = memberOf(t.assignee);
        const deadline = deadlineLabel(t);
        const dueClass = isOverdue(t) ? 'due-overdue' : '';
        return `<div class="card" draggable="true" data-id="${t.id}" style="border-left-color:${person.color}; background: ${person.color}2E;">
          <span class="div-tag">${escapeHtml(div.name)}</span>
          ${t.product ? `<span class="product-mini-tag">${escapeHtml(t.product)}</span>` : ''}
          <div class="title">${escapeHtml(t.title)}</div>
          <div class="meta">
            <span class="avatar" style="background:${person.color}" title="${escapeHtml(person.name)}">${escapeHtml(person.name.slice(0,2).toUpperCase())}</span>
            <span class="meta-right">${t.attachments?.length ? '<span title="Attachments">📎</span>' : ''}<span class="priority-chip ${t.priority}">${PRIORITY_LABEL[t.priority]}</span><span class="${dueClass}">${formatDate(t.due)}</span></span>
          </div>
          ${deadline || overdueLabel(t)}
        </div>`;
      }).join('') || `<div class="empty-col"><strong>${filterActive ? 'No tasks found' : `No ${s.name.toLowerCase()} tasks`}</strong><span>${filterActive ? 'Try a different keyword or clear your filters.' : 'Tasks in this status will appear here.'}</span></div>`;
      return `<div class="column" data-status="${s.id}">
        <div class="col-head"><h3>${s.name}</h3><span class="n">${colTasks.length}</span></div>
        ${cards}
      </div>`;
    }).join('');

    board.querySelectorAll('.card').forEach(card => {
      let dragged = false;
      card.addEventListener('dragstart', e => {
        dragged = true;
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', card.dataset.id);
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('click', () => {
        if (dragged){ dragged = false; return; }
        openDetail(parseInt(card.dataset.id));
      });
    });
    board.querySelectorAll('.column').forEach(col => {
      col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drag-over'); });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', e => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const id = parseInt(e.dataTransfer.getData('text/plain'));
        const task = tasks.find(t => t.id === id);
        if (task){
          if (!canAdvance(task)) return;
          const oldStatus = task.status;
          task.status = col.dataset.status;
          task.updatedAt = new Date().toISOString();
          task.statusHistory = Array.isArray(task.statusHistory) ? task.statusHistory : [];
          if (oldStatus !== task.status){
            task.statusHistory.push({status:task.status,at:task.updatedAt,by:currentRole});
            logActivity(task.id, 'status', `${STATUS_LABEL[oldStatus]} → ${STATUS_LABEL[task.status]}`);
            if (task.assignee !== currentRole && currentRole !== 'admin') makeNotification(task.assignee, 'status', 'Task status updated', `${task.title} → ${STATUS_LABEL[task.status]}`, task.id);
          }
          save(); renderAll();
        }
      });
    });
  }

function formatDate(str){
    const d = new Date(str + 'T00:00:00');
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  }


  function renderDashboard(){
    const visible = tasks;
    const total = visible.length;
    const done = visible.filter(t => t.status === 'done').length;
    const active = visible.filter(t => t.status === 'progress').length;
    const review = visible.filter(t => t.status === 'review').length;
    const overdue = visible.filter(isOverdue).length;
    const dueToday = visible.filter(t => t.status !== 'done' && t.due && daysUntilDue(t) === 0).length;
    const rate = total ? Math.round(done / total * 100) : 0;
    const attentionTotal = overdue + dueToday + review;
    const upcoming = [...visible].filter(t => t.status !== 'done' && t.due)
      .sort((a,b) => String(a.due).localeCompare(String(b.due))).slice(0,5);
    const recent = [...visible].sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0,5);
    const currentMember = members.find(m => m.id === currentRole);
    const displayName = isAdmin() ? 'Admin' : (currentMember?.name || 'there');
    const todayText = new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

    const byDivision = DIVISIONS.map(d => {
      const arr = visible.filter(t => t.division === d.id);
      const dDone = arr.filter(t => t.status === 'done').length;
      const pct = arr.length ? Math.round(dDone / arr.length * 100) : 0;
      return `<div class="dashboard-dept-row">
        <div class="dashboard-dept-label"><span class="dept-dot" style="background:${d.color}"></span><div><strong>${escapeHtml(d.name)}</strong><span>${arr.length} tasks · ${dDone} completed</span></div></div>
        <div class="dashboard-dept-progress"><span style="width:${pct}%"></span></div><em>${pct}%</em>
      </div>`;
    }).join('');

    const attention = [
      ...visible.filter(t => isOverdue(t)).sort((a,b) => String(a.due).localeCompare(String(b.due))).map(t => ({task:t, type:'Overdue'})),
      ...visible.filter(t => !isOverdue(t) && t.status !== 'done' && t.due && daysUntilDue(t) === 0).map(t => ({task:t, type:'Due today'})),
      ...visible.filter(t => t.status === 'review').map(t => ({task:t, type:'Review'}))
    ];
    const seen = new Set();
    const attentionUnique = attention.filter(item => { if(seen.has(item.task.id)) return false; seen.add(item.task.id); return true; }).slice(0,6);
    const attentionHtml = attentionUnique.length ? attentionUnique.map(item => `
      <button class="attention-item attention-click ${item.type === 'Overdue' ? 'is-danger' : item.type === 'Due today' ? 'is-warning' : 'is-review'}" data-task-id="${item.task.id}">
        <span class="attention-icon ${item.type === 'Overdue' ? 'danger' : item.type === 'Due today' ? 'warning' : 'review'}">${item.type === 'Overdue' ? '!' : item.type === 'Due today' ? '◷' : '↗'}</span>
        <span><strong>${escapeHtml(item.task.title)}</strong><small>${item.type} · ${escapeHtml(memberOf(item.task.assignee).name)} · ${STATUS_LABEL[item.task.status]}</small></span>
        <span class="attention-arrow">›</span>
      </button>`).join('') : `<div class="attention-clear"><span class="attention-clear-icon">✓</span><div><strong>All caught up</strong><span>No overdue or urgent tasks right now.</span></div></div>`;

    const upcomingHtml = upcoming.length ? upcoming.map(t => `<button class="dashboard-task-row" data-task-id="${t.id}"><span><strong>${escapeHtml(t.title)}</strong><small>${escapeHtml(memberOf(t.assignee).name)} · ${deadlineLabel(t).replace(/<[^>]+>/g,'') || formatDate(t.due)}</small></span><span class="dash-priority ${t.priority}">${PRIORITY_LABEL[t.priority]}</span></button>`).join('') : '<div class="dashboard-empty">No upcoming deadlines.</div>';
    const recentHtml = recent.length ? recent.map(t => `<button class="dashboard-task-row" data-task-id="${t.id}"><span><strong>${escapeHtml(t.title)}</strong><small>Updated ${relativeTime(t.updatedAt)} · ${STATUS_LABEL[t.status]}</small></span><span class="dash-status">${STATUS_LABEL[t.status]}</span></button>`).join('') : '<div class="dashboard-empty">No recent task activity.</div>';
    const workloadHtml = members.map(m => {
      const count = tasks.filter(t => t.assignee === m.id && t.status !== 'done').length;
      const max = Math.max(1,...members.map(x => tasks.filter(t => t.assignee === x.id && t.status !== 'done').length));
      return `<div class="workload-row"><div class="workload-person"><span class="mini-avatar" style="background:${m.color}">${escapeHtml(m.name.slice(0,2).toUpperCase())}</span><strong>${escapeHtml(m.name)}</strong></div><div class="workload-bar"><span style="width:${Math.round(count/max*100)}%"></span></div><em>${count} active</em></div>`;
    }).join('');

    const attentionClass = overdue > 0 ? 'has-critical' : dueToday > 0 ? 'has-warning' : '';
    const summaryCopy = attentionTotal === 0 ? 'Everything looks clear. Here is your current workspace snapshot.' : `${attentionTotal} ${attentionTotal === 1 ? 'item needs' : 'items need'} attention today.`;

    document.getElementById('summaryWrap').style.display = 'none';
    document.getElementById('board').style.display = 'none';
    document.getElementById('boardTools').style.display = 'none';
    document.getElementById('dashboardView').style.display = 'block';
    document.getElementById('dashboardView').innerHTML = `
      <div class="dashboard-hero">
        <div class="dashboard-hero-main">
          <span class="eyebrow">Workspace overview · ${todayText}</span>
          <h3>Welcome back, ${escapeHtml(displayName)}</h3>
          <p>${summaryCopy}</p>
          <div class="dashboard-hero-actions">
            <button class="add-btn" id="dashboardToBoardBtn">Open Task Board</button>
            <span class="hero-mini-note">${done} of ${total} tasks completed</span>
          </div>
        </div>
        <div class="dashboard-hero-progress" aria-label="Overall completion ${rate}%">
          <div class="hero-progress-ring" style="--progress:${rate * 3.6}deg"><span>${rate}%</span></div>
          <small>Overall progress</small>
        </div>
      </div>

      <section class="dashboard-panel needs-attention-panel ${attentionClass}">
        <div class="dashboard-panel-head">
          <div><strong>Needs Attention</strong><span>Priority items surfaced first</span></div>
          <span class="needs-attention-count ${overdue ? 'critical' : dueToday ? 'warning' : ''}">${attentionTotal}</span>
        </div>
        <div class="needs-attention-list">${attentionHtml}</div>
      </section>

      <div class="dashboard-stat-grid">
        <div class="dashboard-stat"><span>Total Tasks</span><strong>${total}</strong><small>Across all departments</small></div>
        <div class="dashboard-stat"><span>Active</span><strong>${active}</strong><small>Currently in progress</small></div>
        <div class="dashboard-stat"><span>In Review</span><strong>${review}</strong><small>Waiting for review</small></div>
        <div class="dashboard-stat ${overdue ? 'stat-critical' : ''}"><span>Overdue</span><strong class="${overdue?'danger':''}">${overdue}</strong><small>Past due date</small></div>
      </div>

      <div class="dashboard-grid dashboard-grid-top">
        <section class="dashboard-panel">
          <div class="dashboard-panel-head"><div><strong>Overall Progress</strong><span>${done}/${total} tasks completed</span></div><b>${rate}%</b></div>
          <div class="dashboard-progress dashboard-progress-lg"><span style="width:${rate}%"></span></div>
          <div class="progress-foot"><span>Completion rate</span><strong>${rate}%</strong></div>
        </section>
        <section class="dashboard-panel">
          <div class="dashboard-panel-head"><div><strong>Upcoming Deadlines</strong><span>Next 5 unfinished tasks</span></div></div>
          <div class="dashboard-list">${upcomingHtml}</div>
        </section>
      </div>

      <section class="dashboard-panel dashboard-panel-wide dashboard-department-panel">
        <div class="dashboard-panel-head"><div><strong>Department Performance</strong><span>See where work is moving fastest</span></div></div>
        <div class="dashboard-dept-list">${byDivision}</div>
      </section>

      <div class="dashboard-grid">
        <section class="dashboard-panel">
          <div class="dashboard-panel-head"><div><strong>Recently Updated</strong><span>Latest task activity</span></div></div>
          <div class="dashboard-list">${recentHtml}</div>
        </section>
        <section class="dashboard-panel">
          <div class="dashboard-panel-head"><div><strong>Team Workload</strong><span>Active task distribution</span></div></div>
          <div class="workload-grid">${workloadHtml}</div>
        </section>
      </div>`;
    document.getElementById('dashboardToBoardBtn').addEventListener('click',()=>{ dashboardMode=false; activeDepartmenton='all'; activeProduct=null; document.getElementById('boardTools').style.display=''; document.getElementById('boardTitle').textContent='All Departments'; renderAll(); });
    document.querySelectorAll('#dashboardView [data-task-id]').forEach(btn=>btn.addEventListener('click',()=>openDetail(Number(btn.dataset.taskId))));
  }

function renderSummary(){
    const visible = activeDepartmenton === 'all' ? tasks : tasks.filter(t => t.division === activeDepartmenton && (!activeProduct || (t.product || '') === activeProduct));
    const total = visible.length;
    const done = visible.filter(t => t.status === 'done').length;
    const overdue = visible.filter(isOverdue).length;
    const rate = total ? Math.round(done / total * 100) : 0;
    document.getElementById('summaryGrid').innerHTML = `
      <div class="summary-card"><span class="k">Progress</span><span class="v">${done}/${total} tasks completed</span><div class="subv">${rate}% completion</div><div class="progress-track"><div class="progress-bar" style="width:${rate}%"></div></div></div>
      <div class="summary-card"><span class="k">Active Tasks</span><span class="v">${visible.filter(t=>t.status==='progress').length}</span><div class="subv">Active tasks</div></div>
      <div class="summary-card"><span class="k">In Review</span><span class="v">${visible.filter(t=>t.status==='review').length}</span><div class="subv">Requires attention</div></div>
      <div class="summary-card"><span class="k">Overdue</span><span class="v" style="color:${overdue?'var(--high)':'var(--ink)'}">${overdue}</span><div class="subv">Unfinished tasks past their due date</div></div>`;
    document.getElementById('divSummary').innerHTML = DIVISIONS.map(d => {
      const arr = tasks.filter(t=>t.division===d.id), dDone=arr.filter(t=>t.status==='done').length;
      return `<button class="div-mini" data-summary-div="${d.id}"><strong>${d.name}</strong> · ${dDone}/${arr.length} completed (${arr.length?Math.round(dDone/arr.length*100):0}%)</button>`;
    }).join('');
    document.querySelectorAll('[data-summary-div]').forEach(btn=>btn.addEventListener('click',()=>{
      activeDepartmenton = btn.dataset.summaryDiv;
      document.getElementById('boardTitle').textContent = divisionOf(activeDepartmenton).name;
      renderAll();
    }));
  }

  function notificationCategory(type){ if(type==='mention') return 'mentions'; if(type==='deadline'||type==='overdue') return 'deadlines'; if(type==='assigned') return 'tasks'; return 'messages'; }
  function renderNotifications(){
    maybeToastLatestNotification();
    const list=document.getElementById('notificationList'), badge=document.getElementById('notificationCount');
    const mine=notifications.filter(n=>n.userId===currentRole).sort((a,b)=>new Date(b.at)-new Date(a.at));
    const unread=mine.filter(n=>!n.read).length; badge.textContent=unread>99?'99+':unread; badge.style.display=unread?'flex':'none';
    const filtered=notificationFilter==='all'?mine:mine.filter(n=>notificationCategory(n.type)===notificationFilter);
    list.innerHTML=filtered.length?filtered.map(n=>`<button class="notification-item ${n.read?'':'unread'} ${n.type==='assigned'?'notification-high-priority':''}" data-notification-id="${n.id}"><div class="notification-title">${escapeHtml(n.title)}</div><div class="notification-body">${escapeHtml(n.body)}</div><span class="notification-time">${relativeTime(n.at)}</span></button>`).join(''):'<div class="notification-empty">No notifications in this category.</div>';
    list.querySelectorAll('[data-notification-id]').forEach(btn=>btn.addEventListener('click',()=>{ const n=notifications.find(x=>String(x.id)===btn.dataset.notificationId); if(!n)return; n.read=true; saveNotifications(); document.getElementById('notificationPanel').classList.remove('open'); if(n.taskId) openDetail(n.taskId); else renderNotifications(); }));
  }

  function renderAll(){
    renderRoleSelect(); renderSidebar(); updateBoardContext(); refreshTaskFilters();
    const summaryWrap=document.getElementById('summaryWrap'), board=document.getElementById('board'), dashboard=document.getElementById('dashboardView');
    if(dashboardMode){ renderDashboard(); } else { summaryWrap.style.display=''; board.style.display=''; dashboard.style.display='none'; document.getElementById('boardTools').style.display=''; renderSummary(); renderBoard(); }
    renderNotifications();
  }


  // ---- detail modal ----
  const detailOverlay = document.getElementById('detailOverlay');
  let currentDetailId = null;

  function canAdvance(task){
    // Admin dapat mengelola semua task. PIC juga memiliki kontrol penuh pada task yang menjadi tanggung jawabnya.
    return canManageTask(task);
  }

  function calendarUrl(task){
    const start = task.due.replaceAll('-','');
    const endDate = new Date(task.due + 'T00:00:00'); endDate.setDate(endDate.getDate()+1);
    const end = endDate.toISOString().slice(0,10).replaceAll('-','');
    const params = new URLSearchParams({
      action:'TEMPLATE',
      text:task.title,
      dates:`${start}/${end}`,
      details: task.description || ''
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  function renderChat(taskId){
    const box = document.getElementById('chatList');
    if (!box) return;
    const taskMessages = messages.filter(m => m.taskId === taskId).sort((a,b) => new Date(a.at) - new Date(b.at));
    box.innerHTML = taskMessages.length ? taskMessages.map(m => {
      const person = m.authorId === '__admin__' ? {name:'Admin', color:'#344054'} : memberOf(m.authorId);
      return `<div class="chat-message">
        <div class="chat-avatar" style="background:${person.color}">${escapeHtml(person.name.slice(0,2).toUpperCase())}</div>
        <div class="chat-bubble">
          <div class="chat-meta"><strong>${escapeHtml(person.name)}</strong><span class="chat-time">${relativeTime(m.at)}</span></div>
          <div class="chat-text">${mentionHtml(m.text)}</div>
        </div>
      </div>`;
    }).join('') : '<div class="chat-empty">No messages yet. Start the discussion for this task.</div>';
    box.scrollTop = box.scrollHeight;
    hideMentionSuggestions();
  }

  let mentionState = { open:false, query:'', start:0, end:0, options:[], index:0 };

  function getMentionCandidates(){
    return [{ id:'admin', name:'Admin', color:'#344054', role:'Administrator' }, ...members.map(m => ({...m, role:'Team member'}))];
  }

  function getActiveMention(text, caret){
    const before = String(text || '').slice(0, caret);
    const match = before.match(/(^|\s)@([A-Za-z0-9._-]*)$/);
    if (!match) return null;
    return { query: match[2].toLowerCase(), start: caret - match[2].length - 1, end: caret };
  }

  function renderMentionSuggestions(query){
    const box = document.getElementById('mentionSuggestions');
    if (!box) return;
    const q = String(query || '').trim().toLowerCase();
    const candidates = getMentionCandidates().filter(m => !q || m.name.toLowerCase().startsWith(q) || m.name.toLowerCase().includes(q));
    mentionState.options = candidates;
    mentionState.index = 0;
    if (!candidates.length){ hideMentionSuggestions(); return; }
    box.innerHTML = candidates.map((m,i) => `
      <button type="button" class="mention-option ${i===0?'active':''}" data-mention-index="${i}">
        <span class="mini-avatar" style="background:${m.color}">${escapeHtml(m.name.slice(0,2).toUpperCase())}</span>
        <span><span class="mention-name">@${escapeHtml(m.name)}</span><br><span class="mention-role">${escapeHtml(m.role)}</span></span>
      </button>`).join('');
    box.classList.add('open');
    mentionState.open = true;
    box.querySelectorAll('[data-mention-index]').forEach(btn => btn.addEventListener('mousedown', e => {
      e.preventDefault();
      chooseMention(parseInt(btn.dataset.mentionIndex,10));
    }));
  }

  function hideMentionSuggestions(){
    const box = document.getElementById('mentionSuggestions');
    if (box) box.classList.remove('open');
    mentionState = { open:false, query:'', start:0, end:0, options:[], index:0 };
  }

  function chooseMention(index){
    const input = document.getElementById('chatInput');
    const candidate = mentionState.options[index];
    if (!input || !candidate) return;
    const before = input.value.slice(0, mentionState.start);
    const after = input.value.slice(mentionState.end);
    const insert = `@${candidate.name} `;
    input.value = before + insert + after;
    const caret = before.length + insert.length;
    input.focus();
    input.setSelectionRange(caret, caret);
    hideMentionSuggestions();
  }

  function updateMentionSuggestions(){
    const input = document.getElementById('chatInput');
    if (!input) return;
    const caret = input.selectionStart ?? input.value.length;
    const active = getActiveMention(input.value, caret);
    if (!active){ hideMentionSuggestions(); return; }
    mentionState.start = active.start;
    mentionState.end = active.end;
    mentionState.query = active.query;
    renderMentionSuggestions(active.query);
  }

  function renderContributors(task){
    const box=document.getElementById('contributorsList'), btn=document.getElementById('helpTaskBtn');
    if(!box||!btn)return;
    const ids=Array.isArray(task.contributors)?task.contributors:[];
    box.innerHTML = ids.length ? ids.map(id=>{const m=memberOf(id);return `<span class="contributor-chip"><span class="mini" style="background:${m.color}">${escapeHtml(m.name.slice(0,2).toUpperCase())}</span>${escapeHtml(m.name)}${(isAdmin()||currentRole===task.assignee||id===currentRole)?`<button type="button" data-remove-contributor="${id}" title="Remove contributor">×</button>`:''}</span>`}).join('') : '<span class="dashboard-empty">No contributors yet.</span>';
    btn.style.display = (currentRole===task.assignee || ids.includes(currentRole)) ? 'none' : 'inline-block';
    box.querySelectorAll('[data-remove-contributor]').forEach(b=>b.addEventListener('click',()=>{task.contributors=(task.contributors||[]).filter(id=>id!==b.dataset.removeContributor);task.updatedAt=new Date().toISOString();save();renderContributors(task);renderAll();}));
  }
  function renderAttachments(task){
    const sec=document.getElementById('attachmentsSection'),box=document.getElementById('dAttachmentsList'); const arr=Array.isArray(task.attachments)?task.attachments:[];
    if(!arr.length){sec.style.display='none';return;} sec.style.display='block';
    box.innerHTML=arr.map((a,i)=>`<div class="attachment-item"><a href="${escapeHtml(a.data)}" target="_blank" rel="noopener noreferrer">📎 ${escapeHtml(a.name)}</a><span>${Math.round((a.size||0)/1024)} KB</span></div>`).join('');
  }
  function renderStatusTimeline(task){
    const box=document.getElementById('statusTimeline'); const arr=Array.isArray(task.statusHistory)?task.statusHistory:[];
    box.innerHTML=arr.slice().reverse().map(h=>`<div class="status-row"><span class="dot"></span><div><strong>${STATUS_LABEL[h.status]||h.status}</strong><span>Updated by ${escapeHtml(memberOf(h.by).name)}</span></div><em>${relativeTime(h.at)}</em></div>`).join('') || '<div class="dashboard-empty">No status history.</div>';
  }

    function openDetail(id){
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    currentDetailId = id;
    const chatInput = document.getElementById('chatInput');
    if (chatInput) chatInput.value = '';
    const div = divisionOf(task.division);
    const person = memberOf(task.assignee);
    document.getElementById('dDivTag').textContent = div.name;
    document.getElementById('dDivTag').style.color = div.color;
    document.getElementById('dTitle').textContent = task.title;
    document.getElementById('dStatusPill').textContent = STATUS_LABEL[task.status];
    document.getElementById('dStatusPill').className = `status-pill status-${task.status}`;
    document.getElementById('dDeadlineLabel').innerHTML = deadlineLabel(task) || `<span class="deadline-label inline-date">${formatDate(task.due)}</span>`;
    document.getElementById('dDesc').innerHTML = getTaskDescriptionHtml(task) || '<p>No description provided.</p>';
    document.getElementById('dAssignee').innerHTML = `<span class="avatar" style="background:${person.color};display:inline-flex;vertical-align:middle;margin-right:0.4rem;">${person.name.slice(0,2).toUpperCase()}</span>${person.name}`;
    document.getElementById('dPriority').textContent = PRIORITY_LABEL[task.priority];
    document.getElementById('dDue').textContent = formatDate(task.due);
    document.getElementById('dStatus').textContent = STATUS_LABEL[task.status];
    document.getElementById('dDepartment').textContent = div.name;
    document.getElementById('dProduct').textContent = task.product || 'General';
    document.getElementById('dCreatedBy').textContent = memberOf(task.createdBy).name;
    document.getElementById('dUpdated').textContent = relativeTime(task.updatedAt);
    renderContributors(task);
    renderAttachments(task);
    renderStatusTimeline(task);
    renderChat(task.id);

    const actionBtn = document.getElementById('statusActionBtn');
    const noteBox = document.getElementById('permissionNote');
    const managerNote = document.getElementById('taskManagerNote');
    const deleteBtn = document.getElementById('deleteBtn');
    const editBtn = document.getElementById('editTaskBtn');
    const isTaskPIC = currentRole === task.assignee;
    deleteBtn.style.display = isAdmin() ? 'inline-block' : 'none';
    editBtn.style.display = canEditTask(task) ? 'inline-block' : 'none';
    managerNote.innerHTML = isTaskPIC && !isAdmin()
      ? `<div class="task-manager-note"><strong>You are the PIC for this task.</strong> You can update the task content, add links/images, change its status, and participate in the discussion. Department, product, priority, due date, and reassignment are controlled by Admin.</div>`
      : isAdmin()
        ? `<div class="task-manager-note"><strong>Admin access.</strong> You can manage this task and step in whenever needed.</div>`
        : '';
    document.getElementById('dImageBox').innerHTML = task.image
      ? `<img src="${task.image}" style="width:100%; border-radius:8px; margin-bottom:0.9rem; border:1px solid var(--line);">`
      : '';
    const links = Array.isArray(task.links) ? task.links.filter(l => l && l.label && l.url) : [];
    const dLinksBox = document.getElementById('dLinksBox');
    const dLinksList = document.getElementById('dLinksList');
    if (dLinksBox && dLinksList) {
      dLinksBox.style.display = links.length ? 'block' : 'none';
      dLinksList.innerHTML = links.map(link => {
        let safeUrl = String(link.url).trim();
        if (!/^https?:\/\//i.test(safeUrl)) safeUrl = 'https://' + safeUrl;
        return `<div class="task-link-item"><a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}</a></div>`;
      }).join('');
    }

    const NEXT = { todo: 'progress', progress: 'review', review: 'done', done: 'todo' };
    const LABEL = { todo: 'Start Task', progress: 'Submit for Review', review: 'Mark as Done', done: 'Reopen Task' };

    if (canAdvance(task)){
      actionBtn.style.display = 'inline-block';
      actionBtn.textContent = LABEL[task.status];
      noteBox.innerHTML = '';
    } else {
      actionBtn.style.display = 'none';
      noteBox.innerHTML = `<div class="permission-note">This task is assigned to ${person.name}. You can view the full task, join the discussion, and help with the work. Only the PIC and Admin can change task management fields.</div>`;
    }
    detailOverlay.classList.add('open');
  }

  document.getElementById('helpTaskBtn').addEventListener('click',()=>{const task=tasks.find(t=>t.id===currentDetailId);if(!task||currentRole==='admin'||currentRole===task.assignee)return;task.contributors=Array.isArray(task.contributors)?task.contributors:[];if(!task.contributors.includes(currentRole)){task.contributors.push(currentRole);task.updatedAt=new Date().toISOString();logActivity(task.id,'contributor',`${memberOf(currentRole).name} is helping`);save();makeNotification(task.assignee,'message',`${memberOf(currentRole).name} is helping`,`${memberOf(currentRole).name} joined as a contributor on ${task.title}`,task.id);renderContributors(task);renderAll();}});

  document.getElementById('statusActionBtn').addEventListener('click', () => {
    const task = tasks.find(t => t.id === currentDetailId);
    if (!task || !canAdvance(task)) return;
    const NEXT = { todo: 'progress', progress: 'review', review: 'done', done: 'todo' };
    const oldStatus = task.status;
    task.status = NEXT[task.status];
    const now = new Date().toISOString();
    task.updatedAt = now;
    task.statusHistory = Array.isArray(task.statusHistory) ? task.statusHistory : [];
    task.statusHistory.push({ status: task.status, at: now, by: currentRole });
    logActivity(task.id, 'status', `${STATUS_LABEL[oldStatus]} → ${STATUS_LABEL[task.status]}`);
    save();
    detailOverlay.classList.remove('open');
    renderAll();
  });

  let pendingConfirm = null;
  const confirmOverlay = document.getElementById('confirmOverlay');
  const confirmTitle = document.getElementById('confirmTitle');
  const confirmMessage = document.getElementById('confirmMessage');
  const confirmOkBtn = document.getElementById('confirmOkBtn');
  const confirmCancelBtn = document.getElementById('confirmCancelBtn');
  function closeConfirm(){ pendingConfirm=null; confirmOverlay.classList.remove('open'); }
  function openConfirm({title, message, confirmText='Confirm', danger=true, onConfirm}){
    confirmTitle.textContent=title;
    confirmMessage.textContent=message;
    confirmOkBtn.textContent=confirmText;
    confirmOkBtn.classList.toggle('confirm-danger', danger);
    pendingConfirm=onConfirm;
    confirmOverlay.classList.add('open');
  }
  confirmOkBtn.addEventListener('click',()=>{ const action=pendingConfirm; closeConfirm(); if(action) action(); });
  confirmCancelBtn.addEventListener('click', closeConfirm);
  confirmOverlay.addEventListener('click',e=>{if(e.target===confirmOverlay)closeConfirm();});

document.getElementById('deleteBtn').addEventListener('click', () => {
    if (!isAdmin()) return;
    const task = tasks.find(t => t.id === currentDetailId);
    if (!task) return;
    openConfirm({
      title: 'Delete task?',
      message: `“${task.title}” will be permanently removed from the Task Board.`,
      confirmText: 'Delete task',
      danger: true,
      onConfirm: () => {
        logActivity(currentDetailId, 'delete', 'Task deleted');
        tasks = tasks.filter(t => t.id !== currentDetailId);
        activities = activities.filter(a => a.taskId !== currentDetailId);
        saveActivities();
        save();
        detailOverlay.classList.remove('open');
        renderAll();
      }
    });
  });

  detailOverlay.addEventListener('click', (e) => { if (e.target === detailOverlay) detailOverlay.classList.remove('open'); });

  document.getElementById('calendarBtn').addEventListener('click', () => { const task = tasks.find(t => t.id === currentDetailId); if (task) window.open(calendarUrl(task), '_blank', 'noopener'); });

  const chatInputEl = document.getElementById('chatInput');
  if (chatInputEl) {
    chatInputEl.addEventListener('input', updateMentionSuggestions);
    chatInputEl.addEventListener('keyup', updateMentionSuggestions);
    chatInputEl.addEventListener('click', updateMentionSuggestions);
    chatInputEl.addEventListener('keydown', (e) => {
      if (!mentionState.open) {
        if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); document.getElementById('sendChatBtn').click(); }
        return;
      }
      if (e.key === 'ArrowDown'){ e.preventDefault(); mentionState.index = Math.min(mentionState.index + 1, mentionState.options.length - 1); updateMentionSuggestionActive(); }
      else if (e.key === 'ArrowUp'){ e.preventDefault(); mentionState.index = Math.max(mentionState.index - 1, 0); updateMentionSuggestionActive(); }
      else if (e.key === 'Enter' || e.key === 'Tab'){ e.preventDefault(); chooseMention(mentionState.index); }
      else if (e.key === 'Escape'){ e.preventDefault(); hideMentionSuggestions(); }
      else if (e.key === ' '){ hideMentionSuggestions(); }
    });
  }
  function updateMentionSuggestionActive(){
    const box = document.getElementById('mentionSuggestions');
    if (!box) return;
    box.querySelectorAll('.mention-option').forEach((el,i)=>el.classList.toggle('active', i===mentionState.index));
  }

  document.getElementById('sendChatBtn').addEventListener('click', () => {
    const task = tasks.find(t => t.id === currentDetailId);
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!task || !text) return;
    const authorId = isAdmin() ? 'admin' : currentRole;
    const authorName = actorName();
    const msg = { id: Date.now() + Math.random(), taskId: task.id, authorId: currentRole === 'admin' ? '__admin__' : currentRole, authorName, text, at:new Date().toISOString() };
    messages.push(msg);
    saveMessages();
    if (document.getElementById('mentionNotify')?.checked !== false) usersMentioned(text).forEach(target => {
      if (target.id !== currentRole) {
        makeNotification(target.id, 'mention', `${authorName} mentioned you`, `${authorName}: ${text}`, task.id);
      }
    });
    members.filter(m => m.id !== currentRole && !usersMentioned(text).some(x => x.id === m.id) && (task.assignee === m.id)).forEach(target => {
      if (document.getElementById('chatNotify')?.checked !== false) {
        makeNotification(target.id, 'message', `New message in ${task.title}`, `${authorName}: ${text}`, task.id);
      }
    });
    input.value = '';
    renderChat(task.id);
    renderNotifications();
  });



  // ---- role switch ----
  document.getElementById('roleSelect').addEventListener('change', (e) => {
    currentRole = e.target.value;
    document.getElementById('notificationPanel')?.classList.remove('open');
    renderAll();
    maybeToastLatestNotification();
  });

  // ---- task search + filters ----
  function refreshTaskFilters(){
    const picSelect = document.getElementById('picFilter');
    if (!picSelect) return;
    const previous = picFilter;
    picSelect.innerHTML = '<option value="all">All PICs</option>' + members.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('');
    picSelect.value = members.some(m => m.id === previous) ? previous : 'all';
    picFilter = picSelect.value;
  }
  document.getElementById('taskSearch').addEventListener('input', e => { taskSearch = e.target.value; renderBoard(); });
  document.getElementById('taskSearch').addEventListener('search', e => { taskSearch = e.target.value; renderBoard(); });
  document.getElementById('picFilter').addEventListener('change', e => { picFilter = e.target.value; renderBoard(); });
  document.getElementById('priorityFilter').addEventListener('change', e => { priorityFilter = e.target.value; renderBoard(); });
  document.getElementById('statusFilter').addEventListener('change', e => { statusFilter = e.target.value; renderBoard(); });
  document.getElementById('clearFiltersBtn').addEventListener('click', () => {
    taskSearch = ''; picFilter = 'all'; priorityFilter = 'all'; statusFilter = 'all';
    document.getElementById('taskSearch').value = '';
    document.getElementById('picFilter').value = 'all';
    document.getElementById('priorityFilter').value = 'all';
    document.getElementById('statusFilter').value = 'all';
    renderBoard();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (dashboardMode) return;
      const input = document.getElementById('taskSearch');
      if (input) { input.focus(); input.select(); }
    }
  });

  // ---- add/edit task modal (admin only) ----
  const overlay = document.getElementById('overlay');
  let editingTaskId = null;
  let pendingImage = null;
  let pendingAttachments = [];

  function populateAddForm(selectedDivision=null, selectedProduct=null){
    const deptSelect = document.getElementById('fDepartmenton');
    const productSelect = document.getElementById('fProduct');
    deptSelect.innerHTML = DIVISIONS.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    document.getElementById('fAssignee').innerHTML = members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    document.getElementById('fContributors').innerHTML = members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    if (selectedDivision) deptSelect.value = selectedDivision;
    const refreshProducts = () => {
      const products = productListForDivision(deptSelect.value);
      productSelect.innerHTML = `<option value="">No product / General</option>` + products.map(p => `<option value="${p}">${p}</option>`).join('');
      if (selectedProduct && products.includes(selectedProduct)) productSelect.value = selectedProduct;
    };
    deptSelect.onchange = refreshProducts;
    refreshProducts();
  }

  function renderLinkEditor(links = []){
    const box = document.getElementById('linkEditorList');
    if (!box) return;
    box.innerHTML = '';
    (links || []).forEach(link => addLinkEditorRow(link));
  }

  function addLinkEditorRow(link = {label:'', url:''}){
    const box = document.getElementById('linkEditorList');
    if (!box) return;
    const row = document.createElement('div');
    row.className = 'link-editor-row';
    row.innerHTML = `
      <input type="text" data-link-label placeholder="Link title (e.g. Project Brief)" value="${escapeHtml(link.label || '')}">
      <input type="url" data-link-url placeholder="https://docs.google.com/..." value="${escapeHtml(link.url || '')}">
      <button type="button" class="remove-link-btn" title="Remove link">✕</button>`;
    row.querySelector('.remove-link-btn').addEventListener('click', () => row.remove());
    box.appendChild(row);
  }

  function readLinksFromForm(){
    return [...document.querySelectorAll('#linkEditorList .link-editor-row')].map(row => ({
      label: row.querySelector('[data-link-label]').value.trim(),
      url: row.querySelector('[data-link-url]').value.trim()
    })).filter(link => link.label && link.url);
  }

  function resetForm(){
    editingTaskId = null;
    pendingImage = null; pendingAttachments = [];
    document.getElementById('formModalTitle').textContent = 'New Task';
    document.getElementById('saveBtn').textContent = 'Save';
    document.getElementById('fTitle').value = '';
    document.getElementById('fDesc').innerHTML = '';
    document.getElementById('fPriority').value = 'medium';
    [...document.getElementById('fContributors').options].forEach(o=>o.selected=false);
    document.getElementById('fProduct').value = '';
    document.getElementById('fDepartmenton').disabled = false;
    document.getElementById('fAssignee').disabled = false;
    document.getElementById('fProduct').disabled = false;
    document.getElementById('fPriority').disabled = false;
    document.getElementById('fDue').disabled = false;
    document.getElementById('fDepartmenton').closest('.field')?.classList.remove('disabled-field');
    document.getElementById('fAssignee').closest('.field')?.classList.remove('disabled-field');
    document.getElementById('fProduct').closest('.field')?.classList.remove('disabled-field');
    document.getElementById('fPriority').closest('.field')?.classList.remove('disabled-field');
    document.getElementById('fDue').closest('.field')?.classList.remove('disabled-field');
    document.getElementById('fDue').value = '';
    document.getElementById('fImage').value = '';
    document.getElementById('fImagePreviewBox').innerHTML = '';
    renderLinkEditor([]);
  }

  document.getElementById('addBtn').addEventListener('click', () => {
    if (!isAdmin()) return;
    populateAddForm(activeDepartmenton !== 'all' ? activeDepartmenton : null, activeProduct);
    resetForm();
    if (activeProduct && productListForDivision(activeDepartmenton).includes(activeProduct)) document.getElementById('fProduct').value = activeProduct;
    overlay.classList.add('open');
  });
  document.getElementById('addLinkBtn').addEventListener('click', () => addLinkEditorRow());

  document.getElementById('editTaskBtn').addEventListener('click', () => {
    const task = tasks.find(t => t.id === currentDetailId);
    if (!task || !canEditTask(task)) return;
    populateAddForm(task.division, task.product || null);
    editingTaskId = task.id;
    pendingImage = task.image || null; pendingAttachments = Array.isArray(task.attachments) ? task.attachments.slice() : [];
    document.getElementById('formModalTitle').textContent = 'Edit Task';
    document.getElementById('saveBtn').textContent = 'Save Changes';
    document.getElementById('fTitle').value = task.title;
    document.getElementById('fDesc').innerHTML = getTaskDescriptionHtml(task);
    document.getElementById('fDepartmenton').value = task.division;
    document.getElementById('fAssignee').value = task.assignee; [...document.getElementById('fContributors').options].forEach(o=>o.selected=(task.contributors||[]).includes(o.value));
    const departmentField = document.getElementById('fDepartmenton').closest('.field');
    const assigneeField = document.getElementById('fAssignee').closest('.field');
    const picMode = !isAdmin() && currentRole === task.assignee;
    const priorityField = document.getElementById('fPriority').closest('.field');
    const dueField = document.getElementById('fDue').closest('.field');
    const productField = document.getElementById('fProduct').closest('.field');
    if (departmentField) departmentField.classList.toggle('disabled-field', picMode);
    if (assigneeField) assigneeField.classList.toggle('disabled-field', picMode);
    if (productField) productField.classList.toggle('disabled-field', picMode);
    if (priorityField) priorityField.classList.toggle('disabled-field', picMode);
    if (dueField) dueField.classList.toggle('disabled-field', picMode);
    document.getElementById('fDepartmenton').disabled = picMode;
    document.getElementById('fAssignee').disabled = picMode;
    document.getElementById('fProduct').disabled = picMode;
    document.getElementById('fPriority').disabled = picMode;
    document.getElementById('fDue').disabled = picMode;
    document.getElementById('fPriority').value = task.priority;
    document.getElementById('fDue').value = task.due;
    document.getElementById('fImage').value = '';
    renderLinkEditor(task.links || []);
    document.getElementById('fImagePreviewBox').innerHTML = task.image
      ? `<img src="${task.image}" style="max-width:100%; border-radius:6px; border:1px solid var(--line);">`
      : '';
    detailOverlay.classList.remove('open');
    overlay.classList.add('open');
  });

  document.getElementById('fImage').addEventListener('change', (e) => {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    const readers = files.map(file => new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=ev=>resolve({name:file.name,size:file.size,type:file.type,data:ev.target.result}); r.onerror=reject; r.readAsDataURL(file); }));
    Promise.all(readers).then(items=>{ pendingAttachments = items; pendingImage = items.find(x=>x.type.startsWith('image/'))?.data || pendingImage; document.getElementById('fImagePreviewBox').innerHTML = items.map(x=>`<div style="font-size:.7rem;color:var(--ink-soft);padding:.25rem 0;">📎 ${escapeHtml(x.name)}</div>`).join(''); }).catch(()=>{ alert('Could not read one or more attachments.'); });
  });

  document.getElementById('cancelBtn').addEventListener('click', () => { overlay.classList.remove('open'); resetForm(); });

  // ---- rich text description editor ----
  document.querySelectorAll('#descriptionEditor [data-cmd]').forEach(btn => {
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => {
      document.getElementById('fDesc').focus();
      document.execCommand(btn.dataset.cmd, false, null);
    });
  });
  document.getElementById('insertLinkBtn')?.addEventListener('click', () => {
    const label = window.getSelection()?.toString().trim() || prompt('Link text', 'Open document');
    if (!label) return;
    const url = prompt('Destination URL', 'https://');
    if (!url) return;
    document.getElementById('fDesc').focus();
    document.execCommand('createLink', false, normalizeUrl(url));
  });
  document.getElementById('fDesc')?.addEventListener('paste', (e) => {
    const html = e.clipboardData?.getData('text/html');
    if (!html) return;
    e.preventDefault();
    document.execCommand('insertHTML', false, sanitizeRichHtml(html));
  });

  document.getElementById('saveBtn').addEventListener('click', () => {
    const title = document.getElementById('fTitle').value.trim();
    if (!title) return;
    const data = {
      title,
      description: document.getElementById('fDesc').innerText.trim(),
      descriptionHtml: sanitizeRichHtml(document.getElementById('fDesc').innerHTML),
      // Admin can edit all task-management fields. PIC can edit content only;
      // their original department, assignee, priority, and due date are preserved.
      division: (!editingTaskId || isAdmin())
        ? document.getElementById('fDepartmenton').value
        : (tasks.find(t => t.id === editingTaskId)?.division || document.getElementById('fDepartmenton').value),
      product: (!editingTaskId || isAdmin())
        ? (document.getElementById('fProduct').value || '')
        : (tasks.find(t => t.id === editingTaskId)?.product || ''),
      assignee: (!editingTaskId || isAdmin())
        ? document.getElementById('fAssignee').value
        : (tasks.find(t => t.id === editingTaskId)?.assignee || document.getElementById('fAssignee').value),
      priority: (!editingTaskId || isAdmin())
        ? document.getElementById('fPriority').value
        : (tasks.find(t => t.id === editingTaskId)?.priority || document.getElementById('fPriority').value),
      due: (!editingTaskId || isAdmin())
        ? (document.getElementById('fDue').value || new Date().toISOString().slice(0,10))
        : (tasks.find(t => t.id === editingTaskId)?.due || document.getElementById('fDue').value || new Date().toISOString().slice(0,10)),
      image: pendingImage,
      links: readLinksFromForm(),
      contributors: [...document.getElementById('fContributors').selectedOptions].map(o=>o.value),
      attachments: pendingAttachments,
    };
    if (editingTaskId){
      const task = tasks.find(t => t.id === editingTaskId);
      const oldAssignee = task.assignee;
      const oldStatus = task.status;
      Object.assign(task, data, { updatedAt: new Date().toISOString(), createdBy: task.createdBy || currentRole, createdAt: task.createdAt || new Date().toISOString() });
      task.statusHistory = Array.isArray(task.statusHistory) ? task.statusHistory : [{ status: oldStatus, at: task.createdAt, by: task.createdBy }];
      logActivity(task.id, 'edit', 'Task details updated');
      if (oldAssignee !== task.assignee) {
        logActivity(task.id, 'assign', `${memberOf(oldAssignee).name} → ${memberOf(task.assignee).name}`);
        makeNotification(task.assignee, 'assigned', 'Task assigned to you', `${task.title} — due ${formatDate(task.due)}`, task.id);
      }
      if (oldStatus !== task.status) { logActivity(task.id, 'status', `${STATUS_LABEL[oldStatus]} → ${STATUS_LABEL[task.status]}`); if (task.assignee !== currentRole && currentRole !== 'admin') makeNotification(task.assignee, 'status', 'Task status updated', `${task.title} → ${STATUS_LABEL[task.status]}`, task.id); }
    } else {
      const now = new Date().toISOString();
      const newTask = { id: Date.now(), status: 'todo', ...data, createdBy: currentRole, createdAt: now, updatedAt: now, statusHistory: [{ status: 'todo', at: now, by: currentRole }] };
      tasks.push(newTask);
      logActivity(newTask.id, 'create', `Created for ${memberOf(newTask.assignee).name}`);
      makeNotification(newTask.assignee, 'assigned', 'New task assigned to you', `${newTask.title} — due ${formatDate(newTask.due)}`, newTask.id);
    }
    save();
    overlay.classList.remove('open');
    resetForm();
    renderAll();
  });


  // ---- backup / import ----
  document.getElementById('exportBtn').addEventListener('click', () => {
    const payload = { version: 5, exportedAt: new Date().toISOString(), tasks, members, products, activities, messages, notifications };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `taskboard-backup-${new Date().toISOString().slice(0,10)}.json`; a.click();
    URL.revokeObjectURL(url);
  });
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!Array.isArray(data.tasks) || !Array.isArray(data.members)) throw new Error('Invalid backup format');
        if (!confirm(`Import will replace the current local data with ${data.tasks.length} tasks. Continue?`)) return;
        tasks = data.tasks.map(t=>({ ...t, product:t.product||'', createdBy:t.createdBy||'admin', createdAt:t.createdAt||new Date().toISOString(), updatedAt:t.updatedAt||t.createdAt||new Date().toISOString(), statusHistory:Array.isArray(t.statusHistory)&&t.statusHistory.length?t.statusHistory:[{status:t.status||'todo',at:t.createdAt||new Date().toISOString(),by:t.createdBy||'admin'}],contributors:Array.isArray(t.contributors)?t.contributors:[],attachments:Array.isArray(t.attachments)?t.attachments:[] })); members = data.members; products = data.products && typeof data.products==='object' ? data.products : JSON.parse(JSON.stringify(DEFAULT_PRODUCTS)); activities = Array.isArray(data.activities)?data.activities:[]; messages = Array.isArray(data.messages)?data.messages:[]; notifications = Array.isArray(data.notifications)?data.notifications:[];
        saveAll(); currentRole = 'admin'; activeDepartmenton = 'all'; renderAll(); alert('Data imported successfully.');
      } catch (err) { alert('Import failed: ' + err.message); }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  // ---- notification center ----
  const notificationOverlay = document.getElementById('notificationOverlay');
  const notificationPanel = document.getElementById('notificationPanel');
  function notificationKey(task, type){ return `taskboard_notify_${task.id}_${type}_${task.due}`; }
  function notificationSettings(){
    return {
      d3: document.getElementById('remind3')?.checked ?? true,
      d1: document.getElementById('remind1')?.checked ?? true,
      d0: document.getElementById('remind0')?.checked ?? true,
      overdue: document.getElementById('remindOverdue')?.checked ?? true,
      mention: document.getElementById('mentionNotify')?.checked ?? true,
      chat: document.getElementById('chatNotify')?.checked ?? true
    };
  }
  function daysUntilDue(task){
    const today = new Date(); today.setHours(0,0,0,0);
    const due = new Date(task.due + 'T00:00:00');
    return Math.round((due - today) / 86400000);
  }
  function sendBrowserNotification(title, body, tag){
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try { new Notification(title, { body, tag }); } catch(e) { console.warn('Notification failed', e); }
  }
  function notifyUserFromTask(task, type, title, body){
    if (!task || !task.assignee) return;
    const duplicate = notifications.some(n => n.userId === task.assignee && n.type === type && n.taskId === task.id && n.title === title && new Date(n.at).toDateString() === new Date().toDateString());
    if (!duplicate) makeNotification(task.assignee, type, title, body, task.id);
    if (task.assignee === currentRole) sendBrowserNotification(title, body, `task-${task.id}-${type}`);
  }
  function checkDeadlineNotifications(){
    const settings = notificationSettings();
    tasks.filter(t => t.status !== 'done' && t.due).forEach(task => {
      const d = daysUntilDue(task);
      if (d === 3 && settings.d3) notifyUserFromTask(task, 'deadline', 'Task due in 3 days', `${task.title} — due ${formatDate(task.due)}`);
      if (d === 1 && settings.d1) notifyUserFromTask(task, 'deadline', 'Task due tomorrow', `${task.title} — due ${formatDate(task.due)}`);
      if (d === 0 && settings.d0) notifyUserFromTask(task, 'deadline', 'Task due today', `${task.title} — due today`);
      if (d < 0 && settings.overdue) notifyUserFromTask(task, 'overdue', 'Task overdue', `${task.title} — ${Math.abs(d)} day(s) overdue`);
    });
    renderNotifications();
  }
  function refreshNotificationStatus(){
    const box = document.getElementById('notificationStatus');
    if (!('Notification' in window)) { box.textContent = 'Browser notifications are not supported on this device/browser.'; return; }
    if (Notification.permission === 'granted') box.textContent = '✓ Browser notifications are enabled on this device.';
    else if (Notification.permission === 'denied') box.textContent = 'Notifications are blocked. Enable them in your browser settings.';
    else box.textContent = 'Notifications are not enabled yet.';
  }
  document.getElementById('notifyBtn').addEventListener('click', (e) => { e.stopPropagation(); notificationPanel.classList.toggle('open'); renderNotifications(); });
  document.querySelectorAll('[data-notification-filter]').forEach(btn=>btn.addEventListener('click',()=>{ notificationFilter=btn.dataset.notificationFilter; document.querySelectorAll('[data-notification-filter]').forEach(x=>x.classList.toggle('active',x===btn)); renderNotifications(); }));
  document.getElementById('markAllReadBtn').addEventListener('click', () => { notifications.filter(n => n.userId === currentRole).forEach(n => n.read = true); saveNotifications(); renderNotifications(); });
  document.getElementById('notificationSettingsBtn').addEventListener('click', () => { refreshNotificationStatus(); notificationPanel.classList.remove('open'); notificationOverlay.classList.add('open'); });
  document.getElementById('closeNotificationsBtn').addEventListener('click', () => { notificationOverlay.classList.remove('open'); saveNotifications(); renderNotifications(); });
  document.getElementById('enableNotificationsBtn').addEventListener('click', async () => {
    if (!('Notification' in window)) return;
    const permission = await Notification.requestPermission();
    refreshNotificationStatus();
    if (permission === 'granted') { checkDeadlineNotifications(); sendBrowserNotification('Task Board notifications enabled', 'You will receive reminders and mention alerts on this device.', 'taskboard-enabled'); }
  });
  ['remind3','remind1','remind0','remindOverdue','mentionNotify','chatNotify'].forEach(id => document.getElementById(id)?.addEventListener('change', checkDeadlineNotifications));
  document.getElementById('calendarHelpBtn').addEventListener('click', () => {
    alert('Google Calendar is an optional reminder layer. Open a task and click “＋ Google Calendar” to add its deadline. Full automatic sync requires Google OAuth + a backend.');
  });
  notificationOverlay.addEventListener('click', (e) => { if (e.target === notificationOverlay) notificationOverlay.classList.remove('open'); });
  document.addEventListener('click', (e) => {
    const wrap = document.querySelector('.notification-wrap');
    if (wrap && !wrap.contains(e.target)) notificationPanel.classList.remove('open');
  });
  checkDeadlineNotifications();
  setInterval(checkDeadlineNotifications, 60000);

  // ---- product management ----
  const productsOverlay=document.getElementById('productsOverlay');
  function renderProductManager(){
    const box=document.getElementById('productManagerBody');
    box.innerHTML=DIVISIONS.map(d=>{ const arr=productListForDivision(d.id); return `<section class="product-manager-section"><div class="product-manager-head"><strong>${escapeHtml(d.name)}</strong><button type="button" class="product-add-trigger" data-add-product="${d.id}">+ Add product</button></div><div class="product-manager-items" data-product-items="${d.id}">${arr.length?arr.map((p,i)=>`<div class="product-manager-row"><input type="text" value="${escapeHtml(p)}" data-product-dept="${d.id}" data-product-index="${i}"><button type="button" data-remove-product="${d.id}" data-product-index="${i}" title="Remove product" aria-label="Remove product">✕</button></div>`).join(''):'<div class="import-note product-none" style="padding:.6rem .75rem;">No products yet.</div>'}</div></section>`; }).join('');

    box.querySelectorAll('[data-add-product]').forEach(btn=>btn.addEventListener('click',()=>{
      const divId=btn.dataset.addProduct;
      const items=box.querySelector(`[data-product-items="${divId}"]`);
      if(!items) return;
      items.querySelector('.product-none')?.remove();
      if(items.querySelector('[data-new-product]')){
        items.querySelector('[data-new-product] input')?.focus();
        return;
      }
      const row=document.createElement('div');
      row.className='product-manager-row product-new-row';
      row.setAttribute('data-new-product','true');
      row.innerHTML=`<input type="text" placeholder="Product name" autocomplete="off"><button type="button" class="product-save-new" title="Save product">✓</button><button type="button" class="product-cancel-new" title="Cancel">✕</button>`;
      items.appendChild(row);
      const input=row.querySelector('input');
      const finish=(saveIt)=>{
        const name=input.value.trim();
        if(!saveIt){ row.remove(); if(!items.children.length) items.innerHTML='<div class="import-note product-none" style="padding:.6rem .75rem;">No products yet.</div>'; return; }
        if(!name) { input.focus(); return; }
        if(productListForDivision(divId).some(p=>p.toLowerCase()===name.toLowerCase())) { alert('That product already exists in this department.'); input.focus(); return; }
        products[divId]=[...productListForDivision(divId),name];
        saveProducts();
        renderProductManager();
        renderAll();
      };
      row.querySelector('.product-save-new').addEventListener('click',()=>finish(true));
      row.querySelector('.product-cancel-new').addEventListener('click',()=>finish(false));
      input.addEventListener('keydown',e=>{ if(e.key==='Enter'){e.preventDefault();finish(true);} if(e.key==='Escape'){e.preventDefault();finish(false);} });
      input.focus();
    }));

    box.querySelectorAll('input[data-product-index]').forEach(inp=>inp.addEventListener('change',()=>{const divId=inp.dataset.productDept,idx=Number(inp.dataset.productIndex),name=inp.value.trim(); if(!name)return; const oldName=products[divId][idx]; if(name!==oldName&&allProducts().some(p=>p.toLowerCase()===name.toLowerCase())){alert('That product name is already used.'); inp.value=oldName; return;} products[divId][idx]=name; tasks.forEach(t=>{if(t.division===divId&&t.product===oldName){t.product=name;t.updatedAt=new Date().toISOString();}}); saveProducts(); save(); renderProductManager(); renderAll();}));
    box.querySelectorAll('[data-remove-product]').forEach(btn=>btn.addEventListener('click',(e)=>{
      e.preventDefault();
      e.stopPropagation();
      const divId = btn.dataset.removeProduct;
      const idx = Number(btn.dataset.productIndex);
      const oldName = products[divId]?.[idx];
      if (!oldName) return;
      const row = btn.closest('.product-manager-row');
      if (!row) return;
      const items = row.parentElement;
      const taskCount = tasks.filter(t => t.division === divId && t.product === oldName).length;
      const originalHtml = row.innerHTML;
      row.classList.add('product-delete-confirm');
      row.innerHTML = `<div class="product-delete-message"><strong>Remove “${escapeHtml(oldName)}”?</strong>${taskCount ? `<span>${taskCount} task${taskCount === 1 ? '' : 's'} will become General.</span>` : '<span>No tasks are using this product.</span>'}</div><div class="product-delete-actions"><button type="button" class="product-cancel-delete">Cancel</button><button type="button" class="product-confirm-delete">Remove</button></div>`;
      const restore = () => { renderProductManager(); };
      row.querySelector('.product-cancel-delete').addEventListener('click', restore);
      row.querySelector('.product-confirm-delete').addEventListener('click',()=>{
        const currentIndex = products[divId]?.indexOf(oldName);
        if (currentIndex === -1 || currentIndex == null) return;
        products[divId].splice(currentIndex,1);
        tasks.forEach(t=>{
          if(t.division===divId && t.product===oldName){
            t.product='';
            t.updatedAt=new Date().toISOString();
          }
        });
        saveProducts();
        save();
        if (activeProduct === oldName && activeDepartmenton === divId) activeProduct = null;
        renderProductManager();
        renderAll();
      });
    }));
  }
  document.getElementById('productsBtn').addEventListener('click',()=>{if(!isAdmin())return;renderProductManager();productsOverlay.classList.add('open');});
  document.getElementById('closeProductsBtn').addEventListener('click',()=>{productsOverlay.classList.remove('open');renderAll();});
  productsOverlay.addEventListener('click',e=>{if(e.target===productsOverlay)productsOverlay.classList.remove('open');});

  // ---- members modal ----
  const membersOverlay = document.getElementById('membersOverlay');
  function renderMemberRows(){
    const box = document.getElementById('memberRows');
    box.innerHTML = `<div class="member-manager-head"><span>Name</span><span>Email</span><span>Role</span><span>Active</span><span></span></div>` + members.map((m, i) => `
      <div class="member-row member-manager-row" data-idx="${i}">
        <div class="member-person"><input type="color" value="${m.color}" data-field="color"><input type="text" value="${escapeHtml(m.name)}" data-field="name"></div>
        <input type="email" value="${escapeHtml(m.email || '')}" data-field="email" placeholder="name@company.com">
        <select data-field="role" aria-label="Role for ${escapeHtml(m.name)}"><option value="member" ${(m.role||'member')==='member'?'selected':''}>Member</option><option value="admin" ${(m.role||'member')==='admin'?'selected':''}>Admin</option></select>
        <label class="active-toggle"><input type="checkbox" data-field="active" ${(m.active!==false)?'checked':''}><span>${m.active!==false?'Active':'Inactive'}</span></label>
        <button class="remove-member" data-remove="${i}" title="Remove member">✕</button>
      </div>`).join('');
    box.querySelectorAll('input[data-field="name"]').forEach(inp => inp.addEventListener('input', e => { const idx = parseInt(e.target.closest('.member-row').dataset.idx); members[idx].name = e.target.value; saveMembers(); renderRoleSelect(); }));
    box.querySelectorAll('input[data-field="email"]').forEach(inp => inp.addEventListener('input', e => { const idx = parseInt(e.target.closest('.member-row').dataset.idx); members[idx].email = e.target.value; saveMembers(); }));
    box.querySelectorAll('input[data-field="color"]').forEach(inp => inp.addEventListener('input', e => { const idx = parseInt(e.target.closest('.member-row').dataset.idx); members[idx].color = e.target.value; saveMembers(); renderBoard(); }));
    box.querySelectorAll('select[data-field="role"]').forEach(sel => sel.addEventListener('change', e => { const idx = parseInt(e.target.closest('.member-row').dataset.idx); members[idx].role = e.target.value; saveMembers(); renderRoleSelect(); }));
    box.querySelectorAll('input[data-field="active"]').forEach(inp => inp.addEventListener('change', e => { const idx = parseInt(e.target.closest('.member-row').dataset.idx); members[idx].active = e.target.checked; saveMembers(); renderMemberRows(); renderRoleSelect(); }));
    box.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', e => {
      const idx = parseInt(e.target.dataset.remove);
      const m = members[idx];
      if (!m) return;
      openConfirm({ title:'Remove member?', message:`“${m.name}” will be removed from the team member list.`, confirmText:'Remove member', danger:true, onConfirm:()=>{ members.splice(idx,1); saveMembers(); renderMemberRows(); renderAll(); } });
    }));
  }
document.getElementById('membersBtn').addEventListener('click', () => {
    renderMemberRows();
    membersOverlay.classList.add('open');
  });
  document.getElementById('closeMembersBtn').addEventListener('click', () => {
    membersOverlay.classList.remove('open');
    renderRoleSelect();
    renderBoard();
  });
  document.getElementById('addMemberBtn').addEventListener('click', () => {
    const newId = 'm' + Date.now();
    members.push({ id: newId, name: 'New Member', email: '', color: '#999999', role:'member', active:true });
    saveMembers();
    renderMemberRows();
  });
  membersOverlay.addEventListener('click', (e) => { if (e.target === membersOverlay) membersOverlay.classList.remove('open'); });

  renderAll();
