import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowUpRight, BarChart3, Bell, Bot,
  CalendarDays, Check, ChevronDown, CircleDollarSign, Clock3, Eye, Filter,
  History, LayoutDashboard, LogOut, Mail, Menu, Minus, MoreHorizontal, Package,
  PackagePlus, Pencil, Plus, Search, Send, Settings, ShoppingCart, Sparkles,
  Trash2, Truck, X, EyeOff,
} from 'lucide-react'
import { api, loadWorkspace } from './lib/api'
import { readStoredData, riceCatalog } from './data/demo'
import './App.css'

const nav = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Products', icon: Package },
  { label: 'Sales', icon: ShoppingCart },
  { label: 'Inventory', icon: PackagePlus },
  { label: 'Suppliers', icon: Truck },
  { label: 'Reports', icon: BarChart3 },
  { label: 'AI Assistant', icon: Bot },
]
const pagePaths = { Products: '/products', Suppliers: '/suppliers' }
const money = (amount) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(Number(amount || 0))
const number = (value) => new Intl.NumberFormat('en-PH').format(Number(value || 0))
const shortDate = (value) => new Date(value).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
const dateTime = (value) => new Date(value).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const dateInputValue = (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
const roleLabel = (role) => {
  const normalizedRole = role?.toLowerCase()
  if (normalizedRole === 'staff') return 'Staff'
  return 'Administrator'
}
const getId = (items) => Math.max(0, ...items.map((item) => Number(item.id) || 0)) + 1
const PAGE_SIZE = 10
const assistantWelcome = 'Hi! Ask me about FullStock features and workflows, or ask for details from your products, stock, sales, suppliers, and inventory history.'

function assistantOwnerKey(session) {
  const identity = session?.user?.id ?? session?.user?.email
  return identity ? String(identity).trim().toLowerCase() : null
}

function createAssistantConversation() {
  return {
    id: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: 'New chat',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pending: false,
    messages: [{ role: 'assistant', text: assistantWelcome }],
  }
}

function loadAssistantStore(session) {
  const owner = assistantOwnerKey(session)
  if (!owner) return { owner: null, activeId: null, conversations: [] }

  try {
    const saved = JSON.parse(localStorage.getItem(`fullstock_ai_chats:${encodeURIComponent(owner)}`) || 'null')
    const conversations = Array.isArray(saved?.conversations)
      ? saved.conversations.filter((chat) => chat && typeof chat.id === 'string' && Array.isArray(chat.messages)).slice(0, 20)
      : []
    if (conversations.length) {
      return {
        owner,
        activeId: conversations.some((chat) => chat.id === saved.activeId) ? saved.activeId : conversations[0].id,
        conversations: conversations.map((chat) => {
          const messages = [...chat.messages]
          const lastIndex = messages.length - 1
          if (chat.pending && messages[lastIndex]?.role === 'assistant') {
            const text = messages[lastIndex].text || 'This response was interrupted. Please ask again.'
            messages[lastIndex] = { ...messages[lastIndex], text, isError: !messages[lastIndex].text }
          }
          return { ...chat, messages, pending: false, pendingSince: null }
        }),
      }
    }
  } catch { /* Start with a fresh conversation if saved history cannot be read. */ }

  const initial = createAssistantConversation()
  return { owner, activeId: initial.id, conversations: [initial] }
}

function paginate(items, page) {
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  return { rows: items.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE), page: currentPage, pages }
}

function SmartLogo({ light = false, size = 'normal', animated = false }) {
  const nameClass = animated ? 'brand-name-animation' : ''
  return <div className={'brand-lockup ' + (light ? 'brand-light ' : '') + size}>
    <div className="brand-mark"><Package size={19} strokeWidth={2.1} /></div>
    <div><strong className={nameClass} aria-label="FullStock">{animated ? <span aria-hidden="true">FullStock</span> : 'FullStock'}</strong>{size === 'large' && <span>Manage. Track. Grow.</span>}</div>
  </div>
}

function LoginScreen({ onLogin, onForgotPassword, onResetPassword, onSetupAdministrator, onSubmitPasswordResetRequest }) {
  const [mode, setMode] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('token') && params.get('email') ? 'reset' : 'login'
  })
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.search).get('token') || '')
  const [email, setEmail] = useState(() => new URLSearchParams(window.location.search).get('email') || '')
  const [name, setName] = useState('')
  const [setupKey, setSetupKey] = useState('')
  const [setupAvailable, setSetupAvailable] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [formMessage, setFormMessage] = useState(null)
  const [requestNote, setRequestNote] = useState('')
  useEffect(() => {
    api.setupStatus().then((result) => setSetupAvailable(Boolean(result.setup_available))).catch(() => {})
  }, [])
  const resettingPassword = mode === 'reset'
  const contactingAdmin = mode === 'contactAdmin'
  const settingUpAdministrator = mode === 'setup'
  const showPasswordField = mode === 'login' || resettingPassword || settingUpAdministrator
  const switchMode = (nextMode) => {
    setMode(nextMode)
    setFormMessage(null)
    setPasswordConfirmation('')
    if (nextMode !== 'reset') {
      setResetToken('')
      window.history.replaceState({}, '', window.location.pathname)
    }
    if (['forgot', 'reset', 'contactAdmin'].includes(nextMode)) { setPassword(''); setShowPassword(false) }
  }

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setFormMessage(null)
    try {
      if (contactingAdmin) {
        const result = await onSubmitPasswordResetRequest({ email, message: requestNote })
        setFormMessage({ type: 'success', text: result.message })
      } else if (mode === 'forgot') {
        const result = await onForgotPassword(email)
        const localMail = result?.delivery_mode === 'log'
        setFormMessage({
          type: localMail ? 'info' : 'success',
          text: localMail
            ? 'No email was sent. On Render, open fullstock-api → Logs and search for the password reset message. If no reset link appears, this email is not an account in the live database.'
            : 'If an account exists for this email, a password reset link has been sent. The link expires in 60 minutes.',
        })
      } else if (resettingPassword) {
        await onResetPassword({ email, token: resetToken, password, password_confirmation: passwordConfirmation })
        switchMode('login')
        setPassword('')
        setFormMessage({ type: 'success', text: 'Your password has been reset. Sign in with your new password.' })
      } else if (settingUpAdministrator) {
        await onSetupAdministrator({ setup_key: setupKey, name, email, password, password_confirmation: passwordConfirmation })
        await onLogin(email, password)
      } else {
        await onLogin(email, password)
      }
    } catch (error) {
      setFormMessage({ type: 'error', text: error.message || 'Unable to complete your request.' })
    } finally { setBusy(false) }
  }

  const heading = contactingAdmin
      ? ['Contact an administrator', 'Request a password reset for your staff account.']
      : mode === 'forgot'
      ? ['Forgot your password?', 'Enter your email and we’ll send a secure reset link.']
      : mode === 'reset'
        ? ['Reset your password', 'Choose a new password for your account.']
        : settingUpAdministrator
          ? ['Set up your administrator account', 'Create the first administrator for this live workspace. Setup closes after this account is created.']
          : ['Welcome back', 'Log in to your account to continue.']

  return <div className="login-screen">
    <section className="login-brand-panel">
      <div className="login-panel-top"><SmartLogo light size="large" animated /><span className="login-orbit orbit-one" /><span className="login-orbit orbit-two" /></div>
      <div className="login-brand-copy">
        <span className="eyebrow">SMART INVENTORY, SIMPLIFIED</span>
        <h1>Run your store<br />with confidence.</h1>
        <p>Keep every product, sale, and stock movement in one clear view.</p>
        <div className="login-mini-stat"><div className="mini-stat-icon"><BarChart3 size={17} /></div><div><strong>One view for your business</strong><span>Inventory insights that help you stay ahead.</span></div></div>
      </div>
      <div className="login-decoration"><div className="crate crate-large" /><div className="crate crate-small" /><div className="login-glow" /></div>
      <div className="login-panel-footer"><span>FULLSTOCK INVENTORY SUITE</span><span>01 / 01</span></div>
    </section>
    <section className="login-form-panel">
      <div className="login-mobile-brand"><SmartLogo animated /></div>
      <div className="login-form-wrap">
        <div className="login-heading"><span className="eyebrow">WELCOME TO FULLSTOCK</span><h2>{heading[0]}</h2><p>{heading[1]}</p></div>
        <form onSubmit={submit} className="login-form">
          {mode !== 'reset' && <label className="field-label">Email address<div className="input-shell"><Mail size={17} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" placeholder="name@example.com" /></div></label>}
          {contactingAdmin && ( <label className="field-label"> Message to administrator (optional) <textarea className="text-input" value={requestNote} onChange={(event) => setRequestNote(event.target.value)} maxLength={1000} rows={3} placeholder="Tell the administrator how they can verify your request." /> </label> )}
          {settingUpAdministrator && <label className="field-label">Full name<div className="input-shell"><input type="text" value={name} onChange={(event) => setName(event.target.value)} required autoComplete="name" placeholder="Your name" /></div></label>}
          {settingUpAdministrator && <label className="field-label">One-time setup key<div className="input-shell"><input type="password" value={setupKey} onChange={(event) => setSetupKey(event.target.value)} required autoComplete="off" placeholder="Paste the Render setup key" /></div></label>}
          {resettingPassword && <label className="field-label">Email address<div className="input-shell"><Mail size={17} /><input type="email" value={email} readOnly autoComplete="email" /></div></label>}
          {showPasswordField && <label className="field-label">{resettingPassword ? 'New password' : settingUpAdministrator ? 'Create a password' : 'Password'}<div className="input-shell"><input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={settingUpAdministrator ? 12 : resettingPassword ? 8 : undefined} autoComplete={resettingPassword || settingUpAdministrator ? 'new-password' : 'current-password'} placeholder={resettingPassword ? 'Enter a new password' : settingUpAdministrator ? 'Use at least 12 characters' : 'Enter your password'} /><button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>}
          {(resettingPassword || settingUpAdministrator) && <label className="field-label">Confirm password<div className="input-shell"><input type={showPassword ? 'text' : 'password'} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} required minLength={settingUpAdministrator ? 12 : 8} autoComplete="new-password" placeholder="Enter the password again" /></div></label>}
          {mode === 'login' && <div className="login-options"><label><input type="checkbox" defaultChecked /> Remember me</label><button type="button" className="link-button" onClick={() => switchMode('contactAdmin')}>Contact an administrator</button></div>}
          {formMessage && <p className={'auth-feedback auth-feedback-' + formMessage.type} role={formMessage.type === 'error' ? 'alert' : 'status'}>{formMessage.text}</p>}
          <button className="button button-primary button-wide" disabled={busy}>{busy ? 'Please wait…' : contactingAdmin ? 'Send request' : mode === 'forgot' ? 'Send reset link' : resettingPassword ? 'Save new password' : settingUpAdministrator ? 'Create administrator' : 'Log in'}<ArrowUpRight size={16} /></button>
        </form>
        {mode !== 'login' && <div className="login-switch">Remembered your password? <button type="button" className="link-button" onClick={() => switchMode('login')}>Back to log in</button></div>}
        {mode === 'login' && setupAvailable && <div className="login-switch">First time here? <button type="button" className="link-button" onClick={() => switchMode('setup')}>Set up administrator</button></div>}
      </div>
      <div className="login-footnote">© 2026 FullStock · Inventory and sales management</div>
    </section>
  </div>
}

function Sidebar({ active, onNavigate, onSignOut, mobileOpen, closeMobile, user, visibleNav, lowStockCount }) {
  return <>
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={closeMobile} />}
    <aside className={'sidebar ' + (mobileOpen ? 'sidebar-open' : '')}>
      <div className="sidebar-aurora" aria-hidden="true"><i className="aurora-ribbon aurora-ribbon-one" /><i className="aurora-ribbon aurora-ribbon-two" /><i className="aurora-ribbon aurora-ribbon-three" /></div>
      <div className="sidebar-brand"><SmartLogo light /><button className="mobile-close" aria-label="Close menu" onClick={closeMobile}><X size={18} /></button></div>
      <div className="nav-caption">WORKSPACE</div>
      <nav className="side-nav">
        {visibleNav.map(({ label, icon: Icon }) => <button key={label} className={'nav-item ' + (active === label ? 'nav-active' : '')} onClick={() => { onNavigate(label); closeMobile() }}><Icon size={18} strokeWidth={1.85} /><span>{label}</span>{label === 'Inventory' && lowStockCount > 0 && <i className="nav-badge">{lowStockCount}</i>}</button>)}
      </nav>
      <div className="sidebar-bottom">
        {['admin', 'administrator'].includes(user?.role?.toLowerCase()) && <><div className="nav-caption">PREFERENCES</div>
        <button className={'nav-item ' + (active === 'Settings' ? 'nav-active' : '')} onClick={() => onNavigate('Settings')}><Settings size={18} /><span>Settings</span></button></>}
        <div className="sidebar-help"><div className="help-icon">?</div><strong>Need a hand?</strong><span>Visit the help center</span><button onClick={() => onNavigate('Help')}>Get support <ArrowUpRight size={13} /></button></div>
        <button className="sidebar-user" aria-label="Log out" onClick={onSignOut}><div className="avatar avatar-small">{(user?.name || 'Admin').charAt(0).toUpperCase()}</div><div className="sidebar-user-copy"><strong>{user?.name || 'Admin'}</strong><span>{roleLabel(user?.role)}</span></div><LogOut size={16} /></button>
      </div>
    </aside>
  </>
}

