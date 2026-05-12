import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import RosDashboard from './Dashboard.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RosDashboard />
  </StrictMode>,
)
