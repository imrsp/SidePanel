import {formatUptime} from './uptime';
import {LitElement,html,css,nothing} from 'lit';
import '@fontsource/share-tech-mono/latin-400.css';import '@fontsource/vt323/latin-400.css';
import './app-console';import type {AppConsole} from './app-console';import './styles.css';import './primitives';import {store,fmt,type HomeEntity} from './model';import './settings';
class SidePanelApp extends LitElement {
 static properties={tick:{state:true},running:{state:true},remaining:{state:true},homeBusy:{state:true},homeError:{state:true},calendarOffset:{state:true},consoleExpanded:{state:true}};
 tick=Date.now();running=false;remaining=1500;homeBusy:Record<string,boolean>={};homeError='';calendarOffset=0;consoleExpanded=false;
 private timer?:number;private deadline=0;private listener=()=>{this.applyTheme();this.requestUpdate();};
 connectedCallback(){super.connectedCallback();store.addEventListener('change',this.listener);store.start().catch(()=>this.requestUpdate());try{const saved=JSON.parse(localStorage.getItem('focus')??'null');if(saved){this.deadline=saved.deadline;this.running=saved.running;this.remaining=saved.remaining;}}catch{}this.timer=window.setInterval(()=>{this.tick=Date.now();if(this.running){this.remaining=Math.max(0,Math.ceil((this.deadline-this.tick)/1000));if(!this.remaining){this.running=false;this.persist();}}},1000);}
 disconnectedCallback(){super.disconnectedCallback();clearInterval(this.timer);store.removeEventListener('change',this.listener);}
 applyTheme(){document.documentElement.dataset.theme=store.config?.theme??'terminal';const scale=Math.min(store.config?.fontScale??100,200);this.style.setProperty('--font-scale',String(scale/100));this.toggleAttribute('large-text',scale>100);this.toggleAttribute('extra-large',scale===200);}
 persist(){localStorage.setItem('focus',JSON.stringify({deadline:this.deadline,running:this.running,remaining:this.remaining}));}
 toggleTimer(){this.running=!this.running;if(this.running){if(!this.remaining)this.remaining=1500;this.deadline=Date.now()+this.remaining*1000;}this.persist();}
 metric(key:string,d=0){return fmt(store.state?.metrics[key]?.value,d);}
 meter(key:string){return html`<div class="meter"><i style=${`width:${Math.max(0,Math.min(100,store.state?.metrics[key]?.value??0))}%`}></i></div>`;}
 static styles=css`
 :host{display:block;font-size:calc(clamp(10px,.94vw,19px) * var(--font-scale,1));color:var(--text)}*{box-sizing:border-box}button,a{font:inherit;color:inherit}button{cursor:pointer;background:transparent;border:0;padding:0}button:hover,a:hover{color:var(--warn)}a{text-decoration:none}button:focus-visible,a:focus-visible{outline:2px solid var(--warn);outline-offset:3px}.shell{height:100dvh;min-height:600px;padding:.8vw;display:grid;grid-template-rows:auto minmax(0,1fr) minmax(112px,21%);gap:.8vw;background:radial-gradient(ellipse at 40% 40%,var(--glow),transparent 70%)}.shell.scan:after{content:'';position:fixed;inset:0;z-index:100;pointer-events:none;background:repeating-linear-gradient(to bottom,rgba(210,235,225,.09) 0 1px,transparent 1px 3px,rgba(0,0,0,.28) 3px 4px)}header.top{display:flex;justify-content:space-between;border-bottom:1px solid var(--line);color:var(--accent);padding:0 calc(.4em / var(--font-scale,1)) calc(.6em / var(--font-scale,1));gap:10px}.top-right{display:flex;gap:calc(1.4em / var(--font-scale,1));align-items:center}.live{color:var(--accent)}.offline{color:var(--warn)}.columns{display:grid;grid-template-columns:22% minmax(0,1fr) 24%;gap:.8vw;min-height:0}.left,.right{display:grid;gap:.8vw;min-height:0}.left{grid-template-rows:39% minmax(0,1fr)}.right{grid-template-rows:32% minmax(0,1fr) 23%}.clock{font-size:calc(clamp(42px,7.1vw,140px) * var(--font-scale,1));line-height:.82;font-family:VT323,monospace;font-weight:400;color:var(--accent);letter-spacing:0;text-shadow:0 0 9px var(--glow);font-variant-numeric:tabular-nums}.date{color:var(--accent);font-size:1.6em;margin:calc(.3em / var(--font-scale,1)) 0 calc(.45em / var(--font-scale,1))}.weather{display:flex;gap:calc(.7em / var(--font-scale,1));align-items:center;border-top:1px solid var(--line);padding-top:calc(.4em / var(--font-scale,1))}.weather strong{font-size:2.1em;color:var(--accent);font-weight:500}.weather small{color:var(--muted);font-size:.7em}.climate{display:grid;grid-template-columns:1fr 1fr;margin-bottom:calc(.8em / var(--font-scale,1))}.climate>div{padding:calc(.15em / var(--font-scale,1)) calc(.6em / var(--font-scale,1))}.climate>div+div{border-left:1px solid var(--line)}.climate small{font-size:.8em;color:var(--accent)}.climate strong{display:block;font-size:1.7em;color:var(--accent);margin-top:calc(.2em / var(--font-scale,1))}.devices{display:flex;flex-direction:column;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:calc(.7em / var(--font-scale,1)) 0}.home-content{height:calc(100cqh - 2.7em);overflow:auto;scrollbar-width:thin}.devices{overflow:visible}.home-message{font-size:.85em;overflow-wrap:anywhere}button:disabled{opacity:.5;cursor:wait}.device>span:first-child{white-space:normal;overflow-wrap:anywhere;flex:1}.device>span:last-child{white-space:nowrap}.device,.row{display:flex;align-items:center;justify-content:space-between;gap:calc(.4em / var(--font-scale,1));min-height:calc(1.9em / var(--font-scale,1))}.device span:first-child{white-space:normal;overflow-wrap:anywhere}.device .icon{color:var(--accent);display:inline-block;width:calc(1.5em / var(--font-scale,1))}.toggle{display:inline-block;width:calc(2.1em / var(--font-scale,1));height:calc(1em / var(--font-scale,1));border:1px solid var(--line);border-radius:12px;position:relative;vertical-align:middle;margin-left:calc(.6em / var(--font-scale,1))}.toggle:after{content:'';position:absolute;left:1px;top:0;width:calc(.83em / var(--font-scale,1));height:calc(.83em / var(--font-scale,1));border-radius:50%;background:var(--muted)}.toggle.on:after{left:auto;right:0;background:var(--accent)}.home-label{color:var(--accent);margin:calc(.7em / var(--font-scale,1)) 0 calc(.2em / var(--font-scale,1))}.muted{color:var(--muted)}.accent{color:var(--accent)}.warn{color:var(--warn)}.telemetry{height:100%;display:grid;grid-template-rows:auto minmax(0,1fr) minmax(0,1fr) 22%;gap:0;border:1px solid var(--line);padding:1vw;background:var(--surface);min-width:0}.section-title{display:flex;justify-content:space-between;color:var(--accent);border-bottom:1px solid var(--line);padding-bottom:calc(.6em / var(--font-scale,1))}.section-title small{font-size:.8em}.system{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));padding:calc(.8em / var(--font-scale,1)) 0;gap:calc(.8em / var(--font-scale,1))}.system>div{display:grid;grid-template-rows:auto 12px minmax(0,1fr);gap:calc(.6em / var(--font-scale,1));min-width:0}.system>div+div{border-left:1px solid var(--line);padding-left:calc(.8em / var(--font-scale,1))}.metric-label{display:flex;justify-content:space-between;gap:4px;color:var(--accent);font-size:1.1em;white-space:nowrap}.metric-label small{font-size:.75em}.meter{height:100%;min-height:9px;border:1px solid var(--line);padding:1px;background:repeating-linear-gradient(90deg,var(--grid) 0 4px,transparent 4px 6px)}.meter i{display:block;height:100%;background:repeating-linear-gradient(90deg,var(--accent) 0 4px,transparent 4px 6px)}.network{display:grid;grid-template-rows:auto minmax(0,1fr);border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:calc(.7em / var(--font-scale,1)) 0}.network .section-title{border-bottom:1px solid var(--line);padding-bottom:calc(.6em / var(--font-scale,1))}.network-charts{display:grid;grid-template-columns:1fr 1fr;gap:calc(1em / var(--font-scale,1));padding:calc(.8em / var(--font-scale,1)) 0 0}.network-charts>div{display:grid;grid-template-rows:auto minmax(0,1fr);gap:calc(.5em / var(--font-scale,1));min-width:0}.network-charts>div+div{border-left:1px solid var(--line);padding-left:calc(1em / var(--font-scale,1))}.bottom-metrics{display:grid;grid-template-columns:1fr 1fr 1fr;gap:calc(.8em / var(--font-scale,1));padding-top:calc(.8em / var(--font-scale,1));min-height:0}.bottom-metrics>div{min-width:0}.bottom-metrics>div+div{border-left:1px solid var(--line);padding-left:calc(.8em / var(--font-scale,1))}.bottom-metrics h3{font-size:1em;font-weight:400;color:var(--accent);border-bottom:1px solid var(--line);margin:0 0 calc(.6em / var(--font-scale,1));padding-bottom:calc(.5em / var(--font-scale,1))}.bottom-metrics .row{font-size:.85em;min-height:calc(1.9em / var(--font-scale,1))}.disk-value{font-size:.9em;color:var(--accent);margin:calc(.9em / var(--font-scale,1)) 0}.disk-meter{height:13px}.tempbar{height:calc(.6em / var(--font-scale,1));width:48%;background:repeating-linear-gradient(90deg,var(--grid) 0 4px,transparent 4px 6px)}.tempbar i{display:block;height:100%;background:var(--accent)}.service{display:grid;grid-template-columns:1fr 1fr auto;gap:calc(.5em / var(--font-scale,1));align-items:center;margin:calc(.65em / var(--font-scale,1)) 0;font-size:.82em;white-space:nowrap}.service .url{overflow:hidden;text-overflow:ellipsis;color:var(--muted)}.calendar-nav{display:flex;justify-content:space-around;color:var(--accent);margin-bottom:calc(.5em / var(--font-scale,1))}.calendar{display:grid;grid-template-columns:repeat(7,1fr);text-align:center;gap:calc(.25em / var(--font-scale,1)) calc(.12em / var(--font-scale,1))}.calendar span{padding:calc(.22em / var(--font-scale,1)) 0;font-size:.9em}.calendar .weekday{color:var(--muted);font-size:.8em}.calendar .today{outline:1px solid var(--warn);color:var(--warn)}.focus{display:flex;align-items:center;justify-content:space-between;gap:calc(.7em / var(--font-scale,1))}.focus strong{font-family:VT323,monospace;font-weight:400;font-size:3.8em;color:var(--accent);font-variant-numeric:tabular-nums;line-height:1.1}.focus button{border:1px solid var(--warn);color:var(--warn);padding:calc(.6em / var(--font-scale,1)) calc(.7em / var(--font-scale,1));font-size:.85em}.focus-foot{display:flex;justify-content:space-between;margin-top:calc(.7em / var(--font-scale,1));color:var(--muted);font-size:.8em}.log-lines{display:flex;flex-direction:column-reverse;gap:calc(.4em / var(--font-scale,1))}.log-line{display:grid;grid-template-columns:7em 4em minmax(0,1fr);gap:calc(1em / var(--font-scale,1));font-size:.9em;white-space:nowrap}.log-line span:last-child{overflow:hidden;text-overflow:ellipsis}.prompt{margin-top:calc(.8em / var(--font-scale,1));color:var(--accent)}.cursor{display:inline-block;width:calc(.7em / var(--font-scale,1));height:calc(1em / var(--font-scale,1));background:var(--accent);vertical-align:middle;animation:blink 1.2s steps(1) infinite}@keyframes blink{50%{opacity:0}}@media(prefers-reduced-motion:reduce){.cursor{animation:none}}@media(max-aspect-ratio:7/6){.shell{height:auto;min-height:100vh;grid-template-rows:auto auto 160px;padding:12px;gap:12px}.columns{grid-template-columns:1fr;gap:12px}.left{grid-template-columns:1fr 1fr;grid-template-rows:300px}.telemetry{height:500px;padding:12px}.right{grid-template-columns:1fr 1fr 1fr;grid-template-rows:230px}:host{font-size:calc(12px * var(--font-scale,1))}}
 
 .columns>*,.left>*,.right>*{min-width:0;min-height:0}.columns{grid-template-rows:minmax(0,1fr)}.system,.network,.network-charts{min-height:0}
 .clock{font-size:min(calc(clamp(42px,7.1vw,140px) * var(--font-scale,1)),45cqw)}
 .metric-label{flex-wrap:wrap;align-content:start}
 .section-title small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .service{grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto}.service>span{overflow:hidden;text-overflow:ellipsis}
 .clock{font-size:min(calc(clamp(42px,7.1vw,140px) * var(--font-scale,1)),45cqw,max(36px,calc(100cqh - 8em)))}
 :host([large-text]) .device{font-size:min(1em,6cqw);line-height:1.1;white-space:nowrap}.device>span{white-space:nowrap}
 :host([large-text]) .climate strong{line-height:1.05}
 :host([large-text]) .focus strong{font-size:min(3.8em,42cqw,max(32px,calc(100cqh - 4em)))}
 @media(max-height:1100px){:host([large-text]) .climate{margin-bottom:.25em}:host([large-text]) .climate strong{font-size:1.4em}:host([large-text]) .devices{padding:.25em 0}:host([large-text]) .device,:host([large-text]) .row{min-height:calc(1.5em / var(--font-scale,1));line-height:1.05}:host([large-text]) .home-label{margin-top:.3em}}
 :host([large-text]) .calendar{line-height:1.1}:host([large-text]) .calendar span{padding:calc(.1em / var(--font-scale,1)) 0}
 @media(max-height:850px){:host([large-text]) .calendar{gap:0;line-height:1}:host([large-text]) .calendar span{padding:0}:host([large-text]) .calendar-nav{margin-bottom:.2em}}

 :host([extra-large]) .date{font-size:1.3em}
 :host([extra-large]) .clock{font-size:min(45cqw,max(36px,calc(100cqh - 5.8em)))}
 :host([extra-large]) .weather strong{font-size:1.6em}
 :host([extra-large]) .weather>.accent{font-size:1.8em!important}
 :host([extra-large]) .device{font-size:min(1em,6.4cqw)}
 :host([extra-large]) .climate strong{font-size:1.5em}
 :host([extra-large]) .tempbar{flex:1;min-width:12%;width:auto}
 :host([extra-large]) .focus strong{font-size:min(3.8em,42cqw,max(32px,calc(100cqh - 3.5em)))}

 .bottom-metrics>div:first-child{display:flex;flex-direction:column}.disk-list{display:grid;align-content:start;flex:1;min-height:0;gap:.25em;overflow-y:auto;scrollbar-width:thin}
 .disk-summary{display:flex;justify-content:space-between;gap:.4em;font-size:.8em;color:var(--accent);margin-bottom:.25em;white-space:nowrap}
 .disk-name{min-width:0;overflow:hidden;text-overflow:ellipsis}.disk-summary>span:last-child{flex-shrink:0}
 .disk-list .disk-meter{height:8px}
 :host([extra-large]) .left .row{font-size:min(1em,7cqw);white-space:nowrap}
 :host([extra-large]) .system .metric-label{font-size:1em;flex-wrap:nowrap;align-items:baseline}
 :host([extra-large]) .system .metric-label small{font-size:.6em}
 :host([extra-large]) .bottom-metrics .row{font-size:.7em;white-space:nowrap;gap:.45em}
 :host([extra-large]) .service{font-size:.7em}
 :host([extra-large]) .device .icon{width:1.1em}
 @media(min-height:1200px){:host([extra-large]) .devices{gap:.18em}:host([extra-large]) .left .row{min-height:1.5em}}
 .brand{display:flex;min-width:0;white-space:nowrap}.workstation-name{min-width:0;overflow:hidden;text-overflow:ellipsis}.brand>span:last-child,.top-right{flex-shrink:0}
 header.top{line-height:1.15;min-height:27px;padding-top:.12em;padding-bottom:.2em;align-items:center}

 .home-connection{font-size:.7em;margin-bottom:.6em}.climate strong{overflow-wrap:anywhere}
 @media(max-width:700px){:host{font-size:12px}.left{grid-template-columns:minmax(0,1fr);grid-template-rows:300px 320px}.right{grid-template-columns:minmax(0,1fr);grid-template-rows:repeat(3,230px)}.top-right{font-size:.8em;gap:8px}.brand{font-size:.9em}.shell{grid-template-rows:auto auto 160px}.columns{min-width:0}.home-content{height:calc(100cqh - 2.7em)}}

 .home-content{display:flex;flex-direction:column;gap:.35em;overflow:hidden;height:calc(100cqh - 2.65em)}
 .ha-climate{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0;padding:.15em 0 .45em;border-bottom:1px solid var(--line);flex-shrink:0}
 .ha-climate>div{min-width:0;padding:0 .3em}.ha-climate>div+div{border-left:1px solid var(--line);padding-left:.55em}
 .ha-label{display:block;font-size:.7em;color:var(--muted);letter-spacing:.04em;line-height:1.4}
 .ha-number{display:flex;align-items:baseline;gap:.12em;margin-top:.18em;color:var(--accent);font-size:clamp(24px,13cqw,1.7em);font-weight:400;line-height:1.15;font-variant-numeric:tabular-nums;white-space:nowrap}
 .ha-number small{font-size:.43em;color:var(--muted);font-weight:400}
 .ha-list{display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto;scrollbar-width:thin;scrollbar-color:var(--line) transparent}
 .ha-row{flex:1 0 auto;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:.5em;min-height:clamp(28px,5.5cqh,48px);padding:.2em 0;border-bottom:1px solid var(--grid);font-size:clamp(12px,6cqw,1em);line-height:1.3}
 .ha-row:last-child{border-bottom:0}.ha-name{overflow-wrap:anywhere}.ha-reading{display:flex;align-items:baseline;gap:.35em;white-space:nowrap;font-variant-numeric:tabular-nums}.ha-reading small{font-size:.72em;color:var(--muted)}
 .ha-toggle{display:flex;align-items:center;justify-content:flex-end;gap:.5em;min-height:1.6em;padding:.15em 0 .15em .4em;color:var(--accent)}.ha-toggle>span{min-width:2.4ch;text-align:right}.ha-toggle:disabled{cursor:default;color:var(--muted);opacity:.65}
 .ha-track{display:block;position:relative;width:2em;height:1em;border:1px solid var(--line);border-radius:1em}.ha-track:after{content:'';position:absolute;top:50%;left:.12em;transform:translateY(-50%);width:.65em;height:.65em;border-radius:50%;background:var(--muted)}.ha-track.on:after{left:auto;right:.12em;background:var(--accent)}.ha-track.on{border-color:var(--accent)}
 .ha-footer{display:flex;justify-content:space-between;gap:.5em;flex-shrink:0;border-top:1px solid var(--line);padding-top:.65em;color:var(--muted);font-size:clamp(10px,4cqw,.65em);line-height:1.4;white-space:nowrap}.home-message{margin:.25em 0;font-size:.65em;line-height:1.5;flex-shrink:0}
 :host .time-panel .clock{font-size:clamp(42px,min(42cqw,30cqh),160px)}
 .time-panel .date{font-size:1.15em;margin:calc(.2em / var(--font-scale,1)) 0 calc(.3em / var(--font-scale,1))}.time-panel .weather{font-size:.85em}
 .calendar{height:calc(100cqh - 3.7em);grid-auto-rows:minmax(0,1fr);align-items:center;gap:0;font-size:min(1em,8.5cqh)}.calendar span{padding:.1em 0}.calendar-nav{font-size:min(1em,10cqh);margin-bottom:.25em}
 .telemetry{grid-template-rows:auto minmax(0,1fr) minmax(0,1fr) minmax(5.6em,24%)}
 @media(max-height:1100px){:host([large-text]) .focus-foot{font-size:.65em;margin-top:.2em}:host([large-text]) .focus button{padding:.3em .5em;font-size:.75em}}
 @media(max-width:700px){.ha-row{font-size:16px}.ha-label{font-size:12px}.ha-number{font-size:clamp(28px,11cqw,40px)}.ha-footer{font-size:11px}.home-message{font-size:12px}.home-content{gap:10px}.ha-climate{padding-bottom:12px}.time-panel .date{font-size:1.5em}.time-panel .weather{font-size:1.25em}.calendar{font-size:16px}.calendar-nav{font-size:16px}.telemetry{grid-template-rows:auto minmax(0,1fr) minmax(0,1fr) minmax(90px,24%)}}
 /* Dense rows retain readable type at 200% scaling. */
 .left{grid-template-rows:31% minmax(0,1fr)}
 .home-content{gap:.45em;height:calc(100cqh - 1.8em)}
 .ha-list{flex:1;justify-content:flex-start}
 .ha-row{flex:0 0 auto;min-height:2.15em;padding:.35em 0;font-size:min(1em,7.5cqw)}
 .ha-label{font-size:.85em}.ha-number small{font-size:.5em}.ha-reading small{font-size:.8em}
 .ha-footer{font-size:.8em;padding-top:.4em}.home-message{font-size:.8em}
 .disk-io{display:grid;gap:.15em;flex-shrink:0;font-size:.68em;line-height:1.15;color:var(--text);padding-top:.3em;white-space:nowrap}
 :host([extra-large]) .bottom-metrics .row{font-size:.95em;min-height:1.5em;gap:.2em}
 :host([extra-large]) .tempbar{min-width:8%;flex:1}
 @media(max-aspect-ratio:7/6){.left{grid-template-rows:300px}}
 @media(max-width:700px){.left{grid-template-rows:300px 320px}.ha-row{font-size:16px}.ha-footer{font-size:12px}}

 .services-list{height:calc(100cqh - 2em);overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--line) transparent}
 .service,:host([extra-large]) .service{grid-template-columns:minmax(0,1fr) auto;gap:.22em .55em;font-size:.9em;line-height:1.3;align-items:start;margin:0;padding:.4em 0 .6em;white-space:normal;border-bottom:1px solid var(--grid)}
 .service:last-child{border-bottom:0}
 .service>span{overflow:visible;text-overflow:clip}
 .service-name{overflow-wrap:anywhere;color:var(--text)}
 .service-status{font-size:.85em;white-space:nowrap;padding-top:.1em}
 .service .url{grid-column:1 / -1;font-size:.7em;line-height:1.4;overflow:visible;overflow-wrap:anywhere;text-overflow:clip;color:var(--muted)}

 /* Shared dashboard type scale. Absolute tokens avoid nested em multiplication. */
 :host{--type-base:calc(clamp(10px,.94vw,19px) * var(--font-scale,1));--type-title:var(--type-base);--type-body:calc(var(--type-base) * .9);--type-status:calc(var(--type-base) * .78);--type-detail:calc(var(--type-base) * .63);--type-reading:calc(var(--type-base) * 1.4);font-size:var(--type-base);line-height:1.2}
 :host .brand,:host .top-right,:host .section-title,:host .bottom-metrics h3{font-size:var(--type-title)}
 :host .section-title small{font-size:var(--type-status)}
 :host .system .metric-label,:host([extra-large]) .system .metric-label,:host .network .metric-label{font-size:var(--type-title);line-height:1.15}
 :host .system .metric-label small,:host([extra-large]) .system .metric-label small,:host .network .metric-label small{font-size:var(--type-detail)}
 :host .time-panel .date{font-size:var(--type-reading);line-height:1.15}
 :host .time-panel .weather strong{font-size:var(--type-reading)}
 :host .time-panel .weather small{font-size:var(--type-detail);line-height:1.25}
 :host .time-panel .weather>.accent{font-size:var(--type-reading)!important}
 :host .time-panel .clock{font-size:min(calc(var(--type-base) * 2.4),42cqw,32cqh);line-height:.9}
 :host .ha-label{font-size:var(--type-status);line-height:1.3}
 :host .ha-number{font-size:min(var(--type-reading),13cqw);line-height:1.15}
 :host .ha-number small,:host .ha-reading small{font-size:var(--type-detail)}
 :host .ha-row{font-size:var(--type-body);line-height:1.25;min-height:2em;gap:.35em}
 :host .ha-toggle{font-size:var(--type-status);gap:.4em}
 :host .ha-reading{gap:.2em}
 :host .ha-footer,:host .home-message{font-size:var(--type-status);line-height:1.3}
 :host .disk-summary{font-size:var(--type-body);line-height:1.2}
 :host .disk-io{font-size:var(--type-detail);line-height:1.2}
 :host .bottom-metrics .row,:host([extra-large]) .bottom-metrics .row{font-size:var(--type-body);line-height:1.25;min-height:1.5em}
 :host .service,:host([extra-large]) .service{font-size:var(--type-body);line-height:1.25}
 :host .service-status{font-size:var(--type-status)}
 :host .service .url{font-size:var(--type-detail);line-height:1.35}
 :host .calendar-nav{font-size:var(--type-title);line-height:1.2}
 :host .calendar span{font-size:var(--type-body);line-height:1.15}
 :host .calendar .weekday{font-size:var(--type-status)}
 :host .focus button{font-size:var(--type-body);line-height:1.2}
 :host .focus-foot,:host([large-text]) .focus-foot{font-size:var(--type-status);line-height:1.3}
 :host .focus strong,:host([large-text]) .focus strong{font-size:min(calc(var(--type-base) * 2.4),42cqw,max(32px,calc(100cqh - 3.5em)));line-height:1.1}
 :host .log-line{font-size:var(--type-body);line-height:1.25}
 :host .prompt{font-size:var(--type-title);line-height:1.2}
 @media(max-aspect-ratio:7/6){:host{--type-base:calc(12px * var(--font-scale,1))}}
 @media(max-width:700px){:host{--type-base:18px}.home-content{height:calc(100cqh - 2.2em)}.services-list{height:calc(100cqh - 2.2em)}}

 :host .ha-reading .ha-state{font-size:var(--type-status)}
 :host .telemetry{grid-template-rows:auto minmax(0,1fr) minmax(0,1fr) minmax(6.1em,25%)}
 :host .disk-summary{margin-bottom:.15em;line-height:1.1}
 @media(max-width:700px){:host .telemetry{grid-template-rows:auto minmax(0,1fr) minmax(0,1fr) minmax(110px,25%)}}

 @media(max-width:700px){
  :host header.top{flex-wrap:wrap;gap:8px;padding:.25em 0}
  :host .telemetry{height:760px;grid-template-rows:auto minmax(0,1fr) minmax(0,1fr) 260px}
  :host .system .metric-label,:host([extra-large]) .system .metric-label{flex-wrap:wrap;white-space:normal;gap:.2em}
  :host .bottom-metrics{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:145px minmax(0,1fr)}
  :host .bottom-metrics>div:first-child{grid-column:1 / -1}
  :host .bottom-metrics>div:nth-child(2){border-left:0;padding-left:0}
 }

 /* Scrollable content stays accessible without native scrollbar chrome. */
 :host *, :host{scrollbar-width:none!important}
 :host *::-webkit-scrollbar,:host::-webkit-scrollbar{display:none;width:0;height:0}
 :host .disk-list{grid-template-columns:minmax(0,1fr);overflow-x:hidden}
 :host .disk-item{min-width:0}
 :host .disk-summary{gap:.2em}

 :host .brand-suffix{display:flex;align-items:center}
 :host .brand-separator{padding-inline:1ch}
 :host console-panel[note="Deep Work"]::part(note){font-size:var(--type-status)}

 :host .log-panel.expanded{position:fixed;inset:.8vw;z-index:60;box-shadow:0 0 0 100vmax #0009}

 :host .console-toggle{display:flex;align-items:center;justify-content:center;color:var(--muted);width:1em;height:1em;padding:.08em}
 :host .console-toggle:hover{color:var(--accent)}
 :host .console-toggle svg{display:block;width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:square;stroke-linejoin:miter}

 `;
 calendar(){const now=new Date(this.tick);const month=new Date(now.getFullYear(),now.getMonth()+this.calendarOffset,1);const offset=(month.getDay()+6)%7;const count=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();return html`<div class="calendar-nav"><button aria-label="Previous month" @click=${()=>this.calendarOffset--}>‹</button><span>${month.toLocaleDateString('en',{month:'short',year:'numeric'}).toUpperCase()}</span><button aria-label="Next month" @click=${()=>this.calendarOffset++}>›</button></div><div class="calendar">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>html`<span class="weekday">${d}</span>`)}${Array.from({length:offset},()=>html`<span></span>`)}${Array.from({length:count},(_,i)=>html`<span class=${this.calendarOffset===0&&i+1===now.getDate()?'today':''}>${i+1}</span>`)}</div>`;}
 homeName(e:HomeEntity){return e.name==='今日电量'?'Energy today':/[\u3400-\u9fff]/.test(e.name)?e.entityId.split('.').slice(1).join('.').replaceAll('_',' '):e.name;}
 homeValue(e:HomeEntity|null|undefined){return e?.available?e.state+(e.unit?' '+e.unit:''):'—';}
 async setHome(e:HomeEntity){
  if(this.homeBusy[e.entityId])return;
  this.homeBusy={...this.homeBusy,[e.entityId]:true};this.homeError='';
  try{const response=await fetch('/api/v1/home/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entityId:e.entityId,on:e.state!=='on'})});const result=await response.json();if(!response.ok)throw Error(result.error??'Action failed');if(store.state)store.state={...store.state,homeAssistant:result};}
  catch(error){this.homeError=error instanceof Error?error.message:'Action failed. Please try again.';}
  finally{this.homeBusy={...this.homeBusy,[e.entityId]:false};}
 }
 fixedHome(e:HomeEntity|null|undefined,humidity=false){const raw=e?.available?Number(e.state):NaN;return Number.isFinite(raw)?(humidity?String(Math.round(raw)):raw.toFixed(1)):e?.available?e.state:'—';}
 homePanel(){
  const h=store.state?.homeAssistant;const ready=h?.status==='ONLINE'||h?.status==='PARTIAL';
  const all=[h?.temperature,h?.humidity,...(h?.entities??[])].filter((e):e is HomeEntity=>!!e);const online=all.filter(e=>e.available).length;
  return html`<console-panel class="home-panel" page-target=".ha-list" label="HOME ASSISTANT" title=${h?.message??'Connecting'}><div class="home-content">
   <div class="ha-climate">${[[h?.temperature,'INDOOR',false],[h?.humidity,'HUMIDITY',true]].map(([item,label,humidity])=>{const e=item as HomeEntity|null|undefined;return html`<div><span class="ha-label">${label}</span><strong class="ha-number"><span>${this.fixedHome(e,!!humidity)}</span>${e?.available&&e.unit?html`<small>${e.unit}</small>`:nothing}</strong></div>`;})}</div>
   <div class="ha-list">${(h?.entities??[]).map(e=>html`<div class="ha-row"><span class="ha-name" title=${e.entityId}>${this.homeName(e)}</span>${e.isSwitch?html`<button class="ha-toggle" aria-label=${'Toggle '+this.homeName(e)} aria-pressed=${e.state==='on'} ?disabled=${!ready||!e.available||!['on','off'].includes(e.state)||this.homeBusy[e.entityId]} @click=${()=>this.setHome(e)}><span>${this.homeBusy[e.entityId]?'…':!e.available?'OFFLINE':e.state.toUpperCase()}</span><i class=${'ha-track '+(e.state==='on'?'on':'')}></i></button>`:html`<span class=${'ha-reading '+(e.available?'accent':'muted')} aria-label=${e.available?this.homeValue(e):this.homeName(e)+' OFFLINE'} title=${e.available?'':e.state}>${e.available?html`<span>${e.state}</span>`:nothing}${e.available&&e.unit?html`<small>${e.unit}</small>`:!e.available?html`<small class="ha-state">${e.state==='missing'?'NOT FOUND':'OFFLINE'}</small>`:nothing}</span>`}</div>`)}</div>
   ${!ready?html`<p class="home-message muted">${h?.message??'Connecting to Home Assistant'} <a href="/settings">Settings →</a></p>`:html`<div class="ha-footer"><span>● ${online}/${all.length} ONLINE</span></div>`}
   ${this.homeError?html`<p class="home-message warn" role="alert">${this.homeError}</p>`:nothing}
  </div></console-panel>`;
 }
 render(){if(location.pathname==='/settings')return html`<console-settings></console-settings>`;const s=store.state;const now=new Date(this.tick);const stale=!store.connected||!s||Date.now()-new Date(s.time).getTime()>15000;return html`<main class="shell ${store.config?.scanlines?'scan':''}"><header class="top"><span class="brand"><span class="workstation-name" title=${store.config?.workstationName??'WORKSTATION'}>${store.config?.workstationName??'WORKSTATION'}</span><span class="brand-suffix"><span class="brand-separator">/</span>SIDEPANEL</span></span><span class="top-right"><a href="/settings" aria-label="Open settings">⚙</a><span class=${stale?'offline':'live'}>● ${stale?'CONNECTING':'SYSTEM ONLINE'}</span></span></header><div class="columns"><div class="left"><console-panel class="time-panel" label="TIME & DATE"><div class="clock">${now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</div><div class="date">${now.toLocaleDateString('en-US',{weekday:'short'}).toUpperCase()} / ${now.toLocaleDateString('en-US',{month:'short',day:'2-digit'}).toUpperCase()}</div><div class="weather"><span class="accent" style="font-size:2.6em">☾</span><strong>${fmt(s?.weather.temperature)}°</strong><small>${s?.weather.temperature==null?'WEATHER / SETUP':s.weather.status==='ONLINE'?'OUTDOOR':s.weather.status}<br>${store.config?.location??''}</small></div></console-panel>${this.homePanel()}</div><section class="telemetry"><div class="section-title"><span>SYSTEM TELEMETRY</span><small>UPTIME ${formatUptime(s?.uptimeSeconds??0)}</small></div><div class="system">${['cpu','gpu','memory'].map(key=>html`<div><div class="metric-label"><span>${key.toUpperCase()}</span>${key==='memory'?html`<small>${this.metric('memoryUsed',1)} / ${this.metric('memoryTotal',0)} GB</small>`:html`<span>${this.metric(key)}%</span>`}</div>${this.meter(key)}<mini-chart .values=${[...(store.history[key]??[])]}></mini-chart></div>`)}</div><section class="network"><div class="section-title">NETWORK <small>${s?.metrics.download?.source??''}</small></div><div class="network-charts">${[['download','↓'],['upload','↑']].map(([key,arrow])=>html`<div><div class="metric-label"><span>${arrow} ${key.toUpperCase()}</span><span>${this.metric(key,1)} <small>Mbps</small></span></div><mini-chart .values=${[...(store.history[key]??[])]} .ceiling=${10}></mini-chart></div>`)}</div></section><div class="bottom-metrics"><div><h3>DISK</h3><div class="disk-list">${(s?.disks??[]).map(d=>html`<div class="disk-item"><div class="disk-summary"><span class="disk-name" title=${d.name}>${d.name}</span><span>${fmt(d.usedGb/1024,2)} / ${fmt(d.totalGb/1024,2)} TB</span></div><div class="meter disk-meter"><i style=${`width:${d.totalGb>0?Math.max(0,Math.min(100,d.usedGb/d.totalGb*100)):0}%`}></i></div></div>`)}${!s?.disks.length?html`<div class="disk-value">— / — TB</div>`:nothing}</div><div class="disk-io"><span>R ${this.metric('diskRead',2)} MB/s</span><span>W ${this.metric('diskWrite',2)} MB/s</span></div></div><div><h3>TEMPERATURES</h3>${[['CPU','cpuTemp'],['GPU','gpuTemp'],['SSD','ssdTemp']].map(([label,key])=>html`<div class="row"><span>${label}</span><span>${this.metric(key)}°C</span><span class="tempbar"><i style=${`width:${Math.min(100,s?.metrics[key]?.value??0)}%`}></i></span></div>`)}</div><div><h3>POWER</h3><div class="row"><span>CPU</span><span>${this.metric('cpuPower')} W</span></div><div class="row"><span>GPU</span><span>${this.metric('gpuPower')} W</span></div>${s?.metrics.totalPower?html`<div class="row accent"><span>TOTAL PC</span><span>${this.metric('totalPower')} W</span></div>`:nothing}</div></div></section><div class="right"><console-panel label="SERVICES" page-target=".services-list"><div class="services-list">${(s?.services??[]).map(p=>html`<div class="service"><span class="service-name">${p.name}</span><span class=${'service-status '+(p.online?'accent':'warn')}>● ${p.online?'ONLINE':'OFFLINE'}</span><span class="url" title=${p.url}>${p.url}</span></div>`)}${!s?.services.length?html`<a class="muted" href="/settings">Configure services →</a>`:nothing}</div></console-panel><console-panel label="CALENDAR">${this.calendar()}</console-panel><console-panel label="FOCUS SESSION" note="Deep Work"><div class="focus"><strong>${String(Math.floor(this.remaining/60)).padStart(2,'0')}:${String(this.remaining%60).padStart(2,'0')}</strong><button @click=${()=>this.toggleTimer()}>${this.running?'Ⅱ PAUSE':'▶ START'}</button></div><div class="focus-foot"><span>Pomodoro 25/5</span><button @click=${()=>{this.running=false;this.remaining=1500;this.persist();}}>RESET</button></div></console-panel></div></div><console-panel class="log-panel" label="SYSTEM LOG"><button class="console-toggle" slot="header-actions" aria-label=${this.consoleExpanded?'Exit terminal fullscreen':'Enter terminal fullscreen'} title=${this.consoleExpanded?'Exit fullscreen (Esc)':'Fullscreen'} aria-pressed=${this.consoleExpanded} @click=${()=>this.renderRoot.querySelector<AppConsole>('app-console')?.toggleExpanded()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d=${this.consoleExpanded?'M3 9h6V3M15 3v6h6M21 15h-6v6M9 21v-6H3':'M9 3H3v6M15 3h6v6M21 15v6h-6M9 21H3v-6'}></path></svg></button><app-console @console-resize=${(e:CustomEvent<boolean>)=>this.consoleExpanded=e.detail} @focus-command=${(e:CustomEvent<string>)=>{if(e.detail==='reset'){this.running=false;this.remaining=1500;}else if(e.detail==='start'&&!this.running)this.toggleTimer();else if(e.detail==='pause'&&this.running)this.toggleTimer();this.persist();}}></app-console></console-panel></main>`;}
}
customElements.define('sidepanel-app',SidePanelApp);





