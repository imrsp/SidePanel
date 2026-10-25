import {LitElement,html,css,svg} from 'lit';
export class ConsolePanel extends LitElement {
 static properties={label:{type:String},note:{type:String},pageTarget:{type:String,attribute:'page-target'},canUp:{state:true},canDown:{state:true}};
 label='';note='';pageTarget='';canUp=false;canDown=false;
 private target:HTMLElement|null=null;
 private resizeObserver?:ResizeObserver;
 private mutationObserver?:MutationObserver;
 private syncPages=()=>{const t=this.target;this.canUp=!!t&&t.scrollTop>1;this.canDown=!!t&&t.scrollHeight-t.clientHeight-t.scrollTop>1;};
 connectedCallback(){super.connectedCallback();this.resizeObserver=new ResizeObserver(this.syncPages);this.resizeObserver.observe(this);void document.fonts.ready.then(this.syncPages);}
 disconnectedCallback(){super.disconnectedCallback();this.target?.removeEventListener('scroll',this.syncPages);this.resizeObserver?.disconnect();this.mutationObserver?.disconnect();this.target=null;}
 protected updated(){this.bindPages();this.syncPages();}
 private bindPages(){
  const target=this.pageTarget?this.querySelector<HTMLElement>(this.pageTarget):null;
  if(target!==this.target){
   if(this.target){this.target.removeEventListener('scroll',this.syncPages);this.resizeObserver?.unobserve(this.target);}
   this.mutationObserver?.disconnect();this.target=target;
   if(target){target.addEventListener('scroll',this.syncPages,{passive:true});this.resizeObserver?.observe(target);this.mutationObserver=new MutationObserver(this.syncPages);this.mutationObserver.observe(target,{childList:true,subtree:true,characterData:true});}
  }
  this.syncPages();
 }
 private page(direction:number){this.target?.scrollBy({top:direction*this.target.clientHeight,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
 static styles=css`:host{display:block;min-height:0;min-width:0;border:1px solid var(--line);background:var(--surface);padding:clamp(8px,1vw,18px);box-sizing:border-box;overflow:hidden;container-type:size}header{display:flex;justify-content:space-between;align-items:center;gap:8px;color:var(--accent);font-size:var(--type-title,1em);line-height:1.2;border-bottom:1px solid var(--line);padding-bottom:calc(.65em / var(--font-scale,1));margin-bottom:calc(.75em / var(--font-scale,1));white-space:nowrap}.label{min-width:0;overflow:hidden;text-overflow:ellipsis}.actions{display:flex;align-items:center;gap:.35em;flex-shrink:0}small{font-size:var(--type-detail,.65em);color:var(--muted);align-self:center;min-width:0;overflow:hidden;text-overflow:ellipsis}.pager{display:flex;gap:.15em;font-size:var(--type-status,.78em)}button{font:inherit;line-height:1;color:var(--accent);border:0;background:transparent;cursor:pointer;padding:.1em;width:1.05em}button:hover:not(:disabled){color:var(--warn)}button:disabled{color:var(--muted);opacity:.35;cursor:default}button:focus-visible{outline:1px solid var(--warn);outline-offset:1px}slot{display:block}`;
 render(){return html`<header><span class="label">${this.label}</span><span class="actions"><small part="note">${this.note}</small><slot name="header-actions"></slot>${this.pageTarget?html`<span class="pager" role="group" aria-label=${this.label+' pagination'}><button aria-label=${this.label+' previous page'} title="Previous page" ?disabled=${!this.canUp} @click=${()=>this.page(-1)}>↑</button><button aria-label=${this.label+' next page'} title="Next page" ?disabled=${!this.canDown} @click=${()=>this.page(1)}>↓</button></span>`:''}</span></header><slot @slotchange=${()=>{this.bindPages();this.syncPages();}}></slot>`;}

}
customElements.define('console-panel',ConsolePanel);
export class MiniChart extends LitElement {
 static properties={values:{attribute:false},ceiling:{type:Number}};values:(number|null)[]=[];ceiling=100;
 static styles=css`:host{display:grid;grid-template-rows:minmax(0,1fr) auto;gap:4px;height:100%;min-height:0;font-size:var(--type-detail,.65em);color:var(--muted);line-height:1.2}.plot{position:relative;min-height:0}svg{position:absolute;left:3.5ch;top:0;width:calc(100% - 3.5ch);height:100%;overflow:hidden}.axis{position:absolute;left:0;transform:translateY(-50%);font:inherit;white-space:nowrap}.time{text-align:right;white-space:nowrap}.grid{stroke:var(--grid);stroke-width:1;stroke-dasharray:1 5}.line{fill:none;stroke:var(--accent);stroke-width:1.2;vector-effect:non-scaling-stroke}`;
 render(){const max=Math.max(this.ceiling,...this.values.filter((v):v is number=>v!=null));const points=this.values.map((v,i)=>v==null?null:[26+(Math.max(0,150-this.values.length)+i)*270/149,78-Math.min(1,v/max)*72]);let line='';let active=false;for(const p of points){if(!p){active=false;continue;}line+=`${active?'L':'M'}${p[0]},${p[1]} `;active=true;}return html`<div class="plot">${[6,42,78].map((y,i)=>html`<span class="axis" style=${`top:${y/84*100}%`}>${Math.round(max*(1-i/2))}</span>`)}<svg viewBox="26 0 274 84" preserveAspectRatio="none" role="img" aria-label="Recent telemetry history">${[6,42,78].map((y,i)=>svg`<path class="grid" d="M26 ${y}H298"/>`)}${[26,80,134,188,242,298].map(x=>svg`<path class="grid" d="M${x} 6V78"/>`)}<path class="line" d=${line}/></svg></div><div class="time">5 min</div>`;}
}
customElements.define('mini-chart',MiniChart);

