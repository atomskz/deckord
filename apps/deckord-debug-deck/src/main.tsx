import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/global.css';

// NOTE: intentionally NOT wrapped in <StrictMode>. StrictMode's dev-only
// double-mount opens the WebSocket twice (connect → cleanup-close → reconnect),
// which on some setups leaves a half-open "zombie" connection and a reconnect
// churn where the live socket never stabilizes on its snapshot. A single mount
// gives one clean, stable connection.
const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(<App />);
