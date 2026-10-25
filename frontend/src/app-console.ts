import {formatUptime} from './uptime';
import {LitElement,html,css,nothing} from 'lit';
import {store,fmt} from './model';

export const builtinCommands=['help','commands','status','clear','refresh','services','ha','weather','uptime','settings','focus','expand','collapse'];
type OutputLine={text:string;kind:'input'|'output'|'error'};
interface ConsoleMemory {id:string;history:string[];lines:OutputLine[];clearedAt:number}
interface ConsoleUpdate {command?:string;lines?:OutputLine[];clear?:boolean}

export class AppConsole extends LitElement {
 static properties={lines:{state:true},draft:{state:true},busy:{state:true},expanded:{state:true},clearedAt:{state:true},inputFocused:{state:true}};
 lines:OutputLine[]=[];draft='';busy=false;expanded=false;clearedAt=0;inputFocused=false;
 private history:string[]=[];private historyIndex=0;private savedDraft='';private followOutput=true;
 private ready:Promise<void>=Promise.resolve();private pending:Promise<void>=Promise.resolve();private sessionId='';
 private refresh=()=>this.requestUpdate();
 private historyCleared=()=>{this.history=[];this.historyIndex=0;this.savedDraft='';};
 private sessionChanged=()=>{if(store.sessionId&&store.sessionId!==this.sessionId)this.ready=this.restore();};
 private async restore(){try{const r=await fetch('/api/v1/console',{cache:'no-store'});if(!r.ok)throw Error('Could not restore console history.');const saved:ConsoleMemory=await r.json();this.sessionId=saved.id;this.history=saved.history;this.historyIndex=this.history.length;this.lines=saved.lines;this.clearedAt=saved.clearedAt;this.followOutput=true;}catch(error){this.lines=[{text:error instanceof Error?error.message:'Could not restore console history.',kind:'error'}];}}
 private queueSave(update:ConsoleUpdate){this.pending=this.pending.then(async()=>{const r=await fetch('/api/v1/console',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(update),keepalive:true});if(!r.ok){const result=await r.json();throw Error(result.error??'Could not save console history.');}}).catch(error=>{this.lines=[...this.lines,{text:error instanceof Error?error.message:'Could not save console history.',kind:'error'}].slice(-120) as OutputLine[];});}
 private clearOutput(){this.lines=[];this.clearedAt=Date.now();this.queueSave({clear:true});}

 connectedCallback(){super.connectedCallback();store.addEventListener('change',this.refresh);store.addEventListener('session',this.sessionChanged);store.addEventListener('history-cleared',this.historyCleared);this.ready=this.restore();}
 disconnectedCallback(){super.disconnectedCallback();store.removeEventListener('change',this.refresh);store.removeEventListener('session',this.sessionChanged);store.removeEventListener('history-cleared',this.historyCleared);}
 private get output(){return this.renderRoot.querySelector<HTMLElement>('.output');}
 protected updated(){if(this.followOutput&&this.output)this.output.scrollTop=this.output.scrollHeight;}
 private print(text:string,kind:OutputLine['kind']='output',persist=true){this.lines=[...this.lines,{text,kind}].slice(-120);this.followOutput=true;if(persist)this.queueSave({lines:[{text,kind}]});}
 private focusInput(){void this.updateComplete.then(()=>this.renderRoot.querySelector<HTMLInputElement>('input')?.focus());}
 toggleExpanded(){this.resize(!this.expanded);}
 private resize(expanded:boolean){this.expanded=expanded;this.closest('console-panel')?.classList.toggle('expanded',expanded);this.dispatchEvent(new CustomEvent('console-resize',{detail:expanded,bubbles:true,composed:true}));this.focusInput();}
 private get names(){return [...builtinCommands,...(store.config?.commands??[]).map(c=>c.name)];}
 private completions:string[]=[];private completionIndex=-1;private lastCompletion='';
 private complete(name:string){this.draft=name;this.historyIndex=this.history.length;this.savedDraft='';this.focusInput();}
 private keydown(e:KeyboardEvent){
  if(e.isComposing)return;
  if(e.key==='ArrowUp'||e.key==='ArrowDown'){
   e.preventDefault();if(!this.history.length)return;
   if(this.historyIndex===this.history.length)this.savedDraft=this.draft;
   const direction=e.key==='ArrowUp'?-1:1;let next=this.historyIndex+direction;
   while(next>=0&&next<this.history.length&&!this.history[next].toLowerCase().startsWith(this.savedDraft.toLowerCase()))next+=direction;
   if(next>=0){this.historyIndex=Math.min(next,this.history.length);this.draft=this.history[this.historyIndex]??this.savedDraft;}
  }else if(e.key==='Tab'){
   e.preventDefault();const prefix=this.draft.trim().toLowerCase();if(/\s/.test(prefix))return;
   if(this.draft!==this.lastCompletion||!this.completions.length){this.completions=this.names.filter(n=>n.startsWith(prefix));this.completionIndex=e.shiftKey?0:-1;}
   if(this.completions.length){this.completionIndex=(this.completionIndex+(e.shiftKey?-1:1)+this.completions.length)%this.completions.length;this.lastCompletion=this.completions[this.completionIndex];this.complete(this.lastCompletion);}
  }else if(e.ctrlKey&&e.key.toLowerCase()==='l'){
   e.preventDefault();this.clearOutput();
  }else if(e.key==='Escape'&&this.expanded){e.preventDefault();this.resize(false);}
 }
 private async submit(e:SubmitEvent){e.preventDefault();await this.execute();}
 async execute(){
  const input=this.draft.trim();if(!input||this.busy)return;
  this.busy=true;await this.ready;
  this.draft='';this.lastCompletion='';this.completions=[];if(this.history.at(-1)!==input)this.history.push(input);this.history=this.history.slice(-500);this.historyIndex=this.history.length;this.savedDraft='';
  const [name,...args]=input.toLowerCase().split(/\s+/);const s=store.state;
  if(name==='clear'&&!args.length){this.lines=[];this.clearedAt=Date.now();this.queueSave({command:input,clear:true});await this.pending;this.busy=false;this.focusInput();return;}
  this.print('$ '+input,'input',false);this.queueSave({command:input,lines:[{text:'$ '+input,kind:'input'}]});await this.pending;
  try {
   if(args.length&&name!=='focus'){this.print('This command takes no arguments. Type help for usage.','error');return;}
   switch(name){
    case 'help':this.print('SIDEPANEL COMMANDS\nhelp / commands  Show available commands\nstatus           System overview\nrefresh          Fetch the latest dashboard data\nservices / ha    Service or Home Assistant status\nweather / uptime Show weather or uptime\nfocus start|pause|reset  Control the focus timer\nsettings         Open Settings\nclear            Clear visible output (Ctrl+L)\nexpand / collapse  Resize this console (Esc to collapse)\nCustom commands: configure application, CMD, website or folder shortcuts in Settings.');break;
    case 'commands':this.print(this.names.join('\n'));break;
    case 'status':this.print(s?`HARDWARE ${s.hardwareStatus}\nCPU ${fmt(s.metrics.cpu?.value)}% · GPU ${fmt(s.metrics.gpu?.value)}% · MEMORY ${fmt(s.metrics.memory?.value)}%\nDISK R ${fmt(s.metrics.diskRead?.value,2)} MB/s · W ${fmt(s.metrics.diskWrite?.value,2)} MB/s\nHOME ASSISTANT ${s.homeAssistant?.status??'CONNECTING'}\nUpdated ${new Date(s.time).toLocaleTimeString('en-GB')}`:'Waiting for system data.');break;
    case 'refresh':{
     this.busy=true;const response=await fetch('/api/v1/state',{cache:'no-store',signal:AbortSignal.timeout(10000)});
     if(!response.ok)throw Error('Refresh failed.');store.state=await response.json();store.dispatchEvent(new Event('change'));this.print('Dashboard refreshed from the latest available sample.');break;
    }
    case 'services':this.print(s?.services.length?s.services.map(p=>`${p.online===true?'ONLINE':p.online===false?'OFFLINE':'PENDING'}  ${p.name}\n  ${p.url}`).join('\n'):'No services configured.');break;
    case 'ha':{
     const h=s?.homeAssistant;this.print(h?`HOME ASSISTANT ${h.status}\n${h.message}\n${[h.temperature,h.humidity,...h.entities].filter(e=>e).map(e=>`${e!.entityId}  ${e!.available?e!.state+(e!.unit?' '+e!.unit:''):'OFFLINE'}`).join('\n')}`:'Waiting for Home Assistant.');break;
    }
    case 'weather':this.print(s?`WEATHER ${s.weather.status}\n${store.config?.location||'Location not configured'}  ${fmt(s.weather.temperature,1)}°C`:'Waiting for weather data.');break;
    case 'uptime':{const seconds=s?.uptimeSeconds??0;this.print(`UPTIME ${formatUptime(seconds)}`);break;}
    case 'settings':location.assign('/settings');break;
    case 'focus':if(args.length!==1||!['start','pause','reset'].includes(args[0]))this.print('Usage: focus start|pause|reset','error');else{this.dispatchEvent(new CustomEvent('focus-command',{detail:args[0],bubbles:true,composed:true}));this.print('Focus timer: '+args[0]+'.');}break;
    case 'expand':this.resize(true);break;
    case 'collapse':this.resize(false);break;
    default:{
     if(!store.config?.commands?.some(c=>c.name===name)){this.print(`Unknown command: ${name}. Type help or configure a shortcut in Settings.`,'error');break;}
     this.busy=true;
     const response=await fetch('/api/v1/commands/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name}),signal:AbortSignal.timeout(25000)});
     const result=await response.json();if(!response.ok)throw Error(result.error??'Command failed.');
     this.print(result.output,result.success?'output':'error',false);
    }
   }
  }catch(error){this.print(error instanceof Error?error.message:'Command failed.','error');}
  finally{await this.pending;this.busy=false;this.focusInput();}
 }
 static styles=css`
 :host{display:flex;flex-direction:column;min-width:0;height:calc(100cqh - 2em);font-size:var(--type-base,18px);line-height:1.25;color:var(--text)}
 *{box-sizing:border-box;scrollbar-width:none}*::-webkit-scrollbar{display:none}button,input{font:inherit;color:inherit;background:transparent;border:0;min-width:0}
 button{cursor:pointer}button:hover{color:var(--warn)}button:focus-visible,input:focus-visible{outline:1px solid var(--warn);outline-offset:2px}
 .suggestions{display:flex;flex-wrap:wrap;gap:.25em .65em;flex-shrink:0;padding:.1em 0 .2em;font-size:var(--type-detail,12px)}.suggestions button{color:var(--muted);padding:.12em .3em;border:1px solid var(--line)}.suggestions button:hover{color:var(--accent);border-color:var(--accent)}
 .output{flex:1;min-height:0;overflow:auto;font-size:var(--type-body,16px);padding-right:.2em}
 .system-line{display:grid;grid-template-columns:10ch 4ch minmax(0,1fr);gap:1ch;align-items:baseline;margin-bottom:.25em}.system-line time{color:var(--muted)}.system-line .message{overflow-wrap:anywhere}
 .accent{color:var(--accent)}.warn,.error{color:var(--warn)}.input{color:var(--accent)}
 pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 .35em}.hint{color:var(--muted);font-size:var(--type-detail,12px);margin:.15em 0 .3em}
 form{display:flex;align-items:center;gap:.55ch;flex-shrink:0;padding:.25em 0 .15em;border-top:0;color:var(--accent);font-size:var(--type-body,16px)}
 .prefix{white-space:nowrap}input{flex:1;width:0;outline:none;padding:.1em 0;caret-color:var(--accent);font-variant-numeric:tabular-nums}input::placeholder{color:var(--muted);opacity:.8}
 .controls{display:flex;align-items:center;gap:1ch;flex-shrink:0;font-size:var(--type-detail,12px)}button{padding:.3em .2em}button:disabled{opacity:.5;cursor:wait}.running{color:var(--warn)}
 @media(max-width:700px){.prefix{font-size:var(--type-detail,12px)}.hint{display:none}.system-line{grid-template-columns:10ch 4ch minmax(0,1fr);gap:.5ch}.controls{gap:.3ch}}
 `;
 render(){const logs=(store.state?.logs??[]).filter(l=>new Date(l.time).getTime()>this.clearedAt).slice(0,40).reverse();return html`
  <div class="output" role="log" aria-label="System log and command output" @scroll=${()=>{const o=this.output;if(o)this.followOutput=o.scrollHeight-o.scrollTop-o.clientHeight<20;}}>
   ${logs.map(l=>html`<div class="system-line"><time>[${new Date(l.time).toLocaleTimeString('en-GB')}]</time><span class=${l.level==='WARN'?'warn':'accent'}>${l.level}</span><span class="message">${l.message}</span></div>`)}
   ${this.lines.map(l=>html`<pre class=${l.kind}>${l.text}</pre>`)}
  </div>
  ${this.inputFocused&&!this.busy&&this.draft.trim()&&!/\s/.test(this.draft.trim())?html`<div class="suggestions" role="group" aria-label="Command suggestions">${this.names.filter(name=>name.startsWith(this.draft.trim().toLowerCase())&&name!==this.draft.trim().toLowerCase()).slice(0,6).map(name=>html`<button type="button" aria-label=${'Complete '+name} @pointerdown=${(e:PointerEvent)=>e.preventDefault()} @click=${()=>this.complete(name)}>${name}</button>`)}</div>`:nothing}
  <form @submit=${this.submit}>
   <span class="prefix">user@workstation:~ $</span>
   <input aria-label="Application command" autocomplete="off" spellcheck="false" maxlength="256" placeholder=${this.busy?'Running…':'help'} .value=${this.draft} @input=${(e:Event)=>{this.draft=(e.target as HTMLInputElement).value;this.historyIndex=this.history.length;this.savedDraft='';this.lastCompletion='';this.completions=[];}} @focus=${()=>this.inputFocused=true} @blur=${()=>this.inputFocused=false} @keydown=${this.keydown}>
   
  </form>`;}
}
customElements.define('app-console',AppConsole);
