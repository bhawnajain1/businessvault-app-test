import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import StorageBootBanner from './StorageBootBanner';
import { BackupHealthProvider } from './BackupHealthContext';

export default function AppShell() {
  return (
    <BackupHealthProvider>
      <div className="flex h-screen flex-col bg-app text-fg">
        <Header />
        <StorageBootBanner />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto bg-app">
            <Outlet />
          </main>
        </div>
      </div>
    </BackupHealthProvider>
  );
}
