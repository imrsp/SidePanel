import {LitElement,html,css,nothing} from 'lit';
import type {CustomCommand} from './model';
import {builtinCommands} from './app-console';

export class CommandEditor extends LitElement {
 static properties={initialValue:{attribute:false},commands:{state:true}};
 initialValue?:CustomCommand[];commands:CustomCommand[]=[];private initialized=false;
 protected willUpdate(){if(!this.initialized&&this.initialValue){this.commands=this.initialValue.map(c=>({...c,arguments:c.arguments??'',workingDirectory:c.workingDirectory??''}));this.initialized=true;}}
 get value(){return this.commands.map(c=>({...c,name:c.name.trim().toLowerCase(),target:c.target.trim(),workingDirectory:c.workingDirectory.trim()}));}
 validate(){
  const values=this.value;const names=new Set<string>();
  for(const c of values){
   if(!/^[a-z][a-z0-9_-]{0,31}$/.test(c.name))throw Error('指令名称须以小写字母开头，限 1–32 个字母、数字、下划线或短横线。');
   if(builtinCommands.includes(c.name))throw Error('指令名称与内置指令冲突：'+c.name);
   if(names.has(c.name))throw Error('指令名称重复：'+c.name);names.add(c.name);
   if(!c.target.trim())throw Error('请填写指令目标：'+c.name);
   if(c.type==='url'){try{if(!['http:','https:'].includes(new URL(c.target).protocol))throw Error();}catch{throw Error('网址须以 http:// 或 https:// 开头：'+c.name);}}
   if(c.type==='app'&&!/\.exe$/i.test(c.target))throw Error('应用路径须指向 .exe 文件：'+c.name);
  }
  return values;
 }
 private change(i:number,key:keyof CustomCommand,value:string){this.commands=this.commands.map((c,j)=>j===i?{...c,[key]:value}:c);}
 private type(i:number,type:CustomCommand['type']){this.commands=this.commands.map((c,j)=>j===i?{...c,type,target:'',arguments:'',workingDirectory:''}:c);}
 static styles=css`
 :host{display:block;color:var(--text);font:inherit}*{box-sizing:border-box;min-width:0;scrollbar-width:none}*::-webkit-scrollbar{display:none}
 .card{border:1px solid var(--line);padding:16px;margin:14px 0;background:var(--surface)}
 .top{display:grid;grid-template-columns:minmax(0,1fr) minmax(140px,.65fr) auto;gap:12px;align-items:end}.top label{margin:0}
 label{display:block;margin:14px 0 0}input,select,textarea,button{font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--line);padding:9px}
 input,select,textarea{display:block;width:100%;margin-top:5px}textarea{height:86px;resize:vertical}button{color:var(--accent);cursor:pointer}button:hover{border-color:var(--warn);color:var(--warn)}button:disabled{opacity:.5;cursor:default}
 input:focus-visible,select:focus-visible,textarea:focus-visible,button:focus-visible{outline:2px solid var(--warn);outline-offset:2px}small{display:block;color:var(--muted);margin-top:8px;overflow-wrap:anywhere}.empty{border:1px dashed var(--line);padding:16px;color:var(--muted)}
 @media(max-width:550px){.top{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.top button{grid-column:1 / -1}.card{padding:12px}}
 `;
 render(){return html`
  <small>在主页输入指令名称即可运行。支持启动应用、执行 CMD、打开网址和文件夹。最多 24 项。修改后需点击页面的“保存配置”。</small>
  ${this.commands.length?nothing:html`<p class="empty">尚未添加自定义指令。可先使用 help、status、refresh、services、ha、focus 等内置指令。</p>`}
  ${this.commands.map((c,i)=>html`<section class="card" aria-label=${'自定义指令 '+(i+1)}>
   <div class="top"><label>指令名称<input aria-label=${'指令名称 '+(i+1)} placeholder="notepad" maxlength="32" .value=${c.name} @input=${(e:Event)=>this.change(i,'name',(e.target as HTMLInputElement).value)}></label>
    <label>操作类型<select aria-label=${'操作类型 '+(i+1)} .value=${c.type} @change=${(e:Event)=>this.type(i,(e.target as HTMLSelectElement).value as CustomCommand['type'])}><option value="app">启动应用</option><option value="cmd">执行 CMD</option><option value="url">打开网址</option><option value="folder">打开文件夹</option></select></label>
    <button type="button" aria-label=${'删除指令 '+(i+1)} @click=${()=>this.commands=this.commands.filter((_,j)=>j!==i)}>删除</button></div>
   <label>${c.type==='app'?'应用完整路径（.exe）':c.type==='cmd'?'CMD 命令':c.type==='url'?'网址':'文件夹完整路径'}
    ${c.type==='cmd'?html`<textarea aria-label=${'命令目标 '+(i+1)} maxlength="4096" placeholder="echo Hello from SidePanel" .value=${c.target} @input=${(e:Event)=>this.change(i,'target',(e.target as HTMLTextAreaElement).value)}></textarea>`:html`<input aria-label=${'命令目标 '+(i+1)} maxlength="4096" placeholder=${c.type==='app'?'C:\\Windows\\System32\\notepad.exe':c.type==='url'?'https://example.com':'%USERPROFILE%\\Documents'} .value=${c.target} @input=${(e:Event)=>this.change(i,'target',(e.target as HTMLInputElement).value)}>`}
   </label>
   ${c.type==='app'?html`<label>启动参数（可选）<input aria-label=${'启动参数 '+(i+1)} maxlength="2048" placeholder='"C:\\path with spaces\\file.txt"' .value=${c.arguments} @input=${(e:Event)=>this.change(i,'arguments',(e.target as HTMLInputElement).value)}></label>`:nothing}
   ${c.type==='app'||c.type==='cmd'?html`<label>工作目录（可选）<input aria-label=${'工作目录 '+(i+1)} maxlength="1024" placeholder="留空使用 SidePanel 程序目录" .value=${c.workingDirectory} @input=${(e:Event)=>this.change(i,'workingDirectory',(e.target as HTMLInputElement).value)}></label>`:nothing}
   <small>${c.type==='cmd'?'使用当前用户权限运行，输出显示在控制台；20 秒后停止，最多显示 16 KB。不支持交互输入，请勿在这里运行长期驻留任务。多条命令可用 && 连接。':c.type==='app'?'仅填完整路径，不要加外层引号；参数单独填写。应用使用当前用户权限启动。路径支持 %USERPROFILE% 等环境变量。':c.type==='folder'?'支持绝对路径和 %USERPROFILE% 等环境变量，不要加外层引号。':'在默认浏览器打开，仅支持 HTTP / HTTPS。'}</small>
  </section>`)}
  <button type="button" ?disabled=${this.commands.length>=24} @click=${()=>this.commands=[...this.commands,{name:'',type:'app',target:'',arguments:'',workingDirectory:''}]}>＋ 添加自定义指令</button>
  <small>内置名称不可覆盖：${builtinCommands.join('、')}。自定义指令不接收额外参数，CMD 只执行这里保存的内容。</small><slot></slot>`;}
}
customElements.define('command-editor',CommandEditor);
