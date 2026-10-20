import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initializeDesktopStorage } from './db/desktopStorage';
import './styles/app.css';

initializeDesktopStorage().then(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)).catch((error: unknown) => {
  document.getElementById('root')!.textContent = `无法加载本地数据，现有文件未被修改：${error instanceof Error ? error.message : String(error)}`;
});