function Topbar({ search, setSearch, openMenu, user, onNavigate, onSignOut, data }) {
  const [noticeOpen, setNoticeOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [activeSearchResult, setActiveSearchResult] = useState(-1)
  const searchRef = useRef(null)
  const userRole = user?.role?.toLowerCase()
  const isStaff = userRole === 'staff'
  const lowStockGroups = ['Short-Grain Rice', 'Medium-Grain Rice', 'Long-Grain Rice'].map((category) => ({
    category,
    products: data.products.filter((product) => String(product.category || '').trim().toLowerCase() === category.toLowerCase() && Number(product.stock) <= Number(product.reorder_level)),
  })).filter((group) => group.products.length > 0)
  const lowStockProductCount = lowStockGroups.reduce((total, group) => total + group.products.length, 0)
  const searchResults = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return []
    const results = data.products
      .filter((product) => `${product.name} ${product.id} ${product.category || ''}`.toLowerCase().includes(query))
      .map((product) => ({ key: `product-${product.id}`, label: product.name, detail: `ID ${product.id} · ${product.category || 'Uncategorized'} · ${number(product.stock)} in stock`, type: 'Product', page: 'Products', icon: Package }))
    results.push(...data.sales
      .filter((sale) => `${sale.number || sale.id} ${dateTime(sale.date)}`.toLowerCase().includes(query))
      .map((sale) => ({ key: `sale-${sale.id}`, label: `Sale #${sale.number || sale.id}`, detail: money(sale.total), type: 'Sale', page: 'Sales', icon: ShoppingCart })))
    if (!isStaff) {
      results.push(...data.suppliers
        .filter((supplier) => `${supplier.name} ${supplier.email || ''} ${supplier.contact || ''}`.toLowerCase().includes(query))
        .map((supplier) => ({ key: `supplier-${supplier.id}`, label: supplier.name, detail: supplier.email || supplier.contact || 'Supplier', type: 'Supplier', page: 'Suppliers', icon: Truck })))
    }
    return results.slice(0, 7)
  }, [data, isStaff, search])
  const chooseSearchResult = (result) => {
    onNavigate(result.page)
    setSearch(search)
    setSearchOpen(false)
    searchRef.current?.blur()
  }
  const handleSearchKeyDown = (event) => {
    if (event.key === 'ArrowDown' && searchResults.length) {
      event.preventDefault()
      setActiveSearchResult((index) => (index + 1) % searchResults.length)
    } else if (event.key === 'ArrowUp' && searchResults.length) {
      event.preventDefault()
      setActiveSearchResult((index) => index <= 0 ? searchResults.length - 1 : index - 1)
    } else if (event.key === 'Enter' && searchOpen && activeSearchResult >= 0) {
      event.preventDefault()
      chooseSearchResult(searchResults[activeSearchResult])
    } else if (event.key === 'Escape') {
      setSearchOpen(false)
    }
  }
  useEffect(() => {
    const focusSearch = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchRef.current?.focus(); setSearchOpen(true) }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])
  return <header className="topbar">
    <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={openMenu}><Menu size={20} /></button>
    {!isStaff && <div className="top-search-wrap" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false) }}>
      <div className="top-search"><Search size={16} /><input ref={searchRef} role="combobox" aria-label="Search FullStock" aria-autocomplete="list" aria-expanded={searchOpen && Boolean(search.trim())} aria-controls="global-search-results" aria-activedescendant={activeSearchResult >= 0 ? `search-result-${activeSearchResult}` : undefined} value={search} onFocus={() => setSearchOpen(true)} onKeyDown={handleSearchKeyDown} onChange={(event) => { setSearch(event.target.value); setActiveSearchResult(-1); setSearchOpen(true) }} placeholder="Search products, sales and records..." /><kbd>⌘ K</kbd></div>
      {searchOpen && search.trim() && <div className="search-results-panel" id="global-search-results" role="listbox" aria-label="Search results"><div className="search-results-heading">{searchResults.length ? 'Matching records' : 'No matching records'}</div>{searchResults.map((result, index) => { const Icon = result.icon; return <button id={`search-result-${index}`} key={result.key} type="button" role="option" aria-selected={activeSearchResult === index} className={'search-result ' + (activeSearchResult === index ? 'search-result-active' : '')} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSearchResult(result)}><span className="search-result-icon"><Icon size={16} /></span><span className="search-result-copy"><strong>{result.label}</strong><small>{result.detail}</small></span><span className="search-result-type">{result.type}</span></button>})}</div>}
    </div>}
    <div className="topbar-spacer" />
    <button className="icon-button notification-button" aria-label={lowStockProductCount ? `Notifications, ${lowStockProductCount} rice products need a stock check` : 'Notifications, no rice products are low stock'} aria-expanded={noticeOpen} aria-controls="stock-notifications" onClick={() => setNoticeOpen(!noticeOpen)}><Bell size={18} />{lowStockProductCount > 0 && <span className="notification-count">{lowStockProductCount > 99 ? '99+' : lowStockProductCount}</span>}</button>
    {noticeOpen && <div className="notification-popover" id="stock-notifications" role="region" aria-label="Rice stock notifications"><div className="notification-popover-heading"><strong>Rice stock alerts</strong><span>{lowStockProductCount} {lowStockProductCount === 1 ? 'item' : 'items'}</span></div>{lowStockGroups.length ? lowStockGroups.map((group) => <section className="notification-category" key={group.category}><h3>{group.category}</h3>{group.products.map((product) => { const stock = Number(product.stock); const isOut = stock <= 0; return <button className="notification-item" key={product.id} onClick={() => { setSearch(product.name); onNavigate(isStaff ? 'Products' : 'Inventory'); setNoticeOpen(false) }}><i className={'notification-status-dot ' + (isOut ? 'notification-status-out' : '')} /><span className="notification-item-copy"><strong>{product.name}</strong><small>{isOut ? 'Out of stock' : 'Low stock'} · {number(stock)} left · reorder at {number(product.reorder_level)}</small></span><ArrowUpRight size={14} /></button>})}</section>) : <p className="notification-empty"><Check size={15} /> No low-stock products in these rice categories.</p>}</div>}
    <div className="top-divider" />
    <div className="profile-menu-wrap"><button className="profile-button" aria-expanded={profileOpen} onClick={() => setProfileOpen(!profileOpen)}><span className="avatar">{(user?.name || 'Admin').charAt(0).toUpperCase()}</span><span className="profile-name">{user?.name || 'Admin'}<small>{roleLabel(user?.role)}</small></span><ChevronDown size={15} /></button>{profileOpen && <div className="profile-menu"><div className="profile-menu-person"><strong>{user?.name || 'Admin'}</strong><span>{user?.email}</span><small>{roleLabel(user?.role)}</small></div>{['admin', 'administrator'].includes(user?.role?.toLowerCase()) && <button onClick={() => { onNavigate('Settings'); setProfileOpen(false) }}><Settings size={15} /> Account settings</button>}<button className="profile-logout" onClick={() => { setProfileOpen(false); onSignOut() }}><LogOut size={15} /> Log out</button></div>}</div>
  </header>
}

function SectionHeading({ eyebrow, title, subtitle, action }) {
  return <div className="section-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action && <div className="heading-action">{action}</div>}</div>
}

function StatCard({ title, value, change, note, icon: Icon, tone = 'green' }) {
  return <article className="stat-card"><div className="stat-card-top"><span>{title}</span><span className={'stat-icon ' + tone}><Icon size={17} /></span></div><strong className="stat-value">{value}</strong><div className="stat-card-foot"><span className="stat-change">{change}</span><span>{note}</span></div></article>
}

function SalesChart({ sales, anchorDate }) {
  const selectedDay = new Date(anchorDate + 'T12:00:00')
  const monday = new Date(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate() - ((selectedDay.getDay() + 6) % 7))
  const days = Array.from({ length: 7 }, (_, index) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index))
  const values = days.map((day) => sales.reduce((sum, sale) => {
    const date = new Date(sale.date)
    return date.getFullYear() === day.getFullYear() && date.getMonth() === day.getMonth() && date.getDate() === day.getDate() ? sum + Number(sale.total || 0) : sum
  }, 0))
  const scale = Math.max(1000, Math.ceil(Math.max(...values) / 1000) * 1000)
  const points = values.map((value, index) => (42 + index * 73) + ',' + (158 - (value / scale) * 126)).join(' ')
  const area = '42,162 ' + points + ' 480,162'
  const labels = days.map((day) => new Intl.DateTimeFormat('en-PH', { weekday: 'short' }).format(day))
  const yLabels = [1, .75, .5, .25, 0].map((fraction) => money(scale * fraction))
  return <div className="sales-chart"><div className="chart-y-labels">{yLabels.map((label, index) => <span key={index}>{label}</span>)}</div><svg viewBox="0 0 525 182" role="img" aria-label="Daily sales trend for the current week" preserveAspectRatio="none"><defs><linearGradient id="sales-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity=".16" /><stop offset="100%" stopColor="#10b981" stopOpacity="0" /></linearGradient></defs>{[22,58,94,130,162].map((y) => <line key={y} x1="40" x2="500" y1={y} y2={y} className="chart-grid" />)}<polygon points={area} fill="url(#sales-fill)" /><polyline points={points} fill="none" className="sales-line" />{points.split(' ').map((point, i) => { const [cx, cy] = point.split(','); return <circle key={i} cx={cx} cy={cy} r="3.4" className="chart-point" /> })}</svg><div className="chart-x-labels">{labels.map((label, index) => <span key={index}>{label}</span>)}</div>{values.every((value) => value === 0) && <span className="chart-empty-label">No sales recorded this week</span>}</div>
}

function Dashboard({ data, user, onNavigate }) {
  const [selectedDate, setSelectedDate] = useState(() => dateInputValue(new Date()))
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const salesTotal = data.sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0)
  const lowStockProducts = data.products.filter((product) => Number(product.stock) <= Number(product.reorder_level))
  const lowStock = lowStockProducts.length
  const bestsellers = useMemo(() => {
    const sold = {}
    data.sales.forEach((sale) => (sale.items || []).forEach((item) => { sold[item.product_name] = (sold[item.product_name] || 0) + Number(item.quantity || 0) }))
    return Object.entries(sold).sort((a, b) => b[1] - a[1]).slice(0, 4)
  }, [data.sales])
  const selectedDateLabel = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(selectedDate + 'T12:00:00'))
  const salesForDate = data.sales.filter((sale) => dateInputValue(new Date(sale.date)) === selectedDate).reduce((sum, sale) => sum + Number(sale.total || 0), 0)
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const displayName = user?.name?.trim().split(/\s+/)[0] || 'Admin'
  const lowStockNames = lowStockProducts.slice(0, 2).map((product) => product.name).join(' and ')
  return <>
    <SectionHeading eyebrow="OVERVIEW" title={`${greeting}, ${displayName}`} subtitle="Here’s what’s happening with your business today." action={<div className="date-control"><button className="button button-outline" aria-expanded={datePickerOpen} onClick={() => setDatePickerOpen(!datePickerOpen)}><CalendarDays size={15} /> {selectedDateLabel} <ChevronDown size={14} /></button>{datePickerOpen && <div className="date-picker-popover"><label className="field-label">Dashboard date<input className="text-input" type="date" value={selectedDate} onChange={(event) => event.target.value && setSelectedDate(event.target.value)} /></label><button className="text-button" type="button" onClick={() => { setSelectedDate(dateInputValue(new Date())); setDatePickerOpen(false) }}>Go to today</button></div>}</div>} />
    <div className="stats-grid">
      <StatCard title="Total sales" value={money(salesTotal)} change="All time" note="recorded sales" icon={CircleDollarSign} />
      <StatCard title="Total products" value={number(data.products.length)} change="In catalog" note="current items" icon={Package} tone="blue" />
      <StatCard title="Low stock items" value={number(lowStock)} change="Needs review" note="at reorder level" icon={AlertTriangle} tone="amber" />
      <StatCard title="Sales on selected date" value={money(salesForDate)} change={selectedDateLabel} note="completed sales" icon={BarChart3} tone="violet" />
    </div>
    <div className="dashboard-grid dashboard-main-grid">
      <section className="panel chart-panel"><div className="panel-heading"><div><h2>Sales overview</h2><p>Daily sales for the selected week</p></div><span className="select-button select-static">Week of {selectedDateLabel}</span></div><SalesChart sales={data.sales} anchorDate={selectedDate} /></section>
      <section className="panel bestsellers-panel"><div className="panel-heading"><div><h2>Top selling products</h2><p>Based on units sold</p></div><button className="more-button" aria-label="More options"><MoreHorizontal size={18} /></button></div><div className="top-product-list">{bestsellers.length ? bestsellers.map(([name, quantity], index) => <div className="top-product" key={name}><span className={'product-thumb thumb-' + index}><Package size={16} /></span><span className="top-product-name">{name}</span><strong>{quantity}</strong></div>) : <div className="empty-inline">Your top products will appear here.</div>}</div><button className="button button-soft button-wide" onClick={() => onNavigate('Products')}>View all products <ArrowUpRight size={14} /></button></section>
    </div>
    <div className="dashboard-grid dashboard-lower-grid">
      <section className="panel recent-sales-panel"><div className="panel-heading"><div><h2>Recent sales</h2><p>Latest transactions from your store</p></div><button className="text-button" onClick={() => onNavigate('Sales')}>View all <ArrowUpRight size={14} /></button></div><SalesTable sales={data.sales.slice(0, 4)} compact /></section>
      <section className="panel insight-panel"><div className="panel-heading"><div className="insight-title"><span className="insight-icon"><Sparkles size={17} /></span><div><h2>AI business insight</h2><p>A quick read on your inventory</p></div><span className="ai-badge">AI INSIGHT</span></div><button className="more-button" aria-label="Open AI assistant" onClick={() => onNavigate('AI Assistant')}><ArrowUpRight size={16} /></button></div><div className="insight-copy"><strong>{lowStock ? lowStock + ' products need a stock check.' : 'Your stock levels look healthy.'}</strong><p>{lowStock ? `${lowStockNames}${lowStock > 2 ? ' and more' : ''} ${lowStock === 1 ? 'is' : 'are'} at or below the reorder level. Review restock priorities before placing an order.` : 'Your current products are above their reorder levels. Keep monitoring weekly sales.'}</p></div><button className="insight-link" onClick={() => onNavigate('AI Assistant')}>Open AI Assistant <ArrowUpRight size={14} /></button></section>
    </div>
  </>
}

function StatusPill({ product }) {
  const stock = Number(product.stock)
  const outOfStock = stock <= 0
  const low = stock <= Number(product.reorder_level)
  const statusClass = outOfStock ? 'status-out' : low ? 'status-low' : 'status-good'
  const label = outOfStock ? 'Out of stock' : low ? 'Low stock' : 'In stock'
  return <span className={'status-pill ' + statusClass}><i aria-hidden="true" />{label}</span>
}

function TableActions({ onEdit, onDelete, label }) {
  return <div className="table-actions"><button aria-label={'Edit ' + label} onClick={onEdit}><Pencil size={14} /></button><button aria-label={'Delete ' + label} className="delete-action" onClick={onDelete}><Trash2 size={14} /></button></div>
}

function ProductPage({ products, search, setSearch, onAdd, onManageStock, onEdit, onDelete, canManage = true }) {
  const [category, setCategory] = useState('All categories')
  const [status, setStatus] = useState('All status')
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [search, category, status])
  const categories = ['All categories', ...new Set(products.map((item) => item.category).filter(Boolean))]
  const shown = products.filter((item) => {
    const matches = `${item.name} ${item.id} ${item.category}`.toLowerCase().includes(search.toLowerCase())
    const byCategory = category === 'All categories' || item.category === category
    const low = Number(item.stock) <= Number(item.reorder_level)
    const byStatus = status === 'All status' || (status === 'Low stock' ? low : !low)
    return matches && byCategory && byStatus
  })
  const pages = paginate(shown, page)
  return <>
    <SectionHeading eyebrow="RICE CATALOG" title="Products" subtitle={canManage ? 'Manage your rice varieties. Set actual prices and stock before recording sales.' : 'Browse rice varieties and check current availability.'} action={canManage && <button className="button button-primary" onClick={onAdd}><Plus size={16} /> Add product</button>} />
    <div className="panel table-panel"><div className="table-toolbar"><div className="table-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products..." /></div><div className="toolbar-filters"><label className="filter-select"><Filter size={14} /><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((value) => <option key={value}>{value}</option>)}</select><ChevronDown size={13} /></label><label className="filter-select"><select value={status} onChange={(event) => setStatus(event.target.value)}><option>All status</option><option>In stock</option><option>Low stock</option></select><ChevronDown size={13} /></label></div></div>
      <div className="table-scroll"><table><thead><tr><th className="th-product-id">PRODUCT ID</th><th>PRODUCT</th><th>CATEGORY</th><th>PRICE</th><th>STOCK</th><th>STATUS</th>{canManage && <th className="th-actions">ACTIONS</th>}</tr></thead><tbody>{pages.rows.map((product) => <tr key={product.id}><td className="product-id-cell cell-strong font-mono">{product.id}</td><td><div className="table-product"><span className="table-product-thumb"><Package size={16} /></span><div><strong>{product.name}</strong></div></div></td><td>{product.category}</td><td className="cell-strong font-mono">{money(product.price)}</td><td className="cell-strong font-mono">{number(product.stock)}</td><td><StatusPill product={product} /></td>{canManage && <td><TableActions label={product.name} onEdit={() => onEdit(product)} onDelete={() => onDelete(product)} /></td>}</tr>)}</tbody></table></div>
      {shown.length === 0 && <EmptyState title="No products found" text="Try a different search or add a product to your catalog." />}
      <TableFooter count={shown.length} total={products.length} page={pages.page} pages={pages.pages} onPage={setPage} />
    </div>
  </>
}

