import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/cormorant-garamond/latin-300.css';
import '@fontsource/cormorant-garamond/latin-400.css';
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-400-italic.css';
import '@fontsource/jost/latin-300.css';
import '@fontsource/jost/latin-400.css';
import '@fontsource/jost/latin-500.css';
import './styles/invitation.css';
import InvitationPage from './pages/InvitationPage';

const AdminApp = lazy(() => import('./admin/AdminApp'));
const staticDemo = import.meta.env.VITE_STATIC_DEMO === '1';

function route() {
  if (staticDemo) {
    // Maqueta: muestra la vista personal con una familia de ejemplo; #general, la página general.
    return <InvitationPage token={location.hash === '#general' ? null : 'demo'} staticDemo />;
  }
  const path = location.pathname.replace(/\/+$/, '');
  if (path === '/admin' || path.startsWith('/admin/')) {
    return (
      <Suspense fallback={null}>
        <AdminApp />
      </Suspense>
    );
  }
  // Cualquier /i/<algo> es un enlace personal; el servidor decide si existe.
  const m = path.match(/^\/i\/([^/]+)$/);
  return <InvitationPage token={m ? decodeURIComponent(m[1]) : null} />;
}

createRoot(document.getElementById('root')!).render(<StrictMode>{route()}</StrictMode>);
