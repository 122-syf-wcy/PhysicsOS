const app = document.querySelector('#app')

if (app !== null) {
  app.dataset.runtime = '__TAURI__' in globalThis ? 'desktop' : 'web'
}
