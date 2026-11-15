import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../../overlays/harness/files/apps/web/public/physicsos/website/app.js', import.meta.url), 'utf8');
// Run the actual public controllers without network, feedback, or a second physics implementation.
const featureSource = source.slice(source.indexOf('// Feature tabs'), source.indexOf('let content ='));
const demoSource = source.slice(source.indexOf('// Small conceptual illustrations'), source.indexOf('// Drafts stay'));

function setup() {
  let focused;
  class Element extends EventTarget {
    constructor(id, dataset = {}) { super(); this.id = id; this.dataset = dataset; this.attrs = {}; this.hidden = false; this.value = ''; this.textContent = ''; }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    replaceChildren(...children) { this.children = children; this.textContent = children.map(n => n.textContent ?? '').join(''); }
    append(child) { this.textContent += child.textContent ?? ''; }
    focus() { focused = this; }
  }
  const ids = ['experiment-canvas','experiment-panel','experiment-title','experiment-description','stage-caption','stage-formula','range-label-text','experiment-range','range-value','stage-field','experiment-time','experiment-time-value','pause-experiment','step-experiment','reset-experiment','experiment-speed'];
  const nodes = new Map(ids.map(id => [id,new Element(id)]));
  const features = ['chat','experiment','create'].map(key => {
    const tab = new Element('feature-'+key,{feature:key}); tab.setAttribute('aria-controls','feature-panel-'+key);
    const panel = new Element('feature-panel-'+key); panel.hidden = key !== 'experiment'; nodes.set(panel.id,panel); return tab;
  });
  const featureLinks = ['chat','experiment','create'].map(featureLink=>new Element('',{featureLink}));
  const experiments = ['wave','orbit','projectile'].map(key=>new Element('tab-'+key,{experiment:key}));
  const endpoints = [new Element(),new Element()], stage = new Element();
  let drawings = 0;
  const context = new Proxy({}, {get: (_, key) => key === 'createRadialGradient' ? () => ({addColorStop(){}}) : key === 'clearRect' ? () => drawings++ : () => {}, set:()=>true});
  nodes.get('experiment-canvas').getContext = () => context;
  const selectors = {'.feature-selector [data-feature]':features,'[data-feature-link]':featureLinks,'.experiment-tabs button':experiments,'.range-endpoints span':endpoints};
  const $ = selector => selector === '.experiment-stage' ? stage : nodes.get(selector.slice(1));
  const document = Object.assign(new EventTarget(), {hidden:false,getElementById:id=>nodes.get(id),createElement:()=>new Element(),createTextNode:text=>({textContent:text})});
  const motion = Object.assign(new EventTarget(),{matches:true});
  const frames = new Map(); let nextFrame = 0, intersection;
  const scope = {
    $, $$:selector=>selectors[selector] ?? [], make:(_tag,_class,text)=>({textContent:text}), document,
    window:{devicePixelRatio:1}, reducedMotion:motion, globalMotionPaused:false,
    positionCarousel(){},updateCarouselPause(){},carouselPaused:false,
    requestAnimationFrame:callback=>{ frames.set(++nextFrame,callback); return nextFrame; },cancelAnimationFrame:id=>frames.delete(id),
    ResizeObserver:class {constructor(callback){this.callback=callback;} observe(){this.callback([{contentRect:{width:716,height:396}}]);}},
    IntersectionObserver:class {constructor(callback){intersection=callback;} observe(){}},
  };
  vm.runInNewContext(featureSource+'\n'+demoSource, scope);
  const fire = (node, type, properties = {}) => { const event = new Event(type,{cancelable:true}); for(const [key,value] of Object.entries(properties)) Object.defineProperty(event,key,{value}); node.dispatchEvent(event); return event; };
  return {nodes,features,featureLinks,experiments,fire,motion,document,frames,get focused(){return focused;},get drawings(){return drawings;},visible:value=>intersection([{isIntersecting:value}]),frame:timestamp=>{const [id,callback]=frames.entries().next().value ?? []; assert.ok(callback,'one scheduled frame is required');frames.delete(id);callback(timestamp);}};
}

test('public feature tabs and entry links switch real panels with keyboard focus', () => {
  const s=setup();
  s.fire(s.features[0],'click');
  assert.equal(s.nodes.get('feature-panel-chat').hidden,false);
  assert.equal(s.nodes.get('feature-panel-experiment').hidden,true);
  assert.equal(s.features[0].getAttribute('aria-selected'),'true');
  assert.equal(s.features[0].tabIndex,0);
  assert.equal(s.features[1].tabIndex,-1);
  const key=s.fire(s.features[0],'keydown',{key:'ArrowLeft'});
  assert.equal(key.defaultPrevented,true);
  assert.equal(s.focused,s.features[2]);
  assert.equal(s.nodes.get('feature-panel-create').hidden,false);
  s.fire(s.featureLinks[1],'click');
  assert.equal(s.nodes.get('feature-panel-experiment').hidden,false);
  assert.equal(s.nodes.get('feature-panel-create').hidden,true);
});

test('the magnetic demo starts at the displayed preset and parameter changes repaint', () => {
  const s=setup(), range=s.nodes.get('experiment-range');
  assert.equal(s.experiments[1].getAttribute('aria-selected'),'true');
  assert.equal(range.value,5);
  assert.equal(s.nodes.get('range-value').textContent,'0.5 T');
  assert.equal(s.nodes.get('stage-field').children[0].textContent,'B = 0.50 T ⊗');
  const before=s.drawings; range.value=6;s.fire(range,'input');
  assert.equal(s.nodes.get('range-value').textContent,'0.6 T');
  assert.ok(s.drawings>before);
  s.fire(s.experiments[0],'click');
  assert.equal(range.value,15);
  assert.equal(s.nodes.get('range-value').textContent,'1.5 Hz');
  assert.equal(s.nodes.get('experiment-time-value').textContent,'0.0 s');
  s.fire(s.experiments[2],'click');
  assert.equal(s.nodes.get('range-value').textContent,'45°');
});

test('seek, step and reset update the visible timeline without starting animation', () => {
  const s=setup(), seek=s.nodes.get('experiment-time');s.visible(true);
  seek.value='65';s.fire(seek,'input');
  assert.equal(s.nodes.get('experiment-time-value').textContent,'65.0 ns');
  assert.equal(s.frames.size,0);
  s.fire(s.nodes.get('step-experiment'),'click');
  assert.equal(s.nodes.get('experiment-time-value').textContent,'66.0 ns');
  s.fire(s.nodes.get('reset-experiment'),'click');
  assert.equal(s.nodes.get('experiment-time-value').textContent,'0.0 ns');
  assert.equal(s.frames.size,0);
});

test('selected speed advances the timeline and hidden features cancel frames', () => {
  const s=setup();s.visible(true);
  s.nodes.get('experiment-speed').value='2';s.fire(s.nodes.get('experiment-speed'),'change');
  s.fire(s.nodes.get('pause-experiment'),'click');s.frame(0);s.frame(50);
  assert.equal(s.nodes.get('experiment-time-value').textContent,'2.0 ns');
  s.fire(s.features[0],'click');assert.equal(s.frames.size,0);
  s.fire(s.features[1],'click');assert.equal(s.frames.size,1);
  s.document.hidden=true;s.fire(s.document,'visibilitychange');assert.equal(s.frames.size,0);
});