function StaffPosPage({ products, search, setSearch, onCheckout }) {
  const [category, setCategory] = useState('All rice')
  const [cart, setCart] = useState([])
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const categories = ['All rice', ...new Set(products.map((product) => product.category).filter(Boolean))]
  const shown = products.filter((product) => {
    const matchesSearch = `${product.name} ${product.category || ''}`.toLowerCase().includes(search.toLowerCase())
    return matchesSearch && (category === 'All rice' || product.category === category)
  })
  const lines = cart.map((line) => {
    const product = products.find((item) => String(item.id) === String(line.productId))
    return product ? { product, quantity: line.quantity, total: Number(product.price || 0) * line.quantity } : null
  }).filter(Boolean)
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0)
  const total = lines.reduce((sum, line) => sum + line.total, 0)

  const addProduct = (product) => setCart((current) => {
    const found = current.find((line) => String(line.productId) === String(product.id))
    if (found) return current.map((line) => String(line.productId) === String(product.id) ? { ...line, quantity: Math.min(Number(product.stock), line.quantity + 1) } : line)
    return [...current, { productId: product.id, quantity: 1 }]
  })
  const updateQuantity = (product, quantity) => setCart((current) => {
    if (quantity <= 0) return current.filter((line) => String(line.productId) !== String(product.id))
    return current.map((line) => String(line.productId) === String(product.id) ? { ...line, quantity: Math.min(Number(product.stock), quantity) } : line)
  })
  const checkout = async () => {
    if (checkoutBusy || !lines.length) return
    setCheckoutBusy(true)
    try {
      if (await onCheckout({ items: lines })) setCart([])
    } finally {
      setCheckoutBusy(false)
    }
  }

  return <section className="staff-pos">
    <header className="pos-heading">
      <div><span className="eyebrow">STAFF REGISTER</span><h1>New sale</h1><p>Choose rice products, then review the order at checkout.</p></div>
      <div className="pos-shift-badge"><span aria-hidden="true" /> Register open</div>
    </header>
    <div className="staff-pos-layout">
      <section className="pos-catalog" aria-label="Product catalog">
        <div className="pos-catalog-toolbar">
          <div><h2>Rice catalog</h2><p>{number(shown.length)} {shown.length === 1 ? 'product' : 'products'} in catalog</p></div>
          <label className="pos-search"><Search size={16} /><input aria-label="Search rice products" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search rice..." /></label>
        </div>
        <div className="pos-categories" aria-label="Filter by rice category">{categories.map((value) => <button key={value} className={category === value ? 'pos-category-active' : ''} onClick={() => setCategory(value)}>{value}</button>)}</div>
        {shown.length ? <div className="pos-product-grid">{shown.map((product) => {
          const stock = Number(product.stock)
          const inCart = cart.find((line) => String(line.productId) === String(product.id))?.quantity || 0
          const canAdd = stock > inCart && Number(product.price) > 0
          return <article className={'pos-product-card' + (stock <= 0 ? ' pos-product-unavailable' : '')} key={product.id}>
            <div className="pos-product-top"><span className="pos-rice-mark"><Package size={19} /></span><span className={'pos-stock-tag' + (stock <= Number(product.reorder_level) ? ' pos-stock-low' : '')}>{stock > 0 ? `${number(stock)} units` : 'Out of stock'}</span></div>
            <div className="pos-product-copy"><span className="pos-product-category">{product.category || 'Rice'}</span><h3>{product.name}</h3></div>
            <div className="pos-product-bottom"><strong>{money(product.price)}</strong><button className="pos-add-button" disabled={!canAdd} onClick={() => addProduct(product)} aria-label={'Add ' + product.name + ' to cart'}>{inCart ? <Check size={15} /> : <Plus size={15} />}<span>{inCart ? `Add (${inCart})` : Number(product.price) > 0 ? 'Add' : 'Set price'}</span></button></div>
          </article>
        })}</div> : <div className="pos-empty-products"><Package size={22} /><strong>No rice products found</strong><span>Try another name or category.</span></div>}
      </section>

      <aside className="pos-cart" aria-label="Current sale">
        <div className="pos-cart-heading"><div><span className="pos-cart-kicker">CURRENT SALE</span><h2>Order</h2></div><span className="pos-cart-count">{number(itemCount)} {itemCount === 1 ? 'item' : 'items'}</span></div>
        {lines.length ? <div className="pos-cart-lines">{lines.map(({ product, quantity, total: lineTotal }) => <div className="pos-cart-line" key={product.id}>
          <div className="pos-cart-line-main"><strong>{product.name}</strong><span>{money(product.price)} each</span><b>{money(lineTotal)}</b></div>
          <div className="pos-quantity-control"><button aria-label={'Remove one ' + product.name} onClick={() => updateQuantity(product, quantity - 1)}>{quantity === 1 ? <Trash2 size={14} /> : <Minus size={14} />}</button><span>{quantity}</span><button aria-label={'Add one ' + product.name} disabled={quantity >= Number(product.stock)} onClick={() => updateQuantity(product, quantity + 1)}><Plus size={14} /></button></div>
        </div>)}</div> : <div className="pos-cart-empty"><span><ShoppingCart size={22} /></span><strong>Cart is ready</strong><p>Tap a product to add it to this sale.</p></div>}
        <div className="pos-cart-summary"><div><span>Items</span><strong>{number(itemCount)}</strong></div><div className="pos-total-row"><span>Total due</span><strong>{money(total)}</strong></div><p><Check size={13} /> Catalog prices are applied automatically.</p><button className="button button-primary pos-checkout-button" disabled={!lines.length || checkoutBusy} onClick={checkout}><ShoppingCart size={16} /> {checkoutBusy ? 'Saving sale…' : 'Complete sale'} <span>{money(total)}</span></button><button className="pos-clear-button" disabled={!lines.length || checkoutBusy} onClick={() => setCart([])}>Clear order</button></div>
      </aside>
    </div>
  </section>
}

function SalesPage({ sales, search, setSearch, onNewSale, onView, isStaff = false }) {
  const emptyRange = { fromDate: '', toDate: '', fromTime: '', toTime: '' }
  const [draftRange, setDraftRange] = useState(emptyRange)
  const [appliedRange, setAppliedRange] = useState(emptyRange)
  const [rangeOpen, setRangeOpen] = useState(false)
  const [rangeError, setRangeError] = useState('')
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [search, appliedRange])
  const from = appliedRange.fromDate ? new Date(`${appliedRange.fromDate}T${appliedRange.fromTime || '00:00'}:00`).getTime() : -Infinity
  const to = appliedRange.toDate ? new Date(`${appliedRange.toDate}T${appliedRange.toTime || '23:59'}:59.999`).getTime() : Infinity
  const shownSales = sales.filter((sale) => {
    const timestamp = new Date(sale.date).getTime()
    const matchesRange = timestamp >= from && timestamp <= to
    const searchable = `${sale.number || sale.id} ${dateTime(sale.date)}`.toLowerCase()
    return matchesRange && searchable.includes(search.toLowerCase())
  })
  const pages = paginate(shownSales, page)
  const updateRange = (key, value) => setDraftRange((current) => ({ ...current, [key]: value }))
  const applyRange = (event) => {
    event.preventDefault()
    const draftFrom = draftRange.fromDate ? new Date(`${draftRange.fromDate}T${draftRange.fromTime || '00:00'}:00`).getTime() : -Infinity
    const draftTo = draftRange.toDate ? new Date(`${draftRange.toDate}T${draftRange.toTime || '23:59'}:59.999`).getTime() : Infinity
    if (draftFrom > draftTo) { setRangeError('The end must be after the start.'); return }
    setRangeError('')
    setAppliedRange(draftRange)
    setPage(1)
    setRangeOpen(false)
  }
  const rangeLabel = appliedRange.fromDate || appliedRange.toDate
    ? `${appliedRange.fromDate ? shortDate(`${appliedRange.fromDate}T12:00:00`) + (appliedRange.fromTime ? ` ${appliedRange.fromTime}` : '') : 'Any date'} – ${appliedRange.toDate ? shortDate(`${appliedRange.toDate}T12:00:00`) + (appliedRange.toTime ? ` ${appliedRange.toTime}` : '') : 'Any date'}`
    : 'Date & time range'
  return <>
    <SectionHeading eyebrow="TRANSACTIONS" title="Sales" subtitle="Review transactions and record a new sale." action={<button className="button button-primary" onClick={onNewSale}>{isStaff ? <ShoppingCart size={16} /> : <Plus size={16} />}{isStaff ? 'Open register' : 'New sale'}</button>} />
    <div className="sales-summary-row"><div className="mini-metric"><span>Sales in view</span><strong>{number(shownSales.length)}</strong><small>Matching transactions</small></div><div className="mini-metric"><span>Gross sales</span><strong>{money(shownSales.reduce((sum, item) => sum + Number(item.total || 0), 0))}</strong><small>For current filters</small></div><div className="mini-metric"><span>Average sale</span><strong>{money(shownSales.length ? shownSales.reduce((sum, item) => sum + Number(item.total || 0), 0) / shownSales.length : 0)}</strong><small>Per transaction</small></div></div>
    <div className="panel table-panel"><div className="table-toolbar sales-toolbar"><div><h2 className="toolbar-title">All sales</h2><p className="toolbar-subtitle">Dates include transaction time</p><div className="table-search sales-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search sales..." /></div></div><div className="date-filter-wrap"><button className="button button-outline" aria-expanded={rangeOpen} onClick={() => { setDraftRange(appliedRange); setRangeOpen(!rangeOpen) }}><CalendarDays size={15} /> {rangeLabel} <ChevronDown size={13} /></button>{rangeOpen && <form className="date-filter-popover" onSubmit={applyRange}><strong>Filter sales by date and time</strong><p className="date-filter-hint">Leave a time blank to include the full selected day.</p><div className="date-filter-grid"><label className="field-label">From date<input className="text-input" type="date" value={draftRange.fromDate} onChange={(event) => updateRange('fromDate', event.target.value)} /></label><label className="field-label">From time<input className="text-input" type="time" value={draftRange.fromTime} onChange={(event) => updateRange('fromTime', event.target.value)} /></label><label className="field-label">To date<input className="text-input" type="date" value={draftRange.toDate} onChange={(event) => updateRange('toDate', event.target.value)} /></label><label className="field-label">To time<input className="text-input" type="time" value={draftRange.toTime} onChange={(event) => updateRange('toTime', event.target.value)} /></label></div>{rangeError && <p className="form-error">{rangeError}</p>}<div className="date-filter-actions"><button type="button" className="text-button" onClick={() => { setDraftRange(emptyRange); setAppliedRange(emptyRange); setRangeError(''); setPage(1); setRangeOpen(false) }}>Clear filters</button><button className="button button-primary button-small">Apply filters</button></div></form>}</div></div><SalesTable sales={pages.rows} onView={onView} /><TableFooter count={shownSales.length} total={sales.length} page={pages.page} pages={pages.pages} onPage={setPage} /></div>
  </>
}

function SalesTable({ sales, compact = false, onView }) {
  return <div className={'table-scroll ' + (compact ? 'compact-table' : '')}><table><thead><tr><th>SALE ID</th><th>DATE & TIME</th><th>ITEMS</th><th>TOTAL</th><th>STATUS</th>{!compact && <th className="th-actions">ACTIONS</th>}</tr></thead><tbody>{sales.map((sale) => <tr key={sale.id}><td className="cell-strong font-mono">#{sale.number || sale.id}</td><td>{dateTime(sale.date)}</td><td>{(sale.items || []).map((item) => item.product_name).join(', ') || '—'}</td><td className="cell-strong font-mono">{money(sale.total)}</td><td><span className="status-pill status-good"><i aria-hidden="true" />Completed</span></td>{!compact && <td><button className="icon-button table-view" aria-label={'View sale ' + (sale.number || sale.id)} onClick={() => onView?.(sale)}><Eye size={15} /></button></td>}</tr>)}</tbody></table>{sales.length === 0 && <EmptyState title={compact ? 'No sales yet' : 'No matching sales'} text={compact ? 'Record your first sale to see it listed here.' : 'Adjust the search or date/time filter to find a sale.'} />}</div>
}

function InventoryPage({ products, movements, search, setSearch, onRestock }) {
  const [category, setCategory] = useState('All categories')
  const [page, setPage] = useState(1)
  const [showAllMovements, setShowAllMovements] = useState(false)
  useEffect(() => setPage(1), [search, category])
  const categories = [...new Set(products.map((product) => product.category).filter(Boolean))]
  const filtered = products.filter((product) => `${product.name} ${product.id} ${product.category || ''}`.toLowerCase().includes(search.toLowerCase()) && (category === 'All categories' || product.category === category))
  const pages = paginate(filtered, page)
  return <>
    <SectionHeading eyebrow="STOCK CONTROL" title="Inventory" subtitle="Track on-hand quantities and keep stock moving." action={<button className="button button-outline" onClick={() => document.getElementById('movement-log')?.scrollIntoView({ behavior: 'smooth' })}><History size={15} /> View history</button>} />
    <div className="panel table-panel"><div className="table-toolbar"><div className="table-search"><Search size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search products..." /></div><div className="toolbar-filters"><label className="filter-select"><select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1) }}><option>All categories</option>{categories.map((value) => <option key={value}>{value}</option>)}</select><ChevronDown size={13} /></label></div></div><div className="table-scroll"><table><thead><tr><th>PRODUCT</th><th>CURRENT STOCK</th><th>REORDER LEVEL</th><th>STATUS</th><th className="th-actions">ACTION</th></tr></thead><tbody>{pages.rows.map((product) => <tr key={product.id}><td><div className="table-product"><span className="table-product-thumb"><Package size={16} /></span><div><strong>{product.name}</strong><small>{product.category}</small></div></div></td><td className="cell-strong font-mono">{number(product.stock)} <span className="muted-text">units</span></td><td className="font-mono">{number(product.reorder_level)} units</td><td><StatusPill product={product} /></td><td><button className="button button-soft button-small" onClick={() => onRestock(product)}><Plus size={13} /> Add stock</button></td></tr>)}</tbody></table></div>{filtered.length === 0 && <EmptyState title="No inventory found" text="Try a different search or category." />}<TableFooter count={filtered.length} total={products.length} page={pages.page} pages={pages.pages} onPage={setPage} /></div>
    <section className="panel movement-panel" id="movement-log"><div className="panel-heading"><div><h2>Stock movements</h2><p>Sales and inventory adjustments</p></div><button className="text-button" onClick={() => setShowAllMovements(!showAllMovements)}>{showAllMovements ? 'Show recent' : 'View all'} <ArrowUpRight size={14} /></button></div><MovementTable movements={showAllMovements ? movements : movements.slice(0, 5)} /></section>
  </>
}

function MovementTable({ movements }) {
  return <div className="table-scroll movement-table"><table><thead><tr><th>DATE</th><th>PRODUCT</th><th>TYPE</th><th>QUANTITY</th><th>REFERENCE</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id}><td>{shortDate(movement.date)}</td><td className="cell-strong">{movement.product_name}</td><td>{movement.type}</td><td className={'font-mono ' + (Number(movement.quantity) < 0 ? 'quantity-negative' : 'quantity-positive')}>{Number(movement.quantity) > 0 ? '+' : ''}{movement.quantity}</td><td>{movement.reference || 'Manual adjustment'}</td></tr>)}</tbody></table>{movements.length === 0 && <EmptyState title="No stock movements yet" text="Adjustments and completed sales will appear here." />}</div>
}

