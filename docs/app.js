import { CONFIG } from './config.js';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service worker registration failed', err);
    });
  });
}

const STORE_KEY = 'life_timeline_v1';
const els = {
  date: document.getElementById('date'),
  title: document.getElementById('title'),
  category: document.getElementById('category'),
  notes: document.getElementById('notes'),
  image: document.getElementById('image'),
  save: document.getElementById('save'),
  clear: document.getElementById('clear'),
  del: document.getElementById('delete'),
  status: document.getElementById('status'),
  timeline: document.getElementById('timeline'),
  events: document.getElementById('events'),
  ticks: document.getElementById('ticks'),
  empty: document.getElementById('empty'),
  zoom: document.getElementById('zoom'),
  search: document.getElementById('search'),
  export: document.getElementById('export'),
  importFile: document.getElementById('importFile'),
  reset: document.getElementById('reset'),
  stats: document.getElementById('stats'),
  span: document.getElementById('span'),
  categoryChips: document.getElementById('categoryChips'),
  categoryList: document.getElementById('categoryList'),
  timelineCard: document.getElementById('timelineCard'),
  sync: document.getElementById('sync'),
  remoteStatus: document.getElementById('remoteStatus')
};

const state = {
  events: [],
  zoom: 60,
  filterCategory: null,
  query: '',
  editingId: null,
  lastSync: null,
  syncing: false
};

class GoogleSheetService {
  constructor(config){ this.config = config || {}; }
  get enabled(){
    return Boolean(this.config.appsScriptUrl && this.config.apiKey);
  }
  async request(payload){
    if(!this.enabled){ throw new Error('Remote sync not configured.'); }
    const res = await fetch(this.config.appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        apiKey: this.config.apiKey,
        sheetName: this.config.sheetName || 'Events'
      })
    });
    const data = await res.json().catch(()=>({ error: 'Bad JSON from Apps Script' }));
    if(!res.ok || data.error){
      throw new Error(data.error || `Apps Script error (${res.status})`);
    }
    return data;
  }
  async listEvents(){
    const data = await this.request({ action: 'list' });
    return Array.isArray(data.events) ? data.events.map(normalizeEvent) : [];
  }
  async upsertEvent(event){
    await this.request({ action:'upsert', event });
  }
  async deleteEvent(id){
    await this.request({ action:'delete', id });
  }
}

const sheets = new GoogleSheetService(CONFIG);

function normalizeEvent(ev){
  if(!ev){ return null; }
  return {
    id: ev.id || uid(),
    dateISO: (ev.dateISO || ev.date || '').slice(0,10),
    title: ev.title || '(untitled)',
    category: ev.category || '',
    notes: ev.notes || '',
    image: ev.image || ''
  };
}

function load(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(!raw) return;
    const parsed = JSON.parse(raw);
    state.events = Array.isArray(parsed.events) ? parsed.events.map(normalizeEvent).filter(Boolean) : [];
    state.zoom = Number(parsed.zoom) || state.zoom;
    state.filterCategory = parsed.filterCategory || null;
    state.query = parsed.query || '';
  }catch(err){
    console.warn('Failed to load state', err);
  }
}

function save(){
  const payload = {
    events: state.events,
    zoom: state.zoom,
    filterCategory: state.filterCategory,
    query: state.query
  };
  localStorage.setItem(STORE_KEY, JSON.stringify(payload));
}

const byDate = (a,b) => new Date(a.dateISO) - new Date(b.dateISO);
const fmt = (d) => new Date(d).toLocaleDateString(undefined,{year:'numeric', month:'short', day:'numeric'});
const yearsBetween = (a,b) => ( (new Date(b) - new Date(a)) / (1000*60*60*24*365.2425) );
const clamp = (x,min,max)=>Math.max(min,Math.min(max,x));
function uid(){ return Math.random().toString(36).slice(2,10); }

function setStatus(msg, variant){
  els.status.textContent = msg || '';
  els.status.className = `help ${variant || ''}`.trim();
}
function setRemoteStatus(msg, isError=false){
  if(!els.remoteStatus) return;
  const suffix = state.lastSync ? ` • ${state.lastSync.toLocaleTimeString()}` : '';
  els.remoteStatus.textContent = msg ? `${msg}${suffix && !isError ? suffix : ''}` : '';
  els.remoteStatus.classList.toggle('danger', Boolean(isError));
}

function rebuildCategoryUI(){
  const cats = [...new Set(state.events.map(e => e.category).filter(Boolean))].sort();
  els.categoryChips.innerHTML = '';
  els.categoryList.innerHTML = '';
  cats.forEach(c=>{
    const opt=document.createElement('option'); opt.value=c; els.categoryList.appendChild(opt);
    const chip=document.createElement('span');
    chip.className='pill';
    chip.textContent = (state.filterCategory===c) ? `● ${c}` : c;
    chip.onclick=()=>{ state.filterCategory = (state.filterCategory===c)? null : c; save(); render(); };
    els.categoryChips.appendChild(chip);
  });
}

