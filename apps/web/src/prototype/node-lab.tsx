import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NodeLab } from './NodeLab';
import './node-lab.css';

/** CP6 Gate 1 prototype page (node-lab.html); separate from the application on purpose. */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NodeLab />
  </StrictMode>,
);
