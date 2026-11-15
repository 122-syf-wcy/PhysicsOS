var e=Object.create,t=Object.defineProperty,n=Object.getOwnPropertyDescriptor,r=Object.getOwnPropertyNames,i=Object.getPrototypeOf,a=Object.prototype.hasOwnProperty,o=(e,t)=>()=>(t||(e((t={exports:{}}).exports,t),e=null),t.exports),s=(e,i,o,s)=>{if(i&&typeof i==`object`||typeof i==`function`)for(var c=r(i),l=0,u=c.length,d;l<u;l++)d=c[l],!a.call(e,d)&&d!==o&&t(e,d,{get:(e=>i[e]).bind(null,d),enumerable:!(s=n(i,d))||s.enumerable});return e},c=(n,r,a)=>(a=n==null?{}:e(i(n)),s(r||!n||!n.__esModule?t(a,`default`,{value:n,enumerable:!0}):a,n)),l=o((e=>{
/**
* @license React
* react.production.min.js
*
* Copyright (c) Facebook, Inc. and its affiliates.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/
var t=Symbol.for(`react.element`),n=Symbol.for(`react.portal`),r=Symbol.for(`react.fragment`),i=Symbol.for(`react.strict_mode`),a=Symbol.for(`react.profiler`),o=Symbol.for(`react.provider`),s=Symbol.for(`react.context`),c=Symbol.for(`react.forward_ref`),l=Symbol.for(`react.suspense`),u=Symbol.for(`react.memo`),d=Symbol.for(`react.lazy`),f=Symbol.iterator;function p(e){return typeof e!=`object`||!e?null:(e=f&&e[f]||e[`@@iterator`],typeof e==`function`?e:null)}var m={isMounted:function(){return!1},enqueueForceUpdate:function(){},enqueueReplaceState:function(){},enqueueSetState:function(){}},h=Object.assign,g={};function _(e,t,n){this.props=e,this.context=t,this.refs=g,this.updater=n||m}_.prototype.isReactComponent={},_.prototype.setState=function(e,t){if(typeof e!=`object`&&typeof e!=`function`&&e!=null)throw Error(`setState(...): takes an object of state variables to update or a function which returns an object of state variables.`);this.updater.enqueueSetState(this,e,t,`setState`)},_.prototype.forceUpdate=function(e){this.updater.enqueueForceUpdate(this,e,`forceUpdate`)};function v(){}v.prototype=_.prototype;function y(e,t,n){this.props=e,this.context=t,this.refs=g,this.updater=n||m}var b=y.prototype=new v;b.constructor=y,h(b,_.prototype),b.isPureReactComponent=!0;var ee=Array.isArray,te=Object.prototype.hasOwnProperty,x={current:null},ne={key:!0,ref:!0,__self:!0,__source:!0};function re(e,n,r){var i,a={},o=null,s=null;if(n!=null)for(i in n.ref!==void 0&&(s=n.ref),n.key!==void 0&&(o=``+n.key),n)te.call(n,i)&&!ne.hasOwnProperty(i)&&(a[i]=n[i]);var c=arguments.length-2;if(c===1)a.children=r;else if(1<c){for(var l=Array(c),u=0;u<c;u++)l[u]=arguments[u+2];a.children=l}if(e&&e.defaultProps)for(i in c=e.defaultProps,c)a[i]===void 0&&(a[i]=c[i]);return{$$typeof:t,type:e,key:o,ref:s,props:a,_owner:x.current}}function S(e,n){return{$$typeof:t,type:e.type,key:n,ref:e.ref,props:e.props,_owner:e._owner}}function ie(e){return typeof e==`object`&&!!e&&e.$$typeof===t}function C(e){var t={"=":`=0`,":":`=2`};return`$`+e.replace(/[=:]/g,function(e){return t[e]})}var ae=/\/+/g;function oe(e,t){return typeof e==`object`&&e&&e.key!=null?C(``+e.key):t.toString(36)}function w(e,r,i,a,o){var s=typeof e;(s===`undefined`||s===`boolean`)&&(e=null);var c=!1;if(e===null)c=!0;else switch(s){case`string`:case`number`:c=!0;break;case`object`:switch(e.$$typeof){case t:case n:c=!0}}if(c)return c=e,o=o(c),e=a===``?`.`+oe(c,0):a,ee(o)?(i=``,e!=null&&(i=e.replace(ae,`$&/`)+`/`),w(o,r,i,``,function(e){return e})):o!=null&&(ie(o)&&(o=S(o,i+(!o.key||c&&c.key===o.key?``:(``+o.key).replace(ae,`$&/`)+`/`)+e)),r.push(o)),1;if(c=0,a=a===``?`.`:a+`:`,ee(e))for(var l=0;l<e.length;l++){s=e[l];var u=a+oe(s,l);c+=w(s,r,i,u,o)}else if(u=p(e),typeof u==`function`)for(e=u.call(e),l=0;!(s=e.next()).done;)s=s.value,u=a+oe(s,l++),c+=w(s,r,i,u,o);else if(s===`object`)throw r=String(e),Error(`Objects are not valid as a React child (found: `+(r===`[object Object]`?`object with keys {`+Object.keys(e).join(`, `)+`}`:r)+`). If you meant to render a collection of children, use an array instead.`);return c}function T(e,t,n){if(e==null)return e;var r=[],i=0;return w(e,r,``,``,function(e){return t.call(n,e,i++)}),r}function se(e){if(e._status===-1){var t=e._result;t=t(),t.then(function(t){(e._status===0||e._status===-1)&&(e._status=1,e._result=t)},function(t){(e._status===0||e._status===-1)&&(e._status=2,e._result=t)}),e._status===-1&&(e._status=0,e._result=t)}if(e._status===1)return e._result.default;throw e._result}var E={current:null},ce={transition:null},D={ReactCurrentDispatcher:E,ReactCurrentBatchConfig:ce,ReactCurrentOwner:x};function le(){throw Error(`act(...) is not supported in production builds of React.`)}e.Children={map:T,forEach:function(e,t,n){T(e,function(){t.apply(this,arguments)},n)},count:function(e){var t=0;return T(e,function(){t++}),t},toArray:function(e){return T(e,function(e){return e})||[]},only:function(e){if(!ie(e))throw Error(`React.Children.only expected to receive a single React element child.`);return e}},e.Component=_,e.Fragment=r,e.Profiler=a,e.PureComponent=y,e.StrictMode=i,e.Suspense=l,e.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=D,e.act=le,e.cloneElement=function(e,n,r){if(e==null)throw Error(`React.cloneElement(...): The argument must be a React element, but you passed `+e+`.`);var i=h({},e.props),a=e.key,o=e.ref,s=e._owner;if(n!=null){if(n.ref!==void 0&&(o=n.ref,s=x.current),n.key!==void 0&&(a=``+n.key),e.type&&e.type.defaultProps)var c=e.type.defaultProps;for(l in n)te.call(n,l)&&!ne.hasOwnProperty(l)&&(i[l]=n[l]===void 0&&c!==void 0?c[l]:n[l])}var l=arguments.length-2;if(l===1)i.children=r;else if(1<l){c=Array(l);for(var u=0;u<l;u++)c[u]=arguments[u+2];i.children=c}return{$$typeof:t,type:e.type,key:a,ref:o,props:i,_owner:s}},e.createContext=function(e){return e={$$typeof:s,_currentValue:e,_currentValue2:e,_threadCount:0,Provider:null,Consumer:null,_defaultValue:null,_globalName:null},e.Provider={$$typeof:o,_context:e},e.Consumer=e},e.createElement=re,e.createFactory=function(e){var t=re.bind(null,e);return t.type=e,t},e.createRef=function(){return{current:null}},e.forwardRef=function(e){return{$$typeof:c,render:e}},e.isValidElement=ie,e.lazy=function(e){return{$$typeof:d,_payload:{_status:-1,_result:e},_init:se}},e.memo=function(e,t){return{$$typeof:u,type:e,compare:t===void 0?null:t}},e.startTransition=function(e){var t=ce.transition;ce.transition={};try{e()}finally{ce.transition=t}},e.unstable_act=le,e.useCallback=function(e,t){return E.current.useCallback(e,t)},e.useContext=function(e){return E.current.useContext(e)},e.useDebugValue=function(){},e.useDeferredValue=function(e){return E.current.useDeferredValue(e)},e.useEffect=function(e,t){return E.current.useEffect(e,t)},e.useId=function(){return E.current.useId()},e.useImperativeHandle=function(e,t,n){return E.current.useImperativeHandle(e,t,n)},e.useInsertionEffect=function(e,t){return E.current.useInsertionEffect(e,t)},e.useLayoutEffect=function(e,t){return E.current.useLayoutEffect(e,t)},e.useMemo=function(e,t){return E.current.useMemo(e,t)},e.useReducer=function(e,t,n){return E.current.useReducer(e,t,n)},e.useRef=function(e){return E.current.useRef(e)},e.useState=function(e){return E.current.useState(e)},e.useSyncExternalStore=function(e,t,n){return E.current.useSyncExternalStore(e,t,n)},e.useTransition=function(){return E.current.useTransition()},e.version=`18.3.1`})),u=o(((e,t)=>{t.exports=l()})),d=o((e=>{
/**
* @license React
* scheduler.production.min.js
*
* Copyright (c) Facebook, Inc. and its affiliates.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/
function t(e,t){var n=e.length;e.push(t);a:for(;0<n;){var r=n-1>>>1,a=e[r];if(0<i(a,t))e[r]=t,e[n]=a,n=r;else break a}}function n(e){return e.length===0?null:e[0]}function r(e){if(e.length===0)return null;var t=e[0],n=e.pop();if(n!==t){e[0]=n;a:for(var r=0,a=e.length,o=a>>>1;r<o;){var s=2*(r+1)-1,c=e[s],l=s+1,u=e[l];if(0>i(c,n))l<a&&0>i(u,c)?(e[r]=u,e[l]=n,r=l):(e[r]=c,e[s]=n,r=s);else if(l<a&&0>i(u,n))e[r]=u,e[l]=n,r=l;else break a}}return t}function i(e,t){var n=e.sortIndex-t.sortIndex;return n===0?e.id-t.id:n}if(typeof performance==`object`&&typeof performance.now==`function`){var a=performance;e.unstable_now=function(){return a.now()}}else{var o=Date,s=o.now();e.unstable_now=function(){return o.now()-s}}var c=[],l=[],u=1,d=null,f=3,p=!1,m=!1,h=!1,g=typeof setTimeout==`function`?setTimeout:null,_=typeof clearTimeout==`function`?clearTimeout:null,v=typeof setImmediate<`u`?setImmediate:null;typeof navigator<`u`&&navigator.scheduling!==void 0&&navigator.scheduling.isInputPending!==void 0&&navigator.scheduling.isInputPending.bind(navigator.scheduling);function y(e){for(var i=n(l);i!==null;){if(i.callback===null)r(l);else if(i.startTime<=e)r(l),i.sortIndex=i.expirationTime,t(c,i);else break;i=n(l)}}function b(e){if(h=!1,y(e),!m)if(n(c)!==null)m=!0,T(ee);else{var t=n(l);t!==null&&se(b,t.startTime-e)}}function ee(t,i){m=!1,h&&(h=!1,_(ne),ne=-1),p=!0;var a=f;try{for(y(i),d=n(c);d!==null&&(!(d.expirationTime>i)||t&&!ie());){var o=d.callback;if(typeof o==`function`){d.callback=null,f=d.priorityLevel;var s=o(d.expirationTime<=i);i=e.unstable_now(),typeof s==`function`?d.callback=s:d===n(c)&&r(c),y(i)}else r(c);d=n(c)}if(d!==null)var u=!0;else{var g=n(l);g!==null&&se(b,g.startTime-i),u=!1}return u}finally{d=null,f=a,p=!1}}var te=!1,x=null,ne=-1,re=5,S=-1;function ie(){return!(e.unstable_now()-S<re)}function C(){if(x!==null){var t=e.unstable_now();S=t;var n=!0;try{n=x(!0,t)}finally{n?ae():(te=!1,x=null)}}else te=!1}var ae;if(typeof v==`function`)ae=function(){v(C)};else if(typeof MessageChannel<`u`){var oe=new MessageChannel,w=oe.port2;oe.port1.onmessage=C,ae=function(){w.postMessage(null)}}else ae=function(){g(C,0)};function T(e){x=e,te||(te=!0,ae())}function se(t,n){ne=g(function(){t(e.unstable_now())},n)}e.unstable_IdlePriority=5,e.unstable_ImmediatePriority=1,e.unstable_LowPriority=4,e.unstable_NormalPriority=3,e.unstable_Profiling=null,e.unstable_UserBlockingPriority=2,e.unstable_cancelCallback=function(e){e.callback=null},e.unstable_continueExecution=function(){m||p||(m=!0,T(ee))},e.unstable_forceFrameRate=function(e){0>e||125<e?console.error(`forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported`):re=0<e?Math.floor(1e3/e):5},e.unstable_getCurrentPriorityLevel=function(){return f},e.unstable_getFirstCallbackNode=function(){return n(c)},e.unstable_next=function(e){switch(f){case 1:case 2:case 3:var t=3;break;default:t=f}var n=f;f=t;try{return e()}finally{f=n}},e.unstable_pauseExecution=function(){},e.unstable_requestPaint=function(){},e.unstable_runWithPriority=function(e,t){switch(e){case 1:case 2:case 3:case 4:case 5:break;default:e=3}var n=f;f=e;try{return t()}finally{f=n}},e.unstable_scheduleCallback=function(r,i,a){var o=e.unstable_now();switch(typeof a==`object`&&a?(a=a.delay,a=typeof a==`number`&&0<a?o+a:o):a=o,r){case 1:var s=-1;break;case 2:s=250;break;case 5:s=1073741823;break;case 4:s=1e4;break;default:s=5e3}return s=a+s,r={id:u++,callback:i,priorityLevel:r,startTime:a,expirationTime:s,sortIndex:-1},a>o?(r.sortIndex=a,t(l,r),n(c)===null&&r===n(l)&&(h?(_(ne),ne=-1):h=!0,se(b,a-o))):(r.sortIndex=s,t(c,r),m||p||(m=!0,T(ee))),r},e.unstable_shouldYield=ie,e.unstable_wrapCallback=function(e){var t=f;return function(){var n=f;f=t;try{return e.apply(this,arguments)}finally{f=n}}}})),f=o(((e,t)=>{t.exports=d()})),p=o((e=>{
/**
* @license React
* react-dom.production.min.js
*
* Copyright (c) Facebook, Inc. and its affiliates.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/
var t=u(),n=f();function r(e){for(var t=`https://reactjs.org/docs/error-decoder.html?invariant=`+e,n=1;n<arguments.length;n++)t+=`&args[]=`+encodeURIComponent(arguments[n]);return`Minified React error #`+e+`; visit `+t+` for the full message or use the non-minified dev environment for full errors and additional helpful warnings.`}var i=new Set,a={};function o(e,t){s(e,t),s(e+`Capture`,t)}function s(e,t){for(a[e]=t,e=0;e<t.length;e++)i.add(t[e])}var c=!(typeof window>`u`||window.document===void 0||window.document.createElement===void 0),l=Object.prototype.hasOwnProperty,d=/^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/,p={},m={};function h(e){return l.call(m,e)?!0:l.call(p,e)?!1:d.test(e)?m[e]=!0:(p[e]=!0,!1)}function g(e,t,n,r){if(n!==null&&n.type===0)return!1;switch(typeof t){case`function`:case`symbol`:return!0;case`boolean`:return r?!1:n===null?(e=e.toLowerCase().slice(0,5),e!==`data-`&&e!==`aria-`):!n.acceptsBooleans;default:return!1}}function _(e,t,n,r){if(t==null||g(e,t,n,r))return!0;if(r)return!1;if(n!==null)switch(n.type){case 3:return!t;case 4:return!1===t;case 5:return isNaN(t);case 6:return isNaN(t)||1>t}return!1}function v(e,t,n,r,i,a,o){this.acceptsBooleans=t===2||t===3||t===4,this.attributeName=r,this.attributeNamespace=i,this.mustUseProperty=n,this.propertyName=e,this.type=t,this.sanitizeURL=a,this.removeEmptyString=o}var y={};`children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style`.split(` `).forEach(function(e){y[e]=new v(e,0,!1,e,null,!1,!1)}),[[`acceptCharset`,`accept-charset`],[`className`,`class`],[`htmlFor`,`for`],[`httpEquiv`,`http-equiv`]].forEach(function(e){var t=e[0];y[t]=new v(t,1,!1,e[1],null,!1,!1)}),[`contentEditable`,`draggable`,`spellCheck`,`value`].forEach(function(e){y[e]=new v(e,2,!1,e.toLowerCase(),null,!1,!1)}),[`autoReverse`,`externalResourcesRequired`,`focusable`,`preserveAlpha`].forEach(function(e){y[e]=new v(e,2,!1,e,null,!1,!1)}),`allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope`.split(` `).forEach(function(e){y[e]=new v(e,3,!1,e.toLowerCase(),null,!1,!1)}),[`checked`,`multiple`,`muted`,`selected`].forEach(function(e){y[e]=new v(e,3,!0,e,null,!1,!1)}),[`capture`,`download`].forEach(function(e){y[e]=new v(e,4,!1,e,null,!1,!1)}),[`cols`,`rows`,`size`,`span`].forEach(function(e){y[e]=new v(e,6,!1,e,null,!1,!1)}),[`rowSpan`,`start`].forEach(function(e){y[e]=new v(e,5,!1,e.toLowerCase(),null,!1,!1)});var b=/[\-:]([a-z])/g;function ee(e){return e[1].toUpperCase()}`accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height`.split(` `).forEach(function(e){var t=e.replace(b,ee);y[t]=new v(t,1,!1,e,null,!1,!1)}),`xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type`.split(` `).forEach(function(e){var t=e.replace(b,ee);y[t]=new v(t,1,!1,e,`http://www.w3.org/1999/xlink`,!1,!1)}),[`xml:base`,`xml:lang`,`xml:space`].forEach(function(e){var t=e.replace(b,ee);y[t]=new v(t,1,!1,e,`http://www.w3.org/XML/1998/namespace`,!1,!1)}),[`tabIndex`,`crossOrigin`].forEach(function(e){y[e]=new v(e,1,!1,e.toLowerCase(),null,!1,!1)}),y.xlinkHref=new v(`xlinkHref`,1,!1,`xlink:href`,`http://www.w3.org/1999/xlink`,!0,!1),[`src`,`href`,`action`,`formAction`].forEach(function(e){y[e]=new v(e,1,!1,e.toLowerCase(),null,!0,!0)});function te(e,t,n,r){var i=y.hasOwnProperty(t)?y[t]:null;(i===null?r||!(2<t.length)||t[0]!==`o`&&t[0]!==`O`||t[1]!==`n`&&t[1]!==`N`:i.type!==0)&&(_(t,n,i,r)&&(n=null),r||i===null?h(t)&&(n===null?e.removeAttribute(t):e.setAttribute(t,``+n)):i.mustUseProperty?e[i.propertyName]=n===null?i.type===3?!1:``:n:(t=i.attributeName,r=i.attributeNamespace,n===null?e.removeAttribute(t):(i=i.type,n=i===3||i===4&&!0===n?``:``+n,r?e.setAttributeNS(r,t,n):e.setAttribute(t,n))))}var x=t.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,ne=Symbol.for(`react.element`),re=Symbol.for(`react.portal`),S=Symbol.for(`react.fragment`),ie=Symbol.for(`react.strict_mode`),C=Symbol.for(`react.profiler`),ae=Symbol.for(`react.provider`),oe=Symbol.for(`react.context`),w=Symbol.for(`react.forward_ref`),T=Symbol.for(`react.suspense`),se=Symbol.for(`react.suspense_list`),E=Symbol.for(`react.memo`),ce=Symbol.for(`react.lazy`),D=Symbol.for(`react.offscreen`),le=Symbol.iterator;function ue(e){return typeof e!=`object`||!e?null:(e=le&&e[le]||e[`@@iterator`],typeof e==`function`?e:null)}var O=Object.assign,k;function A(e){if(k===void 0)try{throw Error()}catch(e){var t=e.stack.trim().match(/\n( *(at )?)/);k=t&&t[1]||``}return`
`+k+e}var de=!1;function fe(e,t){if(!e||de)return``;de=!0;var n=Error.prepareStackTrace;Error.prepareStackTrace=void 0;try{if(t)if(t=function(){throw Error()},Object.defineProperty(t.prototype,"props",{set:function(){throw Error()}}),typeof Reflect==`object`&&Reflect.construct){try{Reflect.construct(t,[])}catch(e){var r=e}Reflect.construct(e,[],t)}else{try{t.call()}catch(e){r=e}e.call(t.prototype)}else{try{throw Error()}catch(e){r=e}e()}}catch(t){if(t&&r&&typeof t.stack==`string`){for(var i=t.stack.split(`
`),a=r.stack.split(`
`),o=i.length-1,s=a.length-1;1<=o&&0<=s&&i[o]!==a[s];)s--;for(;1<=o&&0<=s;o--,s--)if(i[o]!==a[s]){if(o!==1||s!==1)do if(o--,s--,0>s||i[o]!==a[s]){var c=`
`+i[o].replace(` at new `,` at `);return e.displayName&&c.includes(`<anonymous>`)&&(c=c.replace(`<anonymous>`,e.displayName)),c}while(1<=o&&0<=s);break}}}finally{de=!1,Error.prepareStackTrace=n}return(e=e?e.displayName||e.name:``)?A(e):``}function pe(e){switch(e.tag){case 5:return A(e.type);case 16:return A(`Lazy`);case 13:return A(`Suspense`);case 19:return A(`SuspenseList`);case 0:case 2:case 15:return e=fe(e.type,!1),e;case 11:return e=fe(e.type.render,!1),e;case 1:return e=fe(e.type,!0),e;default:return``}}function me(e){if(e==null)return null;if(typeof e==`function`)return e.displayName||e.name||null;if(typeof e==`string`)return e;switch(e){case S:return`Fragment`;case re:return`Portal`;case C:return`Profiler`;case ie:return`StrictMode`;case T:return`Suspense`;case se:return`SuspenseList`}if(typeof e==`object`)switch(e.$$typeof){case oe:return(e.displayName||`Context`)+`.Consumer`;case ae:return(e._context.displayName||`Context`)+`.Provider`;case w:var t=e.render;return e=e.displayName,e||=(e=t.displayName||t.name||``,e===``?`ForwardRef`:`ForwardRef(`+e+`)`),e;case E:return t=e.displayName||null,t===null?me(e.type)||`Memo`:t;case ce:t=e._payload,e=e._init;try{return me(e(t))}catch{}}return null}function he(e){var t=e.type;switch(e.tag){case 24:return`Cache`;case 9:return(t.displayName||`Context`)+`.Consumer`;case 10:return(t._context.displayName||`Context`)+`.Provider`;case 18:return`DehydratedFragment`;case 11:return e=t.render,e=e.displayName||e.name||``,t.displayName||(e===``?`ForwardRef`:`ForwardRef(`+e+`)`);case 7:return`Fragment`;case 5:return t;case 4:return`Portal`;case 3:return`Root`;case 6:return`Text`;case 16:return me(t);case 8:return t===ie?`StrictMode`:`Mode`;case 22:return`Offscreen`;case 12:return`Profiler`;case 21:return`Scope`;case 13:return`Suspense`;case 19:return`SuspenseList`;case 25:return`TracingMarker`;case 1:case 0:case 17:case 2:case 14:case 15:if(typeof t==`function`)return t.displayName||t.name||null;if(typeof t==`string`)return t}return null}function ge(e){switch(typeof e){case`boolean`:case`number`:case`string`:case`undefined`:return e;case`object`:return e;default:return``}}function _e(e){var t=e.type;return(e=e.nodeName)&&e.toLowerCase()===`input`&&(t===`checkbox`||t===`radio`)}function j(e){var t=_e(e)?`checked`:`value`,n=Object.getOwnPropertyDescriptor(e.constructor.prototype,t),r=``+e[t];if(!e.hasOwnProperty(t)&&n!==void 0&&typeof n.get==`function`&&typeof n.set==`function`){var i=n.get,a=n.set;return Object.defineProperty(e,t,{configurable:!0,get:function(){return i.call(this)},set:function(e){r=``+e,a.call(this,e)}}),Object.defineProperty(e,t,{enumerable:n.enumerable}),{getValue:function(){return r},setValue:function(e){r=``+e},stopTracking:function(){e._valueTracker=null,delete e[t]}}}}function M(e){e._valueTracker||=j(e)}function ve(e){if(!e)return!1;var t=e._valueTracker;if(!t)return!0;var n=t.getValue(),r=``;return e&&(r=_e(e)?e.checked?`true`:`false`:e.value),e=r,e===n?!1:(t.setValue(e),!0)}function ye(e){if(e||=typeof document<`u`?document:void 0,e===void 0)return null;try{return e.activeElement||e.body}catch{return e.body}}function be(e,t){var n=t.checked;return O({},t,{defaultChecked:void 0,defaultValue:void 0,value:void 0,checked:n??e._wrapperState.initialChecked})}function xe(e,t){var n=t.defaultValue==null?``:t.defaultValue,r=t.checked==null?t.defaultChecked:t.checked;n=ge(t.value==null?n:t.value),e._wrapperState={initialChecked:r,initialValue:n,controlled:t.type===`checkbox`||t.type===`radio`?t.checked!=null:t.value!=null}}function Se(e,t){t=t.checked,t!=null&&te(e,`checked`,t,!1)}function N(e,t){Se(e,t);var n=ge(t.value),r=t.type;if(n!=null)r===`number`?(n===0&&e.value===``||e.value!=n)&&(e.value=``+n):e.value!==``+n&&(e.value=``+n);else if(r===`submit`||r===`reset`){e.removeAttribute(`value`);return}t.hasOwnProperty(`value`)?Ce(e,t.type,n):t.hasOwnProperty(`defaultValue`)&&Ce(e,t.type,ge(t.defaultValue)),t.checked==null&&t.defaultChecked!=null&&(e.defaultChecked=!!t.defaultChecked)}function P(e,t,n){if(t.hasOwnProperty(`value`)||t.hasOwnProperty(`defaultValue`)){var r=t.type;if(!(r!==`submit`&&r!==`reset`||t.value!==void 0&&t.value!==null))return;t=``+e._wrapperState.initialValue,n||t===e.value||(e.value=t),e.defaultValue=t}n=e.name,n!==``&&(e.name=``),e.defaultChecked=!!e._wrapperState.initialChecked,n!==``&&(e.name=n)}function Ce(e,t,n){(t!==`number`||ye(e.ownerDocument)!==e)&&(n==null?e.defaultValue=``+e._wrapperState.initialValue:e.defaultValue!==``+n&&(e.defaultValue=``+n))}var we=Array.isArray;function Te(e,t,n,r){if(e=e.options,t){t={};for(var i=0;i<n.length;i++)t[`$`+n[i]]=!0;for(n=0;n<e.length;n++)i=t.hasOwnProperty(`$`+e[n].value),e[n].selected!==i&&(e[n].selected=i),i&&r&&(e[n].defaultSelected=!0)}else{for(n=``+ge(n),t=null,i=0;i<e.length;i++){if(e[i].value===n){e[i].selected=!0,r&&(e[i].defaultSelected=!0);return}t!==null||e[i].disabled||(t=e[i])}t!==null&&(t.selected=!0)}}function Ee(e,t){if(t.dangerouslySetInnerHTML!=null)throw Error(r(91));return O({},t,{value:void 0,defaultValue:void 0,children:``+e._wrapperState.initialValue})}function De(e,t){var n=t.value;if(n==null){if(n=t.children,t=t.defaultValue,n!=null){if(t!=null)throw Error(r(92));if(we(n)){if(1<n.length)throw Error(r(93));n=n[0]}t=n}t??=``,n=t}e._wrapperState={initialValue:ge(n)}}function Oe(e,t){var n=ge(t.value),r=ge(t.defaultValue);n!=null&&(n=``+n,n!==e.value&&(e.value=n),t.defaultValue==null&&e.defaultValue!==n&&(e.defaultValue=n)),r!=null&&(e.defaultValue=``+r)}function F(e){var t=e.textContent;t===e._wrapperState.initialValue&&t!==``&&t!==null&&(e.value=t)}function ke(e){switch(e){case`svg`:return`http://www.w3.org/2000/svg`;case`math`:return`http://www.w3.org/1998/Math/MathML`;default:return`http://www.w3.org/1999/xhtml`}}function Ae(e,t){return e==null||e===`http://www.w3.org/1999/xhtml`?ke(t):e===`http://www.w3.org/2000/svg`&&t===`foreignObject`?`http://www.w3.org/1999/xhtml`:e}var je,Me=function(e){return typeof MSApp<`u`&&MSApp.execUnsafeLocalFunction?function(t,n,r,i){MSApp.execUnsafeLocalFunction(function(){return e(t,n,r,i)})}:e}(function(e,t){if(e.namespaceURI!==`http://www.w3.org/2000/svg`||`innerHTML`in e)e.innerHTML=t;else{for(je||=document.createElement(`div`),je.innerHTML=`<svg>`+t.valueOf().toString()+`</svg>`,t=je.firstChild;e.firstChild;)e.removeChild(e.firstChild);for(;t.firstChild;)e.appendChild(t.firstChild)}});function Ne(e,t){if(t){var n=e.firstChild;if(n&&n===e.lastChild&&n.nodeType===3){n.nodeValue=t;return}}e.textContent=t}var Pe={animationIterationCount:!0,aspectRatio:!0,borderImageOutset:!0,borderImageSlice:!0,borderImageWidth:!0,boxFlex:!0,boxFlexGroup:!0,boxOrdinalGroup:!0,columnCount:!0,columns:!0,flex:!0,flexGrow:!0,flexPositive:!0,flexShrink:!0,flexNegative:!0,flexOrder:!0,gridArea:!0,gridRow:!0,gridRowEnd:!0,gridRowSpan:!0,gridRowStart:!0,gridColumn:!0,gridColumnEnd:!0,gridColumnSpan:!0,gridColumnStart:!0,fontWeight:!0,lineClamp:!0,lineHeight:!0,opacity:!0,order:!0,orphans:!0,tabSize:!0,widows:!0,zIndex:!0,zoom:!0,fillOpacity:!0,floodOpacity:!0,stopOpacity:!0,strokeDasharray:!0,strokeDashoffset:!0,strokeMiterlimit:!0,strokeOpacity:!0,strokeWidth:!0},Fe=[`Webkit`,`ms`,`Moz`,`O`];Object.keys(Pe).forEach(function(e){Fe.forEach(function(t){t=t+e.charAt(0).toUpperCase()+e.substring(1),Pe[t]=Pe[e]})});function Ie(e,t,n){return t==null||typeof t==`boolean`||t===``?``:n||typeof t!=`number`||t===0||Pe.hasOwnProperty(e)&&Pe[e]?(``+t).trim():t+`px`}function Le(e,t){for(var n in e=e.style,t)if(t.hasOwnProperty(n)){var r=n.indexOf(`--`)===0,i=Ie(n,t[n],r);n===`float`&&(n=`cssFloat`),r?e.setProperty(n,i):e[n]=i}}var Re=O({menuitem:!0},{area:!0,base:!0,br:!0,col:!0,embed:!0,hr:!0,img:!0,input:!0,keygen:!0,link:!0,meta:!0,param:!0,source:!0,track:!0,wbr:!0});function ze(e,t){if(t){if(Re[e]&&(t.children!=null||t.dangerouslySetInnerHTML!=null))throw Error(r(137,e));if(t.dangerouslySetInnerHTML!=null){if(t.children!=null)throw Error(r(60));if(typeof t.dangerouslySetInnerHTML!=`object`||!(`__html`in t.dangerouslySetInnerHTML))throw Error(r(61))}if(t.style!=null&&typeof t.style!=`object`)throw Error(r(62))}}function Be(e,t){if(e.indexOf(`-`)===-1)return typeof t.is==`string`;switch(e){case`annotation-xml`:case`color-profile`:case`font-face`:case`font-face-src`:case`font-face-uri`:case`font-face-format`:case`font-face-name`:case`missing-glyph`:return!1;default:return!0}}var Ve=null;function He(e){return e=e.target||e.srcElement||window,e.correspondingUseElement&&(e=e.correspondingUseElement),e.nodeType===3?e.parentNode:e}var I=null,L=null,R=null;function Ue(e){if(e=Ni(e)){if(typeof I!=`function`)throw Error(r(280));var t=e.stateNode;t&&(t=Fi(t),I(e.stateNode,e.type,t))}}function z(e){L?R?R.push(e):R=[e]:L=e}function B(){if(L){var e=L,t=R;if(R=L=null,Ue(e),t)for(e=0;e<t.length;e++)Ue(t[e])}}function We(e,t){return e(t)}function Ge(){}var Ke=!1;function qe(e,t,n){if(Ke)return e(t,n);Ke=!0;try{return We(e,t,n)}finally{Ke=!1,(L!==null||R!==null)&&(Ge(),B())}}function V(e,t){var n=e.stateNode;if(n===null)return null;var i=Fi(n);if(i===null)return null;n=i[t];a:switch(t){case`onClick`:case`onClickCapture`:case`onDoubleClick`:case`onDoubleClickCapture`:case`onMouseDown`:case`onMouseDownCapture`:case`onMouseMove`:case`onMouseMoveCapture`:case`onMouseUp`:case`onMouseUpCapture`:case`onMouseEnter`:(i=!i.disabled)||(e=e.type,i=!(e===`button`||e===`input`||e===`select`||e===`textarea`)),e=!i;break a;default:e=!1}if(e)return null;if(n&&typeof n!=`function`)throw Error(r(231,t,typeof n));return n}var H=!1;if(c)try{var U={};Object.defineProperty(U,"passive",{get:function(){H=!0}}),window.addEventListener(`test`,U,U),window.removeEventListener(`test`,U,U)}catch{H=!1}function Je(e,t,n,r,i,a,o,s,c){var l=Array.prototype.slice.call(arguments,3);try{t.apply(n,l)}catch(e){this.onError(e)}}var Ye=!1,Xe=null,Ze=!1,Qe=null,$e={onError:function(e){Ye=!0,Xe=e}};function W(e,t,n,r,i,a,o,s,c){Ye=!1,Xe=null,Je.apply($e,arguments)}function et(e,t,n,i,a,o,s,c,l){if(W.apply(this,arguments),Ye){if(Ye){var u=Xe;Ye=!1,Xe=null}else throw Error(r(198));Ze||(Ze=!0,Qe=u)}}function tt(e){var t=e,n=e;if(e.alternate)for(;t.return;)t=t.return;else{e=t;do t=e,t.flags&4098&&(n=t.return),e=t.return;while(e)}return t.tag===3?n:null}function nt(e){if(e.tag===13){var t=e.memoizedState;if(t===null&&(e=e.alternate,e!==null&&(t=e.memoizedState)),t!==null)return t.dehydrated}return null}function rt(e){if(tt(e)!==e)throw Error(r(188))}function G(e){var t=e.alternate;if(!t){if(t=tt(e),t===null)throw Error(r(188));return t===e?e:null}for(var n=e,i=t;;){var a=n.return;if(a===null)break;var o=a.alternate;if(o===null){if(i=a.return,i!==null){n=i;continue}break}if(a.child===o.child){for(o=a.child;o;){if(o===n)return rt(a),e;if(o===i)return rt(a),t;o=o.sibling}throw Error(r(188))}if(n.return!==i.return)n=a,i=o;else{for(var s=!1,c=a.child;c;){if(c===n){s=!0,n=a,i=o;break}if(c===i){s=!0,i=a,n=o;break}c=c.sibling}if(!s){for(c=o.child;c;){if(c===n){s=!0,n=o,i=a;break}if(c===i){s=!0,i=o,n=a;break}c=c.sibling}if(!s)throw Error(r(189))}}if(n.alternate!==i)throw Error(r(190))}if(n.tag!==3)throw Error(r(188));return n.stateNode.current===n?e:t}function it(e){return e=G(e),e===null?null:at(e)}function at(e){if(e.tag===5||e.tag===6)return e;for(e=e.child;e!==null;){var t=at(e);if(t!==null)return t;e=e.sibling}return null}var ot=n.unstable_scheduleCallback,st=n.unstable_cancelCallback,ct=n.unstable_shouldYield,lt=n.unstable_requestPaint,ut=n.unstable_now,dt=n.unstable_getCurrentPriorityLevel,ft=n.unstable_ImmediatePriority,pt=n.unstable_UserBlockingPriority,mt=n.unstable_NormalPriority,ht=n.unstable_LowPriority,gt=n.unstable_IdlePriority,_t=null,vt=null;function yt(e){if(vt&&typeof vt.onCommitFiberRoot==`function`)try{vt.onCommitFiberRoot(_t,e,void 0,(e.current.flags&128)==128)}catch{}}var bt=Math.clz32?Math.clz32:Ct,xt=Math.log,St=Math.LN2;function Ct(e){return e>>>=0,e===0?32:31-(xt(e)/St|0)|0}var wt=64,Tt=4194304;function Et(e){switch(e&-e){case 1:return 1;case 2:return 2;case 4:return 4;case 8:return 8;case 16:return 16;case 32:return 32;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return e&4194240;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return e&130023424;case 134217728:return 134217728;case 268435456:return 268435456;case 536870912:return 536870912;case 1073741824:return 1073741824;default:return e}}function Dt(e,t){var n=e.pendingLanes;if(n===0)return 0;var r=0,i=e.suspendedLanes,a=e.pingedLanes,o=n&268435455;if(o!==0){var s=o&~i;s===0?(a&=o,a!==0&&(r=Et(a))):r=Et(s)}else o=n&~i,o===0?a!==0&&(r=Et(a)):r=Et(o);if(r===0)return 0;if(t!==0&&t!==r&&(t&i)===0&&(i=r&-r,a=t&-t,i>=a||i===16&&a&4194240))return t;if(r&4&&(r|=n&16),t=e.entangledLanes,t!==0)for(e=e.entanglements,t&=r;0<t;)n=31-bt(t),i=1<<n,r|=e[n],t&=~i;return r}function Ot(e,t){switch(e){case 1:case 2:case 4:return t+250;case 8:case 16:case 32:case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return t+5e3;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return-1;case 134217728:case 268435456:case 536870912:case 1073741824:return-1;default:return-1}}function kt(e,t){for(var n=e.suspendedLanes,r=e.pingedLanes,i=e.expirationTimes,a=e.pendingLanes;0<a;){var o=31-bt(a),s=1<<o,c=i[o];c===-1?((s&n)===0||(s&r)!==0)&&(i[o]=Ot(s,t)):c<=t&&(e.expiredLanes|=s),a&=~s}}function At(e){return e=e.pendingLanes&-1073741825,e===0?e&1073741824?1073741824:0:e}function jt(){var e=wt;return wt<<=1,!(wt&4194240)&&(wt=64),e}function Mt(e){for(var t=[],n=0;31>n;n++)t.push(e);return t}function Nt(e,t,n){e.pendingLanes|=t,t!==536870912&&(e.suspendedLanes=0,e.pingedLanes=0),e=e.eventTimes,t=31-bt(t),e[t]=n}function Pt(e,t){var n=e.pendingLanes&~t;e.pendingLanes=t,e.suspendedLanes=0,e.pingedLanes=0,e.expiredLanes&=t,e.mutableReadLanes&=t,e.entangledLanes&=t,t=e.entanglements;var r=e.eventTimes;for(e=e.expirationTimes;0<n;){var i=31-bt(n),a=1<<i;t[i]=0,r[i]=-1,e[i]=-1,n&=~a}}function Ft(e,t){var n=e.entangledLanes|=t;for(e=e.entanglements;n;){var r=31-bt(n),i=1<<r;i&t|e[r]&t&&(e[r]|=t),n&=~i}}var K=0;function It(e){return e&=-e,1<e?4<e?e&268435455?16:536870912:4:1}var Lt,Rt,zt,Bt,Vt,Ht=!1,Ut=[],Wt=null,Gt=null,Kt=null,qt=new Map,Jt=new Map,Yt=[],Xt=`mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit`.split(` `);function Zt(e,t){switch(e){case`focusin`:case`focusout`:Wt=null;break;case`dragenter`:case`dragleave`:Gt=null;break;case`mouseover`:case`mouseout`:Kt=null;break;case`pointerover`:case`pointerout`:qt.delete(t.pointerId);break;case`gotpointercapture`:case`lostpointercapture`:Jt.delete(t.pointerId)}}function Qt(e,t,n,r,i,a){return e===null||e.nativeEvent!==a?(e={blockedOn:t,domEventName:n,eventSystemFlags:r,nativeEvent:a,targetContainers:[i]},t!==null&&(t=Ni(t),t!==null&&Rt(t)),e):(e.eventSystemFlags|=r,t=e.targetContainers,i!==null&&t.indexOf(i)===-1&&t.push(i),e)}function $t(e,t,n,r,i){switch(t){case`focusin`:return Wt=Qt(Wt,e,t,n,r,i),!0;case`dragenter`:return Gt=Qt(Gt,e,t,n,r,i),!0;case`mouseover`:return Kt=Qt(Kt,e,t,n,r,i),!0;case`pointerover`:var a=i.pointerId;return qt.set(a,Qt(qt.get(a)||null,e,t,n,r,i)),!0;case`gotpointercapture`:return a=i.pointerId,Jt.set(a,Qt(Jt.get(a)||null,e,t,n,r,i)),!0}return!1}function en(e){var t=Mi(e.target);if(t!==null){var n=tt(t);if(n!==null){if(t=n.tag,t===13){if(t=nt(n),t!==null){e.blockedOn=t,Vt(e.priority,function(){zt(n)});return}}else if(t===3&&n.stateNode.current.memoizedState.isDehydrated){e.blockedOn=n.tag===3?n.stateNode.containerInfo:null;return}}}e.blockedOn=null}function tn(e){if(e.blockedOn!==null)return!1;for(var t=e.targetContainers;0<t.length;){var n=pn(e.domEventName,e.eventSystemFlags,t[0],e.nativeEvent);if(n===null){n=e.nativeEvent;var r=new n.constructor(n.type,n);Ve=r,n.target.dispatchEvent(r),Ve=null}else return t=Ni(n),t!==null&&Rt(t),e.blockedOn=n,!1;t.shift()}return!0}function nn(e,t,n){tn(e)&&n.delete(t)}function rn(){Ht=!1,Wt!==null&&tn(Wt)&&(Wt=null),Gt!==null&&tn(Gt)&&(Gt=null),Kt!==null&&tn(Kt)&&(Kt=null),qt.forEach(nn),Jt.forEach(nn)}function an(e,t){e.blockedOn===t&&(e.blockedOn=null,Ht||(Ht=!0,n.unstable_scheduleCallback(n.unstable_NormalPriority,rn)))}function on(e){function t(t){return an(t,e)}if(0<Ut.length){an(Ut[0],e);for(var n=1;n<Ut.length;n++){var r=Ut[n];r.blockedOn===e&&(r.blockedOn=null)}}for(Wt!==null&&an(Wt,e),Gt!==null&&an(Gt,e),Kt!==null&&an(Kt,e),qt.forEach(t),Jt.forEach(t),n=0;n<Yt.length;n++)r=Yt[n],r.blockedOn===e&&(r.blockedOn=null);for(;0<Yt.length&&(n=Yt[0],n.blockedOn===null);)en(n),n.blockedOn===null&&Yt.shift()}var sn=x.ReactCurrentBatchConfig,cn=!0;function ln(e,t,n,r){var i=K,a=sn.transition;sn.transition=null;try{K=1,dn(e,t,n,r)}finally{K=i,sn.transition=a}}function un(e,t,n,r){var i=K,a=sn.transition;sn.transition=null;try{K=4,dn(e,t,n,r)}finally{K=i,sn.transition=a}}function dn(e,t,n,r){if(cn){var i=pn(e,t,n,r);if(i===null)ii(e,t,r,fn,n),Zt(e,r);else if($t(i,e,t,n,r))r.stopPropagation();else if(Zt(e,r),t&4&&-1<Xt.indexOf(e)){for(;i!==null;){var a=Ni(i);if(a!==null&&Lt(a),a=pn(e,t,n,r),a===null&&ii(e,t,r,fn,n),a===i)break;i=a}i!==null&&r.stopPropagation()}else ii(e,t,r,null,n)}}var fn=null;function pn(e,t,n,r){if(fn=null,e=He(r),e=Mi(e),e!==null)if(t=tt(e),t===null)e=null;else if(n=t.tag,n===13){if(e=nt(t),e!==null)return e;e=null}else if(n===3){if(t.stateNode.current.memoizedState.isDehydrated)return t.tag===3?t.stateNode.containerInfo:null;e=null}else t!==e&&(e=null);return fn=e,null}function mn(e){switch(e){case`cancel`:case`click`:case`close`:case`contextmenu`:case`copy`:case`cut`:case`auxclick`:case`dblclick`:case`dragend`:case`dragstart`:case`drop`:case`focusin`:case`focusout`:case`input`:case`invalid`:case`keydown`:case`keypress`:case`keyup`:case`mousedown`:case`mouseup`:case`paste`:case`pause`:case`play`:case`pointercancel`:case`pointerdown`:case`pointerup`:case`ratechange`:case`reset`:case`resize`:case`seeked`:case`submit`:case`touchcancel`:case`touchend`:case`touchstart`:case`volumechange`:case`change`:case`selectionchange`:case`textInput`:case`compositionstart`:case`compositionend`:case`compositionupdate`:case`beforeblur`:case`afterblur`:case`beforeinput`:case`blur`:case`fullscreenchange`:case`focus`:case`hashchange`:case`popstate`:case`select`:case`selectstart`:return 1;case`drag`:case`dragenter`:case`dragexit`:case`dragleave`:case`dragover`:case`mousemove`:case`mouseout`:case`mouseover`:case`pointermove`:case`pointerout`:case`pointerover`:case`scroll`:case`toggle`:case`touchmove`:case`wheel`:case`mouseenter`:case`mouseleave`:case`pointerenter`:case`pointerleave`:return 4;case`message`:switch(dt()){case ft:return 1;case pt:return 4;case mt:case ht:return 16;case gt:return 536870912;default:return 16}default:return 16}}var hn=null,gn=null,_n=null;function vn(){if(_n)return _n;var e,t=gn,n=t.length,r,i=`value`in hn?hn.value:hn.textContent,a=i.length;for(e=0;e<n&&t[e]===i[e];e++);var o=n-e;for(r=1;r<=o&&t[n-r]===i[a-r];r++);return _n=i.slice(e,1<r?1-r:void 0)}function yn(e){var t=e.keyCode;return`charCode`in e?(e=e.charCode,e===0&&t===13&&(e=13)):e=t,e===10&&(e=13),32<=e||e===13?e:0}function bn(){return!0}function xn(){return!1}function Sn(e){function t(t,n,r,i,a){for(var o in this._reactName=t,this._targetInst=r,this.type=n,this.nativeEvent=i,this.target=a,this.currentTarget=null,e)e.hasOwnProperty(o)&&(t=e[o],this[o]=t?t(i):i[o]);return this.isDefaultPrevented=(i.defaultPrevented==null?!1===i.returnValue:i.defaultPrevented)?bn:xn,this.isPropagationStopped=xn,this}return O(t.prototype,{preventDefault:function(){this.defaultPrevented=!0;var e=this.nativeEvent;e&&(e.preventDefault?e.preventDefault():typeof e.returnValue!=`unknown`&&(e.returnValue=!1),this.isDefaultPrevented=bn)},stopPropagation:function(){var e=this.nativeEvent;e&&(e.stopPropagation?e.stopPropagation():typeof e.cancelBubble!=`unknown`&&(e.cancelBubble=!0),this.isPropagationStopped=bn)},persist:function(){},isPersistent:bn}),t}var Cn={eventPhase:0,bubbles:0,cancelable:0,timeStamp:function(e){return e.timeStamp||Date.now()},defaultPrevented:0,isTrusted:0},wn=Sn(Cn),Tn=O({},Cn,{view:0,detail:0}),En=Sn(Tn),Dn,On,kn,An=O({},Tn,{screenX:0,screenY:0,clientX:0,clientY:0,pageX:0,pageY:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,getModifierState:Vn,button:0,buttons:0,relatedTarget:function(e){return e.relatedTarget===void 0?e.fromElement===e.srcElement?e.toElement:e.fromElement:e.relatedTarget},movementX:function(e){return`movementX`in e?e.movementX:(e!==kn&&(kn&&e.type===`mousemove`?(Dn=e.screenX-kn.screenX,On=e.screenY-kn.screenY):On=Dn=0,kn=e),Dn)},movementY:function(e){return`movementY`in e?e.movementY:On}}),jn=Sn(An),Mn=Sn(O({},An,{dataTransfer:0})),Nn=Sn(O({},Tn,{relatedTarget:0})),Pn=Sn(O({},Cn,{animationName:0,elapsedTime:0,pseudoElement:0})),Fn=Sn(O({},Cn,{clipboardData:function(e){return`clipboardData`in e?e.clipboardData:window.clipboardData}})),In=Sn(O({},Cn,{data:0})),Ln={Esc:`Escape`,Spacebar:` `,Left:`ArrowLeft`,Up:`ArrowUp`,Right:`ArrowRight`,Down:`ArrowDown`,Del:`Delete`,Win:`OS`,Menu:`ContextMenu`,Apps:`ContextMenu`,Scroll:`ScrollLock`,MozPrintableKey:`Unidentified`},Rn={8:`Backspace`,9:`Tab`,12:`Clear`,13:`Enter`,16:`Shift`,17:`Control`,18:`Alt`,19:`Pause`,20:`CapsLock`,27:`Escape`,32:` `,33:`PageUp`,34:`PageDown`,35:`End`,36:`Home`,37:`ArrowLeft`,38:`ArrowUp`,39:`ArrowRight`,40:`ArrowDown`,45:`Insert`,46:`Delete`,112:`F1`,113:`F2`,114:`F3`,115:`F4`,116:`F5`,117:`F6`,118:`F7`,119:`F8`,120:`F9`,121:`F10`,122:`F11`,123:`F12`,144:`NumLock`,145:`ScrollLock`,224:`Meta`},zn={Alt:`altKey`,Control:`ctrlKey`,Meta:`metaKey`,Shift:`shiftKey`};function Bn(e){var t=this.nativeEvent;return t.getModifierState?t.getModifierState(e):(e=zn[e])?!!t[e]:!1}function Vn(){return Bn}var Hn=Sn(O({},Tn,{key:function(e){if(e.key){var t=Ln[e.key]||e.key;if(t!==`Unidentified`)return t}return e.type===`keypress`?(e=yn(e),e===13?`Enter`:String.fromCharCode(e)):e.type===`keydown`||e.type===`keyup`?Rn[e.keyCode]||`Unidentified`:``},code:0,location:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,repeat:0,locale:0,getModifierState:Vn,charCode:function(e){return e.type===`keypress`?yn(e):0},keyCode:function(e){return e.type===`keydown`||e.type===`keyup`?e.keyCode:0},which:function(e){return e.type===`keypress`?yn(e):e.type===`keydown`||e.type===`keyup`?e.keyCode:0}})),Un=Sn(O({},An,{pointerId:0,width:0,height:0,pressure:0,tangentialPressure:0,tiltX:0,tiltY:0,twist:0,pointerType:0,isPrimary:0})),Wn=Sn(O({},Tn,{touches:0,targetTouches:0,changedTouches:0,altKey:0,metaKey:0,ctrlKey:0,shiftKey:0,getModifierState:Vn})),Gn=Sn(O({},Cn,{propertyName:0,elapsedTime:0,pseudoElement:0})),Kn=Sn(O({},An,{deltaX:function(e){return`deltaX`in e?e.deltaX:`wheelDeltaX`in e?-e.wheelDeltaX:0},deltaY:function(e){return`deltaY`in e?e.deltaY:`wheelDeltaY`in e?-e.wheelDeltaY:`wheelDelta`in e?-e.wheelDelta:0},deltaZ:0,deltaMode:0})),qn=[9,13,27,32],Jn=c&&`CompositionEvent`in window,Yn=null;c&&`documentMode`in document&&(Yn=document.documentMode);var Xn=c&&`TextEvent`in window&&!Yn,Zn=c&&(!Jn||Yn&&8<Yn&&11>=Yn),Qn=` `,$n=!1;function er(e,t){switch(e){case`keyup`:return qn.indexOf(t.keyCode)!==-1;case`keydown`:return t.keyCode!==229;case`keypress`:case`mousedown`:case`focusout`:return!0;default:return!1}}function tr(e){return e=e.detail,typeof e==`object`&&`data`in e?e.data:null}var nr=!1;function rr(e,t){switch(e){case`compositionend`:return tr(t);case`keypress`:return t.which===32?($n=!0,Qn):null;case`textInput`:return e=t.data,e===Qn&&$n?null:e;default:return null}}function ir(e,t){if(nr)return e===`compositionend`||!Jn&&er(e,t)?(e=vn(),_n=gn=hn=null,nr=!1,e):null;switch(e){case`paste`:return null;case`keypress`:if(!(t.ctrlKey||t.altKey||t.metaKey)||t.ctrlKey&&t.altKey){if(t.char&&1<t.char.length)return t.char;if(t.which)return String.fromCharCode(t.which)}return null;case`compositionend`:return Zn&&t.locale!==`ko`?null:t.data;default:return null}}var ar={color:!0,date:!0,datetime:!0,"datetime-local":!0,email:!0,month:!0,number:!0,password:!0,range:!0,search:!0,tel:!0,text:!0,time:!0,url:!0,week:!0};function or(e){var t=e&&e.nodeName&&e.nodeName.toLowerCase();return t===`input`?!!ar[e.type]:t===`textarea`}function sr(e,t,n,r){z(r),t=oi(t,`onChange`),0<t.length&&(n=new wn(`onChange`,`change`,null,n,r),e.push({event:n,listeners:t}))}var cr=null,lr=null;function ur(e){$r(e,0)}function dr(e){if(ve(Pi(e)))return e}function fr(e,t){if(e===`change`)return t}var pr=!1;if(c){var mr;if(c){var hr=`oninput`in document;if(!hr){var gr=document.createElement(`div`);gr.setAttribute(`oninput`,`return;`),hr=typeof gr.oninput==`function`}mr=hr}else mr=!1;pr=mr&&(!document.documentMode||9<document.documentMode)}function _r(){cr&&(cr.detachEvent(`onpropertychange`,vr),lr=cr=null)}function vr(e){if(e.propertyName===`value`&&dr(lr)){var t=[];sr(t,lr,e,He(e)),qe(ur,t)}}function yr(e,t,n){e===`focusin`?(_r(),cr=t,lr=n,cr.attachEvent(`onpropertychange`,vr)):e===`focusout`&&_r()}function br(e){if(e===`selectionchange`||e===`keyup`||e===`keydown`)return dr(lr)}function xr(e,t){if(e===`click`)return dr(t)}function Sr(e,t){if(e===`input`||e===`change`)return dr(t)}function Cr(e,t){return e===t&&(e!==0||1/e==1/t)||e!==e&&t!==t}var wr=typeof Object.is==`function`?Object.is:Cr;function Tr(e,t){if(wr(e,t))return!0;if(typeof e!=`object`||!e||typeof t!=`object`||!t)return!1;var n=Object.keys(e),r=Object.keys(t);if(n.length!==r.length)return!1;for(r=0;r<n.length;r++){var i=n[r];if(!l.call(t,i)||!wr(e[i],t[i]))return!1}return!0}function Er(e){for(;e&&e.firstChild;)e=e.firstChild;return e}function Dr(e,t){var n=Er(e);e=0;for(var r;n;){if(n.nodeType===3){if(r=e+n.textContent.length,e<=t&&r>=t)return{node:n,offset:t-e};e=r}a:{for(;n;){if(n.nextSibling){n=n.nextSibling;break a}n=n.parentNode}n=void 0}n=Er(n)}}function q(e,t){return e&&t?e===t?!0:e&&e.nodeType===3?!1:t&&t.nodeType===3?q(e,t.parentNode):`contains`in e?e.contains(t):e.compareDocumentPosition?!!(e.compareDocumentPosition(t)&16):!1:!1}function Or(){for(var e=window,t=ye();t instanceof e.HTMLIFrameElement;){try{var n=typeof t.contentWindow.location.href==`string`}catch{n=!1}if(n)e=t.contentWindow;else break;t=ye(e.document)}return t}function kr(e){var t=e&&e.nodeName&&e.nodeName.toLowerCase();return t&&(t===`input`&&(e.type===`text`||e.type===`search`||e.type===`tel`||e.type===`url`||e.type===`password`)||t===`textarea`||e.contentEditable===`true`)}function Ar(e){var t=Or(),n=e.focusedElem,r=e.selectionRange;if(t!==n&&n&&n.ownerDocument&&q(n.ownerDocument.documentElement,n)){if(r!==null&&kr(n)){if(t=r.start,e=r.end,e===void 0&&(e=t),`selectionStart`in n)n.selectionStart=t,n.selectionEnd=Math.min(e,n.value.length);else if(e=(t=n.ownerDocument||document)&&t.defaultView||window,e.getSelection){e=e.getSelection();var i=n.textContent.length,a=Math.min(r.start,i);r=r.end===void 0?a:Math.min(r.end,i),!e.extend&&a>r&&(i=r,r=a,a=i),i=Dr(n,a);var o=Dr(n,r);i&&o&&(e.rangeCount!==1||e.anchorNode!==i.node||e.anchorOffset!==i.offset||e.focusNode!==o.node||e.focusOffset!==o.offset)&&(t=t.createRange(),t.setStart(i.node,i.offset),e.removeAllRanges(),a>r?(e.addRange(t),e.extend(o.node,o.offset)):(t.setEnd(o.node,o.offset),e.addRange(t)))}}for(t=[],e=n;e=e.parentNode;)e.nodeType===1&&t.push({element:e,left:e.scrollLeft,top:e.scrollTop});for(typeof n.focus==`function`&&n.focus(),n=0;n<t.length;n++)e=t[n],e.element.scrollLeft=e.left,e.element.scrollTop=e.top}}var J=c&&`documentMode`in document&&11>=document.documentMode,jr=null,Mr=null,Nr=null,Pr=!1;function Fr(e,t,n){var r=n.window===n?n.document:n.nodeType===9?n:n.ownerDocument;Pr||jr==null||jr!==ye(r)||(r=jr,`selectionStart`in r&&kr(r)?r={start:r.selectionStart,end:r.selectionEnd}:(r=(r.ownerDocument&&r.ownerDocument.defaultView||window).getSelection(),r={anchorNode:r.anchorNode,anchorOffset:r.anchorOffset,focusNode:r.focusNode,focusOffset:r.focusOffset}),Nr&&Tr(Nr,r)||(Nr=r,r=oi(Mr,`onSelect`),0<r.length&&(t=new wn(`onSelect`,`select`,null,t,n),e.push({event:t,listeners:r}),t.target=jr)))}function Ir(e,t){var n={};return n[e.toLowerCase()]=t.toLowerCase(),n[`Webkit`+e]=`webkit`+t,n[`Moz`+e]=`moz`+t,n}var Lr={animationend:Ir(`Animation`,`AnimationEnd`),animationiteration:Ir(`Animation`,`AnimationIteration`),animationstart:Ir(`Animation`,`AnimationStart`),transitionend:Ir(`Transition`,`TransitionEnd`)},Rr={},zr={};c&&(zr=document.createElement(`div`).style,`AnimationEvent`in window||(delete Lr.animationend.animation,delete Lr.animationiteration.animation,delete Lr.animationstart.animation),`TransitionEvent`in window||delete Lr.transitionend.transition);function Br(e){if(Rr[e])return Rr[e];if(!Lr[e])return e;var t=Lr[e],n;for(n in t)if(t.hasOwnProperty(n)&&n in zr)return Rr[e]=t[n];return e}var Vr=Br(`animationend`),Hr=Br(`animationiteration`),Ur=Br(`animationstart`),Wr=Br(`transitionend`),Gr=new Map,Kr=`abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel`.split(` `);function qr(e,t){Gr.set(e,t),o(t,[e])}for(var Jr=0;Jr<Kr.length;Jr++){var Yr=Kr[Jr];qr(Yr.toLowerCase(),`on`+(Yr[0].toUpperCase()+Yr.slice(1)))}qr(Vr,`onAnimationEnd`),qr(Hr,`onAnimationIteration`),qr(Ur,`onAnimationStart`),qr(`dblclick`,`onDoubleClick`),qr(`focusin`,`onFocus`),qr(`focusout`,`onBlur`),qr(Wr,`onTransitionEnd`),s(`onMouseEnter`,[`mouseout`,`mouseover`]),s(`onMouseLeave`,[`mouseout`,`mouseover`]),s(`onPointerEnter`,[`pointerout`,`pointerover`]),s(`onPointerLeave`,[`pointerout`,`pointerover`]),o(`onChange`,`change click focusin focusout input keydown keyup selectionchange`.split(` `)),o(`onSelect`,`focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange`.split(` `)),o(`onBeforeInput`,[`compositionend`,`keypress`,`textInput`,`paste`]),o(`onCompositionEnd`,`compositionend focusout keydown keypress keyup mousedown`.split(` `)),o(`onCompositionStart`,`compositionstart focusout keydown keypress keyup mousedown`.split(` `)),o(`onCompositionUpdate`,`compositionupdate focusout keydown keypress keyup mousedown`.split(` `));var Xr=`abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting`.split(` `),Zr=new Set(`cancel close invalid load scroll toggle`.split(` `).concat(Xr));function Qr(e,t,n){var r=e.type||`unknown-event`;e.currentTarget=n,et(r,t,void 0,e),e.currentTarget=null}function $r(e,t){t=(t&4)!=0;for(var n=0;n<e.length;n++){var r=e[n],i=r.event;r=r.listeners;a:{var a=void 0;if(t)for(var o=r.length-1;0<=o;o--){var s=r[o],c=s.instance,l=s.currentTarget;if(s=s.listener,c!==a&&i.isPropagationStopped())break a;Qr(i,s,l),a=c}else for(o=0;o<r.length;o++){if(s=r[o],c=s.instance,l=s.currentTarget,s=s.listener,c!==a&&i.isPropagationStopped())break a;Qr(i,s,l),a=c}}}if(Ze)throw e=Qe,Ze=!1,Qe=null,e}function Y(e,t){var n=t[ki];n===void 0&&(n=t[ki]=new Set);var r=e+`__bubble`;n.has(r)||(ri(t,e,2,!1),n.add(r))}function ei(e,t,n){var r=0;t&&(r|=4),ri(n,e,r,t)}var ti=`_reactListening`+Math.random().toString(36).slice(2);function ni(e){if(!e[ti]){e[ti]=!0,i.forEach(function(t){t!==`selectionchange`&&(Zr.has(t)||ei(t,!1,e),ei(t,!0,e))});var t=e.nodeType===9?e:e.ownerDocument;t===null||t[ti]||(t[ti]=!0,ei(`selectionchange`,!1,t))}}function ri(e,t,n,r){switch(mn(t)){case 1:var i=ln;break;case 4:i=un;break;default:i=dn}n=i.bind(null,t,n,e),i=void 0,!H||t!==`touchstart`&&t!==`touchmove`&&t!==`wheel`||(i=!0),r?i===void 0?e.addEventListener(t,n,!0):e.addEventListener(t,n,{capture:!0,passive:i}):i===void 0?e.addEventListener(t,n,!1):e.addEventListener(t,n,{passive:i})}function ii(e,t,n,r,i){var a=r;if(!(t&1)&&!(t&2)&&r!==null)a:for(;;){if(r===null)return;var o=r.tag;if(o===3||o===4){var s=r.stateNode.containerInfo;if(s===i||s.nodeType===8&&s.parentNode===i)break;if(o===4)for(o=r.return;o!==null;){var c=o.tag;if((c===3||c===4)&&(c=o.stateNode.containerInfo,c===i||c.nodeType===8&&c.parentNode===i))return;o=o.return}for(;s!==null;){if(o=Mi(s),o===null)return;if(c=o.tag,c===5||c===6){r=a=o;continue a}s=s.parentNode}}r=r.return}qe(function(){var r=a,i=He(n),o=[];a:{var s=Gr.get(e);if(s!==void 0){var c=wn,l=e;switch(e){case`keypress`:if(yn(n)===0)break a;case`keydown`:case`keyup`:c=Hn;break;case`focusin`:l=`focus`,c=Nn;break;case`focusout`:l=`blur`,c=Nn;break;case`beforeblur`:case`afterblur`:c=Nn;break;case`click`:if(n.button===2)break a;case`auxclick`:case`dblclick`:case`mousedown`:case`mousemove`:case`mouseup`:case`mouseout`:case`mouseover`:case`contextmenu`:c=jn;break;case`drag`:case`dragend`:case`dragenter`:case`dragexit`:case`dragleave`:case`dragover`:case`dragstart`:case`drop`:c=Mn;break;case`touchcancel`:case`touchend`:case`touchmove`:case`touchstart`:c=Wn;break;case Vr:case Hr:case Ur:c=Pn;break;case Wr:c=Gn;break;case`scroll`:c=En;break;case`wheel`:c=Kn;break;case`copy`:case`cut`:case`paste`:c=Fn;break;case`gotpointercapture`:case`lostpointercapture`:case`pointercancel`:case`pointerdown`:case`pointermove`:case`pointerout`:case`pointerover`:case`pointerup`:c=Un}var u=(t&4)!=0,d=!u&&e===`scroll`,f=u?s===null?null:s+`Capture`:s;u=[];for(var p=r,m;p!==null;){m=p;var h=m.stateNode;if(m.tag===5&&h!==null&&(m=h,f!==null&&(h=V(p,f),h!=null&&u.push(ai(p,h,m)))),d)break;p=p.return}0<u.length&&(s=new c(s,l,null,n,i),o.push({event:s,listeners:u}))}}if(!(t&7)){a:{if(s=e===`mouseover`||e===`pointerover`,c=e===`mouseout`||e===`pointerout`,s&&n!==Ve&&(l=n.relatedTarget||n.fromElement)&&(Mi(l)||l[Oi]))break a;if((c||s)&&(s=i.window===i?i:(s=i.ownerDocument)?s.defaultView||s.parentWindow:window,c?(l=n.relatedTarget||n.toElement,c=r,l=l?Mi(l):null,l!==null&&(d=tt(l),l!==d||l.tag!==5&&l.tag!==6)&&(l=null)):(c=null,l=r),c!==l)){if(u=jn,h=`onMouseLeave`,f=`onMouseEnter`,p=`mouse`,(e===`pointerout`||e===`pointerover`)&&(u=Un,h=`onPointerLeave`,f=`onPointerEnter`,p=`pointer`),d=c==null?s:Pi(c),m=l==null?s:Pi(l),s=new u(h,p+`leave`,c,n,i),s.target=d,s.relatedTarget=m,h=null,Mi(i)===r&&(u=new u(f,p+`enter`,l,n,i),u.target=m,u.relatedTarget=d,h=u),d=h,c&&l)b:{for(u=c,f=l,p=0,m=u;m;m=si(m))p++;for(m=0,h=f;h;h=si(h))m++;for(;0<p-m;)u=si(u),p--;for(;0<m-p;)f=si(f),m--;for(;p--;){if(u===f||f!==null&&u===f.alternate)break b;u=si(u),f=si(f)}u=null}else u=null;c!==null&&ci(o,s,c,u,!1),l!==null&&d!==null&&ci(o,d,l,u,!0)}}a:{if(s=r?Pi(r):window,c=s.nodeName&&s.nodeName.toLowerCase(),c===`select`||c===`input`&&s.type===`file`)var g=fr;else if(or(s))if(pr)g=Sr;else{g=br;var _=yr}else(c=s.nodeName)&&c.toLowerCase()===`input`&&(s.type===`checkbox`||s.type===`radio`)&&(g=xr);if(g&&=g(e,r)){sr(o,g,n,i);break a}_&&_(e,s,r),e===`focusout`&&(_=s._wrapperState)&&_.controlled&&s.type===`number`&&Ce(s,`number`,s.value)}switch(_=r?Pi(r):window,e){case`focusin`:(or(_)||_.contentEditable===`true`)&&(jr=_,Mr=r,Nr=null);break;case`focusout`:Nr=Mr=jr=null;break;case`mousedown`:Pr=!0;break;case`contextmenu`:case`mouseup`:case`dragend`:Pr=!1,Fr(o,n,i);break;case`selectionchange`:if(J)break;case`keydown`:case`keyup`:Fr(o,n,i)}var v;if(Jn)b:{switch(e){case`compositionstart`:var y=`onCompositionStart`;break b;case`compositionend`:y=`onCompositionEnd`;break b;case`compositionupdate`:y=`onCompositionUpdate`;break b}y=void 0}else nr?er(e,n)&&(y=`onCompositionEnd`):e===`keydown`&&n.keyCode===229&&(y=`onCompositionStart`);y&&(Zn&&n.locale!==`ko`&&(nr||y!==`onCompositionStart`?y===`onCompositionEnd`&&nr&&(v=vn()):(hn=i,gn=`value`in hn?hn.value:hn.textContent,nr=!0)),_=oi(r,y),0<_.length&&(y=new In(y,e,null,n,i),o.push({event:y,listeners:_}),v?y.data=v:(v=tr(n),v!==null&&(y.data=v)))),(v=Xn?rr(e,n):ir(e,n))&&(r=oi(r,`onBeforeInput`),0<r.length&&(i=new In(`onBeforeInput`,`beforeinput`,null,n,i),o.push({event:i,listeners:r}),i.data=v))}$r(o,t)})}function ai(e,t,n){return{instance:e,listener:t,currentTarget:n}}function oi(e,t){for(var n=t+`Capture`,r=[];e!==null;){var i=e,a=i.stateNode;i.tag===5&&a!==null&&(i=a,a=V(e,n),a!=null&&r.unshift(ai(e,a,i)),a=V(e,t),a!=null&&r.push(ai(e,a,i))),e=e.return}return r}function si(e){if(e===null)return null;do e=e.return;while(e&&e.tag!==5);return e||null}function ci(e,t,n,r,i){for(var a=t._reactName,o=[];n!==null&&n!==r;){var s=n,c=s.alternate,l=s.stateNode;if(c!==null&&c===r)break;s.tag===5&&l!==null&&(s=l,i?(c=V(n,a),c!=null&&o.unshift(ai(n,c,s))):i||(c=V(n,a),c!=null&&o.push(ai(n,c,s)))),n=n.return}o.length!==0&&e.push({event:t,listeners:o})}var li=/\r\n?/g,ui=/\u0000|\uFFFD/g;function di(e){return(typeof e==`string`?e:``+e).replace(li,`
`).replace(ui,``)}function fi(e,t,n){if(t=di(t),di(e)!==t&&n)throw Error(r(425))}function pi(){}var mi=null,hi=null;function gi(e,t){return e===`textarea`||e===`noscript`||typeof t.children==`string`||typeof t.children==`number`||typeof t.dangerouslySetInnerHTML==`object`&&t.dangerouslySetInnerHTML!==null&&t.dangerouslySetInnerHTML.__html!=null}var _i=typeof setTimeout==`function`?setTimeout:void 0,vi=typeof clearTimeout==`function`?clearTimeout:void 0,yi=typeof Promise==`function`?Promise:void 0,bi=typeof queueMicrotask==`function`?queueMicrotask:yi===void 0?_i:function(e){return yi.resolve(null).then(e).catch(xi)};function xi(e){setTimeout(function(){throw e})}function Si(e,t){var n=t,r=0;do{var i=n.nextSibling;if(e.removeChild(n),i&&i.nodeType===8)if(n=i.data,n===`/$`){if(r===0){e.removeChild(i),on(t);return}r--}else n!==`$`&&n!==`$?`&&n!==`$!`||r++;n=i}while(n);on(t)}function Ci(e){for(;e!=null;e=e.nextSibling){var t=e.nodeType;if(t===1||t===3)break;if(t===8){if(t=e.data,t===`$`||t===`$!`||t===`$?`)break;if(t===`/$`)return null}}return e}function wi(e){e=e.previousSibling;for(var t=0;e;){if(e.nodeType===8){var n=e.data;if(n===`$`||n===`$!`||n===`$?`){if(t===0)return e;t--}else n===`/$`&&t++}e=e.previousSibling}return null}var Ti=Math.random().toString(36).slice(2),Ei=`__reactFiber$`+Ti,Di=`__reactProps$`+Ti,Oi=`__reactContainer$`+Ti,ki=`__reactEvents$`+Ti,Ai=`__reactListeners$`+Ti,ji=`__reactHandles$`+Ti;function Mi(e){var t=e[Ei];if(t)return t;for(var n=e.parentNode;n;){if(t=n[Oi]||n[Ei]){if(n=t.alternate,t.child!==null||n!==null&&n.child!==null)for(e=wi(e);e!==null;){if(n=e[Ei])return n;e=wi(e)}return t}e=n,n=e.parentNode}return null}function Ni(e){return e=e[Ei]||e[Oi],!e||e.tag!==5&&e.tag!==6&&e.tag!==13&&e.tag!==3?null:e}function Pi(e){if(e.tag===5||e.tag===6)return e.stateNode;throw Error(r(33))}function Fi(e){return e[Di]||null}var Ii=[],Li=-1;function Ri(e){return{current:e}}function X(e){0>Li||(e.current=Ii[Li],Ii[Li]=null,Li--)}function Z(e,t){Li++,Ii[Li]=e.current,e.current=t}var zi={},Bi=Ri(zi),Vi=Ri(!1),Hi=zi;function Ui(e,t){var n=e.type.contextTypes;if(!n)return zi;var r=e.stateNode;if(r&&r.__reactInternalMemoizedUnmaskedChildContext===t)return r.__reactInternalMemoizedMaskedChildContext;var i={},a;for(a in n)i[a]=t[a];return r&&(e=e.stateNode,e.__reactInternalMemoizedUnmaskedChildContext=t,e.__reactInternalMemoizedMaskedChildContext=i),i}function Wi(e){return e=e.childContextTypes,e!=null}function Gi(){X(Vi),X(Bi)}function Ki(e,t,n){if(Bi.current!==zi)throw Error(r(168));Z(Bi,t),Z(Vi,n)}function qi(e,t,n){var i=e.stateNode;if(t=t.childContextTypes,typeof i.getChildContext!=`function`)return n;for(var a in i=i.getChildContext(),i)if(!(a in t))throw Error(r(108,he(e)||`Unknown`,a));return O({},n,i)}function Ji(e){return e=(e=e.stateNode)&&e.__reactInternalMemoizedMergedChildContext||zi,Hi=Bi.current,Z(Bi,e),Z(Vi,Vi.current),!0}function Yi(e,t,n){var i=e.stateNode;if(!i)throw Error(r(169));n?(e=qi(e,t,Hi),i.__reactInternalMemoizedMergedChildContext=e,X(Vi),X(Bi),Z(Bi,e)):X(Vi),Z(Vi,n)}var Xi=null,Zi=!1,Qi=!1;function $i(e){Xi===null?Xi=[e]:Xi.push(e)}function ea(e){Zi=!0,$i(e)}function ta(){if(!Qi&&Xi!==null){Qi=!0;var e=0,t=K;try{var n=Xi;for(K=1;e<n.length;e++){var r=n[e];do r=r(!0);while(r!==null)}Xi=null,Zi=!1}catch(t){throw Xi!==null&&(Xi=Xi.slice(e+1)),ot(ft,ta),t}finally{K=t,Qi=!1}}return null}var na=[],ra=0,ia=null,aa=0,oa=[],sa=0,ca=null,la=1,ua=``;function da(e,t){na[ra++]=aa,na[ra++]=ia,ia=e,aa=t}function fa(e,t,n){oa[sa++]=la,oa[sa++]=ua,oa[sa++]=ca,ca=e;var r=la;e=ua;var i=32-bt(r)-1;r&=~(1<<i),n+=1;var a=32-bt(t)+i;if(30<a){var o=i-i%5;a=(r&(1<<o)-1).toString(32),r>>=o,i-=o,la=1<<32-bt(t)+i|n<<i|r,ua=a+e}else la=1<<a|n<<i|r,ua=e}function pa(e){e.return!==null&&(da(e,1),fa(e,1,0))}function ma(e){for(;e===ia;)ia=na[--ra],na[ra]=null,aa=na[--ra],na[ra]=null;for(;e===ca;)ca=oa[--sa],oa[sa]=null,ua=oa[--sa],oa[sa]=null,la=oa[--sa],oa[sa]=null}var ha=null,ga=null,_a=!1,va=null;function ya(e,t){var n=Kl(5,null,null,0);n.elementType=`DELETED`,n.stateNode=t,n.return=e,t=e.deletions,t===null?(e.deletions=[n],e.flags|=16):t.push(n)}function ba(e,t){switch(e.tag){case 5:var n=e.type;return t=t.nodeType!==1||n.toLowerCase()!==t.nodeName.toLowerCase()?null:t,t===null?!1:(e.stateNode=t,ha=e,ga=Ci(t.firstChild),!0);case 6:return t=e.pendingProps===``||t.nodeType!==3?null:t,t===null?!1:(e.stateNode=t,ha=e,ga=null,!0);case 13:return t=t.nodeType===8?t:null,t===null?!1:(n=ca===null?null:{id:la,overflow:ua},e.memoizedState={dehydrated:t,treeContext:n,retryLane:1073741824},n=Kl(18,null,null,0),n.stateNode=t,n.return=e,e.child=n,ha=e,ga=null,!0);default:return!1}}function xa(e){return(e.mode&1)!=0&&(e.flags&128)==0}function Sa(e){if(_a){var t=ga;if(t){var n=t;if(!ba(e,t)){if(xa(e))throw Error(r(418));t=Ci(n.nextSibling);var i=ha;t&&ba(e,t)?ya(i,n):(e.flags=e.flags&-4097|2,_a=!1,ha=e)}}else{if(xa(e))throw Error(r(418));e.flags=e.flags&-4097|2,_a=!1,ha=e}}}function Ca(e){for(e=e.return;e!==null&&e.tag!==5&&e.tag!==3&&e.tag!==13;)e=e.return;ha=e}function wa(e){if(e!==ha)return!1;if(!_a)return Ca(e),_a=!0,!1;var t;if((t=e.tag!==3)&&!(t=e.tag!==5)&&(t=e.type,t=t!==`head`&&t!==`body`&&!gi(e.type,e.memoizedProps)),t&&=ga){if(xa(e))throw Ta(),Error(r(418));for(;t;)ya(e,t),t=Ci(t.nextSibling)}if(Ca(e),e.tag===13){if(e=e.memoizedState,e=e===null?null:e.dehydrated,!e)throw Error(r(317));a:{for(e=e.nextSibling,t=0;e;){if(e.nodeType===8){var n=e.data;if(n===`/$`){if(t===0){ga=Ci(e.nextSibling);break a}t--}else n!==`$`&&n!==`$!`&&n!==`$?`||t++}e=e.nextSibling}ga=null}}else ga=ha?Ci(e.stateNode.nextSibling):null;return!0}function Ta(){for(var e=ga;e;)e=Ci(e.nextSibling)}function Ea(){ga=ha=null,_a=!1}function Da(e){va===null?va=[e]:va.push(e)}var Oa=x.ReactCurrentBatchConfig;function ka(e,t,n){if(e=n.ref,e!==null&&typeof e!=`function`&&typeof e!=`object`){if(n._owner){if(n=n._owner,n){if(n.tag!==1)throw Error(r(309));var i=n.stateNode}if(!i)throw Error(r(147,e));var a=i,o=``+e;return t!==null&&t.ref!==null&&typeof t.ref==`function`&&t.ref._stringRef===o?t.ref:(t=function(e){var t=a.refs;e===null?delete t[o]:t[o]=e},t._stringRef=o,t)}if(typeof e!=`string`)throw Error(r(284));if(!n._owner)throw Error(r(290,e))}return e}function Aa(e,t){throw e=Object.prototype.toString.call(t),Error(r(31,e===`[object Object]`?`object with keys {`+Object.keys(t).join(`, `)+`}`:e))}function ja(e){var t=e._init;return t(e._payload)}function Ma(e){function t(t,n){if(e){var r=t.deletions;r===null?(t.deletions=[n],t.flags|=16):r.push(n)}}function n(n,r){if(!e)return null;for(;r!==null;)t(n,r),r=r.sibling;return null}function i(e,t){for(e=new Map;t!==null;)t.key===null?e.set(t.index,t):e.set(t.key,t),t=t.sibling;return e}function a(e,t){return e=Yl(e,t),e.index=0,e.sibling=null,e}function o(t,n,r){return t.index=r,e?(r=t.alternate,r===null?(t.flags|=2,n):(r=r.index,r<n?(t.flags|=2,n):r)):(t.flags|=1048576,n)}function s(t){return e&&t.alternate===null&&(t.flags|=2),t}function c(e,t,n,r){return t===null||t.tag!==6?(t=$l(n,e.mode,r),t.return=e,t):(t=a(t,n),t.return=e,t)}function l(e,t,n,r){var i=n.type;return i===S?d(e,t,n.props.children,r,n.key):t!==null&&(t.elementType===i||typeof i==`object`&&i&&i.$$typeof===ce&&ja(i)===t.type)?(r=a(t,n.props),r.ref=ka(e,t,n),r.return=e,r):(r=Xl(n.type,n.key,n.props,null,e.mode,r),r.ref=ka(e,t,n),r.return=e,r)}function u(e,t,n,r){return t===null||t.tag!==4||t.stateNode.containerInfo!==n.containerInfo||t.stateNode.implementation!==n.implementation?(t=eu(n,e.mode,r),t.return=e,t):(t=a(t,n.children||[]),t.return=e,t)}function d(e,t,n,r,i){return t===null||t.tag!==7?(t=Zl(n,e.mode,r,i),t.return=e,t):(t=a(t,n),t.return=e,t)}function f(e,t,n){if(typeof t==`string`&&t!==``||typeof t==`number`)return t=$l(``+t,e.mode,n),t.return=e,t;if(typeof t==`object`&&t){switch(t.$$typeof){case ne:return n=Xl(t.type,t.key,t.props,null,e.mode,n),n.ref=ka(e,null,t),n.return=e,n;case re:return t=eu(t,e.mode,n),t.return=e,t;case ce:var r=t._init;return f(e,r(t._payload),n)}if(we(t)||ue(t))return t=Zl(t,e.mode,n,null),t.return=e,t;Aa(e,t)}return null}function p(e,t,n,r){var i=t===null?null:t.key;if(typeof n==`string`&&n!==``||typeof n==`number`)return i===null?c(e,t,``+n,r):null;if(typeof n==`object`&&n){switch(n.$$typeof){case ne:return n.key===i?l(e,t,n,r):null;case re:return n.key===i?u(e,t,n,r):null;case ce:return i=n._init,p(e,t,i(n._payload),r)}if(we(n)||ue(n))return i===null?d(e,t,n,r,null):null;Aa(e,n)}return null}function m(e,t,n,r,i){if(typeof r==`string`&&r!==``||typeof r==`number`)return e=e.get(n)||null,c(t,e,``+r,i);if(typeof r==`object`&&r){switch(r.$$typeof){case ne:return e=e.get(r.key===null?n:r.key)||null,l(t,e,r,i);case re:return e=e.get(r.key===null?n:r.key)||null,u(t,e,r,i);case ce:var a=r._init;return m(e,t,n,a(r._payload),i)}if(we(r)||ue(r))return e=e.get(n)||null,d(t,e,r,i,null);Aa(t,r)}return null}function h(r,a,s,c){for(var l=null,u=null,d=a,h=a=0,g=null;d!==null&&h<s.length;h++){d.index>h?(g=d,d=null):g=d.sibling;var _=p(r,d,s[h],c);if(_===null){d===null&&(d=g);break}e&&d&&_.alternate===null&&t(r,d),a=o(_,a,h),u===null?l=_:u.sibling=_,u=_,d=g}if(h===s.length)return n(r,d),_a&&da(r,h),l;if(d===null){for(;h<s.length;h++)d=f(r,s[h],c),d!==null&&(a=o(d,a,h),u===null?l=d:u.sibling=d,u=d);return _a&&da(r,h),l}for(d=i(r,d);h<s.length;h++)g=m(d,r,h,s[h],c),g!==null&&(e&&g.alternate!==null&&d.delete(g.key===null?h:g.key),a=o(g,a,h),u===null?l=g:u.sibling=g,u=g);return e&&d.forEach(function(e){return t(r,e)}),_a&&da(r,h),l}function g(a,s,c,l){var u=ue(c);if(typeof u!=`function`)throw Error(r(150));if(c=u.call(c),c==null)throw Error(r(151));for(var d=u=null,h=s,g=s=0,_=null,v=c.next();h!==null&&!v.done;g++,v=c.next()){h.index>g?(_=h,h=null):_=h.sibling;var y=p(a,h,v.value,l);if(y===null){h===null&&(h=_);break}e&&h&&y.alternate===null&&t(a,h),s=o(y,s,g),d===null?u=y:d.sibling=y,d=y,h=_}if(v.done)return n(a,h),_a&&da(a,g),u;if(h===null){for(;!v.done;g++,v=c.next())v=f(a,v.value,l),v!==null&&(s=o(v,s,g),d===null?u=v:d.sibling=v,d=v);return _a&&da(a,g),u}for(h=i(a,h);!v.done;g++,v=c.next())v=m(h,a,g,v.value,l),v!==null&&(e&&v.alternate!==null&&h.delete(v.key===null?g:v.key),s=o(v,s,g),d===null?u=v:d.sibling=v,d=v);return e&&h.forEach(function(e){return t(a,e)}),_a&&da(a,g),u}function _(e,r,i,o){if(typeof i==`object`&&i&&i.type===S&&i.key===null&&(i=i.props.children),typeof i==`object`&&i){switch(i.$$typeof){case ne:a:{for(var c=i.key,l=r;l!==null;){if(l.key===c){if(c=i.type,c===S){if(l.tag===7){n(e,l.sibling),r=a(l,i.props.children),r.return=e,e=r;break a}}else if(l.elementType===c||typeof c==`object`&&c&&c.$$typeof===ce&&ja(c)===l.type){n(e,l.sibling),r=a(l,i.props),r.ref=ka(e,l,i),r.return=e,e=r;break a}n(e,l);break}else t(e,l);l=l.sibling}i.type===S?(r=Zl(i.props.children,e.mode,o,i.key),r.return=e,e=r):(o=Xl(i.type,i.key,i.props,null,e.mode,o),o.ref=ka(e,r,i),o.return=e,e=o)}return s(e);case re:a:{for(l=i.key;r!==null;){if(r.key===l)if(r.tag===4&&r.stateNode.containerInfo===i.containerInfo&&r.stateNode.implementation===i.implementation){n(e,r.sibling),r=a(r,i.children||[]),r.return=e,e=r;break a}else{n(e,r);break}else t(e,r);r=r.sibling}r=eu(i,e.mode,o),r.return=e,e=r}return s(e);case ce:return l=i._init,_(e,r,l(i._payload),o)}if(we(i))return h(e,r,i,o);if(ue(i))return g(e,r,i,o);Aa(e,i)}return typeof i==`string`&&i!==``||typeof i==`number`?(i=``+i,r!==null&&r.tag===6?(n(e,r.sibling),r=a(r,i),r.return=e,e=r):(n(e,r),r=$l(i,e.mode,o),r.return=e,e=r),s(e)):n(e,r)}return _}var Na=Ma(!0),Pa=Ma(!1),Fa=Ri(null),Ia=null,La=null,Ra=null;function za(){Ra=La=Ia=null}function Ba(e){var t=Fa.current;X(Fa),e._currentValue=t}function Va(e,t,n){for(;e!==null;){var r=e.alternate;if((e.childLanes&t)===t?r!==null&&(r.childLanes&t)!==t&&(r.childLanes|=t):(e.childLanes|=t,r!==null&&(r.childLanes|=t)),e===n)break;e=e.return}}function Ha(e,t){Ia=e,Ra=La=null,e=e.dependencies,e!==null&&e.firstContext!==null&&((e.lanes&t)!==0&&(Ms=!0),e.firstContext=null)}function Ua(e){var t=e._currentValue;if(Ra!==e)if(e={context:e,memoizedValue:t,next:null},La===null){if(Ia===null)throw Error(r(308));La=e,Ia.dependencies={lanes:0,firstContext:e}}else La=La.next=e;return t}var Wa=null;function Ga(e){Wa===null?Wa=[e]:Wa.push(e)}function Ka(e,t,n,r){var i=t.interleaved;return i===null?(n.next=n,Ga(t)):(n.next=i.next,i.next=n),t.interleaved=n,qa(e,r)}function qa(e,t){e.lanes|=t;var n=e.alternate;for(n!==null&&(n.lanes|=t),n=e,e=e.return;e!==null;)e.childLanes|=t,n=e.alternate,n!==null&&(n.childLanes|=t),n=e,e=e.return;return n.tag===3?n.stateNode:null}var Ja=!1;function Ya(e){e.updateQueue={baseState:e.memoizedState,firstBaseUpdate:null,lastBaseUpdate:null,shared:{pending:null,interleaved:null,lanes:0},effects:null}}function Xa(e,t){e=e.updateQueue,t.updateQueue===e&&(t.updateQueue={baseState:e.baseState,firstBaseUpdate:e.firstBaseUpdate,lastBaseUpdate:e.lastBaseUpdate,shared:e.shared,effects:e.effects})}function Za(e,t){return{eventTime:e,lane:t,tag:0,payload:null,callback:null,next:null}}function Qa(e,t,n){var r=e.updateQueue;if(r===null)return null;if(r=r.shared,$&2){var i=r.pending;return i===null?t.next=t:(t.next=i.next,i.next=t),r.pending=t,qa(e,n)}return i=r.interleaved,i===null?(t.next=t,Ga(r)):(t.next=i.next,i.next=t),r.interleaved=t,qa(e,n)}function $a(e,t,n){if(t=t.updateQueue,t!==null&&(t=t.shared,n&4194240)){var r=t.lanes;r&=e.pendingLanes,n|=r,t.lanes=n,Ft(e,n)}}function eo(e,t){var n=e.updateQueue,r=e.alternate;if(r!==null&&(r=r.updateQueue,n===r)){var i=null,a=null;if(n=n.firstBaseUpdate,n!==null){do{var o={eventTime:n.eventTime,lane:n.lane,tag:n.tag,payload:n.payload,callback:n.callback,next:null};a===null?i=a=o:a=a.next=o,n=n.next}while(n!==null);a===null?i=a=t:a=a.next=t}else i=a=t;n={baseState:r.baseState,firstBaseUpdate:i,lastBaseUpdate:a,shared:r.shared,effects:r.effects},e.updateQueue=n;return}e=n.lastBaseUpdate,e===null?n.firstBaseUpdate=t:e.next=t,n.lastBaseUpdate=t}function to(e,t,n,r){var i=e.updateQueue;Ja=!1;var a=i.firstBaseUpdate,o=i.lastBaseUpdate,s=i.shared.pending;if(s!==null){i.shared.pending=null;var c=s,l=c.next;c.next=null,o===null?a=l:o.next=l,o=c;var u=e.alternate;u!==null&&(u=u.updateQueue,s=u.lastBaseUpdate,s!==o&&(s===null?u.firstBaseUpdate=l:s.next=l,u.lastBaseUpdate=c))}if(a!==null){var d=i.baseState;o=0,u=l=c=null,s=a;do{var f=s.lane,p=s.eventTime;if((r&f)===f){u!==null&&(u=u.next={eventTime:p,lane:0,tag:s.tag,payload:s.payload,callback:s.callback,next:null});a:{var m=e,h=s;switch(f=t,p=n,h.tag){case 1:if(m=h.payload,typeof m==`function`){d=m.call(p,d,f);break a}d=m;break a;case 3:m.flags=m.flags&-65537|128;case 0:if(m=h.payload,f=typeof m==`function`?m.call(p,d,f):m,f==null)break a;d=O({},d,f);break a;case 2:Ja=!0}}s.callback!==null&&s.lane!==0&&(e.flags|=64,f=i.effects,f===null?i.effects=[s]:f.push(s))}else p={eventTime:p,lane:f,tag:s.tag,payload:s.payload,callback:s.callback,next:null},u===null?(l=u=p,c=d):u=u.next=p,o|=f;if(s=s.next,s===null){if(s=i.shared.pending,s===null)break;f=s,s=f.next,f.next=null,i.lastBaseUpdate=f,i.shared.pending=null}}while(1);if(u===null&&(c=d),i.baseState=c,i.firstBaseUpdate=l,i.lastBaseUpdate=u,t=i.shared.interleaved,t!==null){i=t;do o|=i.lane,i=i.next;while(i!==t)}else a===null&&(i.shared.lanes=0);Jc|=o,e.lanes=o,e.memoizedState=d}}function no(e,t,n){if(e=t.effects,t.effects=null,e!==null)for(t=0;t<e.length;t++){var i=e[t],a=i.callback;if(a!==null){if(i.callback=null,i=n,typeof a!=`function`)throw Error(r(191,a));a.call(i)}}}var ro={},io=Ri(ro),ao=Ri(ro),oo=Ri(ro);function so(e){if(e===ro)throw Error(r(174));return e}function co(e,t){switch(Z(oo,t),Z(ao,e),Z(io,ro),e=t.nodeType,e){case 9:case 11:t=(t=t.documentElement)?t.namespaceURI:Ae(null,``);break;default:e=e===8?t.parentNode:t,t=e.namespaceURI||null,e=e.tagName,t=Ae(t,e)}X(io),Z(io,t)}function lo(){X(io),X(ao),X(oo)}function uo(e){so(oo.current);var t=so(io.current),n=Ae(t,e.type);t!==n&&(Z(ao,e),Z(io,n))}function fo(e){ao.current===e&&(X(io),X(ao))}var po=Ri(0);function mo(e){for(var t=e;t!==null;){if(t.tag===13){var n=t.memoizedState;if(n!==null&&(n=n.dehydrated,n===null||n.data===`$?`||n.data===`$!`))return t}else if(t.tag===19&&t.memoizedProps.revealOrder!==void 0){if(t.flags&128)return t}else if(t.child!==null){t.child.return=t,t=t.child;continue}if(t===e)break;for(;t.sibling===null;){if(t.return===null||t.return===e)return null;t=t.return}t.sibling.return=t.return,t=t.sibling}return null}var ho=[];function go(){for(var e=0;e<ho.length;e++)ho[e]._workInProgressVersionPrimary=null;ho.length=0}var _o=x.ReactCurrentDispatcher,vo=x.ReactCurrentBatchConfig,yo=0,bo=null,xo=null,So=null,Co=!1,wo=!1,To=0,Eo=0;function Do(){throw Error(r(321))}function Oo(e,t){if(t===null)return!1;for(var n=0;n<t.length&&n<e.length;n++)if(!wr(e[n],t[n]))return!1;return!0}function ko(e,t,n,i,a,o){if(yo=o,bo=t,t.memoizedState=null,t.updateQueue=null,t.lanes=0,_o.current=e===null||e.memoizedState===null?fs:ps,e=n(i,a),wo){o=0;do{if(wo=!1,To=0,25<=o)throw Error(r(301));o+=1,So=xo=null,t.updateQueue=null,_o.current=ms,e=n(i,a)}while(wo)}if(_o.current=ds,t=xo!==null&&xo.next!==null,yo=0,So=xo=bo=null,Co=!1,t)throw Error(r(300));return e}function Ao(){var e=To!==0;return To=0,e}function jo(){var e={memoizedState:null,baseState:null,baseQueue:null,queue:null,next:null};return So===null?bo.memoizedState=So=e:So=So.next=e,So}function Mo(){if(xo===null){var e=bo.alternate;e=e===null?null:e.memoizedState}else e=xo.next;var t=So===null?bo.memoizedState:So.next;if(t!==null)So=t,xo=e;else{if(e===null)throw Error(r(310));xo=e,e={memoizedState:xo.memoizedState,baseState:xo.baseState,baseQueue:xo.baseQueue,queue:xo.queue,next:null},So===null?bo.memoizedState=So=e:So=So.next=e}return So}function No(e,t){return typeof t==`function`?t(e):t}function Po(e){var t=Mo(),n=t.queue;if(n===null)throw Error(r(311));n.lastRenderedReducer=e;var i=xo,a=i.baseQueue,o=n.pending;if(o!==null){if(a!==null){var s=a.next;a.next=o.next,o.next=s}i.baseQueue=a=o,n.pending=null}if(a!==null){o=a.next,i=i.baseState;var c=s=null,l=null,u=o;do{var d=u.lane;if((yo&d)===d)l!==null&&(l=l.next={lane:0,action:u.action,hasEagerState:u.hasEagerState,eagerState:u.eagerState,next:null}),i=u.hasEagerState?u.eagerState:e(i,u.action);else{var f={lane:d,action:u.action,hasEagerState:u.hasEagerState,eagerState:u.eagerState,next:null};l===null?(c=l=f,s=i):l=l.next=f,bo.lanes|=d,Jc|=d}u=u.next}while(u!==null&&u!==o);l===null?s=i:l.next=c,wr(i,t.memoizedState)||(Ms=!0),t.memoizedState=i,t.baseState=s,t.baseQueue=l,n.lastRenderedState=i}if(e=n.interleaved,e!==null){a=e;do o=a.lane,bo.lanes|=o,Jc|=o,a=a.next;while(a!==e)}else a===null&&(n.lanes=0);return[t.memoizedState,n.dispatch]}function Fo(e){var t=Mo(),n=t.queue;if(n===null)throw Error(r(311));n.lastRenderedReducer=e;var i=n.dispatch,a=n.pending,o=t.memoizedState;if(a!==null){n.pending=null;var s=a=a.next;do o=e(o,s.action),s=s.next;while(s!==a);wr(o,t.memoizedState)||(Ms=!0),t.memoizedState=o,t.baseQueue===null&&(t.baseState=o),n.lastRenderedState=o}return[o,i]}function Io(){}function Lo(e,t){var n=bo,i=Mo(),a=t(),o=!wr(i.memoizedState,a);if(o&&(i.memoizedState=a,Ms=!0),i=i.queue,Yo(Bo.bind(null,n,i,e),[e]),i.getSnapshot!==t||o||So!==null&&So.memoizedState.tag&1){if(n.flags|=2048,Wo(9,zo.bind(null,n,i,a,t),void 0,null),Vc===null)throw Error(r(349));yo&30||Ro(n,t,a)}return a}function Ro(e,t,n){e.flags|=16384,e={getSnapshot:t,value:n},t=bo.updateQueue,t===null?(t={lastEffect:null,stores:null},bo.updateQueue=t,t.stores=[e]):(n=t.stores,n===null?t.stores=[e]:n.push(e))}function zo(e,t,n,r){t.value=n,t.getSnapshot=r,Vo(t)&&Ho(e)}function Bo(e,t,n){return n(function(){Vo(t)&&Ho(e)})}function Vo(e){var t=e.getSnapshot;e=e.value;try{var n=t();return!wr(e,n)}catch{return!0}}function Ho(e){var t=qa(e,1);t!==null&&ml(t,e,1,-1)}function Uo(e){var t=jo();return typeof e==`function`&&(e=e()),t.memoizedState=t.baseState=e,e={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:No,lastRenderedState:e},t.queue=e,e=e.dispatch=ss.bind(null,bo,e),[t.memoizedState,e]}function Wo(e,t,n,r){return e={tag:e,create:t,destroy:n,deps:r,next:null},t=bo.updateQueue,t===null?(t={lastEffect:null,stores:null},bo.updateQueue=t,t.lastEffect=e.next=e):(n=t.lastEffect,n===null?t.lastEffect=e.next=e:(r=n.next,n.next=e,e.next=r,t.lastEffect=e)),e}function Go(){return Mo().memoizedState}function Ko(e,t,n,r){var i=jo();bo.flags|=e,i.memoizedState=Wo(1|t,n,void 0,r===void 0?null:r)}function qo(e,t,n,r){var i=Mo();r=r===void 0?null:r;var a=void 0;if(xo!==null){var o=xo.memoizedState;if(a=o.destroy,r!==null&&Oo(r,o.deps)){i.memoizedState=Wo(t,n,a,r);return}}bo.flags|=e,i.memoizedState=Wo(1|t,n,a,r)}function Jo(e,t){return Ko(8390656,8,e,t)}function Yo(e,t){return qo(2048,8,e,t)}function Xo(e,t){return qo(4,2,e,t)}function Zo(e,t){return qo(4,4,e,t)}function Qo(e,t){if(typeof t==`function`)return e=e(),t(e),function(){t(null)};if(t!=null)return e=e(),t.current=e,function(){t.current=null}}function $o(e,t,n){return n=n==null?null:n.concat([e]),qo(4,4,Qo.bind(null,t,e),n)}function es(){}function ts(e,t){var n=Mo();t=t===void 0?null:t;var r=n.memoizedState;return r!==null&&t!==null&&Oo(t,r[1])?r[0]:(n.memoizedState=[e,t],e)}function ns(e,t){var n=Mo();t=t===void 0?null:t;var r=n.memoizedState;return r!==null&&t!==null&&Oo(t,r[1])?r[0]:(e=e(),n.memoizedState=[e,t],e)}function rs(e,t,n){return yo&21?(wr(n,t)||(n=jt(),bo.lanes|=n,Jc|=n,e.baseState=!0),t):(e.baseState&&(e.baseState=!1,Ms=!0),e.memoizedState=n)}function is(e,t){var n=K;K=n!==0&&4>n?n:4,e(!0);var r=vo.transition;vo.transition={};try{e(!1),t()}finally{K=n,vo.transition=r}}function as(){return Mo().memoizedState}function os(e,t,n){var r=pl(e);if(n={lane:r,action:n,hasEagerState:!1,eagerState:null,next:null},cs(e))ls(t,n);else if(n=Ka(e,t,n,r),n!==null){var i=fl();ml(n,e,r,i),us(n,t,r)}}function ss(e,t,n){var r=pl(e),i={lane:r,action:n,hasEagerState:!1,eagerState:null,next:null};if(cs(e))ls(t,i);else{var a=e.alternate;if(e.lanes===0&&(a===null||a.lanes===0)&&(a=t.lastRenderedReducer,a!==null))try{var o=t.lastRenderedState,s=a(o,n);if(i.hasEagerState=!0,i.eagerState=s,wr(s,o)){var c=t.interleaved;c===null?(i.next=i,Ga(t)):(i.next=c.next,c.next=i),t.interleaved=i;return}}catch{}n=Ka(e,t,i,r),n!==null&&(i=fl(),ml(n,e,r,i),us(n,t,r))}}function cs(e){var t=e.alternate;return e===bo||t!==null&&t===bo}function ls(e,t){wo=Co=!0;var n=e.pending;n===null?t.next=t:(t.next=n.next,n.next=t),e.pending=t}function us(e,t,n){if(n&4194240){var r=t.lanes;r&=e.pendingLanes,n|=r,t.lanes=n,Ft(e,n)}}var ds={readContext:Ua,useCallback:Do,useContext:Do,useEffect:Do,useImperativeHandle:Do,useInsertionEffect:Do,useLayoutEffect:Do,useMemo:Do,useReducer:Do,useRef:Do,useState:Do,useDebugValue:Do,useDeferredValue:Do,useTransition:Do,useMutableSource:Do,useSyncExternalStore:Do,useId:Do,unstable_isNewReconciler:!1},fs={readContext:Ua,useCallback:function(e,t){return jo().memoizedState=[e,t===void 0?null:t],e},useContext:Ua,useEffect:Jo,useImperativeHandle:function(e,t,n){return n=n==null?null:n.concat([e]),Ko(4194308,4,Qo.bind(null,t,e),n)},useLayoutEffect:function(e,t){return Ko(4194308,4,e,t)},useInsertionEffect:function(e,t){return Ko(4,2,e,t)},useMemo:function(e,t){var n=jo();return t=t===void 0?null:t,e=e(),n.memoizedState=[e,t],e},useReducer:function(e,t,n){var r=jo();return t=n===void 0?t:n(t),r.memoizedState=r.baseState=t,e={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:e,lastRenderedState:t},r.queue=e,e=e.dispatch=os.bind(null,bo,e),[r.memoizedState,e]},useRef:function(e){var t=jo();return e={current:e},t.memoizedState=e},useState:Uo,useDebugValue:es,useDeferredValue:function(e){return jo().memoizedState=e},useTransition:function(){var e=Uo(!1),t=e[0];return e=is.bind(null,e[1]),jo().memoizedState=e,[t,e]},useMutableSource:function(){},useSyncExternalStore:function(e,t,n){var i=bo,a=jo();if(_a){if(n===void 0)throw Error(r(407));n=n()}else{if(n=t(),Vc===null)throw Error(r(349));yo&30||Ro(i,t,n)}a.memoizedState=n;var o={value:n,getSnapshot:t};return a.queue=o,Jo(Bo.bind(null,i,o,e),[e]),i.flags|=2048,Wo(9,zo.bind(null,i,o,n,t),void 0,null),n},useId:function(){var e=jo(),t=Vc.identifierPrefix;if(_a){var n=ua,r=la;n=(r&~(1<<32-bt(r)-1)).toString(32)+n,t=`:`+t+`R`+n,n=To++,0<n&&(t+=`H`+n.toString(32)),t+=`:`}else n=Eo++,t=`:`+t+`r`+n.toString(32)+`:`;return e.memoizedState=t},unstable_isNewReconciler:!1},ps={readContext:Ua,useCallback:ts,useContext:Ua,useEffect:Yo,useImperativeHandle:$o,useInsertionEffect:Xo,useLayoutEffect:Zo,useMemo:ns,useReducer:Po,useRef:Go,useState:function(){return Po(No)},useDebugValue:es,useDeferredValue:function(e){return rs(Mo(),xo.memoizedState,e)},useTransition:function(){return[Po(No)[0],Mo().memoizedState]},useMutableSource:Io,useSyncExternalStore:Lo,useId:as,unstable_isNewReconciler:!1},ms={readContext:Ua,useCallback:ts,useContext:Ua,useEffect:Yo,useImperativeHandle:$o,useInsertionEffect:Xo,useLayoutEffect:Zo,useMemo:ns,useReducer:Fo,useRef:Go,useState:function(){return Fo(No)},useDebugValue:es,useDeferredValue:function(e){var t=Mo();return xo===null?t.memoizedState=e:rs(t,xo.memoizedState,e)},useTransition:function(){return[Fo(No)[0],Mo().memoizedState]},useMutableSource:Io,useSyncExternalStore:Lo,useId:as,unstable_isNewReconciler:!1};function hs(e,t){if(e&&e.defaultProps){for(var n in t=O({},t),e=e.defaultProps,e)t[n]===void 0&&(t[n]=e[n]);return t}return t}function gs(e,t,n,r){t=e.memoizedState,n=n(r,t),n=n==null?t:O({},t,n),e.memoizedState=n,e.lanes===0&&(e.updateQueue.baseState=n)}var _s={isMounted:function(e){return(e=e._reactInternals)?tt(e)===e:!1},enqueueSetState:function(e,t,n){e=e._reactInternals;var r=fl(),i=pl(e),a=Za(r,i);a.payload=t,n!=null&&(a.callback=n),t=Qa(e,a,i),t!==null&&(ml(t,e,i,r),$a(t,e,i))},enqueueReplaceState:function(e,t,n){e=e._reactInternals;var r=fl(),i=pl(e),a=Za(r,i);a.tag=1,a.payload=t,n!=null&&(a.callback=n),t=Qa(e,a,i),t!==null&&(ml(t,e,i,r),$a(t,e,i))},enqueueForceUpdate:function(e,t){e=e._reactInternals;var n=fl(),r=pl(e),i=Za(n,r);i.tag=2,t!=null&&(i.callback=t),t=Qa(e,i,r),t!==null&&(ml(t,e,r,n),$a(t,e,r))}};function vs(e,t,n,r,i,a,o){return e=e.stateNode,typeof e.shouldComponentUpdate==`function`?e.shouldComponentUpdate(r,a,o):t.prototype&&t.prototype.isPureReactComponent?!Tr(n,r)||!Tr(i,a):!0}function ys(e,t,n){var r=!1,i=zi,a=t.contextType;return typeof a==`object`&&a?a=Ua(a):(i=Wi(t)?Hi:Bi.current,r=t.contextTypes,a=(r=r!=null)?Ui(e,i):zi),t=new t(n,a),e.memoizedState=t.state!==null&&t.state!==void 0?t.state:null,t.updater=_s,e.stateNode=t,t._reactInternals=e,r&&(e=e.stateNode,e.__reactInternalMemoizedUnmaskedChildContext=i,e.__reactInternalMemoizedMaskedChildContext=a),t}function bs(e,t,n,r){e=t.state,typeof t.componentWillReceiveProps==`function`&&t.componentWillReceiveProps(n,r),typeof t.UNSAFE_componentWillReceiveProps==`function`&&t.UNSAFE_componentWillReceiveProps(n,r),t.state!==e&&_s.enqueueReplaceState(t,t.state,null)}function xs(e,t,n,r){var i=e.stateNode;i.props=n,i.state=e.memoizedState,i.refs={},Ya(e);var a=t.contextType;typeof a==`object`&&a?i.context=Ua(a):(a=Wi(t)?Hi:Bi.current,i.context=Ui(e,a)),i.state=e.memoizedState,a=t.getDerivedStateFromProps,typeof a==`function`&&(gs(e,t,a,n),i.state=e.memoizedState),typeof t.getDerivedStateFromProps==`function`||typeof i.getSnapshotBeforeUpdate==`function`||typeof i.UNSAFE_componentWillMount!=`function`&&typeof i.componentWillMount!=`function`||(t=i.state,typeof i.componentWillMount==`function`&&i.componentWillMount(),typeof i.UNSAFE_componentWillMount==`function`&&i.UNSAFE_componentWillMount(),t!==i.state&&_s.enqueueReplaceState(i,i.state,null),to(e,n,i,r),i.state=e.memoizedState),typeof i.componentDidMount==`function`&&(e.flags|=4194308)}function Ss(e,t){try{var n=``,r=t;do n+=pe(r),r=r.return;while(r);var i=n}catch(e){i=`
Error generating stack: `+e.message+`
`+e.stack}return{value:e,source:t,stack:i,digest:null}}function Cs(e,t,n){return{value:e,source:null,stack:n??null,digest:t??null}}function ws(e,t){try{console.error(t.value)}catch(e){setTimeout(function(){throw e})}}var Ts=typeof WeakMap==`function`?WeakMap:Map;function Es(e,t,n){n=Za(-1,n),n.tag=3,n.payload={element:null};var r=t.value;return n.callback=function(){nl||(nl=!0,rl=r),ws(e,t)},n}function Ds(e,t,n){n=Za(-1,n),n.tag=3;var r=e.type.getDerivedStateFromError;if(typeof r==`function`){var i=t.value;n.payload=function(){return r(i)},n.callback=function(){ws(e,t)}}var a=e.stateNode;return a!==null&&typeof a.componentDidCatch==`function`&&(n.callback=function(){ws(e,t),typeof r!=`function`&&(il===null?il=new Set([this]):il.add(this));var n=t.stack;this.componentDidCatch(t.value,{componentStack:n===null?``:n})}),n}function Os(e,t,n){var r=e.pingCache;if(r===null){r=e.pingCache=new Ts;var i=new Set;r.set(t,i)}else i=r.get(t),i===void 0&&(i=new Set,r.set(t,i));i.has(n)||(i.add(n),e=zl.bind(null,e,t,n),t.then(e,e))}function ks(e){do{var t;if((t=e.tag===13)&&(t=e.memoizedState,t=t===null?!0:t.dehydrated!==null),t)return e;e=e.return}while(e!==null);return null}function As(e,t,n,r,i){return e.mode&1?(e.flags|=65536,e.lanes=i,e):(e===t?e.flags|=65536:(e.flags|=128,n.flags|=131072,n.flags&=-52805,n.tag===1&&(n.alternate===null?n.tag=17:(t=Za(-1,1),t.tag=2,Qa(n,t,1))),n.lanes|=1),e)}var js=x.ReactCurrentOwner,Ms=!1;function Ns(e,t,n,r){t.child=e===null?Pa(t,null,n,r):Na(t,e.child,n,r)}function Ps(e,t,n,r,i){n=n.render;var a=t.ref;return Ha(t,i),r=ko(e,t,n,r,a,i),n=Ao(),e!==null&&!Ms?(t.updateQueue=e.updateQueue,t.flags&=-2053,e.lanes&=~i,ec(e,t,i)):(_a&&n&&pa(t),t.flags|=1,Ns(e,t,r,i),t.child)}function Fs(e,t,n,r,i){if(e===null){var a=n.type;return typeof a==`function`&&!ql(a)&&a.defaultProps===void 0&&n.compare===null&&n.defaultProps===void 0?(t.tag=15,t.type=a,Is(e,t,a,r,i)):(e=Xl(n.type,null,r,t,t.mode,i),e.ref=t.ref,e.return=t,t.child=e)}if(a=e.child,(e.lanes&i)===0){var o=a.memoizedProps;if(n=n.compare,n=n===null?Tr:n,n(o,r)&&e.ref===t.ref)return ec(e,t,i)}return t.flags|=1,e=Yl(a,r),e.ref=t.ref,e.return=t,t.child=e}function Is(e,t,n,r,i){if(e!==null){var a=e.memoizedProps;if(Tr(a,r)&&e.ref===t.ref)if(Ms=!1,t.pendingProps=r=a,(e.lanes&i)!==0)e.flags&131072&&(Ms=!0);else return t.lanes=e.lanes,ec(e,t,i)}return zs(e,t,n,r,i)}function Ls(e,t,n){var r=t.pendingProps,i=r.children,a=e===null?null:e.memoizedState;if(r.mode===`hidden`)if(!(t.mode&1))t.memoizedState={baseLanes:0,cachePool:null,transitions:null},Z(Gc,Wc),Wc|=n;else{if(!(n&1073741824))return e=a===null?n:a.baseLanes|n,t.lanes=t.childLanes=1073741824,t.memoizedState={baseLanes:e,cachePool:null,transitions:null},t.updateQueue=null,Z(Gc,Wc),Wc|=e,null;t.memoizedState={baseLanes:0,cachePool:null,transitions:null},r=a===null?n:a.baseLanes,Z(Gc,Wc),Wc|=r}else a===null?r=n:(r=a.baseLanes|n,t.memoizedState=null),Z(Gc,Wc),Wc|=r;return Ns(e,t,i,n),t.child}function Rs(e,t){var n=t.ref;(e===null&&n!==null||e!==null&&e.ref!==n)&&(t.flags|=512,t.flags|=2097152)}function zs(e,t,n,r,i){var a=Wi(n)?Hi:Bi.current;return a=Ui(t,a),Ha(t,i),n=ko(e,t,n,r,a,i),r=Ao(),e!==null&&!Ms?(t.updateQueue=e.updateQueue,t.flags&=-2053,e.lanes&=~i,ec(e,t,i)):(_a&&r&&pa(t),t.flags|=1,Ns(e,t,n,i),t.child)}function Bs(e,t,n,r,i){if(Wi(n)){var a=!0;Ji(t)}else a=!1;if(Ha(t,i),t.stateNode===null)$s(e,t),ys(t,n,r),xs(t,n,r,i),r=!0;else if(e===null){var o=t.stateNode,s=t.memoizedProps;o.props=s;var c=o.context,l=n.contextType;typeof l==`object`&&l?l=Ua(l):(l=Wi(n)?Hi:Bi.current,l=Ui(t,l));var u=n.getDerivedStateFromProps,d=typeof u==`function`||typeof o.getSnapshotBeforeUpdate==`function`;d||typeof o.UNSAFE_componentWillReceiveProps!=`function`&&typeof o.componentWillReceiveProps!=`function`||(s!==r||c!==l)&&bs(t,o,r,l),Ja=!1;var f=t.memoizedState;o.state=f,to(t,r,o,i),c=t.memoizedState,s!==r||f!==c||Vi.current||Ja?(typeof u==`function`&&(gs(t,n,u,r),c=t.memoizedState),(s=Ja||vs(t,n,s,r,f,c,l))?(d||typeof o.UNSAFE_componentWillMount!=`function`&&typeof o.componentWillMount!=`function`||(typeof o.componentWillMount==`function`&&o.componentWillMount(),typeof o.UNSAFE_componentWillMount==`function`&&o.UNSAFE_componentWillMount()),typeof o.componentDidMount==`function`&&(t.flags|=4194308)):(typeof o.componentDidMount==`function`&&(t.flags|=4194308),t.memoizedProps=r,t.memoizedState=c),o.props=r,o.state=c,o.context=l,r=s):(typeof o.componentDidMount==`function`&&(t.flags|=4194308),r=!1)}else{o=t.stateNode,Xa(e,t),s=t.memoizedProps,l=t.type===t.elementType?s:hs(t.type,s),o.props=l,d=t.pendingProps,f=o.context,c=n.contextType,typeof c==`object`&&c?c=Ua(c):(c=Wi(n)?Hi:Bi.current,c=Ui(t,c));var p=n.getDerivedStateFromProps;(u=typeof p==`function`||typeof o.getSnapshotBeforeUpdate==`function`)||typeof o.UNSAFE_componentWillReceiveProps!=`function`&&typeof o.componentWillReceiveProps!=`function`||(s!==d||f!==c)&&bs(t,o,r,c),Ja=!1,f=t.memoizedState,o.state=f,to(t,r,o,i);var m=t.memoizedState;s!==d||f!==m||Vi.current||Ja?(typeof p==`function`&&(gs(t,n,p,r),m=t.memoizedState),(l=Ja||vs(t,n,l,r,f,m,c)||!1)?(u||typeof o.UNSAFE_componentWillUpdate!=`function`&&typeof o.componentWillUpdate!=`function`||(typeof o.componentWillUpdate==`function`&&o.componentWillUpdate(r,m,c),typeof o.UNSAFE_componentWillUpdate==`function`&&o.UNSAFE_componentWillUpdate(r,m,c)),typeof o.componentDidUpdate==`function`&&(t.flags|=4),typeof o.getSnapshotBeforeUpdate==`function`&&(t.flags|=1024)):(typeof o.componentDidUpdate!=`function`||s===e.memoizedProps&&f===e.memoizedState||(t.flags|=4),typeof o.getSnapshotBeforeUpdate!=`function`||s===e.memoizedProps&&f===e.memoizedState||(t.flags|=1024),t.memoizedProps=r,t.memoizedState=m),o.props=r,o.state=m,o.context=c,r=l):(typeof o.componentDidUpdate!=`function`||s===e.memoizedProps&&f===e.memoizedState||(t.flags|=4),typeof o.getSnapshotBeforeUpdate!=`function`||s===e.memoizedProps&&f===e.memoizedState||(t.flags|=1024),r=!1)}return Vs(e,t,n,r,a,i)}function Vs(e,t,n,r,i,a){Rs(e,t);var o=(t.flags&128)!=0;if(!r&&!o)return i&&Yi(t,n,!1),ec(e,t,a);r=t.stateNode,js.current=t;var s=o&&typeof n.getDerivedStateFromError!=`function`?null:r.render();return t.flags|=1,e!==null&&o?(t.child=Na(t,e.child,null,a),t.child=Na(t,null,s,a)):Ns(e,t,s,a),t.memoizedState=r.state,i&&Yi(t,n,!0),t.child}function Hs(e){var t=e.stateNode;t.pendingContext?Ki(e,t.pendingContext,t.pendingContext!==t.context):t.context&&Ki(e,t.context,!1),co(e,t.containerInfo)}function Us(e,t,n,r,i){return Ea(),Da(i),t.flags|=256,Ns(e,t,n,r),t.child}var Ws={dehydrated:null,treeContext:null,retryLane:0};function Gs(e){return{baseLanes:e,cachePool:null,transitions:null}}function Ks(e,t,n){var r=t.pendingProps,i=po.current,a=!1,o=(t.flags&128)!=0,s;if((s=o)||(s=e!==null&&e.memoizedState===null?!1:(i&2)!=0),s?(a=!0,t.flags&=-129):(e===null||e.memoizedState!==null)&&(i|=1),Z(po,i&1),e===null)return Sa(t),e=t.memoizedState,e!==null&&(e=e.dehydrated,e!==null)?(t.mode&1?e.data===`$!`?t.lanes=8:t.lanes=1073741824:t.lanes=1,null):(o=r.children,e=r.fallback,a?(r=t.mode,a=t.child,o={mode:`hidden`,children:o},!(r&1)&&a!==null?(a.childLanes=0,a.pendingProps=o):a=Ql(o,r,0,null),e=Zl(e,r,n,null),a.return=t,e.return=t,a.sibling=e,t.child=a,t.child.memoizedState=Gs(n),t.memoizedState=Ws,e):qs(t,o));if(i=e.memoizedState,i!==null&&(s=i.dehydrated,s!==null))return Ys(e,t,o,r,s,i,n);if(a){a=r.fallback,o=t.mode,i=e.child,s=i.sibling;var c={mode:`hidden`,children:r.children};return!(o&1)&&t.child!==i?(r=t.child,r.childLanes=0,r.pendingProps=c,t.deletions=null):(r=Yl(i,c),r.subtreeFlags=i.subtreeFlags&14680064),s===null?(a=Zl(a,o,n,null),a.flags|=2):a=Yl(s,a),a.return=t,r.return=t,r.sibling=a,t.child=r,r=a,a=t.child,o=e.child.memoizedState,o=o===null?Gs(n):{baseLanes:o.baseLanes|n,cachePool:null,transitions:o.transitions},a.memoizedState=o,a.childLanes=e.childLanes&~n,t.memoizedState=Ws,r}return a=e.child,e=a.sibling,r=Yl(a,{mode:`visible`,children:r.children}),!(t.mode&1)&&(r.lanes=n),r.return=t,r.sibling=null,e!==null&&(n=t.deletions,n===null?(t.deletions=[e],t.flags|=16):n.push(e)),t.child=r,t.memoizedState=null,r}function qs(e,t){return t=Ql({mode:`visible`,children:t},e.mode,0,null),t.return=e,e.child=t}function Js(e,t,n,r){return r!==null&&Da(r),Na(t,e.child,null,n),e=qs(t,t.pendingProps.children),e.flags|=2,t.memoizedState=null,e}function Ys(e,t,n,i,a,o,s){if(n)return t.flags&256?(t.flags&=-257,i=Cs(Error(r(422))),Js(e,t,s,i)):t.memoizedState===null?(o=i.fallback,a=t.mode,i=Ql({mode:`visible`,children:i.children},a,0,null),o=Zl(o,a,s,null),o.flags|=2,i.return=t,o.return=t,i.sibling=o,t.child=i,t.mode&1&&Na(t,e.child,null,s),t.child.memoizedState=Gs(s),t.memoizedState=Ws,o):(t.child=e.child,t.flags|=128,null);if(!(t.mode&1))return Js(e,t,s,null);if(a.data===`$!`){if(i=a.nextSibling&&a.nextSibling.dataset,i)var c=i.dgst;return i=c,o=Error(r(419)),i=Cs(o,i,void 0),Js(e,t,s,i)}if(c=(s&e.childLanes)!==0,Ms||c){if(i=Vc,i!==null){switch(s&-s){case 4:a=2;break;case 16:a=8;break;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:a=32;break;case 536870912:a=268435456;break;default:a=0}a=(a&(i.suspendedLanes|s))===0?a:0,a!==0&&a!==o.retryLane&&(o.retryLane=a,qa(e,a),ml(i,e,a,-1))}return Ol(),i=Cs(Error(r(421))),Js(e,t,s,i)}return a.data===`$?`?(t.flags|=128,t.child=e.child,t=Vl.bind(null,e),a._reactRetry=t,null):(e=o.treeContext,ga=Ci(a.nextSibling),ha=t,_a=!0,va=null,e!==null&&(oa[sa++]=la,oa[sa++]=ua,oa[sa++]=ca,la=e.id,ua=e.overflow,ca=t),t=qs(t,i.children),t.flags|=4096,t)}function Xs(e,t,n){e.lanes|=t;var r=e.alternate;r!==null&&(r.lanes|=t),Va(e.return,t,n)}function Zs(e,t,n,r,i){var a=e.memoizedState;a===null?e.memoizedState={isBackwards:t,rendering:null,renderingStartTime:0,last:r,tail:n,tailMode:i}:(a.isBackwards=t,a.rendering=null,a.renderingStartTime=0,a.last=r,a.tail=n,a.tailMode=i)}function Qs(e,t,n){var r=t.pendingProps,i=r.revealOrder,a=r.tail;if(Ns(e,t,r.children,n),r=po.current,r&2)r=r&1|2,t.flags|=128;else{if(e!==null&&e.flags&128)a:for(e=t.child;e!==null;){if(e.tag===13)e.memoizedState!==null&&Xs(e,n,t);else if(e.tag===19)Xs(e,n,t);else if(e.child!==null){e.child.return=e,e=e.child;continue}if(e===t)break a;for(;e.sibling===null;){if(e.return===null||e.return===t)break a;e=e.return}e.sibling.return=e.return,e=e.sibling}r&=1}if(Z(po,r),!(t.mode&1))t.memoizedState=null;else switch(i){case`forwards`:for(n=t.child,i=null;n!==null;)e=n.alternate,e!==null&&mo(e)===null&&(i=n),n=n.sibling;n=i,n===null?(i=t.child,t.child=null):(i=n.sibling,n.sibling=null),Zs(t,!1,i,n,a);break;case`backwards`:for(n=null,i=t.child,t.child=null;i!==null;){if(e=i.alternate,e!==null&&mo(e)===null){t.child=i;break}e=i.sibling,i.sibling=n,n=i,i=e}Zs(t,!0,n,null,a);break;case`together`:Zs(t,!1,null,null,void 0);break;default:t.memoizedState=null}return t.child}function $s(e,t){!(t.mode&1)&&e!==null&&(e.alternate=null,t.alternate=null,t.flags|=2)}function ec(e,t,n){if(e!==null&&(t.dependencies=e.dependencies),Jc|=t.lanes,(n&t.childLanes)===0)return null;if(e!==null&&t.child!==e.child)throw Error(r(153));if(t.child!==null){for(e=t.child,n=Yl(e,e.pendingProps),t.child=n,n.return=t;e.sibling!==null;)e=e.sibling,n=n.sibling=Yl(e,e.pendingProps),n.return=t;n.sibling=null}return t.child}function tc(e,t,n){switch(t.tag){case 3:Hs(t),Ea();break;case 5:uo(t);break;case 1:Wi(t.type)&&Ji(t);break;case 4:co(t,t.stateNode.containerInfo);break;case 10:var r=t.type._context,i=t.memoizedProps.value;Z(Fa,r._currentValue),r._currentValue=i;break;case 13:if(r=t.memoizedState,r!==null)return r.dehydrated===null?(n&t.child.childLanes)===0?(Z(po,po.current&1),e=ec(e,t,n),e===null?null:e.sibling):Ks(e,t,n):(Z(po,po.current&1),t.flags|=128,null);Z(po,po.current&1);break;case 19:if(r=(n&t.childLanes)!==0,e.flags&128){if(r)return Qs(e,t,n);t.flags|=128}if(i=t.memoizedState,i!==null&&(i.rendering=null,i.tail=null,i.lastEffect=null),Z(po,po.current),r)break;return null;case 22:case 23:return t.lanes=0,Ls(e,t,n)}return ec(e,t,n)}var nc=function(e,t){for(var n=t.child;n!==null;){if(n.tag===5||n.tag===6)e.appendChild(n.stateNode);else if(n.tag!==4&&n.child!==null){n.child.return=n,n=n.child;continue}if(n===t)break;for(;n.sibling===null;){if(n.return===null||n.return===t)return;n=n.return}n.sibling.return=n.return,n=n.sibling}},rc=function(e,t,n,r){var i=e.memoizedProps;if(i!==r){e=t.stateNode,so(io.current);var o=null;switch(n){case`input`:i=be(e,i),r=be(e,r),o=[];break;case`select`:i=O({},i,{value:void 0}),r=O({},r,{value:void 0}),o=[];break;case`textarea`:i=Ee(e,i),r=Ee(e,r),o=[];break;default:typeof i.onClick!=`function`&&typeof r.onClick==`function`&&(e.onclick=pi)}ze(n,r);var s;for(u in n=null,i)if(!r.hasOwnProperty(u)&&i.hasOwnProperty(u)&&i[u]!=null)if(u===`style`){var c=i[u];for(s in c)c.hasOwnProperty(s)&&(n||={},n[s]=``)}else u!==`dangerouslySetInnerHTML`&&u!==`children`&&u!==`suppressContentEditableWarning`&&u!==`suppressHydrationWarning`&&u!==`autoFocus`&&(a.hasOwnProperty(u)?o||=[]:(o||=[]).push(u,null));for(u in r){var l=r[u];if(c=i?.[u],r.hasOwnProperty(u)&&l!==c&&(l!=null||c!=null))if(u===`style`)if(c){for(s in c)!c.hasOwnProperty(s)||l&&l.hasOwnProperty(s)||(n||={},n[s]=``);for(s in l)l.hasOwnProperty(s)&&c[s]!==l[s]&&(n||={},n[s]=l[s])}else n||(o||=[],o.push(u,n)),n=l;else u===`dangerouslySetInnerHTML`?(l=l?l.__html:void 0,c=c?c.__html:void 0,l!=null&&c!==l&&(o||=[]).push(u,l)):u===`children`?typeof l!=`string`&&typeof l!=`number`||(o||=[]).push(u,``+l):u!==`suppressContentEditableWarning`&&u!==`suppressHydrationWarning`&&(a.hasOwnProperty(u)?(l!=null&&u===`onScroll`&&Y(`scroll`,e),o||c===l||(o=[])):(o||=[]).push(u,l))}n&&(o||=[]).push(`style`,n);var u=o;(t.updateQueue=u)&&(t.flags|=4)}},ic=function(e,t,n,r){n!==r&&(t.flags|=4)};function ac(e,t){if(!_a)switch(e.tailMode){case`hidden`:t=e.tail;for(var n=null;t!==null;)t.alternate!==null&&(n=t),t=t.sibling;n===null?e.tail=null:n.sibling=null;break;case`collapsed`:n=e.tail;for(var r=null;n!==null;)n.alternate!==null&&(r=n),n=n.sibling;r===null?t||e.tail===null?e.tail=null:e.tail.sibling=null:r.sibling=null}}function oc(e){var t=e.alternate!==null&&e.alternate.child===e.child,n=0,r=0;if(t)for(var i=e.child;i!==null;)n|=i.lanes|i.childLanes,r|=i.subtreeFlags&14680064,r|=i.flags&14680064,i.return=e,i=i.sibling;else for(i=e.child;i!==null;)n|=i.lanes|i.childLanes,r|=i.subtreeFlags,r|=i.flags,i.return=e,i=i.sibling;return e.subtreeFlags|=r,e.childLanes=n,t}function sc(e,t,n){var i=t.pendingProps;switch(ma(t),t.tag){case 2:case 16:case 15:case 0:case 11:case 7:case 8:case 12:case 9:case 14:return oc(t),null;case 1:return Wi(t.type)&&Gi(),oc(t),null;case 3:return i=t.stateNode,lo(),X(Vi),X(Bi),go(),i.pendingContext&&(i.context=i.pendingContext,i.pendingContext=null),(e===null||e.child===null)&&(wa(t)?t.flags|=4:e===null||e.memoizedState.isDehydrated&&!(t.flags&256)||(t.flags|=1024,va!==null&&(vl(va),va=null))),oc(t),null;case 5:fo(t);var o=so(oo.current);if(n=t.type,e!==null&&t.stateNode!=null)rc(e,t,n,i,o),e.ref!==t.ref&&(t.flags|=512,t.flags|=2097152);else{if(!i){if(t.stateNode===null)throw Error(r(166));return oc(t),null}if(e=so(io.current),wa(t)){i=t.stateNode,n=t.type;var s=t.memoizedProps;switch(i[Ei]=t,i[Di]=s,e=(t.mode&1)!=0,n){case`dialog`:Y(`cancel`,i),Y(`close`,i);break;case`iframe`:case`object`:case`embed`:Y(`load`,i);break;case`video`:case`audio`:for(o=0;o<Xr.length;o++)Y(Xr[o],i);break;case`source`:Y(`error`,i);break;case`img`:case`image`:case`link`:Y(`error`,i),Y(`load`,i);break;case`details`:Y(`toggle`,i);break;case`input`:xe(i,s),Y(`invalid`,i);break;case`select`:i._wrapperState={wasMultiple:!!s.multiple},Y(`invalid`,i);break;case`textarea`:De(i,s),Y(`invalid`,i)}for(var c in ze(n,s),o=null,s)if(s.hasOwnProperty(c)){var l=s[c];c===`children`?typeof l==`string`?i.textContent!==l&&(!0!==s.suppressHydrationWarning&&fi(i.textContent,l,e),o=[`children`,l]):typeof l==`number`&&i.textContent!==``+l&&(!0!==s.suppressHydrationWarning&&fi(i.textContent,l,e),o=[`children`,``+l]):a.hasOwnProperty(c)&&l!=null&&c===`onScroll`&&Y(`scroll`,i)}switch(n){case`input`:M(i),P(i,s,!0);break;case`textarea`:M(i),F(i);break;case`select`:case`option`:break;default:typeof s.onClick==`function`&&(i.onclick=pi)}i=o,t.updateQueue=i,i!==null&&(t.flags|=4)}else{c=o.nodeType===9?o:o.ownerDocument,e===`http://www.w3.org/1999/xhtml`&&(e=ke(n)),e===`http://www.w3.org/1999/xhtml`?n===`script`?(e=c.createElement(`div`),e.innerHTML=`<script><\/script>`,e=e.removeChild(e.firstChild)):typeof i.is==`string`?e=c.createElement(n,{is:i.is}):(e=c.createElement(n),n===`select`&&(c=e,i.multiple?c.multiple=!0:i.size&&(c.size=i.size))):e=c.createElementNS(e,n),e[Ei]=t,e[Di]=i,nc(e,t,!1,!1),t.stateNode=e;a:{switch(c=Be(n,i),n){case`dialog`:Y(`cancel`,e),Y(`close`,e),o=i;break;case`iframe`:case`object`:case`embed`:Y(`load`,e),o=i;break;case`video`:case`audio`:for(o=0;o<Xr.length;o++)Y(Xr[o],e);o=i;break;case`source`:Y(`error`,e),o=i;break;case`img`:case`image`:case`link`:Y(`error`,e),Y(`load`,e),o=i;break;case`details`:Y(`toggle`,e),o=i;break;case`input`:xe(e,i),o=be(e,i),Y(`invalid`,e);break;case`option`:o=i;break;case`select`:e._wrapperState={wasMultiple:!!i.multiple},o=O({},i,{value:void 0}),Y(`invalid`,e);break;case`textarea`:De(e,i),o=Ee(e,i),Y(`invalid`,e);break;default:o=i}for(s in ze(n,o),l=o,l)if(l.hasOwnProperty(s)){var u=l[s];s===`style`?Le(e,u):s===`dangerouslySetInnerHTML`?(u=u?u.__html:void 0,u!=null&&Me(e,u)):s===`children`?typeof u==`string`?(n!==`textarea`||u!==``)&&Ne(e,u):typeof u==`number`&&Ne(e,``+u):s!==`suppressContentEditableWarning`&&s!==`suppressHydrationWarning`&&s!==`autoFocus`&&(a.hasOwnProperty(s)?u!=null&&s===`onScroll`&&Y(`scroll`,e):u!=null&&te(e,s,u,c))}switch(n){case`input`:M(e),P(e,i,!1);break;case`textarea`:M(e),F(e);break;case`option`:i.value!=null&&e.setAttribute(`value`,``+ge(i.value));break;case`select`:e.multiple=!!i.multiple,s=i.value,s==null?i.defaultValue!=null&&Te(e,!!i.multiple,i.defaultValue,!0):Te(e,!!i.multiple,s,!1);break;default:typeof o.onClick==`function`&&(e.onclick=pi)}switch(n){case`button`:case`input`:case`select`:case`textarea`:i=!!i.autoFocus;break a;case`img`:i=!0;break a;default:i=!1}}i&&(t.flags|=4)}t.ref!==null&&(t.flags|=512,t.flags|=2097152)}return oc(t),null;case 6:if(e&&t.stateNode!=null)ic(e,t,e.memoizedProps,i);else{if(typeof i!=`string`&&t.stateNode===null)throw Error(r(166));if(n=so(oo.current),so(io.current),wa(t)){if(i=t.stateNode,n=t.memoizedProps,i[Ei]=t,(s=i.nodeValue!==n)&&(e=ha,e!==null))switch(e.tag){case 3:fi(i.nodeValue,n,(e.mode&1)!=0);break;case 5:!0!==e.memoizedProps.suppressHydrationWarning&&fi(i.nodeValue,n,(e.mode&1)!=0)}s&&(t.flags|=4)}else i=(n.nodeType===9?n:n.ownerDocument).createTextNode(i),i[Ei]=t,t.stateNode=i}return oc(t),null;case 13:if(X(po),i=t.memoizedState,e===null||e.memoizedState!==null&&e.memoizedState.dehydrated!==null){if(_a&&ga!==null&&t.mode&1&&!(t.flags&128))Ta(),Ea(),t.flags|=98560,s=!1;else if(s=wa(t),i!==null&&i.dehydrated!==null){if(e===null){if(!s)throw Error(r(318));if(s=t.memoizedState,s=s===null?null:s.dehydrated,!s)throw Error(r(317));s[Ei]=t}else Ea(),!(t.flags&128)&&(t.memoizedState=null),t.flags|=4;oc(t),s=!1}else va!==null&&(vl(va),va=null),s=!0;if(!s)return t.flags&65536?t:null}return t.flags&128?(t.lanes=n,t):(i=i!==null,i!==(e!==null&&e.memoizedState!==null)&&i&&(t.child.flags|=8192,t.mode&1&&(e===null||po.current&1?Kc===0&&(Kc=3):Ol())),t.updateQueue!==null&&(t.flags|=4),oc(t),null);case 4:return lo(),e===null&&ni(t.stateNode.containerInfo),oc(t),null;case 10:return Ba(t.type._context),oc(t),null;case 17:return Wi(t.type)&&Gi(),oc(t),null;case 19:if(X(po),s=t.memoizedState,s===null)return oc(t),null;if(i=(t.flags&128)!=0,c=s.rendering,c===null)if(i)ac(s,!1);else{if(Kc!==0||e!==null&&e.flags&128)for(e=t.child;e!==null;){if(c=mo(e),c!==null){for(t.flags|=128,ac(s,!1),i=c.updateQueue,i!==null&&(t.updateQueue=i,t.flags|=4),t.subtreeFlags=0,i=n,n=t.child;n!==null;)s=n,e=i,s.flags&=14680066,c=s.alternate,c===null?(s.childLanes=0,s.lanes=e,s.child=null,s.subtreeFlags=0,s.memoizedProps=null,s.memoizedState=null,s.updateQueue=null,s.dependencies=null,s.stateNode=null):(s.childLanes=c.childLanes,s.lanes=c.lanes,s.child=c.child,s.subtreeFlags=0,s.deletions=null,s.memoizedProps=c.memoizedProps,s.memoizedState=c.memoizedState,s.updateQueue=c.updateQueue,s.type=c.type,e=c.dependencies,s.dependencies=e===null?null:{lanes:e.lanes,firstContext:e.firstContext}),n=n.sibling;return Z(po,po.current&1|2),t.child}e=e.sibling}s.tail!==null&&ut()>el&&(t.flags|=128,i=!0,ac(s,!1),t.lanes=4194304)}else{if(!i)if(e=mo(c),e!==null){if(t.flags|=128,i=!0,n=e.updateQueue,n!==null&&(t.updateQueue=n,t.flags|=4),ac(s,!0),s.tail===null&&s.tailMode===`hidden`&&!c.alternate&&!_a)return oc(t),null}else 2*ut()-s.renderingStartTime>el&&n!==1073741824&&(t.flags|=128,i=!0,ac(s,!1),t.lanes=4194304);s.isBackwards?(c.sibling=t.child,t.child=c):(n=s.last,n===null?t.child=c:n.sibling=c,s.last=c)}return s.tail===null?(oc(t),null):(t=s.tail,s.rendering=t,s.tail=t.sibling,s.renderingStartTime=ut(),t.sibling=null,n=po.current,Z(po,i?n&1|2:n&1),t);case 22:case 23:return wl(),i=t.memoizedState!==null,e!==null&&e.memoizedState!==null!==i&&(t.flags|=8192),i&&t.mode&1?Wc&1073741824&&(oc(t),t.subtreeFlags&6&&(t.flags|=8192)):oc(t),null;case 24:return null;case 25:return null}throw Error(r(156,t.tag))}function cc(e,t){switch(ma(t),t.tag){case 1:return Wi(t.type)&&Gi(),e=t.flags,e&65536?(t.flags=e&-65537|128,t):null;case 3:return lo(),X(Vi),X(Bi),go(),e=t.flags,e&65536&&!(e&128)?(t.flags=e&-65537|128,t):null;case 5:return fo(t),null;case 13:if(X(po),e=t.memoizedState,e!==null&&e.dehydrated!==null){if(t.alternate===null)throw Error(r(340));Ea()}return e=t.flags,e&65536?(t.flags=e&-65537|128,t):null;case 19:return X(po),null;case 4:return lo(),null;case 10:return Ba(t.type._context),null;case 22:case 23:return wl(),null;case 24:return null;default:return null}}var lc=!1,uc=!1,dc=typeof WeakSet==`function`?WeakSet:Set,Q=null;function fc(e,t){var n=e.ref;if(n!==null)if(typeof n==`function`)try{n(null)}catch(n){Rl(e,t,n)}else n.current=null}function pc(e,t,n){try{n()}catch(n){Rl(e,t,n)}}var mc=!1;function hc(e,t){if(mi=cn,e=Or(),kr(e)){if(`selectionStart`in e)var n={start:e.selectionStart,end:e.selectionEnd};else a:{n=(n=e.ownerDocument)&&n.defaultView||window;var i=n.getSelection&&n.getSelection();if(i&&i.rangeCount!==0){n=i.anchorNode;var a=i.anchorOffset,o=i.focusNode;i=i.focusOffset;try{n.nodeType,o.nodeType}catch{n=null;break a}var s=0,c=-1,l=-1,u=0,d=0,f=e,p=null;b:for(;;){for(var m;f!==n||a!==0&&f.nodeType!==3||(c=s+a),f!==o||i!==0&&f.nodeType!==3||(l=s+i),f.nodeType===3&&(s+=f.nodeValue.length),(m=f.firstChild)!==null;)p=f,f=m;for(;;){if(f===e)break b;if(p===n&&++u===a&&(c=s),p===o&&++d===i&&(l=s),(m=f.nextSibling)!==null)break;f=p,p=f.parentNode}f=m}n=c===-1||l===-1?null:{start:c,end:l}}else n=null}n||={start:0,end:0}}else n=null;for(hi={focusedElem:e,selectionRange:n},cn=!1,Q=t;Q!==null;)if(t=Q,e=t.child,t.subtreeFlags&1028&&e!==null)e.return=t,Q=e;else for(;Q!==null;){t=Q;try{var h=t.alternate;if(t.flags&1024)switch(t.tag){case 0:case 11:case 15:break;case 1:if(h!==null){var g=h.memoizedProps,_=h.memoizedState,v=t.stateNode;v.__reactInternalSnapshotBeforeUpdate=v.getSnapshotBeforeUpdate(t.elementType===t.type?g:hs(t.type,g),_)}break;case 3:var y=t.stateNode.containerInfo;y.nodeType===1?y.textContent=``:y.nodeType===9&&y.documentElement&&y.removeChild(y.documentElement);break;case 5:case 6:case 4:case 17:break;default:throw Error(r(163))}}catch(e){Rl(t,t.return,e)}if(e=t.sibling,e!==null){e.return=t.return,Q=e;break}Q=t.return}return h=mc,mc=!1,h}function gc(e,t,n){var r=t.updateQueue;if(r=r===null?null:r.lastEffect,r!==null){var i=r=r.next;do{if((i.tag&e)===e){var a=i.destroy;i.destroy=void 0,a!==void 0&&pc(t,n,a)}i=i.next}while(i!==r)}}function _c(e,t){if(t=t.updateQueue,t=t===null?null:t.lastEffect,t!==null){var n=t=t.next;do{if((n.tag&e)===e){var r=n.create;n.destroy=r()}n=n.next}while(n!==t)}}function vc(e){var t=e.ref;if(t!==null){var n=e.stateNode;switch(e.tag){case 5:e=n;break;default:e=n}typeof t==`function`?t(e):t.current=e}}function yc(e){var t=e.alternate;t!==null&&(e.alternate=null,yc(t)),e.child=null,e.deletions=null,e.sibling=null,e.tag===5&&(t=e.stateNode,t!==null&&(delete t[Ei],delete t[Di],delete t[ki],delete t[Ai],delete t[ji])),e.stateNode=null,e.return=null,e.dependencies=null,e.memoizedProps=null,e.memoizedState=null,e.pendingProps=null,e.stateNode=null,e.updateQueue=null}function bc(e){return e.tag===5||e.tag===3||e.tag===4}function xc(e){a:for(;;){for(;e.sibling===null;){if(e.return===null||bc(e.return))return null;e=e.return}for(e.sibling.return=e.return,e=e.sibling;e.tag!==5&&e.tag!==6&&e.tag!==18;){if(e.flags&2||e.child===null||e.tag===4)continue a;e.child.return=e,e=e.child}if(!(e.flags&2))return e.stateNode}}function Sc(e,t,n){var r=e.tag;if(r===5||r===6)e=e.stateNode,t?n.nodeType===8?n.parentNode.insertBefore(e,t):n.insertBefore(e,t):(n.nodeType===8?(t=n.parentNode,t.insertBefore(e,n)):(t=n,t.appendChild(e)),n=n._reactRootContainer,n!=null||t.onclick!==null||(t.onclick=pi));else if(r!==4&&(e=e.child,e!==null))for(Sc(e,t,n),e=e.sibling;e!==null;)Sc(e,t,n),e=e.sibling}function Cc(e,t,n){var r=e.tag;if(r===5||r===6)e=e.stateNode,t?n.insertBefore(e,t):n.appendChild(e);else if(r!==4&&(e=e.child,e!==null))for(Cc(e,t,n),e=e.sibling;e!==null;)Cc(e,t,n),e=e.sibling}var wc=null,Tc=!1;function Ec(e,t,n){for(n=n.child;n!==null;)Dc(e,t,n),n=n.sibling}function Dc(e,t,n){if(vt&&typeof vt.onCommitFiberUnmount==`function`)try{vt.onCommitFiberUnmount(_t,n)}catch{}switch(n.tag){case 5:uc||fc(n,t);case 6:var r=wc,i=Tc;wc=null,Ec(e,t,n),wc=r,Tc=i,wc!==null&&(Tc?(e=wc,n=n.stateNode,e.nodeType===8?e.parentNode.removeChild(n):e.removeChild(n)):wc.removeChild(n.stateNode));break;case 18:wc!==null&&(Tc?(e=wc,n=n.stateNode,e.nodeType===8?Si(e.parentNode,n):e.nodeType===1&&Si(e,n),on(e)):Si(wc,n.stateNode));break;case 4:r=wc,i=Tc,wc=n.stateNode.containerInfo,Tc=!0,Ec(e,t,n),wc=r,Tc=i;break;case 0:case 11:case 14:case 15:if(!uc&&(r=n.updateQueue,r!==null&&(r=r.lastEffect,r!==null))){i=r=r.next;do{var a=i,o=a.destroy;a=a.tag,o!==void 0&&(a&2||a&4)&&pc(n,t,o),i=i.next}while(i!==r)}Ec(e,t,n);break;case 1:if(!uc&&(fc(n,t),r=n.stateNode,typeof r.componentWillUnmount==`function`))try{r.props=n.memoizedProps,r.state=n.memoizedState,r.componentWillUnmount()}catch(e){Rl(n,t,e)}Ec(e,t,n);break;case 21:Ec(e,t,n);break;case 22:n.mode&1?(uc=(r=uc)||n.memoizedState!==null,Ec(e,t,n),uc=r):Ec(e,t,n);break;default:Ec(e,t,n)}}function Oc(e){var t=e.updateQueue;if(t!==null){e.updateQueue=null;var n=e.stateNode;n===null&&(n=e.stateNode=new dc),t.forEach(function(t){var r=Hl.bind(null,e,t);n.has(t)||(n.add(t),t.then(r,r))})}}function kc(e,t){var n=t.deletions;if(n!==null)for(var i=0;i<n.length;i++){var a=n[i];try{var o=e,s=t,c=s;a:for(;c!==null;){switch(c.tag){case 5:wc=c.stateNode,Tc=!1;break a;case 3:wc=c.stateNode.containerInfo,Tc=!0;break a;case 4:wc=c.stateNode.containerInfo,Tc=!0;break a}c=c.return}if(wc===null)throw Error(r(160));Dc(o,s,a),wc=null,Tc=!1;var l=a.alternate;l!==null&&(l.return=null),a.return=null}catch(e){Rl(a,t,e)}}if(t.subtreeFlags&12854)for(t=t.child;t!==null;)Ac(t,e),t=t.sibling}function Ac(e,t){var n=e.alternate,i=e.flags;switch(e.tag){case 0:case 11:case 14:case 15:if(kc(t,e),jc(e),i&4){try{gc(3,e,e.return),_c(3,e)}catch(t){Rl(e,e.return,t)}try{gc(5,e,e.return)}catch(t){Rl(e,e.return,t)}}break;case 1:kc(t,e),jc(e),i&512&&n!==null&&fc(n,n.return);break;case 5:if(kc(t,e),jc(e),i&512&&n!==null&&fc(n,n.return),e.flags&32){var a=e.stateNode;try{Ne(a,``)}catch(t){Rl(e,e.return,t)}}if(i&4&&(a=e.stateNode,a!=null)){var o=e.memoizedProps,s=n===null?o:n.memoizedProps,c=e.type,l=e.updateQueue;if(e.updateQueue=null,l!==null)try{c===`input`&&o.type===`radio`&&o.name!=null&&Se(a,o),Be(c,s);var u=Be(c,o);for(s=0;s<l.length;s+=2){var d=l[s],f=l[s+1];d===`style`?Le(a,f):d===`dangerouslySetInnerHTML`?Me(a,f):d===`children`?Ne(a,f):te(a,d,f,u)}switch(c){case`input`:N(a,o);break;case`textarea`:Oe(a,o);break;case`select`:var p=a._wrapperState.wasMultiple;a._wrapperState.wasMultiple=!!o.multiple;var m=o.value;m==null?p!==!!o.multiple&&(o.defaultValue==null?Te(a,!!o.multiple,o.multiple?[]:``,!1):Te(a,!!o.multiple,o.defaultValue,!0)):Te(a,!!o.multiple,m,!1)}a[Di]=o}catch(t){Rl(e,e.return,t)}}break;case 6:if(kc(t,e),jc(e),i&4){if(e.stateNode===null)throw Error(r(162));a=e.stateNode,o=e.memoizedProps;try{a.nodeValue=o}catch(t){Rl(e,e.return,t)}}break;case 3:if(kc(t,e),jc(e),i&4&&n!==null&&n.memoizedState.isDehydrated)try{on(t.containerInfo)}catch(t){Rl(e,e.return,t)}break;case 4:kc(t,e),jc(e);break;case 13:kc(t,e),jc(e),a=e.child,a.flags&8192&&(o=a.memoizedState!==null,a.stateNode.isHidden=o,!o||a.alternate!==null&&a.alternate.memoizedState!==null||($c=ut())),i&4&&Oc(e);break;case 22:if(d=n!==null&&n.memoizedState!==null,e.mode&1?(uc=(u=uc)||d,kc(t,e),uc=u):kc(t,e),jc(e),i&8192){if(u=e.memoizedState!==null,(e.stateNode.isHidden=u)&&!d&&e.mode&1)for(Q=e,d=e.child;d!==null;){for(f=Q=d;Q!==null;){switch(p=Q,m=p.child,p.tag){case 0:case 11:case 14:case 15:gc(4,p,p.return);break;case 1:fc(p,p.return);var h=p.stateNode;if(typeof h.componentWillUnmount==`function`){i=p,n=p.return;try{t=i,h.props=t.memoizedProps,h.state=t.memoizedState,h.componentWillUnmount()}catch(e){Rl(i,n,e)}}break;case 5:fc(p,p.return);break;case 22:if(p.memoizedState!==null){Fc(f);continue}}m===null?Fc(f):(m.return=p,Q=m)}d=d.sibling}a:for(d=null,f=e;;){if(f.tag===5){if(d===null){d=f;try{a=f.stateNode,u?(o=a.style,typeof o.setProperty==`function`?o.setProperty(`display`,`none`,`important`):o.display=`none`):(c=f.stateNode,l=f.memoizedProps.style,s=l!=null&&l.hasOwnProperty(`display`)?l.display:null,c.style.display=Ie(`display`,s))}catch(t){Rl(e,e.return,t)}}}else if(f.tag===6){if(d===null)try{f.stateNode.nodeValue=u?``:f.memoizedProps}catch(t){Rl(e,e.return,t)}}else if((f.tag!==22&&f.tag!==23||f.memoizedState===null||f===e)&&f.child!==null){f.child.return=f,f=f.child;continue}if(f===e)break a;for(;f.sibling===null;){if(f.return===null||f.return===e)break a;d===f&&(d=null),f=f.return}d===f&&(d=null),f.sibling.return=f.return,f=f.sibling}}break;case 19:kc(t,e),jc(e),i&4&&Oc(e);break;case 21:break;default:kc(t,e),jc(e)}}function jc(e){var t=e.flags;if(t&2){try{a:{for(var n=e.return;n!==null;){if(bc(n)){var i=n;break a}n=n.return}throw Error(r(160))}switch(i.tag){case 5:var a=i.stateNode;i.flags&32&&(Ne(a,``),i.flags&=-33),Cc(e,xc(e),a);break;case 3:case 4:var o=i.stateNode.containerInfo;Sc(e,xc(e),o);break;default:throw Error(r(161))}}catch(t){Rl(e,e.return,t)}e.flags&=-3}t&4096&&(e.flags&=-4097)}function Mc(e,t,n){Q=e,Nc(e,t,n)}function Nc(e,t,n){for(var r=(e.mode&1)!=0;Q!==null;){var i=Q,a=i.child;if(i.tag===22&&r){var o=i.memoizedState!==null||lc;if(!o){var s=i.alternate,c=s!==null&&s.memoizedState!==null||uc;s=lc;var l=uc;if(lc=o,(uc=c)&&!l)for(Q=i;Q!==null;)o=Q,c=o.child,o.tag===22&&o.memoizedState!==null||c===null?Ic(i):(c.return=o,Q=c);for(;a!==null;)Q=a,Nc(a,t,n),a=a.sibling;Q=i,lc=s,uc=l}Pc(e,t,n)}else i.subtreeFlags&8772&&a!==null?(a.return=i,Q=a):Pc(e,t,n)}}function Pc(e){for(;Q!==null;){var t=Q;if(t.flags&8772){var n=t.alternate;try{if(t.flags&8772)switch(t.tag){case 0:case 11:case 15:uc||_c(5,t);break;case 1:var i=t.stateNode;if(t.flags&4&&!uc)if(n===null)i.componentDidMount();else{var a=t.elementType===t.type?n.memoizedProps:hs(t.type,n.memoizedProps);i.componentDidUpdate(a,n.memoizedState,i.__reactInternalSnapshotBeforeUpdate)}var o=t.updateQueue;o!==null&&no(t,o,i);break;case 3:var s=t.updateQueue;if(s!==null){if(n=null,t.child!==null)switch(t.child.tag){case 5:n=t.child.stateNode;break;case 1:n=t.child.stateNode}no(t,s,n)}break;case 5:var c=t.stateNode;if(n===null&&t.flags&4){n=c;var l=t.memoizedProps;switch(t.type){case`button`:case`input`:case`select`:case`textarea`:l.autoFocus&&n.focus();break;case`img`:l.src&&(n.src=l.src)}}break;case 6:break;case 4:break;case 12:break;case 13:if(t.memoizedState===null){var u=t.alternate;if(u!==null){var d=u.memoizedState;if(d!==null){var f=d.dehydrated;f!==null&&on(f)}}}break;case 19:case 17:case 21:case 22:case 23:case 25:break;default:throw Error(r(163))}uc||t.flags&512&&vc(t)}catch(e){Rl(t,t.return,e)}}if(t===e){Q=null;break}if(n=t.sibling,n!==null){n.return=t.return,Q=n;break}Q=t.return}}function Fc(e){for(;Q!==null;){var t=Q;if(t===e){Q=null;break}var n=t.sibling;if(n!==null){n.return=t.return,Q=n;break}Q=t.return}}function Ic(e){for(;Q!==null;){var t=Q;try{switch(t.tag){case 0:case 11:case 15:var n=t.return;try{_c(4,t)}catch(e){Rl(t,n,e)}break;case 1:var r=t.stateNode;if(typeof r.componentDidMount==`function`){var i=t.return;try{r.componentDidMount()}catch(e){Rl(t,i,e)}}var a=t.return;try{vc(t)}catch(e){Rl(t,a,e)}break;case 5:var o=t.return;try{vc(t)}catch(e){Rl(t,o,e)}}}catch(e){Rl(t,t.return,e)}if(t===e){Q=null;break}var s=t.sibling;if(s!==null){s.return=t.return,Q=s;break}Q=t.return}}var Lc=Math.ceil,Rc=x.ReactCurrentDispatcher,zc=x.ReactCurrentOwner,Bc=x.ReactCurrentBatchConfig,$=0,Vc=null,Hc=null,Uc=0,Wc=0,Gc=Ri(0),Kc=0,qc=null,Jc=0,Yc=0,Xc=0,Zc=null,Qc=null,$c=0,el=1/0,tl=null,nl=!1,rl=null,il=null,al=!1,ol=null,sl=0,cl=0,ll=null,ul=-1,dl=0;function fl(){return $&6?ut():ul===-1?ul=ut():ul}function pl(e){return e.mode&1?$&2&&Uc!==0?Uc&-Uc:Oa.transition===null?(e=K,e===0?(e=window.event,e=e===void 0?16:mn(e.type),e):e):(dl===0&&(dl=jt()),dl):1}function ml(e,t,n,i){if(50<cl)throw cl=0,ll=null,Error(r(185));Nt(e,n,i),(!($&2)||e!==Vc)&&(e===Vc&&(!($&2)&&(Yc|=n),Kc===4&&bl(e,Uc)),hl(e,i),n===1&&$===0&&!(t.mode&1)&&(el=ut()+500,Zi&&ta()))}function hl(e,t){var n=e.callbackNode;kt(e,t);var r=Dt(e,e===Vc?Uc:0);if(r===0)n!==null&&st(n),e.callbackNode=null,e.callbackPriority=0;else if(t=r&-r,e.callbackPriority!==t){if(n!=null&&st(n),t===1)e.tag===0?ea(xl.bind(null,e)):$i(xl.bind(null,e)),bi(function(){!($&6)&&ta()}),n=null;else{switch(It(r)){case 1:n=ft;break;case 4:n=pt;break;case 16:n=mt;break;case 536870912:n=gt;break;default:n=mt}n=Wl(n,gl.bind(null,e))}e.callbackPriority=t,e.callbackNode=n}}function gl(e,t){if(ul=-1,dl=0,$&6)throw Error(r(327));var n=e.callbackNode;if(Il()&&e.callbackNode!==n)return null;var i=Dt(e,e===Vc?Uc:0);if(i===0)return null;if(i&30||(i&e.expiredLanes)!==0||t)t=kl(e,i);else{t=i;var a=$;$|=2;var o=Dl();(Vc!==e||Uc!==t)&&(tl=null,el=ut()+500,Tl(e,t));do try{jl();break}catch(t){El(e,t)}while(1);za(),Rc.current=o,$=a,Hc===null?(Vc=null,Uc=0,t=Kc):t=0}if(t!==0){if(t===2&&(a=At(e),a!==0&&(i=a,t=_l(e,a))),t===1)throw n=qc,Tl(e,0),bl(e,i),hl(e,ut()),n;if(t===6)bl(e,i);else{if(a=e.current.alternate,!(i&30)&&!yl(a)&&(t=kl(e,i),t===2&&(o=At(e),o!==0&&(i=o,t=_l(e,o))),t===1))throw n=qc,Tl(e,0),bl(e,i),hl(e,ut()),n;switch(e.finishedWork=a,e.finishedLanes=i,t){case 0:case 1:throw Error(r(345));case 2:Pl(e,Qc,tl);break;case 3:if(bl(e,i),(i&130023424)===i&&(t=$c+500-ut(),10<t)){if(Dt(e,0)!==0)break;if(a=e.suspendedLanes,(a&i)!==i){fl(),e.pingedLanes|=e.suspendedLanes&a;break}e.timeoutHandle=_i(Pl.bind(null,e,Qc,tl),t);break}Pl(e,Qc,tl);break;case 4:if(bl(e,i),(i&4194240)===i)break;for(t=e.eventTimes,a=-1;0<i;){var s=31-bt(i);o=1<<s,s=t[s],s>a&&(a=s),i&=~o}if(i=a,i=ut()-i,i=(120>i?120:480>i?480:1080>i?1080:1920>i?1920:3e3>i?3e3:4320>i?4320:1960*Lc(i/1960))-i,10<i){e.timeoutHandle=_i(Pl.bind(null,e,Qc,tl),i);break}Pl(e,Qc,tl);break;case 5:Pl(e,Qc,tl);break;default:throw Error(r(329))}}}return hl(e,ut()),e.callbackNode===n?gl.bind(null,e):null}function _l(e,t){var n=Zc;return e.current.memoizedState.isDehydrated&&(Tl(e,t).flags|=256),e=kl(e,t),e!==2&&(t=Qc,Qc=n,t!==null&&vl(t)),e}function vl(e){Qc===null?Qc=e:Qc.push.apply(Qc,e)}function yl(e){for(var t=e;;){if(t.flags&16384){var n=t.updateQueue;if(n!==null&&(n=n.stores,n!==null))for(var r=0;r<n.length;r++){var i=n[r],a=i.getSnapshot;i=i.value;try{if(!wr(a(),i))return!1}catch{return!1}}}if(n=t.child,t.subtreeFlags&16384&&n!==null)n.return=t,t=n;else{if(t===e)break;for(;t.sibling===null;){if(t.return===null||t.return===e)return!0;t=t.return}t.sibling.return=t.return,t=t.sibling}}return!0}function bl(e,t){for(t&=~Xc,t&=~Yc,e.suspendedLanes|=t,e.pingedLanes&=~t,e=e.expirationTimes;0<t;){var n=31-bt(t),r=1<<n;e[n]=-1,t&=~r}}function xl(e){if($&6)throw Error(r(327));Il();var t=Dt(e,0);if(!(t&1))return hl(e,ut()),null;var n=kl(e,t);if(e.tag!==0&&n===2){var i=At(e);i!==0&&(t=i,n=_l(e,i))}if(n===1)throw n=qc,Tl(e,0),bl(e,t),hl(e,ut()),n;if(n===6)throw Error(r(345));return e.finishedWork=e.current.alternate,e.finishedLanes=t,Pl(e,Qc,tl),hl(e,ut()),null}function Sl(e,t){var n=$;$|=1;try{return e(t)}finally{$=n,$===0&&(el=ut()+500,Zi&&ta())}}function Cl(e){ol!==null&&ol.tag===0&&!($&6)&&Il();var t=$;$|=1;var n=Bc.transition,r=K;try{if(Bc.transition=null,K=1,e)return e()}finally{K=r,Bc.transition=n,$=t,!($&6)&&ta()}}function wl(){Wc=Gc.current,X(Gc)}function Tl(e,t){e.finishedWork=null,e.finishedLanes=0;var n=e.timeoutHandle;if(n!==-1&&(e.timeoutHandle=-1,vi(n)),Hc!==null)for(n=Hc.return;n!==null;){var r=n;switch(ma(r),r.tag){case 1:r=r.type.childContextTypes,r!=null&&Gi();break;case 3:lo(),X(Vi),X(Bi),go();break;case 5:fo(r);break;case 4:lo();break;case 13:X(po);break;case 19:X(po);break;case 10:Ba(r.type._context);break;case 22:case 23:wl()}n=n.return}if(Vc=e,Hc=e=Yl(e.current,null),Uc=Wc=t,Kc=0,qc=null,Xc=Yc=Jc=0,Qc=Zc=null,Wa!==null){for(t=0;t<Wa.length;t++)if(n=Wa[t],r=n.interleaved,r!==null){n.interleaved=null;var i=r.next,a=n.pending;if(a!==null){var o=a.next;a.next=i,r.next=o}n.pending=r}Wa=null}return e}function El(e,t){do{var n=Hc;try{if(za(),_o.current=ds,Co){for(var i=bo.memoizedState;i!==null;){var a=i.queue;a!==null&&(a.pending=null),i=i.next}Co=!1}if(yo=0,So=xo=bo=null,wo=!1,To=0,zc.current=null,n===null||n.return===null){Kc=1,qc=t,Hc=null;break}a:{var o=e,s=n.return,c=n,l=t;if(t=Uc,c.flags|=32768,typeof l==`object`&&l&&typeof l.then==`function`){var u=l,d=c,f=d.tag;if(!(d.mode&1)&&(f===0||f===11||f===15)){var p=d.alternate;p?(d.updateQueue=p.updateQueue,d.memoizedState=p.memoizedState,d.lanes=p.lanes):(d.updateQueue=null,d.memoizedState=null)}var m=ks(s);if(m!==null){m.flags&=-257,As(m,s,c,o,t),m.mode&1&&Os(o,u,t),t=m,l=u;var h=t.updateQueue;if(h===null){var g=new Set;g.add(l),t.updateQueue=g}else h.add(l);break a}else{if(!(t&1)){Os(o,u,t),Ol();break a}l=Error(r(426))}}else if(_a&&c.mode&1){var _=ks(s);if(_!==null){!(_.flags&65536)&&(_.flags|=256),As(_,s,c,o,t),Da(Ss(l,c));break a}}o=l=Ss(l,c),Kc!==4&&(Kc=2),Zc===null?Zc=[o]:Zc.push(o),o=s;do{switch(o.tag){case 3:o.flags|=65536,t&=-t,o.lanes|=t;var v=Es(o,l,t);eo(o,v);break a;case 1:c=l;var y=o.type,b=o.stateNode;if(!(o.flags&128)&&(typeof y.getDerivedStateFromError==`function`||b!==null&&typeof b.componentDidCatch==`function`&&(il===null||!il.has(b)))){o.flags|=65536,t&=-t,o.lanes|=t;var ee=Ds(o,c,t);eo(o,ee);break a}}o=o.return}while(o!==null)}Nl(n)}catch(e){t=e,Hc===n&&n!==null&&(Hc=n=n.return);continue}break}while(1)}function Dl(){var e=Rc.current;return Rc.current=ds,e===null?ds:e}function Ol(){(Kc===0||Kc===3||Kc===2)&&(Kc=4),Vc===null||!(Jc&268435455)&&!(Yc&268435455)||bl(Vc,Uc)}function kl(e,t){var n=$;$|=2;var i=Dl();(Vc!==e||Uc!==t)&&(tl=null,Tl(e,t));do try{Al();break}catch(t){El(e,t)}while(1);if(za(),$=n,Rc.current=i,Hc!==null)throw Error(r(261));return Vc=null,Uc=0,Kc}function Al(){for(;Hc!==null;)Ml(Hc)}function jl(){for(;Hc!==null&&!ct();)Ml(Hc)}function Ml(e){var t=Ul(e.alternate,e,Wc);e.memoizedProps=e.pendingProps,t===null?Nl(e):Hc=t,zc.current=null}function Nl(e){var t=e;do{var n=t.alternate;if(e=t.return,t.flags&32768){if(n=cc(n,t),n!==null){n.flags&=32767,Hc=n;return}if(e!==null)e.flags|=32768,e.subtreeFlags=0,e.deletions=null;else{Kc=6,Hc=null;return}}else if(n=sc(n,t,Wc),n!==null){Hc=n;return}if(t=t.sibling,t!==null){Hc=t;return}Hc=t=e}while(t!==null);Kc===0&&(Kc=5)}function Pl(e,t,n){var r=K,i=Bc.transition;try{Bc.transition=null,K=1,Fl(e,t,n,r)}finally{Bc.transition=i,K=r}return null}function Fl(e,t,n,i){do Il();while(ol!==null);if($&6)throw Error(r(327));n=e.finishedWork;var a=e.finishedLanes;if(n===null)return null;if(e.finishedWork=null,e.finishedLanes=0,n===e.current)throw Error(r(177));e.callbackNode=null,e.callbackPriority=0;var o=n.lanes|n.childLanes;if(Pt(e,o),e===Vc&&(Hc=Vc=null,Uc=0),!(n.subtreeFlags&2064)&&!(n.flags&2064)||al||(al=!0,Wl(mt,function(){return Il(),null})),o=(n.flags&15990)!=0,n.subtreeFlags&15990||o){o=Bc.transition,Bc.transition=null;var s=K;K=1;var c=$;$|=4,zc.current=null,hc(e,n),Ac(n,e),Ar(hi),cn=!!mi,hi=mi=null,e.current=n,Mc(n,e,a),lt(),$=c,K=s,Bc.transition=o}else e.current=n;if(al&&(al=!1,ol=e,sl=a),o=e.pendingLanes,o===0&&(il=null),yt(n.stateNode,i),hl(e,ut()),t!==null)for(i=e.onRecoverableError,n=0;n<t.length;n++)a=t[n],i(a.value,{componentStack:a.stack,digest:a.digest});if(nl)throw nl=!1,e=rl,rl=null,e;return sl&1&&e.tag!==0&&Il(),o=e.pendingLanes,o&1?e===ll?cl++:(cl=0,ll=e):cl=0,ta(),null}function Il(){if(ol!==null){var e=It(sl),t=Bc.transition,n=K;try{if(Bc.transition=null,K=16>e?16:e,ol===null)var i=!1;else{if(e=ol,ol=null,sl=0,$&6)throw Error(r(331));var a=$;for($|=4,Q=e.current;Q!==null;){var o=Q,s=o.child;if(Q.flags&16){var c=o.deletions;if(c!==null){for(var l=0;l<c.length;l++){var u=c[l];for(Q=u;Q!==null;){var d=Q;switch(d.tag){case 0:case 11:case 15:gc(8,d,o)}var f=d.child;if(f!==null)f.return=d,Q=f;else for(;Q!==null;){d=Q;var p=d.sibling,m=d.return;if(yc(d),d===u){Q=null;break}if(p!==null){p.return=m,Q=p;break}Q=m}}}var h=o.alternate;if(h!==null){var g=h.child;if(g!==null){h.child=null;do{var _=g.sibling;g.sibling=null,g=_}while(g!==null)}}Q=o}}if(o.subtreeFlags&2064&&s!==null)s.return=o,Q=s;else b:for(;Q!==null;){if(o=Q,o.flags&2048)switch(o.tag){case 0:case 11:case 15:gc(9,o,o.return)}var v=o.sibling;if(v!==null){v.return=o.return,Q=v;break b}Q=o.return}}var y=e.current;for(Q=y;Q!==null;){s=Q;var b=s.child;if(s.subtreeFlags&2064&&b!==null)b.return=s,Q=b;else b:for(s=y;Q!==null;){if(c=Q,c.flags&2048)try{switch(c.tag){case 0:case 11:case 15:_c(9,c)}}catch(e){Rl(c,c.return,e)}if(c===s){Q=null;break b}var ee=c.sibling;if(ee!==null){ee.return=c.return,Q=ee;break b}Q=c.return}}if($=a,ta(),vt&&typeof vt.onPostCommitFiberRoot==`function`)try{vt.onPostCommitFiberRoot(_t,e)}catch{}i=!0}return i}finally{K=n,Bc.transition=t}}return!1}function Ll(e,t,n){t=Ss(n,t),t=Es(e,t,1),e=Qa(e,t,1),t=fl(),e!==null&&(Nt(e,1,t),hl(e,t))}function Rl(e,t,n){if(e.tag===3)Ll(e,e,n);else for(;t!==null;){if(t.tag===3){Ll(t,e,n);break}else if(t.tag===1){var r=t.stateNode;if(typeof t.type.getDerivedStateFromError==`function`||typeof r.componentDidCatch==`function`&&(il===null||!il.has(r))){e=Ss(n,e),e=Ds(t,e,1),t=Qa(t,e,1),e=fl(),t!==null&&(Nt(t,1,e),hl(t,e));break}}t=t.return}}function zl(e,t,n){var r=e.pingCache;r!==null&&r.delete(t),t=fl(),e.pingedLanes|=e.suspendedLanes&n,Vc===e&&(Uc&n)===n&&(Kc===4||Kc===3&&(Uc&130023424)===Uc&&500>ut()-$c?Tl(e,0):Xc|=n),hl(e,t)}function Bl(e,t){t===0&&(e.mode&1?(t=Tt,Tt<<=1,!(Tt&130023424)&&(Tt=4194304)):t=1);var n=fl();e=qa(e,t),e!==null&&(Nt(e,t,n),hl(e,n))}function Vl(e){var t=e.memoizedState,n=0;t!==null&&(n=t.retryLane),Bl(e,n)}function Hl(e,t){var n=0;switch(e.tag){case 13:var i=e.stateNode,a=e.memoizedState;a!==null&&(n=a.retryLane);break;case 19:i=e.stateNode;break;default:throw Error(r(314))}i!==null&&i.delete(t),Bl(e,n)}var Ul=function(e,t,n){if(e!==null)if(e.memoizedProps!==t.pendingProps||Vi.current)Ms=!0;else{if((e.lanes&n)===0&&!(t.flags&128))return Ms=!1,tc(e,t,n);Ms=!!(e.flags&131072)}else Ms=!1,_a&&t.flags&1048576&&fa(t,aa,t.index);switch(t.lanes=0,t.tag){case 2:var i=t.type;$s(e,t),e=t.pendingProps;var a=Ui(t,Bi.current);Ha(t,n),a=ko(null,t,i,e,a,n);var o=Ao();return t.flags|=1,typeof a==`object`&&a&&typeof a.render==`function`&&a.$$typeof===void 0?(t.tag=1,t.memoizedState=null,t.updateQueue=null,Wi(i)?(o=!0,Ji(t)):o=!1,t.memoizedState=a.state!==null&&a.state!==void 0?a.state:null,Ya(t),a.updater=_s,t.stateNode=a,a._reactInternals=t,xs(t,i,e,n),t=Vs(null,t,i,!0,o,n)):(t.tag=0,_a&&o&&pa(t),Ns(null,t,a,n),t=t.child),t;case 16:i=t.elementType;a:{switch($s(e,t),e=t.pendingProps,a=i._init,i=a(i._payload),t.type=i,a=t.tag=Jl(i),e=hs(i,e),a){case 0:t=zs(null,t,i,e,n);break a;case 1:t=Bs(null,t,i,e,n);break a;case 11:t=Ps(null,t,i,e,n);break a;case 14:t=Fs(null,t,i,hs(i.type,e),n);break a}throw Error(r(306,i,``))}return t;case 0:return i=t.type,a=t.pendingProps,a=t.elementType===i?a:hs(i,a),zs(e,t,i,a,n);case 1:return i=t.type,a=t.pendingProps,a=t.elementType===i?a:hs(i,a),Bs(e,t,i,a,n);case 3:a:{if(Hs(t),e===null)throw Error(r(387));i=t.pendingProps,o=t.memoizedState,a=o.element,Xa(e,t),to(t,i,null,n);var s=t.memoizedState;if(i=s.element,o.isDehydrated)if(o={element:i,isDehydrated:!1,cache:s.cache,pendingSuspenseBoundaries:s.pendingSuspenseBoundaries,transitions:s.transitions},t.updateQueue.baseState=o,t.memoizedState=o,t.flags&256){a=Ss(Error(r(423)),t),t=Us(e,t,i,n,a);break a}else if(i!==a){a=Ss(Error(r(424)),t),t=Us(e,t,i,n,a);break a}else for(ga=Ci(t.stateNode.containerInfo.firstChild),ha=t,_a=!0,va=null,n=Pa(t,null,i,n),t.child=n;n;)n.flags=n.flags&-3|4096,n=n.sibling;else{if(Ea(),i===a){t=ec(e,t,n);break a}Ns(e,t,i,n)}t=t.child}return t;case 5:return uo(t),e===null&&Sa(t),i=t.type,a=t.pendingProps,o=e===null?null:e.memoizedProps,s=a.children,gi(i,a)?s=null:o!==null&&gi(i,o)&&(t.flags|=32),Rs(e,t),Ns(e,t,s,n),t.child;case 6:return e===null&&Sa(t),null;case 13:return Ks(e,t,n);case 4:return co(t,t.stateNode.containerInfo),i=t.pendingProps,e===null?t.child=Na(t,null,i,n):Ns(e,t,i,n),t.child;case 11:return i=t.type,a=t.pendingProps,a=t.elementType===i?a:hs(i,a),Ps(e,t,i,a,n);case 7:return Ns(e,t,t.pendingProps,n),t.child;case 8:return Ns(e,t,t.pendingProps.children,n),t.child;case 12:return Ns(e,t,t.pendingProps.children,n),t.child;case 10:a:{if(i=t.type._context,a=t.pendingProps,o=t.memoizedProps,s=a.value,Z(Fa,i._currentValue),i._currentValue=s,o!==null)if(wr(o.value,s)){if(o.children===a.children&&!Vi.current){t=ec(e,t,n);break a}}else for(o=t.child,o!==null&&(o.return=t);o!==null;){var c=o.dependencies;if(c!==null){s=o.child;for(var l=c.firstContext;l!==null;){if(l.context===i){if(o.tag===1){l=Za(-1,n&-n),l.tag=2;var u=o.updateQueue;if(u!==null){u=u.shared;var d=u.pending;d===null?l.next=l:(l.next=d.next,d.next=l),u.pending=l}}o.lanes|=n,l=o.alternate,l!==null&&(l.lanes|=n),Va(o.return,n,t),c.lanes|=n;break}l=l.next}}else if(o.tag===10)s=o.type===t.type?null:o.child;else if(o.tag===18){if(s=o.return,s===null)throw Error(r(341));s.lanes|=n,c=s.alternate,c!==null&&(c.lanes|=n),Va(s,n,t),s=o.sibling}else s=o.child;if(s!==null)s.return=o;else for(s=o;s!==null;){if(s===t){s=null;break}if(o=s.sibling,o!==null){o.return=s.return,s=o;break}s=s.return}o=s}Ns(e,t,a.children,n),t=t.child}return t;case 9:return a=t.type,i=t.pendingProps.children,Ha(t,n),a=Ua(a),i=i(a),t.flags|=1,Ns(e,t,i,n),t.child;case 14:return i=t.type,a=hs(i,t.pendingProps),a=hs(i.type,a),Fs(e,t,i,a,n);case 15:return Is(e,t,t.type,t.pendingProps,n);case 17:return i=t.type,a=t.pendingProps,a=t.elementType===i?a:hs(i,a),$s(e,t),t.tag=1,Wi(i)?(e=!0,Ji(t)):e=!1,Ha(t,n),ys(t,i,a),xs(t,i,a,n),Vs(null,t,i,!0,e,n);case 19:return Qs(e,t,n);case 22:return Ls(e,t,n)}throw Error(r(156,t.tag))};function Wl(e,t){return ot(e,t)}function Gl(e,t,n,r){this.tag=e,this.key=n,this.sibling=this.child=this.return=this.stateNode=this.type=this.elementType=null,this.index=0,this.ref=null,this.pendingProps=t,this.dependencies=this.memoizedState=this.updateQueue=this.memoizedProps=null,this.mode=r,this.subtreeFlags=this.flags=0,this.deletions=null,this.childLanes=this.lanes=0,this.alternate=null}function Kl(e,t,n,r){return new Gl(e,t,n,r)}function ql(e){return e=e.prototype,!(!e||!e.isReactComponent)}function Jl(e){if(typeof e==`function`)return+!!ql(e);if(e!=null){if(e=e.$$typeof,e===w)return 11;if(e===E)return 14}return 2}function Yl(e,t){var n=e.alternate;return n===null?(n=Kl(e.tag,t,e.key,e.mode),n.elementType=e.elementType,n.type=e.type,n.stateNode=e.stateNode,n.alternate=e,e.alternate=n):(n.pendingProps=t,n.type=e.type,n.flags=0,n.subtreeFlags=0,n.deletions=null),n.flags=e.flags&14680064,n.childLanes=e.childLanes,n.lanes=e.lanes,n.child=e.child,n.memoizedProps=e.memoizedProps,n.memoizedState=e.memoizedState,n.updateQueue=e.updateQueue,t=e.dependencies,n.dependencies=t===null?null:{lanes:t.lanes,firstContext:t.firstContext},n.sibling=e.sibling,n.index=e.index,n.ref=e.ref,n}function Xl(e,t,n,i,a,o){var s=2;if(i=e,typeof e==`function`)ql(e)&&(s=1);else if(typeof e==`string`)s=5;else a:switch(e){case S:return Zl(n.children,a,o,t);case ie:s=8,a|=8;break;case C:return e=Kl(12,n,t,a|2),e.elementType=C,e.lanes=o,e;case T:return e=Kl(13,n,t,a),e.elementType=T,e.lanes=o,e;case se:return e=Kl(19,n,t,a),e.elementType=se,e.lanes=o,e;case D:return Ql(n,a,o,t);default:if(typeof e==`object`&&e)switch(e.$$typeof){case ae:s=10;break a;case oe:s=9;break a;case w:s=11;break a;case E:s=14;break a;case ce:s=16,i=null;break a}throw Error(r(130,e==null?e:typeof e,``))}return t=Kl(s,n,t,a),t.elementType=e,t.type=i,t.lanes=o,t}function Zl(e,t,n,r){return e=Kl(7,e,r,t),e.lanes=n,e}function Ql(e,t,n,r){return e=Kl(22,e,r,t),e.elementType=D,e.lanes=n,e.stateNode={isHidden:!1},e}function $l(e,t,n){return e=Kl(6,e,null,t),e.lanes=n,e}function eu(e,t,n){return t=Kl(4,e.children===null?[]:e.children,e.key,t),t.lanes=n,t.stateNode={containerInfo:e.containerInfo,pendingChildren:null,implementation:e.implementation},t}function tu(e,t,n,r,i){this.tag=t,this.containerInfo=e,this.finishedWork=this.pingCache=this.current=this.pendingChildren=null,this.timeoutHandle=-1,this.callbackNode=this.pendingContext=this.context=null,this.callbackPriority=0,this.eventTimes=Mt(0),this.expirationTimes=Mt(-1),this.entangledLanes=this.finishedLanes=this.mutableReadLanes=this.expiredLanes=this.pingedLanes=this.suspendedLanes=this.pendingLanes=0,this.entanglements=Mt(0),this.identifierPrefix=r,this.onRecoverableError=i,this.mutableSourceEagerHydrationData=null}function nu(e,t,n,r,i,a,o,s,c){return e=new tu(e,t,n,s,c),t===1?(t=1,!0===a&&(t|=8)):t=0,a=Kl(3,null,null,t),e.current=a,a.stateNode=e,a.memoizedState={element:r,isDehydrated:n,cache:null,transitions:null,pendingSuspenseBoundaries:null},Ya(a),e}function ru(e,t,n){var r=3<arguments.length&&arguments[3]!==void 0?arguments[3]:null;return{$$typeof:re,key:r==null?null:``+r,children:e,containerInfo:t,implementation:n}}function iu(e){if(!e)return zi;e=e._reactInternals;a:{if(tt(e)!==e||e.tag!==1)throw Error(r(170));var t=e;do{switch(t.tag){case 3:t=t.stateNode.context;break a;case 1:if(Wi(t.type)){t=t.stateNode.__reactInternalMemoizedMergedChildContext;break a}}t=t.return}while(t!==null);throw Error(r(171))}if(e.tag===1){var n=e.type;if(Wi(n))return qi(e,n,t)}return t}function au(e,t,n,r,i,a,o,s,c){return e=nu(n,r,!0,e,i,a,o,s,c),e.context=iu(null),n=e.current,r=fl(),i=pl(n),a=Za(r,i),a.callback=t??null,Qa(n,a,i),e.current.lanes=i,Nt(e,i,r),hl(e,r),e}function ou(e,t,n,r){var i=t.current,a=fl(),o=pl(i);return n=iu(n),t.context===null?t.context=n:t.pendingContext=n,t=Za(a,o),t.payload={element:e},r=r===void 0?null:r,r!==null&&(t.callback=r),e=Qa(i,t,o),e!==null&&(ml(e,i,o,a),$a(e,i,o)),o}function su(e){if(e=e.current,!e.child)return null;switch(e.child.tag){case 5:return e.child.stateNode;default:return e.child.stateNode}}function cu(e,t){if(e=e.memoizedState,e!==null&&e.dehydrated!==null){var n=e.retryLane;e.retryLane=n!==0&&n<t?n:t}}function lu(e,t){cu(e,t),(e=e.alternate)&&cu(e,t)}function uu(){return null}var du=typeof reportError==`function`?reportError:function(e){console.error(e)};function fu(e){this._internalRoot=e}pu.prototype.render=fu.prototype.render=function(e){var t=this._internalRoot;if(t===null)throw Error(r(409));ou(e,t,null,null)},pu.prototype.unmount=fu.prototype.unmount=function(){var e=this._internalRoot;if(e!==null){this._internalRoot=null;var t=e.containerInfo;Cl(function(){ou(null,e,null,null)}),t[Oi]=null}};function pu(e){this._internalRoot=e}pu.prototype.unstable_scheduleHydration=function(e){if(e){var t=Bt();e={blockedOn:null,target:e,priority:t};for(var n=0;n<Yt.length&&t!==0&&t<Yt[n].priority;n++);Yt.splice(n,0,e),n===0&&en(e)}};function mu(e){return!(!e||e.nodeType!==1&&e.nodeType!==9&&e.nodeType!==11)}function hu(e){return!(!e||e.nodeType!==1&&e.nodeType!==9&&e.nodeType!==11&&(e.nodeType!==8||e.nodeValue!==` react-mount-point-unstable `))}function gu(){}function _u(e,t,n,r,i){if(i){if(typeof r==`function`){var a=r;r=function(){var e=su(o);a.call(e)}}var o=au(t,r,e,0,null,!1,!1,``,gu);return e._reactRootContainer=o,e[Oi]=o.current,ni(e.nodeType===8?e.parentNode:e),Cl(),o}for(;i=e.lastChild;)e.removeChild(i);if(typeof r==`function`){var s=r;r=function(){var e=su(c);s.call(e)}}var c=nu(e,0,!1,null,null,!1,!1,``,gu);return e._reactRootContainer=c,e[Oi]=c.current,ni(e.nodeType===8?e.parentNode:e),Cl(function(){ou(t,c,n,r)}),c}function vu(e,t,n,r,i){var a=n._reactRootContainer;if(a){var o=a;if(typeof i==`function`){var s=i;i=function(){var e=su(o);s.call(e)}}ou(t,o,e,i)}else o=_u(n,t,e,i,r);return su(o)}Lt=function(e){switch(e.tag){case 3:var t=e.stateNode;if(t.current.memoizedState.isDehydrated){var n=Et(t.pendingLanes);n!==0&&(Ft(t,n|1),hl(t,ut()),!($&6)&&(el=ut()+500,ta()))}break;case 13:Cl(function(){var t=qa(e,1);t!==null&&ml(t,e,1,fl())}),lu(e,1)}},Rt=function(e){if(e.tag===13){var t=qa(e,134217728);t!==null&&ml(t,e,134217728,fl()),lu(e,134217728)}},zt=function(e){if(e.tag===13){var t=pl(e),n=qa(e,t);n!==null&&ml(n,e,t,fl()),lu(e,t)}},Bt=function(){return K},Vt=function(e,t){var n=K;try{return K=e,t()}finally{K=n}},I=function(e,t,n){switch(t){case`input`:if(N(e,n),t=n.name,n.type===`radio`&&t!=null){for(n=e;n.parentNode;)n=n.parentNode;for(n=n.querySelectorAll(`input[name=`+JSON.stringify(``+t)+`][type="radio"]`),t=0;t<n.length;t++){var i=n[t];if(i!==e&&i.form===e.form){var a=Fi(i);if(!a)throw Error(r(90));ve(i),N(i,a)}}}break;case`textarea`:Oe(e,n);break;case`select`:t=n.value,t!=null&&Te(e,!!n.multiple,t,!1)}},We=Sl,Ge=Cl;var yu={usingClientEntryPoint:!1,Events:[Ni,Pi,Fi,z,B,Sl]},bu={findFiberByHostInstance:Mi,bundleType:0,version:`18.3.1`,rendererPackageName:`react-dom`},xu={bundleType:bu.bundleType,version:bu.version,rendererPackageName:bu.rendererPackageName,rendererConfig:bu.rendererConfig,overrideHookState:null,overrideHookStateDeletePath:null,overrideHookStateRenamePath:null,overrideProps:null,overridePropsDeletePath:null,overridePropsRenamePath:null,setErrorHandler:null,setSuspenseHandler:null,scheduleUpdate:null,currentDispatcherRef:x.ReactCurrentDispatcher,findHostInstanceByFiber:function(e){return e=it(e),e===null?null:e.stateNode},findFiberByHostInstance:bu.findFiberByHostInstance||uu,findHostInstancesForRefresh:null,scheduleRefresh:null,scheduleRoot:null,setRefreshHandler:null,getCurrentFiber:null,reconcilerVersion:`18.3.1-next-f1338f8080-20240426`};if(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<`u`){var Su=__REACT_DEVTOOLS_GLOBAL_HOOK__;if(!Su.isDisabled&&Su.supportsFiber)try{_t=Su.inject(xu),vt=Su}catch{}}e.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=yu,e.createPortal=function(e,t){var n=2<arguments.length&&arguments[2]!==void 0?arguments[2]:null;if(!mu(t))throw Error(r(200));return ru(e,t,null,n)},e.createRoot=function(e,t){if(!mu(e))throw Error(r(299));var n=!1,i=``,a=du;return t!=null&&(!0===t.unstable_strictMode&&(n=!0),t.identifierPrefix!==void 0&&(i=t.identifierPrefix),t.onRecoverableError!==void 0&&(a=t.onRecoverableError)),t=nu(e,1,!1,null,null,n,!1,i,a),e[Oi]=t.current,ni(e.nodeType===8?e.parentNode:e),new fu(t)},e.findDOMNode=function(e){if(e==null)return null;if(e.nodeType===1)return e;var t=e._reactInternals;if(t===void 0)throw typeof e.render==`function`?Error(r(188)):(e=Object.keys(e).join(`,`),Error(r(268,e)));return e=it(t),e=e===null?null:e.stateNode,e},e.flushSync=function(e){return Cl(e)},e.hydrate=function(e,t,n){if(!hu(t))throw Error(r(200));return vu(null,e,t,!0,n)},e.hydrateRoot=function(e,t,n){if(!mu(e))throw Error(r(405));var i=n!=null&&n.hydratedSources||null,a=!1,o=``,s=du;if(n!=null&&(!0===n.unstable_strictMode&&(a=!0),n.identifierPrefix!==void 0&&(o=n.identifierPrefix),n.onRecoverableError!==void 0&&(s=n.onRecoverableError)),t=au(t,null,e,1,n??null,a,!1,o,s),e[Oi]=t.current,ni(e),i)for(e=0;e<i.length;e++)n=i[e],a=n._getVersion,a=a(n._source),t.mutableSourceEagerHydrationData==null?t.mutableSourceEagerHydrationData=[n,a]:t.mutableSourceEagerHydrationData.push(n,a);return new pu(t)},e.render=function(e,t,n){if(!hu(t))throw Error(r(200));return vu(null,e,t,!1,n)},e.unmountComponentAtNode=function(e){if(!hu(e))throw Error(r(40));return e._reactRootContainer?(Cl(function(){vu(null,null,e,!1,function(){e._reactRootContainer=null,e[Oi]=null})}),!0):!1},e.unstable_batchedUpdates=Sl,e.unstable_renderSubtreeIntoContainer=function(e,t,n,i){if(!hu(n))throw Error(r(200));if(e==null||e._reactInternals===void 0)throw Error(r(38));return vu(e,t,n,!1,i)},e.version=`18.3.1-next-f1338f8080-20240426`})),m=o(((e,t)=>{function n(){if(!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__>`u`||typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE!=`function`))try{__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(n)}catch(e){console.error(e)}}n(),t.exports=p()})),h=o((e=>{var t=m();e.createRoot=t.createRoot,e.hydrateRoot=t.hydrateRoot})),g=o(((e,t)=>{function n(e){var t,r,i=``;if(typeof e==`string`||typeof e==`number`)i+=e;else if(typeof e==`object`)if(Array.isArray(e)){var a=e.length;for(t=0;t<a;t++)e[t]&&(r=n(e[t]))&&(i&&(i+=` `),i+=r)}else for(r in e)e[r]&&(i&&(i+=` `),i+=r);return i}function r(){for(var e,t,r=0,i=``,a=arguments.length;r<a;r++)(e=arguments[r])&&(t=n(e))&&(i&&(i+=` `),i+=t);return i}t.exports=r,t.exports.clsx=r})),_=c(u(),1),v=m(),y=h(),b=c(g(),1);const ee={theta:`θ`,mu:`μ`,alpha:`α`,beta:`β`,omega:`ω`,Delta:`Δ`,Sigma:`Σ`,pi:`π`},te=(e,t)=>{if(e[t]===`{`){let n=1,r=t+1;for(;r<e.length&&n>0&&(e[r]===`{`?n+=1:e[r]===`}`&&--n,n!==0);)r+=1;return{content:e.slice(t+1,r),next:Math.min(r+1,e.length)}}let n=/^\\[a-zA-Z]+/.exec(e.slice(t));return n===null?{content:e.slice(t,t+1),next:t+1}:{content:n[0],next:t+n[0].length}},x=e=>e.map(e=>e.frac===void 0?e.sqrt===void 0?e.text:`√(${x(e.sqrt.body)})`:`(${x(e.frac.num)})/(${x(e.frac.den)})`).join(``),ne=(e,t)=>({text:`(${x(e)})/(${x(t)})`,frac:{num:e,den:t}}),re=(e,t)=>({text:`${t===void 0?``:x(t)}√(${x(e)})`,sqrt:t===void 0?{body:e}:{body:e,index:t}}),S=e=>{let t=[],n=``,r=0,i=()=>{n.length>0&&(t.push({text:n}),n=``)};for(;r<e.length;){let a=e[r];if(a===`\\`){let o=/^\\[a-zA-Z]+/.exec(e.slice(r))?.[0];if(o===`\\frac`||o===`\\tfrac`||o===`\\dfrac`){i();let n=te(e,r+o.length),a=te(e,n.next);t.push(ne(S(n.content),S(a.content))),r=a.next;continue}if(o===`\\sqrt`){i();let n=r+o.length,a;if(e[n]===`[`){let t=e.indexOf(`]`,n);t>n&&(a=S(e.slice(n+1,t)),n=t+1)}let s=te(e,n);t.push(re(S(s.content),a)),r=s.next;continue}if(o===`\\text`||o===`\\mathrm`||o===`\\mathbf`||o===`\\operatorname`){let t=te(e,r+o.length);n+=t.content,r=t.next;continue}n+=a,r+=1;continue}if(a===`_`||a===`^`){i(),r+=1;let n=``;if(e[r]===`{`){let t=te(e,r);n=t.content,r=t.next}else r<e.length&&(n+=e[r]??``,r+=1);let o=S(n);if(o.length>0){let e=a===`_`?`sub`:`super`;t.push(...o.map(t=>({...t,script:e})))}continue}a!==void 0&&a!==`{`&&a!==`}`&&(n+=a),r+=1}return i(),t},ie=e=>S(e.replace(/\\(theta|mu|alpha|beta|omega|Delta|Sigma|pi)\b/g,(e,t)=>ee[t]??t).replace(/\\sin/g,`sin`).replace(/\\cos/g,`cos`).replace(/\\tan/g,`tan`).replace(/\\,/g,` `).replace(/\\;/g,` `)),C=(e,t)=>{let n=e.x-ae(e),r=t.x-ae(t);return n<r+t.box.width+3&&n+e.box.width+3>r&&e.y-e.box.height<t.y+3&&e.y+3>t.y-t.box.height},ae=e=>e.box.anchor===`middle`?e.box.width/2:e.box.anchor===`end`?e.box.width:0,oe=e=>{let t=e.map(e=>{let t=Math.hypot(e.dirX,e.dirY),n=t===0?1:e.dirX/t,r=t===0?0:e.dirY/t,i=e.x+n*9,a=e.y+r*9+e.height*.34;return{box:e,x:i,y:a,originX:i,originY:a}});for(let e=0;e<24;e+=1){let e=!1;for(let n=0;n<t.length;n+=1)for(let r=n+1;r<t.length;r+=1){let i=t[n],a=t[r];if(i===void 0||a===void 0||!C(i,a))continue;let o=Math.hypot(a.box.dirX,a.box.dirY),s=o===0?0:a.box.dirX/o,c=o===0?1:a.box.dirY/o;a.x+=s*5,a.y+=c*5,e=!0}if(!e)break}return t.map(e=>{let t=e.x-e.originX,n=e.y-e.originY,r=Math.hypot(t,n),i=r>15;return{id:e.box.id,x:e.x,y:e.y,anchor:e.box.anchor,displaced:r>.5,...i?{leader:{x1:e.box.x,y1:e.box.y,x2:e.x-(e.box.anchor===`end`?-2:2),y2:e.y-e.box.height*.3}}:{}}})},w=(e,t)=>{let n=e.replace(/[_^{}\\]/g,``),r=(e.match(/[_^]/g)??[]).length;return Math.max(t*.72,n.length*t*.56+r*t*.1)},T={ball:{file:`ball.png`,pixels:{w:421,h:429},solidBox:{left:.0532,top:.0523,width:.8932,height:.8951},anchorKind:`point`,anchorPoint:{x:.497625,y:.5},radius:.445368},block:{file:`block.png`,pixels:{w:430,h:181},solidBox:{left:.0532,top:.1263,width:.893,height:.7476},anchorKind:`point`,anchorPoint:{x:.498837,y:.867403}},cart:{file:`cart.png`,pixels:{w:426,h:173},solidBox:{left:.0498,top:.1323,width:.9014,height:.7359},anchorKind:`point`,anchorPoint:{x:.5,y:.861272}},plank:{file:`plank.png`,pixels:{w:415,h:111},solidBox:{left:.0371,top:.2044,width:.9253,height:.5912},anchorKind:`line`,anchorLine:{a:{x:.038554,y:.405405},b:{x:.959036,y:.405405}}},"weight-hook":{file:`weight-hook.png`,pixels:{w:171,h:430},solidBox:{left:.1335,top:.0531,width:.731,height:.893},anchorKind:`point`,anchorPoint:{x:.494152,y:.944186}},"spring-scale":{file:`spring-scale.png`,pixels:{w:413,h:100},solidBox:{left:.0335,top:.2272,width:.9298,height:.55},anchorKind:`point`,anchorPoint:{x:.9613,y:.51}},"support-clamp":{file:`support-clamp.png`,pixels:{w:164,h:407},solidBox:{left:.1391,top:0,width:.7191,height:.9435},anchorKind:`point`,anchorPoint:{x:.326,y:.91}},protractor:{file:`protractor.png`,pixels:{w:430,h:178},solidBox:{left:.0535,top:.1292,width:.8907,height:.8652},anchorKind:`point`,anchorPoint:{x:.499,y:.129}},"track-rail":{file:`track-rail.png`,pixels:{w:406,h:134},solidBox:{left:.0271,top:.1716,width:.9433,height:.6493},anchorKind:`point`,anchorPoint:{x:.5,y:.388}},"ruler-vertical":{file:`ruler-vertical.png`,pixels:{w:64,h:424},solidBox:{left:.3594,top:.0472,width:.2656,height:.9033},anchorKind:`point`,anchorPoint:{x:.49,y:.047}}},se=e=>`./assets/parts3d/mechanics/${e.file}`;if(typeof document<`u`){let e=document.createElement(`style`);e.textContent=`.M0CESW_roleVelocity {
  stroke: var(--physics-vector-velocity);
  fill: var(--physics-vector-velocity);
}

.M0CESW_roleVelocityComponent {
  stroke: var(--physics-vector-velocity-soft);
  fill: var(--physics-vector-velocity-soft);
}

.M0CESW_roleForce {
  stroke: var(--physics-vector-force);
  fill: var(--physics-vector-force);
}

.M0CESW_roleElectricForce {
  stroke: var(--physics-vector-electric-force);
  fill: var(--physics-vector-electric-force);
}

.M0CESW_roleMagneticForce {
  stroke: var(--physics-vector-magnetic-force);
  fill: var(--physics-vector-magnetic-force);
}

.M0CESW_roleGravity {
  stroke: var(--physics-vector-gravity);
  fill: var(--physics-vector-gravity);
}

.M0CESW_roleNormal {
  stroke: var(--physics-vector-normal);
  fill: var(--physics-vector-normal);
}

.M0CESW_roleFriction {
  stroke: var(--physics-vector-friction);
  fill: var(--physics-vector-friction);
}

.M0CESW_roleSpring {
  stroke: var(--physics-vector-spring);
  fill: var(--physics-vector-spring);
}

.M0CESW_roleTension {
  stroke: var(--physics-vector-tension);
  fill: var(--physics-vector-tension);
}

.M0CESW_roleNetForce {
  stroke: var(--physics-vector-net-force);
  fill: var(--physics-vector-net-force);
}

.M0CESW_roleAcceleration {
  stroke: var(--physics-vector-acceleration);
  fill: var(--physics-vector-acceleration);
}

.M0CESW_roleTrajectory {
  stroke: var(--physics-trajectory);
  fill: var(--physics-trajectory);
}

.M0CESW_roleField {
  stroke: var(--physics-field);
  fill: var(--physics-field);
}

.M0CESW_roleMeasurement {
  stroke: var(--physics-measurement);
  fill: var(--physics-measurement);
}

.M0CESW_roleNeutral {
  stroke: var(--physics-axis);
  fill: var(--physics-axis);
}

.M0CESW_vectorLine {
  stroke-width: 2.2px;
  stroke-linecap: round;
  fill: none;
  transition: stroke-width var(--physics-motion-fast) var(--physics-ease);
  filter: drop-shadow(0 .6px .6px color-mix(in srgb, var(--physics-body-stroke) 12%, transparent));
}

.M0CESW_vectorSubordinate {
  stroke-width: 1.4px;
  stroke-dasharray: 5 3;
  opacity: .85;
}

.M0CESW_vectorLabel {
  paint-order: stroke fill;
  stroke-width: 3.2px;
  stroke: var(--physics-canvas-bg);
  font-size: 11.5px;
  font-style: italic;
  font-weight: 600;
}

.M0CESW_vectorLabelSubordinate {
  opacity: .92;
  font-size: 11px;
  font-weight: 500;
}

.M0CESW_labelLeader {
  stroke: var(--physics-measurement-soft);
  stroke-width: .9px;
  stroke-dasharray: 2 2;
  fill: none;
}

.M0CESW_subscript, .M0CESW_superscript {
  font-size: .72em;
  font-style: italic;
}

.M0CESW_groundLine {
  stroke: var(--physics-body-stroke);
  stroke-width: 1.6px;
  fill: none;
}

.M0CESW_hatch {
  stroke: var(--physics-surface-hatch);
  stroke-width: 1.1px;
  fill: none;
}

.M0CESW_surfaceLabel {
  fill: var(--physics-canvas-text);
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  font-size: 11px;
}

.M0CESW_inclineBody {
  fill: var(--physics-incline-fill);
  stroke: var(--physics-body-stroke);
  stroke-width: 1.3px;
  stroke-linejoin: round;
}

.M0CESW_springCoil {
  stroke: var(--physics-vector-spring);
  stroke-width: 2.3px;
  fill: none;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.M0CESW_springCoilBack {
  stroke: var(--physics-vector-spring);
  stroke-width: 1.1px;
  opacity: .3;
  fill: none;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.M0CESW_springPlate {
  stroke: var(--physics-body-stroke);
  stroke-width: 3px;
  fill: none;
}

.M0CESW_springHatch {
  stroke: var(--physics-surface-hatch);
  stroke-width: 1.1px;
  fill: none;
}

.M0CESW_springJoint {
  fill: var(--physics-body-stroke);
}

.M0CESW_pendulumString {
  stroke: var(--physics-body-stroke);
  stroke-width: 1.4px;
  fill: none;
}

.M0CESW_pendulumRest {
  stroke: var(--physics-surface-hatch);
  stroke-width: 1px;
  stroke-dasharray: 4 4;
  fill: none;
}

.M0CESW_platformBody {
  fill: color-mix(in srgb, var(--physics-body-fill) 45%, var(--physics-incline-fill));
  stroke: var(--physics-body-stroke);
  stroke-width: 1.4px;
  stroke-linejoin: round;
}

.M0CESW_platformEdge {
  stroke: var(--physics-body-stroke);
  stroke-width: 1.8px;
  fill: none;
}

.M0CESW_bodyFill {
  fill: var(--physics-body-fill);
  stroke: var(--physics-body-stroke);
  stroke-width: 1.5px;
  filter: drop-shadow(0 1.5px 1.5px color-mix(in srgb, var(--physics-body-stroke) 16%, transparent));
}

.M0CESW_bodyLive {
  stroke: var(--physics-body-live);
  stroke-width: 1.8px;
  transition: filter .2s var(--physics-ease);
}

[data-physicsos-running="true"] .M0CESW_bodyLive {
  filter: drop-shadow(0 0 3px color-mix(in srgb, var(--physics-body-live) 35%, transparent));
}

@media (prefers-reduced-motion: reduce) {
  .M0CESW_bodyLive {
    transition: none;
  }
}

.M0CESW_bodyGloss {
  fill: #ffffff9e;
  stroke: none;
}

.M0CESW_partSprite {
  pointer-events: none;
  filter: drop-shadow(0 2px 2px color-mix(in srgb, var(--physics-body-stroke) 20%, transparent));
}

.M0CESW_cartAxle {
  stroke: var(--physics-body-stroke);
  stroke-width: 1.4px;
}

.M0CESW_cartWheel {
  fill: var(--physics-canvas-bg);
  stroke: var(--physics-body-stroke);
  stroke-width: 1.4px;
}

.M0CESW_cartHub {
  fill: var(--physics-body-stroke);
  stroke: none;
}

.M0CESW_cartSpoke {
  stroke: var(--physics-body-stroke);
  stroke-width: 1.1px;
  stroke-linecap: round;
}

.M0CESW_motionMark {
  fill: var(--physics-trajectory);
  stroke: none;
}

.M0CESW_motionMarkLabel {
  fill: var(--physics-canvas-text);
  font-variant-numeric: tabular-nums;
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  font-size: 11px;
}

.M0CESW_bodyLabel {
  fill: var(--physics-canvas-text);
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  font-size: 12px;
  font-style: italic;
  font-weight: 600;
}

.M0CESW_angleArc {
  stroke: var(--physics-angle);
  stroke-width: 1.4px;
  fill: none;
}

.M0CESW_angleRay {
  stroke: var(--physics-angle);
  stroke-width: .9px;
  stroke-dasharray: 4 3;
  opacity: .7;
  fill: none;
}

.M0CESW_angleLabel {
  fill: var(--physics-angle);
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  font-size: 11px;
  font-style: italic;
  font-weight: 600;
}

.M0CESW_dimensionLine {
  stroke: var(--physics-measurement);
  stroke-width: 1.1px;
  fill: none;
  transition: stroke var(--physics-motion-fast) var(--physics-ease);
}

.M0CESW_dimensionTick {
  stroke: var(--physics-measurement);
  stroke-width: 1.3px;
  fill: none;
}

.M0CESW_dimensionHighlighted {
  stroke: var(--physics-highlight);
  stroke-width: 1.8px;
}

.M0CESW_dimensionLabel {
  fill: var(--physics-canvas-text);
  font-variant-numeric: tabular-nums;
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3.2px;
  font-size: 11.5px;
}

.M0CESW_dimensionLabelHighlighted {
  fill: var(--physics-highlight);
  font-weight: 600;
}

.M0CESW_keyLaunch {
  fill: #fff;
  stroke: var(--physics-keypoint-launch);
  stroke-width: 1.8px;
}

.M0CESW_keyApex {
  fill: var(--physics-keypoint-apex);
  stroke: #fff;
  stroke-width: 1.1px;
}

.M0CESW_keyImpact {
  fill: var(--physics-keypoint-impact);
  stroke: #fff;
  stroke-width: 1.1px;
}

.M0CESW_keySample {
  fill: #fff;
  stroke: var(--physics-trajectory);
  stroke-width: 1.5px;
}

.M0CESW_keyLabel {
  fill: var(--physics-canvas-text-muted);
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  font-size: 11px;
}

.M0CESW_basisLine {
  stroke-width: 1.2px;
  fill: none;
}

.M0CESW_basisLabel {
  fill: var(--physics-canvas-text-muted);
  font-size: 11px;
  font-style: italic;
}

.M0CESW_highlightGroup {
  filter: drop-shadow(0 0 5px var(--physics-highlight-glow));
}
`,document.head.appendChild(e)}var E={angleArc:`M0CESW_angleArc`,angleLabel:`M0CESW_angleLabel`,angleRay:`M0CESW_angleRay`,basisLabel:`M0CESW_basisLabel`,basisLine:`M0CESW_basisLine`,bodyFill:`M0CESW_bodyFill`,bodyGloss:`M0CESW_bodyGloss`,bodyLabel:`M0CESW_bodyLabel`,bodyLive:`M0CESW_bodyLive`,cartAxle:`M0CESW_cartAxle`,cartHub:`M0CESW_cartHub`,cartSpoke:`M0CESW_cartSpoke`,cartWheel:`M0CESW_cartWheel`,dimensionHighlighted:`M0CESW_dimensionHighlighted`,dimensionLabel:`M0CESW_dimensionLabel`,dimensionLabelHighlighted:`M0CESW_dimensionLabelHighlighted`,dimensionLine:`M0CESW_dimensionLine`,dimensionTick:`M0CESW_dimensionTick`,groundLine:`M0CESW_groundLine`,hatch:`M0CESW_hatch`,highlightGroup:`M0CESW_highlightGroup`,inclineBody:`M0CESW_inclineBody`,keyApex:`M0CESW_keyApex`,keyImpact:`M0CESW_keyImpact`,keyLabel:`M0CESW_keyLabel`,keyLaunch:`M0CESW_keyLaunch`,keySample:`M0CESW_keySample`,labelLeader:`M0CESW_labelLeader`,motionMark:`M0CESW_motionMark`,motionMarkLabel:`M0CESW_motionMarkLabel`,partSprite:`M0CESW_partSprite`,pendulumRest:`M0CESW_pendulumRest`,pendulumString:`M0CESW_pendulumString`,platformBody:`M0CESW_platformBody`,platformEdge:`M0CESW_platformEdge`,roleAcceleration:`M0CESW_roleAcceleration`,roleElectricForce:`M0CESW_roleElectricForce`,roleField:`M0CESW_roleField`,roleForce:`M0CESW_roleForce`,roleFriction:`M0CESW_roleFriction`,roleGravity:`M0CESW_roleGravity`,roleMagneticForce:`M0CESW_roleMagneticForce`,roleMeasurement:`M0CESW_roleMeasurement`,roleNetForce:`M0CESW_roleNetForce`,roleNeutral:`M0CESW_roleNeutral`,roleNormal:`M0CESW_roleNormal`,roleSpring:`M0CESW_roleSpring`,roleTension:`M0CESW_roleTension`,roleTrajectory:`M0CESW_roleTrajectory`,roleVelocity:`M0CESW_roleVelocity`,roleVelocityComponent:`M0CESW_roleVelocityComponent`,springCoil:`M0CESW_springCoil`,springCoilBack:`M0CESW_springCoilBack`,springHatch:`M0CESW_springHatch`,springJoint:`M0CESW_springJoint`,springPlate:`M0CESW_springPlate`,subscript:`M0CESW_subscript`,superscript:`M0CESW_superscript`,surfaceLabel:`M0CESW_surfaceLabel`,vectorLabel:`M0CESW_vectorLabel`,vectorLabelSubordinate:`M0CESW_vectorLabelSubordinate`,vectorLine:`M0CESW_vectorLine`,vectorSubordinate:`M0CESW_vectorSubordinate`},ce=o((e=>{
/**
* @license React
* react-jsx-runtime.production.min.js
*
* Copyright (c) Facebook, Inc. and its affiliates.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/
var t=u(),n=Symbol.for(`react.element`),r=Symbol.for(`react.fragment`),i=Object.prototype.hasOwnProperty,a=t.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,o={key:!0,ref:!0,__self:!0,__source:!0};function s(e,t,r){var s,c={},l=null,u=null;for(s in r!==void 0&&(l=``+r),t.key!==void 0&&(l=``+t.key),t.ref!==void 0&&(u=t.ref),t)i.call(t,s)&&!o.hasOwnProperty(s)&&(c[s]=t[s]);if(e&&e.defaultProps)for(s in t=e.defaultProps,t)c[s]===void 0&&(c[s]=t[s]);return{$$typeof:n,type:e,key:l,ref:u,props:c,_owner:a.current}}e.Fragment=r,e.jsx=s,e.jsxs=s})),D=o(((e,t)=>{t.exports=ce()}))();const le=11.5,ue=e=>{switch(e){case`velocity`:return E.roleVelocity;case`velocity-component`:return E.roleVelocityComponent;case`force`:return E.roleForce;case`electric-force`:return E.roleElectricForce;case`magnetic-force`:return E.roleMagneticForce;case`gravity`:return E.roleGravity;case`normal`:return E.roleNormal;case`friction`:return E.roleFriction;case`net-force`:return E.roleNetForce;case`spring`:return E.roleSpring;case`tension`:return E.roleTension;case`acceleration`:return E.roleAcceleration;case`trajectory`:return E.roleTrajectory;case`field`:return E.roleField;case`measurement`:return E.roleMeasurement;default:return E.roleNeutral}},O=(e,t)=>`pc-arrow-${e}-${t}`,k=[`velocity`,`velocity-component`,`force`,`electric-force`,`magnetic-force`,`gravity`,`normal`,`friction`,`net-force`,`spring`,`tension`,`acceleration`,`field`,`measurement`,`neutral`],A=({uid:e})=>(0,D.jsxs)(D.Fragment,{children:[k.map(t=>(0,D.jsx)(`marker`,{id:O(t,e),markerWidth:`9`,markerHeight:`9`,refX:`7.4`,refY:`3.6`,orient:`auto`,markerUnits:`userSpaceOnUse`,children:(0,D.jsx)(`path`,{d:`M0 0.4 L8 3.6 L0 6.8 Z`,className:ue(t),fillOpacity:`1`})},t)),(0,D.jsx)(`marker`,{id:`pc-tick-${e}`,markerWidth:`6`,markerHeight:`8`,refX:`3`,refY:`4`,orient:`auto`,markerUnits:`userSpaceOnUse`,children:(0,D.jsx)(`path`,{d:`M3 0.6 V7.4`,className:E.dimensionTick})})]}),de=({ground:e,projection:t})=>{let n=t.py({x:0,y:e.y}),r=t.px({x:e.from,y:e.y}),i=t.px({x:e.to,y:e.y}),a=Math.max(0,Math.floor((i-r)/13));return(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`line`,{className:E.groundLine,x1:r,y1:n,x2:i,y2:n}),Array.from({length:a},(e,t)=>{let i=r+t*13;return(0,D.jsx)(`line`,{className:E.hatch,x1:i,y1:n+8,x2:i+7,y2:n+1},i)}),e.label===void 0?null:(0,D.jsx)(`text`,{className:E.surfaceLabel,x:r+4,y:n+19,textAnchor:`start`,children:e.label})]})},fe=({incline:e,projection:t})=>{let[n,r]=(0,_.useState)(!1),i=e.angle*Math.PI/180,a=e.base*Math.tan(i),o=e.origin,s={x:e.origin.x+e.base,y:e.origin.y},c={x:e.origin.x,y:e.origin.y+a},l=[o,s,c],u=t.px(o),d=t.px(s),f=t.py(o),p=t.py(c),m=Math.max(0,Math.floor((d-u)/13)),h=T.plank,g=(()=>{if(h===void 0||n)return;let{anchorLine:e}=h;if(e===void 0)return;let{a:t,b:r}=e,i=Math.hypot((r.x-t.x)*h.pixels.w,(r.y-t.y)*h.pixels.h),a=Math.hypot(d-u,f-p);if(i===0||a===0)return;let o=a/i;return{a:t,w:h.pixels.w*o,h:h.pixels.h*o,degrees:Math.atan2(f-p,d-u)*180/Math.PI}})();return(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`path`,{className:E.inclineBody,d:`${t.path(l)} Z`}),(0,D.jsx)(`line`,{className:E.groundLine,x1:u,y1:f,x2:d,y2:f}),Array.from({length:m},(e,t)=>{let n=u+t*13;return(0,D.jsx)(`line`,{className:E.hatch,x1:n,y1:f+8,x2:n+7,y2:f+1},n)}),h===void 0||g===void 0?null:(0,D.jsx)(`g`,{transform:`rotate(${g.degrees.toFixed(3)} ${u.toFixed(3)} ${p.toFixed(3)})`,children:(0,D.jsx)(`image`,{"data-testid":`sprite-plank`,href:se(h),x:u-g.a.x*g.w,y:p-g.a.y*g.h,width:g.w,height:g.h,preserveAspectRatio:`none`,className:E.partSprite,onError:()=>{r(!0)}})})]})},pe=({platform:e,projection:t})=>{let n=t.py(e.at),r=t.px({x:e.at.x-e.width,y:e.at.y}),i=t.px(e.at),a=t.py({x:e.at.x,y:e.at.y-e.height});return(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`path`,{className:E.platformBody,d:`M${r} ${n} H${i} V${a} H${i-9} V${n+7} H${r} Z`}),(0,D.jsx)(`line`,{className:E.platformEdge,x1:r,y1:n,x2:i,y2:n})]})},me=({spring:e,projection:t})=>{let n={x:t.px(e.anchor),y:t.py(e.anchor)},r={x:t.px(e.end),y:t.py(e.end)},i=r.x-n.x,a=r.y-n.y,o=Math.hypot(i,a);if(o<8)return null;let s=i/o,c=a/o,l=-c,u=s,d=Math.min(11,Math.max(5,o*.09)),f=Math.min(14,o*.12),p=Math.max(4,Math.min(11,Math.floor(o/26))),m=(o-2*f)/(p*2),h=(e,t)=>`${n.x+s*e+l*t} ${n.y+c*e+u*t}`,g=(e,t)=>{let n=[];for(let r=1;r<=p*2;r+=1){let i=(r%2==1?1:-1)*e;n.push(`Q${h(f+m*(r-.5),i*t*2)} ${h(f+m*r,0)}`)}return n.join(` `)},_=[`M${n.x} ${n.y}`,`L${h(f,0)}`,g(1,d),`L${h(o-f,0)}`,`L${r.x} ${r.y}`],v=[`M${h(f,0)}`,g(-1,d*.92),`L${h(o-f,0)}`],y=[];for(let e=-1;e<=1;e+=1){let t=n.x+l*16*e*.62-s*3,r=n.y+u*16*e*.62-c*3;y.push(`M${t} ${r} l${-s*6-l*5} ${-c*6-u*5}`)}return(0,D.jsxs)(`g`,{"data-testid":`spring-coil`,className:t.highlighted(e.id)?E.highlightGroup:void 0,children:[(0,D.jsx)(`line`,{className:E.springPlate,x1:n.x+l*16,y1:n.y+u*16,x2:n.x-l*16,y2:n.y-u*16}),(0,D.jsx)(`path`,{className:E.springHatch,d:y.join(` `)}),(0,D.jsx)(`path`,{className:E.springCoilBack,d:v.join(` `)}),(0,D.jsx)(`path`,{className:E.springCoil,d:_.join(` `)}),(0,D.jsx)(`circle`,{cx:n.x,cy:n.y,r:2.4,className:E.springJoint}),(0,D.jsx)(`circle`,{cx:r.x,cy:r.y,r:2.4,className:E.springJoint}),e.equilibrium===void 0?null:(()=>{let n=e.axis===`vertical`?{x:e.anchor.x,y:e.equilibrium}:{x:e.equilibrium,y:e.anchor.y},r=t.px(n),i=t.py(n),a=e.axis===`vertical`;return(0,D.jsx)(`line`,{className:E.pendulumRest,x1:a?r-12:r,y1:a?i:i-12,x2:a?r+12:r,y2:a?i:i+12})})()]})},he=({pendulum:e,projection:t})=>{let n={x:t.px(e.pivot),y:t.py(e.pivot)},r={x:t.px(e.bob),y:t.py(e.bob)},i={x:t.px({x:e.pivot.x,y:e.pivot.y-e.length}),y:t.py({x:e.pivot.x,y:e.pivot.y-e.length})},a=[];for(let e=-1;e<=1;e+=1){let t=n.x+e*20*.55;a.push(`M${t} ${n.y-4} l-5 -7`)}return(0,D.jsxs)(`g`,{"data-testid":`pendulum-rig`,className:t.highlighted(e.id)?E.highlightGroup:void 0,children:[(0,D.jsx)(`line`,{className:E.springPlate,x1:n.x-20,y1:n.y-4,x2:n.x+20,y2:n.y-4}),(0,D.jsx)(`path`,{className:E.springHatch,d:a.join(` `)}),(0,D.jsx)(`line`,{className:E.pendulumRest,x1:n.x,y1:n.y,x2:i.x,y2:i.y}),(0,D.jsx)(`line`,{className:E.pendulumString,x1:n.x,y1:n.y,x2:r.x,y2:r.y}),(0,D.jsx)(`circle`,{cx:n.x,cy:n.y,r:2.6,className:E.springJoint})]})},ge=({sprite:e,projection:t})=>{let[n,r]=(0,_.useState)(!1),i=T[e.part],a=i?.anchorPoint;if(i===void 0||a===void 0||n)return null;let o=e.size*t.scale,s=(e.width??e.size*(i.pixels.w/i.pixels.h))*t.scale,c=t.px(e.at),l=t.py(e.at),u=e.flip===!0?`translate(${2*c} 0) scale(-1 1)`:void 0;return(0,D.jsx)(`g`,{className:t.highlighted(e.id)?E.highlightGroup:void 0,transform:u,children:(0,D.jsx)(`image`,{"data-testid":`apparatus-${e.part}`,href:se(i),x:c-a.x*s,y:l-a.y*o,width:s,height:o,preserveAspectRatio:`none`,className:E.partSprite,onError:()=>{r(!0)}})})},_e=({body:e,projection:t})=>{let[n,r]=(0,_.useState)(!1),i=t.px(e.at),a=t.py(e.at),o=e.size*t.scale,s=t.highlighted(e.id),c=e.rotation??0,l=T[e.kind],u=(()=>{if(l?.anchorPoint===void 0||n)return;if(e.kind===`ball`){if(l.radius===void 0||l.radius===0)return;let e=o/(l.radius*l.pixels.w),t=l.pixels.w*e,n=l.pixels.h*e;return{x:i-l.anchorPoint.x*t,y:a-l.anchorPoint.y*n,w:t,h:n}}let t=o*2/(l.solidBox.height*l.pixels.h),r=l.pixels.w*t,s=l.pixels.h*t;return{x:i-l.anchorPoint.x*r,y:a+o-l.anchorPoint.y*s,w:r,h:s}})();return(0,D.jsxs)(`g`,{className:s?E.highlightGroup:void 0,children:[l!==void 0&&u!==void 0?(0,D.jsx)(`g`,{transform:c===0?void 0:`rotate(${-c} ${i} ${a})`,children:(0,D.jsx)(`image`,{"data-testid":`sprite-${e.kind}`,href:se(l),x:u.x,y:u.y,width:u.w,height:u.h,preserveAspectRatio:`none`,className:N(E.partSprite,e.live===!0&&E.bodyLive),onError:()=>{r(!0)}})}):e.kind===`ball`?(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`circle`,{cx:i,cy:a,r:o,className:N(E.bodyFill,e.live===!0&&E.bodyLive),style:{fill:`url(#pc-ball-${t.uid})`}}),(0,D.jsx)(`circle`,{cx:i-o*.32,cy:a-o*.34,r:o*.24,className:E.bodyGloss})]}):e.kind===`cart`?(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`rect`,{x:i-o*1.35,y:a-o*.62,width:o*2.7,height:o*1.1,rx:o*.16,className:N(E.bodyFill,e.live===!0&&E.bodyLive)}),(0,D.jsx)(`line`,{className:E.cartAxle,x1:i-o*.85,y1:a+o*.68,x2:i+o*.85,y2:a+o*.68}),[i-o*.85,i+o*.85].map(t=>{let n=a+o*.68,r=o*.32,i=(e.at.x/(e.size*.32)*180/Math.PI%360+360)%360;return(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`circle`,{cx:t,cy:n,r,className:E.cartWheel}),(0,D.jsx)(`g`,{"data-testid":`cart-spokes`,transform:`rotate(${i.toFixed(2)} ${t.toFixed(2)} ${n.toFixed(2)})`,children:[0,1,2].map(e=>{let i=e*2*Math.PI/3-Math.PI/2;return(0,D.jsx)(`line`,{className:E.cartSpoke,x1:t,y1:n,x2:t+r*.78*Math.cos(i),y2:n+r*.78*Math.sin(i)},e)})}),(0,D.jsx)(`circle`,{cx:t,cy:n,r:o*.1,className:E.cartHub})]},t)})]}):(0,D.jsx)(`rect`,{x:i-o,y:a-o,width:o*2,height:o*2,rx:o*.18,transform:c===0?void 0:`rotate(${-c} ${i} ${a})`,className:N(E.bodyFill,e.live===!0&&E.bodyLive)}),e.label===void 0?null:(0,D.jsx)(`text`,{className:E.bodyLabel,x:i,y:a-o-6,textAnchor:`middle`,children:e.label})]})},j=({vectors:e,projection:t})=>{let n=oe(e.map(e=>{let n=t.px(e.from),r=t.py(e.from),i=t.px(e.to),a=t.py(e.to),o=i-n,s=a-r,c=e.labelHint===`start`?`end`:o>=0?`start`:`end`;return{id:e.id,x:i,y:a,width:w(e.symbol,le),height:le,dirX:o,dirY:s,anchor:c}}));return(0,D.jsx)(`g`,{pointerEvents:`none`,children:e.map((e,r)=>{let i=n[r],a=ue(e.role);return(0,D.jsxs)(`g`,{className:t.highlighted(e.id)?E.highlightGroup:void 0,children:[(0,D.jsx)(`line`,{className:N(E.vectorLine,a,e.subordinate===!0&&E.vectorSubordinate),x1:t.px(e.from),y1:t.py(e.from),x2:t.px(e.to),y2:t.py(e.to),markerEnd:`url(#${O(e.role,t.uid)})`}),i?.leader===void 0?null:(0,D.jsx)(`line`,{className:E.labelLeader,x1:i.leader.x1,y1:i.leader.y1,x2:i.leader.x2,y2:i.leader.y2}),i===void 0?null:(0,D.jsx)(M,{x:i.x,y:i.y,anchor:i.anchor,symbol:e.symbol,className:N(E.vectorLabel,a,e.subordinate===!0&&E.vectorLabelSubordinate)})]},e.id)})})},M=({x:e,y:t,anchor:n,symbol:r,className:i})=>{let a=ie(r),o=0;return(0,D.jsx)(`text`,{x:e,y:t,textAnchor:n,className:i,children:a.map((e,t)=>{let n=e.script===`sub`?.28:e.script===`super`?-.38:0,r=n-o;return o=n,(0,D.jsx)(`tspan`,{className:e.script===`sub`?E.subscript:e.script===`super`?E.superscript:void 0,dy:r===0?void 0:`${r.toFixed(2)}em`,children:e.text},t)})})},ve=({angle:e,projection:t})=>{let n=t.px(e.at),r=t.py(e.at),i=e.radius*t.scale,a=e=>e*Math.PI/180,o=e=>({x:n+Math.cos(a(e))*i,y:r-Math.sin(a(e))*i}),s=o(e.startAngle),c=o(e.endAngle),l=+(Math.abs(e.endAngle-e.startAngle)>180),u=o((e.startAngle+e.endAngle)/2),d=n+(u.x-n)*1.44,f=r+(u.y-r)*1.44;return(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`line`,{className:E.angleRay,x1:n,y1:r,x2:o(e.startAngle).x,y2:o(e.startAngle).y}),(0,D.jsx)(`line`,{className:E.angleRay,x1:n,y1:r,x2:o(e.endAngle).x,y2:o(e.endAngle).y}),(0,D.jsx)(`path`,{className:E.angleArc,d:`M${s.x.toFixed(2)} ${s.y.toFixed(2)} A${i.toFixed(2)} ${i.toFixed(2)} 0 ${l} ${e.endAngle>e.startAngle?0:1} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`}),(0,D.jsx)(M,{x:d,y:f+4,anchor:`middle`,symbol:e.value===void 0?e.symbol:`${e.symbol}=${e.value}`,className:E.angleLabel})]})},ye=({dimension:e,projection:t})=>{let n=t.px(e.from),r=t.py(e.from),i=t.px(e.to),a=t.py(e.to),o=t.highlighted(e.id),s=Math.hypot(i-n,a-r)||1,c=e.side===`right`?-1:1,l=-(a-r)/s*11*c,u=(i-n)/s*11*c;return(0,D.jsxs)(`g`,{className:o?E.highlightGroup:void 0,children:[(0,D.jsx)(`line`,{className:N(E.dimensionLine,o&&E.dimensionHighlighted),x1:n,y1:r,x2:i,y2:a,markerStart:`url(#pc-tick-${t.uid})`,markerEnd:`url(#pc-tick-${t.uid})`}),(0,D.jsx)(M,{x:(n+i)/2+l,y:(r+a)/2+u+3.6,anchor:`middle`,symbol:e.label,className:N(E.dimensionLabel,o&&E.dimensionLabelHighlighted)})]})},be=({marks:e,projection:t})=>(0,D.jsx)(`g`,{children:e.map(e=>{let n=t.px(e.at),r=t.py(e.at);return(0,D.jsxs)(`g`,{className:t.highlighted(e.id)?E.highlightGroup:void 0,children:[(0,D.jsx)(`circle`,{className:E.motionMark,cx:n,cy:r,r:`3`}),e.label===void 0?null:(0,D.jsx)(`text`,{className:E.motionMarkLabel,x:n,y:r+14,textAnchor:`middle`,children:e.label})]},e.id)})}),xe=({keyPoint:e,projection:t})=>{let n=t.px(e.at),r=t.py(e.at),i=e.kind===`launch`?E.keyLaunch:e.kind===`apex`?E.keyApex:e.kind===`impact`?E.keyImpact:E.keySample;return(0,D.jsxs)(`g`,{className:t.highlighted(e.id)?E.highlightGroup:void 0,children:[(0,D.jsx)(`title`,{children:e.readout===void 0||e.readout.length===0?e.label:`${e.label} · ${e.readout.map(e=>`${e.label} ${e.value}`).join(` · `)}`}),e.kind===`apex`?(0,D.jsx)(`path`,{className:i,d:`M${n} ${r-4.6} L${n+4.2} ${r+3.2} L${n-4.2} ${r+3.2} Z`}):e.kind===`impact`?(0,D.jsx)(`path`,{className:i,d:`M${n} ${r-4.8} L${n+4.8} ${r} L${n} ${r+4.8} L${n-4.8} ${r} Z`}):(0,D.jsx)(`circle`,{className:i,cx:n,cy:r,r:`3.5`}),(0,D.jsx)(`text`,{className:E.keyLabel,x:e.kind===`launch`?n-7:n,y:r-9,textAnchor:e.kind===`launch`?`end`:`middle`,children:e.label})]})},Se=({coordinate:e,projection:t})=>{let n=t.px(e.at),r=t.py(e.at),i=e.length*t.scale,a=(e.rotation??0)*Math.PI/180,o={x:n+Math.cos(a)*i,y:r-Math.sin(a)*i},s={x:n-Math.sin(a)*i,y:r-Math.cos(a)*i};return(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`line`,{className:N(E.basisLine,E.roleMeasurement),x1:n,y1:r,x2:o.x,y2:o.y,markerEnd:`url(#${O(`measurement`,t.uid)})`}),(0,D.jsx)(`line`,{className:N(E.basisLine,E.roleMeasurement),x1:n,y1:r,x2:s.x,y2:s.y,markerEnd:`url(#${O(`measurement`,t.uid)})`}),(0,D.jsx)(M,{x:o.x+6,y:o.y+4,anchor:`start`,symbol:e.xLabel,className:E.basisLabel}),(0,D.jsx)(M,{x:s.x,y:s.y-5,anchor:`middle`,symbol:e.yLabel,className:E.basisLabel})]})},N=(...e)=>e.filter(e=>typeof e==`string`&&e.length>0).join(` `);if(typeof document<`u`){let e=document.createElement(`style`);e.textContent=`.H6yJdG_fieldGlyph {
  fill: var(--physics-field);
  opacity: .42;
  user-select: none;
  font-size: 13px;
}

.H6yJdG_electricFieldLattice {
  stroke: var(--physics-field);
  stroke-width: 1.1px;
  opacity: .3;
  fill: none;
}

.H6yJdG_electricFieldLine {
  stroke-width: .9px;
  opacity: .7;
}

.H6yJdG_electricFieldStreamline {
  fill: none;
}

.H6yJdG_streamlinePath {
  stroke: var(--physics-field);
  stroke-width: 1.25px;
  stroke-linecap: round;
  opacity: .65;
  fill: none;
}

.H6yJdG_streamlineArrow {
  stroke: var(--physics-field);
  stroke-width: 1px;
  stroke-linecap: round;
  opacity: .7;
  fill: none;
}

.H6yJdG_equipotentials {
  fill: none;
}

.H6yJdG_equipotentialPath {
  stroke: var(--physics-measurement);
  stroke-width: .8px;
  stroke-linecap: round;
  stroke-dasharray: 3 3;
  opacity: .55;
  fill: none;
}

.H6yJdG_probeDot {
  fill: var(--physics-measurement);
  stroke: #fff;
  stroke-width: 1.2px;
}

.H6yJdG_trajectoryHistory {
  stroke: var(--physics-trajectory);
  stroke-width: 2.25px;
  stroke-linecap: round;
  fill: none;
}

.H6yJdG_trajectoryRunner {
  fill: var(--physics-trajectory);
  stroke: var(--physics-canvas-bg);
  stroke-width: 1.5px;
  filter: drop-shadow(0 0 3px color-mix(in srgb, var(--physics-trajectory) 45%, transparent));
}

.H6yJdG_trajectoryPredicted {
  stroke: var(--physics-trajectory-predicted);
  stroke-width: 1.5px;
  stroke-dasharray: 6 4;
  stroke-linecap: round;
  opacity: .6;
  fill: none;
}

.H6yJdG_trajectoryDirection {
  fill: var(--physics-trajectory);
  opacity: .8;
  font-size: 13px;
}

.H6yJdG_guideLine {
  stroke: var(--physics-measurement);
  stroke-width: 1.1px;
  stroke-dasharray: 5 3;
  fill: none;
}

.H6yJdG_guideLabel {
  fill: var(--physics-canvas-text-muted);
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  font-size: 11.5px;
  font-style: italic;
}

.H6yJdG_orbitCenter {
  fill: var(--physics-measurement);
  stroke: #fff;
  stroke-width: 1px;
}

.H6yJdG_particleLabel {
  fill: #c8453a;
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  font-size: 11.5px;
  font-style: italic;
  font-weight: 600;
}

.H6yJdG_particleLabelNegative {
  fill: #1d4ed8;
}

.H6yJdG_annotation {
  fill: color-mix(in srgb, var(--physics-canvas-text) 72%, var(--physics-canvas-text-muted));
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  font-variant-numeric: tabular-nums;
  font-size: 11.5px;
}

.H6yJdG_highlightGroup {
  filter: drop-shadow(0 0 5px var(--physics-highlight-glow));
}

.H6yJdG_plateBar {
  stroke: #8b909a;
  stroke-width: .8px;
  stroke-linejoin: round;
}

.H6yJdG_plateTop {
  fill: #c5cad2;
}

.H6yJdG_plateBottom {
  fill: #b0b5bd;
}

.H6yJdG_plateSignLabel {
  fill: #c8453a;
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  font-size: 12px;
  font-style: italic;
  font-weight: 600;
}

.H6yJdG_boundedFieldRegion {
  stroke: var(--physics-measurement);
  stroke-width: .9px;
  stroke-dasharray: 3 3;
  opacity: .45;
  fill: none;
}

.H6yJdG_regionTintCrossed {
  fill: color-mix(in srgb, var(--physics-vector-electric-force) 5%, transparent);
}

.H6yJdG_regionTintElectric {
  fill: color-mix(in srgb, var(--physics-vector-electric-force) 4%, transparent);
}

.H6yJdG_regionTintMagnetic {
  fill: color-mix(in srgb, var(--physics-vector-magnetic-force) 4%, transparent);
}

.H6yJdG_circuitWire {
  stroke: var(--physics-wire);
  stroke-width: 2.2px;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
  filter: drop-shadow(0 .6px .6px #141a2438);
}

.H6yJdG_circuitJunction {
  fill: var(--physics-wire);
}

.H6yJdG_circuitSymbol {
  stroke: var(--physics-wire);
  stroke-width: 1.6px;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
}

.H6yJdG_circuitSymbolThick {
  stroke: var(--physics-wire);
  stroke-width: 3.4px;
  stroke-linecap: butt;
  fill: none;
}

.H6yJdG_circuitSymbolFill {
  fill: var(--physics-wire);
  stroke: none;
}

.H6yJdG_circuitMeterFace {
  fill: var(--physics-canvas-bg);
}

.H6yJdG_circuitMeterLetter {
  fill: var(--physics-canvas-text);
  user-select: none;
  dominant-baseline: middle;
  font-size: 11px;
  font-style: italic;
  font-weight: 600;
}

.H6yJdG_circuitName {
  fill: var(--physics-canvas-text);
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  font-size: 12px;
  font-style: italic;
  font-weight: 600;
}

.H6yJdG_circuitAnnotation {
  fill: color-mix(in srgb, var(--physics-canvas-text) 65%, var(--physics-canvas-text-muted));
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  font-size: 11px;
}

.H6yJdG_circuitReading {
  fill: var(--physics-canvas-text);
  font-variant-numeric: tabular-nums;
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  font-size: 12px;
  font-weight: 600;
}

.H6yJdG_circuitCurrent {
  stroke: var(--physics-vector-velocity);
  stroke-width: 1.6px;
  stroke-linecap: round;
  fill: none;
}

.H6yJdG_circuitCurrentHead {
  fill: var(--physics-vector-velocity);
  stroke: none;
}

.H6yJdG_circuitCurrentText {
  fill: var(--physics-vector-velocity);
  font-variant-numeric: tabular-nums;
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  font-size: 11px;
}

.H6yJdG_circuitChargeFlow {
  stroke: var(--physics-current-flow);
  stroke-width: 2.7px;
  stroke-linecap: round;
  fill: none;
  pointer-events: none;
  filter: drop-shadow(0 0 1px var(--physics-current-flow-glow));
}

.H6yJdG_circuitLampBloom {
  pointer-events: none;
  mix-blend-mode: screen;
  filter: opacity(.55);
}

.H6yJdG_circuitLampGlow {
  pointer-events: none;
  filter: opacity(.72);
}

.H6yJdG_circuitLampCore {
  pointer-events: none;
  mix-blend-mode: screen;
}

.H6yJdG_circuitLampFilament {
  fill: none;
  stroke: var(--physics-lamp-hot);
  stroke-width: 1.4px;
  stroke-linecap: round;
  stroke-linejoin: round;
  pointer-events: none;
  filter: drop-shadow(0 0 1.2px var(--physics-lamp-bloom));
}

.H6yJdG_circuitPartSprite {
  pointer-events: none;
  filter: drop-shadow(0 2px 2px color-mix(in srgb, var(--physics-body-stroke) 20%, transparent));
}

.H6yJdG_circuitDraggable {
  cursor: grab;
  touch-action: none;
}

.H6yJdG_circuitDragging {
  cursor: grabbing;
}

.H6yJdG_circuitHitArea {
  fill: #0000;
}

.H6yJdG_circuitControl {
  fill: #0000;
  touch-action: none;
  outline: none;
}

.H6yJdG_circuitControl:focus-visible {
  stroke: var(--physics-body-live);
  stroke-width: 2px;
  stroke-dasharray: 4 3;
}

.H6yJdG_circuitTerminal {
  fill: var(--physics-canvas-bg);
  stroke: var(--physics-body-live);
  stroke-width: 1.5px;
  cursor: crosshair;
  touch-action: none;
  opacity: .85;
  outline: none;
}

.H6yJdG_circuitTerminalHit {
  fill: #0000;
  stroke: none;
  pointer-events: all;
  cursor: crosshair;
  touch-action: none;
}

.H6yJdG_circuitTerminal:hover {
  opacity: 1;
  fill: var(--physics-body-live);
}

.H6yJdG_circuitTerminal:focus-visible {
  stroke-width: 3px;
  stroke-dasharray: 3 2;
  opacity: 1;
}

.H6yJdG_circuitTerminalPending {
  fill: var(--physics-body-live);
  opacity: 1;
}

.H6yJdG_opticalAxis {
  stroke: var(--physics-axis);
  stroke-width: 1.1px;
  stroke-dasharray: 8 5;
  opacity: .8;
}

.H6yJdG_focalTick {
  stroke: var(--physics-measurement);
  stroke-width: 1.4px;
}

.H6yJdG_focalLabel {
  fill: var(--physics-canvas-text-muted);
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  user-select: none;
  font-size: 11.5px;
  font-style: italic;
  font-weight: 600;
}

.H6yJdG_opticalRay {
  stroke: var(--physics-optics-ray);
  stroke-width: 1.6px;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
  opacity: .92;
  filter: drop-shadow(0 0 1.5px color-mix(in srgb, var(--physics-optics-ray) 24%, transparent));
}

.H6yJdG_opticalRayHead {
  fill: var(--physics-optics-ray);
  stroke: none;
}

.H6yJdG_opticalRayExtension {
  stroke: var(--physics-optics-ray-soft);
  stroke-width: 1.4px;
  stroke-dasharray: 5 4;
  stroke-linecap: round;
  fill: none;
  opacity: .85;
}

.H6yJdG_opticalObjectLine {
  stroke: var(--physics-body-stroke);
  stroke-width: 2.6px;
  stroke-linecap: round;
}

.H6yJdG_opticalObjectHead {
  fill: var(--physics-body-stroke);
  stroke: none;
}

.H6yJdG_opticalImageLine {
  stroke: var(--physics-optics-image);
  stroke-width: 2.6px;
  stroke-linecap: round;
}

.H6yJdG_opticalImageVirtual {
  stroke-dasharray: 6 4;
  opacity: .9;
}

.H6yJdG_opticalImageHead {
  fill: var(--physics-optics-image);
  stroke: none;
}

.H6yJdG_opticalImageLabel {
  fill: var(--physics-optics-image);
}

.H6yJdG_lensBody {
  fill: color-mix(in srgb, var(--physics-vector-force) 12%, var(--physics-canvas-bg));
  fill-opacity: .75;
  stroke: var(--physics-vector-force);
  stroke-width: 1.2px;
}

.H6yJdG_lensAxisLine {
  stroke: var(--physics-vector-force);
  stroke-width: 1.2px;
  stroke-linecap: round;
}

.H6yJdG_lensHead {
  fill: var(--physics-vector-force);
  stroke: none;
}

.H6yJdG_mirrorPlate {
  stroke: var(--physics-body-stroke);
  stroke-width: 3px;
  stroke-linecap: round;
}

.H6yJdG_mirrorHatch {
  stroke: var(--physics-measurement);
  stroke-width: 1.1px;
  opacity: .7;
}

.H6yJdG_curvedMirrorPlate {
  fill: none;
  stroke: var(--physics-body-stroke);
  stroke-width: 3px;
  stroke-linecap: round;
}

.H6yJdG_screenPlate {
  stroke: var(--physics-measurement);
  stroke-width: 4px;
  stroke-linecap: round;
  opacity: .85;
}

.H6yJdG_screenPlateLit {
  stroke: var(--physics-optics-ray);
  opacity: 1;
}

.H6yJdG_screenGlow {
  stroke: var(--physics-optics-ray-soft);
  stroke-width: 10px;
  stroke-linecap: round;
  opacity: .24;
}

.H6yJdG_screenFoot {
  stroke: var(--physics-measurement);
  stroke-width: 1.6px;
  stroke-linecap: round;
  opacity: .7;
}

.H6yJdG_acousticGround {
  stroke: var(--physics-axis);
  stroke-width: 1.6px;
  opacity: .85;
}

.H6yJdG_acousticGroundHatch {
  stroke: var(--physics-axis);
  stroke-width: 1px;
  opacity: .4;
}

.H6yJdG_acousticSourceBody {
  fill: color-mix(in srgb, var(--physics-acoustics-wave-soft) 26%, var(--physics-canvas-bg));
  stroke: var(--physics-body-stroke);
  stroke-width: 2px;
  stroke-linejoin: round;
}

.H6yJdG_acousticSourceStand {
  fill: none;
  stroke: var(--physics-body-stroke);
  stroke-width: 1.6px;
  stroke-linecap: round;
}

.H6yJdG_acousticSourceCone {
  fill: none;
  stroke: var(--physics-body-stroke);
  stroke-width: 1.2px;
  opacity: .65;
}

.H6yJdG_acousticSourceWave {
  fill: none;
  stroke: var(--physics-acoustics-wave);
  stroke-width: 1.4px;
  stroke-linecap: round;
  opacity: .8;
}

.H6yJdG_acousticWallFace {
  fill: var(--physics-body-fill);
  opacity: .7;
}

.H6yJdG_acousticWallPlate {
  stroke: var(--physics-body-stroke);
  stroke-width: 2.6px;
  stroke-linecap: round;
}

.H6yJdG_acousticWallHatch {
  stroke: var(--physics-measurement);
  stroke-width: 1.1px;
  opacity: .7;
}

.H6yJdG_acousticPulseDot {
  fill: var(--physics-acoustics-wave);
  stroke: var(--physics-canvas-bg);
  stroke-width: 1.4px;
}

.H6yJdG_acousticPulseReceived {
  fill: var(--physics-verification-ok);
}

.H6yJdG_acousticWavefront {
  fill: none;
  stroke: var(--physics-acoustics-wave-soft);
  stroke-width: 1.8px;
  stroke-linecap: round;
  opacity: .9;
}

.H6yJdG_acousticPathLine {
  stroke: var(--physics-acoustics-wave-soft);
  stroke-width: 1.4px;
  stroke-dasharray: 6 4;
  opacity: .6;
}

.H6yJdG_acousticPathHead {
  fill: var(--physics-acoustics-wave-soft);
  stroke: none;
}

.H6yJdG_acousticPathLabel {
  fill: var(--physics-acoustics-wave);
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  user-select: none;
  font-size: 11.5px;
}

.H6yJdG_fluidLiquidBody {
  fill: var(--physics-fluid-liquid-soft);
  stroke: none;
}

.H6yJdG_fluidTankWall {
  fill: none;
  stroke: var(--physics-body-stroke);
  stroke-width: 2.4px;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.H6yJdG_fluidSurfaceLine {
  stroke: var(--physics-fluid-liquid);
  stroke-width: 1.6px;
  stroke-dasharray: 7 4;
  opacity: .9;
}

.H6yJdG_fluidSurfaceLabel {
  fill: var(--physics-fluid-liquid);
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  user-select: none;
  font-size: 11.5px;
}

.H6yJdG_fluidSurface {
  stroke: var(--physics-fluid-liquid);
  stroke-width: 1.6px;
}

.H6yJdG_fluidScaleRing {
  fill: none;
  stroke: var(--physics-body-stroke);
  stroke-width: 1.8px;
}

.H6yJdG_fluidScaleDial {
  fill: var(--physics-canvas-bg);
  stroke: var(--physics-body-stroke);
  stroke-width: 1.2px;
}

.H6yJdG_fluidWire {
  stroke: var(--physics-body-stroke);
  stroke-width: 1.6px;
  opacity: .75;
}

.H6yJdG_fluidScaleBody {
  fill: var(--physics-body-fill);
  stroke: var(--physics-body-stroke);
  stroke-width: 2px;
}

.H6yJdG_fluidScaleReading {
  fill: var(--physics-canvas-text);
  font-variant-numeric: tabular-nums;
  user-select: none;
  font-size: 12px;
  font-weight: 600;
}

.H6yJdG_fluidBlockBody {
  fill: var(--physics-body-fill);
  stroke: var(--physics-body-stroke);
  stroke-width: 2.2px;
}

.H6yJdG_fluidBlockSubmerged {
  fill: var(--physics-fluid-liquid);
  opacity: .28;
  stroke: none;
}

.H6yJdG_fluidBlockFloating {
  stroke: var(--physics-verification-ok);
}

.H6yJdG_fluidDraggable {
  cursor: grab;
  touch-action: none;
}

.H6yJdG_fluidDragging {
  cursor: grabbing;
}

.H6yJdG_fluidScaleNeedle {
  stroke: var(--physics-measurement);
  stroke-width: 1.6px;
  stroke-linecap: round;
}

.H6yJdG_fluidScalePivot {
  fill: var(--physics-measurement);
  stroke: none;
}

.H6yJdG_pressureBlock {
  fill: var(--physics-body-fill);
  stroke: var(--physics-body-stroke);
  stroke-width: 2.2px;
}

.H6yJdG_pressurePlate {
  fill: var(--physics-measurement-soft);
  stroke: var(--physics-body-stroke);
  stroke-width: 1.6px;
}

.H6yJdG_pressureVesselWall {
  fill: none;
  stroke: var(--physics-body-stroke);
  stroke-width: 2.4px;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.H6yJdG_pressureLiquidBody {
  fill: var(--physics-fluid-liquid-soft);
  stroke: none;
}

.H6yJdG_pressureVesselLabel, .H6yJdG_pressureGuideLabel {
  fill: var(--physics-canvas-text);
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  user-select: none;
  font-size: 11.5px;
}

.H6yJdG_pressureProbeBody {
  fill: var(--physics-canvas-bg);
  stroke: var(--physics-body-stroke);
  stroke-width: 1.6px;
}

.H6yJdG_pressureProbeDot {
  fill: var(--physics-measurement);
  stroke: none;
}

.H6yJdG_pressureTube {
  fill: color-mix(in srgb, var(--physics-canvas-bg) 70%, transparent);
  stroke: var(--physics-body-stroke);
  stroke-width: 1.8px;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.H6yJdG_pressureMercury {
  fill: color-mix(in srgb, var(--physics-measurement) 78%, var(--physics-canvas-text));
  stroke: none;
}

.H6yJdG_pressureMercuryPool {
  fill: var(--physics-measurement-soft);
  stroke: none;
}

.H6yJdG_pressureDish {
  fill: none;
  stroke: var(--physics-body-stroke);
  stroke-width: 2.6px;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.H6yJdG_pressureVacuum {
  fill: var(--physics-canvas-text-muted);
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  user-select: none;
  font-size: 11px;
}

.H6yJdG_pressureHemisphere {
  fill: color-mix(in srgb, var(--physics-body-fill) 75%, transparent);
  stroke: var(--physics-body-stroke);
  stroke-width: 2.2px;
}

.H6yJdG_pressureHemisphereJoint {
  stroke: var(--physics-body-stroke);
  stroke-width: 1.4px;
  stroke-dasharray: 5 3;
}

.H6yJdG_pressureGuide {
  stroke: var(--physics-measurement);
  stroke-width: 1.3px;
  stroke-dasharray: 6 4;
  opacity: .85;
}

.H6yJdG_pressureReading {
  fill: var(--physics-canvas-text);
  font-variant-numeric: tabular-nums;
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  user-select: none;
  font-size: 12px;
  font-weight: 600;
}

.H6yJdG_currentFieldRing {
  fill: none;
  stroke: var(--physics-field);
  stroke-width: 1.1px;
  stroke-dasharray: 5 4;
  opacity: .5;
}

.H6yJdG_currentProbeRing {
  fill: none;
  stroke: var(--physics-field);
  stroke-width: 1.9px;
}

.H6yJdG_currentFieldArrow {
  fill: var(--physics-field);
  stroke: none;
}

.H6yJdG_currentFieldArrowHalo {
  fill: var(--physics-canvas-bg);
  stroke: var(--physics-canvas-bg);
  stroke-width: 4px;
  stroke-linejoin: round;
}

.H6yJdG_currentWireSymbol {
  fill: var(--physics-canvas-bg);
  stroke: var(--physics-body-stroke);
  stroke-width: 2.4px;
}

.H6yJdG_currentWireDot {
  fill: var(--physics-induction-current);
  stroke: none;
}

.H6yJdG_currentWireCross {
  stroke: var(--physics-induction-current);
  stroke-width: 2.2px;
  stroke-linecap: round;
}

.H6yJdG_currentProbeBody {
  fill: var(--physics-canvas-bg);
  stroke: var(--physics-body-stroke);
  stroke-width: 1.6px;
}

.H6yJdG_currentProbeDot {
  fill: var(--physics-measurement);
  stroke: none;
}

.H6yJdG_currentCoilLoop {
  fill: none;
  stroke: var(--physics-body-stroke);
  stroke-width: 2.5px;
  stroke-linecap: round;
}

.H6yJdG_currentFieldLineHalo {
  fill: none;
  stroke: var(--physics-canvas-bg);
  stroke-width: 4.5px;
  stroke-linejoin: round;
}

.H6yJdG_currentAxisLine {
  fill: none;
  stroke: var(--physics-field);
  stroke-width: 1.8px;
}

.H6yJdG_currentFieldLine {
  fill: none;
  stroke: var(--physics-field);
  stroke-width: 1.2px;
  stroke-dasharray: 6 4;
  opacity: .65;
  stroke-linejoin: round;
}

.H6yJdG_currentCoreBar {
  fill: var(--physics-magnetic-core);
  stroke: var(--physics-body-stroke);
  stroke-width: 1.4px;
}

.H6yJdG_currentArmature {
  fill: color-mix(in srgb, var(--physics-magnetic-core) 55%, var(--physics-canvas-bg));
  stroke: var(--physics-body-stroke);
  stroke-width: 1.6px;
}

.H6yJdG_transformerCore {
  fill: var(--physics-magnetic-core);
  stroke: var(--physics-body-stroke);
  stroke-width: 1.4px;
  opacity: .85;
}

.H6yJdG_transformerPrimaryLoop {
  fill: none;
  stroke: var(--physics-induction-current);
  stroke-width: 2.5px;
  stroke-linecap: round;
}

.H6yJdG_transformerSecondaryLoop {
  fill: none;
  stroke: var(--physics-induction-rod);
  stroke-width: 2.5px;
  stroke-linecap: round;
}

.H6yJdG_holeCard {
  stroke: var(--physics-body-stroke);
  stroke-width: 4px;
  stroke-linecap: butt;
}

.H6yJdG_lightRay {
  fill: none;
  stroke: var(--physics-optics-ray);
  stroke-width: 1.5px;
  stroke-linejoin: round;
}

.H6yJdG_lightObject {
  stroke: var(--physics-body-stroke);
  stroke-width: 2.6px;
  stroke-linecap: round;
  fill: none;
}

.H6yJdG_lightImage {
  stroke: var(--physics-optics-image);
  stroke-width: 2.6px;
  stroke-linecap: round;
  fill: none;
}

.H6yJdG_lightScreen {
  stroke: var(--physics-measurement);
  stroke-width: 2.6px;
  stroke-linecap: round;
}

.H6yJdG_lightBoundary {
  stroke: var(--physics-body-stroke);
  stroke-width: 2px;
  stroke-linecap: round;
}

.H6yJdG_lightNormal {
  stroke: var(--physics-measurement);
  stroke-width: 1.4px;
  stroke-dasharray: 6 4;
}

.H6yJdG_lightCriticalRay {
  stroke: var(--physics-measurement);
  stroke-width: 1.3px;
  stroke-dasharray: 3 4;
  opacity: .8;
}

.H6yJdG_lightRefractedRay {
  stroke: var(--physics-optics-ray);
  stroke-width: 2px;
  stroke-linecap: round;
  fill: none;
}

.H6yJdG_noiseWavefront {
  fill: none;
  stroke: var(--physics-acoustics-wave);
  stroke-width: 1.6px;
}

.H6yJdG_noiseSource {
  fill: var(--physics-acoustics-wave);
  stroke: none;
}

.H6yJdG_noiseListener {
  fill: color-mix(in srgb, var(--physics-acoustics-wave-soft) 20%, var(--physics-canvas-bg));
  stroke: var(--physics-body-stroke);
  stroke-width: 2px;
}

.H6yJdG_noiseBarrier {
  stroke: var(--physics-body-stroke);
  stroke-width: 5px;
  stroke-linecap: round;
}

.H6yJdG_noiseDistance {
  stroke: var(--physics-measurement);
  stroke-width: 1.2px;
  stroke-dasharray: 4 3;
}

.H6yJdG_thermometerColumn {
  fill: var(--physics-thermal-heat);
  stroke: none;
}

.H6yJdG_thermometerGlass {
  fill: color-mix(in srgb, var(--physics-body-fill) 20%, transparent);
  stroke: var(--physics-body-stroke);
  stroke-width: 1.6px;
  stroke-linejoin: round;
}

.H6yJdG_thermometerTick {
  stroke: var(--physics-body-stroke);
  stroke-width: 2.2px;
  stroke-linecap: round;
}

.H6yJdG_thermometerTickLabel {
  fill: var(--physics-canvas-text);
  font-variant-numeric: tabular-nums;
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  user-select: none;
  font-size: 11.5px;
}

.H6yJdG_thermometerSpan {
  stroke: var(--physics-measurement);
  stroke-width: 1.2px;
  stroke-dasharray: 4 3;
}

.H6yJdG_energyRampBody {
  fill: var(--physics-incline-fill);
  stroke: none;
  opacity: 1;
}

.H6yJdG_energyRampSurface {
  stroke: var(--physics-body-stroke);
  stroke-width: 2.2px;
  stroke-linecap: round;
}

.H6yJdG_energyCart {
  fill: var(--physics-body-fill);
  stroke: var(--physics-body-stroke);
  stroke-width: 2.2px;
}

.H6yJdG_energyBarFrame {
  fill: color-mix(in srgb, var(--physics-body-fill) 35%, var(--physics-canvas-bg));
  stroke: var(--physics-measurement);
  stroke-width: .8px;
}

.H6yJdG_energySegmentPotential {
  fill: var(--physics-measurement);
}

.H6yJdG_energySegmentKinetic {
  fill: var(--physics-vector-velocity);
}

.H6yJdG_energySegmentThermal {
  fill: var(--physics-thermal-heat);
}

.H6yJdG_motorCoil {
  stroke: var(--physics-body-stroke);
  stroke-width: 3.6px;
  stroke-linecap: round;
}

.H6yJdG_motorSide {
  fill: var(--physics-canvas-bg);
  stroke: var(--physics-body-stroke);
  stroke-width: 2.4px;
}

.H6yJdG_motorAxis {
  fill: var(--physics-measurement);
  stroke: none;
}

.H6yJdG_motorSpin {
  fill: none;
  stroke: var(--physics-field);
  stroke-width: 2.1px;
}

.H6yJdG_motorSpinHalo {
  fill: var(--physics-canvas-bg);
  stroke: var(--physics-canvas-bg);
  stroke-width: 4px;
  stroke-linejoin: round;
}

.H6yJdG_motorSpinArrow {
  fill: var(--physics-field);
  stroke: none;
}

.H6yJdG_currentPoleLabel {
  fill: var(--physics-body-stroke);
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  user-select: none;
  font-size: 13px;
  font-weight: 700;
}

.H6yJdG_currentReading {
  fill: var(--physics-canvas-text);
  font-variant-numeric: tabular-nums;
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  user-select: none;
  font-size: 12px;
  font-weight: 600;
}

.H6yJdG_thermalBeakerWall {
  fill: none;
  stroke: var(--physics-body-stroke);
  stroke-width: 2.4px;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.H6yJdG_thermalSampleSolid {
  fill: var(--physics-thermal-solid);
  stroke: color-mix(in srgb, var(--physics-body-stroke) 28%, transparent);
  stroke-width: .8px;
}

.H6yJdG_thermalSampleLiquid {
  fill: var(--physics-thermal-liquid);
  stroke: none;
}

.H6yJdG_thermalSampleMelting {
  opacity: .85;
}

.H6yJdG_thermalHeaterBody {
  fill: var(--physics-body-fill);
  stroke: var(--physics-body-stroke);
  stroke-width: 2px;
}

.H6yJdG_thermalFlame {
  fill: var(--physics-thermal-heat);
  stroke: none;
  opacity: .85;
}

.H6yJdG_thermalTubeOuter {
  fill: color-mix(in srgb, var(--physics-canvas-bg) 88%, transparent);
  stroke: var(--physics-body-stroke);
  stroke-width: 1.6px;
}

.H6yJdG_thermalTick {
  stroke: var(--physics-body-stroke);
  stroke-width: 1px;
  opacity: .75;
}

.H6yJdG_thermalSurface {
  stroke: var(--physics-thermal-heat);
  stroke-width: 1.4px;
  opacity: .7;
}

.H6yJdG_thermalColumn {
  stroke: var(--physics-thermal-heat);
  stroke-width: 3.6px;
  stroke-linecap: round;
}

.H6yJdG_thermalBulb {
  fill: var(--physics-thermal-heat);
  stroke: var(--physics-canvas-bg);
  stroke-width: 1.4px;
}

.H6yJdG_thermalReading {
  dominant-baseline: middle;
  fill: var(--physics-canvas-text);
  font-variant-numeric: tabular-nums;
  user-select: none;
  font-size: 12px;
  font-weight: 600;
}

.H6yJdG_thermalMeltingLine {
  stroke: var(--physics-thermal-heat);
  stroke-width: 1.4px;
  stroke-dasharray: 6 4;
  opacity: .8;
}

.H6yJdG_thermalMeltingLabel {
  fill: var(--physics-thermal-heat);
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  user-select: none;
  font-size: 11.5px;
}

.H6yJdG_leverBeamBar {
  fill: var(--physics-body-fill);
  stroke: var(--physics-body-stroke);
  stroke-width: 1.8px;
  stroke-linejoin: round;
}

.H6yJdG_leverBeamTick {
  stroke: var(--physics-body-stroke);
  stroke-width: 1px;
  opacity: .8;
}

.H6yJdG_leverFulcrum {
  fill: color-mix(in srgb, var(--physics-body-fill) 60%, var(--physics-measurement-soft));
  stroke: var(--physics-body-stroke);
  stroke-width: 2px;
}

.H6yJdG_leverFulcrumStand {
  stroke: var(--physics-body-stroke);
  stroke-width: 2.4px;
}

.H6yJdG_leverFulcrumBase {
  stroke: var(--physics-body-stroke);
  stroke-width: 3.4px;
  stroke-linecap: round;
}

.H6yJdG_leverString {
  stroke: var(--physics-body-stroke);
  stroke-width: 1.6px;
  opacity: .7;
}

.H6yJdG_leverMassHook {
  fill: none;
  stroke: var(--physics-body-stroke);
  stroke-width: 1.6px;
}

.H6yJdG_leverMass {
  fill: var(--physics-body-fill);
  stroke: var(--physics-body-stroke);
  stroke-width: 2px;
}

.H6yJdG_leverMassSlot {
  stroke: var(--physics-body-stroke);
  stroke-width: 1.1px;
  opacity: .75;
}

.H6yJdG_inductionFieldBox {
  fill: color-mix(in srgb, var(--physics-induction-field) 4%, transparent);
  stroke: var(--physics-induction-field);
  stroke-width: 1px;
  stroke-dasharray: 5 4;
  opacity: .8;
}

.H6yJdG_inductionFieldMark {
  stroke: var(--physics-induction-field);
  stroke-width: 1.2px;
  opacity: .4;
}

.H6yJdG_inductionRod {
  stroke: var(--physics-induction-rod);
  stroke-width: 5.5px;
  stroke-linecap: round;
}

.H6yJdG_inductionRail {
  stroke: var(--physics-induction-rod);
  stroke-width: 2.6px;
  stroke-linecap: round;
  opacity: .62;
}

.H6yJdG_inductionRailEdge {
  stroke: #9aa8d8;
  stroke-width: 1px;
  opacity: .8;
}

.H6yJdG_inductionRodBed {
  stroke: var(--physics-canvas-bg);
  stroke-width: 8px;
  stroke-linecap: round;
}

.H6yJdG_inductionRodContact {
  fill: var(--physics-induction-rod);
  stroke: var(--physics-canvas-bg);
  stroke-width: 1.2px;
}

.H6yJdG_inductionVelocity {
  stroke: var(--physics-vector-velocity);
  stroke-width: 2px;
  stroke-linecap: round;
}

.H6yJdG_inductionVelocityHead {
  fill: var(--physics-vector-velocity);
}

.H6yJdG_inductionVelocityLabel {
  fill: var(--physics-vector-velocity);
  font-size: 11.5px;
  font-style: italic;
}

.H6yJdG_inductionResistor {
  fill: none;
  stroke: var(--physics-induction-rod);
  stroke-width: 1.8px;
  stroke-linejoin: round;
  opacity: .85;
}

.H6yJdG_inductionResistorLabel {
  fill: var(--physics-induction-rod);
  font-variant-numeric: tabular-nums;
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  font-size: 11.5px;
}

.H6yJdG_inductionForceArrow {
  stroke: var(--physics-vector-magnetic-force);
  stroke-width: 2.2px;
  stroke-linecap: round;
}

.H6yJdG_inductionForceHead {
  fill: var(--physics-vector-magnetic-force);
}

.H6yJdG_inductionForceLabel {
  fill: var(--physics-vector-magnetic-force);
  font-variant-numeric: tabular-nums;
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  font-size: 11.5px;
}

.H6yJdG_inductionCoil {
  stroke: var(--physics-induction-rod);
  stroke-width: 2.7px;
  fill: none;
  stroke-linecap: round;
}

.H6yJdG_inductionCurrentArrow {
  stroke: var(--physics-induction-current);
  stroke-width: 2px;
  stroke-linecap: round;
  fill: none;
}

.H6yJdG_inductionCurrentHead {
  fill: var(--physics-induction-current);
  stroke: none;
}

.H6yJdG_inductionCurrentLabel {
  fill: var(--physics-induction-current);
  font-variant-numeric: tabular-nums;
  font-size: 11.5px;
}

.H6yJdG_inductionChargeDot {
  fill: var(--physics-induction-current);
  stroke: var(--physics-canvas-bg);
  stroke-width: 1.1px;
}

.H6yJdG_waveEquilibrium {
  stroke: var(--physics-wave-equilibrium);
  stroke-width: 1.1px;
  stroke-dasharray: 5 4;
  fill: none;
}

.H6yJdG_waveRope, .H6yJdG_waveString {
  stroke: var(--physics-wave-rope);
  stroke-width: 2.8px;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
}

.H6yJdG_waveString {
  stroke-width: 2.2px;
}

.H6yJdG_waveEnvelope {
  stroke: var(--physics-wave-envelope);
  stroke-width: 1.2px;
  stroke-dasharray: 4 4;
  fill: none;
  opacity: .65;
}

.H6yJdG_waveFront {
  stroke: var(--physics-wave-front);
  stroke-width: 1.35px;
  fill: none;
  opacity: .62;
}

.H6yJdG_waveFrontGroup {
  mix-blend-mode: multiply;
}

.H6yJdG_waveNode {
  fill: var(--physics-canvas-bg);
  stroke: var(--physics-wave-node);
  stroke-width: 2.2px;
}

.H6yJdG_waveAntinode {
  fill: var(--physics-wave-rope);
  stroke: var(--physics-canvas-bg);
  stroke-width: 1.2px;
}

.H6yJdG_waveMarker {
  fill: var(--physics-wave-marker);
  stroke: var(--physics-canvas-bg);
  stroke-width: 2px;
}

.H6yJdG_waveMarkerGuide {
  stroke: var(--physics-wave-marker);
  stroke-width: 1px;
  stroke-dasharray: 2 3;
  opacity: .7;
}

.H6yJdG_waveSource {
  fill: var(--physics-wave-rope);
  stroke: var(--physics-canvas-bg);
  stroke-width: 1.4px;
}

.H6yJdG_waveSourceStem {
  fill: none;
  stroke: var(--physics-body-stroke);
  stroke-width: 1.5px;
}

.H6yJdG_waveClamp {
  fill: var(--physics-body-fill);
  stroke: var(--physics-body-stroke);
  stroke-width: 1.6px;
}

.H6yJdG_waveClampHatch {
  stroke: var(--physics-body-stroke);
  stroke-width: 1px;
  opacity: .55;
}

.H6yJdG_waveDriver {
  fill: var(--physics-body-fill);
  stroke: var(--physics-body-stroke);
  stroke-width: 1.6px;
}

.H6yJdG_waveDriverPin {
  stroke: var(--physics-body-stroke);
  stroke-width: 2px;
  stroke-linecap: round;
}

.H6yJdG_wavePoint {
  stroke: var(--physics-canvas-bg);
  stroke-width: 1.6px;
}

.H6yJdG_wavePointConstructive {
  fill: var(--physics-verification-ok);
}

.H6yJdG_wavePointDestructive {
  fill: var(--physics-verification-error);
}

.H6yJdG_wavePointPartial {
  fill: var(--physics-verification-warning);
}

.H6yJdG_wavePointLabel {
  fill: var(--physics-canvas-text);
  font-variant-numeric: tabular-nums;
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  font-size: 11.5px;
}

.H6yJdG_waveMedium {
  fill: var(--physics-wave-marker);
  stroke: var(--physics-canvas-bg);
  stroke-width: 1px;
  opacity: .85;
}

.H6yJdG_waveMediumNode {
  fill: var(--physics-wave-node);
  stroke: none;
  opacity: 1;
}

.H6yJdG_waveMediumGuide {
  stroke: var(--physics-wave-marker);
  stroke-width: .8px;
  opacity: .3;
}

.H6yJdG_circuitDialReading {
  fill: var(--physics-canvas-text);
  font-variant-numeric: tabular-nums;
  dominant-baseline: middle;
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 1.5px;
  user-select: none;
  font-size: 12px;
  font-weight: 600;
}

.H6yJdG_circuitSliderFallback {
  fill: var(--physics-body-live);
  stroke: var(--physics-body-stroke);
  stroke-width: 1.2px;
  stroke-linejoin: round;
  pointer-events: none;
}

.H6yJdG_circuitControl[role="switch"] {
  cursor: pointer;
}

.H6yJdG_circuitControl[role="slider"] {
  cursor: ew-resize;
}

.H6yJdG_circuitControl[aria-orientation="vertical"] {
  cursor: ns-resize;
}

.H6yJdG_inductionVelocityLabel, .H6yJdG_inductionCurrentLabel, .H6yJdG_fluidScaleReading, .H6yJdG_thermalReading {
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 2px;
  stroke-linejoin: round;
}

.H6yJdG_acousticSourceBody, .H6yJdG_fluidScaleBody, .H6yJdG_fluidBlockBody, .H6yJdG_pressureBlock, .H6yJdG_pressureProbeBody, .H6yJdG_currentCoreBar, .H6yJdG_currentArmature, .H6yJdG_transformerCore, .H6yJdG_energyCart, .H6yJdG_thermalHeaterBody, .H6yJdG_leverBeamBar, .H6yJdG_leverMass, .H6yJdG_waveClamp, .H6yJdG_waveDriver {
  filter: drop-shadow(0 1.5px 1.5px color-mix(in srgb, var(--physics-body-stroke) 15%, transparent));
}

.H6yJdG_modernCathode {
  fill: var(--physics-measurement-soft);
  stroke: var(--physics-body-stroke);
  stroke-width: 1.5px;
  filter: drop-shadow(2px 2px 2px color-mix(in srgb, var(--physics-body-stroke) 16%, transparent));
}

.H6yJdG_modernCathodeFace {
  stroke: var(--physics-canvas-bg);
  stroke-width: 2px;
  stroke-linecap: round;
}

.H6yJdG_modernPhoton, .H6yJdG_modernElectronPath {
  fill: none;
  stroke-width: 1.8px;
  stroke-linecap: round;
}

.H6yJdG_modernPhoton {
  stroke: var(--physics-optics-ray);
}

.H6yJdG_modernPhotonHead {
  fill: var(--physics-optics-ray);
}

.H6yJdG_modernElectronPath {
  stroke: var(--physics-trajectory);
  stroke-dasharray: 6 4;
}

.H6yJdG_modernElectronHead, .H6yJdG_modernElectron {
  fill: var(--physics-trajectory);
}

.H6yJdG_modernElectron {
  stroke: var(--physics-canvas-bg);
  stroke-width: 2px;
}

.H6yJdG_modernLabel {
  fill: var(--physics-canvas-text);
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  font-size: 12px;
  font-weight: 600;
}
`,document.head.appendChild(e)}var P={acousticGround:`H6yJdG_acousticGround`,acousticGroundHatch:`H6yJdG_acousticGroundHatch`,acousticPathHead:`H6yJdG_acousticPathHead`,acousticPathLabel:`H6yJdG_acousticPathLabel`,acousticPathLine:`H6yJdG_acousticPathLine`,acousticPulseDot:`H6yJdG_acousticPulseDot`,acousticPulseReceived:`H6yJdG_acousticPulseReceived`,acousticSourceBody:`H6yJdG_acousticSourceBody`,acousticSourceCone:`H6yJdG_acousticSourceCone`,acousticSourceStand:`H6yJdG_acousticSourceStand`,acousticSourceWave:`H6yJdG_acousticSourceWave`,acousticWallFace:`H6yJdG_acousticWallFace`,acousticWallHatch:`H6yJdG_acousticWallHatch`,acousticWallPlate:`H6yJdG_acousticWallPlate`,acousticWavefront:`H6yJdG_acousticWavefront`,annotation:`H6yJdG_annotation`,boundedFieldRegion:`H6yJdG_boundedFieldRegion`,circuitAnnotation:`H6yJdG_circuitAnnotation`,circuitChargeFlow:`H6yJdG_circuitChargeFlow`,circuitControl:`H6yJdG_circuitControl`,circuitCurrent:`H6yJdG_circuitCurrent`,circuitCurrentHead:`H6yJdG_circuitCurrentHead`,circuitCurrentText:`H6yJdG_circuitCurrentText`,circuitDialReading:`H6yJdG_circuitDialReading`,circuitDraggable:`H6yJdG_circuitDraggable`,circuitDragging:`H6yJdG_circuitDragging`,circuitHitArea:`H6yJdG_circuitHitArea`,circuitJunction:`H6yJdG_circuitJunction`,circuitLampBloom:`H6yJdG_circuitLampBloom`,circuitLampCore:`H6yJdG_circuitLampCore`,circuitLampFilament:`H6yJdG_circuitLampFilament`,circuitLampGlow:`H6yJdG_circuitLampGlow`,circuitMeterFace:`H6yJdG_circuitMeterFace`,circuitMeterLetter:`H6yJdG_circuitMeterLetter`,circuitName:`H6yJdG_circuitName`,circuitPartSprite:`H6yJdG_circuitPartSprite`,circuitReading:`H6yJdG_circuitReading`,circuitSliderFallback:`H6yJdG_circuitSliderFallback`,circuitSymbol:`H6yJdG_circuitSymbol`,circuitSymbolFill:`H6yJdG_circuitSymbolFill`,circuitSymbolThick:`H6yJdG_circuitSymbolThick`,circuitTerminal:`H6yJdG_circuitTerminal`,circuitTerminalHit:`H6yJdG_circuitTerminalHit`,circuitTerminalPending:`H6yJdG_circuitTerminalPending`,circuitWire:`H6yJdG_circuitWire`,currentArmature:`H6yJdG_currentArmature`,currentAxisLine:`H6yJdG_currentAxisLine`,currentCoilLoop:`H6yJdG_currentCoilLoop`,currentCoreBar:`H6yJdG_currentCoreBar`,currentFieldArrow:`H6yJdG_currentFieldArrow`,currentFieldArrowHalo:`H6yJdG_currentFieldArrowHalo`,currentFieldLine:`H6yJdG_currentFieldLine`,currentFieldLineHalo:`H6yJdG_currentFieldLineHalo`,currentFieldRing:`H6yJdG_currentFieldRing`,currentPoleLabel:`H6yJdG_currentPoleLabel`,currentProbeBody:`H6yJdG_currentProbeBody`,currentProbeDot:`H6yJdG_currentProbeDot`,currentProbeRing:`H6yJdG_currentProbeRing`,currentReading:`H6yJdG_currentReading`,currentWireCross:`H6yJdG_currentWireCross`,currentWireDot:`H6yJdG_currentWireDot`,currentWireSymbol:`H6yJdG_currentWireSymbol`,curvedMirrorPlate:`H6yJdG_curvedMirrorPlate`,electricFieldLattice:`H6yJdG_electricFieldLattice`,electricFieldLine:`H6yJdG_electricFieldLine`,electricFieldStreamline:`H6yJdG_electricFieldStreamline`,energyBarFrame:`H6yJdG_energyBarFrame`,energyCart:`H6yJdG_energyCart`,energyRampBody:`H6yJdG_energyRampBody`,energyRampSurface:`H6yJdG_energyRampSurface`,energySegmentKinetic:`H6yJdG_energySegmentKinetic`,energySegmentPotential:`H6yJdG_energySegmentPotential`,energySegmentThermal:`H6yJdG_energySegmentThermal`,equipotentialPath:`H6yJdG_equipotentialPath`,equipotentials:`H6yJdG_equipotentials`,fieldGlyph:`H6yJdG_fieldGlyph`,fluidBlockBody:`H6yJdG_fluidBlockBody`,fluidBlockFloating:`H6yJdG_fluidBlockFloating`,fluidBlockSubmerged:`H6yJdG_fluidBlockSubmerged`,fluidDraggable:`H6yJdG_fluidDraggable`,fluidDragging:`H6yJdG_fluidDragging`,fluidLiquidBody:`H6yJdG_fluidLiquidBody`,fluidScaleBody:`H6yJdG_fluidScaleBody`,fluidScaleDial:`H6yJdG_fluidScaleDial`,fluidScaleNeedle:`H6yJdG_fluidScaleNeedle`,fluidScalePivot:`H6yJdG_fluidScalePivot`,fluidScaleReading:`H6yJdG_fluidScaleReading`,fluidScaleRing:`H6yJdG_fluidScaleRing`,fluidSurface:`H6yJdG_fluidSurface`,fluidSurfaceLabel:`H6yJdG_fluidSurfaceLabel`,fluidSurfaceLine:`H6yJdG_fluidSurfaceLine`,fluidTankWall:`H6yJdG_fluidTankWall`,fluidWire:`H6yJdG_fluidWire`,focalLabel:`H6yJdG_focalLabel`,focalTick:`H6yJdG_focalTick`,guideLabel:`H6yJdG_guideLabel`,guideLine:`H6yJdG_guideLine`,highlightGroup:`H6yJdG_highlightGroup`,holeCard:`H6yJdG_holeCard`,inductionChargeDot:`H6yJdG_inductionChargeDot`,inductionCoil:`H6yJdG_inductionCoil`,inductionCurrentArrow:`H6yJdG_inductionCurrentArrow`,inductionCurrentHead:`H6yJdG_inductionCurrentHead`,inductionCurrentLabel:`H6yJdG_inductionCurrentLabel`,inductionFieldBox:`H6yJdG_inductionFieldBox`,inductionFieldMark:`H6yJdG_inductionFieldMark`,inductionForceArrow:`H6yJdG_inductionForceArrow`,inductionForceHead:`H6yJdG_inductionForceHead`,inductionForceLabel:`H6yJdG_inductionForceLabel`,inductionRail:`H6yJdG_inductionRail`,inductionRailEdge:`H6yJdG_inductionRailEdge`,inductionResistor:`H6yJdG_inductionResistor`,inductionResistorLabel:`H6yJdG_inductionResistorLabel`,inductionRod:`H6yJdG_inductionRod`,inductionRodBed:`H6yJdG_inductionRodBed`,inductionRodContact:`H6yJdG_inductionRodContact`,inductionVelocity:`H6yJdG_inductionVelocity`,inductionVelocityHead:`H6yJdG_inductionVelocityHead`,inductionVelocityLabel:`H6yJdG_inductionVelocityLabel`,lensAxisLine:`H6yJdG_lensAxisLine`,lensBody:`H6yJdG_lensBody`,lensHead:`H6yJdG_lensHead`,leverBeamBar:`H6yJdG_leverBeamBar`,leverBeamTick:`H6yJdG_leverBeamTick`,leverFulcrum:`H6yJdG_leverFulcrum`,leverFulcrumBase:`H6yJdG_leverFulcrumBase`,leverFulcrumStand:`H6yJdG_leverFulcrumStand`,leverMass:`H6yJdG_leverMass`,leverMassHook:`H6yJdG_leverMassHook`,leverMassSlot:`H6yJdG_leverMassSlot`,leverString:`H6yJdG_leverString`,lightBoundary:`H6yJdG_lightBoundary`,lightCriticalRay:`H6yJdG_lightCriticalRay`,lightImage:`H6yJdG_lightImage`,lightNormal:`H6yJdG_lightNormal`,lightObject:`H6yJdG_lightObject`,lightRay:`H6yJdG_lightRay`,lightRefractedRay:`H6yJdG_lightRefractedRay`,lightScreen:`H6yJdG_lightScreen`,mirrorHatch:`H6yJdG_mirrorHatch`,mirrorPlate:`H6yJdG_mirrorPlate`,modernCathode:`H6yJdG_modernCathode`,modernCathodeFace:`H6yJdG_modernCathodeFace`,modernElectron:`H6yJdG_modernElectron`,modernElectronHead:`H6yJdG_modernElectronHead`,modernElectronPath:`H6yJdG_modernElectronPath`,modernLabel:`H6yJdG_modernLabel`,modernPhoton:`H6yJdG_modernPhoton`,modernPhotonHead:`H6yJdG_modernPhotonHead`,motorAxis:`H6yJdG_motorAxis`,motorCoil:`H6yJdG_motorCoil`,motorSide:`H6yJdG_motorSide`,motorSpin:`H6yJdG_motorSpin`,motorSpinArrow:`H6yJdG_motorSpinArrow`,motorSpinHalo:`H6yJdG_motorSpinHalo`,noiseBarrier:`H6yJdG_noiseBarrier`,noiseDistance:`H6yJdG_noiseDistance`,noiseListener:`H6yJdG_noiseListener`,noiseSource:`H6yJdG_noiseSource`,noiseWavefront:`H6yJdG_noiseWavefront`,opticalAxis:`H6yJdG_opticalAxis`,opticalImageHead:`H6yJdG_opticalImageHead`,opticalImageLabel:`H6yJdG_opticalImageLabel`,opticalImageLine:`H6yJdG_opticalImageLine`,opticalImageVirtual:`H6yJdG_opticalImageVirtual`,opticalObjectHead:`H6yJdG_opticalObjectHead`,opticalObjectLine:`H6yJdG_opticalObjectLine`,opticalRay:`H6yJdG_opticalRay`,opticalRayExtension:`H6yJdG_opticalRayExtension`,opticalRayHead:`H6yJdG_opticalRayHead`,orbitCenter:`H6yJdG_orbitCenter`,particleLabel:`H6yJdG_particleLabel`,particleLabelNegative:`H6yJdG_particleLabelNegative`,plateBar:`H6yJdG_plateBar`,plateBottom:`H6yJdG_plateBottom`,plateSignLabel:`H6yJdG_plateSignLabel`,plateTop:`H6yJdG_plateTop`,pressureBlock:`H6yJdG_pressureBlock`,pressureDish:`H6yJdG_pressureDish`,pressureGuide:`H6yJdG_pressureGuide`,pressureGuideLabel:`H6yJdG_pressureGuideLabel`,pressureHemisphere:`H6yJdG_pressureHemisphere`,pressureHemisphereJoint:`H6yJdG_pressureHemisphereJoint`,pressureLiquidBody:`H6yJdG_pressureLiquidBody`,pressureMercury:`H6yJdG_pressureMercury`,pressureMercuryPool:`H6yJdG_pressureMercuryPool`,pressurePlate:`H6yJdG_pressurePlate`,pressureProbeBody:`H6yJdG_pressureProbeBody`,pressureProbeDot:`H6yJdG_pressureProbeDot`,pressureReading:`H6yJdG_pressureReading`,pressureTube:`H6yJdG_pressureTube`,pressureVacuum:`H6yJdG_pressureVacuum`,pressureVesselLabel:`H6yJdG_pressureVesselLabel`,pressureVesselWall:`H6yJdG_pressureVesselWall`,probeDot:`H6yJdG_probeDot`,regionTintCrossed:`H6yJdG_regionTintCrossed`,regionTintElectric:`H6yJdG_regionTintElectric`,regionTintMagnetic:`H6yJdG_regionTintMagnetic`,screenFoot:`H6yJdG_screenFoot`,screenGlow:`H6yJdG_screenGlow`,screenPlate:`H6yJdG_screenPlate`,screenPlateLit:`H6yJdG_screenPlateLit`,streamlineArrow:`H6yJdG_streamlineArrow`,streamlinePath:`H6yJdG_streamlinePath`,thermalBeakerWall:`H6yJdG_thermalBeakerWall`,thermalBulb:`H6yJdG_thermalBulb`,thermalColumn:`H6yJdG_thermalColumn`,thermalFlame:`H6yJdG_thermalFlame`,thermalHeaterBody:`H6yJdG_thermalHeaterBody`,thermalMeltingLabel:`H6yJdG_thermalMeltingLabel`,thermalMeltingLine:`H6yJdG_thermalMeltingLine`,thermalReading:`H6yJdG_thermalReading`,thermalSampleLiquid:`H6yJdG_thermalSampleLiquid`,thermalSampleMelting:`H6yJdG_thermalSampleMelting`,thermalSampleSolid:`H6yJdG_thermalSampleSolid`,thermalSurface:`H6yJdG_thermalSurface`,thermalTick:`H6yJdG_thermalTick`,thermalTubeOuter:`H6yJdG_thermalTubeOuter`,thermometerColumn:`H6yJdG_thermometerColumn`,thermometerGlass:`H6yJdG_thermometerGlass`,thermometerSpan:`H6yJdG_thermometerSpan`,thermometerTick:`H6yJdG_thermometerTick`,thermometerTickLabel:`H6yJdG_thermometerTickLabel`,trajectoryDirection:`H6yJdG_trajectoryDirection`,trajectoryHistory:`H6yJdG_trajectoryHistory`,trajectoryPredicted:`H6yJdG_trajectoryPredicted`,trajectoryRunner:`H6yJdG_trajectoryRunner`,transformerCore:`H6yJdG_transformerCore`,transformerPrimaryLoop:`H6yJdG_transformerPrimaryLoop`,transformerSecondaryLoop:`H6yJdG_transformerSecondaryLoop`,waveAntinode:`H6yJdG_waveAntinode`,waveClamp:`H6yJdG_waveClamp`,waveClampHatch:`H6yJdG_waveClampHatch`,waveDriver:`H6yJdG_waveDriver`,waveDriverPin:`H6yJdG_waveDriverPin`,waveEnvelope:`H6yJdG_waveEnvelope`,waveEquilibrium:`H6yJdG_waveEquilibrium`,waveFront:`H6yJdG_waveFront`,waveFrontGroup:`H6yJdG_waveFrontGroup`,waveMarker:`H6yJdG_waveMarker`,waveMarkerGuide:`H6yJdG_waveMarkerGuide`,waveMedium:`H6yJdG_waveMedium`,waveMediumGuide:`H6yJdG_waveMediumGuide`,waveMediumNode:`H6yJdG_waveMediumNode`,waveNode:`H6yJdG_waveNode`,wavePoint:`H6yJdG_wavePoint`,wavePointConstructive:`H6yJdG_wavePointConstructive`,wavePointDestructive:`H6yJdG_wavePointDestructive`,wavePointLabel:`H6yJdG_wavePointLabel`,wavePointPartial:`H6yJdG_wavePointPartial`,waveRope:`H6yJdG_waveRope`,waveSource:`H6yJdG_waveSource`,waveSourceStem:`H6yJdG_waveSourceStem`,waveString:`H6yJdG_waveString`};const Ce=(e,t,n,r,i)=>{let a=e-n*i,o=t-r*i,s=-r*i*.46,c=n*i*.46;return`M${e} ${t} L${a+s} ${o+c} L${a-s} ${o-c} Z`},we=(e,t,n,r)=>{let i=n*.766,a=r?e+n:e-n;return`M${a-(r?n:-n)*.36} ${t-i} Q${a} ${t} ${a-(r?n:-n)*.36} ${t+i}`},Te=({x:e,footY:t,size:n,highlighted:r})=>{let i=t-n*1.02;return(0,D.jsxs)(`g`,{className:r?P.highlightGroup:void 0,children:[(0,D.jsx)(`path`,{className:P.acousticSourceStand,d:`M${e-n*.3} ${i+n*.42} L${e-n*.62} ${t} M${e-n*.3} ${i+n*.42} L${e+n*.02} ${t}`}),(0,D.jsx)(`path`,{className:P.acousticSourceBody,d:[`M${e-n*.7} ${i-n*.42}`,`h${n*.55} l${n*.6} ${-n*.34}`,`v${n*1.52} l${-n*.6} ${-n*.34}`,`h${-n*.55} z`].join(` `)}),(0,D.jsx)(`path`,{className:P.acousticSourceCone,d:`M${e-n*.15} ${i-n*.3} L${e+n*.32} ${i-n*.58} M${e-n*.15} ${i+n*.3} L${e+n*.32} ${i+n*.58}`}),(0,D.jsx)(`path`,{className:P.acousticSourceWave,d:`M${e+n*.55} ${i-n*.34} Q${e+n*.72} ${i} ${e+n*.55} ${i+n*.34}`}),(0,D.jsx)(`path`,{className:P.acousticSourceWave,d:`M${e+n*.72} ${i-n*.5} Q${e+n*.98} ${i} ${e+n*.72} ${i+n*.5}`})]})};function Ee({view:e,projection:t}){let n=e.visible.wavefronts===!0,r=e.visible.path===!0,i=e.acousticPulse,a=(e.acousticReflectors?.[0]?.halfHeight??8)*t.scale,o=Math.max(14,Math.min(34,a*.5));return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`defs`,{children:(0,D.jsx)(A,{uid:t.uid})}),e.ground===void 0?null:(0,D.jsx)(de,{ground:e.ground,projection:t}),r?e.guides.map(e=>{let n=t.px(e.from),r=t.py(e.from),i=t.px(e.to),a=t.py(e.to),o=Math.hypot(i-n,a-r)||1,s=(i-n)/o,c=(a-r)/o;return(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`line`,{className:P.acousticPathLine,x1:n,y1:r,x2:i,y2:a}),(0,D.jsx)(`path`,{className:P.acousticPathHead,d:Ce((n+i)/2+s*14,(r+a)/2+c*14,s,c,8)}),e.label===void 0?null:(0,D.jsx)(`text`,{className:P.acousticPathLabel,x:(n+i)/2,y:r-7,textAnchor:`middle`,children:e.label})]},e.id)}):null,e.dimensions.map(e=>(0,D.jsx)(ye,{dimension:e,projection:t},e.id)),(e.acousticReflectors??[]).map(e=>{let n=t.px(e.at),r=t.py(e.at),i=t.py({x:0,y:e.at.y+2*e.halfHeight}),a=Math.max(4,Math.floor((r-i)/12));return(0,D.jsxs)(`g`,{className:t.highlighted(e.id)?P.highlightGroup:void 0,children:[(0,D.jsx)(`rect`,{className:P.acousticWallFace,x:n,y:i,width:13,height:r-i}),(0,D.jsx)(`line`,{className:P.acousticWallPlate,x1:n,y1:i,x2:n,y2:r}),Array.from({length:a},(e,t)=>{let o=i+(t+.5)/a*(r-i);return(0,D.jsx)(`line`,{className:P.acousticWallHatch,x1:n+3,y1:o+4.5,x2:n+11,y2:o-4.5},t)}),e.label===void 0?null:(0,D.jsx)(`text`,{className:P.annotation,x:n,y:i-8,textAnchor:`middle`,children:e.label})]},e.id)}),(e.acousticSources??[]).map(e=>{let n=t.px(e.at),r=t.py(e.at);return(0,D.jsxs)(`g`,{children:[(0,D.jsx)(Te,{x:n,footY:r,size:o,highlighted:t.highlighted(e.id)}),e.label===void 0?null:(0,D.jsx)(`text`,{className:P.annotation,x:n,y:r+19,textAnchor:`middle`,children:e.label})]},e.id)}),n&&i!==void 0?(e.acousticWavefronts??[]).map(e=>(0,D.jsx)(`path`,{className:P.acousticWavefront,d:we(t.px(e.at),t.py(e.at),e.radius*t.scale,e.direction===`forward`)},e.id)):null,i===void 0?null:(0,D.jsx)(`circle`,{className:N(P.acousticPulseDot,i.phase===`received`&&P.acousticPulseReceived,t.highlighted(i.id)&&P.highlightGroup),cx:t.px(i.at),cy:t.py(i.at),r:5})]})}function De(e){return Number.isFinite(Date.parse(e))}var Oe=class extends Error{code;retryable;details;constructor(e,t,n){super(t),this.name=`PhysicsOSError`,this.code=e,this.retryable=n?.retryable??!1,this.details=n?.details??{}}};Object.freeze({x:0,y:0,z:0}),Object.freeze({x:1,y:0,z:0}),Object.freeze({x:0,y:1,z:0}),Object.freeze({x:0,y:0,z:1}),Math.PI*2,new Set(`dimensionless.length.time.mass.electric_current.temperature.electric_charge.velocity.acceleration.force.energy.power.electric_field.electric_potential.magnetic_flux_density.magnetic_flux.magnetic_flux_rate.resistance.capacitance.inductance.frequency.angle.angular_velocity.momentum.pressure.density.volume.area.specific_heat.specific_latent_heat.torque.intensity`.split(`.`));const F=(e,t,n,r,i,a=[])=>({key:e,dimension:t,symbol:n,toSI:r,canonical:i,aliases:a}),ke=[F(`dimensionless`,`dimensionless`,``,1,!0,[`1`,`-`]),F(`meter`,`length`,`m`,1,!0,[`metre`,`meters`]),F(`centimeter`,`length`,`cm`,.01,!1,[`centimetre`]),F(`millimeter`,`length`,`mm`,.001,!1,[`millimetre`]),F(`nanometer`,`length`,`nm`,1e-9,!1,[`nanometre`]),F(`kilometer`,`length`,`km`,1e3,!1,[`kilometre`]),F(`second`,`time`,`s`,1,!0,[`sec`,`seconds`]),F(`millisecond`,`time`,`ms`,.001,!1),F(`microsecond`,`time`,`us`,1e-6,!1,[`µs`,`μs`]),F(`minute`,`time`,`min`,60,!1),F(`kilogram`,`mass`,`kg`,1,!0,[`kilogramme`]),F(`gram`,`mass`,`g`,.001,!1,[`gramme`]),F(`ampere`,`electric_current`,`A`,1,!0,[`amp`]),F(`kelvin`,`temperature`,`K`,1,!0),F(`coulomb`,`electric_charge`,`C`,1,!0),F(`millicoulomb`,`electric_charge`,`mC`,.001,!1),F(`microcoulomb`,`electric_charge`,`µC`,1e-6,!1,[`μC`,`uC`]),F(`nanocoulomb`,`electric_charge`,`nC`,1e-9,!1),F(`meter_per_second`,`velocity`,`m/s`,1,!0,[`m*s^-1`,`m s^-1`,`mps`]),F(`kilometer_per_hour`,`velocity`,`km/h`,1e3/3600,!1,[`kph`,`kmph`]),F(`kilometer_per_second`,`velocity`,`km/s`,1e3,!1,[`km*s^-1`]),F(`meter_per_second_squared`,`acceleration`,`m/s^2`,1,!0,[`m/s²`,`m*s^-2`]),F(`newton`,`force`,`N`,1,!0),F(`joule`,`energy`,`J`,1,!0),F(`electron_volt`,`energy`,`eV`,1602176634e-28,!1),F(`watt`,`power`,`W`,1,!0),F(`watt_per_square_meter`,`intensity`,`W/m^2`,1,!0,[`W/m²`,`W*m^-2`]),F(`volt_per_meter`,`electric_field`,`V/m`,1,!0,[`N/C`]),F(`volt`,`electric_potential`,`V`,1,!0),F(`tesla`,`magnetic_flux_density`,`T`,1,!0),F(`millitesla`,`magnetic_flux_density`,`mT`,.001,!1),F(`microtesla`,`magnetic_flux_density`,`µT`,1e-6,!1,[`μT`,`uT`]),F(`weber`,`magnetic_flux`,`Wb`,1,!0),F(`weber_per_second`,`magnetic_flux_rate`,`Wb/s`,1,!0,[`Wb*s^-1`]),F(`ohm`,`resistance`,`Ω`,1,!0,[`Ω`,`ohm`,`ohms`]),F(`farad`,`capacitance`,`F`,1,!0),F(`henry`,`inductance`,`H`,1,!0),F(`hertz`,`frequency`,`Hz`,1,!0,[`s^-1`]),F(`kilohertz`,`frequency`,`kHz`,1e3,!1,[`kilohertz`]),F(`radian`,`angle`,`rad`,1,!0),F(`degree`,`angle`,`deg`,Math.PI/180,!1,[`°`]),F(`radian_per_second`,`angular_velocity`,`rad/s`,1,!0,[`rad*s^-1`]),F(`kilogram_meter_per_second`,`momentum`,`kg*m/s`,1,!0,[`kg·m/s`,`kg m/s`]),F(`pascal`,`pressure`,`Pa`,1,!0),F(`kilogram_per_cubic_meter`,`density`,`kg/m^3`,1,!0,[`kg/m³`]),F(`cubic_meter`,`volume`,`m^3`,1,!0,[`m³`]),F(`cubic_centimeter`,`volume`,`cm^3`,1e-6,!1,[`cm³`,`cc`]),F(`liter`,`volume`,`L`,.001,!1,[`litre`]),F(`milliliter`,`volume`,`mL`,1e-6,!1,[`millilitre`,`ml`]),F(`square_meter`,`area`,`m^2`,1,!0,[`m²`]),F(`square_centimeter`,`area`,`cm^2`,1e-4,!1,[`cm²`]),F(`joule_per_kilogram_kelvin`,`specific_heat`,`J/(kg*K)`,1,!0,[`J/(kg·K)`,`J/(kg·℃)`,`J/(kg*C)`]),F(`joule_per_kilogram`,`specific_latent_heat`,`J/kg`,1,!0,[`J*kg^-1`]),F(`newton_meter`,`torque`,`N*m`,1,!0,[`N·m`,`N m`]),F(`newton_centimeter`,`torque`,`N*cm`,.01,!1,[`N·cm`,`N cm`])],Ae=e=>e.normalize(`NFC`).trim(),je=new Map,Me=new Map,Ne=new Map,Pe=e=>{if(Me.has(e.key))throw new Oe(`DUPLICATE_UNIT_KEY`,`Unit key "${e.key}" registered twice.`);Me.set(e.key,e);let t=[e.symbol,e.key,...e.aliases];for(let n of t){let t=Ae(n),r=je.get(t);if(r!==void 0&&r.key!==e.key)throw new Oe(`AMBIGUOUS_UNIT_SYMBOL`,`Unit symbol "${t}" maps to both "${r.key}" and "${e.key}".`);je.set(t,e)}if(e.canonical){let t=Ne.get(e.dimension);if(t!==void 0)throw new Oe(`DUPLICATE_CANONICAL_UNIT`,`Dimension "${e.dimension}" already has canonical unit "${t.key}".`);Ne.set(e.dimension,e)}};for(let e of ke)Pe(e);const Fe=e=>je.get(Ae(e));Object.freeze({relative:1e-9,absolute:1e-12,angular:1e-9}),Object.freeze({relative:1e-6,absolute:1e-9,angular:1e-6});const Ie=.75,Le=e=>{switch(e??0){case 0:return{x:1,y:0};case 90:return{x:0,y:1};case 180:return{x:-1,y:0};case 270:return{x:0,y:-1}}},Re=(e,t)=>{let n=Le(e.rotation),r=t===`a`||t===`negative`?-1:1;return{x:e.x+r*Ie*n.x,y:e.y+r*Ie*n.y}},ze=(e,t)=>/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t)?`${e}.${t}`:`${e}[${JSON.stringify(t)}]`,Be=(e,t)=>Object.prototype.hasOwnProperty.call(e,t),Ve=e=>typeof e==`object`&&!!e&&!Array.isArray(e),He=e=>Array.isArray(e),I=e=>({optional:!1,check:e}),L=e=>({optional:!0,check:e}),R=(e,t=!1)=>{let n=Object.entries(e);return(r,i,a)=>{if(!Ve(r))return a.reject(i,`invalid_type`,`Expected a plain data object.`);let o=!0;for(let[e,t]of n){let n=ze(i,e);Be(r,e)?t.check(r[e],n,a)||(o=!1):t.optional||(o=a.reject(n,`missing_property`,`This contract property is required.`))}if(!t)for(let t of Object.keys(r))Be(e,t)||(o=a.reject(ze(i,t),`unexpected_property`,`This property is not part of the scene contract.`));return o}},Ue=(e,t)=>(n,r,i)=>e(n,r,i)&&t(n,r,i),z=(e,t,n)=>typeof e==`string`||n.reject(t,`invalid_type`,`Expected a string.`),B=()=>(e,t,n)=>typeof e==`string`&&e.trim().length>0||n.reject(t,`invalid_identifier`,`Expected a non-empty string identifier; no prefix is required.`),We=(e,t,n)=>typeof e==`boolean`||n.reject(t,`invalid_type`,`Expected a boolean.`),Ge=(e,t,n)=>typeof e==`number`?Number.isFinite(e)||n.reject(t,`non_finite_number`,`Expected a finite number.`):n.reject(t,`invalid_type`,`Expected a number.`),Ke=Ue(Ge,(e,t,n)=>Number.isSafeInteger(e)&&e>=0||n.reject(t,`invalid_revision`,`Expected a non-negative safe integer revision.`)),qe=Ue(z,(e,t,n)=>De(e)||n.reject(t,`invalid_datetime`,`Expected a valid date-time string.`)),V=e=>(t,n,r)=>t===e||r.reject(n,`invalid_literal`,`Expected ${JSON.stringify(e)}.`),H=e=>{let t=new Set(e);return(n,r,i)=>typeof n==`string`&&t.has(n)||i.reject(r,`invalid_enum`,`Expected one of ${e.map(e=>JSON.stringify(e)).join(`, `)}.`)},U=e=>(t,n,r)=>{if(!He(t))return r.reject(n,`invalid_type`,`Expected an array.`);let i=!0;for(let a=0;a<t.length;a+=1)e(t[a],`${n}[${a}]`,r)||(i=!1);return i},Je=(e,t,n)=>Ve(e)||n.reject(t,`invalid_type`,`Expected a JSON data object, not an array.`),Ye=e=>{let t=e;return(e,n,r)=>{if(!Ve(e))return r.reject(n,`invalid_type`,`Expected a discriminated data object.`);let i=e.type;if(typeof i!=`string`||!Be(t,i))return r.reject(ze(n,`type`),`invalid_union`,`Expected a supported type: ${Object.keys(t).join(`, `)}.`);let a=t[i];return a!==void 0&&a(e,n,r)}},Xe=R({x:I(Ge),y:I(Ge),z:I(Ge)}),Ze=e=>(t,n,r)=>{if(!z(t,n,r))return!1;let i=Fe(t);return i===void 0?r.reject(n,`unknown_unit`,`The unit must be registered in physics-units.`):i.dimension===e||r.reject(n,`dimension_mismatch`,`The registered unit must have dimension ${e}.`)},Qe=e=>(t,n,r)=>t===e||r.reject(n,`dimension_mismatch`,`This quantity must declare dimension ${e}.`),$e=(e,t,n,r)=>{let i=Fe(t);return i===void 0?r.reject(n,`unknown_unit`,`The unit must be registered in physics-units.`):Number.isFinite(e*i.toSI)||r.reject(n,`canonical_overflow`,`The value overflows when converted to canonical SI units.`)},W=e=>Ue(R({value:I(Ge),unit:I(Ze(e)),dimension:I(Qe(e))}),(e,t,n)=>$e(e.value,e.unit,ze(t,`value`),n)),et=e=>Ue(R({vector:I(Xe),unit:I(Ze(e)),dimension:I(Qe(e))}),(e,t,n)=>{let r=!0;for(let i of[`x`,`y`,`z`])$e(e.vector[i],e.unit,`${t}.vector.${i}`,n)||(r=!1);return r}),tt=e=>{let t=W(e);return(e,n,r)=>{if(!He(e))return r.reject(n,`invalid_type`,`Expected a two-element quantity tuple.`);let i=e.length===2||r.reject(n,`invalid_tuple`,`Expected exactly two quantities in this tuple.`);for(let a=0;a<e.length;a+=1)t(e[a],`${n}[${a}]`,r)||(i=!1);return i}},nt=Ue(R({type:I(V(`cartesian`)),origin:I(Xe),axes:I(R({x:I(Xe),y:I(Xe),z:I(Xe)})),lengthUnit:I(Ze(`length`))}),(e,t,n)=>{let r=!0;for(let i of[`x`,`y`,`z`]){$e(e.origin[i],e.lengthUnit,`${t}.origin.${i}`,n)||(r=!1);let a=e.axes[i];a.x===0&&a.y===0&&a.z===0&&(r=n.reject(`${t}.axes.${i}`,`invalid_axis`,`A coordinate axis must be a non-zero finite vector.`))}return r}),rt=Ue(R({currentTime:I(W(`time`)),startTime:I(W(`time`)),endTime:L(W(`time`)),state:I(H([`idle`,`running`,`paused`,`completed`,`error`])),playbackRate:I(Ge),simulationTimeStep:L(W(`time`))}),(e,t,n)=>{let r=!0;if(e.playbackRate<=0&&(r=n.reject(`${t}.playbackRate`,`invalid_playback_rate`,`Playback rate must be greater than zero.`)),e.simulationTimeStep!==void 0&&e.simulationTimeStep.value<=0&&(r=n.reject(`${t}.simulationTimeStep.value`,`invalid_time_step`,`Simulation time step must be greater than zero.`)),e.endTime!==void 0){let i=Fe(e.startTime.unit),a=Fe(e.endTime.unit);i!==void 0&&a!==void 0&&e.endTime.value*a.toSI<e.startTime.value*i.toSI&&(r=n.reject(`${t}.endTime`,`invalid_time_range`,`End time cannot precede start time; a zero-duration timeline is allowed.`))}return r}),G={id:I(B()),name:L(z),enabled:L(We),tags:L(U(z)),metadata:L(Je)},it=Ye({circle:R({type:I(V(`circle`)),radius:I(W(`length`))}),rectangle:R({type:I(V(`rectangle`)),width:I(W(`length`)),height:I(W(`length`))}),polygon:R({type:I(V(`polygon`)),vertices:I(U(et(`length`)))}),segment:R({type:I(V(`segment`)),start:I(et(`length`)),end:I(et(`length`))}),point:R({type:I(V(`point`))})}),at=R({density:L(W(`density`)),frictionCoefficient:L(Ge),staticFrictionCoefficient:L(Ge),restitution:L(Ge),custom:L(Je)}),ot=R({...G,type:I(V(`rigid_body`)),mass:I(W(`mass`)),position:I(et(`length`)),velocity:I(et(`velocity`)),acceleration:L(et(`acceleration`)),shape:I(it),material:L(at),fixed:L(We)}),st=R({...G,type:I(V(`particle`)),mass:I(W(`mass`)),charge:L(W(`electric_charge`)),position:I(et(`length`)),velocity:I(et(`velocity`)),acceleration:L(et(`acceleration`)),species:L(z),fixed:L(We)}),ct={...G,regionId:L(B())},lt=Ye({uniform_electric:R({...ct,type:I(V(`uniform_electric`)),fieldStrength:I(et(`electric_field`))}),uniform_magnetic:R({...ct,type:I(V(`uniform_magnetic`)),magneticFluxDensity:I(et(`magnetic_flux_density`))}),uniform_gravity:R({...ct,type:I(V(`uniform_gravity`)),acceleration:I(et(`acceleration`))}),point_charge:R({...ct,type:I(V(`point_charge`)),sourceParticleId:I(B())})}),ut=R({...G,type:I(H([`gravity`,`normal`,`friction`,`tension`,`spring`,`electric`,`lorentz`,`ampere`,`drag`,`custom`])),targetId:I(B()),sourceId:L(B()),vector:L(et(`force`)),derived:L(We),model:L(z)}),dt=Ye({rectangle:R({type:I(V(`rectangle`)),width:I(W(`length`)),height:I(W(`length`))}),circle:R({type:I(V(`circle`)),radius:I(W(`length`))}),polygon:R({type:I(V(`polygon`)),vertices:I(U(et(`length`)))}),half_plane:R({type:I(V(`half_plane`)),normal:I(Xe),offset:I(W(`length`))}),unbounded:R({type:I(V(`unbounded`))})}),ft=R({...G,shape:I(dt),center:I(et(`length`))}),pt=Ye({pass_through:R({type:I(V(`pass_through`))}),reflect:R({type:I(V(`reflect`)),restitution:L(Ge)}),stop:R({type:I(V(`stop`))}),custom:R({type:I(V(`custom`)),model:I(z)})}),mt=R({...G,type:I(H([`line`,`segment`,`circle`,`rectangle`,`polygon`])),geometry:I(it),behavior:L(pt)}),ht=R({...G,type:I(H([`fixed`,`distance`,`rope`,`hinge`,`surface`,`spring`,`track`,`custom`])),targets:I(U(B())),parameters:I(Je)}),gt={id:I(B()),name:L(z),enabled:L(We)},_t=Ye({resistor:R({...gt,type:I(V(`resistor`)),resistance:I(W(`resistance`))}),voltage_source:R({...gt,type:I(V(`voltage_source`)),voltage:I(W(`electric_potential`)),internalResistance:L(W(`resistance`))}),switch:R({...gt,type:I(V(`switch`)),state:I(H([`open`,`closed`]))}),ammeter:R({...gt,type:I(V(`ammeter`)),internalResistance:L(W(`resistance`))}),voltmeter:R({...gt,type:I(V(`voltmeter`)),internalResistance:L(W(`resistance`))}),variable_resistor:R({...gt,type:I(V(`variable_resistor`)),totalResistance:I(W(`resistance`)),sliderPosition:I(Ge)}),capacitor:R({...gt,type:I(V(`capacitor`)),capacitance:I(W(`capacitance`)),initialVoltage:L(W(`electric_potential`))}),inductor:R({...gt,type:I(V(`inductor`)),inductance:I(W(`inductance`))})}),vt=R({id:I(B()),label:L(z)}),yt=R({id:I(B()),componentId:I(B()),terminalKey:I(B())}),bt=R({id:I(B()),from:I(yt),to:I(yt)}),xt=R({...G,type:I(V(`circuit`)),nodes:I(U(vt)),components:I(U(_t)),connections:I(U(bt))}),St=R({id:I(B()),name:L(z),position:I(W(`length`)),height:I(W(`length`))}),Ct={id:I(B()),name:L(z),enabled:L(We),position:I(W(`length`)),apertureRadius:L(W(`length`))},wt=Ye({thin_lens:R({...Ct,type:I(V(`thin_lens`)),focalLength:I(W(`length`))}),plane_mirror:R({...Ct,type:I(V(`plane_mirror`))}),curved_mirror:R({...Ct,type:I(V(`curved_mirror`)),focalLength:I(W(`length`))})}),Tt=R({id:I(B()),name:L(z),position:I(W(`length`))}),Et=R({...G,type:I(V(`optical_bench`)),object:I(St),elements:I(U(wt)),screen:L(Tt)}),Dt=R({id:I(B()),name:L(z),position:I(W(`length`))}),Ot=R({id:I(B()),name:L(z),position:I(W(`length`))}),kt=R({...G,type:I(V(`acoustic_bench`)),source:I(Dt),reflector:I(Ot),soundSpeed:I(W(`velocity`))}),At=R({id:I(B()),name:L(z),mass:I(W(`mass`)),volume:I(W(`volume`)),height:I(W(`length`))}),jt=R({id:I(B()),name:L(z),density:I(W(`density`))}),Mt=R({...G,type:I(V(`fluid_tank`)),block:I(At),liquid:I(jt),lowerRate:I(W(`velocity`)),gravity:I(W(`acceleration`))}),Nt=R({id:I(B()),name:L(z),mass:I(W(`mass`)),solidSpecificHeat:I(W(`specific_heat`)),liquidSpecificHeat:I(W(`specific_heat`)),latentHeat:I(W(`specific_latent_heat`)),meltingPoint:I(W(`temperature`)),boilingPoint:L(W(`temperature`)),vaporizationHeat:L(W(`specific_latent_heat`)),initialTemperature:I(W(`temperature`))}),Pt=R({...G,type:I(V(`thermal_bench`)),sample:I(Nt),comparisonSample:L(Nt),heaterPower:I(W(`power`)),runDuration:L(W(`time`))}),Ft=R({id:I(B()),name:L(z),side:I(H([`left`,`right`])),mass:I(W(`mass`)),armLength:I(W(`length`))}),K=R({...G,type:I(V(`lever_bench`)),beamLength:I(W(`length`)),gravity:I(W(`acceleration`)),hangers:I(U(Ft))}),It=R({...G,type:I(H([`bar_motion`,`flux_change`,`double_bar_rail`])),magneticFluxDensity:I(W(`magnetic_flux_density`)),resistance:I(W(`resistance`)),barLength:L(W(`length`)),barVelocity:L(W(`velocity`)),coilArea:L(W(`area`)),coilAngle:L(W(`angle`)),fluxRate:L(W(`magnetic_flux_rate`)),barMasses:L(tt(`mass`)),barVelocities:L(tt(`velocity`)),barPositions:L(tt(`length`)),externalForce:L(W(`force`))}),Lt=R({...G,type:I(H([`travelling`,`interference`,`standing`,`longitudinal`,`reflection_refraction`,`diffraction`,`doppler`])),amplitude:I(W(`length`)),frequency:I(W(`frequency`)),wavelength:L(W(`length`)),ropeLength:L(W(`length`)),sourceSeparation:L(W(`length`)),pathOne:L(W(`length`)),pathTwo:L(W(`length`)),stringLength:L(W(`length`)),harmonic:L(Ge),waveSpeed:L(W(`velocity`)),mediumLength:L(W(`length`)),incidentSpeed:L(W(`velocity`)),transmittedWaveSpeed:L(W(`velocity`)),incidentAngle:L(W(`angle`)),slitWidth:L(W(`length`)),screenDistance:L(W(`length`)),diffractionOrder:L(Ge),sourceSpeed:L(W(`velocity`)),observerSpeed:L(W(`velocity`)),sourceDirection:L(H([`approaching`,`receding`])),observerDirection:L(H([`approaching`,`receding`,`stationary`]))}),Rt=R({...G,type:I(V(`cyclotron`)),magneticFluxDensity:I(W(`magnetic_flux_density`)),magneticOrientation:I(H([`into_page`,`out_of_page`])),gapVoltage:I(W(`electric_potential`)),gapWidth:I(W(`length`)),deeRadius:I(W(`length`))}),zt=R({...G,type:I(V(`photoelectric_effect`)),workFunction:I(W(`energy`)),photonWavelength:I(W(`length`)),lightIntensity:I(W(`intensity`)),cathodeArea:I(W(`area`)),quantumEfficiency:I(Ge)}),Bt=R({...G,type:I(H([`solid`,`liquid`,`atmospheric`])),force:L(W(`force`)),area:L(W(`area`)),comparisonArea:L(W(`area`)),gravity:L(W(`acceleration`)),liquidDensity:L(W(`density`)),depth:L(W(`length`)),comparisonDepth:L(W(`length`)),comparisonLiquidDensity:L(W(`density`)),atmosphericPressure:L(W(`pressure`)),barometerFluidDensity:L(W(`density`)),hemisphereRadius:L(W(`length`))}),Vt=R({...G,type:I(H([`straight_wire`,`solenoid`,`electromagnet`,`motor`])),current:L(W(`electric_current`)),probeDistance:L(W(`length`)),comparisonDistance:L(W(`length`)),turns:L(W(`dimensionless`)),comparisonTurns:L(W(`dimensionless`)),coilLength:L(W(`length`)),coreRelativePermeability:L(W(`dimensionless`)),comparisonCoreRelativePermeability:L(W(`dimensionless`)),coreArea:L(W(`area`)),gravity:L(W(`acceleration`)),magneticFluxDensity:L(W(`magnetic_flux_density`)),sideLength:L(W(`length`)),coilWidth:L(W(`length`)),coilAngle:L(W(`angle`))}),Ht=R({...G,type:I(V(`energy_bench`)),mass:I(W(`mass`)),gravity:I(W(`acceleration`)),releaseHeight:I(W(`length`)),inclineAngle:I(W(`angle`)),frictionCoefficient:I(W(`dimensionless`))}),Ut=R({...G,type:I(H([`pinhole`,`total_reflection`])),objectHeight:L(W(`length`)),objectDistance:L(W(`length`)),screenDistance:L(W(`length`)),incidentIndex:L(W(`dimensionless`)),refractedIndex:L(W(`dimensionless`)),incidentAngle:L(W(`angle`))}),Wt=R({...G,type:I(V(`transformer`)),primaryVoltage:I(W(`electric_potential`)),primaryCurrent:I(W(`electric_current`)),primaryTurns:I(W(`dimensionless`)),secondaryTurns:I(W(`dimensionless`))}),Gt=R({...G,type:I(V(`liquid_in_glass`)),bulbVolume:I(W(`volume`)),boreDiameter:I(W(`length`)),expansionCoefficient:I(W(`dimensionless`)),temperature:I(W(`temperature`)),icePointLength:I(W(`length`))}),Kt=R({...G,type:I(V(`noise`)),soundPowerLevel:I(W(`dimensionless`)),distance:I(W(`length`)),barrierAttenuation:I(W(`dimensionless`))}),qt=R({id:I(B()),type:I(H([`position`,`velocity`,`acceleration`,`force`,`energy`,`current`,`voltage`,`electric_field`,`magnetic_field`,`custom`])),targetId:L(B()),componentId:L(B()),enabled:I(We)}),Jt=R({emphasis:L(H([`normal`,`highlight`])),labelVisible:L(We),scale:L(Ge),token:L(z)}),Yt=R({id:I(B()),type:I(H([`force`,`velocity`,`acceleration`,`momentum`,`trajectory`,`electric_field`,`electric_potential`,`magnetic_field`,`energy`,`current`,`voltage`,`measurement`,`graph`,`geometry`,`annotation`])),targetId:L(B()),visible:I(We),style:L(Jt),parameters:L(Je)}),Xt=R({id:I(B()),type:I(H([`label`,`formula`,`marker`,`guide`,`teacher_note`])),targetId:L(B()),content:I(z),visible:I(We)}),Zt=R({origin:I(H([`question`,`template`,`blank`])),branchType:I(V(`experimental`)),originQuestionId:L(B()),originSceneId:I(B()),parentSceneId:I(B()),parentRevision:I(Ke),forkedAt:I(qe)}),Qt=R({kind:I(V(`official`)),id:I(B()),experimentId:I(B()),version:I(B())}),$t=Ue(z,(e,t,n)=>/^[a-fA-F0-9]{64}$/.test(e)||n.reject(t,`invalid_sha256`,`Expected a 64-character hexadecimal SHA-256 digest.`)),en=R({kind:L(V(`community`)),id:I(B()),experimentId:I(B()),version:I(B()),sha256:I($t)}),tn=(e,t,n)=>Ve(e)?e.kind===`official`?Qt(e,t,n):!Be(e,`kind`)||e.kind===`community`?en(e,t,n):n.reject(`${t}.kind`,`invalid_enum`,`Experiment release kind must be official or community; community kind may be omitted.`):n.reject(t,`invalid_type`,`Expected an experiment release identity.`),nn=(e,t,n)=>{let r=!0,i=new Map;return e.forEach((e,a)=>{let o=`${t}[${a}].id`,s=i.get(e.id);s===void 0?i.set(e.id,o):r=n.reject(o,`duplicate_id`,`This identifier is already defined at ${s}.`)}),r},rn=R({id:I(B()),value:I(Ge),unit:I(z)}),an=Ue(R({experimentRelease:L(tn),id:I(B()),recordedAt:I(z),sceneId:I(B()),sceneRevision:I(Ke),columns:I(U(z)),values:I(U(z)),parameters:I(U(rn))}),(e,t,n)=>{let r=nn(e.parameters,`${t}.parameters`,n);return e.columns.length!==e.values.length&&(r=n.reject(`${t}.values`,`invalid_observation_row`,`Observation values must have the same length as columns.`)),r}),on=Ue(R({version:I(V(1)),entries:I(U(an))}),(e,t,n)=>nn(e.entries,`${t}.entries`,n)),sn=R({type:I(H([`user`,`agent`,`system`,`teacher`,`migration`])),id:L(z)}),cn=R({experimentRelease:L(tn),experimentNotebook:L(on),createdAt:I(qe),updatedAt:I(qe),createdBy:L(sn),title:L(z),description:L(z),curriculumTags:L(U(z)),knowledgeTags:L(U(z)),sourceQuestionId:L(B()),engineVersion:L(z),lineage:L(Zt)},!0);R({schemaVersion:I(V(`physics-scene/1.0`)),id:I(B()),revision:I(Ke),dimension:I(H([`2d`,`3d`])),coordinateSystem:I(nt),timeline:I(rt),bodies:I(U(ot)),particles:I(U(st)),fields:I(U(lt)),forces:I(U(ut)),regions:I(U(ft)),boundaries:I(U(mt)),constraints:I(U(ht)),circuits:I(U(xt)),opticalBenches:I(U(Et)),acousticBenches:I(U(kt)),fluidTanks:I(U(Mt)),thermalBenches:I(U(Pt)),leverBenches:I(U(K)),inductionBenches:L(U(It)),waveBenches:L(U(Lt)),cyclotronBenches:L(U(Rt)),modernPhysicsBenches:L(U(zt)),pressureBenches:L(U(Bt)),currentBenches:L(U(Vt)),energyBenches:L(U(Ht)),lightBenches:L(U(Ut)),transformerBenches:L(U(Wt)),thermometerBenches:L(U(Gt)),noiseBenches:L(U(Kt)),measurementDefinitions:I(U(qt)),observableDefinitions:I(U(Yt)),annotations:I(U(Xt)),metadata:I(cn)});const ln={ammeter:{file:`ammeter.png`,pixels:{w:389,h:414},solidBox:{left:.0591,top:.0338,width:.8817,height:.9275},axis:`base`},battery:{file:`studio-v2/battery.png`,pixels:{w:574,h:203},solidBox:{left:.053886,top:.152493,width:.892228,height:.692082},axis:`axial`,terminalOrder:`reversed`,terminals:{a:{x:.121244,y:.501466},b:{x:.878756,y:.501466}}},"lamp-off":{file:`lamp-off.png`,pixels:{w:262,h:430},solidBox:{left:.0878,top:.0535,width:.8244,height:.893},axis:`base`},"lamp-on":{file:`lamp-on.png`,pixels:{w:269,h:428},solidBox:{left:.0855,top:.0491,width:.829,height:.8972},axis:`base`},resistor:{file:`studio-v2/resistor.png`,pixels:{w:573,h:197},solidBox:{left:.054255,top:.157407,width:.892553,height:.685185},axis:`axial`,terminals:{a:{x:.145745,y:.496914},b:{x:.854255,y:.496914}}},rheostat:{file:`studio-v2/rheostat.png`,pixels:{w:574,h:210},solidBox:{left:.054672,top:.146341,width:.890656,height:.704607},axis:`axial`,terminals:{a:{x:.094433,y:.506775},b:{x:.904573,y:.506775}},sliderRail:{start:{x:.203777,y:.205962},end:{x:.795229,y:.205962}}},"switch-closed":{file:`studio-v2/switch-closed.png`,pixels:{w:573,h:304},solidBox:{left:.054526,top:.277207,width:.890949,height:.61807},axis:`axial`,terminals:{a:{x:.114504,y:.587269},b:{x:.883315,y:.587269}}},"switch-open":{file:`studio-v2/switch-open.png`,pixels:{w:573,h:304},solidBox:{left:.054526,top:.102669,width:.890949,height:.794661},axis:`axial`,terminals:{a:{x:.114504,y:.587269},b:{x:.883315,y:.587269}}},terminal:{file:`terminal.png`,pixels:{w:224,h:430},solidBox:{left:.1027,top:.0535,width:.7946,height:.893},axis:`base`},voltmeter:{file:`voltmeter.png`,pixels:{w:407,h:430},solidBox:{left:.0565,top:.0535,width:.8858,height:.893},axis:`base`},meter:{file:`studio-v2/meter.png`,pixels:{w:574,h:282},solidBox:{left:.055118,top:.112128,width:.889764,height:.775744},axis:`axial`,terminals:{a:{x:.138358,y:.494279},b:{x:.867267,y:.494279}},dial:{pivot:{x:.499438,y:.757437},radius:.256468}},"rheostat-knob":{file:`studio-v2/rheostat-knob.png`,pixels:{w:113,h:215},solidBox:{left:.107477,top:.054054,width:.78972,height:.889435},axis:`axial`},"battery-pack":{file:`studio-v3/battery-pack.png`,pixels:{w:418,h:138},solidBox:{left:.041,top:.1656,width:.9187,height:.6713},axis:`axial`,terminalOrder:`reversed`,terminals:{a:{x:.07084,y:.492351},b:{x:.928038,y:.493043}}},"cell-aa":{file:`studio-v3/cell-aa.png`,pixels:{w:405,h:84},solidBox:{left:.0264,top:.2733,width:.9481,height:.4571},axis:`axial`,terminalOrder:`reversed`,terminals:{a:{x:.038441,y:.517507},b:{x:.959392,y:.511692}}},"resistor-5":{file:`studio-v3/resistor-5.png`,pixels:{w:428,h:148},solidBox:{left:.0508,top:.1554,width:.8972,height:.6868},axis:`axial`,terminals:{a:{x:.079174,y:.48491},b:{x:.91618,y:.480619}}},"resistor-50":{file:`studio-v3/resistor-50.png`,pixels:{w:430,h:137},solidBox:{left:.0531,top:.1667,width:.893,height:.6668},axis:`axial`,terminals:{a:{x:.067406,y:.458485},b:{x:.926594,y:.462337}}},"rheostat-50":{file:`studio-v3/rheostat-50.png`,pixels:{w:411,h:135},solidBox:{left:.0342,top:.1696,width:.9343,height:.6605},axis:`axial`,terminals:{a:{x:.04335,y:.529383},b:{x:.956073,y:.548949}},sliderRail:{start:{x:.055961,y:.362963},end:{x:.944039,y:.362963}}},"supply-dc":{file:`studio-v3/supply-dc.png`,pixels:{w:429,h:179},solidBox:{left:.0528,top:.1265,width:.8951,height:.7494},axis:`axial`,terminalOrder:`reversed`,terminals:{a:{x:.097115,y:.496376},b:{x:.905684,y:.478298}}},"switch-button":{file:`studio-v3/switch-button.png`,pixels:{w:429,h:335},solidBox:{left:.0531,top:.0679,width:.8951,height:.8632},axis:`axial`}},un=e=>`./assets/parts3d/${e.file}`,dn=e=>e===`voltage_source`?[`positive`,`negative`]:[`a`,`b`],fn=[{id:`battery-1.5`,type:`voltage_source`,params:{voltage:1.5,internalResistance:0}},{id:`battery-6`,type:`voltage_source`,params:{voltage:6,internalResistance:0}},{id:`supply-12`,type:`voltage_source`,params:{voltage:12,internalResistance:0}},{id:`switch`,type:`switch`,params:{state:`closed`}},{id:`resistor-5`,type:`resistor`,params:{resistance:5}},{id:`resistor-10`,type:`resistor`,params:{resistance:10}},{id:`resistor-20`,type:`resistor`,params:{resistance:20}},{id:`resistor-50`,type:`resistor`,params:{resistance:50}},{id:`rheostat-20`,type:`variable_resistor`,params:{totalResistance:20,sliderPosition:.5}},{id:`rheostat-50`,type:`variable_resistor`,params:{totalResistance:50,sliderPosition:.5}},{id:`ammeter`,type:`ammeter`,params:{internalResistance:0}},{id:`voltmeter`,type:`voltmeter`,params:{}}];function pn(e,t){if(!Number.isFinite(t.clientX)||!Number.isFinite(t.clientY))return;let n=null;try{n=e.getScreenCTM?.()??null}catch{}if(n!==null){if(![n.a,n.b,n.c,n.d,n.e,n.f].every(Number.isFinite)||n.a*n.d-n.b*n.c===0)return;try{let e=n.inverse(),r=e.a*t.clientX+e.c*t.clientY+e.e,i=e.b*t.clientX+e.d*t.clientY+e.f;return Number.isFinite(r)&&Number.isFinite(i)?{x:r,y:i}:void 0}catch{return}}let r=e.viewBox?.baseVal,i=r===void 0?(e.getAttribute(`viewBox`)??``).trim().split(/[\s,]+/).map(Number):[r.x,r.y,r.width,r.height];if(i.length!==4||!i.every(Number.isFinite))return;let[a,o,s,c]=i,l=e.getBoundingClientRect();if(s<=0||c<=0||l.width<=0||l.height<=0||![l.left,l.top,l.width,l.height].every(Number.isFinite))return;let u=(e.getAttribute(`preserveAspectRatio`)??`xMidYMid meet`).trim().split(/\s+/).filter(e=>e!==`defer`),d=l.width/s,f=l.height/c;if(!Number.isFinite(d)||!Number.isFinite(f)||d<=0||f<=0)return;if(u[0]===`none`){let e=a+(t.clientX-l.left)/d,n=o+(t.clientY-l.top)/f;return Number.isFinite(e)&&Number.isFinite(n)?{x:e,y:n}:void 0}let p=/^(xMin|xMid|xMax)(YMin|YMid|YMax)$/.exec(u[0]??``),m=p?.[1]===`xMin`?0:p?.[1]===`xMax`?1:.5,h=p?.[2]===`YMin`?0:p?.[2]===`YMax`?1:.5,g=u[1]===`slice`?Math.max(d,f):Math.min(d,f),_=a+(t.clientX-l.left-(l.width-s*g)*m)/g,v=o+(t.clientY-l.top-(l.height-c*g)*h)/g;return Number.isFinite(_)&&Number.isFinite(v)?{x:_,y:v}:void 0}const mn=(e,t,n)=>{switch(e){case`voltage_source`:return t===void 0?`battery`:t<=2?`cell-aa`:t<=9?`battery-pack`:`supply-dc`;case`resistor`:return t===void 0?`resistor`:t<=5?`resistor-5`:t>=50?`resistor-50`:`resistor`;case`variable_resistor`:return t!==void 0&&t>=50?`rheostat-50`:`rheostat`;case`switch`:return n===!1?`switch-open`:`switch-closed`;case`ammeter`:case`voltmeter`:return`meter`}},hn=.75,gn=.28,_n=.05,vn=e=>Math.abs(e%180)===90,yn=(e,t)=>{let n=e.map(e=>({x:t.px(e),y:t.py(e)})),r=n[0],i=n[n.length-1];if(r===void 0||i===void 0)return``;let a=`M${r.x.toFixed(2)} ${r.y.toFixed(2)}`;for(let e=1;e<n.length-1;e+=1){let t=n[e-1],r=n[e],i=n[e+1];if(t===void 0||r===void 0||i===void 0)continue;let o=Math.hypot(r.x-t.x,r.y-t.y),s=Math.hypot(i.x-r.x,i.y-r.y),c=Math.min(7,o/2,s/2);if(c<.5||o===0||s===0){a+=` L${r.x.toFixed(2)} ${r.y.toFixed(2)}`;continue}let l={x:r.x-(r.x-t.x)/o*c,y:r.y-(r.y-t.y)/o*c},u={x:r.x+(i.x-r.x)/s*c,y:r.y+(i.y-r.y)/s*c};a+=` L${l.x.toFixed(2)} ${l.y.toFixed(2)} Q${r.x.toFixed(2)} ${r.y.toFixed(2)} ${u.x.toFixed(2)} ${u.y.toFixed(2)}`}return a+=` L${i.x.toFixed(2)} ${i.y.toFixed(2)}`,a},bn=(e,t,n)=>{let r=Re({x:e.at.x,y:e.at.y,rotation:e.rotation},t);return{x:n.px(r),y:n.py(r)}},xn=(e,t,n)=>{let r=bn(e,t,n),i=r.x-n.px(e.at),a=r.y-n.py(e.at),o=Math.abs(i)>Math.abs(a);return{ref:{componentId:e.id,terminalKey:t},point:r,box:{x:r.x-(o?i<0?28:0:28/2),y:r.y-(o?28/2:a<0?28:0),width:28,height:28}}};function Sn({component:e,cx:t,cy:n,scale:r}){let i=hn*r;switch(e.kind){case`resistor`:case`variable_resistor`:{let a=.5*r,o=.36*r,s=e.sliderPosition??.5;return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`line`,{className:P.circuitSymbol,x1:t-i,y1:n,x2:t-a,y2:n}),(0,D.jsx)(`line`,{className:P.circuitSymbol,x1:t+a,y1:n,x2:t+i,y2:n}),(0,D.jsx)(`rect`,{className:P.circuitSymbol,x:t-a,y:n-o/2,width:a*2,height:o}),e.kind===`variable_resistor`?(()=>{let i=t-a+s*a*2,c=n-o/2-.06*r,l=.11*r;return(0,D.jsxs)(`g`,{"data-testid":`slider-${e.id}`,children:[(0,D.jsx)(`line`,{className:P.circuitSymbol,x1:i,y1:n-.62*r,x2:i,y2:c-l}),(0,D.jsx)(`path`,{className:P.circuitSymbolFill,d:`M${i} ${c} L${i-l*.72} ${c-l} L${i+l*.72} ${c-l} Z`})]})})():null]})}case`voltage_source`:{let e=.12*r,a=.34*r,o=.15*r;return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`line`,{className:P.circuitSymbol,x1:t-i,y1:n,x2:t-e,y2:n}),(0,D.jsx)(`line`,{className:P.circuitSymbol,x1:t+e,y1:n,x2:t+i,y2:n}),(0,D.jsx)(`line`,{className:P.circuitSymbolThick,x1:t-e,y1:n-o,x2:t-e,y2:n+o}),(0,D.jsx)(`line`,{className:P.circuitSymbol,x1:t+e,y1:n-a,x2:t+e,y2:n+a})]})}case`switch`:{let a=.5*r,o=e.closed===!0,s=32*Math.PI/180,c=o?t+a:t-a+Math.cos(s)*a*1.9,l=o?n:n-Math.sin(s)*a*1.9;return(0,D.jsxs)(`g`,{"data-testid":`switch-${e.id}`,"data-closed":o?`true`:`false`,children:[(0,D.jsx)(`line`,{className:P.circuitSymbol,x1:t-i,y1:n,x2:t-a,y2:n}),(0,D.jsx)(`line`,{className:P.circuitSymbol,x1:t+a,y1:n,x2:t+i,y2:n}),(0,D.jsx)(`circle`,{className:P.circuitSymbolFill,cx:t-a,cy:n,r:Math.max(1.6,.09*r)}),(0,D.jsx)(`circle`,{className:P.circuitSymbolFill,cx:t+a,cy:n,r:Math.max(1.6,.09*r)}),(0,D.jsx)(`line`,{className:P.circuitSymbol,x1:t-a,y1:n,x2:c,y2:l})]})}case`ammeter`:case`voltmeter`:{let e=.42*r;return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`line`,{className:P.circuitSymbol,x1:t-i,y1:n,x2:t-e,y2:n}),(0,D.jsx)(`line`,{className:P.circuitSymbol,x1:t+e,y1:n,x2:t+i,y2:n}),(0,D.jsx)(`circle`,{className:N(P.circuitSymbol,P.circuitMeterFace),cx:t,cy:n,r:e})]})}}}function Cn({component:e,cx:t,cy:n,scale:r,offset:i}){let a=n+(i??.56*r),o=.38*r,s=e.currentDirection!==`reverse`,c=s?t-o:t+o,l=s?t+o:t-o,u=4.6,d=s?1:-1;return(0,D.jsxs)(`g`,{"data-testid":`current-${e.id}`,children:[(0,D.jsx)(`line`,{className:P.circuitCurrent,x1:c,y1:a,x2:l-d*u*.6,y2:a}),(0,D.jsx)(`path`,{className:P.circuitCurrentHead,d:`M${l} ${a} L${l-d*u} ${a-u*.44} L${l-d*u} ${a+u*.44} Z`})]})}const wn=e=>{let t=mn(e.kind,e.ratingValue,e.closed);return ln[t]===void 0?void 0:t},Tn=(e,t,n,r)=>{let i=2*hn*r,a=e.terminalOrder===`reversed`,o=e.terminals===void 0?void 0:a?{x:1-e.terminals.b.x,y:1-e.terminals.b.y}:e.terminals.a,s=i/(e.terminals===void 0?e.solidBox.width:e.terminals.b.x-e.terminals.a.x),c=s*(e.pixels.h/e.pixels.w),l=t-i/2-(o?.x??e.solidBox.left)*s,u=(a?1-e.solidBox.top-e.solidBox.height:e.solidBox.top)*c,d=e.solidBox.height*c,f=o===void 0?e.axis===`axial`?u+d/2:u+d:o.y*c;return{rotation:a?180:0,x:l,y:n-f,width:s,height:c,above:f,below:c-f,body:f-u-d/2,dial:u+d*.32}},En=(e,t,n,r)=>{let i=r*Math.PI/180,a=Math.cos(i),o=Math.sin(i),s=[],c=[];for(let[r,i]of[[e.x,e.y],[e.x+e.width,e.y],[e.x,e.y+e.height],[e.x+e.width,e.y+e.height]])s.push(t+(r-t)*a-(i-n)*o),c.push(n+(r-t)*o+(i-n)*a);return{left:Math.min(...s),right:Math.max(...s),top:Math.min(...c),bottom:Math.max(...c)}},Dn=(e,t,n,r)=>{let i=r=>{let i=1/0;for(let a of n){if(a.bottom<=t.top||a.top>=t.bottom)continue;let n=r>0?a.left-e:e-a.right;n>=0&&n<i&&(i=n)}return i},a=r===1?-1:1;return i(a)>i(r)?a:r},On=(e,t,n,r,i)=>{let a=e?.sliderRail;if(a===void 0||t===void 0)return{start:-.5,end:.5,y:.48,width:.34,height:.46};let o=t.height/i*.72,s=ln[`rheostat-knob`];return{start:(t.x+a.start.x*t.width-n)/i,end:(t.x+a.end.x*t.width-n)/i,y:(r-t.y-a.start.y*t.height)/i,width:o*(s===void 0?.5:s.pixels.w/s.pixels.h),height:o}};function kn({component:e,part:t,box:n,slider:r,reading:i,cx:a,cy:o,scale:s,onSpriteError:c}){let l=e.kind===`switch`,u=e.kind===`ammeter`||e.kind===`voltmeter`,[d,f]=(0,_.useState)(!1),p=t.dial===void 0?a:n.x+t.dial.pivot.x*n.width,m=(t.dial===void 0?o-n.dial:n.y+t.dial.pivot.y*n.height)-(t.dial===void 0?0:t.dial.radius*n.width)*.55;return(0,D.jsxs)(`g`,{"data-testid":l?`switch-${e.id}`:void 0,"data-closed":l?e.closed===!0?`true`:`false`:void 0,children:[(0,D.jsx)(`image`,{"data-testid":`sprite-${e.id}`,className:P.circuitPartSprite,href:un(t),x:n.x,y:n.y,width:n.width,height:n.height,transform:n.rotation===0?void 0:`rotate(${n.rotation} ${n.x+n.width/2} ${n.y+n.height/2})`,preserveAspectRatio:`none`,"aria-hidden":`true`,onError:()=>{c(e.id)}}),u?(0,D.jsx)(`text`,{"data-testid":i===void 0?void 0:`dial-reading-${e.id}`,className:i===void 0?P.circuitMeterLetter:P.circuitDialReading,x:p,y:m,textAnchor:`middle`,transform:`rotate(${e.rotation} ${p} ${m})`,children:i??(e.kind===`ammeter`?`A`:`V`)}):null,e.kind===`variable_resistor`?(()=>{let t=a+(r.start+(e.sliderPosition??.5)*(r.end-r.start))*s,n=o-r.y*s,i=ln[`rheostat-knob`],c=r.width*s,l=r.height*s;return(0,D.jsx)(`g`,{"data-testid":`slider-${e.id}`,children:i===void 0||d?(0,D.jsx)(`path`,{className:P.circuitSliderFallback,d:`M${t-c/2} ${n-l/2} h${c} v${l} h${-c} Z`}):(0,D.jsx)(`image`,{"data-testid":`slider-knob-${e.id}`,className:P.circuitPartSprite,href:un(i),x:t-c/2,y:n-l/2,width:c,height:l,preserveAspectRatio:`none`,"aria-hidden":`true`,onError:()=>{f(!0)}})})})():null]})}function An({view:e,projection:t,time:n,componentDrag:r,componentControl:i,componentWiring:a,componentSelection:o}){let[s,c]=(0,_.useState)(()=>new Set),l=e=>{c(t=>new Set(t).add(e))},u=(0,_.useRef)(),d=(0,_.useRef)(null),[f,p]=(0,_.useState)();(0,_.useEffect)(()=>{if(a===void 0){u.current=void 0,p(void 0);return}let e=e=>{let t=u.current;if(t!==void 0&&(t.pointerId!==e.pointerId||t.completedOnPress)||t===void 0&&a.pending===void 0)return;let n=t?.svg??d.current?.ownerSVGElement;if(n==null||t===void 0&&e.target instanceof Node&&!n.contains(e.target))return;let r=pn(n,e);r!==void 0&&p(r)},t=e=>{u.current?.pointerId===e.pointerId&&(u.current=void 0)},n=e=>{u.current?.pointerId===e.pointerId&&(u.current=void 0,p(void 0),a.cancel?.())};return window.addEventListener(`pointermove`,e),window.addEventListener(`pointerup`,t),window.addEventListener(`pointercancel`,n),()=>{window.removeEventListener(`pointermove`,e),window.removeEventListener(`pointerup`,t),window.removeEventListener(`pointercancel`,n)}},[a]);let m=(0,_.useRef)(null),[h,g]=(0,_.useState)(void 0),v=e=>{let n=e.currentTarget.ownerSVGElement;if(n===null)return;let r=pn(n,e);return r===void 0?void 0:{x:t.sx(r.x),y:t.sy(r.y)}},y=(e,t,n,r)=>{let i=r*Math.PI/180,a=e.x-t,o=e.y-n;return{x:a*Math.cos(i)+o*Math.sin(i),y:-a*Math.sin(i)+o*Math.cos(i)}},b=(e,t,n)=>{let r=(e-t-n.start)/(n.end-n.start);return Math.min(1,Math.max(0,r))},ee=(e,t)=>{t.key!==`Enter`&&t.key!==` `||(t.preventDefault(),i?.setSwitch(e.id,e.closed===!0?`open`:`closed`))},te=(e,t)=>{let n=e.sliderPosition??.5,r;t.key===`ArrowRight`||t.key===`ArrowUp`?r=n+_n:t.key===`ArrowLeft`||t.key===`ArrowDown`?r=n-_n:t.key===`Home`?r=0:t.key===`End`&&(r=1),r!==void 0&&(t.preventDefault(),i?.commitSlider(e.id,Math.min(1,Math.max(0,r))))},x=(e,t,n)=>{if(t.button!==0)return;let a=v(t);if(a===void 0)return;if(e.kind===`variable_resistor`&&i!==void 0){let r=y(a,e.at.x,e.at.y,e.rotation),i=n.start+(e.sliderPosition??.5)*(n.end-n.start);if(Math.abs(r.x-i)<=Math.max(gn,n.width/2)&&Math.abs(r.y-n.y)<=n.height/2+.06){typeof t.currentTarget.setPointerCapture==`function`&&t.currentTarget.setPointerCapture(t.pointerId),m.current={componentId:e.id,pointerId:t.pointerId,mode:`slider`,offsetX:0,offsetY:0,startX:e.at.x,startY:e.at.y,moved:!1,baseX:e.at.x,baseY:e.at.y,rotation:e.rotation,rail:n,grabOffset:r.x-i,position:e.sliderPosition??.5},t.stopPropagation();return}}let o=e.kind===`switch`&&i!==void 0?e.closed===!0?`open`:`closed`:void 0;r===void 0&&o===void 0||(typeof t.currentTarget.setPointerCapture==`function`&&t.currentTarget.setPointerCapture(t.pointerId),m.current={componentId:e.id,pointerId:t.pointerId,mode:`move`,offsetX:a.x-e.at.x,offsetY:a.y-e.at.y,startX:e.at.x,startY:e.at.y,moved:!1,baseX:e.at.x,baseY:e.at.y,rotation:e.rotation,rail:n,grabOffset:0,position:0,...o===void 0?{}:{toggleTo:o}},t.stopPropagation())},ne=e=>{let n=m.current;if(n===null||e.pointerId!==n.pointerId)return;let a=v(e);if(a===void 0)return;if(n.mode===`slider`){n.position=b(y(a,n.baseX,n.baseY,n.rotation).x,n.grabOffset,n.rail),n.moved=!0,i?.previewSlider(n.componentId,n.position);return}let o=a.x-n.offsetX,s=a.y-n.offsetY;if(!n.moved){if(Math.hypot(o-n.startX,s-n.startY)*t.scale<3)return;n.moved=!0,g(n.componentId)}r?.preview(n.componentId,{x:o,y:s})},re=e=>{let t=m.current;if(t===null||e.pointerId!==t.pointerId)return;m.current=null,g(void 0);let n=v(e);if(n===void 0){t.mode===`slider`?i?.cancelSlider():r?.cancel();return}if(t.mode===`slider`){t.moved&&i?.commitSlider(t.componentId,t.position);return}if(!t.moved){t.toggleTo!==void 0&&i?.setSwitch(t.componentId,t.toggleTo);return}r?.commit(t.componentId,{x:n.x-t.offsetX,y:n.y-t.offsetY})},S=e=>{let t=m.current;t===null||e.pointerId!==t.pointerId||(m.current=null,g(void 0),t.mode===`slider`?i?.cancelSlider():r?.cancel())},ie=e.circuitComponents??[],C=e.circuitWires??[],ae=e.circuitJunctions??[],oe=e.chargeFlows??[],w=t.scale,T=`circuit-lamp-glow-${t.uid}`,se=`circuit-lamp-bloom-${t.uid}`,E=`circuit-lamp-core-${t.uid}`,ce=e.visible.current===!0,le=e.visible.voltage===!0,ue=e.visible.power===!0,O=a?.pending??u.current?.from,k=O===void 0?void 0:ie.find(e=>e.id===O.componentId),A=O===void 0||k===void 0?void 0:bn(k,O.terminalKey,t),de=a===void 0?[]:ie.flatMap(e=>dn(e.kind).map(n=>xn(e,n,t))),fe=e=>{let t,n=1/0;for(let r of de){let i=r.box;if(e.x<i.x||e.x>i.x+i.width||e.y<i.y||e.y>i.y+i.height)continue;let a=Math.hypot(e.x-r.point.x,e.y-r.point.y);a<n&&(t=r,n=a)}return t?.ref},pe=(e,t,n=!1)=>{if(t.stopPropagation(),a===void 0||t.button!==0||u.current!==void 0)return;let r=t.currentTarget.ownerSVGElement;if(r===null)return;let i=pn(r,t),o=n?i===void 0?void 0:fe(i):e;o!==void 0&&(t.pointerType!==`mouse`&&typeof t.currentTarget.setPointerCapture==`function`&&t.currentTarget.setPointerCapture(t.pointerId),u.current={pointerId:t.pointerId,from:o,svg:r,completedOnPress:a.pending!==void 0},p(a.pending===void 0?i:void 0),a.start(o))},me=e=>{let t=u.current;if(a===void 0||t===void 0||t.pointerId!==e.pointerId||(e.stopPropagation(),u.current=void 0,t.completedOnPress))return;let n=(t.svg.ownerDocument.elementFromPoint?.(e.clientX,e.clientY)??e.currentTarget).closest(`[data-terminal-component][data-terminal-key]`);if(!(n instanceof SVGElement)||n.ownerSVGElement!==t.svg)return;let r;if(n.hasAttribute(`data-terminal-hit`)){let n=pn(t.svg,e);r=n===void 0?void 0:fe(n)}else{let e=ie.find(e=>e.id===n.getAttribute(`data-terminal-component`)),t=e===void 0?void 0:dn(e.kind).find(e=>e===n.getAttribute(`data-terminal-key`));e!==void 0&&t!==void 0&&(r={componentId:e.id,terminalKey:t})}r===void 0||r.componentId===t.from.componentId&&r.terminalKey===t.from.terminalKey||(p(void 0),(a.complete??a.start)(r))},he=ie.flatMap(e=>{let n=wn(e);if(n===void 0||s.has(e.id))return[];let r=ln[n];if(r===void 0)return[];let i=t.px(e.at),a=t.py(e.at);return[{id:e.id,rect:En(Tn(r,i,a,w),i,a,-e.rotation)}]});return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsxs)(`defs`,{children:[(0,D.jsxs)(`radialGradient`,{id:T,cx:`50%`,cy:`50%`,r:`50%`,children:[(0,D.jsx)(`stop`,{offset:`0%`,stopColor:`#ffe6a8`,stopOpacity:`0.95`}),(0,D.jsx)(`stop`,{offset:`55%`,stopColor:`#f5a524`,stopOpacity:`0.55`}),(0,D.jsx)(`stop`,{offset:`100%`,stopColor:`#f5a524`,stopOpacity:`0`})]}),(0,D.jsxs)(`radialGradient`,{id:se,cx:`50%`,cy:`50%`,r:`50%`,children:[(0,D.jsx)(`stop`,{offset:`0%`,stopColor:`#ff9d2e`,stopOpacity:`0.42`}),(0,D.jsx)(`stop`,{offset:`60%`,stopColor:`#ff9d2e`,stopOpacity:`0.14`}),(0,D.jsx)(`stop`,{offset:`100%`,stopColor:`#ff9d2e`,stopOpacity:`0`})]}),(0,D.jsxs)(`radialGradient`,{id:E,cx:`50%`,cy:`50%`,r:`50%`,children:[(0,D.jsx)(`stop`,{offset:`0%`,stopColor:`#fff8e6`,stopOpacity:`1`}),(0,D.jsx)(`stop`,{offset:`70%`,stopColor:`#fff8e6`,stopOpacity:`0.5`}),(0,D.jsx)(`stop`,{offset:`100%`,stopColor:`#fff8e6`,stopOpacity:`0`})]})]}),C.map(e=>(0,D.jsx)(`path`,{className:P.circuitWire,d:yn(e.points,t)},e.id)),ce?oe.map(e=>{let r=Math.min(90,Math.max(8,Math.abs(e.current)*110)),i=e.current===0?0:-Math.sign(e.current)*r*(n??0);return(0,D.jsx)(`path`,{className:P.circuitChargeFlow,"data-charge-flow":e.id,"data-current-sign":e.current>0?`forward`:e.current<0?`reverse`:`idle`,d:yn(e.path,t),strokeDasharray:`0.1 14`,strokeDashoffset:i,"aria-hidden":`true`},e.id)}):null,ae.map(e=>(0,D.jsx)(`circle`,{className:P.circuitJunction,cx:t.px(e.at),cy:t.py(e.at),r:2.8},e.id)),(0,D.jsx)(`g`,{ref:d,pointerEvents:`none`,"aria-hidden":`true`,children:a!==void 0&&A!==void 0&&f!==void 0?(0,D.jsx)(`path`,{"data-circuit-wire-preview":`true`,d:`M${A.x.toFixed(2)} ${A.y.toFixed(2)} L${f.x.toFixed(2)} ${f.y.toFixed(2)}`,fill:`none`,stroke:`var(--physics-body-live)`,strokeWidth:2,strokeDasharray:`5 4`,vectorEffect:`non-scaling-stroke`}):null}),a===void 0?null:(0,D.jsx)(`g`,{"data-circuit-terminal-hit-layer":`true`,"aria-hidden":`true`,children:de.map(e=>(0,D.jsx)(`rect`,{className:P.circuitTerminalHit,"data-terminal-hit":`${e.ref.componentId}.${e.ref.terminalKey}`,"data-terminal-component":e.ref.componentId,"data-terminal-key":e.ref.terminalKey,x:e.box.x,y:e.box.y,width:e.box.width,height:e.box.height,onPointerDown:t=>{pe(e.ref,t,!0)},onPointerUp:me},`${e.ref.componentId}.${e.ref.terminalKey}`))}),ie.map(e=>{let n=t.px(e.at),c=t.py(e.at),d=-e.rotation,f=vn(e.rotation),m=o?.selected===e.id,g=o===void 0||m,_=t.highlighted(e.id)||m,v=wn(e),y=v===void 0||s.has(e.id)?void 0:ln[v],b=y===void 0?void 0:Tn(y,n,c,w),ie=y!==void 0&&b!==void 0?{part:y,box:b}:void 0,C=On(y,b,n,c,w),ae=e.sliderPosition??.5,oe=n+(C.start+ae*(C.end-C.start))*w,O=c-C.y*w,k=Math.max(gn*2,C.width)*w,A=(C.height+.12)*w,de=e.kind===`ammeter`?ce?e.reading:void 0:e.kind===`voltmeter`&&le?e.reading:void 0,fe=[...e.value===void 0?[]:[{text:e.value,className:P.circuitAnnotation??``}],...de===void 0||ie!==void 0?[]:[{text:de,className:P.circuitReading??``}],...g&&ce&&e.currentText!==void 0?[{text:e.currentText,className:P.circuitCurrentText??``}]:[],...g&&le&&e.voltageText!==void 0?[{text:e.voltageText,className:P.circuitAnnotation??``}]:[],...g&&ue&&e.powerText!==void 0?[{text:e.powerText,className:P.circuitAnnotation??``}]:[]],ge=(e.rotation%360+360)%360,_e=Math.max(b?.above??0,e.kind===`variable_resistor`?(C.y+C.height/2)*w:0),j=Math.max(b?.below??0,e.kind===`variable_resistor`?(-C.y+C.height/2)*w:0),M=ge===90?_e:j,ve=ge===90?j:_e,ye={top:c-(fe.length-1)*13/2-9,bottom:c+(fe.length-1)*13/2+13},be=f?Dn(n,ye,he.filter(t=>t.id!==e.id).map(e=>e.rect),1):1,xe=fe.length>0&&f?be:-1,Se=be===1?ve:M,Ce=xe===1?ve:M,we=f?{x:n+xe*(Math.max(.62*w,Ce)+4),y:fe.length>0?c-(fe.length-1)*13/2-12:c+4}:{x:n,y:c-Math.max(.5*w,_e)-8},Te=f?{x:n+be*(Math.max(.62*w,Se)+4),y:c-(fe.length-1)*13/2+4}:{x:n,y:c+Math.max(.55*w,j)+14},Ee=e.glow??0,De=c-(b?.body??0);return(0,D.jsxs)(`g`,{className:N(_?P.highlightGroup:void 0,r===void 0?void 0:P.circuitDraggable,h===e.id?P.circuitDragging:void 0),"data-component-id":e.id,"data-component-selected":o===void 0?void 0:m?`true`:`false`,tabIndex:o===void 0?void 0:0,role:o===void 0?void 0:`button`,"aria-label":o===void 0?void 0:e.label,"aria-pressed":o===void 0?void 0:m,"aria-keyshortcuts":o?.edit===void 0?void 0:`ArrowUp ArrowDown ArrowLeft ArrowRight R Delete Backspace Control+D Meta+D`,onPointerDown:t=>{t.button===0&&o?.select(e.id),x(e,t,C)},onClick:t=>{o===void 0||t.defaultPrevented||(t.stopPropagation(),o.select(e.id))},onKeyDown:t=>{if(o===void 0||t.target!==t.currentTarget||t.defaultPrevented||t.nativeEvent.isComposing||t.altKey)return;let n=t.ctrlKey||t.metaKey,i=n&&!t.shiftKey&&t.key.toLowerCase()===`d`&&o.edit!==void 0;if(n&&!i)return;let a=t.shiftKey?2:.5,s=r===void 0?void 0:t.key===`ArrowRight`?{x:a,y:0}:t.key===`ArrowLeft`?{x:-a,y:0}:t.key===`ArrowUp`?{x:0,y:a}:t.key===`ArrowDown`?{x:0,y:-a}:void 0,c=i?`duplicate`:t.key.toLowerCase()===`r`?`rotate`:t.key===`Delete`||t.key===`Backspace`?`remove`:void 0;s===void 0&&(c===void 0||o.edit===void 0)&&t.key!==`Enter`&&t.key!==` `||(t.preventDefault(),t.stopPropagation(),s===void 0?c===void 0?o.select(e.id):!t.repeat&&(c!==`duplicate`||e.kind!==`voltage_source`)&&o.edit?.(e.id,c):r?.nudge===void 0?(o.select(e.id),r?.commit(e.id,{x:e.at.x+s.x,y:e.at.y+s.y})):r.nudge(e.id,s))},onPointerMove:ne,onPointerUp:re,onPointerCancel:S,onLostPointerCapture:S,children:[Ee>0?(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`circle`,{className:P.circuitLampBloom,cx:n,cy:De,r:(1.5+2.6*Ee)*w,fill:`url(#${se})`,opacity:Math.min(1,.9*Ee)}),(0,D.jsx)(`circle`,{"data-testid":`glow-${e.id}`,className:P.circuitLampGlow,cx:n,cy:De,r:(.55+.75*Ee)*w,fill:`url(#${T})`,opacity:Math.min(1,.85*Ee)}),(0,D.jsx)(`circle`,{className:P.circuitLampCore,cx:n,cy:De,r:(.32+.3*Ee)*w,fill:`url(#${E})`,opacity:Math.min(1,1.05*Ee)})]}):null,(0,D.jsxs)(`g`,{transform:`rotate(${d} ${n} ${c})`,children:[r===void 0&&i===void 0?null:(0,D.jsx)(`rect`,{className:P.circuitHitArea,x:b===void 0?n-hn*w:b.x,y:b===void 0?c-.45*w:b.y,width:b===void 0?2*hn*w:b.width,height:b===void 0?.9*w:b.height}),i===void 0?null:e.kind===`switch`?(0,D.jsx)(`rect`,{"data-control":`switch-${e.id}`,className:P.circuitControl,x:b===void 0?n-hn*w:b.x,y:b===void 0?c-.45*w:b.y,width:b===void 0?2*hn*w:b.width,height:b===void 0?.9*w:b.height,tabIndex:0,role:`switch`,"aria-checked":e.closed===!0,"aria-label":e.label,onKeyDown:t=>{ee(e,t)}}):e.kind===`variable_resistor`?(0,D.jsx)(`rect`,{"data-control":`slider-${e.id}`,className:P.circuitControl,x:oe-k/2,y:O-A/2,width:k,height:A,tabIndex:0,role:`slider`,"aria-orientation":f?`vertical`:`horizontal`,"aria-valuemin":0,"aria-valuemax":100,"aria-valuenow":Math.round(ae*100),"aria-label":e.label,onKeyDown:t=>{te(e,t)}}):null,ie===void 0?(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(Sn,{component:e,cx:n,cy:c,scale:w}),e.glow===void 0?null:(0,D.jsx)(`path`,{"data-testid":`filament-${e.id}`,className:P.circuitLampFilament,d:`M${n-.62*w} ${c} L${n-.42*w} ${c-.2*w} L${n-.2*w} ${c+.2*w} L${n} ${c-.14*w} L${n+.2*w} ${c+.2*w} L${n+.42*w} ${c-.2*w} L${n+.62*w} ${c}`,opacity:Math.min(1,.25+.75*Ee)})]}):(0,D.jsx)(kn,{component:e,part:ie.part,box:ie.box,slider:C,reading:de,cx:n,cy:c,scale:w,onSpriteError:l}),g&&ce&&e.currentText!==void 0?(0,D.jsx)(Cn,{component:e,cx:n,cy:c,scale:w,offset:Math.max(.56*w,j+6)}):null]}),ie===void 0&&(e.kind===`ammeter`||e.kind===`voltmeter`)?(0,D.jsx)(`text`,{className:P.circuitMeterLetter,x:n,y:c,textAnchor:`middle`,children:e.kind===`ammeter`?`A`:`V`}):null,a===void 0?null:(0,D.jsx)(`g`,{className:P.circuitTerminals,children:dn(e.kind).map(n=>{let r=bn(e,n,t),i=a.pending?.componentId===e.id&&a.pending.terminalKey===n;return(0,D.jsx)(`circle`,{className:N(P.circuitTerminal,i?P.circuitTerminalPending:void 0),"data-terminal":`${e.id}.${n}`,"data-terminal-component":e.id,"data-terminal-key":n,cx:r.x,cy:r.y,r:.3*w,tabIndex:0,role:`button`,"aria-label":`${e.label} ${n}`,onPointerDown:t=>{pe({componentId:e.id,terminalKey:n},t)},onPointerUp:me,onKeyDown:t=>{if(!(t.defaultPrevented||t.nativeEvent.isComposing)){if(t.key===`Escape`&&a.pending!==void 0&&a.cancel!==void 0){t.preventDefault(),t.stopPropagation(),u.current=void 0,p(void 0),a.cancel();return}t.key!==`Enter`&&t.key!==` `||(t.preventDefault(),a.start({componentId:e.id,terminalKey:n}))}}},n)})}),(0,D.jsx)(`text`,{className:P.circuitName,x:we.x,y:we.y,textAnchor:f?xe===1?`start`:`end`:`middle`,children:e.label}),fe.map((t,n)=>(0,D.jsx)(`text`,{className:t.className,x:Te.x,y:Te.y+n*13,textAnchor:f?be===1?`start`:`end`:`middle`,children:t.text},`${e.id}-row-${n}`))]},e.id)})]})}function jn({view:e,projection:t}){let n=e.pressureRig,r=e.visible.pressure===!0,i=e.visible.pressureComparison===!0;if(n===`solid`&&e.pressureSolid!==void 0){let n=e.pressureSolid,i=e.ground;return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`defs`,{children:(0,D.jsx)(A,{uid:t.uid})}),i===void 0?null:(0,D.jsx)(de,{ground:i,projection:t}),n.faces.map(e=>{let r=t.px(e.at),i=t.py(e.at),a=e.halfWidth*t.scale,o=t.py({x:e.at.x,y:e.at.y+n.halfHeight});return(0,D.jsxs)(`g`,{className:t.highlighted(e.id)?P.highlightGroup:void 0,children:[(0,D.jsx)(`rect`,{className:P.pressurePlate,x:r-a,y:i,width:a*2,height:n.plateDepth*t.scale,rx:1}),(0,D.jsx)(`rect`,{className:P.pressureBlock,x:r-a,y:o,width:a*2,height:i-o,rx:2}),(0,D.jsx)(`text`,{className:P.pressureReading,x:r,y:(o+i)/2+4,textAnchor:`middle`,children:e.pressureText})]},e.id)}),(0,D.jsx)(j,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t}),r?(0,D.jsx)(M,{x:t.px(n.faces[0]?.at??n.at),y:t.py({x:0,y:2*n.halfHeight+7.2}),anchor:`middle`,symbol:n.forceText,className:P.pressureReading}):null,e.dimensions.map(e=>(0,D.jsx)(ye,{dimension:e,projection:t},e.id))]})}if(n===`liquid`){let n=[e.pressureLiquid,e.pressureComparisonLiquid].filter(e=>e!==void 0),r=e.pressureProbes??[];return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`defs`,{children:(0,D.jsx)(A,{uid:t.uid})}),n.map(e=>{let n=t.px({x:e.left,y:0}),r=t.px({x:e.right,y:0}),i=t.py({x:0,y:e.surface}),a=t.py({x:0,y:e.floor}),o=i-e.rim*t.scale;return(0,D.jsxs)(`g`,{className:t.highlighted(e.id)?P.highlightGroup:void 0,children:[(0,D.jsx)(`rect`,{className:P.pressureLiquidBody,x:n,y:i,width:r-n,height:a-i}),(0,D.jsx)(`path`,{className:P.pressureVesselWall,d:`M${n} ${o} V${a} H${r} V${o}`}),(0,D.jsx)(M,{x:(n+r)/2,y:a+16,anchor:`middle`,symbol:e.densityText,className:P.pressureVesselLabel})]},e.id)}),r.map(e=>{let n=t.px(e.at),r=t.py(e.at),i=.85*t.scale;return(0,D.jsxs)(`g`,{"data-testid":`pressure-probe-${e.primary?`primary`:`comparison`}`,children:[(0,D.jsx)(`circle`,{className:P.pressureProbeBody,cx:n,cy:r,r:i}),(0,D.jsx)(`circle`,{className:P.pressureProbeDot,cx:n,cy:r,r:i*.34}),(0,D.jsx)(M,{x:n+i+5,y:r+4,anchor:`start`,symbol:e.readingText,className:P.pressureReading})]},e.id)}),e.guides.filter(t=>e.visible[t.observable]===!0).map(e=>(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`line`,{className:P.fluidSurfaceLine,x1:t.px(e.from),y1:t.py(e.from),x2:t.px(e.to),y2:t.py(e.to)}),e.label===void 0?null:(0,D.jsx)(M,{x:(t.px(e.from)+t.px(e.to))/2+6,y:(t.py(e.from)+t.py(e.to))/2-6,anchor:`start`,symbol:e.label,className:P.pressureGuideLabel})]},e.id)),e.dimensions.map(e=>(0,D.jsx)(ye,{dimension:e,projection:t},e.id))]})}if(n===`atmospheric`&&e.pressureBarometer!==void 0){let n=e.pressureBarometer,r=e.pressureHemispheres,a=t.px(n.at),o=n.halfWidth*t.scale,s=t.py(n.at),c=t.py({x:n.at.x,y:n.columnTop}),l=t.py({x:n.at.x,y:n.tubeTop}),u=n.dishHalfWidth*t.scale,d=s+n.dishDepth*t.scale;return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`defs`,{children:(0,D.jsx)(A,{uid:t.uid})}),(0,D.jsx)(`rect`,{className:P.pressureMercuryPool,x:a-u,y:s,width:u*2,height:d-s}),(0,D.jsx)(`path`,{className:P.pressureDish,d:`M${a-u} ${s-3*t.scale} V${d} H${a+u} V${s-3*t.scale}`}),(0,D.jsx)(`path`,{className:P.pressureTube,d:`M${a-o} ${d} V${l+o} A${o} ${o} 0 0 1 ${a+o} ${l+o} V${d}`}),(0,D.jsx)(`rect`,{className:P.pressureMercury,x:a-o,y:c,width:o*2,height:s-c}),(0,D.jsx)(`text`,{className:P.pressureVacuum,x:a,y:c-8,textAnchor:`middle`,children:`真空`}),(0,D.jsx)(M,{x:a,y:s+22,anchor:`middle`,symbol:n.pressureText,className:P.pressureReading}),r===void 0?null:(()=>{let e=t.px(r.at),n=t.py(r.at),a=r.radius*t.scale;return(0,D.jsxs)(`g`,{"data-testid":`magdeburg-hemispheres`,children:[(0,D.jsx)(`circle`,{className:P.pressureHemisphere,cx:e,cy:n,r:a}),(0,D.jsx)(`line`,{className:P.pressureHemisphereJoint,x1:e,y1:n-a,x2:e,y2:n+a}),i?(0,D.jsx)(M,{x:e,y:n+a+20,anchor:`middle`,symbol:r.forceText,className:P.pressureReading}):null]})})(),(0,D.jsx)(j,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t}),e.guides.filter(t=>e.visible[t.observable]===!0).map(e=>(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`line`,{className:P.pressureGuide,x1:t.px(e.from),y1:t.py(e.from),x2:t.px(e.to),y2:t.py(e.to)}),e.label===void 0?null:(0,D.jsx)(M,{x:(t.px(e.from)+t.px(e.to))/2+6,y:(t.py(e.from)+t.py(e.to))/2-6,anchor:`start`,symbol:e.label,className:P.pressureGuideLabel})]},e.id)),e.dimensions.map(e=>(0,D.jsx)(ye,{dimension:e,projection:t},e.id))]})}return null}const Mn=({x:e,y:t,size:n,reading:r,dialFraction:i,highlighted:a})=>{let o=(140-(i??0)*100)*Math.PI/180,s=t-n*.34,c={x:e+n*.3*Math.cos(o),y:s+n*.3*Math.sin(o)};return(0,D.jsxs)(`g`,{className:a?P.highlightGroup:void 0,children:[(0,D.jsx)(`circle`,{className:P.fluidScaleRing,cx:e,cy:t-n*.86,r:n*.24}),(0,D.jsx)(`rect`,{className:P.fluidScaleBody,x:e-n*.9,y:t-n*.62,width:n*1.8,height:n*1.24,rx:n*.26}),(0,D.jsx)(`rect`,{className:P.fluidScaleDial,x:e-n*.68,y:t-n*.4,width:n*1.36,height:n*.8,rx:n*.14}),i===void 0?null:(0,D.jsxs)(`g`,{"data-testid":`scale-needle`,children:[(0,D.jsx)(`line`,{className:P.fluidScaleNeedle,x1:e,y1:s,x2:c.x,y2:c.y}),(0,D.jsx)(`circle`,{className:P.fluidScalePivot,cx:e,cy:s,r:n*.045})]}),(0,D.jsx)(`text`,{className:P.fluidScaleReading,x:e,y:t+n*.16,textAnchor:`middle`,children:r}),(0,D.jsx)(`path`,{className:P.fluidScaleRing,d:`M${e} ${t+n*.62} v${n*.1} a${n*.16} ${n*.16} 0 1 0 ${n*.02} ${n*.24}`})]})};function Nn(e){return e.view.pressureRig===void 0?(0,D.jsx)(Pn,{...e}):(0,D.jsx)(jn,{view:e.view,projection:e.projection})}function Pn({view:e,projection:t,componentDrag:n}){let r=e.visible.forces===!0,i=e.visible.displaced===!0,a=e.fluidLiquid,o=e.fluidBlock,s=e.fluidScale,c=(0,_.useRef)(null),[l,u]=(0,_.useState)(!1),d=e=>{let n=e.currentTarget.ownerSVGElement;if(n===null)return;let r=pn(n,e);return r===void 0?void 0:{x:t.sx(r.x),y:t.sy(r.y)}},f=e=>{if(n===void 0||o===void 0)return;let t=d(e);t!==void 0&&(typeof e.currentTarget.setPointerCapture==`function`&&e.currentTarget.setPointerCapture(e.pointerId),c.current={pointerId:e.pointerId,grabY:t.y-o.at.y,moved:!1},e.stopPropagation())},p=e=>{let r=c.current;if(r===null||e.pointerId!==r.pointerId||o===void 0)return;let i=d(e);if(i===void 0)return;let a=i.y-r.grabY;if(!r.moved){if(Math.abs(a-o.at.y)*t.scale<3)return;r.moved=!0,u(!0)}n?.preview(o.id,{x:o.at.x,y:a})},m=e=>{let t=c.current;if(t===null||e.pointerId!==t.pointerId||(c.current=null,u(!1),!t.moved))return;if(o===void 0){n?.cancel();return}let r=d(e);if(r===void 0){n?.cancel();return}n?.commit(o.id,{x:o.at.x,y:r.y-t.grabY})},h=e=>{let t=c.current;t===null||e.pointerId!==t.pointerId||(c.current=null,u(!1),n?.cancel())};return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`defs`,{children:(0,D.jsx)(A,{uid:t.uid})}),a===void 0?null:(()=>{let e=t.px({x:a.left,y:0}),n=t.px({x:a.right,y:0}),r=t.py({x:0,y:a.surface}),i=t.py({x:0,y:a.floor}),o=t.py({x:0,y:a.surface+(a.surface-a.floor)*.18});return(0,D.jsxs)(`g`,{className:t.highlighted(a.id)?P.highlightGroup:void 0,children:[(0,D.jsx)(`defs`,{children:(0,D.jsxs)(`linearGradient`,{id:`fluid-liquid-${t.uid}`,x1:`0`,y1:`0`,x2:`0`,y2:`1`,children:[(0,D.jsx)(`stop`,{offset:`0`,stopColor:`#dcedf9`}),(0,D.jsx)(`stop`,{offset:`1`,stopColor:`#a8cbe8`})]})}),(0,D.jsx)(`rect`,{className:P.fluidLiquidBody,x:e,y:r,width:n-e,height:i-r,style:{fill:`url(#fluid-liquid-${t.uid})`}}),(0,D.jsx)(`line`,{className:P.fluidSurface,x1:e,y1:r,x2:n,y2:r}),(0,D.jsx)(`path`,{className:P.fluidTankWall,d:[`M${e-4} ${o-3}`,`L${e} ${o}`,`V${i-6}`,`Q${e} ${i} ${e+6} ${i}`,`H${n-6}`,`Q${n} ${i} ${n} ${i-6}`,`V${o}`,`L${n+4} ${o-3}`].join(` `)}),a.label===void 0?null:(0,D.jsx)(`text`,{className:P.annotation,x:t.px({x:a.right,y:0})-8,y:t.py({x:0,y:a.floor})-8,textAnchor:`end`,children:a.label})]})})(),i?e.guides.map(e=>(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`line`,{className:P.fluidSurfaceLine,x1:t.px(e.from),y1:t.py(e.from),x2:t.px(e.to),y2:t.py(e.to)}),e.label===void 0?null:(0,D.jsx)(`text`,{className:P.fluidSurfaceLabel,x:t.px(e.to)-6,y:t.py(e.to)-6,textAnchor:`end`,children:e.label})]},e.id)):null,i?e.dimensions.map(e=>(0,D.jsx)(ye,{dimension:e,projection:t},e.id)):null,s===void 0||o===void 0?null:(()=>{let e=Math.max(16,Math.min(38,o.halfHeight*t.scale*.9));return(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`line`,{className:P.fluidWire,x1:t.px(s.at),y1:t.py(s.at)+e*.72,x2:t.px(o.at),y2:t.py({x:o.at.x,y:o.at.y+o.halfHeight})}),(0,D.jsx)(Mn,{x:t.px(s.at),y:t.py(s.at),size:e,reading:s.reading,dialFraction:s.dialFraction,highlighted:t.highlighted(s.id)}),s.label===void 0?null:(0,D.jsx)(`text`,{className:P.annotation,x:t.px(s.at),y:t.py(s.at)-Math.max(16,o.halfHeight*t.scale)-6,textAnchor:`middle`,children:s.label})]})})(),o===void 0?null:(0,D.jsxs)(`g`,{className:N(t.highlighted(o.id)?P.highlightGroup:void 0,n===void 0?void 0:P.fluidDraggable,l?P.fluidDragging:void 0),onPointerDown:n===void 0?void 0:f,onPointerMove:n===void 0?void 0:p,onPointerUp:n===void 0?void 0:m,onPointerCancel:n===void 0?void 0:h,onLostPointerCapture:n===void 0?void 0:h,children:[n===void 0?null:(0,D.jsx)(`title`,{children:`拖动物块改变浸入深度，读数实时跟随`}),(0,D.jsx)(`rect`,{className:N(P.fluidBlockBody,o.phase===`floating`&&P.fluidBlockFloating),x:t.px({x:o.at.x-o.halfWidth,y:0}),y:t.py({x:0,y:o.at.y+o.halfHeight}),width:o.halfWidth*2*t.scale,height:o.halfHeight*2*t.scale}),o.submergedTop<=o.at.y-o.halfHeight?null:(0,D.jsx)(`rect`,{className:P.fluidBlockSubmerged,x:t.px({x:o.at.x-o.halfWidth,y:0}),y:t.py({x:0,y:o.submergedTop}),width:o.halfWidth*2*t.scale,height:t.py({x:0,y:o.at.y-o.halfHeight})-t.py({x:0,y:o.submergedTop})}),o.label===void 0?null:(0,D.jsx)(`text`,{className:P.annotation,x:t.px({x:o.at.x-o.halfWidth,y:0})-8,y:t.py(o.at),textAnchor:`end`,children:o.label})]}),r?(0,D.jsx)(j,{vectors:e.vectors,projection:t}):null]})}const Fn=[Math.PI/3,Math.PI,5*Math.PI/3],In=(e,t)=>t===1?{x:-Math.sin(e),y:-Math.cos(e)}:{x:Math.sin(e),y:Math.cos(e)},Ln=(e,t)=>{let n=e.slice(1).flatMap((t,n)=>{let r=e[n];return r===void 0?[]:[{from:r,to:t,length:Math.hypot(t.x-r.x,t.y-r.y)}]}),r=n.reduce((e,t)=>e+t.length,0);if(r===0)return;let i=Math.min(Math.max(t,0),1)*r;for(let e of n){if(i>e.length){i-=e.length;continue}let t=e.length===0?0:i/e.length;return{at:{x:e.from.x+(e.to.x-e.from.x)*t,y:e.from.y+(e.to.y-e.from.y)*t},direction:{x:(e.to.x-e.from.x)/e.length,y:(e.to.y-e.from.y)/e.length}}}},Rn=(e,t,n)=>{let r={x:-t.y,y:t.x},i={x:e.x+t.x*n,y:e.y+t.y*n},a={x:e.x-t.x*n*.5,y:e.y-t.y*n*.5},o=n*.52;return`M${i.x} ${i.y} L${a.x+r.x*o} ${a.y+r.y*o} L${a.x-r.x*o} ${a.y-r.y*o} Z`},zn=(e,t,n,r,i)=>{let a=e+n*Math.cos(r),o=t-n*Math.sin(r),s=In(r,i),c={x:-s.y,y:s.x},l={x:a+s.x*7,y:o+s.y*7},u={x:a-s.x*1.4,y:o-s.y*1.4},d=7*.42;return`M${l.x} ${l.y} L${u.x+c.x*d} ${u.y+c.y*d} L${u.x-c.x*d} ${u.y-c.y*d} Z`};function Bn({view:e,projection:t}){let n=e.currentRig;if(n===`straight_wire`&&e.currentWire!==void 0){let n=e.currentWire,r=e.currentFieldCircles??[],i=e.currentProbes??[],a=t.px(n.at),o=t.py(n.at),s=1.5*t.scale,c=s*.62;return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`defs`,{children:(0,D.jsx)(A,{uid:t.uid})}),r.map(e=>{let n=e.radius*t.scale;return(0,D.jsxs)(`g`,{"data-testid":`current-ring-${e.id}`,children:[(0,D.jsx)(`circle`,{className:e.probe?P.currentProbeRing:P.currentFieldRing,cx:a,cy:o,r:n}),Fn.map(t=>(0,D.jsx)(`path`,{className:P.currentFieldArrow,d:zn(a,o,n,t,e.circulation)},t))]},e.id)}),(0,D.jsxs)(`g`,{"data-testid":`current-conductor`,children:[(0,D.jsx)(`circle`,{className:P.currentWireSymbol,cx:a,cy:o,r:s}),n.direction===1?(0,D.jsx)(`circle`,{className:P.currentWireDot,cx:a,cy:o,r:s*.42}):(0,D.jsx)(`path`,{className:P.currentWireCross,d:`M${a-c} ${o-c} L${a+c} ${o+c} M${a+c} ${o-c} L${a-c} ${o+c}`})]}),(0,D.jsx)(M,{x:a,y:o-r.reduce((e,t)=>Math.max(e,t.radius),0)*t.scale-12,anchor:`middle`,symbol:n.currentText,className:P.currentReading}),i.map(e=>{let i=t.px(e.at),s=t.py(e.at),c=e.primary?`primary`:`comparison`,l=e.at.x-n.at.x,u=e.at.y-n.at.y,d=Math.hypot(l,u)||1,f=d*t.scale,p=(f+(r.map(e=>e.radius*t.scale).filter(e=>e>f+1).sort((e,t)=>e-t)[0]??f*1.35))/2,m=a+l/d*p,h=o-u/d*p;return(0,D.jsxs)(`g`,{"data-testid":`current-probe-${c}`,children:[(0,D.jsx)(`circle`,{className:P.currentProbeBody,"data-testid":`current-probe-dot-${c}`,cx:i,cy:s,r:4}),(0,D.jsx)(`circle`,{className:P.currentProbeDot,cx:i,cy:s,r:1.6}),(0,D.jsx)(M,{x:m,y:h+4,anchor:`middle`,symbol:e.readingText,className:P.currentReading})]},e.id)}),(0,D.jsx)(j,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t}),e.dimensions.map(e=>(0,D.jsx)(ye,{dimension:e,projection:t},e.id))]})}if((n===`solenoid`||n===`electromagnet`)&&e.currentCoil!==void 0){let n=e.currentCoil,r=e.currentCore,i=e.currentFieldLines??[],a=t.px(n.at),o=t.py(n.at),s=n.halfLength*t.scale,c=n.radius*t.scale,l=2*s/Math.max(n.loopCount,1),u=Array.from({length:n.loopCount},(e,t)=>t);return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`defs`,{children:(0,D.jsx)(A,{uid:t.uid})}),r===void 0?null:(()=>{let e=r.halfLength*t.scale,n=r.armatureHalfWidth*t.scale,i=r.armatureHalfHeight*t.scale,s=a+r.northPole*(e+n),l=-r.northPole,u=Rn({x:s+l*n*.5,y:o},{x:l,y:0},10),d=s+r.northPole*(n+8);return(0,D.jsxs)(`g`,{"data-testid":`current-core`,children:[(0,D.jsx)(`rect`,{className:P.currentCoreBar,x:a-e,y:o-r.halfHeight*t.scale,width:2*e,height:2*r.halfHeight*t.scale,rx:1.5}),(0,D.jsx)(M,{x:a-e-8,y:o-c-9,anchor:`end`,symbol:r.coreText,className:P.currentReading}),(0,D.jsx)(`rect`,{className:P.currentArmature,"data-testid":`current-armature`,x:s-n,y:o-i,width:2*n,height:2*i,rx:1.2}),(0,D.jsx)(`path`,{className:P.currentFieldArrowHalo,d:u}),(0,D.jsx)(`path`,{className:P.currentFieldArrow,d:u}),(0,D.jsx)(M,{x:d,y:o-6,anchor:r.northPole===1?`start`:`end`,symbol:r.pullText,className:P.currentReading}),(0,D.jsx)(M,{x:d,y:o+14,anchor:r.northPole===1?`start`:`end`,symbol:r.heldMassText,className:P.currentReading})]})})(),i.map(e=>{let n=e.points.map(e=>`${t.px(e)},${t.py(e)}`).join(` `);return(0,D.jsxs)(`g`,{"data-testid":`current-field-line-${e.probe?`axis`:`loop`}`,children:[(0,D.jsx)(`polyline`,{className:P.currentFieldLineHalo,points:n}),(0,D.jsx)(`polyline`,{className:e.probe?P.currentAxisLine:P.currentFieldLine,points:n})]},e.id)}),(0,D.jsx)(`g`,{"data-testid":`current-coil`,children:u.map(e=>(0,D.jsx)(`ellipse`,{className:P.currentCoilLoop,cx:a-s+l*(e+.5),cy:o,rx:l*.44,ry:c},e))}),[1,-1].map(e=>(0,D.jsx)(`text`,{className:P.currentPoleLabel,"data-testid":`current-pole-${n.northPole===e?`north`:`south`}`,x:a+e*(s+3.4*t.scale),y:o+5,textAnchor:`middle`,children:n.northPole===e?`N`:`S`},e)),(0,D.jsx)(M,{x:a-s,y:o-c-9,anchor:`start`,symbol:n.currentText,className:P.currentReading}),(0,D.jsx)(M,{x:a+s*.45,y:o-c-9,anchor:`middle`,symbol:n.fieldText,className:P.currentReading}),(0,D.jsx)(M,{x:a-s,y:o+c+17,anchor:`start`,symbol:n.turnsText,className:P.currentReading}),n.comparisonTurnsText===void 0?null:(0,D.jsx)(M,{x:a+s,y:o+c+17,anchor:`end`,symbol:n.comparisonTurnsText,className:P.currentReading}),i.flatMap(e=>{let n=e.points.map(e=>({x:t.px(e),y:t.py(e)}));return(e.arrowAt??[]).flatMap((t,r)=>{let i=Ln(n,t);if(i===void 0)return[];let a=Rn(i.at,i.direction,10);return[(0,D.jsx)(`path`,{className:P.currentFieldArrowHalo,d:a},`${e.id}-halo-${r}`),(0,D.jsx)(`path`,{className:P.currentFieldArrow,d:a},`${e.id}-arrow-${r}`)]})}),(0,D.jsx)(j,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t}),e.dimensions.map(e=>(0,D.jsx)(ye,{dimension:e,projection:t},e.id))]})}if(n===`motor`&&e.currentRotor!==void 0){let n=e.currentRotor,r=t.px(n.at),i=t.py(n.at),a=n.sides.map(e=>({x:t.px(e),y:t.py(e)})),o=(n.halfWidth+3.4)*t.scale,s=35*Math.PI/180,c=n.sense===1?-s:s,l=-c,u=e=>({x:r+o*Math.cos(e),y:i-o*Math.sin(e)}),d=u(c),f=u(l),p=`M${d.x} ${d.y} A${o} ${o} 0 0 ${n.sense===1?0:1} ${f.x} ${f.y}`,m=Rn(f,In(l,n.sense),10);return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`defs`,{children:(0,D.jsx)(A,{uid:t.uid})}),(0,D.jsxs)(`g`,{"data-testid":`current-rotor`,children:[(0,D.jsx)(`line`,{className:P.motorCoil,x1:a[0]?.x??r,y1:a[0]?.y??i,x2:a[1]?.x??r,y2:a[1]?.y??i}),a.map((e,t)=>(0,D.jsx)(`circle`,{className:P.motorSide,"data-testid":`motor-side-${t+1}`,cx:e.x,cy:e.y,r:4.6},t)),(0,D.jsx)(`circle`,{className:P.motorAxis,cx:r,cy:i,r:3.4})]}),(0,D.jsx)(`path`,{className:P.motorSpin,"data-testid":`motor-spin`,d:p}),(0,D.jsx)(`path`,{className:P.motorSpinHalo,d:m}),(0,D.jsx)(`path`,{className:P.motorSpinArrow,d:m}),(0,D.jsx)(M,{x:r-o-16,y:i-10,anchor:`end`,symbol:`${n.torqueText} · ${n.angleText}`,className:P.currentReading}),(0,D.jsx)(M,{x:r-o-16,y:i+18,anchor:`end`,symbol:n.currentText,className:P.currentReading}),(0,D.jsx)(M,{x:r-o-16,y:i+35,anchor:`end`,symbol:n.turnsText,className:P.currentReading}),(0,D.jsx)(j,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t}),e.dimensions.map(e=>(0,D.jsx)(ye,{dimension:e,projection:t},e.id))]})}return null}const Vn={potential:P.energySegmentPotential,kinetic:P.energySegmentKinetic,thermal:P.energySegmentThermal};function Hn({view:e,projection:t}){let n=e.energyRamp,r=e.energyBar;if(n===void 0)return null;let i=t.px(n.base),a=t.py(n.base),o=t.px(n.peak),s=t.py(n.peak),c=Math.atan2(n.peak.y-n.base.y,n.peak.x-n.base.x),l=Math.hypot(n.peak.x-n.base.x,n.peak.y-n.base.y),u=Math.cos(c),d=Math.sin(c),f=Math.min(n.cartLength,l),p=n.cartHalfHeight*f/n.cartLength,m=f*t.scale,h=p*t.scale,g=e.bodies.find(e=>e.id===`energy-cart`)?.at??n.peak,_=Math.min(l-f/2,Math.max(f/2,(g.x-n.base.x)*u+(g.y-n.base.y)*d)),v={x:n.base.x+u*_-d*p,y:n.base.y+d*_+u*p},y={x:t.px(v),y:t.py(v)},b=-c*180/Math.PI;return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`path`,{className:P.energyRampBody,"data-testid":`energy-ramp`,d:`M${i} ${a} L${o} ${s} L${o} ${a} Z`}),(0,D.jsx)(`line`,{className:P.energyRampSurface,x1:i,y1:a,x2:o,y2:s}),(0,D.jsx)(`rect`,{className:P.energyCart,"data-testid":`energy-cart`,x:y.x-m/2,y:y.y-h,width:m,height:h*2,rx:1.4,transform:`rotate(${b} ${y.x} ${y.y})`}),(0,D.jsx)(M,{x:o+8,y:s+4,anchor:`start`,symbol:n.potentialText,className:P.currentReading}),(0,D.jsx)(M,{x:i-8,y:a+4,anchor:`end`,symbol:`${n.kineticText} · ${n.speedText}`,className:P.currentReading}),r===void 0?null:(()=>{let e=t.px(r.at),n=t.py(r.at),i=r.width*t.scale,a=r.height*t.scale,o=e,s=r.segments.map(e=>{let t=i*e.fraction,r=(0,D.jsx)(`rect`,{className:Vn[e.role],"data-testid":`energy-segment-${e.id}`,x:o,y:n-a,width:t,height:a},e.id);return o+=t,r});return(0,D.jsxs)(`g`,{"data-testid":`energy-bar`,children:[(0,D.jsx)(`rect`,{className:P.energyBarFrame,x:e,y:n-a,width:i,height:a,rx:1.2}),s,(0,D.jsx)(M,{x:e+i/2,y:n+22,anchor:`middle`,symbol:r.totalText,className:P.currentReading}),r.segments.map((t,r)=>(0,D.jsx)(M,{x:r===0?e:e+i,y:n+40,anchor:r===0?`start`:`end`,symbol:t.text,className:P.currentReading},t.id))]})})(),e.dimensions.map(e=>(0,D.jsx)(ye,{dimension:e,projection:t},e.id)),(0,D.jsx)(`title`,{children:n.label??`斜面`})]})}function Un({view:e,projection:t}){let n=e.lightRefraction;if(n!==void 0)return(0,D.jsx)(Wn,{refraction:n,projection:t});let r=e.lightRig;if(r===void 0)return null;let i=t.px(r.at),a=t.py(r.at),o=t.px(r.objectAt),s=t.px(r.screenAt),c=r.cardHalfHeight*t.scale,l=r.screenHalfHeight*t.scale,u=t.py({x:r.objectAt.x,y:r.objectHalfHeight}),d=t.py({x:r.objectAt.x,y:-r.objectHalfHeight}),f=t.py(r.imageTo),p=t.py(r.imageFrom);return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`defs`,{children:(0,D.jsx)(A,{uid:t.uid})}),(0,D.jsx)(`path`,{className:P.holeCard,"data-testid":`light-card`,d:`M${i} ${a-c} V${a-3} M${i} ${a+3} V${a+c}`}),r.rays.map(e=>(0,D.jsx)(`polyline`,{className:P.lightRay,"data-testid":`light-${e.id}`,points:e.points.map(e=>`${t.px(e)},${t.py(e)}`).join(` `)},e.id)),(0,D.jsx)(`path`,{className:P.lightObject,"data-testid":`light-object`,d:`M${o} ${d} V${u}`}),(0,D.jsx)(`path`,{className:P.lightImage,"data-testid":`light-image`,d:`M${s} ${f} V${p}`}),(0,D.jsx)(`path`,{className:P.lightScreen,"data-testid":`light-screen`,d:`M${s+3} ${a-l} V${a+l}`}),(0,D.jsx)(M,{x:s+10,y:a+4,anchor:`start`,symbol:r.imageText,className:P.currentReading}),(0,D.jsx)(M,{x:o-6,y:a+4,anchor:`end`,symbol:r.magnificationText,className:P.currentReading}),e.dimensions.map(e=>(0,D.jsx)(ye,{dimension:e,projection:t},e.id))]})}function Wn({refraction:e,projection:t}){let n={x:t.px(e.at),y:t.py(e.at)},r=(e,n)=>`M${t.px(e)} ${t.py(e)} L${t.px(n)} ${t.py(n)}`;return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`defs`,{children:(0,D.jsx)(A,{uid:t.uid})}),(0,D.jsx)(`path`,{className:P.lightBoundary,"data-testid":`light-boundary`,d:r(e.boundaryFrom,e.boundaryTo)}),(0,D.jsx)(`path`,{className:P.lightNormal,"data-testid":`light-normal`,d:r(e.normalFrom,e.normalTo)}),e.criticalTo===void 0?null:(0,D.jsx)(`path`,{className:P.lightCriticalRay,"data-testid":`light-critical`,d:r(e.at,e.criticalTo)}),(0,D.jsx)(`path`,{className:P.lightRay,"data-testid":`light-incident`,d:r(e.incidentFrom,e.at)}),(0,D.jsx)(`path`,{className:P.lightImage,"data-testid":`light-reflected`,d:r(e.at,e.reflectedTo)}),e.refractedTo===void 0?null:(0,D.jsx)(`path`,{className:P.lightRefractedRay,"data-testid":`light-refracted`,d:r(e.at,e.refractedTo)}),(0,D.jsx)(M,{x:n.x+10,y:n.y-10,anchor:`start`,symbol:e.incidentText,className:P.currentReading}),(0,D.jsx)(M,{x:n.x+10,y:n.y+8,anchor:`start`,symbol:e.criticalText,className:P.currentReading}),(0,D.jsx)(M,{x:n.x+10,y:n.y+26,anchor:`start`,symbol:e.refractedText,className:P.currentReading})]})}function Gn({view:e,projection:t}){let n=e.transformerCoils??[],r=e.transformerCore;if(r===void 0||n.length===0)return null;let i=t.py(r.from),a=r.halfHeight*t.scale;return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`rect`,{className:P.transformerCore,"data-testid":`transformer-core`,x:t.px(r.from),y:i-a,width:t.px(r.to)-t.px(r.from),height:2*a,rx:1}),n.map(e=>{let n=t.px(e.at),r=t.py(e.at),i=e.halfWidth*t.scale,a=e.halfHeight*t.scale,o=2*i/e.turnsLoops,s=Array.from({length:e.turnsLoops},(e,t)=>t),c=e.primary?P.transformerPrimaryLoop:P.transformerSecondaryLoop;return(0,D.jsxs)(`g`,{"data-testid":`transformer-${e.primary?`primary`:`secondary`}`,children:[s.map(e=>(0,D.jsx)(`ellipse`,{className:c,cx:n-i+o*(e+.5),cy:r,rx:o*.34,ry:a},e)),(0,D.jsx)(M,{x:n-i,y:r-a-24,anchor:`start`,symbol:e.voltageText,className:P.currentReading}),(0,D.jsx)(M,{x:n-i,y:r-a-6,anchor:`start`,symbol:e.turnsText,className:P.currentReading}),(0,D.jsx)(M,{x:n-i,y:r+a+14,anchor:`start`,symbol:e.currentText,className:P.currentReading})]},e.id)}),(0,D.jsx)(M,{x:t.px({x:0,y:0}),y:i-4,anchor:`middle`,symbol:r.ratioText,className:P.currentReading}),(0,D.jsx)(M,{x:t.px({x:0,y:0}),y:i+16,anchor:`middle`,symbol:r.powerText,className:P.currentReading})]})}const Kn=(e,t,n,r,i)=>{let a=e-n*i,o=t-r*i,s=-r*i*.46,c=n*i*.46;return`M${e} ${t} L${a+s} ${o+c} L${a-s} ${o-c} Z`},qn=(e,t,n)=>{let r=e[0]??{x:0,y:0},i=0;for(let r=0;r<t.length;r+=1){let a=t[r]??0,o=e[r],s=e[r+1];if(o===void 0||s===void 0)break;if(n<=i+a||r===t.length-1){let e=a<=0?0:Math.min(1,Math.max(0,(n-i)/a));return{x:o.x+(s.x-o.x)*e,y:o.y+(s.y-o.y)*e}}i+=a}return r};function Jn({view:e,projection:t,time:n}){let r=e.inductionField,i=e.inductionBar,a=e.inductionCoil,o=e.inductionCurrent,s=e.inductionRails,c=e.inductionPairBars,l=e.inductionForceArrows;if(r===void 0)return(0,D.jsx)(D.Fragment,{});let u=t.px(r.origin),d=t.py({x:r.origin.x,y:r.origin.y+r.size.height}),f=t.px({x:r.origin.x+r.size.width,y:r.origin.y})-u,p=Math.abs(d-t.py(r.origin)),m=Math.min(d,t.py(r.origin)),h=[],g=Math.max(3,Math.floor(f/46)),_=Math.max(2,Math.floor(p/46));for(let e=0;e<g;e+=1)for(let t=0;t<_;t+=1)h.push({x:u+(e+.5)*f/g,y:m+(t+.5)*p/_});let v=3.2;return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsxs)(`g`,{className:t.highlighted(r.id)?P.highlightGroup:void 0,children:[(0,D.jsx)(`rect`,{className:P.inductionFieldBox,x:u,y:m,width:f,height:p}),h.map((e,t)=>(0,D.jsxs)(`g`,{className:P.inductionFieldMark,children:[(0,D.jsx)(`line`,{x1:e.x-v,y1:e.y-v,x2:e.x+v,y2:e.y+v}),(0,D.jsx)(`line`,{x1:e.x-v,y1:e.y+v,x2:e.x+v,y2:e.y-v})]},t))]}),s===void 0?null:s.map(e=>{let n={x:t.px(e.from),y:t.py(e.from)},r={x:t.px(e.to),y:t.py(e.to)};return(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`line`,{className:P.inductionRailEdge,x1:n.x,y1:n.y-1.4,x2:r.x,y2:r.y-1.4}),(0,D.jsx)(`line`,{className:P.inductionRail,x1:n.x,y1:n.y,x2:r.x,y2:r.y})]},e.id)}),e.inductionResistor===void 0?null:(()=>{let n=e.inductionResistor,r=t.px(n.at),i=t.py({x:0,y:n.at.y+n.span/2}),a=t.py({x:0,y:n.at.y-n.span/2}),o=(i+a)/2,s=(a-i)*.28,c=Array.from({length:6},(e,t)=>`L${r+(t%2==0?4.5:-4.5)} ${i+s+(t+.5)/6*(a-i-s*2)}`).join(` `);return(0,D.jsxs)(`g`,{className:t.highlighted(n.id)?P.highlightGroup:void 0,children:[(0,D.jsx)(`path`,{className:P.inductionResistor,d:`M${r} ${i} L${r} ${i+s} ${c} L${r} ${a}`}),(0,D.jsx)(`text`,{className:P.inductionResistorLabel,x:r-8,y:o+4,textAnchor:`end`,children:n.label})]})})(),i!==void 0&&e.visible.barMotion===!0?(()=>{let e=t.px(i.at),n=t.py({x:0,y:i.at.y+i.length/2}),r=t.py({x:0,y:i.at.y-i.length/2}),a={x:e+6,y:n-12},o={x:e+6+i.direction*34,y:n-12},s=i.direction;return(0,D.jsxs)(`g`,{className:t.highlighted(i.id)?P.highlightGroup:void 0,children:[(0,D.jsx)(`line`,{className:P.inductionRodBed,x1:e,y1:n,x2:e,y2:r}),(0,D.jsx)(`line`,{className:P.inductionRod,x1:e,y1:n,x2:e,y2:r}),(0,D.jsx)(`circle`,{className:P.inductionRodContact,cx:e,cy:n,r:3.2}),(0,D.jsx)(`circle`,{className:P.inductionRodContact,cx:e,cy:r,r:3.2}),(0,D.jsx)(`line`,{className:P.inductionVelocity,x1:a.x,y1:a.y,x2:o.x,y2:o.y}),(0,D.jsx)(`path`,{className:P.inductionVelocityHead,d:Kn(o.x,o.y,s,0,7)}),(0,D.jsx)(`text`,{className:P.inductionVelocityLabel,x:(a.x+o.x)/2,y:a.y-5,textAnchor:`middle`,children:`v`}),(0,D.jsx)(`text`,{className:P.annotation,x:e+10,y:n-26,children:i.label})]})})():null,a===void 0?null:(()=>{let e=t.px(a.at),n=t.py(a.at),r=Math.max(4,a.diameter*t.scale/2),i=[0,1,2,3].map(t=>{let i=e-r+t/4*2*r,a=e-r+(t+.25)/4*2*r,o=n-r*.5+(t%2==0?0:r*.18);return`M${i} ${o} A${r*.3} ${r*.42} 0 0 1 ${a} ${o-r*.28}`}).join(` `);return(0,D.jsxs)(`g`,{className:t.highlighted(a.id)?P.highlightGroup:void 0,children:[(0,D.jsx)(`path`,{className:P.inductionCoil,d:i}),(0,D.jsx)(`ellipse`,{className:P.inductionCoil,cx:e,cy:n,rx:r,ry:r*.34,opacity:.55}),(0,D.jsx)(`text`,{className:P.annotation,x:e+r+8,y:n-r*.5,children:a.label})]})})(),c===void 0?null:(0,D.jsx)(D.Fragment,{children:c.map(e=>{let n=t.px(e.at),r=t.py({x:0,y:e.at.y+e.length/2}),i=t.py({x:0,y:e.at.y-e.length/2});return(0,D.jsxs)(`g`,{className:t.highlighted(e.id)?P.highlightGroup:void 0,children:[(0,D.jsx)(`line`,{className:P.inductionRod,x1:n,y1:r,x2:n,y2:i}),(0,D.jsx)(`text`,{className:P.annotation,x:n+10,y:r-4,children:e.label})]},e.id)})}),l===void 0?null:l.map(e=>{let n={x:t.px(e.at),y:t.py(e.at)},r={x:t.px({x:e.at.x+e.direction*e.length,y:e.at.y}),y:t.py(e.at)},i=r.x-n.x,a=r.y-n.y,o=Math.hypot(i,a),s=o===0?e.direction:i/o,c=o===0?0:a/o,l=e.at.y>0;return(0,D.jsxs)(`g`,{className:t.highlighted(e.id)?P.highlightGroup:void 0,children:[(0,D.jsx)(`line`,{className:P.inductionForceArrow,x1:n.x,y1:n.y,x2:r.x,y2:r.y}),(0,D.jsx)(`path`,{className:P.inductionForceHead,d:Kn(r.x,r.y,s,c,7)}),(0,D.jsx)(`text`,{className:P.inductionForceLabel,x:(n.x+r.x)/2,y:l?n.y-7:n.y+15,textAnchor:`middle`,children:e.label})]},e.id)}),o!==void 0&&e.visible.inductionCurrent===!0?(()=>{let e={x:t.px(o.from),y:t.py(o.from)},n={x:t.px(o.to),y:t.py(o.to)},r=o.sign>=0?n:e,i=o.sign>=0?e:n,a=r.x-i.x,s=r.y-i.y,c=Math.hypot(a,s),l=c===0?1:a/c,u=c===0?0:s/c;return(0,D.jsxs)(`g`,{className:t.highlighted(o.id)?P.highlightGroup:void 0,children:[(0,D.jsx)(`line`,{className:N(P.inductionCurrentArrow,o.sign===0&&P.inductionFieldBox),x1:i.x,y1:i.y,x2:r.x,y2:r.y}),o.sign===0?null:(0,D.jsx)(`path`,{className:P.inductionCurrentHead,d:Kn(r.x,r.y,l,u,8)}),(0,D.jsx)(`text`,{className:P.inductionCurrentLabel,x:(i.x+r.x)/2,y:i.y+14,textAnchor:`middle`,children:`I = E/R`})]})})():null,e.visible.inductionCurrent===!0?(e.chargeFlows??[]).map(e=>{let r=e.path.map(e=>({x:t.px(e),y:t.py(e)})),i=[],a=0;for(let e=1;e<r.length;e+=1){let t=r[e-1],n=r[e];if(t===void 0||n===void 0)continue;let o=Math.hypot(n.x-t.x,n.y-t.y);i.push(o),a+=o}if(r.length<2||a<=0)return null;let o=Math.max(2,Math.round(a/22)),s=a/o,c=Math.min(110,Math.max(10,Math.abs(e.current)*1e3)),l=e.current===0?0:Math.sign(e.current)*c*(n??0);return(0,D.jsx)(`g`,{"data-charge-flow":e.id,"aria-hidden":`true`,children:Array.from({length:o},(e,t)=>{let n=qn(r,i,((t*s+l)%a+a)%a);return(0,D.jsx)(`circle`,{className:P.inductionChargeDot,cx:n.x,cy:n.y,r:2.6},t)})},e.id)}):null]})}const Yn=(e,t,n,r,i)=>{let a=e-n*i,o=t-r*i,s=-r*i*.46,c=n*i*.46;return`M${e} ${t} L${a+s} ${o+c} L${a-s} ${o-c} Z`},Xn=(e,t,n)=>{let r=n.px(e),i=n.py(e),a=n.px(t),o=n.py(t),s=a-r,c=o-i,l=Math.hypot(s,c);if(l<14)return null;let u=s/l,d=c/l;return Yn((r+a)/2,(i+o)/2,u,d,Math.min(7,Math.max(3.4,l*.16)))},Zn=({x:e,footY:t,topY:n,lineClass:r,headClass:i})=>{let a=n<t;return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`line`,{className:r,x1:e,y1:t,x2:e,y2:n+(a?8:-8)}),(0,D.jsx)(`path`,{className:i,d:Yn(e,n,0,a?-1:1,9)})]})};function Qn({view:e,projection:t,componentDrag:n}){let r=(0,_.useRef)(null),[i,a]=(0,_.useState)();(0,_.useEffect)(()=>()=>{let e=r.current;r.current=null,e?.moved&&e.channel.cancel()},[]),(0,_.useEffect)(()=>{if(n!==void 0)return;let e=r.current;r.current=null,a(void 0),e?.moved&&e.channel.cancel()},[n]);let o=(e,i,a)=>{if(n===void 0||e.button!==0||r.current!==null)return;let o=e.currentTarget.ownerSVGElement,s=o===null?void 0:pn(o,e);if(o===null||s===void 0)return;let c=t.sx(s.x);Number.isFinite(c)&&(r.current={id:i,pointerId:e.pointerId,svg:o,channel:n,sx:t.sx,scale:t.scale,startX:a.x,railY:a.y,offsetX:c-a.x,moved:!1},e.preventDefault(),e.stopPropagation(),e.currentTarget.setPointerCapture?.(e.pointerId))},s=e=>{let t=r.current;if(t===null||e.pointerId!==t.pointerId)return;e.stopPropagation();let n=pn(t.svg,e);if(n===void 0)return;let i=t.sx(n.x)-t.offsetX;!Number.isFinite(i)||!t.moved&&Math.abs(i-t.startX)*t.scale<3||(t.moved=!0,a(t.id),t.channel.preview(t.id,{x:i,y:t.railY}))},c=e=>{let t=r.current;if(t===null||e.pointerId!==t.pointerId||(r.current=null,a(void 0),e.stopPropagation(),!t.moved))return;let n=pn(t.svg,e),i=n===void 0?void 0:t.sx(n.x)-t.offsetX;i===void 0||!Number.isFinite(i)?t.channel.cancel():t.channel.commit(t.id,{x:i,y:t.railY})},l=e=>{let t=r.current;t===null||e.pointerId!==t.pointerId||(r.current=null,a(void 0),e.stopPropagation(),t.moved&&t.channel.cancel())},u=t.py({x:0,y:0}),d=t.px({x:e.origin.x,y:0}),f=t.px({x:e.origin.x+e.extent.width,y:0}),p=e.visible.rays===!0,m=e.visible.image===!0;return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`line`,{className:P.opticalAxis,x1:d,y1:u,x2:f,y2:u}),(e.opticalAxisMarks??[]).map(e=>{let n=t.px(e.at);return(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`line`,{className:P.focalTick,x1:n,y1:u-5,x2:n,y2:u+5}),(0,D.jsx)(`text`,{className:P.focalLabel,x:n,y:u+18,textAnchor:`middle`,children:e.label})]},e.id)}),p?(e.opticalRays??[]).map(e=>e.extension===void 0?null:(0,D.jsx)(`path`,{className:P.opticalRayExtension,d:t.path(e.extension)},`${e.id}-extension`)):null,p?(e.opticalRays??[]).map(e=>{let n=[],r=e.points[0],i=e.points[1],a=e.points[2];if(r!==void 0&&i!==void 0){let e=Xn(r,i,t);e!==null&&n.push(e)}if(i!==void 0&&a!==void 0){let e=Xn(i,a,t);e!==null&&n.push(e)}return(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`path`,{className:P.opticalRay,d:t.path(e.points)}),n.map((e,t)=>(0,D.jsx)(`path`,{className:P.opticalRayHead,d:e},t))]},e.id)}):null,(e.opticalElements??[]).map(e=>{let n=t.px(e.at),r=t.py({x:0,y:e.at.y+e.halfAperture}),i=t.py({x:0,y:e.at.y-e.halfAperture}),a=t.highlighted(e.id);if(e.kind===`thin_lens`)return(0,D.jsxs)(`g`,{className:a?P.highlightGroup:void 0,children:[(0,D.jsx)(`ellipse`,{className:P.lensBody,cx:n,cy:(r+i)/2,rx:Math.max(5,(i-r)*.09),ry:(i-r)/2}),(0,D.jsx)(`line`,{className:P.lensAxisLine,x1:n,y1:r+2,x2:n,y2:i-2}),(0,D.jsx)(`path`,{className:P.lensHead,d:Yn(n,r,0,-1,8)}),(0,D.jsx)(`path`,{className:P.lensHead,d:Yn(n,i,0,1,8)}),e.label===void 0?null:(0,D.jsx)(`text`,{className:P.annotation,x:n,y:r-8,textAnchor:`middle`,children:e.label})]},e.id);let o=Math.max(4,Math.floor((i-r)/12));if(e.kind===`curved_mirror`){let t=Math.min(20,Math.max(7,(i-r)*.14)),s=e.curvature===`convex`?t:-t,c=`M${n+s} ${r} Q${n-s} ${(r+i)/2} ${n+s} ${i}`;return(0,D.jsxs)(`g`,{className:a?P.highlightGroup:void 0,children:[(0,D.jsx)(`path`,{className:P.curvedMirrorPlate,d:c}),Array.from({length:o},(e,t)=>{let a=(t+.5)/o,c=r+a*(i-r),l=n+s*(1-2*a)*(1-2*a);return(0,D.jsx)(`line`,{className:P.mirrorHatch,x1:l+1.5,y1:c+4,x2:l+8,y2:c-4},t)}),e.label===void 0?null:(0,D.jsx)(`text`,{className:P.annotation,x:n,y:r-8,textAnchor:`middle`,children:e.label})]},e.id)}return(0,D.jsxs)(`g`,{className:a?P.highlightGroup:void 0,children:[(0,D.jsx)(`line`,{className:P.mirrorPlate,x1:n,y1:r,x2:n,y2:i}),Array.from({length:o},(e,t)=>{let a=r+(t+.5)/o*(i-r);return(0,D.jsx)(`line`,{className:P.mirrorHatch,x1:n+1.5,y1:a+4,x2:n+8,y2:a-4},t)}),e.label===void 0?null:(0,D.jsx)(`text`,{className:P.annotation,x:n,y:r-8,textAnchor:`middle`,children:e.label})]},e.id)}),(e.opticalScreens??[]).map(e=>{let r=t.px(e.at),a=t.py({x:0,y:e.at.y+e.halfHeight}),d=t.py({x:0,y:e.at.y-e.halfHeight});return(0,D.jsxs)(`g`,{className:t.highlighted(e.id)?P.highlightGroup:void 0,style:n===void 0?void 0:{cursor:i===e.id?`grabbing`:`grab`,touchAction:`none`},onPointerDown:t=>{o(t,e.id,e.at)},onPointerMove:s,onPointerUp:c,onPointerCancel:l,onLostPointerCapture:l,children:[n===void 0?null:(0,D.jsx)(`rect`,{x:r-12,y:Math.min(a,d)-12,width:24,height:Math.abs(d-a)+24,fill:`transparent`}),e.lit?(0,D.jsx)(`line`,{className:P.screenGlow,x1:r,y1:a,x2:r,y2:d}):null,(0,D.jsx)(`line`,{className:N(P.screenPlate,e.lit&&P.screenPlateLit),x1:r,y1:a,x2:r,y2:d}),(0,D.jsx)(`line`,{className:P.screenFoot,x1:r-9,y1:u+1,x2:r+9,y2:u+1}),e.label===void 0?null:(0,D.jsx)(`text`,{className:P.annotation,x:r,y:a-8,textAnchor:`middle`,children:e.label})]},e.id)}),(e.opticalObjects??[]).map(e=>{let r=t.px(e.at),a=t.py(e.at),u=t.py({x:0,y:e.at.y+e.height});return(0,D.jsxs)(`g`,{className:t.highlighted(e.id)?P.highlightGroup:void 0,style:n===void 0?void 0:{cursor:i===e.id?`grabbing`:`grab`,touchAction:`none`},onPointerDown:t=>{o(t,e.id,e.at)},onPointerMove:s,onPointerUp:c,onPointerCancel:l,onLostPointerCapture:l,children:[n===void 0?null:(0,D.jsx)(`rect`,{x:r-12,y:Math.min(a,u)-12,width:24,height:Math.abs(a-u)+24,fill:`transparent`}),(0,D.jsx)(Zn,{x:r,footY:a,topY:u,lineClass:P.opticalObjectLine,headClass:P.opticalObjectHead}),e.label===void 0?null:(0,D.jsx)(`text`,{className:P.annotation,x:r,y:a+18,textAnchor:`middle`,children:e.label})]},e.id)}),m?(e.opticalImages??[]).map(e=>{let n=t.px(e.at),r=t.py(e.at),i=t.py({x:0,y:e.at.y+e.height}),a=e.height<0;return(0,D.jsxs)(`g`,{className:t.highlighted(e.id)?P.highlightGroup:void 0,children:[(0,D.jsx)(Zn,{x:n,footY:r,topY:i,lineClass:N(P.opticalImageLine,e.nature===`virtual`&&P.opticalImageVirtual),headClass:P.opticalImageHead}),e.label===void 0?null:(0,D.jsx)(`text`,{className:N(P.annotation,P.opticalImageLabel),x:n,y:a?r-8:r+18,textAnchor:`middle`,children:e.label})]},e.id)}):null]})}const $n=({x:e,y:t,halfWidth:n,time:r})=>(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`rect`,{className:P.thermalHeaterBody,x:e-n,y:t,width:n*2,height:n*.42,rx:n*.16}),[-.5,0,.5].map((i,a)=>{let o=(r??0)*7.1+a*2.3,s=Math.sin(o)*.8,c=Math.sin(o*1.31+1.1)*2.6;return(0,D.jsx)(`g`,{"data-testid":`thermal-flame`,transform:`translate(${(e+i*n+s).toFixed(2)} ${t.toFixed(2)})`,children:(0,D.jsx)(`path`,{className:P.thermalFlame,transform:`skewX(${c.toFixed(2)})`,d:[`M0 0`,`q${n*.2} ${-n*.34} 0 ${-n*.62}`,`q${-n*.2} ${n*.28} 0 ${n*.62}`,`z`].join(` `)})},i)})]}),er=({sample:e,projection:t})=>{let n=t.px({x:e.at.x-e.halfWidth,y:0}),r=t.px({x:e.at.x+e.halfWidth,y:0}),i=t.py({x:0,y:e.at.y+e.halfHeight}),a=t.py({x:0,y:e.at.y-e.halfHeight}),o=Math.min(9,(a-i)*.12),s=e.meltedFraction<=0?null:t.py({x:0,y:e.at.y-e.halfHeight+2*e.halfHeight*e.meltedFraction});return(0,D.jsxs)(`g`,{className:t.highlighted(e.id)?P.highlightGroup:void 0,children:[(0,D.jsx)(`rect`,{className:P.thermalSampleSolid,x:n,y:i,width:r-n,height:a-i}),s===null?null:(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`rect`,{className:N(P.thermalSampleLiquid,(e.phase===`melting`||e.phase===`boiling`)&&P.thermalSampleMelting),x:n,y:s,width:r-n,height:a-s}),(0,D.jsx)(`line`,{className:P.thermalSurface,x1:n,y1:s,x2:r,y2:s})]}),(0,D.jsx)(`path`,{className:P.thermalBeakerWall,d:[`M${n-5} ${i-5}`,`L${n} ${i}`,`V${a-o}`,`Q${n} ${a} ${n+o} ${a}`,`H${r-o}`,`Q${r} ${a} ${r} ${a-o}`,`V${i}`,`L${r+5} ${i-5}`].join(` `)}),e.label===void 0?null:(0,D.jsx)(`text`,{className:P.annotation,x:t.px(e.at),y:i-9,textAnchor:`middle`,children:e.label})]})},tr=({thermometer:e,projection:t})=>{let n=t.px(e.at),r=t.py(e.at),i=t.py({x:0,y:e.at.y+15}),a=t.py({x:0,y:e.at.y+e.columnHeight});return(0,D.jsxs)(`g`,{className:t.highlighted(e.id)?P.highlightGroup:void 0,children:[(0,D.jsx)(`rect`,{className:P.thermalTubeOuter,x:n-9/2,y:i,width:9,height:r-i,rx:9/2}),(0,D.jsx)(`line`,{className:P.thermalColumn,x1:n,y1:r,x2:n,y2:a}),(0,D.jsx)(`circle`,{className:P.thermalBulb,cx:n,cy:r,r:7}),[.2,.4,.6,.8].map(e=>(0,D.jsx)(`line`,{className:P.thermalTick,x1:n+9/2,y1:r-e*(r-i),x2:n+9/2+4,y2:r-e*(r-i)},e)),(0,D.jsx)(`text`,{className:P.thermalReading,x:n+9/2+8,y:a+4,children:e.reading})]})},nr=({heater:e,projection:t,time:n})=>(0,D.jsxs)(`g`,{className:t.highlighted(e.id)?P.highlightGroup:void 0,children:[(0,D.jsx)($n,{x:t.px(e.at),y:t.py(e.at),halfWidth:e.halfWidth*t.scale,time:n}),(0,D.jsx)(`text`,{className:P.annotation,x:t.px(e.at),y:t.py(e.at)+e.halfWidth*t.scale*.42+16,textAnchor:`middle`,children:e.label===void 0?e.power:`${e.label} ${e.power}`})]});function rr({view:e,projection:t,time:n}){let r=e.visible.thermometer===!0,i=e.visible.phase===!0,a=e.thermalSample,o=e.thermalThermometer,s=e.thermalHeater,c=e.thermalComparisonSample,l=e.thermalComparisonThermometer,u=e.thermalComparisonHeater;return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`defs`,{children:(0,D.jsx)(A,{uid:t.uid})}),i?e.guides.map(e=>(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`line`,{className:P.thermalMeltingLine,x1:t.px(e.from),y1:t.py(e.from),x2:t.px(e.to),y2:t.py(e.to)}),e.label===void 0?null:(0,D.jsx)(`text`,{className:P.thermalMeltingLabel,x:t.px(e.to),y:t.py(e.to)-6,textAnchor:`end`,children:e.label})]},e.id)):null,s===void 0?null:(0,D.jsx)(nr,{heater:s,projection:t,time:n}),u===void 0?null:(0,D.jsx)(nr,{heater:u,projection:t,time:n}),a===void 0?null:(0,D.jsx)(er,{sample:a,projection:t}),c===void 0?null:(0,D.jsx)(er,{sample:c,projection:t}),o===void 0||!r?null:(0,D.jsx)(tr,{thermometer:o,projection:t}),l===void 0||!r?null:(0,D.jsx)(tr,{thermometer:l,projection:t})]})}const ir=.8;function ar({view:e,projection:t}){let n=e.thermometer;if(n===void 0)return null;let r=t.px(n.at),i=t.py(n.at),a=n.halfWidth*t.scale,o=n.bulbRadius*t.scale,s=i+o*.7,c=t.py({x:n.at.x,y:n.steamPoint+1.2}),l=t.py({x:n.at.x,y:n.columnTop}),u=t.py({x:n.at.x,y:n.icePoint}),d=t.py({x:n.at.x,y:n.steamPoint}),f=a*1.9;return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`defs`,{children:(0,D.jsx)(A,{uid:t.uid})}),(0,D.jsx)(`rect`,{className:P.thermometerColumn,"data-testid":`thermometer-column`,x:r-a,y:l,width:a*2,height:i-l}),(0,D.jsx)(`circle`,{className:P.thermometerColumn,cx:r,cy:s,r:o}),(0,D.jsx)(`circle`,{className:P.thermometerGlass,cx:r,cy:s,r:o}),(0,D.jsx)(`path`,{className:P.thermometerGlass,"data-testid":`thermometer-tube`,d:`M${r-a} ${i} V${c+a} A${a} ${a} 0 0 1 ${r+a} ${c+a} V${i}`}),[{id:`ice`,y:u,label:`0 °C`},{id:`steam`,y:d,label:`100 °C`}].map(e=>(0,D.jsxs)(`g`,{"data-testid":`thermometer-tick-${e.id}`,children:[(0,D.jsx)(`line`,{className:P.thermometerTick,x1:r+a,y1:e.y,x2:r+a+f,y2:e.y}),(0,D.jsx)(M,{x:r+a+f+4,y:e.y+4,anchor:`start`,symbol:e.label,className:P.thermometerTickLabel})]},e.id)),(0,D.jsx)(M,{x:r-a-6,y:l+4,anchor:`end`,symbol:n.temperatureText,className:P.currentReading}),(0,D.jsx)(M,{x:r-a-6,y:l+20,anchor:`end`,symbol:n.columnText,className:P.thermometerTickLabel}),(0,D.jsx)(`line`,{className:P.thermometerSpan,x1:r-a-ir*t.scale,y1:u,x2:r-a-ir*t.scale,y2:d}),(0,D.jsx)(M,{x:r-a-ir*t.scale-4,y:(u+d)/2,anchor:`end`,symbol:n.scaleText,className:P.thermometerTickLabel})]})}const or=.11,sr=.5;function cr({view:e,projection:t}){let n=e.noiseRig;if(n===void 0)return null;let r=t.px(n.sourceAt),i=t.py(n.sourceAt),a=t.px(n.listenerAt),o=t.py(n.listenerAt);return(0,D.jsxs)(D.Fragment,{children:[n.wavefronts.map((e,n)=>(0,D.jsx)(`circle`,{className:P.noiseWavefront,"data-testid":`noise-wavefront-${n}`,cx:r,cy:i,r:e*t.scale,opacity:.5-n*.9*0},e)),n.barrierAt===void 0?null:(0,D.jsx)(`g`,{"data-testid":`noise-barrier`,children:(0,D.jsx)(`line`,{className:P.noiseBarrier,x1:t.px(n.barrierAt),y1:i-sr*t.scale,x2:t.px(n.barrierAt),y2:i+sr*t.scale})}),(0,D.jsx)(`circle`,{className:P.noiseSource,cx:r,cy:i,r:.14*t.scale}),(0,D.jsx)(`circle`,{className:P.noiseListener,"data-testid":`noise-listener`,cx:a,cy:o,r:or*t.scale}),(0,D.jsx)(`line`,{className:P.noiseDistance,x1:r,y1:i+.62*t.scale,x2:a,y2:i+.62*t.scale}),(0,D.jsx)(M,{x:r,y:i-.32*t.scale,anchor:`start`,symbol:n.sourceText,className:P.currentReading}),(0,D.jsx)(M,{x:a+or*t.scale+5,y:o-4,anchor:`start`,symbol:n.levelText,className:P.currentReading}),(0,D.jsx)(M,{x:(r+a)/2,y:i+.62*t.scale+16,anchor:`middle`,symbol:n.distanceText,className:P.currentReading}),n.barrierAt===void 0?null:(0,D.jsx)(M,{x:t.px(n.barrierAt),y:i-sr*t.scale-6,anchor:`middle`,symbol:n.barrierText,className:P.currentReading})]})}const lr=({ax:e,ay:t,mx:n,my:r,size:i,massText:a,highlighted:o})=>{let s=i*1.7,c=i*1.25,l=i*.42;return(0,D.jsxs)(`g`,{className:o?P.highlightGroup:void 0,children:[(0,D.jsx)(`line`,{className:P.leverString,x1:e,y1:t,x2:n,y2:r-c/2-l*1.6}),(0,D.jsx)(`circle`,{className:P.leverMassHook,cx:n,cy:r-c/2-l*.55,r:l}),(0,D.jsx)(`rect`,{className:P.leverMass,x:n-s/2,y:r-c/2,width:s,height:c,rx:i*.22}),(0,D.jsx)(`line`,{className:P.leverMassSlot,x1:n-s/2+i*.18,y1:r,x2:n+s/2-i*.18,y2:r}),(0,D.jsx)(M,{x:n,y:r+c/2+13,anchor:`middle`,symbol:a,className:P.annotation})]})};function ur({view:e,projection:t}){let n=e.leverBeam,r=e.leverFulcrum,i=e.leverHangers??[];if(n===void 0||r===void 0)return null;let a=t.px(r.at),o=t.py(r.at),s=7*t.scale,c=t.px(n.from),l=t.py(n.from),u=t.px(n.to),d=t.py(n.to),f=Math.hypot(u-c,d-l)||1,p=(u-c)/f,m=-((d-l)/f),h=p,g=Math.max(2.4,f*.012),_=[`M${c+m*g} ${l+h*g}`,`L${u+m*g} ${d+h*g}`,`L${u-m*g} ${d-h*g}`,`L${c-m*g} ${l-h*g}`,`Z`].join(` `),v=Math.floor(f/16),y=Array.from({length:Math.max(0,v-1)},(e,t)=>{let n=(t+1)/v,r=c+(u-c)*n,i=l+(d-l)*n;return{x1:r+m*g,y1:i+h*g,x2:r+m*g*.35,y2:i+h*g*.35}});return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`defs`,{children:(0,D.jsx)(A,{uid:t.uid})}),e.visible.arms===!0?e.dimensions.map(e=>(0,D.jsx)(ye,{dimension:e,projection:t},e.id)):null,(0,D.jsxs)(`g`,{className:t.highlighted(r.id)?P.highlightGroup:void 0,children:[(0,D.jsx)(`polygon`,{className:P.leverFulcrum,points:`${a},${o} ${a-s},${o+s*1.4} ${a+s},${o+s*1.4}`}),(0,D.jsx)(`line`,{className:P.leverFulcrumStand,x1:a,y1:o+s*1.4,x2:a,y2:o+s*2.3}),(0,D.jsx)(`line`,{className:P.leverFulcrumBase,x1:a-s*1.7,y1:o+s*2.3,x2:a+s*1.7,y2:o+s*2.3})]}),(0,D.jsxs)(`g`,{className:t.highlighted(n.id)?P.highlightGroup:void 0,children:[(0,D.jsx)(`path`,{className:P.leverBeamBar,d:_}),y.map((e,t)=>(0,D.jsx)(`line`,{className:P.leverBeamTick,x1:e.x1,y1:e.y1,x2:e.x2,y2:e.y2},t))]}),i.map(e=>(0,D.jsx)(lr,{ax:t.px(e.attach),ay:t.py(e.attach),mx:t.px(e.massAt),my:t.py(e.massAt),size:5.5*t.scale,massText:e.massText,highlighted:t.highlighted(e.id)},e.id)),(0,D.jsx)(j,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t})]})}const dr=(e,t)=>{let n;for(let r of e){if(n!==void 0&&t>=n.x&&t<=r.x){let e=r.x-n.x,i=e===0?0:(t-n.x)/e;return n.y+(r.y-n.y)*i}n=r}let r=e[0],i=e[e.length-1];return r===void 0||i===void 0?0:t<r.x?r.y:i.y},fr=(e,t)=>{let n=e.points[0],r=e.points[e.points.length-1];if(n===void 0||r===void 0)return[];let i=r.x-n.x;if(i<=0)return[];let a=i*.02,o=Array.from({length:12},(e,t)=>({x:n.x+(t+.5)*i/12,atNode:!1})),s=t.filter(e=>e.kind===`node`&&e.at.x>n.x+a&&e.at.x<r.x-a).map(e=>e.at.x).sort((e,t)=>e-t);for(let e of s){let t;for(let[n,r]of o.entries()){if(r.atNode)continue;let i=t===void 0?void 0:o[t];(i===void 0||Math.abs(r.x-e)<Math.abs(i.x-e))&&(t=n)}let n=t===void 0?void 0:o[t];n!==void 0&&(n.x=e,n.atNode=!0)}let{from:c,to:l}=e.equilibrium,u=l.x-c.x;return o.map(t=>({...t,y:dr(e.points,t.x),equilibriumY:u===0?c.y:c.y+(l.y-c.y)*(t.x-c.x)/u})).sort((e,t)=>e.x-t.x)};function pr({view:e,projection:t}){let n=e.waveProfile,r=e.waveMarker,i=e.waveSources??[],a=e.wavePoint,o=e.waveNodes??[],s=e.waveEnvelope,c=e.waveFronts??[],l=e.visible.waveform!==!1;return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`defs`,{children:(0,D.jsx)(A,{uid:t.uid})}),n===void 0?null:(0,D.jsx)(`line`,{className:P.waveEquilibrium,x1:t.px(n.equilibrium.from),y1:t.py(n.equilibrium.from),x2:t.px(n.equilibrium.to),y2:t.py(n.equilibrium.to)}),n===void 0?null:(()=>{let e=t.px(n.equilibrium.from),r=t.py(n.equilibrium.from),i=t.px(n.equilibrium.to),a=t.py(n.equilibrium.to);return n.kind===`string`?(0,D.jsx)(`g`,{"aria-hidden":`true`,children:[e,i].map((e,t)=>(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`rect`,{className:P.waveClamp,x:e-(t===0?9:0),y:(t===0?r:a)-9,width:9,height:18}),[-6,0,6].map(n=>(0,D.jsx)(`line`,{className:P.waveClampHatch,x1:e-(t===0?9:0)+n+7,y1:(t===0?r:a)-9,x2:e-(t===0?9:0)+n,y2:(t===0?r:a)-14},n))]},t))}):(0,D.jsxs)(`g`,{"aria-hidden":`true`,children:[(0,D.jsx)(`rect`,{className:P.waveDriver,x:e-16,y:r-8,width:11,height:16,rx:2}),(0,D.jsx)(`line`,{className:P.waveDriverPin,x1:e-5,y1:r,x2:e,y2:r}),(0,D.jsx)(`text`,{className:P.annotation,x:e-10,y:r+22,textAnchor:`middle`,children:`振源`})]})})(),s===void 0||!l?null:(0,D.jsxs)(`g`,{className:t.highlighted(s.id)?P.highlightGroup:void 0,"aria-hidden":`true`,children:[(0,D.jsx)(`path`,{className:P.waveEnvelope,d:t.path(s.upper)}),(0,D.jsx)(`path`,{className:P.waveEnvelope,d:t.path(s.lower)})]}),c.length===0?null:(0,D.jsx)(`g`,{className:P.waveFrontGroup,"aria-hidden":`true`,children:c.map(e=>(0,D.jsx)(`circle`,{className:P.waveFront,cx:t.px(e.center),cy:t.py(e.center),r:e.radius*t.scale},e.id))}),n===void 0||!l||n.points.length<2?null:(0,D.jsx)(`g`,{className:t.highlighted(n.id)?P.highlightGroup:void 0,children:(0,D.jsx)(`path`,{className:n.kind===`rope`?P.waveRope:P.waveString,d:t.path(n.points)})}),e.dimensions.map(e=>(0,D.jsx)(ye,{dimension:e,projection:t},e.id)),e.visible.nodes===!1?null:o.map(e=>{let n=t.px(e.at),r=t.py(e.at);return(0,D.jsxs)(`g`,{className:t.highlighted(e.id)?P.highlightGroup:void 0,children:[(0,D.jsx)(`circle`,{className:e.kind===`node`?P.waveNode:P.waveAntinode,cx:n,cy:r,r:e.kind===`node`?4.2:3.4}),e.label===void 0?null:(0,D.jsx)(`text`,{className:P.annotation,x:n,y:r-9,textAnchor:`middle`,children:e.label})]},e.id)}),i.map(e=>{let n=t.px(e.at),r=t.py(e.at);return(0,D.jsxs)(`g`,{className:t.highlighted(e.id)?P.highlightGroup:void 0,children:[(0,D.jsx)(`line`,{className:P.waveSourceStem,x1:n,y1:r-5,x2:n,y2:r-15}),(0,D.jsx)(`rect`,{className:P.waveSourceStem,x:n-4,y:r-20,width:8,height:6,rx:1.5}),(0,D.jsx)(`circle`,{className:P.waveSource,cx:n,cy:r,r:5}),(0,D.jsx)(`text`,{className:P.annotation,x:n,y:r+17,textAnchor:`middle`,children:e.label})]},e.id)}),n===void 0||!l||n.points.length<2?null:(0,D.jsx)(`g`,{"aria-hidden":`true`,children:fr(n,o).map(e=>{let n=t.px(e),r=t.py(e);return(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`line`,{className:P.waveMediumGuide,x1:n,y1:t.py({x:e.x,y:e.equilibriumY}),x2:n,y2:r}),(0,D.jsx)(`circle`,{className:N(P.waveMedium,e.atNode&&P.waveMediumNode),cx:n,cy:r,r:e.atNode?2.6:3.2})]},e.x)})}),(0,D.jsx)(j,{vectors:e.vectors.filter(t=>e.visible[t.observable]!==!1),projection:t}),r===void 0||!l?null:(()=>{let e=t.px(r.at),n=t.py(r.at);return(0,D.jsxs)(`g`,{className:t.highlighted(r.id)?P.highlightGroup:void 0,children:[(0,D.jsx)(`line`,{className:P.waveMarkerGuide,x1:e,y1:t.py({x:r.at.x,y:0}),x2:e,y2:n}),(0,D.jsx)(`circle`,{className:P.waveMarker,cx:e,cy:n,r:4.6}),(0,D.jsx)(`text`,{className:P.annotation,x:e+9,y:n-8,children:r.label})]})})(),a===void 0||e.visible.superposition===!1?null:(()=>{let e=t.px(a.at),n=t.py(a.at),r=a.verdict===`constructive`?P.wavePointConstructive:a.verdict===`destructive`?P.wavePointDestructive:P.wavePointPartial;return(0,D.jsxs)(`g`,{className:t.highlighted(a.id)?P.highlightGroup:void 0,children:[(0,D.jsx)(`circle`,{className:N(P.wavePoint,r),cx:e,cy:n,r:6}),(0,D.jsx)(M,{x:e+11,y:n-10,anchor:`start`,symbol:a.readout,className:P.wavePointLabel})]})})()]})}function mr({view:e,projection:t}){let n=e.particles.find(e=>e.id===`modern-cathode`);if(n===void 0)return null;let r=t.px(n.at),i=t.py(n.at),a=55*t.scale,o=`photoelectric-photon-${t.uid}`,s=`photoelectric-electron-${t.uid}`;return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsxs)(`defs`,{children:[(0,D.jsx)(`marker`,{id:o,viewBox:`0 0 8 8`,refX:`7`,refY:`4`,markerWidth:`6`,markerHeight:`6`,orient:`auto`,children:(0,D.jsx)(`path`,{d:`M0 0 L8 4 L0 8 Z`,className:P.modernPhotonHead})}),(0,D.jsx)(`marker`,{id:s,viewBox:`0 0 8 8`,refX:`7`,refY:`4`,markerWidth:`6`,markerHeight:`6`,orient:`auto`,children:(0,D.jsx)(`path`,{d:`M0 0 L8 4 L0 8 Z`,className:P.modernElectronHead})})]}),e.trajectories.map(e=>(0,D.jsx)(`path`,{className:e.kind===`history`?P.modernPhoton:P.modernElectronPath,d:t.path(e.points),markerEnd:`url(#${e.kind===`history`?o:s})`},e.id)),(0,D.jsx)(`rect`,{"data-testid":`photoelectric-cathode`,className:P.modernCathode,x:r-6,y:i-a,width:12,height:a*2,rx:3}),(0,D.jsx)(`line`,{className:P.modernCathodeFace,x1:r-4,y1:i-a+4,x2:r-4,y2:i+a-4}),e.particles.filter(e=>e.id!==n.id).map(e=>(0,D.jsxs)(`g`,{"data-testid":`photoelectric-electron`,children:[(0,D.jsx)(`circle`,{className:P.modernElectron,cx:t.px(e.at),cy:t.py(e.at),r:Math.max(4,e.radius*t.scale)}),(0,D.jsx)(`text`,{className:P.annotation,x:t.px(e.at),y:t.py(e.at)+23,textAnchor:`middle`,children:e.symbol})]},e.id)),e.labels.map(e=>(0,D.jsx)(`text`,{className:P.modernLabel,x:t.px(e.at),y:t.py(e.at),textAnchor:e.anchor,children:e.text},e.id))]})}function hr({view:e,projection:t}){return(0,D.jsx)(D.Fragment,{children:e.trajectories.filter(e=>e.kind===`predicted`&&e.points.length>1).map(e=>{let n=e.points[0],r=e.points[e.points.length-1];return n===void 0||r===void 0?null:(0,D.jsxs)(`linearGradient`,{id:`trajectory-fade-${t.uid}-${e.id}`,gradientUnits:`userSpaceOnUse`,x1:t.px(n),y1:t.py(n),x2:t.px(r),y2:t.py(r),children:[(0,D.jsx)(`stop`,{offset:`0%`,stopColor:`var(--physics-trajectory-predicted)`,stopOpacity:`0.75`}),(0,D.jsx)(`stop`,{offset:`100%`,stopColor:`var(--physics-trajectory-predicted)`,stopOpacity:`0.12`})]},`fade-${e.id}`)})})}function gr(e){return e.view.currentRig===void 0?(0,D.jsx)(_r,{...e}):(0,D.jsx)(Bn,{view:e.view,projection:e.projection})}function _r({view:e,projection:t}){let n=e.field,r=n?.direction===`into-page`?`×`:`·`,i=n===void 0?0:Math.floor(e.extent.width/n.spacing),a=n===void 0?0:Math.floor(e.extent.height/n.spacing),o=n===void 0?[]:Array.from({length:i},(r,i)=>Array.from({length:a},(r,a)=>({x:t.px({x:e.origin.x+n.spacing*(i+.5),y:e.origin.y}),y:t.py({x:e.origin.x,y:e.origin.y+e.extent.height-n.spacing*(a+.5)})}))).flat(),s=e.particles[0],c=`pc-glow-${t.uid}`;return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsxs)(`defs`,{children:[(0,D.jsx)(A,{uid:t.uid}),(0,D.jsx)(hr,{view:e,projection:t}),(0,D.jsxs)(`radialGradient`,{id:c,cx:`34%`,cy:`30%`,r:`72%`,children:[(0,D.jsx)(`stop`,{offset:`0%`,stopColor:s?.sign===`negative`?`#9dc4ff`:`#ffb4a6`}),(0,D.jsx)(`stop`,{offset:`55%`,stopColor:s?.sign===`negative`?`#3b82f6`:`#ea6a5c`}),(0,D.jsx)(`stop`,{offset:`100%`,stopColor:s?.sign===`negative`?`#1d4ed8`:`#c8453a`})]})]}),(0,D.jsx)(`g`,{className:P.fieldGlyph,textAnchor:`middle`,children:o.map(e=>(0,D.jsx)(`text`,{x:e.x,y:e.y,children:r},`${e.x}-${e.y}`))}),e.visible.trajectory===!0?e.trajectories.map(e=>{let n=e.points[Math.floor(e.points.length/4)],r=e.kind===`history`?e.points[e.points.length-1]:void 0;return(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`path`,{className:e.kind===`history`?P.trajectoryHistory:P.trajectoryPredicted,d:t.path(e.points)}),n===void 0||e.direction===void 0?null:(0,D.jsx)(`text`,{className:P.trajectoryDirection,x:t.px(n)+8,y:t.py(n)-8,"aria-label":e.direction===`clockwise`?`轨迹方向：顺时针`:`轨迹方向：逆时针`,children:e.direction===`clockwise`?`↻`:`↺`}),r===void 0?null:(0,D.jsx)(`circle`,{className:P.trajectoryRunner,cx:t.px(r),cy:t.py(r),r:4})]},`${e.id}:${e.kind}`)}):null,e.guides.filter(t=>e.visible[t.observable]===!0).map(e=>(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`line`,{className:P.guideLine,x1:t.px(e.from),y1:t.py(e.from),x2:t.px(e.to),y2:t.py(e.to)}),e.label===void 0?null:(0,D.jsx)(M,{x:(t.px(e.from)+t.px(e.to))/2+6,y:(t.py(e.from)+t.py(e.to))/2-6,anchor:`start`,symbol:e.label,className:P.guideLabel})]},e.id)),e.visible.center===!0&&e.center!==void 0?(0,D.jsx)(`circle`,{className:P.orbitCenter,cx:t.px(e.center),cy:t.py(e.center),r:`3`}):null,(0,D.jsx)(j,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t}),e.particles.map(e=>{let n=t.px(e.at),r=t.py(e.at),i=e.radius*t.scale;return(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`circle`,{cx:n,cy:r,r:i,fill:`url(#${c})`}),(0,D.jsx)(`circle`,{cx:n-i*.3,cy:r-i*.34,r:i*.24,fill:`rgba(255, 255, 255, 0.62)`}),(0,D.jsx)(`text`,{className:N(P.particleLabel,e.sign===`negative`&&P.particleLabelNegative),x:n-i-6,y:r-i-5,textAnchor:`end`,children:e.symbol})]},e.id)})]})}function vr({view:e,projection:t}){let n=e.electricField,r=n?.spacing??0,i=n?.direction.x??0,a=n?.direction.y??0,o=n!==void 0,s=o?Math.max(1,Math.floor(e.extent.width/r)):0,c=o?Math.max(1,Math.floor(e.extent.height/r)):0,l=r*.58,u=(0,_.useMemo)(()=>o?Array.from({length:s},(t,n)=>Array.from({length:c},(t,o)=>{let s={x:e.origin.x+r*(n+.5),y:e.origin.y+r*(o+.5)};return{from:{x:s.x-i*l*.5,y:s.y-a*l*.5},to:{x:s.x+i*l*.5,y:s.y+a*l*.5}}})).flat():[],[l,s,i,a,r,o,c,e.origin.x,e.origin.y]),d=(0,_.useMemo)(()=>e.trajectories.map(e=>({id:e.id,kind:e.kind,path:t.path(e.points)})),[t,e.trajectories]);if(e.pointChargeSources!==void 0)return(0,D.jsx)(yr,{view:e,projection:t});if(e.plates!==void 0)return(0,D.jsx)(br,{view:e,projection:t});let f=e.particles[0],p=`pc-electric-glow-${t.uid}`;return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsxs)(`defs`,{children:[(0,D.jsx)(A,{uid:t.uid}),(0,D.jsx)(hr,{view:e,projection:t}),(0,D.jsxs)(`radialGradient`,{id:p,cx:`34%`,cy:`30%`,r:`72%`,children:[(0,D.jsx)(`stop`,{offset:`0%`,stopColor:f?.sign===`negative`?`#9dc4ff`:`#ffb4a6`}),(0,D.jsx)(`stop`,{offset:`55%`,stopColor:f?.sign===`negative`?`#3b82f6`:`#ea6a5c`}),(0,D.jsx)(`stop`,{offset:`100%`,stopColor:f?.sign===`negative`?`#1d4ed8`:`#c8453a`})]})]}),(0,D.jsx)(`g`,{className:P.electricFieldLattice,"aria-hidden":`true`,children:u.map((e,n)=>(0,D.jsx)(`line`,{x1:t.px(e.from),y1:t.py(e.from),x2:t.px(e.to),y2:t.py(e.to),markerEnd:`url(#${O(`field`,t.uid)})`},n))}),e.visible.trajectory===!0?d.map(e=>(0,D.jsx)(`path`,{className:e.kind===`history`?P.trajectoryHistory:P.trajectoryPredicted,d:e.path,...e.kind===`predicted`?{stroke:`url(#trajectory-fade-${t.uid}-${e.id})`}:{}},`${e.id}:${e.kind}`)):null,(0,D.jsx)(j,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t}),e.visible.trajectory===!0?(()=>{let n=e.trajectories.find(e=>e.kind===`history`),r=n?.points[n.points.length-1];return r===void 0?null:(0,D.jsx)(`circle`,{className:P.trajectoryRunner,cx:t.px(r),cy:t.py(r),r:4})})():null,e.particles.map(e=>{let n=t.px(e.at),r=t.py(e.at),i=e.radius*t.scale;return(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`circle`,{cx:n,cy:r,r:i,fill:`url(#${p})`}),(0,D.jsx)(`circle`,{cx:n-i*.3,cy:r-i*.34,r:i*.24,fill:`rgba(255, 255, 255, 0.62)`}),(0,D.jsx)(`text`,{className:N(P.particleLabel,e.sign===`negative`&&P.particleLabelNegative),x:n-i-6,y:r-i-5,textAnchor:`end`,children:e.symbol})]},e.id)})]})}function yr({view:e,projection:t}){let n=`pc-point-pos-${t.uid}`,r=`pc-point-neg-${t.uid}`,i=e.fieldStreamlines??[],a=e.pointChargeSources??[];return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsxs)(`defs`,{children:[(0,D.jsx)(A,{uid:t.uid}),(0,D.jsx)(hr,{view:e,projection:t}),(0,D.jsxs)(`radialGradient`,{id:n,cx:`34%`,cy:`30%`,r:`72%`,children:[(0,D.jsx)(`stop`,{offset:`0%`,stopColor:`#ffd6cc`}),(0,D.jsx)(`stop`,{offset:`55%`,stopColor:`#ea6a5c`}),(0,D.jsx)(`stop`,{offset:`100%`,stopColor:`#c8453a`})]}),(0,D.jsxs)(`radialGradient`,{id:r,cx:`34%`,cy:`30%`,r:`72%`,children:[(0,D.jsx)(`stop`,{offset:`0%`,stopColor:`#cdddff`}),(0,D.jsx)(`stop`,{offset:`55%`,stopColor:`#3b82f6`}),(0,D.jsx)(`stop`,{offset:`100%`,stopColor:`#1d4ed8`})]})]}),(0,D.jsx)(`g`,{className:P.electricFieldStreamline,"aria-hidden":`true`,children:i.map(e=>{let n=Math.floor(e.points.length/2),r=e.points.slice(0,n+1);return(0,D.jsxs)(`g`,{className:e.sourceId!==void 0&&t.highlighted(e.sourceId)?P.highlightGroup:void 0,children:[(0,D.jsx)(`path`,{className:P.streamlinePath,d:t.path(e.points)}),r.length>=2?(0,D.jsx)(`path`,{className:P.streamlineArrow,d:t.path(r),markerEnd:`url(#${O(`field`,t.uid)})`}):null]},e.id)})}),e.equipotentials===void 0||e.equipotentials.length===0?null:(0,D.jsx)(`g`,{className:P.equipotentials,"aria-hidden":`true`,children:e.equipotentials.map(e=>(0,D.jsx)(`path`,{className:P.equipotentialPath,d:t.path(e.points),...e.closed?{"data-closed":`true`}:{}},e.id))}),(0,D.jsx)(j,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t}),a.map(e=>{let i=t.px(e.at),a=t.py(e.at),o=e.radius*t.scale,s=e.sign===`negative`?r:n;return(0,D.jsxs)(`g`,{className:t.highlighted(e.id)?P.highlightGroup:void 0,children:[(0,D.jsx)(`circle`,{cx:i,cy:a,r:o,fill:`url(#${s})`}),(0,D.jsx)(`circle`,{cx:i-o*.3,cy:a-o*.34,r:o*.24,fill:`rgba(255, 255, 255, 0.62)`}),(0,D.jsx)(`text`,{className:N(P.particleLabel,e.sign===`negative`&&P.particleLabelNegative),x:i,y:a+o+14,textAnchor:`middle`,children:e.sign===`negative`?`−`:`+`})]},e.id)}),e.probe===void 0?null:(()=>{let n=t.px(e.probe.at),r=t.py(e.probe.at);return(0,D.jsx)(`g`,{className:t.highlighted(e.probe.id)?P.highlightGroup:void 0,children:(0,D.jsx)(`circle`,{cx:n,cy:r,r:3.2,className:P.probeDot})},e.probe.id)})()]})}function br({view:e,projection:t}){let n=e.plates??[],r=e.boundedField,i=e.particles[0],a=`pc-region-glow-${t.uid}`,o=`pc-region-clip-${t.uid}`,s=(0,_.useMemo)(()=>{if(r===void 0)return[];let{at:e,width:t,height:n,direction:i,spacing:a}=r,o=e.x-t/2,s=e.y-n/2,c=Math.abs(i.y)>=Math.abs(i.x),l=Math.min(14,Math.max(4,Math.round((c?t:n)/a))),u=Math.min(t,n)*.06;return Array.from({length:l},(e,r)=>{let a=(r+.5)/l;if(c){let e=o+t*a,r=i.y>=0?s:s+n,c=i.y>=0?s+n:s,l=s+n/2,d=i.y>=0?u:-u;return{from:{x:e,y:r},to:{x:e,y:c},arrowFrom:{x:e,y:l-d},arrowTo:{x:e,y:l+d}}}let d=s+n*a,f=i.x>=0?o:o+t,p=i.x>=0?o+t:o,m=o+t/2,h=i.x>=0?u:-u;return{from:{x:f,y:d},to:{x:p,y:d},arrowFrom:{x:m-h,y:d},arrowTo:{x:m+h,y:d}}})},[r]);return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsxs)(`defs`,{children:[(0,D.jsx)(A,{uid:t.uid}),(0,D.jsx)(hr,{view:e,projection:t}),(0,D.jsxs)(`radialGradient`,{id:a,cx:`34%`,cy:`30%`,r:`72%`,children:[(0,D.jsx)(`stop`,{offset:`0%`,stopColor:i?.sign===`negative`?`#9dc4ff`:`#ffb4a6`}),(0,D.jsx)(`stop`,{offset:`55%`,stopColor:i?.sign===`negative`?`#3b82f6`:`#ea6a5c`}),(0,D.jsx)(`stop`,{offset:`100%`,stopColor:i?.sign===`negative`?`#1d4ed8`:`#c8453a`})]}),r===void 0?null:(0,D.jsx)(`clipPath`,{id:o,children:(0,D.jsx)(`rect`,{x:t.px({x:r.at.x-r.width/2,y:0}),y:t.py({x:0,y:r.at.y+r.height/2}),width:r.width*t.scale,height:r.height*t.scale})})]}),r===void 0||e.visible.electricField!==!0||s.length===0?null:(0,D.jsx)(`g`,{className:P.electricFieldLattice,clipPath:`url(#${o})`,"aria-hidden":`true`,children:s.map((e,n)=>(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`line`,{className:P.electricFieldLine,x1:t.px(e.from),y1:t.py(e.from),x2:t.px(e.to),y2:t.py(e.to)}),(0,D.jsx)(`line`,{x1:t.px(e.arrowFrom),y1:t.py(e.arrowFrom),x2:t.px(e.arrowTo),y2:t.py(e.arrowTo),markerEnd:`url(#${O(`field`,t.uid)})`})]},n))}),r===void 0?null:(0,D.jsx)(`rect`,{className:N(P.boundedFieldRegion,P.regionTintElectric),x:t.px({x:r.at.x-r.width/2,y:0}),y:t.py({x:0,y:r.at.y+r.height/2}),width:r.width*t.scale,height:r.height*t.scale}),n.map(e=>{let n=t.px(e.at),r=t.py(e.at),i=e.length*t.scale/2;return(0,D.jsxs)(`g`,{"data-testid":`plate-${e.top?`top`:`bottom`}`,children:[(0,D.jsx)(`rect`,{className:N(P.plateBar,e.top?P.plateTop:P.plateBottom),x:n-i,y:r-2.5,width:i*2,height:5,rx:1.5}),e.sign===void 0?null:(0,D.jsx)(`g`,{"aria-hidden":`true`,children:Array.from({length:Math.max(3,Math.floor(i*2/26))},(t,a)=>(0,D.jsx)(`text`,{className:N(P.plateSignLabel,e.sign===`negative`&&P.particleLabelNegative),x:n-i+(a+.5)*i*2/Math.max(3,Math.floor(i*2/26)),y:r+(e.top?14:-8),textAnchor:`middle`,children:e.sign===`negative`?`−`:`+`},a))})]},e.id)}),e.visible.trajectory===!0?e.trajectories.map(e=>(0,D.jsx)(`path`,{className:e.kind===`history`?P.trajectoryHistory:P.trajectoryPredicted,d:t.path(e.points),...e.kind===`predicted`?{stroke:`url(#trajectory-fade-${t.uid}-${e.id})`}:{}},`${e.id}:${e.kind}`)):null,e.visible.trajectory===!0?(()=>{let n=e.trajectories.find(e=>e.kind===`history`),r=n?.points[n.points.length-1];return r===void 0?null:(0,D.jsx)(`circle`,{className:P.trajectoryRunner,cx:t.px(r),cy:t.py(r),r:4})})():null,(0,D.jsx)(j,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t}),e.particles.map(e=>{let n=t.px(e.at),r=t.py(e.at),i=e.radius*t.scale;return(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`circle`,{cx:n,cy:r,r:i,fill:`url(#${a})`}),(0,D.jsx)(`circle`,{cx:n-i*.3,cy:r-i*.34,r:i*.24,fill:`rgba(255, 255, 255, 0.62)`}),(0,D.jsx)(`text`,{className:N(P.particleLabel,e.sign===`negative`&&P.particleLabelNegative),x:n-i-6,y:r-i-5,textAnchor:`end`,children:e.symbol})]},e.id)})]})}function xr({view:e,projection:t}){let n=e.compositeRegions??[],r=e.particles[0],i=`pc-composite-glow-${t.uid}`,a=e.electricField,o=(0,_.useMemo)(()=>{if(a===void 0)return[];let t=a.spacing,n=Math.max(1,Math.floor(e.extent.width/t)),r=Math.max(1,Math.floor(e.extent.height/t)),i=t*.58,o=[];for(let s=0;s<n;s+=1)for(let n=0;n<r;n+=1){let r={x:e.origin.x+t*(s+.5),y:e.origin.y+t*(n+.5)};o.push({from:{x:r.x-a.direction.x*i*.5,y:r.y-a.direction.y*i*.5},to:{x:r.x+a.direction.x*i*.5,y:r.y+a.direction.y*i*.5}})}return o},[a,e.extent.height,e.extent.width,e.origin.x,e.origin.y]),s=e.field,c=(0,_.useMemo)(()=>{if(s===void 0)return[];let t=s.spacing,n=Math.max(1,Math.floor(e.extent.width/t)),r=Math.max(1,Math.floor(e.extent.height/t)),i=[];for(let a=0;a<n;a+=1)for(let n=0;n<r;n+=1)i.push({x:e.origin.x+t*(a+.5),y:e.origin.y+t*(n+.5)});return i},[s,e.extent.height,e.extent.width,e.origin.x,e.origin.y]),l=(0,_.useMemo)(()=>n.map(e=>{let t=[],n=e.electricField;if(n!==void 0){let r=n.spacing,i=Math.max(1,Math.floor(e.width/r)),a=Math.max(1,Math.floor(e.height/r)),o=r*.58,s=e.at.x-e.width/2,c=e.at.y-e.height/2;for(let e=0;e<i;e+=1)for(let i=0;i<a;i+=1){let a={x:s+r*(e+.5),y:c+r*(i+.5)};t.push({from:{x:a.x-n.direction.x*o*.5,y:a.y-n.direction.y*o*.5},to:{x:a.x+n.direction.x*o*.5,y:a.y+n.direction.y*o*.5}})}}let r=[],i=e.magneticField;if(i!==void 0){let t=i.spacing,n=Math.max(1,Math.floor(e.width/t)),a=Math.max(1,Math.floor(e.height/t)),o=i.direction===`into-page`?`×`:`·`,s=e.at.x-e.width/2,c=e.at.y-e.height/2;for(let e=0;e<n;e+=1)for(let n=0;n<a;n+=1)r.push({at:{x:s+t*(e+.5),y:c+t*(n+.5)},glyph:o})}return{region:e,eArrows:t,bGlyphs:r}}),[n]),u=(0,_.useMemo)(()=>e.trajectories.map(e=>({id:e.id,kind:e.kind,path:t.path(e.points)})),[t,e.trajectories]),d=(0,_.useMemo)(()=>{let e=new Map,n=-1/0,r=0;for(let{region:i}of[...l].sort((e,t)=>e.region.at.x-t.region.at.x)){let a=t.px({x:i.at.x,y:0}),o=t.py({x:0,y:i.at.y+i.height/2})-6;a-n<96&&r-o<14&&(o=r-14),n=a,r=o,e.set(i.id,o)}return e},[l,t]);return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsxs)(`defs`,{children:[(0,D.jsx)(A,{uid:t.uid}),(0,D.jsx)(hr,{view:e,projection:t}),(0,D.jsxs)(`radialGradient`,{id:i,cx:`34%`,cy:`30%`,r:`72%`,children:[(0,D.jsx)(`stop`,{offset:`0%`,stopColor:r?.sign===`negative`?`#9dc4ff`:`#ffb4a6`}),(0,D.jsx)(`stop`,{offset:`55%`,stopColor:r?.sign===`negative`?`#3b82f6`:`#ea6a5c`}),(0,D.jsx)(`stop`,{offset:`100%`,stopColor:r?.sign===`negative`?`#1d4ed8`:`#c8453a`})]})]}),e.visible.magneticField===!0&&s!==void 0&&c.length>0?(0,D.jsx)(`g`,{className:P.fieldGlyph,textAnchor:`middle`,"aria-hidden":`true`,children:c.map((e,n)=>(0,D.jsx)(`text`,{x:t.px(e),y:t.py(e),children:s.direction===`into-page`?`×`:`·`},n))}):null,e.visible.electricField===!0&&o.length>0?(0,D.jsx)(`g`,{className:P.electricFieldLattice,"aria-hidden":`true`,children:o.map((e,n)=>(0,D.jsx)(`line`,{x1:t.px(e.from),y1:t.py(e.from),x2:t.px(e.to),y2:t.py(e.to),markerEnd:`url(#${O(`field`,t.uid)})`},n))}):null,l.map(({region:e,eArrows:n,bGlyphs:r})=>{let i=`pc-composite-clip-${t.uid}-${e.id}`,a=e.at.x-e.width/2,o=e.at.y+e.height/2,s=t.highlighted(e.id),c=e.electricField!==void 0&&e.magneticField!==void 0?P.regionTintCrossed:e.magneticField===void 0?e.electricField===void 0?void 0:P.regionTintElectric:P.regionTintMagnetic;return(0,D.jsxs)(`g`,{className:s?P.highlightGroup:void 0,children:[(0,D.jsx)(`clipPath`,{id:i,children:(0,D.jsx)(`rect`,{x:t.px({x:a,y:0}),y:t.py({x:0,y:o}),width:e.width*t.scale,height:e.height*t.scale})}),(0,D.jsx)(`rect`,{className:N(P.boundedFieldRegion,c),x:t.px({x:a,y:0}),y:t.py({x:0,y:o}),width:e.width*t.scale,height:e.height*t.scale}),n.length>0?(0,D.jsx)(`g`,{className:P.electricFieldLattice,clipPath:`url(#${i})`,"aria-hidden":`true`,children:n.map((e,n)=>(0,D.jsx)(`line`,{x1:t.px(e.from),y1:t.py(e.from),x2:t.px(e.to),y2:t.py(e.to),markerEnd:`url(#${O(`field`,t.uid)})`},n))}):null,r.length>0?(0,D.jsx)(`g`,{className:P.fieldGlyph,textAnchor:`middle`,clipPath:`url(#${i})`,"aria-hidden":`true`,children:r.map((e,n)=>(0,D.jsx)(`text`,{x:t.px(e.at),y:t.py(e.at),children:e.glyph},n))}):null,(0,D.jsx)(`text`,{className:P.annotation,x:t.px({x:e.at.x,y:0}),y:d.get(e.id)??t.py({x:0,y:o})-6,textAnchor:`middle`,children:e.label})]},e.id)}),e.visible.trajectory===!0?u.map(e=>(0,D.jsx)(`path`,{className:e.kind===`history`?P.trajectoryHistory:P.trajectoryPredicted,d:e.path},`${e.id}:${e.kind}`)):null,(0,D.jsx)(j,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t}),e.particles.map(e=>{let n=t.px(e.at),r=t.py(e.at),a=e.radius*t.scale;return(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`circle`,{cx:n,cy:r,r:a,fill:`url(#${i})`}),(0,D.jsx)(`circle`,{cx:n-a*.3,cy:r-a*.34,r:a*.24,fill:`rgba(255, 255, 255, 0.62)`}),(0,D.jsx)(`text`,{className:N(P.particleLabel,e.sign===`negative`&&P.particleLabelNegative),x:n-a-6,y:r-a-5,textAnchor:`end`,children:e.symbol})]},e.id)})]})}function Sr({view:e,projection:t}){return e.leverBeam===void 0?e.energyRamp===void 0?(0,D.jsxs)(D.Fragment,{children:[(0,D.jsxs)(`defs`,{children:[(0,D.jsx)(A,{uid:t.uid}),(0,D.jsx)(hr,{view:e,projection:t})]}),e.incline===void 0?null:(0,D.jsx)(fe,{incline:e.incline,projection:t}),e.platform===void 0?null:(0,D.jsx)(pe,{platform:e.platform,projection:t}),e.ground===void 0?null:(0,D.jsx)(de,{ground:e.ground,projection:t}),e.apparatus?.map(e=>(0,D.jsx)(ge,{sprite:e,projection:t},e.id)),e.spring===void 0?null:(0,D.jsx)(me,{spring:e.spring,projection:t}),e.pendulum===void 0?null:(0,D.jsx)(he,{pendulum:e.pendulum,projection:t}),e.motionMarks===void 0||e.visible.trajectory!==!0?null:(0,D.jsx)(be,{marks:e.motionMarks,projection:t}),e.visible.trajectory===!0?e.trajectories.map(e=>(0,D.jsx)(`path`,{className:e.kind===`history`?P.trajectoryHistory:P.trajectoryPredicted,d:t.path(e.points)},`${e.id}:${e.kind}`)):null,e.dimensions.map(e=>(0,D.jsx)(ye,{dimension:e,projection:t},e.id)),e.angles.map(e=>(0,D.jsx)(ve,{angle:e,projection:t},e.id)),e.coordinate===void 0?null:(0,D.jsx)(Se,{coordinate:e.coordinate,projection:t}),e.guides.filter(t=>e.visible[t.observable]===!0).map(e=>(0,D.jsx)(`line`,{className:P.guideLine,x1:t.px(e.from),y1:t.py(e.from),x2:t.px(e.to),y2:t.py(e.to)},e.id)),e.visible.keyPoints===!0?e.keyPoints.map(e=>(0,D.jsx)(xe,{keyPoint:e,projection:t},e.id)):null,(0,D.jsx)(j,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t}),e.bodies.map(e=>(0,D.jsx)(_e,{body:e,projection:t},e.id)),e.labels.map(e=>(0,D.jsx)(M,{x:t.px(e.at),y:t.py(e.at),anchor:e.anchor??`middle`,symbol:e.text,className:N(P.annotation,e.role===void 0?void 0:ue(e.role))},e.id))]}):(0,D.jsx)(Hn,{view:e,projection:t}):(0,D.jsx)(ur,{view:e,projection:t})}function Cr(e){return e.view.lightRig!==void 0||e.view.lightRefraction!==void 0?(0,D.jsx)(Un,{view:e.view,projection:e.projection}):(0,D.jsx)(Qn,{...e})}function wr(e){return e.view.transformerCoils===void 0?(0,D.jsx)(Jn,{...e}):(0,D.jsx)(Gn,{view:e.view,projection:e.projection})}function Tr(e){return e.view.thermometer===void 0?(0,D.jsx)(rr,{...e}):(0,D.jsx)(ar,{view:e.view,projection:e.projection})}function Er(e){return e.view.noiseRig===void 0?(0,D.jsx)(Ee,{...e}):(0,D.jsx)(cr,{view:e.view,projection:e.projection})}const Dr={magnetic:gr,mechanics:Sr,electric:vr,circuit:An,composite:xr,optics:Cr,acoustics:Er,fluid:Nn,thermal:Tr,induction:wr,wave:pr,modern:mr};if(typeof document<`u`){let e=document.createElement(`style`);e.textContent=`._9mHjaq_host {
  width: 100%;
  min-width: 0;
  height: 100%;
  min-height: 0;
  color: var(--physics-canvas-text);
  background: var(--physics-canvas-bg);
  display: flex;
  position: relative;
}

._9mHjaq_root {
  font-variant-numeric: tabular-nums;
  width: 100%;
  height: 100%;
  display: block;
}

._9mHjaq_interactive {
  cursor: crosshair;
}

._9mHjaq_plot {
  fill: var(--physics-canvas-bg);
}

._9mHjaq_ballHighlight {
  stop-color: #fff;
}

._9mHjaq_ballMid {
  stop-color: var(--physics-body-fill);
}

._9mHjaq_ballShade {
  stop-color: color-mix(in srgb, var(--physics-body-fill) 62%, var(--physics-body-stroke));
}

._9mHjaq_strobe {
  pointer-events: none;
}

._9mHjaq_strobeBody {
  fill: var(--physics-body-fill);
  stroke: var(--physics-body-live);
  stroke-width: 1px;
}

._9mHjaq_gridMinor {
  stroke: var(--physics-grid-minor);
  stroke-width: .65px;
  opacity: .65;
}

._9mHjaq_gridMajor {
  stroke: var(--physics-grid-major);
  stroke-width: .9px;
  opacity: .8;
}

._9mHjaq_axis {
  stroke: var(--physics-axis);
  stroke-width: 1.1px;
}

._9mHjaq_tick {
  stroke: var(--physics-axis);
  stroke-width: 1px;
}

._9mHjaq_tickLabel {
  fill: var(--physics-canvas-text-muted);
  font-variant-numeric: tabular-nums;
  font-size: 11.5px;
}

._9mHjaq_axisLabel {
  fill: var(--physics-canvas-text-muted);
  font-size: 12.5px;
  font-style: italic;
}

._9mHjaq_readoutPanel {
  fill: var(--physics-canvas-bg);
  stroke: color-mix(in srgb, var(--physics-axis) 32%, var(--physics-canvas-bg));
  stroke-width: 1px;
  filter: drop-shadow(0 2px 4px color-mix(in srgb, var(--physics-canvas-text) 9%, transparent));
}

._9mHjaq_readoutTitle {
  fill: var(--physics-canvas-text);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  font-weight: 600;
}

._9mHjaq_readoutLine {
  fill: color-mix(in srgb, var(--physics-canvas-text) 78%, var(--physics-canvas-text-muted));
  font-variant-numeric: tabular-nums;
  font-size: 11.5px;
}

._9mHjaq_readoutDraggable {
  cursor: grab;
  touch-action: none;
}

._9mHjaq_readoutDragging {
  cursor: grabbing;
}

._9mHjaq_scaleBar {
  stroke: var(--physics-measurement);
  stroke-width: 1.1px;
}

._9mHjaq_scaleLabel {
  fill: var(--physics-canvas-text-muted);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
}

._9mHjaq_effects {
  pointer-events: none;
}

._9mHjaq_effect, ._9mHjaq_effectImpact {
  --effect-ink: var(--physics-keypoint-impact);
}

._9mHjaq_effectBoundary {
  --effect-ink: var(--physics-field);
}

._9mHjaq_effectMark {
  --effect-ink: var(--physics-keypoint-apex);
}

._9mHjaq_effectRing {
  fill: none;
  stroke: var(--effect-ink);
  stroke-width: 1.8px;
  transform-box: fill-box;
  transform-origin: center;
  animation: _9mHjaq_physics-burst-ring .72s var(--physics-ease-emphasized) both;
}

._9mHjaq_effectRingLate {
  stroke-width: 1.1px;
  animation-duration: .9s;
  animation-delay: 90ms;
}

._9mHjaq_effectBoundary ._9mHjaq_effectRing {
  stroke-dasharray: 3 3;
  animation-name: _9mHjaq_physics-burst-ring-wide;
}

._9mHjaq_effectMark ._9mHjaq_effectRing {
  animation-duration: .56s;
}

._9mHjaq_effectCore {
  fill: var(--effect-ink);
  transform-box: fill-box;
  transform-origin: center;
  animation: _9mHjaq_physics-burst-core .42s var(--physics-ease-emphasized) both;
}

._9mHjaq_effectRay {
  stroke: var(--effect-ink);
  stroke-width: 1.6px;
  stroke-linecap: round;
  transform-box: fill-box;
  transform-origin: 50% 100%;
  animation: _9mHjaq_physics-burst-ray .52s var(--physics-ease-emphasized) both;
}

@keyframes _9mHjaq_physics-burst-ring {
  0% {
    opacity: .95;
    transform: scale(.4);
  }

  100% {
    opacity: 0;
    transform: scale(5.2);
  }
}

@keyframes _9mHjaq_physics-burst-ring-wide {
  0% {
    opacity: .7;
    transform: scale(.6);
  }

  100% {
    opacity: 0;
    transform: scale(6);
  }
}

@keyframes _9mHjaq_physics-burst-core {
  0% {
    opacity: 1;
    transform: scale(.6);
  }

  40% {
    opacity: .9;
    transform: scale(1.9);
  }

  100% {
    opacity: 0;
    transform: scale(.8);
  }
}

@keyframes _9mHjaq_physics-burst-ray {
  0% {
    opacity: .95;
    transform: translateY(-2px) scaleY(.2);
  }

  55% {
    opacity: .85;
    transform: translateY(-12px) scaleY(1.1);
  }

  100% {
    opacity: 0;
    transform: translateY(-22px) scaleY(.5);
  }
}

@media (prefers-reduced-motion: reduce) {
  ._9mHjaq_effectRing, ._9mHjaq_effectRingLate, ._9mHjaq_effectCore, ._9mHjaq_effectRay {
    opacity: 0;
    animation: none;
  }
}

._9mHjaq_tooltip {
  z-index: 3;
  border: 1px solid var(--physics-grid-major);
  background: color-mix(in srgb, var(--physics-canvas-bg) 97%, transparent);
  pointer-events: none;
  white-space: nowrap;
  border-radius: 7px;
  gap: 1px;
  padding: 6px 8px;
  display: grid;
  position: absolute;
  transform: translate(10px, -50%);
  box-shadow: 0 4px 14px #14213d1f;
}

._9mHjaq_tooltipRow {
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  font-size: 12px;
  line-height: 17px;
  display: flex;
}

._9mHjaq_tooltipLabel {
  color: var(--physics-canvas-text-muted);
  font-style: italic;
}

._9mHjaq_tooltipValue {
  color: var(--physics-canvas-text);
  font-variant-numeric: tabular-nums;
}

._9mHjaq_tickLabel, ._9mHjaq_axisLabel, ._9mHjaq_scaleLabel {
  paint-order: stroke fill;
  stroke: var(--physics-canvas-bg);
  stroke-width: 3px;
  stroke-linejoin: round;
}
`,document.head.appendChild(e)}var q={axis:`_9mHjaq_axis`,axisLabel:`_9mHjaq_axisLabel`,ballHighlight:`_9mHjaq_ballHighlight`,ballMid:`_9mHjaq_ballMid`,ballShade:`_9mHjaq_ballShade`,effect:`_9mHjaq_effect`,effectBoundary:`_9mHjaq_effectBoundary`,effectCore:`_9mHjaq_effectCore`,effectImpact:`_9mHjaq_effectImpact`,effectMark:`_9mHjaq_effectMark`,effectRay:`_9mHjaq_effectRay`,effectRing:`_9mHjaq_effectRing`,effectRingLate:`_9mHjaq_effectRingLate`,effects:`_9mHjaq_effects`,gridMajor:`_9mHjaq_gridMajor`,gridMinor:`_9mHjaq_gridMinor`,host:`_9mHjaq_host`,interactive:`_9mHjaq_interactive`,"physics-burst-core":`_9mHjaq_physics-burst-core`,"physics-burst-ray":`_9mHjaq_physics-burst-ray`,"physics-burst-ring":`_9mHjaq_physics-burst-ring`,"physics-burst-ring-wide":`_9mHjaq_physics-burst-ring-wide`,plot:`_9mHjaq_plot`,readoutDraggable:`_9mHjaq_readoutDraggable`,readoutDragging:`_9mHjaq_readoutDragging`,readoutLine:`_9mHjaq_readoutLine`,readoutPanel:`_9mHjaq_readoutPanel`,readoutTitle:`_9mHjaq_readoutTitle`,root:`_9mHjaq_root`,scaleBar:`_9mHjaq_scaleBar`,scaleLabel:`_9mHjaq_scaleLabel`,strobe:`_9mHjaq_strobe`,strobeBody:`_9mHjaq_strobeBody`,tick:`_9mHjaq_tick`,tickLabel:`_9mHjaq_tickLabel`,tooltip:`_9mHjaq_tooltip`,tooltipLabel:`_9mHjaq_tooltipLabel`,tooltipRow:`_9mHjaq_tooltipRow`,tooltipValue:`_9mHjaq_tooltipValue`};const Or=e=>(e.codePointAt(0)>11904?1:.62)*11.5;function kr(e,t){if(e.length===0)return{lines:[],width:0,height:0};let n=Math.max(12,t-24),r=[],i=0;return e.forEach((e,t)=>{let a=``,o=0;for(let s of e){let e=Or(s);a.length>0&&o+e>n&&(r.push({text:a,title:t===0}),i=Math.max(i,o),a=``,o=0),a+=s,o+=e}r.push({text:a,title:t===0}),i=Math.max(i,o)}),{lines:r,width:i+24,height:20+r.length*16}}function Ar(e){let t;try{t=e.getData(`application/x-physicsos-circuit-part`)}catch{return}return fn.some(e=>e.id===t)?t:void 0}const J={left:46,bottom:36,top:18,right:24},jr={width:720,height:405},Mr=[0,45,90,135,180,225,270,315];function Nr({view:e,ariaLabel:t,showReadout:n=!0,trajectoryTimes:r,sampleReadout:i,onSeekTime:a,componentDrag:o,componentControl:s,componentWiring:c,componentSelection:l,onDropPart:u,effects:d,clockTime:f}){let p=(0,_.useId)().replace(/:/g,``),m=(0,_.useRef)(null),h=(0,_.useRef)(null),[g,v]=(0,_.useState)(null),[y,ee]=(0,_.useState)({width:jr.width+J.left+J.right,height:jr.height+J.top+J.bottom}),[te,x]=(0,_.useState)(void 0),[ne,re]=(0,_.useState)(J.top+8),S=(0,_.useRef)(null),[ie,C]=(0,_.useState)(!1),ae=(0,_.useRef)(!1);(0,_.useEffect)(()=>{let e=h.current;if(e===null||typeof ResizeObserver>`u`)return;let t=e.closest(`[data-physicsos-surface], [data-physicsos-canvas-workspace]`)?.querySelector(`:scope > header`),n=()=>{let n=e.getBoundingClientRect();if(n.width<1||n.height<1)return;let r=t?.getBoundingClientRect();re(r!==void 0&&r.width>0&&r.height>0?Math.max(J.top+8,r.bottom-n.top+12):J.top+8),ee(e=>Math.abs(e.width-n.width)<.5&&Math.abs(e.height-n.height)<.5?e:{width:n.width,height:n.height})};n();let r=new ResizeObserver(n);return r.observe(e),t!=null&&r.observe(t),()=>{r.disconnect()}},[]);let oe={width:Math.max(120,y.width-J.left-J.right),height:Math.max(90,y.height-J.top-J.bottom)},w=(0,_.useMemo)(()=>{let t=oe.width/Math.max(e.extent.width,1e-6),n=oe.height/Math.max(e.extent.height,1e-6);return Math.min(t,n)},[oe.width,oe.height,e.extent.width,e.extent.height]),T=oe.width,se=oe.height,E=(T-e.extent.width*w)/2,ce=(se-e.extent.height*w)/2,le=T+J.left+J.right,ue=se+J.top+J.bottom,O=J.top+se-ce,k=(0,_.useMemo)(()=>{let t=t=>J.left+E+(t.x-e.origin.x)*w,n=t=>O-(t.y-e.origin.y)*w;return{px:t,py:n,sx:t=>e.origin.x+(t-J.left-E)/w,sy:t=>e.origin.y+(O-t)/w,scale:w,uid:p,path:e=>e.map((e,r)=>`${r===0?`M`:`L`}${t(e).toFixed(2)} ${n(e).toFixed(2)}`).join(` `),highlighted:t=>e.highlighted?.includes(t)===!0}},[w,E,O,p,e.origin.x,e.origin.y,e.highlighted]),A=e.grid.minor*w,de=e.grid.major*w,fe=`pc-minor-${p}`,pe=`pc-major-${p}`,me=`pc-clip-${p}`,he=(0,_.useMemo)(()=>{let t=e.tickStep;if(t===void 0||t<=0)return{x:[],y:[]};let n=[],r=[],i=t<1?Math.max(1,-Math.floor(Math.log10(t))):0,a=e.origin.x+e.extent.width,o=e.origin.y+e.extent.height,s=e.tickLabelAvoid,c=(e,t)=>t!==void 0&&e>t[0]&&e<t[1]?``:e.toFixed(i);for(let r=Math.ceil(e.origin.x/t)*t;r<=a+1e-9;r+=t)n.push({at:k.px({x:r,y:0}),label:c(r,s?.x)});for(let n=Math.ceil(e.origin.y/t)*t;n<=o+1e-9;n+=t)r.push({at:k.py({x:0,y:n}),label:c(n,s?.y)});return{x:n,y:r}},[e.tickStep,e.tickLabelAvoid,e.extent.width,e.extent.height,e.origin.x,e.origin.y,k]),ge=Math.min(J.left+T,Math.max(J.left,k.px({x:0,y:0}))),_e=Math.min(O,Math.max(J.top,k.py({x:0,y:0}))),j=(0,_.useMemo)(()=>{let t=e.trajectories[0];if(t===void 0)return;let n=e.trajectories.filter(e=>e.id===t.id),r=[...n.filter(e=>e.kind===`history`).flatMap(e=>e.points),...n.filter(e=>e.kind===`predicted`).flatMap(e=>e.points)];return{id:t.id,points:r}},[e.trajectories]),M=j!==void 0&&r!==void 0&&r.length===j.points.length,ve=(0,_.useCallback)(e=>{if(j===void 0)return null;let t=m.current,n=t===null?void 0:pn(t,e);if(n===void 0)return null;let r=-1,i=1/0;return j.points.forEach((e,t)=>{let a=Math.hypot(k.px(e)-n.x,k.py(e)-n.y);a<i&&(i=a,r=t)}),i<=26?r:null},[j,k]),ye=(0,_.useCallback)(e=>{if(S.current!==null||!M)return;let t=ve(e);if(t===null){v(null);return}let n=j.points[t],a=r[t];n===void 0||a===void 0||v({time:a,screen:{xRatio:k.px(n)/le,yRatio:k.py(n)/ue},rows:i?.(t)??[]})},[M,j,r,ve,k,le,ue,i]),be=(0,_.useCallback)(e=>{if(ae.current){ae.current=!1;return}if(!M||a===void 0)return;let t=ve(e);if(t===null)return;let n=r[t];n!==void 0&&a(n)},[M,r,a,ve]),xe=Dr[e.domain],Se=(0,_.useMemo)(()=>{if(!M||f===void 0)return[];let t=e.bodies.find(e=>e.live===!0),n=e.particles[0],i=t===void 0?n===void 0?0:n.radius*w:t.size*w;if(i<=0)return[];let a=r[r.length-1]??0;if(a<=0)return[];let o=a/12,s=[],c=o;for(let[e,n]of r.entries()){if(n>f+1e-9)break;if(n+1e-9<c)continue;let r=j.points[e];r!==void 0&&(s.push({x:k.px(r),y:k.py(r),r:i,kind:t===void 0?`particle`:t.kind,rotation:t?.rotation??0}),c+=o)}return s},[M,f,e.bodies,e.particles,w,r,j,k]),N=kr(e.overlay.readout,T-24),P=N.width,Ce=N.height,we=Math.max(4,Math.min(ne,ue-Ce-4)),Te=te===void 0?{x:J.left+8,y:we}:{x:Math.min(Math.max(te.x,4),le-P-4),y:Math.max(we,Math.min(te.y,ue-Ce-4))},Ee=e=>{let t=m.current;return t===null?void 0:pn(t,e)},De=e=>{let t=Ee(e);t!==void 0&&(typeof e.currentTarget.setPointerCapture==`function`&&e.currentTarget.setPointerCapture(e.pointerId),S.current={pointerId:e.pointerId,grabX:t.x-Te.x,grabY:t.y-Te.y,downX:t.x,downY:t.y,moved:!1},e.stopPropagation())},Oe=e=>{let t=S.current;if(t===null||e.pointerId!==t.pointerId)return;let n=Ee(e);if(n!==void 0){if(!t.moved){if(Math.hypot(n.x-t.downX,n.y-t.downY)<2)return;t.moved=!0,C(!0)}x({x:Math.min(Math.max(n.x-t.grabX,4),le-P-4),y:Math.max(we,Math.min(n.y-t.grabY,ue-Ce-4))}),e.stopPropagation()}},F=e=>{let t=S.current;t===null||e.pointerId!==t.pointerId||(S.current=null,C(!1),ae.current=!0)},ke=e=>{S.current?.pointerId===e.pointerId&&(S.current=null,C(!1))};return(0,D.jsxs)(`div`,{className:q.host,ref:h,children:[(0,D.jsxs)(`svg`,{ref:m,className:(0,b.default)(q.root,M&&q.interactive),viewBox:`0 0 ${le.toFixed(1)} ${ue.toFixed(1)}`,preserveAspectRatio:`xMidYMid meet`,fill:`none`,role:`img`,"aria-label":t,onMouseMove:ye,onMouseLeave:()=>{v(null)},onClick:be,onDragOver:t=>{e.domain!==`circuit`||u===void 0||!Array.from(t.dataTransfer.types).includes(`application/x-physicsos-circuit-part`)||(t.preventDefault(),t.stopPropagation(),t.dataTransfer.dropEffect=`copy`)},onDrop:t=>{if(e.domain!==`circuit`||u===void 0)return;let n=Ar(t.dataTransfer);if(n===void 0)return;t.preventDefault(),t.stopPropagation();let r=pn(t.currentTarget,t);if(r===void 0||r.x<J.left||r.x>J.left+T||r.y<J.top||r.y>J.top+se)return;let i={x:k.sx(r.x),y:k.sy(r.y)};Number.isFinite(i.x)&&Number.isFinite(i.y)&&u(n,i)},onKeyDown:e=>{e.key!==`Escape`||e.defaultPrevented||e.nativeEvent.isComposing||c?.pending===void 0||c.cancel===void 0||(e.preventDefault(),e.stopPropagation(),c.cancel())},children:[(0,D.jsxs)(`defs`,{children:[(0,D.jsx)(`pattern`,{id:fe,width:A,height:A,patternUnits:`userSpaceOnUse`,children:(0,D.jsx)(`path`,{d:`M${A} 0H0V${A}`,fill:`none`,className:q.gridMinor})}),(0,D.jsx)(`pattern`,{id:pe,width:de,height:de,patternUnits:`userSpaceOnUse`,children:(0,D.jsx)(`path`,{d:`M${de} 0H0V${de}`,fill:`none`,className:q.gridMajor})}),(0,D.jsx)(`clipPath`,{id:me,children:(0,D.jsx)(`rect`,{x:J.left,y:J.top,width:T,height:se})}),(0,D.jsxs)(`radialGradient`,{id:`pc-ball-${p}`,cx:`36%`,cy:`32%`,r:`72%`,children:[(0,D.jsx)(`stop`,{offset:`0%`,className:q.ballHighlight}),(0,D.jsx)(`stop`,{offset:`55%`,className:q.ballMid}),(0,D.jsx)(`stop`,{offset:`100%`,className:q.ballShade})]})]}),(0,D.jsx)(`rect`,{x:J.left,y:J.top,width:T,height:se,className:q.plot}),(0,D.jsx)(`rect`,{x:J.left,y:J.top,width:T,height:se,fill:`url(#${fe})`,opacity:`0.7`}),(0,D.jsx)(`rect`,{x:J.left,y:J.top,width:T,height:se,fill:`url(#${pe})`,opacity:`0.38`}),e.axes.x.length===0?null:(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`line`,{className:q.axis,x1:J.left,y1:_e,x2:J.left+T,y2:_e}),he.x.map(e=>(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`line`,{className:q.tick,x1:e.at,y1:_e,x2:e.at,y2:_e+4}),e.label===``?null:(0,D.jsx)(`text`,{className:q.tickLabel,x:e.at,y:_e+15,textAnchor:`middle`,children:e.label})]},`tx-${e.at}`)),(0,D.jsx)(`text`,{className:q.axisLabel,x:J.left+T,y:Math.min(O+29,_e+29),textAnchor:`end`,children:e.axes.x})]}),e.axes.y.length===0?null:(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`line`,{className:q.axis,x1:ge,y1:O,x2:ge,y2:J.top}),he.y.map(e=>(0,D.jsxs)(`g`,{children:[(0,D.jsx)(`line`,{className:q.tick,x1:ge-4,y1:e.at,x2:ge,y2:e.at}),e.label===``?null:(0,D.jsx)(`text`,{className:q.tickLabel,x:ge-7,y:e.at+3.4,textAnchor:`end`,children:e.label})]},`ty-${e.at}`)),(0,D.jsx)(`text`,{className:q.axisLabel,x:Math.min(ge+8,J.left+T-36),y:J.top+12,textAnchor:`start`,children:e.axes.y})]}),Se.length===0?null:(0,D.jsx)(`g`,{clipPath:`url(#${me})`,className:q.strobe,"aria-hidden":`true`,children:Se.map((e,t)=>e.kind===`block`||e.kind===`cart`?(0,D.jsx)(`rect`,{className:q.strobeBody,x:e.x-e.r,y:e.y-e.r,width:e.r*2,height:e.r*2,rx:e.r*.18,transform:e.rotation===0?void 0:`rotate(${-e.rotation} ${e.x} ${e.y})`,style:{opacity:.16+t/Math.max(1,Se.length)*.22}},t):(0,D.jsx)(`circle`,{className:q.strobeBody,cx:e.x,cy:e.y,r:e.r,style:{opacity:.16+t/Math.max(1,Se.length)*.22}},t))}),(0,D.jsx)(`g`,{clipPath:e.domain===`circuit`&&c!==void 0?void 0:`url(#${me})`,children:(0,D.jsx)(xe,{view:e,projection:k,...f===void 0?{}:{time:f},...o===void 0?{}:{componentDrag:o},...s===void 0?{}:{componentControl:s},...c===void 0?{}:{componentWiring:c},...l===void 0?{}:{componentSelection:l}})}),d===void 0||d.length===0?null:(0,D.jsx)(`g`,{clipPath:`url(#${me})`,className:q.effects,"aria-hidden":`true`,children:d.map(e=>{let t=k.px(e.at),n=k.py(e.at),r=e.kind===`impact`?q.effectImpact:e.kind===`boundary`?q.effectBoundary:q.effectMark;return(0,D.jsxs)(`g`,{className:(0,b.default)(q.effect,r),"data-physicsos-effect":e.kind,children:[(0,D.jsx)(`circle`,{className:q.effectRing,cx:t,cy:n,r:`6`}),(0,D.jsx)(`circle`,{className:(0,b.default)(q.effectRing,q.effectRingLate),cx:t,cy:n,r:`6`}),(0,D.jsx)(`circle`,{className:q.effectCore,cx:t,cy:n,r:`3`}),e.kind===`impact`?Mr.map(e=>(0,D.jsx)(`g`,{transform:`rotate(${e} ${t.toFixed(2)} ${n.toFixed(2)})`,children:(0,D.jsx)(`line`,{className:q.effectRay,x1:t,y1:n-4,x2:t,y2:n-12})},e)):null]},e.key)})}),!n||e.overlay.readout.length===0?null:(0,D.jsxs)(`g`,{"data-physics-readout":`overlay`,className:(0,b.default)(q.readoutDraggable,ie?q.readoutDragging:void 0),onPointerDown:De,onPointerMove:Oe,onPointerUp:F,onPointerCancel:ke,children:[(0,D.jsx)(`title`,{children:`拖动调整读数卡片位置`}),(0,D.jsx)(`rect`,{className:q.readoutPanel,x:Te.x,y:Te.y,width:P,height:Ce,rx:`8`}),N.lines.map((e,t)=>(0,D.jsx)(`text`,{className:e.title?q.readoutTitle:q.readoutLine,x:Te.x+12,y:Te.y+19+t*16,children:e.text},t))]}),(0,D.jsx)(`g`,{children:e.overlay.scale.label.length===0||e.axes.x.length===0&&e.axes.y.length===0?null:(()=>{let t=e.overlay.scale.length*w,n=J.left+T-18,r=n-t,i=O-16;return(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`line`,{className:q.scaleBar,x1:r,y1:i,x2:n,y2:i}),(0,D.jsx)(`line`,{className:q.scaleBar,x1:r,y1:i-4,x2:r,y2:i+4}),(0,D.jsx)(`line`,{className:q.scaleBar,x1:n,y1:i-4,x2:n,y2:i+4}),(0,D.jsx)(`text`,{className:q.scaleLabel,x:n,y:i-7,textAnchor:`end`,children:e.overlay.scale.label})]})})()})]}),g===null?null:(0,D.jsx)(`div`,{className:q.tooltip,style:{left:`${g.screen.xRatio*100}%`,top:`${g.screen.yRatio*100}%`},role:`status`,children:g.rows.map(e=>(0,D.jsxs)(`span`,{className:q.tooltipRow,children:[(0,D.jsx)(`span`,{className:q.tooltipLabel,children:e.label}),(0,D.jsx)(`span`,{className:q.tooltipValue,children:e.value})]},e.label))})]})}function Pr(){document.head.querySelector(`style[data-physicsos-chrome]`)?.remove();let e=document.createElement(`style`);return e.setAttribute(`data-physicsos-chrome`,``),e.textContent=`
:root {
  /* ---------- vectors ---------- */
  --physics-vector-velocity: #2f9e5a;
  --physics-vector-velocity-soft: #7cc59a;
  --physics-vector-force: #2563eb;
  --physics-vector-force-soft: #93b8f5;
  --physics-vector-electric-force: #2563eb;
  --physics-vector-magnetic-force: #3b5bdb;
  --physics-vector-acceleration: #d97706;
  --physics-vector-acceleration-soft: #f0b775;
  --physics-vector-gravity: #475f8a;
  --physics-vector-normal: #1d4ed8;
  --physics-vector-friction: #b4553f;
  --physics-vector-spring: #b06f2e;
  --physics-vector-tension: #7c6bd9;
  --physics-vector-net-force: #1e40af;

  /* ---------- geometry ---------- */
  --physics-trajectory: #2563eb;
  --physics-trajectory-predicted: #9cbdf2;
  --physics-field: #7d93b8;
  --physics-measurement: #7c8ba5;
  --physics-measurement-soft: #b9c4d4;
  --physics-angle: #5b7bb8;

  /* ---------- surfaces ---------- */
  /* The sheet is the experiment packages' paper, so a host-drawn bench and a
     package bench read as the same notebook. */
  --physics-canvas-bg: #fdfcf8;
  /* Canvas ink stays paired with the fixed light canvas, including dark hosts. */
  --physics-canvas-text: #26332b;
  --physics-canvas-text-muted: #5b6a60;
  --physics-grid-minor: #ecebe2;
  --physics-grid-major: #dedcd0;
  --physics-axis: #a3a697;
  --physics-body-fill: #e3ebe1;
  --physics-body-stroke: #3a5444;
  --physics-body-live: #2563eb;
  --physics-surface-hatch: #c8c4b4;
  --physics-incline-fill: #f2efe4;

  /* ---------- key points ---------- */
  --physics-keypoint-launch: #2f9e5a;
  --physics-keypoint-apex: #d97706;
  --physics-keypoint-impact: #c2413a;

  /* ---------- optics ----------
     Light itself is warm amber; the computed image carries violet so "where the
     rays (or their extensions) meet" is findable against the amber paths. */
  --physics-optics-ray: #d97706;
  --physics-optics-ray-soft: #edba6f;
  --physics-optics-image: #7c3aed;

  /* ---------- acoustics ----------
     Sound is sky blue: the travelling pulse solid, its trailing wavefront arcs
     and the out/return path guides in the soft shade. */
  --physics-acoustics-wave: #0284c7;
  --physics-acoustics-wave-soft: #7cc3e8;

  /* ---------- fluid statics ----------
     Water is teal so it never reads as the sky-blue sound pulse: the liquid
     body and the submerged slab in the solid shade, the surface line soft. */
  --physics-fluid-liquid: #0d9488;
  --physics-fluid-liquid-soft: #cdeeea;

  /* ---------- thermal ----------
     Heat is warm red: the thermometer column, the flames and the melting-point
     line. Solid and melted sample are two steps of the same warm neutral, so
     the phase change reads without competing with the heat colour. */
  --physics-thermal-heat: #dc2626;
  --physics-thermal-solid: #dbe6f0;
  --physics-thermal-liquid: #a8c8e4;

  /* ---------- induction ----------
     Induction ink is indigo — distinct from the violet subject chip of
     magnetism (its parent subject) so a bench rod never reads as a particle
     orbit: the field marks soft, the rod and coil solid, the induced current
     amber-warm like the optics rays it shares "energy flowing" semantics with. */
  --physics-induction-field: #8b9dc9;
  --physics-induction-rod: #4338ca;
  --physics-induction-current: #d97706;
  /* The core of an electromagnet is neither the winding nor the field: iron has
     to read as a third material on the same bench, between the copper it is
     threaded through and the field lines that pass across it. */
  --physics-magnetic-core: #94a3b8;

  /* ---------- wave ----------
     Wave ink is rose — no other domain uses it, so a rope profile is never
     mistaken for a trajectory (blue) or a field (violet/indigo). The profile
     and the sources take the full tone, the envelope and spreading crests a
     pale tint, the equilibrium rule stays neutral slate, and the marked
     particle borrows the sky of the acoustics pulse so the eye finds the one
     point that does NOT travel with the wave. */
  --physics-wave-rope: #be185d;
  --physics-wave-envelope: #f9a8d4;
  --physics-wave-front: #f472b6;
  --physics-wave-equilibrium: #94a3b8;
  --physics-wave-node: #334155;
  --physics-wave-marker: #0284c7;

  /* ---------- circuit ----------
     Current is energy in motion, so it borrows the warm gold the induction
     current and the optics rays already carry — but as its own token, because
     the flowing dash layer must be tunable without dragging those with it. The
     conductor is a cable rather than a hairline: a dark body with a cool sheen
     so the gold beads read against it. Lamp light is three steps of one warm
     ramp (core → hot → bloom) because a single flat halo is exactly what made
     the bulbs read as stickers. */
  --physics-wire: #31363f;
  --physics-wire-sheen: #7b8698;
  --physics-current-flow: #ffe08a;
  --physics-current-flow-glow: rgb(120 70 0 / 55%);
  --physics-lamp-core: #fff8e6;
  --physics-lamp-hot: #ffd166;
  --physics-lamp-bloom: #ff9d2e;

  /* ---------- status ---------- */
  --physics-verification-ok: #2f9e5a;
  --physics-verification-warning: #d97706;
  --physics-verification-error: #c2413a;

  /* ---------- subjects ----------
     Library / navigation identity for the experiment domains (力学 / 电场 / 磁场 /
     电路 / 复合场 / 光学 / 声学 / 浮力 / 热学), one hue + one tinted surface each.
     These colour UI chrome — picker cards, tags, tabs — NEVER canvas physics: a
     vector keeps its vector token even inside a subject-tinted card. */
  --physics-subject-mechanics: #2f9e5a;
  --physics-subject-mechanics-tint: #e7f4ec;
  --physics-subject-electric: #2563eb;
  --physics-subject-electric-tint: #e8effc;
  --physics-subject-magnetic: #7c3aed;
  --physics-subject-magnetic-tint: #f1ebfd;
  --physics-subject-circuit: #0d9488;
  --physics-subject-circuit-tint: #e2f4f1;
  --physics-subject-composite: #ea580c;
  --physics-subject-composite-tint: #fdeee3;
  --physics-subject-optics: #ca8a04;
  --physics-subject-optics-tint: #faf3d8;
  --physics-subject-acoustics: #0284c7;
  --physics-subject-acoustics-tint: #e3f2fb;
  --physics-subject-fluid: #0891b2;
  --physics-subject-fluid-tint: #dff4f8;
  --physics-subject-thermal: #dc2626;
  --physics-subject-thermal-tint: #fbe3e3;
  --physics-subject-induction: #4338ca;
  --physics-subject-induction-tint: #e8e8fb;
  --physics-subject-wave: #db2777;
  --physics-subject-wave-tint: #fce7f3;

  /* ---------- interaction ---------- */
  --physics-highlight: #f5a524;
  --physics-highlight-glow: rgba(245, 165, 36, 0.22);

  /* ---------- motion ----------
     Fast enough to read as direct response, never as a 500ms animation. */
  --physics-motion-fast: 120ms;
  --physics-motion-base: 150ms;
  --physics-motion-slow: 180ms;
  --physics-ease: cubic-bezier(0.2, 0, 0.13, 1);

  /* Entrance choreography (library home, cards easing in) runs longer than the
     response tokens above because it narrates layout, not physics: a decisive
     ease-out that lands still. Interactions keep using the fast tokens. */
  --physics-motion-entrance: 460ms;
  --physics-ease-emphasized: cubic-bezier(0.22, 1, 0.36, 1);
}

/* Physics time is never faked by a CSS tween; only presentation properties
   transition. A user who disables motion loses nothing physical. */
@media (prefers-reduced-motion: reduce) {
  :root {
    --physics-motion-fast: 0ms;
    --physics-motion-base: 0ms;
    --physics-motion-slow: 0ms;
    --physics-motion-entrance: 0ms;
  }
}

:root {
  --physicsos-focus: #5e8a6c;

  /* ---------- notebook accent ----------
     The 76 published experiment packages are immutable and speak one visual
     language: warm paper, green-black ink, one deep green. The host chrome
     adopts it instead of framing them in a second, blue palette. */
  --physics-accent: #497357;
  --physics-accent-strong: #3c6249;
  --physics-accent-soft: #e3ede6;
  --physics-paper: #f5f4ed;

  /* ---------- surfaces ----------
     The glass material is shared by every floating panel (cards, palette,
     inspector, composer). The desk itself is bound on body below, because its
     source token lives there. The canvas tokens above stay fixed-light on
     purpose: the physics inks are tuned against a white sheet, so a dark host
     keeps the sheet and darkens only the desk and the panels around it. */
  --physics-glass-fill: rgba(255, 254, 249, 0.62);
  --physics-glass-fill-strong: rgba(255, 254, 249, 0.84);
  --physics-glass-border: rgba(255, 255, 255, 0.86);
  --physics-glass-border-soft: rgba(73, 115, 87, 0.16);
  --physics-glass-shadow: 0 16px 36px rgba(40, 60, 50, 0.08);
  --physics-glass-shadow-raised: 0 18px 42px rgba(40, 60, 50, 0.12);
  --physics-glass-inset: inset 0 1px 0 rgba(255, 255, 255, 0.9);
  --physics-glass-plate: #f6f5ef;

  /* ---------- liquid glass ----------
     The floating material for the console surfaces (出卷专区 / 管理后台 / 学习记录 /
     登录门). A lens reads as glass only when three ingredients stack: a blurred
     backdrop that actually refracts what is behind it, a specular sheen across
     the top edge where light enters, and a bright 1px rim that follows the
     curve. A flat translucent fill without them is just a grey box — which is
     exactly what these pages looked like before. */
  --physics-glass-blur: saturate(1.7) blur(22px);
  --physics-glass-blur-soft: saturate(1.4) blur(12px);
  --physics-glass-sheen: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.75) 0%,
    rgba(255, 255, 255, 0.22) 38%,
    rgba(255, 255, 255, 0) 70%
  );
  --physics-glass-rim:
    inset 0 1px 0 rgba(255, 255, 255, 0.95),
    inset 0 -1px 0 rgba(255, 255, 255, 0.4),
    inset 0 0 0 1px rgba(255, 255, 255, 0.26);
  --physics-glass-lift:
    0 1px 2px rgba(31, 42, 35, 0.05),
    0 14px 34px -12px rgba(40, 60, 50, 0.2);
  --physics-glass-lift-raised:
    0 2px 6px rgba(31, 42, 35, 0.06),
    0 26px 54px -16px rgba(40, 60, 50, 0.26);
  --physics-glass-popover: rgba(255, 254, 250, 0.96);
  /* Ambient light behind the panels. Without something coloured to blur, every
     glass surface above resolves to the page's own flat fill. */
  --physics-glass-ambient:
    radial-gradient(46% 58% at 10% 6%, rgba(73, 115, 87, 0.16), transparent 66%),
    radial-gradient(40% 50% at 90% 4%, rgba(201, 138, 43, 0.12), transparent 68%),
    radial-gradient(50% 62% at 82% 94%, rgba(73, 115, 87, 0.12), transparent 70%),
    radial-gradient(40% 50% at 18% 92%, rgba(201, 138, 43, 0.1), transparent 68%),
    radial-gradient(70% 90% at 50% 50%, rgba(255, 254, 249, 0.6), transparent 76%);

  /* Interaction tint: a pale wash of the meaning colour over the host's base
     surface. Written as a mix rather than a fixed pale hex so a dark host gets
     a deep tint instead of a near-white block, and the ink flips with it. */
  --physics-tint-accent: color-mix(in srgb, var(--physics-accent) 12%, var(--dsw-alias-bg-base, #ffffff));
  --physics-tint-accent-strong: color-mix(in srgb, var(--physics-accent) 22%, var(--dsw-alias-bg-base, #ffffff));
  --physics-tint-accent-ink: var(--physics-accent-strong);
  --physics-tint-verified: color-mix(in srgb, var(--physics-verification-ok) 12%, var(--dsw-alias-bg-base, #ffffff));
  --physics-tint-warning: color-mix(in srgb, var(--physics-verification-warning) 14%, var(--dsw-alias-bg-base, #ffffff));
  --physics-tint-verified-edge: color-mix(in srgb, var(--physics-verification-ok) 38%, transparent);
  --physics-tint-warning-edge: color-mix(in srgb, var(--physics-verification-warning) 38%, transparent);

  /* ---------- ink ----------
     The physics tokens above colour physics; these colour words. Text needs its
     own layer because a surface can afford to sit near the background while a
     label cannot: the host's dimmed label resolves to a mid grey that is legible
     on a light desk and all but invisible on a dark one. Light values are the
     ink the product already used. */
  --physics-ink: #34503f;
  --physics-ink-strong: #263f2f;
  /* Explicit: the host's dimmed label is a near-white grey, not body text. */
  --physics-ink-muted: #687369;
  --physics-ink-link: #3c6249;
  --physics-ink-ok: #047857;
  --physics-ink-warn: #b45309;
  --physics-ink-mark: #be185d;
}

/* The host writes its alias palette onto body, so a surface token can only
   follow it from that same scope: defined on the root element the reference
   would resolve there, find nothing, and silently keep the light hex - a dark
   host would then sit on a white desk. */
body {
  --physics-workspace-bg: var(--dsw-alias-bg-base, #f3f6fa);
}

/* Light host: the Harness palette moves onto the notebook. Only alias tokens
   are rebound — a static scale keeps the meaning of its name — and the dark
   palette stays the host's. The selector outranks the host's plain body rule. */
body:not([data-ds-dark-theme]) {
  accent-color: var(--physics-accent);
  --dsw-alias-bg-base: #fcfbf7;
  --dsw-alias-bg-layer-1: #ffffff;
  --dsw-alias-bg-layer-2: #ffffff;
  --dsw-alias-bg-layer-3: #ffffff;
  --dsw-alias-bg-module-platform: #f4f3ec;
  --dsw-alias-bg-overlay: #e9e8de;
  --dsw-alias-bg-document-preview: #eeede5;
  --dsw-alias-bg-multi-select: #f4f3ec;
  --dsw-alias-border-l1: rgba(40, 60, 50, 0.06);
  --dsw-alias-border-l2: rgba(40, 60, 50, 0.12);
  --dsw-alias-border-l2-darkmode-thin: rgba(40, 60, 50, 0.12);
  --dsw-alias-border-l3: rgba(40, 60, 50, 0.15);
  --dsw-alias-border-l4: rgba(40, 60, 50, 0.2);
  --dsw-alias-brand-primary: #22302a;
  --dsw-alias-brand-text: #1f2a23;
  --dsw-alias-button-primary-hover: #3a473f;
  --dsw-alias-button-primary-dimmed: #ebeae2;
  --dsw-alias-button-info-fill: var(--physics-accent);
  --dsw-alias-button-info-hover: #5b866a;
  --dsw-alias-button-contrast-fill: #545d55;
  --dsw-alias-button-floating-hover: #f1f0e9;
  --dsw-alias-button-ghost-active-border: #8a8f84;
  --dsw-alias-button-ghost-active-fill: #ebeae2;
  --dsw-alias-button-ghost-active-hover: #e5e4da;
  --dsw-alias-interactive-bg-active: rgba(40, 60, 50, 0.1);
  --dsw-alias-interactive-bg-hover: rgba(40, 60, 50, 0.06);
  --dsw-alias-interactive-bg-hover-accent: rgba(40, 60, 50, 0.14);
  --dsw-alias-interactive-bg-hover-solid: #f1f0e9;
  --dsw-alias-label-primary: #1f2a23;
  --dsw-alias-label-primary-dimmed: #26302a;
  --dsw-alias-label-primary-bluish: #2b4a37;
  --dsw-alias-label-secondary: #4e5a52;
  --dsw-alias-label-tertiary: #6b756d;
  --dsw-alias-label-caption: #969c92;
  --dsw-alias-label-dimmed: #d8d8cc;
  --dsw-alias-menu-icon: #353c36;
  --dsw-alias-link: var(--physics-accent-strong);
  --dsw-alias-state-business-primary: var(--physics-accent);
  --dsw-alias-state-business-tertiary: var(--physics-accent-soft);
  --dsw-alias-markdown-citation: #ebeae2;
  --dsw-alias-markdown-code-block: #f7f6f0;
  --dsw-alias-markdown-code-block-banner: #f7f6f0;
  --dsw-alias-markdown-code-segment-unselected: #f1f0e9;
  --dsw-alias-markdown-inline-code: #f4f3ec;
  --dsw-alias-markdown-placeholder: #f6f5ef;
  --dsw-alias-markdown-tag: #f1f0e9;
  --dsw-alias-tooltip-bg: #26302a;
  --dsw-alias-toast-bg: #2c352f;
  --dsw-specific-bubble: #edf3ee;
  --dsw-specific-bubble-highlight: #d4e4d8;
  --dsw-specific-login-input: #faf9f4;
  --dsw-menu-surface-fill: rgba(252, 251, 246, 0.72);
  --dsw-specific-selector: #f6f5ef;
  --dsw-specific-sidebar-fill: #f4f3ec;
  --dsw-specific-sidebar-nav-item-active: #e8e7dd;
  --dsw-specific-sidebar-nav-item-active-accent: var(--physics-accent-soft);
  --dsw-specific-sidebar-nav-item-hover: #eeede5;
  --dsw-specific-tip: #f6f5ef;
}

body:not([data-ds-dark-theme]) ::selection {
  background: rgba(73, 115, 87, 0.2);
}

/* Dark host: the sheet stays, the desk and the panels go dark. */
body[data-ds-dark-theme] {
  --physics-glass-fill: rgba(35, 35, 36, 0.72);
  --physics-glass-fill-strong: rgba(44, 44, 46, 0.88);
  --physics-glass-border: rgba(255, 255, 255, 0.08);
  --physics-glass-border-soft: rgba(255, 255, 255, 0.14);
  --physics-glass-shadow: 0 16px 36px rgba(0, 0, 0, 0.5);
  --physics-glass-shadow-raised: 0 18px 42px rgba(0, 0, 0, 0.6);
  --physics-glass-inset: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  --physics-glass-plate: var(--dsw-alias-bg-layer-2, #2c2c2e);
  --physics-glass-sheen: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.1) 0%,
    rgba(255, 255, 255, 0.03) 42%,
    rgba(255, 255, 255, 0) 72%
  );
  --physics-glass-rim:
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    inset 0 -1px 0 rgba(255, 255, 255, 0.04),
    inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  --physics-glass-lift:
    0 1px 2px rgba(0, 0, 0, 0.4),
    0 16px 38px -12px rgba(0, 0, 0, 0.62);
  --physics-glass-lift-raised:
    0 2px 6px rgba(0, 0, 0, 0.44),
    0 28px 58px -16px rgba(0, 0, 0, 0.72);
  --physics-glass-popover: rgba(38, 38, 41, 0.96);
  --physics-glass-ambient:
    radial-gradient(46% 58% at 10% 6%, rgba(59, 130, 246, 0.28), transparent 66%),
    radial-gradient(40% 50% at 90% 4%, rgba(13, 148, 136, 0.22), transparent 68%),
    radial-gradient(50% 62% at 82% 94%, rgba(139, 92, 246, 0.26), transparent 70%),
    radial-gradient(40% 50% at 18% 92%, rgba(245, 158, 11, 0.16), transparent 68%);
  --physicsos-focus: #8fbf9f;
  --physics-accent: #7fb08f;
  --physics-accent-strong: #9cc8a8;
  --physics-accent-soft: rgba(127, 176, 143, 0.16);
  accent-color: var(--physics-accent);
  --physics-tint-accent-ink: var(--physics-accent-strong);

  /* Ink flips to the light end of each hue: the same words sit on a near-black
     desk now, so a hue that read as "deep" on white reads as "invisible" here. */
  --physics-ink: #cbd6e4;
  --physics-ink-strong: #e2e8f0;
  --physics-ink-muted: var(--dsw-alias-label-secondary, #a3aab4);
  --physics-ink-link: var(--physics-accent-strong);
  --physics-ink-ok: var(--dsw-static-green-400, #4ed17e);
  --physics-ink-warn: var(--dsw-static-amber-400, #f7ad31);
  --physics-ink-mark: #f9a8d4;
}

/* Dark host keeps its own surfaces; only the accent moves to the notebook
   green. The host writes its dark aliases on body[data-ds-dark-theme] as well;
   the root qualifier outranks them whatever order the sheets load in. */
html body[data-ds-dark-theme] {
  --dsw-alias-button-info-fill: #4f7d60;
  --dsw-alias-button-info-hover: #5c8d6d;
  --dsw-alias-link: var(--physics-accent-strong);
  --dsw-alias-state-business-primary: var(--physics-accent);
  --dsw-alias-state-business-tertiary: var(--physics-accent-soft);
  --dsw-specific-sidebar-nav-item-active-accent: var(--physics-accent-soft);
  --dsw-specific-bubble: rgba(127, 176, 143, 0.14);
  --dsw-specific-bubble-highlight: rgba(127, 176, 143, 0.26);
}
*:focus {
  outline: none;
}
*:focus-visible {
  outline: 2px solid var(--physicsos-focus);
  outline-offset: 2px;
}
textarea:focus,
input:focus,
button:focus,
[role='button']:focus,
[role='menuitem']:focus {
  outline: none;
}
textarea:focus-visible,
input:focus-visible,
button:focus-visible,
[role='button']:focus-visible,
[role='menuitem']:focus-visible {
  outline: 2px solid var(--physicsos-focus);
  outline-offset: 2px;
}

body {
  --dsh-scrollbar-thumb: rgba(15, 23, 42, 0.16);
  --dsh-scrollbar-thumb-hover: rgba(15, 23, 42, 0.28);
  --dsh-scrollbar-width: 6px;
}

body[data-ds-dark-theme] {
  --dsh-scrollbar-thumb: rgba(255, 255, 255, 0.18);
  --dsh-scrollbar-thumb-hover: rgba(255, 255, 255, 0.3);
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-thumb {
  border-radius: 999px;
}
`,document.head.appendChild(e),()=>{e.remove()}}let Fr,Ir;var Lr=class extends _.Component{state={failed:!1};static getDerivedStateFromError(){return{failed:!0}}componentDidCatch(e){Ir=e}render(){return this.state.failed?_.createElement(`p`,{role:`alert`},`Renderer failed`):this.props.children}};function Rr(e){if(Fr||=(Pr(),(0,y.createRoot)(document.getElementById(`canvas`))),Ir=void 0,(0,v.flushSync)(()=>Fr.render(_.createElement(Lr,{key:e.revision},_.createElement(Nr,{view:e.view,ariaLabel:e.ariaLabel,trajectoryTimes:e.trajectoryTimes,clockTime:e.clock.time})))),Ir)throw Ir}export{Rr as renderPlatformFrame};