function render(){
  const events = [...state.events].sort(byDate);
  const q = state.query.trim().toLowerCase();
  const filtered = events.filter(e=>{
    const okCat = !state.filterCategory || e.category===state.filterCategory;
    const okQ = !q || (e.title.toLowerCase().includes(q) || (e.notes||'').toLowerCase().includes(q) || (e.category||'').toLowerCase().includes(q));
    return okCat && okQ;
  });
  const hasData = events.length>0;
  els.empty.style.display = hasData ? 'none' : 'block';

  if(hasData){
    const first = events[0].dateISO, last = new Date().toISOString().slice(0,10);
    const spanYears = yearsBetween(first, last);
    els.span.textContent = `Span: ${spanYears.toFixed(1)} years`;
    els.stats.textContent = `${events.length} events`;
  } else {
    els.span.textContent = '';
    els.stats.textContent = '0 events';
  }

  els.events.innerHTML = '';
  els.ticks.innerHTML = '';

  if(!hasData){
    removeNowMarker();
    rebuildCategoryUI();
    return;
  }

  const start = events[0].dateISO;
  const end = new Date();
  const totalYears = Math.max(0.5, yearsBetween(start, end));
  const pxPerYear = (state.zoom||60);
  const totalHeight = Math.max(400, totalYears * pxPerYear + 120);
  els.timeline.style.height = totalHeight + 'px';

  const startYear = new Date(start).getFullYear();
  const endYear = new Date().getFullYear();
  for(let y=startYear; y<=endYear; y++){
    const yDate = new Date(y,0,1);
    const ty = yearsBetween(start, yDate) * pxPerYear;
    const tick = document.createElement('div');
    tick.className='year-tick'; tick.style.top = (ty)+'px';
    els.ticks.appendChild(tick);

    const label=document.createElement('div');
    label.className='year-label'; label.style.top=(ty)+'px'; label.textContent = y;
    els.ticks.appendChild(label);
  }

  const nowY = yearsBetween(start, new Date()) * pxPerYear;
  let now = document.querySelector('.now-marker');
  if(!now){ now=document.createElement('div'); now.className='now-marker'; now.textContent='Now'; els.timeline.appendChild(now); }
  now.style.top = nowY+'px';

  filtered.forEach(ev=>{
    const t = yearsBetween(start, ev.dateISO) * pxPerYear;

    const wrap = document.createElement('div');
    wrap.className='event';
    wrap.style.top = (t)+'px';

    const dot = document.createElement('div');
    dot.className='dot';
    dot.title = ev.category || '';
    wrap.appendChild(dot);

    const card = document.createElement('div');
    card.className='card event-card';
    if(ev.category){
      const hue = [...ev.category].reduce((a,c)=>a+c.charCodeAt(0),0)%360;
      card.style.borderLeftColor = `hsl(${hue} 70% 50% / 1)`;
      dot.style.background = `hsl(${hue} 70% 50% / 1)`;
      dot.style.borderColor = `hsl(${hue} 70% 30% / 1)`;
    }

    const title = document.createElement('div');
    title.className='event-title';
    title.textContent = ev.title || '(untitled)';

    const date = document.createElement('div');
    date.className='event-date';
    date.textContent = fmt(ev.dateISO);

    const chips = document.createElement('div');
    chips.className='chips';
    if(ev.category){
      const c=document.createElement('span'); c.className='chip'; c.textContent=ev.category; chips.appendChild(c);
    }

    const notes = document.createElement('div');
    notes.className='event-notes';
    notes.textContent = ev.notes || '';

    card.appendChild(title);
    card.appendChild(date);
    if(ev.image){
      const fig=document.createElement('div'); fig.className='figure';
      const img=new Image(); img.src=ev.image; img.loading='lazy';
      fig.appendChild(img); card.appendChild(fig);
    }
    if(ev.category) card.appendChild(chips);
    if(ev.notes) card.appendChild(notes);

    card.onclick = ()=>populateForm(ev.id);
    wrap.appendChild(card);
    els.events.appendChild(wrap);
  });

  rebuildCategoryUI();
}

function removeNowMarker(){
  const marker = document.querySelector('.now-marker');
  if(marker) marker.remove();
}

function populateForm(id){
  const ev = state.events.find(e=>e.id===id);
  if(!ev) return;
  state.editingId = ev.id;
  els.date.value = ev.dateISO;
  els.title.value = ev.title || '';
  els.category.value = ev.category || '';
  els.notes.value = ev.notes || '';
  els.image.value = ev.image || '';
  els.del.disabled = false;
  setStatus('Loaded event for editing. Click “Save Event” to update.');
}

function clearForm(showMsg=true){
  state.editingId = null;
  els.date.value=''; els.title.value=''; els.category.value=''; els.notes.value=''; els.image.value='';
  els.del.disabled = true;
  if(showMsg) setStatus('Form cleared.'); else setStatus('');
}

