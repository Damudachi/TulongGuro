import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { startThemeSync } from './utils/theme'

// The pre-paint script in index.html has already set the theme attribute, so
// this is not what avoids the flash. What it adds is the listener that keeps a
// "follow my system" preference following it — a phone switching to night mode
// at sunset should take the app with it, without a reload.
startThemeSync()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