function EntityPage({ items, search, setSearch, onAdd, onEdit, onDelete }) {
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [search])
  const title = 'Suppliers'
  const shown = items.filter((item) => (item.name + ' ' + (item.contact || '')).toLowerCase().includes(search.toLowerCase()))
  const pages = paginate(shown, page)
  return <>
    <SectionHeading eyebrow="PARTNERS" title={title} subtitle="Keep supplier contacts and product sources up to date." action={<button className="button button-primary" onClick={onAdd}><Plus size={16} /> Add supplier</button>} />
    <div className="panel table-panel"><div className="table-toolbar"><div className="table-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search suppliers..." /></div></div><div className="table-scroll"><table><thead><tr><th>SUPPLIER</th><th>CONTACT</th><th>PRODUCTS SUPPLIED</th><th className="th-actions">ACTIONS</th></tr></thead><tbody>{pages.rows.map((item) => <tr key={item.id}><td><div className="table-product"><span className="person-avatar">{item.name.charAt(0)}</span><div><strong>{item.name}</strong><small>{item.email || 'No email added'}</small></div></div></td><td>{item.contact || '—'}</td><td>{item.products || '—'}</td><td><TableActions label={item.name} onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} /></td></tr>)}</tbody></table></div>{shown.length === 0 && <EmptyState title="No suppliers found" text="Add a record or try a different search." />}<TableFooter count={shown.length} total={items.length} page={pages.page} pages={pages.pages} onPage={setPage} /></div>
  </>
}

function HelpPage({ onNavigate }) {
  const guides = [
    { title: 'Update inventory', text: 'Open Inventory, choose a product, then record the quantity received and a reference note.', page: 'Inventory', icon: PackagePlus },
    { title: 'Record a sale', text: 'Open Sales and choose New sale. The sale total and stock deduction are recorded together.', page: 'Sales', icon: ShoppingCart },
    { title: 'Manage products', text: 'Open Products to search the catalog, update item details, or add a new product.', page: 'Products', icon: Package },
  ]
  return <>
    <SectionHeading eyebrow="SUPPORT" title="Help center" subtitle="Quick guidance for the everyday tasks in FullStock." />
    <div className="help-guides">{guides.map(({ title, text, page, icon: Icon }) => <article className="panel help-guide" key={title}><span className="help-guide-icon"><Icon size={19} /></span><div><h2>{title}</h2><p>{text}</p><button className="text-button" onClick={() => onNavigate(page)}>Open {page} <ArrowUpRight size={14} /></button></div></article>)}</div>
    <div className="panel help-contact"><div className="help-icon">?</div><div><strong>Need more help?</strong><span>Ask your FullStock administrator for account, supplier, or workspace support.</span></div></div>
  </>
}

function ReportsPage({ data, onRefresh, refreshing = false }) {
  const [report, setReport] = useState('Sales overview')
  const [period, setPeriod] = useState('Last 7 days')
  const [exportOpen, setExportOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState(null)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startDate = period === 'Last 7 days'
    ? new Date(startOfToday.getTime() - 6 * 86400000)
    : period === 'Last 30 days'
      ? new Date(startOfToday.getTime() - 29 * 86400000)
      : null
  const allSales = (data.sales || []).slice().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  const sales = allSales.filter((sale) => {
    const saleDate = new Date(sale.date)
    // Keep persisted sales from the selected local date range even if the Laravel
    // server clock and this browser are offset by a timezone or clock setting.
    return !Number.isNaN(saleDate.getTime()) && (!startDate || saleDate >= startDate)
  })
  const salesTotal = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0)
  const zeroValueSales = sales.filter((sale) => Number(sale.total || 0) <= 0)
  const products = data.products || []
  const productById = new Map(products.map((product) => [String(product.id), product]))
  const productPerformance = new Map()
  sales.forEach((sale) => (sale.items || []).forEach((item) => {
    const product = productById.get(String(item.product_id))
    const key = String(item.product_id ?? item.product_name ?? product?.name ?? 'Unknown product')
    const performance = productPerformance.get(key) || { name: item.product_name || product?.name || 'Unknown product', units: 0, revenue: 0 }
    const quantity = Number(item.quantity || 0)
    performance.units += quantity
    performance.revenue += quantity * Number(item.price ?? product?.price ?? 0)
    productPerformance.set(key, performance)
  }))
  const supplierById = new Map((data.suppliers || []).map((supplier) => [String(supplier.id), supplier]))
  const supplierPerformance = new Map()
  sales.forEach((sale) => (sale.items || []).forEach((item) => {
    const product = productById.get(String(item.product_id))
    const supplier = product?.supplier_id ? supplierById.get(String(product.supplier_id)) : null
    const key = supplier?.id ?? product?.supplier_name ?? 'unassigned'
    const name = supplier?.name || product?.supplier_name || 'Unassigned supplier'
    const performance = supplierPerformance.get(String(key)) || { name, revenue: 0, units: 0 }
    const quantity = Number(item.quantity || 0)
    performance.units += quantity
    performance.revenue += quantity * Number(item.price ?? product?.price ?? 0)
    supplierPerformance.set(String(key), performance)
  }))
  const categoryCounts = Object.entries(products.reduce((acc, product) => { acc[product.category || 'Other'] = (acc[product.category || 'Other'] || 0) + Number(product.stock || 0); return acc }, {}))
  const categoryColors = ['#10b981', '#6366f1', '#3b82f6', '#f59e0b', '#ef4444', '#0f172a']
  const categoryTotal = categoryCounts.reduce((sum, [, amount]) => sum + Number(amount || 0), 0)
  let categoryAngle = 0
  const categoryGradient = categoryTotal > 0
    ? `conic-gradient(${categoryCounts.map(([, amount], index) => {
      const start = categoryAngle
      categoryAngle += Number(amount || 0) / categoryTotal * 100
      return `${categoryColors[index % categoryColors.length]} ${start}% ${categoryAngle}%`
    }).join(', ')})`
    : '#e2e8f0'
  const buildSalesBuckets = () => {
    let buckets = []
    if (period === 'Last 7 days') {
      buckets = Array.from({ length: 7 }, (_, index) => {
        const start = new Date(startDate.getTime() + index * 86400000)
        return { start, end: new Date(start.getTime() + 86400000), label: start.toLocaleDateString('en-PH', { weekday: 'short' }) }
      })
    } else if (period === 'Last 30 days') {
      buckets = Array.from({ length: 6 }, (_, index) => {
        const start = new Date(startDate.getTime() + index * 5 * 86400000)
        const end = new Date(Math.min(start.getTime() + 5 * 86400000, startOfToday.getTime() + 86400000))
        return { start, end, label: start.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) }
      })
    } else {
      buckets = Array.from({ length: 6 }, (_, index) => {
        const monthOffset = 5 - index
        const start = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1)
        const end = new Date(now.getFullYear(), now.getMonth() - monthOffset + 1, 1)
        return { start, end, label: start.toLocaleDateString('en-PH', { month: 'short' }) }
      })
    }
    return buckets.map((bucket) => ({ ...bucket, value: sales.filter((sale) => {
      const saleDate = new Date(sale.date)
      return saleDate >= bucket.start && saleDate < bucket.end
    }).reduce((sum, sale) => sum + Number(sale.total || 0), 0) }))
  }
  const salesBuckets = buildSalesBuckets()
  const productBars = [...productPerformance.values()].sort((a, b) => b.units - a.units).slice(0, 7).map((item) => ({ label: item.name, value: item.units, display: number(item.units) }))
  const inventoryBars = products.slice().sort((a, b) => Number(b.stock || 0) - Number(a.stock || 0)).slice(0, 7).map((item) => ({ label: item.name, value: Number(item.stock || 0), display: number(item.stock) }))
  const supplierBars = [...supplierPerformance.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 7).map((item) => ({ label: item.name, value: item.revenue, display: money(item.revenue) }))
  const chart = report === 'Sales overview'
    ? { title: 'Sales by period', subtitle: 'Recorded revenue for the selected date range', legend: 'Revenue', bars: salesBuckets.map((bucket) => ({ label: bucket.label, value: bucket.value, display: money(bucket.value) })), empty: 'No sales recorded in this date range.' }
    : report === 'Inventory report'
      ? { title: 'Stock by product', subtitle: 'Current on-hand quantity', legend: 'Units', bars: inventoryBars, empty: 'No products are available to report.' }
      : report === 'Top products'
        ? { title: 'Top products', subtitle: 'Units sold in the selected date range', legend: 'Units sold', bars: productBars, empty: 'No product sales recorded in this date range.' }
        : { title: 'Supplier performance', subtitle: 'Revenue attributed to each product supplier', legend: 'Revenue', bars: supplierBars, empty: 'No supplier sales recorded in this date range.' }
  const maxBarValue = Math.max(1, ...chart.bars.map((bar) => Number(bar.value || 0)))
  const chartHasData = chart.bars.some((bar) => Number(bar.value || 0) > 0)
  const chartEmptyMessage = report === 'Sales overview' && sales.length > 0
    ? 'Sales are recorded for this period, but their saved revenue total is ₱0.'
    : chart.empty
  const periodLabel = startDate
    ? `${startDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })} – ${now.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : allSales.length
      ? `${new Date(allSales[allSales.length - 1].date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })} – ${now.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`
      : 'All recorded dates'
  const exportSummary = [
    ['Date range', periodLabel],
    ['Total sales', money(salesTotal)],
    ['Transactions', number(sales.length)],
    ['Products tracked', number(products.length)],
    ['Low stock products', number(products.filter((product) => Number(product.stock) <= Number(product.reorder_level)).length)],
    ['Out of stock products', number(products.filter((product) => Number(product.stock) <= 0).length)],
    ['Units on hand', number(products.reduce((sum, product) => sum + Number(product.stock || 0), 0))],
    ['Estimated inventory value', money(products.reduce((sum, product) => sum + Number(product.stock || 0) * Number(product.price || 0), 0))],
    ['Suppliers', number((data.suppliers || []).length)],
    ['Inventory movements', number((data.movements || []).length)],
  ]
  const exportFormats = {
    workbook: { title: 'Excel workbook preview', subtitle: 'Review the summary and worksheets before downloading.', action: 'Download workbook' },
    summary: { title: 'Excel summary preview', subtitle: 'This file contains the first Summary sheet only.', action: 'Download summary' },
    csv: { title: 'CSV summary preview', subtitle: 'This file contains the summary metrics in a CSV that opens in Excel or Sheets.', action: 'Download CSV' },
    pdf: { title: 'Print / PDF preview', subtitle: 'Review the report summary before opening the print dialog.', action: 'Continue to print' },
  }
  const reportData = { ...data, sales }
  const confirmExport = () => {
    if (exportFormat === 'workbook') exportReportsToExcel(reportData)
    else if (exportFormat === 'summary') exportReportsToExcel(reportData, true)
    else if (exportFormat === 'csv') exportReportSummaryCsv(reportData)
    else if (exportFormat === 'pdf') window.setTimeout(() => window.print(), 100)
    setExportFormat(null)
  }
  return <>
    <SectionHeading eyebrow="BUSINESS PERFORMANCE" title="Reports & analytics" subtitle="Turn your records into practical business insights." action={<div className="report-export-wrap">
      <button className="button button-primary" aria-expanded={exportOpen} aria-controls="report-export-options" onClick={() => setExportOpen((open) => !open)}><ArrowUpRight size={15} /> Export report <ChevronDown size={14} /></button>
      {exportOpen && <div id="report-export-options" className="report-export-options" role="group" aria-label="Export options">
        <button onClick={() => { setExportFormat('workbook'); setExportOpen(false) }}><strong>Excel workbook (.xlsx)</strong><small>All report sheets</small></button>
        <button onClick={() => { setExportFormat('summary'); setExportOpen(false) }}><strong>Excel summary (.xlsx)</strong><small>Single summary sheet</small></button>
        <button onClick={() => { setExportFormat('csv'); setExportOpen(false) }}><strong>CSV summary (.csv)</strong><small>Opens in Excel and Sheets</small></button>
        <button onClick={() => { setExportFormat('pdf'); setExportOpen(false) }}><strong>Print / Save as PDF</strong><small>Use your browser’s print dialog</small></button>
      </div>}
    </div>} />
    <div className="panel report-panel"><div className="report-tabs">{['Sales overview', 'Inventory report', 'Top products', 'Supplier performance'].map((tab) => <button key={tab} className={report === tab ? 'report-tab-active' : ''} aria-pressed={report === tab} onClick={() => setReport(tab)}>{tab}</button>)}</div><div className="report-date"><span><CalendarDays size={15} /> {periodLabel}</span><div className="report-date-actions"><label className="filter-select"><span className="sr-only">Report date range</span><select value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Report date range"><option>Last 7 days</option><option>Last 30 days</option><option>All time</option></select><ChevronDown size={13} /></label><button className="button button-outline button-small" onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Generate report'}</button></div></div>
      {zeroValueSales.length > 0 && <p className="report-data-warning" role="status">{number(zeroValueSales.length)} {zeroValueSales.length === 1 ? 'sale has' : 'sales have'} a ₱0 total because the rice price was ₱0 when recorded. Set product prices before the next sale; past sale amounts cannot be inferred automatically.</p>}
      <div className="report-metrics"><div><span>Total sales · {period === 'All time' ? 'all time' : period.toLowerCase()}</span><strong>{money(salesTotal)}</strong></div><div><span>Transactions</span><strong>{number(sales.length)}</strong></div><div><span>Products tracked</span><strong>{number(products.length)}</strong></div><div><span>Low stock</span><strong className="report-low-value">{number(products.filter((product) => Number(product.stock) <= Number(product.reorder_level)).length)}</strong></div></div>
      <div className="report-content-grid"><section className="report-chart-card"><div className="panel-heading"><div><h2>{chart.title}</h2><p>{chart.subtitle}</p></div><span className="legend-dot">{chart.legend}</span></div>{chartHasData ? <div className="report-bars" role="img" aria-label={chart.title}>{chart.bars.map((bar, index) => <div className="report-bar-group" key={`${bar.label}-${index}`} title={`${bar.label}: ${bar.display}`}><span className="bar-value">{bar.display}</span><div className="report-bar-track"><i style={{ height: Math.max(12, Number(bar.value) / maxBarValue * 100) + '%' }} /></div><small>{bar.label}</small></div>)}</div> : <div className="report-empty-state" role="status">{chartEmptyMessage}</div>}</section>
        <section className="report-chart-card category-report"><div className="panel-heading"><div><h2>Stock by category</h2><p>Units currently on hand</p></div></div><div className="category-chart-wrap"><div className="category-donut" style={{ background: categoryGradient }}><div><strong>{number(products.reduce((sum, product) => sum + Number(product.stock || 0), 0))}</strong><span>units</span></div></div><div className="category-legend">{categoryCounts.map(([name, amount], index) => <div key={name}><i className="legend-swatch" style={{ background: categoryColors[index % categoryColors.length] }} /><span>{name}</span><strong>{amount}</strong></div>)}</div></div></section></div>
    </div>
    {exportFormat && <Modal title={exportFormats[exportFormat].title} subtitle={exportFormats[exportFormat].subtitle} onClose={() => setExportFormat(null)}>
      <div className="report-export-preview">
        {exportFormat === 'workbook' && <div className="report-export-sheets"><strong>Included worksheets</strong><div>{['Summary', 'Sales', 'Sale Items', 'Products', 'Top Products', 'Stock by Category', 'Suppliers', 'Inventory Movements'].map((sheet) => <span key={sheet}>{sheet}</span>)}</div></div>}
        <div className="report-export-summary"><strong>Summary sheet preview</strong><div className="report-export-table-wrap"><table><tbody>{exportSummary.map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td>{value}</td></tr>)}</tbody></table></div></div>
      </div>
      <div className="modal-actions"><button type="button" className="button button-outline" onClick={() => setExportFormat(null)}>Cancel</button><button type="button" className="button button-primary" onClick={confirmExport}>{exportFormats[exportFormat].action} <ArrowUpRight size={14} /></button></div>
    </Modal>}
  </>
}

function escapeSpreadsheetXml(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function excelColumnName(index) {
  let column = ''
  let number = index + 1
  while (number > 0) {
    const remainder = (number - 1) % 26
    column = String.fromCharCode(65 + remainder) + column
    number = Math.floor((number - 1) / 26)
  }
  return column
}

function excelWorksheetXml(sheet) {
  const rows = sheet.rows || []
  const columnCount = Math.max(1, ...rows.map((row) => row.length))
  const rowCount = rows.length
  const lastCell = `${excelColumnName(columnCount - 1)}${rowCount}`
  const xmlRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
    if (value === null || value === undefined || value === '') return ''
    const reference = `${excelColumnName(columnIndex)}${rowIndex + 1}`
    const isDate = value instanceof Date && !Number.isNaN(value.getTime())
    const isNumber = typeof value === 'number' && Number.isFinite(value)
    const isCurrency = sheet.currencyColumns?.includes(columnIndex) || (columnIndex === 1 && sheet.currencyRows?.includes(rowIndex))
    const style = rowIndex === 0 ? ' s="1"' : isDate ? ' s="3"' : isCurrency ? ' s="2"' : ''
    if (isDate) {
      const excelDate = value.getTime() / 86400000 + 25569
      return `<c r="${reference}"${style}><v>${excelDate}</v></c>`
    }
    if (isNumber) return `<c r="${reference}"${style}><v>${value}</v></c>`
    return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeSpreadsheetXml(value)}</t></is></c>`
  }).join('')}</row>`).join('')
  const columns = Array.from({ length: columnCount }, (_, columnIndex) => {
    const longest = Math.max(0, ...rows.map((row) => String(row[columnIndex] ?? '').length))
    const width = Math.min(48, Math.max(12, longest + 2))
    return `<col min="${columnIndex + 1}" max="${columnIndex + 1}" width="${width}" customWidth="1" />`
  }).join('')
  const filter = sheet.name === 'Summary' || rowCount < 2 ? '' : `<autoFilter ref="A1:${lastCell}" />`

  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastCell}" /><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen" /><selection pane="bottomLeft" activeCell="A2" sqref="A2" /></sheetView></sheetViews><sheetFormatPr defaultRowHeight="16" /><cols>${columns}</cols><sheetData>${xmlRows}</sheetData>${filter}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3" /></worksheet>`
}