async function addOrUpdate(){
  const dateISO = els.date.value;
  const title = els.title.value.trim();
  if(!dateISO || !title){
    setStatus('Please provide both Date and Title.', 'danger');
    return;
  }
  const payload = {
    id: state.editingId || uid(),
    dateISO,
    title,
    category: els.category.value.trim() || '',
    notes: els.notes.value.trim() || '',
    image: els.image.value.trim() || ''
  };

  const idx = state.events.findIndex(e=>e.id===payload.id);
  if(idx>-1){
    state.events[idx] = payload;
    setStatus('Updated event ✓', 'success');
  }else{
    state.events.push(payload);
    setStatus('Added event ✓', 'success');
  }
  state.events.sort(byDate);
  save();
  render();
  scrollToEvent(payload.dateISO);
  clearForm(false);

  try{
    if(sheets.enabled){
      setRemoteStatus('Saving to Sheet…');
      await sheets.upsertEvent(payload);
      state.lastSync = new Date();
      setRemoteStatus('Saved to Sheet');
      await syncFromSheet({ silent:true });
    }else{
      setRemoteStatus('Local mode');
    }
  }catch(err){
    console.error(err);
    setRemoteStatus('Save failed — check console', true);
    setStatus(err.message || 'Google Sheets save failed', 'danger');
  }
}

function scrollToEvent(dateISO){
  const start = state.events[0]?.dateISO;
  if(!start) return;
  const y = yearsBetween(start, dateISO) * (state.zoom||60);
  els.timelineCard.scrollTo({ top: Math.max(0, y-120), behavior:'smooth' });
}

async function deleteEvent(){
  if(!state.editingId) return;
  if(!confirm('Delete this event?')) return;
  state.events = state.events.filter(e=>e.id!==state.editingId);
  save();
  render();
  const deletedId = state.editingId;
  clearForm(false);
  setStatus('Event deleted.', 'success');
  if(!sheets.enabled) return;
  try{
    setRemoteStatus('Deleting…');
    await sheets.deleteEvent(deletedId);
    state.lastSync = new Date();
    setRemoteStatus('Deleted from Sheet');
    await syncFromSheet({ silent:true });
  }catch(err){
    console.error(err);
    setRemoteStatus('Delete failed — check console', true);
    setStatus(err.message || 'Delete failed', 'danger');
  }
}

function exportJSON(){
  const blob = new Blob([JSON.stringify({events:state.events}, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'life-timeline.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importJSON(file){
  const reader = new FileReader();
  reader.onload = (e)=>{
    try{
      const obj = JSON.parse(e.target.result);
      if(Array.isArray(obj.events)){
        state.events = obj.events.map(normalizeEvent).sort(byDate);
        save(); render();
        setStatus('Imported ✓', 'success');
      }else{
        setStatus('Invalid file.', 'danger');
      }
    }catch(err){
      console.error(err);
      setStatus('Import failed.', 'danger');
    }
  };
  reader.readAsText(file);
}

function resetAll(){
  if(confirm('This will delete all saved events on this device. Continue?')){
    state.events = [];
    state.filterCategory = null;
    state.query = '';
    save(); render();
    clearForm(false);
    setStatus('Data cleared.', 'success');
  }
}

async function syncFromSheet({ silent=false } = {}){
  if(!sheets.enabled || state.syncing) return;
  state.syncing = true;
  if(!silent) setStatus('Syncing with Google Sheets…');
  setRemoteStatus('Syncing…');
  try{
    const events = await sheets.listEvents();
    state.events = events.sort(byDate);
    state.lastSync = new Date();
    save(); render();
    if(!silent) setStatus('Sync complete ✓', 'success');
    setRemoteStatus(`Synced (${state.events.length})`);
  }catch(err){
    console.error(err);
    if(!silent) setStatus(err.message || 'Sync failed', 'danger');
    setRemoteStatus('Sync failed', true);
  }finally{
    state.syncing = false;
  }
}

function bindEvents(){
  els.save.addEventListener('click', addOrUpdate);
  els.clear.addEventListener('click', ()=>clearForm(true));
  els.del.addEventListener('click', deleteEvent);
  els.zoom.value = state.zoom;
  els.zoom.addEventListener('input', (e)=>{ state.zoom = +e.target.value; save(); render(); });
  els.search.value = state.query;
  els.search.addEventListener('input', (e)=>{ state.query = e.target.value; save(); render(); });
  els.export.addEventListener('click', exportJSON);
  els.importFile.addEventListener('change', (e)=>{
    const file = e.target.files?.[0];
    if(file) importJSON(file);
    e.target.value='';
  });
  els.reset.addEventListener('click', resetAll);
  els.sync.addEventListener('click', ()=>syncFromSheet({ silent:false }));
  [els.title, els.date].forEach(el=>{
    el.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); addOrUpdate(); }});
  });
}

function init(){
  load();
  bindEvents();
  render();
  if(sheets.enabled){
    if(CONFIG.autoSyncOnLoad){ syncFromSheet({ silent:false }); }
    if(CONFIG.autoSyncIntervalMs > 0){
      setInterval(()=>syncFromSheet({ silent:true }), CONFIG.autoSyncIntervalMs);
    }
  }else{
    setRemoteStatus('Local mode');
  }
}

init();
