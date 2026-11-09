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
var t=Symbol.for(`react.element`),n=Symbol.for(`react.portal`),r=Symbol.for(`react.fragment`),i=Symbol.for(`react.strict_mode`),a=Symbol.for(`react.profiler`),o=Symbol.for(`react.provider`),s=Symbol.for(`react.context`),c=Symbol.for(`react.forward_ref`),l=Symbol.for(`react.suspense`),u=Symbol.for(`react.memo`),d=Symbol.for(`react.lazy`),f=Symbol.iterator;function p(e){return typeof e!=`object`||!e?null:(e=f&&e[f]||e[`@@iterator`],typeof e==`function`?e:null)}var m={isMounted:function(){return!1},enqueueForceUpdate:function(){},enqueueReplaceState:function(){},enqueueSetState:function(){}},h=Object.assign,g={};function _(e,t,n){this.props=e,this.context=t,this.refs=g,this.updater=n||m}_.prototype.isReactComponent={},_.prototype.setState=function(e,t){if(typeof e!=`object`&&typeof e!=`function`&&e!=null)throw Error(`setState(...): takes an object of state variables to update or a function which returns an object of state variables.`);this.updater.enqueueSetState(this,e,t,`setState`)},_.prototype.forceUpdate=function(e){this.updater.enqueueForceUpdate(this,e,`forceUpdate`)};function v(){}v.prototype=_.prototype;function y(e,t,n){this.props=e,this.context=t,this.refs=g,this.updater=n||m}var b=y.prototype=new v;b.constructor=y,h(b,_.prototype),b.isPureReactComponent=!0;var x=Array.isArray,S=Object.prototype.hasOwnProperty,C={current:null},w={key:!0,ref:!0,__self:!0,__source:!0};function T(e,n,r){var i,a={},o=null,s=null;if(n!=null)for(i in n.ref!==void 0&&(s=n.ref),n.key!==void 0&&(o=``+n.key),n)S.call(n,i)&&!w.hasOwnProperty(i)&&(a[i]=n[i]);var c=arguments.length-2;if(c===1)a.children=r;else if(1<c){for(var l=Array(c),u=0;u<c;u++)l[u]=arguments[u+2];a.children=l}if(e&&e.defaultProps)for(i in c=e.defaultProps,c)a[i]===void 0&&(a[i]=c[i]);return{$$typeof:t,type:e,key:o,ref:s,props:a,_owner:C.current}}function E(e,n){return{$$typeof:t,type:e.type,key:n,ref:e.ref,props:e.props,_owner:e._owner}}function D(e){return typeof e==`object`&&!!e&&e.$$typeof===t}function ee(e){var t={"=":`=0`,":":`=2`};return`$`+e.replace(/[=:]/g,function(e){return t[e]})}var te=/\/+/g;function ne(e,t){return typeof e==`object`&&e&&e.key!=null?ee(``+e.key):t.toString(36)}function O(e,r,i,a,o){var s=typeof e;(s===`undefined`||s===`boolean`)&&(e=null);var c=!1;if(e===null)c=!0;else switch(s){case`string`:case`number`:c=!0;break;case`object`:switch(e.$$typeof){case t:case n:c=!0}}if(c)return c=e,o=o(c),e=a===``?`.`+ne(c,0):a,x(o)?(i=``,e!=null&&(i=e.replace(te,`$&/`)+`/`),O(o,r,i,``,function(e){return e})):o!=null&&(D(o)&&(o=E(o,i+(!o.key||c&&c.key===o.key?``:(``+o.key).replace(te,`$&/`)+`/`)+e)),r.push(o)),1;if(c=0,a=a===``?`.`:a+`:`,x(e))for(var l=0;l<e.length;l++){s=e[l];var u=a+ne(s,l);c+=O(s,r,i,u,o)}else if(u=p(e),typeof u==`function`)for(e=u.call(e),l=0;!(s=e.next()).done;)s=s.value,u=a+ne(s,l++),c+=O(s,r,i,u,o);else if(s===`object`)throw r=String(e),Error(`Objects are not valid as a React child (found: `+(r===`[object Object]`?`object with keys {`+Object.keys(e).join(`, `)+`}`:r)+`). If you meant to render a collection of children, use an array instead.`);return c}function k(e,t,n){if(e==null)return e;var r=[],i=0;return O(e,r,``,``,function(e){return t.call(n,e,i++)}),r}function re(e){if(e._status===-1){var t=e._result;t=t(),t.then(function(t){(e._status===0||e._status===-1)&&(e._status=1,e._result=t)},function(t){(e._status===0||e._status===-1)&&(e._status=2,e._result=t)}),e._status===-1&&(e._status=0,e._result=t)}if(e._status===1)return e._result.default;throw e._result}var A={current:null},ie={transition:null},j={ReactCurrentDispatcher:A,ReactCurrentBatchConfig:ie,ReactCurrentOwner:C};function ae(){throw Error(`act(...) is not supported in production builds of React.`)}e.Children={map:k,forEach:function(e,t,n){k(e,function(){t.apply(this,arguments)},n)},count:function(e){var t=0;return k(e,function(){t++}),t},toArray:function(e){return k(e,function(e){return e})||[]},only:function(e){if(!D(e))throw Error(`React.Children.only expected to receive a single React element child.`);return e}},e.Component=_,e.Fragment=r,e.Profiler=a,e.PureComponent=y,e.StrictMode=i,e.Suspense=l,e.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=j,e.act=ae,e.cloneElement=function(e,n,r){if(e==null)throw Error(`React.cloneElement(...): The argument must be a React element, but you passed `+e+`.`);var i=h({},e.props),a=e.key,o=e.ref,s=e._owner;if(n!=null){if(n.ref!==void 0&&(o=n.ref,s=C.current),n.key!==void 0&&(a=``+n.key),e.type&&e.type.defaultProps)var c=e.type.defaultProps;for(l in n)S.call(n,l)&&!w.hasOwnProperty(l)&&(i[l]=n[l]===void 0&&c!==void 0?c[l]:n[l])}var l=arguments.length-2;if(l===1)i.children=r;else if(1<l){c=Array(l);for(var u=0;u<l;u++)c[u]=arguments[u+2];i.children=c}return{$$typeof:t,type:e.type,key:a,ref:o,props:i,_owner:s}},e.createContext=function(e){return e={$$typeof:s,_currentValue:e,_currentValue2:e,_threadCount:0,Provider:null,Consumer:null,_defaultValue:null,_globalName:null},e.Provider={$$typeof:o,_context:e},e.Consumer=e},e.createElement=T,e.createFactory=function(e){var t=T.bind(null,e);return t.type=e,t},e.createRef=function(){return{current:null}},e.forwardRef=function(e){return{$$typeof:c,render:e}},e.isValidElement=D,e.lazy=function(e){return{$$typeof:d,_payload:{_status:-1,_result:e},_init:re}},e.memo=function(e,t){return{$$typeof:u,type:e,compare:t===void 0?null:t}},e.startTransition=function(e){var t=ie.transition;ie.transition={};try{e()}finally{ie.transition=t}},e.unstable_act=ae,e.useCallback=function(e,t){return A.current.useCallback(e,t)},e.useContext=function(e){return A.current.useContext(e)},e.useDebugValue=function(){},e.useDeferredValue=function(e){return A.current.useDeferredValue(e)},e.useEffect=function(e,t){return A.current.useEffect(e,t)},e.useId=function(){return A.current.useId()},e.useImperativeHandle=function(e,t,n){return A.current.useImperativeHandle(e,t,n)},e.useInsertionEffect=function(e,t){return A.current.useInsertionEffect(e,t)},e.useLayoutEffect=function(e,t){return A.current.useLayoutEffect(e,t)},e.useMemo=function(e,t){return A.current.useMemo(e,t)},e.useReducer=function(e,t,n){return A.current.useReducer(e,t,n)},e.useRef=function(e){return A.current.useRef(e)},e.useState=function(e){return A.current.useState(e)},e.useSyncExternalStore=function(e,t,n){return A.current.useSyncExternalStore(e,t,n)},e.useTransition=function(){return A.current.useTransition()},e.version=`18.3.1`})),u=o(((e,t)=>{t.exports=l()})),d=o((e=>{
/**
* @license React
* scheduler.production.min.js
*
* Copyright (c) Facebook, Inc. and its affiliates.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/
function t(e,t){var n=e.length;e.push(t);a:for(;0<n;){var r=n-1>>>1,a=e[r];if(0<i(a,t))e[r]=t,e[n]=a,n=r;else break a}}function n(e){return e.length===0?null:e[0]}function r(e){if(e.length===0)return null;var t=e[0],n=e.pop();if(n!==t){e[0]=n;a:for(var r=0,a=e.length,o=a>>>1;r<o;){var s=2*(r+1)-1,c=e[s],l=s+1,u=e[l];if(0>i(c,n))l<a&&0>i(u,c)?(e[r]=u,e[l]=n,r=l):(e[r]=c,e[s]=n,r=s);else if(l<a&&0>i(u,n))e[r]=u,e[l]=n,r=l;else break a}}return t}function i(e,t){var n=e.sortIndex-t.sortIndex;return n===0?e.id-t.id:n}if(typeof performance==`object`&&typeof performance.now==`function`){var a=performance;e.unstable_now=function(){return a.now()}}else{var o=Date,s=o.now();e.unstable_now=function(){return o.now()-s}}var c=[],l=[],u=1,d=null,f=3,p=!1,m=!1,h=!1,g=typeof setTimeout==`function`?setTimeout:null,_=typeof clearTimeout==`function`?clearTimeout:null,v=typeof setImmediate<`u`?setImmediate:null;typeof navigator<`u`&&navigator.scheduling!==void 0&&navigator.scheduling.isInputPending!==void 0&&navigator.scheduling.isInputPending.bind(navigator.scheduling);function y(e){for(var i=n(l);i!==null;){if(i.callback===null)r(l);else if(i.startTime<=e)r(l),i.sortIndex=i.expirationTime,t(c,i);else break;i=n(l)}}function b(e){if(h=!1,y(e),!m)if(n(c)!==null)m=!0,k(x);else{var t=n(l);t!==null&&re(b,t.startTime-e)}}function x(t,i){m=!1,h&&(h=!1,_(w),w=-1),p=!0;var a=f;try{for(y(i),d=n(c);d!==null&&(!(d.expirationTime>i)||t&&!D());){var o=d.callback;if(typeof o==`function`){d.callback=null,f=d.priorityLevel;var s=o(d.expirationTime<=i);i=e.unstable_now(),typeof s==`function`?d.callback=s:d===n(c)&&r(c),y(i)}else r(c);d=n(c)}if(d!==null)var u=!0;else{var g=n(l);g!==null&&re(b,g.startTime-i),u=!1}return u}finally{d=null,f=a,p=!1}}var S=!1,C=null,w=-1,T=5,E=-1;function D(){return!(e.unstable_now()-E<T)}function ee(){if(C!==null){var t=e.unstable_now();E=t;var n=!0;try{n=C(!0,t)}finally{n?te():(S=!1,C=null)}}else S=!1}var te;if(typeof v==`function`)te=function(){v(ee)};else if(typeof MessageChannel<`u`){var ne=new MessageChannel,O=ne.port2;ne.port1.onmessage=ee,te=function(){O.postMessage(null)}}else te=function(){g(ee,0)};function k(e){C=e,S||(S=!0,te())}function re(t,n){w=g(function(){t(e.unstable_now())},n)}e.unstable_IdlePriority=5,e.unstable_ImmediatePriority=1,e.unstable_LowPriority=4,e.unstable_NormalPriority=3,e.unstable_Profiling=null,e.unstable_UserBlockingPriority=2,e.unstable_cancelCallback=function(e){e.callback=null},e.unstable_continueExecution=function(){m||p||(m=!0,k(x))},e.unstable_forceFrameRate=function(e){0>e||125<e?console.error(`forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported`):T=0<e?Math.floor(1e3/e):5},e.unstable_getCurrentPriorityLevel=function(){return f},e.unstable_getFirstCallbackNode=function(){return n(c)},e.unstable_next=function(e){switch(f){case 1:case 2:case 3:var t=3;break;default:t=f}var n=f;f=t;try{return e()}finally{f=n}},e.unstable_pauseExecution=function(){},e.unstable_requestPaint=function(){},e.unstable_runWithPriority=function(e,t){switch(e){case 1:case 2:case 3:case 4:case 5:break;default:e=3}var n=f;f=e;try{return t()}finally{f=n}},e.unstable_scheduleCallback=function(r,i,a){var o=e.unstable_now();switch(typeof a==`object`&&a?(a=a.delay,a=typeof a==`number`&&0<a?o+a:o):a=o,r){case 1:var s=-1;break;case 2:s=250;break;case 5:s=1073741823;break;case 4:s=1e4;break;default:s=5e3}return s=a+s,r={id:u++,callback:i,priorityLevel:r,startTime:a,expirationTime:s,sortIndex:-1},a>o?(r.sortIndex=a,t(l,r),n(c)===null&&r===n(l)&&(h?(_(w),w=-1):h=!0,re(b,a-o))):(r.sortIndex=s,t(c,r),m||p||(m=!0,k(x))),r},e.unstable_shouldYield=D,e.unstable_wrapCallback=function(e){var t=f;return function(){var n=f;f=t;try{return e.apply(this,arguments)}finally{f=n}}}})),f=o(((e,t)=>{t.exports=d()})),p=o((e=>{
/**
* @license React
* react-dom.production.min.js
*
* Copyright (c) Facebook, Inc. and its affiliates.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/
var t=u(),n=f();function r(e){for(var t=`https://reactjs.org/docs/error-decoder.html?invariant=`+e,n=1;n<arguments.length;n++)t+=`&args[]=`+encodeURIComponent(arguments[n]);return`Minified React error #`+e+`; visit `+t+` for the full message or use the non-minified dev environment for full errors and additional helpful warnings.`}var i=new Set,a={};function o(e,t){s(e,t),s(e+`Capture`,t)}function s(e,t){for(a[e]=t,e=0;e<t.length;e++)i.add(t[e])}var c=!(typeof window>`u`||window.document===void 0||window.document.createElement===void 0),l=Object.prototype.hasOwnProperty,d=/^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/,p={},m={};function h(e){return l.call(m,e)?!0:l.call(p,e)?!1:d.test(e)?m[e]=!0:(p[e]=!0,!1)}function g(e,t,n,r){if(n!==null&&n.type===0)return!1;switch(typeof t){case`function`:case`symbol`:return!0;case`boolean`:return r?!1:n===null?(e=e.toLowerCase().slice(0,5),e!==`data-`&&e!==`aria-`):!n.acceptsBooleans;default:return!1}}function _(e,t,n,r){if(t==null||g(e,t,n,r))return!0;if(r)return!1;if(n!==null)switch(n.type){case 3:return!t;case 4:return!1===t;case 5:return isNaN(t);case 6:return isNaN(t)||1>t}return!1}function v(e,t,n,r,i,a,o){this.acceptsBooleans=t===2||t===3||t===4,this.attributeName=r,this.attributeNamespace=i,this.mustUseProperty=n,this.propertyName=e,this.type=t,this.sanitizeURL=a,this.removeEmptyString=o}var y={};`children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style`.split(` `).forEach(function(e){y[e]=new v(e,0,!1,e,null,!1,!1)}),[[`acceptCharset`,`accept-charset`],[`className`,`class`],[`htmlFor`,`for`],[`httpEquiv`,`http-equiv`]].forEach(function(e){var t=e[0];y[t]=new v(t,1,!1,e[1],null,!1,!1)}),[`contentEditable`,`draggable`,`spellCheck`,`value`].forEach(function(e){y[e]=new v(e,2,!1,e.toLowerCase(),null,!1,!1)}),[`autoReverse`,`externalResourcesRequired`,`focusable`,`preserveAlpha`].forEach(function(e){y[e]=new v(e,2,!1,e,null,!1,!1)}),`allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope`.split(` `).forEach(function(e){y[e]=new v(e,3,!1,e.toLowerCase(),null,!1,!1)}),[`checked`,`multiple`,`muted`,`selected`].forEach(function(e){y[e]=new v(e,3,!0,e,null,!1,!1)}),[`capture`,`download`].forEach(function(e){y[e]=new v(e,4,!1,e,null,!1,!1)}),[`cols`,`rows`,`size`,`span`].forEach(function(e){y[e]=new v(e,6,!1,e,null,!1,!1)}),[`rowSpan`,`start`].forEach(function(e){y[e]=new v(e,5,!1,e.toLowerCase(),null,!1,!1)});var b=/[\-:]([a-z])/g;function x(e){return e[1].toUpperCase()}`accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height`.split(` `).forEach(function(e){var t=e.replace(b,x);y[t]=new v(t,1,!1,e,null,!1,!1)}),`xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type`.split(` `).forEach(function(e){var t=e.replace(b,x);y[t]=new v(t,1,!1,e,`http://www.w3.org/1999/xlink`,!1,!1)}),[`xml:base`,`xml:lang`,`xml:space`].forEach(function(e){var t=e.replace(b,x);y[t]=new v(t,1,!1,e,`http://www.w3.org/XML/1998/namespace`,!1,!1)}),[`tabIndex`,`crossOrigin`].forEach(function(e){y[e]=new v(e,1,!1,e.toLowerCase(),null,!1,!1)}),y.xlinkHref=new v(`xlinkHref`,1,!1,`xlink:href`,`http://www.w3.org/1999/xlink`,!0,!1),[`src`,`href`,`action`,`formAction`].forEach(function(e){y[e]=new v(e,1,!1,e.toLowerCase(),null,!0,!0)});function S(e,t,n,r){var i=y.hasOwnProperty(t)?y[t]:null;(i===null?r||!(2<t.length)||t[0]!==`o`&&t[0]!==`O`||t[1]!==`n`&&t[1]!==`N`:i.type!==0)&&(_(t,n,i,r)&&(n=null),r||i===null?h(t)&&(n===null?e.removeAttribute(t):e.setAttribute(t,``+n)):i.mustUseProperty?e[i.propertyName]=n===null?i.type===3?!1:``:n:(t=i.attributeName,r=i.attributeNamespace,n===null?e.removeAttribute(t):(i=i.type,n=i===3||i===4&&!0===n?``:``+n,r?e.setAttributeNS(r,t,n):e.setAttribute(t,n))))}var C=t.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,w=Symbol.for(`react.element`),T=Symbol.for(`react.portal`),E=Symbol.for(`react.fragment`),D=Symbol.for(`react.strict_mode`),ee=Symbol.for(`react.profiler`),te=Symbol.for(`react.provider`),ne=Symbol.for(`react.context`),O=Symbol.for(`react.forward_ref`),k=Symbol.for(`react.suspense`),re=Symbol.for(`react.suspense_list`),A=Symbol.for(`react.memo`),ie=Symbol.for(`react.lazy`),j=Symbol.for(`react.offscreen`),ae=Symbol.iterator;function oe(e){return typeof e!=`object`||!e?null:(e=ae&&e[ae]||e[`@@iterator`],typeof e==`function`?e:null)}var M=Object.assign,se;function N(e){if(se===void 0)try{throw Error()}catch(e){var t=e.stack.trim().match(/\n( *(at )?)/);se=t&&t[1]||``}return`
`+se+e}var ce=!1;function le(e,t){if(!e||ce)return``;ce=!0;var n=Error.prepareStackTrace;Error.prepareStackTrace=void 0;try{if(t)if(t=function(){throw Error()},Object.defineProperty(t.prototype,"props",{set:function(){throw Error()}}),typeof Reflect==`object`&&Reflect.construct){try{Reflect.construct(t,[])}catch(e){var r=e}Reflect.construct(e,[],t)}else{try{t.call()}catch(e){r=e}e.call(t.prototype)}else{try{throw Error()}catch(e){r=e}e()}}catch(t){if(t&&r&&typeof t.stack==`string`){for(var i=t.stack.split(`
`),a=r.stack.split(`
`),o=i.length-1,s=a.length-1;1<=o&&0<=s&&i[o]!==a[s];)s--;for(;1<=o&&0<=s;o--,s--)if(i[o]!==a[s]){if(o!==1||s!==1)do if(o--,s--,0>s||i[o]!==a[s]){var c=`
`+i[o].replace(` at new `,` at `);return e.displayName&&c.includes(`<anonymous>`)&&(c=c.replace(`<anonymous>`,e.displayName)),c}while(1<=o&&0<=s);break}}}finally{ce=!1,Error.prepareStackTrace=n}return(e=e?e.displayName||e.name:``)?N(e):``}function ue(e){switch(e.tag){case 5:return N(e.type);case 16:return N(`Lazy`);case 13:return N(`Suspense`);case 19:return N(`SuspenseList`);case 0:case 2:case 15:return e=le(e.type,!1),e;case 11:return e=le(e.type.render,!1),e;case 1:return e=le(e.type,!0),e;default:return``}}function de(e){if(e==null)return null;if(typeof e==`function`)return e.displayName||e.name||null;if(typeof e==`string`)return e;switch(e){case E:return`Fragment`;case T:return`Portal`;case ee:return`Profiler`;case D:return`StrictMode`;case k:return`Suspense`;case re:return`SuspenseList`}if(typeof e==`object`)switch(e.$$typeof){case ne:return(e.displayName||`Context`)+`.Consumer`;case te:return(e._context.displayName||`Context`)+`.Provider`;case O:var t=e.render;return e=e.displayName,e||=(e=t.displayName||t.name||``,e===``?`ForwardRef`:`ForwardRef(`+e+`)`),e;case A:return t=e.displayName||null,t===null?de(e.type)||`Memo`:t;case ie:t=e._payload,e=e._init;try{return de(e(t))}catch{}}return null}function fe(e){var t=e.type;switch(e.tag){case 24:return`Cache`;case 9:return(t.displayName||`Context`)+`.Consumer`;case 10:return(t._context.displayName||`Context`)+`.Provider`;case 18:return`DehydratedFragment`;case 11:return e=t.render,e=e.displayName||e.name||``,t.displayName||(e===``?`ForwardRef`:`ForwardRef(`+e+`)`);case 7:return`Fragment`;case 5:return t;case 4:return`Portal`;case 3:return`Root`;case 6:return`Text`;case 16:return de(t);case 8:return t===D?`StrictMode`:`Mode`;case 22:return`Offscreen`;case 12:return`Profiler`;case 21:return`Scope`;case 13:return`Suspense`;case 19:return`SuspenseList`;case 25:return`TracingMarker`;case 1:case 0:case 17:case 2:case 14:case 15:if(typeof t==`function`)return t.displayName||t.name||null;if(typeof t==`string`)return t}return null}function pe(e){switch(typeof e){case`boolean`:case`number`:case`string`:case`undefined`:return e;case`object`:return e;default:return``}}function me(e){var t=e.type;return(e=e.nodeName)&&e.toLowerCase()===`input`&&(t===`checkbox`||t===`radio`)}function he(e){var t=me(e)?`checked`:`value`,n=Object.getOwnPropertyDescriptor(e.constructor.prototype,t),r=``+e[t];if(!e.hasOwnProperty(t)&&n!==void 0&&typeof n.get==`function`&&typeof n.set==`function`){var i=n.get,a=n.set;return Object.defineProperty(e,t,{configurable:!0,get:function(){return i.call(this)},set:function(e){r=``+e,a.call(this,e)}}),Object.defineProperty(e,t,{enumerable:n.enumerable}),{getValue:function(){return r},setValue:function(e){r=``+e},stopTracking:function(){e._valueTracker=null,delete e[t]}}}}function P(e){e._valueTracker||=he(e)}function ge(e){if(!e)return!1;var t=e._valueTracker;if(!t)return!0;var n=t.getValue(),r=``;return e&&(r=me(e)?e.checked?`true`:`false`:e.value),e=r,e===n?!1:(t.setValue(e),!0)}function F(e){if(e||=typeof document<`u`?document:void 0,e===void 0)return null;try{return e.activeElement||e.body}catch{return e.body}}function _e(e,t){var n=t.checked;return M({},t,{defaultChecked:void 0,defaultValue:void 0,value:void 0,checked:n??e._wrapperState.initialChecked})}function ve(e,t){var n=t.defaultValue==null?``:t.defaultValue,r=t.checked==null?t.defaultChecked:t.checked;n=pe(t.value==null?n:t.value),e._wrapperState={initialChecked:r,initialValue:n,controlled:t.type===`checkbox`||t.type===`radio`?t.checked!=null:t.value!=null}}function ye(e,t){t=t.checked,t!=null&&S(e,`checked`,t,!1)}function I(e,t){ye(e,t);var n=pe(t.value),r=t.type;if(n!=null)r===`number`?(n===0&&e.value===``||e.value!=n)&&(e.value=``+n):e.value!==``+n&&(e.value=``+n);else if(r===`submit`||r===`reset`){e.removeAttribute(`value`);return}t.hasOwnProperty(`value`)?be(e,t.type,n):t.hasOwnProperty(`defaultValue`)&&be(e,t.type,pe(t.defaultValue)),t.checked==null&&t.defaultChecked!=null&&(e.defaultChecked=!!t.defaultChecked)}function L(e,t,n){if(t.hasOwnProperty(`value`)||t.hasOwnProperty(`defaultValue`)){var r=t.type;if(!(r!==`submit`&&r!==`reset`||t.value!==void 0&&t.value!==null))return;t=``+e._wrapperState.initialValue,n||t===e.value||(e.value=t),e.defaultValue=t}n=e.name,n!==``&&(e.name=``),e.defaultChecked=!!e._wrapperState.initialChecked,n!==``&&(e.name=n)}function be(e,t,n){(t!==`number`||F(e.ownerDocument)!==e)&&(n==null?e.defaultValue=``+e._wrapperState.initialValue:e.defaultValue!==``+n&&(e.defaultValue=``+n))}var xe=Array.isArray;function Se(e,t,n,r){if(e=e.options,t){t={};for(var i=0;i<n.length;i++)t[`$`+n[i]]=!0;for(n=0;n<e.length;n++)i=t.hasOwnProperty(`$`+e[n].value),e[n].selected!==i&&(e[n].selected=i),i&&r&&(e[n].defaultSelected=!0)}else{for(n=``+pe(n),t=null,i=0;i<e.length;i++){if(e[i].value===n){e[i].selected=!0,r&&(e[i].defaultSelected=!0);return}t!==null||e[i].disabled||(t=e[i])}t!==null&&(t.selected=!0)}}function Ce(e,t){if(t.dangerouslySetInnerHTML!=null)throw Error(r(91));return M({},t,{value:void 0,defaultValue:void 0,children:``+e._wrapperState.initialValue})}function we(e,t){var n=t.value;if(n==null){if(n=t.children,t=t.defaultValue,n!=null){if(t!=null)throw Error(r(92));if(xe(n)){if(1<n.length)throw Error(r(93));n=n[0]}t=n}t??=``,n=t}e._wrapperState={initialValue:pe(n)}}function R(e,t){var n=pe(t.value),r=pe(t.defaultValue);n!=null&&(n=``+n,n!==e.value&&(e.value=n),t.defaultValue==null&&e.defaultValue!==n&&(e.defaultValue=n)),r!=null&&(e.defaultValue=``+r)}function Te(e){var t=e.textContent;t===e._wrapperState.initialValue&&t!==``&&t!==null&&(e.value=t)}function Ee(e){switch(e){case`svg`:return`http://www.w3.org/2000/svg`;case`math`:return`http://www.w3.org/1998/Math/MathML`;default:return`http://www.w3.org/1999/xhtml`}}function De(e,t){return e==null||e===`http://www.w3.org/1999/xhtml`?Ee(t):e===`http://www.w3.org/2000/svg`&&t===`foreignObject`?`http://www.w3.org/1999/xhtml`:e}var Oe,ke=function(e){return typeof MSApp<`u`&&MSApp.execUnsafeLocalFunction?function(t,n,r,i){MSApp.execUnsafeLocalFunction(function(){return e(t,n,r,i)})}:e}(function(e,t){if(e.namespaceURI!==`http://www.w3.org/2000/svg`||`innerHTML`in e)e.innerHTML=t;else{for(Oe||=document.createElement(`div`),Oe.innerHTML=`<svg>`+t.valueOf().toString()+`</svg>`,t=Oe.firstChild;e.firstChild;)e.removeChild(e.firstChild);for(;t.firstChild;)e.appendChild(t.firstChild)}});function Ae(e,t){if(t){var n=e.firstChild;if(n&&n===e.lastChild&&n.nodeType===3){n.nodeValue=t;return}}e.textContent=t}var je={animationIterationCount:!0,aspectRatio:!0,borderImageOutset:!0,borderImageSlice:!0,borderImageWidth:!0,boxFlex:!0,boxFlexGroup:!0,boxOrdinalGroup:!0,columnCount:!0,columns:!0,flex:!0,flexGrow:!0,flexPositive:!0,flexShrink:!0,flexNegative:!0,flexOrder:!0,gridArea:!0,gridRow:!0,gridRowEnd:!0,gridRowSpan:!0,gridRowStart:!0,gridColumn:!0,gridColumnEnd:!0,gridColumnSpan:!0,gridColumnStart:!0,fontWeight:!0,lineClamp:!0,lineHeight:!0,opacity:!0,order:!0,orphans:!0,tabSize:!0,widows:!0,zIndex:!0,zoom:!0,fillOpacity:!0,floodOpacity:!0,stopOpacity:!0,strokeDasharray:!0,strokeDashoffset:!0,strokeMiterlimit:!0,strokeOpacity:!0,strokeWidth:!0},Me=[`Webkit`,`ms`,`Moz`,`O`];Object.keys(je).forEach(function(e){Me.forEach(function(t){t=t+e.charAt(0).toUpperCase()+e.substring(1),je[t]=je[e]})});function Ne(e,t,n){return t==null||typeof t==`boolean`||t===``?``:n||typeof t!=`number`||t===0||je.hasOwnProperty(e)&&je[e]?(``+t).trim():t+`px`}function Pe(e,t){for(var n in e=e.style,t)if(t.hasOwnProperty(n)){var r=n.indexOf(`--`)===0,i=Ne(n,t[n],r);n===`float`&&(n=`cssFloat`),r?e.setProperty(n,i):e[n]=i}}var Fe=M({menuitem:!0},{area:!0,base:!0,br:!0,col:!0,embed:!0,hr:!0,img:!0,input:!0,keygen:!0,link:!0,meta:!0,param:!0,source:!0,track:!0,wbr:!0});function Ie(e,t){if(t){if(Fe[e]&&(t.children!=null||t.dangerouslySetInnerHTML!=null))throw Error(r(137,e));if(t.dangerouslySetInnerHTML!=null){if(t.children!=null)throw Error(r(60));if(typeof t.dangerouslySetInnerHTML!=`object`||!(`__html`in t.dangerouslySetInnerHTML))throw Error(r(61))}if(t.style!=null&&typeof t.style!=`object`)throw Error(r(62))}}function Le(e,t){if(e.indexOf(`-`)===-1)return typeof t.is==`string`;switch(e){case`annotation-xml`:case`color-profile`:case`font-face`:case`font-face-src`:case`font-face-uri`:case`font-face-format`:case`font-face-name`:case`missing-glyph`:return!1;default:return!0}}var Re=null;function ze(e){return e=e.target||e.srcElement||window,e.correspondingUseElement&&(e=e.correspondingUseElement),e.nodeType===3?e.parentNode:e}var Be=null,Ve=null,He=null;function Ue(e){if(e=zi(e)){if(typeof Be!=`function`)throw Error(r(280));var t=e.stateNode;t&&(t=Vi(t),Be(e.stateNode,e.type,t))}}function We(e){Ve?He?He.push(e):He=[e]:Ve=e}function Ge(){if(Ve){var e=Ve,t=He;if(He=Ve=null,Ue(e),t)for(e=0;e<t.length;e++)Ue(t[e])}}function Ke(e,t){return e(t)}function qe(){}var Je=!1;function Ye(e,t,n){if(Je)return e(t,n);Je=!0;try{return Ke(e,t,n)}finally{Je=!1,(Ve!==null||He!==null)&&(qe(),Ge())}}function Xe(e,t){var n=e.stateNode;if(n===null)return null;var i=Vi(n);if(i===null)return null;n=i[t];a:switch(t){case`onClick`:case`onClickCapture`:case`onDoubleClick`:case`onDoubleClickCapture`:case`onMouseDown`:case`onMouseDownCapture`:case`onMouseMove`:case`onMouseMoveCapture`:case`onMouseUp`:case`onMouseUpCapture`:case`onMouseEnter`:(i=!i.disabled)||(e=e.type,i=!(e===`button`||e===`input`||e===`select`||e===`textarea`)),e=!i;break a;default:e=!1}if(e)return null;if(n&&typeof n!=`function`)throw Error(r(231,t,typeof n));return n}var Ze=!1;if(c)try{var Qe={};Object.defineProperty(Qe,"passive",{get:function(){Ze=!0}}),window.addEventListener(`test`,Qe,Qe),window.removeEventListener(`test`,Qe,Qe)}catch{Ze=!1}function $e(e,t,n,r,i,a,o,s,c){var l=Array.prototype.slice.call(arguments,3);try{t.apply(n,l)}catch(e){this.onError(e)}}var et=!1,tt=null,nt=!1,rt=null,it={onError:function(e){et=!0,tt=e}};function at(e,t,n,r,i,a,o,s,c){et=!1,tt=null,$e.apply(it,arguments)}function ot(e,t,n,i,a,o,s,c,l){if(at.apply(this,arguments),et){if(et){var u=tt;et=!1,tt=null}else throw Error(r(198));nt||(nt=!0,rt=u)}}function st(e){var t=e,n=e;if(e.alternate)for(;t.return;)t=t.return;else{e=t;do t=e,t.flags&4098&&(n=t.return),e=t.return;while(e)}return t.tag===3?n:null}function ct(e){if(e.tag===13){var t=e.memoizedState;if(t===null&&(e=e.alternate,e!==null&&(t=e.memoizedState)),t!==null)return t.dehydrated}return null}function lt(e){if(st(e)!==e)throw Error(r(188))}function ut(e){var t=e.alternate;if(!t){if(t=st(e),t===null)throw Error(r(188));return t===e?e:null}for(var n=e,i=t;;){var a=n.return;if(a===null)break;var o=a.alternate;if(o===null){if(i=a.return,i!==null){n=i;continue}break}if(a.child===o.child){for(o=a.child;o;){if(o===n)return lt(a),e;if(o===i)return lt(a),t;o=o.sibling}throw Error(r(188))}if(n.return!==i.return)n=a,i=o;else{for(var s=!1,c=a.child;c;){if(c===n){s=!0,n=a,i=o;break}if(c===i){s=!0,i=a,n=o;break}c=c.sibling}if(!s){for(c=o.child;c;){if(c===n){s=!0,n=o,i=a;break}if(c===i){s=!0,i=o,n=a;break}c=c.sibling}if(!s)throw Error(r(189))}}if(n.alternate!==i)throw Error(r(190))}if(n.tag!==3)throw Error(r(188));return n.stateNode.current===n?e:t}function dt(e){return e=ut(e),e===null?null:ft(e)}function ft(e){if(e.tag===5||e.tag===6)return e;for(e=e.child;e!==null;){var t=ft(e);if(t!==null)return t;e=e.sibling}return null}var pt=n.unstable_scheduleCallback,mt=n.unstable_cancelCallback,ht=n.unstable_shouldYield,gt=n.unstable_requestPaint,z=n.unstable_now,_t=n.unstable_getCurrentPriorityLevel,vt=n.unstable_ImmediatePriority,yt=n.unstable_UserBlockingPriority,bt=n.unstable_NormalPriority,xt=n.unstable_LowPriority,St=n.unstable_IdlePriority,Ct=null,wt=null;function Tt(e){if(wt&&typeof wt.onCommitFiberRoot==`function`)try{wt.onCommitFiberRoot(Ct,e,void 0,(e.current.flags&128)==128)}catch{}}var Et=Math.clz32?Math.clz32:kt,Dt=Math.log,Ot=Math.LN2;function kt(e){return e>>>=0,e===0?32:31-(Dt(e)/Ot|0)|0}var At=64,jt=4194304;function Mt(e){switch(e&-e){case 1:return 1;case 2:return 2;case 4:return 4;case 8:return 8;case 16:return 16;case 32:return 32;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return e&4194240;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return e&130023424;case 134217728:return 134217728;case 268435456:return 268435456;case 536870912:return 536870912;case 1073741824:return 1073741824;default:return e}}function Nt(e,t){var n=e.pendingLanes;if(n===0)return 0;var r=0,i=e.suspendedLanes,a=e.pingedLanes,o=n&268435455;if(o!==0){var s=o&~i;s===0?(a&=o,a!==0&&(r=Mt(a))):r=Mt(s)}else o=n&~i,o===0?a!==0&&(r=Mt(a)):r=Mt(o);if(r===0)return 0;if(t!==0&&t!==r&&(t&i)===0&&(i=r&-r,a=t&-t,i>=a||i===16&&a&4194240))return t;if(r&4&&(r|=n&16),t=e.entangledLanes,t!==0)for(e=e.entanglements,t&=r;0<t;)n=31-Et(t),i=1<<n,r|=e[n],t&=~i;return r}function Pt(e,t){switch(e){case 1:case 2:case 4:return t+250;case 8:case 16:case 32:case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return t+5e3;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return-1;case 134217728:case 268435456:case 536870912:case 1073741824:return-1;default:return-1}}function Ft(e,t){for(var n=e.suspendedLanes,r=e.pingedLanes,i=e.expirationTimes,a=e.pendingLanes;0<a;){var o=31-Et(a),s=1<<o,c=i[o];c===-1?((s&n)===0||(s&r)!==0)&&(i[o]=Pt(s,t)):c<=t&&(e.expiredLanes|=s),a&=~s}}function It(e){return e=e.pendingLanes&-1073741825,e===0?e&1073741824?1073741824:0:e}function Lt(){var e=At;return At<<=1,!(At&4194240)&&(At=64),e}function Rt(e){for(var t=[],n=0;31>n;n++)t.push(e);return t}function zt(e,t,n){e.pendingLanes|=t,t!==536870912&&(e.suspendedLanes=0,e.pingedLanes=0),e=e.eventTimes,t=31-Et(t),e[t]=n}function Bt(e,t){var n=e.pendingLanes&~t;e.pendingLanes=t,e.suspendedLanes=0,e.pingedLanes=0,e.expiredLanes&=t,e.mutableReadLanes&=t,e.entangledLanes&=t,t=e.entanglements;var r=e.eventTimes;for(e=e.expirationTimes;0<n;){var i=31-Et(n),a=1<<i;t[i]=0,r[i]=-1,e[i]=-1,n&=~a}}function Vt(e,t){var n=e.entangledLanes|=t;for(e=e.entanglements;n;){var r=31-Et(n),i=1<<r;i&t|e[r]&t&&(e[r]|=t),n&=~i}}var B=0;function Ht(e){return e&=-e,1<e?4<e?e&268435455?16:536870912:4:1}var Ut,Wt,Gt,Kt,qt,V=!1,Jt=[],Yt=null,H=null,Xt=null,Zt=new Map,Qt=new Map,$t=[],en=`mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit`.split(` `);function tn(e,t){switch(e){case`focusin`:case`focusout`:Yt=null;break;case`dragenter`:case`dragleave`:H=null;break;case`mouseover`:case`mouseout`:Xt=null;break;case`pointerover`:case`pointerout`:Zt.delete(t.pointerId);break;case`gotpointercapture`:case`lostpointercapture`:Qt.delete(t.pointerId)}}function nn(e,t,n,r,i,a){return e===null||e.nativeEvent!==a?(e={blockedOn:t,domEventName:n,eventSystemFlags:r,nativeEvent:a,targetContainers:[i]},t!==null&&(t=zi(t),t!==null&&Wt(t)),e):(e.eventSystemFlags|=r,t=e.targetContainers,i!==null&&t.indexOf(i)===-1&&t.push(i),e)}function rn(e,t,n,r,i){switch(t){case`focusin`:return Yt=nn(Yt,e,t,n,r,i),!0;case`dragenter`:return H=nn(H,e,t,n,r,i),!0;case`mouseover`:return Xt=nn(Xt,e,t,n,r,i),!0;case`pointerover`:var a=i.pointerId;return Zt.set(a,nn(Zt.get(a)||null,e,t,n,r,i)),!0;case`gotpointercapture`:return a=i.pointerId,Qt.set(a,nn(Qt.get(a)||null,e,t,n,r,i)),!0}return!1}function an(e){var t=Ri(e.target);if(t!==null){var n=st(t);if(n!==null){if(t=n.tag,t===13){if(t=ct(n),t!==null){e.blockedOn=t,qt(e.priority,function(){Gt(n)});return}}else if(t===3&&n.stateNode.current.memoizedState.isDehydrated){e.blockedOn=n.tag===3?n.stateNode.containerInfo:null;return}}}e.blockedOn=null}function on(e){if(e.blockedOn!==null)return!1;for(var t=e.targetContainers;0<t.length;){var n=_n(e.domEventName,e.eventSystemFlags,t[0],e.nativeEvent);if(n===null){n=e.nativeEvent;var r=new n.constructor(n.type,n);Re=r,n.target.dispatchEvent(r),Re=null}else return t=zi(n),t!==null&&Wt(t),e.blockedOn=n,!1;t.shift()}return!0}function sn(e,t,n){on(e)&&n.delete(t)}function cn(){V=!1,Yt!==null&&on(Yt)&&(Yt=null),H!==null&&on(H)&&(H=null),Xt!==null&&on(Xt)&&(Xt=null),Zt.forEach(sn),Qt.forEach(sn)}function ln(e,t){e.blockedOn===t&&(e.blockedOn=null,V||(V=!0,n.unstable_scheduleCallback(n.unstable_NormalPriority,cn)))}function un(e){function t(t){return ln(t,e)}if(0<Jt.length){ln(Jt[0],e);for(var n=1;n<Jt.length;n++){var r=Jt[n];r.blockedOn===e&&(r.blockedOn=null)}}for(Yt!==null&&ln(Yt,e),H!==null&&ln(H,e),Xt!==null&&ln(Xt,e),Zt.forEach(t),Qt.forEach(t),n=0;n<$t.length;n++)r=$t[n],r.blockedOn===e&&(r.blockedOn=null);for(;0<$t.length&&(n=$t[0],n.blockedOn===null);)an(n),n.blockedOn===null&&$t.shift()}var dn=C.ReactCurrentBatchConfig,fn=!0;function pn(e,t,n,r){var i=B,a=dn.transition;dn.transition=null;try{B=1,hn(e,t,n,r)}finally{B=i,dn.transition=a}}function mn(e,t,n,r){var i=B,a=dn.transition;dn.transition=null;try{B=4,hn(e,t,n,r)}finally{B=i,dn.transition=a}}function hn(e,t,n,r){if(fn){var i=_n(e,t,n,r);if(i===null)ui(e,t,r,gn,n),tn(e,r);else if(rn(i,e,t,n,r))r.stopPropagation();else if(tn(e,r),t&4&&-1<en.indexOf(e)){for(;i!==null;){var a=zi(i);if(a!==null&&Ut(a),a=_n(e,t,n,r),a===null&&ui(e,t,r,gn,n),a===i)break;i=a}i!==null&&r.stopPropagation()}else ui(e,t,r,null,n)}}var gn=null;function _n(e,t,n,r){if(gn=null,e=ze(r),e=Ri(e),e!==null)if(t=st(e),t===null)e=null;else if(n=t.tag,n===13){if(e=ct(t),e!==null)return e;e=null}else if(n===3){if(t.stateNode.current.memoizedState.isDehydrated)return t.tag===3?t.stateNode.containerInfo:null;e=null}else t!==e&&(e=null);return gn=e,null}function vn(e){switch(e){case`cancel`:case`click`:case`close`:case`contextmenu`:case`copy`:case`cut`:case`auxclick`:case`dblclick`:case`dragend`:case`dragstart`:case`drop`:case`focusin`:case`focusout`:case`input`:case`invalid`:case`keydown`:case`keypress`:case`keyup`:case`mousedown`:case`mouseup`:case`paste`:case`pause`:case`play`:case`pointercancel`:case`pointerdown`:case`pointerup`:case`ratechange`:case`reset`:case`resize`:case`seeked`:case`submit`:case`touchcancel`:case`touchend`:case`touchstart`:case`volumechange`:case`change`:case`selectionchange`:case`textInput`:case`compositionstart`:case`compositionend`:case`compositionupdate`:case`beforeblur`:case`afterblur`:case`beforeinput`:case`blur`:case`fullscreenchange`:case`focus`:case`hashchange`:case`popstate`:case`select`:case`selectstart`:return 1;case`drag`:case`dragenter`:case`dragexit`:case`dragleave`:case`dragover`:case`mousemove`:case`mouseout`:case`mouseover`:case`pointermove`:case`pointerout`:case`pointerover`:case`scroll`:case`toggle`:case`touchmove`:case`wheel`:case`mouseenter`:case`mouseleave`:case`pointerenter`:case`pointerleave`:return 4;case`message`:switch(_t()){case vt:return 1;case yt:return 4;case bt:case xt:return 16;case St:return 536870912;default:return 16}default:return 16}}var yn=null,bn=null,xn=null;function Sn(){if(xn)return xn;var e,t=bn,n=t.length,r,i=`value`in yn?yn.value:yn.textContent,a=i.length;for(e=0;e<n&&t[e]===i[e];e++);var o=n-e;for(r=1;r<=o&&t[n-r]===i[a-r];r++);return xn=i.slice(e,1<r?1-r:void 0)}function Cn(e){var t=e.keyCode;return`charCode`in e?(e=e.charCode,e===0&&t===13&&(e=13)):e=t,e===10&&(e=13),32<=e||e===13?e:0}function wn(){return!0}function Tn(){return!1}function En(e){function t(t,n,r,i,a){for(var o in this._reactName=t,this._targetInst=r,this.type=n,this.nativeEvent=i,this.target=a,this.currentTarget=null,e)e.hasOwnProperty(o)&&(t=e[o],this[o]=t?t(i):i[o]);return this.isDefaultPrevented=(i.defaultPrevented==null?!1===i.returnValue:i.defaultPrevented)?wn:Tn,this.isPropagationStopped=Tn,this}return M(t.prototype,{preventDefault:function(){this.defaultPrevented=!0;var e=this.nativeEvent;e&&(e.preventDefault?e.preventDefault():typeof e.returnValue!=`unknown`&&(e.returnValue=!1),this.isDefaultPrevented=wn)},stopPropagation:function(){var e=this.nativeEvent;e&&(e.stopPropagation?e.stopPropagation():typeof e.cancelBubble!=`unknown`&&(e.cancelBubble=!0),this.isPropagationStopped=wn)},persist:function(){},isPersistent:wn}),t}var Dn={eventPhase:0,bubbles:0,cancelable:0,timeStamp:function(e){return e.timeStamp||Date.now()},defaultPrevented:0,isTrusted:0},On=En(Dn),kn=M({},Dn,{view:0,detail:0}),An=En(kn),jn,Mn,Nn,Pn=M({},kn,{screenX:0,screenY:0,clientX:0,clientY:0,pageX:0,pageY:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,getModifierState:Gn,button:0,buttons:0,relatedTarget:function(e){return e.relatedTarget===void 0?e.fromElement===e.srcElement?e.toElement:e.fromElement:e.relatedTarget},movementX:function(e){return`movementX`in e?e.movementX:(e!==Nn&&(Nn&&e.type===`mousemove`?(jn=e.screenX-Nn.screenX,Mn=e.screenY-Nn.screenY):Mn=jn=0,Nn=e),jn)},movementY:function(e){return`movementY`in e?e.movementY:Mn}}),Fn=En(Pn),In=En(M({},Pn,{dataTransfer:0})),Ln=En(M({},kn,{relatedTarget:0})),Rn=En(M({},Dn,{animationName:0,elapsedTime:0,pseudoElement:0})),zn=En(M({},Dn,{clipboardData:function(e){return`clipboardData`in e?e.clipboardData:window.clipboardData}})),Bn=En(M({},Dn,{data:0})),Vn={Esc:`Escape`,Spacebar:` `,Left:`ArrowLeft`,Up:`ArrowUp`,Right:`ArrowRight`,Down:`ArrowDown`,Del:`Delete`,Win:`OS`,Menu:`ContextMenu`,Apps:`ContextMenu`,Scroll:`ScrollLock`,MozPrintableKey:`Unidentified`},Hn={8:`Backspace`,9:`Tab`,12:`Clear`,13:`Enter`,16:`Shift`,17:`Control`,18:`Alt`,19:`Pause`,20:`CapsLock`,27:`Escape`,32:` `,33:`PageUp`,34:`PageDown`,35:`End`,36:`Home`,37:`ArrowLeft`,38:`ArrowUp`,39:`ArrowRight`,40:`ArrowDown`,45:`Insert`,46:`Delete`,112:`F1`,113:`F2`,114:`F3`,115:`F4`,116:`F5`,117:`F6`,118:`F7`,119:`F8`,120:`F9`,121:`F10`,122:`F11`,123:`F12`,144:`NumLock`,145:`ScrollLock`,224:`Meta`},Un={Alt:`altKey`,Control:`ctrlKey`,Meta:`metaKey`,Shift:`shiftKey`};function Wn(e){var t=this.nativeEvent;return t.getModifierState?t.getModifierState(e):(e=Un[e])?!!t[e]:!1}function Gn(){return Wn}var Kn=En(M({},kn,{key:function(e){if(e.key){var t=Vn[e.key]||e.key;if(t!==`Unidentified`)return t}return e.type===`keypress`?(e=Cn(e),e===13?`Enter`:String.fromCharCode(e)):e.type===`keydown`||e.type===`keyup`?Hn[e.keyCode]||`Unidentified`:``},code:0,location:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,repeat:0,locale:0,getModifierState:Gn,charCode:function(e){return e.type===`keypress`?Cn(e):0},keyCode:function(e){return e.type===`keydown`||e.type===`keyup`?e.keyCode:0},which:function(e){return e.type===`keypress`?Cn(e):e.type===`keydown`||e.type===`keyup`?e.keyCode:0}})),qn=En(M({},Pn,{pointerId:0,width:0,height:0,pressure:0,tangentialPressure:0,tiltX:0,tiltY:0,twist:0,pointerType:0,isPrimary:0})),Jn=En(M({},kn,{touches:0,targetTouches:0,changedTouches:0,altKey:0,metaKey:0,ctrlKey:0,shiftKey:0,getModifierState:Gn})),Yn=En(M({},Dn,{propertyName:0,elapsedTime:0,pseudoElement:0})),Xn=En(M({},Pn,{deltaX:function(e){return`deltaX`in e?e.deltaX:`wheelDeltaX`in e?-e.wheelDeltaX:0},deltaY:function(e){return`deltaY`in e?e.deltaY:`wheelDeltaY`in e?-e.wheelDeltaY:`wheelDelta`in e?-e.wheelDelta:0},deltaZ:0,deltaMode:0})),Zn=[9,13,27,32],Qn=c&&`CompositionEvent`in window,$n=null;c&&`documentMode`in document&&($n=document.documentMode);var er=c&&`TextEvent`in window&&!$n,tr=c&&(!Qn||$n&&8<$n&&11>=$n),nr=` `,rr=!1;function ir(e,t){switch(e){case`keyup`:return Zn.indexOf(t.keyCode)!==-1;case`keydown`:return t.keyCode!==229;case`keypress`:case`mousedown`:case`focusout`:return!0;default:return!1}}function ar(e){return e=e.detail,typeof e==`object`&&`data`in e?e.data:null}var or=!1;function sr(e,t){switch(e){case`compositionend`:return ar(t);case`keypress`:return t.which===32?(rr=!0,nr):null;case`textInput`:return e=t.data,e===nr&&rr?null:e;default:return null}}function cr(e,t){if(or)return e===`compositionend`||!Qn&&ir(e,t)?(e=Sn(),xn=bn=yn=null,or=!1,e):null;switch(e){case`paste`:return null;case`keypress`:if(!(t.ctrlKey||t.altKey||t.metaKey)||t.ctrlKey&&t.altKey){if(t.char&&1<t.char.length)return t.char;if(t.which)return String.fromCharCode(t.which)}return null;case`compositionend`:return tr&&t.locale!==`ko`?null:t.data;default:return null}}var lr={color:!0,date:!0,datetime:!0,"datetime-local":!0,email:!0,month:!0,number:!0,password:!0,range:!0,search:!0,tel:!0,text:!0,time:!0,url:!0,week:!0};function ur(e){var t=e&&e.nodeName&&e.nodeName.toLowerCase();return t===`input`?!!lr[e.type]:t===`textarea`}function dr(e,t,n,r){We(r),t=fi(t,`onChange`),0<t.length&&(n=new On(`onChange`,`change`,null,n,r),e.push({event:n,listeners:t}))}var fr=null,pr=null;function mr(e){ai(e,0)}function hr(e){if(ge(Bi(e)))return e}function gr(e,t){if(e===`change`)return t}var _r=!1;if(c){var vr;if(c){var yr=`oninput`in document;if(!yr){var br=document.createElement(`div`);br.setAttribute(`oninput`,`return;`),yr=typeof br.oninput==`function`}vr=yr}else vr=!1;_r=vr&&(!document.documentMode||9<document.documentMode)}function xr(){fr&&(fr.detachEvent(`onpropertychange`,Sr),pr=fr=null)}function Sr(e){if(e.propertyName===`value`&&hr(pr)){var t=[];dr(t,pr,e,ze(e)),Ye(mr,t)}}function Cr(e,t,n){e===`focusin`?(xr(),fr=t,pr=n,fr.attachEvent(`onpropertychange`,Sr)):e===`focusout`&&xr()}function wr(e){if(e===`selectionchange`||e===`keyup`||e===`keydown`)return hr(pr)}function Tr(e,t){if(e===`click`)return hr(t)}function Er(e,t){if(e===`input`||e===`change`)return hr(t)}function Dr(e,t){return e===t&&(e!==0||1/e==1/t)||e!==e&&t!==t}var Or=typeof Object.is==`function`?Object.is:Dr;function kr(e,t){if(Or(e,t))return!0;if(typeof e!=`object`||!e||typeof t!=`object`||!t)return!1;var n=Object.keys(e),r=Object.keys(t);if(n.length!==r.length)return!1;for(r=0;r<n.length;r++){var i=n[r];if(!l.call(t,i)||!Or(e[i],t[i]))return!1}return!0}function Ar(e){for(;e&&e.firstChild;)e=e.firstChild;return e}function jr(e,t){var n=Ar(e);e=0;for(var r;n;){if(n.nodeType===3){if(r=e+n.textContent.length,e<=t&&r>=t)return{node:n,offset:t-e};e=r}a:{for(;n;){if(n.nextSibling){n=n.nextSibling;break a}n=n.parentNode}n=void 0}n=Ar(n)}}function Mr(e,t){return e&&t?e===t?!0:e&&e.nodeType===3?!1:t&&t.nodeType===3?Mr(e,t.parentNode):`contains`in e?e.contains(t):e.compareDocumentPosition?!!(e.compareDocumentPosition(t)&16):!1:!1}function Nr(){for(var e=window,t=F();t instanceof e.HTMLIFrameElement;){try{var n=typeof t.contentWindow.location.href==`string`}catch{n=!1}if(n)e=t.contentWindow;else break;t=F(e.document)}return t}function Pr(e){var t=e&&e.nodeName&&e.nodeName.toLowerCase();return t&&(t===`input`&&(e.type===`text`||e.type===`search`||e.type===`tel`||e.type===`url`||e.type===`password`)||t===`textarea`||e.contentEditable===`true`)}function Fr(e){var t=Nr(),n=e.focusedElem,r=e.selectionRange;if(t!==n&&n&&n.ownerDocument&&Mr(n.ownerDocument.documentElement,n)){if(r!==null&&Pr(n)){if(t=r.start,e=r.end,e===void 0&&(e=t),`selectionStart`in n)n.selectionStart=t,n.selectionEnd=Math.min(e,n.value.length);else if(e=(t=n.ownerDocument||document)&&t.defaultView||window,e.getSelection){e=e.getSelection();var i=n.textContent.length,a=Math.min(r.start,i);r=r.end===void 0?a:Math.min(r.end,i),!e.extend&&a>r&&(i=r,r=a,a=i),i=jr(n,a);var o=jr(n,r);i&&o&&(e.rangeCount!==1||e.anchorNode!==i.node||e.anchorOffset!==i.offset||e.focusNode!==o.node||e.focusOffset!==o.offset)&&(t=t.createRange(),t.setStart(i.node,i.offset),e.removeAllRanges(),a>r?(e.addRange(t),e.extend(o.node,o.offset)):(t.setEnd(o.node,o.offset),e.addRange(t)))}}for(t=[],e=n;e=e.parentNode;)e.nodeType===1&&t.push({element:e,left:e.scrollLeft,top:e.scrollTop});for(typeof n.focus==`function`&&n.focus(),n=0;n<t.length;n++)e=t[n],e.element.scrollLeft=e.left,e.element.scrollTop=e.top}}var Ir=c&&`documentMode`in document&&11>=document.documentMode,Lr=null,Rr=null,zr=null,Br=!1;function Vr(e,t,n){var r=n.window===n?n.document:n.nodeType===9?n:n.ownerDocument;Br||Lr==null||Lr!==F(r)||(r=Lr,`selectionStart`in r&&Pr(r)?r={start:r.selectionStart,end:r.selectionEnd}:(r=(r.ownerDocument&&r.ownerDocument.defaultView||window).getSelection(),r={anchorNode:r.anchorNode,anchorOffset:r.anchorOffset,focusNode:r.focusNode,focusOffset:r.focusOffset}),zr&&kr(zr,r)||(zr=r,r=fi(Rr,`onSelect`),0<r.length&&(t=new On(`onSelect`,`select`,null,t,n),e.push({event:t,listeners:r}),t.target=Lr)))}function Hr(e,t){var n={};return n[e.toLowerCase()]=t.toLowerCase(),n[`Webkit`+e]=`webkit`+t,n[`Moz`+e]=`moz`+t,n}var Ur={animationend:Hr(`Animation`,`AnimationEnd`),animationiteration:Hr(`Animation`,`AnimationIteration`),animationstart:Hr(`Animation`,`AnimationStart`),transitionend:Hr(`Transition`,`TransitionEnd`)},Wr={},Gr={};c&&(Gr=document.createElement(`div`).style,`AnimationEvent`in window||(delete Ur.animationend.animation,delete Ur.animationiteration.animation,delete Ur.animationstart.animation),`TransitionEvent`in window||delete Ur.transitionend.transition);function Kr(e){if(Wr[e])return Wr[e];if(!Ur[e])return e;var t=Ur[e],n;for(n in t)if(t.hasOwnProperty(n)&&n in Gr)return Wr[e]=t[n];return e}var qr=Kr(`animationend`),Jr=Kr(`animationiteration`),Yr=Kr(`animationstart`),Xr=Kr(`transitionend`),Zr=new Map,Qr=`abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel`.split(` `);function $r(e,t){Zr.set(e,t),o(t,[e])}for(var ei=0;ei<Qr.length;ei++){var ti=Qr[ei];$r(ti.toLowerCase(),`on`+(ti[0].toUpperCase()+ti.slice(1)))}$r(qr,`onAnimationEnd`),$r(Jr,`onAnimationIteration`),$r(Yr,`onAnimationStart`),$r(`dblclick`,`onDoubleClick`),$r(`focusin`,`onFocus`),$r(`focusout`,`onBlur`),$r(Xr,`onTransitionEnd`),s(`onMouseEnter`,[`mouseout`,`mouseover`]),s(`onMouseLeave`,[`mouseout`,`mouseover`]),s(`onPointerEnter`,[`pointerout`,`pointerover`]),s(`onPointerLeave`,[`pointerout`,`pointerover`]),o(`onChange`,`change click focusin focusout input keydown keyup selectionchange`.split(` `)),o(`onSelect`,`focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange`.split(` `)),o(`onBeforeInput`,[`compositionend`,`keypress`,`textInput`,`paste`]),o(`onCompositionEnd`,`compositionend focusout keydown keypress keyup mousedown`.split(` `)),o(`onCompositionStart`,`compositionstart focusout keydown keypress keyup mousedown`.split(` `)),o(`onCompositionUpdate`,`compositionupdate focusout keydown keypress keyup mousedown`.split(` `));var ni=`abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting`.split(` `),ri=new Set(`cancel close invalid load scroll toggle`.split(` `).concat(ni));function ii(e,t,n){var r=e.type||`unknown-event`;e.currentTarget=n,ot(r,t,void 0,e),e.currentTarget=null}function ai(e,t){t=(t&4)!=0;for(var n=0;n<e.length;n++){var r=e[n],i=r.event;r=r.listeners;a:{var a=void 0;if(t)for(var o=r.length-1;0<=o;o--){var s=r[o],c=s.instance,l=s.currentTarget;if(s=s.listener,c!==a&&i.isPropagationStopped())break a;ii(i,s,l),a=c}else for(o=0;o<r.length;o++){if(s=r[o],c=s.instance,l=s.currentTarget,s=s.listener,c!==a&&i.isPropagationStopped())break a;ii(i,s,l),a=c}}}if(nt)throw e=rt,nt=!1,rt=null,e}function U(e,t){var n=t[Fi];n===void 0&&(n=t[Fi]=new Set);var r=e+`__bubble`;n.has(r)||(li(t,e,2,!1),n.add(r))}function oi(e,t,n){var r=0;t&&(r|=4),li(n,e,r,t)}var si=`_reactListening`+Math.random().toString(36).slice(2);function ci(e){if(!e[si]){e[si]=!0,i.forEach(function(t){t!==`selectionchange`&&(ri.has(t)||oi(t,!1,e),oi(t,!0,e))});var t=e.nodeType===9?e:e.ownerDocument;t===null||t[si]||(t[si]=!0,oi(`selectionchange`,!1,t))}}function li(e,t,n,r){switch(vn(t)){case 1:var i=pn;break;case 4:i=mn;break;default:i=hn}n=i.bind(null,t,n,e),i=void 0,!Ze||t!==`touchstart`&&t!==`touchmove`&&t!==`wheel`||(i=!0),r?i===void 0?e.addEventListener(t,n,!0):e.addEventListener(t,n,{capture:!0,passive:i}):i===void 0?e.addEventListener(t,n,!1):e.addEventListener(t,n,{passive:i})}function ui(e,t,n,r,i){var a=r;if(!(t&1)&&!(t&2)&&r!==null)a:for(;;){if(r===null)return;var o=r.tag;if(o===3||o===4){var s=r.stateNode.containerInfo;if(s===i||s.nodeType===8&&s.parentNode===i)break;if(o===4)for(o=r.return;o!==null;){var c=o.tag;if((c===3||c===4)&&(c=o.stateNode.containerInfo,c===i||c.nodeType===8&&c.parentNode===i))return;o=o.return}for(;s!==null;){if(o=Ri(s),o===null)return;if(c=o.tag,c===5||c===6){r=a=o;continue a}s=s.parentNode}}r=r.return}Ye(function(){var r=a,i=ze(n),o=[];a:{var s=Zr.get(e);if(s!==void 0){var c=On,l=e;switch(e){case`keypress`:if(Cn(n)===0)break a;case`keydown`:case`keyup`:c=Kn;break;case`focusin`:l=`focus`,c=Ln;break;case`focusout`:l=`blur`,c=Ln;break;case`beforeblur`:case`afterblur`:c=Ln;break;case`click`:if(n.button===2)break a;case`auxclick`:case`dblclick`:case`mousedown`:case`mousemove`:case`mouseup`:case`mouseout`:case`mouseover`:case`contextmenu`:c=Fn;break;case`drag`:case`dragend`:case`dragenter`:case`dragexit`:case`dragleave`:case`dragover`:case`dragstart`:case`drop`:c=In;break;case`touchcancel`:case`touchend`:case`touchmove`:case`touchstart`:c=Jn;break;case qr:case Jr:case Yr:c=Rn;break;case Xr:c=Yn;break;case`scroll`:c=An;break;case`wheel`:c=Xn;break;case`copy`:case`cut`:case`paste`:c=zn;break;case`gotpointercapture`:case`lostpointercapture`:case`pointercancel`:case`pointerdown`:case`pointermove`:case`pointerout`:case`pointerover`:case`pointerup`:c=qn}var u=(t&4)!=0,d=!u&&e===`scroll`,f=u?s===null?null:s+`Capture`:s;u=[];for(var p=r,m;p!==null;){m=p;var h=m.stateNode;if(m.tag===5&&h!==null&&(m=h,f!==null&&(h=Xe(p,f),h!=null&&u.push(di(p,h,m)))),d)break;p=p.return}0<u.length&&(s=new c(s,l,null,n,i),o.push({event:s,listeners:u}))}}if(!(t&7)){a:{if(s=e===`mouseover`||e===`pointerover`,c=e===`mouseout`||e===`pointerout`,s&&n!==Re&&(l=n.relatedTarget||n.fromElement)&&(Ri(l)||l[Pi]))break a;if((c||s)&&(s=i.window===i?i:(s=i.ownerDocument)?s.defaultView||s.parentWindow:window,c?(l=n.relatedTarget||n.toElement,c=r,l=l?Ri(l):null,l!==null&&(d=st(l),l!==d||l.tag!==5&&l.tag!==6)&&(l=null)):(c=null,l=r),c!==l)){if(u=Fn,h=`onMouseLeave`,f=`onMouseEnter`,p=`mouse`,(e===`pointerout`||e===`pointerover`)&&(u=qn,h=`onPointerLeave`,f=`onPointerEnter`,p=`pointer`),d=c==null?s:Bi(c),m=l==null?s:Bi(l),s=new u(h,p+`leave`,c,n,i),s.target=d,s.relatedTarget=m,h=null,Ri(i)===r&&(u=new u(f,p+`enter`,l,n,i),u.target=m,u.relatedTarget=d,h=u),d=h,c&&l)b:{for(u=c,f=l,p=0,m=u;m;m=pi(m))p++;for(m=0,h=f;h;h=pi(h))m++;for(;0<p-m;)u=pi(u),p--;for(;0<m-p;)f=pi(f),m--;for(;p--;){if(u===f||f!==null&&u===f.alternate)break b;u=pi(u),f=pi(f)}u=null}else u=null;c!==null&&mi(o,s,c,u,!1),l!==null&&d!==null&&mi(o,d,l,u,!0)}}a:{if(s=r?Bi(r):window,c=s.nodeName&&s.nodeName.toLowerCase(),c===`select`||c===`input`&&s.type===`file`)var g=gr;else if(ur(s))if(_r)g=Er;else{g=wr;var _=Cr}else(c=s.nodeName)&&c.toLowerCase()===`input`&&(s.type===`checkbox`||s.type===`radio`)&&(g=Tr);if(g&&=g(e,r)){dr(o,g,n,i);break a}_&&_(e,s,r),e===`focusout`&&(_=s._wrapperState)&&_.controlled&&s.type===`number`&&be(s,`number`,s.value)}switch(_=r?Bi(r):window,e){case`focusin`:(ur(_)||_.contentEditable===`true`)&&(Lr=_,Rr=r,zr=null);break;case`focusout`:zr=Rr=Lr=null;break;case`mousedown`:Br=!0;break;case`contextmenu`:case`mouseup`:case`dragend`:Br=!1,Vr(o,n,i);break;case`selectionchange`:if(Ir)break;case`keydown`:case`keyup`:Vr(o,n,i)}var v;if(Qn)b:{switch(e){case`compositionstart`:var y=`onCompositionStart`;break b;case`compositionend`:y=`onCompositionEnd`;break b;case`compositionupdate`:y=`onCompositionUpdate`;break b}y=void 0}else or?ir(e,n)&&(y=`onCompositionEnd`):e===`keydown`&&n.keyCode===229&&(y=`onCompositionStart`);y&&(tr&&n.locale!==`ko`&&(or||y!==`onCompositionStart`?y===`onCompositionEnd`&&or&&(v=Sn()):(yn=i,bn=`value`in yn?yn.value:yn.textContent,or=!0)),_=fi(r,y),0<_.length&&(y=new Bn(y,e,null,n,i),o.push({event:y,listeners:_}),v?y.data=v:(v=ar(n),v!==null&&(y.data=v)))),(v=er?sr(e,n):cr(e,n))&&(r=fi(r,`onBeforeInput`),0<r.length&&(i=new Bn(`onBeforeInput`,`beforeinput`,null,n,i),o.push({event:i,listeners:r}),i.data=v))}ai(o,t)})}function di(e,t,n){return{instance:e,listener:t,currentTarget:n}}function fi(e,t){for(var n=t+`Capture`,r=[];e!==null;){var i=e,a=i.stateNode;i.tag===5&&a!==null&&(i=a,a=Xe(e,n),a!=null&&r.unshift(di(e,a,i)),a=Xe(e,t),a!=null&&r.push(di(e,a,i))),e=e.return}return r}function pi(e){if(e===null)return null;do e=e.return;while(e&&e.tag!==5);return e||null}function mi(e,t,n,r,i){for(var a=t._reactName,o=[];n!==null&&n!==r;){var s=n,c=s.alternate,l=s.stateNode;if(c!==null&&c===r)break;s.tag===5&&l!==null&&(s=l,i?(c=Xe(n,a),c!=null&&o.unshift(di(n,c,s))):i||(c=Xe(n,a),c!=null&&o.push(di(n,c,s)))),n=n.return}o.length!==0&&e.push({event:t,listeners:o})}var hi=/\r\n?/g,gi=/\u0000|\uFFFD/g;function _i(e){return(typeof e==`string`?e:``+e).replace(hi,`
`).replace(gi,``)}function vi(e,t,n){if(t=_i(t),_i(e)!==t&&n)throw Error(r(425))}function yi(){}var bi=null,xi=null;function Si(e,t){return e===`textarea`||e===`noscript`||typeof t.children==`string`||typeof t.children==`number`||typeof t.dangerouslySetInnerHTML==`object`&&t.dangerouslySetInnerHTML!==null&&t.dangerouslySetInnerHTML.__html!=null}var Ci=typeof setTimeout==`function`?setTimeout:void 0,wi=typeof clearTimeout==`function`?clearTimeout:void 0,Ti=typeof Promise==`function`?Promise:void 0,Ei=typeof queueMicrotask==`function`?queueMicrotask:Ti===void 0?Ci:function(e){return Ti.resolve(null).then(e).catch(Di)};function Di(e){setTimeout(function(){throw e})}function Oi(e,t){var n=t,r=0;do{var i=n.nextSibling;if(e.removeChild(n),i&&i.nodeType===8)if(n=i.data,n===`/$`){if(r===0){e.removeChild(i),un(t);return}r--}else n!==`$`&&n!==`$?`&&n!==`$!`||r++;n=i}while(n);un(t)}function ki(e){for(;e!=null;e=e.nextSibling){var t=e.nodeType;if(t===1||t===3)break;if(t===8){if(t=e.data,t===`$`||t===`$!`||t===`$?`)break;if(t===`/$`)return null}}return e}function Ai(e){e=e.previousSibling;for(var t=0;e;){if(e.nodeType===8){var n=e.data;if(n===`$`||n===`$!`||n===`$?`){if(t===0)return e;t--}else n===`/$`&&t++}e=e.previousSibling}return null}var ji=Math.random().toString(36).slice(2),Mi=`__reactFiber$`+ji,Ni=`__reactProps$`+ji,Pi=`__reactContainer$`+ji,Fi=`__reactEvents$`+ji,Ii=`__reactListeners$`+ji,Li=`__reactHandles$`+ji;function Ri(e){var t=e[Mi];if(t)return t;for(var n=e.parentNode;n;){if(t=n[Pi]||n[Mi]){if(n=t.alternate,t.child!==null||n!==null&&n.child!==null)for(e=Ai(e);e!==null;){if(n=e[Mi])return n;e=Ai(e)}return t}e=n,n=e.parentNode}return null}function zi(e){return e=e[Mi]||e[Pi],!e||e.tag!==5&&e.tag!==6&&e.tag!==13&&e.tag!==3?null:e}function Bi(e){if(e.tag===5||e.tag===6)return e.stateNode;throw Error(r(33))}function Vi(e){return e[Ni]||null}var Hi=[],Ui=-1;function Wi(e){return{current:e}}function W(e){0>Ui||(e.current=Hi[Ui],Hi[Ui]=null,Ui--)}function G(e,t){Ui++,Hi[Ui]=e.current,e.current=t}var Gi={},Ki=Wi(Gi),qi=Wi(!1),Ji=Gi;function Yi(e,t){var n=e.type.contextTypes;if(!n)return Gi;var r=e.stateNode;if(r&&r.__reactInternalMemoizedUnmaskedChildContext===t)return r.__reactInternalMemoizedMaskedChildContext;var i={},a;for(a in n)i[a]=t[a];return r&&(e=e.stateNode,e.__reactInternalMemoizedUnmaskedChildContext=t,e.__reactInternalMemoizedMaskedChildContext=i),i}function Xi(e){return e=e.childContextTypes,e!=null}function Zi(){W(qi),W(Ki)}function Qi(e,t,n){if(Ki.current!==Gi)throw Error(r(168));G(Ki,t),G(qi,n)}function $i(e,t,n){var i=e.stateNode;if(t=t.childContextTypes,typeof i.getChildContext!=`function`)return n;for(var a in i=i.getChildContext(),i)if(!(a in t))throw Error(r(108,fe(e)||`Unknown`,a));return M({},n,i)}function ea(e){return e=(e=e.stateNode)&&e.__reactInternalMemoizedMergedChildContext||Gi,Ji=Ki.current,G(Ki,e),G(qi,qi.current),!0}function ta(e,t,n){var i=e.stateNode;if(!i)throw Error(r(169));n?(e=$i(e,t,Ji),i.__reactInternalMemoizedMergedChildContext=e,W(qi),W(Ki),G(Ki,e)):W(qi),G(qi,n)}var na=null,ra=!1,ia=!1;function aa(e){na===null?na=[e]:na.push(e)}function oa(e){ra=!0,aa(e)}function sa(){if(!ia&&na!==null){ia=!0;var e=0,t=B;try{var n=na;for(B=1;e<n.length;e++){var r=n[e];do r=r(!0);while(r!==null)}na=null,ra=!1}catch(t){throw na!==null&&(na=na.slice(e+1)),pt(vt,sa),t}finally{B=t,ia=!1}}return null}var ca=[],la=0,ua=null,da=0,fa=[],pa=0,ma=null,ha=1,ga=``;function _a(e,t){ca[la++]=da,ca[la++]=ua,ua=e,da=t}function va(e,t,n){fa[pa++]=ha,fa[pa++]=ga,fa[pa++]=ma,ma=e;var r=ha;e=ga;var i=32-Et(r)-1;r&=~(1<<i),n+=1;var a=32-Et(t)+i;if(30<a){var o=i-i%5;a=(r&(1<<o)-1).toString(32),r>>=o,i-=o,ha=1<<32-Et(t)+i|n<<i|r,ga=a+e}else ha=1<<a|n<<i|r,ga=e}function ya(e){e.return!==null&&(_a(e,1),va(e,1,0))}function ba(e){for(;e===ua;)ua=ca[--la],ca[la]=null,da=ca[--la],ca[la]=null;for(;e===ma;)ma=fa[--pa],fa[pa]=null,ga=fa[--pa],fa[pa]=null,ha=fa[--pa],fa[pa]=null}var xa=null,Sa=null,K=!1,Ca=null;function wa(e,t){var n=Kl(5,null,null,0);n.elementType=`DELETED`,n.stateNode=t,n.return=e,t=e.deletions,t===null?(e.deletions=[n],e.flags|=16):t.push(n)}function Ta(e,t){switch(e.tag){case 5:var n=e.type;return t=t.nodeType!==1||n.toLowerCase()!==t.nodeName.toLowerCase()?null:t,t===null?!1:(e.stateNode=t,xa=e,Sa=ki(t.firstChild),!0);case 6:return t=e.pendingProps===``||t.nodeType!==3?null:t,t===null?!1:(e.stateNode=t,xa=e,Sa=null,!0);case 13:return t=t.nodeType===8?t:null,t===null?!1:(n=ma===null?null:{id:ha,overflow:ga},e.memoizedState={dehydrated:t,treeContext:n,retryLane:1073741824},n=Kl(18,null,null,0),n.stateNode=t,n.return=e,e.child=n,xa=e,Sa=null,!0);default:return!1}}function Ea(e){return(e.mode&1)!=0&&(e.flags&128)==0}function Da(e){if(K){var t=Sa;if(t){var n=t;if(!Ta(e,t)){if(Ea(e))throw Error(r(418));t=ki(n.nextSibling);var i=xa;t&&Ta(e,t)?wa(i,n):(e.flags=e.flags&-4097|2,K=!1,xa=e)}}else{if(Ea(e))throw Error(r(418));e.flags=e.flags&-4097|2,K=!1,xa=e}}}function Oa(e){for(e=e.return;e!==null&&e.tag!==5&&e.tag!==3&&e.tag!==13;)e=e.return;xa=e}function ka(e){if(e!==xa)return!1;if(!K)return Oa(e),K=!0,!1;var t;if((t=e.tag!==3)&&!(t=e.tag!==5)&&(t=e.type,t=t!==`head`&&t!==`body`&&!Si(e.type,e.memoizedProps)),t&&=Sa){if(Ea(e))throw Aa(),Error(r(418));for(;t;)wa(e,t),t=ki(t.nextSibling)}if(Oa(e),e.tag===13){if(e=e.memoizedState,e=e===null?null:e.dehydrated,!e)throw Error(r(317));a:{for(e=e.nextSibling,t=0;e;){if(e.nodeType===8){var n=e.data;if(n===`/$`){if(t===0){Sa=ki(e.nextSibling);break a}t--}else n!==`$`&&n!==`$!`&&n!==`$?`||t++}e=e.nextSibling}Sa=null}}else Sa=xa?ki(e.stateNode.nextSibling):null;return!0}function Aa(){for(var e=Sa;e;)e=ki(e.nextSibling)}function ja(){Sa=xa=null,K=!1}function Ma(e){Ca===null?Ca=[e]:Ca.push(e)}var Na=C.ReactCurrentBatchConfig;function Pa(e,t,n){if(e=n.ref,e!==null&&typeof e!=`function`&&typeof e!=`object`){if(n._owner){if(n=n._owner,n){if(n.tag!==1)throw Error(r(309));var i=n.stateNode}if(!i)throw Error(r(147,e));var a=i,o=``+e;return t!==null&&t.ref!==null&&typeof t.ref==`function`&&t.ref._stringRef===o?t.ref:(t=function(e){var t=a.refs;e===null?delete t[o]:t[o]=e},t._stringRef=o,t)}if(typeof e!=`string`)throw Error(r(284));if(!n._owner)throw Error(r(290,e))}return e}function Fa(e,t){throw e=Object.prototype.toString.call(t),Error(r(31,e===`[object Object]`?`object with keys {`+Object.keys(t).join(`, `)+`}`:e))}function Ia(e){var t=e._init;return t(e._payload)}function La(e){function t(t,n){if(e){var r=t.deletions;r===null?(t.deletions=[n],t.flags|=16):r.push(n)}}function n(n,r){if(!e)return null;for(;r!==null;)t(n,r),r=r.sibling;return null}function i(e,t){for(e=new Map;t!==null;)t.key===null?e.set(t.index,t):e.set(t.key,t),t=t.sibling;return e}function a(e,t){return e=Yl(e,t),e.index=0,e.sibling=null,e}function o(t,n,r){return t.index=r,e?(r=t.alternate,r===null?(t.flags|=2,n):(r=r.index,r<n?(t.flags|=2,n):r)):(t.flags|=1048576,n)}function s(t){return e&&t.alternate===null&&(t.flags|=2),t}function c(e,t,n,r){return t===null||t.tag!==6?(t=$l(n,e.mode,r),t.return=e,t):(t=a(t,n),t.return=e,t)}function l(e,t,n,r){var i=n.type;return i===E?d(e,t,n.props.children,r,n.key):t!==null&&(t.elementType===i||typeof i==`object`&&i&&i.$$typeof===ie&&Ia(i)===t.type)?(r=a(t,n.props),r.ref=Pa(e,t,n),r.return=e,r):(r=Xl(n.type,n.key,n.props,null,e.mode,r),r.ref=Pa(e,t,n),r.return=e,r)}function u(e,t,n,r){return t===null||t.tag!==4||t.stateNode.containerInfo!==n.containerInfo||t.stateNode.implementation!==n.implementation?(t=eu(n,e.mode,r),t.return=e,t):(t=a(t,n.children||[]),t.return=e,t)}function d(e,t,n,r,i){return t===null||t.tag!==7?(t=Zl(n,e.mode,r,i),t.return=e,t):(t=a(t,n),t.return=e,t)}function f(e,t,n){if(typeof t==`string`&&t!==``||typeof t==`number`)return t=$l(``+t,e.mode,n),t.return=e,t;if(typeof t==`object`&&t){switch(t.$$typeof){case w:return n=Xl(t.type,t.key,t.props,null,e.mode,n),n.ref=Pa(e,null,t),n.return=e,n;case T:return t=eu(t,e.mode,n),t.return=e,t;case ie:var r=t._init;return f(e,r(t._payload),n)}if(xe(t)||oe(t))return t=Zl(t,e.mode,n,null),t.return=e,t;Fa(e,t)}return null}function p(e,t,n,r){var i=t===null?null:t.key;if(typeof n==`string`&&n!==``||typeof n==`number`)return i===null?c(e,t,``+n,r):null;if(typeof n==`object`&&n){switch(n.$$typeof){case w:return n.key===i?l(e,t,n,r):null;case T:return n.key===i?u(e,t,n,r):null;case ie:return i=n._init,p(e,t,i(n._payload),r)}if(xe(n)||oe(n))return i===null?d(e,t,n,r,null):null;Fa(e,n)}return null}function m(e,t,n,r,i){if(typeof r==`string`&&r!==``||typeof r==`number`)return e=e.get(n)||null,c(t,e,``+r,i);if(typeof r==`object`&&r){switch(r.$$typeof){case w:return e=e.get(r.key===null?n:r.key)||null,l(t,e,r,i);case T:return e=e.get(r.key===null?n:r.key)||null,u(t,e,r,i);case ie:var a=r._init;return m(e,t,n,a(r._payload),i)}if(xe(r)||oe(r))return e=e.get(n)||null,d(t,e,r,i,null);Fa(t,r)}return null}function h(r,a,s,c){for(var l=null,u=null,d=a,h=a=0,g=null;d!==null&&h<s.length;h++){d.index>h?(g=d,d=null):g=d.sibling;var _=p(r,d,s[h],c);if(_===null){d===null&&(d=g);break}e&&d&&_.alternate===null&&t(r,d),a=o(_,a,h),u===null?l=_:u.sibling=_,u=_,d=g}if(h===s.length)return n(r,d),K&&_a(r,h),l;if(d===null){for(;h<s.length;h++)d=f(r,s[h],c),d!==null&&(a=o(d,a,h),u===null?l=d:u.sibling=d,u=d);return K&&_a(r,h),l}for(d=i(r,d);h<s.length;h++)g=m(d,r,h,s[h],c),g!==null&&(e&&g.alternate!==null&&d.delete(g.key===null?h:g.key),a=o(g,a,h),u===null?l=g:u.sibling=g,u=g);return e&&d.forEach(function(e){return t(r,e)}),K&&_a(r,h),l}function g(a,s,c,l){var u=oe(c);if(typeof u!=`function`)throw Error(r(150));if(c=u.call(c),c==null)throw Error(r(151));for(var d=u=null,h=s,g=s=0,_=null,v=c.next();h!==null&&!v.done;g++,v=c.next()){h.index>g?(_=h,h=null):_=h.sibling;var y=p(a,h,v.value,l);if(y===null){h===null&&(h=_);break}e&&h&&y.alternate===null&&t(a,h),s=o(y,s,g),d===null?u=y:d.sibling=y,d=y,h=_}if(v.done)return n(a,h),K&&_a(a,g),u;if(h===null){for(;!v.done;g++,v=c.next())v=f(a,v.value,l),v!==null&&(s=o(v,s,g),d===null?u=v:d.sibling=v,d=v);return K&&_a(a,g),u}for(h=i(a,h);!v.done;g++,v=c.next())v=m(h,a,g,v.value,l),v!==null&&(e&&v.alternate!==null&&h.delete(v.key===null?g:v.key),s=o(v,s,g),d===null?u=v:d.sibling=v,d=v);return e&&h.forEach(function(e){return t(a,e)}),K&&_a(a,g),u}function _(e,r,i,o){if(typeof i==`object`&&i&&i.type===E&&i.key===null&&(i=i.props.children),typeof i==`object`&&i){switch(i.$$typeof){case w:a:{for(var c=i.key,l=r;l!==null;){if(l.key===c){if(c=i.type,c===E){if(l.tag===7){n(e,l.sibling),r=a(l,i.props.children),r.return=e,e=r;break a}}else if(l.elementType===c||typeof c==`object`&&c&&c.$$typeof===ie&&Ia(c)===l.type){n(e,l.sibling),r=a(l,i.props),r.ref=Pa(e,l,i),r.return=e,e=r;break a}n(e,l);break}else t(e,l);l=l.sibling}i.type===E?(r=Zl(i.props.children,e.mode,o,i.key),r.return=e,e=r):(o=Xl(i.type,i.key,i.props,null,e.mode,o),o.ref=Pa(e,r,i),o.return=e,e=o)}return s(e);case T:a:{for(l=i.key;r!==null;){if(r.key===l)if(r.tag===4&&r.stateNode.containerInfo===i.containerInfo&&r.stateNode.implementation===i.implementation){n(e,r.sibling),r=a(r,i.children||[]),r.return=e,e=r;break a}else{n(e,r);break}else t(e,r);r=r.sibling}r=eu(i,e.mode,o),r.return=e,e=r}return s(e);case ie:return l=i._init,_(e,r,l(i._payload),o)}if(xe(i))return h(e,r,i,o);if(oe(i))return g(e,r,i,o);Fa(e,i)}return typeof i==`string`&&i!==``||typeof i==`number`?(i=``+i,r!==null&&r.tag===6?(n(e,r.sibling),r=a(r,i),r.return=e,e=r):(n(e,r),r=$l(i,e.mode,o),r.return=e,e=r),s(e)):n(e,r)}return _}var Ra=La(!0),za=La(!1),Ba=Wi(null),Va=null,Ha=null,Ua=null;function Wa(){Ua=Ha=Va=null}function Ga(e){var t=Ba.current;W(Ba),e._currentValue=t}function Ka(e,t,n){for(;e!==null;){var r=e.alternate;if((e.childLanes&t)===t?r!==null&&(r.childLanes&t)!==t&&(r.childLanes|=t):(e.childLanes|=t,r!==null&&(r.childLanes|=t)),e===n)break;e=e.return}}function qa(e,t){Va=e,Ua=Ha=null,e=e.dependencies,e!==null&&e.firstContext!==null&&((e.lanes&t)!==0&&(Fs=!0),e.firstContext=null)}function Ja(e){var t=e._currentValue;if(Ua!==e)if(e={context:e,memoizedValue:t,next:null},Ha===null){if(Va===null)throw Error(r(308));Ha=e,Va.dependencies={lanes:0,firstContext:e}}else Ha=Ha.next=e;return t}var Ya=null;function Xa(e){Ya===null?Ya=[e]:Ya.push(e)}function Za(e,t,n,r){var i=t.interleaved;return i===null?(n.next=n,Xa(t)):(n.next=i.next,i.next=n),t.interleaved=n,Qa(e,r)}function Qa(e,t){e.lanes|=t;var n=e.alternate;for(n!==null&&(n.lanes|=t),n=e,e=e.return;e!==null;)e.childLanes|=t,n=e.alternate,n!==null&&(n.childLanes|=t),n=e,e=e.return;return n.tag===3?n.stateNode:null}var $a=!1;function eo(e){e.updateQueue={baseState:e.memoizedState,firstBaseUpdate:null,lastBaseUpdate:null,shared:{pending:null,interleaved:null,lanes:0},effects:null}}function to(e,t){e=e.updateQueue,t.updateQueue===e&&(t.updateQueue={baseState:e.baseState,firstBaseUpdate:e.firstBaseUpdate,lastBaseUpdate:e.lastBaseUpdate,shared:e.shared,effects:e.effects})}function no(e,t){return{eventTime:e,lane:t,tag:0,payload:null,callback:null,next:null}}function ro(e,t,n){var r=e.updateQueue;if(r===null)return null;if(r=r.shared,X&2){var i=r.pending;return i===null?t.next=t:(t.next=i.next,i.next=t),r.pending=t,Qa(e,n)}return i=r.interleaved,i===null?(t.next=t,Xa(r)):(t.next=i.next,i.next=t),r.interleaved=t,Qa(e,n)}function io(e,t,n){if(t=t.updateQueue,t!==null&&(t=t.shared,n&4194240)){var r=t.lanes;r&=e.pendingLanes,n|=r,t.lanes=n,Vt(e,n)}}function ao(e,t){var n=e.updateQueue,r=e.alternate;if(r!==null&&(r=r.updateQueue,n===r)){var i=null,a=null;if(n=n.firstBaseUpdate,n!==null){do{var o={eventTime:n.eventTime,lane:n.lane,tag:n.tag,payload:n.payload,callback:n.callback,next:null};a===null?i=a=o:a=a.next=o,n=n.next}while(n!==null);a===null?i=a=t:a=a.next=t}else i=a=t;n={baseState:r.baseState,firstBaseUpdate:i,lastBaseUpdate:a,shared:r.shared,effects:r.effects},e.updateQueue=n;return}e=n.lastBaseUpdate,e===null?n.firstBaseUpdate=t:e.next=t,n.lastBaseUpdate=t}function oo(e,t,n,r){var i=e.updateQueue;$a=!1;var a=i.firstBaseUpdate,o=i.lastBaseUpdate,s=i.shared.pending;if(s!==null){i.shared.pending=null;var c=s,l=c.next;c.next=null,o===null?a=l:o.next=l,o=c;var u=e.alternate;u!==null&&(u=u.updateQueue,s=u.lastBaseUpdate,s!==o&&(s===null?u.firstBaseUpdate=l:s.next=l,u.lastBaseUpdate=c))}if(a!==null){var d=i.baseState;o=0,u=l=c=null,s=a;do{var f=s.lane,p=s.eventTime;if((r&f)===f){u!==null&&(u=u.next={eventTime:p,lane:0,tag:s.tag,payload:s.payload,callback:s.callback,next:null});a:{var m=e,h=s;switch(f=t,p=n,h.tag){case 1:if(m=h.payload,typeof m==`function`){d=m.call(p,d,f);break a}d=m;break a;case 3:m.flags=m.flags&-65537|128;case 0:if(m=h.payload,f=typeof m==`function`?m.call(p,d,f):m,f==null)break a;d=M({},d,f);break a;case 2:$a=!0}}s.callback!==null&&s.lane!==0&&(e.flags|=64,f=i.effects,f===null?i.effects=[s]:f.push(s))}else p={eventTime:p,lane:f,tag:s.tag,payload:s.payload,callback:s.callback,next:null},u===null?(l=u=p,c=d):u=u.next=p,o|=f;if(s=s.next,s===null){if(s=i.shared.pending,s===null)break;f=s,s=f.next,f.next=null,i.lastBaseUpdate=f,i.shared.pending=null}}while(1);if(u===null&&(c=d),i.baseState=c,i.firstBaseUpdate=l,i.lastBaseUpdate=u,t=i.shared.interleaved,t!==null){i=t;do o|=i.lane,i=i.next;while(i!==t)}else a===null&&(i.shared.lanes=0);Yc|=o,e.lanes=o,e.memoizedState=d}}function so(e,t,n){if(e=t.effects,t.effects=null,e!==null)for(t=0;t<e.length;t++){var i=e[t],a=i.callback;if(a!==null){if(i.callback=null,i=n,typeof a!=`function`)throw Error(r(191,a));a.call(i)}}}var co={},lo=Wi(co),uo=Wi(co),fo=Wi(co);function po(e){if(e===co)throw Error(r(174));return e}function mo(e,t){switch(G(fo,t),G(uo,e),G(lo,co),e=t.nodeType,e){case 9:case 11:t=(t=t.documentElement)?t.namespaceURI:De(null,``);break;default:e=e===8?t.parentNode:t,t=e.namespaceURI||null,e=e.tagName,t=De(t,e)}W(lo),G(lo,t)}function ho(){W(lo),W(uo),W(fo)}function go(e){po(fo.current);var t=po(lo.current),n=De(t,e.type);t!==n&&(G(uo,e),G(lo,n))}function _o(e){uo.current===e&&(W(lo),W(uo))}var q=Wi(0);function vo(e){for(var t=e;t!==null;){if(t.tag===13){var n=t.memoizedState;if(n!==null&&(n=n.dehydrated,n===null||n.data===`$?`||n.data===`$!`))return t}else if(t.tag===19&&t.memoizedProps.revealOrder!==void 0){if(t.flags&128)return t}else if(t.child!==null){t.child.return=t,t=t.child;continue}if(t===e)break;for(;t.sibling===null;){if(t.return===null||t.return===e)return null;t=t.return}t.sibling.return=t.return,t=t.sibling}return null}var yo=[];function bo(){for(var e=0;e<yo.length;e++)yo[e]._workInProgressVersionPrimary=null;yo.length=0}var xo=C.ReactCurrentDispatcher,So=C.ReactCurrentBatchConfig,Co=0,J=null,wo=null,To=null,Eo=!1,Do=!1,Oo=0,ko=0;function Ao(){throw Error(r(321))}function jo(e,t){if(t===null)return!1;for(var n=0;n<t.length&&n<e.length;n++)if(!Or(e[n],t[n]))return!1;return!0}function Mo(e,t,n,i,a,o){if(Co=o,J=t,t.memoizedState=null,t.updateQueue=null,t.lanes=0,xo.current=e===null||e.memoizedState===null?hs:gs,e=n(i,a),Do){o=0;do{if(Do=!1,Oo=0,25<=o)throw Error(r(301));o+=1,To=wo=null,t.updateQueue=null,xo.current=_s,e=n(i,a)}while(Do)}if(xo.current=ms,t=wo!==null&&wo.next!==null,Co=0,To=wo=J=null,Eo=!1,t)throw Error(r(300));return e}function No(){var e=Oo!==0;return Oo=0,e}function Po(){var e={memoizedState:null,baseState:null,baseQueue:null,queue:null,next:null};return To===null?J.memoizedState=To=e:To=To.next=e,To}function Fo(){if(wo===null){var e=J.alternate;e=e===null?null:e.memoizedState}else e=wo.next;var t=To===null?J.memoizedState:To.next;if(t!==null)To=t,wo=e;else{if(e===null)throw Error(r(310));wo=e,e={memoizedState:wo.memoizedState,baseState:wo.baseState,baseQueue:wo.baseQueue,queue:wo.queue,next:null},To===null?J.memoizedState=To=e:To=To.next=e}return To}function Io(e,t){return typeof t==`function`?t(e):t}function Lo(e){var t=Fo(),n=t.queue;if(n===null)throw Error(r(311));n.lastRenderedReducer=e;var i=wo,a=i.baseQueue,o=n.pending;if(o!==null){if(a!==null){var s=a.next;a.next=o.next,o.next=s}i.baseQueue=a=o,n.pending=null}if(a!==null){o=a.next,i=i.baseState;var c=s=null,l=null,u=o;do{var d=u.lane;if((Co&d)===d)l!==null&&(l=l.next={lane:0,action:u.action,hasEagerState:u.hasEagerState,eagerState:u.eagerState,next:null}),i=u.hasEagerState?u.eagerState:e(i,u.action);else{var f={lane:d,action:u.action,hasEagerState:u.hasEagerState,eagerState:u.eagerState,next:null};l===null?(c=l=f,s=i):l=l.next=f,J.lanes|=d,Yc|=d}u=u.next}while(u!==null&&u!==o);l===null?s=i:l.next=c,Or(i,t.memoizedState)||(Fs=!0),t.memoizedState=i,t.baseState=s,t.baseQueue=l,n.lastRenderedState=i}if(e=n.interleaved,e!==null){a=e;do o=a.lane,J.lanes|=o,Yc|=o,a=a.next;while(a!==e)}else a===null&&(n.lanes=0);return[t.memoizedState,n.dispatch]}function Ro(e){var t=Fo(),n=t.queue;if(n===null)throw Error(r(311));n.lastRenderedReducer=e;var i=n.dispatch,a=n.pending,o=t.memoizedState;if(a!==null){n.pending=null;var s=a=a.next;do o=e(o,s.action),s=s.next;while(s!==a);Or(o,t.memoizedState)||(Fs=!0),t.memoizedState=o,t.baseQueue===null&&(t.baseState=o),n.lastRenderedState=o}return[o,i]}function zo(){}function Bo(e,t){var n=J,i=Fo(),a=t(),o=!Or(i.memoizedState,a);if(o&&(i.memoizedState=a,Fs=!0),i=i.queue,Qo(Uo.bind(null,n,i,e),[e]),i.getSnapshot!==t||o||To!==null&&To.memoizedState.tag&1){if(n.flags|=2048,qo(9,Ho.bind(null,n,i,a,t),void 0,null),Wc===null)throw Error(r(349));Co&30||Vo(n,t,a)}return a}function Vo(e,t,n){e.flags|=16384,e={getSnapshot:t,value:n},t=J.updateQueue,t===null?(t={lastEffect:null,stores:null},J.updateQueue=t,t.stores=[e]):(n=t.stores,n===null?t.stores=[e]:n.push(e))}function Ho(e,t,n,r){t.value=n,t.getSnapshot=r,Wo(t)&&Go(e)}function Uo(e,t,n){return n(function(){Wo(t)&&Go(e)})}function Wo(e){var t=e.getSnapshot;e=e.value;try{var n=t();return!Or(e,n)}catch{return!0}}function Go(e){var t=Qa(e,1);t!==null&&hl(t,e,1,-1)}function Ko(e){var t=Po();return typeof e==`function`&&(e=e()),t.memoizedState=t.baseState=e,e={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:Io,lastRenderedState:e},t.queue=e,e=e.dispatch=us.bind(null,J,e),[t.memoizedState,e]}function qo(e,t,n,r){return e={tag:e,create:t,destroy:n,deps:r,next:null},t=J.updateQueue,t===null?(t={lastEffect:null,stores:null},J.updateQueue=t,t.lastEffect=e.next=e):(n=t.lastEffect,n===null?t.lastEffect=e.next=e:(r=n.next,n.next=e,e.next=r,t.lastEffect=e)),e}function Jo(){return Fo().memoizedState}function Yo(e,t,n,r){var i=Po();J.flags|=e,i.memoizedState=qo(1|t,n,void 0,r===void 0?null:r)}function Xo(e,t,n,r){var i=Fo();r=r===void 0?null:r;var a=void 0;if(wo!==null){var o=wo.memoizedState;if(a=o.destroy,r!==null&&jo(r,o.deps)){i.memoizedState=qo(t,n,a,r);return}}J.flags|=e,i.memoizedState=qo(1|t,n,a,r)}function Zo(e,t){return Yo(8390656,8,e,t)}function Qo(e,t){return Xo(2048,8,e,t)}function $o(e,t){return Xo(4,2,e,t)}function es(e,t){return Xo(4,4,e,t)}function ts(e,t){if(typeof t==`function`)return e=e(),t(e),function(){t(null)};if(t!=null)return e=e(),t.current=e,function(){t.current=null}}function ns(e,t,n){return n=n==null?null:n.concat([e]),Xo(4,4,ts.bind(null,t,e),n)}function rs(){}function is(e,t){var n=Fo();t=t===void 0?null:t;var r=n.memoizedState;return r!==null&&t!==null&&jo(t,r[1])?r[0]:(n.memoizedState=[e,t],e)}function as(e,t){var n=Fo();t=t===void 0?null:t;var r=n.memoizedState;return r!==null&&t!==null&&jo(t,r[1])?r[0]:(e=e(),n.memoizedState=[e,t],e)}function os(e,t,n){return Co&21?(Or(n,t)||(n=Lt(),J.lanes|=n,Yc|=n,e.baseState=!0),t):(e.baseState&&(e.baseState=!1,Fs=!0),e.memoizedState=n)}function ss(e,t){var n=B;B=n!==0&&4>n?n:4,e(!0);var r=So.transition;So.transition={};try{e(!1),t()}finally{B=n,So.transition=r}}function cs(){return Fo().memoizedState}function ls(e,t,n){var r=ml(e);if(n={lane:r,action:n,hasEagerState:!1,eagerState:null,next:null},ds(e))fs(t,n);else if(n=Za(e,t,n,r),n!==null){var i=pl();hl(n,e,r,i),ps(n,t,r)}}function us(e,t,n){var r=ml(e),i={lane:r,action:n,hasEagerState:!1,eagerState:null,next:null};if(ds(e))fs(t,i);else{var a=e.alternate;if(e.lanes===0&&(a===null||a.lanes===0)&&(a=t.lastRenderedReducer,a!==null))try{var o=t.lastRenderedState,s=a(o,n);if(i.hasEagerState=!0,i.eagerState=s,Or(s,o)){var c=t.interleaved;c===null?(i.next=i,Xa(t)):(i.next=c.next,c.next=i),t.interleaved=i;return}}catch{}n=Za(e,t,i,r),n!==null&&(i=pl(),hl(n,e,r,i),ps(n,t,r))}}function ds(e){var t=e.alternate;return e===J||t!==null&&t===J}function fs(e,t){Do=Eo=!0;var n=e.pending;n===null?t.next=t:(t.next=n.next,n.next=t),e.pending=t}function ps(e,t,n){if(n&4194240){var r=t.lanes;r&=e.pendingLanes,n|=r,t.lanes=n,Vt(e,n)}}var ms={readContext:Ja,useCallback:Ao,useContext:Ao,useEffect:Ao,useImperativeHandle:Ao,useInsertionEffect:Ao,useLayoutEffect:Ao,useMemo:Ao,useReducer:Ao,useRef:Ao,useState:Ao,useDebugValue:Ao,useDeferredValue:Ao,useTransition:Ao,useMutableSource:Ao,useSyncExternalStore:Ao,useId:Ao,unstable_isNewReconciler:!1},hs={readContext:Ja,useCallback:function(e,t){return Po().memoizedState=[e,t===void 0?null:t],e},useContext:Ja,useEffect:Zo,useImperativeHandle:function(e,t,n){return n=n==null?null:n.concat([e]),Yo(4194308,4,ts.bind(null,t,e),n)},useLayoutEffect:function(e,t){return Yo(4194308,4,e,t)},useInsertionEffect:function(e,t){return Yo(4,2,e,t)},useMemo:function(e,t){var n=Po();return t=t===void 0?null:t,e=e(),n.memoizedState=[e,t],e},useReducer:function(e,t,n){var r=Po();return t=n===void 0?t:n(t),r.memoizedState=r.baseState=t,e={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:e,lastRenderedState:t},r.queue=e,e=e.dispatch=ls.bind(null,J,e),[r.memoizedState,e]},useRef:function(e){var t=Po();return e={current:e},t.memoizedState=e},useState:Ko,useDebugValue:rs,useDeferredValue:function(e){return Po().memoizedState=e},useTransition:function(){var e=Ko(!1),t=e[0];return e=ss.bind(null,e[1]),Po().memoizedState=e,[t,e]},useMutableSource:function(){},useSyncExternalStore:function(e,t,n){var i=J,a=Po();if(K){if(n===void 0)throw Error(r(407));n=n()}else{if(n=t(),Wc===null)throw Error(r(349));Co&30||Vo(i,t,n)}a.memoizedState=n;var o={value:n,getSnapshot:t};return a.queue=o,Zo(Uo.bind(null,i,o,e),[e]),i.flags|=2048,qo(9,Ho.bind(null,i,o,n,t),void 0,null),n},useId:function(){var e=Po(),t=Wc.identifierPrefix;if(K){var n=ga,r=ha;n=(r&~(1<<32-Et(r)-1)).toString(32)+n,t=`:`+t+`R`+n,n=Oo++,0<n&&(t+=`H`+n.toString(32)),t+=`:`}else n=ko++,t=`:`+t+`r`+n.toString(32)+`:`;return e.memoizedState=t},unstable_isNewReconciler:!1},gs={readContext:Ja,useCallback:is,useContext:Ja,useEffect:Qo,useImperativeHandle:ns,useInsertionEffect:$o,useLayoutEffect:es,useMemo:as,useReducer:Lo,useRef:Jo,useState:function(){return Lo(Io)},useDebugValue:rs,useDeferredValue:function(e){return os(Fo(),wo.memoizedState,e)},useTransition:function(){return[Lo(Io)[0],Fo().memoizedState]},useMutableSource:zo,useSyncExternalStore:Bo,useId:cs,unstable_isNewReconciler:!1},_s={readContext:Ja,useCallback:is,useContext:Ja,useEffect:Qo,useImperativeHandle:ns,useInsertionEffect:$o,useLayoutEffect:es,useMemo:as,useReducer:Ro,useRef:Jo,useState:function(){return Ro(Io)},useDebugValue:rs,useDeferredValue:function(e){var t=Fo();return wo===null?t.memoizedState=e:os(t,wo.memoizedState,e)},useTransition:function(){return[Ro(Io)[0],Fo().memoizedState]},useMutableSource:zo,useSyncExternalStore:Bo,useId:cs,unstable_isNewReconciler:!1};function vs(e,t){if(e&&e.defaultProps){for(var n in t=M({},t),e=e.defaultProps,e)t[n]===void 0&&(t[n]=e[n]);return t}return t}function ys(e,t,n,r){t=e.memoizedState,n=n(r,t),n=n==null?t:M({},t,n),e.memoizedState=n,e.lanes===0&&(e.updateQueue.baseState=n)}var bs={isMounted:function(e){return(e=e._reactInternals)?st(e)===e:!1},enqueueSetState:function(e,t,n){e=e._reactInternals;var r=pl(),i=ml(e),a=no(r,i);a.payload=t,n!=null&&(a.callback=n),t=ro(e,a,i),t!==null&&(hl(t,e,i,r),io(t,e,i))},enqueueReplaceState:function(e,t,n){e=e._reactInternals;var r=pl(),i=ml(e),a=no(r,i);a.tag=1,a.payload=t,n!=null&&(a.callback=n),t=ro(e,a,i),t!==null&&(hl(t,e,i,r),io(t,e,i))},enqueueForceUpdate:function(e,t){e=e._reactInternals;var n=pl(),r=ml(e),i=no(n,r);i.tag=2,t!=null&&(i.callback=t),t=ro(e,i,r),t!==null&&(hl(t,e,r,n),io(t,e,r))}};function xs(e,t,n,r,i,a,o){return e=e.stateNode,typeof e.shouldComponentUpdate==`function`?e.shouldComponentUpdate(r,a,o):t.prototype&&t.prototype.isPureReactComponent?!kr(n,r)||!kr(i,a):!0}function Ss(e,t,n){var r=!1,i=Gi,a=t.contextType;return typeof a==`object`&&a?a=Ja(a):(i=Xi(t)?Ji:Ki.current,r=t.contextTypes,a=(r=r!=null)?Yi(e,i):Gi),t=new t(n,a),e.memoizedState=t.state!==null&&t.state!==void 0?t.state:null,t.updater=bs,e.stateNode=t,t._reactInternals=e,r&&(e=e.stateNode,e.__reactInternalMemoizedUnmaskedChildContext=i,e.__reactInternalMemoizedMaskedChildContext=a),t}function Cs(e,t,n,r){e=t.state,typeof t.componentWillReceiveProps==`function`&&t.componentWillReceiveProps(n,r),typeof t.UNSAFE_componentWillReceiveProps==`function`&&t.UNSAFE_componentWillReceiveProps(n,r),t.state!==e&&bs.enqueueReplaceState(t,t.state,null)}function ws(e,t,n,r){var i=e.stateNode;i.props=n,i.state=e.memoizedState,i.refs={},eo(e);var a=t.contextType;typeof a==`object`&&a?i.context=Ja(a):(a=Xi(t)?Ji:Ki.current,i.context=Yi(e,a)),i.state=e.memoizedState,a=t.getDerivedStateFromProps,typeof a==`function`&&(ys(e,t,a,n),i.state=e.memoizedState),typeof t.getDerivedStateFromProps==`function`||typeof i.getSnapshotBeforeUpdate==`function`||typeof i.UNSAFE_componentWillMount!=`function`&&typeof i.componentWillMount!=`function`||(t=i.state,typeof i.componentWillMount==`function`&&i.componentWillMount(),typeof i.UNSAFE_componentWillMount==`function`&&i.UNSAFE_componentWillMount(),t!==i.state&&bs.enqueueReplaceState(i,i.state,null),oo(e,n,i,r),i.state=e.memoizedState),typeof i.componentDidMount==`function`&&(e.flags|=4194308)}function Ts(e,t){try{var n=``,r=t;do n+=ue(r),r=r.return;while(r);var i=n}catch(e){i=`
Error generating stack: `+e.message+`
`+e.stack}return{value:e,source:t,stack:i,digest:null}}function Es(e,t,n){return{value:e,source:null,stack:n??null,digest:t??null}}function Ds(e,t){try{console.error(t.value)}catch(e){setTimeout(function(){throw e})}}var Os=typeof WeakMap==`function`?WeakMap:Map;function ks(e,t,n){n=no(-1,n),n.tag=3,n.payload={element:null};var r=t.value;return n.callback=function(){rl||(rl=!0,il=r),Ds(e,t)},n}function As(e,t,n){n=no(-1,n),n.tag=3;var r=e.type.getDerivedStateFromError;if(typeof r==`function`){var i=t.value;n.payload=function(){return r(i)},n.callback=function(){Ds(e,t)}}var a=e.stateNode;return a!==null&&typeof a.componentDidCatch==`function`&&(n.callback=function(){Ds(e,t),typeof r!=`function`&&(al===null?al=new Set([this]):al.add(this));var n=t.stack;this.componentDidCatch(t.value,{componentStack:n===null?``:n})}),n}function js(e,t,n){var r=e.pingCache;if(r===null){r=e.pingCache=new Os;var i=new Set;r.set(t,i)}else i=r.get(t),i===void 0&&(i=new Set,r.set(t,i));i.has(n)||(i.add(n),e=zl.bind(null,e,t,n),t.then(e,e))}function Ms(e){do{var t;if((t=e.tag===13)&&(t=e.memoizedState,t=t===null?!0:t.dehydrated!==null),t)return e;e=e.return}while(e!==null);return null}function Ns(e,t,n,r,i){return e.mode&1?(e.flags|=65536,e.lanes=i,e):(e===t?e.flags|=65536:(e.flags|=128,n.flags|=131072,n.flags&=-52805,n.tag===1&&(n.alternate===null?n.tag=17:(t=no(-1,1),t.tag=2,ro(n,t,1))),n.lanes|=1),e)}var Ps=C.ReactCurrentOwner,Fs=!1;function Is(e,t,n,r){t.child=e===null?za(t,null,n,r):Ra(t,e.child,n,r)}function Ls(e,t,n,r,i){n=n.render;var a=t.ref;return qa(t,i),r=Mo(e,t,n,r,a,i),n=No(),e!==null&&!Fs?(t.updateQueue=e.updateQueue,t.flags&=-2053,e.lanes&=~i,rc(e,t,i)):(K&&n&&ya(t),t.flags|=1,Is(e,t,r,i),t.child)}function Rs(e,t,n,r,i){if(e===null){var a=n.type;return typeof a==`function`&&!ql(a)&&a.defaultProps===void 0&&n.compare===null&&n.defaultProps===void 0?(t.tag=15,t.type=a,zs(e,t,a,r,i)):(e=Xl(n.type,null,r,t,t.mode,i),e.ref=t.ref,e.return=t,t.child=e)}if(a=e.child,(e.lanes&i)===0){var o=a.memoizedProps;if(n=n.compare,n=n===null?kr:n,n(o,r)&&e.ref===t.ref)return rc(e,t,i)}return t.flags|=1,e=Yl(a,r),e.ref=t.ref,e.return=t,t.child=e}function zs(e,t,n,r,i){if(e!==null){var a=e.memoizedProps;if(kr(a,r)&&e.ref===t.ref)if(Fs=!1,t.pendingProps=r=a,(e.lanes&i)!==0)e.flags&131072&&(Fs=!0);else return t.lanes=e.lanes,rc(e,t,i)}return Hs(e,t,n,r,i)}function Bs(e,t,n){var r=t.pendingProps,i=r.children,a=e===null?null:e.memoizedState;if(r.mode===`hidden`)if(!(t.mode&1))t.memoizedState={baseLanes:0,cachePool:null,transitions:null},G(qc,Kc),Kc|=n;else{if(!(n&1073741824))return e=a===null?n:a.baseLanes|n,t.lanes=t.childLanes=1073741824,t.memoizedState={baseLanes:e,cachePool:null,transitions:null},t.updateQueue=null,G(qc,Kc),Kc|=e,null;t.memoizedState={baseLanes:0,cachePool:null,transitions:null},r=a===null?n:a.baseLanes,G(qc,Kc),Kc|=r}else a===null?r=n:(r=a.baseLanes|n,t.memoizedState=null),G(qc,Kc),Kc|=r;return Is(e,t,i,n),t.child}function Vs(e,t){var n=t.ref;(e===null&&n!==null||e!==null&&e.ref!==n)&&(t.flags|=512,t.flags|=2097152)}function Hs(e,t,n,r,i){var a=Xi(n)?Ji:Ki.current;return a=Yi(t,a),qa(t,i),n=Mo(e,t,n,r,a,i),r=No(),e!==null&&!Fs?(t.updateQueue=e.updateQueue,t.flags&=-2053,e.lanes&=~i,rc(e,t,i)):(K&&r&&ya(t),t.flags|=1,Is(e,t,n,i),t.child)}function Us(e,t,n,r,i){if(Xi(n)){var a=!0;ea(t)}else a=!1;if(qa(t,i),t.stateNode===null)nc(e,t),Ss(t,n,r),ws(t,n,r,i),r=!0;else if(e===null){var o=t.stateNode,s=t.memoizedProps;o.props=s;var c=o.context,l=n.contextType;typeof l==`object`&&l?l=Ja(l):(l=Xi(n)?Ji:Ki.current,l=Yi(t,l));var u=n.getDerivedStateFromProps,d=typeof u==`function`||typeof o.getSnapshotBeforeUpdate==`function`;d||typeof o.UNSAFE_componentWillReceiveProps!=`function`&&typeof o.componentWillReceiveProps!=`function`||(s!==r||c!==l)&&Cs(t,o,r,l),$a=!1;var f=t.memoizedState;o.state=f,oo(t,r,o,i),c=t.memoizedState,s!==r||f!==c||qi.current||$a?(typeof u==`function`&&(ys(t,n,u,r),c=t.memoizedState),(s=$a||xs(t,n,s,r,f,c,l))?(d||typeof o.UNSAFE_componentWillMount!=`function`&&typeof o.componentWillMount!=`function`||(typeof o.componentWillMount==`function`&&o.componentWillMount(),typeof o.UNSAFE_componentWillMount==`function`&&o.UNSAFE_componentWillMount()),typeof o.componentDidMount==`function`&&(t.flags|=4194308)):(typeof o.componentDidMount==`function`&&(t.flags|=4194308),t.memoizedProps=r,t.memoizedState=c),o.props=r,o.state=c,o.context=l,r=s):(typeof o.componentDidMount==`function`&&(t.flags|=4194308),r=!1)}else{o=t.stateNode,to(e,t),s=t.memoizedProps,l=t.type===t.elementType?s:vs(t.type,s),o.props=l,d=t.pendingProps,f=o.context,c=n.contextType,typeof c==`object`&&c?c=Ja(c):(c=Xi(n)?Ji:Ki.current,c=Yi(t,c));var p=n.getDerivedStateFromProps;(u=typeof p==`function`||typeof o.getSnapshotBeforeUpdate==`function`)||typeof o.UNSAFE_componentWillReceiveProps!=`function`&&typeof o.componentWillReceiveProps!=`function`||(s!==d||f!==c)&&Cs(t,o,r,c),$a=!1,f=t.memoizedState,o.state=f,oo(t,r,o,i);var m=t.memoizedState;s!==d||f!==m||qi.current||$a?(typeof p==`function`&&(ys(t,n,p,r),m=t.memoizedState),(l=$a||xs(t,n,l,r,f,m,c)||!1)?(u||typeof o.UNSAFE_componentWillUpdate!=`function`&&typeof o.componentWillUpdate!=`function`||(typeof o.componentWillUpdate==`function`&&o.componentWillUpdate(r,m,c),typeof o.UNSAFE_componentWillUpdate==`function`&&o.UNSAFE_componentWillUpdate(r,m,c)),typeof o.componentDidUpdate==`function`&&(t.flags|=4),typeof o.getSnapshotBeforeUpdate==`function`&&(t.flags|=1024)):(typeof o.componentDidUpdate!=`function`||s===e.memoizedProps&&f===e.memoizedState||(t.flags|=4),typeof o.getSnapshotBeforeUpdate!=`function`||s===e.memoizedProps&&f===e.memoizedState||(t.flags|=1024),t.memoizedProps=r,t.memoizedState=m),o.props=r,o.state=m,o.context=c,r=l):(typeof o.componentDidUpdate!=`function`||s===e.memoizedProps&&f===e.memoizedState||(t.flags|=4),typeof o.getSnapshotBeforeUpdate!=`function`||s===e.memoizedProps&&f===e.memoizedState||(t.flags|=1024),r=!1)}return Ws(e,t,n,r,a,i)}function Ws(e,t,n,r,i,a){Vs(e,t);var o=(t.flags&128)!=0;if(!r&&!o)return i&&ta(t,n,!1),rc(e,t,a);r=t.stateNode,Ps.current=t;var s=o&&typeof n.getDerivedStateFromError!=`function`?null:r.render();return t.flags|=1,e!==null&&o?(t.child=Ra(t,e.child,null,a),t.child=Ra(t,null,s,a)):Is(e,t,s,a),t.memoizedState=r.state,i&&ta(t,n,!0),t.child}function Gs(e){var t=e.stateNode;t.pendingContext?Qi(e,t.pendingContext,t.pendingContext!==t.context):t.context&&Qi(e,t.context,!1),mo(e,t.containerInfo)}function Ks(e,t,n,r,i){return ja(),Ma(i),t.flags|=256,Is(e,t,n,r),t.child}var qs={dehydrated:null,treeContext:null,retryLane:0};function Js(e){return{baseLanes:e,cachePool:null,transitions:null}}function Ys(e,t,n){var r=t.pendingProps,i=q.current,a=!1,o=(t.flags&128)!=0,s;if((s=o)||(s=e!==null&&e.memoizedState===null?!1:(i&2)!=0),s?(a=!0,t.flags&=-129):(e===null||e.memoizedState!==null)&&(i|=1),G(q,i&1),e===null)return Da(t),e=t.memoizedState,e!==null&&(e=e.dehydrated,e!==null)?(t.mode&1?e.data===`$!`?t.lanes=8:t.lanes=1073741824:t.lanes=1,null):(o=r.children,e=r.fallback,a?(r=t.mode,a=t.child,o={mode:`hidden`,children:o},!(r&1)&&a!==null?(a.childLanes=0,a.pendingProps=o):a=Ql(o,r,0,null),e=Zl(e,r,n,null),a.return=t,e.return=t,a.sibling=e,t.child=a,t.child.memoizedState=Js(n),t.memoizedState=qs,e):Xs(t,o));if(i=e.memoizedState,i!==null&&(s=i.dehydrated,s!==null))return Qs(e,t,o,r,s,i,n);if(a){a=r.fallback,o=t.mode,i=e.child,s=i.sibling;var c={mode:`hidden`,children:r.children};return!(o&1)&&t.child!==i?(r=t.child,r.childLanes=0,r.pendingProps=c,t.deletions=null):(r=Yl(i,c),r.subtreeFlags=i.subtreeFlags&14680064),s===null?(a=Zl(a,o,n,null),a.flags|=2):a=Yl(s,a),a.return=t,r.return=t,r.sibling=a,t.child=r,r=a,a=t.child,o=e.child.memoizedState,o=o===null?Js(n):{baseLanes:o.baseLanes|n,cachePool:null,transitions:o.transitions},a.memoizedState=o,a.childLanes=e.childLanes&~n,t.memoizedState=qs,r}return a=e.child,e=a.sibling,r=Yl(a,{mode:`visible`,children:r.children}),!(t.mode&1)&&(r.lanes=n),r.return=t,r.sibling=null,e!==null&&(n=t.deletions,n===null?(t.deletions=[e],t.flags|=16):n.push(e)),t.child=r,t.memoizedState=null,r}function Xs(e,t){return t=Ql({mode:`visible`,children:t},e.mode,0,null),t.return=e,e.child=t}function Zs(e,t,n,r){return r!==null&&Ma(r),Ra(t,e.child,null,n),e=Xs(t,t.pendingProps.children),e.flags|=2,t.memoizedState=null,e}function Qs(e,t,n,i,a,o,s){if(n)return t.flags&256?(t.flags&=-257,i=Es(Error(r(422))),Zs(e,t,s,i)):t.memoizedState===null?(o=i.fallback,a=t.mode,i=Ql({mode:`visible`,children:i.children},a,0,null),o=Zl(o,a,s,null),o.flags|=2,i.return=t,o.return=t,i.sibling=o,t.child=i,t.mode&1&&Ra(t,e.child,null,s),t.child.memoizedState=Js(s),t.memoizedState=qs,o):(t.child=e.child,t.flags|=128,null);if(!(t.mode&1))return Zs(e,t,s,null);if(a.data===`$!`){if(i=a.nextSibling&&a.nextSibling.dataset,i)var c=i.dgst;return i=c,o=Error(r(419)),i=Es(o,i,void 0),Zs(e,t,s,i)}if(c=(s&e.childLanes)!==0,Fs||c){if(i=Wc,i!==null){switch(s&-s){case 4:a=2;break;case 16:a=8;break;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:a=32;break;case 536870912:a=268435456;break;default:a=0}a=(a&(i.suspendedLanes|s))===0?a:0,a!==0&&a!==o.retryLane&&(o.retryLane=a,Qa(e,a),hl(i,e,a,-1))}return kl(),i=Es(Error(r(421))),Zs(e,t,s,i)}return a.data===`$?`?(t.flags|=128,t.child=e.child,t=Vl.bind(null,e),a._reactRetry=t,null):(e=o.treeContext,Sa=ki(a.nextSibling),xa=t,K=!0,Ca=null,e!==null&&(fa[pa++]=ha,fa[pa++]=ga,fa[pa++]=ma,ha=e.id,ga=e.overflow,ma=t),t=Xs(t,i.children),t.flags|=4096,t)}function $s(e,t,n){e.lanes|=t;var r=e.alternate;r!==null&&(r.lanes|=t),Ka(e.return,t,n)}function ec(e,t,n,r,i){var a=e.memoizedState;a===null?e.memoizedState={isBackwards:t,rendering:null,renderingStartTime:0,last:r,tail:n,tailMode:i}:(a.isBackwards=t,a.rendering=null,a.renderingStartTime=0,a.last=r,a.tail=n,a.tailMode=i)}function tc(e,t,n){var r=t.pendingProps,i=r.revealOrder,a=r.tail;if(Is(e,t,r.children,n),r=q.current,r&2)r=r&1|2,t.flags|=128;else{if(e!==null&&e.flags&128)a:for(e=t.child;e!==null;){if(e.tag===13)e.memoizedState!==null&&$s(e,n,t);else if(e.tag===19)$s(e,n,t);else if(e.child!==null){e.child.return=e,e=e.child;continue}if(e===t)break a;for(;e.sibling===null;){if(e.return===null||e.return===t)break a;e=e.return}e.sibling.return=e.return,e=e.sibling}r&=1}if(G(q,r),!(t.mode&1))t.memoizedState=null;else switch(i){case`forwards`:for(n=t.child,i=null;n!==null;)e=n.alternate,e!==null&&vo(e)===null&&(i=n),n=n.sibling;n=i,n===null?(i=t.child,t.child=null):(i=n.sibling,n.sibling=null),ec(t,!1,i,n,a);break;case`backwards`:for(n=null,i=t.child,t.child=null;i!==null;){if(e=i.alternate,e!==null&&vo(e)===null){t.child=i;break}e=i.sibling,i.sibling=n,n=i,i=e}ec(t,!0,n,null,a);break;case`together`:ec(t,!1,null,null,void 0);break;default:t.memoizedState=null}return t.child}function nc(e,t){!(t.mode&1)&&e!==null&&(e.alternate=null,t.alternate=null,t.flags|=2)}function rc(e,t,n){if(e!==null&&(t.dependencies=e.dependencies),Yc|=t.lanes,(n&t.childLanes)===0)return null;if(e!==null&&t.child!==e.child)throw Error(r(153));if(t.child!==null){for(e=t.child,n=Yl(e,e.pendingProps),t.child=n,n.return=t;e.sibling!==null;)e=e.sibling,n=n.sibling=Yl(e,e.pendingProps),n.return=t;n.sibling=null}return t.child}function ic(e,t,n){switch(t.tag){case 3:Gs(t),ja();break;case 5:go(t);break;case 1:Xi(t.type)&&ea(t);break;case 4:mo(t,t.stateNode.containerInfo);break;case 10:var r=t.type._context,i=t.memoizedProps.value;G(Ba,r._currentValue),r._currentValue=i;break;case 13:if(r=t.memoizedState,r!==null)return r.dehydrated===null?(n&t.child.childLanes)===0?(G(q,q.current&1),e=rc(e,t,n),e===null?null:e.sibling):Ys(e,t,n):(G(q,q.current&1),t.flags|=128,null);G(q,q.current&1);break;case 19:if(r=(n&t.childLanes)!==0,e.flags&128){if(r)return tc(e,t,n);t.flags|=128}if(i=t.memoizedState,i!==null&&(i.rendering=null,i.tail=null,i.lastEffect=null),G(q,q.current),r)break;return null;case 22:case 23:return t.lanes=0,Bs(e,t,n)}return rc(e,t,n)}var ac=function(e,t){for(var n=t.child;n!==null;){if(n.tag===5||n.tag===6)e.appendChild(n.stateNode);else if(n.tag!==4&&n.child!==null){n.child.return=n,n=n.child;continue}if(n===t)break;for(;n.sibling===null;){if(n.return===null||n.return===t)return;n=n.return}n.sibling.return=n.return,n=n.sibling}},oc=function(e,t,n,r){var i=e.memoizedProps;if(i!==r){e=t.stateNode,po(lo.current);var o=null;switch(n){case`input`:i=_e(e,i),r=_e(e,r),o=[];break;case`select`:i=M({},i,{value:void 0}),r=M({},r,{value:void 0}),o=[];break;case`textarea`:i=Ce(e,i),r=Ce(e,r),o=[];break;default:typeof i.onClick!=`function`&&typeof r.onClick==`function`&&(e.onclick=yi)}Ie(n,r);var s;for(u in n=null,i)if(!r.hasOwnProperty(u)&&i.hasOwnProperty(u)&&i[u]!=null)if(u===`style`){var c=i[u];for(s in c)c.hasOwnProperty(s)&&(n||={},n[s]=``)}else u!==`dangerouslySetInnerHTML`&&u!==`children`&&u!==`suppressContentEditableWarning`&&u!==`suppressHydrationWarning`&&u!==`autoFocus`&&(a.hasOwnProperty(u)?o||=[]:(o||=[]).push(u,null));for(u in r){var l=r[u];if(c=i?.[u],r.hasOwnProperty(u)&&l!==c&&(l!=null||c!=null))if(u===`style`)if(c){for(s in c)!c.hasOwnProperty(s)||l&&l.hasOwnProperty(s)||(n||={},n[s]=``);for(s in l)l.hasOwnProperty(s)&&c[s]!==l[s]&&(n||={},n[s]=l[s])}else n||(o||=[],o.push(u,n)),n=l;else u===`dangerouslySetInnerHTML`?(l=l?l.__html:void 0,c=c?c.__html:void 0,l!=null&&c!==l&&(o||=[]).push(u,l)):u===`children`?typeof l!=`string`&&typeof l!=`number`||(o||=[]).push(u,``+l):u!==`suppressContentEditableWarning`&&u!==`suppressHydrationWarning`&&(a.hasOwnProperty(u)?(l!=null&&u===`onScroll`&&U(`scroll`,e),o||c===l||(o=[])):(o||=[]).push(u,l))}n&&(o||=[]).push(`style`,n);var u=o;(t.updateQueue=u)&&(t.flags|=4)}},sc=function(e,t,n,r){n!==r&&(t.flags|=4)};function cc(e,t){if(!K)switch(e.tailMode){case`hidden`:t=e.tail;for(var n=null;t!==null;)t.alternate!==null&&(n=t),t=t.sibling;n===null?e.tail=null:n.sibling=null;break;case`collapsed`:n=e.tail;for(var r=null;n!==null;)n.alternate!==null&&(r=n),n=n.sibling;r===null?t||e.tail===null?e.tail=null:e.tail.sibling=null:r.sibling=null}}function lc(e){var t=e.alternate!==null&&e.alternate.child===e.child,n=0,r=0;if(t)for(var i=e.child;i!==null;)n|=i.lanes|i.childLanes,r|=i.subtreeFlags&14680064,r|=i.flags&14680064,i.return=e,i=i.sibling;else for(i=e.child;i!==null;)n|=i.lanes|i.childLanes,r|=i.subtreeFlags,r|=i.flags,i.return=e,i=i.sibling;return e.subtreeFlags|=r,e.childLanes=n,t}function uc(e,t,n){var i=t.pendingProps;switch(ba(t),t.tag){case 2:case 16:case 15:case 0:case 11:case 7:case 8:case 12:case 9:case 14:return lc(t),null;case 1:return Xi(t.type)&&Zi(),lc(t),null;case 3:return i=t.stateNode,ho(),W(qi),W(Ki),bo(),i.pendingContext&&(i.context=i.pendingContext,i.pendingContext=null),(e===null||e.child===null)&&(ka(t)?t.flags|=4:e===null||e.memoizedState.isDehydrated&&!(t.flags&256)||(t.flags|=1024,Ca!==null&&(yl(Ca),Ca=null))),lc(t),null;case 5:_o(t);var o=po(fo.current);if(n=t.type,e!==null&&t.stateNode!=null)oc(e,t,n,i,o),e.ref!==t.ref&&(t.flags|=512,t.flags|=2097152);else{if(!i){if(t.stateNode===null)throw Error(r(166));return lc(t),null}if(e=po(lo.current),ka(t)){i=t.stateNode,n=t.type;var s=t.memoizedProps;switch(i[Mi]=t,i[Ni]=s,e=(t.mode&1)!=0,n){case`dialog`:U(`cancel`,i),U(`close`,i);break;case`iframe`:case`object`:case`embed`:U(`load`,i);break;case`video`:case`audio`:for(o=0;o<ni.length;o++)U(ni[o],i);break;case`source`:U(`error`,i);break;case`img`:case`image`:case`link`:U(`error`,i),U(`load`,i);break;case`details`:U(`toggle`,i);break;case`input`:ve(i,s),U(`invalid`,i);break;case`select`:i._wrapperState={wasMultiple:!!s.multiple},U(`invalid`,i);break;case`textarea`:we(i,s),U(`invalid`,i)}for(var c in Ie(n,s),o=null,s)if(s.hasOwnProperty(c)){var l=s[c];c===`children`?typeof l==`string`?i.textContent!==l&&(!0!==s.suppressHydrationWarning&&vi(i.textContent,l,e),o=[`children`,l]):typeof l==`number`&&i.textContent!==``+l&&(!0!==s.suppressHydrationWarning&&vi(i.textContent,l,e),o=[`children`,``+l]):a.hasOwnProperty(c)&&l!=null&&c===`onScroll`&&U(`scroll`,i)}switch(n){case`input`:P(i),L(i,s,!0);break;case`textarea`:P(i),Te(i);break;case`select`:case`option`:break;default:typeof s.onClick==`function`&&(i.onclick=yi)}i=o,t.updateQueue=i,i!==null&&(t.flags|=4)}else{c=o.nodeType===9?o:o.ownerDocument,e===`http://www.w3.org/1999/xhtml`&&(e=Ee(n)),e===`http://www.w3.org/1999/xhtml`?n===`script`?(e=c.createElement(`div`),e.innerHTML=`<script><\/script>`,e=e.removeChild(e.firstChild)):typeof i.is==`string`?e=c.createElement(n,{is:i.is}):(e=c.createElement(n),n===`select`&&(c=e,i.multiple?c.multiple=!0:i.size&&(c.size=i.size))):e=c.createElementNS(e,n),e[Mi]=t,e[Ni]=i,ac(e,t,!1,!1),t.stateNode=e;a:{switch(c=Le(n,i),n){case`dialog`:U(`cancel`,e),U(`close`,e),o=i;break;case`iframe`:case`object`:case`embed`:U(`load`,e),o=i;break;case`video`:case`audio`:for(o=0;o<ni.length;o++)U(ni[o],e);o=i;break;case`source`:U(`error`,e),o=i;break;case`img`:case`image`:case`link`:U(`error`,e),U(`load`,e),o=i;break;case`details`:U(`toggle`,e),o=i;break;case`input`:ve(e,i),o=_e(e,i),U(`invalid`,e);break;case`option`:o=i;break;case`select`:e._wrapperState={wasMultiple:!!i.multiple},o=M({},i,{value:void 0}),U(`invalid`,e);break;case`textarea`:we(e,i),o=Ce(e,i),U(`invalid`,e);break;default:o=i}for(s in Ie(n,o),l=o,l)if(l.hasOwnProperty(s)){var u=l[s];s===`style`?Pe(e,u):s===`dangerouslySetInnerHTML`?(u=u?u.__html:void 0,u!=null&&ke(e,u)):s===`children`?typeof u==`string`?(n!==`textarea`||u!==``)&&Ae(e,u):typeof u==`number`&&Ae(e,``+u):s!==`suppressContentEditableWarning`&&s!==`suppressHydrationWarning`&&s!==`autoFocus`&&(a.hasOwnProperty(s)?u!=null&&s===`onScroll`&&U(`scroll`,e):u!=null&&S(e,s,u,c))}switch(n){case`input`:P(e),L(e,i,!1);break;case`textarea`:P(e),Te(e);break;case`option`:i.value!=null&&e.setAttribute(`value`,``+pe(i.value));break;case`select`:e.multiple=!!i.multiple,s=i.value,s==null?i.defaultValue!=null&&Se(e,!!i.multiple,i.defaultValue,!0):Se(e,!!i.multiple,s,!1);break;default:typeof o.onClick==`function`&&(e.onclick=yi)}switch(n){case`button`:case`input`:case`select`:case`textarea`:i=!!i.autoFocus;break a;case`img`:i=!0;break a;default:i=!1}}i&&(t.flags|=4)}t.ref!==null&&(t.flags|=512,t.flags|=2097152)}return lc(t),null;case 6:if(e&&t.stateNode!=null)sc(e,t,e.memoizedProps,i);else{if(typeof i!=`string`&&t.stateNode===null)throw Error(r(166));if(n=po(fo.current),po(lo.current),ka(t)){if(i=t.stateNode,n=t.memoizedProps,i[Mi]=t,(s=i.nodeValue!==n)&&(e=xa,e!==null))switch(e.tag){case 3:vi(i.nodeValue,n,(e.mode&1)!=0);break;case 5:!0!==e.memoizedProps.suppressHydrationWarning&&vi(i.nodeValue,n,(e.mode&1)!=0)}s&&(t.flags|=4)}else i=(n.nodeType===9?n:n.ownerDocument).createTextNode(i),i[Mi]=t,t.stateNode=i}return lc(t),null;case 13:if(W(q),i=t.memoizedState,e===null||e.memoizedState!==null&&e.memoizedState.dehydrated!==null){if(K&&Sa!==null&&t.mode&1&&!(t.flags&128))Aa(),ja(),t.flags|=98560,s=!1;else if(s=ka(t),i!==null&&i.dehydrated!==null){if(e===null){if(!s)throw Error(r(318));if(s=t.memoizedState,s=s===null?null:s.dehydrated,!s)throw Error(r(317));s[Mi]=t}else ja(),!(t.flags&128)&&(t.memoizedState=null),t.flags|=4;lc(t),s=!1}else Ca!==null&&(yl(Ca),Ca=null),s=!0;if(!s)return t.flags&65536?t:null}return t.flags&128?(t.lanes=n,t):(i=i!==null,i!==(e!==null&&e.memoizedState!==null)&&i&&(t.child.flags|=8192,t.mode&1&&(e===null||q.current&1?Q===0&&(Q=3):kl())),t.updateQueue!==null&&(t.flags|=4),lc(t),null);case 4:return ho(),e===null&&ci(t.stateNode.containerInfo),lc(t),null;case 10:return Ga(t.type._context),lc(t),null;case 17:return Xi(t.type)&&Zi(),lc(t),null;case 19:if(W(q),s=t.memoizedState,s===null)return lc(t),null;if(i=(t.flags&128)!=0,c=s.rendering,c===null)if(i)cc(s,!1);else{if(Q!==0||e!==null&&e.flags&128)for(e=t.child;e!==null;){if(c=vo(e),c!==null){for(t.flags|=128,cc(s,!1),i=c.updateQueue,i!==null&&(t.updateQueue=i,t.flags|=4),t.subtreeFlags=0,i=n,n=t.child;n!==null;)s=n,e=i,s.flags&=14680066,c=s.alternate,c===null?(s.childLanes=0,s.lanes=e,s.child=null,s.subtreeFlags=0,s.memoizedProps=null,s.memoizedState=null,s.updateQueue=null,s.dependencies=null,s.stateNode=null):(s.childLanes=c.childLanes,s.lanes=c.lanes,s.child=c.child,s.subtreeFlags=0,s.deletions=null,s.memoizedProps=c.memoizedProps,s.memoizedState=c.memoizedState,s.updateQueue=c.updateQueue,s.type=c.type,e=c.dependencies,s.dependencies=e===null?null:{lanes:e.lanes,firstContext:e.firstContext}),n=n.sibling;return G(q,q.current&1|2),t.child}e=e.sibling}s.tail!==null&&z()>tl&&(t.flags|=128,i=!0,cc(s,!1),t.lanes=4194304)}else{if(!i)if(e=vo(c),e!==null){if(t.flags|=128,i=!0,n=e.updateQueue,n!==null&&(t.updateQueue=n,t.flags|=4),cc(s,!0),s.tail===null&&s.tailMode===`hidden`&&!c.alternate&&!K)return lc(t),null}else 2*z()-s.renderingStartTime>tl&&n!==1073741824&&(t.flags|=128,i=!0,cc(s,!1),t.lanes=4194304);s.isBackwards?(c.sibling=t.child,t.child=c):(n=s.last,n===null?t.child=c:n.sibling=c,s.last=c)}return s.tail===null?(lc(t),null):(t=s.tail,s.rendering=t,s.tail=t.sibling,s.renderingStartTime=z(),t.sibling=null,n=q.current,G(q,i?n&1|2:n&1),t);case 22:case 23:return Tl(),i=t.memoizedState!==null,e!==null&&e.memoizedState!==null!==i&&(t.flags|=8192),i&&t.mode&1?Kc&1073741824&&(lc(t),t.subtreeFlags&6&&(t.flags|=8192)):lc(t),null;case 24:return null;case 25:return null}throw Error(r(156,t.tag))}function dc(e,t){switch(ba(t),t.tag){case 1:return Xi(t.type)&&Zi(),e=t.flags,e&65536?(t.flags=e&-65537|128,t):null;case 3:return ho(),W(qi),W(Ki),bo(),e=t.flags,e&65536&&!(e&128)?(t.flags=e&-65537|128,t):null;case 5:return _o(t),null;case 13:if(W(q),e=t.memoizedState,e!==null&&e.dehydrated!==null){if(t.alternate===null)throw Error(r(340));ja()}return e=t.flags,e&65536?(t.flags=e&-65537|128,t):null;case 19:return W(q),null;case 4:return ho(),null;case 10:return Ga(t.type._context),null;case 22:case 23:return Tl(),null;case 24:return null;default:return null}}var fc=!1,pc=!1,mc=typeof WeakSet==`function`?WeakSet:Set,Y=null;function hc(e,t){var n=e.ref;if(n!==null)if(typeof n==`function`)try{n(null)}catch(n){$(e,t,n)}else n.current=null}function gc(e,t,n){try{n()}catch(n){$(e,t,n)}}var _c=!1;function vc(e,t){if(bi=fn,e=Nr(),Pr(e)){if(`selectionStart`in e)var n={start:e.selectionStart,end:e.selectionEnd};else a:{n=(n=e.ownerDocument)&&n.defaultView||window;var i=n.getSelection&&n.getSelection();if(i&&i.rangeCount!==0){n=i.anchorNode;var a=i.anchorOffset,o=i.focusNode;i=i.focusOffset;try{n.nodeType,o.nodeType}catch{n=null;break a}var s=0,c=-1,l=-1,u=0,d=0,f=e,p=null;b:for(;;){for(var m;f!==n||a!==0&&f.nodeType!==3||(c=s+a),f!==o||i!==0&&f.nodeType!==3||(l=s+i),f.nodeType===3&&(s+=f.nodeValue.length),(m=f.firstChild)!==null;)p=f,f=m;for(;;){if(f===e)break b;if(p===n&&++u===a&&(c=s),p===o&&++d===i&&(l=s),(m=f.nextSibling)!==null)break;f=p,p=f.parentNode}f=m}n=c===-1||l===-1?null:{start:c,end:l}}else n=null}n||={start:0,end:0}}else n=null;for(xi={focusedElem:e,selectionRange:n},fn=!1,Y=t;Y!==null;)if(t=Y,e=t.child,t.subtreeFlags&1028&&e!==null)e.return=t,Y=e;else for(;Y!==null;){t=Y;try{var h=t.alternate;if(t.flags&1024)switch(t.tag){case 0:case 11:case 15:break;case 1:if(h!==null){var g=h.memoizedProps,_=h.memoizedState,v=t.stateNode;v.__reactInternalSnapshotBeforeUpdate=v.getSnapshotBeforeUpdate(t.elementType===t.type?g:vs(t.type,g),_)}break;case 3:var y=t.stateNode.containerInfo;y.nodeType===1?y.textContent=``:y.nodeType===9&&y.documentElement&&y.removeChild(y.documentElement);break;case 5:case 6:case 4:case 17:break;default:throw Error(r(163))}}catch(e){$(t,t.return,e)}if(e=t.sibling,e!==null){e.return=t.return,Y=e;break}Y=t.return}return h=_c,_c=!1,h}function yc(e,t,n){var r=t.updateQueue;if(r=r===null?null:r.lastEffect,r!==null){var i=r=r.next;do{if((i.tag&e)===e){var a=i.destroy;i.destroy=void 0,a!==void 0&&gc(t,n,a)}i=i.next}while(i!==r)}}function bc(e,t){if(t=t.updateQueue,t=t===null?null:t.lastEffect,t!==null){var n=t=t.next;do{if((n.tag&e)===e){var r=n.create;n.destroy=r()}n=n.next}while(n!==t)}}function xc(e){var t=e.ref;if(t!==null){var n=e.stateNode;switch(e.tag){case 5:e=n;break;default:e=n}typeof t==`function`?t(e):t.current=e}}function Sc(e){var t=e.alternate;t!==null&&(e.alternate=null,Sc(t)),e.child=null,e.deletions=null,e.sibling=null,e.tag===5&&(t=e.stateNode,t!==null&&(delete t[Mi],delete t[Ni],delete t[Fi],delete t[Ii],delete t[Li])),e.stateNode=null,e.return=null,e.dependencies=null,e.memoizedProps=null,e.memoizedState=null,e.pendingProps=null,e.stateNode=null,e.updateQueue=null}function Cc(e){return e.tag===5||e.tag===3||e.tag===4}function wc(e){a:for(;;){for(;e.sibling===null;){if(e.return===null||Cc(e.return))return null;e=e.return}for(e.sibling.return=e.return,e=e.sibling;e.tag!==5&&e.tag!==6&&e.tag!==18;){if(e.flags&2||e.child===null||e.tag===4)continue a;e.child.return=e,e=e.child}if(!(e.flags&2))return e.stateNode}}function Tc(e,t,n){var r=e.tag;if(r===5||r===6)e=e.stateNode,t?n.nodeType===8?n.parentNode.insertBefore(e,t):n.insertBefore(e,t):(n.nodeType===8?(t=n.parentNode,t.insertBefore(e,n)):(t=n,t.appendChild(e)),n=n._reactRootContainer,n!=null||t.onclick!==null||(t.onclick=yi));else if(r!==4&&(e=e.child,e!==null))for(Tc(e,t,n),e=e.sibling;e!==null;)Tc(e,t,n),e=e.sibling}function Ec(e,t,n){var r=e.tag;if(r===5||r===6)e=e.stateNode,t?n.insertBefore(e,t):n.appendChild(e);else if(r!==4&&(e=e.child,e!==null))for(Ec(e,t,n),e=e.sibling;e!==null;)Ec(e,t,n),e=e.sibling}var Dc=null,Oc=!1;function kc(e,t,n){for(n=n.child;n!==null;)Ac(e,t,n),n=n.sibling}function Ac(e,t,n){if(wt&&typeof wt.onCommitFiberUnmount==`function`)try{wt.onCommitFiberUnmount(Ct,n)}catch{}switch(n.tag){case 5:pc||hc(n,t);case 6:var r=Dc,i=Oc;Dc=null,kc(e,t,n),Dc=r,Oc=i,Dc!==null&&(Oc?(e=Dc,n=n.stateNode,e.nodeType===8?e.parentNode.removeChild(n):e.removeChild(n)):Dc.removeChild(n.stateNode));break;case 18:Dc!==null&&(Oc?(e=Dc,n=n.stateNode,e.nodeType===8?Oi(e.parentNode,n):e.nodeType===1&&Oi(e,n),un(e)):Oi(Dc,n.stateNode));break;case 4:r=Dc,i=Oc,Dc=n.stateNode.containerInfo,Oc=!0,kc(e,t,n),Dc=r,Oc=i;break;case 0:case 11:case 14:case 15:if(!pc&&(r=n.updateQueue,r!==null&&(r=r.lastEffect,r!==null))){i=r=r.next;do{var a=i,o=a.destroy;a=a.tag,o!==void 0&&(a&2||a&4)&&gc(n,t,o),i=i.next}while(i!==r)}kc(e,t,n);break;case 1:if(!pc&&(hc(n,t),r=n.stateNode,typeof r.componentWillUnmount==`function`))try{r.props=n.memoizedProps,r.state=n.memoizedState,r.componentWillUnmount()}catch(e){$(n,t,e)}kc(e,t,n);break;case 21:kc(e,t,n);break;case 22:n.mode&1?(pc=(r=pc)||n.memoizedState!==null,kc(e,t,n),pc=r):kc(e,t,n);break;default:kc(e,t,n)}}function jc(e){var t=e.updateQueue;if(t!==null){e.updateQueue=null;var n=e.stateNode;n===null&&(n=e.stateNode=new mc),t.forEach(function(t){var r=Hl.bind(null,e,t);n.has(t)||(n.add(t),t.then(r,r))})}}function Mc(e,t){var n=t.deletions;if(n!==null)for(var i=0;i<n.length;i++){var a=n[i];try{var o=e,s=t,c=s;a:for(;c!==null;){switch(c.tag){case 5:Dc=c.stateNode,Oc=!1;break a;case 3:Dc=c.stateNode.containerInfo,Oc=!0;break a;case 4:Dc=c.stateNode.containerInfo,Oc=!0;break a}c=c.return}if(Dc===null)throw Error(r(160));Ac(o,s,a),Dc=null,Oc=!1;var l=a.alternate;l!==null&&(l.return=null),a.return=null}catch(e){$(a,t,e)}}if(t.subtreeFlags&12854)for(t=t.child;t!==null;)Nc(t,e),t=t.sibling}function Nc(e,t){var n=e.alternate,i=e.flags;switch(e.tag){case 0:case 11:case 14:case 15:if(Mc(t,e),Pc(e),i&4){try{yc(3,e,e.return),bc(3,e)}catch(t){$(e,e.return,t)}try{yc(5,e,e.return)}catch(t){$(e,e.return,t)}}break;case 1:Mc(t,e),Pc(e),i&512&&n!==null&&hc(n,n.return);break;case 5:if(Mc(t,e),Pc(e),i&512&&n!==null&&hc(n,n.return),e.flags&32){var a=e.stateNode;try{Ae(a,``)}catch(t){$(e,e.return,t)}}if(i&4&&(a=e.stateNode,a!=null)){var o=e.memoizedProps,s=n===null?o:n.memoizedProps,c=e.type,l=e.updateQueue;if(e.updateQueue=null,l!==null)try{c===`input`&&o.type===`radio`&&o.name!=null&&ye(a,o),Le(c,s);var u=Le(c,o);for(s=0;s<l.length;s+=2){var d=l[s],f=l[s+1];d===`style`?Pe(a,f):d===`dangerouslySetInnerHTML`?ke(a,f):d===`children`?Ae(a,f):S(a,d,f,u)}switch(c){case`input`:I(a,o);break;case`textarea`:R(a,o);break;case`select`:var p=a._wrapperState.wasMultiple;a._wrapperState.wasMultiple=!!o.multiple;var m=o.value;m==null?p!==!!o.multiple&&(o.defaultValue==null?Se(a,!!o.multiple,o.multiple?[]:``,!1):Se(a,!!o.multiple,o.defaultValue,!0)):Se(a,!!o.multiple,m,!1)}a[Ni]=o}catch(t){$(e,e.return,t)}}break;case 6:if(Mc(t,e),Pc(e),i&4){if(e.stateNode===null)throw Error(r(162));a=e.stateNode,o=e.memoizedProps;try{a.nodeValue=o}catch(t){$(e,e.return,t)}}break;case 3:if(Mc(t,e),Pc(e),i&4&&n!==null&&n.memoizedState.isDehydrated)try{un(t.containerInfo)}catch(t){$(e,e.return,t)}break;case 4:Mc(t,e),Pc(e);break;case 13:Mc(t,e),Pc(e),a=e.child,a.flags&8192&&(o=a.memoizedState!==null,a.stateNode.isHidden=o,!o||a.alternate!==null&&a.alternate.memoizedState!==null||(el=z())),i&4&&jc(e);break;case 22:if(d=n!==null&&n.memoizedState!==null,e.mode&1?(pc=(u=pc)||d,Mc(t,e),pc=u):Mc(t,e),Pc(e),i&8192){if(u=e.memoizedState!==null,(e.stateNode.isHidden=u)&&!d&&e.mode&1)for(Y=e,d=e.child;d!==null;){for(f=Y=d;Y!==null;){switch(p=Y,m=p.child,p.tag){case 0:case 11:case 14:case 15:yc(4,p,p.return);break;case 1:hc(p,p.return);var h=p.stateNode;if(typeof h.componentWillUnmount==`function`){i=p,n=p.return;try{t=i,h.props=t.memoizedProps,h.state=t.memoizedState,h.componentWillUnmount()}catch(e){$(i,n,e)}}break;case 5:hc(p,p.return);break;case 22:if(p.memoizedState!==null){Rc(f);continue}}m===null?Rc(f):(m.return=p,Y=m)}d=d.sibling}a:for(d=null,f=e;;){if(f.tag===5){if(d===null){d=f;try{a=f.stateNode,u?(o=a.style,typeof o.setProperty==`function`?o.setProperty(`display`,`none`,`important`):o.display=`none`):(c=f.stateNode,l=f.memoizedProps.style,s=l!=null&&l.hasOwnProperty(`display`)?l.display:null,c.style.display=Ne(`display`,s))}catch(t){$(e,e.return,t)}}}else if(f.tag===6){if(d===null)try{f.stateNode.nodeValue=u?``:f.memoizedProps}catch(t){$(e,e.return,t)}}else if((f.tag!==22&&f.tag!==23||f.memoizedState===null||f===e)&&f.child!==null){f.child.return=f,f=f.child;continue}if(f===e)break a;for(;f.sibling===null;){if(f.return===null||f.return===e)break a;d===f&&(d=null),f=f.return}d===f&&(d=null),f.sibling.return=f.return,f=f.sibling}}break;case 19:Mc(t,e),Pc(e),i&4&&jc(e);break;case 21:break;default:Mc(t,e),Pc(e)}}function Pc(e){var t=e.flags;if(t&2){try{a:{for(var n=e.return;n!==null;){if(Cc(n)){var i=n;break a}n=n.return}throw Error(r(160))}switch(i.tag){case 5:var a=i.stateNode;i.flags&32&&(Ae(a,``),i.flags&=-33),Ec(e,wc(e),a);break;case 3:case 4:var o=i.stateNode.containerInfo;Tc(e,wc(e),o);break;default:throw Error(r(161))}}catch(t){$(e,e.return,t)}e.flags&=-3}t&4096&&(e.flags&=-4097)}function Fc(e,t,n){Y=e,Ic(e,t,n)}function Ic(e,t,n){for(var r=(e.mode&1)!=0;Y!==null;){var i=Y,a=i.child;if(i.tag===22&&r){var o=i.memoizedState!==null||fc;if(!o){var s=i.alternate,c=s!==null&&s.memoizedState!==null||pc;s=fc;var l=pc;if(fc=o,(pc=c)&&!l)for(Y=i;Y!==null;)o=Y,c=o.child,o.tag===22&&o.memoizedState!==null||c===null?zc(i):(c.return=o,Y=c);for(;a!==null;)Y=a,Ic(a,t,n),a=a.sibling;Y=i,fc=s,pc=l}Lc(e,t,n)}else i.subtreeFlags&8772&&a!==null?(a.return=i,Y=a):Lc(e,t,n)}}function Lc(e){for(;Y!==null;){var t=Y;if(t.flags&8772){var n=t.alternate;try{if(t.flags&8772)switch(t.tag){case 0:case 11:case 15:pc||bc(5,t);break;case 1:var i=t.stateNode;if(t.flags&4&&!pc)if(n===null)i.componentDidMount();else{var a=t.elementType===t.type?n.memoizedProps:vs(t.type,n.memoizedProps);i.componentDidUpdate(a,n.memoizedState,i.__reactInternalSnapshotBeforeUpdate)}var o=t.updateQueue;o!==null&&so(t,o,i);break;case 3:var s=t.updateQueue;if(s!==null){if(n=null,t.child!==null)switch(t.child.tag){case 5:n=t.child.stateNode;break;case 1:n=t.child.stateNode}so(t,s,n)}break;case 5:var c=t.stateNode;if(n===null&&t.flags&4){n=c;var l=t.memoizedProps;switch(t.type){case`button`:case`input`:case`select`:case`textarea`:l.autoFocus&&n.focus();break;case`img`:l.src&&(n.src=l.src)}}break;case 6:break;case 4:break;case 12:break;case 13:if(t.memoizedState===null){var u=t.alternate;if(u!==null){var d=u.memoizedState;if(d!==null){var f=d.dehydrated;f!==null&&un(f)}}}break;case 19:case 17:case 21:case 22:case 23:case 25:break;default:throw Error(r(163))}pc||t.flags&512&&xc(t)}catch(e){$(t,t.return,e)}}if(t===e){Y=null;break}if(n=t.sibling,n!==null){n.return=t.return,Y=n;break}Y=t.return}}function Rc(e){for(;Y!==null;){var t=Y;if(t===e){Y=null;break}var n=t.sibling;if(n!==null){n.return=t.return,Y=n;break}Y=t.return}}function zc(e){for(;Y!==null;){var t=Y;try{switch(t.tag){case 0:case 11:case 15:var n=t.return;try{bc(4,t)}catch(e){$(t,n,e)}break;case 1:var r=t.stateNode;if(typeof r.componentDidMount==`function`){var i=t.return;try{r.componentDidMount()}catch(e){$(t,i,e)}}var a=t.return;try{xc(t)}catch(e){$(t,a,e)}break;case 5:var o=t.return;try{xc(t)}catch(e){$(t,o,e)}}}catch(e){$(t,t.return,e)}if(t===e){Y=null;break}var s=t.sibling;if(s!==null){s.return=t.return,Y=s;break}Y=t.return}}var Bc=Math.ceil,Vc=C.ReactCurrentDispatcher,Hc=C.ReactCurrentOwner,Uc=C.ReactCurrentBatchConfig,X=0,Wc=null,Z=null,Gc=0,Kc=0,qc=Wi(0),Q=0,Jc=null,Yc=0,Xc=0,Zc=0,Qc=null,$c=null,el=0,tl=1/0,nl=null,rl=!1,il=null,al=null,ol=!1,sl=null,cl=0,ll=0,ul=null,dl=-1,fl=0;function pl(){return X&6?z():dl===-1?dl=z():dl}function ml(e){return e.mode&1?X&2&&Gc!==0?Gc&-Gc:Na.transition===null?(e=B,e===0?(e=window.event,e=e===void 0?16:vn(e.type),e):e):(fl===0&&(fl=Lt()),fl):1}function hl(e,t,n,i){if(50<ll)throw ll=0,ul=null,Error(r(185));zt(e,n,i),(!(X&2)||e!==Wc)&&(e===Wc&&(!(X&2)&&(Xc|=n),Q===4&&xl(e,Gc)),gl(e,i),n===1&&X===0&&!(t.mode&1)&&(tl=z()+500,ra&&sa()))}function gl(e,t){var n=e.callbackNode;Ft(e,t);var r=Nt(e,e===Wc?Gc:0);if(r===0)n!==null&&mt(n),e.callbackNode=null,e.callbackPriority=0;else if(t=r&-r,e.callbackPriority!==t){if(n!=null&&mt(n),t===1)e.tag===0?oa(Sl.bind(null,e)):aa(Sl.bind(null,e)),Ei(function(){!(X&6)&&sa()}),n=null;else{switch(Ht(r)){case 1:n=vt;break;case 4:n=yt;break;case 16:n=bt;break;case 536870912:n=St;break;default:n=bt}n=Wl(n,_l.bind(null,e))}e.callbackPriority=t,e.callbackNode=n}}function _l(e,t){if(dl=-1,fl=0,X&6)throw Error(r(327));var n=e.callbackNode;if(Ll()&&e.callbackNode!==n)return null;var i=Nt(e,e===Wc?Gc:0);if(i===0)return null;if(i&30||(i&e.expiredLanes)!==0||t)t=Al(e,i);else{t=i;var a=X;X|=2;var o=Ol();(Wc!==e||Gc!==t)&&(nl=null,tl=z()+500,El(e,t));do try{Ml();break}catch(t){Dl(e,t)}while(1);Wa(),Vc.current=o,X=a,Z===null?(Wc=null,Gc=0,t=Q):t=0}if(t!==0){if(t===2&&(a=It(e),a!==0&&(i=a,t=vl(e,a))),t===1)throw n=Jc,El(e,0),xl(e,i),gl(e,z()),n;if(t===6)xl(e,i);else{if(a=e.current.alternate,!(i&30)&&!bl(a)&&(t=Al(e,i),t===2&&(o=It(e),o!==0&&(i=o,t=vl(e,o))),t===1))throw n=Jc,El(e,0),xl(e,i),gl(e,z()),n;switch(e.finishedWork=a,e.finishedLanes=i,t){case 0:case 1:throw Error(r(345));case 2:Fl(e,$c,nl);break;case 3:if(xl(e,i),(i&130023424)===i&&(t=el+500-z(),10<t)){if(Nt(e,0)!==0)break;if(a=e.suspendedLanes,(a&i)!==i){pl(),e.pingedLanes|=e.suspendedLanes&a;break}e.timeoutHandle=Ci(Fl.bind(null,e,$c,nl),t);break}Fl(e,$c,nl);break;case 4:if(xl(e,i),(i&4194240)===i)break;for(t=e.eventTimes,a=-1;0<i;){var s=31-Et(i);o=1<<s,s=t[s],s>a&&(a=s),i&=~o}if(i=a,i=z()-i,i=(120>i?120:480>i?480:1080>i?1080:1920>i?1920:3e3>i?3e3:4320>i?4320:1960*Bc(i/1960))-i,10<i){e.timeoutHandle=Ci(Fl.bind(null,e,$c,nl),i);break}Fl(e,$c,nl);break;case 5:Fl(e,$c,nl);break;default:throw Error(r(329))}}}return gl(e,z()),e.callbackNode===n?_l.bind(null,e):null}function vl(e,t){var n=Qc;return e.current.memoizedState.isDehydrated&&(El(e,t).flags|=256),e=Al(e,t),e!==2&&(t=$c,$c=n,t!==null&&yl(t)),e}function yl(e){$c===null?$c=e:$c.push.apply($c,e)}function bl(e){for(var t=e;;){if(t.flags&16384){var n=t.updateQueue;if(n!==null&&(n=n.stores,n!==null))for(var r=0;r<n.length;r++){var i=n[r],a=i.getSnapshot;i=i.value;try{if(!Or(a(),i))return!1}catch{return!1}}}if(n=t.child,t.subtreeFlags&16384&&n!==null)n.return=t,t=n;else{if(t===e)break;for(;t.sibling===null;){if(t.return===null||t.return===e)return!0;t=t.return}t.sibling.return=t.return,t=t.sibling}}return!0}function xl(e,t){for(t&=~Zc,t&=~Xc,e.suspendedLanes|=t,e.pingedLanes&=~t,e=e.expirationTimes;0<t;){var n=31-Et(t),r=1<<n;e[n]=-1,t&=~r}}function Sl(e){if(X&6)throw Error(r(327));Ll();var t=Nt(e,0);if(!(t&1))return gl(e,z()),null;var n=Al(e,t);if(e.tag!==0&&n===2){var i=It(e);i!==0&&(t=i,n=vl(e,i))}if(n===1)throw n=Jc,El(e,0),xl(e,t),gl(e,z()),n;if(n===6)throw Error(r(345));return e.finishedWork=e.current.alternate,e.finishedLanes=t,Fl(e,$c,nl),gl(e,z()),null}function Cl(e,t){var n=X;X|=1;try{return e(t)}finally{X=n,X===0&&(tl=z()+500,ra&&sa())}}function wl(e){sl!==null&&sl.tag===0&&!(X&6)&&Ll();var t=X;X|=1;var n=Uc.transition,r=B;try{if(Uc.transition=null,B=1,e)return e()}finally{B=r,Uc.transition=n,X=t,!(X&6)&&sa()}}function Tl(){Kc=qc.current,W(qc)}function El(e,t){e.finishedWork=null,e.finishedLanes=0;var n=e.timeoutHandle;if(n!==-1&&(e.timeoutHandle=-1,wi(n)),Z!==null)for(n=Z.return;n!==null;){var r=n;switch(ba(r),r.tag){case 1:r=r.type.childContextTypes,r!=null&&Zi();break;case 3:ho(),W(qi),W(Ki),bo();break;case 5:_o(r);break;case 4:ho();break;case 13:W(q);break;case 19:W(q);break;case 10:Ga(r.type._context);break;case 22:case 23:Tl()}n=n.return}if(Wc=e,Z=e=Yl(e.current,null),Gc=Kc=t,Q=0,Jc=null,Zc=Xc=Yc=0,$c=Qc=null,Ya!==null){for(t=0;t<Ya.length;t++)if(n=Ya[t],r=n.interleaved,r!==null){n.interleaved=null;var i=r.next,a=n.pending;if(a!==null){var o=a.next;a.next=i,r.next=o}n.pending=r}Ya=null}return e}function Dl(e,t){do{var n=Z;try{if(Wa(),xo.current=ms,Eo){for(var i=J.memoizedState;i!==null;){var a=i.queue;a!==null&&(a.pending=null),i=i.next}Eo=!1}if(Co=0,To=wo=J=null,Do=!1,Oo=0,Hc.current=null,n===null||n.return===null){Q=1,Jc=t,Z=null;break}a:{var o=e,s=n.return,c=n,l=t;if(t=Gc,c.flags|=32768,typeof l==`object`&&l&&typeof l.then==`function`){var u=l,d=c,f=d.tag;if(!(d.mode&1)&&(f===0||f===11||f===15)){var p=d.alternate;p?(d.updateQueue=p.updateQueue,d.memoizedState=p.memoizedState,d.lanes=p.lanes):(d.updateQueue=null,d.memoizedState=null)}var m=Ms(s);if(m!==null){m.flags&=-257,Ns(m,s,c,o,t),m.mode&1&&js(o,u,t),t=m,l=u;var h=t.updateQueue;if(h===null){var g=new Set;g.add(l),t.updateQueue=g}else h.add(l);break a}else{if(!(t&1)){js(o,u,t),kl();break a}l=Error(r(426))}}else if(K&&c.mode&1){var _=Ms(s);if(_!==null){!(_.flags&65536)&&(_.flags|=256),Ns(_,s,c,o,t),Ma(Ts(l,c));break a}}o=l=Ts(l,c),Q!==4&&(Q=2),Qc===null?Qc=[o]:Qc.push(o),o=s;do{switch(o.tag){case 3:o.flags|=65536,t&=-t,o.lanes|=t;var v=ks(o,l,t);ao(o,v);break a;case 1:c=l;var y=o.type,b=o.stateNode;if(!(o.flags&128)&&(typeof y.getDerivedStateFromError==`function`||b!==null&&typeof b.componentDidCatch==`function`&&(al===null||!al.has(b)))){o.flags|=65536,t&=-t,o.lanes|=t;var x=As(o,c,t);ao(o,x);break a}}o=o.return}while(o!==null)}Pl(n)}catch(e){t=e,Z===n&&n!==null&&(Z=n=n.return);continue}break}while(1)}function Ol(){var e=Vc.current;return Vc.current=ms,e===null?ms:e}function kl(){(Q===0||Q===3||Q===2)&&(Q=4),Wc===null||!(Yc&268435455)&&!(Xc&268435455)||xl(Wc,Gc)}function Al(e,t){var n=X;X|=2;var i=Ol();(Wc!==e||Gc!==t)&&(nl=null,El(e,t));do try{jl();break}catch(t){Dl(e,t)}while(1);if(Wa(),X=n,Vc.current=i,Z!==null)throw Error(r(261));return Wc=null,Gc=0,Q}function jl(){for(;Z!==null;)Nl(Z)}function Ml(){for(;Z!==null&&!ht();)Nl(Z)}function Nl(e){var t=Ul(e.alternate,e,Kc);e.memoizedProps=e.pendingProps,t===null?Pl(e):Z=t,Hc.current=null}function Pl(e){var t=e;do{var n=t.alternate;if(e=t.return,t.flags&32768){if(n=dc(n,t),n!==null){n.flags&=32767,Z=n;return}if(e!==null)e.flags|=32768,e.subtreeFlags=0,e.deletions=null;else{Q=6,Z=null;return}}else if(n=uc(n,t,Kc),n!==null){Z=n;return}if(t=t.sibling,t!==null){Z=t;return}Z=t=e}while(t!==null);Q===0&&(Q=5)}function Fl(e,t,n){var r=B,i=Uc.transition;try{Uc.transition=null,B=1,Il(e,t,n,r)}finally{Uc.transition=i,B=r}return null}function Il(e,t,n,i){do Ll();while(sl!==null);if(X&6)throw Error(r(327));n=e.finishedWork;var a=e.finishedLanes;if(n===null)return null;if(e.finishedWork=null,e.finishedLanes=0,n===e.current)throw Error(r(177));e.callbackNode=null,e.callbackPriority=0;var o=n.lanes|n.childLanes;if(Bt(e,o),e===Wc&&(Z=Wc=null,Gc=0),!(n.subtreeFlags&2064)&&!(n.flags&2064)||ol||(ol=!0,Wl(bt,function(){return Ll(),null})),o=(n.flags&15990)!=0,n.subtreeFlags&15990||o){o=Uc.transition,Uc.transition=null;var s=B;B=1;var c=X;X|=4,Hc.current=null,vc(e,n),Nc(n,e),Fr(xi),fn=!!bi,xi=bi=null,e.current=n,Fc(n,e,a),gt(),X=c,B=s,Uc.transition=o}else e.current=n;if(ol&&(ol=!1,sl=e,cl=a),o=e.pendingLanes,o===0&&(al=null),Tt(n.stateNode,i),gl(e,z()),t!==null)for(i=e.onRecoverableError,n=0;n<t.length;n++)a=t[n],i(a.value,{componentStack:a.stack,digest:a.digest});if(rl)throw rl=!1,e=il,il=null,e;return cl&1&&e.tag!==0&&Ll(),o=e.pendingLanes,o&1?e===ul?ll++:(ll=0,ul=e):ll=0,sa(),null}function Ll(){if(sl!==null){var e=Ht(cl),t=Uc.transition,n=B;try{if(Uc.transition=null,B=16>e?16:e,sl===null)var i=!1;else{if(e=sl,sl=null,cl=0,X&6)throw Error(r(331));var a=X;for(X|=4,Y=e.current;Y!==null;){var o=Y,s=o.child;if(Y.flags&16){var c=o.deletions;if(c!==null){for(var l=0;l<c.length;l++){var u=c[l];for(Y=u;Y!==null;){var d=Y;switch(d.tag){case 0:case 11:case 15:yc(8,d,o)}var f=d.child;if(f!==null)f.return=d,Y=f;else for(;Y!==null;){d=Y;var p=d.sibling,m=d.return;if(Sc(d),d===u){Y=null;break}if(p!==null){p.return=m,Y=p;break}Y=m}}}var h=o.alternate;if(h!==null){var g=h.child;if(g!==null){h.child=null;do{var _=g.sibling;g.sibling=null,g=_}while(g!==null)}}Y=o}}if(o.subtreeFlags&2064&&s!==null)s.return=o,Y=s;else b:for(;Y!==null;){if(o=Y,o.flags&2048)switch(o.tag){case 0:case 11:case 15:yc(9,o,o.return)}var v=o.sibling;if(v!==null){v.return=o.return,Y=v;break b}Y=o.return}}var y=e.current;for(Y=y;Y!==null;){s=Y;var b=s.child;if(s.subtreeFlags&2064&&b!==null)b.return=s,Y=b;else b:for(s=y;Y!==null;){if(c=Y,c.flags&2048)try{switch(c.tag){case 0:case 11:case 15:bc(9,c)}}catch(e){$(c,c.return,e)}if(c===s){Y=null;break b}var x=c.sibling;if(x!==null){x.return=c.return,Y=x;break b}Y=c.return}}if(X=a,sa(),wt&&typeof wt.onPostCommitFiberRoot==`function`)try{wt.onPostCommitFiberRoot(Ct,e)}catch{}i=!0}return i}finally{B=n,Uc.transition=t}}return!1}function Rl(e,t,n){t=Ts(n,t),t=ks(e,t,1),e=ro(e,t,1),t=pl(),e!==null&&(zt(e,1,t),gl(e,t))}function $(e,t,n){if(e.tag===3)Rl(e,e,n);else for(;t!==null;){if(t.tag===3){Rl(t,e,n);break}else if(t.tag===1){var r=t.stateNode;if(typeof t.type.getDerivedStateFromError==`function`||typeof r.componentDidCatch==`function`&&(al===null||!al.has(r))){e=Ts(n,e),e=As(t,e,1),t=ro(t,e,1),e=pl(),t!==null&&(zt(t,1,e),gl(t,e));break}}t=t.return}}function zl(e,t,n){var r=e.pingCache;r!==null&&r.delete(t),t=pl(),e.pingedLanes|=e.suspendedLanes&n,Wc===e&&(Gc&n)===n&&(Q===4||Q===3&&(Gc&130023424)===Gc&&500>z()-el?El(e,0):Zc|=n),gl(e,t)}function Bl(e,t){t===0&&(e.mode&1?(t=jt,jt<<=1,!(jt&130023424)&&(jt=4194304)):t=1);var n=pl();e=Qa(e,t),e!==null&&(zt(e,t,n),gl(e,n))}function Vl(e){var t=e.memoizedState,n=0;t!==null&&(n=t.retryLane),Bl(e,n)}function Hl(e,t){var n=0;switch(e.tag){case 13:var i=e.stateNode,a=e.memoizedState;a!==null&&(n=a.retryLane);break;case 19:i=e.stateNode;break;default:throw Error(r(314))}i!==null&&i.delete(t),Bl(e,n)}var Ul=function(e,t,n){if(e!==null)if(e.memoizedProps!==t.pendingProps||qi.current)Fs=!0;else{if((e.lanes&n)===0&&!(t.flags&128))return Fs=!1,ic(e,t,n);Fs=!!(e.flags&131072)}else Fs=!1,K&&t.flags&1048576&&va(t,da,t.index);switch(t.lanes=0,t.tag){case 2:var i=t.type;nc(e,t),e=t.pendingProps;var a=Yi(t,Ki.current);qa(t,n),a=Mo(null,t,i,e,a,n);var o=No();return t.flags|=1,typeof a==`object`&&a&&typeof a.render==`function`&&a.$$typeof===void 0?(t.tag=1,t.memoizedState=null,t.updateQueue=null,Xi(i)?(o=!0,ea(t)):o=!1,t.memoizedState=a.state!==null&&a.state!==void 0?a.state:null,eo(t),a.updater=bs,t.stateNode=a,a._reactInternals=t,ws(t,i,e,n),t=Ws(null,t,i,!0,o,n)):(t.tag=0,K&&o&&ya(t),Is(null,t,a,n),t=t.child),t;case 16:i=t.elementType;a:{switch(nc(e,t),e=t.pendingProps,a=i._init,i=a(i._payload),t.type=i,a=t.tag=Jl(i),e=vs(i,e),a){case 0:t=Hs(null,t,i,e,n);break a;case 1:t=Us(null,t,i,e,n);break a;case 11:t=Ls(null,t,i,e,n);break a;case 14:t=Rs(null,t,i,vs(i.type,e),n);break a}throw Error(r(306,i,``))}return t;case 0:return i=t.type,a=t.pendingProps,a=t.elementType===i?a:vs(i,a),Hs(e,t,i,a,n);case 1:return i=t.type,a=t.pendingProps,a=t.elementType===i?a:vs(i,a),Us(e,t,i,a,n);case 3:a:{if(Gs(t),e===null)throw Error(r(387));i=t.pendingProps,o=t.memoizedState,a=o.element,to(e,t),oo(t,i,null,n);var s=t.memoizedState;if(i=s.element,o.isDehydrated)if(o={element:i,isDehydrated:!1,cache:s.cache,pendingSuspenseBoundaries:s.pendingSuspenseBoundaries,transitions:s.transitions},t.updateQueue.baseState=o,t.memoizedState=o,t.flags&256){a=Ts(Error(r(423)),t),t=Ks(e,t,i,n,a);break a}else if(i!==a){a=Ts(Error(r(424)),t),t=Ks(e,t,i,n,a);break a}else for(Sa=ki(t.stateNode.containerInfo.firstChild),xa=t,K=!0,Ca=null,n=za(t,null,i,n),t.child=n;n;)n.flags=n.flags&-3|4096,n=n.sibling;else{if(ja(),i===a){t=rc(e,t,n);break a}Is(e,t,i,n)}t=t.child}return t;case 5:return go(t),e===null&&Da(t),i=t.type,a=t.pendingProps,o=e===null?null:e.memoizedProps,s=a.children,Si(i,a)?s=null:o!==null&&Si(i,o)&&(t.flags|=32),Vs(e,t),Is(e,t,s,n),t.child;case 6:return e===null&&Da(t),null;case 13:return Ys(e,t,n);case 4:return mo(t,t.stateNode.containerInfo),i=t.pendingProps,e===null?t.child=Ra(t,null,i,n):Is(e,t,i,n),t.child;case 11:return i=t.type,a=t.pendingProps,a=t.elementType===i?a:vs(i,a),Ls(e,t,i,a,n);case 7:return Is(e,t,t.pendingProps,n),t.child;case 8:return Is(e,t,t.pendingProps.children,n),t.child;case 12:return Is(e,t,t.pendingProps.children,n),t.child;case 10:a:{if(i=t.type._context,a=t.pendingProps,o=t.memoizedProps,s=a.value,G(Ba,i._currentValue),i._currentValue=s,o!==null)if(Or(o.value,s)){if(o.children===a.children&&!qi.current){t=rc(e,t,n);break a}}else for(o=t.child,o!==null&&(o.return=t);o!==null;){var c=o.dependencies;if(c!==null){s=o.child;for(var l=c.firstContext;l!==null;){if(l.context===i){if(o.tag===1){l=no(-1,n&-n),l.tag=2;var u=o.updateQueue;if(u!==null){u=u.shared;var d=u.pending;d===null?l.next=l:(l.next=d.next,d.next=l),u.pending=l}}o.lanes|=n,l=o.alternate,l!==null&&(l.lanes|=n),Ka(o.return,n,t),c.lanes|=n;break}l=l.next}}else if(o.tag===10)s=o.type===t.type?null:o.child;else if(o.tag===18){if(s=o.return,s===null)throw Error(r(341));s.lanes|=n,c=s.alternate,c!==null&&(c.lanes|=n),Ka(s,n,t),s=o.sibling}else s=o.child;if(s!==null)s.return=o;else for(s=o;s!==null;){if(s===t){s=null;break}if(o=s.sibling,o!==null){o.return=s.return,s=o;break}s=s.return}o=s}Is(e,t,a.children,n),t=t.child}return t;case 9:return a=t.type,i=t.pendingProps.children,qa(t,n),a=Ja(a),i=i(a),t.flags|=1,Is(e,t,i,n),t.child;case 14:return i=t.type,a=vs(i,t.pendingProps),a=vs(i.type,a),Rs(e,t,i,a,n);case 15:return zs(e,t,t.type,t.pendingProps,n);case 17:return i=t.type,a=t.pendingProps,a=t.elementType===i?a:vs(i,a),nc(e,t),t.tag=1,Xi(i)?(e=!0,ea(t)):e=!1,qa(t,n),Ss(t,i,a),ws(t,i,a,n),Ws(null,t,i,!0,e,n);case 19:return tc(e,t,n);case 22:return Bs(e,t,n)}throw Error(r(156,t.tag))};function Wl(e,t){return pt(e,t)}function Gl(e,t,n,r){this.tag=e,this.key=n,this.sibling=this.child=this.return=this.stateNode=this.type=this.elementType=null,this.index=0,this.ref=null,this.pendingProps=t,this.dependencies=this.memoizedState=this.updateQueue=this.memoizedProps=null,this.mode=r,this.subtreeFlags=this.flags=0,this.deletions=null,this.childLanes=this.lanes=0,this.alternate=null}function Kl(e,t,n,r){return new Gl(e,t,n,r)}function ql(e){return e=e.prototype,!(!e||!e.isReactComponent)}function Jl(e){if(typeof e==`function`)return+!!ql(e);if(e!=null){if(e=e.$$typeof,e===O)return 11;if(e===A)return 14}return 2}function Yl(e,t){var n=e.alternate;return n===null?(n=Kl(e.tag,t,e.key,e.mode),n.elementType=e.elementType,n.type=e.type,n.stateNode=e.stateNode,n.alternate=e,e.alternate=n):(n.pendingProps=t,n.type=e.type,n.flags=0,n.subtreeFlags=0,n.deletions=null),n.flags=e.flags&14680064,n.childLanes=e.childLanes,n.lanes=e.lanes,n.child=e.child,n.memoizedProps=e.memoizedProps,n.memoizedState=e.memoizedState,n.updateQueue=e.updateQueue,t=e.dependencies,n.dependencies=t===null?null:{lanes:t.lanes,firstContext:t.firstContext},n.sibling=e.sibling,n.index=e.index,n.ref=e.ref,n}function Xl(e,t,n,i,a,o){var s=2;if(i=e,typeof e==`function`)ql(e)&&(s=1);else if(typeof e==`string`)s=5;else a:switch(e){case E:return Zl(n.children,a,o,t);case D:s=8,a|=8;break;case ee:return e=Kl(12,n,t,a|2),e.elementType=ee,e.lanes=o,e;case k:return e=Kl(13,n,t,a),e.elementType=k,e.lanes=o,e;case re:return e=Kl(19,n,t,a),e.elementType=re,e.lanes=o,e;case j:return Ql(n,a,o,t);default:if(typeof e==`object`&&e)switch(e.$$typeof){case te:s=10;break a;case ne:s=9;break a;case O:s=11;break a;case A:s=14;break a;case ie:s=16,i=null;break a}throw Error(r(130,e==null?e:typeof e,``))}return t=Kl(s,n,t,a),t.elementType=e,t.type=i,t.lanes=o,t}function Zl(e,t,n,r){return e=Kl(7,e,r,t),e.lanes=n,e}function Ql(e,t,n,r){return e=Kl(22,e,r,t),e.elementType=j,e.lanes=n,e.stateNode={isHidden:!1},e}function $l(e,t,n){return e=Kl(6,e,null,t),e.lanes=n,e}function eu(e,t,n){return t=Kl(4,e.children===null?[]:e.children,e.key,t),t.lanes=n,t.stateNode={containerInfo:e.containerInfo,pendingChildren:null,implementation:e.implementation},t}function tu(e,t,n,r,i){this.tag=t,this.containerInfo=e,this.finishedWork=this.pingCache=this.current=this.pendingChildren=null,this.timeoutHandle=-1,this.callbackNode=this.pendingContext=this.context=null,this.callbackPriority=0,this.eventTimes=Rt(0),this.expirationTimes=Rt(-1),this.entangledLanes=this.finishedLanes=this.mutableReadLanes=this.expiredLanes=this.pingedLanes=this.suspendedLanes=this.pendingLanes=0,this.entanglements=Rt(0),this.identifierPrefix=r,this.onRecoverableError=i,this.mutableSourceEagerHydrationData=null}function nu(e,t,n,r,i,a,o,s,c){return e=new tu(e,t,n,s,c),t===1?(t=1,!0===a&&(t|=8)):t=0,a=Kl(3,null,null,t),e.current=a,a.stateNode=e,a.memoizedState={element:r,isDehydrated:n,cache:null,transitions:null,pendingSuspenseBoundaries:null},eo(a),e}function ru(e,t,n){var r=3<arguments.length&&arguments[3]!==void 0?arguments[3]:null;return{$$typeof:T,key:r==null?null:``+r,children:e,containerInfo:t,implementation:n}}function iu(e){if(!e)return Gi;e=e._reactInternals;a:{if(st(e)!==e||e.tag!==1)throw Error(r(170));var t=e;do{switch(t.tag){case 3:t=t.stateNode.context;break a;case 1:if(Xi(t.type)){t=t.stateNode.__reactInternalMemoizedMergedChildContext;break a}}t=t.return}while(t!==null);throw Error(r(171))}if(e.tag===1){var n=e.type;if(Xi(n))return $i(e,n,t)}return t}function au(e,t,n,r,i,a,o,s,c){return e=nu(n,r,!0,e,i,a,o,s,c),e.context=iu(null),n=e.current,r=pl(),i=ml(n),a=no(r,i),a.callback=t??null,ro(n,a,i),e.current.lanes=i,zt(e,i,r),gl(e,r),e}function ou(e,t,n,r){var i=t.current,a=pl(),o=ml(i);return n=iu(n),t.context===null?t.context=n:t.pendingContext=n,t=no(a,o),t.payload={element:e},r=r===void 0?null:r,r!==null&&(t.callback=r),e=ro(i,t,o),e!==null&&(hl(e,i,o,a),io(e,i,o)),o}function su(e){if(e=e.current,!e.child)return null;switch(e.child.tag){case 5:return e.child.stateNode;default:return e.child.stateNode}}function cu(e,t){if(e=e.memoizedState,e!==null&&e.dehydrated!==null){var n=e.retryLane;e.retryLane=n!==0&&n<t?n:t}}function lu(e,t){cu(e,t),(e=e.alternate)&&cu(e,t)}function uu(){return null}var du=typeof reportError==`function`?reportError:function(e){console.error(e)};function fu(e){this._internalRoot=e}pu.prototype.render=fu.prototype.render=function(e){var t=this._internalRoot;if(t===null)throw Error(r(409));ou(e,t,null,null)},pu.prototype.unmount=fu.prototype.unmount=function(){var e=this._internalRoot;if(e!==null){this._internalRoot=null;var t=e.containerInfo;wl(function(){ou(null,e,null,null)}),t[Pi]=null}};function pu(e){this._internalRoot=e}pu.prototype.unstable_scheduleHydration=function(e){if(e){var t=Kt();e={blockedOn:null,target:e,priority:t};for(var n=0;n<$t.length&&t!==0&&t<$t[n].priority;n++);$t.splice(n,0,e),n===0&&an(e)}};function mu(e){return!(!e||e.nodeType!==1&&e.nodeType!==9&&e.nodeType!==11)}function hu(e){return!(!e||e.nodeType!==1&&e.nodeType!==9&&e.nodeType!==11&&(e.nodeType!==8||e.nodeValue!==` react-mount-point-unstable `))}function gu(){}function _u(e,t,n,r,i){if(i){if(typeof r==`function`){var a=r;r=function(){var e=su(o);a.call(e)}}var o=au(t,r,e,0,null,!1,!1,``,gu);return e._reactRootContainer=o,e[Pi]=o.current,ci(e.nodeType===8?e.parentNode:e),wl(),o}for(;i=e.lastChild;)e.removeChild(i);if(typeof r==`function`){var s=r;r=function(){var e=su(c);s.call(e)}}var c=nu(e,0,!1,null,null,!1,!1,``,gu);return e._reactRootContainer=c,e[Pi]=c.current,ci(e.nodeType===8?e.parentNode:e),wl(function(){ou(t,c,n,r)}),c}function vu(e,t,n,r,i){var a=n._reactRootContainer;if(a){var o=a;if(typeof i==`function`){var s=i;i=function(){var e=su(o);s.call(e)}}ou(t,o,e,i)}else o=_u(n,t,e,i,r);return su(o)}Ut=function(e){switch(e.tag){case 3:var t=e.stateNode;if(t.current.memoizedState.isDehydrated){var n=Mt(t.pendingLanes);n!==0&&(Vt(t,n|1),gl(t,z()),!(X&6)&&(tl=z()+500,sa()))}break;case 13:wl(function(){var t=Qa(e,1);t!==null&&hl(t,e,1,pl())}),lu(e,1)}},Wt=function(e){if(e.tag===13){var t=Qa(e,134217728);t!==null&&hl(t,e,134217728,pl()),lu(e,134217728)}},Gt=function(e){if(e.tag===13){var t=ml(e),n=Qa(e,t);n!==null&&hl(n,e,t,pl()),lu(e,t)}},Kt=function(){return B},qt=function(e,t){var n=B;try{return B=e,t()}finally{B=n}},Be=function(e,t,n){switch(t){case`input`:if(I(e,n),t=n.name,n.type===`radio`&&t!=null){for(n=e;n.parentNode;)n=n.parentNode;for(n=n.querySelectorAll(`input[name=`+JSON.stringify(``+t)+`][type="radio"]`),t=0;t<n.length;t++){var i=n[t];if(i!==e&&i.form===e.form){var a=Vi(i);if(!a)throw Error(r(90));ge(i),I(i,a)}}}break;case`textarea`:R(e,n);break;case`select`:t=n.value,t!=null&&Se(e,!!n.multiple,t,!1)}},Ke=Cl,qe=wl;var yu={usingClientEntryPoint:!1,Events:[zi,Bi,Vi,We,Ge,Cl]},bu={findFiberByHostInstance:Ri,bundleType:0,version:`18.3.1`,rendererPackageName:`react-dom`},xu={bundleType:bu.bundleType,version:bu.version,rendererPackageName:bu.rendererPackageName,rendererConfig:bu.rendererConfig,overrideHookState:null,overrideHookStateDeletePath:null,overrideHookStateRenamePath:null,overrideProps:null,overridePropsDeletePath:null,overridePropsRenamePath:null,setErrorHandler:null,setSuspenseHandler:null,scheduleUpdate:null,currentDispatcherRef:C.ReactCurrentDispatcher,findHostInstanceByFiber:function(e){return e=dt(e),e===null?null:e.stateNode},findFiberByHostInstance:bu.findFiberByHostInstance||uu,findHostInstancesForRefresh:null,scheduleRefresh:null,scheduleRoot:null,setRefreshHandler:null,getCurrentFiber:null,reconcilerVersion:`18.3.1-next-f1338f8080-20240426`};if(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<`u`){var Su=__REACT_DEVTOOLS_GLOBAL_HOOK__;if(!Su.isDisabled&&Su.supportsFiber)try{Ct=Su.inject(xu),wt=Su}catch{}}e.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=yu,e.createPortal=function(e,t){var n=2<arguments.length&&arguments[2]!==void 0?arguments[2]:null;if(!mu(t))throw Error(r(200));return ru(e,t,null,n)},e.createRoot=function(e,t){if(!mu(e))throw Error(r(299));var n=!1,i=``,a=du;return t!=null&&(!0===t.unstable_strictMode&&(n=!0),t.identifierPrefix!==void 0&&(i=t.identifierPrefix),t.onRecoverableError!==void 0&&(a=t.onRecoverableError)),t=nu(e,1,!1,null,null,n,!1,i,a),e[Pi]=t.current,ci(e.nodeType===8?e.parentNode:e),new fu(t)},e.findDOMNode=function(e){if(e==null)return null;if(e.nodeType===1)return e;var t=e._reactInternals;if(t===void 0)throw typeof e.render==`function`?Error(r(188)):(e=Object.keys(e).join(`,`),Error(r(268,e)));return e=dt(t),e=e===null?null:e.stateNode,e},e.flushSync=function(e){return wl(e)},e.hydrate=function(e,t,n){if(!hu(t))throw Error(r(200));return vu(null,e,t,!0,n)},e.hydrateRoot=function(e,t,n){if(!mu(e))throw Error(r(405));var i=n!=null&&n.hydratedSources||null,a=!1,o=``,s=du;if(n!=null&&(!0===n.unstable_strictMode&&(a=!0),n.identifierPrefix!==void 0&&(o=n.identifierPrefix),n.onRecoverableError!==void 0&&(s=n.onRecoverableError)),t=au(t,null,e,1,n??null,a,!1,o,s),e[Pi]=t.current,ci(e),i)for(e=0;e<i.length;e++)n=i[e],a=n._getVersion,a=a(n._source),t.mutableSourceEagerHydrationData==null?t.mutableSourceEagerHydrationData=[n,a]:t.mutableSourceEagerHydrationData.push(n,a);return new pu(t)},e.render=function(e,t,n){if(!hu(t))throw Error(r(200));return vu(null,e,t,!1,n)},e.unmountComponentAtNode=function(e){if(!hu(e))throw Error(r(40));return e._reactRootContainer?(wl(function(){vu(null,null,e,!1,function(){e._reactRootContainer=null,e[Pi]=null})}),!0):!1},e.unstable_batchedUpdates=Cl,e.unstable_renderSubtreeIntoContainer=function(e,t,n,i){if(!hu(n))throw Error(r(200));if(e==null||e._reactInternals===void 0)throw Error(r(38));return vu(e,t,n,!1,i)},e.version=`18.3.1-next-f1338f8080-20240426`})),m=o(((e,t)=>{function n(){if(!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__>`u`||typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE!=`function`))try{__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(n)}catch(e){console.error(e)}}n(),t.exports=p()})),h=o((e=>{var t=m();e.createRoot=t.createRoot,e.hydrateRoot=t.hydrateRoot})),g=o(((e,t)=>{function n(e){var t,r,i=``;if(typeof e==`string`||typeof e==`number`)i+=e;else if(typeof e==`object`)if(Array.isArray(e)){var a=e.length;for(t=0;t<a;t++)e[t]&&(r=n(e[t]))&&(i&&(i+=` `),i+=r)}else for(r in e)e[r]&&(i&&(i+=` `),i+=r);return i}function r(){for(var e,t,r=0,i=``,a=arguments.length;r<a;r++)(e=arguments[r])&&(t=n(e))&&(i&&(i+=` `),i+=t);return i}t.exports=r,t.exports.clsx=r})),_=c(u(),1),v=m(),y=h(),b=c(g(),1);const x={theta:`θ`,mu:`μ`,alpha:`α`,beta:`β`,omega:`ω`,Delta:`Δ`,Sigma:`Σ`,pi:`π`},S=(e,t)=>{if(e[t]===`{`){let n=1,r=t+1;for(;r<e.length&&n>0&&(e[r]===`{`?n+=1:e[r]===`}`&&--n,n!==0);)r+=1;return{content:e.slice(t+1,r),next:Math.min(r+1,e.length)}}let n=/^\\[a-zA-Z]+/.exec(e.slice(t));return n===null?{content:e.slice(t,t+1),next:t+1}:{content:n[0],next:t+n[0].length}},C=e=>e.map(e=>e.frac===void 0?e.sqrt===void 0?e.text:`√(${C(e.sqrt.body)})`:`(${C(e.frac.num)})/(${C(e.frac.den)})`).join(``),w=(e,t)=>({text:`(${C(e)})/(${C(t)})`,frac:{num:e,den:t}}),T=(e,t)=>({text:`${t===void 0?``:C(t)}√(${C(e)})`,sqrt:t===void 0?{body:e}:{body:e,index:t}}),E=e=>{let t=[],n=``,r=0,i=()=>{n.length>0&&(t.push({text:n}),n=``)};for(;r<e.length;){let a=e[r];if(a===`\\`){let o=/^\\[a-zA-Z]+/.exec(e.slice(r))?.[0];if(o===`\\frac`||o===`\\tfrac`||o===`\\dfrac`){i();let n=S(e,r+o.length),a=S(e,n.next);t.push(w(E(n.content),E(a.content))),r=a.next;continue}if(o===`\\sqrt`){i();let n=r+o.length,a;if(e[n]===`[`){let t=e.indexOf(`]`,n);t>n&&(a=E(e.slice(n+1,t)),n=t+1)}let s=S(e,n);t.push(T(E(s.content),a)),r=s.next;continue}if(o===`\\text`||o===`\\mathrm`||o===`\\mathbf`||o===`\\operatorname`){let t=S(e,r+o.length);n+=t.content,r=t.next;continue}n+=a,r+=1;continue}if(a===`_`||a===`^`){i(),r+=1;let n=``;if(e[r]===`{`){let t=S(e,r);n=t.content,r=t.next}else r<e.length&&(n+=e[r]??``,r+=1);let o=E(n);if(o.length>0){let e=a===`_`?`sub`:`super`;t.push(...o.map(t=>({...t,script:e})))}continue}a!==void 0&&a!==`{`&&a!==`}`&&(n+=a),r+=1}return i(),t},D=e=>E(e.replace(/\\(theta|mu|alpha|beta|omega|Delta|Sigma|pi)\b/g,(e,t)=>x[t]??t).replace(/\\sin/g,`sin`).replace(/\\cos/g,`cos`).replace(/\\tan/g,`tan`).replace(/\\,/g,` `).replace(/\\;/g,` `)),ee=(e,t)=>{let n=e.x-te(e),r=t.x-te(t);return n<r+t.box.width+3&&n+e.box.width+3>r&&e.y-e.box.height<t.y+3&&e.y+3>t.y-t.box.height},te=e=>e.box.anchor===`middle`?e.box.width/2:e.box.anchor===`end`?e.box.width:0,ne=e=>{let t=e.map(e=>{let t=Math.hypot(e.dirX,e.dirY),n=t===0?1:e.dirX/t,r=t===0?0:e.dirY/t,i=e.x+n*9,a=e.y+r*9+e.height*.34;return{box:e,x:i,y:a,originX:i,originY:a}});for(let e=0;e<24;e+=1){let e=!1;for(let n=0;n<t.length;n+=1)for(let r=n+1;r<t.length;r+=1){let i=t[n],a=t[r];if(i===void 0||a===void 0||!ee(i,a))continue;let o=Math.hypot(a.box.dirX,a.box.dirY),s=o===0?0:a.box.dirX/o,c=o===0?1:a.box.dirY/o;a.x+=s*5,a.y+=c*5,e=!0}if(!e)break}return t.map(e=>{let t=e.x-e.originX,n=e.y-e.originY,r=Math.hypot(t,n),i=r>15;return{id:e.box.id,x:e.x,y:e.y,anchor:e.box.anchor,displaced:r>.5,...i?{leader:{x1:e.box.x,y1:e.box.y,x2:e.x-(e.box.anchor===`end`?-2:2),y2:e.y-e.box.height*.3}}:{}}})},O=(e,t)=>{let n=e.replace(/[_^{}\\]/g,``),r=(e.match(/[_^]/g)??[]).length;return Math.max(t*.72,n.length*t*.56+r*t*.1)},k={ball:{file:`ball.png`,pixels:{w:421,h:429},solidBox:{left:.0532,top:.0523,width:.8932,height:.8951},anchorKind:`point`,anchorPoint:{x:.497625,y:.5},radius:.445368},block:{file:`block.png`,pixels:{w:430,h:181},solidBox:{left:.0532,top:.1263,width:.893,height:.7476},anchorKind:`point`,anchorPoint:{x:.498837,y:.867403}},cart:{file:`cart.png`,pixels:{w:426,h:173},solidBox:{left:.0498,top:.1323,width:.9014,height:.7359},anchorKind:`point`,anchorPoint:{x:.5,y:.861272}},plank:{file:`plank.png`,pixels:{w:415,h:111},solidBox:{left:.0371,top:.2044,width:.9253,height:.5912},anchorKind:`line`,anchorLine:{a:{x:.038554,y:.405405},b:{x:.959036,y:.405405}}},"weight-hook":{file:`weight-hook.png`,pixels:{w:171,h:430},solidBox:{left:.1335,top:.0531,width:.731,height:.893},anchorKind:`point`,anchorPoint:{x:.494152,y:.944186}},"spring-scale":{file:`spring-scale.png`,pixels:{w:413,h:100},solidBox:{left:.0335,top:.2272,width:.9298,height:.55},anchorKind:`point`,anchorPoint:{x:.9613,y:.51}},"support-clamp":{file:`support-clamp.png`,pixels:{w:164,h:407},solidBox:{left:.1391,top:0,width:.7191,height:.9435},anchorKind:`point`,anchorPoint:{x:.326,y:.91}},protractor:{file:`protractor.png`,pixels:{w:430,h:178},solidBox:{left:.0535,top:.1292,width:.8907,height:.8652},anchorKind:`point`,anchorPoint:{x:.499,y:.129}},"track-rail":{file:`track-rail.png`,pixels:{w:406,h:134},solidBox:{left:.0271,top:.1716,width:.9433,height:.6493},anchorKind:`point`,anchorPoint:{x:.5,y:.388}},"ruler-vertical":{file:`ruler-vertical.png`,pixels:{w:64,h:424},solidBox:{left:.3594,top:.0472,width:.2656,height:.9033},anchorKind:`point`,anchorPoint:{x:.49,y:.047}}},re=e=>`./assets/parts3d/mechanics/${e.file}`;if(typeof document<`u`){let e=document.createElement(`style`);e.textContent=`.M0CESW_roleVelocity {
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
`,document.head.appendChild(e)}var A={angleArc:`M0CESW_angleArc`,angleLabel:`M0CESW_angleLabel`,angleRay:`M0CESW_angleRay`,basisLabel:`M0CESW_basisLabel`,basisLine:`M0CESW_basisLine`,bodyFill:`M0CESW_bodyFill`,bodyGloss:`M0CESW_bodyGloss`,bodyLabel:`M0CESW_bodyLabel`,bodyLive:`M0CESW_bodyLive`,cartAxle:`M0CESW_cartAxle`,cartHub:`M0CESW_cartHub`,cartSpoke:`M0CESW_cartSpoke`,cartWheel:`M0CESW_cartWheel`,dimensionHighlighted:`M0CESW_dimensionHighlighted`,dimensionLabel:`M0CESW_dimensionLabel`,dimensionLabelHighlighted:`M0CESW_dimensionLabelHighlighted`,dimensionLine:`M0CESW_dimensionLine`,dimensionTick:`M0CESW_dimensionTick`,groundLine:`M0CESW_groundLine`,hatch:`M0CESW_hatch`,highlightGroup:`M0CESW_highlightGroup`,inclineBody:`M0CESW_inclineBody`,keyApex:`M0CESW_keyApex`,keyImpact:`M0CESW_keyImpact`,keyLabel:`M0CESW_keyLabel`,keyLaunch:`M0CESW_keyLaunch`,keySample:`M0CESW_keySample`,labelLeader:`M0CESW_labelLeader`,motionMark:`M0CESW_motionMark`,motionMarkLabel:`M0CESW_motionMarkLabel`,partSprite:`M0CESW_partSprite`,pendulumRest:`M0CESW_pendulumRest`,pendulumString:`M0CESW_pendulumString`,platformBody:`M0CESW_platformBody`,platformEdge:`M0CESW_platformEdge`,roleAcceleration:`M0CESW_roleAcceleration`,roleElectricForce:`M0CESW_roleElectricForce`,roleField:`M0CESW_roleField`,roleForce:`M0CESW_roleForce`,roleFriction:`M0CESW_roleFriction`,roleGravity:`M0CESW_roleGravity`,roleMagneticForce:`M0CESW_roleMagneticForce`,roleMeasurement:`M0CESW_roleMeasurement`,roleNetForce:`M0CESW_roleNetForce`,roleNeutral:`M0CESW_roleNeutral`,roleNormal:`M0CESW_roleNormal`,roleSpring:`M0CESW_roleSpring`,roleTension:`M0CESW_roleTension`,roleTrajectory:`M0CESW_roleTrajectory`,roleVelocity:`M0CESW_roleVelocity`,roleVelocityComponent:`M0CESW_roleVelocityComponent`,springCoil:`M0CESW_springCoil`,springCoilBack:`M0CESW_springCoilBack`,springHatch:`M0CESW_springHatch`,springJoint:`M0CESW_springJoint`,springPlate:`M0CESW_springPlate`,subscript:`M0CESW_subscript`,superscript:`M0CESW_superscript`,surfaceLabel:`M0CESW_surfaceLabel`,vectorLabel:`M0CESW_vectorLabel`,vectorLabelSubordinate:`M0CESW_vectorLabelSubordinate`,vectorLine:`M0CESW_vectorLine`,vectorSubordinate:`M0CESW_vectorSubordinate`},ie=o((e=>{
/**
* @license React
* react-jsx-runtime.production.min.js
*
* Copyright (c) Facebook, Inc. and its affiliates.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/
var t=u(),n=Symbol.for(`react.element`),r=Symbol.for(`react.fragment`),i=Object.prototype.hasOwnProperty,a=t.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,o={key:!0,ref:!0,__self:!0,__source:!0};function s(e,t,r){var s,c={},l=null,u=null;for(s in r!==void 0&&(l=``+r),t.key!==void 0&&(l=``+t.key),t.ref!==void 0&&(u=t.ref),t)i.call(t,s)&&!o.hasOwnProperty(s)&&(c[s]=t[s]);if(e&&e.defaultProps)for(s in t=e.defaultProps,t)c[s]===void 0&&(c[s]=t[s]);return{$$typeof:n,type:e,key:l,ref:u,props:c,_owner:a.current}}e.Fragment=r,e.jsx=s,e.jsxs=s})),j=o(((e,t)=>{t.exports=ie()}))();const ae=11.5,oe=e=>{switch(e){case`velocity`:return A.roleVelocity;case`velocity-component`:return A.roleVelocityComponent;case`force`:return A.roleForce;case`electric-force`:return A.roleElectricForce;case`magnetic-force`:return A.roleMagneticForce;case`gravity`:return A.roleGravity;case`normal`:return A.roleNormal;case`friction`:return A.roleFriction;case`net-force`:return A.roleNetForce;case`spring`:return A.roleSpring;case`tension`:return A.roleTension;case`acceleration`:return A.roleAcceleration;case`trajectory`:return A.roleTrajectory;case`field`:return A.roleField;case`measurement`:return A.roleMeasurement;default:return A.roleNeutral}},M=(e,t)=>`pc-arrow-${e}-${t}`,se=[`velocity`,`velocity-component`,`force`,`electric-force`,`magnetic-force`,`gravity`,`normal`,`friction`,`net-force`,`spring`,`tension`,`acceleration`,`field`,`measurement`,`neutral`],N=({uid:e})=>(0,j.jsxs)(j.Fragment,{children:[se.map(t=>(0,j.jsx)(`marker`,{id:M(t,e),markerWidth:`9`,markerHeight:`9`,refX:`7.4`,refY:`3.6`,orient:`auto`,markerUnits:`userSpaceOnUse`,children:(0,j.jsx)(`path`,{d:`M0 0.4 L8 3.6 L0 6.8 Z`,className:oe(t),fillOpacity:`1`})},t)),(0,j.jsx)(`marker`,{id:`pc-tick-${e}`,markerWidth:`6`,markerHeight:`8`,refX:`3`,refY:`4`,orient:`auto`,markerUnits:`userSpaceOnUse`,children:(0,j.jsx)(`path`,{d:`M3 0.6 V7.4`,className:A.dimensionTick})})]}),ce=({ground:e,projection:t})=>{let n=t.py({x:0,y:e.y}),r=t.px({x:e.from,y:e.y}),i=t.px({x:e.to,y:e.y}),a=Math.max(0,Math.floor((i-r)/13));return(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`line`,{className:A.groundLine,x1:r,y1:n,x2:i,y2:n}),Array.from({length:a},(e,t)=>{let i=r+t*13;return(0,j.jsx)(`line`,{className:A.hatch,x1:i,y1:n+8,x2:i+7,y2:n+1},i)}),e.label===void 0?null:(0,j.jsx)(`text`,{className:A.surfaceLabel,x:r+4,y:n+19,textAnchor:`start`,children:e.label})]})},le=({incline:e,projection:t})=>{let[n,r]=(0,_.useState)(!1),i=e.angle*Math.PI/180,a=e.base*Math.tan(i),o=e.origin,s={x:e.origin.x+e.base,y:e.origin.y},c={x:e.origin.x,y:e.origin.y+a},l=[o,s,c],u=t.px(o),d=t.px(s),f=t.py(o),p=t.py(c),m=Math.max(0,Math.floor((d-u)/13)),h=k.plank,g=(()=>{if(h===void 0||n)return;let{anchorLine:e}=h;if(e===void 0)return;let{a:t,b:r}=e,i=Math.hypot((r.x-t.x)*h.pixels.w,(r.y-t.y)*h.pixels.h),a=Math.hypot(d-u,f-p);if(i===0||a===0)return;let o=a/i;return{a:t,w:h.pixels.w*o,h:h.pixels.h*o,degrees:Math.atan2(f-p,d-u)*180/Math.PI}})();return(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`path`,{className:A.inclineBody,d:`${t.path(l)} Z`}),(0,j.jsx)(`line`,{className:A.groundLine,x1:u,y1:f,x2:d,y2:f}),Array.from({length:m},(e,t)=>{let n=u+t*13;return(0,j.jsx)(`line`,{className:A.hatch,x1:n,y1:f+8,x2:n+7,y2:f+1},n)}),h===void 0||g===void 0?null:(0,j.jsx)(`g`,{transform:`rotate(${g.degrees.toFixed(3)} ${u.toFixed(3)} ${p.toFixed(3)})`,children:(0,j.jsx)(`image`,{"data-testid":`sprite-plank`,href:re(h),x:u-g.a.x*g.w,y:p-g.a.y*g.h,width:g.w,height:g.h,preserveAspectRatio:`none`,className:A.partSprite,onError:()=>{r(!0)}})})]})},ue=({platform:e,projection:t})=>{let n=t.py(e.at),r=t.px({x:e.at.x-e.width,y:e.at.y}),i=t.px(e.at),a=t.py({x:e.at.x,y:e.at.y-e.height});return(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`path`,{className:A.platformBody,d:`M${r} ${n} H${i} V${a} H${i-9} V${n+7} H${r} Z`}),(0,j.jsx)(`line`,{className:A.platformEdge,x1:r,y1:n,x2:i,y2:n})]})},de=({spring:e,projection:t})=>{let n={x:t.px(e.anchor),y:t.py(e.anchor)},r={x:t.px(e.end),y:t.py(e.end)},i=r.x-n.x,a=r.y-n.y,o=Math.hypot(i,a);if(o<8)return null;let s=i/o,c=a/o,l=-c,u=s,d=Math.min(11,Math.max(5,o*.09)),f=Math.min(14,o*.12),p=Math.max(4,Math.min(11,Math.floor(o/26))),m=(o-2*f)/(p*2),h=(e,t)=>`${n.x+s*e+l*t} ${n.y+c*e+u*t}`,g=(e,t)=>{let n=[];for(let r=1;r<=p*2;r+=1){let i=(r%2==1?1:-1)*e;n.push(`Q${h(f+m*(r-.5),i*t*2)} ${h(f+m*r,0)}`)}return n.join(` `)},_=[`M${n.x} ${n.y}`,`L${h(f,0)}`,g(1,d),`L${h(o-f,0)}`,`L${r.x} ${r.y}`],v=[`M${h(f,0)}`,g(-1,d*.92),`L${h(o-f,0)}`],y=[];for(let e=-1;e<=1;e+=1){let t=n.x+l*16*e*.62-s*3,r=n.y+u*16*e*.62-c*3;y.push(`M${t} ${r} l${-s*6-l*5} ${-c*6-u*5}`)}return(0,j.jsxs)(`g`,{"data-testid":`spring-coil`,className:t.highlighted(e.id)?A.highlightGroup:void 0,children:[(0,j.jsx)(`line`,{className:A.springPlate,x1:n.x+l*16,y1:n.y+u*16,x2:n.x-l*16,y2:n.y-u*16}),(0,j.jsx)(`path`,{className:A.springHatch,d:y.join(` `)}),(0,j.jsx)(`path`,{className:A.springCoilBack,d:v.join(` `)}),(0,j.jsx)(`path`,{className:A.springCoil,d:_.join(` `)}),(0,j.jsx)(`circle`,{cx:n.x,cy:n.y,r:2.4,className:A.springJoint}),(0,j.jsx)(`circle`,{cx:r.x,cy:r.y,r:2.4,className:A.springJoint}),e.equilibrium===void 0?null:(()=>{let n=e.axis===`vertical`?{x:e.anchor.x,y:e.equilibrium}:{x:e.equilibrium,y:e.anchor.y},r=t.px(n),i=t.py(n),a=e.axis===`vertical`;return(0,j.jsx)(`line`,{className:A.pendulumRest,x1:a?r-12:r,y1:a?i:i-12,x2:a?r+12:r,y2:a?i:i+12})})()]})},fe=({pendulum:e,projection:t})=>{let n={x:t.px(e.pivot),y:t.py(e.pivot)},r={x:t.px(e.bob),y:t.py(e.bob)},i={x:t.px({x:e.pivot.x,y:e.pivot.y-e.length}),y:t.py({x:e.pivot.x,y:e.pivot.y-e.length})},a=[];for(let e=-1;e<=1;e+=1){let t=n.x+e*20*.55;a.push(`M${t} ${n.y-4} l-5 -7`)}return(0,j.jsxs)(`g`,{"data-testid":`pendulum-rig`,className:t.highlighted(e.id)?A.highlightGroup:void 0,children:[(0,j.jsx)(`line`,{className:A.springPlate,x1:n.x-20,y1:n.y-4,x2:n.x+20,y2:n.y-4}),(0,j.jsx)(`path`,{className:A.springHatch,d:a.join(` `)}),(0,j.jsx)(`line`,{className:A.pendulumRest,x1:n.x,y1:n.y,x2:i.x,y2:i.y}),(0,j.jsx)(`line`,{className:A.pendulumString,x1:n.x,y1:n.y,x2:r.x,y2:r.y}),(0,j.jsx)(`circle`,{cx:n.x,cy:n.y,r:2.6,className:A.springJoint})]})},pe=({sprite:e,projection:t})=>{let[n,r]=(0,_.useState)(!1),i=k[e.part],a=i?.anchorPoint;if(i===void 0||a===void 0||n)return null;let o=e.size*t.scale,s=(e.width??e.size*(i.pixels.w/i.pixels.h))*t.scale,c=t.px(e.at),l=t.py(e.at),u=e.flip===!0?`translate(${2*c} 0) scale(-1 1)`:void 0;return(0,j.jsx)(`g`,{className:t.highlighted(e.id)?A.highlightGroup:void 0,transform:u,children:(0,j.jsx)(`image`,{"data-testid":`apparatus-${e.part}`,href:re(i),x:c-a.x*s,y:l-a.y*o,width:s,height:o,preserveAspectRatio:`none`,className:A.partSprite,onError:()=>{r(!0)}})})},me=({body:e,projection:t})=>{let[n,r]=(0,_.useState)(!1),i=t.px(e.at),a=t.py(e.at),o=e.size*t.scale,s=t.highlighted(e.id),c=e.rotation??0,l=k[e.kind],u=(()=>{if(l?.anchorPoint===void 0||n)return;if(e.kind===`ball`){if(l.radius===void 0||l.radius===0)return;let e=o/(l.radius*l.pixels.w),t=l.pixels.w*e,n=l.pixels.h*e;return{x:i-l.anchorPoint.x*t,y:a-l.anchorPoint.y*n,w:t,h:n}}let t=o*2/(l.solidBox.height*l.pixels.h),r=l.pixels.w*t,s=l.pixels.h*t;return{x:i-l.anchorPoint.x*r,y:a+o-l.anchorPoint.y*s,w:r,h:s}})();return(0,j.jsxs)(`g`,{className:s?A.highlightGroup:void 0,children:[l!==void 0&&u!==void 0?(0,j.jsx)(`g`,{transform:c===0?void 0:`rotate(${-c} ${i} ${a})`,children:(0,j.jsx)(`image`,{"data-testid":`sprite-${e.kind}`,href:re(l),x:u.x,y:u.y,width:u.w,height:u.h,preserveAspectRatio:`none`,className:I(A.partSprite,e.live===!0&&A.bodyLive),onError:()=>{r(!0)}})}):e.kind===`ball`?(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`circle`,{cx:i,cy:a,r:o,className:I(A.bodyFill,e.live===!0&&A.bodyLive),style:{fill:`url(#pc-ball-${t.uid})`}}),(0,j.jsx)(`circle`,{cx:i-o*.32,cy:a-o*.34,r:o*.24,className:A.bodyGloss})]}):e.kind===`cart`?(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`rect`,{x:i-o*1.35,y:a-o*.62,width:o*2.7,height:o*1.1,rx:o*.16,className:I(A.bodyFill,e.live===!0&&A.bodyLive)}),(0,j.jsx)(`line`,{className:A.cartAxle,x1:i-o*.85,y1:a+o*.68,x2:i+o*.85,y2:a+o*.68}),[i-o*.85,i+o*.85].map(t=>{let n=a+o*.68,r=o*.32,i=(e.at.x/(e.size*.32)*180/Math.PI%360+360)%360;return(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`circle`,{cx:t,cy:n,r,className:A.cartWheel}),(0,j.jsx)(`g`,{"data-testid":`cart-spokes`,transform:`rotate(${i.toFixed(2)} ${t.toFixed(2)} ${n.toFixed(2)})`,children:[0,1,2].map(e=>{let i=e*2*Math.PI/3-Math.PI/2;return(0,j.jsx)(`line`,{className:A.cartSpoke,x1:t,y1:n,x2:t+r*.78*Math.cos(i),y2:n+r*.78*Math.sin(i)},e)})}),(0,j.jsx)(`circle`,{cx:t,cy:n,r:o*.1,className:A.cartHub})]},t)})]}):(0,j.jsx)(`rect`,{x:i-o,y:a-o,width:o*2,height:o*2,rx:o*.18,transform:c===0?void 0:`rotate(${-c} ${i} ${a})`,className:I(A.bodyFill,e.live===!0&&A.bodyLive)}),e.label===void 0?null:(0,j.jsx)(`text`,{className:A.bodyLabel,x:i,y:a-o-6,textAnchor:`middle`,children:e.label})]})},he=({vectors:e,projection:t})=>{let n=ne(e.map(e=>{let n=t.px(e.from),r=t.py(e.from),i=t.px(e.to),a=t.py(e.to),o=i-n,s=a-r,c=e.labelHint===`start`?`end`:o>=0?`start`:`end`;return{id:e.id,x:i,y:a,width:O(e.symbol,ae),height:ae,dirX:o,dirY:s,anchor:c}}));return(0,j.jsx)(`g`,{pointerEvents:`none`,children:e.map((e,r)=>{let i=n[r],a=oe(e.role);return(0,j.jsxs)(`g`,{className:t.highlighted(e.id)?A.highlightGroup:void 0,children:[(0,j.jsx)(`line`,{className:I(A.vectorLine,a,e.subordinate===!0&&A.vectorSubordinate),x1:t.px(e.from),y1:t.py(e.from),x2:t.px(e.to),y2:t.py(e.to),markerEnd:`url(#${M(e.role,t.uid)})`}),i?.leader===void 0?null:(0,j.jsx)(`line`,{className:A.labelLeader,x1:i.leader.x1,y1:i.leader.y1,x2:i.leader.x2,y2:i.leader.y2}),i===void 0?null:(0,j.jsx)(P,{x:i.x,y:i.y,anchor:i.anchor,symbol:e.symbol,className:I(A.vectorLabel,a,e.subordinate===!0&&A.vectorLabelSubordinate)})]},e.id)})})},P=({x:e,y:t,anchor:n,symbol:r,className:i})=>{let a=D(r),o=0;return(0,j.jsx)(`text`,{x:e,y:t,textAnchor:n,className:i,children:a.map((e,t)=>{let n=e.script===`sub`?.28:e.script===`super`?-.38:0,r=n-o;return o=n,(0,j.jsx)(`tspan`,{className:e.script===`sub`?A.subscript:e.script===`super`?A.superscript:void 0,dy:r===0?void 0:`${r.toFixed(2)}em`,children:e.text},t)})})},ge=({angle:e,projection:t})=>{let n=t.px(e.at),r=t.py(e.at),i=e.radius*t.scale,a=e=>e*Math.PI/180,o=e=>({x:n+Math.cos(a(e))*i,y:r-Math.sin(a(e))*i}),s=o(e.startAngle),c=o(e.endAngle),l=+(Math.abs(e.endAngle-e.startAngle)>180),u=o((e.startAngle+e.endAngle)/2),d=n+(u.x-n)*1.44,f=r+(u.y-r)*1.44;return(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`line`,{className:A.angleRay,x1:n,y1:r,x2:o(e.startAngle).x,y2:o(e.startAngle).y}),(0,j.jsx)(`line`,{className:A.angleRay,x1:n,y1:r,x2:o(e.endAngle).x,y2:o(e.endAngle).y}),(0,j.jsx)(`path`,{className:A.angleArc,d:`M${s.x.toFixed(2)} ${s.y.toFixed(2)} A${i.toFixed(2)} ${i.toFixed(2)} 0 ${l} ${e.endAngle>e.startAngle?0:1} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`}),(0,j.jsx)(P,{x:d,y:f+4,anchor:`middle`,symbol:e.value===void 0?e.symbol:`${e.symbol}=${e.value}`,className:A.angleLabel})]})},F=({dimension:e,projection:t})=>{let n=t.px(e.from),r=t.py(e.from),i=t.px(e.to),a=t.py(e.to),o=t.highlighted(e.id),s=Math.hypot(i-n,a-r)||1,c=e.side===`right`?-1:1,l=-(a-r)/s*11*c,u=(i-n)/s*11*c;return(0,j.jsxs)(`g`,{className:o?A.highlightGroup:void 0,children:[(0,j.jsx)(`line`,{className:I(A.dimensionLine,o&&A.dimensionHighlighted),x1:n,y1:r,x2:i,y2:a,markerStart:`url(#pc-tick-${t.uid})`,markerEnd:`url(#pc-tick-${t.uid})`}),(0,j.jsx)(P,{x:(n+i)/2+l,y:(r+a)/2+u+3.6,anchor:`middle`,symbol:e.label,className:I(A.dimensionLabel,o&&A.dimensionLabelHighlighted)})]})},_e=({marks:e,projection:t})=>(0,j.jsx)(`g`,{children:e.map(e=>{let n=t.px(e.at),r=t.py(e.at);return(0,j.jsxs)(`g`,{className:t.highlighted(e.id)?A.highlightGroup:void 0,children:[(0,j.jsx)(`circle`,{className:A.motionMark,cx:n,cy:r,r:`3`}),e.label===void 0?null:(0,j.jsx)(`text`,{className:A.motionMarkLabel,x:n,y:r+14,textAnchor:`middle`,children:e.label})]},e.id)})}),ve=({keyPoint:e,projection:t})=>{let n=t.px(e.at),r=t.py(e.at),i=e.kind===`launch`?A.keyLaunch:e.kind===`apex`?A.keyApex:e.kind===`impact`?A.keyImpact:A.keySample;return(0,j.jsxs)(`g`,{className:t.highlighted(e.id)?A.highlightGroup:void 0,children:[(0,j.jsx)(`title`,{children:e.readout===void 0||e.readout.length===0?e.label:`${e.label} · ${e.readout.map(e=>`${e.label} ${e.value}`).join(` · `)}`}),e.kind===`apex`?(0,j.jsx)(`path`,{className:i,d:`M${n} ${r-4.6} L${n+4.2} ${r+3.2} L${n-4.2} ${r+3.2} Z`}):e.kind===`impact`?(0,j.jsx)(`path`,{className:i,d:`M${n} ${r-4.8} L${n+4.8} ${r} L${n} ${r+4.8} L${n-4.8} ${r} Z`}):(0,j.jsx)(`circle`,{className:i,cx:n,cy:r,r:`3.5`}),(0,j.jsx)(`text`,{className:A.keyLabel,x:e.kind===`launch`?n-7:n,y:r-9,textAnchor:e.kind===`launch`?`end`:`middle`,children:e.label})]})},ye=({coordinate:e,projection:t})=>{let n=t.px(e.at),r=t.py(e.at),i=e.length*t.scale,a=(e.rotation??0)*Math.PI/180,o={x:n+Math.cos(a)*i,y:r-Math.sin(a)*i},s={x:n-Math.sin(a)*i,y:r-Math.cos(a)*i};return(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`line`,{className:I(A.basisLine,A.roleMeasurement),x1:n,y1:r,x2:o.x,y2:o.y,markerEnd:`url(#${M(`measurement`,t.uid)})`}),(0,j.jsx)(`line`,{className:I(A.basisLine,A.roleMeasurement),x1:n,y1:r,x2:s.x,y2:s.y,markerEnd:`url(#${M(`measurement`,t.uid)})`}),(0,j.jsx)(P,{x:o.x+6,y:o.y+4,anchor:`start`,symbol:e.xLabel,className:A.basisLabel}),(0,j.jsx)(P,{x:s.x,y:s.y-5,anchor:`middle`,symbol:e.yLabel,className:A.basisLabel})]})},I=(...e)=>e.filter(e=>typeof e==`string`&&e.length>0).join(` `);if(typeof document<`u`){let e=document.createElement(`style`);e.textContent=`.H6yJdG_fieldGlyph {
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
`,document.head.appendChild(e)}var L={acousticGround:`H6yJdG_acousticGround`,acousticGroundHatch:`H6yJdG_acousticGroundHatch`,acousticPathHead:`H6yJdG_acousticPathHead`,acousticPathLabel:`H6yJdG_acousticPathLabel`,acousticPathLine:`H6yJdG_acousticPathLine`,acousticPulseDot:`H6yJdG_acousticPulseDot`,acousticPulseReceived:`H6yJdG_acousticPulseReceived`,acousticSourceBody:`H6yJdG_acousticSourceBody`,acousticSourceCone:`H6yJdG_acousticSourceCone`,acousticSourceStand:`H6yJdG_acousticSourceStand`,acousticSourceWave:`H6yJdG_acousticSourceWave`,acousticWallFace:`H6yJdG_acousticWallFace`,acousticWallHatch:`H6yJdG_acousticWallHatch`,acousticWallPlate:`H6yJdG_acousticWallPlate`,acousticWavefront:`H6yJdG_acousticWavefront`,annotation:`H6yJdG_annotation`,boundedFieldRegion:`H6yJdG_boundedFieldRegion`,circuitAnnotation:`H6yJdG_circuitAnnotation`,circuitChargeFlow:`H6yJdG_circuitChargeFlow`,circuitControl:`H6yJdG_circuitControl`,circuitCurrent:`H6yJdG_circuitCurrent`,circuitCurrentHead:`H6yJdG_circuitCurrentHead`,circuitCurrentText:`H6yJdG_circuitCurrentText`,circuitDialReading:`H6yJdG_circuitDialReading`,circuitDraggable:`H6yJdG_circuitDraggable`,circuitDragging:`H6yJdG_circuitDragging`,circuitHitArea:`H6yJdG_circuitHitArea`,circuitJunction:`H6yJdG_circuitJunction`,circuitLampBloom:`H6yJdG_circuitLampBloom`,circuitLampCore:`H6yJdG_circuitLampCore`,circuitLampFilament:`H6yJdG_circuitLampFilament`,circuitLampGlow:`H6yJdG_circuitLampGlow`,circuitMeterFace:`H6yJdG_circuitMeterFace`,circuitMeterLetter:`H6yJdG_circuitMeterLetter`,circuitName:`H6yJdG_circuitName`,circuitPartSprite:`H6yJdG_circuitPartSprite`,circuitReading:`H6yJdG_circuitReading`,circuitSliderFallback:`H6yJdG_circuitSliderFallback`,circuitSymbol:`H6yJdG_circuitSymbol`,circuitSymbolFill:`H6yJdG_circuitSymbolFill`,circuitSymbolThick:`H6yJdG_circuitSymbolThick`,circuitTerminal:`H6yJdG_circuitTerminal`,circuitTerminalPending:`H6yJdG_circuitTerminalPending`,circuitWire:`H6yJdG_circuitWire`,currentArmature:`H6yJdG_currentArmature`,currentAxisLine:`H6yJdG_currentAxisLine`,currentCoilLoop:`H6yJdG_currentCoilLoop`,currentCoreBar:`H6yJdG_currentCoreBar`,currentFieldArrow:`H6yJdG_currentFieldArrow`,currentFieldArrowHalo:`H6yJdG_currentFieldArrowHalo`,currentFieldLine:`H6yJdG_currentFieldLine`,currentFieldLineHalo:`H6yJdG_currentFieldLineHalo`,currentFieldRing:`H6yJdG_currentFieldRing`,currentPoleLabel:`H6yJdG_currentPoleLabel`,currentProbeBody:`H6yJdG_currentProbeBody`,currentProbeDot:`H6yJdG_currentProbeDot`,currentProbeRing:`H6yJdG_currentProbeRing`,currentReading:`H6yJdG_currentReading`,currentWireCross:`H6yJdG_currentWireCross`,currentWireDot:`H6yJdG_currentWireDot`,currentWireSymbol:`H6yJdG_currentWireSymbol`,curvedMirrorPlate:`H6yJdG_curvedMirrorPlate`,electricFieldLattice:`H6yJdG_electricFieldLattice`,electricFieldLine:`H6yJdG_electricFieldLine`,electricFieldStreamline:`H6yJdG_electricFieldStreamline`,energyBarFrame:`H6yJdG_energyBarFrame`,energyCart:`H6yJdG_energyCart`,energyRampBody:`H6yJdG_energyRampBody`,energyRampSurface:`H6yJdG_energyRampSurface`,energySegmentKinetic:`H6yJdG_energySegmentKinetic`,energySegmentPotential:`H6yJdG_energySegmentPotential`,energySegmentThermal:`H6yJdG_energySegmentThermal`,equipotentialPath:`H6yJdG_equipotentialPath`,equipotentials:`H6yJdG_equipotentials`,fieldGlyph:`H6yJdG_fieldGlyph`,fluidBlockBody:`H6yJdG_fluidBlockBody`,fluidBlockFloating:`H6yJdG_fluidBlockFloating`,fluidBlockSubmerged:`H6yJdG_fluidBlockSubmerged`,fluidDraggable:`H6yJdG_fluidDraggable`,fluidDragging:`H6yJdG_fluidDragging`,fluidLiquidBody:`H6yJdG_fluidLiquidBody`,fluidScaleBody:`H6yJdG_fluidScaleBody`,fluidScaleDial:`H6yJdG_fluidScaleDial`,fluidScaleNeedle:`H6yJdG_fluidScaleNeedle`,fluidScalePivot:`H6yJdG_fluidScalePivot`,fluidScaleReading:`H6yJdG_fluidScaleReading`,fluidScaleRing:`H6yJdG_fluidScaleRing`,fluidSurface:`H6yJdG_fluidSurface`,fluidSurfaceLabel:`H6yJdG_fluidSurfaceLabel`,fluidSurfaceLine:`H6yJdG_fluidSurfaceLine`,fluidTankWall:`H6yJdG_fluidTankWall`,fluidWire:`H6yJdG_fluidWire`,focalLabel:`H6yJdG_focalLabel`,focalTick:`H6yJdG_focalTick`,guideLabel:`H6yJdG_guideLabel`,guideLine:`H6yJdG_guideLine`,highlightGroup:`H6yJdG_highlightGroup`,holeCard:`H6yJdG_holeCard`,inductionChargeDot:`H6yJdG_inductionChargeDot`,inductionCoil:`H6yJdG_inductionCoil`,inductionCurrentArrow:`H6yJdG_inductionCurrentArrow`,inductionCurrentHead:`H6yJdG_inductionCurrentHead`,inductionCurrentLabel:`H6yJdG_inductionCurrentLabel`,inductionFieldBox:`H6yJdG_inductionFieldBox`,inductionFieldMark:`H6yJdG_inductionFieldMark`,inductionForceArrow:`H6yJdG_inductionForceArrow`,inductionForceHead:`H6yJdG_inductionForceHead`,inductionForceLabel:`H6yJdG_inductionForceLabel`,inductionRail:`H6yJdG_inductionRail`,inductionRailEdge:`H6yJdG_inductionRailEdge`,inductionResistor:`H6yJdG_inductionResistor`,inductionResistorLabel:`H6yJdG_inductionResistorLabel`,inductionRod:`H6yJdG_inductionRod`,inductionRodBed:`H6yJdG_inductionRodBed`,inductionRodContact:`H6yJdG_inductionRodContact`,inductionVelocity:`H6yJdG_inductionVelocity`,inductionVelocityHead:`H6yJdG_inductionVelocityHead`,inductionVelocityLabel:`H6yJdG_inductionVelocityLabel`,lensAxisLine:`H6yJdG_lensAxisLine`,lensBody:`H6yJdG_lensBody`,lensHead:`H6yJdG_lensHead`,leverBeamBar:`H6yJdG_leverBeamBar`,leverBeamTick:`H6yJdG_leverBeamTick`,leverFulcrum:`H6yJdG_leverFulcrum`,leverFulcrumBase:`H6yJdG_leverFulcrumBase`,leverFulcrumStand:`H6yJdG_leverFulcrumStand`,leverMass:`H6yJdG_leverMass`,leverMassHook:`H6yJdG_leverMassHook`,leverMassSlot:`H6yJdG_leverMassSlot`,leverString:`H6yJdG_leverString`,lightBoundary:`H6yJdG_lightBoundary`,lightCriticalRay:`H6yJdG_lightCriticalRay`,lightImage:`H6yJdG_lightImage`,lightNormal:`H6yJdG_lightNormal`,lightObject:`H6yJdG_lightObject`,lightRay:`H6yJdG_lightRay`,lightRefractedRay:`H6yJdG_lightRefractedRay`,lightScreen:`H6yJdG_lightScreen`,mirrorHatch:`H6yJdG_mirrorHatch`,mirrorPlate:`H6yJdG_mirrorPlate`,modernCathode:`H6yJdG_modernCathode`,modernCathodeFace:`H6yJdG_modernCathodeFace`,modernElectron:`H6yJdG_modernElectron`,modernElectronHead:`H6yJdG_modernElectronHead`,modernElectronPath:`H6yJdG_modernElectronPath`,modernLabel:`H6yJdG_modernLabel`,modernPhoton:`H6yJdG_modernPhoton`,modernPhotonHead:`H6yJdG_modernPhotonHead`,motorAxis:`H6yJdG_motorAxis`,motorCoil:`H6yJdG_motorCoil`,motorSide:`H6yJdG_motorSide`,motorSpin:`H6yJdG_motorSpin`,motorSpinArrow:`H6yJdG_motorSpinArrow`,motorSpinHalo:`H6yJdG_motorSpinHalo`,noiseBarrier:`H6yJdG_noiseBarrier`,noiseDistance:`H6yJdG_noiseDistance`,noiseListener:`H6yJdG_noiseListener`,noiseSource:`H6yJdG_noiseSource`,noiseWavefront:`H6yJdG_noiseWavefront`,opticalAxis:`H6yJdG_opticalAxis`,opticalImageHead:`H6yJdG_opticalImageHead`,opticalImageLabel:`H6yJdG_opticalImageLabel`,opticalImageLine:`H6yJdG_opticalImageLine`,opticalImageVirtual:`H6yJdG_opticalImageVirtual`,opticalObjectHead:`H6yJdG_opticalObjectHead`,opticalObjectLine:`H6yJdG_opticalObjectLine`,opticalRay:`H6yJdG_opticalRay`,opticalRayExtension:`H6yJdG_opticalRayExtension`,opticalRayHead:`H6yJdG_opticalRayHead`,orbitCenter:`H6yJdG_orbitCenter`,particleLabel:`H6yJdG_particleLabel`,particleLabelNegative:`H6yJdG_particleLabelNegative`,plateBar:`H6yJdG_plateBar`,plateBottom:`H6yJdG_plateBottom`,plateSignLabel:`H6yJdG_plateSignLabel`,plateTop:`H6yJdG_plateTop`,pressureBlock:`H6yJdG_pressureBlock`,pressureDish:`H6yJdG_pressureDish`,pressureGuide:`H6yJdG_pressureGuide`,pressureGuideLabel:`H6yJdG_pressureGuideLabel`,pressureHemisphere:`H6yJdG_pressureHemisphere`,pressureHemisphereJoint:`H6yJdG_pressureHemisphereJoint`,pressureLiquidBody:`H6yJdG_pressureLiquidBody`,pressureMercury:`H6yJdG_pressureMercury`,pressureMercuryPool:`H6yJdG_pressureMercuryPool`,pressurePlate:`H6yJdG_pressurePlate`,pressureProbeBody:`H6yJdG_pressureProbeBody`,pressureProbeDot:`H6yJdG_pressureProbeDot`,pressureReading:`H6yJdG_pressureReading`,pressureTube:`H6yJdG_pressureTube`,pressureVacuum:`H6yJdG_pressureVacuum`,pressureVesselLabel:`H6yJdG_pressureVesselLabel`,pressureVesselWall:`H6yJdG_pressureVesselWall`,probeDot:`H6yJdG_probeDot`,regionTintCrossed:`H6yJdG_regionTintCrossed`,regionTintElectric:`H6yJdG_regionTintElectric`,regionTintMagnetic:`H6yJdG_regionTintMagnetic`,screenFoot:`H6yJdG_screenFoot`,screenGlow:`H6yJdG_screenGlow`,screenPlate:`H6yJdG_screenPlate`,screenPlateLit:`H6yJdG_screenPlateLit`,streamlineArrow:`H6yJdG_streamlineArrow`,streamlinePath:`H6yJdG_streamlinePath`,thermalBeakerWall:`H6yJdG_thermalBeakerWall`,thermalBulb:`H6yJdG_thermalBulb`,thermalColumn:`H6yJdG_thermalColumn`,thermalFlame:`H6yJdG_thermalFlame`,thermalHeaterBody:`H6yJdG_thermalHeaterBody`,thermalMeltingLabel:`H6yJdG_thermalMeltingLabel`,thermalMeltingLine:`H6yJdG_thermalMeltingLine`,thermalReading:`H6yJdG_thermalReading`,thermalSampleLiquid:`H6yJdG_thermalSampleLiquid`,thermalSampleMelting:`H6yJdG_thermalSampleMelting`,thermalSampleSolid:`H6yJdG_thermalSampleSolid`,thermalSurface:`H6yJdG_thermalSurface`,thermalTick:`H6yJdG_thermalTick`,thermalTubeOuter:`H6yJdG_thermalTubeOuter`,thermometerColumn:`H6yJdG_thermometerColumn`,thermometerGlass:`H6yJdG_thermometerGlass`,thermometerSpan:`H6yJdG_thermometerSpan`,thermometerTick:`H6yJdG_thermometerTick`,thermometerTickLabel:`H6yJdG_thermometerTickLabel`,trajectoryDirection:`H6yJdG_trajectoryDirection`,trajectoryHistory:`H6yJdG_trajectoryHistory`,trajectoryPredicted:`H6yJdG_trajectoryPredicted`,trajectoryRunner:`H6yJdG_trajectoryRunner`,transformerCore:`H6yJdG_transformerCore`,transformerPrimaryLoop:`H6yJdG_transformerPrimaryLoop`,transformerSecondaryLoop:`H6yJdG_transformerSecondaryLoop`,waveAntinode:`H6yJdG_waveAntinode`,waveClamp:`H6yJdG_waveClamp`,waveClampHatch:`H6yJdG_waveClampHatch`,waveDriver:`H6yJdG_waveDriver`,waveDriverPin:`H6yJdG_waveDriverPin`,waveEnvelope:`H6yJdG_waveEnvelope`,waveEquilibrium:`H6yJdG_waveEquilibrium`,waveFront:`H6yJdG_waveFront`,waveFrontGroup:`H6yJdG_waveFrontGroup`,waveMarker:`H6yJdG_waveMarker`,waveMarkerGuide:`H6yJdG_waveMarkerGuide`,waveMedium:`H6yJdG_waveMedium`,waveMediumGuide:`H6yJdG_waveMediumGuide`,waveMediumNode:`H6yJdG_waveMediumNode`,waveNode:`H6yJdG_waveNode`,wavePoint:`H6yJdG_wavePoint`,wavePointConstructive:`H6yJdG_wavePointConstructive`,wavePointDestructive:`H6yJdG_wavePointDestructive`,wavePointLabel:`H6yJdG_wavePointLabel`,wavePointPartial:`H6yJdG_wavePointPartial`,waveRope:`H6yJdG_waveRope`,waveSource:`H6yJdG_waveSource`,waveSourceStem:`H6yJdG_waveSourceStem`,waveString:`H6yJdG_waveString`};const be=(e,t,n,r,i)=>{let a=e-n*i,o=t-r*i,s=-r*i*.46,c=n*i*.46;return`M${e} ${t} L${a+s} ${o+c} L${a-s} ${o-c} Z`},xe=(e,t,n,r)=>{let i=n*.766,a=r?e+n:e-n;return`M${a-(r?n:-n)*.36} ${t-i} Q${a} ${t} ${a-(r?n:-n)*.36} ${t+i}`},Se=({x:e,footY:t,size:n,highlighted:r})=>{let i=t-n*1.02;return(0,j.jsxs)(`g`,{className:r?L.highlightGroup:void 0,children:[(0,j.jsx)(`path`,{className:L.acousticSourceStand,d:`M${e-n*.3} ${i+n*.42} L${e-n*.62} ${t} M${e-n*.3} ${i+n*.42} L${e+n*.02} ${t}`}),(0,j.jsx)(`path`,{className:L.acousticSourceBody,d:[`M${e-n*.7} ${i-n*.42}`,`h${n*.55} l${n*.6} ${-n*.34}`,`v${n*1.52} l${-n*.6} ${-n*.34}`,`h${-n*.55} z`].join(` `)}),(0,j.jsx)(`path`,{className:L.acousticSourceCone,d:`M${e-n*.15} ${i-n*.3} L${e+n*.32} ${i-n*.58} M${e-n*.15} ${i+n*.3} L${e+n*.32} ${i+n*.58}`}),(0,j.jsx)(`path`,{className:L.acousticSourceWave,d:`M${e+n*.55} ${i-n*.34} Q${e+n*.72} ${i} ${e+n*.55} ${i+n*.34}`}),(0,j.jsx)(`path`,{className:L.acousticSourceWave,d:`M${e+n*.72} ${i-n*.5} Q${e+n*.98} ${i} ${e+n*.72} ${i+n*.5}`})]})};function Ce({view:e,projection:t}){let n=e.visible.wavefronts===!0,r=e.visible.path===!0,i=e.acousticPulse,a=(e.acousticReflectors?.[0]?.halfHeight??8)*t.scale,o=Math.max(14,Math.min(34,a*.5));return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`defs`,{children:(0,j.jsx)(N,{uid:t.uid})}),e.ground===void 0?null:(0,j.jsx)(ce,{ground:e.ground,projection:t}),r?e.guides.map(e=>{let n=t.px(e.from),r=t.py(e.from),i=t.px(e.to),a=t.py(e.to),o=Math.hypot(i-n,a-r)||1,s=(i-n)/o,c=(a-r)/o;return(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`line`,{className:L.acousticPathLine,x1:n,y1:r,x2:i,y2:a}),(0,j.jsx)(`path`,{className:L.acousticPathHead,d:be((n+i)/2+s*14,(r+a)/2+c*14,s,c,8)}),e.label===void 0?null:(0,j.jsx)(`text`,{className:L.acousticPathLabel,x:(n+i)/2,y:r-7,textAnchor:`middle`,children:e.label})]},e.id)}):null,e.dimensions.map(e=>(0,j.jsx)(F,{dimension:e,projection:t},e.id)),(e.acousticReflectors??[]).map(e=>{let n=t.px(e.at),r=t.py(e.at),i=t.py({x:0,y:e.at.y+2*e.halfHeight}),a=Math.max(4,Math.floor((r-i)/12));return(0,j.jsxs)(`g`,{className:t.highlighted(e.id)?L.highlightGroup:void 0,children:[(0,j.jsx)(`rect`,{className:L.acousticWallFace,x:n,y:i,width:13,height:r-i}),(0,j.jsx)(`line`,{className:L.acousticWallPlate,x1:n,y1:i,x2:n,y2:r}),Array.from({length:a},(e,t)=>{let o=i+(t+.5)/a*(r-i);return(0,j.jsx)(`line`,{className:L.acousticWallHatch,x1:n+3,y1:o+4.5,x2:n+11,y2:o-4.5},t)}),e.label===void 0?null:(0,j.jsx)(`text`,{className:L.annotation,x:n,y:i-8,textAnchor:`middle`,children:e.label})]},e.id)}),(e.acousticSources??[]).map(e=>{let n=t.px(e.at),r=t.py(e.at);return(0,j.jsxs)(`g`,{children:[(0,j.jsx)(Se,{x:n,footY:r,size:o,highlighted:t.highlighted(e.id)}),e.label===void 0?null:(0,j.jsx)(`text`,{className:L.annotation,x:n,y:r+19,textAnchor:`middle`,children:e.label})]},e.id)}),n&&i!==void 0?(e.acousticWavefronts??[]).map(e=>(0,j.jsx)(`path`,{className:L.acousticWavefront,d:xe(t.px(e.at),t.py(e.at),e.radius*t.scale,e.direction===`forward`)},e.id)):null,i===void 0?null:(0,j.jsx)(`circle`,{className:I(L.acousticPulseDot,i.phase===`received`&&L.acousticPulseReceived,t.highlighted(i.id)&&L.highlightGroup),cx:t.px(i.at),cy:t.py(i.at),r:5})]})}var we=class extends Error{code;retryable;details;constructor(e,t,n){super(t),this.name=`PhysicsOSError`,this.code=e,this.retryable=n?.retryable??!1,this.details=n?.details??{}}};Object.freeze({x:0,y:0,z:0}),Object.freeze({x:1,y:0,z:0}),Object.freeze({x:0,y:1,z:0}),Object.freeze({x:0,y:0,z:1}),Math.PI*2,new Set(`dimensionless.length.time.mass.electric_current.temperature.electric_charge.velocity.acceleration.force.energy.power.electric_field.electric_potential.magnetic_flux_density.magnetic_flux.magnetic_flux_rate.resistance.capacitance.inductance.frequency.angle.angular_velocity.momentum.pressure.density.volume.area.specific_heat.specific_latent_heat.torque.intensity`.split(`.`));const R=(e,t,n,r,i,a=[])=>({key:e,dimension:t,symbol:n,toSI:r,canonical:i,aliases:a}),Te=[R(`dimensionless`,`dimensionless`,``,1,!0,[`1`,`-`]),R(`meter`,`length`,`m`,1,!0,[`metre`,`meters`]),R(`centimeter`,`length`,`cm`,.01,!1,[`centimetre`]),R(`millimeter`,`length`,`mm`,.001,!1,[`millimetre`]),R(`kilometer`,`length`,`km`,1e3,!1,[`kilometre`]),R(`second`,`time`,`s`,1,!0,[`sec`,`seconds`]),R(`millisecond`,`time`,`ms`,.001,!1),R(`microsecond`,`time`,`us`,1e-6,!1,[`µs`,`μs`]),R(`minute`,`time`,`min`,60,!1),R(`kilogram`,`mass`,`kg`,1,!0,[`kilogramme`]),R(`gram`,`mass`,`g`,.001,!1,[`gramme`]),R(`ampere`,`electric_current`,`A`,1,!0,[`amp`]),R(`kelvin`,`temperature`,`K`,1,!0),R(`coulomb`,`electric_charge`,`C`,1,!0),R(`millicoulomb`,`electric_charge`,`mC`,.001,!1),R(`microcoulomb`,`electric_charge`,`µC`,1e-6,!1,[`μC`,`uC`]),R(`nanocoulomb`,`electric_charge`,`nC`,1e-9,!1),R(`meter_per_second`,`velocity`,`m/s`,1,!0,[`m*s^-1`,`m s^-1`,`mps`]),R(`kilometer_per_hour`,`velocity`,`km/h`,1e3/3600,!1,[`kph`,`kmph`]),R(`kilometer_per_second`,`velocity`,`km/s`,1e3,!1,[`km*s^-1`]),R(`meter_per_second_squared`,`acceleration`,`m/s^2`,1,!0,[`m/s²`,`m*s^-2`]),R(`newton`,`force`,`N`,1,!0),R(`joule`,`energy`,`J`,1,!0),R(`watt`,`power`,`W`,1,!0),R(`watt_per_square_meter`,`intensity`,`W/m^2`,1,!0,[`W/m²`,`W*m^-2`]),R(`volt_per_meter`,`electric_field`,`V/m`,1,!0,[`N/C`]),R(`volt`,`electric_potential`,`V`,1,!0),R(`tesla`,`magnetic_flux_density`,`T`,1,!0),R(`millitesla`,`magnetic_flux_density`,`mT`,.001,!1),R(`microtesla`,`magnetic_flux_density`,`µT`,1e-6,!1,[`μT`,`uT`]),R(`weber`,`magnetic_flux`,`Wb`,1,!0),R(`weber_per_second`,`magnetic_flux_rate`,`Wb/s`,1,!0,[`Wb*s^-1`]),R(`ohm`,`resistance`,`Ω`,1,!0,[`Ω`,`ohm`,`ohms`]),R(`farad`,`capacitance`,`F`,1,!0),R(`henry`,`inductance`,`H`,1,!0),R(`hertz`,`frequency`,`Hz`,1,!0,[`s^-1`]),R(`kilohertz`,`frequency`,`kHz`,1e3,!1,[`kilohertz`]),R(`radian`,`angle`,`rad`,1,!0),R(`degree`,`angle`,`deg`,Math.PI/180,!1,[`°`]),R(`radian_per_second`,`angular_velocity`,`rad/s`,1,!0,[`rad*s^-1`]),R(`kilogram_meter_per_second`,`momentum`,`kg*m/s`,1,!0,[`kg·m/s`,`kg m/s`]),R(`pascal`,`pressure`,`Pa`,1,!0),R(`kilogram_per_cubic_meter`,`density`,`kg/m^3`,1,!0,[`kg/m³`]),R(`cubic_meter`,`volume`,`m^3`,1,!0,[`m³`]),R(`cubic_centimeter`,`volume`,`cm^3`,1e-6,!1,[`cm³`,`cc`]),R(`liter`,`volume`,`L`,.001,!1,[`litre`]),R(`milliliter`,`volume`,`mL`,1e-6,!1,[`millilitre`,`ml`]),R(`square_meter`,`area`,`m^2`,1,!0,[`m²`]),R(`square_centimeter`,`area`,`cm^2`,1e-4,!1,[`cm²`]),R(`joule_per_kilogram_kelvin`,`specific_heat`,`J/(kg*K)`,1,!0,[`J/(kg·K)`,`J/(kg·℃)`,`J/(kg*C)`]),R(`joule_per_kilogram`,`specific_latent_heat`,`J/kg`,1,!0,[`J*kg^-1`]),R(`newton_meter`,`torque`,`N*m`,1,!0,[`N·m`,`N m`]),R(`newton_centimeter`,`torque`,`N*cm`,.01,!1,[`N·cm`,`N cm`])],Ee=e=>e.normalize(`NFC`).trim(),De=new Map,Oe=new Map,ke=new Map,Ae=e=>{if(Oe.has(e.key))throw new we(`DUPLICATE_UNIT_KEY`,`Unit key "${e.key}" registered twice.`);Oe.set(e.key,e);let t=[e.symbol,e.key,...e.aliases];for(let n of t){let t=Ee(n),r=De.get(t);if(r!==void 0&&r.key!==e.key)throw new we(`AMBIGUOUS_UNIT_SYMBOL`,`Unit symbol "${t}" maps to both "${r.key}" and "${e.key}".`);De.set(t,e)}if(e.canonical){let t=ke.get(e.dimension);if(t!==void 0)throw new we(`DUPLICATE_CANONICAL_UNIT`,`Dimension "${e.dimension}" already has canonical unit "${t.key}".`);ke.set(e.dimension,e)}};for(let e of Te)Ae(e);Object.freeze({relative:1e-9,absolute:1e-12,angular:1e-9}),Object.freeze({relative:1e-6,absolute:1e-9,angular:1e-6});const je=.75,Me=e=>{switch(e??0){case 0:return{x:1,y:0};case 90:return{x:0,y:1};case 180:return{x:-1,y:0};case 270:return{x:0,y:-1}}},Ne=(e,t)=>{let n=Me(e.rotation),r=t===`a`||t===`negative`?-1:1;return{x:e.x+r*je*n.x,y:e.y+r*je*n.y}},Pe={ammeter:{file:`ammeter.png`,pixels:{w:389,h:414},solidBox:{left:.0591,top:.0338,width:.8817,height:.9275},axis:`base`},battery:{file:`studio-v2/battery.png`,pixels:{w:574,h:203},solidBox:{left:.053886,top:.152493,width:.892228,height:.692082},axis:`axial`,terminalOrder:`reversed`,terminals:{a:{x:.121244,y:.501466},b:{x:.878756,y:.501466}}},"lamp-off":{file:`lamp-off.png`,pixels:{w:262,h:430},solidBox:{left:.0878,top:.0535,width:.8244,height:.893},axis:`base`},"lamp-on":{file:`lamp-on.png`,pixels:{w:269,h:428},solidBox:{left:.0855,top:.0491,width:.829,height:.8972},axis:`base`},resistor:{file:`studio-v2/resistor.png`,pixels:{w:573,h:197},solidBox:{left:.054255,top:.157407,width:.892553,height:.685185},axis:`axial`,terminals:{a:{x:.145745,y:.496914},b:{x:.854255,y:.496914}}},rheostat:{file:`studio-v2/rheostat.png`,pixels:{w:574,h:210},solidBox:{left:.054672,top:.146341,width:.890656,height:.704607},axis:`axial`,terminals:{a:{x:.094433,y:.506775},b:{x:.904573,y:.506775}},sliderRail:{start:{x:.203777,y:.205962},end:{x:.795229,y:.205962}}},"switch-closed":{file:`studio-v2/switch-closed.png`,pixels:{w:573,h:304},solidBox:{left:.054526,top:.277207,width:.890949,height:.61807},axis:`axial`,terminals:{a:{x:.114504,y:.587269},b:{x:.883315,y:.587269}}},"switch-open":{file:`studio-v2/switch-open.png`,pixels:{w:573,h:304},solidBox:{left:.054526,top:.102669,width:.890949,height:.794661},axis:`axial`,terminals:{a:{x:.114504,y:.587269},b:{x:.883315,y:.587269}}},terminal:{file:`terminal.png`,pixels:{w:224,h:430},solidBox:{left:.1027,top:.0535,width:.7946,height:.893},axis:`base`},voltmeter:{file:`voltmeter.png`,pixels:{w:407,h:430},solidBox:{left:.0565,top:.0535,width:.8858,height:.893},axis:`base`},meter:{file:`studio-v2/meter.png`,pixels:{w:574,h:282},solidBox:{left:.055118,top:.112128,width:.889764,height:.775744},axis:`axial`,terminals:{a:{x:.138358,y:.494279},b:{x:.867267,y:.494279}},dial:{pivot:{x:.499438,y:.757437},radius:.256468}},"rheostat-knob":{file:`studio-v2/rheostat-knob.png`,pixels:{w:113,h:215},solidBox:{left:.107477,top:.054054,width:.78972,height:.889435},axis:`axial`},"battery-pack":{file:`studio-v3/battery-pack.png`,pixels:{w:418,h:138},solidBox:{left:.041,top:.1656,width:.9187,height:.6713},axis:`axial`,terminalOrder:`reversed`,terminals:{a:{x:.07084,y:.492351},b:{x:.928038,y:.493043}}},"cell-aa":{file:`studio-v3/cell-aa.png`,pixels:{w:405,h:84},solidBox:{left:.0264,top:.2733,width:.9481,height:.4571},axis:`axial`,terminalOrder:`reversed`,terminals:{a:{x:.038441,y:.517507},b:{x:.959392,y:.511692}}},"resistor-5":{file:`studio-v3/resistor-5.png`,pixels:{w:428,h:148},solidBox:{left:.0508,top:.1554,width:.8972,height:.6868},axis:`axial`,terminals:{a:{x:.079174,y:.48491},b:{x:.91618,y:.480619}}},"resistor-50":{file:`studio-v3/resistor-50.png`,pixels:{w:430,h:137},solidBox:{left:.0531,top:.1667,width:.893,height:.6668},axis:`axial`,terminals:{a:{x:.067406,y:.458485},b:{x:.926594,y:.462337}}},"rheostat-50":{file:`studio-v3/rheostat-50.png`,pixels:{w:411,h:135},solidBox:{left:.0342,top:.1696,width:.9343,height:.6605},axis:`axial`,terminals:{a:{x:.04335,y:.529383},b:{x:.956073,y:.548949}},sliderRail:{start:{x:.055961,y:.362963},end:{x:.944039,y:.362963}}},"supply-dc":{file:`studio-v3/supply-dc.png`,pixels:{w:429,h:179},solidBox:{left:.0528,top:.1265,width:.8951,height:.7494},axis:`axial`,terminalOrder:`reversed`,terminals:{a:{x:.097115,y:.496376},b:{x:.905684,y:.478298}}},"switch-button":{file:`studio-v3/switch-button.png`,pixels:{w:429,h:335},solidBox:{left:.0531,top:.0679,width:.8951,height:.8632},axis:`axial`}},Fe=e=>`./assets/parts3d/${e.file}`,Ie=e=>e===`voltage_source`?[`positive`,`negative`]:[`a`,`b`],Le=(e,t,n)=>{switch(e){case`voltage_source`:return t===void 0?`battery`:t<=2?`cell-aa`:t<=9?`battery-pack`:`supply-dc`;case`resistor`:return t===void 0?`resistor`:t<=5?`resistor-5`:t>=50?`resistor-50`:`resistor`;case`variable_resistor`:return t!==void 0&&t>=50?`rheostat-50`:`rheostat`;case`switch`:return n===!1?`switch-open`:`switch-closed`;case`ammeter`:case`voltmeter`:return`meter`}},Re=.75,ze=.28,Be=.05,Ve=e=>Math.abs(e%180)===90,He=(e,t)=>{let n=e.map(e=>({x:t.px(e),y:t.py(e)})),r=n[0],i=n[n.length-1];if(r===void 0||i===void 0)return``;let a=`M${r.x.toFixed(2)} ${r.y.toFixed(2)}`;for(let e=1;e<n.length-1;e+=1){let t=n[e-1],r=n[e],i=n[e+1];if(t===void 0||r===void 0||i===void 0)continue;let o=Math.hypot(r.x-t.x,r.y-t.y),s=Math.hypot(i.x-r.x,i.y-r.y),c=Math.min(7,o/2,s/2);if(c<.5||o===0||s===0){a+=` L${r.x.toFixed(2)} ${r.y.toFixed(2)}`;continue}let l={x:r.x-(r.x-t.x)/o*c,y:r.y-(r.y-t.y)/o*c},u={x:r.x+(i.x-r.x)/s*c,y:r.y+(i.y-r.y)/s*c};a+=` L${l.x.toFixed(2)} ${l.y.toFixed(2)} Q${r.x.toFixed(2)} ${r.y.toFixed(2)} ${u.x.toFixed(2)} ${u.y.toFixed(2)}`}return a+=` L${i.x.toFixed(2)} ${i.y.toFixed(2)}`,a},Ue=(e,t,n)=>{let r=Ne({x:e.at.x,y:e.at.y,rotation:e.rotation},t);return{x:n.px(r),y:n.py(r)}};function We({component:e,cx:t,cy:n,scale:r}){let i=Re*r;switch(e.kind){case`resistor`:case`variable_resistor`:{let a=.5*r,o=.36*r,s=e.sliderPosition??.5;return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`line`,{className:L.circuitSymbol,x1:t-i,y1:n,x2:t-a,y2:n}),(0,j.jsx)(`line`,{className:L.circuitSymbol,x1:t+a,y1:n,x2:t+i,y2:n}),(0,j.jsx)(`rect`,{className:L.circuitSymbol,x:t-a,y:n-o/2,width:a*2,height:o}),e.kind===`variable_resistor`?(()=>{let i=t-a+s*a*2,c=n-o/2-.06*r,l=.11*r;return(0,j.jsxs)(`g`,{"data-testid":`slider-${e.id}`,children:[(0,j.jsx)(`line`,{className:L.circuitSymbol,x1:i,y1:n-.62*r,x2:i,y2:c-l}),(0,j.jsx)(`path`,{className:L.circuitSymbolFill,d:`M${i} ${c} L${i-l*.72} ${c-l} L${i+l*.72} ${c-l} Z`})]})})():null]})}case`voltage_source`:{let e=.12*r,a=.34*r,o=.15*r;return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`line`,{className:L.circuitSymbol,x1:t-i,y1:n,x2:t-e,y2:n}),(0,j.jsx)(`line`,{className:L.circuitSymbol,x1:t+e,y1:n,x2:t+i,y2:n}),(0,j.jsx)(`line`,{className:L.circuitSymbolThick,x1:t-e,y1:n-o,x2:t-e,y2:n+o}),(0,j.jsx)(`line`,{className:L.circuitSymbol,x1:t+e,y1:n-a,x2:t+e,y2:n+a})]})}case`switch`:{let a=.5*r,o=e.closed===!0,s=32*Math.PI/180,c=o?t+a:t-a+Math.cos(s)*a*1.9,l=o?n:n-Math.sin(s)*a*1.9;return(0,j.jsxs)(`g`,{"data-testid":`switch-${e.id}`,"data-closed":o?`true`:`false`,children:[(0,j.jsx)(`line`,{className:L.circuitSymbol,x1:t-i,y1:n,x2:t-a,y2:n}),(0,j.jsx)(`line`,{className:L.circuitSymbol,x1:t+a,y1:n,x2:t+i,y2:n}),(0,j.jsx)(`circle`,{className:L.circuitSymbolFill,cx:t-a,cy:n,r:Math.max(1.6,.09*r)}),(0,j.jsx)(`circle`,{className:L.circuitSymbolFill,cx:t+a,cy:n,r:Math.max(1.6,.09*r)}),(0,j.jsx)(`line`,{className:L.circuitSymbol,x1:t-a,y1:n,x2:c,y2:l})]})}case`ammeter`:case`voltmeter`:{let e=.42*r;return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`line`,{className:L.circuitSymbol,x1:t-i,y1:n,x2:t-e,y2:n}),(0,j.jsx)(`line`,{className:L.circuitSymbol,x1:t+e,y1:n,x2:t+i,y2:n}),(0,j.jsx)(`circle`,{className:I(L.circuitSymbol,L.circuitMeterFace),cx:t,cy:n,r:e})]})}}}function Ge({component:e,cx:t,cy:n,scale:r,offset:i}){let a=n+(i??.56*r),o=.38*r,s=e.currentDirection!==`reverse`,c=s?t-o:t+o,l=s?t+o:t-o,u=4.6,d=s?1:-1;return(0,j.jsxs)(`g`,{"data-testid":`current-${e.id}`,children:[(0,j.jsx)(`line`,{className:L.circuitCurrent,x1:c,y1:a,x2:l-d*u*.6,y2:a}),(0,j.jsx)(`path`,{className:L.circuitCurrentHead,d:`M${l} ${a} L${l-d*u} ${a-u*.44} L${l-d*u} ${a+u*.44} Z`})]})}const Ke=e=>{let t=Le(e.kind,e.ratingValue,e.closed);return Pe[t]===void 0?void 0:t},qe=(e,t,n,r)=>{let i=2*Re*r,a=e.terminalOrder===`reversed`,o=e.terminals===void 0?void 0:a?{x:1-e.terminals.b.x,y:1-e.terminals.b.y}:e.terminals.a,s=i/(e.terminals===void 0?e.solidBox.width:e.terminals.b.x-e.terminals.a.x),c=s*(e.pixels.h/e.pixels.w),l=t-i/2-(o?.x??e.solidBox.left)*s,u=(a?1-e.solidBox.top-e.solidBox.height:e.solidBox.top)*c,d=e.solidBox.height*c,f=o===void 0?e.axis===`axial`?u+d/2:u+d:o.y*c;return{rotation:a?180:0,x:l,y:n-f,width:s,height:c,above:f,below:c-f,body:f-u-d/2,dial:u+d*.32}},Je=(e,t,n,r)=>{let i=r*Math.PI/180,a=Math.cos(i),o=Math.sin(i),s=[],c=[];for(let[r,i]of[[e.x,e.y],[e.x+e.width,e.y],[e.x,e.y+e.height],[e.x+e.width,e.y+e.height]])s.push(t+(r-t)*a-(i-n)*o),c.push(n+(r-t)*o+(i-n)*a);return{left:Math.min(...s),right:Math.max(...s),top:Math.min(...c),bottom:Math.max(...c)}},Ye=(e,t,n,r)=>{let i=r=>{let i=1/0;for(let a of n){if(a.bottom<=t.top||a.top>=t.bottom)continue;let n=r>0?a.left-e:e-a.right;n>=0&&n<i&&(i=n)}return i},a=r===1?-1:1;return i(a)>i(r)?a:r},Xe=(e,t,n,r,i)=>{let a=e?.sliderRail;if(a===void 0||t===void 0)return{start:-.5,end:.5,y:.48,width:.34,height:.46};let o=t.height/i*.72,s=Pe[`rheostat-knob`];return{start:(t.x+a.start.x*t.width-n)/i,end:(t.x+a.end.x*t.width-n)/i,y:(r-t.y-a.start.y*t.height)/i,width:o*(s===void 0?.5:s.pixels.w/s.pixels.h),height:o}};function Ze({component:e,part:t,box:n,slider:r,reading:i,cx:a,cy:o,scale:s,onSpriteError:c}){let l=e.kind===`switch`,u=e.kind===`ammeter`||e.kind===`voltmeter`,[d,f]=(0,_.useState)(!1),p=t.dial===void 0?a:n.x+t.dial.pivot.x*n.width,m=(t.dial===void 0?o-n.dial:n.y+t.dial.pivot.y*n.height)-(t.dial===void 0?0:t.dial.radius*n.width)*.55;return(0,j.jsxs)(`g`,{"data-testid":l?`switch-${e.id}`:void 0,"data-closed":l?e.closed===!0?`true`:`false`:void 0,children:[(0,j.jsx)(`image`,{"data-testid":`sprite-${e.id}`,className:L.circuitPartSprite,href:Fe(t),x:n.x,y:n.y,width:n.width,height:n.height,transform:n.rotation===0?void 0:`rotate(${n.rotation} ${n.x+n.width/2} ${n.y+n.height/2})`,preserveAspectRatio:`none`,"aria-hidden":`true`,onError:()=>{c(e.id)}}),u?(0,j.jsx)(`text`,{"data-testid":i===void 0?void 0:`dial-reading-${e.id}`,className:i===void 0?L.circuitMeterLetter:L.circuitDialReading,x:p,y:m,textAnchor:`middle`,transform:`rotate(${e.rotation} ${p} ${m})`,children:i??(e.kind===`ammeter`?`A`:`V`)}):null,e.kind===`variable_resistor`?(()=>{let t=a+(r.start+(e.sliderPosition??.5)*(r.end-r.start))*s,n=o-r.y*s,i=Pe[`rheostat-knob`],c=r.width*s,l=r.height*s;return(0,j.jsx)(`g`,{"data-testid":`slider-${e.id}`,children:i===void 0||d?(0,j.jsx)(`path`,{className:L.circuitSliderFallback,d:`M${t-c/2} ${n-l/2} h${c} v${l} h${-c} Z`}):(0,j.jsx)(`image`,{"data-testid":`slider-knob-${e.id}`,className:L.circuitPartSprite,href:Fe(i),x:t-c/2,y:n-l/2,width:c,height:l,preserveAspectRatio:`none`,"aria-hidden":`true`,onError:()=>{f(!0)}})})})():null]})}function Qe({view:e,projection:t,time:n,componentDrag:r,componentControl:i,componentWiring:a}){let[o,s]=(0,_.useState)(()=>new Set),c=e=>{s(t=>new Set(t).add(e))},l=(0,_.useRef)({active:!1});(0,_.useEffect)(()=>{if(a===void 0)return;let e=()=>{l.current.active=!1};return window.addEventListener(`pointerup`,e),window.addEventListener(`pointercancel`,e),()=>{window.removeEventListener(`pointerup`,e),window.removeEventListener(`pointercancel`,e)}},[a]);let u=(0,_.useRef)(null),[d,f]=(0,_.useState)(void 0),p=e=>{let n=e.currentTarget.ownerSVGElement;if(n===null)return;let r=n.getBoundingClientRect();if(r.width===0||r.height===0)return;let i=n.viewBox.baseVal;if(i.width===0||i.height===0)return;let a=i.x+(e.clientX-r.left)/r.width*i.width,o=i.y+(e.clientY-r.top)/r.height*i.height;return{x:t.sx(a),y:t.sy(o)}},m=(e,t,n,r)=>{let i=r*Math.PI/180,a=e.x-t,o=e.y-n;return{x:a*Math.cos(i)+o*Math.sin(i),y:-a*Math.sin(i)+o*Math.cos(i)}},h=(e,t,n)=>{let r=(e-t-n.start)/(n.end-n.start);return Math.min(1,Math.max(0,r))},g=(e,t)=>{t.key!==`Enter`&&t.key!==` `||(t.preventDefault(),i?.setSwitch(e.id,e.closed===!0?`open`:`closed`))},v=(e,t)=>{let n=e.sliderPosition??.5,r;t.key===`ArrowRight`||t.key===`ArrowUp`?r=n+Be:t.key===`ArrowLeft`||t.key===`ArrowDown`?r=n-Be:t.key===`Home`?r=0:t.key===`End`&&(r=1),r!==void 0&&(t.preventDefault(),i?.commitSlider(e.id,Math.min(1,Math.max(0,r))))},y=(e,t,n)=>{if(t.button!==0)return;let a=p(t);if(a===void 0)return;if(e.kind===`variable_resistor`&&i!==void 0){let r=m(a,e.at.x,e.at.y,e.rotation),i=n.start+(e.sliderPosition??.5)*(n.end-n.start);if(Math.abs(r.x-i)<=Math.max(ze,n.width/2)&&Math.abs(r.y-n.y)<=n.height/2+.06){typeof t.currentTarget.setPointerCapture==`function`&&t.currentTarget.setPointerCapture(t.pointerId),u.current={componentId:e.id,pointerId:t.pointerId,mode:`slider`,offsetX:0,offsetY:0,startX:e.at.x,startY:e.at.y,moved:!1,baseX:e.at.x,baseY:e.at.y,rotation:e.rotation,rail:n,grabOffset:r.x-i,position:e.sliderPosition??.5},t.stopPropagation();return}}let o=e.kind===`switch`&&i!==void 0?e.closed===!0?`open`:`closed`:void 0;r===void 0&&o===void 0||(typeof t.currentTarget.setPointerCapture==`function`&&t.currentTarget.setPointerCapture(t.pointerId),u.current={componentId:e.id,pointerId:t.pointerId,mode:`move`,offsetX:a.x-e.at.x,offsetY:a.y-e.at.y,startX:e.at.x,startY:e.at.y,moved:!1,baseX:e.at.x,baseY:e.at.y,rotation:e.rotation,rail:n,grabOffset:0,position:0,...o===void 0?{}:{toggleTo:o}},t.stopPropagation())},b=e=>{let n=u.current;if(n===null||e.pointerId!==n.pointerId)return;let a=p(e);if(a===void 0)return;if(n.mode===`slider`){n.position=h(m(a,n.baseX,n.baseY,n.rotation).x,n.grabOffset,n.rail),n.moved=!0,i?.previewSlider(n.componentId,n.position);return}let o=a.x-n.offsetX,s=a.y-n.offsetY;if(!n.moved){if(Math.hypot(o-n.startX,s-n.startY)*t.scale<3)return;n.moved=!0,f(n.componentId)}r?.preview(n.componentId,{x:o,y:s})},x=e=>{let t=u.current;if(t===null||e.pointerId!==t.pointerId)return;if(u.current=null,f(void 0),t.mode===`slider`){t.moved&&i?.commitSlider(t.componentId,t.position);return}if(!t.moved){t.toggleTo!==void 0&&i?.setSwitch(t.componentId,t.toggleTo);return}let n=p(e);n!==void 0&&r?.commit(t.componentId,{x:n.x-t.offsetX,y:n.y-t.offsetY})},S=e.circuitComponents??[],C=e.circuitWires??[],w=e.circuitJunctions??[],T=e.chargeFlows??[],E=t.scale,D=`circuit-lamp-glow-${t.uid}`,ee=`circuit-lamp-bloom-${t.uid}`,te=`circuit-lamp-core-${t.uid}`,ne=e.visible.current===!0,O=e.visible.voltage===!0,k=e.visible.power===!0,re=S.flatMap(e=>{let n=Ke(e);if(n===void 0||o.has(e.id))return[];let r=Pe[n];if(r===void 0)return[];let i=t.px(e.at),a=t.py(e.at);return[{id:e.id,rect:Je(qe(r,i,a,E),i,a,-e.rotation)}]});return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsxs)(`defs`,{children:[(0,j.jsxs)(`radialGradient`,{id:D,cx:`50%`,cy:`50%`,r:`50%`,children:[(0,j.jsx)(`stop`,{offset:`0%`,stopColor:`#ffe6a8`,stopOpacity:`0.95`}),(0,j.jsx)(`stop`,{offset:`55%`,stopColor:`#f5a524`,stopOpacity:`0.55`}),(0,j.jsx)(`stop`,{offset:`100%`,stopColor:`#f5a524`,stopOpacity:`0`})]}),(0,j.jsxs)(`radialGradient`,{id:ee,cx:`50%`,cy:`50%`,r:`50%`,children:[(0,j.jsx)(`stop`,{offset:`0%`,stopColor:`#ff9d2e`,stopOpacity:`0.42`}),(0,j.jsx)(`stop`,{offset:`60%`,stopColor:`#ff9d2e`,stopOpacity:`0.14`}),(0,j.jsx)(`stop`,{offset:`100%`,stopColor:`#ff9d2e`,stopOpacity:`0`})]}),(0,j.jsxs)(`radialGradient`,{id:te,cx:`50%`,cy:`50%`,r:`50%`,children:[(0,j.jsx)(`stop`,{offset:`0%`,stopColor:`#fff8e6`,stopOpacity:`1`}),(0,j.jsx)(`stop`,{offset:`70%`,stopColor:`#fff8e6`,stopOpacity:`0.5`}),(0,j.jsx)(`stop`,{offset:`100%`,stopColor:`#fff8e6`,stopOpacity:`0`})]})]}),C.map(e=>(0,j.jsx)(`path`,{className:L.circuitWire,d:He(e.points,t)},e.id)),ne?T.map(e=>{let r=Math.min(90,Math.max(8,Math.abs(e.current)*110)),i=e.current===0?0:-Math.sign(e.current)*r*(n??0);return(0,j.jsx)(`path`,{className:L.circuitChargeFlow,"data-charge-flow":e.id,"data-current-sign":e.current>0?`forward`:e.current<0?`reverse`:`idle`,d:He(e.path,t),strokeDasharray:`0.1 14`,strokeDashoffset:i,"aria-hidden":`true`},e.id)}):null,w.map(e=>(0,j.jsx)(`circle`,{className:L.circuitJunction,cx:t.px(e.at),cy:t.py(e.at),r:2.8},e.id)),S.map(e=>{let n=t.px(e.at),s=t.py(e.at),p=-e.rotation,m=Ve(e.rotation),h=t.highlighted(e.id),_=Ke(e),S=_===void 0||o.has(e.id)?void 0:Pe[_],C=S===void 0?void 0:qe(S,n,s,E),w=S!==void 0&&C!==void 0?{part:S,box:C}:void 0,T=Xe(S,C,n,s,E),A=e.sliderPosition??.5,ie=n+(T.start+A*(T.end-T.start))*E,ae=s-T.y*E,oe=Math.max(ze*2,T.width)*E,M=(T.height+.12)*E,se=e.kind===`ammeter`?ne?e.reading:void 0:e.kind===`voltmeter`&&O?e.reading:void 0,N=[...e.value===void 0?[]:[{text:e.value,className:L.circuitAnnotation??``}],...se===void 0||w!==void 0?[]:[{text:se,className:L.circuitReading??``}],...ne&&e.currentText!==void 0?[{text:e.currentText,className:L.circuitCurrentText??``}]:[],...O&&e.voltageText!==void 0?[{text:e.voltageText,className:L.circuitAnnotation??``}]:[],...k&&e.powerText!==void 0?[{text:e.powerText,className:L.circuitAnnotation??``}]:[]],ce=(e.rotation%360+360)%360,le=Math.max(C?.above??0,e.kind===`variable_resistor`?(T.y+T.height/2)*E:0),ue=Math.max(C?.below??0,e.kind===`variable_resistor`?(-T.y+T.height/2)*E:0),de=ce===90?le:ue,fe=ce===90?ue:le,pe={top:s-(N.length-1)*13/2-9,bottom:s+(N.length-1)*13/2+13},me=m?Ye(n,pe,re.filter(t=>t.id!==e.id).map(e=>e.rect),1):1,he=N.length>0&&m?me:-1,P=me===1?fe:de,ge=he===1?fe:de,F=m?{x:n+he*(Math.max(.62*E,ge)+4),y:N.length>0?s-(N.length-1)*13/2-12:s+4}:{x:n,y:s-Math.max(.5*E,le)-8},_e=m?{x:n+me*(Math.max(.62*E,P)+4),y:s-(N.length-1)*13/2+4}:{x:n,y:s+Math.max(.55*E,ue)+14},ve=e.glow??0,ye=s-(C?.body??0);return(0,j.jsxs)(`g`,{className:I(h?L.highlightGroup:void 0,r===void 0?void 0:L.circuitDraggable,d===e.id?L.circuitDragging:void 0),"data-component-id":e.id,onPointerDown:t=>{y(e,t,T)},onPointerMove:b,onPointerUp:x,onPointerCancel:e=>{let t=u.current;t===null||e.pointerId!==t.pointerId||(u.current=null,f(void 0),t.mode===`slider`?i?.cancelSlider():r?.cancel())},children:[ve>0?(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`circle`,{className:L.circuitLampBloom,cx:n,cy:ye,r:(1.5+2.6*ve)*E,fill:`url(#${ee})`,opacity:Math.min(1,.9*ve)}),(0,j.jsx)(`circle`,{"data-testid":`glow-${e.id}`,className:L.circuitLampGlow,cx:n,cy:ye,r:(.55+.75*ve)*E,fill:`url(#${D})`,opacity:Math.min(1,.85*ve)}),(0,j.jsx)(`circle`,{className:L.circuitLampCore,cx:n,cy:ye,r:(.32+.3*ve)*E,fill:`url(#${te})`,opacity:Math.min(1,1.05*ve)})]}):null,(0,j.jsxs)(`g`,{transform:`rotate(${p} ${n} ${s})`,children:[r===void 0&&i===void 0?null:(0,j.jsx)(`rect`,{className:L.circuitHitArea,x:C===void 0?n-Re*E:C.x,y:C===void 0?s-.45*E:C.y,width:C===void 0?2*Re*E:C.width,height:C===void 0?.9*E:C.height}),i===void 0?null:e.kind===`switch`?(0,j.jsx)(`rect`,{"data-control":`switch-${e.id}`,className:L.circuitControl,x:C===void 0?n-Re*E:C.x,y:C===void 0?s-.45*E:C.y,width:C===void 0?2*Re*E:C.width,height:C===void 0?.9*E:C.height,tabIndex:0,role:`switch`,"aria-checked":e.closed===!0,"aria-label":e.label,onKeyDown:t=>{g(e,t)}}):e.kind===`variable_resistor`?(0,j.jsx)(`rect`,{"data-control":`slider-${e.id}`,className:L.circuitControl,x:ie-oe/2,y:ae-M/2,width:oe,height:M,tabIndex:0,role:`slider`,"aria-orientation":m?`vertical`:`horizontal`,"aria-valuemin":0,"aria-valuemax":100,"aria-valuenow":Math.round(A*100),"aria-label":e.label,onKeyDown:t=>{v(e,t)}}):null,w===void 0?(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(We,{component:e,cx:n,cy:s,scale:E}),e.glow===void 0?null:(0,j.jsx)(`path`,{"data-testid":`filament-${e.id}`,className:L.circuitLampFilament,d:`M${n-.62*E} ${s} L${n-.42*E} ${s-.2*E} L${n-.2*E} ${s+.2*E} L${n} ${s-.14*E} L${n+.2*E} ${s+.2*E} L${n+.42*E} ${s-.2*E} L${n+.62*E} ${s}`,opacity:Math.min(1,.25+.75*ve)})]}):(0,j.jsx)(Ze,{component:e,part:w.part,box:w.box,slider:T,reading:se,cx:n,cy:s,scale:E,onSpriteError:c}),ne&&e.currentText!==void 0?(0,j.jsx)(Ge,{component:e,cx:n,cy:s,scale:E,offset:Math.max(.56*E,ue+6)}):null]}),w===void 0&&(e.kind===`ammeter`||e.kind===`voltmeter`)?(0,j.jsx)(`text`,{className:L.circuitMeterLetter,x:n,y:s,textAnchor:`middle`,children:e.kind===`ammeter`?`A`:`V`}):null,a===void 0?null:(0,j.jsx)(`g`,{className:L.circuitTerminals,children:Ie(e.kind).map(n=>{let r=Ue(e,n,t),i=a.pending?.componentId===e.id&&a.pending.terminalKey===n;return(0,j.jsx)(`circle`,{className:I(L.circuitTerminal,i?L.circuitTerminalPending:void 0),"data-terminal":`${e.id}.${n}`,cx:r.x,cy:r.y,r:.3*E,tabIndex:0,role:`button`,"aria-label":`${e.label} ${n}`,onPointerDown:t=>{t.stopPropagation(),t.pointerType!==`mouse`&&t.currentTarget.setPointerCapture(t.pointerId),l.current.active=!0,a.start({componentId:e.id,terminalKey:n})},onPointerUp:t=>{l.current.active&&(t.stopPropagation(),a.start({componentId:e.id,terminalKey:n}))},onKeyDown:t=>{t.key!==`Enter`&&t.key!==` `||(t.preventDefault(),a.start({componentId:e.id,terminalKey:n}))}},n)})}),(0,j.jsx)(`text`,{className:L.circuitName,x:F.x,y:F.y,textAnchor:m?he===1?`start`:`end`:`middle`,children:e.label}),N.map((t,n)=>(0,j.jsx)(`text`,{className:t.className,x:_e.x,y:_e.y+n*13,textAnchor:m?me===1?`start`:`end`:`middle`,children:t.text},`${e.id}-row-${n}`))]},e.id)})]})}function $e({view:e,projection:t}){let n=e.pressureRig,r=e.visible.pressure===!0,i=e.visible.pressureComparison===!0;if(n===`solid`&&e.pressureSolid!==void 0){let n=e.pressureSolid,i=e.ground;return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`defs`,{children:(0,j.jsx)(N,{uid:t.uid})}),i===void 0?null:(0,j.jsx)(ce,{ground:i,projection:t}),n.faces.map(e=>{let r=t.px(e.at),i=t.py(e.at),a=e.halfWidth*t.scale,o=t.py({x:e.at.x,y:e.at.y+n.halfHeight});return(0,j.jsxs)(`g`,{className:t.highlighted(e.id)?L.highlightGroup:void 0,children:[(0,j.jsx)(`rect`,{className:L.pressurePlate,x:r-a,y:i,width:a*2,height:n.plateDepth*t.scale,rx:1}),(0,j.jsx)(`rect`,{className:L.pressureBlock,x:r-a,y:o,width:a*2,height:i-o,rx:2}),(0,j.jsx)(`text`,{className:L.pressureReading,x:r,y:(o+i)/2+4,textAnchor:`middle`,children:e.pressureText})]},e.id)}),(0,j.jsx)(he,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t}),r?(0,j.jsx)(P,{x:t.px(n.faces[0]?.at??n.at),y:t.py({x:0,y:2*n.halfHeight+7.2}),anchor:`middle`,symbol:n.forceText,className:L.pressureReading}):null,e.dimensions.map(e=>(0,j.jsx)(F,{dimension:e,projection:t},e.id))]})}if(n===`liquid`){let n=[e.pressureLiquid,e.pressureComparisonLiquid].filter(e=>e!==void 0),r=e.pressureProbes??[];return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`defs`,{children:(0,j.jsx)(N,{uid:t.uid})}),n.map(e=>{let n=t.px({x:e.left,y:0}),r=t.px({x:e.right,y:0}),i=t.py({x:0,y:e.surface}),a=t.py({x:0,y:e.floor}),o=i-e.rim*t.scale;return(0,j.jsxs)(`g`,{className:t.highlighted(e.id)?L.highlightGroup:void 0,children:[(0,j.jsx)(`rect`,{className:L.pressureLiquidBody,x:n,y:i,width:r-n,height:a-i}),(0,j.jsx)(`path`,{className:L.pressureVesselWall,d:`M${n} ${o} V${a} H${r} V${o}`}),(0,j.jsx)(P,{x:(n+r)/2,y:a+16,anchor:`middle`,symbol:e.densityText,className:L.pressureVesselLabel})]},e.id)}),r.map(e=>{let n=t.px(e.at),r=t.py(e.at),i=.85*t.scale;return(0,j.jsxs)(`g`,{"data-testid":`pressure-probe-${e.primary?`primary`:`comparison`}`,children:[(0,j.jsx)(`circle`,{className:L.pressureProbeBody,cx:n,cy:r,r:i}),(0,j.jsx)(`circle`,{className:L.pressureProbeDot,cx:n,cy:r,r:i*.34}),(0,j.jsx)(P,{x:n+i+5,y:r+4,anchor:`start`,symbol:e.readingText,className:L.pressureReading})]},e.id)}),e.guides.filter(t=>e.visible[t.observable]===!0).map(e=>(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`line`,{className:L.fluidSurfaceLine,x1:t.px(e.from),y1:t.py(e.from),x2:t.px(e.to),y2:t.py(e.to)}),e.label===void 0?null:(0,j.jsx)(P,{x:(t.px(e.from)+t.px(e.to))/2+6,y:(t.py(e.from)+t.py(e.to))/2-6,anchor:`start`,symbol:e.label,className:L.pressureGuideLabel})]},e.id)),e.dimensions.map(e=>(0,j.jsx)(F,{dimension:e,projection:t},e.id))]})}if(n===`atmospheric`&&e.pressureBarometer!==void 0){let n=e.pressureBarometer,r=e.pressureHemispheres,a=t.px(n.at),o=n.halfWidth*t.scale,s=t.py(n.at),c=t.py({x:n.at.x,y:n.columnTop}),l=t.py({x:n.at.x,y:n.tubeTop}),u=n.dishHalfWidth*t.scale,d=s+n.dishDepth*t.scale;return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`defs`,{children:(0,j.jsx)(N,{uid:t.uid})}),(0,j.jsx)(`rect`,{className:L.pressureMercuryPool,x:a-u,y:s,width:u*2,height:d-s}),(0,j.jsx)(`path`,{className:L.pressureDish,d:`M${a-u} ${s-3*t.scale} V${d} H${a+u} V${s-3*t.scale}`}),(0,j.jsx)(`path`,{className:L.pressureTube,d:`M${a-o} ${d} V${l+o} A${o} ${o} 0 0 1 ${a+o} ${l+o} V${d}`}),(0,j.jsx)(`rect`,{className:L.pressureMercury,x:a-o,y:c,width:o*2,height:s-c}),(0,j.jsx)(`text`,{className:L.pressureVacuum,x:a,y:c-8,textAnchor:`middle`,children:`真空`}),(0,j.jsx)(P,{x:a,y:s+22,anchor:`middle`,symbol:n.pressureText,className:L.pressureReading}),r===void 0?null:(()=>{let e=t.px(r.at),n=t.py(r.at),a=r.radius*t.scale;return(0,j.jsxs)(`g`,{"data-testid":`magdeburg-hemispheres`,children:[(0,j.jsx)(`circle`,{className:L.pressureHemisphere,cx:e,cy:n,r:a}),(0,j.jsx)(`line`,{className:L.pressureHemisphereJoint,x1:e,y1:n-a,x2:e,y2:n+a}),i?(0,j.jsx)(P,{x:e,y:n+a+20,anchor:`middle`,symbol:r.forceText,className:L.pressureReading}):null]})})(),(0,j.jsx)(he,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t}),e.guides.filter(t=>e.visible[t.observable]===!0).map(e=>(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`line`,{className:L.pressureGuide,x1:t.px(e.from),y1:t.py(e.from),x2:t.px(e.to),y2:t.py(e.to)}),e.label===void 0?null:(0,j.jsx)(P,{x:(t.px(e.from)+t.px(e.to))/2+6,y:(t.py(e.from)+t.py(e.to))/2-6,anchor:`start`,symbol:e.label,className:L.pressureGuideLabel})]},e.id)),e.dimensions.map(e=>(0,j.jsx)(F,{dimension:e,projection:t},e.id))]})}return null}const et=({x:e,y:t,size:n,reading:r,dialFraction:i,highlighted:a})=>{let o=(140-(i??0)*100)*Math.PI/180,s=t-n*.34,c={x:e+n*.3*Math.cos(o),y:s+n*.3*Math.sin(o)};return(0,j.jsxs)(`g`,{className:a?L.highlightGroup:void 0,children:[(0,j.jsx)(`circle`,{className:L.fluidScaleRing,cx:e,cy:t-n*.86,r:n*.24}),(0,j.jsx)(`rect`,{className:L.fluidScaleBody,x:e-n*.9,y:t-n*.62,width:n*1.8,height:n*1.24,rx:n*.26}),(0,j.jsx)(`rect`,{className:L.fluidScaleDial,x:e-n*.68,y:t-n*.4,width:n*1.36,height:n*.8,rx:n*.14}),i===void 0?null:(0,j.jsxs)(`g`,{"data-testid":`scale-needle`,children:[(0,j.jsx)(`line`,{className:L.fluidScaleNeedle,x1:e,y1:s,x2:c.x,y2:c.y}),(0,j.jsx)(`circle`,{className:L.fluidScalePivot,cx:e,cy:s,r:n*.045})]}),(0,j.jsx)(`text`,{className:L.fluidScaleReading,x:e,y:t+n*.16,textAnchor:`middle`,children:r}),(0,j.jsx)(`path`,{className:L.fluidScaleRing,d:`M${e} ${t+n*.62} v${n*.1} a${n*.16} ${n*.16} 0 1 0 ${n*.02} ${n*.24}`})]})};function tt(e){return e.view.pressureRig===void 0?(0,j.jsx)(nt,{...e}):(0,j.jsx)($e,{view:e.view,projection:e.projection})}function nt({view:e,projection:t,componentDrag:n}){let r=e.visible.forces===!0,i=e.visible.displaced===!0,a=e.fluidLiquid,o=e.fluidBlock,s=e.fluidScale,c=(0,_.useRef)(null),[l,u]=(0,_.useState)(!1),d=e=>{let n=e.currentTarget.ownerSVGElement;if(n===null)return;let r=n.getBoundingClientRect();if(r.width===0||r.height===0)return;let i=n.viewBox.baseVal;if(i.width===0||i.height===0)return;let a=i.x+(e.clientX-r.left)/r.width*i.width,o=i.y+(e.clientY-r.top)/r.height*i.height;return{x:t.sx(a),y:t.sy(o)}};return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`defs`,{children:(0,j.jsx)(N,{uid:t.uid})}),a===void 0?null:(()=>{let e=t.px({x:a.left,y:0}),n=t.px({x:a.right,y:0}),r=t.py({x:0,y:a.surface}),i=t.py({x:0,y:a.floor}),o=t.py({x:0,y:a.surface+(a.surface-a.floor)*.18});return(0,j.jsxs)(`g`,{className:t.highlighted(a.id)?L.highlightGroup:void 0,children:[(0,j.jsx)(`defs`,{children:(0,j.jsxs)(`linearGradient`,{id:`fluid-liquid-${t.uid}`,x1:`0`,y1:`0`,x2:`0`,y2:`1`,children:[(0,j.jsx)(`stop`,{offset:`0`,stopColor:`#dcedf9`}),(0,j.jsx)(`stop`,{offset:`1`,stopColor:`#a8cbe8`})]})}),(0,j.jsx)(`rect`,{className:L.fluidLiquidBody,x:e,y:r,width:n-e,height:i-r,style:{fill:`url(#fluid-liquid-${t.uid})`}}),(0,j.jsx)(`line`,{className:L.fluidSurface,x1:e,y1:r,x2:n,y2:r}),(0,j.jsx)(`path`,{className:L.fluidTankWall,d:[`M${e-4} ${o-3}`,`L${e} ${o}`,`V${i-6}`,`Q${e} ${i} ${e+6} ${i}`,`H${n-6}`,`Q${n} ${i} ${n} ${i-6}`,`V${o}`,`L${n+4} ${o-3}`].join(` `)}),a.label===void 0?null:(0,j.jsx)(`text`,{className:L.annotation,x:t.px({x:a.right,y:0})-8,y:t.py({x:0,y:a.floor})-8,textAnchor:`end`,children:a.label})]})})(),i?e.guides.map(e=>(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`line`,{className:L.fluidSurfaceLine,x1:t.px(e.from),y1:t.py(e.from),x2:t.px(e.to),y2:t.py(e.to)}),e.label===void 0?null:(0,j.jsx)(`text`,{className:L.fluidSurfaceLabel,x:t.px(e.to)-6,y:t.py(e.to)-6,textAnchor:`end`,children:e.label})]},e.id)):null,i?e.dimensions.map(e=>(0,j.jsx)(F,{dimension:e,projection:t},e.id)):null,s===void 0||o===void 0?null:(()=>{let e=Math.max(16,Math.min(38,o.halfHeight*t.scale*.9));return(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`line`,{className:L.fluidWire,x1:t.px(s.at),y1:t.py(s.at)+e*.72,x2:t.px(o.at),y2:t.py({x:o.at.x,y:o.at.y+o.halfHeight})}),(0,j.jsx)(et,{x:t.px(s.at),y:t.py(s.at),size:e,reading:s.reading,dialFraction:s.dialFraction,highlighted:t.highlighted(s.id)}),s.label===void 0?null:(0,j.jsx)(`text`,{className:L.annotation,x:t.px(s.at),y:t.py(s.at)-Math.max(16,o.halfHeight*t.scale)-6,textAnchor:`middle`,children:s.label})]})})(),o===void 0?null:(0,j.jsxs)(`g`,{className:I(t.highlighted(o.id)?L.highlightGroup:void 0,n===void 0?void 0:L.fluidDraggable,l?L.fluidDragging:void 0),onPointerDown:n===void 0?void 0:e=>{if(n===void 0||o===void 0)return;let t=d(e);t!==void 0&&(typeof e.currentTarget.setPointerCapture==`function`&&e.currentTarget.setPointerCapture(e.pointerId),c.current={pointerId:e.pointerId,grabY:t.y-o.at.y,moved:!1},e.stopPropagation())},onPointerMove:n===void 0?void 0:e=>{let r=c.current;if(r===null||e.pointerId!==r.pointerId||o===void 0)return;let i=d(e);if(i===void 0)return;let a=i.y-r.grabY;if(!r.moved){if(Math.abs(a-o.at.y)*t.scale<3)return;r.moved=!0,u(!0)}n?.preview(o.id,{x:o.at.x,y:a})},onPointerUp:n===void 0?void 0:e=>{let t=c.current;if(t===null||e.pointerId!==t.pointerId||(c.current=null,u(!1),!t.moved||o===void 0))return;let r=d(e);r!==void 0&&n?.commit(o.id,{x:o.at.x,y:r.y-t.grabY})},onPointerCancel:n===void 0?void 0:e=>{let t=c.current;t===null||e.pointerId!==t.pointerId||(c.current=null,u(!1),n?.cancel())},children:[n===void 0?null:(0,j.jsx)(`title`,{children:`拖动物块改变浸入深度，读数实时跟随`}),(0,j.jsx)(`rect`,{className:I(L.fluidBlockBody,o.phase===`floating`&&L.fluidBlockFloating),x:t.px({x:o.at.x-o.halfWidth,y:0}),y:t.py({x:0,y:o.at.y+o.halfHeight}),width:o.halfWidth*2*t.scale,height:o.halfHeight*2*t.scale}),o.submergedTop<=o.at.y-o.halfHeight?null:(0,j.jsx)(`rect`,{className:L.fluidBlockSubmerged,x:t.px({x:o.at.x-o.halfWidth,y:0}),y:t.py({x:0,y:o.submergedTop}),width:o.halfWidth*2*t.scale,height:t.py({x:0,y:o.at.y-o.halfHeight})-t.py({x:0,y:o.submergedTop})}),o.label===void 0?null:(0,j.jsx)(`text`,{className:L.annotation,x:t.px({x:o.at.x-o.halfWidth,y:0})-8,y:t.py(o.at),textAnchor:`end`,children:o.label})]}),r?(0,j.jsx)(he,{vectors:e.vectors,projection:t}):null]})}const rt=[Math.PI/3,Math.PI,5*Math.PI/3],it=(e,t)=>t===1?{x:-Math.sin(e),y:-Math.cos(e)}:{x:Math.sin(e),y:Math.cos(e)},at=(e,t)=>{let n=e.slice(1).flatMap((t,n)=>{let r=e[n];return r===void 0?[]:[{from:r,to:t,length:Math.hypot(t.x-r.x,t.y-r.y)}]}),r=n.reduce((e,t)=>e+t.length,0);if(r===0)return;let i=Math.min(Math.max(t,0),1)*r;for(let e of n){if(i>e.length){i-=e.length;continue}let t=e.length===0?0:i/e.length;return{at:{x:e.from.x+(e.to.x-e.from.x)*t,y:e.from.y+(e.to.y-e.from.y)*t},direction:{x:(e.to.x-e.from.x)/e.length,y:(e.to.y-e.from.y)/e.length}}}},ot=(e,t,n)=>{let r={x:-t.y,y:t.x},i={x:e.x+t.x*n,y:e.y+t.y*n},a={x:e.x-t.x*n*.5,y:e.y-t.y*n*.5},o=n*.52;return`M${i.x} ${i.y} L${a.x+r.x*o} ${a.y+r.y*o} L${a.x-r.x*o} ${a.y-r.y*o} Z`},st=(e,t,n,r,i)=>{let a=e+n*Math.cos(r),o=t-n*Math.sin(r),s=it(r,i),c={x:-s.y,y:s.x},l={x:a+s.x*7,y:o+s.y*7},u={x:a-s.x*1.4,y:o-s.y*1.4},d=7*.42;return`M${l.x} ${l.y} L${u.x+c.x*d} ${u.y+c.y*d} L${u.x-c.x*d} ${u.y-c.y*d} Z`};function ct({view:e,projection:t}){let n=e.currentRig;if(n===`straight_wire`&&e.currentWire!==void 0){let n=e.currentWire,r=e.currentFieldCircles??[],i=e.currentProbes??[],a=t.px(n.at),o=t.py(n.at),s=1.5*t.scale,c=s*.62;return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`defs`,{children:(0,j.jsx)(N,{uid:t.uid})}),r.map(e=>{let n=e.radius*t.scale;return(0,j.jsxs)(`g`,{"data-testid":`current-ring-${e.id}`,children:[(0,j.jsx)(`circle`,{className:e.probe?L.currentProbeRing:L.currentFieldRing,cx:a,cy:o,r:n}),rt.map(t=>(0,j.jsx)(`path`,{className:L.currentFieldArrow,d:st(a,o,n,t,e.circulation)},t))]},e.id)}),(0,j.jsxs)(`g`,{"data-testid":`current-conductor`,children:[(0,j.jsx)(`circle`,{className:L.currentWireSymbol,cx:a,cy:o,r:s}),n.direction===1?(0,j.jsx)(`circle`,{className:L.currentWireDot,cx:a,cy:o,r:s*.42}):(0,j.jsx)(`path`,{className:L.currentWireCross,d:`M${a-c} ${o-c} L${a+c} ${o+c} M${a+c} ${o-c} L${a-c} ${o+c}`})]}),(0,j.jsx)(P,{x:a,y:o-r.reduce((e,t)=>Math.max(e,t.radius),0)*t.scale-12,anchor:`middle`,symbol:n.currentText,className:L.currentReading}),i.map(e=>{let i=t.px(e.at),s=t.py(e.at),c=e.primary?`primary`:`comparison`,l=e.at.x-n.at.x,u=e.at.y-n.at.y,d=Math.hypot(l,u)||1,f=d*t.scale,p=(f+(r.map(e=>e.radius*t.scale).filter(e=>e>f+1).sort((e,t)=>e-t)[0]??f*1.35))/2,m=a+l/d*p,h=o-u/d*p;return(0,j.jsxs)(`g`,{"data-testid":`current-probe-${c}`,children:[(0,j.jsx)(`circle`,{className:L.currentProbeBody,"data-testid":`current-probe-dot-${c}`,cx:i,cy:s,r:4}),(0,j.jsx)(`circle`,{className:L.currentProbeDot,cx:i,cy:s,r:1.6}),(0,j.jsx)(P,{x:m,y:h+4,anchor:`middle`,symbol:e.readingText,className:L.currentReading})]},e.id)}),(0,j.jsx)(he,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t}),e.dimensions.map(e=>(0,j.jsx)(F,{dimension:e,projection:t},e.id))]})}if((n===`solenoid`||n===`electromagnet`)&&e.currentCoil!==void 0){let n=e.currentCoil,r=e.currentCore,i=e.currentFieldLines??[],a=t.px(n.at),o=t.py(n.at),s=n.halfLength*t.scale,c=n.radius*t.scale,l=2*s/Math.max(n.loopCount,1),u=Array.from({length:n.loopCount},(e,t)=>t);return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`defs`,{children:(0,j.jsx)(N,{uid:t.uid})}),r===void 0?null:(()=>{let e=r.halfLength*t.scale,n=r.armatureHalfWidth*t.scale,i=r.armatureHalfHeight*t.scale,s=a+r.northPole*(e+n),l=-r.northPole,u=ot({x:s+l*n*.5,y:o},{x:l,y:0},10),d=s+r.northPole*(n+8);return(0,j.jsxs)(`g`,{"data-testid":`current-core`,children:[(0,j.jsx)(`rect`,{className:L.currentCoreBar,x:a-e,y:o-r.halfHeight*t.scale,width:2*e,height:2*r.halfHeight*t.scale,rx:1.5}),(0,j.jsx)(P,{x:a-e-8,y:o-c-9,anchor:`end`,symbol:r.coreText,className:L.currentReading}),(0,j.jsx)(`rect`,{className:L.currentArmature,"data-testid":`current-armature`,x:s-n,y:o-i,width:2*n,height:2*i,rx:1.2}),(0,j.jsx)(`path`,{className:L.currentFieldArrowHalo,d:u}),(0,j.jsx)(`path`,{className:L.currentFieldArrow,d:u}),(0,j.jsx)(P,{x:d,y:o-6,anchor:r.northPole===1?`start`:`end`,symbol:r.pullText,className:L.currentReading}),(0,j.jsx)(P,{x:d,y:o+14,anchor:r.northPole===1?`start`:`end`,symbol:r.heldMassText,className:L.currentReading})]})})(),i.map(e=>{let n=e.points.map(e=>`${t.px(e)},${t.py(e)}`).join(` `);return(0,j.jsxs)(`g`,{"data-testid":`current-field-line-${e.probe?`axis`:`loop`}`,children:[(0,j.jsx)(`polyline`,{className:L.currentFieldLineHalo,points:n}),(0,j.jsx)(`polyline`,{className:e.probe?L.currentAxisLine:L.currentFieldLine,points:n})]},e.id)}),(0,j.jsx)(`g`,{"data-testid":`current-coil`,children:u.map(e=>(0,j.jsx)(`ellipse`,{className:L.currentCoilLoop,cx:a-s+l*(e+.5),cy:o,rx:l*.44,ry:c},e))}),[1,-1].map(e=>(0,j.jsx)(`text`,{className:L.currentPoleLabel,"data-testid":`current-pole-${n.northPole===e?`north`:`south`}`,x:a+e*(s+3.4*t.scale),y:o+5,textAnchor:`middle`,children:n.northPole===e?`N`:`S`},e)),(0,j.jsx)(P,{x:a-s,y:o-c-9,anchor:`start`,symbol:n.currentText,className:L.currentReading}),(0,j.jsx)(P,{x:a+s*.45,y:o-c-9,anchor:`middle`,symbol:n.fieldText,className:L.currentReading}),(0,j.jsx)(P,{x:a-s,y:o+c+17,anchor:`start`,symbol:n.turnsText,className:L.currentReading}),n.comparisonTurnsText===void 0?null:(0,j.jsx)(P,{x:a+s,y:o+c+17,anchor:`end`,symbol:n.comparisonTurnsText,className:L.currentReading}),i.flatMap(e=>{let n=e.points.map(e=>({x:t.px(e),y:t.py(e)}));return(e.arrowAt??[]).flatMap((t,r)=>{let i=at(n,t);if(i===void 0)return[];let a=ot(i.at,i.direction,10);return[(0,j.jsx)(`path`,{className:L.currentFieldArrowHalo,d:a},`${e.id}-halo-${r}`),(0,j.jsx)(`path`,{className:L.currentFieldArrow,d:a},`${e.id}-arrow-${r}`)]})}),(0,j.jsx)(he,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t}),e.dimensions.map(e=>(0,j.jsx)(F,{dimension:e,projection:t},e.id))]})}if(n===`motor`&&e.currentRotor!==void 0){let n=e.currentRotor,r=t.px(n.at),i=t.py(n.at),a=n.sides.map(e=>({x:t.px(e),y:t.py(e)})),o=(n.halfWidth+3.4)*t.scale,s=35*Math.PI/180,c=n.sense===1?-s:s,l=-c,u=e=>({x:r+o*Math.cos(e),y:i-o*Math.sin(e)}),d=u(c),f=u(l),p=`M${d.x} ${d.y} A${o} ${o} 0 0 ${n.sense===1?0:1} ${f.x} ${f.y}`,m=ot(f,it(l,n.sense),10);return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`defs`,{children:(0,j.jsx)(N,{uid:t.uid})}),(0,j.jsxs)(`g`,{"data-testid":`current-rotor`,children:[(0,j.jsx)(`line`,{className:L.motorCoil,x1:a[0]?.x??r,y1:a[0]?.y??i,x2:a[1]?.x??r,y2:a[1]?.y??i}),a.map((e,t)=>(0,j.jsx)(`circle`,{className:L.motorSide,"data-testid":`motor-side-${t+1}`,cx:e.x,cy:e.y,r:4.6},t)),(0,j.jsx)(`circle`,{className:L.motorAxis,cx:r,cy:i,r:3.4})]}),(0,j.jsx)(`path`,{className:L.motorSpin,"data-testid":`motor-spin`,d:p}),(0,j.jsx)(`path`,{className:L.motorSpinHalo,d:m}),(0,j.jsx)(`path`,{className:L.motorSpinArrow,d:m}),(0,j.jsx)(P,{x:r-o-16,y:i-10,anchor:`end`,symbol:`${n.torqueText} · ${n.angleText}`,className:L.currentReading}),(0,j.jsx)(P,{x:r-o-16,y:i+18,anchor:`end`,symbol:n.currentText,className:L.currentReading}),(0,j.jsx)(P,{x:r-o-16,y:i+35,anchor:`end`,symbol:n.turnsText,className:L.currentReading}),(0,j.jsx)(he,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t}),e.dimensions.map(e=>(0,j.jsx)(F,{dimension:e,projection:t},e.id))]})}return null}const lt={potential:L.energySegmentPotential,kinetic:L.energySegmentKinetic,thermal:L.energySegmentThermal};function ut({view:e,projection:t}){let n=e.energyRamp,r=e.energyBar;if(n===void 0)return null;let i=t.px(n.base),a=t.py(n.base),o=t.px(n.peak),s=t.py(n.peak),c=Math.atan2(n.peak.y-n.base.y,n.peak.x-n.base.x),l=Math.hypot(n.peak.x-n.base.x,n.peak.y-n.base.y),u=Math.cos(c),d=Math.sin(c),f=Math.min(n.cartLength,l),p=n.cartHalfHeight*f/n.cartLength,m=f*t.scale,h=p*t.scale,g=e.bodies.find(e=>e.id===`energy-cart`)?.at??n.peak,_=Math.min(l-f/2,Math.max(f/2,(g.x-n.base.x)*u+(g.y-n.base.y)*d)),v={x:n.base.x+u*_-d*p,y:n.base.y+d*_+u*p},y={x:t.px(v),y:t.py(v)},b=-c*180/Math.PI;return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`path`,{className:L.energyRampBody,"data-testid":`energy-ramp`,d:`M${i} ${a} L${o} ${s} L${o} ${a} Z`}),(0,j.jsx)(`line`,{className:L.energyRampSurface,x1:i,y1:a,x2:o,y2:s}),(0,j.jsx)(`rect`,{className:L.energyCart,"data-testid":`energy-cart`,x:y.x-m/2,y:y.y-h,width:m,height:h*2,rx:1.4,transform:`rotate(${b} ${y.x} ${y.y})`}),(0,j.jsx)(P,{x:o+8,y:s+4,anchor:`start`,symbol:n.potentialText,className:L.currentReading}),(0,j.jsx)(P,{x:i-8,y:a+4,anchor:`end`,symbol:`${n.kineticText} · ${n.speedText}`,className:L.currentReading}),r===void 0?null:(()=>{let e=t.px(r.at),n=t.py(r.at),i=r.width*t.scale,a=r.height*t.scale,o=e,s=r.segments.map(e=>{let t=i*e.fraction,r=(0,j.jsx)(`rect`,{className:lt[e.role],"data-testid":`energy-segment-${e.id}`,x:o,y:n-a,width:t,height:a},e.id);return o+=t,r});return(0,j.jsxs)(`g`,{"data-testid":`energy-bar`,children:[(0,j.jsx)(`rect`,{className:L.energyBarFrame,x:e,y:n-a,width:i,height:a,rx:1.2}),s,(0,j.jsx)(P,{x:e+i/2,y:n+22,anchor:`middle`,symbol:r.totalText,className:L.currentReading}),r.segments.map((t,r)=>(0,j.jsx)(P,{x:r===0?e:e+i,y:n+40,anchor:r===0?`start`:`end`,symbol:t.text,className:L.currentReading},t.id))]})})(),e.dimensions.map(e=>(0,j.jsx)(F,{dimension:e,projection:t},e.id)),(0,j.jsx)(`title`,{children:n.label??`斜面`})]})}function dt({view:e,projection:t}){let n=e.lightRefraction;if(n!==void 0)return(0,j.jsx)(ft,{refraction:n,projection:t});let r=e.lightRig;if(r===void 0)return null;let i=t.px(r.at),a=t.py(r.at),o=t.px(r.objectAt),s=t.px(r.screenAt),c=r.cardHalfHeight*t.scale,l=r.screenHalfHeight*t.scale,u=t.py({x:r.objectAt.x,y:r.objectHalfHeight}),d=t.py({x:r.objectAt.x,y:-r.objectHalfHeight}),f=t.py(r.imageTo),p=t.py(r.imageFrom);return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`defs`,{children:(0,j.jsx)(N,{uid:t.uid})}),(0,j.jsx)(`path`,{className:L.holeCard,"data-testid":`light-card`,d:`M${i} ${a-c} V${a-3} M${i} ${a+3} V${a+c}`}),r.rays.map(e=>(0,j.jsx)(`polyline`,{className:L.lightRay,"data-testid":`light-${e.id}`,points:e.points.map(e=>`${t.px(e)},${t.py(e)}`).join(` `)},e.id)),(0,j.jsx)(`path`,{className:L.lightObject,"data-testid":`light-object`,d:`M${o} ${d} V${u}`}),(0,j.jsx)(`path`,{className:L.lightImage,"data-testid":`light-image`,d:`M${s} ${f} V${p}`}),(0,j.jsx)(`path`,{className:L.lightScreen,"data-testid":`light-screen`,d:`M${s+3} ${a-l} V${a+l}`}),(0,j.jsx)(P,{x:s+10,y:a+4,anchor:`start`,symbol:r.imageText,className:L.currentReading}),(0,j.jsx)(P,{x:o-6,y:a+4,anchor:`end`,symbol:r.magnificationText,className:L.currentReading}),e.dimensions.map(e=>(0,j.jsx)(F,{dimension:e,projection:t},e.id))]})}function ft({refraction:e,projection:t}){let n={x:t.px(e.at),y:t.py(e.at)},r=(e,n)=>`M${t.px(e)} ${t.py(e)} L${t.px(n)} ${t.py(n)}`;return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`defs`,{children:(0,j.jsx)(N,{uid:t.uid})}),(0,j.jsx)(`path`,{className:L.lightBoundary,"data-testid":`light-boundary`,d:r(e.boundaryFrom,e.boundaryTo)}),(0,j.jsx)(`path`,{className:L.lightNormal,"data-testid":`light-normal`,d:r(e.normalFrom,e.normalTo)}),e.criticalTo===void 0?null:(0,j.jsx)(`path`,{className:L.lightCriticalRay,"data-testid":`light-critical`,d:r(e.at,e.criticalTo)}),(0,j.jsx)(`path`,{className:L.lightRay,"data-testid":`light-incident`,d:r(e.incidentFrom,e.at)}),(0,j.jsx)(`path`,{className:L.lightImage,"data-testid":`light-reflected`,d:r(e.at,e.reflectedTo)}),e.refractedTo===void 0?null:(0,j.jsx)(`path`,{className:L.lightRefractedRay,"data-testid":`light-refracted`,d:r(e.at,e.refractedTo)}),(0,j.jsx)(P,{x:n.x+10,y:n.y-10,anchor:`start`,symbol:e.incidentText,className:L.currentReading}),(0,j.jsx)(P,{x:n.x+10,y:n.y+8,anchor:`start`,symbol:e.criticalText,className:L.currentReading}),(0,j.jsx)(P,{x:n.x+10,y:n.y+26,anchor:`start`,symbol:e.refractedText,className:L.currentReading})]})}function pt({view:e,projection:t}){let n=e.transformerCoils??[],r=e.transformerCore;if(r===void 0||n.length===0)return null;let i=t.py(r.from),a=r.halfHeight*t.scale;return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`rect`,{className:L.transformerCore,"data-testid":`transformer-core`,x:t.px(r.from),y:i-a,width:t.px(r.to)-t.px(r.from),height:2*a,rx:1}),n.map(e=>{let n=t.px(e.at),r=t.py(e.at),i=e.halfWidth*t.scale,a=e.halfHeight*t.scale,o=2*i/e.turnsLoops,s=Array.from({length:e.turnsLoops},(e,t)=>t),c=e.primary?L.transformerPrimaryLoop:L.transformerSecondaryLoop;return(0,j.jsxs)(`g`,{"data-testid":`transformer-${e.primary?`primary`:`secondary`}`,children:[s.map(e=>(0,j.jsx)(`ellipse`,{className:c,cx:n-i+o*(e+.5),cy:r,rx:o*.34,ry:a},e)),(0,j.jsx)(P,{x:n-i,y:r-a-24,anchor:`start`,symbol:e.voltageText,className:L.currentReading}),(0,j.jsx)(P,{x:n-i,y:r-a-6,anchor:`start`,symbol:e.turnsText,className:L.currentReading}),(0,j.jsx)(P,{x:n-i,y:r+a+14,anchor:`start`,symbol:e.currentText,className:L.currentReading})]},e.id)}),(0,j.jsx)(P,{x:t.px({x:0,y:0}),y:i-4,anchor:`middle`,symbol:r.ratioText,className:L.currentReading}),(0,j.jsx)(P,{x:t.px({x:0,y:0}),y:i+16,anchor:`middle`,symbol:r.powerText,className:L.currentReading})]})}const mt=(e,t,n,r,i)=>{let a=e-n*i,o=t-r*i,s=-r*i*.46,c=n*i*.46;return`M${e} ${t} L${a+s} ${o+c} L${a-s} ${o-c} Z`},ht=(e,t,n)=>{let r=e[0]??{x:0,y:0},i=0;for(let r=0;r<t.length;r+=1){let a=t[r]??0,o=e[r],s=e[r+1];if(o===void 0||s===void 0)break;if(n<=i+a||r===t.length-1){let e=a<=0?0:Math.min(1,Math.max(0,(n-i)/a));return{x:o.x+(s.x-o.x)*e,y:o.y+(s.y-o.y)*e}}i+=a}return r};function gt({view:e,projection:t,time:n}){let r=e.inductionField,i=e.inductionBar,a=e.inductionCoil,o=e.inductionCurrent,s=e.inductionRails,c=e.inductionPairBars,l=e.inductionForceArrows;if(r===void 0)return(0,j.jsx)(j.Fragment,{});let u=t.px(r.origin),d=t.py({x:r.origin.x,y:r.origin.y+r.size.height}),f=t.px({x:r.origin.x+r.size.width,y:r.origin.y})-u,p=Math.abs(d-t.py(r.origin)),m=Math.min(d,t.py(r.origin)),h=[],g=Math.max(3,Math.floor(f/46)),_=Math.max(2,Math.floor(p/46));for(let e=0;e<g;e+=1)for(let t=0;t<_;t+=1)h.push({x:u+(e+.5)*f/g,y:m+(t+.5)*p/_});let v=3.2;return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsxs)(`g`,{className:t.highlighted(r.id)?L.highlightGroup:void 0,children:[(0,j.jsx)(`rect`,{className:L.inductionFieldBox,x:u,y:m,width:f,height:p}),h.map((e,t)=>(0,j.jsxs)(`g`,{className:L.inductionFieldMark,children:[(0,j.jsx)(`line`,{x1:e.x-v,y1:e.y-v,x2:e.x+v,y2:e.y+v}),(0,j.jsx)(`line`,{x1:e.x-v,y1:e.y+v,x2:e.x+v,y2:e.y-v})]},t))]}),s===void 0?null:s.map(e=>{let n={x:t.px(e.from),y:t.py(e.from)},r={x:t.px(e.to),y:t.py(e.to)};return(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`line`,{className:L.inductionRailEdge,x1:n.x,y1:n.y-1.4,x2:r.x,y2:r.y-1.4}),(0,j.jsx)(`line`,{className:L.inductionRail,x1:n.x,y1:n.y,x2:r.x,y2:r.y})]},e.id)}),e.inductionResistor===void 0?null:(()=>{let n=e.inductionResistor,r=t.px(n.at),i=t.py({x:0,y:n.at.y+n.span/2}),a=t.py({x:0,y:n.at.y-n.span/2}),o=(i+a)/2,s=(a-i)*.28,c=Array.from({length:6},(e,t)=>`L${r+(t%2==0?4.5:-4.5)} ${i+s+(t+.5)/6*(a-i-s*2)}`).join(` `);return(0,j.jsxs)(`g`,{className:t.highlighted(n.id)?L.highlightGroup:void 0,children:[(0,j.jsx)(`path`,{className:L.inductionResistor,d:`M${r} ${i} L${r} ${i+s} ${c} L${r} ${a}`}),(0,j.jsx)(`text`,{className:L.inductionResistorLabel,x:r-8,y:o+4,textAnchor:`end`,children:n.label})]})})(),i!==void 0&&e.visible.barMotion===!0?(()=>{let e=t.px(i.at),n=t.py({x:0,y:i.at.y+i.length/2}),r=t.py({x:0,y:i.at.y-i.length/2}),a={x:e+6,y:n-12},o={x:e+6+i.direction*34,y:n-12},s=i.direction;return(0,j.jsxs)(`g`,{className:t.highlighted(i.id)?L.highlightGroup:void 0,children:[(0,j.jsx)(`line`,{className:L.inductionRodBed,x1:e,y1:n,x2:e,y2:r}),(0,j.jsx)(`line`,{className:L.inductionRod,x1:e,y1:n,x2:e,y2:r}),(0,j.jsx)(`circle`,{className:L.inductionRodContact,cx:e,cy:n,r:3.2}),(0,j.jsx)(`circle`,{className:L.inductionRodContact,cx:e,cy:r,r:3.2}),(0,j.jsx)(`line`,{className:L.inductionVelocity,x1:a.x,y1:a.y,x2:o.x,y2:o.y}),(0,j.jsx)(`path`,{className:L.inductionVelocityHead,d:mt(o.x,o.y,s,0,7)}),(0,j.jsx)(`text`,{className:L.inductionVelocityLabel,x:(a.x+o.x)/2,y:a.y-5,textAnchor:`middle`,children:`v`}),(0,j.jsx)(`text`,{className:L.annotation,x:e+10,y:n-26,children:i.label})]})})():null,a===void 0?null:(()=>{let e=t.px(a.at),n=t.py(a.at),r=Math.max(4,a.diameter*t.scale/2),i=[0,1,2,3].map(t=>{let i=e-r+t/4*2*r,a=e-r+(t+.25)/4*2*r,o=n-r*.5+(t%2==0?0:r*.18);return`M${i} ${o} A${r*.3} ${r*.42} 0 0 1 ${a} ${o-r*.28}`}).join(` `);return(0,j.jsxs)(`g`,{className:t.highlighted(a.id)?L.highlightGroup:void 0,children:[(0,j.jsx)(`path`,{className:L.inductionCoil,d:i}),(0,j.jsx)(`ellipse`,{className:L.inductionCoil,cx:e,cy:n,rx:r,ry:r*.34,opacity:.55}),(0,j.jsx)(`text`,{className:L.annotation,x:e+r+8,y:n-r*.5,children:a.label})]})})(),c===void 0?null:(0,j.jsx)(j.Fragment,{children:c.map(e=>{let n=t.px(e.at),r=t.py({x:0,y:e.at.y+e.length/2}),i=t.py({x:0,y:e.at.y-e.length/2});return(0,j.jsxs)(`g`,{className:t.highlighted(e.id)?L.highlightGroup:void 0,children:[(0,j.jsx)(`line`,{className:L.inductionRod,x1:n,y1:r,x2:n,y2:i}),(0,j.jsx)(`text`,{className:L.annotation,x:n+10,y:r-4,children:e.label})]},e.id)})}),l===void 0?null:l.map(e=>{let n={x:t.px(e.at),y:t.py(e.at)},r={x:t.px({x:e.at.x+e.direction*e.length,y:e.at.y}),y:t.py(e.at)},i=r.x-n.x,a=r.y-n.y,o=Math.hypot(i,a),s=o===0?e.direction:i/o,c=o===0?0:a/o,l=e.at.y>0;return(0,j.jsxs)(`g`,{className:t.highlighted(e.id)?L.highlightGroup:void 0,children:[(0,j.jsx)(`line`,{className:L.inductionForceArrow,x1:n.x,y1:n.y,x2:r.x,y2:r.y}),(0,j.jsx)(`path`,{className:L.inductionForceHead,d:mt(r.x,r.y,s,c,7)}),(0,j.jsx)(`text`,{className:L.inductionForceLabel,x:(n.x+r.x)/2,y:l?n.y-7:n.y+15,textAnchor:`middle`,children:e.label})]},e.id)}),o!==void 0&&e.visible.inductionCurrent===!0?(()=>{let e={x:t.px(o.from),y:t.py(o.from)},n={x:t.px(o.to),y:t.py(o.to)},r=o.sign>=0?n:e,i=o.sign>=0?e:n,a=r.x-i.x,s=r.y-i.y,c=Math.hypot(a,s),l=c===0?1:a/c,u=c===0?0:s/c;return(0,j.jsxs)(`g`,{className:t.highlighted(o.id)?L.highlightGroup:void 0,children:[(0,j.jsx)(`line`,{className:I(L.inductionCurrentArrow,o.sign===0&&L.inductionFieldBox),x1:i.x,y1:i.y,x2:r.x,y2:r.y}),o.sign===0?null:(0,j.jsx)(`path`,{className:L.inductionCurrentHead,d:mt(r.x,r.y,l,u,8)}),(0,j.jsx)(`text`,{className:L.inductionCurrentLabel,x:(i.x+r.x)/2,y:i.y+14,textAnchor:`middle`,children:`I = E/R`})]})})():null,e.visible.inductionCurrent===!0?(e.chargeFlows??[]).map(e=>{let r=e.path.map(e=>({x:t.px(e),y:t.py(e)})),i=[],a=0;for(let e=1;e<r.length;e+=1){let t=r[e-1],n=r[e];if(t===void 0||n===void 0)continue;let o=Math.hypot(n.x-t.x,n.y-t.y);i.push(o),a+=o}if(r.length<2||a<=0)return null;let o=Math.max(2,Math.round(a/22)),s=a/o,c=Math.min(110,Math.max(10,Math.abs(e.current)*1e3)),l=e.current===0?0:Math.sign(e.current)*c*(n??0);return(0,j.jsx)(`g`,{"data-charge-flow":e.id,"aria-hidden":`true`,children:Array.from({length:o},(e,t)=>{let n=ht(r,i,((t*s+l)%a+a)%a);return(0,j.jsx)(`circle`,{className:L.inductionChargeDot,cx:n.x,cy:n.y,r:2.6},t)})},e.id)}):null]})}const z=(e,t,n,r,i)=>{let a=e-n*i,o=t-r*i,s=-r*i*.46,c=n*i*.46;return`M${e} ${t} L${a+s} ${o+c} L${a-s} ${o-c} Z`},_t=(e,t,n)=>{let r=n.px(e),i=n.py(e),a=n.px(t),o=n.py(t),s=a-r,c=o-i,l=Math.hypot(s,c);if(l<14)return null;let u=s/l,d=c/l;return z((r+a)/2,(i+o)/2,u,d,Math.min(7,Math.max(3.4,l*.16)))},vt=({x:e,footY:t,topY:n,lineClass:r,headClass:i})=>{let a=n<t;return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`line`,{className:r,x1:e,y1:t,x2:e,y2:n+(a?8:-8)}),(0,j.jsx)(`path`,{className:i,d:z(e,n,0,a?-1:1,9)})]})};function yt({view:e,projection:t}){let n=t.py({x:0,y:0}),r=t.px({x:e.origin.x,y:0}),i=t.px({x:e.origin.x+e.extent.width,y:0}),a=e.visible.rays===!0,o=e.visible.image===!0;return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`line`,{className:L.opticalAxis,x1:r,y1:n,x2:i,y2:n}),(e.opticalAxisMarks??[]).map(e=>{let r=t.px(e.at);return(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`line`,{className:L.focalTick,x1:r,y1:n-5,x2:r,y2:n+5}),(0,j.jsx)(`text`,{className:L.focalLabel,x:r,y:n+18,textAnchor:`middle`,children:e.label})]},e.id)}),a?(e.opticalRays??[]).map(e=>e.extension===void 0?null:(0,j.jsx)(`path`,{className:L.opticalRayExtension,d:t.path(e.extension)},`${e.id}-extension`)):null,a?(e.opticalRays??[]).map(e=>{let n=[],r=e.points[0],i=e.points[1],a=e.points[2];if(r!==void 0&&i!==void 0){let e=_t(r,i,t);e!==null&&n.push(e)}if(i!==void 0&&a!==void 0){let e=_t(i,a,t);e!==null&&n.push(e)}return(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`path`,{className:L.opticalRay,d:t.path(e.points)}),n.map((e,t)=>(0,j.jsx)(`path`,{className:L.opticalRayHead,d:e},t))]},e.id)}):null,(e.opticalElements??[]).map(e=>{let n=t.px(e.at),r=t.py({x:0,y:e.at.y+e.halfAperture}),i=t.py({x:0,y:e.at.y-e.halfAperture}),a=t.highlighted(e.id);if(e.kind===`thin_lens`)return(0,j.jsxs)(`g`,{className:a?L.highlightGroup:void 0,children:[(0,j.jsx)(`ellipse`,{className:L.lensBody,cx:n,cy:(r+i)/2,rx:Math.max(5,(i-r)*.09),ry:(i-r)/2}),(0,j.jsx)(`line`,{className:L.lensAxisLine,x1:n,y1:r+2,x2:n,y2:i-2}),(0,j.jsx)(`path`,{className:L.lensHead,d:z(n,r,0,-1,8)}),(0,j.jsx)(`path`,{className:L.lensHead,d:z(n,i,0,1,8)}),e.label===void 0?null:(0,j.jsx)(`text`,{className:L.annotation,x:n,y:r-8,textAnchor:`middle`,children:e.label})]},e.id);let o=Math.max(4,Math.floor((i-r)/12));if(e.kind===`curved_mirror`){let t=Math.min(20,Math.max(7,(i-r)*.14)),s=e.curvature===`convex`?t:-t,c=`M${n+s} ${r} Q${n-s} ${(r+i)/2} ${n+s} ${i}`;return(0,j.jsxs)(`g`,{className:a?L.highlightGroup:void 0,children:[(0,j.jsx)(`path`,{className:L.curvedMirrorPlate,d:c}),Array.from({length:o},(e,t)=>{let a=(t+.5)/o,c=r+a*(i-r),l=n+s*(1-2*a)*(1-2*a);return(0,j.jsx)(`line`,{className:L.mirrorHatch,x1:l+1.5,y1:c+4,x2:l+8,y2:c-4},t)}),e.label===void 0?null:(0,j.jsx)(`text`,{className:L.annotation,x:n,y:r-8,textAnchor:`middle`,children:e.label})]},e.id)}return(0,j.jsxs)(`g`,{className:a?L.highlightGroup:void 0,children:[(0,j.jsx)(`line`,{className:L.mirrorPlate,x1:n,y1:r,x2:n,y2:i}),Array.from({length:o},(e,t)=>{let a=r+(t+.5)/o*(i-r);return(0,j.jsx)(`line`,{className:L.mirrorHatch,x1:n+1.5,y1:a+4,x2:n+8,y2:a-4},t)}),e.label===void 0?null:(0,j.jsx)(`text`,{className:L.annotation,x:n,y:r-8,textAnchor:`middle`,children:e.label})]},e.id)}),(e.opticalScreens??[]).map(e=>{let r=t.px(e.at),i=t.py({x:0,y:e.at.y+e.halfHeight}),a=t.py({x:0,y:e.at.y-e.halfHeight});return(0,j.jsxs)(`g`,{className:t.highlighted(e.id)?L.highlightGroup:void 0,children:[e.lit?(0,j.jsx)(`line`,{className:L.screenGlow,x1:r,y1:i,x2:r,y2:a}):null,(0,j.jsx)(`line`,{className:I(L.screenPlate,e.lit&&L.screenPlateLit),x1:r,y1:i,x2:r,y2:a}),(0,j.jsx)(`line`,{className:L.screenFoot,x1:r-9,y1:n+1,x2:r+9,y2:n+1}),e.label===void 0?null:(0,j.jsx)(`text`,{className:L.annotation,x:r,y:i-8,textAnchor:`middle`,children:e.label})]},e.id)}),(e.opticalObjects??[]).map(e=>{let n=t.px(e.at),r=t.py(e.at),i=t.py({x:0,y:e.at.y+e.height});return(0,j.jsxs)(`g`,{className:t.highlighted(e.id)?L.highlightGroup:void 0,children:[(0,j.jsx)(vt,{x:n,footY:r,topY:i,lineClass:L.opticalObjectLine,headClass:L.opticalObjectHead}),e.label===void 0?null:(0,j.jsx)(`text`,{className:L.annotation,x:n,y:r+18,textAnchor:`middle`,children:e.label})]},e.id)}),o?(e.opticalImages??[]).map(e=>{let n=t.px(e.at),r=t.py(e.at),i=t.py({x:0,y:e.at.y+e.height}),a=e.height<0;return(0,j.jsxs)(`g`,{className:t.highlighted(e.id)?L.highlightGroup:void 0,children:[(0,j.jsx)(vt,{x:n,footY:r,topY:i,lineClass:I(L.opticalImageLine,e.nature===`virtual`&&L.opticalImageVirtual),headClass:L.opticalImageHead}),e.label===void 0?null:(0,j.jsx)(`text`,{className:I(L.annotation,L.opticalImageLabel),x:n,y:a?r-8:r+18,textAnchor:`middle`,children:e.label})]},e.id)}):null]})}const bt=({x:e,y:t,halfWidth:n,time:r})=>(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`rect`,{className:L.thermalHeaterBody,x:e-n,y:t,width:n*2,height:n*.42,rx:n*.16}),[-.5,0,.5].map((i,a)=>{let o=(r??0)*7.1+a*2.3,s=Math.sin(o)*.8,c=Math.sin(o*1.31+1.1)*2.6;return(0,j.jsx)(`g`,{"data-testid":`thermal-flame`,transform:`translate(${(e+i*n+s).toFixed(2)} ${t.toFixed(2)})`,children:(0,j.jsx)(`path`,{className:L.thermalFlame,transform:`skewX(${c.toFixed(2)})`,d:[`M0 0`,`q${n*.2} ${-n*.34} 0 ${-n*.62}`,`q${-n*.2} ${n*.28} 0 ${n*.62}`,`z`].join(` `)})},i)})]}),xt=({sample:e,projection:t})=>{let n=t.px({x:e.at.x-e.halfWidth,y:0}),r=t.px({x:e.at.x+e.halfWidth,y:0}),i=t.py({x:0,y:e.at.y+e.halfHeight}),a=t.py({x:0,y:e.at.y-e.halfHeight}),o=Math.min(9,(a-i)*.12),s=e.meltedFraction<=0?null:t.py({x:0,y:e.at.y-e.halfHeight+2*e.halfHeight*e.meltedFraction});return(0,j.jsxs)(`g`,{className:t.highlighted(e.id)?L.highlightGroup:void 0,children:[(0,j.jsx)(`rect`,{className:L.thermalSampleSolid,x:n,y:i,width:r-n,height:a-i}),s===null?null:(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`rect`,{className:I(L.thermalSampleLiquid,(e.phase===`melting`||e.phase===`boiling`)&&L.thermalSampleMelting),x:n,y:s,width:r-n,height:a-s}),(0,j.jsx)(`line`,{className:L.thermalSurface,x1:n,y1:s,x2:r,y2:s})]}),(0,j.jsx)(`path`,{className:L.thermalBeakerWall,d:[`M${n-5} ${i-5}`,`L${n} ${i}`,`V${a-o}`,`Q${n} ${a} ${n+o} ${a}`,`H${r-o}`,`Q${r} ${a} ${r} ${a-o}`,`V${i}`,`L${r+5} ${i-5}`].join(` `)}),e.label===void 0?null:(0,j.jsx)(`text`,{className:L.annotation,x:t.px(e.at),y:i-9,textAnchor:`middle`,children:e.label})]})},St=({thermometer:e,projection:t})=>{let n=t.px(e.at),r=t.py(e.at),i=t.py({x:0,y:e.at.y+15}),a=t.py({x:0,y:e.at.y+e.columnHeight});return(0,j.jsxs)(`g`,{className:t.highlighted(e.id)?L.highlightGroup:void 0,children:[(0,j.jsx)(`rect`,{className:L.thermalTubeOuter,x:n-9/2,y:i,width:9,height:r-i,rx:9/2}),(0,j.jsx)(`line`,{className:L.thermalColumn,x1:n,y1:r,x2:n,y2:a}),(0,j.jsx)(`circle`,{className:L.thermalBulb,cx:n,cy:r,r:7}),[.2,.4,.6,.8].map(e=>(0,j.jsx)(`line`,{className:L.thermalTick,x1:n+9/2,y1:r-e*(r-i),x2:n+9/2+4,y2:r-e*(r-i)},e)),(0,j.jsx)(`text`,{className:L.thermalReading,x:n+9/2+8,y:a+4,children:e.reading})]})},Ct=({heater:e,projection:t,time:n})=>(0,j.jsxs)(`g`,{className:t.highlighted(e.id)?L.highlightGroup:void 0,children:[(0,j.jsx)(bt,{x:t.px(e.at),y:t.py(e.at),halfWidth:e.halfWidth*t.scale,time:n}),(0,j.jsx)(`text`,{className:L.annotation,x:t.px(e.at),y:t.py(e.at)+e.halfWidth*t.scale*.42+16,textAnchor:`middle`,children:e.label===void 0?e.power:`${e.label} ${e.power}`})]});function wt({view:e,projection:t,time:n}){let r=e.visible.thermometer===!0,i=e.visible.phase===!0,a=e.thermalSample,o=e.thermalThermometer,s=e.thermalHeater,c=e.thermalComparisonSample,l=e.thermalComparisonThermometer,u=e.thermalComparisonHeater;return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`defs`,{children:(0,j.jsx)(N,{uid:t.uid})}),i?e.guides.map(e=>(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`line`,{className:L.thermalMeltingLine,x1:t.px(e.from),y1:t.py(e.from),x2:t.px(e.to),y2:t.py(e.to)}),e.label===void 0?null:(0,j.jsx)(`text`,{className:L.thermalMeltingLabel,x:t.px(e.to),y:t.py(e.to)-6,textAnchor:`end`,children:e.label})]},e.id)):null,s===void 0?null:(0,j.jsx)(Ct,{heater:s,projection:t,time:n}),u===void 0?null:(0,j.jsx)(Ct,{heater:u,projection:t,time:n}),a===void 0?null:(0,j.jsx)(xt,{sample:a,projection:t}),c===void 0?null:(0,j.jsx)(xt,{sample:c,projection:t}),o===void 0||!r?null:(0,j.jsx)(St,{thermometer:o,projection:t}),l===void 0||!r?null:(0,j.jsx)(St,{thermometer:l,projection:t})]})}const Tt=.8;function Et({view:e,projection:t}){let n=e.thermometer;if(n===void 0)return null;let r=t.px(n.at),i=t.py(n.at),a=n.halfWidth*t.scale,o=n.bulbRadius*t.scale,s=i+o*.7,c=t.py({x:n.at.x,y:n.steamPoint+1.2}),l=t.py({x:n.at.x,y:n.columnTop}),u=t.py({x:n.at.x,y:n.icePoint}),d=t.py({x:n.at.x,y:n.steamPoint}),f=a*1.9;return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`defs`,{children:(0,j.jsx)(N,{uid:t.uid})}),(0,j.jsx)(`rect`,{className:L.thermometerColumn,"data-testid":`thermometer-column`,x:r-a,y:l,width:a*2,height:i-l}),(0,j.jsx)(`circle`,{className:L.thermometerColumn,cx:r,cy:s,r:o}),(0,j.jsx)(`circle`,{className:L.thermometerGlass,cx:r,cy:s,r:o}),(0,j.jsx)(`path`,{className:L.thermometerGlass,"data-testid":`thermometer-tube`,d:`M${r-a} ${i} V${c+a} A${a} ${a} 0 0 1 ${r+a} ${c+a} V${i}`}),[{id:`ice`,y:u,label:`0 °C`},{id:`steam`,y:d,label:`100 °C`}].map(e=>(0,j.jsxs)(`g`,{"data-testid":`thermometer-tick-${e.id}`,children:[(0,j.jsx)(`line`,{className:L.thermometerTick,x1:r+a,y1:e.y,x2:r+a+f,y2:e.y}),(0,j.jsx)(P,{x:r+a+f+4,y:e.y+4,anchor:`start`,symbol:e.label,className:L.thermometerTickLabel})]},e.id)),(0,j.jsx)(P,{x:r-a-6,y:l+4,anchor:`end`,symbol:n.temperatureText,className:L.currentReading}),(0,j.jsx)(P,{x:r-a-6,y:l+20,anchor:`end`,symbol:n.columnText,className:L.thermometerTickLabel}),(0,j.jsx)(`line`,{className:L.thermometerSpan,x1:r-a-Tt*t.scale,y1:u,x2:r-a-Tt*t.scale,y2:d}),(0,j.jsx)(P,{x:r-a-Tt*t.scale-4,y:(u+d)/2,anchor:`end`,symbol:n.scaleText,className:L.thermometerTickLabel})]})}const Dt=.11,Ot=.5;function kt({view:e,projection:t}){let n=e.noiseRig;if(n===void 0)return null;let r=t.px(n.sourceAt),i=t.py(n.sourceAt),a=t.px(n.listenerAt),o=t.py(n.listenerAt);return(0,j.jsxs)(j.Fragment,{children:[n.wavefronts.map((e,n)=>(0,j.jsx)(`circle`,{className:L.noiseWavefront,"data-testid":`noise-wavefront-${n}`,cx:r,cy:i,r:e*t.scale,opacity:.5-n*.9*0},e)),n.barrierAt===void 0?null:(0,j.jsx)(`g`,{"data-testid":`noise-barrier`,children:(0,j.jsx)(`line`,{className:L.noiseBarrier,x1:t.px(n.barrierAt),y1:i-Ot*t.scale,x2:t.px(n.barrierAt),y2:i+Ot*t.scale})}),(0,j.jsx)(`circle`,{className:L.noiseSource,cx:r,cy:i,r:.14*t.scale}),(0,j.jsx)(`circle`,{className:L.noiseListener,"data-testid":`noise-listener`,cx:a,cy:o,r:Dt*t.scale}),(0,j.jsx)(`line`,{className:L.noiseDistance,x1:r,y1:i+.62*t.scale,x2:a,y2:i+.62*t.scale}),(0,j.jsx)(P,{x:r,y:i-.32*t.scale,anchor:`start`,symbol:n.sourceText,className:L.currentReading}),(0,j.jsx)(P,{x:a+Dt*t.scale+5,y:o-4,anchor:`start`,symbol:n.levelText,className:L.currentReading}),(0,j.jsx)(P,{x:(r+a)/2,y:i+.62*t.scale+16,anchor:`middle`,symbol:n.distanceText,className:L.currentReading}),n.barrierAt===void 0?null:(0,j.jsx)(P,{x:t.px(n.barrierAt),y:i-Ot*t.scale-6,anchor:`middle`,symbol:n.barrierText,className:L.currentReading})]})}const At=({ax:e,ay:t,mx:n,my:r,size:i,massText:a,highlighted:o})=>{let s=i*1.7,c=i*1.25,l=i*.42;return(0,j.jsxs)(`g`,{className:o?L.highlightGroup:void 0,children:[(0,j.jsx)(`line`,{className:L.leverString,x1:e,y1:t,x2:n,y2:r-c/2-l*1.6}),(0,j.jsx)(`circle`,{className:L.leverMassHook,cx:n,cy:r-c/2-l*.55,r:l}),(0,j.jsx)(`rect`,{className:L.leverMass,x:n-s/2,y:r-c/2,width:s,height:c,rx:i*.22}),(0,j.jsx)(`line`,{className:L.leverMassSlot,x1:n-s/2+i*.18,y1:r,x2:n+s/2-i*.18,y2:r}),(0,j.jsx)(P,{x:n,y:r+c/2+13,anchor:`middle`,symbol:a,className:L.annotation})]})};function jt({view:e,projection:t}){let n=e.leverBeam,r=e.leverFulcrum,i=e.leverHangers??[];if(n===void 0||r===void 0)return null;let a=t.px(r.at),o=t.py(r.at),s=7*t.scale,c=t.px(n.from),l=t.py(n.from),u=t.px(n.to),d=t.py(n.to),f=Math.hypot(u-c,d-l)||1,p=(u-c)/f,m=-((d-l)/f),h=p,g=Math.max(2.4,f*.012),_=[`M${c+m*g} ${l+h*g}`,`L${u+m*g} ${d+h*g}`,`L${u-m*g} ${d-h*g}`,`L${c-m*g} ${l-h*g}`,`Z`].join(` `),v=Math.floor(f/16),y=Array.from({length:Math.max(0,v-1)},(e,t)=>{let n=(t+1)/v,r=c+(u-c)*n,i=l+(d-l)*n;return{x1:r+m*g,y1:i+h*g,x2:r+m*g*.35,y2:i+h*g*.35}});return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`defs`,{children:(0,j.jsx)(N,{uid:t.uid})}),e.visible.arms===!0?e.dimensions.map(e=>(0,j.jsx)(F,{dimension:e,projection:t},e.id)):null,(0,j.jsxs)(`g`,{className:t.highlighted(r.id)?L.highlightGroup:void 0,children:[(0,j.jsx)(`polygon`,{className:L.leverFulcrum,points:`${a},${o} ${a-s},${o+s*1.4} ${a+s},${o+s*1.4}`}),(0,j.jsx)(`line`,{className:L.leverFulcrumStand,x1:a,y1:o+s*1.4,x2:a,y2:o+s*2.3}),(0,j.jsx)(`line`,{className:L.leverFulcrumBase,x1:a-s*1.7,y1:o+s*2.3,x2:a+s*1.7,y2:o+s*2.3})]}),(0,j.jsxs)(`g`,{className:t.highlighted(n.id)?L.highlightGroup:void 0,children:[(0,j.jsx)(`path`,{className:L.leverBeamBar,d:_}),y.map((e,t)=>(0,j.jsx)(`line`,{className:L.leverBeamTick,x1:e.x1,y1:e.y1,x2:e.x2,y2:e.y2},t))]}),i.map(e=>(0,j.jsx)(At,{ax:t.px(e.attach),ay:t.py(e.attach),mx:t.px(e.massAt),my:t.py(e.massAt),size:5.5*t.scale,massText:e.massText,highlighted:t.highlighted(e.id)},e.id)),(0,j.jsx)(he,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t})]})}const Mt=(e,t)=>{let n;for(let r of e){if(n!==void 0&&t>=n.x&&t<=r.x){let e=r.x-n.x,i=e===0?0:(t-n.x)/e;return n.y+(r.y-n.y)*i}n=r}let r=e[0],i=e[e.length-1];return r===void 0||i===void 0?0:t<r.x?r.y:i.y},Nt=(e,t)=>{let n=e.points[0],r=e.points[e.points.length-1];if(n===void 0||r===void 0)return[];let i=r.x-n.x;if(i<=0)return[];let a=i*.02,o=Array.from({length:12},(e,t)=>({x:n.x+(t+.5)*i/12,atNode:!1})),s=t.filter(e=>e.kind===`node`&&e.at.x>n.x+a&&e.at.x<r.x-a).map(e=>e.at.x).sort((e,t)=>e-t);for(let e of s){let t;for(let[n,r]of o.entries()){if(r.atNode)continue;let i=t===void 0?void 0:o[t];(i===void 0||Math.abs(r.x-e)<Math.abs(i.x-e))&&(t=n)}let n=t===void 0?void 0:o[t];n!==void 0&&(n.x=e,n.atNode=!0)}let{from:c,to:l}=e.equilibrium,u=l.x-c.x;return o.map(t=>({...t,y:Mt(e.points,t.x),equilibriumY:u===0?c.y:c.y+(l.y-c.y)*(t.x-c.x)/u})).sort((e,t)=>e.x-t.x)};function Pt({view:e,projection:t}){let n=e.waveProfile,r=e.waveMarker,i=e.waveSources??[],a=e.wavePoint,o=e.waveNodes??[],s=e.waveEnvelope,c=e.waveFronts??[],l=e.visible.waveform!==!1;return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`defs`,{children:(0,j.jsx)(N,{uid:t.uid})}),n===void 0?null:(0,j.jsx)(`line`,{className:L.waveEquilibrium,x1:t.px(n.equilibrium.from),y1:t.py(n.equilibrium.from),x2:t.px(n.equilibrium.to),y2:t.py(n.equilibrium.to)}),n===void 0?null:(()=>{let e=t.px(n.equilibrium.from),r=t.py(n.equilibrium.from),i=t.px(n.equilibrium.to),a=t.py(n.equilibrium.to);return n.kind===`string`?(0,j.jsx)(`g`,{"aria-hidden":`true`,children:[e,i].map((e,t)=>(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`rect`,{className:L.waveClamp,x:e-(t===0?9:0),y:(t===0?r:a)-9,width:9,height:18}),[-6,0,6].map(n=>(0,j.jsx)(`line`,{className:L.waveClampHatch,x1:e-(t===0?9:0)+n+7,y1:(t===0?r:a)-9,x2:e-(t===0?9:0)+n,y2:(t===0?r:a)-14},n))]},t))}):(0,j.jsxs)(`g`,{"aria-hidden":`true`,children:[(0,j.jsx)(`rect`,{className:L.waveDriver,x:e-16,y:r-8,width:11,height:16,rx:2}),(0,j.jsx)(`line`,{className:L.waveDriverPin,x1:e-5,y1:r,x2:e,y2:r}),(0,j.jsx)(`text`,{className:L.annotation,x:e-10,y:r+22,textAnchor:`middle`,children:`振源`})]})})(),s===void 0||!l?null:(0,j.jsxs)(`g`,{className:t.highlighted(s.id)?L.highlightGroup:void 0,"aria-hidden":`true`,children:[(0,j.jsx)(`path`,{className:L.waveEnvelope,d:t.path(s.upper)}),(0,j.jsx)(`path`,{className:L.waveEnvelope,d:t.path(s.lower)})]}),c.length===0?null:(0,j.jsx)(`g`,{className:L.waveFrontGroup,"aria-hidden":`true`,children:c.map(e=>(0,j.jsx)(`circle`,{className:L.waveFront,cx:t.px(e.center),cy:t.py(e.center),r:e.radius*t.scale},e.id))}),n===void 0||!l||n.points.length<2?null:(0,j.jsx)(`g`,{className:t.highlighted(n.id)?L.highlightGroup:void 0,children:(0,j.jsx)(`path`,{className:n.kind===`rope`?L.waveRope:L.waveString,d:t.path(n.points)})}),e.dimensions.map(e=>(0,j.jsx)(F,{dimension:e,projection:t},e.id)),e.visible.nodes===!1?null:o.map(e=>{let n=t.px(e.at),r=t.py(e.at);return(0,j.jsxs)(`g`,{className:t.highlighted(e.id)?L.highlightGroup:void 0,children:[(0,j.jsx)(`circle`,{className:e.kind===`node`?L.waveNode:L.waveAntinode,cx:n,cy:r,r:e.kind===`node`?4.2:3.4}),e.label===void 0?null:(0,j.jsx)(`text`,{className:L.annotation,x:n,y:r-9,textAnchor:`middle`,children:e.label})]},e.id)}),i.map(e=>{let n=t.px(e.at),r=t.py(e.at);return(0,j.jsxs)(`g`,{className:t.highlighted(e.id)?L.highlightGroup:void 0,children:[(0,j.jsx)(`line`,{className:L.waveSourceStem,x1:n,y1:r-5,x2:n,y2:r-15}),(0,j.jsx)(`rect`,{className:L.waveSourceStem,x:n-4,y:r-20,width:8,height:6,rx:1.5}),(0,j.jsx)(`circle`,{className:L.waveSource,cx:n,cy:r,r:5}),(0,j.jsx)(`text`,{className:L.annotation,x:n,y:r+17,textAnchor:`middle`,children:e.label})]},e.id)}),n===void 0||!l||n.points.length<2?null:(0,j.jsx)(`g`,{"aria-hidden":`true`,children:Nt(n,o).map(e=>{let n=t.px(e),r=t.py(e);return(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`line`,{className:L.waveMediumGuide,x1:n,y1:t.py({x:e.x,y:e.equilibriumY}),x2:n,y2:r}),(0,j.jsx)(`circle`,{className:I(L.waveMedium,e.atNode&&L.waveMediumNode),cx:n,cy:r,r:e.atNode?2.6:3.2})]},e.x)})}),(0,j.jsx)(he,{vectors:e.vectors.filter(t=>e.visible[t.observable]!==!1),projection:t}),r===void 0||!l?null:(()=>{let e=t.px(r.at),n=t.py(r.at);return(0,j.jsxs)(`g`,{className:t.highlighted(r.id)?L.highlightGroup:void 0,children:[(0,j.jsx)(`line`,{className:L.waveMarkerGuide,x1:e,y1:t.py({x:r.at.x,y:0}),x2:e,y2:n}),(0,j.jsx)(`circle`,{className:L.waveMarker,cx:e,cy:n,r:4.6}),(0,j.jsx)(`text`,{className:L.annotation,x:e+9,y:n-8,children:r.label})]})})(),a===void 0||e.visible.superposition===!1?null:(()=>{let e=t.px(a.at),n=t.py(a.at),r=a.verdict===`constructive`?L.wavePointConstructive:a.verdict===`destructive`?L.wavePointDestructive:L.wavePointPartial;return(0,j.jsxs)(`g`,{className:t.highlighted(a.id)?L.highlightGroup:void 0,children:[(0,j.jsx)(`circle`,{className:I(L.wavePoint,r),cx:e,cy:n,r:6}),(0,j.jsx)(P,{x:e+11,y:n-10,anchor:`start`,symbol:a.readout,className:L.wavePointLabel})]})})()]})}function Ft({view:e,projection:t}){let n=e.particles.find(e=>e.id===`modern-cathode`);if(n===void 0)return null;let r=t.px(n.at),i=t.py(n.at),a=55*t.scale,o=`photoelectric-photon-${t.uid}`,s=`photoelectric-electron-${t.uid}`;return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsxs)(`defs`,{children:[(0,j.jsx)(`marker`,{id:o,viewBox:`0 0 8 8`,refX:`7`,refY:`4`,markerWidth:`6`,markerHeight:`6`,orient:`auto`,children:(0,j.jsx)(`path`,{d:`M0 0 L8 4 L0 8 Z`,className:L.modernPhotonHead})}),(0,j.jsx)(`marker`,{id:s,viewBox:`0 0 8 8`,refX:`7`,refY:`4`,markerWidth:`6`,markerHeight:`6`,orient:`auto`,children:(0,j.jsx)(`path`,{d:`M0 0 L8 4 L0 8 Z`,className:L.modernElectronHead})})]}),e.trajectories.map(e=>(0,j.jsx)(`path`,{className:e.kind===`history`?L.modernPhoton:L.modernElectronPath,d:t.path(e.points),markerEnd:`url(#${e.kind===`history`?o:s})`},e.id)),(0,j.jsx)(`rect`,{"data-testid":`photoelectric-cathode`,className:L.modernCathode,x:r-6,y:i-a,width:12,height:a*2,rx:3}),(0,j.jsx)(`line`,{className:L.modernCathodeFace,x1:r-4,y1:i-a+4,x2:r-4,y2:i+a-4}),e.particles.filter(e=>e.id!==n.id).map(e=>(0,j.jsxs)(`g`,{"data-testid":`photoelectric-electron`,children:[(0,j.jsx)(`circle`,{className:L.modernElectron,cx:t.px(e.at),cy:t.py(e.at),r:Math.max(4,e.radius*t.scale)}),(0,j.jsx)(`text`,{className:L.annotation,x:t.px(e.at),y:t.py(e.at)+23,textAnchor:`middle`,children:e.symbol})]},e.id)),e.labels.map(e=>(0,j.jsx)(`text`,{className:L.modernLabel,x:t.px(e.at),y:t.py(e.at),textAnchor:e.anchor,children:e.text},e.id))]})}function It({view:e,projection:t}){return(0,j.jsx)(j.Fragment,{children:e.trajectories.filter(e=>e.kind===`predicted`&&e.points.length>1).map(e=>{let n=e.points[0],r=e.points[e.points.length-1];return n===void 0||r===void 0?null:(0,j.jsxs)(`linearGradient`,{id:`trajectory-fade-${t.uid}-${e.id}`,gradientUnits:`userSpaceOnUse`,x1:t.px(n),y1:t.py(n),x2:t.px(r),y2:t.py(r),children:[(0,j.jsx)(`stop`,{offset:`0%`,stopColor:`var(--physics-trajectory-predicted)`,stopOpacity:`0.75`}),(0,j.jsx)(`stop`,{offset:`100%`,stopColor:`var(--physics-trajectory-predicted)`,stopOpacity:`0.12`})]},`fade-${e.id}`)})})}function Lt(e){return e.view.currentRig===void 0?(0,j.jsx)(Rt,{...e}):(0,j.jsx)(ct,{view:e.view,projection:e.projection})}function Rt({view:e,projection:t}){let n=e.field,r=n?.direction===`into-page`?`×`:`·`,i=n===void 0?0:Math.floor(e.extent.width/n.spacing),a=n===void 0?0:Math.floor(e.extent.height/n.spacing),o=n===void 0?[]:Array.from({length:i},(r,i)=>Array.from({length:a},(r,a)=>({x:t.px({x:e.origin.x+n.spacing*(i+.5),y:e.origin.y}),y:t.py({x:e.origin.x,y:e.origin.y+e.extent.height-n.spacing*(a+.5)})}))).flat(),s=e.particles[0],c=`pc-glow-${t.uid}`;return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsxs)(`defs`,{children:[(0,j.jsx)(N,{uid:t.uid}),(0,j.jsx)(It,{view:e,projection:t}),(0,j.jsxs)(`radialGradient`,{id:c,cx:`34%`,cy:`30%`,r:`72%`,children:[(0,j.jsx)(`stop`,{offset:`0%`,stopColor:s?.sign===`negative`?`#9dc4ff`:`#ffb4a6`}),(0,j.jsx)(`stop`,{offset:`55%`,stopColor:s?.sign===`negative`?`#3b82f6`:`#ea6a5c`}),(0,j.jsx)(`stop`,{offset:`100%`,stopColor:s?.sign===`negative`?`#1d4ed8`:`#c8453a`})]})]}),(0,j.jsx)(`g`,{className:L.fieldGlyph,textAnchor:`middle`,children:o.map(e=>(0,j.jsx)(`text`,{x:e.x,y:e.y,children:r},`${e.x}-${e.y}`))}),e.visible.trajectory===!0?e.trajectories.map(e=>{let n=e.points[Math.floor(e.points.length/4)],r=e.kind===`history`?e.points[e.points.length-1]:void 0;return(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`path`,{className:e.kind===`history`?L.trajectoryHistory:L.trajectoryPredicted,d:t.path(e.points)}),n===void 0||e.direction===void 0?null:(0,j.jsx)(`text`,{className:L.trajectoryDirection,x:t.px(n)+8,y:t.py(n)-8,"aria-label":e.direction===`clockwise`?`轨迹方向：顺时针`:`轨迹方向：逆时针`,children:e.direction===`clockwise`?`↻`:`↺`}),r===void 0?null:(0,j.jsx)(`circle`,{className:L.trajectoryRunner,cx:t.px(r),cy:t.py(r),r:4})]},`${e.id}:${e.kind}`)}):null,e.guides.filter(t=>e.visible[t.observable]===!0).map(e=>(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`line`,{className:L.guideLine,x1:t.px(e.from),y1:t.py(e.from),x2:t.px(e.to),y2:t.py(e.to)}),e.label===void 0?null:(0,j.jsx)(P,{x:(t.px(e.from)+t.px(e.to))/2+6,y:(t.py(e.from)+t.py(e.to))/2-6,anchor:`start`,symbol:e.label,className:L.guideLabel})]},e.id)),e.visible.center===!0&&e.center!==void 0?(0,j.jsx)(`circle`,{className:L.orbitCenter,cx:t.px(e.center),cy:t.py(e.center),r:`3`}):null,(0,j.jsx)(he,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t}),e.particles.map(e=>{let n=t.px(e.at),r=t.py(e.at),i=e.radius*t.scale;return(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`circle`,{cx:n,cy:r,r:i,fill:`url(#${c})`}),(0,j.jsx)(`circle`,{cx:n-i*.3,cy:r-i*.34,r:i*.24,fill:`rgba(255, 255, 255, 0.62)`}),(0,j.jsx)(`text`,{className:I(L.particleLabel,e.sign===`negative`&&L.particleLabelNegative),x:n-i-6,y:r-i-5,textAnchor:`end`,children:e.symbol})]},e.id)})]})}function zt({view:e,projection:t}){let n=e.electricField,r=n?.spacing??0,i=n?.direction.x??0,a=n?.direction.y??0,o=n!==void 0,s=o?Math.max(1,Math.floor(e.extent.width/r)):0,c=o?Math.max(1,Math.floor(e.extent.height/r)):0,l=r*.58,u=(0,_.useMemo)(()=>o?Array.from({length:s},(t,n)=>Array.from({length:c},(t,o)=>{let s={x:e.origin.x+r*(n+.5),y:e.origin.y+r*(o+.5)};return{from:{x:s.x-i*l*.5,y:s.y-a*l*.5},to:{x:s.x+i*l*.5,y:s.y+a*l*.5}}})).flat():[],[l,s,i,a,r,o,c,e.origin.x,e.origin.y]),d=(0,_.useMemo)(()=>e.trajectories.map(e=>({id:e.id,kind:e.kind,path:t.path(e.points)})),[t,e.trajectories]);if(e.pointChargeSources!==void 0)return(0,j.jsx)(Bt,{view:e,projection:t});if(e.plates!==void 0)return(0,j.jsx)(Vt,{view:e,projection:t});let f=e.particles[0],p=`pc-electric-glow-${t.uid}`;return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsxs)(`defs`,{children:[(0,j.jsx)(N,{uid:t.uid}),(0,j.jsx)(It,{view:e,projection:t}),(0,j.jsxs)(`radialGradient`,{id:p,cx:`34%`,cy:`30%`,r:`72%`,children:[(0,j.jsx)(`stop`,{offset:`0%`,stopColor:f?.sign===`negative`?`#9dc4ff`:`#ffb4a6`}),(0,j.jsx)(`stop`,{offset:`55%`,stopColor:f?.sign===`negative`?`#3b82f6`:`#ea6a5c`}),(0,j.jsx)(`stop`,{offset:`100%`,stopColor:f?.sign===`negative`?`#1d4ed8`:`#c8453a`})]})]}),(0,j.jsx)(`g`,{className:L.electricFieldLattice,"aria-hidden":`true`,children:u.map((e,n)=>(0,j.jsx)(`line`,{x1:t.px(e.from),y1:t.py(e.from),x2:t.px(e.to),y2:t.py(e.to),markerEnd:`url(#${M(`field`,t.uid)})`},n))}),e.visible.trajectory===!0?d.map(e=>(0,j.jsx)(`path`,{className:e.kind===`history`?L.trajectoryHistory:L.trajectoryPredicted,d:e.path,...e.kind===`predicted`?{stroke:`url(#trajectory-fade-${t.uid}-${e.id})`}:{}},`${e.id}:${e.kind}`)):null,(0,j.jsx)(he,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t}),e.visible.trajectory===!0?(()=>{let n=e.trajectories.find(e=>e.kind===`history`),r=n?.points[n.points.length-1];return r===void 0?null:(0,j.jsx)(`circle`,{className:L.trajectoryRunner,cx:t.px(r),cy:t.py(r),r:4})})():null,e.particles.map(e=>{let n=t.px(e.at),r=t.py(e.at),i=e.radius*t.scale;return(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`circle`,{cx:n,cy:r,r:i,fill:`url(#${p})`}),(0,j.jsx)(`circle`,{cx:n-i*.3,cy:r-i*.34,r:i*.24,fill:`rgba(255, 255, 255, 0.62)`}),(0,j.jsx)(`text`,{className:I(L.particleLabel,e.sign===`negative`&&L.particleLabelNegative),x:n-i-6,y:r-i-5,textAnchor:`end`,children:e.symbol})]},e.id)})]})}function Bt({view:e,projection:t}){let n=`pc-point-pos-${t.uid}`,r=`pc-point-neg-${t.uid}`,i=e.fieldStreamlines??[],a=e.pointChargeSources??[];return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsxs)(`defs`,{children:[(0,j.jsx)(N,{uid:t.uid}),(0,j.jsx)(It,{view:e,projection:t}),(0,j.jsxs)(`radialGradient`,{id:n,cx:`34%`,cy:`30%`,r:`72%`,children:[(0,j.jsx)(`stop`,{offset:`0%`,stopColor:`#ffd6cc`}),(0,j.jsx)(`stop`,{offset:`55%`,stopColor:`#ea6a5c`}),(0,j.jsx)(`stop`,{offset:`100%`,stopColor:`#c8453a`})]}),(0,j.jsxs)(`radialGradient`,{id:r,cx:`34%`,cy:`30%`,r:`72%`,children:[(0,j.jsx)(`stop`,{offset:`0%`,stopColor:`#cdddff`}),(0,j.jsx)(`stop`,{offset:`55%`,stopColor:`#3b82f6`}),(0,j.jsx)(`stop`,{offset:`100%`,stopColor:`#1d4ed8`})]})]}),(0,j.jsx)(`g`,{className:L.electricFieldStreamline,"aria-hidden":`true`,children:i.map(e=>{let n=Math.floor(e.points.length/2),r=e.points.slice(0,n+1);return(0,j.jsxs)(`g`,{className:e.sourceId!==void 0&&t.highlighted(e.sourceId)?L.highlightGroup:void 0,children:[(0,j.jsx)(`path`,{className:L.streamlinePath,d:t.path(e.points)}),r.length>=2?(0,j.jsx)(`path`,{className:L.streamlineArrow,d:t.path(r),markerEnd:`url(#${M(`field`,t.uid)})`}):null]},e.id)})}),e.equipotentials===void 0||e.equipotentials.length===0?null:(0,j.jsx)(`g`,{className:L.equipotentials,"aria-hidden":`true`,children:e.equipotentials.map(e=>(0,j.jsx)(`path`,{className:L.equipotentialPath,d:t.path(e.points),...e.closed?{"data-closed":`true`}:{}},e.id))}),(0,j.jsx)(he,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t}),a.map(e=>{let i=t.px(e.at),a=t.py(e.at),o=e.radius*t.scale,s=e.sign===`negative`?r:n;return(0,j.jsxs)(`g`,{className:t.highlighted(e.id)?L.highlightGroup:void 0,children:[(0,j.jsx)(`circle`,{cx:i,cy:a,r:o,fill:`url(#${s})`}),(0,j.jsx)(`circle`,{cx:i-o*.3,cy:a-o*.34,r:o*.24,fill:`rgba(255, 255, 255, 0.62)`}),(0,j.jsx)(`text`,{className:I(L.particleLabel,e.sign===`negative`&&L.particleLabelNegative),x:i,y:a+o+14,textAnchor:`middle`,children:e.sign===`negative`?`−`:`+`})]},e.id)}),e.probe===void 0?null:(()=>{let n=t.px(e.probe.at),r=t.py(e.probe.at);return(0,j.jsx)(`g`,{className:t.highlighted(e.probe.id)?L.highlightGroup:void 0,children:(0,j.jsx)(`circle`,{cx:n,cy:r,r:3.2,className:L.probeDot})},e.probe.id)})()]})}function Vt({view:e,projection:t}){let n=e.plates??[],r=e.boundedField,i=e.particles[0],a=`pc-region-glow-${t.uid}`,o=`pc-region-clip-${t.uid}`,s=(0,_.useMemo)(()=>{if(r===void 0)return[];let{at:e,width:t,height:n,direction:i,spacing:a}=r,o=e.x-t/2,s=e.y-n/2,c=Math.abs(i.y)>=Math.abs(i.x),l=Math.min(14,Math.max(4,Math.round((c?t:n)/a))),u=Math.min(t,n)*.06;return Array.from({length:l},(e,r)=>{let a=(r+.5)/l;if(c){let e=o+t*a,r=i.y>=0?s:s+n,c=i.y>=0?s+n:s,l=s+n/2,d=i.y>=0?u:-u;return{from:{x:e,y:r},to:{x:e,y:c},arrowFrom:{x:e,y:l-d},arrowTo:{x:e,y:l+d}}}let d=s+n*a,f=i.x>=0?o:o+t,p=i.x>=0?o+t:o,m=o+t/2,h=i.x>=0?u:-u;return{from:{x:f,y:d},to:{x:p,y:d},arrowFrom:{x:m-h,y:d},arrowTo:{x:m+h,y:d}}})},[r]);return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsxs)(`defs`,{children:[(0,j.jsx)(N,{uid:t.uid}),(0,j.jsx)(It,{view:e,projection:t}),(0,j.jsxs)(`radialGradient`,{id:a,cx:`34%`,cy:`30%`,r:`72%`,children:[(0,j.jsx)(`stop`,{offset:`0%`,stopColor:i?.sign===`negative`?`#9dc4ff`:`#ffb4a6`}),(0,j.jsx)(`stop`,{offset:`55%`,stopColor:i?.sign===`negative`?`#3b82f6`:`#ea6a5c`}),(0,j.jsx)(`stop`,{offset:`100%`,stopColor:i?.sign===`negative`?`#1d4ed8`:`#c8453a`})]}),r===void 0?null:(0,j.jsx)(`clipPath`,{id:o,children:(0,j.jsx)(`rect`,{x:t.px({x:r.at.x-r.width/2,y:0}),y:t.py({x:0,y:r.at.y+r.height/2}),width:r.width*t.scale,height:r.height*t.scale})})]}),r===void 0||e.visible.electricField!==!0||s.length===0?null:(0,j.jsx)(`g`,{className:L.electricFieldLattice,clipPath:`url(#${o})`,"aria-hidden":`true`,children:s.map((e,n)=>(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`line`,{className:L.electricFieldLine,x1:t.px(e.from),y1:t.py(e.from),x2:t.px(e.to),y2:t.py(e.to)}),(0,j.jsx)(`line`,{x1:t.px(e.arrowFrom),y1:t.py(e.arrowFrom),x2:t.px(e.arrowTo),y2:t.py(e.arrowTo),markerEnd:`url(#${M(`field`,t.uid)})`})]},n))}),r===void 0?null:(0,j.jsx)(`rect`,{className:I(L.boundedFieldRegion,L.regionTintElectric),x:t.px({x:r.at.x-r.width/2,y:0}),y:t.py({x:0,y:r.at.y+r.height/2}),width:r.width*t.scale,height:r.height*t.scale}),n.map(e=>{let n=t.px(e.at),r=t.py(e.at),i=e.length*t.scale/2;return(0,j.jsxs)(`g`,{"data-testid":`plate-${e.top?`top`:`bottom`}`,children:[(0,j.jsx)(`rect`,{className:I(L.plateBar,e.top?L.plateTop:L.plateBottom),x:n-i,y:r-2.5,width:i*2,height:5,rx:1.5}),e.sign===void 0?null:(0,j.jsx)(`g`,{"aria-hidden":`true`,children:Array.from({length:Math.max(3,Math.floor(i*2/26))},(t,a)=>(0,j.jsx)(`text`,{className:I(L.plateSignLabel,e.sign===`negative`&&L.particleLabelNegative),x:n-i+(a+.5)*i*2/Math.max(3,Math.floor(i*2/26)),y:r+(e.top?14:-8),textAnchor:`middle`,children:e.sign===`negative`?`−`:`+`},a))})]},e.id)}),e.visible.trajectory===!0?e.trajectories.map(e=>(0,j.jsx)(`path`,{className:e.kind===`history`?L.trajectoryHistory:L.trajectoryPredicted,d:t.path(e.points),...e.kind===`predicted`?{stroke:`url(#trajectory-fade-${t.uid}-${e.id})`}:{}},`${e.id}:${e.kind}`)):null,e.visible.trajectory===!0?(()=>{let n=e.trajectories.find(e=>e.kind===`history`),r=n?.points[n.points.length-1];return r===void 0?null:(0,j.jsx)(`circle`,{className:L.trajectoryRunner,cx:t.px(r),cy:t.py(r),r:4})})():null,(0,j.jsx)(he,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t}),e.particles.map(e=>{let n=t.px(e.at),r=t.py(e.at),i=e.radius*t.scale;return(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`circle`,{cx:n,cy:r,r:i,fill:`url(#${a})`}),(0,j.jsx)(`circle`,{cx:n-i*.3,cy:r-i*.34,r:i*.24,fill:`rgba(255, 255, 255, 0.62)`}),(0,j.jsx)(`text`,{className:I(L.particleLabel,e.sign===`negative`&&L.particleLabelNegative),x:n-i-6,y:r-i-5,textAnchor:`end`,children:e.symbol})]},e.id)})]})}function B({view:e,projection:t}){let n=e.compositeRegions??[],r=e.particles[0],i=`pc-composite-glow-${t.uid}`,a=e.electricField,o=(0,_.useMemo)(()=>{if(a===void 0)return[];let t=a.spacing,n=Math.max(1,Math.floor(e.extent.width/t)),r=Math.max(1,Math.floor(e.extent.height/t)),i=t*.58,o=[];for(let s=0;s<n;s+=1)for(let n=0;n<r;n+=1){let r={x:e.origin.x+t*(s+.5),y:e.origin.y+t*(n+.5)};o.push({from:{x:r.x-a.direction.x*i*.5,y:r.y-a.direction.y*i*.5},to:{x:r.x+a.direction.x*i*.5,y:r.y+a.direction.y*i*.5}})}return o},[a,e.extent.height,e.extent.width,e.origin.x,e.origin.y]),s=e.field,c=(0,_.useMemo)(()=>{if(s===void 0)return[];let t=s.spacing,n=Math.max(1,Math.floor(e.extent.width/t)),r=Math.max(1,Math.floor(e.extent.height/t)),i=[];for(let a=0;a<n;a+=1)for(let n=0;n<r;n+=1)i.push({x:e.origin.x+t*(a+.5),y:e.origin.y+t*(n+.5)});return i},[s,e.extent.height,e.extent.width,e.origin.x,e.origin.y]),l=(0,_.useMemo)(()=>n.map(e=>{let t=[],n=e.electricField;if(n!==void 0){let r=n.spacing,i=Math.max(1,Math.floor(e.width/r)),a=Math.max(1,Math.floor(e.height/r)),o=r*.58,s=e.at.x-e.width/2,c=e.at.y-e.height/2;for(let e=0;e<i;e+=1)for(let i=0;i<a;i+=1){let a={x:s+r*(e+.5),y:c+r*(i+.5)};t.push({from:{x:a.x-n.direction.x*o*.5,y:a.y-n.direction.y*o*.5},to:{x:a.x+n.direction.x*o*.5,y:a.y+n.direction.y*o*.5}})}}let r=[],i=e.magneticField;if(i!==void 0){let t=i.spacing,n=Math.max(1,Math.floor(e.width/t)),a=Math.max(1,Math.floor(e.height/t)),o=i.direction===`into-page`?`×`:`·`,s=e.at.x-e.width/2,c=e.at.y-e.height/2;for(let e=0;e<n;e+=1)for(let n=0;n<a;n+=1)r.push({at:{x:s+t*(e+.5),y:c+t*(n+.5)},glyph:o})}return{region:e,eArrows:t,bGlyphs:r}}),[n]),u=(0,_.useMemo)(()=>e.trajectories.map(e=>({id:e.id,kind:e.kind,path:t.path(e.points)})),[t,e.trajectories]),d=(0,_.useMemo)(()=>{let e=new Map,n=-1/0,r=0;for(let{region:i}of[...l].sort((e,t)=>e.region.at.x-t.region.at.x)){let a=t.px({x:i.at.x,y:0}),o=t.py({x:0,y:i.at.y+i.height/2})-6;a-n<96&&r-o<14&&(o=r-14),n=a,r=o,e.set(i.id,o)}return e},[l,t]);return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsxs)(`defs`,{children:[(0,j.jsx)(N,{uid:t.uid}),(0,j.jsx)(It,{view:e,projection:t}),(0,j.jsxs)(`radialGradient`,{id:i,cx:`34%`,cy:`30%`,r:`72%`,children:[(0,j.jsx)(`stop`,{offset:`0%`,stopColor:r?.sign===`negative`?`#9dc4ff`:`#ffb4a6`}),(0,j.jsx)(`stop`,{offset:`55%`,stopColor:r?.sign===`negative`?`#3b82f6`:`#ea6a5c`}),(0,j.jsx)(`stop`,{offset:`100%`,stopColor:r?.sign===`negative`?`#1d4ed8`:`#c8453a`})]})]}),e.visible.magneticField===!0&&s!==void 0&&c.length>0?(0,j.jsx)(`g`,{className:L.fieldGlyph,textAnchor:`middle`,"aria-hidden":`true`,children:c.map((e,n)=>(0,j.jsx)(`text`,{x:t.px(e),y:t.py(e),children:s.direction===`into-page`?`×`:`·`},n))}):null,e.visible.electricField===!0&&o.length>0?(0,j.jsx)(`g`,{className:L.electricFieldLattice,"aria-hidden":`true`,children:o.map((e,n)=>(0,j.jsx)(`line`,{x1:t.px(e.from),y1:t.py(e.from),x2:t.px(e.to),y2:t.py(e.to),markerEnd:`url(#${M(`field`,t.uid)})`},n))}):null,l.map(({region:e,eArrows:n,bGlyphs:r})=>{let i=`pc-composite-clip-${t.uid}-${e.id}`,a=e.at.x-e.width/2,o=e.at.y+e.height/2,s=t.highlighted(e.id),c=e.electricField!==void 0&&e.magneticField!==void 0?L.regionTintCrossed:e.magneticField===void 0?e.electricField===void 0?void 0:L.regionTintElectric:L.regionTintMagnetic;return(0,j.jsxs)(`g`,{className:s?L.highlightGroup:void 0,children:[(0,j.jsx)(`clipPath`,{id:i,children:(0,j.jsx)(`rect`,{x:t.px({x:a,y:0}),y:t.py({x:0,y:o}),width:e.width*t.scale,height:e.height*t.scale})}),(0,j.jsx)(`rect`,{className:I(L.boundedFieldRegion,c),x:t.px({x:a,y:0}),y:t.py({x:0,y:o}),width:e.width*t.scale,height:e.height*t.scale}),n.length>0?(0,j.jsx)(`g`,{className:L.electricFieldLattice,clipPath:`url(#${i})`,"aria-hidden":`true`,children:n.map((e,n)=>(0,j.jsx)(`line`,{x1:t.px(e.from),y1:t.py(e.from),x2:t.px(e.to),y2:t.py(e.to),markerEnd:`url(#${M(`field`,t.uid)})`},n))}):null,r.length>0?(0,j.jsx)(`g`,{className:L.fieldGlyph,textAnchor:`middle`,clipPath:`url(#${i})`,"aria-hidden":`true`,children:r.map((e,n)=>(0,j.jsx)(`text`,{x:t.px(e.at),y:t.py(e.at),children:e.glyph},n))}):null,(0,j.jsx)(`text`,{className:L.annotation,x:t.px({x:e.at.x,y:0}),y:d.get(e.id)??t.py({x:0,y:o})-6,textAnchor:`middle`,children:e.label})]},e.id)}),e.visible.trajectory===!0?u.map(e=>(0,j.jsx)(`path`,{className:e.kind===`history`?L.trajectoryHistory:L.trajectoryPredicted,d:e.path},`${e.id}:${e.kind}`)):null,(0,j.jsx)(he,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t}),e.particles.map(e=>{let n=t.px(e.at),r=t.py(e.at),a=e.radius*t.scale;return(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`circle`,{cx:n,cy:r,r:a,fill:`url(#${i})`}),(0,j.jsx)(`circle`,{cx:n-a*.3,cy:r-a*.34,r:a*.24,fill:`rgba(255, 255, 255, 0.62)`}),(0,j.jsx)(`text`,{className:I(L.particleLabel,e.sign===`negative`&&L.particleLabelNegative),x:n-a-6,y:r-a-5,textAnchor:`end`,children:e.symbol})]},e.id)})]})}function Ht({view:e,projection:t}){return e.leverBeam===void 0?e.energyRamp===void 0?(0,j.jsxs)(j.Fragment,{children:[(0,j.jsxs)(`defs`,{children:[(0,j.jsx)(N,{uid:t.uid}),(0,j.jsx)(It,{view:e,projection:t})]}),e.incline===void 0?null:(0,j.jsx)(le,{incline:e.incline,projection:t}),e.platform===void 0?null:(0,j.jsx)(ue,{platform:e.platform,projection:t}),e.ground===void 0?null:(0,j.jsx)(ce,{ground:e.ground,projection:t}),e.apparatus?.map(e=>(0,j.jsx)(pe,{sprite:e,projection:t},e.id)),e.spring===void 0?null:(0,j.jsx)(de,{spring:e.spring,projection:t}),e.pendulum===void 0?null:(0,j.jsx)(fe,{pendulum:e.pendulum,projection:t}),e.motionMarks===void 0||e.visible.trajectory!==!0?null:(0,j.jsx)(_e,{marks:e.motionMarks,projection:t}),e.visible.trajectory===!0?e.trajectories.map(e=>(0,j.jsx)(`path`,{className:e.kind===`history`?L.trajectoryHistory:L.trajectoryPredicted,d:t.path(e.points)},`${e.id}:${e.kind}`)):null,e.dimensions.map(e=>(0,j.jsx)(F,{dimension:e,projection:t},e.id)),e.angles.map(e=>(0,j.jsx)(ge,{angle:e,projection:t},e.id)),e.coordinate===void 0?null:(0,j.jsx)(ye,{coordinate:e.coordinate,projection:t}),e.guides.filter(t=>e.visible[t.observable]===!0).map(e=>(0,j.jsx)(`line`,{className:L.guideLine,x1:t.px(e.from),y1:t.py(e.from),x2:t.px(e.to),y2:t.py(e.to)},e.id)),e.visible.keyPoints===!0?e.keyPoints.map(e=>(0,j.jsx)(ve,{keyPoint:e,projection:t},e.id)):null,(0,j.jsx)(he,{vectors:e.vectors.filter(t=>e.visible[t.observable]===!0),projection:t}),e.bodies.map(e=>(0,j.jsx)(me,{body:e,projection:t},e.id)),e.labels.map(e=>(0,j.jsx)(P,{x:t.px(e.at),y:t.py(e.at),anchor:e.anchor??`middle`,symbol:e.text,className:I(L.annotation,e.role===void 0?void 0:oe(e.role))},e.id))]}):(0,j.jsx)(ut,{view:e,projection:t}):(0,j.jsx)(jt,{view:e,projection:t})}function Ut(e){return e.view.lightRig!==void 0||e.view.lightRefraction!==void 0?(0,j.jsx)(dt,{view:e.view,projection:e.projection}):(0,j.jsx)(yt,{...e})}function Wt(e){return e.view.transformerCoils===void 0?(0,j.jsx)(gt,{...e}):(0,j.jsx)(pt,{view:e.view,projection:e.projection})}function Gt(e){return e.view.thermometer===void 0?(0,j.jsx)(wt,{...e}):(0,j.jsx)(Et,{view:e.view,projection:e.projection})}function Kt(e){return e.view.noiseRig===void 0?(0,j.jsx)(Ce,{...e}):(0,j.jsx)(kt,{view:e.view,projection:e.projection})}const qt={magnetic:Lt,mechanics:Ht,electric:zt,circuit:Qe,composite:B,optics:Ut,acoustics:Kt,fluid:tt,thermal:Gt,induction:Wt,wave:Pt,modern:Ft};if(typeof document<`u`){let e=document.createElement(`style`);e.textContent=`._9mHjaq_host {
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
`,document.head.appendChild(e)}var V={axis:`_9mHjaq_axis`,axisLabel:`_9mHjaq_axisLabel`,ballHighlight:`_9mHjaq_ballHighlight`,ballMid:`_9mHjaq_ballMid`,ballShade:`_9mHjaq_ballShade`,effect:`_9mHjaq_effect`,effectBoundary:`_9mHjaq_effectBoundary`,effectCore:`_9mHjaq_effectCore`,effectImpact:`_9mHjaq_effectImpact`,effectMark:`_9mHjaq_effectMark`,effectRay:`_9mHjaq_effectRay`,effectRing:`_9mHjaq_effectRing`,effectRingLate:`_9mHjaq_effectRingLate`,effects:`_9mHjaq_effects`,gridMajor:`_9mHjaq_gridMajor`,gridMinor:`_9mHjaq_gridMinor`,host:`_9mHjaq_host`,interactive:`_9mHjaq_interactive`,"physics-burst-core":`_9mHjaq_physics-burst-core`,"physics-burst-ray":`_9mHjaq_physics-burst-ray`,"physics-burst-ring":`_9mHjaq_physics-burst-ring`,"physics-burst-ring-wide":`_9mHjaq_physics-burst-ring-wide`,plot:`_9mHjaq_plot`,readoutDraggable:`_9mHjaq_readoutDraggable`,readoutDragging:`_9mHjaq_readoutDragging`,readoutLine:`_9mHjaq_readoutLine`,readoutPanel:`_9mHjaq_readoutPanel`,readoutTitle:`_9mHjaq_readoutTitle`,root:`_9mHjaq_root`,scaleBar:`_9mHjaq_scaleBar`,scaleLabel:`_9mHjaq_scaleLabel`,strobe:`_9mHjaq_strobe`,strobeBody:`_9mHjaq_strobeBody`,tick:`_9mHjaq_tick`,tickLabel:`_9mHjaq_tickLabel`,tooltip:`_9mHjaq_tooltip`,tooltipLabel:`_9mHjaq_tooltipLabel`,tooltipRow:`_9mHjaq_tooltipRow`,tooltipValue:`_9mHjaq_tooltipValue`};const Jt=e=>(e.codePointAt(0)>11904?1:.62)*11.5;function Yt(e,t){if(e.length===0)return{lines:[],width:0,height:0};let n=Math.max(12,t-24),r=[],i=0;return e.forEach((e,t)=>{let a=``,o=0;for(let s of e){let e=Jt(s);a.length>0&&o+e>n&&(r.push({text:a,title:t===0}),i=Math.max(i,o),a=``,o=0),a+=s,o+=e}r.push({text:a,title:t===0}),i=Math.max(i,o)}),{lines:r,width:i+24,height:20+r.length*16}}const H={left:46,bottom:36,top:18,right:24},Xt={width:720,height:405},Zt=[0,45,90,135,180,225,270,315];function Qt({view:e,ariaLabel:t,trajectoryTimes:n,sampleReadout:r,onSeekTime:i,componentDrag:a,componentControl:o,componentWiring:s,effects:c,clockTime:l}){let u=(0,_.useId)().replace(/:/g,``),d=(0,_.useRef)(null),f=(0,_.useRef)(null),[p,m]=(0,_.useState)(null),[h,g]=(0,_.useState)({width:Xt.width+H.left+H.right,height:Xt.height+H.top+H.bottom}),[v,y]=(0,_.useState)(void 0),x=(0,_.useRef)(null),[S,C]=(0,_.useState)(!1),w=(0,_.useRef)(!1);(0,_.useEffect)(()=>{let e=f.current;if(e===null||typeof ResizeObserver>`u`)return;let t=()=>{let t=e.getBoundingClientRect();t.width<1||t.height<1||g(e=>Math.abs(e.width-t.width)<.5&&Math.abs(e.height-t.height)<.5?e:{width:t.width,height:t.height})};t();let n=new ResizeObserver(t);return n.observe(e),()=>{n.disconnect()}},[]);let T={width:Math.max(120,h.width-H.left-H.right),height:Math.max(90,h.height-H.top-H.bottom)},E=(0,_.useMemo)(()=>{let t=T.width/Math.max(e.extent.width,1e-6),n=T.height/Math.max(e.extent.height,1e-6);return Math.min(t,n)},[T.width,T.height,e.extent.width,e.extent.height]),D=T.width,ee=T.height,te=(D-e.extent.width*E)/2,ne=(ee-e.extent.height*E)/2,O=D+H.left+H.right,k=ee+H.top+H.bottom,re=H.top+ee-ne,A=(0,_.useMemo)(()=>{let t=t=>H.left+te+(t.x-e.origin.x)*E,n=t=>re-(t.y-e.origin.y)*E;return{px:t,py:n,sx:t=>e.origin.x+(t-H.left-te)/E,sy:t=>e.origin.y+(re-t)/E,scale:E,uid:u,path:e=>e.map((e,r)=>`${r===0?`M`:`L`}${t(e).toFixed(2)} ${n(e).toFixed(2)}`).join(` `),highlighted:t=>e.highlighted?.includes(t)===!0}},[E,te,re,u,e.origin.x,e.origin.y,e.highlighted]),ie=e.grid.minor*E,ae=e.grid.major*E,oe=`pc-minor-${u}`,M=`pc-major-${u}`,se=`pc-clip-${u}`,N=(0,_.useMemo)(()=>{let t=e.tickStep;if(t===void 0||t<=0)return{x:[],y:[]};let n=[],r=[],i=t<1?Math.max(1,-Math.floor(Math.log10(t))):0,a=e.origin.x+e.extent.width,o=e.origin.y+e.extent.height,s=e.tickLabelAvoid,c=(e,t)=>t!==void 0&&e>t[0]&&e<t[1]?``:e.toFixed(i);for(let r=Math.ceil(e.origin.x/t)*t;r<=a+1e-9;r+=t)n.push({at:A.px({x:r,y:0}),label:c(r,s?.x)});for(let n=Math.ceil(e.origin.y/t)*t;n<=o+1e-9;n+=t)r.push({at:A.py({x:0,y:n}),label:c(n,s?.y)});return{x:n,y:r}},[e.tickStep,e.tickLabelAvoid,e.extent.width,e.extent.height,e.origin.x,e.origin.y,A]),ce=Math.min(H.left+D,Math.max(H.left,A.px({x:0,y:0}))),le=Math.min(re,Math.max(H.top,A.py({x:0,y:0}))),ue=(0,_.useMemo)(()=>{let t=e.trajectories[0];if(t===void 0)return;let n=e.trajectories.filter(e=>e.id===t.id),r=[...n.filter(e=>e.kind===`history`).flatMap(e=>e.points),...n.filter(e=>e.kind===`predicted`).flatMap(e=>e.points)];return{id:t.id,points:r}},[e.trajectories]),de=ue!==void 0&&n!==void 0&&n.length===ue.points.length,fe=(0,_.useCallback)(e=>{if(ue===void 0)return null;let t=d.current?.getBoundingClientRect();if(t===void 0||t.width===0)return null;let n=(e.clientX-t.left)/t.width*O,r=(e.clientY-t.top)/t.height*k,i=-1,a=1/0;return ue.points.forEach((e,t)=>{let o=Math.hypot(A.px(e)-n,A.py(e)-r);o<a&&(a=o,i=t)}),a<=26?i:null},[ue,A,O,k]),pe=(0,_.useCallback)(e=>{if(x.current!==null||!de)return;let t=fe(e);if(t===null){m(null);return}let i=ue.points[t],a=n[t];i===void 0||a===void 0||m({time:a,screen:{xRatio:A.px(i)/O,yRatio:A.py(i)/k},rows:r?.(t)??[]})},[de,ue,n,fe,A,O,k,r]),me=(0,_.useCallback)(e=>{if(w.current){w.current=!1;return}if(!de||i===void 0)return;let t=fe(e);if(t===null)return;let r=n[t];r!==void 0&&i(r)},[de,n,i,fe]),he=qt[e.domain],P=(0,_.useMemo)(()=>{if(!de||l===void 0)return[];let t=e.bodies.find(e=>e.live===!0),r=e.particles[0],i=t===void 0?r===void 0?0:r.radius*E:t.size*E;if(i<=0)return[];let a=n[n.length-1]??0;if(a<=0)return[];let o=a/12,s=[],c=o;for(let[e,r]of n.entries()){if(r>l+1e-9)break;if(r+1e-9<c)continue;let n=ue.points[e];n!==void 0&&(s.push({x:A.px(n),y:A.py(n),r:i,kind:t===void 0?`particle`:t.kind,rotation:t?.rotation??0}),c+=o)}return s},[de,l,e.bodies,e.particles,E,n,ue,A]),ge=Yt(e.overlay.readout,D-24),F=ge.width,_e=ge.height,ve=v===void 0?{x:H.left+8,y:H.top+8}:{x:Math.min(Math.max(v.x,4),O-F-4),y:Math.min(Math.max(v.y,4),k-_e-4)},ye=e=>{let t=d.current?.getBoundingClientRect();if(!(t===void 0||t.width===0||t.height===0))return{x:(e.clientX-t.left)/t.width*O,y:(e.clientY-t.top)/t.height*k}},I=e=>{let t=ye(e);t!==void 0&&(typeof e.currentTarget.setPointerCapture==`function`&&e.currentTarget.setPointerCapture(e.pointerId),x.current={pointerId:e.pointerId,grabX:t.x-ve.x,grabY:t.y-ve.y,downX:t.x,downY:t.y,moved:!1},e.stopPropagation())},L=e=>{let t=x.current;if(t===null||e.pointerId!==t.pointerId)return;let n=ye(e);if(n!==void 0){if(!t.moved){if(Math.hypot(n.x-t.downX,n.y-t.downY)<2)return;t.moved=!0,C(!0)}y({x:Math.min(Math.max(n.x-t.grabX,4),O-F-4),y:Math.min(Math.max(n.y-t.grabY,4),k-_e-4)}),e.stopPropagation()}},be=e=>{let t=x.current;t===null||e.pointerId!==t.pointerId||(x.current=null,C(!1),w.current=!0)},xe=e=>{x.current?.pointerId===e.pointerId&&(x.current=null,C(!1))};return(0,j.jsxs)(`div`,{className:V.host,ref:f,children:[(0,j.jsxs)(`svg`,{ref:d,className:(0,b.default)(V.root,de&&V.interactive),viewBox:`0 0 ${O.toFixed(1)} ${k.toFixed(1)}`,preserveAspectRatio:`xMidYMid meet`,fill:`none`,role:`img`,"aria-label":t,onMouseMove:pe,onMouseLeave:()=>{m(null)},onClick:me,children:[(0,j.jsxs)(`defs`,{children:[(0,j.jsx)(`pattern`,{id:oe,width:ie,height:ie,patternUnits:`userSpaceOnUse`,children:(0,j.jsx)(`path`,{d:`M${ie} 0H0V${ie}`,fill:`none`,className:V.gridMinor})}),(0,j.jsx)(`pattern`,{id:M,width:ae,height:ae,patternUnits:`userSpaceOnUse`,children:(0,j.jsx)(`path`,{d:`M${ae} 0H0V${ae}`,fill:`none`,className:V.gridMajor})}),(0,j.jsx)(`clipPath`,{id:se,children:(0,j.jsx)(`rect`,{x:H.left,y:H.top,width:D,height:ee})}),(0,j.jsxs)(`radialGradient`,{id:`pc-ball-${u}`,cx:`36%`,cy:`32%`,r:`72%`,children:[(0,j.jsx)(`stop`,{offset:`0%`,className:V.ballHighlight}),(0,j.jsx)(`stop`,{offset:`55%`,className:V.ballMid}),(0,j.jsx)(`stop`,{offset:`100%`,className:V.ballShade})]})]}),(0,j.jsx)(`rect`,{x:H.left,y:H.top,width:D,height:ee,className:V.plot}),(0,j.jsx)(`rect`,{x:H.left,y:H.top,width:D,height:ee,fill:`url(#${oe})`,opacity:`0.7`}),(0,j.jsx)(`rect`,{x:H.left,y:H.top,width:D,height:ee,fill:`url(#${M})`,opacity:`0.38`}),e.axes.x.length===0?null:(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`line`,{className:V.axis,x1:H.left,y1:le,x2:H.left+D,y2:le}),N.x.map(e=>(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`line`,{className:V.tick,x1:e.at,y1:le,x2:e.at,y2:le+4}),e.label===``?null:(0,j.jsx)(`text`,{className:V.tickLabel,x:e.at,y:le+15,textAnchor:`middle`,children:e.label})]},`tx-${e.at}`)),(0,j.jsx)(`text`,{className:V.axisLabel,x:H.left+D,y:Math.min(re+29,le+29),textAnchor:`end`,children:e.axes.x})]}),e.axes.y.length===0?null:(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`line`,{className:V.axis,x1:ce,y1:re,x2:ce,y2:H.top}),N.y.map(e=>(0,j.jsxs)(`g`,{children:[(0,j.jsx)(`line`,{className:V.tick,x1:ce-4,y1:e.at,x2:ce,y2:e.at}),e.label===``?null:(0,j.jsx)(`text`,{className:V.tickLabel,x:ce-7,y:e.at+3.4,textAnchor:`end`,children:e.label})]},`ty-${e.at}`)),(0,j.jsx)(`text`,{className:V.axisLabel,x:Math.min(ce+8,H.left+D-36),y:H.top+12,textAnchor:`start`,children:e.axes.y})]}),P.length===0?null:(0,j.jsx)(`g`,{clipPath:`url(#${se})`,className:V.strobe,"aria-hidden":`true`,children:P.map((e,t)=>e.kind===`block`||e.kind===`cart`?(0,j.jsx)(`rect`,{className:V.strobeBody,x:e.x-e.r,y:e.y-e.r,width:e.r*2,height:e.r*2,rx:e.r*.18,transform:e.rotation===0?void 0:`rotate(${-e.rotation} ${e.x} ${e.y})`,style:{opacity:.16+t/Math.max(1,P.length)*.22}},t):(0,j.jsx)(`circle`,{className:V.strobeBody,cx:e.x,cy:e.y,r:e.r,style:{opacity:.16+t/Math.max(1,P.length)*.22}},t))}),(0,j.jsx)(`g`,{clipPath:`url(#${se})`,children:(0,j.jsx)(he,{view:e,projection:A,...l===void 0?{}:{time:l},...a===void 0?{}:{componentDrag:a},...o===void 0?{}:{componentControl:o},...s===void 0?{}:{componentWiring:s}})}),c===void 0||c.length===0?null:(0,j.jsx)(`g`,{clipPath:`url(#${se})`,className:V.effects,"aria-hidden":`true`,children:c.map(e=>{let t=A.px(e.at),n=A.py(e.at),r=e.kind===`impact`?V.effectImpact:e.kind===`boundary`?V.effectBoundary:V.effectMark;return(0,j.jsxs)(`g`,{className:(0,b.default)(V.effect,r),"data-physicsos-effect":e.kind,children:[(0,j.jsx)(`circle`,{className:V.effectRing,cx:t,cy:n,r:`6`}),(0,j.jsx)(`circle`,{className:(0,b.default)(V.effectRing,V.effectRingLate),cx:t,cy:n,r:`6`}),(0,j.jsx)(`circle`,{className:V.effectCore,cx:t,cy:n,r:`3`}),e.kind===`impact`?Zt.map(e=>(0,j.jsx)(`g`,{transform:`rotate(${e} ${t.toFixed(2)} ${n.toFixed(2)})`,children:(0,j.jsx)(`line`,{className:V.effectRay,x1:t,y1:n-4,x2:t,y2:n-12})},e)):null]},e.key)})}),e.overlay.readout.length===0?null:(0,j.jsxs)(`g`,{className:(0,b.default)(V.readoutDraggable,S?V.readoutDragging:void 0),onPointerDown:I,onPointerMove:L,onPointerUp:be,onPointerCancel:xe,children:[(0,j.jsx)(`title`,{children:`拖动调整读数卡片位置`}),(0,j.jsx)(`rect`,{className:V.readoutPanel,x:ve.x,y:ve.y,width:F,height:_e,rx:`8`}),ge.lines.map((e,t)=>(0,j.jsx)(`text`,{className:e.title?V.readoutTitle:V.readoutLine,x:ve.x+12,y:ve.y+19+t*16,children:e.text},t))]}),(0,j.jsx)(`g`,{children:e.overlay.scale.label.length===0||e.axes.x.length===0&&e.axes.y.length===0?null:(()=>{let t=e.overlay.scale.length*E,n=H.left+D-18,r=n-t,i=re-16;return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`line`,{className:V.scaleBar,x1:r,y1:i,x2:n,y2:i}),(0,j.jsx)(`line`,{className:V.scaleBar,x1:r,y1:i-4,x2:r,y2:i+4}),(0,j.jsx)(`line`,{className:V.scaleBar,x1:n,y1:i-4,x2:n,y2:i+4}),(0,j.jsx)(`text`,{className:V.scaleLabel,x:n,y:i-7,textAnchor:`end`,children:e.overlay.scale.label})]})})()})]}),p===null?null:(0,j.jsx)(`div`,{className:V.tooltip,style:{left:`${p.screen.xRatio*100}%`,top:`${p.screen.yRatio*100}%`},role:`status`,children:p.rows.map(e=>(0,j.jsxs)(`span`,{className:V.tooltipRow,children:[(0,j.jsx)(`span`,{className:V.tooltipLabel,children:e.label}),(0,j.jsx)(`span`,{className:V.tooltipValue,children:e.value})]},e.label))})]})}function $t(){document.head.querySelector(`style[data-physicsos-chrome]`)?.remove();let e=document.createElement(`style`);return e.setAttribute(`data-physicsos-chrome`,``),e.textContent=`
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
`,document.head.appendChild(e),()=>{e.remove()}}let en,tn;var nn=class extends _.Component{state={failed:!1};static getDerivedStateFromError(){return{failed:!0}}componentDidCatch(e){tn=e}render(){return this.state.failed?_.createElement(`p`,{role:`alert`},`Renderer failed`):this.props.children}};function rn(e){if(en||=($t(),(0,y.createRoot)(document.getElementById(`canvas`))),tn=void 0,(0,v.flushSync)(()=>en.render(_.createElement(nn,{key:e.revision},_.createElement(Qt,{view:e.view,ariaLabel:e.ariaLabel,trajectoryTimes:e.trajectoryTimes,clockTime:e.clock.time})))),tn)throw tn}export{rn as renderPlatformFrame};