function joinByteArrays(chunks) {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  chunks.forEach((chunk) => { result.set(chunk, offset); offset += chunk.length })
  return result
}

function zipFiles(files) {
  const encoder = new TextEncoder()
  const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
    let crc = value
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1)
    return crc >>> 0
  })
  const crc32 = (bytes) => {
    let crc = 0xFFFFFFFF
    bytes.forEach((byte) => { crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8) })
    return (crc ^ 0xFFFFFFFF) >>> 0
  }
  const now = new Date()
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)
  const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  const localParts = []
  const centralParts = []
  let localOffset = 0

  files.forEach(([path, contents]) => {
    const name = encoder.encode(path)
    const data = encoder.encode(contents)
    const checksum = crc32(data)
    const localHeader = new Uint8Array(30 + name.length)
    const localView = new DataView(localHeader.buffer)
    localView.setUint32(0, 0x04034B50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, 0x0800, true)
    localView.setUint16(8, 0, true)
    localView.setUint16(10, dosTime, true)
    localView.setUint16(12, dosDate, true)
    localView.setUint32(14, checksum, true)
    localView.setUint32(18, data.length, true)
    localView.setUint32(22, data.length, true)
    localView.setUint16(26, name.length, true)
    localView.setUint16(28, 0, true)
    localHeader.set(name, 30)
    localParts.push(localHeader, data)

    const centralHeader = new Uint8Array(46 + name.length)
    const centralView = new DataView(centralHeader.buffer)
    centralView.setUint32(0, 0x02014B50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0x0800, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint16(12, dosTime, true)
    centralView.setUint16(14, dosDate, true)
    centralView.setUint32(16, checksum, true)
    centralView.setUint32(20, data.length, true)
    centralView.setUint32(24, data.length, true)
    centralView.setUint16(28, name.length, true)
    centralView.setUint16(30, 0, true)
    centralView.setUint16(32, 0, true)
    centralView.setUint16(34, 0, true)
    centralView.setUint16(36, 0, true)
    centralView.setUint32(38, 0, true)
    centralView.setUint32(42, localOffset, true)
    centralHeader.set(name, 46)
    centralParts.push(centralHeader)
    localOffset += localHeader.length + data.length
  })

  const centralDirectory = joinByteArrays(centralParts)
  const endRecord = new Uint8Array(22)
  const endView = new DataView(endRecord.buffer)
  endView.setUint32(0, 0x06054B50, true)
  endView.setUint16(4, 0, true)
  endView.setUint16(6, 0, true)
  endView.setUint16(8, files.length, true)
  endView.setUint16(10, files.length, true)
  endView.setUint32(12, centralDirectory.length, true)
  endView.setUint32(16, localOffset, true)
  endView.setUint16(20, 0, true)
  return joinByteArrays([...localParts, centralDirectory, endRecord])
}

function exportReportsToExcel(data, summaryOnly = false) {
  const products = data.products || []
  const sales = data.sales || []
  const suppliers = data.suppliers || []
  const movements = data.movements || []
  const lowStock = products.filter((product) => Number(product.stock) <= Number(product.reorder_level))
  const outOfStock = products.filter((product) => Number(product.stock) <= 0)
  const totalUnits = products.reduce((sum, product) => sum + Number(product.stock || 0), 0)
  const stockValue = products.reduce((sum, product) => sum + Number(product.stock || 0) * Number(product.price || 0), 0)
  const totalSales = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0)
  const salesItems = sales.flatMap((sale) => (sale.items || []).map((item) => ({
    sale,
    item,
    product: products.find((product) => String(product.id) === String(item.product_id)),
  })))

  const productPerformance = new Map()
  salesItems.forEach(({ sale, item, product }) => {
    const key = String(item.product_id ?? item.product_name ?? product?.name ?? 'Unknown product')
    const current = productPerformance.get(key) || { id: item.product_id ?? product?.id ?? '', name: item.product_name || product?.name || 'Unknown product', units: 0, revenue: 0, transactions: new Set() }
    current.units += Number(item.quantity || 0)
    current.revenue += Number(item.quantity || 0) * Number(item.price ?? product?.price ?? 0)
    current.transactions.add(String(sale.id ?? sale.number ?? ''))
    productPerformance.set(key, current)
  })

  const categoryStats = new Map()
  products.forEach((product) => {
    const name = product.category || 'Other'
    const current = categoryStats.get(name) || { products: 0, units: 0, value: 0, lowStock: 0 }
    current.products += 1
    current.units += Number(product.stock || 0)
    current.value += Number(product.stock || 0) * Number(product.price || 0)
    if (Number(product.stock) <= Number(product.reorder_level)) current.lowStock += 1
    categoryStats.set(name, current)
  })

  const sheets = [
    {
      name: 'Summary',
      currencyRows: [2, 8],
      rows: [
        ['FullStock report', 'Value'],
        ['Generated at', new Date()],
        ['Total sales', totalSales],
        ['Transactions', sales.length],
        ['Products tracked', products.length],
        ['Low stock products', lowStock.length],
        ['Out of stock products', outOfStock.length],
        ['Units on hand', totalUnits],
        ['Estimated inventory value', stockValue],
        ['Suppliers', suppliers.length],
        ['Inventory movements included', movements.length],
        ['Scope', 'All records currently loaded in FullStock'],
      ],
    },
    {
      name: 'Sales',
      currencyColumns: [4],
      rows: [['Sale number', 'Date', 'Status', 'Item count', 'Total'], ...sales.map((sale) => [sale.number || sale.id, sale.date ? new Date(sale.date) : '', sale.status || '', (sale.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0), Number(sale.total || 0)])],
    },
    {
      name: 'Sale Items',
      currencyColumns: [5, 6],
      rows: [['Sale number', 'Date', 'Product ID', 'Product', 'Quantity', 'Unit price', 'Line total'], ...salesItems.map(({ sale, item, product }) => [sale.number || sale.id, sale.date ? new Date(sale.date) : '', item.product_id ?? product?.id ?? '', item.product_name || product?.name || '', Number(item.quantity || 0), Number(item.price ?? product?.price ?? 0), Number(item.quantity || 0) * Number(item.price ?? product?.price ?? 0)])],
    },
    {
      name: 'Products',
      currencyColumns: [3],
      rows: [['Product ID', 'Product', 'Category', 'Price', 'Stock', 'Reorder level', 'Status', 'Supplier'], ...products.map((product) => [product.id, product.name, product.category || 'Other', Number(product.price || 0), Number(product.stock || 0), Number(product.reorder_level || 0), Number(product.stock) <= 0 ? 'Out of stock' : Number(product.stock) <= Number(product.reorder_level) ? 'Low stock' : 'In stock', product.supplier_name || suppliers.find((supplier) => String(supplier.id) === String(product.supplier_id))?.name || ''])],
    },
    {
      name: 'Top Products',
      currencyColumns: [3],
      rows: [['Product ID', 'Product', 'Units sold', 'Sales revenue', 'Transactions'], ...[...productPerformance.values()].sort((a, b) => b.units - a.units).map((product) => [product.id, product.name, product.units, product.revenue, product.transactions.size])],
    },
    {
      name: 'Stock by Category',
      currencyColumns: [3],
      rows: [['Category', 'Products', 'Units on hand', 'Estimated value', 'Low stock products'], ...[...categoryStats.entries()].map(([category, stats]) => [category, stats.products, stats.units, stats.value, stats.lowStock])],
    },
    {
      name: 'Suppliers',
      rows: [['Supplier ID', 'Supplier', 'Contact', 'Email', 'Linked products'], ...suppliers.map((supplier) => [supplier.id, supplier.name, supplier.contact || '', supplier.email || '', supplier.product_count ?? products.filter((product) => String(product.supplier_id) === String(supplier.id)).length])],
    },
    {
      name: 'Inventory Movements',
      rows: [['Movement ID', 'Date', 'Product ID', 'Product', 'Type', 'Quantity', 'Reference'], ...movements.map((movement) => [movement.id, movement.date ? new Date(movement.date) : '', movement.product_id ?? '', movement.product_name || '', movement.type || '', Number(movement.quantity || 0), movement.reference || ''])],
    },
  ]

  const exportSheets = summaryOnly ? sheets.slice(0, 1) : sheets
  const sheetOverrides = exportSheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" />`).join('')
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Default Extension="xml" ContentType="application/xml" /><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" /><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml" />${sheetOverrides}</Types>`
  const rootRelationships = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml" /></Relationships>`
  const workbookXml = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${exportSheets.map((sheet, index) => `<sheet name="${escapeSpreadsheetXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}" />`).join('')}</sheets></workbook>`
  const workbookRelationships = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${exportSheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml" />`).join('')}<Relationship Id="rId${exportSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml" /></Relationships>`
  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;₱&quot;#,##0.00" /><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm" /></numFmts><fonts count="2"><font><name val="Calibri" /><sz val="11" /></font><font><name val="Calibri" /><b /><color rgb="FFFFFFFF" /><sz val="11" /></font></fonts><fills count="3"><fill><patternFill patternType="none" /></fill><fill><patternFill patternType="gray125" /></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E1B4B" /><bgColor indexed="64" /></patternFill></fill></fills><borders count="1"><border><left /><right /><top /><bottom /><diagonal /></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" /></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" /><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" /><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" /><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" /></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0" /></cellStyles></styleSheet>`
  const files = [
    ['[Content_Types].xml', contentTypes],
    ['_rels/.rels', rootRelationships],
    ['xl/workbook.xml', workbookXml],
    ['xl/_rels/workbook.xml.rels', workbookRelationships],
    ['xl/styles.xml', stylesXml],
    ...exportSheets.map((sheet, index) => [`xl/worksheets/sheet${index + 1}.xml`, excelWorksheetXml(sheet)]),
  ]
  const workbook = zipFiles(files)
  const file = new Blob([workbook], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10)
  link.href = url
  link.download = `fullstock-report${summaryOnly ? '-summary' : ''}-${date}.xlsx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function exportReportSummaryCsv(data) {
  const products = data.products || []
  const sales = data.sales || []
  const suppliers = data.suppliers || []
  const movements = data.movements || []
  const rows = [
    ['Metric', 'Value'],
    ['Generated at', new Date().toLocaleString()],
    ['Total sales', sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0)],
    ['Transactions', sales.length],
    ['Products tracked', products.length],
    ['Low stock products', products.filter((product) => Number(product.stock) <= Number(product.reorder_level)).length],
    ['Out of stock products', products.filter((product) => Number(product.stock) <= 0).length],
    ['Units on hand', products.reduce((sum, product) => sum + Number(product.stock || 0), 0)],
    ['Estimated inventory value', products.reduce((sum, product) => sum + Number(product.stock || 0) * Number(product.price || 0), 0)],
    ['Suppliers', suppliers.length],
    ['Inventory movements included', movements.length],
  ]
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n')
  const file = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = `fullstock-report-summary-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function AssistantPage({ data, conversations, activeConversation, onNewChat, onSelectChat, onDeleteChat, onUpdateChat }) {
  const [question, setQuestion] = useState('')
  const [waitingLong, setWaitingLong] = useState(false)
  const messages = activeConversation?.messages || []
  const busy = Boolean(activeConversation?.pending)
  const messageEndRef = useRef(null)

  useEffect(() => { setQuestion('') }, [activeConversation?.id])
  useEffect(() => {
    setWaitingLong(false)
    if (!busy) return undefined
    const since = activeConversation?.pendingSince || Date.now()
    const timer = window.setTimeout(() => setWaitingLong(true), Math.max(0, 5000 - (Date.now() - since)))
    return () => window.clearTimeout(timer)
  }, [activeConversation?.id, activeConversation?.pendingSince, busy])
  useEffect(() => { messageEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' }) }, [activeConversation?.id, messages.length, messages.at(-1)?.text])

  const ask = async (value = question) => {
    const prompt = value.trim()
    if (!prompt || busy || !activeConversation) return
    const chatId = activeConversation.id
    const conversation = messages
      .filter((message, index) => index > 0 && !message.isError && message.text)
      .slice(-12)
      .map(({ role, text }) => ({ role, text }))
    const startedAt = Date.now()
    onUpdateChat(chatId, (chat) => ({
      ...chat,
      title: chat.title === 'New chat' ? prompt.slice(0, 48) : chat.title,
      pending: true,
      pendingSince: startedAt,
      messages: [...chat.messages, { role: 'user', text: prompt }, { role: 'assistant', text: '' }],
    }))
    setQuestion('')

    try {
      const response = await api.assistant(prompt, conversation, (token) => {
        onUpdateChat(chatId, (chat) => {
          const nextMessages = [...chat.messages]
          const lastIndex = nextMessages.length - 1
          if (nextMessages[lastIndex]?.role === 'assistant') {
            nextMessages[lastIndex] = { ...nextMessages[lastIndex], text: nextMessages[lastIndex].text + token }
          }
          return { ...chat, messages: nextMessages }
        })
      })
      if (!response.streamed) {
        const answer = typeof response.answer === 'string' ? response.answer.trim() : ''
        if (!answer) throw new Error('The AI service returned an empty answer. Please try again.')
        onUpdateChat(chatId, (chat) => {
          const nextMessages = [...chat.messages]
          const lastIndex = nextMessages.length - 1
          nextMessages[lastIndex] = { role: 'assistant', text: answer }
          return { ...chat, messages: nextMessages }
        })
      }
    } catch (error) {
      const message = error.message || 'The AI Assistant could not reach Laravel. Check the backend connection and try again.'
      onUpdateChat(chatId, (chat) => {
        const nextMessages = [...chat.messages]
        const lastIndex = nextMessages.length - 1
        if (nextMessages[lastIndex]?.role === 'assistant') {
          const partial = nextMessages[lastIndex].text
          nextMessages[lastIndex] = { role: 'assistant', text: partial ? `${partial}\n\n${message}` : message, isError: true }
        }
        return { ...chat, messages: nextMessages }
      })
    } finally {
      onUpdateChat(chatId, (chat) => ({ ...chat, pending: false, pendingSince: null }))
    }
  }

  return <>
    <SectionHeading eyebrow="SMART BUSINESS SUPPORT" title="AI Assistant" subtitle="Ask about FullStock features or get answers from your saved business records." action={<span className="ai-status"><i /> FullStock-aware</span>} />
    <div className="assistant-layout"><section className="panel assistant-chat">
      <div className="assistant-chat-head"><div className="assistant-avatar"><Bot size={19} /></div><div className="assistant-head-copy"><strong>FullStock Assistant</strong><span><i /> {busy ? 'Answering your question' : 'Ready to help'}</span></div><div className="assistant-chat-actions"><select aria-label="Saved conversations" value={activeConversation?.id || ''} onChange={(event) => onSelectChat(event.target.value)}>{conversations.map((chat) => <option key={chat.id} value={chat.id}>{chat.title || 'New chat'}</option>)}</select><button type="button" className="assistant-new-chat" onClick={onNewChat}><Plus size={14} /> New chat</button><button type="button" className="assistant-delete-chat" aria-label="Delete current chat" title="Delete current chat" disabled={!activeConversation || busy} onClick={() => onDeleteChat(activeConversation.id)}><Trash2 size={14} /><span>Delete</span></button></div></div>
      <div className="chat-messages">{messages.map((message, index) => <div className={'chat-message ' + (message.role === 'user' ? 'chat-user' : 'chat-bot')} key={`${activeConversation?.id}-${index}`}>{message.role === 'assistant' && <div className="assistant-avatar assistant-avatar-small"><Sparkles size={14} /></div>}<div className={'chat-bubble ' + (message.isError ? 'chat-bubble-error' : '')}>{message.text.split('\n').map((line, lineIndex) => <span key={lineIndex}>{line}<br /></span>)}</div></div>)}{busy && !messages.at(-1)?.text && <div className="chat-message chat-bot"><div className="assistant-avatar assistant-avatar-small"><Sparkles size={14} /></div><div className="chat-bubble typing-indicator"><i /><i /><i /><span>{waitingLong ? 'Local AI is still working on your answer…' : 'Preparing your answer…'}</span></div></div>}<div ref={messageEndRef} /></div>
      <div className="suggested-prompts"><span>TRY ASKING</span><button onClick={() => ask('Which products are low stock?')}>Which products are low stock?</button><button onClick={() => ask('How do I record a sale?')}>How do I record a sale?</button><button onClick={() => ask('How much did we sell this week?')}>How much did we sell this week?</button></div>
      <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); ask() }}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about products, sales, stock, suppliers, or how to use FullStock..." /><button aria-label="Send message" disabled={!question.trim() || busy}><Send size={17} /></button></form><p className="assistant-disclaimer">Answers about business data use your FullStock records. Review recommendations before taking action.</p>
    </section>
      <aside className="assistant-aside"><div className="panel quick-insights"><div className="panel-heading"><div><h2>Inventory snapshot</h2><p>Based on current records</p></div><Sparkles size={16} className="accent-icon" /></div><div className="quick-insight-stat"><strong>{data.products.filter((p) => Number(p.stock) <= Number(p.reorder_level)).length}</strong><span>products at or below reorder level</span></div><div className="quick-low-list">{data.products.filter((p) => Number(p.stock) <= Number(p.reorder_level)).map((product) => <div key={product.id}><span>{product.name}</span><strong>{product.stock} left</strong></div>)}</div><button className="text-button" onClick={() => ask('Which products should I restock?')}>Review restock priorities <ArrowUpRight size={14} /></button></div><div className="assistant-note"><Clock3 size={17} /><div><strong>Data refreshes with your activity</strong><span>New sales and stock adjustments update future recommendations.</span></div></div></aside></div>
  </>
}

