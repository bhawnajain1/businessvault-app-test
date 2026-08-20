import { Outlet } from 'react-router-dom';

export default function AppShell() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 px-4 py-3 font-semibold">BusinessVault</header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
