import React from 'react'
import ReactDOM from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css'
import Router from './components/router'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Router url={window.location.pathname} params={new URLSearchParams(window.location.search)} />
  </React.StrictMode>
)