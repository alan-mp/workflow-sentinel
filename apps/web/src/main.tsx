import { createRoot } from 'react-dom/client';
import '@fontsource-variable/public-sans/index.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);
