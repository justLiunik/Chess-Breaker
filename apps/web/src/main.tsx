import { createRoot } from 'react-dom/client';
import { App } from './App';
import { workerSource } from './state/workerSource';
import './styles.css';

const el = document.getElementById('root');
if (!el) throw new Error('missing #root element');
createRoot(el).render(<App source={workerSource()} />);
