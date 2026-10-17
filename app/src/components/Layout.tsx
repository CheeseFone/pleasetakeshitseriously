import { NavLink, Outlet, Link } from 'react-router-dom'
import { Users, Flask, Cog, Activity } from './icons'

const nav = [
  { to: '/', label: 'Residents', Icon: Users },
  { to: '/playground', label: 'Playground', Icon: Flask },
  { to: '/settings', label: 'Settings', Icon: Cog },
]

export default function Layout() {
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="bg-navy-800 text-white sticky top-0 z-30 shadow">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center gap-4">
          <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight text-lg">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded bg-teal-500 text-navy-900"><Activity size={20} /></span>
            <span className="whitespace-nowrap">Take Shit Seriously</span>
            <span className="hidden md:inline text-xs font-normal text-navy-100/80 ml-1">Bowel health early-warning · Sunrise Manor, Unit 2</span>
          </Link>
          <nav className="ml-auto flex items-center gap-1 text-sm">
            {nav.map(n => (
              <NavLink key={n.to} to={n.to} end={n.to === '/'} title={n.label} className={({ isActive }) => `inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded min-h-[36px] ${isActive && !n.to.includes('?') ? 'bg-navy-900/60 text-white' : 'text-navy-100 hover:bg-navy-700'}`}>
                <n.Icon size={17} /><span className="hidden sm:inline">{n.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-4 pb-10">
        <Outlet />
      </main>
      <footer className="border-t border-line bg-white text-[11px] text-muted px-4 py-2 text-center">
        Decision support only, not a diagnosis. Stool photos never leave this device. <a href="/settings" className="underline">Privacy & credits</a>
      </footer>
    </div>
  )
}