function PasswordResetRequestsPanel({ demoSession }) {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [temporaryPassword, setTemporaryPassword] = useState(null)
  const [copyMessage, setCopyMessage] = useState('')
  const [requestToReset, setRequestToReset] = useState(null)
  const [requestToDelete, setRequestToDelete] = useState(null)

  useEffect(() => {
    if (demoSession) {
      setLoading(false)
      return
    }

    api.passwordResetRequests()
      .then((result) => setRequests(result.requests || []))
      .catch((requestError) => setError(requestError.message || 'Could not load requests.'))
      .finally(() => setLoading(false))
  }, [demoSession])

  const resetRequest = async (resetRequestItem) => {
    setBusyId(resetRequestItem.id)
    setError('')
    setTemporaryPassword(null)
    setCopyMessage('')

    try {
      const result = await api.resetStaffPassword(resetRequestItem.id)
      setRequests((current) => current.filter((item) => item.id !== resetRequestItem.id))
      setTemporaryPassword({
        email: resetRequestItem.email,
        value: result.temporary_password,
      })
    } catch (requestError) {
      setError(requestError.message || 'Could not reset this password.')
    } finally {
      setBusyId(null)
    }
  }
  const deleteRequest = async (deleteRequestItem) => {
  setBusyId(deleteRequestItem.id)
  setError('')

  try {
    await api.deletePasswordResetRequest(deleteRequestItem.id)
    setRequests((current) => current.filter((item) => item.id !== deleteRequestItem.id))
    setRequestToDelete(null)
  } catch (requestError) {
    setError(requestError.message || 'Could not delete this request.')
    setRequestToDelete(null)
  } finally {
    setBusyId(null)
  }
}
  const copyTemporaryPassword = async () => {
    if (!temporaryPassword) return

    try {
      await navigator.clipboard.writeText(temporaryPassword.value)
      setCopyMessage('Copied. Share it with the staff member privately.')
    } catch {
      setCopyMessage('Copy is unavailable here. Select the password above and copy it manually.')
    }
  }

  return (
    <div className="settings-content">
      <div className="staff-account-intro">
        <strong>Password reset requests</strong>
        <span>Verify each staff member’s identity before resetting their password. Give the temporary password to them privately.</span>
      </div>

      {demoSession && (
        <p className="auth-feedback auth-feedback-info" role="status">
          Sign in with your administrator account while Laravel is running to load live requests.
        </p>
      )}

      {error && <p className="auth-feedback auth-feedback-error" role="alert">{error}</p>}

      {temporaryPassword && (
        <div className="auth-feedback auth-feedback-success" role="status">
          <strong>Temporary password for {temporaryPassword.email}</strong>
          <p>
            Copy this before leaving the page. It won’t be shown again, and you’ll need to reset the password again if it’s lost.
          </p>
          <code>{temporaryPassword.value}</code>
          <div className="settings-save-row">
            <span>Give it to the staff member through a private channel.</span>
            <button
              type="button"
              className="button button-outline button-small"
              onClick={copyTemporaryPassword}
            >
              Copy temporary password
            </button>
          </div>
          {copyMessage && <p role="status">{copyMessage}</p>}
        </div>
      )}

      {loading && <p>Loading requests…</p>}
      {!loading && !demoSession && requests.length === 0 && <p>No pending password reset requests.</p>}

      {requests.map((item) => (
        <div className="staff-account-intro" key={item.id}>
          <strong>{item.email}</strong>
          <span>Submitted {new Date(item.created_at).toLocaleString()}</span>
          {item.message && <p>{item.message}</p>}
          <div className="modal-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={busyId !== null || demoSession}
              onClick={() => setRequestToReset(item)}
            >
              {busyId === item.id ? 'Resetting…' : 'Verify and reset password'}
            </button>
            <button
              type="button"
              className="button button-outline"
              disabled={busyId !== null || demoSession}
              onClick={() => setRequestToDelete(item)}
            >
              Delete request
            </button>
          </div>
        </div>
      ))}
      {requestToReset && (
        <Modal
          title="Verify staff identity"
          subtitle="Confirm this request before resetting the password."
          onClose={() => setRequestToReset(null)}
        >
          <div className="modal-form">
            <p>
              Have you verified <strong>{requestToReset.email}</strong> through a trusted channel?
            </p>
            <p>The temporary password will appear once after the reset. Give it to the staff member privately.</p>
            <div className="modal-actions">
              <button
                type="button"
                className="button button-outline"
                onClick={() => setRequestToReset(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button button-primary"
                disabled={busyId !== null}
                onClick={() => {
                  const selectedRequest = requestToReset
                  setRequestToReset(null)
                  resetRequest(selectedRequest)
                }}
              >
                Confirm reset
              </button>
            </div>
          </div>
        </Modal>
      )}
      {requestToDelete && (
        <Modal
          title="Delete password reset request?"
          subtitle="This removes the request only. It does not change the staff member’s password."
          onClose={() => setRequestToDelete(null)}
        >
          <div className="modal-form">
            <p>
              Delete the pending request for <strong>{requestToDelete.email}</strong>?
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="button button-outline"
                onClick={() => setRequestToDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button button-primary"
                disabled={busyId !== null}
                onClick={() => deleteRequest(requestToDelete)}
              >
                Delete request
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function TemporaryPasswordChangeScreen({ user, onChangePassword, onSignOut }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')

    try {
      await onChangePassword({
        current_password: currentPassword,
        new_password: newPassword,
        new_password_confirmation: confirmation,
      })
    } catch (requestError) {
      setError(requestError.message || 'Could not change the password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <section className="login-form-panel">
        <div className="login-mobile-brand"><SmartLogo animated /></div>
        <div className="login-form-wrap">
          <div className="login-heading">
            <span className="eyebrow">ACCOUNT SECURITY</span>
            <h2>Choose a new password</h2>
            <p>Your administrator issued a temporary password for {user?.email}. Change it to continue.</p>
          </div>
          <form onSubmit={submit} className="login-form">
            <label className="field-label">
              Temporary password
              <input className="text-input" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required autoComplete="current-password" />
            </label>
            <label className="field-label">
              New password
              <input className="text-input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required minLength={12} autoComplete="new-password" />
            </label>
            <label className="field-label">
              Confirm new password
              <input className="text-input" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={12} autoComplete="new-password" />
            </label>
            {error && <p className="auth-feedback auth-feedback-error" role="alert">{error}</p>}
            <button className="button button-primary button-wide" disabled={busy}>
              {busy ? 'Saving…' : 'Change password'}
            </button>
          </form>
          <button type="button" className="link-button" onClick={onSignOut}>Sign out</button>
        </div>
      </section>
      <section className="login-brand-panel">
        <div className="login-panel-top">
          <SmartLogo light size="large" animated />
          <span className="login-orbit orbit-one" />
          <span className="login-orbit orbit-two" />
        </div>

        <div className="login-brand-copy">
          <span className="eyebrow">ACCOUNT SECURITY</span>
          <h1>Make your account yours.</h1>
          <p>Choose a strong, private password to keep your FullStock account secure.</p>
          <div className="login-mini-stat">
            <div className="mini-stat-icon"><BarChart3 size={17} /></div>
            <div>
              <strong>One quick security step</strong>
              <span>Once you save your new password, you can continue to your workspace.</span>
            </div>
          </div>
        </div>

        <div className="login-decoration">
          <div className="crate crate-large" />
          <div className="crate crate-small" />
          <div className="login-glow" />
        </div>

        <div className="login-panel-footer">
          <span>FULLSTOCK INVENTORY SUITE</span>
          <span>ACCOUNT SECURITY</span>
        </div>
      </section>
    </div>
  )
}

function SettingsPage({ user, onToast, onCreateStaffAccount, demoSession }) {
  const [tab, setTab] = useState('Profile')
  const [name, setName] = useState(user?.name || 'Admin')
  const [email, setEmail] = useState(user?.email || 'admin@fullstock.test')
  const [staffName, setStaffName] = useState('')
  const [staffEmail, setStaffEmail] = useState('')
  const [staffPassword, setStaffPassword] = useState('')
  const [staffPasswordConfirmation, setStaffPasswordConfirmation] = useState('')
  const [staffBusy, setStaffBusy] = useState(false)
  const [staffMessage, setStaffMessage] = useState(null)
  const [staffAccounts, setStaffAccounts] = useState([])
  const [staffSearch, setStaffSearch] = useState('')
  const filteredStaffAccounts = staffAccounts.filter((staff) => {
    const searchText = staffSearch.trim().toLowerCase()
    return `${staff.name} ${staff.email}`.toLowerCase().includes(searchText)
  })
  const [staffListLoading, setStaffListLoading] = useState(false)
  const [staffListError, setStaffListError] = useState('')
  const [staffDeletingId, setStaffDeletingId] = useState(null)
  const [staffPendingDelete, setStaffPendingDelete] = useState(null)
  const isAdmin = ['admin', 'administrator'].includes(user?.role?.toLowerCase())
  const tabs = ['Profile', 'Business', 'Notifications', ...(isAdmin ? ['Staff accounts', 'Password reset requests'] : [])]
  const loadStaffAccounts = useCallback(async () => {
  if (demoSession) {
    setStaffAccounts([])
    setStaffListLoading(false)
    return
  }

  setStaffListLoading(true)
  setStaffListError('')

  try {
    const result = await api.staffAccounts()
    setStaffAccounts(result.staff || [])
  } catch (error) {
    setStaffListError(error.message || 'Could not load staff accounts.')
  } finally {
    setStaffListLoading(false)
  }
}, [demoSession])

const deleteStaffAccount = (staff) => {
  setStaffPendingDelete(staff)
}

const confirmStaffStatusChange = async () => {
  const staff = staffPendingDelete
  if (!staff) return

  const nextIsActive = !staff.is_active
  setStaffDeletingId(staff.id)
  setStaffListError('')

  try {
    await api.updateStaffAccountStatus(staff.id, nextIsActive)
    setStaffAccounts((current) =>
      current.map((account) =>
        account.id === staff.id
          ? { ...account, is_active: nextIsActive }
          : account
      )
    )
    setStaffPendingDelete(null)
  } catch (error) {
    setStaffListError(error.message || 'Could not update the staff account.')
  } finally {
    setStaffDeletingId(null)
  }
}

useEffect(() => {
  if (tab === 'Staff accounts' && isAdmin) {
    loadStaffAccounts()
  }
}, [tab, isAdmin, loadStaffAccounts])
  const createStaffAccount = async (event) => {
    event.preventDefault()
    setStaffBusy(true)
    setStaffMessage(null)
    try {
      await onCreateStaffAccount({ name: staffName, email: staffEmail, password: staffPassword, password_confirmation: staffPasswordConfirmation })
      setStaffName('')
      setStaffEmail('')
      setStaffPassword('')
      setStaffPasswordConfirmation('')
      setStaffMessage({ type: 'success', text: 'Staff account created. Share the login details securely with your team member.' })
      onToast('Staff account created.')
    } catch (error) {
      setStaffMessage({ type: 'error', text: error.message || 'Unable to create staff account.' })
    } finally {
      setStaffBusy(false)
    }
  }
  return <>
    <SectionHeading eyebrow="WORKSPACE" title="Settings" subtitle="Manage your profile and business preferences." />
    <div className="panel settings-panel">
  <div className="settings-tabs">
    {tabs.map((value) => (
      <button
        key={value}
        className={tab === value ? 'settings-tab-active' : ''}
        onClick={() => setTab(value)}
      >
        {value}
      </button>
    ))}
  </div>

  {tab === 'Profile' ? (
    <div className="settings-content">
      <div className="settings-avatar-row">
        <div className="avatar avatar-large">
          {name.charAt(0).toUpperCase()}
        </div>

        <div>
          <strong>Profile photo</strong>
          <span>Choose an image to personalize your account.</span>
        </div>

        <button
          className="button button-outline button-small"
          onClick={() =>
            onToast('Profile photo upload can be connected to cloud storage.')
          }
        >
          Upload photo
        </button>
      </div>

      <div className="settings-form">
        <label className="field-label">
          Full name
          <input
            className="text-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label className="field-label">
          Email address
          <input
            className="text-input"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className="field-label">
          Role
          <input
            className="text-input"
            value={roleLabel(user?.role)}
            readOnly
          />
        </label>
      </div>

      <div className="settings-save-row">
        <span>Profile information for the signed-in account.</span>
        <button
          className="button button-primary"
          onClick={() => onToast('Profile settings saved.')}
        >
          Save changes
        </button>
      </div>
    </div>
  ) : tab === 'Staff accounts' && isAdmin ? (
    <>
  <form className="settings-content" onSubmit={createStaffAccount}>
    <section className="staff-section">
      <div className="staff-section-heading">
        <div>
          <h3>Current staff accounts</h3>
          <p>Staff members who can access this workspace.</p>
        </div>

        <button
          type="button"
          className="button button-outline button-small"
          onClick={loadStaffAccounts}
          disabled={staffListLoading || demoSession}
        >
          {staffListLoading ? 'Refreshing…' : 'Refresh list'}
        </button>
      </div>

      <div className="table-search staff-search">
        <Search size={16} />
        <input
          type="search"
          value={staffSearch}
          onChange={(event) => setStaffSearch(event.target.value)}
          placeholder="Search staff by name or email..."
          aria-label="Search staff accounts"
        />
      </div>

      {staffListError && (
        <p className="auth-feedback auth-feedback-error" role="alert">
          {staffListError}
        </p>
      )}

      <div className="table-scroll staff-table-scroll">
        <table>
          <thead>
            <tr>
              <th>NAME</th>
              <th>EMAIL</th>
              <th>ACCOUNT CREATED</th>
              <th>STATUS</th>
              <th>ACTION</th>
            </tr>
          </thead>

          <tbody>
            {filteredStaffAccounts.map((staff) => (
              <tr key={staff.id}>
                <td className="cell-strong">{staff.name}</td>
                <td>{staff.email}</td>
                <td>
                  {staff.created_at
                    ? new Date(staff.created_at).toLocaleDateString()
                    : '—'}
                </td>
                <td>
                  <span
                    className={`status-pill ${
                      staff.is_active ? 'status-good' : 'staff-status-inactive'
                    }`}
                  >
                    <i aria-hidden="true" />
                    {staff.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="button button-outline button-small"
                    onClick={() => deleteStaffAccount(staff)}
                    disabled={staffDeletingId === staff.id}
                  >
                    {staffDeletingId === staff.id
                      ? 'Updating…'
                      : staff.is_active
                        ? 'Deactivate'
                        : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}

            {!staffListLoading &&
              !staffListError &&
              filteredStaffAccounts.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    {staffSearch.trim()
                      ? 'No staff accounts match your search.'
                      : demoSession
                        ? 'Sign in with your administrator account to view saved staff accounts.'
                        : 'No staff accounts found.'}
                  </td>
                </tr>
              )}
          </tbody>
        </table>
      </div>

      {staffListLoading && <p>Loading staff accounts…</p>}
    </section>

    <section className="staff-section staff-create-section">
      <div className="staff-section-heading">
        <div>
          <h3>Create a staff account</h3>
          <p>
            Create a team login with the staff role. Staff can work with sales
            and inventory.
          </p>
        </div>
      </div>

      <div className="settings-form">
        <label className="field-label">
          Full name
          <input
            className="text-input"
            value={staffName}
            onChange={(event) => setStaffName(event.target.value)}
            required
            autoComplete="name"
            placeholder="Staff member name"
          />
        </label>

        <label className="field-label">
          Email address
          <input
            className="text-input"
            type="email"
            value={staffEmail}
            onChange={(event) => setStaffEmail(event.target.value)}
            required
            autoComplete="email"
            placeholder="staff@example.com"
          />
        </label>

        <label className="field-label">
          Temporary password
          <input
            className="text-input"
            type="password"
            value={staffPassword}
            onChange={(event) => setStaffPassword(event.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="At least 8 characters"
          />
        </label>

        <label className="field-label">
          Confirm password
          <input
            className="text-input"
            type="password"
            value={staffPasswordConfirmation}
            onChange={(event) =>
              setStaffPasswordConfirmation(event.target.value)
            }
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="Enter the password again"
          />
        </label>
      </div>

      {demoSession && (
        <p className="auth-feedback auth-feedback-info" role="status">
          You’re using local demo access. Sign in with your administrator
          account while Laravel is running to create a saved staff account.
        </p>
      )}

      {staffMessage && (
        <p
          className={'auth-feedback auth-feedback-' + staffMessage.type}
          role={staffMessage.type === 'error' ? 'alert' : 'status'}
        >
          {staffMessage.text}
        </p>
      )}

      <div className="settings-save-row">
        <span>New accounts are assigned the Staff role.</span>
        <button
          className="button button-primary"
          disabled={staffBusy || demoSession}
        >
          {demoSession
            ? 'Sign in to create staff'
            : staffBusy
              ? 'Creating account…'
              : 'Create staff account'}
        </button>
      </div>
    </section>
    </form>

      {staffPendingDelete && (
        <Modal
          title={
            staffPendingDelete.is_active
              ? 'Deactivate staff account?'
              : 'Reactivate staff account?'
          }
          subtitle={
            staffPendingDelete.is_active
              ? 'The staff member will lose access until reactivated.'
              : 'The staff member will regain access to FullStock.'
          }
          onClose={() => {
            if (staffDeletingId === null) {
              setStaffPendingDelete(null)
            }
          }}
        >
          <p className="logout-confirm-copy">
            {staffPendingDelete.is_active ? (
              <>
                Deactivate <strong>{staffPendingDelete.name}</strong> (
                {staffPendingDelete.email})? They will no longer be able to sign in.
              </>
            ) : (
              <>
                Reactivate <strong>{staffPendingDelete.name}</strong> (
                {staffPendingDelete.email})? They will be able to sign in again.
              </>
            )}
          </p>

          <div className="modal-actions">
            <button
              type="button"
              className="button button-outline"
              onClick={() => setStaffPendingDelete(null)}
              disabled={staffDeletingId !== null}
            >
              Cancel
            </button>

            <button
              type="button"
              className={
                staffPendingDelete.is_active
                  ? 'button logout-confirm-button staff-status-confirm-button'
                  : 'button button-primary staff-status-confirm-button'
              }
              onClick={confirmStaffStatusChange}
              disabled={staffDeletingId === staffPendingDelete.id}
            >
              {staffDeletingId === staffPendingDelete.id
                ? 'Updating…'
                : staffPendingDelete.is_active
                  ? 'Deactivate account'
                  : 'Reactivate account'}
            </button>
          </div>
        </Modal>
      )}
      </>
  ) : tab === 'Password reset requests' && isAdmin ? (
    <PasswordResetRequestsPanel demoSession={demoSession} />
  ) : (
    <div className="settings-content settings-placeholder">
      <Settings size={24} />
      <strong>{tab} settings</strong>
      <span>Business preferences will be available here.</span>
    </div>
  )}
</div>
</>
}

function TableFooter({ count, total, page = 1, pages = 1, onPage = () => {} }) {
  const first = count ? ((page - 1) * PAGE_SIZE) + 1 : 0
  const last = Math.min(page * PAGE_SIZE, count)
  return <div className="table-footer"><span>Showing <strong>{first}–{last}</strong> of <strong>{count}</strong> results{count !== total && <small> ({total} total)</small>}</span>{pages > 1 && <div className="table-pagination"><button disabled={page <= 1} aria-label="Previous page" onClick={() => onPage(page - 1)}>‹</button><span>Page {page} of {pages}</span><button disabled={page >= pages} aria-label="Next page" onClick={() => onPage(page + 1)}>›</button></div>}</div>
}

function EmptyState({ title, text }) { return <div className="empty-state"><div><Package size={19} /></div><strong>{title}</strong><span>{text}</span></div> }

function EntityModal({ type, item, suppliers, products = [], onClose, onNavigate, onSave }) {
  const [form, setForm] = useState(() => {
    if (!item) return type === 'Products' ? { name: '', category: riceCatalog[0].category, price: '', stock: '0', reorder_level: '5', supplier_id: '' } : { name: '', contact: '', email: '', products: '' }
    const current = { ...item }
    delete current.sku
    return current
  })
  const supplier = type === 'Suppliers'
  const productNameTaken = type === 'Products' && products.some((product) => String(product.id) !== String(item?.id) && String(product.name).trim().toLowerCase() === String(form.name || '').trim().toLowerCase())
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  return <Modal title={(item ? 'Edit ' : 'Add ') + type.slice(0, -1).toLowerCase()} onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); if (type === 'Products' && (!String(form.name || '').trim() || productNameTaken)) return; onSave(type === 'Products' ? { ...form, name: form.name.trim() } : form) }}>
    <label className="field-label">{supplier ? 'Supplier name' : 'Rice product'}<input className="text-input" value={form.name || ''} onChange={(event) => update('name', event.target.value)} required maxLength={160} placeholder={supplier ? 'Supplier name' : 'e.g. Organic Jasmine Rice'} /></label>
    {type === 'Products' && productNameTaken && <p className="form-error" role="alert">That product is already in your catalog. Open Inventory to add stock to it.</p>}
    {supplier ? <><label className="field-label">Contact number<input className="text-input" value={form.contact || ''} onChange={(event) => update('contact', event.target.value)} /></label><label className="field-label">Email<input className="text-input" type="email" value={form.email || ''} onChange={(event) => update('email', event.target.value)} /></label><label className="field-label">Products supplied<input className="text-input" value={form.products || ''} onChange={(event) => update('products', event.target.value)} /></label></> : <><label className="field-label">Rice category<select className="text-input" value={form.category || riceCatalog[0].category} onChange={(event) => update('category', event.target.value)} required>{riceCatalog.map((value) => <option key={value.category} value={value.category}>{value.category}</option>)}</select></label><div className="form-two-col"><label className="field-label">Price (₱)<input type="number" min="0" step=".01" className="text-input" value={form.price || ''} onChange={(event) => update('price', event.target.value)} required /></label>{item && <label className="field-label">Current stock<input type="number" min="0" className="text-input" value={form.stock ?? ''} onChange={(event) => update('stock', event.target.value)} required /></label>}</div>{!item && <p className="sale-price-help">New rice varieties start at 0 stock. After saving, use Inventory → Add stock to record received units.</p>}<div className="form-two-col"><label className="field-label">Reorder level<input type="number" min="0" className="text-input" value={form.reorder_level ?? ''} onChange={(event) => update('reorder_level', event.target.value)} /></label><label className="field-label">Supplier<select className="text-input" value={form.supplier_id || ''} onChange={(event) => update('supplier_id', event.target.value)}><option value="">Select supplier</option>{suppliers.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label></div></>}
    <div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Cancel</button><button className="button button-primary">{item ? 'Save changes' : 'Add record'}</button></div>
  </form></Modal>
}

function SaleModal({ products, onClose, onSave }) {
  const [productId, setProductId] = useState(products[0]?.id || '')
  const [quantity, setQuantity] = useState(1)
  const product = products.find((value) => String(value.id) === String(productId))
  const unavailable = !product || Number(product.stock) < Number(quantity) || Number(quantity) < 1
  const unitPrice = Number(product?.price || 0)
  const priceMissing = !Number.isFinite(unitPrice) || unitPrice <= 0
  return <Modal title="Record a new sale" subtitle="Choose a product and quantity. The product price is applied automatically." onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); if (!unavailable && !priceMissing) onSave({ product, quantity: Number(quantity) }) }}><label className="field-label">Product<select className="text-input" value={productId} onChange={(event) => setProductId(event.target.value)}>{products.map((value) => <option key={value.id} value={value.id}>{value.name} — {Number(value.price) > 0 ? money(value.price) : 'Price needed'} ({value.stock} in stock)</option>)}</select></label><label className="field-label">Quantity<input className="text-input" type="number" min="1" max={product?.stock || 1} value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><p className="sale-price-help">Unit price is set by an administrator and cannot be changed while recording a sale.</p><div className="sale-total"><span>Unit price</span><strong>{money(unitPrice)}</strong></div><div className="sale-total"><span>Sale total</span><strong>{money(unitPrice * Number(quantity || 0))}</strong></div>{priceMissing && <p className="form-error" role="alert">This product has no price. Ask an administrator to set its price in Products before recording a sale.</p>}{unavailable && <p className="form-error" role="alert">Enter a quantity available in stock.</p>}<div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={unavailable || priceMissing}>Complete sale</button></div></form></Modal>
}

function RestockModal({ product, onClose, onSave }) {
  const [quantity, setQuantity] = useState(10)
  const [note, setNote] = useState('Supplier restock')
  return <Modal title="Restock rice" subtitle="Confirm which variety you received before saving the stock update." onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSave(Number(quantity), note) }}><div className="restock-product-card" aria-label={'Rice being restocked: ' + product.name}><span className="restock-product-icon"><Package size={19} /></span><div className="restock-product-copy"><span className="restock-product-label">RICE BEING RESTOCKED</span><strong>{product.name}</strong><small>{product.category || 'Rice'} <span aria-hidden="true">·</span> Product ID <span className="font-mono">#{product.id}</span></small></div></div><div className="restock-current"><span>Current stock</span><strong>{number(product.stock)} units</strong></div><label className="field-label">Quantity received<input className="text-input" type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label><label className="field-label">Reference or note<input className="text-input" value={note} onChange={(event) => setNote(event.target.value)} /></label><div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Cancel</button><button className="button button-primary" aria-label={'Save restock for ' + product.name}>Save restock</button></div></form></Modal>
}

function Modal({ title, subtitle, onClose, children }) {
  useEffect(() => { const handler = (event) => event.key === 'Escape' && onClose(); window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler) }, [onClose])
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal-card"><div className="modal-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></div>{children}</section></div>
}

function App() {
  const [session, setSession] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('fullstock_session') || 'null')
      const storedRole = stored?.user?.role?.toLowerCase()
      return !stored?.demo && ['admin', 'administrator', 'staff'].includes(storedRole) ? stored : null
    } catch { return null }
  })
  const assistantOwner = assistantOwnerKey(session)
  const [assistantStore, setAssistantStore] = useState(() => loadAssistantStore(session))
  const [data, setData] = useState(readStoredData)
  const [active, setActive] = useState(() => session?.user?.role?.toLowerCase() === 'staff' ? 'Products' : 'Dashboard')
  const [search, setSearch] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [modal, setModal] = useState(null)
  const [toast, setToast] = useState('')
  const [saleToView, setSaleToView] = useState(null)
  const [reportRefreshing, setReportRefreshing] = useState(false)
  const persist = (next) => { setData(next); localStorage.setItem('fullstock_data', JSON.stringify(next)) }
  const notify = (message) => { setToast(message); window.clearTimeout(window.fullstockToast); window.fullstockToast = window.setTimeout(() => setToast(''), 3200) }
  const refreshReportData = useCallback(async ({ silent = false } = {}) => {
    if (!session?.token) return false
    setReportRefreshing(true)
    try {
      const loaded = await loadWorkspace()
      const refreshed = { ...readStoredData(), ...loaded }
      setData(refreshed)
      localStorage.setItem('fullstock_data', JSON.stringify(refreshed))
      return true
    } catch (error) {
      if (!silent) {
        setToast(error.message || 'Could not refresh report data from Laravel.')
        window.clearTimeout(window.fullstockToast)
        window.fullstockToast = window.setTimeout(() => setToast(''), 3200)
      }
      return false
    } finally {
      setReportRefreshing(false)
    }
  }, [session?.token])
  const navigate = (destination) => {
    if (session?.user?.role?.toLowerCase() === 'staff' && !['Products', 'Sales'].includes(destination)) return
    setActive(destination); setSearch(''); setMobileOpen(false)
  }
  const requestSignOut = () => setModal({ kind: 'logout' })

  useEffect(() => { if (session) localStorage.setItem('fullstock_session', JSON.stringify(session)); else localStorage.removeItem('fullstock_session') }, [session])
  useEffect(() => { setAssistantStore(loadAssistantStore(session)) }, [assistantOwner])
  useEffect(() => {
    if (!assistantOwner || assistantStore.owner !== assistantOwner) return undefined
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(`fullstock_ai_chats:${encodeURIComponent(assistantOwner)}`, JSON.stringify(assistantStore))
      } catch { /* Keep the active chat usable if browser storage is full or disabled. */ }
    }, 180)
    return () => window.clearTimeout(timer)
  }, [assistantOwner, assistantStore])
  useEffect(() => {
  if (!session?.token || session.demo || session.user?.must_change_password) return
  loadWorkspace()
    .then((loaded) => persist({ ...readStoredData(), ...loaded }))
    .catch(() => notify('API is unavailable. Demo records are shown until the Laravel server is connected.'))
}, [session?.token, session?.demo, session?.user?.must_change_password])
  useEffect(() => {
    if (!session?.token || active !== 'Reports') return
    refreshReportData({ silent: true })
    const syncVisibleReports = () => {
      if (document.visibilityState === 'visible') refreshReportData({ silent: true })
    }
    window.addEventListener('focus', syncVisibleReports)
    return () => window.removeEventListener('focus', syncVisibleReports)
  }, [active, session?.token, refreshReportData])

  const login = async (email, password) => {
    try {
      const result = await api.login(email, password)
      setSession({ user: result.user, token: result.token, demo: false })
      if (result.user?.role?.toLowerCase() === 'staff') setActive('Products')
      notify('Signed in successfully.')
      return result
    } catch (error) {
      throw new Error(error.message === 'Failed to fetch'
        ? 'Cannot reach the Laravel API. Start the backend server, then sign in again.'
        : error.message)
    }
  }
  const changeTemporaryPassword = async (values) => {
    const result = await api.changeTemporaryPassword(values)
    setSession((current) => current ? { ...current, user: result.user } : current)
    notify('Your password has been changed.')
    return result
  }
  const createStaffAccount = async (values) => {
    const isAdmin = ['admin', 'administrator'].includes(session?.user?.role?.toLowerCase())
    if (session?.demo) throw new Error('Demo accounts are local previews and cannot create database users. Sign in with your real administrator account while Laravel is running.')
    if (!session?.token || !isAdmin) throw new Error('Sign in with an administrator account to create staff accounts.')
    return api.createStaffAccount(values)
  }
  const signOut = async () => { if (session?.token) api.logout().catch(() => {}); setSession(null); setActive('Dashboard'); setSearch(''); setModal(null) }
  const createAssistantChat = () => {
    const owner = assistantOwnerKey(session)
    if (!owner) return
    const conversation = createAssistantConversation()
    setAssistantStore((current) => {
      const base = current.owner === owner ? current : loadAssistantStore(session)
      return { ...base, owner, activeId: conversation.id, conversations: [conversation, ...base.conversations].slice(0, 20) }
    })
  }
  const selectAssistantChat = (id) => {
    const owner = assistantOwnerKey(session)
    if (!owner) return
    setAssistantStore((current) => {
      const base = current.owner === owner ? current : loadAssistantStore(session)
      if (!base.conversations.some((conversation) => conversation.id === id)) return base
      return { ...base, owner, activeId: id }
    })
  }
  const deleteAssistantChat = (id) => {
    const owner = assistantOwnerKey(session)
    if (!owner) return
    const current = assistantStore.owner === owner ? assistantStore : loadAssistantStore(session)
    if (!current.conversations.some((conversation) => conversation.id === id)) return
    if (!window.confirm('Delete this saved conversation? This cannot be undone.')) return

    setAssistantStore((state) => {
      const base = state.owner === owner ? state : loadAssistantStore(session)
      const conversations = base.conversations.filter((conversation) => conversation.id !== id)
      const remaining = conversations.length ? conversations : [createAssistantConversation()]
      return {
        ...base,
        owner,
        activeId: base.activeId === id ? remaining[0].id : base.activeId,
        conversations: remaining,
      }
    })
  }
  const updateAssistantChat = (id, update) => {
    const owner = assistantOwnerKey(session)
    if (!owner) return
    setAssistantStore((current) => {
      const base = current.owner === owner ? current : loadAssistantStore(session)
      return {
        ...base,
        owner,
        conversations: base.conversations.map((conversation) => {
          if (conversation.id !== id) return conversation
          const next = typeof update === 'function' ? update(conversation) : update
          return { ...next, updatedAt: Date.now(), messages: (next.messages || []).slice(-100) }
        }),
      }
    })
  }
  const callApi = async (promise) => { if (!session?.token) return null; try { return await promise } catch (error) { notify(error.message || 'Could not sync with Laravel.'); return null } }

  const saveEntity = async (type, item, values) => {
    const path = pagePaths[type]
    const listKey = type.toLowerCase()
    const normalized = type === 'Products' ? { ...values, price: Number(values.price), stock: Number(values.stock), reorder_level: Number(values.reorder_level), supplier_id: values.supplier_id ? Number(values.supplier_id) : null, supplier_name: data.suppliers.find((supplier) => String(supplier.id) === String(values.supplier_id))?.name || values.supplier_name || '' } : values
    if (item) {
      const response = await callApi(api.update(path, item.id, normalized))
      if (session?.token && !response) return
      persist({ ...data, [listKey]: data[listKey].map((value) => value.id === item.id ? { ...value, ...normalized } : value) })
      notify(type.slice(0, -1) + ' updated.')
    } else {
      const response = await callApi(api.create(path, normalized))
      if (session?.token && !response) return
      persist({ ...data, [listKey]: [{ id: response?.id || getId(data[listKey]), ...normalized }, ...data[listKey]] })
      notify(type.slice(0, -1) + ' added.')
    }
    setModal(null)
  }
  const deleteEntity = async (type, item) => {
  if (!window.confirm('Delete ' + item.name + '? This action cannot be undone.')) return
  const listKey = type.toLowerCase()
  const response = await callApi(api.remove(pagePaths[type], item.id))
  if (session?.token && !response) return
  persist({ ...data, [listKey]: data[listKey].filter((value) => value.id !== item.id) })
  notify(type.slice(0, -1) + ' deleted.')
}
  const saveRestock = async (product, quantity, note) => {
    const movement = { id: getId(data.movements), date: new Date().toISOString(), product_id: product.id, product_name: product.name, type: 'Stock In', quantity, reference: note }
    const savedMovement = await callApi(api.adjustStock({ product_id: product.id, quantity, type: 'in', note }))
    if (session?.token && !savedMovement) return
    if (savedMovement?.id) movement.id = savedMovement.id
    persist({ ...data, products: data.products.map((value) => value.id === product.id ? { ...value, stock: Number(value.stock) + quantity } : value), movements: [movement, ...data.movements] })
    setModal(null)
    notify('Inventory updated.')
  }
  const saveSale = async ({ items, product, quantity }) => {
    const lines = items || [{ product, quantity }]
    if (!lines.length) return false
    const normalized = lines.map((line) => ({ product: line.product, quantity: Number(line.quantity) }))
    const timestamp = new Date().toISOString()
    const numberText = 'S-' + String(getId(data.sales) + 1038)
    const total = normalized.reduce((sum, line) => sum + Number(line.product.price) * line.quantity, 0)
    const sale = { id: getId(data.sales), number: numberText, date: timestamp, total, status: 'Completed', items: normalized.map(({ product: itemProduct, quantity: itemQuantity }) => ({ product_id: itemProduct.id, product_name: itemProduct.name, quantity: itemQuantity, price: Number(itemProduct.price) })) }
    const savedSale = await callApi(api.createSale({ items: normalized.map(({ product: itemProduct, quantity: itemQuantity }) => ({ product_id: Number(itemProduct.id), quantity: itemQuantity })) }))
    if (session?.token && !savedSale) return false
    const completedSale = savedSale || sale
    const movements = normalized.map(({ product: itemProduct, quantity: itemQuantity }, index) => ({ id: getId(data.movements) + index, date: completedSale.date || timestamp, product_id: itemProduct.id, product_name: itemProduct.name, type: 'Sale', quantity: -itemQuantity, reference: 'Sale #' + (completedSale.number || numberText) }))
    persist({ ...data, sales: [completedSale, ...data.sales], products: data.products.map((value) => {
      const soldLine = normalized.find((line) => String(line.product.id) === String(value.id))
      return soldLine ? { ...value, stock: Number(value.stock) - soldLine.quantity } : value
    }), movements: [...movements, ...data.movements] })
    setModal(null)
    notify('Sale completed and inventory updated.')
    return true
  }

  if (!session) return <LoginScreen onLogin={login} onSetupAdministrator={api.setupAdministrator} onForgotPassword={api.forgotPassword} onResetPassword={api.resetPassword} onSubmitPasswordResetRequest={api.submitPasswordResetRequest} />

  if (session.user?.must_change_password) {
    return <TemporaryPasswordChangeScreen
      user={session.user}
      onChangePassword={changeTemporaryPassword}
      onSignOut={signOut}
    />
  }
  const role = session.user?.role?.toLowerCase()
  const isStaff = role === 'staff'
  const canManageWorkspace = role === 'admin' || role === 'administrator'
  const visibleNav = isStaff
    ? nav.filter(({ label }) => ['Products', 'Sales'].includes(label))
    : nav
  const workspaceData = data
  const title = active
  let page
  if (title === 'Dashboard') page = <Dashboard data={workspaceData} user={session.user} onNavigate={navigate} />
  else if (title === 'Products') page = isStaff
    ? <StaffPosPage products={data.products} search={search} setSearch={setSearch} onCheckout={saveSale} />
    : <ProductPage products={data.products} search={search} setSearch={setSearch} canManage={canManageWorkspace} onAdd={() => setModal({ kind: 'entity', type: 'Products' })} onManageStock={() => navigate('Inventory')} onEdit={(item) => setModal({ kind: 'entity', type: 'Products', item })} onDelete={(item) => deleteEntity('Products', item)} />
  else if (title === 'Sales') page = <SalesPage sales={workspaceData.sales} search={search} setSearch={setSearch} onNewSale={() => isStaff ? navigate('Products') : setModal({ kind: 'sale' })} onView={setSaleToView} isStaff={isStaff} />
  else if (title === 'Inventory') page = <InventoryPage products={data.products} movements={data.movements} search={search} setSearch={setSearch} onRestock={(item) => setModal({ kind: 'restock', item })} />
  else if (title === 'Suppliers') page = <EntityPage items={data.suppliers} search={search} setSearch={setSearch} onAdd={() => setModal({ kind: 'entity', type: title })} onEdit={(item) => setModal({ kind: 'entity', type: title, item })} onDelete={(item) => deleteEntity(title, item)} />
  else if (title === 'Help') page = <HelpPage onNavigate={navigate} />
  else if (title === 'Reports') page = <ReportsPage data={data} onRefresh={() => refreshReportData()} refreshing={reportRefreshing} />
  else if (title === 'AI Assistant') {
    const chats = assistantStore.owner === assistantOwner ? assistantStore.conversations : loadAssistantStore(session).conversations
    const activeChat = chats.find((chat) => chat.id === assistantStore.activeId) || chats[0]
    page = <AssistantPage data={data} conversations={chats} activeConversation={activeChat} onNewChat={createAssistantChat} onSelectChat={selectAssistantChat} onDeleteChat={deleteAssistantChat} onUpdateChat={updateAssistantChat} />
  }
  else page = <SettingsPage user={session.user} onToast={notify} onCreateStaffAccount={createStaffAccount} demoSession={session.demo} />

  return <div className="app-shell"><Sidebar active={title} onNavigate={navigate} onSignOut={requestSignOut} mobileOpen={mobileOpen} closeMobile={() => setMobileOpen(false)} user={session.user} visibleNav={visibleNav} lowStockCount={data.products.filter((product) => Number(product.stock) <= Number(product.reorder_level)).length} /><div className="app-main"><Topbar search={search} setSearch={setSearch} openMenu={() => setMobileOpen(true)} user={session.user} onNavigate={navigate} onSignOut={requestSignOut} data={workspaceData} /><main className="page-content" key={title}>{page}</main><footer className="app-footer"><span>© 2026 FullStock</span><span>Inventory made clearer.</span></footer></div>
    {modal?.kind === 'entity' && <EntityModal type={modal.type} item={modal.item} suppliers={data.suppliers} products={data.products} onClose={() => setModal(null)} onNavigate={navigate} onSave={(values) => saveEntity(modal.type, modal.item, values)} />}
    {modal?.kind === 'sale' && <SaleModal products={data.products} onClose={() => setModal(null)} onSave={saveSale} />}
    {modal?.kind === 'restock' && <RestockModal product={modal.item} onClose={() => setModal(null)} onSave={(quantity, note) => saveRestock(modal.item, quantity, note)} />}
    {modal?.kind === 'logout' && <Modal title="Log out of FullStock?" subtitle={'You are signed in as ' + (session.user?.name || 'Admin') + '.'} onClose={() => setModal(null)}><p className="logout-confirm-copy">You can sign back in any time with your account.</p><div className="modal-actions"><button className="button button-outline" onClick={() => setModal(null)}>Stay signed in</button><button className="button button-primary logout-confirm-button" onClick={signOut}><LogOut size={15} /> Log out</button></div></Modal>}
    {saleToView && <Modal title={'Sale #' + (saleToView.number || saleToView.id)} subtitle={shortDate(saleToView.date)} onClose={() => setSaleToView(null)}><div className="sale-detail">{(saleToView.items || []).map((item, index) => <div className="sale-detail-item" key={index}><span>{item.product_name} × {item.quantity}</span><strong>{money(item.price * item.quantity)}</strong></div>)}<div className="sale-detail-total"><span>Total</span><strong>{money(saleToView.total)}</strong></div></div></Modal>}
    {toast && <div className="toast-message"><span><Check size={15} /></span>{toast}<button aria-label="Dismiss" onClick={() => setToast('')}><X size={15} /></button></div>}
  </div>
}

export default App
